/**
 * WangShi 판재 가공 프로그램 해석기: PGI(`<pgi>`)와 KDT XML(`<KDTPanelFormat>`). 결과는 MPR과 같은 MprPart다.
 *
 * 두 형식은 같은 가공(구멍, 톱 선, 사각 포켓, 경로, 원)을 같은 좌표로 적는다.
 * - 원점은 판 왼쪽 앞 아래 모서리, X = 길이, Y = 폭. 윗면·아랫면 위치는 둘 다 위에서 본 (x, y)다(아랫면도 뒤집지 않는다).
 * - 옆면 높이(PGI z·centerZ·strZ, XML Z1)는 아랫면에서 잰다(z = 값).
 * - 문서 차례가 가공 차례다. 깊이는 들어가는 면에서 잰다.
 *
 * PGI(값은 속성):
 *   <pgi><params><param key="L" value="600" description=""/>…</params>
 *    <panel length width thickness name frontID material remark …>
 *     <outlines><outline x y bulge banding/>…</outlines>
 *     <hole x y z diameter depth direction no xi yi zi enable/>          구멍(no ≥ 2면 xi·yi·zi 간격의 줄)
 *     <line startX startY startZ endX endY endZ width depth direction isSaw/>   톱(isSaw=1) 또는 직선 경로
 *     <pocket length width depth direction cornerRadius angle centerX centerY centerZ>
 *       <extensions><extension key="strX" value/>…</extensions></pocket>          사각 포켓(가운데 또는 strX·strY 모서리)
 *     <path direction toolOffset width depth close empty><vertex x y z bulge/>…</path>
 *     <circle centerX centerY centerZ radius width toolName empty depth direction/>
 *   direction은 공구가 나아가는 쪽이다: z- 윗면, z+ 아랫면, x+ 왼쪽면, x- 오른쪽면, y+ 앞면, y- 뒷면.
 *   bulge는 꼭짓점에서 나가는 변의 DXF bulge(tan(중심각/4), + 반시계)다. ±1은 "호" 표시로 쓰여 들어오는 접선을 잇는 호로
 *   풀고(반원이 넘으면 반원), 접선이 없을 때만 반원으로 본다.
 *
 * KDT XML(값은 자식 요소의 글):
 *   <KDTPanelFormat><PANEL><PanelLength/><PanelWidth/><PanelThickness/><Inch/><Params><Param Key Value/></Params>
 *     <PanelOutline><Vertex><X1/><Y1/><Bulge/><Banding/></Vertex>…</PanelOutline></PANEL>
 *    <CAD><TypeNo>1</TypeNo><TypeName>Vertical Hole</TypeName><X1/><Y1/>…</CAD>…</KDTPanelFormat>
 *   TypeNo 1·8 수직 구멍(윗·아랫면), 2 수평 구멍(Quadrant 1 오른쪽·2 왼쪽·3 뒷·4 앞면), 3·13 선(UseSaw=1이면 톱),
 *   5 원(윗면), 6·16 사각(X1·Y1 = 최소 모서리), 26 옆면 사각(Quadrant, Z1 = 아래 모서리 높이),
 *   7·17 경로(<Point> 다음 <Line>·<Arc Radius Direction>, Relative=1이면 증분).
 *
 * 값에는 판 변수 식을 쓸 수 있다(`W-13`, `300+(40)/2`, `L`). L·W·T는 판 크기다. enable·Enable이 0·false·no이면 꺼진 가공이다.
 * 공구가 원을 다 채우면(T35 도어 컵처럼 공구 폭 ≥ 지름) 한 번에 뚫는 구멍으로, 닫힌 empty 경로는 포켓으로 본다.
 * 모르는 요소는 위치를 알면 점으로, 모르면 목록에만 넣는다.
 */
import { ExprError, evalMprExpr } from './expr';
import { NcWarnings, type PathPoint } from './model';
import type { MprBoxOp, MprContourOp, MprDrillOp, MprHole, MprOperation, MprOtherOp, MprPart, MprVariable, MprWorkpiece, PanelFace } from './mpr';
import { decodeXmlBytes, parseXml, xmlAttr, xmlChild, xmlChildren, xmlField, xmlRootName, XmlError, type XmlElement } from './xml';

export interface PanelReadOptions {
  /** 프로그램 이름(기본: PGI frontID, XML PanelName, 없으면 형식 이름) */
  name?: string;
}

type Vec3 = [number, number, number];
type Vec2 = [number, number];

/** 변이 어떻게 굽는지(PGI bulge, XML <Arc>) */
interface ArcHint {
  /** 참 DXF bulge(±1 표시가 아닌 값) */
  bulge?: number;
  /** 반지름(XML <Arc Radius>) */
  radius?: number;
  /** 접선을 모를 때 반원의 방향 */
  ccw: boolean;
}

/** 면 안 좌표의 경로 꼭짓점. arc는 이 점에서 끝나는 변의 모양 */
interface FacePoint {
  a: number;
  b: number;
  arc?: ArcHint;
}

/** 면 평면 좌표(p, q)의 변: 끝점과 호면 중심·중심각(반시계 +) */
interface PlaneSeg {
  p: number;
  q: number;
  arc?: { cp: number; cq: number; sweep: number };
}

const FACE_DIR: Record<PanelFace, Vec3> = { top: [0, 0, -1], bottom: [0, 0, 1], left: [1, 0, 0], right: [-1, 0, 0], front: [0, 1, 0], back: [0, -1, 0] };
const FACE_SUFFIX: Record<PanelFace, string> = { top: '', bottom: ' (아랫면)', left: ' (왼쪽면)', right: ' (오른쪽면)', front: ' (앞면)', back: ' (뒷면)' };
const PGI_FACES: Record<string, PanelFace> = { 'z-': 'top', 'z+': 'bottom', 'x+': 'left', 'x-': 'right', 'y+': 'front', 'y-': 'back' };
const QUADRANT_FACES: Record<string, PanelFace> = { '1': 'right', '2': 'left', '3': 'back', '4': 'front' };
/** 전용 공구 이름 → 지름(WangShi 35 mm 도어 컵 공구) */
const KNOWN_TOOLS: Record<string, number> = { T35: 35 };
/** 구멍 줄(no) 한도 */
const MAX_HOLE_ROW = 1000;
/** 옆면 구멍이 면 위에 있다고 볼 거리(mm) */
const SIDE_TOLERANCE = 0.1;
const ARC_STEP = Math.PI / 36;
const EPS = 1e-9;

const broad = (f: PanelFace): boolean => f === 'top' || f === 'bottom';
const fmt = (v: number): string => String(Math.round(v * 1000) / 1000 + 0);
const disabledFlag = (v: string | undefined): boolean => ['0', 'false', 'no'].includes((v ?? '').trim().toLowerCase());

/** 한 요소를 해석하지 못함 — 목록에 '해석 실패'로 남긴다 */
class Problem extends Error {}

// ───────────────────────── 수·변수 ─────────────────────────

/** 수 또는 판 변수 식을 계산한다 */
class Numbers {
  private env = new Map<string, number>();
  private lower = new Map<string, number>();
  private lookup = { get: (n: string): number | undefined => this.env.get(n) ?? this.lower.get(n.toLowerCase()) };

  set(name: string, v: number): void {
    this.env.set(name, v);
    this.lower.set(name.toLowerCase(), v);
  }

  has(name: string): boolean {
    return this.lookup.get(name) !== undefined;
  }

  get(name: string): number | undefined {
    return this.lookup.get(name);
  }

  /** 비었거나 계산할 수 없으면 undefined */
  value(raw: string | undefined): number | undefined {
    const e = (raw ?? '').trim();
    if (!e) return undefined;
    const n = Number(e);
    if (Number.isFinite(n)) return n;
    try {
      const v = evalMprExpr(e, this.lookup);
      return Number.isFinite(v) && Math.abs(v) < 1e7 ? v : undefined;
    } catch (err) {
      if (!(err instanceof ExprError)) throw err;
      return undefined;
    }
  }
}

