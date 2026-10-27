/**
 * 깎기 시뮬레이션의 높이 지도(z-buffer/dexel 한 겹): 소재 윗면 위 고른 격자의 마디마다 남은 소재의 높이.
 *
 * - 마디 (i, j)는 (x0 + i·dx, y0 + j·dy)에 있고 처음 높이는 소재 윗면(top), 가장 낮게는 소재 바닥(bottom — 뚫리면 바닥에 멈춘다).
 * - 공구가 선분 하나를 지나가면 마디마다 "그 선분 위 어느 자리의 공구 아랫면이 가장 낮은가"(쓸고 지나간 자리의 아래 껍질)를 구해
 *   지금 높이보다 낮으면 내린다. 3축(공구 방향 Z)만 — 공구 아래로 파인 곳(언더컷)은 한 겹 높이 지도로 나타낼 수 없다.
 * - 수평 이동은 선분까지 거리만으로(평 엔드밀은 거리도 필요 없이) 정확하다. 수직 이동은 가장 낮은 끝점으로 정확하다.
 *   기울어진 이동은 평 엔드밀(구간 끝점)·볼 엔드밀(공 중심이 지나간 캡슐과 수직선의 아래 교점)이 닫힌 꼴로 정확하고,
 *   불 노즈·드릴은 볼록 함수의 황금 분할 탐색(24번)이다.
 * - 8×8 마디 덩어리마다 가장 높은 마디를 두어, 공구 끝보다 낮은 덩어리는 통째로 건너뛴다(같은 자리를 여러 번 지나는 경로가 빨라진다).
 * - 바뀐 마디가 든 조각(TILE_CELLS칸 단위, 이웃 마디까지)을 표시해 그물을 바뀐 조각만 다시 만든다.
 */
import type { PreparedTool } from './tool';

export interface GridSpec {
  /** 첫 마디 x·y */
  x0: number;
  y0: number;
  /** 마디 수(2 이상) */
  nx: number;
  ny: number;
  /** 마디 간격 */
  dx: number;
  dy: number;
  /** 소재 윗면·바닥 높이 */
  top: number;
  bottom: number;
}

/** 조각 한 변의 칸 수(마디는 +1) */
export const TILE_CELLS = 64;

/** 마디 수 한도(메모리 — 높이 4 B + 표시 1 B, 그물 꼭짓점 28 B) */
export const MAX_GRID_NODES = 2_200_000;

/** 건너뛰기 덩어리 한 변의 마디 수 */
const BLOCK = 8;

/**
 * 소재 상자와 긴 변 칸 수 → 격자. 칸은 정사각형에 가깝게(긴 변 기준), 마디 수가 한도를 넘으면 칸을 키운다
 */
export function gridFor(box: { min: readonly number[]; max: readonly number[] }, longCells: number, maxNodes = MAX_GRID_NODES): GridSpec {
  const w = Math.max(1e-6, box.max[0]! - box.min[0]!);
  const l = Math.max(1e-6, box.max[1]! - box.min[1]!);
  const n = Math.max(8, Math.round(longCells));
  let cell = Math.max(w, l) / n;
  let cx = Math.max(1, Math.round(w / cell));
  let cy = Math.max(1, Math.round(l / cell));
  while ((cx + 1) * (cy + 1) > maxNodes) {
    cell *= 1.1;
    cx = Math.max(1, Math.round(w / cell));
    cy = Math.max(1, Math.round(l / cell));
  }
  return { x0: box.min[0]!, y0: box.min[1]!, nx: cx + 1, ny: cy + 1, dx: w / cx, dy: l / cy, top: box.max[2]!, bottom: box.min[2]! };
}

/** 한 번 내리기의 결과 */
export interface StampResult {
  /** 살펴본 마디 수(일의 양 — 저장점 간격에 쓴다) */
  visited: number;
  /** 높이가 바뀐 마디 수 */
  changed: number;
  /** 급속이면: 가장 깊게 깎은 깊이(깎지 않았으면 0) */
  rapidDepth: number;
}

const GOLD = (Math.sqrt(5) - 1) / 2;

/** 공구 단면 높이(끝 위로, 0 ≤ d ≤ r) */
function prof(code: number, r: number, rc: number, flatR: number, slope: number, d: number): number {
  if (code === 0) return 0;
  if (code === 1) {
    const q = r * r - d * d;
    return r - (q > 0 ? Math.sqrt(q) : 0);
  }
  if (code === 2) {
    if (d <= flatR) return 0;
    const e = d - flatR;
    const q = rc * rc - e * e;
    return rc - (q > 0 ? Math.sqrt(q) : 0);
  }
  return d * slope;
}

