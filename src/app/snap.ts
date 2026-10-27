/**
 * 두 점 측정의 붙잡기 점(순수 함수, DOM 없음 — 코어 Viewer3d.setMeasureSnap에 준다).
 *
 * - 원호 중심: 해석기가 호 표(arcs.center)에 둔 G2/G3 중심을 그대로 쓴다(장면 좌표가 곧 세계 좌표 — NC 장면은 묶음 원점·행렬이 없다).
 *   커서가 중심 자리(빈 곳)에 와야 붙으므로 늘 후보(points)로 주고, 그 호가 그려진 선분 묶음 id를 달아 숨긴 공구·단면을 따르게 한다.
 *   재생 중에는 아직 그리지 않은 이동의 중심을 빼도록 이동 번호 차례로 둔다(arcCenterCount).
 * - 이동 가운데 점(pointsFor): 고른 선분의 이동 번호(segmentIds)로 그 G0·G1·드릴 이동의 가운데, 원호는 현이 아니라 호 위의 가운데 점
 *   (장면이 호를 나눌 때와 같은 식 — 각·반지름·직선 축을 반씩). 장면은 호를 짧은 선분 여럿으로 그리므로 코어의 선분 가운데 점
 *   (midpoints)은 그 조각의 가운데일 뿐이라 쓰지 않는다.
 * - 추론 붙잡기(코어 0.9.0 inference — 교차점·수직 발·축 방향)는 코어가 장면 선분으로 찾는다. 결과 글의 축은 dx·dy·dz로 가린다(measureAxis).
 */
import type { Pick3d, SnapKind, SnapPoint } from 'opencad-viewer3d/types';
import { MOVE_ARC, PLANE_AXES, ncPathSetId } from '../model';

/** 붙잡기 점 계산에 쓰는 NC 자료(NcPayload의 일부) */
export interface SnapMoves {
  moves: { count: number; kind: Uint8Array; points: Float64Array; tool: Int32Array; flags: Uint16Array; arc: Int32Array };
  arcs: { center: Float64Array; plane: Uint8Array; sweep: Float64Array };
}

/** 원호 중심 붙잡기 점과 그 점을 처음 만든 이동 번호(오름차순) */
export interface ArcCenters {
  points: SnapPoint[];
  moves: Uint32Array;
}

/** 장면 묶음 가운데 이동 가운데 점을 주는 것(보정 경로 'nc-comp'는 이동 번호가 같아도 모양이 달라 뺀다) */
const PATH_SET = /^nc-(?:cut|drill)-|^nc-(?:rapid|machine)$/;

/**
 * 모든 원호 이동의 중심 → 붙잡기 점(kind 'center', id = 그 호의 선분 묶음). 같은 묶음 안 같은 자리 중심(여러 바퀴 나선·나눈 원 등)은
 * 처음 것 하나로. limit을 넘으면 거기까지(코어 0.9.0은 512개 이상이면 점 범위 나무로 커서 둘레만 보므로 마우스 이동은 빠르지만,
 * 점 목록·나무의 메모리를 아주 큰 프로그램에서 묶는다 — 고른 호의 중심은 pointsFor가 준다)
 */
