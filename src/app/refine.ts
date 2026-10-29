/**
 * 측정 붙잡기 다듬기(3D 뷰어 코어 0.14.0·0.15.0 setMeasureSnap({ refine }) — 측정 도구 조각, 순수 함수).
 *
 * 장면은 원호(G2/G3·나선, 판재 윤곽 호, 반경 보정 경로의 호, 구멍 테두리)와 스플라인(G5·G5.1·G5.2/G5.3)을 짧은 직선 토막으로 그리므로
 * 코어가 고른 수직 발('perpendicular' — 첫 점에서 커서 둘레 토막으로 내린 발), 붙잡지 않은 토막 위 점('onEdge'),
 * 코어 토막 가운데 점('midpoint' — 이 앱은 코어 midpoints를 켜지 않아 오지 않지만 받으면), 두 토막의 교차점('intersection' — 0.15.0)은
 * 토막 위, 곧 곡선에서 처짐만큼 안쪽에 찍힌다. 여기서 그 토막이 놓인 곡선을 찾아 정확한 곡선 위 점으로 옮긴다(받을지는 코어가 화면 붙잡기 거리로 정한다).
 * - 곡선 찾기: NC 공구 경로 토막(선분 묶음 nc-cut-…)은 이동 번호(segmentIds)로 원호 이동이나 스플라인 조각(해석기 스플라인 표),
 *   보정 경로(nc-comp)는 그 이동의 보정 조각 가운데 토막 두 끝이 놓인 호, 판재는 붙잡기 표(`${묶음 id}#${번호}`)의 요소 가운데 토막 두 끝이
 *   놓인 호. 판 외곽선·포켓 둘레·구멍 테두리는 그물 윤곽선(위·아래 고리)이라 그물 id로 붙잡기 표의 둘레 호(outlines — 평면·나눈 각은 outlineForms)에서 찾는다.
 *   토막 두 끝이 곡선 위(장면 float32 반올림 안)가 아니면 다듬지 않는다(직선·다른 모양)
 * - 찾는 범위: 코어 점의 곡선 위 자리 둘레(원호는 양옆 토막 둘씩, 스플라인은 그 조각과 양옆 조각) — 구간 나눔으로 시작값을 고르고 뉴턴(curve.ts)
 * - 수직 발: 첫 점에서 곡선에 내린 발 가운데 코어 발에 가장 가까운 것(첫 점이 원의 축 위 — 원 중심 등 — 이면 어디나 발이라 코어 점에 가장 가까운 곡선 위 점).
 *   발이 그 범위에 없으면(곡선 끝 밖) null. 종류·토막·코어 점·첫 점으로만 정하고 커서 광선은 쓰지 않는다
 *   (코어 0.15.0의 열린 수직 발 — 첫 점에서 토막에 내린 발이 토막 밖이라 코어 점이 토막 끝 — 도 같은 식으로 풀린다)
 * - 토막 위 점: 커서 광선에 가장 가까운 곡선 위 점. 토막 가운데 점: 토막 두 끝 매개변수 가운데의 곡선 위 점
 * - 교차점(17차): 두 토막이 놓인 요소(원호·스플라인과 곧은 요소 — 직선 이동·보정 경로의 직선 조각·판재 윤곽의 직선 요소, 둘레 호를 적은 그물의 곧은 모서리)의
 *   정확한 3D 교차점(intersect.ts). 허용치 tol = 1e-6 × (1 + 좌표 크기 + 두 토막 길이 합) — 그보다 떨어져 지나가면 null
 * - 모르는 종류는 null — 코어 점 그대로
 * 결과는 넘긴 값(종류·점·토막·첫 점·광선)과 문서 자료로만 정해진다(코어가 같은 입력이면 다시 부르지 않는다).
 */
