/**
 * 높이 지도 → 그물 배열(워커가 만들어 화면으로 넘긴다).
 *
 * - 윗면은 조각(TILE_CELLS칸 × TILE_CELLS칸, 마디는 이웃 조각과 겹친다)마다 그물 하나 — 바뀐 조각만 다시 만든다.
 *   한 번도 깎이지 않은 조각은 가운데 점과 가장자리 마디 고리로 줄인다(평평하고, 이웃 조각·옆면과 같은 가장자리 마디를 써서 틈이 없다).
 * - 옆면 넷은 가장자리 마디 높이를 따라 바닥까지 세운 띠, 바닥은 사각형 하나.
 * - 좌표는 원점(소재 윗면 가운데) 기준 float32(큰 좌표에서도 정밀도를 지키려고 — Mesh3d.origin).
 * - 색: 'depth'는 깎인 깊이로(얕으면 밝은 하늘색 → 깊으면 짙은 남색), 'stock'은 소재 색과 조금 어두운 깎인 면 색.
 *   급속이 깎은 마디는 빨강, 판 밖(직사각형이 아닌 판의 바깥 — 처음부터 소재가 없는 곳)은 바닥 색.
 * - 음영: 기울어진 면(이웃 마디 높이 차가 0보다 크고 벽 문턱 이하)이 있는 조각만 마디 법선(이웃 높이 차분)을 넣어 매끈하게 그린다.
 *   벽(둘레 칸의 높이 차가 칸 크기 × WALL_SLOPE를 넘는 곳)에 닿은 마디는 법선을 0으로 둔다 — 뷰어는 세 꼭짓점 법선이 모두 0인
 *   삼각형을 면 법선으로 그리므로 수직 벽과 그 모서리는 날카롭게 남는다. 평평한 바닥과 벽뿐인 조각(판재·2.5D 가공)은 법선을 넣지 않아
 *   그물이 커지지 않는다(면 법선으로 같은 그림).
 *   판재(MPR·PGI·XML)는 공구가 만들 수 있는 가장 가파른 경사로 문턱을 정한다(panelWallSlope): 평 끝 공구(구멍 기본값)와 모양 그대로
 *   내리는 홈·포켓뿐이면 문턱 0 — 기울어진 면이 없으니 칸이 굵어도(휴대폰 자동 해상도) 얕은 구멍·홈이 매끈한 오목이 되지 않는다.
 * - 관통(13차): 소재 바닥까지 내려간 마디(판 밖 표시는 빼고 — 판 밖은 바닥 색으로 그린다)만으로 된 윗면 삼각형은 그리지 않고,
 *   바닥은 그 삼각형을 뺀 나머지만 그린다(위·아래 어느 쪽에서도 뚫린 곳 너머가 보인다). 구멍 벽은 둘레 칸의 삼각형(윗면 → 바닥 높이)
 *   그대로라 닫힌 그물이다. 관통한 칸이 있는 조각만 제 삼각형 번호를 갖고(TileArrays.indices), 없으면 예전과 같은 그물이다.
 */
import { MARK_OUTSIDE, MARK_RAPID, type HeightGrid } from './grid';
import type { SimTool } from './tool';

export type SimColorMode = 'depth' | 'stock';

type Rgb = readonly [number, number, number];

export const STOCK_RGB: Rgb = [0.74, 0.76, 0.8];
const RAPID_RGB: Rgb = [0.9, 0.22, 0.18];
/** 바닥·판 밖 색 */
const FLOOR_RGB: Rgb = [STOCK_RGB[0] * 0.8, STOCK_RGB[1] * 0.8, STOCK_RGB[2] * 0.8];
/** 벽 문턱: 칸 둘레 높이 차가 칸 크기의 이만큼(약 68°)을 넘으면 벽으로 보고 날카롭게 */
export const WALL_SLOPE = 2.5;

/**
 * 판재 벽 문턱(칸 크기에 곱할 값): 쓰는 공구가 만들 수 있는 가장 가파른 경사. 평 끝 공구는 0(바닥은 평평하고 둘레는 수직 벽 —
 * 홈·포켓 영역도 공구 없이 모양 그대로 내린다), 드릴·V 날은 끝 각의 비탈(118° → 높이/거리 0.6)을 칸 대각선(√2)으로 재고 여유 1.2배,
 * 볼·불 노즈는 테두리가 수직에 가까워 G-code와 같은 WALL_SLOPE. 0이면 법선을 넣지 않는다(모든 높이 차가 벽)
 */
