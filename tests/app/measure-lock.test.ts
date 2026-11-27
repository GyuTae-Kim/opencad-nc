// @vitest-environment jsdom
/**
 * 측정 방향 잠금·붙잡기 툴팁(measure-lock.ts)의 앱 쪽 손잡이: 코어 0.12.0 잠금 계약(measureHoverLock = Shift·setMeasureInferenceLock(true)가
 * 잠글 방향, 없으면 setMeasureInferenceLock(true)만 첫 점 뒤 마지막으로 본 방향)을 따르는 가짜 뷰어로
 * 툴팁 글·자리(코어 거리 글상자 피하기), 상태 줄 안내, 잠금 단추·화살표, 잠글 방향이 없다는 알림과 거두기.
 * 실제 코어 판정(모서리 끝에서 바로 Shift 등)은 measure-lock-core.test.ts가 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_SNAP_MESSAGES, formatKeySnapMessage, keySnapText, type MeasureHoverSnap, type MeasureLabelRect } from 'opencad-viewer3d';
import { catalogs, translate } from '../../site/i18n.mjs';
import { installLocalization } from '../../src/app/i18n';
import { dictLookup, keySnapMessageFn } from '../../src/app/keysnap';
import { ARROW_LOCK_HINT, LOCK_HINTS, NO_LOCK_MOUSE, NO_LOCK_TOUCH, SHIFT_LOCK_HINTS, lockName } from '../../src/app/measure';
import { MeasureLock, axisKeyOf, coverRects, cycleOrder, lockHint, placeTip, snapTip, type LockViewer } from '../../src/app/measure-lock';
import { NO_TRACK_TOUCH } from '../../src/app/measure-track';

type Dir = [number, number, number];
interface Lock {
  kind: 'axis' | 'parallel' | 'perpendicular';
  axis?: 'x' | 'y' | 'z';
  direction: Dir;
}
const X: Lock = { kind: 'axis', axis: 'x', direction: [1, 0, 0] };
const Z: Lock = { kind: 'axis', axis: 'z', direction: [0, 0, 1] };

/** 코어 0.12.0 잠금 계약 흉내: 판정(hoverLock·lastLockable)은 시험이 정하고, Shift는 shift()로 코어처럼 잠그고 푼다 */
class FakeViewer {
  canvas = document.createElement('canvas');
  measureMode = true;
  measurePointCount = 1;
  hover: MeasureHoverSnap | null = null;
  /** 지금 미리 보기에서 잠글 방향(코어가 구한 measureHoverLock) */
  hoverLock: Lock | null = null;
  lastLockable: Lock | null = null;
  lock: (Lock & { source: 'shift' | 'api' }) | null = null;
  labelRect: MeasureLabelRect | null = null;
  /** 끌어온 점(코어 0.16.0 — 이 시험에서는 늘 빈 목록) */
  measureTrackPoints: number[][] = [];
  get measureHoverSnap(): MeasureHoverSnap | null {
    return this.hover;
  }
  get measureHoverLock(): Lock | null {
    return this.measureMode && this.measurePointCount === 1 ? this.hoverLock : null;
  }
  get measureInferenceLock(): (Lock & { source: 'shift' | 'api' }) | null {
    return this.lock;
  }
  get measureLabelRect(): MeasureLabelRect | null {
    return this.labelRect;
  }
  setMeasureInferenceLock(l: boolean | 'x' | 'y' | 'z' | null): boolean {
    if (l === false || l === null) {
      this.lock = null;
      return false;
    }
    if (!this.measureMode) return false;
    if (l === true) {
      const c = this.measurePointCount === 1 ? (this.hoverLock ?? this.lastLockable) : null;
      if (!c) return false;
      this.lock = { ...c, source: 'api' };
      return true;
    }
    this.lock = { kind: 'axis', axis: l, direction: l === 'x' ? [1, 0, 0] : l === 'y' ? [0, 1, 0] : [0, 0, 1], source: 'api' };
    return true;
  }
  /** 코어 Shift: 누르는 순간 measureHoverLock만(마지막으로 본 방향은 쓰지 않는다), 떼면 Shift 잠금만 푼다 */
  shift(down: boolean): void {
    if (down) {
      if (!this.lock && this.measureHoverLock) this.lock = { ...this.measureHoverLock, source: 'shift' };
    } else if (this.lock?.source === 'shift') this.lock = null;
  }
  project(): { x: number; y: number; onScreen: boolean } {
    return { x: 100, y: 50, onScreen: true };
  }
  /** 코어 0.13.0 setMeasureLabelAvoid로 받은 것(차례대로) */
  readonly avoids: unknown[] = [];
  setMeasureLabelAvoid(a: unknown): void {
    this.avoids.push(a);
  }
}

function setup(touch = false) {
  document.body.innerHTML = '';
  const layer = document.createElement('div');
  // 3D 보기 층 800×600(jsdom은 크기를 재지 않는다)
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
  const bar = document.createElement('div');
  document.body.append(layer, bar);
  const v = new FakeViewer();
  const changed = vi.fn();
  const lock = new MeasureLock({ viewer: () => v as unknown as LockViewer, touch: () => touch, layer, changed });
  bar.append(lock.button, lock.flash);
  return { v, lock, changed, bar, layer };
}

