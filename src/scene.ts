/**
 * NC 모델 → 3D 장면(Scene3d).
 *
 * ncToScene: 급속은 점선 한 묶음, 이송·호는 공구별 묶음(공구별 색 또는 이송 속도 색), 드릴 사이클의 내려가는 이송은
 * 공구별 굵은 선, 구멍 위치는 점. 선분 segmentIds·점 pointIds는 이동 번호(program.moves.line으로 원본 줄을 찾는다).
 * 호는 각도 허용치(기본 5도)로 나눈다. 공작물이 있으면 반투명 상자(group "공작물").
 *
 * mprToScene(MPR·WangShi PGI·KDT XML 공용): 판 상자(반투명), 수직·수평 구멍은 원기둥, 윤곽 가공은 공구 경로 선, 홈은 얇은 상자,
 * 포켓은 상자 또는 다각형 기둥(둥근 모서리·원·자유 경로). meta에 모델 요약(공구 목록·통계·가공 목록)을 넣는다.
 */
import type { Box3, LineSet3d, Mesh3d, PointSet3d, Rgba, Scene3d } from 'opencad-viewer3d/types';
import { FLAG_MACHINE_EST, MOVE_ARC, MOVE_DRILL, MOVE_RAPID, NC_DIALECT_NAMES, PLANE_AXES, emptyBox, extendBox, boxOf, type NcProgram, type PathPoint } from './model';
import { compPathSegments, ncCompPath, type CompPathOptions } from './comp';
import { MeshAccum, TOOL_COLORS, rampColor } from './mesh';
import type { MprPart, PanelFace } from './mpr';

export interface NcSceneOptions {
  /** 원호를 나눌 최대 각도(라디안, 기본 5도). 선분 예산을 넘으면 자동으로 키운다 */
  arcAngle?: number;
  /** 장면 선분 수 예산(기본 300만) — 넘을 것 같으면 호를 더 크게 나눈다(직선 이동은 그대로) */
  segmentBudget?: number;
  /** 원호 현 오차 허용치(표시 단위, 주면 각도와 함께 더 잘게) */
  arcTolerance?: number;
  /** 'tool'(기본): 공구별 색, 'feed': 이송 속도 색 */
  colorBy?: 'tool' | 'feed';
  /** 급속 이송을 넣을지(기본 true) */
  rapids?: boolean;
  /** 공작물 상자. 없으면 프로그램의 것(BLK FORM 등), 'auto'면 절삭 범위로, null이면 넣지 않는다 */
  stock?: Box3 | 'auto' | null;
  /**
   * 반경 보정 경로(공구 중심)를 따로 넣을지(기본 false). 넣으면 선분 묶음 'nc-comp'(묶음 '보정 경로', 실선·다른 색,
   * segmentIds = 이동 번호)와 meta.compRuns가 생긴다. 객체로 주면 반지름 선택(comp.ts CompPathOptions)
   */
  compPath?: boolean | CompPathOptions;
}

const RAPID_COLOR: Rgba = [0.55, 0.55, 0.6, 1];
const MACHINE_COLOR: Rgba = [0.85, 0.6, 0.25, 1];
const COMP_COLOR: Rgba = [0.95, 0.3, 0.75, 1];
const AXIS_COLOR: Rgba = [0.45, 0.6, 0.85, 1];
const STOCK_COLOR: Rgba = [0.85, 0.72, 0.5, 0.22];
const HOLE_COLOR: Rgba = [0.9, 0.2, 0.1, 1];

/** 공구 번호 → 색(목록 차례대로) */
export function toolColors(tools: readonly { number: number }[]): Map<number, Rgba> {
  const m = new Map<number, Rgba>();
  tools.forEach((t, i) => m.set(t.number, TOOL_COLORS[i % TOOL_COLORS.length]!));
  return m;
}

function arcSegCount(sweep: number, r: number, maxAngle: number, tol: number | undefined): number {
  let step = maxAngle;
  if (tol && tol > 0 && r > tol) step = Math.min(step, 2 * Math.acos(1 - tol / r));
  return Math.max(1, Math.min(4096, Math.ceil(Math.abs(sweep) / Math.max(1e-4, step) - 1e-9)));
}

