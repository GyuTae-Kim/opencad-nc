/**
 * 측정 방향 잠금·붙잡기 툴팁(3D 뷰어 코어 0.10.0 추론 잠금·나란함 — SketchUp의 추론 잠금을 따른다).
 * 코어 측정 모드가 상태를 가지고(setMeasureSnap({ inference: { lock, parallel } })·setMeasureInferenceLock), 이 모듈은 앱 쪽 손잡이만 둔다.
 *
 * - 툴팁: 측정 중 커서 아래 붙잡을 점의 종류(끝점·중심·교차점·X축 방향·나란한 방향 …)를 그 점 오른쪽 아래에, 잠갔으면 "잠금"을 덧붙인다.
 *   코어는 미리 보기를 그리기(rAF) 때 구하므로 포인터 이동·키 뒤 다음 프레임에 읽는다. 글은 DOM이라 번역층이 옮긴다.
 * - Shift: 코어가 누르는 순간의 방향 추론(축·나란함·수직)을 잠그고 떼면 푼다. 커서가 첫 점을 지나는 선분 위의 점 붙잡기(끝점·가운데 점 등 —
 *   첫 점에서 선분을 따라 그 끝을 가리킬 때)면 방향 추론이 없어 코어는 잠그지 않는다. 그때는 마지막으로 본 방향을 잠가 보고, 그 점이 잠근 선
 *   위에 있으면(코어가 점을 옮기지 않으면 — from 없음) 둔다(떼면 푼다). 아니면 바로 푼다.
 * - 화살표(첫 점을 찍은 뒤, 둘째 점 방향을 잡는 동안): → X · ← Y · ↑ Z축, ↓ 지금 방향(없으면 마지막으로 본 방향). 같은 키로 푼다.
 * - 측정 띠 잠금 단추(손가락 기기 — 넓은 화면에서는 띠가 숨는다): 방향을 잡는 동안만 보인다. 정밀 조준 중 다른 손가락으로 누르면 click이
 *   오지 않으므로 손가락·펜은 pointerdown에서 받는다. 잠글 방향이 없으면 띠 위에 알림을 띄우고, 잠금이 걸리면(어느 길로든) 그 알림만 거둔다.
 * 둘째 점을 찍거나 측정을 지우거나 측정을 끄면 코어가 잠금을 푼다.
 */
import type { MeasureHoverSnap, Viewer3d } from 'opencad-viewer3d';
import { h, toast } from './dom';
import { icon } from './icons';
import { NO_LOCK_MOUSE, NO_LOCK_TOUCH, lockName, type LockName } from './measure';
import { snapLabel } from './snap';

/** 이 모듈이 쓰는 뷰어 기능(시험에서 가짜로 바꿀 수 있게) */
export type LockViewer = Pick<
  Viewer3d,
  'canvas' | 'measureMode' | 'measurePointCount' | 'measureHoverSnap' | 'measureInferenceLock' | 'setMeasureInferenceLock' | 'renderNow' | 'project'
>;

export interface MeasureLockHost {
  viewer(): LockViewer | null;
  /** 손가락이 주인 기기인지(알림 글) */
  touch(): boolean;
  /** 툴팁을 붙일 층(3D 보기) */
  layer: HTMLElement;
  /** 잠금·찍은 점 수가 바뀌었다(상태 줄·측정 띠 다시 그리기) */
  changed(): void;
}

/** 측정 띠 알림 종류: 잠글 방향이 없음(잠금이 걸리면 거둔다) */
const NO_LOCK = 'no-lock';

/** 툴팁 글(붙잡은 종류 이름, 잠갔는지). 붙잡지 않은 점·미리 보기가 없으면 null */
export function snapTip(hv: Pick<MeasureHoverSnap, 'snap' | 'axis' | 'locked'> | null | undefined): { name: string; locked: boolean } | null {
  if (!hv?.snap) return null;
  return { name: snapLabel(hv.snap, hv.axis), locked: !!hv.locked };
}

export class MeasureLock {
  /** 측정 띠의 잠금 단추 */
  readonly button: HTMLButtonElement;
  /** 측정 띠 위 알림 */
  readonly flash: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private raf = 0;
  /** schedule을 부른 횟수(기다리는 동안 또 불렸는지) */
  private want = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private flashKind: string | null = null;
  /** Shift를 누른 동안 앱이 대신 건 잠금(선분 위 점 붙잡기 — 떼면 푼다) */
  private shiftLock = false;
  private lastKey = '';

