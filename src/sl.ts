/**
 * Heidenhain SL 사이클(48차)의 평면 기하 — 순수 함수, 작업 평면 두 축(u, v). 직선·원호 요소를 그대로 다룬다.
 *
 * 근거: HEIDENHAIN TNC 640 가공 사이클 프로그래밍 설명서(NC 소프트웨어 34059x-17, 10/2022)
 * - 9.1절 266쪽: 공구 경로가 윤곽 안이면 포켓(예: 시계 방향 + RR), 밖이면 섬(예: 시계 방향 + RL). 윤곽은 접근·이탈 없는 닫힌 윤곽
 * - 9.3절 270~272쪽: 겹친 윤곽 — 포켓끼리는 합(첫 포켓이 둘째 포켓 밖에서 시작), 포켓 − 섬은 차, 첫 포켓이 둘째 포켓 안에서 시작하면 교집합
 * - 9.4절 274쪽: Q2 × 공구 반지름 = 옆 간격, Q8 = 공구 중심 경로의 안쪽 모서리 반지름
 * 방법(일반 평면 기하로 짰다 — 다른 CAD·NC 코드를 보지 않았다):
 * - 가공 면 경계: 모든 윤곽 요소를 서로의 교점에서 나누고, 조각 양쪽 가운데 한쪽만 가공 면인 조각을 가공 면이 왼쪽이 되게 돌려 고리로 잇는다.
 * - 떨어진 곡선(거리 d): 경계 고리마다 요소를 왼쪽으로 d만큼 옮기고(직선은 평행, 원호는 반지름 ∓ d — 점으로 줄면 뺀다), 오른쪽으로 꺾이는
 *   모서리는 원래 꼭짓점을 중심으로 한 반지름 d 호, 왼쪽으로 꺾이는 모서리는 직선으로 이은 날 곡선을 만든다. 날 곡선끼리의 교점에서 나눈 조각 가운데
 *   가운데 점이 가공 면 안이고 경계까지 거리가 d인 것만 남겨 고리로 잇는다(가공 면 쪽이 왼쪽).
 */
import { cornerElem, cornerIntersections } from './corner';
import { g7xCorners, g7xLine, g7xOffset, type G7xCorner, type G7xEl } from './lathe-g7x';

/** 요소: 직선 또는 원호(중심 cu·cv, 중심각 sweep — 반시계 +) */
export type SlEl = G7xEl;
/** 닫힌 고리(끝이 다음 요소의 시작, 마지막 끝이 첫 시작) */
export type SlLoop = SlEl[];

const TAU = Math.PI * 2;

const arcR = (e: SlEl): number => Math.hypot(e.su - e.cu, e.sv - e.cv);
/** 요소 길이 */
export const slElLen = (e: SlEl): number => (e.arc ? arcR(e) * Math.abs(e.sweep) : Math.hypot(e.eu - e.su, e.ev - e.sv));

/** 요소 위 비율 t(0 시작 ~ 1 끝)의 점 */
function at(e: SlEl, t: number): [number, number] {
  if (t <= 0) return [e.su, e.sv];
  if (t >= 1) return [e.eu, e.ev];
  if (!e.arc) return [e.su + (e.eu - e.su) * t, e.sv + (e.ev - e.sv) * t];
  const r = arcR(e);
  const a = Math.atan2(e.sv - e.cv, e.su - e.cu) + e.sweep * t;
  return [e.cu + r * Math.cos(a), e.cv + r * Math.sin(a)];
}

/** 비율 t의 단위 접선(진행 방향) */
export function slTanAt(e: SlEl, t: number): [number, number] {
  return tanAt(e, t);
}
function tanAt(e: SlEl, t: number): [number, number] {
  if (!e.arc) {
    const l = Math.hypot(e.eu - e.su, e.ev - e.sv) || 1;
    return [(e.eu - e.su) / l, (e.ev - e.sv) / l];
  }
  const a = Math.atan2(e.sv - e.cv, e.su - e.cu) + e.sweep * t;
  const s = Math.sign(e.sweep) || 1;
  return [-Math.sin(a) * s, Math.cos(a) * s];
}

/** 비율 t0 ~ t1 부분 */
function part(e: SlEl, t0: number, t1: number): SlEl {
  const p = at(e, t0);
  const q = at(e, t1);
  return e.arc ? { ...e, su: p[0], sv: p[1], eu: q[0], ev: q[1], sweep: e.sweep * (t1 - t0) } : g7xLine(p[0], p[1], q[0], q[1]);
}

/** 고리를 거꾸로(요소 차례와 방향) */
export function slReverse(loop: readonly SlEl[]): SlLoop {
  return loop
    .slice()
    .reverse()
    .map((e) => ({ ...e, su: e.eu, sv: e.ev, eu: e.su, ev: e.sv, sweep: -e.sweep }));
}

/** 원호 시작에서 점 (u, v)까지 진행 방향으로 돈 각(0 ~ 2π) */
function arcAngle(e: SlEl, u: number, v: number): number {
  const a = (Math.atan2(v - e.cv, u - e.cu) - Math.atan2(e.sv - e.cv, e.su - e.cu)) * (Math.sign(e.sweep) || 1);
  return ((a % TAU) + TAU) % TAU;
}

/** 요소까지 거리 */
function elDist(e: SlEl, u: number, v: number): number {
  if (!e.arc) {
    const du = e.eu - e.su;
    const dv = e.ev - e.sv;
    const l2 = du * du + dv * dv;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((u - e.su) * du + (v - e.sv) * dv) / l2)) : 0;
    return Math.hypot(u - e.su - du * t, v - e.sv - dv * t);
  }
  if (arcAngle(e, u, v) <= Math.abs(e.sweep)) return Math.abs(Math.hypot(u - e.cu, v - e.cv) - arcR(e));
  return Math.min(Math.hypot(u - e.su, v - e.sv), Math.hypot(u - e.eu, v - e.ev));
}