/** 값 하나를 읽는 쪽(PGI 속성, XML 자식 글) */
interface Fields {
  /** 경고·오류 글의 이름(`<hole>`, `CAD 1 Vertical Hole`) */
  label: string;
  get(name: string): string | undefined;
}

class Values {
  constructor(
    readonly nums: Numbers,
    readonly w: NcWarnings,
    readonly f: Fields,
    readonly line: number,
  ) {}

  /** 꼭 있어야 하는 값(dflt를 주면 없을 때 그 값) */
  num(name: string, dflt?: number): number {
    const raw = this.f.get(name);
    if (raw === undefined || !raw.trim()) {
      if (dflt !== undefined) return dflt;
      throw new Problem(`${this.f.label}: ${name} 값이 없어 해석하지 못함`);
    }
    const v = this.nums.value(raw);
    if (v === undefined) throw new Problem(`${this.f.label}: ${name} 값('${raw.trim()}')을 숫자로 읽을 수 없어 해석하지 못함`);
    return v;
  }

  /** 있으면 읽고, 없거나 읽을 수 없으면 undefined */
  opt(name: string): number | undefined {
    return this.nums.value(this.f.get(name));
  }

  positive(name: string): number {
    const v = this.num(name);
    if (!(v > 0)) throw new Problem(`${this.f.label}: ${name} 값(${fmt(v)})은 0보다 커야 함`);
    return v;
  }

  depth(name: string): number {
    const v = this.num(name);
    if (v < 0) this.w.add(`${this.f.label}: 깊이가 음수(${fmt(v)})여서 절댓값으로 읽음`, this.line);
    return Math.abs(v);
  }

  /** '0'이 아니면 참(없으면 dflt) */
  flag(name: string, dflt: boolean): boolean {
    const raw = (this.f.get(name) ?? '').trim();
    if (!raw) return dflt;
    return raw !== '0' && raw.toLowerCase() !== 'false';
  }

  text(name: string): string | undefined {
    const raw = this.f.get(name)?.trim();
    return raw ? raw : undefined;
  }
}

function readVariables(entries: { key: string; value: string; comment?: string; line: number }[], nums: Numbers): MprVariable[] {
  const out: MprVariable[] = [];
  for (const e of entries) {
    const name = e.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const v: MprVariable = { name, expr: e.value, line: e.line };
    const value = nums.value(e.value);
    if (value !== undefined) {
      v.value = value;
      nums.set(name, value);
    }
    if (e.comment) v.comment = e.comment;
    out.push(v);
  }
  return out;
}

function dimension(nums: Numbers, raw: string | undefined, variable: string, field: string): number {
  const v = nums.value(raw) ?? nums.get(variable);
  if (v === undefined || !(v > 0)) throw new Error(`판 크기(${field}) 값이 없거나 0보다 크지 않습니다.`);
  return v;
}

// ───────────────────────── 면·평면 ─────────────────────────

/** 면 평면 좌표: 윗·아랫면 (x, y), 앞·뒷면 (z, x), 왼·오른쪽면 (y, z). 호의 반시계는 이 평면의 법선(+Z, +Y, +X)으로 본다 */
function toPlane(face: PanelFace, v: Vec3): Vec3 {
  if (broad(face)) return [v[0], v[1], v[2]];
  if (face === 'front' || face === 'back') return [v[2], v[0], v[1]];
  return [v[1], v[2], v[0]];
}

function fromPlane(face: PanelFace, p: number, q: number, n: number): Vec3 {
  if (broad(face)) return [p, q, n];
  if (face === 'front' || face === 'back') return [q, n, p];
  return [n, p, q];
}

function bulgeArc(s: Vec2, e: Vec2, bulge: number): { c: Vec2; ccw: boolean } | null {
  const chord = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (chord <= EPS || Math.abs(bulge) <= EPS) return null;
  const theta = 4 * Math.atan(bulge);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const d = Math.sqrt(Math.max(r * r - (chord * chord) / 4, 0));
  const ux = -(e[1] - s[1]) / chord;
  const uy = (e[0] - s[0]) / chord;
  // 반시계 작은 호는 중심이 현의 왼쪽, 반원보다 크면 반대쪽
  let side = bulge > 0 ? 1 : -1;
  if (Math.abs(bulge) > 1) side = -side;
  return { c: [(s[0] + e[0]) / 2 + side * d * ux, (s[1] + e[1]) / 2 + side * d * uy], ccw: bulge > 0 };
}

/** 반지름 r인 작은 호. 들어오는 접선을 알면 그것과 이어지는 쪽 */
function radiusArc(s: Vec2, e: Vec2, r: number, tangent: Vec2 | undefined, ccw: boolean): { c: Vec2; ccw: boolean } {
  const dx = e[0] - s[0];
  const dy = e[1] - s[1];
  const chord = Math.hypot(dx, dy);
  const h = Math.sqrt(Math.max(r * r - (chord * chord) / 4, 0));
  const mx = s[0] + dx / 2;
  const my = s[1] + dy / 2;
  const lx = -dy / chord;
  const ly = dx / chord;
  const left = { c: [mx + h * lx, my + h * ly] as Vec2, ccw: true };
  const right = { c: [mx - h * lx, my - h * ly] as Vec2, ccw: false };
  if (!tangent) return ccw ? left : right;
  const dot = (a: { c: Vec2; ccw: boolean }): number => {
    const t = arcTangent(s, a.c, a.ccw);
    return t[0] * tangent[0] + t[1] * tangent[1];
  };
  return dot(left) >= dot(right) ? left : right;
}

/** 들어오는 접선을 이어 가는 호(모깎기). 접선이 없거나 반원을 넘으면 반원 */
function tangentArc(s: Vec2, e: Vec2, tangent: Vec2 | undefined, ccw: boolean): { c: Vec2; ccw: boolean } | null {
  const dx = e[0] - s[0];
  const dy = e[1] - s[1];
  const chord = Math.hypot(dx, dy);
  const mid: Vec2 = [s[0] + dx / 2, s[1] + dy / 2];
  if (!tangent) return { c: mid, ccw };
  const cross = tangent[0] * dy - tangent[1] * dx;
  const dot = tangent[0] * dx + tangent[1] * dy;
  if (Math.abs(cross) <= 1e-9 * chord) return dot > 0 ? null : { c: mid, ccw };
  const left = cross > 0;
  if (dot < -1e-9 * chord) return { c: mid, ccw: left };
  const r = (chord * chord) / (2 * Math.abs(cross));
  const side = left ? 1 : -1;
  return { c: [s[0] - side * r * tangent[1], s[1] + side * r * tangent[0]], ccw: left };
}

function arcTangent(pt: Vec2, c: Vec2, ccw: boolean): Vec2 {
  const rx = pt[0] - c[0];
  const ry = pt[1] - c[1];
  const l = Math.hypot(rx, ry);
  if (l <= EPS) return [1, 0];
  return ccw ? [-ry / l, rx / l] : [ry / l, -rx / l];
}

function sweepOf(s: Vec2, e: Vec2, c: Vec2, ccw: boolean): number {
  const TAU = Math.PI * 2;
  let sw = Math.atan2(e[1] - c[1], e[0] - c[0]) - Math.atan2(s[1] - c[1], s[0] - c[0]);
  if (ccw) while (sw <= 1e-12) sw += TAU;
  else while (sw >= -1e-12) sw -= TAU;
  return sw;
}

