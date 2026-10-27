/**
 * woodWOP MPR(4.x 글 형식, Homag·Weeke 가구 CNC) 해석기.
 *
 * 파일 구조(한 줄에 한 항목, `!`로 끝):
 * - `[H` 머리(VERSION, INCH 단위, _BSX/_BSY/_BSZ 계산된 판 크기 등)
 * - `[0…` 변수표: `이름="식"` 다음 줄 `KM="설명"`. 식에는 앞서 나온 변수만 쓴다
 * - `[K` 좌표계(읽지 않음 — 경고)
 * - `]n` 윤곽 n: `$Em` 요소 머리 + 종류 줄(KP 점·KL 선·KA 호·KR 둥글리기·KF 모따기·KSL/KSA 나눔) + `X=…` 값.
 *   `.X=` 처럼 점으로 시작하는 값은 woodWOP가 계산해 둔 값(외부 프로그램이 쓴 파일은 틀릴 수 있어 검산에만 쓴다)
 * - `<번호 \이름\` 가공 매크로: 100 WerkStck(LA·BR·DI), 101 Kommentar, 102 BohrVert, 103 BohrHoriz,
 *   105 Konturfraesen, 109 Nuten, 112 Tasche, 131 UfluBohr(아래쪽 드릴 장치 — 아랫면에서 위로),
 *   188 Easyedge(엣지 밴딩 — 공개 명세가 없어 실제 파일로 추정: 윤곽 구간 EA..EE의 판 옆면에 두께 DK의 띠) …
 *   값 "STANDARD"(F_·S_·TNO 등)는 기계·공구 자료의 기본값이라는 뜻이라 식으로 계산하지 않는다.
 *
 * 좌표: 판 왼쪽 아래(앞) 모서리의 밑면이 원점, X = 길이(LA), Y = 폭(BR), Z = 두께 방향 위(윗면 Z = DI).
 * 구멍·홈 깊이(TI)는 윗면에서 잰다(UfluBohr는 아랫면에서). 호 KA: DS=0 시계, DS=1 반시계, R 반지름(.I/.J = 계산된 중심).
 * 조건 `??`가 0이거나 EN=0인 가공은 꺼진 것으로 둔다.
 * 윤곽 KR(둥글리기 R)·KF(모따기)는 앞뒤가 직선인 모서리에서 호·직선으로 깎는다(호가 낀 모서리는 그대로, 경고).
 * 변수는 정의 차례대로 계산하고, 뒤에 정의된 변수를 쓰는 식은 다시 돌며 푼다. 모르는 매크로는 XA·YA가 있으면 위치만 남긴다.
 */
import { ExprError, evalMprExpr } from './expr';
import { NcWarnings, type NcWarningItem, type PathPoint } from './model';
import { guessEncoding } from './text';

export interface MprContourElement extends PathPoint {
  /** KP, KL, KA, KR, KF, KSL, KSA */
  type: string;
  /** $E 번호 */
  index: number;
  /** 원본 줄(0부터, $E 줄) */
  line: number;
  radius?: number;
  dir?: 'cw' | 'ccw';
}

export interface MprContour {
  id: number;
  line: number;
  elements: MprContourElement[];
}

export interface MprHole {
  /** 들어가기 시작하는 점(판 겉면) */
  start: [number, number, number];
  /** 들어가는 방향(단위 벡터) */
  dir: [number, number, number];
  /** 그릴 깊이(판 안으로 자른 값) */
  depth: number;
}

/** 공구가 들어가는 판 면(top = 윗면 Z=두께, bottom = 아랫면 Z=0, left·right = X=0·길이, front·back = Y=0·폭) */
export type PanelFace = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';

interface OpBase {
  /** MPR 매크로 번호, KDT XML TypeNo(PGI는 -1) */
  macroId: number;
  /** MPR 매크로 이름, PGI 요소 이름, KDT XML TypeName */
  macro: string;
  /** 사람이 읽는 이름(MNM·KM 또는 매크로 이름) */
  label: string;
  /** `<` 머리 줄(0부터) */
  line: number;
  endLine: number;
  enabled: boolean;
  tool?: number;
  /** 들어가는 면(PGI·XML. MPR은 비워 둔다) */
  face?: PanelFace;
  /** 원래 값(글) */
  params: Record<string, string>;
}

export interface MprDrillOp extends OpBase {
  kind: 'drillV' | 'drillH';
  holes: MprHole[];
  diameter: number;
  /** TI 깊이 */
  depth: number;
  through: boolean;
  /** BM 값(LS, XP 등) */
  mode?: string;
}

export interface MprContourOp extends OpBase {
  kind: 'contour';
  contour?: number;
  startElement?: number;
  endElement?: number;
  comp: 'left' | 'right' | 'none';
  feed?: number;
  /** 공구 경로(가공 깊이 반영) */
  path?: PathPoint[];
  /** 가공 깊이(face가 있을 때 면에서 경로까지의 깊이 표시에 쓴다) */
  depth?: number;
  /** 공구 지름(PGI width·XML Width 등, 알면) */
  diameter?: number;
}

export interface MprBoxOp extends OpBase {
  kind: 'groove' | 'pocket';
  depth: number;
  width?: number;
  length?: number;
  /** 원형 포켓 지름 */
  diameter?: number;
  /** 방향 있는 상자: 모서리 origin과 세 변 u·v·w */
  box?: { origin: number[]; u: number[]; v: number[]; w: number[] };
  /** 기둥: 면 위의 닫힌 다각형(xyz 이어 붙임, 첫 점을 되풀이하지 않음)을 dir(단위 벡터)로 depth만큼 민 것 */
  prism?: { outline: number[]; dir: [number, number, number]; depth: number };
}