export function panelWallSlope(tools: readonly Pick<SimTool, 'kind' | 'angle'>[]): number {
  let slope = 0;
  for (const t of tools) {
    if (t.kind === 'ball' || t.kind === 'bull') return WALL_SLOPE;
    if (t.kind === 'drill') {
      const half = (Math.min(179, Math.max(1, t.angle)) * Math.PI) / 360;
      slope = Math.max(slope, Math.min(WALL_SLOPE, (Math.SQRT2 * 1.2) / Math.tan(half)));
    }
  }
  return slope;
}
/** 깊이 색: 얕음 → 깊음 */
const DEPTH_RAMP: readonly Rgb[] = [
  [0.62, 0.84, 0.95],
  [0.35, 0.66, 0.9],
  [0.25, 0.45, 0.8],
  [0.2, 0.26, 0.62],
];
const STOCK_CUT_RGB: Rgb = [0.6, 0.63, 0.68];

/** 조각 그물 배열: 마디 cols × rows. flat이면 깎이지 않은 조각(가운데 점 + 가장자리 고리 — fanIndices), 아니면 마디마다 꼭짓점(행 우선 — gridIndices) */
export interface TileArrays {
  tx: number;
  ty: number;
  cols: number;
  rows: number;
  flat: boolean;
  positions: Float32Array;
  colors: Float32Array;
  /** 마디 법선(기울어진 면이 있는 조각만 — 벽에 닿은 마디는 0) */
  normals?: Float32Array;
  /** 관통한 칸이 있는 조각만: 그 삼각형을 뺀 번호(없으면 크기마다 같은 gridIndices) */
  indices?: Uint32Array;
  /** 뺀 삼각형의 서명(없으면 0) — 바뀌면 바닥을 다시 만든다 */
  holes: number;
}

