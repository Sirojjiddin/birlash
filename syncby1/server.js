'use strict';
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline, Transform } = require('stream');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
// .env faylini (agar bo'lsa) o'qiydi — qo'shimcha paketsiz
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { /* .env yo'q — muammo emas */ }

const PORT = process.env.PORT || 3000;
const MAX_MB = Number(process.env.MAX_MB) || 7168;       // bitta fayl uchun limit (standart 7 GB)
const MAX_BYTES = MAX_MB * 1024 * 1024;
const fmtLimit = mb => (mb >= 1024 ? (mb / 1024).toFixed(mb % 1024 ? 1 : 0) + ' GB' : mb + ' MB');
const MAX_ROOMS = 300;
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 500;   // xonadagi receiverlar
const MAX_FILE_STREAMS = Number(process.env.MAX_FILE_STREAMS) || 48;   // bir vaqtda beriladigan fayl so'rovlari (qolganlari 1 s kutadi)
const HOST_FANOUT = 6;                                   // Transmitterdan to'g'ridan-to'g'ri efir oladigan receiverlar
const HOST_MAX = 14;                                     // relay topilmasa, Transmitter yana nechtagacha qabul qiladi
const RELAY_FANOUT = 3;                                  // har bir relay-receiver nechta receiverga efir uzatadi
const REACTS = ['👏', '🔥', '❤️', '😂', '😮', '👍', '🎉'];
const LEAD = 1500;                                       // "Play" bosilgandan keyin boshlanish kechikishi (ms)
const SEEK_LEAD = 700;
const AUTOPLAY_LEAD = 2500;                              // keyingi trekka o'tishda yuklashga vaqt
const IDLE_ROOM_MS = 10 * 60 * 1000;                     // hech kim yo'q xona 10 daqiqadan keyin o'chadi
const MAX_HOSTLESS_MS = 60 * 60 * 1000;

// Qo'llab-quvvatlanadigan fayl turlari (SVG/HTML ataylab yo'q: xavfsizlik uchun)
const KINDS = {
  audio: ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus'],
  video: ['.mp4', '.webm', '.mov', '.m4v', '.ogv'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'],
  pdf: ['.pdf'],
  text: ['.txt', '.csv', '.md'],
  doc: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.rtf', '.odt', '.ods', '.odp'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.zipx'],
};
const EXT_KIND = new Map();
for (const [kind, list] of Object.entries(KINDS)) list.forEach(e => EXT_KIND.set(e, kind));
const kindOf = ext => EXT_KIND.get(ext) || null;
const kindOfFile = ext => kindOf(ext) || 'doc';          // noma'lum format ham qabul qilinadi: fayl kartasi + yuklab olish
const isDlOnly = kind => kind === 'doc' || kind === 'archive';   // brauzerda ochilmaydi, faqat yuklab olinadi (xavfsizlik: hech qachon inline berilmaydi)
const isMedia = kind => kind === 'audio' || kind === 'video' || kind === 'youtube';
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });  // serverni qayta yoqqanda eski fayllar tozalanadi
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** @type {Map<string, any>} */
const rooms = new Map();

const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------- 🏫 O'quv markazlar (kod bilan kirish)
// Kodlar .env da: CENTER_1_TEACHER_CODE (ustoz), CENTER_1_STUDENT_CODE (student), CENTER_1_NAME, CENTER_1_LOGO, ... Kodning o'zi brauzerga hech qachon yuborilmaydi (serverda faqat SHA-256 izi
// saqlanadi) — to'g'ri kiritilgandagina markazning ochiq ma'lumoti (nom, logotip, rang) qaytadi.
// Noto'g'ri urinishlar IP bo'yicha sanaladi: CODE_MAX_TRIES (3) ta xatodan keyin CODE_LOCK_MIN (30) daqiqa hech qanday kod qabul qilinmaydi.
const TRUST_PROXY = String(process.env.TRUST_PROXY || '').trim();                 // Render/Nginx ortida "1"; bo'sh bo'lsa faqat shu kompyuterdagi tunnel (cloudflared, ngrok) ishonchli
app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : /^(true|false)$/i.test(TRUST_PROXY) ? TRUST_PROXY.toLowerCase() === 'true' : TRUST_PROXY || 'loopback');
const CODE_MAX_TRIES = clampN(Math.round(Number(process.env.CODE_MAX_TRIES)) || 3, 1, 20);
const CODE_LOCK_MS = clampN(Number(process.env.CODE_LOCK_MIN) || 30, 1, 10080) * 60000;
const normCode = s => String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, '').toLowerCase().slice(0, 200);   // katta-kichik harf va bo'sh joy farq qilmaydi
const sha256 = s => crypto.createHash('sha256').update(s).digest();
const CENTERS = [];
// Har markazda IKKITA alohida kod bor:
//   CENTER_n_TEACHER_CODE (yoki eski nom: CENTER_n_CODE) — ustoz/admin: kiritilsa avtomatik Transmitter bo'ladi (xona yaratadi);
//   CENTER_n_STUDENT_CODE — student: kiritilsa avtomatik Receiver bo'ladi (ustozning ochiq xonasiga kiradi), hech qachon Transmitter bo'la olmaydi.
const centerNums = new Set();
for (const key of Object.keys(process.env)) { const m = key.match(/^CENTER_(\d+)_(?:TEACHER_|STUDENT_)?CODE$/); if (m) centerNums.add(m[1]); }
for (const n of [...centerNums].sort((a, b) => Number(a) - Number(b))) {
  const g = f => String(process.env[`CENTER_${n}_${f}`] || '').trim();
  const code = normCode(g('TEACHER_CODE') || g('CODE'));
  if (!code) { if (g('STUDENT_CODE')) console.warn(`  ⚠ CENTER_${n}_STUDENT_CODE bor, lekin ustoz kodi (CENTER_${n}_TEACHER_CODE) yo'q — markaz o'tkazib yuborildi`); continue; }
  const hex = v => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '');
  let logo = g('LOGO'); if (!/^(https:\/\/|\/(?!\/))[^\s"'<>()\\]+$/i.test(logo)) logo = '';
  let link = g('LINK'); try { const u = new URL(link); link = /^https?:$/.test(u.protocol) ? u.href : ''; } catch { link = ''; }
  const hash = sha256(code);
  const used = h => CENTERS.some(c => c.hash.equals(h) || (c.shash && c.shash.equals(h)));
  if (used(hash)) { console.warn(`  ⚠ CENTER_${n}_TEACHER_CODE boshqa markaz kodi bilan bir xil — o'tkazib yuborildi`); continue; }
  let shash = null; const scode = normCode(g('STUDENT_CODE'));               // student kodi (ixtiyoriy): ustoz kodidan ham, boshqa markaz kodlaridan ham farq qilishi shart
  if (scode) { const sh = sha256(scode); if (sh.equals(hash) || used(sh)) console.warn(`  ⚠ CENTER_${n}_STUDENT_CODE boshqa kod bilan bir xil — student kodi o'tkazib yuborildi`); else shash = sh; }
  const cname = g('NAME').slice(0, 60) || 'Markaz ' + n;
  // 📍 Markazning standart joylashuvi (.env: CENTER_n_LAT, CENTER_n_LNG, ixtiyoriy CENTER_n_RADIUS metrda). Faqat to'g'ri kod kiritilgandan keyin brauzerga beriladi.
  const lat = Number(g('LAT').replace(',', '.')), lng = Number(g('LNG').replace(',', '.')), rad = Math.round(Number(g('RADIUS')));
  const hasLoc = g('LAT') !== '' && g('LNG') !== '' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if ((g('LAT') || g('LNG')) && !hasLoc) console.warn(`  ⚠ CENTER_${n}_LAT / CENTER_${n}_LNG noto'g'ri — standart joylashuv qo'llanmaydi`);
  CENTERS.push({ hash, shash, pub: { id: Number(n), name: cname, room: (g('ROOM') || cname).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40), logo, link, color: hex(g('COLOR')), color2: hex(g('COLOR2')), lat: hasLoc ? +lat.toFixed(6) : null, lng: hasLoc ? +lng.toFixed(6) : null, radius: hasLoc && rad >= 20 && rad <= 50000 ? rad : null } });   // room — kod kiritilganda avtomatik yaratiladigan xona nomi
}
CENTERS.sort((a, b) => a.pub.id - b.pub.id);

const codeTries = new Map();                                   // kalit -> { n: xatolar soni, until: blok tugash vaqti, t: oxirgi urinish }
const ipOf = req => String(req.ip || req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
// Blok QURILMA bo'yicha (IP + qurilma identifikatori): bir Wi-Fi'dagi (maktab/markaz) boshqa o'quvchi yoki ustoz bloklanmaydi.
// Qurilma identifikatorini almashtirib topishga urinishga qarshi — IP bo'yicha ancha yumshoq umumiy chegara (har qurilma chegarasidan 10 barobar, kamida 30).
const devOf = req => { const d = req.body && typeof req.body.dev === 'string' ? req.body.dev : String(req.query.dev || ''); return /^[a-z0-9]{8,40}$/i.test(d) ? d : ''; };
const devKey = req => ipOf(req) + '|' + devOf(req);
const IP_MAX_TRIES = Math.max(30, CODE_MAX_TRIES * 10);
function codeState(key) {                                      // muddati o'tgan blok / eski xatolar tozalanadi
  const e = codeTries.get(key), now = Date.now();
  if (e && (e.until ? e.until <= now : now - e.t > CODE_LOCK_MS)) { codeTries.delete(key); return null; }
  return e || null;
}
const lockLeft = e => (e && e.until > Date.now() ? Math.ceil((e.until - Date.now()) / 1000) : 0);
const lockMsg = s => `Juda ko'p noto'g'ri urinish. ${s >= 60 ? Math.ceil(s / 60) + ' daqiqadan' : s + ' soniyadan'} keyin qayta urinib ko'ring`;
function pruneCodeTries() {
  const now = Date.now();
  for (const [k, e] of codeTries) if (e.until ? e.until <= now : now - e.t > CODE_LOCK_MS) codeTries.delete(k);
  for (const k of codeTries.keys()) { if (codeTries.size <= 4000) break; codeTries.delete(k); }   // eng eskilari (Map tartibi)
}
setInterval(pruneCodeTries, 10 * 60 * 1000).unref();
// Markaz tokeni: to'g'ri kod kiritilganda server imzolab beradi va u ROLNI ham belgilaydi (ustoz / student).
// Xona faqat ustoz tokeni bilan yaratiladi (xona markazga tegishli bo'ladi); student tokeni bilan xona yaratib BO'LMAYDI. Soxta token yasab bo'lmaydi.
// Ustoz tokeni eskicha (faqat markaz id), student tokeni esa student kodining izi bilan bog'langan: student kodi almashtirilsa eski student tokenlari yaroqsiz bo'ladi.
const CENTER_KEY = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('ctok'), ...CENTERS.map(c => c.hash)])).digest();
const centerToken = (c, role) => crypto.createHmac('sha256', CENTER_KEY).update(role === 'student' ? `${c.pub.id}:student:${c.shash ? c.shash.toString('hex') : ''}` : String(c.pub.id)).digest('hex').slice(0, 32);
function centerAuth(t) {                                          // -> { id, role: 'teacher' | 'student' } yoki { id: 0, role: '' }
  if (typeof t !== 'string' || t.length !== 32) return { id: 0, role: '' };
  const tb = Buffer.from(t); let hit = { id: 0, role: '' };
  for (const c of CENTERS) for (const role of ['teacher', 'student']) {
    if (role === 'student' && !c.shash) continue;                 // student kodi olib tashlangan bo'lsa, eski student tokeni ham ishlamaydi
    const ok = Buffer.from(centerToken(c, role));
    if (ok.length === tb.length && crypto.timingSafeEqual(ok, tb) && !hit.id) hit = { id: c.pub.id, role };
  }
  return hit;
}
const centerFromToken = t => centerAuth(t).id;

app.get('/api/center/status', (req, res) => {
  const e = codeState(devKey(req));
  res.set('Cache-Control', 'no-store').json({ enabled: CENTERS.length > 0, max: CODE_MAX_TRIES, left: CODE_MAX_TRIES - (e ? e.n : 0), retryAfter: lockLeft(e) });
});
app.post('/api/center/verify', express.json({ limit: '1kb' }), (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!CENTERS.length) return res.status(404).json({ ok: false, error: 'O\'quv markazlar hali sozlanmagan' });
  const ip = devKey(req), ipAll = ipOf(req) + '|*'; let e = codeState(ip);
  const wait = Math.max(lockLeft(e), lockLeft(codeState(ipAll)));
  if (wait) return res.status(429).json({ ok: false, locked: true, retryAfter: wait, error: lockMsg(wait) });   // bloklangan: kod to'g'ri bo'lsa ham tekshirilmaydi
  const code = normCode(req.body && typeof req.body.code === 'string' ? req.body.code : '');
  if (!code) return res.status(400).json({ ok: false, error: 'Kodni kiriting' });                                 // bo'sh yuborish urinish hisoblanmaydi
  const h = sha256(code); let hit = null, role = '';
  for (const c of CENTERS) {                                                                                     // hammasi tekshiriladi — javob vaqti kodni oshkor qilmaydi
    if (crypto.timingSafeEqual(h, c.hash) && !hit) { hit = c; role = 'teacher'; }
    if (c.shash && crypto.timingSafeEqual(h, c.shash) && !hit) { hit = c; role = 'student'; }
  }
  if (hit) {
    codeTries.delete(ip);
    const pub = role === 'student' ? { ...hit.pub, lat: null, lng: null, radius: null } : hit.pub;               // markaz joylashuvi faqat ustozga beriladi (studentga kerak emas)
    return res.json({ ok: true, role, center: pub, token: centerToken(hit, role) });
  }
  { let a = codeState(ipAll); if (!a) { if (codeTries.size >= 5000) pruneCodeTries(); codeTries.set(ipAll, a = { n: 0, until: 0, t: 0 }); } a.n++; a.t = Date.now(); if (a.n >= IP_MAX_TRIES) a.until = a.t + CODE_LOCK_MS; }   // IP bo'yicha umumiy (yumshoq) chegara
  if (!e) { if (codeTries.size >= 5000) pruneCodeTries(); codeTries.set(ip, e = { n: 0, until: 0, t: 0 }); }
  e.n++; e.t = Date.now();
  if (e.n >= CODE_MAX_TRIES) {
    e.until = e.t + CODE_LOCK_MS; const w = lockLeft(e);
    return res.status(429).json({ ok: false, locked: true, retryAfter: w, error: lockMsg(w) });
  }
  res.status(401).json({ ok: false, error: 'Kod noto\'g\'ri', left: CODE_MAX_TRIES - e.n });
});
// Matnli statik fayllar (html/js/css) bir marta siqilib xotirada saqlanadi (brotli/gzip): 115 KB app.js ~ 28 KB bo'ladi.
// Sekin Wi-Fi'da yuzlab qurilma bir vaqtda kirganda sahifa tez ochiladi va server protsessori ortiqcha yuklanmaydi.
const PUB_DIR = path.join(__dirname, 'public');
const zCache = new Map();                                      // fayl -> { mtime, raw, br, gz, type }
const Z_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// Siqish ASINXRON va oldindan (server ishga tushganda) bajariladi: 330 KB app.js ni brotli bilan sinxron siqish ~200 ms
// event loop'ni to'xtatib, ulangan hamma qurilmaga kechikish qo'shar edi. Endi so'rov paytida hech qachon bloklanmaydi.
const zBuild = new Map();                                      // file -> Promise (bir vaqtda faqat bitta siqish)
const zStat = new Map();                                       // file -> { t, st } (statSync har so'rovda chaqirilmasin)
const brAsync = (raw, q) => new Promise((ok, no) => zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }, (e, b) => e ? no(e) : ok(b)));
const gzAsync = (raw) => new Promise((ok, no) => zlib.gzip(raw, { level: 9 }, (e, b) => e ? no(e) : ok(b)));
function zEntry(file, ext, st) {
  const e = zCache.get(file);
  if (e && e.mtime === st.mtimeMs) return Promise.resolve(e);
  const key = file + ':' + st.mtimeMs;
  if (!zBuild.has(key)) zBuild.set(key, (async () => {
    const raw = await fs.promises.readFile(file);
    const [br, gz] = await Promise.all([brAsync(raw, 9), gzAsync(raw)]);
    const ne = { mtime: st.mtimeMs, raw, br, gz, type: Z_TYPES[ext], etag: `"${st.size}-${Math.round(st.mtimeMs)}"` };
    zCache.set(file, ne); return ne;
  })().finally(() => zBuild.delete(key)));
  return zBuild.get(key);
}
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const rel = req.path === '/' ? '/index.html' : req.path;
  const ext = path.extname(rel);
  if (!Z_TYPES[ext]) return next();
  const file = path.join(PUB_DIR, path.normalize(rel));
  if (!file.startsWith(PUB_DIR + path.sep)) return next();
  const now = Date.now();
  let zs = zStat.get(file);
  if (!zs || now - zs.t > 1500) { let st; try { st = fs.statSync(file); } catch { return next(); } zStat.set(file, zs = { t: now, st }); }
  zEntry(file, ext, zs.st).then(e => {
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600');
    res.setHeader('ETag', e.etag);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === e.etag) return res.status(304).end();
    const ae = String(req.headers['accept-encoding'] || '');
    let body = e.raw;
    if (/\bbr\b/.test(ae)) { body = e.br; res.setHeader('Content-Encoding', 'br'); }
    else if (/\bgzip\b/.test(ae)) { body = e.gz; res.setHeader('Content-Encoding', 'gzip'); }
    res.type(e.type).setHeader('Content-Length', body.length);
    res.end(body);
  }).catch(() => next());
});
// Ishga tushganda barcha html/js/css oldindan siqib qo'yiladi (birinchi foydalanuvchi ham kutmaydi)
setImmediate(() => {
  try {
    for (const f of fs.readdirSync(PUB_DIR)) {
      const ext = path.extname(f);
      if (!Z_TYPES[ext]) continue;
      const file = path.join(PUB_DIR, f);
      zEntry(file, ext, fs.statSync(file)).catch(() => {});
    }
  } catch {}
});
// 🙂 Face ID: face-api kutubxonasi va modellari `npm install` bilan keladi (node_modules) — lokal rejimda internet shart emas
const FACE_PKG = path.join(__dirname, 'node_modules', '@vladmandic', 'face-api');
// face-api.js (~1.2 MB) va model manifestlari brotli/gzip bilan bir marta siqiladi; .bin (vazn) allaqachon zich — tegilmaydi
const FZ = new Map();
app.use(['/vendor', '/models'], (req, res, next) => {
  if (req.method !== 'GET') return next();
  const ext = path.extname(req.path); if (ext !== '.js' && ext !== '.json') return next();
  const base = path.join(FACE_PKG, req.baseUrl === '/vendor' ? 'dist' : 'model'); let rel; try { rel = decodeURIComponent(req.path); } catch { return next(); }
  const file = path.resolve(base, '.' + rel); if (!file.startsWith(base + path.sep)) return next();
  let st; try { st = fs.statSync(file); } catch { return next(); }
  const ae = String(req.headers['accept-encoding'] || ''), enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gz' : '';
  if (!enc) return next();
  const key = file + '|' + enc + '|' + st.mtimeMs;
  if (!FZ.has(key)) FZ.set(key, new Promise((ok, no) => fs.readFile(file, (e, raw) => e ? no(e) : enc === 'br' ? zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }, (e2, b) => e2 ? no(e2) : ok(b)) : zlib.gzip(raw, { level: 9 }, (e2, b) => e2 ? no(e2) : ok(b)))));
  FZ.get(key).then(body => {
    res.set({ 'Content-Type': ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Encoding': enc === 'br' ? 'br' : 'gzip', 'Vary': 'Accept-Encoding', 'Cache-Control': 'public, max-age=2592000, immutable', 'Content-Length': body.length });
    res.end(body);
  }).catch(() => { FZ.delete(key); next(); });
});
app.use('/vendor', express.static(path.join(FACE_PKG, 'dist'), { maxAge: '30d', immutable: true, index: false }));
app.use('/models', express.static(path.join(FACE_PKG, 'model'), { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(PUB_DIR, { maxAge: '1h', etag: true, setHeaders: (res, f) => { if (/\.(html|js|css)$/i.test(f)) res.setHeader('Cache-Control', 'no-cache'); } }));

let activeFiles = 0;
// Fayllar faqat xona tokeni bilan beriladi. Transmitter sozlamalari (ko'rish / yuklab olish) shu yerda tekshiriladi.
app.get('/files/:code/:file', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).end();
  const role = room.tokens.get(String(req.query.t || ''));
  if (!role) return res.status(403).end();
  const file = path.basename(req.params.file);
  const item = room.items.find(i => !i.external && path.basename(i.url) === file);
  if (!item) return res.status(404).end();
  if (role !== 'host') {
    if (!isMedia(item.kind) && !room.cfg.allowView) return res.status(403).send('Transmitter fayllarni ko\'rishni o\'chirgan');
    const pv = req.query.pv === '1' && item.kind === 'doc';          // Word/Excel/PowerPoint: brauzerda ko'rsatish (preview) uchun faqat "ko'rish" ruxsati yetadi
    if ((req.query.dl === '1' || (isDlOnly(item.kind) && !pv)) && !room.cfg.allowDownload) return res.status(403).send('Transmitter yuklab olishni o\'chirgan');
  }
  if (role !== 'host') {                                   // ko'p odam bir vaqtda yuklasa, server bo'g'ilmasligi uchun navbat
    if (activeFiles >= MAX_FILE_STREAMS) { res.setHeader('Retry-After', '1'); return res.status(503).end(); }
    activeFiles++;
    let freed = false;
    const free = () => { if (!freed) { freed = true; activeFiles--; } };
    res.on('close', free); res.on('finish', free);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (isDlOnly(item.kind)) res.setHeader('Content-Security-Policy', 'sandbox');
  if (req.query.dl === '1' || isDlOnly(item.kind)) res.attachment(item.name);
  res.sendFile(path.join(UPLOAD_DIR, room.code, file), { acceptRanges: true, dotfiles: 'deny' }, err => {
    if (err && !res.headersSent) res.status(err.status || 404).end();
  });
});

function ytIdOf(u) {
  const h = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?]+)/); if (m) id = m[1]; }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

