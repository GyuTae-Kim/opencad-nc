/**
 * 깎기 시뮬레이션 엔진: NC 이동 목록(구조 배열)을 차례로 높이 지도에 내린다. 재생 막대와 맞물려 점진적으로 나아가고,
 * 되감으면 가장 가까운 저장점(높이 지도 사본)에서 다시 계산한다.
 *
 * - 자리(SimPosition) = 이동 [0, move)를 다 하고 move번 이동을 frac만큼 한 상태. 높이는 "더 낮은 쪽"만 남기므로(min) 같은 이동을
 *   다시 내려도 결과가 같다 — 앞으로 가는 것은 남은 조각만 내리면 된다.
 * - 직선·급속·드릴 이동은 선분 하나, 원호·나선은 현의 처짐이 chordTol 안인 선분들로 나눈다.
 * - 기계 좌표 쪽 추정 이동(FLAG_MACHINE_EST — 높이를 모르는 이동)은 내리지 않는다.
 * - 영역 이동(SIM_MOVE_REGION — 판재의 홈·포켓처럼 파일이 모양을 정한 가공)은 공구 없이 그 영역을 바닥 높이로 한 번에 내린다(이동의 일부만
 *   해도 다 한 것으로 본다).
 * - 급속 이동이 소재를 깎으면(rapidTol보다 깊게) 그 이동을 사건으로 남긴다(마디도 표시해 빨갛게 그린다).
 * - 저장점: 한 일(살펴본 마디 수)이 checkpointWork를 넘을 때마다 사본을 두고, maxCheckpoints를 넘으면 하나 걸러 버리고 간격을 두 배로.
 */
import { FLAG_MACHINE_EST, MOVE_ARC, MOVE_RAPID, PLANE_AXES } from '../model';
import type { HeightGrid, SimRegions } from './grid';
import type { PreparedTool } from './tool';

/** 엔진이 쓰는 이동 자료(NcPayload의 일부와 같은 꼴) */
export interface SimMoves {
  count: number;
  kind: Uint8Array;
  /** 점 xyz(길이 3*(count+1)) — 이동 i는 점 i → 점 i+1 */
  points: Float64Array;
  tool: Int32Array;
  flags: Uint16Array;
  arc: Int32Array;
  arcCenter: Float64Array;
  arcPlane: Uint8Array;
  arcSweep: Float64Array;
  /** 영역 이동(SIM_MOVE_REGION)의 영역 표 — 그 이동의 arc 값이 영역 번호다 */
  regions?: SimRegions;
}

/** 시뮬레이션만 쓰는 이동 종류: 영역을 바닥 높이로(model.ts의 MOVE_* 다음 번호) */
export const SIM_MOVE_REGION = 4;

/** 이동 [0, move)를 다 하고 move번 이동을 frac(0~1)만큼 한 자리 */
export interface SimPosition {
  move: number;
  frac: number;
}

/** 급속이 소재를 깎은 이동 */
export interface SimEvent {
  move: number;
  /** 가장 깊게 깎은 깊이 */
  depth: number;
}

export interface SimEngineOptions {
  /** 원호를 나눌 때 현의 처짐 한도(기본: 칸 크기의 1/4) */
  chordTol?: number;
  /** 급속 사건으로 볼 깊이(기본 0.01) */
  rapidTol?: number;
  /** 저장점 수 한도(기본 32) */
  maxCheckpoints?: number;
  /** 처음 저장점 간격(살펴본 마디 수, 기본 4백만) */
  checkpointWork?: number;
}

interface Checkpoint {
  move: number;
  h: Float32Array;
  mark: Uint8Array;
  events: number;
}

/** 자리 맞추기: frac ≥ 1이면 다음 이동의 0으로, 범위 안으로 */
export function normalizePosition(p: SimPosition, count: number): SimPosition {
  let move = Math.floor(Number.isFinite(p.move) ? p.move : count);
  let frac = Number.isFinite(p.frac) ? Math.max(0, Math.min(1, p.frac)) : 0;
  if (frac >= 1) {
    move++;
    frac = 0;
  }
  if (move >= count) return { move: count, frac: 0 };
  if (move < 0) return { move: 0, frac: 0 };
  return { move, frac };
}

