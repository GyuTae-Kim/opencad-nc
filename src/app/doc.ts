/**
 * 열린 NC 문서 하나의 상태와 형식별 도움 함수(순수, DOM 없음).
 * 한 번에 문서 하나만 연다. 새 파일을 열면 문서를 통째로 바꾸고, 방언·단위를 바꿔 다시 읽으면 결과만 바꿔 끼운다.
 */
import type { MeasureResult, Pick3d, Scene3d } from 'opencad-viewer3d';
import { MOVE_KIND_NAMES, NC_DIALECT_NAMES } from '../model';
import { sourceLine } from '../text';
import { idRange } from '../view/playback';
import { fmtCount, fmtNum, fmtPt, formatBytes, formatMs } from './format';
import { statusMeasureHint } from './measure';
import type { MprPayload, NcKind, NcOpenOptions, NcPayload, ParseResult } from './protocol';

export type PanelTab = 'code' | 'tools' | 'info' | 'ops' | 'vars';

export interface NcDoc {
  /** 파일 이름 */
  name: string;
  /** 파일 크기(바이트) */
  size: number;
  kind: NcKind;
  scene: Scene3d;
  nc: NcPayload | null;
  mpr: MprPayload | null;
  ncOptions: NcOpenOptions;
  /** 해석 시간(ms) */
  ms: number;
  // ── 보기 상태 ──
  /** 닫은 해석 판단 띠(종류 열쇠) — 다시 읽어도 그대로 둔다 */
  dismissedNotices: Set<string>;
  hiddenGroups: Set<string>;
  /** 뷰어 강조(항목 id) */
  highlight: string[];
  pick: Pick3d | null;
  measure: MeasureResult | null;
  /** 코드 보기에서 고른 줄(-1 없음)과 덧그림으로 강조할 이동 */
  selLine: number;
  selMoves: number[];
  /** MPR 가공에서 고른 것(가공 번호 글) */
  selKey: string | null;
  /** 재생 시각(초, null = 전체 경로) */
  playSec: number | null;
  panelTab: PanelTab;
}

export function createDoc(name: string, size: number, res: ParseResult, ncOptions: NcOpenOptions = {}): NcDoc {
  return {
    name,
    size,
    kind: res.kind,
    scene: res.scene,
    nc: res.nc ?? null,
    mpr: res.mpr ?? null,
    ncOptions: { ...ncOptions },
    ms: res.ms,
    dismissedNotices: new Set(),
    hiddenGroups: new Set(),
    highlight: [],
    pick: null,
    measure: null,
    selLine: -1,
    selMoves: [],
    selKey: null,
    playSec: null,
    panelTab: res.kind === 'mpr' ? 'ops' : 'code',
  };
}

/** 다시 읽은 결과를 같은 문서에 바꿔 끼운다(고른 것·재생 위치는 지운다) */
export function replaceResult(d: NcDoc, res: ParseResult, opts: NcOpenOptions): void {
  d.kind = res.kind;
  d.scene = res.scene;
  d.nc = res.nc ?? null;
  d.mpr = res.mpr ?? null;
  d.ms = res.ms;
  d.ncOptions = { ...opts };
  d.hiddenGroups.clear();
  d.highlight = [];
  d.pick = null;
  d.measure = null;
  d.selLine = -1;
  d.selMoves = [];
  d.selKey = null;
  d.playSec = null;
  if (!panelTabs(d).some(([k]) => k === d.panelTab)) d.panelTab = panelTabs(d)[0]![0];
}

/** 해석 판단 띠 하나: 글과 행동(다른 설정으로 다시 읽기, 또는 패널 탭 열기) */
export interface NoticeView {
  key: string;
  text: string;
  action?: { label: string; opts?: NcOpenOptions; tab?: PanelTab };
}

const DIALECT_NOTICE: Record<string, string> = {
  siemens: 'Siemens Sinumerik 프로그램으로 읽었습니다(판별).',
  'heidenhain-iso': 'Heidenhain DIN/ISO 프로그램으로 읽었습니다(판별).',
  okuma: 'Okuma OSP 프로그램으로 보입니다 — CALL·VC 변수·G15 H 좌표계는 읽지 않아 경로가 모자랄 수 있습니다.',
};

