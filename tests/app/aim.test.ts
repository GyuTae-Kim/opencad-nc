// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOUCH_DRAG_START_PX } from 'opencad-viewer3d';
import { AIM_HOLD_MS, AIM_OFFSET_PX, AIM_SLOP_PX, TouchAim, aimPoint, touchPointerEvent } from '../../src/app/aim';

interface Seen {
  type: string;
  id: number;
  x: number;
  y: number;
  pointerType: string;
}

const RECT = { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

/**
 * 코어(Viewer3d) 포인터 처리를 줄인 가짜: 캔버스에서 듣고, 한 손가락은 끌기(터치는 TOUCH_DRAG_START_PX = 10화소부터 궤도),
 * 움직이지 않고 떼면 click, 두 손가락은 확대·이동, 끌기가 없을 때 움직임은 미리 보기(hover).
 */
function fakeCore(canvas: HTMLElement) {
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { mode: 'orbit' | 'touch'; sx: number; sy: number; moved: boolean } | null = null;
  const st = { clicks: [] as { x: number; y: number }[], orbits: 0, pinches: 0, hover: null as { x: number; y: number } | null, pointers };
  const on = (type: string, fn: (e: PointerEvent) => void): void => canvas.addEventListener(type, fn as EventListener);
  on('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = pointers.size === 1 ? { mode: 'orbit', sx: e.clientX, sy: e.clientY, moved: false } : { mode: 'touch', sx: 0, sy: 0, moved: true };
  });
  on('pointermove', (e) => {
    const p = { x: e.clientX, y: e.clientY };
    if (!drag || !pointers.has(e.pointerId)) {
      if (!drag) st.hover = p;
      return;
    }
    pointers.set(e.pointerId, p);
    if (drag.mode === 'touch') {
      st.pinches++;
      return;
    }
    if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < TOUCH_DRAG_START_PX) return;
    drag.moved = true;
    st.orbits++;
  });
  const up = (e: PointerEvent, cancel: boolean): void => {
    const had = pointers.delete(e.pointerId);
    if (!had || !drag) return;
    if (drag.mode === 'orbit' && !cancel && !drag.moved) st.clicks.push({ x: e.clientX, y: e.clientY });
    if (!pointers.size) drag = null;
  };
  on('pointerup', (e) => up(e, false));
  on('pointercancel', (e) => up(e, true));
  on('pointerleave', () => {
    st.hover = null;
  });
  return st;
}

describe('정밀 조준 자리·이벤트', () => {
  it('십자선은 손가락 위 AIM_OFFSET_PX, 보기 밖으로 나가지 않는다', () => {
    expect(aimPoint(30, 100, RECT)).toEqual({ x: 30, y: 100 - AIM_OFFSET_PX });
    expect(aimPoint(30, 10, RECT)).toEqual({ x: 30, y: 0 });
    expect(aimPoint(500, 700, RECT)).toEqual({ x: 399, y: 299 });
  });

  it('누르기로 볼 움직임은 코어의 터치 끌기 시작 거리(10화소)와 같다', () => {
    expect(AIM_SLOP_PX).toBe(TOUCH_DRAG_START_PX);
    expect(AIM_SLOP_PX).toBe(10);
  });

  it('PointerEvent가 없으면 MouseEvent에 pointerId·pointerType을 덧붙인다(pointerleave만 버블 없음)', () => {
    expect(typeof PointerEvent).toBe('undefined');
    const e = touchPointerEvent('pointerup', 7, 12, 34) as PointerEvent;
    expect(e).toBeInstanceOf(MouseEvent);
    expect([e.type, e.pointerId, e.pointerType, e.clientX, e.clientY, e.bubbles]).toEqual(['pointerup', 7, 'touch', 12, 34, true]);
    expect(touchPointerEvent('pointerleave', 7, 0, 0).bubbles).toBe(false);
  });
});

