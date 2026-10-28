/**
 * 측정 붙잡기 다듬기(3D 뷰어 코어 0.14.0 setMeasureSnap({ refine }) — 측정 도구 조각, 순수 함수).
 *
 * 장면은 원호(G2/G3·나선, 판재 윤곽 호, 반경 보정 경로의 호)와 스플라인(G5·G5.1·G5.2/G5.3)을 짧은 직선 토막으로 그리므로
 * 코어가 고른 수직 발('perpendicular' — 첫 점에서 커서 둘레 토막으로 내린 발), 붙잡지 않은 토막 위 점('onEdge'),
 * 코어 토막 가운데 점('midpoint' — 이 앱은 코어 midpoints를 켜지 않아 오지 않지만 받으면)은 토막 위, 곧 곡선에서 처짐만큼 안쪽에 찍힌다.
 * 여기서 그 토막이 놓인 곡선을 찾아 정확한 곡선 위 점으로 옮긴다(받을지는 코어가 화면 붙잡기 거리로 정한다).
 * - 곡선 찾기: NC 공구 경로 토막(선분 묶음 nc-cut-…)은 이동 번호(segmentIds)로 원호 이동이나 스플라인 조각(해석기 스플라인 표),
 *   보정 경로(nc-comp)는 그 이동의 보정 조각 가운데 토막 두 끝이 놓인 호, 판재는 붙잡기 표(`${묶음 id}#${번호}`)의 요소 가운데 토막 두 끝이
 *   놓인 호. 판 외곽선·포켓 둘레는 그물 윤곽선(위·아래 고리)이라 그물 id로 붙잡기 표의 둘레 호(outlines)에서 찾는다.
 *   토막 두 끝이 곡선 위(장면 float32 반올림 안)가 아니면 다듬지 않는다(직선·다른 모양)
 * - 찾는 범위: 코어 점의 곡선 위 자리 둘레(원호는 양옆 토막 둘씩, 스플라인은 그 조각과 양옆 조각) — 구간 나눔으로 시작값을 고르고 뉴턴(curve.ts)
 * - 수직 발: 첫 점에서 곡선에 내린 발 가운데 코어 발에 가장 가까운 것(첫 점이 원의 축 위 — 원 중심 등 — 이면 어디나 발이라 코어 점에 가장 가까운 곡선 위 점).
 *   발이 그 범위에 없으면(곡선 끝 밖) 코어 점 그대로. 종류·토막·코어 점·첫 점으로만 정하고 커서 광선은 쓰지 않는다
 *   (코어 0.15.0의 열린 수직 발 — 코어 점이 토막 끝으로 자른 점 — 도 같은 식으로 풀린다)
 * - 모르는 종류(코어가 뒤에 더하는 교차점 등)는 null — 코어 점 그대로
 * - 토막 위 점: 커서 광선에 가장 가까운 곡선 위 점. 토막 가운데 점: 토막 두 끝 매개변수 가운데의 곡선 위 점
 * 결과는 넘긴 값(종류·점·토막·첫 점·광선)과 문서 자료로만 정해진다(코어가 같은 입력이면 다시 부르지 않는다).
 */
import type { MeasureSnapOptions, SnapRefineInput } from 'opencad-viewer3d';
import { MOVE_ARC, PLANE_AXES } from '../model';
import type { PanelSnapTable } from '../scene';
import { MEASURE_INFERENCE } from './measure';
import { closestToRay, footsFrom, nearestOn, type Curve, type V3 } from './curve';
import { arcCurve, arcShape, panelArcsOf, pointTol, shapeNearest, shapeOf, type ArcShape } from './tangent';
import { splineCurve, splineOfMove } from './spline';
import { moveSnapPoints, panelCenters, panelSnapPoints, type ArcCenters, type SnapMoves } from './snap';

/** 장면의 기본 호 나누기 각(scene.ts — 판재 장면은 늘 이것, NC 장면은 meta.arcAngle) */
const ARC_ANGLE = Math.PI / 36;

/** 곡선과 다듬기를 찾을 매개변수 범위 */
interface Target {
  c: Curve;
  lo: number;
  hi: number;
}

