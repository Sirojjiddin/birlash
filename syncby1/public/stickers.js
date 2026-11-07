/* Stiker to'plamlari — server (require) va brauzer (window.STICKERS) uchun umumiy.
   Faqat umumiy emoji belgilari: biror kompaniyaning himoyalangan qahramonlari yo'q. */
(function (root) {
  const P = [
    { id: 'animals', name: 'Hayvonlar', icon: '🐯', items: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🦆','🦉','🦄','🐝','🦋','🐢','🐙','🦀','🐬','🐳','🦈','🐊','🦒','🦓','🐘','🦔','🐿️','🦜','🦩'] },
    { id: 'food', name: 'Meva va o\'yin', icon: '🍓', items: ['🍎','🍌','🍇','🍓','🍉','🍊','🍋','🍍','🥝','🍒','🍑','🥭','🍐','🥥','🍅','🥕','🌽','🍄','🌵','🌻','⭐','🚀','🎈','⚽','🎸','🍕','🍩','🍦'] },
    { id: 'hero', name: 'Superqahramonlar', icon: '🦸', items: ['🦸','🦸‍♀️','🦸‍♂️','🦹','🦹‍♀️','🦹‍♂️','🦇','🕷️','🛡️','⚡','💥','🔨','🦾','🧬','🌪️','🔥','❄️','🌀','🦅','🐺','🧲','🕶️','💪','🏹','🧪','🔮','🛰️','🌟'] },
    { id: 'anime', name: 'Anime ruhida', icon: '🥷', items: ['🥷','🗡️','⚔️','🏯','⛩️','🌸','🎎','🎏','🍥','🍜','🍙','🍡','🍱','🐉','🐲','🦊','🐱','👹','👺','🎴','🎐','🎋','🌙','🍵','🏮','🎑','🧧','🐇'] },
    { id: 'cartoon', name: 'Multfilm do\'stlari', icon: '🧸', items: ['🧸','🐻','🐻‍❄️','🐰','🐭','🐥','🐣','🐷','🐸','🦆','🐒','🐘','🦁','🤖','👾','🪀','🎪','🥞','🍯','🧁','🍭','🍬','🎠','🎨','🐞','🐌','🦖','🦕'] },
    { id: 'tale', name: 'Ertak va sehr', icon: '👸', items: ['👸','🤴','🧚','🧚‍♂️','🧜‍♀️','🧜‍♂️','🧝','🧝‍♀️','🧙','🧙‍♀️','🧞','🧛','🪄','🏰','👑','🗝️','🐉','🦄','🐺','🐗','🍎','🕯️','🌹','🔮','🧿','📜','🦢','🐸'] },
    { id: 'myth', name: 'Afsonalar (mifologiya)', icon: '🔱', items: ['🔱','⚡','🏛️','🦅','🐲','🐍','🔥','🦁','🐂','🏺','🗿','🧿','🌋','☀️','🌙','⚓','🏹','🛡️','🗡️','🐴','🦂','🦀','🐺','🦉','🌊','🌳','💀','🏔️'] },
    { id: 'east', name: 'Sharq ertaklari', icon: '🧞', items: ['🧞','🕌','🐪','🐎','🦅','🏹','🍉','🍈','🥘','🧿','🪁','🌙','⭐','🏔️','🐑','🏺','📿','🏜️','🕋','🗝️','🔮','🌴','🦚','👳'] },
    { id: 'space', name: 'Kosmos va robotlar', icon: '👽', items: ['👽','🤖','👾','🛸','🚀','🪐','☄️','🌍','🌟','🔭','🧑‍🚀','👩‍🚀','🛰️','🌌','🌠','🌕','🔋','⚙️','🦾','🦿','💫','🌑'] }
  ];
  const seen = new Set(), ALL = [];
  P.forEach(p => p.items.forEach(a => { if (!seen.has(a)) { seen.add(a); ALL.push(a); } }));
  const api = {
    PACKS: P, ALL,
    ids: P.map(p => p.id),
    /** pack: 'all' yoki to'plam id si → shu to'plamdagi belgilar ro'yxati */
    list(pack) { const p = P.find(x => x.id === pack); return p ? p.items : ALL; },
    valid(pack) { return pack === 'all' || P.some(x => x.id === pack); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.STICKERS = api;
})(typeof self !== 'undefined' ? self : this);