describe('정밀 조준(터치 길게 누르기)', () => {
  let wrap: HTMLElement;
  let canvas: HTMLCanvasElement;
  let layer: HTMLElement;
  let enabled: boolean;
  let aim: TouchAim;
  let seen: Seen[];
  let core: ReturnType<typeof fakeCore>;

  const fire = (type: string, x: number, y: number, id = 1): void => {
    canvas.dispatchEvent(touchPointerEvent(type, id, x, y));
  };
  const reticle = (): HTMLElement => layer.querySelector<HTMLElement>('.aim-reticle')!;
  const since = (n: number): string[] => seen.slice(n).map((s) => `${s.type} ${s.id} ${s.x},${s.y}`);

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    wrap = document.createElement('div');
    canvas = document.createElement('canvas');
    wrap.append(canvas);
    layer = document.createElement('div');
    document.body.append(wrap, layer);
    canvas.getBoundingClientRect = () => RECT;
    layer.getBoundingClientRect = () => RECT;
    // 진짜 코어처럼 캔버스에서 듣는다(조준 듣기는 부모의 캡처 단계라 먼저 받는다)
    core = fakeCore(canvas);
    seen = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']) {
      canvas.addEventListener(type, (e) => {
        const p = e as PointerEvent;
        seen.push({ type, id: p.pointerId, x: p.clientX, y: p.clientY, pointerType: p.pointerType });
      });
    }
    enabled = true;
    aim = new TouchAim(canvas, { enabled: () => enabled, layer });
  });

  afterEach(() => {
    aim.dispose();
    vi.useRealTimers();
  });

  it('길게 누르면 손가락 위에 십자선 — 끄는 동안 움직임은 코어에 닿지 않고, 떼면 십자선 자리를 누른다', () => {
    fire('pointerdown', 100, 200);
    vi.advanceTimersByTime(AIM_HOLD_MS - 1);
    expect(aim.aiming).toBe(false);
    expect(reticle().hidden).toBe(true);
    const n0 = seen.length;
    vi.advanceTimersByTime(1);
    expect(aim.aiming).toBe(true);
    expect(aim.point).toEqual({ x: 100, y: 200 - AIM_OFFSET_PX });
    expect(reticle().hidden).toBe(false);
    expect(reticle().style.transform).toBe(`translate(100px, ${200 - AIM_OFFSET_PX}px)`);
    // 코어는 이 손가락의 끌기를 잊고(취소), 십자선 자리 움직임으로 미리 보기를 그린다
    expect(since(n0)).toEqual([`pointercancel 1 100,200`, `pointermove 1 100,${200 - AIM_OFFSET_PX}`]);
    expect(core.pointers.size).toBe(0);
    expect(core.hover).toEqual({ x: 100, y: 200 - AIM_OFFSET_PX });

    // 끌면 십자선만 따라간다: 진짜 움직임(손가락 자리)은 캔버스에 오지 않는다
    const n1 = seen.length;
    fire('pointermove', 150, 230);
    fire('pointermove', 160, 240);
    expect(since(n1)).toEqual([`pointermove 1 150,${230 - AIM_OFFSET_PX}`, `pointermove 1 160,${240 - AIM_OFFSET_PX}`]);
    expect(core.orbits).toBe(0);
    expect(reticle().style.transform).toBe(`translate(160px, ${240 - AIM_OFFSET_PX}px)`);

    // 떼면 진짜 pointerup은 막고, 십자선 자리에서 누르고 뗀 것으로 코어에 알린다
    const n2 = seen.length;
    fire('pointerup', 160, 240);
    expect(since(n2)).toEqual([`pointerleave 1 160,${240 - AIM_OFFSET_PX}`, `pointerdown 1 160,${240 - AIM_OFFSET_PX}`, `pointerup 1 160,${240 - AIM_OFFSET_PX}`]);
    expect(seen.slice(n2).every((s) => s.pointerType === 'touch')).toBe(true);
    expect(core.clicks).toEqual([{ x: 160, y: 240 - AIM_OFFSET_PX }]);
    expect(core.orbits).toBe(0);
    expect(core.pointers.size).toBe(0);
    expect(aim.aiming).toBe(false);
    expect(reticle().hidden).toBe(true);
  });

  it('누른 채 6~9화소 떨려도 조준하고, 보기 위쪽에서는 십자선이 위 가장자리에 멈춘다', () => {
    fire('pointerdown', 50, 30);
    fire('pointermove', 56, 34);
    expect(Math.hypot(6, 4)).toBeLessThan(AIM_SLOP_PX);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    expect(aim.aiming).toBe(true);
    expect(core.orbits).toBe(0);
    expect(aim.point).toEqual({ x: 56, y: 0 });
    fire('pointerup', 56, 34);
    expect(core.clicks).toEqual([{ x: 56, y: 0 }]);
  });

  it('10화소(코어가 돌리기 시작하는 거리)를 움직이면 조준하지 않는다', () => {
    fire('pointerdown', 100, 200);
    fire('pointermove', 109, 200);
    fire('pointermove', 110, 200);
    vi.advanceTimersByTime(AIM_HOLD_MS * 2);
    expect(aim.aiming).toBe(false);
    expect(core.orbits).toBe(1);
  });

  it('누르자마자 끌면 조준하지 않는다(코어 궤도 그대로 — 6화소 떨림은 아직 누르기, 더 끌면 궤도)', () => {
    fire('pointerdown', 100, 200);
    fire('pointermove', 106, 200);
    fire('pointermove', 140, 210);
    vi.advanceTimersByTime(AIM_HOLD_MS * 2);
    expect(aim.aiming).toBe(false);
    expect(core.orbits).toBe(1);
    fire('pointerup', 140, 210);
    expect(seen.at(-1)).toMatchObject({ type: 'pointerup', x: 140, y: 210 });
    expect(core.clicks).toEqual([]);
  });

  it('짧게 누르면 그대로 코어의 누르기(손가락 자리) — 8화소 남짓 떨린 짧은 누르기도 누르기', () => {
    fire('pointerdown', 100, 200);
    vi.advanceTimersByTime(AIM_HOLD_MS / 2);
    fire('pointerup', 100, 200);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    expect(aim.aiming).toBe(false);
    expect(core.clicks).toEqual([{ x: 100, y: 200 }]);
    fire('pointerdown', 100, 200);
    fire('pointermove', 108, 203);
    vi.advanceTimersByTime(AIM_HOLD_MS / 2);
    fire('pointerup', 108, 203);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    expect(aim.aiming).toBe(false);
    expect(core.orbits).toBe(0);
    expect(core.clicks).toEqual([{ x: 100, y: 200 }, { x: 108, y: 203 }]);
  });

  it('둘째 손가락이 닿으면 조준을 그만두고, 첫 손가락을 지금 자리에서 다시 알려 코어가 두 손가락으로 다룬다', () => {
    fire('pointerdown', 100, 200);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    fire('pointermove', 120, 220);
    expect(aim.aiming).toBe(true);
    const n = seen.length;
    fire('pointerdown', 250, 100, 2);
    expect(aim.aiming).toBe(false);
    expect(reticle().hidden).toBe(true);
    expect(since(n)).toEqual([`pointerleave 1 120,${220 - AIM_OFFSET_PX}`, 'pointerdown 1 120,220', 'pointerdown 2 250,100']);
    expect(core.pointers.get(1)).toEqual({ x: 120, y: 220 });
    // 이제 첫 손가락 움직임도 코어에 간다(확대·이동)
    fire('pointermove', 125, 225);
    expect(seen.at(-1)).toMatchObject({ type: 'pointermove', id: 1, x: 125, y: 225 });
    expect(core.pinches).toBe(1);
    fire('pointerup', 250, 100, 2);
    fire('pointerup', 125, 225);
    expect(core.clicks).toEqual([]);
  });

  it('두 손가락을 누르고 있으면 조준하지 않는다', () => {
    fire('pointerdown', 100, 200);
    fire('pointerdown', 200, 100, 2);
    vi.advanceTimersByTime(AIM_HOLD_MS * 2);
    expect(aim.aiming).toBe(false);
  });

  it('pointercancel은 그대로 넘기고 조준만 그만둔다(찍지 않는다)', () => {
    fire('pointerdown', 100, 200);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    const n = seen.length;
    fire('pointercancel', 100, 200);
    expect(since(n)).toEqual([`pointerleave 1 100,${200 - AIM_OFFSET_PX}`, 'pointercancel 1 100,200']);
    expect(aim.aiming).toBe(false);
    expect(core.clicks).toEqual([]);
  });

  it('측정 중이 아니면 조준하지 않고, 밖에서 그만두면 뗄 때까지 코어에 넘기지 않는다(엉뚱한 고르기 없음)', () => {
    enabled = false;
    fire('pointerdown', 100, 200);
    vi.advanceTimersByTime(AIM_HOLD_MS * 2);
    expect(aim.aiming).toBe(false);
    fire('pointerup', 100, 200);
    expect(core.clicks).toEqual([{ x: 100, y: 200 }]);

    enabled = true;
    fire('pointerdown', 100, 200);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    expect(aim.aiming).toBe(true);
    enabled = false;
    aim.cancel();
    expect(aim.aiming).toBe(false);
    expect(reticle().hidden).toBe(true);
    const n = seen.length;
    fire('pointermove', 150, 250);
    fire('pointerup', 150, 250);
    expect(since(n)).toEqual([]);
    expect(core.clicks).toHaveLength(1);
    expect(core.orbits).toBe(0);
  });

  it('마우스·펜은 조준하지 않는다', () => {
    const e = new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 200 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(e);
    vi.advanceTimersByTime(AIM_HOLD_MS * 2);
    expect(aim.aiming).toBe(false);
  });
});