/** NC 프로그램을 장면으로 */
export function ncToScene(p: NcProgram, opts: NcSceneOptions = {}): Scene3d {
  let maxAngle = opts.arcAngle ?? Math.PI / 36;
  const tol = opts.arcTolerance;
  const byFeed = opts.colorBy === 'feed';
  const m = p.moves;
  const a = p.arcs;
  const pts = m.points;
  const n = m.count;

  // 공구 차례(묶음 번호)
  const colors = toolColors(p.tools);
  const toolSet = new Map<number, number>();
  const toolOrder: number[] = [];
  for (const t of p.tools) {
    toolSet.set(t.number, toolOrder.length);
    toolOrder.push(t.number);
  }
  const setOf = (tool: number): number => {
    let s = toolSet.get(tool);
    if (s === undefined) {
      s = toolOrder.length;
      toolSet.set(tool, s);
      toolOrder.push(tool);
    }
    return s;
  };

  // 0) 선분 예산: 호 각도 합으로 나누기 각을 정한다
  {
    let sweepSum = 0;
    for (let i = 0; i < a.count; i++) sweepSum += Math.abs(a.sweep[i]!);
    const straight = n - a.count;
    const budget = Math.max(opts.segmentBudget ?? 3_000_000, straight + a.count);
    if (straight + sweepSum / maxAngle > budget) maxAngle = Math.min(Math.PI / 4, sweepSum / Math.max(1, budget - straight));
  }

  // 1) 묶음마다 선분 수 세기
  const segCut: number[] = [];
  const segDrill: number[] = [];
  let segRapid = 0;
  let segMach = 0;
  let feedMin = Infinity;
  let feedMax = -Infinity;
  const arcN = new Uint32Array(a.count);
  for (let i = 0; i < n; i++) {
    const k = m.kind[i]!;
    if (m.flags[i]! & FLAG_MACHINE_EST) {
      segMach++;
      continue;
    }
    if (k === MOVE_RAPID) {
      segRapid++;
      continue;
    }
    const s = setOf(m.tool[i]!);
    if (k === MOVE_DRILL) {
      segDrill[s] = (segDrill[s] ?? 0) + 1;
      continue;
    }
    let c = 1;
    if (k === MOVE_ARC) {
      const ai = m.arc[i]!;
      const [a0, a1] = PLANE_AXES[a.plane[ai]!]!;
      const r = Math.hypot(pts[i * 3 + a0]! - a.center[ai * 3 + a0]!, pts[i * 3 + a1]! - a.center[ai * 3 + a1]!);
      c = arcSegCount(a.sweep[ai]!, r, maxAngle, tol);
      arcN[ai] = c;
    }
    segCut[s] = (segCut[s] ?? 0) + c;
    const f = m.feed[i]!;
    if (f > 0) {
      if (f < feedMin) feedMin = f;
      if (f > feedMax) feedMax = f;
    }
  }

  // 2) 채우기
  interface Buf {
    pos: Float32Array;
    ids: Uint32Array;
    col?: Float32Array;
    k: number;
  }
  const mk = (cnt: number, withColor: boolean): Buf => ({
    pos: new Float32Array(cnt * 6),
    ids: new Uint32Array(cnt),
    col: withColor ? new Float32Array(cnt * 8) : undefined,
    k: 0,
  });
  const rapid = mk(opts.rapids === false ? 0 : segRapid, false);
  const mach = mk(segMach, false);
  const cut = toolOrder.map((_, s) => mk(segCut[s] ?? 0, byFeed));
  const drill = toolOrder.map((_, s) => mk(segDrill[s] ?? 0, byFeed));
  const put = (b: Buf, id: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c?: Rgba): void => {
    const o = b.k * 6;
    b.pos[o] = x0;
    b.pos[o + 1] = y0;
    b.pos[o + 2] = z0;
    b.pos[o + 3] = x1;
    b.pos[o + 4] = y1;
    b.pos[o + 5] = z1;
    b.ids[b.k] = id;
    if (b.col && c) {
      const q = b.k * 8;
      b.col[q] = b.col[q + 4] = c[0];
      b.col[q + 1] = b.col[q + 5] = c[1];
      b.col[q + 2] = b.col[q + 6] = c[2];
      b.col[q + 3] = b.col[q + 7] = c[3];
    }
    b.k++;
  };
  const span = feedMax > feedMin ? feedMax - feedMin : 1;
  const P = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const k = m.kind[i]!;
    const o = i * 3;
    const x0 = pts[o]!;
    const y0 = pts[o + 1]!;
    const z0 = pts[o + 2]!;
    const x1 = pts[o + 3]!;
    const y1 = pts[o + 4]!;
    const z1 = pts[o + 5]!;
    if (m.flags[i]! & FLAG_MACHINE_EST) {
      put(mach, i, x0, y0, z0, x1, y1, z1);
      continue;
    }
    if (k === MOVE_RAPID) {
      if (opts.rapids !== false) put(rapid, i, x0, y0, z0, x1, y1, z1);
      continue;
    }
    const s = toolSet.get(m.tool[i]!)!;
    const c = byFeed ? rampColor(m.feed[i]! > 0 ? (m.feed[i]! - feedMin) / span : 0) : undefined;
    if (k === MOVE_DRILL) {
      put(drill[s]!, i, x0, y0, z0, x1, y1, z1, c);
      continue;
    }
    if (k !== MOVE_ARC) {
      put(cut[s]!, i, x0, y0, z0, x1, y1, z1, c);
      continue;
    }
    // 호 나누기
    const ai = m.arc[i]!;
    const [a0, a1, a2] = PLANE_AXES[a.plane[ai]!]!;
    const cx = a.center[ai * 3 + a0]!;
    const cy = a.center[ai * 3 + a1]!;
    const s0 = [x0, y0, z0];
    const e0 = [x1, y1, z1];
    const u0 = s0[a0]! - cx;
    const v0 = s0[a1]! - cy;
    const r0 = Math.hypot(u0, v0);
    const r1 = Math.hypot(e0[a0]! - cx, e0[a1]! - cy);
    const t0 = Math.atan2(v0, u0);
    const sw = a.sweep[ai]!;
    const cnt = arcN[ai]!;
    const l0 = s0[a2]!;
    const dl = e0[a2]! - l0;
    let px = x0;
    let py = y0;
    let pz = z0;
    for (let j = 1; j <= cnt; j++) {
      let qx: number;
      let qy: number;
      let qz: number;
      if (j === cnt) {
        qx = x1;
        qy = y1;
        qz = z1;
      } else {
        const f = j / cnt;
        const t = t0 + sw * f;
        const r = r0 + (r1 - r0) * f;
        P[a0] = cx + r * Math.cos(t);
        P[a1] = cy + r * Math.sin(t);
        P[a2] = l0 + dl * f;
        qx = P[0]!;
        qy = P[1]!;
        qz = P[2]!;
      }
      put(cut[s]!, i, px, py, pz, qx, qy, qz, c);
      px = qx;
      py = qy;
      pz = qz;
    }
  }

  const lines: LineSet3d[] = [];
  if (rapid.k > 0)
    lines.push({ id: 'nc-rapid', name: '급속 이송', positions: rapid.pos, color: RAPID_COLOR, dashed: true, group: '급속 이송', segmentIds: rapid.ids });
  // 기계 좌표 쪽 추정 이동(G53·G28·M91 등 — 안전 높이로 그림): 범위에 넣지 않는 따로 점선
  if (mach.k > 0)
    lines.push({ id: 'nc-machine', name: '기계 원점 쪽 이동(추정)', positions: mach.pos, color: MACHINE_COLOR, dashed: true, group: '기계 원점 쪽 이동(추정)', segmentIds: mach.ids });
  // 묶음 이름: T번호(이름만 있는 공구는 이름), 공구 없으면 '공구 없음'
  const toolName = (t: number): string => {
    if (t < 0) return '공구 없음';
    const named = t >= 100000 ? p.tools.find((x) => x.number === t)?.name : undefined;
    return named ?? `T${t}`;
  };
  const key = (t: number): string => (t < 0 ? 'none' : String(t));
  toolOrder.forEach((t, s) => {
    const col = colors.get(t) ?? TOOL_COLORS[s % TOOL_COLORS.length]!;
    const group = toolName(t);
    const c = cut[s]!;
    if (c.k > 0) {
      const ls: LineSet3d = { id: `nc-cut-${key(t)}`, name: `${group} 이송`, positions: c.pos, color: col, group, segmentIds: c.ids, width: 1.5 };
      if (c.col) ls.colors = c.col;
      lines.push(ls);
    }
    const d = drill[s]!;
    if (d.k > 0) {
      const ls: LineSet3d = { id: `nc-drill-${key(t)}`, name: `${group} 드릴`, positions: d.pos, color: col, group, segmentIds: d.ids, width: 3 };
      if (d.col) ls.colors = d.col;
      lines.push(ls);
    }
  });

  const points: PointSet3d[] = [];
  const h = p.holes;
  if (h.count > 0) {
    points.push({
      id: 'nc-holes',
      name: '구멍 위치',
      positions: new Float32Array(h.top),
      color: HOLE_COLOR,
      size: 6,
      group: '구멍',
      pointIds: new Uint32Array(h.move),
    });
  }

  // 반경 보정 경로(선택)
  const extraWarnings: string[] = [];
  let compMeta: { first: number; end: number; side: number; radius: number; source: string; line: number; computed: boolean }[] | undefined;
  const compBox = emptyBox();
  if (opts.compPath) {
    const cp = ncCompPath(p, typeof opts.compPath === 'object' ? opts.compPath : {});
    compMeta = cp.runs.map((r) => ({ first: r.first, end: r.end, side: r.side, radius: r.used, source: r.source, line: r.line, computed: r.computed }));
    for (const w of cp.warnings) extraWarnings.push(`보정 경로: ${w}`);
    if (cp.count) {
      const seg = compPathSegments(cp, maxAngle);
      const q = seg.positions;
      for (let i = 0; i < q.length; i += 3) extendBox(compBox, q[i]!, q[i + 1]!, q[i + 2]!);
      lines.push({ id: 'nc-comp', name: '보정 경로(공구 중심)', positions: q, color: COMP_COLOR, group: '보정 경로', segmentIds: seg.ids, width: 2 });
    }
  }
  // 선반: 회전축(Z) 표시
  if (p.lathe && p.bounds) {
    const z0 = Math.min(p.bounds.min[2], 0);
    const z1 = Math.max(p.bounds.max[2], 0);
    const pad = Math.max(1, (z1 - z0) * 0.05);
    lines.push({ id: 'lathe-axis', name: '회전축(Z)', positions: new Float32Array([0, 0, z0 - pad, 0, 0, z1 + pad]), color: AXIS_COLOR, dashed: true, group: '회전축' });
  }

  const meshes: Mesh3d[] = [];
  let stock: Box3 | undefined;
  if (opts.stock === undefined) stock = p.stock;
  else if (opts.stock === 'auto') stock = p.feedBounds ?? p.bounds;
  else if (opts.stock) stock = opts.stock;
  if (stock) meshes.push(stockMesh('nc-stock', stock));

  const box = emptyBox();
  for (const b of [p.bounds, stock, boxOf(compBox)]) {
    if (!b) continue;
    extendBox(box, b.min[0], b.min[1], b.min[2]);
    extendBox(box, b.max[0], b.max[1], b.max[2]);
  }
  const scene: Scene3d = {
    name: p.name,
    units: p.units,
    meshes,
    lines,
    points,
    warnings: extraWarnings.length ? [...p.warnings, ...extraWarnings] : p.warnings.slice(),
    meta: {
      kind: 'nc',
      format: p.format,
      dialect: p.dialect,
      dialectName: NC_DIALECT_NAMES[p.dialect],
      units: p.units,
      lineCount: p.source.lineCount,
      moveCount: m.count,
      holeCount: h.count,
      stats: { ...p.stats },
      tools: p.tools.map((t) => ({ ...t, color: colors.get(t.number) ?? RAPID_COLOR })),
      feedRange: feedMax >= feedMin ? [feedMin, feedMax] : undefined,
      /** 실제로 쓴 호 나누기 각(라디안) */
      arcAngle: maxAngle,
      /** 이동 번호 → 원본 줄 번호(0부터). segmentIds·pointIds를 줄로 바꿀 때 */
      moveLine: m.line,
      /** 반경 보정 구간 수(보정 코드가 있으면) */
      compRunCount: p.compRuns?.length ?? 0,
      /** 보정 경로를 넣었으면 구간마다 반지름·계산 여부 */
      compRuns: compMeta,
      lathe: !!p.lathe,
      rotaryAxes: !!p.rotaryAxes,
    },
  };
  const bb = boxOf(box);
  if (bb) scene.bounds = bb;
  return scene;
}

