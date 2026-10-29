/**
 * 축과 선분의 교차 다듬기(20차 — 3D 뷰어 코어 0.18.0 refine 'axisEdge'): 첫 점 축(inference.axisEdges)·끌어온 축(inference.track)이
 * 원호·스플라인을 나눈 토막과 만나는 코어 점을, 축 직선과 그 곡선의 정확한 교차점(축 직선 위)으로 옮긴다.
 * 답을 아는 곡선으로 본다: 평면 원호(축이 원 평면 안이면 이차식, 밖이면 평면을 뚫는 점), 나선, 원 근사 NURBS(반지름 10), 3차 베지어(G5),
 * 반경 보정 경로 호, 판 외곽선 둥근 모서리, 원형 포켓 둘레, 구멍 테두리. 곧은 요소·만나지 않는 축·축 직선 없음은 null(코어 점 그대로).
 * 코어 입력(SnapRefineInput)은 손으로 만든다 — 진짜 코어로 하는 확인은 measure-axis-core.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SnapRefineInput, SnapRefineLine } from 'opencad-viewer3d';
import { MOVE_ARC } from '../../src/model';
import { parseForView } from '../../src/app/payload';
import { refineSnap } from '../../src/app/refine';
import { panelArcsOf } from '../../src/app/tangent';
import type { SnapMoves } from '../../src/app/snap';

type V3 = [number, number, number];
const D = Math.PI / 180;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const f32 = (p: readonly number[]): V3 => [Math.fround(p[0]!), Math.fround(p[1]!), Math.fround(p[2]!)];
const AX: Record<'x' | 'y' | 'z', V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** 축 직선(지나는 점 o, 세계 축)이 토막 a → b에 가장 가까이 오는 토막 위 점(코어 점 — 평면 안이면 꺾은선 교차점) */
function corePoint(o: readonly number[], axis: 'x' | 'y' | 'z', a: readonly number[], b: readonly number[]): V3 {
  const e = AX[axis];
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const w = [a[0]! - o[0]!, a[1]! - o[1]!, a[2]! - o[2]!];
  const dt = (x: readonly number[], y: readonly number[]): number => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
  // 토막 위 a + s·u와 직선 o + t·e 사이 거리를 가장 작게: [u·u, −u·e; u·e, −1][s; t] = [−u·w; −e·w]
  const uu = dt(u, u);
  const ue = dt(u, e);
  const s = Math.max(0, Math.min(1, (ue * dt(e, w) - dt(u, w)) / (uu - ue * ue)));
  return [a[0]! + u[0]! * s, a[1]! + u[1]! * s, a[2]! + u[2]! * s];
}

/** 손으로 만든 코어 'axisEdge' 입력(장면 선분은 float32 끝점, 코어 점은 그 토막 위) */
function axisInput(id: string, index: number, ends: readonly (readonly number[])[], origin: readonly number[], axis: 'x' | 'y' | 'z', kind: 'line' | 'edge' = 'line', ray?: SnapRefineInput['ray']): SnapRefineInput {
  const a = f32(ends[0]!);
  const b = f32(ends[1]!);
  const point = corePoint(origin, axis, a, b);
  const line: SnapRefineLine = { origin: [origin[0]!, origin[1]!, origin[2]!], dir: AX[axis], axis };
  return { kind: 'axisEdge', point, segment: { kind, id, index, raw: 0, ends: [a, b] }, first: [origin[0]!, origin[1]!, origin[2]!], ray: ray ?? { origin: [point[0], point[1], point[2] + 100], dir: [0, 0, -1] }, line };
}

/** 결과가 축 직선 위(지나는 점과 남은 두 좌표가 정확히 같다)인지 */
function onAxis(q: readonly number[], origin: readonly number[], axis: 'x' | 'y' | 'z'): boolean {
  const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  return [0, 1, 2].every((j) => j === k || q[j] === origin[j]);
}

