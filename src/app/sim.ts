/**
 * 소재 깎기 시뮬레이션 화면(켤 때 나눠 받는다 — 첫 화면 JS에 넣지 않는다).
 *
 * - 계산은 웹 워커(src/worker/sim.worker.ts)가 한다. 재생 막대의 자리(이동·비율)를 목표로 보내면 워커가 거기까지 깎고 바뀐 조각 그물만 돌려준다.
 * - 장면은 소재가 처음 다 모였을 때(켜기·다시 계산·공구 경로 보이기를 바꿀 때) 한 번만 문서 장면 + 소재 그물로 만들어 카메라를 지킨 채 올린다
 *   (측정 점을 찍었거나 정밀 조준 중이면 기다린다 — 장면을 바꾸면 측정이 지워진다).
 *   그 뒤 워커가 보낸 조각·옆면·바닥은 코어 0.11.0 setMesh로 그 그물만 바꾼다: 공구 경로 버퍼·고르기 BVH·측정 점·강조·숨김·단면은 그대로다.
 * - 패널 "깎기" 탭: 켜고 끄기, 공구 경로 함께 보이기, 계산 상태, 급속이 소재를 지난 줄, 소재 상자, 해상도·색, 공구 표.
 * - 3축(공구 방향 Z) 높이 지도 근사다. 선반·회전축·기울인 평면은 그리지 않고 까닭을 보인다(src/sim/setup.ts).
 * - 판재 파일(MPR·PGI·XML)은 해석 워커가 만든 재료(MprPayload.sim)로 판 윗면 가공만 깎는다(src/sim/panel.ts). 재생 막대가 없어 기본은 끝까지,
 *   시뮬레이션하지 않은 가공(옆면·아랫면·엣지 밴딩 등)은 까닭별 목록으로 보인다. 판 그물(mpr-board)은 소재가 보이면 뺀다.
 * - 판재 가공 하나씩 따라가기(13차): 깎기 탭의 처음·이전 가공·다음 가공·끝까지·막대로 가공 목록 차례대로 k개까지만 깎는다
 *   (G-code 재생과 같은 길 — 목표 자리를 워커에 보내고 바뀐 조각만 setMesh). 지금 가공(k번째)은 가공 고르기로 강조하고,
 *   패널을 닫으면 3D 보기 아래에 같은 단추의 띠(재생 띠 자리)를 보인다.
 */
import type { Mesh3d, Scene3d, Viewer3d } from 'opencad-viewer3d';
import { MPR_KIND, lineAtLabel, mprOps, playPosition, sceneFeatures, unitLabel, type NcDoc } from './doc';
import { h, toast } from './dom';
import { fmtNum } from './format';
import { icon, type IconName } from './icons';
import { sourceLine, sourceText } from '../text';
import { gridFor, type GridSpec } from '../sim/grid';
import { STOCK_RGB, fanIndices, gridIndices, panelWallSlope, type SimColorMode, type TileArrays } from '../sim/mesh';
import type { SimEvent, SimMoves, SimPosition } from '../sim/engine';
import {
  PANEL_SKIP_TEXT,
  panelOpSteps,
  panelSimMoves,
  panelStepTarget,
  panelStock,
  type PanelOpStep,
  type PanelSimMoves,
  type PanelSimSkip,
  type PanelSimSource,
  type PanelSimTool,
  type PanelSkipCode,
} from '../sim/panel';
import type { SimRequest, SimResponse, SimStats, SimUpdate } from '../sim/protocol';
import {
  SIM_BLOCK_TEXT,
  SIM_RESOLUTIONS,
  autoLongCells,
  defaultStock,
  hasCutMoves,
  longCellsFor,
  panelBlocker,
  panelToolRows,
  rapidEventRows,
  simBlocker,
  simToolRows,
  sweepArea,
  usedTools,
  type SimBlock,
  type SimBox,
  type SimResolution,
} from '../sim/setup';
import { SIM_TOOL_KINDS, type SimTool, type SimToolKind, type SimToolRow, type SimToolTable } from '../sim/tool';

/** 앱이 시뮬레이션 화면에 주는 것 */
export interface SimHost {
  readonly viewer: Viewer3d | null;
  readonly doc: NcDoc | null;
  /** 3D 보기 요소(계산 중 표시를 붙인다) */
  readonly viewLayer: HTMLElement;
  /** 장면을 다시 올린다(카메라 지킴) */
  refreshScene(): void;
  /** 측정 점을 찍었거나 정밀 조준 중이면 true(장면 전체는 바꾸지 않는다 — 그물 하나 바꾸기는 측정을 지키므로 기다리지 않는다) */
  holdScene(): boolean;
  selectLine(line: number, moves?: number[], reveal?: boolean): void;
  /** 판재 가공 고르기(시뮬레이션하지 않은 가공 목록에서, 가공 하나씩 따라가기의 지금 가공 — 음수면 고른 것 지우기) */
  selectMprOp(i: number, reveal?: boolean): void;
  /** 패널이 열려 있는지(닫혔으면 가공 하나씩 따라가기 띠를 3D 보기에) */
  panelOpen?(): boolean;
  /** 측정 중인지(측정 띠와 자리가 겹쳐 따라가기 띠를 숨긴다) */
  measuring?(): boolean;
  /** 패널을 다시 그린다(깎기 탭을 보고 있으면) */
  refreshPanel(): void;
  /** 도구 막대 단추 상태를 맞춘다 */
  renderToolbar(): void;
}

/** 자동 확인용 상태 */
export interface SimState {
  on: boolean;
  paths: boolean;
  /** 시뮬레이션하지 않는 까닭(되면 null) */
  blocked: string | null;
  computing: boolean;
  /** 계산한 자리(이동·비율) */
  at: SimPosition | null;
  target: SimPosition | null;
  /** 격자 마디 수(가로·세로) */
  grid: [number, number] | null;
  /** 소재 그물이 장면에 올라갔는지 */
  shown: boolean;
  /** 급속이 소재를 지난 이동 수 */
  rapidEvents: number;
  stats: SimStats | null;
  /** 판재 파일: 시뮬레이션하는 가공 수와 하지 않는 가공(까닭별 수). G-code·Heidenhain이면 null */
  panel: { items: number; skipped: Partial<Record<PanelSkipCode, number>>; disabled: number } | null;
  /** 이번 계산에서 뷰어에 올린 횟수: 장면 전체(setScene)와 그물 하나 바꾸기(setMesh) */
  uploads: { scenes: number; meshes: number };
  /** 판재 가공 하나씩 따라가기: 깎은 가공 수·걸음 수·지금 가공 번호(깎기 전이면 null)·띠가 보이는지. 끝까지(기본)면 null */
  step: { at: number; count: number; op: number | null; strip: boolean } | null;
}

/** 가공 하나씩 따라가기 단추·막대(깎기 탭과 3D 보기 띠가 같은 꼴) */
interface StepEls {
  el: HTMLElement;
  count: HTMLElement;
  name: HTMLElement;
  first: HTMLButtonElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  all: HTMLButtonElement;
  range: HTMLInputElement;
}

