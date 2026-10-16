/**
 * 공구 반경 보정 경로(G41/G42 … G40, Heidenhain RL/RR … R0).
 *
 * 프로그램 경로(NcProgram.moves)는 그대로 두고, 보정 구간(NcProgram.compRuns)마다 공구 중심 경로를 따로 계산한다.
 * - 요소(직선·호)를 보정 쪽으로 반지름만큼 옮긴다: 직선은 평행 이동, 호는 반지름을 늘이거나 줄인다.
 * - 모서리: 보정 쪽이 안쪽이면 옮긴 두 요소의 교점까지 자르고(직선·호 모든 짝), 바깥쪽이면 모서리점을 중심으로
 *   반지름 r인 호로 잇는다. 교점이 요소 밖이면(요소가 공구보다 짧음) 두 끝을 직선으로 잇고 간섭 경고를 남긴다.
 * - 들어가기: 보정을 켠 뒤 첫 평면 이동은 시작점(보정 없음)에서, 다음 요소 시작 방향에 수직으로 옮긴 점까지 직선.
 * - 나오기: 보정을 끈 뒤 첫 이동은 마지막 요소 끝에서 수직으로 옮긴 점에서 프로그램 끝점까지 직선.
 * - 평면에 수직인 이동(Z만)은 그 자리에서 수직 축만 움직인다. 보정 평면 밖의 호는 현(직선)으로 본다.
 * - 반지름이 음수면 보정 쪽을 바꾼다(Fanuc의 음수 보정 값과 같은 뜻).
 * 조각마다 원래 이동 번호를 붙인다(재생·고르기에서 같은 줄로 이어진다). 다른 NC 해석기 코드를 보지 않고 일반 기하로 짰다.
 */
import { MOVE_ARC, PLANE_AXES, type NcCompRun, type NcProgram } from './model';

export interface CompPathOptions {
  /** 모든 구간에 쓸 공구 반지름(주면 프로그램에서 찾은 값 대신) */
  radius?: number;
  /** 프로그램에서 반지름을 찾지 못한 구간에 쓸 값(없으면 그 구간은 계산하지 않음) */
  defaultRadius?: number;
}

/** 계산한 보정 경로: 조각(직선·호) 구조 배열 */
export interface NcCompPath {
  count: number;
  /** 0 직선, 1 호 */
  kind: Uint8Array;
  /** 원래 이동 번호(오름차순) */
  move: Uint32Array;
  /** 시작·끝 xyz(조각마다 6) */
  points: Float64Array;
  /** 호 중심 xyz(직선이면 0) */
  center: Float64Array;
  /** 호 중심각(라디안, 평면 법선 기준 반시계 +) */
  sweep: Float64Array;
  plane: Uint8Array;
  /** 구간과 실제로 쓴 반지름(계산하지 못했으면 computed = false) */
  runs: (NcCompRun & { used: number; computed: boolean })[];
  warnings: string[];
}

const EPS = 1e-7;
const TAU = Math.PI * 2;

interface El {
  m: number;
  arc: boolean;
  su: number;
  sv: number;
  eu: number;
  ev: number;
  sw: number;
  ew: number;
  cu: number;
  cv: number;
  sweep: number;
  planar: boolean;
}

type P2 = [number, number];

