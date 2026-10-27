/**
 * 깎인 소재 그물의 매끈한 음영(마디 법선)과 벽 문턱, 영역 내리기(짝홀 규칙)·판 밖 색.
 * 격자 21 × 21 마디, 간격 1 — 문턱은 높이 차 > 1 × WALL_SLOPE(2.5).
 */
import { describe, expect, it } from 'vitest';
import { HeightGrid, MARK_OUTSIDE, type GridSpec, type SimRegions } from '../src/sim/grid';
import { STOCK_RGB, WALL_SLOPE, buildTile, gridOrigin, tileNormals } from '../src/sim/mesh';

const SPEC: GridSpec = { x0: 0, y0: 0, nx: 21, ny: 21, dx: 1, dy: 1, top: 0, bottom: -20 };

function gridWith(f: (i: number, j: number) => number): HeightGrid {
  const g = new HeightGrid(SPEC);
  for (let j = 0; j < SPEC.ny; j++) for (let i = 0; i < SPEC.nx; i++) g.h[j * SPEC.nx + i] = f(i, j);
  return g;
}
/** 마디 법선(−0은 0으로) */
const normalAt = (n: Float32Array, i: number, j: number): number[] => [...n.subarray((j * SPEC.nx + i) * 3, (j * SPEC.nx + i) * 3 + 3)].map((v) => v + 0);

describe('마디 법선과 벽 문턱', () => {
  it('평평한 바닥과 수직 벽뿐인 조각은 법선을 넣지 않는다(면 법선으로 같은 그림 — 그물이 커지지 않음)', () => {
    const g = gridWith((i) => (i >= 10 ? -10 : 0));
    expect(tileNormals(g, 0, 20, 0, 20)).toBeNull();
    const t = buildTile(g, 0, 0, gridOrigin(g), 'depth');
    expect(t.flat).toBe(false);
    expect(t.normals).toBeUndefined();
  });

  it('기울어진 면은 이웃 높이 차분 법선(경사 0.5 → (0.5, 0, 1)/√1.25)', () => {
    const g = gridWith((i) => -0.5 * i);
    const t = buildTile(g, 0, 0, gridOrigin(g), 'depth');
    const n = t.normals!;
    expect(n.length).toBe(21 * 21 * 3);
    const l = Math.sqrt(1.25);
    for (const [i, j] of [
      [5, 5],
      [0, 10],
      [20, 20],
    ] as const) {
      const v = normalAt(n, i, j);
      expect(v[0]).toBeCloseTo(0.5 / l, 6);
      expect(v[1]).toBeCloseTo(0, 6);
      expect(v[2]).toBeCloseTo(1 / l, 6);
    }
  });

  it('벽에 닿은 마디는 법선 0(뷰어가 면 법선으로 — 벽과 모서리가 날카롭게), 벽 밖 경사·바닥은 매끈', () => {
    // i < 10: 경사, i ≥ 10: 깊이 −15(높이 차 10.5 > 2.5)
    const g = gridWith((i) => (i < 10 ? -0.5 * i : -15));
    const n = tileNormals(g, 0, 20, 0, 20)!;
    expect(normalAt(n, 9, 5)).toEqual([0, 0, 0]);
    expect(normalAt(n, 10, 5)).toEqual([0, 0, 0]);
    expect(normalAt(n, 8, 5)[2]).toBeCloseTo(1 / Math.sqrt(1.25), 6);
    expect(normalAt(n, 15, 5)).toEqual([0, 0, 1]);
  });

  it('문턱: 이웃 높이 차가 칸 × WALL_SLOPE 이하면 매끈, 넘으면 벽', () => {
    expect(WALL_SLOPE).toBe(2.5);
    const below = tileNormals(
      gridWith((i) => (i >= 10 ? -2.4 : 0)),
      0,
      20,
      0,
      20,
    )!;
    expect(normalAt(below, 10, 5)[0]).toBeGreaterThan(0.3);
    const above = tileNormals(
      gridWith((i) => (i >= 10 ? -2.6 : 0) + (i === 0 ? -0.1 : 0)),
      0,
      20,
      0,
      20,
    )!;
    expect(normalAt(above, 10, 5)).toEqual([0, 0, 0]);
    expect(normalAt(above, 9, 5)).toEqual([0, 0, 0]);
  });

  it('조각 가장자리 마디의 법선은 이웃 조각과 같다(온 격자 기준 차분)', () => {
    const spec: GridSpec = { x0: 0, y0: 0, nx: 130, ny: 3, dx: 1, dy: 1, top: 0, bottom: -100 };
    const g = new HeightGrid(spec);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 130; i++) g.h[j * 130 + i] = -0.01 * i * i;
    // 마디 64는 조각 0의 오른쪽 끝이자 조각 1의 왼쪽 끝
    const a = tileNormals(g, 0, 64, 0, 2)!;
    const b = tileNormals(g, 64, 128, 0, 2)!;
    expect([...a.subarray((1 * 65 + 64) * 3, (1 * 65 + 64) * 3 + 3)]).toEqual([...b.subarray((1 * 65 + 0) * 3, (1 * 65 + 0) * 3 + 3)]);
  });
});

