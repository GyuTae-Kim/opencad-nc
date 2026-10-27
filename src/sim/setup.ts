/**
 * 깎기 시뮬레이션 준비(순수 함수 — 화면 모듈과 시험이 쓴다): 3축으로 시뮬레이션할 수 있는지, 소재 기본값, 격자 크기, 공구 표.
 *
 * 3축(공구 방향 Z)이 아닌 프로그램은 그리지 않고 까닭을 알린다: 선반, 회전축(A·B·C) 낱말, 기울인 작업 평면·공구 끝점 제어
 * (G68.2·G68.3·G68.4·G268·G43.4·G43.5·G53.1·G53.6, Siemens TRAORI·CYCLE800·ROT X/Y, Heidenhain PLANE·CYCL DEF 19·M128·
 * FUNCTION TCPM·공구 축이 X·Y인 TOOL CALL). 주석 안의 낱말은 보지 않는다.
 * 판재 형식(MPR·PGI·XML)은 해석 워커가 만든 재료(src/sim/panel.ts)로 윗면 가공만 시뮬레이션한다 — 재료가 없거나 윗면 가공이 없으면 알린다.
 */
import { FLAG_MACHINE_EST, MOVE_ARC, MOVE_FEED, type NcTool } from '../model';
import type { PanelSimSource } from './panel';
import { resolveTool, fileTool, toolHintsFromSource, type SimToolRow, type SimToolTable } from './tool';

export type SimBlockCode = 'panel' | 'panel-none' | 'lathe' | 'rotary' | 'tilt' | 'tool-axis' | 'no-cut';

/** 시뮬레이션하지 않는 까닭 */
export interface SimBlock {
  code: SimBlockCode;
  /** 찾은 낱말(G68.2·PLANE 등 — 파일 자료) */
  token?: string;
  /** 찾은 줄(0부터, 모르면 -1) */
  line: number;
}

/** 까닭 → 화면 글(사전에 같은 글이 있다) */
export const SIM_BLOCK_TEXT: Record<SimBlockCode, string> = {
  panel: '판재 파일의 시뮬레이션 자료가 없습니다(파일을 다시 열어 보십시오).',
  'panel-none': '판 윗면에서 위→아래로 깎는 가공이 없어 시뮬레이션할 것이 없습니다.',
  lathe: '선반 프로그램은 시뮬레이션하지 않습니다.',
  rotary: '회전축(A·B·C)을 쓰는 프로그램은 시뮬레이션하지 않습니다(4·5축).',
  tilt: '기울인 작업 평면·공구 끝점 제어(5축)가 있어 시뮬레이션하지 않습니다.',
  'tool-axis': '공구 축이 Z가 아닌 공구 호출이 있어 시뮬레이션하지 않습니다.',
  'no-cut': '절삭 이동(이송·원호·드릴)이 없어 시뮬레이션할 것이 없습니다.',
};

/** 주석을 같은 길이의 빈칸으로(줄 위치를 지킨다) */
export function blankComments(text: string, semicolon = true): string {
  let out = text.replace(/\([^()\n]*\)/g, (m) => ' '.repeat(m.length));
  if (semicolon) out = out.replace(/;[^\n]*/g, (m) => ' '.repeat(m.length));
  return out;
}

