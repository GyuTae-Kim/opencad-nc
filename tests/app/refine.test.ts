/**
 * 측정 붙잡기 다듬기·스플라인 접선(16차): 해석기 스플라인 표(G5·G5.1·G5.2/G5.3), 곡선 위 점 찾기(curve.ts — 가장 가까운 매개변수 1e-9),
 * 코어 0.14.0 refine에 주는 refineSnap(원호 이동·보정 경로 호·판재 윤곽 호·스플라인 조각의 수직 발·선분 위 점·가운데 점),
 * 스플라인 조각의 가운데 점(곡선 전체의 호 길이 가운데), 스플라인 끝·가운데·위 아무 점의 접선(ArcTangents).
 * 코어 입력(SnapRefineInput)은 손으로 만든다 — 진짜 코어로 하는 확인은 measure-refine-core.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SnapRefineInput } from 'opencad-viewer3d';
import { parseGcode } from '../../src/gcode';
import { MOVE_ARC, MOVE_FEED, type NcProgram } from '../../src/model';
import { parseForView } from '../../src/app/payload';
import { closestToRay, footsFrom, nearestOn, solveBracket, unitTangent, type Curve } from '../../src/app/curve';
import { pieceSag, splineCurve, splineMidParam, splineNearest, splineOfMove } from '../../src/app/spline';
import { refineSnap } from '../../src/app/refine';
import { moveSnapPoints, type SnapMoves } from '../../src/app/snap';
import { ArcTangents, splineTangentAt, splinesAt } from '../../src/app/tangent';

const run = (body: string, start = 'G0 X0 Y0 Z0', head = 'G21 G17 G90 G54'): NcProgram =>
  parseGcode(`${head}\n${start}\n${body}M2\n`, { dialect: 'linuxcnc', initialPosition: [0, 0, 0] });

const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const f32 = (p: readonly number[]): [number, number, number] => [Math.fround(p[0]!), Math.fround(p[1]!), Math.fround(p[2]!)];

/** 3차 베지어(평면) 점·도함수 */
const bez = (P: number[][], t: number): number[] => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * P[0]![k]! + 3 * u * u * t * P[1]![k]! + 3 * u * t * t * P[2]![k]! + t * t * t * P[3]![k]!);
};
const bezD = (P: number[][], t: number): number[] => {
  const u = 1 - t;
  return [0, 1].map((k) => 3 * u * u * (P[1]![k]! - P[0]![k]!) + 6 * u * t * (P[2]![k]! - P[1]![k]!) + 3 * t * t * (P[3]![k]! - P[2]![k]!));
};

/** 이동 i의 시작·끝 */
const ends = (nc: SnapMoves, i: number): [[number, number, number], [number, number, number]] => {
  const p = nc.moves.points;
  return [
    [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!],
    [p[i * 3 + 3]!, p[i * 3 + 4]!, p[i * 3 + 5]!],
  ];
};

/** 손으로 만든 코어 다듬기 입력(장면 선분은 float32 끝점) */
function input(kind: SnapRefineInput['kind'], id: string, index: number, e: readonly (readonly number[])[], point: readonly number[], first: readonly number[] | null = null, ray?: { origin: number[]; dir: number[] }): SnapRefineInput {
  return {
    kind,
    point: [point[0]!, point[1]!, point[2]!],
    segment: { kind: 'line', id, index, raw: 0, ends: [f32(e[0]!), f32(e[1]!)] },
    first: first ? [first[0]!, first[1]!, first[2]!] : null,
    ray: ray ? { origin: ray.origin as [number, number, number], dir: ray.dir as [number, number, number] } : { origin: [point[0]!, point[1]!, point[2]! + 100], dir: [0, 0, -1] },
  };
}

