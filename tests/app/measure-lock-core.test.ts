// @vitest-environment jsdom
/**
 * 측정 방향 잠금을 실제 3D 뷰어 코어(0.12.0 판정, 0.13.0 글상자 비키기) 판정으로: jsdom에 가짜 WebGL2(fake-webgl.ts)를 깔고 진짜 Viewer3d에 포인터·키 사건을 넣어
 * 앱의 MeasureLock(툴팁·상태 줄 안내·잠금 단추)이 코어가 정한 잠금을 그대로 따르는지 본다.
 * - 모서리 끝(첫 점)에서 그 모서리를 따라 다른 끝을 바로 가리키면(몸통을 지나지 않고) Shift가 그 모서리 방향으로 잠근다
 *   (10차에는 앱이 마지막으로 본 방향으로 메워 몸통을 지나야만 잠겼다). 첫 점을 지나지 않는 선분 끝에서는 잠그지 않는다
 * - 휴대폰 잠금 단추: 끝점에서 바로 누르면 그 모서리 방향, 잠글 방향이 없으면 알림 뒤 잠그면 알림을 거둔다
 * - 커서 옆 툴팁이 코어 거리 글상자(measureLabelRect)와 겹치면 옮긴다
 * - 0.13.0: 툴팁 첫 자리·정밀 조준 십자선과 손가락을 코어에 넘기면(setMeasureLabelAvoid) 코어 글상자가 비켜 그린다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureLabelRect, type Scene3d } from 'opencad-viewer3d';
import { placeMeasureLabel } from 'opencad-viewer3d/measurelabel';
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

/**
 * 코어 뷰 큐브 자리(오른쪽 위 8화소, 기본 112). 25차부터 앱은 코어 0.23.0 viewCubeRect를 읽는다 — jsdom 가짜는 모든 요소를 캔버스 크기로 재므로
 * 큐브 캔버스 요소(canvas.v3d-cube)는 800 × 600으로 잰다. 앱이 그 요소를 재면 아래 피할 자리가 캔버스 전체가 된다
 */
const CUBE: MeasureLabelRect = { x: 800 - 8 - 112, y: 8, width: 112, height: 112 };
const box = (r: MeasureLabelRect) => () => ({ left: r.x, top: r.y, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height, x: r.x, y: r.y, toJSON() {} }) as DOMRect;