/** 요소의 둘레 상자 [u 최소, v 최소, u 최대, v 최대] */
function box(e: SlEl): [number, number, number, number] {
  const b: [number, number, number, number] = [Math.min(e.su, e.eu), Math.min(e.sv, e.ev), Math.max(e.su, e.eu), Math.max(e.sv, e.ev)];
  if (!e.arc) return b;
  const r = arcR(e);
  const a0 = Math.atan2(e.sv - e.cv, e.su - e.cu);
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    let d = (ang - a0) * (Math.sign(e.sweep) || 1);
    d = ((d % TAU) + TAU) % TAU;
    if (d > Math.abs(e.sweep)) continue;
    const x = e.cu + r * Math.cos(ang);
    const y = e.cv + r * Math.sin(ang);
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], y);
  }
  return b;
}

/** 점 (u, v)에서 +u 쪽으로 그은 반직선이 요소를 지나는 수(v는 반열린 규칙 — 이웃 요소와 끝점을 두 번 세지 않는다) */
function crossings(e: SlEl, u: number, v: number): number {
  if (!e.arc) {
    if (e.sv > v === e.ev > v) return 0;
    return e.su + ((v - e.sv) * (e.eu - e.su)) / (e.ev - e.sv) > u ? 1 : 0;
  }
  // 원호: v가 가장 큰·작은 각(π/2 + kπ)에서 나눈 단조 조각마다(조각은 원의 오른쪽·왼쪽 반 하나 안에 있다)
  const r = arcR(e);
  const a0 = Math.atan2(e.sv - e.cv, e.su - e.cu);
  const sg = Math.sign(e.sweep) || 1;
  const span = Math.abs(e.sweep);
  let first = ((((Math.PI / 2 - a0) * sg) % Math.PI) + Math.PI) % Math.PI;
  if (first < 1e-12) first += Math.PI;
  let n = 0;
  let pv = e.sv;
  let pa = a0;
  const step = (nv: number, na: number): void => {
    if (pv > v !== nv > v) {
      const side = Math.cos((pa + na) / 2) >= 0 ? 1 : -1;
      const x = e.cu + side * Math.sqrt(Math.max(0, r * r - (v - e.cv) * (v - e.cv)));
      if (x > u) n++;
    }
    pv = nv;
    pa = na;
  };
  for (let d = first; d < span - 1e-12; d += Math.PI) {
    const a = a0 + sg * d;
    step(e.cv + r * Math.sin(a), a);
  }
  step(e.ev, a0 + e.sweep);
  return n;
}

/** 닫힌 요소 열이 점을 둘러싸는지(짝홀 규칙) */
export function slContains(els: readonly SlEl[], u: number, v: number): boolean {
  let n = 0;
  for (const e of els) n += crossings(e, u, v);
  return n % 2 === 1;
}

/**
 * 요소 상자 나무(49차): 거리·반직선 질의가 모든 요소를 차례로 보지 않게 요소 상자를 둘로 나눠 묶는다(가운데 점의 긴 축 가운데값).
 * 답은 모든 요소를 차례로 본 것과 같다 — 상자가 질의 범위 밖인 요소는 거리가 범위보다 멀거나 반직선과 만나지 않아 답에 들지 않고,
 * 반올림을 덮는 여유 m만큼 넓혀 고른다(더 고른 요소는 같은 셈을 한 번 더 할 뿐)
 */
interface SlTree {
  /** 요소(잎 차례로 다시 늘어놓음)와 요소 상자 4개씩 */
  els: SlEl[];
  eb: Float64Array;
  /** 마디 상자 4개씩. 마디는 앞 차례로 — 안 마디의 왼쪽 자식은 바로 다음 마디, 오른쪽 자식은 kid */
  nb: Float64Array;
  /** 마디 캡슐: 선분 끝 A·B(4개씩)와 반지름 — 마디의 모든 요소가 선분 AB에서 반지름 안 */
  ca: Float64Array;
  cr: Float64Array;
  /** 잎이면 요소 [lo, hi), 안 마디면 lo = -1·hi = 오른쪽 자식 */
  lo: Int32Array;
  hi: Int32Array;
  m: number;
}

/** 잎 하나의 요소 수와 나무를 만드는 요소 수 하한(작으면 차례로 보는 것이 빠르다) */
const TREE_LEAF = 4;
const TREE_MIN = 24;

function slTree(src: readonly SlEl[]): SlTree {
  const n = src.length;
  const boxes = src.map(box);
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const nb: number[] = [];
  const ca: number[] = [];
  const cr: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  let big = 1;
  for (const b of boxes) big = Math.max(big, Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]), Math.abs(b[3]));
  const center = (i: number, ax: number): number => (boxes[i]![ax]! + boxes[i]![ax + 2]!) / 2;
  const build = (a: number, b: number): number => {
    const id = lo.length;
    lo.push(-1);
    hi.push(0);
    const nbb = [Infinity, Infinity, -Infinity, -Infinity];
    const cb = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = a; k < b; k++) {
      const x = boxes[idx[k]!]!;
      nbb[0] = Math.min(nbb[0]!, x[0]);
      nbb[1] = Math.min(nbb[1]!, x[1]);
      nbb[2] = Math.max(nbb[2]!, x[2]);
      nbb[3] = Math.max(nbb[3]!, x[3]);
      const cu = center(idx[k]!, 0);
      const cv = center(idx[k]!, 1);
      cb[0] = Math.min(cb[0]!, cu);
      cb[1] = Math.min(cb[1]!, cv);
      cb[2] = Math.max(cb[2]!, cu);
      cb[3] = Math.max(cb[3]!, cv);
    }
    nb.push(...nbb);
    // 캡슐(선분 AB + 반지름): 상자 긴 축으로 가장 앞·뒤 끝점을 잇고, 요소마다 AB에서 가장 먼 거리를 반지름으로(곡선 조각은 상자보다 훨씬 얇다)
    const cax = nbb[2]! - nbb[0]! >= nbb[3]! - nbb[1]! ? 0 : 1;
    let A = [0, 0];
    let Bp = [0, 0];
    let amin = Infinity;
    let amax = -Infinity;
    for (let k = a; k < b; k++) {
      const e = src[idx[k]!]!;
      for (const q of [
        [e.su, e.sv],
        [e.eu, e.ev],
      ]) {
        const s = q[cax]!;
        if (s < amin) {
          amin = s;
          A = q;
        }
        if (s > amax) {
          amax = s;
          Bp = q;
        }
      }
    }
    let rad = 0;
    for (let k = a; k < b; k++) rad = Math.max(rad, capBound(src[idx[k]!]!, A[0]!, A[1]!, Bp[0]!, Bp[1]!));
    ca.push(A[0]!, A[1]!, Bp[0]!, Bp[1]!);
    cr.push(rad);
    if (b - a <= TREE_LEAF) {
      lo[id] = a;
      hi[id] = b;
      return id;
    }
    const ax = cb[2]! - cb[0]! >= cb[3]! - cb[1]! ? 0 : 1;
    const sub = Array.from(idx.subarray(a, b)).sort((x, y) => center(x, ax) - center(y, ax) || x - y);
    for (let k = a; k < b; k++) idx[k] = sub[k - a]!;
    const mid = (a + b) >> 1;
    build(a, mid);
    hi[id] = build(mid, b);
    return id;
  };
  build(0, n);
  const eb = new Float64Array(n * 4);
  const els: SlEl[] = [];
  for (let k = 0; k < n; k++) {
    els.push(src[idx[k]!]!);
    eb.set(boxes[idx[k]!]!, k * 4);
  }
  return { els, eb, nb: Float64Array.from(nb), ca: Float64Array.from(ca), cr: Float64Array.from(cr), lo: Int32Array.from(lo), hi: Int32Array.from(hi), m: big * 1e-7 };
}