/** 평면 좌표 점열(시작점 + 변들)을 꺾은선으로 나눈다(시작점 포함) */
function tessellate(start: Vec2, segs: readonly PlaneSeg[], step = ARC_STEP): Vec2[] {
  const out: Vec2[] = [start];
  let prev = start;
  for (const sg of segs) {
    if (sg.arc) {
      const { cp, cq, sweep } = sg.arc;
      const r = Math.hypot(prev[0] - cp, prev[1] - cq);
      const t0 = Math.atan2(prev[1] - cq, prev[0] - cp);
      const n = Math.max(1, Math.min(720, Math.ceil(Math.abs(sweep) / step - 1e-9)));
      for (let k = 1; k < n; k++) out.push([cp + r * Math.cos(t0 + (sweep * k) / n), cq + r * Math.sin(t0 + (sweep * k) / n)]);
    }
    prev = [sg.p, sg.q];
    out.push(prev);
  }
  return out;
}

// ───────────────────────── 판 가공 모음 ─────────────────────────

interface Base {
  macroId: number;
  macro: string;
  label: string;
  line: number;
  endLine: number;
  enabled: boolean;
  face?: PanelFace;
  params: Record<string, string>;
}

class PanelBuilder {
  readonly ops: MprOperation[] = [];
  readonly stats = { holes: 0, drillOps: 0, contourOps: 0, grooves: 0, pockets: 0, disabled: 0, other: 0 };

  constructor(
    readonly L: number,
    readonly W: number,
    readonly T: number,
    readonly w: NcWarnings,
    /** 판 외곽선(XY 꼭짓점과 나가는 변의 bulge). 직사각형이면 비운다 */
    readonly outline: { x: number; y: number; bulge: number }[] = [],
  ) {}

  /** 면 안 좌표 (a, b) → 면 위 점. a·b는 윗·아랫면 (x, y), 앞·뒷면 (x, z), 왼·오른쪽면 (y, z) */
  surface(face: PanelFace, a: number, b: number): Vec3 {
    switch (face) {
      case 'top':
        return [a, b, this.T];
      case 'bottom':
        return [a, b, 0];
      case 'front':
        return [a, 0, b];
      case 'back':
        return [a, this.W, b];
      case 'left':
        return [0, a, b];
      default:
        return [this.L, a, b];
    }
  }

  /** 프로그램 값 (x, y, z = 아랫면에서의 높이) → 면 안 좌표 */
  inFace(face: PanelFace, x: number, y: number, z: number): Vec2 {
    if (broad(face)) return [x, y];
    return face === 'left' || face === 'right' ? [y, z] : [x, z];
  }

  /** 면 위 점에서 공구 방향으로 판을 뚫고 나가기까지의 거리 */
  reach(face: PanelFace, p: Vec3): number {
    switch (face) {
      case 'top':
        return p[2];
      case 'bottom':
        return this.T - p[2];
      case 'left':
        return this.L - p[0];
      case 'right':
        return p[0];
      case 'front':
        return this.W - p[1];
      default:
        return p[1];
    }
  }

  push(op: MprOperation): void {
    this.ops.push(op);
    const s = this.stats;
    if (!op.enabled) s.disabled++;
    if (op.kind === 'other') s.other++;
    else if (!op.enabled) return;
    else if (op.kind === 'drillV' || op.kind === 'drillH') {
      s.drillOps++;
      s.holes += op.holes.length;
    } else if (op.kind === 'contour') s.contourOps++;
    else if (op.kind === 'groove') s.grooves++;
    else if (op.kind === 'pocket') s.pockets++;
  }

  /**
   * 옆면 구멍이 시작하는 벽(면을 가로지르는 좌표). 외곽선이 없으면 상자 면(0·L·0·W)이고, 있으면 구멍 축을 가로지르는 곧은
   * 외곽선 변 가운데 구멍 옆을 지나고 바깥이 공구 쪽을 보는 변(노치 벽 포함)이다. 프로그램 값이 어느 벽에도 없으면 드릴이
   * 처음 만나는 벽에서 뚫는 것으로 보고 알린다.
   */
  sideWall(face: PanelFace, across: number, along: number, label: string, line: number): number {
    const xAxis = face === 'left' || face === 'right';
    const fromMax = face === 'right' || face === 'back';
    const box = fromMax ? (xAxis ? this.L : this.W) : 0;
    const walls: number[] = [];
    const ol = this.outline;
    if (ol.length < 3) walls.push(box);
    else {
      let area = 0;
      for (let i = 0; i < ol.length; i++) {
        const a = ol[i]!;
        const b = ol[(i + 1) % ol.length]!;
        area += a.x * b.y - b.x * a.y;
      }
      const turn = area > 0 ? 1 : -1;
      for (let i = 0; i < ol.length; i++) {
        const s = ol[i]!;
        const e = ol[(i + 1) % ol.length]!;
        if (Math.abs(s.bulge) > EPS) continue;
        const a0 = xAxis ? s.x : s.y;
        const a1 = xAxis ? e.x : e.y;
        const b0 = xAxis ? s.y : s.x;
        const b1 = xAxis ? e.y : e.x;
        if (Math.abs(a1 - a0) > SIDE_TOLERANCE || along < Math.min(b0, b1) - SIDE_TOLERANCE || along > Math.max(b0, b1) + SIDE_TOLERANCE) continue;
        // 반시계 외곽선 변의 바깥 법선 = 변을 시계로 돌린 것
        const normal = (xAxis ? e.y - s.y : s.x - e.x) * turn;
        if (normal * (fromMax ? 1 : -1) > 0) walls.push((a0 + a1) / 2);
      }
      if (!walls.length) walls.push(box);
    }
    const on = walls.reduce((m, v) => (Math.abs(v - across) < Math.abs(m - across) ? v : m), walls[0]!);
    if (Math.abs(on - across) <= SIDE_TOLERANCE + EPS) return on;
    const first = fromMax ? Math.max(...walls) : Math.min(...walls);
    const axis = xAxis ? 'x' : 'y';
    this.w.add(`${label}: 옆면 구멍 좌표(${axis} ${fmt(across)})가 면 위에 있지 않음 — ${axis} ${fmt(first)} 면에서 뚫는 것으로 그림`, line);
    return first;
  }

  /** 구멍(줄): positions는 면 안 좌표. wall은 옆면 구멍이 시작하는 벽(면을 가로지르는 좌표) */
  hole(base: Base, face: PanelFace, positions: Vec2[], diameter: number, depth: number, toolName?: string, wall?: number): void {
    const dir = FACE_DIR[face];
    const holes: MprHole[] = [];
    let through = false;
    for (const [a, b] of positions) {
      const start = this.surface(face, a, b);
      if (wall !== undefined) {
        if (face === 'left' || face === 'right') start[0] = wall;
        else if (face === 'front' || face === 'back') start[1] = wall;
      }
      const reach = this.reach(face, start);
      if (depth >= reach - 1e-9) through = true;
      holes.push({ start, dir: [...dir], depth: Math.max(0, Math.min(depth, reach)) });
    }
    const vertical = broad(face);
    const cup = vertical && Math.abs(diameter - 35) <= 0.5 && (toolName ?? '').trim().toUpperCase() === 'T35';
    const what = cup ? '도어 컵' : vertical ? '수직 드릴' : '수평 드릴';
    const row = positions.length > 1 ? ` (${positions.length}개)` : '';
    const op: MprDrillOp = {
      ...base,
      face,
      label: `${what} Ø${fmt(diameter)} × ${fmt(depth)}${row}${FACE_SUFFIX[face]}`,
      kind: vertical ? 'drillV' : 'drillH',
      holes,
      diameter,
      depth,
      through,
    };
    this.push(op);
  }