/** 문서의 해석 판단 → 띠(닫은 것은 뺀다) */
export function noticeViews(d: Pick<NcDoc, 'nc' | 'ncOptions' | 'dismissedNotices'>): NoticeView[] {
  const out: NoticeView[] = [];
  for (const n of d.nc?.notices ?? []) {
    let v: NoticeView | null = null;
    if (n.kind === 'lathe-auto') v = { key: 'lathe-auto', text: '선반 프로그램으로 보여 선반 모드(X 지름·선반 사이클·XZ 단면)로 읽었습니다.', action: { label: '밀링으로 읽기', opts: { ...d.ncOptions, lathe: false } } };
    else if (n.kind === 'integer-units')
      v = { key: 'integer-units', text: '소수점 없는 큰 좌표가 많습니다 — 최소 입력 단위(0.001 mm·0.0001 inch)로 쓴 Fanuc 프로그램일 수 있습니다.', action: { label: '최소 단위로 읽기', opts: { ...d.ncOptions, integerUnits: true } } };
    else if (n.kind === 'dialect' && n.dialect && DIALECT_NOTICE[n.dialect]) v = { key: `dialect-${n.dialect}`, text: DIALECT_NOTICE[n.dialect]!, action: { label: '방언 바꾸기', tab: 'info' } };
    if (v && !d.dismissedNotices.has(v.key)) out.push(v);
  }
  return out;
}

/** 문서 종류별 패널 탭 */
export function panelTabs(d: Pick<NcDoc, 'kind'>): [PanelTab, string][] {
  if (d.kind === 'mpr')
    return [
      ['ops', '가공'],
      ['vars', '변수'],
      ['code', '코드'],
      ['info', '정보'],
    ];
  return [
    ['code', '코드'],
    ['tools', '공구'],
    ['info', '정보'],
  ];
}

/** 장면 단위 → 글 */
export function unitLabel(u: Scene3d['units']): string {
  return u === 'mm' ? 'mm' : u === 'inch' ? 'in' : u === 'm' ? 'm' : '';
}

/** 형식 설명(상태 막대·정보) */
export function docLabel(d: Pick<NcDoc, 'kind' | 'nc' | 'scene'>): string {
  if (d.kind === 'heidenhain') return 'Heidenhain 평문';
  if (d.kind === 'mpr') {
    const v = (d.scene.meta as { version?: unknown } | undefined)?.version;
    return `woodWOP MPR${typeof v === 'string' && v ? ` ${v}` : ''}`;
  }
  return d.nc ? `G-code · ${NC_DIALECT_NAMES[d.nc.dialect]}` : 'G-code';
}

/** 장면 크기 요약 */
export function sceneCounts(s: Scene3d): { triangles: number; segments: number; points: number } {
  let triangles = 0;
  let segments = 0;
  let points = 0;
  for (const m of s.meshes) triangles += (m.indices ? m.indices.length : m.positions.length / 3) / 3;
  for (const l of s.lines) segments += l.positions.length / 6;
  for (const p of s.points ?? []) points += p.positions.length / 3;
  return { triangles: Math.round(triangles), segments: Math.round(segments), points: Math.round(points) };
}

/** MPR 가공 목록(scene.meta.operations) */
export interface MprOpRow {
  index: number;
  kind: string;
  label: string;
  line?: number;
  enabled: boolean;
  tool?: number;
  diameter?: number;
  depth?: number;
  holeCount?: number;
}

export function mprOps(scene: Scene3d): MprOpRow[] {
  const ops = (scene.meta as { operations?: unknown } | undefined)?.operations;
  return Array.isArray(ops) ? (ops as MprOpRow[]) : [];
}

/** MPR 변수(scene.meta.variables) */
export interface MprVarRow {
  name: string;
  value?: number;
  expr: string;
  comment?: string;
}

export function mprVars(scene: Scene3d): MprVarRow[] {
  const v = (scene.meta as { variables?: unknown } | undefined)?.variables;
  return Array.isArray(v) ? (v as MprVarRow[]) : [];
}

/** 줄 i를 품은 MPR 가공(시작 줄이 i 이하인 마지막 가공). 없으면 -1 */
export function mprOpAtLine(ops: readonly MprOpRow[], line: number): number {
  let best = -1;
  let bestLine = -1;
  for (const o of ops) if (typeof o.line === 'number' && o.line <= line && o.line >= bestLine) {
    best = o.index;
    bestLine = o.line;
  }
  return best;
}