/** 점 (u, v)에서 선분 AB까지 거리의 제곱 */
function segDist2(u: number, v: number, au: number, av: number, bu: number, bv: number): number {
  const du = bu - au;
  const dv = bv - av;
  const l2 = du * du + dv * dv;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((u - au) * du + (v - av) * dv) / l2)) : 0;
  const x = u - au - du * t;
  const y = v - av - dv * t;
  return x * x + y * y;
}
const segDist = (u: number, v: number, au: number, av: number, bu: number, bv: number): number => Math.sqrt(segDist2(u, v, au, av, bu, bv));

/**
 * 요소의 모든 점이 선분 AB에서 이 거리 안(넉넉한 위 한계): 직선은 두 끝 가운데 먼 쪽(선분까지 거리는 직선 위에서 볼록),
 * 반원 이하 원호는 두 끝의 먼 쪽 + 활 높이(호의 점은 현에 수직으로 올린 자리 — 현의 점은 두 끝보다 멀지 않음), 그보다 큰 원호는 중심 + 반지름
 */
function capBound(e: SlEl, au: number, av: number, bu: number, bv: number): number {
  const ends = Math.max(segDist(e.su, e.sv, au, av, bu, bv), segDist(e.eu, e.ev, au, av, bu, bv));
  if (!e.arc) return ends;
  const r = arcR(e);
  const sw = Math.abs(e.sweep);
  if (sw <= Math.PI) return ends + r * (1 - Math.cos(sw / 2));
  return segDist(e.cu, e.cv, au, av, bu, bv) + r;
}

/** 점에서 상자(b의 k번째)까지 거리의 제곱이 lim2보다 큰지 */
function boxFar(b: Float64Array, k: number, u: number, v: number, lim2: number): boolean {
  const du = Math.max(b[k * 4]! - u, 0, u - b[k * 4 + 2]!);
  const dv = Math.max(b[k * 4 + 1]! - v, 0, v - b[k * 4 + 3]!);
  return du * du + dv * dv > lim2;
}

/** 거리가 t보다 가까운 요소가 있는지(본 마디·요소 수를 cnt에 더함) */
function treeNear(T: SlTree, u: number, v: number, t: number, cnt: { work: number }): boolean {
  // 거리는 0 이상이라 t ≤ 0이면 없다(모든 요소를 본 셈과 같은 답)
  if (!(t > 0)) return false;
  const lim = t + T.m;
  const lim2 = lim * lim;
  const stack = [0];
  let seen = 0;
  try {
    while (stack.length) {
      const id = stack.pop()!;
      seen++;
      if (boxFar(T.nb, id, u, v, lim2)) continue;
      // 캡슐로도 멀면 건너뜀(마디 요소의 모든 점이 캡슐 안): 선분까지 거리 > lim + 반지름 — 제곱으로 견줌
      const cl = lim + T.cr[id]!;
      if (segDist2(u, v, T.ca[id * 4]!, T.ca[id * 4 + 1]!, T.ca[id * 4 + 2]!, T.ca[id * 4 + 3]!) > cl * cl) continue;
      if (T.lo[id]! >= 0) {
        for (let k = T.lo[id]!; k < T.hi[id]!; k++) {
          if (boxFar(T.eb, k, u, v, lim2)) continue;
          seen++;
          if (elDist(T.els[k]!, u, v) < t) return true;
        }
      } else stack.push(T.hi[id]!, id + 1);
    }
    return false;
  } finally {
    cnt.work += seen;
  }
}

/** 점에서 +u 쪽 반직선이 지나는 수(slContains와 같은 셈 — 반직선 높이가 상자 v 범위 밖이거나 상자가 점 왼쪽이면 0이라 뺀다) */
function treeCross(T: SlTree, u: number, v: number, cnt: { work: number }): number {
  const m = T.m;
  const out = (b: Float64Array, k: number): boolean => v < b[k * 4 + 1]! - m || v > b[k * 4 + 3]! + m || b[k * 4 + 2]! < u - m;
  let n = 0;
  let seen = 0;
  const stack = [0];
  while (stack.length) {
    const id = stack.pop()!;
    seen++;
    if (out(T.nb, id)) continue;
    if (T.lo[id]! >= 0) {
      for (let k = T.lo[id]!; k < T.hi[id]!; k++) {
        if (out(T.eb, k)) continue;
        seen++;
        n += crossings(T.els[k]!, u, v);
      }
    } else stack.push(T.hi[id]!, id + 1);
  }
  cnt.work += seen;
  return n;
}

/** 닫힌 요소 열의 부호 있는 넓이(반시계 +) */
export function slArea(els: readonly SlEl[]): number {
  let a = 0;
  for (const e of els) {
    a += (e.su * e.ev - e.eu * e.sv) / 2;
    if (e.arc) {
      const r = arcR(e);
      a += ((r * r) / 2) * (e.sweep - Math.sin(e.sweep));
    }
  }
  return a;
}

