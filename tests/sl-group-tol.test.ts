/**
 * SL 옆 간격 고리의 윤곽 무리마다 길이 허용(60차 — src/sl.ts loopGroups·offsetGroup). 모두 직접 만든 합성 도형.
 * 잇기 허용·판정 여유는 크기 × 10⁻⁶·10⁻⁹인데 59차까지는 크기가 가공 면 전체(모든 윤곽 둘레 상자 대각선)라, 멀리 떨어진 윤곽이 함께 있으면
 * 작은 윤곽에는 허용이 커서 조각이 잇기 허용보다 짧은 가운데 단계의 고리가 잘게 엉킨 잔 고리로 남았다(59차 남은 일 — 원꼴 다각형 + 멀리 떨어진
 * 작은 포켓 400경우 가운데 39경우). 이제 경계 고리 둘레 상자를 d + 잇기 허용만큼 키워 겹치지 않는 무리는 그 무리 크기의 허용으로 따로 셈한다:
 * 무리마다 그 윤곽만 따로 셈한 것과 단계·고리·요소가 같고, 고리 차례는 한 번에 셈할 때처럼 경계 고리 차례다
 */
import { describe, expect, it } from 'vitest';
import { g7xLine } from '../src/lathe-g7x';
import { slLevels, slRegion, slElLen, type SlLoop } from '../src/sl';

const poly = (pts: [number, number][]): SlLoop => pts.map((s, k) => g7xLine(s[0], s[1], pts[(k + 1) % pts.length]![0], pts[(k + 1) % pts.length]![1]));
/** 시계 방향 사각(포켓 — 섬은 거꾸로) */
const rect = (u0: number, v0: number, u1: number, v1: number): [number, number][] => [
  [u0, v0],
  [u0, v1],
  [u1, v1],
  [u1, v0],
];
const loopLen = (l: SlLoop): number => l.reduce((s, e) => s + slElLen(e), 0);

describe('윤곽 무리마다 길이 허용(60차)', () => {
  // 59차 탐색 3의 한 경우: 반지름 25 원꼴 400각형(꼭짓점 소수 넷째 자리 반올림, 시계) + 30000 떨어진 10 × 10 포켓, d0 1·간격 0.4
  const N = 400;
  const q = (x: number): number => Number(x.toFixed(4));
  const circle = poly([...Array(N).keys()].map((k) => [q(50 + 25 * Math.cos((-k / N) * Math.PI * 2)), q(50 + 25 * Math.sin((-k / N) * Math.PI * 2))]));
  const far = poly(rect(30000, 0, 30010, 10));

  it('멀리 떨어진 포켓과 함께여도 원꼴 포켓의 단계마다 고리는 그 포켓만 셈한 것과 같다 — 가운데 단계에 잔 고리가 남지 않는다', () => {
    const both = slLevels(slRegion([{ els: circle, pocket: true }, { els: far, pocket: true }]), 1, 0.4, 2000);
    const a = slLevels(slRegion([{ els: circle, pocket: true }]), 1, 0.4, 2000);
    const b = slLevels(slRegion([{ els: far, pocket: true }]), 1, 0.4, 2000);
    expect([both.capped, a.capped, b.capped]).toEqual([false, false, false]);
    expect(a.levels.length).toBe(60);
    expect(b.levels.length).toBe(10);
    expect(both.levels.length).toBe(60);
    // 단계마다 원꼴 포켓 고리(경계 고리 0) 다음 먼 포켓 고리(경계 고리 1) — 요소까지 같다
    both.levels.forEach((ls, k) => expect(ls, `단계 ${k}`).toEqual([...a.levels[k]!, ...(b.levels[k] ?? [])]));
    // 가운데 단계(d 24.6 — 원꼴 포켓 혼자의 마지막 단계)는 작은 고리 하나(59차까지는 함께 셈하면 잇기 허용 0.03보다 짧은 조각이 엉켜 잔 고리 506개)
    const last = both.levels[59]!;
    expect(last.length).toBe(1);
    expect(loopLen(last[0]!)).toBeGreaterThan(1);
  });

  it('무리를 따로 셈해도 고리 차례는 경계 고리 차례 — 섬이 있는 포켓(경계 고리 0·2)과 먼 포켓(경계 고리 1)', () => {
    const P0 = poly(rect(0, 0, 100, 100));
    const I0 = poly(rect(40, 40, 60, 60).reverse() as [number, number][]);
    const P1 = poly(rect(1000, 0, 1100, 100));
    const both = slLevels(slRegion([{ els: P0, pocket: true }, { els: P1, pocket: true }, { els: I0, pocket: false }]), 5, 10, 100);
    const a = slLevels(slRegion([{ els: P0, pocket: true }, { els: I0, pocket: false }]), 5, 10, 100);
    const b = slLevels(slRegion([{ els: P1, pocket: true }]), 5, 10, 100);
    expect(a.levels.map((l) => l.length)).toEqual([2, 2]);
    expect(b.levels.map((l) => l.length)).toEqual([1, 1, 1, 1, 1]);
    // 포켓 P0 둘레 고리, 먼 포켓 P1 고리, 섬 I0 둘레 고리 차례(한 번에 셈할 때의 시작 조각 차례)
    expect(both.levels).toEqual([
      [a.levels[0]![0]!, b.levels[0]![0]!, a.levels[0]![1]!],
      [a.levels[1]![0]!, b.levels[1]![0]!, a.levels[1]![1]!],
      ...b.levels.slice(2),
    ]);
    // 고리마다 가장 작은 u: P0 둘레 5, P1 1005, 섬 I0 둘레 35
    expect(both.levels[0]!.map((l) => Math.round(Math.min(...l.map((e) => e.su))))).toEqual([5, 1005, 35]);
  });

  it('둘레 상자가 d 안에서 겹치는 윤곽은 한 무리(예전 길) — 섬이 포켓과 맞닿는 단계', () => {
    // 10 떨어진 두 포켓: d 1은 따로(무리 둘), d 6부터 한 무리 — 어느 쪽이든 두 포켓 고리 둘
    const L = slLevels(slRegion([{ els: poly(rect(0, 0, 40, 40)), pocket: true }, { els: poly(rect(50, 0, 90, 40)), pocket: true }]), 1, 5, 100);
    expect(L.levels.map((l) => l.length)).toEqual([2, 2, 2, 2]);
    for (const ls of L.levels) expect(ls.map((l) => Math.round(l.reduce((s, e) => s + e.su, 0) / l.length / 50))).toEqual([0, 1]);
  });
});

