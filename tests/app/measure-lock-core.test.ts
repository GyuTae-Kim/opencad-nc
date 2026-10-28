// @vitest-environment jsdom
/**
 * 측정 방향 잠금을 실제 3D 뷰어 코어(0.12.0) 판정으로: jsdom에 가짜 WebGL2(fake-webgl.ts)를 깔고 진짜 Viewer3d에 포인터·키 사건을 넣어
 * 앱의 MeasureLock(툴팁·상태 줄 안내·잠금 단추)이 코어가 정한 잠금을 그대로 따르는지 본다.
 * - 모서리 끝(첫 점)에서 그 모서리를 따라 다른 끝을 바로 가리키면(몸통을 지나지 않고) Shift가 그 모서리 방향으로 잠근다
 *   (10차에는 앱이 마지막으로 본 방향으로 메워 몸통을 지나야만 잠겼다). 첫 점을 지나지 않는 선분 끝에서는 잠그지 않는다
 * - 휴대폰 잠금 단추: 끝점에서 바로 누르면 그 모서리 방향, 잠글 방향이 없으면 알림 뒤 잠그면 알림을 거둔다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type Scene3d } from 'opencad-viewer3d';
import { ARROW_LOCK_HINT, LOCK_HINTS, MEASURE_INFERENCE, NO_LOCK_TOUCH, SHIFT_LOCK_HINTS, lockHint } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

// 공구 경로 흉내(위에서 본 판): 사각 윤곽 (0,0) → (40,0) → (40,30) → (10,30) → (0,0)(대각), 떨어진 대각 선분 (60,10) → (80,40)
const path = new Float32Array([0, 0, 0, 40, 0, 0, 40, 0, 0, 40, 30, 0, 40, 30, 0, 10, 30, 0, 10, 30, 0, 0, 0, 0, 60, 10, 0, 80, 40, 0]);
const scene: Scene3d = { name: 'lock', units: 'mm', meshes: [], lines: [{ id: 'path', positions: path }], points: [] };

function setup(touch = false) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  const bar = document.createElement('div');
  document.body.append(host, bar);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  // 앱(app.ts syncMeasureSnap)과 같은 추론 붙잡기
  v.setMeasureSnap({ midpoints: true, inference: MEASURE_INFERENCE });
  v.renderNow();
  const changed = vi.fn();
  const lock = new MeasureLock({ viewer: () => v, touch: () => touch, layer: host, changed });
  bar.append(lock.button, lock.flash);
  const at = (p: readonly number[]): { x: number; y: number } => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    return { x: s.x, y: s.y };
  };
  const ptr = (type: string, x: number, y: number, o: { shift?: boolean; pointerType?: string } = {}): void => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, shiftKey: !!o.shift });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: o.pointerType ?? 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  /** 화면 자리로 커서를 옮기고(한 번에 — 그 사이를 지나지 않는다) 코어가 그린 뒤 앱이 맞춘다 */
  const hoverXY = (x: number, y: number, o: { shift?: boolean; pointerType?: string } = {}): void => {
    ptr('pointermove', x, y, o);
    v.renderNow();
    lock.update();
  };
  const hover = (p: readonly number[], o: { shift?: boolean; pointerType?: string } = {}): void => {
    const s = at(p);
    hoverXY(s.x, s.y, o);
  };
  const click = (p: readonly number[], pointerType = 'mouse'): void => {
    hover(p, { pointerType });
    const s = at(p);
    ptr('pointerdown', s.x, s.y, { pointerType });
    ptr('pointerup', s.x, s.y, { pointerType });
    v.renderNow();
    lock.update();
  };
  /** 앱 onKey가 캔버스 밖 창 키를 넘기는 길(handleKey), 떼기는 코어가 듣는 창 keyup */
  const shiftDown = (): void => {
    v.handleKey(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    v.renderNow();
    lock.update();
  };
  const shiftUp = (): void => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    v.renderNow();
    lock.update();
  };
  const hint = (): string | null => lockHint(v.measurePointCount, !!v.measurement(), lock.lock, touch, lock.hoverLock);
  return { v, lock, changed, at, ptr, hover, hoverXY, click, shiftDown, shiftUp, hint };
}