const safeName = n => String(n || 'fayl').replace(/[\u0000-\u001f<>:"\\|?*]/g, '').slice(0, 120) || 'fayl';

function genCode() {
  for (let i = 0; i < 50; i++) {
    const c = String(crypto.randomInt(100000, 1000000));
    if (!rooms.has(c)) return c;
  }
  return null;
}

function defaultCfg() {
  return {
    allowView: true,        // receiver rasm / PDF / matn / hujjatni ko'ra oladimi
    allowDownload: true,    // receiver yuklab ola oladimi
    guard: true,            // viktorina paytida receiverda nusxa/skrinshot himoyasi
    muteAll: false,         // hamma receiver dinamigi o'chiq
    volume: 100,            // hamma receiver uchun umumiy ovoz (0-100)
    lockVolume: true,       // receiver o'z ovozini o'zgartira olmaydi (hamma bir xil)
    normalize: true,        // ovozni avtomatik tenglashtirish
    duck: true,             // mikrofon gapirganda musiqa pasayadi
    locked: false,          // yangi receiverlar kira olmaydi
    pcApprove: false,       // true: noutbuk/kompyuterdan kirmoqchi bo'lganlar avtomatik "qabul qilish rejimi"ga tushadi (Transmitter ruxsatini kutadi)
    phoneOnly: false,       // true: faqat telefondan kirish mumkin (kompyuter/planshet/TV rad etiladi)
    loop: 'off',            // 'off' | 'one' | 'all'
    allowReact: false,       // receiverlar emoji reaksiya yubora oladimi (dastlab yoqiq)
    waitAll: true,          // Play bosilganda hamma qurilma tayyor bo'lguncha (maks. 6 s) kutish
    allowChat: true,        // receiverlar chatga yoza oladimi (hamma ko'radi)
    allowChatQuiz: true,    // viktorina paytida ham receiverlar chatga yoza oladimi
    approve: false,         // true: yangi receiverlarni Transmitter qo'lda qabul qiladi (qabul qilish rejimi)
    listed: true,           // xona receiverlarning "xonalar ro'yxati"da nomi bilan ko'rinadi (o'chiq bo'lsa faqat kod bilan kiriladi)
    class3d: false,         // 3D dars xonasi Transmitter yoqqandagina ishlaydi
    seatLock: false, whisper: true,
    global: false,          // 🌍 faqat markaz xonalari uchun (odatda O'CHIQ): true — xona ro'yxatda HAMMAGA ko'rinadi (markaz kodini kiritmaganlarga ham); false — faqat shu markaz kodini kiritgan qurilmalarga
  };
}

// Xona nomi: Transmitter beradi, receiverlar ro'yxatda shu nom bilan qidiradi va tanlaydi
const cleanRoomName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);

function applyCfg(room, p) {
  if (!p || typeof p !== 'object') return;
  const c = room.cfg;
  for (const k of ['allowView', 'allowDownload', 'guard', 'muteAll', 'lockVolume', 'normalize', 'duck', 'locked', 'waitAll', 'allowReact', 'allowChat', 'allowChatQuiz', 'approve', 'listed', 'global', 'phoneOnly', 'pcApprove', 'class3d', 'seatLock', 'whisper']) {
    if (typeof p[k] === 'boolean') c[k] = p[k];
  }
  if (c.phoneOnly) kickNonPhones(room);                                 // yoqilganda xonadagi telefon bo'lmagan receiverlar chiqariladi
  if (room.pending && room.pending.size) {                                        // rejim o'chirildi: endi ruxsat talab qilinmaydiganlar kiritiladi
    for (const [id, w] of [...room.pending]) if (!needsApproval(room, w, w.pend && w.pend.dev)) admitOne(room, id, true);
    sendPending(room);
  }
  if (typeof p.volume === 'number' && Number.isFinite(p.volume)) c.volume = Math.max(0, Math.min(100, Math.round(p.volume)));
  if (['off', 'one', 'all'].includes(p.loop)) c.loop = p.loop;
}

// ---- Faqat telefon rejimi (cfg.phoneOnly): serverda User-Agent bo'yicha, zaxira sifatida receiver yuborgan qurilma turi bo'yicha tekshiriladi
const PHONE_UA = /iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Android.+Mobile|Mobile.+Firefox/i;
const isPhoneWs = (ws, dev) => PHONE_UA.test(ws.ua || '') || !!(dev && dev.k === 'phone');
const PC_UA = /Windows NT|Macintosh|X11|CrOS|Linux x86_64/i;
const isPcWs = (ws, dev) => !isPhoneWs(ws, dev) && ((dev && dev.k === 'pc') || (PC_UA.test(ws.ua || '') && !(dev && (dev.k === 'tablet' || dev.k === 'tv'))));
const needsApproval = (room, ws, dev) => !!(room.cfg.approve || (room.cfg.pcApprove && isPcWs(ws, dev)));   // kimlar Transmitter ruxsatini kutadi
const PHONE_MSG = 'Bu xonaga faqat telefondan kirish mumkin';
function kickNonPhones(room) {
  let n = 0;
  for (const c of [...room.clients]) {
    const dv = c.ctx && c.ctx.dev;
    if (isPhoneWs(c, dv) || (room.cfg.pcApprove && isPcWs(c, dv))) continue;      // noutbuk uchun "qabul qilish" yoqiq bo'lsa chiqarilmaydi
    if (c.ctx && c.ctx.tok) room.tokens.delete(c.ctx.tok);
    send(c, { type: 'error', code: 'PHONE_ONLY', message: PHONE_MSG });
    try { c.close(); } catch {}
    n++;
  }
  if (room.pending && room.pending.size) for (const [id, w] of [...room.pending]) {
    const dv = w.pend && w.pend.dev;
    if (!isPhoneWs(w, dv) && !(room.cfg.pcApprove && isPcWs(w, dv))) admitOne(room, id, false);
  }
  if (n && room.host) send(room.host, { type: 'notice', message: `📱 Faqat telefon rejimi: ${n} ta qurilma chiqarildi` });
}

function issueToken(room, role, want) {
  if (want && room.tokens.get(want) === role) return want;
  const t = crypto.randomBytes(9).toString('hex');
  room.tokens.set(t, role);
  if (room.tokens.size > 3000) room.tokens.delete(room.tokens.keys().next().value);
  return t;
}

function newRoom(name, centerId) {
  const code = genCode();
  if (!code) return null;
  const room = {
    code,
    centerId: centerId || 0,                            // 0 — oddiy (standart) tizim; >0 — shu o'quv markazning xonasi
    name: cleanRoomName(name),
    hostKey: crypto.randomBytes(12).toString('hex'),
    items: [],
    state: { currentId: null, playing: false, playAt: 0, position: 0, autoNext: true },
    cfg: defaultCfg(),
    att: ATT.newAtt(),                                  // Davomat standart yoqilgan: receiverda «Ro'yxatdan o'tish» darhol ko'rinadi
    live: { mic: null, screen: null },
    tokens: new Map(),                                  // fayl tokenlari: token -> 'host' | 'receiver'
    host: null,
    clients: new Set(),
    lastSeen: Date.now(),
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

const STUCK_BYTES = 16 * 1024 * 1024;                                // 16 MB dan ko'p yuborilmay qolgan soket — o'lik ulanish
const send = (ws, msg) => {
  if (!ws || ws.readyState !== 1) return;
  if (ws.bufferedAmount > STUCK_BYTES) { try { ws.terminate(); } catch {} return; }   // xotira shishmasin
  ws.send(JSON.stringify(msg));
};
const everyone = room => [room.host, ...room.clients].filter(Boolean);
// Ko'p qabul qiluvchiga: xabar BIR marta JSON'ga aylantiriladi; "tiqilib qolgan" soketga yuborilmaydi (server xotirasi shishmasin)
const sendAll = (list, msg) => {
  const data = JSON.stringify(msg);
  for (const w of list) {
    if (!w || w.readyState !== 1) continue;
    if (w.bufferedAmount > STUCK_BYTES) { try { w.terminate(); } catch {} continue; }
    if (w.bufferedAmount < 2 * 1024 * 1024) w.send(data);
  }
};
const broadcast = (room, msg) => sendAll(everyone(room), msg);
const clientById = (room, id) => { for (const c of room.clients) if (c.ctx && c.ctx.id === id) return c; return null; };
const stateMsg = room => ({ type: 'state', state: room.state, serverNow: Date.now() });

function expectedPos(room, t = Date.now()) {
  const s = room.state;
  return s.playing ? s.position + Math.max(0, (t - s.playAt) / 1000) : s.position;
}

// Receiverlar o'lchagan eng katta ping'ga qarab "Play"dan keyingi boshlanish kechikishi (tez tarmoqda qisqa, yomon tarmoqda uzunroq)
function leadMs(room) {
  const r = [];
  room.clients.forEach(c => { if (c.ctx && c.ctx.stat && c.ctx.stat.rtt > 0) r.push(c.ctx.stat.rtt); });
  if (!r.length) return LEAD;
  r.sort((x, y) => x - y);
  const p90 = r[Math.min(r.length - 1, Math.floor(r.length * 0.9))];      // bitta juda sekin qurilma hammani kechiktirmasin
  return clampN(Math.round(p90 * 2 + 450), 600, 3000);          // past ms: ~0.6 s, yomon tarmoq: 3 s gacha
}
function cancelWait(room) {
  if (room.waitT) { clearInterval(room.waitT); room.waitT = null; broadcast(room, { type: 'waiting', n: 0 }); }
}

// O(N²) xabar bo'roniga yo'l qo'ymaslik: a'zolar holati yig'ilib, 0.6 s da bir marta yuboriladi
// ================================================================ VIKTORINA (Kahoot kabi)
// To'g'ri javob serverda saqlanadi va faqat "reveal" bosqichida yuboriladi. Ballar serverda hisoblanadi (aldab bo'lmaydi).
const STK = require('./public/stickers.js');
const AVATARS = STK.ALL;
const packOf = p => (STK.valid(p) ? p : 'all');
const pickAvatar = pack => { const l = STK.list(pack); return l[Math.floor(Math.random() * l.length)]; };
// ---------------------------------------------------------------- AI savollar ("Do'st bilan do'st" rejimi)
// Savollarni hech kim tuzmaydi: har safar tasodifiy mavzular tanlanadi va AI (Google Gemini API) 11 ta yangi savol yozadi.
// Sozlash: GEMINI_API_KEY (majburiy), AI_MODEL (ixtiyoriy, standart gemini-2.5-flash).
const AI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
// Groq (OpenAI-mos API): GROQ_API_KEY (kalit), GROQ_MODEL (ixtiyoriy, standart llama-3.3-70b-versatile).
const GROQ_KEY = String(process.env.GROQ_API_KEY || '').trim().replace(/^bearer\s+/i, '');
const GROQ_MODELS = [process.env.GROQ_MODEL, 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].filter((x, i, a) => x && a.indexOf(x) === i);
console.log('[AI] Gemini:', AI_KEY ? 'kalit bor (…' + AI_KEY.slice(-4) + ')' : 'kalit YO\'Q', '· Groq:', GROQ_KEY ? 'kalit bor (…' + GROQ_KEY.slice(-4) + ')' : 'kalit YO\'Q (GROQ_API_KEY)');
const aiHas = p => p === 'groq' ? !!GROQ_KEY : !!AI_KEY;
const aiAny = () => !!(AI_KEY || GROQ_KEY);
const aiProv = v => v === 'groq' ? 'groq' : 'gemini';
let groqGoodModel = '';
const AI_MODELS = [process.env.AI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-2.0-flash'].filter((x, i, a) => x && a.indexOf(x) === i);
let aiGoodModel = '';                                      // ishlagan model eslab qolinadi
const AI_COUNT = 11;                                       // standart; Transmitter 3–30 oralig'ida o'zi tanlaydi
const AI_MIN = 3, AI_MAX = 30;
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 45000;     // bitta urinish uchun
const AI_TOTAL_MS = Number(process.env.AI_TOTAL_MS) || 100000;        // jami kutish chegarasi (foydalanuvchi cheksiz kutmasin)
const AI_MAX_PARALLEL = 4;                                // serverda bir vaqtda ketayotgan AI so'rovlar
let aiActive = 0;
const AI_TOPICS = ['O\'zbekiston tarixi', 'O\'zbekiston geografiyasi', 'jahon geografiyasi', 'jahon tarixi', 'kosmos va astronomiya', 'hayvonot dunyosi',
  'o\'simliklar va tabiat', 'inson tanasi', 'fizika', 'kimyo', 'matematika va mantiq', 'texnologiya va internet', 'kompyuter va dasturlash',
  'sport', 'futbol', 'kino va multfilmlar', 'musiqa', 'adabiyot va shoirlar', 'o\'zbek madaniyati va an\'analar', 'milliy taomlar va oshxona',
  'dunyo taomlari', 'mashhur kashfiyotlar va ixtirochilar', 'iqtisod va pul', 'transport va mashinalar', 'san\'at va rassomlar', 'mifologiya va afsonalar',
  'ajoyib rekordlar va faktlar', 'tillar va so\'zlar', 'okeanlar, tog\'lar va daryolar', 'ob-havo va tabiat hodisalari', 'mashhur shaxslar', 'o\'yinlar va video o\'yinlar'];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const AI_LEVELS = { easy: 'oson (maktab o\'quvchisi ham biladi)', mid: 'o\'rta (oddiy bilimdon odam biladi)', hard: 'qiyin (chuqur bilim talab qiladi)', mix: 'aralash: taxminan teng miqdorda oson, o\'rta va qiyin savollar' };
const AI_LANGS = { uz: "o'zbek tili (lotin yozuvi)", en: 'English', ru: 'русский язык', tr: 'Türkçe', ar: 'العربية', de: 'Deutsch', fr: 'français', es: 'español', ko: '한국어', zh: '中文' };
function aiPrompt(topic, level, n, lang, part) {
  const nonce = crypto.randomBytes(4).toString('hex');
  part = part || { i: 0, k: 1, topics: shuffle(AI_TOPICS).slice(0, n) };
  const topics = topic ? `Mavzu: "${topic}". ${n} ta savolning har biri shu mavzuning BOSHQA-BOSHQA tomoniga oid bo'lsin.` +
      (part.k > 1 ? ` (Bu ${part.k} qismdan ${part.i + 1}-qism: boshqa qismlar bilan savollar takrorlanmasligi uchun mavzuning ${part.i + 1}-chi yo'nalishlariga e'tibor ber.)` : '')
    : `Har bir savol uchun mavzu (shu tartibda): ${part.topics.map((t, i) => `${i + 1}) ${t}`).join('; ')}.`;
  return `Sen do'stlar uchun viktorina (quiz) savollarini tuzuvchisan. Aniq ${n} ta test savoli tuz.\n` +
    `Til: ${lang && AI_LANGS[lang] ? 'FAQAT ' + AI_LANGS[lang] + ' (savollar va barcha variantlar shu tilda)' : "foydalanuvchi mavzusida til aytilgan bo'lsa (masalan 'ingliz tilida', 'in Russian') - o'sha tilda; aytilmagan bo'lsa, mavzu qaysi tilda yozilgan bo'lsa - shu tilda; mavzu bo'sh bo'lsa - o'zbek tili (lotin yozuvi). Savollar va barcha variantlar bitta tilda bo'lsin"}. Qiyinlik: ${AI_LEVELS[level] || AI_LEVELS.mix}.\n${topics}\n` +
    `Qoidalar:\n- Har savolda aynan 4 ta variant, faqat bittasi to'g'ri; noto'g'ri variantlar ishonarli bo'lsin.\n` +
    `- Faqat aniq, tekshirilgan, bahssiz faktlar. Noaniq, sana-tafsilotga bog'liq yoki o'zgarib turadigan savol berma.\n` +
    `- Savol matni 200 belgidan, variant 80 belgidan oshmasin. Savollar bir-biriga o'xshamasin, banal/eng mashhur savollardan qoching.\n` +
    `- To'g'ri javob o'rni (0-3) tasodifiy bo'lsin.\n- Tasodifiylik kaliti: ${nonce}.\n` +
    `Javobni FAQAT quyidagi JSON ko'rinishida qaytar, boshqa matn yoki markdown yozma:\n` +
    `{"questions":[{"text":"...","opts":["A","B","C","D"],"correct":0}]}`;
}
function aiParse(text, n) {
  text = String(text).replace(/```(?:json)?/gi, '');
  const a = text.indexOf('{');
  if (a < 0) throw new Error('AI javobi tushunarsiz');
  let j = null;
  const b = text.lastIndexOf('}');
  try { j = JSON.parse(text.slice(a, b + 1)); }
  catch {                                                                   // javob uzilib qolgan bo'lsa: to'liq savollarni qutqaramiz
    let cut = b;
    for (let i = 0; i < 40 && cut > a && !j; i++) {
      try { j = JSON.parse(text.slice(a, cut + 1) + ']}'); } catch { cut = text.lastIndexOf('}', cut - 1); }
    }
    if (!j) throw new Error('AI javobi tushunarsiz (JSON)');
  }
  const out = [], seen = new Set();
  for (const q of Array.isArray(j.questions) ? j.questions : []) {
    const t = String(q && q.text || '').trim().slice(0, 240);
    const opts = (Array.isArray(q && q.opts) ? q.opts : []).map(o => String(o || '').trim().slice(0, 120));
    const c = Number(q && q.correct);
    if (!t || opts.length !== 4 || opts.some(o => !o) || new Set(opts.map(o => o.toLowerCase())).size !== 4 || !(c >= 0 && c <= 3) || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    const order = shuffle([0, 1, 2, 3]);                  // to'g'ri javob o'rnini server ham aralashtiradi
    out.push({ text: t, opts: order.map(i => opts[i]), correct: order.indexOf(c) });
  }
  return out.slice(0, n);
}
const AI_SCHEMA = { type: 'OBJECT', properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT',
  properties: { text: { type: 'STRING' }, opts: { type: 'ARRAY', items: { type: 'STRING' } }, correct: { type: 'INTEGER' } }, required: ['text', 'opts', 'correct'] } } }, required: ['questions'] };
const AI_FILE_SCHEMA = { type: 'OBJECT', properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', propertyOrdering: ['text', 'source', 'opts', 'correct'],
  properties: { text: { type: 'STRING' }, source: { type: 'STRING' }, opts: { type: 'ARRAY', items: { type: 'STRING' } }, correct: { type: 'INTEGER' } }, required: ['text', 'source', 'opts', 'correct'] } } }, required: ['questions'] };
// level 0: sxema + thinking o'chiq (eng tez va ishonchli) · 1: faqat sxema · 2: oddiy JSON (eski modellar uchun)
function aiCfg(level, n, file) {
  const cfg = { responseMimeType: 'application/json', maxOutputTokens: Math.min(30000, 2000 + n * (file ? 600 : 450)), temperature: file ? 0.6 : 1 };
  if (level <= 1) cfg.responseSchema = file ? AI_FILE_SCHEMA : AI_SCHEMA;
  if (level === 0) cfg.thinkingConfig = { thinkingBudget: 0 };
  return cfg;
}
const aiErrText = (status, msg, prov) => {
  if (prov === 'groq') {
    msg = String(msg || '');
    if (status === 401) return 'Groq API kaliti noto\'g\'ri yoki o\'chirilgan. .env faylidagi GROQ_API_KEY ni tekshiring.';
    if (status === 403) return 'Groq bu kalit uchun ruxsat bermadi (403).';
    if (status === 429) return 'Groq limiti tugadi (429). Bir oz kutib qayta urinib ko\'ring.';
    if (status === 503 || status === 500) return 'Groq hozir band (' + status + '). Birozdan keyin qayta urinib ko\'ring.';
    return 'Groq xato qaytardi (' + status + ')' + (msg ? ': ' + msg.slice(0, 140) : '');
  }
  msg = String(msg || '');
  if (/api key|API_KEY|credential/i.test(msg) || status === 401) return 'Gemini API kaliti noto\'g\'ri yoki o\'chirilgan. .env faylidagi GEMINI_API_KEY ni tekshiring.';
  if (status === 403) return 'Gemini bu kalit uchun ruxsat bermadi (403). Kalit yoqilganini / hudud cheklovini tekshiring.';
  if (status === 429) return 'Gemini bepul limiti tugadi (429). Bir oz kutib qayta urinib ko\'ring.';
  if (status === 503 || status === 500) return 'Gemini hozir band (' + status + '). Birozdan keyin qayta urinib ko\'ring.';
  return 'AI xizmati xato qaytardi (' + status + ')' + (msg ? ': ' + msg.slice(0, 140) : '');
};
async function aiCall(model, prompt, signal, level, n, fileParts) {
  const r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': AI_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [...(fileParts || []), { text: prompt }] }], generationConfig: aiCfg(level, n, !!(fileParts && fileParts.length)) }),
  });
  if (!r.ok) {
    let msg = ''; try { msg = ((await r.json()).error || {}).message || ''; } catch {}
    console.error(`[AI] ${model} level=${level} -> ${r.status}: ${msg.slice(0, 200)}`);
    const e = new Error(aiErrText(r.status, msg)); e.status = r.status;
    e.badKey = r.status === 401 || r.status === 403 || (r.status === 400 && /api key|API_KEY/i.test(msg));
    throw e;
  }
  const d = await r.json();
  const cand = (d.candidates || [])[0] || {};
  const text = ((cand.content || {}).parts || []).map(p => p.text || '').join('');
  if (!text) { const e = new Error('AI bo\'sh javob berdi' + (d.promptFeedback && d.promptFeedback.blockReason ? ' (' + d.promptFeedback.blockReason + ')' : '')); e.status = 0; throw e; }
  return text;
}
// Kalit uchun mavjud modellar ro'yxatidan mos "flash" modelni topadi (model nomi eskirgan bo'lsa)
async function aiDiscoverModels(signal) {
  const r = await fetch(`${GEMINI_BASE}/v1beta/models?pageSize=200`, { signal, headers: { 'x-goog-api-key': AI_KEY } });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini-[\d.]+-flash(?!.*(image|tts|live|audio|thinking|lite))/i.test(m.name))
    .map(m => m.name.replace(/^models\//, '')).sort().reverse();
}
async function groqCall(model, prompt, signal, n, plain) {
  const r = await fetch((process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/chat/completions', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + GROQ_KEY },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], ...(plain ? {} : { response_format: { type: 'json_object' } }), temperature: 1, max_tokens: Math.min(8000, 1500 + n * 300) }),
  });
  if (!r.ok) {
    let msg = ''; try { msg = ((await r.json()).error || {}).message || ''; } catch {}
    console.error(`[AI/Groq] ${model} -> ${r.status}: ${msg.slice(0, 300)}`);
    const e = new Error(aiErrText(r.status, msg, 'groq')); e.status = r.status; e.badKey = r.status === 401 || r.status === 403;
    throw e;
  }
  const d = await r.json();
  const text = (((d.choices || [])[0] || {}).message || {}).content || '';
  if (!text) { const e = new Error('Groq bo\'sh javob berdi'); e.status = 0; throw e; }
  return text;
}
const GROQ_PREFER = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'gemma2-9b-it'];
let groqModelsCache = null;                                              // { t, list } — kalit ko'ra oladigan modellar
async function groqModels() {
  if (groqModelsCache && Date.now() - groqModelsCache.t < 10 * 60 * 1000) return groqModelsCache.list;
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch((process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/models', { signal: ctl.signal, headers: { authorization: 'Bearer ' + GROQ_KEY } });
    if (!r.ok) return null;
    const ids = ((await r.json()).data || []).filter(m => m.active !== false).map(m => String(m.id));
    const chat = ids.filter(id => !/whisper|guard|tts|playai|orpheus|compound|allam|embed|qwen|deepseek|prompt/i.test(id));
    const list = [...GROQ_PREFER.filter(id => chat.includes(id)), ...chat.filter(id => !GROQ_PREFER.includes(id))];
    console.log('[AI/Groq] mavjud modellar:', list.join(', ') || '(yo\'q)');
    groqModelsCache = { t: Date.now(), list };
    return list;
  } catch { return null; } finally { clearTimeout(to); }
}
async function groqMakeChunk(topic, level, n, lang, part) {
  let last = null, best = [];
  const t0 = Date.now();
  const avail = await groqModels();                                       // kalit ruxsat bergan modellar (bo'lsa)
  const queue = [...new Set([groqGoodModel, process.env.GROQ_MODEL, ...(avail || GROQ_MODELS)].filter(x => x && (!avail || avail.includes(x))))].slice(0, 5);
  let firstErr = null;
  const plainSet = new Set();                                             // json rejimini qabul qilmagan modellar: oddiy so'rov
  for (let attempt = 0; attempt < 8 && queue.length; attempt++) {
    const left = AI_TOTAL_MS - (Date.now() - t0);
    if (left < 4000) break;
    const model = queue.shift();
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), Math.min(AI_TIMEOUT_MS, left));
    try {
      const qs = aiParse(await groqCall(model, aiPrompt(topic, level, n, lang, part), ctl.signal, n, plainSet.has(model)), n);
      if (qs.length >= n) { groqGoodModel = model; return qs; }
      if (qs.length > best.length) best = qs;
      last = new Error(`Groq faqat ${qs.length} ta yaroqli savol berdi`);
      if (attempt < 2) queue.unshift(model); else break;
    } catch (e) {
      last = e.name === 'AbortError' ? new Error('Groq javob bermadi (vaqt tugadi)') : e;
      if (!firstErr) firstErr = last;
      if (e.status === 404 && groqModelsCache) groqModelsCache = null;
      if (e.badKey) break;
      if (groqGoodModel === model && e.status !== 0) groqGoodModel = '';
      if (e.status === 400 && !plainSet.has(model)) { plainSet.add(model); queue.unshift(model); }   // json_validate_failed va h.k.: json rejimisiz qayta urinamiz
    } finally { clearTimeout(to); }
  }
  if (best.length >= 3) return best;
  if (!queue.length && avail && !avail.length) throw new Error('Groq kalitingiz hech bir modelga ruxsat bermadi. console.groq.com → Settings → Limits/Models bo\'limini tekshiring.');
  throw (last && last.status === 404 && firstErr) || last || new Error('Groq savol tuza olmadi');
}
async function aiMakeChunk(topic, level, n, lang, part, prov, src) {
  if (prov === 'groq') return groqMakeChunk(topic, level, n, lang, part);
  let last = null, best = [], discovered = false;
  const t0 = Date.now();
  const queue = [...new Set([aiGoodModel, ...AI_MODELS].filter(Boolean))];
  const lvl = new Map();                                                   // model -> hozirgi "soddalashtirish" darajasi
  for (let attempt = 0; attempt < 8 && queue.length; attempt++) {
    const left = (src ? AI_FILE_TOTAL_MS : AI_TOTAL_MS) - (Date.now() - t0);
    if (left < 4000) break;
    const model = queue.shift(), L = lvl.get(model) || 0;
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), src ? Math.min(left, AI_FILE_TIMEOUT_MS) : Math.min(AI_TIMEOUT_MS, left, 12000 + n * 1500));   // osilib qolgan so'rov tez almashtiriladi (fayl: uzoqroq kutiladi)
    try {
      const text = await aiCall(model, src ? aiFilePrompt(topic, level, n, lang, src.part) : aiPrompt(topic, level, n, lang, part), ctl.signal, L, n, src && src.parts);
      const qs = aiParse(text, n);
      if (qs.length >= n) { aiGoodModel = model; return qs; }
      if (qs.length > best.length) best = qs;
      last = new Error(src && !qs.length ? 'Fayldan savol tuzib bo\'lmadi: matn o\'qilmadi yoki mazmun yetarli emas. Aniqroq rasm/PDF yuklab ko\'ring.' : `AI faqat ${qs.length} ta yaroqli savol berdi`);
      if (attempt < 2) queue.unshift(model);                                // bir marta qayta urinamiz
      else break;
    } catch (e) {
      last = e.name === 'AbortError' ? new Error('AI javob bermadi (vaqt tugadi)') : e;
      if (e.badKey) break;                                                  // kalit xato: qayta urinish befoyda
      if (e.status === 400 && L < 2) { lvl.set(model, L + 1); queue.unshift(model); }   // model sxema/thinking'ni qabul qilmadi: soddaroq so'rov
      else if (e.status === 404 || e.status === 400) {
        if (aiGoodModel === model) aiGoodModel = '';
        if (e.status === 404) console.error('[AI] model topilmadi:', model);
        if (!queue.length && !discovered) {                                 // nomlar eskirgan bo'lishi mumkin: mavjudlarini so'raymiz
          discovered = true;
          try { queue.push(...(await aiDiscoverModels(ctl.signal)).slice(0, 4)); } catch {}
        }
      } else if (e.status === 429 || e.status === 503 || e.status === 500) {
        if (aiGoodModel === model) aiGoodModel = '';                        // keyingi modelga o'tamiz (har birining limiti alohida)
      }
    } finally { clearTimeout(to); }
  }
  if (best.length >= 3) return best;
  throw last || new Error('AI savol tuza olmadi');
}
// ---------------------------------------------------------------- 📎 Fayldan quiz (JPG, PNG, HEIC, PDF · 60 MB gacha)
// Transmitter faylni yuklaydi (room.aiFile), AI savollarni FAQAT shu fayl mazmunidan tuzadi. Faqat Gemini (Groq PDF/HEIC o'qiy olmaydi).
// Kichik fayl (<= 12 MB) so'rov ichida (inline), kattasi Gemini Files API orqali yuboriladi va ishlatilgach o'chiriladi.
const AI_FILE_MB = Number(process.env.AI_FILE_MB) || 60;
const AI_FILE_BYTES = AI_FILE_MB * 1024 * 1024;
const AI_INLINE_MAX = 12 * 1024 * 1024;
const AI_FILE_TIMEOUT_MS = Number(process.env.AI_FILE_TIMEOUT_MS) || 100000;   // bitta urinish
const AI_FILE_TOTAL_MS = Number(process.env.AI_FILE_TOTAL_MS) || 170000;       // jami
// Fayl turi brauzer aytgan nomga emas, haqiqiy mazmuniga (magic bytes) qarab aniqlanadi
function sniffAiFile(head) {
  if (head.subarray(0, 1024).includes('%PDF-')) return 'application/pdf';
  if (head.length > 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length > 7 && head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG' && head[4] === 0x0d && head[5] === 0x0a) return 'image/png';
  if (head.length > 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'image/heif';
  }
  return '';
}
function aiFilePrompt(topic, level, n, lang, part) {
  const nonce = crypto.randomBytes(4).toString('hex');
  return `Sen tajribali o'qituvchisan va viktorina (quiz) savollarini tuzasan. Senga fayl berilgan (rasm yoki PDF hujjat). Shu fayl mazmuniga asoslanib aniq ${n} ta test savoli tuz.\n` +
    (part && part.k > 1 ? `Fayl mazmunini boshidan oxirigacha ${part.k} teng qismga bo'l va savollarni FAQAT ${part.i + 1}-qismdan ol (boshqa qismlar uchun savollarni boshqa tuzuvchi yozmoqda; bir sahifali/rasm bo'lsa — uning ${part.i + 1}-yo'nalishdagi jihatlaridan).\n` : '') +
    `Til: ${lang && AI_LANGS[lang] ? 'FAQAT ' + AI_LANGS[lang] + ' (savollar va barcha variantlar shu tilda)' : 'savollar va variantlar fayl mazmuni qaysi tilda bo\'lsa, shu tilda'}.\n` +
    (topic ? `Foydalanuvchi izohi/yo'nalishi: "${topic}" — savollarni shunga e'tibor berib tuz.\n` : '') +
    `Qiyinlik: ${AI_LEVELS[level] || AI_LEVELS.mix}.\n` +
    `Qoidalar:\n- Savollar FAQAT fayldagi ma'lumotga asoslansin; fayldan tashqari faktlarni o'ylab topma. To'g'ri javob fayldan aniq va bahssiz kelib chiqsin.\n` +
    `- Har savol uchun "source" maydoniga fayldagi dalilni (qisqa iqtibos yoki sahifa/joy tavsifi, 120 belgigacha) yoz; dalil topa olmasang, o'sha savolni tashlab yubor.\n` +
    `- Rasmda yoki skanerlangan sahifada matn bo'lsa, uni o'qi. Jadval, diagramma va rasmdagi narsalar haqida ham savol berish mumkin.\n` +
    `- Muhim tushuncha, sabab-oqibat, raqam, atama va ta'riflarga e'tibor ber; mayda, ahamiyatsiz tafsilotlarni (sahifa raqami, tasodifiy so'z) so'rama.\n` +
    `- Har savolda aynan 4 ta variant, faqat bittasi to'g'ri. Noto'g'ri variantlar ishonarli bo'lsin: fayldagi boshqa tushuncha/raqamlardan ol. "Hammasi", "hech biri" variantlarini ishlatma; to'g'ri variant boshqalaridan uzun yoki ajralib turmasin.\n` +
    `- Savollar bir-biriga o'xshamasin va bir-birining javobini oshkor qilmasin.\n` +
    `- Savol o'zi mustaqil tushunarli bo'lsin: "faylga ko'ra", "rasmda", "matnda" kabi iboralarni ishlatma.\n` +
    `- Savol matni 200 belgidan, variant 80 belgidan oshmasin.\n- To'g'ri javob o'rni (0-3) tasodifiy bo'lsin.\n- Tasodifiylik kaliti: ${nonce}.\n` +
    `- Agar fayl bo'sh yoki o'qib bo'lmasa — {"questions":[]} qaytar.\n` +
    `Javobni FAQAT quyidagi JSON ko'rinishida qaytar, boshqa matn yoki markdown yozma:\n` +
    `{"questions":[{"text":"...","source":"...","opts":["A","B","C","D"],"correct":0}]}`;
}
async function geminiUploadFile(buf, mime, signal) {
  const hdr = { 'x-goog-api-key': AI_KEY };
  const st = await fetch(GEMINI_BASE + '/upload/v1beta/files', { method: 'POST', signal,
    headers: { ...hdr, 'content-type': 'application/json', 'x-goog-upload-protocol': 'resumable', 'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': String(buf.length), 'x-goog-upload-header-content-type': mime },
    body: JSON.stringify({ file: { display_name: 'quiz-source' } }) });
  const url = st.headers.get('x-goog-upload-url');
  if (!st.ok || !url) { let msg = ''; try { msg = ((await st.json()).error || {}).message || ''; } catch {} console.error('[AI/file] start', st.status, msg.slice(0, 200)); const e = new Error(aiErrText(st.status, msg)); e.status = st.status; e.badKey = st.status === 401 || st.status === 403; throw e; }
  const up = await fetch(url, { method: 'POST', signal, headers: { 'x-goog-upload-offset': '0', 'x-goog-upload-command': 'upload, finalize' }, body: buf });
  if (!up.ok) { let msg = ''; try { msg = ((await up.json()).error || {}).message || ''; } catch {} console.error('[AI/file] upload', up.status, msg.slice(0, 200)); const e = new Error(aiErrText(up.status, msg)); e.status = up.status; throw e; }
  const f = (await up.json()).file || {};
  if (!f.uri || !f.name) throw new Error('Gemini faylni qabul qilmadi');
  let state = f.state || 'ACTIVE'; const t0 = Date.now();
  while (state !== 'ACTIVE') {                                              // katta PDF bir necha soniya qayta ishlanishi mumkin
    if (state === 'FAILED' || Date.now() - t0 > 60000) throw new Error('Gemini faylni qayta ishlay olmadi (fayl buzuq yoki juda murakkab)');
    await new Promise(r => setTimeout(r, 1200));
    const g = await fetch(`${GEMINI_BASE}/v1beta/${f.name}`, { signal, headers: hdr });
    if (g.ok) state = (await g.json()).state || 'ACTIVE';
  }
  return { name: f.name, uri: f.uri };
}
const geminiDeleteFile = name => { fetch(`${GEMINI_BASE}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': AI_KEY } }).catch(() => {}); };
// Fayl qismi bir marta tayyorlanadi va keshlanadi (kichik: base64, katta: Gemini Files API) — keyingi so'rovlar darhol ketadi
async function aiFilePart(f) {
  if (f.size <= AI_INLINE_MAX) {
    if (!f.b64) f.b64 = (await fs.promises.readFile(f.path)).toString('base64');
    return { inlineData: { mimeType: f.mime, data: f.b64 } };
  }
  if (!f.remote) {
    f.remote = (async () => {
      const buf = await fs.promises.readFile(f.path);
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 90000);
      try { return await geminiUploadFile(buf, f.mime, ctl.signal); }
      catch (e) { throw e && e.name === 'AbortError' ? new Error('Faylni AI ga yuborish vaqti tugadi. Qayta urinib ko\'ring.') : e; }
      finally { clearTimeout(to); }
    })();
    f.remote.catch(() => { f.remote = null; });
  }
  const r = await f.remote;
  return { fileData: { mimeType: f.mime, fileUri: r.uri } };
}
async function aiMakeFromFile(room, topic, level, n, lang) {
  const f = room.aiFile;
  if (!f) { const e = new Error('Avval fayl yuklang.'); e.noFile = true; throw e; }
  let part;
  try { part = await aiFilePart(f); }
  catch (e) { if (e && e.code === 'ENOENT') { if (room.aiFile === f) room.aiFile = null; const x = new Error('Fayl topilmadi — qayta yuklang.'); x.noFile = true; throw x; } throw e; }
  const k = n > 12 ? Math.min(3, Math.ceil(n / 10)) : 1;                    // ko'p savol: bir nechta parallel so'rov (tezroq)
  if (k === 1) return aiMakeChunk(topic, level, n, lang, null, 'gemini', { parts: [part] });
  const sizes = Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0) + 1);
  const res = await Promise.all(sizes.map((sz, i) => aiMakeChunk(topic, level, sz, lang, null, 'gemini', { parts: [part], part: { i, k } }).catch(e => { console.error('[AI/file] bo\'lak xatosi:', e && e.message); return { err: e }; })));
  const out = [], seen = new Set();
  res.forEach(r => { if (Array.isArray(r)) r.forEach(q => { const key = q.text.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(q); } }); });
  if (out.length >= Math.min(3, n)) return shuffle(out).slice(0, n);
  throw (res.find(r => r && r.err) || {}).err || new Error('AI savol tuza olmadi');
}
// Oldindan tayyorlash: fayl yuklangach (yoki sozlama o'zgargach) savollar fonda tuziladi — "Boshlash" bosilganda darhol chiqadi
const aiFileKey = p => `${String(p.topic || '').toLowerCase()}|${p.level}|${p.lang}`;
function aiFilePre(room, p) {
  const f = room.aiFile;
  if (!f) return null;
  const key = aiFileKey(p);
  if (f.pre && f.pre.key === key && f.pre.n >= p.count && !f.pre.failed) return f.pre;
  const pre = { key, n: p.count, qs: null, failed: false, done: false };
  aiActive++;
  pre.promise = aiMakeFromFile(room, p.topic, p.level, p.count, p.lang)
    .then(qs => { pre.qs = qs; return qs; })
    .catch(e => { pre.failed = true; throw e; })
    .finally(() => { pre.done = true; aiActive--; });
  pre.promise.catch(() => {});
  f.pre = pre;
  return pre;
}
const dropAiFile = room => {
  const f = room.aiFile;
  if (!f) return;
  fs.unlink(f.path, () => {});
  if (f.remote) f.remote.then(r => geminiDeleteFile(r.name)).catch(() => {});     // Gemini'dagi nusxa ham o'chiriladi
  room.aiFile = null;
};
// Tezlik: savollar bir nechta kichik bo'lakka bo'linib, Gemini'ga PARALLEL so'raladi (kam savol = tez javob).
const AI_CHUNK = 12;                                       // bitta so'rovdagi savollar (taxminan)
const AI_MAX_CHUNKS = 3;                                   // limitni tejash: 12 tagacha savol = 1 so'rov, 30 tagacha = 3 so'rov
const AI_WARM = process.env.AI_WARM !== '0';              // AI_WARM=0 — oldindan tayyorlashni butunlay o'chiradi
async function aiMakeQuestions(topic, level, n, lang, prov) {
  const k = Math.min(AI_MAX_CHUNKS, Math.max(1, Math.ceil(n / AI_CHUNK)));
  if (k === 1) return aiMakeChunk(topic, level, n, lang, null, prov);
  const sizes = Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
  const pool = shuffle(AI_TOPICS); let at = 0;
  const jobs = sizes.map((sz, i) => {
    const tp = []; for (let j = 0; j < sz; j++) tp.push(pool[(at++) % pool.length]);
    return aiMakeChunk(topic, level, sz + 1, lang, { i, k, topics: tp }, prov).catch(e => { console.error('[AI] bo\'lak xatosi:', e && e.message); return { err: e }; });
  });
  const res = await Promise.all(jobs);
  const out = [], seen = new Set();
  const add = list => { for (const q of list) { const key = q.text.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(q); } } };
  const errs = res.filter(r => r && r.err).map(r => r.err);
  res.forEach(r => { if (Array.isArray(r)) add(r); });
  if (out.length < n && errs.length < res.length) {                       // yetishmaganini bitta qo'shimcha so'rov bilan to'ldiramiz
    try { add(await aiMakeChunk(topic, level, Math.min(n - out.length + 2, 10), lang, null, prov)); } catch (e) { errs.push(e); }
  }
  if (out.length >= 3) return shuffle(out).slice(0, n);
  throw errs[0] || new Error('AI savol tuza olmadi');
}
// ---- Oldindan tayyorlash: Transmitter AI Quiz bo'limini ochgach savollar fonda tayyorlanadi, "Boshlash" bosilganda darhol chiqadi
const aiPool = new Map();                                  // kalit -> { qs: [], t, filling }
const AI_POOL_TTL = 30 * 60 * 1000;
const aiKeyOf = (topic, level, lang, prov) => `${prov}|${lang}|${level}|${topic.toLowerCase()}`;
function aiPoolTake(key, n) {
  const e = aiPool.get(key);
  if (!e || Date.now() - e.t > AI_POOL_TTL || e.qs.length < n) return null;
  return e.qs.splice(0, n);
}
async function aiPoolFill(key, topic, level, lang, n, prov) {
  if (!aiHas(prov)) return 0;
  let e = aiPool.get(key);
  if (!e) { e = { qs: [], t: 0, filling: false }; aiPool.set(key, e); }
  if (Date.now() - e.t > AI_POOL_TTL) e.qs = [];
  if (e.filling || e.qs.length >= n || aiActive >= AI_MAX_PARALLEL) return e.qs.length;
  e.filling = true; aiActive++;
  try {
    const qs = await aiMakeQuestions(topic, level, n - e.qs.length, lang, prov);
    const seen = new Set(e.qs.map(q => q.text.toLowerCase()));
    qs.forEach(q => { if (!seen.has(q.text.toLowerCase())) e.qs.push(q); });
    e.t = Date.now();
  } catch (err) { console.error('[AI] oldindan tayyorlash xatosi:', err && err.message); }
  finally { e.filling = false; aiActive--; }
  while (aiPool.size > 12) aiPool.delete(aiPool.keys().next().value);      // xotira cheklovi
  return e.qs.length;
}
function aiParams(m) {
  const topic = String(m.topic || '').replace(/[\r\n"]+/g, ' ').trim().slice(0, 120);
  const lang = Object.prototype.hasOwnProperty.call(AI_LANGS, m.lang) ? m.lang : '';
  const level = Object.prototype.hasOwnProperty.call(AI_LEVELS, m.level) ? m.level : 'mix';
  const time = clampN(Math.round(Number(m.time) || 15), 5, 120);
  const count = clampN(Math.round(Number(m.count) || AI_COUNT), AI_MIN, AI_MAX);
  return { topic, lang, level, time, count, prov: aiProv(m.provider) };
}
async function quizAiWarm(room, ws, m) {
  const reply = o => send(ws, Object.assign({ type: 'quiz-ai-warm' }, o));
  if (m.fromFile) {                                                         // 📎 fayl: savollar fonda tayyorlanadi
    if (!AI_KEY || !room.aiFile || room.quiz || room.aiBusy || !AI_WARM) return;
    const p = aiParams(m);
    if (aiActive >= AI_MAX_PARALLEL) return;
    const pre = aiFilePre(room, p);
    if (!pre) return;
    try { await pre.promise; reply({ ready: true, n: pre.qs ? pre.qs.length : 0 }); } catch { reply({ ready: false, n: 0 }); }
    return;
  }
  const { prov: pv } = aiParams(m);
  if (!aiHas(pv) || room.quiz || room.aiBusy) return;
  if (!AI_WARM || (room.warmNext || 0) > Date.now()) return;
  room.warmNext = Date.now() + 30000;
  const { topic, lang, level, count, prov } = aiParams(m);
  const key = aiKeyOf(topic, level, lang, prov);
  const have = await aiPoolFill(key, topic, level, lang, count, prov);
  reply({ ready: have >= count, n: have });
}
async function quizAiStart(room, ws, m) {
  const reply = o => send(ws, Object.assign({ type: 'quiz-ai' }, o));
  const fromFile = !!m.fromFile;
  const pv0 = fromFile ? 'gemini' : aiProv(m.provider);
  if (fromFile && !AI_KEY) return reply({ busy: false, error: 'Fayldan quiz tuzish uchun serverda GEMINI_API_KEY kerak (Groq PDF va HEIC o\'qiy olmaydi).' });
  if (fromFile && !room.aiFile) return reply({ busy: false, error: 'Avval fayl yuklang.', noFile: true });
  if (!aiHas(pv0)) return reply({ busy: false, error: pv0 === 'groq' ? 'Groq sozlanmagan: serverda GROQ_API_KEY o\'rnatilmagan.' : 'AI sozlanmagan: serverda GEMINI_API_KEY o\'rnatilmagan.' });
  if (room.aiBusy) return reply({ busy: true });
  const wait = (room.aiNext || 0) - Date.now();
  if (wait > 0) return reply({ busy: false, error: `Biroz kuting (${Math.ceil(wait / 1000)} s) va qayta bosing.` });
  if (aiActive >= AI_MAX_PARALLEL + (fromFile ? 1 : 0)) return reply({ busy: false, error: 'AI hozir band. Bir necha soniyadan keyin urinib ko\'ring.' });
  const { topic, lang, level, time, count, prov } = aiParams(m);
  const key = aiKeyOf(topic, level, lang, prov);
  room.aiBusy = true; aiActive++; room.aiNext = Date.now() + 5000;
  reply({ busy: true });
  try {
    let qs = fromFile ? null : aiPoolTake(key, count), cached = !!qs;       // tayyor bo'lsa — darhol
    if (fromFile) {
      const pre = room.aiFile && room.aiFile.pre;
      if (pre && !pre.failed && pre.key === aiFileKey({ topic, level, lang }) && pre.n >= count) { try { qs = (await pre.promise).slice(0, count); cached = true; } catch { qs = null; } }
      if (!qs || qs.length < Math.min(3, count)) qs = await aiMakeFromFile(room, topic, level, count, lang);
    }
    else if (!qs) {
      const e = aiPool.get(key);
      if (e && e.filling) { const t0 = Date.now(); while (e.filling && Date.now() - t0 < AI_TOTAL_MS) await new Promise(r => setTimeout(r, 150)); qs = aiPoolTake(key, count); cached = !!qs; }   // fonda tayyorlanmoqda: shuni kutamiz
      if (!qs) qs = await aiMakeQuestions(topic, level, count, lang, prov);
    }
    if (rooms.get(room.code) !== room || !room.host) return;
    const fname = fromFile && room.aiFile ? room.aiFile.name.replace(/\.[^.]+$/, '').slice(0, 60) : '';
    const r = sanitizeQuiz(room, { title: fromFile ? `📎 ${fname || 'Fayldan quiz'}` : topic ? `🤝 Do'stlar poygasi: ${topic}` : '🤝 Do\'stlar poygasi', questions: qs.map(q => ({ ...q, time, pts: 'std' })) });
    if (r.error) throw new Error(r.error);
    startQuiz(room, r, { hideOpts: !!m.hideOpts, hideQ: !!m.hideQ, celebrate: m.celebrate !== false, stickers: m.stickers !== false, stickerPack: m.stickerPack, auto: m.auto !== false, mode: 'friend', strict: m.strict !== false, strikes: m.strikes, kahoot: m.kahoot !== false, hostPlay: !!m.hostPlay });
    if (fromFile) dropAiFile(room);                                          // quiz tayyor: manba fayl serverdan o'chiriladi
    reply({ busy: false, ok: true });
  } catch (e) {
    console.error('AI viktorina xatosi:', e && e.message);
    reply({ busy: false, error: (e && e.message) || 'AI savol tuza olmadi', noFile: !!(e && e.noFile) });
  } finally { room.aiBusy = false; aiActive--; }
}
function startQuiz(room, r, o) {
  if (room.quiz) clearTimeout(room.quiz.timer);
  room.quiz = { id: crypto.randomBytes(4).toString('hex'), title: r.title, questions: r.questions, hideOpts: !!o.hideOpts, hideQ: !!o.hideQ, celebrate: o.celebrate !== false,
    stickers: o.stickers !== false, stickerPack: packOf(o.stickerPack), auto: !!o.auto, mode: o.mode || 'std',
    kind: o.kind === 'hw' ? 'hw' : 'quiz',                     // 'hw' — 📝 Uyga vazifa tekshirish (o'tish limiti bilan, alohida natija jadvali)
    pass: clampN(Math.round(Number(o.pass) || 60), 1, 100),    // uyga vazifa: o'tish limiti (to'g'ri javoblar foizi)
    kahoot: o.kahoot !== false,                                // true: Kahoot ballari (tezlik + seriya); false: faqat to'g'ri javoblar soni
    hostPlay: !!o.hostPlay,                                    // Transmitter ham o'yinchi sifatida javob beradi
    strict: o.strict !== false, strikeLimit: [0, 2, 3, 5, 10].includes(Number(o.strikes)) ? Number(o.strikes) : 2, idx: -1, phase: 'lobby', players: new Map(), answers: new Map(), startAt: 0, endAt: 0, timer: null };
  if (room.quiz.kind === 'hw') Object.assign(room.quiz, { kahoot: false, hostPlay: false, stickers: false, celebrate: false });   // uyga vazifa: faqat to'g'ri javoblar soni, o'qituvchi topshirmaydi, belgilarsiz
  room.clients.forEach(c => quizPlayer(room, c));
  if (room.quiz.hostPlay) quizHostJoin(room);
  broadcastQuiz(room);
  room.quizDirty = true;
}
const QTYPES = ['choice', 'tf', 'multi', 'text', 'slider', 'order', 'poll'];
function sanitizeQuiz(room, raw) {
  if (!raw || !Array.isArray(raw.questions)) return { error: 'Savollar yo\'q' };
  const qs = [];
  for (const q of raw.questions.slice(0, raw.kind === 'hw' ? 100 : 50)) {
    const text = String(q.text || '').trim().slice(0, 240);
    const type = QTYPES.includes(q.type) ? q.type : 'choice';
    const img = typeof q.img === 'string' && q.img.startsWith(`/qimg/${room.code}/`) && QIMG_RE.test(q.img.split('/').pop()) ? q.img : null;
    const base = { type, text, img, time: clampN(Math.round(Number(q.time) || 20), 5, 120), pts: ['std', 'double', 'none'].includes(q.pts) ? q.pts : 'std' };
    const bad = m => ({ error: `${qs.length + 1}-savol to'liq emas${m ? ': ' + m : ''}` });
    if (!text) return bad();
    const cleanOpts = () => {                               // bo'sh variantlar tashlanadi; asl indeks → yangi indeks xaritasi
      const kept = [], map = new Map();
      (Array.isArray(q.opts) ? q.opts : []).slice(0, 4).forEach((o, i) => { const t = String(o || '').trim().slice(0, 120); if (t) { map.set(i, kept.length); kept.push(t); } });
      return { kept, map };
    };
    if (type === 'tf') {
      qs.push({ ...base, opts: ["To'g'ri", "Noto'g'ri"], correct: Number(q.correct) === 1 ? 1 : 0 });
    } else if (type === 'text') {
      const raw2 = Array.isArray(q.accepts) ? q.accepts : String(q.accepts || '').split('|');
      const accepts = [...new Set(raw2.map(x => String(x || '').trim().slice(0, 40)).filter(Boolean))].slice(0, 10);
      if (!accepts.length) return bad('javob yozilmagan');
      qs.push({ ...base, opts: [], correct: -1, accepts });
    } else if (type === 'slider') {
      const min = Number(q.min), max = Number(q.max), target = Number(q.target);
      if (![min, max, target].every(Number.isFinite) || max <= min || max - min > 1e7 || target < min || target > max) return bad('slayder oralig\'i noto\'g\'ri');
      const margin = clampN(Number.isFinite(Number(q.margin)) ? Number(q.margin) : 0, 0, max - min);
      qs.push({ ...base, opts: [], correct: -1, min, max, target, margin, step: Number(q.step) > 0 ? Number(q.step) : (max - min <= 100 ? 1 : Math.max(1, Math.round((max - min) / 100))) });
    } else if (type === 'order') {
      const { kept } = cleanOpts();
      if (kept.length < 3) return bad('tartiblash uchun kamida 3 ta element kerak');
      qs.push({ ...base, opts: kept, correct: -1 });
    } else if (type === 'poll') {
      const { kept } = cleanOpts();
      if (kept.length < 2) return bad('kamida 2 ta variant kerak');
      qs.push({ ...base, opts: kept, correct: -1, pts: 'none', multi: !!q.multi });
    } else if (type === 'multi') {
      const { kept, map } = cleanOpts();
      const cs = [...new Set((Array.isArray(q.corrects) ? q.corrects : []).map(Number).filter(i => map.has(i)).map(i => map.get(i)))].sort((x, y) => x - y);
      if (kept.length < 2 || !cs.length) return bad('to\'g\'ri variantlarni belgilang');
      qs.push({ ...base, opts: kept, correct: cs[0], corrects: cs });
    } else {
      const { kept, map } = cleanOpts();
      const nc = map.has(Number(q.correct)) ? map.get(Number(q.correct)) : -1;
      if (kept.length < 2 || nc < 0) return bad();
      qs.push({ ...base, type: 'choice', opts: kept, correct: nc });
    }
  }
  if (!qs.length) return { error: 'Kamida bitta savol kerak' };
  return { title: String(raw.title || 'Viktorina').trim().slice(0, 80) || 'Viktorina', questions: qs };
}
// 📝 Uyga vazifa: natija jadvali va o'tdi / o'tmadi
function hwRows(qz) {
  const total = qz.questions.length;
  return [...qz.players.values()].filter(p => !p.host).map(p => {
    const right = p.right || 0;
    return { name: p.name, right, total, pct: total ? Math.round(right / total * 1000) / 10 : 0, passed: !p.dq && right * 100 >= qz.pass * total, dq: !!p.dq, sec: Math.round((p.t || 0) / 1000) };
  }).sort((a, b) => (a.dq - b.dq) || b.right - a.right || a.sec - b.sec || a.name.localeCompare(b.name));
}
function hwMeExtra(qz, p) {                                   // receiverga o'z natijasi (faqat o'ziniki)
  if (!qz || qz.kind !== 'hw' || !p) return {};
  const total = qz.questions.length, right = p.right || 0, e = { hw: true, right, total, pass: qz.pass };
  if (qz.phase === 'final') { e.pct = total ? Math.round(right / total * 1000) / 10 : 0; e.passed = !p.dq && right * 100 >= qz.pass * total; }
  return e;
}
function quizRanking(qz) {
  const count = qz.kahoot === false;                          // soni bo'yicha rejimda ball teng bo'lsa — jami javob vaqti kam bo'lgan yuqori
  return [...qz.players.entries()].map(([tok, p]) => ({ tok, name: p.name, av: p.av, score: p.score, delta: p.last ? p.last.delta : 0, dq: !!p.dq, t: p.t || 0 }))
    .sort((a, b) => (a.dq - b.dq) || b.score - a.score || (count ? a.t - b.t : 0) || a.name.localeCompare(b.name));
}
// forHost=false: receiverga yuboriladigan nusxa. "Faqat savol" rejimida (hideOpts) variantlar matni savol paytida
// receiverga UMUMAN yuborilmaydi (brauzer/DevTools/nusxa orqali ham ko'rib bo'lmaydi) — faqat variantlar soni va rangi.
function quizPub(room, forHost = true) {
  const qz = room.quiz;
  if (!qz) return null;
  const q = qz.questions[qz.idx];
  const pub = { id: qz.id, title: qz.title, phase: qz.phase, idx: qz.idx, total: qz.questions.length, players: qz.players.size, startAt: qz.startAt, endAt: qz.endAt, hideOpts: !!qz.hideOpts, hideQ: !!qz.hideQ, celebrate: qz.celebrate !== false, stickers: qz.stickers !== false, stickerPack: packOf(qz.stickerPack), auto: !!qz.auto, kahoot: qz.kahoot !== false, hostPlay: !!qz.hostPlay, mode: qz.mode || 'std', strict: qz.strict !== false, strikeLimit: qz.strikeLimit == null ? 2 : qz.strikeLimit, kind: qz.kind || 'quiz', pass: qz.kind === 'hw' ? qz.pass : 0 };
  if (forHost) pub.cheat = [...qz.players.values()].filter(p => p.strikes > 0).map(p => ({ name: p.name, strikes: p.strikes, dq: !!p.dq, why: p.why || '' })).sort((a, b) => b.strikes - a.strikes).slice(0, 30);
  if (q && (qz.phase === 'question' || qz.phase === 'reveal')) {
    const hide = !forHost && qz.hideOpts && qz.phase === 'question';
    const hideQ = !forHost && qz.hideQ && qz.phase === 'question';       // savol matni (va rasmi) ham receiverga yuborilmaydi
    const T = q.type || 'choice', dispOpts = T === 'order' && q.shuf ? q.shuf.map(k => q.opts[k]) : q.opts;
    pub.q = { type: T, text: hideQ ? '' : q.text, img: hideQ ? null : q.img, opts: hide ? dispOpts.map(() => '') : dispOpts, time: q.time, pts: q.pts };
    if (T === 'multi') pub.q.multi = true;
    if (T === 'poll' && q.multi) pub.q.multi = true;
    if (T === 'slider') Object.assign(pub.q, { min: q.min, max: q.max, step: q.step });
  }
  const noAv = t => (qz.stickers === false && t ? t.map(x => ({ ...x, av: '' })) : t);
  const topOf = t => (!forHost && qz.kind === 'hw' ? [] : noAv(t));      // uyga vazifada receiver boshqalarning natijasini ko'rmaydi
  if (qz.phase === 'reveal') {
    pub.correct = q.correct; pub.counts = qz.counts; pub.top = topOf(qz.top); pub.stat = qz.stat || null;
    if (q.type === 'multi') pub.corrects = q.corrects;
    if (q.type === 'text') pub.accepts = q.accepts;
    if (q.type === 'slider') Object.assign(pub, { target: q.target, margin: q.margin });
    if (q.type === 'order') pub.order = q.opts;                          // to'g'ri tartib
  }
  if (qz.phase === 'final') { pub.top = topOf(qz.top); if (forHost && qz.hw) pub.hw = qz.hw; }
  if (forHost && (qz.phase === 'reveal' || qz.phase === 'final')) pub.all = noAv(quizRanking(qz).filter(r => !r.dq).map(r => ({ name: r.name, av: r.av, score: r.score, delta: qz.phase === 'final' ? 0 : r.delta, mv: qz.phase === 'final' ? 0 : ((qz.mv && qz.mv.get(r.tok)) || 0) })));   // Transmitter hamma o'yinchilarni ko'radi
  return pub;
}
// host va receiverlarga alohida (har biri BIR marta JSON'ga aylantiriladi)
function broadcastQuiz(room) {
  if (!room.quiz) return broadcast(room, { type: 'quiz', quiz: null });
  send(room.host, { type: 'quiz', quiz: quizPub(room, true) });
  sendAll(room.clients, { type: 'quiz', quiz: quizPub(room, false) });
}
function quizMe(room, tok) {
  const qz = room.quiz, p = qz && qz.players.get(tok);
  if (!p) return null;
  const me = { score: p.score, streak: p.streak, answered: !!(p.last && p.last.answered), ok: !!(p.last && p.last.ok), delta: p.last ? p.last.delta : 0, n: qz.players.size, strikes: p.strikes || 0, dq: !!p.dq, limit: qz.strikeLimit == null ? 2 : qz.strikeLimit, ...hwMeExtra(qz, p) };
  if (qz.phase === 'reveal' || qz.phase === 'final') me.rank = quizRanking(qz).findIndex(r => r.tok === tok) + 1;
  return me;
}
function quizPlayer(room, ws) {
  const qz = room.quiz, tok = ws.ctx.tok;
  if (qz.stickers !== false && (!ws.ctx.av || !STK.list(qz.stickerPack).includes(ws.ctx.av))) ws.ctx.av = pickAvatar(qz.stickerPack);
  let p = qz.players.get(tok);
  if (!p) { p = { name: ws.ctx.name, av: ws.ctx.av, score: 0, streak: 0, last: null, strikes: 0, dq: false, why: '', strikeAt: 0 }; qz.players.set(tok, p); room.quizDirty = true; }
  else if (p.av && ws.ctx.av !== p.av) ws.ctx.av = p.av;       // qayta ulanganda tanlangan hayvonchasi saqlanadi
  return p;
}
// Transmitter o'yinchi sifatida: o'z tokeni bilan players'ga qo'shiladi (hostPlay yoqilganda)
function quizHostJoin(room) {
  const qz = room.quiz;
  if (!qz || !room.host) return null;
  const p = quizPlayer(room, room.host);
  p.host = true;
  return p;
}
function quizHostLeave(room) {
  const qz = room.quiz;
  if (!qz || !room.host) return;
  qz.players.delete(room.host.ctx.tok); qz.answers.delete(room.host.ctx.tok);
  room.quizDirty = true;
}
function quizSendMe(room) {
  const qz = room.quiz;
  const pos = new Map(quizRanking(qz).map((r, i) => [r.tok, i + 1]));
  const targets = [...room.clients]; if (qz.hostPlay && room.host) targets.push(room.host);
  targets.forEach(c => {
    const p = qz.players.get(c.ctx.tok);
    if (!p) return;
    send(c, { type: 'quiz-me', me: { score: p.score, streak: p.streak, answered: !!(p.last && p.last.answered), ok: !!(p.last && p.last.ok), delta: p.last ? p.last.delta : 0, rank: pos.get(c.ctx.tok), n: qz.players.size, strikes: p.strikes || 0, dq: !!p.dq, limit: qz.strikeLimit == null ? 2 : qz.strikeLimit, ...hwMeExtra(qz, p) } });
  });
}
const normTxt = t => String(t == null ? '' : t).toLowerCase().normalize('NFKC').replace(/[\u2018\u2019\u02bb\u02bc`´]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
function shuffleIdx(n) { const a = [...Array(n).keys()]; do { for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } } while (n > 1 && a.every((v, k) => v === k)); return a; }
function quizNext(room) {
  const qz = room.quiz;
  clearTimeout(qz.timer);
  if (qz.idx + 1 >= qz.questions.length) return quizFinal(room);
  qz.idx++; qz.phase = 'question'; qz.answers = new Map(); qz.counts = null; qz.early = false;
  qz.players.forEach(p => { p.last = null; });
  const q = qz.questions[qz.idx];
  if (q.type === 'order') q.shuf = shuffleIdx(q.opts.length);        // receiverlarga aralash tartibda ko'rsatiladi (display[k] = asl indeks shuf[k])
  qz.startAt = Date.now() + 3500;                      // "Tayyor bo'ling" sanog'i, rasm yuklanishi uchun
  qz.endAt = qz.startAt + q.time * 1000;
  broadcastQuiz(room);
  qz.timer = setTimeout(() => quizReveal(room), qz.endAt - Date.now() + 1200);
  room.quizDirty = true;
}
function quizReveal(room) {
  const qz = room.quiz;
  if (!qz || qz.phase !== 'question') return;
  clearTimeout(qz.timer);
  qz.phase = 'reveal';
  const q = qz.questions[qz.idx];
  const T = q.type || 'choice';
  qz.counts = ['text', 'slider', 'order'].includes(T) ? null : q.opts.map(() => 0);
  if (qz.counts) qz.answers.forEach(a => { (a.sel || [a.i]).forEach(k => { if (qz.counts[k] != null) qz.counts[k]++; }); });
  const stat = { n: qz.answers.size, right: 0 };
  qz.answers.forEach(a => { if (a.ok) stat.right++; });
  if (T === 'text') { const m = new Map(); qz.answers.forEach(a => { const k = normTxt(a.txt); if (!k) return; const e = m.get(k) || { t: String(a.txt).slice(0, 40), n: 0, ok: !!a.ok }; e.n++; m.set(k, e); }); stat.words = [...m.values()].sort((x, y) => y.n - x.n).slice(0, 8); }
  if (T === 'slider') stat.vals = [...qz.answers.values()].map(a => a.v).filter(Number.isFinite).slice(0, 300);
  qz.stat = stat;
  qz.players.forEach((p, tok) => { if (!qz.answers.has(tok)) { p.streak = 0; p.last = { ok: false, delta: 0, answered: false }; } });
  const rk = quizRanking(qz).filter(r => !r.dq), prev = qz.prevRank || new Map();
  qz.mv = new Map(rk.map((r, i) => [r.tok, prev.has(r.tok) ? prev.get(r.tok) - (i + 1) : 0]));     // oldingi o'ringa nisbatan ↑/↓
  qz.prevRank = new Map(rk.map((r, i) => [r.tok, i + 1]));
  qz.top = rk.slice(0, 5).map(r => ({ name: r.name, av: r.av, score: r.score, delta: r.delta, mv: qz.mv.get(r.tok) || 0 }));
  broadcastQuiz(room);
  quizSendMe(room);
  quizAutoNext(room);
}
const QUIZ_AUTO_MS = Number(process.env.QUIZ_AUTO_MS) || 2500;      // avtomatik rejimda javob/reyting ko'rsatilgach keyingi savolga o'tish (standart 2,5 s)
const QUIZ_EARLY_MS = Number(process.env.QUIZ_EARLY_MS) || 150;     // hamma javob bergach to'g'ri javob ochilguncha kutish
function quizAutoNext(room) {
  const qz = room.quiz;
  if (!qz || !qz.auto || qz.phase !== 'reveal') return;
  clearTimeout(qz.timer);
  qz.timer = setTimeout(() => { if (room.quiz === qz && qz.phase === 'reveal' && qz.auto) quizNext(room); }, QUIZ_AUTO_MS);
}
function quizFinal(room) {
  const qz = room.quiz;
  clearTimeout(qz.timer);
  qz.phase = 'final';
  qz.top = quizRanking(qz).filter(r => !r.dq).slice(0, 10).map(r => ({ name: r.name, av: r.av, score: r.score, delta: 0 }));
  if (qz.kind === 'hw') qz.hw = { pass: qz.pass, total: qz.questions.length, title: qz.title, rows: hwRows(qz) };
  broadcastQuiz(room);
  quizSendMe(room);
}
function quizCheckEarly(room) {                         // hamma javob bergan bo'lsa, vaqtni kutmasdan ochamiz
  const qz = room.quiz;
  const need = room.clients.size + (qz && qz.hostPlay && room.host ? 1 : 0);
  if (!qz || qz.phase !== 'question' || qz.early || !need || Date.now() < qz.startAt) return;
  if (qz.answers.size >= need) { qz.early = true; clearTimeout(qz.timer); qz.timer = setTimeout(() => quizReveal(room), QUIZ_EARLY_MS); }
}

const pollPub = p => p && { id: p.id, q: p.q, opts: p.opts, votes: p.votes, open: p.open };

function sendMembers(room) {
  if (room.memT) return;
  room.memT = setTimeout(() => { room.memT = null; if (rooms.has(room.code)) flushMembers(room); }, room.clients.size > 20 ? 600 : 120);
}
// Kirgan receiverlar ro'yxati (roster): telefon ekrani o'chsa yoki tarmoq uzilsa ham receiver ro'yxatdan YO'QOLMAYDI — «oflayn» bo'lib turadi,
// qayta ulansa (shu qurilma tokeni bilan) yana onlayn bo'ladi. Transmitter ✕ bilan chiqarsa yoki xona yopilsa o'chadi.
const ROSTER_KEEP_MS = 3 * 60 * 60 * 1000;
function flushMembers(room) {
  const clients = [...room.clients].filter(c => c.ctx);
  let ready = 0;
  const roster = room.roster || (room.roster = new Map()), now = Date.now();
  const online = new Set();
  for (const c of clients) {
    if (c.ctx.ready) ready++;
    online.add(c.ctx.tok);
    const e = roster.get(c.ctx.tok);
    if (e) { e.id = c.ctx.id; e.name = c.ctx.name; e.av = c.ctx.av; e.dev = c.ctx.dev || null; e.off = 0; }
    else roster.set(c.ctx.tok, { id: c.ctx.id, name: c.ctx.name, av: c.ctx.av, dev: c.ctx.dev || null, off: 0, since: now });
  }
  const offline = [];
  for (const [tok, e] of roster) {
    if (online.has(tok)) continue;
    if (!e.off) e.off = now;
    if (now - e.off > ROSTER_KEEP_MS) { roster.delete(tok); continue; }
    offline.push(e);
  }
  const base = { type: 'members', total: clients.length, ready, joined: clients.length + offline.length, hostOnline: !!room.host };
  sendAll(clients, base);
  send(room.host, {
    ...base,
    list: clients.slice(0, MAX_CLIENTS).map(c => ({ id: c.ctx.id, name: c.ctx.name, av: c.ctx.av, ready: !!c.ctx.ready, muted: !!c.ctx.muted, stat: c.ctx.stat || null, via: c.ctx.parent || null, dev: c.ctx.dev || null }))
      .concat(offline.slice(0, 200).map(e => ({ id: e.id, name: e.name, av: e.av, ready: false, muted: false, stat: null, via: null, dev: e.dev, off: true }))),
  });
}

// ---- Efir daraxti: Transmitter -> (relay receiverlar) -> boshqa receiverlar. Transmitter yukini cheklaydi, 100+ tinglovchi uchun
function depthOf(room, c) {
  let d = 1, p = c.ctx.parent;
  while (p && p !== 'host' && d < 12) { const pc = clientById(room, p); if (!pc) break; d++; p = pc.ctx.parent; }
  return d;
}
function isDescendant(room, x, anc) {                  // x, anc ning avlodimi?
  let p = x.ctx.parent, n = 0;
  while (p && p !== 'host' && n++ < 12) { if (p === anc.ctx.id) return true; const pc = clientById(room, p); if (!pc) return false; p = pc.ctx.parent; }
  return false;
}
function detach(room, c) {
  const p = c.ctx.parent;
  c.ctx.parent = null;
  if (!p) return;
  if (p === 'host') send(room.host, { type: 'rtc-gone', id: c.ctx.id });
  else { const pc = clientById(room, p); if (pc) { pc.ctx.children.delete(c.ctx.id); send(pc, { type: 'rtc-gone', id: c.ctx.id }); } }
}
function pickParent(room, c) {
  let hostKids = 0;
  room.clients.forEach(x => { if (x.ctx.parent === 'host') hostKids++; });
  const audioOnly = !(room.live && room.live.screen);              // faqat ovoz (64 kbps): Transmitter ko'proq qurilmaga o'zi uzata oladi
  if (hostKids < (audioOnly ? 24 : HOST_FANOUT)) return 'host';
  let best = null, bs = 1e9;
  room.clients.forEach(x => {
    if (x === c || !x.ctx.canRelay || !x.ctx.streamReady || x.ctx.children.size >= RELAY_FANOUT || isDescendant(room, x, c)) return;
    const score = depthOf(room, x) * 10 + x.ctx.children.size - (x.ctx.stat ? x.ctx.stat.q : 0);   // sayoz, bo'sh va tarmog'i yaxshi relay afzal
    if (score < bs) { bs = score; best = x; }
  });
  if (best) return best.ctx.id;
  return hostKids < (audioOnly ? 36 : HOST_MAX) ? 'host' : null;
}
function resetTree(room) {
  room.clients.forEach(c => { c.ctx.parent = null; c.ctx.streamReady = false; c.ctx.children.clear(); });
}

function removeRoom(room, reason) {
  if (room.quiz) clearTimeout(room.quiz.timer);
  clearTimeout(room.memT); clearTimeout(room.reactT);
  mgClear(room); gmClear(room);
  if (room.waitT) clearInterval(room.waitT);
  broadcast(room, { type: 'closed', reason });
  everyone(room).forEach(w => { try { w.close(); } catch {} });
  if (room.pending) room.pending.forEach(w => { send(w, { type: 'closed', reason }); try { w.close(); } catch {} });
  rooms.delete(room.code);
  fs.rm(path.join(UPLOAD_DIR, room.code), { recursive: true, force: true }, () => {});
}

function dropItemFile(room, item) {
  if (item.external) return;
  fs.unlink(path.join(UPLOAD_DIR, room.code, path.basename(item.url)), () => {});
}

function selectItem(room, id, autoplay) {
  cancelWait(room);
  if (!room.items.some(i => i.id === id)) return;
  const s = room.state;
  const item = room.items.find(i => i.id === id);
  const play = !!autoplay && isMedia(item.kind);          // rasm/hujjatlar "chalinmaydi"
  s.currentId = id;
  s.position = 0;
  s.playing = play;
  s.playAt = play ? Date.now() + AUTOPLAY_LEAD : 0;
  room.clients.forEach(c => { if (c.ctx) c.ctx.ready = false; });
  broadcast(room, stateMsg(room));
  sendMembers(room);
}

// ---------------------------------------------------------------- REST

app.post('/api/rooms', express.json({ limit: '2kb' }), (req, res) => {
  const auth = centerAuth(req.body && req.body.ctoken);
  if (auth.role === 'student') return res.status(403).json({ error: 'Student xona yarata olmaydi — Transmitter faqat ustoz bo\'ladi' });   // student kodi bilan kirgan hech qachon Transmitter bo'la olmaydi
  if (rooms.size >= MAX_ROOMS) return res.status(503).json({ error: 'Server band, keyinroq urinib ko\'ring' });
  const name = cleanRoomName(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'Xonaga nom bering' });
  const room = newRoom(name, auth.id);
  if (!room) return res.status(503).json({ error: 'Kod yaratib bo\'lmadi' });
  res.json({ code: room.code, hostKey: room.hostKey, name: room.name });
});

// Receiverlar uchun xonalar ro'yxati (nomi bilan): faqat Transmitter onlayn va "ro'yxatda ko'rinsin" yoqilgan xonalar.
// Natija 1 soniya keshlanadi — yuzlab receiver ro'yxatni yangilab tursa ham server yengil qoladi.
const roomListCache = new Map();                              // markaz id (0 — standart) -> { t, json }
// 🌍 Global ko'rinish: xona ro'yxatda kimga ko'rinadi?
//  • oddiy xona (centerId = 0) — hammaga;
//  • markaz xonasi — odatiy holda faqat shu markaz kodini kiritganlarga; yoqilsa HAMMAGA ham (cfg.global = true bo'lsa: markaz kodini kiritmagan qurilmalarga ham ko'rinadi);
//    Transmitter "🌍 Global ko'rinish"ni o'chirsa, xona faqat shu markaz kodini kiritgan qurilmalarga ko'rinadi (imzolangan token ?ct= orqali).
// Ro'yxatda ko'rinmasa ham, 6 xonali kod bilan hamma kira oladi.
const roomVisibleTo = (r, cid) => !r.centerId || r.cfg.global === true || r.centerId === cid;
app.get('/api/rooms', (req, res) => {
  const now = Date.now();
  const cid = centerFromToken(typeof req.query.ct === 'string' ? req.query.ct.slice(0, 64) : '') || 0;
  let c = roomListCache.get(cid);
  if (!c || now - c.t > 1000) {
    const list = [];
    for (const r of rooms.values()) {
      if (!r.cfg.listed || !r.host) continue;
      if (!roomVisibleTo(r, cid)) continue;
      list.push({ code: r.code, name: r.name || 'Nomsiz xona', n: r.clients.size, locked: !!r.cfg.locked, phoneOnly: !!r.cfg.phoneOnly, approve: !!r.cfg.approve, live: !!(r.live && (r.live.mic || r.live.screen)), quiz: !!r.quiz, at: r.createdAt });
    }
    list.sort((a, b) => b.n - a.n || b.at - a.at);
    c = { t: now, json: JSON.stringify(list.slice(0, 200)) };
    if (roomListCache.size > 50) roomListCache.clear();
    roomListCache.set(cid, c);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/json').send(c.json);
});

// 🎓 Student kodi bilan kirganda: shu markaz ustozining hozir ochiq (Transmitter onlayn) xonasi/xonalari. Faqat to'g'ri markaz tokeni bilan (ustoz yoki student).
// Ustoz xonani ro'yxatdan yashirgan bo'lsa (cfg.listed = false) avtomatik kirishga berilmaydi — u faqat kod bilan kiriladi.
app.get('/api/center/room', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const a = centerAuth(typeof req.query.ct === 'string' ? req.query.ct.slice(0, 64) : '');
  if (!a.id) return res.status(401).json({ rooms: [] });
  const list = [];
  for (const r of rooms.values()) {
    if (r.centerId !== a.id || !r.host || !r.cfg.listed) continue;
    list.push({ code: r.code, name: r.name || 'Nomsiz xona', n: r.clients.size, locked: !!r.cfg.locked, approve: !!r.cfg.approve, quiz: !!r.quiz, at: r.createdAt });
  }
  list.sort((x, y) => y.at - x.at);
  res.json({ rooms: list.slice(0, 20) });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ exists: false });
  const key = req.query.key;
  res.json({ exists: true, isHost: !!key && key === room.hostKey, name: room.name || '' });
});

app.get('/api/info', (req, res) => {
  res.json({ lan: lanAddresses(), port: Number(PORT), maxMb: MAX_MB, ai: { gemini: !!AI_KEY, groq: !!GROQ_KEY }, aiFileMb: AI_FILE_MB });
});

app.get('/api/qr', async (req, res) => {
  try {
    const text = String(req.query.text || '').slice(0, 500);
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch { res.status(400).end(); }
});

// Viktorina rasmlari (savolga biriktirilgan): kichik, kesh qilinadigan, faqat rasm turlari
const QIMG_RE = /^q_[a-f0-9]{12}\.(jpg|png|webp)$/;
// ---- Google Drive: "Havolaga ega hamma ko'ra oladi" holatidagi fayllardan savollarni olish (faqat Google domenlari, hajm/vaqt chegarasi bilan)
const GDRIVE_KEY = process.env.GDRIVE_API_KEY || '';                       // ixtiyoriy: papka havolalari uchun (Google Drive API kaliti)
const G_HOSTS = new Set(['docs.google.com', 'drive.google.com', 'drive.usercontent.google.com']);
const DRIVE_MAX = 15 * 1024 * 1024;
function driveResolve(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !['docs.google.com', 'drive.google.com'].includes(u.hostname)) return null;
  const p = u.pathname; let m;
  if ((m = p.match(/^\/spreadsheets\/d\/([\w-]{10,})/))) {
    const gid = u.searchParams.get('gid') || ((u.hash.match(/gid=(\d+)/) || [])[1]);
    return gid && gid !== '0'
      ? { type: 'sheet', id: m[1], kind: 'csv', url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${encodeURIComponent(gid)}` }
      : { type: 'sheet', id: m[1], kind: 'xlsx', url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx` };      // xlsx: rasmlar ham olinadi
  }
  if ((m = p.match(/^\/document\/d\/([\w-]{10,})/))) return { type: 'doc', id: m[1], kind: 'docx', url: `https://docs.google.com/document/d/${m[1]}/export?format=docx` };
  if (/^\/presentation\//.test(p)) return { type: 'unsupported' };
  if ((m = p.match(/\/folders\/([\w-]{10,})/))) return { type: 'folder', id: m[1] };
  if ((m = p.match(/^\/file\/d\/([\w-]{10,})/)) || (m = [null, u.searchParams.get('id')]) && m[1] && /^[\w-]{10,}$/.test(m[1]) && /^\/(open|uc)$/.test(p))
    return { type: 'file', id: m[1], kind: '', url: `https://drive.google.com/uc?export=download&id=${m[1]}` };
  return null;
}
async function driveFetch(url, accept) {
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(cur);
    if (u.protocol !== 'https:' || !(accept || G_HOSTS).has(u.hostname)) throw new Error('Faqat Google Drive havolalari qabul qilinadi');
    const r = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; SyncCast)' } });
    if ([301, 302, 303, 307, 308].includes(r.status)) { cur = new URL(r.headers.get('location') || '', cur).href; continue; }
    if (r.status === 404) throw new Error('Fayl topilmadi (havolani tekshiring)');
    if (r.status === 401 || r.status === 403) throw new Error('Fayl yopiq: Drive\'da "Havolaga ega hamma ko\'ra oladi" qilib ulashing');
    if (!r.ok) throw new Error('Drive javobi: ' + r.status);
    const chunks = []; let size = 0;
    for await (const ch of r.body) { size += ch.length; if (size > DRIVE_MAX) throw new Error('Fayl juda katta (15 MB dan oshmasin)'); chunks.push(ch); }
    return { buf: Buffer.concat(chunks), ct: String(r.headers.get('content-type') || ''), cd: String(r.headers.get('content-disposition') || '') };
  }
  throw new Error('Havola juda ko\'p yo\'naltirildi');
}
function driveKind(buf, hint, name, ct) {
  if (buf[0] === 0x50 && buf[1] === 0x4b) { const t = buf.toString('latin1'); return t.includes('word/document.xml') ? 'docx' : t.includes('xl/workbook.xml') ? 'xlsx' : ''; }
  if (/^\s*<(!doctype|html)/i.test(buf.subarray(0, 300).toString('utf8'))) return '';        // kirish sahifasi: fayl yopiq
  if (hint) return hint;
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['csv', 'tsv', 'txt', 'md', 'json'].includes(ext)) return ext;
  return /json/.test(ct) ? 'json' : /csv/.test(ct) ? 'csv' : 'txt';
}
const driveGuard = (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room || req.query.key !== room.hostKey) { res.status(403).json({ error: 'Ruxsat yo\'q' }); return null; }
  const now = Date.now(), w = room.driveWin && now - room.driveWin.t < 600000 ? room.driveWin : (room.driveWin = { t: now, n: 0 });
  if (++w.n > 80) { res.status(429).json({ error: 'Juda ko\'p so\'rov — birozdan keyin urinib ko\'ring' }); return null; }
  return room;
};
app.post('/api/rooms/:code/drive', express.json({ limit: '10kb' }), async (req, res) => {
  if (!driveGuard(req, res)) return;
  const d = driveResolve(req.body && req.body.url);
  if (!d || d.type === 'unsupported') return res.status(400).json({ error: 'Bu Google Drive havolasi emas yoki turi qo\'llanmaydi (Sheets, Docs yoki fayl havolasini joylang)' });
  if (d.type === 'folder') return res.status(400).json({ error: 'Bu papka havolasi — papka ichidagi fayllar ro\'yxati so\'raladi', folder: true });
  try {
    const { buf, ct, cd } = await driveFetch(d.url);
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
    let name = 'Drive fayl'; try { name = decodeURIComponent((m && (m[1] || m[2])) || name); } catch {}
    const kind = driveKind(buf, d.kind, name, ct);
    if (!kind) return res.status(403).json({ error: 'Fayl yopiq yoki formati noma\'lum: Drive\'da "Havolaga ega hamma ko\'ra oladi" qilib ulashing (Word, Excel, CSV yoki Google Sheets/Docs)' });
    res.set({ 'X-Kind': kind, 'X-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }).send(buf);
  } catch (e) { res.status(502).json({ error: (e && e.name === 'TimeoutError') ? 'Drive javob bermadi (vaqt tugadi)' : (e && e.message) || 'Drive xatosi' }); }
});
app.post('/api/rooms/:code/drive-list', express.json({ limit: '10kb' }), async (req, res) => {
  if (!driveGuard(req, res)) return;
  const d = driveResolve(req.body && req.body.url);
  if (!d || d.type !== 'folder') return res.status(400).json({ error: 'Papka havolasi emas' });
  if (!GDRIVE_KEY) return res.status(501).json({ error: 'Papka havolasi uchun serverda GDRIVE_API_KEY (Google Drive API kaliti) kerak. Hozircha fayllar havolasini alohida-alohida joylang.' });
  try {
    const q = encodeURIComponent(`'${d.id}' in parents and trashed=false`);
    const { buf } = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name,mimeType)&key=${encodeURIComponent(GDRIVE_KEY)}`, new Set(['www.googleapis.com']));
    const list = (JSON.parse(buf.toString('utf8')).files || []).map(f => {
      const t = f.mimeType === 'application/vnd.google-apps.spreadsheet' ? `https://docs.google.com/spreadsheets/d/${f.id}`
        : f.mimeType === 'application/vnd.google-apps.document' ? `https://docs.google.com/document/d/${f.id}`
        : /\.(xlsx|docx|csv|txt|json)$/i.test(f.name) ? `https://drive.google.com/file/d/${f.id}/view` : '';
      return t ? { name: f.name, url: t } : null;
    }).filter(Boolean);
    res.json({ files: list });
  } catch (e) { res.status(502).json({ error: (e && e.message) || 'Papkani o\'qib bo\'lmadi (papka ochiq ekanini tekshiring)' }); }
});
// ---- Google Drive havolasi bilan fayl ulashish: receiverlar faylni to'g'ridan-to'g'ri Google'dan oladi (server yuklanmaydi, tez sinxronlanadi)
const driveDirectUrl = id => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
function driveParse(u) {
  if (!['docs.google.com', 'drive.google.com'].includes(u.hostname)) return null;
  const p = u.pathname; let m;
  if ((m = p.match(/^\/spreadsheets\/d\/([\w-]{10,})/))) return { type: 'export', url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`, name: 'Google Jadval.xlsx', kind: 'doc' };
  if ((m = p.match(/^\/document\/d\/([\w-]{10,})/))) return { type: 'export', url: `https://docs.google.com/document/d/${m[1]}/export?format=docx`, name: 'Google Hujjat.docx', kind: 'doc' };
  if ((m = p.match(/^\/presentation\/d\/([\w-]{10,})/))) return { type: 'export', url: `https://docs.google.com/presentation/d/${m[1]}/export/pptx`, name: 'Google Taqdimot.pptx', kind: 'doc' };
  if ((m = p.match(/\/folders\/([\w-]{10,})/))) return { type: 'folder', id: m[1] };
  if ((m = p.match(/^\/file\/d\/([\w-]{10,})/))) return { type: 'file', id: m[1] };
  const q = u.searchParams.get('id');
  if (q && /^[\w-]{10,}$/.test(q) && /^\/(open|uc)$/.test(p)) return { type: 'file', id: q };
  return null;
}
// Faylning nomi/hajmi/turi: faqat sarlavhalar o'qiladi (Range 0-0), tana yuklanmaydi
async function driveMeta(id) {
  let cur = driveDirectUrl(id);
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(cur);
    if (u.protocol !== 'https:' || !G_HOSTS.has(u.hostname)) throw new Error('Faqat Google Drive havolalari qabul qilinadi');
    const r = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { range: 'bytes=0-0', 'user-agent': 'Mozilla/5.0 (compatible; SyncCast)' } });
    if ([301, 302, 303, 307, 308].includes(r.status)) { cur = new URL(r.headers.get('location') || '', cur).href; continue; }
    if (r.status === 404) throw new Error('Fayl topilmadi (havolani tekshiring)');
    if (r.status === 401 || r.status === 403) throw new Error('Fayl yopiq: Drive\'da "Havolaga ega hamma ko\'ra oladi" qilib ulashing');
    if (!r.ok && r.status !== 206) throw new Error('Drive javobi: ' + r.status);
    const ct = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const cd = String(r.headers.get('content-disposition') || '');
    const cr = String(r.headers.get('content-range') || '');
    try { await r.body.cancel(); } catch {}
    if (ct === 'text/html' && !cd) throw new Error('Fayl yopiq: Drive\'da "Havolaga ega hamma ko\'ra oladi" qilib ulashing');
    const nm = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
    let name = 'Drive fayl'; try { name = decodeURIComponent((nm && (nm[1] || nm[2])) || name); } catch {}
    const size = Number((/\/(\d+)$/.exec(cr) || [])[1]) || Number(r.headers.get('content-length')) || 0;
    return { name, size, ct };
  }
  throw new Error('Havola juda ko\'p yo\'naltirildi');
}
// Drive'dan keladigan fayl turi. PDF/matn Drive'dan "attachment" bo'lib keladi, shuning uchun iframe'da emas, fayl kartasi + yuklab olish sifatida
function driveKindOf(name, ct) {
  let k = kindOf(path.extname(name).toLowerCase());
  if (!k) k = /^audio\//.test(ct) ? 'audio' : /^video\//.test(ct) ? 'video' : /^image\//.test(ct) ? 'image' : /zip|rar|7z|tar|gzip/.test(ct) ? 'archive' : 'doc';
  return k === 'pdf' || k === 'text' ? 'doc' : k;
}
async function driveAdd(room, ws, dp, m) {
  const now = Date.now(), w = room.driveWin && now - room.driveWin.t < 600000 ? room.driveWin : (room.driveWin = { t: now, n: 0 });
  if (++w.n > 80) return send(ws, { type: 'notice', message: 'Drive: juda ko\'p so\'rov — birozdan keyin urinib ko\'ring' });
  const mk = (name, kind, url, size) => ({ id: crypto.randomBytes(6).toString('hex'), name: safeName(name), cid: '', kind, url, size: size || 0, external: true, gainDb: null });
  const addItems = list => {
    if (!list.length || !rooms.has(room.code)) return;
    let first = false;
    for (const it of list) { room.items.push(it); if (!room.state.currentId) { room.state.currentId = it.id; first = true; } }
    broadcast(room, { type: 'items', items: room.items });
    if (first) broadcast(room, stateMsg(room));
  };
  try {
    if (dp.type === 'export') return addItems([mk(m.name || dp.name, dp.kind, dp.url, 0)]);
    if (dp.type === 'file') {
      send(ws, { type: 'notice', message: '☁️ Drive havolasi tekshirilmoqda…' });
      const meta = await driveMeta(dp.id);
      const name = m.name || meta.name;
      return addItems([mk(name, driveKindOf(name, meta.ct), driveDirectUrl(dp.id), meta.size)]);
    }
    if (dp.type === 'folder') {
      if (!GDRIVE_KEY) return send(ws, { type: 'notice', message: 'Drive papkasi uchun serverda GDRIVE_API_KEY kerak. Hozircha fayllar havolasini alohida joylang.' });
      send(ws, { type: 'notice', message: '☁️ Drive papkasi o\'qilmoqda…' });
      const q = encodeURIComponent(`'${dp.id}' in parents and trashed=false`);
      const { buf } = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=50&fields=files(id,name,mimeType,size)&key=${encodeURIComponent(GDRIVE_KEY)}`, new Set(['www.googleapis.com']));
      const list = [];
      for (const f of (JSON.parse(buf.toString('utf8')).files || [])) {
        const mt = f.mimeType || '';
        if (mt === 'application/vnd.google-apps.folder') continue;
        if (mt === 'application/vnd.google-apps.spreadsheet') list.push(mk(f.name + '.xlsx', 'doc', `https://docs.google.com/spreadsheets/d/${f.id}/export?format=xlsx`, 0));
        else if (mt === 'application/vnd.google-apps.document') list.push(mk(f.name + '.docx', 'doc', `https://docs.google.com/document/d/${f.id}/export?format=docx`, 0));
        else if (mt === 'application/vnd.google-apps.presentation') list.push(mk(f.name + '.pptx', 'doc', `https://docs.google.com/presentation/d/${f.id}/export/pptx`, 0));
        else if (!mt.startsWith('application/vnd.google-apps.')) list.push(mk(f.name, driveKindOf(f.name, mt), driveDirectUrl(f.id), Number(f.size) || 0));
      }
      if (!list.length) return send(ws, { type: 'notice', message: 'Papka bo\'sh yoki ochiq emas ("Havolaga ega hamma ko\'ra oladi")' });
      addItems(list);
      send(ws, { type: 'notice', message: `☁️ Drive papkasidan ${list.length} ta fayl qo'shildi` });
    }
  } catch (e) { send(ws, { type: 'notice', message: '☁️ ' + ((e && e.name === 'TimeoutError') ? 'Drive javob bermadi (vaqt tugadi)' : (e && e.message) || 'Drive xatosi') }); }
}
// 📎 Fayldan quiz: xom oqim (JPG/PNG/HEIC/PDF, AI_FILE_MB gacha). Fayl diskka yoziladi, turi mazmuniga qarab tekshiriladi.
app.post('/api/rooms/:code/ai-file', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room || req.query.key !== room.hostKey) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  if (!AI_KEY) return res.status(501).json({ error: 'Serverda GEMINI_API_KEY yo\'q: fayldan quiz tuzib bo\'lmaydi' });
  if (room.aiFileBusy) return res.status(409).json({ error: 'Oldingi fayl hali yuklanmoqda' });
  const len = Number(req.headers['content-length']) || 0;
  if (len > AI_FILE_BYTES) return res.status(413).json({ error: `Fayl ${AI_FILE_MB} MB dan katta` });
  try {
    const st = fs.statfsSync(UPLOAD_DIR);
    if (len && Number(st.bavail) * Number(st.bsize) < len + 256 * 1024 * 1024) return res.status(507).json({ error: 'Serverda diskda joy yetarli emas' });
  } catch {}
  const dir = path.join(UPLOAD_DIR, room.code);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ai_${crypto.randomBytes(6).toString('hex')}.bin`);
  const name = safeName(req.query.name) || 'fayl';
  let size = 0;
  const limiter = new Transform({ transform(chunk, _e, cb) { size += chunk.length; if (size > AI_FILE_BYTES) return cb(new Error('LIMIT')); cb(null, chunk); } });
  room.aiFileBusy = true;
  pipeline(req, limiter, fs.createWriteStream(file), err => {
    room.aiFileBusy = false;
    const fail = (code, msg) => { fs.unlink(file, () => {}); if (!res.headersSent) res.status(code).json({ error: msg }); };
    if (err) return fail(err.message === 'LIMIT' ? 413 : err.code === 'ENOSPC' ? 507 : 500, err.message === 'LIMIT' ? `Fayl ${AI_FILE_MB} MB dan katta` : err.code === 'ENOSPC' ? 'Serverda diskda joy qolmadi' : 'Yuklashda xato');
    if (!rooms.has(room.code)) return fail(410, 'Xona yopilgan');
    if (!size) return fail(400, 'Fayl bo\'sh');
    let mime = '';
    try { const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(1024); const k = fs.readSync(fd, head, 0, 1024, 0); fs.closeSync(fd); mime = sniffAiFile(head.subarray(0, k)); } catch {}
    if (!mime) return fail(415, 'Faqat JPG, PNG, HEIC yoki PDF fayl qabul qilinadi');
    dropAiFile(room);
    room.aiFile = { path: file, mime, name, size };
    res.json({ ok: true, name, size, mime });
    // javob ketdi: fonda faylni AI ga tayyorlaymiz va (sozlamalar so'rovda kelgan bo'lsa) savollarni oldindan tuzamiz
    const f = room.aiFile;
    aiFilePart(f).then(() => {
      if (room.aiFile !== f || room.quiz || !AI_WARM || aiActive >= AI_MAX_PARALLEL) return;
      const q = req.query || {};
      aiFilePre(room, aiParams({ topic: q.topic, lang: q.lang, level: q.level, count: q.count }));
    }).catch(e => console.error('[AI/file] oldindan tayyorlash:', e && e.message));
  });
});
app.delete('/api/rooms/:code/ai-file', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room || req.query.key !== room.hostKey) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  dropAiFile(room);
  res.json({ ok: true });
});
app.post('/api/rooms/:code/qimg', express.raw({ type: () => true, limit: '1.5mb' }), (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room || req.query.key !== room.hostKey) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim();
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[ct];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: 'Faqat JPG/PNG/WebP rasm' });
  const dir = path.join(UPLOAD_DIR, room.code);
  fs.mkdirSync(dir, { recursive: true });
  const name = `q_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFile(path.join(dir, name), req.body, err => {
    if (err) return res.status(500).json({ error: 'Saqlashda xato' });
    res.json({ url: `/qimg/${room.code}/${name}` });
  });
});
app.get('/qimg/:code/:file', (req, res) => {
  if (!rooms.has(req.params.code) || !QIMG_RE.test(req.params.file)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(UPLOAD_DIR, req.params.code, req.params.file), { dotfiles: 'deny' }, err => { if (err && !res.headersSent) res.status(404).end(); });
});