/** a가 b보다 앞이면 음수 */
export function comparePosition(a: SimPosition, b: SimPosition): number {
  return a.move !== b.move ? a.move - b.move : a.frac - b.frac;
}

export class SimEngine {
  /** 이동 [0, done)를 다 했다 */
  done = 0;
  /** done번 이동을 이만큼 했다(0 = 안 함) */
  partial = 0;
  /** 급속이 소재를 깎은 이동(이동 차례) */
  events: SimEvent[] = [];
  /** 지금까지 한 일(살펴본 마디 수, 되감아도 줄지 않음) */
  work = 0;
  /** 되감은 횟수 */
  rewinds = 0;
  private readonly chordTol: number;
  private readonly rapidTol: number;
  private readonly maxCps: number;
  private cpEvery: number;
  private sinceCp = 0;
  private cps: Checkpoint[] = [];

  constructor(
    readonly moves: SimMoves,
    readonly grid: HeightGrid,
    private readonly toolFor: (tool: number) => PreparedTool,
    opts: SimEngineOptions = {},
  ) {
    const s = grid.spec;
    this.chordTol = opts.chordTol ?? Math.min(s.dx, s.dy) / 4;
    this.rapidTol = opts.rapidTol ?? 0.01;
    grid.rapidTol = this.rapidTol;
    this.maxCps = Math.max(1, Math.floor(opts.maxCheckpoints ?? 32));
    this.cpEvery = Math.max(1, opts.checkpointWork ?? 4_000_000);
  }

  get position(): SimPosition {
    return { move: this.done, frac: this.partial };
  }

  /** 저장점 수와 그 메모리(바이트) */
  get checkpointInfo(): { count: number; bytes: number } {
    let bytes = 0;
    for (const c of this.cps) bytes += c.h.byteLength + c.mark.byteLength;
    return { count: this.cps.length, bytes };
  }

  /**
   * target까지 나아간다(뒤면 되감는다). budgetMs를 넘기면 이동 사이에서 멈추고 false — 다시 부르면 이어 간다. 다 가면 true
   */
  advance(target: SimPosition, budgetMs = Infinity, now: () => number = () => performance.now()): boolean {
    const tgt = normalizePosition(target, this.moves.count);
    if (comparePosition(tgt, this.position) < 0) this.rewind(tgt);
    const t0 = budgetMs === Infinity ? 0 : now();
    while (this.done < tgt.move) {
      const w = this.applyMove(this.done, 1);
      this.done++;
      this.partial = 0;
      this.afterMove(w);
      if (budgetMs !== Infinity && now() - t0 > budgetMs) return this.done >= tgt.move && tgt.frac <= this.partial;
    }
    if (tgt.frac > this.partial) {
      this.applyMove(this.done, tgt.frac);
      this.partial = tgt.frac;
    }
    return true;
  }

  /** 되감기: target보다 앞인 가장 늦은 저장점(없으면 처음)으로 */
  private rewind(tgt: SimPosition): void {
    this.rewinds++;
    let cp: Checkpoint | null = null;
    for (const c of this.cps) if (c.move <= tgt.move) cp = c;
    this.grid.restore(cp);
    this.done = cp ? cp.move : 0;
    this.partial = 0;
    this.events.length = cp ? cp.events : 0;
    this.sinceCp = 0;
  }

  private afterMove(work: number): void {
    this.sinceCp += work;
    const last = this.cps.length ? this.cps[this.cps.length - 1]!.move : 0;
    if (this.sinceCp < this.cpEvery || this.done <= last) return;
    const s = this.grid.snapshot();
    this.cps.push({ move: this.done, h: s.h, mark: s.mark, events: this.events.length });
    this.sinceCp = 0;
    if (this.cps.length > this.maxCps) {
      // 하나 걸러 남기고 간격을 두 배로(저장점이 프로그램 전체에 고르게 남는다)
      this.cps = this.cps.filter((_, k) => k % 2 === 1);
      this.cpEvery *= 2;
    }
  }