describe('측정 방향 잠금(실제 코어 판정)', () => {
  it('모서리 끝에서 그 모서리를 따라 다른 끝을 바로 가리켜도 상태 줄이 Shift 잠금을 알리고, Shift가 그 모서리 방향으로 잠근다', () => {
    const w = setup();
    const { v, lock } = w;
    w.click([0, 0, 0]);
    expect(v.measurePoints).toEqual([{ point: [0, 0, 0], snap: 'endpoint' }]);
    expect(w.hint()).toBe(ARROW_LOCK_HINT);
    // 선분 몸통을 지나지 않고 (40,0,0) 끝점으로 바로: 점 붙잡기라 방향 추론은 없지만 코어가 잠글 방향(X축)을 준다
    w.hover([40, 0, 0]);
    expect(v.measureHoverSnap).toMatchObject({ point: [40, 0, 0], snap: 'endpoint' });
    expect(v.measureHoverSnap!.direction).toBeUndefined();
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', lock: null, hoverLock: 'x', button: true });
    expect(w.hint()).toBe(SHIFT_LOCK_HINTS.x);
    // Shift: 코어가 잠그고 앱은 따라간다
    w.shiftDown();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'axis', axis: 'x', source: 'shift' });
    expect(lock.snapshot()).toMatchObject({ tip: 'X축 방향 · 잠금', lock: 'x', hoverLock: null });
    expect(w.hint()).toBe(LOCK_HINTS.x);
    // 잠근 채 선 밖을 가리켜도 X선 위
    w.hover([22, 12, 0], { shift: true });
    expect(v.measureHoverSnap).toMatchObject({ snap: 'axis', axis: 'x', locked: true });
    expect(Math.abs(v.measureHoverSnap!.point[1])).toBeLessThan(1e-6);
    // 떼면 코어가 푼다
    w.shiftUp();
    expect(v.measureInferenceLock).toBeNull();
    expect(lock.lock).toBeNull();
  });

  it('비스듬한 모서리 끝에서도(나란한 방향), 첫 점을 지나지 않는 선분 끝에서는 마지막으로 본 방향이 있어도 Shift가 잠그지 않는다', () => {
    const w = setup();
    const { v, lock } = w;
    // (10,30) → (0,0) 대각 모서리
    w.click([10, 30, 0]);
    w.hover([0, 0, 0]);
    expect(v.measureHoverSnap!.snap).toBe('endpoint');
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', hoverLock: 'parallel' });
    expect(w.hint()).toBe(SHIFT_LOCK_HINTS.parallel);
    w.shiftDown();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'parallel', source: 'shift' });
    expect(lock.snapshot()).toMatchObject({ tip: '나란한 방향 · 잠금', lock: 'parallel' });
    w.shiftUp();
    v.clearMeasure();
    // (0,0)에서 X 몸통을 지나 X축 방향을 본 뒤 (40,30) 끝점: 그 끝점의 선분은 첫 점을 지나지 않는다
    w.click([0, 0, 0]);
    w.hover([16, 0, 0]);
    expect(lock.snapshot()).toMatchObject({ tip: 'X축 방향', hoverLock: 'x' });
    w.hover([40, 30, 0]);
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', hoverLock: null });
    expect(w.hint()).toBe(ARROW_LOCK_HINT);
    w.shiftDown();
    expect(v.measureInferenceLock).toBeNull();
    expect(lock.lock).toBeNull();
    w.shiftUp();
  });

  it('휴대폰 잠금 단추: 첫 점 자리에서는 알림, 조준을 모서리 끝으로 옮겨 누르면 그 모서리 방향으로 잠그고 알림을 거둔다', () => {
    const w = setup(true);
    const { v, lock } = w;
    w.click([0, 0, 0], 'touch');
    expect(v.measurePointCount).toBe(1);
    expect(lock.snapshot().button).toBe(true);
    expect(w.hint()).toBeNull();
    const press = (): void => {
      const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      lock.button.dispatchEvent(down);
      v.renderNow();
      lock.update();
    };
    // 정밀 조준 십자선(코어에 펜 포인터)이 첫 점 위: 잠글 방향이 없다(여러 모서리가 만나는 자리, 본 방향도 없음)
    w.hover([0, 0, 0], { pointerType: 'pen' });
    expect(v.measureHoverLock).toBeNull();
    press();
    expect(lock.snapshot()).toMatchObject({ lock: null, flash: NO_LOCK_TOUCH });
    // 몸통을 지나지 않고 (40,0) 끝점으로 옮겨 누름
    w.hover([40, 0, 0], { pointerType: 'pen' });
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', hoverLock: 'x' });
    press();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'axis', axis: 'x', source: 'api' });
    expect(lock.snapshot()).toMatchObject({ lock: 'x', flash: null, tip: 'X축 방향 · 잠금' });
    expect(lock.button.getAttribute('aria-pressed')).toBe('true');
    expect(w.hint()).toBe(LOCK_HINTS.x);
    // 다시 누르면 푼다
    press();
    expect(v.measureInferenceLock).toBeNull();
  });
});