/**
 * 엣지 밴딩(188 Easyedge): 윤곽 구간(EA..EE)을 따라 판 옆면에 붙이는 띠. 공구 경로가 아니라 가공 시간·이송 길이에 넣지 않는다.
 * 공개 명세가 없어 실제 파일로 뜻을 정했다(README "woodWOP MPR" 참고).
 */
export interface MprEdgeOp extends OpBase {
  kind: 'edge';
  contour?: number;
  startElement?: number;
  endElement?: number;
  /** 띠 두께(DK) */
  thickness?: number;
  /** 띠를 붙이는 윤곽 구간(앞쪽 차례 그대로) */
  path?: PathPoint[];
  /** 띠가 놓이는 쪽: 1 = 진행 방향 왼쪽, -1 = 오른쪽(판 재료에서 먼 쪽) */
  side?: 1 | -1;
}

export interface MprOtherOp extends OpBase {
  kind: 'comment' | 'other';
  /** 모르는 매크로의 위치(XA·YA가 있으면, Z = 윗면) — 장면에서 점으로 */
  at?: [number, number, number];
}

export type MprOperation = MprDrillOp | MprContourOp | MprBoxOp | MprEdgeOp | MprOtherOp;

export interface MprWorkpiece {
  length: number;
  width: number;
  thickness: number;
  line: number;
  /** 직사각형이 아닌 판의 외곽선(XY, 닫힌 점열 — 끝점이 첫 점과 같다). PGI·XML */
  outline?: PathPoint[];
}

export interface MprVariable {
  name: string;
  expr: string;
  value?: number;
  comment?: string;
  line: number;
}

/**
 * 판재 가공 프로그램 하나(MPR, WangShi PGI·KDT XML 공용 — wangs.ts도 이 꼴로 읽는다).
 * 좌표는 판 왼쪽 앞 아래 모서리가 원점, X = 길이, Y = 폭, Z = 위(윗면 Z = 두께).
 */
export interface MprPart {
  /** 원본 형식 */
  format: 'mpr' | 'pgi' | 'xml';
  name: string;
  version?: string;
  units: 'mm' | 'inch';
  header: Record<string, string>;
  variables: MprVariable[];
  workpiece?: MprWorkpiece;
  contours: MprContour[];
  operations: MprOperation[];
  /** 원본 줄 */
  lines: string[];
  /** edges = 켜진 엣지 밴딩 수(MPR Easyedge가 있을 때만) */
  stats: { holes: number; drillOps: number; contourOps: number; grooves: number; pockets: number; disabled: number; other: number; edges?: number };
  warnings: string[];
  /** 경고마다 글·첫 줄·횟수·난 줄들(G-code의 warningItems와 같은 꼴 — 패널이 줄 번호·글·횟수를 따로 보여 조각마다 번역된다) */
  warningItems?: NcWarningItem[];
}

export interface MprOptions {
  name?: string;
}

type Section = { kind: 'none' } | { kind: 'header' } | { kind: 'vars' } | { kind: 'coords' } | { kind: 'contour'; c: MprContour } | { kind: 'macro'; m: RawMacro };

interface RawMacro {
  id: number;
  name: string;
  line: number;
  endLine: number;
  params: Record<string, string>;
  comments: string[];
}

/** 한 줄 `KEY=VALUE` (따옴표 값이면 따옴표를 뗀다) */
function keyValue(line: string): [string, string] | null {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim();
  if (!/^[A-Za-z0-9_.?$@]+$/.test(key)) return null;
  let v = line.slice(eq + 1).trim();
  if (v.startsWith('"')) {
    const e = v.lastIndexOf('"');
    v = e > 0 ? v.slice(1, e) : v.slice(1);
  } else {
    // 따옴표 밖의 \ 뒤는 주석
    const c = v.indexOf('\\');
    if (c >= 0) v = v.slice(0, c).trim();
  }
  return [key, v];
}

const MACRO_KIND: Record<string, MprOperation['kind'] | 'workpiece'> = {
  werkstck: 'workpiece',
  kommentar: 'comment',
  bohrvert: 'drillV',
  // 아래쪽(언더플로어) 드릴 장치로 아랫면에서 위로 뚫는 수직 구멍 — 위치는 BohrVert처럼 위에서 본 (XA, YA)
  uflubohr: 'drillV',
  bohrhoriz: 'drillH',
  konturfraesen: 'contour',
  nuten: 'groove',
  tasche: 'pocket',
  easyedge: 'edge',
};

