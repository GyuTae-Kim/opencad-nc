/**
 * 열린 NC 문서 하나의 상태와 형식별 도움 함수(순수, DOM 없음).
 * 한 번에 문서 하나만 연다. 새 파일을 열면 문서를 통째로 바꾸고, 방언·단위를 바꿔 다시 읽으면 결과만 바꿔 끼운다.
 */
import type { MeasureResult, Pick3d, Scene3d } from 'opencad-viewer3d';
import { isPanelKind } from '../extensions';
import {
  FLAG_COMP_LEFT,
  FLAG_COMP_RIGHT,
  FLAG_COOLANT,
  FLAG_CYCLE,
  FLAG_INVERSE_TIME,
  FLAG_MACHINE_EST,
  FLAG_START_EST,
  FLAG_PER_REV,
  FLAG_TOOL_LENGTH,
  MODAL_INC,
  MODAL_PLANE,
  MODAL_POLAR,
  MODAL_XF,
  MOVE_KIND_NAMES,
  NC_DIALECT_NAMES,
  PLANE_AXES,
} from '../model';
import { sourceLine } from '../text';
import { idRange, moveEndTime, playbackAt } from '../view/playback';
import { fmtCount, fmtNum, fmtPt, formatBytes, formatMs } from './format';
import { statusMeasureHint } from './measure';
import type { MprPayload, NcJobInfo, NcKind, NcOpenOptions, NcPayload, ParseResult } from './protocol';

export type PanelTab = 'code' | 'tools' | 'info' | 'ops' | 'vars' | 'sim';

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
  /** 여러 파일을 한 작업으로 열었으면 그 파일들(이름 = 주 프로그램) — 아니면 null */
  job: NcJobInfo | null;
  /** 해석 시간(ms) */
  ms: number;
  // ── 보기 상태 ──
  /** 닫은 해석 판단 띠(종류 열쇠) — 다시 읽어도 그대로 둔다 */
  dismissedNotices: Set<string>;
  hiddenGroups: Set<string>;
  /** 뷰어 강조(항목 id) */
  highlight: string[];
  pick: Pick3d | null;
  /** 두 점 측정 결과(tangentB = 둘째 점을 원호 접선 잠금으로 찍음, trackA·trackB = 그 점을 다른 점에서 끌어온 축 위에 찍음 — 앱이 붙인다) */
  measure: (MeasureResult & { tangentB?: boolean; trackA?: boolean; trackB?: boolean }) | null;
  /** 코드 보기에서 고른 줄(-1 없음)과 덧그림으로 강조할 이동 */
  selLine: number;
  selMoves: number[];
  /** 판재 가공(MPR·PGI·XML)에서 고른 것(가공 번호 글) */
  selKey: string | null;
  /** 재생 시각(초, null = 전체 경로) */
  playSec: number | null;
  /** 한 이동씩 걸을 때 고른 이동(시간이 0인 이동도 하나씩 가도록 — 재생 시각과 맞을 때만 쓴다, 없으면 -1) */
  playMove: number;
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
    job: res.job ?? null,
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
    playMove: -1,
    panelTab: isPanelKind(res.kind) ? 'ops' : 'code',
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
  // 작업: 주 프로그램을 바꾸면 이름도 바꾼다. 다시 읽은 글에는 잇지 않은 파일이 없으므로 앞의 것을 둔다
  if (res.job) {
    d.job = { ...res.job, skipped: res.job.skipped.length ? res.job.skipped : (d.job?.skipped ?? []) };
    d.name = res.job.main;
  } else d.job = null;
  d.hiddenGroups.clear();
  d.highlight = [];
  d.pick = null;
  d.measure = null;
  d.selLine = -1;
  d.selMoves = [];
  d.selKey = null;
  d.playSec = null;
  d.playMove = -1;
  if (!panelTabs(d).some(([k]) => k === d.panelTab)) d.panelTab = panelTabs(d)[0]![0];
}

/** 지금 재생 자리(이동·그 안의 비율). 한 이동씩 걸어 고른 이동이 재생 시각과 맞으면 그것(시간 0 이동도 하나씩). 전체 경로면 null */
export function playPosition(d: Pick<NcDoc, 'nc' | 'playSec' | 'playMove'>): { move: number; frac: number } | null {
  if (!d.nc || d.playSec === null) return null;
  const tl = d.nc.timeline;
  if (d.playMove >= 0 && d.playMove < d.nc.moves.count && Math.abs(moveEndTime(tl, d.playMove) - d.playSec) < 1e-9) return { move: d.playMove, frac: 1 };
  return playbackAt(tl, d.playSec);
}

