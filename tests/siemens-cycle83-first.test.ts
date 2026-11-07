// Siemens CYCLE83 첫 드릴 깊이 FDEP·FDPR(42차): SINUMERIK 840D sl 사이클 프로그래밍 설명서(6FC5398-3BP20-0BA0, 2006-11)
// 2.1.5절 CYCLE83(52쪽) — "첫 드릴 깊이는 두 매개변수 가운데 하나로 준다. FDPR은 사이클에서 DPR과 같은 구실을 한다",
// 5.3절 사이클 알림(364쪽) — CYCLE83이 "1. drilling depth: according to the value for the relative depth"를 띄운다(DP·DPR의
// "Depth: according to the value for the relative depth"와 같은 꼴). 그래서 둘 다 있으면 상대 값 FDPR로 그리고, FDEP와 다르면 알린다.
// 빠진 매개변수는 0(1.2절 17쪽)이라 FDPR = 0은 적지 않은 것과 같다(FDEP)
import { describe, expect, it } from 'vitest';
import { parseSiemens } from '../src/siemens';
import { moveEnd, type NcProgram } from '../src/model';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
const run = (text: string): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable: { 1: { diameter: 6 } } });
const head = 'G71 G17 G90 T1 D1 S1000 M3 F100\nG0 X0 Y0 Z50\n';
const path = (p: NcProgram): number[][] => Array.from({ length: p.moves.count }, (_, i) => [p.moves.kind[i]!, ...moveEnd(p.moves, i).map(r6), p.moves.feed[i]!]);
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
/** 공구 축(Z) 이송 끝점 가운데 가장 높은 첫 바닥: 첫 쪼기 바닥 */
const firstPeck = (p: NcProgram): number => {
  let prev = Infinity;
  for (let i = 0; i < p.moves.count; i++) {
    const z = moveEnd(p.moves, i)[2]!;
    if (z > prev && prev < 0) return r6(prev);
    prev = z;
  }
  return r6(prev);
};
const call = (fdep: string, fdpr: string, rtp = '10', rfp = '0'): string => `CYCLE83(${rtp}, ${rfp}, 2, -30, , ${fdep}, ${fdpr}, 2, 0, 0, 1, 1)`;
const MSG = 'CYCLE83: FDEP와 FDPR이 달라 FDPR 첫 깊이로 그림';

describe('CYCLE83 첫 드릴 깊이 FDEP·FDPR', () => {
  it('하나만 주면 그대로(41차와 같음): FDEP -5는 첫 쪼기 바닥 -5, FDPR 12는 -12', () => {
    const a = run(head + call('-5', ''));
    expect(firstPeck(a)).toBe(-5);
    expect(warns(a)).toEqual([]);
    const b = run(head + call('', '12'));
    expect(firstPeck(b)).toBe(-12);
    expect(warns(b)).toEqual([]);
  });

  it('둘 다 다르면 FDPR(상대 값)로 그리고 알린다 — 전에는 FDEP', () => {
    const both = run(head + call('-5', '12'));
    expect(path(both)).toEqual(path(run(head + call('', '12'))));
    expect(firstPeck(both)).toBe(-12);
    expect(warns(both)).toEqual([MSG]);
  });

  it('둘 다 같으면 알리지 않고 경로도 FDEP만 준 것과 같다', () => {
    const same = run(head + call('-12', '12'));
    expect(path(same)).toEqual(path(run(head + call('-12', ''))));
    expect(warns(same)).toEqual([]);
  });

  it('FDPR = 0은 적지 않은 것(빠진 매개변수 = 0)이라 FDEP', () => {
    const zero = run(head + call('-5', '0'));
    expect(path(zero)).toEqual(path(run(head + call('-5', ''))));
    expect(warns(zero)).toEqual([]);
  });

  it('후퇴 면이 기준면보다 낮으면(위로 뚫음) 같은 규칙: FDEP와 FDPR이 같으면(기준면에서 후퇴 면 반대쪽) 알리지 않는다', () => {
    // 위로 뚫는 사이클에는 급속 안전 검사 경고가 그대로 붙는다(README 남은 일 — 이 차수와 상관없음). 그 경고는 하나만 준 것과 견준다
    const up = (fdep: string, fdpr: string) => `CYCLE83(-10, 0, 2, 30, , ${fdep}, ${fdpr}, 2, 0, 0, 1, 1)`;
    const fdepOnly = run(head + up('8', ''));
    const same = run(head + up('8', '8'));
    expect(warns(same)).toEqual(warns(fdepOnly));
    expect(warns(same)).not.toContain(MSG);
    expect(path(same)).toEqual(path(fdepOnly));
    const fdprOnly = run(head + up('', '8'));
    const diff = run(head + up('5', '8'));
    expect(path(diff)).toEqual(path(fdprOnly));
    expect(warns(diff).filter((w) => w !== MSG)).toEqual(warns(fdprOnly));
    expect(warns(diff).filter((w) => w === MSG)).toHaveLength(1);
    expect(path(diff)).not.toEqual(path(run(head + up('5', ''))));
  });

  it('MCALL·HOLES는 자리마다 같은 경고 하나로 묶이고, inch(G70)·DP·DPR 경고와 함께 나온다', () => {
    const m = run(head + `MCALL ${call('-5', '12')}\nHOLES1(0, 0, 0, 10, 10, 3)\nMCALL`);
    expect(m.warnings).toEqual([`4번 줄: ${MSG} (모두 3번)`]);
    // mm로 시작한 프로그램이 G70(inch)으로: 값마다 25.4배 — FDEP -0.2와 FDPR 0.5(12.7 mm)
    const inch = run(head + 'G70\nCYCLE83(0.4, 0, 0.1, -1, , -0.2, 0.5, 0.1, 0, 0, 1, 1)');
    expect(firstPeck(inch)).toBe(-12.7);
    expect(warns(inch)).toEqual([MSG]);
    const dp = run(head + 'CYCLE83(10, 0, 2, -20, 30, -5, 12, 2, 0, 0, 1, 1)');
    expect(warns(dp)).toEqual(['CYCLE83: DP와 DPR이 달라 DPR 깊이로 그림', MSG]);
  });
});

describe('번역', () => {
  it('새 경고 글은 네 언어 사전에 있다', () => {
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(MSG, code), code).not.toMatch(/[가-힣]/);
    expect(translate(MSG, 'en')).toBe('CYCLE83: FDEP and FDPR differ — first drilling depth drawn from FDPR');
  });
});