describe('영역 내리기(홈·포켓)와 판 밖', () => {
  const regions = (rings: number[][], z: number, outside = false): SimRegions => {
    const xy = rings.flat();
    const pointStart = [0];
    for (const r of rings) pointStart.push(pointStart[pointStart.length - 1]! + r.length / 2);
    return { ringStart: Uint32Array.from([0, rings.length]), pointStart: Uint32Array.from(pointStart), xy: Float64Array.from(xy), z: Float64Array.from([z]), outside: Uint8Array.from([outside ? 1 : 0]) };
  };

  it('짝홀 규칙: 바깥 고리 안, 안쪽 고리 밖만 바닥 높이로. 소재 바닥 아래로는 내리지 않는다', () => {
    const g = new HeightGrid(SPEC);
    const reg = regions(
      [
        [2, 2, 18, 2, 18, 18, 2, 18],
        [8, 8, 12, 8, 12, 12, 8, 12],
      ],
      -50,
    );
    const r = g.stampRegion(reg, 0);
    // 경계 위 마디까지(2 … 18 × 2 … 18 = 17 × 17). 안쪽 고리의 경계 위 마디는 깎이고 그 안 9 … 11 × 9 … 11(3 × 3)만 남는다
    expect(r.changed).toBe(17 * 17 - 3 * 3);
    const at = (i: number, j: number): number => g.h[j * 21 + i]!;
    expect(at(5, 5)).toBe(-20);
    expect(at(2, 2)).toBe(-20);
    expect(at(18, 18)).toBe(-20);
    expect(at(8, 10)).toBe(-20);
    expect(at(10, 10)).toBe(0);
    expect(at(1, 5)).toBe(0);
    expect(at(19, 5)).toBe(0);
    // 다시 내려도 바뀌지 않는다
    expect(g.stampRegion(reg, 0).changed).toBe(0);
  });

  it('판 외곽선 밖은 소재 바닥까지 내리고 표시 2(경계 위는 판 안) — 바닥 색으로 그린다', () => {
    const g = new HeightGrid(SPEC);
    g.stampRegion(regions([[0, 0, 10, 0, 10, 20, 0, 20]], 0, true), 0);
    expect(g.h[5 * 21 + 15]).toBe(-20);
    expect(g.mark[5 * 21 + 15]).toBe(MARK_OUTSIDE);
    expect(g.mark[5 * 21 + 5]).toBe(0);
    for (const [i, j] of [
      [0, 0],
      [10, 20],
      [0, 20],
      [10, 5],
    ])
      expect(g.mark[j! * 21 + i!]).toBe(0);
    expect(g.mark[20 * 21 + 11]).toBe(MARK_OUTSIDE);
    const t = buildTile(g, 0, 0, gridOrigin(g), 'depth');
    const c = (5 * 21 + 15) * 4;
    expect([t.colors[c], t.colors[c + 1], t.colors[c + 2]].map((v) => Math.round(v! * 1000) / 1000)).toEqual(STOCK_RGB.map((v) => Math.round(v * 0.8 * 1000) / 1000));
  });
});