/**
 * 여러 파일 작업: 이은 글의 줄(0부터) → 그 파일(차례·이름)과 파일 안 줄 번호(1부터 — 함께 연 파일의 표지 줄은 0).
 * 파일 하나면 null. 경고·코드 줄 번호·상태를 원래 파일의 줄로 보이는 데 쓴다
 */
export function jobLineOf(job: NcJobInfo | null | undefined, line: number): { index: number; file: string; local: number } | null {
  if (!job || job.files.length < 2 || !job.starts.length || line < 0) return null;
  const st = job.starts;
  let lo = 0;
  let hi = Math.min(st.length, job.files.length) - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (st[mid]! <= line) lo = mid;
    else hi = mid - 1;
  }
  return { index: lo, file: job.files[lo]!, local: lo === 0 ? line + 1 : line - st[lo]! };
}

/** 여러 파일 작업: 파일 index 안의 줄 번호(1부터) → 이은 글의 줄(0부터). 작업이 아니면 local - 1 */
export function jobLineToGlobal(job: NcJobInfo | null | undefined, index: number, local: number): number {
  if (!job || job.files.length < 2 || !job.starts.length) return local - 1;
  const k = Math.max(0, Math.min(index, job.starts.length - 1));
  const start = job.starts[k]!;
  const next = k + 1 < job.starts.length ? job.starts[k + 1]! : Infinity;
  const line = k === 0 ? local - 1 : start + local;
  return Math.max(k === 0 ? 0 : start + 1, Math.min(line, next - 1));
}

/** 코드 줄 번호 칸의 글: 파일 하나면 줄 번호, 여러 파일 작업이면 그 파일 안 번호(표지 줄은 비움) */
export function lineNumberText(d: Pick<NcDoc, 'job'>, line: number): string {
  const j = jobLineOf(d.job, line);
  if (!j) return String(line + 1);
  return j.local > 0 ? String(j.local) : '';
}

/** "줄 N"(여러 파일 작업이면 "파일 · 줄 N" — 원래 파일의 줄) */
export function lineLabel(d: Pick<NcDoc, 'job'>, line: number): string {
  const j = jobLineOf(d.job, line);
  return j ? `${j.file} · 줄 ${j.local.toLocaleString('ko-KR')}` : `줄 ${(line + 1).toLocaleString('ko-KR')}`;
}

/** "N번 줄"(여러 파일 작업이면 "파일 · N번 줄") */
export function lineAtLabel(d: Pick<NcDoc, 'job'>, line: number): string {
  const j = jobLineOf(d.job, line);
  return j ? `${j.file} · ${j.local}번 줄` : `${line + 1}번 줄`;
}

/** 절삭 범위 글 "X 0 ~ 50 · Y -10 ~ 10 · Z -5 ~ 2 mm" */
export function cutRangeText(min: readonly number[], max: readonly number[], unit: string): string {
  return `X ${fmtNum(min[0])} ~ ${fmtNum(max[0])} · Y ${fmtNum(min[1])} ~ ${fmtNum(max[1])} · Z ${fmtNum(min[2])} ~ ${fmtNum(max[2])}${unit ? ` ${unit}` : ''}`;
}

/** 해석 판단 띠 하나: 글과 행동(다른 설정으로 다시 읽기, 또는 패널 탭 열기) */
export interface NoticeView {
  key: string;
  text: string;
  /** opts = 그 설정으로 다시 읽기, tab = 패널 탭 열기, add = 이 작업에 파일 더하기 */
  action?: { label: string; opts?: NcOpenOptions; tab?: PanelTab; add?: boolean };
}

const DIALECT_NOTICE: Record<string, string> = {
  siemens: 'Siemens Sinumerik 프로그램으로 읽었습니다(판별).',
  haas: 'Haas 프로그램으로 읽었습니다(판별) — G73·G83의 K는 최소 절입(반복은 L), G70~G72는 볼트 구멍 패턴, G110~G129는 좌표계로 봅니다.',
  'heidenhain-iso': 'Heidenhain DIN/ISO 프로그램으로 읽었습니다(판별).',
  okuma: 'Okuma OSP 프로그램으로 보입니다 — CALL·VC 변수·NLAP는 읽지 않아 경로가 모자랄 수 있습니다(G15 H 좌표계는 읽음).',
};

