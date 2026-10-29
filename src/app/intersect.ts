/**
 * 두 요소의 교차점(코어 0.15.0 setMeasureSnap({ refine })의 'intersection' — 측정 도구 조각, 순수 함수, DOM 없음).
 *
 * 코어 교차점은 꺾은선 두 토막(원호·스플라인을 나눈 현, 직선 이동)이 만나는 점이거나, 조금 비켜 지나가는 두 토막의 가장 가까운 두 점의 가운데
 * (넓힌 교차 — 열린 후보)다. refine.ts가 두 토막이 놓인 요소(원호·스플라인·직선 — Side)를 찾아 넘기면 두 요소의 정확한 3D 교차점을 준다.
 * - 푸는 법: 직선 × 원(평면 위의 고른 원호)·원 × 원은 식(직선이 원 평면을 지나는 점, 두 평면이 만나는 직선과 원의 교점 — 같은 평면이면 평면 안 두 원의 교점).
 *   스플라인·나선·반지름이 조금씩 바뀌는 호가 끼면 두 매개변수 가우스-뉴턴(코어 점 둘레에서 시작하고, 못 닿으면 커서 둘레 표본의 거리 극소 몇 곳에서 다시)
 * - 허용치 tol(refine.ts — 1e-6 × (1 + 좌표 크기 + 두 토막 길이 합)): 두 요소 위 가장 가까운 두 점 사이가 이보다 멀면 3D로 만나지 않는다(null).
 *   받는 점은 두 점의 가운데이고, 두 요소 범위 안(각 요소까지 거리 tol 안)이어야 한다. 후보가 여럿이면 코어 점에 가장 가까운 것
 * - 같은 요소(같은 이동·윤곽 요소·스플라인)이거나 둘 다 직선(꺾은선이 곧 요소라 코어 점이 정확하다)이면 null
 * - 이어진 두 요소가 함께 쓰는 끝점(끝점끼리 tol 안)에서 만나면 null(끝점 붙잡기가 이미 정확하다)
 * 결과는 두 요소와 코어 점으로만 정해진다(커서 광선·첫 점을 쓰지 않는다 — 코어가 열린 후보를 광선 없이 기억한다)
 */
import { nearestOn, type Curve, type V3 } from './curve';

/** 교차점을 풀 요소 하나(세계 좌표) */
export interface Side {
  /** 요소 곡선: 매개변수 범위 [c.lo, c.hi]가 요소 전체(원호 0~1, 직선 0~1, 스플라인은 그 곡선) */
  c: Curve;
  /** 코어 점 둘레 찾기 범위(시작값을 고른다) */
  lo: number;
  hi: number;
  /** 같은 요소인지 견줄 열쇠 */
  key: string;
  /** 요소의 두 끝 */
  ends: [V3, V3];
  /** 점에서 요소(범위 전체)까지 거리 */
  dist(p: readonly number[]): number;
  /** 곧은 요소: 시작과 (끝 − 시작) */
  line?: { a: V3; d: V3 };
  /** 평면 위의 고른 원호: 중심·단위 법선·반지름 */
  circle?: { c: V3; n: V3; r: number };
}

/** 두 요소 위 점 짝(사이가 허용치 안이면 그 가운데가 교차점) */
type Pair = [V3, V3];

const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const addK = (a: readonly number[], b: readonly number[], k: number): V3 => [a[0]! + k * b[0]!, a[1]! + k * b[1]!, a[2]! + k * b[2]!];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const dist3 = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** 점 p에서 선분 a + t·d(t 0~1)까지 거리 */
function segmentDistance(p: readonly number[], a: readonly number[], d: readonly number[]): number {
  const l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return dist3(p, addK(a, d, t));
}

/** 곧은 요소 a → b(매개변수 0~1)의 Side. 길이가 없으면 null */
export function lineSide(a: V3, b: V3, key: string): Side | null {
  const d = sub(b, a);
  if (!(dot(d, d) > 0)) return null;
  const c: Curve = { lo: 0, hi: 1, at: (t) => addK(a, d, t), d1: () => [d[0], d[1], d[2]], d2: () => [0, 0, 0] };
  return { c, lo: 0, hi: 1, key, ends: [a, b], dist: (p) => segmentDistance(p, a, d), line: { a, d } };
}

/** 원 위에서 P에 가장 가까운 점(P를 원 평면에 내린 자리의 반지름 쪽). P가 원의 축 위면 null */
function onCircle(C: { c: V3; n: V3; r: number }, P: readonly number[]): V3 | null {
  const w = sub(P, C.c);
  const q = addK(w, C.n, -dot(w, C.n));
  const l = Math.hypot(q[0], q[1], q[2]);
  return l > 0 ? addK(C.c, q, C.r / l) : null;
}