/** 첫 점에서 모서리를 따라 그 끝을 가리킨 끝점 붙잡기(방향 추론 없음 — 코어 0.12.0이 그 모서리 방향을 잠글 방향으로 준다) */
const END: MeasureHoverSnap = { point: [50, 0, 0], snap: 'endpoint' };

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('잠금 글', () => {
  it('잠근 방향 이름과 안내: 첫 점 뒤 결과 전만, 잠갔으면 그 방향, Shift로 잠글 방향이 있으면 그 방향, 없으면 화살표(손가락 기기는 단추라 키 안내 없음)', () => {
    expect(lockName({ kind: 'axis', axis: 'z' })).toBe('z');
    expect(lockName({ kind: 'parallel' })).toBe('parallel');
    expect(lockName({ kind: 'perpendicular' })).toBe('perpendicular');
    expect(lockName(null)).toBeNull();
    expect(lockHint(1, false, null)).toBe(ARROW_LOCK_HINT);
    expect(lockHint(1, false, null, false, 'x')).toBe(SHIFT_LOCK_HINTS.x);
    expect(lockHint(1, false, null, false, 'parallel')).toBe('Shift로 나란한 방향 잠그기');
    expect(lockHint(1, false, 'z', false, 'x')).toBe(LOCK_HINTS.z);
    expect(lockHint(1, false, null, true)).toBeNull();
    expect(lockHint(1, false, null, true, 'x')).toBeNull();
    expect(lockHint(1, false, 'x', true)).toBe(LOCK_HINTS.x);
    expect(lockHint(0, false, null, false, 'x')).toBeNull();
    expect(lockHint(2, true, 'x')).toBeNull();
    // 57차: 가상 커서가 켜진 동안은 화살표가 커서를 옮긴다 — 화살표 안내 없음, Shift로 잠글 방향·잠근 방향은 그대로
    // 203차: 그 동안 축을 잠그는 키는 X·Y·Z — Shift로 잠글 방향이 없으면 그 안내(57차는 안내 없음). 손가락 기기·첫 점 전·결과 뒤는 그대로 없음
    expect(lockHint(1, false, null, false, null, true)).toBe('X·Y·Z로 축 방향 잠금');
    expect(lockHint(1, false, null, false, 'y', true)).toBe(SHIFT_LOCK_HINTS.y);
    expect(lockHint(1, false, 'z', false, 'x', true)).toBe(LOCK_HINTS.z);
    expect(lockHint(1, false, null, true, null, true)).toBeNull();
    expect(lockHint(0, false, null, false, null, true)).toBeNull();
    expect(lockHint(2, true, null, false, null, true)).toBeNull();
  });

  it('203차: 축 잠금 키 글자 — 적힌 글자(대소문자 무시, 독일어 자판의 Y·Z도 적힌 대로)가 먼저, 라틴 글자가 아니면(한글 입력기 ㅌ·ㅛ·ㅋ) 물리 키', () => {
    expect(axisKeyOf({ key: 'x', code: 'KeyX' })).toBe('x');
    expect(axisKeyOf({ key: 'Y', code: 'KeyY' })).toBe('y');
    expect(axisKeyOf({ key: 'z', code: '' })).toBe('z');
    // 독일어 QWERTZ: Z 자리(KeyY)에 적힌 z, Y 자리(KeyZ)에 적힌 y
    expect(axisKeyOf({ key: 'z', code: 'KeyY' })).toBe('z');
    expect(axisKeyOf({ key: 'y', code: 'KeyZ' })).toBe('y');
    // 한글 2벌식(ㅌ·ㅛ·ㅋ)·입력기 처리 중
    expect(axisKeyOf({ key: 'ㅌ', code: 'KeyX' })).toBe('x');
    expect(axisKeyOf({ key: 'ㅛ', code: 'KeyY' })).toBe('y');
    expect(axisKeyOf({ key: 'ㅋ', code: 'KeyZ' })).toBe('z');
    expect(axisKeyOf({ key: 'Process', code: 'KeyZ' })).toBe('z');
    // 다른 키
    for (const [key, code] of [['a', 'KeyA'], ['ㅁ', 'KeyA'], ['w', 'KeyX'], ['ArrowRight', 'ArrowRight'], ['Shift', 'ShiftLeft'], ['1', 'Digit1'], ['', '']])
      expect(axisKeyOf({ key, code }), `${key} ${code}`).toBeNull();
  });

  it('툴팁: 붙잡은 종류 이름(나란한 방향·X축 방향), 잠갔으면 잠금, 붙잡지 않은 점은 없음', () => {
    expect(snapTip({ snap: 'parallel' })).toEqual({ name: '나란한 방향', locked: false });
    expect(snapTip({ snap: 'axis', axis: 'x', locked: true })).toEqual({ name: 'X축 방향', locked: true });
    expect(snapTip({ snap: null })).toBeNull();
    expect(snapTip(null)).toBeNull();
  });
});

