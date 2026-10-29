/**
 * 측정 방향 잠금의 원호 접선(measure-lock.ts가 코어 setMeasureInferenceLock({ direction, kind: 'parallel' })에 준다).
 *
 * 첫 측정 점이 원호 이동(G2/G3, 나선 포함)의 시작·끝이고 커서 아래 점이 그 원호 위면 그 끝에서 원호 쪽으로 가는 접선 방향을 준다.
 * 첫 점이 원호의 가운데 점(앱이 주는 원호 가운데 점 붙잡기 — snap.ts moveSnapPoints·movePointAt f = 0.5)이면 그 점의 접선(14차),
 * 원호 위 다른 자리(현 위 아무 점·현의 끝 — 코어 모서리 붙잡기)면 원호 위 가장 가까운 자리의 접선(15차 — 점은 코어 점 그대로, 방향만).
 * 판재 가공(MPR·PGI·XML)의 윤곽 호(워커가 보낸 붙잡기 표 PanelSnapTable의 호 요소)도 같은 규칙이다(15차).
 * - 장면은 원호를 짧은 현 여럿으로 그리므로(scene.ts — 실제로 쓴 나누기 각은 scene.meta.arcAngle, 판재는 기본 5°) 첫 점·커서 아래 점(현 위)은
 *   원호에서 현의 처짐만큼 떨어질 수 있다. 원호까지 거리가 그 처짐(과 float32 장면 좌표의 반올림) 안이면 원호 위로 본다. 다른 끝(끝점)도 원호 위다.
 * - 접선은 장면이 호를 나누는 식(평면 축의 각·반지름과 직선 축을 f만큼 — snap.ts movePointAt)을 f로 미분한 것이라 나선의 높이 기울기와
 *   반지름이 조금 바뀌는 호도 맞다. 방향(부호)은 첫 점에서 원호를 따라 커서 쪽으로 나가는 쪽이다: 시작이면 진행 방향, 끝이면 그 반대,
 *   가운데 점·다른 자리면 커서 자리(f)가 앞이면 진행 방향, 뒤면 반대(한 바퀴 원은 가까운 쪽으로 돈다). 잠금은 선이라 부호는 결과 방향에만 든다.
 * - 첫 점에 닿는 원호는 첫 점마다 한 번 찾고 커서가 움직일 때는 그 몇 개만 본다(arcTangentAt). 18차부터 코어 0.16.0이 찍은 점에 싣는
 *   선분 식별자(segment, 교차점이면 둘째 other)로 그 이동(판재는 그 윤곽·둘레 호)만 본다(ncFirstCurves·panelFirstCurves).
 *   식별자가 없는 점(앱의 원호 가운데 점·중심, 축 위 점), 모르는 묶음(회전축 등), 이동·요소가 바뀌는 꼭짓점은 예전처럼 모든 이동
 *   (판재는 모든 호 요소)에서 좌표로 찾는다(arcEndsAt·arcMidsAt·arcsOnAt·panelArcsAt) — 꼭짓점의 식별자는 고른 쪽 토막 하나뿐이고
 *   닫힌 윤곽·들어가기 호처럼 차례가 떨어진 이동이 같은 꼭짓점을 다시 지나기도 한다(실제 판재 파일의 호 끝 꼭짓점 36,759곳 가운데 2,489곳에서
 *   다른 윤곽의 호 끝이 만났다). 커서 아래 점이 그 곡선 위인지는 식별자 없이 거리로 본다(앱의 가운데 점 붙잡기는 식별자가 없고, 방향에 그 자리 f가 든다).
 * - 반경 보정 경로(공구 중심 — 선분 묶음 'nc-comp', 19차)의 호도 같은 규칙이다: 워커가 보낸 보정 조각(NcCompSnap — 조각마다 시작·끝·호 중심·
 *   중심각·평면, 반지름은 중심에서 시작까지)에서 호 모양을 만들고(compShape), 첫 점 식별자(선분 번호 = 원래 이동 번호)로 그 이동의 보정 조각만 본다
 *   (compFirstEnds). 보정 조각이 바뀌는 꼭짓점·보정 호의 가운데 점(앱 점)은 좌표로 모든 보정 호에서 찾는다. 원호 번호는 이동 수 + 조각 번호이고
 *   재생 한도는 그 조각의 원래 이동 번호로 견준다(ncShape·ncOrder).
 * - 스플라인(G5 3차·G5.1 2차 베지어, G5.2/G5.3 NURBS — 16차)도 같은 규칙이다: 해석기가 남긴 곡선 정의(스플라인 표 — spline.ts)로
 *   첫 점(끝·가운데 점·조각 위 아무 점)의 곡선 위 가장 가까운 매개변수(조각 나눔으로 시작값 → 뉴턴)를 찾아 그 자리의 정확한 접선을 주고,
 *   방향은 커서 자리 매개변수가 앞이면 진행 방향, 뒤면 반대(닫힌 곡선은 가까운 쪽). 커서 아래 점이 곡선 위인지는 그 조각의 처짐으로 본다
 *   (splinesAt·splineTangentAt). 커서 아래 점이 원호와 스플라인 둘 다의 위면 더 가까운 곡선.
 */
import type { SnapSegment } from 'opencad-viewer3d';
import { MOVE_ARC, PLANE_AXES, type NcSplines } from '../model';
import type { OutlineForm, PanelSnapTable } from '../scene';
import { playPosition, type NcDoc } from './doc';
import type { NcCompSnap } from './protocol';
import { PATH_SET, type SnapMoves } from './snap';
import { unitTangent, type Curve } from './curve';
import { pieceSag, splineCurve, splineNearest, splineOfMove, type SplineCurve } from './spline';

type V3 = [number, number, number];
const TAU = Math.PI * 2;
/** 장면이 호를 나누는 기본 각(scene.ts — 판재 장면은 늘 이것, NC 장면은 meta.arcAngle) */
const ARC_ANGLE = Math.PI / 36;

/**
 * 첫 점에 닿는 원호 자리: 원호 번호(NC는 이동 차례, 판재는 panelArcs 차례)와 어느 자리
 * (0 = 시작, 1 = 끝, 0.5 = 가운데 점 — arcMidsAt, 'on' = 그 밖의 원호 위 자리 — arcsOnAt, 원호 위 가장 가까운 자리는 f)
 */
export interface ArcEnd {
  move: number;
  end: 0 | 0.5 | 1 | 'on';
  /** end가 'on'일 때 첫 점에서 원호 위 가장 가까운 자리(0~1) */
  f?: number;
}

