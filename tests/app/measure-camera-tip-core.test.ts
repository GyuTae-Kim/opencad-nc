// @vitest-environment jsdom
/**
 * 100차: 카메라만 움직였을 때(카메라 바꾸기·휠 확대·보기 키 F·1~7) 측정 붙잡기 툴팁이 그 점의 새 화면 자리를 따르는지 — 앱(app.ts·measure-lock.ts)과 실제 코어(가짜 WebGL).
 * 코어는 휠·카메라에 미리 보기를 다시 구하지 않는다(세계 점 그대로 — 0.103.0 읽은 표·0.104.0 남은 한계). 값이 같아 onMeasureHoverChange도 오지 않는다.
 * 99차까지 앱은 카메라 알림으로 툴팁 자리를 옮기지 않아, 마우스를 멈춘 채면 다음 포인터 이동까지 툴팁이 앞 화면 자리에 남았다(코어가 그리는 붙잡기 표식은 점을 따른다).
 * - 판정: 미리 보기 값은 그대로이고, 보이는 툴팁 상태(snapshot)가 지금 카메라로 다시 맞춘 상태(update 뒤 snapshot)와 같으며 그 자리가 앞 자리와 다르다
 * - 측정을 껐거나 툴팁이 없으면 카메라가 바뀌어도 툴팁을 셈하지 않는다(투영·자리 놓기 없음 — 비용 그대로)
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
// 원호(줄 5) 중심 (30,0)은 빈 곳 — 양옆 직선 끝 (20,0)·(40,0)과 원호 꼭대기 (30,10)에서 10 mm
const ARC = ['G21 G90 G17', 'G0 X0 Y0 Z5', 'G1 Z0 F300', 'G1 X20', 'G2 X40 Y0 I10 J0', 'G1 X60', 'G0 Z5', 'M2'].join('\n');

/** 앱 하나를 시험 사이에 다시 쓴다(앱은 창 키 듣기를 떼지 않는다) */
let shared: NcViewerApp | null = null;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** 코어 그리기(rAF)와 앱의 두 프레임 뒤 맞추기(schedule)가 끝날 때까지 */
const frames = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await tick();
};

const lockOf = (app: NcViewerApp): MeasureLock => (app as unknown as { mlock: MeasureLock }).mlock;
/** 지금 코어 미리 보기·카메라로 다시 맞춘 툴팁 상태 */
const fresh = (app: NcViewerApp): ReturnType<MeasureLock['snapshot']> => {
  const l = lockOf(app);
  l.update();
  return l.snapshot();
};
/** 코어 미리 보기 값(점·종류·잠글 방향 — 0.103.0 알림이 견주는 것) */
const hoverKey = (v: Viewer3d): string => JSON.stringify([v.measureHoverSnap, v.measureHoverLock]);

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

/** 화면 자리로 마우스 포인터 사건(코어 듣기 → 앱 듣기, 거품) */
function pointerXY(v: Viewer3d, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  v.canvas.dispatchEvent(e);
}

/** 화면 자리에 마우스를 올리고 멈춘다(그 그림의 미리 보기와 앱의 두 프레임 뒤 맞추기까지) */
async function hoverXY(v: Viewer3d, x: number, y: number): Promise<void> {
  pointerXY(v, 'pointermove', x, y);
  v.renderNow();
  await frames();
}

