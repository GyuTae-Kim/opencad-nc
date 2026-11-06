/**
 * Heidenhain SL 사이클(48차)의 평면 기하 — 순수 함수, 작업 평면 두 축(u, v). 직선·원호 요소를 그대로 다룬다.
 *
 * 근거: HEIDENHAIN TNC 640 가공 사이클 프로그래밍 설명서(NC 소프트웨어 34059x-17, 10/2022)
 * - 9.1절 266쪽: 공구 경로가 윤곽 안이면 포켓(예: 시계 방향 + RR), 밖이면 섬(예: 시계 방향 + RL). 윤곽은 접근·이탈 없는 닫힌 윤곽
 * - 9.3절 270~272쪽: 겹친 윤곽 — 포켓끼리는 합(첫 포켓이 둘째 포켓 밖에서 시작), 포켓 − 섬은 차, 첫 포켓이 둘째 포켓 안에서 시작하면 교집합
 * - 9.4절 274쪽: Q2 × 공구 반지름 = 옆 간격, Q8 = 공구 중심 경로의 안쪽 모서리 반지름
 * 방법(일반 평면 기하로 짰다 — 다른 CAD·NC 코드를 보지 않았다):
 * - 가공 면 경계: 모든 윤곽 요소를 서로의 교점에서 나누고, 조각 양쪽 가운데 한쪽만 가공 면인 조각을 가공 면이 왼쪽이 되게 돌려 고리로 잇는다.
 * - 떨어진 곡선(거리 d): 경계 고리마다 요소를 왼쪽으로 d만큼 옮기고(직선은 평행, 원호는 반지름 ∓ d — 점으로 줄면 빼고 그 양 끝을 꼭짓점으로 본다),
 *   오른쪽으로 꺾이는 모서리는 원래 꼭짓점을 중심으로 한 반지름 d 호, 왼쪽으로 꺾이는 모서리는 직선으로 이은 날 곡선을 만든다. 날 곡선끼리의 교점에서
 *   나눈 조각 가운데 가운데 점이 가공 면 안이고 경계까지 거리가 d인 것만 남겨 고리로 잇는다(가공 면 쪽이 왼쪽 — 닫히지 않으면 끝이 끊긴 가지를 빼고 다시).
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
  /** 50차: 마디 고리띠 조각(RING_N개씩 — ringBound) */
  ring: Float64Array;
}

/** 잎 하나의 요소 수와 나무를 만드는 요소 수 하한(작으면 차례로 보는 것이 빠르다) */
const TREE_LEAF = 4;
const TREE_MIN = 24;

/**
 * 50차 마디 고리띠 조각: 중심 C(cu, cv)에서 마디의 모든 요소 점이 거리 [rmin, rmax], 방향이 가운데 방향(mu, mv)에서 반각 h 안(cosH — 쓰지 않으면 -2)이고
 * e0·e1은 방향 범위 양 끝의 단위 벡터. 쓰지 않는 마디는 rmin = -Infinity. 원에 가까운 마디는 캡슐(현 + 활 높이)이 안쪽으로 활 높이만큼 두꺼워
 * 원 가운데 가까운 질의를 가지치지 못한다 — 고리띠는 두께가 요소 하나의 활 높이뿐이라 가지친다
 */
const RING_N = 11;
const NO_RING = [0, 0, -Infinity, Infinity, -2, 1, 0, 1, 0, 1, 0];

function ringBound(src: readonly SlEl[], idx: Int32Array, a: number, b: number, A: number[], B: number[], big: number): number[] {
  // 세 점(캡슐 두 끝 A·B와 AB에서 가장 먼 끝점 M)을 지나는 원의 중심
  let M = A;
  let far = -1;
  for (let k = a; k < b; k++) {
    const e = src[idx[k]!]!;
    for (const q of [
      [e.su, e.sv],
      [e.eu, e.ev],
    ]) {
      const s = segDist2(q[0]!, q[1]!, A[0]!, A[1]!, B[0]!, B[1]!);
      if (s > far) {
        far = s;
        M = q;
      }
    }
  }
  const bx = B[0]! - A[0]!;
  const by = B[1]! - A[1]!;
  const cx = M[0]! - A[0]!;
  const cy = M[1]! - A[1]!;
  const bb = bx * bx + by * by;
  const cc = cx * cx + cy * cy;
  const D = 2 * (bx * cy - by * cx);
  if (!(Math.abs(D) > 1e-9 * (bb + cc))) return NO_RING;
  const ox = (cy * bb - by * cc) / D;
  const oy = (bx * cc - cx * bb) / D;
  // 거의 곧은 마디는 중심이 아주 멀다 — 반올림이 여유를 넘지 않게 버린다(곧은 마디는 캡슐이 얇다)
  if (!(Math.hypot(ox, oy) < 1e5 * big)) return NO_RING;
  const cu = A[0]! + ox;
  const cv = A[1]! + oy;
  const wl = Math.hypot(M[0]! - cu, M[1]! - cv);
  if (!(wl > 0)) return NO_RING;
  const wu = (M[0]! - cu) / wl;
  const wv = (M[1]! - cv) / wl;
  let rmin = Infinity;
  let rmax = 0;
  let alo = Infinity;
  let ahi = -Infinity;
  const ang = (x: number, y: number): void => {
    const pu = x - cu;
    const pv = y - cv;
    const g = Math.atan2(wu * pv - wv * pu, wu * pu + wv * pv);
    alo = Math.min(alo, g);
    ahi = Math.max(ahi, g);
  };
  let full = false;
  for (let k = a; k < b; k++) {
    const e = src[idx[k]!]!;
    rmin = Math.min(rmin, elDist(e, cu, cv));
    const lo0 = alo;
    const hi0 = ahi;
    alo = Infinity;
    ahi = -Infinity;
    if (!e.arc) {
      rmax = Math.max(rmax, Math.hypot(e.su - cu, e.sv - cv), Math.hypot(e.eu - cu, e.ev - cv));
      // 선분이 C에서 보는 방향은 두 끝 방향 사이(짧은 쪽) — 차가 π 이상이면 뒤로 감싸 방향 범위를 쓰지 않는다
      ang(e.su, e.sv);
      ang(e.eu, e.ev);
    } else {
      rmax = Math.max(rmax, Math.hypot(e.cu - cu, e.cv - cv) + arcR(e));
      // 원호는 둘레 상자(볼록 — C가 안이면 네 귀 방향이 π 넘게 벌어짐)의 네 귀로
      const x = box(e);
      ang(x[0], x[1]);
      ang(x[2], x[1]);
      ang(x[0], x[3]);
      ang(x[2], x[3]);
    }
    if (!(ahi - alo < Math.PI * 0.99)) full = true;
    alo = Math.min(alo, lo0);
    ahi = Math.max(ahi, hi0);
  }
  if (!(ahi - alo < Math.PI * 0.99)) full = true;
  // 반올림 여유: 거리 범위를 조금 넓히고 방향 범위도 조금 넓힌다
  const slack = (wl + big) * 1e-12;
  rmin = Math.max(0, rmin - slack);
  rmax += slack;
  if (full) return [cu, cv, rmin, rmax, -2, 1, 0, 1, 0, 1, 0];
  const h = (ahi - alo) / 2 + 1e-9;
  const mid = (ahi + alo) / 2;
  const rot = (g: number): [number, number] => [wu * Math.cos(g) - wv * Math.sin(g), wu * Math.sin(g) + wv * Math.cos(g)];
  const m = rot(mid);
  const e0 = rot(alo - 1e-9);
  const e1 = rot(ahi + 1e-9);
  return [cu, cv, rmin, rmax, Math.cos(h), m[0], m[1], e0[0], e0[1], e1[0], e1[1]];
}