/** 같은 자리로 볼 허용치: 좌표 크기의 1e-6(장면이 float32라 생기는 반올림을 넉넉히 덮는다) */
export function pointTol(p: ArrayLike<number>): number {
  return 1e-6 * (1 + Math.max(Math.abs(p[0]!), Math.abs(p[1]!), Math.abs(p[2]!)));
}

/** 두 점이 축마다 tol 안인지 */
const near = (q: ArrayLike<number>, a: ArrayLike<number>, tol: number): boolean => Math.abs(q[0]! - a[0]!) <= tol && Math.abs(q[1]! - a[1]!) <= tol && Math.abs(q[2]! - a[2]!) <= tol;

/** 시작이나 끝이 a(축마다 tol 안)인 원호 이동(이동 차례, 많아야 limit개) */
export function arcEndsAt(nc: SnapMoves, a: ArrayLike<number>, tol = pointTol(a), limit = 16): ArcEnd[] {
  const m = nc.moves;
  const p = m.points;
  const ax = a[0]!;
  const ay = a[1]!;
  const az = a[2]!;
  const out: ArcEnd[] = [];
  for (let i = 0; i < m.count && out.length < limit; i++) {
    if (m.kind[i] !== MOVE_ARC || m.arc[i]! < 0) continue;
    const o = i * 3;
    if (Math.abs(p[o]! - ax) <= tol && Math.abs(p[o + 1]! - ay) <= tol && Math.abs(p[o + 2]! - az) <= tol) out.push({ move: i, end: 0 });
    if (Math.abs(p[o + 3]! - ax) <= tol && Math.abs(p[o + 4]! - ay) <= tol && Math.abs(p[o + 5]! - az) <= tol) out.push({ move: i, end: 1 });
  }
  return out;
}

/**
 * 가운데 점이 a(축마다 tol 안)인 원호 이동(이동 차례, 많아야 limit개 — end 0.5). 가운데 점은 앱의 원호 가운데 점 붙잡기(snap.ts movePointAt
 * f = 0.5)와 같은 식(각·반지름·직선 축을 반씩)이다. 직선 축 높이와 중심에서 거리로 먼저 거르고 남은 것만 각을 계산한다
 */
export function arcMidsAt(nc: SnapMoves, a: ArrayLike<number>, tol = pointTol(a), limit = 16): ArcEnd[] {
  const m = nc.moves;
  const p = m.points;
  const arcs = nc.arcs;
  const out: ArcEnd[] = [];
  for (let i = 0; i < m.count && out.length < limit; i++) {
    if (m.kind[i] !== MOVE_ARC) continue;
    const ai = m.arc[i]!;
    if (ai < 0 || ai >= arcs.sweep.length) continue;
    const sweep = arcs.sweep[ai]!;
    if (!(Math.abs(sweep) > 1e-12)) continue;
    const [a0, a1, a2] = PLANE_AXES[arcs.plane[ai]!] ?? PLANE_AXES[0]!;
    const o = i * 3;
    if (Math.abs((p[o + a2]! + p[o + 3 + a2]!) / 2 - a[a2]!) > tol) continue;
    const cu = arcs.center[ai * 3 + a0]!;
    const cv = arcs.center[ai * 3 + a1]!;
    const su = p[o + a0]! - cu;
    const sv = p[o + a1]! - cv;
    const r = (Math.hypot(su, sv) + Math.hypot(p[o + 3 + a0]! - cu, p[o + 3 + a1]! - cv)) / 2;
    if (Math.abs(Math.hypot(a[a0]! - cu, a[a1]! - cv) - r) > 2 * tol) continue;
    const t = Math.atan2(sv, su) + sweep / 2;
    if (Math.abs(cu + r * Math.cos(t) - a[a0]!) <= tol && Math.abs(cv + r * Math.sin(t) - a[a1]!) <= tol) out.push({ move: i, end: 0.5 });
  }
  return out;
}

/** 원호 하나의 모양(평면 축, 중심, 시작·끝과 그 반지름, 시작 각, 부호 있는 중심각) — NC 원호 이동이나 판재 윤곽의 호 요소 */
export interface ArcShape {
  s: readonly number[];
  e: readonly number[];
  a0: number;
  a1: number;
  a2: number;
  cu: number;
  cv: number;
  r0: number;
  r1: number;
  t0: number;
  sweep: number;
  /** 장면이 이 호를 나눈 각(라디안 — 토막 하나가 도는 각). 없으면 문서의 나누기 각(판재 구멍 테두리·둥근 사각 포켓 모서리처럼 다를 때 — 17차) */
  step?: number;
}

/** 시작·끝·평면 축·중심·중심각으로 모양을 만든다. 중심각이 없으면(직선) null */
export function shapeOf(s: readonly number[], e: readonly number[], a0: number, a1: number, a2: number, cu: number, cv: number, sweep: number): ArcShape | null {
  if (!(Math.abs(sweep) > 1e-12)) return null;
  const r0 = Math.hypot(s[a0]! - cu, s[a1]! - cv);
  const r1 = Math.hypot(e[a0]! - cu, e[a1]! - cv);
  return { s, e, a0, a1, a2, cu, cv, r0, r1, t0: Math.atan2(s[a1]! - cv, s[a0]! - cu), sweep };
}

/** 원호 이동 i의 모양. 원호가 아니거나 중심각이 없으면 null */
export function arcShape(nc: SnapMoves, i: number): ArcShape | null {
  const m = nc.moves;
  if (!(i >= 0 && i < m.count) || m.kind[i] !== MOVE_ARC) return null;
  const ai = m.arc[i]!;
  const a = nc.arcs;
  if (ai < 0 || ai >= a.sweep.length) return null;
  const [a0, a1, a2] = PLANE_AXES[a.plane[ai]!] ?? PLANE_AXES[0]!;
  const p = m.points;
  const o = i * 3;
  return shapeOf([p[o]!, p[o + 1]!, p[o + 2]!], [p[o + 3]!, p[o + 4]!, p[o + 5]!], a0, a1, a2, a.center[ai * 3 + a0]!, a.center[ai * 3 + a1]!, a.sweep[ai]!);
}

/** 원호 위 f(0~1) 자리(장면이 호를 나눌 때와 같은 식) */
export function shapeAt(g: ArcShape, f: number): V3 {
  const t = g.t0 + g.sweep * f;
  const r = g.r0 + (g.r1 - g.r0) * f;
  const q: V3 = [0, 0, 0];
  q[g.a0] = g.cu + r * Math.cos(t);
  q[g.a1] = g.cv + r * Math.sin(t);
  q[g.a2] = g.s[g.a2]! + (g.e[g.a2]! - g.s[g.a2]!) * f;
  return q;
}

