/**
 * 스플라인 곡선(LinuxCNC G5 3차·G5.1 2차 베지어, G5.2/G5.3 NURBS) 계산 — 측정 도구 조각(순수 함수, DOM 없음).
 *
 * 해석기가 남긴 스플라인 표(NcSplines — 곡선마다 유리 B-스플라인 정의와 그것을 나눈 이송 직선 조각, 조각 끝 매개변수)로
 * 곡선 위 점·1·2차 도함수(동차 좌표의 de Boor와 도함수 조정점 — 유리 곡선은 몫의 미분), 조각이 놓인 곡선 찾기,
 * 곡선 위 가장 가까운 매개변수(조각 나눔으로 시작값 → 뉴턴, curve.ts), 호 길이 가운데 점(조각마다 가우스–르장드르 적분)을 준다.
 * 조각 끝이 곡선 위 점 그대로인지(해석기가 쌓은 뒤 다른 처리로 옮겨지지 않았는지)는 곡선을 처음 꺼낼 때 본다(splineCurve).
 */
import type { NcSplines } from '../model';
import { nearestOn, type Curve, type V3 } from './curve';

/** 스플라인 곡선 하나(곡선 번호 k의 정의와 조각) */
export interface SplineCurve extends Curve {
  /** 표의 곡선 번호 */
  k: number;
  /** 첫 이동 번호와 이동(조각) 수 */
  move: number;
  moves: number;
  /** 조각 j(0부터)의 시작·끝 매개변수 */
  piece(j: number): [number, number];
  /** 시작 = 끝(닫힌 곡선)인지 */
  closed: boolean;
}

/** 곡선 정의(동차 조정점과 1·2차 도함수 B-스플라인) */
interface Def {
  /** 차수, 매듭, 동차 조정점(x·w, y·w, z·w, w) */
  p: number;
  U: Float64Array;
  P: Float64Array;
  /** 도함수 곡선(차수 p − 1, 매듭 U의 앞뒤 하나씩 뺀 것) — 차수가 0이면 null */
  D1: { p: number; U: Float64Array; P: Float64Array } | null;
  D2: { p: number; U: Float64Array; P: Float64Array } | null;
}

/** B-스플라인(차수 p, 매듭 U, 동차 조정점 P — 4개씩)의 도함수 곡선 조정점(NURBS Book 3.3) */
function derive(p: number, U: Float64Array, P: Float64Array): { p: number; U: Float64Array; P: Float64Array } | null {
  if (p < 1) return null;
  const n = P.length / 4;
  const Q = new Float64Array((n - 1) * 4);
  for (let i = 0; i + 1 < n; i++) {
    const d = U[i + p + 1]! - U[i + 1]!;
    const s = d > 0 ? p / d : 0;
    for (let c = 0; c < 4; c++) Q[i * 4 + c] = s * (P[(i + 1) * 4 + c]! - P[i * 4 + c]!);
  }
  return { p: p - 1, U: U.subarray(1, U.length - 1), P: Q };
}

/** 매개변수 u의 매듭 구간 s(U[s] ≤ u < U[s + 1], 끝은 마지막 빈칸 아닌 구간 — p ≤ s ≤ n − 1) */
function span(p: number, U: Float64Array, n: number, u: number): number {
  let lo = p;
  let hi = n - 1;
  if (u >= U[hi + 1]!) {
    while (hi > lo && !(U[hi]! < U[hi + 1]!)) hi--;
    return hi;
  }
  if (u <= U[lo]!) return lo;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (U[mid]! <= u) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** de Boor(동차 4성분): 차수 p, 매듭 U, 조정점 P에서 u의 값 → out */
function deBoor(p: number, U: Float64Array, P: Float64Array, u: number, out: Float64Array): Float64Array {
  const n = P.length / 4;
  if (n < 1) {
    out.fill(0);
    return out;
  }
  const s = span(p, U, n, u);
  const d = new Float64Array((p + 1) * 4);
  for (let j = 0; j <= p; j++) for (let c = 0; c < 4; c++) d[j * 4 + c] = P[(s - p + j) * 4 + c]!;
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const t0 = U[j + s - p]!;
      const t1 = U[j + 1 + s - r]!;
      const a = t1 > t0 ? (u - t0) / (t1 - t0) : 0;
      for (let c = 0; c < 4; c++) d[j * 4 + c] = (1 - a) * d[(j - 1) * 4 + c]! + a * d[j * 4 + c]!;
    }
  for (let c = 0; c < 4; c++) out[c] = d[p * 4 + c]!;
  return out;
}

/** 표(t)의 곡선 정의(표마다 한 번씩 곡선별로 만들어 둔다) */
const defs = new WeakMap<NcSplines, (Def | null)[]>();

