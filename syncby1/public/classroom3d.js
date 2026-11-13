/* 🏫 3D dars xonasi (brauzer tomoni) — v2 "Maruza zali". Server: classroom3d.js. Standart o'chiq — Transmitter sozlamalardan yoqadi.
   Ko'rinishlar: 🪑 o'rindan (POV) · 🎥 umumiy (aylanma) · 🗺 2D reja (Three.js'siz ham ishlaydi).
   Three.js: /lib/three.min.js lokal fayli; yuklanmasa yengil Canvas fallback ishlaydi.
   v2: ustoz uchun balandlik (podium), oynalar + quyosh nurlari, soat, kitob javoni, gilam, yuz/soch/ko'zoynak xilma-xilligi,
       pirpirash/nafas/yozish animatsiyasi, eshikdan kirib o'rinda o'tirish, bo'sh o'rin belgilari (hover), klaviatura bilan qarash. */
(() => {
'use strict';
const BR = () => window.APPBRIDGE;
const SS = () => (BR() ? BR().S() : {});
const isHost = () => !!(BR() && BR().isHost());
const myId = () => SS().myId;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const LOW = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '') || (navigator.hardwareConcurrency || 8) <= 4;
const hash = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (a, h, k = 0) => a[(h >>> k) % a.length];
const SHIRT = [0xe4572e, 0x29b6f6, 0x66bb6a, 0xffca28, 0xab47bc, 0xef5350, 0x26a69a, 0xff7043, 0x5c6bc0, 0xec407a, 0x8d6e63, 0x9ccc65];
const PANTS = [0x2b3a55, 0x3d3d3d, 0x4a4036, 0x1f2f4a, 0x5a5a66];
const TIE = [0xb3261e, 0x1565c0, 0x2e7d32, 0xd9a400, 0x7b1fa2, 0xc2185b];
const UNI_PANTS = [0x23262e, 0x2a2d38, 0x1b1f2a, 0x30333d];
const SKIN = [0xf2c9a0, 0xe0ac80, 0xc68642, 0x8d5524, 0xffdbb0, 0xd9a066];
const HAIR = [0x1b1b1b, 0x3b2a1a, 0x6b4423, 0xc9a227, 0x8a8a8a, 0x2c1e14];
const BOOK = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22, 0x16a085];
const NOTEB = [0xf4f1e6, 0xffe9a8, 0xbfe3ff, 0xffc9d6, 0xd5f0c8];
const DENY = { off: '3D xona o\'chiq', locked: '🔒 O\'rinlar qulflangan', taken: 'Bu o\'rin band', rate: 'Sekinroq yozing', 'whisper-off': 'Shaxsiy xabar o\'chirilgan', blocked: '🚫 Sizga yozish taqiqlangan', gone: 'Bu odam hozir yo\'q' };

// ------------------------------------------------------------------ holat
const C = { cfg: null, st: null, open: false, view: 'pov', viewRole: null, sel: null, mv: false, peer: null, whOpen: false,
  quiz: null, award: null, quizAutoOpened: false, quizCamera: null,
  threads: new Map(), unread: new Map(), names: new Map(), yaw: 0, pitch: 0, oy: 0, op: 0.62, rad: 14, boardRad: 16, boardZoomed: false, zoomed: false, hover: null, idle: 0, proj: false, projBad: '', projZoom: 1 };
let L = null;                 // joylashuv (cols, cap, W, D ...)
let T = null, R = null;       // THREE, sahna
let loadP = null, dom = null, fallback = null;
const boardScreen = document.createElement('video');
boardScreen.muted = true; boardScreen.playsInline = true; boardScreen.autoplay = true;
// Auto zaif qurilmalarda FPSni, Tez rejimi esa render o'lchamini pasaytiradi
const QUALITY = { mode: 'auto', fps: 60, scale: 1, gov: 1, low: false };   // gov — avtomatik piksel zichligi koeffitsienti (0.55..1)
const MAX_PX = 3840 * 2160 * 1.1;                                         // 4K gacha to'liq tiniqlik; undan oshmaydi (GPU/CPU isimasligi uchun)
let ANISO = 4;
function tuneQuality() {
  const low = LOW || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  QUALITY.low = !!low;
  QUALITY.fps = QUALITY.mode === 'low' ? 60 : low ? 30 : 60;
  QUALITY.scale = QUALITY.mode === 'low' ? 0.65 : low ? 0.8 : 1;
  QUALITY.gov = 1;
  if (R) { R.boardKey = ''; if (R.roomG) R.roomG.userData.k = ''; applyDpr(); if (L && C.st) applyScene(); }
}
// Piksel zichligi: doska — maksimal tiniqlik (sahna arzon), umumiy ko'rinishlar — sifat/FPS muvozanati
function applyDpr() {
  if (!R || !dom) return;
  const w = dom.clientWidth || innerWidth, h = dom.clientHeight || innerHeight, dev = window.devicePixelRatio || 1;
  let pr;
  if (C.view === 'board') pr = QUALITY.mode === 'low' ? Math.min(dev, 1.25) : dev;
  else pr = Math.min(dev, QUALITY.low ? 1.25 : QUALITY.mode === 'high' ? 2.5 : 2) * QUALITY.scale * (QUALITY.mode === 'auto' ? QUALITY.gov : 1);
  pr = Math.max(0.5, Math.min(pr, Math.sqrt(MAX_PX / Math.max(1, w * h))));
  if (Math.abs(pr - (R.pr || 0)) > 0.01) { R.pr = pr; R.renderer.setPixelRatio(pr); }
  R.renderer.setSize(w, h, false); R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
  R.dirty = true;
}
// "Barqaror tezlik": kadrlar sekinlashsa piksel zichligi o'zi pasayadi, yengillashsa qaytadi
function governor(dt, t) {
  if (QUALITY.mode !== 'auto' || C.view === 'board') return;
  R.gAcc += dt; R.gN++;
  if (R.gN < 40) return;
  const avg = R.gAcc / R.gN, budget = 1000 / QUALITY.fps; R.gAcc = 0; R.gN = 0;
  if (avg > budget * 1.4 && QUALITY.gov > 0.56 && t - R.gAt > 1500) { QUALITY.gov = Math.max(0.55, QUALITY.gov * 0.85); R.gAt = t; applyDpr(); }
  else if (avg < budget * 1.12 && QUALITY.gov < 1 && t - R.gAt > 6000) { QUALITY.gov = Math.min(1, QUALITY.gov * 1.1); R.gAt = t; applyDpr(); }
}
// Foydalanuvchi harakati: tez chizish rejimini yoqadi (aks holda sahna tinch turganda kam chiziladi)
function poke() { if (R) { R.dirty = true; R.active = performance.now() + 350; } }
function touch() { C.idle = performance.now(); poke(); }

// ------------------------------------------------------------------ joylashuv
const PAIR_W = 2.3, GAP = 1.0, ROW0 = 3.6, ROWD = 1.75, H = 3.4, TP = { x: 1.9, z: 1.3 }, PF = 0.14; // PF — ustoz podiumi balandligi
const tpx = () => Math.min(TP.x, L.W / 2 - 0.9);
function layout(cols, cap) {
  const pairs = cols / 2, rows = cap / cols, totalW = pairs * PAIR_W + (pairs - 1) * GAP;
  return { cols, cap, pairs, rows, totalW, W: totalW + 3.2, D: ROW0 + (rows - 1) * ROWD + 2.4 };
}
function seatPos(i) {
  const r = Math.floor(i / L.cols), c = i % L.cols, p = c >> 1, side = c & 1;
  const cx = -L.totalW / 2 + PAIR_W / 2 + p * (PAIR_W + GAP);
  return { x: cx + (side ? 0.55 : -0.55), z: ROW0 + r * ROWD, r, c, cx };
}
const personAt = s => C.st && C.st.seats.find(e => e.s === s);
const personById = id => C.st && C.st.seats.find(e => e.id === id);
const mySeat = () => { const p = personById(myId()); return p ? p.s : null; };
const hostKey = id => (C.st && C.st.host && id && id === C.st.host.id) ? 'host' : id;

// ------------------------------------------------------------------ yordamchi UI
function toast(msg) {
  if (!dom) return;
  const t = $('.c3-toast', dom); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}
function loadThree() {
  if (window.THREE) return Promise.resolve();
  if (loadP) return loadP;
  return (loadP = new Promise((res, rej) => {
    const s = document.createElement('script');
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { s.remove(); loadP = null; rej(error); }
      else if (window.THREE) res();
      else { loadP = null; rej(new Error('three.js topilmadi')); }
    };
    const timer = setTimeout(() => finish(new Error('three.js yuklanishi vaqtida tugamadi')), 15000);
    s.src = '/lib/three.min.js';
    s.fetchPriority = 'high';
    s.onload = () => finish();
    s.onerror = () => finish(new Error('three.js topilmadi'));
    document.head.appendChild(s);
  }));
}

// ------------------------------------------------------------------ DOM
function buildDom() {
  if (dom) return;
  dom = document.createElement('div');
  dom.id = 'c3'; dom.hidden = true;
  dom.innerHTML = `
    <canvas class="c3-cv"></canvas><canvas class="c3-fb" hidden></canvas>
    <div class="c3-plan" hidden></div>
    <div class="c3-top">
      <div class="c3-title"><b>🏫 Dars xonasi</b><span class="c3-cnt"></span></div>
      <div class="c3-tabs" role="tablist"></div>
      <select class="c3-quality" aria-label="3D grafik sifati"><option value="auto">⚡ Auto</option><option value="low">🚀 Tez (60 FPS)</option><option value="high">✨ Sifat</option></select>
      <button class="c3-x" type="button" aria-label="Yopish">✕</button>
    </div>
    <div class="c3-side"></div>
    <div class="c3-card" hidden></div>
    <div class="c3-bot"></div>
    <div class="c3-wh" hidden>
      <div class="c3-wh-h"><div class="c3-wh-peers"></div><button type="button" class="c3-wh-x" aria-label="Yopish">✕</button></div>
      <div class="c3-wh-note"></div>
      <div class="c3-wh-list"></div>
      <div class="c3-wh-f"><input maxlength="300" placeholder="Shaxsiy xabar…" autocomplete="off" enterkeyhint="send"><button type="button" class="c3-send">➤</button></div>
    </div>
    <div class="c3-load" hidden><div class="c3-spin"></div><span>3D xona yuklanmoqda…</span></div>
    <div class="c3-hint"></div>
    <div class="c3-toast"></div>`;
  document.body.appendChild(dom);
  $('.c3-x', dom).onclick = closeOverlay;
  $('.c3-quality', dom).onchange = e => { QUALITY.mode = e.target.value; tuneQuality(); toast(QUALITY.mode === 'low' ? '🚀 Tezlik rejimi' : QUALITY.mode === 'high' ? '✨ Yuqori sifat' : '⚡ Avtomatik sifat'); };
  $('.c3-wh-x', dom).onclick = () => { C.whOpen = false; renderWh(); };
  const inp = $('.c3-wh-f input', dom);
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendWh(); } e.stopPropagation(); };
  $('.c3-send', dom).onclick = sendWh;
  $('.c3-plan', dom).addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (b) return onSeat(+b.dataset.s);
    if (e.target.closest('[data-teach]')) return openWh('host');
  });
  dom.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    act(b.dataset.act, b.dataset.id, b);
  });
  document.addEventListener('keydown', onKey);
  if (window.ResizeObserver) new ResizeObserver(() => { if (!C.open) return; fit(); syncProj(); }).observe(dom);
  dom.addEventListener('wheel', e => { if (C.proj) { e.preventDefault(); boardZoom(Math.exp(e.deltaY * 0.001)); } }, { passive: false });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && C.open) { poke(); startLoop(); if (fallback) startFallback(); } });
  renderTabs();
}

// klaviatura: Esc — yopish · strelkalar — atrofga qarash · +/- — yaqinlashtirish
function onKey(e) {
  if (!C.open) return;
  if (e.key === 'Escape') return closeOverlay();
  const t = e.target && e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA') return;
  const k = e.key; touch();
  if (C.view === 'pov') {
    if (k === 'ArrowLeft') C.yaw = clamp(C.yaw - 0.12, -1.5, 1.5);
    else if (k === 'ArrowRight') C.yaw = clamp(C.yaw + 0.12, -1.5, 1.5);
    else if (k === 'ArrowUp') C.pitch = clamp(C.pitch + 0.08, -0.55, 0.6);
    else if (k === 'ArrowDown') C.pitch = clamp(C.pitch - 0.08, -0.55, 0.6);
  } else if (C.view === 'board') {
    if (k === '+' || k === '=') boardZoom(0.9);
    else if (k === '-') boardZoom(1.1);
  } else if (C.view === 'orbit') {
    if (k === 'ArrowLeft') C.oy -= 0.12; else if (k === 'ArrowRight') C.oy += 0.12;
    else if (k === 'ArrowUp') C.op = clamp(C.op + 0.06, 0.12, 1.45); else if (k === 'ArrowDown') C.op = clamp(C.op - 0.06, 0.12, 1.45);
    else if (k === '+' || k === '=') { C.rad = clamp(C.rad * 0.9, 4, 45); C.zoomed = true; } else if (k === '-') { C.rad = clamp(C.rad * 1.1, 4, 45); C.zoomed = true; }
  }
}

function renderTabs() {
  const h = isHost();
  const tabs = [['pov', h ? '👨‍🏫 Ustoz' : '🪑 O\'rnimdan'], ['board', '🔎 Doska'], ['orbit', '🎥 Umumiy'], ['plan', '🗺 2D reja']];
  const zoom = C.view === 'board'
    ? '<span class="c3-board-zoom"><button type="button" data-act="board-zoom-out" aria-label="Doskani uzoqlashtirish">−</button><button type="button" data-act="board-zoom-reset" aria-label="Doskani boshlang‘ich ko‘rinishga qaytarish">↺</button><button type="button" data-act="board-zoom-in" aria-label="Doskani yaqinlashtirish">+</button></span>'
    : '';
  $('.c3-tabs', dom).innerHTML = tabs.map(([k, t]) => `<button type="button" role="tab" data-act="view" data-id="${k}" class="${C.view === k ? 'on' : ''}">${t}</button>`).join('') + zoom;
}

// ------------------------------------------------------------------ amallar
function act(a, id) {
  const send = o => BR().send(o);
  switch (a) {
    case 'view': setView(id); break;
    case 'board-zoom-in': boardZoom(0.82); break;
    case 'board-zoom-out': boardZoom(1 / 0.82); break;
    case 'board-zoom-reset': C.boardRad = fitBoardDistance(); C.boardZoomed = false; C.projZoom = 1; syncProj(); poke(); break;
    case 'sel': select(id); break;
    case 'desel': select(null); break;
    case 'wh': openWh(id); break;
    case 'peer': { const nb = neighbors(); if (C.view === 'pov' && nb.me) { if (nb.left && nb.left.id === id) C.yaw = -0.85; else if (nb.right && nb.right.id === id) C.yaw = 0.85; else if (id === 'host') C.yaw = 0; C.pitch = 0; } openWh(id); break; }
    case 'hand': { const me = personById(myId()); send({ type: 'cls-hand', up: !(me && me.h) }); break; }
    case 'hclear': send({ type: 'cls-hand-clear', id }); break;
    case 'block': { const p = personById(id); send({ type: 'cls-block', id, on: !(p && p.b) }); break; }
    case 'mv': C.mv = !C.mv; renderCard(); toast(C.mv ? '🪑 Endi o\'rindiqni bosing — o\'quvchi shu yerga o\'tadi' : 'Bekor qilindi'); break;
    case 'shuffle': send({ type: 'cls-shuffle', mode: 'random' }); toast('🔀 Hamma tasodifiy joylashtirildi'); break;
    case 'sort': send({ type: 'cls-shuffle', mode: 'front' }); toast('🔤 Alifbo tartibida joylashtirildi'); break;
    case 'lock': send({ type: 'cfg', patch: { seatLock: !(C.cfg && C.cfg.seatLock) } }); break;
    case 'whisper': send({ type: 'cfg', patch: { whisper: !(C.cfg && C.cfg.whisper !== false) } }); break;
    case 'reset': C.yaw = 0; C.pitch = 0; C.oy = 0; C.op = 0.62; C.boardRad = fitBoardDistance(); C.boardZoomed = false; C.zoomed = false; fitOrbit(); break;
  }
}