describe('둘레 상자가 겹쳐도 떨어진 윤곽은 따로(61차 — 고리 사이 가장 짧은 거리)', () => {
  // 원꼴 400각형(꼭짓점 소수 넷째 자리 반올림, 시계) — 반지름 25, 가운데 (cx, cy)
  const N = 400;
  const q = (x: number): number => Number(x.toFixed(4));
  const circle = (cx: number, cy: number): [number, number][] => [...Array(N).keys()].map((k) => [q(cx + 25 * Math.cos((-k / N) * Math.PI * 2)), q(cy + 25 * Math.sin((-k / N) * Math.PI * 2))]);
  // ㄴ자 큰 포켓(시계) — 둘레 상자 30000 × 30000, 오목한 자리 [10000, 30000]²
  const ell: [number, number][] = [
    [0, 0],
    [0, 30000],
    [10000, 30000],
    [10000, 10000],
    [30000, 10000],
    [30000, 0],
  ];

  it('ㄴ자 포켓의 오목한 자리(둘레 상자 안, 포켓 밖)에 있는 작은 원꼴 포켓은 큰 포켓의 허용을 물려받지 않는다 — 단계마다 따로 셈과 같다', () => {
    const big = poly(ell);
    const small = poly(circle(20000, 20000));
    const both = slLevels(slRegion([{ els: big, pocket: true }, { els: small, pocket: true }]), 1, 0.4, 60);
    const a = slLevels(slRegion([{ els: big, pocket: true }]), 1, 0.4, 60);
    const b = slLevels(slRegion([{ els: small, pocket: true }]), 1, 0.4, 60);
    expect(b.levels.length).toBe(60);
    expect(both.levels.length).toBe(60);
    both.levels.forEach((ls, k) => expect(ls, `단계 ${k}`).toEqual([...a.levels[k]!, ...b.levels[k]!]));
    // 원꼴 포켓의 가운데 단계(d 24.6)는 작은 고리 하나(60차까지는 상자가 겹쳐 한 무리 — 잇기 허용 0.04보다 짧은 조각이 잔 고리로)
    const last = both.levels[59]!.filter((l) => Math.min(...l.map((e) => e.su)) > 19000);
    expect(last.length).toBe(1);
    expect(loopLen(last[0]!)).toBeGreaterThan(1);
  });

  it('큰 포켓 안의 작은 섬도 고리 사이가 멀면 섬만 셈한 것과 같다 — 고리 차례는 경계 고리 차례(포켓 고리 다음 섬 고리)', () => {
    const P = poly(rect(0, 0, 30000, 30000));
    const I = poly(circle(15000, 15000).reverse() as [number, number][]);
    const both = slLevels(slRegion([{ els: P, pocket: true }, { els: I, pocket: false }]), 1, 5, 20);
    const a = slLevels(slRegion([{ els: P, pocket: true }]), 1, 5, 20);
    const b = slLevels(slRegion([{ els: I, pocket: false }]), 1, 5, 20);
    expect(both.levels.length).toBe(20);
    both.levels.forEach((ls, k) => expect(ls, `단계 ${k}`).toEqual([...a.levels[k]!, ...b.levels[k]!]));
  });

  it('고리 사이가 2d + 잇기 허용 안으로 들면 한 무리 — 섬 둘레 곡선과 포켓 벽 곡선이 서로 지나 네 귀퉁이 고리로 나뉜다', () => {
    // 포켓 벽과 섬 사이 40: d 1·6·11·16은 고리 둘(포켓 벽 쪽 하나와 섬 둘레 하나), d 21(2d > 40)은 두 곡선이 서로 지나 귀퉁이마다 고리 하나
    const L = slLevels(slRegion([{ els: poly(rect(0, 0, 100, 100)), pocket: true }, { els: poly(rect(40, 40, 60, 60).reverse() as [number, number][]), pocket: false }]), 1, 5, 100);
    expect(L.levels.map((l) => l.length)).toEqual([2, 2, 2, 2, 4]);
    expect(L.capped).toBe(false);
  });

  it('맞닿은 고리(거리 0)는 한 무리 — 사각 포켓 두 개의 원호 없는 꼭짓점 닿음', () => {
    const L = slLevels(slRegion([{ els: poly(rect(0, 0, 40, 40)), pocket: true }, { els: poly(rect(40, 40, 80, 80)), pocket: true }]), 1, 5, 100);
    expect(L.levels.length).toBeGreaterThan(1);
    for (const ls of L.levels) expect(ls.length).toBeLessThanOrEqual(2);
  });
});
