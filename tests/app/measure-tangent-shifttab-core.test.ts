// @vitest-environment jsdom
/**
 * 116차: 원호 위 Shift+Tab을 누르려고 먼저 누른 Shift의 접선 잠금 되돌리기를 앱 전체(창 키 듣기 차례)와 실제 3D 뷰어 코어(0.121.0, 가짜 WebGL)로.
 * 앱은 Shift keydown을 창 capture에서 코어보다 먼저 받아 커서 아래가 첫 점의 원호 위면 접선으로 잠근다(코어 잠금 출처 'api' — 코어 0.120.0은 되돌리지 않는다).
 * - 원호 위 그 자리 첫 후보에서 Shift → 같은 누름 Shift+Tab: 접선 잠금을 풀고 잠그지 않은 그 자리 후보의 끝(「n/n」 — 코어 0.120.0의 돌리지 않던 방향 후보와 같은 결과).
 *   같은 누름의 4화소 안 이동·Shift 되풀이·다른 Shift 키 누름에 다시 잠그지 않고 다음 Shift+Tab은 이어 돌며, 뗀 뒤 새 Shift는 접선 잠금(그 누름도 되돌린다)
 * - 바뀌지 않는 차례: Shift 누른 채 4화소 넘게 갔다 돌아옴·다른 키·Esc로 푼 자리(걸기 전 그 자리에서 Tab을 받지 못함)는 접선으로 잠근 채, Tab 없는 Shift는 떼면 풂
 * - 원호 밖 직선 자리(코어가 잠근 방향)는 코어 0.120.0 되돌리기 그대로
 * 문서·측정 도구는 한 앱으로 쓴다(앱마다 창 키 듣기가 남아 앞 앱의 Esc 처리가 사건을 멈출 수 있다). 가리키는 자리는 선 위를 조금 비킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MeasureHoverSnap, Viewer3d } from 'opencad-viewer3d';

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

import { NcViewerApp } from '../../src/app/app';
import { LOCK_HINTS, SHIFT_LOCK_HINTS } from '../../src/app/measure';
import { snapTip, type MeasureLock } from '../../src/app/measure-lock';
import { installCanvasFakes } from './fake-webgl';

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

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
// (0,40) → (40,40) 시계 방향 1/4 원(중심 (20,20)) → 직선 (60,40). 첫 점은 원호 시작 A, 원호 중간점 MID(꼭대기), 직선의 끝 LINE(그 직선이 첫 점을 지나 코어가 X축으로 잠금 —
// 직선 쪽으로 조금 비켜 가리킨다)
const ARC_NC = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'M2'].join('\n');
const A = [0, 40, 0];
const MID = [20, 20 + 20 * Math.SQRT2, 0];
const LINE = [60, 40, 0];
const LINE_DX = -2;
const AWAY = [30, 30, 0];

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const frames = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await tick();
};
type Inner = { mlock: MeasureLock };
const sameSnap = (a: MeasureHoverSnap | null | undefined, b: MeasureHoverSnap | undefined): boolean => !!a && !!b && a.snap === b.snap && a.point.every((x, i) => Math.abs(x - b.point[i]!) < 1e-9);

/** 세계 점 p의 화면 자리(조금 옆)로 포인터 사건(shift = Shift를 누른 채) */
function ptrAt(v: Viewer3d, type: string, p: readonly number[], dx = 1, dy = 1, shift = false): void {
  const s = v.project(p)!;
  expect(s.onScreen).toBe(true);
  const e = new MouseEvent(type, { clientX: s.x + dx, clientY: s.y + dy, shiftKey: shift, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  v.canvas.dispatchEvent(e);
}
async function hoverAt(v: Viewer3d, p: readonly number[], shift = false, dx = 1): Promise<void> {
  ptrAt(v, 'pointermove', p, dx, 1, shift);
  v.renderNow();
  await frames();
}
/** 캔버스가 받은 키(창 캡처 단계의 앱 키 듣기 → 캔버스의 코어 키 듣기) */
function key(v: Viewer3d, k: string, shift = false, repeat = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, repeat, bubbles: true, cancelable: true });
  v.canvas.dispatchEvent(e);
  return e;
}
function keyUp(v: Viewer3d, k: string): void {
  v.canvas.dispatchEvent(new KeyboardEvent('keyup', { key: k, shiftKey: k !== 'Shift', bubbles: true, cancelable: true }));
}