describe('툴팁 자리(코어 거리 글상자 피하기)', () => {
  const L = { width: 800, height: 600 };
  it('점 오른쪽 아래가 먼저, 층 오른쪽·아래 가장자리에서는 왼쪽·위로(예전과 같음)', () => {
    expect(placeTip(100, 50, 80, 20, L, null)).toEqual({ x: 112, y: 62 });
    expect(placeTip(750, 50, 80, 20, L, null)).toEqual({ x: 658, y: 62 });
    expect(placeTip(100, 590, 80, 20, L, null)).toEqual({ x: 112, y: 558 });
    expect(placeTip(750, 590, 80, 20, L, null)).toEqual({ x: 658, y: 558 });
  });
  it('거리 글상자와 겹치면 왼쪽 아래·오른쪽 위·왼쪽 위 차례로, 겹치지 않는 곳이 없으면 층 안인 첫 자리', () => {
    // 첫 점이 커서 아래(위로 재기): 글상자가 커서 오른쪽 아래에 걸린다
    const label = { x: 110, y: 70, width: 200, height: 40 };
    expect(placeTip(100, 50, 80, 20, L, label)).toEqual({ x: 8, y: 62 });
    // 왼쪽 아래도 걸리면 오른쪽 위
    expect(placeTip(100, 50, 80, 20, L, { x: 0, y: 70, width: 400, height: 40 })).toEqual({ x: 112, y: 18 });
    // 오른쪽 가장자리: 왼쪽 아래가 걸리고 오른쪽 위는 층 밖이면 왼쪽 위
    expect(placeTip(750, 50, 80, 20, L, { x: 600, y: 60, width: 150, height: 30 })).toEqual({ x: 658, y: 18 });
    // 붙어 있기만 하면(경계가 맞닿음) 겹치지 않는다
    expect(placeTip(100, 50, 80, 20, L, { x: 192, y: 62, width: 50, height: 20 })).toEqual({ x: 112, y: 62 });
    // 네 자리가 모두 걸리면 층 안인 첫 자리(오른쪽 아래)
    expect(placeTip(100, 50, 80, 20, L, { x: 0, y: 0, width: 800, height: 600 })).toEqual({ x: 112, y: 62 });
  });
  it('update: 코어가 지난 프레임에 그린 글상자와 겹치면 툴팁을 옮기고, 글상자가 없으면 제자리', () => {
    const { v, lock } = setup();
    v.hover = { point: [1, 2, 3], snap: 'axis', axis: 'y', direction: [0, 1, 0] };
    lock.update();
    // 가짜 점 자리 (100, 50), jsdom 툴팁 크기 80×20(재지 못하면 쓰는 값)
    expect(lock.snapshot().tipRect).toEqual({ x: 112, y: 62 });
    v.labelRect = { x: 110, y: 70, width: 200, height: 40 };
    lock.update();
    expect(lock.snapshot().tipRect).toEqual({ x: 8, y: 62 });
    v.labelRect = null;
    lock.update();
    expect(lock.snapshot().tipRect).toEqual({ x: 112, y: 62 });
  });

  it('코어 0.13.0: 툴팁 첫 자리(점 오른쪽 아래, 캔버스 기준)를 코어 글상자가 비킬 자리로 넘기고, 조준 중이면 손가락·커서 둘레도, 바뀔 때만 준다', () => {
    const { v, lock } = setup(true);
    v.hover = { point: [1, 2, 3], snap: 'axis', axis: 'y', direction: [0, 1, 0] };
    lock.update();
    const tip = { x: 112, y: 62, width: 80, height: 20 };
    // 33차(코어 0.31.0): 측정 중이면 측정 점 표식 비키기(points)도 늘 함께. 35차(코어 0.33.0): 그림 저장도 표식을 비키게 snapshotPoints도
    expect(v.avoids).toEqual([{ rects: [tip], points: true, snapshotPoints: true }]);
    expect(lock.labelAvoid).toEqual({ rects: [tip], points: true, snapshotPoints: true });
    // 코어 글상자가 옮겨도 넘기는 자리는 툴팁 첫 자리 그대로(서로 쫓지 않는다) — 같으면 다시 주지 않는다
    v.labelRect = { x: 110, y: 70, width: 200, height: 40 };
    lock.update();
    lock.update();
    expect(v.avoids).toHaveLength(1);
    // 정밀 조준(손가락 (130, 180), 십자선은 그 위): 손가락 둘레 44화소 사각형과 십자선 반지름 24
    lock.setAim({ x: 130, y: 180 });
    expect(v.avoids.at(-1)).toEqual({ rects: [{ x: 108, y: 158, width: 44, height: 44 }, tip], points: true, snapshotPoints: true, pointerRadius: 24 });
    // 툴팁을 숨기면(붙잡지 않은 점) 조준 자리만
    v.hover = { point: [1, 2, 3], snap: null };
    lock.update();
    expect(v.avoids.at(-1)).toEqual({ rects: [{ x: 108, y: 158, width: 44, height: 44 }], points: true, snapshotPoints: true, pointerRadius: 24 });
    // 조준을 마치면 십자선·손가락을 거둔다 — 측정 중이라 표식 비키기만 남는다(0.30.0까지는 null)
    lock.setAim(null);
    expect(v.avoids.at(-1)).toEqual({ rects: [], points: true, snapshotPoints: true });
    expect(lock.labelAvoid).toEqual({ rects: [], points: true, snapshotPoints: true });
    // 측정을 끄거나 문서를 바꾸면 거둔다
    v.hover = { point: [1, 2, 3], snap: 'endpoint' };
    lock.update();
    expect(v.avoids.at(-1)).toEqual({ rects: [tip], points: true, snapshotPoints: true });
    lock.reset();
    expect(v.avoids.at(-1)).toBeNull();
    // 같은 측정을 이어 그리면(update) 다시 준다
    lock.update();
    expect(v.avoids.at(-1)).toEqual({ rects: [tip], points: true, snapshotPoints: true });
  });

  it('33차: 측정을 켜기만 해도(툴팁·조준·떠 있는 것이 없어도) 표식 비키기를 넘기고, 측정을 끄면 null', () => {
    const { v, lock } = setup(false);
    v.hover = null;
    lock.update();
    expect(v.avoids).toEqual([{ rects: [], points: true, snapshotPoints: true }]);
    v.measureMode = false;
    lock.update();
    expect(v.avoids.at(-1)).toBeNull();
    expect(lock.labelAvoid).toBeNull();
    // 측정을 끈 동안 조준 자리를 받아도(앱은 측정 중에만 조준한다) 그 자리만 — 표식 비키기는 측정 중의 것과 같은 꼴
    lock.setAim({ x: 130, y: 180 });
    expect(v.avoids.at(-1)).toEqual({ rects: [{ x: 108, y: 158, width: 44, height: 44 }], points: true, snapshotPoints: true, pointerRadius: 24 });
    lock.setAim(null);
    expect(v.avoids.at(-1)).toBeNull();
  });

  it('23차 coverRects: 떠 있는 요소 자리를 캔버스 기준으로 바깥쪽 정수에 맞추고, 캔버스 밖은 자르고, 크기 0·캔버스 밖은 뺀다', () => {
    const canvas = { left: 10, top: 50, width: 375, height: 600 };
    // 뷰 큐브(캔버스 오른쪽 위 8화소, 76) — 소수 자리는 바깥으로
    expect(coverRects(canvas, [{ left: 10 + 291.4, top: 58, width: 76, height: 76.2 }])).toEqual([{ x: 291, y: 8, width: 77, height: 77 }]);
    // 캔버스 아래로 삐져나간 띠는 잘리고, 숨긴 띠(크기 0)·캔버스 밖은 빠진다
    expect(
      coverRects(canvas, [
        { left: 60, top: 600, width: 274, height: 66 },
        { left: 0, top: 0, width: 0, height: 0 },
        { left: 500, top: 60, width: 40, height: 40 },
        { left: 10, top: 0, width: 50, height: 50 },
      ]),
    ).toEqual([{ x: 50, y: 550, width: 274, height: 50 }]);
  });

  it('23차: 측정 중이면 뷰 큐브(25차부터 코어 viewCubeRect — 보일 때만)와 앱이 띄운 띠(숨긴 것은 빼고)를 툴팁 첫 자리 뒤에 넘기고, 측정을 끄면 거둔다', () => {
    const { v, layer } = setup(true);
    const wrap = document.createElement('div');
    wrap.append(v.canvas);
    layer.append(wrap);
    const rect = (x: number, y: number, w: number, ht: number) => () => ({ left: x, top: y, width: w, height: ht, right: x + w, bottom: y + ht, x, y, toJSON() {} }) as DOMRect;
    // 캔버스가 화면 (10, 50)에 있어도 뷰 큐브 자리는 코어가 준 캔버스 기준 그대로(소수 자리는 바깥으로)
    v.canvas.getBoundingClientRect = rect(10, 50, 375, 600);
    // 큐브 캔버스 요소는 더 이상 찾지 않는다(코어 안쪽 클래스 — 다른 자리에 있어도 상관없다)
    const stray = document.createElement('canvas');
    stray.className = 'v3d-cube';
    stray.getBoundingClientRect = rect(0, 0, 375, 600);
    wrap.append(stray);
    const bar = document.createElement('div');
    bar.getBoundingClientRect = rect(60, 570, 274, 66);
    const strip = document.createElement('div');
    strip.hidden = true;
    strip.getBoundingClientRect = rect(18, 450, 359, 120);
    const fake = v as unknown as { viewCubeRect: MeasureLabelRect | null };
    fake.viewCubeRect = { x: 291, y: 8, width: 75.6, height: 76 };
    const lock = new MeasureLock({ viewer: () => v as unknown as LockViewer, touch: () => true, layer, changed: vi.fn(), overlays: () => [bar, strip] });
    v.hover = { point: [1, 2, 3], snap: 'endpoint' };
    lock.update();
    const tip = { x: 112, y: 62, width: 80, height: 20 };
    const CUBE = { x: 291, y: 8, width: 76, height: 76 };
    const BAR = { x: 50, y: 520, width: 274, height: 66 };
    expect(lock.labelAvoid).toEqual({ rects: [tip, CUBE, BAR], points: true, snapshotPoints: true });
    // 붙잡지 않은 점(툴팁 없음)에서도 떠 있는 것은 넘긴다
    v.hover = { point: [1, 2, 3], snap: null };
    lock.update();
    expect(lock.labelAvoid).toEqual({ rects: [CUBE, BAR], points: true, snapshotPoints: true });
    // 큐브를 숨기면(뷰 큐브 끔 — 코어가 null) 빼고, 재생 띠가 나타나면 더한다
    fake.viewCubeRect = null;
    strip.hidden = false;
    lock.update();
    expect(lock.labelAvoid).toEqual({ rects: [BAR, { x: 8, y: 400, width: 359, height: 120 }], points: true, snapshotPoints: true });
    // 측정을 끄면(update만으로도) 거둔다
    v.measureMode = false;
    lock.update();
    expect(lock.labelAvoid).toBeNull();
    expect(v.avoids.at(-1)).toBeNull();
  });
});

