/**
 * 키 고르기(순수 함수): 눌린 키와 지금 상황으로 할 일을 정한다. 실제 이벤트 처리는 app.ts가 한다.
 *
 * - 뷰어 키(F 전체 보기, 1~7 표준 뷰, Esc 측정 지우기)의 규칙은 뷰어 코어가 가진다(Viewer3d.handleKey).
 *   캔버스에 초점이 있으면 뷰어가 직접 받고, 초점이 다른 곳(단추·패널 등)이면 앱이 창 키를 handleKey로 넘긴다.
 * - 입력 칸(글·선택 상자)에서는 아무것도 가로채지 않는다.
 * - 앱 키: F7 = 격자, Space = 재생/멈춤(단추에 초점이 있으면 그 단추를 누르게 둔다), Ctrl/⌘+O = 열기,
 *   Esc = (측정 중이면 측정 먼저) 고른 것 지우기.
 */
import { VIEW_KEYS, type ViewName } from 'opencad-viewer3d';

export type KeyAction =
  | { type: 'open' }
  | { type: 'grid' }
  | { type: 'play' }
  /** 캔버스 밖의 키를 뷰어 규칙(handleKey)으로 넘긴다 — 뷰어가 받지 않는 키면 아무 일도 없다 */
  | { type: 'viewer' }
  /**
   * Esc의 앱 쪽 처리. canvas: 캔버스가 받은 Esc(뷰어가 스스로 측정을 지우므로 앱은 측정 중이 아닐 때 고른 것만 지운다).
   * 캔버스 밖이면 측정 중일 때 handleKey로 측정을 먼저 지우고(점이 없으면 측정을 끈다), 아니면 고른 것을 지운다.
   */
  | { type: 'escape'; canvas: boolean };

export interface KeyContext {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  /** 글을 넣는 곳(input·textarea·select·contenteditable)에 초점 */
  editable: boolean;
  /** 초점이 단추 */
  onButton: boolean;
  /** 초점이 뷰어 캔버스 */
  onCanvas: boolean;
  /** 열린 문서가 있음 */
  hasDoc: boolean;
  /** 재생할 수 있음(G-code·Heidenhain이고 이동이 있음) */
  canPlay: boolean;
}

export function keyAction(c: KeyContext): KeyAction | null {
  const mod = c.ctrl || c.meta;
  if (c.editable) return null;
  if (mod && !c.alt && (c.key === 'o' || c.key === 'O')) return { type: 'open' };
  if (mod || c.alt) return null;
  if (!c.hasDoc) return null;
  if (c.key === 'F7') return { type: 'grid' };
  if (c.key === ' ' || c.key === 'Spacebar') return c.canPlay && !c.onButton ? { type: 'play' } : null;
  if (c.key === 'Escape') return { type: 'escape', canvas: c.onCanvas };
  return c.onCanvas ? null : { type: 'viewer' };
}

/** 표준 뷰 → 숫자 키(메뉴 글용, 코어 VIEW_KEYS를 뒤집은 것). 키가 없는 뷰는 undefined */
export function viewKeyOf(view: ViewName): string | undefined {
  for (const [k, v] of Object.entries(VIEW_KEYS)) if (v === view) return k;
  return undefined;
}

/** 초점 요소가 글 입력 칸인지(범위 막대·체크 상자·단추형 input은 아니다) */
export function isEditableTarget(t: { tagName?: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t.type ?? 'text').toLowerCase();
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(type);
  }
  return !!t.isContentEditable;
}
