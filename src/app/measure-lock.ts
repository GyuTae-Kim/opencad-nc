/**
 * 측정 방향 잠금·붙잡기 툴팁(3D 뷰어 코어 0.10.0 추론 잠금·나란함, 0.12.0 모서리 끝 선분 방향 잠금 — SketchUp의 추론 잠금을 따른다).
 * 코어 측정 모드가 상태와 판정을 가지고(setMeasureSnap({ inference: { lock, parallel } })·setMeasureInferenceLock·measureHoverLock),
 * 이 모듈은 앱 쪽 손잡이만 둔다.
 *
 * - 툴팁: 측정 중 커서 아래 붙잡을 점의 종류(끝점·중심·교차점·X축 방향·나란한 방향 …)를 그 점 오른쪽 아래에, 잠갔으면 "잠금"을 덧붙인다.
 *   코어가 그린 거리 글상자(measureLabelRect)와 겹치거나 3D 보기 밖으로 나가면 왼쪽 아래·오른쪽 위·왼쪽 위 차례로 옮긴다(placeTip).
 *   코어는 미리 보기를 그리기(rAF) 때 구하므로 포인터 이동·키 뒤 다음 프레임에 읽는다. 글은 DOM이라 번역층이 옮긴다.
 * - Shift: 코어가 누르는 순간 잠글 방향(measureHoverLock — 방향 추론(축·나란함·수직), 첫 점을 지나는 선분 위의 점 붙잡기면 그 선분 방향:
 *   모서리 끝에서 그 모서리를 따라 다른 끝을 가리킬 때)을 잠그고 떼면 푼다. 앱은 Shift를 누르고 뗄 때 툴팁·상태 줄만 다시 맞춘다.
 *   상태 줄·측정 띠는 잠글 방향이 있을 때만 "Shift로 X축 방향 잠그기"처럼 알리고, 없으면 화살표만 알린다(lockHint).
 * - 화살표(첫 점을 찍은 뒤, 둘째 점 방향을 잡는 동안): → X · ← Y · ↑ Z축, ↓ 지금 방향(없으면 첫 점 뒤 마지막으로 본 방향 — 코어). 같은 키로 푼다.
 * - 측정 띠 잠금 단추(손가락 기기 — 넓은 화면에서는 띠가 숨는다): 방향을 잡는 동안만 보인다. 정밀 조준 중 다른 손가락으로 누르면 click이
 *   오지 않으므로 손가락·펜은 pointerdown에서 받는다. 잠글 방향이 없으면 띠 위에 알림을 띄우고, 잠금이 걸리면(어느 길로든) 그 알림만 거둔다.
 * - 원호 접선(13차): 첫 점이 원호 이동(G2/G3, 나선 포함)의 시작·끝이고 커서 아래 점이 그 원호 위(다른 끝 포함)면 Shift·↓·잠금 단추가
 *   그 끝의 접선 방향으로 잠근다(host.arcTangent — tangent.ts, 코어 setMeasureInferenceLock({ direction, kind: 'parallel' })).
 *   첫 점이 원호의 가운데 점(앱의 원호 가운데 점 붙잡기)이어도 그 점의 접선으로(14차).
 *   코어는 원호를 나눈 현을 선분으로 보므로 첫 현의 끝을 가리키면 그 현 방향으로 잠그려 한다 — 커서 아래 점이 원호 위면 접선이 먼저다.
 *   커서 아래가 방향 추론(축·나란함·수직 발 — 툴팁이 그 이름)이면 코어 판정 그대로다. 잠글 것을 지금 못 보면(커서가 떠남) 코어처럼
 *   첫 점 뒤 마지막으로 본 방향 — 그것이 접선이었으면 접선. Shift는 앱 onKey가 코어보다 먼저 shiftDown을 불러 잠그고(코어는 잠금이 있으면
 *   Shift를 넘긴다) 떼면 shiftUp이 푼다(코어는 제가 잠근 Shift만 푼다). 툴팁·안내·결과는 "접선 방향"이라 적는다.
 * 둘째 점을 찍거나 측정을 지우거나 측정을 끄면 코어가 잠금을 푼다.
 */
