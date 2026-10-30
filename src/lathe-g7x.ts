/**
 * LinuxCNC 선반 G70(다듬질)·G71/G72(거친 깎기 — .1·.2 포함)의 윤곽 기하. 순수 함수이고 XZ 단면 2차원 좌표를 쓴다
 * (u = Z, v = X 반지름, 원호 중심각은 u → v 반시계가 +, 곧 G18의 G3 방향). gcode.ts가 o-코드 서브루틴 Q를 읽어 요소로 넘긴다.
 *
 * 근거는 LinuxCNC 설명서 G-code 절 "G70 Lathe finishing cycle"·"G71 G72 Lathe roughing cycles"다.
 * - 윤곽: G0(G1로 봄)·G1·G2·G3. 이동마다 A(그 끝에 넣을 둥글리기 반지름)·C(같은 크기 둥글리기와 두 끝이 같은 모따기 직선)
 * - G71은 Z, G72는 X가 한 방향으로만 바뀌어야 한다(G70은 둘 가운데 하나). 깎는 방향은 윤곽을 따라간 방향
 * - D·E 거리는 윤곽에서 시작점 쪽으로 잰다(+ = 시작점 쪽) — 같은 거리만큼 떨어진 곡선(직선은 평행, 원호는 반지름 ± d,
 *   볼록한 모서리는 반지름 d인 호로 잇고 오목한 모서리는 두 요소의 교점까지 자른다)
 * - G7x.1은 오목한 곳(포켓)을 깎지 않고, G7x.2는 첫 포켓부터 G7x.1이 멈춘 자리를 이어 깎는다. 숫자 없는 G7x는 둘을 한 번에
 * 설명서가 정하지 않은 그림(여기서 정함): 층 끝에서 R만큼 45°로 물러나기, 포켓은 바로 위 층의 깎은 구간을 따라 위에서 들어가기,
 * G7x.1이 멈추는 자리 = 윤곽이 시작점 쪽으로 오르다 처음 다시 내려가는 꼭짓점. 다른 NC 해석기 코드를 보지 않고 일반 기하로 짰다.
 */
import { cornerCut, cornerElem, cornerIntersections, type CornerElem } from './corner';

/** 윤곽 요소: 직선 또는 원호(중심 cu·cv, 중심각 sweep). 직선이면 cu·cv·sweep은 0 */
export interface G7xEl {
  arc: boolean;
  su: number;
  sv: number;
  eu: number;
  ev: number;
  cu: number;
  cv: number;
  sweep: number;
}

/** 요소 at의 끝(다음 요소와 만나는 모서리)에 넣을 둥글리기(A)·모따기(C)와 그 크기 */
export interface G7xCorner {
  at: number;
  kind: 'round' | 'chamfer';
  size: number;
}

/** 거친 깎기 이동 하나(rapid = 급속, 아니면 이송) */
export interface G7xMove {
  rapid: boolean;
  u: number;
  v: number;
}

const TAU = Math.PI * 2;

export function g7xLine(su: number, sv: number, eu: number, ev: number): G7xEl {
  return { arc: false, su, sv, eu, ev, cu: 0, cv: 0, sweep: 0 };
}

const elLen = (e: G7xEl): number => (e.arc ? Math.hypot(e.su - e.cu, e.sv - e.cv) * Math.abs(e.sweep) : Math.hypot(e.eu - e.su, e.ev - e.sv));

const toCorner = (e: G7xEl): CornerElem | null => cornerElem(e.su, e.sv, e.eu, e.ev, e.arc ? { cx: e.cu, cy: e.cv, sweep: e.sweep } : null);

/** 원호 e의 시작에서 점 (qu, qv)까지 진행 방향으로 돈 각(0 ~ 2π) */
function along(e: G7xEl, qu: number, qv: number): number {
  let a = (Math.atan2(qv - e.cv, qu - e.cu) - Math.atan2(e.sv - e.cv, e.su - e.cu)) * Math.sign(e.sweep);
  while (a < -1e-12) a += TAU;
  while (a >= TAU - 1e-12) a -= TAU;
  return Math.max(0, a);
}