/** MPR 글·바이트를 읽는다 */
export function parseMpr(input: Uint8Array | ArrayBuffer | string, opts: MprOptions = {}): MprPart {
  let text: string;
  if (typeof input === 'string') text = input;
  else {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    text = new TextDecoder(guessEncoding(b)).decode(b);
  }
  const w = new NcWarnings();
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const header: Record<string, string> = {};
  const variables: MprVariable[] = [];
  const contours: MprContour[] = [];
  const macros: RawMacro[] = [];
  let sec: Section = { kind: 'none' };
  let curElem: { index: number; line: number; type: string; vals: Record<string, string> } | null = null;
  const elemRaw = new Map<MprContour, { index: number; line: number; type: string; vals: Record<string, string> }[]>();
  const closeElem = (): void => {
    if (curElem && sec.kind === 'contour') elemRaw.get(sec.c)!.push(curElem);
    curElem = null;
  };
  let ended = false;
  for (let i = 0; i < lines.length && !ended; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('\\')) continue;
    if (t === '!' || t.startsWith('!')) {
      closeElem();
      ended = true;
      break;
    }
    if (t.startsWith('[')) {
      closeElem();
      const k = t.slice(1).trim();
      if (/^H/i.test(k)) sec = { kind: 'header' };
      else if (/^K/i.test(k)) {
        sec = { kind: 'coords' };
        w.add('좌표계 표([K)는 읽지 않음 — 기본 좌표계(위 면)로 봄', i);
      } else if (/^\d/.test(k)) sec = { kind: 'vars' };
      else sec = { kind: 'none' };
      continue;
    }
    if (t.startsWith(']')) {
      closeElem();
      const id = parseInt(t.slice(1), 10);
      const c: MprContour = { id: Number.isFinite(id) ? id : contours.length + 1, line: i, elements: [] };
      contours.push(c);
      elemRaw.set(c, []);
      sec = { kind: 'contour', c };
      continue;
    }
    if (t.startsWith('<')) {
      closeElem();
      if (sec.kind === 'macro') sec.m.endLine = i - 1;
      const m = /^<\s*(\d+)\s*\\([^\\]*)\\?/.exec(t);
      const mac: RawMacro = { id: m ? +m[1]! : -1, name: m ? m[2]!.trim() : t.slice(1).trim(), line: i, endLine: i, params: {}, comments: [] };
      macros.push(mac);
      sec = { kind: 'macro', m: mac };
      continue;
    }
    switch (sec.kind) {
      case 'header': {
        const kv = keyValue(t);
        if (kv) header[kv[0]] = kv[1];
        break;
      }
      case 'vars': {
        const kv = keyValue(t);
        if (!kv) break;
        if (kv[0] === 'KM') {
          const last = variables[variables.length - 1];
          if (last && last.comment === undefined) last.comment = kv[1];
        } else variables.push({ name: kv[0], expr: kv[1], line: i });
        break;
      }
      case 'contour': {
        if (t.startsWith('$E')) {
          closeElem();
          curElem = { index: parseInt(t.slice(2), 10), line: i, type: '', vals: {} };
          break;
        }
        if (!curElem) break;
        const kv = keyValue(t);
        if (kv) curElem.vals[kv[0]] = kv[1];
        else if (!curElem.type && /^[A-Z]+$/.test(t)) curElem.type = t;
        break;
      }
      case 'macro': {
        const kv = keyValue(t);
        if (!kv) break;
        if (kv[0] === 'KM') sec.m.comments.push(kv[1]);
        if (!(kv[0] in sec.m.params)) sec.m.params[kv[0]] = kv[1];
        sec.m.endLine = i;
        break;
      }
      default:
        break;
    }
  }
  closeElem();

  // 변수 계산
  const env = new Map<string, number>();
  const envLower = new Map<string, number>();
  const setEnv = (k: string, v: number): void => {
    env.set(k, v);
    envLower.set(k.toLowerCase(), v);
  };
  for (const [k, v] of Object.entries(header)) {
    const n = Number(v);
    if (k.startsWith('_') && v !== '' && Number.isFinite(n)) setEnv(k, n);
  }
  const lookup = { get: (name: string): number | undefined => env.get(name) ?? envLower.get(name.toLowerCase()) };
  const evalExpr = (expr: string, line: number, what: string): number | undefined => {
    const e = expr.trim();
    if (e === '') return undefined;
    const n = Number(e);
    if (Number.isFinite(n)) return n;
    try {
      const v = evalMprExpr(e, lookup);
      if (!Number.isFinite(v)) throw new ExprError('값이 수가 아님');
      return v;
    } catch (err) {
      if (!(err instanceof ExprError)) throw err;
      w.add(`${what} 식 "${e}"을 계산할 수 없음 — ${err.message}`, line);
      return undefined;
    }
  };
  // 변수: 차례대로 계산하고, 못 푼 것(뒤에 정의된 변수를 쓰는 식)은 더 풀리지 않을 때까지 다시 돈다
  const quiet = (expr: string): number | undefined => {
    const e = expr.trim();
    if (e === '') return undefined;
    const n = Number(e);
    if (Number.isFinite(n)) return n;
    try {
      const v = evalMprExpr(e, lookup);
      return Number.isFinite(v) ? v : undefined;
    } catch (err) {
      if (!(err instanceof ExprError)) throw err;
      return undefined;
    }
  };
  let pending: MprVariable[] = [];
  for (const v of variables) {
    const val = quiet(v.expr);
    if (val !== undefined) {
      v.value = val;
      setEnv(v.name, val);
    } else pending.push(v);
  }
  let late = false;
  for (let guard = 0; pending.length && guard < 50; guard++) {
    const next: MprVariable[] = [];
    for (const v of pending) {
      const val = quiet(v.expr);
      if (val !== undefined) {
        v.value = val;
        setEnv(v.name, val);
        late = true;
      } else next.push(v);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  for (const v of pending) evalExpr(v.expr, v.line, `변수 ${v.name}`);
  if (late) w.add('뒤에 정의된 변수를 쓰는 변수 식이 있음 — 정의 차례와 상관없이 풀어 계산함');

  const units: 'mm' | 'inch' = header.INCH === '1' ? 'inch' : 'mm';

  // 공작물
  let workpiece: MprWorkpiece | undefined;
  for (const m of macros)
    if (m.name.toLowerCase() === 'werkstck' || m.id === 100) {
      const L = evalExpr(m.params.LA ?? '', m.line, 'LA');
      const B = evalExpr(m.params.BR ?? '', m.line, 'BR');
      const D = evalExpr(m.params.DI ?? '', m.line, 'DI');
      if (L !== undefined && B !== undefined && D !== undefined) workpiece = { length: L, width: B, thickness: D, line: m.line };
      break;
    }
  if (!workpiece) {
    const L = Number(header._BSX);
    const B = Number(header._BSY);
    const D = Number(header._BSZ);
    if (L > 0 && B > 0 && D > 0) workpiece = { length: L, width: B, thickness: D, line: -1 };
    else w.add('공작물(WerkStck) 크기를 알 수 없음');
  }
  const thick = workpiece?.thickness ?? 0;
  if (workpiece) {
    // woodWOP 식에서 흔히 쓰는 판 크기 이름
    for (const [k, v] of [
      ['_BSX', workpiece.length],
      ['_BSY', workpiece.width],
      ['_BSZ', workpiece.thickness],
    ] as const)
      if (!env.has(k)) setEnv(k, v);
  }

  // 윤곽 요소 계산
  for (const c of contours) {
    let px = 0;
    let py = 0;
    let pz = 0;
    let first = true;
    /** 다음 요소와의 모서리에 걸 둥글리기·모따기 */
    let corner: { type: string; size: number; index: number; line: number } | null = null;
    const sharp = (cr: { type: string; line: number }, why: string): void => {
      w.add(`윤곽 요소 ${cr.type}(모서리 둥글리기·모따기): ${why} — 모서리 그대로 그림`, cr.line);
    };
    for (const e of elemRaw.get(c) ?? []) {
      const num = (key: string, dflt: number): number => {
        // 값이 없으면 woodWOP가 계산해 둔 .값, 그것도 없으면 앞 값
        const v = e.vals[key] ?? e.vals['.' + key];
        if (v === undefined) return dflt;
        return evalExpr(v, e.line, `윤곽 ${c.id} 요소 ${e.index} ${key}`) ?? dflt;
      };
      const type = e.type.toUpperCase();
      const x = num('X', px);
      const y = num('Y', py);
      const z = num('Z', pz);
      const el: MprContourElement = { type, index: e.index, line: e.line, x, y, z };
      if (type === 'KP' || first) {
        if (type !== 'KP') w.add(`윤곽 ${c.id}이 시작점(KP) 없이 시작함`, e.line);
      } else if (type === 'KA' || type === 'KSA') {
        const ds = num('DS', 0);
        const ccw = ds === 1;
        el.dir = ccw ? 'ccw' : 'cw';
        const arc = arcFrom(px, py, x, y, ccw, e.vals, (k) => (e.vals[k] === undefined ? undefined : num(k, 0)));
        if (arc) {
          el.arc = { cx: arc.cx, cy: arc.cy, sweep: arc.sweep };
          el.radius = arc.r;
        } else w.add(`윤곽 ${c.id} 요소 ${e.index}: 호 중심을 정할 수 없어 직선으로 그림`, e.line);
      } else if (type === 'KR' || type === 'KF') {
        if (corner) sharp(corner, '모서리가 겹침');
        const key = ['R', 'FA', 'L'].find((k) => e.vals[k] !== undefined || e.vals['.' + k] !== undefined);
        const size = key ? Math.abs(num(key, 0)) : 0;
        if (!(size > 0)) {
          w.add(`윤곽 요소 ${type}에 크기(R)가 없음 — 모서리 그대로 그림`, e.line);
          continue;
        }
        corner = { type, size, index: e.index, line: e.line };
        continue;
      } else if (type !== 'KL' && type !== 'KSL') w.add(`알 수 없는 윤곽 요소 ${type || '(종류 없음)'}`, e.line);
      if (corner) {
        // 앞 직선(A0 → A1)과 이 직선(A1 → 끝) 사이 모서리
        const cr = corner;
        corner = null;
        const n = c.elements.length;
        const A1 = c.elements[n - 1];
        const A0 = c.elements[n - 2];
        if (!A0 || !A1 || A1.arc || el.arc || (type !== 'KL' && type !== 'KSL')) sharp(cr, '앞뒤가 직선인 모서리만 지원');
        else {
          const l1 = Math.hypot(A1.x - A0.x, A1.y - A0.y);
          const l2 = Math.hypot(x - A1.x, y - A1.y);
          const u1 = [(A1.x - A0.x) / l1, (A1.y - A0.y) / l1];
          const u2 = [(x - A1.x) / l2, (y - A1.y) / l2];
          const cross = u1[0]! * u2[1]! - u1[1]! * u2[0]!;
          const turn = Math.acos(Math.max(-1, Math.min(1, u1[0]! * u2[0]! + u1[1]! * u2[1]!)));
          const d = cr.type === 'KR' ? cr.size * Math.tan(turn / 2) : cr.size;
          if (!(l1 > 0 && l2 > 0) || Math.abs(cross) < 1e-9) sharp(cr, '모서리가 꺾이지 않음');
          else if (d > l1 + 1e-9 || d > l2 + 1e-9) sharp(cr, '크기가 변보다 큼');
          else {
            const t1x = A1.x - u1[0]! * d;
            const t1y = A1.y - u1[1]! * d;
            const t2x = A1.x + u2[0]! * d;
            const t2y = A1.y + u2[1]! * d;
            const cz = A1.z;
            A1.x = t1x;
            A1.y = t1y;
            const fe: MprContourElement = { type: cr.type, index: cr.index, line: cr.line, x: t2x, y: t2y, z: cz };
            if (cr.type === 'KR') {
              const sg = cross > 0 ? 1 : -1;
              fe.arc = { cx: t1x - u1[1]! * cr.size * sg, cy: t1y + u1[0]! * cr.size * sg, sweep: sg * turn };
              fe.radius = cr.size;
              fe.dir = sg > 0 ? 'ccw' : 'cw';
            }
            c.elements.push(fe);
          }
        }
      }
      c.elements.push(el);
      px = x;
      py = y;
      pz = z;
      first = false;
    }
    if (corner) sharp(corner, '뒤에 요소가 없음');
  }

  // 가공
  const operations: MprOperation[] = [];
  const stats: MprPart['stats'] = { holes: 0, drillOps: 0, contourOps: 0, grooves: 0, pockets: 0, disabled: 0, other: 0 };
  for (const m of macros) {
    const kind = MACRO_KIND[m.name.toLowerCase()];
    if (kind === 'workpiece') continue;
    const p = m.params;
    const num = (key: string, dflt?: number): number | undefined => {
      const v = p[key];
      if (v === undefined || v === '') return dflt;
      // "STANDARD"는 woodWOP의 기본값 표시(이송 F_·회전 S_·공구 TNO 등 — 기계·공구 자료의 값을 씀): 식이 아니므로 기본값으로
      if (/^\s*standard\s*$/i.test(v)) return dflt;
      return evalExpr(v, m.line, `${m.name} ${key}`) ?? dflt;
    };
    let enabled = true;
    if (p['??'] !== undefined && num('??', 1) === 0) enabled = false;
    if (p.EN !== undefined && num('EN', 1) === 0) enabled = false;
    const label = p.MNM || m.comments.join(' ') || m.name;
    const tno = num('TNO');
    const base: OpBase = { macroId: m.id, macro: m.name, label, line: m.line, endLine: m.endLine, enabled, params: p };
    if (tno !== undefined) base.tool = tno;
    if (!enabled) stats.disabled++;
    const ko = (p.KO ?? '00').trim();
    if (ko !== '' && ko !== '00' && ko !== '0' && (kind === 'drillV' || kind === 'drillH' || kind === 'groove' || kind === 'pocket'))
      w.add(`좌표계 KO=${ko}는 기본 좌표계(위 면)로 봄`, m.line);
    switch (kind) {
      case 'drillV': {
        const x0 = num('XA', 0)!;
        const y0 = num('YA', 0)!;
        const du = num('DU', 0)!;
        const ti = num('TI', 0)!;
        const an = Math.max(1, Math.round(num('AN', 1)!));
        const ab = num('AB', 32)!;
        const wi = (num('WI', 0)! * Math.PI) / 180;
        const mi = num('MI', 0)!;
        const holes: MprHole[] = [];
        const depth = thick > 0 ? Math.min(ti, thick) : ti;
        const shift = mi === 1 ? -((an - 1) * ab) / 2 : 0;
        // UfluBohr는 아랫면(Z 0)에서 위로, BohrVert는 윗면에서 아래로
        const fromBottom = m.name.toLowerCase() === 'uflubohr';
        for (let k = 0; k < an; k++) {
          const d = shift + k * ab;
          holes.push({ start: [x0 + d * Math.cos(wi), y0 + d * Math.sin(wi), fromBottom ? 0 : thick], dir: [0, 0, fromBottom ? 1 : -1], depth });
        }
        if (!(du > 0)) w.add(fromBottom ? 'UfluBohr 지름(DU)이 0' : 'BohrVert 지름(DU)이 0', m.line);
        operations.push({ ...base, kind: 'drillV', holes, diameter: du, depth: ti, through: thick > 0 && ti >= thick - 1e-9, mode: p.BM });
        if (enabled) {
          stats.drillOps++;
          stats.holes += holes.length;
        }
        break;
      }
      case 'drillH': {
        const x0 = num('XA', 0)!;
        const y0 = num('YA', 0)!;
        const z0 = num('ZA', thick / 2)!;
        const du = num('DU', 0)!;
        const ti = num('TI', 0)!;
        const an = Math.max(1, Math.round(num('AN', 1)!));
        const ab = num('AB', 32)!;
        const bm = (p.BM ?? '').toUpperCase();
        let dir: [number, number, number];
        if (bm === 'XP') dir = [1, 0, 0];
        else if (bm === 'XM') dir = [-1, 0, 0];
        else if (bm === 'YP') dir = [0, 1, 0];
        else if (bm === 'YM') dir = [0, -1, 0];
        else {
          w.add(`BohrHoriz 방향 BM="${p.BM ?? ''}"을 몰라 X+로 봄`, m.line);
          dir = [1, 0, 0];
        }
        // 판 가장자리에서 바깥으로 향하면 뒤집는다(방향 뜻이 반대인 파일 대비)
        if (workpiece) {
          const out =
            (dir[0] > 0 && x0 >= workpiece.length - 1e-6) || (dir[0] < 0 && x0 <= 1e-6) || (dir[1] > 0 && y0 >= workpiece.width - 1e-6) || (dir[1] < 0 && y0 <= 1e-6);
          if (out) {
            dir = [dir[0] ? -dir[0] : 0, dir[1] ? -dir[1] : 0, 0];
            w.add('BohrHoriz 방향이 판 밖을 향해 반대로 뒤집어 그림', m.line);
          }
        }
        const step: [number, number] = dir[0] !== 0 ? [0, 1] : [1, 0];
        const holes: MprHole[] = [];
        const lim = workpiece ? (dir[0] !== 0 ? workpiece.length : workpiece.width) : Infinity;
        const depth = Math.min(ti, lim);
        for (let k = 0; k < an; k++) holes.push({ start: [x0 + step[0] * k * ab, y0 + step[1] * k * ab, z0], dir, depth });
        operations.push({ ...base, kind: 'drillH', holes, diameter: du, depth: ti, through: depth < ti, mode: p.BM });
        if (enabled) {
          stats.drillOps++;
          stats.holes += holes.length;
        }
        break;
      }
      case 'contour': {
        const op = contourOp(base, p, contours, thick, num, w);
        operations.push(op);
        if (enabled) stats.contourOps++;
        break;
      }
      case 'groove': {
        const xa = num('XA', 0)!;
        const ya = num('YA', 0)!;
        let xe = num('XE');
        let ye = num('YE');
        if (xe === undefined || ye === undefined) {
          const la = num('LA');
          const wi = (num('WI', 0)! * Math.PI) / 180;
          if (la !== undefined) {
            xe = xa + la * Math.cos(wi);
            ye = ya + la * Math.sin(wi);
          }
        }
        const nb = num('NB', 4)!;
        const ti = num('TI', num('ZA', 0))!;
        const op: MprBoxOp = { ...base, kind: 'groove', depth: ti, width: nb };
        if (xe !== undefined && ye !== undefined) {
          const len = Math.hypot(xe - xa, ye - ya);
          if (len > 0) {
            const dx = (xe - xa) / len;
            const dy = (ye - ya) / len;
            const rk = (p.RK ?? '').toUpperCase();
            const c = rk === 'WRKL' ? nb / 2 : rk === 'WRKR' ? -nb / 2 : 0;
            const depth = thick > 0 ? Math.min(ti, thick) : ti;
            const z0 = thick - depth;
            const off = c - nb / 2;
            op.length = len;
            op.box = { origin: [xa - dy * off, ya + dx * off, z0], u: [dx * len, dy * len, 0], v: [-dy * nb, dx * nb, 0], w: [0, 0, depth] };
          }
        } else w.add('Nuten 끝점(XE·YE 또는 LA)이 없음', m.line);
        operations.push(op);
        if (enabled) stats.grooves++;
        break;
      }
      case 'pocket': {
        const xa = num('XA', 0)!;
        const ya = num('YA', 0)!;
        const la = num('LA', 0)!;
        const br = num('BR', 0)!;
        const ti = num('TI', 0)!;
        const wi = (num('WI', 0)! * Math.PI) / 180;
        const op: MprBoxOp = { ...base, kind: 'pocket', depth: ti, width: br, length: la };
        if (la > 0 && br > 0) {
          const c = Math.cos(wi);
          const s = Math.sin(wi);
          const depth = thick > 0 ? Math.min(ti, thick) : ti;
          // XA·YA = 포켓 중심(추정)
          op.box = {
            origin: [xa - (c * la) / 2 + (s * br) / 2, ya - (s * la) / 2 - (c * br) / 2, thick - depth],
            u: [c * la, s * la, 0],
            v: [-s * br, c * br, 0],
            w: [0, 0, depth],
          };
        } else w.add('Tasche 크기(LA·BR)가 없음', m.line);
        operations.push(op);
        if (enabled) stats.pockets++;
        break;
      }
      case 'edge': {
        const op = edgeOp(base, p, contours, workpiece, num, w);
        operations.push(op);
        if (enabled) stats.edges = (stats.edges ?? 0) + 1;
        break;
      }
      case 'comment':
        operations.push({ ...base, kind: 'comment', label: m.comments.join(' ') || label });
        break;
      default: {
        const xa = p.XA !== undefined ? num('XA') : undefined;
        const ya = p.YA !== undefined ? num('YA') : undefined;
        const op: MprOtherOp = { ...base, kind: 'other' };
        if (xa !== undefined && ya !== undefined) op.at = [xa, ya, thick];
        w.add(`지원하지 않는 매크로 <${m.id} \\${m.name}\\ — ${op.at ? '목록과 위치(점)만 넣음' : '목록에만 넣음'}`, m.line);
        operations.push(op);
        stats.other++;
      }
    }
  }
  if (!ended) w.add('파일 끝 표시(!)가 없음');
  const name = opts.name ?? (header.PARTID || header.ARTICLE || 'MPR');
  return {
    format: 'mpr',
    name,
    version: header.VERSION,
    units,
    header,
    variables,
    workpiece,
    contours,
    operations,
    lines,
    stats,
    warnings: w.list(),
    warningItems: w.items(),
  };
}

/**
 * 호 중심: I·J(절대 중심)가 있으면 그것, 아니면 R과 방향으로 두 후보를 구해 .I/.J(계산된 중심)에 가까운 것,
 * 그것도 없으면 짧은 호(R<0이면 긴 호).
 */
function arcFrom(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  ccw: boolean,
  vals: Record<string, string>,
  num: (k: string) => number | undefined,
): { cx: number; cy: number; sweep: number; r: number } | null {
  let cx: number | undefined;
  let cy: number | undefined;
  const ok = (x: number, y: number): boolean => {
    const r0 = Math.hypot(sx - x, sy - y);
    const r1 = Math.hypot(ex - x, ey - y);
    return r0 > 1e-9 && Math.abs(r0 - r1) <= Math.max(1e-3, r0 * 1e-3);
  };
  const I = num('I');
  const J = num('J');
  if (I !== undefined && J !== undefined && ok(I, J)) {
    cx = I;
    cy = J;
  }
  const R = num('R');
  const dI = vals['.I'] !== undefined ? Number(vals['.I']) : undefined;
  const dJ = vals['.J'] !== undefined ? Number(vals['.J']) : undefined;
  if (cx === undefined && R !== undefined && R !== 0) {
    const dx = ex - sx;
    const dy = ey - sy;
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) {
      let r = Math.abs(R);
      if (d / 2 > r) r = d / 2;
      const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
      const cand = (side: number): [number, number] => [sx + dx / 2 - (side * h * dy) / d, sy + dy / 2 + (side * h * dx) / d];
      const minor = cand((ccw ? 1 : -1) * (R < 0 ? -1 : 1));
      const major = cand((ccw ? -1 : 1) * (R < 0 ? -1 : 1));
      let pick = minor;
      if (dI !== undefined && dJ !== undefined && Number.isFinite(dI) && Number.isFinite(dJ) && ok(dI, dJ)) {
        pick = Math.hypot(major[0] - dI, major[1] - dJ) < Math.hypot(minor[0] - dI, minor[1] - dJ) ? major : minor;
      }
      cx = pick[0];
      cy = pick[1];
    }
  }
  if (cx === undefined && dI !== undefined && dJ !== undefined && Number.isFinite(dI) && Number.isFinite(dJ) && ok(dI, dJ)) {
    cx = dI;
    cy = dJ;
  }
  if (cx === undefined || cy === undefined) return null;
  const TAU = Math.PI * 2;
  const same = Math.hypot(ex - sx, ey - sy) < 1e-9;
  let sweep = Math.atan2(ey - cy, ex - cx) - Math.atan2(sy - cy, sx - cx);
  if (ccw) {
    if (same) sweep = TAU;
    else while (sweep <= 0) sweep += TAU;
  } else if (same) sweep = -TAU;
  else while (sweep >= 0) sweep -= TAU;
  return { cx, cy, sweep, r: Math.hypot(sx - cx, sy - cy) };
}