/**
 * 원호 모양 → 매개변수 곡선(f 0~1 — 장면이 호를 나누는 식과 그 1·2차 도함수: 나선의 높이, 반지름이 조금 바뀌는 호도 같은 식).
 * 붙잡기 다듬기(refine.ts)가 curve.ts의 뉴턴 찾기에 준다
 */
export function arcCurve(g: ArcShape): Curve {
  const dr = g.r1 - g.r0;
  const sw = g.sweep;
  const dz = g.e[g.a2]! - g.s[g.a2]!;
  return {
    lo: 0,
    hi: 1,
    at: (f) => shapeAt(g, f),
    d1: (f) => {
      const t = g.t0 + sw * f;
      const r = g.r0 + dr * f;
      const d: V3 = [0, 0, 0];
      d[g.a0] = dr * Math.cos(t) - r * sw * Math.sin(t);
      d[g.a1] = dr * Math.sin(t) + r * sw * Math.cos(t);
      d[g.a2] = dz;
      return d;
    },
    d2: (f) => {
      const t = g.t0 + sw * f;
      const r = g.r0 + dr * f;
      const d: V3 = [0, 0, 0];
      d[g.a0] = -2 * dr * sw * Math.sin(t) - r * sw * sw * Math.cos(t);
      d[g.a1] = 2 * dr * sw * Math.cos(t) - r * sw * sw * Math.sin(t);
      return d;
    },
  };
}