function defOf(t: NcSplines, k: number): Def | null {
  let list = defs.get(t);
  if (!list) defs.set(t, (list = new Array<Def | null>(t.count).fill(null)));
  let d = list[k];
  if (d) return d;
  const p = t.degree[k]!;
  const c0 = t.ctrlStart[k]!;
  const c1 = t.ctrlStart[k + 1]!;
  const U = t.knots.subarray(t.knotStart[k]!, t.knotStart[k + 1]!);
  const n = c1 - c0;
  if (n < p + 1 || U.length !== n + p + 1) return null;
  const P = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = t.weight[c0 + i]!;
    if (!(w > 0)) return null;
    P[i * 4] = t.ctrl[(c0 + i) * 3]! * w;
    P[i * 4 + 1] = t.ctrl[(c0 + i) * 3 + 1]! * w;
    P[i * 4 + 2] = t.ctrl[(c0 + i) * 3 + 2]! * w;
    P[i * 4 + 3] = w;
  }
  const D1 = derive(p, U, P);
  const D2 = D1 && derive(D1.p, D1.U, D1.P);
  d = { p, U, P, D1, D2 };
  list[k] = d;
  return d;
}

/** 동차 값·도함수 → 곡선 점·도함수(몫의 미분): C = A/W, C' = (A' − W'C)/W, C'' = (A'' − 2W'C' − W''C)/W */
function evalAll(d: Def, u: number): { c: V3; c1: V3; c2: V3 } {
  const a = deBoor(d.p, d.U, d.P, u, new Float64Array(4));
  const a1 = d.D1 ? deBoor(d.D1.p, d.D1.U, d.D1.P, u, new Float64Array(4)) : new Float64Array(4);
  const a2 = d.D2 ? deBoor(d.D2.p, d.D2.U, d.D2.P, u, new Float64Array(4)) : new Float64Array(4);
  const w = a[3]!;
  const c: V3 = [a[0]! / w, a[1]! / w, a[2]! / w];
  const c1: V3 = [0, 0, 0];
  const c2: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    c1[i] = (a1[i]! - a1[3]! * c[i]!) / w;
    c2[i] = (a2[i]! - 2 * a1[3]! * c1[i]! - a2[3]! * c[i]!) / w;
  }
  return { c, c1, c2 };
}

/** 같은 자리로 볼 허용치(좌표 크기의 1e-6 — 장면 float32 반올림을 넉넉히 덮는다) */
const tolOf = (p: ArrayLike<number>): number => 1e-6 * (1 + Math.max(Math.abs(p[0]!), Math.abs(p[1]!), Math.abs(p[2]!)));

/** 표의 곡선 k가 조각을 곡선 위 점 그대로 쌓았는지(조각 끝마다 그 매개변수의 곡선 점과 같은지 — 표마다 한 번) */
const valid = new WeakMap<NcSplines, Int8Array>();

/**
 * 표 t의 곡선 k(조각 끝이 이동 points와 맞지 않으면 null — 해석기가 쌓은 뒤 모서리 다듬기 등으로 옮겨졌다).
 * points = 이동 점(이동 i는 점 i → 점 i + 1)
 */
export function splineCurve(t: NcSplines, k: number, points: ArrayLike<number>): SplineCurve | null {
  if (!(k >= 0 && k < t.count)) return null;
  const d = defOf(t, k);
  if (!d) return null;
  const move = t.move[k]!;
  const moves = t.moves[k]!;
  const q0 = t.paramStart[k]!;
  const par = t.param.subarray(q0, q0 + moves + 1);
  if (par.length !== moves + 1 || (move + moves) * 3 + 2 >= points.length) return null;
  let ok = valid.get(t);
  if (!ok) valid.set(t, (ok = new Int8Array(t.count)));
  if (ok[k] === 0) {
    ok[k] = 1;
    for (let j = 0; j <= moves; j++) {
      const c = evalAll(d, par[j]!).c;
      const o = (move + j) * 3;
      const e = [points[o]!, points[o + 1]!, points[o + 2]!];
      if (Math.abs(c[0] - e[0]!) > tolOf(e) || Math.abs(c[1] - e[1]!) > tolOf(e) || Math.abs(c[2] - e[2]!) > tolOf(e)) {
        ok[k] = -1;
        break;
      }
    }
  }
  if (ok[k] !== 1) return null;
  const lo = par[0]!;
  const hi = par[moves]!;
  const s = evalAll(d, lo).c;
  const e = evalAll(d, hi).c;
  return {
    k,
    move,
    moves,
    lo,
    hi,
    closed: Math.hypot(s[0] - e[0], s[1] - e[1], s[2] - e[2]) <= tolOf(s),
    at: (u) => evalAll(d, u).c,
    d1: (u) => evalAll(d, u).c1,
    d2: (u) => evalAll(d, u).c2,
    piece: (j) => [par[j]!, par[j + 1]!],
  };
}

/** 이동 i를 조각으로 가진 곡선 번호(없으면 −1) — 첫 이동 번호가 오름차순이라 반 나누기 */
export function splineOfMove(t: NcSplines | undefined, i: number): number {
  if (!t || !t.count) return -1;
  let lo = 0;
  let hi = t.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.move[mid]! <= i) lo = mid;
    else hi = mid - 1;
  }
  return t.move[lo]! <= i && i < t.move[lo]! + t.moves[lo]! ? lo : -1;
}