/** 옆면·바닥 그물 배열 */
export interface PlainArrays {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** 원점: 소재 윗면 가운데 */
export function gridOrigin(g: HeightGrid): [number, number, number] {
  const s = g.spec;
  return [s.x0 + ((s.nx - 1) * s.dx) / 2, s.y0 + ((s.ny - 1) * s.dy) / 2, s.top];
}

/** 높이·마디 표시 → 색(rgb를 out[o..o+3]에, 알파 1) */
function colorAt(out: Float32Array, o: number, z: number, mark: number, top: number, depthRange: number, mode: SimColorMode): void {
  let c: Rgb;
  if (mark === MARK_RAPID) c = RAPID_RGB;
  else if (mark === MARK_OUTSIDE) c = FLOOR_RGB;
  else if (z >= top - 1e-6 * Math.max(1, Math.abs(top))) c = STOCK_RGB;
  else if (mode === 'stock') c = STOCK_CUT_RGB;
  else {
    const f = Math.max(0, Math.min(1, (top - z) / depthRange)) * (DEPTH_RAMP.length - 1);
    const k = Math.min(DEPTH_RAMP.length - 2, Math.floor(f));
    const u = f - k;
    const a = DEPTH_RAMP[k]!;
    const b = DEPTH_RAMP[k + 1]!;
    out[o] = a[0] + (b[0] - a[0]) * u;
    out[o + 1] = a[1] + (b[1] - a[1]) * u;
    out[o + 2] = a[2] + (b[2] - a[2]) * u;
    out[o + 3] = 1;
    return;
  }
  out[o] = c[0];
  out[o + 1] = c[1];
  out[o + 2] = c[2];
  out[o + 3] = 1;
}

/** 관통한 마디: 소재 바닥까지 내려갔고 판 밖(처음부터 소재가 없는 곳 — 바닥 색으로 그린다)이 아니다 */
function throughAt(g: HeightGrid, k: number, bz: number): boolean {
  return g.h[k]! <= bz && g.mark[k] !== MARK_OUTSIDE;
}

/**
 * 마디 [i0, i1] × [j0, j1] 칸들의 윗면 삼각형(gridIndices와 같은 차례 — 칸마다 (a, b, e)·(a, e, d)) 가운데 세 마디가 모두 관통한 것을 뺀 번호와
 * 뺀 삼각형의 서명. 뺀 것이 없으면 null(크기마다 같은 gridIndices를 쓴다)
 */
function holedIndices(g: HeightGrid, i0: number, i1: number, j0: number, j1: number): { indices: Uint32Array; holes: number } | null {
  const nx = g.spec.nx;
  const bz = Math.fround(g.spec.bottom);
  const cols = i1 - i0 + 1;
  let any = false;
  for (let j = j0; j <= j1 && !any; j++) for (let i = i0; i <= i1; i++) if (throughAt(g, j * nx + i, bz)) {
    any = true;
    break;
  }
  if (!any) return null;
  // 크기를 아는 배열에 바로 채운다(JS 배열에 쌓아 옮기면 관통 조각이 많은 판에서 그물 시간이 눈에 띄게 늘었다).
  // 왼쪽 두 마디(a·d)의 관통은 앞 칸의 오른쪽 두 마디(b·e)라 다시 보지 않는다
  const out = new Uint32Array((i1 - i0) * (j1 - j0) * 6);
  let n = 0;
  let removed = 0;
  let sig = 0;
  for (let j = j0; j < j1; j++) {
    let ta = throughAt(g, j * nx + i0, bz);
    let td = throughAt(g, (j + 1) * nx + i0, bz);
    for (let i = i0; i < i1; i++) {
      const k = j * nx + i;
      const tb = throughAt(g, k + 1, bz);
      const te = throughAt(g, k + nx + 1, bz);
      const a = (j - j0) * cols + (i - i0);
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (ta && tb && te) {
        removed++;
        sig = (Math.imul(sig, 31) + k * 2 + 1) | 0;
      } else {
        out[n++] = a;
        out[n++] = b;
        out[n++] = e;
      }
      if (ta && te && td) {
        removed++;
        sig = (Math.imul(sig, 31) + k * 2 + 2) | 0;
      } else {
        out[n++] = a;
        out[n++] = e;
        out[n++] = d;
      }
      ta = tb;
      td = te;
    }
  }
  if (!removed) return null;
  return { indices: out.slice(0, n), holes: (Math.imul(sig, 31) + removed) | 0 || 1 };
}

/** 조각이 한 번도 깎이지 않았는지(가장자리 마디 포함) */
function tileUntouched(g: HeightGrid, i0: number, i1: number, j0: number, j1: number): boolean {
  const top = Math.fround(g.spec.top);
  const nx = g.spec.nx;
  for (let j = j0; j <= j1; j++) {
    const b = j * nx;
    for (let i = i0; i <= i1; i++) if (g.h[b + i] !== top || g.mark[b + i]) return false;
  }
  return true;
}

/** 조각 (tx, ty)의 그물 배열 */
export function buildTile(g: HeightGrid, tx: number, ty: number, origin: readonly number[], mode: SimColorMode, slope = WALL_SLOPE): TileArrays {
  const s = g.spec;
  const T = g.tile;
  const i0 = tx * T;
  const j0 = ty * T;
  const i1 = Math.min(s.nx - 1, i0 + T);
  const j1 = Math.min(s.ny - 1, j0 + T);
  const ox = origin[0]!;
  const oy = origin[1]!;
  const oz = origin[2]!;
  const range = Math.max(1e-9, s.top - s.bottom);
  const cols = i1 - i0 + 1;
  const rows = j1 - j0 + 1;
  if (tileUntouched(g, i0, i1, j0, j1)) {
    // 가운데 점 + 가장자리 마디 고리(반시계) — 이웃 조각·옆면과 같은 마디를 써서 T자 이음매 틈이 생기지 않게
    const ring = 2 * (cols - 1) + 2 * (rows - 1);
    const positions = new Float32Array((ring + 1) * 3);
    const colors = new Float32Array((ring + 1) * 4);
    const z = s.top - oz;
    const put = (v: number, x: number, y: number): void => {
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      colorAt(colors, v * 4, s.top, 0, s.top, range, mode);
    };
    const X = (i: number): number => s.x0 + i * s.dx - ox;
    const Y = (j: number): number => s.y0 + j * s.dy - oy;
    put(0, (X(i0) + X(i1)) / 2, (Y(j0) + Y(j1)) / 2);
    let v = 1;
    for (let i = i0; i < i1; i++) put(v++, X(i), Y(j0));
    for (let j = j0; j < j1; j++) put(v++, X(i1), Y(j));
    for (let i = i1; i > i0; i--) put(v++, X(i), Y(j1));
    for (let j = j1; j > j0; j--) put(v++, X(i0), Y(j));
    return { tx, ty, cols, rows, flat: true, positions, colors, holes: 0 };
  }
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 4);
  let v = 0;
  for (let j = j0; j <= j1; j++) {
    const y = s.y0 + j * s.dy - oy;
    const b = j * s.nx;
    for (let i = i0; i <= i1; i++) {
      const z = g.h[b + i]!;
      positions[v * 3] = s.x0 + i * s.dx - ox;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z - oz;
      colorAt(colors, v * 4, z, g.mark[b + i]!, s.top, range, mode);
      v++;
    }
  }
  const normals = tileNormals(g, i0, i1, j0, j1, slope);
  const cut = holedIndices(g, i0, i1, j0, j1);
  return { tx, ty, cols, rows, flat: false, positions, colors, ...(normals ? { normals } : {}), ...(cut ? { indices: cut.indices } : {}), holes: cut?.holes ?? 0 };
}