/** 원호 e를 시작에서 진행 방향으로 ang만큼 돈 점 */
function arcAt(e: G7xEl, ang: number): [number, number] {
  const r = Math.hypot(e.su - e.cu, e.sv - e.cv);
  const t = Math.atan2(e.sv - e.cv, e.su - e.cu) + Math.sign(e.sweep) * ang;
  return [e.cu + r * Math.cos(t), e.cv + r * Math.sin(t)];
}

/** 요소 끝(end) 또는 시작의 단위 접선 */
function tangent(e: G7xEl, end: boolean): [number, number] {
  if (!e.arc) {
    const l = Math.hypot(e.eu - e.su, e.ev - e.sv) || 1;
    return [(e.eu - e.su) / l, (e.ev - e.sv) / l];
  }
  const pu = (end ? e.eu : e.su) - e.cu;
  const pv = (end ? e.ev : e.sv) - e.cv;
  const r = Math.hypot(pu, pv) || 1;
  const s = Math.sign(e.sweep);
  return [(-pv / r) * s, (pu / r) * s];
}

/**
 * 모서리 둥글리기·모따기(A·C)를 넣는다. 둥글리기는 두 요소에 접하는 호, 모따기는 같은 크기 둥글리기의 두 접점을 잇는 직선.
 * 넣지 못한 모서리(값이 앞뒤 요소보다 큼·되돌아감·다음 요소 없음) 수를 failed로 돌려준다(그 모서리는 그대로)
 */
export function g7xCorners(els: readonly G7xEl[], corners: readonly G7xCorner[]): { els: G7xEl[]; failed: number } {
  const out = els.map((e) => ({ ...e }));
  const ins = new Map<number, G7xEl>();
  let failed = 0;
  for (const c of [...corners].sort((a, b) => a.at - b.at)) {
    const A = out[c.at];
    const B = out[c.at + 1];
    const ca = A && toCorner(A);
    const cb = B && toCorner(B);
    if (!A || !B || !ca || !cb || !(c.size > 0) || ins.has(c.at)) {
      failed++;
      continue;
    }
    const r = cornerCut(ca, cb, A.eu, A.ev, 'round', c.size);
    if (!r.ok) {
      if (r.reason !== 'straight') failed++;
      continue;
    }
    if (A.arc) A.sweep = Math.sign(A.sweep) * r.angA;
    A.eu = r.t1[0];
    A.ev = r.t1[1];
    if (B.arc) B.sweep = Math.sign(B.sweep) * (Math.abs(B.sweep) - r.angB);
    B.su = r.t2[0];
    B.sv = r.t2[1];
    const f = r.fillet;
    ins.set(c.at, c.kind === 'round' && f ? { arc: true, su: r.t1[0], sv: r.t1[1], eu: r.t2[0], ev: r.t2[1], cu: f.cx, cv: f.cy, sweep: f.sweep } : g7xLine(r.t1[0], r.t1[1], r.t2[0], r.t2[1]));
  }
  const res: G7xEl[] = [];
  out.forEach((e, i) => {
    if (elLen(e) > 1e-9) res.push(e);
    const x = ins.get(i);
    if (x && elLen(x) > 1e-9) res.push(x);
  });
  return { els: res, failed };
}

/**
 * 윤곽이 축 m(0 = u·Z, 1 = v·X)으로 한 방향으로만 바뀌는지. 바뀌는 방향(±1)을, 오고 가거나 그 축으로 움직이지 않으면 0을 돌려준다.
 * 원호는 그 축의 끝값(u는 중심 각 0·π, v는 ±π/2)에서 나눠 본다. tol 안의 움직임은 보지 않는다
 */