/**
 * 포켓인지(설명서 9.1절 266쪽): RL(공구가 진행 방향 왼쪽)이면 반시계 윤곽, RR이면 시계 윤곽일 때 공구 경로가 윤곽 안 — 포켓.
 * 보정 없음(R0)은 설명서가 정하지 않아 포켓으로 본다(같은 설명서 12장 윤곽 공식은 "각 윤곽을 포켓으로 봄")
 */
export function slIsPocket(els: readonly SlEl[], comp: number): boolean {
  const a = slArea(els);
  if (comp === 1) return a > 0;
  if (comp === 2) return a < 0;
  return true;
}

/** 요소 위 점의 비율(점이 요소에서 eps 안일 때만, 아니면 null) */
function onParam(e: SlEl, u: number, v: number, eps: number): number | null {
  if (!e.arc) {
    const du = e.eu - e.su;
    const dv = e.ev - e.sv;
    const l = Math.hypot(du, dv);
    if (l < 1e-15) return null;
    const t = ((u - e.su) * du + (v - e.sv) * dv) / (l * l);
    const et = eps / l;
    if (t < -et || t > 1 + et) return null;
    return Math.max(0, Math.min(1, t));
  }
  const r = arcR(e);
  const span = Math.abs(e.sweep);
  const a = arcAngle(e, u, v);
  const ea = eps / Math.max(r, 1e-15);
  if (a <= span + ea) return Math.min(1, a / span);
  if (TAU - a <= ea) return 0;
  return null;
}

/** 두 요소의 교점 비율 [tA, tB] */
function intersect(A: SlEl, B: SlEl, eps: number): [number, number][] {
  const ca = cornerElem(A.su, A.sv, A.eu, A.ev, A.arc ? { cx: A.cu, cy: A.cv, sweep: A.sweep } : null);
  const cb = cornerElem(B.su, B.sv, B.eu, B.ev, B.arc ? { cx: B.cu, cy: B.cv, sweep: B.sweep } : null);
  if (!ca || !cb) return [];
  const out: [number, number][] = [];
  for (const q of cornerIntersections(ca, cb)) {
    const ta = onParam(A, q[0], q[1], eps);
    const tb = ta === null ? null : onParam(B, q[0], q[1], eps);
    if (ta !== null && tb !== null) out.push([ta, tb]);
  }
  return out;
}

interface RawEl {
  e: SlEl;
  /** 고리 번호와 고리 안 차례(이웃 요소의 맞닿은 끝은 교점으로 보지 않는다) */
  loop: number;
  idx: number;
  n: number;
}

/** 요소들을 서로의 교점에서 나눈 조각들(cnt가 있으면 견준 짝 수를 일로 더함 — 49차) */
function splitAll(raw: readonly RawEl[], eps: number, cnt?: { work: number }): SlEl[] {
  const n = raw.length;
  const boxes = raw.map((r) => box(r.e));
  const order = [...Array(n).keys()].sort((a, b) => boxes[a]![0] - boxes[b]![0]);
  const cuts: number[][] = raw.map(() => []);
  let pairs = 0;
  for (let x = 0; x < n; x++) {
    const i = order[x]!;
    const bi = boxes[i]!;
    for (let y = x + 1; y < n; y++) {
      const j = order[y]!;
      const bj = boxes[j]!;
      if (bj[0] > bi[2] + eps) break;
      pairs++;
      if (bj[1] > bi[3] + eps || bj[3] < bi[1] - eps) continue;
      const A = raw[i]!;
      const B = raw[j]!;
      const same = A.loop === B.loop;
      const bNext = same && (A.idx + 1) % A.n === B.idx;
      const aNext = same && (B.idx + 1) % B.n === A.idx;
      for (const [ta, tb] of intersect(A.e, B.e, eps)) {
        const la = slElLen(A.e);
        const lb = slElLen(B.e);
        const nearA1 = (1 - ta) * la < eps;
        const nearA0 = ta * la < eps;
        const nearB0 = tb * lb < eps;
        const nearB1 = (1 - tb) * lb < eps;
        // 고리에서 이어진 두 요소가 맞닿은 끝
        if ((bNext && nearA1 && nearB0) || (aNext && nearA0 && nearB1)) continue;
        cuts[i]!.push(ta);
        cuts[j]!.push(tb);
      }
    }
  }
  const out: SlEl[] = [];
  raw.forEach((r, i) => {
    const len = slElLen(r.e);
    const ts = cuts[i]!.filter((t) => t * len > eps && (1 - t) * len > eps).sort((a, b) => a - b);
    let t0 = 0;
    for (const t of ts) {
      if ((t - t0) * len <= eps) continue;
      out.push(part(r.e, t0, t));
      t0 = t;
    }
    if ((1 - t0) * len > eps) out.push(t0 === 0 ? { ...r.e } : part(r.e, t0, 1));
  });
  // 상자 견주기는 요소 거리 셈보다 가벼워 넷을 하나로 센다
  if (cnt) cnt.work += Math.ceil(pairs / 4);
  return out;
}

/** 조각들을 끝 → 시작으로 이어 닫힌 고리로(닫히지 않은 사슬 수 = open). 갈림길에서는 가장 오른쪽으로 꺾는 조각 */
function chain(ps: readonly SlEl[], tol: number): { loops: SlLoop[]; open: number } {
  const cell = Math.max(tol * 4, 1e-12);
  const key = (u: number, v: number): string => `${Math.round(u / cell)},${Math.round(v / cell)}`;
  const grid = new Map<string, number[]>();
  ps.forEach((p, i) => {
    const k = key(p.su, p.sv);
    const g = grid.get(k);
    if (g) g.push(i);
    else grid.set(k, [i]);
  });
  const used = new Uint8Array(ps.length);
  const next = (cur: SlEl): number => {
    const cu = Math.round(cur.eu / cell);
    const cv = Math.round(cur.ev / cell);
    const t = tanAt(cur, 1);
    let best = -1;
    let bestTurn = Infinity;
    for (let du = -1; du <= 1; du++)
      for (let dv = -1; dv <= 1; dv++)
        for (const j of grid.get(`${cu + du},${cv + dv}`) ?? []) {
          if (used[j]) continue;
          const p = ps[j]!;
          if (Math.hypot(p.su - cur.eu, p.sv - cur.ev) > tol) continue;
          const s = tanAt(p, 0);
          const turn = Math.atan2(t[0] * s[1] - t[1] * s[0], t[0] * s[0] + t[1] * s[1]);
          if (turn < bestTurn - 1e-12) {
            bestTurn = turn;
            best = j;
          }
        }
    return best;
  };
  const loops: SlLoop[] = [];
  let open = 0;
  for (let i = 0; i < ps.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop: SlLoop = [{ ...ps[i]! }];
    for (let guard = 0; guard < ps.length; guard++) {
      const cur = loop[loop.length - 1]!;
      if (loop.length > 1 && Math.hypot(cur.eu - loop[0]!.su, cur.ev - loop[0]!.sv) <= tol) break;
      const j = next(cur);
      if (j < 0) break;
      used[j] = 1;
      loop.push({ ...ps[j]!, su: cur.eu, sv: cur.ev });
    }
    const last = loop[loop.length - 1]!;
    if (Math.hypot(last.eu - loop[0]!.su, last.ev - loop[0]!.sv) <= tol) {
      last.eu = loop[0]!.su;
      last.ev = loop[0]!.sv;
      loops.push(loop);
    } else open++;
  }
  return { loops, open };
}

