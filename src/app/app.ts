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
 * - 최근 문서: 파일 고르기·끌어다 놓기로 연 파일을 이 브라우저(IndexedDB, recent.ts)에 두고 시작 화면에서 바로 다시 연다
 *   (휴대폰 브라우저가 뒤로 간 탭을 버렸다가 다시 읽어도 파일 앱을 다시 거치지 않게). 예제·주소로 연 파일은 두지 않는다.
 *
 * 2dcad-viewer 커밋 d7c584a의 src/app/view3d/manager.ts에서 NC 부분을 옮겨 2D 화면 골격 없이 다시 짰다.
 */
import type { MeasureResult, Pick3d, RenderMode, SectionAxis, SectionState, ViewName, Viewer3d } from 'opencad-viewer3d';
import { VIEW_LABELS } from 'opencad-viewer3d/camera';
import { GCODE_EXTENSIONS, HEIDENHAIN_EXTENSIONS, MPR_EXTENSIONS, PGI_EXTENSIONS, XML_EXTENSIONS, isPanelKind } from '../extensions';
import { NC_SAMPLE_NAME, ncSampleProgram } from '../view/sample';
import { PLAY_SPEEDS, advance, formatDuration, lastMoveOfLine, moveEndTime, pointAlong, stepTarget, totalTime, type PlaySpeed } from '../view/playback';
import { TouchAim } from './aim';
import { loadViewerCore } from './core';
import { ParseWorkerClient } from './client';
import { beginOpen, showAnalyticsSettings, trackExport, type OpenAttempt } from 'opencad-site-kit/analytics';
import { formatRecentTime, RecentStore, type RecentEntry } from './recent';
import { loadSettings, saveSettings, settingsNeedReparse, settingsOpenOptions, type NcSettings } from './settings';
import { createDoc, lineLabel, lineMoveList, moveEndPoint, moveSegments, moveState, mprOps, noticeViews, playPosition, replaceResult, sceneCounts, sceneFeatures, selectionSummary, statusParts, toolMarker, unitLabel, warningLabel, type NcDoc } from './doc';
import { h, toast } from './dom';
import { BINARY_MESSAGE, extensionList, fileAccept, fmtNum, formatBytes, isNcFileName, looksBinary, parseOnceParams, parseStartParams, shareErrorText, withoutOnceParams } from './format';
import { icon, type IconName } from './icons';
import { isEditableTarget, keyAction, viewKeyOf } from './keys';
import { measureHint, measureLines } from './measure';
import { NARROW_WIDTH, NcPanel, type PanelHost } from './panel';
import { arcCenters, moveSnapPoints, panelCenters, panelSnapPoints, snapPair, type ArcCenters } from './snap';
import { errorText, sceneHasGeometry, type NcKind, type NcOpenOptions } from './protocol';
import { canUseServiceWorker, consumeLaunchFiles, registerServiceWorker, whenVisible, type SwContainer } from 'opencad-site-kit/pwa/client';
import { otherTheme, readThemePref, resolveTheme, safeStorage, writeThemePref, type ThemeName } from './theme';
import type { SimHost, SimState, SimView } from './sim';