function wrapPi(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** 요소 끝(end) 또는 시작의 단위 접선 */
function tanAt(el: El, end: boolean): P2 {
  if (!el.arc) {
    const dx = el.eu - el.su;
    const dy = el.ev - el.sv;
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
  const ux = (end ? el.eu : el.su) - el.cu;
  const uy = (end ? el.ev : el.sv) - el.cv;
  const r = Math.hypot(ux, uy) || 1;
  return el.sweep > 0 ? [-uy / r, ux / r] : [uy / r, -ux / r];
}

/** 요소 끝·시작을 보정 쪽으로 sr(= 쪽 부호 × 반지름)만큼 옮긴 점: p + sr·(왼쪽 법선) */
function offAt(el: El, end: boolean, sr: number): P2 {
  const t = tanAt(el, end);
  const pu = end ? el.eu : el.su;
  const pv = end ? el.ev : el.sv;
  return [pu - t[1] * sr, pv + t[0] * sr];
}

/** 호 요소의 각 범위 안인지 */
function inArc(el: El, u: number, v: number): boolean {
  if (Math.abs(el.sweep) >= TAU - 1e-9) return true;
  const t0 = Math.atan2(el.sv - el.cv, el.su - el.cu);
  const t = Math.atan2(v - el.cv, u - el.cu);
  let d = el.sweep > 0 ? t - t0 : t0 - t;
  d = ((d % TAU) + TAU) % TAU;
  const slack = 1e-6;
  return d <= Math.abs(el.sweep) + slack || d >= TAU - slack;
}

/** 옮긴 요소의 기하: 직선(시작·끝) 또는 원(중심·반지름) */
type Geo = { line: true; a: P2; b: P2 } | { line: false; c: P2; r: number };

function geoOf(el: El, sr: number, atEnd: boolean): Geo {
  if (!el.arc) return { line: true, a: offAt(el, false, sr), b: offAt(el, true, sr) };
  const p = offAt(el, atEnd, sr);
  return { line: false, c: [el.cu, el.cv], r: Math.hypot(p[0] - el.cu, p[1] - el.cv) };
}

function lineParam(g: { a: P2; b: P2 }, x: P2): number {
  const dx = g.b[0] - g.a[0];
  const dy = g.b[1] - g.a[1];
  const l2 = dx * dx + dy * dy;
  return l2 > 0 ? ((x[0] - g.a[0]) * dx + (x[1] - g.a[1]) * dy) / l2 : 0;
}

function lineCircle(a: P2, b: P2, c: P2, r: number, out: P2[]): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - c[0];
  const fy = a[1] - c[1];
  const A = dx * dx + dy * dy;
  if (A < 1e-24) return;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  let disc = B * B - 4 * A * C;
  if (disc < 0) {
    if (disc > -1e-9 * Math.max(1, B * B)) disc = 0;
    else return;
  }
  const s = Math.sqrt(disc);
  for (const t of disc === 0 ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)]) out.push([a[0] + t * dx, a[1] + t * dy]);
}

function circleCircle(c1: P2, r1: number, c2: P2, r2: number, out: P2[]): void {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-12) return;
  if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1[0] + (a * dx) / d;
  const my = c1[1] + (a * dy) / d;
  out.push([mx - (h * dy) / d, my + (h * dx) / d]);
  if (h > 1e-12) out.push([mx + (h * dy) / d, my - (h * dx) / d]);
}

/** 안쪽 모서리: 옮긴 A(끝 쪽)와 옮긴 B(시작 쪽)의 교점 가운데 모서리점 P에 가장 가까운 것 */
function intersect(A: El, B: El, sr: number, P: P2): P2 | null {
  const ga = geoOf(A, sr, true);
  const gb = geoOf(B, sr, false);
  const cand: P2[] = [];
  if (ga.line && gb.line) {
    const dax = ga.b[0] - ga.a[0];
    const day = ga.b[1] - ga.a[1];
    const dbx = gb.b[0] - gb.a[0];
    const dby = gb.b[1] - gb.a[1];
    const den = dax * dby - day * dbx;
    if (Math.abs(den) > 1e-18) {
      const qx = gb.a[0] - ga.a[0];
      const qy = gb.a[1] - ga.a[1];
      const t = (qx * dby - qy * dbx) / den;
      cand.push([ga.a[0] + t * dax, ga.a[1] + t * day]);
    }
  } else if (ga.line && !gb.line) lineCircle(ga.a, ga.b, gb.c, gb.r, cand);
  else if (!ga.line && gb.line) lineCircle(gb.a, gb.b, ga.c, ga.r, cand);
  else if (!ga.line && !gb.line) circleCircle(ga.c, ga.r, gb.c, gb.r, cand);
  let best: P2 | null = null;
  let bd = Infinity;
  const tl = 1e-6;
  for (const x of cand) {
    if (ga.line) {
      const t = lineParam(ga, x);
      if (t < -tl || t > 1 + tl) continue;
    } else if (!inArc(A, x[0], x[1])) continue;
    if (gb.line) {
      const t = lineParam(gb, x);
      if (t < -tl || t > 1 + tl) continue;
    } else if (!inArc(B, x[0], x[1])) continue;
    const d = Math.hypot(x[0] - P[0], x[1] - P[1]);
    if (d < bd) {
      bd = d;
      best = x;
    }
  }
  return best;
}

