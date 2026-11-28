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

/** 202차: mixSpan이 담은 원문(알림 상자 조각은 그린 쪽이 다시 그리지 않아 언어를 바꾸면 relangToasts가 이 원문으로 다시 옮긴다) */
const mixSource = new WeakMap<Element, [Mixed, boolean | undefined]>();

/**
 * 파일 글이 섞인 글을 지금 언어로 옮겨 담은 span(번역층은 건너뛴다 — 언어를 바꾸면 그린 쪽이 다시 그린다).
 * ui면 사전 틀이 잡은 앱 글(오류 까닭 등)도 옮긴다(199차 — i18n.ts mixNodes)
 */
export function mixSpan(m: Mixed, cls?: string, ui?: boolean): HTMLSpanElement {
  const el = h('span', { class: cls, 'data-i18n-skip': true }, ...mixNodes(m, ui));
  mixSource.set(el, [m, ui]);
  return el;
}

let toastHost: HTMLElement | null = null;

/**
 * 202차: 언어가 바뀌면(app.ts languagechange) 떠 있는 알림의 그때 언어 조각(mixSpan — 「…: 다시 읽었습니다.」·「읽지 않은 파일: …」·오류 글)을 원문에서 새 언어로 다시 옮긴다.
 * 201차까지는 상자에서 빠질 때(2.5~8초)까지 앞 언어 글이 새 화면 언어 아래 남았다(WCAG 3.1.2). 거두지 않는 까닭: 알림 상자의 글 마디 알림은 번역층이 이미 새 언어로 옮기고
 * (알림 영역 안 글이 바뀜 — 화면 읽기 프로그램에 따라 다시 읽힘, 상태 막대와 같음), 거두면 읽지 못한 알림(문서가 열린 동안 다시 볼 곳이 없는 오류 — 147차)을 잃는다
 */
export function relangToasts(): void {
  for (const el of toastArea().querySelectorAll('[data-i18n-skip]')) {
    const s = mixSource.get(el);
    if (s) el.replaceChildren(...mixNodes(...s));
  }
}

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

/** 208차: 알림이 버튼 누름으로 빠질 때 남은 알림이 없으면 갈 칸들(앱이 정한다 — 차례대로 초점을 받는 첫 칸) */
let spare: () => readonly (HTMLElement | null | undefined)[] = () => [];
export function toastSpare(f: typeof spare): void {
  spare = f;
}

/**
 * 알림 하나를 뗀다. 208차(WCAG 2.4.3): ✕·동작 버튼을 키보드로 누르면 알림째 떼어져 초점이 문서로 빠졌다(HTML focus fixup) — 초점이 그 알림 안이었을 때만 남은 알림 가운데 같은 차례(모자라면 마지막)의
 * 같은 자리 버튼(✕면 ✕, 아니면 첫 버튼 — 176차 판단 띠 꼴), 남은 알림이 없으면 앱이 준 칸 가운데 초점을 받는 첫 칸(207차 꼴 — 숨은·inert 칸은 받지 않는다). 밖이었으면 그대로.
 * 209차: 넷 한도로 빼는 알림도 이 길로(새 알림이 와 초점 든 안내가 빠지면 같은 자리 — 남은 알림의 같은 차례 버튼)
 */
function dropToast(el: Element): void {
  const box = el.parentElement;
  const at = box ? [...box.children].indexOf(el) : -1;
  const had = el.contains(document.activeElement) ? document.activeElement : null;
  el.remove();
  if (!had) return;
  const next = box?.children[Math.min(at, box.childElementCount - 1)];
  for (const to of next ? [next.querySelector<HTMLElement>(had.matches('.toast-x') ? '.toast-x' : 'button')] : spare()) {
    to?.focus({ preventScroll: true });
    if (to && document.activeElement === to) return;
  }
}