export const APP_TITLE = 'OpenCAD NC 뷰어';
const TOOLS_URL = 'https://gyutae-kim.github.io/opencad';
const REPO_URL = 'https://github.com/GyuTae-Kim/opencad-nc';

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
  private panelOpen = !isPhone();
  private playing = false;
  private raf = 0;
  private lastT = 0;
  speed: PlaySpeed = 10;
  private busy = false;
  private stage = '';
  private error: string | null = null;
  private loadSeq = 0;
  private ready = false;
  private openMenu: { wrap: HTMLElement; close: () => void } | null = null;
  private readonly coarse: MediaQueryList | null;
  /** 정밀 조준(터치 길게 누르기, 뷰어를 만들 때 붙인다) */
  private aim: TouchAim | null = null;
  /** 원호 중심 붙잡기 점(해석 결과마다 한 번 — 측정을 처음 켤 때 만든다) */
  private readonly snapCenters = new WeakMap<object, ArcCenters>();
  /** 지금 코어에 준 측정 붙잡기(해석 결과가 같으면 다시 주지 않고, 재생 중에는 붙잡기 한도만 바꾼다) */
  private snapKey: { src: object; limit: number | null } | null = null;
  /** 최근 문서(이 브라우저의 IndexedDB) */
  readonly recent: RecentStore;
  private recentSeq = 0;
  /** 다음 파일 고르기가 열린 작업에 더할 파일인지 */
  private pickAdd = false;
  /** 소재 깎기 시뮬레이션(켤 때 나눠 받는다 — sim.ts) */
  private sim: SimView | null = null;
  private simLoad: Promise<SimView> | null = null;

  // ── 화면 요소 ──
  private readonly root: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly docNameEl: HTMLSpanElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly workspace: HTMLElement;
  private readonly viewEl: HTMLDivElement;
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
  private readonly aimLayer: HTMLDivElement;
  private readonly noticeBar: HTMLDivElement;
  /** 패널을 닫은 채(휴대폰 등) 재생할 때 3D 보기 아래 재생 띠 */
  private readonly playStrip: { el: HTMLDivElement; time: HTMLSpanElement; line: HTMLSpanElement; state: HTMLDivElement; play: HTMLButtonElement; range: HTMLInputElement; speed: HTMLSelectElement };
  private sec!: { btn: HTMLButtonElement; axes: { axis: SectionAxis | null; el: HTMLButtonElement }[]; range: HTMLInputElement; flip: HTMLButtonElement; val: HTMLSpanElement };

  constructor(root: HTMLElement, opts: NcViewerAppOptions = {}) {
    root.addEventListener('languagechange', () => {
      if (this.viewer) this.viewer.setViewCubeSize(this.viewer.viewCubeSize);
      // 최근 문서의 시각 글을 화면 언어 형식으로
      void this.renderRecent();
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
    const settings = this.menu('settings', this.themeBtn, [themeChoice, analyticsChoice], false);
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
    this.busyStage = h('div', { class: 'busy-stage' }, '여는 중…');
    this.busyBar = h('div', { class: 'bar' });
    this.busyName = h('div', { class: 'busy-name' });
    this.busyCancel = h('button', { class: 'btn small busy-cancel', type: 'button', title: '읽기 멈추기 (Esc) — 열린 문서는 그대로 둡니다' }, '취소');
    this.busyCancel.addEventListener('click', () => this.cancelLoad());
    this.busyEl = h(
      'div',
      { class: 'busy', hidden: true, role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'busy-card' }, this.busyStage, h('div', { class: 'progress', 'aria-hidden': 'true' }, this.busyBar), h('div', { class: 'busy-foot' }, this.busyName, this.busyCancel)),
    );
    // ── 측정 띠(좁은 화면·터치에서 측정 중): 안내·결과를 크게 보이고, Esc 대신 다시 재기·끝내기 단추 ──
    this.measureText = h('div', { class: 'mb-text', 'aria-live': 'polite' });
    this.measureClear = h('button', { class: 'mb-btn', type: 'button', title: '찍은 점과 결과 지우기', html: `${icon('reset')}<span>다시 재기</span>` });
    this.measureClear.addEventListener('click', () => {
      this.viewer?.clearMeasure();
      this.refreshBar();
    });
    const measureClose = h('button', { class: 'mb-btn icon', type: 'button', title: '측정 끝내기', 'aria-label': '측정 끝내기', html: icon('close') });
    measureClose.addEventListener('click', () => this.toggleMeasure(false));
    this.measureBar = h('div', { class: 'measure-bar', role: 'group', 'aria-label': '측정', hidden: true }, this.measureText, h('div', { class: 'mb-acts' }, this.measureClear, measureClose));
    // 정밀 조준 십자선 층(캔버스 위, 누르기는 받지 않는다)
    this.aimLayer = h('div', { class: 'aim-layer', 'aria-hidden': 'true' });
    // 해석 판단 띠(선반 자동·소수점 없는 좌표·판별한 방언)
    this.noticeBar = h('div', { class: 'notice-bar', role: 'status', 'aria-live': 'polite', hidden: true });
    this.playStrip = this.buildPlayStrip();
    this.viewEl.append(this.aimLayer, this.measureBar, this.noticeBar, this.playStrip.el);
    // 알림은 3D 보기 아래쪽 띠(해석 판단·재생·측정) 위로 올린다 — 띠가 나타나거나 크기가 바뀌면 다시 잰다
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.liftToasts());
      for (const el of [this.noticeBar, this.playStrip.el, this.measureBar]) ro.observe(el);
    }
    this.workspace.append(this.viewEl, this.startEl);
    this.panel = new NcPanel(this, this.workspace);
    this.workspace.append(this.busyEl);

    // ── 상태 막대 ──
    this.stMain = h('span', { class: 'st-main' });
    this.stSel = h('span', { class: 'st-sel' });
    this.stWarn = h('button', { class: 'st-warn', type: 'button', hidden: true, title: '해석 경고 보기(패널 정보 탭)' });
    this.stWarn.addEventListener('click', () => this.showInfoTab());
    const status = h('footer', { class: 'statusbar', 'aria-live': 'polite' }, this.stMain, this.stWarn, this.stSel);

    this.dropMask = h('div', { class: 'dropmask', hidden: true, 'aria-hidden': 'true' }, h('div', { html: `${icon('drop')}<span>놓으면 엽니다</span>` }));

    root.textContent = '';
    root.classList.add('no-doc');
    root.append(titlebar, toolbar, this.workspace, status, this.fileInput, this.dropMask);

    this.bindDrop();
    window.addEventListener('keydown', (ev) => this.onKey(ev), true);
    document.addEventListener('pointerdown', (ev) => {
      if (this.openMenu && !this.openMenu.wrap.contains(ev.target as Node)) this.closeMenu();
    });
    try {
      window.matchMedia(PHONE_QUERY).addEventListener('change', () => {
        // 넓은 화면 ↔ 휴대폰: 막대 단추가 바뀌므로 펼친 메뉴를 닫는다
        this.closeMenu();
        this.viewer?.setViewCubeSize(this.cubeSizeFor());
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
        h('p', { class: 'lead' }, 'G-code·Heidenhain 평문·woodWOP MPR·WangShi PGI·XML 파일을 열면 공구 경로를 돌려 보고, 코드 줄과 이동을 함께 짚고, 가공 순서를 재생할 수 있습니다.'),
        zone,
        this.startError,
        this.recentCard,
        h(
          'dl',
          { class: 'formats', 'aria-label': '지원 형식' },
          fmt('G-code', GCODE_EXTENSIONS, 'ISO·Fanuc·LinuxCNC·GRBL·Mach3 방언 자동 판별, 원호·나선, 고정 사이클, 부프로그램, 변수, 좌표 회전·배율·거울, 반경 보정 경로·선반·회전축(선택)'),
          fmt('Heidenhain 평문', HEIDENHAIN_EXTENSIONS, 'BLK FORM 공작물, TOOL CALL, L·C·CR·CT·FK, 드릴·포켓 사이클, Q 변수'),
          fmt('woodWOP MPR', MPR_EXTENSIONS, '판, 수직·수평 드릴, 윤곽 가공, 홈, 포켓, 엣지 밴딩, 변수'),
          fmt('WangShi PGI · XML', [...PGI_EXTENSIONS, ...XML_EXTENSIONS], '판·외곽선, 여섯 면 구멍, 도어 컵, 톱 홈, 사각·원형 포켓, 경로(bulge 호), 변수'),
        ),
        h('p', { class: 'privacy', html: `${icon('lock')}<span><b>파일은 이 브라우저 밖으로 나가지 않습니다.</b> 서버로 올리지 않고 이 기기 안에서 읽습니다.</span>` }),
        h('p', { class: 'keys fine-only' }, '키: F 전체 보기 · 1~7 표준 뷰 · F7 격자 · Space 재생/멈춤 · Esc 고른 것 지우기 · Ctrl+O 열기'),
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
    const label = `최근 문서에서 ${e.name} 지우기`;
    const del = h('button', { class: 'recent-del', type: 'button', title: label, 'aria-label': label, html: icon('close') });
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
      const checked = list.querySelector<HTMLElement>('[aria-checked="true"]');
      (checked ?? items[0])?.focus();
    });
    list.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('button')) {
        close();
        button.focus();
      }
    });
    list.addEventListener('keydown', (ev) => {
      // 숨긴 항목(문서에 따라 — 소재 깎기)은 건너뛴다
      const shown = items.filter((b) => !b.hidden);
      const i = shown.indexOf(document.activeElement as HTMLButtonElement);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const n = shown.length;
        shown[(i + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
      }
    });
    this.tools[key] = { el: button, needsDoc };
    return wrap;
  }

  private closeMenu(): void {
    this.openMenu?.close();
    this.openMenu = null;
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
    e.val.textContent = s ? `${s.axis ? s.axis.toUpperCase() : '평면'} = ${fmtNum(s.position)}${u ? ` ${u}` : ''}${s.flip ? ' (뒤집음)' : ''}` : '꺼짐';
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

  /** 단면 손잡이 끌기 → moveSectionByPixels(UI는 알림으로 맞춘다) */
  private makeSecHandle(): HTMLDivElement {
    const el = h('div', { class: 'sec-handle', hidden: true, title: '끌어서 단면 옮기기', 'aria-hidden': 'true' });
    let last: { x: number; y: number; id: number } | null = null;
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      last = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      el.classList.add('dragging');
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* 합성 사건 */
      }
    });
    el.addEventListener('pointermove', (ev) => {
      if (!last || ev.pointerId !== last.id) return;
      this.viewer?.moveSectionByPixels(ev.clientX - last.x, ev.clientY - last.y);
      last = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    });
    const end = (): void => {
      last = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    return el;
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
      this.showError(`${bad.join(', ')}: ${BINARY_MESSAGE}`);
      attempt.error('unsupported');
      return false;
    }
    if (bad.length) toast(`읽지 않은 파일: ${bad.join(', ')}`, 'info', 6000);
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
    if (bad.length) toast(`읽지 않은 파일: ${bad.join(', ')}`, 'info', 6000);
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
        this.showError(`${f.name}: ${BINARY_MESSAGE}`);
        attempt.error('unsupported');
        return false;
      }
      buf = await f.arrayBuffer();
    } catch (e) {
      this.showError(`${f.name}: 파일을 읽지 못했습니다(${errorText(e)}).`);
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
    this.closeMenu();
    this.setBusy('최근 문서 읽는 중', 0.02, e.name);
    const r = await this.recent.read(e.id);
    if (seq !== this.loadSeq) return false;
    if (r.kind !== 'ok') {
      this.setBusy(null);
      attempt.error('read_error');
      if (r.kind === 'missing') {
        this.showError(`${e.name}: 이 브라우저에 저장된 내용을 찾지 못해 최근 문서에서 지웠습니다.`);
        await this.recent.remove(e.id);
        await this.renderRecent();
      } else this.showError(`${e.name}: 이 브라우저에 저장된 내용을 읽지 못했습니다. 잠시 뒤 다시 눌러 보십시오.`);
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
    const rows = [...this.recentList.children];
    const at = rows.findIndex((li) => li.contains(document.activeElement));
    if (!(await this.recent.remove(id))) toast('최근 문서를 지우지 못했습니다. 잠시 뒤 다시 해 보십시오.', 'error', 5000);
    await this.renderRecent();
    if (at < 0) return;
    const next = this.recentList.children[Math.min(at, this.recentList.children.length - 1)];
    (next?.querySelector<HTMLElement>('.recent-del') ?? this.startEl.querySelector<HTMLElement>('.dropzone'))?.focus();
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
    const bytes = new TextEncoder().encode(ncSampleProgram());
    return this.openBuffer(NC_SAMPLE_NAME, bytes.buffer as ArrayBuffer, {}, beginOpen('sample', 'nc'));
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
        this.showError(`${label}: ${errorText(e)}`);
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
    this.closeMenu();
    this.setBusy('여는 중', 0.02, name);
    // 첫 문서면 3D 뷰어 코어를 해석과 함께 받기 시작한다(실패는 ensureViewer가 알린다)
    if (!this.viewer) void loadViewerCore().catch(() => undefined);
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
        const why = res.scene.warnings?.[0];
        throw new Error(`그릴 공구 경로를 찾지 못했습니다. 이동 명령(G0·G1·L 등)이 없는 프로그램일 수 있습니다.${why ? ` (해석 경고: ${why})` : ''}`);
      }
      await this.ensureViewer();
      if (seq !== this.loadSeq) return false;
      // 여러 파일 작업이면 이름 = 주 프로그램, 크기 = 이은 글
      this.setDoc(createDoc(res.job?.main ?? name, res.job && res.nc ? res.nc.source.bytes.length : size, res, opts));
      attempt.success();
      return true;
    } catch (e) {
      if (seq === this.loadSeq) {
        this.showError(`${name}: ${errorText(e)}`);
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
    const unitsChanged = (opts.units ?? 'mm') !== (d.ncOptions.units ?? 'mm') || opts.lathe !== d.ncOptions.lathe || !!opts.rotary !== !!d.ncOptions.rotary || !!opts.integerUnits !== !!d.ncOptions.integerUnits || (opts.jobMain ?? d.name) !== (d.ncOptions.jobMain ?? d.name);
    const seq = ++this.loadSeq;
    this.setBusy('다시 읽는 중', 0.05, d.name);
    try {
      const res = await this.client.open(d.name, copy, { ...opts, ...settingsOpenOptions(this.settings) }, (f, stage) => {
        if (seq === this.loadSeq) this.setBusy(stage, f, d.name);
      });
      if (seq !== this.loadSeq || this.doc !== d) return;
      if (!sceneHasGeometry(res.scene)) throw new Error('이 설정으로는 그릴 공구 경로가 없습니다.');
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
      toast(`${d.name}: 다시 읽었습니다.`, 'info', 2500);
    } catch (e) {
      if (seq === this.loadSeq) this.showError(`${d.name}: 다시 읽지 못했습니다 — ${errorText(e)}`);
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
    this.busy = stage !== null;
    this.stage = stage ?? '';
    this.busyEl.hidden = !this.busy;
    this.root.classList.toggle('is-busy', this.busy);
    this.refreshBar();
    if (!this.busy) return;
    // 줄임표는 따로 둔다(단계 글만 번역 사전에서 찾게)
    this.busyStage.replaceChildren(document.createTextNode(this.stage), document.createTextNode('…'));
    this.busyBar.style.width = `${Math.round(Math.max(0.02, Math.min(1, fraction)) * 100)}%`;
    this.busyName.textContent = name;
  }

  private showError(msg: string): void {
    this.error = msg;
    if (this.doc) {
      toast(msg, 'error', 8000);
      return;
    }
    this.startError.textContent = msg;
    this.startError.hidden = false;
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
    if (this.viewer) return;
    let core: Awaited<ReturnType<typeof loadViewerCore>>;
    try {
      core = await loadViewerCore();
    } catch (e) {
      throw new Error(`3D 보기를 만들지 못했습니다: ${errorText(e)}`);
    }
    if (this.viewer) return;
    this.viewEl.hidden = false;
    let v: Viewer3d;
    try {
      v = new core.Viewer3d(this.viewEl, { theme: this.theme, viewCubeSize: this.cubeSizeFor() });
    } catch (e) {
      if (!this.doc) this.viewEl.hidden = true;
      throw new Error(`3D 보기를 만들지 못했습니다: ${errorText(e)}`);
    }
    this.viewer = v;
    this.applyThemeUi();
    v.onPick((p) => this.onPick(p));
    v.onMeasure((m) => this.onMeasure(m));
    this.secHandle = this.makeSecHandle();
    this.viewEl.append(this.secHandle);
    v.onSectionChange((st) => this.renderSection(st));
    v.onCameraChange(() => this.placeSecHandle());
    this.renderSection(null);
    // 측정 중 길게 눌러 정밀 조준(떼면 코어가 십자선 자리를 누른 것으로 처리한다)
    this.aim = new TouchAim(v.canvas, { enabled: () => !!this.doc && v.measureMode && !this.busy, layer: this.aimLayer });
    // 첫 측정 점은 코어 알림이 없어(결과가 생길 때만) 떼기 뒤에 띠를 맞춘다(코어 듣기 다음, 버블 단계)
    this.viewEl.addEventListener('pointerup', () => {
      if (v.measureMode) this.refreshBar();
    });
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
    this.applyDoc(d, null);
    this.panel.show(d);
    this.panel.setOpen(this.panelOpen);
    this.docNameEl.textContent = d.name;
    this.docNameEl.title = d.name;
    document.title = `${d.name} - ${APP_TITLE}`;
    this.renderToolbar();
    this.renderStatus();
    const w = d.scene.warnings?.length ?? 0;
    // 선반 자동·소수점 없는 좌표·판별한 방언은 3D 보기 위 띠로(행동 단추와 함께), 경고는 알림으로
    this.renderNotices();
    if (w) toast(`해석 경고 ${w.toLocaleString('ko-KR')}개 — 패널의 "정보" 탭에서 볼 수 있습니다.`, 'info', 4500);
    // 코어 0.9.0부터 캔버스는 키보드 초점(:focus-visible)에 테두리를 그린다. 스크립트 초점은 브라우저가 입력 없이 연 경우(?sample·
    // 공유·파일 연결로 연 첫 화면)에도 테두리를 보이므로, 앞서 초점을 가진 것이 키보드 초점이었을 때만(열기 단추·최근 문서를 키보드로) 보인다
    const prev = document.activeElement;
    const keyboard = !!prev && prev !== document.body && matchesFocusVisible(prev);
    this.viewer?.canvas.focus({ preventScroll: true, focusVisible: keyboard } as FocusOptions);
  }

  /** 문서의 장면과 보기 상태를 뷰어에 올린다(cam을 주면 그 카메라를 지킨다) */
  private applyDoc(d: NcDoc, cam: ReturnType<Viewer3d['getCamera']> | null): void {
    const v = this.viewer;
    if (!v) return;
    // 깎기 시뮬레이션이 켜져 있으면 문서 장면 + 소재 그물(sim.ts)
    v.setScene(this.sim?.sceneFor(d) ?? d.scene, { keepView: !!cam });
    if (cam) v.setCamera(cam);
    // 선반: XZ 단면이 보이게 앞에서
    else if (sceneFeatures(d.scene).lathe) v.setView('front', false);
    for (const g of d.hiddenGroups) v.setGroupVisible(g, false);
    v.highlight(d.highlight.length ? d.highlight : null);
    // 새 장면은 코어가 찍은 측정 점을 지운다(측정 모드는 그대로)
    this.aim?.cancel();
    d.measure = null;
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
    d.measure = m;
    this.panel.onMeasure();
    this.renderStatus();
  }

  fitItems(ids: string[]): void {
    if (ids.length) this.viewer?.fitItems(ids);
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

  /** MPR 가공 고르기 */
  selectMprOp(i: number, reveal = false): void {
    const d = this.doc;
    if (!d) return;
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
  }

  toggleAxes(on?: boolean): void {
    const v = this.viewer;
    if (!v) return;
    v.setAxesVisible(on ?? !v.axesVisible);
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

  toggleMeasure(on = !this.measuring): void {
    const v = this.viewer;
    if (!v) return;
    if (on !== v.measureMode) this.aim?.cancel();
    v.setMeasureMode(on);
    this.syncMeasureSnap();
    if (!on && this.doc) this.doc.measure = null;
    this.panel.onMeasure();
    this.renderToolbar();
    this.renderStatus();
    this.refreshPlayStrip();
  }

  togglePanel(on = !this.panelOpen): void {
    this.panelOpen = on;
    this.panel.setOpen(on);
    this.renderToolbar();
    this.refreshPlayStrip();
    // 좁은 화면에서는 시트가 3D 보기 높이를 바꾸므로 크기가 정해진 뒤 다시 맞춘다
    if (window.innerWidth < NARROW_WIDTH && this.viewer) requestAnimationFrame(() => requestAnimationFrame(() => this.viewer?.fit(false)));
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
      const b = await v.toBlob('image/png');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${d.name.replace(/\.[^.]+$/, '') || 'opencad-nc'}.png`;
      a.click();
      trackExport('png');
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('지금 화면을 PNG로 저장했습니다.', 'info', 2500);
    } catch (e) {
      toast(`그림을 저장하지 못했습니다: ${errorText(e)}`, 'error');
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
      toast(`시뮬레이션을 불러오지 못했습니다: ${errorText(e)}`, 'error');
      return;
    }
    if (opts) s.setOptions(opts);
    s.setOn(on ?? !s.on);
  }

  /** 패널 "깎기" 탭(모듈을 받기 전이면 받은 뒤 다시 그린다) */
  renderSimTab(body: HTMLElement, d: NcDoc): void {
    if (this.sim) return this.sim.renderTab(body, d);
    body.append(h('p', { class: 'hint' }, '불러오는 중…'));
    void this.ensureSim().then(() => this.panel.refresh(), () => undefined);
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
   * 중심이 512개 이상이면 코어가 점 범위 나무(BVH)로 커서 둘레만 본다. 반경 보정 경로는 보정 조각의 가운데 점·호 중심.
   * 판재 가공(MPR·PGI·XML)은 워커가 보낸 붙잡기 표로 윤곽·판 외곽선의 원호 중심, 원형 포켓 중심, 고른 윤곽 요소의 가운데 점과 추론 붙잡기.
   * 측정 밖에서는 끈다(코어 기본 — 꼭짓점·끝점)
   */
  private syncMeasureSnap(): void {
    const v = this.viewer;
    if (!v) return;
    const d = this.doc;
    const nc = d?.nc;
    const panel = d && !nc ? (d.mpr?.snap ?? null) : null;
    if (!d || (!nc && !panel) || !v.measureMode) {
      if (this.snapKey) v.setMeasureSnap(null);
      this.snapKey = null;
      return;
    }
    if (panel) {
      if (this.snapKey?.src === panel) return;
      this.snapKey = { src: panel, limit: null };
      v.setMeasureSnap({ points: panelCenters(panel), pointsFor: (p) => panelSnapPoints(p, panel), inference: true });
      return;
    }
    if (!nc) return;
    let c = this.snapCenters.get(nc);
    if (!c) this.snapCenters.set(nc, (c = arcCenters(nc)));
    const pos = d.playSec === null ? null : playPosition(d);
    // 재생 중에는 그린 이동까지의 중심(차례 = 처음 그린 이동 번호 < 한도). 점 목록·색인은 문서마다 한 번만 주고 한도만 바꾼다(코어 0.10.0)
    const limit = pos && pos.move >= 0 ? pos.move + 1 : null;
    if (this.snapKey?.src === nc) {
      if (this.snapKey.limit === limit) return;
      v.setMeasureSnapLimit(limit);
    } else v.setMeasureSnap({ points: c.points, pointsFor: (p) => moveSnapPoints(p, nc), inference: true, limit });
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
    pressed('measure', this.measuring);
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
    // 깎기: G-code·Heidenhain 문서에만
    const simOn = !!this.sim?.on;
    for (const el of [more.sim, ...this.simWide]) el.hidden = !this.doc?.nc;
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
    const sel = selectionSummary(d, this.measuring, this.touch);
    // 측정 결과의 붙잡은 종류(예: 중심 → 끝점)는 이름마다 따로 번역되게 조각으로 붙인다
    const sp = d.measure ? snapPair(d.measure) : null;
    this.stSel.replaceChildren(sel, ...(sp ? [' · ', h('span', {}, sp[0]), ' → ', h('span', {}, sp[1])] : []));
    this.stSel.title = sel;
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
    const line = h('span', { class: 'ps-line' });
    const state = h('div', { class: 'ps-state' });
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

  /** 재생 띠: 패널이 닫혔고 재생 중이거나 재생 자리가 있으면(측정 중이 아니면) 보인다 */
  private refreshPlayStrip(): void {
    const s = this.playStrip;
    const d = this.doc;
    const info = this.playbackInfo();
    const on = !!d && !!info && !this.panelOpen && !this.busy && !this.measuring && (this.playing || d.playSec !== null);
    s.el.hidden = !on;
    if (!on || !d || !info) return;
    s.time.textContent = `${formatDuration(info.sec)} / ${formatDuration(info.total)}`;
    s.line.textContent = info.line >= 0 && this.doc ? lineLabel(this.doc, info.line) : '';
    const st = d.nc && info.move >= 0 ? moveState(d.nc, info.move, unitLabel(d.scene.units)) : null;
    s.state.textContent = st ? `${st.motion} · ${st.modal}` : '';
    s.play.innerHTML = icon(this.playing ? 'pause' : 'play');
    s.play.setAttribute('aria-label', this.playing ? '재생 멈춤' : '재생');
    s.play.title = this.playing ? '재생 멈춤' : '재생';
    s.range.value = String(info.total > 0 ? Math.round((info.sec / info.total) * 1000) : 1000);
    s.speed.value = String(this.speed);
  }

  /** 해석 판단 띠: 선반 자동·소수점 없는 좌표·판별한 방언. 단추는 다른 설정으로 다시 읽거나 패널 탭을 연다, ✕는 이 문서에서 닫는다 */
  private renderNotices(): void {
    const d = this.doc;
    const bar = this.noticeBar;
    bar.replaceChildren();
    const list = d ? noticeViews(d) : [];
    bar.hidden = !list.length;
    for (const n of list) {
      // 좁은 화면은 글을 한두 줄로 줄여 보이고(3D 보기를 덜 가리게), 글을 누르면 펼친다
      const text = h('span', { class: 'nt-text', title: n.text }, n.text);
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
  }

  /** 알림이 3D 보기 아래쪽 띠를 가리지 않게: 화면 아래쪽에 붙은 띠 가운데 맨 위의 높이(화면 아래에서 잰 px)를 --toast-clear로 */
  private liftToasts(): void {
    const vh = window.innerHeight;
    let top = Infinity;
    for (const el of [this.noticeBar, this.playStrip.el, this.measureBar]) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > vh / 2 && r.top < top) top = r.top;
    }
    document.body.style.setProperty('--toast-clear', Number.isFinite(top) ? `${Math.max(0, Math.round(vh - top + 8))}px` : '0px');
  }

  /** 측정 띠: 측정 중이면 다음에 누를 곳 안내나 결과(거리와 dx·dy·dz). 보이는 곳은 CSS가 정한다(좁은 화면·터치) */
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
      if (sp) t.append(h('span', { class: 'mb-sub mb-snap' }, h('span', {}, sp[0]), ' → ', h('span', {}, sp[1])));
    } else t.append(h('span', { class: 'mb-hint' }, measureHint(v.measurePointCount, false, this.touch)));
    this.measureClear.disabled = !d.measure && !v.measurePointCount;
  }

  // ───────────────────────── 키 ─────────────────────────

  private onKey(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement | null;
    // The language menu owns its keyboard focus, including Escape during loading.
    if (t?.closest?.('.language-control, .language-list')) return;
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
    // 범위 막대(재생 위치)는 화살표를 스스로 쓴다
    const onSlider = !!t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range';
    const a = keyAction({
      key: ev.key,
      ctrl: ev.ctrlKey,
      meta: ev.metaKey,
      alt: ev.altKey,
      editable: isEditableTarget(t as (HTMLElement & { type?: string }) | null) || (onSlider && ev.key.startsWith('Arrow')),
      onButton: !!t && (t.tagName === 'BUTTON' || t.getAttribute?.('role') === 'button' || t.tagName === 'A'),
      onCanvas: !!v && t === v.canvas,
      hasDoc: !!this.doc && !!v && !this.busy,
      canPlay: this.canPlay(),
      shift: ev.shiftKey,
      inCode: !!t?.closest?.('.code-list, .code-search'),
      hasCode: !!this.doc && (!!this.doc.nc || !!this.doc.mpr),
    });
    if (!a) return;
    if (a.type === 'open') {
      // 열기는 문서·뷰어가 없어도(시작 화면) 된다
      ev.preventDefault();
      ev.stopPropagation();
      this.chooseFile();
      return;
    }
    if (!v) return;
    switch (a.type) {
      case 'viewer':
        // F·1~7(·측정 점이 있을 때 Esc)은 뷰어 규칙대로. 받지 않은 키는 그대로 흘려보낸다
        if (v.handleKey(ev)) ev.stopPropagation();
        return;
      case 'escape':
        if (a.canvas) {
          // 캔버스도 Esc를 받아 뷰어가 측정을 지운다(막지 않는다). 앱은 측정 중이 아닐 때 고른 것만 지운다
          if (!v.measureMode) this.clearSelection();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        // 측정 중이면 측정 먼저: 찍힌 점이 있으면 뷰어가 지우고, 없으면 측정을 끈다. 아니면 고른 것을 지운다
        if (v.measureMode) {
          if (!v.handleKey(ev)) this.toggleMeasure(false);
        } else this.clearSelection();
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (a.type === 'grid') this.toggleGrid();
    else if (a.type === 'step') this.stepMove(a.delta);
    else if (a.type === 'line') this.stepLine(a.delta);
    else if (a.type === 'find') this.openFind(a.next);
    else this.togglePlay();
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