let shared: { app: NcViewerApp; v: Viewer3d; lock: MeasureLock } | null = null;
/** 한 앱에서 측정을 다시 켜고 첫 점 A를 찍는다 */
async function begin(): Promise<{ app: NcViewerApp; v: Viewer3d; lock: MeasureLock; snap: () => ReturnType<MeasureLock['snapshot']> }> {
  if (!shared) {
    document.body.innerHTML = '<div id="app"></div>';
    const app = new NcViewerApp(document.getElementById('app')!);
    expect(await app.openBuffer('arc.nc', enc(ARC_NC).buffer as ArrayBuffer)).toBe(true);
    shared = { app, v: app.viewer!, lock: null as unknown as MeasureLock };
  }
  const { app, v } = shared;
  app.toggleMeasure(false);
  await vi.waitFor(() => expect(app.state().measuring).toBe(false));
  app.toggleMeasure(true);
  await vi.waitFor(() => expect(app.state().measureTools).toBe(true));
  await vi.waitFor(() => expect(app.state().measuring).toBe(true));
  const lock = (app as unknown as Inner).mlock;
  shared.lock = lock;
  v.setView('top', false);
  v.fit(false);
  v.renderNow();
  await frames();
  await hoverAt(v, A);
  ptrAt(v, 'pointerdown', A);
  ptrAt(v, 'pointerup', A);
  await frames();
  expect(v.measurePointCount).toBe(1);
  expect(v.measurePoints[0]).toMatchObject({ snap: 'endpoint' });
  v.canvas.focus();
  const snap = (): ReturnType<MeasureLock['snapshot']> => {
    lock.update();
    return lock.snapshot();
  };
  return { app, v, lock, snap };
}

/** 세계 점 p 자리(조금 옆)의 잠그지 않은 후보 목록(코어 measureCandidates — Tab 돌리기와 같은 목록·차례) */
function candidates(v: Viewer3d, p: readonly number[], dx = 1): MeasureHoverSnap[] {
  const s = v.project(p)!;
  return v.measureCandidates(s.x + dx, s.y + 1);
}
const tipOf = (h: MeasureHoverSnap | undefined, order: string): string | null => {
  const name = snapTip(h)?.name ?? null;
  return name === null ? null : `${name}${order}`;
};

