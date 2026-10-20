interface LanguageOption { readonly code: string; readonly label: string }

/** A fixed-size trigger; the list lives outside toolbars so overflow cannot clip it. */
export function createLanguageMenu(options: readonly LanguageOption[], current: string, choose: (code: string) => Promise<void>) {
  const element = document.createElement('div');
  element.className = 'language-control'; element.setAttribute('translate', 'no');
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'language-trigger'; trigger.title = 'Language';
  trigger.setAttribute('aria-label', 'Language'); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/></svg>';
  element.append(trigger);
  const menu = document.createElement('div');
  menu.id = 'language-menu'; trigger.setAttribute('aria-controls', menu.id);
  menu.className = 'language-list'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Language'); menu.setAttribute('translate', 'no');
  const items = options.map(option => {
    const item = document.createElement('button'); item.type = 'button'; item.textContent = option.label; item.lang = option.code; item.dataset.language = option.code;
    item.setAttribute('role', 'menuitemradio'); item.tabIndex = -1;
    item.addEventListener('click', async () => {
      close(true); trigger.disabled = true;
      try { await choose(option.code); } finally { trigger.disabled = false; trigger.focus(); }
    });
    menu.append(item); return item;
  });
  document.body.append(menu);
  const setLanguage = (code: string) => {
    current = code;
    items.forEach(item => item.setAttribute('aria-checked', String(item.dataset.language === code)));
  };
  function close(focus = false) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); }
  function open(index = items.findIndex(item => item.dataset.language === current)) {
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
    menu.style.top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - menu.offsetHeight - 8)) + 'px';
    items[Math.max(0, index)]?.focus();
  }
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); open(event.key === 'ArrowDown' ? 0 : items.length - 1); }
  });
  menu.addEventListener('keydown', event => {
    event.stopPropagation();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Tab') close(true);
  });
  const outside = (event: Event) => { if (!element.contains(event.target as Node) && !menu.contains(event.target as Node)) close(); };
  const escape = (event: KeyboardEvent) => { if (!menu.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } };
  const resize = () => close();
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true); window.addEventListener('resize', resize);
  setLanguage(current);
  return { element, setLanguage, dispose() { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize); menu.remove(); element.remove(); } };
}
