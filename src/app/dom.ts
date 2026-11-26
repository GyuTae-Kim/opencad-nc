/**
 * 작은 DOM 도움: 요소 만들기(h)와 알림(toast), 파일 글을 담는 요소(fileSpan·mixSpan — 54차).
 */
import type { FileText, Mixed } from './filetext';
import { mixNodes } from './i18n';

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

/** 파일 글 하나(번역층이 옮기지 않는다) */
export const fileSpan = (text: string, cls?: string): HTMLSpanElement => h('span', { class: cls, translate: 'no' }, text);

/** 글 조각 목록 → 마디(앱 글 조각은 번역층이 따로 옮기고, 파일 글 조각은 옮기지 않는다) */
export const pieces = (parts: readonly (string | FileText)[]): (string | Node)[] => parts.map((p) => (typeof p === 'string' ? p : fileSpan(p.file)));

/** 파일 글이 섞인 글을 지금 언어로 옮겨 담은 span(번역층은 건너뛴다 — 언어를 바꾸면 그린 쪽이 다시 그린다) */
export const mixSpan = (m: Mixed, cls?: string): HTMLSpanElement => h('span', { class: cls, 'data-i18n-skip': true }, ...mixNodes(m));

let toastHost: HTMLElement | null = null;

/**
 * 알림 상자(aria-live) — 없거나 문서 밖이면(몸을 간 시험 등) 빈 상자를 body에 새로 붙인다.
 * 156차: 앱을 만들 때 한 번 불러 빈 채로 붙여 둔다(app.ts). 첫 알림 때 상자째 새로 붙이면, 알림 영역은 글이 바뀌기 전부터 접근성 트리에
 * 있어야 하므로 화면 읽기 프로그램에 따라 첫 안내(role=status)를 읽지 않을 수 있었다. 빈 상자는 크기·배경·그림자가 없고 누르기를 통과시킨다(styles.css .toasts)
 */
export function toastArea(): HTMLElement {
  if (!toastHost?.isConnected) {
    toastHost = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  return toastHost;
}

/** 잠깐 보이는 알림(오류는 role=alert). 글 조각 목록이면 조각마다 글 마디 하나(번역층이 따로 옮긴다). action을 주면 단추 하나(누르면 실행하고 닫는다) */
export function toast(message: string | readonly (string | Node)[], kind: 'info' | 'error' = 'info', ms = 4000, action?: { label: string; run: () => void }): void {
  const host = toastArea();
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, ...(typeof message === 'string' ? [message] : message));
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
  host.append(el);
  // 147차: 넷을 넘으면 가장 오래된 안내(info)부터 뺀다 — 가벼운 안내가 오류(문서가 열린 동안은 다시 볼 곳이 없다)를 밀어내지 않게.
  // 모두 오류면 가장 오래된 것(한도는 늘 지킨다). 오류가 없으면 전과 같다
  while (host.childElementCount > 4) (host.querySelector(':scope>.info') ?? host.firstElementChild)?.remove();
  setTimeout(() => el.remove(), ms);
}