describe('해석기 스플라인 표', () => {
  const G5 = [
    [0, 0],
    [0, 5],
    [10, 5],
    [10, 0],
  ];

  it('G5·G5.1·G5.2/G5.3마다 곡선 하나: 차수·매듭·조정점(표시 좌표)·가중치, 조각 끝 매개변수가 이동 끝점 그대로', () => {
    const p = run(['G5 X10 Y0 I0 J5 P0 Q5 F300', 'G5.1 X20 Y0 I5 J-5', 'G5.2 P1 L3', 'X30 Y10 P1', 'X40 Y0 P2', 'G5.3', 'G1 X50'].join('\n') + '\n');
    expect(p.warnings).toEqual([]);
    const t = p.splines!;
    expect(t.count).toBe(3);
    expect([...t.degree]).toEqual([3, 2, 2]);
    // 이어진 곡선: 각 곡선의 이동은 앞 곡선 바로 뒤, 마지막 직선은 표에 없다
    expect(t.move[0]).toBe(0);
    expect(t.move[1]).toBe(t.moves[0]);
    expect(t.move[2]).toBe(t.move[1]! + t.moves[1]!);
    expect(t.move[2]! + t.moves[2]!).toBe(p.moves.count - 1);
    expect(splineOfMove(t, p.moves.count - 1)).toBe(-1);
    expect([...t.knots.subarray(t.knotStart[0]!, t.knotStart[1]!)]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect([...t.knots.subarray(t.knotStart[2]!, t.knotStart[3]!)]).toEqual([0, 0, 0, 1, 1, 1]);
    expect([...t.weight.subarray(t.ctrlStart[2]!, t.ctrlStart[3]!)]).toEqual([1, 1, 2]);
    expect([...t.ctrl.subarray(0, 12)]).toEqual([0, 0, 0, 0, 5, 0, 10, 5, 0, 10, 0, 0]);
    for (let k = 0; k < 3; k++) {
      const c = splineCurve(t, k, p.moves.points)!;
      expect(c).not.toBeNull();
      for (let j = 0; j < c.moves; j++) {
        const [s, e] = ends(p, c.move + j);
        expect(dist(c.at(c.piece(j)[0]), s)).toBeLessThan(1e-9);
        expect(dist(c.at(c.piece(j)[1]), e)).toBeLessThan(1e-9);
        expect(splineOfMove(t, c.move + j)).toBe(k);
      }
    }
    // 3차 베지어의 점·도함수
    const c0 = splineCurve(t, 0, p.moves.points)!;
    for (const u of [0, 0.13, 0.5, 0.91, 1]) {
      expect(dist(c0.at(u), [...bez(G5, u), 0])).toBeLessThan(1e-12);
      expect(dist(c0.d1(u), [...bezD(G5, u), 0])).toBeLessThan(1e-12);
    }
  });

  it('작업 좌표계 원점·좌표 회전(G68)을 거친 표시 좌표로 남기고, 회전축 감기 중의 곡선은 넣지 않는다', () => {
    const p = run('G5 X10 Y0 I0 J5 P0 Q5 F300\n', 'G10 L2 P2 X100 Y50 Z0\nG55\nG68 X0 Y0 R90\nG0 X0 Y0 Z0');
    const t = p.splines!;
    expect(t.count).toBe(1);
    const c = splineCurve(t, 0, p.moves.points)!;
    // (0,0) → (10,0)을 90° 돌려 G55 원점 (100,50)으로: 끝 (100,60)
    expect(dist(c.at(c.lo), [100, 50, 0])).toBeLessThan(1e-9);
    expect(dist(c.at(c.hi), [100, 60, 0])).toBeLessThan(1e-9);
    const rot = parseGcode('G21 G17 G90\nG0 X0 Y0 Z0 A0\nG1 A10 F100\nG5 X10 Y0 I0 J5 P0 Q5\nM2\n', { dialect: 'linuxcnc', initialPosition: [0, 0, 0], rotary: true });
    expect(rot.splines).toBeUndefined();
  });

  it('조각 끝이 곡선에서 옮겨졌으면(다른 처리로 끝점이 바뀜) 그 곡선은 쓰지 않는다', () => {
    const p = run('G5 X10 Y0 I0 J5 P0 Q5 F300\n');
    const pts = Float64Array.from(p.moves.points);
    pts[3 * 3] += 0.01;
    expect(splineCurve(p.splines!, 0, p.moves.points)).not.toBeNull();
    expect(splineCurve({ ...p.splines! }, 0, pts)).toBeNull();
  });
});

describe('곡선 위 점 찾기(구간 나눔 + 뉴턴)', () => {
  // 가중치 1·√2/2·1인 2차 NURBS = 반지름 10의 1/4 원(중심 원점) — 정확한 답을 안다
  const q = run(`G5.2 P1 L3 F500\nX10 Y10 P${Math.SQRT1_2}\nX0 Y10 P1\nG5.3\n`, 'G0 X10 Y0 Z-1');
  const circle = splineCurve(q.splines!, 0, q.moves.points)!;
  const g5 = run('G5 X10 Y0 I0 J5 P0 Q5 F300\n');
  const cubic = splineCurve(g5.splines!, 0, g5.moves.points)!;

  it('가장 가까운 매개변수: 곡선 위 u*에서 법선으로 비킨 점은 u*로 1e-9 안에 돌아온다(원 근사 NURBS·3차 베지어)', () => {
    for (const c of [circle, cubic] as Curve[]) {
      for (const u of [0.03, 0.27, 0.5, 0.64, 0.97]) {
        const p = c.at(u);
        const t = unitTangent(c, u)!;
        const n = [-t[1], t[0], 0];
        for (const off of [0.004, -0.004, 0.3, -0.3]) {
          const r = nearestOn(c, [p[0] + off * n[0]!, p[1] + off * n[1]!, p[2]]);
          expect(Math.abs(r.u - u)).toBeLessThan(1e-9);
          expect(Math.abs(r.dist - Math.abs(off))).toBeLessThan(1e-9);
        }
      }
    }
    // 원 근사 NURBS: 원 위 자리는 각으로 정확히 안다
    for (const deg of [5, 33, 61, 88]) {
      const r = nearestOn(circle, [12 * Math.cos((deg * Math.PI) / 180), 12 * Math.sin((deg * Math.PI) / 180), -1]);
      const p = circle.at(r.u);
      expect(Math.abs(Math.atan2(p[1], p[0]) - (deg * Math.PI) / 180)).toBeLessThan(1e-9);
      expect(Math.abs(r.dist - 2)).toBeLessThan(1e-9);
    }
  });

  it('조각으로 고른 시작값(splineNearest)도 같은 자리이고, 조각 번호를 준다', () => {
    const u = 0.4321;
    const p = cubic.at(u);
    const r = splineNearest(cubic, [p[0] + 0.001, p[1], p[2]], g5.moves.points);
    expect(Math.abs(cubic.at(r.u)[0] - p[0])).toBeLessThan(0.002);
    expect(cubic.piece(r.j)[0]).toBeLessThanOrEqual(r.u);
    expect(cubic.piece(r.j)[1]).toBeGreaterThanOrEqual(r.u);
    // 조각의 처짐은 해석기 허용치(0.005 mm) 안팎
    expect(pieceSag(cubic, r.j)).toBeLessThan(0.008);
    expect(pieceSag(cubic, r.j)).toBeGreaterThan(0.001);
  });

  it('수직 발·광선에 가장 가까운 점·근 찾기', () => {
    // 원 밖 (30,40)에서 원에 내린 발: 원 위 (6,8)
    const f = footsFrom(circle, [30, 40, -1]);
    expect(f).toHaveLength(1);
    expect(dist(circle.at(f[0]!), [6, 8, -1])).toBeLessThan(1e-9);
    // 위에서 내려다본 광선(원 위 (8,6) 바깥 쪽 (8.8,6.6) 위)
    const r = closestToRay(circle, [8.8, 6.6, 50], [0, 0, -1]);
    expect(dist(circle.at(r.u), [8, 6, -1])).toBeLessThan(1e-9);
    expect(solveBracket((x) => x * x - 2, (x) => 2 * x, 0, 2)).toBeCloseTo(Math.SQRT2, 14);
  });

  it('스플라인 조각의 가운데 점은 곡선 전체의 호 길이 가운데(곡선 위)', () => {
    const k = splineOfMove(g5.splines, 3);
    const mids = moveSnapPoints({ kind: 'line', id: 'nc-cut-T-1', index: 3, point: [0, 0, 0] } as never, g5)!;
    expect(mids).toHaveLength(1);
    expect(mids[0]!.kind).toBe('midpoint');
    // 대칭인 곡선이라 호 길이 가운데 = t 0.5 = (5, 3.75)
    expect(dist(mids[0]!.point, [5, 3.75, 0])).toBeLessThan(1e-9);
    // 대칭이 아닌 곡선: 시작·가운데·끝 사이 길이가 같다(촘촘한 적분)
    const a = run('G5 X10 Y0 I0 J8 P-6 Q1 F300\n');
    const c = splineCurve(a.splines!, 0, a.moves.points)!;
    const um = splineMidParam(a.splines!, c);
    const len = (lo: number, hi: number): number => {
      let s = 0;
      for (let i = 0; i < 20000; i++) {
        const t = c.d1(lo + ((hi - lo) * (i + 0.5)) / 20000);
        s += Math.hypot(t[0], t[1], t[2]);
      }
      return (s * (hi - lo)) / 20000;
    };
    expect(Math.abs(len(c.lo, um) - len(um, c.hi))).toBeLessThan(1e-6);
    expect(Math.abs(um - 0.5)).toBeGreaterThan(0.01);
    expect(k).toBe(0);
  });
});

describe('붙잡기 다듬기(refineSnap)', () => {
  // (0,40) → (40,40) 시계 1/4 원(중심 (20,20), R = 20√2) → 직선 (60,40)
  const parsed = parseForView('arc.nc', new TextEncoder().encode(['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40'].join('\n')));
  const nc = parsed.nc!;
  const arc = [...nc.moves.kind].indexOf(MOVE_ARC);
  const id = parsed.scene.lines.find((l) => /^nc-cut-/.test(l.id))!.id;
  const R = 20 * Math.SQRT2;
  const C = [20, 20, 0];
  const at = (deg: number): number[] => [20 + R * Math.cos((deg * Math.PI) / 180), 20 + R * Math.sin((deg * Math.PI) / 180), 0];
  // 장면 현: 5°씩 18개(135° → 45°) — 셋째 현은 125° → 120°
  const chord = [at(125), at(120)];
  const onChord = (s: number): number[] => chord[0]!.map((v, k) => v + (chord[1]![k]! - v) * s);

  it('선분 위 점: 위에서 본 광선에 가장 가까운 원 위 점(현의 처짐만큼 바깥으로)', () => {
    const p = onChord(0.3);
    const q = refineSnap(input('onEdge', id, arc, chord, p), nc)!;
    expect(Math.abs(dist(q, C) - R)).toBeLessThan(1e-9);
    // 광선(그 점 위에서 아래로)의 XY와 같은 각
    expect(Math.abs(Math.atan2(q[1] - 20, q[0] - 20) - Math.atan2(p[1]! - 20, p[0]! - 20))).toBeLessThan(1e-9);
    expect(dist(q, p)).toBeGreaterThan(0.005);
  });

  it('수직 발: 첫 점에서 원에 내린 발(원 위, 반지름 방향), 첫 점이 중심이면 코어 점에 가장 가까운 원 위 점', () => {
    const first = [20 + 60 * Math.cos((122 * Math.PI) / 180), 20 + 60 * Math.sin((122 * Math.PI) / 180), 0];
    // 코어 발: 첫 점에서 현에 내린 발
    const a = chord[0]!;
    const b = chord[1]!;
    const v = [b[0]! - a[0]!, b[1]! - a[1]!, 0];
    const s = dot([first[0]! - a[0]!, first[1]! - a[1]!, 0], v) / dot(v, v);
    const foot = onChord(s);
    const q = refineSnap(input('perpendicular', id, arc, chord, foot, first), nc)!;
    expect(dist(q, at(122))).toBeLessThan(1e-9);
    // 첫 점 = 중심: 어디나 발 — 코어 점(현 가운데)에서 반지름 방향의 원 위 점
    const mid = onChord(0.5);
    const q2 = refineSnap(input('perpendicular', id, arc, chord, mid, C), nc)!;
    expect(dist(q2, at(122.5))).toBeLessThan(1e-9);
    // 발이 원호 밖(현 위 발은 있어도 원 위 발이 이 토막 둘레에 없음)이면 코어 점 그대로
    expect(refineSnap(input('perpendicular', id, arc, chord, mid, [20 + 60 * Math.cos(0.3), 20 + 60 * Math.sin(0.3), 0]), nc)).toBeNull();
    // 첫 점이 없으면 다듬지 않는다
    expect(refineSnap(input('perpendicular', id, arc, chord, mid), nc)).toBeNull();
  });

  it('토막 가운데 점: 토막 두 끝 매개변수 가운데의 원 위 점, 직선 이동·모르는 묶음·원호 밖 토막은 null', () => {
    // 토막 끝은 장면 float32 좌표라 매개변수가 그만큼(1e-7 안팎) 흔들린다 — 점은 원 위 그대로
    const qm = refineSnap(input('midpoint', id, arc, chord, onChord(0.5)), nc)!;
    expect(Math.abs(dist(qm, C) - R)).toBeLessThan(1e-9);
    expect(dist(qm, at(122.5))).toBeLessThan(1e-5);
    const line = arc + 1;
    expect(nc.moves.kind[line]).toBe(MOVE_FEED);
    expect(refineSnap(input('onEdge', id, line, ends(nc, line), [50, 40, 0]), nc)).toBeNull();
    expect(refineSnap(input('onEdge', 'nc-rapid', arc, chord, onChord(0.5)), nc)).toBeNull();
    // 이동 번호는 원호인데 토막이 그 원호 위가 아님(다른 모양)
    expect(refineSnap(input('onEdge', id, arc, [chord[0]!, [0, 0, 0]], onChord(0.5)), nc)).toBeNull();
    // 그물 윤곽선은 다듬지 않는다
    const e = input('onEdge', id, arc, chord, onChord(0.5));
    expect(refineSnap({ ...e, segment: { ...e.segment, kind: 'edge' } }, nc)).toBeNull();
  });

  it('나선(높이가 바뀌는 원호): 선분 위 점도 나선 위', () => {
    const h = parseForView('h.nc', new TextEncoder().encode(['G21 G90 G17', 'G0 X10 Y0 Z0', 'G3 X10 Y0 Z-6 I-10 J0 P2 F300'].join('\n')));
    const hn = h.nc!;
    const i = [...hn.moves.kind].indexOf(MOVE_ARC);
    const hid = h.scene.lines.find((l) => /^nc-cut-/.test(l.id))!.id;
    // 두 바퀴 720°를 5°씩: 둘째 바퀴 100° → 105°(f = 460/720 → 465/720)
    const P = (deg: number): number[] => [10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180), (-6 * deg) / 720];
    const seg = [P(460), P(465)];
    const p = seg[0]!.map((v, k) => (v + seg[1]![k]!) / 2);
    const q = refineSnap(input('onEdge', hid, i, seg, p), hn)!;
    expect(Math.abs(Math.hypot(q[0], q[1]) - 10)).toBeLessThan(1e-9);
    const deg = 360 + (Math.atan2(q[1], q[0]) * 180) / Math.PI;
    expect(Math.abs(q[2] - (-6 * deg) / 720)).toBeLessThan(1e-9);
    expect(deg).toBeCloseTo(462.5, 6);
  });

  it('보정 경로(nc-comp)의 호와 판재 윤곽 호도 원 위로', () => {
    const cp = parseForView('c.nc', new TextEncoder().encode(['G21 G90 G17', 'T1 M6 (D=6)', 'G0 X0 Y-20 Z0', 'G41 D1 G1 X0 Y-10 F300', 'G3 X0 Y10 I0 J10', 'G40 G1 X0 Y20'].join('\n')), { comp: true });
    const comp = cp.nc!.comp!;
    const k = [...comp.kind.subarray(0, comp.count)].indexOf(1);
    expect(k).toBeGreaterThanOrEqual(0);
    const o = k * 6;
    const cx = comp.center[k * 3]!;
    const cy = comp.center[k * 3 + 1]!;
    const s = [comp.points[o]!, comp.points[o + 1]!, comp.points[o + 2]!];
    const r = Math.hypot(s[0]! - cx, s[1]! - cy);
    const t0 = Math.atan2(s[1]! - cy, s[0]! - cx);
    const sw = comp.sweep[k]!;
    const n = Math.ceil(Math.abs(sw) / (Math.PI / 36) - 1e-9);
    const P = (f: number): number[] => [cx + r * Math.cos(t0 + sw * f), cy + r * Math.sin(t0 + sw * f), s[2]!];
    const seg = [P(3 / n), P(4 / n)];
    const q = refineSnap(input('onEdge', 'nc-comp', comp.move[k]!, seg, seg[0]!.map((v, i) => (v + seg[1]![i]!) / 2)), cp.nc!)!;
    expect(Math.abs(Math.hypot(q[0] - cx, q[1] - cy) - r)).toBeLessThan(1e-9);
    // 판재: 윤곽 가공의 반시계 호 R20(중심 (80,40))
    const MPR = ['[H', 'VERSION="4.0 Alpha"', '_BSX=300.000000', '_BSY=200.000000', '_BSZ=19.000000', '', ']1', '$E0', 'KP', 'X=20', 'Y=20', 'Z=19', '', '$E1', 'KL', 'X=80', 'Y=20', '', '$E2', 'KA', 'X=100', 'Y=40', 'DS=1', 'R=20', '', '$E3', 'KL', 'X=100', 'Y=80', '', '<100 \\WerkStck\\', 'LA="300"', 'BR="200"', 'DI="19"', '', '<105 \\Konturfraesen\\', 'EA="1:0"', 'EE="1:3"', 'TNO="101"', 'ZA="5"', '!', ''].join('\n');
    const m = parseForView('t.mpr', new TextEncoder().encode(MPR));
    const route = m.scene.lines.find((l) => /^mpr-op-/.test(l.id))!;
    const z = route.positions[2]!;
    const A = (deg: number): number[] => [80 + 20 * Math.cos((deg * Math.PI) / 180), 40 + 20 * Math.sin((deg * Math.PI) / 180), z];
    const pseg = [A(-60), A(-55)];
    const pq = refineSnap(input('onEdge', route.id, route.segmentIds![0]!, pseg, pseg[0]!.map((v, i) => (v + pseg[1]![i]!) / 2)), m.mpr!.snap!)!;
    expect(Math.abs(Math.hypot(pq[0] - 80, pq[1] - 40) - 20)).toBeLessThan(1e-9);
    // 판재 직선 요소 위는 null
    expect(refineSnap(input('onEdge', route.id, route.segmentIds![0]!, [A(-90), [60, 20, z]], [70, 20, z]), m.mpr!.snap!)).toBeNull();
  });

  it('스플라인 조각: 선분 위 점·수직 발·토막 가운데 점이 곡선 위(원 근사 NURBS는 정확히 반지름 10)', () => {
    const p = parseForView('n.nc', new TextEncoder().encode(['G21 G90 G17', 'G0 X10 Y0 Z-1', `G5.2 P1 L3 F500`, `X10 Y10 P${Math.SQRT1_2}`, 'X0 Y10 P1', 'G5.3'].join('\n')));
    const sn = p.nc!;
    expect(sn.splines?.count).toBe(1);
    const sid = p.scene.lines.find((l) => /^nc-cut-/.test(l.id))!.id;
    const i = 7;
    const [a, b] = ends(sn, i);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -1];
    const q = refineSnap(input('onEdge', sid, i, [a, b], mid), sn)!;
    expect(Math.abs(Math.hypot(q[0], q[1]) - 10)).toBeLessThan(1e-9);
    expect(Math.abs(Math.atan2(q[1], q[0]) - Math.atan2(mid[1]!, mid[0]!))).toBeLessThan(1e-9);
    // 원 밖 첫 점에서 내린 발 = 반지름 방향의 원 위 점
    const ang = Math.atan2(mid[1]!, mid[0]!);
    const first = [30 * Math.cos(ang + 0.001), 30 * Math.sin(ang + 0.001), -1];
    const qf = refineSnap(input('perpendicular', sid, i, [a, b], mid, first), sn)!;
    expect(dist(qf, [10 * Math.cos(ang + 0.001), 10 * Math.sin(ang + 0.001), -1])).toBeLessThan(1e-9);
    const qm = refineSnap(input('midpoint', sid, i, [a, b], mid), sn)!;
    expect(Math.abs(Math.hypot(qm[0], qm[1]) - 10)).toBeLessThan(1e-9);
  });
});