  /** 톱 선(폭을 알면 홈 상자) 또는 직선 경로 */
  line(base: Base, face: PanelFace, s2: Vec2, e2: Vec2, width: number, depth: number, saw: boolean): void {
    const s = this.surface(face, s2[0], s2[1]);
    const e = this.surface(face, e2[0], e2[1]);
    const len = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
    const dir = FACE_DIR[face];
    const suffix = FACE_SUFFIX[face];
    if (saw && width > 0 && len > EPS) {
      const u = [(e[0] - s[0]) / len, (e[1] - s[1]) / len, (e[2] - s[2]) / len];
      // 홈 폭 방향 = 공구 방향 × 선 방향(세 변이 오른손 차례가 되게)
      const v = [dir[1] * u[2]! - dir[2] * u[1]!, dir[2] * u[0]! - dir[0] * u[2]!, dir[0] * u[1]! - dir[1] * u[0]!].map((x) => x * width);
      const d = Math.max(0, Math.min(depth, this.reach(face, s)));
      const op: MprBoxOp = {
        ...base,
        face,
        label: `톱 홈 ${fmt(len)} × ${fmt(depth)} · 폭 ${fmt(width)}${suffix}`,
        kind: 'groove',
        depth,
        width,
        length: len,
        box: { origin: [s[0] - v[0]! / 2, s[1] - v[1]! / 2, s[2] - v[2]! / 2], u: [e[0] - s[0], e[1] - s[1], e[2] - s[2]], v, w: dir.map((x) => x * d) },
      };
      this.push(op);
      return;
    }
    const at = (p: Vec3): PathPoint => ({ x: p[0] + dir[0] * depth, y: p[1] + dir[1] * depth, z: p[2] + dir[2] * depth });
    const tool = width > 0 ? ` Ø${fmt(width)}` : '';
    const op: MprContourOp = {
      ...base,
      face,
      label: saw ? `톱 홈 ${fmt(len)} × ${fmt(depth)}${suffix}` : `직선 경로${tool}${depthText(tool, depth)}${suffix}`,
      kind: 'contour',
      comp: 'none',
      path: [at(s), at(e)],
      depth,
    };
    if (width > 0) op.diameter = width;
    this.push(op);
  }

  /** 사각 포켓: center·size는 면 안 좌표, angle은 면 평면에서 도는 각(도, 반시계) */
  rectPocket(base: Base, face: PanelFace, center: Vec2, size: Vec2, depth: number, radius: number, angle: number): void {
    const lo = toPlane(face, this.surface(face, center[0] - size[0] / 2, center[1] - size[1] / 2));
    const hi = toPlane(face, this.surface(face, center[0] + size[0] / 2, center[1] + size[1] / 2));
    const p0 = Math.min(lo[0], hi[0]);
    const p1 = Math.max(lo[0], hi[0]);
    const q0 = Math.min(lo[1], hi[1]);
    const q1 = Math.max(lo[1], hi[1]);
    const r = Math.max(0, Math.min(radius, (p1 - p0) / 2, (q1 - q0) / 2));
    const pts: Vec2[] = [];
    if (r <= EPS) pts.push([p0, q0], [p1, q0], [p1, q1], [p0, q1]);
    else
      for (const [cp, cq, t0] of [
        [p1 - r, q0 + r, -90],
        [p1 - r, q1 - r, 0],
        [p0 + r, q1 - r, 90],
        [p0 + r, q0 + r, 180],
      ] as const)
        for (let k = 0; k <= 8; k++) {
          const t = ((t0 + (90 * k) / 8) * Math.PI) / 180;
          pts.push([cp + r * Math.cos(t), cq + r * Math.sin(t)]);
        }
    const pc = (p0 + p1) / 2;
    const qc = (q0 + q1) / 2;
    const th = (angle * Math.PI) / 180;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const rot = pts.map(([p, q]): Vec2 => [pc + (p - pc) * cs - (q - qc) * sn, qc + (p - pc) * sn + (q - qc) * cs]);
    const rotation = angle ? ` (회전 ${fmt(angle)}°)` : '';
    const op: MprBoxOp = {
      ...base,
      face,
      label: `포켓 ${fmt(size[0])} × ${fmt(size[1])} × ${fmt(depth)}${rotation}${FACE_SUFFIX[face]}`,
      kind: 'pocket',
      depth,
      length: size[0],
      width: size[1],
      prism: this.prism(face, rot, lo[2], depth),
    };
    this.push(op);
  }

  private prism(face: PanelFace, poly: Vec2[], n: number, depth: number): NonNullable<MprBoxOp['prism']> {
    const outline: number[] = [];
    let reach = Infinity;
    for (const [p, q] of poly) {
      const v = fromPlane(face, p, q, n);
      outline.push(v[0], v[1], v[2]);
      reach = Math.min(reach, this.reach(face, v));
    }
    return { outline, dir: [...FACE_DIR[face]], depth: Math.max(0, Math.min(depth, reach)) };
  }

  /** 면 평면 좌표의 꼭짓점들 → 평면 좌표 변(호 중심 포함) */
  private resolve(face: PanelFace, pts: readonly FacePoint[], closed: boolean, closingArc?: ArcHint): { start: Vec2; n: number; segs: PlaneSeg[] } {
    const plane = pts.map((pt) => toPlane(face, this.surface(face, pt.a, pt.b)));
    const steps: [number, number, ArcHint | undefined][] = [];
    for (let i = 1; i < pts.length; i++) steps.push([i - 1, i, pts[i]!.arc]);
    if (closed) steps.push([pts.length - 1, 0, closingArc]);
    const run = (initial: Vec2 | undefined): { segs: PlaneSeg[]; tangent: Vec2 | undefined } => {
      const segs: PlaneSeg[] = [];
      let tangent = initial;
      for (const [i0, i1, hint] of steps) {
        const s: Vec2 = [plane[i0]![0], plane[i0]![1]];
        const e: Vec2 = [plane[i1]![0], plane[i1]![1]];
        const chord = Math.hypot(e[0] - s[0], e[1] - s[1]);
        if (chord <= 1e-6) continue;
        const arc = !hint
          ? null
          : hint.bulge !== undefined
            ? bulgeArc(s, e, hint.bulge)
            : hint.radius !== undefined && hint.radius > 0
              ? radiusArc(s, e, hint.radius, tangent, hint.ccw)
              : tangentArc(s, e, tangent, hint.ccw);
        if (!arc) {
          segs.push({ p: e[0], q: e[1] });
          tangent = [(e[0] - s[0]) / chord, (e[1] - s[1]) / chord];
          continue;
        }
        segs.push({ p: e[0], q: e[1], arc: { cp: arc.c[0], cq: arc.c[1], sweep: sweepOf(s, e, arc.c, arc.ccw) } });
        tangent = arcTangent(e, arc.c, arc.ccw);
      }
      return { segs, tangent };
    };
    let res = run(undefined);
    const firstOpenArc = pts[1]?.arc && pts[1].arc.bulge === undefined && !(pts[1].arc.radius! > 0);
    // 닫힌 경로가 '호' 표시로 시작하면 닫는 변의 방향이 첫 호의 들어오는 접선이다
    if (closed && firstOpenArc && res.tangent) res = run(res.tangent);
    return { start: [plane[0]![0], plane[0]![1]], n: plane[0]![2], segs: res.segs };
  }

  /** 닫힌 경로가 한 원이면 중심(평면 좌표)과 반지름 */
  private circleOf(start: Vec2, segs: readonly PlaneSeg[]): { c: Vec2; r: number } | null {
    if (segs.length < 2 || segs.some((s) => !s.arc)) return null;
    const last = segs[segs.length - 1]!;
    if (Math.hypot(last.p - start[0], last.q - start[1]) > 1e-6) return null;
    const a0 = segs[0]!.arc!;
    const r = Math.hypot(start[0] - a0.cp, start[1] - a0.cq);
    for (const s of segs) {
      const a = s.arc!;
      if (Math.hypot(a.cp - a0.cp, a.cq - a0.cq) > 1e-6 || Math.abs(Math.hypot(s.p - a.cp, s.q - a.cq) - r) > 1e-4 || Math.sign(a.sweep) !== Math.sign(a0.sweep)) return null;
    }
    return { c: [a0.cp, a0.cq], r };
  }

