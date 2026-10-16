/**
 * 키 고르기(순수 함수): 눌린 키와 지금 상황으로 할 일을 정한다. 실제 이벤트 처리는 app.ts가 한다.
 *
 * - 캔버스에 초점이 있으면 뷰어가 F·1~7·Esc를 직접 받는다(여기서는 Esc로 고른 것 지우기만 덧붙인다).
 * - 초점이 다른 곳(단추·패널 등)이어도 F·1~7·Esc가 뷰어로 가게 한다. 입력 칸(글·선택 상자)에서는 아무것도 가로채지 않는다.
 * - F7 = 격자, Space = 재생/멈춤(단추에 초점이 있으면 그 단추를 누르게 둔다), Ctrl/⌘+O = 열기.
 */
import type { ViewName } from 'opencad-viewer3d';

/** 숫자 키 → 표준 뷰(뷰어 코어와 같은 배치) */
export const VIEW_KEYS: Readonly<Record<string, ViewName>> = { '1': 'front', '2': 'back', '3': 'left', '4': 'right', '5': 'top', '6': 'bottom', '7': 'seIso' };

export type KeyAction =
  | { type: 'open' }
  | { type: 'fit' }
  | { type: 'view'; view: ViewName }
  /** canvas: 캔버스가 받은 Esc(뷰어가 측정을 지우므로 기본 동작을 막지 않는다) */
  | { type: 'escape'; canvas: boolean }
  | { type: 'grid' }
  | { type: 'play' };

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
  if (c.onCanvas) return c.key === 'Escape' ? { type: 'escape', canvas: true } : null;
  if (c.key === 'f' || c.key === 'F') return { type: 'fit' };
  const view = VIEW_KEYS[c.key];
  if (view) return { type: 'view', view };
  if (c.key === 'Escape') return { type: 'escape', canvas: false };
  return null;
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
