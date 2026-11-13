(() => {
  'use strict';

  const iconFor = new Map([
    ['🎵', 'music'], ['🎼', 'music'], ['🎤', 'mic'], ['🎙', 'mic'], ['🎙️', 'mic'],
    ['🎯', 'quiz'], ['🏆', 'quiz'], ['🎮', 'game'], ['🕹️', 'game'], ['🎲', 'game'], ['🎰', 'game'],
    ['📋', 'attendance'], ['📝', 'homework'], ['✍️', 'homework'], ['📚', 'homework'], ['🧑‍🎓', 'person'],
    ['🧩', 'functions'], ['🤖', 'ai'], ['✨', 'sparkles'], ['💡', 'ai'],
    ['👥', 'people'], ['👤', 'person'], ['📊', 'chart'], ['📈', 'chart'], ['🙂', 'face'],
    ['⚙', 'settings'], ['⚙️', 'settings'], ['📁', 'file'], ['📂', 'file'],
    ['📄', 'file'], ['📕', 'file'], ['📃', 'file'], ['📎', 'file'], ['💾', 'file'],
    ['🔒', 'lock'], ['🔐', 'lock'], ['🛡', 'lock'], ['📤', 'share'], ['📥', 'share'],
    ['▶️', 'play'], ['⏸', 'play'], ['🎬', 'video'], ['🖼️', 'image'], ['🖥', 'video'],
    ['⏱', 'clock'], ['⏰', 'clock'], ['⏳', 'clock'], ['🎧', 'mic'], ['🎚', 'sliders'],
    ['🔔', 'clock'], ['🔊', 'mic'], ['🔈', 'mic'], ['🎙', 'mic'], ['🎙️', 'mic'],
    ['🌐', 'network'], ['📱', 'people'], ['💻', 'video'], ['👁', 'eye'], ['👀', 'people'],
    ['⬇', 'share'], ['⬆', 'upload'], ['✅', 'check'], ['✔', 'check'], ['🚪', 'door'],
    ['🔄', 'refresh'], ['↻', 'refresh'], ['♻️', 'refresh'], ['♻', 'refresh'], ['↩', 'previous'],
    ['🔀', 'shuffle'], ['🎨', 'palette'], ['🗳', 'quiz'],
    ['🏫', 'homework'], ['📤', 'share'], ['💬', 'message'], ['🧠', 'ai'], ['💡', 'ai'],
    ['🔍', 'search'], ['⚡', 'lightning'], ['🏅', 'quiz'], ['🗨', 'message'], ['🗨️', 'message'],
    ['🔢', 'number'], ['🙋', 'person'], ['🙋‍♀️', 'person'], ['🙋‍♂️', 'person'],
    ['⏭', 'next'], ['⏩', 'next'], ['⏮', 'previous'], ['⏪', 'previous'], ['⏹', 'close'],
    ['✖', 'close'], ['✖️', 'close'], ['🗑', 'trash'], ['⚠', 'warning'], ['⚠️', 'warning'], ['⚪', 'live'],
    ['➕', 'plus'], ['🔑', 'key'], ['✏️', 'edit'], ['🔇', 'mute'], ['🔴', 'live'],
    ['🖼', 'image'], ['🙈', 'eye-off'], ['🤝', 'people'], ['ℹ️', 'info'],
    ['🚩', 'flag'], ['🚫', 'lock'], ['📷', 'image'], ['📸', 'image'], ['▶', 'play'],
    ['📍', 'location'], ['👆', 'pointer'], ['🔼', 'next'], ['🆕', 'plus'],
    ['😀', 'face'], ['📢', 'share']
  ]);
  const iconTargets = 'button,summary,h1,h2,h3,h4,label,a,.fi,.grp,.chip,.tab,.chipbtn,.att-nav span,.pn-nav span,.sw > span,.acc > summary > span,#rcStrip > summary > span,.mi,.drawer-head,.fn-btn,.r-status .chip';
  const contentAreas = '#gameWrap,.chat-panel,.chat-msg,.qopt,.qz-q,.sticker,.sticker-pack,.av,.reactbar,#reactBar,#pollQShow,[contenteditable="true"]';
  const emojiPrefix = /^(\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)\s*/u;

  function decorate(el) {
    if (!(el instanceof Element) || !el.matches(iconTargets) || el.closest(contentAreas)) return;
    for (const node of [...el.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const match = node.nodeValue.match(emojiPrefix);
      if (!match) continue;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'premium-icon auto-icon');
      icon.setAttribute('aria-hidden', 'true');
      const symbol = iconFor.get(match[1]);
      if (!symbol) continue;
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#i-${symbol}`);
      icon.append(use);
      node.nodeValue = node.nodeValue.slice(match[0].length);
      el.insertBefore(icon, node);
    }
  }

  function scan(root) {
    if (root instanceof Element) decorate(root);
    root.querySelectorAll?.(iconTargets).forEach(decorate);
  }

  scan(document);
  new MutationObserver(records => records.forEach(record => {
    record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      else if (node.nodeType === Node.TEXT_NODE) decorate(node.parentElement);
    });
  })).observe(document.body, { childList: true, subtree: true });
})();
