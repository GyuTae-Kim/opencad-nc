// @vitest-environment jsdom
/**
 * 측정 방향 잠금·붙잡기 툴팁(measure-lock.ts)의 앱 쪽 손잡이: 코어 0.12.0 잠금 계약(measureHoverLock = Shift·setMeasureInferenceLock(true)가
 * 잠글 방향, 없으면 setMeasureInferenceLock(true)만 첫 점 뒤 마지막으로 본 방향)을 따르는 가짜 뷰어로
 * 툴팁 글, 상태 줄 안내, 잠금 단추·화살표, 잠글 방향이 없다는 알림과 거두기.
 * 실제 코어 판정(모서리 끝에서 바로 Shift 등)은 measure-lock-core.test.ts가 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeasureHoverSnap } from 'opencad-viewer3d';
import { catalogs, translate } from '../../site/i18n.mjs';
import { ARROW_LOCK_HINT, LOCK_HINTS, NO_LOCK_MOUSE, NO_LOCK_TOUCH, SHIFT_LOCK_HINTS, lockHint, lockName } from '../../src/app/measure';
import { MeasureLock, snapTip, type LockViewer } from '../../src/app/measure-lock';

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
  get measureHoverSnap(): MeasureHoverSnap | null {
    return this.hover;
  }
  get measureHoverLock(): Lock | null {
    return this.measureMode && this.measurePointCount === 1 ? this.hoverLock : null;
  }
  get measureInferenceLock(): (Lock & { source: 'shift' | 'api' }) | null {
    return this.lock;
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
}

function setup(touch = false) {
  document.body.innerHTML = '';
  const layer = document.createElement('div');
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
  });

  it('툴팁: 붙잡은 종류 이름(나란한 방향·X축 방향), 잠갔으면 잠금, 붙잡지 않은 점은 없음', () => {
    expect(snapTip({ snap: 'parallel' })).toEqual({ name: '나란한 방향', locked: false });
    expect(snapTip({ snap: 'axis', axis: 'x', locked: true })).toEqual({ name: 'X축 방향', locked: true });
    expect(snapTip({ snap: null })).toBeNull();
    expect(snapTip(null)).toBeNull();
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
