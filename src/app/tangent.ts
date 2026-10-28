/**
 * 측정 방향 잠금의 원호 접선(순수 함수, DOM 없음 — measure-lock.ts가 코어 setMeasureInferenceLock({ direction, kind: 'parallel' })에 준다).
 *
 * 첫 측정 점이 원호 이동(G2/G3, 나선 포함)의 시작·끝이고 커서 아래 점이 그 원호 위면 그 끝에서 원호 쪽으로 가는 접선 방향을 준다.
 * - 장면은 원호를 짧은 현 여럿으로 그리므로(scene.ts — 실제로 쓴 나누기 각은 scene.meta.arcAngle) 커서 아래 점(현 위)은 원호에서
 *   현의 처짐만큼 떨어질 수 있다. 원호까지 거리가 그 처짐(과 float32 장면 좌표의 반올림) 안이면 원호 위로 본다. 다른 끝(끝점)도 원호 위다.
 * - 접선은 장면이 호를 나누는 식(평면 축의 각·반지름과 직선 축을 f만큼 — snap.ts movePointAt)을 f로 미분한 것이라 나선의 높이 기울기와
 *   반지름이 조금 바뀌는 호도 맞다. 시작이면 진행 방향, 끝이면 그 반대(첫 점에서 원호 쪽으로).
 * - 첫 점에 닿는 원호는 첫 점마다 한 번 모든 이동에서 찾고(arcEndsAt), 커서가 움직일 때는 그 몇 개만 본다(arcTangentAt).
 */
import { MOVE_ARC, PLANE_AXES } from '../model';
import type { SnapMoves } from './snap';

type V3 = [number, number, number];
const TAU = Math.PI * 2;

/** 첫 점에 닿는 원호 끝: 이동 번호와 어느 끝(0 = 시작, 1 = 끝) */
export interface ArcEnd {
  move: number;
  end: 0 | 1;
}

/** 같은 자리로 볼 허용치: 좌표 크기의 1e-6(장면이 float32라 생기는 반올림을 넉넉히 덮는다) */
export function pointTol(p: ArrayLike<number>): number {
  return 1e-6 * (1 + Math.max(Math.abs(p[0]!), Math.abs(p[1]!), Math.abs(p[2]!)));
}

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