export function g7xMonotonic(els: readonly G7xEl[], m: 0 | 1, tol: number): number {
  let sg = 0;
  const take = (d: number): boolean => {
    if (Math.abs(d) <= tol) return true;
    const s = Math.sign(d);
    if (sg && s !== sg) return false;
    sg = s;
    return true;
  };
  const val = (p: [number, number]): number => p[m];
  for (const e of els) {
    if (!e.arc) {
      if (!take(m === 0 ? e.eu - e.su : e.ev - e.sv)) return 0;
      continue;
    }
    const full = Math.abs(e.sweep);
    const t0 = Math.atan2(e.sv - e.cv, e.su - e.cu);
    const cuts: number[] = [];
    for (const ext of m === 0 ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2]) {
      let a = (ext - t0) * Math.sign(e.sweep);
      while (a < 0) a += TAU;
      while (a >= TAU) a -= TAU;
      for (; a < full; a += TAU) if (a > 1e-9 && a < full - 1e-9) cuts.push(a);
    }
    cuts.sort((a, b) => a - b);
    let prev: [number, number] = [e.su, e.sv];
    for (const a of [...cuts, full]) {
      const p = a === full ? ([e.eu, e.ev] as [number, number]) : arcAt(e, a);
      if (!take(val(p) - val(prev))) return 0;
      prev = p;
    }
  }
  return sg;
}

/** 요소를 점열(u, v 짝)로. 원호는 maxAngle보다 작은 각으로 나눈다. el·frac = 점마다 그 점이 있는 요소와 요소 안 비율(첫 점은 -1·0) */
export function g7xPolyline(els: readonly G7xEl[], maxAngle: number): { pts: number[]; el: number[]; frac: number[] } {
  const pts: number[] = [];
  const el: number[] = [];
  const frac: number[] = [];
  if (!els.length) return { pts, el, frac };
  pts.push(els[0]!.su, els[0]!.sv);
  el.push(-1);
  frac.push(0);
  els.forEach((e, i) => {
    if (!e.arc) {
      pts.push(e.eu, e.ev);
      el.push(i);
      frac.push(1);
      return;
    }
    const n = Math.max(1, Math.ceil(Math.abs(e.sweep) / maxAngle - 1e-9));
    for (let k = 1; k <= n; k++) {
      const p = k === n ? [e.eu, e.ev] : arcAt(e, (Math.abs(e.sweep) * k) / n);
      pts.push(p[0]!, p[1]!);
      el.push(i);
      frac.push(k / n);
    }
  });
  return { pts, el, frac };
}

/**
 * 시작점 S(u, v)가 윤곽의 어느 쪽인지: 윤곽이 한 방향으로 가는 축 m에 수직인 축 s로 잰 (S − 윤곽)의 넓이 부호(side, 0이면 +1).
 * k = 시작점 쪽 법선을 왼쪽 법선(진행 방향을 반시계로 90° 돌림)의 몇 배로 볼지(±1)
 */
export function g7xSide(els: readonly G7xEl[], S: readonly [number, number], m: 0 | 1): { side: number; k: number } {
  const s = 1 - m;
  const { pts } = g7xPolyline(els, Math.PI / 36);
  let acc = 0;
  for (let i = 0; i + 1 < pts.length / 2; i++) acc += (S[s]! - (pts[i * 2 + s]! + pts[(i + 1) * 2 + s]!) / 2) * Math.abs(pts[(i + 1) * 2 + m]! - pts[i * 2 + m]!);
  const side = Math.sign(acc) || 1;
  const sg = Math.sign(pts[pts.length - 2 + m]! - pts[m]!) || 1;
  return { side, k: side * sg * (m === 0 ? 1 : -1) };
}

/** 점이 요소 위(시작 ~ 끝)인지와 시작에서 그 점까지(직선은 길이, 원호는 각) */
function onEl(e: G7xEl, q: [number, number]): { ok: boolean; at: number } {
  if (!e.arc) {
    const l = Math.hypot(e.eu - e.su, e.ev - e.sv);
    const t = l > 0 ? ((q[0] - e.su) * (e.eu - e.su) + (q[1] - e.sv) * (e.ev - e.sv)) / l : 0;
    const eps = 1e-9 * Math.max(1, l);
    return { ok: t >= -eps && t <= l + eps, at: t };
  }
  const a = along(e, q[0], q[1]);
  return { ok: a <= Math.abs(e.sweep) + 1e-9, at: a };
}