describe('116차: 원호 위 Shift+Tab을 누르려고 먼저 누른 Shift의 접선 잠금 되돌리기(실제 코어 0.121.0)', () => {
  it('원호 위 첫 후보에서 Shift → 같은 누름 Shift+Tab: 접선 잠금을 풀고 그 자리 후보의 끝(n/n), 4화소 안 이동·Shift 되풀이·다른 Shift에 다시 잠그지 않고, 뗀 뒤 새 Shift는 접선 잠금', async () => {
    const { app, v, lock, snap } = await begin();
    await hoverAt(v, MID);
    const list = candidates(v, MID);
    const n = list.length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(sameSnap(v.measureHoverSnap, list[0])).toBe(true);
    expect(snap()).toMatchObject({ lock: null, hoverLock: 'tangent' });
    expect(lock.hint(false, false)).toBe(SHIFT_LOCK_HINTS.tangent);

    // Shift 누름: 앱이 코어보다 먼저 접선으로 잠근다(코어 출처 'api')
    key(v, 'Shift', true);
    await frames();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'parallel', source: 'api' });
    expect(snap()).toMatchObject({ lock: 'tangent', tip: '접선 방향 · 잠금' });
    expect(lock.hint(false, false)).toBe(LOCK_HINTS.tangent);

    // 같은 누름의 Shift+Tab: 잠금을 풀고 잠그지 않은 그 자리 후보의 끝(코어 Tab 돌리기 — cycle 차례)
    const back = key(v, 'Tab', true);
    expect(back.defaultPrevented).toBe(true);
    await frames();
    expect(v.measureInferenceLock).toBeNull();
    expect(sameSnap(v.measureHoverSnap, list[n - 1])).toBe(true);
    expect(v.measureHoverSnap!.cycle).toEqual({ index: n - 1, count: n });
    expect(app.state().measureLock).toMatchObject({ lock: null, tip: tipOf(list[n - 1], ` ${n}/${n}`) });
    expect(app.state().measureLock).toEqual(snap());
    expect(lock.hint(false, false)).not.toBe(LOCK_HINTS.tangent);

    // 같은 누름의 4화소 안 이동(Shift 누른 채)·Shift 되풀이·다른 Shift 키 누름: 다시 잠그지 않고 돌린 후보 그대로
    ptrAt(v, 'pointermove', MID, 3, 2, true);
    await frames();
    key(v, 'Shift', true, true);
    key(v, 'Shift', true);
    await frames();
    expect(v.measureInferenceLock).toBeNull();
    expect(snap().lock).toBeNull();
    expect(v.measureHoverSnap!.cycle).toEqual({ index: n - 1, count: n });
    // 다음 Shift+Tab은 코어가 이어 돈다
    expect(key(v, 'Tab', true).defaultPrevented).toBe(true);
    await frames();
    expect(v.measureInferenceLock).toBeNull();
    expect(sameSnap(v.measureHoverSnap, list[n - 2])).toBe(true);
    expect(v.measureHoverSnap!.cycle).toEqual({ index: n - 2, count: n });

    // 뗀 뒤 새 Shift는 접선 잠금이고, 그 누름의 Shift+Tab도 되돌린다
    keyUp(v, 'Shift');
    await hoverAt(v, AWAY);
    await hoverAt(v, MID);
    expect(sameSnap(v.measureHoverSnap, list[0])).toBe(true);
    key(v, 'Shift', true);
    await frames();
    expect(snap()).toMatchObject({ lock: 'tangent', tip: '접선 방향 · 잠금' });
    expect(key(v, 'Tab', true).defaultPrevented).toBe(true);
    await frames();
    expect(v.measureInferenceLock).toBeNull();
    expect(v.measureHoverSnap!.cycle).toEqual({ index: n - 1, count: n });
    keyUp(v, 'Shift');
    await frames();
    expect(v.measureInferenceLock).toBeNull();
  });

  it('바뀌지 않는 차례: 4화소 넘게 갔다 돌아옴·다른 키·Esc로 푼 자리는 접선으로 잠근 채, Tab 없는 Shift는 떼면 풂', async () => {
    const { v, snap } = await begin();
    await hoverAt(v, MID);
    expect(snap().hoverLock).toBe('tangent');

    // Shift 누른 채 4화소 넘게 갔다 돌아옴 → 같은 누름 Shift+Tab은 잠근 채(코어가 잠근 길로)
    key(v, 'Shift', true);
    await frames();
    expect(snap().lock).toBe('tangent');
    ptrAt(v, 'pointermove', MID, 7, 1, true);
    await frames();
    ptrAt(v, 'pointermove', MID, 1, 1, true);
    await frames();
    key(v, 'Tab', true);
    await frames();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'parallel', source: 'api' });
    expect(snap().lock).toBe('tangent');
    // Tab 없는 Shift: 떼면 푼다(지금 그대로)
    keyUp(v, 'Shift');
    await frames();
    expect(v.measureInferenceLock).toBeNull();

    // 다른 키(Control)가 낀 누름 → 잠근 채
    await hoverAt(v, AWAY);
    await hoverAt(v, MID);
    key(v, 'Shift', true);
    await frames();
    expect(snap().lock).toBe('tangent');
    key(v, 'Control', true);
    key(v, 'Tab', true);
    await frames();
    expect(snap().lock).toBe('tangent');
    keyUp(v, 'Shift');
    await frames();
    expect(v.measureInferenceLock).toBeNull();

    // Esc로 돌리기를 푼 자리(걸기 전 그 자리에서 Tab을 받지 못함 — 후보 하나와 같은 길): 잠근 채, 그 Tab은 초점 이동 그대로
    await hoverAt(v, AWAY);
    await hoverAt(v, MID);
    expect(key(v, 'Tab').defaultPrevented).toBe(true);
    await frames();
    expect(key(v, 'Escape').defaultPrevented).toBe(true);
    await frames();
    expect(v.measurePointCount).toBe(1);
    expect(v.measureHoverSnap!.cycle).toBeUndefined();
    expect(snap().hoverLock).toBe('tangent');
    key(v, 'Shift', true);
    await frames();
    expect(snap().lock).toBe('tangent');
    const t = key(v, 'Tab', true);
    expect(t.defaultPrevented).toBe(false);
    await frames();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'parallel', source: 'api' });
    expect(snap()).toMatchObject({ lock: 'tangent', tip: '접선 방향 · 잠금' });
    keyUp(v, 'Shift');
    await frames();
    expect(v.measureInferenceLock).toBeNull();
  });

  it('원호 밖 직선 자리(코어가 잠근 방향)는 코어 0.120.0 되돌리기 그대로', async () => {
    const { app, v, snap } = await begin();
    await hoverAt(v, LINE, false, LINE_DX);
    const list = candidates(v, LINE, LINE_DX);
    const n = list.length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(sameSnap(v.measureHoverSnap, list[0])).toBe(true);
    const hl = snap().hoverLock;
    expect(hl).not.toBeNull();
    expect(hl).not.toBe('tangent');
    key(v, 'Shift', true);
    await frames();
    expect(v.measureInferenceLock).toMatchObject({ source: 'shift' });
    expect(key(v, 'Tab', true).defaultPrevented).toBe(true);
    await frames();
    expect(v.measureInferenceLock).toBeNull();
    expect(sameSnap(v.measureHoverSnap, list[n - 1])).toBe(true);
    expect(v.measureHoverSnap!.cycle).toEqual({ index: n - 1, count: n });
    expect(app.state().measureLock).toEqual(snap());
    keyUp(v, 'Shift');
    await frames();
    expect(v.measureInferenceLock).toBeNull();
  });
});