function select(id) {
  C.sel = id || null; C.mv = false;
  renderCard(); renderPlan(); markSel();
}

function onSeat(s) {
  if (!Number.isInteger(s) || !C.st) return;
  const p = personAt(s), host = isHost();
  if (host && C.mv && C.sel) { BR().send({ type: 'cls-move', id: C.sel, s }); C.mv = false; renderCard(); return; }
  if (p) {
    if (p.id === myId()) return toast('Bu — sizning o\'rningiz');
    return select(p.id);
  }
  if (host) return toast(C.sel ? '«🪑 Ko\'chirish» tugmasini bosing, keyin o\'rindiqni tanlang' : 'Avval o\'quvchini tanlang');
  if (C.cfg && C.cfg.seatLock) return toast(DENY.locked);
  BR().send({ type: 'cls-sit', s });
  C.yaw = 0; C.pitch = 0;
}

function setView(v) {
  if (v === 'board' && C.view !== 'board' && !C.boardZoomed) C.boardRad = fitBoardDistance();
  C.view = v; touch();
  renderTabs();
  const plan = v === 'plan', board = v === 'board';
  $('.c3-plan', dom).hidden = !plan;
  $('.c3-cv', dom).style.visibility = plan ? 'hidden' : 'visible';
  dom.classList.toggle('c3-board-view', board);
  const fb = $('.c3-fb', dom); fb.hidden = plan || !fallback;
  if (plan) { $('.c3-load', dom).hidden = true; renderPlan(); }      // 2D reja 3D kutubxonasiga muhtoj emas — yuklanish belgisi qolib ketmasin
  else if (board && fallback) drawFallback();
  else if (fallback) startFallback();
  else ensureGL();
  if (R) applyDpr();
  syncProj();
  renderHint();
}

// ------------------------------------------------------------------ doska "proyektor" rejimi
// Ulashilgan kontent (video, rasm, PDF, matn, Word/Excel/PowerPoint, YouTube, ekran) doskaga yaqinlashtirilganda
// haqiqiy elementning o'zi (piksel-aniq, 4K) #c3 ustidagi "teshik"dan ko'rsatiladi: tiniq va protsessorga yuk tushmaydi.
const VISUAL = new Set(['video', 'cast', 'image', 'pdf', 'text', 'office', 'youtube', 'doc', 'archive']);
const stageEl = () => (BR() && BR().stage && BR().stage()) || document.getElementById('stage');
function projRect() {
  const W = dom.clientWidth, Hh = dom.clientHeight, top = Math.round($('.c3-top', dom).getBoundingClientRect().bottom + 8), bot = 34, side = 10;
  const aw = W - side * 2, ah = Hh - top - bot, z = clamp(C.projZoom, 0.4, 1);
  const w = Math.round(aw * z), h = Math.round(ah * z);
  return { x: Math.round(side + (aw - w) / 2), y: Math.round(top + (ah - h) / 2), w, h };
}
function releaseProj() {
  const st = stageEl();
  if (st) { st.classList.remove('c3-over'); st.style.removeProperty('--c3x'); st.style.removeProperty('--c3y'); st.style.removeProperty('--c3w'); st.style.removeProperty('--c3h'); }
  if (!dom) { C.proj = false; return; }
  dom.style.clipPath = ''; dom.classList.remove('c3-proj');
  if (C.proj) { C.proj = false; poke(); if (C.open && C.view !== 'plan') { if (R) startLoop(); if (fallback) startFallback(); } }
}
function syncProj() {
  if (!dom || !C.open) return releaseProj();
  const st = stageEl(), kind = st && st.dataset.kind;
  const on = C.view === 'board' && st && VISUAL.has(kind) && !document.fullscreenElement && !st.classList.contains('pseudo-fs');
  if (!on) { C.projBad = ''; return releaseProj(); }
  if (C.projBad === kind + '|' + (BR().S().st || {}).currentId) return releaseProj();   // bu kontentda joylashtirish ishlamadi — 3D doska ko'rsatadi
  const r = projRect();
  st.classList.add('c3-over');
  st.style.setProperty('--c3x', r.x + 'px'); st.style.setProperty('--c3y', r.y + 'px'); st.style.setProperty('--c3w', r.w + 'px'); st.style.setProperty('--c3h', r.h + 'px');
  const b = st.getBoundingClientRect();
  if (Math.abs(b.left - r.x) > 2 || Math.abs(b.top - r.y) > 2 || Math.abs(b.width - r.w) > 2 || Math.abs(b.height - r.h) > 2) {   // stage ko'rinmaydi yoki transformli ota ichida
    C.projBad = kind + '|' + (BR().S().st || {}).currentId; return releaseProj();
  }
  dom.style.clipPath = `polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${r.x}px ${r.y}px,${r.x}px ${r.y + r.h}px,${r.x + r.w}px ${r.y + r.h}px,${r.x + r.w}px ${r.y}px,${r.x}px ${r.y}px)`;
  dom.classList.add('c3-proj');
  if (!C.proj) { C.proj = true; renderHint(); }
}
function boardZoom(f) {
  if (C.proj) C.projZoom = clamp(C.projZoom / f, 0.4, 1);
  else { C.boardRad = clamp(C.boardRad * f, 2.5, 36); C.boardZoomed = true; }
  syncProj(); poke();
}

function openOverlay() {
  if (!C.cfg || !C.cfg.class3d || !SS().joined) return;
  syncRoleView();
  buildDom();
  C.open = true; dom.hidden = false;
  document.documentElement.classList.add('c3-lock');
  clearInterval(C.pollT); C.pollT = setInterval(() => { if (C.open) syncProj(); }, 400);
  setView(C.view);
  renderAll();
  updateFab();
  if (BR() && BR().classroomViewChanged) BR().classroomViewChanged();
}
function closeOverlay() {
  if (!dom) return;
  C.open = false; dom.hidden = true;
  clearInterval(C.pollT); releaseProj();
  document.documentElement.classList.remove('c3-lock');
  if (R && R.raf) { cancelAnimationFrame(R.raf); R.raf = 0; }
  if (fallback && fallback.raf) { cancelAnimationFrame(fallback.raf); fallback.raf = 0; }
  updateFab();
  if (BR() && BR().classroomViewChanged) BR().classroomViewChanged();
}

// ------------------------------------------------------------------ FAB (ochish tugmasi)
function updateFab() {
  let f = $('#c3Fab');
  const show = !!(C.cfg && C.cfg.class3d && SS().joined && !C.open);
  if (!show) { if (f) f.hidden = true; return; }
  if (!f) {
    f = document.createElement('button');
    f.id = 'c3Fab'; f.type = 'button'; f.title = '3D dars xonasi';
    f.onclick = openOverlay;
    document.body.appendChild(f);
  }
  f.hidden = false;
  let n = 0; C.unread.forEach(v => { n += v; });
  if (isHost() && C.st) n += C.st.seats.filter(e => e.h).length;
  f.innerHTML = `🏫 <span>3D xona</span>${n ? `<i>${n > 9 ? '9+' : n}</i>` : ''}`;
}

// ------------------------------------------------------------------ UI chizish
function renderAll() {
  if (!dom || !C.st) { if (dom) renderHint(); return; }
  dom.classList.toggle('c3-celebration', !!C.award);
  const st = C.st, on = st.seats.filter(e => !e.o).length;
  $('.c3-cnt', dom).textContent = `👥 ${on} o'quvchi · ${st.cap} joy`;
  renderSide(); renderBottom(); renderCard(); renderWh(); renderHint();
  if (C.view === 'plan') renderPlan();
  else if (fallback) drawFallback();
}

function renderHint() {
  const h = $('.c3-hint', dom); if (!h) return;
  const host = isHost(), needsSeat = !host && mySeat() == null;
  h.textContent = C.view === 'board' ? (C.proj ? 'Ulashilgan kontent asl sifatda ko‘rsatilmoqda · kichraytirish: − tugmasi yoki g‘ildirak' : 'Doskani yaqinlashtirish uchun +/− tugmalarini, g‘ildirakni yoki chimchilashni ishlating; boshqa ko‘rinishga qaytish uchun yuqoridagi tugmani bosing.')
    : C.view === 'pov' ? (host ? 'Ustoz ko\'rinishi · doskani bosing — katta ko\'rinish · sudrab atrofga qarang (yoki ← → ↑ ↓)' : 'Doskani bosing — katta ko\'rinish · bo\'sh stulni bosing — o\'tirasiz · odamni bosing — xabar yozing')
    : C.view === 'orbit' ? 'Doskani bosing — katta ko\'rinish · sudrab aylantiring · yashil doira — bo\'sh o\'rin'
      : needsSeat ? 'O\'quvchi: bo\'sh o\'rindiqni tanlab joylashing.' : '';
  h.hidden = !h.textContent;
}

function renderSide() {
  const side = $('.c3-side', dom);
  if (!isHost() || !C.st) { side.innerHTML = ''; side.hidden = true; return; }
  side.hidden = false;
  const hands = C.st.seats.filter(e => e.h);
  const lock = !!(C.cfg && C.cfg.seatLock), wh = !(C.cfg && C.cfg.whisper === false);
  side.innerHTML = `
    <button data-act="shuffle" type="button">🔀 Aralashtirish</button>
    <button data-act="sort" type="button">🔤 Alifbo</button>
    <button data-act="lock" type="button" class="${lock ? 'on' : ''}">${lock ? '🔒 Qulflangan' : '🔓 O\'rin erkin'}</button>
    <button data-act="whisper" type="button" class="${wh ? 'on' : ''}">${wh ? '🤫 Xabar yoqiq' : '🤫 Xabar o\'chiq'}</button>
    ${hands.length ? `<div class="c3-hands"><b>✋ Qo'l ko'targanlar</b>${hands.map(e => `<span><button type="button" data-act="sel" data-id="${esc(e.id)}">${esc((e.a || '') + ' ' + e.n)}</button><button type="button" data-act="hclear" data-id="${esc(e.id)}" title="Qo'lni tushirish">✓</button></span>`).join('')}</div>` : ''}`;
}

function neighbors() {
  const st = C.st, me = st && personById(myId());
  if (!me) return {};
  const r = Math.floor(me.s / st.cols), c = me.s % st.cols; let left = null, right = null;
  for (const e of st.seats) {
    if (e.id === me.id || e.o || Math.floor(e.s / st.cols) !== r) continue;
    const ec = e.s % st.cols;
    if (ec < c && (!left || ec > left.ec)) left = Object.assign({ ec }, e);
    if (ec > c && (!right || ec < right.ec)) right = Object.assign({ ec }, e);
  }
  return { left, right, me };
}
const canWh = () => { if (isHost()) return true; const me = C.st && personById(myId()); return !(C.cfg && C.cfg.whisper === false) && !(me && me.b); };

function renderBottom() {
  const b = $('.c3-bot', dom);
  if (!C.st) { b.innerHTML = ''; return; }
  if (isHost()) { b.innerHTML = ''; b.hidden = true; return; }
  b.hidden = false;
  const { left, right, me } = neighbors(), can = canWh();
  const chip = (p, side) => p ? `<button type="button" data-act="peer" data-id="${esc(p.id)}" ${can ? '' : 'disabled'}>${side === 'l' ? '◀ ' : ''}${esc((p.a || '') + ' ' + p.n)}${side === 'r' ? ' ▶' : ''}</button>` : `<button type="button" disabled>${side === 'l' ? '◀ yo\'q' : 'yo\'q ▶'}</button>`;
  const hostOn = C.st.host && C.st.host.on;
  b.innerHTML = `
    <div class="c3-nb">${chip(left, 'l')}<span>yoningizdagilar</span>${chip(right, 'r')}</div>
    <div class="c3-acts">
      <button type="button" data-act="hand" class="${me && me.h ? 'on' : ''}">${me && me.h ? '✋ Qo\'lni tushirish' : '✋ Qo\'l ko\'tarish'}</button>
      <button type="button" data-act="peer" data-id="host" ${can && hostOn ? '' : 'disabled'}>👨‍🏫 Ustozga</button>
    </div>
    ${can ? '' : '<div class="c3-lockmsg">🤫 Shaxsiy xabar hozir yopiq</div>'}`;
}

function renderCard() {
  const cd = $('.c3-card', dom); if (!cd) return;
  const p = C.sel && personById(C.sel);
  if (!p) { cd.hidden = true; C.sel = null; return; }
  cd.hidden = false;
  const host = isHost(), can = canWh();
  cd.innerHTML = `
    <div class="c3-card-h"><span class="c3-av">${esc(p.a || (p.n || '?')[0])}</span><div><b>${esc(p.n)}</b><small>${p.o ? 'oflayn' : 'onlayn'} · ${p.s + 1}-o'rin${p.h ? ' · ✋ qo\'l ko\'targan' : ''}${p.b ? ' · 🚫 yozishi taqiqlangan' : ''}</small></div><button type="button" data-act="desel" aria-label="Yopish">✕</button></div>
    <div class="c3-card-b">
      <button type="button" data-act="wh" data-id="${esc(p.id)}" ${can && !p.o ? '' : 'disabled'}>💬 Xabar yozish</button>
      ${host ? `<button type="button" data-act="mv" class="${C.mv ? 'on' : ''}">🪑 Ko'chirish</button>
      <button type="button" data-act="block" data-id="${esc(p.id)}">${p.b ? '✅ Ruxsat berish' : '🚫 Yozishni taqiqlash'}</button>
      ${p.h ? `<button type="button" data-act="hclear" data-id="${esc(p.id)}">✓ Qo'lni tushirish</button>` : ''}` : ''}
    </div>`;
}