const LATHE_SYSTEM_NOTICE: Record<string, string> = {
  B: 'Fanuc 선반 G 코드 B 체계로 읽었습니다(판별) — G77·G78·G79는 단순 사이클, G90·G91은 절대·증분 지령입니다.',
  C: 'Fanuc 선반 G 코드 C 체계로 읽었습니다(판별) — G20·G21·G24는 단순 사이클, G70·G71은 inch·mm, G72~G78은 복합 사이클입니다.',
};

/** 문서의 해석 판단 → 띠(닫은 것은 뺀다) */
export function noticeViews(d: Pick<NcDoc, 'nc' | 'ncOptions' | 'dismissedNotices'> & Partial<Pick<NcDoc, 'job'>>): NoticeView[] {
  const out: NoticeView[] = [];
  const job = d.job;
  if (job && (job.files.length > 1 || job.skipped.length) && !d.dismissedNotices.has('job')) {
    const skipped = job.skipped.length ? ` · 잇지 않은 파일 ${job.skipped.length}개` : '';
    out.push({ key: 'job', text: `파일 ${job.files.length}개를 한 작업으로 읽었습니다 — 주 프로그램 ${job.main}${skipped}`, action: { label: '작업 파일', tab: 'info' } });
  }
  for (const n of d.nc?.notices ?? []) {
    let v: NoticeView | null = null;
    if (n.kind === 'lathe-auto') v = { key: 'lathe-auto', text: '선반 프로그램으로 보여 선반 모드(X 지름·선반 사이클·XZ 단면)로 읽었습니다.', action: { label: '밀링으로 읽기', opts: { ...d.ncOptions, lathe: false } } };
    else if (n.kind === 'integer-units')
      v = { key: 'integer-units', text: '소수점 없는 큰 좌표가 많습니다 — 최소 입력 단위(0.001 mm·0.0001 inch)로 쓴 Fanuc 프로그램일 수 있습니다.', action: { label: '최소 단위로 읽기', opts: { ...d.ncOptions, integerUnits: true } } };
    else if (n.kind === 'dialect' && n.dialect && DIALECT_NOTICE[n.dialect]) v = { key: `dialect-${n.dialect}`, text: DIALECT_NOTICE[n.dialect]!, action: { label: '방언 바꾸기', tab: 'info' } };
    else if (n.kind === 'lathe-system' && n.system) {
      const text =
        n.system === 'A'
          ? `Fanuc 선반 G 코드 B·C 체계일 수 있습니다(${(n.hints ?? []).join(' · ')}) — A 체계(G90·G92·G94 단순 사이클)로 읽었습니다.`
          : LATHE_SYSTEM_NOTICE[n.system]!;
      v = { key: `lathe-system-${n.system}`, text, action: { label: '체계 바꾸기', tab: 'info' } };
    }
    else if (n.kind === 'missing-program' && n.programs?.length) {
      const names = n.programs.length > 6 ? `${n.programs.slice(0, 6).join(', ')}, …` : n.programs.join(', ');
      v = { key: 'missing-program', text: `다른 파일의 프로그램 ${names}을(를) 찾지 못했습니다 — 그 파일을 더하면 이어서 그립니다.`, action: { label: '파일 더하기', add: true } };
    }
    if (v && !d.dismissedNotices.has(v.key)) out.push(v);
  }
  return out;
}

/** 문서 종류별 패널 탭 */
export function panelTabs(d: Pick<NcDoc, 'kind'>): [PanelTab, string][] {
  if (isPanelKind(d.kind))
    return [
      ['ops', '가공'],
      ['vars', '변수'],
      ['code', '코드'],
      ['info', '정보'],
      ['sim', '깎기'],
    ];
  return [
    ['code', '코드'],
    ['tools', '공구'],
    ['info', '정보'],
    ['sim', '깎기'],
  ];
}

/** 장면 단위 → 글 */
export function unitLabel(u: Scene3d['units']): string {
  return u === 'mm' ? 'mm' : u === 'inch' ? 'in' : u === 'm' ? 'm' : '';
}