/** "c:e" → [c, e] */
function contourRef(v: string | undefined): [number, number | undefined] | undefined {
  if (!v) return undefined;
  const m = /^\s*(\d+)\s*(?::\s*(\d+))?\s*$/.exec(v);
  if (!m) return undefined;
  return [+m[1]!, m[2] !== undefined ? +m[2] : undefined];
}

/** 윤곽 c의 i0번째부터 i1번째 요소까지 점열(i0 > i1이면 거꾸로 — 호는 반대 끝점으로, 각은 반대로) */
function sectionPath(c: MprContour, i0: number, i1: number): PathPoint[] {
  if (i0 <= i1) {
    const path: PathPoint[] = [];
    for (let i = i0; i <= i1; i++) {
      const e = c.elements[i]!;
      const pt: PathPoint = { x: e.x, y: e.y, z: e.z };
      if (i > i0 && e.arc) pt.arc = { ...e.arc };
      path.push(pt);
    }
    return path;
  }
  const fwd = sectionPath(c, i1, i0);
  const path = fwd.map((q) => ({ x: q.x, y: q.y, z: q.z }) as PathPoint);
  path.reverse();
  for (let k = 1; k < fwd.length; k++) {
    const a = fwd[k]!.arc;
    if (a) path[fwd.length - k]!.arc = { cx: a.cx, cy: a.cy, sweep: -a.sweep };
  }
  return path;
}

