/**
 * 측정 붙잡기 다듬기(3D 뷰어 코어 0.14.0·0.15.0·0.18.0 setMeasureSnap({ refine }) — 측정 도구 조각, 순수 함수).
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
 * - 교차점(17차): 두 토막이 놓인 요소(원호·스플라인과 곧은 요소 — 직선 이동·보정 경로의 직선 조각·판재 윤곽의 직선 요소, 둘레 호를 적은 그물의 곧은 모서리,
 *   19차부터 윤곽선이 모두 곧은 그물 — 직사각형 판·홈·각진 포켓 — 의 모서리)의
 *   정확한 3D 교차점(intersect.ts). 허용치 tol = 1e-6 × (1 + 좌표 크기 + 두 토막 길이 합) — 그보다 떨어져 지나가면 null
 * - 축과 선분의 교차(20차 — 코어 0.18.0 'axisEdge', 첫 점 축과 끌어온 축): 축 직선(c.line)과 토막이 놓인 곡선(원호·스플라인 — 곧은 요소는 null)의
 *   정확한 교차점을 축 직선 위로 내린 자리(코어 acceptOnLine이 축에서 화면 반 화소 넘게 벗어난 점은 버린다). 허용치는 교차점과 같은 꼴(토막 하나).
 *   22차(코어 0.20.0): 같은 계산이 직선이 토막과 만나지 않고 그 활꼴(현과 곡선 사이)만 지나는 열린 후보(c.open — 축이 곡선 평면을 뚫는 점)와
 *   축이 아닌 잠근 선(나란함·수직·접선 — c.line.axis 없음)도 푼다. 직선의 지나는 점·방향만 읽는다
 * - 모르는 종류는 null — 코어 점 그대로
 * - 축·잠근 선이 면을 뚫는 점(21차 — 코어 0.19.0 refineFace 'axisFace', 첫 점 축·끌어온 축·잠근 선, 22차부터 기운 잠근 선도): 판재 그물의 원기둥 벽(구멍 벽·둥근 포켓 벽·
 *   판 외곽선 둥근 모서리 — 붙잡기 표의 둘레 호 위·아래 고리 한 쌍, panelWalls)을 나눈 삼각형 위 코어 점을 그 직선과 원기둥의 정확한 교차점으로(refineFaceSnap)
 * 결과는 넘긴 값(종류·점·토막·첫 점·광선)과 문서 자료로만 정해진다(코어가 같은 입력이면 다시 부르지 않는다).
 */
import type { MeasureSnapOptions, SnapRefineFaceInput, SnapRefineInput, SnapSegment } from 'opencad-viewer3d';
import { MOVE_ARC, ncPathSetId } from '../model';
import type { PanelSnapTable } from '../scene';
import { MEASURE_INFERENCE } from './measure';
import { closestToRay, footsFrom, nearestOn, type Curve, type V3 } from './curve';
import { dist3, intersectSides, lineSide, type Side } from './intersect';
import { arcCurve, arcShape, compArcs, compPiecesOf, panelArcsOf, pointTol, shapeChords, shapeNearest, shapeOf, type ArcShape } from './tangent';
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
  const [lo, hi] = compPiecesOf(c, s.index);
  const arcs = compArcs(c);
  for (let k = lo; k < hi; k++) {
    const o = k * 6;
    const g = arcs[k];
    let side: Side | null = null;
    if (g) side = arcSide(g, s.ends, point, maxAngle, `c${k}`);
    else if (lines && c.kind[k] !== 1) side = straightSide([c.points[o]!, c.points[o + 1]!, c.points[o + 2]!], [c.points[o + 3]!, c.points[o + 4]!, c.points[o + 5]!], s.ends, `c${k}`);
    if (side) return side;
  }
  return null;
}

/**
 * 판재 윤곽 토막이 놓인 요소: 선분 묶음은 붙잡기 표의 요소(paths — 호, lines면 직선 요소도) 가운데 토막 두 끝이 놓인 것,
 * 그물 윤곽선(판 외곽선·포켓 둘레·구멍 테두리)은 둘레 호(outlines). 둘레 호를 적은 그물의 다른 윤곽선과 윤곽선이 모두 곧은 그물
 * (straight — 직사각형 판, 홈·각진 포켓, 19차)의 윤곽선은 곧은 모서리라 lines면 토막 그대로. 그 밖의 그물(기울어진 구멍 등 — 곡면일 수 있다)은 null
 */
