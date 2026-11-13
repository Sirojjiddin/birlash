/* Progressive enhancements: language, layout, visual mode. Existing quiz/network logic untouched. */
(() => {
  'use strict';
  const D = {
    uz: {
      language: 'Til', languageLabel: 'Tilni tanlang', about: 'Loyiha haqida', functions: 'Funksiyalar',
      live: 'Efirda', design: 'Dizayn', modern: 'Yangi', standard: 'Standart',
      title: 'Hamma qurilmada', subtitle: 'Bir vaqtda', host: 'Transmitter', receiver: 'Receiver',
      choose: 'Belgingizni tanlang', ready: 'Tayyor bo‘ling!', quiz: 'Viktorina va AI Quiz',
      games: 'O‘yinlar va Luck', file: 'Fayl · 7 GB gacha', music: 'Musiqa va film',
      screen: 'Ekran va mikrofon', hint: 'Xona yarating, fayl yuklang, ovoz va ekranni hammaga uzating',
    },
    en: {
      language: 'Language', languageLabel: 'Choose language', about: 'About the project', functions: 'Functions',
      live: 'Live', design: 'Appearance', modern: 'Modern', standard: 'Standard',
      title: 'On every device', subtitle: 'At the same time', host: 'Host', receiver: 'Join',
      choose: 'Choose your character', ready: 'Get ready!', quiz: 'Quizzes and AI Quiz',
      games: 'Games and Luck', file: 'Files · up to 7 GB', music: 'Music and video',
      screen: 'Screen and microphone', hint: 'Create a room, upload files, and share audio or screen with everyone',
    },
    ru: {
      language: 'Язык', languageLabel: 'Выберите язык', about: 'О проекте', functions: 'Функции',
      live: 'Эфир', design: 'Оформление', modern: 'Новый', standard: 'Стандарт',
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
  let mode = get('bx_mode', 'standard');
  if (!D[lang]) lang = 'uz';
  if (!['modern', 'standard'].includes(mode)) mode = 'standard';
  try { localStorage.removeItem('bx_layout'); } catch {}

  function apply() {
    document.body.classList.toggle('bx-modern', mode === 'modern');
    document.body.classList.remove('bx-left');
    document.documentElement.lang = lang;
    const design = document.getElementById('bxMode');
    if (design) {
      design.innerHTML = `<svg class="premium-icon" aria-hidden="true"><use href="#i-palette"></use></svg><span>${D[lang][mode]}</span>`;
      design.title = D[lang].design;
      design.setAttribute('aria-label', D[lang].design);
      design.setAttribute('aria-pressed', String(mode === 'modern'));
    }
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
      window.dispatchEvent(new CustomEvent('bx:language', { detail: lang }));
    };
    document.getElementById('bxMode').onclick = () => {
      mode = mode === 'modern' ? 'standard' : 'modern';
      put('bx_mode', mode);
      apply();
    };
    apply();

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