/** 가공 면: 윤곽들과 경계 고리 */
export interface SlRegion {
  pockets: SlLoop[];
  islands: SlLoop[];
  /** 두 포켓의 교집합(설명서 9.3절 272쪽 — 첫 포켓이 둘째 포켓 안에서 시작) */
  inter: boolean;
  /** 가공 면의 경계 고리(가공 면이 왼쪽) */
  loops: SlLoop[];
  /** 크기(윤곽 둘레 상자 대각선)와 길이 허용 오차 */
  scale: number;
  eps: number;
  /** 잇지 못한 경계 사슬 수(겹친 변 등 — 0이 보통) */
  open: number;
  /**
   * 49차: 셈한 일(요소 거리·반직선·교점 셈 수 — 고리 셈 한도 slLevels가 본다)과 요소 상자 나무
   * (포켓·섬 윤곽마다 — 작으면 없음 — 와 경계 고리 전체). 나무가 없으면 요소를 차례로 본다(답은 같다)
   */
  work?: number;
  pocketTrees?: (SlTree | null)[];
  islandTrees?: (SlTree | null)[];
  loopTree?: SlTree | null;
}

/** 셈한 일을 더할 자리(R.work) */
const counter = (R: SlRegion): { work: number } => {
  if (R.work === undefined) R.work = 0;
  return R as { work: number };
};

/** 윤곽 k가 점을 둘러싸는지(나무가 있으면 나무로 — slContains와 같은 답) */
function inContour(R: SlRegion, els: readonly SlEl[], T: SlTree | null | undefined, u: number, v: number): boolean {
  const c = counter(R);
  if (T) return treeCross(T, u, v, c) % 2 === 1;
  c.work += els.length;
  return slContains(els, u, v);
}

/** 점이 가공 면 안인지: 포켓 안(교집합이면 두 포켓 모두 안 — 포켓이 없으면 어디든)이고 어느 섬 안도 아님 */
export function slInside(R: SlRegion, u: number, v: number): boolean {
  if (R.pockets.length) {
    const inP = (p: SlLoop, i: number): boolean => inContour(R, p, R.pocketTrees?.[i], u, v);
    if (R.inter ? !R.pockets.every(inP) : !R.pockets.some(inP)) return false;
  }
  return !R.islands.some((p, i) => inContour(R, p, R.islandTrees?.[i], u, v));
}

/**
 * 경계까지 거리가 t보다 가까운지(49차) — slDist(R, u, v, t) < t와 같은 답. 경계 고리 나무가 있으면 상자가 t 안인 요소만 본다
 */
export function slNear(R: SlRegion, u: number, v: number, t: number): boolean {
  const c = counter(R);
  if (R.loopTree) return treeNear(R.loopTree, u, v, t, c);
  for (const l of R.loops)
    for (const e of l) {
      c.work++;
      if (elDist(e, u, v) < t) return true;
    }
  return false;
}

/** 경계까지 거리 */
export function slDist(R: SlRegion, u: number, v: number, stopBelow = -Infinity): number {
  let d = Infinity;
  for (const l of R.loops)
    for (const e of l) {
      const x = elDist(e, u, v);
      if (x < d) {
        d = x;
        if (d < stopBelow) return d;
      }
    }
  return d;
}

/** 윤곽(포켓·섬)들로 가공 면과 그 경계를 만든다 */
export function slRegion(contours: readonly { els: SlLoop; pocket: boolean }[]): SlRegion {
  const pockets = contours.filter((c) => c.pocket).map((c) => c.els);
  const islands = contours.filter((c) => !c.pocket).map((c) => c.els);
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const c of contours)
    for (const e of c.els) {
      const b = box(e);
      lo = [Math.min(lo[0]!, b[0]), Math.min(lo[1]!, b[1])];
      hi = [Math.max(hi[0]!, b[2]), Math.max(hi[1]!, b[3])];
    }
  const scale = Number.isFinite(lo[0]!) ? Math.max(Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!), 1e-6) : 1;
  const eps = Math.max(scale * 1e-9, 1e-12);
  // 두 포켓의 교집합: 첫 포켓의 시작점이 둘째 포켓 안
  const p0 = pockets[0]?.[0];
  const inter = pockets.length === 2 && islands.length === 0 && !!p0 && slContains(pockets[1]!, p0.su, p0.sv);
  const tree = (els: readonly SlEl[]): SlTree | null => (els.length >= TREE_MIN ? slTree(els) : null);
  const R: SlRegion = { pockets, islands, inter, loops: [], scale, eps, open: 0, work: 0, pocketTrees: pockets.map(tree), islandTrees: islands.map(tree), loopTree: null };
  const raw: RawEl[] = [];
  contours.forEach((c, k) => c.els.forEach((e, i) => raw.push({ e, loop: k, idx: i, n: c.els.length })));
  const pieces = splitAll(raw, eps * 10, counter(R));
  const keep: SlEl[] = [];
  const delta = Math.max(scale * 1e-6, 1e-9);
  for (const p of pieces) {
    const m = at(p, 0.5);
    const t = tanAt(p, 0.5);
    const d = Math.min(delta, slElLen(p) * 0.25);
    const left = slInside(R, m[0] - t[1] * d, m[1] + t[0] * d);
    const right = slInside(R, m[0] + t[1] * d, m[1] - t[0] * d);
    if (left && !right) keep.push(p);
    else if (right && !left) keep.push(slReverse([p])[0]!);
  }
  const c = chain(keep, eps * 1e3);
  R.loops = c.loops;
  R.open = c.open;
  R.loopTree = tree(c.loops.flat());
  return R;
}