const PREF_KEY = 'opencad-nc.sim';
const TOOLS_KEY = 'opencad-nc.sim.tools';
/** 소재 그물 이름·묶음 */
export const SIM_GROUP = '깎인 소재';
const KIND_LABEL: Record<SimToolKind, string> = { flat: '평 엔드밀', ball: '볼 엔드밀', bull: '불 노즈', drill: '드릴·V 날' };
const FROM_LABEL = { file: '파일 값', user: '사용자 값', default: '기본값' } as const;

interface Prefs {
  res: SimResolution;
  color: SimColorMode;
  paths: boolean;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return fallback;
}

function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

/** 판재 공구 이름: 구멍은 지름, 경로는 공구 번호(MPR TNO)나 공구 폭 */
export function panelToolLabel(t: PanelSimTool | undefined): string {
  if (!t) return '—';
  const d = t.diameter !== undefined ? fmtNum(t.diameter) : '';
  if (t.type === 'drill') return `구멍 Ø${d}`;
  if (t.tno !== undefined) return d ? `T${t.tno} Ø${d}` : `T${t.tno}`;
  return d ? `경로 Ø${d}` : '경로(지름 모름)';
}

/** 시뮬레이션하지 않은 가공 → 까닭별 수 */
function skipCounts(list: readonly PanelSimSkip[]): Partial<Record<PanelSkipCode, number>> {
  const out: Partial<Record<PanelSkipCode, number>> = {};
  for (const s of list) out[s.code] = (out[s.code] ?? 0) + 1;
  return out;
}

/** 묶음들(그물·선분·점)의 배열 바이트 합(GPU에 올리는 양 어림 — 함께 쓰는 색인도 묶음마다 센다) */
export function sumBytes(items: readonly object[]): number {
  let n = 0;
  for (const it of items) for (const v of Object.values(it)) if (ArrayBuffer.isView(v)) n += v.byteLength;
  return n;
}

/**
 * 바뀐 소재 그물을 하나씩 바꾸기(setMesh)보다 장면 전체를 다시 올리기(setScene)가 싼지. 같은 바이트를 올릴 때 기존 버퍼를 채우는 setMesh가
 * 새 버퍼를 만드는 setScene보다 느렸다(헤드리스 Chrome Metal, 944² 격자 조각 225개 모두: setMesh 12~16 ms, setScene 8~9 ms) — 바뀐 양이
 * 장면 전체의 반을 넘으면 장면 전체로
 */
export function fullSceneCheaper(changed: number, rest: number, sim: number): boolean {
  return changed * 2 > rest + sim;
}

/** 두 격자가 같은지(조각 나누기·그물 원점이 같다) */
function sameGrid(a: GridSpec, b: GridSpec): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.nx === b.nx && a.ny === b.ny && a.dx === b.dx && a.dy === b.dy && a.top === b.top && a.bottom === b.bottom;
}

function isPhone(): boolean {
  try {
    return window.matchMedia('(max-width: 759.98px), (pointer: coarse) and (max-height: 499.98px)').matches;
  } catch {
    return window.innerWidth < 760;
  }
}

/**
 * 문서 장면 + 소재 그물(공구 경로를 빼면 선분·점 묶음 없이 — 판재면 가공 그물(구멍 기둥·홈·포켓 상자 mpr-op-*)도 뺀다).
 * 소재가 있으면 공작물 상자 그물(nc-stock)·판 그물(mpr-board)은 뺀다
 */
export function composeSimScene(base: Scene3d, sim: Mesh3d[], paths: boolean, box: SimBox | null): Scene3d {
  const meshes = [...base.meshes.filter((m) => m.id !== 'nc-stock' && m.id !== 'mpr-board' && (paths || !m.id.startsWith('mpr-op-'))), ...sim];
  let bounds = base.bounds;
  if (box) {
    const b = bounds ?? { min: [...box.min] as [number, number, number], max: [...box.max] as [number, number, number] };
    bounds = { min: [Math.min(b.min[0], box.min[0]), Math.min(b.min[1], box.min[1]), Math.min(b.min[2], box.min[2])], max: [Math.max(b.max[0], box.max[0]), Math.max(b.max[1], box.max[1]), Math.max(b.max[2], box.max[2])] };
  }
  return { ...base, meshes, lines: paths ? base.lines : [], points: paths ? (base.points ?? []) : [], ...(bounds ? { bounds } : {}) };
}

export class SimView {
  on = false;
  private prefs: Prefs = readJson<Prefs>(PREF_KEY, { res: 'auto', color: 'depth', paths: true });
  private userTools: SimToolTable = readJson<SimToolTable>(TOOLS_KEY, {});
  // ── 문서마다 ──
  private key: object | null = null;
  private block: SimBlock | null = null;
  /** 3축 확인 결과(문서 자료마다 한 번 — 큰 파일은 글 훑기에 시간이 든다) */
  private readonly blocks = new WeakMap<object, SimBlock | null>();
  private rows: SimToolRow[] = [];
  private auto: SimBox | null = null;
  private userStock: SimBox | null = null;
  private area = 0;
  /** 판재 파일: 재료와 지금 공구로 만든 이동(공구·소재를 바꾸면 다시 만든다) */
  private panel: PanelSimSource | null = null;
  private panelMoves: PanelSimMoves | null = null;
  /** 판재 가공 하나씩 따라가기: 깎은 가공 수(null = 끝까지 — 기본)와 가공 차례(판재 이동마다 다시) */
  private step: number | null = null;
  private steps: { of: PanelSimMoves; list: PanelOpStep[] } | null = null;
  private stepTab: StepEls | null = null;
  private stepStrip: StepEls | null = null;
  // ── 계산 ──
  private worker: Worker | null = null;
  private gen = 0;
  private spec: GridSpec | null = null;
  private origin: [number, number, number] = [0, 0, 0];
  private tiles: (Mesh3d | null)[] = [];
  private tilesX = 0;
  private walls: Mesh3d | null = null;
  private bottom: Mesh3d | null = null;
  private sent: SimPosition | null = null;
  private last: SimUpdate | null = null;
  private error: string | null = null;
  private readonly indexCache = new Map<string, Uint32Array>();
  // ── 장면 올리기 ──
  private composed: Scene3d | null = null;
  private composedFor: object | null = null;
  private dirtyScene = false;
  private shown = false;
  private refreshTimer = 0;
  /** 소재 그물이 든 장면이 뷰어에 올라가 있으면 그 장면 객체(setMesh마다 코어가 새 객체로 바꾼다 — 다르면 누가 장면을 바꾼 것) */
  private live: Scene3d | null = null;
  /** 장면에서 소재 그물 밖(공구 경로·가공 그림 등)의 배열 바이트 */
  private restBytes = 0;
  private uploads = { scenes: 0, meshes: 0 };
  // ── 화면 ──
  private chip: HTMLDivElement | null = null;
  private statusEl: HTMLElement | null = null;
  private eventsKey = '';

  constructor(private readonly host: SimHost) {}

  get paths(): boolean {
    return this.prefs.paths;
  }

  // ───────────────────────── 앱이 부르는 것 ─────────────────────────