/**
 * 윤곽에서 시작점 쪽(k — g7xSide)으로 거리 d만큼 떨어진 곡선. 직선은 평행, 원호는 같은 중심에 반지름 ± d(점으로 줄면 뺀다).
 * 볼록한 모서리(옮긴 두 요소 사이가 벌어짐)는 원래 모서리를 중심으로 반지름 |d|인 호로 잇고, 오목한 모서리는 교점까지 자른다
 * (교점이 요소 밖이면 두 끝을 직선으로 잇는다)
 */
export function g7xOffset(els: readonly G7xEl[], d: number, k: number): G7xEl[] {
  if (Math.abs(d) < 1e-12) return els.map((e) => ({ ...e }));
  const kd = k * d;
  const moved: { e: G7xEl; at: number }[] = [];
  els.forEach((e, i) => {
    if (!e.arc) {
      const l = Math.hypot(e.eu - e.su, e.ev - e.sv);
      if (l < 1e-12) return;
      const nu = (-(e.ev - e.sv) / l) * kd;
      const nv = ((e.eu - e.su) / l) * kd;
      moved.push({ e: { ...e, su: e.su + nu, sv: e.sv + nv, eu: e.eu + nu, ev: e.ev + nv }, at: i });
      return;
    }
    const r = Math.hypot(e.su - e.cu, e.sv - e.cv);
    const r2 = r - Math.sign(e.sweep) * kd;
    if (!(r2 > 1e-9) || r < 1e-12) return;
    const f = r2 / r;
    moved.push({ e: { ...e, su: e.cu + (e.su - e.cu) * f, sv: e.cv + (e.sv - e.cv) * f, eu: e.cu + (e.eu - e.cu) * f, ev: e.cv + (e.ev - e.cv) * f }, at: i });
  });
  const out: G7xEl[] = [];
  for (let j = 0; j < moved.length; j++) {
    const B = moved[j]!.e;
    const A = out[out.length - 1];
    if (!A) {
      out.push(B);
      continue;
    }
    // 원래 모서리(앞 요소의 끝)
    const P = els[moved[j - 1]!.at]!;
    const pu = P.eu;
    const pv = P.ev;
    const gap = Math.hypot(B.su - A.eu, B.sv - A.ev);
    if (gap < 1e-9 * Math.max(1, Math.abs(d))) {
      B.su = A.eu;
      B.sv = A.ev;
      out.push(B);
      continue;
    }
    const tA = tangent(A, true);
    const tB = tangent(B, false);
    const cr = tA[0] * tB[1] - tA[1] * tB[0];
    const dot = tA[0] * tB[0] + tA[1] * tB[1];
    if (Math.abs(cr) > 1e-9 && cr * kd < 0) {
      // 볼록: 모서리를 도는 호
      let sw = Math.atan2(B.sv - pv, B.su - pu) - Math.atan2(A.ev - pv, A.eu - pu);
      if (cr > 0) while (sw <= 0) sw += TAU;
      else while (sw >= 0) sw -= TAU;
      out.push({ arc: true, su: A.eu, sv: A.ev, eu: B.su, ev: B.sv, cu: pu, cv: pv, sweep: sw });
      out.push(B);
      continue;
    }
    if (Math.abs(cr) > 1e-9 || dot < 0) {
      // 오목: 교점까지 자른다
      const ca = toCorner(A);
      const cb = toCorner(B);
      let best: [number, number] | null = null;
      let bd = Infinity;
      if (ca && cb)
        for (const q of cornerIntersections(ca, cb)) {
          const dd = Math.hypot(q[0] - pu, q[1] - pv);
          if (dd < bd && onEl(A, q).ok && onEl(B, q).ok) {
            bd = dd;
            best = q;
          }
        }
      if (best) {
        if (A.arc) A.sweep = Math.sign(A.sweep) * onEl(A, best).at;
        A.eu = best[0];
        A.ev = best[1];
        if (B.arc) B.sweep = Math.sign(B.sweep) * (Math.abs(B.sweep) - onEl(B, best).at);
        B.su = best[0];
        B.sv = best[1];
        if (elLen(A) < 1e-9) out.pop();
        if (elLen(B) > 1e-9) out.push(B);
        continue;
      }
    }
    out.push(g7xLine(A.eu, A.ev, B.su, B.sv));
    out.push(B);
  }
  return out;
}