/** 점에서 마디 고리띠 조각까지 거리의 아래 한계(고리띠가 없으면 0) */
function ringLB(R: Float64Array, id: number, u: number, v: number): number {
  const o = id * RING_N;
  const rmin = R[o + 2]!;
  if (rmin === -Infinity) return 0;
  const cu = R[o]!;
  const cv = R[o + 1]!;
  const rmax = R[o + 3]!;
  const pu = u - cu;
  const pv = v - cv;
  const rho = Math.hypot(pu, pv);
  // 고리띠(방향 상관없이 — 언제나 맞는 아래 한계)
  let lb = Math.max(rmin - rho, rho - rmax);
  const cosH = R[o + 4]!;
  // 방향 범위 밖이 분명하면(반올림 여유를 둠) 조각까지 거리 = 양 끝 반지름 선분까지 거리 가운데 작은 것
  if (cosH > -2 && rho > 0 && pu * R[o + 5]! + pv * R[o + 6]! < rho * (cosH - 1e-9)) {
    const d0 = segDist(u, v, cu + R[o + 7]! * rmin, cv + R[o + 8]! * rmin, cu + R[o + 7]! * rmax, cv + R[o + 8]! * rmax);
    const d1 = segDist(u, v, cu + R[o + 9]! * rmin, cv + R[o + 10]! * rmin, cu + R[o + 9]! * rmax, cv + R[o + 10]! * rmax);
    lb = Math.max(lb, Math.min(d0, d1));
  }
  return lb;
}

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
  const ring: number[] = [];
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
    ring.push(...ringBound(src, idx, a, b, A, Bp, big));
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
  return {
    els,
    eb,
    nb: Float64Array.from(nb),
    ca: Float64Array.from(ca),
    cr: Float64Array.from(cr),
    lo: Int32Array.from(lo),
    hi: Int32Array.from(hi),
    m: big * 1e-7,
    ring: Float64Array.from(ring),
  };
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
      // 50차: 고리띠 조각으로도 멀면 건너뜀(원에 가까운 마디 — 원 가운데 가까운 질의)
      if (ringLB(T.ring, id, u, v) > lim) continue;
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

/**
 * 50차: 요소마다 확실히 버려질 팔 — 매개변수 [0, a]와 [b, 1] 위 모든 점이 경계에서 가깝다(a ≥ b면 요소 전체, 팔이 없으면 a = -1·b = 2)
 */
interface SlArms {
  a: Float64Array;
  b: Float64Array;
}

/** 요소들을 서로의 교점에서 나눈 조각들(cnt가 있으면 견준 짝 수를 일로 더함 — 49차). arms가 있으면 버려질 팔 안의 조각은 내지 않는다(50차) */
function splitAll(raw: readonly RawEl[], eps: number, cnt?: { work: number }, arms?: SlArms): SlEl[] {
  const n = raw.length;
  const boxes = raw.map((r) => box(r.e));
  const order = [...Array(n).keys()].sort((a, b) => boxes[a]![0] - boxes[b]![0]);
  const cuts: number[][] = raw.map(() => []);
  // 50차: 둘 다 모두 버려질 요소인 짝은 견주지 않는다(그 교점은 버려질 조각끼리만 나눈다). 모두 버려질 요소 뒤로는 그렇지 않은 요소로만 뛴다
  const dead = (i: number): boolean => !!arms && arms.a[i]! >= arms.b[i]!;
  let live: Int32Array | null = null;
  if (arms) {
    live = new Int32Array(n + 1);
    live[n] = n;
    for (let y = n - 1; y >= 0; y--) live[y] = dead(order[y]!) ? live[y + 1]! : y;
  }
  let pairs = 0;
  for (let x = 0; x < n; x++) {
    const i = order[x]!;
    const bi = boxes[i]!;
    const jump = live !== null && dead(i);
    for (let y = jump ? live![x + 1]! : x + 1; y < n; y = jump ? live![y + 1]! : y + 1) {
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
    // 50차: 가운데 점(매개변수 가운데)이 버려질 팔 [0, lo]·[hi, 1] 안인 조각은 내지 않는다 — 나누는 자리는 그대로라 남는 조각은 같다
    const lo = arms ? arms.a[i]! : -1;
    const hi = arms ? arms.b[i]! : 2;
    if (lo >= hi) return;
    const keep = (t0: number, t1: number): boolean => {
      const m = (t0 + t1) / 2;
      return m > lo && m < hi;
    };
    const len = slElLen(r.e);
    // 50차: 수 배열로 차례 짓기(걸러 낸 값은 0·NaN이 없어 (a, b) => a - b와 같은 차례)
    const ts = Float64Array.from(cuts[i]!.filter((t) => t * len > eps && (1 - t) * len > eps)).sort();
    let t0 = 0;
    for (const t of ts) {
      if ((t - t0) * len <= eps) continue;
      if (keep(t0, t)) out.push(part(r.e, t0, t));
      t0 = t;
    }
    if ((1 - t0) * len > eps && keep(t0, 1)) out.push(t0 === 0 ? { ...r.e } : part(r.e, t0, 1));
  });
  // 상자 견주기는 요소 거리 셈보다 가벼워 넷을 하나로 센다
  if (cnt) cnt.work += Math.ceil(pairs / 4);
  return out;
}