import type { MeasureHoverSnap, MeasureLabelRect, Viewer3d } from 'opencad-viewer3d';
import { h, toast } from './dom';
import { icon } from './icons';
import { NO_LOCK_MOUSE, NO_LOCK_TOUCH, TANGENT_LABEL, lockName, snapLabel, type LockName } from './measure';

type V3 = [number, number, number];

/** 이 모듈이 쓰는 뷰어 기능(시험에서 가짜로 바꿀 수 있게) */
export type LockViewer = Pick<
  Viewer3d,
  'canvas' | 'measureMode' | 'measurePointCount' | 'measurePoints' | 'measureHoverSnap' | 'measureHoverLock' | 'measureInferenceLock' | 'measureLabelRect' | 'setMeasureInferenceLock' | 'project'
>;

export interface MeasureLockHost {
  viewer(): LockViewer | null;
  /** 손가락이 주인 기기인지(알림 글) */
  touch(): boolean;
  /** 툴팁을 붙일 층(3D 보기) */
  layer: HTMLElement;
  /** 잠금·찍은 점 수·Shift로 잠글 방향이 바뀌었다(상태 줄·측정 띠 다시 그리기) */
  changed(): void;
  /**
   * 첫 측정 점 a가 원호 이동의 시작·끝(·가운데 점)이고 커서 아래 점 p가 그 원호 위면 그 자리의 단위 접선(tangent.ts arcTangentAt), 아니면 null.
   * 원호를 모르는 문서(판재 등)·시험은 두지 않아도 된다
   */
  arcTangent?(a: V3, p: V3): V3 | null;
}

/** 방향 추론 붙잡기(첫 점을 지나는 선 위의 점 — 툴팁이 그 이름): 원호 접선보다 코어 판정이 먼저 */
const INFERRED = new Set(['axis', 'parallel', 'perpendicular']);
/** 같은 방향(부호 무시)으로 볼 단위 벡터 내적 */
const SAME_DIR = 1 - 1e-9;
const sameLine = (a: readonly number[], b: readonly number[]): boolean => Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) >= SAME_DIR;

/** 측정 띠 알림 종류: 잠글 방향이 없음(잠금이 걸리면 거둔다) */
const NO_LOCK = 'no-lock';
/** 툴팁과 점 사이(가로·세로), 3D 보기 가장자리 여백 */
const TIP_GAP = 12;
const TIP_EDGE = 4;

/** 툴팁 글(붙잡은 종류 이름, 잠갔는지). 붙잡지 않은 점·미리 보기가 없으면 null */
export function snapTip(hv: Pick<MeasureHoverSnap, 'snap' | 'axis' | 'locked'> | null | undefined): { name: string; locked: boolean } | null {
  if (!hv?.snap) return null;
  return { name: snapLabel(hv.snap, hv.axis), locked: !!hv.locked };
}

/**
 * 툴팁 왼쪽 위 자리(층 기준 CSS 화소): 점(px, py) 오른쪽 아래가 먼저이고, 층(width × height) 밖으로 나가거나 피할 상자(코어 거리 글상자 —
 * 같은 층 기준)와 겹치면 왼쪽 아래·오른쪽 위·왼쪽 위 차례로 본다. 층 안이면서 겹치지 않는 곳이 없으면 층 안인 첫 자리(없으면 오른쪽 아래)
 */
