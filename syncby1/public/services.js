/* Birlash Services: o'ng chetdagi ikonkali dock
   - palitra ikonkasi: sayt rangi va orqa fonini almashtiradi
   - to'rt kvadrat ikonkasi: vositalar oynasi (JPG→PDF, PDF yaratish, qo'lyozma A4)
   Hammasi brauzerda ishlaydi, serverga hech narsa yuborilmaydi. app.js ga tegmaydi. */
(function () {
  'use strict';

  var ICON = {
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 2.1-.9 2.1-1.9 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.3-4-7.7-9-7.7z"/><circle cx="7.6" cy="11" r="1"/><circle cx="10.2" cy="7.2" r="1"/><circle cx="15" cy="7.2" r="1"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    down: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
    up: '<path d="M12 16V5"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>'
  };
  function svg(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>'; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

  /* ===================== 1. SAYT MAVZUSI (rang + orqa fon) ===================== */
  var SKINS = [
    { name: 'Asosiy', bg: '#0b1020', card: '#151d30', pri: '#6d83f7', pri2: '#8d79f4', cy: '#77e3d3', sk2: '81,218,192' },
    { name: 'Okean',   bg: '#06141f', card: '#0e2433', pri: '#19b5fe', pri2: '#4a7dff', cy: '#5ef0ff', sk2: '0,209,178' },
    { name: 'Binafsha', bg: '#130b22', card: '#211436', pri: '#a855f7', pri2: '#ec4899', cy: '#f0abfc', sk2: '244,114,182' },
    { name: 'Zumrad',  bg: '#06160f', card: '#0f2a1d', pri: '#10b981', pri2: '#84cc16', cy: '#6ee7b7', sk2: '34,211,238' },
    { name: 'Quyosh',  bg: '#1a0e08', card: '#2b1810', pri: '#f97316', pri2: '#ef4444', cy: '#fbbf24', sk2: '245,158,11' },
    { name: 'Qora',    bg: '#000000', card: '#0d0d12', pri: '#8b8bff', pri2: '#6366f1', cy: '#9be7ff', sk2: '120,120,255' }
  ];
  var skinIdx = 0, flip = false;
  function hexHsl(hex) {
    var n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) { s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return [h, s, l];
  }
  function hslHex(h, s, l) {
    h = ((h % 360) + 360) % 360; var a = s * Math.min(l, 1 - l);
    function f(n) { var k = (n + h / 30) % 12, c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); }
    return '#' + f(0) + f(8) + f(4);
  }
  function rot180(hex) { var c = hexHsl(hex); return hslHex(c[0] + 180, c[1], c[2]); }
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', '); }
  function applySkin(i) {
    var root = document.documentElement, s0 = SKINS[i] || SKINS[0], s = s0, st = root.style;
    var keys = ['--bg', '--card', '--glass', '--pri', '--pri2', '--cy', '--pri-rgb', '--pri2-rgb', '--sk2-rgb'];
    if (flip) {
      var sk = s0.sk2.split(',').map(Number), sh = rot180('#' + sk.map(function (v) { return v.toString(16).padStart(2, '0'); }).join(''));
      s = { name: s0.name, bg: rot180(s0.bg), card: rot180(s0.card), pri: rot180(s0.pri), pri2: rot180(s0.pri2), cy: rot180(s0.cy), sk2: rgb(sh) };
    }
    if (i === 0 && !flip) { keys.forEach(function (k) { st.removeProperty(k); }); root.removeAttribute('data-skin'); }
    else {
      root.setAttribute('data-skin', String(i));
      st.setProperty('--bg', s.bg); st.setProperty('--card', s.card); st.setProperty('--glass', s.card);
      st.setProperty('--pri', s.pri); st.setProperty('--pri2', s.pri2); st.setProperty('--cy', s.cy);
      st.setProperty('--pri-rgb', rgb(s.pri)); st.setProperty('--pri2-rgb', rgb(s.pri2)); st.setProperty('--sk2-rgb', s.sk2);
    }
    var m = $('meta[name="theme-color"]'); if (m) m.setAttribute('content', i === 0 ? '#0b0e1a' : s.bg);
    var b = $('#bxMode'); if (b) { b.title = 'Rang va fon: ' + s.name; b.setAttribute('aria-label', 'Sayt rangi va fonini almashtirish. Hozir: ' + s.name); b.setAttribute('data-skin-i', String(i)); }
  }
  var toastT;
  function pill(text) {
    var t = $('#svcToast');
    if (!t) { t = document.createElement('div'); t.id = 'svcToast'; document.body.appendChild(t); }
    t.textContent = text; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 1400);
  }
  function nextSkin() {
    skinIdx = (skinIdx + 1) % SKINS.length; applySkin(skinIdx); store('birlashSkin', String(skinIdx));
    var b = $('#bxMode'); if (b) b.classList.toggle('spin');
    pill(SKINS[skinIdx].name + (flip ? ' · 180°' : ''));
  }

  /* ===================== PDF yozuvchi (tashqi kutubxonasiz) ===================== */
  var A4W = 595.28, A4H = 841.89;
  function canvasJpeg(c, q) {
    return new Promise(function (res) { c.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }); }, 'image/jpeg', q); });
  }
  // pages: [{jpg:Uint8Array, iw, ih, pw, ph, x, y, w, h}]  (o'lchamlar pt da)
  function makePdf(pages) {
    var enc = new TextEncoder(), parts = [], len = 0, offs = [];
    function push(d) { var u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; }
    function obj(n, body, stream) {
      offs[n] = len; push(n + ' 0 obj\n' + body);
      if (stream) { push('\nstream\n'); push(stream); push('\nendstream'); }
      push('\nendobj\n');
    }
    var f = function (v) { return v.toFixed(2); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    var kids = pages.map(function (_, i) { return (3 + i * 3) + ' 0 R'; }).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
    pages.forEach(function (p, i) {
      var pn = 3 + i * 3, cn = pn + 1, im = pn + 2;
      var content = 'q ' + f(p.w) + ' 0 0 ' + f(p.h) + ' ' + f(p.x) + ' ' + f(p.y) + ' cm /Im0 Do Q';
      obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(p.pw) + ' ' + f(p.ph) + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + cn + ' 0 R >>');
      obj(cn, '<< /Length ' + content.length + ' >>', content);
      obj(im, '<< /Type /XObject /Subtype /Image /Width ' + p.iw + ' /Height ' + p.ih + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpg.length + ' >>', p.jpg);
    });
    var total = 3 + pages.length * 3, xref = len;
    var x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var n = 1; n < total; n++) x += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
    push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(parts, { type: 'application/pdf' });
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function stamp() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
  function fullPagePdf(canvases) { /* canvases: [{jpg, iw, ih}] -> A4 to'liq sahifa */
    return makePdf(canvases.map(function (c) { return { jpg: c.jpg, iw: c.iw, ih: c.ih, pw: A4W, ph: A4H, x: 0, y: 0, w: A4W, h: A4H }; }));
  }

  /* ===================== umumiy yordamchilar ===================== */
  var PW = 1240, PH = 1754; // A4, ~150 dpi
  function rngOf(seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); return c; }
  function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // matnni so'zlarga bo'lib qatorlarga joylash (uzun so'zlar bo'linadi)
  function wrapPara(ctx, para, maxW, indent) {
    var words = para.trim().split(/\s+/), out = [], cur = [], curW = indent, sp = ctx.measureText(' ').width, first = true;
    function flush() { out.push({ words: cur, indent: first ? indent : 0 }); first = false; cur = []; curW = 0; }
    words.forEach(function (w) {
      var ww = ctx.measureText(w).width;
      if (ww > maxW) {
        if (cur.length) flush();
        var piece = '';
        for (var i = 0; i < w.length; i++) {
          if (ctx.measureText(piece + w[i]).width > maxW && piece) { cur = [piece]; flush(); piece = ''; }
          piece += w[i];
        }
        cur = [piece]; curW = ctx.measureText(piece).width; return;
      }
      var add = (cur.length ? sp : 0) + ww;
      if (cur.length && curW + add > maxW) flush();
      curW += (cur.length ? sp : 0) + ww; cur.push(w);
    });
    if (cur.length) flush();
    return out;
  }
  function indentOf(line, sp) { var m = line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length; return Math.min(m, 12) * sp; }

  /* ===================== 2. PDF YARATISH (matndan) ===================== */
  var TXT = { fonts: { sans: 'Inter, system-ui, "Segoe UI", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, Consolas, "Courier New", monospace' } };
  function txtLayout(o) {
    var c = newCanvas(10, 10), ctx = c.getContext('2d');
    var px = o.pt * 150 / 72, lh = px * 1.5, mx = 120, top = 130, bottom = 140, maxW = PW - mx * 2;
    var items = []; // {t, font, size, y-advance}
    if (o.title.trim()) {
      ctx.font = '700 ' + px * 1.6 + 'px ' + TXT.fonts[o.font];
      wrapPara(ctx, o.title, maxW, 0).forEach(function (l) { items.push({ t: l.words.join(' '), font: '700 ' + px * 1.6 + 'px ' + TXT.fonts[o.font], h: px * 1.6 * 1.35 }); });
      items.push({ t: '', font: '', h: lh * 0.6 });
    }
    ctx.font = px + 'px ' + TXT.fonts[o.font];
    var sp = ctx.measureText(' ').width;
    o.text.replace(/\r/g, '').split('\n').forEach(function (p) {
      if (!p.trim()) { items.push({ t: '', font: '', h: lh }); return; }
      wrapPara(ctx, p, maxW, indentOf(p, sp)).forEach(function (l) { items.push({ t: l.words.join(' '), font: px + 'px ' + TXT.fonts[o.font], x: l.indent, h: lh }); });
    });
    var pages = [[]], y = top;
    items.forEach(function (it) {
      if (y + it.h > PH - bottom && pages[pages.length - 1].length) { pages.push([]); y = top; }
      pages[pages.length - 1].push({ it: it, y: y + it.h * 0.78 }); y += it.h;
    });
    return { pages: pages, mx: mx, px: px, family: TXT.fonts[o.font] };
  }
  function txtDraw(canvas, lay, pi, o, scale) {
    var ctx = canvas.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PW, PH); ctx.fillStyle = '#111'; ctx.textBaseline = 'alphabetic';
    lay.pages[pi].forEach(function (r) { if (!r.it.t) return; ctx.font = r.it.font; ctx.fillText(r.it.t, lay.mx + (r.it.x || 0), r.y); });
    if (o.num) { ctx.font = '400 ' + lay.px * 0.8 + 'px ' + lay.family; ctx.fillStyle = '#777'; ctx.textAlign = 'center'; ctx.fillText(String(pi + 1) + ' / ' + lay.pages.length, PW / 2, PH - 70); ctx.textAlign = 'left'; }
  }

  /* ===================== 3. QO'LYOZMA (A4 daftar sahifasi) ===================== */
  var HWF = [
    { n: 'Caveat', k: 1.02, label: 'Caveat (tez yozuv)' },
    { n: 'Marck Script', k: 0.82, label: 'Marck Script (chiroyli)' },
    { n: 'Bad Script', k: 0.8, label: 'Bad Script (maktab)' },
    { n: 'Neucha', k: 0.86, label: 'Neucha (to‘g‘ri harf)' },
    { n: 'Kalam', k: 0.74, label: 'Kalam (ruchka)' },
    { n: 'Homemade Apple', k: 0.5, label: 'Homemade Apple (keng)' }
  ];
  var fontsLink = false;
  function loadFonts() {
    if (!fontsLink) {
      fontsLink = true;
      var l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500&family=Marck+Script&family=Bad+Script&family=Neucha&family=Kalam:wght@400&family=Homemade+Apple&display=swap';
      document.head.appendChild(l);
    }
    var sample = 'Salom dunyo Привет abc';
    var jobs = HWF.map(function (f) { return document.fonts && document.fonts.load ? document.fonts.load('40px "' + f.n + '"', sample).catch(function () {}) : Promise.resolve(); });
    return Promise.race([Promise.all(jobs), new Promise(function (r) { setTimeout(r, 4500); })]);
  }
  function hwOpts(root) {
    var g = function (k) { return $('[data-k="' + k + '"]', root); };
    var f = HWF[+g('font').value] || HWF[0];
    return {
      text: g('text').value.replace(/[ʻ‘’ʼ]/g, "'"), font: f, ink: g('ink').value, paper: g('paper').value,
      lh: +g('lh').value, size: +g('size').value / 100, mess: +g('mess').value / 100, margin: g('margin').checked, scan: g('scan').checked, seed: +root.getAttribute('data-seed') || 1, mode: root.getAttribute('data-mode') === 'hand' ? 'hand' : 'font'
    };
  }
  function hwStack(f) { return '"' + f.n + '", "Segoe Script", "Bradley Hand", "Comic Sans MS", cursive'; }

  /* ---- O'z qo'lyozmam: harflarni chizib saqlash ---- */
  var GL = {}; try { GL = JSON.parse(store('birlashGlyphs') || '{}') || {}; } catch (e) { GL = {}; }
  function saveGL(quiet) { store('birlashGlyphs', JSON.stringify(GL)); if (quiet !== true && window.BirlashAuth) { try { window.BirlashAuth.glyphsChanged(); } catch (e) {} } }
  // Google hisob (auth.js) qo'lyozmani shu orqali o'qiydi/almashtiradi
  window.BirlashHand = { get: function () { return GL; }, set: function (o) { GL = (o && typeof o === 'object') ? o : {}; saveGL(true); document.dispatchEvent(new CustomEvent('birlash:glyphs')); } };
  var PAD = { w: 300, h: 300, cap: 50, xh: 120, base: 190, desc: 260 };
  function glyphFor(ch, form) {
    var g = GL[ch]; if (!g) return null;
    var s = g[form]; if (s && s.length) return s;
    s = g.a; if (s && s.length) return s;
    return (g.m && g.m.length) ? g.m : ((g.e && g.e.length) ? g.e : null);
  }
  function bboxOf(st) {
    var a = 1e9, b = -1e9;
    st.forEach(function (s) { for (var i = 0; i < s.length; i += 2) { if (s[i] < a) a = s[i]; if (s[i] > b) b = s[i]; } });
    return { a: a, b: b };
  }
  function formAt(word, i) { return word.length === 1 || i === 0 ? 'a' : (i === word.length - 1 ? 'e' : 'm'); }
  function handWidth(word, px, real) {
    if (word === ' ') return px * 0.34;
    var sc = px / 165, w = 0;
    for (var i = 0; i < word.length; i++) {
      var g = glyphFor(word[i], formAt(word, i));
      if (g) { var bb = bboxOf(g); w += (bb.b - bb.a + 10) * sc; } else w += real.measureText(word[i]).width;
    }
    return w;
  }
  function strokePath(ctx, s) {
    if (s.length < 4) { ctx.beginPath(); ctx.arc(s[0], s[1], ctx.lineWidth * 0.55, 0, 6.3); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(s[0], s[1]);
    for (var i = 2; i < s.length - 2; i += 2) ctx.quadraticCurveTo(s[i], s[i + 1], (s[i] + s[i + 2]) / 2, (s[i + 1] + s[i + 3]) / 2);
    ctx.lineTo(s[s.length - 2], s[s.length - 1]); ctx.stroke();
  }
  function drawHandWord(ctx, word, px, o, rng) {
    var sc = px / 165, x = 0, m = o.mess;
    ctx.strokeStyle = o.ink; ctx.fillStyle = o.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < word.length; i++) {
      var ch = word[i], g = glyphFor(ch, formAt(word, i));
      if (g) {
        var bb = bboxOf(g), k = 1 + (rng() - .5) * 0.1 * m;
        ctx.save(); ctx.translate(x, (rng() - .5) * 3 * m); ctx.rotate((rng() - .5) * 0.07 * m);
        ctx.scale(sc * k, sc * k); ctx.translate(-bb.a, -PAD.base); ctx.lineWidth = 5.2;
        g.forEach(function (s) { strokePath(ctx, s); });
        ctx.restore(); x += (bb.b - bb.a + 10 + (rng() - .5) * 5 * m) * sc;
      } else {
        ctx.font = px + 'px ' + hwStack(o.font); ctx.fillText(ch, x, 0); x += ctx.measureText(ch).width;
      }
    }
    return x;
  }
  var HWG = { top: 170, bottom: 120, mL: 190, mR: 90 };
  function hwLayout(o) {
    var c = newCanvas(10, 10), ctx = c.getContext('2d'), px = o.lh * o.font.k * o.size;
    ctx.font = px + 'px ' + hwStack(o.font);
    var real = ctx, hand = o.mode === 'hand';
    if (hand) ctx = { font: '', measureText: function (t) { return { width: handWidth(t, px, real) }; } };
    var sp = hand ? px * 0.34 : ctx.measureText(' ').width, maxW = PW - HWG.mL - HWG.mR, lines = [];
    o.text.replace(/\r/g, '').split('\n').forEach(function (p) {
      if (!p.trim()) { lines.push(null); return; }
      wrapPara(ctx, p, maxW, indentOf(p, sp)).forEach(function (l) { lines.push(l); });
    });
    var per = Math.max(1, Math.floor((PH - HWG.top - HWG.bottom) / o.lh)), pages = [];
    for (var i = 0; i < lines.length; i += per) pages.push(lines.slice(i, i + per));
    if (!pages.length) pages.push([]);
    return { pages: pages, px: px, sp: sp, per: per, truncated: pages.length > 25 };
  }
  function hwDraw(canvas, lay, pi, o, scale) {
    var ctx = canvas.getContext('2d'), rng = rngOf(o.seed * 7919 + pi * 104729), M = HWG;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // qog'oz
    ctx.fillStyle = '#fdfcf7'; ctx.fillRect(0, 0, PW, PH);
    var lastY = M.top + lay.per * o.lh;
    if (o.paper === 'lines' || o.paper === 'dashed') {
      ctx.strokeStyle = 'rgba(95,135,200,.5)'; ctx.lineWidth = 1.6; ctx.setLineDash(o.paper === 'dashed' ? [16, 11] : []);
      for (var k = 1; k <= lay.per + 1; k++) { var y = M.top + k * o.lh; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PW, y); ctx.stroke(); }
      ctx.setLineDash([]);
    } else if (o.paper === 'dots') {
      ctx.fillStyle = 'rgba(95,135,200,.55)'; var ds = o.lh / 2;
      for (var dy2 = (M.top % ds); dy2 < PH; dy2 += ds) for (var dx2 = (M.mL % ds); dx2 < PW; dx2 += ds) { ctx.beginPath(); ctx.arc(dx2, dy2, 1.7, 0, 6.3); ctx.fill(); }
    } else if (o.paper === 'grid') {
      ctx.strokeStyle = 'rgba(95,135,200,.32)'; ctx.lineWidth = 1.2; var st = o.lh / 2;
      for (var gx = (M.mL % st); gx < PW; gx += st) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, PH); ctx.stroke(); }
      for (var gy = (M.top % st); gy < PH; gy += st) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(PW, gy); ctx.stroke(); }
    }
    if (o.margin && o.paper !== 'blank' && o.paper !== 'dots') {
      ctx.strokeStyle = 'rgba(225,80,80,.6)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(M.mL - 38, 0); ctx.lineTo(M.mL - 38, PH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PW - 55, 0); ctx.lineTo(PW - 55, PH); ctx.stroke();
    }
    // matn: har so'z biroz boshqacha (qiyshiq, past-baland, o'lchami)
    var m = o.mess, slopeMax = 0.012 * m;
    ctx.fillStyle = o.ink; ctx.textBaseline = 'alphabetic';
    lay.pages[pi].forEach(function (line, li) {
      if (!line) return;
      var base = M.top + (li + 1) * o.lh - 7 + (rng() - .5) * 3 * m;
      var x = M.mL + line.indent + (rng() - .5) * 10 * m, slope = (rng() - .5) * 2 * slopeMax;
      var x0 = x;
      line.words.forEach(function (w) {
        var sz = lay.px * (1 + (rng() - .5) * 0.12 * m), ww, dy = (rng() - .5) * 5 * m + slope * (x - x0) * 1;
        ctx.save(); ctx.globalAlpha = 0.86 + rng() * 0.13;
        ctx.translate(x, base + dy); ctx.rotate((rng() - .5) * 0.045 * m + slope);
        if (o.mode === 'hand') { ww = drawHandWord(ctx, w, sz, o, rng); }
        else { ctx.font = sz + 'px ' + hwStack(o.font); ww = ctx.measureText(w).width; ctx.fillText(w, 0, 0); }
        ctx.restore();
        x += ww + lay.sp * (0.9 + rng() * 0.45 * (0.4 + m));
      });
    });
    // skaner / yorug'lik effekti
    if (o.scan) {
      var vg = ctx.createRadialGradient(PW / 2, PH / 2, PH * 0.35, PW / 2, PH / 2, PH * 0.75);
      vg.addColorStop(0, 'rgba(255,240,200,0)'); vg.addColorStop(1, 'rgba(120,90,30,.16)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, PW, PH);
      var sh = ctx.createLinearGradient(0, 0, PW, 0); sh.addColorStop(0, 'rgba(0,0,0,.05)'); sh.addColorStop(.05, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh; ctx.fillRect(0, 0, PW, PH);
      ctx.fillStyle = 'rgba(90,70,40,.07)';
      for (var i = 0; i < 2600; i++) { var s = rng() * 1.8 + .3; ctx.fillRect(rng() * PW, rng() * PH, s, s); }
    }
  }

  /* ===================== OYNA ===================== */
  var root, lastFocus, tab = 'img';
  var files = [];
  var hw = { token: 0, lay: null, opts: null }, tx = { token: 0, lay: null, opts: null };

  var TABS = [['img', 'image', 'JPG → PDF'], ['txt', 'file', 'PDF yaratish'], ['pen', 'pen', 'Qo‘lyozma A4']];

  function build() {
    if (root) return;
    root = document.createElement('div'); root.id = 'svcRoot';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Birlash Services');
    var tabs = TABS.map(function (t, i) { return '<button role="tab" data-t="' + t[0] + '" aria-selected="' + (i === 0) + '">' + svg(t[1]) + t[2] + '</button>'; }).join('');
    var fontOpts = HWF.map(function (f, i) { return '<option value="' + i + '">' + esc(f.label) + '</option>'; }).join('');
    root.innerHTML =
      '<div class="sv-bg"></div><div class="sv-box">' +
      '<div class="sv-head"><span class="sv-logo"><svg viewBox="0 0 24 24">' + ICON.grid + '</svg></span><div><h2>Birlash Services</h2><p>Hujjat vositalari. Hammasi qurilmangizda ishlaydi, fayllar serverga yuborilmaydi.</p></div><div class="sv-design" data-design><button type="button" data-dz="modern">Yangi</button><button type="button" data-dz="standard">V1</button><button type="button" data-flip title="Dizayn rangini 180° buring">180°</button></div><button class="sv-x" aria-label="Yopish">✕</button></div>' +
      '<div class="sv-tabs" role="tablist">' + tabs + '</div><div class="sv-body">' +

      /* --- JPG → PDF --- */
      '<section data-s="img" class="on">' +
      '<label class="sv-drop" data-drop><svg viewBox="0 0 24 24">' + ICON.up + '</svg><b>Rasmlarni tanlang yoki shu yerga tashlang</b>JPG, PNG, WEBP · bir nechtasini birdan</label>' +
      '<input type="file" data-k="files" accept="image/*" multiple hidden>' +
      '<ul class="sv-list" data-list></ul>' +
      '<div class="sv-row" style="margin-top:14px">' +
      '<label>Sahifa o‘lchami<select data-k="size"><option value="a4">A4</option><option value="orig">Rasm o‘lchamida</option></select></label>' +
      '<label>Yo‘nalish (A4)<select data-k="orient"><option value="auto">Avtomatik</option><option value="p">Tik</option><option value="l">Yotiq</option></select></label>' +
      '<label>Chekka bo‘sh joy<select data-k="mar"><option value="0">Yo‘q</option><option value="28" selected>10 mm</option><option value="57">20 mm</option></select></label>' +
      '<label>Sifat<select data-k="q"><option value="0.95">Yuqori</option><option value="0.85" selected>O‘rtacha</option><option value="0.7">Kichik fayl</option></select></label></div>' +
      '<div class="sv-actions"><button class="sv-btn pri" data-go="img" disabled>' + svg('down') + 'PDF yaratish</button><button class="sv-btn" data-clear>Tozalash</button></div>' +
      '<div class="sv-busy" data-busy="img"></div></section>' +

      /* --- PDF yaratish --- */
      '<section data-s="txt"><div class="sv-row">' +
      '<label style="flex:3 1 260px">Sarlavha (ixtiyoriy)<input type="text" data-k="title" placeholder="Masalan: Dars konspekti"></label>' +
      '<label>Shrift<select data-k="font"><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option></select></label>' +
      '<label>Hajmi<select data-k="pt"><option>10</option><option>11</option><option selected>12</option><option>14</option><option>16</option></select></label>' +
      '<label style="flex:0 0 auto;min-width:0;flex-direction:row;align-items:center;gap:8px;padding-bottom:10px"><input type="checkbox" data-k="num" checked> Sahifa raqami</label></div>' +
      '<textarea data-k="text" placeholder="Matnni shu yerga yozing yoki qo‘ying. PDF avtomatik A4 sahifalarga bo‘linadi."></textarea>' +
      '<div class="sv-actions"><button class="sv-btn pri" data-go="txt">' + svg('down') + 'PDF yuklab olish</button><span class="sv-note" data-info="txt" style="margin:0"></span></div>' +
      '<div class="sv-busy" data-busy="txt"></div><div class="sv-pages" data-pages="txt"></div></section>' +

      /* --- Qo'lyozma --- */
      '<section data-s="pen" data-seed="1" data-mode="font">' +
      '<div class="sv-seg" data-modeseg><button type="button" data-mode="font" class="on">Standart shrift</button><button type="button" data-mode="hand">Mening qo‘lyozmam</button></div>' +
      '<div class="sv-hand" data-hand hidden><p class="sv-note" style="margin:0 0 10px">Har bir harfni quyidagi maydonda o‘zingiz yozing. Katta <b>A</b> va kichik <b>a</b> alohida. “O‘rtada” va “Oxirida” shakllari ixtiyoriy: yozmasangiz asosiy shakl ishlatiladi. Chizilmagan belgilar shrift bilan to‘ldiriladi.</p>' +
      '<div class="sv-hgrid"><div class="sv-hl"><div class="sv-cur">Belgi: <b data-cur>A</b></div><div class="sv-pad"><canvas data-pad width="300" height="300"></canvas></div>' +
      '<div class="sv-forms" data-forms><button type="button" data-f="a" class="on">Asosiy</button><button type="button" data-f="m">So‘z o‘rtasida</button><button type="button" data-f="e">So‘z oxirida</button></div>' +
      '<div class="sv-actions" style="margin-top:8px"><button type="button" class="sv-btn" data-undo>Ortga</button><button type="button" class="sv-btn" data-clr>Tozalash</button><button type="button" class="sv-btn pri" data-nxt>Keyingisi →</button></div></div>' +
      '<div class="sv-chars" data-chars></div></div><div class="sv-cloud" data-cloud></div></div>' +
      '<textarea data-k="text" placeholder="Oddiy kompyuter yozuvini shu yerga yozing. Uni A4 daftar sahifasida ruchka bilan yozilgandek qilib beramiz."></textarea>' +
      '<div class="sv-row" style="margin-top:12px">' +
      '<label>Yozuv uslubi<select data-k="font">' + fontOpts + '</select></label>' +
      '<label>Qog‘oz<select data-k="paper"><option value="lines">Chiziqli daftar</option><option value="dashed">Uzuq chiziqli daftar</option><option value="grid">Katakli daftar</option><option value="dots">Nuqtali daftar</option><option value="blank">Oq A4 varaq</option></select></label>' +
      '<label>Ruchka rangi<input type="color" data-k="ink" value="#1c3d9e"></label>' +
      '<label>Qator oralig‘i<input type="range" data-k="lh" min="46" max="90" value="60"></label>' +
      '<label>Harf kattaligi<input type="range" data-k="size" min="70" max="130" value="100"></label>' +
      '<label>Tartibsizlik<input type="range" data-k="mess" min="0" max="100" value="55"></label></div>' +
      '<div class="sv-row" style="margin-bottom:0"><label style="flex:0 0 auto;min-width:0;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-k="margin" checked> Hoshiya chizig‘i</label>' +
      '<label style="flex:0 0 auto;min-width:0;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-k="scan" checked> Skaner effekti</label></div>' +
      '<div class="sv-actions"><button class="sv-btn pri" data-go="pen">' + svg('down') + 'PDF yuklab olish</button><button class="sv-btn" data-reseed>' + svg('dice') + 'Boshqacha yozish</button><span class="sv-note" data-info="pen" style="margin:0"></span></div>' +
      '<div class="sv-busy" data-busy="pen"></div><div class="sv-pages" data-pages="pen"></div></section>' +
      '</div></div>';
    document.body.appendChild(root);

    $('.sv-bg', root).addEventListener('click', close);
    $('.sv-x', root).addEventListener('click', close);
    $('.sv-tabs', root).addEventListener('click', function (e) { var b = e.target.closest('button[data-t]'); if (b) show(b.getAttribute('data-t')); });
    wireImg(); wireTxt(); wirePen(); wireDesign();
  }
  function curMode() { return (store('bx_mode') === 'standard') ? 'standard' : 'modern'; }
  function syncDesign() {
    if (!root) return; var m = curMode();
    $$('[data-dz]', root).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-dz') === m); });
    $('[data-flip]', root).classList.toggle('on', flip);
  }
  function wireDesign() {
    $('[data-design]', root).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-flip')) { flip = !flip; store('birlashFlip', flip ? '1' : '0'); applySkin(skinIdx); pill(flip ? '180°' : 'Asl rang'); }
      else { var m = b.getAttribute('data-dz'); document.body.classList.toggle('bx-modern', m === 'modern'); store('bx_mode', m); pill(m === 'modern' ? 'Yangi dizayn' : 'V1 dizayn'); }
      syncDesign();
    });
  }
  function show(id) {
    tab = id;
    $$('.sv-tabs button', root).forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-t') === id)); });
    $$('.sv-body section', root).forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-s') === id); });
    $('.sv-body', root).scrollTop = 0;
    if (id === 'pen') renderPen(); if (id === 'txt') renderTxt();
  }
  function open(t) {
    build(); lastFocus = document.activeElement; root.classList.add('on'); document.documentElement.style.overflow = 'hidden';
    syncDesign(); show(t || tab); $('.sv-x', root).focus();
  }
  function close() {
    if (!root) return; root.classList.remove('on'); document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && root.classList.contains('on')) close(); });

  /* ---- JPG → PDF ---- */
  function loadImage(file) {
    if (window.createImageBitmap) { try { return createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {} }
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  function wireImg() {
    var sec = $('[data-s="img"]', root), input = $('[data-k="files"]', sec), list = $('[data-list]', sec), go = $('[data-go="img"]', sec), busy = $('[data-busy="img"]', sec), drop = $('[data-drop]', sec);
    drop.addEventListener('click', function (e) { e.preventDefault(); input.click(); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { add(e.dataTransfer.files); });
    input.addEventListener('change', function () { add(input.files); input.value = ''; });
    function add(fl) {
      Array.prototype.forEach.call(fl, function (f) { if (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)) files.push({ file: f, url: URL.createObjectURL(f) }); });
      draw();
    }
    function draw() {
      list.innerHTML = files.map(function (it, i) {
        return '<li><img src="' + it.url + '" alt=""><div class="tb"><button data-mv="-1" data-i="' + i + '" aria-label="Oldinga">◀</button><button data-mv="1" data-i="' + i + '" aria-label="Orqaga">▶</button><button class="rm" data-rm="' + i + '" aria-label="O‘chirish">✕</button></div><span class="no">' + (i + 1) + '</span><div class="nm">' + esc(it.file.name) + '</div></li>';
      }).join('');
      go.disabled = !files.length;
    }
    list.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-rm')) { var r = files.splice(+b.getAttribute('data-rm'), 1)[0]; URL.revokeObjectURL(r.url); }
      else if (b.hasAttribute('data-mv')) { var i = +b.getAttribute('data-i'), j = i + +b.getAttribute('data-mv'); if (j >= 0 && j < files.length) { var t = files[i]; files[i] = files[j]; files[j] = t; } }
      draw();
    });
    $('[data-clear]', sec).addEventListener('click', function () { files.forEach(function (f) { URL.revokeObjectURL(f.url); }); files = []; draw(); busy.textContent = ''; });
    go.addEventListener('click', async function () {
      var g = function (k) { return $('[data-k="' + k + '"]', sec).value; };
      var size = g('size'), orient = g('orient'), mar = +g('mar'), q = +g('q');
      go.disabled = true; var pages = [];
      try {
        for (var i = 0; i < files.length; i++) {
          busy.textContent = 'Tayyorlanmoqda: ' + (i + 1) + ' / ' + files.length;
          var im = await loadImage(files[i].file), iw = im.width || im.naturalWidth, ih = im.height || im.naturalHeight;
          var k = Math.min(1, 3300 / Math.max(iw, ih)), cw = Math.round(iw * k), ch = Math.round(ih * k);
          var c = newCanvas(cw, ch), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.drawImage(im, 0, 0, cw, ch);
          if (im.close) im.close();
          var jpg = await canvasJpeg(c, q), pg;
          if (size === 'orig') { var w = iw * 0.75, h = ih * 0.75; pg = { jpg: jpg, iw: cw, ih: ch, pw: w, ph: h, x: 0, y: 0, w: w, h: h }; }
          else {
            var land = orient === 'l' || (orient === 'auto' && iw > ih), pw = land ? A4H : A4W, ph = land ? A4W : A4H;
            var s = Math.min((pw - mar * 2) / iw, (ph - mar * 2) / ih), w2 = iw * s, h2 = ih * s;
            pg = { jpg: jpg, iw: cw, ih: ch, pw: pw, ph: ph, x: (pw - w2) / 2, y: (ph - h2) / 2, w: w2, h: h2 };
          }
          pages.push(pg);
        }
        saveBlob(makePdf(pages), 'birlash-' + stamp() + '.pdf'); busy.textContent = 'Tayyor: ' + pages.length + ' sahifali PDF yuklab olindi.';
      } catch (err) { busy.textContent = 'Xatolik: rasmni o‘qib bo‘lmadi (' + (err && err.message || err) + ')'; }
      go.disabled = !files.length;
    });
  }

  /* ---- PDF yaratish (matndan) ---- */
  function txOpts(sec) {
    var g = function (k) { return $('[data-k="' + k + '"]', sec); };
    return { title: g('title').value, text: g('text').value, font: g('font').value, pt: +g('pt').value, num: g('num').checked };
  }
  var renderTxt = debounce(function () {
    if (!root) return; var sec = $('[data-s="txt"]', root), box = $('[data-pages="txt"]', sec), info = $('[data-info="txt"]', sec), go = $('[data-go="txt"]', sec);
    var o = txOpts(sec), has = o.text.trim() || o.title.trim(); go.disabled = !has;
    if (!has) { box.innerHTML = ''; info.textContent = ''; tx.lay = null; return; }
    var lay = txLayoutSafe(o); tx.lay = lay; tx.opts = o;
    var n = lay.pages.length; info.textContent = n + ' ta A4 sahifa';
    if (tab !== 'txt') return;
    box.innerHTML = '';
    lay.pages.slice(0, 12).forEach(function (_, i) {
      var f = document.createElement('figure'), c = newCanvas(PW * .45, PH * .45); txtDraw(c, lay, i, o, .45);
      f.appendChild(c); var cap = document.createElement('figcaption'); cap.textContent = (i + 1) + '-sahifa'; f.appendChild(cap); box.appendChild(f);
    });
    if (n > 12) { var m = document.createElement('p'); m.className = 'sv-note'; m.textContent = 'Ko‘rinishda dastlabki 12 sahifa; PDF da hammasi bo‘ladi.'; box.appendChild(m); }
  }, 300);
  function txLayoutSafe(o) { return txtLayout(o); }
  function wireTxt() {
    var sec = $('[data-s="txt"]', root);
    $$('[data-k]', sec).forEach(function (el) { el.addEventListener('input', renderTxt); el.addEventListener('change', renderTxt); });
    $('[data-go="txt"]', sec).addEventListener('click', async function () {
      var busy = $('[data-busy="txt"]', sec), o = txOpts(sec), lay = txtLayout(o), out = [], c = newCanvas(PW, PH);
      for (var i = 0; i < lay.pages.length; i++) { busy.textContent = 'Tayyorlanmoqda: ' + (i + 1) + ' / ' + lay.pages.length; txtDraw(c, lay, i, o, 1); out.push({ jpg: await canvasJpeg(c, .92), iw: PW, ih: PH }); await new Promise(function (r) { setTimeout(r, 0); }); }
      saveBlob(fullPagePdf(out), 'hujjat-' + stamp() + '.pdf'); busy.textContent = 'Tayyor: PDF yuklab olindi.';
    });
  }

  /* ---- Qo'lyozma ---- */
  var renderPen = debounce(async function () {
    if (!root || tab !== 'pen') return;
    var sec = $('[data-s="pen"]', root), box = $('[data-pages="pen"]', sec), info = $('[data-info="pen"]', sec), go = $('[data-go="pen"]', sec), busy = $('[data-busy="pen"]', sec);
    var o = hwOpts(sec), tok = ++hw.token; go.disabled = !o.text.trim();
    if (!o.text.trim()) { box.innerHTML = ''; info.textContent = ''; return; }
    busy.textContent = 'Shrift yuklanmoqda…'; await loadFonts(); if (tok !== hw.token) return; busy.textContent = '';
    var lay = hwLayout(o); hw.lay = lay; hw.opts = o;
    info.textContent = lay.pages.length + ' ta A4 sahifa' + (lay.truncated ? ' (juda uzun: 25 tadan keyingisi PDF ga kirmaydi)' : '');
    box.innerHTML = '';
    lay.pages.slice(0, 8).forEach(function (_, i) {
      var f = document.createElement('figure'), c = newCanvas(PW * .45, PH * .45); hwDraw(c, lay, i, o, .45);
      f.appendChild(c); var cap = document.createElement('figcaption'); cap.innerHTML = (i + 1) + '-sahifa · <a href="#" data-png="' + i + '" style="color:inherit">PNG ↓</a>'; f.appendChild(cap); box.appendChild(f);
    });
    if (lay.pages.length > 8) { var m = document.createElement('p'); m.className = 'sv-note'; m.textContent = 'Ko‘rinishda dastlabki 8 sahifa; PDF da hammasi bo‘ladi.'; box.appendChild(m); }
  }, 350);
  function wireHand(sec) {
    var pad = $('[data-pad]', sec), ctx = pad.getContext('2d'), box = $('[data-chars]', sec), cur = 'A', form = 'a', drawing = null;
    var SETS = [['Katta harflar', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'], ['Kichik harflar', 'abcdefghijklmnopqrstuvwxyz'], ['Raqamlar', '0123456789'], ['Belgilar', ".,!?:;-()\"'"]];
    box.innerHTML = SETS.map(function (st) { return '<h4>' + st[0] + '</h4><div class="sv-cg">' + st[1].split('').map(function (c) { return '<button type="button" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>'; }).join('');
    function strokes() { return (GL[cur] && GL[cur][form]) || []; }
    function marks() {
      $$('[data-c]', box).forEach(function (b) { var g = GL[b.getAttribute('data-c')]; b.classList.toggle('has', !!(g && ((g.a && g.a.length) || (g.m && g.m.length) || (g.e && g.e.length)))); b.classList.toggle('cur', b.getAttribute('data-c') === cur); });
      $$('[data-f]', sec).forEach(function (b) { var g = GL[cur], f = b.getAttribute('data-f'); b.classList.toggle('on', f === form); b.classList.toggle('has', !!(g && g[f] && g[f].length)); });
      $('[data-cur]', sec).textContent = cur;
    }
    function redraw() {
      ctx.clearRect(0, 0, PAD.w, PAD.h); ctx.fillStyle = '#fffdf5'; ctx.fillRect(0, 0, PAD.w, PAD.h);
      function ln(y, c, d) { ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.setLineDash(d || []); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAD.w, y); ctx.stroke(); }
      ln(PAD.cap, 'rgba(90,130,200,.35)', [5, 5]); ln(PAD.xh, 'rgba(90,130,200,.35)', [5, 5]); ln(PAD.base, 'rgba(225,80,80,.7)'); ln(PAD.desc, 'rgba(90,130,200,.3)', [5, 5]); ctx.setLineDash([]);
      ctx.strokeStyle = '#1c3d9e'; ctx.fillStyle = '#1c3d9e'; ctx.lineWidth = 3.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      strokes().forEach(function (s) { strokePath(ctx, s); });
    }
    function setSel(c, f) { cur = c; if (f) form = f; marks(); redraw(); }
    function changed() { saveGL(); marks(); renderPen(); }
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-c]'); if (b) setSel(b.getAttribute('data-c'), 'a'); });
    $('[data-forms]', sec).addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (b) setSel(cur, b.getAttribute('data-f')); });
    function pt(e) { var r = pad.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * PAD.w / r.width * 10) / 10, Math.round((e.clientY - r.top) * PAD.h / r.height * 10) / 10]; }
    pad.addEventListener('pointerdown', function (e) {
      e.preventDefault(); pad.setPointerCapture(e.pointerId); var p = pt(e); drawing = p.slice();
      GL[cur] = GL[cur] || {}; GL[cur][form] = GL[cur][form] || []; GL[cur][form].push(drawing); redraw();
    });
    pad.addEventListener('pointermove', function (e) {
      if (!drawing) return; var p = pt(e), n = drawing.length;
      if (Math.abs(p[0] - drawing[n - 2]) + Math.abs(p[1] - drawing[n - 1]) < 2) return; drawing.push(p[0], p[1]); redraw();
    });
    function up() { if (!drawing) return; drawing = null; changed(); }
    pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
    $('[data-undo]', sec).addEventListener('click', function () { if (strokes().length) { strokes().pop(); redraw(); changed(); } });
    $('[data-clr]', sec).addEventListener('click', function () { if (GL[cur]) { delete GL[cur][form]; redraw(); changed(); } });
    $('[data-nxt]', sec).addEventListener('click', function () {
      var all = SETS.map(function (s) { return s[1]; }).join(''), i = all.indexOf(cur); setSel(all[(i + 1) % all.length], 'a');
    });
    document.addEventListener('birlash:glyphs', function () { marks(); redraw(); renderPen(); });
    marks(); redraw();
  }
  function wirePen() {
    var sec = $('[data-s="pen"]', root);
    wireHand(sec);
    if (window.BirlashAuth) window.BirlashAuth.mountHand($('[data-cloud]', sec));
    $('[data-modeseg]', sec).addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]'); if (!b) return; var m = b.getAttribute('data-mode');
      sec.setAttribute('data-mode', m); $('[data-hand]', sec).hidden = m !== 'hand';
      $$('[data-modeseg] button', sec).forEach(function (x) { x.classList.toggle('on', x === b); });
      renderPen();
    });
    $$('[data-k]', sec).forEach(function (el) { el.addEventListener('input', renderPen); el.addEventListener('change', renderPen); });
    $('[data-reseed]', sec).addEventListener('click', function () { sec.setAttribute('data-seed', String((+sec.getAttribute('data-seed') || 1) + 1)); renderPen(); });
    $('[data-pages="pen"]', sec).addEventListener('click', function (e) {
      var a = e.target.closest('[data-png]'); if (!a) return; e.preventDefault();
      var i = +a.getAttribute('data-png'), o = hwOpts(sec), lay = hwLayout(o), c = newCanvas(PW, PH); hwDraw(c, lay, i, o, 1);
      c.toBlob(function (b) { saveBlob(b, 'qolyozma-' + (i + 1) + '.png'); }, 'image/png');
    });
    $('[data-go="pen"]', sec).addEventListener('click', async function () {
      var busy = $('[data-busy="pen"]', sec), o = hwOpts(sec); await loadFonts();
      var lay = hwLayout(o), n = Math.min(lay.pages.length, 25), out = [], c = newCanvas(PW, PH);
      for (var i = 0; i < n; i++) { busy.textContent = 'Tayyorlanmoqda: ' + (i + 1) + ' / ' + n; hwDraw(c, lay, i, o, 1); out.push({ jpg: await canvasJpeg(c, .92), iw: PW, ih: PH }); await new Promise(function (r) { setTimeout(r, 0); }); }
      saveBlob(fullPagePdf(out), 'qolyozma-' + stamp() + '.pdf'); busy.textContent = 'Tayyor: PDF yuklab olindi.';
    });
  }

  /* ===================== DOCK ===================== */
  function inject() {
    if ($('#svcDock')) return;
    var d = document.createElement('div'); d.id = 'svcDock'; d.setAttribute('role', 'toolbar'); d.setAttribute('aria-label', 'Birlash Services');
    d.innerHTML =
      '<button type="button" class="sd-main" data-tip="Birlash Services" aria-label="Birlash Services">' + svg('grid') + '</button>';
    document.body.appendChild(d);
    $('.sd-main', d).addEventListener('click', function () { open(); });
    // sarlavhadagi "Yangi" (dizayn) tugmasi: faqat ikonka, bosilsa sayt rangi va orqa foni almashadi
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('#bxMode'); if (!b) return;
      e.stopImmediatePropagation(); e.preventDefault(); nextSkin();
    }, true);
    flip = store('birlashFlip') === '1';
    var saved = parseInt(store('birlashSkin'), 10); if (saved > 0 && saved < SKINS.length) skinIdx = saved;
    applySkin(skinIdx);
    setTimeout(function () { applySkin(skinIdx); }, 600); // experience.js tugmani keyin chizadi
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject); else inject();
  window.BirlashServices = { open: open, close: close };
})();