function stockMesh(id: string, b: Box3, name = '공작물'): Mesh3d {
  const acc = new MeshAccum();
  acc.aabb(b.min, b.max);
  const arr = acc.arrays();
  return { id, name, ...arr, color: STOCK_COLOR, group: '공작물', doubleSided: true };
}

// ───────────────────────── MPR ─────────────────────────

export interface MprSceneOptions {
  /** 원호를 나눌 최대 각도(라디안, 기본 5도) */
  arcAngle?: number;
  /** 꺼진 가공(??=0, EN=0)도 그릴지(기본 false) */
  disabled?: boolean;
  /** 가공에 쓰이지 않은 윤곽도 얇은 선으로 그릴지(기본 true) */
  contours?: boolean;
}

const BOARD_COLOR: Rgba = [0.86, 0.74, 0.55, 0.35];
const DRILL_V_COLOR: Rgba = [0.75, 0.2, 0.15, 1];
const DRILL_H_COLOR: Rgba = [0.15, 0.35, 0.8, 1];
const GROOVE_COLOR: Rgba = [0.2, 0.6, 0.3, 0.85];
const POCKET_COLOR: Rgba = [0.55, 0.3, 0.7, 0.75];
const CONTOUR_COLOR: Rgba = [0.5, 0.5, 0.5, 1];
/** 판 면으로 들어가는 방향 */
const FACE_DIR: Record<PanelFace, readonly [number, number, number]> = { top: [0, 0, -1], bottom: [0, 0, 1], left: [1, 0, 0], right: [-1, 0, 0], front: [0, 1, 0], back: [0, -1, 0] };