// Fayl yuklash: xom oqim (multipart emas) — tez va xotirani to'ldirmaydi
app.post('/api/rooms/:code/upload', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room || req.query.key !== room.hostKey) return res.status(403).json({ error: 'Ruxsat yo\'q' });

  const name = safeName(req.query.name);
  const ext = path.extname(name).toLowerCase();
  const kind = kindOfFile(ext);
  const cid = String(req.query.cid || '').replace(/[^a-z0-9]/gi, '').slice(0, 20);

  const len = Number(req.headers['content-length']) || 0;
  if (len > MAX_BYTES) return res.status(413).json({ error: `Fayl ${fmtLimit(MAX_MB)} dan katta` });
  try {                                                    // diskda joy yetarlimi (katta fayllar uchun)
    const st = fs.statfsSync(UPLOAD_DIR);
    const free = Number(st.bavail) * Number(st.bsize);
    if (len && free < len + 256 * 1024 * 1024) return res.status(507).json({ error: 'Serverda diskda joy yetarli emas' });
  } catch {}

  const id = crypto.randomBytes(6).toString('hex');
  const dir = path.join(UPLOAD_DIR, room.code);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + ext);

  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_BYTES) return cb(new Error('LIMIT'));
      cb(null, chunk);
    },
  });

  pipeline(req, limiter, fs.createWriteStream(file), err => {
    if (err) {
      fs.unlink(file, () => {});
      if (!res.headersSent) res.status(err.message === 'LIMIT' ? 413 : err.code === 'ENOSPC' ? 507 : 500).json({ error: err.message === 'LIMIT' ? `Fayl ${fmtLimit(MAX_MB)} dan katta` : err.code === 'ENOSPC' ? 'Serverda diskda joy qolmadi' : 'Yuklashda xato' });
      return;
    }
    if (!rooms.has(room.code)) { fs.unlink(file, () => {}); return res.status(410).end(); }
    const item = { id, cid, name, kind, url: `/files/${room.code}/${id}${ext}`, size, external: false, gainDb: null };
    room.items.push(item);
    let first = false;
    if (!room.state.currentId) { room.state.currentId = id; first = true; }
    broadcast(room, { type: 'items', items: room.items });
    if (first) broadcast(room, stateMsg(room));        // keraksiz state yuborilmaydi: pleyerga tegmaslik uchun
    res.json(item);
  });
});