describe('축과 원호 이동의 교차(평면 원호 — 식)', () => {
  // (0,40) → (40,40) 시계 1/4 원(중심 (20,20), R = 20√2 — 135°에서 45°로 위를 지남, 5°씩 18개 현) → 직선 (60,40)
  const parsed = parseForView('arc.nc', enc(['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40'].join('\n')));
  const nc = parsed.nc!;
  const arc = [...nc.moves.kind].indexOf(MOVE_ARC);
  const id = parsed.scene.lines.find((l) => /^nc-cut-/.test(l.id))!.id;
  const R = 20 * Math.SQRT2;
  const at = (deg: number): V3 => [20 + R * Math.cos(deg * D), 20 + R * Math.sin(deg * D), 0];

  it('원 평면 안의 X축(y = 45)·Y축(x = 30): 이차식의 두 근 가운데 그 토막 쪽 원 위 점, 남은 좌표는 지나는 점 그대로', () => {
    // y = 45가 원과 만나는 x = 20 ± √175(62.1°·117.9° — 현 65°→60°·120°→115° 안)
    const first = [60, 45, 0];
    const q = refineSnap(axisInput(id, arc, [at(65), at(60)], first, 'x'), nc)!;
    expect(onAxis(q, first, 'x')).toBe(true);
    expect(Math.abs(q[0] - (20 + Math.sqrt(175)))).toBeLessThan(1e-9);
    const q2 = refineSnap(axisInput(id, arc, [at(120), at(115)], first, 'x'), nc)!;
    expect(onAxis(q2, first, 'x')).toBe(true);
    expect(Math.abs(q2[0] - (20 - Math.sqrt(175)))).toBeLessThan(1e-9);
    // x = 30이 원과 만나는 y = 20 + √700(69.3° — 현 70°→65°)
    const from = [30, -5, 0];
    const q3 = refineSnap(axisInput(id, arc, [at(70), at(65)], from, 'y'), nc)!;
    expect(onAxis(q3, from, 'y')).toBe(true);
    expect(Math.abs(q3[1] - (20 + Math.sqrt(700)))).toBeLessThan(1e-9);
    // 다듬지 않았으면 현 위(원에서 안쪽) — 처짐 R(1 − cos 2.5°) ≈ 0.027 mm
    const core = axisInput(id, arc, [at(65), at(60)], first, 'x').point;
    expect(dist(core, q)).toBeGreaterThan(0.005);
  });

  it('원 평면을 뚫는 Z축: 원 위 점을 지나면 그 점(남은 X·Y가 지나는 점 그대로), 원에서 비켜 지나가면 null', () => {
    const P = at(102.5);
    const first = [P[0], P[1], 7];
    const q = refineSnap(axisInput(id, arc, [at(105), at(100)], first, 'z'), nc)!;
    expect(onAxis(q, first, 'z')).toBe(true);
    expect(Math.abs(q[2])).toBeLessThan(1e-12);
    const off = [P[0] + 0.5 * Math.cos(102.5 * D), P[1] + 0.5 * Math.sin(102.5 * D), 7];
    expect(refineSnap(axisInput(id, arc, [at(105), at(100)], off, 'z'), nc)).toBeNull();
  });

  it('원 평면 위로 지나는 X축, 곧은 이동, 축 직선 없음은 null — 결과는 커서 광선과 상관없다', () => {
    expect(refineSnap(axisInput(id, arc, [at(65), at(60)], [60, 45, 1], 'x'), nc)).toBeNull();
    const line = arc + 1;
    const p = nc.moves.points;
    expect(refineSnap(axisInput(id, line, [[p[line * 3]!, p[line * 3 + 1]!, 0], [p[line * 3 + 3]!, p[line * 3 + 4]!, 0]], [50, 0, 0], 'y'), nc)).toBeNull();
    const c = axisInput(id, arc, [at(65), at(60)], [60, 45, 0], 'x');
    expect(refineSnap({ ...c, line: undefined }, nc)).toBeNull();
    const other = refineSnap({ ...c, ray: { origin: [500, -300, 7], dir: [Math.SQRT1_2, 0, -Math.SQRT1_2] } }, nc);
    expect(other).toEqual(refineSnap(c, nc));
  });
});

describe('G18(ZX 평면) 원호', () => {
  it('Z축 x = 6이 반지름 10 원호와 만나는 점(그 원호가 지나는 쪽 하나): (6, 0, ±8), 남은 X·Y가 지나는 점 그대로', () => {
    const p = parseForView('l.nc', enc(['G21 G90 G18', 'G0 X0 Y0 Z10', 'G2 X10 Z0 I0 K-10 F300'].join('\n')));
    const ln = p.nc!;
    const i = [...ln.moves.kind].indexOf(MOVE_ARC);
    const lid = p.scene.lines.find((l) => /^nc-cut-/.test(l.id))!.id;
    const C = (deg: number): V3 => [10 * Math.cos(deg * D), 0, 10 * Math.sin(deg * D)];
    const first = [6, 0, -20];
    const deg = Math.atan2(8, 6) / D;
    const got = [deg, -deg].map((a) => refineSnap(axisInput(lid, i, [C(a - 2.5), C(a + 2.5)], first, 'z'), ln));
    // 원호는 한쪽(53.13° 또는 −53.13°)만 지난다 — 다른 쪽 현은 원호 위가 아니라 null
    expect(got.filter(Boolean)).toHaveLength(1);
    const q = got.find(Boolean)!;
    expect(onAxis(q, first, 'z')).toBe(true);
    expect(Math.abs(Math.abs(q[2]) - 8)).toBeLessThan(1e-9);
  });
});