/** 기울어진 선분: t에서 공구 아랫면 높이(불 노즈·원뿔 탐색용) */
function along(t: PreparedTool, az: number, ddz: number, L2: number, kk: number, ww: number, tt: number): number {
  const q = L2 * tt * tt - 2 * kk * tt + ww;
  let d = q > 0 ? Math.sqrt(q) : 0;
  if (d > t.r) d = t.r;
  return az + ddz * tt + prof(t.code, t.r, t.rc, t.flat, t.slope, d);
}

export class HeightGrid {
  readonly spec: GridSpec;
  /** 마디 높이(행 우선: j·nx + i) */
  readonly h: Float32Array;
  /** 마디 표시: 1 = 급속이 깎음 */
  readonly mark: Uint8Array;
  readonly tile = TILE_CELLS;
  /** 조각 수(가로·세로) */
  readonly tilesX: number;
  readonly tilesY: number;
  /** 바뀐 조각(다시 만들 그물) */
  readonly dirty: Uint8Array;
  /** 가장자리 마디가 바뀌었는지(옆면 그물) */
  wallDirty = true;
  /** 급속이 이보다 깊게 깎은 마디만 표시한다(앞 이동과 소수점 끝만 다른 같은 자리 복귀를 빨갛게 그리지 않게) */
  rapidTol = 0;
  /** 덩어리마다 가장 높은 마디 */
  private readonly bmax: Float32Array;
  private readonly bw: number;
  private readonly bh: number;
  /** 줄마다 캡슐 안 마디 구간(작업 배열) */
  private rowA = new Int32Array(64);
  private rowB = new Int32Array(64);

  constructor(spec: GridSpec) {
    if (!(spec.nx >= 2 && spec.ny >= 2)) throw new Error('격자 마디가 모자랍니다');
    this.spec = spec;
    this.h = new Float32Array(spec.nx * spec.ny).fill(spec.top);
    this.mark = new Uint8Array(spec.nx * spec.ny);
    this.tilesX = Math.ceil((spec.nx - 1) / TILE_CELLS);
    this.tilesY = Math.ceil((spec.ny - 1) / TILE_CELLS);
    this.dirty = new Uint8Array(this.tilesX * this.tilesY).fill(1);
    this.bw = Math.ceil(spec.nx / BLOCK);
    this.bh = Math.ceil(spec.ny / BLOCK);
    this.bmax = new Float32Array(this.bw * this.bh).fill(spec.top);
  }

  /** 처음 상태로 */
  reset(): void {
    this.h.fill(this.spec.top);
    this.mark.fill(0);
    this.bmax.fill(this.spec.top);
    this.dirty.fill(1);
    this.wallDirty = true;
  }

  /** 높이·표시를 복사해 둔다(저장점) */
  snapshot(): { h: Float32Array; mark: Uint8Array } {
    return { h: this.h.slice(), mark: this.mark.slice() };
  }

  /** 저장점으로(null이면 처음 상태로) 되돌린다 — 다른 마디가 든 조각만 바뀐 것으로 표시한다 */
  restore(s: { h: Float32Array; mark: Uint8Array } | null): void {
    const { nx } = this.spec;
    const T = this.tile;
    const top = Math.fround(this.spec.top);
    for (let ty = 0; ty < this.tilesY; ty++)
      for (let tx = 0; tx < this.tilesX; tx++) {
        const k = ty * this.tilesX + tx;
        if (this.dirty[k]) continue;
        const i1 = Math.min(nx - 1, tx * T + T);
        const j1 = Math.min(this.spec.ny - 1, ty * T + T);
        outer: for (let j = ty * T; j <= j1; j++) {
          const base = j * nx;
          for (let i = tx * T; i <= i1; i++)
            if (this.h[base + i] !== (s ? s.h[base + i] : top) || this.mark[base + i] !== (s ? s.mark[base + i] : 0)) {
              this.markTiles(Math.max(0, tx * T - 1), Math.min(nx - 1, i1 + 1), Math.max(0, ty * T - 1), Math.min(this.spec.ny - 1, j1 + 1));
              break outer;
            }
        }
      }
    if (s) {
      this.h.set(s.h);
      this.mark.set(s.mark);
      for (let by = 0; by < this.bh; by++) for (let bx = 0; bx < this.bw; bx++) this.blockMax(bx, by);
    } else {
      this.h.fill(this.spec.top);
      this.mark.fill(0);
      this.bmax.fill(this.spec.top);
    }
    this.wallDirty = true;
  }