/** 판재 가공 모델(MPR·PGI·XML)을 장면으로 */
export function mprToScene(part: MprPart, opts: MprSceneOptions = {}): Scene3d {
  const maxAngle = opts.arcAngle ?? Math.PI / 36;
  const meshes: Mesh3d[] = [];
  const lines: LineSet3d[] = [];
  const points: PointSet3d[] = [];
  const box = emptyBox();
  const wp = part.workpiece;
  if (wp) {
    const acc = new MeshAccum();
    if (wp.outline && wp.outline.length > 2) {
      // 직사각형이 아닌 판(PGI·XML 외곽선): 윗면 외곽선을 두께만큼 아래로 민 기둥
      const seg: number[] = [];
      tessellatePath(wp.outline.map((q) => ({ ...q, z: wp.thickness })), maxAngle, seg);
      const ring = seg.slice(0, 3);
      for (let i = 3; i < seg.length; i += 6) ring.push(seg[i]!, seg[i + 1]!, seg[i + 2]!);
      acc.prism(ring, [0, 0, -1], wp.thickness);
      for (let i = 0; i < ring.length; i += 3) extendBox(box, ring[i]!, ring[i + 1]!, 0);
    }
    if (acc.isEmpty()) acc.aabb([0, 0, 0], [wp.length, wp.width, wp.thickness]);
    meshes.push({ id: 'mpr-board', name: `판 ${fmt(wp.length)}×${fmt(wp.width)}×${fmt(wp.thickness)}`, ...acc.arrays(), color: BOARD_COLOR, group: '공작물', doubleSided: true });
    extendBox(box, 0, 0, 0);
    extendBox(box, wp.length, wp.width, wp.thickness);
  }
  const colors = new Map<number, Rgba>();
  const toolColor = (t: number | undefined): Rgba => {
    const k = t ?? -1;
    let c = colors.get(k);
    if (!c) {
      c = TOOL_COLORS[colors.size % TOOL_COLORS.length]!;
      colors.set(k, c);
    }
    return c;
  };
  const usedContours = new Set<number>();
  const centers: number[] = [];
  const centerIds: number[] = [];
  const others: number[] = [];
  const otherIds: number[] = [];
  part.operations.forEach((op, oi) => {
    if (!op.enabled && !opts.disabled) return;
    const group = op.enabled ? opGroup(op.kind) : '꺼진 가공';
    switch (op.kind) {
      case 'drillV':
      case 'drillH': {
        if (!op.holes.length || !(op.diameter > 0)) return;
        const acc = new MeshAccum();
        const r = op.diameter / 2;
        const seg = Math.max(12, Math.min(32, Math.round(op.diameter * 2)));
        for (const hole of op.holes) {
          acc.cylinder(hole.start, hole.dir, hole.depth, r, seg, true);
          centers.push(hole.start[0]!, hole.start[1]!, hole.start[2]!);
          centerIds.push(oi);
          for (const q of [hole.start, [hole.start[0]! + hole.dir[0]! * hole.depth, hole.start[1]! + hole.dir[1]! * hole.depth, hole.start[2]! + hole.dir[2]! * hole.depth]])
            extendBox(box, q[0]!, q[1]!, q[2]!);
        }
        meshes.push({
          id: `mpr-op-${oi}`,
          // PGI·XML 이름에는 지름·깊이가 이미 들어 있다
          name: op.face ? op.label : `${op.label} Ø${fmt(op.diameter)} 깊이 ${fmt(op.depth)}`,
          ...acc.arrays(),
          color: op.kind === 'drillV' ? DRILL_V_COLOR : DRILL_H_COLOR,
          group,
        });
        return;
      }
      case 'groove':
      case 'pocket': {
        if (op.prism) {
          const pr = op.prism;
          const acc = new MeshAccum();
          acc.prism(pr.outline, pr.dir, pr.depth);
          if (acc.isEmpty()) return;
          meshes.push({ id: `mpr-op-${oi}`, name: op.label, ...acc.arrays(), color: op.kind === 'groove' ? GROOVE_COLOR : POCKET_COLOR, group, doubleSided: true });
          for (let i = 0; i + 2 < pr.outline.length; i += 3)
            for (const k of [0, pr.depth])
              extendBox(box, pr.outline[i]! + pr.dir[0] * k, pr.outline[i + 1]! + pr.dir[1] * k, pr.outline[i + 2]! + pr.dir[2] * k);
          return;
        }
        if (!op.box) return;
        const acc = new MeshAccum();
        acc.box(op.box.origin, op.box.u, op.box.v, op.box.w);
        meshes.push({
          id: `mpr-op-${oi}`,
          name: op.label,
          ...acc.arrays(),
          color: op.kind === 'groove' ? GROOVE_COLOR : POCKET_COLOR,
          group,
          doubleSided: true,
        });
        const o = op.box.origin;
        for (const [a, b, c] of [
          [0, 0, 0],
          [1, 1, 1],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 1, 0],
          [0, 1, 1],
          [1, 0, 1],
        ] as const)
          extendBox(
            box,
            o[0]! + a * op.box.u[0]! + b * op.box.v[0]! + c * op.box.w[0]!,
            o[1]! + a * op.box.u[1]! + b * op.box.v[1]! + c * op.box.w[1]!,
            o[2]! + a * op.box.u[2]! + b * op.box.v[2]! + c * op.box.w[2]!,
          );
        return;
      }
      case 'contour': {
        if (op.contour !== undefined) usedContours.add(op.contour);
        const path = op.path;
        if (!path || path.length < 2) return;
        const seg: number[] = [];
        tessellatePath(path, maxAngle, seg);
        for (let i = 0; i < seg.length; i += 3) extendBox(box, seg[i]!, seg[i + 1]!, seg[i + 2]!);
        // 시작의 깊이 표시(들어가는 면에서 경로까지 선. 면을 모르면(MPR) 윗면에서)
        if (op.face && op.depth !== undefined && op.depth > 0) {
          const d = FACE_DIR[op.face];
          const s0 = path[0]!;
          seg.push(s0.x - d[0] * op.depth, s0.y - d[1] * op.depth, s0.z - d[2] * op.depth, s0.x, s0.y, s0.z);
        } else if (wp) {
          const top = wp.thickness;
          const sx = path[0]!.x;
          const sy = path[0]!.y;
          const sz = path[0]!.z;
          if (sz < top) seg.push(sx, sy, top, sx, sy, sz);
        }
        const ids = new Uint32Array(seg.length / 6).fill(oi);
        lines.push({ id: `mpr-op-${oi}`, name: op.label, positions: new Float32Array(seg), color: toolColor(op.tool), group, segmentIds: ids, width: 2 });
        return;
      }
      case 'other':
        // 모르는 매크로: 위치만 점으로(묶음 '기타 가공(위치)')
        if (op.at) {
          others.push(op.at[0], op.at[1], op.at[2]);
          otherIds.push(oi);
          extendBox(box, op.at[0], op.at[1], op.at[2]);
        }
        return;
      default:
        return;
    }
  });
  if (opts.contours !== false) {
    const seg: number[] = [];
    const ids: number[] = [];
    for (const c of part.contours) {
      if (usedContours.has(c.id) || c.elements.length < 2) continue;
      const before = seg.length;
      tessellatePath(c.elements, maxAngle, seg);
      for (let i = before; i < seg.length; i += 6) ids.push(c.id);
      for (let i = before; i < seg.length; i += 3) extendBox(box, seg[i]!, seg[i + 1]!, seg[i + 2]!);
    }
    if (seg.length) lines.push({ id: 'mpr-contours', name: '윤곽(가공 없음)', positions: new Float32Array(seg), color: CONTOUR_COLOR, dashed: true, group: '윤곽', segmentIds: new Uint32Array(ids) });
  }
  if (centers.length)
    points.push({ id: 'mpr-hole-centers', name: '구멍 중심', positions: new Float32Array(centers), color: [0.1, 0.1, 0.1, 1], size: 4, group: '구멍', pointIds: new Uint32Array(centerIds) });
  if (others.length)
    points.push({ id: 'mpr-other-pos', name: '지원하지 않는 가공 위치', positions: new Float32Array(others), color: [0.95, 0.6, 0.1, 1], size: 7, group: '기타 가공(위치)', pointIds: new Uint32Array(otherIds) });
  const scene: Scene3d = {
    name: part.name,
    units: part.units,
    meshes,
    lines,
    points,
    warnings: part.warnings.slice(),
    meta: {
      kind: 'mpr',
      format: part.format,
      version: part.version,
      units: part.units,
      workpiece: wp,
      lineCount: part.lines.length,
      tools: [...new Set(part.operations.map((o) => o.tool).filter((t): t is number => t !== undefined))].map((t) => ({ number: t, color: toolColor(t) })),
      operations: part.operations.map((o, i) => ({
        index: i,
        kind: o.kind,
        macroId: o.macroId,
        macro: o.macro,
        label: o.label,
        line: o.line,
        enabled: o.enabled,
        tool: o.tool,
        diameter: 'diameter' in o ? o.diameter : undefined,
        depth: 'depth' in o ? o.depth : undefined,
        holeCount: 'holes' in o ? o.holes.length : undefined,
      })),
      contourCount: part.contours.length,
      variables: part.variables.map((v) => ({ name: v.name, value: v.value, expr: v.expr, comment: v.comment })),
      stats: part.stats,
    },
  };
  const bb = boxOf(box);
  if (bb) scene.bounds = bb;
  return scene;
}