// ---- 2D reja (xonaga tepadan qarash): doska, ustoz, partalar, oynalar, eshik; yoningizdagilar belgilanadi
function renderPlan() {
  const pl = $('.c3-plan', dom); if (!pl || !C.st || C.view !== 'plan') return;
  const st = C.st, lay = layout(st.cols, st.cap), me = myId(), nb = neighbors(), host = isHost();
  const th = st.host, S = SS(), items = S.items || [], cur = items.find(i => i.id === (S.st && S.st.currentId)), title = cur ? (cur.name || cur.title || '') : '', playing = !!(S.st && S.st.playing);
  const sub = e => e && nb.left && e.id === nb.left.id ? '<u class="nbt">◀ chap</u>' : e && nb.right && e.id === nb.right.id ? '<u class="nbt">o\'ng ▶</u>' : '';
  let h = `<div class="c3-pl-in"><div class="c3-pl-legend"><span><i class="lg me"></i>Siz</span><span><i class="lg nb"></i>Yoningizdagi</span><span><i class="lg hand"></i>Qo'l ko'targan</span><span><i class="lg free"></i>Bo'sh</span></div>
    <div class="c3-pl-room"><div class="c3-pl-win">🪟</div>
    <div class="c3-pl-front"><div class="c3-pl-board"><b>${esc(S.roomName || 'DOSKA')}</b><small>${playing ? '▶' : '⏸'} ${esc(title || 'Fayl tanlanmagan')}</small></div>
    <button type="button" class="c3-pl-teach ${th && th.on ? '' : 'off'}" data-teach="1">👨‍🏫 ${esc(th && th.n ? th.n : 'Transmitter')}${th && th.on ? '' : ' (yo\'q)'}</button></div><div class="c3-pl-grid">`;
  for (let r = 0; r < lay.rows; r++) {
    h += `<div class="c3-pl-row"><i>${r + 1}</i>`;
    for (let p = 0; p < lay.pairs; p++) {
      h += '<div class="c3-pl-desk">';
      for (let k = 0; k < 2; k++) {
        const s = r * lay.cols + p * 2 + k, e = personAt(s);
        const cls = ['c3-pl-s', e ? '' : 'empty', e && e.o ? 'off' : '', e && e.id === me ? 'me' : '', e && e.id === C.sel ? 'sel' : '', e && e.h ? 'hand' : '', e && sub(e) ? 'nb' : ''].filter(Boolean).join(' ');
        const col = e ? '#' + pick(SHIRT, hash(e.id)).toString(16).padStart(6, '0') : '';
        h += `<button type="button" class="${cls}" data-s="${s}" title="${e ? esc(e.n) : s + 1 + '-o\'rin (bo\'sh)'}">${e ? `<em style="background:${col}">${esc(e.a || (e.n || '?')[0].toUpperCase())}</em><b>${esc(e.n)}</b>${sub(e)}${e.h ? '<span class="bd">✋</span>' : ''}${e.b ? '<span class="bd bl">🚫</span>' : ''}` : '<em class="ph">＋</em>'}</button>`;
      }
      h += '</div>';
    }
    h += '</div>';
  }
  h += `</div><div class="c3-pl-door">🚪 Eshik</div></div>
    <p class="c3-pl-tip">${host ? 'O\'quvchini bosing — xabar / ko\'chirish / taqiqlash.' : 'Bo\'sh o\'rinni bosing — o\'tirasiz. Odamni bosing — shaxsiy xabar yozing.'}</p></div>`;
  pl.innerHTML = h;
}

// ---- Shaxsiy xabarlar
function peerName(k) {
  if (k === 'host') return ((C.st && C.st.host && C.st.host.n) || 'Ustoz');
  const p = personById(k); return p ? p.n : (C.names.get(k) || 'O\'quvchi');
}
function openWh(key) {
  if (!key) return;
  if (!canWh()) return toast(DENY.blocked);
  C.peer = key; C.whOpen = true; C.unread.delete(key);
  renderWh(); updateFab();
  const i = $('.c3-wh-f input', dom); if (i && !LOW) i.focus();
}
function renderWh() {
  const w = $('.c3-wh', dom); if (!w) return;
  w.hidden = !C.whOpen;
  if (!C.whOpen) return;
  const keys = [...new Set([...C.threads.keys(), C.peer].filter(Boolean))];
  $('.c3-wh-peers', dom).innerHTML = keys.map(k => `<button type="button" data-act="peer" data-id="${esc(k)}" class="${k === C.peer ? 'on' : ''}">${k === 'host' ? '👨‍🏫 ' : ''}${esc(peerName(k))}${C.unread.get(k) ? `<i>${C.unread.get(k)}</i>` : ''}</button>`).join('');
  $('.c3-wh-note', dom).textContent = `🤫 Faqat siz va ${peerName(C.peer)} ko'radi`;
  const list = $('.c3-wh-list', dom), msgs = C.threads.get(C.peer) || [];
  list.innerHTML = msgs.length ? msgs.map(m => `<div class="c3-m ${m.me ? 'me' : ''}">${esc(m.text)}</div>`).join('') : '<div class="c3-empty">Hali xabar yo\'q. Pichirlab yozing 🤫</div>';
  list.scrollTop = list.scrollHeight;
  const can = canWh(), i = $('.c3-wh-f input', dom);
  i.disabled = !can; i.placeholder = can ? 'Shaxsiy xabar…' : 'Hozir yozib bo\'lmaydi';
}
function sendWh() {
  const i = $('.c3-wh-f input', dom), text = i.value.trim();
  if (!text || !C.peer) return;
  BR().send({ type: 'cls-whisper', to: C.peer, text });
  i.value = '';
}
function onWhisper(m) {
  const me = myId(), mine = m.from === me;
  const key = mine ? hostKey(m.to) : (m.fh ? 'host' : m.from);
  if (!mine) C.names.set(key, m.fn);
  const arr = C.threads.get(key) || []; arr.push({ me: mine, text: m.text, t: m.t });
  if (arr.length > 100) arr.shift();
  C.threads.set(key, arr);
  if (!mine) {
    const seen = C.open && C.whOpen && C.peer === key;
    if (!seen) { C.unread.set(key, (C.unread.get(key) || 0) + 1); if (C.open) toast(`🤫 ${m.fn}: ${m.text.slice(0, 60)}`); else if (typeof window.toast === 'function') window.toast(`🤫 ${m.fn}: ${m.text.slice(0, 50)}`, 2500); }
    bubble(key, m.text);
  }
  if (C.open) renderWh();
  updateFab();
}

function clearAwards() {
  if (!R || !R.awardG) return;
  const group = R.awardG;
  const sprites = [];
  group.traverse(o => { if (o.isSprite) sprites.push(o); });
  sprites.forEach(disposeSprite);
  R.scene.remove(group);
  disposeGroup(group);
  R.awardG = null;
  R.awardKey = '';
  R.awardFigures = []; R.confetti = [];
}

function renderAwards() {
  if (!R || !C.award || !L) { clearAwards(); return; }
  const winners = (C.award.top || []).slice(0, 3);
  const key = C.award.id + ':' + winners.map(w => `${w.name}|${w.score}`).join(';');
  if (R.awardG && R.awardKey === key) return;
  clearAwards();
  if (!winners.length) return;

  const group = new T.Group();
  const slots = [{ x: 0, h: 0.78 }, { x: -1.35, h: 0.54 }, { x: 1.35, h: 0.38 }];
  const podiumColors = [0xe8b923, 0xbfc7d5, 0xb87342];
  const medals = [0xffd700, 0xc0c0c0, 0xcd7f32];
  const figures = [];
  winners.forEach((winner, i) => {
    const slot = slots[i], podium = new T.Mesh(box(0.96, slot.h, 0.86), mat(podiumColors[i]));
    podium.position.set(slot.x, slot.h / 2, 1.85); podium.castShadow = !LOW; group.add(podium);

    const figure = makeFigure(true);
    look(figure, `quiz-${winner.name}`, false);
    figure.g.rotation.y = Math.PI;
    figure.g.position.set(slot.x + (i % 2 ? -3.2 : 3.2), slot.h, 1.85);
    group.add(figure.g);
    const winnerLabel = label(`${['🥇', '🥈', '🥉'][i]} ${winner.name}`, '#17345b', 0.96);
    winnerLabel.position.set(0, 2.18, 0);
    figure.g.add(winnerLabel);

    const ribbon = add(figure.g, 0.2, 0.3, 0.035, 0xc43e45, 0, 1.36, -0.2);
    ribbon.castShadow = false;
    const medal = new T.Mesh(sg('quiz-medal', () => new T.TorusGeometry(0.105, 0.035, 8, 20)), mat(medals[i], { metalness: 0.55, roughness: 0.3 }));
    medal.position.set(0, 1.22, -0.23); group.add(medal); figure.g.add(medal);
    const scoreLabel = label(`${winner.score} ball`, '#6b4a12', 0.94);
    scoreLabel.position.set(0, 2.52, 0);
    figure.g.add(scoreLabel);
    figures.push({ figure, x: slot.x, z: 1.85, startX: slot.x + (i % 2 ? -3.2 : 3.2), started: 0 });
  });

  const gift = (x, color) => {
    add(group, 0.48, 0.4, 0.42, color, x, 0.2, 3.6);
    add(group, 0.1, 0.43, 0.44, 0xffdf7e, x, 0.2, 3.6);
    add(group, 0.5, 0.07, 0.44, 0xffdf7e, x, 0.42, 3.6);
    add(group, 0.18, 0.1, 0.1, 0xffdf7e, x - 0.08, 0.53, 3.6);
    add(group, 0.18, 0.1, 0.1, 0xffdf7e, x + 0.08, 0.53, 3.6);
  };
  gift(-3.5, 0xe85d75); gift(3.5, 0x4c8ee8);

  const banner = label('🏆 G‘OLIBLAR TABRIKLANADI!', '#8a5a00', 0.98);
  banner.position.set(0, 3.7, 2.0); banner.scale.multiplyScalar(1.7); group.add(banner);
  const confettiMats = [0xffd700, 0xff5d73, 0x58c4ff, 0x71d88b, 0xc88bff].map(color => mat(color, { roughness: 0.45 }));
  const confetti = [];
  for (let i = 0; i < 36; i++) {
    const piece = new T.Mesh(box(0.07, 0.12, 0.025), confettiMats[i % confettiMats.length]);
    piece.position.set(((i * 37) % 70 - 35) / 10, 2.5 + (i * 17) % 32 / 10, 0.8 + (i * 13) % 16 / 10);
    piece.userData.phase = i * 0.61; piece.userData.baseY = piece.position.y;
    group.add(piece); confetti.push(piece);
  }
  R.scene.add(group);
  R.awardG = group; R.awardKey = key; R.awardFigures = figures; R.confetti = confetti;
  R.awardStarted = performance.now();
}

function restoreQuizCamera() {
  if (!C.quizCamera) return;
  C.rad = C.quizCamera.rad; C.oy = C.quizCamera.oy; C.op = C.quizCamera.op; C.zoomed = C.quizCamera.zoomed;
  C.view = C.quizCamera.view; C.viewRole = C.quizCamera.viewRole;
  C.quizCamera = null;
}

function openAwardCeremony() {
  if (!C.cfg || !C.cfg.class3d || !C.award || !C.award.top.length || !SS().joined) return;
  if (!C.quizCamera) C.quizCamera = { rad: C.rad, oy: C.oy, op: C.op, zoomed: C.zoomed, view: C.view, viewRole: C.viewRole };
  C.rad = Math.min(C.rad, 10.5); C.oy = 0; C.op = 0.4; C.zoomed = true;
  C.view = 'orbit'; C.viewRole = SS().role || C.viewRole;
  C.quizAutoOpened = true;
  if (!C.st && BR()) BR().send({ type: 'cls-sync' });
  openOverlay(); setView('orbit'); renderAwards();
}

function onQuiz(pub) {
  const prev = C.quiz;
  C.quiz = pub || null;
  if (!pub) {
    clearAwards();
    C.award = null;
    if (C.quizAutoOpened) closeOverlay();
    C.quizAutoOpened = false;
    restoreQuizCamera();
    return;
  }
  const newQuiz = !prev || prev.id !== pub.id;
  if (newQuiz && pub.phase !== 'final') {
    if (C.open) closeOverlay();
    restoreQuizCamera();
  }
  if (pub.kind === 'hw') {
    if (newQuiz) { C.award = null; clearAwards(); }
    return;
  }
  if (pub.phase !== 'final') {
    if (newQuiz) { C.award = null; clearAwards(); }
    return;
  }
  const wasFinal = prev && prev.id === pub.id && prev.phase === 'final';
  C.award = { id: pub.id, top: (pub.top || []).slice(0, 3) };
  if (!wasFinal && C.cfg && C.cfg.class3d && C.award.top.length && SS().joined) {
    syncRoleView();
    openAwardCeremony();
  } else if (R) renderAwards();
  if (!wasFinal) drawBoard();
}

// ------------------------------------------------------------------ server xabarlari
function on(m) {
  if (m.type === 'cls-state') {
    const oldSeat = mySeat();
    C.st = m;
    if (C.sel && !personById(C.sel)) C.sel = null;
    if (C.peer && C.peer !== 'host' && !personById(C.peer) && !C.threads.has(C.peer)) C.peer = null;
    if (!L || L.cols !== m.cols || L.cap !== m.cap) { L = layout(m.cols, m.cap); if (!C.zoomed) fitOrbit(); }
    if (!isHost() && oldSeat == null && mySeat() != null && C.view === 'plan') { if (C.open && dom) setView('pov'); else C.view = 'pov'; }   // overlay hali ochilmagan bo'lsa DOM yo'q — avval xato berib, holat yangilanishi to'xtab qolar edi
    if (R) applyScene();
    if (C.open) renderAll();
    updateFab();
  } else if (m.type === 'cls-whisper') onWhisper(m);
  else if (m.type === 'cls-denied') { if (C.open) toast(DENY[m.reason] || 'Ruxsat yo\'q'); else if (typeof window.toast === 'function') window.toast(DENY[m.reason] || 'Ruxsat yo\'q', 2000); }
}
function cfg(c) {
  syncRoleView();
  C.cfg = Object.assign({}, c, { class3d: !!(c && c.class3d) });
  if (!C.cfg.class3d) {
    closeOverlay();
    updateFab();
    return;
  }
  updateFab();
  // three.js ni bo'sh vaqtda oldindan yuklaymiz: 3D xona bosilganda darhol ochiladi
  if (!window.THREE && !loadP) (window.requestIdleCallback || (f => setTimeout(f, 1200)))(() => { loadThree().catch(() => {}); }, { timeout: 4000 });
  if (C.open) { renderAll(); renderTabs(); }
  if (R) applyScene();
  if (C.quiz && C.quiz.phase === 'final' && C.award && C.award.top.length && !C.quizAutoOpened && SS().joined) {
    openAwardCeremony();
  }
}
function syncRoleView() {
  const role = SS().joined ? SS().role : null;
  if (!role || C.viewRole === role) return;
  C.viewRole = role;
  C.view = isHost() ? 'orbit' : 'plan';
}
function reset() {
  closeOverlay();
  clearAwards();
  C.cfg = null; C.st = null; C.quiz = null; C.award = null; C.quizAutoOpened = false; C.quizCamera = null; C.viewRole = null; C.sel = null; C.peer = null; C.whOpen = false; C.threads.clear(); C.unread.clear(); C.names.clear();
  if (fallback && fallback.raf) { cancelAnimationFrame(fallback.raf); fallback.raf = 0; }
  if (R) { for (const f of R.figs.values()) { R.scene.remove(f.g); } R.figs.clear(); R.populated = false; if (R.teacher) { R.scene.remove(R.teacher.g); R.teacher = null; } }
  updateFab();
}