/** 원호 모양 g 위에 토막 두 끝이 있으면(장면 반올림 안) 코어 점 둘레(양옆 토막 둘씩)의 범위 */
function arcTarget(g: ArcShape, ends: readonly (readonly number[])[], point: readonly number[], maxAngle: number): Target | null {
  for (const e of ends) if (shapeNearest(g, e).dist > 4 * pointTol(e)) return null;
  const n = Math.max(1, Math.min(4096, Math.ceil(Math.abs(g.sweep) / Math.max(1e-4, maxAngle) - 1e-9)));
  const f0 = shapeNearest(g, point).f;
  return { c: arcCurve(g), lo: Math.max(0, f0 - 2 / n), hi: Math.min(1, f0 + 2 / n) };
}

/** NC 공구 경로 토막(이동 i)이 놓인 곡선: 원호 이동이면 그 원호, 스플라인 조각이면 그 곡선(그 조각과 양옆 조각) */
function ncTarget(nc: SnapMoves, i: number, ends: readonly (readonly number[])[], point: readonly number[], maxAngle: number): Target | null {
  const m = nc.moves;
  if (!(i >= 0 && i < m.count)) return null;
  if (m.kind[i] === MOVE_ARC) {
    const g = arcShape(nc, i);
    return g && arcTarget(g, ends, point, maxAngle);
  }
  const k = splineOfMove(nc.splines, i);
  if (k < 0) return null;
  const c = splineCurve(nc.splines!, k, m.points);
  if (!c) return null;
  const j = i - c.move;
  return { c, lo: c.piece(Math.max(0, j - 1))[0], hi: c.piece(Math.min(c.moves - 1, j + 1))[1] };
}

/** 보정 경로 토막(이동 i의 보정 조각 가운데 토막 두 끝이 놓인 호) */
function compTarget(nc: SnapMoves, i: number, ends: readonly (readonly number[])[], point: readonly number[], maxAngle: number): Target | null {
  const c = nc.comp;
  if (!c) return null;
  let lo = 0;
  let hi = c.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.move[mid]! < i) lo = mid + 1;
    else hi = mid;
  }
  for (let k = lo; k < c.count && c.move[k] === i; k++) {
    if (c.kind[k] !== 1 || !c.sweep[k]) continue;
    const [a0, a1, a2] = PLANE_AXES[c.plane[k]!] ?? PLANE_AXES[0]!;
    const o = k * 6;
    const g = shapeOf(
      [c.points[o]!, c.points[o + 1]!, c.points[o + 2]!],
      [c.points[o + 3]!, c.points[o + 4]!, c.points[o + 5]!],
      a0,
      a1,
      a2,
      c.center[k * 3 + a0]!,
      c.center[k * 3 + a1]!,
      c.sweep[k]!,
    );
    const t = g && arcTarget(g, ends, point, maxAngle);
    if (t) return t;
  }
  return null;
}

/** 판재 윤곽 토막(붙잡기 표의 요소 가운데 토막 두 끝이 놓인 호 — 윤곽 선분 묶음, 판 외곽선·포켓 둘레의 그물 윤곽선) */
function panelTarget(t: PanelSnapTable, key: string, ends: readonly (readonly number[])[], point: readonly number[]): Target | null {
  for (const g of panelArcsOf(t, key)) {
    const r = arcTarget(g, ends, point, ARC_ANGLE);
    if (r) return r;
  }
  return null;
}

/**
 * 코어가 고른 점(c)을 곡선 위로 다듬은 세계 점. 다듬을 곡선이 없으면(직선·모르는 묶음·발이 곡선 밖) null — 코어 점 그대로.
 * src = NC 이동(원호·스플라인·보정 경로)이나 판재 붙잡기 표, arcAngle = 장면이 쓴 호 나누기 각(scene.meta.arcAngle)
 */