function setup(touch = false, overlays: readonly Element[] = []) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  const bar = document.createElement('div');
  document.body.append(host, bar);
  const v = new Viewer3d(host, { animate: false });
  expect(v.viewCubeRect).toEqual(CUBE);
  v.setScene(scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  // 앱(app.ts syncMeasureSnap)과 같은 추론 붙잡기
  v.setMeasureSnap({ midpoints: true, inference: MEASURE_INFERENCE });
  v.renderNow();
  const changed = vi.fn();
  const lock = new MeasureLock({ viewer: () => v, touch: () => touch, layer: host, changed, overlays: () => overlays });
  bar.append(lock.button, lock.flash);
  const at =(p: readonly number[]): { x: number; y: number } => {
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

const overlaps = (a: MeasureLabelRect, b: MeasureLabelRect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('측정 방향 잠금(실제 코어 판정)', () => {
  it('모서리 끝에서 그 모서리를 따라 다른 끝을 바로 가리켜도 상태 줄이 Shift 잠금을 알리고, Shift가 그 모서리 방향으로 잠근다', () => {
    const w = setup();
    const { v, lock } = w;
    w.click([0, 0, 0]);
    // 코어 0.16.0: 찍은 끝점에 고르기가 고른 선분의 식별자가 실린다
    expect(v.measurePoints).toEqual([{ point: [0, 0, 0], snap: 'endpoint', segment: { kind: 'line', id: 'path', index: 0, raw: 0, ends: [[0, 0, 0], [40, 0, 0]] } }]);
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

  it('커서 옆 툴팁이 코어 거리 글상자와 겹치면(첫 점에서 위로 잴 때) 겹치지 않는 자리로 옮긴다', () => {
    const w = setup();
    const { v, lock } = w;
    w.click([60, 10, 0]);
    // 첫 점에서 화면 위로 90화소: Y축 방향 붙잡기, 코어 글상자는 두 점 가운데 오른쪽 위라 커서 오른쪽 아래 툴팁 자리에 걸린다
    const a = w.at([60, 10, 0]);
    w.hoverXY(a.x, a.y - 90);
    expect(v.measureHoverSnap).toMatchObject({ snap: 'axis', axis: 'y' });
    const label = v.measureLabelRect!;
    expect(label).not.toBeNull();
    const p = w.at(v.measureHoverSnap!.point);
    // jsdom은 툴팁 크기를 재지 않아 80×20으로 둔다
    const def = { x: p.x + 12, y: p.y + 12, width: 80, height: 20 };
    expect(overlaps(def, label)).toBe(true);
    const tip = lock.snapshot().tipRect!;
    expect(lock.snapshot().tip).toBe('Y축 방향');
    expect(overlaps({ ...tip, width: 80, height: 20 }, label)).toBe(false);
    // 커서 둘레 네 자리 가운데 하나(글상자가 캔버스 오른쪽 끝으로 당겨지면 왼쪽 아래도 걸려 오른쪽 위로), 3D 보기 안
    expect([Math.round(p.x + 12), Math.round(p.x - 12 - 80)]).toContain(tip.x);
    expect([Math.round(p.y + 12), Math.round(p.y - 12 - 20)]).toContain(tip.y);
    expect(tip.x >= 4 && tip.y >= 4 && tip.x + 80 <= 796 && tip.y + 20 <= 596).toBe(true);
    // 멀리(글상자가 커서에서 떨어짐) 가면 다시 오른쪽 아래
    w.hoverXY(a.x, a.y - 300);
    const far = lock.snapshot().tipRect!;
    const q = w.at(v.measureHoverSnap!.point);
    expect(overlaps({ ...far, width: 80, height: 20 }, v.measureLabelRect!)).toBe(false);
    expect(far).toEqual({ x: Math.round(q.x + 12), y: Math.round(q.y + 12) });
  });

  it('코어 0.13.0: 툴팁 첫 자리를 넘기면 다음 그리기에서 코어 글상자가 비키고 툴팁은 오른쪽 아래 제자리, 둘이 서로 쫓지 않는다', () => {
    const w = setup();
    const { v, lock } = w;
    w.click([60, 10, 0]);
    const a = w.at([60, 10, 0]);
    w.hoverXY(a.x, a.y - 90);
    const p = w.at(v.measureHoverSnap!.point);
    const first = { x: Math.round(p.x + 12), y: Math.round(p.y + 12), width: 80, height: 20 };
    // 23차: 측정 중이면 뷰 큐브 자리도(툴팁 다음)
    expect(v.measureLabelAvoid).toEqual({ rects: [first, CUBE] });
    // 이 그리기는 넘기기 전 자리(툴팁 첫 자리에 걸림) — 툴팁이 비켰다
    expect(overlaps(first, v.measureLabelRect!)).toBe(true);
    v.renderNow();
    lock.update();
    const label = v.measureLabelRect!;
    expect(overlaps(first, label)).toBe(false);
    expect(lock.snapshot().tipRect).toEqual({ x: first.x, y: first.y });
    // 또 그려도 그대로
    v.renderNow();
    lock.update();
    expect(v.measureLabelRect).toEqual(label);
    expect(lock.snapshot().tipRect).toEqual({ x: first.x, y: first.y });
    // 측정을 끄면 거둔다
    v.setMeasureMode(false);
    lock.reset();
    expect(v.measureLabelAvoid).toBeNull();
  });

  it('코어 0.13.0: 정밀 조준 중에는 십자선(커서 둘레 24)과 손가락을 비켜 그린다 — 첫 점 가까이를 가리켜도', () => {
    const w = setup(true);
    const { v, lock } = w;
    w.click([0, 0, 0], 'touch');
    const a = w.at([0, 0, 0]);
    // 십자선을 첫 점 오른쪽 위 가까이(빈 곳)에: 기본 자리(두 점 가운데 오른쪽 위)가 십자선에 걸린다
    const c = { x: a.x + 40, y: a.y - 30 };
    const before = (() => {
      w.hoverXY(c.x, c.y, { pointerType: 'pen' });
      return v.measureLabelRect!;
    })();
    const near = (r: MeasureLabelRect, x: number, y: number, rad: number): boolean => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.width), Math.max(r.y - y, 0, y - r.y - r.height)) < rad;
    expect(near(before, c.x, c.y, 24)).toBe(true);
    // 앱 aim.ts가 십자선을 옮기는 처리 안에서(펜 움직임 전) 손가락 자리를 알린다
    lock.setAim({ x: c.x, y: c.y + 64 });
    w.hoverXY(c.x, c.y, { pointerType: 'pen' });
    v.renderNow();
    const avoid = v.measureLabelAvoid!;
    expect(avoid.pointerRadius).toBe(24);
    expect(avoid.rects![0]).toEqual({ x: Math.round(c.x - 22), y: Math.round(c.y + 64 - 22), width: 44, height: 44 });
    const label = v.measureLabelRect!;
    expect(near(label, c.x, c.y, 24)).toBe(false);
    for (const r of avoid.rects!) expect(overlaps(label, r)).toBe(false);
    lock.setAim(null);
    expect(v.measureLabelAvoid?.pointerRadius).toBeUndefined();
  });
});

describe('23차: 거리 글상자가 뷰 큐브·측정 띠를 비킨다(코어 0.13.0 setMeasureLabelAvoid)', () => {
  /** 카메라 대상만 옮겨 세계 점 m이 캔버스 (dx, dy)에 오게(위에서 본 보기 — 화면 이동의 야코비안으로 두 번) */
  const place = (v: Viewer3d, m: readonly number[], dx: number, dy: number): void => {
    for (let k = 0; k < 3; k++) {
      const s = v.project(m)!;
      const sx = v.project([m[0]! + 1, m[1]!, m[2]!])!;
      const sy = v.project([m[0]!, m[1]! + 1, m[2]!])!;
      const a = sx.x - s.x, b = sy.x - s.x, c = sx.y - s.y, d = sy.y - s.y;
      const det = a * d - b * c;
      const ex = dx - s.x, ey = dy - s.y;
      const cam = v.getCamera();
      v.setCamera({ ...cam, target: [cam.target[0] - (d * ex - b * ey) / det, cam.target[1] - (-c * ex + a * ey) / det, cam.target[2]] });
    }
  };
  /** 대각 선분 (60,10) → (80,40)을 잰 결과(가운데 (70,25))를 화면 (dx, dy)에 두고 앱이 맞춘 뒤 그린 글상자 */
  const measureAt = (w: ReturnType<typeof setup>, dx: number, dy: number): MeasureLabelRect => {
    const { v, lock } = w;
    place(v, [70, 25, 0], dx, dy);
    v.renderNow();
    lock.update();
    v.renderNow();
    return v.measureLabelRect!;
  };
  /** 비킬 것이 없을 때의 자리(0.12.0 기본 자리 — 두 점 화면 가운데 오른쪽 10·위 8, 캔버스 안으로 당김), 크기는 그린 글상자 r */
  const plain = (v: Viewer3d, r: MeasureLabelRect): MeasureLabelRect => {
    const a = v.project([60, 10, 0])!;
    const b = v.project([80, 40, 0])!;
    return placeMeasureLabel([(a.x + b.x) / 2, (a.y + b.y) / 2], r, { width: 800, height: 600 }, null);
  };

  it('두 점 가운데가 뷰 큐브 왼쪽 아래면 기본 자리가 큐브에 걸리고, 앱이 큐브 자리를 넘겨 코어가 비켜 그린다 — 큐브를 숨기면 기본 자리', () => {
    const w = setup(true);
    const { v, lock } = w;
    w.click([60, 10, 0], 'touch');
    w.click([80, 40, 0], 'touch');
    expect(v.measurement()?.distance).toBeCloseTo(Math.hypot(20, 30), 4);
    const label = measureAt(w, CUBE.x - 30, CUBE.y + CUBE.height + 10);
    const def = plain(v, label);
    expect(overlaps(def, CUBE)).toBe(true);
    expect(v.measureLabelAvoid).toEqual({ rects: [CUBE] });
    expect(overlaps(label, CUBE)).toBe(false);
    expect([label.width, label.height]).toEqual([def.width, def.height]);
    // 큐브를 숨기면(보기 메뉴) 넘기지 않아 기본 자리(0.12.0과 같다)
    v.setViewCubeVisible(false);
    lock.update();
    v.renderNow();
    expect(v.measureLabelAvoid).toBeNull();
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(v.measureLabelRect![k]).toBeCloseTo(def[k], 6);
    v.setViewCubeVisible(true);
    // 측정을 끄면 거둔다
    v.setMeasureMode(false);
    lock.reset();
    lock.update();
    expect(v.measureLabelAvoid).toBeNull();
  });

  it('측정 띠(앱이 3D 보기 아래에 띄운 것) 바로 위면 띠를 비키고, 띠를 숨기면 넘기지 않는다', () => {
    const bar = document.createElement('div');
    const BAR: MeasureLabelRect = { x: 263, y: 530, width: 274, height: 60 };
    bar.getBoundingClientRect = box(BAR);
    const w = setup(true, [bar]);
    const { v, lock } = w;
    w.click([60, 10, 0], 'touch');
    w.click([80, 40, 0], 'touch');
    const label = measureAt(w, 400, BAR.y + 15);
    expect(overlaps(plain(v, label), BAR)).toBe(true);
    expect(v.measureLabelAvoid).toEqual({ rects: [CUBE, BAR] });
    expect(overlaps(label, BAR)).toBe(false);
    expect(overlaps(label, CUBE)).toBe(false);
    bar.hidden = true;
    lock.update();
    expect(v.measureLabelAvoid).toEqual({ rects: [CUBE] });
  });

  it('큐브·띠와 겹치지 않는 측정은 글상자 자리가 기본 자리 그대로다(넘겨도 옮기지 않는다)', () => {
    const bar = document.createElement('div');
    bar.getBoundingClientRect = box({ x: 263, y: 530, width: 274, height: 60 });
    const w = setup(true, [bar]);
    const { v } = w;
    w.click([60, 10, 0], 'touch');
    w.click([80, 40, 0], 'touch');
    for (const [x, y] of [[300, 300], [100, 80], [600, 420]] as const) {
      const label = measureAt(w, x, y);
      expect(v.measureLabelAvoid?.rects).toHaveLength(2);
      // 코어는 두 점을 제 투영으로 옮기므로 마지막 자리 반올림만 다를 수 있다
      const def = plain(v, label);
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(label[k]).toBeCloseTo(def[k], 6);
    }
  });
});