/** 원호 위 f 자리의 진행 방향 단위 접선(장면이 호를 나누는 식을 f로 미분 — 나선은 높이 기울기 포함). 길이가 없으면 null */
function shapeTangent(g: ArcShape, f: number): V3 | null {
  const t = g.t0 + g.sweep * f;
  const r = g.r0 + (g.r1 - g.r0) * f;
  const dr = g.r1 - g.r0;
  const d: V3 = [0, 0, 0];
  d[g.a0] = dr * Math.cos(t) - r * g.sweep * Math.sin(t);
  d[g.a1] = dr * Math.sin(t) + r * g.sweep * Math.cos(t);
  d[g.a2] = g.e[g.a2]! - g.s[g.a2]!;
  const l = Math.hypot(d[0], d[1], d[2]);
  if (!(l > 1e-12)) return null;
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** 점 p에서 원호까지 가장 가까운 자리(f)와 거리: 각으로 f를 구하되 여러 바퀴(중심각 2π 넘음 — 나선)면 바퀴마다 보고, 두 끝도 본다 */
export function shapeNearest(g: ArcShape, p: ArrayLike<number>): { f: number; dist: number } {
  const sw = Math.abs(g.sweep);
  const ang = Math.atan2(p[g.a1]! - g.cv, p[g.a0]! - g.cu) - g.t0;
  const d = (((g.sweep >= 0 ? ang : -ang) % TAU) + TAU) % TAU;
  const fs = [0, 1];
  const turns = Math.min(4096, Math.ceil(sw / TAU));
  for (let k = 0; k <= turns; k++) {
    const f = (d + TAU * k) / sw;
    if (f > 1) break;
    fs.push(f);
  }
  let best = { f: 0, dist: Infinity };
  for (const f of fs) {
    const q = shapeAt(g, f);
    const dist = Math.hypot(p[0]! - q[0], p[1]! - q[1], p[2]! - q[2]);
    if (dist < best.dist) best = { f, dist };
  }
  return best;
}

/** 장면이 원호를 현으로 나눴을 때 현이 원호에서 가장 멀리 떨어지는 거리(처짐). 나누기 수는 scene.ts arcSegCount·tessellatePath(허용치 없이)와 같다 */
function shapeSag(g: ArcShape, maxAngle: number): number {
  const n = shapeChords(g, maxAngle);
  return Math.max(g.r0, g.r1) * (1 - Math.cos(Math.min(Math.PI, Math.abs(g.sweep) / n) / 2));
}

/** 장면이 원호를 나눈 토막 수(나누기 각 — 모양에 적힌 각이 있으면 그것). scene.ts arcSegCount·tessellatePath와 같은 셈 */
export function shapeChords(g: ArcShape, maxAngle: number): number {
  return Math.max(1, Math.min(4096, Math.ceil(Math.abs(g.sweep) / Math.max(1e-4, g.step ?? maxAngle) - 1e-9)));
}

/** 점 p가 원호 위(가장 가까운 자리까지 현의 처짐과 허용치 tol 안)면 그 자리, 아니면 null */
function onShape(g: ArcShape, p: ArrayLike<number>, maxAngle: number, tol: number): { f: number; dist: number } | null {
  const n = shapeNearest(g, p);
  return n.dist <= shapeSag(g, maxAngle) * 1.02 + tol ? n : null;
}

/** 원호 이동 i 위 f(0~1) 자리의 진행 방향 단위 접선(나선은 높이 기울기 포함). 원호가 아니거나 길이가 없으면 null */
export function arcTangentAtF(nc: SnapMoves, i: number, f: number): V3 | null {
  const g = arcShape(nc, i);
  return g && shapeTangent(g, f);
}

/** 원호 이동 i의 한 끝(0 = 시작, 1 = 끝)에서 원호 쪽으로 가는 단위 접선(나선은 높이 기울기 포함). 원호가 아니거나 길이가 없으면 null */
export function arcEndTangent(nc: SnapMoves, i: number, end: 0 | 1): V3 | null {
  const d = arcTangentAtF(nc, i, end);
  return d && end ? [-d[0], -d[1], -d[2]] : d;
}

/** 점 p에서 원호 이동 i까지 가장 가까운 자리(f)와 거리(여러 바퀴 나선은 바퀴마다, 두 끝도 본다). 원호가 아니면 null */
export function arcNearest(nc: SnapMoves, i: number, p: ArrayLike<number>): { f: number; dist: number } | null {
  const g = arcShape(nc, i);
  return g && shapeNearest(g, p);
}

/**
 * 장면이 원호 이동 i를 현으로 나눴을 때 현이 원호에서 가장 멀리 떨어지는 거리(처짐). maxAngle = 장면이 실제로 쓴 나누기 각(scene.meta.arcAngle)
 */
export function arcChordSag(nc: SnapMoves, i: number, maxAngle: number): number {
  const g = arcShape(nc, i);
  return g ? shapeSag(g, maxAngle) : 0;
}

/**
 * 첫 점 a가 끝·가운데 점이 아닌 자리로 그 위(현 위 아무 점·현의 끝 — 원호까지 현의 처짐 안)에 있는 원호 이동(이동 차례, 많아야 limit개,
 * end 'on', f = 원호 위 가장 가까운 자리). skip(이미 끝·가운데 점으로 찾은 이동)은 뺀다. 직선 축 높이와 중심에서 거리로 먼저 거르고
 * 남은 것만 각을 계산한다. maxAngle = 장면의 호 나누기 각
 */
export function arcsOnAt(nc: SnapMoves, a: ArrayLike<number>, maxAngle = ARC_ANGLE, skip?: ReadonlySet<number>, tol = pointTol(a), limit = 16): ArcEnd[] {
  const m = nc.moves;
  const p = m.points;
  const arcs = nc.arcs;
  const out: ArcEnd[] = [];
  // 현은 원호 안쪽으로 많아야 반지름 × (1 − cos(나누기 각 / 2))만큼 들어간다
  const sagK = 1 - Math.cos(Math.min(Math.PI, Math.max(1e-4, maxAngle)) / 2);
  for (let i = 0; i < m.count && out.length < limit; i++) {
    if (m.kind[i] !== MOVE_ARC || skip?.has(i)) continue;
    const ai = m.arc[i]!;
    if (ai < 0 || ai >= arcs.sweep.length) continue;
    const [a0, a1, a2] = PLANE_AXES[arcs.plane[ai]!] ?? PLANE_AXES[0]!;
    const o = i * 3;
    const z0 = p[o + a2]!;
    const z1 = p[o + 3 + a2]!;
    if (a[a2]! < Math.min(z0, z1) - 4 * tol || a[a2]! > Math.max(z0, z1) + 4 * tol) continue;
    const cu = arcs.center[ai * 3 + a0]!;
    const cv = arcs.center[ai * 3 + a1]!;
    const r0 = Math.hypot(p[o + a0]! - cu, p[o + a1]! - cv);
    const r1 = Math.hypot(p[o + 3 + a0]! - cu, p[o + 3 + a1]! - cv);
    const d = Math.hypot(a[a0]! - cu, a[a1]! - cv);
    if (d > Math.max(r0, r1) + 4 * tol || d < Math.min(r0, r1) - Math.max(r0, r1) * sagK * 1.02 - 4 * tol) continue;
    const g = arcShape(nc, i);
    const n = g && onShape(g, a, maxAngle, 4 * tol);
    if (n) out.push({ move: i, end: 'on', f: n.f });
  }
  return out;
}

/** 판재 붙잡기 표의 호 요소 모양(표마다 한 번 — 윤곽 가공·가공 없는 윤곽은 XY 평면·직선 축 Z, 둘레 호는 outlineForms의 평면·나눈 각) */
const panelCache = new WeakMap<PanelSnapTable, ArcShape[]>();

/** 호 요소 배열(9개씩 — 시작 xyz, 끝 xyz, 평면 두 축의 중심, 중심각)의 호 모양. 직선(중심각 0)은 뺀다. form = 둘레 호의 평면·나눈 각 */
function elementArcs(el: Float64Array, form?: OutlineForm): ArcShape[] {
  const [a0, a1, a2] = PLANE_AXES[form?.plane ?? 0] ?? PLANE_AXES[0]!;
  const out: ArcShape[] = [];
  for (let i = 0; i + 9 <= el.length; i += 9) {
    const g = shapeOf([el[i]!, el[i + 1]!, el[i + 2]!], [el[i + 3]!, el[i + 4]!, el[i + 5]!], a0, a1, a2, el[i + 6]!, el[i + 7]!, el[i + 8]!);
    if (!g || !Number.isFinite(g.r0 + g.r1 + g.t0)) continue;
    if (form) g.step = form.step;
    out.push(g);
  }
  return out;
}

/**
 * 판재 붙잡기 표(PanelSnapTable.paths — 요소마다 시작 xyz, 끝 xyz, 호 중심 x·y, 중심각)의 호 요소들(차례 = ArcEnd.move).
 * 16차부터 판 외곽선·포켓 둘레(그물 윤곽선 고리 — PanelSnapTable.outlines)의 호도, 17차부터 구멍 테두리·옆면 포켓 둘레(평면·나눈 각 — outlineForms)도 잇는다
 */
export function panelArcs(t: PanelSnapTable): ArcShape[] {
  let out = panelCache.get(t);
  if (out) return out;
  out = [];
  for (const el of t.paths.values()) out.push(...elementArcs(el));
  for (const [id, el] of t.outlines ?? []) out.push(...elementArcs(el, t.outlineForms?.get(id)));
  panelCache.set(t, out);
  return out;
}

/**
 * 판재 붙잡기 표 한 묶음의 호 요소 모양(표·묶음마다 한 번 — 붙잡기 다듬기 refine.ts·붙잡기 점 snap.ts): 선분 묶음은
 * `${선분 묶음 id}#${segmentIds 값}`(paths), 그물 윤곽선은 `edge:${그물 id}`(outlines — 판 외곽선·포켓 둘레·구멍 테두리)
 */
const panelKeyCache = new WeakMap<PanelSnapTable, Map<string, ArcShape[]>>();

export function panelArcsOf(t: PanelSnapTable, key: string): ArcShape[] {
  let m = panelKeyCache.get(t);
  if (!m) panelKeyCache.set(t, (m = new Map()));
  let out = m.get(key);
  if (out) return out;
  const edge = key.startsWith('edge:');
  const el = edge ? t.outlines?.get(key.slice(5)) : t.paths.get(key);
  out = el ? elementArcs(el, edge ? t.outlineForms?.get(key.slice(5)) : undefined) : [];
  m.set(key, out);
  return out;
}

/**
 * 반경 보정 경로(공구 중심 — 워커가 보낸 보정 조각 NcCompSnap) 조각 k의 호 모양. 직선 조각이거나 중심각이 없으면 null.
 * 장면은 보정 경로의 호를 프로그램 원호와 같은 나누기 각(scene.meta.arcAngle)으로 나눈다(comp.ts compPathSegments)
 */
export function compShape(c: NcCompSnap, k: number): ArcShape | null {
  if (!(k >= 0 && k < c.count) || c.kind[k] !== 1) return null;
  const [a0, a1, a2] = PLANE_AXES[c.plane[k]!] ?? PLANE_AXES[0]!;
  const p = c.points;
  const o = k * 6;
  const g = shapeOf([p[o]!, p[o + 1]!, p[o + 2]!], [p[o + 3]!, p[o + 4]!, p[o + 5]!], a0, a1, a2, c.center[k * 3 + a0]!, c.center[k * 3 + a1]!, c.sweep[k]!);
  return g && Number.isFinite(g.r0 + g.r1 + g.t0) ? g : null;
}

/** 보정 조각마다 호 모양(차례 = 조각 번호, 직선 조각은 null — 조각 묶음마다 한 번) */
const compCache = new WeakMap<NcCompSnap, (ArcShape | null)[]>();

export function compArcs(c: NcCompSnap): (ArcShape | null)[] {
  let out = compCache.get(c);
  if (!out) compCache.set(c, (out = Array.from({ length: c.count }, (_, k) => compShape(c, k))));
  return out;
}

/** 보정 경로에서 이동 i의 조각 범위 [lo, hi)(조각의 이동 번호는 오름차순 — 이동 하나에 들어가기·바깥 모서리 호 등 여럿일 수 있다) */
export function compPiecesOf(c: NcCompSnap, i: number): [number, number] {
  let lo = 0;
  let hi = c.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.move[mid]! < i) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < c.count && c.move[end] === i) end++;
  return [lo, end];
}