// ---------------------------------------------------------------- Mini o'yinlar (⚡ Tez bos · 👆 Tap-poyga · 🔢 Raqamni top)
// Hammasini SERVER boshqaradi: vaqt, natija va g'olib serverda hisoblanadi (aldab bo'lmaydi), hamma qurilmaga bir xil yuboriladi.
const MG_GAMES = new Set(['rx', 'tap', 'gs']);
const mgSend = room => { if (room.mg) broadcast(room, { type: 'mg', ...room.mg.s }); };
function mgClear(room) {
  const g = room.mg; if (!g) return;
  g.timers.forEach(clearTimeout); clearInterval(g.iv); room.mg = null;
}
function mgStart(room, ws, m) {
  const game = String(m.game);
  if (!MG_GAMES.has(game)) return;
  if (room.mg && room.mg.s.phase !== 'result') return send(ws, { type: 'notice', message: '🎮 Avvalgi o\'yin hali tugamadi' });
  if (!room.clients.size) return send(ws, { type: 'notice', message: '🎮 O\'yin uchun kamida 1 ta receiver kerak' });
  if (gmBusy(room)) return send(ws, { type: 'notice', message: '🎮 Avvalgi o\'yin hali tugamadi' });
  if (room.gm) { const gid = room.gm.s.id; gmClear(room); broadcast(room, { type: 'gm', id: gid, close: true }); }
  mgClear(room);
  const pick = (v, arr, d) => (arr.includes(+v) ? +v : d);
  const now = Date.now();
  const g = room.mg = { game, res: new Map(), timers: [], iv: null, s: { id: crypto.randomBytes(4).toString('hex'), game, phase: 'ready', total: room.clients.size, answered: 0 } };
  const later = (ms, fn) => g.timers.push(setTimeout(() => { if (room.mg === g) fn(); }, ms));
  if (game === 'rx') {                                          // ⚡ ekran yashil bo'lganda eng tez bosgan yutadi; erta bosgan chiqadi
    g.s.phase = 'wait';
    later(3500 + crypto.randomInt(0, 4500), () => {
      g.goT = Date.now(); g.s.phase = 'go'; mgSend(room);
      later(7000, () => mgFinish(room, g));
    });
  } else {
    const dur = pick(m.dur, [10, 15, 20, 30], 15);
    g.s.dur = dur; g.s.startAt = now + (game === 'tap' ? 3500 : 1500); g.s.endAt = g.s.startAt + dur * 1000;
    if (game === 'gs') { g.s.max = pick(m.max, [10, 50, 100, 1000], 100); g.secret = crypto.randomInt(1, g.s.max + 1); }
    later(g.s.startAt - now, () => {
      g.s.phase = 'play'; mgSend(room);
      g.iv = setInterval(() => {
        if (room.mg !== g || g.s.phase !== 'play') return clearInterval(g.iv);
        g.s.answered = g.res.size;
        if (game === 'tap') g.s.top = [...g.res.values()].sort((a, b) => b.v - a.v).slice(0, 5).map(r => ({ i: r.id, n: r.n, a: r.a, v: r.v }));
        mgSend(room);
      }, game === 'tap' ? 500 : 1000);
    });
    later(g.s.endAt - now + 400, () => mgFinish(room, g));
  }
  mgSend(room);
}
function mgAct(room, ws, m) {
  const g = room.mg, ctx = ws.ctx;
  if (!g || !ctx || !ctx.tok || g.s.phase === 'result') return;
  const now = Date.now(), r = g.res.get(ctx.tok), base = { id: ctx.id, n: ctx.name, a: ctx.av || '' };
  const inWin = now >= g.s.startAt - 80 && now <= g.s.endAt + 300;
  if (g.game === 'rx') {
    if (r) return;
    if (g.s.phase === 'wait') { g.res.set(ctx.tok, { ...base, foul: true }); send(ws, { type: 'mg-me', id: g.s.id, foul: true }); }
    else if (g.s.phase === 'go') {                              // ping'ning yarmi hisobga olinadi (sekin tarmoq adolatsiz bo'lmasin)
      const ms = Math.max(1, Math.round(now - g.goT - Math.min(150, ((ctx.stat && ctx.stat.rtt) || 0) / 2)));
      g.res.set(ctx.tok, { ...base, v: ms }); send(ws, { type: 'mg-me', id: g.s.id, v: ms });
      if (!g.finT) { g.finT = setTimeout(() => { if (room.mg === g) mgFinish(room, g); }, 2500); g.timers.push(g.finT); }
    } else return;
    if (g.res.size >= room.clients.size) mgFinish(room, g);
  } else if (g.game === 'tap') {                                // soniyasiga ~16 tadan ortig'i hisoblanmaydi (avto-klikerga qarshi)
    if (g.s.phase !== 'play' || !inWin) return;
    const n = clampN(Math.floor(+m.n) || 0, 0, 8), cur = r ? r.v : 0;
    const allowed = 16 * (Math.min(now, g.s.endAt) - g.s.startAt) / 1000 + 10;
    const add = Math.min(n, Math.max(0, Math.floor(allowed - cur)));
    if (add > 0) g.res.set(ctx.tok, { ...base, v: cur + add });
  } else if (g.game === 'gs') {
    if (g.s.phase !== 'play' || !inWin) return;
    const v = Math.round(+m.v);
    if (!Number.isFinite(v) || v < 1 || v > g.s.max) return;
    g.res.set(ctx.tok, { ...base, v, t: now });
  }
}
function mgFinish(room, g) {
  if (room.mg !== g || g.s.phase === 'result') return;
  g.timers.forEach(clearTimeout); g.timers = []; clearInterval(g.iv);
  const all = [...g.res.values()];
  let ranked;
  if (g.game === 'rx') { ranked = all.filter(r => !r.foul).sort((a, b) => a.v - b.v); g.s.fouls = all.length - ranked.length; }
  else if (g.game === 'tap') ranked = all.sort((a, b) => b.v - a.v);
  else { ranked = all.map(r => ({ ...r, d: Math.abs(r.v - g.secret) })).sort((a, b) => a.d - b.d || a.t - b.t); g.s.secret = g.secret; }
  g.s.phase = 'result'; g.s.total = room.clients.size; g.s.answered = all.length; g.s.played = ranked.length;
  g.s.top = ranked.slice(0, 8).map(r => ({ i: r.id, n: r.n, a: r.a, v: r.v, d: r.d }));
  mgSend(room);
  const byId = new Map(ranked.map((r, i) => [r.id, { ...r, rank: i + 1 }]));
  room.clients.forEach(c => {                                   // har bir o'yinchiga o'z o'rni
    if (!c.ctx) return;
    const raw = g.res.get(c.ctx.tok), r = byId.get(c.ctx.id);
    send(c, { type: 'mg-me', id: g.s.id, final: true, rank: r ? r.rank : 0, v: raw ? raw.v : null, d: r ? r.d : null, foul: !!(raw && raw.foul), none: !raw, played: ranked.length, total: room.clients.size });
  });
}