export function refineSnap(c: SnapRefineInput, src: SnapMoves | PanelSnapTable, arcAngle = ARC_ANGLE): V3 | null {
  // 아는 종류만 푼다 — 코어가 뒤에 더하는 종류(예: 교차점)는 코어 점 그대로(모서리 위 점처럼 풀지 않는다)
  const kind = c.kind as string;
  if (kind !== 'onEdge' && kind !== 'midpoint' && kind !== 'perpendicular') return null;
  const s = c.segment;
  const ends = s.ends;
  let t: Target | null = null;
  if ('moves' in src) {
    if (s.kind !== 'line') return null;
    if (/^nc-cut-/.test(s.id)) t = ncTarget(src, s.index, ends, c.point, arcAngle);
    else if (s.id === 'nc-comp') t = compTarget(src, s.index, ends, c.point, arcAngle);
  } else t = panelTarget(src, s.kind === 'edge' ? `edge:${s.id}` : `${s.id}#${s.index}`, ends, c.point);
  if (!t) return null;
  const { c: curve, lo, hi } = t;
  switch (kind) {
    case 'onEdge':
      return curve.at(closestToRay(curve, c.ray.origin, c.ray.dir, lo, hi).u);
    case 'midpoint': {
      const a = nearestOn(curve, ends[0], lo, hi).u;
      const b = nearestOn(curve, ends[1], lo, hi).u;
      return curve.at((a + b) / 2);
    }
    default:
      return footOn(curve, c.point, c.first, lo, hi);
  }
}

/**
 * 수직 발: 첫 점에서 곡선에 내린 발 가운데 코어 점(토막 위 발 — 발이 토막 밖이면 토막 끝으로 자른 점)에 가장 가까운 것.
 * 종류·토막·코어 점·첫 점만으로 정한다(커서 광선은 쓰지 않는다 — 코어 0.15.0의 열린 수직 발도 같은 식). 첫 점이 원의 축 위(중심 등)면
 * 곡선 위 어디나 발이라 코어 점에 가장 가까운 곡선 위 점. 발이 범위에 없으면 null
 */
function footOn(curve: Curve, point: readonly number[], first: readonly number[] | null, lo: number, hi: number): V3 | null {
  if (!first) return null;
  const ds = [lo, (lo + hi) / 2, hi].map((u) => {
    const p = curve.at(u);
    return Math.hypot(p[0] - first[0]!, p[1] - first[1]!, p[2] - first[2]!);
  });
  if (Math.max(...ds) - Math.min(...ds) <= 1e-9 * (1 + Math.max(...ds))) return curve.at(nearestOn(curve, point, lo, hi).u);
  let best: V3 | null = null;
  let bestD = Infinity;
  for (const u of footsFrom(curve, first, lo, hi)) {
    const p = curve.at(u);
    const d = Math.hypot(p[0] - point[0]!, p[1] - point[1]!, p[2] - point[2]!);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * 앱(app.ts syncMeasureSnap)이 NC 문서를 재는 동안 코어에 주는 붙잡기 선택: 원호 중심(늘 후보 — 재생 중 한도), 고른 이동의 가운데 점·중심
 * (snap.ts moveSnapPoints), 추론 붙잡기, 곡선 위로 다듬기(refineSnap). 시험도 같은 것을 쓴다
 */
export function ncSnapOptions(nc: SnapMoves, centers: ArcCenters, limit: number | null = null, arcAngle?: number): MeasureSnapOptions {
  return { points: centers.points, pointsFor: (p) => moveSnapPoints(p, nc), inference: MEASURE_INFERENCE, limit, refine: (c) => refineSnap(c, nc, arcAngle) };
}

/**
 * 판재(MPR·PGI·XML) 문서의 붙잡기 선택: 윤곽·판 외곽선의 원호 중심·원형 포켓 중심, 고른 윤곽 요소(판 외곽선·포켓 둘레의 호 포함)의
 * 가운데 점·중심, 추론 붙잡기, 호 위로 다듬기. 측정 중에는 그물 윤곽선(판·포켓·홈·구멍의 모서리 — 이미 그려 둔 선)도 고른다(edges)
 */
export function panelSnapOptions(t: PanelSnapTable): MeasureSnapOptions {
  return { points: panelCenters(t), pointsFor: (p) => panelSnapPoints(p, t), inference: MEASURE_INFERENCE, edges: true, refine: (c) => refineSnap(c, t) };
}
