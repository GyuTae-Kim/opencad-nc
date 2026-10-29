/**
 * 측정 교차점 다듬기(17차 — 코어 0.15.0 refine 'intersection', refine.ts·intersect.ts): 장면이 원호·스플라인을 나눈 토막 두 개의
 * 교차점(꺾은선끼리)을 두 요소의 정확한 3D 교차점으로. 해석기가 읽은 합성 G-code·PGI 장면의 실제 토막(float32 끝점)으로 코어 입력을 손으로 만든다
 * (진짜 코어로 하는 확인은 measure-refine-core.test.ts).
 * - 원호 × 직선, 원호 × 원호(같은 평면·다른 평면 — 식), 스플라인 × 직선·나선 × 직선(두 매개변수 가우스-뉴턴)
 * - 넓힌 교차(열린 후보 — 두 토막 사이 가운데)도 같은 답, 3D로 비켜 지나가면 null
 * - 같은 이동, 둘 다 직선, 이어진 두 이동의 공유 끝점, 둘째 토막 없음은 null
 * - 판재 윤곽 경로의 호 × 직선, 구멍 테두리 × 곧은 모서리
 */
import { describe, expect, it } from 'vitest';
import type { SnapRefineInput } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import { parseForView } from '../../src/app/payload';
import { refineSnap } from '../../src/app/refine';
import type { SnapMoves } from '../../src/app/snap';
import type { PanelSnapTable } from '../../src/scene';

type V3 = [number, number, number];
type Seg = { kind: 'line' | 'edge'; id: string; index: number; raw: number; ends: [V3, V3] };

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const D = Math.PI / 180;

/** 장면 선분 묶음에서 원본 번호(segmentIds) index의 토막들 — 묶음 id와 함께 */
function segsOf(scene: Scene3d, index: number, idPattern = /./): Seg[] {
  const out: Seg[] = [];
  for (const l of scene.lines) {
    if (!idPattern.test(l.id)) continue;
    const p = l.positions;
    for (let k = 0; k * 6 < p.length; k++) {
      if ((l.segmentIds ? l.segmentIds[k] : k) !== index) continue;
      out.push({ kind: 'line', id: l.id, index, raw: k, ends: [[p[k * 6]!, p[k * 6 + 1]!, p[k * 6 + 2]!], [p[k * 6 + 3]!, p[k * 6 + 4]!, p[k * 6 + 5]!]] });
    }
  }
  return out;
}

/** 그물 윤곽선 토막들 */
function edgesOf(scene: Scene3d, id: string): Seg[] {
  const m = scene.meshes.find((x) => x.id === id)!;
  const e = m.edges!;
  const out: Seg[] = [];
  for (let k = 0; k * 6 < e.length; k++) out.push({ kind: 'edge', id, index: k, raw: k, ends: [[e[k * 6]!, e[k * 6 + 1]!, e[k * 6 + 2]!], [e[k * 6 + 3]!, e[k * 6 + 4]!, e[k * 6 + 5]!]] });
  return out;
}

/** 두 토막의 가장 가까운 두 점(토막 범위 안)과 그 가운데·사이 */
function closest(a: Seg, b: Seg): { p: V3; gap: number } {
  const [a0, a1] = a.ends;
  const [b0, b1] = b.ends;
  const u = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
  const v = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]];
  const w = [a0[0] - b0[0], a0[1] - b0[1], a0[2] - b0[2]];
  const dt = (x: number[], y: number[]): number => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
  const A = dt(u, u);
  const B = dt(u, v);
  const C = dt(v, v);
  const Dd = dt(u, w);
  const E = dt(v, w);
  const den = A * C - B * B;
  const cl = (x: number): number => Math.max(0, Math.min(1, x));
  let s = den > 1e-12 * A * C ? cl((B * E - C * Dd) / den) : 0;
  let t = (B * s + E) / C;
  if (t < 0 || t > 1) {
    t = cl(t);
    s = cl((t * B - Dd) / A);
  }
  const P = [a0[0] + u[0]! * s, a0[1] + u[1]! * s, a0[2] + u[2]! * s];
  const Q = [b0[0] + v[0]! * t, b0[1] + v[1]! * t, b0[2] + v[2]! * t];
  return { p: [(P[0]! + Q[0]!) / 2, (P[1]! + Q[1]!) / 2, (P[2]! + Q[2]!) / 2], gap: dist(P, Q) };
}