/** 형식 설명(상태 막대·정보) */
export function docLabel(d: Pick<NcDoc, 'kind' | 'nc' | 'scene'>): string {
  if (d.kind === 'heidenhain') return 'Heidenhain 평문';
  if (d.kind === 'pgi') return 'WangShi PGI';
  if (d.kind === 'xml') return 'WangShi XML';
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

/** 판재 가공 목록(scene.meta.operations — MPR·PGI·XML) */
export interface MprOpRow {
  index: number;
  kind: string;
  label: string;
  line?: number;
  enabled: boolean;
  tool?: number;
  diameter?: number;
  depth?: number;
  /** 엣지 밴딩 띠 두께 */
  thickness?: number;
  holeCount?: number;
}

/** 판재 가공 종류 이름(가공 탭·깎기 탭의 가공 하나씩 따라가기) */
export const MPR_KIND: Record<string, string> = {
  drillV: '수직 구멍',
  drillH: '수평 구멍',
  contour: '윤곽',
  groove: '홈',
  pocket: '포켓',
  edge: '엣지 밴딩',
  comment: '주석',
  other: '기타',
};

export function mprOps(scene: Scene3d): MprOpRow[] {
  const ops = (scene.meta as { operations?: unknown } | undefined)?.operations;
  return Array.isArray(ops) ? (ops as MprOpRow[]) : [];
}

/** 판재 가공 변수(scene.meta.variables) */
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

/** 줄 i를 품은 판재 가공(시작 줄이 i 이하인 마지막 가공). 없으면 -1 */
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
  else if (isPanelKind(d.kind)) parts.push(`가공 ${fmtCount(mprOps(d.scene).length)}`);
  if (c.segments) parts.push(`선분 ${fmtCount(c.segments)}`);
  parts.push(`읽기 ${formatMs(d.ms)}`);
  return parts;
}

const KIND_LABEL: Record<string, string> = { rapid: '급속', feed: '직선 이송', arc: '원호 이송', drill: '드릴' };

/** 공구 이름표: T번호(이름만 있는 공구는 이름) */
export function toolLabel(nc: Partial<Pick<NcPayload, 'tools'>>, t: number): string {
  if (t < 0) return '';
  if (t >= 100000) return nc.tools?.find((x) => x.number === t)?.name ?? `T${t}`;
  return `T${t}`;
}