describe('스플라인 접선(끝·가운데·위 아무 점, 커서 쪽)', () => {
  // G5 (0,0) → (10,0): 시작 접선 (0,1), 끝 접선 (0,−1)(진행), 이어서 직선 (20,0)
  const P = [
    [0, 0],
    [0, 5],
    [10, 5],
    [10, 0],
  ];
  const nc = run('G5 X10 Y0 I0 J5 P0 Q5 F300\nG1 X20\n');
  const c = splineCurve(nc.splines!, 0, nc.moves.points)!;
  const T = (t: number): number[] => {
    const d = bezD(P, t);
    const l = Math.hypot(d[0]!, d[1]!);
    return [d[0]! / l, d[1]! / l, 0];
  };
  const on = (t: number): number[] => [...bez(P, t), 0];

  it('시작 끝에서는 곡선 쪽, 끝 끝에서는 그 반대(곡선 쪽), 이어진 직선 위면 없음', () => {
    const tg = new ArcTangents();
    expect(splinesAt(nc, [0, 0, 0])).toHaveLength(1);
    expect(dist(tg.at(nc, [0, 0, 0], on(0.4))!, T(0))).toBeLessThan(1e-12);
    expect(dist(tg.at(nc, [10, 0, 0], on(0.4))!, T(1).map((v) => -v))).toBeLessThan(1e-12);
    expect(tg.at(nc, [10, 0, 0], [15, 0, 0])).toBeNull();
    // 곡선에서 떨어진 첫 점
    expect(splinesAt(nc, [5, 1, 0])).toEqual([]);
  });

  it('가운데 점(호 길이 가운데)·조각 위 아무 점: 그 자리의 정확한 접선, 커서가 앞이면 진행·뒤면 반대', () => {
    const tg = new ArcTangents();
    const m = moveSnapPoints({ kind: 'line', id: 'nc-cut-T-1', index: 2, point: [0, 0, 0] } as never, nc)![0]!.point;
    expect(dist(tg.at(nc, m, on(0.8))!, T(0.5))).toBeLessThan(1e-9);
    expect(dist(tg.at(nc, m, on(0.1))!, T(0.5).map((v) => -v))).toBeLessThan(1e-9);
    // 조각 위 아무 점(현 가운데 — 곡선에서 처짐만큼 안쪽): 곡선 위 가장 가까운 매개변수의 접선
    const j = 5;
    const [a, b] = ends(nc, j);
    const chordMid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
    const u = nearestOn(c, chordMid).u;
    const hits = splinesAt(nc, chordMid);
    expect(hits).toHaveLength(1);
    expect(Math.abs(hits[0]!.u - u)).toBeLessThan(1e-9);
    expect(dist(splineTangentAt(nc, hits, chordMid, on(0.9))!, T(u))).toBeLessThan(1e-9);
    expect(dist(splineTangentAt(nc, hits, chordMid, on(0.01))!, T(u).map((v) => -v))).toBeLessThan(1e-9);
    // 커서가 곡선 밖(직선 위)·첫 점 자리면 없음
    expect(splineTangentAt(nc, hits, chordMid, [18, 0, 0])).toBeNull();
    expect(splineTangentAt(nc, hits, chordMid, chordMid)).toBeNull();
    // 재생 중: 커서 아래 조각을 아직 그리지 않았으면 없음
    expect(splineTangentAt(nc, hits, chordMid, on(0.9), 3)).toBeNull();
  });

  it('스플라인 표가 없는(예전 결과·직선으로 그린 곡선) 문서는 접선을 주지 않는다', () => {
    const bare: SnapMoves = { moves: nc.moves, arcs: nc.arcs };
    expect(new ArcTangents().at(bare, [0, 0, 0], on(0.4))).toBeNull();
    expect(dot(T(0), [0, 1, 0])).toBeCloseTo(1, 12);
  });
});