export function placeTip(px: number, py: number, w: number, ht: number, layer: { width: number; height: number }, avoid: MeasureLabelRect | null): { x: number; y: number } {
  const right = px + TIP_GAP;
  const left = px - TIP_GAP - w;
  const below = py + TIP_GAP;
  const above = py - TIP_GAP - ht;
  const spots = [
    { x: right, y: below },
    { x: left, y: below },
    { x: right, y: above },
    { x: left, y: above },
  ];
  const inside = (s: { x: number; y: number }): boolean => s.x >= TIP_EDGE && s.y >= TIP_EDGE && s.x + w <= layer.width - TIP_EDGE && s.y + ht <= layer.height - TIP_EDGE;
  const clear = (s: { x: number; y: number }): boolean => !avoid || s.x >= avoid.x + avoid.width || avoid.x >= s.x + w || s.y >= avoid.y + avoid.height || avoid.y >= s.y + ht;
  return spots.find((s) => inside(s) && clear(s)) ?? spots.find(inside) ?? spots[0]!;
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
  private lastKey = '';
  /** 앱이 원호 접선으로 잠근 방향(코어 잠금이 이것과 같은 방향의 'api' 잠금이면 접선 잠금) */
  private tangent: V3 | null = null;
  /** 접선 잠금을 Shift로 걸었는지(떼면 푼다) */
  private shiftTangent = false;
  /** 첫 점 뒤 마지막으로 본 잠글 것이 원호 접선이었으면 그 방향(코어 방향을 보면 지운다 — 코어의 "마지막으로 본 방향"과 같은 차례) */
  private seenTangent: V3 | null = null;
  /** seenTangent·접선 결과를 맞춘 첫 점(바뀌면 잊는다) */
  private firstKey = '';
  /** 접선 잠금으로 찍은 둘째 점을 결과에서 알아보려고 남기는 방향(다른 잠금·첫 점이 바뀌면 지운다) */
  private resultTangent: V3 | null = null;

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
    parent.addEventListener('pointermove', () => this.schedule());
    canvas.addEventListener('pointerleave', () => this.schedule());
    parent.addEventListener('pointerup', () => this.schedule());
  }

  /** 지금 잠근 방향(원호 접선으로 잠갔으면 'tangent') */
  get lock(): LockName | null {
    const l = this.host.viewer()?.measureInferenceLock;
    if (l && this.tangentLocked(l)) return 'tangent';
    return lockName(l);
  }

  /** 잠그지 않았을 때 Shift(·잠금 단추)가 지금 잠글 방향(원호 접선, 아니면 코어 measureHoverLock). 방향을 잡는 중이 아니면 null */
  get hoverLock(): LockName | null {
    const v = this.host.viewer();
    if (!v || !this.directing || v.measureInferenceLock) return null;
    if (this.tangentNow()) return 'tangent';
    return lockName(v.measureHoverLock);
  }

  /**
   * 커서 아래에서 잠글 원호 접선: 방향을 잡는 중이고 잠그지 않았으며, 커서 아래 점이 방향 추론(축·나란함·수직 발)이 아니고
   * 첫 점에 닿는 원호 위에 있으면 그 끝의 접선(host.arcTangent). 아니면 null
   */
  tangentNow(): V3 | null {
    const v = this.host.viewer();
    const at = this.host.arcTangent;
    if (!v || !at || !this.directing || v.measureInferenceLock) return null;
    const hv = v.measureHoverSnap;
    if (!hv || (hv.snap && INFERRED.has(hv.snap))) return null;
    const first = v.measurePoints[0];
    return first ? at.call(this.host, first.point, hv.point) : null;
  }

  /** 코어 잠금이 앱이 건 원호 접선 잠금인지(같은 방향의 'api' 나란함 잠금) */
  private tangentLocked(l: { kind: string; direction: readonly number[]; source?: string }): boolean {
    return !!this.tangent && l.kind === 'parallel' && l.source === 'api' && sameLine(l.direction, this.tangent);
  }

  /** 측정 결과의 둘째 점을 원호 접선 잠금으로 찍었는지(코어 결과는 나란함 — 이름만 접선 방향으로) */
  tangentResult(m: { lockedB?: boolean; snapB?: string | null; directionB?: readonly number[] } | null | undefined): boolean {
    return !!m?.lockedB && m.snapB === 'parallel' && !!m.directionB && !!this.resultTangent && sameLine(m.directionB, this.resultTangent);
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

  /** 툴팁·잠금 단추·알림을 지금 상태로(잠금·찍은 점 수·Shift로 잠글 방향이 바뀌었으면 앱에 알린다) */
  update(): void {
    const v = this.host.viewer();
    const on = !!v && v.measureMode;
    this.track();
    const snap = on ? snapTip(v!.measureHoverSnap) : null;
    // 원호 접선으로 잠근 선 위의 점은 코어 종류(나란함) 대신 접선 방향
    const tip = snap && snap.locked && v!.measureHoverSnap?.snap === 'parallel' && v!.measureInferenceLock && this.tangentLocked(v!.measureInferenceLock) ? { ...snap, name: TANGENT_LABEL } : snap;
    const hv = on ? v!.measureHoverSnap : null;
    const sp = tip && hv ? v!.project(hv.point) : null;
    if (!tip || !sp || !sp.onScreen) this.tip.hidden = true;
    else {
      this.tip.replaceChildren(h('span', {}, tip.name), ...(tip.locked ? [' · ', h('b', { class: 'st-lock' }, '잠금')] : []));
      this.tip.classList.toggle('locked', tip.locked);
      this.tip.hidden = false;
      const c = v!.canvas.getBoundingClientRect();
      const l = this.host.layer.getBoundingClientRect();
      const ox = c.left - l.left;
      const oy = c.top - l.top;
      // 코어 거리 글상자(캔버스 기준 — 지난 그리기)를 층 기준으로
      const r = v!.measureLabelRect;
      const avoid = r ? { x: ox + r.x, y: oy + r.y, width: r.width, height: r.height } : null;
      const at = placeTip(ox + sp.x, oy + sp.y, this.tip.offsetWidth || 80, this.tip.offsetHeight || 20, l, avoid);
      this.tip.style.left = `${Math.round(at.x)}px`;
      this.tip.style.top = `${Math.round(at.y)}px`;
    }
    const lock = this.lock;
    if (lock) this.dropFlash(NO_LOCK);
    const directing = this.directing;
    this.button.hidden = !directing;
    this.button.setAttribute('aria-pressed', String(!!lock));
    this.button.classList.toggle('on', !!lock);
    this.button.title = lock ? '방향 잠금 풀기' : '지금 방향 잠그기(다시 누르면 풀기)';
    const key = `${on ? v!.measurePointCount : -1}|${lock ?? ''}|${this.hoverLock ?? ''}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.host.changed();
    }
  }

  /** 잠금 단추: 잠겼으면 풀고, 아니면 지금 방향(원호 접선이나 코어 — Shift와 같은 판정, 없으면 첫 점 뒤 마지막으로 본 방향)을 잠근다 — 잠글 것이 없으면 맞추는 법을 알린다 */
  toggle(): boolean {
    const v = this.host.viewer();
    if (!v || !this.directing) return false;
    let ok = true;
    if (v.measureInferenceLock) this.unlock();
    else if (!this.lockNow()) {
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
    if (axis) {
      if (cur?.kind === 'axis' && cur.axis === axis) this.unlock();
      else {
        this.forgetTangent();
        v.setMeasureInferenceLock(axis);
      }
    } else if (cur) this.unlock();
    else if (!this.lockNow()) this.noLock();
    this.after();
  }

  /**
   * Shift 누름(앱 onKey가 코어에 넘기기 전에 — 코어는 잠금이 있으면 Shift를 넘긴다): 커서 아래가 원호 위면 그 접선으로 잠근다.
   * 아니면 아무것도 하지 않는다(코어가 제 판정으로 잠근다)
   */
  shiftDown(): void {
    const t = this.tangentNow();
    if (!t || !this.lockTangent(t)) return;
    this.shiftTangent = true;
    this.after();
  }

  /** Shift 뗌·창 흐려짐: Shift로 건 접선 잠금이면 푼다(둘째 점을 찍어 코어가 이미 풀었으면 그대로) */
  shiftUp(): void {
    if (!this.shiftTangent) return;
    this.shiftTangent = false;
    const v = this.host.viewer();
    const l = v?.measureInferenceLock;
    if (v && l && this.tangentLocked(l)) {
      v.setMeasureInferenceLock(false);
      this.forgetTangent();
    }
    this.after();
  }

  /** 지금 방향 잠그기: 커서 아래 원호 접선, 코어가 볼 방향, 지금 볼 것이 없으면 마지막으로 본 것(접선이었으면 접선, 아니면 코어) */
  private lockNow(): boolean {
    const v = this.host.viewer();
    if (!v) return false;
    const t = this.tangentNow() ?? (v.measureHoverLock ? null : this.seenTangent);
    if (t) return this.lockTangent(t);
    this.forgetTangent();
    return v.setMeasureInferenceLock(true);
  }

  /** 원호 접선으로 잠근다(코어 나란함 잠금 — 축과 나란해도 접선 이름으로) */
  private lockTangent(t: V3): boolean {
    const v = this.host.viewer();
    if (!v || !v.setMeasureInferenceLock({ direction: t, kind: 'parallel' })) return false;
    this.tangent = [...t];
    this.resultTangent = [...t];
    return true;
  }

  private unlock(): void {
    this.host.viewer()?.setMeasureInferenceLock(false);
    this.forgetTangent();
  }

  /** 접선 잠금 기록을 지운다(다른 잠금으로 바꾸거나 풀었다) */
  private forgetTangent(): void {
    this.tangent = null;
    this.resultTangent = null;
    this.shiftTangent = false;
  }

  /**
   * 첫 점 뒤 마지막으로 본 잠글 것(코어 lastLockable과 같은 차례 — 원호 접선을 보면 그것, 코어 방향을 보면 코어)과 첫 점이 바뀌었는지.
   * 새 첫 점(다시 재기·둘째 점 뒤 새로)이면 접선 기록을 잊는다(결과를 보이는 동안은 남긴다)
   */
  private track(): void {
    const v = this.host.viewer();
    const pts = (v && v.measureMode ? v.measurePoints : null) ?? [];
    const key = pts.length ? pts[0]!.point.join(',') : '';
    if (key !== this.firstKey) {
      this.firstKey = key;
      this.seenTangent = null;
      if (pts.length === 1) this.forgetTangent();
    }
    if (!v || !this.directing || v.measureInferenceLock) return;
    const t = this.tangentNow();
    if (t) this.seenTangent = t;
    else if (v.measureHoverLock) this.seenTangent = null;
  }

  /** 측정을 끄거나 문서를 바꿨다: 툴팁·알림·접선 기록을 거둔다 */
  reset(): void {
    this.tip.hidden = true;
    this.dropFlash(null);
    this.forgetTangent();
    this.seenTangent = null;
    this.firstKey = '';
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

  /** 자동 확인용: 툴팁 글(숨었으면 null)·자리, 알림, 잠금, Shift로 잠글 방향, 단추 */
  snapshot(): { tip: string | null; flash: string | null; lock: LockName | null; hoverLock: LockName | null; button: boolean; tipRect: { x: number; y: number } | null } {
    const hidden = this.tip.hidden;
    return {
      tip: hidden ? null : this.tip.textContent,
      flash: this.flash.hidden ? null : this.flash.textContent,
      lock: this.lock,
      hoverLock: this.hoverLock,
      button: !this.button.hidden,
      tipRect: hidden ? null : { x: parseFloat(this.tip.style.left), y: parseFloat(this.tip.style.top) },
    };
  }
}