/** 줄 line이 만든 이동 번호들(cap개까지) */
export function lineMoveList(nc: Pick<NcPayload, 'lineMoves'>, line: number, cap = 5000): number[] {
  const { offsets, moves } = nc.lineMoves;
  if (line < 0 || line + 1 >= offsets.length) return [];
  const s = offsets[line]!;
  const e = Math.min(offsets[line + 1]!, s + cap);
  const out: number[] = [];
  for (let i = s; i < e; i++) out.push(moves[i]!);
  return out;
}

/**
 * 이동 번호들을 장면의 선분 쌍으로(호는 나눈 선분). segmentIds가 오름차순인 NC 선분 묶음(nc-*)만 본다.
 * 반경 보정 경로(nc-comp)는 프로그램 경로가 아니므로 빼고, withComp면 넣는다.
 */
export function moveSegments(scene: Scene3d, moveIds: readonly number[], maxSegs = 200_000, withComp = false): Float32Array {
  const parts: Float32Array[] = [];
  let n = 0;
  const want = [...new Set(moveIds)].sort((a, b) => a - b);
  for (const l of scene.lines) {
    const ids = l.segmentIds;
    if (!ids || !l.id.startsWith('nc-') || (!withComp && l.id === 'nc-comp')) continue;
    for (const m of want) {
      const [a, b] = idRange(ids, m);
      if (b <= a) continue;
      parts.push(l.positions.subarray(a * 6, b * 6));
      n += b - a;
      if (n >= maxSegs) break;
    }
    if (n >= maxSegs) break;
  }
  const out = new Float32Array(Math.min(n, maxSegs) * 6);
  let o = 0;
  for (const p of parts) {
    const k = Math.min(p.length, out.length - o);
    if (k <= 0) break;
    out.set(p.subarray(0, k), o);
    o += k;
  }
  return out;
}

/** 이동의 직선 끝점(선분을 못 찾을 때) */
export function moveEndPoint(nc: Pick<NcPayload, 'moves'>, i: number): [number, number, number] | null {
  if (i < 0 || i >= nc.moves.count) return null;
  const k = (i + 1) * 3;
  const p = nc.moves.points;
  return [p[k]!, p[k + 1]!, p[k + 2]!];
}

/** 공구가 만든 첫 이동의 줄(이동이 없으면 -1) */
export function toolFirstMoveLine(nc: Pick<NcPayload, 'moves'>, tool: number): number {
  const m = nc.moves;
  for (let i = 0; i < m.count; i++) if (m.tool[i] === tool) return m.line[i]!;
  return -1;
}

/**
 * 공구 줄을 눌렀을 때 고를 코드 줄: 공구가 처음 나온 줄이 그 공구의 이동을 만들면 그 줄,
 * 아니면(공구 교환 줄 등) 그 공구의 첫 이동 줄.
 */
export function toolSelectLine(nc: Pick<NcPayload, 'moves' | 'lineMoves'>, tool: number, firstLine: number): number {
  if (firstLine >= 0 && lineMoveList(nc, firstLine).some((i) => nc.moves.tool[i] === tool)) return firstLine;
  const l = toolFirstMoveLine(nc, tool);
  return l >= 0 ? l : firstLine;
}

/** 상태 막대 경고 단추 글(경고가 없으면 '') */
export function warningLabel(d: Pick<NcDoc, 'scene'>): string {
  const n = d.scene.warnings?.length ?? 0;
  return n ? `경고 ${fmtCount(n)}` : '';
}

/** 장면 meta의 선택 기능 정보(보정 구간·선반·회전축) */
export function sceneFeatures(s: Scene3d): {
  compRunCount: number;
  compRuns: { first: number; end: number; side: number; radius: number; source: string; line: number; computed: boolean }[] | null;
  lathe: boolean;
  rotaryAxes: boolean;
  disabledOps: number;
} {
  const m = (s.meta ?? {}) as { compRunCount?: number; compRuns?: unknown; lathe?: boolean; rotaryAxes?: boolean; stats?: { disabled?: number } };
  return {
    compRunCount: m.compRunCount ?? 0,
    compRuns: Array.isArray(m.compRuns) ? (m.compRuns as ReturnType<typeof sceneFeatures>['compRuns']) : null,
    lathe: !!m.lathe,
    rotaryAxes: !!m.rotaryAxes,
    disabledOps: m.stats?.disabled ?? 0,
  };
}

/** 공구 번호 → 장면 묶음 이름(선분 묶음 nc-cut-·nc-drill-에서 찾는다) */
export function toolGroup(scene: Scene3d, tool: number): string | null {
  const key = tool < 0 ? 'none' : String(tool);
  const l = scene.lines.find((x) => x.id === `nc-cut-${key}` || x.id === `nc-drill-${key}`);
  return l?.group ?? null;
}