/** 윤곽 요소 번호(e) → 차례(없으면 dflt) */
function elementAt(c: MprContour, e: number | undefined, dflt: number): number {
  if (e === undefined) return dflt;
  const i = c.elements.findIndex((x) => x.index === e);
  return i < 0 ? dflt : i;
}

const ARC_STEP = Math.PI / 36;

/** 점열(호 포함)을 XY 꺾은선으로(호는 ARC_STEP 이하 조각) */
export function pathPolyline(path: readonly PathPoint[], step = ARC_STEP): [number, number][] {
  const out: [number, number][] = [];
  path.forEach((b, i) => {
    if (i === 0 || !b.arc) {
      out.push([b.x, b.y]);
      return;
    }
    const a = path[i - 1]!;
    const { cx, cy, sweep } = b.arc;
    const r0 = Math.hypot(a.x - cx, a.y - cy);
    const r1 = Math.hypot(b.x - cx, b.y - cy);
    const t0 = Math.atan2(a.y - cy, a.x - cx);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / step - 1e-9));
    for (let k = 1; k < n; k++) {
      const f = k / n;
      const r = r0 + (r1 - r0) * f;
      out.push([cx + r * Math.cos(t0 + sweep * f), cy + r * Math.sin(t0 + sweep * f)]);
    }
    out.push([b.x, b.y]);
  });
  return out;
}