type Join = { arc: true; cu: number; cv: number; sweep: number } | { arc: false } | null;

/** 모서리 처리: A의 새 끝, B의 새 시작, 둘 사이를 잇는 것 */
function corner(A: El, B: El, sr: number, sigma: number): { aEnd: P2; bStart: P2; join: Join; gouge: boolean } {
  const oa = offAt(A, true, sr);
  const ob = offAt(B, false, sr);
  if (Math.hypot(oa[0] - ob[0], oa[1] - ob[1]) <= EPS) return { aEnd: oa, bStart: oa, join: null, gouge: false };
  const tA = tanAt(A, true);
  const tB = tanAt(B, false);
  const cross = tA[0] * tB[1] - tA[1] * tB[0];
  const dot = tA[0] * tB[0] + tA[1] * tB[1];
  const outside = sigma * cross < 0 || (Math.abs(cross) < 1e-9 && dot < 0);
  if (outside) {
    const ang = Math.atan2(Math.abs(cross), dot);
    return { aEnd: oa, bStart: ob, join: { arc: true, cu: A.eu, cv: A.ev, sweep: -sigma * ang }, gouge: false };
  }
  const x = intersect(A, B, sr, [A.eu, A.ev]);
  if (x) return { aEnd: x, bStart: x, join: null, gouge: false };
  return { aEnd: oa, bStart: ob, join: { arc: false }, gouge: true };
}

class PieceBuf {
  kind: number[] = [];
  move: number[] = [];
  pts: number[] = [];
  ctr: number[] = [];
  sweep: number[] = [];
  plane: number[] = [];
  /** 평면 좌표(u, v, w) → xyz */
  ax: readonly [number, number, number] = [0, 1, 2];
  pl = 0;
  private put(a: number[], u: number, v: number, w: number): void {
    const p = [0, 0, 0];
    p[this.ax[0]] = u;
    p[this.ax[1]] = v;
    p[this.ax[2]] = w;
    a.push(p[0]!, p[1]!, p[2]!);
  }
  line(m: number, su: number, sv: number, sw: number, eu: number, ev: number, ew: number): void {
    if (Math.hypot(eu - su, ev - sv, ew - sw) < 1e-12) return;
    this.kind.push(0);
    this.move.push(m);
    this.put(this.pts, su, sv, sw);
    this.put(this.pts, eu, ev, ew);
    this.ctr.push(0, 0, 0);
    this.sweep.push(0);
    this.plane.push(this.pl);
  }
  arc(m: number, su: number, sv: number, sw: number, eu: number, ev: number, ew: number, cu: number, cv: number, sweep: number): void {
    if (Math.abs(sweep) < 1e-12) return this.line(m, su, sv, sw, eu, ev, ew);
    this.kind.push(1);
    this.move.push(m);
    this.put(this.pts, su, sv, sw);
    this.put(this.pts, eu, ev, ew);
    this.put(this.ctr, cu, cv, sw);
    this.sweep.push(sweep);
    this.plane.push(this.pl);
  }
  /** 3D 점 그대로(나오기 이동 끝처럼 평면 좌표로 바꾸지 않은 것) */
  line3(m: number, s: number[], e: number[]): void {
    if (Math.hypot(e[0]! - s[0]!, e[1]! - s[1]!, e[2]! - s[2]!) < 1e-12) return;
    this.kind.push(0);
    this.move.push(m);
    this.pts.push(s[0]!, s[1]!, s[2]!, e[0]!, e[1]!, e[2]!);
    this.ctr.push(0, 0, 0);
    this.sweep.push(0);
    this.plane.push(this.pl);
  }
}