/**
 * 가공 면 안에서 경계까지 거리가 d인 곡선(공구 중심 경로) — 고리마다 가공 면 쪽이 왼쪽. d가 0에 가까우면 경계 고리 그대로.
 * 하나도 없으면 빈 배열(공구가 윤곽보다 큼)
 */
export function slOffset(R: SlRegion, d: number): SlLoop[] {
  return offsetUpTo(R, d, Infinity)!;
}

/** slOffset과 같되 셈한 일(R.work)이 workLimit을 넘으면 그만두고 null(49차 — 고리 셈 한도) */
function offsetUpTo(R: SlRegion, d: number, workLimit: number): SlLoop[] | null {
  if (!(d > R.eps)) return R.loops.map((l) => l.map((e) => ({ ...e })));
  const raw: RawEl[] = [];
  R.loops.forEach((loop, k) => {
    const n = loop.length;
    const moved: (SlEl | null)[] = loop.map((e) => {
      if (!e.arc) {
        const l = Math.hypot(e.eu - e.su, e.ev - e.sv);
        if (l < 1e-15) return null;
        const nu = (-(e.ev - e.sv) / l) * d;
        const nv = ((e.eu - e.su) / l) * d;
        return { ...e, su: e.su + nu, sv: e.sv + nv, eu: e.eu + nu, ev: e.ev + nv };
      }
      const r = arcR(e);
      const r2 = r - Math.sign(e.sweep) * d;
      if (!(r2 > R.eps) || r < 1e-15) return null;
      const f = r2 / r;
      return { ...e, su: e.cu + (e.su - e.cu) * f, sv: e.cv + (e.sv - e.cv) * f, eu: e.cu + (e.eu - e.cu) * f, ev: e.cv + (e.ev - e.cv) * f };
    });
    const out: SlEl[] = [];
    for (let i = 0; i < n; i++) {
      const A = moved[i];
      if (!A) continue;
      out.push(A);
      // 다음 옮긴 요소(점으로 준 원호는 건너뛴다)
      let j = (i + 1) % n;
      let skipped = false;
      while (!moved[j] && j !== i) {
        j = (j + 1) % n;
        skipped = true;
      }
      const B = moved[j];
      if (!B) continue;
      const gap = Math.hypot(B.su - A.eu, B.sv - A.ev);
      if (gap <= R.eps * 10) continue;
      const V = loop[i]!;
      const tA = tanAt(loop[i]!, 1);
      const tB = tanAt(loop[(i + 1) % n]!, 0);
      const cr = tA[0] * tB[1] - tA[1] * tB[0];
      const dot = tA[0] * tB[0] + tA[1] * tB[1];
      if (!skipped && (cr < -1e-12 || (Math.abs(cr) <= 1e-12 && dot < 0))) {
        // 오른쪽으로 꺾임(가공 면의 오목한 꼭짓점): 꼭짓점 둘레 반지름 d 호(시계)
        const pu = V.eu;
        const pv = V.ev;
        let sw = Math.atan2(B.sv - pv, B.su - pu) - Math.atan2(A.ev - pv, A.eu - pu);
        while (sw >= 0) sw -= TAU;
        while (sw < -TAU) sw += TAU;
        out.push({ arc: true, su: A.eu, sv: A.ev, eu: B.su, ev: B.sv, cu: pu, cv: pv, sweep: sw });
      } else out.push(g7xLine(A.eu, A.ev, B.su, B.sv));
    }
    out.forEach((e, i) => raw.push({ e, loop: k, idx: i, n: out.length }));
  });
  if (!raw.length) return [];
  const cnt = counter(R);
  const pieces = splitAll(raw, R.eps * 10, cnt);
  const tolD = Math.max(R.scale, d) * 1e-7;
  const keep: SlEl[] = [];
  for (const p of pieces) {
    if (cnt.work > workLimit) return null;
    const m = at(p, 0.5);
    if (!slNear(R, m[0], m[1], d - tolD) && slInside(R, m[0], m[1])) keep.push(p);
  }
  return chain(keep, R.eps * 1e3).loops.filter((l) => l.reduce((s, e) => s + slElLen(e), 0) > R.eps * 100);
}

/** 고리 위에서 점에 가장 가까운 자리(요소 번호·비율·거리) */
function nearestOn(loop: readonly SlEl[], u: number, v: number): { i: number; t: number; d: number } {
  let best = { i: 0, t: 0, d: Infinity };
  loop.forEach((e, i) => {
    let t: number;
    if (!e.arc) {
      const du = e.eu - e.su;
      const dv = e.ev - e.sv;
      const l2 = du * du + dv * dv;
      t = l2 > 0 ? Math.max(0, Math.min(1, ((u - e.su) * du + (v - e.sv) * dv) / l2)) : 0;
    } else {
      const a = arcAngle(e, u, v);
      const span = Math.abs(e.sweep);
      if (a <= span) t = a / span;
      else t = Math.hypot(u - e.su, v - e.sv) <= Math.hypot(u - e.eu, v - e.ev) ? 0 : 1;
    }
    const p = at(e, t);
    const d = Math.hypot(p[0] - u, p[1] - v);
    if (d < best.d) best = { i, t, d };
  });
  return best;
}

/** 점까지 고리의 거리 */
export function slLoopDist(loop: readonly SlEl[], u: number, v: number): number {
  return nearestOn(loop, u, v).d;
}

