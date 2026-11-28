/**
 * 오른쪽 패널(폭 760px 미만이면 아래 시트): 열린 NC 문서의 코드·공구·정보.
 *
 * 탭: G-code·Heidenhain = 코드·공구·정보(+재생 막대), 판재 가공(MPR·PGI·XML) = 가공·변수·코드·정보.
 * 아래 띠에는 고른 줄·객체와 측정 결과를 보인다. 코드 보기는 가상 목록(보이는 줄만 DOM, src/view/vlist.ts).
 * 2dcad-viewer 커밋 d7c584a의 src/app/view3d/panel.ts를 이 앱(문서 하나, 리본 없음)에 맞게 옮겼다.
 * 210차: 첫 화면 JS(시작 화면은 패널 틀만 만든다)에는 틀·탭 줄·재생 막대·코드 탭·아래 띠만 두고, 공구·가공·변수·정보 탭 몸통은
 * 문서를 열 때 받는 정보 탭 조각(panel-info.ts renderTab)이 그린다.
 */
import { sourceLine } from '../text';
import { PLAY_SPEEDS, formatDuration, type PlaySpeed } from '../view/playback';
import { VirtualList } from '../view/vlist';
import { itemName, jobLineOf, jobLineToGlobal, lineLabel, lineNumberText, mprOpAtLine, mprOps, moveState, panelTabs, selectedLineText, unitLabel, type NcDoc } from './doc';
import { onceImport } from './core';
import { fileSpan, h, loadFailed, mixSpan } from './dom';
import { mix } from './filetext';
import { mixNodes } from './i18n';
import { fmtInt, fmtNum, fmtPt } from './format';
import { icon } from './icons';
import { tabMove } from './keys';
import { panelMeasureHint, snapPair } from './measure';
import type { SceneIssue } from 'opencad-viewer3d';
import type { NcOpenOptions } from './protocol';
import type { NcSettings } from './settings';

/**
 * 코드 탭 밖 탭 몸통(panel-info.ts — 공구·가공·변수·정보 탭, 정보 탭의 해석 설정·보기 선택·공구 경로·기계 설정). 문서를 열 때 받는다
 * (54차 — 정보 탭의 공구 경로 부분을 첫 화면 JS에서 뺐다, 210차 — 탭 몸통 모두를 옮겼다)
 */
let info: typeof import('./panel-info') | null = null;
export const loadPanelInfo = onceImport(() => import('./panel-info').then((m) => (info = m)));

/** 이보다 좁으면 패널을 아래 시트로 */
export const NARROW_WIDTH = 760;

const WIDTH_KEY = 'opencad-nc.panel.width';
const SHEET_KEY = 'opencad-nc.panel.sheet';

/** 시트 높이 비율을 쓸 만한 범위로 */
export function sheetFraction(f: number): number {
  return Math.max(0.22, Math.min(0.85, Number.isFinite(f) ? f : 0.45));
}

/** 172차: 손잡이를 끌지 않고 누르면 갈 크기 — 지금보다 뚜렷이(5%) 큰 첫 크기, 가장 크면 첫(가장 작은) 크기로 */
const nextSize = (now: number, sizes: number[]): number => sizes.find((s) => s > now * 1.05) ?? sizes[0]!;

/** 패널이 부르는 앱 기능 */
export interface PanelHost {
  readonly speed: PlaySpeed;
  readonly isPlaying: boolean;
  readonly measuring: boolean;
  /** 손가락이 주인 기기인지(안내에서 키 설명을 빼고 길게 누르기를 알린다) */
  readonly touch: boolean;
  playbackInfo(): { move: number; frac: number; line: number; sec: number; total: number } | null;
  seek(sec: number | null): void;
  togglePlay(): void;
  stopPlay(): void;
  setSpeed(s: PlaySpeed): void;
  /** 한 이동씩 앞·뒤로 */
  stepMove(delta: number): void;
  /** 고른 줄까지 그리기 */
  drawToLine(line?: number): void;
  selectLine(line: number, moves?: number[], reveal?: boolean): void;
  selectMprOp(i: number, reveal?: boolean): void;
  setHighlight(ids: string[]): void;
  /** 주어진 항목에 맞춰 보기 */
  fitItems(ids: string[]): void;
  setGroupVisible(g: string, on: boolean): void;
  groups(): { name: string; visible: boolean; count: number }[];
  reparse(opts: NcOpenOptions): void;
  togglePanel(on?: boolean): void;
  /** 파일 고르기(add = 열린 작업에 더하기) */
  chooseFile(add?: boolean): void;
  /** 기계·읽기 설정(앱 전체, 기억된다) */
  readonly settings: NcSettings;
  setSettings(s: NcSettings): void;
  /** "깎기" 탭(소재 깎기 시뮬레이션 — 앱이 나눠 받은 모듈로 그린다). 221차: was는 같은 탭을 다시 그릴 때 그리기 전 몸통의 오류 글 열쇠(220차 failWas) */
  renderSimTab(body: HTMLElement, d: NcDoc, was?: string): void;
  /** 3D 보기 코어가 지금 장면 입력에서 빼거나 고친 것(55차 — 코어 0.50.0, 정보 탭 "3D 보기 경고") */
  sceneIssues?(): readonly SceneIssue[];
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

export class NcPanel {
  readonly el: HTMLElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly play: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly foot: HTMLDivElement;
  /** 지금 문서(210차: 정보 탭 조각의 탭 몸통이 누른 때 읽는다 — panel-info.ts InfoPanel) */
  doc: NcDoc | null = null;
  private code: VirtualList | null = null;
  private codeFor: object | null = null;
  private lastPlayLine = -2;
  /** 137차: 지금 몸통의 칸 → 열쇠(render가 그린 바로 뒤 적는다) */
  private keys = new Map<Element, string>();
  private playEls: { btn: HTMLButtonElement; range: HTMLInputElement; time: HTMLSpanElement; line: HTMLSpanElement; speed: HTMLSelectElement; state: HTMLDivElement; toHere: HTMLButtonElement } | null = null;

