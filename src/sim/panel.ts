/**
 * 판재 가공(MPR·PGI·XML)의 깎기 시뮬레이션(순수 함수 — 화면의 깎기 탭과 시험이 쓴다).
 *
 * 해석 워커가 해석기의 가공 목록(화면 장면과 같은 구멍·상자·기둥·경로)에서 시뮬레이션 재료(PanelSimSource — panel-source.ts)를 만들어
 * 화면 자료(MprPayload.sim)로 보낸다. 화면은 공구 반지름(파일 값 → 사용자 표 → 기본값)이 정해지면 이 파일로 이동 목록을 만든다:
 * - 수직 구멍: 구멍마다 안전 높이 → 바닥까지 드릴 이동 → 안전 높이(공구 = 구멍 지름의 평 끝 공구, 깎기 탭에서 종류를 바꿀 수 있다).
 * - 윤곽·경로: 해석기가 만든 경로(가공 깊이 반영)를 그대로 따라가고, 보정(MPR RK=WRKL·WRKR, PGI toolOffset, XML 보정)이 있으면
 *   공구 중심을 반지름만큼 옮긴다(G41·G42와 같은 comp.ts — 바깥 모서리는 호로 잇고 안쪽 모서리는 교점까지 자른다).
 * - 홈·포켓·자유 형상 포켓: 파일이 정한 모양(상자·기둥) 그대로 바닥 높이까지 영역으로 내린다(공구를 쓰지 않는다 — 파일에 공구 지름이 없어
 *   모서리 R을 알 수 없다. 화면이 그리는 모양과 같다).
 * - 직사각형이 아닌 판(PGI·XML 외곽선)은 처음에 판 밖을 바닥까지 내린 것으로 본다(바닥 색).
 * 옆면·아랫면 가공(수평 구멍, UfluBohr, 아랫면 자유 형상 포켓, 옆면 홈·경로), 엣지 밴딩(깎기가 아님), 모양을 모르는 매크로는
 * 재료를 만들 때 "시뮬레이션하지 않음" 목록으로 뺀다.
 */
import { ncCompPath } from '../comp';
import { MOVE_ARC, MOVE_DRILL, MOVE_FEED, MOVE_RAPID, type NcProgram, type PathPoint } from '../model';
import { SIM_MOVE_REGION, type SimMoves } from './engine';
import type { SimRegions } from './grid';

/** 시뮬레이션하지 않는 판재 가공의 까닭 */
export type PanelSkipCode = 'side' | 'bottom' | 'edge' | 'unsupported' | 'no-shape';

export const PANEL_SKIP_TEXT: Record<PanelSkipCode, string> = {
  side: '옆면 가공(수평 구멍·옆면 홈·경로) — 위에서 내려오지 않음',
  bottom: '아랫면 가공 — 위에서 내려오지 않음',
  edge: '엣지 밴딩 — 깎기가 아님',
  unsupported: '지원하지 않는 매크로 — 모양을 모름',
  'no-shape': '모양 값(지름·크기·경로)이 모자람',
};

export interface PanelSimSkip {
  /** 가공 번호(scene.meta.operations 차례) */
  op: number;
  code: PanelSkipCode;
  label: string;
  /** 원본 줄(0부터) */
  line: number;
}

/** 판재 공구: 구멍은 지름별, 윤곽은 공구 번호(MPR TNO)나 공구 폭(PGI width·XML Width)별 */
export interface PanelSimTool {
  /** 사용자 표 열쇠 조각(D8 = 지름 8 구멍, T101 = 공구 번호, R12 = 폭 12 경로, R = 지름 모르는 경로) */
  key: string;
  type: 'drill' | 'router';
  tno?: number;
  /** 파일이 알려 준 지름(구멍 지름·공구 폭) */
  diameter?: number;
}

/** 시뮬레이션 재료 하나(가공 하나) */
export type PanelSimItem =
  /** holes = 구멍마다 x, y, 윗면 z, 바닥 z */
  | { op: number; type: 'drill'; tool: number; holes: number[] }
  | { op: number; type: 'path'; tool: number; comp: 'left' | 'right' | 'none'; path: PathPoint[] }
  /** rings = 닫힌 고리 xy들(짝홀 규칙), z = 바닥 높이 */
  | { op: number; type: 'region'; rings: number[][]; z: number };

/** 해석 워커가 만드는 판재 시뮬레이션 재료(화면 자료 MprPayload.sim) */
export interface PanelSimSource {
  units: 'mm' | 'inch';
  /** 판 크기(원점 = 왼쪽 앞 아래 모서리). 모르면 null */
  board: { length: number; width: number; thickness: number } | null;
  /** 직사각형이 아닌 판의 외곽선(xy, 닫힌 꺾은선) */
  outline: number[] | null;
  items: PanelSimItem[];
  tools: PanelSimTool[];
  skipped: PanelSimSkip[];
  /** 꺼진 가공 수(깎지 않는다) */
  disabled: number;
}

