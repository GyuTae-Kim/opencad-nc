// @vitest-environment jsdom
/**
 * 측정 띠의 끌어온 점 단추(24차 measure-track.ts — 3D 뷰어 코어 0.16.0 setMeasureTrackPoints)를 실제 코어 판정으로:
 * - 정밀 조준 십자선(코어에는 펜 포인터)이 점 위에서 떨려 코어 머무르기(2화소 안 0.5초)가 걸리지 않아도, 단추를 누르면 지금 붙잡은 점을
 *   끌어온 점으로 기억하고 바로 그 점의 축에 붙는다
 * - 점 붙잡기가 아니면(빈 곳·축 위) 기억하지 않고 맞추는 법을 알린다. 셋까지, 새것이 앞, 같은 점은 앞으로
 * - 단추는 정밀 조준 중이거나 기억한 점이 있을 때만 보인다
 * - 앱의 정밀 조준(aim.ts TouchAim)을 그대로 붙여 손가락 하나로 조준하는 동안 다른 손가락으로 누른 단추가 십자선 아래 점을 기억하고,
 *   손가락을 떼면 그 자리에 첫 점을 찍는다(기억한 점은 남는다)
 * - 머무르기로 기억한 점도 잠금 손잡이가 알려(changed) 단추 수에 든다
 * 머무르기·길게 누르기는 코어·앱의 setTimeout이라 횟수가 아니라 시간으로 기다린다. 화면 자리는 선 끝을 정확히 가리키지 않는다(조금 비켜).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type Scene3d } from 'opencad-viewer3d';
import { AIM_HOLD_MS, AIM_OFFSET_PX, TouchAim, touchPointerEvent } from '../../src/app/aim';
import { MEASURE_INFERENCE } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { NO_TRACK_MOUSE, NO_TRACK_TOUCH, TRACKED, TRACK_LABEL, TRACK_TITLE, TrackPick, trackPointOf } from '../../src/app/measure-track';
import { catalogs, translate } from '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

// 위에서 본 세 선분: (0,0) → (40,0), (60,30) → (80,30), (100,−20) → (100,40)
const scene: Scene3d = { name: 'track-pick', units: 'mm', meshes: [], lines: [{ id: 'path', positions: new Float32Array([0, 0, 0, 40, 0, 0, 60, 30, 0, 80, 30, 0, 100, -20, 0, 100, 40, 0]) }], points: [] };
const P = [60, 30, 0];
const Q = [80, 30, 0];
const A = [0, 0, 0];
const B = [40, 0, 0];
/** 끝점에서 조금 비켜(끝점 붙잡기 거리 안이라 그 끝점에 붙는다) */
const near = (p: readonly number[]): number[] => [p[0]! + 0.2, p[1]! + 0.1, p[2]!];
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup(touch = true) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  const bar = document.createElement('div');
  const layer = document.createElement('div');
  document.body.append(host, bar, layer);
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
  const flashes: string[] = [];
  /** 앱의 정밀 조준(시험이 붙이면 — 단추는 조준 중이거나 기억한 점이 있을 때만 보인다) */
  const ctl: { aim: TouchAim | null } = { aim: null };
  const track = new TrackPick({
    viewer: () => v,
    touch: () => touch,
    aiming: () => !!ctl.aim?.aiming,
    flash: (text, ms, kind) => {
      flashes.push(text);
      lock.showFlash(text, ms, kind);
    },
    changed,
  });
  bar.append(lock.button, track.button, lock.flash);
  const at = (p: readonly number[]): { x: number; y: number } => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    return { x: s.x, y: s.y };
  };
  const ptr = (type: string, x: number, y: number, pointerType = 'mouse'): void => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    v.canvas.dispatchEvent(e);
  };
  /** 화면 자리로 커서(펜 = 조준 십자선)를 옮기고 코어가 그린 뒤 앱이 맞춘다 */
  const hoverXY = (x: number, y: number, pointerType = 'pen'): void => {
    ptr('pointermove', x, y, pointerType);
    v.renderNow();
    lock.update();
  };
  const hover = (p: readonly number[], pointerType = 'pen'): void => {
    const s = at(p);
    hoverXY(s.x, s.y, pointerType);
  };
  const click = (p: readonly number[], pointerType = 'pen'): void => {
    hover(p, pointerType);
    const s = at(p);
    ptr('pointerdown', s.x, s.y, pointerType);
    ptr('pointerup', s.x, s.y, pointerType);
    v.renderNow();
    lock.update();
  };
  /** 측정 띠 단추를 손가락으로 누른다(정밀 조준 중 다른 손가락 — click이 오지 않는다) */
  const press = (pointerType = 'touch'): void => {
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'pointerType', { value: pointerType });
    track.button.dispatchEvent(down);
    v.renderNow();
    lock.update();
  };
  return { v, lock, track, changed, flashes, ctl, bar, layer, at, ptr, hover, hoverXY, click, press };
}