/**
 * 조각 마디 [i0, i1] × [j0, j1]의 법선(행 우선). 조각 안 칸에 기울어진 면(0 < 높이 차 ≤ 문턱)이 없으면 null(면 법선으로 같은 그림 —
 * 문턱(slope × 칸 크기)이 0이면 늘 null).
 * 둘레 네 칸 가운데 하나라도 벽(높이 차 > 문턱)이면 0, 아니면 이웃 마디 높이 차분 (−∂z/∂x, −∂z/∂y, 1)을 단위 길이로.
 * 칸 높이 차는 온 격자에서 재므로 조각 가장자리 마디의 법선은 이웃 조각과 같다(이음매에 음영 턱이 없다)
 */
export function tileNormals(g: HeightGrid, i0: number, i1: number, j0: number, j1: number, slope = WALL_SLOPE): Float32Array | null {
  const s = g.spec;
  const nx = s.nx;
  const h = g.h;
  const thr = slope * Math.max(s.dx, s.dy);
  if (!(thr > 0)) return null;
  // 칸 (i, j)(왼쪽 아래 마디) 높이 차 — 조각 둘레 한 칸까지: qa = i0 - 1 … i1, qb = j0 - 1 … j1
  const qw = i1 - i0 + 2;
  const qh = j1 - j0 + 2;
  const range = new Float32Array(qw * qh);
  let sloped = false;
  for (let qj = 0; qj < qh; qj++) {
    const j = j0 - 1 + qj;
    for (let qi = 0; qi < qw; qi++) {
      const i = i0 - 1 + qi;
      if (i < 0 || j < 0 || i >= nx - 1 || j >= s.ny - 1) continue;
      const k = j * nx + i;
      const a = h[k]!;
      const b = h[k + 1]!;
      const c = h[k + nx]!;
      const d = h[k + nx + 1]!;
      const r = Math.max(a, b, c, d) - Math.min(a, b, c, d);
      range[qj * qw + qi] = r;
      if (!sloped && r > 0 && r <= thr && i >= i0 && i < i1 && j >= j0 && j < j1) sloped = true;
    }
  }
  if (!sloped) return null;
  const out = new Float32Array((i1 - i0 + 1) * (j1 - j0 + 1) * 3);
  let v = 0;
  for (let j = j0; j <= j1; j++) {
    const ja = j > 0 ? j - 1 : j;
    const jb = j < s.ny - 1 ? j + 1 : j;
    for (let i = i0; i <= i1; i++, v++) {
      const qi = i - i0 + 1;
      const qj = j - j0 + 1;
      if (range[qj * qw + qi]! > thr || range[qj * qw + qi - 1]! > thr || range[(qj - 1) * qw + qi]! > thr || range[(qj - 1) * qw + qi - 1]! > thr) continue;
      const ia = i > 0 ? i - 1 : i;
      const ib = i < nx - 1 ? i + 1 : i;
      const gx = ib > ia ? (h[j * nx + ib]! - h[j * nx + ia]!) / ((ib - ia) * s.dx) : 0;
      const gy = jb > ja ? (h[jb * nx + i]! - h[ja * nx + i]!) / ((jb - ja) * s.dy) : 0;
      const l = Math.sqrt(gx * gx + gy * gy + 1);
      out[v * 3] = -gx / l;
      out[v * 3 + 1] = -gy / l;
      out[v * 3 + 2] = 1 / l;
    }
  }
  return out;
}