/** 조각들을 끝 → 시작으로 이어 닫힌 고리로(닫히지 않은 사슬 수 = open). 갈림길에서는 가장 오른쪽으로 꺾는 조각 */
function chain(ps: readonly SlEl[], tol: number): { loops: SlLoop[]; open: number } {
  const cell = Math.max(tol * 4, 1e-12);
  // 50차: 칸 열쇠를 글자 대신 두 단계 수 표로(칸마다 넣은 차례는 그대로라 고르는 차례도 같다)
  const grid = new Map<number, Map<number, number[]>>();
  ps.forEach((p, i) => {
    const ku = Math.round(p.su / cell);
    const kv = Math.round(p.sv / cell);
    let col = grid.get(ku);
    if (!col) grid.set(ku, (col = new Map()));
    const g = col.get(kv);
    if (g) g.push(i);
    else col.set(kv, [i]);
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
        for (const j of grid.get(cu + du)?.get(cv + dv) ?? []) {
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
  /** 50차: 마지막 떨어진 곡선 셈에서 남은 조각은 있는데(길이 합이 크기의 1/1000 넘게) 닫힌 고리가 하나도 없었으면 그 길이 합, 아니면 0 */
  unclosed?: number;
  /**
   * 53차 기준점(원점에서 아주 먼 윤곽 — SHIFT_RATIO): 있으면 pockets·islands·loops와 나무는 이만큼 뺀 자리다.
   * 자리를 받고 내는 공개 함수(slInside·slNear·slDist·slOffset·slLevels·slSegmentFree)는 들어온 자리에서 빼고 낸 고리에 더한다
   */
  ou?: number;
  ov?: number;
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
  return R.ou === undefined ? inside(R, u, v) : inside(R, u - R.ou, v - R.ov!);
}

/** slInside의 속(R의 자리 — 기준점을 뺀 자리) */
function inside(R: SlRegion, u: number, v: number): boolean {
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
  return R.ou === undefined ? near(R, u, v, t) : near(R, u - R.ou, v - R.ov!, t);
}

/** slNear의 속(R의 자리) */
function near(R: SlRegion, u: number, v: number, t: number): boolean {
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
  if (R.ou !== undefined) {
    u -= R.ou;
    v -= R.ov!;
  }
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

/**
 * 53차: 좌표 크기(윤곽 둘레 상자의 가장 큰 |좌표|)가 윤곽 크기의 이 배보다 크면 둘레 상자 가운데(기준점)를 빼고 셈한다(slRegion).
 * 판정 여유(eps·tolD)는 윤곽 크기 × 10⁻⁹인데 좌표의 반올림은 좌표 크기 × 2⁻⁵²라, 좌표/크기가 10⁶쯤이면 반올림이 여유만큼 커져
 * 고리를 잃거나 단계가 끊겼다(52차 합성 160경우 중 22경우 — 0.1 mm 윤곽이 10⁶ mm 자리 등). 여유를 좌표 크기로 키우면 작은 윤곽의
 * 판정이 틀어진다. 10⁴이면 반올림이 여유의 450분의 1로 틀어짐이 시작한 10⁶보다 100배 아래이고, 보통 프로그램(윤곽 수 mm 이상·좌표 수천 mm
 * 이하 — 비 10³ 아래)은 넘지 않아 예전 길 그대로(바이트까지 같은 결과). 넘으면 먼 축의 빼기는 정확하고(Sterbenz — 좌표가 기준점의 절반~두 배)
 * 결과를 되돌릴 때 좌표 크기의 반올림(10⁶ mm에서 1.2 × 10⁻¹⁰ mm)만 더해진다
 */
const SHIFT_RATIO = 1e4;

/** 요소를 (du, dv)만큼 옮긴 것(직선의 cu·cv는 쓰지 않아 그대로) */
function moveEl(e: SlEl, du: number, dv: number): SlEl {
  return e.arc ? { ...e, su: e.su + du, sv: e.sv + dv, eu: e.eu + du, ev: e.ev + dv, cu: e.cu + du, cv: e.cv + dv } : { ...e, su: e.su + du, sv: e.sv + dv, eu: e.eu + du, ev: e.ev + dv };
}

/** R의 자리(기준점을 뺀 자리)로 셈한 고리들을 프로그램 자리로 */
const toWorld = (R: SlRegion, loops: SlLoop[]): SlLoop[] => (R.ou === undefined ? loops : loops.map((l) => l.map((e) => moveEl(e, R.ou!, R.ov!))));

/** 윤곽들의 둘레 상자 [u 최소, v 최소], [u 최대, v 최대] */
function contoursBox(contours: readonly { els: SlLoop }[]): [number[], number[]] {
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const c of contours)
    for (const e of c.els) {
      const b = box(e);
      lo = [Math.min(lo[0]!, b[0]), Math.min(lo[1]!, b[1])];
      hi = [Math.max(hi[0]!, b[2]), Math.max(hi[1]!, b[3])];
    }
  return [lo, hi];
}

/** 윤곽(포켓·섬)들로 가공 면과 그 경계를 만든다. 53차: 원점에서 아주 먼 윤곽(SHIFT_RATIO)은 기준점(둘레 상자 가운데)을 빼고 셈한다 */
export function slRegion(contours: readonly { els: SlLoop; pocket: boolean }[]): SlRegion {
  const [lo, hi] = contoursBox(contours);
  const scale = Number.isFinite(lo[0]!) ? Math.max(Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!), 1e-6) : 1;
  // 유한하지 않은 좌표는 견줌이 거짓이라 예전 길
  if (Math.max(Math.abs(lo[0]!), Math.abs(lo[1]!), Math.abs(hi[0]!), Math.abs(hi[1]!)) > scale * SHIFT_RATIO) {
    const ou = (lo[0]! + hi[0]!) / 2;
    const ov = (lo[1]! + hi[1]!) / 2;
    const R = regionOf(contours.map((c) => ({ els: c.els.map((e) => moveEl(e, -ou, -ov)), pocket: c.pocket })));
    R.ou = ou;
    R.ov = ov;
    return R;
  }
  return regionOf(contours, lo, hi);
}

/** slRegion의 속(윤곽 자리 그대로 — 둘레 상자를 이미 셈했으면 받는다) */
function regionOf(contours: readonly { els: SlLoop; pocket: boolean }[], lo0?: number[], hi0?: number[]): SlRegion {
  const pockets = contours.filter((c) => c.pocket).map((c) => c.els);
  const islands = contours.filter((c) => !c.pocket).map((c) => c.els);
  const [lo, hi] = lo0 && hi0 ? [lo0, hi0] : contoursBox(contours);
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
    const left = inside(R, m[0] - t[1] * d, m[1] + t[0] * d);
    const right = inside(R, m[0] + t[1] * d, m[1] - t[0] * d);
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
 * 하나도 없으면 빈 배열(공구가 윤곽보다 큼). plain은 시험용(offsetUpTo)
 */
export function slOffset(R: SlRegion, d: number, plain = false): SlLoop[] {
  return toWorld(R, offsetUpTo(R, d, Infinity, plain)!);
}

/**
 * 직선 K(s) = (pu, pv) + s·(du, dv)의 s 범위 가운데 선분 AB(A = B면 점)까지 거리가 r보다 작은 곳의 둘레(캡슐 = 띠 + 두 끝 원 — 볼록이라 한 구간).
 * 어림이라 쓰는 쪽이 두 끝을 다시 확인한다
 */
function capsuleSpan(pu: number, pv: number, du: number, dv: number, au: number, av: number, bu: number, bv: number, r: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const add = (x0: number, x1: number): void => {
    if (!(x0 < x1)) return;
    lo = Math.min(lo, x0);
    hi = Math.max(hi, x1);
  };
  const qa = du * du + dv * dv;
  const disk = (cu: number, cv: number): void => {
    const wu = pu - cu;
    const wv = pv - cv;
    const qb = wu * du + wv * dv;
    const disc = qb * qb - qa * (wu * wu + wv * wv - r * r);
    if (!(disc > 0) || !(qa > 0)) return;
    const sq = Math.sqrt(disc);
    add((-qb - sq) / qa, (-qb + sq) / qa);
  };
  disk(au, av);
  const eu = bu - au;
  const ev = bv - av;
  const le2 = eu * eu + ev * ev;
  if (le2 > 0) {
    disk(bu, bv);
    // 띠: 선분에 수직인 거리 |h| < r, 선분 위로 내린 자리 0 ≤ q ≤ 1 — 둘 다 s의 일차식
    const le = Math.sqrt(le2);
    let s0 = -Infinity;
    let s1 = Infinity;
    const lin = (al: number, be: number, l: number, h: number): void => {
      if (be === 0) {
        if (!(al > l && al < h)) s0 = Infinity;
        return;
      }
      const x0 = (l - al) / be;
      const x1 = (h - al) / be;
      s0 = Math.max(s0, Math.min(x0, x1));
      s1 = Math.min(s1, Math.max(x0, x1));
    };
    lin((-ev * (pu - au) + eu * (pv - av)) / le, (-ev * du + eu * dv) / le, -r, r);
    lin((eu * (pu - au) + ev * (pv - av)) / le2, (eu * du + ev * dv) / le2, 0, 1);
    add(s0, s1);
  }
  return [Math.max(0, lo), Math.min(1, hi)];
}

/**
 * 50차: 떨어진 곡선의 날 요소 가운데 직선마다 확실히 버려질 팔(SlArms) — 그 위 모든 점이 어떤 경계 요소에서 lim = t − μ보다 가깝다.
 * 그 팔에 가운데 점이 있는 조각은 slNear(…, t)가 참이라 버려지므로 만들지도 묻지도 않는다(답은 같다).
 * 증인 요소: 날 요소의 출처 이웃(옮긴 요소 i면 i ± 1, 모서리 잇기 i → j면 i·j)과, 경계 고리를 따라 거리가 줄어드는 쪽으로 걸어 찾은 가까운 요소
 * (앞 날 요소에서 찾은 자리부터 — 원꼴 윤곽 가운데 고리는 맞은편 요소가 가깝다)와 그 이웃. 증인마다 날 요소가 그 캡슐(반지름 t − 2μ) 안인 범위를 어림하고
 * 범위 두 끝에서 실제 거리가 lim보다 가까운지 확인한다 — 직선 위에서 선분·점까지 거리는 볼록이라 두 끝이 가까우면 사이도 가깝다.
 * 원호 증인은 현(반원 이하 — 현까지 거리 + 활 높이가 원호까지 거리의 위 한계)이나 두 끝점으로 본다. 원호 날 요소는 arcArms(51차)
 */
function deadArms(R: SlRegion, raw: readonly RawEl[], srcA: Int32Array, srcB: Int32Array, t: number, mu: number, cnt: { work: number }): SlArms {
  const n = raw.length;
  const A = new Float64Array(n).fill(-1);
  const B = new Float64Array(n).fill(2);
  const r = t - 2 * mu;
  const lim = t - mu;
  if (!(r > 0)) return { a: A, b: B };
  const carry = new Int32Array(R.loops.length).fill(-1);
  // 51차: 원호 날 요소의 걷기 시작 자리(직선과 따로 — 직선의 팔·일은 50차 그대로)
  const arcCarry = new Int32Array(R.loops.length).fill(-1);
  const ivs: [number, number][] = [];
  const tried: number[] = [];
  for (let q = 0; q < n; q++) {
    const K = raw[q]!.e;
    if (K.arc) {
      const ab = arcArms(R, K, raw[q]!.loop, srcA[q]!, srcB[q]!, r, lim, arcCarry, cnt);
      A[q] = ab[0];
      B[q] = ab[1];
      continue;
    }
    const du = K.eu - K.su;
    const dv = K.ev - K.sv;
    if (!(Math.hypot(du, dv) > R.eps)) continue;
    const k = raw[q]!.loop;
    const loop = R.loops[k]!;
    const m = loop.length;
    ivs.length = 0;
    tried.length = 0;
    // 범위 [s0, s1]의 두 끝에서 거리 f가 lim보다 가까우면 넣는다
    const check = (s: [number, number], f: (u: number, v: number) => number): void => {
      if (!(s[0] <= s[1])) return;
      cnt.work += 2;
      const p = at(K, s[0]);
      const p1 = at(K, s[1]);
      if (f(p[0], p[1]) < lim && f(p1[0], p1[1]) < lim) ivs.push(s);
    };
    const point = (u: number, v: number): void => check(capsuleSpan(K.su, K.sv, du, dv, u, v, u, v, r), (x, y) => Math.hypot(x - u, y - v));
    const witness = (idx: number): void => {
      const w = ((idx % m) + m) % m;
      if (tried.includes(w)) return;
      tried.push(w);
      const e = loop[w]!;
      cnt.work++;
      if (!e.arc) {
        check(capsuleSpan(K.su, K.sv, du, dv, e.su, e.sv, e.eu, e.ev, r), (x, y) => elDist(e, x, y));
        return;
      }
      const sw = Math.abs(e.sweep);
      if (sw <= Math.PI) {
        const sag = arcR(e) * (1 - Math.cos(sw / 2));
        if (r - sag > 0) check(capsuleSpan(K.su, K.sv, du, dv, e.su, e.sv, e.eu, e.ev, r - sag), (x, y) => segDist(x, y, e.su, e.sv, e.eu, e.ev) + sag);
      }
      point(e.su, e.sv);
      point(e.eu, e.ev);
    };
    // 덮인 앞쪽 [0, a]와 뒤쪽 [b, 1]
    let a = -1;
    let b = 2;
    const arms = (): void => {
      ivs.sort((x, y) => x[0] - y[0]);
      a = -1;
      for (const s of ivs) {
        if (a < 0 ? s[0] <= 0 : s[0] <= a) a = Math.max(a, s[1]);
        else break;
      }
      const byEnd = ivs.slice().sort((x, y) => y[1] - x[1]);
      b = 2;
      for (const s of byEnd) {
        if (b > 1 ? s[1] >= 1 : s[1] >= b) b = Math.min(b, s[0]);
        else break;
      }
    };
    if (srcB[q]! < 0) {
      witness(srcA[q]! - 1);
      witness(srcA[q]! + 1);
    } else {
      witness(srcA[q]!);
      witness(srcB[q]!);
    }
    arms();
    if (a < b) {
      // 덮이지 않은 곳의 가운데에서 경계 고리를 따라 거리가 줄어드는 쪽으로 걷는다(앞 날 요소에서 찾은 자리부터)
      const p = at(K, (Math.max(a, 0) + Math.min(b, 1)) / 2);
      let w = carry[k]! >= 0 ? carry[k]! : srcA[q]!;
      let fw = elDist(loop[w]!, p[0], p[1]);
      cnt.work++;
      for (let step = 0; step < m; step++) {
        const w1 = (w + 1) % m;
        const w0 = (w + m - 1) % m;
        const f1 = elDist(loop[w1]!, p[0], p[1]);
        const f0 = elDist(loop[w0]!, p[0], p[1]);
        cnt.work += 2;
        if (f1 < fw && f1 <= f0) {
          w = w1;
          fw = f1;
        } else if (f0 < fw) {
          w = w0;
          fw = f0;
        } else break;
      }
      carry[k] = w;
      if (fw < lim) {
        const before = ivs.length;
        witness(w);
        witness(w - 1);
        witness(w + 1);
        if (ivs.length > before) arms();
      }
    }
    A[q] = a;
    B[q] = b;
  }
  return { a: A, b: B };
}

/** 51차: 원호 날 요소를 나누는 토막 수의 위 한계 */
const ARC_PARTS = 64;

/**
 * 51차: 원호 날 요소 K의 확실히 버려질 팔 [0, a]·[b, 1](없으면 a = -1·b = 2, a ≥ b면 요소 전체). 직선 날 요소(deadArms)와 같은 길을 원호에 쓴다 —
 * K를 같은 각의 토막으로 나눠(토막마다 활 높이가 캡슐 반지름의 50분의 1 이하) 토막의 현을 직선으로 보고 증인 캡슐(반지름 r − 활 높이)과 겹치는
 * 범위를 어림한 뒤, 범위 두 끝(원호 위 점)에서 증인까지 거리의 큰 쪽 + 그 범위의 활 높이가 lim보다 작은지 확인한다 — 범위의 원호 점은 그 현 위 점에서
 * 활 높이 안이고, 선분·점까지 거리는 현 위에서 볼록이라 현의 두 끝이 큰 쪽이다.
 * 증인은 직선과 같다(출처 이웃, 경계 고리를 따라 걸어 찾은 가까운 요소와 그 이웃 — 원호 증인은 반원 이하면 현 + 활 높이, 두 끝점).
 * 50차까지 원호 날 요소(옮긴 원호·오목 모서리 호)는 팔이 없어, 원호가 수백 개 이어진 원꼴 윤곽의 가운데 가까운 고리에서 버려질 조각을 모두 물었다
 */
function arcArms(R: SlRegion, K: SlEl, k: number, sa: number, sb: number, r: number, lim: number, carry: Int32Array, cnt: { work: number }): [number, number] {
  const rho = arcR(K);
  const span = Math.abs(K.sweep);
  // 범위는 직선과 같은 캡슐(반지름 r = t − 2μ)에서 토막·증인의 활 높이를 뺀 것으로 어림하고(어림일 뿐), 확인은 lim = t − μ로 한다
  if (!(rho * span > R.eps) || !(r > 0)) return [-1, 2];
  const loop = R.loops[k]!;
  const m = loop.length;
  // 토막의 활 높이 ≤ r/50(토막 각 θ에서 rho·(1 − cos(θ/2)) ≤ r/50) — 많아야 ARC_PARTS토막(넘으면 활 높이만큼 캡슐이 줄 뿐)
  const c = 1 - r / 50 / rho;
  const maxAng = c > -1 ? Math.min(Math.PI / 2, 2 * Math.acos(c)) : Math.PI / 2;
  const parts = Math.max(Math.ceil(span / (Math.PI / 2)), Math.min(ARC_PARTS, Math.ceil(span / maxAng)));
  const sagOf = (dt: number): number => rho * (1 - Math.cos((span * dt) / 2));
  const sagPart = sagOf(1 / parts);
  const ivs: [number, number][] = [];
  // 토막 p의 현 위에서 캡슐(선분 AB, 반지름 rr) 범위 → K의 t 범위, 두 끝 확인
  const span1 = (p: number, f: (u: number, v: number) => number, au: number, av: number, bu: number, bv: number, add: number): void => {
    const rr = r - add - sagPart;
    if (!(rr > 0)) return;
    const c0 = at(K, p / parts);
    const c1 = at(K, (p + 1) / parts);
    const s = capsuleSpan(c0[0], c0[1], c1[0] - c0[0], c1[1] - c0[1], au, av, bu, bv, rr);
    if (!(s[0] <= s[1])) return;
    const t0 = (p + s[0]) / parts;
    const t1 = (p + s[1]) / parts;
    cnt.work += 2;
    const x0 = at(K, t0);
    const x1 = at(K, t1);
    if (Math.max(f(x0[0], x0[1]), f(x1[0], x1[1])) + sagOf(t1 - t0) < lim) ivs.push([t0, t1]);
  };
  const tried: number[] = [];
  const witness = (idx: number): void => {
    const w = ((idx % m) + m) % m;
    if (tried.includes(w)) return;
    tried.push(w);
    const e = loop[w]!;
    cnt.work++;
    const sw = Math.abs(e.sweep);
    const sagE = e.arc && sw <= Math.PI ? arcR(e) * (1 - Math.cos(sw / 2)) : 0;
    for (let p = 0; p < parts; p++) {
      if (!e.arc) span1(p, (x, y) => segDist(x, y, e.su, e.sv, e.eu, e.ev), e.su, e.sv, e.eu, e.ev, 0);
      else {
        if (sw <= Math.PI) span1(p, (x, y) => segDist(x, y, e.su, e.sv, e.eu, e.ev) + sagE, e.su, e.sv, e.eu, e.ev, sagE);
        span1(p, (x, y) => Math.hypot(x - e.su, y - e.sv), e.su, e.sv, e.su, e.sv, 0);
        span1(p, (x, y) => Math.hypot(x - e.eu, y - e.ev), e.eu, e.ev, e.eu, e.ev, 0);
      }
    }
  };
  // 덮인 앞쪽 [0, a]와 뒤쪽 [b, 1](직선과 같은 셈)
  let a = -1;
  let b = 2;
  const arms = (): void => {
    ivs.sort((x, y) => x[0] - y[0]);
    a = -1;
    for (const s of ivs) {
      if (a < 0 ? s[0] <= 0 : s[0] <= a) a = Math.max(a, s[1]);
      else break;
    }
    const byEnd = ivs.slice().sort((x, y) => y[1] - x[1]);
    b = 2;
    for (const s of byEnd) {
      if (b > 1 ? s[1] >= 1 : s[1] >= b) b = Math.min(b, s[0]);
      else break;
    }
  };
  if (sb < 0) {
    witness(sa - 1);
    witness(sa + 1);
  } else {
    witness(sa);
    witness(sb);
  }
  arms();
  if (a < b) {
    // 덮이지 않은 곳의 가운데에서 경계 고리를 따라 거리가 줄어드는 쪽으로 걷는다(앞 원호 날 요소에서 찾은 자리부터)
    const p = at(K, (Math.max(a, 0) + Math.min(b, 1)) / 2);
    let w = carry[k]! >= 0 ? carry[k]! : sa;
    let fw = elDist(loop[w]!, p[0], p[1]);
    cnt.work++;
    for (let step = 0; step < m; step++) {
      const w1 = (w + 1) % m;
      const w0 = (w + m - 1) % m;
      const f1 = elDist(loop[w1]!, p[0], p[1]);
      const f0 = elDist(loop[w0]!, p[0], p[1]);
      cnt.work += 2;
      if (f1 < fw && f1 <= f0) {
        w = w1;
        fw = f1;
      } else if (f0 < fw) {
        w = w0;
        fw = f0;
      } else break;
    }
    carry[k] = w;
    if (fw < lim) {
      const before = ivs.length;
      witness(w);
      witness(w - 1);
      witness(w + 1);
      if (ivs.length > before) arms();
    }
  }
  return [a, b];
}

/** 앞 요소 끝 접선 tA에서 뒤 요소 시작 접선 tB로 오른쪽으로 꺾이는지(되돌아 꺾임 포함 — 가공 면이 왼쪽이면 오목한 꼭짓점) */
function rightTurn(tA: [number, number], tB: [number, number]): boolean {
  const cr = tA[0] * tB[1] - tA[1] * tB[0];
  const dot = tA[0] * tB[0] + tA[1] * tB[1];
  return cr < -1e-12 || (Math.abs(cr) <= 1e-12 && dot < 0);
}

/** 꼭짓점 (pu, pv) 둘레 시계 호 (au, av) → (bu, bv) — 오목한 꼭짓점의 모서리 잇기 */
function cornerArc(pu: number, pv: number, au: number, av: number, bu: number, bv: number): SlEl {
  let sw = Math.atan2(bv - pv, bu - pu) - Math.atan2(av - pv, au - pu);
  while (sw >= 0) sw -= TAU;
  while (sw < -TAU) sw += TAU;
  return { arc: true, su: au, sv: av, eu: bu, ev: bv, cu: pu, cv: pv, sweep: sw };
}

/**
 * 51차: 점으로 준 원호(가공 면 쪽으로 볼록하고 반지름이 d 이하라 떨어진 곡선이 없는 것)를 건너뛰어, 경계 요소 i를 옮긴 A의 끝에서
 * 경계 요소 j를 옮긴 B의 시작으로 잇는다. 건너뛴 자리의 꼭짓점(원호 양 끝) 가운데 오른쪽으로 꺾이는 곳이 있으면 그 꼭짓점 둘레 반지름 d 호를 넣고 true.
 * 50차까지는 늘 A 끝 → B 시작을 곧게 이어 이 호가 빠졌고, 그 호가 떨어진 곡선의 일부인 단계(들쭉날쭉한 다각형의 CR 원호 둘레 등)에서
 * 고리가 끊겨 그 안쪽을 깎지 않은 채 남겼다. 원호 안쪽의 점은 d가 반지름보다 크면 가장 가까운 경계 점이 될 수 없어(곡률 중심을 지나 거리가
 * 원호를 따라 가장 커지는 자리) 떨어진 곡선은 원호 양 끝 둘레 호와 이웃 요소에서만 나온다.
 * 나머지는 곧게 잇는다 — 왼쪽으로 꺾이는 꼭짓점의 두 법선 자리 사이(그 꼭짓점 둘레 반지름 d 원의 현)와 없어진 원호 양 끝의 법선 자리 사이
 * (반지름 d − r로 뒤집힌 원호의 현 — 원호 위 같은 각의 점에서 d보다 가까움)라 늘 버려진다.
 * 오른쪽 꺾임이 없으면 false(예전처럼 A 끝 → B 시작을 곧게 — 결과 그대로)
 */
function bridge(loop: readonly SlEl[], i: number, j: number, A: SlEl, B: SlEl, d: number, eps: number, put: (e: SlEl, a: number, b: number) => void): boolean {
  const n = loop.length;
  let any = false;
  for (let a = i; a !== j && !any; a = (a + 1) % n) any = rightTurn(tanAt(loop[a]!, 1), tanAt(loop[(a + 1) % n]!, 0));
  if (!any) return false;
  let cu = A.eu;
  let cv = A.ev;
  for (let a = i; ; a = (a + 1) % n) {
    const b = (a + 1) % n;
    const V = loop[a]!;
    const E = loop[b]!;
    const t0 = tanAt(E, 0);
    // 꼭짓점에서 E 시작 접선의 왼쪽(가공 면 쪽) 법선으로 d — E가 B의 출처면 B의 시작 그대로
    const pu = b === j ? B.su : V.eu - t0[1] * d;
    const pv = b === j ? B.sv : V.ev + t0[0] * d;
    if (rightTurn(tanAt(V, 1), t0)) put(cornerArc(V.eu, V.ev, cu, cv, pu, pv), a, b);
    else if (Math.hypot(pu - cu, pv - cv) > eps * 10) put(g7xLine(cu, cv, pu, pv), a, b);
    if (b === j) return true;
    // E는 없어진 원호: 끝 자리의 법선 쪽 d까지
    const t1 = tanAt(E, 1);
    cu = E.eu - t1[1] * d;
    cv = E.ev + t1[0] * d;
    if (Math.hypot(cu - pu, cv - pv) > eps * 10) put(g7xLine(pu, pv, cu, cv), b, b);
  }
}

/**
 * 51차: 남는 조각 가운데 끝에서 이어지는 조각이 없거나(끝이 다른 조각의 시작과 tol 안에서 만나지 않음) 시작으로 들어오는 조각이 없는 것을
 * 되풀이해 뺀다 — 닫힌 고리에 들 수 없는 가지. 볼록한 꼭짓점의 아주 얇은 제비꼬리(날 곡선이 스스로 엇갈려 생긴 작은 고리 — 거의 없어진 원호 끝,
 * 요소가 아주 잘고 꼭짓점이 반올림된 원꼴 윤곽)는 경계까지 거리가 d보다 판정 여유(tolD) 안에서만 가까우면 그 조각이 남고, 갈림길에서 그 가지로
 * 들어간 사슬이 끊겨 고리 전체를 잃었다(48~50차). 51차에 여유를 좁혀 거의 남지 않지만, 남으면 이것이 받는다. 칸·허용은 잇기(chain)와 같다
 */
function prune(ps: readonly SlEl[], tol: number): SlEl[] {
  const n = ps.length;
  const cell = Math.max(tol * 4, 1e-12);
  const grid = new Map<number, Map<number, number[]>>();
  ps.forEach((p, i) => {
    const ku = Math.round(p.su / cell);
    const kv = Math.round(p.sv / cell);
    let col = grid.get(ku);
    if (!col) grid.set(ku, (col = new Map()));
    const g = col.get(kv);
    if (g) g.push(i);
    else col.set(kv, [i]);
  });
  // 끝 → 이어지는 조각(succ), 그 거꾸로(pred)
  const succ: number[][] = [];
  const pred: number[][] = ps.map(() => []);
  for (let i = 0; i < n; i++) {
    const p = ps[i]!;
    const cu = Math.round(p.eu / cell);
    const cv = Math.round(p.ev / cell);
    const s: number[] = [];
    for (let du = -1; du <= 1; du++)
      for (let dv = -1; dv <= 1; dv++)
        for (const j of grid.get(cu + du)?.get(cv + dv) ?? []) {
          const q = ps[j]!;
          if (Math.hypot(q.su - p.eu, q.sv - p.ev) > tol) continue;
          s.push(j);
          pred[j]!.push(i);
        }
    succ.push(s);
  }
  const nOut = Int32Array.from(succ, (s) => s.length);
  const nIn = Int32Array.from(pred, (s) => s.length);
  const dead = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++)
    if (!nOut[i] || !nIn[i]) {
      dead[i] = 1;
      stack.push(i);
    }
  const drop = (cnt: Int32Array, j: number): void => {
    if (dead[j]) return;
    cnt[j] = cnt[j]! - 1;
    if (cnt[j]! > 0) return;
    dead[j] = 1;
    stack.push(j);
  };
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of succ[i]!) drop(nIn, j);
    for (const j of pred[i]!) drop(nOut, j);
  }
  return ps.filter((_, i) => !dead[i]);
}