/** 두 토막 묶음에서 가장 가깝게 지나가는 쌍(near 둘레만 — 코어 교차점 후보처럼) */
function crossing(A: Seg[], B: Seg[], near: readonly number[], within = 2): { a: Seg; b: Seg; p: V3; gap: number } {
  let best: { a: Seg; b: Seg; p: V3; gap: number } | null = null;
  for (const a of A)
    for (const b of B) {
      const c = closest(a, b);
      if (dist(c.p, near) > within) continue;
      if (!best || c.gap < best.gap) best = { a, b, ...c };
    }
  return best!;
}

/** 손으로 만든 코어 교차점 입력 */
function inter(a: Seg, b: Seg | undefined, point: readonly number[], open = false): SnapRefineInput {
  return {
    kind: 'intersection',
    point: [point[0]!, point[1]!, point[2]!],
    segment: a,
    ...(b ? { other: b } : {}),
    first: null,
    ray: { origin: [point[0]!, point[1]!, point[2]! + 100], dir: [0, 0, -1] },
    ...(open ? { open: true } : {}),
  };
}

describe('NC 원호·직선의 교차점(식)', () => {
  // 1: 위쪽 반원(중심 원점 R10, 5°씩 36토막) 2: y = 4 직선 3: 중심 (12,0) R8 원호 4: y = 8의 ZX 평면 반원(G18 R6)
  // 5: z = 0.01로 띄운 y = 5 직선(3D로 비켜 지나감)
  const r = parseForView(
    'x.nc',
    enc(
      [
        'G21 G90 G17',
        'G0 X10 Y0 Z0',
        'G3 X-10 Y0 I-10 J0 F500',
        'G0 X-12 Y4',
        'G1 X12 Y4',
        'G0 X4 Y0',
        'G2 X12 Y8 I8 J0',
        'G0 X0 Y8 Z6',
        'G18 G3 X0 Z-6 I0 K-6',
        'G17 G0 X-12 Y5 Z0.01',
        'G1 X12 Y5',
        'M2',
      ].join('\n'),
    ),
  );
  const nc = r.nc! as unknown as SnapMoves;
  const m = nc.moves;
  /** 시작점이 s인 이동 번호 */
  const moveFrom = (s: number[], kind?: number): number => {
    for (let i = 0; i < m.count; i++)
      if (dist([m.points[i * 3]!, m.points[i * 3 + 1]!, m.points[i * 3 + 2]!], s) < 1e-9 && (kind === undefined || m.kind[i] === kind)) return i;
    throw new Error(`no move from ${s}`);
  };
  const arc1 = moveFrom([10, 0, 0]);
  const line = moveFrom([-12, 4, 0], 1);
  const arc2 = moveFrom([4, 0, 0], 2);
  const arc3 = moveFrom([0, 8, 6], 2);
  const high = moveFrom([-12, 5, 0.01], 1);
  const segs = (i: number): Seg[] => segsOf(r.scene, i, /^nc-(cut|rapid)/);

  it('원호 × 직선: 현과 직선의 교차점(처짐만큼 어긋남) → 원 위 정확한 교차점, 둘째 토막이 원호여도 같다', () => {
    const X: V3 = [Math.sqrt(84), 4, 0];
    const c = crossing(segs(arc1), segs(line), X);
    expect(c.gap).toBeLessThan(1e-6);
    // 다듬기 전: 현 위라 원에서 떨어져 있다
    expect(dist(c.p, X)).toBeGreaterThan(1e-3);
    expect(dist(refineSnap(inter(c.a, c.b, c.p), nc)!, X)).toBeLessThan(1e-12);
    expect(dist(refineSnap(inter(c.b, c.a, c.p), nc)!, X)).toBeLessThan(1e-12);
    // 왼쪽 교차점도
    const L: V3 = [-Math.sqrt(84), 4, 0];
    const c2 = crossing(segs(arc1), segs(line), L);
    expect(dist(refineSnap(inter(c2.a, c2.b, c2.p), nc)!, L)).toBeLessThan(1e-12);
  });

  it('원호 × 원호(같은 평면 — 두 원의 교점), 넓힌 교차(열린 후보: 두 토막 사이 가운데)도 같은 답', () => {
    const X: V3 = [7.5, Math.sqrt(43.75), 0];
    const s1 = segs(arc1);
    const c = crossing(s1, segs(arc2), X);
    expect(dist(c.p, X)).toBeGreaterThan(1e-3);
    expect(dist(refineSnap(inter(c.a, c.b, c.p), nc)!, X)).toBeLessThan(1e-12);
    // 열린 후보: 꺾은선이 만나지 않는 이웃 토막 쌍 — 코어 점은 두 토막 사이 가운데
    const near = s1[s1.indexOf(c.a) + 1]!;
    const o = closest(near, c.b);
    expect(o.gap).toBeGreaterThan(1e-4);
    expect(dist(refineSnap(inter(near, c.b, o.p, true), nc)!, X)).toBeLessThan(1e-12);
  });

  it('원호 × 다른 평면의 원호(XY 반원과 y = 8의 ZX 반원 — 두 평면이 만나는 직선): 3D 교차점', () => {
    // 3의 가운데(z = 0 자리)가 x 어느 쪽인지
    const mid = segs(arc3).map((s) => s.ends[0]).find((p) => Math.abs(p[2]) < 1e-6)!;
    const X: V3 = [Math.sign(mid[0]) * 6, 8, 0];
    const c = crossing(segs(arc1), segs(arc3), X);
    expect(dist(refineSnap(inter(c.a, c.b, c.p, c.gap > 1e-6), nc)!, X)).toBeLessThan(1e-12);
  });

  it('3D로 비켜 지나가면(z 0.01 위) null, 두 직선·같은 이동·공유 끝점·둘째 토막 없음도 null', () => {
    const c = crossing(segs(arc1), segs(high), [Math.sqrt(75), 5, 0]);
    expect(c.gap).toBeGreaterThan(0.009);
    expect(refineSnap(inter(c.a, c.b, c.p, true), nc)).toBeNull();
    // 두 직선(y = 4 이송 × 그 뒤 급속)
    const l = segs(line)[0]!;
    const rapid = segsOf(r.scene, line + 1, /^nc-rapid/)[0]!;
    expect(refineSnap(inter(l, rapid, l.ends[1]), nc)).toBeNull();
    // 같은 이동의 두 토막(이웃 현의 공유 꼭짓점)
    const s1 = segs(arc1);
    expect(refineSnap(inter(s1[3]!, s1[4]!, s1[3]!.ends[1]), nc)).toBeNull();
    // 원호 끝(−10, 0)과 이어진 급속의 공유 끝점
    const last = s1[s1.length - 1]!;
    const next = segsOf(r.scene, arc1 + 1, /^nc-rapid/)[0]!;
    expect(refineSnap(inter(last, next, [-10, 0, 0]), nc)).toBeNull();
    expect(refineSnap(inter(s1[3]!, undefined, s1[3]!.ends[1]), nc)).toBeNull();
  });
});

