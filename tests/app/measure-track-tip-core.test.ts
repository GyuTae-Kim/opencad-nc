// @vitest-environment jsdom
/**
 * 101차: 측정 툴팁·방향 잠금·측정 띠를 포인터 길 없이 맞추는지 — 앱(app.ts·measure-lock.ts)과 실제 코어(가짜 WebGL).
 * 99차는 코어 머무르기로 기억한 끌어온 점을 코어가 알리지 않아 포인터 길(pointermove·pointerleave·pointerup → 두 프레임 뒤 update)을 남겼다.
 * 코어 0.107.0부터 끌어온 점 목록이 바뀐 그림 뒤에도 onMeasureHoverChange가 오므로 그 길을 걷었다.
 * - 머무르기 끝: 포인터 사건 없이 그 그림 뒤 측정 띠의 끌어온 점 수와 다시 재기 버튼이 맞는다(99차가 다음 포인터 이동까지 기다리던 경우)
 * - 마우스 이동·떠남·첫 점 찍기: 미리 보기 알림만으로 툴팁·잠금 버튼이 지금 코어 값으로 다시 맞춘 것과 같다
 * - 손가락으로 눌러 찍은 첫 점(미리 보기가 없어 알림도 없음): 앱의 떼기 듣기(측정 띠 맞추기)가 그 자리에서 맞춘다
 * - 비용: 포인터 사건으로 schedule을 부르지 않고, 측정을 껐거나 미리 보기가 그대로면 update도 부르지 않는다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Viewer3d } from 'opencad-viewer3d';
import { installCanvasFakes } from './fake-webgl';

vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts = {}) {
      return parseForView(name, new Uint8Array(data), opts);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import '../../site/i18n.mjs';
import { NcViewerApp } from '../../src/app/app';
import { measureHint } from '../../src/app/measure';
import type { MeasureLock } from '../../src/app/measure-lock';

let restore: () => void;
const scroll = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
});
afterAll(() => {
  restore();
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
});

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
// 원호(줄 5) 중심 (30,0)은 빈 곳 — 양옆 직선 끝 (20,0)·(40,0)과 원호 꼭대기 (30,10)에서 10 mm. (30,-15) 둘레는 아무것도 없다
const ARC = ['G21 G90 G17', 'G0 X0 Y0 Z5', 'G1 Z0 F300', 'G1 X20', 'G2 X40 Y0 I10 J0', 'G1 X60', 'G0 Z5', 'M2'].join('\n');

/** 앱 하나를 시험 사이에 다시 쓴다(앱은 창 키 듣기를 떼지 않는다) */
let shared: NcViewerApp | null = null;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** 코어 그리기(rAF)와 그 뒤 알림이 끝날 때까지 */
const frames = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await tick();
};
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Inner = { mlock: MeasureLock; measureClear: HTMLButtonElement; measureBar: HTMLElement; mtrack: { count: number } };
const inner = (app: NcViewerApp): Inner => app as unknown as Inner;
/** 지금 코어 미리 보기로 다시 맞춘 툴팁 상태(update를 부른다 — 측정 띠도 다시 그린다) */
const fresh = (app: NcViewerApp): ReturnType<MeasureLock['snapshot']> => {
  const l = inner(app).mlock;
  l.update();
  return l.snapshot();
};

async function open(name: string, text: string): Promise<{ app: NcViewerApp; v: Viewer3d }> {
  if (!shared) {
    document.body.innerHTML = '<div id="app"></div>';
    shared = new NcViewerApp(document.getElementById('app')!);
  }
  const app = shared;
  if (app.state().measuring) app.toggleMeasure(false);
  expect(await app.openBuffer(name, enc(text))).toBe(true);
  return { app, v: app.viewer! };
}

/** 위에서 본 보기로 장면 전체를 맞춘다 */
function top(v: Viewer3d): void {
  v.setView('top', false);
  v.fit(false);
  v.renderNow();
}