  /** 켜고 끄기 */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const d = this.host.doc;
    if (on && d) {
      this.prepare(d);
      if (this.block) toast(`시뮬레이션하지 않음 — ${SIM_BLOCK_TEXT[this.block.code]}`, 'info', 5000);
      this.start();
    } else {
      this.step = null;
      this.stop();
    }
    this.host.renderToolbar();
    this.host.refreshPanel();
    this.refreshStrip();
  }

  /** 새 문서·다시 읽은 결과: 문서마다 값을 새로 정하고 켜져 있으면 다시 계산 */
  docChanged(d: NcDoc | null): void {
    this.stop(false);
    this.key = null;
    this.userStock = null;
    this.panel = null;
    this.panelMoves = null;
    this.step = null;
    if (d && this.on) {
      this.prepare(d);
      this.start();
    }
    this.refreshStrip();
  }

  /** 재생 자리(전체 경로면 프로그램 끝)를 워커에 알린다 */
  follow(d: NcDoc): void {
    if (!this.on || !this.worker || !d.nc || this.key !== d.nc) return;
    const t = this.targetOf(d);
    if (this.sent && this.sent.move === t.move && this.sent.frac === t.frac) return;
    this.sent = t;
    this.post({ type: 'target', gen: this.gen, target: t });
    this.updateStatus();
  }

  /** 뷰어에 올릴 장면(꺼져 있거나 아직이면 문서 장면 그대로). 앱은 이것을 setScene으로 올린다 */
  sceneFor(d: NcDoc): Scene3d {
    const key = d.nc ?? d.mpr;
    if (!this.on || !key || this.key !== key || !this.ready()) {
      this.shown = false;
      this.live = null;
      return d.scene;
    }
    if (!this.composed || this.dirtyScene || this.composedFor !== d.scene) {
      const meshes = [...(this.tiles as Mesh3d[]), this.walls!, this.bottom!];
      this.composed = composeSimScene(d.scene, meshes, this.prefs.paths, this.stockBox());
      this.composedFor = d.scene;
      this.dirtyScene = false;
      this.restBytes = sumBytes([...this.composed.meshes.filter((m) => !m.id.startsWith('sim-')), ...this.composed.lines, ...(this.composed.points ?? [])]);
    }
    this.shown = true;
    this.live = this.composed;
    this.uploads.scenes++;
    return this.composed;
  }

  state(): SimState {
    const u = this.last;
    return {
      on: this.on,
      paths: this.prefs.paths,
      blocked: this.block ? SIM_BLOCK_TEXT[this.block.code] : null,
      computing: this.computing(),
      at: u ? { ...u.at } : null,
      target: this.sent ? { ...this.sent } : null,
      grid: this.spec ? [this.spec.nx, this.spec.ny] : null,
      shown: this.shown,
      rapidEvents: u?.events.length ?? 0,
      stats: u ? { ...u.stats } : null,
      panel: this.panel ? { items: this.panel.items.length, skipped: skipCounts(this.panel.skipped), disabled: this.panel.disabled } : null,
      uploads: { ...this.uploads },
      step: this.stepState(),
    };
  }

  /** 자동 확인·설정 바꾸기(step = 판재 가공 하나씩 따라가기의 깎은 가공 수, null = 끝까지) */
  setOptions(o: Partial<{ paths: boolean; color: SimColorMode; res: SimResolution; stock: SimBox | null; step: number | null }>): void {
    if (o.step !== undefined) this.setStep(o.step);
    let restart = false;
    if (o.paths !== undefined && o.paths !== this.prefs.paths) {
      this.prefs.paths = o.paths;
      this.dirtyScene = true;
      this.scheduleRefresh(true);
    }
    if (o.color && o.color !== this.prefs.color) {
      this.prefs.color = o.color;
      if (this.worker) this.post({ type: 'mode', gen: this.gen, mode: o.color });
    }
    if (o.res !== undefined && o.res !== this.prefs.res) {
      this.prefs.res = o.res;
      restart = true;
    }
    if (o.stock !== undefined) {
      this.userStock = o.stock;
      // 계산량 어림은 소재 윗면에 따라, 판재 이동의 안전 높이·판 밖 영역은 소재 상자에 따라 달라진다
      this.area = 0;
      this.panelMoves = null;
      restart = true;
    }
    writeJson(PREF_KEY, this.prefs);
    if (restart && this.on) this.start();
    this.host.refreshPanel();
  }

  // ───────────────────────── 준비·계산 ─────────────────────────

  /** 문서마다 한 번: 3축 확인, 공구 표, 소재 기본값 */
  private prepare(d: NcDoc): void {
    const nc = d.nc;
    if (!nc) {
      this.preparePanel(d);
      return;
    }
    if (this.key === nc) return;
    this.key = nc;
    this.panel = null;
    this.panelMoves = null;
    const f = sceneFeatures(d.scene);
    const m = nc.moves;
    let block = this.blocks.get(nc);
    if (block === undefined) this.blocks.set(nc, (block = simBlocker({ kind: nc.kind, lathe: f.lathe, rotaryAxes: f.rotaryAxes, text: sourceText(nc.source), hasCut: hasCutMoves(m) })));
    this.block = block;
    this.rows = simToolRows({ tools: nc.tools, units: nc.units, used: usedTools(m.tool, m.count), lineAt: (i) => sourceLine(nc.source, i), lineCount: nc.source.lineCount }, this.userTools);
    const maxR = this.rows.reduce((r, x) => Math.max(r, x.tool.diameter / 2), 0);
    this.auto = defaultStock({ stock: nc.stock ?? null, cutBounds: nc.cutBounds ?? null, units: nc.units, moves: m }, maxR);
    this.area = 0;
  }

  /** 판재 파일: 재료 확인, 공구 표, 소재 기본값(판 크기) */
  private preparePanel(d: NcDoc): void {
    const mpr = d.mpr;
    if (!mpr) {
      this.key = null;
      this.panel = null;
      this.panelMoves = null;
      this.block = { code: 'panel', line: -1 };
      return;
    }
    if (this.key === mpr) return;
    this.key = mpr;
    const src = mpr.sim ?? null;
    this.panel = src;
    this.panelMoves = null;
    this.block = panelBlocker(src);
    this.rows = src ? panelToolRows(src, this.userTools) : [];
    this.auto = src ? panelStock(src, (t) => (this.rows[t]?.tool.diameter ?? 0) / 2) : null;
    this.area = 0;
  }

  private stockBox(): SimBox | null {
    return this.userStock ?? this.auto;
  }

  /** 공구 번호의 값(표에 없으면 기본 평 엔드밀) */
  private toolOf(n: number): SimTool {
    const units = this.host.doc?.nc?.units ?? this.panel?.units;
    return this.rows.find((r) => r.number === n)?.tool ?? { kind: 'flat', diameter: units === 'inch' ? 0.25 : 6, corner: 0, angle: 118 };
  }

  /** 판재 이동(공구 반지름·소재 상자로 만든다 — 바뀌면 다시) */
  private panelMovesFor(box: SimBox): PanelSimMoves | null {
    if (!this.panel) return null;
    if (!this.panelMoves) this.panelMoves = panelSimMoves(this.panel, (t) => this.toolOf(t).diameter / 2, box);
    return this.panelMoves;
  }

  /** 엔진에 줄 이동(G-code·Heidenhain은 해석 자료 그대로, 판재는 만든 이동) */
  private simMoves(d: NcDoc, box: SimBox): SimMoves | null {
    const nc = d.nc;
    if (nc) {
      const m = nc.moves;
      return { count: m.count, kind: m.kind, points: m.points, tool: m.tool, flags: m.flags, arc: m.arc, arcCenter: nc.arcs.center, arcPlane: nc.arcs.plane, arcSweep: nc.arcs.sweep };
    }
    return this.panelMovesFor(box);
  }

  /** 이동 수(재생 막대 끝) */
  private moveCount(d: NcDoc): number {
    return d.nc?.moves.count ?? this.panelMoves?.count ?? 0;
  }

  /** 지금 설정으로 긴 변 칸 수 */
  private longCells(d: NcDoc, box: SimBox): number {
    const phone = isPhone();
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const base = longCellsFor(this.prefs.res, phone, mem);
    if (this.prefs.res !== 'auto') return base;
    if (!this.area) {
      if (d.nc) {
        const m = d.nc.moves;
        const radius = new Map(this.rows.map((r) => [r.number, r.tool.diameter / 2]));
        this.area = sweepArea(m, (i) => radius.get(m.tool[i]!) ?? 3, box.max[2]);
      } else this.area = this.panelMovesFor(box)?.area ?? 0;
    }
    return autoLongCells(base, Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]), this.area, phone);
  }

  private start(): void {
    const d = this.host.doc;
    // 같은 격자로 다시 계산하면(공구·같은 소재) 조각 id·크기가 같으니 올라가 있는 소재 장면에서 그물만 바꾼다
    const prev = { live: this.live, spec: this.spec };
    this.stop(false);
    this.error = null;
    if (!d || (!d.nc && !this.panel) || this.block) return;
    const box = this.stockBox();
    if (!box || !(box.max[0] > box.min[0] && box.max[1] > box.min[1] && box.max[2] > box.min[2])) {
      this.error = '소재 상자가 올바르지 않습니다(최대가 최소보다 커야 합니다).';
      this.host.refreshPanel();
      return;
    }
    const spec = gridFor(box, this.longCells(d, box));
    this.spec = spec;
    if (prev.live && prev.spec && sameGrid(prev.spec, spec)) this.live = prev.live;
    this.origin = [spec.x0 + ((spec.nx - 1) * spec.dx) / 2, spec.y0 + ((spec.ny - 1) * spec.dy) / 2, spec.top];
    this.tilesX = Math.ceil((spec.nx - 1) / 64);
    this.tiles = new Array(this.tilesX * Math.ceil((spec.ny - 1) / 64)).fill(null);
    this.uploads = { scenes: 0, meshes: 0 };
    this.gen++;
    let w = this.worker;
    if (!w) {
      try {
        w = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module', name: 'opencad-nc-sim' });
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        return;
      }
      w.onmessage = (ev: MessageEvent<SimResponse>) => this.onMessage(ev.data);
      w.onerror = (ev: ErrorEvent) => {
        ev.preventDefault();
        this.fail(ev.message || '워커가 멈췄습니다(메모리가 모자랄 수 있습니다)');
      };
      this.worker = w;
    }
    const moves = this.simMoves(d, box);
    if (!moves) return;
    const used = new Set(this.rows.map((r) => r.number));
    const tools = [...used].map((n) => ({ number: n, tool: this.toolOf(n) }));
    const target = this.targetOf(d);
    this.sent = target;
    this.post({
      type: 'init',
      gen: this.gen,
      moves,
      grid: spec,
      tools,
      // 판재: 평 끝 공구뿐이면 기울어진 면이 없어 문턱 0(칸이 굵어도 얕은 구멍·홈의 벽이 날카롭게)
      ...(this.panel ? { wallSlope: panelWallSlope(tools.map((t) => t.tool)) } : {}),
      defaultTool: this.toolOf(-1),
      mode: this.prefs.color,
      rapidTol: (d.nc?.units ?? this.panel?.units) === 'inch' ? 0.0005 : 0.01,
      checkpointBytes: isPhone() ? 24 * 1048576 : 96 * 1048576,
      target,
    });
    this.updateStatus();
  }

  /** 계산을 멈추고 그물을 버린다(장면에서 빼려면 refresh) */
  private stop(refresh = true): void {
    this.gen++;
    this.worker?.terminate();
    this.worker = null;
    this.tiles = [];
    this.walls = null;
    this.bottom = null;
    this.spec = null;
    this.last = null;
    this.sent = null;
    this.composed = null;
    this.live = null;
    this.eventsKey = '';
    this.updateChip();
    if (refresh && this.shown) this.scheduleRefresh(true);
  }

  private fail(message: string): void {
    this.error = `시뮬레이션을 계산하지 못했습니다: ${message}`;
    this.stop();
    this.host.refreshPanel();
  }

  private post(msg: SimRequest): void {
    try {
      this.worker?.postMessage(msg);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** 재생 자리(판재는 가공 하나씩 따라가기의 자리, 아니면 끝) */
  private targetOf(d: NcDoc): SimPosition {
    const count = this.moveCount(d);
    if (!d.nc) {
      const k = this.stepAt();
      return k === null ? { move: count, frac: 0 } : panelStepTarget(this.opSteps(), k, count);
    }
    const p = d.playSec === null ? null : playPosition(d);
    return p && p.move >= 0 ? { move: p.move, frac: p.frac } : { move: count, frac: 0 };
  }

  private ready(): boolean {
    return !!this.walls && !!this.bottom && this.tiles.length > 0 && this.tiles.every((t) => !!t);
  }

  private computing(): boolean {
    return this.on && !!this.worker && (!this.last || !this.last.reached || !this.sent || this.last.target.move !== this.sent.move || this.last.target.frac !== this.sent.frac);
  }

  /** 조각 삼각형 번호(같은 크기 조각끼리 한 배열을 함께 쓴다 — 뷰어도 GPU에 한 번만 올린다) */
  private indices(cols: number, rows: number, flat: boolean): Uint32Array {
    const k = `${flat ? 'f' : 'g'}${cols}x${rows}`;
    let a = this.indexCache.get(k);
    if (!a) this.indexCache.set(k, (a = flat ? fanIndices(cols, rows) : gridIndices(cols, rows)));
    return a;
  }

  private mesh(id: string, a: { positions: Float32Array; colors: Float32Array; normals?: Float32Array }, indices: Uint32Array): Mesh3d {
    return {
      id,
      name: SIM_GROUP,
      group: SIM_GROUP,
      positions: a.positions,
      colors: a.colors,
      ...(a.normals ? { normals: a.normals } : {}),
      indices,
      color: [STOCK_RGB[0], STOCK_RGB[1], STOCK_RGB[2], 1],
      origin: this.origin,
      doubleSided: false,
      triangleEdges: false,
      capGroup: 'sim-stock',
    };
  }

  private onMessage(msg: SimResponse): void {
    if (msg.gen !== this.gen) return;
    if (msg.type === 'error') {
      this.fail(msg.message);
      return;
    }
    const changed: Mesh3d[] = [];
    for (const t of msg.tiles as TileArrays[]) {
      // 관통한 칸이 있는 조각은 제 삼각형 번호(그 칸을 뺀 것), 아니면 같은 크기 조각끼리 함께 쓰는 번호
      const m = this.mesh(`sim-tile-${t.tx}-${t.ty}`, t, t.indices ?? this.indices(t.cols, t.rows, t.flat));
      this.tiles[t.ty * this.tilesX + t.tx] = m;
      changed.push(m);
    }
    if (msg.walls) changed.push((this.walls = this.mesh('sim-walls', msg.walls, msg.walls.indices)));
    if (msg.bottom) changed.push((this.bottom = this.mesh('sim-bottom', msg.bottom, msg.bottom.indices)));
    this.last = msg;
    if (changed.length) {
      // 다음에 장면 전체를 만들 일이 있으면(공구 경로 보이기 등) 지금 그물로
      this.dirtyScene = true;
      // 소재 장면이 이미 올라가 있으면 바뀐 그물만, 아니면(처음 다 모였을 때) 장면 전체를 한 번
      if (!this.patch(changed) && this.ready()) this.scheduleRefresh();
    }
    this.updateStatus();
    const ek = `${msg.events.length}:${msg.events[msg.events.length - 1]?.move ?? -1}`;
    if (ek !== this.eventsKey) {
      this.eventsKey = ek;
      this.host.refreshPanel();
    }
  }

  /**
   * 소재 장면이 뷰어에 올라가 있으면 바뀐 그물만 코어 setMesh로 바꾼다(같은 id 자리에서 — 워커가 넘긴 새 배열이 앞 배열과 크기가 같으면
   * 코어가 그 GPU 버퍼에 채우고, 같은 크기 조각의 색인은 indexCache의 같은 배열이라 다시 올리지 않는다). 올라가 있지 않으면 false
   */
  private patch(changed: readonly Mesh3d[]): boolean {
    const v = this.host.viewer;
    if (!v || !this.live || v.scene !== this.live) {
      this.live = null;
      return false;
    }
    // 조각 거의 모두가 바뀌었고(색·공구를 바꿔 다시 계산) 공구 경로가 작으면 장면 전체 한 번이 더 싸다 — 측정 중이면 그래도 그물만(측정을 지킨다)
    if (!this.host.holdScene() && fullSceneCheaper(sumBytes(changed), this.restBytes, sumBytes([...this.tiles, this.walls, this.bottom].filter((m): m is Mesh3d => !!m)))) return false;
    for (const m of changed) {
      if (!v.setMesh(m)) {
        this.live = null;
        return false;
      }
      this.uploads.meshes++;
    }
    this.live = v.scene;
    return true;
  }

  /** 장면 전체 다시 올리기(처음 다 모였을 때·공구 경로 보이기·끄기). 측정 점을 찍었거나 정밀 조준 중이면 기다린다 */
  private scheduleRefresh(soon = false): void {
    if (this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(
      () => {
        this.refreshTimer = 0;
        if (this.host.holdScene()) {
          this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = 0;
            this.scheduleRefresh(true);
          }, 400);
          return;
        }
        this.host.refreshScene();
      },
      soon ? 0 : 16,
    );
  }

  // ───────────────────────── 계산 중 표시 ─────────────────────────

  /** 계산 중이면 목표까지 온 비율(%), 아니면 null */
  private progress(): number | null {
    const u = this.last;
    const t = this.sent;
    if (!this.computing() || !t) return null;
    const at = u ? u.at.move + u.at.frac : 0;
    return Math.max(0, Math.min(99, Math.floor((at / Math.max(1e-9, t.move + t.frac)) * 100)));
  }

  private updateChip(): void {
    const p = this.on ? this.progress() : null;
    if (p === null) {
      this.chip?.remove();
      this.chip = null;
      return;
    }
    if (!this.chip) {
      this.chip = h('div', { class: 'sim-chip', role: 'status', 'aria-live': 'polite' });
      this.host.viewLayer.append(this.chip);
    }
    this.chip.textContent = `소재 계산 중 ${p}%`;
  }

  private statusText(): string {
    if (!this.on) return '꺼져 있습니다 — 켜면 재생 막대를 따라 소재를 깎아 보입니다.';
    if (this.error) return this.error;
    if (this.block) return '시뮬레이션하지 않음';
    const u = this.last;
    const count = this.host.doc ? this.moveCount(this.host.doc) : 0;
    const p = this.progress();
    if (p !== null) return `계산하는 중… ${p}%`;
    if (!u) return '계산하는 중… 0%';
    const secs = `${fmtNum((u.stats.computeMs + u.stats.meshMs) / 1000, 2)}초`;
    const k = this.panel ? this.stepAt() : null;
    if (k !== null) return `가공 ${k.toLocaleString('ko-KR')} / ${this.opSteps().length.toLocaleString('ko-KR')}개까지 깎았습니다 · ${secs}`;
    if (u.at.move >= count) return `전체 프로그램을 깎았습니다 · ${secs}`;
    return `이동 ${(u.at.move + (u.at.frac > 0 ? 1 : 0)).toLocaleString('ko-KR')} / ${count.toLocaleString('ko-KR')}까지 깎았습니다 · ${secs}`;
  }

  private updateStatus(): void {
    this.updateChip();
    if (this.statusEl?.isConnected) this.statusEl.textContent = this.statusText();
  }

  // ───────────────────────── 패널 "깎기" 탭 ─────────────────────────

  renderTab(body: HTMLElement, d: NcDoc): void {
    const key = d.nc ?? d.mpr;
    if (key && this.key !== key) this.prepare(d);
    const panel = !d.nc ? this.panel : null;
    const u = unitLabel(d.scene.units);
    const row = (k: string, ...v: (Node | string)[]): HTMLElement => h('div', { class: 'prop-row edit' }, h('span', { class: 'k' }, k), h('span', { class: 'v sim-v' }, ...v));
    const group = (title: string, ...children: (Node | null)[]): HTMLElement => h('section', { class: 'prop-group' }, h('h3', {}, title), ...children);
    const check = (label: string, on: boolean, run: (on: boolean) => void, hint = ''): HTMLElement => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = on;
      cb.addEventListener('change', () => run(cb.checked));
      return h('label', { class: 'group-item opt', title: hint || null }, cb, h('span', { class: 'name' }, label));
    };
    this.statusEl = h('p', { class: 'hint sim-status', 'aria-live': 'polite' }, this.statusText());
    const head: (Node | null)[] = [
      panel
        ? check('깎인 소재 보이기', this.on, (on) => this.setOn(on), '판 윗면 가공으로 판을 깎은 모양을 그립니다.')
        : check('깎인 소재 보이기', this.on, (on) => this.setOn(on), '재생 막대를 따라 공구가 소재를 깎은 모양을 그립니다(앞으로 감기는 이어서, 되감기는 저장점에서 다시 계산).'),
      panel
        ? check('가공 그림도 보이기', this.prefs.paths, (on) => this.setOptions({ paths: on }), '해석한 구멍·홈·포켓·윤곽 그림을 함께 그립니다.')
        : check('공구 경로도 보이기', this.prefs.paths, (on) => this.setOptions({ paths: on })),
      this.statusEl,
    ];
    if (this.block) {
      const b = this.block;
      const p = h('p', { class: 'sim-block' }, h('b', {}, '시뮬레이션하지 않음'), ' ', SIM_BLOCK_TEXT[b.code]);
      if (b.line >= 0) {
        const go = h('button', { class: 'linkish', type: 'button', title: '누르면 그 줄로' }, lineAtLabel(d, b.line));
        go.addEventListener('click', () => this.host.selectLine(b.line, undefined, true));
        p.append(' ', go, b.token ? h('span', { class: 'dim', translate: 'no' }, ` ${b.token}`) : '');
      }
      head.push(p);
    } else if (panel)
      head.push(
        h(
          'p',
          { class: 'hint' },
          '판 윗면에서 위→아래로 하는 가공(수직 구멍·홈·포켓·자유 형상 포켓·윤곽)을 3축 높이 지도로 깎은 근사 결과입니다. 구멍은 구멍 지름의 평 끝 공구로, 홈·포켓은 파일이 정한 모양 그대로(공구 모서리 R 없이), 윤곽은 공구 보정(왼쪽·오른쪽)을 넣어 깎습니다. 칸보다 작은 모양은 보지 않습니다.',
        ),
      );
    else head.push(h('p', { class: 'hint' }, '3축(공구 방향 Z) 높이 지도로 깎은 근사 결과입니다. 칸보다 작은 모양, 공구 아래로 파인 곳(언더컷), 공구 홀더·자루 충돌은 보지 않습니다.'));
    body.append(group('소재 깎기 시뮬레이션', ...head));
    if (panel && this.on && !this.block && this.opSteps().length) {
      this.stepTab = this.buildSteps(false);
      this.fillSteps(this.stepTab);
      body.append(
        group(
          '가공 하나씩 따라가기',
          this.stepTab.el,
          h('p', { class: 'hint' }, '가공 목록 차례대로 한 가공씩 깎아 봅니다. 지금 가공은 가공 그림(가공 그림도 보이기)과 가공 탭에서 강조합니다. 패널을 닫으면 3D 보기 아래에 같은 단추가 남습니다.'),
        ),
      );
    } else this.stepTab = null;
    if (panel) this.renderSkipped(body, panel);
    if (this.block || (!d.nc && !panel)) return;

    // 급속이 소재를 지난 줄
    const ev: SimEvent[] = this.last?.events ?? [];
    if (this.on && ev.length && d.nc) {
      const { rows, skipped } = rapidEventRows(ev, d.nc.moves.line, d.nc.warnItems);
      const list = h('ul', { class: 'warn-list' });
      for (const r of rows) {
        const b = h('button', { class: 'warn-item', type: 'button', title: '누르면 그 줄로' }, h('span', { class: 'ln' }, lineAtLabel(d, r.line)), h('span', { class: 'msg' }, `깊이 ${fmtNum(r.depth)} ${u}`));
        b.addEventListener('click', () => this.host.selectLine(r.line, [r.move], true));
        list.append(h('li', {}, b));
      }
      body.append(
        group(
          `급속 이동이 소재를 지남 ${rows.length.toLocaleString('ko-KR')}곳`,
          rows.length ? list : null,
          skipped ? h('p', { class: 'hint' }, `해석 경고에 이미 있는 줄 ${skipped.toLocaleString('ko-KR')}곳은 뺐습니다.`) : null,
          h('p', { class: 'hint' }, '급속이 깎은 자리는 빨갛게 그립니다(지금 재생 자리까지).'),
        ),
      );
    }

    // 소재 상자
    const box = this.stockBox();
    if (box) {
      const num = (v: number, label: string, set: (n: number) => void): HTMLInputElement => {
        const el = h('input', { type: 'number', step: 'any', inputmode: 'decimal', class: 'num-input', 'aria-label': label });
        el.value = String(Math.round(v * 1e6) / 1e6);
        el.addEventListener('change', () => {
          const n = Number(el.value);
          if (el.value.trim() !== '' && Number.isFinite(n)) set(n);
        });
        return el;
      };
      const edit = (axis: number, which: 'min' | 'max', n: number): void => {
        const b = this.stockBox()!;
        const next: SimBox = { min: [...b.min] as SimBox['min'], max: [...b.max] as SimBox['max'] };
        next[which][axis] = n;
        this.setOptions({ stock: next });
      };
      const axisRow = (label: string, axis: number): HTMLElement =>
        h('div', { class: 'prop-row edit' }, h('span', { class: 'k' }, label), h('span', { class: 'sim-pair' }, num(box.min[axis]!, `${label} — 최소`, (n) => edit(axis, 'min', n)), num(box.max[axis]!, `${label} — 최대`, (n) => edit(axis, 'max', n))));
      const reset = h('button', { class: 'btn small', type: 'button', disabled: !this.userStock }, '자동으로');
      reset.addEventListener('click', () => this.setOptions({ stock: null }));
      const from = this.userStock
        ? '직접 정함'
        : panel
          ? panel.board
            ? d.kind === 'mpr'
              ? '판 크기(LA·BR·DI)'
              : '판 정보(길이·폭·두께)'
            : '가공 범위에서 추정'
          : d.nc?.stock
            ? '프로그램의 공작물(BLK FORM)'
            : '절삭 범위에서 추정';
      body.append(
        group(
          '소재',
          axisRow('X 범위', 0),
          axisRow('Y 범위', 1),
          axisRow('Z 범위(바닥 ~ 윗면)', 2),
          row('정한 곳', from),
          panel
            ? h('p', { class: 'hint' }, '자동은 판 크기(원점 = 판 왼쪽 앞 아래 모서리)입니다. 직사각형이 아닌 판은 외곽선 밖을 바닥 색으로 그립니다. 바꾸면 처음부터 다시 계산합니다.')
            : h('p', { class: 'hint' }, '자동은 절삭 범위(공구 중심)에 공구 반지름과 여유를 더하고, Z0 아래를 깎으면 Z0을 윗면으로 봅니다. 바꾸면 처음부터 다시 계산합니다.'),
          reset,
        ),
      );
    }

    // 격자·색
    const res = h('select', { class: 'select', 'aria-label': '해상도(긴 변 칸)' });
    const autoN = box ? this.longCells(d, box) : longCellsFor('auto', isPhone());
    for (const r of SIM_RESOLUTIONS) res.append(h('option', { value: String(r) }, r === 'auto' ? `자동 (${autoN})` : String(r)));
    res.value = String(this.prefs.res);
    res.addEventListener('change', () => this.setOptions({ res: (res.value === 'auto' ? 'auto' : Number(res.value)) as SimResolution }));
    const color = h('select', { class: 'select', 'aria-label': '색' });
    color.append(h('option', { value: 'depth' }, '깊이로'), h('option', { value: 'stock' }, '소재 색'));
    color.value = this.prefs.color;
    color.addEventListener('change', () => this.setOptions({ color: color.value as SimColorMode }));
    const s = this.spec;
    body.append(
      group(
        '격자·색',
        h('label', { class: 'prop-row edit' }, h('span', { class: 'k' }, '해상도(긴 변 칸)'), res),
        s ? row('격자', `${(s.nx - 1).toLocaleString('ko-KR')} × ${(s.ny - 1).toLocaleString('ko-KR')}칸 · 칸 ${fmtNum(Math.max(s.dx, s.dy), 3)} ${u}`) : null,
        h('label', { class: 'prop-row edit' }, h('span', { class: 'k' }, '색'), color),
        h('p', { class: 'hint' }, '자동은 기기(휴대폰은 낮게)와 프로그램 크기로 정합니다. 칸이 많을수록 또렷하지만 계산과 메모리가 늘어납니다.'),
      ),
    );

    // 공구 표
    const tbody = h('tbody');
    for (const r of this.rows) {
      const name = panel ? panelToolLabel(panel.tools[r.number]) : r.number >= 100000 ? '—' : r.number >= 0 ? `T${r.number}` : '공구 없음';
      const kind = h('select', { class: 'select small', 'aria-label': `${name} 종류` });
      for (const k of SIM_TOOL_KINDS) kind.append(h('option', { value: k }, KIND_LABEL[k]));
      kind.value = r.tool.kind;
      kind.addEventListener('change', () => this.setTool(r, { kind: kind.value as SimToolKind }));
      const dia = h('input', { type: 'number', step: 'any', min: 0, inputmode: 'decimal', class: 'num-input', 'aria-label': `${name} 지름` });
      dia.value = String(r.tool.diameter);
      dia.addEventListener('change', () => {
        const n = Number(dia.value);
        if (n > 0) this.setTool(r, { diameter: n });
      });
      let extra: HTMLElement | string = '';
      if (r.tool.kind === 'bull' || r.tool.kind === 'drill') {
        const isBull = r.tool.kind === 'bull';
        const el = h('input', { type: 'number', step: 'any', min: 0, inputmode: 'decimal', class: 'num-input', 'aria-label': isBull ? `${name} 모서리 R` : `${name} 끝 각(도)` });
        el.value = String(isBull ? r.tool.corner : r.tool.angle);
        el.addEventListener('change', () => {
          const n = Number(el.value);
          if (n > 0) this.setTool(r, isBull ? { corner: n } : { angle: n });
        });
        extra = el;
      }
      const from = r.kindFrom === 'user' || r.diameterFrom === 'user' ? 'user' : r.diameterFrom === 'file' || r.kindFrom === 'file' ? 'file' : 'default';
      const fileNote = from === 'user' && r.file.diameter ? `파일 값 Ø${fmtNum(r.file.diameter)}` : '';
      tbody.append(
        h(
          'tr',
          {},
          h('td', {}, name),
          h('td', {}, kind),
          h('td', { class: 'sim-num' }, dia),
          h('td', { class: 'sim-num' }, extra),
          h('td', { class: 'dim', title: fileNote || null }, FROM_LABEL[from]),
        ),
      );
    }
    const forget = h('button', { class: 'btn small', type: 'button', disabled: !Object.keys(this.userTools).length }, '기억 지우기');
    forget.addEventListener('click', () => {
      this.userTools = {};
      writeJson(TOOLS_KEY, {});
      this.retool();
    });
    body.append(
      group(
        '공구',
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid sim-tools' }, h('thead', {}, h('tr', {}, h('th', {}, panel ? '공구' : '번호'), h('th', {}, '종류'), h('th', {}, `지름(${u || '단위'})`), h('th', {}, '모서리 R · 끝 각'), h('th', {}, '출처'))), tbody)),
        panel
          ? h(
              'p',
              { class: 'hint' },
              '구멍은 파일의 구멍 지름, 경로는 파일의 공구 폭(PGI·XML)을 씁니다. 공구 번호만 있는 MPR 윤곽처럼 지름을 모르면 기본값(평 엔드밀 Ø6 mm · 0.25 inch)이니 지름을 넣으십시오. 홈·포켓은 공구 없이 파일의 모양 그대로 깎습니다. 바꾼 값은 이 브라우저에 기억합니다.',
            )
          : h('p', { class: 'hint' }, '파일(공구 주석·공구 정의)에서 알 수 없는 값은 기본값(평 엔드밀 Ø6 mm · 0.25 inch)입니다. 바꾼 값은 공구 번호별로 이 브라우저에 기억하고 파일 값보다 먼저 씁니다.'),
        forget,
      ),
    );
  }

  // ───────────────────────── 판재 가공 하나씩 따라가기 ─────────────────────────

  /** 판재 이동의 가공 차례(이동을 아직 만들지 않았으면 빈 목록) */
  private opSteps(): PanelOpStep[] {
    const m = this.panelMoves;
    if (!m) return [];
    if (this.steps?.of !== m) this.steps = { of: m, list: panelOpSteps(m) };
    return this.steps.list;
  }

  /** 지금 깎은 가공 수(따라가기 중이 아니면 null — 걸음 수를 넘으면 끝) */
  private stepAt(): number | null {
    if (this.step === null) return null;
    return Math.min(this.step, this.opSteps().length || this.step);
  }

  private stepState(): SimState['step'] {
    const k = this.panel ? this.stepAt() : null;
    if (k === null) return null;
    const list = this.opSteps();
    return { at: k, count: list.length, op: k > 0 ? (list[k - 1]?.op ?? null) : null, strip: !!this.stepStrip && !this.stepStrip.el.hidden };
  }

  /**
   * 판재 가공 하나씩 따라가기: 가공 k개까지 깎는다(0 = 깎기 전, null = 끝까지 — 따라가기를 끝냄). 워커에 목표를 보내고(G-code 재생과 같은 길),
   * 지금 가공(k번째)을 고른다(가공 그림·가공 탭 강조 — 깎기 전이면 고른 것을 지운다)
   */
  setStep(k: number | null): void {
    const n = this.opSteps().length;
    const next = k === null || !Number.isFinite(k) ? null : Math.max(0, n ? Math.min(n, Math.round(k)) : Math.round(k));
    if (next === this.step) return;
    this.step = next;
    const d = this.host.doc;
    if (d && !d.nc && this.worker && this.panelMoves) {
      const t = this.targetOf(d);
      if (!this.sent || this.sent.move !== t.move || this.sent.frac !== t.frac) {
        this.sent = t;
        this.post({ type: 'target', gen: this.gen, target: t });
      }
    }
    const list = this.opSteps();
    if (next !== null && list.length) this.host.selectMprOp(next > 0 ? list[Math.min(next, list.length) - 1]!.op : -1, false);
    this.updateStatus();
    if (this.stepTab?.el.isConnected) this.fillSteps(this.stepTab);
    this.refreshStrip();
  }

  /** 판재를 깎아 보는 중이라 가공 하나씩 따라갈 수 있는지(← → 키) */
  get canStepOps(): boolean {
    return this.on && !!this.panel && !this.block && this.opSteps().length > 0;
  }

  /** 한 가공 앞·뒤로. 끝까지 보고 있으면(따라가기 전) 앞으로는 첫 가공부터, 뒤로는 마지막 가공 앞으로(G-code 한 이동씩과 같은 차례) */
  stepBy(delta: number): void {
    const n = this.opSteps().length;
    if (!n || !delta) return;
    const k = this.stepAt();
    this.setStep(k === null ? (delta > 0 ? Math.min(n, delta) : Math.max(0, n + delta)) : k + delta);
  }

  /** 3D 보기 아래 따라가기 띠: 켜져 있고 판재를 하나씩 따라가는 중이며 패널이 닫혔고 측정 중이 아닐 때 */
  refreshStrip(): void {
    const show = this.canStepOps && this.step !== null && !(this.host.panelOpen?.() ?? false) && !(this.host.measuring?.() ?? false);
    if (!show) {
      if (this.stepStrip) this.stepStrip.el.hidden = true;
      return;
    }
    if (!this.stepStrip) {
      this.stepStrip = this.buildSteps(true);
      this.host.viewLayer.append(this.stepStrip.el);
    }
    this.stepStrip.el.hidden = false;
    this.fillSteps(this.stepStrip);
  }

  /** 단추·막대(strip = 3D 보기 띠 — 재생 띠와 같은 꼴, ✕가 끝까지) */
  private buildSteps(strip: boolean): StepEls {
    const btn = (ic: IconName, label: string, run: () => void, text = ''): HTMLButtonElement => {
      const b = h('button', { class: `mb-btn${text ? '' : ' icon'}`, type: 'button', title: label, 'aria-label': label, html: `${icon(ic)}${text ? `<span>${text}</span>` : ''}` });
      b.addEventListener('click', run);
      return b;
    };
    const count = h('span', { class: 'ss-count' });
    const name = h('span', { class: 'ss-name' });
    const first = btn('first', '처음으로(깎기 전)', () => this.setStep(0));
    const prev = btn('stepBack', '이전 가공', () => this.stepBy(-1));
    const next = btn('stepFwd', '다음 가공', () => this.stepBy(1));
    const all = strip ? btn('close', '하나씩 따라가기 끝내기(모든 가공)', () => this.setStep(null)) : btn('all', '모든 가공 깎기(끝까지)', () => this.setStep(null), '끝까지');
    const range = h('input', { type: 'range', min: 0, max: 1, step: 1, value: 1, 'aria-label': '깎은 가공 수' });
    range.addEventListener('input', () => this.setStep(Number(range.value)));
    const el = h(
      'div',
      { class: strip ? 'play-strip sim-steps' : 'sim-steps', role: 'group', 'aria-label': '가공 하나씩 따라가기', ...(strip ? { hidden: true } : {}) },
      h('div', { class: 'ps-info' }, count, name),
      h('div', { class: 'ps-acts' }, first, prev, next, all),
      range,
    );
    return { el, count, name, first, prev, next, all, range };
  }

  /** 단추·막대를 지금 자리로: "k / 걸음 수", 지금 가공(가공 번호 · 이름), 끝에서 막힌 단추 */
  private fillSteps(s: StepEls): void {
    const list = this.opSteps();
    const n = list.length;
    const k = this.stepAt() ?? n;
    s.count.textContent = `${k.toLocaleString('ko-KR')} / ${n.toLocaleString('ko-KR')}`;
    const op = k > 0 ? list[k - 1]?.op : undefined;
    const row = op !== undefined ? mprOps(this.host.doc?.scene ?? { name: '', units: 'mm', meshes: [], lines: [] }).find((o) => o.index === op) : undefined;
    if (this.step === null) s.name.replaceChildren(h('span', {}, '모든 가공'));
    else if (k === 0) s.name.replaceChildren(h('span', {}, '깎기 전'));
    else s.name.replaceChildren(h('span', {}, `가공 ${(op ?? 0) + 1}`), ...(row ? [' · ', h('span', {}, row.label || MPR_KIND[row.kind] || row.kind)] : []));
    s.first.disabled = this.step === 0;
    s.prev.disabled = k === 0;
    s.next.disabled = this.step === null || k >= n;
    if (s.all.closest('.play-strip') === null) s.all.disabled = this.step === null;
    s.range.max = String(n);
    s.range.value = String(k);
    s.range.setAttribute('aria-valuetext', `${k} / ${n}`);
  }

  /** 판재: 시뮬레이션하지 않은 가공(까닭별 수와 가공 — 누르면 그 가공을 고른다), 꺼진 가공 수 */
  private renderSkipped(body: HTMLElement, src: PanelSimSource): void {
    if (!src.skipped.length && !src.disabled) return;
    const sec = h('section', { class: 'prop-group' }, h('h3', {}, `시뮬레이션하지 않은 가공 ${src.skipped.length.toLocaleString('ko-KR')}개`));
    const byCode = new Map<PanelSkipCode, PanelSimSkip[]>();
    for (const s of src.skipped) byCode.set(s.code, [...(byCode.get(s.code) ?? []), s]);
    for (const code of Object.keys(PANEL_SKIP_TEXT) as PanelSkipCode[]) {
      const list = byCode.get(code);
      if (!list) continue;
      sec.append(h('p', { class: 'sim-skip-head' }, h('b', {}, PANEL_SKIP_TEXT[code]), ' ', h('span', { class: 'dim' }, `${list.length.toLocaleString('ko-KR')}개`)));
      const ul = h('ul', { class: 'warn-list' });
      for (const s of list.slice(0, 50)) {
        const b = h('button', { class: 'warn-item', type: 'button', title: '누르면 그 가공을 고릅니다' }, h('span', { class: 'ln' }, `가공 ${s.op + 1}`), h('span', { class: 'msg' }, s.label));
        b.addEventListener('click', () => this.host.selectMprOp(s.op, true));
        ul.append(h('li', {}, b));
      }
      sec.append(ul);
      if (list.length > 50) sec.append(h('p', { class: 'hint' }, `그 밖 ${(list.length - 50).toLocaleString('ko-KR')}개는 가공 탭에서 보십시오.`));
    }
    if (src.disabled) sec.append(h('p', { class: 'hint' }, `꺼진 가공 ${src.disabled.toLocaleString('ko-KR')}개는 깎지 않습니다.`));
    body.append(sec);
  }

  /** 공구 하나를 바꾼다(기억 — 판재 공구는 'panel:' 열쇠로) */
  private setTool(r: SimToolRow, patch: Partial<SimTool>): void {
    const k = r.key ?? String(r.number);
    this.userTools = { ...this.userTools, [k]: { ...(this.userTools[k] ?? {}), ...patch } };
    writeJson(TOOLS_KEY, this.userTools);
    this.retool();
  }

  /** 공구 표를 다시 정하고 다시 계산 */
  private retool(): void {
    this.key = null;
    const d = this.host.doc;
    if (d) this.prepare(d);
    if (this.on) this.start();
    this.host.refreshPanel();
  }
}