/**
 * 첫 점 a에 닿는 호(차례 = arcs 차례, 많아야 limit개 — 판재 panelArcs, 보정 경로 compArcs의 호 조각): 시작·끝(0·1),
 * 가운데 점(0.5 — snap.ts panelSnapPoints·compSnapPoints와 같은 자리), 그 밖의 호 위('on'). null(직선 조각)은 건너뛴다
 */
export function panelArcsAt(arcs: readonly (ArcShape | null)[], a: ArrayLike<number>, maxAngle = ARC_ANGLE, tol = pointTol(a), limit = 16): ArcEnd[] {
  const out: ArcEnd[] = [];
  for (let i = 0; i < arcs.length && out.length < limit; i++) {
    const g = arcs[i];
    if (!g) continue;
    const z0 = g.s[g.a2]!;
    const z1 = g.e[g.a2]!;
    if (a[g.a2]! < Math.min(z0, z1) - 4 * tol || a[g.a2]! > Math.max(z0, z1) + 4 * tol) continue;
    const s = near(g.s, a, tol);
    const e = near(g.e, a, tol);
    if (s) out.push({ move: i, end: 0 });
    if (e) out.push({ move: i, end: 1 });
    if (s || e) continue;
    if (near(shapeAt(g, 0.5), a, tol)) out.push({ move: i, end: 0.5 });
    else {
      const n = onShape(g, a, maxAngle, 4 * tol);
      if (n) out.push({ move: i, end: 'on', f: n.f });
    }
  }
  return out;
}

/** 접선과 커서 아래 점에서 그 곡선까지 거리(원호·스플라인 가운데 가까운 곡선을 고른다) */
type TangentHit = { d: V3; dist: number };

/**
 * 첫 점 a에 닿는 원호(ends) 가운데 커서 아래 점 p가 그 위에 있는 것의 a 쪽 단위 접선과 p의 거리 — arcTangentAt의 몸통
 * (shape = 원호 번호 → 모양, order = 원호 번호 → 그 원호를 그리는 이동 번호(재생 한도 lastMove와 견준다 — 없으면 원호 번호 그대로))
 */
function tangentFrom(shape: (i: number) => ArcShape | null, ends: readonly ArcEnd[], a: ArrayLike<number>, p: ArrayLike<number>, maxAngle: number, lastMove: number, order?: (i: number) => number): TangentHit | null {
  if (!ends.length) return null;
  if (Math.hypot(p[0]! - a[0]!, p[1]! - a[1]!, p[2]! - a[2]!) <= 4 * pointTol(a)) return null;
  const tolP = 4 * pointTol(p);
  let best: { e: ArcEnd; g: ArcShape; f: number; dist: number } | null = null;
  for (const e of ends) {
    if ((order ? order(e.move) : e.move) > lastMove) continue;
    const g = shape(e.move);
    const n = g && onShape(g, p, maxAngle, tolP);
    if (n && (!best || n.dist < best.dist)) best = { e, g: g!, ...n };
  }
  if (!best) return null;
  const { e, g, f, dist } = best;
  const hit = (d: V3 | null, flip: boolean): TangentHit | null => (d ? { d: flip ? [-d[0], -d[1], -d[2]] : d, dist } : null);
  if (e.end === 0 || e.end === 1) {
    // 한 바퀴 원(시작 = 끝 = a)은 커서가 놓인 쪽 끝(반 바퀴로 가른다)
    const both = ends.some((o) => o.move === e.move && (o.end === 0 || o.end === 1) && o.end !== e.end);
    const end = both ? (f <= 0.5 ? 0 : 1) : e.end;
    return hit(shapeTangent(g, end), end === 1);
  }
  // 가운데 점·다른 자리: 원호를 따라 커서 쪽(커서 자리가 앞이면 진행 방향). 한 바퀴 원(시작 = 끝)은 가까운 쪽으로 돈다
  const fa = e.end === 0.5 ? 0.5 : (e.f ?? 0.5);
  let df = f - fa;
  if (Math.abs(df) > 0.5 && Math.abs(g.sweep) <= TAU + 1e-9 && near(g.s, g.e, pointTol(g.s))) df = -df;
  return hit(shapeTangent(g, fa), df < 0);
}

/**
 * 첫 점 a에 닿는 원호(ends — arcEndsAt·arcMidsAt·arcsOnAt) 가운데 커서 아래 점 p가 그 위에 있는 것의 a 쪽 단위 접선
 * (끝이면 a에서 원호 쪽, 가운데 점·다른 자리면 그 자리의 접선을 원호를 따라 커서 쪽으로). p가 a 자리거나 어느 원호 위도 아니면 null.
 * 여럿이면 p에 가장 가까운 원호. 한 바퀴 원(시작 = 끝 = a)은 p가 놓인 쪽 끝(반 바퀴로 가른다).
 * maxAngle = 장면의 호 나누기 각(scene.meta.arcAngle), lastMove = 재생 중 그린 마지막 이동(그 뒤 원호는 보지 않는다)
 */
export function arcTangentAt(nc: SnapMoves, ends: readonly ArcEnd[], a: ArrayLike<number>, p: ArrayLike<number>, maxAngle = ARC_ANGLE, lastMove = Infinity): V3 | null {
  return tangentFrom((i) => arcShape(nc, i), ends, a, p, maxAngle, lastMove)?.d ?? null;
}

// ── 스플라인(G5·G5.1·G5.2/G5.3 — 해석기 스플라인 표, spline.ts) ──