/** 소재 상자(setup.ts SimBox와 같은 꼴) */
export interface PanelBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * 소재 기본값: 판 크기(MPR LA·BR·DI, PGI·XML 판 정보)면 0~길이 × 0~폭 × 0~두께. 판을 모르면 가공 범위(구멍·경로는 공구 반지름만큼 넓혀)에
 * 여유를 더하고, 윗면은 구멍이 들어가는 면(없으면 Z0), 바닥은 가장 깊은 가공보다 여유만큼 아래
 */
export function panelStock(src: PanelSimSource, radiusOf: (tool: number) => number): PanelBox | null {
  const b = src.board;
  if (b) return { min: [0, 0, 0], max: [b.length, b.width, b.thickness] };
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let top = -Infinity;
  const add = (x: number, y: number, z: number, r: number): void => {
    box[0] = Math.min(box[0]!, x - r);
    box[1] = Math.min(box[1]!, y - r);
    box[2] = Math.min(box[2]!, z);
    box[3] = Math.max(box[3]!, x + r);
    box[4] = Math.max(box[4]!, y + r);
    box[5] = Math.max(box[5]!, z);
  };
  for (const it of src.items) {
    if (it.type === 'drill') {
      const r = radiusOf(it.tool);
      for (let k = 0; k + 3 < it.holes.length; k += 4) {
        add(it.holes[k]!, it.holes[k + 1]!, it.holes[k + 3]!, r);
        top = Math.max(top, it.holes[k + 2]!);
      }
    } else if (it.type === 'path') {
      const r = radiusOf(it.tool);
      for (const p of it.path) add(p.x, p.y, p.z, r);
    } else for (const ring of it.rings) for (let k = 0; k + 1 < ring.length; k += 2) add(ring[k]!, ring[k + 1]!, it.z, 0);
  }
  if (!(box[0]! <= box[3]!)) return null;
  if (!Number.isFinite(top)) top = 0;
  top = Math.max(top, 0);
  const u = src.units === 'inch' ? 1 / 25.4 : 1;
  const pad = Math.max(2 * u, 0.04 * Math.max(box[3]! - box[0]!, box[4]! - box[1]!));
  const low = Math.min(box[2]!, top);
  const bottom = low - Math.max(2 * u, (top - low) / 4);
  return { min: [box[0]! - pad, box[1]! - pad, bottom], max: [box[3]! + pad, box[4]! + pad, top] };
}

/** 판재 이동 목록: 엔진 이동 + 영역 표 + 이동마다 가공 번호(판 밖 영역은 -1) */
export interface PanelSimMoves extends SimMoves {
  regions: SimRegions;
  op: Int32Array;
  /** 계산량 어림(공구가 지나간 넓이 + 영역 넓이) */
  area: number;
}

/** 꺾은선 넓이(부호 없음) */
function ringArea(xy: readonly number[]): number {
  let a = 0;
  const n = Math.floor(xy.length / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += xy[i * 2]! * xy[j * 2 + 1]! - xy[j * 2]! * xy[i * 2 + 1]!;
  }
  return Math.abs(a) / 2;
}

/** 요소 a → b의 시작·끝 접선(XY 단위 벡터). 길이가 없거나 수직이면 null */
function tangents(a: PathPoint, b: PathPoint): { s: [number, number]; e: [number, number] } | null {
  if (b.arc) {
    const { cx, cy, sweep } = b.arc;
    const sg = sweep >= 0 ? 1 : -1;
    const ra = Math.hypot(a.x - cx, a.y - cy);
    const rb = Math.hypot(b.x - cx, b.y - cy);
    if (ra < 1e-9 || rb < 1e-9 || Math.abs(sweep) < 1e-12) return null;
    return { s: [(-(a.y - cy) / ra) * sg, ((a.x - cx) / ra) * sg], e: [(-(b.y - cy) / rb) * sg, ((b.x - cx) / rb) * sg] };
  }
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1e-9) return null;
  const t: [number, number] = [(b.x - a.x) / l, (b.y - a.y) / l];
  return { s: t, e: t };
}

/**
 * 반경 보정 경로(공구 중심): 경로 앞뒤에 보정 쪽으로 반지름 두 배만큼 떨어진 들어가기·나오기 직선을 붙여 comp.ts(G41·G42와 같은 계산)에
 * 맡긴다 — 들어가기는 보정 쪽 바깥에서 첫 요소의 옮긴 시작점으로, 나오기는 마지막 요소의 옮긴 끝점에서 바깥으로 간다(경로를 파고들지 않게).
 * 계산하지 못하면 null
 */
