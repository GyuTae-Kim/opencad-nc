/**
 * 매개변수 곡선(원호·스플라인) 위 점 찾기(순수 함수 — 측정 도구 조각, refine.ts·tangent.ts가 쓴다).
 *
 * 곡선은 점 C(u)와 1·2차 도함수(C'·C'')를 주고, 찾기는 모두 "구간을 나눠 시작값을 고른 뒤 뉴턴"이다:
 * 구간 [a, b]를 고르게 나눈 점에서 목적 함수를 보고, 가장 작은 칸(또는 부호가 바뀌는 칸)을 감싸는 구간 안에서
 * 안전한 뉴턴(벗어나면 반으로 나누기 — Numerical Recipes rtsafe 꼴)으로 도함수의 근을 1e-15 안팎까지 좁힌다.
 * - nearestOn: 점 q에 가장 가까운 자리((C − q)·C' = 0)
 * - footsFrom: 점 q에서 곡선에 내린 수직 발 모두(가까운 점·먼 점 — 부호가 바뀌는 칸마다)
 * - closestToRay: 광선(원점 o, 단위 방향 d)에 가장 가까운 자리((C − o)⊥ · C' = 0, ⊥ = 광선에 수직인 성분)
 */
export type V3 = [number, number, number];

/** 매개변수 곡선: 범위 [lo, hi]의 점과 도함수 */
export interface Curve {
  lo: number;
  hi: number;
  at(u: number): V3;
  d1(u: number): V3;
  d2(u: number): V3;
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * [a, b]에서 g의 근(g(a)·g(b) ≤ 0, dg = g의 도함수): 뉴턴 걸음이 구간을 벗어나거나 잘 줄지 않으면 반으로 나눈다.
 * 매개변수 크기의 1e-15까지(또는 60번)
 */
export function solveBracket(g: (u: number) => number, dg: (u: number) => number, a: number, b: number, u0 = (a + b) / 2): number {
  let ga = g(a);
  const gb = g(b);
  if (ga === 0) return a;
  if (gb === 0) return b;
  let lo = a;
  let hi = b;
  // lo 쪽이 음수가 되게
  if (ga > 0) {
    lo = b;
    hi = a;
    ga = gb;
  }
  let u = Math.min(Math.max(u0, Math.min(a, b)), Math.max(a, b));
  let dxOld = Math.abs(b - a);
  let dx = dxOld;
  let f = g(u);
  let df = dg(u);
  const eps = 1e-15 * (1 + Math.abs(a) + Math.abs(b));
  for (let k = 0; k < 60; k++) {
    // 뉴턴 걸음이 구간 밖이거나 반 나누기보다 덜 줄면 반으로
    if (((u - hi) * df - f) * ((u - lo) * df - f) > 0 || Math.abs(2 * f) > Math.abs(dxOld * df) || !Number.isFinite(f / df)) {
      dxOld = dx;
      dx = (hi - lo) / 2;
      u = lo + dx;
      if (lo === u) return u;
    } else {
      dxOld = dx;
      dx = f / df;
      const t = u;
      u -= dx;
      if (t === u) return u;
    }
    if (Math.abs(dx) < eps) return u;
    f = g(u);
    df = dg(u);
    if (f < 0) lo = u;
    else hi = u;
  }
  return u;
}

/** 나누는 칸 수(구간마다) — 원호 한 조각·스플라인 한 조각의 굽음이면 넉넉하다 */
const STEPS = 16;

/** 고르게 나눈 n + 1개 매개변수 */
function grid(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(i === n ? b : a + ((b - a) * i) / n);
  return out;
}

/**
 * 목적 h(u)를 [a, b]에서 가장 작게 하는 자리: 나눈 점 가운데 가장 작은 곳의 양옆 칸에서 g(= h'/2)의 근을 찾고(부호가 바뀌면),
 * 끝점·나눈 점과 견준다
 */
function minimize(h: (u: number) => number, g: (u: number) => number, dg: (u: number) => number, a: number, b: number, n: number): number {
  const us = grid(a, b, n);
  const hs = us.map(h);
  let k = 0;
  for (let i = 1; i < hs.length; i++) if (hs[i]! < hs[k]!) k = i;
  let best = us[k]!;
  let bestH = hs[k]!;
  for (const [l, r] of [
    [k - 1, k],
    [k, k + 1],
  ] as const) {
    if (l < 0 || r >= us.length) continue;
    const ul = us[l]!;
    const ur = us[r]!;
    if (!(g(ul) <= 0 && g(ur) >= 0)) continue;
    const u = solveBracket(g, dg, ul, ur, us[k]!);
    const v = h(u);
    if (v <= bestH) {
      best = u;
      bestH = v;
    }
  }
  return best;
}

/** 점 q에 가장 가까운 곡선 위 자리(u — [a, b] 안, 끝 포함)와 거리 */
export function nearestOn(c: Curve, q: readonly number[], a = c.lo, b = c.hi, n = STEPS): { u: number; dist: number } {
  const diff = (u: number): V3 => {
    const p = c.at(u);
    return [p[0] - q[0]!, p[1] - q[1]!, p[2] - q[2]!];
  };
  const h = (u: number): number => {
    const w = diff(u);
    return dot(w, w);
  };
  const g = (u: number): number => dot(diff(u), c.d1(u));
  const dg = (u: number): number => {
    const t = c.d1(u);
    return dot(t, t) + dot(diff(u), c.d2(u));
  };
  const u = minimize(h, g, dg, Math.min(a, b), Math.max(a, b), n);
  return { u, dist: Math.sqrt(h(u)) };
}

/**
 * 점 q에서 곡선에 내린 수직 발((C − q)·C' = 0)의 자리들([a, b] 안 — 부호가 바뀌는 칸마다 하나). 끝점은 넣지 않는다(곡선 밖으로 나간 발)
 */
export function footsFrom(c: Curve, q: readonly number[], a = c.lo, b = c.hi, n = STEPS): number[] {
  const g = (u: number): number => {
    const p = c.at(u);
    return dot([p[0] - q[0]!, p[1] - q[1]!, p[2] - q[2]!], c.d1(u));
  };
  const dg = (u: number): number => {
    const p = c.at(u);
    const t = c.d1(u);
    return dot(t, t) + dot([p[0] - q[0]!, p[1] - q[1]!, p[2] - q[2]!], c.d2(u));
  };
  const us = grid(Math.min(a, b), Math.max(a, b), n);
  const gs = us.map(g);
  const out: number[] = [];
  for (let i = 0; i + 1 < us.length; i++) {
    const g0 = gs[i]!;
    const g1 = gs[i + 1]!;
    if (g0 === 0 && i > 0) out.push(us[i]!);
    else if (g0 * g1 < 0) out.push(solveBracket(g, dg, us[i]!, us[i + 1]!));
  }
  return out;
}

/** 광선(원점 o, 단위 방향 d)에 가장 가까운 곡선 위 자리(u — [a, b] 안, 끝 포함)와 광선까지 거리 */
export function closestToRay(c: Curve, o: readonly number[], d: readonly number[], a = c.lo, b = c.hi, n = STEPS): { u: number; dist: number } {
  // 광선에 수직인 성분
  const perp = (v: readonly number[]): V3 => {
    const s = dot(v, d);
    return [v[0]! - s * d[0]!, v[1]! - s * d[1]!, v[2]! - s * d[2]!];
  };
  const w = (u: number): V3 => {
    const p = c.at(u);
    return perp([p[0] - o[0]!, p[1] - o[1]!, p[2] - o[2]!]);
  };
  const h = (u: number): number => {
    const x = w(u);
    return dot(x, x);
  };
  const g = (u: number): number => dot(w(u), c.d1(u));
  const dg = (u: number): number => {
    const t = perp(c.d1(u));
    return dot(t, t) + dot(w(u), c.d2(u));
  };
  const u = minimize(h, g, dg, Math.min(a, b), Math.max(a, b), n);
  return { u, dist: Math.sqrt(h(u)) };
}

/** 단위 접선(진행 방향). 길이가 없으면 null */
export function unitTangent(c: Curve, u: number): V3 | null {
  const t = c.d1(u);
  const l = Math.hypot(t[0], t[1], t[2]);
  return l > 1e-12 ? [t[0] / l, t[1] / l, t[2] / l] : null;
}