/** 첫 점에 닿는 스플라인 곡선과 그 위 자리(매개변수 u — 끝·가운데 점·조각 위 아무 점 모두 곡선 위 가장 가까운 자리) */
export interface SplineHit {
  c: SplineCurve;
  u: number;
}

/** 표마다 곡선의 조정점 상자(곡선은 조정점의 볼록 껍질 안 — 가중치가 양수) */
const splineBoxes = new WeakMap<NcSplines, Float64Array>();

function splineBox(t: NcSplines): Float64Array {
  let b = splineBoxes.get(t);
  if (b) return b;
  b = new Float64Array(t.count * 6);
  for (let k = 0; k < t.count; k++) {
    const o = k * 6;
    b.fill(Infinity, o, o + 3);
    b.fill(-Infinity, o + 3, o + 6);
    for (let i = t.ctrlStart[k]!; i < t.ctrlStart[k + 1]!; i++)
      for (let c = 0; c < 3; c++) {
        const v = t.ctrl[i * 3 + c]!;
        if (v < b[o + c]!) b[o + c] = v;
        if (v > b[o + 3 + c]!) b[o + 3 + c] = v;
      }
  }
  splineBoxes.set(t, b);
  return b;
}

/**
 * 첫 점 a가 그 위(끝·가운데 점·조각 위 아무 점 — 곡선까지 그 조각의 처짐 안)에 있는 스플라인 곡선(많아야 limit개)과 곡선 위 가장 가까운 자리.
 * 조정점 상자로 먼저 거르고 남은 것만 곡선 위 가장 가까운 자리(조각 나눔 + 뉴턴)를 구한다
 */
export function splinesAt(nc: SnapMoves, a: ArrayLike<number>, tol = pointTol(a), limit = 16): SplineHit[] {
  const t = nc.splines;
  const out: SplineHit[] = [];
  if (!t) return out;
  const box = splineBox(t);
  for (let k = 0; k < t.count && out.length < limit; k++) {
    const o = k * 6;
    let inside = true;
    for (let c = 0; c < 3 && inside; c++) inside = a[c]! >= box[o + c]! - 8 * tol && a[c]! <= box[o + 3 + c]! + 8 * tol;
    if (!inside) continue;
    const c = splineCurve(t, k, nc.moves.points);
    if (!c) continue;
    const r = splineNearest(c, a, nc.moves.points);
    if (r.dist <= pieceSag(c, r.j) + 4 * tol) out.push({ c, u: r.u });
  }
  return out;
}

/**
 * 첫 점 a에 닿는 스플라인(hits) 가운데 커서 아래 점 p가 그 위(곡선까지 그 조각의 처짐 안)에 있는 것의 a 자리 접선과 p의 거리.
 * 방향은 곡선을 따라 커서 쪽(커서 자리 매개변수가 앞이면 진행 방향 — 시작 끝이면 곡선 쪽, 끝 끝이면 그 반대, 닫힌 곡선은 가까운 쪽).
 * lastMove = 재생 중 그린 마지막 이동(p가 놓인 조각이 그 뒤면 보지 않는다)
 */
function splineTangentFrom(nc: SnapMoves, hits: readonly SplineHit[], a: ArrayLike<number>, p: ArrayLike<number>, lastMove: number): TangentHit | null {
  if (!hits.length || Math.hypot(p[0]! - a[0]!, p[1]! - a[1]!, p[2]! - a[2]!) <= 4 * pointTol(a)) return null;
  const tolP = 4 * pointTol(p);
  let best: { h: SplineHit; u: number; dist: number } | null = null;
  for (const h of hits) {
    const c = h.c;
    if (c.move > lastMove) continue;
    const r = splineNearest(c, p, nc.moves.points);
    if (c.move + r.j > lastMove || r.dist > pieceSag(c, r.j) + tolP) continue;
    if (!best || r.dist < best.dist) best = { h, u: r.u, dist: r.dist };
  }
  if (!best) return null;
  const { h, u, dist } = best;
  const d = unitTangent(h.c, h.u);
  if (!d) return null;
  let du = u - h.u;
  if (h.c.closed && Math.abs(du) > (h.c.hi - h.c.lo) / 2) du = -du;
  if (du === 0) return null;
  return { d: du < 0 ? [-d[0], -d[1], -d[2]] : d, dist };
}

/** 첫 점 a에 닿는 스플라인(splinesAt) 가운데 커서 아래 점 p가 그 위에 있는 것의 a 자리 단위 접선(커서 쪽). 없으면 null */
export function splineTangentAt(nc: SnapMoves, hits: readonly SplineHit[], a: ArrayLike<number>, p: ArrayLike<number>, lastMove = Infinity): V3 | null {
  return splineTangentFrom(nc, hits, a, p, lastMove)?.d ?? null;
}

// ── 첫 점이 놓인 곡선을 선분 식별자로(코어 0.16.0 measurePoints[0].segment·other — 18차) ──

/**
 * 측정 첫 점: 코어 measurePoints[0](0.16.0부터 그 점이 놓인 선분 식별자 segment, 교차점이면 둘째 선분 other). 좌표만 주면(식별자 없음) 예전처럼 좌표로 찾는다
 */
export interface FirstPoint {
  point: ArrayLike<number>;
  segment?: SnapSegment;
  other?: SnapSegment;
}

/** 첫 점에 닿는 곡선(원호 자리와 그 모양, 그 원호를 그리는 이동 번호 — 없으면 원호 번호 그대로, 스플라인 자리)과 그것을 찾은 길 */
interface FirstCurves {
  ends: ArcEnd[];
  shape: (i: number) => ArcShape | null;
  order?: (i: number) => number;
  splines: SplineHit[];
  by: 'segment' | 'coords';
}

const isFirst = (a: ArrayLike<number> | FirstPoint): a is FirstPoint => 'point' in a;

/**
 * NC 원호 번호 → 모양(19차): 이동 번호(0 ~ 이동 수 − 1)는 프로그램 원호 이동, 그 뒤(이동 수 + 조각 번호)는 반경 보정 경로(공구 중심)의 호 조각
 */
function ncShape(nc: SnapMoves): (i: number) => ArcShape | null {
  const n = nc.moves.count;
  return (i) => (i < n ? arcShape(nc, i) : nc.comp ? (compArcs(nc.comp)[i - n] ?? null) : null);
}

/** NC 원호 번호 → 그 원호를 그리는 이동 번호(재생 한도와 견준다 — 보정 조각은 원래 이동 번호) */
function ncOrder(nc: SnapMoves): (i: number) => number {
  const n = nc.moves.count;
  return (i) => (i < n ? i : (nc.comp?.move[i - n] ?? Infinity));
}