async function hover(v: Viewer3d, p: readonly number[]): Promise<void> {
  const s = v.project(p)!;
  expect(s.onScreen).toBe(true);
  await hoverXY(v, s.x, s.y);
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

describe('100차: 카메라만 움직이면 측정 툴팁이 그 점의 새 화면 자리를 따른다', () => {
  it('카메라 바꾸기(setCamera — 끌지 않은 이동): 원호 중심 위에 멈춘 채 카메라만 옮기면 툴팁도 옮는다', async () => {
    const { app, v } = await measuring();
    await hover(v, [30, 0, 0]);
    const pre = app.state().measureLock!;
    expect(v.measureHoverSnap?.snap).toBe('center');
    expect(pre.tip).toBe('중심');
    expect(pre).toEqual(fresh(app));
    const hv = hoverKey(v);
    const c = v.getCamera();
    v.setCamera({ ...c, target: [c.target[0] + 5, c.target[1] + 2, c.target[2]] });
    v.renderNow();
    await frames();
    // 코어는 카메라만 바뀐 것에 미리 보기를 다시 구하지 않는다(세계 점 그대로 — 알림 없음)
    expect(hoverKey(v)).toBe(hv);
    const shown = app.state().measureLock!;
    const now = fresh(app);
    expect(now.tip).toBe('중심');
    expect(now.tipRect).not.toEqual(pre.tipRect);
    expect(shown).toEqual(now);
  });

  it('휠 확대: 원호 중심 곁에 멈춘 채 휠을 굴리면(커서 둘레로 확대 — 중심은 커서에서 멀어진다) 툴팁이 중심을 따른다', async () => {
    const { app, v } = await measuring();
    // 빈 곳의 원호 중심에서 오른쪽 아래로 5화소씩(붙잡기 거리 10화소 안 — 중심에 붙는다. 둘레에 고를 선분이 없어 확대 기준은 커서 자리라
    // 커서에 있는 점만 제자리이고 중심은 커서에서 멀어진다)
    const e = v.project([30, 0, 0])!;
    const cx = e.x + 5;
    const cy = e.y + 5;
    await hoverXY(v, cx, cy);
    const pre = app.state().measureLock!;
    expect(v.measureHoverSnap?.snap).toBe('center');
    expect(pre.tip).toBe('중심');
    expect(pre).toEqual(fresh(app));
    const hv = hoverKey(v);
    const before = v.getCamera().distance;
    for (let i = 0; i < 2; i++) v.canvas.dispatchEvent(new WheelEvent('wheel', { clientX: cx, clientY: cy, deltaY: -400, deltaMode: 0, bubbles: true, cancelable: true }));
    v.renderNow();
    await frames();
    expect(v.getCamera().distance).toBeLessThan(before);
    expect(hoverKey(v)).toBe(hv);
    const shown = app.state().measureLock!;
    const now = fresh(app);
    expect(now.tip).toBe('중심');
    expect(now.tipRect).not.toEqual(pre.tipRect);
    expect(shown).toEqual(now);
  });

  it('보기 키(7 — 남동 등각, 움직임): 원호 중심 위에 멈춘 채 3D 보기에서 보기를 바꾸면 움직임이 끝난 자리에서 툴팁이 중심을 따른다', async () => {
    const { app, v } = await measuring();
    await hover(v, [30, 0, 0]);
    const pre = app.state().measureLock!;
    expect(pre.tip).toBe('중심');
    const hv = hoverKey(v);
    const c0 = v.getCamera();
    // 171차(WCAG 2.1.4 문자 키 단축키): 초점이 3D 보기 밖(body — 초점 없음)이면 앱 onKey가 글자·숫자 키를 뷰어로 넘기지 않는다 — 카메라 그대로
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '7', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 600));
    await frames();
    expect([v.getCamera().yaw, v.getCamera().pitch]).toEqual([c0.yaw, c0.pitch]);
    // 3D 보기(캔버스)가 받은 키 — 코어가 직접 받는다(앱 onKey는 넘기지 않음)
    v.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '7', bubbles: true, cancelable: true }));
    // 움직임(0.32초)이 끝날 때까지
    await new Promise((r) => setTimeout(r, 600));
    await frames();
    const c1 = v.getCamera();
    expect([c1.yaw, c1.pitch]).not.toEqual([c0.yaw, c0.pitch]);
    expect(hoverKey(v)).toBe(hv);
    const shown = app.state().measureLock!;
    const now = fresh(app);
    expect(now.tip).toBe('중심');
    expect(now.tipRect).not.toEqual(pre.tipRect);
    expect(shown).toEqual(now);
  });

  it('비용 그대로: 측정을 껐거나 툴팁이 없으면 카메라가 바뀌어도 툴팁을 셈하지 않는다', async () => {
    const { app, v } = await measuring();
    const lock = lockOf(app);
    const place = vi.spyOn(lock as unknown as { placeTipNow(v: unknown): void }, 'placeTipNow');
    const update = vi.spyOn(lock, 'update');
    const schedule = vi.spyOn(lock, 'schedule');
    const project = vi.spyOn(v, 'project');
    const moveCamera = async (): Promise<void> => {
      for (const dx of [3, -6, 3]) {
        const c = v.getCamera();
        v.setCamera({ ...c, target: [c.target[0] + dx, c.target[1], c.target[2]] });
        v.renderNow();
      }
      v.canvas.dispatchEvent(new WheelEvent('wheel', { clientX: 400, clientY: 300, deltaY: -200, deltaMode: 0, bubbles: true, cancelable: true }));
      v.renderNow();
      await frames();
    };
    try {
      // 측정 중이지만 아직 마우스를 올리지 않음(미리 보기·툴팁 없음)
      expect(app.state().measureLock!.tip).toBeNull();
      await moveCamera();
      expect(place).not.toHaveBeenCalled();
      expect(project).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
      // 툴팁을 띄운 뒤 측정을 끔(reset이 툴팁을 거둔다)
      project.mockClear();
      await hover(v, [30, 0, 0]);
      expect(app.state().measureLock!.tip).toBe('중심');
      app.toggleMeasure(false);
      await vi.waitFor(() => expect(app.state().measuring).toBe(false));
      await frames();
      place.mockClear();
      update.mockClear();
      schedule.mockClear();
      project.mockClear();
      await moveCamera();
      expect(place).not.toHaveBeenCalled();
      expect(project).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      place.mockRestore();
      update.mockRestore();
      schedule.mockRestore();
      project.mockRestore();
    }
  });
});