/** 조각 j의 처짐(곡선이 조각 직선에서 가장 멀리 떨어진 거리 — 조각 안 일곱 점으로 어림, 조금 넉넉히) */
export function pieceSag(c: SplineCurve, j: number): number {
  const [u0, u1] = c.piece(j);
  const a = c.at(u0);
  const b = c.at(u1);
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!;
  let worst = 0;
  for (let i = 1; i < 8; i++) {
    const p = c.at(u0 + ((u1 - u0) * i) / 8);
    const w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const s = l2 > 0 ? Math.max(0, Math.min(1, (w[0]! * v[0]! + w[1]! * v[1]! + w[2]! * v[2]!) / l2)) : 0;
    worst = Math.max(worst, Math.hypot(w[0]! - s * v[0]!, w[1]! - s * v[1]!, w[2]! - s * v[2]!));
  }
  return worst * 1.15;
}

/**
 * 점 q에 가장 가까운 곡선 위 자리: 조각(직선) 가운데 q에 가장 가까운 것을 이동 점으로 고르고(구간 나눔 — 곡선 계산 없이),
 * 그 조각과 양옆 조각의 매개변수 구간에서 나눔 + 뉴턴(curve.ts nearestOn). 조각 번호 j도 준다
 */
export function splineNearest(c: SplineCurve, q: ArrayLike<number>, points: ArrayLike<number>): { u: number; dist: number; j: number } {
  let best = 0;
  let bestD = Infinity;
  for (let j = 0; j < c.moves; j++) {
    const o = (c.move + j) * 3;
    const ax = points[o]!;
    const ay = points[o + 1]!;
    const az = points[o + 2]!;
    const vx = points[o + 3]! - ax;
    const vy = points[o + 4]! - ay;
    const vz = points[o + 5]! - az;
    const l2 = vx * vx + vy * vy + vz * vz;
    const s = l2 > 0 ? Math.max(0, Math.min(1, ((q[0]! - ax) * vx + (q[1]! - ay) * vy + (q[2]! - az) * vz) / l2)) : 0;
    const d = Math.hypot(q[0]! - ax - s * vx, q[1]! - ay - s * vy, q[2]! - az - s * vz);
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  const lo = c.piece(Math.max(0, best - 1))[0];
  const hi = c.piece(Math.min(c.moves - 1, best + 1))[1];
  const r = nearestOn(c, [q[0]!, q[1]!, q[2]!], lo, hi);
  // 고른 자리가 놓인 조각
  let j = best;
  while (j > 0 && r.u < c.piece(j)[0]) j--;
  while (j < c.moves - 1 && r.u > c.piece(j)[1]) j++;
  return { ...r, j };
}

/** 가우스–르장드르 5점 */
const GL_X = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GL_W = [0.5688888888888889, 0.47862867049936647, 0.47862867049936647, 0.23692688505618908, 0.23692688505618908];

/** [a, b]의 곡선 길이(조각 하나 — 5점 적분) */
function lengthOf(c: Curve, a: number, b: number): number {
  const h = (b - a) / 2;
  const m = (a + b) / 2;
  let s = 0;
  for (let i = 0; i < 5; i++) {
    const t = c.d1(m + h * GL_X[i]!);
    s += GL_W[i]! * Math.hypot(t[0], t[1], t[2]);
  }
  return s * h;
}

/** 곡선의 호 길이 가운데 매개변수(조각마다 적분해 반을 넘는 조각을 찾고, 그 안에서 뉴턴) — 곡선마다 한 번 */
const mids = new WeakMap<NcSplines, Map<number, number>>();

export function splineMidParam(t: NcSplines, c: SplineCurve): number {
  let m = mids.get(t);
  if (!m) mids.set(t, (m = new Map()));
  const hit = m.get(c.k);
  if (hit !== undefined) return hit;
  const lens: number[] = [];
  let total = 0;
  for (let j = 0; j < c.moves; j++) {
    const [a, b] = c.piece(j);
    const l = lengthOf(c, a, b);
    lens.push(l);
    total += l;
  }
  let u = (c.lo + c.hi) / 2;
  if (total > 0) {
    let acc = 0;
    let j = 0;
    while (j < c.moves - 1 && acc + lens[j]! < total / 2) acc += lens[j++]!;
    const [a, b] = c.piece(j);
    const want = total / 2 - acc;
    // s(u) = a에서 u까지 길이 = want — 뉴턴(s' = |C'|), 조각 안에 둔다
    u = a + (b - a) * Math.min(1, Math.max(0, lens[j]! > 0 ? want / lens[j]! : 0.5));
    for (let it = 0; it < 30; it++) {
      const f = lengthOf(c, a, u) - want;
      const t1 = c.d1(u);
      const sp = Math.hypot(t1[0], t1[1], t1[2]);
      if (!(sp > 0)) break;
      const nu = Math.min(b, Math.max(a, u - f / sp));
      if (Math.abs(nu - u) <= 1e-15 * (1 + Math.abs(u))) {
        u = nu;
        break;
      }
      u = nu;
    }
  }
  m.set(c.k, u);
  return u;
}