describe('측정 방향 잠금', () => {
  it('툴팁·잠금 단추는 지금 상태를 따르고, 찍은 점 수·잠금·Shift로 잠글 방향이 바뀌면 앱에 알린다', () => {
    const { v, lock, changed } = setup();
    v.hover = { point: [1, 2, 3], snap: 'axis', axis: 'y', direction: [0, 1, 0] };
    v.hoverLock = { kind: 'axis', axis: 'y', direction: [0, 1, 0] };
    lock.update();
    expect(lock.snapshot()).toMatchObject({ tip: 'Y축 방향', flash: null, lock: null, hoverLock: 'y', button: true });
    expect(changed).toHaveBeenCalledTimes(1);
    lock.update();
    expect(changed).toHaveBeenCalledTimes(1);
    // 모서리 끝을 가리킴: 툴팁은 끝점, Shift로 잠글 방향은 그 모서리(X축) — 상태 줄을 다시 그린다
    v.hover = END;
    v.hoverLock = X;
    lock.update();
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', hoverLock: 'x' });
    expect(changed).toHaveBeenCalledTimes(2);
    // 잠그면 Shift로 잠글 방향은 따로 알리지 않는다(잠근 방향)
    v.shift(true);
    lock.update();
    expect(lock.snapshot()).toMatchObject({ lock: 'x', hoverLock: null });
    expect(changed).toHaveBeenCalledTimes(3);
    v.shift(false);
    // 첫 점 전: 단추 숨김, Shift로 잠글 방향도 없음
    v.measurePointCount = 0;
    lock.update();
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', button: false, hoverLock: null });
    expect(changed).toHaveBeenCalledTimes(4);
    // 측정을 끄면 툴팁도 없다
    v.measureMode = false;
    lock.update();
    expect(lock.snapshot().tip).toBeNull();
  });

  it('화살표: 축 잠그기·같은 키로 풀기, ↓는 코어가 정한 방향(없으면 마지막으로 본 방향)', () => {
    const { v, lock } = setup();
    lock.arrow('x');
    expect(lock.lock).toBe('x');
    expect(lock.button.getAttribute('aria-pressed')).toBe('true');
    lock.arrow('z');
    expect(lock.lock).toBe('z');
    lock.arrow('z');
    expect(lock.lock).toBeNull();
    v.hover = { point: [0, 5, 0], snap: 'parallel', direction: [0.6, 0.8, 0] };
    v.hoverLock = { kind: 'parallel', direction: [0.6, 0.8, 0] };
    lock.arrow(null);
    expect(lock.lock).toBe('parallel');
    lock.arrow(null);
    expect(lock.lock).toBeNull();
    // 미리 보기에 잠글 방향이 없으면 마지막으로 본 방향
    v.hoverLock = null;
    v.lastLockable = Z;
    lock.arrow(null);
    expect(lock.lock).toBe('z');
    lock.arrow(null);
    // 첫 점 전에는 아무것도 하지 않는다
    v.measurePointCount = 0;
    lock.arrow('x');
    expect(lock.lock).toBeNull();
  });

  it('Shift는 코어가 잠그고 푼다: 앱의 잠금 단추로 건 잠금(api)은 Shift를 누르고 떼도 그대로', () => {
    const { v, lock } = setup();
    v.hover = END;
    v.hoverLock = X;
    expect(lock.toggle()).toBe(true);
    expect(v.lock?.source).toBe('api');
    v.shift(true);
    v.shift(false);
    lock.update();
    expect(lock.lock).toBe('x');
  });

  it('잠금 단추: 모서리 끝에서 그 모서리를 따라 가리켰으면(마지막으로 본 방향 없이도) 코어가 정한 그 모서리 방향을 잠근다', () => {
    const { v, lock } = setup(true);
    v.hover = END;
    v.hoverLock = X;
    expect(v.lastLockable).toBeNull();
    expect(lock.toggle()).toBe(true);
    expect(lock.snapshot()).toMatchObject({ lock: 'x', flash: null });
    expect(lock.button.classList.contains('on')).toBe(true);
    expect(lock.toggle()).toBe(true);
    expect(lock.lock).toBeNull();
  });

  it('잠금 단추: 잠글 방향이 없으면 띠 위 알림(손가락 기기 글), 그 뒤 잠금이 걸리면 그 알림만 거둔다', () => {
    const { v, lock } = setup(true);
    v.hover = END;
    expect(lock.toggle()).toBe(false);
    expect(lock.snapshot().flash).toBe(NO_LOCK_TOUCH);
    // 정밀 조준으로 Z축에 맞춘 뒤 다시 누름
    v.hover = { point: [0, 0, 9], snap: 'axis', axis: 'z', direction: [0, 0, 1] };
    v.hoverLock = Z;
    expect(lock.toggle()).toBe(true);
    expect(lock.snapshot()).toMatchObject({ lock: 'z', flash: null });
    // 다시 누르면 풀기
    expect(lock.toggle()).toBe(true);
    expect(lock.lock).toBeNull();
    // 다른 알림은 잠금이 걸려도 그대로
    lock.showFlash('복사했습니다');
    lock.arrow('x');
    expect(lock.snapshot().flash).toBe('복사했습니다');
  });

  it('잠글 방향이 없다는 알림 뒤 코어 Shift 잠금(모서리 끝 끝점)이 걸려도 그 알림을 거둔다', () => {
    const { v, lock } = setup(true);
    v.hover = { point: [3, 3, 3], snap: null };
    lock.toggle();
    expect(lock.snapshot().flash).toBe(NO_LOCK_TOUCH);
    v.hover = END;
    v.hoverLock = X;
    v.shift(true);
    lock.update();
    expect(lock.snapshot()).toMatchObject({ lock: 'x', flash: null });
  });

  it('측정 띠가 숨었으면(넓은 화면 키보드) 잠글 방향이 없다는 글은 알림 상자로', () => {
    const { v, lock, bar } = setup(false);
    bar.hidden = true;
    v.hover = END;
    lock.arrow(null);
    expect(lock.snapshot().flash).toBeNull();
    expect(document.querySelector('.toast')?.textContent).toContain(NO_LOCK_MOUSE);
  });

  it('손가락·펜은 누르는 순간(pointerdown) 받고 뒤따르는 click은 무시한다(정밀 조준 중 둘째 손가락)', () => {
    const { v, lock } = setup(true);
    v.hover = { point: [0, 0, 9], snap: 'axis', axis: 'z', direction: [0, 0, 1] };
    v.hoverLock = Z;
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'pointerType', { value: 'touch' });
    lock.button.dispatchEvent(down);
    expect(lock.lock).toBe('z');
    lock.button.click();
    expect(lock.lock).toBe('z');
  });
});