import type { MeasureSnapOptions, SnapRefineInput, SnapSegment } from 'opencad-viewer3d';
import { MOVE_ARC, PLANE_AXES, ncPathSetId } from '../model';
import type { PanelSnapTable } from '../scene';
import { MEASURE_INFERENCE } from './measure';
import { closestToRay, footsFrom, nearestOn, type Curve, type V3 } from './curve';
import { dist3, intersectSides, lineSide, type Side } from './intersect';
import { arcCurve, arcShape, panelArcsOf, pointTol, shapeChords, shapeNearest, shapeOf, type ArcShape } from './tangent';
import { splineCurve, splineNearest, splineOfMove } from './spline';
import { moveSnapPoints, panelCenters, panelSnapPoints, type ArcCenters, type SnapMoves } from './snap';

/** 장면의 기본 호 나누기 각(scene.ts — 판재 장면은 늘 이것, NC 장면은 meta.arcAngle) */
const ARC_ANGLE = Math.PI / 36;

type Ends = readonly (readonly number[])[];

/**
 * 원호 모양 g 위에 토막 두 끝이 있으면(장면 반올림 안) 그 요소: 찾기 범위는 코어 점 둘레(양옆 토막 둘씩 — 나눈 각은 모양에 적힌 각, 없으면 maxAngle).
 * 평면 위의 고른 원호면 원(교차점을 식으로)
 */
function arcSide(g: ArcShape, ends: Ends, point: readonly number[], maxAngle: number, key: string): Side | null {
  for (const e of ends) if (shapeNearest(g, e).dist > 4 * pointTol(e)) return null;
  const n = shapeChords(g, maxAngle);
  const f0 = shapeNearest(g, point).f;
  const s: V3 = [g.s[0]!, g.s[1]!, g.s[2]!];
  const e: V3 = [g.e[0]!, g.e[1]!, g.e[2]!];
  const side: Side = { c: arcCurve(g), lo: Math.max(0, f0 - 2 / n), hi: Math.min(1, f0 + 2 / n), key, ends: [s, e], dist: (p) => shapeNearest(g, p).dist };
  if (Math.abs(e[g.a2] - s[g.a2]) <= 1e-9 * (1 + Math.abs(s[g.a2])) && Math.abs(g.r1 - g.r0) <= 1e-9 * (1 + g.r0)) {
    const c: V3 = [0, 0, 0];
    c[g.a0] = g.cu;
    c[g.a1] = g.cv;
    c[g.a2] = s[g.a2];
    const nv: V3 = [0, 0, 0];
    nv[g.a2] = 1;
    side.circle = { c, n: nv, r: g.r0 };
  }
  return side;
}

/** 곧은 요소 a → b 위에 토막 두 끝이 있으면(장면 반올림 안) 그 요소 */
function straightSide(a: V3, b: V3, ends: Ends, key: string): Side | null {
  const s = lineSide(a, b, key);
  if (!s) return null;
  for (const e of ends) if (s.dist(e) > 4 * pointTol(e)) return null;
  return s;
}

/**
 * NC 공구 경로 토막(이동 i)이 놓인 요소: 원호 이동이면 그 원호, 스플라인 조각이면 그 곡선(찾기 범위는 그 조각과 양옆 조각).
 * lines면 곧은 이동(이송·급속·드릴 — 그 이동이 그려지는 묶음의 토막)도
 */
function ncSide(nc: SnapMoves, s: SnapSegment, point: readonly number[], maxAngle: number, lines: boolean): Side | null {
  const m = nc.moves;
  const i = s.index;
  if (!(i >= 0 && i < m.count)) return null;
  if (/^nc-cut-/.test(s.id)) {
    if (m.kind[i] === MOVE_ARC) {
      const g = arcShape(nc, i);
      return g && arcSide(g, s.ends, point, maxAngle, `m${i}`);
    }
    const k = splineOfMove(nc.splines, i);
    if (k >= 0) {
      const c = splineCurve(nc.splines!, k, m.points);
      if (!c) return null;
      const j = i - c.move;
      return {
        c,
        lo: c.piece(Math.max(0, j - 1))[0],
        hi: c.piece(Math.min(c.moves - 1, j + 1))[1],
        key: `s${k}`,
        ends: [c.at(c.lo), c.at(c.hi)],
        dist: (p) => splineNearest(c, p, m.points).dist,
      };
    }
  }
  if (!lines || m.kind[i] === MOVE_ARC || ncPathSetId(m.kind[i]!, m.flags[i]!, m.tool[i]!) !== s.id) return null;
  const p = m.points;
  const o = i * 3;
  return straightSide([p[o]!, p[o + 1]!, p[o + 2]!], [p[o + 3]!, p[o + 4]!, p[o + 5]!], s.ends, `m${i}`);
}