// ---------------------------------------------------------------- 🔼 Kichik-katta
// Hamma narsa SERVER'da: kim qidiruvchi / son egasi, vaqtlar, topilganlar, yashirin son. Har bir qurilmaga o'ziga mos holat ("me") yuboriladi:
// yashirin son faqat son egasiga boradi. Transmitter ham ishtirok eta oladi (hostIn) yoki qidiruvchi / son egasi bo'ladi.
const GM_GAMES = new Set(['hl']);
const gmBusy = room => !!(room.gm && room.gm.s.phase !== 'result');
function gmClear(room) {
  const g = room.gm; if (!g) return;
  g.timers.forEach(clearTimeout); clearTimeout(g.pushT); room.gm = null;
}
function gmBase(room, g) {
  const ctxs = new Map(); everyone(room).forEach(w => { if (w.ctx) ctxs.set(w.ctx.tok, w.ctx); });
  const who = tok => { const c = ctxs.get(tok); return c ? { n: c.name, a: c.av || '' } : null; };
  g.chosenInfo = who(g.chosen) || g.chosenInfo;
  const ps = [...g.players.values()];
  const base = { type: 'gm', ...g.s, chosen: g.chosenInfo };
  return base;
}
function gmFor(g, base, ws) {
  const tok = ws.ctx.tok, p = g.players.get(tok), isChosen = tok === g.chosen;
  const me = { role: isChosen ? 'keeper' : p ? 'player' : 'watch', pid: p ? p.pid : null };
  const msg = { ...base, me };
  if (isChosen && g.secret) me.secret = g.secret;
  return msg;
}
function gmPush(room) {
  const g = room.gm; if (!g) return;
  clearTimeout(g.pushT); g.pushT = null;
  const base = gmBase(room, g);
  for (const w of everyone(room)) if (w.ctx && w.ctx.tok && w.bufferedAmount < 2 * 1024 * 1024) send(w, gmFor(g, base, w));
}
const gmSoon = room => { const g = room.gm; if (g && !g.pushT) g.pushT = setTimeout(() => { if (room.gm === g) gmPush(room); }, 150); };   // tez-tez o'zgarishlar yig'ilib yuboriladi
function gmSendTo(room, ws) {
  const g = room.gm; if (!g || !ws.ctx || !ws.ctx.tok) return;
  // Kichik·Katta: o'yin davomida kirgan receiver ham taxmin qila oladi (o'yin tugamagan bo'lsa)
  if (g.game === 'hl' && g.s.phase !== 'result' && ws.ctx.role === 'receiver' && ws.ctx.tok !== g.chosen && !g.players.has(ws.ctx.tok)) {
    g.players.set(ws.ctx.tok, { tok: ws.ctx.tok, pid: crypto.randomBytes(3).toString('hex'), n: ws.ctx.name, a: ws.ctx.av || '', found: false, t: 0, tries: 0, lastAt: 0 });
    g.s.total = g.players.size;
    return gmPush(room);
  }
  send(ws, gmFor(g, gmBase(room, g), ws));
}

