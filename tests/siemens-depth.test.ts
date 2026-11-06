// Siemens 사이클 깊이 DP·DPR(41차): SINUMERIK 840D sl 사이클 프로그래밍 설명서(6FC5398-3BP20-0BA0, 2006-11) 2.1.3절 CYCLE81(44쪽) —
// 상대 깊이 DPR은 후퇴 면·기준면의 자리로 방향을 셈(기준면에서 후퇴 면 반대쪽으로), 둘 다 있으면 DPR이고 DP와 다르면 알린다.
// 빠진 매개변수는 0(1.2절 17쪽)이라 DPR = 0은 적지 않은 것과 같다. CYCLE82~89·840·LONGHOLE은 CYCLE81 설명을 가리킨다(47~85·114쪽)
import { describe, expect, it } from 'vitest';
import { parseSiemens } from '../src/siemens';
import { FLAG_CYCLE, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const run = (text: string): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable: { 1: { diameter: 10 } } });
const head = 'G71 G17 G90 T1 D1 S1000 M3 F100\nG0 X0 Y0 Z50\n';
/** 구멍마다 [R 점 높이, 바닥 높이](공구 축 Z) */
const holes = (p: NcProgram): number[][] => Array.from({ length: p.holes.count }, (_, h) => [r3(p.holes.top[h * 3 + 2]!), r3(p.holes.bottom[h * 3 + 2]!)]);
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
/** 사이클 이송(급속 아닌) 끝점의 가장 낮은 Z */
const floor = (p: NcProgram): number => {
  let z = Infinity;
  for (let i = 0; i < p.moves.count; i++) if (p.moves.flags[i]! & FLAG_CYCLE && p.moves.kind[i] !== MOVE_RAPID) z = Math.min(z, moveEnd(p.moves, i)[2]!);
  return r3(z);
};
const all = (p: NcProgram): number[][] => Array.from({ length: p.moves.count }, (_, i) => [p.moves.kind[i]!, ...moveEnd(p.moves, i).map(r3), p.moves.feed[i]!]);
const DRILLS = ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89'];

describe('드릴 사이클 상대 깊이 DPR의 방향', () => {
  it('후퇴 면이 기준면 위면 아래로, 아래면 위로(후퇴 면 반대쪽) — CYCLE81~89·840 모두', () => {
    expect(holes(run(head + 'CYCLE81(10, 0, 2, , 12)'))).toEqual([[2, -12]]);
    for (const name of DRILLS) {
      const p = run(head + `${name}(-10, 0, 2, , 12)`);
      expect(holes(p), name).toEqual([[-2, 12]]);
      expect(warns(p).filter((w) => w.includes('DPR')), name).toEqual([]);
    }
    // 기준면이 0이 아니어도 기준면에서 잰다
    expect(holes(run(head + 'CYCLE82(-5, 40, 1, , 15, 1)'))).toEqual([[39, 55]]);
  });

  it('MCALL·HOLES 자리마다, 기울인 프레임(ROT X)에서도 같은 규칙', () => {
    const p = run(head + 'MCALL CYCLE81(-10, 0, 2, , 12)\nHOLES1(0, 0, 0, 10, 10, 3)\nMCALL');
    expect(holes(p)).toEqual([
      [-2, 12],
      [-2, 12],
      [-2, 12],
    ]);
    const tilt = run('G71 G17 G90 T1 D1 S1000 M3 F100\nG0 X0 Y0 Z10\nROT X90\nCYCLE81(-10, 0, 2, , 12)\nROT');
    // 기울인 평면: 프로그램 Z 12는 표시 좌표 -Y 12
    expect(r3(tilt.holes.bottom[1]!)).toBe(-12);
  });
});