/** 깎이지 않은 조각(가운데 점 + 가장자리 고리 ring개)의 삼각형 번호(위에서 보아 반시계) */
export function fanIndices(cols: number, rows: number): Uint32Array {
  const ring = 2 * (cols - 1) + 2 * (rows - 1);
  const out = new Uint32Array(ring * 3);
  for (let k = 0; k < ring; k++) {
    out[k * 3] = 0;
    out[k * 3 + 1] = 1 + k;
    out[k * 3 + 2] = 1 + ((k + 1) % ring);
  }
  return out;
}

/** cols × rows 꼭짓점 격자의 삼각형 번호(위에서 보아 반시계) */
export function gridIndices(cols: number, rows: number): Uint32Array {
  const out = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      out[k++] = a;
      out[k++] = b;
      out[k++] = e;
      out[k++] = a;
      out[k++] = e;
      out[k++] = d;
    }
  return out;
}

/**
 * 옆면 넷: 가장자리 마디마다 (바닥, 윗면 높이) 두 꼭짓점, 바깥에서 보아 반시계. 색은 소재 색(급속 표시는 빨강)
 */
export function buildWalls(g: HeightGrid, origin: readonly number[], mode: SimColorMode): PlainArrays {
  const s = g.spec;
  const ox = origin[0]!;
  const oy = origin[1]!;
  const oz = origin[2]!;
  const range = Math.max(1e-9, s.top - s.bottom);
  const nv = 2 * (2 * s.nx + 2 * s.ny);
  const positions = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 4);
  const indices = new Uint32Array((2 * (s.nx - 1) + 2 * (s.ny - 1)) * 6);
  let v = 0;
  let k = 0;
  const side = (n: number, at: (q: number) => [number, number, number, number], flip: boolean): void => {
    const base = v;
    for (let q = 0; q < n; q++) {
      const [x, y, z, mark] = at(q);
      positions[v * 3] = x - ox;
      positions[v * 3 + 1] = y - oy;
      positions[v * 3 + 2] = s.bottom - oz;
      colorAt(colors, v * 4, s.top, 0, s.top, range, mode);
      v++;
      positions[v * 3] = x - ox;
      positions[v * 3 + 1] = y - oy;
      positions[v * 3 + 2] = z - oz;
      colorAt(colors, v * 4, z >= s.top ? s.top : z, mark, s.top, range, mode === 'depth' ? 'stock' : mode);
      v++;
    }
    for (let q = 0; q + 1 < n; q++) {
      const b0 = base + q * 2;
      const t0 = b0 + 1;
      const b1 = b0 + 2;
      const t1 = b0 + 3;
      if (!flip) {
        indices[k++] = b0;
        indices[k++] = b1;
        indices[k++] = t1;
        indices[k++] = b0;
        indices[k++] = t1;
        indices[k++] = t0;
      } else {
        indices[k++] = b1;
        indices[k++] = b0;
        indices[k++] = t0;
        indices[k++] = b1;
        indices[k++] = t0;
        indices[k++] = t1;
      }
    }
  };
  const H = (i: number, j: number): [number, number, number, number] => {
    const idx = j * s.nx + i;
    return [s.x0 + i * s.dx, s.y0 + j * s.dy, g.h[idx]!, g.mark[idx]!];
  };
  side(s.nx, (i) => H(i, 0), false); // 앞(−Y)
  side(s.nx, (i) => H(i, s.ny - 1), true); // 뒤(+Y)
  side(s.ny, (j) => H(0, j), true); // 왼쪽(−X)
  side(s.ny, (j) => H(s.nx - 1, j), false); // 오른쪽(+X)
  g.wallDirty = false;
  return { positions, colors, indices };
}