describe('번역', () => {
  it('새 글은 네 언어 사전에 있다(툴팁·상태 줄·측정 띠·단추)', () => {
    const texts = [
      '나란한 방향',
      // 13차: 원호 접선 잠금(툴팁·결과 이름)
      '접선 방향',
      ...Object.values(LOCK_HINTS),
      ...Object.values(SHIFT_LOCK_HINTS),
      ARROW_LOCK_HINT,
      NO_LOCK_TOUCH,
      NO_LOCK_MOUSE,
      '잠금',
      '지금 방향 잠그기(다시 누르면 풀기)',
      '방향 잠금',
      '방향 잠금 풀기',
    ];
    for (const lang of ['en', 'ja', 'zh-CN', 'de']) {
      for (const t of texts) {
        expect(catalogs[lang]?.[t], `${lang}: ${t}`).toBeTruthy();
        expect(translate(t, lang), `${lang}: ${t}`).not.toMatch(/[가-힣]/);
      }
    }
  });
});

describe('툴팁 크기가 바뀌면 다시 놓기(31차 — 번역층이 글을 바꾼 뒤)', () => {
  it('글이 길어지면(다른 언어) 그 크기로 다시 놓고 코어 글상자가 비킬 자리도 맞춘다', () => {
    const ro: { fire?: () => void } = {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          ro.fire = cb;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const { v, lock, layer } = setup();
    v.hover = END;
    lock.update();
    const tip = layer.querySelector<HTMLElement>('.snap-tip')!;
    // jsdom은 크기를 재지 않아 80 × 20으로 본다: 점 (100,50) 오른쪽 아래
    expect([tip.style.left, tip.style.top]).toEqual(['112px', '62px']);
    // 번역된 글이 760px — 점 양옆 어느 쪽에도 들어가지 않아 점 아래에서 가로만 층 안으로(800 − 4 − 760 = 36)
    Object.defineProperty(tip, 'offsetWidth', { configurable: true, value: 760 });
    ro.fire!();
    expect([tip.style.left, tip.style.top]).toEqual(['36px', '62px']);
    expect(v.avoids.at(-1)).toEqual({ rects: [{ x: 112, y: 62, width: 760, height: 20 }], points: true, snapshotPoints: true });
    // 숨은 툴팁은 다시 놓지 않는다
    v.hover = null;
    lock.update();
    Object.defineProperty(tip, 'offsetWidth', { configurable: true, value: 100 });
    ro.fire!();
    expect(tip.style.left).toBe('36px');
  });
});

describe('112차: 마우스 미리 보기 Tab 돌리기의 차례·수(코어 0.118.0 MeasureHoverSnap.cycle)', () => {
  it('글 꼴: 이름 뒤 「i+1/n」은 가상 커서 알림의 차례 글(코어 틀 열쇠 order)과 같다 — 한글이 없는 틀이라 다섯 언어 모두 코어 기본 틀, 돌리지 않으면 빈 글', () => {
    expect(cycleOrder(undefined)).toBe('');
    expect(cycleOrder({ index: 1, count: 4 })).toBe(' 2/4');
    expect(cycleOrder({ index: 0, count: 2 })).toBe(' 1/2');
    for (const lang of ['ko', 'en', 'ja', 'zh-CN', 'de']) {
      const msgs = keySnapMessageFn({ KEY_SNAP_MESSAGES, formatKeySnapMessage }, dictLookup(lang));
      const name = translate('끝점', lang);
      expect(keySnapText(msgs, 'order', [name, 2, 4]), lang).toBe(name + cycleOrder({ index: 1, count: 4 }));
    }
  });

  it('툴팁: cycle이 있으면 이름 뒤에 차례·수(잠금은 그 뒤), 없으면 전과 같은 마디. 이름은 따로 둔 마디라 번역층이 이름만 옮긴다', () => {
    const { v, lock, layer } = setup();
    v.hover = END;
    lock.update();
    const tip = layer.querySelector<HTMLElement>('.snap-tip')!;
    const plain = tip.innerHTML;
    expect(lock.snapshot().tip).toBe('끝점');
    v.hover = { ...END, cycle: { index: 1, count: 4 } };
    lock.update();
    expect(lock.snapshot().tip).toBe('끝점 2/4');
    expect(tip.querySelector('span')!.textContent).toBe('끝점');
    v.hover = { point: [50, 0, 0], snap: 'midpoint', cycle: { index: 2, count: 4 } };
    lock.update();
    expect(lock.snapshot().tip).toBe('중간점 3/4');
    v.hover = { ...END, locked: true, cycle: { index: 0, count: 2 } };
    lock.update();
    expect(lock.snapshot().tip).toBe('끝점 1/2 · 잠금');
    // Esc로 풀거나 포인터가 벗어남(칸 없음): 전과 바이트까지 같은 마디
    v.hover = END;
    lock.update();
    expect(tip.innerHTML).toBe(plain);
    expect(lock.snapshot().tip).toBe('끝점');
  });

  it('화면 읽기: 같은 3D 보기 층의 가상 커서 알림 영역(.key-live)에 cycle이 있을 때만, 차례·이름이 바뀐 때 한 번 지금 언어로 알린다', () => {
    const { v, lock, layer } = setup();
    const live = document.createElement('div');
    live.className = 'key-live';
    layer.append(live);
    v.hover = END;
    lock.update();
    expect(live.textContent).toBe('');
    v.hover = { ...END, cycle: { index: 1, count: 4 } };
    lock.update();
    expect(live.textContent).toBe('끝점 2/4');
    // 같은 값으로 다시 맞춤(키·카메라·다음 프레임 — 포인터가 4화소 안에서 움직여도 값은 같다): 다시 알리지 않는다
    live.textContent = '';
    lock.update();
    expect(live.textContent).toBe('');
    v.hover = { point: [50, 0, 0], snap: 'midpoint', cycle: { index: 2, count: 4 } };
    lock.update();
    expect(live.textContent).toBe('중간점 3/4');
    // 칸이 없어지면 알리지 않고, 다음 Tab이 같은 글이면 줄 바꿈 없는 빈칸을 붙여 다시 읽게 한다
    v.hover = END;
    lock.update();
    expect(live.textContent).toBe('중간점 3/4');
    v.hover = { point: [50, 0, 0], snap: 'midpoint', cycle: { index: 2, count: 4 } };
    lock.update();
    expect(live.textContent).toBe(`중간점 3/4${String.fromCharCode(0xa0)}`);
    // 다른 언어 화면: 이름을 지금 언어 사전으로
    document.documentElement.lang = 'en';
    try {
      v.hover = { ...END, cycle: { index: 0, count: 2 } };
      lock.update();
      expect(live.textContent).toBe('Endpoint 1/2');
    } finally {
      document.documentElement.lang = '';
    }
    // 측정을 끄면 알리지 않는다
    v.measureMode = false;
    v.hover = { ...END, cycle: { index: 1, count: 2 } };
    lock.update();
    expect(live.textContent).toBe('Endpoint 1/2');
  });
});

describe('117차: 측정 띠 위 알림은 글을 바꾸기 전부터 있는 알림 영역(화면 읽기)', () => {
  it('알림 요소는 처음부터 숨김 없이 띠 안에 비어 있고(화면에서는 1화소로 잘라 감춤), 띄우고 거둘 때 같은 요소의 글·모습만 바뀐다', () => {
    const { v, lock, bar } = setup(true);
    const el = lock.flash;
    // 비었을 때: 띠 안에 숨김 속성 없이(접근성 트리에 남게) role=status, 화면에서는 1화소로 잘라 감춘다(keysnap.ts .key-live와 같은 꼴)
    const empty = (): void => {
      expect(el.parentElement).toBe(bar);
      expect(el.hidden).toBe(false);
      expect(el.getAttribute('role')).toBe('status');
      expect(el.textContent).toBe('');
      expect([el.style.position, el.style.width, el.style.height, el.style.overflow]).toEqual(['absolute', '1px', '1px', 'hidden']);
      expect(lock.snapshot().flash).toBeNull();
    };
    // 보일 때: 같은 요소에 글, 인라인 모습 없이 클래스 모습(.measure-flash — 지금 그 알림 상자) 그대로
    const shown = (text: string): void => {
      expect(lock.flash).toBe(el);
      expect(el.parentElement).toBe(bar);
      expect(el.hidden).toBe(false);
      expect(el.textContent).toBe(text);
      expect(el.getAttribute('style')).toBeNull();
      expect(lock.snapshot().flash).toBe(text);
    };
    empty();
    // 잠글 방향이 없으면 같은 요소에 글을 넣는다(띠 위 알림)
    v.hover = END;
    expect(lock.toggle()).toBe(false);
    shown(NO_LOCK_TOUCH);
    // 잠금이 걸리면 그 알림을 거둔다 — 요소는 남기고 글만 비운다
    v.hover = { point: [0, 0, 9], snap: 'axis', axis: 'z', direction: [0, 0, 1] };
    v.hoverLock = Z;
    expect(lock.toggle()).toBe(true);
    empty();
    // 시간이 지나 거둘 때도 같다
    vi.useFakeTimers();
    try {
      lock.showFlash('복사했습니다', 1600);
      shown('복사했습니다');
      vi.advanceTimersByTime(1600);
      empty();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('134차: 보이는 띠 위 알림과 같은 글을 다시 띄우면 끝에 줄 바꿈 없는 빈칸을 붙였다 떼어 알림 영역 글이 바뀐다(화면 읽기가 다시 읽게)', () => {
  const NBSP = String.fromCharCode(0xa0);

  it('잠글 방향 없이 잠금 단추를 거듭 누르면 같은 글에 NBSP를 번갈아 붙이고, 다른 글·거둔 뒤의 글은 원문 그대로', () => {
    const { v, lock } = setup(true);
    const el = lock.flash;
    v.hover = END;
    expect(lock.toggle()).toBe(false);
    expect(el.textContent).toBe(NO_LOCK_TOUCH);
    // 알림이 보이는 동안 같은 글(3.2초 안에 다시 누름): 글이 그대로면 알림 영역이 바뀌지 않아 다시 읽지 않을 수 있다
    expect(lock.toggle()).toBe(false);
    expect(el.textContent).toBe(NO_LOCK_TOUCH + NBSP);
    expect(lock.toggle()).toBe(false);
    expect(el.textContent).toBe(NO_LOCK_TOUCH);
    // 다른 글은 원문 그대로, 그 글을 잇달아 띄우면 NBSP(끌어온 점 단추 알림도 같은 showFlash)
    lock.showFlash('복사했습니다');
    expect(el.textContent).toBe('복사했습니다');
    lock.showFlash('복사했습니다');
    expect(el.textContent).toBe(`복사했습니다${NBSP}`);
    expect(lock.toggle()).toBe(false);
    expect(el.textContent).toBe(NO_LOCK_TOUCH);
    // 잠금이 걸리면 거두고(빈 글), 그 뒤 같은 글은 원문 그대로(빈 영역에 들어온 글이라 바뀜)
    v.hover = { point: [0, 0, 9], snap: 'axis', axis: 'z', direction: [0, 0, 1] };
    v.hoverLock = Z;
    expect(lock.toggle()).toBe(true);
    expect(el.textContent).toBe('');
    expect(lock.toggle()).toBe(true);
    expect(lock.lock).toBeNull();
    v.hover = END;
    v.hoverLock = null;
    expect(lock.toggle()).toBe(false);
    expect(el.textContent).toBe(NO_LOCK_TOUCH);
    expect(lock.snapshot().flash).toBe(NO_LOCK_TOUCH);
  });

  it('다른 언어 화면: 화면 번역층이 옮긴 글에도 NBSP가 남는다(번역층은 원문 앞뒤 빈칸을 그대로 두고 옮긴다)', async () => {
    const { v, lock } = setup(true);
    history.replaceState(null, '', '/opencad-nc/en/');
    const dispose = await installLocalization(document.body);
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    try {
      const en = translate(NO_LOCK_TOUCH, 'en');
      expect(en).not.toBe(NO_LOCK_TOUCH);
      v.hover = END;
      lock.toggle();
      await tick();
      expect(lock.flash.textContent).toBe(en);
      // 화면 글(영어)은 원문과 달라도 같은 원문을 다시 띄운 것으로 본다
      lock.toggle();
      await tick();
      expect(lock.flash.textContent).toBe(en + NBSP);
      lock.toggle();
      await tick();
      expect(lock.flash.textContent).toBe(en);
    } finally {
      dispose();
      history.replaceState(null, '', '/');
      document.documentElement.lang = '';
    }
  });
});

describe('158차: 3D 보기가 받은 Esc로 붙잡기 툴팁 거두기(지울 것이 없을 때 — WCAG 1.4.13)', () => {
  it('찍은 점·끌어온 점이 없으면 3D 보기 Esc가 툴팁을 거두고(막지 않음) 같은 점인 동안 다시 띄우지 않으며, 다른 점이면 다시 뜬다. 3D 보기 밖·Ctrl+Esc·찍은 점이 있으면 그대로', () => {
    const { v, lock, layer } = setup();
    // 키 사건이 창(capture)까지 오게 3D 보기 층에 붙인다
    layer.append(v.canvas);
    lock.attach(v as unknown as LockViewer);
    v.measurePointCount = 0;
    v.hover = END;
    lock.update();
    const tip = { x: 112, y: 62, width: 80, height: 20 };
    expect(lock.snapshot().tip).toBe('끝점');
    expect(lock.labelAvoid).toEqual({ rects: [tip], points: true, snapshotPoints: true });
    const esc = (target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      return e;
    };
    // 3D 보기가 받은 Esc: 툴팁을 거두고 코어 글상자가 비킬 자리에서도 뺀다. 기본 동작은 막지 않는다(코어 Esc — 돌리기 풀기·가상 커서 끄기는 그대로)
    expect(esc(v.canvas).defaultPrevented).toBe(false);
    expect(lock.snapshot().tip).toBeNull();
    expect(lock.labelAvoid).toEqual({ rects: [], points: true, snapshotPoints: true });
    // 같은 점·같은 글이면 다시 맞춰도 거둔 그대로
    lock.update();
    expect(lock.snapshot().tip).toBeNull();
    // 다른 점이면 다시 뜬다
    v.hover = { point: [60, 0, 0], snap: 'endpoint' };
    lock.update();
    expect(lock.snapshot().tip).toBe('끝점');
    // 3D 보기 밖 Esc(앱이 측정 지우기·끄기로 받는 키)·Ctrl+Esc는 거두지 않는다
    esc(document.body);
    esc(v.canvas, { ctrlKey: true });
    expect(lock.snapshot().tip).toBe('끝점');
    // 찍은 점이 있으면 3D 보기 Esc는 코어 측정 지우기 몫 — 툴팁은 이 모듈이 거두지 않는다
    v.measurePointCount = 1;
    lock.update();
    esc(v.canvas);
    expect(lock.snapshot().tip).toBe('끝점');
  });
});

describe('191차: 커서 옆 툴팁도 띠·뷰 큐브 자리(coverRects)를 비킨다(WCAG 1.4.13·2.4.11)', () => {
  it('placeTip 손셈: 띠와 겹치면 왼쪽 아래·오른쪽 위·왼쪽 위로, 다 겹치면 숨기지 않고 겹친 넓이가 가장 작은 자리 — 거리 글상자 비키기가 먼저, 띠가 없으면 전과 같음', () => {
    // 390×844 손가락(3D 보기 390×727): 측정 띠 한 줄(52, 폭 274 어림, 아래 10)·판단 띠(한 알림 47, 폭 300 어림, 아래 76), 툴팁 80×24
    const P390 = { width: 390, height: 727 };
    const BAR = { x: 58, y: 665, width: 274, height: 52 };
    const NOTICE = { x: 45, y: 604, width: 300, height: 47 };
    // 점 바로 아래가 측정 띠: 오른쪽·왼쪽 아래가 띠 위 11px에 걸려 오른쪽 위
    expect(placeTip(195, 640, 80, 24, P390, null, [BAR])).toEqual({ x: 207, y: 604 });
    // 판단 띠 바로 위 점: 아래 둘이 판단 띠(글·버튼)에 걸려 오른쪽 위
    expect(placeTip(195, 595, 80, 24, P390, null, [BAR, NOTICE])).toEqual({ x: 207, y: 559 });
    // 두 띠 사이 틈(14px)이 툴팁보다 좁으면 네 자리가 다 걸린다 — 숨기지 않고 겹친 넓이가 가장 작은 오른쪽 아래(880 < 1,920)
    expect(placeTip(195, 640, 80, 24, P390, null, [BAR, NOTICE])).toEqual({ x: 207, y: 652 });
    // 휴대폰 폭보다 긴 툴팁(31차 — 네 자리가 다 층 밖이라 가로만 민 자리): 민 아래가 띠에 걸려 민 위
    expect(placeTip(195, 640, 370, 24, P390, null, [BAR])).toEqual({ x: 16, y: 604 });
    // 1280×800 마우스(3D 보기 1280×689): 판단 띠(위 8, 한 줄 44, 폭 560 어림 — 360~920). 측정 띠는 넓은 마우스 화면에서 숨어(크기 0) coverRects가 뺀다
    const P1280 = { width: 1280, height: 689 };
    const TOP = { x: 360, y: 8, width: 560, height: 44 };
    // 판단 띠 왼쪽 옆 점: 오른쪽 아래가 띠에 62 × 10 걸려 왼쪽 아래(위 둘은 층 밖)
    expect(placeTip(330, 30, 80, 24, P1280, null, [TOP])).toEqual({ x: 238, y: 42 });
    // 둘 다 걸리면 덜 걸린 쪽(오른쪽 아래 800, 왼쪽 아래 80)
    expect(placeTip(380, 30, 80, 24, P1280, null, [TOP])).toEqual({ x: 288, y: 42 });
    // 거리 글상자 비키기가 먼저: 왼쪽 아래가 글상자에 걸리면 띠에 걸린 오른쪽 아래 그대로(전과 같음 — 띠를 비키려고 글상자를 덮지 않는다)
    expect(placeTip(330, 30, 80, 24, P1280, { x: 200, y: 40, width: 100, height: 30 }, [TOP])).toEqual({ x: 342, y: 42 });
    // 1280×800 손가락(3D 보기 1280×683): 측정 띠(폭 274 어림 — 503~777, 아래 10) 바로 위 점은 오른쪽 위
    expect(placeTip(640, 610, 80, 24, { width: 1280, height: 683 }, null, [{ x: 503, y: 621, width: 274, height: 52 }])).toEqual({ x: 652, y: 574 });
    // 띠가 없으면 전과 같다(여섯 인자 — 띠를 모르는 부름)
    expect(placeTip(195, 640, 80, 24, P390, null, [])).toEqual(placeTip(195, 640, 80, 24, P390, null));
    expect(placeTip(195, 640, 80, 24, P390, null)).toEqual({ x: 207, y: 652 });
  });

  it('update·카메라 따라가기: 측정 중 잰 띠 자리(캔버스 기준)를 층 기준으로 옮겨 툴팁 자리 정하기에 넘기고, 코어 글상자에 넘기는 툴팁 첫 자리는 그대로', () => {
    const { v, layer } = setup();
    const rect = (x: number, y: number, w: number, ht: number) => () => ({ left: x, top: y, width: w, height: ht, right: x + w, bottom: y + ht, x, y, toJSON() {} }) as DOMRect;
    v.canvas.getBoundingClientRect = rect(0, 0, 800, 600);
    const bar = document.createElement('div');
    bar.getBoundingClientRect = rect(0, 60, 300, 40);
    let camera = (): void => {};
    (v as unknown as { onCameraChange(cb: () => void): void }).onCameraChange = (cb) => (camera = cb);
    const lock = new MeasureLock({ viewer: () => v as unknown as LockViewer, touch: () => false, layer, changed: vi.fn(), overlays: () => [bar] });
    lock.attach(v as unknown as LockViewer);
    v.hover = END;
    lock.update();
    // 점 (100, 50)·툴팁 80×20(jsdom): 오른쪽 아래 (112, 62)·왼쪽 아래 (8, 62)가 띠(0~300 × 60~100)에 걸려 오른쪽 위
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', tipRect: { x: 112, y: 18 } });
    // 코어 글상자가 비킬 자리는 툴팁 첫 자리(오른쪽 아래) 그대로 — 둘이 서로 쫓지 않는다
    expect(lock.labelAvoid).toEqual({ rects: [{ x: 112, y: 62, width: 80, height: 20 }, { x: 0, y: 60, width: 300, height: 40 }], points: true, snapshotPoints: true });
    // 카메라만 바뀌어 점이 띠 밖 (400, 50)으로 가면 오른쪽 아래, 다시 띠 위 (100, 50)이면 오른쪽 위(follow도 잰 띠 자리를 본다)
    v.project = () => ({ x: 400, y: 50, onScreen: true });
    camera();
    expect(lock.snapshot().tipRect).toEqual({ x: 412, y: 62 });
    v.project = () => ({ x: 100, y: 50, onScreen: true });
    camera();
    expect(lock.snapshot().tipRect).toEqual({ x: 112, y: 18 });
    // 띠가 숨으면 다음 맞추기에서 제자리
    bar.hidden = true;
    lock.update();
    expect(lock.snapshot().tipRect).toEqual({ x: 112, y: 62 });
    // 캔버스가 층 (10, 50)에 있으면: 띠 화면 자리 (0, 105, 300 × 40) → 캔버스 기준 (0, 55, 290 × 40) → 층 기준 (10, 105)로 견준다 —
    // 점은 층 (110, 100), 아래 둘(y 112~132)이 걸려 오른쪽 위 (122, 68)(층 기준으로 옮기지 않으면 오른쪽 아래 (122, 112))
    v.canvas.getBoundingClientRect = rect(10, 50, 375, 600);
    bar.getBoundingClientRect = rect(0, 105, 300, 40);
    bar.hidden = false;
    lock.update();
    expect(lock.labelAvoid?.rects).toEqual([{ x: 112, y: 62, width: 80, height: 20 }, { x: 0, y: 55, width: 290, height: 40 }]);
    expect(lock.snapshot().tipRect).toEqual({ x: 122, y: 68 });
    // 뷰 큐브(코어 viewCubeRect — 캔버스 기준 150~250 × 40~140, 층 기준 160~260 × 90~190)도 비킨다: 오른쪽 아래가 42 × 20 걸려 왼쪽 아래
    bar.hidden = true;
    (v as unknown as { viewCubeRect: MeasureLabelRect | null }).viewCubeRect = { x: 150, y: 40, width: 100, height: 100 };
    lock.update();
    expect(lock.snapshot().tipRect).toEqual({ x: 18, y: 112 });
  });
});

describe('192차: 측정 띠 위 알림이 떠 있는 동안 그 자리(띠 상자 밖)도 커서 옆 툴팁·코어 거리 글상자가 비킨다(WCAG 1.4.13·2.4.11)', () => {
  it('알림이 뜨면(뒤에 맞추기가 없는 끌어온 점 버튼 길도) 두 프레임 안에 툴팁이 알림을 비키고 코어에 알림 자리를 넘기며, 알림이 지면(시간·잠금) 제자리 — 빈 알림(1화소)은 넣지 않는다', () => {
    const { v, layer, bar } = setup(true);
    const rect = (x: number, y: number, w: number, ht: number) => () => ({ left: x, top: y, width: w, height: ht, right: x + w, bottom: y + ht, x, y, toJSON() {} }) as DOMRect;
    // 390×844 손가락(3D 보기 390×727): 측정 띠 한 줄 58~332 × 665~717, 그 위 5px 가운데 두 줄 알림(358 × 42.8 — 12px × 줄 높이 1.45 두 줄 + 여백 8), 툴팁 80×20(jsdom)
    layer.getBoundingClientRect = rect(0, 0, 390, 727);
    v.canvas.getBoundingClientRect = rect(0, 0, 390, 727);
    bar.getBoundingClientRect = rect(58, 665, 274, 52);
    const lock = new MeasureLock({ viewer: () => v as unknown as LockViewer, touch: () => true, layer, changed: vi.fn(), overlays: () => [bar] });
    bar.append(lock.button, lock.flash);
    lock.flash.getBoundingClientRect = rect(16, 617.2, 358, 42.8);
    const BAR = { x: 58, y: 665, width: 274, height: 52 };
    const FLASH = { x: 16, y: 617, width: 358, height: 43 };
    const FIRST = { x: 207, y: 612, width: 80, height: 20 };
    v.project = () => ({ x: 195, y: 600, onScreen: true });
    v.hover = END;
    vi.useFakeTimers();
    try {
      lock.update();
      // 빈 알림(117차 — 1화소로 잘라 감춤)은 비킬 자리에 넣지 않는다: 오른쪽 아래 제자리, 코어에는 툴팁 첫 자리와 띠만
      expect(lock.snapshot()).toMatchObject({ tip: '끝점', flash: null, tipRect: { x: 207, y: 612 } });
      expect(lock.labelAvoid?.rects).toEqual([FIRST, BAR]);
      // 끌어온 점 버튼(스냅한 점 없음 — 뒤에 맞추기가 없는 길): 두 프레임 안에 툴팁이 알림(오른쪽·왼쪽 아래가 15 × 80 걸림)을 비켜 오른쪽 위, 코어 글상자도 알림을 비킨다
      lock.showFlash(NO_TRACK_TOUCH, 3200, 'track');
      vi.advanceTimersByTime(50);
      expect(lock.snapshot()).toMatchObject({ flash: NO_TRACK_TOUCH, tipRect: { x: 207, y: 568 } });
      expect(lock.labelAvoid?.rects).toEqual([FIRST, BAR, FLASH]);
      // 3.2초 뒤 알림이 지면 두 프레임 안에 제자리, 코어에 넘기는 자리에서도 뺀다
      vi.advanceTimersByTime(3200);
      expect(lock.snapshot()).toMatchObject({ flash: null, tipRect: { x: 207, y: 612 } });
      expect(lock.labelAvoid?.rects).toEqual([FIRST, BAR]);
      // 잠금 버튼(잠글 방향 없음 — 같은 처리의 update): 바로 비킨다
      expect(lock.toggle()).toBe(false);
      expect(lock.snapshot()).toMatchObject({ flash: NO_LOCK_TOUCH, tipRect: { x: 207, y: 568 } });
      expect(lock.labelAvoid?.rects).toEqual([FIRST, BAR, FLASH]);
      // 코어 Shift 잠금이 걸려 알림을 거두면(update 안 — 앱 창 키는 그 뒤 다시 맞추지 않는다) 두 프레임 안에 제자리
      v.hoverLock = X;
      v.shift(true);
      lock.update();
      vi.advanceTimersByTime(50);
      expect(lock.snapshot()).toMatchObject({ lock: 'x', flash: null, tipRect: { x: 207, y: 612 } });
      expect(lock.labelAvoid?.rects).toEqual([FIRST, BAR]);
      // 1280×800 손가락(3D 보기 1280×683): 측정 띠 503~777 × 621~673, 한 줄 알림(430 × 25.4) — 점 (640, 580)의 아래 둘이 20 × 80 걸려 오른쪽 위
      v.shift(false);
      v.hoverLock = null;
      layer.getBoundingClientRect = rect(0, 0, 1280, 683);
      v.canvas.getBoundingClientRect = rect(0, 0, 1280, 683);
      bar.getBoundingClientRect = rect(503, 621, 274, 52);
      lock.flash.getBoundingClientRect = rect(425, 590.6, 430, 25.4);
      v.project = () => ({ x: 640, y: 580, onScreen: true });
      lock.update();
      expect(lock.snapshot().tipRect).toEqual({ x: 652, y: 592 });
      expect(lock.toggle()).toBe(false);
      expect(lock.snapshot().tipRect).toEqual({ x: 652, y: 548 });
      expect(lock.labelAvoid?.rects).toEqual([{ x: 652, y: 592, width: 80, height: 20 }, { x: 503, y: 621, width: 274, height: 52 }, { x: 425, y: 590, width: 430, height: 26 }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