/** 공구 이름 → 재생 표시 모양: 볼 → 'ball', 드릴·센터·모따기·탭 → 'cone', 엔드밀·페이스밀 → 'cylinder' (모르면 null) */
export function toolShape(name: string | undefined): 'ball' | 'cone' | 'cylinder' | null {
  if (!name) return null;
  if (/BALL|\bBN\b|KUGEL|볼/i.test(name)) return 'ball';
  if (/DRILL|SPOT|CENT(?:ER|RE)|CHAMF|C'?SINK|COUNTERSINK|\bTAP|BOHR|ZENTRIER|FASE|SENK|REAM|드릴|센터|모따기|탭|리머/i.test(name)) return 'cone';
  if (/MILL|ENDMILL|\bEM\b|FLAT|FACE|SHELL|SLOT|BULL|FR(?:AE|A|Ä)S|엔드밀|평|페이스/i.test(name)) return 'cylinder';
  return null;
}

/**
 * 재생 중 공구 표시: 모양은 공구 이름(모르면 원뿔), 실제 크기(realSize)면 반지름 = 지름/2(지름을 모르면 화면 크기)
 */
export function toolMarker(nc: Pick<NcPayload, 'moves' | 'tools'>, move: number, realSize: boolean): { kind: 'ball' | 'cone' | 'cylinder'; radius?: number } {
  const t = move >= 0 && move < nc.moves.count ? nc.moves.tool[move]! : -1;
  const tool = t >= 0 ? nc.tools.find((x) => x.number === t) : undefined;
  const kind = toolShape(tool?.name) ?? 'cone';
  const d = tool?.diameter;
  return realSize && d && d > 0 ? { kind, radius: d / 2 } : { kind };
}

/** 이동 하나의 설명("직선 이송 · T1 · F1200") */
export function moveSummary(nc: Pick<NcPayload, 'moves'> & Partial<Pick<NcPayload, 'tools'>>, i: number): string {
  if (i < 0 || i >= nc.moves.count) return '';
  const kind = MOVE_KIND_NAMES[nc.moves.kind[i]!] ?? 'feed';
  const tool = nc.moves.tool[i]!;
  const feed = nc.moves.feed[i]!;
  return `${KIND_LABEL[kind] ?? kind}${tool >= 0 ? ` · ${toolLabel(nc, tool)}` : ''}${kind !== 'rapid' && feed > 0 ? ` · F${fmtNum(feed, 1)}` : ''}`;
}

/** 작업 좌표계 번호 → 이름 */
export function wcsLabel(idx: number, dialect: string): string {
  if (idx === 255) return '기계 좌표(G53)';
  if (idx <= 5) return `G${54 + idx}`;
  return dialect === 'siemens' ? `G${505 + idx - 6}` : `G54.1 P${idx - 5}`;
}

/**
 * 현재 블록(이동 i) 상태 한 덩어리: 끝점 X·Y·Z, 이송·주축·냉각, 공구·H·D, 모달 G(좌표계·G90/G91·평면·보정·이송 꼴·극좌표·변환),
 * 고정 사이클, 원호(중심·반지름·중심각). 줄마다 하나씩(패널 아래 띠·재생 띠)
 */
export function moveState(nc: NcPayload, i: number, units: string): { pos: string; motion: string; modal: string; arc: string } | null {
  const m = nc.moves;
  if (i < 0 || i >= m.count) return null;
  const k = (i + 1) * 3;
  const u = units ? ` ${units}` : '';
  const pos = `X ${fmtNum(m.points[k]!)} · Y ${fmtNum(m.points[k + 1]!)} · Z ${fmtNum(m.points[k + 2]!)}${u}`;
  const fl = m.flags[i]!;
  const kind = MOVE_KIND_NAMES[m.kind[i]!] ?? 'feed';
  const sp = m.spindle[i]!;
  const parts: string[] = [KIND_LABEL[kind] ?? kind];
  if (kind !== 'rapid' && m.feed[i]! > 0) parts.push(`F${fmtNum(m.feed[i]!, 1)}${fl & FLAG_INVERSE_TIME ? '(G93)' : fl & FLAG_PER_REV ? '(G95)' : ''}`);
  parts.push(sp > 0 ? `S${Math.round(sp)} M3` : sp < 0 ? `S${Math.round(-sp)} M4` : '주축 정지');
  if (fl & FLAG_COOLANT) parts.push('냉각');
  const t = m.tool[i]!;
  const h = m.hNum[i]!;
  const dd = m.dNum[i]!;
  const tl = [t >= 0 ? toolLabel(nc, t) : '공구 없음', fl & FLAG_TOOL_LENGTH ? `G43${h >= 0 ? ` H${h}` : ''}` : '', fl & FLAG_COMP_LEFT ? `G41${dd >= 0 ? ` D${dd}` : ''}` : fl & FLAG_COMP_RIGHT ? `G42${dd >= 0 ? ` D${dd}` : ''}` : ''].filter(Boolean);
  const md = m.modal[i]!;
  const g: string[] = [wcsLabel(m.wcs[i]!, nc.dialect), md & MODAL_INC ? 'G91' : 'G90', ['G17', 'G18', 'G19'][md & MODAL_PLANE] ?? 'G17'];
  if (md & MODAL_POLAR) g.push('G16');
  if (md & MODAL_XF) g.push('좌표 변환');
  const cyc = md >> 8;
  if (fl & FLAG_CYCLE) g.push(cyc ? `G${cyc} 사이클` : '사이클');
  if (fl & FLAG_MACHINE_EST) g.push('기계 좌표 쪽(추정)');
  else if (fl & FLAG_START_EST) g.push('출발 높이 추정(기계 좌표 쪽)');
  let arc = '';
  const ai = m.arc[i]!;
  if (kind === 'arc' && ai >= 0) {
    const a = nc.arcs;
    const plane = a.plane[ai]!;
    const [a0, a1] = PLANE_AXES[plane] ?? PLANE_AXES[0]!;
    const c = [a.center[ai * 3]!, a.center[ai * 3 + 1]!, a.center[ai * 3 + 2]!];
    const r = Math.hypot(m.points[i * 3 + a0]! - c[a0]!, m.points[i * 3 + a1]! - c[a1]!);
    const sw = (a.sweep[ai]! * 180) / Math.PI;
    arc = `중심 ${fmtPt(c)} · R ${fmtNum(r)} · ${sw < 0 ? '시계' : '반시계'} ${fmtNum(Math.abs(sw), 1)}°`;
  }
  return { pos, motion: parts.join(' · '), modal: [...tl, ...g].join(' · '), arc };
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
    const head = lineLabel(d, d.selLine);
    if (p && (p.kind === 'line' || p.kind === 'point') && p.id.startsWith('nc-') && p.index >= 0 && p.index < d.nc.moves.count) return `${head} · ${moveSummary(d.nc, p.index)} · ${fmtPt(p.point)}`;
    const n = d.selMoves.length;
    return n ? `${head} · 이동 ${fmtCount(n)}` : `${head} · 이동 없음`;
  }
  if (isPanelKind(d.kind) && d.selKey !== null) {
    const op = mprOps(d.scene)[Number(d.selKey)];
    // 조각마다 따로 번역되게 " · "로 잇는다(가공 이름이 앱이 지은 한국어여도 — 예: PGI "수직 드릴 Ø5 × 13" — 그 언어로)
    if (op) return `가공 ${op.index + 1} · ${op.label || op.kind}${op.enabled ? '' : ' · 꺼짐'}`;
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