/** 요소 el을 비율 frac에서 둘로 나눈다(앞 요소들 + 앞 조각, 뒤 조각 + 뒤 요소들) */
export function g7xSplit(els: readonly G7xEl[], el: number, frac: number): [G7xEl[], G7xEl[]] {
  const a = els.slice(0, el).map((e) => ({ ...e }));
  const b = els.slice(el + 1).map((e) => ({ ...e }));
  const e = els[el];
  if (!e) return [a, b];
  let p: [number, number];
  if (e.arc) p = arcAt(e, Math.abs(e.sweep) * frac);
  else p = [e.su + (e.eu - e.su) * frac, e.sv + (e.ev - e.sv) * frac];
  const head: G7xEl = { ...e, eu: p[0], ev: p[1], sweep: e.sweep * frac };
  const tail: G7xEl = { ...e, su: p[0], sv: p[1], sweep: e.sweep * (1 - frac) };
  if (elLen(head) > 1e-9) a.push(head);
  if (elLen(tail) > 1e-9) b.unshift(tail);
  return [a, b];
}

/**
 * G7x.1이 멈추는 자리: 점열이 단계 축 s에서 시작점 쪽(-dir)으로 오른 뒤 처음 다시 살 쪽(dir)으로 내려가기 시작하는 점의 번호(없으면 -1)
 */
export function g7xRidge(pts: readonly number[], s: 0 | 1, dir: number, tol: number): number {
  let rose = false;
  for (let i = 0; i + 1 < pts.length / 2; i++) {
    const d = (pts[(i + 1) * 2 + s]! - pts[i * 2 + s]!) * dir;
    if (d < -tol) rose = true;
    else if (d > tol && rose) return i;
  }
  return -1;
}

interface Run {
  /** 점열 매개변수(점 번호 + 비율)로 잰 시작·끝 */
  t0: number;
  t1: number;
  /** 깎는 축 좌표의 시작·끝 */
  a: number;
  b: number;
  open: boolean;
  level: number;
  kids: Run[];
}

/**
 * 거친 깎기 층. pts = 떨어진 윤곽의 점열, S = 시작점(u, v), s = 단계 축(G71은 1·X, G72는 0·Z), dir = 시작점에서 살 쪽으로 가는 단계 방향(±1),
 * I = 절입(> 0), R = 물러남, part = 0(전부)·1(.1 — 포켓 빼고)·2(.2 — 포켓만).
 * 층은 시작점에서 I씩, 윤곽의 가장 깊은 점 앞까지. 층마다 살이 있는 구간(윤곽이 그 층보다 깊은 곳)을 찾아,
 * 시작점 쪽으로 열린 구간(윤곽 시작에서 이어짐)은 시작 자리에서 급속으로 층에 들어가 구간 끝까지 이송하고 R만큼 45°로 물러나 시작 자리로 돌아온다.
 * 포켓 구간은 열린 구간을 다 깎은 뒤, 바로 위 층에서 그 구간을 품는 구간(깎은 곳)의 R 위를 따라 들어가 깎는다(깊이 우선).
 * 포켓을 깎았으면 시작점 단계로 올라가 시작 자리로 돌아온다
 */
