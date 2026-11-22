/* Birlash Google hisob: Gmail bilan kirish, rol (student / ustoz / foydalanuvchi) va qo'lyozmani Google Drive'ga saqlash.
   - Kirish: Google Identity Services (access_token) -> server tekshiradi -> imzoli sessiya.
   - Drive: faqat "drive.appdata" ruxsati: ilovaning yashirin papkasi, foydalanuvchining boshqa fayllari ko'rinmaydi.
   - Qo'lyozma (harflar qolipi) services.js dagi BirlashHand orqali o'qiladi / yoziladi.
   - Server sozlanmagan bo'lsa (GOOGLE_CLIENT_ID yo'q) tugma ko'rinmaydi, qo'lyozma esa faqat qurilmada ishlayveradi. */
(function () {
  'use strict';

  var SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.appdata';
  var SCOPES = 'openid email profile ' + SCOPE_DRIVE;
  var FILE = 'birlash-handwriting.json';
  var K = { sess: 'bxSess', user: 'bxUser', owner: 'birlashGlyphsOwner', dirty: 'bxGlyphDirty', bak: 'birlashGlyphsBackup', driveOk: 'bxDriveOk', gCenter: 'bxCenterFromGoogle' };
  var ROLE = {
    student: { label: 'Student', info: 'Xonaga Receiver sifatida kiradi' },
    teacher: { label: 'Ustoz', info: 'Transmitter: xona ochadi va boshqaradi' },
    user: { label: 'Foydalanuvchi', info: 'Oddiy kirish. Markaz kodini kiritsangiz student yoki ustoz bo‘lasiz' }
  };

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function readJSON(k) { try { return JSON.parse(ls(k) || 'null'); } catch (e) { return null; } }

  var cfg = { enabled: false, clientId: '' };
  var sess = ls(K.sess) || '';
  var me = readJSON(K.user);                      // { id, name, email, picture, role }
  var drive = { token: '', exp: 0, fileId: '', state: ls(K.driveOk) === '1' ? 'idle' : 'off', msg: '' };   // off | idle | busy | saved | err
  var tokenClient = null, gsiReady = false, pending = null, quiet = false;
  var mounts = [];

  /* ---------------- kichik yordamchilar ---------------- */
  var toastT;
  function toast(msg, ms) {
    var t = $('#bxaToast'); if (!t) { t = document.createElement('div'); t.id = 'bxaToast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, ms || 3200);
  }
  function api(path, opt) {
    opt = opt || {}; opt.headers = Object.assign({ 'Content-Type': 'application/json' }, opt.headers || {});
    if (sess && opt.auth !== false) opt.headers.Authorization = 'Bearer ' + sess;
    return fetch(path, opt).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }

  /* ---------------- qo'lyozma ma'lumotlari ---------------- */
  var CH = ['a', 'm', 'e'];
  function cleanGlyphs(o) {                       // tashqaridan kelgan (Drive / fayl) ma'lumotni tekshiradi va tozalaydi
    var out = {}; if (!o || typeof o !== 'object') return out;
    Object.keys(o).slice(0, 400).forEach(function (ch) {
      if (Array.from(ch).length !== 1) return;
      var g = o[ch]; if (!g || typeof g !== 'object') return;
      CH.forEach(function (f) {
        var st = g[f]; if (!Array.isArray(st)) return; var ss = [];
        st.slice(0, 60).forEach(function (s) {
          if (!Array.isArray(s) || s.length < 2 || s.length > 4000) return;
          var p = [];
          for (var i = 0; i < s.length - 1; i += 2) {
            var x = +s[i], y = +s[i + 1]; if (!isFinite(x) || !isFinite(y)) return;
            p.push(Math.round(Math.max(-60, Math.min(360, x)) * 10) / 10, Math.round(Math.max(-60, Math.min(360, y)) * 10) / 10);
          }
          if (p.length >= 2) ss.push(p);
        });
        if (ss.length) (out[ch] = out[ch] || {})[f] = ss;
      });
    });
    return out;
  }
  function count(g) { var n = 0; Object.keys(g || {}).forEach(function (ch) { var x = g[ch]; if (x && ((x.a && x.a.length) || (x.m && x.m.length) || (x.e && x.e.length))) n++; }); return n; }
  function merge(base, extra) {                   // base ustun: faqat yetishmagan shakllar extra'dan qo'shiladi
    var out = JSON.parse(JSON.stringify(base || {}));
    Object.keys(extra || {}).forEach(function (ch) {
      CH.forEach(function (f) { var v = extra[ch] && extra[ch][f]; if (v && v.length && !(out[ch] && out[ch][f] && out[ch][f].length)) { out[ch] = out[ch] || {}; out[ch][f] = v; } });
    });
    return out;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function localGlyphs() { return window.BirlashHand ? cleanGlyphs(window.BirlashHand.get()) : {}; }
  function payload(g) { return JSON.stringify({ v: 1, app: 'birlash-handwriting', updatedAt: new Date().toISOString(), glyphs: g }); }

  /* ---------------- Google Identity Services ---------------- */
  function loadGsi() {
    return new Promise(function (res, rej) {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error('gsi')); };
      document.head.appendChild(s);
    });
  }
  function initClient() {
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId, scope: SCOPES,
      callback: function (resp) { var p = pending; pending = null; if (p) p(resp); },
      error_callback: function (err) {
        var p = pending; pending = null; if (p) p({ error: (err && err.type) || 'error' });
        if (err && err.type === 'popup_failed_to_open' && !quiet) toast('Brauzer Google oynasini blokladi. Pop-up ga ruxsat bering yoki Chrome / Safari da oching.', 6000);
      }
    });
    return tokenClient;
  }
  function askGoogle(opts) {                      // foydalanuvchi bosishi ichida (sinxron) chaqirilishi kerak
    return new Promise(function (res) {
      if (!gsiReady) { if (!quiet) toast('Google yuklanmoqda… bir soniyadan keyin qayta bosing'); return res({ error: 'not_ready' }); }
      pending = res;
      try { initClient().requestAccessToken(opts); } catch (e) { pending = null; res({ error: 'error' }); }
    });
  }
  function takeDrive(resp) {                      // true: Drive ruxsati berilgan
    if (!resp || resp.error || !resp.access_token) return false;
    var ok = google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_DRIVE);
    if (ok) { drive.token = resp.access_token; drive.exp = Date.now() + (Number(resp.expires_in) || 3000) * 1000; ls(K.driveOk, '1'); }
    return ok;
  }
  function driveTokenValid() { return drive.token && Date.now() < drive.exp - 60000; }
  function getDriveToken(interactive) {           // sokin yangilash urinishi; pop-up bloklansa '' qaytadi
    if (driveTokenValid()) return Promise.resolve(drive.token);
    if (!gsiReady || !me || (!interactive && ls(K.driveOk) !== '1')) return Promise.resolve('');
    quiet = !interactive;
    return Promise.race([askGoogle({ prompt: '', hint: me.email }), new Promise(function (r) { setTimeout(function () { r({ error: 'timeout' }); }, 9000); })])
      .then(function (resp) { quiet = false; pending = null; return takeDrive(resp) ? drive.token : ''; });
  }

  /* ---------------- Drive (appDataFolder) ---------------- */
  function dFetch(url, opt, tok) {
    opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + tok }, opt.headers || {});
    return fetch(url, opt).then(function (r) {
      if (r.status === 401) { drive.token = ''; drive.exp = 0; throw new Error('auth'); }
      if (!r.ok) throw new Error('drive ' + r.status);
      return r;
    });
  }
  function findFile(tok) {
    var q = encodeURIComponent("name='" + FILE + "' and trashed=false");
    return dFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=' + q + '&fields=files(id)&pageSize=1', {}, tok)
      .then(function (r) { return r.json(); }).then(function (j) { return (j.files && j.files[0]) || null; });
  }
  function pull(tok) {
    return findFile(tok).then(function (f) {
      if (!f) return null; drive.fileId = f.id;
      return dFetch('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media', {}, tok).then(function (r) { return r.json(); });
    });
  }
  function create(tok, body) {
    var b = 'bxa' + Date.now().toString(36), meta = JSON.stringify({ name: FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
    var mp = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
    return dFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: mp }, tok)
      .then(function (r) { return r.json(); }).then(function (j) { drive.fileId = j.id; });
  }
  function push(tok, g) {
    var body = payload(g);
    var go = function () {
      if (!drive.fileId) return create(tok, body);
      return dFetch('https://www.googleapis.com/upload/drive/v3/files/' + drive.fileId + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body }, tok)
        .catch(function (e) { if (/drive 404/.test(e.message)) { drive.fileId = ''; return create(tok, body); } throw e; });
    };
    return (drive.fileId ? Promise.resolve() : findFile(tok).then(function (f) { if (f) drive.fileId = f.id; })).then(go);
  }

  function setState(st, msg) { drive.state = st; drive.msg = msg || ''; renderAll(); }

  /* Drive'dan olish + qurilmadagi bilan birlashtirish (yoki almashtirish) va kerak bo'lsa Drive'ni yangilash */
  function syncNow(tok, replace) {
    var hand = window.BirlashHand; if (!hand || !me) return Promise.resolve();
    setState('busy', 'Drive bilan sinxronlanmoqda…');
    return pull(tok).then(function (d) {
      var remote = d ? cleanGlyphs(d.glyphs || d) : null, local = localGlyphs(), owner = ls(K.owner), note = '';
      if (owner && owner !== me.id && count(local) > 0) {          // boshqa hisobning qo'lyozmasi aralashib ketmasin: zaxiraga olinadi
        ls(K.bak, JSON.stringify({ owner: owner, glyphs: local })); local = {}; note = ' Qurilmadagi boshqa hisob qo‘lyozmasi zaxiraga olindi.';
      }
      var next = replace ? (remote || {}) : (remote ? merge(local, remote) : local);
      ls(K.owner, me.id);
      if (!same(next, localGlyphs())) hand.set(next);
      var fromDrive = remote && count(remote) > 0;
      var after = (count(next) && (!remote || !same(next, remote))) ? push(tok, next) : Promise.resolve();
      return after.then(function () {
        ls(K.dirty, null);
        var n = count(next);
        setState('saved', n ? 'Drive bilan sinxron · ' + n + ' ta belgi' : 'Drive ulangan. Hali qo‘lyozma yozilmagan');
        if (fromDrive && !replace) toast('✔ Qo‘lyozmangiz Google Drive’dan yuklandi (' + count(remote) + ' ta belgi).' + note, 4200);
        else if (replace) toast('✔ Drive’dagi qo‘lyozma yuklandi', 3000);
        else if (note) toast(note.trim(), 4200);
      });
    }).catch(function (e) { setState('err', e && e.message === 'auth' ? 'Drive ruxsati tugagan. Qayta ulang' : 'Drive bilan aloqa xatosi'); });
  }
  var autoT, autoBusy = false;
  function autoPush() {
    if (!me || autoBusy || ls(K.driveOk) !== '1') return;
    autoBusy = true;
    getDriveToken(false).then(function (tok) {
      if (!tok) { setState('err', 'Drive’ga saqlanmagan o‘zgarishlar bor. “Drive’ga saqlash” ni bosing'); return; }
      setState('busy', 'Drive’ga saqlanmoqda…');
      return push(tok, localGlyphs()).then(function () { ls(K.dirty, null); setState('saved', 'Drive’ga saqlandi · ' + count(localGlyphs()) + ' ta belgi'); });
    }).catch(function () { setState('err', 'Drive’ga saqlanmadi. Qayta urinib ko‘ring'); })
      .then(function () { autoBusy = false; });
  }

  /* ---------------- kirish / chiqish ---------------- */
  function applyCenter(v, fromLogin) {
    if (!v) return;
    if (v.center && v.ctoken && window.CENTER_SET && v.user && v.user.role !== 'user') {
      var cur = ''; try { cur = localStorage.getItem('sc_center_tok') || ''; } catch (e) {}
      if (fromLogin || cur !== v.ctoken) { window.CENTER_SET(v.center, v.ctoken, v.user.role); ls(K.gCenter, '1'); if (fromLogin) toast('✔ ' + v.center.name + ' — ' + ROLE[v.user.role].label.toLowerCase() + ' sifatida kirdingiz', 3800); }
    } else if (ls(K.gCenter) === '1' && window.CENTER_CLEAR) { window.CENTER_CLEAR(); ls(K.gCenter, null); }
  }
  function setUser(v) { me = v.user; ls(K.user, JSON.stringify(me)); }

  function signIn() {
    if (!cfg.enabled) return toast('Google bilan kirish serverda sozlanmagan');
    askGoogle({ prompt: 'select_account' }).then(function (resp) {
      if (!resp || resp.error) { if (resp && resp.error && resp.error !== 'not_ready' && resp.error !== 'popup_failed_to_open' && resp.error !== 'popup_closed') toast('Google kirishi bekor qilindi'); return; }
      var hasDrive = takeDrive(resp);
      return api('/api/auth/google', { method: 'POST', auth: false, body: JSON.stringify({ access_token: resp.access_token }) }).then(function (j) {
        if (!j.ok) return toast('❌ ' + (j.error || 'Kirib bo‘lmadi'), 5000);
        sess = j.token; ls(K.sess, sess); setUser(j); renderAll();
        toast('✔ Xush kelibsiz, ' + (me.name || me.email) + ' · ' + ROLE[me.role].label, 3200);
        applyCenter(j, true);
        if (hasDrive) return syncNow(drive.token, false);
        drive.state = 'off'; ls(K.driveOk, null); renderAll();
        toast('Drive ruxsati berilmadi — qo‘lyozma faqat qurilmada saqlanadi. Keyinroq “Drive ulash” ni bosing', 5500);
      });
    });
  }
  function connectDrive() {
    if (!me) return signIn();
    askGoogle({ prompt: 'consent', hint: me.email }).then(function (resp) {
      if (!resp || resp.error) return;
      if (!takeDrive(resp)) { setState('off', ''); return toast('Drive ruxsati berilmadi'); }
      return syncNow(drive.token, false);
    });
  }
  function driveAction(kind) {                    // 'save' | 'load' — foydalanuvchi bosishi ichida
    if (!me) return signIn();
    var run = function (tok) {
      if (!tok) return connectDrive();
      if (kind === 'save') {
        setState('busy', 'Drive’ga saqlanmoqda…');
        return push(tok, localGlyphs()).then(function () { ls(K.owner, me.id); ls(K.dirty, null); setState('saved', 'Drive’ga saqlandi · ' + count(localGlyphs()) + ' ta belgi'); toast('✔ Qo‘lyozma Google Drive’ga saqlandi', 2800); })
          .catch(function () { setState('err', 'Drive’ga saqlanmadi. Qayta ulang'); });
      }
      if (count(localGlyphs()) && !confirm('Qurilmadagi qo‘lyozma Drive’dagisi bilan almashtirilsinmi?')) return;
      return syncNow(tok, true);
    };
    if (driveTokenValid()) return run(drive.token);
    askGoogle({ prompt: '', hint: me.email }).then(function (resp) { run(takeDrive(resp) ? drive.token : ''); });
  }
  function signOut() {
    var synced = drive.state === 'saved' && ls(K.dirty) !== '1';
    if (synced && count(localGlyphs()) && window.BirlashHand && confirm('Chiqishda qo‘lyozma shu qurilmadan ham o‘chirilsinmi?\n(Google Drive’da saqlanib qoladi. Umumiy kompyuterda “OK” ni tanlang.)')) { window.BirlashHand.set({}); ls(K.owner, null); }
    if (drive.token && window.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(drive.token, function () {}); } catch (e) {} }
    if (ls(K.gCenter) === '1' && window.CENTER_CLEAR) { window.CENTER_CLEAR(); }
    ls(K.gCenter, null); ls(K.sess, null); ls(K.user, null); ls(K.driveOk, null);
    sess = ''; me = null; drive = { token: '', exp: 0, fileId: '', state: 'off', msg: '' };
    renderAll(); toast('Hisobdan chiqildi');
  }

  /* ---------------- markaz kodi bilan rolni hisobga bog'lash ---------------- */
  function linkCenter(code, out, btn) {
    code = String(code || '').trim(); if (!code) { out.textContent = 'Kodni kiriting'; return; }
    btn.disabled = true; out.textContent = '';
    var dev = ''; try { dev = localStorage.getItem('sc_dev') || ''; } catch (e) {}
    api('/api/center/verify', { method: 'POST', auth: false, body: JSON.stringify({ code: code, dev: dev }) }).then(function (j) {
      if (!j.ok) { out.textContent = '❌ ' + (j.error || 'Kod noto‘g‘ri'); return; }
      return api('/api/auth/link-center', { method: 'POST', body: JSON.stringify({ ctoken: j.token }) }).then(function (v) {
        if (!v.ok) { out.textContent = '❌ ' + (v.error || 'Bog‘lab bo‘lmadi'); return; }
        setUser(v); applyCenter(v, true); renderAll();
        toast('✔ Rolingiz saqlandi: ' + ROLE[me.role].label + '. Keyingi safar Google bilan kirsangiz avtomatik tiklanadi', 4800);
      });
    }).catch(function () { out.textContent = 'Server bilan aloqa yo‘q'; }).then(function () { btn.disabled = false; });
  }

  /* ---------------- Hisob oynasi ---------------- */
  var root;
  var ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  function avatar(u, cls) {
    return u && u.picture ? '<img class="' + cls + '" src="' + esc(u.picture) + '" alt="" referrerpolicy="no-referrer">' : '<span class="' + cls + ' ph">' + esc((u && (u.name || u.email) || '?').charAt(0).toUpperCase()) + '</span>';
  }
  function driveLine() {
    var dot = { off: 'off', idle: 'idle', busy: 'busy', saved: 'ok', err: 'bad' }[drive.state] || 'off';
    var txt = drive.msg || (drive.state === 'off' ? 'Google Drive ulanmagan' : drive.state === 'idle' ? 'Drive ulangan (tokenni yangilash uchun “Drive’ga saqlash” ni bosing)' : '');
    return '<span class="bxa-dot ' + dot + '"></span>' + esc(txt);
  }
  function buildRoot() {
    if (root) return;
    root = document.createElement('div'); root.id = 'bxaRoot'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Google hisob');
    root.innerHTML = '<div class="bxa-bg" data-x></div><div class="bxa-box"><button class="bxa-x" data-x aria-label="Yopish">✕</button><div data-body></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-x],[data-act]'); if (!t) return;
      if (t.hasAttribute('data-x')) return closeRoot();
      var a = t.getAttribute('data-act');
      if (a === 'login') signIn(); else if (a === 'drive') connectDrive(); else if (a === 'save') driveAction('save'); else if (a === 'load') driveAction('load');
      else if (a === 'out') signOut();
      else if (a === 'link') linkCenter($('[data-code]', root).value, $('[data-linkmsg]', root), t);
      else if (a === 'unlink') api('/api/auth/unlink-center', { method: 'POST' }).then(function (v) { if (v.ok) { setUser(v); applyCenter(v, false); renderAll(); toast('Markaz roli hisobdan olib tashlandi'); } });
    });
    root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('[data-code]')) { e.preventDefault(); $('[data-act="link"]', root).click(); } });
  }
  function renderRoot() {
    if (!root) return; var b = $('[data-body]', root), h;
    if (!me) {
      h = '<div class="bxa-hero">' + ICON_USER + '</div><h2>Google bilan kirish</h2>' +
        '<p class="bxa-sub">Gmail orqali kiring: qo‘lyozmangiz hisobingizda saqlanadi va keyingi safar <b>avtomatik</b> yuklanadi. Har safar qaytadan yozib chiqish shart emas.</p>' +
        '<ul class="bxa-list"><li><b>Student</b> — xonaga Receiver sifatida kiradi</li><li><b>Ustoz</b> — Transmitter, xona ochadi</li><li><b>Foydalanuvchi</b> — oddiy kirish (rol keyin bog‘lanadi)</li></ul>' +
        '<button class="sv-btn pri bxa-wide" data-act="login">' + gLogo() + 'Google bilan kirish</button>' +
        '<p class="sv-note">Ruxsat so‘raladi: ism va Gmail manzilingiz, shuningdek <b>Google Drive’dagi shu ilovaning yashirin papkasi</b>. Drive’dagi boshqa fayllaringizni ko‘rmaymiz va o‘qimaymiz. Istasangiz Drive ruxsatini bermasdan ham kirishingiz mumkin.</p>';
    } else {
      var r = ROLE[me.role] || ROLE.user, hasCenter = ls(K.gCenter) === '1' || me.role !== 'user';
      h = '<div class="bxa-me">' + avatar(me, 'bxa-av') + '<div><b>' + esc(me.name) + '</b><span>' + esc(me.email) + '</span></div><i class="bxa-role r-' + esc(me.role) + '">' + esc(r.label) + '</i></div>' +
        '<p class="sv-note" style="margin-top:8px">' + esc(r.info) + '</p>' +
        '<div class="bxa-sec"><h3>Google Drive · qo‘lyozma</h3><div class="bxa-st">' + driveLine() + '</div><div class="sv-actions">' +
        (ls(K.driveOk) === '1' ? '<button class="sv-btn pri" data-act="save">☁️ Drive’ga saqlash</button><button class="sv-btn" data-act="load">⬇️ Drive’dan olish</button>' : '<button class="sv-btn pri" data-act="drive">☁️ Google Drive ulash</button>') +
        '</div><p class="sv-note">Qo‘lyozma: Services → Qo‘lyozma A4 → “Mening qo‘lyozmam”. O‘zgarishlar avtomatik saqlanadi.</p></div>' +
        '<div class="bxa-sec"><h3>O‘quv markaz roli</h3>' +
        (me.role === 'user' ? '<p class="sv-note" style="margin:0 0 8px">Markaz kodini bir marta kiriting — rolingiz hisobga bog‘lanadi va keyingi kirishda avtomatik tiklanadi.</p><div class="bxa-form"><input data-code type="text" placeholder="Student yoki ustoz kodi" autocomplete="off" maxlength="200"><button class="sv-btn pri" data-act="link">Bog‘lash</button></div><div class="bxa-err" data-linkmsg></div>'
          : '<p class="sv-note" style="margin:0 0 8px">Rol hisobga bog‘langan.' + (hasCenter ? ' Markaz tizimga avtomatik qo‘llanadi.' : '') + '</p><div class="sv-actions" style="margin-top:0"><button class="sv-btn" data-act="unlink">Bog‘lanishni olib tashlash</button></div><p class="sv-note">Admin tomonidan (.env) belgilangan rolni bu yerdan o‘chirib bo‘lmaydi.</p>') +
        '</div><div class="sv-actions" style="margin-top:16px"><button class="sv-btn" data-act="out">Chiqish</button></div>';
    }
    b.innerHTML = h;
  }
  function gLogo() { return '<svg viewBox="0 0 24 24" class="bxa-g" aria-hidden="true"><path fill="#fff" d="M21.35 11.1H12v2.9h5.35c-.5 2.4-2.55 3.6-5.35 3.6a5.6 5.6 0 1 1 0-11.2c1.4 0 2.65.5 3.6 1.4l2.1-2.1A8.5 8.5 0 0 0 12 3.5a8.5 8.5 0 1 0 0 17c4.9 0 8.2-3.4 8.2-8.3 0-.4 0-.8-.1-1.1z"/></svg>'; }
  function openRoot() { buildRoot(); renderRoot(); root.classList.add('on'); document.documentElement.style.overflow = 'hidden'; }
  function closeRoot() { if (root) root.classList.remove('on'); document.documentElement.style.overflow = ''; }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && root.classList.contains('on')) closeRoot(); });

  /* ---------------- dock tugmasi ---------------- */
  function renderDock() {
    var d = $('#svcDock'); if (!d) return false;
    var b = $('.sd-acc', d);
    if (!cfg.enabled && !me) { if (b) b.remove(); return true; }
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.className = 'sd-acc'; b.addEventListener('click', openRoot); d.appendChild(b);
    }
    b.setAttribute('data-tip', me ? (me.name || me.email) + ' · ' + (ROLE[me.role] || ROLE.user).label : 'Google bilan kirish');
    b.setAttribute('aria-label', b.getAttribute('data-tip'));
    b.innerHTML = me ? avatar(me, 'sd-av') + '<i class="sd-rd r-' + esc(me.role) + '"></i>' : ICON_USER;
    return true;
  }

  /* ---------------- Qo'lyozma bo'limiga qo'shiladigan tugmalar (services.js chaqiradi) ---------------- */
  function mountHand(el) {
    if (!el || mounts.indexOf(el) >= 0) return; mounts.push(el);
    el.innerHTML = '<div class="bxa-hand"><div class="bxa-hrow" data-hbtns></div><div class="bxa-hst" data-hst></div>' +
      '<input type="file" data-imp accept=".json,application/json" hidden></div>';
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-h]'); if (!t) return; var a = t.getAttribute('data-h');
      if (a === 'file') exportFile(); else if (a === 'imp') $('[data-imp]', el).click();
      else if (a === 'login') signIn(); else if (a === 'save') driveAction('save'); else if (a === 'load') driveAction('load'); else if (a === 'drive') connectDrive();
    });
    $('[data-imp]', el).addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
    renderHands();
  }
  function renderHands() {
    mounts.forEach(function (el) {
      var bt = $('[data-hbtns]', el), st = $('[data-hst]', el); if (!bt) return;
      var b = '<button type="button" class="sv-btn" data-h="file">💾 Faylga saqlash</button><button type="button" class="sv-btn" data-h="imp">📂 Import</button>';
      if (cfg.enabled || me) {
        if (!me) b += '<button type="button" class="sv-btn pri" data-h="login">' + gLogo() + 'Google bilan kirish</button>';
        else if (ls(K.driveOk) === '1') b += '<button type="button" class="sv-btn pri" data-h="save">☁️ Drive’ga saqlash</button><button type="button" class="sv-btn" data-h="load">⬇️ Drive’dan olish</button>';
        else b += '<button type="button" class="sv-btn pri" data-h="drive">☁️ Google Drive ulash</button>';
      }
      bt.innerHTML = b;
      st.innerHTML = me ? '<span class="bxa-in">' + avatar(me, 'bxa-av sm') + esc(me.email) + '</span> ' + driveLine()
        : (cfg.enabled ? 'Google bilan kirsangiz, qo‘lyozmangiz hisobingizda saqlanadi va keyingi safar avtomatik yuklanadi. Hozir faqat shu qurilmada.' : 'Qo‘lyozma hozir faqat shu qurilmada saqlanadi. “Faylga saqlash” bilan nusxa oling.');
    });
  }
  function exportFile() {
    var g = localGlyphs(); if (!count(g)) return toast('Hali birorta harf yozilmagan');
    var a = document.createElement('a'), u = URL.createObjectURL(new Blob([payload(g)], { type: 'application/json' }));
    a.href = u; a.download = 'qolyozma-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    toast('✔ Qo‘lyozma fayli yuklab olindi (' + count(g) + ' ta belgi)');
  }
  function importFile(f) {
    if (f.size > 3 * 1024 * 1024) return toast('Fayl juda katta (3 MB dan oshmasin)');
    var rd = new FileReader();
    rd.onload = function () {
      var d; try { d = JSON.parse(String(rd.result)); } catch (e) { return toast('❌ Bu qo‘lyozma fayli emas (JSON o‘qilmadi)', 4500); }
      var g = cleanGlyphs(d && d.glyphs ? d.glyphs : d);
      if (!count(g)) return toast('❌ Faylda qo‘lyozma harflari topilmadi', 4500);
      var cur = localGlyphs(), next = g;
      if (count(cur)) { next = confirm('Qurilmada ' + count(cur) + ' ta belgi bor, faylda ' + count(g) + ' ta.\n\nOK — fayl bilan almashtirish\nBekor — faqat yetishmagan harflarni qo‘shish') ? g : merge(cur, g); }
      window.BirlashHand.set(next); window.BirlashAuth.glyphsChanged();
      toast('✔ Import qilindi: ' + count(next) + ' ta belgi', 3200);
    };
    rd.readAsText(f);
  }

  function renderAll() { renderDock(); renderHands(); renderRoot(); }

  function glyphsChanged() {
    if (!me) return; ls(K.owner, me.id); ls(K.dirty, '1');
    if (ls(K.driveOk) !== '1') return;
    clearTimeout(autoT); setState('busy', 'O‘zgarishlar Drive’ga saqlanadi…'); autoT = setTimeout(autoPush, 2500);
  }
  window.BirlashAuth = { glyphsChanged: glyphsChanged, mountHand: mountHand, open: openRoot, get user() { return me; } };

  /* ---------------- ishga tushirish ---------------- */
  function init() {
    var tries = 0; (function dock() { if (!renderDock() && tries++ < 25) setTimeout(dock, 300); })();
    fetch('/api/auth/config', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) {
      cfg = { enabled: !!c.enabled, clientId: String(c.clientId || '') }; renderAll();
      if (cfg.enabled) loadGsi().then(function () { gsiReady = true; }).catch(function () {});
      if (sess && cfg.enabled) {                   // sessiya hali yaroqlimi, rol o'zgarmaganmi
        api('/api/auth/me').then(function (v) {
          if (v._status === 401) { ls(K.sess, null); ls(K.user, null); sess = ''; me = null; renderAll(); return; }
          if (v.ok) { setUser(v); renderAll(); var go = function () { applyCenter(v, false); }; if (window.CENTER_SET) go(); else window.addEventListener('load', go); }
        }).catch(function () {});
      }
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