/** 보정 경로 토막(이동 i의 보정 조각 가운데 토막 두 끝이 놓인 호 — lines면 직선 조각도) */
function compSide(nc: SnapMoves, s: SnapSegment, point: readonly number[], maxAngle: number, lines: boolean): Side | null {
  const c = nc.comp;
  if (!c) return null;
  const i = s.index;
  let lo = 0;
  let hi = c.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.move[mid]! < i) lo = mid + 1;
    else hi = mid;
  }
  for (let k = lo; k < c.count && c.move[k] === i; k++) {
    const o = k * 6;
    const a: V3 = [c.points[o]!, c.points[o + 1]!, c.points[o + 2]!];
    const b: V3 = [c.points[o + 3]!, c.points[o + 4]!, c.points[o + 5]!];
    let side: Side | null = null;
    if (c.kind[k] === 1 && c.sweep[k]) {
      const [a0, a1, a2] = PLANE_AXES[c.plane[k]!] ?? PLANE_AXES[0]!;
      const g = shapeOf(a, b, a0, a1, a2, c.center[k * 3 + a0]!, c.center[k * 3 + a1]!, c.sweep[k]!);
      side = g && arcSide(g, s.ends, point, maxAngle, `c${k}`);
    } else if (lines && c.kind[k] !== 1) side = straightSide(a, b, s.ends, `c${k}`);
    if (side) return side;
  }
  return null;
}

/**
 * 판재 윤곽 토막이 놓인 요소: 선분 묶음은 붙잡기 표의 요소(paths — 호, lines면 직선 요소도) 가운데 토막 두 끝이 놓인 것,
 * 그물 윤곽선(판 외곽선·포켓 둘레·구멍 테두리)은 둘레 호(outlines). 둘레 호를 적은 그물의 다른 윤곽선은 곧은 모서리라 lines면 토막 그대로
 */
function panelSide(t: PanelSnapTable, s: SnapSegment, point: readonly number[], lines: boolean): Side | null {
  const ends = s.ends;
  if (s.kind === 'edge') {
    const arcs = panelArcsOf(t, `edge:${s.id}`);
    for (let k = 0; k < arcs.length; k++) {
      const r = arcSide(arcs[k]!, ends, point, ARC_ANGLE, `e:${s.id}:${k}`);
      if (r) return r;
    }
    return lines && t.outlines?.has(s.id) ? lineSide([...ends[0]] as V3, [...ends[1]] as V3, `e:${s.id}#${s.raw}`) : null;
  }
  const key = `${s.id}#${s.index}`;
  const el = t.paths.get(key);
  if (!el) return null;
  for (let i = 0; i + 9 <= el.length; i += 9) {
    const a: V3 = [el[i]!, el[i + 1]!, el[i + 2]!];
    const b: V3 = [el[i + 3]!, el[i + 4]!, el[i + 5]!];
    const sweep = el[i + 8]!;
    let r: Side | null = null;
    if (sweep) {
      const g = shapeOf(a, b, 0, 1, 2, el[i + 6]!, el[i + 7]!, sweep);
      r = g && Number.isFinite(g.r0 + g.r1 + g.t0) ? arcSide(g, ends, point, ARC_ANGLE, `p:${key}:${i / 9}`) : null;
    } else if (lines) r = straightSide(a, b, ends, `p:${key}:${i / 9}`);
    if (r) return r;
  }
  return null;
}