/** 윤곽이 닫혔는지(마지막 점이 첫 점과 같음) */
function isClosed(c: MprContour): boolean {
  const a = c.elements[0];
  const b = c.elements[c.elements.length - 1];
  return !!a && !!b && c.elements.length > 2 && Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6 * Math.max(1, Math.abs(a.x), Math.abs(a.y));
}

/**
 * 띠가 놓이는 쪽(판 재료에서 먼 쪽, 진행 방향 기준 1 = 왼쪽·-1 = 오른쪽).
 * 닫힌 윤곽: 판 가장자리에 닿거나 판을 모르면 바깥 윤곽이라 둘러싼 넓이의 바깥쪽, 판 안에 떠 있으면 따낸 구멍이라 안쪽.
 * 열린 윤곽: 조각마다 판 가운데(판을 모르면 윤곽 가운데)에서 먼 쪽을 길이로 투표
 */
function bandSide(path: readonly PathPoint[], c: MprContour, wp: MprWorkpiece | undefined): 1 | -1 {
  const all = pathPolyline(sectionPath(c, 0, c.elements.length - 1));
  if (isClosed(c)) {
    let area = 0;
    for (let i = 1; i < all.length; i++) area += all[i - 1]![0] * all[i]![1] - all[i]![0] * all[i - 1]![1];
    const tol = 1e-3;
    const outer = !wp || all.some(([x, y]) => x <= tol || y <= tol || x >= wp.length - tol || y >= wp.width - tol);
    // 반시계(넓이 +)면 둘러싼 쪽이 왼쪽
    const enclosedLeft = area > 0;
    return (outer ? !enclosedLeft : enclosedLeft) ? 1 : -1;
  }
  let cx: number;
  let cy: number;
  if (wp) {
    cx = wp.length / 2;
    cy = wp.width / 2;
  } else {
    const xs = all.map((q) => q[0]);
    const ys = all.map((q) => q[1]);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const pts = pathPolyline(path);
  let vote = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    // 왼쪽 법선(-dy, dx)과 가운데 → 조각 가운데 방향의 내적(길이 곱해짐)
    vote += -(by - ay) * ((ax + bx) / 2 - cx) + (bx - ax) * ((ay + by) / 2 - cy);
  }
  return vote < 0 ? -1 : 1;
}

