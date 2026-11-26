// @vitest-environment jsdom
/**
 * 147차: 알림 상자(dom.ts toast)는 넷까지 — 넘으면 가장 오래된 안내(info)부터 빼서, 가벼운 안내가 오류(role=alert — 문서가 열린 동안의
 * 열기 오류·그림 저장 실패 등은 다시 볼 곳이 없다)를 밀어내지 않는다. 모두 오류면 가장 오래된 것(한도는 늘 지킨다), 오류가 없으면 전과 같다.
 * 저마다의 시간에 닫히는 것은 그대로.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, toastArea } from '../../src/app/dom';

/** 떠 있는 알림마다 [첫 마디 글(닫기 버튼 글은 빼고), 종류] */
const shown = (): [string, string][] =>
  [...document.querySelectorAll('.toasts > .toast')].map((t) => [t.firstChild?.textContent ?? '', t.classList.contains('error') ? 'error' : 'info']);

describe('알림 상자 한도(147차)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // 남은 알림은 제 시간에 닫힌다 — 다음 시험이 빈 상자에서 시작
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('오류가 떠 있는 동안 안내가 넷 넘게 와도 오류는 남고 가장 오래된 안내가 빠진다(오류는 제 시간에 닫힘)', () => {
    const E = '그림을 저장하지 못했습니다: 그림을 만들지 못했습니다';
    const A = '이 줄은 이동을 만들지 않습니다.';
    const B = '지금 화면을 PNG로 저장했습니다.';
    const C = '해석 경고 3개 — 패널의 "정보" 탭에서 볼 수 있습니다.';
    const D = '읽기를 멈췄습니다.';
    const F = '최근 문서를 모두 지웠습니다.';
    toast(E, 'error');
    expect(document.querySelector('.toast.error')!.getAttribute('role')).toBe('alert');
    toast(A, 'info', 2500);
    toast(B, 'info', 2500);
    toast(C, 'info', 4500);
    expect(shown()).toEqual([[E, 'error'], [A, 'info'], [B, 'info'], [C, 'info']]);
    toast(D, 'info', 3000);
    expect(shown()).toEqual([[E, 'error'], [B, 'info'], [C, 'info'], [D, 'info']]);
    toast(F, 'info', 2500);
    expect(shown()).toEqual([[E, 'error'], [C, 'info'], [D, 'info'], [F, 'info']]);
    // 4초 뒤: 오류(4초)·D(3초)·F(2.5초)는 제 시간에 닫히고 C(4.5초)만
    vi.advanceTimersByTime(4000);
    expect(shown()).toEqual([[C, 'info']]);
  });

  it('오류가 없거나 오류가 가장 새것이면 전과 같이 가장 오래된 것부터 뺀다', () => {
    for (const n of [1, 2, 3, 4, 5]) toast(`안내 ${n}`, 'info', 2500);
    expect(shown()).toEqual([2, 3, 4, 5].map((n) => [`안내 ${n}`, 'info']));
    toast('오류 R', 'error');
    expect(shown()).toEqual([['안내 3', 'info'], ['안내 4', 'info'], ['안내 5', 'info'], ['오류 R', 'error']]);
  });

  it('모두 오류면 새 안내가 오류를 밀어내지 않고(곧 빠짐), 새 오류는 가장 오래된 오류를 밀어낸다(한도 넷)', () => {
    for (const n of [1, 2, 3, 4]) toast(`오류 ${n}`, 'error', 8000);
    toast('안내 N', 'info', 2500);
    expect(shown()).toEqual([1, 2, 3, 4].map((n) => [`오류 ${n}`, 'error']));
    toast('오류 5', 'error', 8000);
    expect(shown()).toEqual([2, 3, 4, 5].map((n) => [`오류 ${n}`, 'error']));
  });
});

