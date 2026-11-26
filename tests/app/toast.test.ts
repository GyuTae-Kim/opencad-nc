// @vitest-environment jsdom
/**
 * 147차: 알림 상자(dom.ts toast)는 넷까지 — 넘으면 가장 오래된 안내(info)부터 빼서, 가벼운 안내가 오류(role=alert — 문서가 열린 동안의
 * 열기 오류·그림 저장 실패 등은 다시 볼 곳이 없다)를 밀어내지 않는다. 모두 오류면 가장 오래된 것(한도는 늘 지킨다), 오류가 없으면 전과 같다.
 * 저마다의 시간에 닫히는 것은 그대로.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../../src/app/dom';

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