// ================================================================== 3D
const geos = new Map(), mats = new Map(), SH = new Map();
function sg(key, make) { let g = SH.get(key); if (!g) { g = make(); g.userData.shared = true; SH.set(key, g); } return g; }   // umumiy geometriya
const SPH = (r, a = 12, b = 8) => sg('s' + r + '_' + a + '_' + b, () => new T.SphereGeometry(r, a, b));
const CYL = (a, b, h, n = 12) => sg('c' + a + '_' + b + '_' + h + '_' + n, () => new T.CylinderGeometry(a, b, h, n));
function box(w, h, d) { const k = w + 'x' + h + 'x' + d; let g = geos.get(k); if (!g) { g = new T.BoxGeometry(w, h, d); g.userData.shared = true; geos.set(k, g); } return g; }
function mat(c, o) { const k = c + (o ? JSON.stringify(o) : ''); let m = mats.get(k); if (!m) { m = new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.82, metalness: 0 }, o || {})); mats.set(k, m); } return m; }
function add(parent, w, h, d, color, x, y, z, o) {
  const m = new T.Mesh(box(w, h, d), mat(color, o)); m.position.set(x, y, z); m.castShadow = !LOW; m.receiveShadow = !LOW; parent.add(m); return m;
}
function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new T.CanvasTexture(cv); t.anisotropy = ANISO; return t; }

function ensureGL() {
  const ld = $('.c3-load', dom);
  if (fallback) { ld.hidden = true; startFallback(); return; }
  if (R) { ld.hidden = true; startLoop(); return; }
  ld.hidden = false;
  loadThree().then(() => {
    T = window.THREE;
    if (!C.open) { ld.hidden = true; return; }
    try { initGL(); tuneQuality(); ld.hidden = true; startLoop(); }
    catch (e) { console.error('[3d]', e); R = null; ld.hidden = true; toast('WebGL ishlamadi — oflayn 3D rejim'); initFallback(); }
  }).catch(() => { ld.hidden = true; toast('Three.js yuklanmadi — oflayn 3D rejim'); initFallback(); });
}

function initGL() {
  const cv = $('.c3-cv', dom);
  const renderer = new T.WebGLRenderer({ canvas: cv, antialias: !LOW && (window.devicePixelRatio || 1) < 2, alpha: false, stencil: false, powerPreference: 'default' });
  renderer.setPixelRatio(1);
  ANISO = Math.min(16, renderer.capabilities.getMaxAnisotropy() || 4);
  if (!LOW && C.st && C.st.seats.length <= 80) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap; renderer.shadowMap.autoUpdate = false; }   // soya faqat sahna o'zgarganda yangilanadi
  const scene = new T.Scene();
  scene.background = canvasTex(8, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0b1124'); g.addColorStop(1, '#22304f'); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  scene.fog = new T.Fog(0x1a2542, 40, 95);
  const camera = new T.PerspectiveCamera(68, 1, 0.05, 120);
  scene.add(new T.HemisphereLight(0xdfe9ff, 0x6b5a46, 0.8));
  const sun = new T.DirectionalLight(0xfff0d6, 0.75); sun.position.set(-9, 10, 6); scene.add(sun); scene.add(sun.target);
  if (renderer.shadowMap.enabled) { sun.castShadow = true; sun.shadow.mapSize.set(navigator.deviceMemory && navigator.deviceMemory <= 4 ? 1024 : 2048, navigator.deviceMemory && navigator.deviceMemory <= 4 ? 1024 : 2048); const sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 40; sun.shadow.bias = -0.0006; }
  R = { renderer, scene, camera, sun, figs: new Map(), pick: [], markers: [], ceilObjs: [], roomG: null, teacher: null, cp: new T.Vector3(0, 3, 12), ct: new T.Vector3(0, 1, 3), raf: 0, last: 0, bubbles: [], ray: new T.Raycaster(), ndc: new T.Vector2(), boardSig: '', floorTex: null, populated: false,
    dirty: true, active: 0, pr: 0, gAcc: 0, gN: 0, gAt: 0, shadowDirty: true, shAt: 0, mkey: '', mSrc: null, vfDirty: false, vWatch: null, mAt: 0, scrDims: '' };
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); R.lost = true; });
  cv.addEventListener('webglcontextrestored', () => { R.lost = false; R.mkey = ''; R.boardSig = ''; R.shadowDirty = true; if (R.roomG) R.roomG.userData.k = ''; applyScene(); poke(); });
  R.floorTex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#b98a54'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#c29761' : '#ae7f4a'; x.fillRect(0, i * 64, w, 62); x.fillStyle = 'rgba(60,35,15,.5)'; x.fillRect(0, i * 64 + 62, w, 2); for (let k = 0; k < 3; k++) x.fillRect((k * 83 + i * 37) % w, i * 64, 2, 62); }
  });
  R.floorTex.wrapS = R.floorTex.wrapT = T.RepeatWrapping;
  R.floorMat = new T.MeshStandardMaterial({ map: R.floorTex, roughness: 0.62 });
  // oyna tashqarisi: osmon + bulutlar
  R.skyMat = new T.MeshBasicMaterial({ map: canvasTex(128, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#6fb0f0'); g.addColorStop(1, '#eaf5ff'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.85)'; [[30, 70, 26], [62, 62, 22], [92, 74, 24], [70, 150, 20], [100, 144, 16]].forEach(([a, b, r]) => { x.beginPath(); x.arc(a, b, r, 0, 7); x.fill(); });
  }) });
  R.beamMat = new T.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.055, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
  R.mkMat = new T.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.4, depthWrite: false, side: T.DoubleSide });
  R.mkHot = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthWrite: false, side: T.DoubleSide });
  bindPointer(cv);
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  fit();
  if (C.st) applyScene();
}

function fit() { if (!R || !dom) return; applyDpr(); }
function fitOrbit() { if (L) C.rad = clamp(Math.max(L.W, L.D) * 1.0, 9, 40); }
// Doska o'lchamlari (ramka ichidagi yozuv maydoni) — hamma joyda shu funksiya ishlatiladi
function boardDims() { const bw = Math.min((L ? L.W : 12) - 2.6, 6.6); return { bw, bh: 2.2, by: 1.95 }; }
function fitBoardDistance() {
  const { bw, bh } = boardDims();
  const vw = (dom && dom.clientWidth) || innerWidth, vh = (dom && dom.clientHeight) || innerHeight;
  const aspect = Math.max(0.3, vw / vh), tanH = Math.tan(36 * Math.PI / 360);
  const dW = (bw * 1.1 / 2) / (tanH * aspect), dH = (bh * 1.5 / 2) / tanH;      // yuqori panel va tugmalar uchun joy qoldiriladi
  return clamp(Math.max(dW, dH), 2.5, 36);
}

function startLoop() {
  if (!R || R.raf || C.view === 'plan' || !C.open || C.proj || document.hidden) return;
  fit(); R.last = 0; R.dirty = true;
  const tick = t => {
    if (!C.open || C.view === 'plan' || C.proj || document.hidden) { R.raf = 0; return; }
    R.raf = requestAnimationFrame(tick);
    if (R.lost) return;
    // Tinch sahnada kam chiziladi (protsessor isimaydi); harakat/video/o'zgarish bo'lsa — to'liq tezlikda
    const since = t - R.last, busy = R.dirty || R.active > t;
    const gap = busy ? 1000 / QUALITY.fps - 2 : (C.view === 'board' ? 1000 : 1000 / 12);
    if (since < gap) return;
    const dt = R.last ? Math.min(0.1, since / 1000) : 0.016;
    R.dirty = false; frame(t, dt);
    if (R.active > t && R.last) governor(since, t);     // faqat uzluksiz harakat paytida o'lchanadi
    R.last = t;
  };
  R.raf = requestAnimationFrame(tick);
}