export function offsetPath(path: readonly PathPoint[], side: 'left' | 'right', r: number): PathPoint[] | null {
  const n = path.length;
  if (n < 2 || !(r > 0)) return null;
  let first: { s: [number, number]; e: [number, number] } | null = null;
  let last: { s: [number, number]; e: [number, number] } | null = null;
  for (let i = 1; i < n && !first; i++) first = tangents(path[i - 1]!, path[i]!);
  for (let i = n - 1; i >= 1 && !last; i--) last = tangents(path[i - 1]!, path[i]!);
  if (!first || !last) return null;
  const sr = (side === 'left' ? 1 : -1) * r;
  const p0 = path[0]!;
  const pe = path[n - 1]!;
  // 이동: 0 들어가기(A → 점 0), 1 … n−1 경로 요소, n 나오기(점 n−1 → B)
  const count = n + 1;
  const kind = new Uint8Array(count).fill(MOVE_FEED);
  const points = new Float64Array((count + 1) * 3);
  const arc = new Int32Array(count).fill(-1);
  const center: number[] = [];
  const sweep: number[] = [];
  points.set([p0.x - first.s[1] * 2 * sr, p0.y + first.s[0] * 2 * sr, p0.z], 0);
  for (let i = 0; i < n; i++) {
    const p = path[i]!;
    points.set([p.x, p.y, p.z], (i + 1) * 3);
    if (i > 0 && p.arc) {
      kind[i] = MOVE_ARC;
      arc[i] = sweep.length;
      center.push(p.arc.cx, p.arc.cy, path[i - 1]!.z);
      sweep.push(p.arc.sweep);
    }
  }
  points.set([pe.x - last.e[1] * 2 * sr, pe.y + last.e[0] * 2 * sr, pe.z], (n + 1) * 3);
  const prog = {
    moves: { count, kind, points, arc, line: new Uint32Array(count) },
    arcs: { center: Float64Array.from(center), plane: new Uint8Array(sweep.length), sweep: Float64Array.from(sweep) },
    compRuns: [{ first: 0, end: n, side: side === 'left' ? 1 : 2, plane: 0, radius: r, source: '', line: 0 }],
  } as unknown as NcProgram;
  const c = ncCompPath(prog);
  if (!c.count || !c.runs[0]?.computed) return null;
  const out: PathPoint[] = [{ x: c.points[0]!, y: c.points[1]!, z: c.points[2]! }];
  for (let k = 0; k < c.count; k++) {
    const q = k * 6;
    const at = out[out.length - 1]!;
    if (Math.hypot(c.points[q]! - at.x, c.points[q + 1]! - at.y, c.points[q + 2]! - at.z) > 1e-9) out.push({ x: c.points[q]!, y: c.points[q + 1]!, z: c.points[q + 2]! });
    const p: PathPoint = { x: c.points[q + 3]!, y: c.points[q + 4]!, z: c.points[q + 5]! };
    if (c.kind[k] === 1) p.arc = { cx: c.center[k * 3]!, cy: c.center[k * 3 + 1]!, sweep: c.sweep[k]! };
    out.push(p);
  }
  return out;
}

/**
 * 재료 → 이동 목록. radiusOf(공구 번호) = 사용자 표까지 반영한 반지름. 급속은 소재 윗면보다 안전 높이(5 mm·0.2 inch)만큼 위에서만 움직여
 * 소재를 깎지 않는다
 */