/** 직선과 원(식): 직선이 원 평면을 지나는 점, 직선이 원 평면 위면 평면 안 두 교점(이차식). 짝은 [직선 위, 원 위] */
function lineCircle(l: { a: V3; d: V3 }, C: { c: V3; n: V3; r: number }, tol: number): Pair[] {
  const out: Pair[] = [];
  const push = (P: V3): void => {
    const Q = onCircle(C, P);
    if (Q) out.push([P, Q]);
  };
  const dl = Math.hypot(l.d[0], l.d[1], l.d[2]);
  const un = dot(l.d, C.n);
  if (Math.abs(un) > 1e-9 * dl) {
    push(addK(l.a, l.d, dot(sub(C.c, l.a), C.n) / un));
    return out;
  }
  if (Math.abs(dot(sub(l.a, C.c), C.n)) > tol) return out;
  // 원 중심에서 직선에 내린 발 f, 그 둘레 ±h
  const f = addK(l.a, l.d, dot(sub(C.c, l.a), l.d) / (dl * dl));
  const g = sub(f, C.c);
  const h = Math.sqrt(Math.max(0, C.r * C.r - dot(g, g))) / dl;
  push(addK(f, l.d, h));
  if (h > 0) push(addK(f, l.d, -h));
  return out;
}

/**
 * 원 둘(식): 두 평면이 만나는 직선과 원 1의 교점(원 1 위·평면 2 위)과 그 점에서 가장 가까운 원 2 위 점. 같은 평면이면 평면 안 두 원의 교점,
 * 나란한 다른 평면·같은 중심(같은 원 포함)은 없다. 짝은 [원 1 위, 원 2 위]
 */
function circleCircle(c1: { c: V3; n: V3; r: number }, c2: { c: V3; n: V3; r: number }, tol: number): Pair[] {
  const m = cross(c1.n, c2.n);
  const mm = dot(m, m);
  let f: V3;
  let u: V3;
  if (mm > 1e-18) {
    // 두 평면 n·x = h 위의 점: (h1 (n2 × m) + h2 (m × n1)) / |m|², 그 직선 위에서 원 1 중심에 가장 가까운 점 f
    const h1 = dot(c1.n, c1.c);
    const h2 = dot(c2.n, c2.c);
    const p0 = addK(addK([0, 0, 0], cross(c2.n, m), h1 / mm), cross(m, c1.n), h2 / mm);
    const ml = Math.sqrt(mm);
    u = [m[0] / ml, m[1] / ml, m[2] / ml];
    f = addK(p0, u, dot(sub(c1.c, p0), u));
  } else {
    const d0 = sub(c2.c, c1.c);
    if (Math.abs(dot(d0, c1.n)) > tol) return [];
    const d = addK(d0, c1.n, -dot(d0, c1.n));
    const dl = Math.hypot(d[0], d[1], d[2]);
    if (!(dl > tol)) return [];
    const e: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
    f = addK(c1.c, e, (c1.r * c1.r - c2.r * c2.r + dl * dl) / (2 * dl));
    u = cross(c1.n, e);
  }
  const g = sub(f, c1.c);
  const h = Math.sqrt(Math.max(0, c1.r * c1.r - dot(g, g)));
  const out: Pair[] = [];
  for (const s of h > 0 ? [h, -h] : [0]) {
    const X = addK(f, u, s);
    const P = onCircle(c1, X);
    const Q = onCircle(c2, X);
    if (P && Q) out.push([P, Q]);
  }
  return out;
}

/**
 * 두 매개변수 가우스-뉴턴: F(s, t) = A(s) − B(t)의 제곱을 줄인다(정규 방정식 [A′·A′, −A′·B′; −A′·B′, B′·B′] Δ = −[A′·F, −B′·F], 늘면 걸음을 반씩).
 * 매개변수는 요소 범위 안으로 자른다. 만나는 두 곡선이면 두 차례로 줄어 교차점에 닿고, 비켜 지나가면 가장 가까운 두 점에 머문다.
 * 두 접선이 나란해지면(접하는 자리) 멈춘다
 */