  /** 평면 좌표 경로 → 깊이에 놓은 공구 경로(윗·아랫면은 호 그대로, 옆면은 나눈 꺾은선) */
  private pathAt(face: PanelFace, start: Vec2, n: number, segs: readonly PlaneSeg[], depth: number): PathPoint[] {
    const dir = FACE_DIR[face];
    const at = (p: number, q: number): PathPoint => {
      const v = fromPlane(face, p, q, n);
      return { x: v[0] + dir[0] * depth, y: v[1] + dir[1] * depth, z: v[2] + dir[2] * depth };
    };
    if (!broad(face)) return tessellate(start, segs).map(([p, q]) => at(p, q));
    const out: PathPoint[] = [at(start[0], start[1])];
    for (const s of segs) {
      const pt = at(s.p, s.q);
      if (s.arc) pt.arc = { cx: s.arc.cp, cy: s.arc.cq, sweep: s.arc.sweep };
      out.push(pt);
    }
    return out;
  }

  /** 라우팅 경로: 닫힌 empty 경로는 포켓, 공구가 다 채우는 원은 구멍 */
  path(base: Base, face: PanelFace, pts: FacePoint[], o: { closed: boolean; closingArc?: ArcHint; depth: number; toolWidth: number; toolName?: string; empty: boolean; comp: 'left' | 'right' | 'none' }): void {
    const { start, n, segs } = this.resolve(face, pts, o.closed, o.closingArc);
    const circle = o.closed ? this.circleOf(start, segs) : null;
    const suffix = FACE_SUFFIX[face];
    if (circle && o.toolWidth > 0 && o.toolWidth >= 2 * circle.r - 1e-6) {
      const v = fromPlane(face, circle.c[0], circle.c[1], n);
      this.hole(base, face, [this.inFace(face, v[0], v[1], v[2])], 2 * circle.r, o.depth, o.toolName);
      return;
    }
    if (o.closed && o.empty) {
      const poly = tessellate(start, segs);
      poly.pop(); // 닫는 점(= 첫 점)
      const op: MprBoxOp = {
        ...base,
        face,
        label: circle ? `원형 포켓 Ø${fmt(2 * circle.r)} × ${fmt(o.depth)}${suffix}` : `포켓 경로 × ${fmt(o.depth)}${suffix}`,
        kind: 'pocket',
        depth: o.depth,
        prism: this.prism(face, poly, n, o.depth),
      };
      if (circle) op.diameter = 2 * circle.r;
      this.push(op);
      return;
    }
    const tool = o.toolWidth > 0 ? ` Ø${fmt(o.toolWidth)}` : '';
    const op: MprContourOp = {
      ...base,
      face,
      label: `라우팅${tool}${depthText(tool, o.depth)}${suffix}`,
      kind: 'contour',
      comp: o.comp,
      path: this.pathAt(face, start, n, segs, o.depth),
      depth: o.depth,
    };
    if (o.toolWidth > 0) op.diameter = o.toolWidth;
    this.push(op);
  }

  /** 원: 공구가 다 채우면 구멍, empty면 원형 포켓, 아니면 원 경로 */
  circle(base: Base, face: PanelFace, center: Vec2, radius: number, o: { depth: number; toolWidth: number; toolName?: string; empty: boolean }): void {
    const d = 2 * radius;
    if (o.toolWidth > 0 && o.toolWidth >= d - 1e-6) {
      this.hole(base, face, [center], d, o.depth, o.toolName);
      return;
    }
    const c = toPlane(face, this.surface(face, center[0], center[1]));
    if (o.empty) {
      const poly: Vec2[] = [];
      for (let k = 0; k < 48; k++) poly.push([c[0] + radius * Math.cos((k / 48) * Math.PI * 2), c[1] + radius * Math.sin((k / 48) * Math.PI * 2)]);
      const op: MprBoxOp = { ...base, face, label: `원형 포켓 Ø${fmt(d)} × ${fmt(o.depth)}${FACE_SUFFIX[face]}`, kind: 'pocket', depth: o.depth, diameter: d, prism: this.prism(face, poly, c[2], o.depth) };
      this.push(op);
      return;
    }
    const start: Vec2 = [c[0] + radius, c[1]];
    const segs: PlaneSeg[] = [
      { p: c[0] - radius, q: c[1], arc: { cp: c[0], cq: c[1], sweep: Math.PI } },
      { p: c[0] + radius, q: c[1], arc: { cp: c[0], cq: c[1], sweep: Math.PI } },
    ];
    const op: MprContourOp = { ...base, face, label: `원형 경로 Ø${fmt(d)} × ${fmt(o.depth)}${FACE_SUFFIX[face]}`, kind: 'contour', comp: 'none', path: this.pathAt(face, start, c[2], segs, o.depth), depth: o.depth };
    if (o.toolWidth > 0) op.diameter = o.toolWidth;
    this.push(op);
  }

  /** 그리지 못하는 요소(at = 면 위 위치, 알면) */
  other(base: Base, message: string, at?: Vec3): void {
    this.w.add(message, base.line);
    const op: MprOtherOp = { ...base, kind: 'other' };
    if (at) op.at = at;
    this.push(op);
  }

  /** 판 외곽선(직사각형이 아니면) → 닫힌 XY 점열 */
  outlinePath(): PathPoint[] | undefined {
    const ol = this.outline;
    if (ol.length < 3) return undefined;
    const out: PathPoint[] = [{ x: ol[0]!.x, y: ol[0]!.y, z: 0 }];
    for (let i = 0; i < ol.length; i++) {
      const s = ol[i]!;
      const e = ol[(i + 1) % ol.length]!;
      const pt: PathPoint = { x: e.x, y: e.y, z: 0 };
      const arc = bulgeArc([s.x, s.y], [e.x, e.y], s.bulge);
      if (arc) pt.arc = { cx: arc.c[0], cy: arc.c[1], sweep: sweepOf([s.x, s.y], [e.x, e.y], arc.c, arc.ccw) };
      out.push(pt);
    }
    return out;
  }
}

function depthText(tool: string, depth: number): string {
  if (!(depth > 0)) return '';
  return tool ? ` × ${fmt(depth)}` : ` 깊이 ${fmt(depth)}`;
}

