/**
 * 두 점 측정의 붙잡기 점(순수 함수, DOM 없음 — 코어 Viewer3d.setMeasureSnap에 준다).
 *
 * - 원호 중심: 해석기가 호 표(arcs.center)에 둔 G2/G3 중심을 그대로 쓴다(장면 좌표가 곧 세계 좌표 — NC 장면은 묶음 원점·행렬이 없다).
 *   커서가 중심 자리(빈 곳)에 와야 붙으므로 늘 후보(points)로 주고, 그 호가 그려진 선분 묶음 id를 달아 숨긴 공구·단면을 따르게 한다.
 *   재생 중에는 아직 그리지 않은 이동의 중심을 빼도록 점마다 처음 그린 이동 번호를 차례(order)로 두고, 코어 붙잡기 한도
 *   (setMeasureSnapLimit, 0.10.0)로 거른다 — 재생 자리가 바뀌어도 점 목록·색인을 다시 주지 않는다.
 * - 이동 가운데 점(pointsFor): 고른 선분의 이동 번호(segmentIds)로 그 G0·G1·드릴 이동의 가운데, 원호는 현이 아니라 호 위의 가운데 점
 *   (장면이 호를 나눌 때와 같은 식 — 각·반지름·직선 축을 반씩). 장면은 호를 짧은 선분 여럿으로 그리므로 코어의 선분 가운데 점
 *   (midpoints)은 그 조각의 가운데일 뿐이라 쓰지 않는다.
 * - 보정 경로(공구 중심, 'nc-comp'): 선분의 이동 번호가 프로그램 이동과 같아도 모양이 달라, 워커가 보낸 보정 조각(NcPayload.comp) 가운데
 *   그 이동의 조각 중 고른 점에 가장 가까운 것의 가운데 점(호는 호 위)과 호 중심을 준다.
 * - 판재 가공(MPR·PGI·XML): 워커가 장면과 같은 묶음 id로 만든 붙잡기 표(PanelSnapTable)에서 윤곽·판 외곽선의 원호 중심·원형 포켓 중심을
 *   늘 후보로, 고른 윤곽 선분은 그 요소(직선·호)의 가운데 점과 호 중심을 준다.
 * - 추론 붙잡기(코어 0.9.0 inference — 교차점·수직 발·축 방향)는 코어가 장면 선분으로 찾는다. 축 방향의 축은 코어 결과의 axisA·axisB(0.9.1)를 쓴다.
 */
import type { SnapAxis } from 'opencad-viewer3d/inference';
import type { Pick3d, SnapKind, SnapPoint } from 'opencad-viewer3d/types';
import { MOVE_ARC, PLANE_AXES, ncPathSetId } from '../model';
import type { PanelSnapTable } from '../scene';
import type { NcCompSnap } from './protocol';

/** 붙잡기 점 계산에 쓰는 NC 자료(NcPayload의 일부) */
export interface SnapMoves {
  moves: { count: number; kind: Uint8Array; points: Float64Array; tool: Int32Array; flags: Uint16Array; arc: Int32Array };
  arcs: { center: Float64Array; plane: Uint8Array; sweep: Float64Array };
  /** 반경 보정 경로 조각(그렸을 때만) */
  comp?: NcCompSnap;
}

type V3 = [number, number, number];
const TAU = Math.PI * 2;

/**
 * 요소(직선·호) 위 f(0~1) 자리: 호는 평면 축(a0·a1) 위 중심(cu·cv)에서 각·반지름을 f만큼, 남은 축(a2)은 직선으로
 * (장면이 호를 나눌 때와 같은 식). sweep이 0이면 직선
 */
function elementAt(s: ArrayLike<number>, e: ArrayLike<number>, cu: number, cv: number, sweep: number, plane: readonly number[], f: number): V3 {
  if (!sweep) return [s[0]! + (e[0]! - s[0]!) * f, s[1]! + (e[1]! - s[1]!) * f, s[2]! + (e[2]! - s[2]!) * f];
  const [a0, a1, a2] = plane as [number, number, number];
  const r0 = Math.hypot(s[a0]! - cu, s[a1]! - cv);
  const r1 = Math.hypot(e[a0]! - cu, e[a1]! - cv);
  const t = Math.atan2(s[a1]! - cv, s[a0]! - cu) + sweep * f;
  const r = r0 + (r1 - r0) * f;
  const q: V3 = [0, 0, 0];
  q[a0] = cu + r * Math.cos(t);
  q[a1] = cv + r * Math.sin(t);
  q[a2] = s[a2]! + (e[a2]! - s[a2]!) * f;
  return q;
}