describe('끌어올 수 있는 점(코어 머무르기와 같은 판정)', () => {
  it('점 붙잡기는 그 점의 복사본, 잠근 선 위·축·나란한 방향·붙잡지 않은 점은 null', () => {
    const p: [number, number, number] = [1, 2, 3];
    const got = trackPointOf({ point: p, snap: 'endpoint' });
    expect(got).toEqual([1, 2, 3]);
    expect(got).not.toBe(p);
    for (const snap of ['vertex', 'midpoint', 'center', 'point', 'intersection', 'perpendicular'] as const) expect(trackPointOf({ point: p, snap }), snap).toEqual(p);
    expect(trackPointOf({ point: p, snap: 'endpoint', locked: true })).toBeNull();
    expect(trackPointOf({ point: p, snap: 'axis' })).toBeNull();
    expect(trackPointOf({ point: p, snap: 'parallel' })).toBeNull();
    expect(trackPointOf({ point: p, snap: null })).toBeNull();
    expect(trackPointOf({ point: [NaN, 0, 0], snap: 'endpoint' })).toBeNull();
    expect(trackPointOf(null)).toBeNull();
  });
});

describe('끌어온 점 단추(실제 코어 판정)', () => {
  it('십자선이 점 위에서 떨려 머무르기가 걸리지 않아도, 누르면 그 점을 기억하고 바로 그 점의 축에 붙는다(첫 점 전에도)', () => {
    const w = setup();
    const { v, track } = w;
    expect(track.button.getAttribute('aria-label')).toBe(TRACK_LABEL);
    expect(track.button.title).toBe(TRACK_TITLE);
    expect(track.count).toBe(0);
    // 조준하지 않고 기억한 점도 없으면 숨는다(손가락은 붙잡은 점이 없어 누를 일이 없다 — 측정 띠는 예전 그대로)
    track.update();
    expect(track.button.hidden).toBe(true);
    // 끝점 P 둘레 3화소 안팎을 0.1초마다 오가며 0.8초(코어 머무르기는 시작 자리 2화소 안 0.5초 — 손가락 떨림).
    // 기계가 바빠 0.1초 기다림이 늘어져도 머무르기가 걸리지 않게 코어 타이머는 가짜 시계로 넘긴다
    const s = w.at(near(P));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      for (let k = 0; k < 8; k++) {
        w.hoverXY(s.x + (k % 2 ? 3 : -0.5), s.y + (k % 3) - 1);
        expect(v.measureHoverSnap?.snap).toBe('endpoint');
        vi.advanceTimersByTime(100);
      }
      vi.advanceTimersByTime(100);
    } finally {
      vi.useRealTimers();
    }
    v.renderNow();
    expect(v.measureTrackPoints).toEqual([]);
    w.changed.mockClear();
    w.press();
    expect(v.measureTrackPoints).toEqual([P]);
    expect(track.count).toBe(1);
    expect(track.button.classList.contains('on')).toBe(true);
    // 기억한 점이 있으면 조준하지 않아도 보인다(점 수)
    expect(track.button.hidden).toBe(false);
    expect(w.flashes.at(-1)).toBe(TRACKED);
    expect(w.lock.snapshot().flash).toBe(TRACKED);
    expect(w.changed).toHaveBeenCalled();
    // 첫 점을 찍기 전에도 P의 Y축(x = 60) 위에 붙는다
    w.hover([60.5, 12, 0]);
    expect(v.measureHoverSnap).toMatchObject({ snap: 'axis', axis: 'y', trackFrom: P });
    expect(w.lock.snapshot().tip).toBe('끌어온 점에서 Y축');
  });

  it('점 붙잡기가 없으면(빈 곳·첫 점 축 위) 기억하지 않고 맞추는 법을 알린다 — 손가락 기기와 마우스 글', () => {
    const w = setup();
    const { v } = w;
    // 빈 곳(선분에서 멀리)
    w.hover([20, 20, 0]);
    expect(v.measureHoverSnap?.snap ?? null).toBeNull();
    expect(w.track.pick()).toBe(false);
    expect(v.measureTrackPoints).toEqual([]);
    expect(w.lock.snapshot().flash).toBe(NO_TRACK_TOUCH);
    // 첫 점 A를 찍은 뒤 첫 점 X축 위(경로 밖 — 축 붙잡기)
    w.click(near(A));
    expect(v.measurePointCount).toBe(1);
    w.hover([50, 0.4, 0]);
    expect(v.measureHoverSnap).toMatchObject({ snap: 'axis', axis: 'x' });
    w.press();
    expect(v.measureTrackPoints).toEqual([]);
    expect(w.track.count).toBe(0);
    // 마우스(넓은 화면 키보드 기기)는 머무르기를 알린다 — 단추를 누를 때 커서가 캔버스를 떠나 미리 보기가 없다
    const m = setup(false);
    m.ptr('pointerleave', 0, 0);
    m.v.renderNow();
    m.track.button.click();
    expect(m.lock.snapshot().flash).toBe(NO_TRACK_MOUSE);
  });

  it('셋까지 새것이 앞이고 같은 점은 앞으로, 손가락 누르기 뒤 따라오는 click은 다시 세지 않는다', () => {
    const w = setup();
    const { v } = w;
    const spy = vi.spyOn(v, 'setMeasureTrackPoints');
    for (const p of [P, Q, A]) {
      w.hover(near(p));
      w.press();
    }
    expect(v.measureTrackPoints).toEqual([A, Q, P]);
    expect(spy).toHaveBeenCalledTimes(3);
    // 손가락 누르기 뒤 1초 안의 click(브라우저가 이어 보내는 것)은 무시
    w.track.button.click();
    expect(spy).toHaveBeenCalledTimes(3);
    w.hover(near(B));
    w.press();
    expect(v.measureTrackPoints).toEqual([B, A, Q]);
    w.hover(near(Q));
    w.press();
    expect(v.measureTrackPoints).toEqual([Q, B, A]);
    expect(w.track.count).toBe(3);
    // 측정을 지우면(다시 재기) 끌어온 점도 지운다 — 단추 수도
    v.clearMeasure();
    w.track.update();
    expect(v.measureTrackPoints).toEqual([]);
    expect(w.track.count).toBe(0);
    expect(w.track.button.classList.contains('on')).toBe(false);
    expect(w.track.button.hidden).toBe(true);
  });

  it('정밀 조준(aim.ts)과 함께: 조준하는 동안 다른 손가락으로 누르면 십자선 아래 점을 기억하고, 떼면 그 자리에 첫 점 — 기억한 점은 남는다', async () => {
    const w = setup();
    const { v, track } = w;
    // 앱(attachMeasure)처럼 조준을 시작하고 마칠 때 단추를 맞춘다
    const aim = new TouchAim(v.canvas, { enabled: () => v.measureMode, layer: w.layer, onMove: (_at, finger) => w.lock.setAim(finger), onChange: () => track.update() });
    w.ctl.aim = aim;
    try {
      track.update();
      expect(track.button.hidden).toBe(true);
      const finger = (p: readonly number[]): { x: number; y: number } => {
        const s = w.at(p);
        return { x: s.x, y: s.y + AIM_OFFSET_PX };
      };
      const fire = (type: string, f: { x: number; y: number }): void => {
        v.canvas.dispatchEvent(touchPointerEvent(type, 7, f.x, f.y));
      };
      // 손가락을 P 아래에 대고 길게 누른다(시간으로 기다린다)
      const f0 = finger(near(P));
      fire('pointerdown', f0);
      const t0 = performance.now();
      while (!aim.aiming && performance.now() - t0 < AIM_HOLD_MS + 2000) await wait(50);
      expect(aim.aiming).toBe(true);
      // 조준을 시작하면 단추가 나타난다
      expect(track.button.hidden).toBe(false);
      // 손가락을 조금 끌어(떨림) 십자선이 P 위에 — 코어는 펜 미리 보기
      fire('pointermove', { x: f0.x + 2, y: f0.y + 1 });
      v.renderNow();
      w.lock.update();
      expect(v.measureHoverSnap?.snap).toBe('endpoint');
      expect(v.measureHoverSnap?.point).toEqual(P);
      // 다른 손가락으로 측정 띠의 끌어온 점 단추
      w.press();
      expect(v.measureTrackPoints).toEqual([P]);
      expect(track.count).toBe(1);
      expect(aim.aiming).toBe(true);
      // 조준을 A로 옮겨 떼면 A에 첫 점(조준 중 단추 누르기는 조준을 그만두지 않는다)
      const f1 = finger(near(A));
      fire('pointermove', f1);
      v.renderNow();
      fire('pointerup', f1);
      v.renderNow();
      w.lock.update();
      expect(aim.aiming).toBe(false);
      expect(v.measurePointCount).toBe(1);
      expect(v.measurePoints[0]!.point).toEqual(A);
      expect(v.measureTrackPoints).toEqual([P]);
      // 조준을 마쳐도 기억한 점이 있어 단추(점 수)는 남는다
      expect(track.button.hidden).toBe(false);
      // 첫 점 X축 위에서 P와 나란한 자리(60, 0)는 X축 방향, P의 Y축 위 다른 자리는 끌어온 점에서 Y축
      w.hover([60.4, 0.3, 0]);
      expect(v.measureHoverSnap).toMatchObject({ snap: 'axis', axis: 'x', trackFrom: P });
      w.hover([60.5, 15, 0]);
      expect(v.measureHoverSnap).toMatchObject({ snap: 'axis', axis: 'y', trackFrom: P });
    } finally {
      aim.dispose();
    }
  });

  it('머무르기로 기억한 점(십자선을 멈춤)도 잠금 손잡이가 알려 단추 수에 든다', async () => {
    const w = setup();
    const { v } = w;
    w.hover(near(P));
    w.changed.mockClear();
    await wait(700);
    v.renderNow();
    expect(v.measureTrackPoints).toEqual([P]);
    // 코어 타이머가 기억한 뒤 다음 포인터 이동에서 잠금 손잡이가 끌어온 점 수가 바뀐 것을 알린다(앱은 측정 띠를 다시 그린다)
    w.hover(near(P));
    expect(w.changed).toHaveBeenCalled();
    w.track.update();
    expect(w.track.count).toBe(1);
  });
});

describe('새 문구 다섯 언어', () => {
  it('단추 이름·풀이·알림을 en·ja·zh-CN·de 사전이 옮긴다', () => {
    for (const text of [TRACK_LABEL, TRACK_TITLE, TRACKED, NO_TRACK_TOUCH, NO_TRACK_MOUSE]) {
      for (const code of ['en', 'ja', 'zh-CN', 'de'] as const) {
        expect(catalogs[code]![text], `${code}: ${text}`).toBeTruthy();
        expect(translate(text, code), `${code}: ${text}`).not.toMatch(/[가-힣]/);
      }
    }
  });
});