/**
 * slOffset과 같되 셈한 일(R.work)이 workLimit을 넘으면 그만두고 null(49차 — 고리 셈 한도).
 * plain이면 50차 버려질 팔(deadArms)을 셈하지 않고 모든 조각을 묻는다(같은 답 — 시험에서 견줄 때)
 */
function offsetUpTo(R: SlRegion, d: number, workLimit: number, plain = false): SlLoop[] | null {
  R.unclosed = 0;
  if (!(d > R.eps)) return R.loops.map((l) => l.map((e) => ({ ...e })));
  const raw: RawEl[] = [];
  // 50차: 날 요소마다 출처 경계 요소(옮긴 요소 i면 [i, -1], 모서리 잇기 i → j면 [i, j])
  const srcA: number[] = [];
  const srcB: number[] = [];
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
    // 날 요소 하나와 그 출처
    const put = (e: SlEl, a: number, b: number): void => {
      out.push(e);
      srcA.push(a);
      srcB.push(b);
    };
    for (let i = 0; i < n; i++) {
      const A = moved[i];
      if (!A) continue;
      put(A, i, -1);
      // 다음 옮긴 요소(점으로 준 원호는 건너뛴다)
      let j = (i + 1) % n;
      let skipped = false;
      while (!moved[j] && j !== i) {
        j = (j + 1) % n;
        skipped = true;
      }
      const B = moved[j];
      if (!B) continue;
      // 51차: 건너뛴 자리에 오른쪽으로 꺾이는 꼭짓점이 있으면 그 둘레 호를 넣어 잇는다
      if (skipped && bridge(loop, i, j, A, B, d, R.eps, put)) continue;
      const gap = Math.hypot(B.su - A.eu, B.sv - A.ev);
      if (gap <= R.eps * 10) continue;
      const V = loop[i]!;
      // 오른쪽으로 꺾임(가공 면의 오목한 꼭짓점): 꼭짓점 둘레 반지름 d 호(시계)
      if (!skipped && rightTurn(tanAt(loop[i]!, 1), tanAt(loop[(i + 1) % n]!, 0))) put(cornerArc(V.eu, V.ev, A.eu, A.ev, B.su, B.sv), i, j);
      else put(g7xLine(A.eu, A.ev, B.su, B.sv), i, j);
    }
    out.forEach((e, i) => raw.push({ e, loop: k, idx: i, n: out.length }));
  });
  if (!raw.length) return [];
  const cnt = counter(R);
  // 남는 조각의 판정 여유: 경계까지 거리가 d − tolD보다 가까우면 버린다. 51차: 10⁻⁷에서 10⁻⁹(R.eps 꼴)로 — 볼록한 꼭짓점의 날 곡선이 스스로
  // 엇갈린 얇은 제비꼬리(꺾임 θ에서 깊이 ≈ d·θ²/8 — 요소 천 개 넘는 원꼴 다각형·반올림된 꼭짓점·거의 곧은 원호 끝)가 여유 안이라 남아,
  // 사슬이 그 가지로 들어가 고리가 끊기거나(잇지 못함) 고리를 통째로 잃었다(1000각형 d 0.5는 길이 0.006 삼각형만). 바른 조각의 거리는
  // 옮긴 요소·꼭짓점 호 위 점이라 반올림(좌표의 10⁻¹⁴쯤)만큼만 d에서 벗어난다
  const tolD = Math.max(R.scale, d) * 1e-9;
  // 50차: 확실히 버려질 팔(μ는 반올림을 덮는 여유 — 좌표 크기·윤곽 크기의 10억분의 1)
  let arms: SlArms | undefined;
  if (!plain) {
    let big = 0;
    for (const l of R.loops) for (const e of l) big = Math.max(big, Math.abs(e.su), Math.abs(e.sv), Math.abs(e.eu), Math.abs(e.ev));
    arms = deadArms(R, raw, Int32Array.from(srcA), Int32Array.from(srcB), d - tolD, Math.max(R.scale, d, big) * 1e-9, cnt);
  }
  const pieces = splitAll(raw, R.eps * 10, cnt, arms);
  const keep: SlEl[] = [];
  for (const p of pieces) {
    if (cnt.work > workLimit) return null;
    const m = at(p, 0.5);
    if (!near(R, m[0], m[1], d - tolD) && inside(R, m[0], m[1])) keep.push(p);
  }
  const tol = R.eps * 1e3;
  let c = chain(keep, tol);
  // 51차: 잇지 못한 사슬이 있으면 끊긴 가지를 빼고 다시 잇는다(모두 닫혔으면 그대로 — 결과 같음)
  if (c.open) c = chain(prune(keep, tol), tol);
  const loops = c.loops.filter((l) => l.reduce((s, e) => s + slElLen(e), 0) > R.eps * 100);
  if (!loops.length && keep.length) {
    let len = 0;
    for (const p of keep) len += slElLen(p);
    if (len > R.scale * 1e-3) R.unclosed = len;
  }
  return loops;
}