/** 원호 이동 i의 모양(평면 축, 중심, 시작·끝 반지름, 시작 각, 부호 있는 중심각). 원호가 아니거나 중심각이 없으면 null */
interface ArcShape {
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

function arcShape(nc: SnapMoves, i: number): ArcShape | null {
  const m = nc.moves;
  if (!(i >= 0 && i < m.count) || m.kind[i] !== MOVE_ARC) return null;
  const ai = m.arc[i]!;
  const a = nc.arcs;
  if (ai < 0 || ai >= a.sweep.length) return null;
  const sweep = a.sweep[ai]!;
  if (!(Math.abs(sweep) > 1e-12)) return null;
  const [a0, a1, a2] = PLANE_AXES[a.plane[ai]!] ?? PLANE_AXES[0]!;
  const p = m.points;
  const o = i * 3;
  const s = [p[o]!, p[o + 1]!, p[o + 2]!];
  const e = [p[o + 3]!, p[o + 4]!, p[o + 5]!];
  const cu = a.center[ai * 3 + a0]!;
  const cv = a.center[ai * 3 + a1]!;
  const r0 = Math.hypot(s[a0]! - cu, s[a1]! - cv);
  const r1 = Math.hypot(e[a0]! - cu, e[a1]! - cv);
  return { s, e, a0, a1, a2, cu, cv, r0, r1, t0: Math.atan2(s[a1]! - cv, s[a0]! - cu), sweep };
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

/** 원호 이동 i의 한 끝(0 = 시작, 1 = 끝)에서 원호 쪽으로 가는 단위 접선(나선은 높이 기울기 포함). 원호가 아니거나 길이가 없으면 null */
export function arcEndTangent(nc: SnapMoves, i: number, end: 0 | 1): V3 | null {
  const g = arcShape(nc, i);
  if (!g) return null;
  const t = g.t0 + g.sweep * end;
  const r = g.r0 + (g.r1 - g.r0) * end;
  const dr = g.r1 - g.r0;
  const d: V3 = [0, 0, 0];
  d[g.a0] = dr * Math.cos(t) - r * g.sweep * Math.sin(t);
  d[g.a1] = dr * Math.sin(t) + r * g.sweep * Math.cos(t);
  d[g.a2] = g.e[g.a2]! - g.s[g.a2]!;
  const l = Math.hypot(d[0], d[1], d[2]);
  if (!(l > 1e-12)) return null;
  const k = (end ? -1 : 1) / l;
  return [d[0] * k, d[1] * k, d[2] * k];
}

/**
 * 점 p에서 원호 이동 i까지 가장 가까운 자리(f)와 거리. 각으로 f를 구하되 여러 바퀴(중심각 2π 넘음 — 나선)면 바퀴마다 보고, 두 끝도 본다.
 * 원호가 아니면 null
 */
export function arcNearest(nc: SnapMoves, i: number, p: ArrayLike<number>): { f: number; dist: number } | null {
  const g = arcShape(nc, i);
  if (!g) return null;
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

/**
 * 장면이 원호 이동 i를 현으로 나눴을 때 현이 원호에서 가장 멀리 떨어지는 거리(처짐). 나누기 수는 scene.ts arcSegCount(허용치 없이)와 같다 —
 * maxAngle = 장면이 실제로 쓴 나누기 각(scene.meta.arcAngle)
 */
export function arcChordSag(nc: SnapMoves, i: number, maxAngle: number): number {
  const g = arcShape(nc, i);
  if (!g) return 0;
  const n = Math.max(1, Math.min(4096, Math.ceil(Math.abs(g.sweep) / Math.max(1e-4, maxAngle) - 1e-9)));
  return Math.max(g.r0, g.r1) * (1 - Math.cos(Math.min(Math.PI, Math.abs(g.sweep) / n) / 2));
}

/**
 * 첫 점 a에 닿는 원호(ends — arcEndsAt) 가운데 커서 아래 점 p가 그 위에 있는 것의 a 쪽 단위 접선(a에서 원호 쪽).
 * p가 a 자리거나 어느 원호 위도 아니면 null. 여럿이면 p에 가장 가까운 원호. 한 바퀴 원(시작 = 끝 = a)은 p가 놓인 쪽 끝(반 바퀴로 가른다).
 * maxAngle = 장면의 호 나누기 각(scene.meta.arcAngle), lastMove = 재생 중 그린 마지막 이동(그 뒤 원호는 보지 않는다)
 */
export function arcTangentAt(nc: SnapMoves, ends: readonly ArcEnd[], a: ArrayLike<number>, p: ArrayLike<number>, maxAngle = Math.PI / 36, lastMove = Infinity): V3 | null {
  if (!ends.length) return null;
  if (Math.hypot(p[0]! - a[0]!, p[1]! - a[1]!, p[2]! - a[2]!) <= 4 * pointTol(a)) return null;
  const tolP = 4 * pointTol(p);
  let best: { e: ArcEnd; f: number; dist: number } | null = null;
  for (const e of ends) {
    if (e.move > lastMove) continue;
    const n = arcNearest(nc, e.move, p);
    if (!n || n.dist > arcChordSag(nc, e.move, maxAngle) * 1.02 + tolP) continue;
    if (!best || n.dist < best.dist) best = { e, ...n };
  }
  if (!best) return null;
  const b = best;
  const both = ends.some((o) => o.move === b.e.move && o.end !== b.e.end);
  return arcEndTangent(nc, b.e.move, both ? (b.f <= 0.5 ? 0 : 1) : b.e.end);
}

/** 첫 점마다 그 점에 닿는 원호 끝을 한 번 찾아 두고(문서 자료·첫 점이 바뀌면 다시) 커서마다 접선을 구한다(앱과 시험이 함께 쓴다) */
export class ArcTangents {
  private src: object | null = null;
  private key = '';
  private ends: ArcEnd[] = [];

  /** arcTangentAt과 같다(maxAngle·lastMove도 같은 뜻) */
  at(nc: SnapMoves, a: ArrayLike<number>, p: ArrayLike<number>, maxAngle?: number, lastMove?: number): V3 | null {
    const key = `${a[0]},${a[1]},${a[2]}`;
    if (this.src !== nc || this.key !== key) {
      this.src = nc;
      this.key = key;
      this.ends = arcEndsAt(nc, a);
    }
    return this.ends.length ? arcTangentAt(nc, this.ends, a, p, maxAngle, lastMove) : null;
  }
}