function opGroup(kind: string): string {
  switch (kind) {
    case 'drillV':
      return '수직 구멍';
    case 'drillH':
      return '수평 구멍';
    case 'contour':
      return '윤곽 가공';
    case 'groove':
      return '홈';
    case 'pocket':
      return '포켓';
    default:
      return '기타';
  }
}

function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** 윤곽 점열(선·호)을 선분 쌍으로 */
export function tessellatePath(path: readonly PathPoint[], maxAngle: number, out: number[]): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (!b.arc) {
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
      continue;
    }
    const { cx, cy, sweep } = b.arc;
    const r0 = Math.hypot(a.x - cx, a.y - cy);
    const r1 = Math.hypot(b.x - cx, b.y - cy);
    const t0 = Math.atan2(a.y - cy, a.x - cx);
    const n = Math.max(1, Math.min(2048, Math.ceil(Math.abs(sweep) / maxAngle - 1e-9)));
    let px = a.x;
    let py = a.y;
    let pz = a.z;
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const t = t0 + sweep * f;
      const r = r0 + (r1 - r0) * f;
      const qx = k === n ? b.x : cx + r * Math.cos(t);
      const qy = k === n ? b.y : cy + r * Math.sin(t);
      const qz = a.z + (b.z - a.z) * f;
      out.push(px, py, pz, qx, qy, qz);
      px = qx;
      py = qy;
      pz = qz;
    }
  }
}
