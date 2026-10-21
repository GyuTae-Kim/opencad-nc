/**
 * 3×4 아핀 변환(행 우선 3×3 + 이동 3) 도움 — G-code 좌표 변환(G68·G51·G51.1·G68.2), Siemens 프레임,
 * Heidenhain 좌표 변환 사이클(7·8·10·11·26)이 함께 쓴다.
 */
import { PLANE_AXES } from './model';

export type Affine = Float64Array;

export function affine(m: number[], t: number[]): Affine {
  return new Float64Array([...m, ...t]);
}
export function identityAffine(): Affine {
  return affine([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]);
}
export function isIdentityAffine(m: Affine, eps = 1e-12): boolean {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  for (let k = 0; k < 12; k++) if (Math.abs(m[k]! - id[k]!) > eps) return false;
  return true;
}
/** a∘b(b를 먼저) */
export function composeAffine(a: Affine, b: Affine): Affine {
  const o = new Float64Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    o[9 + i] = a[i * 3]! * b[9]! + a[i * 3 + 1]! * b[10]! + a[i * 3 + 2]! * b[11]! + a[9 + i]!;
  }
  return o;
}
export function invertAffine(a: Affine): Affine | null {
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = a as unknown as number[];
  const c0 = m4! * m8! - m5! * m7!;
  const c1 = m5! * m6! - m3! * m8!;
  const c2 = m3! * m7! - m4! * m6!;
  const det = m0! * c0 + m1! * c1 + m2! * c2;
  if (Math.abs(det) < 1e-15) return null;
  const inv = [
    c0 / det,
    (m2! * m7! - m1! * m8!) / det,
    (m1! * m5! - m2! * m4!) / det,
    c1 / det,
    (m0! * m8! - m2! * m6!) / det,
    (m2! * m3! - m0! * m5!) / det,
    c2 / det,
    (m1! * m6! - m0! * m7!) / det,
    (m0! * m4! - m1! * m3!) / det,
  ];
  const t = [0, 1, 2].map((i) => -(inv[i * 3]! * a[9]! + inv[i * 3 + 1]! * a[10]! + inv[i * 3 + 2]! * a[11]!));
  return affine(inv, t);
}
export function applyAffine(a: Affine, p: ArrayLike<number>, out: number[] | Float64Array): void {
  const x = p[0]!;
  const y = p[1]!;
  const z = p[2]!;
  out[0] = a[0]! * x + a[1]! * y + a[2]! * z + a[9]!;
  out[1] = a[3]! * x + a[4]! * y + a[5]! * z + a[10]!;
  out[2] = a[6]! * x + a[7]! * y + a[8]! * z + a[11]!;
}
/** 방향(이동 없이 3×3만) */
export function applyLinear(a: Affine, p: ArrayLike<number>, out: number[] | Float64Array): void {
  const x = p[0]!;
  const y = p[1]!;
  const z = p[2]!;
  out[0] = a[0]! * x + a[1]! * y + a[2]! * z;
  out[1] = a[3]! * x + a[4]! * y + a[5]! * z;
  out[2] = a[6]! * x + a[7]! * y + a[8]! * z;
}
/** 이동 */
export function translateAffine(t: ArrayLike<number>): Affine {
  return affine([1, 0, 0, 0, 1, 0, 0, 0, 1], [t[0]!, t[1]!, t[2]!]);
}
/** 중심 c에 대한 축별 배율(거울은 -1) */
export function diagAbout(c: number[], f: number[]): Affine {
  return affine([f[0]!, 0, 0, 0, f[1]!, 0, 0, 0, f[2]!], [c[0]! * (1 - f[0]!), c[1]! * (1 - f[1]!), c[2]! * (1 - f[2]!)]);
}
/** 평면 plane에서 중심 c 둘레 deg도 회전(평면 법선 기준 반시계 +) */
export function rotAbout(c: number[], deg: number, plane: number): Affine {
  const [a0, a1, a2] = PLANE_AXES[plane] ?? PLANE_AXES[0]!;
  const t = (deg * Math.PI) / 180;
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  m[a0 * 3 + a0] = Math.cos(t);
  m[a0 * 3 + a1] = -Math.sin(t);
  m[a1 * 3 + a0] = Math.sin(t);
  m[a1 * 3 + a1] = Math.cos(t);
  m[a2 * 3 + a2] = 1;
  const r = affine(m, [0, 0, 0]);
  const rc = [0, 0, 0];
  applyAffine(r, c, rc);
  r[9] = c[0]! - rc[0]!;
  r[10] = c[1]! - rc[1]!;
  r[11] = c[2]! - rc[2]!;
  return r;
}
/** 축(0 x, 1 y, 2 z) 둘레 deg도 회전(원점 중심, 오른손) */
export function rotAxis(axis: number, deg: number): Affine {
  // x축 둘레 = YZ 평면(G19), y축 = ZX(G18), z축 = XY(G17)
  return rotAbout(ZERO3, deg, axis === 0 ? 2 : axis === 1 ? 1 : 0);
}
export const ZERO3 = [0, 0, 0];

/**
 * 변환이 평면 plane을 그대로 두는지(원호를 원호로 옮길 수 있는지), 평면 안 방향 부호(거울이면 -1), 평면 안 배율이 고른지(값)
 */
export function affinePlane(m: Affine | null, plane: number): { keeps: boolean; sign: number; uniform: boolean; scale: number } {
  if (!m) return { keeps: true, sign: 1, uniform: true, scale: 1 };
  const [a0, a1, a2] = PLANE_AXES[plane] ?? PLANE_AXES[0]!;
  const e = (i: number, j: number): number => m[i * 3 + j]!;
  const keeps = Math.abs(e(a2, a0)) < 1e-12 && Math.abs(e(a2, a1)) < 1e-12 && Math.abs(e(a0, a2)) < 1e-12 && Math.abs(e(a1, a2)) < 1e-12;
  const det = e(a0, a0) * e(a1, a1) - e(a0, a1) * e(a1, a0);
  const c0 = Math.hypot(e(a0, a0), e(a1, a0));
  const c1 = Math.hypot(e(a0, a1), e(a1, a1));
  const dotc = e(a0, a0) * e(a0, a1) + e(a1, a0) * e(a1, a1);
  return { keeps, sign: det < 0 ? -1 : 1, uniform: Math.abs(c0 - c1) < 1e-9 * Math.max(1, c0) && Math.abs(dotc) < 1e-9, scale: (c0 + c1) / 2 };
}
