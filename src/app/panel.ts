/**
 * 오른쪽 패널(폭 760px 미만이면 아래 시트): 열린 NC 문서의 코드·공구·정보.
 *
 * 탭: G-code·Heidenhain = 코드·공구·정보(+재생 막대), 판재 가공(MPR·PGI·XML) = 가공·변수·코드·정보.
 * 아래 띠에는 고른 줄·객체와 측정 결과를 보인다. 코드 보기는 가상 목록(보이는 줄만 DOM, src/view/vlist.ts).
 * 2dcad-viewer 커밋 d7c584a의 src/app/view3d/panel.ts를 이 앱(문서 하나, 리본 없음)에 맞게 옮겼다.
 */
import { isPanelKind } from '../extensions';
import { NC_DIALECT_NAMES, type NcDialect } from '../model';
import { sourceLine } from '../text';
import { PLAY_SPEEDS, formatDuration, type PlaySpeed } from '../view/playback';
import { VirtualList } from '../view/vlist';
import { cutRangeText, docLabel, jobLineOf, jobLineToGlobal, lineAtLabel, lineLabel, lineNumberText, mprOpAtLine, mprOps, mprVars, moveState, panelTabs, sceneCounts, sceneFeatures, selectedLineText, toolGroup, toolItems, toolSelectLine, unitLabel, type NcDoc } from './doc';
import { h } from './dom';
import { fmtNum, fmtPt, formatBytes, formatMs, rgbCss } from './format';
import { icon } from './icons';
import { panelMeasureHint } from './measure';
import type { NcJobInfo, NcOpenOptions } from './protocol';
import { defaultSettings, type NcSettings } from './settings';

/** 이보다 좁으면 패널을 아래 시트로 */
export const NARROW_WIDTH = 760;

const WIDTH_KEY = 'opencad-nc.panel.width';
const SHEET_KEY = 'opencad-nc.panel.sheet';

/** 시트 높이 비율을 쓸 만한 범위로 */
export function sheetFraction(f: number): number {
  return Math.max(0.22, Math.min(0.85, Number.isFinite(f) ? f : 0.45));
}

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
}

const MPR_KIND: Record<string, string> = {
  drillV: '수직 구멍',
  drillH: '수평 구멍',
  contour: '윤곽',
  groove: '홈',
  pocket: '포켓',
  comment: '주석',
  other: '기타',
};

const G_DIALECTS: NcDialect[] = ['iso', 'fanuc', 'haas', 'linuxcnc', 'grbl', 'mach3'];