function gmStart(room, ws, m) {
  const game = String(m.game);
  if (!GM_GAMES.has(game)) return;
  if (gmBusy(room) || (room.mg && room.mg.s.phase !== 'result')) return send(ws, { type: 'notice', message: "🎮 Avvalgi o'yin hali tugamadi" });
  if (room.mg) { const id = room.mg.s.id; mgClear(room); broadcast(room, { type: 'mg', id, close: true }); }
  const recv = [...room.clients].filter(c => c.ctx && c.ctx.tok);
  const hostIn = !!m.hostIn && !!room.host;
  const pool = hostIn ? [...recv, room.host] : recv;
  const who = ['host', 'pick', 'random'].includes(m.who) ? m.who : 'random';
  let chosen;
  if (who === 'host') { if (!room.host) return; chosen = room.host; }
  else if (who === 'pick') {
    chosen = recv.find(c => c.ctx.id === String(m.pick));
    if (!chosen) return send(ws, { type: 'notice', message: "🎮 Tanlangan receiver topilmadi — ro'yxatni yangilang" });
  } else {
    if (!pool.length) return send(ws, { type: 'notice', message: "🎮 O'yin uchun kamida 1 ta receiver kerak" });
    chosen = pool[crypto.randomInt(0, pool.length)];
  }
  const players = pool.filter(c => c !== chosen);                    // qidiruvchi / son egasi o'yinchilar ro'yxatiga kirmaydi
  if (!players.length) return send(ws, { type: 'notice', message: '🔼 Kamida 1 ta taxmin qiluvchi kerak' });
  gmClear(room);
  const pick = (v, arr, d) => (arr.includes(+v) ? +v : d);
  const id = crypto.randomBytes(4).toString('hex'), now = Date.now();
  const g = room.gm = { game, id, chosen: chosen.ctx.tok, chosenInfo: null, timers: [], pushT: null, players: new Map(), secret: 0, listPub: null, s: { id, game, phase: 'pick', who, total: players.length } };
  g.later = (ms, fn) => g.timers.push(setTimeout(() => { if (room.gm === g) fn(); }, ms));
  players.forEach(c => g.players.set(c.ctx.tok, { tok: c.ctx.tok, pid: crypto.randomBytes(3).toString('hex'), n: c.ctx.name, a: c.ctx.av || '', found: false, t: 0, tries: 0, lastAt: 0 }));
  {                                                                  // son egasi son yozadi → hamma taxmin qiladi
    const max = pick(m.max, [10, 50, 100, 1000], 100), dur = pick(m.dur, [0, 60, 120, 180, 300], 120);
    Object.assign(g.s, { phase: 'pick', max, dur, lo: 1, hi: max, tries: 0, feed: [], startAt: 0, endAt: 0, pickEnd: now + 90000 });
    g.later(90000, () => { if (g.s.phase === 'pick') hlPlay(room, g, crypto.randomInt(1, max + 1)); });   // son egasi yozmasa — tasodifiy son
  }
  gmPush(room);
}
function hlPlay(room, g, v) {
  if (room.gm !== g || g.s.phase !== 'pick') return;
  const s = g.s, now = Date.now();
  g.secret = v; s.phase = 'play'; s.startAt = now + 1200; s.endAt = s.dur ? s.startAt + s.dur * 1000 : 0;
  if (s.dur) g.later(s.endAt - now + 300, () => hlFinish(room, g, null));
  gmPush(room);
}
function hlFinish(room, g, winP) {
  if (room.gm !== g || g.s.phase === 'result') return;
  g.timers.forEach(clearTimeout); g.timers = [];
  const s = g.s;
  s.phase = 'result'; s.secret = g.secret; s.elapsed = Date.now() - s.startAt;
  s.winner = winP ? { id: winP.pid, n: winP.n, a: winP.a, tries: winP.tries } : null;
  gmPush(room);
}
function gmAct(room, ws, m) {
  const g = room.gm, ctx = ws.ctx;
  if (!g || !ctx || !ctx.tok) return;
  const s = g.s, p = g.players.get(ctx.tok), now = Date.now(), isChosen = ctx.tok === g.chosen, a = String(m.a);
  if (a === 'secret' && isChosen && s.phase === 'pick') {
    const v = Math.round(+m.v);
    if (Number.isFinite(v) && v >= 1 && v <= s.max) hlPlay(room, g, v);
    return;
  }
  if (a === 'guess' && p && s.phase === 'play' && now >= s.startAt - 80 && (!s.endAt || now <= s.endAt + 300)) {
    const v = Math.round(+m.v);
    if (!Number.isFinite(v) || v < 1 || v > s.max || now - p.lastAt < 450) return;
    p.lastAt = now; p.tries++; s.tries++;
    const d = v === g.secret ? 'hit' : v < g.secret ? 'up' : 'down';                     // up: son bundan KATTA, down: son bundan KICHIK
    send(ws, { type: 'gm-r', id: s.id, v, d });
    s.feed.unshift({ n: ctx.name, a: ctx.av || '', v, d }); if (s.feed.length > 14) s.feed.length = 14;
    if (d === 'hit') return hlFinish(room, g, p);
    if (d === 'up') s.lo = Math.max(s.lo, v + 1); else s.hi = Math.min(s.hi, v - 1);
    gmSoon(room);
  }
}