export function arcCenters(nc: SnapMoves, limit = 200_000): ArcCenters {
  const m = nc.moves;
  const c = nc.arcs.center;
  const points: SnapPoint[] = [];
  const at: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < m.count && points.length < limit; i++) {
    if (m.kind[i] !== MOVE_ARC) continue;
    const ai = m.arc[i]!;
    if (ai < 0 || ai * 3 + 2 >= c.length) continue;
    const x = c[ai * 3]!;
    const y = c[ai * 3 + 1]!;
    const z = c[ai * 3 + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const id = ncPathSetId(MOVE_ARC, m.flags[i]!, m.tool[i]!);
    // 1e-6 단위 안이면 같은 중심
    const key = `${id}|${Math.round(x * 1e6)}|${Math.round(y * 1e6)}|${Math.round(z * 1e6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ point: [x, y, z], kind: 'center', id });
    at.push(i);
  }
  return { points, moves: Uint32Array.from(at) };
}

/** 재생 중 그린 이동이 lastMove까지일 때 쓸 중심 수(그 이동까지 처음 나온 중심). lastMove가 없으면 모두 */
export function arcCenterCount(c: ArcCenters, lastMove: number | null): number {
  if (lastMove === null) return c.points.length;
  let lo = 0;
  let hi = c.moves.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.moves[mid]! <= lastMove) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 이동 i 위에서 f(0~1) 자리의 점: 직선은 시작·끝 사이, 원호는 장면이 호를 나눌 때와 같은 식(각·반지름·직선 축을 f만큼) */
export function movePointAt(nc: SnapMoves, i: number, f: number): [number, number, number] | null {
  const m = nc.moves;
  if (i < 0 || i >= m.count) return null;
  const p = m.points;
  const o = i * 3;
  const s = [p[o]!, p[o + 1]!, p[o + 2]!];
  const e = [p[o + 3]!, p[o + 4]!, p[o + 5]!];
  const ai = m.kind[i] === MOVE_ARC ? m.arc[i]! : -1;
  if (ai < 0) return [s[0]! + (e[0]! - s[0]!) * f, s[1]! + (e[1]! - s[1]!) * f, s[2]! + (e[2]! - s[2]!) * f];
  const a = nc.arcs;
  const [a0, a1, a2] = PLANE_AXES[a.plane[ai]!] ?? PLANE_AXES[0]!;
  const cx = a.center[ai * 3 + a0]!;
  const cy = a.center[ai * 3 + a1]!;
  const u0 = s[a0]! - cx;
  const v0 = s[a1]! - cy;
  const r0 = Math.hypot(u0, v0);
  const r1 = Math.hypot(e[a0]! - cx, e[a1]! - cy);
  const t = Math.atan2(v0, u0) + a.sweep[ai]! * f;
  const r = r0 + (r1 - r0) * f;
  const q: [number, number, number] = [0, 0, 0];
  q[a0] = cx + r * Math.cos(t);
  q[a1] = cy + r * Math.sin(t);
  q[a2] = s[a2]! + (e[a2]! - s[a2]!) * f;
  return q;
}

/**
 * 고른 것(Pick3d)에서 더할 붙잡기 점: NC 공구 경로 선분이면 그 이동의 가운데 점(원호는 호 위), 원호면 중심도.
 * 길이가 없는 이동이나 공구 경로가 아닌 것(보정 경로·회전축·공작물·구멍 점 등)은 null
 */
export function moveSnapPoints(pick: Pick3d, nc: SnapMoves): SnapPoint[] | null {
  if (pick.kind !== 'line' || !PATH_SET.test(pick.id)) return null;
  const i = pick.index;
  const m = nc.moves;
  if (!(i >= 0 && i < m.count)) return null;
  const p = m.points;
  const o = i * 3;
  const out: SnapPoint[] = [];
  const arc = m.kind[i] === MOVE_ARC && m.arc[i]! >= 0;
  const len = Math.hypot(p[o + 3]! - p[o]!, p[o + 4]! - p[o + 1]!, p[o + 5]! - p[o + 2]!);
  // 시작·끝이 같은 원호(한 바퀴)는 가운데 점이 반대편에 있다 — 길이 0인 직선만 뺀다
  if (arc || len > 1e-9) {
    const mid = movePointAt(nc, i, 0.5);
    if (mid) out.push({ point: mid, kind: 'midpoint' });
  }
  if (arc) {
    const ai = m.arc[i]!;
    const c = nc.arcs.center;
    out.push({ point: [c[ai * 3]!, c[ai * 3 + 1]!, c[ai * 3 + 2]!], kind: 'center' });
  }
  return out.length ? out : null;
}

/** 붙잡은 종류 → 이름(번역층이 옮긴다). 붙잡지 않은 점(선·면 위 아무 자리)은 '붙잡지 않은 점'. 축 방향은 축을 알면 'X축 방향'처럼 */
export function snapLabel(kind: SnapKind | null | undefined, axis?: 'x' | 'y' | 'z' | null): string {
  switch (kind) {
    case 'vertex':
      return '꼭짓점';
    case 'endpoint':
      return '끝점';
    case 'midpoint':
      return '가운데 점';
    case 'center':
      return '중심';
    case 'point':
      return '붙잡은 점';
    case 'intersection':
      return '교차점';
    case 'perpendicular':
      return '수직 발';
    case 'axis':
      return axis === 'x' ? 'X축 방향' : axis === 'y' ? 'Y축 방향' : axis === 'z' ? 'Z축 방향' : '축 방향';
    default:
      return '붙잡지 않은 점';
  }
}

/** 축 방향으로 붙잡은 둘째 점의 축: 첫 점에서 한 축으로만 움직였으면 그 축(코어 결과에는 축이 없어 dx·dy·dz로 가린다) */
export function measureAxis(m: { dx: number; dy: number; dz: number }): 'x' | 'y' | 'z' | null {
  const d = [Math.abs(m.dx), Math.abs(m.dy), Math.abs(m.dz)];
  const k = d.indexOf(Math.max(...d));
  if (!(d[k]! > 0)) return null;
  // 나머지 두 축이 큰 축의 1e-6 안이면 그 축 방향
  return d.every((v, i) => i === k || v <= d[k]! * 1e-6) ? (['x', 'y', 'z'] as const)[k]! : null;
}

/** 측정 결과의 두 점 붙잡기 이름(붙잡기를 켠 결과 — snapA·snapB가 있을 때만, 둘 다 붙잡지 않았으면 null) */
export function snapPair(m: { snapA?: SnapKind | null; snapB?: SnapKind | null; dx?: number; dy?: number; dz?: number }): [string, string] | null {
  if (m.snapA === undefined && m.snapB === undefined) return null;
  if (!m.snapA && !m.snapB) return null;
  // 축 방향은 둘째 점만(첫 점에서 축을 따라 간 점)
  const axis = m.snapB === 'axis' && m.dx !== undefined ? measureAxis({ dx: m.dx, dy: m.dy ?? 0, dz: m.dz ?? 0 }) : null;
  return [snapLabel(m.snapA), snapLabel(m.snapB, axis)];
}