/**
 * 바닥(아래에서 보아 반시계). 관통한 곳이 없으면 사각형 하나. 있으면 윗면에서 뺀 삼각형(holedIndices — 세 마디가 모두 관통)의 나머지만:
 * 줄마다 두 삼각형이 모두 남는 칸이 이어지면 사각형 하나로 묶고, 하나만 남는 칸은 그 삼각형 하나
 */
export function buildBottom(g: HeightGrid, origin: readonly number[]): PlainArrays {
  const s = g.spec;
  const x0 = s.x0 - origin[0]!;
  const x1 = s.x0 + (s.nx - 1) * s.dx - origin[0]!;
  const y0 = s.y0 - origin[1]!;
  const y1 = s.y0 + (s.ny - 1) * s.dy - origin[1]!;
  const z = s.bottom - origin[2]!;
  const nx = s.nx;
  const bz = Math.fround(s.bottom);
  const quad = (): PlainArrays => {
    const positions = new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]);
    const colors = new Float32Array(16);
    for (let v = 0; v < 4; v++) colors.set([FLOOR_RGB[0], FLOOR_RGB[1], FLOOR_RGB[2], 1], v * 4);
    return { positions, colors, indices: new Uint32Array([0, 3, 2, 0, 2, 1]) };
  };
  let any = false;
  for (let k = 0; k < g.h.length; k++)
    if (throughAt(g, k, bz)) {
      any = true;
      break;
    }
  if (!any) return quad();
  let removed = false;
  const pos: number[] = [];
  const idx: number[] = [];
  const X = (i: number): number => s.x0 + i * s.dx - origin[0]!;
  const Y = (j: number): number => s.y0 + j * s.dy - origin[1]!;
  const vert = (i: number, j: number): number => {
    pos.push(X(i), Y(j), z);
    return pos.length / 3 - 1;
  };
  for (let j = 0; j + 1 < s.ny; j++) {
    let run = -1;
    const flush = (end: number): void => {
      if (run < 0) return;
      // 칸 run … end-1을 사각형 하나로(아래에서 보아 반시계 — 위에서 본 (a, b, e)·(a, e, d)를 뒤집은 차례)
      const a = vert(run, j);
      const b = vert(end, j);
      const e = vert(end, j + 1);
      const d = vert(run, j + 1);
      idx.push(a, e, b, a, d, e);
      run = -1;
    };
    for (let i = 0; i + 1 < nx; i++) {
      const k = j * nx + i;
      const ta = throughAt(g, k, bz);
      const tb = throughAt(g, k + 1, bz);
      const td = throughAt(g, k + nx, bz);
      const te = throughAt(g, k + nx + 1, bz);
      const keep1 = !(ta && tb && te);
      const keep2 = !(ta && te && td);
      if (keep1 && keep2) {
        if (run < 0) run = i;
        continue;
      }
      removed = true;
      flush(i);
      if (keep1) {
        const a = vert(i, j);
        const b = vert(i + 1, j);
        const e = vert(i + 1, j + 1);
        idx.push(a, e, b);
      } else if (keep2) {
        const a = vert(i, j);
        const e = vert(i + 1, j + 1);
        const d = vert(i, j + 1);
        idx.push(a, d, e);
      }
    }
    flush(nx - 1);
  }
  // 바닥까지 내려간 마디는 있어도 세 마디가 모두 관통한 삼각형이 없으면(윗면에서 뺀 것이 없으면) 사각형 하나 그대로
  if (!removed) return quad();
  const positions = Float32Array.from(pos);
  const colors = new Float32Array((pos.length / 3) * 4);
  for (let v = 0; v < pos.length / 3; v++) colors.set([FLOOR_RGB[0], FLOOR_RGB[1], FLOOR_RGB[2], 1], v * 4);
  return { positions, colors, indices: Uint32Array.from(idx) };
}

/** 바뀐 조각을 모두 만든다(표시를 지운다) */
export function takeDirtyTiles(g: HeightGrid, origin: readonly number[], mode: SimColorMode, slope = WALL_SLOPE): TileArrays[] {
  const out: TileArrays[] = [];
  for (let ty = 0; ty < g.tilesY; ty++)
    for (let tx = 0; tx < g.tilesX; tx++) {
      const k = ty * g.tilesX + tx;
      if (!g.dirty[k]) continue;
      g.dirty[k] = 0;
      out.push(buildTile(g, tx, ty, origin, mode, slope));
    }
  return out;
}