const row = (k: string, v: string): HTMLElement => h('div', { class: 'prop-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v', title: v }, v));
const group = (title: string, ...children: (Node | null)[]): HTMLElement => h('section', { class: 'prop-group' }, h('h3', {}, title), ...children);

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
  private readonly body: HTMLDivElement;
  private readonly foot: HTMLDivElement;
  private doc: NcDoc | null = null;
  private code: VirtualList | null = null;
  private codeFor: object | null = null;
  private lastPlayLine = -2;
  private playEls: { btn: HTMLButtonElement; range: HTMLInputElement; time: HTMLSpanElement; line: HTMLSpanElement; speed: HTMLSelectElement; state: HTMLDivElement; toHere: HTMLButtonElement } | null = null;

  constructor(
    private readonly host: PanelHost,
    /** 패널을 담는 작업 영역(시트 높이 변수 --sheet-h를 둔다) */
    private readonly workspace: HTMLElement,
  ) {
    this.tabsEl = h('div', { class: 'panel-tabs', role: 'tablist', 'aria-label': '패널 탭' });
    const close = h('button', { class: 'icon-btn', type: 'button', title: '패널 닫기', 'aria-label': '패널 닫기', html: icon('close') });
    close.addEventListener('click', () => this.host.togglePanel(false));
    this.play = h('div', { class: 'play', hidden: true });
    this.body = h('div', { class: 'panel-body', role: 'tabpanel' });
    this.foot = h('div', { class: 'panel-foot', hidden: true, 'aria-live': 'polite' });
    const grip = h('div', { class: 'panel-grip', title: '끌어서 크기 바꾸기', 'aria-hidden': 'true' });
    this.el = h('aside', { class: 'panel', hidden: true, 'aria-label': '문서 패널' }, grip, h('div', { class: 'panel-head' }, this.tabsEl, close), this.play, this.body, this.foot);
    workspace.append(this.el);
    const w = Number(safeGet(WIDTH_KEY));
    if (w >= 260 && w <= 900) this.el.style.setProperty('--panel-w', `${w}px`);
    const s = Number(safeGet(SHEET_KEY));
    if (s > 0) workspace.style.setProperty('--sheet-h', `${Math.round(sheetFraction(s) * 100)}%`);
    this.bindResize(grip);
  }

  /** 넓으면 폭, 좁으면(아래 시트) 높이를 끌어서 바꾼다 */
  private bindResize(grip: HTMLElement): void {
    grip.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      grip.setPointerCapture(ev.pointerId);
      const asSheet = window.innerWidth < NARROW_WIDTH;
      const x0 = ev.clientX;
      const w0 = this.el.getBoundingClientRect().width;
      const area = this.workspace.getBoundingClientRect();
      let width = w0;
      let sheet = sheetFraction(this.el.getBoundingClientRect().height / Math.max(1, area.height));
      const move = (e: PointerEvent) => {
        if (asSheet) {
          sheet = sheetFraction((area.bottom - e.clientY) / Math.max(1, area.height));
          this.workspace.style.setProperty('--sheet-h', `${Math.round(sheet * 100)}%`);
          return;
        }
        width = Math.max(260, Math.min(Math.min(900, area.width - 200), w0 + (x0 - e.clientX)));
        this.el.style.setProperty('--panel-w', `${Math.round(width)}px`);
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        if (asSheet) safeSet(SHEET_KEY, sheet.toFixed(3));
        else safeSet(WIDTH_KEY, String(Math.round(width)));
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
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
    if (this.playEls) this.playEls.toHere.disabled = d.selLine < 0;
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
    p.line.textContent = info.line >= 0 && this.doc ? lineLabel(this.doc, info.line) : '전체 경로';
    const nc = this.doc?.nc;
    const st = nc && info.move >= 0 ? moveState(nc, info.move, unitLabel(this.doc!.scene.units)) : null;
    p.state.hidden = !st;
    if (st) p.state.textContent = `${st.motion} · ${st.modal}\n${st.pos}`;
    p.speed.value = String(this.host.speed);
    p.toHere.disabled = !this.doc || this.doc.selLine < 0;
    if (info.line !== this.lastPlayLine) {
      this.lastPlayLine = info.line;
      if (this.doc?.panelTab === 'code' && this.code) {
        this.code.refresh();
        if (info.line >= 0) this.code.reveal(info.line);
      }
    }
  }

  // ───────────────────────── 틀 ─────────────────────────

  private render(): void {
    const d = this.doc;
    if (!d) return;
    this.tabsEl.textContent = '';
    for (const [k, label] of panelTabs(d)) {
      const on = k === d.panelTab;
      const b = h('button', { class: `panel-tab${on ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false', 'data-tab': k }, label);
      b.addEventListener('click', () => {
        if (d.panelTab === k) return;
        d.panelTab = k;
        this.render();
      });
      this.tabsEl.append(b);
    }
    const scroll = this.body.scrollTop;
    const sameTab = this.body.dataset.tab === d.panelTab;
    this.body.dataset.tab = d.panelTab;
    this.body.classList.toggle('code', d.panelTab === 'code');
    if (d.panelTab === 'code') this.renderCode(d);
    else {
      this.body.textContent = '';
      if (d.panelTab === 'tools') this.renderTools(d);
      else if (d.panelTab === 'ops') this.renderOps(d);
      else if (d.panelTab === 'vars') this.renderVars(d);
      else this.renderInfo(d);
      if (sameTab) this.body.scrollTop = scroll;
    }
    this.renderFoot();
    this.onPlayback();
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
    const line = h('span', { class: 'mono-dim' });
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
    const state = h('div', { class: 'play-state', 'aria-live': 'off' });
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
      this.findCount.textContent = '';
    }
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
        this.findCount.textContent = '';
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
    this.findCount.textContent = q && !/^:/.test(q) ? (out.length ? `${out.length.toLocaleString('ko-KR')}개` : '없음') : '';
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
    this.findCount.textContent = `${(k + 1).toLocaleString('ko-KR')}/${hits.length.toLocaleString('ko-KR')}`;
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

  // ───────────────────────── 공구(G-code·Heidenhain) ─────────────────────────

  private renderTools(d: NcDoc): void {
    const nc = d.nc;
    if (!nc) return;
    type ToolRow = (typeof nc.tools)[number] & { color?: number[] };
    const meta = d.scene.meta as { tools?: ToolRow[] } | undefined;
    const tools: ToolRow[] = meta?.tools ?? nc.tools;
    if (!tools.length) {
      this.body.append(h('p', { class: 'empty' }, '공구 정보가 없습니다.'));
      return;
    }
    const u = unitLabel(d.scene.units);
    const tbody = h('tbody');
    for (const t of tools) {
      const g = toolGroup(d.scene, t.number);
      const visible = g ? !d.hiddenGroups.has(g) : true;
      // 이름만 있는 공구(Heidenhain TOOL CALL "이름"·Siemens T="이름")는 번호 칸을 비우고 이름 칸에 보인다
      const label = t.number >= 100000 ? '—' : t.number >= 0 ? `T${t.number}` : '공구 없음';
      const eye = h('button', { class: `toggle${visible ? '' : ' off'}`, type: 'button', title: visible ? '숨기기' : '보이기', 'aria-label': `${label} ${visible ? '숨기기' : '보이기'}`, 'aria-pressed': String(visible), html: icon(visible ? 'eye' : 'eyeOff') });
      eye.disabled = !g;
      eye.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!g) return;
        this.host.setGroupVisible(g, d.hiddenGroups.has(g));
        this.render();
      });
      const items = toolItems(d.scene, t.number);
      const cur = items.length > 0 && d.highlight.length === items.length && items.every((id) => d.highlight.includes(id));
      const tr = h(
        'tr',
        { class: `clickable${cur ? ' current' : ''}${visible ? '' : ' off'}`, title: `처음 나온 줄 ${t.firstLine + 1}` },
        h('td', {}, eye),
        h('td', {}, h('span', { class: 'swatch', style: `background:${rgbCss(t.color ?? [0.5, 0.5, 0.5])}` })),
        h('td', {}, label),
        h('td', { class: 'wrap', translate: 'no' }, t.name ?? ''),
        h('td', { class: 'num' }, t.diameter ? `Ø${fmtNum(t.diameter)}` : ''),
        this.minZCell(t),
        h('td', { class: 'num' }, formatDuration(t.time)),
        h('td', { class: 'num' }, `${fmtNum(t.feedLength, 1)}${u}`),
      );
      if (t.cutMin && t.cutMax) tr.title = `${tr.title} · ${cutRangeText(t.cutMin, t.cutMax, u)}`;
      const selLine = toolSelectLine(nc, t.number, t.firstLine);
      tr.addEventListener('click', (ev) => {
        if (ev.detail >= 2) {
          // 두 번 누르기: 강조를 켠 채 그 공구 경로에 맞춰 보기
          this.host.setHighlight(items);
          this.host.selectLine(selLine);
          this.host.fitItems(items);
          this.render();
          return;
        }
        this.host.setHighlight(cur ? [] : items);
        // 코드 보기는 그 공구의 첫 이동 줄로(공구가 처음 나온 줄이 이동을 만들지 않으면 첫 이동 줄)
        if (!cur) this.host.selectLine(selLine);
        this.render();
      });
      tbody.append(tr);
    }
    this.body.append(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'grid tools' },
          h('thead', {}, h('tr', {}, h('th', { 'aria-label': '보이기' }, ''), h('th', {}, '색'), h('th', {}, '번호'), h('th', {}, '이름'), h('th', { class: 'num' }, '지름'), h('th', { class: 'num', title: '이 공구의 절삭(이송·호·드릴) 가운데 가장 낮은 Z' }, 'Z 최저'), h('th', { class: 'num' }, '시간'), h('th', { class: 'num' }, '이송 길이'))),
          tbody,
        ),
      ),
      h('p', { class: 'hint' }, '줄을 누르면 그 공구의 경로를 강조하고 첫 이동 줄로 갑니다. 두 번 누르면 그 경로에 맞춰 봅니다. 눈 단추로 켜고 끕니다. Z 최저를 누르면 가장 깊은 절삭 줄로 갑니다(줄에 마우스를 올리면 절삭 범위).'),
    );
  }

  /** 공구 표의 "Z 최저" 칸: 누르면 그 줄로 */
  private minZCell(t: { cutMin?: number[]; minZLine?: number }): HTMLElement {
    if (!t.cutMin) return h('td', { class: 'num faint' }, '');
    const b = h('button', { class: 'linkish', type: 'button', title: '가장 깊은 절삭 줄로' }, fmtNum(t.cutMin[2]!));
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (t.minZLine !== undefined && t.minZLine >= 0) {
        this.host.selectLine(t.minZLine);
        const d = this.doc;
        if (d) {
          d.panelTab = 'code';
          this.render();
        }
      }
    });
    return h('td', { class: 'num' }, b);
  }

  // ───────────────────────── 판재 가공(MPR·PGI·XML) ─────────────────────────

  private renderOps(d: NcDoc): void {
    const meta = (d.scene.meta ?? {}) as { workpiece?: { length: number; width: number; thickness: number } };
    const u = unitLabel(d.scene.units);
    const wp = meta.workpiece;
    if (wp) this.body.append(group('공작물', row('크기(L × W × T)', `${fmtNum(wp.length)} × ${fmtNum(wp.width)} × ${fmtNum(wp.thickness)} ${u}`)));
    const ops = mprOps(d.scene);
    if (!ops.length) {
      this.body.append(h('p', { class: 'empty' }, '가공이 없습니다.'));
      return;
    }
    const tbody = h('tbody');
    for (const o of ops) {
      const sel = d.selKey === String(o.index);
      const detail = [o.diameter ? `Ø${fmtNum(o.diameter)}` : '', o.depth !== undefined ? `깊이 ${fmtNum(o.depth)}` : '', o.holeCount ? `${o.holeCount}개` : '', o.tool !== undefined ? `T${o.tool}` : '']
        .filter(Boolean)
        .join(' · ');
      const tr = h(
        'tr',
        { class: `clickable${sel ? ' current' : ''}${o.enabled ? '' : ' off'}`, title: typeof o.line === 'number' ? `줄 ${o.line + 1}` : '' },
        h('td', { class: 'num faint' }, String(o.index + 1)),
        h('td', { class: 'wrap' }, o.label || MPR_KIND[o.kind] || o.kind),
        h('td', {}, MPR_KIND[o.kind] ?? o.kind),
        h('td', { class: 'wrap' }, detail),
        h('td', {}, o.enabled ? h('span', { class: 'chip' }, '켜짐') : h('span', { class: 'chip warn' }, '꺼짐')),
      );
      tr.addEventListener('click', () => this.host.selectMprOp(o.index));
      tbody.append(tr);
    }
    this.body.append(h('div', { class: 'table-wrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', { class: 'num' }, '#'), h('th', {}, '가공'), h('th', {}, '종류'), h('th', {}, '값'), h('th', {}, '상태'))), tbody)));
  }

  private renderVars(d: NcDoc): void {
    const vars = mprVars(d.scene);
    if (!vars.length) {
      this.body.append(h('p', { class: 'empty' }, '변수가 없습니다.'));
      return;
    }
    const tbody = h('tbody');
    for (const v of vars)
      tbody.append(
        h(
          'tr',
          {},
          h('td', { class: 'mono' }, v.name),
          h('td', { class: 'num mono' }, v.value !== undefined ? fmtNum(v.value) : '—'),
          h('td', { class: 'mono dim wrap' }, v.expr !== String(v.value) ? v.expr : ''),
          h('td', { class: 'dim wrap' }, v.comment ?? ''),
        ),
      );
    this.body.append(h('div', { class: 'table-wrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, '이름'), h('th', { class: 'num' }, '값'), h('th', {}, '식'), h('th', {}, '설명'))), tbody)));
  }

  // ───────────────────────── 정보 ─────────────────────────

  private groupList(d: NcDoc): HTMLElement {
    const groups = this.host.groups();
    if (!groups.length) return group('묶음', h('p', { class: 'hint' }, '묶음이 없습니다.'));
    const list = h('div', { class: 'groups' });
    for (const g of groups) {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !d.hiddenGroups.has(g.name);
      cb.addEventListener('change', () => this.host.setGroupVisible(g.name, cb.checked));
      list.append(h('label', { class: 'group-item' }, cb, h('span', { class: 'name' }, g.name), h('span', { class: 'chip' }, String(g.count))));
    }
    return group('묶음(켜고 끄기)', list);
  }

  private renderInfo(d: NcDoc): void {
    const s = d.scene;
    const u = unitLabel(s.units);
    const c = sceneCounts(s);
    const b = s.bounds;
    const rows: HTMLElement[] = [row('파일', d.name), row('형식', docLabel(d)), row('크기', formatBytes(d.size)), row('단위', u || '모름'), row('읽은 시간', formatMs(d.ms))];
    if (b) {
      // 장면 범위 = 급속·공작물 포함(기계 좌표 쪽 추정 이동은 뺌). 절삭만의 범위는 아래 "절삭 범위"
      rows.push(row('범위 크기(급속 포함)', `${fmtNum(b.max[0] - b.min[0])} × ${fmtNum(b.max[1] - b.min[1])} × ${fmtNum(b.max[2] - b.min[2])} ${u}`));
      rows.push(row('최소', fmtPt(b.min)), row('최대', fmtPt(b.max)));
    }
    if (c.segments) rows.push(row('선분', c.segments.toLocaleString('ko-KR')));
    if (c.triangles) rows.push(row('삼각형', c.triangles.toLocaleString('ko-KR')));
    this.body.append(group('문서', ...rows));
    if (d.job) this.body.append(this.jobGroup(d, d.job));

    const cb = d.nc?.cutBounds;
    if (cb)
      this.body.append(
        group(
          '절삭 범위(이송·호·드릴)',
          row('크기', `${fmtNum(cb.max[0] - cb.min[0])} × ${fmtNum(cb.max[1] - cb.min[1])} × ${fmtNum(cb.max[2] - cb.min[2])} ${u}`),
          row('최소', fmtPt(cb.min)),
          row('최대', fmtPt(cb.max)),
          row('가장 깊은 Z', `${fmtNum(cb.min[2])} ${u}`),
        ),
      );
    if (d.nc) this.ncInfo(d);
    if (isPanelKind(d.kind)) {
      const st = (s.meta as { stats?: Record<string, number> } | undefined)?.stats;
      if (st)
        this.body.append(
          group('가공 요약', row('구멍', `${st.holes ?? 0}개 (드릴 가공 ${st.drillOps ?? 0})`), row('윤곽 가공', String(st.contourOps ?? 0)), row('홈 · 포켓', `${st.grooves ?? 0} · ${st.pockets ?? 0}`), row('꺼진 가공', String(st.disabled ?? 0))),
        );
      if ((st?.disabled ?? 0) > 0 || d.ncOptions.mprDisabled)
        this.body.append(
          group(
            '보기 선택',
            this.optToggle(d, 'mprDisabled', '꺼진 가공도 그리기', d.kind === 'mpr' ? '조건(??)이 0이거나 EN=0인 가공을 묶음 "꺼진 가공"으로 그립니다.' : 'enable(Enable)이 0인 가공을 묶음 "꺼진 가공"으로 그립니다.'),
          ),
        );
    }
    this.body.append(this.groupList(d));
    const warns = s.warnings ?? [];
    const items = d.nc?.warnItems ?? [];
    // NC: 경고마다 단추(줄 번호·글·횟수 따로 — 누르면 그 줄로, 다시 누르면 같은 경고가 난 다음 줄로). 그 밖(장면 경고·MPR)은 글
    const lis: HTMLElement[] = items.slice(0, 300).map((it) => {
      if (it.line < 0) return h('li', {}, it.text);
      const b = h(
        'button',
        { class: 'warn-item', type: 'button', title: it.lines.length > 1 ? '누르면 그 줄로(다시 누르면 같은 경고가 난 다음 줄로)' : '누르면 그 줄로' },
        h('span', { class: 'ln' }, lineAtLabel(d, it.line)),
        h('span', { class: 'msg' }, it.text),
        it.count > 1 ? h('span', { class: 'cnt' }, `모두 ${it.count}번`) : null,
      );
      b.addEventListener('click', () => this.gotoWarning(it));
      return h('li', {}, b);
    });
    for (const w of warns.slice(items.length, 300)) lis.push(h('li', {}, w));
    this.body.append(
      warns.length
        ? group(`해석 경고 ${warns.length.toLocaleString('ko-KR')}개`, h('ul', { class: 'warn-list' }, ...lis), warns.length > 300 ? h('p', { class: 'hint' }, `처음 300개만 보입니다.`) : null)
        : group('해석 경고', h('p', { class: 'hint' }, '경고가 없습니다.')),
    );
  }

  /**
   * 작업 파일(여러 파일을 한 작업으로 열었을 때): 주 프로그램 고르기(바꾸면 다시 잇는다), 파일마다 코드 탭의 시작 줄로 가기,
   * 파일 더하기, 잇지 않은 파일과 찾지 못한 부르기
   */
  private jobGroup(d: NcDoc, job: NcJobInfo): HTMLElement {
    const main = h('select', { class: 'select', 'aria-label': '주 프로그램' });
    for (const f of job.files) main.append(h('option', { value: f }, f));
    main.value = job.main;
    main.addEventListener('change', () => this.host.reparse({ ...d.ncOptions, jobMain: main.value }));
    const list = h('ul', { class: 'warn-list job-files' });
    job.files.forEach((f, k) => {
      const line = job.starts[k] ?? -1;
      const b = h(
        'button',
        { class: 'warn-item', type: 'button', title: '누르면 코드 탭에서 이 파일이 시작하는 줄로', disabled: line < 0 },
        h('span', { class: 'ln' }, k === 0 ? '주 프로그램' : '함께 연 파일'),
        h('span', { class: 'msg', translate: 'no' }, f),
      );
      b.addEventListener('click', () => {
        d.panelTab = 'code';
        this.render();
        this.host.selectLine(line, undefined, true);
      });
      list.append(h('li', {}, b));
    });
    const add = h('button', { class: 'btn small', type: 'button', title: '부프로그램 파일을 골라 이 작업에 더합니다(같은 이름은 바꿉니다)' }, '파일 더하기');
    add.addEventListener('click', () => this.host.chooseFile(true));
    const missing = d.nc?.notices?.find((n) => n.kind === 'missing-program')?.programs ?? [];
    return group(
      `작업 파일 ${job.files.length}개`,
      h('label', { class: 'prop-row edit', title: '부르는 쪽(M98·G65 P, CALL PGM, Siemens 이름 부르기)을 처음부터 실행할 파일' }, h('span', { class: 'k' }, '주 프로그램'), main),
      list,
      job.skipped.length ? h('p', { class: 'hint' }, `잇지 않은 파일(형식이 다르거나 NC 프로그램이 아님): ${job.skipped.join(', ')}`) : null,
      missing.length ? h('p', { class: 'hint' }, `찾지 못한 프로그램: ${missing.join(', ')} — 해석 경고에서 그 줄로 갑니다.`) : null,
      add,
    );
  }

  /** 누른 경고가 다음에 갈 자리(경고 글 → 그 경고가 난 줄 차례) */
  private warnNext = new Map<string, number>();

  /** 경고의 줄로(다시 누르면 같은 경고가 난 다음 줄로) — 코드 탭을 연다 */
  private gotoWarning(it: { text: string; line: number; lines: number[] }): void {
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
    const nc = this.doc?.nc;
    if (!nc) return undefined;
    if (this.warnLinesFor !== nc) {
      this.warnLinesFor = nc;
      const m = new Map<number, string>();
      for (const it of nc.warnItems) for (const l of it.lines.length ? it.lines : it.line >= 0 ? [it.line] : []) m.set(l, m.has(l) ? `${m.get(l)}\n${it.text}` : it.text);
      this.warnLines = m;
    }
    return this.warnLines?.get(i);
  }

  private ncInfo(d: NcDoc): void {
    const nc = d.nc!;
    const st = nc.stats;
    const u = unitLabel(d.scene.units);
    if (nc.kind === 'gcode') {
      const dialect = h('select', { class: 'select', 'aria-label': 'G-code 방언' });
      dialect.append(h('option', { value: 'auto' }, `자동 (${NC_DIALECT_NAMES[nc.dialect]})`));
      for (const k of G_DIALECTS) dialect.append(h('option', { value: k }, NC_DIALECT_NAMES[k]));
      dialect.value = d.ncOptions.dialect ?? 'auto';
      const units = h('select', { class: 'select', 'aria-label': '기본 단위' });
      units.append(h('option', { value: 'mm' }, 'mm'), h('option', { value: 'inch' }, 'inch'));
      units.value = d.ncOptions.units ?? 'mm';
      const apply = () => this.host.reparse({ ...d.ncOptions, dialect: dialect.value as NcDialect | 'auto', units: units.value as 'mm' | 'inch' });
      dialect.addEventListener('change', apply);
      units.addEventListener('change', apply);
      this.body.append(
        group(
          '해석 설정',
          h('label', { class: 'prop-row edit' }, h('span', { class: 'k' }, '방언'), dialect),
          h('label', { class: 'prop-row edit', title: 'G20/G21이 없을 때 쓰는 단위' }, h('span', { class: 'k' }, '기본 단위'), units),
          this.optToggle(d, 'integerUnits', '소수점 없는 값 = 최소 단위', 'Fanuc 매개변수 DPI = 0 꼴: X12500을 12.5 mm(inch는 X12500 = 1.25)로 읽습니다. A·B·C는 0.001도.'),
          h('p', { class: 'hint' }, '바꾸면 파일을 다시 읽습니다.'),
        ),
      );
    }
    // 선택 기능: 반경 보정 경로·선반·회전축
    const f = sceneFeatures(d.scene);
    const opts: HTMLElement[] = [];
    if (f.compRunCount > 0 || d.ncOptions.comp) {
      opts.push(this.optToggle(d, 'comp', '보정 경로 보기', `반경 보정(${nc.kind === 'heidenhain' ? 'RL/RR' : 'G41/G42'}) 구간 ${f.compRunCount}곳의 공구 중심 경로를 묶음 "보정 경로"(분홍 실선)로 그립니다. 프로그램 경로는 그대로입니다.`));
      if (f.compRuns)
        for (const r of f.compRuns.slice(0, 20))
          opts.push(
            row(
              `${lineAtLabel(d, r.line)} ${r.side === 1 ? '왼쪽' : '오른쪽'}`,
              r.computed ? `반지름 ${fmtNum(r.radius)} ${u}${r.source ? ` (${r.source})` : ''}` : Number.isFinite(r.radius) ? '이동 없음' : '반지름 모름 — 그리지 않음',
            ),
          );
    }
    if (nc.kind === 'gcode') {
      opts.push(this.optToggle(d, 'lathe', '선반 모드', 'G18 평면, X를 지름으로(LinuxCNC는 G7부터), U·W 증분, G90/G94·G70~G76 선반 사이클로 읽고 XZ 단면(회전축 Z)으로 그립니다.'));
      if (f.rotaryAxes || d.ncOptions.rotary) opts.push(this.optToggle(d, 'rotary', '회전축 감기', 'A·B·C 각을 X·Y·Z축 둘레로 감아 공작물 기준 공구 끝 경로를 그립니다(회전 중심 = 원점, G43.4 동안은 감지 않음).'));
    }
    if (opts.length) this.body.append(group('보기 선택', ...opts));
    this.body.append(
      group(
        '공구 경로',
        row('방언 · 단위', `${nc.kind === 'heidenhain' ? 'Heidenhain 평문' : NC_DIALECT_NAMES[nc.dialect]}${f.lathe ? ' · 선반' : ''} · ${nc.units}`),
        row('줄 · 실행 블록', `${nc.source.lineCount.toLocaleString('ko-KR')} · ${st.blocks.toLocaleString('ko-KR')}`),
        row('이동', st.moveCount.toLocaleString('ko-KR')),
        row('이송 길이', `${fmtNum(st.feedLength, 1)} ${u}`),
        row('급속 길이', `${fmtNum(st.rapidLength, 1)} ${u}`),
        row('예상 시간', formatDuration(st.time)),
        row('이송 · 급속 · 휴지', `${formatDuration(st.feedTime)} · ${formatDuration(st.rapidTime)} · ${formatDuration(st.dwellTime)}`),
        row('급속 속도(계산용)', `${fmtNum(st.rapidFeed, 0)} ${u}/분`),
        row('공구 교환 · 원호 · 구멍', `${st.toolChanges} · ${st.arcCount.toLocaleString('ko-KR')} · ${st.holeCount.toLocaleString('ko-KR')}`),
        st.toolChangeTime > 0 ? row('공구 교환 시간', formatDuration(st.toolChangeTime)) : null,
      ),
    );
    this.body.append(this.settingsGroup());
  }

  /** 기계·읽기 설정(앱 전체, 이 브라우저에 기억): 바꾸면 지금 프로그램을 다시 읽는다 */
  private settingsGroup(): HTMLElement {
    const s = this.host.settings;
    const set = (patch: Partial<NcSettings>): void => this.host.setSettings({ ...this.host.settings, ...patch });
    const numIn = (v: number | null, label: string, onSet: (n: number | null) => void, placeholder = ''): HTMLInputElement => {
      const el = h('input', { type: 'number', step: 'any', inputmode: 'decimal', class: 'num-input', 'aria-label': label, placeholder });
      el.value = v === null ? '' : String(v);
      el.addEventListener('change', () => {
        const t = el.value.trim();
        const n = t === '' ? null : Number(t);
        onSet(n === null || Number.isFinite(n) ? n : null);
      });
      return el;
    };
    const one = (label: string, hint: string, v: number | null, onSet: (n: number | null) => void, placeholder: string): HTMLElement =>
      h('label', { class: 'prop-row edit', title: hint }, h('span', { class: 'k' }, label), numIn(v, label, onSet, placeholder));
    const tri = (label: string, hint: string, key: 'offsetMm' | 'referenceMm' | 'limitMin' | 'limitMax'): HTMLElement =>
      h(
        'div',
        { class: 'prop-row edit', title: hint },
        h('span', { class: 'k' }, label),
        h(
          'span',
          { class: 'xyz-input' },
          ...[0, 1, 2].map((a) =>
            numIn(
              s[key][a]!,
              `${label} — ${'XYZ'[a]}`,
              (n) => {
                const v = [...this.host.settings[key]] as NcSettings[typeof key];
                v[a] = n;
                set({ [key]: v });
              },
              'XYZ'[a]!,
            ),
          ),
        ),
      );
    const check = (label: string, hint: string, key: 'blockDelete' | 'checkToolNumbers' | 'dogleg' | 'toolSize'): HTMLElement => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = s[key];
      cb.addEventListener('change', () => set({ [key]: cb.checked }));
      return h('label', { class: 'group-item opt', title: hint }, cb, h('span', { class: 'name' }, label));
    };
    const reset = h('button', { type: 'button', class: 'btn small' }, '기본값으로');
    reset.addEventListener('click', () => this.host.setSettings(defaultSettings()));
    return group(
      '기계·읽기 설정',
      one('급속 속도(mm/분)', '시간 계산에 쓰는 급속 속도. 비우면 10000 mm/분(inch 프로그램은 400 inch/분).', s.rapidFeedMm, (n) => set({ rapidFeedMm: n && n > 0 ? n : null }), '10000'),
      one('공구 교환 시간(초)', '공구를 한 번 바꿀 때마다 예상 시간에 더합니다.', s.toolChangeSec, (n) => set({ toolChangeSec: n && n > 0 ? n : null }), '0'),
      check('블록 건너뛰기(/) 켬', '"/"로 시작하는 블록을 실행하지 않습니다(기계의 블록 건너뛰기 스위치를 켠 것과 같음).', 'blockDelete'),
      check('H·D 번호 확인', '공구 길이 보정 H·반경 보정 D 번호가 공구 번호와 다르면 경고합니다.', 'checkToolNumbers'),
      check('도그레그 급속', '여러 축 급속을 축마다 같은 속도로 함께 가다 짧은 축부터 멈추는 꺾인 길로 그리고, 가장 긴 축 이동으로 시간을 셉니다.', 'dogleg'),
      tri('G54 원점의 기계 좌표(mm)', '세 축을 모두 넣으면 G53·M91 값과 G28·G30 기준점을 실제 위치로 그립니다(없으면 공구 축만 안전 높이로 추정).', 'offsetMm'),
      tri('G28 기준점 기계 좌표(mm)', 'G54 원점의 기계 좌표와 함께 씁니다. 빈 칸은 0.', 'referenceMm'),
      tri('허용 범위 최소(mm)', '작업 좌표(G54) 기준. 벗어나는 이동을 경고합니다. 빈 칸은 제한 없음.', 'limitMin'),
      tri('허용 범위 최대(mm)', '작업 좌표(G54) 기준. 벗어나는 이동을 경고합니다. 빈 칸은 제한 없음.', 'limitMax'),
      check('공구를 실제 크기로 표시', '재생 중 공구 표시를 주석·공구 정의에서 읽은 지름 크기로 그립니다(모양은 공구 이름: 볼·드릴·엔드밀).', 'toolSize'),
      h('p', { class: 'hint' }, '바꾸면 파일을 다시 읽습니다. 이 브라우저에 기억합니다.'),
      reset,
    );
  }

  /** 다시 읽는 켜고 끄기(선택 기능) */
  private optToggle(d: NcDoc, key: 'comp' | 'lathe' | 'rotary' | 'mprDisabled' | 'integerUnits', label: string, hint: string): HTMLElement {
    const cb = h('input', { type: 'checkbox' });
    // 선반 모드는 고르지 않았으면 글로 판별한다 — 실제로 읽은 모드를 보인다
    cb.checked = key === 'lathe' ? sceneFeatures(d.scene).lathe : !!d.ncOptions[key];
    cb.addEventListener('change', () => this.host.reparse({ ...d.ncOptions, [key]: cb.checked }));
    return h('label', { class: 'group-item opt', title: hint }, cb, h('span', { class: 'name' }, label), h('span', { class: 'hint inline' }, '다시 읽음'));
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
      lines.push(h('div', {}, h('b', {}, lineLabel(d, d.selLine)), ` ${selectedLineText(d, 80)}`));
      if (d.nc) {
        const picked = p && (p.kind === 'line' || p.kind === 'point') && p.id.startsWith('nc-') && p.index >= 0 && p.index < d.nc.moves.count ? p.index : -1;
        const mi = picked >= 0 ? picked : (d.selMoves[0] ?? -1);
        const st = mi >= 0 ? moveState(d.nc, mi, u) : null;
        if (st) {
          // 현재 블록 상태: 이동·이송·주축 / 공구·보정·모달 G / 끝점(고른 점) / 원호
          lines.push(h('div', { class: 'state' }, st.motion));
          lines.push(h('div', { class: 'state' }, st.modal));
          lines.push(h('div', { class: 'dim' }, `끝점 ${st.pos}${picked >= 0 ? ` · 고른 점 ${fmtPt(p!.point)}` : ''}`));
          if (st.arc) lines.push(h('div', { class: 'dim' }, st.arc));
          if (picked < 0 && d.selMoves.length > 1) lines.push(h('div', { class: 'dim' }, `이 줄의 이동 ${d.selMoves.length.toLocaleString('ko-KR')}개를 강조했습니다(첫 이동의 상태).`));
        } else lines.push(h('div', { class: 'dim' }, '이 줄은 이동을 만들지 않습니다.'));
      }
    } else if (p) {
      const item = p.kind === 'mesh' ? d.scene.meshes.find((m) => m.id === p.id) : p.kind === 'line' ? d.scene.lines.find((l) => l.id === p.id) : d.scene.points?.find((x) => x.id === p.id);
      const name = item?.name ?? p.id;
      lines.push(h('div', {}, h('b', {}, '고른 것 '), name, item?.group && item.group !== name ? h('span', { class: 'dim' }, ` · ${item.group}`) : null));
      lines.push(h('div', { class: 'dim' }, `점 ${fmtPt(p.point)}`));
    }
    if (d.measure) {
      const m = d.measure;
      lines.push(h('div', {}, h('b', {}, '거리 '), `${fmtNum(m.distance)} ${u}`, h('span', { class: 'dim' }, ` · dx ${fmtNum(m.dx)} · dy ${fmtNum(m.dy)} · dz ${fmtNum(m.dz)}`)));
    } else if (this.host.measuring) lines.push(h('div', { class: 'dim' }, panelMeasureHint(this.host.touch)));
    f.hidden = !lines.length;
    f.append(...lines);
  }
}
