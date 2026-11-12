/* Progressive enhancements: language, layout, visual mode. Existing quiz/network logic untouched. */
(() => {
  'use strict';
  const D = {
    uz: {
      language: 'Til', languageLabel: 'Tilni tanlang', about: 'Loyiha haqida', functions: 'Funksiyalar',
      live: 'Efirda', design: 'Dizayn', modern: '✨ Yangi', standard: '◻ Standart',
      title: 'Hamma qurilmada', subtitle: 'Bir vaqtda', host: 'Transmitter', receiver: 'Receiver',
      choose: 'Belgingizni tanlang', ready: 'Tayyor bo‘ling!', quiz: 'Viktorina va AI Quiz',
      games: 'O‘yinlar va Luck', file: 'Fayl · 7 GB gacha', music: 'Musiqa va film',
      screen: 'Ekran va mikrofon', hint: 'Xona yarating, fayl yuklang, ovoz va ekranni hammaga uzating',
    },
    en: {
      language: 'Language', languageLabel: 'Choose language', about: 'About the project', functions: 'Functions',
      live: 'Live', design: 'Design', modern: '✨ Modern', standard: '◻ Standard',
      title: 'On every device', subtitle: 'At the same time', host: 'Host', receiver: 'Join',
      choose: 'Choose your character', ready: 'Get ready!', quiz: 'Quizzes and AI Quiz',
      games: 'Games and Luck', file: 'Files · up to 7 GB', music: 'Music and video',
      screen: 'Screen and microphone', hint: 'Create a room, upload files, and share audio or screen with everyone',
    },
    ru: {
      language: 'Язык', languageLabel: 'Выберите язык', about: 'О проекте', functions: 'Функции',
      live: 'Эфир', design: 'Дизайн', modern: '✨ Новый', standard: '◻ Стандарт',
      title: 'На всех устройствах', subtitle: 'Одновременно', host: 'Ведущий', receiver: 'Участник',
      choose: 'Выберите персонажа', ready: 'Приготовьтесь!', quiz: 'Викторины и AI Quiz',
      games: 'Игры и Luck', file: 'Файлы · до 7 ГБ', music: 'Музыка и видео',
      screen: 'Экран и микрофон', hint: 'Создайте комнату, загружайте файлы и делитесь звуком или экраном',
    },
  };
  const get = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const put = (key, value) => {
    try { localStorage.setItem(key, value); } catch {}
  };
  let lang = get('bx_lang', 'uz');
  let mode = get('bx_mode', 'modern');
  if (!D[lang]) lang = 'uz';
  if (!['modern', 'standard'].includes(mode)) mode = 'modern';
  try { localStorage.removeItem('bx_layout'); } catch {}

  const map = {
    'Musiqa va film': 'music',
    'Ekran va mikrofon': 'screen',
    'Fayl · 7 GB gacha': 'file',
    'Viktorina va AI Quiz': 'quiz',
    'O‘yinlar va Luck': 'games',
    "O'yinlar va Luck": 'games',
    'Belgingizni tanlang': 'choose',
    "Tayyor bo'ling!": 'ready',
  };

  function setFirstTextNode(element, value) {
    if (!element) return;
    const node = Array.from(element.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (node) node.textContent = ` ${value} `;
  }

  function translate() {
    const d = D[lang];
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-bx-key]').forEach(element => {
      const key = element.dataset.bxKey;
      if (d[key]) element.textContent = d[key];
    });
    document.querySelectorAll('.flow .ft,.qp-avt').forEach(element => {
      if (!element.dataset.bxOriginal) element.dataset.bxOriginal = element.textContent.trim();
      const key = map[element.dataset.bxOriginal];
      if (key) element.textContent = d[key];
    });

    const language = document.getElementById('bxLang');
    if (language) language.setAttribute('aria-label', d.languageLabel);
    const about = document.querySelector('.top-r .about-open');
    if (about) {
      const label = about.querySelector('span');
      if (label) label.textContent = d.about;
      about.setAttribute('aria-label', d.about);
    }
    const functions = document.getElementById('fnBtn');
    if (functions) {
      setFirstTextNode(functions, `☰ ${d.functions}`);
      functions.setAttribute('aria-label', d.functions);
    }
    const drawerTitle = document.querySelector('#drawer .drawer-head b');
    if (drawerTitle) drawerTitle.textContent = `☰ ${d.functions}`;
    const live = document.getElementById('liveChip');
    if (live) setFirstTextNode(live, `🔴 ${d.live}`);

    const heading = document.querySelector('.hero h1');
    if (heading) {
      heading.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = `${d.title} `;
      });
      const subtitle = heading.querySelector('.grad');
      if (subtitle) subtitle.textContent = d.subtitle;
    }
    const host = document.querySelector('#goHost b');
    if (host) host.textContent = d.host;
    const receiver = document.querySelector('#goRecv b');
    if (receiver) receiver.textContent = d.receiver;
    const hint = document.querySelector('#goHost small:last-child');
    if (hint) hint.textContent = d.hint;
  }

  function apply() {
    document.body.classList.toggle('bx-modern', mode === 'modern');
    document.body.classList.remove('bx-left');
    const design = document.getElementById('bxMode');
    if (design) {
      design.textContent = D[lang][mode];
      design.title = D[lang].design;
      design.setAttribute('aria-label', D[lang].design);
      design.setAttribute('aria-pressed', String(mode === 'modern'));
    }
    translate();
  }

  function init() {
    const header = document.querySelector('.top-r') || document.querySelector('header');
    if (!header) return;
    const tools = document.createElement('div');
    tools.className = 'bx-tools';
    tools.setAttribute('aria-label', 'Display preferences');
    tools.innerHTML = '<select id="bxLang" aria-label="Choose language"><option value="uz">🇺🇿 O‘zbek</option><option value="en">🇬🇧 English</option><option value="ru">🇷🇺 Русский</option></select><button type="button" id="bxMode"></button>';
    header.append(tools);
    const language = document.getElementById('bxLang');
    language.value = lang;
    language.onchange = event => {
      if (!D[event.target.value]) return;
      lang = event.target.value;
      put('bx_lang', lang);
      apply();
    };
    document.getElementById('bxMode').onclick = () => {
      mode = mode === 'modern' ? 'standard' : 'modern';
      put('bx_mode', mode);
      apply();
    };
    apply();

    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; translate(); });
    });
    const quiz = document.getElementById('qpBody');
    if (quiz) observer.observe(quiz, { childList: true, subtree: false });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