/** 외곽선 꼭짓점 → 판 상자와 같은 직사각형이면 빈 목록 */
function panelOutline(items: { x: number; y: number; bulge: number }[], L: number, W: number): { x: number; y: number; bulge: number }[] {
  const pts = items.slice();
  const same = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => Math.abs(a.x - b.x) <= 1e-6 && Math.abs(a.y - b.y) <= 1e-6;
  if (pts.length > 1 && same(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  if (pts.length < 3) return [];
  const corner = (p: { x: number; y: number }): boolean => (Math.abs(p.x) <= 1e-6 || Math.abs(p.x - L) <= 1e-6) && (Math.abs(p.y) <= 1e-6 || Math.abs(p.y - W) <= 1e-6);
  if (pts.length === 4 && pts.every((p) => corner(p) && Math.abs(p.bulge) <= EPS) && new Set(pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size === 4) return [];
  return pts;
}

/** 가장 긴 줄지 않는 부분열 밖에 있는 값 수(한 요소만 앞으로 옮기면 1) */
function outOfOrder(values: readonly number[]): number {
  const tails: number[] = [];
  for (const v of values) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (tails[m]! <= v) lo = m + 1;
      else hi = m;
    }
    tails[lo] = v;
  }
  return values.length - tails.length;
}

// ───────────────────────── 문서 ─────────────────────────

function readDocument(input: Uint8Array | ArrayBuffer | string): { root: XmlElement; lines: string[]; w: NcWarnings } {
  let text = typeof input === 'string' ? input : decodeXmlBytes(input instanceof Uint8Array ? input : new Uint8Array(input));
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // 줄 번호를 코드 보기와 맞춘다(CR만 쓰는 파일도)
  text = text.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const w = new NcWarnings();
  let parsed: ReturnType<typeof parseXml>;
  try {
    parsed = parseXml(text);
  } catch (err) {
    if (err instanceof XmlError) throw new Error(`XML을 읽지 못했습니다: ${err.message}`);
    throw err;
  }
  for (const p of parsed.problems) w.add(`XML: ${p.message}`, p.line);
  return { root: parsed.root, lines, w };
}

const closedChildren = (el: XmlElement): XmlElement[] => el.children.filter((c) => c.endLine >= 0);

function basePart(format: MprPart['format'], name: string, b: PanelBuilder, header: Record<string, string>, variables: MprVariable[], lines: string[], line: number, units: MprPart['units'] = 'mm'): MprPart {
  const workpiece: MprWorkpiece = { length: b.L, width: b.W, thickness: b.T, line };
  const outline = b.outlinePath();
  if (outline) workpiece.outline = outline;
  return { format, name, units, header, variables, workpiece, contours: [], operations: b.ops, lines, stats: b.stats, warnings: b.w.list(), warningItems: b.w.items() };
}

// ───────────────────────── PGI ─────────────────────────

/** WangShi PGI 글·바이트를 읽는다 */
export function parsePgi(input: Uint8Array | ArrayBuffer | string, opts: PanelReadOptions = {}): MprPart {
  const { root, lines, w } = readDocument(input);
  if (root.name.toLowerCase() !== 'pgi') throw new Error(`WangShi PGI 파일의 뿌리 요소가 <pgi>가 아닙니다(<${root.name}>).`);
  const panels = xmlChildren(root, 'panel');
  const panel = panels[0];
  if (!panel) throw new Error('WangShi PGI 파일에 판(<panel>)이 없습니다.');
  const paramsEl = xmlChild(root, 'params') ?? xmlChild(panel, 'params');
  const nums = new Numbers();
  const variables = readVariables(
    (paramsEl ? xmlChildren(paramsEl, 'param') : []).map((p) => ({ key: xmlAttr(p, 'key') ?? '', value: xmlAttr(p, 'value') ?? '', comment: xmlAttr(p, 'description'), line: p.line })),
    nums,
  );
  const L = dimension(nums, xmlAttr(panel, 'length'), 'L', 'length');
  const W = dimension(nums, xmlAttr(panel, 'width'), 'W', 'width');
  const T = dimension(nums, xmlAttr(panel, 'thickness'), 'T', 'thickness');
  nums.set('L', L);
  nums.set('W', W);
  nums.set('T', T);
  const outlineEl = xmlChild(panel, 'outlines');
  const corners: { x: number; y: number; bulge: number }[] = [];
  for (const o of outlineEl ? xmlChildren(outlineEl, 'outline') : []) {
    const x = nums.value(xmlAttr(o, 'x'));
    const y = nums.value(xmlAttr(o, 'y'));
    if (x !== undefined && y !== undefined) corners.push({ x, y, bulge: nums.value(xmlAttr(o, 'bulge')) ?? 0 });
  }
  const b = new PanelBuilder(L, W, T, w, panelOutline(corners, L, W));
  if (panels.length > 1) w.add(`PGI: 판이 ${panels.length}개 — 첫 판만 읽음`, panels[1]!.line);
  const orders: number[] = [];
  let orderLine = -1;
  let orderMax = -Infinity;
  for (const el of closedChildren(panel)) {
    const tag = el.name.toLowerCase();
    if (tag === 'outlines' || tag === 'extensions' || tag === 'params') continue;
    readPgiElement(b, nums, el);
    // 리더가 쓰지 않는 값: 문서 차례와 다른 order, 진입 값
    const enabled = !disabledFlag(xmlAttr(el, 'enable'));
    const order = nums.value(xmlAttr(el, 'order'));
    if (order !== undefined && enabled) {
      if (orderLine < 0 && order < orderMax) orderLine = el.line;
      orderMax = Math.max(orderMax, order);
      orders.push(order);
    }
    if (['path', 'circle', 'pocket', 'line'].includes(tag) && ['entryL', 'entryZ', 'toolExtraOffset'].some((k) => (xmlAttr(el, k) ?? '').trim() !== '' && nums.value(xmlAttr(el, k)) !== 0))
      w.add('PGI: 진입 값(entryL·entryZ)·공구 추가 오프셋(toolExtraOffset)은 그리지 않음', el.line);
  }
  const late = outOfOrder(orders);
  if (late > 0) w.add(`PGI: 가공 순서(order)가 문서 순서와 다른 요소 ${late}개 — 문서 순서대로 그림`, orderLine);
  const name = opts.name ?? (xmlAttr(panel, 'frontID')?.trim() || 'PGI');
  return basePart('pgi', name, b, { ...panel.attrs }, variables, lines, panel.line);
}

function pgiFace(v: Values): PanelFace {
  const raw = (v.f.get('direction') ?? '').trim().toLowerCase();
  const face = PGI_FACES[raw];
  if (!face) throw new Problem(`${v.f.label}: 방향(direction="${raw}")을 몰라 해석하지 못함`);
  return face;
}

function toolWidth(width: number, toolName: string | undefined): number {
  return width > 0 ? width : (KNOWN_TOOLS[(toolName ?? '').trim().toUpperCase()] ?? 0);
}

function readPgiElement(b: PanelBuilder, nums: Numbers, el: XmlElement): void {
  const tag = el.name.toLowerCase();
  const f: Fields = { label: `<${el.name}>`, get: (n) => xmlAttr(el, n) };
  const v = new Values(nums, b.w, f, el.line);
  const base: Base = { macroId: -1, macro: el.name, label: f.label, line: el.line, endLine: el.endLine, enabled: !disabledFlag(xmlAttr(el, 'enable')), params: { ...el.attrs } };
  try {
    switch (tag) {
      case 'hole': {
        const face = pgiFace(v);
        const x = v.num('x');
        const y = v.num('y');
        const z = v.num('z', 0);
        const diameter = v.positive('diameter');
        const depth = v.depth('depth');
        const first = b.inFace(face, x, y, z);
        const positions: Vec2[] = [first];
        const no = v.opt('no') ?? 1;
        if (no >= 2 && Number.isInteger(no)) {
          const step = b.inFace(face, v.opt('xi') ?? 0, v.opt('yi') ?? 0, v.opt('zi') ?? 0);
          if (step[0] || step[1]) {
            if (no > MAX_HOLE_ROW) throw new Problem(`${f.label}: 구멍 수 ${no}개가 한도 ${MAX_HOLE_ROW}개를 넘음`);
            for (let k = 1; k < no; k++) positions.push([first[0] + k * step[0], first[1] + k * step[1]]);
          }
        }
        const xAxis = face === 'left' || face === 'right';
        const wall = broad(face) ? undefined : b.sideWall(face, xAxis ? x : y, xAxis ? y : x, f.label, el.line);
        b.hole(base, face, positions, diameter, depth, undefined, wall);
        return;
      }
      case 'line': {
        const face = pgiFace(v);
        const s = b.inFace(face, v.num('startX'), v.num('startY'), v.num('startZ', 0));
        const e = b.inFace(face, v.num('endX'), v.num('endY'), v.num('endZ', 0));
        b.line(base, face, s, e, Math.max(0, v.num('width', 0)), v.depth('depth'), v.flag('isSaw', true));
        return;
      }
      case 'pocket': {
        const face = pgiFace(v);
        const length = v.positive('length');
        const width = v.positive('width');
        const depth = v.depth('depth');
        const ext = new Map<string, string>();
        const extEl = xmlChild(el, 'extensions');
        for (const x of extEl ? xmlChildren(extEl, 'extension') : []) {
          const k = xmlAttr(x, 'key');
          if (k && !ext.has(k)) ext.set(k, xmlAttr(x, 'value') ?? '');
        }
        // 면 안 두 축: 윗·아랫면 (x, y), 왼·오른쪽면 (y, z), 앞·뒷면 (x, z)
        const axes: [string, string] = broad(face) ? ['X', 'Y'] : face === 'left' || face === 'right' ? ['Y', 'Z'] : ['X', 'Z'];
        const centerOf = (axis: string, size: number): number => {
          const c = v.opt(`center${axis}`);
          if (c !== undefined) return c;
          const o = nums.value(ext.get(`str${axis}`));
          return o !== undefined ? o + size / 2 : v.num(`center${axis}`);
        };
        b.rectPocket(base, face, [centerOf(axes[0], length), centerOf(axes[1], width)], [length, width], depth, Math.max(0, v.num('cornerRadius', 0)), v.num('angle', 0));
        return;
      }
      case 'path': {
        const face = pgiFace(v);
        const depth = v.depth('depth');
        const vertices = closedChildren(el).filter((c) => c.name.toLowerCase() === 'vertex');
        if (vertices.length < 2) throw new Problem(`${f.label}: 꼭짓점이 ${vertices.length}개뿐이라 경로를 그리지 못함`);
        const pts: FacePoint[] = [];
        let outgoing: ArcHint | undefined;
        for (const vx of vertices) {
          const vv = new Values(nums, b.w, { label: f.label, get: (n) => xmlAttr(vx, n) }, vx.line);
          const [a, bb] = b.inFace(face, vv.num('x'), vv.num('y'), vv.num('z', 0));
          const pt: FacePoint = { a, b: bb };
          if (outgoing) pt.arc = outgoing;
          pts.push(pt);
          outgoing = bulgeHint(vv.num('bulge', 0));
        }
        const side = (v.text('toolOffset') ?? 'middle').toLowerCase();
        const toolName = v.text('toolName');
        const closed = v.flag('close', false);
        b.path(base, face, pts, {
          closed,
          ...(closed && outgoing ? { closingArc: outgoing } : {}),
          depth,
          toolWidth: toolWidth(Math.max(0, v.num('width', 0)), toolName),
          ...(toolName ? { toolName } : {}),
          empty: v.flag('empty', false),
          comp: side === 'left' ? 'left' : side === 'right' ? 'right' : 'none',
        });
        return;
      }
      case 'circle': {
        const face = pgiFace(v);
        const center = b.inFace(face, v.num('centerX'), v.num('centerY'), v.num('centerZ', 0));
        const toolName = v.text('toolName');
        b.circle(base, face, center, v.positive('radius'), { depth: v.depth('depth'), toolWidth: toolWidth(Math.max(0, v.num('width', 0)), toolName), ...(toolName ? { toolName } : {}), empty: v.flag('empty', true) });
        return;
      }
      default: {
        // 모르는 요소: x·y(옆면이면 z까지)와 direction이 있으면 그 면 위의 점
        const x = v.opt('x');
        const y = v.opt('y');
        const face = PGI_FACES[(xmlAttr(el, 'direction') ?? '').trim().toLowerCase()];
        let at: Vec3 | undefined;
        if (x !== undefined && y !== undefined) {
          if (face) {
            const [a, bb] = b.inFace(face, x, y, v.opt('z') ?? 0);
            at = b.surface(face, a, bb);
            base.face = face;
          } else at = [x, y, b.T];
        }
        b.other(base, at ? `${f.label}: 모양을 몰라 위치만 점으로 표시` : `${f.label}: 해석하지 못해 목록에만 넣음`, at);
        return;
      }
    }
  } catch (err) {
    if (!(err instanceof Problem)) throw err;
    b.other({ ...base, label: `${f.label} (해석 실패)` }, err.message);
  }
}

/** PGI bulge: 0 직선, ±1 '호' 표시, 그 밖은 DXF bulge */
function bulgeHint(bulge: number): ArcHint | undefined {
  if (Math.abs(bulge) <= EPS) return undefined;
  if (Math.abs(Math.abs(bulge) - 1) <= 1e-9) return { ccw: bulge > 0 };
  return { bulge, ccw: bulge > 0 };
}

// ───────────────────────── KDT XML ─────────────────────────

/** XML TypeName 낱말 → 한국어 이름(그리지 못하는 종류) */
const XML_UNSUPPORTED_NAMES: [string, string][] = [
  ['flatanglepull', '반매립 손잡이 홈'],
  ['engraving', '각인'],
];

/** WangShi KDT XML(KDTPanelFormat) 글·바이트를 읽는다 */
export function parseKdtXml(input: Uint8Array | ArrayBuffer | string, opts: PanelReadOptions = {}): MprPart {
  const { root, lines, w } = readDocument(input);
  if (root.name.toLowerCase() !== 'kdtpanelformat') throw new Error(`WangShi XML 파일의 뿌리 요소가 <KDTPanelFormat>이 아닙니다(<${root.name}>).`);
  const panels = xmlChildren(root, 'PANEL');
  const panel = panels[0];
  if (!panel) throw new Error('WangShi XML 파일에 판(<PANEL>)이 없습니다.');
  const inch = !['', '0'].includes((xmlField(panel, 'Inch') ?? '0').trim());
  const paramsEl = xmlChild(panel, 'Params');
  const nums = new Numbers();
  const variables = readVariables(
    (paramsEl ? xmlChildren(paramsEl, 'Param') : []).map((p) => ({ key: xmlAttr(p, 'Key') ?? '', value: xmlAttr(p, 'Value') ?? '', comment: xmlAttr(p, 'Comment'), line: p.line })),
    nums,
  );
  const L = dimension(nums, xmlField(panel, 'PanelLength'), 'L', 'PanelLength');
  const W = dimension(nums, xmlField(panel, 'PanelWidth'), 'W', 'PanelWidth');
  const T = dimension(nums, xmlField(panel, 'PanelThickness'), 'T', 'PanelThickness');
  nums.set('L', L);
  nums.set('W', W);
  nums.set('T', T);
  const outlineEl = xmlChild(panel, 'PanelOutline');
  const corners: { x: number; y: number; bulge: number }[] = [];
  for (const o of outlineEl ? xmlChildren(outlineEl, 'Vertex') : []) {
    const x = nums.value(xmlField(o, 'X1'));
    const y = nums.value(xmlField(o, 'Y1'));
    if (x !== undefined && y !== undefined) corners.push({ x, y, bulge: nums.value(xmlField(o, 'Bulge')) ?? 0 });
  }
  const b = new PanelBuilder(L, W, T, w, panelOutline(corners, L, W));
  if (panels.length > 1) w.add(`XML: 판이 ${panels.length}개 — 첫 판만 읽음`, panels[1]!.line);
  // <CAD>는 문서 차례대로(PANEL 옆이든 안이든)
  for (const c of root.children) {
    const list = c === panel ? panel.children : [c];
    for (const el of list) if (el.name.toUpperCase() === 'CAD' && el.endLine >= 0) readCad(b, nums, el);
  }
  const header: Record<string, string> = {};
  for (const c of panel.children) if (!c.children.length && !(c.name in header)) header[c.name] = c.text.trim();
  const name = opts.name ?? (xmlField(panel, 'PanelName') || 'XML');
  return basePart('xml', name, b, header, variables, lines, panel.line, inch ? 'inch' : 'mm');
}

function readCad(b: PanelBuilder, nums: Numbers, el: XmlElement): void {
  const rawType = xmlField(el, 'TypeNo') ?? '';
  const typeName = xmlField(el, 'TypeName') ?? '';
  const no = nums.value(rawType);
  const typeNo = no !== undefined && Number.isInteger(no) ? no : -1;
  const label = ['CAD', rawType || '?', typeName].filter(Boolean).join(' ');
  const f: Fields = { label, get: (n) => xmlField(el, n) };
  const v = new Values(nums, b.w, f, el.line);
  const params: Record<string, string> = {};
  for (const c of el.children) if (!c.children.length && !(c.name in params)) params[c.name] = c.text.trim();
  const base: Base = { macroId: typeNo, macro: typeName, label, line: el.line, endLine: el.endLine, enabled: !disabledFlag(xmlField(el, 'Enable')), params };
  const toolName = v.text('ToolName');
  try {
    switch (typeNo) {
      case 1:
      case 8: {
        const face: PanelFace = typeNo === 1 ? 'top' : 'bottom';
        b.hole(base, face, [[v.num('X1'), v.num('Y1')]], v.positive('Diameter'), v.depth('Depth'));
        return;
      }
      case 2: {
        const face = quadrantFace(b, v);
        const x = v.num('X1');
        const y = v.num('Y1');
        const xAxis = face === 'left' || face === 'right';
        const wall = b.sideWall(face, xAxis ? x : y, xAxis ? y : x, label, el.line);
        b.hole(base, face, [b.inFace(face, x, y, v.num('Z1'))], v.positive('Diameter'), v.depth('Depth'), undefined, wall);
        return;
      }
      case 3:
      case 13: {
        const face: PanelFace = typeNo === 3 ? 'top' : 'bottom';
        b.line(base, face, [v.num('BeginX'), v.num('BeginY')], [v.num('EndX'), v.num('EndY')], Math.max(0, v.num('Width', 0)), v.depth('Depth'), v.flag('UseSaw', true));
        return;
      }
      case 5: {
        b.circle(base, 'top', [v.num('CenterX'), v.num('CenterY')], v.positive('Radius'), {
          depth: v.depth('Depth'),
          toolWidth: toolWidth(Math.max(0, v.num('Width', 0)), toolName),
          ...(toolName ? { toolName } : {}),
          empty: v.flag('Empty', true),
        });
        return;
      }
      case 6:
      case 16:
      case 26: {
        const face: PanelFace = typeNo === 6 ? 'top' : typeNo === 16 ? 'bottom' : quadrantFace(b, v);
        const length = v.positive('Length');
        const width = v.positive('Width');
        let center: Vec2;
        if (xmlField(el, 'X1') !== undefined || xmlField(el, 'Y1') !== undefined) {
          // X1·Y1(옆면은 Z1까지)은 최소 모서리다
          const x = v.num('X1', 0);
          const y = v.num('Y1', 0);
          if (broad(face)) center = [x + length / 2, y + width / 2];
          else center = [(face === 'left' || face === 'right' ? y : x) + length / 2, v.num('Z1', 0) + width / 2];
        } else {
          if (!broad(face)) throw new Problem(`${label}: 옆면 사각에 원점 X1·Y1·Z1이 없어 해석하지 못함`);
          center = [v.num('CenterX'), v.num('CenterY')];
        }
        b.rectPocket(base, face, center, [length, width], v.depth('Depth'), Math.max(0, v.num('Radius', 0)), v.num('Angle', 0));
        return;
      }
      case 7:
      case 17: {
        const face: PanelFace = typeNo === 7 ? 'top' : 'bottom';
        const vxEl = xmlChild(el, 'Vertexes');
        const items = vxEl ? closedChildren(vxEl) : [];
        if (items.length < 2) throw new Problem(`${label}: 꼭짓점이 ${items.length}개뿐이라 경로를 그리지 못함`);
        const relative = v.flag('Relative', false);
        if (relative) b.w.add(`${label}: 상대 좌표 경로(Relative=1) — 꼭짓점을 앞 꼭짓점에서의 증분으로 읽음`, el.line);
        const pts: FacePoint[] = [];
        let x = 0;
        let y = 0;
        items.forEach((it, i) => {
          const iv = new Values(nums, b.w, { label, get: (n) => xmlField(it, n) }, it.line);
          const dx = iv.num('X1');
          const dy = iv.num('Y1');
          [x, y] = relative && i ? [x + dx, y + dy] : [dx, dy];
          const pt: FacePoint = { a: x, b: y };
          if (i && it.name.toLowerCase() === 'arc') {
            const r = iv.num('Radius', 0);
            pt.arc = { ccw: (xmlField(it, 'Direction') ?? '1').trim() !== '0', ...(r > 0 ? { radius: r } : {}) };
          }
          pts.push(pt);
        });
        const corr = (v.text('Correction') ?? '0').trim();
        b.path(base, face, pts, {
          closed: v.flag('Close', false),
          depth: v.depth('Depth'),
          toolWidth: toolWidth(Math.max(0, v.num('Width', 0)), toolName),
          ...(toolName ? { toolName } : {}),
          empty: v.flag('Empty', false),
          comp: corr === '1' ? 'left' : corr === '2' ? 'right' : 'none',
        });
        return;
      }
      default: {
        const words = typeName.replace(/\s+/g, '').toLowerCase();
        const korean = XML_UNSUPPORTED_NAMES.find(([k]) => words.includes(k))?.[1];
        if (korean) base.label = `${korean} (미지원)`;
        const at = unsupportedPlace(b, v, typeName.trim().toLowerCase(), base);
        b.other(base, at ? `${label}: 모양을 몰라 위치만 점으로 표시` : `${label}: 해석하지 못해 목록에만 넣음`, at);
        return;
      }
    }
  } catch (err) {
    if (!(err instanceof Problem)) throw err;
    b.other({ ...base, label: `${label} (해석 실패)` }, err.message);
  }
}

/** Quadrant(1 오른쪽·2 왼쪽·3 뒷·4 앞면). 없으면 원점이 놓인 판 경계(0·L·0·W)로 정한다 */
function quadrantFace(b: PanelBuilder, v: Values): PanelFace {
  const q = (v.f.get('Quadrant') ?? '').trim();
  const face = QUADRANT_FACES[q];
  if (face) return face;
  const x = v.opt('X1');
  const y = v.opt('Y1');
  for (const [val, target, cand] of [
    [x, 0, 'left'],
    [x, b.L, 'right'],
    [y, 0, 'front'],
    [y, b.W, 'back'],
  ] as const)
    if (val !== undefined && Math.abs(val - target) <= 1e-6) {
      b.w.add(`${v.f.label}: Quadrant 값('${q}')을 몰라 원점 위치로 옆면을 정함`, v.line);
      return cand;
    }
  throw new Problem(`${v.f.label}: 옆면 Quadrant 값('${q}')을 몰라 해석하지 못함`);
}

/** 그리지 못하는 CAD의 위치: X·Y·Z(없으면 X1·Y1·Z1)와 TypeName 머리말(Vertical 윗면·Back 아랫면·Horizontal 옆면) */
function unsupportedPlace(b: PanelBuilder, v: Values, typeName: string, base: Base): Vec3 | undefined {
  const pick = (a: string, c: string): number | undefined => (v.text(a) !== undefined ? v.opt(a) : v.opt(c));
  const x = pick('X', 'X1');
  const y = pick('Y', 'Y1');
  const z = pick('Z', 'Z1');
  if (x === undefined || y === undefined) return undefined;
  let face: PanelFace | undefined;
  if (typeName.startsWith('back')) face = 'bottom';
  else if (typeName.startsWith('vertical')) face = 'top';
  else if (typeName.startsWith('horizontal')) {
    face = QUADRANT_FACES[(v.f.get('Quadrant') ?? '').trim()];
    if (!face || z === undefined) return undefined;
  }
  if (!face) return [x, y, b.T];
  base.face = face;
  const [a, bb] = b.inFace(face, x, y, z ?? 0);
  return b.surface(face, a, bb);
}

// ───────────────────────── 판별 ─────────────────────────

/** 글 앞부분이 WangShi PGI(뿌리 <pgi>)인지 */
export function looksLikePgi(head: string): boolean {
  return xmlRootName(head)?.toLowerCase() === 'pgi';
}

/** 글 앞부분이 WangShi KDT XML(뿌리 <KDTPanelFormat>)인지 */
export function looksLikeKdtXml(head: string): boolean {
  return xmlRootName(head)?.toLowerCase() === 'kdtpanelformat';
}