const GCODE_TILT = /\b((?:G68\.[234]|G268|G43\.[45]|G53\.[16])(?![\d.])|TRAORI\b|CYCLE800\b|A?ROT\s+[XY](?=\s*=?\s*[-+.\d]))/i;
const HEID_TILT = /\b(PLANE\s+(?!RESET\b)[A-Z]+|CYCL\s+DEF\s+19|M128|FUNCTION\s+TCPM)\b/i;
const HEID_AXIS = /\bTOOL\s+CALL\b(?:\s+(?:\d+(?:\.\d+)?|"[^"\n]*"|'[^'\n]*'|[A-Z_][\w.]*))?\s+([XY])\b/i;
const HEID_ISO_AXIS = /^\s*N?\d*\s*T\d+\s+(G1[89])\b/im;

function lineOf(text: string, index: number): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/**
 * 시뮬레이션할 수 있는지(되면 null). text는 프로그램 글(없으면 글 검사를 건너뛴다)
 */
export function simBlocker(input: { kind: string; lathe: boolean; rotaryAxes: boolean; text: string | null; hasCut: boolean }): SimBlock | null {
  if (input.kind !== 'gcode' && input.kind !== 'heidenhain') return { code: 'panel', line: -1 };
  if (input.lathe) return { code: 'lathe', line: -1 };
  if (input.rotaryAxes) return { code: 'rotary', line: -1 };
  if (input.text) {
    const heid = input.kind === 'heidenhain';
    const t = blankComments(input.text, true);
    const tilt = (heid ? HEID_TILT : GCODE_TILT).exec(t);
    if (tilt) return { code: 'tilt', token: tilt[1]!.replace(/\s+/g, ' ').toUpperCase(), line: lineOf(t, tilt.index) };
    if (heid) {
      const ax = HEID_AXIS.exec(t) ?? HEID_ISO_AXIS.exec(t);
      if (ax) return { code: 'tool-axis', token: ax[0].trim().replace(/\s+/g, ' ').toUpperCase(), line: lineOf(t, ax.index + (ax[0].length - ax[0].trimStart().length)) };
    }
  }
  if (!input.hasCut) return { code: 'no-cut', line: -1 };
  return null;
}

/** 판재 파일을 시뮬레이션할 수 있는지(되면 null): 재료가 없으면 panel, 윗면에서 깎는 가공이 없으면 panel-none */
export function panelBlocker(src: PanelSimSource | null | undefined): SimBlock | null {
  if (!src) return { code: 'panel', line: -1 };
  if (!src.items.length) return { code: 'panel-none', line: -1 };
  return null;
}

/** 소재 상자 */
export interface SimBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** 이동 자료(모델 꼴의 일부) */
export interface SimMoveData {
  count: number;
  kind: Uint8Array;
  points: Float64Array;
  flags: Uint16Array;
}

/**
 * 소재 기본값: 프로그램의 공작물(Heidenhain BLK FORM)이 있으면 그것, 없으면 절삭 범위(공구 중심)에서 추정 —
 * 옆은 가장 큰 공구 반지름 + 여유(2 mm·0.08 inch와 크기의 4% 가운데 큰 것), 윗면은 Z0 아래를 깎으면 Z0(작업 원점 = 소재 윗면,
 * 가장 흔한 약속), 아니면 가장 높은 수평 절삭 높이, 바닥은 가장 깊은 절삭보다 여유(2 mm와 깊이의 1/4 가운데 큰 것)만큼 아래
 */
export function defaultStock(
  input: { stock?: SimBox | null; cutBounds?: SimBox | null; units: 'mm' | 'inch'; moves?: SimMoveData },
  maxToolRadius: number,
): SimBox | null {
  if (input.stock) return { min: [...input.stock.min] as SimBox['min'], max: [...input.stock.max] as SimBox['max'] };
  const cb = input.cutBounds;
  if (!cb) return null;
  const u = input.units === 'inch' ? 1 / 25.4 : 1;
  const w = cb.max[0] - cb.min[0];
  const l = cb.max[1] - cb.min[1];
  const pad = Math.max(0, maxToolRadius) + Math.max(2 * u, 0.04 * Math.max(w, l));
  const minZ = cb.min[2];
  let top: number;
  if (minZ < -1e-9) top = 0;
  else {
    // 작업 원점이 소재 위가 아니면: 가장 높은 수평 절삭(XY로 움직이는 이송·원호) 높이
    top = cb.max[2];
    const m = input.moves;
    if (m) {
      let best = -Infinity;
      for (let i = 0; i < m.count; i++) {
        const k = m.kind[i]!;
        if ((k !== MOVE_FEED && k !== MOVE_ARC) || m.flags[i]! & FLAG_MACHINE_EST) continue;
        const p = i * 3;
        const z0 = m.points[p + 2]!;
        const z1 = m.points[p + 5]!;
        if (Math.abs(z1 - z0) > 1e-9 * Math.max(1, Math.abs(z0))) continue;
        if (Math.hypot(m.points[p + 3]! - m.points[p]!, m.points[p + 4]! - m.points[p + 1]!) <= 1e-9) continue;
        if (z0 > best) best = z0;
      }
      if (Number.isFinite(best)) top = best;
    }
  }
  const depth = Math.max(0, top - minZ);
  const bottom = Math.min(minZ, top) - Math.max(2 * u, depth / 4);
  return { min: [cb.min[0] - pad, cb.min[1] - pad, bottom], max: [cb.max[0] + pad, cb.max[1] + pad, top] };
}

/** 격자 해상도(긴 변 칸 수) 고르기 */
export type SimResolution = 'auto' | 256 | 512 | 1024 | 2048;
export const SIM_RESOLUTIONS: readonly SimResolution[] = ['auto', 256, 512, 1024, 2048];

/** 자동: 휴대폰(또는 메모리 2 GB 이하) 384, 메모리 4 GB 이하 512, 그 밖 1024 */
export function longCellsFor(r: SimResolution, phone: boolean, deviceMemory?: number): number {
  if (r !== 'auto') return r;
  if (phone || (deviceMemory !== undefined && deviceMemory <= 2)) return 384;
  if (deviceMemory !== undefined && deviceMemory <= 4) return 512;
  return 1024;
}

/**
 * 계산량 어림(살펴볼 마디 수 × 칸 넓이): 소재 윗면 아래로 내려가는 이동마다 기울어진 이동은 공구 원 넓이 + 지나간 띠,
 * 수평 이동은 띠, 수직 이동은 공구 원(같은 자리를 다시 지나는 수평 이동은 덩어리 건너뛰기로 거의 공짜라 띠만 센다)
 */
export function sweepArea(m: SimMoveData, radiusOf: (i: number) => number, top: number): number {
  let area = 0;
  for (let i = 0; i < m.count; i++) {
    if (m.flags[i]! & FLAG_MACHINE_EST) continue;
    const p = i * 3;
    const z0 = m.points[p + 2]!;
    const z1 = m.points[p + 5]!;
    if (Math.min(z0, z1) >= top) continue;
    const r = radiusOf(i);
    const l = Math.hypot(m.points[p + 3]! - m.points[p]!, m.points[p + 4]! - m.points[p + 1]!);
    const dz = Math.abs(z1 - z0);
    area += 2 * r * l + (dz > 1e-9 ? Math.PI * r * r : 0);
  }
  return area;
}

/**
 * 자동 해상도의 긴 변 칸 수: 기기 기준(longCellsFor)에서 시작해, 어림 계산량(sweepArea / 칸 넓이)이 한도(넓은 화면 2억, 휴대폰 4천만 마디)를
 * 넘으면 칸을 키운다(256칸 아래로는 줄이지 않는다). 큰 3D 다듬기 프로그램이 몇십 초씩 걸리지 않게
 */
export function autoLongCells(base: number, longSide: number, area: number, phone: boolean): number {
  const budget = phone ? 4e7 : 2e8;
  if (!(area > 0) || !(longSide > 0)) return base;
  const cell = Math.sqrt(area / budget);
  const n = Math.floor(longSide / cell);
  return Math.max(Math.min(256, base), Math.min(base, n));
}

/** 절삭 이동이 있는지(기계 좌표 쪽 추정 이동은 빼고) */
export function hasCutMoves(m: SimMoveData): boolean {
  for (let i = 0; i < m.count; i++) {
    const k = m.kind[i]!;
    if (k !== 0 && !(m.flags[i]! & FLAG_MACHINE_EST)) return true;
  }
  return false;
}

/** 해석기가 이미 내는 급속 경고(가장 깊은 절삭보다 아래로 · 공작물 윗면보다 낮은 급속 수평 이동) */
const RAPID_WARNING = /^(?:급속 이동이 가장 깊은 절삭|공작물 윗면\()/;

/**
 * 급속 사건 → 줄마다 한 줄(가장 깊은 깊이, 처음 이동). 해석 경고에 이미 급속 경고가 있는 줄은 빼고 그 수를 센다(같은 줄을 두 번 알리지 않게)
 */
export function rapidEventRows(
  events: readonly { move: number; depth: number }[],
  lineOfMove: ArrayLike<number>,
  warnItems: readonly { text: string; line: number; lines: readonly number[] }[],
  max = 200,
): { rows: { move: number; line: number; depth: number }[]; skipped: number } {
  const warned = new Set<number>();
  for (const w of warnItems) if (RAPID_WARNING.test(w.text)) for (const l of w.lines.length ? w.lines : [w.line]) warned.add(l);
  const byLine = new Map<number, { move: number; line: number; depth: number }>();
  const skipped = new Set<number>();
  for (const e of events) {
    const line = lineOfMove[e.move] ?? -1;
    if (warned.has(line)) {
      skipped.add(line);
      continue;
    }
    const cur = byLine.get(line);
    if (cur) cur.depth = Math.max(cur.depth, e.depth);
    else byLine.set(line, { move: e.move, line, depth: e.depth });
  }
  return { rows: [...byLine.values()].slice(0, max), skipped: skipped.size };
}

/** 이동이 쓰는 공구 번호(처음 나온 차례, -1 = 공구 없음) */
export function usedTools(tool: Int32Array, count: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = tool[i]!;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * 공구 표: 이동이 쓰는 공구마다 파일 값(지름·이름·주석 CR=)과 사용자 표를 합친 값
 */
export function simToolRows(
  input: { tools: readonly NcTool[]; units: 'mm' | 'inch'; used: readonly number[]; lineAt: (i: number) => string; lineCount: number },
  user: SimToolTable,
): SimToolRow[] {
  const hints = toolHintsFromSource(input.lineAt, input.lineCount, input.tools);
  return input.used.map((n) => {
    const t = input.tools.find((x) => x.number === n);
    const file = t ? fileTool(t, hints.get(n)) : {};
    return resolveTool(n, file, user[String(n)], input.units);
  });
}

/** 판재 공구의 사용자 표 열쇠(G-code 공구 번호와 섞이지 않게 'panel:' 앞붙임 — panel:D8 · panel:T101 · panel:R12) */
export function panelToolKey(t: { key: string }): string {
  return `panel:${t.key}`;
}

/**
 * 판재 공구 표: 재료의 공구마다 파일 값(구멍 지름·공구 폭)과 사용자 표를 합친 값. number = 재료의 공구 차례(이동의 공구 번호), key = 사용자 표 열쇠
 */
export function panelToolRows(src: PanelSimSource, user: SimToolTable): SimToolRow[] {
  return src.tools.map((t, i) => {
    const key = panelToolKey(t);
    return { ...resolveTool(i, t.diameter !== undefined && t.diameter > 0 ? { diameter: t.diameter } : {}, user[key], src.units), key };
  });
}
