/**
 * 정밀 조준(터치 길게 누르기): 측정 중 한 손가락을 움직이지 않고(AIM_SLOP_PX 안) AIM_HOLD_MS 동안 누르면
 * 손가락 위 AIM_OFFSET_PX에 십자선을 띄우고, 끌면 궤도 대신 십자선이 따라간다. 떼면 십자선 자리를 누른 것으로 친다.
 *
 * 코어(Viewer3d)는 고치지 않고 캔버스 부모(.v3d)의 캡처 단계에서 먼저 받는다(코어 듣기는 캔버스에 있다):
 * - 조준을 시작하면 코어에 pointercancel을 보내 그 손가락의 끌기 상태를 잊게 한다. 그 뒤 움직임은 막고(stopPropagation)
 *   십자선 자리로 pointermove를 보낸다 — 코어가 붙잡을 점(꼭짓점·끝점)·고무줄·거리를 마우스처럼 미리 그린다.
 * - 떼면 진짜 pointerup을 막고 십자선 자리에서 pointerdown·pointerup을 보내, 코어의 누르기 처리
 *   (4화소 안에서 떼면 click — 측정 점 찍기)를 그대로 쓴다. 이어 pointerleave로 미리 보기를 지운다.
 * - 둘째 손가락이 닿으면 조준을 그만두고 첫 손가락을 지금 자리에서 다시 눌린 것으로 알려, 코어가 두 손가락 확대·이동을 한다.
 * - pointercancel은 그대로 넘기고 조준만 그만둔다. 밖에서 cancel()하면 그 손가락은 뗄 때까지 코어에 넘기지 않는다.
 * 보내는 이벤트는 같은 pointerId·pointerType 'touch'이고, PointerEvent가 없으면 MouseEvent에 두 값을 덧붙인다.
 *
 * opencad-step 커밋 5465e63의 src/app/aim.ts를 옮겼다(NC는 면 고르기가 없어 측정에만 쓴다).
 */

/** 이만큼(ms) 움직이지 않고 누르고 있으면 정밀 조준 */
export const AIM_HOLD_MS = 350;
/** 십자선을 손가락 위로 띄우는 거리(화소) — 손가락에 가리지 않게 */
export const AIM_OFFSET_PX = 64;
/** 누르기로 볼 최대 움직임(화소, 코어 끌기 시작과 같다) */
export const AIM_SLOP_PX = 4;

export interface AimOptions {
  /** 조준을 받을 때인지(측정 중) */
  enabled: () => boolean;
  /** 십자선을 그릴 층(캔버스 위에 겹친 요소, 누르기는 받지 않는다) */
  layer: HTMLElement;
  /** 조준 시작·끝 알림 */
  onChange?: (aiming: boolean) => void;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Press {
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** 십자선 자리(화면 좌표): 손가락 바로 위, 보기(rect) 밖으로 나가지 않게(위 가장자리에서 멈춘다) */
export function aimPoint(x: number, y: number, rect: Rect): { x: number; y: number } {
  return { x: clamp(x, rect.left, rect.right - 1), y: clamp(y - AIM_OFFSET_PX, rect.top, rect.bottom - 1) };
}

/** 코어에 보낼 터치 포인터 이벤트(PointerEvent가 없는 브라우저·시험에서는 MouseEvent + pointerId·pointerType) */
export function touchPointerEvent(type: string, pointerId: number, clientX: number, clientY: number): MouseEvent {
  const down = type === 'pointerdown' || type === 'pointermove';
  const init = {
    bubbles: type !== 'pointerleave',
    cancelable: type !== 'pointerleave' && type !== 'pointercancel',
    composed: true,
    clientX,
    clientY,
    button: type === 'pointermove' ? -1 : 0,
    buttons: down ? 1 : 0,
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
  };
  if (typeof PointerEvent === 'function') return new PointerEvent(type, init);
  const e = new MouseEvent(type, init);
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  Object.defineProperty(e, 'isPrimary', { value: true });
  return e;
}

export class TouchAim {
  private readonly trap: HTMLElement;
  private readonly reticle: HTMLElement;
  private readonly presses = new Map<number, Press>();
  private readonly off: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 코어가 잊은 손가락(조준 중이거나, 밖에서 조준을 그만둔 뒤 아직 누르고 있는 것) */
  private heldId: number | null = null;
  private aimOn = false;
  /** 십자선 자리(화면 좌표) */
  private at = { x: 0, y: 0 };
  /** 우리가 보낸 이벤트를 다시 받지 않게 */
  private relaying = false;

  constructor(
    private readonly canvas: HTMLElement,
    private readonly opts: AimOptions,
  ) {
    this.trap = canvas.parentElement ?? canvas;
    this.reticle = reticle();
    opts.layer.append(this.reticle);
    this.listen('pointerdown', (e) => this.onDown(e));
    this.listen('pointermove', (e) => this.onMove(e));
    this.listen('pointerup', (e) => this.onUp(e, false));
    this.listen('pointercancel', (e) => this.onUp(e, true));
  }

  /** 정밀 조준 중인지(십자선이 보이는 동안) */
  get aiming(): boolean {
    return this.aimOn;
  }

  /** 지금 십자선 자리(화면 좌표, 조준 중이 아니면 null) */
  get point(): { x: number; y: number } | null {
    return this.aimOn ? { ...this.at } : null;
  }

  /** 조준을 그만둔다(측정을 끄거나 새 문서를 열 때). 누르고 있는 손가락은 뗄 때까지 코어에 넘기지 않아 엉뚱한 고르기가 없다 */
  cancel(): void {
    this.stopTimer();
    if (!this.aimOn) return;
    this.hide();
  }

  dispose(): void {
    this.stopTimer();
    for (const f of this.off) f();
    this.off.length = 0;
    this.reticle.remove();
  }

  // ───────────────────────── 입력(캔버스 부모, 캡처 단계) ─────────────────────────

  private listen(type: string, fn: (e: PointerEvent) => void): void {
    const h = (e: Event): void => {
      if (!this.relaying) fn(e as PointerEvent);
    };
    this.trap.addEventListener(type, h, true);
    this.off.push(() => this.trap.removeEventListener(type, h, true));
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch' || e.target !== this.canvas) return;
    // 둘째 손가락: 조준을 그만두고 두 손가락 확대·이동은 코어에 맡긴다
    if (this.presses.size) {
      this.stopTimer();
      this.rejoin();
    }
    this.presses.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false });
    if (this.presses.size === 1 && this.opts.enabled()) {
      const id = e.pointerId;
      this.timer = setTimeout(() => this.start(id), AIM_HOLD_MS);
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.presses.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (e.pointerId === this.heldId) {
      // 코어(궤도)로 보내지 않는다
      e.stopPropagation();
      if (this.aimOn) this.moveTo(p.x, p.y);
      return;
    }
    if (!p.moved && Math.hypot(p.x - p.x0, p.y - p.y0) >= AIM_SLOP_PX) {
      p.moved = true;
      this.stopTimer();
    }
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    this.presses.delete(e.pointerId);
    if (!this.presses.size) this.stopTimer();
    if (e.pointerId !== this.heldId) return;
    const id = e.pointerId;
    const aimed = this.aimOn;
    const at = this.at;
    if (aimed) this.hide();
    this.heldId = null;
    // 취소는 그대로 넘긴다(코어는 이 손가락을 이미 잊어 아무것도 하지 않는다)
    if (cancel) return;
    e.stopPropagation();
    if (aimed && this.opts.enabled()) {
      this.relay('pointerdown', id, at);
      this.relay('pointerup', id, at);
    }
  }

  // ───────────────────────── 조준 ─────────────────────────

  private stopTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private start(id: number): void {
    this.timer = null;
    const p = this.presses.get(id);
    if (!p || p.moved || this.presses.size !== 1 || this.heldId !== null || !this.opts.enabled()) return;
    this.heldId = id;
    this.aimOn = true;
    // 코어가 이 손가락의 끌기(궤도) 상태를 잊게 한다
    this.relay('pointercancel', id, p);
    this.reticle.hidden = false;
    this.moveTo(p.x, p.y);
    // 짧은 떨림으로 조준이 시작됐음을 알린다(지원하는 기기만)
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 진동을 막은 브라우저 */
    }
    this.opts.onChange?.(true);
  }