describe('축과 나선·스플라인의 교차(두 매개변수 뉴턴)', () => {
  it('나선: X축이 나선 위 한 점을 지나면 그 점(높이도)', () => {
    const h = parseForView('h.nc', enc(['G21 G90 G17', 'G0 X10 Y0 Z0', 'G3 X10 Y0 Z-6 I-10 J0 P2 F300'].join('\n')));
    const hn = h.nc!;
    const i = [...hn.moves.kind].indexOf(MOVE_ARC);
    const hid = h.scene.lines.find((l) => /^nc-cut-/.test(l.id))!.id;
    const P = (deg: number): V3 => [10 * Math.cos(deg * D), 10 * Math.sin(deg * D), (-6 * deg) / 720];
    const X = P(392.5);
    const first = [X[0] - 20, X[1], X[2]];
    const q = refineSnap(axisInput(hid, i, [P(390), P(395)], first, 'x'), hn)!;
    expect(onAxis(q, first, 'x')).toBe(true);
    expect(dist(q, X)).toBeLessThan(1e-9);
  });

  it('원 근사 NURBS(G5.2, 반지름 10): y = 6인 X축은 (8, 6)', () => {
    const p = parseForView('n.nc', enc(['G21 G90 G17', 'G0 X10 Y0 Z-1', 'G5.2 P1 L3 F500', `X10 Y10 P${Math.SQRT1_2}`, 'X0 Y10 P1', 'G5.3'].join('\n')));
    const sn = p.nc!;
    const sid = p.scene.lines.find((l) => /^nc-cut-/.test(l.id))!.id;
    const pts = sn.moves.points;
    let i = -1;
    for (let k = 0; k < sn.moves.count; k++) if ((pts[k * 3 + 1]! - 6) * (pts[k * 3 + 4]! - 6) < 0) i = k;
    expect(i).toBeGreaterThanOrEqual(0);
    const first = [-3, 6, -1];
    const q = refineSnap(axisInput(sid, i, [[pts[i * 3]!, pts[i * 3 + 1]!, -1], [pts[i * 3 + 3]!, pts[i * 3 + 4]!, -1]], first, 'x'), sn)!;
    expect(onAxis(q, first, 'x')).toBe(true);
    expect(Math.abs(q[0] - 8)).toBeLessThan(1e-9);
  });

  it('3차 베지어(G5): y = 3인 X축은 15t(1 − t) = 3의 두 근 자리 x = 30t² − 20t³', () => {
    const p = parseForView('b.nc', enc(['G21 G90 G17', 'G0 X0 Y0 Z0', 'G5 X10 Y0 I0 J5 P0 Q5 F300'].join('\n')));
    const sn: SnapMoves = p.nc!;
    const sid = p.scene.lines.find((l) => /^nc-cut-/.test(l.id))!.id;
    const pts = sn.moves.points;
    const first = [20, 3, 0];
    const got: number[] = [];
    for (let k = 0; k < sn.moves.count; k++) {
      if (!((pts[k * 3 + 1]! - 3) * (pts[k * 3 + 4]! - 3) < 0)) continue;
      const q = refineSnap(axisInput(sid, k, [[pts[k * 3]!, pts[k * 3 + 1]!, 0], [pts[k * 3 + 3]!, pts[k * 3 + 4]!, 0]], first, 'x'), sn)!;
      expect(onAxis(q, first, 'x')).toBe(true);
      got.push(q[0]);
    }
    const want = [(1 - Math.sqrt(0.2)) / 2, (1 + Math.sqrt(0.2)) / 2].map((t) => 30 * t * t - 20 * t * t * t);
    expect(got).toHaveLength(2);
    for (let k = 0; k < 2; k++) expect(Math.abs(got[k]! - want[k]!)).toBeLessThan(1e-9);
  });
});