/** 188 Easyedge(엣지 밴딩): EA..EE 윤곽 구간, DK 띠 두께. 띠는 판 재료에서 먼 쪽 옆면에 붙인다 */
function edgeOp(
  base: OpBase,
  p: Record<string, string>,
  contours: MprContour[],
  wp: MprWorkpiece | undefined,
  num: (k: string, d?: number) => number | undefined,
  w: NcWarnings,
): MprEdgeOp {
  const op: MprEdgeOp = { ...base, kind: 'edge' };
  const dk = num('DK');
  if (dk !== undefined && dk > 0) op.thickness = dk;
  const ea = contourRef(p.EA);
  const ee = contourRef(p.EE);
  if (!ea) {
    w.add(`${base.macro}에 시작 요소(EA)가 없음`, base.line);
    return op;
  }
  const c = contours.find((k) => k.id === ea[0]);
  if (!c || c.elements.length < 2) {
    w.add(`${base.macro}: 윤곽 ${ea[0]}이 없음`, base.line);
    return op;
  }
  op.contour = c.id;
  let i0 = elementAt(c, ea[1], 0);
  let i1 = ee && ee[0] === ea[0] ? elementAt(c, ee[1], c.elements.length - 1) : c.elements.length - 1;
  // 띠는 방향이 없다: 앞쪽 차례로
  if (i0 > i1) [i0, i1] = [i1, i0];
  if (i0 === i1) {
    w.add(`${base.macro}: 윤곽 구간이 비어 있음`, base.line);
    return op;
  }
  op.startElement = c.elements[i0]!.index;
  op.endElement = c.elements[i1]!.index;
  op.path = sectionPath(c, i0, i1);
  op.side = bandSide(op.path, c, wp);
  return op;
}