/**
 * 보정 경로 식별자('nc-comp' — 선분 번호가 원래 이동 번호, 19차): 그 이동의 보정 조각 가운데 첫 점 a가 끝이 아닌 자리로 지나는 호
 * (원호 번호 = 이동 수 + 조각 번호 — ncShape). 직선 조각 위면 빈 배열. 보정 조각이 없거나 a가 조각의 시작·끝(조각이 바뀌는 꼭짓점 —
 * 들어가기 끝·바깥 모서리 호의 끝 등, 식별자는 고른 쪽 토막 하나뿐)이면 null(좌표로 — 프로그램 이동과 같은 까닭)
 */
function compFirstEnds(nc: SnapMoves, s: SnapSegment, a: ArrayLike<number>, maxAngle: number, tol: number): ArcEnd[] | null {
  const c = nc.comp;
  if (!c) return null;
  const [lo, hi] = compPiecesOf(c, s.index);
  if (lo >= hi) return null;
  const n = nc.moves.count;
  const arcs = compArcs(c);
  const out: ArcEnd[] = [];
  for (let k = lo; k < hi; k++) {
    const o = k * 6;
    if (near(c.points.subarray(o, o + 3), a, tol) || near(c.points.subarray(o + 3, o + 6), a, tol)) return null;
    const e = innerEnd(arcs[k] ?? null, n + k, a, maxAngle, tol);
    if (e) out.push(e);
  }
  return out;
}

/** NC: 식별자가 가리키는 이동 번호(선분 번호가 이동 번호인 공구 경로 묶음 — snap.ts PATH_SET). 모르는 묶음·번호면 −1 */
function segmentMove(nc: SnapMoves, s: SnapSegment): number {
  return s.kind === 'line' && PATH_SET.test(s.id) && s.index >= 0 && s.index < nc.moves.count ? s.index : -1;
}

/** NC 이동 i의 시작이나 끝이 a인지(축마다 tol 안) */
function atMoveEnd(nc: SnapMoves, i: number, a: ArrayLike<number>, tol: number): boolean {
  const p = nc.moves.points;
  const o = i * 3;
  return near(p.subarray(o, o + 3), a, tol) || near(p.subarray(o + 3, o + 6), a, tol);
}

/** 원호 모양 g(번호 i)가 첫 점 a를 끝이 아닌 자리로 지나면 그 자리(가운데 점 0.5, 그 밖 'on'과 가장 가까운 f), 아니면 null */
function innerEnd(g: ArcShape | null, i: number, a: ArrayLike<number>, maxAngle: number, tol: number): ArcEnd | null {
  if (!g) return null;
  if (near(shapeAt(g, 0.5), a, tol)) return { move: i, end: 0.5 };
  const n = onShape(g, a, maxAngle, 4 * tol);
  return n ? { move: i, end: 'on', f: n.f } : null;
}

/**
 * NC 첫 점의 곡선을 식별자로: 첫 점이 놓인 이동(교차점이면 둘째 이동도)이 원호면 그 위 자리, 스플라인 조각이면 그 곡선 위 자리,
 * 반경 보정 경로('nc-comp')면 그 이동의 보정 조각 가운데 첫 점이 지나는 호(compFirstEnds — 19차).
 * 식별자가 없거나 모르는 묶음(회전축 등)이면 null(좌표로). 첫 점이 그 이동(보정 조각)의 시작·끝(이동이 바뀌는 꼭짓점)이어도 null —
 * 끝점 식별자는 고르기가 고른 쪽 토막 하나뿐이고, 공구 경로는 한 꼭짓점을 차례가 떨어진 이동이 다시 지나기도 해서
 * (닫힌 윤곽의 시작·끝, 들어가기·나오기 호) 이웃 이동(번호 ± 1)만으로는 모자란다 — 그 꼭짓점의 이동은 예전처럼 좌표(끝 견주기)로 모은다
 */
function ncFirstCurves(nc: SnapMoves, f: FirstPoint, maxAngle: number): FirstCurves | null {
  if (!f.segment) return null;
  const segs = f.other ? [f.segment, f.other] : [f.segment];
  const a = f.point;
  const tol = pointTol(a);
  const moves = new Set<number>();
  const ends: ArcEnd[] = [];
  for (const s of segs) {
    if (s.kind === 'line' && s.id === 'nc-comp') {
      const ce = compFirstEnds(nc, s, a, maxAngle, tol);
      if (!ce) return null;
      for (const e of ce) if (!ends.some((o) => o.move === e.move)) ends.push(e);
      continue;
    }
    const i = segmentMove(nc, s);
    if (i < 0 || atMoveEnd(nc, i, a, tol)) return null;
    moves.add(i);
  }
  const splines: SplineHit[] = [];
  for (const i of moves) {
    if (nc.moves.kind[i] === MOVE_ARC) {
      const e = innerEnd(arcShape(nc, i), i, a, maxAngle, tol);
      if (e) ends.push(e);
      continue;
    }
    const k = splineOfMove(nc.splines, i);
    const c = k >= 0 ? splineCurve(nc.splines!, k, nc.moves.points) : null;
    if (!c || splines.some((h) => h.c.move === c.move)) continue;
    const r = splineNearest(c, a, nc.moves.points);
    if (r.dist <= pieceSag(c, r.j) + 4 * tol) splines.push({ c, u: r.u });
  }
  return { ends, shape: ncShape(nc), order: ncOrder(nc), splines, by: 'segment' };
}

/** 판재: 식별자가 가리키는 붙잡기 표 열쇠(선분 묶음은 `${id}#${번호}`, 그물 윤곽선은 `edge:${그물 id}`)와 그 요소들. 표에 없으면 null */
function panelElements(t: PanelSnapTable, s: SnapSegment): { key: string; el: Float64Array } | null {
  const key = s.kind === 'edge' ? `edge:${s.id}` : `${s.id}#${s.index}`;
  const el = s.kind === 'edge' ? t.outlines?.get(s.id) : t.paths.get(key);
  return el ? { key, el } : null;
}

/**
 * 판재 첫 점의 곡선을 식별자로: 첫 점이 놓인 윤곽(선분 묶음의 윤곽 요소들, 그물 윤곽선이면 그 둘레 호)의 호 가운데 그 점을 지나는 것.
 * 표에 없는 식별자이거나 첫 점이 그 윤곽 요소의 시작·끝(요소가 바뀌는 꼭짓점)이면 null(좌표로 — NC와 같은 까닭)
 */