// ---------------------------------------------------------------- WebSocket

const server = http.createServer(app);
// Katta (GB) fayllar sekin tarmoqda bir necha daqiqa yuklanadi: standart 5 daqiqalik so'rov taymauti o'chiriladi
server.requestTimeout = 0;
server.headersTimeout = 65 * 1000;
server.keepAliveTimeout = 75 * 1000;
server.timeout = 0;
// Tarmoq tezligi: Nagle o'chiriladi (kichik xabarlar — ping, state, play — kechikmasdan ketadi), WebSocket siqishi o'chiq
// (kichik xabarni siqish CPU'ni yeb, hammaga kechikish qo'shadi — ayniqsa 100+ qurilmada), ulanishlar navbati kengaytirilgan.
server.on('connection', sock => { try { sock.setNoDelay(true); sock.setKeepAlive(true, 20000); } catch {} });
const CLS = require('./classroom3d').init({send,broadcast});
const ATT = require('./attendance');                       // 📋 Davomat moduli
ATT.init({ send, sendAll, rename(room, ws, nm) {              // yuz orqali aniqlangan ism: receiver nomi hamma joyda yangilanadi
  if (room.quiz) { const p = room.quiz.players.get(ws.ctx.tok); if (p) p.name = nm; room.quizDirty = true; }
  (room.faceNames || (room.faceNames = new Map())).set(ws.ctx.tok, nm);
  send(ws, { type: 'nick', name: nm }); sendMembers(room);
} });
ATT.routes(app, express, rooms);

const wss = new WebSocketServer({ server, maxPayload: 128 * 1024, perMessageDeflate: false });
wss.on('error', e => console.error('[wss]', e && e.message));

wss.on('connection', (ws, req) => {
  ws.ua = String((req && req.headers && req.headers['user-agent']) || '').slice(0, 300);
  ws.ctx = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => { try { ws.terminate(); } catch {} });          // buzuq freym/uzilish serverni yiqitmasin

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;

    if (m.type === 'ping') return send(ws, { type: 'pong', t0: m.t0, serverNow: Date.now() });

    if (m.type === 'join') return onJoin(ws, m);

    const ctx = ws.ctx;
    if (!ctx) return;
    const room = ctx.room;
    room.lastSeen = Date.now();
    if (m.type.charCodeAt(0) === 97 && m.type.startsWith('att-')) return ATT.handle(room, ws, ctx, m);   // davomat

    if (m.type === 'bye') { if (ctx.role === 'receiver' && room.roster && ctx.tok) room.roster.delete(ctx.tok); return; }   // receiver o'zi chiqdi: oflayn bo'lib qolmaydi
    if (m.type === 'members-sync') { if (ctx.role === 'host') flushMembers(room); return; }   // Transmitter ro'yxatni darhol so'raydi (xabar yo'qolsa ham receiverlar ko'rinadi)

    if (m.type === 'ready') {
      if (ctx.role === 'receiver' && m.id === room.state.currentId) { ctx.ready = m.ok !== false; sendMembers(room); }
      return;
    }

    if (m.type === 'stat' && ctx.role === 'receiver') {            // receiver tarmoq/sinxron holati (host ro'yxati va adaptiv kechikish uchun)
      const n = v => (Number.isFinite(+v) ? +v : 0);
      ctx.stat = { rtt: clampN(n(m.rtt), 0, 5000), jitter: clampN(n(m.jitter), 0, 5000), q: clampN(Math.round(n(m.q)), 0, 4), drift: clampN(n(m.drift), -60000, 60000), buf: clampN(n(m.buf), 0, 3600), loss: clampN(n(m.loss), 0, 100) };
      room.dirty = true;
      return;
    }

    // Jonli efir (WebRTC): server faqat daraxtni quradi va signallarni uzatadi
    if (m.type === 'rtc-want' && ctx.role === 'receiver') {
      detach(room, ws);
      const pid = pickParent(room, ws);
      const parentWs = pid === 'host' ? room.host : pid ? clientById(room, pid) : null;
      if (!parentWs) return send(ws, { type: 'rtc-wait' });
      ctx.parent = pid;
      if (pid !== 'host') parentWs.ctx.children.add(ctx.id);
      send(ws, { type: 'rtc-parent', id: pid, depth: depthOf(room, ws) });
      send(parentWs, { type: 'rtc-want', from: ctx.id });
      return;
    }
    if (m.type === 'rtc-ready' && ctx.role === 'receiver') { ctx.streamReady = !!m.ok; return; }
    if (m.type === 'rtc-signal') {
      const from = ctx.role === 'host' ? 'host' : ctx.id;
      const target = m.to === 'host' ? room.host : clientById(room, String(m.to));
      if (target) send(target, { type: 'rtc-signal', from, data: m.data });
      return;
    }
    if (m.type.startsWith('cls-')) return void CLS.on(room, ws, m);
    if (m.type === 'chat') {                                      // umumiy chat: ism + matn, hamma ko'radi (viktorina paytida ham)
      const now = Date.now();
      const text = String(m.text == null ? '' : m.text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, 300);
      if (!text || now - (ctx.lastChat || 0) < 600) return;
      if (ctx.role !== 'host') {
        if (!room.cfg.allowChat) return send(ws, { type: 'chat-denied', reason: 'off' });
        const qph = room.quiz && room.quiz.phase;
        if ((qph === 'question' || qph === 'reveal') && !room.cfg.allowChatQuiz) return send(ws, { type: 'chat-denied', reason: 'quiz' });
      }
      ctx.lastChat = now;
      const msg = { type: 'chat', id: crypto.randomBytes(4).toString('hex'), from: ctx.id, name: ctx.name, av: ctx.av, host: ctx.role === 'host', text, t: now };
      room.chat = room.chat || [];
      room.chat.push({ id: msg.id, from: msg.from, name: msg.name, av: msg.av, host: msg.host, text: msg.text, t: msg.t });
      if (room.chat.length > 60) room.chat.splice(0, room.chat.length - 60);
      broadcast(room, msg);
      return;
    }
    if (m.type === 'mg-act' && ctx.role === 'receiver') return mgAct(room, ws, m);
    if (m.type === 'gm-act') return gmAct(room, ws, m);
    if (m.type === 'react' && ctx.role === 'receiver') {          // reaksiyalar yig'ilib, 0.6 s da bir marta yuboriladi
      const now = Date.now();
      if (!room.cfg.allowReact || !REACTS.includes(m.e) || now - (ctx.lastReact || 0) < 250) return;
      ctx.lastReact = now;
      room.reacts = room.reacts || {};
      room.reacts[m.e] = (room.reacts[m.e] || 0) + 1;
      if (!room.reactT) room.reactT = setTimeout(() => { const counts = room.reacts; room.reacts = {}; room.reactT = null; broadcast(room, { type: 'react', counts }); }, 600);
      return;
    }
    if (m.type === 'quiz-answer' && (ctx.role === 'receiver' || (ctx.role === 'host' && room.quiz && room.quiz.hostPlay))) {
      const qz = room.quiz;
      if (!qz || qz.phase !== 'question') return;
      const now = Date.now(), q = qz.questions[qz.idx], T = q.type || 'choice';
      if (now < qz.startAt - 250 || now > qz.endAt + 1500 || qz.answers.has(ctx.tok)) return;
      const nOpt = q.opts.length;
      let ok = false, prec = 1, ans;                                            // ans: javobning saqlanadigan ko'rinishi
      if (T === 'multi' || (T === 'poll' && q.multi)) {
        const sel = [...new Set((Array.isArray(m.sel) ? m.sel : []).map(Number))].filter(k => Number.isInteger(k) && k >= 0 && k < nOpt).sort((x, y) => x - y);
        if (!sel.length) return;
        ok = T === 'multi' && sel.length === q.corrects.length && sel.every((k, n) => k === q.corrects[n]);
        ans = { i: sel[0], sel, my: sel };
      } else if (T === 'text') {
        const txt = String(m.text == null ? '' : m.text).slice(0, 40), nt = normTxt(txt);
        if (!nt) return;
        ok = q.accepts.some(x => normTxt(x) === nt);
        ans = { i: 0, txt, my: txt };
      } else if (T === 'slider') {
        const v = Number(m.v);
        if (!Number.isFinite(v)) return;
        const val = clampN(v, q.min, q.max), diff = Math.abs(val - q.target);
        ok = diff <= q.margin + 1e-9;
        prec = ok ? (q.margin > 0 ? 1 - 0.5 * diff / q.margin : 1) : 0;         // aniqlik: to'g'ri son = 1, chegarada = 0.5
        ans = { i: 0, v: val, my: val };
      } else if (T === 'order') {
        const ord = Array.isArray(m.ord) ? m.ord.map(Number) : [];
        if (ord.length !== nOpt || new Set(ord).size !== nOpt || !ord.every(k => Number.isInteger(k) && k >= 0 && k < nOpt)) return;
        ok = ord.every((d, k) => q.shuf[d] === k);
        ans = { i: 0, my: ord };
      } else {                                                                  // choice / tf / poll (bitta variant)
        const i = Number(m.i);
        if (!Number.isInteger(i) || i < 0 || i >= nOpt) return;
        ok = T !== 'poll' && i === q.correct;
        ans = { i, sel: [i], my: i };
      }
      const p = quizPlayer(room, ws);
      if (p.dq) return;                                                         // diskvalifikatsiya qilingan: javob hisoblanmaydi
      const el = clampN(now - qz.startAt, 0, q.time * 1000);
      const scored = T !== 'poll';
      let delta = 0;
      if (scored && ok) {
        p.streak++; p.right = (p.right || 0) + 1;                            // to'g'ri javoblar soni (uyga vazifa natijasi uchun)
        if (qz.kahoot === false) {                                            // soni bo'yicha: har to'g'ri javob = 1 ball (2x savol = 2), tezlik hisobga olinmaydi
          delta = q.pts === 'double' ? 2 : q.pts === 'none' ? 0 : 1;
          p.t = (p.t || 0) + el;                                              // ball teng bo'lsa, jami vaqti kam bo'lgan oldinda
        } else {
          const base = q.pts === 'double' ? 2000 : q.pts === 'none' ? 0 : 1000, sp = 1 - (el / (q.time * 1000)) / 2;
          delta = Math.round(T === 'slider' ? base * (0.8 * prec + 0.2 * (1 - el / (q.time * 1000))) : base * sp);   // tezroq javob = ko'proq ball (Kahoot formulasi); slayder: 80% aniqlik + 20% tezlik
          if (base > 0 && p.streak >= 2) delta += Math.min(5, p.streak - 1) * 100;   // ketma-ket to'g'ri javob bonusi
        }
      } else if (scored) p.streak = 0;
      p.score += delta; p.last = { ok: scored && ok, delta, i: ans.i, answered: true };
      qz.answers.set(ctx.tok, { ...ans, el, ok: scored && ok });
      const i = ans.my;
      send(ws, { type: 'quiz-ack', i });
      room.quizDirty = true;
      quizCheckEarly(room);
      return;
    }
    if (m.type === 'quiz-strike' && ctx.role === 'receiver') {              // qat'iy rejim: receiver qoidabuzarlik haqida xabar beradi
      const qz = room.quiz;
      if (!qz || qz.strict === false || !['question', 'reveal'].includes(qz.phase)) return;
      const p = quizPlayer(room, ws), now = Date.now();
      if (p.dq || now - (p.strikeAt || 0) < 1500) return;
      const why = ({ 'fs-exit': 'to\'liq ekrandan chiqdi', 'tab-hidden': 'boshqa oynaga/ilovaga o\'tdi', 'blur': 'oynadan chiqdi', 'screenshot': 'skrinshot urinishi', 'devtools': 'DevTools ochdi', 'print': 'chop etish urinishi' })[String(m.why)] || 'qoidabuzarlik';
      p.strikeAt = now; p.strikes = (p.strikes || 0) + 1; p.why = why;
      const lim = qz.strikeLimit == null ? 2 : qz.strikeLimit;
      if (lim && p.strikes >= lim) p.dq = true;
      send(ws, { type: 'quiz-me', me: { score: p.score, streak: p.streak, answered: !!(p.last && p.last.answered), ok: !!(p.last && p.last.ok), delta: p.last ? p.last.delta : 0, rank: 0, n: qz.players.size, strikes: p.strikes, dq: !!p.dq, limit: lim, ...hwMeExtra(qz, p) } });
      if (room.host) send(room.host, { type: 'notice', message: `⚠ ${p.name}: ${why} (${p.strikes}${lim ? '/' + lim : ''})${p.dq ? ' — diskvalifikatsiya' : ''}` });
      room.quizDirty = true; broadcastQuiz(room); quizSendMe(room);
      return;
    }
    if (m.type === 'quiz-avatar' && ctx.role === 'receiver') {
      if (!AVATARS.includes(m.av)) return;
      if (room.quiz && room.quiz.stickers !== false && !STK.list(room.quiz.stickerPack).includes(m.av)) return;   // transmitter tanlagan to'plamdan tashqari belgi qabul qilinmaydi
      ctx.av = m.av;
      if (room.quiz) { const p = room.quiz.players.get(ctx.tok); if (p) p.av = m.av; }
      sendMembers(room);
      return;
    }
    if (m.type === 'quiz-nick' && ctx.role === 'receiver') {
      const nm = String(m.name || '').trim().slice(0, 24);
      if (!nm) return;
      ctx.name = nm;
      if (room.faceNames && room.faceNames.has(ctx.tok)) room.faceNames.set(ctx.tok, nm);   // qayta ulanganda eski (yuz) ismi qaytib kelmasin
      if (room.quiz) { const p = room.quiz.players.get(ctx.tok); if (p) p.name = nm; room.quizDirty = true; }
      sendMembers(room);
      return;
    }
    if (m.type === 'vote' && ctx.role === 'receiver') {
      const p = room.poll, i = Number(m.i);
      if (!p || !p.open || p.voted.has(ctx.tok) || !Number.isInteger(i) || i < 0 || i >= p.opts.length) return;
      p.voted.set(ctx.tok, i); p.votes[i]++; room.pollDirty = true;
      send(ws, { type: 'voted', id: p.id, i });
      return;
    }

    if (ctx.role !== 'host') return;                     // pastdagilar faqat Transmitter uchun
    const s = room.state;

    switch (m.type) {
      case 'select':
        selectItem(room, String(m.id), !!m.autoplay);
        break;
      case 'play': {
        const cur = room.items.find(i => i.id === s.currentId);
        if (!cur || !isMedia(cur.kind) || room.waitT) break;
        const notReady = () => { let n = 0; room.clients.forEach(c => { if (c.ctx && !c.ctx.ready) n++; }); return n; };
        const allowed = room.clients.size < 10 ? 0 : Math.floor(room.clients.size * 0.1);   // 100+ odamda 10% sekinlari kutilmaydi
        const go = () => {
          cancelWait(room);
          s.position = s.playing ? expectedPos(room) : s.position;
          s.playing = true;
          s.playAt = Date.now() + leadMs(room);
          broadcast(room, stateMsg(room));
        };
        if (s.playing || !room.cfg.waitAll || notReady() <= allowed) return go();
        const t0 = Date.now();
        broadcast(room, { type: 'waiting', n: notReady() });
        room.waitT = setInterval(() => {
          const n = notReady();
          if ((n <= allowed && Date.now() - t0 > 700) || Date.now() - t0 > 5000) go();
          else broadcast(room, { type: 'waiting', n });
        }, 250);
        break;
      }
      case 'pause':
        cancelWait(room);
        if (s.playing) s.position = expectedPos(room);
        s.playing = false;
        broadcast(room, stateMsg(room));
        break;
      case 'seek': {
        const p = Math.max(0, Number(m.position) || 0);
        s.position = p;
        if (s.playing) s.playAt = Date.now() + Math.round(leadMs(room) / 2);
        broadcast(room, stateMsg(room));
        break;
      }
      case 'settings':
        s.autoNext = !!m.autoNext;
        broadcast(room, stateMsg(room));
        break;
      case 'cfg':
        applyCfg(room, m.patch);
        broadcast(room, { type: 'cfg', cfg: room.cfg });
        CLS.sync(room);
        break;
      case 'room-name': {                              // Transmitter xona nomini o'zgartiradi
        const nm = cleanRoomName(m.name);
        if (!nm) { send(ws, { type: 'notice', message: 'Xona nomi bo\'sh bo\'lmasin' }); send(ws, { type: 'room-name', name: room.name }); break; }
        room.name = nm;
        broadcast(room, { type: 'room-name', name: room.name });
        break;
      }
      case 'norm': {                                  // Transmitter o'lchagan balandlik tuzatmasi: hamma qurilmaga bir xil
        const it = room.items.find(i => i.id === m.id);
        const g = Number(m.gainDb);
        if (!it || !Number.isFinite(g)) break;
        it.gainDb = Math.max(-24, Math.min(24, Math.round(g * 10) / 10));
        broadcast(room, { type: 'items', items: room.items });
        break;
      }
      case 'stop':
        cancelWait(room);
        s.playing = false; s.position = 0; s.playAt = 0;
        broadcast(room, stateMsg(room));
        break;
      case 'next':
      case 'prev': {
        const idx = room.items.findIndex(i => i.id === s.currentId);
        let target = null;
        if (m.type === 'next') target = room.items[idx + 1] || (room.cfg.loop === 'all' ? room.items[0] : null);
        else target = idx > 0 ? room.items[idx - 1] : room.items[idx];
        if (target) selectItem(room, target.id, true);
        break;
      }
      case 'ended': {
        if (m.id !== s.currentId) break;
        const idx = room.items.findIndex(i => i.id === s.currentId);
        const next = room.items[idx + 1];
        if (room.cfg.loop === 'one') selectItem(room, s.currentId, true);
        else if (next && (s.autoNext || room.cfg.loop === 'all')) selectItem(room, next.id, true);
        else if (room.cfg.loop === 'all' && room.items.length) selectItem(room, room.items[0].id, true);
        else { s.playing = false; s.position = 0; broadcast(room, stateMsg(room)); }
        break;
      }
      case 'mute-one': {
        const c = [...room.clients].find(x => x.ctx && x.ctx.id === m.id);
        if (!c) break;
        c.ctx.muted = !!m.muted;
        send(c, { type: 'you', muted: c.ctx.muted });
        sendMembers(room);
        break;
      }
      case 'kick': {
        const c = [...room.clients].find(x => x.ctx && x.ctx.id === m.id);
        if (!c) {                                                       // oflayn receiver: ro'yxatdan olib tashlanadi
          if (room.roster) for (const [tok, e] of room.roster) if (e.id === m.id) { room.roster.delete(tok); room.tokens.delete(tok); sendMembers(room); break; }
          break;
        }
        if (room.roster && c.ctx.tok) room.roster.delete(c.ctx.tok);
        if (c.ctx.tok) room.tokens.delete(c.ctx.tok);
        send(c, { type: 'kicked' });
        try { c.close(); } catch {}
        break;
      }
      case 'quiz-start': {
        const hw = m.kind === 'hw';
        const r = sanitizeQuiz(room, Object.assign({}, m.quiz, hw ? { kind: 'hw' } : {}));
        if (r.error) { send(ws, { type: 'notice', message: (hw ? '📝 ' : '🎯 ') + r.error }); break; }
        startQuiz(room, r, { hideOpts: m.hideOpts, hideQ: m.hideQ, celebrate: m.celebrate !== false, stickers: m.stickers !== false, stickerPack: m.stickerPack, auto: !!m.auto, strict: m.strict !== false, strikes: m.strikes, kahoot: m.kahoot !== false, hostPlay: !!m.hostPlay, kind: hw ? 'hw' : 'quiz', pass: m.pass });
        break;
      }
      case 'quiz-ai': quizAiStart(room, ws, m); break;
      case 'quiz-ai-warm': quizAiWarm(room, ws, m); break;           // "Do'st bilan do'st": AI tanlangan miqdorda tasodifiy savol tuzadi
      case 'quiz-flag':                                    // Transmitter: o'yin paytida ham almashtiriladi
        if (room.quiz && m.k === 'hostPlay' && typeof m.v === 'boolean' && room.quiz.hostPlay !== m.v) {      // Transmitter o'yinchi bo'lishini yoqish/o'chirish
          room.quiz.hostPlay = m.v;
          if (m.v) quizHostJoin(room); else { quizHostLeave(room); quizCheckEarly(room); }
          broadcastQuiz(room); quizSendMe(room);
          break;
        }
        if (room.quiz && m.k === 'kahoot' && typeof m.v === 'boolean' && room.quiz.phase === 'lobby') {       // ball tizimi faqat o'yin boshlanishidan oldin almashtiriladi
          room.quiz.kahoot = m.v; broadcastQuiz(room);
          break;
        }
        if (room.quiz && m.k === 'stickerPack' && typeof m.v === 'string' && STK.valid(m.v) && room.quiz.stickerPack !== m.v) {
          room.quiz.stickerPack = m.v;
          const lst = STK.list(m.v);
          room.quiz.players.forEach(p => { if (p.av && !lst.includes(p.av)) p.av = ''; });   // yangi to'plamda yo'q belgilar olinadi; receiver qayta tanlaydi
          room.clients.forEach(c => { if (c.ctx && c.ctx.av && !lst.includes(c.ctx.av)) c.ctx.av = ''; const p = quizPlayer(room, c); if (room.quiz.stickers !== false) p.av = c.ctx.av; });
          room.quizDirty = true; sendMembers(room); broadcastQuiz(room);
          break;
        }
        if (room.quiz && ['hideOpts', 'hideQ', 'celebrate', 'stickers', 'auto'].includes(m.k) && typeof m.v === 'boolean' && room.quiz[m.k] !== m.v) {
          room.quiz[m.k] = m.v;
          if (m.k === 'auto' && room.quiz.phase === 'reveal') { if (m.v) quizAutoNext(room); else clearTimeout(room.quiz.timer); }
          broadcastQuiz(room);
        }
        break;
      case 'quiz-next': if (room.quiz && ['lobby', 'reveal'].includes(room.quiz.phase)) quizNext(room); break;
      case 'quiz-skip': quizReveal(room); break;
      case 'quiz-end': if (room.quiz && room.quiz.phase !== 'final') quizFinal(room); break;
      case 'quiz-close':
        if (room.quiz) clearTimeout(room.quiz.timer);
        room.quiz = null;
        broadcast(room, { type: 'quiz', quiz: null });
        break;
      case 'poll-open': {
        const opts = (Array.isArray(m.opts) ? m.opts : []).map(o => String(o || '').trim().slice(0, 60)).filter(Boolean).slice(0, 4);
        const q = String(m.q || '').trim().slice(0, 120);
        if (!q || opts.length < 2) { send(ws, { type: 'notice', message: 'Savol va kamida 2 ta variant kiriting' }); break; }
        room.poll = { id: crypto.randomBytes(4).toString('hex'), q, opts, votes: opts.map(() => 0), voted: new Map(), open: true };
        broadcast(room, { type: 'poll', poll: pollPub(room.poll) });
        break;
      }
      case 'poll-close':
        if (room.poll) { room.poll.open = false; broadcast(room, { type: 'poll', poll: pollPub(room.poll) }); }
        break;
      case 'poll-clear':
        room.poll = null; broadcast(room, { type: 'poll', poll: null });
        break;
      case 'join-allow': admitOne(room, String(m.id), true); sendPending(room); break;
      case 'join-deny': admitOne(room, String(m.id), false); sendPending(room); break;
      case 'join-allow-all': admitAll(room, true); break;
      case 'join-deny-all': admitAll(room, false); break;
      case 'luck-start': {                              // 🎰 Luck: g'ildirak aylanadi, kimga to'xtasa o'sha yutadi (g'olibni SERVER tanlaydi)
        const now = Date.now();
        if ((room.luckUntil || 0) > now) break;         // oldingi aylanish tugamagan
        const noRepeat = !!m.noRepeat;
        if (!noRepeat) room.luckWon = new Set();
        room.luckWon = room.luckWon || new Set();
        const all = [...room.clients].filter(c => c.ctx && c.ctx.tok);
        let pool = noRepeat ? all.filter(c => !room.luckWon.has(c.ctx.tok)) : all;
        if (all.length < 2) { send(ws, { type: 'notice', message: '🎰 Luck uchun kamida 2 ta receiver kerak' }); break; }
        if (!pool.length) { room.luckWon = new Set(); pool = all; send(ws, { type: 'notice', message: '🎰 Hamma yutib bo\'ldi — ro\'yxat yangidan boshlandi' }); }
        const win = pool[crypto.randomInt(pool.length)];
        room.luckWon.add(win.ctx.tok);
        const others = shuffle(all.filter(c => c !== win)).slice(0, 23);       // g'ildirakda ko'pi bilan 24 ta ism ko'rsatiladi
        const segs = shuffle([win, ...others]).map(c => ({ n: c.ctx.name, a: c.ctx.av || '', id: c.ctx.id }));
        const idx = segs.findIndex(x => x.id === win.ctx.id);
        const dur = 7000, startAt = now + 1500;
        room.luckUntil = startAt + dur + 1500;
        broadcast(room, { type: 'luck', id: crypto.randomBytes(4).toString('hex'), segs, win: idx, jit: (crypto.randomInt(0, 700) - 350) / 1000, total: all.length, startAt, dur, winner: { id: win.ctx.id, name: win.ctx.name, av: win.ctx.av || '' } });
        break;
      }
      case 'mg-start': mgStart(room, ws, m); break;
      case 'gm-start': gmStart(room, ws, m); break;
      case 'gm-close':
        if (room.gm) { const id = room.gm.s.id; gmClear(room); broadcast(room, { type: 'gm', id, close: true }); }
        break;
      case 'mg-close':
        if (room.mg) { const id = room.mg.s.id; mgClear(room); broadcast(room, { type: 'mg', id, close: true }); }
        break;
      case 'luck-close':
        room.luckUntil = 0;
        broadcast(room, { type: 'luck', close: true });
        break;
      case 'test':                                      // Sinxron test signali (Bluetooth kechikishini quloq bilan tuzatish uchun)
        broadcast(room, { type: 'test', on: !!m.on, t0: Date.now() + 1500 });
        break;
      case 'rename': {                                  // YouTube sarlavhasi
        const it = room.items.find(i => i.id === m.id);
        const nm = safeName(m.name);
        if (it && it.kind === 'youtube' && nm) { it.name = nm; broadcast(room, { type: 'items', items: room.items }); }
        break;
      }
      case 'announce': {
        const text = String(m.text || '').trim().slice(0, 200);
        if (text) sendAll(room.clients, { type: 'notice', message: '📢 ' + text });
        break;
      }
      case 'live': {
        const id = v => (typeof v === 'string' && v ? v.slice(0, 80) : null);
        room.live = { mic: id(m.mic), screen: id(m.screen), mode: m.mode === 'motion' ? 'motion' : 'detail' };
        if (!room.live.mic && !room.live.screen) resetTree(room);
        sendAll(room.clients, { type: 'live', live: room.live });
        break;
      }
      case 'add-url': {
        let u;
        try { u = new URL(String(m.url)); } catch { return send(ws, { type: 'notice', message: 'Havola noto\'g\'ri' }); }
        if (!/^https?:$/.test(u.protocol)) return send(ws, { type: 'notice', message: 'Faqat http/https havola' });
        const dp = driveParse(u);                       // Google Drive / Docs / Sheets / Slides / papka havolasi
        if (dp) { driveAdd(room, ws, dp, m); break; }
        const ext = path.extname(u.pathname).toLowerCase();
        const yid = ytIdOf(u);
        const item = yid ? {
          id: crypto.randomBytes(6).toString('hex'), name: safeName(m.name || 'YouTube video'), cid: '',
          kind: 'youtube', ytId: yid, url: `https://www.youtube.com/watch?v=${yid}`, size: 0, external: true, gainDb: null,
        } : {
          id: crypto.randomBytes(6).toString('hex'),
          name: safeName(m.name || decodeURIComponent(path.basename(u.pathname)) || u.hostname),
          cid: '',
          kind: kindOf(ext) || 'video',
          url: u.href, size: 0, external: true, gainDb: null,
        };
        room.items.push(item);
        let first = false;
        if (!s.currentId) { s.currentId = item.id; first = true; }
        broadcast(room, { type: 'items', items: room.items });
        if (first) broadcast(room, stateMsg(room));
        break;
      }
      case 'remove': {
        const idx = room.items.findIndex(i => i.id === m.id);
        if (idx < 0) break;
        const [item] = room.items.splice(idx, 1);
        dropItemFile(room, item);
        if (s.currentId === item.id) {
          s.currentId = null; s.playing = false; s.position = 0;
          room.clients.forEach(c => { if (c.ctx) c.ctx.ready = false; });
        }
        broadcast(room, { type: 'items', items: room.items });
        broadcast(room, stateMsg(room));
        sendMembers(room);
        break;
      }
      case 'close':
        removeRoom(room, 'Transmitter xonani yopdi');
        break;
    }
  });

  ws.on('close', () => {
    if (ws.pend) { const r = rooms.get(String(ws.pend.m.code)); if (r && r.pending) { r.pending.delete(ws.pend.id); sendPending(r); } ws.pend = null; }
    const ctx = ws.ctx;
    if (!ctx) return;
    const room = ctx.room;
    if (ctx.role === 'host') {
      if (room.host === ws) {
        room.host = null;
        room.live = { mic: null, screen: null };      // Transmitter uzildi: jonli efir to'xtaydi
        resetTree(room);
        sendAll(room.clients, { type: 'live', live: room.live });
      }
    }
    else {
      const kids = [...ctx.children];
      detach(room, ws);
      room.clients.delete(ws);
      kids.forEach(id => { const k = clientById(room, id); if (k) { k.ctx.parent = null; send(k, { type: 'rtc-reparent' }); } });   // bolalari yangi manba topadi
    }
    room.lastSeen = Date.now();
    if (room.quiz) { room.quizDirty = true; quizCheckEarly(room); }
    if (rooms.has(room.code)) { sendMembers(room); CLS.sync(room); }
  });
});