export function panelSimMoves(src: PanelSimSource, radiusOf: (tool: number) => number, stock: PanelBox): PanelSimMoves {
  const safe = stock.max[2] + (src.units === 'inch' ? 0.2 : 5);
  const kind: number[] = [];
  const pts: number[] = [];
  const tool: number[] = [];
  const arc: number[] = [];
  const op: number[] = [];
  const arcCenter: number[] = [];
  const arcSweep: number[] = [];
  const ringStart = [0];
  const pointStart = [0];
  const xy: number[] = [];
  const rz: number[] = [];
  const rout: number[] = [];
  let area = 0;
  const go = (k: number, x: number, y: number, z: number, t: number, o: number, a = -1): void => {
    if (!pts.length) pts.push(x, y, safe);
    kind.push(k);
    pts.push(x, y, z);
    tool.push(t);
    arc.push(a);
    op.push(o);
  };
  const region = (rings: readonly (readonly number[])[], z: number, outside: boolean, o: number): void => {
    for (const ring of rings) {
      for (let k = 0; k + 1 < ring.length; k += 2) xy.push(ring[k]!, ring[k + 1]!);
      pointStart.push(xy.length / 2);
    }
    ringStart.push(pointStart.length - 1);
    rz.push(z);
    rout.push(outside ? 1 : 0);
    const at = pts.length ? [pts[pts.length - 3]!, pts[pts.length - 2]!, pts[pts.length - 1]!] : [rings[0]![0] ?? 0, rings[0]![1] ?? 0, safe];
    go(SIM_MOVE_REGION, at[0]!, at[1]!, at[2]!, -1, o, rz.length - 1);
  };
  if (src.outline && src.outline.length >= 6) region([src.outline], stock.min[2], true, -1);
  for (const it of src.items) {
    if (it.type === 'region') {
      area += it.rings.reduce((a, r) => a + ringArea(r), 0);
      region(it.rings, it.z, false, it.op);
      continue;
    }
    const r = Math.max(0, radiusOf(it.tool));
    if (it.type === 'drill') {
      for (let k = 0; k + 3 < it.holes.length; k += 4) {
        const x = it.holes[k]!;
        const y = it.holes[k + 1]!;
        go(MOVE_RAPID, x, y, safe, it.tool, it.op);
        go(MOVE_DRILL, x, y, it.holes[k + 3]!, it.tool, it.op);
        go(MOVE_RAPID, x, y, safe, it.tool, it.op);
        area += Math.PI * r * r;
      }
      continue;
    }
    const path = (it.comp !== 'none' && r > 0 ? offsetPath(it.path, it.comp, r) : null) ?? it.path;
    const p0 = path[0]!;
    go(MOVE_RAPID, p0.x, p0.y, safe, it.tool, it.op);
    go(MOVE_FEED, p0.x, p0.y, p0.z, it.tool, it.op);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!;
      const p = path[k]!;
      if (p.arc) {
        arcCenter.push(p.arc.cx, p.arc.cy, a.z);
        arcSweep.push(p.arc.sweep);
        go(MOVE_ARC, p.x, p.y, p.z, it.tool, it.op, arcSweep.length - 1);
        area += 2 * r * Math.abs(p.arc.sweep) * Math.hypot(p.x - p.arc.cx, p.y - p.arc.cy);
      } else {
        go(MOVE_FEED, p.x, p.y, p.z, it.tool, it.op);
        area += 2 * r * Math.hypot(p.x - a.x, p.y - a.y) + (Math.abs(p.z - a.z) > 1e-9 ? Math.PI * r * r : 0);
      }
    }
    const pe = path[path.length - 1]!;
    go(MOVE_RAPID, pe.x, pe.y, safe, it.tool, it.op);
    area += Math.PI * r * r;
  }
  const count = kind.length;
  if (!pts.length) pts.push(0, 0, safe);
  return {
    count,
    kind: Uint8Array.from(kind),
    points: Float64Array.from(pts),
    tool: Int32Array.from(tool),
    flags: new Uint16Array(count),
    arc: Int32Array.from(arc),
    arcCenter: Float64Array.from(arcCenter),
    arcPlane: new Uint8Array(arcSweep.length),
    arcSweep: Float64Array.from(arcSweep),
    regions: { ringStart: Uint32Array.from(ringStart), pointStart: Uint32Array.from(pointStart), xy: Float64Array.from(xy), z: Float64Array.from(rz), outside: Uint8Array.from(rout) },
    op: Int32Array.from(op),
    area,
  };
}

/** 가공 하나씩 따라가기의 한 걸음: 가공 번호(scene.meta.operations 차례)와 그 가공의 첫 이동 */
export interface PanelOpStep {
  op: number;
  move: number;
}

/**
 * 판재 이동의 가공 차례(가공 하나씩 따라가기): 이동 차례로 처음 나온 가공마다 한 걸음(판 밖 영역 -1은 늘 먼저 하므로 빼고, 같은 가공은 한 번).
 * k걸음 = 가공 k개를 다 깎은 자리 = k번째 걸음의 첫 이동 앞(k가 걸음 수면 끝)
 */
export function panelOpSteps(m: Pick<PanelSimMoves, 'count' | 'op'>): PanelOpStep[] {
  const out: PanelOpStep[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < m.count; i++) {
    const op = m.op[i]!;
    if (op < 0 || seen.has(op)) continue;
    seen.add(op);
    out.push({ op, move: i });
  }
  return out;
}

/** k걸음(가공 k개를 다 깎음 — 0이면 깎기 전, 걸음 수 이상이면 끝)의 엔진 자리 */
export function panelStepTarget(steps: readonly PanelOpStep[], k: number, count: number): { move: number; frac: number } {
  return { move: k >= 0 && k < steps.length ? steps[k]!.move : count, frac: 0 };
}