describe('보정 경로 호·판재 둘레 호·구멍 테두리', () => {
  it('반경 보정 경로(nc-comp)의 호: y = 2인 X축은 보정 호 위 x = √(r² − 4)', () => {
    const cp = parseForView('c.nc', enc(['G21 G90 G17', 'T1 M6 (D=6)', 'G0 X0 Y-20 Z0', 'G41 D1 G1 X0 Y-10 F300', 'G3 X0 Y10 I0 J10', 'G40 G1 X0 Y20'].join('\n')), { comp: true });
    const comp = cp.nc!.comp!;
    const k = [...comp.kind.subarray(0, comp.count)].indexOf(1);
    const o = k * 6;
    const cx = comp.center[k * 3]!;
    const cy = comp.center[k * 3 + 1]!;
    const s = [comp.points[o]!, comp.points[o + 1]!, comp.points[o + 2]!];
    const r = Math.hypot(s[0]! - cx, s[1]! - cy);
    const t0 = Math.atan2(s[1]! - cy, s[0]! - cx);
    const sw = comp.sweep[k]!;
    const n = Math.ceil(Math.abs(sw) / (Math.PI / 36) - 1e-9);
    const P = (f: number): V3 => [cx + r * Math.cos(t0 + sw * f), cy + r * Math.sin(t0 + sw * f), s[2]!];
    // y = 2가 지나는 현
    const f = (Math.asin((2 - cy) / r) - t0) / sw;
    const j = Math.floor(f * n);
    const first = [-30, 2, s[2]!];
    const q = refineSnap(axisInput('nc-comp', comp.move[k]!, [P(j / n), P((j + 1) / n)], first, 'x'), cp.nc!)!;
    expect(onAxis(q, first, 'x')).toBe(true);
    expect(Math.abs(q[0] - (cx + Math.sqrt(r * r - (2 - cy) ** 2)))).toBeLessThan(1e-9);
  });

  // 판 400 × 300 × 18, 오른쪽 앞 모서리 R50(중심 (350,50)), 원형 포켓 Ø40(중심 (100,150)), 구멍 Ø20(중심 (300,200), 깊이 12)
  const PGI = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <outlines>
   <outline x="0" y="0" bulge="0" banding="0"/>
   <outline x="350" y="0" bulge="0.41421356237309503" banding="0"/>
   <outline x="400" y="50" bulge="0" banding="0"/>
   <outline x="400" y="300" bulge="0" banding="0"/>
   <outline x="0" y="300" bulge="0" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0"/>
  </outlines>
  <circle centerX="100" centerY="150" centerZ="0" radius="20" width="8" depth="10" direction="z-" empty="1" enable="1" order="1"/>
  <circle centerX="300" centerY="200" centerZ="0" radius="10" width="20" depth="12" direction="z-" empty="1" enable="1" order="2"/>
 </panel>
</pgi>`;
  const r = parseForView('p.pgi', enc(PGI));
  const t = r.mpr!.snap!;

  it('판 외곽선 둥근 모서리(그물 윤곽선): y = 20인 X축은 (390, 20, 18), 곧은 모서리는 null', () => {
    const C = (deg: number): V3 => [350 + 50 * Math.cos(deg * D), 50 + 50 * Math.sin(deg * D), 18];
    const first = [0, 20, 18];
    const q = refineSnap(axisInput('mpr-board', 5, [C(-40), C(-35)], first, 'x', 'edge'), t)!;
    expect(onAxis(q, first, 'x')).toBe(true);
    expect(Math.abs(q[0] - 390)).toBeLessThan(1e-9);
    expect(refineSnap(axisInput('mpr-board', 0, [[0, 0, 18], [350, 0, 18]], [200, 100, 18], 'y', 'edge'), t)).toBeNull();
  });

  it('원형 포켓 둘레와 구멍 테두리(한 바퀴 원): X축 y = 162 → (116, 162), Y축 x = 306 → (306, 208)', () => {
    const ring = r.scene.meshes.map((m) => m.id).filter((m) => panelArcsOf(t, `edge:${m}`).some((g) => g.cu === 100 && g.cv === 150))[0]!;
    const hole = r.scene.meshes.map((m) => m.id).filter((m) => panelArcsOf(t, `edge:${m}`).some((g) => g.cu === 300 && g.cv === 200))[0]!;
    expect(ring).toBeTruthy();
    expect(hole).toBeTruthy();
    expect(hole).not.toBe(ring);
    const Cr = (deg: number): V3 => [100 + 20 * Math.cos(deg * D), 150 + 20 * Math.sin(deg * D), 18];
    const first = [0, 162, 18];
    const q = refineSnap(axisInput(ring, 3, [Cr(30), Cr(40)], first, 'x', 'edge'), t)!;
    expect(onAxis(q, first, 'x')).toBe(true);
    expect(Math.abs(q[0] - 116)).toBeLessThan(1e-9);
    // 구멍 Ø20: x = 306이 테두리와 만나는 y = 200 + 8(53.13° — 현 45°→56.25°)
    const Ch = (deg: number): V3 => [300 + 10 * Math.cos(deg * D), 200 + 10 * Math.sin(deg * D), 18];
    const from = [306, 0, 18];
    const qh = refineSnap(axisInput(hole, 4, [Ch(45), Ch(56.25)], from, 'y', 'edge'), t)!;
    expect(onAxis(qh, from, 'y')).toBe(true);
    expect(Math.abs(qh[1] - 208)).toBeLessThan(1e-9);
  });
});
