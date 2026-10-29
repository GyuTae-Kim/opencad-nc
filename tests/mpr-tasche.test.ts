/**
 * MPR 112 Tasche(사각 포켓)의 모서리 반지름 RD(18차): 실제 파일에서 RD는 늘 짧은 변의 반 이하였고, 반과 같은 것은 정확히 반이었다(반원 끝).
 * RD가 있으면 PGI·XML 둥근 사각 포켓(wangs.ts rectPocket)과 같은 둥근 사각 기둥(1/4 원 8토막)으로 그리고, 그 둘레 호를 측정 붙잡기 표에 넣는다.
 * RD가 없거나 0이면 예전처럼 각진 상자다. 시뮬레이션 재료도 기둥(둥근 모서리)을 쓴다.
 */
import { describe, expect, it } from 'vitest';
import type { SnapRefineInput } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import { parseForView } from '../src/app/payload';
import { refineSnap } from '../src/app/refine';
import { panelSnapPoints } from '../src/app/snap';
import { ArcTangents, panelArcsOf, shapeAt } from '../src/app/tangent';
import { parseMpr, type MprBoxOp } from '../src/mpr';
import { panelSimSource } from '../src/sim/panel-source';

type V3 = [number, number, number];
const HEAD = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n_BSX=600\n_BSY=400\n_BSZ=18\n\n<100 \\WerkStck\\\nLA="600"\nBR="400"\nDI="18"\n`;
const tasche = (xa: number, ya: number, la: number, br: number, ti: number, extra = ''): string =>
  `<112 \\Tasche\\\nXA="${xa}"\nYA="${ya}"\nLA="${la}"\nBR="${br}"\n${extra}WI="0"\nTI="${ti}"\nZT="0"\nXY="80"\nT_="0"\nF_="STANDARD"\nDS="1"\nKO="00"\n`;
// 0: 64 × 44 RD 4 관통(18) 1: 30 × 36 RD 15(짧은 변의 반 — 위아래가 반원) 깊이 2 2: RD 없음 3: RD 0 4: RD가 짧은 변의 반보다 큼(반으로)
// 5: 30° 돌린 80 × 40 RD 5
const MPR =
  HEAD +
  [
    tasche(100, 100, 64, 44, 18, 'RD="4"\n'),
    tasche(300, 100, 30, 36, 2, 'RD="15"\n'),
    tasche(450, 100, 50, 20, 5),
    tasche(450, 200, 50, 20, 5, 'RD="0"\n'),
    tasche(100, 300, 40, 20, 5, 'RD="30"\n'),
    tasche(300, 300, 80, 40, 6, 'RD="5"\n').replace('WI="0"', 'WI="30"'),
  ].join('\n') +
  '!\n';

const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
/** 기둥 외곽의 xy 넓이(신발끈) */
const area = (o: readonly number[]): number => {
  let a = 0;
  const n = o.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += o[i * 3]! * o[j * 3 + 1]! - o[j * 3]! * o[i * 3 + 1]!;
  }
  return Math.abs(a) / 2;
};
/** 둥근 사각형 넓이 */
const rounded = (la: number, br: number, r: number): number => la * br - (4 - Math.PI) * r * r;
/** 1/4 원을 8토막 낸 다각형이 원보다 덜 차는 넓이(모서리 넷) */
const chordLoss = (r: number): number => 4 * (r * r * (Math.PI / 4) - 8 * 0.5 * r * r * Math.sin(Math.PI / 16));

describe('MPR 112 Tasche 모서리 반지름(RD)', () => {
  const part = parseMpr(MPR);
  const ops = part.operations.filter((o): o is MprBoxOp => o.kind === 'pocket');

  it('RD가 있으면 둥근 사각 기둥(윗면에서 아래로, 1/4 원 8토막)과 둘레 호 넷, 상자는 그대로 둔다', () => {
    const p = ops[0]!.prism!;
    expect(p.dir).toEqual([0, 0, -1]);
    expect(p.depth).toBe(18);
    expect(p.outline).toHaveLength(36 * 3);
    expect(p.outline.filter((_, i) => i % 3 === 2).every((z) => z === 18)).toBe(true);
    expect(area(p.outline)).toBeCloseTo(rounded(64, 44, 4) - chordLoss(4), 9);
    // 모든 꼭짓점이 상자 안, 모서리 중심 (100 ± 28, 100 ± 18)에서 반지름 4
    for (let i = 0; i < 36; i++) {
      const [x, y] = [p.outline[i * 3]!, p.outline[i * 3 + 1]!];
      expect(Math.abs(x - 100)).toBeLessThanOrEqual(32 + 1e-9);
      expect(Math.abs(y - 100)).toBeLessThanOrEqual(22 + 1e-9);
    }
    expect(p.arcs!.plane).toBe(0);
    expect(p.arcs!.step).toBeCloseTo(Math.PI / 16, 15);
    const e = p.arcs!.elements;
    expect(e).toHaveLength(4 * 9);
    const centers = [0, 1, 2, 3].map((k) => [e[k * 9 + 6]!, e[k * 9 + 7]!].map((v) => Math.round(v * 1e9) / 1e9));
    expect(centers).toEqual([
      [128, 82],
      [128, 118],
      [72, 118],
      [72, 82],
    ]);
    for (let k = 0; k < 4; k++) {
      expect(e[k * 9 + 8]).toBeCloseTo(Math.PI / 2, 15);
      expect(Math.hypot(e[k * 9]! - e[k * 9 + 6]!, e[k * 9 + 1]! - e[k * 9 + 7]!)).toBeCloseTo(4, 12);
      expect(Math.hypot(e[k * 9 + 3]! - e[k * 9 + 6]!, e[k * 9 + 4]! - e[k * 9 + 7]!)).toBeCloseTo(4, 12);
    }
    expect(ops[0]!.box!.origin).toEqual([68, 78, 0]);
  });

  it('RD가 짧은 변의 반이면 그 변이 반원(겹친 꼭짓점은 그물에서 하나로), 반보다 크면 반으로 줄인다', () => {
    const p = ops[1]!.prism!;
    expect(area(p.outline)).toBeCloseTo(rounded(30, 36, 15) - chordLoss(15), 9);
    expect(p.depth).toBe(2);
    // 반원 끝의 꼭짓점 (300, 118)·(300, 82)
    const pts = Array.from({ length: 36 }, (_, i) => [p.outline[i * 3]!, p.outline[i * 3 + 1]!]);
    expect(pts.filter(([x, y]) => Math.abs(x - 300) < 1e-9 && Math.abs(y - 118) < 1e-9)).toHaveLength(2);
    const q = ops[4]!.prism!;
    expect(area(q.outline)).toBeCloseTo(rounded(40, 20, 10) - chordLoss(10), 9);
  });

  it('RD가 없거나 0이면 예전처럼 각진 상자(기둥 없음)', () => {
    expect(ops[2]!.prism).toBeUndefined();
    expect(ops[3]!.prism).toBeUndefined();
    expect(ops[2]!.box).toBeDefined();
  });

  it('WI로 돌린 포켓은 모서리 중심도 돈다', () => {
    const e = ops[5]!.prism!.arcs!.elements;
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    // 첫 모서리 중심: 지역 (35, −15)를 30° 돌린 자리
    expect(e[6]).toBeCloseTo(300 + 35 * c + 15 * s, 12);
    expect(e[7]).toBeCloseTo(300 + 35 * s - 15 * c, 12);
  });

  it('장면은 둥근 기둥 그물이고, 붙잡기 표에 위·아래 고리의 둘레 호(나눈 각 11.25°)가 들어간다 — 각진 포켓은 상자 그대로', () => {
    const r = parseForView('t.mpr', new TextEncoder().encode(MPR));
    const scene = r.scene as Scene3d;
    const t = r.mpr!.snap!;
    const id = (k: number): string => `mpr-op-${part.operations.indexOf(ops[k]!)}`;
    const mesh = scene.meshes.find((m) => m.id === id(0))!;
    // 꼭짓점 36개 × 위·아래 뚜껑 + 옆면 사각형 36개(4꼭짓점)
    expect(mesh.positions.length / 3).toBe(36 * 2 + 36 * 4);
    // 반원 끝의 겹친 꼭짓점은 하나로 — 그물 윤곽선에 길이 0인 토막이 없다
    const half = scene.meshes.find((m) => m.id === id(1))!;
    const ed = half.edges!;
    for (let k = 0; k * 6 < ed.length; k++) expect(Math.hypot(ed[k * 6]! - ed[k * 6 + 3]!, ed[k * 6 + 1]! - ed[k * 6 + 4]!, ed[k * 6 + 2]! - ed[k * 6 + 5]!)).toBeGreaterThan(1e-6);
    expect(panelArcsOf(t, `edge:${id(0)}`)).toHaveLength(8);
    expect(t.outlineForms!.get(id(0))).toEqual({ plane: 0, step: Math.PI / 16 });
    expect(t.outlines!.has(id(2))).toBe(false);
    expect(scene.meshes.find((m) => m.id === id(2))!.positions.length / 3).toBe(24);
  });

  it('윤곽선이 모두 곧은 그물(19차 — 측정 교차점 다듬기가 직선으로 본다): 직사각형 판과 RD 없는 각진 상자, 둥근 기둥은 빼고', () => {
    const r = parseForView('t.mpr', new TextEncoder().encode(MPR));
    const t = r.mpr!.snap!;
    const id = (k: number): string => `mpr-op-${part.operations.indexOf(ops[k]!)}`;
    expect([...t.straight!].sort()).toEqual(['mpr-board', id(2), id(3)].sort());
    for (const k of [0, 1, 4, 5]) expect(t.outlines!.has(id(k))).toBe(true);
  });

  it('둥근 모서리 위 측정: 현 위 점은 원 위로, 가운데 점·중심, 그 위 첫 점의 접선은 반지름에 수직(선분 식별자로)', () => {
    const r = parseForView('t.mpr', new TextEncoder().encode(MPR));
    const t = r.mpr!.snap!;
    const id = `mpr-op-${part.operations.indexOf(ops[0]!)}`;
    const g = panelArcsOf(t, `edge:${id}`)[1]!;
    const C = [128, 118];
    // 둘째 모서리(윗면) 셋째 현의 가운데 — 원에서 처짐만큼 안쪽
    const a = shapeAt(g, 2 / 8);
    const b = shapeAt(g, 3 / 8);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]];
    const input: SnapRefineInput = {
      kind: 'onEdge',
      point: mid as V3,
      segment: { kind: 'edge', id, index: 0, raw: 0, ends: [a, b] },
      first: null,
      ray: { origin: [mid[0]!, mid[1]!, mid[2]! + 100], dir: [0, 0, -1] },
    };
    const q = refineSnap(input, t)!;
    expect(Math.hypot(q[0] - C[0]!, q[1] - C[1]!)).toBeCloseTo(4, 9);
    const pts = panelSnapPoints({ kind: 'edge', id, index: 0, raw: 0, point: mid as V3 }, t)!;
    expect(dist(pts[0]!.point, [128 + 4 * Math.SQRT1_2, 118 + 4 * Math.SQRT1_2, 18])).toBeLessThan(1e-9);
    expect(dist(pts[1]!.point, [128, 118, 18])).toBeLessThan(1e-9);
    const c = new ArcTangents();
    const d = c.at(t, { point: q, segment: input.segment }, shapeAt(g, 0.9))!;
    expect(c.by).toBe('segment');
    expect(Math.abs(d[0] * (q[0] - C[0]!) + d[1] * (q[1] - C[1]!))).toBeLessThan(1e-9);
  });

  it('시뮬레이션 재료도 둥근 모서리(기둥 고리) — 각진 포켓은 상자 네 꼭짓점', () => {
    const src = panelSimSource(part);
    const regions = src.items.filter((i) => i.type === 'region') as unknown as { rings: number[][]; z: number }[];
    expect(regions).toHaveLength(6);
    expect(regions[0]!.rings[0]).toHaveLength(36 * 2);
    expect(regions[0]!.z).toBe(0);
    expect(regions[1]!.z).toBe(16);
    expect(regions[2]!.rings[0]).toHaveLength(8);
  });
});