  /** 이동 i를 frac만큼 내린다. 한 일(살펴본 마디 수)을 돌려준다 */
  private applyMove(i: number, frac: number): number {
    const m = this.moves;
    if (i < 0 || i >= m.count || frac <= 0) return 0;
    if (m.flags[i]! & FLAG_MACHINE_EST) return 0;
    if (m.kind[i] === SIM_MOVE_REGION) {
      const w = m.regions ? this.grid.stampRegion(m.regions, m.arc[i]!).visited + 8 : 0;
      this.work += w;
      return w;
    }
    const t = this.toolFor(m.tool[i]!);
    const rapid = m.kind[i] === MOVE_RAPID;
    const p = m.points;
    const k = i * 3;
    const sx = p[k]!;
    const sy = p[k + 1]!;
    const sz = p[k + 2]!;
    const ex = p[k + 3]!;
    const ey = p[k + 4]!;
    const ez = p[k + 5]!;
    const g = this.grid;
    let work = 0;
    let depth = 0;
    const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
      const r = g.stampSegment(ax, ay, az, bx, by, bz, t, rapid);
      work += r.visited + 8;
      if (r.rapidDepth > depth) depth = r.rapidDepth;
    };
    const a = m.arc[i]!;
    if (m.kind[i] === MOVE_ARC && a >= 0 && a < m.arcPlane.length) {
      const c = [m.arcCenter[a * 3]!, m.arcCenter[a * 3 + 1]!, m.arcCenter[a * 3 + 2]!];
      const [a0, a1, a2] = PLANE_AXES[m.arcPlane[a]!] ?? PLANE_AXES[0]!;
      const s = [sx, sy, sz];
      const e = [ex, ey, ez];
      const u0 = s[a0]! - c[a0]!;
      const v0 = s[a1]! - c[a1]!;
      const r0 = Math.hypot(u0, v0);
      const r1 = Math.hypot(e[a0]! - c[a0]!, e[a1]! - c[a1]!);
      const t0 = Math.atan2(v0, u0);
      const sweep = m.arcSweep[a]!;
      const sw = sweep * frac;
      const rmax = Math.max(r0, r1);
      const tol = this.chordTol;
      const maxAngle = rmax > tol ? 2 * Math.acos(1 - tol / rmax) : Math.PI / 2;
      const n = Math.max(1, Math.min(20000, Math.ceil(Math.abs(sw) / Math.max(1e-6, maxAngle) - 1e-9)));
      const l0 = s[a2]!;
      const dl = e[a2]! - l0;
      const q = [0, 0, 0];
      let px = sx;
      let py = sy;
      let pz = sz;
      for (let j = 1; j <= n; j++) {
        if (j === n && frac >= 1) {
          q[0] = ex;
          q[1] = ey;
          q[2] = ez;
        } else {
          const f = (j / n) * frac;
          const ang = t0 + sweep * f;
          const r = r0 + (r1 - r0) * f;
          q[a0] = c[a0]! + r * Math.cos(ang);
          q[a1] = c[a1]! + r * Math.sin(ang);
          q[a2] = l0 + dl * f;
        }
        seg(px, py, pz, q[0]!, q[1]!, q[2]!);
        px = q[0]!;
        py = q[1]!;
        pz = q[2]!;
      }
    } else {
      const f = frac >= 1 ? 1 : frac;
      seg(sx, sy, sz, sx + (ex - sx) * f, sy + (ey - sy) * f, sz + (ez - sz) * f);
    }
    if (rapid && depth > this.rapidTol) {
      const last = this.events[this.events.length - 1];
      if (last && last.move === i) last.depth = Math.max(last.depth, depth);
      else this.events.push({ move: i, depth });
    }
    this.work += work;
    return work;
  }
}