function closestPair(A: Curve, B: Curve, s: number, t: number): Pair {
  const fit = (c: Curve, v: number): number => Math.min(c.hi, Math.max(c.lo, v));
  let P = A.at(s);
  let Q = B.at(t);
  let DA = A.d1(s);
  let DB = B.d1(t);
  let F = sub(P, Q);
  let f2 = dot(F, F);
  for (let it = 0; it < 64 && f2 > 0; it++) {
    const a11 = dot(DA, DA);
    const a12 = -dot(DA, DB);
    const a22 = dot(DB, DB);
    const g1 = dot(DA, F);
    const g2 = -dot(DB, F);
    const det = a11 * a22 - a12 * a12;
    if (!(det > 1e-14 * a11 * a22)) break;
    const ds = (-g1 * a22 + g2 * a12) / det;
    const dt = (-g2 * a11 + g1 * a12) / det;
    let moved = false;
    for (let k = 0, w = 1; k < 30; k++, w *= 0.5) {
      const ns = fit(A, s + w * ds);
      const nt = fit(B, t + w * dt);
      const nP = A.at(ns);
      const nQ = B.at(nt);
      const nF = sub(nP, nQ);
      const n2 = dot(nF, nF);
      if (n2 < f2) {
        moved = ns !== s || nt !== t;
        s = ns;
        t = nt;
        P = nP;
        Q = nQ;
        DA = A.d1(s);
        DB = B.d1(t);
        F = nF;
        f2 = n2;
        break;
      }
    }
    if (!moved) break;
  }
  return [P, Q];
}

/** 표본 수(찾기 범위마다) — 코어 점 둘레 토막 다섯 안팎이면 넉넉하다 */
const SAMPLES = 16;

/**
 * 곡선이 끼는 두 요소의 교차점 후보: 코어 점에 가장 가까운 두 매개변수에서 가우스-뉴턴. 못 닿으면(사이가 tol보다 멀면) A의 찾기 범위 표본마다
 * B(찾기 범위)까지 거리를 재고 그 극소 세 곳에서 다시
 */
function curvePairs(A: Side, B: Side, point: readonly number[], tol: number): Pair[] {
  const first = closestPair(A.c, B.c, nearestOn(A.c, point, A.lo, A.hi).u, nearestOn(B.c, point, B.lo, B.hi).u);
  if (dist3(first[0], first[1]) <= tol) return [first];
  const ss: number[] = [];
  const tt: number[] = [];
  const dd: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const s = A.lo + ((A.hi - A.lo) * i) / SAMPLES;
    const r = nearestOn(B.c, A.c.at(s), B.lo, B.hi);
    ss.push(s);
    tt.push(r.u);
    dd.push(r.dist);
  }
  const mins: number[] = [];
  for (let i = 0; i < dd.length; i++) if ((i === 0 || dd[i]! <= dd[i - 1]!) && (i === dd.length - 1 || dd[i]! <= dd[i + 1]!)) mins.push(i);
  mins.sort((x, y) => dd[x]! - dd[y]!);
  return [first, ...mins.slice(0, 3).map((i) => closestPair(A.c, B.c, ss[i]!, tt[i]!))];
}

/**
 * 두 요소 A·B의 3D 교차점 가운데 코어 점(point)에 가장 가까운 것(세계 좌표). 만나지 않거나(tol 밖), 같은 요소, 둘 다 직선,
 * 이어진 두 요소의 공유 끝점(그 끝점에서 near 안)이면 null. 가장 가까운 교차점도 코어 점에서 reach보다 멀면(두 토막이 만드는 교차가 아니다) null
 */
export function intersectSides(A: Side, B: Side, point: readonly number[], tol: number, near = tol, reach = Infinity): V3 | null {
  if (A.key === B.key || (A.line && B.line)) return null;
  let pairs: Pair[];
  if (A.line && B.circle) pairs = lineCircle(A.line, B.circle, tol);
  else if (A.circle && B.line) pairs = lineCircle(B.line, A.circle, tol).map(([p, q]): Pair => [q, p]);
  else if (A.circle && B.circle) pairs = circleCircle(A.circle, B.circle, tol);
  else pairs = curvePairs(A, B, point, tol);
  let best: V3 | null = null;
  let bd = Infinity;
  for (const [P, Q] of pairs) {
    if (!(dist3(P, Q) <= tol)) continue;
    const X: V3 = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2, (P[2] + Q[2]) / 2];
    if (!X.every(Number.isFinite) || !(A.dist(X) <= tol) || !(B.dist(X) <= tol)) continue;
    const d = dist3(X, point);
    if (d < bd) {
      bd = d;
      best = X;
    }
  }
  if (!best || bd > reach) return null;
  // 이어진 두 요소가 함께 쓰는 끝점(끝점 붙잡기가 맡는다)
  for (const a of A.ends) for (const b of B.ends) if (dist3(a, b) <= tol && dist3(best, a) <= Math.max(tol, near)) return null;
  return best;
}
