/**
 * OpenCAD NC 뷰어 앱: 제목 막대 · 보기 도구 막대 · 3D 보기 + 패널 · 상태 막대를 만들고, 파일 열기·해석(워커)·보기·재생을 잇는다.
 *
 * - 한 번에 문서 하나. 새 파일을 열면 바꾼다(열기에 실패하면 앞 문서를 그대로 둔다).
 * - 해석은 웹 워커(src/worker/parse.worker.ts)에서 하고, 진행률·단계 글을 작업 영역 위 덮개로 보인다.
 * - 뷰어(Viewer3d)는 첫 문서를 열 때 만든다(WebGL2가 없으면 그때 알기 쉬운 오류 글). 코어 입구는 그때 나눠 받는다(core.ts — 첫 화면 JS를 줄인다).
 * - 키: 캔버스에 초점이 있으면 뷰어가 F·1~7·Esc를 직접 받고, 다른 곳이면 창 캡처 단계에서 같은 키를 뷰어로 보낸다
 *   (입력 칸 제외). F7 = 격자, Space = 재생/멈춤, Ctrl/⌘+O = 열기.
 * - 자동 확인용으로 window.opencadApp(상태·열기 함수)을 둔다.
 * - 휴대폰(폭 760px 미만): 도구 막대는 보기·측정 단추(전체 보기·표준 뷰·보기 설정·단면·측정·재생·패널)만 한 줄에 두고,
 *   나머지(투영·그리기 모드·격자·뷰 큐브·좌표축·PNG)는 "보기 설정" 메뉴로 모은다.
 * - 휴대폰·터치: 측정 중에는 3D 보기 아래 가운데 띠(measure.ts)에 안내·거리·dx·dy·dz와 다시 재기·끝내기 단추를 두고,
 *   길게 누르면 손가락 위 십자선으로 정밀 조준한다(aim.ts — 코어 포인터 처리를 그대로 쓴다).
 * - 측정 도구(방향 잠금·툴팁 measure-lock.ts, 붙잡기 점 snap.ts, 정밀 조준 aim.ts, 원호 접선 tangent.ts)도 문서를 열 때 나눠 받는다
 *   (core.ts loadMeasureTools — 첫 문서는 코어와 함께 받은 뒤 보인다). 받지 못했으면 측정을 켤 때 다시 받는다(FirstUse — 받는 동안 단추는
 *   눌림·받는 중, 다시 누르기·Esc면 켜지 않고, 받지 못하면 알린다).
 * - 최근 문서: 파일 고르기·끌어다 놓기로 연 파일을 이 브라우저(IndexedDB, recent.ts)에 두고 시작 화면에서 바로 다시 연다
 *   (휴대폰 브라우저가 뒤로 간 탭을 버렸다가 다시 읽어도 파일 앱을 다시 거치지 않게). 예제·주소로 연 파일은 두지 않는다.
 *
 * 2dcad-viewer 커밋 d7c584a의 src/app/view3d/manager.ts에서 NC 부분을 옮겨 2D 화면 골격 없이 다시 짰다.
 */
import type { MeasureResult, Pick3d, RenderMode, SceneIssue, SectionAxis, SectionState, ViewName, Viewer3d } from 'opencad-viewer3d';
import { VIEW_LABELS } from 'opencad-viewer3d/camera';
import { GCODE_EXTENSIONS, HEIDENHAIN_EXTENSIONS, MPR_EXTENSIONS, NC_EXTENSIONS, PGI_EXTENSIONS, XML_EXTENSIONS, isPanelKind } from '../extensions';
import { PLAY_SPEEDS, advance, formatDuration, lastMoveOfLine, moveEndTime, pointAlong, stepTarget, totalTime, type PlaySpeed } from '../view/playback';
// 측정 도구 자체(aim·measure-lock·snap·tangent)는 문서를 열 때 나눠 받는다(core.ts loadMeasureTools) — 여기서는 형만
import type { TouchAim } from './aim';
import { FirstUse, isChunkLoadError, loadMeasureTools, loadViewerCore, loadViewerUi, measureFailText, viewerUi } from './core';
import type { KeySnap } from './keysnap';
import { ParseWorkerClient } from './client';
import { beginOpen, showAnalyticsSettings, trackExport, type OpenAttempt } from 'opencad-site-kit/analytics';
import { formatRecentTime, RecentStore, type RecentEntry } from './recent';
import { loadSettings, saveSettings, settingsNeedReparse, settingsOpenOptions, type NcSettings } from './settings';
import { boardLid, boardThrough, createDoc, emptyProgramParts, lineLabel, lineMoveList, moveEndPoint, moveSegments, moveState, mprOps, noticeViews, playPosition, replaceResult, sceneCounts, sceneFeatures, selectionSummary, statusParts, toolMarker, unitLabel, warningLabel, type NcDoc } from './doc';
import { h, loadDone, loadFailed, mixSpan, pieces, relangToasts, toast, toastArea, toastSpare } from './dom';
import { fileText, mix, plainText, type Mixed } from './filetext';
import { mixNodes, mixText, uiText } from './i18n';
import { BINARY_MESSAGE, extensionList, fileAccept, fmtNum, formatBytes, isNcFileName, looksBinary, parseOnceParams, parseStartParams, shareErrorText, withoutOnceParams } from './format';
import { icon, type IconName } from './icons';
import { isEditableTarget, isPressTarget, keyAction, readCharKeysPref, tabMove, viewKeyOf, writeCharKeysPref } from './keys';
import { MEASURE_LOADING, measureHint, measureLines, snapPair, trackMarks } from './measure';
import type { MeasureLock } from './measure-lock';
import type { TrackPick } from './measure-track';
import { NARROW_WIDTH, NcPanel, loadPanelInfo, type PanelHost } from './panel';
import type { ArcCenters } from './snap';
import { errorText, sceneHasGeometry, type NcKind, type NcOpenOptions } from './protocol';
import { canUseServiceWorker, consumeLaunchFiles, registerServiceWorker, whenVisible, type SwContainer } from 'opencad-site-kit/pwa/client';
import { acceptEmbeddedFiles, isFramed } from 'opencad-site-kit/embed/app';
import { otherTheme, readThemePref, resolveTheme, safeStorage, writeThemePref, type ThemeName } from './theme';
import type { SimHost, SimState, SimView } from './sim';

/** 측정 도구 조각(measure-tools.ts)의 모듈 */
type MeasureTools = Awaited<ReturnType<typeof loadMeasureTools>>;
/** 첫 문서에서 코어를 받은 뒤 측정 도구 조각을 더 기다리는 한도(ms) — 넘으면 문서를 먼저 보인다 */
const MEASURE_WAIT_MS = 3000;

/** 약속이 끝나거나(값·실패 모두) ms가 지날 때까지 기다린다 */
function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p.then(() => undefined, () => undefined), new Promise<void>((r) => (timer = setTimeout(r, ms)))]).finally(() => clearTimeout(timer));
}

export const APP_TITLE = 'OpenCAD NC 뷰어';
const TOOLS_URL = 'https://gyutae-kim.github.io/opencad';
const REPO_URL = 'https://github.com/GyuTae-Kim/opencad-nc';
/** 다른 웹페이지에 넣었을 때 부모 페이지에서 받는 확장자(점 포함, 소문자 — 여는 확장자 NC_EXTENSIONS 그대로) */
export const EMBED_ACCEPT: readonly string[] = NC_EXTENSIONS.map((e) => `.${e.toLowerCase()}`);

const RENDER_MODES: [RenderMode, string][] = [
  ['shaded', '음영'],
  ['shadedEdges', '음영 + 모서리'],
  ['wireframe', '와이어프레임'],
  ['xray', 'X-ray'],
];
const VIEW_MENU: ViewName[] = ['top', 'front', 'right', 'left', 'back', 'bottom', 'seIso', 'swIso', 'neIso', 'nwIso'];
/** 뷰 큐브 한 변(CSS 화소): 넓은 화면은 코어 기본값, 폭 760px 미만은 작게 */
const CUBE_WIDE = 112;
const CUBE_NARROW = 76;
const NARROW_QUERY = `(max-width: ${NARROW_WIDTH - 0.02}px)`;
/**
 * 휴대폰: 좁은 화면이거나 손가락 기기의 낮은 가로 화면(폭은 760px을 넘을 수 있다).
 * 한 줄 도구 막대(styles.css)·작은 뷰 큐브·처음엔 닫힌 패널로 3D 보기 자리를 지킨다
 */
const PHONE_QUERY = `${NARROW_QUERY}, (pointer: coarse) and (max-height: 499.98px)`;
/** 손가락이 주인 기기(휴대폰·태블릿): 안내 글·파일 고르기를 맞춘다 */
const COARSE_QUERY = '(pointer: coarse)';
/**
 * 198차: 첫 화면 알림 영역의 모습 — 늘 화면에서만 1화소로 잘라 감추고 숨김 속성은 두지 않는다(keysnap.ts .key-live·measure-lock.ts FLASH_EMPTY·sim.ts LIVE_HIDDEN과 같은 값).
 * 알림 영역은 글을 바꾸기 전에 접근성 트리에 있어야 화면 읽기 프로그램이 바뀐 글을 읽는다(117·156·197차)
 */
const LIVE_HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';

/** 요소가 키보드 초점 표시(:focus-visible) 중인지(그 선택자를 모르는 환경이면 false) */
export function matchesFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** 지금 휴대폰 화면인지(PHONE_QUERY). matchMedia가 없으면 폭만 본다 */
function isPhone(): boolean {
  try {
    return window.matchMedia(PHONE_QUERY).matches;
  } catch {
    return window.innerWidth < NARROW_WIDTH;
  }
}

/** 자동 확인용 상태 */
export interface AppState {
  /** 앱 화면이 준비됨 */
  ready: boolean;
  /** 읽는 중(받기·해석) */
  busy: boolean;
  stage: string;
  /** 열린 문서 이름(없으면 null) */
  docName: string | null;
  /** 문서를 다 읽어 화면에 올렸음 */
  parsed: boolean;
  kind: NcKind | null;
  units: string;
  moves: number;
  lines: number;
  segments: number;
  tools: number;
  operations: number;
  warnings: number;
  /** 코어가 지금 장면 입력에서 빼거나 고친 알림 수(55차 — 코어 0.50.0 sceneIssues) */
  sceneIssues: number;
  /** 마지막 오류 글(성공하면 지운다) */
  error: string | null;
  panelOpen: boolean;
  panelTab: string;
  playing: boolean;
  playSec: number | null;
  selLine: number;
  theme: ThemeName;
  measuring: boolean;
  /** 정밀 조준 중(터치 길게 누르기) */
  aiming: boolean;
  /** 측정 방향 잠금(잠근 방향·툴팁 글·측정 띠 알림·잠금 단추가 보이는지 — 코어 0.10.0 추론 잠금) */
  measureLock: ReturnType<MeasureLock['snapshot']> | null;
  /** 측정 도구 조각을 받기 전에 측정을 켜서 받는 중이면 true(받으면 켠다) */
  measureLoading: boolean;
  /** 측정 도구 조각을 받아 만들었는지 */
  measureTools: boolean;
  /** 단면 보기(꺼져 있으면 null) */
  section: { axis: SectionAxis | null; t: number; flip: boolean } | null;
  /** 여러 파일 작업이면 이은 파일(주 프로그램 먼저), 아니면 null */
  jobFiles: string[] | null;
  /** 소재 깎기 시뮬레이션(한 번도 켜지 않았으면 null) */
  sim: SimState | null;
}

export interface OpencadAppApi {
  readonly state: AppState;
  readonly viewer: Viewer3d | null;
  open(name: string, data: ArrayBuffer | Uint8Array | string, opts?: NcOpenOptions): Promise<boolean>;
  /** 여러 파일을 한 작업으로(주 프로그램은 고르거나 앱이 정한다) — 파일 고르기에서 여럿 고른 것과 같은 길 */
  openJob(files: { name: string; data: ArrayBuffer | Uint8Array | string }[]): Promise<boolean>;
  /** 열린 작업에 파일을 더한다(부프로그램 등) */
  addFiles(files: { name: string; data: ArrayBuffer | Uint8Array | string }[]): Promise<boolean>;
  openUrl(url: string, name?: string): Promise<boolean>;
  openSample(): Promise<boolean>;
  reparse(opts: NcOpenOptions): Promise<void>;
  setTheme(t: ThemeName): void;
  togglePanel(on?: boolean): void;
  setPanelTab(tab: string): void;
  selectLine(line: number): void;
  seek(sec: number | null): void;
  /** 한 이동씩 앞·뒤로 */
  stepMove(delta: number): void;
  /** 고른 줄(또는 line)까지 그리기 */
  drawToLine(line?: number): void;
  togglePlay(): void;
  /** 읽는 중이면 멈춘다(앞 문서는 그대로). 멈췄으면 true */
  cancel(): boolean;
  /** 단면 보기: 축과 범위 안 위치(0~1), null이면 끈다 */
  setSection(axis: SectionAxis | null, t?: number, flip?: boolean): void;
  /** 소재 깎기 시뮬레이션 켜고 끄기(선택: 공구 경로 함께·색·해상도·소재 상자) */
  setSim(on: boolean, opts?: Parameters<SimView['setOptions']>[0]): Promise<void>;
}

declare global {
  interface Window {
    opencadApp?: OpencadAppApi;
  }
}

interface ToolButton {
  el: HTMLButtonElement;
  needsDoc: boolean;
}

export interface NcViewerAppOptions {
  /** 최근 문서 저장소(시험은 메모리 바탕을 끼운다). 없으면 IndexedDB */
  recent?: RecentStore;
}

/**
 * 보이는 화면 크기(펼침 상자 자리 잡기용). 휴대폰은 화면 밖으로 넘친 상자가 window.innerWidth를 늘리므로
 * (레이아웃 뷰포트가 넓어진다) 넘침과 상관없는 문서 요소의 client 크기를 쓴다.
 */
function viewportSize(): { width: number; height: number } {
  const el = document.documentElement;
  return { width: el.clientWidth || window.innerWidth, height: el.clientHeight || window.innerHeight };
}

/** 자동화 API의 파일(이름 + 글·바이트) → File(파일 고르기와 같은 길로 연다) */
function asFile(f: { name: string; data: ArrayBuffer | Uint8Array | string }): File {
  return new File([typeof f.data === 'string' ? f.data : f.data instanceof Uint8Array ? f.data.slice() : f.data.slice(0)], f.name);
}

/** 메뉴 항목 단추: 명령(menuitem) · 하나 고르기(menuitemradio) · 켜고 끄기(menuitemcheckbox) */
function menuItem(label: string, role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox', run: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', role, 'aria-checked': role === 'menuitem' ? null : 'false' }, h('span', {}, label));
  b.addEventListener('click', run);
  return b;
}

/** 단추 하나(그림 + 글). 좁은 화면에서는 글을 숨기고 그림만 */
function tbtn(ic: IconName, label: string, title: string, cls = ''): HTMLButtonElement {
  return h('button', { class: `tbtn ${cls}`.trim(), type: 'button', title, 'aria-label': label, html: `${icon(ic)}<span class="lbl">${label}</span>` });
}

export class NcViewerApp implements PanelHost {
  doc: NcDoc | null = null;
  viewer: Viewer3d | null = null;
  private readonly client = new ParseWorkerClient();
  readonly panel: NcPanel;
  /** 기계·읽기 설정(앱 전체, localStorage) */
  settings: NcSettings = loadSettings();

  private theme: ThemeName;
  private readonly storage = safeStorage();
  /** 171차: 설정 메뉴 「3D 보기 밖에서도 한 글자 단축키(F·1~7)」(기본 켬 — 끄면 그 키는 3D 보기에 초점이 있을 때만, WCAG 2.1.4) */
  private charKeys = readCharKeysPref(this.storage);
  /** 205차: 키보드 단축키 창을 받는 중이거나 열려 있음(openShortcuts — 두 번 열지 않는다) */
  private keysHelp = false;
  private panelOpen = !isPhone();
  private playing = false;
  private raf = 0;
  private lastT = 0;
  speed: PlaySpeed = 10;
  private busy = false;
  private stage = '';
  /** 155차: 숨었던 덮개를 보인 차례(그린 뒤 단계 글을 넣을 때까지 — 다시 열거나 닫으면 바뀌어 늦은 글을 버린다) */
  private busyHold: object | null = null;
  /** 182차: 덮개가 뜰 때 덮는 자리(inert)에 있어 「취소」로 옮긴 초점 칸 — 걷히면 돌려준다 */
  private busyFrom: HTMLElement | null = null;
  private error: string | null = null;
  private loadSeq = 0;
  private ready = false;
  private openMenu: { wrap: HTMLElement; close: () => void } | null = null;
  private readonly coarse: MediaQueryList | null;
  /** 측정 도구 조각(measure-tools.ts — 문서를 열 때 나눠 받는다, core.ts loadMeasureTools). 받기 전에는 null */
  private measureTools: MeasureTools | null = null;
  /** 정밀 조준(터치 길게 누르기, 뷰어와 측정 도구가 다 있을 때 붙인다) */
  private aim: TouchAim | null = null;
  /** 원호 중심 붙잡기 점(해석 결과마다 한 번 — 측정을 처음 켤 때 만든다) */
  private readonly snapCenters = new WeakMap<object, ArcCenters>();
  /** 지금 코어에 준 측정 붙잡기(해석 결과가 같으면 다시 주지 않고, 재생 중에는 붙잡기 한도만 바꾼다) */
  private snapKey: { src: object; limit: number | null } | null = null;
  /** 정보 탭에 그린 코어 장면 알림(문서와 알림 열쇠 — syncSceneIssues) */
  private sceneIssueState: { doc: NcDoc | null; key: string } = { doc: null, key: '' };
  /** 측정 도구를 받기 전에 측정을 켰을 때: 받은 뒤에 켠다(받는 동안 다시 누르면 거둔다, 받지 못하면 알린다) */
  private readonly measureFirstUse = new FirstUse<true>(
    () => this.ensureMeasureTools(),
    (want, error) => this.measureArrived(want, error),
  );
  /** 최근 문서(이 브라우저의 IndexedDB) */
  readonly recent: RecentStore;
  private recentSeq = 0;
  /** 다음 파일 고르기가 열린 작업에 더할 파일인지 */
  private pickAdd = false;
  /** 소재 깎기 시뮬레이션(켤 때 나눠 받는다 — sim.ts) */
  private sim: SimView | null = null;
  private simLoad: Promise<SimView> | null = null;
  /** 뷰어에 올린 장면에 반투명 판이 있어 보기에서 누르면 판 너머를 고르는지(applyDoc — doc.ts boardThrough, 키보드 고르기 후보도 — keysnap.ts) */
  pickThrough = false;
  /** 3D 보기 키보드 붙잡기·고르기(56차 keysnap.ts — 뷰어와 함께 받는다) */
  private keySnap: KeySnap | null = null;
  /**
   * 213차: 3D 보기 띠(viewer-ui)를 받지 못했을 때의 다시 받기(ensureViewer attach가 둔다 — 받는 동안·받은 뒤에는 없다).
   * auto면 띠가 필요한 때의 조용한 다시 받기(뷰어가 있을 때 문서 열기·3D 보기 키 — 뷰어마다 셋까지, 214차: 캔버스 첫 손가락 누름·단면 켜기도), 아니면 알림의 「다시 시도」
   */
  private uiRetry?: (auto?: boolean) => void;