/** 고리를 요소 i의 비율 t에서 시작하게 돌린다 */
function startAt(loop: readonly SlEl[], i: number, t: number, eps: number): SlLoop {
  const e = loop[i]!;
  const len = slElLen(e);
  if (t * len <= eps) return [...loop.slice(i), ...loop.slice(0, i)].map((x) => ({ ...x }));
  if ((1 - t) * len <= eps) {
    const k = (i + 1) % loop.length;
    return [...loop.slice(k), ...loop.slice(0, k)].map((x) => ({ ...x }));
  }
  return [part(e, t, 1), ...loop.slice(i + 1), ...loop.slice(0, i), part(e, 0, t)].map((x) => ({ ...x }));
}

/** 점에 가장 가까운 자리에서 시작하는 고리 */
export function slStartNear(loop: readonly SlEl[], u: number, v: number, eps: number): SlLoop {
  const n = nearestOn(loop, u, v);
  return startAt(loop, n.i, n.t, eps);
}

/** 가장 긴 직선 요소(없으면 가장 긴 요소)의 가운데에서 시작하는 고리(옆면 다듬질의 접선 접근 자리) */
export function slStartLongest(loop: readonly SlEl[], eps: number): SlLoop {
  let best = -1;
  let bl = -1;
  for (const lines of [true, false]) {
    loop.forEach((e, i) => {
      if (lines && e.arc) return;
      const l = slElLen(e);
      if (l > bl) {
        bl = l;
        best = i;
      }
    });
    if (best >= 0) break;
  }
  return best < 0 ? loop.map((e) => ({ ...e })) : startAt(loop, best, 0.5, eps);
}

/**
 * 왼쪽으로 꺾이는 날카로운 꼭짓점(공구 중심 경로의 안쪽 모서리 — 사이클 20 Q8)을 반지름 rad 호로 둥글린다.
 * 넣지 못한 모서리(앞뒤 요소보다 큼)는 그대로
 */
export function slRound(loop: readonly SlEl[], rad: number, eps: number): SlLoop {
  if (!(rad > 0) || loop.length < 2) return loop.map((e) => ({ ...e }));
  // 첫 요소를 반으로 나눠 고리의 이음(마지막 → 첫 요소)이 매끈하게
  const els = startAt(loop, 0, 0.5, eps);
  const corners: G7xCorner[] = [];
  for (let i = 0; i + 1 < els.length; i++) {
    const a = tanAt(els[i]!, 1);
    const b = tanAt(els[i + 1]!, 0);
    const cr = a[0] * b[1] - a[1] * b[0];
    const dot = a[0] * b[0] + a[1] * b[1];
    if (cr > 1e-9 && Math.atan2(cr, dot) > 1e-6) corners.push({ at: i, kind: 'round', size: rad });
  }
  if (!corners.length) return els;
  return g7xCorners(els, corners).els;
}

/** 선분 p → q가 거리 d인 고리들(levels0 — 가공 면 경계에서 d 떨어진 곡선)을 가로지르지 않고 그 안에 있는지(공구가 경계를 깎아 들어가지 않음) */
export function slSegmentFree(R: SlRegion, levels0: readonly SlLoop[], d: number, pu: number, pv: number, qu: number, qv: number): boolean {
  const len = Math.hypot(qu - pu, qv - pv);
  if (len <= R.eps * 10) return true;
  const seg = g7xLine(pu, pv, qu, qv);
  const tol = R.eps * 100;
  // 49차: 상자가 선분 상자와 겹치지 않는 요소는 교점이 없어 건너뛴다(교점은 두 요소 위 eps 안 — 여유 m은 반올림까지 덮는다)
  const m = Math.max(R.scale * 1e-6, R.eps * 100);
  const u0 = Math.min(pu, qu) - m;
  const u1 = Math.max(pu, qu) + m;
  const v0 = Math.min(pv, qv) - m;
  const v1 = Math.max(pv, qv) + m;
  for (const l of levels0)
    for (const e of l) {
      if (Math.max(e.su, e.eu) < u0 || Math.min(e.su, e.eu) > u1 || Math.max(e.sv, e.ev) < v0 || Math.min(e.sv, e.ev) > v1) {
        // 직선은 두 끝 상자가 곧 요소 상자 — 원호는 상자를 셈해 본다
        if (!e.arc) continue;
        const b = box(e);
        if (b[2] < u0 || b[0] > u1 || b[3] < v0 || b[1] > v1) continue;
      }
      for (const [t] of intersect(seg, e, R.eps * 10)) if (t * len > tol && (1 - t) * len > tol) return false;
    }
  const tolD = Math.max(R.scale, d) * 1e-7;
  for (const f of [0.25, 0.5, 0.75]) {
    const u = pu + (qu - pu) * f;
    const v = pv + (qv - pv) * f;
    if (!slInside(R, u, v) || slNear(R, u, v, d - tolD)) return false;
  }
  return true;
}

/**
 * 거친 깎기 고리들: levels[k] = 경계에서 d0 + k·step 떨어진 곡선(바깥 → 안). 고리가 없어질 때까지, maxLevels(capped 'rings')·
 * work(요소 수 합)·evals(49차 — 이번에 셈한 일 R.work, 요소 거리·반직선·교점 셈 수)까지(capped 'work' — 넘는 단계는 셈하지 않는다)
 */
export function slLevels(
  R: SlRegion,
  d0: number,
  step: number,
  maxLevels: number,
  work = 2_000_000,
  evals = Infinity,
): { levels: SlLoop[][]; capped: false | 'rings' | 'work' } {
  const levels: SlLoop[][] = [];
  let spent = 0;
  const n0 = R.loops.reduce((s, l) => s + l.length, 0);
  const limit = counter(R).work + evals;
  for (let k = 0; k < maxLevels; k++) {
    if (k > 0 && !(step > R.eps)) break;
    if (spent > work) return { levels, capped: 'work' };
    const loops = offsetUpTo(R, d0 + k * step, limit);
    if (!loops) return { levels, capped: 'work' };
    spent += n0 + loops.reduce((s, l) => s + l.length, 0);
    if (!loops.length) return { levels, capped: false };
    levels.push(loops);
  }
  return { levels, capped: step > R.eps && levels.length >= maxLevels ? 'rings' : false };
}

