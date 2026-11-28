/**
 * 207·208차 시험 도움: jsdom이 두지 않는 HTML 초점 규칙.
 * jsdom은 초점 든 칸이 문서에서 떼어질 때만 초점을 문서(body)로 돌린다. 브라우저는 inert 안·숨은(hidden) 칸에 focus()를 주지 않고,
 * 초점 든 칸이 숨거나 막히거나(disabled) inert가 되어도 문서로 보낸다(HTML focus fixup rule) — jsdom은 그 칸에 초점을 남겨 둔다.
 * - browserFocus(): HTMLElement.focus를 그 규칙(inert·hidden 안은 받지 않음)으로 감싼다. beforeEach에서 부르고 afterEach의 vi.restoreAllMocks가 푼다.
 * - focused(): 브라우저라면 지금 초점이 있을 칸 — 초점 든 칸이 떼어졌거나 숨은·inert 칸 안이거나 막혔으면 document.body(focus fixup 흉내).
 */
import { vi } from 'vitest';

const realFocus = HTMLElement.prototype.focus;

export function browserFocus(): void {
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, o?: FocusOptions) {
    if (!this.closest('[inert], [hidden]')) realFocus.call(this, o);
  });
}

export function focused(): Element | null {
  const a = document.activeElement;
  if (!a || a === document.body) return a;
  return !a.isConnected || a.closest('[inert], [hidden]') || (a as HTMLButtonElement).disabled === true ? document.body : a;
}