/** 요소 위 비율 t(0 시작 ~ 1 끝)의 점(50차 — 사이클 275 홈 가운데 선) */
export function slAt(e: SlEl, t: number): [number, number] {
  return at(e, t);
}

/** 고리 위에서 점에 가장 가까운 자리(요소 번호·비율·거리) */
function nearestOn(loop: readonly SlEl[], u: number, v: number): { i: number; t: number; d: number } {
  return slNearestIn(loop, u, v, 0, loop.length);
}

/** 요소 열의 [from, to) 안에서 점에 가장 가까운 자리(요소 번호·비율·거리) — 50차 사이클 276이 공구 축 좌표를 옮길 때 앞 자리 둘레만 먼저 본다 */
export function slNearestIn(loop: readonly SlEl[], u: number, v: number, from: number, to: number): { i: number; t: number; d: number } {
  let best = { i: 0, t: 0, d: Infinity };
  for (let i = Math.max(0, from); i < Math.min(loop.length, to); i++) {
    const e = loop[i]!;
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
  }
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
  if (R.ou === undefined) return segmentFree(R, levels0, d, pu, pv, qu, qv);
  // 53차: 기준점을 뺀 자리로(고리는 slLevels가 프로그램 자리로 낸 것)
  const ou = R.ou;
  const ov = R.ov!;
  return segmentFree(R, levels0.map((l) => l.map((e) => moveEl(e, -ou, -ov))), d, pu - ou, pv - ov, qu - ou, qv - ov);
}

