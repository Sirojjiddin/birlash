/* Loyiha haqida: Birlash — darsliklar, ekotizim va yo'l xaritasi (alohida fayl, app.js ga tegmaydi) */
(function () {
  'use strict';
  var LOGO = '<svg class="ab-logo" viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="abg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset=".55" stop-color="#6d5cff"/><stop offset="1" stop-color="#ff4d9d"/></linearGradient></defs><rect width="512" height="512" rx="116" fill="url(#abg)"/><circle cx="204" cy="256" r="104" fill="none" stroke="#fff" stroke-width="30"/><circle cx="308" cy="256" r="104" fill="none" stroke="#fff" stroke-width="30"/><path d="M256 168a104 104 0 0 1 0 176a104 104 0 0 1 0-176z" fill="#fff"/><circle cx="256" cy="256" r="18" fill="#6d5cff"/></svg>';
  var MINI = LOGO.replace('class="ab-logo"', '').replace('id="abg"', 'id="abg2"').replace('url(#abg)', 'url(#abg2)');

  var TABS = [['loyiha', 'Loyiha'], ['dars', 'Darsliklar'], ['eko', 'Birlash ekotizimi'], ['reja', 'Nimalar qilish kerak']];

  var HTML = {
    loyiha:
      '<h3><a href="https://drive.google.com/file/d/1ODkV_q3bigOuKpb8gpAMo1BeaIGZkWG5/view?usp=sharing">Birlash nima?</a></h3>' +
      '<p>Birlash — bir xonada (yoki internet orqali) bir nechta telefon va kompyuterda audio, video va fayllarni <b>bir vaqtda</b> chalish va ko\'rsatish tizimi. Ustoz (Transmitter) uzatadi, o\'quvchilar (Receiver) kod yoki QR orqali kirib, o\'z qurilmasida bir xil ko\'radi va eshitadi.</p>' +
      '<div class="ab-grid">' +
      '<div class="ab-card"><b>⚡ Sinxron chalish</b><small>Har bir qurilma server bilan soatini o\'lchaydi (ms aniqlikda), Play hammada bir paytda boshlanadi.</small></div>' +
      '<div class="ab-card"><b>🎯 Viktorina va AI Quiz</b><small>Kahoot uslubidagi o\'yin, rasmli savollar, fayldan avtomatik savol yaratish.</small></div>' +
      '<div class="ab-card"><b>📋 Davomat</b><small>Joylashuv va Face ID bilan keldi/kelmadi, shablon faylga avtomatik to\'ldirish.</small></div>' +
      '<div class="ab-card"><b>📝 Uyga vazifa</b><small>Savollar bazasidan har bir o\'quvchiga turli savollar va vaqt chegarasi.</small></div>' +
      '<div class="ab-card"><b>🏫 O\'quv markaz rejimi</b><small>Markaz kodi bilan xona avtomatik yaratiladi, faqat kod kiritganlarga ko\'rinadi.</small></div>' +
      '<div class="ab-card"><b>📶 Tarmoq holati</b><small>Yuqori o\'ng burchakdagi ko\'rsatkich ms, jitter va sifatni jonli ko\'rsatadi.</small></div>' +
      '</div>' +
      '<h3>Server haqida</h3>' +
      '<ul><li>Nagle o\'chirilgan, kichik xabarlar kechikmasdan ketadi; WebSocket siqishsiz (CPU kechikish qo\'shmasin).</li>' +
      '<li>Play kechikishi tarmoqqa qarab o\'zi moslashadi: tez tarmoqda qisqa, sekin tarmoqda uzunroq.</li>' +
      '<li>Sekin yoki o\'lik ulanish xotirani to\'ldirmaydi; kutilmagan xato butun serverni yiqitmaydi.</li>' +
      '<li>Salomatlik tekshiruvi: <code>/api/health</code> (ulanishlar, xonalar, event loop kechikishi, xotira).</li></ul>',
    dars:
      '<h3>Qadam-baqadam darsliklar</h3>' +
      '<details open><summary>1 · Xona yaratish (Transmitter)</summary><div><ol><li>Bosh sahifada <b>Transmitter</b> ni tanlang.</li><li>Xona nomini kiriting va <b>Xonani yaratish</b> ni bosing.</li><li>Chiqqan kod yoki QR ni o\'quvchilarga ko\'rsating.</li><li>Fayl yuklang yoki YouTube havolasini qo\'ying va <b>Play</b> bosing.</li></ol></div></details>' +
      '<details><summary>2 · Receiver sifatida kirish</summary><div><ol><li><b>Receiver</b> ni tanlang.</li><li>Xona kodini kiriting yoki QR ni skaner qiling (ro\'yxatdan xonani tanlash ham mumkin).</li><li>Ismingizni yozing va kiring: ovoz va video avtomatik sinxron bo\'ladi.</li></ol><p>Eng yaxshi natija uchun telefon ovozini yoqing va ekranni o\'chirib qo\'ymang.</p></div></details>' +
      '<details><summary>3 · Viktorina o\'tkazish</summary><div><ol><li>Transmitterda <b>Viktorina</b> tabini oching.</li><li>Savollarni qo\'lda yozing, fayldan import qiling yoki AI dan so\'rang.</li><li>Rasmli savollar uchun rasmni savolga biriktiring (bir nechta rasmni ketma-ket yuklash ham bor).</li><li>Vaqt va savollar sonini tanlab <b>Boshlash</b> ni bosing; o\'quvchilar o\'z telefonida javob beradi.</li></ol></div></details>' +
      '<details><summary>4 · AI Quiz (fayldan savol yaratish)</summary><div><ol><li><b>AI Quiz</b> ni oching.</li><li>Rasm yoki PDF yuklang (matn bo\'lsa ham bo\'ladi).</li><li>Savollar soni va qiyinlikni tanlang va yarating.</li><li>Natijani tekshirib, viktorinaga o\'tkazing.</li></ol></div></details>' +
      '<details><summary>5 · Davomat olish</summary><div><ol><li><b>Davomat</b> tabini oching, o\'quvchilar ro\'yxatini kiriting.</li><li>O\'quvchilar kirganda joylashuv va (yoqilgan bo\'lsa) Face ID tekshiriladi.</li><li>Kelganlar <b>+</b>, kelmaganlar <b>-</b> bilan belgilanadi.</li><li>Shablon faylni yuklasangiz, belgilar shu faylga to\'ldirilib qaytariladi.</li></ol></div></details>' +
      '<details><summary>6 · Uyga vazifa tekshirish</summary><div><ol><li>Savollar bazasini viktorinadagidek yuklang.</li><li>Savollar soni va daqiqani belgilang.</li><li>Har bir o\'quvchi bazadan turli savollar oladi; baza kichik bo\'lsa, savollar takrorlanishi mumkin.</li></ol></div></details>' +
      '<details><summary>7 · O\'quv markaz kodi</summary><div><ol><li>Bosh sahifada markaz kodini kiriting.</li><li>Transmitter va Receiver tugmalari ko\'rinadi: ustoz <b>Transmitter</b> ni tanlaydi.</li><li>Markaz xonasi ro\'yxatda faqat kod kiritganlarga chiqadi; oddiy foydalanuvchi xona kodi bilan kirishi mumkin.</li></ol></div></details>' +
      '<details><summary>8 · Barqaror ishlash uchun maslahatlar</summary><div><ul><li>Imkon bo\'lsa hamma bitta Wi-Fi tarmog\'ida bo\'lsin (lokal rejim eng past ms beradi).</li><li>Katta fayllarni oldindan yuklab qo\'ying, keyin Play bosing.</li><li>Tarmoq ko\'rsatkichi qizil bo\'lsa, qurilmani routerga yaqinlashtiring.</li></ul></div></details>',
    eko:
      '<h3>Birlash ekotizimi</h3>' +
      '<p>Birlash faqat sinxron chalish emas, o\'quv markazlar va jamoalar uchun bir-biriga ulanadigan mahsulotlar oilasiga aylanadi.</p>' +
      '<div class="ab-orbit">' +
      '<div class="ab-node core"><span>🔗</span>Birlash<br>(hozir)</div><i class="ab-link"></i>' +
      '<div class="ab-node soon"><span>📞</span>Birlash Ring</div><i class="ab-link"></i>' +
      '<div class="ab-node soon"><span>💳</span>Birlash Pay</div><i class="ab-link"></i>' +
      '<div class="ab-node soon"><span>🏢</span>Birlash ERP</div></div>' +
      '<div class="ab-grid">' +
      '<div class="ab-card"><span class="ab-tag live">Ishlayapti</span><b>Birlash</b><small>Sinxron chalish, viktorina, davomat, AI quiz, uyga vazifa.</small></div>' +
      '<div class="ab-card"><span class="ab-tag soon">Keyinroq</span><b>Birlash Ring</b><small>Jamoa va guruh aloqasi: qo\'ng\'iroq, chaqiruv va xabarlar.</small></div>' +
      '<div class="ab-card"><span class="ab-tag soon">Keyinroq</span><b>Birlash Pay</b><small>Kurs to\'lovlari, obuna va hisob-kitob.</small></div>' +
      '<div class="ab-card"><span class="ab-tag soon">Keyinroq</span><b>Birlash ERP</b><small>Markazni boshqarish: o\'quvchilar, guruhlar, davomat, to\'lov va hisobotlar bir joyda.</small></div>' +
      '</div>' +
      '<p>Maqsad: bitta hisob bilan hamma mahsulotga kirish, davomat va to\'lov ma\'lumotlari ERP da birlashishi.</p>',
    reja:
      '<h3>Nimalar qilish kerak</h3>' +
      '<ul class="ab-road">' +
      '<li><i>✅</i><div><span class="ab-tag done">Tayyor</span><br>Sinxron chalish, viktorina, AI quiz, davomat, Face ID, uyga vazifa, markaz rejimi.</div></li>' +
      '<li><i>🛠</i><div><span class="ab-tag todo">Navbatda</span><br>Server monitoringi: /api/health ni tashqi kuzatuvga ulash, xatolar jurnali.</div></li>' +
      '<li><i>🛠</i><div><span class="ab-tag todo">Navbatda</span><br>Darsliklar bo\'limini video va skrinshotlar bilan boyitish, har bir funksiya yonida qisqa yordam.</div></li>' +
      '<li><i>🛠</i><div><span class="ab-tag todo">Navbatda</span><br>Hisob (akkaunt) tizimi: bitta kirish bilan butun ekotizim.</div></li>' +
      '<li><i>🕒</i><div><span class="ab-tag soon">Keyinroq</span><br>Birlash Ring.</div></li>' +
      '<li><i>🕒</i><div><span class="ab-tag soon">Keyinroq</span><br>Birlash Pay.</div></li>' +
      '<li><i>🕒</i><div><span class="ab-tag soon">Keyinroq</span><br>Birlash ERP: davomat va viktorina natijalarini markaz hisobotlariga ulash.</div></li>' +
      '</ul>'
  };

  var root, lastFocus;
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'aboutRoot';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Loyiha haqida');
    var tabs = TABS.map(function (t, i) { return '<button role="tab" data-t="' + t[0] + '" aria-selected="' + (i === 0) + '">' + t[1] + '</button>'; }).join('');
    var secs = TABS.map(function (t, i) { return '<section data-s="' + t[0] + '" class="' + (i === 0 ? 'on' : '') + '">' + HTML[t[0]] + '</section>'; }).join('');
    root.innerHTML = '<div class="ab-bg"></div><div class="ab-box"><div class="ab-head">' + LOGO +
      '<div><h2>Birlash</h2><p>Birgalikda, bir vaqtda, bir xil. Loyiha haqida</p></div><button class="ab-x" aria-label="Yopish">✕</button></div>' +
      '<div class="ab-tabs" role="tablist">' + tabs + '</div><div class="ab-body">' + secs +
      '<div class="ab-foot">© 2026 Birlash. Barcha huquqlar himoyalangan.</div></div></div>';
    document.body.appendChild(root);
    root.querySelector('.ab-bg').addEventListener('click', close);
    root.querySelector('.ab-x').addEventListener('click', close);
    root.querySelector('.ab-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-t]'); if (b) show(b.getAttribute('data-t'));
    });
  }
  function show(id) {
    root.querySelectorAll('.ab-tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-t') === id)); });
    root.querySelectorAll('.ab-body section').forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-s') === id); });
    var body = root.querySelector('.ab-body'); if (body) body.scrollTop = 0;
  }
  function open(tab) {
    build(); lastFocus = document.activeElement;
    root.classList.add('on'); document.documentElement.style.overflow = 'hidden';
    show(tab || 'loyiha'); root.querySelector('.ab-x').focus();
  }
  function close() {
    if (!root) return;
    root.classList.remove('on'); document.documentElement.style.overflow = '';
    if (location.hash === '#about') history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && root.classList.contains('on')) close(); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-about]'); if (!a) return;
    e.preventDefault(); open(a.getAttribute('data-about') || 'loyiha');
  });
  window.addEventListener('hashchange', function () { if (location.hash === '#about') open(); });

  // Tugmalar: sarlavhada va pastki qismda (index.html ga qo'lda tegmasdan ham ishlaydi)
  function inject() {
    var btnHtml = '<button type="button" class="about-open" data-about="loyiha" aria-label="Loyiha haqida">' + MINI + '<span>Loyiha haqida</span></button>';
    var tr = document.querySelector('.top-r');
    if (tr && !tr.querySelector('.about-open')) { var w = document.createElement('span'); w.innerHTML = btnHtml; tr.insertBefore(w.firstChild, tr.firstChild); }
    document.querySelectorAll('footer.footer').forEach(function (f) {
      if (f.querySelector('.about-open')) return;
      var p = document.createElement('p'); p.style.marginTop = '12px'; p.innerHTML = btnHtml; f.appendChild(p);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject); else inject();
  if (location.hash === '#about') setTimeout(open, 0);
  window.BirlashAbout = { open: open, close: close };
})();