/** 공구 번호 → 장면 항목 id들 */
export function toolItems(scene: Scene3d, tool: number): string[] {
  const key = tool < 0 ? 'none' : String(tool);
  return scene.lines.filter((x) => x.id === `nc-cut-${key}` || x.id === `nc-drill-${key}`).map((x) => x.id);
}

/** 상태 막대 왼쪽: 형식·단위·파일 크기·이동(가공)/선분 수·읽은 시간 */
export function statusParts(d: NcDoc): string[] {
  const parts = [docLabel(d)];
  const u = unitLabel(d.scene.units);
  if (u) parts.push(`단위 ${u}`);
  parts.push(formatBytes(d.size));
  const c = sceneCounts(d.scene);
  if (d.nc) parts.push(`이동 ${fmtCount(d.nc.moves.count)}`);
  else if (d.kind === 'mpr') parts.push(`가공 ${fmtCount(mprOps(d.scene).length)}`);
  if (c.segments) parts.push(`선분 ${fmtCount(c.segments)}`);
  parts.push(`읽기 ${formatMs(d.ms)}`);
  return parts;
}

const KIND_LABEL: Record<string, string> = { rapid: '급속', feed: '직선 이송', arc: '원호 이송', drill: '드릴' };

/** 이동 하나의 설명("직선 이송 · T1 · F1200") */
export function moveSummary(nc: Pick<NcPayload, 'moves'>, i: number): string {
  if (i < 0 || i >= nc.moves.count) return '';
  const kind = MOVE_KIND_NAMES[nc.moves.kind[i]!] ?? 'feed';
  const tool = nc.moves.tool[i]!;
  const feed = nc.moves.feed[i]!;
  return `${KIND_LABEL[kind] ?? kind}${tool >= 0 ? ` · T${tool}` : ''}${kind !== 'rapid' && feed > 0 ? ` · F${fmtNum(feed, 1)}` : ''}`;
}

/**
 * 상태 막대 오른쪽: 고른 것 한 줄 요약(측정이 있으면 측정 먼저).
 * measuring은 측정 모드가 켜져 있는지(결과가 없으면 안내 글), touch는 손가락 기기인지(안내에서 Esc 설명을 뺀다).
 */
export function selectionSummary(d: NcDoc | null, measuring = false, touch = false): string {
  if (!d) return '';
  const u = unitLabel(d.scene.units);
  if (d.measure) {
    const m = d.measure;
    return `거리 ${fmtNum(m.distance)}${u ? ` ${u}` : ''} · dx ${fmtNum(m.dx)} · dy ${fmtNum(m.dy)} · dz ${fmtNum(m.dz)}`;
  }
  if (measuring) return statusMeasureHint(touch);
  const p = d.pick;
  if (d.nc && d.selLine >= 0) {
    const head = `줄 ${(d.selLine + 1).toLocaleString('ko-KR')}`;
    if (p && (p.kind === 'line' || p.kind === 'point') && p.id.startsWith('nc-') && p.index >= 0 && p.index < d.nc.moves.count) return `${head} · ${moveSummary(d.nc, p.index)} · ${fmtPt(p.point)}`;
    const n = d.selMoves.length;
    return n ? `${head} · 이동 ${fmtCount(n)}` : `${head} · 이동 없음`;
  }
  if (d.kind === 'mpr' && d.selKey !== null) {
    const op = mprOps(d.scene)[Number(d.selKey)];
    if (op) return `가공 ${op.index + 1} · ${op.label || op.kind}${op.enabled ? '' : ' (꺼짐)'}`;
  }
  if (p) {
    const item = p.kind === 'mesh' ? d.scene.meshes.find((m) => m.id === p.id) : p.kind === 'line' ? d.scene.lines.find((l) => l.id === p.id) : d.scene.points?.find((x) => x.id === p.id);
    return `${item?.name ?? p.id} · ${fmtPt(p.point)}`;
  }
  return '';
}

/** 고른 줄의 원문(패널 아래 띠) */
export function selectedLineText(d: NcDoc, max = 120): string {
  if (d.selLine < 0) return '';
  const t = (d.nc ? sourceLine(d.nc.source, d.selLine) : (d.mpr?.lines[d.selLine] ?? '')).trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