// ---- xona (devor, pol, podium, doska, soat, javon, oyna, parta, stullar)
function disposeGroup(g) { g.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); }
function shelf(g, x, z) {
  add(g, 1.2, 1.8, 0.04, 0x7a5a3a, x, PF + 0.9, z - 0.17);
  add(g, 0.04, 1.8, 0.38, 0x6b4a2b, x - 0.58, PF + 0.9, z); add(g, 0.04, 1.8, 0.38, 0x6b4a2b, x + 0.58, PF + 0.9, z);
  for (let r = 0; r <= 4; r++) add(g, 1.2, 0.035, 0.38, 0x6b4a2b, x, PF + 0.02 + r * 0.43, z);
  for (let r = 0; r < 4; r++) {
    let bx = x - 0.54;
    for (let i = 0; i < 12; i++) {
      const hs = hash('bk' + r + '_' + i), w = 0.065 + ((hs >>> 3) % 4) * 0.012, hh = 0.25 + ((hs >>> 7) % 4) * 0.04;
      if (bx + w > x + 0.55) break;
      const b = add(g, w, hh, 0.26, pick(BOOK, hs), bx + w / 2, PF + 0.04 + r * 0.43 + hh / 2, z + 0.03); b.castShadow = false; bx += w + 0.008;
    }
  }
}
function buildRoom() {
  if (R.roomG) { R.scene.remove(R.roomG); disposeGroup(R.roomG); }
  if (R.boardMesh) { R.boardMesh.material.dispose(); R.boardMesh = null; }
  if (R.scr) { R.scr.material.dispose(); R.scr.geometry.dispose(); R.scr = null; }
  if (R.scrBack) { R.scrBack.material.dispose(); R.scrBack.geometry.dispose(); R.scrBack = null; }
  if (R.boardTex) R.boardTex.dispose();
  if (R.clockTex) R.clockTex.dispose();
  if (R.mtex) { R.mtex.dispose(); R.mtex = null; R.mcv = null; }
  R.mkey = ''; R.mSrc = null; R.scrDims = '';
  const g = new T.Group(); R.roomG = g; R.pick = []; R.markers = []; R.ceilObjs = [];
  const { W, D, rows, pairs } = L;
  const plane = (w, h, color, o) => new T.Mesh(new T.PlaneGeometry(w, h), mat(color, o));
  // pol
  const ft = R.floorTex; ft.repeat.set(W / 2.2, D / 2.2); ft.needsUpdate = true;
  const floor = new T.Mesh(new T.PlaneGeometry(W, D), R.floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, D / 2); floor.receiveShadow = !LOW; g.add(floor);
  // devorlar (ichkariga qaragan: tashqaridan ko'rinmaydi)
  const walls = [[W, 0, 0, 0], [W, 0, D, Math.PI], [D, -W / 2, D / 2, Math.PI / 2], [D, W / 2, D / 2, -Math.PI / 2]];
  for (const [w, x, z, ry] of walls) {
    const wl = plane(w, H, 0xece4d2); wl.position.set(x, H / 2, z); wl.rotation.y = ry; wl.receiveShadow = !LOW; g.add(wl);
    const wp = plane(w, 1.0, 0x7a5a3a); wp.position.set(x + Math.sin(ry) * 0.01, 0.5, z + Math.cos(ry) * 0.01); wp.rotation.y = ry; g.add(wp);
    const tr = plane(w, 0.06, 0x5a3f27); tr.position.set(x + Math.sin(ry) * 0.012, 1.02, z + Math.cos(ry) * 0.012); tr.rotation.y = ry; g.add(tr);   // devor chizig'i
  }
  const ceil = plane(W, D, 0xf6f3ec); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, D / 2); g.add(ceil); R.ceil = ceil; R.ceilObjs.push(ceil);
  // shiftdagi chiroqlar (+ haqiqiy yorug'lik)
  for (let x = -W / 2 + 2; x < W / 2 - 1; x += 3.2) for (let z = 2.4; z < D - 1; z += 3.4) { const l = add(g, 1.4, 0.04, 0.5, 0xffffff, x, H - 0.03, z, { emissive: 0xffffff, emissiveIntensity: 0.9 }); l.castShadow = false; R.ceilObjs.push(l); }
  if (R.renderer.shadowMap.enabled) for (const z of [D * 0.3, D * 0.7]) { const pl = new T.PointLight(0xfff1d6, 0.55, 16, 1.6); pl.position.set(0, H - 0.5, z); g.add(pl); }
  // podium (ustoz balandligi)
  add(g, W - 0.06, PF, 2.4, 0x9a7048, 0, PF / 2, 1.2 + 0.03); add(g, W - 0.06, 0.02, 0.06, 0xe0c08a, 0, PF + 0.002, 2.4 + 0.03).castShadow = false;
  // doska + tokcha
  const { bw, bh, by } = boardDims();
  add(g, bw + 0.2, bh + 0.2, 0.06, 0x6b4a2b, 0, by, 0.03);
  // Doska yozuvi teksturasi: 4K gacha (zaif qurilmada 2K), mipmap + maksimal anisotropiya — qiya burchakdan ham tiniq
  const tw = Math.min(R.renderer.capabilities.maxTextureSize || 4096, QUALITY.low || QUALITY.mode === 'low' ? 2048 : 4096);
  R.boardTex = canvasTex(tw, Math.round(tw * bh / bw), () => {});
  R.boardTex.anisotropy = ANISO; R.boardTex.minFilter = T.LinearMipmapLinearFilter;
  R.boardCv = R.boardTex.image;
  const bm = new T.Mesh(new T.PlaneGeometry(bw, bh), new T.MeshBasicMaterial({ map: R.boardTex }));
  bm.position.set(0, by, 0.065); bm.userData.board = true; R.boardMesh = bm; g.add(bm);
  // Ulashilgan kontent qatlami (video/rasm/ekran/hujjat kartasi): qora fon + tasvir aspektiga mos plane
  const sb = new T.Mesh(new T.PlaneGeometry(bw - 0.1, bh - 0.1), new T.MeshBasicMaterial({ color: 0x05080d })); sb.position.set(0, by, 0.068); sb.userData.board = true; sb.visible = false; g.add(sb); R.scrBack = sb;
  const scrM = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })); scrM.position.set(0, by, 0.071); scrM.userData.board = true; scrM.visible = false; g.add(scrM); R.scr = scrM;
  add(g, bw, 0.05, 0.14, 0x6b4a2b, 0, by - bh / 2 - 0.05, 0.1);
  [0xffffff, 0xffe28a, 0x9ad1ff].forEach((c, i) => add(g, 0.1, 0.02, 0.02, c, -0.3 + i * 0.22, by - bh / 2 - 0.015, 0.12).castShadow = false);
  R.boardSig = ''; R.boardProjectionKey = '';
  // devor soati
  R.clockTex = canvasTex(256, 256, () => {}); R.clockCv = R.clockTex.image;
  const ck = new T.Mesh(new T.CircleGeometry(0.32, 36), new T.MeshBasicMaterial({ map: R.clockTex, transparent: true }));
  ck.position.set(Math.min(bw / 2 + 0.75, W / 2 - 0.5), 2.95, 0.05); g.add(ck);
  // kitob javoni (joy bo'lsa)
  if (W / 2 - bw / 2 > 1.9) shelf(g, -W / 2 + 0.9, 0.3);
  // o'qituvchi stoli (podiumda)
  const dx = -Math.min(2.3, W / 2 - 1.25), dy = PF;
  add(g, 1.9, 0.06, 0.8, 0xa57844, dx, dy + 0.78, 1.5); add(g, 1.8, 0.72, 0.1, 0x7a5a3a, dx, dy + 0.4, 1.85);
  add(g, 0.05, 0.75, 0.7, 0x7a5a3a, dx - 0.88, dy + 0.38, 1.5); add(g, 0.05, 0.75, 0.7, 0x7a5a3a, dx + 0.88, dy + 0.38, 1.5);
  add(g, 0.5, 0.03, 0.34, 0x30343c, dx, dy + 0.82, 1.45); add(g, 0.5, 0.3, 0.02, 0x30343c, dx, dy + 0.98, 1.3);
  add(g, 0.2, 0.12, 0.2, 0xffffff, dx + 0.6, dy + 0.87, 1.55);           // krujka
  // oynalar (chap devor): rom, oyna, parda, quyosh nuri
  for (let z = 2.6; z < D - 1.5; z += 3.2) {
    add(g, 0.08, 1.6, 1.7, 0xffffff, -W / 2 + 0.04, 1.95, z);
    const gl = new T.Mesh(new T.PlaneGeometry(1.5, 1.4), R.skyMat); gl.rotation.y = Math.PI / 2; gl.position.set(-W / 2 + 0.09, 1.95, z); g.add(gl);
    add(g, 0.03, 1.4, 0.04, 0xffffff, -W / 2 + 0.1, 1.95, z).castShadow = false; add(g, 0.03, 0.04, 1.5, 0xffffff, -W / 2 + 0.1, 1.95, z).castShadow = false;
    add(g, 0.16, 0.05, 1.9, 0xe9e2d0, -W / 2 + 0.08, 1.12, z);
    add(g, 0.1, 1.95, 0.34, 0xb45a52, -W / 2 + 0.13, 1.95, z - 0.98); add(g, 0.1, 1.95, 0.34, 0xb45a52, -W / 2 + 0.13, 1.95, z + 0.98);
    if (R.renderer.shadowMap.enabled) { const bmx = new T.Mesh(box(0.02, 3.6, 1.4), R.beamMat); bmx.rotation.z = 0.8; bmx.position.set(-W / 2 + 1.34, 0.7, z); g.add(bmx); }
  }
  // eshik (orqa devor, o'ng tomonda) va plakatlar
  add(g, 1.2, 2.2, 0.04, 0xe8e0cf, W / 2 - 1.4, 1.1, D - 0.02);
  add(g, 1.0, 2.1, 0.06, 0x7a5230, W / 2 - 1.4, 1.05, D - 0.05); add(g, 0.06, 0.06, 0.1, 0xe0c040, W / 2 - 1.0, 1.05, D - 0.1);
  [0xe57373, 0x64b5f6, 0xffd54f].forEach((c, i) => { const p = plane(0.9, 1.2, c); p.rotation.y = -Math.PI / 2; p.position.set(W / 2 - 0.02, 1.9, 2.5 + i * 1.6); g.add(p); });
  // o'simliklar
  [[-W / 2 + 0.6, D - 0.7], [W / 2 - 0.6, 1.0]].forEach(([x, z]) => {
    add(g, 0.4, 0.4, 0.4, 0x9c5a3c, x, 0.2, z);
    const lf = new T.Mesh(SPH(0.42, 10, 8), mat(0x3f9a4a)); lf.position.set(x, 0.85, z); lf.scale.y = 1.2; lf.castShadow = !LOW; g.add(lf);
    const l2 = new T.Mesh(SPH(0.28, 10, 8), mat(0x56b35e)); l2.position.set(x + 0.18, 1.2, z - 0.1); g.add(l2);
  });
  // yo'lak gilamlari
  for (let p = 0; p < pairs - 1; p++) {
    const cx = -L.totalW / 2 + PAIR_W + GAP / 2 + p * (PAIR_W + GAP) - 0; const rg = plane(0.62, D - 3.1, 0x7b2d3a); rg.rotation.x = -Math.PI / 2; rg.position.set(cx, 0.012, 3.0 + (D - 3.1) / 2); rg.receiveShadow = !LOW; g.add(rg);
  }
  // partalar, stullar, daftar, bo'sh o'rin belgilari
  const wood = 0xc9a56b, leg = 0x8a6b45, DZ = 0.7;
  const instanceBatches = new Map(), instanceTransform = new T.Object3D(), instanceCapacity = Math.max(1, L.cap * 4);
  const addSeatPart = (w, h, d, color, x, y, z, rotationY = 0) => {
    const key = `${w}x${h}x${d}:${color}`;
    let batch = instanceBatches.get(key);
    if (!batch) {
      const mesh = new T.InstancedMesh(box(w, h, d), mat(color), instanceCapacity);
      mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = false;
      g.add(mesh); batch = { mesh, count: 0 }; instanceBatches.set(key, batch);
    }
    instanceTransform.position.set(x, y, z);
    instanceTransform.rotation.set(0, rotationY, 0);
    instanceTransform.scale.set(1, 1, 1);
    instanceTransform.updateMatrix();
    batch.mesh.setMatrixAt(batch.count++, instanceTransform.matrix);
  };
  for (let r = 0; r < rows; r++) {
    for (let p = 0; p < pairs; p++) {
      const s0 = r * L.cols + p * 2, a = seatPos(s0), cx = a.cx, z = a.z - DZ;
      addSeatPart(PAIR_W, 0.05, 0.7, wood, cx, 0.76, z);
      addSeatPart(PAIR_W + 0.02, 0.03, 0.02, 0xa88454, cx, 0.745, z - 0.36);
      addSeatPart(0.05, 0.72, 0.6, leg, cx - PAIR_W / 2 + 0.1, 0.38, z);
      addSeatPart(0.05, 0.72, 0.6, leg, cx + PAIR_W / 2 - 0.1, 0.38, z);
      addSeatPart(PAIR_W - 0.2, 0.3, 0.03, 0xa88454, cx, 0.58, z - 0.3);
    }
  }
  for (let i = 0; i < L.cap; i++) {
    const { x, z } = seatPos(i), hs = hash('nb' + i);
    addSeatPart(0.5, 0.05, 0.5, 0x3f6fb5, x, 0.46, z + 0.02);
    addSeatPart(0.5, 0.44, 0.05, 0x3f6fb5, x, 0.72, z + 0.28);
    for (const [ddx, ddz] of [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.22], [0.21, 0.22]]) addSeatPart(0.04, 0.44, 0.04, 0x2a2f3a, x + ddx, 0.22, z + ddz + 0.02);
    addSeatPart(0.3, 0.014, 0.22, pick(NOTEB, hs), x, 0.793, z - DZ + 0.04, ((hs >>> 5) % 7 - 3) * 0.05);
    addSeatPart(0.012, 0.012, 0.15, 0x2b5fd9, x + 0.22, 0.792, z - DZ);
    const mk = new T.Mesh(sg('mk', () => new T.RingGeometry(0.22, 0.32, 28)), R.mkMat); mk.rotation.x = -Math.PI / 2; mk.position.set(x, 0.03, z + 0.02); mk.renderOrder = 5; g.add(mk); R.markers.push(mk);
    const hb = new T.Mesh(box(0.8, 1.7, 0.95), new T.MeshBasicMaterial({ visible: false }));
    hb.position.set(x, 0.85, z - 0.05); hb.userData.seat = i; g.add(hb); R.pick.push(hb);
  }
  for (const { mesh, count } of instanceBatches.values()) {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }
  // statik xona: matritsalar har kadrda qayta hisoblanmaydi
  g.traverse(o => { if (o.isMesh && !o.isInstancedMesh && R.markers.indexOf(o) < 0) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  R.scene.add(g);
  R.shadowDirty = true; R.dirty = true;
  R.sun.target.position.set(0, 0, D / 2);
  const sc = R.sun.shadow && R.sun.shadow.camera; if (sc) { const e = Math.max(W, D) / 2 + 2; sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.updateProjectionMatrix(); R.sun.position.set(-W / 2 - 2, 10, D / 2 + 3); }
  for (const f of R.figs.values()) f.g.position.set(f.tx, 0, f.tz);
}

// ---- odamlar
function disposeSprite(s) { if (!s) return; if (s.material.map) s.material.map.dispose(); s.material.dispose(); if (s.parent) s.parent.remove(s); }
function label(text, bg, alpha) {
  const f = '600 34px system-ui,-apple-system,"Segoe UI",sans-serif', cv = document.createElement('canvas'), x = cv.getContext('2d');
  x.font = f; const w = Math.min(560, Math.ceil(x.measureText(text).width) + 44); cv.width = w; cv.height = 64;
  x.font = f; x.globalAlpha = alpha; x.fillStyle = bg; x.beginPath();
  if (x.roundRect) x.roundRect(0, 0, w, 64, 32); else x.rect(0, 0, w, 64);
  x.fill(); x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(text, w / 2, 34, w - 28);
  const t = new T.CanvasTexture(cv); t.minFilter = T.LinearFilter;
  const s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.scale.set(w / 64 * 0.27, 0.27, 1); s.renderOrder = 10; return s;
}
function bubbleSprite(text) {
  const cv = document.createElement('canvas'), x = cv.getContext('2d'), W = 460, pad = 22, words = text.slice(0, 90).split(' '), lines = []; let cur = '';
  x.font = '600 30px system-ui,sans-serif';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > W - pad * 2 && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur); const h = lines.length * 38 + pad * 2; cv.width = W; cv.height = h + 18;
  x.font = '600 30px system-ui,sans-serif'; x.fillStyle = '#fffbe6'; x.beginPath(); if (x.roundRect) x.roundRect(0, 0, W, h, 22); else x.rect(0, 0, W, h); x.fill();
  x.beginPath(); x.moveTo(W / 2 - 14, h - 1); x.lineTo(W / 2, h + 17); x.lineTo(W / 2 + 14, h - 1); x.fill();
  x.fillStyle = '#222'; x.textBaseline = 'top'; lines.forEach((l, i) => x.fillText(l, pad, pad + i * 38));
  const t = new T.CanvasTexture(cv), s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(W / 400, (h + 18) / 400, 1); s.center.set(0.5, 0); s.renderOrder = 12; return s;
}
let handTex = null;
function handSprite() {
  if (!handTex) handTex = canvasTex(96, 96, x => { x.font = '70px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('✋', 48, 52); });
  const s = new T.Sprite(new T.SpriteMaterial({ map: handTex, transparent: true, depthTest: false })); s.scale.set(0.4, 0.4, 1); s.renderOrder = 11; return s;
}

// Odam: yumaloq tana, bo'yin, yuz (ko'z+qosh+burun+og'iz), soch turlari, ko'zoynak, tirsakli qo'llar
function makeFigure(standing, teacher) {
  const g = new T.Group(), P = [], top = teacher ? 'shirt' : 'jacket';   // o'quvchi — maktab formasi (pidjak, oq ko'ylak, galstuk)
  const part = (geo, k, x, y, z, parent) => { const m = new T.Mesh(geo, mat(0xffffff)); m.position.set(x, y, z); m.castShadow = !LOW; m.userData.k = k; (parent || g).add(m); P.push(m); return m; };
  let torso;
  if (standing) {
    part(box(0.17, 0.85, 0.17), 'pants', -0.12, 0.43, 0); part(box(0.17, 0.85, 0.17), 'pants', 0.12, 0.43, 0);
    part(box(0.18, 0.08, 0.28), 'shoe', -0.12, 0.04, -0.05); part(box(0.18, 0.08, 0.28), 'shoe', 0.12, 0.04, -0.05);
    torso = part(CYL(0.21, 0.25, 0.7, 14), top, 0, 1.2, 0); torso.scale.z = 0.62;
  } else {
    part(box(0.15, 0.15, 0.44), 'pants', -0.11, 0.56, -0.2); part(box(0.15, 0.15, 0.44), 'pants', 0.11, 0.56, -0.2);
    part(box(0.14, 0.46, 0.14), 'pants', -0.11, 0.28, -0.43); part(box(0.14, 0.46, 0.14), 'pants', 0.11, 0.28, -0.43);
    part(box(0.15, 0.07, 0.24), 'shoe', -0.11, 0.04, -0.48); part(box(0.15, 0.07, 0.24), 'shoe', 0.11, 0.04, -0.48);
    torso = part(CYL(0.19, 0.23, 0.58, 14), top, 0, 0.82, 0.04); torso.scale.z = 0.66;
  }
  const hy = standing ? 1.8 : 1.32;
  part(CYL(0.05, 0.056, 0.1, 8), 'skin', 0, hy - 0.16, 0);
  if (!teacher) {                                   // forma: oq ko'ylak yoqasi + ko'kragi, galstuk, pidjak yoqasi
    const cy = standing ? 1.3 : 0.92, fz = standing ? -0.125 : -0.115;
    part(box(0.16, 0.05, 0.13), 'shirtw', 0, hy - 0.205, -0.01);                       // yoqa
    part(box(0.12, 0.4, 0.02), 'shirtw', 0, cy, fz);                                   // ko'ylak ko'kragi
    part(box(0.045, 0.045, 0.03), 'tie', 0, cy + 0.17, fz - 0.012);                    // galstuk tuguni
    part(box(0.05, 0.3, 0.018), 'tie', 0, cy + 0.01, fz - 0.014);                      // galstuk
    part(box(0.035, 0.4, 0.016), 'jacket', -0.085, cy, fz - 0.002).rotation.z = 0.12;  // pidjak lapkalari
    part(box(0.035, 0.4, 0.016), 'jacket', 0.085, cy, fz - 0.002).rotation.z = -0.12;
  }
  const head = new T.Group(); head.position.set(0, hy, 0); g.add(head);
  part(SPH(0.15, 16, 12), 'skin', 0, 0, 0, head).scale.y = 1.08;
  part(sg('hair', () => new T.SphereGeometry(0.162, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), 'hair', 0, 0.014, 0.014, head);
  const hairLong = part(box(0.31, 0.36, 0.1), 'hair', 0, -0.07, 0.12, head);
  const bun = part(SPH(0.065, 8, 6), 'hair', 0, 0.17, 0.07, head);
  part(box(0.026, 0.03, 0.03), 'skin', 0, -0.025, -0.15, head);
  part(box(0.055, 0.011, 0.012), 'mouth', 0, -0.07, -0.142, head);
  const eyes = [], glasses = new T.Group(); head.add(glasses);
  for (const ex of [-0.055, 0.055]) {
    const eg = new T.Group(); eg.position.set(ex, 0.012, -0.136); head.add(eg); eyes.push(eg);
    part(SPH(0.026, 8, 6), 'eye', 0, 0, 0, eg); part(SPH(0.014, 6, 6), 'pupil', 0, 0, -0.017, eg);
    part(box(0.052, 0.011, 0.012), 'hair', ex, 0.055, -0.142, head);
    const rg = part(sg('ring', () => new T.TorusGeometry(0.04, 0.006, 6, 14)), 'glass', ex, 0.012, -0.152, glasses);
  }
  part(box(0.03, 0.006, 0.006), 'glass', 0, 0.02, -0.152, glasses);
  const arm = (dx) => {
    const pv = new T.Group(); pv.position.set(dx, standing ? 1.46 : 1.06, 0.03); g.add(pv);
    part(SPH(0.07, 8, 6), top, 0, 0, 0, pv);
    part(sg('upper', () => { const b = new T.BoxGeometry(0.095, 0.3, 0.095); b.translate(0, -0.15, 0); return b; }), top, 0, 0, 0, pv);
    const el = new T.Group(); el.position.set(0, -0.3, 0); pv.add(el);
    part(sg('fore', () => { const b = new T.BoxGeometry(0.08, 0.28, 0.08); b.translate(0, -0.14, 0); return b; }), 'skin', 0, 0, 0, el);
    part(SPH(0.05, 8, 6), 'skin', 0, -0.29, 0, el);
    pv.rotation.x = standing ? 0.12 : 0.7; el.rotation.x = standing ? 0.25 : 0.8;
    return { pv, el };
  };
  const aL = arm(-0.28), aR = arm(0.28);
  // Tafsilotlar (ko'z, og'iz, ko'zoynak) uzoqdan yashiriladi; qotib qolgan qismlarning matritsasi qayta hisoblanmaydi (CPU tejaladi)
  const detail = P.filter(m => m.userData.k === 'eye' || m.userData.k === 'pupil' || m.userData.k === 'mouth' || m.userData.k === 'glass');
  for (const m of detail) m.castShadow = false;
  for (const m of P) if (m !== torso) { m.matrixAutoUpdate = false; m.updateMatrix(); }
  return { g, P, detail, far: false, head, torso, eyes, glasses, hairLong, bun, armL: aL.pv, armR: aR.pv, elL: aL.el, elR: aR.el, standing, label: null, hand: null, bub: null, key: '', tx: 0, tz: 0, ph: Math.random() * 6.28, raised: false };
}
function look(f, id, off) {
  const h = hash(id);
  const c = { shirt: pick(SHIRT, h), jacket: 0x1d2b57, shirtw: 0xf7f9ff, tie: pick(TIE, h, 3), pants: pick(UNI_PANTS, h, 5), skin: pick(SKIN, h, 9), hair: pick(HAIR, h, 13), shoe: 0x222222, eye: 0xffffff, pupil: 0x151515, mouth: 0x9a4a4a, glass: 0x20242c };
  for (const m of f.P) { const k = m.userData.k; m.material = off ? mat(0x8a93a3, { transparent: true, opacity: 0.5 }) : mat(c[k]); }
  const hv = (h >>> 17) % 4;
  f.hairLong.visible = hv === 1; f.bun.visible = hv === 2; f.glasses.visible = ((h >>> 21) % 4) === 0;
}

function applyScene() {
  if (!R || !C.st || !L) return;
  if (!R.roomG || R.roomG.userData.k !== L.cols + '/' + L.cap) { buildRoom(); R.roomG.userData.k = L.cols + '/' + L.cap; }
  const seen = new Set(), me = myId(), first = !R.populated;
  for (const e of C.st.seats) {
    seen.add(e.id);
    let f = R.figs.get(e.id);
    const p = seatPos(e.s);
    if (!f) {
      f = makeFigure(false); f.g.rotation.y = 0; R.figs.set(e.id, f); R.scene.add(f.g);
      if (first) f.g.position.set(p.x, 0, p.z); else f.g.position.set(L.W / 2 - 1.4, 0, L.D - 0.6);   // yangi kelgan eshikdan kirib keladi
    }
    f.tx = p.x; f.tz = p.z; f.seat = e.s; f.id = e.id; f.raised = !!e.h;
    const key = [e.n, e.a, e.o, e.id === me, e.b].join('|');
    if (f.key !== key) {
      f.key = key; look(f, e.id, !!e.o);
      disposeSprite(f.label);
      f.label = label((e.a ? e.a + ' ' : '') + e.n + (e.b ? ' 🚫' : ''), e.id === me ? '#0e8aa8' : '#0a101e', e.o ? 0.55 : 0.85);
      f.label.position.set(0, 1.78, 0); f.g.add(f.label);
    }
    if (e.h && !f.hand) { f.hand = handSprite(); f.hand.position.set(0.3, 2.1, 0); f.g.add(f.hand); }
    if (!e.h && f.hand) { disposeSprite(f.hand); f.hand = null; }
  }
  R.populated = true;
  for (const [id, f] of R.figs) if (!seen.has(id)) { disposeSprite(f.label); disposeSprite(f.hand); disposeSprite(f.bub); R.scene.remove(f.g); R.figs.delete(id); }
  // bo'sh o'rin belgilari
  const locked = !!(C.cfg && C.cfg.seatLock) && !isHost();
  R.markers.forEach((m, i) => { m.visible = !personAt(i) && !locked; });
  // o'qituvchi
  const h = C.st.host;
  if (h && h.on) {
    if (!R.teacher) {
      const t = makeFigure(true, true); t.g.rotation.y = Math.PI; look(t, 'teacher', false);
      for (const m of t.P) if (m.userData.k === 'shirt') m.material = mat(0x315b84);
      t.glasses.visible = true;
      add(t.g, 0.12, 0.3, 0.035, 0xc43e45, 0, 1.25, -0.17);
      add(t.g, 0.08, 0.08, 0.04, 0xe7bd65, 0, 1.44, -0.17);
      const lapelL = add(t.g, 0.08, 0.28, 0.035, 0x244766, -0.13, 1.31, -0.16); lapelL.rotation.z = -0.25;
      const lapelR = add(t.g, 0.08, 0.28, 0.035, 0x244766, 0.13, 1.31, -0.16); lapelR.rotation.z = 0.25;
      t.g.scale.setScalar(1.08);
      t.armR.rotation.x = 2.0; t.elR.rotation.x = 0.2; R.teacher = t; R.scene.add(t.g);
      const hb = new T.Mesh(box(0.9, 2.1, 0.9), new T.MeshBasicMaterial({ visible: false })); hb.position.set(0, 1.05, 0); hb.userData.teacher = 1; t.g.add(hb); t.hb = hb;
    }
    const k = h.n;
    if (R.teacher.key !== k) { R.teacher.key = k; disposeSprite(R.teacher.label); R.teacher.label = label('👨‍🏫 ' + (h.n || 'Ustoz'), '#8a5a00', 0.92); R.teacher.label.position.set(0, 2.25, 0); R.teacher.g.add(R.teacher.label); }
    R.teacher.g.position.set(tpx(), PF, TP.z); R.teacher.g.visible = true;
  } else if (R.teacher) R.teacher.g.visible = false;
  markSel(); drawBoard();
  renderAwards();
  R.shadowDirty = true; R.dirty = true;
}

// ---- doska yozuvi + soat
function drawClock(d) {
  const x = R.clockCv.getContext('2d'), s = R.clockCv.width, c = s / 2;
  x.clearRect(0, 0, s, s); x.fillStyle = '#6b4a2b'; x.beginPath(); x.arc(c, c, c - 2, 0, 7); x.fill();
  x.fillStyle = '#fbf8ef'; x.beginPath(); x.arc(c, c, c - 14, 0, 7); x.fill(); x.strokeStyle = '#2b2b2b'; x.lineCap = 'round';
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; x.lineWidth = i % 3 ? 3 : 6; x.beginPath(); x.moveTo(c + Math.sin(a) * (c - 26), c - Math.cos(a) * (c - 26)); x.lineTo(c + Math.sin(a) * (c - 42), c - Math.cos(a) * (c - 42)); x.stroke(); }
  const hand = (a, len, w, color) => { x.strokeStyle = color; x.lineWidth = w; x.beginPath(); x.moveTo(c, c); x.lineTo(c + Math.sin(a) * len, c - Math.cos(a) * len); x.stroke(); };
  const seconds = d.getSeconds() + d.getMilliseconds() / 1000, minutes = d.getMinutes() + seconds / 60, hours = d.getHours() % 12 + minutes / 60;
  hand(hours / 12 * 6.283, c * 0.43, 9, '#20252b');
  hand(minutes / 60 * 6.283, c * 0.68, 6, '#20252b');
  hand(seconds / 60 * 6.283, c * 0.76, 2.5, '#c0392b');
  x.fillStyle = '#c0392b'; x.beginPath(); x.arc(c, c, 8, 0, 7); x.fill(); R.clockTex.needsUpdate = true;
}
function drawBoard() {
  if (!R || !R.boardCv || !C.st) return;
  const S = SS(), items = S.items || [], cur = items.find(i => i.id === (S.st && S.st.currentId));
  const title = cur ? (cur.name || cur.title || '') : '', playing = !!(S.st && S.st.playing);
  const on = C.st.seats.filter(e => !e.o).length, d = new Date(), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const winners = C.award && C.award.top || [];
  const awardKey = winners.map((w, i) => `${i}:${w.name}:${w.score}`).join('|');
  const sig = [S.roomName, S.code, title, playing, on, C.st.seats.length, C.st.cap, hm, awardKey].join('|');
  if (sig === R.boardSig) return; R.boardSig = sig;
  drawClock(d);
  const cv = R.boardCv, x = cv.getContext('2d'), w = cv.width, h = cv.height;
  const gr = x.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#244a3a'); gr.addColorStop(1, '#1b3a2d'); x.fillStyle = gr; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(255,255,255,.04)'; for (let i = 0; i < 40; i++) x.fillRect((i * 97) % w, (i * 53) % h, 90, 3);
  x.fillStyle = '#f4f1e6'; x.textBaseline = 'top';
  const fs = Math.round(h * 0.28); x.font = `italic 700 ${fs}px "Segoe Print","Comic Sans MS","Bradley Hand",cursive`;
  x.fillText((winners.length ? '🏆 G‘oliblarni tabriklaymiz!' : (S.roomName || 'Dars xonasi')).slice(0, 22), w * 0.05, h * 0.1, w * 0.62);
  x.font = `700 ${Math.round(h * 0.15)}px system-ui,sans-serif`; x.fillStyle = '#ffe9a8';
  const podiumText = winners.map((winner, i) => `${['🥇', '🥈', '🥉'][i]} ${winner.name}`).join(' · ');
  x.fillText(winners.length ? podiumText : 'Kod: ' + (S.code || ''), w * 0.05, h * 0.46, w * 0.9);
  x.font = `600 ${Math.round(h * 0.14)}px system-ui,sans-serif`;
  x.fillStyle = '#cfe8d6'; x.fillText(`👥 ${on} o'quvchi · ${C.st.cap} ta joy`, w * 0.05, h * 0.64);
  const media = BR() && BR().classroomMedia ? BR().classroomMedia() : null;
  const mediaTitle = media && media.kind === 'audio' ? '🎵 ' + (title || 'Audio') : title;
  x.fillStyle = '#9ad1ff'; x.fillText((playing ? '▶ ' : '⏸ ') + (mediaTitle ? mediaTitle.slice(0, 34) : 'Hozircha fayl tanlanmagan'), w * 0.05, h * 0.82, w * 0.9);
  x.textAlign = 'right'; x.fillStyle = '#f4f1e6'; x.font = `700 ${Math.round(h * 0.2)}px system-ui,sans-serif`; x.fillText(hm, w * 0.95, h * 0.1); x.textAlign = 'left';
  x.strokeStyle = 'rgba(244,241,230,.55)'; x.lineWidth = 4; x.beginPath(); x.moveTo(w * 0.05, h * 0.4); x.lineTo(w * 0.7, h * 0.42); x.stroke();
  R.boardTex.needsUpdate = true;
}

// ---- ulashilgan kontent: video / rasm / ekran — jonli; PDF, matn, hujjat, YouTube, arxiv — karta (3D ko'rinishlarda).
// Doskaga yaqinlashilganda hammasi haqiqiy sifatda "proyektor" rejimida ko'rsatiladi (yuqoriga qarang).
const extOf = n => (String(n || '').match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const fmtSize = b => !b ? '' : b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const CARD_KINDS = new Set(['pdf', 'text', 'doc', 'archive', 'youtube']);
const OFFICE = { doc: ['📘', 'Word hujjati', '#2b579a'], docx: ['📘', 'Word hujjati', '#2b579a'], xls: ['📗', 'Excel jadvali', '#1d6f42'], xlsx: ['📗', 'Excel jadvali', '#1d6f42'], csv: ['📗', 'Jadval (CSV)', '#1d6f42'], ppt: ['📙', 'PowerPoint', '#c43e1c'], pptx: ['📙', 'PowerPoint', '#c43e1c'], odt: ['📘', 'Hujjat', '#2b579a'], ods: ['📗', 'Jadval', '#1d6f42'], odp: ['📙', 'Taqdimot', '#c43e1c'] };
function cardStyle(p) {
  const k = p.cardKind;
  if (k === 'pdf') return ['📄', 'PDF hujjat', '#b3261e'];
  if (k === 'text') return ['📝', 'Matn fayli', '#3b6fb5'];
  if (k === 'youtube') return ['▶', 'YouTube video', '#d12a2a'];
  if (k === 'archive') return ['📦', 'Arxiv', '#8a6a2b'];
  if (k === 'doc') return OFFICE[extOf(p.title)] || ['📎', 'Fayl', '#5b6b88'];
  return ['🖥', 'Kontent', '#4a5d85'];
}
const ytThumbs = new Map();
function ytThumb(id) {
  let e = ytThumbs.get(id); if (e) return e.ok ? e.img : null;
  const img = new Image(); e = { img, ok: false }; ytThumbs.set(id, e);
  img.crossOrigin = 'anonymous';
  img.onload = () => { e.ok = true; if (R) { R.mkey = ''; poke(); } };
  img.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg';
  return null;
}
function wrapLines(x, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  return lines;
}
function drawCard(x, ox, oy, w, h, p) {
  const [ico, label, col] = cardStyle(p), u = h / 720;
  x.save(); x.translate(ox, oy);
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#0f1a33'); g.addColorStop(1, '#1f2f55'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  const th = p.ytId ? ytThumb(p.ytId) : null;
  if (th) {
    const s = Math.max(w / th.naturalWidth, h / th.naturalHeight); x.drawImage(th, (w - th.naturalWidth * s) / 2, (h - th.naturalHeight * s) / 2, th.naturalWidth * s, th.naturalHeight * s);
    x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(209,42,42,.95)'; x.beginPath(); x.roundRect ? x.roundRect(w / 2 - 90 * u, h * 0.4 - 62 * u, 180 * u, 124 * u, 30 * u) : x.rect(w / 2 - 90 * u, h * 0.4 - 62 * u, 180 * u, 124 * u); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(w / 2 - 22 * u, h * 0.4 - 36 * u); x.lineTo(w / 2 - 22 * u, h * 0.4 + 36 * u); x.lineTo(w / 2 + 38 * u, h * 0.4); x.fill();
  } else {
    x.fillStyle = col; x.beginPath(); x.arc(w / 2, h * 0.34, 118 * u, 0, 7); x.fill();
    x.font = `${150 * u}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText(ico, w / 2, h * 0.34 + 8 * u);
  }
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#9ad1ff'; x.font = `700 ${34 * u}px system-ui,sans-serif`; x.fillText(label.toUpperCase(), w / 2, h * 0.64);
  x.fillStyle = '#fff'; x.font = `700 ${50 * u}px system-ui,sans-serif`;
  const lines = wrapLines(x, p.title || label, w * 0.82, 2);
  lines.forEach((l, i) => x.fillText(l, w / 2, h * 0.74 + i * 58 * u));
  const meta = [fmtSize(p.size), extOf(p.title).toUpperCase()].filter(Boolean).join(' · ');
  if (meta) { x.fillStyle = '#a9bcd6'; x.font = `600 ${28 * u}px system-ui,sans-serif`; x.fillText(meta, w / 2, h * 0.74 + lines.length * 58 * u + 6 * u); }
  x.fillStyle = 'rgba(255,255,255,.55)'; x.font = `600 ${26 * u}px system-ui,sans-serif`; x.fillText('Doskani bosing — to‘liq ko‘rinish', w / 2, h - 28 * u);
  x.restore();
}
function boardProjection() {
  const media = BR() && BR().classroomMedia ? BR().classroomMedia() : null;
  if (media && media.stream) {
    if (boardScreen.srcObject !== media.stream) {
      boardScreen.srcObject = media.stream;
      boardScreen.play().catch(e => console.warn('[3d] doska ekran videosi ochilmadi', e));
    }
    return boardScreen.readyState >= 2 && boardScreen.videoWidth ? { source: boardScreen, kind: 'video', title: media.title, playing: true } : null;
  }
  if (boardScreen.srcObject) { boardScreen.pause(); boardScreen.srcObject = null; }
  if (media && media.video && media.video.readyState >= 2 && media.video.videoWidth) {
    return { source: media.video, kind: 'video', title: media.title, playing: media.playing };
  }
  if (media && media.image && media.image.complete && media.image.naturalWidth) {
    return { source: media.image, kind: 'image', title: media.title, playing: false };
  }
  if (media && CARD_KINDS.has(media.kind)) return { kind: 'card', cardKind: media.kind, title: media.title, size: media.size, ytId: media.ytId, playing: false };
  return null;
}
function drawBoardProjection(ctx, projection, x, y, w, h) {       // oflayn (Canvas) zaxira uchun
  if (projection.kind === 'card') { drawCard(ctx, x, y, w, h, projection); return; }
  ctx.fillStyle = '#10151d'; ctx.fillRect(x, y, w, h);
  const source = projection.source, sw = source.videoWidth || source.naturalWidth, sh = source.videoHeight || source.naturalHeight;
  const scale = Math.min(w / sw, h / sh), dw = sw * scale, dh = sh * scale;
  ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function watchVideo(v) {
  if (R.vWatch === v) return;
  R.vWatch = v; R.vRvfc = !!(v && v.requestVideoFrameCallback);
  if (!R.vRvfc) return;
  const cb = () => { if (R.vWatch !== v) return; R.vfDirty = true; R.dirty = true; v.requestVideoFrameCallback(cb); };
  v.requestVideoFrameCallback(cb);
}
function ensureMediaTex(live, tw, th) {
  if (!R.mtex || R.mLive !== live) {
    if (R.mtex) R.mtex.dispose();
    R.mcv = document.createElement('canvas');
    R.mtex = new T.CanvasTexture(R.mcv); R.mLive = live;
    R.mtex.generateMipmaps = !live; R.mtex.minFilter = live ? T.LinearFilter : T.LinearMipmapLinearFilter; R.mtex.anisotropy = ANISO;
    R.scr.material.map = R.mtex; R.scr.material.color.set(0xffffff); R.scr.material.needsUpdate = true;
  }
  if (R.mcv.width !== tw || R.mcv.height !== th) { R.mcv.width = tw; R.mcv.height = th; R.mtex.dispose(); }
}
function syncBoardMedia(now) {
  if (!R || !R.scr || !C.st) return;
  let p = boardProjection();
  if (p && p.source) {                                  // boshqa domendan (CORS yo'q) kelgan manba WebGL tekstura bo'lolmaydi — karta ko'rsatiladi
    const url = p.source.currentSrc || p.source.src || '';
    if (p.source !== boardScreen && url) {
      try { const u = new URL(url, location.href); if (u.protocol !== 'blob:' && u.protocol !== 'data:' && u.origin !== location.origin) p = { kind: 'card', cardKind: 'doc', title: p.title, playing: false }; }
      catch { p = null; }
    }
  }
  if (!p) { if (R.scr.visible) { R.scr.visible = R.scrBack.visible = false; R.dirty = true; } R.mkey = ''; R.mSrc = null; watchVideo(null); return; }
  const live = p.kind === 'video', card = p.kind === 'card';
  if (live) { watchVideo(p.source); if (p.playing && !R.vRvfc) R.dirty = true; } else watchVideo(null);
  const maxW = C.view === 'board' ? (QUALITY.low ? 1920 : 2560) : (QUALITY.low ? 960 : 1280);
  let sw = 1280, sh = 720;
  if (!card) { sw = p.source.videoWidth || p.source.naturalWidth; sh = p.source.videoHeight || p.source.naturalHeight; }
  if (!sw || !sh) return;
  const k = Math.min(1, maxW / sw), tw = Math.max(2, Math.round(sw * k)), th = Math.max(2, Math.round(sh * k));
  const key = [p.kind, p.cardKind || '', p.title || '', p.playing, tw, th].join('|');
  const src = card ? p.title : p.source;
  const due = live && p.playing && (R.vfDirty || !R.vRvfc) && now - R.mAt >= (QUALITY.low ? 66 : 33);
  if (key === R.mkey && R.mSrc === src && !due) return;
  ensureMediaTex(live, tw, th);
  const x = R.mcv.getContext('2d');
  if (card) drawCard(x, 0, 0, tw, th, p); else x.drawImage(p.source, 0, 0, tw, th);
  R.mtex.needsUpdate = true;
  R.mkey = key; R.mSrc = src; R.mAt = now; R.vfDirty = false; R.dirty = true;
  const { bw, bh } = boardDims(), avW = bw - 0.14, avH = bh - 0.14, asp = tw / th;
  const pw = avW / avH > asp ? avH * asp : avW, ph = avW / avH > asp ? avH : avW / asp;
  R.scr.scale.set(pw, ph, 1); R.scr.updateMatrix();
  R.scr.visible = R.scrBack.visible = true;
}

function markSel() {
  if (!R) return;
  if (!R.ring) { R.ring = new T.Mesh(new T.RingGeometry(0.42, 0.55, 36), new T.MeshBasicMaterial({ color: 0xffd23f, side: T.DoubleSide, depthTest: false, transparent: true, opacity: 0.95 })); R.ring.rotation.x = -Math.PI / 2; R.ring.renderOrder = 9; R.scene.add(R.ring); }
  const f = C.sel && R.figs.get(C.sel);
  R.ring.visible = !!f; if (f) R.ring.position.set(f.tx, 0.03, f.tz);
  R.dirty = true;
}
function bubble(key, text) {
  if (!R) return;
  const f = key === 'host' ? R.teacher : R.figs.get(key); if (!f) return;
  disposeSprite(f.bub); f.bub = bubbleSprite('🤫 ' + text); f.bub.position.set(0, (f.standing ? 2.5 : 1.95), 0); f.g.add(f.bub);
  R.bubbles = R.bubbles.filter(b => b.f !== f); R.bubbles.push({ f, until: performance.now() + 6000 });
}

// ---- kamera va kadr
const dirv = (yaw, p, v) => v.set(Math.sin(yaw) * Math.cos(p), Math.sin(p), -Math.cos(yaw) * Math.cos(p));
const _v = () => new T.Vector3();
function frame(t, dt) {
  if (!L) return;
  const cam = R.camera, me = myId(), s = mySeat(), host = isHost(), sec = t / 1000, now = performance.now();
  const board = C.view === 'board';
  let pos, tgt, fov;
  const v = R.v1 || (R.v1 = _v());
  if (C.view === 'pov') {
    let base = 0;
    if (host) { pos = new T.Vector3(tpx(), PF + 1.68, TP.z + 0.15); base = Math.PI; }
    else if (s != null) { const p = seatPos(s); pos = new T.Vector3(p.x, 1.3 + Math.sin(sec * 1.3) * 0.006, p.z + 0.02); }
    else pos = new T.Vector3(0, 1.6, L.D - 1.2);
    tgt = pos.clone().add(dirv(base + C.yaw, C.pitch, v).multiplyScalar(3)); fov = 72;
  } else if (board) {
    const { by } = boardDims();
    pos = new T.Vector3(0, by, C.boardRad);
    tgt = new T.Vector3(0, by, 0);
    fov = 36;
  } else {
    if (now - C.idle > 8000 && now - C.idle < 33000) { C.oy += dt * 0.07; R.active = Math.max(R.active, t + 100); }   // harakatsiz bo'lsa sekin aylanadi (25 s dan keyin to'xtaydi — CPU tinchlanadi)
    const tg = new T.Vector3(0, C.award ? 1.55 : 0.9, C.award ? 1.55 : L.D * 0.45), cp = Math.cos(C.op);
    pos = tg.clone().add(new T.Vector3(Math.sin(C.oy) * cp, Math.sin(C.op), Math.cos(C.oy) * cp).multiplyScalar(C.rad)); tgt = tg; fov = 52;
  }
  if (cam.aspect < 1 && !board) fov = Math.min(105, fov / Math.pow(cam.aspect, 0.55));   // tik (portret) ekranda ko'rish maydoni kengaytiriladi
  const k = 1 - Math.exp(-dt * 7);
  const movedCam = R.cp.distanceToSquared(pos) > 1e-5 || R.ct.distanceToSquared(tgt) > 1e-5 || Math.abs(cam.fov - fov) > 0.05;
  if (movedCam) R.active = Math.max(R.active, t + 120);
  R.cp.lerp(pos, k); R.ct.lerp(tgt, k);
  cam.position.copy(R.cp); cam.lookAt(R.ct);
  if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * k; cam.updateProjectionMatrix(); }
  const hide = C.view === 'orbit'; for (const o of R.ceilObjs) o.visible = !hide;
  const kk = 1 - Math.exp(-dt * 8), farD = (C.view === 'orbit' ? Math.max(14, C.rad * 0.9) : 10) * (C.st && C.st.seats.length > 60 ? 0.7 : 1);   // odam ko'p bo'lsa tafsilotlar yaqinroqdan o'chadi
  let anyMove = false;
  for (const f of R.figs.values()) {
    const own = f.id === me && C.view === 'pov', vis = !board && !own;
    f.g.visible = vis;
    const dx = f.tx - f.g.position.x, dz = f.tz - f.g.position.z, mv = Math.abs(dx) + Math.abs(dz) > 0.03;
    if (mv) { anyMove = true; R.active = Math.max(R.active, t + 120); }
    if (!vis) continue;
    f.g.position.x += dx * kk; f.g.position.z += dz * kk; f.g.position.y = mv ? Math.abs(Math.sin(sec * 9)) * 0.12 : 0;
    const d = f.g.position.distanceTo(cam.position), far = d > farD;
    if (f.far !== far) { f.far = far; for (const m of f.detail) m.visible = !far; }      // uzoqdagi odamlarda mayda tafsilotlar chizilmaydi
    f.head.rotation.y = Math.sin(sec * 0.5 + f.ph) * 0.22; f.head.rotation.x = Math.sin(sec * 0.7 + f.ph * 2) * 0.05;
    f.torso.scale.y = 1 + Math.sin(sec * 1.6 + f.ph) * 0.012;                                    // nafas
    if (!far) { const bl = ((sec + f.ph) % 4.3) < 0.13 ? 0.1 : 1; f.eyes[0].scale.y = bl; f.eyes[1].scale.y = bl; }   // pirpirash
    if (f.raised) { f.armR.rotation.x = Math.PI * 0.92; f.armR.rotation.z = -0.15 + Math.sin(sec * 6 + f.ph) * 0.18; f.elR.rotation.x = 0.1; }
    else {
      f.armR.rotation.x += (0.7 - f.armR.rotation.x) * kk; f.armR.rotation.z += (0 - f.armR.rotation.z) * kk;
      f.elR.rotation.x += ((0.8 + Math.sin(sec * 4 + f.ph) * 0.035) - f.elR.rotation.x) * kk;     // yozayotgandek
    }
    f.elL.rotation.x = 0.8 + Math.sin(sec * 3.4 + f.ph * 2) * 0.03;
    if (f.label) f.label.visible = d > 1.6 && d < (C.view === 'pov' ? 11 : 60);   // juda yaqindagi nomlar ekranni to'smasin
  }
  for (const entry of R.awardFigures || []) {
    const progress = clamp((t - (entry.started || (entry.started = t))) / 900, 0, 1);
    const eased = 1 - (1 - progress) * (1 - progress);
    entry.figure.g.position.set(entry.startX + (entry.x - entry.startX) * eased, entry.figure.g.position.y, 3.4 - 1.55 * eased);
    entry.figure.armR.rotation.x = -1.3 + Math.sin(sec * 5 + entry.figure.ph) * 0.18;
    entry.figure.elR.rotation.x = 0.2;
  }
  for (const piece of R.confetti || []) {
    piece.position.y = piece.userData.baseY + Math.sin(sec * 2.2 + piece.userData.phase) * 0.38;
    piece.rotation.y += dt * (1.2 + (piece.userData.phase % 2));
    piece.rotation.z += dt * 0.7;
  }
  if (R.awardFigures && R.awardFigures.length) R.active = Math.max(R.active, t + 120);
  if (R.teacher) { const tt = R.teacher; tt.armR.rotation.z = 0.25 + Math.sin(sec * 1.6) * 0.12; tt.head.rotation.y = Math.sin(sec * 0.4) * 0.3; tt.torso.scale.y = 1 + Math.sin(sec * 1.5) * 0.01; tt.g.visible = !C.award && !board && !(C.view === 'pov' && host); }
  R.bubbles = R.bubbles.filter(b => { if (now > b.until) { disposeSprite(b.f.bub); b.f.bub = null; return false; } return true; });
  if (R.ring && R.ring.visible) R.ring.scale.setScalar(1 + Math.sin(sec * 5) * 0.06);
  if (!board) {
    R.mkMat.opacity = 0.32 + 0.2 * Math.sin(sec * 3);
    for (let i = 0; i < R.markers.length; i++) { const m = R.markers[i], hot = C.hover === i; if (!m.visible) continue; m.material = hot ? R.mkHot : R.mkMat; m.scale.setScalar(hot ? 1.3 : 1 + Math.sin(sec * 3 + i) * 0.04); m.updateMatrix(); }
  }
  const wallNow = new Date();
  if (R.clockSecond !== wallNow.getSeconds()) { drawClock(wallNow); R.clockSecond = wallNow.getSeconds(); drawBoard(); }
  syncBoardMedia(now);
  // soya xaritasi faqat sahna o'zgarganda (yoki odamlar harakatlanganda / har 2 s) yangilanadi
  if (R.renderer.shadowMap.enabled && (R.shadowDirty || (anyMove && now - R.shAt > 250) || now - R.shAt > 2000)) { R.renderer.shadowMap.needsUpdate = true; R.shadowDirty = false; R.shAt = now; }
  R.renderer.render(R.scene, cam);
}

// ---- sichqoncha / sensor
function pickAt(cx, cy) {
  if (!R) return null;
  const r = $('.c3-cv', dom).getBoundingClientRect();
  R.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  R.ray.setFromCamera(R.ndc, R.camera);
  const list = R.pick.slice(); if (R.teacher && R.teacher.hb && R.teacher.g.visible) list.push(R.teacher.hb);
  if (R.boardMesh && R.boardMesh.visible) list.push(R.boardMesh);
  if (R.scr && R.scr.visible) list.push(R.scr);
  const hits = R.ray.intersectObjects(list, false);
  return hits.length ? hits[0].object : null;
}
function hoverAt(e) {
  if (!R || R.hoverBusy) return; R.hoverBusy = true;
  const x = e.clientX, y = e.clientY;
  requestAnimationFrame(() => {
    R.hoverBusy = false; if (!C.open || C.view === 'plan') return;
    const o = pickAt(x, y); C.hover = o && o.userData.seat != null ? o.userData.seat : null;
    $('.c3-cv', dom).style.cursor = o ? 'pointer' : 'grab';
  });
}
function bindPointer(cv) {
  const ptrs = new Map(); let down = null, pinch = 0;
  cv.style.touchAction = 'none'; cv.style.cursor = 'grab';
  cv.addEventListener('pointerdown', e => {
    touch();
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); if (down) down.moved = true; }
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' && ptrs.size === 0) return hoverAt(e);
    const p = ptrs.get(e.pointerId); if (!p) return;
    touch();
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) {
        if (C.view === 'orbit') { C.rad = clamp(C.rad * pinch / d, 4, 45); C.zoomed = true; }
        else if (C.view === 'board') boardZoom(pinch / d);
      }
      pinch = d; return;
    }
    if (down && !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
    if (!down || !down.moved) return;
    if (C.view === 'pov') { C.yaw = clamp(C.yaw - dx * 0.004, -1.5, 1.5); C.pitch = clamp(C.pitch - dy * 0.003, -0.55, 0.6); }
    else if (C.view === 'orbit') { C.oy -= dx * 0.006; C.op = clamp(C.op + dy * 0.005, 0.12, 1.45); }
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    if (C.view !== 'board' && ptrs.size === 0 && down && !down.moved && performance.now() - down.t < 600) doPick(e);
    if (ptrs.size === 0) down = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); down = null; });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); touch();
    if (C.view === 'orbit') { C.rad = clamp(C.rad * Math.exp(e.deltaY * 0.001), 4, 45); C.zoomed = true; }
    else if (C.view === 'board') boardZoom(Math.exp(e.deltaY * 0.001));
  }, { passive: false });
}
function doPick(e) {
  const o = pickAt(e.clientX, e.clientY);
  if (!o) return select(null);
  if (o.userData.board) { setView('board'); return; }
  if (o.userData.teacher) { if (!isHost()) openWh('host'); return; }
  onSeat(o.userData.seat);
}

// ================================================================== OFLAYN 3D (Canvas perspektiva; Three.js/WebGL kerak emas)
function initFallback() {
  const cv = $('.c3-fb', dom); cv.hidden = C.view === 'plan';
  $('.c3-cv', dom).style.display = 'none';
  fallback = { cv, ctx: cv.getContext('2d'), raf: 0, hits: [], down: null, last: 0, hover: null };
  cv.style.touchAction = 'none';
  const hitAt = ev => {
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    return fallback.hits.slice().reverse().find(v => v.board ? x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h : Math.hypot(x - v.x, y - v.y) < v.rad);
  };
  cv.addEventListener('pointerdown', e => { fallback.down = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointermove', e => { const h = hitAt(e); fallback.hover = h && Number.isInteger(h.seat) ? h.seat : null; cv.style.cursor = h ? 'pointer' : 'default'; });
  cv.addEventListener('pointerup', e => {
    if (!fallback.down) return;
    const d = Math.hypot(e.clientX - fallback.down.x, e.clientY - fallback.down.y); fallback.down = null;
    if (d > 12) return;
    const h = hitAt(e);
    if (!h) return select(null);
    if (h.board) { setView('board'); return; }
    if (h.teacher) { if (!isHost()) openWh('host'); return; }
    onSeat(h.seat);
  });
  window.addEventListener('resize', () => { if (fallback && C.open) drawFallback(); });
  startFallback();
}
function startFallback() {
  if (!fallback || fallback.raf || !C.open || C.view === 'plan') return;
  const tick = t => {
    if (!fallback || !C.open || C.view === 'plan' || C.proj || document.hidden) { if (fallback) fallback.raf = 0; return; }
    fallback.raf = requestAnimationFrame(tick);
    if (t - fallback.last > 1000 / Math.min(QUALITY.fps, 30)) { drawFallback(t); fallback.last = t; }
  };
  fallback.raf = requestAnimationFrame(tick);
}
function drawFallback(t) {
  if (!fallback || !L || !C.st) return;
  const { cv, ctx: g } = fallback, dpr = Math.min(window.devicePixelRatio || 1, 1.6), sec = (t || performance.now()) / 1000;
  const w = Math.max(320, cv.clientWidth), h = Math.max(300, cv.clientHeight), cw = Math.round(w * dpr), ch = Math.round(h * dpr);
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); fallback.hits = [];
  if (C.view === 'board') { drawFallbackBoard(g, w, h); return; }
  const me = myId(), HH = H;
  const center = w * 0.5, horizon = h * 0.36, depth = Math.max(9, L.D + 3), scale = Math.min(w * 0.95, h * 1.7);
  const P = (x, z, y = 0) => { const zz = Math.max(0.6, depth - z + 1.6), k = scale / (zz + 5.5); return { x: center + x * k, y: horizon + (1.8 - y) * k + 30, k }; };
  const poly = (pts, fill, stroke) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.2; g.stroke(); } };
  const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0f1a30'); bg.addColorStop(1, '#2a3a52'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const hw = L.W / 2;
  poly([P(-hw, 0, HH), P(hw, 0, HH), P(hw, depth, HH), P(-hw, depth, HH)], '#e6e0d2');                         // shift
  poly([P(-hw, 0, 0), P(-hw, depth, 0), P(-hw, depth, HH), P(-hw, 0, HH)], '#bdc7c9');                       // chap devor
  poly([P(hw, 0, 0), P(hw, depth, 0), P(hw, depth, HH), P(hw, 0, HH)], '#d5dcd8');                           // o'ng devor
  poly([P(-hw, 0, 0), P(hw, 0, 0), P(hw, depth, 0), P(-hw, depth, 0)], '#b98a54');                           // pol
  poly([P(-hw, 0, HH), P(hw, 0, HH), P(hw, 0, 0), P(-hw, 0, 0)], '#ece4d2');                                  // old devor
  for (let z = 0; z < depth; z += 1.5) { const a = P(-hw, z), b = P(hw, z); g.strokeStyle = '#76583d66'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  for (let z = 2.6; z < L.D - 1.5; z += 3.2) poly([P(-hw, z - 0.75, 2.75), P(-hw, z + 0.75, 2.75), P(-hw, z + 0.75, 1.15), P(-hw, z - 0.75, 1.15)], '#9fd0f5', '#fff'); // oynalar
  // podium + doska
  poly([P(-hw, 0, PF), P(hw, 0, PF), P(hw, 2.4, PF), P(-hw, 2.4, PF)], '#9a7048');
  const bw = Math.min(L.W - 2.6, 7.6) / 2, bl = P(-bw, 0.07, 2.9), br = P(bw, 0.07, 1.2);
  g.fillStyle = '#6b4a2b'; g.fillRect(bl.x - 8, bl.y - 8, br.x - bl.x + 16, br.y - bl.y + 16);
  g.fillStyle = '#1f4535'; g.fillRect(bl.x, bl.y, br.x - bl.x, br.y - bl.y);
  const S = SS(), items = S.items || [], cur = items.find(i => i.id === (S.st && S.st.currentId)), title = cur ? (cur.name || cur.title || '') : '', playing = !!(S.st && S.st.playing);
  const bh = br.y - bl.y, fz = Math.max(11, Math.min(26, bh * 0.2));
  g.textAlign = 'left'; g.fillStyle = '#f4f1e6'; g.font = `italic 700 ${fz * 1.3}px "Segoe Print","Comic Sans MS",cursive`; g.fillText((S.roomName || 'Dars xonasi').slice(0, 22), bl.x + 14, bl.y + fz * 1.6, br.x - bl.x - 28);
  g.font = `600 ${fz * 0.75}px system-ui`; g.fillStyle = '#ffe9a8'; g.fillText('Kod: ' + (S.code || ''), bl.x + 14, bl.y + fz * 2.8);
  g.fillStyle = '#9ad1ff'; g.fillText((playing ? '▶ ' : '⏸ ') + (title ? title.slice(0, 40) : 'Fayl tanlanmagan'), bl.x + 14, bl.y + fz * 3.9, br.x - bl.x - 28);
  fallback.hits = [{ board: true, x: bl.x, y: bl.y, w: br.x - bl.x, h: br.y - bl.y }];
  // ustoz
  const th = C.st.host;
  if (th && th.on) {
    const p = P(tpx(), TP.z, PF), sz = Math.max(10, p.k * 0.36);
    g.fillStyle = '#2f5d8a'; g.beginPath(); g.ellipse(p.x, p.y - sz * 1.2, sz * 0.75, sz * 1.5, 0, 0, 7); g.fill();
    g.fillStyle = '#e3b28a'; g.beginPath(); g.arc(p.x, p.y - sz * 3.0, sz * 0.58, 0, 7); g.fill();
    g.fillStyle = '#342a2a'; g.beginPath(); g.arc(p.x, p.y - sz * 3.2, sz * 0.58, Math.PI, 7); g.fill();
    g.textAlign = 'center'; g.fillStyle = '#ffd98a'; g.font = `700 ${Math.max(11, Math.min(15, sz * 0.9))}px system-ui`; g.fillText('👨‍🏫 ' + (th.n || 'Ustoz'), p.x, p.y - sz * 4.0);
    fallback.hits.push({ teacher: 1, seat: -1, x: p.x, y: p.y - sz * 2, rad: sz * 2.2 });
  }
  // partalar, stullar, o'quvchilar (uzoqdan yaqinga)
  const nb = neighbors(); g.textAlign = 'center';
  for (let r = 0; r < L.rows; r++) for (let pr = 0; pr < L.pairs; pr++) {
    const a = seatPos(r * L.cols + pr * 2), x = a.cx, z = a.z - 0.7;
    poly([P(x - 1.15, z - 0.35, 0.78), P(x + 1.15, z - 0.35, 0.78), P(x + 1.15, z + 0.35, 0.78), P(x - 1.15, z + 0.35, 0.78)], '#d9ae75', '#8b603b');
    poly([P(x - 1.15, z + 0.35, 0.78), P(x + 1.15, z + 0.35, 0.78), P(x + 1.15, z + 0.35, 0.62), P(x - 1.15, z + 0.35, 0.62)], '#92613f');
    for (let side = 0; side < 2; side++) {
      const si = r * L.cols + pr * 2 + side, sp = seatPos(si), p = P(sp.x, sp.z, 0.5), e = personAt(si), sz = Math.max(8, p.k * 0.29);
      g.fillStyle = '#3f6fb5'; g.fillRect(p.x - sz * 0.8, p.y - sz * 0.4, sz * 1.6, sz * 0.7);
      if (e) {
        const shirt = '#' + pick(SHIRT, hash(e.id)).toString(16).padStart(6, '0'), skin = '#' + pick(SKIN, hash(e.id), 9).toString(16).padStart(6, '0'), hair = '#' + pick(HAIR, hash(e.id), 13).toString(16).padStart(6, '0');
        const bob = Math.sin(sec * 1.6 + si) * sz * 0.03;
        g.fillStyle = e.o ? '#8492a2' : shirt; g.beginPath(); g.ellipse(p.x, p.y - sz * 0.9 + bob, sz * 0.75, sz, 0, 0, 7); g.fill();
        g.fillStyle = e.o ? '#aab3c0' : skin; g.beginPath(); g.arc(p.x, p.y - sz * 2.05 + bob, sz * 0.56, 0, 7); g.fill();
        g.fillStyle = hair; g.beginPath(); g.arc(p.x, p.y - sz * 2.2 + bob, sz * 0.56, Math.PI, 7); g.fill();
        const ring = e.id === C.sel ? '#ffd23f' : e.id === me ? '#4ade80' : (nb.left && nb.left.id === e.id) || (nb.right && nb.right.id === e.id) ? '#7dd3fc' : null;
        if (ring) { g.strokeStyle = ring; g.lineWidth = 2.5; g.beginPath(); g.ellipse(p.x, p.y - sz * 1.4, sz * 1.05, sz * 1.9, 0, 0, 7); g.stroke(); }
        g.fillStyle = '#fff'; g.font = `600 ${Math.max(10, Math.min(14, sz * 0.8))}px system-ui`; g.fillText((e.n || '?').slice(0, 14), p.x, p.y - sz * 3.1);
        if (e.h) g.fillText('✋', p.x + sz, p.y - sz * 2.6);
      } else if (!(C.cfg && C.cfg.seatLock && !isHost())) {
        g.fillStyle = fallback.hover === si ? '#ffd23f' : '#4ade80aa'; g.beginPath(); g.ellipse(p.x, p.y, sz * 0.9, sz * 0.4, 0, 0, 7); g.fill();
      }
      fallback.hits.push({ seat: si, x: p.x, y: p.y - sz * (e ? 1.6 : 0.3), rad: Math.max(20, sz * 1.8) });
    }
  }
  g.fillStyle = '#ffffffcc'; g.font = '600 13px system-ui'; g.textAlign = 'left';
  g.fillText('🎓 ' + C.st.seats.length + ' ishtirokchi · bo\'sh (yashil) o\'rindiqni bosing · 📡 oflayn 3D rejim', 18, h - 20);
}

function drawFallbackBoard(g, w, h) {
  const S = SS(), items = S.items || [], cur = items.find(i => i.id === (S.st && S.st.currentId));
  const title = cur ? (cur.name || cur.title || '') : 'Hozircha fayl tanlanmagan';
  const zoom = C.boardZoomed ? fitBoardDistance() / C.boardRad : 1;
  const boardW = Math.min(w * 0.9, h * 0.62 * 3.8), boardH = boardW / 3.8;
  const x = (w - boardW) / 2, y = h * 0.43 - boardH / 2;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#111d32'); grad.addColorStop(1, '#263a55');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h * 0.43); g.scale(zoom, zoom); g.translate(-w / 2, -h * 0.43);
  g.fillStyle = '#6b4a2b'; g.fillRect(x - 12, y - 12, boardW + 24, boardH + 24);
  const board = g.createLinearGradient(x, y, x + boardW, y + boardH);
  board.addColorStop(0, '#244a3a'); board.addColorStop(1, '#183729');
  g.fillStyle = board; g.fillRect(x, y, boardW, boardH);
  g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, boardW - 4, boardH - 4);
  const projection = boardProjection();
  if (projection) {
    drawBoardProjection(g, projection, x + 8, y + 8, boardW - 16, boardH - 16);
    g.restore();
    return;
  }
  const pad = boardW * 0.06;
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = '#f4f1e6'; g.font = `italic 700 ${Math.max(20, boardH * 0.17)}px system-ui,sans-serif`;
  g.fillText((S.roomName || 'Dars xonasi').slice(0, 32), x + pad, y + boardH * 0.09, boardW * 0.68);
  g.textAlign = 'right'; g.font = `700 ${Math.max(16, boardH * 0.11)}px system-ui,sans-serif`;
  g.fillText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), x + boardW - pad, y + boardH * 0.1);
  g.textAlign = 'left'; g.fillStyle = '#ffe9a8'; g.font = `700 ${Math.max(15, boardH * 0.1)}px system-ui,sans-serif`;
  g.fillText(`Xona kodi: ${S.code || '—'}`, x + pad, y + boardH * 0.39);
  g.fillStyle = '#cfe8d6'; g.font = `600 ${Math.max(14, boardH * 0.09)}px system-ui,sans-serif`;
  const on = C.st ? C.st.seats.filter(e => !e.o).length : 0;
  g.fillText(`O‘quvchilar: ${on} / ${C.st ? C.st.seats.length : 0}`, x + pad, y + boardH * 0.57);
  g.fillStyle = '#9ad1ff';
  g.fillText(`${S.st && S.st.playing ? '▶' : '⏸'} ${title.slice(0, 56)}`, x + pad, y + boardH * 0.75, boardW - pad * 2);
  g.restore();
}

// ------------------------------------------------------------------ ulash
window.CLS3D = { on, cfg, quiz: onQuiz, reset, open: openOverlay, close: closeOverlay, isOpen: () => C.open };
if (window.__cls3dQ) { const q = window.__cls3dQ; window.__cls3dQ = null; q.forEach(on); }
if (BR() && SS().cfg) cfg(SS().cfg);
})();