  // ── 화면 요소 ──
  private readonly root: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly docNameEl: HTMLSpanElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly workspace: HTMLElement;
  /** 3D 보기 칸(뷰어·띠·알림 영역을 담는다) */
  readonly viewEl: HTMLDivElement;
  private readonly startEl: HTMLDivElement;
  private readonly startError: HTMLDivElement;
  private readonly recentCard: HTMLElement;
  private readonly recentList: HTMLUListElement;
  private readonly busyEl: HTMLDivElement;
  private readonly busyStage: HTMLDivElement;
  private readonly busyBar: HTMLDivElement;
  private readonly busyName: HTMLDivElement;
  private readonly busyCancel: HTMLButtonElement;
  private readonly stWarn: HTMLButtonElement;
  private readonly dropMask: HTMLDivElement;
  private readonly stMain: HTMLSpanElement;
  private readonly stSel: HTMLSpanElement;
  private readonly tools: Record<string, ToolButton> = {};
  private readonly projBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly playSep: HTMLSpanElement;
  private readonly renderItems: { mode: RenderMode; el: HTMLButtonElement }[] = [];
  private secHandle: HTMLDivElement | null = null;
  /** 좁은 화면 "보기 설정" 메뉴의 투영·켜고 끄기 항목(그리기 모드는 renderItems에 함께 둔다) */
  private readonly moreItems: { proj: Record<'perspective' | 'orthographic', HTMLButtonElement>; grid: HTMLButtonElement; cube: HTMLButtonElement; axes: HTMLButtonElement; sim: HTMLButtonElement };
  /** 넓은 화면 "그리기" 메뉴의 소재 깎기(구분선과 항목) */
  private readonly simWide: [HTMLDivElement, HTMLButtonElement] = [h('div', { class: 'menu-sep', role: 'separator' }), menuItem('소재 깎기', 'menuitemcheckbox', () => void this.setSim())];
  // ── 측정 띠(휴대폰·터치) ──
  private readonly measureBar: HTMLDivElement;
  private readonly measureText: HTMLDivElement;
  private readonly measureClear: HTMLButtonElement;
  /** 측정 띠 단추 자리(잠금 단추는 측정 도구를 받으면 맨 앞에 넣는다) */
  private readonly measureActs: HTMLDivElement;
  /** 측정 방향 잠금·붙잡기 툴팁(measure-lock.ts — 측정 도구 조각을 받으면 만든다) */
  private mlock: MeasureLock | null = null;
  /** 측정 띠의 끌어온 점 단추(measure-track.ts — 측정 도구 조각을 받으면 잠금 단추 다음에 넣는다) */
  private mtrack: TrackPick | null = null;
  private readonly aimLayer: HTMLDivElement;
  private readonly noticeBar: HTMLDivElement;
  /**
   * 198차: 판단 띠 글·그래픽 잃음 안내를 알리는 영역 — 앱을 만들 때 #app에 빈 채로 붙여 둔다(작업 영역 밖이라 덮개 동안 inert가 되지 않음).
   * saidKeys는 지난번 그린 판단 띠 줄의 열쇠(같은 줄은 다시 그려도 알리지 않는다)
   */
  private readonly said: HTMLDivElement;
  private saidKeys: string[] = [];
  /** 201차: 알림 영역에 글을 넣은 화면 언어(languagechange — 언어가 바뀌면 앞 언어 글을 비운다; 번역층을 받기 전 앱은 한국어) */
  private saidLang = 'ko';
  /** 패널을 닫은 채(휴대폰 등) 재생할 때 3D 보기 아래 재생 띠 */
  private readonly playStrip: { el: HTMLDivElement; time: HTMLSpanElement; line: HTMLSpanElement; state: HTMLDivElement; play: HTMLButtonElement; range: HTMLInputElement; speed: HTMLSelectElement };
  /** 189차: 깎기 조각이 붙인 판재 따라가기 띠(SimHost.stripAdded)와 아래쪽 띠 크기 관찰 — liftToasts가 재생·측정 띠와 함께 잰다 */
  private simStrip: HTMLElement | null = null;
  private bandRo: ResizeObserver | null = null;
  private sec!: { btn: HTMLButtonElement; axes: { axis: SectionAxis | null; el: HTMLButtonElement }[]; range: HTMLInputElement; flip: HTMLButtonElement; val: HTMLSpanElement };