function panelSide(t: PanelSnapTable, s: SnapSegment, point: readonly number[], lines: boolean): Side | null {
  const ends = s.ends;
  if (s.kind === 'edge') {
    const arcs = panelArcsOf(t, `edge:${s.id}`);
    for (let k = 0; k < arcs.length; k++) {
      const r = arcSide(arcs[k]!, ends, point, ARC_ANGLE, `e:${s.id}:${k}`);
      if (r) return r;
    }
    return lines && (t.outlines?.has(s.id) || t.straight?.has(s.id)) ? lineSide([...ends[0]] as V3, [...ends[1]] as V3, `e:${s.id}#${s.raw}`) : null;
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
 * 코어 축과 선분의 교차('axisEdge' — 0.18.0, 첫 점 축 axisEdges·끌어온 축 track) → 축 직선(c.line)과 토막이 놓인 곡선(원호·나선·보정 경로 호·
 * 판재 윤곽 호·판 외곽선·포켓 둘레·구멍 테두리의 호·스플라인)의 정확한 교차점을 축 직선 위로 내린 자리(세계 축이면 지나는 점과 남은 두 좌표가 같다).
 * 축 직선은 코어 점 둘레 ±2 × (토막 길이 + tol)의 곧은 요소로 두고 교차점(intersect.ts — 직선과 원은 식, 나선·스플라인은 두 매개변수 뉴턴)과 같은 허용치로 푼다.
 * 꺾은선이 축과 만나는 토막의 곡선 조각(현과 호가 두르는 활꼴)을 축이 지나므로 곡선 교차점은 코어 점에서 토막 길이 안이다 — 그보다 멀면 null.
 * 곧은 요소(직선 이동·곧은 모서리 — 코어 점이 정확하다)·모르는 묶음·만나지 않으면(축이 곡선 평면 밖으로 tol 넘게 지나감) null.
 * 코어 0.20.0의 열린 후보(c.open — 직선이 토막과 3D로 만나지 않고 활꼴만 지난다, 코어 점 = 직선 위에서 토막에 가장 가까운 점)와 축이 아닌 잠근 선
 * (c.line.axis 없음)도 그대로 푼다: 곡선 평면을 뚫는 직선이면 lineCircle의 평면 교차·나선·스플라인은 두 매개변수 뉴턴, 평면 안에서 활꼴을 두 번 지나면 코어 점에 가까운 근.
 * 받을지(그 토막 범위 안·현에서 0.1 × 토막 길이 안)는 코어가 정한다
 */
function refineAxisEdge(c: SnapRefineInput, src: SnapMoves | PanelSnapTable, arcAngle: number): V3 | null {
  const l = c.line;
  if (!l) return null;
  const o = l.origin;
  const n = Math.hypot(l.dir[0], l.dir[1], l.dir[2]);
  if (!(n > 0) || !o.every(Number.isFinite)) return null;
  const e: V3 = [l.dir[0] / n, l.dir[1] / n, l.dir[2] / n];
  const B = sideOf(c.segment, src, c.point, arcAngle, false);
  if (!B) return null;
  let mag = 0;
  for (const p of [c.point, o, ...c.segment.ends]) mag = Math.max(mag, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const len = dist3(c.segment.ends[0], c.segment.ends[1]);
  const tol = 1e-6 * (1 + mag + len);
  // 축 직선 위 자리 t(지나는 점 기준)와 그 점 — 세계 축이면 남은 두 좌표는 o 그대로(0 × t)
  const along = (t: number): V3 => [o[0] + e[0] * t, o[1] + e[1] * t, o[2] + e[2] * t];
  const t0 = (c.point[0] - o[0]) * e[0] + (c.point[1] - o[1]) * e[1] + (c.point[2] - o[2]) * e[2];
  const h = 2 * (len + tol);
  const A = lineSide(along(t0 - h), along(t0 + h), 'axis');
  const X = A && intersectSides(A, B, c.point, tol, tol, len + tol);
  return X && along((X[0] - o[0]) * e[0] + (X[1] - o[1]) * e[1] + (X[2] - o[2]) * e[2]);
}

/**
 * 코어가 고른 점(c)을 곡선 위로 다듬은 세계 점. 다듬을 곡선이 없으면(직선·모르는 묶음·발이 곡선 밖·만나지 않는 교차) null — 코어 점 그대로.
 * src = NC 이동(원호·스플라인·보정 경로)이나 판재 붙잡기 표, arcAngle = 장면이 쓴 호 나누기 각(scene.meta.arcAngle)
 */
export function refineSnap(c: SnapRefineInput, src: SnapMoves | PanelSnapTable, arcAngle = ARC_ANGLE): V3 | null {
  // 아는 종류만 푼다 — 교차점은 두 요소를 함께, 축과 선분의 교차는 축 직선과 곡선을, 코어가 뒤에 더하는 종류는 코어 점 그대로(모서리 위 점처럼 풀지 않는다)
  const kind = c.kind as string;
  if (kind === 'intersection') return refineIntersection(c, src, arcAngle);
  if (kind === 'axisEdge') return refineAxisEdge(c, src, arcAngle);
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
 * 판재 그물 둘레의 원기둥 벽 하나(panelWalls): 둘레 호(평면 축 a0·a1, 법선 축 a2 — 기둥을 민 방향)의 중심 (cu, cv)·반지름 r·시작 각 t0·부호 있는 중심각,
 * 벽의 높이 범위(a2 좌표 lo~hi — 위·아래 고리의 높이), 장면이 그 호를 나눈 토막 하나의 반각(half)
 */
export interface PanelWall {
  a0: number;
  a1: number;
  a2: number;
  cu: number;
  cv: number;
  r: number;
  t0: number;
  sweep: number;
  lo: number;
  hi: number;
  half: number;
}

const wallCache = new WeakMap<PanelSnapTable, Map<string, PanelWall[]>>();

/**
 * 그물 id의 원기둥 벽(표·그물마다 한 번): 붙잡기 표의 둘레 호(outlines — 판 외곽선·포켓 둘레·구멍 테두리는 기둥의 위·아래 고리를 둘 다 적는다)에서
 * 평면·중심·반지름·시작 각·중심각이 같고 높이(a2)만 다른 호를 한 벽으로 묶는다(높이가 하나뿐인 호는 벽을 모른다). 호 평면 위의 고른 원호만(나선·반지름이 바뀌는 호는 뺀다).
 * 벽 사이 면(위·아랫면, 곧은 옆면)은 평면이라 여기 없다
 */
export function panelWalls(t: PanelSnapTable, id: string): PanelWall[] {
  let m = wallCache.get(t);
  if (!m) wallCache.set(t, (m = new Map()));
  let out = m.get(id);
  if (out) return out;
  const groups = new Map<string, { g: ArcShape; zs: number[] }>();
  for (const g of panelArcsOf(t, `edge:${id}`)) {
    const z = g.s[g.a2]!;
    if (Math.abs(g.e[g.a2]! - z) > pointTol(g.s) || Math.abs(g.r1 - g.r0) > pointTol(g.s) || !(g.r0 > 0)) continue;
    const key = [g.a2, g.cu, g.cv, g.r0, g.t0, g.sweep].map((x) => x.toPrecision(12)).join('|');
    const k = groups.get(key);
    if (k) k.zs.push(z);
    else groups.set(key, { g, zs: [z] });
  }
  out = [];
  for (const { g, zs } of groups.values()) {
    const lo = Math.min(...zs);
    const hi = Math.max(...zs);
    if (!(hi - lo > pointTol(g.s))) continue;
    out.push({ a0: g.a0, a1: g.a1, a2: g.a2, cu: g.cu, cv: g.cv, r: g.r0, t0: g.t0, sweep: g.sweep, lo, hi, half: Math.abs(g.sweep) / shapeChords(g, ARC_ANGLE) / 2 });
  }
  m.set(id, out);
  return out;
}

/** 각 a가 벽의 호 안(시작 각에서 중심각 쪽으로, 허용 각 tol)인지 — 한 바퀴 원은 늘 */
function inWall(w: PanelWall, a: number, tol: number): boolean {
  const span = Math.abs(w.sweep);
  if (span >= 2 * Math.PI - 1e-9) return true;
  const TAU = 2 * Math.PI;
  let d = (((a - w.t0) * Math.sign(w.sweep)) % TAU + TAU) % TAU;
  if (d > TAU - tol) d -= TAU;
  return d >= -tol && d <= span + tol;
}

/** 두 각 사이(0~π) */
function angleGap(a: number, b: number): number {
  const TAU = 2 * Math.PI;
  const d = (((a - b) % TAU) + TAU) % TAU;
  return d > Math.PI ? TAU - d : d;
}


/**
 * 축·잠근 선이 면을 뚫는 점 다듬기(코어 0.19.0 refineFace 'axisFace' — 첫 점 축·끌어온 축 axisFaces, 잠근 선 lockFaces — 0.20.0부터 축이 아닌 잠근 선도):
 * 코어 점(직선 c.line과 삼각형 평면의 교차)이 판재 그물의 원기둥 벽(panelWalls)을 나눈 삼각형 위면, 그 직선과 원기둥의 정확한 교차점 가운데 그 현 바깥쪽(활꼴 쪽)의 것.
 * - 벽 찾기: 면 법선이 기둥 방향(a2)에 수직이고(옆면), 코어 점의 높이가 벽 범위 안, 중심에서 거리가 현(r·cos 반각)과 호(r) 사이, 각이 호 안,
 *   면 법선이 그 자리 반지름 방향에서 반각 안(삼각형이 그 호를 나눈 현의 것). 윗면·아랫면(법선이 a2), 곧은 옆면, 모르는 그물(공작물·깎기 시뮬레이션 소재·
 *   기울어진 구멍)은 null — 평면이면 코어 점이 이미 정확하다
 * - 교차: 직선을 기둥 단면 평면(a0·a1)에 비추면 원과 직선의 교차(이차식 — 판별식은 r² − (중심에서 직선까지 거리)²로 셈 오차 없이)이고, 높이 a2는 그 매개변수로
 *   직선을 따라간 자리다. 세계 축은 기둥 방향과 나란하거나(그 벽을 따라가는 선 — 한 점으로 뚫지 않는다, null) 수직이라 남은 두 좌표가 지나는 점 그대로다.
 *   22차(코어 0.20.0 — 나란함·수직·접선·앱이 정한 방향으로 잠근 선, line.axis 없음): 기운 직선도 같은 식으로 풀고, 뚫는 점의 높이가 벽 범위 안이어야 한다.
 *   기둥 방향과 거의 나란한 직선(비춘 방향 길이² 1e-9 이하)은 null
 * - 고르는 것: 현은 원 안쪽이라 코어 점은 원 안이고 두 근은 그 양쪽이다. 직선은 원과 현 사이 활꼴을 지나 현에 닿으므로 참 점은 코어 점에서 바깥(그 자리
 *   반지름 방향)으로 간 근 — 다른 근은 원을 가로지른 맞은편 벽이다. 그 자리 각이 호 안(둥근 모서리 끝을 넘으면 곧은 옆면 쪽이라 null)이고 코어 점에서 반지름 안
 * 허용치는 좌표 크기의 1e-6 × 4(장면 float32 반올림 — pointTol). 여러 벽에 맞으면(구멍 여럿) 코어 점에 가장 가까운 답.
 * 코어는 받은 점이 코어 점에서 붙잡기 거리(화면) 밖이면 버린다(벽을 거의 스치는 직선)
 *
 * 25차(23차 준비분 — 코어 0.21.0 'onFace', 붙잡지 않은 그물 면 위 점, c.line = 커서 광선): 커서 광선이 원기둥 벽을 나눈 삼각형을 맞은 점(c.point)을 같은 벽 찾기·같은 교차식으로
 * 광선과 원기둥의 교차점으로 옮긴다. 고르는 근도 같다(코어 점에서 바깥쪽 — 볼록한 둥근 모서리는 광선이 먼저 닿는 앞쪽 근, 구멍·포켓처럼 오목한 벽은 맞은편 벽을 지나
 * 광선이 나가는 근이 그쪽이다). 바깥쪽 근이 둘이면(벽을 거의 스치는 광선) 광선을 따라 먼저 닿는 근, 여러 벽이면 광선 쪽 첫 근.
 * 받을지(광선 위 자리가 맞은 삼각형 가장 긴 변의 0.1배 안, 눈 뒤·가까운 면 앞이 아님)는 코어 acceptOnFace가 정한다. 평면 면·모르는 그물은 null
 *
 * 25차(코어 0.22.0 면의 열린 교차 — 'axisFace'의 open): 축·잠근 선이 벽 삼각형을 비켜 가며 그 현과 호 사이(활꼴)만 지나 원기둥을 뚫는 자리. c.point는 코어 점이 아니라
 * 선 위에서 그 삼각형 무게중심에 가장 가까운 점(힌트)이라 원기둥 밖일 수 있고(선이 호 꼭대기를 아주 얕게 스치면 무게중심 쪽 힌트가 두 근 바깥), 두 근이
 * 모두 그 현 위일 수 있다. 그래서 열린 후보만 따로 본다(그 밖의 길은 위 그대로):
 * - 벽 찾기: 현은 면 법선(반지름 방향 — 눈 쪽이면 뒤집는다)으로 찾는다. 법선 방향이 호 안이고, 힌트가 벽 높이 안·중심에서 현(r·cos 반각)과 r ÷ cos(반각 × 2) 사이·
 *   법선 방향에서 반각 × 2 안이어야 한다(무게중심은 현의 각 범위 안이고 힌트는 거기서 선을 따라 조금 비켜 있다)
 * - 고르는 것: 그 현의 각 범위(법선 방향 ± 반각) 안의 근 가운데 힌트에 가까운 것. 22차까지의 길(코어 점에서 바깥쪽 근)로는 힌트가 원기둥 밖이면 null이었다.
 *   커서 광선은 보지 않는다 — 코어가 결과를 커서 광선 없는 열쇠(종류·힌트·면·선·첫 점)로 기억하므로 같은 입력에는 늘 같은 답이어야 한다.
 *   그래서 두 근이 한 삼각형 위면 힌트 쪽 근 하나만 붙는다(코어 README 0.22.0과 같은 한계)
 * 받을지(그 삼각형 위 곡면 조각 자리·커서 붙잡기 거리 안·가림)는 코어가 정한다
 */
export function refineFaceSnap(c: SnapRefineFaceInput, t: PanelSnapTable): V3 | null {
  // 코어가 뒤에 더하는 종류는 문자열로 견줘 null(코어 점 그대로)
  const kind: string = c.kind;
  if (kind !== 'axisFace' && kind !== 'onFace') return null;
  const ray = kind === 'onFace';
  const open = !ray && !!c.open;
  const walls = panelWalls(t, c.face.id);
  if (!walls.length) return null;
  const p = c.point;
  const n = c.face.normal;
  const o = c.line.origin;
  const dl = Math.hypot(c.line.dir[0], c.line.dir[1], c.line.dir[2]);
  if (!(dl > 0) || !o.every(Number.isFinite) || !p.every(Number.isFinite)) return null;
  const d: V3 = [c.line.dir[0] / dl, c.line.dir[1] / dl, c.line.dir[2] / dl];
  const tol = 4 * pointTol(p);
  let best: V3 | null = null;
  // 축·잠근 선은 코어 점(열린 후보는 힌트)에 가까운 근, 커서 광선은 광선을 따라 먼저 닿는 근(광선 매개변수)
  let bestD = Infinity;
  for (const w of walls) {
    const { a0, a1, a2, r } = w;
    if (Math.abs(n[a2]) > 1e-3) continue;
    if (p[a2] < w.lo - tol || p[a2] > w.hi + tol) continue;
    const pu = p[a0] - w.cu;
    const pv = p[a1] - w.cv;
    const rho = Math.hypot(pu, pv);
    const nl = Math.hypot(n[a0], n[a1]);
    // 열린 후보: 그 현의 가운데 각(면 법선 — 바깥쪽으로)
    let mid = 0;
    if (open) {
      if (!(nl > 0.5) || rho > r / Math.cos(2 * w.half) + tol || rho < r * Math.cos(w.half) - tol) continue;
      mid = Math.atan2(n[a1], n[a0]) + (n[a0] * pu + n[a1] * pv < 0 ? Math.PI : 0);
      if (!inWall(w, mid, tol / r) || angleGap(Math.atan2(pv, pu), mid) > 2 * w.half + tol / r) continue;
    } else {
      if (rho > r + tol || rho < r * Math.cos(w.half) - tol || !inWall(w, Math.atan2(pv, pu), tol / r)) continue;
      if (!(nl > 0.5) || Math.abs(n[a0] * pu + n[a1] * pv) < nl * rho * (Math.cos(w.half) - 1e-6)) continue;
    }
    // 단면 평면에 비춘 직선 (ou, ov) + s(du, dv): |·|² = r² — 높이는 o[a2] + s·d[a2](세계 축이 기둥에 수직이면 d[a2] = 0이라 지나는 점 그대로)
    const ou = o[a0] - w.cu;
    const ov = o[a1] - w.cv;
    const du = d[a0];
    const dv = d[a1];
    const A = du * du + dv * dv;
    const cr = ou * dv - ov * du;
    const disc = A * r * r - cr * cr;
    if (!(A > 1e-9) || disc < 0) continue;
    const B = ou * du + ov * dv;
    const sq = Math.sqrt(disc);
    for (const s of [(-B - sq) / A, (-B + sq) / A]) {
      const q: V3 = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
      // 뚫는 점이 벽 높이 안, 코어 점에서 바깥쪽(반지름 방향)으로 간 근만(열린 후보는 그 현의 각 범위 안 근)
      if (q[a2] < w.lo - tol || q[a2] > w.hi + tol) continue;
      const qa = Math.atan2(q[a1] - w.cv, q[a0] - w.cu);
      if (open) {
        if (angleGap(qa, mid) > w.half + tol / r || !inWall(w, qa, tol / r)) continue;
        const k = dist3(q, p);
        if (k < bestD) {
          bestD = k;
          best = q;
        }
        continue;
      }
      if (((q[a0] - p[a0]) * pu + (q[a1] - p[a1]) * pv) / rho < -tol) continue;
      if (!inWall(w, qa, tol / r)) continue;
      const e = dist3(q, p);
      const key = ray ? s : e;
      if (e <= r && key < bestD) {
        bestD = key;
        best = q;
      }
    }
  }
  return best;
}

/**
 * 앱(app.ts syncMeasureSnap)이 NC 문서를 재는 동안 코어에 주는 붙잡기 선택: 원호 중심(늘 후보 — 재생 중 한도), 고른 이동의 가운데 점·중심
 * (snap.ts moveSnapPoints), 추론 붙잡기, 곡선 위로 다듬기(refineSnap). 시험도 같은 것을 쓴다.
 * 25차(코어 0.23.0 throughTranslucent): 측정 점 고르기가 반투명 그물(공작물 상자 — 투명도 0.22)의 면을 지나 그 뒤 불투명 그물 면을 고른다.
 * 뒤에 불투명 그물이 없으면 예전처럼 공작물 면이다(깎기 시뮬레이션은 공작물 상자를 빼고 불투명 소재를 그린다)
 */
export function ncSnapOptions(nc: SnapMoves, centers: ArcCenters, limit: number | null = null, arcAngle?: number): MeasureSnapOptions {
  return { points: centers.points, pointsFor: (p) => moveSnapPoints(p, nc), inference: MEASURE_INFERENCE, limit, refine: (c) => refineSnap(c, nc, arcAngle), throughTranslucent: true };
}

/**
 * 판재(MPR·PGI·XML) 문서의 붙잡기 선택: 윤곽·판 외곽선의 원호 중심·원형 포켓 중심, 고른 윤곽 요소(판 외곽선·포켓 둘레·구멍 테두리의 호 포함)의
 * 가운데 점·중심, 추론 붙잡기, 호 위로 다듬기. 측정 중에는 그물 윤곽선(판·포켓·홈·구멍의 모서리 — 이미 그려 둔 선)도 고른다(edges).
 * 21차: 축이 구멍 벽·둥근 포켓 벽·판 외곽선 둥근 모서리를 뚫는 점은 원기둥 위로(refineFace — refineFaceSnap). 22차: 기운 잠근 선(코어 0.20.0)도.
 * 25차: 붙잡지 않은 커서가 원기둥 벽을 맞은 점도 원기둥 위로(코어 0.21.0 'onFace'), 측정 점 고르기가 반투명 판(투명도 0.35)을 지나
 * 그 뒤 불투명 그물(수직·수평 구멍 — 투명도 1)의 면을 고른다(코어 0.23.0 throughTranslucent — 판을 숨기지 않아도 판 너머 구멍 벽·바닥을 잰다).
 * 포켓·홈 그물은 반투명(0.75·0.85)이라 함께 지나간다 — 뒤에 불투명 그물이 없으면 예전처럼 가장 앞의 반투명 면(판)이다
 */
export function panelSnapOptions(t: PanelSnapTable): MeasureSnapOptions {
  return { points: panelCenters(t), pointsFor: (p) => panelSnapPoints(p, t), inference: MEASURE_INFERENCE, edges: true, refine: (c) => refineSnap(c, t), refineFace: (c) => refineFaceSnap(c, t), throughTranslucent: true };
}