  constructor(private readonly host: MeasureLockHost) {
    this.tip = h('div', { class: 'snap-tip', 'aria-hidden': 'true', hidden: true });
    host.layer.append(this.tip);
    this.button = h('button', { class: 'mb-btn icon mb-lock', type: 'button', title: '지금 방향 잠그기(다시 누르면 풀기)', 'aria-label': '방향 잠금', 'aria-pressed': 'false', hidden: true, html: icon('lock') });
    let pressedAt = -Infinity;
    this.button.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      pressedAt = performance.now();
      this.toggle();
    });
    this.button.addEventListener('click', () => {
      if (performance.now() - pressedAt < 1000) return;
      this.toggle();
    });
    this.flash = h('div', { class: 'measure-flash', role: 'status', hidden: true });
  }

  /** 뷰어가 생긴 뒤 한 번: 캔버스 포인터를 듣는다(코어 듣기 다음 — 거품 단계) */
  attach(canvas: HTMLCanvasElement): void {
    const parent = canvas.parentElement ?? canvas;
    parent.addEventListener('pointermove', (e) => {
      // 코어처럼 포인터 이동의 shiftKey로도 Shift 떼기를 본다(창 밖에서 뗀 경우)
      if (this.shiftLock && !e.shiftKey) this.shiftUp();
      this.schedule();
    });
    canvas.addEventListener('pointerleave', () => this.schedule());
    parent.addEventListener('pointerup', () => this.schedule());
  }

  /** 지금 잠근 방향 */
  get lock(): LockName | null {
    return lockName(this.host.viewer()?.measureInferenceLock);
  }

  /** 둘째 점의 방향을 잡는 중인지(첫 점을 찍었고 결과가 없음) */
  get directing(): boolean {
    const v = this.host.viewer();
    return !!v && v.measureMode && v.measurePointCount === 1;
  }

  /**
   * 다음 프레임(코어가 미리 보기를 구한 뒤)에 툴팁·잠금 상태를 맞춘다. 포인터 이동은 프레임에 맞춰 rAF 앞에 오므로 기다리는 동안 또 불리면
   * 그 이동의 미리 보기는 아직이다 — 맞춘 뒤 한 번 더 돈다(마지막 이동을 놓치지 않게)
   */
  schedule(): void {
    this.want++;
    if (this.raf) return;
    const w = this.want;
    this.raf = requestAnimationFrame(() => {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.update();
        if (this.want !== w) this.schedule();
      });
    });
  }

  /** 툴팁·잠금 단추·알림을 지금 상태로(잠금·찍은 점 수가 바뀌었으면 앱에 알린다) */
  update(): void {
    const v = this.host.viewer();
    const on = !!v && v.measureMode;
    const tip = on ? snapTip(v!.measureHoverSnap) : null;
    const hv = on ? v!.measureHoverSnap : null;
    const sp = tip && hv ? v!.project(hv.point) : null;
    if (!tip || !sp || !sp.onScreen) this.tip.hidden = true;
    else {
      this.tip.replaceChildren(h('span', {}, tip.name), ...(tip.locked ? [' · ', h('b', { class: 'st-lock' }, '잠금')] : []));
      this.tip.classList.toggle('locked', tip.locked);
      this.tip.hidden = false;
      const c = v!.canvas.getBoundingClientRect();
      const l = this.host.layer.getBoundingClientRect();
      const x = c.left - l.left + sp.x + 12;
      const y = c.top - l.top + sp.y + 12;
      // 오른쪽·아래 가장자리에서는 점 왼쪽·위로
      const w = this.tip.offsetWidth || 80;
      const ht = this.tip.offsetHeight || 20;
      this.tip.style.left = `${Math.round(x + w > l.width - 4 ? x - w - 24 : x)}px`;
      this.tip.style.top = `${Math.round(y + ht > l.height - 4 ? y - ht - 24 : y)}px`;
    }
    const lock = this.lock;
    if (lock) this.dropFlash(NO_LOCK);
    const directing = this.directing;
    this.button.hidden = !directing;
    this.button.setAttribute('aria-pressed', String(!!lock));
    this.button.classList.toggle('on', !!lock);
    this.button.title = lock ? '방향 잠금 풀기' : '지금 방향 잠그기(다시 누르면 풀기)';
    const key = `${on ? v!.measurePointCount : -1}|${lock ?? ''}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.host.changed();
    }
  }

  /** 잠금 단추: 잠겼으면 풀고, 아니면 지금 방향(없으면 첫 점 뒤 마지막으로 본 방향)을 잠근다 — 잠글 것이 없으면 맞추는 법을 알린다 */
  toggle(): boolean {
    const v = this.host.viewer();
    if (!v || !this.directing) return false;
    let ok = true;
    if (v.measureInferenceLock) {
      v.setMeasureInferenceLock(false);
      this.shiftLock = false;
    } else if (!v.setMeasureInferenceLock(true)) {
      ok = false;
      this.noLock();
    }
    this.after();
    return ok;
  }

  /** 화살표: 축(→ X · ← Y · ↑ Z)이나 지금 방향(↓, axis = null). 같은 것으로 이미 잠겼으면 푼다 */
  arrow(axis: 'x' | 'y' | 'z' | null): void {
    const v = this.host.viewer();
    if (!v || !this.directing) return;
    const cur = v.measureInferenceLock;
    this.shiftLock = false;
    if (axis) {
      if (cur?.kind === 'axis' && cur.axis === axis) v.setMeasureInferenceLock(false);
      else v.setMeasureInferenceLock(axis);
    } else if (cur) v.setMeasureInferenceLock(false);
    else if (!v.setMeasureInferenceLock(true)) this.noLock();
    this.after();
  }

  /**
   * Shift를 눌렀다(코어가 먼저 처리한 뒤 — 캔버스에 초점이 있으면 코어 키 듣기가 앱 창 듣기보다 뒤라 한 틈 뒤에 부른다).
   * 코어가 잠그지 않았고 커서가 점 붙잡기 위면, 마지막으로 본 방향을 잠가 그 점이 선 위인지 본다(아니면 푼다)
   */
  shiftDown(): void {
    const v = this.host.viewer();
    if (!v || !this.directing || v.measureInferenceLock) {
      this.schedule();
      return;
    }
    const hv = v.measureHoverSnap;
    if (hv?.snap && !hv.direction && v.setMeasureInferenceLock(true)) {
      // 잠근 선으로 미리 보기를 바로 다시 구한다(기다리면 한 프레임 잠금이 보였다 풀린다)
      v.renderNow();
      const after = v.measureHoverSnap;
      if (after?.locked && !after.from) this.shiftLock = true;
      else {
        v.setMeasureInferenceLock(false);
        v.renderNow();
      }
    }
    this.after();
  }

  /** Shift를 뗐다(창 blur도): 앱이 대신 건 잠금을 푼다(코어 Shift 잠금은 코어가 푼다) */
  shiftUp(): void {
    if (!this.shiftLock) return;
    this.shiftLock = false;
    const v = this.host.viewer();
    if (v?.measureInferenceLock?.source === 'api') v.setMeasureInferenceLock(false);
    this.after();
  }

  /** 측정을 끄거나 문서를 바꿨다: 툴팁·알림을 거둔다 */
  reset(): void {
    this.shiftLock = false;
    this.tip.hidden = true;
    this.dropFlash(null);
    this.schedule();
  }

  private after(): void {
    this.update();
    this.schedule();
  }

  /** 잠글 방향이 없다는 알림: 측정 띠가 보이면 띠 위에, 아니면(넓은 화면 키보드) 알림 상자로 */
  private noLock(): void {
    const touch = this.host.touch();
    const text = touch ? NO_LOCK_TOUCH : NO_LOCK_MOUSE;
    const bar = this.flash.parentElement;
    if (bar && !bar.hidden && getComputedStyle(bar).display !== 'none') this.showFlash(text, 3200, NO_LOCK);
    else toast(text, 'info', 3200);
  }

  /** 측정 띠 위 알림(kind를 붙이면 그 종류로 거둘 수 있다) */
  showFlash(text: string, ms = 1600, kind: string | null = null): void {
    this.flash.textContent = text;
    this.flash.hidden = false;
    this.flashKind = kind;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.dropFlash(null), ms);
  }

  /** 알림 거두기(kind를 주면 그 종류일 때만) */
  dropFlash(kind: string | null): void {
    if (this.flash.hidden || (kind !== null && this.flashKind !== kind)) return;
    this.flash.hidden = true;
    this.flashKind = null;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
  }

  /** 자동 확인용: 툴팁 글(숨었으면 null)과 알림 */
  snapshot(): { tip: string | null; flash: string | null; lock: LockName | null; button: boolean } {
    return { tip: this.tip.hidden ? null : this.tip.textContent, flash: this.flash.hidden ? null : this.flash.textContent, lock: this.lock, button: !this.button.hidden };
  }
}