  constructor(root: HTMLElement, opts: NcViewerAppOptions = {}) {
    root.addEventListener('languagechange', (e) => {
      // 201차: 알림 영역(.app-live)은 판단 띠 새 줄 글을 그때 언어로 옮긴 조각(번역층이 건너뜀)으로 넣고 아래 renderNotices는 같은 줄을 다시 넣지 않아, 언어를 바꾸면
      // 앞 언어 글이 다음 새 줄까지 남았다(화면에는 보이지 않으나 화면 읽기 프로그램의 읽기 모드로 읽힘 — WCAG 3.1.2). 비운다(빈 글은 알리지 않는다 — 200차 KeySnap.sync 꼴).
      // 그래픽 잃음 안내(글 마디 — 번역층이 새 언어로 다시 옮긴다)도 함께 빈다(보이는 안내는 그대로)
      // 202차: 깎기 계산 알림 영역(.sim-live — 화면에 보이지 않음, 글 마디라 번역층이 지난 글을 새 언어로 다시 옮겨 또 읽힐 수 있음)도 같은 꼴로 비우고,
      // 알림 상자의 그때 언어 조각은 원문에서 새 언어로 다시 옮긴다(보이는 글 — dom.ts relangToasts)
      const lang = (e as CustomEvent<string>).detail;
      if (lang !== this.saidLang) {
        this.said.textContent = '';
        this.sim?.quiet();
        relangToasts();
      }
      this.saidLang = lang;
      if (this.viewer) this.viewer.setViewCubeSize(this.viewer.viewCubeSize);
      // 코어 측정 거리 글상자(캔버스 글)를 새 언어로 다시 그린다. 키보드 붙잡기 알림 틀도(56차)
      this.labelFormat();
      this.keySnap?.sync();
      // 최근 문서의 시각 글을 화면 언어 형식으로
      void this.renderRecent();
      // 파일 글이 섞인 글(상태 줄·안내 띠·패널·재생 띠·시작 화면 오류 — 그릴 때 옮겨 넣고 번역층은 건너뛴다)을 새 언어로 다시 그린다(54차)
      if (this.startError && !this.startError.hidden) this.startError.replaceChildren(...this.errorNodes());
      if (this.doc) {
        this.renderStatus();
        this.renderNotices();
        this.panel.show(this.doc);
        this.refreshPlayStrip();
      }
    });
    this.root = root;
    this.recent = opts.recent ?? new RecentStore();
    this.coarse = typeof window.matchMedia === 'function' ? window.matchMedia(COARSE_QUERY) : null;
    this.theme = resolveTheme(readThemePref(this.storage), this.systemDark());
    document.documentElement.dataset.theme = this.theme;

    // ── 열기 상자 ──
    // 여러 파일을 고르면 한 작업(주 프로그램 + 부프로그램 파일)으로 연다
    this.fileInput = h('input', { type: 'file', multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: -1 });
    this.syncAccept();
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      const add = this.pickAdd;
      this.pickAdd = false;
      this.fileInput.value = '';
      if (!files.length) return;
      if (add && this.doc?.nc) void this.addFiles(files);
      else if (files.length > 1) void this.openFiles(files);
      else void this.openFile(files[0]!);
    });

    // ── 제목 막대 ──
    const openBtn = tbtn('open', '열기', '파일 열기 (Ctrl+O)', 'primary');
    openBtn.addEventListener('click', () => this.chooseFile());
    const sampleBtn = tbtn('sample', '예제 열기', '합성 예제 G-code 열기');
    sampleBtn.addEventListener('click', () => void this.openSample());
    this.themeBtn = tbtn('moon', '테마', '테마 바꾸기', 'theme-btn');
    const themeChoice = h('button', { type: 'button', role: 'menuitem' }, '밝은 / 어두운 테마로 바꾸기');
    themeChoice.addEventListener('click', () => this.setTheme(otherTheme(this.theme), true));
    const analyticsChoice = h('button', { type: 'button', role: 'menuitem' }, '방문 통계 설정');
    analyticsChoice.addEventListener('click', showAnalyticsSettings);
    // 171차(WCAG 2.1.4): 켜고 끄는 항목(격자·뷰 큐브와 같은 menuitemcheckbox) — 끄면 F·1~7은 3D 보기에 초점이 있을 때만(keyAction), 이 브라우저에 기억
    // 205차: ?도 한 글자 단축키(keys.ts — 끄면 3D 보기에서만)
    const charKeysChoice = menuItem('3D 보기 밖에서도 한 글자 단축키(F·1~7·?)', 'menuitemcheckbox', () => {
      writeCharKeysPref(this.storage, (this.charKeys = !this.charKeys));
      charKeysChoice.setAttribute('aria-checked', String(this.charKeys));
    });
    charKeysChoice.setAttribute('aria-checked', String(this.charKeys));
    // 205차: 키보드 단축키 창(? 키와 같음 — 창은 열 때 받는 조각 shortcuts.ts, 글은 그 SHORTCUTS_TITLE과 같다)
    const keysChoice = menuItem('키보드 단축키', 'menuitem', () => this.openShortcuts());
    keysChoice.append(h('kbd', { translate: 'no' }, '?'));
    // 다른 웹페이지에 넣은 화면(iframe)에서는 방문 통계를 켜지 않으므로 그 설정 항목도 뺀다
    const settings = this.menu('settings', this.themeBtn, isFramed() ? [themeChoice, charKeysChoice, keysChoice] : [themeChoice, charKeysChoice, keysChoice, analyticsChoice], false);
    const toolsLink = h('a', { class: 'tbtn', href: TOOLS_URL, title: 'OpenCAD 도구 모음', 'aria-label': 'OpenCAD 도구', html: `${icon('apps')}<span class="lbl">OpenCAD 도구</span>` });
    const repoLink = h('a', { class: 'tbtn', href: REPO_URL, target: '_blank', rel: 'noopener', title: 'GitHub 저장소(소스 코드)', 'aria-label': 'GitHub', html: `${icon('code')}<span class="lbl">GitHub</span>` });
    this.docNameEl = h('span', { class: 'docname' });
    const titlebar = h(
      'header',
      { class: 'titlebar' },
      h('h1', { class: 'brand' }, h('b', {}, 'OpenCAD'), ' NC 뷰어'),
      this.docNameEl,
      h('span', { class: 'spacer' }),
      h('div', { class: 'title-actions' }, openBtn, sampleBtn, settings, toolsLink, repoLink),
    );

    // ── 보기 도구 막대 ──
    this.moreItems = {
      proj: {
        perspective: menuItem('원근 투영', 'menuitemradio', () => this.setProjection('perspective')),
        orthographic: menuItem('평행 투영', 'menuitemradio', () => this.setProjection('orthographic')),
      },
      grid: menuItem('격자', 'menuitemcheckbox', () => this.toggleGrid()),
      cube: menuItem('뷰 큐브', 'menuitemcheckbox', () => this.toggleCube()),
      axes: menuItem('좌표축', 'menuitemcheckbox', () => this.toggleAxes()),
      sim: menuItem('소재 깎기', 'menuitemcheckbox', () => void this.setSim()),
    };
    const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '보기 도구' });
    const add = (key: string, el: HTMLButtonElement, run: () => void, needsDoc = true): HTMLButtonElement => {
      el.addEventListener('click', run);
      this.tools[key] = { el, needsDoc };
      toolbar.append(el);
      return el;
    };
    // 좁은 화면(휴대폰)에서는 wide-only를 숨기고 narrow-only("보기 설정" 메뉴)로 모은다(styles.css)
    const sep = (cls = ''): HTMLSpanElement => {
      const s = h('span', { class: `tb-sep ${cls}`.trim(), 'aria-hidden': 'true' });
      toolbar.append(s);
      return s;
    };
    add('fit', tbtn('fit', '전체 보기', '전체 보기 (F)'), () => this.viewer?.fit());
    toolbar.append(
      this.menu(
        'views',
        tbtn('views', '표준 뷰', '표준 뷰 (1 앞 · 2 뒤 · 3 왼쪽 · 4 오른쪽 · 5 위 · 6 아래 · 7 등각)'),
        VIEW_MENU.map((v) => {
          const key = viewKeyOf(v);
          const b = h('button', { type: 'button', role: 'menuitem' }, h('span', {}, VIEW_LABELS[v]), key ? h('kbd', {}, key) : null);
          b.addEventListener('click', () => this.viewer?.setView(v));
          return b;
        }),
      ),
    );
    toolbar.append(this.moreMenu());
    this.projBtn = add('proj', tbtn('perspective', '원근', '투영: 원근 ↔ 평행', 'wide-only'), () => this.setProjection(this.projection === 'perspective' ? 'orthographic' : 'perspective'));
    sep('wide-only');
    toolbar.append(
      this.menu(
        'render',
        tbtn('render', '그리기', '그리기 모드: 음영 · 음영+모서리 · 와이어프레임 · X-ray'),
        [
          ...RENDER_MODES.map(([m, label]) => {
            const b = h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': 'false' }, h('span', {}, label));
            b.addEventListener('click', () => this.setRenderMode(m));
            this.renderItems.push({ mode: m, el: b });
            return b;
          }),
          // 소재 깎기(G-code·Heidenhain 문서에만 — 도구 막대를 넓히지 않게 그리기 메뉴에)
          this.simWide[0],
          this.simWide[1],
        ],
        true,
        'wide-only',
      ),
    );
    add('grid', tbtn('grid', '격자', '바닥 격자 (F7)', 'wide-only'), () => this.toggleGrid());
    add('cube', tbtn('cube', '뷰 큐브', '뷰 큐브 보이기', 'wide-only'), () => this.toggleCube());
    add('axes', tbtn('axes', '좌표축', '좌표축 보이기', 'wide-only'), () => this.toggleAxes());
    toolbar.append(this.sectionControl());
    sep();
    add('measure', tbtn('measure', '측정', '두 점 거리·dx·dy·dz (Esc로 지우기)'), () => this.toggleMeasure());
    add('png', tbtn('image', 'PNG 저장', '지금 화면을 PNG 그림으로 저장', 'wide-only'), () => void this.savePng());
    this.playSep = sep();
    this.playBtn = add('play', tbtn('play', '재생', '공구 경로 재생 / 멈춤 (Space)'), () => this.togglePlay());
    sep();
    add('panel', tbtn('panel', '패널', '패널 열기·닫기'), () => this.togglePanel());

    // ── 작업 영역: 3D 보기 + 시작 화면 + 패널 + 덮개 ──
    this.workspace = h('main', { class: 'workspace' });
    this.viewEl = h('div', { class: 'view', hidden: true });
    this.startError = h('div', { class: 'start-error', role: 'alert', hidden: true });
    this.recentList = h('ul', { class: 'recent-list' });
    this.recentCard = this.buildRecent();
    this.startEl = this.buildStart();
    // 143차: 알림은 바뀌는 단계 글 칸만(덮개는 알림 영역이 아님 — role=status는 영역 전체를 읽어 「취소」 버튼 이름까지 읽혔다)
    this.busyStage = h('div', { class: 'busy-stage', role: 'status', 'aria-live': 'polite' }, '여는 중…');
    this.busyBar = h('div', { class: 'bar' });
    // 여는 파일 이름(파일 글 — 번역하지 않는다)
    this.busyName = h('div', { class: 'busy-name', translate: 'no' });
    this.busyCancel = h('button', { class: 'btn small busy-cancel', type: 'button', title: '읽기 멈추기 (Esc) — 열린 문서는 그대로 둡니다' }, '취소');
    this.busyCancel.addEventListener('click', () => this.cancelLoad());
    this.busyEl = h(
      'div',
      { class: 'busy', hidden: true },
      h('div', { class: 'busy-card' }, this.busyStage, h('div', { class: 'progress', 'aria-hidden': 'true' }, this.busyBar), h('div', { class: 'busy-foot' }, this.busyName, this.busyCancel)),
    );
    // ── 측정 띠(좁은 화면·터치에서 측정 중): 안내·결과를 크게 보이고, Esc 대신 다시 재기·끝내기 단추 ──
    this.measureText = h('div', { class: 'mb-text', 'aria-live': 'polite' });
    this.measureClear = h('button', { class: 'mb-btn', type: 'button', title: '찍은 점과 결과 지우기', html: `${icon('reset')}<span>다시 재기</span>` });
    this.measureClear.addEventListener('click', () => {
      this.viewer?.clearMeasure();
      this.refreshBar();
      this.mlock?.schedule();
    });
    const measureClose = h('button', { class: 'mb-btn icon', type: 'button', title: '측정 끝내기', 'aria-label': '측정 끝내기', html: icon('close') });
    measureClose.addEventListener('click', () => this.toggleMeasure(false));
    // 방향 잠금 단추·띠 위 알림·붙잡기 툴팁(measure-lock.ts)은 측정 도구 조각을 받으면 넣는다(installMeasure)
    this.measureActs = h('div', { class: 'mb-acts' }, this.measureClear, measureClose);
    this.measureBar = h('div', { class: 'measure-bar', role: 'group', 'aria-label': '측정', hidden: true }, this.measureText, this.measureActs);
    // 정밀 조준 십자선 층(캔버스 위, 누르기는 받지 않는다)
    this.aimLayer = h('div', { class: 'aim-layer', 'aria-hidden': 'true' });
    // 해석 판단 띠(선반 자동·소수점 없는 좌표·판별한 방언). 198차: 알림 영역이 아니다 — 새로 나온 줄의 글은 미리 붙여 둔 알림 영역(said)이 알린다(renderNotices)
    this.noticeBar = h('div', { class: 'notice-bar', hidden: true });
    this.playStrip = this.buildPlayStrip();
    this.viewEl.append(this.aimLayer, this.measureBar, this.noticeBar, this.playStrip.el);
    // 알림은 3D 보기 아래쪽 띠(해석 판단·재생·측정) 위로 올린다 — 띠가 나타나거나 크기가 바뀌면 다시 잰다
    // 측정 중이면 코어 거리 글상자가 비킬 띠·뷰 큐브 자리도 다시 넘긴다(3D 보기 크기가 바뀌면 오른쪽 위 뷰 큐브가 옮는다 — measure-lock.ts coverRects)
    if (typeof ResizeObserver !== 'undefined') {
      const ro = (this.bandRo = new ResizeObserver(() => {
        this.liftToasts();
        this.mlock?.schedule();
      }));
      for (const el of [this.noticeBar, this.playStrip.el, this.measureBar, this.viewEl]) ro.observe(el);
    }
    this.workspace.append(this.viewEl, this.startEl);
    this.panel = new NcPanel(this, this.workspace);
    this.workspace.append(this.busyEl);

    // ── 상태 막대 ──
    this.stMain = h('span', { class: 'st-main' });
    // 고른 것 요약의 풍선 글은 그릴 때 옮겨 넣는다(파일 글 자리 — renderStatus)
    this.stSel = h('span', { class: 'st-sel', 'data-i18n-keep': 'title' });
    this.stWarn = h('button', { class: 'st-warn', type: 'button', hidden: true, title: '해석 경고 보기(패널 정보 탭)' });
    this.stWarn.addEventListener('click', () => this.showInfoTab());
    const status = h('footer', { class: 'statusbar', 'aria-live': 'polite' }, this.stMain, this.stWarn, this.stSel);

    this.dropMask = h('div', { class: 'dropmask', hidden: true, 'aria-hidden': 'true' }, h('div', { html: `${icon('drop')}<span>놓으면 엽니다</span>` }));

    root.textContent = '';
    root.classList.add('no-doc');
    // 198차: 판단 띠·그래픽 잃음 알림 영역도 빈 채로 지금(작업 영역 밖 — 절대 자리라 #app 격자 칸을 차지하지 않는다)
    root.append(titlebar, toolbar, this.workspace, status, this.fileInput, this.dropMask, (this.said = h('div', { class: 'app-live', role: 'status', 'aria-live': 'polite', style: LIVE_HIDDEN })));
    // 156차: 알림 상자(aria-live)는 빈 채로 지금 붙여 둔다 — 첫 알림 때 상자째 붙이면 그 첫 안내를 화면 읽기 프로그램이 읽지 않을 수 있다(dom.ts toastArea)
    toastArea();
    // 208차: 알림 ✕·동작 버튼으로 마지막 알림이 빠지면 180·182차 덮개 「취소」 차례의 남는 칸으로 — 받는 첫 칸이라 읽는 중이면 「취소」(작업 영역은 inert),
    // 문서가 있으면 3D 보기, 없으면 시작 화면 열기 칸(dom.ts toast)
    toastSpare(() => [this.busyCancel, this.viewer?.canvas, this.startEl.querySelector<HTMLElement>('.dropzone')]);

    this.bindDrop();
    window.addEventListener('keydown', (ev) => this.onKey(ev), true);
    // Shift 방향 잠금은 코어가 잠그고 푼다(캔버스 키·onKey가 넘기는 창 키·포인터 이동의 shiftKey). 앱은 누르고 뗄 때 툴팁·상태 줄만 맞춘다
    // (캡처 단계 — 캔버스의 코어 키 듣기가 전파를 막아도 받는다). 원호 접선은 onKey가 코어보다 먼저 잠그고(shiftDown), 떼면 여기서 푼다
    for (const type of ['keydown', 'keyup'] as const)
      window.addEventListener(
        type,
        (ev) => {
          if (ev.key !== 'Shift' || ev.repeat || !this.mlock) return;
          if (type === 'keyup') this.mlock.shiftUp();
          this.mlock.schedule();
        },
        true,
      );
    window.addEventListener('blur', () => {
      this.mlock?.shiftUp();
      this.mlock?.schedule();
    });
    // 펼친 메뉴·단면 상자는 바깥을 누르거나 152차: 초점이 바깥으로 가면(Tab으로 나감 등 — 메뉴·상자와 그 버튼 밖) 닫는다.
    // 열린 채 남으면 다른 칸의 Esc를 창 키가 닫기로 먼저 가져가 초점을 그 버튼으로 옮기고, 측정 방향 잠금 화살표도 걸리지 않았다
    for (const type of ['pointerdown', 'focusin'] as const)
      document.addEventListener(type, (ev) => {
        if (this.openMenu && !this.openMenu.wrap.contains(ev.target as Node)) this.closeMenu();
      });
    try {
      window.matchMedia(PHONE_QUERY).addEventListener('change', () => {
        // 넓은 화면 ↔ 휴대폰: 막대 단추가 바뀌므로 펼친 메뉴를 닫는다
        // 153차: 초점이 닫는 메뉴·상자(그 버튼 포함) 안이나 이 폭에서 숨는 칸(styles.css — 막대의 폭 전용 버튼, 마우스 기기의 측정 띠)에 있으면
        // HTML focus fixup이 문서로 보낸다 — 연 버튼이 이 폭에도 보이면 그리로(Esc와 같은 곳), 아니면 3D 보기로(138차). 초점이 그 밖이면 그대로
        const had = document.activeElement;
        const wrap = this.openMenu?.wrap;
        this.closeMenu();
        const gone = isPhone() ? '.toolbar .wide-only' : `.toolbar .narrow-only${this.coarse?.matches ? '' : ', .measure-bar'}`;
        const btn = wrap?.contains(had) ? wrap.querySelector('button') : null;
        if (btn && !btn.closest(gone)) btn.focus();
        else if (btn || had?.closest(gone)) this.viewer?.canvas.focus({ preventScroll: true });
        this.viewer?.setViewCubeSize(this.cubeSizeFor());
        this.mlock?.schedule();
      });
      // 마우스를 잇거나 뗀 태블릿: 파일 고르기와 안내 글을 다시 맞춘다
      this.coarse?.addEventListener('change', () => {
        this.syncAccept();
        this.renderStatus();
        this.panel.onMeasure();
      });
    } catch {
      /* matchMedia가 없는 환경 */
    }
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!readThemePref(this.storage)) this.setTheme(resolveTheme(null, this.systemDark()));
      });
    } catch {
      /* matchMedia가 없는 환경 */
    }

    this.applyThemeUi();
    this.renderToolbar();
    this.renderStatus();
    this.exposeApi();
    this.ready = true;
    void this.renderRecent();
    void this.startFromUrl();
  }

  // ───────────────────────── 화면 조각 ─────────────────────────

  private systemDark(): boolean {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return true;
    }
  }

  private buildStart(): HTMLDivElement {
    const open = h('button', { class: 'tbtn primary big', type: 'button', html: `${icon('open')}<span>파일 열기</span>` });
    open.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.chooseFile();
    });
    const sample = h('button', { class: 'tbtn big outline', type: 'button', html: `${icon('sample')}<span>예제 열기</span>` });
    sample.addEventListener('click', (ev) => {
      ev.stopPropagation();
      void this.openSample();
    });
    const zone = h(
      'div',
      { class: 'dropzone', role: 'button', tabindex: 0, 'aria-label': 'NC 파일 열기 — 눌러서 고르거나 끌어다 놓기' },
      h('div', { class: 'dz-icon', html: icon('drop') }),
      // 손가락 기기에는 끌어다 놓기가 없으니 고르기 안내로(styles.css fine-only·coarse-only)
      h('p', { class: 'dz-title fine-only' }, 'NC 파일을 여기에 끌어다 놓으십시오'),
      h('p', { class: 'dz-sub fine-only' }, '창 어디에 놓아도 열립니다. 주 프로그램과 부프로그램 파일을 함께 놓으면 한 작업으로 읽습니다.'),
      h('p', { class: 'dz-title coarse-only' }, 'NC 파일을 골라 여십시오'),
      h('p', { class: 'dz-sub coarse-only' }, '주 프로그램과 부프로그램 파일을 함께 고르면 한 작업으로 읽습니다.'),
      h('div', { class: 'dz-actions' }, open, sample),
    );
    zone.addEventListener('click', () => this.chooseFile());
    zone.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.chooseFile();
      }
    });
    const fmt = (name: string, exts: string[], note: string): HTMLElement =>
      h('div', { class: 'fmt' }, h('dt', {}, name), h('dd', {}, h('span', { class: 'exts' }, extensionList(exts)), h('span', { class: 'note' }, note)));
    return h(
      'div',
      { class: 'start' },
      h(
        'div',
        { class: 'start-card' },
        h('h2', {}, 'NC 프로그램을 3D 공구 경로로 봅니다'),
        h('p', { class: 'lead' }, 'G-code·Heidenhain 대화식·woodWOP MPR·WangShi PGI·XML 파일을 열면 공구 경로를 돌려 보고, 코드 줄과 이동을 함께 짚고, 가공 순서를 재생할 수 있습니다.'),
        zone,
        this.startError,
        this.recentCard,
        h(
          'dl',
          { class: 'formats', 'aria-label': '지원 형식' },
          fmt('G-code', GCODE_EXTENSIONS, 'ISO·Fanuc·LinuxCNC·GRBL·Mach3 형식 자동 판별, 원호·나선, 고정 사이클, 부프로그램, 변수, 좌표 회전·배율·거울, 반경 보정 경로·선반·회전축(선택)'),
          fmt('Heidenhain 대화식', HEIDENHAIN_EXTENSIONS, 'BLK FORM 공작물, TOOL CALL, L·C·CR·CT·FK, 드릴·포켓 사이클, Q 변수'),
          fmt('woodWOP MPR', MPR_EXTENSIONS, '판, 수직·수평 드릴, 윤곽 가공, 홈, 포켓, 엣지 밴딩, 변수'),
          fmt('WangShi PGI · XML', [...PGI_EXTENSIONS, ...XML_EXTENSIONS], '판·외곽선, 여섯 면 구멍, 도어 컵, 톱 홈, 사각·원형 포켓, 경로(bulge 호), 변수'),
        ),
        h('p', { class: 'privacy', html: `${icon('lock')}<span><b>파일은 이 브라우저 밖으로 나가지 않습니다.</b> 서버로 올리지 않고 이 기기 안에서 읽습니다.</span>` }),
        h('p', { class: 'keys fine-only' }, '키: F 전체 보기 · 1~7 표준 뷰 · F7 격자 · Space 재생/멈춤 · Enter 가상 커서 · Esc 고른 것 지우기 · Shift 측정 중 방향 잠금 · Ctrl+O 열기'),
        h('p', { class: 'keys coarse-only' }, '한 손가락 끌기 회전 · 두 손가락 이동·확대 · 측정 중 길게 누르면 정밀 조준'),
      ),
    );
  }

  /** 시작 화면의 최근 문서 카드(목록은 renderRecent가 채운다. 비어 있으면 숨긴다) */
  private buildRecent(): HTMLElement {
    const clear = h('button', { class: 'tbtn outline recent-clear', type: 'button', title: '최근 문서 목록을 모두 지웁니다(원래 파일은 그대로)' }, '모두 지우기');
    clear.addEventListener('click', () => void this.clearRecent());
    return h(
      'section',
      { class: 'recent', 'aria-labelledby': 'recent-title', hidden: true },
      h('div', { class: 'recent-head' }, h('h3', { id: 'recent-title' }, '최근 문서'), clear),
      this.recentList,
      h('p', { class: 'recent-note' }, '최근 문서는 이 기기의 이 브라우저에만 저장하며 서버로 보내지 않습니다.'),
    );
  }

  /** 최근 문서 목록을 다시 그린다(새것이 먼저). 비었거나 저장소를 못 쓰면 카드를 숨긴다 */
  async renderRecent(): Promise<void> {
    const seq = ++this.recentSeq;
    const list = await this.recent.list();
    if (seq !== this.recentSeq) return;
    const now = Date.now();
    const lang = document.documentElement.lang || 'ko';
    this.recentList.replaceChildren(...list.map((e) => this.recentRow(e, now, lang)));
    this.recentCard.hidden = !list.length;
  }

  private recentRow(e: RecentEntry, now: number, lang: string): HTMLLIElement {
    // 파일 이름·크기·시각은 문서 자료라 번역하지 않는다(translate="no")
    const open = h(
      'button',
      { class: 'recent-open', type: 'button' },
      h('span', { class: 'recent-name', translate: 'no' }, e.name),
      // 여러 파일 작업이면 파일 수(번역되는 글), 크기·시각은 화면 언어 형식 그대로
      e.files ? h('span', { class: 'recent-files' }, `파일 ${e.files}개 작업`) : null,
      h('span', { class: 'recent-meta', translate: 'no' }, `${formatBytes(e.size)} · ${formatRecentTime(e.time, now, lang)}`),
    );
    open.addEventListener('click', () => void this.openRecent(e));
    // 파일 이름 자리를 지켜 옮겨 넣는다(언어를 바꾸면 다시 그린다)
    const label = mixText(mix`최근 문서에서 ${fileText(e.name)} 지우기`);
    const del = h('button', { class: 'recent-del', type: 'button', title: label, 'aria-label': label, 'data-i18n-keep': 'title aria-label', html: icon('close') });
    del.addEventListener('click', () => void this.removeRecent(e.id));
    return h('li', { class: 'recent-item' }, open, del);
  }

  /** 펼침 메뉴(표준 뷰·그리기 모드·보기 설정). entries에는 단추와 구분선(.menu-sep)을 섞어 넣는다 */
  private menu(key: string, button: HTMLButtonElement, entries: HTMLElement[], needsDoc = true, cls = ''): HTMLElement {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.insertAdjacentHTML('beforeend', `<span class="caret">${icon('chevron')}</span>`);
    const items = entries.filter((e): e is HTMLButtonElement => e.tagName === 'BUTTON');
    const list = h('div', { class: 'menu', role: 'menu', hidden: true });
    list.append(...entries);
    const wrap = h('div', { class: `menu-wrap ${cls}`.trim() }, button, list);
    const close = () => {
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (this.openMenu?.wrap === wrap) this.openMenu = null;
    };
    button.addEventListener('click', () => {
      if (!list.hidden) {
        close();
        return;
      }
      this.closeMenu();
      list.hidden = false;
      list.style.left = '0px';
      list.style.maxHeight = '';
      button.setAttribute('aria-expanded', 'true');
      this.openMenu = { wrap, close };
      // 화면 오른쪽 밖으로 나가지 않게
      const r = list.getBoundingClientRect();
      const vp = viewportSize();
      const over = r.right - (vp.width - 8);
      if (over > 0) list.style.left = `${-over}px`;
      // 아래가 모자라면(휴대폰 가로 등) 메뉴 안에서 굴린다
      if (r.bottom > vp.height - 8) list.style.maxHeight = `${Math.max(120, vp.height - r.top - 8)}px`;
      // 고른 하나(radio)에 초점 — 171차: 켜고 끄는 항목(checkbox)은 빼서 설정 메뉴는 켜 둔 한 글자 단축키 항목이 아닌 첫 항목에서 연다(다른 메뉴는 radio가 앞이라 그대로)
      const checked = list.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
      (checked ?? items[0])?.focus();
    });
    list.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('button')) {
        close();
        button.focus();
      }
    });
    list.addEventListener('keydown', (ev) => {
      // 151차 APG Menu: Tab·Shift+Tab은 메뉴를 닫는다(기본 동작은 막지 않음 — 닫힌 항목은 초점 차례에서 빠져 다음 칸·메뉴 버튼으로 간다)
      if (ev.key === 'Tab') return close();
      // 숨긴 항목(문서에 따라 — 소재 깎기)은 건너뛴다
      const shown = items.filter((b) => !b.hidden);
      const n = shown.length;
      const i = shown.indexOf(document.activeElement as HTMLButtonElement);
      // ↓↑는 끝에서 둘레를 돌고, 151차: Home·End는 처음·끝 항목(창 키 onKey는 이 둘을 흘려보낸다)
      const j = ev.key === 'ArrowDown' ? (i + 1) % n : ev.key === 'ArrowUp' ? (i + n - 1) % n : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : -1;
      if (j < 0) return;
      ev.preventDefault();
      shown[j]?.focus();
    });
    this.tools[key] = { el: button, needsDoc };
    return wrap;
  }

  /**
   * 열린 메뉴·단면 상자를 닫는다. 209차(WCAG 2.4.3): back이면 초점이 닫는 메뉴·상자(그 버튼 포함) 안이었을 때만 그 버튼으로(Esc·206차와 같은 곳) — 열기 길(openBuffer·openRecent)이 닫으면
   * 메뉴 항목에서 Ctrl+O로 고른 파일·상자 안에서 끌어 놓은 파일이 열리지 않거나 취소될 때 숨은 칸의 초점이 문서로 빠졌다. 열리면 새 문서가 3D 보기로 옮긴다(setDoc)
   */
  private closeMenu(back = false): void {
    const w = this.openMenu?.wrap;
    const btn = back && w?.contains(document.activeElement) ? w.querySelector('button') : null;
    this.openMenu?.close();
    this.openMenu = null;
    btn?.focus();
  }

  /** 좁은 화면의 "보기 설정" 메뉴: 넓은 화면 도구 막대에만 있는 투영·그리기 모드·격자·뷰 큐브·좌표축·PNG 저장 */
  private moreMenu(): HTMLElement {
    const line = (): HTMLDivElement => h('div', { class: 'menu-sep', role: 'separator' });
    const m = this.moreItems;
    const render = RENDER_MODES.map(([mode, label]) => {
      const el = menuItem(label, 'menuitemradio', () => this.setRenderMode(mode));
      this.renderItems.push({ mode, el });
      return el;
    });
    return this.menu(
      'more',
      tbtn('sliders', '보기 설정', '보기 설정'),
      [m.proj.perspective, m.proj.orthographic, line(), ...render, line(), m.grid, m.cube, m.axes, m.sim, line(), menuItem('PNG 저장', 'menuitem', () => void this.savePng())],
      true,
      'narrow-only',
    );
  }

  /** 단면 보기 펼침 상자: 축(끔·X·Y·Z), 위치 슬라이더, 뒤집기 */
  private sectionControl(): HTMLElement {
    const btn = tbtn('section', '단면', '단면 보기: 자를 축(X·Y·Z)·위치·뒤집기');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.insertAdjacentHTML('beforeend', `<span class="caret">${icon('chevron')}</span>`);
    const axes = ([null, 'x', 'y', 'z'] as const).map((axis) => {
      const el = h('button', { type: 'button', class: 'seg', 'aria-pressed': 'false', title: axis ? `${axis.toUpperCase()}축에 수직인 평면으로 자르기` : '단면 끄기' }, axis ? axis.toUpperCase() : '끔');
      el.addEventListener('click', () => this.setSectionAxis(axis));
      return { axis, el };
    });
    const range = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 500, 'aria-label': '단면 위치', disabled: true });
    // 단추·슬라이더·손잡이는 뷰어의 onSectionChange 알림 하나로 맞춘다
    range.addEventListener('input', () => this.viewer?.setSectionPosition(Number(range.value) / 1000));
    const flip = h('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', title: '잘라 내는 쪽 뒤집기', disabled: true }, '뒤집기');
    flip.addEventListener('click', () => this.viewer?.flipSection());
    const val = h('span', { class: 'sec-val' });
    const panel = h(
      'div',
      { class: 'sec-pop', role: 'dialog', 'aria-label': '단면 보기', hidden: true },
      h('div', { class: 'seg-row', role: 'group', 'aria-label': '자를 축' }, ...axes.map((a) => a.el)),
      h('div', { class: 'sec-row' }, range),
      h('div', { class: 'sec-row' }, val, flip),
    );
    const wrap = h('div', { class: 'menu-wrap' }, btn, panel);
    const close = (): void => {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (this.openMenu?.wrap === wrap) this.openMenu = null;
    };
    btn.addEventListener('click', () => {
      if (!panel.hidden) return close();
      this.closeMenu();
      panel.hidden = false;
      panel.style.left = '0px';
      btn.setAttribute('aria-expanded', 'true');
      this.openMenu = { wrap, close };
      // 화면 밖으로 나가지 않게(휴대폰 폭)
      const r = panel.getBoundingClientRect();
      const over = r.right - (viewportSize().width - 8);
      if (over > 0) panel.style.left = `${-Math.min(over, r.left - 8)}px`;
      (axes.find((a) => a.el.getAttribute('aria-pressed') === 'true') ?? axes[0])!.el.focus();
    });
    this.tools.section = { el: btn, needsDoc: true };
    this.sec = { btn, axes, range, flip, val };
    return wrap;
  }

  /** 단면 축 고르기(null = 끄기). 같은 축이면 위치를 지킨다 */
  setSectionAxis(axis: SectionAxis | null, t?: number, flip?: boolean): void {
    const v = this.viewer;
    if (!v) return;
    if (!axis) v.setSection(null);
    else {
      // 214차: 단면을 켤 때(손잡이가 필요한 때 — 축 고르기 누름마다 한 번, 범위 막대·손잡이 끌기·카메라 알림에는 걸지 않음)에도 받지 못한 3D 보기 띠를 조용히 다시 받는다(uiRetry).
      // 받으면 attach가 지금 켠 단면 자리에 손잡이를 놓는다(아래 setSectionAxis가 같은 차례에 단면을 켠다)
      this.uiRetry?.(true);
      const cur = v.section;
      v.setSectionAxis(axis, t ?? (cur && cur.axis === axis ? cur.t : 0.5), flip === undefined ? {} : { flip });
    }
  }

  /** 단면 UI(단추·슬라이더·값·손잡이)를 뷰어 상태에 맞춘다 — onSectionChange 알림(새 문서에서 꺼짐·손잡이 끌기 포함)에서 부른다 */
  private renderSection(s: SectionState | null = this.viewer?.section ?? null): void {
    const e = this.sec;
    if (!e) return;
    for (const a of e.axes) a.el.setAttribute('aria-pressed', String(s ? s.axis === a.axis : a.axis === null));
    e.range.disabled = !s;
    if (s) e.range.value = String(Math.round(Math.max(0, Math.min(1, s.t)) * 1000));
    e.flip.disabled = !s;
    e.flip.setAttribute('aria-pressed', String(!!s?.flip));
    const u = this.doc?.scene.units === 'inch' ? 'in' : this.doc?.scene.units === 'mm' ? 'mm' : '';
    const pos = s ? `${fmtNum(s.position)}${u ? ` ${u}` : ''}` : '';
    e.val.textContent = s ? `${s.axis ? s.axis.toUpperCase() : '평면'} = ${pos}${s.flip ? ' (뒤집음)' : ''}` : '꺼짐';
    // 140차: 0~1000 막대가 수 대신 그 자리를 읽게 값 글의 축·위치를(패널 재생 막대 꼴). 번역층이 옮기지 않는 속성이라 낱말(평면·뒤집음)은 빼고
    // 꺼지면(막대 막힘) 뺀다 — 뒤집음은 뒤집기 버튼 눌림이 알린다
    if (s) e.range.setAttribute('aria-valuetext', s.axis ? `${s.axis.toUpperCase()} = ${pos}` : pos);
    else e.range.removeAttribute('aria-valuetext');
    e.btn.setAttribute('aria-pressed', String(!!s));
    this.placeSecHandle();
  }

  /** 화면 위 단면 손잡이: 장면 가운데를 평면에 내린 점에 두고, 화살표는 잘라 내는 쪽을 가리킨다 */
  private placeSecHandle(): void {
    const el = this.secHandle;
    if (!el) return;
    const v = this.viewer;
    const hd = v?.section ? v.sectionHandle() : null;
    el.hidden = !hd;
    if (!hd) return;
    el.style.transform = `translate(${hd.x}px, ${hd.y}px)`;
    const arrow = Math.hypot(hd.dx, hd.dy) > 0.2;
    el.classList.toggle('no-dir', !arrow);
    if (arrow) el.style.setProperty('--sec-dir', `${Math.atan2(hd.dy, hd.dx)}rad`);
  }

  // ───────────────────────── 열기 ─────────────────────────

  /** 파일 고르기. add = 열린 작업에 더할 파일(부프로그램 등) */
  chooseFile(add = false): void {
    this.pickAdd = add;
    this.fileInput.click();
  }

  /** 고른 파일 읽기: 모르는 확장자의 이진 파일·읽지 못한 파일은 빼고 이유를 모은다 */
  private async readFiles(files: File[]): Promise<{ ok: { file: File; buf: ArrayBuffer }[]; bad: string[] }> {
    const ok: { file: File; buf: ArrayBuffer }[] = [];
    const bad: string[] = [];
    for (const f of files) {
      try {
        if (!isNcFileName(f.name) && looksBinary(new Uint8Array(await f.slice(0, 4096).arrayBuffer()))) {
          bad.push(f.name);
          continue;
        }
        ok.push({ file: f, buf: await f.arrayBuffer() });
      } catch {
        bad.push(f.name);
      }
    }
    return { ok, bad };
  }

  /**
   * 여러 파일을 한 작업으로 연다: 주 프로그램(다른 파일이 부르지 않고 M30으로 끝나는 파일 — 정보 탭에서 바꾼다) 뒤에
   * 나머지 파일을 잇고, M98·G65 P·CALL PGM·Siemens 이름 부르기를 함께 연 파일에서 찾는다. 최근 문서에는 이은 글을 둔다
   */
  async openFiles(files: File[]): Promise<boolean> {
    if (files.length === 1) return this.openFile(files[0]!);
    const attempt = beginOpen('local', files[0]!.name.split('.').pop() ?? 'other');
    const { ok, bad } = await this.readFiles(files);
    if (!ok.length) {
      this.showError(mix`${fileText(bad.join(', '))}: ${BINARY_MESSAGE}`);
      attempt.error('unsupported');
      return false;
    }
    if (bad.length) toast([mixSpan(mix`읽지 않은 파일: ${fileText(bad.join(', '))}`)], 'info', 6000);
    const [first, ...rest] = ok;
    const opened = await this.openBuffer(
      first!.file.name,
      first!.buf,
      {},
      attempt,
      rest.map((f) => ({ name: f.file.name, bytes: f.buf })),
    );
    if (opened) this.rememberDoc(ok.map((f) => f.file));
    return opened;
  }

  /** 열린 작업(또는 파일 하나)에 파일을 더해 다시 잇는다 — 주 프로그램은 그대로, 같은 이름은 새 파일로 바꾼다 */
  async addFiles(files: File[]): Promise<boolean> {
    const d = this.doc;
    if (!d?.nc) return this.openFiles(files);
    const attempt = beginOpen('local', files[0]?.name.split('.').pop() ?? 'other');
    const { ok, bad } = await this.readFiles(files);
    if (bad.length) toast([mixSpan(mix`읽지 않은 파일: ${fileText(bad.join(', '))}`)], 'info', 6000);
    if (!ok.length) {
      attempt.error('unsupported');
      return false;
    }
    const copy = d.nc.source.bytes.slice().buffer as ArrayBuffer;
    const opened = await this.openBuffer(
      d.name,
      copy,
      { ...d.ncOptions, jobMain: d.name },
      attempt,
      ok.map((f) => ({ name: f.file.name, bytes: f.buf })),
    );
    if (opened) this.rememberDoc([]);
    return opened;
  }

  /**
   * 연 문서를 최근 문서에 둔다: 여러 파일 작업이면 이은 글(다시 열면 같은 작업으로 읽힌다 — 목록에 파일 수를 보인다),
   * 파일 하나만 열렸으면(나머지는 형식이 달라 잇지 않음) 고른 파일 가운데 그 파일 그대로
   */
  private rememberDoc(files: File[]): void {
    const d = this.doc;
    if (!d) return;
    const job = d.job;
    const file = files.find((f) => f.name.replace(/^.*[\\/]/, '') === d.name);
    let saved: Promise<boolean> | null = null;
    if (d.nc && job && job.files.length > 1) saved = this.recent.add(d.name, d.nc.source.bytes.slice().buffer as ArrayBuffer, Date.now(), job.files.length);
    else if (file) saved = this.recent.add(file.name, file);
    void saved?.then((ok) => {
      if (ok) void this.renderRecent();
    });
  }

  async openFile(f: File): Promise<boolean> {
    const attempt = beginOpen('local', f.name.split('.').pop() ?? 'other');
    let buf: ArrayBuffer;
    try {
      // 손가락 기기는 확장자로 거르지 않아(사진·동영상도 고를 수 있다) 모르는 확장자는 앞부분만 먼저 보고 이진 파일을 막는다
      if (!isNcFileName(f.name) && looksBinary(new Uint8Array(await f.slice(0, 4096).arrayBuffer()))) {
        this.showError(mix`${fileText(f.name)}: ${BINARY_MESSAGE}`);
        attempt.error('unsupported');
        return false;
      }
      buf = await f.arrayBuffer();
    } catch (e) {
      this.showError(mix`${fileText(f.name)}: 파일을 읽지 못했습니다(${errorText(e)}).`);
      attempt.error('read_error');
      return false;
    }
    const ok = await this.openBuffer(f.name, buf, {}, attempt);
    // 열린 파일만 최근 문서에 둔다(고른 파일 그대로 — 내용은 워커로 넘겨 비워졌다). 예제·주소로 연 파일은 두지 않는다
    if (ok)
      void this.recent.add(f.name, f).then((saved) => {
        if (saved) void this.renderRecent();
      });
    return ok;
  }

  /**
   * 최근 문서 다시 열기: 이 브라우저에 둔 내용을 읽어(덮개·취소 가능) 연다. 열리면 맨 앞으로.
   * 내용이 없으면 항목을 지우고, 잠깐 못 읽었으면(연결 끊김·메모리 부족 등) 항목을 두고 다시 해 보라고 알린다.
   * 읽는 사이 다른 파일을 열거나 취소하면 읽은 결과는 버린다.
   */
  async openRecent(e: RecentEntry): Promise<boolean> {
    const attempt = beginOpen('local', e.name.split('.').pop() ?? 'other');
    const seq = ++this.loadSeq;
    this.closeMenu(true);
    this.setBusy('최근 문서 읽는 중', 0.02, e.name);
    const r = await this.recent.read(e.id);
    if (seq !== this.loadSeq) return false;
    if (r.kind !== 'ok') {
      this.setBusy(null);
      attempt.error('read_error');
      if (r.kind === 'missing') {
        this.showError(mix`${fileText(e.name)}: 이 브라우저에 저장된 내용을 찾지 못해 최근 문서에서 지웠습니다.`);
        await this.recent.remove(e.id);
        await this.redrawRecent('.recent-open');
      } else this.showError(mix`${fileText(e.name)}: 이 브라우저에 저장된 내용을 읽지 못했습니다. 잠시 뒤 다시 눌러 보십시오.`);
      return false;
    }
    const ok = await this.openBuffer(e.name, r.data, {}, attempt);
    if (ok) {
      await this.recent.touch(e.id);
      await this.renderRecent();
    }
    return ok;
  }

  /** 최근 문서 한 항목 지우기(원래 파일은 그대로). 초점은 다음 항목(없으면 열기 상자)으로 */
  private async removeRecent(id: string): Promise<void> {
    if (!(await this.recent.remove(id))) toast('최근 문서를 지우지 못했습니다. 잠시 뒤 다시 해 보십시오.', 'error', 5000);
    await this.redrawRecent('.recent-del');
  }

  /**
   * 최근 문서 목록을 다시 그린다 — 초점이 있던 줄이 떼어지므로 그 안이었을 때만 다음 항목(모자라면 마지막)의 같은 버튼(sel), 줄이 없으면 열기 상자로.
   * 208차: 이 브라우저에 내용이 없는 줄의 「열기」(openRecent — 그 줄을 지움)도 이 길(전에는 연 버튼째 떼어져 초점이 문서로 빠졌다, WCAG 2.4.3)
   */
  private async redrawRecent(sel: string): Promise<void> {
    const at = [...this.recentList.children].findIndex((li) => li.contains(document.activeElement));
    await this.renderRecent();
    if (at < 0) return;
    const next = this.recentList.children[Math.min(at, this.recentList.children.length - 1)];
    (next?.querySelector<HTMLElement>(sel) ?? this.startEl.querySelector<HTMLElement>('.dropzone'))?.focus();
  }

  private async clearRecent(): Promise<void> {
    const ok = await this.recent.clear();
    await this.renderRecent();
    if (!ok) {
      toast('최근 문서를 지우지 못했습니다. 잠시 뒤 다시 해 보십시오.', 'error', 5000);
      return;
    }
    this.startEl.querySelector<HTMLElement>('.dropzone')?.focus();
    toast('최근 문서를 모두 지웠습니다.', 'info', 2500);
  }

  async openSample(): Promise<boolean> {
    const attempt = beginOpen('sample', 'nc');
    // 예제 글을 만드는 코드는 누를 때 받는다(첫 화면 JS에서 뺀다 — 54차, 오프라인 앱은 서비스 워커가 미리 담아 둔다)
    let sample: typeof import('../view/sample');
    try {
      sample = await import('../view/sample');
    } catch (e) {
      this.showError(errorText(e));
      attempt.error('fetch_error');
      return false;
    }
    const bytes = new TextEncoder().encode(sample.ncSampleProgram());
    return this.openBuffer(sample.NC_SAMPLE_NAME, bytes.buffer as ArrayBuffer, {}, attempt);
  }

  /** 같은 출처 주소에서 받아 연다(?open=) */
  async openUrl(url: string, name?: string): Promise<boolean> {
    const attempt = beginOpen('url', (name ?? url.split(/[?#]/)[0]!).split('.').pop() ?? 'other');
    const label = name || url.replace(/[?#].*$/, '').replace(/^.*\//, '') || 'program.nc';
    const seq = ++this.loadSeq;
    this.setBusy('파일 받는 중', 0.01, label);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`파일을 받지 못했습니다(HTTP ${r.status}).`);
      // 없는 주소에 시작 페이지를 돌려주는 서버(개발 서버 등)를 거른다
      if (/text\/html/i.test(r.headers.get('content-type') ?? '')) throw new Error('파일 대신 웹 페이지가 왔습니다. 주소가 맞는지 확인하십시오.');
      const buf = await r.arrayBuffer();
      if (seq !== this.loadSeq) return false;
      return await this.openBuffer(label, buf, {}, attempt);
    } catch (e) {
      if (seq === this.loadSeq) {
        this.setBusy(null);
        // 199차: 까닭은 따로 옮겨지게 글 마디마다(31차 꼴) — 「이름: 까닭」을 한 글로 이으면 맞는 사전 틀이 없어 다른 언어에서도 통째 한국어로 남았다
        this.showError([fileText(label), ': ', errorText(e)], true);
        attempt.error('fetch_error');
      }
      return false;
    }
  }

  /** 파일 열기(data는 워커로 이전되어 비워진다). 열었으면 true */
  async openBuffer(
    name: string,
    data: ArrayBuffer,
    opts: NcOpenOptions = {},
    attempt: OpenAttempt = beginOpen('local', name.split('.').pop() ?? 'other'),
    extra: { name: string; bytes: ArrayBuffer }[] = [],
  ): Promise<boolean> {
    const seq = ++this.loadSeq;
    const size = data.byteLength + extra.reduce((n, f) => n + f.bytes.byteLength, 0);
    this.closeMenu(true);
    this.setBusy('여는 중', 0.02, name);
    // 첫 문서면 3D 뷰어 코어를 해석과 함께 받기 시작한다(실패는 ensureViewer가 알린다)
    if (!this.viewer) void loadViewerCore().catch(() => undefined);
    // 측정 도구 조각도 함께(측정에서만 쓰여 첫 화면 JS에서 뺐다 — 받는 대로 만든다. 받지 못하면 측정을 켤 때 다시 받고 알린다)
    if (!this.mlock) void this.ensureMeasureTools().catch(() => undefined);
    try {
      const res = await this.client.open(
        name,
        data,
        { ...opts, ...settingsOpenOptions(this.settings) },
        (f, stage) => {
          if (seq === this.loadSeq) this.setBusy(stage, f, name);
        },
        extra,
      );
      if (seq !== this.loadSeq) return false;
      if (!sceneHasGeometry(res.scene)) {
        attempt.error('empty');
        // 안내 글과 첫 해석 경고(줄·글)를 조각마다 따로 번역되게(doc.ts emptyProgramParts — 파일 이름은 옮기지 않는다)
        this.showError([fileText(name), ': ', ...emptyProgramParts(res)], true);
        return false;
      }
      await this.ensureViewer();
      if (seq !== this.loadSeq) return false;
      // 182차: 결과를 넣기 전에 덮개를 걷는다(inert를 거두고 초점을 뜰 때 자리로 — finally의 걷기는 그대로) — 새 문서의 3D 보기 초점(setDoc)이 inert에 막히지 않게
      this.setBusy(null);
      // 여러 파일 작업이면 이름 = 주 프로그램, 크기 = 이은 글
      this.setDoc(createDoc(res.job?.main ?? name, res.job && res.nc ? res.nc.source.bytes.length : size, res, opts));
      attempt.success();
      return true;
    } catch (e) {
      if (seq === this.loadSeq) {
        // 「NC 프로그램으로 보이지 않습니다」·빈 파일·판재 파일 오류 등 까닭은 따로 옮겨지게 글 마디마다(199차 — 위 openUrl과 같음)
        this.showError([fileText(name), ': ', errorText(e)], true);
        attempt.error('parse_error');
      }
      return false;
    } finally {
      if (seq === this.loadSeq) this.setBusy(null);
    }
  }

  /** 방언·단위를 바꿔 다시 읽기(G-code) */
  async reparse(opts: NcOpenOptions): Promise<void> {
    const d = this.doc;
    if (!d) return;
    let copy: ArrayBuffer;
    if (d.nc) copy = d.nc.source.bytes.slice().buffer as ArrayBuffer;
    else if (d.mpr) copy = new TextEncoder().encode(`${d.mpr.lines.join('\n')}\n`).buffer as ArrayBuffer;
    else return;
    // 단위·선반·회전축을 바꾸면 모양이 달라지므로 카메라를 새로 맞춘다
    const unitsChanged =
      (opts.units ?? 'mm') !== (d.ncOptions.units ?? 'mm') ||
      opts.lathe !== d.ncOptions.lathe ||
      opts.latheSystem !== d.ncOptions.latheSystem ||
      !!opts.rotary !== !!d.ncOptions.rotary ||
      !!opts.integerUnits !== !!d.ncOptions.integerUnits ||
      (opts.jobMain ?? d.name) !== (d.ncOptions.jobMain ?? d.name);
    const seq = ++this.loadSeq;
    this.setBusy('다시 읽는 중', 0.05, d.name);
    try {
      const res = await this.client.open(d.name, copy, { ...opts, ...settingsOpenOptions(this.settings) }, (f, stage) => {
        if (seq === this.loadSeq) this.setBusy(stage, f, d.name);
      });
      if (seq !== this.loadSeq || this.doc !== d) return;
      if (!sceneHasGeometry(res.scene)) throw new Error('이 설정으로는 그릴 공구 경로가 없습니다.');
      // 182차: 결과를 넣기 전에 덮개를 걷는다(openBuffer와 같음) — 패널 칸(137차)·판단 띠(176차) 초점 되살림이 inert에 막히지 않게
      this.setBusy(null);
      this.stopPlay();
      const cam = !unitsChanged ? this.viewer?.getCamera() : null;
      replaceResult(d, res, opts);
      this.sim?.docChanged(d);
      this.error = null;
      this.applyDoc(d, cam ?? null);
      this.panel.show(d);
      this.panel.setOpen(this.panelOpen);
      this.renderToolbar();
      this.renderStatus();
      this.renderNotices();
      // 178차: 다시 읽으면 재생을 멈추고 재생 자리를 지운다(replaceResult) — 재생 띠도 맞춘다
      this.refreshPlayStrip();
      toast([mixSpan(mix`${fileText(d.name)}: 다시 읽었습니다.`)], 'info', 2500);
    } catch (e) {
      if (seq === this.loadSeq) this.showError(mix`${fileText(d.name)}: 다시 읽지 못했습니다 — ${errorText(e)}`);
    } finally {
      if (seq === this.loadSeq) this.setBusy(null);
    }
  }

  /** 기계·읽기 설정을 바꾼다(기억하고, 해석에 쓰는 값이 바뀌었으면 지금 프로그램을 다시 읽는다) */
  setSettings(s: NcSettings): void {
    const before = this.settings;
    this.settings = s;
    saveSettings(s);
    const d = this.doc;
    if (d?.nc && settingsNeedReparse(before, s)) void this.reparse(d.ncOptions);
    else if (d) this.applyPlayback(d);
  }

  private async startFromUrl(): Promise<void> {
    // 홈 화면 앱(공용 도구): 오프라인 서비스 워커와 새 판 알림(배포 빌드만 — 앱으로 돌아오면 새 판 확인),
    // 데스크톱 "연결 프로그램"으로 연 파일(여럿이면 한 작업으로). 언어 페이지는 <base href="../">라 document.baseURI가 앱 뿌리다
    if (!import.meta.env.DEV && canUseServiceWorker(location, navigator))
      void registerServiceWorker(navigator.serviceWorker as unknown as SwContainer, new URL('sw.js', document.baseURI),
        (apply) => toast('새 버전이 있습니다.', 'info', 60_000, { label: '새로 고침', run: apply }), undefined, { onVisible: whenVisible });
    consumeLaunchFiles((files) => void (files.length > 1 ? this.openFiles(files) : this.openFile(files[0]!)));
    // 다른 웹페이지에 넣었을 때(iframe) 부모 페이지가 넘기는 파일(여럿이면 한 작업으로) — 열기를 마치면 풀리는 Promise를 돌려줘 부모가 끝을 안다
    acceptEmbeddedFiles((files) => (files.length > 1 ? this.openFiles(files) : this.openFile(files[0]!)), { accept: EMBED_ACCEPT });
    // 공유 받기(?recent=·?share=·?share-error=)는 한 번만: 주소에서 지운다(다시 읽어도 또 열지 않게)
    const once = parseOnceParams(location.search);
    if (once.recent || once.share || once.shareError) {
      try {
        history.replaceState(history.state, '', withoutOnceParams(location.href));
      } catch {
        /* 주소를 못 바꾸는 환경 */
      }
    }
    if (once.shareError) toast(shareErrorText(once.shareError), 'error', 8000);
    if (once.recent) return void (await this.openRecentId(once.recent));
    if (once.share) return void (await this.openShared(once.share));
    const req = parseStartParams(location.search, location.href);
    if (!req) return;
    if (req.kind === 'error') this.showError(req.message);
    else if (req.kind === 'sample') await this.openSample();
    else await this.openUrl(req.url, req.name);
  }

  /** 최근 문서 하나를 열쇠로 연다(공유 받은 파일 하나 — 서비스 워커가 넣었다) */
  async openRecentId(id: string): Promise<boolean> {
    const e = (await this.recent.list()).find((x) => x.id === id);
    if (e) return this.openRecent(e);
    this.showError('공유한 파일을 이 브라우저에서 찾지 못했습니다. 열기로 직접 여십시오.');
    return false;
  }

  /** 공유 받은 여러 파일(한 작업으로)·큰 파일을 연다 — 한 번 쓸 자리는 읽으면 지우고, 연 것은 파일을 고른 것처럼 최근 문서에 둔다 */
  async openShared(key: string): Promise<boolean> {
    const r = await this.recent.takeShare(key);
    if (r.kind !== 'ok') {
      this.showError(r.kind === 'missing' ? '공유한 파일을 이 브라우저에서 찾지 못했습니다. 열기로 직접 여십시오.' : '공유한 파일을 읽지 못했습니다. 열기로 직접 여십시오.');
      return false;
    }
    return r.files.length > 1 ? this.openFiles(r.files) : this.openFile(r.files[0]!);
  }

  /** 읽기(받기·해석)를 멈춘다: 워커를 끝내고 앞 문서는 그대로 둔다 */
  cancelLoad(): boolean {
    if (!this.busy) return false;
    this.loadSeq++;
    this.client.cancel();
    this.setBusy(null);
    toast(this.doc ? '읽기를 멈췄습니다 — 열린 문서는 그대로 둡니다.' : '읽기를 멈췄습니다.', 'info', 3000);
    return true;
  }

  /** 패널 정보 탭(해석 경고)을 연다 */
  private showInfoTab(): void {
    const d = this.doc;
    if (!d) return;
    d.panelTab = 'info';
    this.panel.show(d);
    this.togglePanel(true);
    requestAnimationFrame(() => this.panel.el.querySelector('.warn-list')?.scrollIntoView({ block: 'nearest' }));
  }

  private setBusy(stage: string | null, fraction = 0, name = ''): void {
    const shown = stage !== null && this.busyEl.hidden;
    const had = document.activeElement;
    const was = this.busy;
    this.busy = stage !== null;
    this.stage = stage ?? '';
    this.busyEl.hidden = !this.busy;
    this.root.classList.toggle('is-busy', this.busy);
    // 182차: 덮개가 덮는 자리(작업 영역의 덮개 밖 칸 — 3D 보기·시작 화면·패널)를 덮개 동안 inert로 — 덮개가 초점을 가두지 않아 Tab이 덮개 밑 판단 띠·패널 칸에 닿고 눌려
    // 읽던 파일을 버리고 앞 문서를 다시 읽었다(WCAG 2.4.3). 숨을 때는 먼저 거두고 그다음 띠·초점. 뜰 때 초점이 그 안이면 「취소」로(inert 칸의 초점은 문서로 빠진다 — 걷히면 아래에서 돌려준다)
    if (was !== this.busy) {
      for (const el of this.workspace.children) if (el !== this.busyEl) el.toggleAttribute('inert', this.busy);
      if (this.busy) {
        this.busyFrom = this.workspace.contains(had) && !this.busyEl.contains(had) ? (had as HTMLElement) : null;
        if (this.busyFrom) this.busyCancel.focus({ preventScroll: true });
      }
    }
    this.refreshBar();
    // 181차: 덮개를 보이거나 숨길 때 재생 띠·따라가기 띠도 맞춘다(두 띠 조건에 덮개 — 덮개 밑에 비쳐 Tab으로 닿고 눌려 읽는 중에 재생·따라가기가 돌았다).
    // 숨을 때는 띠가 먼저 다시 보이고 그다음 아래 「취소」 초점. 단계·진척만 바뀌는 잦은 부름은 건너뛴다
    if (was !== this.busy) this.refreshPlayStrip();
    if (!this.busy) {
      this.busyHold = null;
      // 180차: 「취소」(덮개의 초점 칸)에 초점이 있는 채 덮개가 숨으면(취소·다시 읽기 끝·실패) 초점이 문서로 빠진다 — 덮개 안이었을 때만
      // 열린 문서가 있으면 3D 보기, 없으면 시작 화면 열기 칸으로(153차 차례의 남는 칸). 새 문서는 setDoc이 3D 보기로 두고, 밖이면 그대로
      // 182차: 뜰 때 덮개 밑에서 옮겨 온 초점이면 그 칸이 붙어 있고 숨지 않았을 때 그리로(취소·Esc·못 읽음은 전처럼 그 자리)
      const from = this.busyFrom;
      this.busyFrom = null;
      if (this.busyEl.contains(had)) (from?.isConnected && !from.closest('[hidden]') ? from : this.doc && this.viewer ? this.viewer.canvas : this.startEl.querySelector<HTMLElement>('.dropzone'))?.focus({ preventScroll: true });
      return;
    }
    // 줄임표는 따로 둔다(단계 글만 번역 사전에서 찾게)
    const put = (): void => this.busyStage.replaceChildren(document.createTextNode(this.stage), document.createTextNode('…'));
    // 155차: 숨었던 덮개를 보이는 차례에는 단계 칸(role=status)을 줄 바꿈 없는 빈칸으로 두고(줄 높이·카드 크기 그대로) 한 번 그린 뒤 글을 넣는다 — 숨은 칸은 접근성 트리에 없어
    // 숨김을 푸는 같은 차례에 넣은 첫 글을 화면 읽기 프로그램이 읽지 않을 수 있다(STEP 157차). rAF는 그 프레임을 그리기 전이라 그 뒤 타이머.
    // 그사이 닫거나 다시 열었으면 넣지 않고, 다음 단계가 왔으면 그 글을 넣는다
    if (shown) {
      const hold = (this.busyHold = {});
      this.busyStage.textContent = ' ';
      requestAnimationFrame(() =>
        setTimeout(() => {
          if (this.busyHold !== hold) return;
          this.busyHold = null;
          put();
        }),
      );
    } else if (!this.busyHold) put();
    this.busyBar.style.width = `${Math.round(Math.max(0.02, Math.min(1, fraction)) * 100)}%`;
    this.busyName.textContent = name;
  }

  /** 마지막 오류 알림의 글과 조각 여부(시작 화면 — 언어를 바꾸면 다시 그린다) */
  private errorMsg: [Mixed, boolean] = [[], false];

  /**
   * 오류 알림(문서가 있으면 알림 상자, 없으면 시작 화면). 글·섞은 글은 통째로 지금 언어로 옮기고(파일 이름 자리는 그대로 — 54차) 틀이 잡은 앱 글(까닭)도 옮긴다(199차),
   * split이면 조각마다 글 마디 하나(번역층이 따로 옮기고 파일 글 조각은 옮기지 않는다)
   */
  private showError(msg: string | Mixed, split = false): void {
    const m = typeof msg === 'string' ? [msg] : msg;
    this.error = plainText(m);
    this.errorMsg = [m, split];
    if (this.doc) {
      toast(this.errorNodes(), 'error', 8000);
      return;
    }
    this.startError.replaceChildren(...this.errorNodes());
    this.startError.hidden = false;
  }

  private errorNodes(): (string | Node)[] {
    const [m, split] = this.errorMsg;
    return split ? pieces(m) : [mixSpan(m, undefined, true)];
  }

  private bindDrop(): void {
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      this.dropMask.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) this.dropMask.hidden = true;
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.dropMask.hidden = true;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      // 여러 파일은 한 작업(주 프로그램 + 부프로그램 파일)으로
      if (files.length > 1) void this.openFiles(files);
      else void this.openFile(files[0]!);
    });
  }

  // ───────────────────────── 문서·뷰어 ─────────────────────────

  /**
   * 뷰어를 만든다(첫 문서 — 코어 입구를 받을 때까지 기다린다). 이미 있으면 그대로.
   * 뷰어는 this.viewer로 쓴다(약속의 값으로 돌려주지 않는다 — 시험의 가짜 뷰어처럼 then이 있는 것도 그대로 두게)
   */
  private async ensureViewer(): Promise<void> {
    // 213차: 뷰어가 있으면 그대로 — 3D 보기 띠를 받지 못한 채면 이 문서 열기에 조용히 다시 받는다(uiRetry, 기다리지 않음)
    if (this.viewer) return this.uiRetry?.(true);
    // 측정 도구 조각(코어보다 훨씬 작다)도 함께 기다려 첫 문서가 보일 때 측정이 바로 켜지게 한다. 받지 못하거나 코어 뒤에도 늦으면
    // 기다리지 않고 연다(측정을 켤 때 FirstUse로 받는다)
    const measure = this.mlock ? null : this.ensureMeasureTools().catch(() => undefined);
    // 정보 탭의 공구 경로 부분(panel-info.ts — 54차에 첫 화면 JS에서 뺐다)도 함께 기다린다(늦거나 받지 못하면 정보 탭이 받은 뒤 다시 그린다)
    const info = loadPanelInfo().catch(() => undefined);
    let core: Awaited<ReturnType<typeof loadViewerCore>>;
    try {
      core = await loadViewerCore();
    } catch (e) {
      throw new Error(uiText(`3D 보기를 만들지 못했습니다: ${errorText(e)}`));
    }
    if (measure) await settleWithin(measure, MEASURE_WAIT_MS);
    await settleWithin(info, MEASURE_WAIT_MS);
    if (this.viewer) return;
    this.viewEl.hidden = false;
    let v: Viewer3d;
    try {
      // 55차(코어 0.48.0 animate: 'auto'): 뷰 큐브·키 F·1~7·전체 보기·고른 것 맞춰 보기의 카메라 움직임이 움직임 줄이기 선호(prefers-reduced-motion)를 따르고,
      // 연 뒤 OS·브라우저 설정을 바꿔도 새로 고침 없이 따른다. 처음 맞춤(fit(false))·선반 앞 보기(setView('front', false))는 인자대로 늘 바로
      v = new core.Viewer3d(this.viewEl, { theme: this.theme, viewCubeSize: this.cubeSizeFor(), animate: 'auto' });
    } catch (e) {
      if (!this.doc) this.viewEl.hidden = true;
      // 107차: 코어 Error 글(WebGL2 없음 등)까지 지금 언어로 옮겨 던진다 — 받는 쪽이 파일 이름과 섞는 "{파일}: …"에는 맞는 틀이 없어 통째로 한국어로 남았다
      throw new Error(uiText(`3D 보기를 만들지 못했습니다: ${errorText(e)}`));
    }
    this.viewer = v;
    this.applyThemeUi();
    // 판재 문서는 보기에서 누르면 반투명 판 너머를 고른다(27차 — 코어 0.23.0 throughTranslucent: 판 안 구멍·포켓·홈을 누르면 그 가공(onPick → selectMprOp,
    // 가공 목록에서 고른 것과 같다), 뒤에 없으면 판).
    // 29차(코어 0.26.0 front): 알림 하나가 한 누르기의 판 너머 고르기(첫 인자)와 가장 앞 고르기(e.front)를 함께 받는다 — 판이 있는 장면이면 판 너머,
    // 아니면 가장 앞 면(예전 그대로). 판 너머 고르기는 포켓·홈 뚜껑을 지나간다(applyDoc — 코어 0.27.0 setItemPickThrough)
    v.onPick((p, e) => this.onPick(this.pickThrough ? p : (e.front ?? null)), { throughTranslucent: true, front: true });
    v.onMeasure((m) => this.onMeasure(m));
    // 단면 손잡이·키보드 붙잡기(56차 viewer-ui.ts — 코어와 함께 받았다. 받지 못했으면 그것만 없이).
    // 212차: 받지 못했으면 알림 상자에 「가상 커서을(를) 불러오지 못했습니다.」와 「다시 시도」(그 조각만 다시 받아 붙인다 — core.ts loadViewerUi; 전에는 글 없이 빠지고
    // 뷰어가 생긴 뒤 다시 받지 않았다). 늦게 붙여도 단면이 켜져 있으면 손잡이가 보이게 자리를 맞춘다
    // 213차: 알림의 「다시 시도」만이 아니라 띠가 필요한 때(다음 문서 열기·3D 보기 키 — uiRetry(true))에도 다시 받는다 — 212차는 알림이 닫히면(8초) 새로 고침뿐이었다.
    // 받는 동안은 uiRetry를 비워(받는 중 깃발) 두 길이 겹쳐 띠를 둘 붙이지 않고, 다시 받지 못하면 같은 알림(211차 같은 글 하나).
    // 조용한 다시 받기는 뷰어마다 셋까지(사용자 동작 두 곳에서만 부르고 되풀이가 고리가 되지 않게 — 그 뒤는 알림의 「다시 시도」만)
    let tries = 0;
    const attach = (): void => {
      const ui = viewerUi();
      if (!ui) {
        this.uiRetry = (auto) => {
          if (auto && tries++ > 2) return;
          this.uiRetry = undefined;
          void loadViewerUi().then(attach, attach);
        };
        return loadFailed('가상 커서', () => this.uiRetry?.());
      }
      // 214차: 받아 붙이면(조용한 다시 받기든 알림의 다시 시도든) 떠 있는 그 실패 알림을 닫는다 — 213차는 8초 남고 그 다시 시도는 아무것도 하지 않고 닫혔다
      loadDone('가상 커서');
      this.viewEl.append((this.secHandle = ui.makeSecHandle(() => this.viewer)));
      this.keySnap = new ui.KeySnap(this, core);
      this.placeSecHandle();
    };
    attach();
    v.onSectionChange((st) => this.renderSection(st));
    v.onCameraChange(() => this.placeSecHandle());
    this.renderSection(null);
    // 그래픽 문맥을 잃으면(휴대폰이 앱을 뒤로 보냈다 돌아올 때 등) 되찾을 때까지 3D 보기 가운데에 안내(코어 0.25.0 알림 — 놓기는 쓰지 않아
    // 코어가 장면을 그대로 다시 올린다). 가운데라 위·아래 띠, 왼쪽 위 계산 표시, 오른쪽 위 뷰 큐브와 겹치지 않는다
    // 198차: 안내는 알림 영역이 아니다(role=status로 글과 함께 새로 붙어 첫 글을 읽지 않을 수 있었다) — 같은 글을 미리 붙여 둔 알림 영역에 잃을 때 한 번,
    // 되찾으면 비운다(다음에 잃을 때 같은 글도 바뀜이 되게)
    let lost: HTMLElement | null = null;
    v.onContextLost(() => {
      if (lost) return;
      this.viewEl.append((lost = h('div', { class: 'gl-lost' }, '그래픽을 다시 준비하는 중…')));
      this.said.textContent = lost.textContent;
    });
    v.onContextRestore(() => {
      lost?.remove();
      lost = null;
      this.said.textContent = '';
    });
    // 55차(코어 0.50.0): 코어가 장면 입력에서 빼거나 고친 것(좌표 NaN·아주 큰 값 등 — 해석기가 이미 거르므로 드물다)을 정보 탭 경고 목록에.
    // setScene·setMesh 안에서 찾았을 때 불린다(applyDoc도 setScene 뒤에 맞춘다)
    v.onSceneIssues(() => this.syncSceneIssues());
    // 첫 측정 점은 코어 알림이 없어(결과가 생길 때만) 떼기 뒤에 띠를 맞춘다(코어 듣기 다음, 버블 단계).
    // 101차: 손가락 탭으로 찍은 첫 점은 미리 보기도 없어 미리 보기 알림이 오지 않으므로 툴팁·잠금 버튼도 이 길(refreshBar → mlock.update)로만 맞는다
    // 214차: 3D 보기 캔버스의 첫 손가락 누름(둘째 손가락·끌기의 pointermove는 빼고 — 누름마다 한 번)에도 받지 못한 3D 보기 띠를 조용히 다시 받는다(uiRetry — 213차 뷰어마다 셋까지).
    // 손가락만 쓰는 기기는 3D 보기 키가 없어 213차에는 다음 문서 열기에서만 다시 받았다
    v.canvas.addEventListener('pointerdown', (e) => {
      if (e.isPrimary) this.uiRetry?.(true);
    });
    this.viewEl.addEventListener('pointerup', () => {
      if (v.measureMode) this.refreshBar();
    });
    this.attachMeasure();
  }

  /**
   * 키보드로 측정 점을 찍었다(56차 keysnap.ts — 첫 점은 코어 측정 알림이 없어 측정 띠·잠금 단추를 맞춘다).
   * 57차: 측정 모드의 가상 커서를 켜고 옮기고 끌 때도(포인터 이동이 없다 — 붙잡기 툴팁·방향 잠금 안내를 맞춘다)
   */
  keyMeasured(): void {
    this.refreshBar();
    this.mlock?.schedule();
  }

  /**
   * 측정 도구를 한 번 만든다(조각을 처음에 받는다 — 문서를 열 때 받기 시작한다). 받지 못하면 거부(다음 부름에서 다시 받는다).
   * 받는 사이 다른 부름이 먼저 만들었으면 그대로
   */
  private async ensureMeasureTools(): Promise<void> {
    if (this.mlock) return;
    const m = await loadMeasureTools();
    if (this.mlock) return;
    this.measureTools = m;
    // 원호 접선 잠금: 첫 측정 점에 닿는 원호(G2/G3·판재 윤곽 호 — 첫 점마다 한 번, 코어가 실은 선분 식별자로) 가운데 커서 아래 점이
    // 그 위에 있는 것의 접선(재생 중이면 그린 이동까지 — tangent.ts ArcTangents.ofDoc)
    const tangents = new m.ArcTangents();
    // 방향 잠금(Shift가 없는 손가락 기기): 둘째 점 방향을 잡는 동안만 보이는 잠금 단추, 띠 위 알림, 커서 옆 붙잡기 툴팁
    const lock = new m.MeasureLock({
      viewer: () => this.viewer,
      touch: () => this.touch,
      layer: this.viewEl,
      changed: () => this.renderStatus(),
      arcTangent: (a, p) => (this.doc ? tangents.ofDoc(this.doc, a, p) : null),
      tangentBy: () => tangents.by,
      // 3D 보기 위에 떠서 코어 거리 글상자를 가리는 띠(휴대폰 측정 띠·해석 판단 띠·재생 띠 — 뷰 큐브는 잠금 손잡이가 찾는다)
      overlays: () => [this.measureBar, this.noticeBar, this.playStrip.el],
    });
    this.mlock = lock;
    // 끌어온 점 단추(손가락은 머무르기가 없다 — 정밀 조준 중 다른 손가락으로 누르면 십자선 아래 붙잡은 점을 코어 setMeasureTrackPoints로).
    // 조준 중이거나 기억한 점이 있을 때만 보인다(조준을 시작하고 마칠 때 attachMeasure의 onChange가 맞춘다)
    const track = new m.TrackPick({
      viewer: () => this.viewer,
      touch: () => this.touch,
      aiming: () => !!this.aim?.aiming,
      flash: (text, ms, kind) => lock.showFlash(text, ms, kind),
      changed: () => this.refreshBar(),
    });
    this.mtrack = track;
    this.measureActs.prepend(lock.button, track.button);
    this.measureBar.append(lock.flash);
    // 193차: 알림이 뜨고 지면(빈 1화소 ↔ 글) 크기가 바뀌어 아래쪽 띠 관찰이 liftToasts를 다시 부른다(측정 도구는 한 번만 만든다 — 관찰도 한 번)
    this.bandRo?.observe(lock.flash);
    this.attachMeasure();
  }

  /** 뷰어와 측정 도구가 다 있으면 한 번: 정밀 조준(길게 눌러 십자선 — 떼면 코어가 그 자리를 누른 것으로)과 잠금 툴팁을 캔버스에 붙인다 */
  private attachMeasure(): void {
    const v = this.viewer;
    const m = this.measureTools;
    const lock = this.mlock;
    if (!v || !m || !lock || this.aim) return;
    this.labelFormat();
    // 십자선·손가락 자리는 코어 거리 글상자가 비키게 잠금 손잡이가 코어에 넘긴다(코어 0.13.0 setMeasureLabelAvoid)
    // 조준을 시작하고 마칠 때 측정 띠의 끌어온 점 단추를 보이고 숨긴다(measure-track.ts)
    this.aim = new m.TouchAim(v.canvas, {
      enabled: () => !!this.doc && v.measureMode && !this.busy,
      layer: this.aimLayer,
      onMove: (_at, finger) => lock.setAim(finger),
      onChange: () => this.mtrack?.update(),
    });
    lock.attach(v);
  }

  /**
   * 코어가 캔버스에 그리는 측정 거리 글상자("거리 … mm")를 화면 언어로(32차 — 측정 도구 조각 measure-label.ts, 코어 setMeasureFormat).
   * 그릴 때 문서 언어를 읽으므로 언어를 바꾸면 다시 넘겨 다시 그리게 한다. 조각을 받기 전에는 코어 기본(한국어) 글.
   * 33차: 수·자릿수·단위 글은 코어가 글 꼴의 둘째 인자로 넘긴다(코어 0.31.0 — 장면을 몰라도 된다)
   */
  private labelFormat(): void {
    if (this.viewer && this.measureTools) this.viewer.setMeasureFormat(this.measureTools.measureLabelFormat());
  }

  private setDoc(d: NcDoc): void {
    this.stopPlay();
    this.doc = d;
    this.sim?.docChanged(d);
    this.error = null;
    this.root.classList.remove('no-doc');
    this.startError.hidden = true;
    this.startEl.hidden = true;
    this.viewEl.hidden = false;
    this.panel.show(d);
    this.panel.setOpen(this.panelOpen);
    this.applyDoc(d, null);
    this.docNameEl.textContent = d.name;
    this.docNameEl.title = d.name;
    document.title = `${d.name} - ${APP_TITLE}`;
    this.renderToolbar();
    this.renderStatus();
    const w = d.scene.warnings?.length ?? 0;
    // 선반 자동·소수점 없는 좌표·판별한 방언은 3D 보기 위 띠로(행동 단추와 함께), 경고는 알림으로
    this.renderNotices(false);
    // 178차: 새 문서는 재생을 멈추고 재생 자리가 없다 — 재생 띠도 맞춘다(패널을 닫고 재생하던 띠가 옛 시간·줄 글로 남았다)
    this.refreshPlayStrip();
    if (w) toast(`해석 경고 ${w.toLocaleString('ko-KR')}개 — 패널의 "정보" 탭에서 볼 수 있습니다.`, 'info', 4500);
    // 코어 0.9.0부터 캔버스는 키보드 초점(:focus-visible)에 테두리를 그린다. 스크립트 초점은 브라우저가 입력 없이 연 경우(?sample·
    // 공유·파일 연결로 연 첫 화면)에도 테두리를 보이므로, 앞서 초점을 가진 것이 키보드 초점이었을 때만(열기 단추·최근 문서를 키보드로) 보인다
    const prev = document.activeElement;
    const keyboard = !!prev && prev !== document.body && matchesFocusVisible(prev);
    this.viewer?.canvas.focus({ preventScroll: true, focusVisible: keyboard } as FocusOptions);
    // The first scene may fit while the start screen still has the old canvas
    // size. Let the panel layout and ResizeObserver settle before fitting it.
    const viewer = this.viewer;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.doc === d && this.viewer === viewer) viewer?.fit(false);
    }));
  }

  /** 문서의 장면과 보기 상태를 뷰어에 올린다(cam을 주면 그 카메라를 지킨다) */
  private applyDoc(d: NcDoc, cam: ReturnType<Viewer3d['getCamera']> | null): void {
    const v = this.viewer;
    if (!v) return;
    // 깎기 시뮬레이션이 켜져 있으면 문서 장면 + 소재 그물(sim.ts)
    const scene = this.sim?.sceneFor(d) ?? d.scene;
    v.setScene(scene, { keepView: !!cam });
    this.syncSceneIssues();
    // 판재: 반투명 판 너머 고르기(측정·누르기)가 판 안 포켓·홈 그물에서 멈추게(코어 0.24.0 — 그림은 그대로, setScene이 겉모습을 비우므로 장면마다).
    // 29차(코어 0.27.0): 뚜껑(판 면 자리)은 지나가고 벽·바닥과 바닥의 구멍에서 멈춘다 — 판 위에서 포켓 바닥·그 구멍을 잰다
    const through = boardThrough(scene);
    for (const id of through ?? []) {
      v.setItemPickOpaque(id, true);
      const lid = boardLid(scene, id);
      if (lid) v.setItemPickThrough(id, [lid]);
    }
    this.pickThrough = !!through;
    this.keySnap?.sync();
    if (cam) v.setCamera(cam);
    // 선반: XZ 단면이 보이게 앞에서
    else if (sceneFeatures(d.scene).lathe) v.setView('front', false);
    for (const g of d.hiddenGroups) v.setGroupVisible(g, false);
    v.highlight(d.highlight.length ? d.highlight : null);
    // 새 장면은 코어가 찍은 측정 점과 방향 잠금을 지운다(측정 모드는 그대로)
    this.aim?.cancel();
    d.measure = null;
    this.mlock?.reset();
    this.applyPlayback(d);
    this.updateSegHighlight();
  }

  private applyThemeUi(): void {
    const t = this.theme;
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#e2e5ea' : '#232830');
    this.themeBtn.innerHTML = `${icon(t === 'light' ? 'moon' : 'sun')}<span class="lbl">설정</span><span class="caret">${icon('chevron')}</span>`;
    this.themeBtn.title = '앱 설정';
    this.themeBtn.setAttribute('aria-label', '앱 설정');
    this.viewer?.setTheme(t);
  }

  setTheme(t: ThemeName, remember = false): void {
    this.theme = t;
    if (remember) writeThemePref(this.storage, t);
    this.applyThemeUi();
  }

  // ───────────────────────── 고르기·강조 ─────────────────────────

  private onPick(p: Pick3d | null): void {
    const d = this.doc;
    if (!d) return;
    d.pick = p;
    if (!p) {
      this.clearSelection();
      return;
    }
    if (p.section || p.id.startsWith('sim-')) {
      // 단면 잘린 면(원본 번호 −1)·깎인 소재 그물: 줄 고르기·강조는 하지 않는다
      this.setHighlight([]);
      d.selKey = null;
      this.selectLine(-1, []);
      this.panel.onPick(true);
      return;
    }
    if (d.nc && (p.kind === 'line' || p.kind === 'point') && p.id.startsWith('nc-')) {
      // NC 선분·구멍: 원본 번호 = 이동 번호 → 그 줄
      const move = p.index;
      const line = move >= 0 && move < d.nc.moves.count ? d.nc.moves.line[move]! : -1;
      this.setHighlight([]);
      this.selectLine(line, move >= 0 ? [move] : [], true);
      return;
    }
    if (isPanelKind(d.kind) && /^mpr-op-\d+$/.test(p.id)) {
      this.selectMprOp(Number(p.id.slice(7)), true);
      return;
    }
    if (isPanelKind(d.kind) && (p.id === 'mpr-hole-centers' || p.id === 'mpr-other-pos')) {
      this.selectMprOp(p.index, true);
      return;
    }
    this.setHighlight([p.id]);
    d.selKey = null;
    this.selectLine(-1, []);
    this.panel.onPick(true);
  }

  private onMeasure(m: MeasureResult | null): void {
    const d = this.doc;
    if (!d) return;
    // 원호 접선 잠금으로 찍은 둘째 점은 결과에 "접선 방향"으로(코어 종류는 나란함), 끌어온 축 위에 찍은 점은 "끌어온 점에서 X축"으로(코어 0.16.0),
    // 끌어온 점 안내 선이 만나는 점은 "… · X축 위"처럼(31차 — 이름은 측정 도구 조각이 짓는다)
    const pts = this.viewer?.measurePoints ?? [];
    const marks = m ? { ...(this.mlock?.tangentResult(m) ? { tangentB: true } : {}), ...trackMarks(pts), ...this.measureTools?.trackDirNames(pts) } : {};
    d.measure = m && Object.keys(marks).length ? { ...m, ...marks } : m;
    this.panel.onMeasure();
    this.renderStatus();
    // 둘째 점을 찍으면 코어가 잠금을 푼다(잠금 단추·툴팁)
    this.mlock?.schedule();
  }

  fitItems(ids: string[]): void {
    if (ids.length) this.viewer?.fitItems(ids);
  }

  /** 코어가 지금 장면 입력에서 빼거나 고친 것(55차 — 코어 0.50.0 sceneIssues, 정보 탭 "3D 보기 경고"). 뷰어가 없으면 빈 목록 */
  sceneIssues(): readonly SceneIssue[] {
    const list = this.viewer?.sceneIssues;
    return Array.isArray(list) ? list : [];
  }

  /**
   * 코어 장면 알림이 바뀌었으면 정보 탭을 다시 그리고, 그 문서에서 처음 생겼으면 한 번 알린다(setScene 뒤·onSceneIssues).
   * 새 문서는 패널을 먼저 그리고 장면을 올리므로(setDoc) 문서가 바뀌면 앞 문서의 알림이 남지 않게 다시 그린다
   */
  private syncSceneIssues(): void {
    const list = this.sceneIssues();
    const key = list.map((i) => `${i.code}|${i.kind}|${i.id ?? ''}|${i.field ?? ''}|${i.count}`).join(';');
    const s = this.sceneIssueState;
    if (s.doc === this.doc && s.key === key) return;
    const fresh = s.doc !== this.doc || !s.key;
    this.sceneIssueState = { doc: this.doc, key };
    if (this.doc?.panelTab === 'info' && (s.key || key)) this.panel.refresh();
    if (list.length && fresh) toast(`3D 보기 경고 ${list.length.toLocaleString('ko-KR')}개 — 패널의 "정보" 탭에서 볼 수 있습니다.`, 'info', 4500);
  }

  setHighlight(ids: string[]): void {
    const d = this.doc;
    if (!d) return;
    d.highlight = ids;
    this.viewer?.highlight(ids.length ? ids : null);
  }

  /** 코드 줄 고르기: 그 줄의 이동을 선분 강조로 보인다(moves를 주면 그것만) */
  selectLine(line: number, moves?: number[], reveal = false): void {
    const d = this.doc;
    if (!d) return;
    d.selLine = line;
    d.selMoves = moves ?? (d.nc && line >= 0 ? lineMoveList(d.nc, line) : []);
    if (moves === undefined) d.pick = null;
    this.updateSegHighlight();
    this.panel.onSelectLine(reveal);
    this.renderStatus();
  }

  /** MPR 가공 고르기(음수면 고른 것 지우기 — 깎기 탭 가공 하나씩 따라가기의 깎기 전) */
  selectMprOp(i: number, reveal = false): void {
    const d = this.doc;
    if (!d) return;
    if (i < 0) {
      this.clearSelection();
      return;
    }
    const id = `mpr-op-${i}`;
    const has = d.scene.meshes.some((m) => m.id === id) || d.scene.lines.some((l) => l.id === id);
    this.setHighlight(has ? [id] : []);
    d.selKey = String(i);
    d.selLine = mprOps(d.scene)[i]?.line ?? -1;
    d.selMoves = [];
    this.updateSegHighlight();
    this.panel.onPick(reveal);
    this.renderStatus();
  }

  private clearSelection(): void {
    const d = this.doc;
    if (!d) return;
    d.pick = null;
    d.selKey = null;
    this.setHighlight([]);
    this.selectLine(-1, []);
    this.panel.onPick();
  }

  /** 고른 이동(코드 줄)의 선분을 뷰어의 선분 강조로: 보이는 부분은 굵게, 가려진 부분은 흐리게(색은 테마 강조색) */
  private updateSegHighlight(): void {
    const d = this.doc;
    const v = this.viewer;
    if (!v) return;
    v.setHighlightSegments(d && d.selMoves.length ? moveSegments(d.scene, d.selMoves) : null, { width: 3, hidden: 0.35 });
  }

  // ───────────────────────── 보기 명령 ─────────────────────────

  get projection(): 'perspective' | 'orthographic' {
    return this.viewer?.getProjection() ?? 'perspective';
  }

  setProjection(p: 'perspective' | 'orthographic'): void {
    this.viewer?.setProjection(p);
    this.renderToolbar();
  }

  setRenderMode(m: RenderMode): void {
    this.viewer?.setRenderMode(m);
    this.renderToolbar();
  }

  // 격자·뷰 큐브·좌표축 켜짐 상태는 뷰어 코어가 가진다(gridVisible 등). 뷰어가 없으면 막대 단추가 꺼져 있어 부를 일이 없다
  toggleGrid(on?: boolean): void {
    const v = this.viewer;
    if (!v) return;
    v.setGridVisible(on ?? !v.gridVisible);
    this.renderToolbar();
  }

  toggleCube(on?: boolean): void {
    const v = this.viewer;
    if (!v) return;
    v.setViewCubeVisible(on ?? !v.viewCubeVisible);
    this.renderToolbar();
    this.mlock?.schedule();
  }

  toggleAxes(on?: boolean): void {
    const v = this.viewer;
    if (!v) return;
    // 139차: 왼쪽 아래 축 표시와 함께 격자의 장면 안 X·Y축선도(코어 0.113.0 축선 모양 hidden — 전에는 격자를 켠 채 끄면 축선이 남았다).
    // 켜면 모양 없음(처음 뷰어와 같은 그림). 격자 버튼·새 문서에도 남는다(뷰어가 든다)
    const show = on ?? !v.axesVisible;
    v.setAxesVisible(show);
    v.setAxesStyle({ hidden: !show });
    this.renderToolbar();
  }

  /** 지금 화면에 맞는 뷰 큐브 크기(휴대폰은 작게) */
  private cubeSizeFor(): number {
    return isPhone() ? CUBE_NARROW : CUBE_WIDE;
  }

  get measuring(): boolean {
    return !!this.viewer?.measureMode;
  }

  /** 손가락이 주인 기기인지: 안내에서 키(Esc) 설명을 빼고 길게 누르기(정밀 조준)를 알린다 */
  get touch(): boolean {
    return !!this.coarse?.matches;
  }

  /**
   * 파일 고르기의 확장자 거르기(accept). 휴대폰은 accept의 확장자(.nc·.mpr 등)를 시스템 형식으로 못 바꾸면 그 파일을 흐리게 해
   * 고르지 못하게 한다(iOS) — 손가락 기기는 거르지 않고 고른 뒤 내용을 보고 가린다(openFile·워커 checkNcInput).
   */
  private syncAccept(): void {
    if (this.touch) this.fileInput.removeAttribute('accept');
    else this.fileInput.accept = fileAccept();
  }

  /** 측정 중이거나 측정 도구 조각을 받는 동안 켜려는지(측정 단추 눌림·다시 누르기가 이것을 따른다) */
  private get measureWanted(): boolean {
    return this.measuring || !!this.measureFirstUse.wanted;
  }

  toggleMeasure(on = !this.measureWanted): void {
    const v = this.viewer;
    if (!v) return;
    const lock = this.mlock;
    if (!lock) {
      // 측정 도구 조각을 아직 받지 못했다: 받은 뒤에 켠다(받는 동안 다시 누르기·Esc는 바람을 거둔다 — 받기는 한 번)
      this.measureFirstUse.request(on || null);
      this.renderToolbar();
      this.renderStatus();
      return;
    }
    if (on !== v.measureMode) this.aim?.cancel();
    const had = document.activeElement;
    v.setMeasureMode(on);
    this.syncMeasureSnap();
    lock.reset();
    if (!on && this.doc) this.doc.measure = null;
    this.panel.onMeasure();
    this.renderToolbar();
    this.renderStatus();
    this.refreshPlayStrip();
    this.toOpener(had, this.measureBar, 'measure');
  }

  /** 측정을 켤 때 받던 측정 도구 조각이 왔다(또는 받지 못했다): 그때까지 바랐으면 켜고, 받지 못했으면 바랐을 때만 알린다 */
  private measureArrived(want: true | null, error: unknown): void {
    if (error) {
      // 108차: 끼운 까닭(「파일을 받지 못했습니다(네트워크 오류).」 같은 앱 글)까지 화면 언어로(uiText — 번역층은 {0} 자리 값을 그대로 둔다).
      // 202차: 원문을 든 mixSpan(ui — uiText와 같은 글)으로 담아 언어를 바꾸면 새 언어로 다시 옮긴다(dom.ts relangToasts)
      if (want) toast(isChunkLoadError(error) ? measureFailText(navigator.onLine !== false) : [mixSpan([`측정 도구를 열 수 없습니다: ${errorText(error)}`], undefined, true)], 'error', 8000);
    } else if (want && this.mlock && this.viewer && this.doc) {
      this.toggleMeasure(true);
      return;
    }
    this.renderToolbar();
    this.renderStatus();
  }

  togglePanel(on = !this.panelOpen): void {
    const had = document.activeElement;
    this.panelOpen = on;
    this.panel.setOpen(on);
    this.renderToolbar();
    this.toOpener(had, this.panel.el, 'panel');
    this.refreshPlayStrip();
    // 좁은 화면에서는 시트가 3D 보기 높이를 바꾸므로 크기가 정해진 뒤 다시 맞춘다
    if (window.innerWidth < NARROW_WIDTH && this.viewer) requestAnimationFrame(() => requestAnimationFrame(() => this.viewer?.fit(false)));
  }

  /**
   * 154차: 칸 안에서 누른 닫기(패널 「패널 닫기」, 측정 띠 「측정 끝내기」·띠 안 Esc)로 그 칸이 숨으면 HTML focus fixup이 남은 초점을 문서로 보낸다 —
   * 초점이 그 칸 안이었을 때만 연 버튼(막대 「패널」·「측정」 — 두 폭에 다 있고 다시 누르면 다시 엶)으로(153차 차례: 연 버튼 → 남는 칸 → 3D 보기).
   * 초점이 그 밖이거나 칸이 남으면 그대로
   */
  private toOpener(had: Element | null, box: HTMLElement, key: string): void {
    if (box.hidden && box.contains(had)) this.tools[key]?.el.focus();
  }

  setGroupVisible(g: string, on: boolean): void {
    const d = this.doc;
    if (!d) return;
    if (on) d.hiddenGroups.delete(g);
    else d.hiddenGroups.add(g);
    this.viewer?.setGroupVisible(g, on);
  }

  groups(): { name: string; visible: boolean; count: number }[] {
    return this.viewer?.groups() ?? [];
  }

  async savePng(): Promise<void> {
    const v = this.viewer;
    const d = this.doc;
    if (!v || !d) return;
    try {
      // 106차(코어 0.114.0): 그래픽 문맥을 잃은 동안(가운데 안내가 뜬 동안)은 코어가 빈 그림 대신 거절해 아래 catch 알림이 된다
      const b = await v.toBlob('image/png');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${d.name.replace(/\.[^.]+$/, '') || 'opencad-nc'}.png`;
      a.click();
      trackExport('png');
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('지금 화면을 PNG로 저장했습니다.', 'info', 2500);
    } catch (e) {
      // 107차: 까닭(코어 Error 글)까지 화면 언어로 — 번역층은 {0} 자리 값을 그대로 둔다(uiText와 같은 글 — 202차: 원문을 든 mixSpan)
      toast([mixSpan([`그림을 저장하지 못했습니다: ${errorText(e)}`], undefined, true)], 'error');
    }
  }

  // ───────────────────────── 소재 깎기 시뮬레이션(sim.ts를 켤 때 받는다) ─────────────────────────

  private ensureSim(): Promise<SimView> {
    if (!this.simLoad) {
      const app = this;
      const host: SimHost = {
        get viewer() {
          return app.viewer;
        },
        get doc() {
          return app.doc;
        },
        viewLayer: this.viewEl,
        refreshScene: () => {
          if (this.doc && this.viewer) this.applyDoc(this.doc, this.viewer.getCamera());
        },
        holdScene: () => (this.viewer?.measurePointCount ?? 0) > 0 || !!this.aim?.aiming,
        selectLine: (l, m, r) => this.selectLine(l, m, r),
        selectMprOp: (i, r) => this.selectMprOp(i, r),
        panelOpen: () => this.panelOpen,
        measuring: () => this.measuring,
        busy: () => this.busy,
        // 189차: 붙인 따라가기 띠도 재생 띠처럼 크기를 보고 재어 판단 띠·알림이 그 위로(띠는 떼지 않고 숨기기만 하니 관찰은 한 번)
        stripAdded: (el) => {
          this.simStrip = el;
          this.bandRo?.observe(el);
        },
        refreshPanel: () => {
          if (this.doc?.panelTab === 'sim') this.panel.refresh();
        },
        renderToolbar: () => this.renderToolbar(),
      };
      const p = import('./sim').then((m) => (this.sim = new m.SimView(host)));
      this.simLoad = p;
      p.catch(() => {
        if (this.simLoad === p) this.simLoad = null;
      });
    }
    return this.simLoad;
  }

  /** 깎기 시뮬레이션 켜고 끄기(on을 주지 않으면 바꾼다) */
  async setSim(on?: boolean, opts?: Parameters<SimView['setOptions']>[0]): Promise<void> {
    let s: SimView;
    try {
      s = await this.ensureSim();
    } catch (e) {
      // 108차: 조각을 받지 못한 까닭(errorText가 앱 글로 바꾼 네트워크 오류 등)까지 화면 언어로(202차: 원문을 든 mixSpan — 언어를 바꾸면 따라감)
      toast([mixSpan([`시뮬레이션을 불러오지 못했습니다: ${errorText(e)}`], undefined, true)], 'error');
      return;
    }
    if (opts) s.setOptions(opts);
    s.setOn(on ?? !s.on);
  }

  /** 211차: 깎기 조각 받기(패널 waitTab이 받는 중·받지 못함을 이 함수로 센다 — 한 함수) */
  private readonly simLoader = (): Promise<unknown> => this.ensureSim();

  /**
   * 패널 "깎기" 탭(모듈을 받기 전이면 받은 뒤 다시 그린다 — 정보 탭 조각과 같은 panel.ts waitTab). 211차: 받지 못했으면 실패 글과 「다시 시도」 —
   * 전에는 「불러오는 중…」에 멈췄다(다른 탭에 갔다 와야 다시 받았다)
   */
  renderSimTab(body: HTMLElement, d: NcDoc): void {
    if (this.sim) return this.sim.renderTab(body, d);
    this.panel.waitTab(this.simLoader, '깎기');
  }

  // ───────────────────────── 재생 ─────────────────────────

  get isPlaying(): boolean {
    return this.playing;
  }

  private canPlay(): boolean {
    return !!this.doc?.nc && this.doc.nc.moves.count > 0;
  }

  /** 재생 시각을 정한다(null = 전체 경로) */
  seek(sec: number | null): void {
    const d = this.doc;
    if (!d?.nc) return;
    const total = totalTime(d.nc.timeline);
    d.playSec = sec === null ? null : Math.max(0, Math.min(total, sec));
    d.playMove = -1;
    this.applyPlayback(d);
    this.notifyPlayback();
    this.renderToolbar();
  }

  /** 재생 자리를 이동 i가 끝난 곳으로(한 이동씩 걷기·여기까지 그리기) */
  seekMove(i: number): void {
    const d = this.doc;
    if (!d?.nc || i < 0 || i >= d.nc.moves.count) return;
    this.stopPlay();
    d.playSec = moveEndTime(d.nc.timeline, i);
    d.playMove = i;
    this.applyPlayback(d);
    this.notifyPlayback();
    this.renderToolbar();
  }

  /** 한 이동씩 앞·뒤로(delta, Shift면 10). 전체 경로를 보고 있으면 앞으로는 처음부터, 뒤로는 끝부터 */
  stepMove(delta: number): void {
    const d = this.doc;
    if (!d?.nc) return;
    const cur = playPosition(d);
    const target = stepTarget(cur ? cur.move : -1, delta, d.nc.moves.count);
    if (target < 0) return;
    this.seekMove(target);
    // 코드 보기도 그 줄로(고른 줄은 그대로 두지 않고 따라간다)
    this.selectLine(d.nc.moves.line[target]!, [target], true);
  }

  /** 고른 줄까지 그리기: 그 줄의 첫 이동부터 이어진 마지막 이동이 끝난 자리로 */
  drawToLine(line = this.doc?.selLine ?? -1): void {
    const d = this.doc;
    if (!d?.nc || line < 0) return;
    const [lo, hi] = [d.nc.lineMoves.offsets[line]!, d.nc.lineMoves.offsets[line + 1]!];
    if (hi <= lo) {
      toast('이 줄은 이동을 만들지 않습니다.', 'info', 2500);
      return;
    }
    this.seekMove(lastMoveOfLine(d.nc.moves.line, d.nc.lineMoves.moves[lo]!));
  }

  /** 고른 줄을 앞·뒤로(코드 보기 키 ↑↓) */
  stepLine(delta: number): void {
    const d = this.doc;
    if (!d) return;
    const n = d.nc ? d.nc.source.lineCount : (d.mpr?.lines.length ?? 0);
    if (!n) return;
    const next = Math.max(0, Math.min(n - 1, (d.selLine < 0 ? (delta > 0 ? -1 : n) : d.selLine) + delta));
    this.selectLine(next, undefined, true);
  }

  togglePlay(): void {
    const d = this.doc;
    if (!d?.nc || !d.nc.moves.count) return;
    if (this.playing) {
      this.stopPlay();
      this.notifyPlayback();
      this.renderToolbar();
      return;
    }
    const total = totalTime(d.nc.timeline);
    if (d.playSec === null || d.playSec >= total) d.playSec = 0;
    d.playMove = -1;
    this.playing = true;
    this.lastT = performance.now();
    const tick = (t: number) => {
      this.raf = 0;
      const doc = this.doc;
      if (!this.playing || !doc?.nc || doc.playSec === null) return;
      const r = advance(doc.playSec, Math.min(250, t - this.lastT), this.speed, totalTime(doc.nc.timeline));
      this.lastT = t;
      doc.playSec = r.sec;
      this.applyPlayback(doc);
      this.notifyPlayback();
      if (r.done) {
        this.playing = false;
        this.notifyPlayback();
        this.renderToolbar();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.notifyPlayback();
    this.renderToolbar();
  }

  setSpeed(s: PlaySpeed): void {
    if (PLAY_SPEEDS.includes(s)) this.speed = s;
    this.notifyPlayback();
  }

  stopPlay(): void {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** 지금 재생 위치(줄·이동) */
  playbackInfo(): { move: number; frac: number; line: number; sec: number; total: number } | null {
    const d = this.doc;
    if (!d?.nc) return null;
    const total = totalTime(d.nc.timeline);
    if (d.playSec === null) return { move: -1, frac: 0, line: -1, sec: total, total };
    const { move, frac } = playPosition(d)!;
    return { move, frac, line: move >= 0 ? d.nc.moves.line[move]! : -1, sec: d.playSec, total };
  }

  /**
   * 두 점 측정 붙잡기(코어 setMeasureSnap): G-code·Heidenhain 문서를 재는 동안 원호 중심을 늘 후보로 두고, 고른 이동에는
   * 가운데 점(원호는 현이 아니라 호 위)과 중심을 더한다(snap.ts). 재생 중에는 그린 이동까지의 중심만(코어 0.10.0 붙잡기 한도 — 목록은 그대로).
   * 추론 붙잡기(코어 0.9.0)도 켠다: 공구 경로 두 선분의 교차점, 첫 점에서 내린 수직 발, 첫 점에서 X·Y·Z 축 방향.
   * 코어 0.10.0의 나란함(커서가 지나간 선분과 나란한 방향)과 방향 잠금(Shift — 0.12.0부터 모서리 끝에서 그 모서리를 따라 가리킨 점도,
   * 화살표·잠금 단추는 measure-lock.ts)도 켠다.
   * 중심이 512개 이상이면 코어가 점 범위 나무(BVH)로 커서 둘레만 본다. 반경 보정 경로는 보정 조각의 가운데 점·호 중심.
   * 판재 가공(MPR·PGI·XML)은 워커가 보낸 붙잡기 표로 윤곽·판 외곽선의 원호 중심, 원형 포켓 중심, 고른 윤곽 요소의 가운데 점과 추론 붙잡기.
   * 코어가 고른 수직 발·선분 위 점은 원호·스플라인을 나눈 토막 위라 곡선 위로 다듬는다(코어 0.14.0 refine — refine.ts).
   * 교차점(0.15.0 — 토막끼리 조금 비켜 지나가는 넓힌 교차 포함)은 두 곡선의 교차점, 멀리서 내린 열린 수직 발은 곡선 위 발로 다듬는다.
   * 축과 선분의 교차(0.18.0 — 잠근 축은 0.19.0부터)는 곡선 위, 판재에서 축이 구멍·둥근 포켓·둥근 모서리 벽을 뚫는 점은 원기둥 위(0.19.0 refineFace).
   * 측정 밖에서는 끈다(코어 기본 — 꼭짓점·끝점). 붙잡기 선택(refine.ts ncSnapOptions·panelSnapOptions)과 점 계산(snap.ts)은 측정 도구 조각에 있다
   * (측정은 그것을 받은 뒤에만 켠다)
   */
  private syncMeasureSnap(): void {
    const v = this.viewer;
    if (!v) return;
    const d = this.doc;
    const nc = d?.nc;
    const panel = d && !nc ? (d.mpr?.snap ?? null) : null;
    const m = this.measureTools;
    if (!d || (!nc && !panel) || !v.measureMode || !m) {
      if (this.snapKey) v.setMeasureSnap(null);
      this.snapKey = null;
      return;
    }
    if (panel) {
      if (this.snapKey?.src === panel) return;
      this.snapKey = { src: panel, limit: null };
      v.setMeasureSnap(m.panelSnapOptions(panel));
      return;
    }
    if (!nc) return;
    let c = this.snapCenters.get(nc);
    if (!c) this.snapCenters.set(nc, (c = m.arcCenters(nc)));
    const pos = d.playSec === null ? null : playPosition(d);
    // 재생 중에는 그린 이동까지의 중심(차례 = 처음 그린 이동 번호 < 한도). 점 목록·색인은 문서마다 한 번만 주고 한도만 바꾼다(코어 0.10.0)
    const limit = pos && pos.move >= 0 ? pos.move + 1 : null;
    if (this.snapKey?.src === nc) {
      if (this.snapKey.limit === limit) return;
      // 코어가 그 커서 자리의 미리 보기를 다시 구하고, 값이 바뀌면 그 그림 뒤 알린다(0.103.0 onMeasureHoverChange — measure-lock.ts가 듣고 툴팁을 맞춘다, 99차)
      v.setMeasureSnapLimit(limit);
    } else {
      const angle = (d.scene.meta as { arcAngle?: unknown } | undefined)?.arcAngle;
      v.setMeasureSnap(m.ncSnapOptions(nc, c, limit, typeof angle === 'number' && angle > 0 ? angle : undefined));
    }
    this.snapKey = { src: nc, limit };
  }

  private applyPlayback(d: NcDoc): void {
    const v = this.viewer;
    if (!v) return;
    this.sim?.follow(d);
    this.syncMeasureSnap();
    if (!d.nc || d.playSec === null) {
      v.setDrawLimitBySegmentId(null);
      v.setMarker(null);
      return;
    }
    const { move, frac } = playPosition(d)!;
    if (move < 0) {
      v.setDrawLimitBySegmentId(null);
      v.setMarker(null);
      return;
    }
    const end = v.setDrawLimitBySegmentId(move, { ghost: 0.14 });
    const seg = moveSegments(d.scene, [move], 4096);
    const pos = pointAlong(seg, frac) ?? end ?? moveEndPoint(d.nc, move);
    const mk = toolMarker(d.nc, move, this.settings.toolSize);
    v.setMarker(pos, mk.kind, mk.radius ? { radius: mk.radius } : {});
  }

  // ───────────────────────── 막대 그리기 ─────────────────────────

  private renderToolbar(): void {
    const has = !!this.doc && !!this.viewer;
    for (const t of Object.values(this.tools)) t.el.disabled = t.needsDoc && !has;
    const pressed = (key: string, on: boolean): void => this.tools[key]?.el.setAttribute('aria-pressed', String(on));
    const v = this.viewer;
    pressed('grid', v?.gridVisible ?? true);
    pressed('cube', v?.viewCubeVisible ?? true);
    pressed('axes', v?.axesVisible ?? true);
    pressed('measure', this.measureWanted);
    // 측정 도구 조각을 받는 동안 켤 단추(누르면 거둔다)
    const mb = this.tools.measure?.el;
    if (this.measureFirstUse.wanted) mb?.setAttribute('aria-busy', 'true');
    else mb?.removeAttribute('aria-busy');
    pressed('panel', this.panelOpen && !!this.doc);
    const persp = this.projection === 'perspective';
    this.projBtn.innerHTML = `${icon(persp ? 'perspective' : 'ortho')}<span class="lbl">${persp ? '원근' : '평행'}</span>`;
    this.projBtn.title = persp ? '지금 원근 투영 — 누르면 평행 투영' : '지금 평행 투영 — 누르면 원근 투영';
    this.projBtn.setAttribute('aria-label', persp ? '원근 투영(누르면 평행)' : '평행 투영(누르면 원근)');
    const mode = this.viewer?.getRenderMode() ?? 'shadedEdges';
    for (const r of this.renderItems) r.el.setAttribute('aria-checked', String(r.mode === mode));
    const more = this.moreItems;
    more.proj.perspective.setAttribute('aria-checked', String(persp));
    more.proj.orthographic.setAttribute('aria-checked', String(!persp));
    more.grid.setAttribute('aria-checked', String(v?.gridVisible ?? true));
    more.cube.setAttribute('aria-checked', String(v?.viewCubeVisible ?? true));
    more.axes.setAttribute('aria-checked', String(v?.axesVisible ?? true));
    // 깎기: G-code·Heidenhain과 판재(MPR·PGI·XML) 문서에
    const simOn = !!this.sim?.on;
    for (const el of [more.sim, ...this.simWide]) el.hidden = !this.doc?.nc && !this.doc?.mpr;
    for (const el of [more.sim, this.simWide[1]]) el.setAttribute('aria-checked', String(simOn));
    const canPlay = this.canPlay();
    this.playBtn.hidden = !canPlay;
    this.playSep.hidden = !canPlay;
    this.playBtn.innerHTML = `${icon(this.playing ? 'pause' : 'play')}<span class="lbl">${this.playing ? '멈춤' : '재생'}</span>`;
    this.playBtn.setAttribute('aria-pressed', String(this.playing));
    this.playBtn.setAttribute('aria-label', this.playing ? '재생 멈춤' : '재생');
  }

  private renderStatus(): void {
    const d = this.doc;
    if (!d) {
      this.stMain.textContent = '파일을 열면 형식·단위·크기·이동 수·읽은 시간이 여기에 보입니다.';
      this.stSel.textContent = '';
      this.stWarn.hidden = true;
      this.refreshBar();
      return;
    }
    this.stMain.textContent = statusParts(d).join(' · ');
    const wl = warningLabel(d);
    this.stWarn.hidden = !wl;
    this.stWarn.textContent = wl;
    // 측정 도구 조각을 받는 동안(받은 뒤 측정을 켠다)
    const sel: Mixed = this.measureFirstUse.wanted && !this.measuring ? [MEASURE_LOADING] : selectionSummary(d, this.measuring, this.touch);
    // 측정 결과의 붙잡은 종류(예: 중심 → 끝점)는 이름마다 따로 번역되게 조각으로 붙인다(잠근 선 위에 찍었으면 "잠금")
    const sp = d.measure ? snapPair(d.measure) : null;
    // 방향 잠금 안내(첫 점을 찍은 뒤): 잠근 방향이나 Shift·화살표 — 안내 글과 따로 둔다(번역이 안내 글 전체를 찾게)
    const lock = this.measuring ? this.lockHintNow() : null;
    // 고른 것 요약에는 파일 글(작업 파일·이름 붙은 공구·MPR 가공 이름)이 섞인다 — 지금 언어로 옮겨 담는다(54차)
    this.stSel.replaceChildren(
      mixSpan(sel),
      ...(sp ? [' · ', h('span', {}, sp[0]), ' → ', h('span', {}, sp[1]), ...(sp[2] ? [' · ', h('span', { class: 'st-lock' }, '잠금')] : [])] : []),
      ...(lock ? [' · ', h('span', { class: 'st-lock' }, lock)] : []),
    );
    this.stSel.title = mixText(sel);
    this.refreshBar();
  }

  /** 재생 띠(패널이 닫혔을 때): 시간·줄·이동 상태, 처음·이전·재생/멈춤·다음·속도·전체 경로(끝), 시간 막대 */
  private buildPlayStrip(): NcViewerApp['playStrip'] {
    const btn = (ic: IconName, label: string, run: () => void): HTMLButtonElement => {
      const b = h('button', { class: 'mb-btn icon', type: 'button', title: label, 'aria-label': label, html: icon(ic) });
      b.addEventListener('click', run);
      return b;
    };
    const time = h('span', { class: 'ps-time' });
    const line = h('span', { class: 'ps-line', 'data-i18n-skip': true });
    const state = h('div', { class: 'ps-state', 'data-i18n-skip': true });
    const play = btn('play', '재생', () => this.togglePlay());
    const speed = h('select', { class: 'select small', 'aria-label': '재생 속도', title: '재생 속도' });
    for (const s of PLAY_SPEEDS) speed.append(h('option', { value: String(s) }, `×${s}`));
    speed.addEventListener('change', () => this.setSpeed(Number(speed.value) as PlaySpeed));
    const range = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': '재생 위치' });
    range.addEventListener('input', () => {
      const info = this.playbackInfo();
      if (info) this.seek((Number(range.value) / 1000) * info.total);
    });
    const el = h(
      'div',
      { class: 'play-strip', role: 'group', 'aria-label': '재생', hidden: true },
      h('div', { class: 'ps-info' }, time, line, state),
      h(
        'div',
        { class: 'ps-acts' },
        btn('first', '처음으로', () => this.seek(0)),
        btn('stepBack', '이전 이동', () => this.stepMove(-1)),
        play,
        btn('stepFwd', '다음 이동', () => this.stepMove(1)),
        speed,
        btn('close', '재생 끝내기(전체 경로)', () => {
          this.stopPlay();
          this.seek(null);
        }),
      ),
      range,
    );
    return { el, time, line, state, play, range, speed };
  }

  /** 재생 막대(패널)와 재생 띠를 함께 맞춘다 */
  private notifyPlayback(): void {
    this.panel.onPlayback();
    this.refreshPlayStrip();
  }

  /** 재생 띠: 패널이 닫혔고 재생 중이거나 재생 자리가 있으면(측정 중이 아니면) 보인다. 판재 가공 하나씩 따라가기 띠도 같은 때 맞춘다 */
  private refreshPlayStrip(): void {
    this.sim?.refreshStrip();
    const s = this.playStrip;
    const d = this.doc;
    const info = this.playbackInfo();
    const on = !!d && !!info && !this.panelOpen && !this.busy && !this.measuring && (this.playing || d.playSec !== null);
    // 177차: ✕(재생 끝내기)를 키보드로 눌러 띠가 숨으면 초점이 문서로 빠진다 — 띠 안이었을 때만 연 버튼(막대 「재생」 — 두 폭에 다 있고 다시 누르면 다시 엶)으로(154차 toOpener).
    // 띠가 남거나 초점이 띠 밖이면 그대로
    const had = document.activeElement;
    s.el.hidden = !on;
    this.toOpener(had, s.el, 'play');
    if (!on || !d || !info) return;
    const at = `${formatDuration(info.sec)} / ${formatDuration(info.total)}`;
    s.time.textContent = at;
    // 줄(작업 파일 이름)·상태(이름 붙은 공구)에 파일 글이 섞인다 — 지금 언어로 옮겨 담는다(data-i18n-skip)
    s.line.replaceChildren(...mixNodes(info.line >= 0 && this.doc ? lineLabel(this.doc, info.line) : []));
    const st = d.nc && info.move >= 0 ? moveState(d.nc, info.move, unitLabel(d.scene.units)) : null;
    s.state.replaceChildren(...mixNodes(st ? mix`${st.motion} · ${st.modal}` : []));
    s.play.innerHTML = icon(this.playing ? 'pause' : 'play');
    s.play.setAttribute('aria-label', this.playing ? '재생 멈춤' : '재생');
    s.play.title = this.playing ? '재생 멈춤' : '재생';
    s.range.value = String(info.total > 0 ? Math.round((info.sec / info.total) * 1000) : 1000);
    // 140차: 막대도 0~1000 수 대신 시간을 읽게(패널 재생 막대 onPlayback과 같은 글)
    s.range.setAttribute('aria-valuetext', at);
    s.speed.value = String(this.speed);
  }

  /** 해석 판단 띠: 선반 자동·소수점 없는 좌표·판별한 방언. 단추는 다른 설정으로 다시 읽거나 패널 탭을 연다, ✕는 이 문서에서 닫는다 */
  private renderNotices(keep = true): void {
    const d = this.doc;
    const bar = this.noticeBar;
    // 176차: 줄을 모두 새로 만들어 띠 안 초점(✕·다시 읽은 뒤의 동작 버튼)이 문서로 빠진다 — 그 안이었으면 같은 차례(모자라면 마지막) 줄의 같은 자리 버튼(✕면 ✕, 아니면 첫 버튼),
    // 띠가 숨으면 3D 보기로. 밖이었으면 그대로. keep = false(새 문서 — setDoc이 곧 3D 보기로 둔다)는 되살리지 않는다
    const had = document.activeElement;
    const at = keep && had && bar.contains(had) ? [...bar.children].findIndex((r) => r.contains(had)) : -1;
    bar.replaceChildren();
    const list = d ? noticeViews(d) : [];
    bar.hidden = !list.length;
    // 198차: 띠가 알림 영역(role=status)이면 숨김을 줄과 함께 풀어(열기·다시 읽기는 덮개가 inert를 거둔 같은 차례) 첫 줄을 읽지 않을 수 있었고, 그릴 때마다
    // 줄을 새로 붙여 언어 바꿈·✕에도 남은 줄을 동작 버튼·「이 안내 닫기」 이름까지 다시 읽었다 — 새로 나온 줄(새 문서면 모든 줄)의 글만 미리 붙여 둔 알림 영역에
    const old = keep ? this.saidKeys : [];
    const fresh: (string | Node)[] = [];
    this.saidKeys = list.map((n) => n.key);
    for (const n of list) {
      if (!old.includes(n.key)) fresh.push(mixSpan(n.text), ' ');
      // 좁은 화면은 글을 한두 줄로 줄여 보이고(3D 보기를 덜 가리게), 글을 누르면 펼친다
      // 글에 파일 글(주 프로그램·찾지 못한 프로그램 이름)이 섞인다 — 지금 언어로 옮겨 담는다(54차)
      const text = mixSpan(n.text, 'nt-text');
      text.title = mixText(n.text);
      const row = h('div', { class: 'notice', 'data-notice': n.key }, text);
      text.addEventListener('click', () => row.classList.toggle('open'));
      if (n.action) {
        const act = n.action;
        const b = h('button', { class: 'mb-btn', type: 'button' }, act.label);
        b.addEventListener('click', () => {
          if (act.add) this.chooseFile(true);
          else if (act.opts) void this.reparse(act.opts);
          else if (act.tab && d) {
            d.panelTab = act.tab;
            this.panel.show(d);
            this.togglePanel(true);
          }
        });
        row.append(b);
      }
      const x = h('button', { class: 'mb-btn icon', type: 'button', title: '이 안내 닫기', 'aria-label': '이 안내 닫기', html: icon('close') });
      x.addEventListener('click', () => {
        d?.dismissedNotices.add(n.key);
        this.renderNotices();
      });
      row.append(x);
      bar.append(row);
    }
    if (fresh.length) this.said.replaceChildren(...fresh);
    if (at >= 0) {
      const row = bar.children[Math.min(at, bar.children.length - 1)];
      (row ? row.querySelector<HTMLElement>(had!.matches('.icon') ? '.icon' : 'button') : this.viewer?.canvas)?.focus({ preventScroll: true });
    }
  }

  /**
   * 알림이 3D 보기 아래쪽 띠를 가리지 않게: 화면 아래쪽에 붙은 띠 가운데 맨 위의 높이(화면 아래에서 잰 px)를 --toast-clear로.
   * 188차: 좁은 화면 판단 띠도 재생·측정 띠 맨 위를 비키게 — 판단 띠를 재기 전에 두 띠 맨 위(3D 보기 아래에서 잰 px + 10)를 --notice-clear로(CSS가 76·140px과 큰 쪽).
   * 판단 띠 자신은 넣지 않아 고리가 없고(옮겨도 크기는 그대로), 판단 띠는 옮긴 자리를 재어 알림은 그 위로.
   * 189차: 깎기 조각이 붙인 판재 따라가기 띠(simStrip — 붙기 전 null)도 재생 띠와 같은 자리로 잰다
   * 193차: 측정 띠 위 잠깐 알림(띠 상자 밖 — 띠 rect에 들지 않아 판단 띠가 알림 글을 덮었다)도 글이 있을 때만 측정 띠 다음에(빈 알림은 1화소 클립)
   */
  private liftToasts(): void {
    const vh = window.innerHeight;
    const f = this.mlock?.flash;
    let top = Infinity;
    for (const el of [this.playStrip.el, this.simStrip, this.measureBar, f?.textContent ? f : null, this.noticeBar]) {
      if (el === this.noticeBar) this.viewEl.style.setProperty('--notice-clear', Number.isFinite(top) ? `${Math.max(0, Math.round(this.viewEl.getBoundingClientRect().bottom - top + 10))}px` : '0px');
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > vh / 2 && r.top < top) top = r.top;
    }
    document.body.style.setProperty('--toast-clear', Number.isFinite(top) ? `${Math.max(0, Math.round(vh - top + 8))}px` : '0px');
  }

  /**
   * 방향 잠금 안내(측정 중 첫 점을 찍은 뒤 결과가 없을 때): 잠근 방향, 키보드 기기는 Shift로 잠글 방향(코어 measureHoverLock)이나 화살표.
   * 57차: 가상 커서가 켜진 동안은 화살표가 커서를 옮기므로 Shift 안내만. 측정 도구 조각이 정한다(measure-lock.ts lockHint — 첫 화면 JS를 줄이려고)
   */
  private lockHintNow(): string | null {
    return this.mlock?.hint(!!this.doc?.measure, this.touch) ?? null;
  }

  /** 측정 띠: 측정 중이면 다음에 누를 곳 안내나 결과(거리와 dx·dy·dz), 끌어온 점 단추의 점 수. 보이는 곳은 CSS가 정한다(좁은 화면·터치) */
  private refreshBar(): void {
    const d = this.doc;
    const v = this.viewer;
    const on = !!d && !!v && v.measureMode && !this.busy;
    this.measureBar.hidden = !on;
    if (!on || !d || !v) return;
    const t = this.measureText;
    t.replaceChildren();
    if (d.measure) {
      const m = measureLines(d.measure, unitLabel(d.scene.units));
      t.append(h('b', { class: 'mb-value' }, m.value), h('span', { class: 'mb-sub' }, m.axes));
      // 붙잡은 종류(끝점·가운데 점·중심 — 이름마다 따로 번역되게 조각으로)
      const sp = snapPair(d.measure);
      if (sp) t.append(h('span', { class: 'mb-sub mb-snap' }, h('span', {}, sp[0]), ' → ', h('span', {}, sp[1]), ...(sp[2] ? [' · ', h('span', { class: 'st-lock' }, '잠금')] : [])));
    } else {
      t.append(h('span', { class: 'mb-hint' }, measureHint(v.measurePointCount, false, this.touch)));
      const lock = this.lockHintNow();
      if (lock) t.append(h('span', { class: 'mb-sub mb-lock-hint' }, lock));
    }
    // 다시 재기는 끌어온 점만 있어도(첫 점 전) 지운다 — 코어 clearMeasure가 끌어온 점도 지운다
    const had = document.activeElement as HTMLButtonElement | null;
    this.measureClear.disabled = !d.measure && !v.measurePointCount && !v.measureTrackPoints.length;
    this.mtrack?.update();
    this.mlock?.update();
    // 138차: 키보드로 누른 다시 재기가 지워 막히면 HTML focus fixup이 초점을 문서로 보낸다 — 3D 보기로(Enter로 가상 커서를 켜 다시 재는 곳).
    // 초점이 그 버튼에 없거나 막히지 않았으면 그대로(자주 불리는 갱신이 초점을 끌어오지 않게)
    // 154차: 띠 안 Esc로 점을 지워 숨는 잠금·끌어온 점 버튼도 같은 곳으로(띠는 남는다 — 지운 뒤 다시 재는 곳)
    if (had && this.measureActs.contains(had) && (had.disabled || had.hidden)) v.canvas.focus({ preventScroll: true });
  }

  // ───────────────────────── 키 ─────────────────────────

  private onKey(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement | null;
    // The language menu owns its keyboard focus, including Escape during loading.
    // 205차: 모달(키보드 단축키 창 — aria-modal) 안의 키도 그 상자 몫(Esc 닫기·Tab 돌기 — 원호 Shift 잠금·읽기 멈추기·메뉴 Esc·앱 키를 고르지 않는다)
    if (t?.closest?.('.language-control, .language-list, [aria-modal="true"]')) return;
    // 150차: 패널 탭 버튼의 ←→·Home·End(수정 키 없음)는 탭 줄 몫(panel.ts — APG Tabs). 한 이동 걷기로 가져가 전파를 막지 않게 먼저 돌아선다
    if (t?.getAttribute?.('role') === 'tab' && tabMove(ev, 0, 1) >= 0) return;
    // 원호 접선 Shift 잠금은 코어보다 먼저(아래 viewer 갈래·캔버스 키가 코어에 넘기면 코어는 잠금이 있으면 그대로 둔다)
    if (ev.key === 'Shift' && !ev.repeat && !isEditableTarget(t as (HTMLElement & { type?: string }) | null)) this.mlock?.shiftDown();
    if (this.busy && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.cancelLoad();
      return;
    }
    if (this.openMenu && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      const btn = this.openMenu.wrap.querySelector('button');
      this.closeMenu();
      (btn as HTMLButtonElement | null)?.focus();
      return;
    }
    const v = this.viewer;
    // 213차: 3D 보기 키(가상 커서를 켜는 Enter 등 — 누르고 있는 반복 키는 빼고)면 받지 못한 3D 보기 띠를 조용히 다시 받는다(uiRetry)
    if (t === v?.canvas && !ev.repeat) this.uiRetry?.(true);
    // 56차(keysnap.ts): 커서가 꺼져 있으면 캔버스 화살표로 코어가 커서를 켜지 않게 한다(고르기 Tab의 묶음 단위는 58차부터 코어 pickCycle group — 처리해 막는 키는 없다)
    if (v && this.keySnap?.key(ev, t === v.canvas)) return;
    // 범위 막대(재생 위치)는 화살표를 스스로 쓴다
    const onSlider = !!t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range';
    const a = keyAction({
      key: ev.key,
      ctrl: ev.ctrlKey,
      meta: ev.metaKey,
      alt: ev.altKey,
      editable: isEditableTarget(t as (HTMLElement & { type?: string }) | null) || (onSlider && ev.key.startsWith('Arrow')),
      // 149차: 체크 상자·라디오도(Space로 켜고 끔 — 범위 막대는 아님) 그 칸의 Space로 둔다(버튼과 같게)
      onButton: isPressTarget(t),
      onCanvas: !!v && t === v.canvas,
      hasDoc: !!this.doc && !!v && !this.busy,
      canPlay: this.canPlay(),
      shift: ev.shiftKey,
      inCode: !!t?.closest?.('.code-list, .code-search'),
      hasCode: !!this.doc && (!!this.doc.nc || !!this.doc.mpr),
      measureDirecting: !!this.mlock?.directing && !this.doc?.measure,
      arrowOwner: !!this.openMenu || !!t?.closest?.('[role="menu"], [role="tablist"], [role="listbox"], [role="tree"]'),
      canStepOps: !!this.sim?.canStepOps,
      keyCursor: !!this.keySnap?.cursor,
      charKeysOff: !this.charKeys,
    });
    if (!a) return;
    if (a.type === 'open' || a.type === 'shortcuts') {
      // 열기·키보드 단축키 창(205차)은 문서·뷰어가 없어도(시작 화면) 된다
      ev.preventDefault();
      ev.stopPropagation();
      if (a.type === 'open') this.chooseFile();
      else this.openShortcuts();
      return;
    }
    if (!v) return;
    switch (a.type) {
      case 'viewer':
        // F·1~7·Shift·Tab 등은 뷰어 규칙대로(171차: 설정을 끄면 F·1~7은 3D 보기에서만 — keyAction이 넘기지 않음). 받지 않은 키는 그대로 흘려보낸다
        if (v.handleKey(ev)) ev.stopPropagation();
        return;
      case 'escape':
        if (a.canvas) {
          // 캔버스도 Esc를 받아 뷰어가 측정을 지운다(막지 않는다). 앱은 측정 중이 아닐 때 고른 것만 지운다(측정 도구를 받는 중이면 켜려던 것을 거둔다)
          if (this.measureFirstUse.wanted) this.toggleMeasure(false);
          else if (!v.measureMode) this.clearSelection();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        // 측정 중이면 측정 먼저: 찍힌 점이 있으면 뷰어가 지우고, 없으면 측정을 끈다. 받는 중이면 켜려던 것을 거둔다. 아니면 고른 것을 지운다
        if (v.measureMode) {
          if (!v.handleKey(ev)) this.toggleMeasure(false);
        } else if (this.measureFirstUse.wanted) this.toggleMeasure(false);
        else this.clearSelection();
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (a.type === 'lock') this.mlock?.arrow(a.axis);
    else if (a.type === 'opStep') this.sim?.stepBy(a.delta);
    else if (a.type === 'grid') this.toggleGrid();
    else if (a.type === 'step') this.stepMove(a.delta);
    else if (a.type === 'line') this.stepLine(a.delta);
    else if (a.type === 'find') this.openFind(a.next);
    else this.togglePlay();
  }

  /**
   * 205차: 키보드 단축키 창(? 키·앱 설정 메뉴). 창 글·그리기는 열 때 받는 조각(shortcuts.ts — 첫 화면 JS 밖, 오프라인은 서비스 워커가 미리 담음).
   * 받는 동안·열린 동안은 다시 열지 않고(keysHelp), 받지 못하면 console.error(다음 누름에 다시 받는다 — 211차: 알림 상자에 실패 글과 「다시 시도」도)
   * 206차: 초점이 열린 메뉴(설정·보기 설정 메뉴·단면 상자) 안이면 메뉴 항목 누름(menu — 메뉴를 닫고 메뉴 버튼에 초점)과 같게 메뉴 버튼에서 연다. 메뉴 항목에서 ?로 열면
   * 창 닫기 버튼이 받는 초점에 메뉴가 닫혀(focusin) 연 항목이 숨어, 닫을 때 돌려줄 곳이 없어 초점이 문서로 빠졌다(WCAG 2.4.3)
   */
  private openShortcuts(): void {
    const w = this.openMenu?.wrap;
    if (w?.contains(document.activeElement)) {
      this.closeMenu();
      w.querySelector('button')?.focus();
    }
    if (this.keysHelp) return;
    this.keysHelp = true;
    // 207차: 열린 동안 연 곳이 숨거나 떼어지면(읽는 중 「취소」·시작 화면·다시 그린 패널 칸) 닫을 때 남는 칸으로 — 패널에서 열었으면 지금 탭 버튼,
    // 아니면 180차 덮개 「취소」와 같은 차례(문서가 있으면 3D 보기, 없으면 시작 화면 열기 칸)
    const inPanel = this.panel.el.contains(document.activeElement);
    void import('./shortcuts')
      .then((m) => {
        // 214차: 받으면(? 키·메뉴로 다시 연 때도) 떠 있는 실패 알림을 닫는다 — 213차는 창 위에 8초 남고 그 다시 시도는 창이 열린 동안 아무것도 하지 않았다
        loadDone('키보드 단축키');
        m.openShortcutsDialog(
          this.root,
          () => (this.keysHelp = false),
          () => [inPanel ? this.panel.el.querySelector<HTMLElement>('.panel-tab.active') : null, this.doc && this.viewer ? this.viewer.canvas : this.startEl.querySelector<HTMLElement>('.dropzone')],
        );
      })
      .catch((e: unknown) => {
        this.keysHelp = false;
        console.error(e);
        // 211차: 창 대신 알림 상자에(전에는 console.error만 — ?·메뉴를 눌러도 아무 일이 없었다). 다시 시도는 같은 열기(import()를 다시 부른다)
        loadFailed('키보드 단축키', () => this.openShortcuts());
      });
  }

  /** 코드에서 찾기: 패널 코드 탭을 열고 찾기 칸에 초점(next면 다음 찾기) */
  openFind(next = false): void {
    const d = this.doc;
    if (!d) return;
    if (d.panelTab !== 'code') {
      d.panelTab = 'code';
      this.panel.show(d);
    }
    this.togglePanel(true);
    this.panel.focusFind(next);
  }

  // ───────────────────────── 자동 확인용 ─────────────────────────

  state(): AppState {
    const d = this.doc;
    const c = d ? sceneCounts(d.scene) : null;
    return {
      ready: this.ready,
      busy: this.busy,
      stage: this.stage,
      docName: d?.name ?? null,
      parsed: !!d && !this.busy,
      kind: d?.kind ?? null,
      units: d?.scene.units ?? '',
      moves: d?.nc?.moves.count ?? 0,
      lines: d ? (d.nc?.source.lineCount ?? d.mpr?.lines.length ?? 0) : 0,
      segments: c?.segments ?? 0,
      tools: d?.nc?.tools.length ?? 0,
      operations: d && isPanelKind(d.kind) ? mprOps(d.scene).length : 0,
      warnings: d?.scene.warnings?.length ?? 0,
      sceneIssues: d ? this.sceneIssues().length : 0,
      error: this.error,
      panelOpen: this.panelOpen && !!d,
      panelTab: this.panel.tab,
      playing: this.playing,
      playSec: d?.playSec ?? null,
      selLine: d?.selLine ?? -1,
      jobFiles: d?.job ? [...d.job.files] : null,
      sim: this.sim?.state() ?? null,
      theme: this.theme,
      measuring: this.measuring,
      aiming: !!this.aim?.aiming,
      measureLock: this.measuring ? (this.mlock?.snapshot() ?? null) : null,
      measureLoading: !!this.measureFirstUse.wanted,
      measureTools: !!this.mlock,
      section: (() => {
        const sc = this.viewer?.section;
        return sc ? { axis: sc.axis, t: sc.t, flip: sc.flip } : null;
      })(),
    };
  }

  private exposeApi(): void {
    const app = this;
    const api: OpencadAppApi = {
      get state() {
        return app.state();
      },
      get viewer() {
        return app.viewer;
      },
      open: (name, data, opts) => {
        const buf = typeof data === 'string' ? (new TextEncoder().encode(data).buffer as ArrayBuffer) : data instanceof Uint8Array ? (data.slice().buffer as ArrayBuffer) : data;
        return app.openBuffer(name, buf, opts);
      },
      openJob: (files) => app.openFiles(files.map(asFile)),
      addFiles: (files) => app.addFiles(files.map(asFile)),
      openUrl: (url, name) => app.openUrl(url, name),
      openSample: () => app.openSample(),
      reparse: (opts) => app.reparse(opts),
      setTheme: (t) => app.setTheme(t, true),
      togglePanel: (on) => app.togglePanel(on),
      setPanelTab: (tab) => {
        const d = app.doc;
        if (!d) return;
        d.panelTab = tab as NcDoc['panelTab'];
        app.panel.show(d);
      },
      selectLine: (line) => app.selectLine(line, undefined, true),
      seek: (sec) => app.seek(sec),
      stepMove: (delta) => app.stepMove(delta),
      drawToLine: (line) => app.drawToLine(line),
      togglePlay: () => app.togglePlay(),
      cancel: () => app.cancelLoad(),
      setSection: (axis, t, flip) => app.setSectionAxis(axis, t, flip),
      setSim: (on, opts) => app.setSim(on, opts),
    };
    window.opencadApp = api;
  }
}