/**
 * 거친 깎기 차례: 안쪽 고리부터 바깥으로(설명서 9.6절 278쪽 — 들어간 자리에서 바깥으로 깎고, 섬 둘레를 깎은 뒤 포켓 윤곽 쪽으로).
 * 둘째 단계부터는 고리마다 한 단계 바깥의 가장 가까운 고리를 부모로 두고, 지금 자리에서 가까운 것부터 자식을 다 깎은 뒤 부모를 깎는다.
 * 가장 바깥 단계(경계에서 d0)는 마지막에 섬 둘레 고리(시계 — 넓이 음)를 먼저, 포켓 벽 고리를 나중에 깎는다.
 * 고리는 앞 고리 끝(처음은 from)에서 가장 가까운 자리에서 시작한다. reverse면 모든 고리를 거꾸로 돈다(가공 방향)
 */
export function slOrder(levels: readonly SlLoop[][], from: readonly [number, number], eps: number, reverse = false): SlLoop[] {
  type Node = { loop: SlLoop; kids: Node[] };
  const nodes: Node[][] = levels.map((ls) => ls.map((loop) => ({ loop: reverse ? slReverse(loop) : loop, kids: [] })));
  const holes0 = new Set((levels[0] ?? []).map((l, i) => (slArea(l) < 0 ? i : -1)).filter((i) => i >= 0));
  for (let k = 2; k < nodes.length; k++)
    for (const nd of nodes[k]!) {
      const s = nd.loop[0]!;
      let best: Node | null = null;
      let bd = Infinity;
      for (const p of nodes[k - 1]!) {
        const d = slLoopDist(p.loop, s.su, s.sv);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      best?.kids.push(nd);
    }
  const out: SlLoop[] = [];
  let cur: [number, number] = [from[0], from[1]];
  // 49차: 지금 자리(cur)가 그대로인 동안 고리까지 거리를 한 번만 셈한다(같은 고리를 자손 찾기마다 되풀이해 셈하던 것 — 답은 같다)
  let near = new Map<SlLoop, number>();
  const dist = (l: SlLoop): number => {
    let d = near.get(l);
    if (d === undefined) {
      d = slLoopDist(l, cur[0], cur[1]);
      near.set(l, d);
    }
    return d;
  };
  // 가장 깊은 자손의 고리까지 거리(먼저 깎을 고리가 가까운 것부터)
  const deepest = (nd: Node): Node => (nd.kids.length ? deepest(nd.kids.reduce((a, b) => (dist(a.loop) <= dist(b.loop) ? a : b))) : nd);
  const visit = (list: Node[]): void => {
    const left = list.slice();
    while (left.length) {
      let bi = 0;
      let bd = Infinity;
      left.forEach((nd, i) => {
        const dn = deepest(nd);
        const d = dist(dn.loop);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const nd = left.splice(bi, 1)[0]!;
      visit(nd.kids);
      const l = slStartNear(nd.loop, cur[0], cur[1], eps);
      out.push(l);
      const e = l[l.length - 1]!;
      cur = [e.eu, e.ev];
      near = new Map();
    }
  };
  visit(nodes[1] ?? []);
  const outer = nodes[0] ?? [];
  visit(outer.filter((_, i) => holes0.has(i)));
  visit(outer.filter((_, i) => !holes0.has(i)));
  return out;
}

/**
 * 윤곽 트레인(49차 — 사이클 25)의 공구 중심 경로: 열린(또는 닫힌) 요소 열에서 side 쪽(1 왼쪽 RL·-1 오른쪽 RR, 0이면 윤곽 위)으로 d만큼 떨어진 길.
 * 요소를 옮기고 모서리를 잇는 것은 g7xOffset(볼록 모서리는 꼭짓점 둘레 호, 오목 모서리는 교점까지)이고, 윤곽을 깎아 들어가지 않게
 * (설명서 9.10절 292쪽 — 컨트롤러가 언더컷·윤곽 손상을 막음) 길을 스스로 만나는 자리에서 나눈 조각 가운데 윤곽까지 거리가 d보다
 * 가까운 것은 뺀다(공구가 들어가지 못하는 홈은 건너 넘는다). 남은 조각을 이어진 것끼리 묶어 돌려준다(runs — 보통 하나, 뺀 곳 앞뒤가 떨어져 있으면 거기서 끊긴다).
 * cut = 뺀 조각이 있었는지
 */
export function slTrain(els: readonly SlEl[], d: number, side: number): { runs: SlLoop[]; cut: boolean } {
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const e of els) {
    const b = box(e);
    lo = [Math.min(lo[0]!, b[0]), Math.min(lo[1]!, b[1])];
    hi = [Math.max(hi[0]!, b[2]), Math.max(hi[1]!, b[3])];
  }
  const scale = Number.isFinite(lo[0]!) ? Math.max(Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!), 1e-6) : 1;
  const eps = Math.max(scale * 1e-9, 1e-12);
  if (!els.length) return { runs: [], cut: false };
  if (side === 0 || !(d > eps)) return { runs: [els.map((e) => ({ ...e }))], cut: false };
  const off = g7xOffset(els, d, side > 0 ? 1 : -1);
  const raw: RawEl[] = off.map((e, i) => ({ e, loop: 0, idx: i, n: off.length }));
  const pieces = splitAll(raw, eps * 10);
  const T = els.length >= TREE_MIN ? slTree(els) : null;
  const cnt = { work: 0 };
  const tolD = Math.max(scale, d) * 1e-7;
  const near = (u: number, v: number): boolean => {
    if (T) return treeNear(T, u, v, d - tolD, cnt);
    for (const e of els) if (elDist(e, u, v) < d - tolD) return true;
    return false;
  };
  const runs: SlLoop[] = [];
  let cut = false;
  let run: SlLoop | null = null;
  const tol = eps * 1e3;
  for (const p of pieces) {
    if (slElLen(p) <= eps) continue;
    const m = at(p, 0.5);
    if (near(m[0], m[1])) {
      // 뺀 조각(길이 스스로 만나 생긴 고리 등): 다음 남는 조각이 같은 자리에서 이어지면 그대로 잇는다
      cut = true;
      continue;
    }
    const last = run?.[run.length - 1];
    if (run && last && Math.hypot(p.su - last.eu, p.sv - last.ev) <= tol) run.push({ ...p, su: last.eu, sv: last.ev });
    else {
      run = [{ ...p }];
      runs.push(run);
    }
  }
  return { runs: runs.filter((r) => r.reduce((s, e) => s + slElLen(e), 0) > eps * 100), cut };
}