/** slSegmentFree의 속(R의 자리) */
function segmentFree(R: SlRegion, levels0: readonly SlLoop[], d: number, pu: number, pv: number, qu: number, qv: number): boolean {
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
    if (!inside(R, u, v) || near(R, u, v, d - tolD)) return false;
  }
  return true;
}

/**
 * 거친 깎기 고리들: levels[k] = 경계에서 d0 + k·step 떨어진 곡선(바깥 → 안). 고리가 없어질 때까지, maxLevels(capped 'rings')·
 * work(요소 수 합)·evals(49차 — 이번에 셈한 일 R.work, 요소 거리·반직선·교점 셈 수)까지(capped 'work' — 넘는 단계는 셈하지 않는다).
 * 50차: 남는 조각은 있는데 닫힌 고리로 잇지 못해 그 단계가 비면 그 앞까지(capped 'open' — 요소가 아주 잘고 꼭짓점이 반올림된 원꼴 윤곽의
 * 가운데 가까운 고리처럼 겹친 조각이 엉켜 끊긴 것. 공구가 남은 곳을 다 덮어 빈 것과 갈라 알린다)
 */
export function slLevels(
  R: SlRegion,
  d0: number,
  step: number,
  maxLevels: number,
  work = 2_000_000,
  evals = Infinity,
): { levels: SlLoop[][]; capped: false | 'rings' | 'work' | 'open' } {
  const L = levelsOf(R, d0, step, maxLevels, work, evals);
  // 53차: 기준점을 뺀 자리로 셈했으면 프로그램 자리로
  if (R.ou !== undefined) L.levels = L.levels.map((ls) => toWorld(R, ls));
  return L;
}