/** 토막이 놓인 요소(NC 이동·보정 경로·판재 붙잡기 표). lines면 곧은 요소도(교차점), 아니면 곡선만(0.14.0 종류) */
function sideOf(s: SnapSegment, src: SnapMoves | PanelSnapTable, point: readonly number[], arcAngle: number, lines: boolean): Side | null {
  if (!('moves' in src)) return panelSide(src, s, point, lines);
  if (s.kind !== 'line') return null;
  if (s.id === 'nc-comp') return compSide(src, s, point, arcAngle, lines);
  return ncSide(src, s, point, arcAngle, lines);
}

/** 코어 교차점 → 두 요소의 정확한 교차점(intersect.ts). 허용치는 좌표 크기와 두 토막 길이로 */
function refineIntersection(c: SnapRefineInput, src: SnapMoves | PanelSnapTable, arcAngle: number): V3 | null {
  const o = c.other;
  if (!o) return null;
  const A = sideOf(c.segment, src, c.point, arcAngle, true);
  const B = A && sideOf(o, src, c.point, arcAngle, true);
  if (!A || !B) return null;
  let mag = 0;
  for (const p of [c.point, ...c.segment.ends, ...o.ends]) mag = Math.max(mag, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const len = dist3(c.segment.ends[0], c.segment.ends[1]) + dist3(o.ends[0], o.ends[1]);
  const tol = 1e-6 * (1 + mag + len);
  // 꺾은선 교차점(넓힌 교차는 두 토막 사이 가운데)은 곡선 교차점에서 토막 길이 안쪽이다 — 그보다 먼 답은 다른 교차
  return intersectSides(A, B, c.point, tol, 1e-4 * len, len + tol);
}

/**
 * 코어가 고른 점(c)을 곡선 위로 다듬은 세계 점. 다듬을 곡선이 없으면(직선·모르는 묶음·발이 곡선 밖·만나지 않는 교차) null — 코어 점 그대로.
 * src = NC 이동(원호·스플라인·보정 경로)이나 판재 붙잡기 표, arcAngle = 장면이 쓴 호 나누기 각(scene.meta.arcAngle)
 */
export function refineSnap(c: SnapRefineInput, src: SnapMoves | PanelSnapTable, arcAngle = ARC_ANGLE): V3 | null {
  // 아는 종류만 푼다 — 교차점은 두 요소를 함께, 코어가 뒤에 더하는 종류는 코어 점 그대로(모서리 위 점처럼 풀지 않는다)
  const kind = c.kind as string;
  if (kind === 'intersection') return refineIntersection(c, src, arcAngle);
  if (kind !== 'onEdge' && kind !== 'midpoint' && kind !== 'perpendicular') return null;
  const s = c.segment;
  const ends = s.ends;
  const t = sideOf(s, src, c.point, arcAngle, false);
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
 * 수직 발: 첫 점에서 곡선에 내린 발 가운데 코어 점(토막 위 발 — 열린 수직 발이면 토막 끝)에 가장 가까운 것.
 * 종류·토막·코어 점·첫 점만으로 정한다(커서 광선은 쓰지 않는다 — 코어 0.15.0이 열린 후보를 광선 없이 기억한다). 첫 점이 원의 축 위(중심 등)면
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
 * 판재(MPR·PGI·XML) 문서의 붙잡기 선택: 윤곽·판 외곽선의 원호 중심·원형 포켓 중심, 고른 윤곽 요소(판 외곽선·포켓 둘레·구멍 테두리의 호 포함)의
 * 가운데 점·중심, 추론 붙잡기, 호 위로 다듬기. 측정 중에는 그물 윤곽선(판·포켓·홈·구멍의 모서리 — 이미 그려 둔 선)도 고른다(edges)
 */
export function panelSnapOptions(t: PanelSnapTable): MeasureSnapOptions {
  return { points: panelCenters(t), pointsFor: (p) => panelSnapPoints(p, t), inference: MEASURE_INFERENCE, edges: true, refine: (c) => refineSnap(c, t) };
}
