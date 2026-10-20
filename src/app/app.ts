/**
 * OpenCAD NC 뷰어 앱: 제목 막대 · 보기 도구 막대 · 3D 보기 + 패널 · 상태 막대를 만들고, 파일 열기·해석(워커)·보기·재생을 잇는다.
 *
 * - 한 번에 문서 하나. 새 파일을 열면 바꾼다(열기에 실패하면 앞 문서를 그대로 둔다).
 * - 해석은 웹 워커(src/worker/parse.worker.ts)에서 하고, 진행률·단계 글을 작업 영역 위 덮개로 보인다.
 * - 뷰어(Viewer3d)는 첫 문서를 열 때 만든다(WebGL2가 없으면 그때 알기 쉬운 오류 글).
 * - 키: 캔버스에 초점이 있으면 뷰어가 F·1~7·Esc를 직접 받고, 다른 곳이면 창 캡처 단계에서 같은 키를 뷰어로 보낸다
 *   (입력 칸 제외). F7 = 격자, Space = 재생/멈춤, Ctrl/⌘+O = 열기.
 * - 자동 확인용으로 window.opencadApp(상태·열기 함수)을 둔다.
 *
 * 2dcad-viewer 커밋 d7c584a의 src/app/view3d/manager.ts에서 NC 부분을 옮겨 2D 화면 골격 없이 다시 짰다.
 */
import { VIEW_LABELS, Viewer3d, type MeasureResult, type Pick3d, type RenderMode, type SectionAxis, type SectionState, type ViewName } from 'opencad-viewer3d';
import { GCODE_EXTENSIONS, HEIDENHAIN_EXTENSIONS, MPR_EXTENSIONS } from '../extensions';
import { NC_SAMPLE_NAME, ncSampleProgram } from '../view/sample';
import { PLAY_SPEEDS, advance, playbackAt, pointAlong, totalTime, type PlaySpeed } from '../view/playback';
import { ParseWorkerClient } from './client';
import { beginOpen, showAnalyticsSettings, trackExport, type OpenAttempt } from './analytics';
import { createDoc, lineMoveList, moveEndPoint, moveSegments, mprOps, replaceResult, sceneCounts, sceneFeatures, selectionSummary, statusParts, warningLabel, type NcDoc } from './doc';
import { h, toast } from './dom';
import { extensionList, fileAccept, fmtNum, parseStartParams } from './format';
import { icon, type IconName } from './icons';
import { isEditableTarget, keyAction, viewKeyOf } from './keys';
import { NARROW_WIDTH, NcPanel, type PanelHost } from './panel';
import { errorText, sceneHasGeometry, type NcKind, type NcOpenOptions } from './protocol';
import { otherTheme, readThemePref, resolveTheme, safeStorage, writeThemePref, type ThemeName } from './theme';

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
  /** 단면 보기(꺼져 있으면 null) */
  section: { axis: SectionAxis | null; t: number; flip: boolean } | null;
}

export interface OpencadAppApi {
  readonly state: AppState;
  readonly viewer: Viewer3d | null;
  open(name: string, data: ArrayBuffer | Uint8Array | string, opts?: NcOpenOptions): Promise<boolean>;
  openUrl(url: string, name?: string): Promise<boolean>;
  openSample(): Promise<boolean>;
  reparse(opts: NcOpenOptions): Promise<void>;
  setTheme(t: ThemeName): void;
  togglePanel(on?: boolean): void;
  setPanelTab(tab: string): void;
  selectLine(line: number): void;
  seek(sec: number | null): void;
  togglePlay(): void;
  /** 읽는 중이면 멈춘다(앞 문서는 그대로). 멈췄으면 true */
  cancel(): boolean;
  /** 단면 보기: 축과 범위 안 위치(0~1), null이면 끈다 */
  setSection(axis: SectionAxis | null, t?: number, flip?: boolean): void;
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

/** 단추 하나(그림 + 글). 좁은 화면에서는 글을 숨기고 그림만 */
function tbtn(ic: IconName, label: string, title: string, cls = ''): HTMLButtonElement {
  return h('button', { class: `tbtn ${cls}`.trim(), type: 'button', title, 'aria-label': label, html: `${icon(ic)}<span class="lbl">${label}</span>` });
}

export class NcViewerApp implements PanelHost {
  doc: NcDoc | null = null;
  viewer: Viewer3d | null = null;
  private readonly client = new ParseWorkerClient();
  readonly panel: NcPanel;

