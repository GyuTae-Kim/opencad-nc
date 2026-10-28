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
 * - 첫 점에 닿는 원호는 첫 점마다 한 번 모든 이동(판재는 모든 호 요소)에서 찾고(arcEndsAt·arcMidsAt·arcsOnAt·panelArcsAt),
 *   커서가 움직일 때는 그 몇 개만 본다(arcTangentAt).
 * - NURBS(G5.2/G5.3)·스플라인 이동은 장면이 직선 조각으로 그려 원호가 아니므로 해당하지 않는다.
 */
import { MOVE_ARC, PLANE_AXES } from '../model';
import type { PanelSnapTable } from '../scene';
import { playPosition, type NcDoc } from './doc';
import type { SnapMoves } from './snap';

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
}

/** 시작·끝·평면 축·중심·중심각으로 모양을 만든다. 중심각이 없으면(직선) null */
function shapeOf(s: readonly number[], e: readonly number[], a0: number, a1: number, a2: number, cu: number, cv: number, sweep: number): ArcShape | null {
  if (!(Math.abs(sweep) > 1e-12)) return null;
  const r0 = Math.hypot(s[a0]! - cu, s[a1]! - cv);
  const r1 = Math.hypot(e[a0]! - cu, e[a1]! - cv);
  return { s, e, a0, a1, a2, cu, cv, r0, r1, t0: Math.atan2(s[a1]! - cv, s[a0]! - cu), sweep };
}