/** 보정 경로를 계산한다(보정 구간이 없으면 빈 결과) */
export function ncCompPath(p: NcProgram, opts: CompPathOptions = {}): NcCompPath {
  const m = p.moves;
  const pts = m.points;
  const warn = new Map<string, number>();
  const W = (msg: string, line: number): void => {
    if (!warn.has(msg)) warn.set(msg, line);
  };
  const buf = new PieceBuf();
  const runs: NcCompPath['runs'] = [];
  const srcRuns = p.compRuns ?? [];
  let carry: { run: NcCompRun; u: number; v: number; w: number } | null = null;
  for (let ri = 0; ri < srcRuns.length; ri++) {
    const run = srcRuns[ri]!;
    let r = opts.radius ?? run.radius;
    if (!Number.isFinite(r) && opts.defaultRadius !== undefined) r = opts.defaultRadius;
    const rec = { ...run, used: r, computed: false };
    runs.push(rec);
    if (!Number.isFinite(r)) {
      W(`보정 구간(${run.line + 1}번 줄): 공구 반지름을 몰라 보정 경로를 그리지 않음`, run.line);
      carry = null;
      continue;
    }
    if (Math.abs(r) < 1e-12) {
      carry = null;
      continue;
    }
    let sigma = run.side === 1 ? 1 : -1;
    if (r < 0) {
      sigma = -sigma;
      r = -r;
    }
    const sr = sigma * r;
    const ax = PLANE_AXES[run.plane] ?? PLANE_AXES[0]!;
    buf.ax = ax;
    buf.pl = run.plane;
    const [a0, a1, a2] = ax;
    // 요소
    const els: El[] = [];
    for (let i = run.first; i < run.end && i < m.count; i++) {
      const k = i * 3;
      const s = [pts[k]!, pts[k + 1]!, pts[k + 2]!];
      const e = [pts[k + 3]!, pts[k + 4]!, pts[k + 5]!];
      const el: El = { m: i, arc: false, su: s[a0]!, sv: s[a1]!, eu: e[a0]!, ev: e[a1]!, sw: s[a2]!, ew: e[a2]!, cu: 0, cv: 0, sweep: 0, planar: false };
      if (m.kind[i] === MOVE_ARC) {
        const ai = m.arc[i]!;
        if (p.arcs.plane[ai] === run.plane) {
          el.arc = true;
          el.cu = p.arcs.center[ai * 3 + a0]!;
          el.cv = p.arcs.center[ai * 3 + a1]!;
          el.sweep = p.arcs.sweep[ai]!;
        } else W('보정 평면 밖의 원호는 현(직선)으로 보고 보정함', m.line[i]!);
      }
      el.planar = el.arc ? Math.hypot(el.su - el.cu, el.sv - el.cv) > EPS && Math.abs(el.sweep) > 1e-9 : Math.hypot(el.eu - el.su, el.ev - el.sv) > EPS;
      if (el.arc) {
        const R = Math.hypot(el.su - el.cu, el.sv - el.cv);
        const k2 = el.sweep > 0 ? 1 : -1;
        if (R - sigma * r * k2 <= EPS) W(`안쪽 원호 반지름(${round(R)})이 공구 반지름(${round(r)})보다 작거나 같음 — 보정 경로가 뒤집힘`, m.line[i]!);
      }
      els.push(el);
    }
    const planar: number[] = [];
    els.forEach((el, k) => {
      if (el.planar) planar.push(k);
    });
    if (!planar.length) {
      carry = null;
      continue;
    }
    rec.computed = true;
    const L = els[planar[0]!]!;
    if (L.arc) W('보정을 켠 첫 이동이 원호 — 현(직선)으로 들어감', m.line[L.m]!);
    const nextEl = planar.length > 1 ? els[planar[1]!]! : null;
    const entryEnd = nextEl ? offAt(nextEl, false, sr) : offAt(L, true, sr);
    const contiguous = carry && carry.run.end === run.first && carry.run.plane === run.plane;
    const su = contiguous ? carry!.u : L.su;
    const sv = contiguous ? carry!.v : L.sv;
    const sw0 = contiguous ? carry!.w : L.sw;
    buf.line(L.m, su, sv, sw0, entryEnd[0], entryEnd[1], L.ew);
    let cur: P2 = entryEnd;
    let start: P2 = entryEnd;
    let gouges = 0;
    const vertical = (el: El): void => buf.line(el.m, cur[0], cur[1], el.sw, cur[0], cur[1], el.ew);
    for (let q = 1; q < planar.length; q++) {
      for (let j = planar[q - 1]! + 1; j < planar[q]!; j++) vertical(els[j]!);
      const el = els[planar[q]!]!;
      const nx = q + 1 < planar.length ? els[planar[q + 1]!]! : null;
      let end: P2;
      let next: P2 | null = null;
      let join: Join = null;
      if (nx) {
        const c = corner(el, nx, sr, sigma);
        end = c.aEnd;
        next = c.bStart;
        join = c.join;
        if (c.gouge) {
          gouges++;
          W('안쪽 모서리에서 옮긴 요소가 만나지 않음(요소가 공구 반지름보다 짧음) — 간섭 가능, 직선으로 이음', m.line[el.m]!);
        }
      } else end = offAt(el, true, sr);
      // 요소 조각
      if (!el.arc) {
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        if (dx * (el.eu - el.su) + dy * (el.ev - el.sv) < -EPS) {
          gouges++;
          W('보정한 직선이 거꾸로 됨(요소가 공구 지름보다 짧음) — 간섭 가능', m.line[el.m]!);
        }
        buf.line(el.m, start[0], start[1], el.sw, end[0], end[1], el.ew);
      } else {
        const ts = Math.atan2(el.sv - el.cv, el.su - el.cu);
        const te = Math.atan2(el.ev - el.cv, el.eu - el.cu);
        const ts2 = Math.atan2(start[1] - el.cv, start[0] - el.cu);
        const te2 = Math.atan2(end[1] - el.cv, end[0] - el.cu);
        const sw = el.sweep + wrapPi(te2 - te) - wrapPi(ts2 - ts);
        if (Math.sign(sw) !== Math.sign(el.sweep) || Math.abs(sw) < 1e-9) {
          gouges++;
          W('보정한 원호가 남지 않음(모서리 교점이 원호를 넘음) — 간섭 가능, 직선으로 이음', m.line[el.m]!);
          buf.line(el.m, start[0], start[1], el.sw, end[0], end[1], el.ew);
        } else buf.arc(el.m, start[0], start[1], el.sw, end[0], end[1], el.ew, el.cu, el.cv, sw);
      }
      cur = end;
      if (join && next) {
        if (join.arc) buf.arc(el.m, end[0], end[1], el.ew, next[0], next[1], el.ew, join.cu, join.cv, join.sweep);
        else buf.line(el.m, end[0], end[1], el.ew, next[0], next[1], el.ew);
        cur = next;
      }
      start = next ?? end;
    }
    const lastK = planar[planar.length - 1]!;
    for (let j = lastK + 1; j < els.length; j++) vertical(els[j]!);
    const lastW = els[els.length - 1]!.ew;
    carry = { run, u: cur[0], v: cur[1], w: lastW };
    // 나오기: 다음 구간이 바로 이어지면(G41 → G42) 그 구간의 들어가기가 이어 받는다
    const nextRun = srcRuns[ri + 1];
    if (run.end < m.count && !(nextRun && nextRun.first === run.end)) {
      const ex = run.end;
      if (m.kind[ex] === MOVE_ARC) W('보정을 끈 첫 이동이 원호 — 현(직선)으로 나옴', m.line[ex]!);
      const s3 = [0, 0, 0];
      s3[a0] = cur[0];
      s3[a1] = cur[1];
      s3[a2] = lastW;
      const k = (ex + 1) * 3;
      buf.line3(ex, s3, [pts[k]!, pts[k + 1]!, pts[k + 2]!]);
      carry = null;
    }
    if (gouges > 1) W(`보정 구간(${run.line + 1}번 줄)에 간섭 의심 ${gouges}곳`, run.line);
  }
  const n = buf.kind.length;
  const lines: string[] = [];
  for (const [msg, line] of warn) lines.push(line >= 0 ? `${line + 1}번 줄: ${msg}` : msg);
  return {
    count: n,
    kind: Uint8Array.from(buf.kind),
    move: Uint32Array.from(buf.move),
    points: Float64Array.from(buf.pts),
    center: Float64Array.from(buf.ctr),
    sweep: Float64Array.from(buf.sweep),
    plane: Uint8Array.from(buf.plane),
    runs,
    warnings: lines,
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 보정 경로 → 선분 쌍(호는 maxAngle로 나눔)과 선분마다 이동 번호 */
export function compPathSegments(c: NcCompPath, maxAngle = Math.PI / 36): { positions: Float32Array; ids: Uint32Array } {
  const segN = new Uint32Array(c.count);
  let total = 0;
  for (let i = 0; i < c.count; i++) {
    const n = c.kind[i] === 1 ? Math.max(1, Math.min(4096, Math.ceil(Math.abs(c.sweep[i]!) / Math.max(1e-4, maxAngle) - 1e-9))) : 1;
    segN[i] = n;
    total += n;
  }
  const pos = new Float32Array(total * 6);
  const ids = new Uint32Array(total);
  let o = 0;
  const P = [0, 0, 0];
  for (let i = 0; i < c.count; i++) {
    const k = i * 6;
    const s = [c.points[k]!, c.points[k + 1]!, c.points[k + 2]!];
    const e = [c.points[k + 3]!, c.points[k + 4]!, c.points[k + 5]!];
    const n = segN[i]!;
    let px = s[0]!;
    let py = s[1]!;
    let pz = s[2]!;
    const [a0, a1, a2] = PLANE_AXES[c.plane[i]!] ?? PLANE_AXES[0]!;
    const cx = c.center[i * 3 + a0]!;
    const cy = c.center[i * 3 + a1]!;
    const r0 = Math.hypot(s[a0]! - cx, s[a1]! - cy);
    const r1 = Math.hypot(e[a0]! - cx, e[a1]! - cy);
    const t0 = Math.atan2(s[a1]! - cy, s[a0]! - cx);
    const sw = c.sweep[i]!;
    for (let j = 1; j <= n; j++) {
      let qx = e[0]!;
      let qy = e[1]!;
      let qz = e[2]!;
      if (j < n) {
        const f = j / n;
        const t = t0 + sw * f;
        const r = r0 + (r1 - r0) * f;
        P[a0] = cx + r * Math.cos(t);
        P[a1] = cy + r * Math.sin(t);
        P[a2] = s[a2]! + (e[a2]! - s[a2]!) * f;
        qx = P[0]!;
        qy = P[1]!;
        qz = P[2]!;
      }
      pos[o * 6] = px;
      pos[o * 6 + 1] = py;
      pos[o * 6 + 2] = pz;
      pos[o * 6 + 3] = qx;
      pos[o * 6 + 4] = qy;
      pos[o * 6 + 5] = qz;
      ids[o] = c.move[i]!;
      o++;
      px = qx;
      py = qy;
      pz = qz;
    }
  }
  return { positions: pos, ids };
}