  private theme: ThemeName;
  private readonly storage = safeStorage();
  private panelOpen = window.innerWidth >= NARROW_WIDTH;
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

  // ── 화면 요소 ──
  private readonly root: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly docNameEl: HTMLSpanElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly workspace: HTMLElement;
  private readonly viewEl: HTMLDivElement;
  private readonly startEl: HTMLDivElement;
  private readonly startError: HTMLDivElement;
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
  private sec!: { btn: HTMLButtonElement; axes: { axis: SectionAxis | null; el: HTMLButtonElement }[]; range: HTMLInputElement; flip: HTMLButtonElement; val: HTMLSpanElement };

  constructor(root: HTMLElement) {
    root.addEventListener('languagechange', () => { if (this.viewer) this.viewer.setViewCubeSize(this.viewer.viewCubeSize); });
    this.root = root;
    this.theme = resolveTheme(readThemePref(this.storage), this.systemDark());
    document.documentElement.dataset.theme = this.theme;

    // ── 열기 상자 ──
    this.fileInput = h('input', { type: 'file', accept: fileAccept(), hidden: true, 'aria-hidden': 'true', tabindex: -1 });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void this.openFile(f);
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
    const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '보기 도구' });
    const add = (key: string, el: HTMLButtonElement, run: () => void, needsDoc = true): HTMLButtonElement => {
      el.addEventListener('click', run);
      this.tools[key] = { el, needsDoc };
      toolbar.append(el);
      return el;
    };
    const sep = (): HTMLSpanElement => {
      const s = h('span', { class: 'tb-sep', 'aria-hidden': 'true' });
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
    this.projBtn = add('proj', tbtn('perspective', '원근', '투영: 원근 ↔ 평행'), () => this.setProjection(this.projection === 'perspective' ? 'orthographic' : 'perspective'));
    sep();
    toolbar.append(
      this.menu(
        'render',
        tbtn('render', '그리기', '그리기 모드: 음영 · 음영+모서리 · 와이어프레임 · X-ray'),
        RENDER_MODES.map(([m, label]) => {
          const b = h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': 'false' }, h('span', {}, label));
          b.addEventListener('click', () => this.setRenderMode(m));
          this.renderItems.push({ mode: m, el: b });
          return b;
        }),
      ),
    );
    add('grid', tbtn('grid', '격자', '바닥 격자 (F7)'), () => this.toggleGrid());
    add('cube', tbtn('cube', '뷰 큐브', '뷰 큐브 보이기'), () => this.toggleCube());
    add('axes', tbtn('axes', '좌표축', '좌표축 보이기'), () => this.toggleAxes());
    toolbar.append(this.sectionControl());
    sep();
    add('measure', tbtn('measure', '측정', '두 점 거리·dx·dy·dz (Esc로 지우기)'), () => this.toggleMeasure());
    add('png', tbtn('image', 'PNG 저장', '지금 화면을 PNG 그림으로 저장'), () => void this.savePng());
    this.playSep = sep();
    this.playBtn = add('play', tbtn('play', '재생', '공구 경로 재생 / 멈춤 (Space)'), () => this.togglePlay());
    sep();
    add('panel', tbtn('panel', '패널', '패널 열기·닫기'), () => this.togglePanel());

    // ── 작업 영역: 3D 보기 + 시작 화면 + 패널 + 덮개 ──
    this.workspace = h('main', { class: 'workspace' });
    this.viewEl = h('div', { class: 'view', hidden: true });
    this.startError = h('div', { class: 'start-error', role: 'alert', hidden: true });
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
      window.matchMedia(NARROW_QUERY).addEventListener('change', () => this.viewer?.setViewCubeSize(this.cubeSizeFor()));
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
      h('p', { class: 'dz-title' }, 'NC 파일을 여기에 끌어다 놓으십시오'),
      h('p', { class: 'dz-sub' }, '창 어디에 놓아도 열립니다. 한 번에 파일 하나를 엽니다.'),
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
        h('p', { class: 'lead' }, 'G-code·Heidenhain 평문·woodWOP MPR 파일을 열면 공구 경로를 돌려 보고, 코드 줄과 이동을 함께 짚고, 가공 순서를 재생할 수 있습니다.'),
        zone,
        this.startError,
        h(
          'dl',
          { class: 'formats', 'aria-label': '지원 형식' },
          fmt('G-code', GCODE_EXTENSIONS, 'ISO·Fanuc·LinuxCNC·GRBL·Mach3 방언 자동 판별, 원호·나선, 고정 사이클, 부프로그램, 변수, 좌표 회전·배율·거울, 반경 보정 경로·선반·회전축(선택)'),
          fmt('Heidenhain 평문', HEIDENHAIN_EXTENSIONS, 'BLK FORM 공작물, TOOL CALL, L·C·CR·CT·FK, 드릴·포켓 사이클, Q 변수'),
          fmt('woodWOP MPR', MPR_EXTENSIONS, '판, 수직·수평 드릴, 윤곽 가공, 홈, 포켓, 변수'),
        ),
        h('p', { class: 'privacy', html: `${icon('lock')}<span><b>파일은 이 브라우저 밖으로 나가지 않습니다.</b> 서버로 올리지 않고 이 기기 안에서 읽습니다.</span>` }),
        h('p', { class: 'keys' }, '키: F 전체 보기 · 1~7 표준 뷰 · F7 격자 · Space 재생/멈춤 · Esc 고른 것 지우기 · Ctrl+O 열기'),
      ),
    );
  }

  /** 펼침 메뉴(표준 뷰·그리기 모드) */
  private menu(key: string, button: HTMLButtonElement, items: HTMLButtonElement[], needsDoc = true): HTMLElement {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.insertAdjacentHTML('beforeend', `<span class="caret">${icon('chevron')}</span>`);
    const list = h('div', { class: 'menu', role: 'menu', hidden: true });
    list.append(...items);
    const wrap = h('div', { class: 'menu-wrap' }, button, list);
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
      button.setAttribute('aria-expanded', 'true');
      this.openMenu = { wrap, close };
      // 화면 오른쪽 밖으로 나가지 않게
      const r = list.getBoundingClientRect();
      const over = r.right - (window.innerWidth - 8);
      if (over > 0) list.style.left = `${-over}px`;
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
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const n = items.length;
        items[(i + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
      }
    });
    this.tools[key] = { el: button, needsDoc };
    return wrap;
  }

  private closeMenu(): void {
    this.openMenu?.close();
    this.openMenu = null;
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
      const over = r.right - (window.innerWidth - 8);
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

  chooseFile(): void {
    this.fileInput.click();
  }

  async openFile(f: File): Promise<boolean> {
    const attempt = beginOpen('local', f.name.split('.').pop() ?? 'other');
    let buf: ArrayBuffer;
    try {
      buf = await f.arrayBuffer();
    } catch (e) {
      this.showError(`${f.name}: 파일을 읽지 못했습니다(${errorText(e)}).`);
      attempt.error('read_error');
      return false;
    }
    return this.openBuffer(f.name, buf, {}, attempt);
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
  async openBuffer(name: string, data: ArrayBuffer, opts: NcOpenOptions = {}, attempt: OpenAttempt = beginOpen('local', name.split('.').pop() ?? 'other')): Promise<boolean> {
    const seq = ++this.loadSeq;
    const size = data.byteLength;
    this.closeMenu();
    this.setBusy('여는 중', 0.02, name);
    try {
      const res = await this.client.open(name, data, opts, (f, stage) => {
        if (seq === this.loadSeq) this.setBusy(stage, f, name);
      });
      if (seq !== this.loadSeq) return false;
      if (!sceneHasGeometry(res.scene)) {
        attempt.error('empty');
        const why = res.scene.warnings?.[0];
        throw new Error(`그릴 공구 경로를 찾지 못했습니다. 이동 명령(G0·G1·L 등)이 없는 프로그램일 수 있습니다.${why ? ` (해석 경고: ${why})` : ''}`);
      }
      this.ensureViewer();
      this.setDoc(createDoc(name, size, res, opts));
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
    const unitsChanged = (opts.units ?? 'mm') !== (d.ncOptions.units ?? 'mm') || !!opts.lathe !== !!d.ncOptions.lathe || !!opts.rotary !== !!d.ncOptions.rotary;
    const seq = ++this.loadSeq;
    this.setBusy('다시 읽는 중', 0.05, d.name);
    try {
      const res = await this.client.open(d.name, copy, opts, (f, stage) => {
        if (seq === this.loadSeq) this.setBusy(stage, f, d.name);
      });
      if (seq !== this.loadSeq || this.doc !== d) return;
      if (!sceneHasGeometry(res.scene)) throw new Error('이 설정으로는 그릴 공구 경로가 없습니다.');
      this.stopPlay();
      const cam = !unitsChanged ? this.viewer?.getCamera() : null;
      replaceResult(d, res, opts);
      this.error = null;
      this.applyDoc(d, cam ?? null);
      this.panel.show(d);
      this.panel.setOpen(this.panelOpen);
      this.renderToolbar();
      this.renderStatus();
      toast(`${d.name}: 다시 읽었습니다.`, 'info', 2500);
    } catch (e) {
      if (seq === this.loadSeq) this.showError(`${d.name}: 다시 읽지 못했습니다 — ${errorText(e)}`);
    } finally {
      if (seq === this.loadSeq) this.setBusy(null);
    }
  }

  private async startFromUrl(): Promise<void> {
    const req = parseStartParams(location.search, location.href);
    if (!req) return;
    if (req.kind === 'error') this.showError(req.message);
    else if (req.kind === 'sample') await this.openSample();
    else await this.openUrl(req.url, req.name);
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
    if (!this.busy) return;
    this.busyStage.textContent = `${stage}…`;
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
      if (files.length > 1) toast(`한 번에 파일 하나만 엽니다. ${files[0]!.name}을(를) 엽니다.`, 'info', 5000);
      void this.openFile(files[0]!);
    });
  }

  // ───────────────────────── 문서·뷰어 ─────────────────────────

  private ensureViewer(): Viewer3d {
    if (this.viewer) return this.viewer;
    this.viewEl.hidden = false;
    let v: Viewer3d;
    try {
      v = new Viewer3d(this.viewEl, { theme: this.theme, viewCubeSize: this.cubeSizeFor() });
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
    return v;
  }

  private setDoc(d: NcDoc): void {
    this.stopPlay();
    this.doc = d;
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
    // 선반처럼 보이는 G-code를 밀링으로 읽었으면 선반 모드를 알려 준다
    const latheHint = d.kind === 'gcode' && !d.ncOptions.lathe && !!d.scene.warnings?.some((x) => x.includes('선반 프로그램으로 보임'));
    if (latheHint) toast('선반 프로그램으로 보입니다 — 패널 "정보" 탭의 "선반 모드"를 켜면 X를 지름으로 보고 선반 사이클을 그립니다.', 'info', 7000);
    else if (w) toast(`해석 경고 ${w.toLocaleString('ko-KR')}개 — 패널의 "정보" 탭에서 볼 수 있습니다.`, 'info', 4500);
    this.viewer?.canvas.focus({ preventScroll: true });
  }

  /** 문서의 장면과 보기 상태를 뷰어에 올린다(cam을 주면 그 카메라를 지킨다) */
  private applyDoc(d: NcDoc, cam: ReturnType<Viewer3d['getCamera']> | null): void {
    const v = this.viewer;
    if (!v) return;
    v.setScene(d.scene, { keepView: !!cam });
    if (cam) v.setCamera(cam);
    // 선반: XZ 단면이 보이게 앞에서
    else if (sceneFeatures(d.scene).lathe) v.setView('front', false);
    for (const g of d.hiddenGroups) v.setGroupVisible(g, false);
    v.highlight(d.highlight.length ? d.highlight : null);
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
    if (p.section) {
      // 단면 잘린 면: 원본 번호가 없다(index −1) — 줄 고르기는 하지 않는다
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
    if (d.kind === 'mpr' && /^mpr-op-\d+$/.test(p.id)) {
      this.selectMprOp(Number(p.id.slice(7)), true);
      return;
    }
    if (d.kind === 'mpr' && (p.id === 'mpr-hole-centers' || p.id === 'mpr-other-pos')) {
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

  /** 지금 화면 폭에 맞는 뷰 큐브 크기 */
  private cubeSizeFor(): number {
    try {
      return window.matchMedia(NARROW_QUERY).matches ? CUBE_NARROW : CUBE_WIDE;
    } catch {
      return window.innerWidth < NARROW_WIDTH ? CUBE_NARROW : CUBE_WIDE;
    }
  }

  get measuring(): boolean {
    return !!this.viewer?.measureMode;
  }

  toggleMeasure(on = !this.measuring): void {
    const v = this.viewer;
    if (!v) return;
    v.setMeasureMode(on);
    if (!on && this.doc) this.doc.measure = null;
    this.panel.onMeasure();
    this.renderToolbar();
    this.renderStatus();
  }

  togglePanel(on = !this.panelOpen): void {
    this.panelOpen = on;
    this.panel.setOpen(on);
    this.renderToolbar();
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
    this.applyPlayback(d);
    this.panel.onPlayback();
    this.renderToolbar();
  }

  togglePlay(): void {
    const d = this.doc;
    if (!d?.nc || !d.nc.moves.count) return;
    if (this.playing) {
      this.stopPlay();
      this.panel.onPlayback();
      this.renderToolbar();
      return;
    }
    const total = totalTime(d.nc.timeline);
    if (d.playSec === null || d.playSec >= total) d.playSec = 0;
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
      this.panel.onPlayback();
      if (r.done) {
        this.playing = false;
        this.panel.onPlayback();
        this.renderToolbar();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.panel.onPlayback();
    this.renderToolbar();
  }

  setSpeed(s: PlaySpeed): void {
    if (PLAY_SPEEDS.includes(s)) this.speed = s;
    this.panel.onPlayback();
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
    const { move, frac } = playbackAt(d.nc.timeline, d.playSec);
    return { move, frac, line: move >= 0 ? d.nc.moves.line[move]! : -1, sec: d.playSec, total };
  }

  private applyPlayback(d: NcDoc): void {
    const v = this.viewer;
    if (!v) return;
    if (!d.nc || d.playSec === null) {
      v.setDrawLimitBySegmentId(null);
      v.setMarker(null);
      return;
    }
    const { move, frac } = playbackAt(d.nc.timeline, d.playSec);
    if (move < 0) {
      v.setDrawLimitBySegmentId(null);
      v.setMarker(null);
      return;
    }
    const end = v.setDrawLimitBySegmentId(move, { ghost: 0.14 });
    const seg = moveSegments(d.scene, [move], 4096);
    const pos = pointAlong(seg, frac) ?? end ?? moveEndPoint(d.nc, move);
    v.setMarker(pos, 'cone');
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
      return;
    }
    this.stMain.textContent = statusParts(d).join(' · ');
    const wl = warningLabel(d);
    this.stWarn.hidden = !wl;
    this.stWarn.textContent = wl;
    this.stSel.textContent = selectionSummary(d, this.measuring);
    this.stSel.title = this.stSel.textContent;
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
    const a = keyAction({
      key: ev.key,
      ctrl: ev.ctrlKey,
      meta: ev.metaKey,
      alt: ev.altKey,
      editable: isEditableTarget(t as (HTMLElement & { type?: string }) | null),
      onButton: !!t && (t.tagName === 'BUTTON' || t.getAttribute?.('role') === 'button' || t.tagName === 'A'),
      onCanvas: !!v && t === v.canvas,
      hasDoc: !!this.doc && !!v && !this.busy,
      canPlay: this.canPlay(),
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
    else this.togglePlay();
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
      operations: d && d.kind === 'mpr' ? mprOps(d.scene).length : 0,
      warnings: d?.scene.warnings?.length ?? 0,
      error: this.error,
      panelOpen: this.panelOpen && !!d,
      panelTab: this.panel.tab,
      playing: this.playing,
      playSec: d?.playSec ?? null,
      selLine: d?.selLine ?? -1,
      theme: this.theme,
      measuring: this.measuring,
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
      togglePlay: () => app.togglePlay(),
      cancel: () => app.cancelLoad(),
      setSection: (axis, t, flip) => app.setSectionAxis(axis, t, flip),
    };
    window.opencadApp = api;
  }
}