function panelFirstCurves(t: PanelSnapTable, f: FirstPoint, maxAngle: number): FirstCurves | null {
  if (!f.segment) return null;
  const a = f.point;
  const tol = pointTol(a);
  const arcs: ArcShape[] = [];
  const keys = new Set<string>();
  for (const s of f.other ? [f.segment, f.other] : [f.segment]) {
    const r = panelElements(t, s);
    if (!r) return null;
    const { key, el } = r;
    for (let i = 0; i + 9 <= el.length; i += 9) if (near(el.subarray(i, i + 3), a, tol) || near(el.subarray(i + 3, i + 6), a, tol)) return null;
    if (!keys.has(key)) arcs.push(...panelArcsOf(t, key));
    keys.add(key);
  }
  const ends: ArcEnd[] = [];
  arcs.forEach((g, i) => {
    const e = innerEnd(g, i, a, maxAngle, tol);
    if (e) ends.push(e);
  });
  return { ends, shape: (i) => arcs[i] ?? null, splines: [], by: 'segment' };
}

/**
 * 첫 점에 닿는 곡선: 식별자로 찾을 수 있으면 그것(ncFirstCurves·panelFirstCurves), 아니면 예전처럼 좌표로(모든 이동·호 요소에서 —
 * NC는 반경 보정 경로를 그렸으면 그 호 조각도: 보정 조각의 가운데 점은 앱 점이라 식별자가 없다)
 */
function firstCurves(src: SnapMoves | PanelSnapTable, first: ArrayLike<number> | FirstPoint, maxAngle: number): FirstCurves {
  const f = isFirst(first) ? first : null;
  const a = f ? f.point : (first as ArrayLike<number>);
  if ('moves' in src) {
    const bySeg = f && ncFirstCurves(src, f, maxAngle);
    if (bySeg) return bySeg;
    const known = [...arcEndsAt(src, a), ...arcMidsAt(src, a)];
    const n = src.moves.count;
    const comp = src.comp ? panelArcsAt(compArcs(src.comp), a, maxAngle).map((e) => ({ ...e, move: n + e.move })) : [];
    return { ends: [...known, ...arcsOnAt(src, a, maxAngle, new Set(known.map((e) => e.move))), ...comp], shape: ncShape(src), order: ncOrder(src), splines: splinesAt(src, a), by: 'coords' };
  }
  const bySeg = f && panelFirstCurves(src, f, maxAngle);
  if (bySeg) return bySeg;
  const arcs = panelArcs(src);
  return { ends: panelArcsAt(arcs, a, maxAngle), shape: (i) => arcs[i] ?? null, splines: [], by: 'coords' };
}

/** 식별자의 열쇠(같은 첫 점이라도 고른 선분이 다르면 다시 찾는다) */
const segKey = (s: SnapSegment | undefined): string => (s ? `${s.kind}:${s.id}#${s.index}/${s.raw}` : '');

/** 원호 접선을 구할 문서 자료(앱 NcDoc의 일부 — NC 이동이나 판재 붙잡기 표, 재생 자리, 장면의 호 나누기 각) */
export type TangentDoc = Pick<NcDoc, 'nc' | 'mpr' | 'playSec' | 'playMove' | 'scene'>;

/**
 * 첫 점마다 그 점에 닿는 원호 끝·가운데 점·다른 자리를 한 번 찾아 두고(문서 자료·첫 점·그 식별자·나누기 각이 바뀌면 다시) 커서마다 접선을 구한다
 * (앱과 시험이 함께 쓴다). NC 이동과 판재 붙잡기 표를 모두 받는다.
 * 첫 점을 코어 측정 점(FirstPoint — 선분 식별자 segment·other)으로 주면 식별자로 그 이동·윤곽만 보고(18차), 식별자가 없거나
 * (앱 점 — 원호 가운데 점·중심, 그물 꼭짓점, 축 위 점) 모르는 묶음이거나 이동·요소가 바뀌는 꼭짓점이면 예전처럼 좌표로 모든 이동·호 요소에서 찾는다
 */
export class ArcTangents {
  private src: object | null = null;
  private key = '';
  private found: FirstCurves = { ends: [], shape: () => null, splines: [], by: 'coords' };

  /** 지금 첫 점의 곡선을 찾은 길(식별자 'segment'·좌표 'coords' — 자동 확인용). 아직 찾지 않았으면 null */
  get by(): 'segment' | 'coords' | null {
    return this.src ? this.found.by : null;
  }

  /**
   * arcTangentAt과 같다(maxAngle·lastMove도 같은 뜻 — 판재는 재생 한도가 없다). NC면 스플라인(splineTangentAt)도 보고,
   * 커서 아래 점이 원호와 스플라인 둘 다의 위면 더 가까운 곡선. first = 첫 점 좌표나 코어 측정 점(식별자 포함)
   */
  at(src: SnapMoves | PanelSnapTable, first: ArrayLike<number> | FirstPoint, p: ArrayLike<number>, maxAngle = ARC_ANGLE, lastMove = Infinity): V3 | null {
    const f = isFirst(first) ? first : null;
    const a = f ? f.point : (first as ArrayLike<number>);
    const key = `${a[0]},${a[1]},${a[2]}|${maxAngle}|${segKey(f?.segment)}|${segKey(f?.other)}`;
    if (this.src !== src || this.key !== key) {
      this.src = src;
      this.key = key;
      this.found = firstCurves(src, first, maxAngle);
    }
    const { ends, shape, order, splines } = this.found;
    const arc = ends.length ? tangentFrom(shape, ends, a, p, maxAngle, lastMove, order) : null;
    const spl = splines.length && 'moves' in src ? splineTangentFrom(src, splines, a, p, lastMove) : null;
    return (arc && spl ? (spl.dist < arc.dist ? spl : arc) : (arc ?? spl))?.d ?? null;
  }

  /**
   * 앱 문서에서(measure-lock.ts host.arcTangent): NC면 이동(재생 중이면 그린 이동까지, 장면이 쓴 나누기 각), 판재면 붙잡기 표의 호 요소.
   * 원호를 모르는 문서면 null
   */
  ofDoc(d: TangentDoc, a: ArrayLike<number> | FirstPoint, p: ArrayLike<number>): V3 | null {
    const src = d.nc ?? d.mpr?.snap;
    if (!src) return null;
    const pos = playPosition(d);
    const angle = (d.scene.meta as { arcAngle?: unknown } | undefined)?.arcAngle;
    return this.at(src, a, p, typeof angle === 'number' && angle > 0 ? angle : undefined, pos ? (pos.move >= 0 ? pos.move : -1) : Infinity);
  }
}