/** 점 p에서 요소까지 거리(직선은 선분, 호는 p의 각 자리 — 호 밖이면 가까운 끝) */
function elementDistance(p: ArrayLike<number>, s: ArrayLike<number>, e: ArrayLike<number>, cu: number, cv: number, sweep: number, plane: readonly number[]): number {
  let f: number;
  if (!sweep) {
    const d = [e[0]! - s[0]!, e[1]! - s[1]!, e[2]! - s[2]!];
    const l2 = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
    f = l2 > 0 ? Math.max(0, Math.min(1, ((p[0]! - s[0]!) * d[0]! + (p[1]! - s[1]!) * d[1]! + (p[2]! - s[2]!) * d[2]!) / l2)) : 0;
  } else {
    const [a0, a1] = plane as [number, number];
    const a = Math.atan2(p[a1]! - cv, p[a0]! - cu) - Math.atan2(s[a1]! - cv, s[a0]! - cu);
    const d = (((sweep >= 0 ? a : -a) % TAU) + TAU) % TAU;
    f = d / Math.abs(sweep);
    // 호 밖: 가까운 끝(시작 쪽으로 넘었는지 끝 쪽으로 넘었는지는 남은 각의 가운데로 가른다)
    if (f > 1) f = d - Math.abs(sweep) < (TAU - Math.abs(sweep)) / 2 ? 1 : 0;
  }
  const q = elementAt(s, e, cu, cv, sweep, plane, f);
  return Math.hypot(p[0]! - q[0], p[1]! - q[1], p[2]! - q[2]);
}

/** 원호 중심 붙잡기 점과 그 점을 처음 만든 이동 번호(오름차순) */
export interface ArcCenters {
  points: SnapPoint[];
  moves: Uint32Array;
}

/** 장면 묶음 가운데 이동 가운데 점을 주는 것(보정 경로 'nc-comp'는 이동 번호가 같아도 모양이 달라 보정 조각으로 따로 — compSnapPoints) */
const PATH_SET = /^nc-(?:cut|drill)-|^nc-(?:rapid|machine)$/;

/**
 * 모든 원호 이동의 중심 → 붙잡기 점(kind 'center', id = 그 호의 선분 묶음, order = 처음 그린 이동 번호). 같은 묶음 안 같은 자리 중심(여러 바퀴 나선·나눈 원 등)은
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
    // 차례 = 그 중심을 처음 그린 이동 번호(재생 중 코어 붙잡기 한도로 거른다)
    points.push({ point: [x, y, z], kind: 'center', id, order: i });
    at.push(i);
  }
  return { points, moves: Uint32Array.from(at) };
}

/** 재생 중 그린 이동이 lastMove까지일 때 붙잡는 중심 수(그 이동까지 처음 나온 중심 — 코어 한도 lastMove + 1로 거른 것과 같다). lastMove가 없으면 모두 */
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

/** 보정 경로에서 고른 선분(이동 번호 pick.index)의 조각 가운데 고른 점에 가장 가까운 것의 가운데 점(호는 호 위)과 호 중심 */
export function compSnapPoints(pick: Pick3d, c: NcCompSnap): SnapPoint[] | null {
  const m = pick.index;
  // 이동 번호(오름차순)에서 그 이동의 조각 범위
  let lo = 0;
  let hi = c.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.move[mid]! < m) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = lo; i < c.count && c.move[i] === m; i++) {
    const k = i * 6;
    const s = [c.points[k]!, c.points[k + 1]!, c.points[k + 2]!];
    const e = [c.points[k + 3]!, c.points[k + 4]!, c.points[k + 5]!];
    const pl = PLANE_AXES[c.plane[i]!] ?? PLANE_AXES[0]!;
    const arc = c.kind[i] === 1 ? c.sweep[i]! : 0;
    const d = elementDistance(pick.point, s, e, c.center[i * 3 + pl[0]]!, c.center[i * 3 + pl[1]]!, arc, pl);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const k = best * 6;
  const s = [c.points[k]!, c.points[k + 1]!, c.points[k + 2]!];
  const e = [c.points[k + 3]!, c.points[k + 4]!, c.points[k + 5]!];
  const pl = PLANE_AXES[c.plane[best]!] ?? PLANE_AXES[0]!;
  const arc = c.kind[best] === 1 ? c.sweep[best]! : 0;
  if (!arc && Math.hypot(e[0]! - s[0]!, e[1]! - s[1]!, e[2]! - s[2]!) <= 1e-9) return null;
  const out: SnapPoint[] = [{ point: elementAt(s, e, c.center[best * 3 + pl[0]]!, c.center[best * 3 + pl[1]]!, arc, pl, 0.5), kind: 'midpoint' }];
  if (arc) out.push({ point: [c.center[best * 3]!, c.center[best * 3 + 1]!, c.center[best * 3 + 2]!], kind: 'center' });
  return out;
}