/** 잠깐 보이는 알림(오류는 role=alert). 글 조각 목록이면 조각마다 글 마디 하나(번역층이 따로 옮긴다). action을 주면 단추 하나(누르면 실행하고 닫는다) */
export function toast(message: string | readonly (string | Node)[], kind: 'info' | 'error' = 'info', ms = 4000, action?: { label: string; run: () => void }): void {
  const host = toastArea();
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, ...(typeof message === 'string' ? [message] : message));
  const drop = (): void => dropToast(el);
  if (action) {
    const act = h('button', { class: 'toast-act', type: 'button' }, action.label);
    act.addEventListener('click', () => {
      drop();
      action.run();
    });
    el.append(act);
  }
  const close = h('button', { class: 'toast-x', type: 'button', 'aria-label': '알림 닫기', title: '닫기' }, '×');
  close.addEventListener('click', drop);
  el.append(close);
  // 211차: 같은 글의 알림이 떠 있으면 그것을 빼고 새 알림을 붙인다 — 같은 실패를 거듭해도(받지 못한 조각의 다시 시도·같은 버튼 다시 누름) 쌓이지 않고 하나(가장 새 알림으로
  // 새로 읽히고 시간도 새로). 초점이 그 안이었으면 dropToast(208·209차 — 남은 알림의 같은 자리·남는 칸). 붙이기 전 글로 견준다(번역층은 붙인 뒤에 옮긴다)
  const key = (el.dataset.k = kind + el.textContent);
  for (const c of [...host.children]) if ((c as HTMLElement).dataset.k === key) dropToast(c);
  host.append(el);
  // 147차: 넷을 넘으면 가장 오래된 안내(info)부터 뺀다 — 가벼운 안내가 오류(문서가 열린 동안은 다시 볼 곳이 없다)를 밀어내지 않게.
  // 모두 오류면 가장 오래된 것(한도는 늘 지킨다). 오류가 없으면 전과 같다. 209차: 초점이 빼는 알림 안이면 남은 알림의 같은 자리로(dropToast)
  while (host.childElementCount > 4) dropToast((host.querySelector(':scope>.info') ?? host.firstElementChild)!);
  // 157차: 마우스(손가락)가 알림 위에 있거나 초점이 알림 안(동작·닫기 버튼)에 있으면 시간이 되어도 닫지 않고, 떠나면(pointerleave·focusout) 그때부터 다시 ms를 잰다
  // (WCAG 2.2.1 시간 조절 — 연장). 다시 볼 곳이 없는 오류·새 버전 안내를 읽거나 버튼을 누르려는 동안 사라져 초점이 문서로 빠지지 않게. 한도(넷)·✕·동작 버튼은 그대로
  let over = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!over && !el.contains(document.activeElement)) el.remove();
    }, ms);
  };
  el.addEventListener('pointerenter', () => (over = true));
  el.addEventListener('pointerleave', () => {
    over = false;
    later();
  });
  el.addEventListener('focusout', later);
  later();
}

/**
 * 211차: 열 때 받는 조각(동적 가져오기)을 받지 못했다(오프라인에서 새 판과 옛 캐시가 엇갈림·연결 끊김 등) — 글은 「{이름}을(를) 불러오지 못했습니다.」 하나(이름은 그 기능을 여는
 * 탭·메뉴 항목의 글 — 한 기능 한 낱말, 틀이 잡은 이름도 옮긴다)와 「다시 시도」(같은 받기를 다시 — 받지 못한 약속은 비워 둔다). 전에는 console.error만 남아 빈 탭·「불러오는 중…」에
 * 멈춘 탭·열리지 않는 창으로 까닭 없이 보였다(WCAG 3.3.1·4.1.3). body(탭 몸통 — panel.ts waitTab)를 주면 거기에 글(role=alert)과 버튼, 없으면(창 — 단축키 창) 알림 상자의 동작 버튼
 */
export function loadFailed(name: string, retry: () => void, body?: HTMLElement): void {
  const text = mixSpan([`${name}을(를) 불러오지 못했습니다.`], undefined, true);
  if (!body) return toast([text], 'error', 8000, { label: '다시 시도', run: retry });
  const b = h('button', { class: 'btn small', type: 'button' }, '다시 시도');
  b.addEventListener('click', retry);
  body.append(h('p', { class: 'hint', role: 'alert' }, text, ' ', b));
}