function contourOp(
  base: OpBase,
  p: Record<string, string>,
  contours: MprContour[],
  thick: number,
  num: (k: string, d?: number) => number | undefined,
  w: NcWarnings,
): MprContourOp {
  const rk = (p.RK ?? '').toUpperCase();
  const op: MprContourOp = { ...base, kind: 'contour', comp: rk === 'WRKL' ? 'left' : rk === 'WRKR' ? 'right' : 'none' };
  const f = num('F_');
  if (f !== undefined) op.feed = f;
  const ea = contourRef(p.EA);
  const ee = contourRef(p.EE);
  if (!ea) {
    w.add('Konturfraesen에 시작 요소(EA)가 없음', base.line);
    return op;
  }
  op.contour = ea[0];
  const c = contours.find((k) => k.id === ea[0]);
  if (!c || c.elements.length === 0) {
    w.add(`Konturfraesen: 윤곽 ${ea[0]}이 없음`, base.line);
    return op;
  }
  const idxOf = (e: number | undefined, dflt: number): number => elementAt(c, e, dflt);
  const i0 = idxOf(ea[1], 0);
  const i1 = ee && ee[0] === ea[0] ? idxOf(ee[1], c.elements.length - 1) : c.elements.length - 1;
  op.startElement = c.elements[i0]!.index;
  op.endElement = c.elements[i1]!.index;
  const path = sectionPath(c, i0, i1);
  // 깊이: ZA="@d" → 윤곽 Z에서 d 더 깊게, ZA·TI 수 → 윗면에서 그만큼 아래(평면 윤곽)
  const za = (p.ZA ?? '').trim();
  if (za.startsWith('@')) {
    const d = Number(za.slice(1)) || 0;
    for (const q of path) q.z -= d;
  } else {
    const depth = za !== '' ? num('ZA') : num('TI');
    if (depth !== undefined) for (const q of path) q.z = thick - depth;
  }
  op.path = path;
  return op;
}

/** 글이 MPR처럼 보이는지 */
export function looksLikeMpr(head: string): boolean {
  return /^\s*\[H\s*$/m.test(head) && (/^\s*VERSION\s*=/m.test(head) || /^<\s*\d+\s*\\/m.test(head));
}