describe('스플라인·나선이 끼는 교차점(두 매개변수 가우스-뉴턴)', () => {
  it('G5 3차 베지어 × y = 2 직선: 15t(1 − t) = 2의 자리', () => {
    const r = parseForView('s.nc', enc(['G21 G90 G17 G64', 'G0 X0 Y0 Z0', 'G5 X10 Y0 I0 J5 P0 Q5 F300', 'G0 X-2 Y2', 'G1 X12 Y2', 'M2'].join('\n')));
    const nc = r.nc! as unknown as SnapMoves;
    expect(nc.splines?.count).toBe(1);
    const t = (1 - Math.sqrt(7 / 15)) / 2;
    const X: V3 = [10 * t * t * (3 - 2 * t), 2, 0];
    const sp = nc.splines!;
    const pieces: Seg[] = [];
    for (let j = 0; j < sp.moves[0]!; j++) pieces.push(...segsOf(r.scene, sp.move[0]! + j, /^nc-cut/));
    const lineMove = nc.moves.count - 1;
    const c = crossing(pieces, segsOf(r.scene, lineMove, /^nc-cut/), X);
    expect(dist(c.p, X)).toBeGreaterThan(1e-5);
    expect(dist(refineSnap(inter(c.a, c.b, c.p), nc)!, X)).toBeLessThan(1e-10);
    expect(dist(refineSnap(inter(c.b, c.a, c.p), nc)!, X)).toBeLessThan(1e-10);
  });

  it('나선(G3 반 바퀴에 Z 0 → 5) × 세운 직선: 그 각의 높이', () => {
    const x = (10 * Math.cos(47 * D)).toFixed(12);
    const y = (10 * Math.sin(47 * D)).toFixed(12);
    const r = parseForView('h.nc', enc(['G21 G90 G17', 'G0 X10 Y0 Z0', 'G3 X-10 Y0 Z5 I-10 J0 F500', `G0 X${x} Y${y} Z0`, 'G1 Z5', 'M2'].join('\n')));
    const nc = r.nc! as unknown as SnapMoves;
    const X: V3 = [Number(x), Number(y), (5 * 47) / 180];
    const n = nc.moves.count;
    const arc = [...nc.moves.kind].indexOf(2);
    const c = crossing(segsOf(r.scene, arc, /^nc-cut/), segsOf(r.scene, n - 1, /^nc-cut/), X);
    expect(dist(refineSnap(inter(c.a, c.b, c.p, c.gap > 1e-6), nc)!, X)).toBeLessThan(1e-10);
  });
});