/** 판재 붙잡기 표의 늘 후보인 중심(윤곽·판 외곽선의 원호, 원형 포켓) */
export function panelCenters(t: PanelSnapTable): SnapPoint[] {
  const out: SnapPoint[] = [];
  const c = t.centers;
  for (let i = 0; i < t.centerIds.length; i++) out.push({ point: [c[i * 3]!, c[i * 3 + 1]!, c[i * 3 + 2]!], kind: 'center', id: t.centerIds[i]! });
  return out;
}

const XY = [0, 1, 2] as const;

/** 판재에서 고른 윤곽 선분 → 그 요소(고른 점에 가장 가까운 직선·호)의 가운데 점(호는 호 위)과 호 중심. 표에 없는 것(구멍·홈·띠 등)은 null */
export function panelSnapPoints(pick: Pick3d, t: PanelSnapTable): SnapPoint[] | null {
  if (pick.kind !== 'line') return null;
  const el = t.paths.get(`${pick.id}#${pick.index}`);
  if (!el) return null;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i + 9 <= el.length; i += 9) {
    const d = elementDistance(pick.point, el.subarray(i, i + 3), el.subarray(i + 3, i + 6), el[i + 6]!, el[i + 7]!, el[i + 8]!, XY);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const s = el.subarray(best, best + 3);
  const e = el.subarray(best + 3, best + 6);
  const sweep = el[best + 8]!;
  if (!sweep && Math.hypot(e[0]! - s[0]!, e[1]! - s[1]!, e[2]! - s[2]!) <= 1e-9) return null;
  const out: SnapPoint[] = [{ point: elementAt(s, e, el[best + 6]!, el[best + 7]!, sweep, XY, 0.5), kind: 'midpoint' }];
  if (sweep) out.push({ point: [el[best + 6]!, el[best + 7]!, (s[2]! + e[2]!) / 2], kind: 'center' });
  return out;
}

/**
 * 고른 것(Pick3d)에서 더할 붙잡기 점: NC 공구 경로 선분이면 그 이동의 가운데 점(원호는 호 위), 원호면 중심도.
 * 보정 경로('nc-comp')는 보정 조각에서(compSnapPoints). 길이가 없는 이동이나 공구 경로가 아닌 것(회전축·공작물·구멍 점 등)은 null
 */
export function moveSnapPoints(pick: Pick3d, nc: SnapMoves): SnapPoint[] | null {
  if (pick.kind === 'line' && pick.id === 'nc-comp') return nc.comp ? compSnapPoints(pick, nc.comp) : null;
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
export function snapLabel(kind: SnapKind | null | undefined, axis?: SnapAxis | null): string {
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
    case 'parallel':
      return '나란한 방향';
    default:
      return '붙잡지 않은 점';
  }
}

/** 원호 접선으로 잠근 선 위의 점 이름(측정 툴팁·결과 — 코어 종류는 나란함) */
export const TANGENT_LABEL = '접선 방향';

/**
 * 측정 결과의 두 점 붙잡기 이름(붙잡기를 켠 결과 — snapA·snapB가 있을 때만, 둘 다 붙잡지 않았으면 null).
 * 축 방향은 코어가 준 축(axisA·axisB, 코어 0.9.1 — 축 붙잡기는 첫 점을 찍은 뒤에만이라 지금은 둘째 점만)으로 'Y축 방향'처럼.
 * 셋째 값은 둘째 점을 잠근 선 위에 찍었는지(코어 0.10.0 lockedB — Shift·화살표·잠금 단추).
 * tangentB = 앱이 둘째 점을 원호 접선 잠금으로 찍었다고 표시한 결과(app.ts — 코어 종류는 나란함이라 이름만 접선 방향으로)
 */
export function snapPair(m: { snapA?: SnapKind | null; snapB?: SnapKind | null; axisA?: SnapAxis; axisB?: SnapAxis; lockedB?: boolean; tangentB?: boolean }): [string, string, boolean] | null {
  if (m.snapA === undefined && m.snapB === undefined) return null;
  if (!m.snapA && !m.snapB) return null;
  return [snapLabel(m.snapA, m.axisA), m.tangentB && m.lockedB ? TANGENT_LABEL : snapLabel(m.snapB, m.axisB), !!m.lockedB];
}