/**
 * 156차: 알림 상자(aria-live)는 앱을 만들 때 빈 채로 붙여 둔다(app.ts가 toastArea를 부름) — 첫 알림 때 상자째 새로 붙이면 새 알림 영역의 첫 글이라
 * 화면 읽기 프로그램이 읽지 않을 수 있었다. 상자가 문서 밖이면(몸을 간 시험 등) 새 빈 상자를 붙인다.
 */
describe('알림 상자를 앱을 만들 때 빈 채로 붙여 두기(156차)', () => {
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('빈 상자(aria-live)는 하나만 붙고 첫 알림은 그 상자에 든다 — 상자가 문서 밖이 되면 새 빈 상자에 알림이 든다', () => {
    vi.useFakeTimers();
    const host = toastArea();
    expect([host.parentElement, host.className, host.getAttribute('aria-live'), host.childElementCount, host.textContent]).toEqual([document.body, 'toasts', 'polite', 0, '']);
    expect(toastArea()).toBe(host);
    expect(document.querySelectorAll('.toasts')).toHaveLength(1);
    toast('지금 화면을 PNG로 저장했습니다.', 'info', 2500);
    expect(document.querySelector('.toast')!.parentElement).toBe(host);
    // 몸을 갈면 모듈의 상자는 문서 밖 — 새 빈 상자를 붙이고 알림은 그 상자로(문서 밖 상자로 가 보이지 않던 것)
    document.body.innerHTML = '';
    const next = toastArea();
    expect(next).not.toBe(host);
    expect([next.isConnected, next.childElementCount]).toEqual([true, 0]);
    toast('읽기를 멈췄습니다.', 'info', 3000);
    expect(next.parentElement).toBe(document.body);
    expect(shown()).toEqual([['읽기를 멈췄습니다.', 'info']]);
  });
});

/**
 * 157차: 마우스(손가락)가 알림 위에 있거나 초점이 알림 안(동작·닫기 버튼)에 있으면 시간이 되어도 닫지 않고, 떠나면 그때부터 다시 잰다(WCAG 2.2.1 시간 조절 — 연장).
 * 전에는 저마다의 시간이 되면 그대로 닫혀, 다시 볼 곳이 없는 오류·새 버전 안내를 읽거나 버튼을 누르려는 동안 사라지고 초점이 문서로 빠졌다.
 */
describe('알림 위에 마우스가 있거나 초점이 안에 있으면 닫지 않기(157차)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('마우스가 올라 있는 동안은 시간이 지나도 남고, 떠나면 그때부터 제 시간(2.5초) 뒤 닫힌다', () => {
    const A = '이 줄은 이동을 만들지 않습니다.';
    toast(A, 'info', 2500);
    const el = document.querySelector<HTMLElement>('.toasts > .toast')!;
    vi.advanceTimersByTime(2000);
    el.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(10_000);
    expect(shown()).toEqual([[A, 'info']]);
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(2499);
    expect(shown()).toEqual([[A, 'info']]);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
  });

  it('키보드 초점이 동작·닫기 버튼에 있는 동안은 남아 초점을 지키고, 알림 밖으로 나가면 그때부터 제 시간 뒤 닫힌다', () => {
    const outside = document.body.appendChild(document.createElement('button'));
    let applied = 0;
    toast('새 버전이 있습니다.', 'info', 60_000, { label: '새로 고침', run: () => applied++ });
    const el = document.querySelector<HTMLElement>('.toasts > .toast')!;
    const [act, close] = [...el.querySelectorAll('button')];
    act!.focus();
    vi.advanceTimersByTime(60_000);
    expect(el.isConnected).toBe(true);
    expect(document.activeElement).toBe(act);
    // 알림 안에서 옮겨도(동작 → 닫기) 그대로
    close!.focus();
    vi.advanceTimersByTime(60_000);
    expect(el.isConnected).toBe(true);
    expect(document.activeElement).toBe(close);
    // 알림 밖으로 나가면 그때부터 60초
    outside.focus();
    vi.advanceTimersByTime(59_999);
    expect(el.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect([el.isConnected, applied]).toEqual([false, 0]);
    outside.remove();
  });
});