/** 세계 점 p의 화면 자리(조금 옆 — 선·경로 끝을 정확히 가리키지 않는다)로 포인터 사건(코어 듣기 → 앱 듣기, 거품) */
function ptr(v: Viewer3d, type: string, p: readonly number[], kind = 'mouse', dx = 1, dy = 1): void {
  const s = v.project(p)!;
  expect(s.onScreen).toBe(true);
  const e = new MouseEvent(type, { clientX: s.x + dx, clientY: s.y + dy, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
  Object.defineProperty(e, 'pointerId', { value: kind === 'touch' ? 7 : 1 });
  Object.defineProperty(e, 'pointerType', { value: kind });
  v.canvas.dispatchEvent(e);
}

/** 마우스를 올리고 멈춘다(그 그림의 미리 보기와 알림까지) */
async function hover(v: Viewer3d, p: readonly number[], dx = 1, dy = 1): Promise<void> {
  ptr(v, 'pointermove', p, 'mouse', dx, dy);
  v.renderNow();
  await frames();
}

/** 측정을 켜고 위에서 본 보기로 원호 문서를 연다 */
async function measuring(): Promise<{ app: NcViewerApp; v: Viewer3d }> {
  const { app, v } = await open('arc.nc', ARC);
  app.toggleMeasure(true);
  await vi.waitFor(() => expect(app.state().measuring).toBe(true));
  top(v);
  await frames();
  return { app, v };
}

describe('101차: 포인터 길 없이 코어 미리 보기 알림(0.107.0 끌어온 점 포함)으로 측정 툴팁·측정 띠를 맞춘다', () => {
  it('머무르기 끝: 끝점에 멈춰 끌어온 점이 생기면 포인터 사건 없이 측정 띠의 끌어온 점 수와 다시 재기 버튼이 맞는다', async () => {
    const { app, v } = await measuring();
    const { measureClear, mtrack } = inner(app);
    await hover(v, [40, 0, 0]);
    expect(v.measureHoverSnap).not.toBeNull();
    expect(v.measureTrackPoints.length).toBe(0);
    expect(measureClear.disabled).toBe(true);
    expect(mtrack.count).toBe(0);
    const hv = JSON.stringify([v.measureHoverSnap, v.measureHoverLock]);
    const update = vi.spyOn(inner(app).mlock, 'update');
    try {
      // 머무르기는 코어의 setTimeout(0.5초)이라 시간으로 기다린다 — 그동안 포인터 사건은 없다
      await wait(700);
      await frames();
      expect(v.measureTrackPoints.length).toBe(1);
      // 미리 보기 값은 그대로(0.106.0까지는 알림이 없던 그림)
      expect(JSON.stringify([v.measureHoverSnap, v.measureHoverLock])).toBe(hv);
      expect(update).toHaveBeenCalled();
      // fresh(update)를 부르기 전에 본다 — 알림이 이미 측정 띠를 다시 그렸다
      expect(measureClear.disabled).toBe(false);
      expect(mtrack.count).toBe(1);
      expect(app.state().measureLock).toEqual(fresh(app));
    } finally {
      update.mockRestore();
    }
  });

  it('마우스 이동·떠남·첫 점 찍기: 알림만으로 툴팁·잠금 버튼이 지금 코어 값과 같고 schedule을 부르지 않는다', async () => {
    const { app, v } = await measuring();
    const schedule = vi.spyOn(inner(app).mlock, 'schedule');
    try {
      await hover(v, [30, 0, 0], 0, 0);
      expect(v.measureHoverSnap?.snap).toBe('center');
      const on = app.state().measureLock!;
      expect(on.tip).toBe('중심');
      expect(on).toEqual(fresh(app));
      // 캔버스를 떠나면 코어가 미리 보기를 버린다(null 알림)
      v.canvas.dispatchEvent(new MouseEvent('pointerleave'));
      await frames();
      expect(v.measureHoverSnap).toBeNull();
      const off = app.state().measureLock!;
      expect(off.tip).toBeNull();
      expect(off).toEqual(fresh(app));
      // 첫 점: 올린 끝점을 누른다(코어가 미리 보기를 버린다 — 다음 이동까지 없음)
      await hover(v, [20, 0, 0]);
      expect(app.state().measureLock!.tip).not.toBeNull();
      ptr(v, 'pointerdown', [20, 0, 0]);
      ptr(v, 'pointerup', [20, 0, 0]);
      await frames();
      expect(v.measurePointCount).toBe(1);
      expect(v.measureHoverSnap).toBeNull();
      const first = app.state().measureLock!;
      expect(first.tip).toBeNull();
      expect(first.button).toBe(true);
      expect(first).toEqual(fresh(app));
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      schedule.mockRestore();
    }
  });

  it('손가락으로 눌러 찍은 첫 점: 미리 보기가 없어 알림이 없어도 앱의 떼기 듣기가 그 자리에서 잠금 버튼·측정 띠를 맞춘다', async () => {
    const { app, v } = await measuring();
    const { measureClear, measureBar } = inner(app);
    expect(v.measureHoverSnap).toBeNull();
    expect(app.state().measureLock!.button).toBe(false);
    expect(measureClear.disabled).toBe(true);
    const schedule = vi.spyOn(inner(app).mlock, 'schedule');
    try {
      ptr(v, 'pointerdown', [20, 0, 0], 'touch');
      ptr(v, 'pointerup', [20, 0, 0], 'touch');
      // 그리기를 기다리지 않고(떼기 사건 안에서 맞춘다)
      expect(v.measurePointCount).toBe(1);
      expect(v.measureHoverSnap).toBeNull();
      expect(app.state().measureLock!.button).toBe(true);
      expect(measureClear.disabled).toBe(false);
      expect(measureBar.querySelector('.mb-hint')!.textContent).toBe(measureHint(1, false));
      await frames();
      expect(app.state().measureLock).toEqual(fresh(app));
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      schedule.mockRestore();
    }
  });

  it('비용: 측정을 껐으면 포인터 이동·떠남·떼기에 update·schedule을 부르지 않는다', async () => {
    const { app, v } = await measuring();
    app.toggleMeasure(false);
    await vi.waitFor(() => expect(app.state().measuring).toBe(false));
    await frames();
    expect(v.measureMode).toBe(false);
    const lock = inner(app).mlock;
    const update = vi.spyOn(lock, 'update');
    const schedule = vi.spyOn(lock, 'schedule');
    try {
      for (const p of [[30, 0, 0], [20, 0, 0], [30, -15, 0]]) ptr(v, 'pointermove', p);
      v.renderNow();
      v.canvas.dispatchEvent(new MouseEvent('pointerleave'));
      ptr(v, 'pointerup', [30, -15, 0]);
      await frames();
      expect(update).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      update.mockRestore();
      schedule.mockRestore();
    }
  });

  it('비용: 측정 중 미리 보기가 그대로인 이동(빈 곳)에는 update·schedule을 부르지 않는다', async () => {
    const { app, v } = await measuring();
    await hover(v, [30, -15, 0], 0, 0);
    expect(v.measureHoverSnap).toBeNull();
    expect(app.state().measureLock!.tip).toBeNull();
    const lock = inner(app).mlock;
    const update = vi.spyOn(lock, 'update');
    const schedule = vi.spyOn(lock, 'schedule');
    try {
      await hover(v, [32, -15, 0], 0, 0);
      await hover(v, [28, -16, 0], 0, 0);
      expect(v.measureHoverSnap).toBeNull();
      expect(update).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      update.mockRestore();
      schedule.mockRestore();
    }
  });
});