// ---- Qabul qilish rejimi (cfg.approve): yangi receiver Transmitter ruxsatini kutadi
const devStr = (v, n = 40) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
function cleanDev(d) {                                   // receiver yuborgan qurilma ma'lumoti (ishonib bo'lmaydi: faqat qisqa matn sifatida)
  if (!d || typeof d !== 'object') return null;
  return { k: ['phone', 'tablet', 'pc', 'tv', 'other'].includes(d.k) ? d.k : 'other', os: devStr(d.os, 24), br: devStr(d.br, 24), model: devStr(d.model, 40) };
}
function sendPending(room) {
  if (!room.host) return;
  const list = [...(room.pending || new Map()).values()].map(w => ({ id: w.pend.id, name: w.pend.name, dev: w.pend.dev, t: w.pend.t }));
  send(room.host, { type: 'join-requests', list });
}
function admitOne(room, id, ok) {
  const w = room.pending && room.pending.get(id);
  if (!w) return;
  room.pending.delete(id);
  const m = w.pend.m; w.pend = null;
  if (w.readyState !== 1) return;
  if (ok) onJoin(w, m, true);
  else { send(w, { type: 'error', code: 'DENIED', message: 'Transmitter sizni qabul qilmadi' }); try { w.close(); } catch {} }
}
function admitAll(room, ok = true) { [...room.pending.keys()].forEach(id => admitOne(room, id, ok)); sendPending(room); }

function onJoin(ws, m, approved) {
  const room = rooms.get(String(m.code));
  if (!room) {
    send(ws, { type: 'error', code: 'NO_ROOM', message: 'Bunday kodli xona topilmadi' });
    return ws.close();
  }
  const isHost = m.role === 'host';
  if (isHost && m.key !== room.hostKey) {
    send(ws, { type: 'error', code: 'BAD_KEY', message: 'Transmitter kaliti noto\'g\'ri' });
    return ws.close();
  }
  if (!isHost && !String(m.name || '').trim()) {
    send(ws, { type: 'error', code: 'NO_NAME', message: 'Ismingizni kiriting — ism majburiy' });
    return ws.close();
  }
  const known = !isHost && m.tok && room.tokens.get(String(m.tok)) === 'receiver';   // qayta ulanayotgan receiver
  if (!isHost && room.cfg.locked && !known && !approved) {
    send(ws, { type: 'error', code: 'LOCKED', message: 'Transmitter xonani qulflagan' });
    return ws.close();
  }
  if (!isHost && room.cfg.phoneOnly && !isPhoneWs(ws, cleanDev(m.dev)) && !(room.cfg.pcApprove && isPcWs(ws, cleanDev(m.dev)))) {
    send(ws, { type: 'error', code: 'PHONE_ONLY', message: PHONE_MSG });
    return ws.close();
  }
  if (!isHost && room.clients.size >= MAX_CLIENTS) {
    send(ws, { type: 'error', code: 'FULL', message: 'Xona to\'lgan' });
    return ws.close();
  }
  if (!isHost && needsApproval(room, ws, cleanDev(m.dev)) && !known && !approved) {            // qabul qilish rejimi: Transmitter ruxsatini kutadi
    room.pending = room.pending || new Map();
    if (ws.pend) return;                                              // allaqachon navbatda
    if (room.pending.size >= 100) { send(ws, { type: 'error', code: 'FULL', message: 'Qabul navbati to\'lgan, keyinroq urinib ko\'ring' }); return ws.close(); }
    ws.pend = { id: crypto.randomBytes(3).toString('hex'), name: String(m.name || '').replace(/\s+/g, ' ').slice(0, 24).trim() || 'Receiver', dev: cleanDev(m.dev), t: Date.now(), m };
    room.pending.set(ws.pend.id, ws);
    send(ws, { type: 'pending' });
    sendPending(room);
    if (room.host) send(room.host, { type: 'notice', message: `${room.cfg.approve ? '🚪' : '💻'} ${ws.pend.name} qo'shilmoqchi — qabul qilasizmi?` });
    return;
  }

  ws.ctx = {
    room, role: isHost ? 'host' : 'receiver',
    id: crypto.randomBytes(3).toString('hex'),
    name: (!isHost && m.tok && room.faceNames && room.faceNames.get(String(m.tok))) || String(m.name || '').replace(/\s+/g, ' ').slice(0, 24).trim() || (isHost ? 'Transmitter' : 'Receiver'),
    ready: false, muted: false,
    canRelay: !isHost && !!m.relay, parent: null, children: new Set(), streamReady: false,
    dev: isHost ? null : cleanDev(m.dev),
  };
  ws.ctx.tok = issueToken(room, ws.ctx.role, m.tok && String(m.tok));
  ws.ctx.av = AVATARS.includes(m.av) ? m.av : '';            // stikerlar standart o'chiq: avtomatik hayvonchasi berilmaydi
  if (isHost) {
    if (room.host && room.host !== ws) { try { room.host.close(); } catch {} }
    room.host = ws;
  } else {
    for (const o of [...room.clients]) if (o !== ws && o.ctx && o.ctx.tok === ws.ctx.tok) { room.clients.delete(o); o.ctx.replaced = true; try { detach(room, o); o.terminate(); } catch {} }   // shu qurilmaning eski (uzilgan) ulanishi
    room.clients.add(ws);
  }
  room.lastSeen = Date.now();
  send(ws, {
    type: 'joined', role: ws.ctx.role, av: ws.ctx.av, myName: ws.ctx.name, code: room.code, name: room.name || '', items: room.items, state: room.state,
    cfg: room.cfg, live: room.live, poll: pollPub(room.poll), myVote: room.poll ? room.poll.voted.get(ws.ctx.tok) : undefined, myId: ws.ctx.id, tok: ws.ctx.tok, serverNow: Date.now(), chat: room.chat || [],
  });
  if (room.gm) gmSendTo(room, ws);
  if (room.mg) send(ws, { type: 'mg', ...room.mg.s });                // o'yin ketayotganda kirgan/qayta ulangan qurilma ham ko'radi
  if (isHost) sendAll(room.clients, { type: 'live', live: room.live, resync: true });
  if (isHost) sendPending(room);
  if (room.quiz) {
    if (!isHost || room.quiz.hostPlay) quizPlayer(room, ws);
    const a = room.quiz.answers.get(ws.ctx.tok);
    send(ws, { type: 'quiz-state', av: ws.ctx.av, quiz: quizPub(room, isHost), me: quizMe(room, ws.ctx.tok), myAnswer: a ? a.my : null });
    room.quizDirty = true;
  }   // host qayta ulandi: efirni tiklash
  ATT.onJoin(room, ws);
  sendMembers(room);
  CLS.sync(room);
}

// Proksi/hosting uzilib qolmasligi uchun yurak urishi
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive && (ws.missed = (ws.missed || 0) + 1) >= 2) return ws.terminate();   // bitta o'tkazib yuborilgan ping uchun uzmaymiz (telefon/proksi)
    if (ws.isAlive) ws.missed = 0;
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 25000);

// Receiver statistikasini hostga siyraklashtirib yuborish
setInterval(() => { for (const room of rooms.values()) if (room.dirty) { room.dirty = false; sendMembers(room); } }, 2000);

// So'rovnoma natijalari: 1 s da bir marta (har bir ovozda emas)
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.pollDirty) { room.pollDirty = false; broadcast(room, { type: 'poll', poll: pollPub(room.poll) }); }
    if (room.quizDirty && room.quiz) { room.quizDirty = false; send(room.host, { type: 'quiz-progress', answered: room.quiz.answers.size, total: room.clients.size + (room.quiz.hostPlay && room.host ? 1 : 0), players: room.quiz.players.size }); }
  }
}, 1000);

// Bo'sh xonalarni tozalash
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const empty = !room.host && room.clients.size === 0;
    if ((empty && now - room.lastSeen > IDLE_ROOM_MS) || (!room.host && now - room.lastSeen > MAX_HOSTLESS_MS)) {
      removeRoom(room, 'Xona vaqti tugadi');
    }
  }
}, 60 * 1000);

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', 1024, () => {
  console.log('\n  SyncCast ishga tushdi\n');
  console.log(`  Shu kompyuterda:   http://localhost:${PORT}`);
  lanAddresses().forEach(ip => console.log(`  Wi-Fi tarmog'ida:  http://${ip}:${PORT}`));
  console.log(CENTERS.length
    ? `  🏫 O'quv markazlar: ${CENTERS.map(c => c.pub.name + (c.shash ? ' (ustoz+student)' : ' (faqat ustoz kodi)')).join(', ')}  (kod: ${CODE_MAX_TRIES} ta urinish, keyin ${CODE_LOCK_MS / 60000} daqiqa blok)`
    : '  🏫 O\'quv markazlar sozlanmagan (.env ichiga CENTER_1_TEACHER_CODE, CENTER_1_STUDENT_CODE va CENTER_1_NAME qo\'shing)');
  console.log('\n  Transmitter xona yaratadi, Receiverlar kod bilan kiradi.\n');
});

// ------------------------------------------------------------ barqarorlik
// Kutilmagan xato bitta xonani emas, butun serverni yiqitmasin: log qilinadi va ishlash davom etadi
process.on('uncaughtException', e => console.error('[uncaughtException]', e && e.stack || e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e && e.stack || e));

// Event loop kechikishi (ms): server "qotib" qolayotganini ko'rsatadi
let loopH = null; try { loopH = require('perf_hooks').monitorEventLoopDelay({ resolution: 20 }); loopH.enable(); } catch {}
setInterval(() => { if (loopH) loopH.reset(); }, 60 * 1000).unref();
app.get('/api/health', (req, res) => {
  const mu = process.memoryUsage();
  let conns = 0; wss.clients.forEach(w => { if (w.readyState === 1) conns++; });
  res.set('Cache-Control', 'no-store').json({
    ok: true, version: require('./package.json').version, uptime: Math.round(process.uptime()),
    rooms: rooms.size, sockets: conns,
    loopLagMs: loopH ? { mean: +(loopH.mean / 1e6).toFixed(2), p99: +(loopH.percentile(99) / 1e6).toFixed(2), max: +(loopH.max / 1e6).toFixed(2) } : null,
    memoryMB: { rss: Math.round(mu.rss / 1048576), heap: Math.round(mu.heapUsed / 1048576) }, node: process.version
  });
});

// Chiroyli to'xtatish: receiverlarga "qayta ulaning" signali (1001) ketadi, kutilayotgan yozuvlar tugaydi
let closing = false;
function shutdown() {
  if (closing) return; closing = true;
  try { wss.clients.forEach(w => { try { w.close(1001, 'server restart'); } catch {} }); } catch {}
  try { server.close(); } catch {}
  setTimeout(() => { try { fs.rmSync(UPLOAD_DIR, { recursive: true, force: true }); } catch {} process.exit(0); }, 600).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
