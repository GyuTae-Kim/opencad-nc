// @vitest-environment jsdom
/**
 * 측정 방향 잠금·붙잡기 툴팁(measure-lock.ts): 코어 0.10.0 추론 잠금을 흉내 낸 가짜 뷰어로
 * 툴팁 글, 잠금 단추·화살표, Shift로 선분 위 점 붙잡기 잠그기(첫 점에서 선분을 따라 그 끝을 가리킬 때), 잠글 방향이 없다는 알림과 거두기.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeasureHoverSnap } from 'opencad-viewer3d';
import { catalogs, translate } from '../../site/i18n.mjs';
import { LOCK_HINTS, LOCK_KEYS_HINT, NO_LOCK_MOUSE, NO_LOCK_TOUCH, lockHint, lockName } from '../../src/app/measure';
import { MeasureLock, snapTip, type LockViewer } from '../../src/app/measure-lock';

type Dir = [number, number, number];
interface Lock {
  kind: 'axis' | 'parallel' | 'perpendicular';
  axis?: 'x' | 'y' | 'z';
  direction: Dir;
  source: 'shift' | 'api';
}

/** 코어 측정 잠금 흉내: true는 지금 미리 보기의 방향 추론, 없으면 첫 점 뒤 마지막으로 본 방향(lastLockable) */
class FakeViewer {
  canvas = document.createElement('canvas');
  measureMode = true;
  measurePointCount = 1;
  /** 잠그지 않았을 때 미리 보기 */
  base: MeasureHoverSnap | null = null;
  hover: MeasureHoverSnap | null = null;
  lock: Lock | null = null;
  lastLockable: Omit<Lock, 'source'> | null = null;
  /** 잠갔을 때 미리 보기(잠근 선으로 옮긴 점) */
  lockedHover: (l: Lock) => MeasureHoverSnap | null = () => null;
  renders = 0;
  get measureHoverSnap(): MeasureHoverSnap | null {
    return this.hover;
  }
  get measureInferenceLock(): Lock | null {
    return this.lock;
  }
  setMeasureInferenceLock(l: boolean | 'x' | 'y' | 'z' | null): boolean {
    if (l === false || l === null) {
      this.lock = null;
      this.hover = this.base;
      return false;
    }
    if (!this.measureMode) return false;
    if (l === true) {
      if (this.measurePointCount !== 1) return false;
      const h = this.hover;
      const cur = h?.direction && (h.snap === 'axis' || h.snap === 'parallel' || h.snap === 'perpendicular') ? { kind: h.snap, ...(h.axis ? { axis: h.axis } : {}), direction: h.direction as Dir } : null;
      const c = cur ?? this.lastLockable;
      if (!c) return false;
      this.lock = { ...c, source: 'api' };
      return true;
    }
    this.lock = { kind: 'axis', axis: l, direction: l === 'x' ? [1, 0, 0] : l === 'y' ? [0, 1, 0] : [0, 0, 1], source: 'api' };
    return true;
  }
  renderNow(): void {
    this.renders++;
    this.hover = this.lock ? this.lockedHover(this.lock) : this.base;
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

const END: MeasureHoverSnap = { point: [50, 0, 0], snap: 'endpoint' };

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('잠금 글', () => {
  it('잠근 방향 이름과 안내(첫 점 뒤 결과 전만, 손가락 기기는 단추라 키 안내 없음)', () => {
    expect(lockName({ kind: 'axis', axis: 'z' })).toBe('z');
    expect(lockName({ kind: 'parallel' })).toBe('parallel');
    expect(lockName({ kind: 'perpendicular' })).toBe('perpendicular');
    expect(lockName(null)).toBeNull();
    expect(lockHint(1, false, null)).toBe(LOCK_KEYS_HINT);
    expect(lockHint(1, false, null, true)).toBeNull();
    expect(lockHint(1, false, 'x', true)).toBe(LOCK_HINTS.x);
    expect(lockHint(0, false, null)).toBeNull();
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
  it('툴팁·잠금 단추는 지금 상태를 따르고, 찍은 점 수·잠금이 바뀌면 앱에 알린다', () => {
    const { v, lock, changed } = setup();
    v.hover = { point: [1, 2, 3], snap: 'axis', axis: 'y', direction: [0, 1, 0] };
    lock.update();
    expect(lock.snapshot()).toEqual({ tip: 'Y축 방향', flash: null, lock: null, button: true });
    expect(changed).toHaveBeenCalledTimes(1);
    lock.update();
    expect(changed).toHaveBeenCalledTimes(1);
    // 첫 점 전: 단추 숨김
    v.measurePointCount = 0;
    v.hover = END;
    lock.update();
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', button: false });
    expect(changed).toHaveBeenCalledTimes(2);
    // 측정을 끄면 툴팁도 없다
    v.measureMode = false;
    lock.update();
    expect(lock.snapshot().tip).toBeNull();
  });

  it('화살표: 축 잠그기·같은 키로 풀기, ↓는 지금 방향(없으면 마지막으로 본 방향)', () => {
    const { v, lock } = setup();
    lock.arrow('x');
    expect(lock.lock).toBe('x');
    expect(lock.button.getAttribute('aria-pressed')).toBe('true');
    lock.arrow('z');
    expect(lock.lock).toBe('z');
    lock.arrow('z');
    expect(lock.lock).toBeNull();
    v.hover = { point: [0, 5, 0], snap: 'parallel', direction: [0.6, 0.8, 0] };
    lock.arrow(null);
    expect(lock.lock).toBe('parallel');
    lock.arrow(null);
    expect(lock.lock).toBeNull();
    // 첫 점 전에는 아무것도 하지 않는다
    v.measurePointCount = 0;
    lock.arrow('x');
    expect(lock.lock).toBeNull();
  });

  it('Shift: 첫 점에서 선분을 따라 그 끝(끝점 붙잡기)을 가리키면 마지막으로 본 방향이 그 점을 지날 때 잠그고, 떼면 푼다', () => {
    const { v, lock } = setup();
    // 선분 몸통을 지나며 X축 방향을 봤고, 지금은 그 끝점 위(방향 추론 없음 — 코어는 Shift로 잠그지 않는다)
    v.lastLockable = { kind: 'axis', axis: 'x', direction: [1, 0, 0] };
    v.base = v.hover = END;
    v.lockedHover = (l) => ({ point: [50, 0, 0], snap: 'axis', axis: l.axis, direction: l.direction, locked: true });
    lock.shiftDown();
    expect(lock.lock).toBe('x');
    expect(lock.snapshot().tip).toBe('X축 방향 · 잠금');
    expect(v.renders).toBe(1);
    lock.shiftUp();
    expect(lock.lock).toBeNull();
  });

  it('Shift: 마지막으로 본 방향이 그 점을 지나지 않으면(코어가 점을 선으로 옮김 — from) 잠그지 않는다', () => {
    const { v, lock } = setup();
    v.lastLockable = { kind: 'axis', axis: 'z', direction: [0, 0, 1] };
    v.base = v.hover = END;
    v.lockedHover = (l) => ({ point: [0, 0, 0], snap: 'axis', axis: l.axis, direction: l.direction, locked: true, from: [50, 0, 0], fromSnap: 'endpoint' });
    lock.shiftDown();
    expect(lock.lock).toBeNull();
    expect(v.renders).toBe(2);
    expect(v.hover).toBe(END);
  });

  it('Shift: 코어가 이미 잠갔거나(방향 추론 위) 붙잡지 않은 점이면 앱은 건드리지 않고, 코어 Shift 잠금은 코어가 푼다', () => {
    const { v, lock } = setup();
    v.lock = { kind: 'axis', axis: 'y', direction: [0, 1, 0], source: 'shift' };
    lock.shiftDown();
    lock.shiftUp();
    expect(lock.lock).toBe('y');
    v.lock = null;
    v.hover = { point: [3, 3, 3], snap: null };
    v.lastLockable = { kind: 'axis', axis: 'x', direction: [1, 0, 0] };
    lock.shiftDown();
    expect(lock.lock).toBeNull();
    expect(v.renders).toBe(0);
  });

  it('잠금 단추: 잠글 방향이 없으면 띠 위 알림(손가락 기기 글), 그 뒤 잠금이 걸리면 그 알림만 거둔다', () => {
    const { v, lock } = setup(true);
    v.hover = END;
    expect(lock.toggle()).toBe(false);
    expect(lock.snapshot().flash).toBe(NO_LOCK_TOUCH);
    // 정밀 조준으로 Z축에 맞춘 뒤 다시 누름
    v.hover = { point: [0, 0, 9], snap: 'axis', axis: 'z', direction: [0, 0, 1] };
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

  it('Shift·화살표로 잠가도 잠글 방향이 없다는 알림을 거둔다', () => {
    const { v, lock } = setup(true);
    v.hover = END;
    lock.toggle();
    expect(lock.snapshot().flash).toBe(NO_LOCK_TOUCH);
    v.lock = { kind: 'axis', axis: 'x', direction: [1, 0, 0], source: 'shift' };
    lock.update();
    expect(lock.snapshot().flash).toBeNull();
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
    const texts = ['나란한 방향', ...Object.values(LOCK_HINTS), LOCK_KEYS_HINT, NO_LOCK_TOUCH, NO_LOCK_MOUSE, '잠금', '지금 방향 잠그기(다시 누르면 풀기)', '방향 잠금', '방향 잠금 풀기'];
    for (const lang of ['en', 'ja', 'zh-CN', 'de']) {
      for (const t of texts) {
        expect(catalogs[lang]?.[t], `${lang}: ${t}`).toBeTruthy();
        expect(translate(t, lang), `${lang}: ${t}`).not.toMatch(/[가-힣]/);
      }
    }
  });
});