  /** 손가락 자리 → 십자선 옮기기, 코어에 그 자리 움직임을 보내 미리 보기(측정 중 붙잡을 점) */
  private moveTo(x: number, y: number): void {
    const at = aimPoint(x, y, this.canvas.getBoundingClientRect());
    this.at = at;
    const lr = this.opts.layer.getBoundingClientRect();
    this.reticle.style.transform = `translate(${at.x - lr.left}px, ${at.y - lr.top}px)`;
    if (this.heldId !== null) this.relay('pointermove', this.heldId, at);
  }

  /** 십자선을 감추고 코어의 미리 보기를 지운다(손가락은 아직 코어가 모른다) */
  private hide(): void {
    this.aimOn = false;
    this.reticle.hidden = true;
    if (this.heldId !== null) this.relay('pointerleave', this.heldId, this.at);
    this.opts.onChange?.(false);
  }

  /** 코어가 잊은 손가락을 지금 자리에서 다시 눌린 것으로 알린다(둘째 손가락이 닿을 때 — 코어가 두 손가락으로 다룬다) */
  private rejoin(): void {
    const id = this.heldId;
    if (id === null) return;
    if (this.aimOn) this.hide();
    this.heldId = null;
    const p = this.presses.get(id);
    if (p) this.relay('pointerdown', id, p);
  }

  private relay(type: string, id: number, at: { x: number; y: number }): void {
    this.relaying = true;
    try {
      this.canvas.dispatchEvent(touchPointerEvent(type, id, at.x, at.y));
    } finally {
      this.relaying = false;
    }
  }
}

/** 십자선(가운데는 비워 코어의 붙잡을 점이 보이게, 흰 테두리로 어느 바탕에서도 보이게) */
function reticle(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'aim-reticle';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  const r = 16;
  const gap = 6;
  const c = 24;
  const d = `M${c - r - 6} ${c}H${c - gap}M${c + gap} ${c}H${c + r + 6}M${c} ${c - r - 6}V${c - gap}M${c} ${c + gap}V${c + r + 6}`;
  el.innerHTML =
    `<svg width="48" height="48" viewBox="0 0 48 48" fill="none">` +
    `<circle cx="${c}" cy="${c}" r="${r}" stroke="#ffffff" stroke-width="3.5" stroke-opacity="0.85"/>` +
    `<path d="${d}" stroke="#ffffff" stroke-width="3.5" stroke-opacity="0.85"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" stroke="currentColor" stroke-width="1.5"/>` +
    `<path d="${d}" stroke="currentColor" stroke-width="1.5"/>` +
    `</svg>`;
  return el;
}