/** slLevels의 속(R의 자리) */
function levelsOf(R: SlRegion, d0: number, step: number, maxLevels: number, work: number, evals: number): { levels: SlLoop[][]; capped: false | 'rings' | 'work' | 'open' } {
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
    // 50차: 남은 조각을 닫힌 고리로 잇지 못해 빈 것(capped 'open')과 공구가 남은 곳을 다 덮어 빈 것을 가른다
    if (!loops.length) return { levels, capped: R.unclosed ? 'open' : false };
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

/**
 * 50차 남은 부분만 깎기(사이클 25·276의 Q18·Q446~Q448 — 설명서 9.10절 295쪽·9.12절 305~306쪽): 앞서 다른 공구(중심이 윤곽에서 d1 = 반지름 + Q3)로
 * 같은 윤곽을 깎았을 때 남은 두께가 accept(Q446)보다 두꺼운 곳의 공구 중심 경로(runs)만 돌려준다.
 * 윤곽 점 P의 남은 두께 = P에서 앞 공구 중심 경로(slTrain(els, d1, side))까지 거리 − d1 — 앞 공구가 윤곽을 따라 깎은 곳은 0,
 * 안쪽 모서리·좁은 홈처럼 들어가지 못한 곳은 그만큼(앞 공구가 아무 데도 못 들어가면 모두). 경로의 점마다 가장 가까운 윤곽 점의 두께로 가르고
 * (요소마다 나눠 살피고 경계는 두 갈래 찾기), 구역마다 앞뒤로 경로를 따라 extend(Q448)만큼 늘이며, 사이가 connect(Q447) 이하인 구역은 이어
 * 들지 않고 깎는다. 셈이 너무 많으면 null(부르는 쪽이 다 그림)
 */
export function slResidual(els: readonly SlEl[], runs: readonly SlLoop[], side: number, d1: number, accept: number, connect: number, extend: number): SlLoop[] | null {
  const coarse = slTrain(els, d1, side).runs.flat();
  if (!coarse.length) return runs.map((l) => l.map((e) => ({ ...e })));
  const total = runs.reduce((s, l) => s + l.reduce((a, e) => a + slElLen(e), 0), 0);
  if (!(total > 0)) return [];
  const step = total / 2000;
  let work = 0;
  for (const l of runs) for (const e of l) work += Math.min(64, Math.max(4, Math.ceil(slElLen(e) / step))) * (coarse.length + els.length);
  if (work > 30_000_000) return null;
  /** 경로 점 (u, v)의 남은 두께 − accept */
  const f = (u: number, v: number): number => {
    const n = slNearestIn(els, u, v, 0, els.length);
    const p = at(els[n.i]!, n.t);
    let d = Infinity;
    for (const c of coarse) d = Math.min(d, elDist(c, p[0], p[1]));
    return d - d1 - accept;
  };
  const out: SlLoop[] = [];
  for (const run of runs) {
    const lens = run.map(slElLen);
    const L = lens.reduce((a, b) => a + b, 0);
    // 남은 구역(경로 길이 [a, b])
    const zones: [number, number][] = [];
    let s0 = 0;
    let open: number | null = null;
    // 지금 남은 구역 안인지(요소가 바뀌어도 이어 감 — 맞닿은 끝은 같은 점)
    let state = run.length ? f(...at(run[0]!, 0)) > 0 : false;
    if (state) open = 0;
    run.forEach((e, i) => {
      const len = lens[i]!;
      const K = Math.min(64, Math.max(4, Math.ceil(len / step)));
      let tPrev = 0;
      let inPrev = state;
      for (let k = 1; k <= K; k++) {
        const t = k / K;
        const inNow = f(...at(e, t)) > 0;
        if (inNow !== inPrev) {
          // 경계: 두 갈래 찾기
          let lo = tPrev;
          let hi = t;
          for (let it = 0; it < 12; it++) {
            const m = (lo + hi) / 2;
            if (f(...at(e, m)) > 0 === inPrev) lo = m;
            else hi = m;
          }
          const s = s0 + ((lo + hi) / 2) * len;
          if (inNow) open = s;
          else if (open !== null) {
            zones.push([open, s]);
            open = null;
          }
        }
        tPrev = t;
        inPrev = inNow;
      }
      state = inPrev;
      s0 += len;
    });
    if (open !== null) zones.push([open, L]);
    // 늘이고 잇기
    const merged: [number, number][] = [];
    for (const [a, b] of zones) {
      const z: [number, number] = [Math.max(0, a - extend), Math.min(L, b + extend)];
      const last = merged[merged.length - 1];
      if (last && z[0] - last[1] <= connect) last[1] = Math.max(last[1], z[1]);
      else merged.push(z);
    }
    // 구역마다 경로 조각
    for (const [a, b] of merged) {
      const piece: SlLoop = [];
      let c0 = 0;
      run.forEach((e, i) => {
        const len = lens[i]!;
        const c1 = c0 + len;
        if (c1 > a && c0 < b && len > 0) {
          const t0 = Math.max(0, (a - c0) / len);
          const t1 = Math.min(1, (b - c0) / len);
          if ((t1 - t0) * len > 1e-9) piece.push(t0 === 0 && t1 === 1 ? { ...e } : part(e, t0, t1));
        }
        c0 = c1;
      });
      if (piece.length) out.push(piece);
    }
  }
  return out;
}