  /** 덩어리 (bx, by)의 가장 높은 마디를 다시 잰다 */
  private blockMax(bx: number, by: number): void {
    const { nx, ny } = this.spec;
    const i1 = Math.min(nx - 1, bx * BLOCK + BLOCK - 1);
    const j1 = Math.min(ny - 1, by * BLOCK + BLOCK - 1);
    let m = -Infinity;
    for (let j = by * BLOCK; j <= j1; j++) {
      const b = j * nx;
      for (let i = bx * BLOCK; i <= i1; i++) if (this.h[b + i]! > m) m = this.h[b + i]!;
    }
    this.bmax[by * this.bw + bx] = m;
  }

  /** 마디 범위 [i0, i1] × [j0, j1](이웃 포함해 넘겨준다)가 든 조각을 바뀐 것으로 */
  markTiles(i0: number, i1: number, j0: number, j1: number): void {
    const T = this.tile;
    const tx0 = i0 >= 1 ? Math.floor((i0 - 1) / T) : 0;
    const tx1 = Math.min(this.tilesX - 1, Math.floor(i1 / T));
    const ty0 = j0 >= 1 ? Math.floor((j0 - 1) / T) : 0;
    const ty1 = Math.min(this.tilesY - 1, Math.floor(j1 / T));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) this.dirty[ty * this.tilesX + tx] = 1;
    const { nx, ny } = this.spec;
    if (i0 <= 1 || j0 <= 1 || i1 >= nx - 2 || j1 >= ny - 2) this.wallDirty = true;
  }

  /**
   * 공구 끝이 (ax,ay,az) → (bx,by,bz)로 지나간 자리를 내린다. rapid면 깎은 마디를 표시하고 가장 깊게 깎은 깊이를 돌려준다.
   * 격자 밖은 무시한다(일부만 걸치면 걸친 부분만)
   */
  stampSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: PreparedTool, rapid = false): StampResult {
    const res: StampResult = { visited: 0, changed: 0, rapidDepth: 0 };
    if (!(Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az) && Number.isFinite(bx) && Number.isFinite(by) && Number.isFinite(bz))) return res;
    const s = this.spec;
    const zLow = Math.min(az, bz);
    // 공구 끝이 소재 윗면보다 높으면 닿지 않는다(날 높이 profile ≥ 0)
    if (zLow >= s.top) return res;
    const R = t.r;
    const R2 = R * R;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - R - s.x0) / s.dx - 1e-9));
    const i1 = Math.min(s.nx - 1, Math.floor((Math.max(ax, bx) + R - s.x0) / s.dx + 1e-9));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by) - R - s.y0) / s.dy - 1e-9));
    const j1 = Math.min(s.ny - 1, Math.floor((Math.max(ay, by) + R - s.y0) / s.dy + 1e-9));
    if (i0 > i1 || j0 > j1) return res;
    const ddx = bx - ax;
    const ddy = by - ay;
    const ddz = bz - az;
    const L2 = ddx * ddx + ddy * ddy;
    const L = Math.sqrt(L2);
    const scale = Math.max(1, Math.abs(ax), Math.abs(ay), Math.abs(az), Math.abs(bx), Math.abs(by), Math.abs(bz));
    const vertical = L <= 1e-9 * scale;
    const horizontal = !vertical && Math.abs(ddz) <= 1e-9 * scale;
    // 줄마다 캡슐(선분 + 반지름 R)과 만나는 마디 구간
    const nRows = j1 - j0 + 1;
    if (this.rowA.length < nRows) {
      this.rowA = new Int32Array(nRows * 2);
      this.rowB = new Int32Array(nRows * 2);
    }
    const rowA = this.rowA;
    const rowB = this.rowB;
    const ux = vertical ? 1 : ddx / L;
    const uy = vertical ? 0 : ddy / L;
    for (let j = j0; j <= j1; j++) {
      const y = s.y0 + j * s.dy;
      let xa = Infinity;
      let xb = -Infinity;
      let ey = y - ay;
      if (ey * ey <= R2) {
        const w = Math.sqrt(R2 - ey * ey);
        xa = ax - w;
        xb = ax + w;
      }
      if (!vertical) {
        ey = y - by;
        if (ey * ey <= R2) {
          const w = Math.sqrt(R2 - ey * ey);
          if (bx - w < xa) xa = bx - w;
          if (bx + w > xb) xb = bx + w;
        }
        // 띠: 0 ≤ (P−A)·u ≤ L, −R ≤ (P−A)·n ≤ R  (n = (−uy, ux)), P = (X, y)
        let lo = -Infinity;
        let hi = Infinity;
        const eu = (y - ay) * uy - ax * ux;
        if (Math.abs(ux) > 1e-12) {
          let p = -eu / ux;
          let q = (L - eu) / ux;
          if (p > q) [p, q] = [q, p];
          lo = p;
          hi = q;
        } else if (eu < -1e-12 || eu > L + 1e-12) lo = Infinity;
        const cn = -uy;
        const en = (y - ay) * ux + ax * uy;
        if (Math.abs(cn) > 1e-12) {
          let p = (-R - en) / cn;
          let q = (R - en) / cn;
          if (p > q) [p, q] = [q, p];
          if (p > lo) lo = p;
          if (q < hi) hi = q;
        } else if (en < -R - 1e-12 || en > R + 1e-12) lo = Infinity;
        if (lo <= hi) {
          if (lo < xa) xa = lo;
          if (hi > xb) xb = hi;
        }
      }
      const r = j - j0;
      if (!(xa <= xb)) {
        rowA[r] = 1;
        rowB[r] = 0;
        continue;
      }
      rowA[r] = Math.max(i0, Math.ceil((xa - s.x0) / s.dx - 1e-9));
      rowB[r] = Math.min(i1, Math.floor((xb - s.x0) / s.dx + 1e-9));
    }
    const h = this.h;
    const nx = s.nx;
    const bottom = s.bottom;
    const code = t.code;
    const flatR = t.flat;
    const rc = t.rc;
    const slope = t.slope;
    // 볼 캡슐: 공 중심 A' = (ax, ay, az+R) → B' = (bx, by, bz+R), 아래에서 올라오는 수직선 원점 높이 zr
    const zr = zLow - 2 * R - 1;
    const baba = L2 + ddz * ddz;
    let visited = 0;
    let changed = 0;
    let rapidDepth = 0;
    const bw = this.bw;
    const bx0 = Math.floor(i0 / BLOCK);
    const bx1 = Math.floor(i1 / BLOCK);
    const by0 = Math.floor(j0 / BLOCK);
    const by1 = Math.floor(j1 / BLOCK);
    for (let byi = by0; byi <= by1; byi++) {
      const ja = Math.max(j0, byi * BLOCK);
      const jb = Math.min(j1, byi * BLOCK + BLOCK - 1);
      for (let bxi = bx0; bxi <= bx1; bxi++) {
        // 덩어리의 가장 높은 마디가 공구 끝보다 낮으면 통째로 건너뛴다
        if (this.bmax[byi * bw + bxi]! <= zLow) continue;
        const ia0 = bxi * BLOCK;
        const ib0 = ia0 + BLOCK - 1;
        let ci0 = Infinity;
        let ci1 = -Infinity;
        let cj0 = Infinity;
        let cj1 = -Infinity;
        for (let j = ja; j <= jb; j++) {
          const r = j - j0;
          const ia = rowA[r]! > ia0 ? rowA[r]! : ia0;
          const ib = rowB[r]! < ib0 ? rowB[r]! : ib0;
          if (ia > ib) continue;
          const y = s.y0 + j * s.dy;
          const wy = y - ay;
          const base = j * nx;
          for (let i = ia; i <= ib; i++) {
            const k = base + i;
            const cur = h[k]!;
            if (cur <= zLow) continue;
            visited++;
            const x = s.x0 + i * s.dx;
            const wx = x - ax;
            let z: number;
            if (horizontal) {
              if (code === 0) z = az;
              else {
                // 선분까지 거리
                let tt = (wx * ddx + wy * ddy) / L2;
                tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
                const ex = wx - tt * ddx;
                const ey = wy - tt * ddy;
                let d = Math.sqrt(ex * ex + ey * ey);
                if (d > R) d = R;
                z = az + prof(code, R, rc, flatR, slope, d);
              }
            } else if (vertical) {
              let d = Math.sqrt(wx * wx + wy * wy);
              if (d > R) d = R;
              z = zLow + prof(code, R, rc, flatR, slope, d);
            } else if (code === 1) {
              // 볼: 수직선 (x, y, zr + τ)과 캡슐(반지름 R)의 아래 교점
              const oaz = zr - az - R;
              const baoa = ddx * wx + ddy * wy + ddz * oaz;
              const oaoa = wx * wx + wy * wy + oaz * oaz;
              const bq = baba * oaz - baoa * ddz;
              const cq = baba * oaoa - baoa * baoa - R2 * baba;
              const hq = bq * bq - L2 * cq;
              z = Infinity;
              if (hq >= 0) {
                const tau = (-bq - Math.sqrt(hq)) / L2;
                const yq = baoa + tau * ddz;
                if (yq > 0 && yq < baba) z = zr + tau;
                else {
                  // 끝 공(가까운 쪽)
                  const ocz = yq <= 0 ? oaz : zr - bz - R;
                  const ocx = yq <= 0 ? wx : x - bx;
                  const ocy = yq <= 0 ? wy : y - by;
                  const c2 = ocx * ocx + ocy * ocy + ocz * ocz - R2;
                  const h2 = ocz * ocz - c2;
                  if (h2 >= 0) z = zr - ocz - Math.sqrt(h2);
                }
              }
              if (z === Infinity) {
                // 수치 오차로 캡슐 가장자리를 비켜 간 마디: 반지름 안인 끝 공으로(밖이면 그대로)
                const da = Math.sqrt(wx * wx + wy * wy);
                const db = Math.sqrt((x - bx) * (x - bx) + (y - by) * (y - by));
                if (da <= R) z = az + prof(1, R, R, 0, 0, da);
                if (db <= R) z = Math.min(z, bz + prof(1, R, R, 0, 0, db));
              }
            } else {
              // 공구 끝 자리 p(t) = A + t·D 가운데 마디에서 R 안인 구간 [t1, t2]
              const kk = wx * ddx + wy * ddy;
              const ww = wx * wx + wy * wy;
              const disc = kk * kk - L2 * (ww - R2);
              let t1: number;
              let t2: number;
              if (disc <= 0) t1 = t2 = Math.min(1, Math.max(0, kk / L2));
              else {
                const sq = Math.sqrt(disc);
                t1 = (kk - sq) / L2;
                t2 = (kk + sq) / L2;
                if (t1 < 0) t1 = 0;
                if (t2 > 1) t2 = 1;
                if (t1 > t2) t1 = t2 = Math.min(1, Math.max(0, kk / L2));
              }
              if (code === 0) z = az + ddz * (ddz > 0 ? t1 : t2);
              else {
                // 불 노즈·원뿔: 볼록 함수 — 황금 분할
                z = Math.min(along(t, az, ddz, L2, kk, ww, t1), along(t, az, ddz, L2, kk, ww, t2));
                if (t2 - t1 > 1e-12) {
                  let lo = t1;
                  let hi = t2;
                  let m1 = hi - GOLD * (hi - lo);
                  let m2 = lo + GOLD * (hi - lo);
                  let f1 = along(t, az, ddz, L2, kk, ww, m1);
                  let f2 = along(t, az, ddz, L2, kk, ww, m2);
                  for (let it = 0; it < 24; it++) {
                    if (f1 <= f2) {
                      hi = m2;
                      m2 = m1;
                      f2 = f1;
                      m1 = hi - GOLD * (hi - lo);
                      f1 = along(t, az, ddz, L2, kk, ww, m1);
                    } else {
                      lo = m1;
                      m1 = m2;
                      f1 = f2;
                      m2 = lo + GOLD * (hi - lo);
                      f2 = along(t, az, ddz, L2, kk, ww, m2);
                    }
                  }
                  if (f1 < z) z = f1;
                  if (f2 < z) z = f2;
                }
              }
            }
            if (z < bottom) z = bottom;
            if (z >= cur) continue;
            h[k] = z;
            changed++;
            if (rapid) {
              const dd = cur - z;
              if (dd > this.rapidTol) this.mark[k] = 1;
              if (dd > rapidDepth) rapidDepth = dd;
            }
            if (i < ci0) ci0 = i;
            if (i > ci1) ci1 = i;
            if (j < cj0) cj0 = j;
            if (j > cj1) cj1 = j;
          }
        }
        if (ci0 <= ci1) {
          this.blockMax(bxi, byi);
          this.markTiles(Math.max(0, ci0 - 1), Math.min(nx - 1, ci1 + 1), Math.max(0, cj0 - 1), Math.min(s.ny - 1, cj1 + 1));
        }
      }
    }
    res.visited = visited;
    res.changed = changed;
    res.rapidDepth = rapidDepth;
    return res;
  }
}

/** 시험·비교용: 마디 (i, j) 높이 */
export function heightAt(g: HeightGrid, i: number, j: number): number {
  return g.h[j * g.spec.nx + i]!;
}