describe('판재 윤곽 경로·구멍 테두리의 교차점', () => {
  // 판 400 × 300 × 18: 반원 경로(아래로 볼록, 중심 (120,100) R20)와 x = 111 직선 경로(둘 다 윗면에서 5 — z 13),
  // 윗면에서 판 구멍 Ø20(중심 (200,150), 32토막 원기둥), 그 위를 가로지르는 모서리 R2 포켓(y 150~158)과 각진 포켓(y 138~146)
  const PGI = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <path direction="z-" toolOffset="middle" width="6" depth="5" close="0" enable="1" order="1">
   <vertex x="100" y="100" z="0" bulge="1"/>
   <vertex x="140" y="100" z="0" bulge="0"/>
  </path>
  <path direction="z-" toolOffset="middle" width="6" depth="5" close="0" enable="1" order="2">
   <vertex x="111" y="60" z="0" bulge="0"/>
   <vertex x="111" y="120" z="0" bulge="0"/>
  </path>
  <circle centerX="200" centerY="150" centerZ="0" radius="10" width="20" depth="12" direction="z-" empty="1" enable="1" order="3"/>
  <pocket length="60" width="8" depth="3" direction="z-" cornerRadius="2" angle="0" centerX="200" centerY="154" centerZ="0" enable="1" order="4"/>
  <pocket length="60" width="8" depth="3" direction="z-" cornerRadius="0" angle="0" centerX="200" centerY="142" centerZ="0" enable="1" order="5"/>
 </panel>
</pgi>`;
  const r = parseForView('p.pgi', enc(PGI));
  const t = r.mpr!.snap! as PanelSnapTable;

  it('호 경로 × 직선 경로(같은 깊이): 원 위 정확한 교차점', () => {
    const X: V3 = [111, 100 - Math.sqrt(319), 13];
    const A = segsOf(r.scene, 0, /^mpr-op-0$/);
    const B = segsOf(r.scene, 1, /^mpr-op-1$/);
    const c = crossing(A, B, X);
    expect(dist(c.p, X)).toBeGreaterThan(1e-3);
    expect(dist(refineSnap(inter(c.a, c.b, c.p), t)!, X)).toBeLessThan(1e-12);
  });

  it('구멍 테두리(원) × 둥근 사각 포켓의 곧은 모서리: 원 위 정확한 교차점, 둘레 표가 없는 각진 포켓 모서리는 null', () => {
    expect(t.outlines?.has('mpr-op-2')).toBe(true);
    const top = (s: Seg): boolean => Math.abs(s.ends[0][2] - 18) < 1e-6 && Math.abs(s.ends[1][2] - 18) < 1e-6;
    const rim = edgesOf(r.scene, 'mpr-op-2').filter(top);
    expect(rim).toHaveLength(32);
    const X: V3 = [206, 158, 18];
    const c = crossing(rim, edgesOf(r.scene, 'mpr-op-3').filter(top), X);
    expect(dist(c.p, X)).toBeGreaterThan(1e-3);
    expect(dist(refineSnap(inter(c.a, c.b, c.p, c.gap > 1e-6), t)!, X)).toBeLessThan(1e-12);
    // 각진 포켓(호가 없어 둘레 표에 없다 — 윤곽선이 곧은지 모른다)
    const c2 = crossing(rim, edgesOf(r.scene, 'mpr-op-4').filter(top), [194, 142, 18]);
    expect(refineSnap(inter(c2.a, c2.b, c2.p, c2.gap > 1e-6), t)).toBeNull();
    // 같은 원의 두 테두리 토막도 null
    expect(refineSnap(inter(rim[2]!, rim[3]!, rim[2]!.ends[1]), t)).toBeNull();
  });
});