export function g7xRough(
  pts: readonly number[],
  S: readonly [number, number],
  s: 0 | 1,
  dir: number,
  I: number,
  R: number,
  part: 0 | 1 | 2,
  maxLevels = 10000,
): { moves: G7xMove[]; pockets: boolean; levels: number } {
  const c = (1 - s) as 0 | 1;
  const n = pts.length / 2;
  const moves: G7xMove[] = [];
  if (n < 2 || !(I > 0)) return { moves, pockets: false, levels: 0 };
  let ext = 0;
  let deepest = -Infinity;
  for (let i = 0; i < n; i++) {
    deepest = Math.max(deepest, pts[i * 2 + s]! * dir);
    ext = Math.max(ext, Math.abs(pts[i * 2]!), Math.abs(pts[i * 2 + 1]!));
  }
  const tol = 1e-9 * Math.max(1, ext, Math.abs(S[0]), Math.abs(S[1]));
  const c0 = pts[c]!;
  const tdir = Math.sign(pts[(n - 1) * 2 + c]! - c0) || 1;
  const up = -dir;
  const at = (lev: number, cv: number): [number, number] => (s === 1 ? [cv, lev] : [lev, cv]);
  const go = (rapid: boolean, p: [number, number]): void => {
    moves.push({ rapid, u: p[0], v: p[1] });
  };
  const cAt = (t: number): number => {
    const i = Math.min(n - 2, Math.floor(t));
    const f = t - i;
    return pts[i * 2 + c]! + (pts[(i + 1) * 2 + c]! - pts[i * 2 + c]!) * f;
  };
  const levels: number[] = [];
  for (let k = 1; k <= maxLevels; k++) {
    const lev = S[s]! + dir * k * I;
    if (lev * dir >= deepest - tol) break;
    levels.push(lev);
  }
  // 층마다 살이 있는 구간
  const runs: Run[][] = levels.map((lev, li) => {
    const out: Run[] = [];
    const f = (i: number): number => (pts[i * 2 + s]! - lev) * dir;
    let t0 = -1;
    if (f(0) > tol) t0 = 0;
    for (let i = 0; i + 1 < n; i++) {
      const fa = f(i);
      const fb = f(i + 1);
      const ia = fa > tol;
      const ib = fb > tol;
      if (ia === ib) continue;
      const fr = fa !== fb ? Math.min(1, Math.max(0, fa / (fa - fb))) : 0;
      if (ib) t0 = i + fr;
      else if (t0 >= 0) {
        out.push(mkRun(t0, i + fr, li));
        t0 = -1;
      }
    }
    if (t0 >= 0) out.push(mkRun(t0, n - 1, li));
    return out;
  });
  function mkRun(t0: number, t1: number, level: number): Run {
    const a = cAt(t0);
    return { t0, t1, a, b: cAt(t1), open: Math.abs(a - c0) <= tol * 100, level, kids: [] };
  }
  // 열린 구간(.1)
  if (part !== 2)
    runs.forEach((list, li) => {
      const r = list[0];
      if (!r?.open) return;
      const lev = levels[li]!;
      go(true, at(lev, S[c]!));
      go(false, at(lev, r.b));
      go(false, at(lev + up * R, r.b - tdir * R));
      go(true, at(lev + up * R, S[c]!));
    });
  // 포켓 구간(.2): 바로 위 층에서 품는 구간 아래에 둔다
  const roots: Run[] = [];
  let pockets = false;
  runs.forEach((list, li) => {
    for (const r of list) {
      if (r.open) continue;
      pockets = true;
      const parent = li > 0 ? runs[li - 1]!.find((p) => p.t0 <= r.t0 + 1e-9 && r.t1 <= p.t1 + 1e-9) : undefined;
      if (!parent || parent.open) roots.push(r);
      else parent.kids.push(r);
    }
  });
  if (part !== 1 && roots.length) {
    let cur: { u: number; v: number } = moves.length ? moves[moves.length - 1]! : { u: S[0], v: S[1] };
    const goC = (rapid: boolean, p: [number, number]): void => {
      go(rapid, p);
      cur = { u: p[0], v: p[1] };
    };
    const visit = (r: Run): void => {
      const lev = levels[r.level]!;
      const cl = r.level === 0 ? S[s]! : levels[r.level - 1]! + up * R;
      const cc = s === 1 ? cur.u : cur.v;
      goC(true, at(cl, cc));
      goC(true, at(cl, r.a));
      goC(false, at(lev, r.a));
      goC(false, at(lev, r.b));
      goC(false, at(lev + up * R, r.b - tdir * R));
      for (const k of r.kids) visit(k);
    };
    roots.sort((x, y) => x.t0 - y.t0 || x.level - y.level);
    for (const r of roots) visit(r);
    goC(true, at(S[s]!, s === 1 ? cur.u : cur.v));
    goC(true, at(S[s]!, S[c]!));
  }
  return { moves, pockets: pockets && part !== 1, levels: levels.length };
}