/** 원호 이동 i의 모양. 원호가 아니거나 중심각이 없으면 null */
function arcShape(nc: SnapMoves, i: number): ArcShape | null {
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
function shapeAt(g: ArcShape, f: number): V3 {
  const t = g.t0 + g.sweep * f;
  const r = g.r0 + (g.r1 - g.r0) * f;
  const q: V3 = [0, 0, 0];
  q[g.a0] = g.cu + r * Math.cos(t);
  q[g.a1] = g.cv + r * Math.sin(t);
  q[g.a2] = g.s[g.a2]! + (g.e[g.a2]! - g.s[g.a2]!) * f;
  return q;
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
function shapeNearest(g: ArcShape, p: ArrayLike<number>): { f: number; dist: number } {
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
  const n = Math.max(1, Math.min(4096, Math.ceil(Math.abs(g.sweep) / Math.max(1e-4, maxAngle) - 1e-9)));
  return Math.max(g.r0, g.r1) * (1 - Math.cos(Math.min(Math.PI, Math.abs(g.sweep) / n) / 2));
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

/** 판재 붙잡기 표의 호 요소 모양(표마다 한 번 — 윤곽 가공·가공 없는 윤곽, XY 평면, 직선 축 Z) */
const panelCache = new WeakMap<PanelSnapTable, ArcShape[]>();

/** 판재 붙잡기 표(PanelSnapTable.paths — 요소마다 시작 xyz, 끝 xyz, 호 중심 x·y, 중심각)의 호 요소들(차례 = ArcEnd.move) */
export function panelArcs(t: PanelSnapTable): ArcShape[] {
  let out = panelCache.get(t);
  if (out) return out;
  out = [];
  for (const el of t.paths.values())
    for (let i = 0; i + 9 <= el.length; i += 9) {
      const g = shapeOf([el[i]!, el[i + 1]!, el[i + 2]!], [el[i + 3]!, el[i + 4]!, el[i + 5]!], 0, 1, 2, el[i + 6]!, el[i + 7]!, el[i + 8]!);
      if (g && Number.isFinite(g.r0 + g.r1 + g.t0)) out.push(g);
    }
  panelCache.set(t, out);
  return out;
}

/** 첫 점 a에 닿는 판재 호 요소(panelArcs 차례, 많아야 limit개): 시작·끝(0·1), 가운데 점(0.5 — snap.ts panelSnapPoints와 같은 자리), 그 밖의 호 위('on') */
export function panelArcsAt(arcs: readonly ArcShape[], a: ArrayLike<number>, maxAngle = ARC_ANGLE, tol = pointTol(a), limit = 16): ArcEnd[] {
  const out: ArcEnd[] = [];
  for (let i = 0; i < arcs.length && out.length < limit; i++) {
    const g = arcs[i]!;
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

/** 첫 점 a에 닿는 원호(ends) 가운데 커서 아래 점 p가 그 위에 있는 것의 a 쪽 단위 접선 — arcTangentAt의 몸통(shape = 원호 번호 → 모양) */
function tangentFrom(shape: (i: number) => ArcShape | null, ends: readonly ArcEnd[], a: ArrayLike<number>, p: ArrayLike<number>, maxAngle: number, lastMove: number): V3 | null {
  if (!ends.length) return null;
  if (Math.hypot(p[0]! - a[0]!, p[1]! - a[1]!, p[2]! - a[2]!) <= 4 * pointTol(a)) return null;
  const tolP = 4 * pointTol(p);
  let best: { e: ArcEnd; g: ArcShape; f: number; dist: number } | null = null;
  for (const e of ends) {
    if (e.move > lastMove) continue;
    const g = shape(e.move);
    const n = g && onShape(g, p, maxAngle, tolP);
    if (n && (!best || n.dist < best.dist)) best = { e, g: g!, ...n };
  }
  if (!best) return null;
  const { e, g, f } = best;
  if (e.end === 0 || e.end === 1) {
    // 한 바퀴 원(시작 = 끝 = a)은 커서가 놓인 쪽 끝(반 바퀴로 가른다)
    const both = ends.some((o) => o.move === e.move && (o.end === 0 || o.end === 1) && o.end !== e.end);
    const end = both ? (f <= 0.5 ? 0 : 1) : e.end;
    const d = shapeTangent(g, end);
    return d && end ? [-d[0], -d[1], -d[2]] : d;
  }
  // 가운데 점·다른 자리: 원호를 따라 커서 쪽(커서 자리가 앞이면 진행 방향). 한 바퀴 원(시작 = 끝)은 가까운 쪽으로 돈다
  const fa = e.end === 0.5 ? 0.5 : (e.f ?? 0.5);
  const d = shapeTangent(g, fa);
  if (!d) return null;
  let df = f - fa;
  if (Math.abs(df) > 0.5 && Math.abs(g.sweep) <= TAU + 1e-9 && near(g.s, g.e, pointTol(g.s))) df = -df;
  return df < 0 ? [-d[0], -d[1], -d[2]] : d;
}

/**
 * 첫 점 a에 닿는 원호(ends — arcEndsAt·arcMidsAt·arcsOnAt) 가운데 커서 아래 점 p가 그 위에 있는 것의 a 쪽 단위 접선
 * (끝이면 a에서 원호 쪽, 가운데 점·다른 자리면 그 자리의 접선을 원호를 따라 커서 쪽으로). p가 a 자리거나 어느 원호 위도 아니면 null.
 * 여럿이면 p에 가장 가까운 원호. 한 바퀴 원(시작 = 끝 = a)은 p가 놓인 쪽 끝(반 바퀴로 가른다).
 * maxAngle = 장면의 호 나누기 각(scene.meta.arcAngle), lastMove = 재생 중 그린 마지막 이동(그 뒤 원호는 보지 않는다)
 */
export function arcTangentAt(nc: SnapMoves, ends: readonly ArcEnd[], a: ArrayLike<number>, p: ArrayLike<number>, maxAngle = ARC_ANGLE, lastMove = Infinity): V3 | null {
  return tangentFrom((i) => arcShape(nc, i), ends, a, p, maxAngle, lastMove);
}

/** 원호 접선을 구할 문서 자료(앱 NcDoc의 일부 — NC 이동이나 판재 붙잡기 표, 재생 자리, 장면의 호 나누기 각) */
export type TangentDoc = Pick<NcDoc, 'nc' | 'mpr' | 'playSec' | 'playMove' | 'scene'>;

/**
 * 첫 점마다 그 점에 닿는 원호 끝·가운데 점·다른 자리를 한 번 찾아 두고(문서 자료·첫 점·나누기 각이 바뀌면 다시) 커서마다 접선을 구한다
 * (앱과 시험이 함께 쓴다). NC 이동과 판재 붙잡기 표를 모두 받는다
 */
export class ArcTangents {
  private src: object | null = null;
  private key = '';
  private ends: ArcEnd[] = [];
  private shape: (i: number) => ArcShape | null = () => null;

  /** arcTangentAt과 같다(maxAngle·lastMove도 같은 뜻 — 판재는 재생 한도가 없다) */
  at(src: SnapMoves | PanelSnapTable, a: ArrayLike<number>, p: ArrayLike<number>, maxAngle = ARC_ANGLE, lastMove = Infinity): V3 | null {
    const key = `${a[0]},${a[1]},${a[2]}|${maxAngle}`;
    if (this.src !== src || this.key !== key) {
      this.src = src;
      this.key = key;
      if ('moves' in src) {
        const known = [...arcEndsAt(src, a), ...arcMidsAt(src, a)];
        this.ends = [...known, ...arcsOnAt(src, a, maxAngle, new Set(known.map((e) => e.move)))];
        this.shape = (i) => arcShape(src, i);
      } else {
        const arcs = panelArcs(src);
        this.ends = panelArcsAt(arcs, a, maxAngle);
        this.shape = (i) => arcs[i] ?? null;
      }
    }
    return this.ends.length ? tangentFrom(this.shape, this.ends, a, p, maxAngle, lastMove) : null;
  }

  /**
   * 앱 문서에서(measure-lock.ts host.arcTangent): NC면 이동(재생 중이면 그린 이동까지, 장면이 쓴 나누기 각), 판재면 붙잡기 표의 호 요소.
   * 원호를 모르는 문서면 null
   */
  ofDoc(d: TangentDoc, a: ArrayLike<number>, p: ArrayLike<number>): V3 | null {
    const src = d.nc ?? d.mpr?.snap;
    if (!src) return null;
    const pos = playPosition(d);
    const angle = (d.scene.meta as { arcAngle?: unknown } | undefined)?.arcAngle;
    return this.at(src, a, p, typeof angle === 'number' && angle > 0 ? angle : undefined, pos ? (pos.move >= 0 ? pos.move : -1) : Infinity);
  }
}