  constructor(
    readonly host: PanelHost,
    /** 패널을 담는 작업 영역(시트 높이 변수 --sheet-h를 둔다) */
    private readonly workspace: HTMLElement,
  ) {
    this.tabsEl = h('div', { class: 'panel-tabs', role: 'tablist', 'aria-label': '패널 탭' });
    // 150차: APG Tabs 수동 활성 — ←→(끝에서 둘레를 돎)·Home·End는 초점만 옮기고 고르기는 Enter·Space(버튼 누름), Tab 차례는 고른 탭 하나(render의 tabindex).
    // 옮기면 바로 고르지 않는 까닭: 깎기 탭은 처음 열 때 깎기 조각을 받고 원문 전체를 훑는다 — 처음 탭에서 ← 한 번이 둘레를 돌아 깎기다
    this.tabsEl.addEventListener('keydown', (e) => {
      const tabs = [...this.tabsEl.children] as HTMLElement[];
      const j = tabMove(e, tabs.indexOf(e.target as HTMLElement), tabs.length);
      if (j < 0) return;
      e.preventDefault();
      tabs[j]!.focus();
    });
    const close = h('button', { class: 'icon-btn', type: 'button', title: '패널 닫기', 'aria-label': '패널 닫기', html: icon('close') });
    close.addEventListener('click', () => this.host.togglePanel(false));
    this.play = h('div', { class: 'play', hidden: true });
    // 141차: 몸통 하나를 모든 탭 버튼이 aria-controls로 가리키고, 몸통 이름은 render가 지금 탭 버튼으로(aria-labelledby — APG Tabs). 패널은 앱에 하나라 id도 하나
    this.body = h('div', { class: 'panel-body', role: 'tabpanel', id: 'panel-body' });
    this.foot = h('div', { class: 'panel-foot', hidden: true, 'aria-live': 'polite' });
    // 223차(WCAG 2.1.1): 초점을 받는 분리자(이름은 풍선 글 — 키·값은 bindResize)
    const grip = h('div', { class: 'panel-grip', role: 'separator', tabindex: 0, title: '끌거나 눌러 크기 바꾸기' });
    this.el = h('aside', { class: 'panel', hidden: true, 'aria-label': '문서 패널' }, grip, h('div', { class: 'panel-head' }, this.tabsEl, close), this.play, this.body, this.foot);
    workspace.append(this.el);
    const w = Number(safeGet(WIDTH_KEY));
    if (w >= 260 && w <= 900) this.el.style.setProperty('--panel-w', `${w}px`);
    const s = Number(safeGet(SHEET_KEY));
    if (s > 0) workspace.style.setProperty('--sheet-h', `${Math.round(sheetFraction(s) * 100)}%`);
    this.bindResize(grip);
  }