describe('DP·DPR이 둘 다 있으면 DPR', () => {
  it('CYCLE81~89·840: DPR 깊이로 그리고, DP와 다르면 알린다(설명서: "Depth: Corresponding to value for relative depth")', () => {
    for (const name of DRILLS) {
      const p = run(head + `${name}(10, 0, 2, -5, 12)`);
      expect(holes(p), name).toEqual([[2, -12]]);
      // CYCLE88은 휴지 뒤 수동 복귀 경고가 하나 더(전과 같음)
      expect(warns(p).filter((w) => w.includes('DPR')), name).toEqual([`${name}: DP와 DPR이 달라 DPR 깊이로 그림`]);
    }
    // 같으면 알리지 않고, 후퇴 면이 아래면 DPR도 위로
    const same = run(head + 'CYCLE81(10, 0, 2, -12, 12)');
    expect(holes(same)).toEqual([[2, -12]]);
    expect(warns(same)).toEqual([]);
    const low = run(head + 'CYCLE81(-10, 0, 2, 5, 12)');
    expect(holes(low)).toEqual([[-2, 12]]);
    expect(warns(low)).toContain('CYCLE81: DP와 DPR이 달라 DPR 깊이로 그림');
  });

  it('DPR = 0은 적지 않은 것(빠진 매개변수 = 0)이라 DP — DP도 없으면 기준면, 둘 다 없으면 그리지 않음', () => {
    const zero = run(head + 'CYCLE81(10, 0, 2, -5, 0)');
    expect(holes(zero)).toEqual([[2, -5]]);
    expect(warns(zero)).toEqual([]);
    expect(holes(run(head + 'CYCLE81(10, 0, 2, , 0)'))).toEqual([[2, 0]]);
    const none = run(head + 'CYCLE81(10, 0, 2)');
    expect(none.holes.count).toBe(0);
    expect(warns(none)).toEqual(['CYCLE81에 깊이(DP·DPR)가 없음']);
  });

  it('CYCLE83 쪼기도 DPR 깊이까지, MCALL·HOLES는 자리마다 같은 경고 하나로 묶임, inch(G70)도 같음', () => {
    const peck = run(head + 'CYCLE83(10, 0, 2, -30, 12, , 5, , 0, 0, 1, 1)');
    expect(holes(peck)).toEqual([[2, -12]]);
    const m = run(head + 'MCALL CYCLE82(10, 0, 2, -5, 8, 1)\nHOLES2(0, 0, 20, 0, 90, 4)\nMCALL');
    expect(holes(m).map((h) => h[1])).toEqual([-8, -8, -8, -8]);
    expect(m.warnings).toEqual(['4번 줄: CYCLE82: DP와 DPR이 달라 DPR 깊이로 그림 (모두 4번)']);
    // mm로 시작한 프로그램이 G70(inch)으로 바꾼 뒤: 값마다 25.4배
    const inch = run(head + 'G70\nCYCLE81(0.4, 0, 0.1, -0.2, 0.5)');
    expect(holes(inch)).toEqual([[2.54, -12.7]]);
    expect(warns(inch)).toEqual(['CYCLE81: DP와 DPR이 달라 DPR 깊이로 그림']);
  });

  it('LONGHOLE·SLOT1·SLOT2: DPR로 그리던 그대로 두고 DP와 다르면 알린다, DPR = 0이면 DP', () => {
    const calls: [string, (dp: string, dpr: string) => string][] = [
      ['LONGHOLE', (dp, dpr) => `LONGHOLE(5, 0, 1, ${dp}, ${dpr}, 2, 30, 0, 0, 20, 0, 0, 100, 320, 6)`],
      ['SLOT1', (dp, dpr) => `SLOT1(5, 0, 1, ${dp}, ${dpr}, 2, 30, 15, 0, 0, 20, 0, 0, 100, 320, 6, 2, 0.5, 1)`],
      ['SLOT2', (dp, dpr) => `SLOT2(5, 0, 1, ${dp}, ${dpr}, 2, 70, 15, 0, 0, 42, 0, 0, 100, 320, 6, 2, 0.5, 1)`],
    ];
    for (const [name, call] of calls) {
      const only = run(head + call('', '12'));
      expect(floor(only), name).toBe(-12);
      expect(warns(only), name).toEqual([]);
      const both = run(head + call('-8', '12'));
      expect(all(both), name).toEqual(all(only));
      expect(warns(both), name).toEqual([`${name}: DP와 DPR이 달라 DPR 깊이로 그림`]);
      expect(warns(run(head + call('-12', '12'))), name).toEqual([]);
      // DPR = 0을 적어도 DP(전에는 기준면 깊이 0으로 그림)
      const zero = run(head + call('-8', '0'));
      expect(floor(zero), name).toBe(-8);
      expect(all(zero), name).toEqual(all(run(head + call('-8', ''))));
    }
  });
});

describe('번역', () => {
  it('새 경고 글은 네 언어 사전에 있다', () => {
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate('CYCLE83: DP와 DPR이 달라 DPR 깊이로 그림', code), code).not.toMatch(/[가-힣]/);
    expect(translate('SLOT1: DP와 DPR이 달라 DPR 깊이로 그림', 'en')).toBe('SLOT1: DP and DPR differ — drawn to the DPR depth');
  });
});
