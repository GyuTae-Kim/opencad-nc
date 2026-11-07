/**
 * SL 사이클 기하(48차, src/sl.ts): 넓이·안쪽 판정(원호 포함)·가공 면 경계·떨어진 곡선·모서리 둥글리기 — 손으로 셈한 작은 도형
 */
import { describe, expect, it } from 'vitest';
import { g7xLine } from '../src/lathe-g7x';
import { slArea, slContains, slDist, slElLen, slInside, slIsPocket, slOffset, slRegion, slReverse, slRound, type SlLoop } from '../src/sl';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
/** 점열(반시계로 적으면 넓이 +)을 닫힌 직선 고리로 */
const poly = (pts: [number, number][]): SlLoop => pts.map((p, i) => g7xLine(p[0], p[1], pts[(i + 1) % pts.length]![0], pts[(i + 1) % pts.length]![1]));
/** 원(중심 cx·cy, 반지름 r) 한 바퀴 — ccw면 반시계, (cx + r, cy)에서 시작 */
const circle = (cx: number, cy: number, r: number, ccw: boolean): SlLoop => [{ arc: true, su: cx + r, sv: cy, eu: cx + r, ev: cy, cu: cx, cv: cy, sweep: ccw ? Math.PI * 2 : -Math.PI * 2 }];
const len = (l: SlLoop): number => l.reduce((s, e) => s + slElLen(e), 0);

describe('SL 기하', () => {
  it('넓이(원호는 활꼴까지)와 안쪽 판정, 포켓·섬(RL 1·RR 2)', () => {
    const sq = poly([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(slArea(sq)).toBe(100);
    expect(slArea(slReverse(sq))).toBe(-100);
    expect(r3(slArea(circle(0, 0, 2, true)))).toBe(r3(Math.PI * 4));
    expect(r3(slArea(circle(0, 0, 2, false)))).toBe(r3(-Math.PI * 4));
    // 반원 + 지름(위쪽 반원, 반시계)
    const half: SlLoop = [g7xLine(-5, 0, 5, 0), { arc: true, su: 5, sv: 0, eu: -5, ev: 0, cu: 0, cv: 0, sweep: Math.PI }];
    expect(r3(slArea(half))).toBe(r3((Math.PI * 25) / 2));
    for (const [u, v, inside] of [
      [0, 4.9, true],
      [0, 5.1, false],
      [4.9, 0.5, true],
      [0, -0.1, false],
      [-4, 2.9, true],
      [-4, 3.1, false],
    ] as const)
      expect(slContains(half, u, v), `${u},${v}`).toBe(inside);
    expect(slIsPocket(sq, 1)).toBe(true);
    expect(slIsPocket(sq, 2)).toBe(false);
    expect(slIsPocket(slReverse(sq), 2)).toBe(true);
    expect(slIsPocket(slReverse(sq), 1)).toBe(false);
    expect(slIsPocket(sq, 0)).toBe(true);
  });

  it('ㄱ자 포켓의 떨어진 곡선: 볼록 모서리는 교점까지, 오목 모서리는 꼭짓점 둘레 반지름 d 호', () => {
    // (0,0)-(60,0)-(60,20)-(20,20)-(20,40)-(0,40): (20,20)이 오목(가공 면 쪽에서 270°)
    const L = poly([
      [0, 0],
      [60, 0],
      [60, 20],
      [20, 20],
      [20, 40],
      [0, 40],
    ]);
    const R = slRegion([{ els: L, pocket: true }]);
    expect(R.loops).toHaveLength(1);
    expect(r3(slArea(R.loops[0]!))).toBe(60 * 20 + 20 * 20);
    const off = slOffset(R, 5);
    expect(off).toHaveLength(1);
    const loop = off[0]!;
    // 꼭짓점 (5,5)·(55,5)·(55,15)·(5,35)·(15,35)과 (20,20) 둘레 반지름 5 호(가공 면 쪽 90°)
    const pts = loop.map((e) => [r3(e.su), r3(e.sv)].join(','));
    for (const q of ['5,5', '55,5', '55,15', '15,35', '5,35']) expect(pts).toContain(q);
    const arcs = loop.filter((e) => e.arc);
    expect(arcs).toHaveLength(1);
    expect([r3(arcs[0]!.cu), r3(arcs[0]!.cv), r3(Math.abs(arcs[0]!.sweep))]).toEqual([20, 20, r3(Math.PI / 2)]);
    // 아래 50 + 오른쪽 10 + 안쪽 위 35 + 호 2.5π + 안쪽 왼쪽 15 + 위 10 + 왼쪽 30
    expect(r3(len(loop))).toBe(r3(150 + 2.5 * Math.PI));
    // 직선 요소 가운데 점은 모두 경계에서 5
    for (const e of loop) if (!e.arc) expect(r3(slDist(R, (e.su + e.eu) / 2, (e.sv + e.ev) / 2))).toBe(5);
    // 다리가 만나는 곳은 더 넓다: 10.5에서는 세 조각(직선 둘 + 오목 꼭짓점 둘레 호) 고리 하나, 안에 드는 가장 큰 원(반지름 20√2/(1+√2) ≈ 11.716)보다 멀면 없음
    const mid = slOffset(R, 10.5);
    expect(mid).toHaveLength(1);
    expect(mid[0]!.map((e) => e.arc)).toEqual([false, true, false]);
    expect(slOffset(R, 11.72)).toEqual([]);
  });

  it('원 포켓 안 원 섬: 떨어진 곡선은 포켓 쪽 원(반지름 − d)과 섬 쪽 원(반지름 + d, 시계) 둘, 겹치면 사라진다', () => {
    const R = slRegion([
      { els: circle(0, 0, 30, false), pocket: true },
      { els: circle(0, 0, 10, true), pocket: false },
    ]);
    expect(slInside(R, 20, 0)).toBe(true);
    expect(slInside(R, 5, 0)).toBe(false);
    expect(slInside(R, 31, 0)).toBe(false);
    const off = slOffset(R, 4);
    expect(off.map((l) => r3(slArea(l))).sort((a, b) => a - b)).toEqual([r3(-Math.PI * 14 * 14), r3(Math.PI * 26 * 26)]);
    expect(slOffset(R, 10.01)).toEqual([]);
  });

  it('왼쪽으로 꺾이는 날카로운 모서리만 둥글린다(Q8)', () => {
    const sq = poly([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const r = slRound(sq, 1, 1e-9);
    expect(r.filter((e) => e.arc)).toHaveLength(4);
    expect(r3(slArea(r))).toBe(r3(100 - 4 + Math.PI));
    // 거꾸로 돈 고리(오른쪽으로 꺾임)는 그대로
    expect(slRound(slReverse(sq), 1, 1e-9).filter((e) => e.arc)).toHaveLength(0);
  });
});