  /**
   * 넓으면 폭, 좁으면(아래 시트) 높이를 끌어서 바꾼다. 172차(WCAG 2.5.7 끄는 동작의 한 점 대안): 끌지 않고 떼면 다음 정해진 크기로 —
   * 작게(끌기 최소)·보통(CSS 기본 380px·46%)·크게(끌기 최대)를 돈다. 끌기 판정은 코어 문턱과 같다(마우스·펜 4px, 손가락 10px).
   * 지금 크기는 둔 변수를 먼저 읽는다(넓은 화면 패널은 CSS 최대 60%라 그린 폭이 변수보다 작을 수 있다)
   * 223차(WCAG 2.1.1·4.1.2): 손잡이는 초점을 받는 분리자(APG Window Splitter) — 넓은 화면 ←(넓게)·→ 20px, 시트 ↑(높게)·↓ 5%, Enter는 누르기와 같은 다음 크기.
   * 값(aria-valuenow — 기본 범위 0~100)은 패널이 작업 영역의 몇 %인가(넓은 화면 폭·시트 높이), 방향은 그때 화면 폭으로(바꿀 때·초점을 받을 때 — sync).
   * 창 키(app.ts onKey)는 분리자의 화살표에서 돌아선다(재생할 수 있는 문서의 ←→ 한 이동 걷기보다 먼저). Home·End(가장 작게·크게)는 첫 화면 크기 허용 안에 들지 않아 두지 않았다
   */
  private bindResize(grip: HTMLElement): void {
    const area = (): DOMRect => this.workspace.getBoundingClientRect();
    const fitW = (w: number, a = area()): number => Math.max(260, Math.min(900, a.width - 200, w));
    /** 지금 크기(시트는 높이 비율): 둔 변수, 없으면 그린 크기, 그리기 전이면 CSS 기본 */
    const now = (sheet: boolean): number => {
      const r = this.el.getBoundingClientRect();
      return sheet
        ? parseFloat(this.workspace.style.getPropertyValue('--sheet-h')) / 100 || (r.height ? sheetFraction(r.height / Math.max(1, area().height)) : 0.46)
        : parseFloat(this.el.style.getPropertyValue('--panel-w')) || r.width || 380;
    };
    const put = (sheet: boolean, v: number): number => {
      if (sheet) this.workspace.style.setProperty('--sheet-h', `${Math.round(v * 100)}%`);
      else this.el.style.setProperty('--panel-w', `${Math.round(v)}px`);
      return v;
    };
    const next = (sheet: boolean): number => nextSize(now(sheet), sheet ? [0.22, 0.46, 0.85] : [260, 380, 900].map((w) => fitW(w)));
    const sync = (): void => {
      const sheet = window.innerWidth < NARROW_WIDTH;
      grip.setAttribute('aria-orientation', sheet ? 'horizontal' : 'vertical');
      grip.setAttribute('aria-valuenow', String(Math.round((sheet ? now(true) : now(false) / Math.max(1, area().width)) * 100)));
    };
    const save = (sheet: boolean, v: number): void => {
      safeSet(sheet ? SHEET_KEY : WIDTH_KEY, sheet ? v.toFixed(3) : String(Math.round(v)));
      sync();
    };
    grip.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      grip.setPointerCapture(ev.pointerId);
      const asSheet = window.innerWidth < NARROW_WIDTH;
      const x0 = ev.clientX;
      const y0 = ev.clientY;
      const slop = ev.pointerType === 'touch' ? 10 : 4;
      let moved = false;
      const r = this.el.getBoundingClientRect();
      const box = area();
      // 지금 크기(시트는 높이 비율) — 끌면 끈 만큼, 끌지 않고 떼면 다음 정해진 크기
      let v = asSheet ? sheetFraction(r.height / Math.max(1, box.height)) : r.width;
      const move = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) >= slop) moved = true;
        v = put(asSheet, asSheet ? sheetFraction((box.bottom - e.clientY) / Math.max(1, box.height)) : fitW(r.width + (x0 - e.clientX), box));
      };
      const up = (e: PointerEvent) => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        if (!moved && e.type === 'pointerup') v = put(asSheet, next(asSheet));
        save(asSheet, v);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('keydown', (e) => {
      const sheet = window.innerWidth < NARROW_WIDTH;
      const k = e.key;
      const d = k === (sheet ? 'ArrowUp' : 'ArrowLeft') ? 1 : k === (sheet ? 'ArrowDown' : 'ArrowRight') ? -1 : 0;
      const v = d ? (sheet ? sheetFraction(now(true) + d * 0.05) : fitW(now(false) + d * 20)) : k === 'Enter' ? next(sheet) : 0;
      if (!v || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      save(sheet, put(sheet, v));
    });
    grip.addEventListener('focus', sync);
    sync();
  }

  // ───────────────────────── 바깥에서 부르는 것 ─────────────────────────

  get tab(): string {
    return this.doc?.panelTab ?? '';
  }

  /** 문서를 보인다(새 문서·다시 읽기) */
  show(d: NcDoc | null): void {
    this.doc = d;
    this.lastPlayLine = -2;
    if (!d) {
      this.el.hidden = true;
      this.codeFor = null;
      return;
    }
    if (!panelTabs(d).some(([k]) => k === d.panelTab)) d.panelTab = panelTabs(d)[0]![0];
    this.buildPlay();
    this.render();
  }

  setOpen(on: boolean): void {
    this.el.hidden = !on || !this.doc;
    if (!this.el.hidden && this.doc?.panelTab === 'code')
      requestAnimationFrame(() => {
        const row = this.focusRow();
        if (row >= 0) this.code?.reveal(row);
        else this.code?.refresh();
      });
  }

  /** 코드 보기에서 보여야 할 줄: 고른 줄, 없으면 재생 중인 줄(-1 = 없음) */
  private focusRow(): number {
    const d = this.doc;
    if (!d) return -1;
    if (d.selLine >= 0) return d.selLine;
    return this.host.playbackInfo()?.line ?? -1;
  }

  /** 3D에서 고른 것이 바뀌었을 때 */
  onPick(reveal = false): void {
    const d = this.doc;
    if (!d) return;
    const t = d.panelTab;
    if (t === 'ops' || t === 'tools') this.render();
    else if (t === 'code') {
      this.code?.refresh();
      if (reveal && d.selLine >= 0) this.code?.reveal(d.selLine, true);
    }
    if (reveal && t === 'ops') this.body.querySelector('tr.current')?.scrollIntoView({ block: 'nearest' });
    this.renderFoot();
  }

  onSelectLine(reveal: boolean): void {
    const d = this.doc;
    if (!d) return;
    if (d.panelTab === 'code') {
      this.code?.refresh();
      if (reveal && d.selLine >= 0) this.code?.reveal(d.selLine, true);
    } else if (d.panelTab === 'ops' || d.panelTab === 'tools') this.render();
    this.renderFoot();
    this.syncToHere();
  }

  /**
   * 「여기까지 그리기」는 고른 줄이 있을 때만. 209차(WCAG 2.4.3): 초점이 그 버튼에 있는 채 막히면(Esc로 고른 것을 지움 등) HTML focus fixup이 초점을 문서로 보냈다 —
   * 같은 줄의 앞 칸(「전체」 — 늘 됨, 121차 깎기 탭 막힘 꼴)으로. 초점이 밖이면 그대로
   */
  private syncToHere(): void {
    const b = this.playEls?.toHere;
    if (!b) return;
    const had = document.activeElement === b;
    b.disabled = !this.doc || this.doc.selLine < 0;
    if (had && b.disabled) (b.previousElementSibling as HTMLElement | null)?.focus();
  }

  onMeasure(): void {
    this.renderFoot();
  }

  /** 정보 탭의 묶음 목록 등 다시 그리기 */
  refresh(): void {
    if (this.doc && this.doc.panelTab !== 'code') this.render();
  }

  onPlayback(): void {
    const p = this.playEls;
    const info = this.host.playbackInfo();
    if (!p || !info) return;
    const playing = this.host.isPlaying;
    p.btn.innerHTML = `${icon(playing ? 'pause' : 'play')}<span>${playing ? '멈춤' : '재생'}</span>`;
    p.btn.setAttribute('aria-pressed', String(playing));
    p.btn.classList.toggle('on', playing);
    p.range.value = String(info.total > 0 ? Math.round((info.sec / info.total) * 1000) : 1000);
    p.range.setAttribute('aria-valuetext', `${formatDuration(info.sec)} / ${formatDuration(info.total)}`);
    p.time.textContent = `${formatDuration(info.sec)} / ${formatDuration(info.total)}`;
    // 줄(작업 파일 이름)·상태(이름 붙은 공구)에 파일 글이 섞인다 — 지금 언어로 옮겨 담는다(data-i18n-skip)
    p.line.replaceChildren(...mixNodes(info.line >= 0 && this.doc ? lineLabel(this.doc, info.line) : ['전체 경로']));
    const nc = this.doc?.nc;
    const st = nc && info.move >= 0 ? moveState(nc, info.move, unitLabel(this.doc!.scene.units)) : null;
    p.state.hidden = !st;
    if (st) p.state.replaceChildren(...mixNodes(mix`${st.motion} · ${st.modal}\n${st.pos}`));
    p.speed.value = String(this.host.speed);
    this.syncToHere();
    if (info.line !== this.lastPlayLine) {
      this.lastPlayLine = info.line;
      if (this.doc?.panelTab === 'code' && this.code) {
        this.code.refresh();
        if (info.line >= 0) this.code.reveal(info.line);
      }
    }
  }

  // ───────────────────────── 틀 ─────────────────────────

  /** 탭 줄·몸통을 다시 그린다(정보 탭 조각의 탭 몸통도 부른다 — 탭 바꿈·눈 버튼 등) */
  render(): void {
    const d = this.doc;
    if (!d) return;
    // 탭 버튼 줄을 새로 만든다 — 초점이 탭 버튼에 있었으면(키보드로 누름 등) 새 줄의 같은 탭 버튼으로(떼어진 버튼에서 문서로 빠지지 않게)
    const focused = this.tabsEl.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.tab : undefined;
    this.tabsEl.textContent = '';
    let name = '';
    for (const [k, label] of panelTabs(d)) {
      const on = k === d.panelTab;
      if (on) name = label;
      const b = h('button', { class: `panel-tab${on ? ' active' : ''}`, type: 'button', role: 'tab', id: `panel-tab-${k}`, 'aria-controls': 'panel-body', 'aria-selected': on ? 'true' : 'false', tabindex: on ? '0' : '-1', 'data-tab': k }, label);
      b.addEventListener('click', () => {
        if (d.panelTab === k) return;
        d.panelTab = k;
        this.render();
      });
      this.tabsEl.append(b);
      if (k === focused) b.focus({ preventScroll: true });
    }
    // 137차: 몸통도 같은 꼴 — 초점이 몸통 칸에 있었으면 그 칸의 열쇠(지난번 그린 바로 뒤 적어 둔 것)
    const key = this.keys.get(document.activeElement as Element);
    const inBody = this.body.contains(document.activeElement);
    const scroll = this.body.scrollTop;
    const sameTab = this.body.dataset.tab === d.panelTab;
    this.body.dataset.tab = d.panelTab;
    // 141차: 몸통으로 들어가면 지금 탭 이름을 듣게(탭 글을 번역층이 옮기면 이름도 따라 옮겨짐)
    this.body.setAttribute('aria-labelledby', `panel-tab-${d.panelTab}`);
    this.body.classList.toggle('code', d.panelTab === 'code');
    if (d.panelTab === 'code') this.renderCode(d);
    else {
      // 220차: 같은 탭을 다시 그리면 그리기 전 몸통의 받기 실패 글 열쇠(dom.ts loadFailed — 같은 글이면 role 없이 그려 다시 읽히지 않게)
      this.failWas = sameTab ? this.body.querySelector<HTMLElement>('[data-fail]')?.dataset.fail : undefined;
      this.body.textContent = '';
      if (d.panelTab === 'sim') this.host.renderSimTab(this.body, d, this.failWas);
      // 210차: 공구·가공·변수·정보 탭 몸통은 문서를 열 때 받는 정보 탭 조각(panel-info.ts renderTab — 첫 화면 JS에서 뺐다). 받기 전이면 받은 뒤 다시 그린다(211차 waitTab)
      else if (info) info.renderTab(this, d);
      else this.waitTab(loadPanelInfo, name);
      if (sameTab) this.body.scrollTop = scroll;
    }
    // 137차: 몸통 칸마다 열쇠(태그 · data-key, 없으면 aria-label·감싼 label·글 — 121차 깎기 탭 꼴)를 그린 바로 뒤(화면 번역층이 옮기기 전 한국어 원문) 적고,
    // 초점이 있던 칸과 같은 열쇠의 첫 칸으로 옮긴다(정보 탭 설정을 바꿔 다시 읽거나 공구 탭 눈 버튼으로 새로 그려도 떼어진 칸에서 문서로 빠지지 않게)
    this.keys = new Map();
    for (const el of this.body.querySelectorAll<HTMLElement>('button, input, select')) {
      const k = `${el.tagName}|${el.dataset.key ?? el.getAttribute('aria-label') ?? el.closest('label')?.textContent ?? el.textContent}`;
      this.keys.set(el, k);
      if (k === key && !this.body.contains(document.activeElement)) el.focus({ preventScroll: true });
    }
    // 175차(WCAG 2.4.3): 코드 탭으로 가는 몸통 버튼(정보 탭 경고·작업 파일, 공구 탭 Z 최저)은 같은 열쇠 칸이 없고 코드 목록(열쇠 칸 밖)은 떼였다 다시 붙어
    // 초점이 문서로 빠졌다 — 초점이 몸통 안이었을 때만 같은 자리의 코드 목록으로(그 줄이 지금 줄, ↑↓로 줄을 옮김 — 찾기 칸 Esc와 같은 곳)
    // 211차: 다른 탭도 같은 열쇠 칸이 없으면(열 때 받는 조각을 받아 실패 글의 「다시 시도」가 사라짐 등) 지금 탭 버튼으로(207차 남는 칸)
    if (inBody && !this.body.contains(document.activeElement)) (d.panelTab === 'code' ? this.code?.el : this.tabsEl.querySelector<HTMLElement>('.active'))?.focus({ preventScroll: true });
    this.renderFoot();
    this.onPlayback();
  }

  /** 211차: 받는 중(true)·받지 못함(false)인 조각(그 받기 함수 — 정보 탭 조각 loadPanelInfo, 깎기 조각 app.ts simLoader) */
  private loads = new Map<() => Promise<unknown>, boolean>();
  /** 220차: 지금 그리는 몸통이 그리기 전에 보이던 받기 실패 글 열쇠(같은 탭일 때만 — render가 적고 waitTab이 loadFailed에 넘긴다) */
  private failWas: string | undefined;

  /**
   * 열 때 받는 조각이 그리는 탭 몸통(정보 탭 조각의 공구·가공·변수·정보 탭 — 210차, 깎기 조각의 깎기 탭 — app.ts renderSimTab)을 받기 전에 그렸다: 「불러오는 중…」을 두고
   * 받고(받는 중이면 그대로 — 받기는 한 번) 끝나면 다시 그린다(코드 탭이 아니면 — refresh). 문서는 app.ts ensureViewer가 정보 탭 조각을 기다린 뒤(3초 한도) 열려 보통은 이미 받았다.
   * 211차: 받지 못했으면(onceImport는 실패를 비워 다음 받기가 다시 받는다) 그 탭 이름으로 실패 글과 「다시 시도」 — 그리기마다 다시 받지 않는다. 전에는 정보 탭 조각은 빈 몸통,
   * 깎기 조각은 「불러오는 중…」 그대로에 console.error만 남았다. 다시 시도는 실패 글을 둔 채 받고, 받으면 그린 몸통에서 초점은 지금 탭 버튼(render), 또 못 받으면 새 「다시 시도」(137차 열쇠)
   * 215차: 누른 다시 시도도 받지 못하면 그 버튼은 「새로 고침」(dom.ts loadFailed — 셈 열쇠는 이 받기 함수, 초점은 같은 자리 버튼)
   */
  waitTab(load: () => Promise<unknown>, name: string): void {
    if (this.loads.get(load) === false) return loadFailed(name, () => this.fetchTab(load), this.body, load, this.failWas);
    this.body.append(h('p', { class: 'hint' }, '불러오는 중…'));
    this.fetchTab(load);
  }

  private fetchTab(load: () => Promise<unknown>): void {
    if (this.loads.get(load)) return;
    this.loads.set(load, true);
    void load()
      .then(
        () => this.loads.delete(load),
        (e: unknown) => {
          console.error(e);
          this.loads.set(load, false);
        },
      )
      .then(() => this.refresh());
  }

  // ───────────────────────── 재생 막대 ─────────────────────────

  private buildPlay(): void {
    const d = this.doc;
    this.play.textContent = '';
    this.playEls = null;
    this.play.hidden = !d?.nc || !d.nc.moves.count;
    if (this.play.hidden) return;
    const mk = (ic: 'first' | 'play' | 'all', label: string, title: string, run: () => void): HTMLButtonElement => {
      const b = h('button', { class: 'btn small', type: 'button', title, html: `${icon(ic)}<span>${label}</span>` });
      b.addEventListener('click', run);
      return b;
    };
    const first = mk('first', '처음', '처음으로', () => this.host.seek(0));
    const btn = mk('play', '재생', '재생 / 멈춤 (Space)', () => this.host.togglePlay());
    btn.classList.add('play-btn');
    const all = mk('all', '전체', '전체 경로 보기', () => {
      this.host.stopPlay();
      this.host.seek(null);
    });
    const speed = h('select', { class: 'select small', 'aria-label': '재생 속도', title: '재생 속도' });
    for (const s of PLAY_SPEEDS) speed.append(h('option', { value: String(s) }, `×${s}`));
    speed.addEventListener('change', () => this.host.setSpeed(Number(speed.value) as PlaySpeed));
    const range = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 1000, 'aria-label': '재생 위치' });
    range.addEventListener('input', () => {
      const info = this.host.playbackInfo();
      if (info) this.host.seek((Number(range.value) / 1000) * info.total);
    });
    const time = h('span', { class: 'mono-dim' });
    const line = h('span', { class: 'mono-dim', 'data-i18n-skip': true });
    // 한 이동씩(← →, Shift면 10)·고른 줄까지 그리기
    const iconBtn = (ic: 'stepBack' | 'stepFwd' | 'toHere', label: string, title: string, run: () => void): HTMLButtonElement => {
      const b = h('button', { class: 'btn small icon-only', type: 'button', title, 'aria-label': label, html: icon(ic) });
      b.addEventListener('click', run);
      return b;
    };
    const back = iconBtn('stepBack', '이전 이동', '이전 이동 (←, Shift+← 10개)', () => this.host.stepMove(-1));
    const fwd = iconBtn('stepFwd', '다음 이동', '다음 이동 (→, Shift+→ 10개)', () => this.host.stepMove(1));
    const toHere = iconBtn('toHere', '여기까지 그리기', '고른 줄까지 그리기', () => this.host.drawToLine());
    // 재생 중인 이동의 상태(끝점·이송·주축·공구·모달 G)
    const state = h('div', { class: 'play-state', 'aria-live': 'off', 'data-i18n-skip': true });
    this.play.append(h('div', { class: 'play-row' }, first, back, btn, fwd, all, toHere, speed, h('span', { class: 'play-info' }, time, line)), range, state);
    this.playEls = { btn, range, time, line, speed, state, toHere };
  }

  // ───────────────────────── 코드 보기 ─────────────────────────

  private lineCount(d: NcDoc): number {
    if (d.nc) return d.nc.source.lineCount;
    if (d.mpr) return d.mpr.lines.length;
    return 0;
  }

  private lineText(d: NcDoc, i: number): string {
    if (d.nc) return sourceLine(d.nc.source, i);
    if (d.mpr) return d.mpr.lines[i] ?? '';
    return '';
  }

  /** 코드 목록은 하나를 만들어 문서가 바뀌면 줄 수만 바꿔 쓴다 */
  private ensureCode(): VirtualList {
    if (this.code) return this.code;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    this.code = new VirtualList({
      rowHeight: coarse ? 24 : 18,
      className: 'code-list',
      render: (i, el) => {
        const doc = this.doc;
        if (!doc) return;
        const digits = String(Math.max(1, this.lineCount(doc))).length;
        const play = this.host.playbackInfo();
        const warn = this.warnAt(i);
        el.className = `vlist-row${i === doc.selLine ? ' sel' : ''}${play && play.line === i ? ' cur' : ''}${this.isHit(i) ? ' hit' : ''}${warn ? ' warn' : ''}`;
        // 173차(WCAG 4.1.2): 지금 줄(고른 줄, 없으면 재생 중인 줄 — focusRow, 한 무리에 하나)은 바탕으로만 보여 화면 읽기가 몰랐다 — 클래스와 같은 자리에서 aria-current로.
        // 줄은 role 없는 div라 aria-selected는 뜻이 없다(listbox로 바꾸면 창 키 arrowOwner가 ↑↓ 줄 옮기기를 막음). 재생이 줄마다 옮겨도 aria-live는 두지 않는다
        el.setAttribute('aria-current', String(i === (doc.selLine >= 0 ? doc.selLine : (play?.line ?? -1))));
        el.textContent = '';
        el.append(h('span', { class: 'ln', style: `width:${digits + 1}ch`, ...(warn ? { title: warn } : {}) }, lineNumberText(doc, i)), h('span', { class: 'tx' }, this.lineText(doc, i).replace(/\t/g, '    ')));
      },
      onClick: (i) => this.clickLine(i),
    });
    this.code.el.setAttribute('aria-label', '프로그램 코드');
    return this.code;
  }

  private renderCode(d: NcDoc): void {
    const c = this.ensureCode();
    const src: object | null = d.nc ?? d.mpr;
    if (this.codeFor !== src) {
      this.codeFor = src;
      c.setCount(this.lineCount(d));
      c.scrollTop = 0;
    }
    this.body.textContent = '';
    this.body.append(this.ensureFind(), c.el);
    if (this.findFor !== src) {
      // 새 문서: 찾은 줄은 다시 찾는다(찾는 글은 둔다)
      this.findFor = src;
      this.findHits = null;
      this.setFind(() => '');
    } else if (this.findText() !== this.findShown) this.setFind(this.findText);
    requestAnimationFrame(() => {
      if (this.doc !== d) return;
      const row = this.focusRow();
      if (row >= 0) c.reveal(row);
      else c.refresh();
    });
  }

  // ───────────────────────── 코드 찾기 ─────────────────────────

  private findBar: HTMLElement | null = null;
  private findInput!: HTMLInputElement;
  private findCount!: HTMLSpanElement;
  private findFor: object | null = null;
  /** 찾은 줄(오름차순). null = 아직 안 찾음 */
  private findHits: Int32Array | null = null;
  private findTimer = 0;
  /**
   * 221차: 찾기 칸 셈 글(찾은 수·간 차례 — 수는 화면 언어 꼴)을 짓는 함수와 그 글. 찾기 막대는 다시 그려도 그대로라 언어를 바꾸면 앞 언어 수 꼴이 남았다 —
   * 코드 탭을 다시 그릴 때(renderCode) 지은 글이 바뀌었으면만 다시 쓴다(같으면 두어 알림 영역이 다시 읽지 않게)
   */
  private findText = (): string => '';
  private findShown = '';
  private setFind(text: () => string): void {
    this.findText = text;
    this.findCount.textContent = this.findShown = text();
  }

  /** 코드 위 찾기 칸: 글(대소문자 무시)·N 번호·":줄 번호"(그 줄로 가기). Enter 다음, Shift+Enter 이전, Esc 닫기 */
  private ensureFind(): HTMLElement {
    if (this.findBar) return this.findBar;
    const input = h('input', { type: 'search', class: 'input small', placeholder: '찾기 — T5 · G43 · N100 · :120(줄로 가기)', 'aria-label': '코드에서 찾기', spellcheck: 'false', autocomplete: 'off' });
    const count = h('span', { class: 'mono-dim find-count', 'aria-live': 'polite' });
    const mk = (ic: 'up' | 'down', label: string, dir: number): HTMLButtonElement => {
      const b = h('button', { class: 'btn small icon-only', type: 'button', title: label, 'aria-label': label, html: icon(ic) });
      b.addEventListener('click', () => this.findGo(dir));
      return b;
    };
    input.addEventListener('input', () => {
      this.findHits = null;
      clearTimeout(this.findTimer);
      // 칠 때마다 다시 찾지 않고 잠깐 멈추면 센다(큰 파일)
      this.findTimer = window.setTimeout(() => this.findScan(), 250);
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.findGo(ev.shiftKey ? -1 : 1);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        input.value = '';
        this.findHits = null;
        this.setFind(() => '');
        this.code?.refresh();
        this.code?.el.focus();
      }
    });
    this.findInput = input;
    this.findCount = count;
    this.findBar = h('div', { class: 'code-search', role: 'search' }, h('span', { class: 'find-icon', 'aria-hidden': 'true', html: icon('search') }), input, count, mk('up', '이전 찾기 (Shift+Enter)', -1), mk('down', '다음 찾기 (Enter)', 1));
    return this.findBar;
  }

  /** 찾기 칸에 초점(next면 다음으로) */
  focusFind(next = false): void {
    const d = this.doc;
    if (!d) return;
    if (d.panelTab !== 'code') {
      d.panelTab = 'code';
      this.render();
    }
    this.ensureFind();
    this.findInput.focus();
    this.findInput.select();
    if (next && this.findInput.value) this.findGo(1);
  }

  private isHit(i: number): boolean {
    const a = this.findHits;
    if (!a || !a.length) return false;
    let lo = 0;
    let hi = a.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid]! === i) return true;
      if (a[mid]! < i) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }

  /** 지금 글로 찾은 줄을 센다(":줄"이면 없음) */
  private findScan(): Int32Array {
    const d = this.doc;
    const q = this.findInput.value.trim();
    const out: number[] = [];
    if (d && q && !/^:\s*\d+$/.test(q)) {
      const n = this.lineCount(d);
      const nm = /^N0*(\d+)$/i.exec(q);
      const re = nm ? new RegExp(`^\\s*(?:/\\d?\\s*)?N0*${nm[1]}(?!\\d)`, 'i') : null;
      const needle = q.toUpperCase();
      for (let i = 0; i < n && out.length < 200000; i++) {
        const t = this.lineText(d, i);
        if (re ? re.test(t) : t.toUpperCase().includes(needle)) out.push(i);
      }
    }
    this.findHits = Int32Array.from(out);
    this.setFind(() => (q && !/^:/.test(q) ? (out.length ? `${fmtInt(out.length)}개` : '없음') : ''));
    this.code?.refresh();
    return this.findHits;
  }

  /** 다음(1)·이전(-1) 찾은 줄로. ":120"이면 120번 줄로 */
  private findGo(dir: number): void {
    const d = this.doc;
    if (!d) return;
    const q = this.findInput.value.trim();
    const go = /^:\s*(\d+)$/.exec(q);
    if (go) {
      // 여러 파일 작업이면 고른 줄이 있는 파일(없으면 주 프로그램)의 줄 번호
      const j = jobLineOf(d.job, d.selLine >= 0 ? d.selLine : 0);
      const want = j ? jobLineToGlobal(d.job, j.index, +go[1]!) : +go[1]! - 1;
      const line = Math.max(0, Math.min(this.lineCount(d) - 1, want));
      this.selectFound(line);
      return;
    }
    const hits = this.findHits ?? this.findScan();
    if (!hits.length) return;
    const cur = d.selLine;
    let k = -1;
    if (dir > 0) {
      k = hits.findIndex((l) => l > cur);
      if (k < 0) k = 0;
    } else {
      for (let j = hits.length - 1; j >= 0; j--)
        if (hits[j]! < cur) {
          k = j;
          break;
        }
      if (k < 0) k = hits.length - 1;
    }
    this.setFind(() => `${fmtInt(k + 1)}/${fmtInt(hits.length)}`);
    this.selectFound(hits[k]!);
  }

  private selectFound(line: number): void {
    const d = this.doc;
    if (!d) return;
    if (d.nc) this.host.selectLine(line, undefined, true);
    else this.clickLine(line);
    this.code?.reveal(line, true);
  }

  private clickLine(i: number): void {
    const d = this.doc;
    if (!d) return;
    if (d.nc) {
      this.host.selectLine(d.selLine === i ? -1 : i);
      return;
    }
    if (d.mpr) {
      const best = mprOpAtLine(mprOps(d.scene), i);
      if (best >= 0) this.host.selectMprOp(best);
      d.selLine = i;
      this.code?.refresh();
      this.renderFoot();
    }
  }

  // 210차: 공구·가공·변수·정보 탭 몸통(renderTools·minZCell·renderOps·renderVars·groupList·renderInfo·jobGroup·optToggle)은 panel-info.ts로 옮겼다(문서를 열 때 받는 조각)

  /** 누른 경고가 다음에 갈 자리(경고 글 → 그 경고가 난 줄 차례) */
  private warnNext = new Map<string, number>();

  /** 경고의 줄로(다시 누르면 같은 경고가 난 다음 줄로) — 코드 탭을 연다(정보 탭 조각의 경고 목록이 부른다) */
  gotoWarning(it: { text: string; line: number; lines: number[] }): void {
    const d = this.doc;
    if (!d) return;
    const list = it.lines.length ? it.lines : [it.line];
    const k = (this.warnNext.get(it.text) ?? 0) % list.length;
    this.warnNext.set(it.text, k + 1);
    d.panelTab = 'code';
    this.render();
    this.host.selectLine(list[k]!, undefined, true);
  }

  /** 줄 → 그 줄의 경고 글(코드 줄 앞 표시) */
  private warnLines: Map<number, string> | null = null;
  private warnLinesFor: object | null = null;
  private warnAt(i: number): string | undefined {
    const src = this.doc?.nc ?? this.doc?.mpr;
    if (!src?.warnItems) return undefined;
    if (this.warnLinesFor !== src) {
      this.warnLinesFor = src;
      const m = new Map<number, string>();
      for (const it of src.warnItems) for (const l of it.lines.length ? it.lines : it.line >= 0 ? [it.line] : []) m.set(l, m.has(l) ? `${m.get(l)}\n${it.text}` : it.text);
      this.warnLines = m;
    }
    return this.warnLines?.get(i);
  }

  // ───────────────────────── 아래 띠: 고른 것·측정 ─────────────────────────

  private renderFoot(): void {
    const d = this.doc;
    const f = this.foot;
    f.textContent = '';
    if (!d) {
      f.hidden = true;
      return;
    }
    const lines: HTMLElement[] = [];
    const u = unitLabel(d.scene.units);
    const p = d.pick;
    if (d.selLine >= 0 && (d.nc || d.mpr)) {
      // 줄 이름(작업 파일 이름)과 줄 원문은 파일 글
      lines.push(h('div', {}, h('b', {}, mixSpan(lineLabel(d, d.selLine))), ' ', fileSpan(selectedLineText(d, 80))));
      if (d.nc) {
        const picked = p && (p.kind === 'line' || p.kind === 'point') && p.id.startsWith('nc-') && p.index >= 0 && p.index < d.nc.moves.count ? p.index : -1;
        const mi = picked >= 0 ? picked : (d.selMoves[0] ?? -1);
        const st = mi >= 0 ? moveState(d.nc, mi, u) : null;
        if (st) {
          // 현재 블록 상태: 이동·이송·주축 / 공구·보정·모달 G / 끝점(고른 점) / 원호
          lines.push(h('div', { class: 'state' }, st.motion));
          lines.push(h('div', { class: 'state' }, mixSpan(st.modal)));
          lines.push(h('div', { class: 'dim' }, `끝점 ${st.pos}${picked >= 0 ? ` · 고른 점 ${fmtPt(p!.point)}` : ''}`));
          if (st.arc) lines.push(h('div', { class: 'dim' }, st.arc));
          if (picked < 0 && d.selMoves.length > 1) lines.push(h('div', { class: 'dim' }, `이 줄의 이동 ${fmtInt(d.selMoves.length)}개를 강조했습니다(첫 이동의 상태).`));
        } else lines.push(h('div', { class: 'dim' }, '이 줄은 이동을 만들지 않습니다.'));
      }
    } else if (p) {
      const item = p.kind === 'mesh' ? d.scene.meshes.find((m) => m.id === p.id) : p.kind === 'line' ? d.scene.lines.find((l) => l.id === p.id) : d.scene.points?.find((x) => x.id === p.id);
      // 이름 붙은 공구의 경로·MPR 가공 이름은 파일 글
      const name = item?.name ?? (p.id.startsWith('sim-') ? '깎인 소재' : p.id);
      lines.push(h('div', {}, h('b', {}, '고른 것 '), mixSpan(itemName(d, p.id, item?.name, item?.group)), item?.group && item.group !== name ? mixSpan(mix` · ${itemName(d, '', item.group, item.group)}`, 'dim') : null));
      lines.push(h('div', { class: 'dim' }, `점 ${fmtPt(p.point)}`));
    }
    if (d.measure) {
      const m = d.measure;
      lines.push(h('div', {}, h('b', {}, '거리 '), `${fmtNum(m.distance)} ${u}`, h('span', { class: 'dim' }, ` · dx ${fmtNum(m.dx)} · dy ${fmtNum(m.dy)} · dz ${fmtNum(m.dz)}`)));
      // 붙잡은 종류(이름마다 따로 번역되게 조각으로)
      const sp = snapPair(m);
      if (sp) lines.push(h('div', { class: 'dim' }, h('span', {}, sp[0]), ' → ', h('span', {}, sp[1]), ...(sp[2] ? [' · ', h('span', {}, '잠금')] : [])));
    } else if (this.host.measuring) lines.push(h('div', { class: 'dim' }, panelMeasureHint(this.host.touch, !!d.nc || !!d.mpr?.snap)));
    f.hidden = !lines.length;
    f.append(...lines);
  }
}
