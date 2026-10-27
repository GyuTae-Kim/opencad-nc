/**
 * 작은 DOM 도움: 요소 만들기(h)와 알림(toast).
 */

type Attr = string | number | boolean | null | undefined;
type Child = Node | string | null | undefined | false;

/**
 * 요소 만들기. 속성 class·html(innerHTML)·text는 특별히 다루고, true는 빈 속성, false·null·undefined는 넣지 않는다.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attr> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

let toastHost: HTMLElement | null = null;

/** 잠깐 보이는 알림(오류는 role=alert). action을 주면 단추 하나(누르면 실행하고 닫는다) */
export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 4000, action?: { label: string; run: () => void }): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  if (action) {
    const act = h('button', { class: 'toast-act', type: 'button' }, action.label);
    act.addEventListener('click', () => {
      el.remove();
      action.run();
    });
    el.append(act);
  }
  const close = h('button', { class: 'toast-x', type: 'button', 'aria-label': '알림 닫기', title: '닫기' }, '×');
  close.addEventListener('click', () => el.remove());
  el.append(close);
  toastHost.append(el);
  while (toastHost.childElementCount > 4) toastHost.firstElementChild?.remove();
  setTimeout(() => el.remove(), ms);
}
