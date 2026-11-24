// @vitest-environment jsdom
/**
 * 97차: 재생으로 장면이 바뀐 뒤(마우스를 멈춘 채) 측정 붙잡기 툴팁이 코어의 새 미리 보기를 따르는지 — 앱(app.ts·sim.ts·measure-lock.ts)과 실제 코어(가짜 WebGL).
 * 해석 워커는 같은 스레드의 parseForView, 깎기 시뮬레이션 워커는 같은 실행기(SimRunner)를 같은 스레드에서 돌리는 가짜다.
 * 코어는 메시 바꾸기(setMesh — 0.11.0)·붙잡기 한도(setMeasureSnapLimit — 0.10.0) 뒤 다음 그림에서 마지막 커서 자리의 미리 보기를 다시 구하지만,
 * 마우스 미리 보기에는 알림이 없다(가상 커서만 'refresh' 알림 — keysnap.ts가 듣는다). 96차까지 앱은 포인터 이동·코어 측정 알림 때만 툴팁을 맞춰
 * 다음 포인터 이동까지 앞 미리 보기의 이름·자리였다.
 * - 판정: 앱이 보이는 툴팁 상태(snapshot)가 지금 코어 미리 보기로 다시 맞춘 상태(update 뒤 snapshot)와 같다
 * - 측정을 끈 재생에서는 툴팁을 맞추는 일이 없다(비용 그대로)
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
import { MOVE_ARC, MOVE_FEED } from '../../src/model';
import type { GridSpec } from '../../src/sim/grid';
import type { SimRequest } from '../../src/sim/protocol';
import { SimRunner } from '../../src/sim/runner';

/** 워커 대신: 같은 실행기를 이 스레드에서(메시지는 다음 틱에) */
class FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  private dead = false;
  private readonly runner = new SimRunner((msg) => setTimeout(() => !this.dead && this.onmessage?.({ data: msg }), 0));
  postMessage(msg: SimRequest): void {
    if (!this.dead) this.runner.handle(msg);
  }
  terminate(): void {
    this.dead = true;
  }
}

let restore: () => void;
const scroll = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('Worker', FakeWorker);
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
// 평 끝 Ø6으로 깊이 4 홈 (0,0) → (40,0), 끝에서 Y5까지 짧은 이동(소재 50 × 15, 격자 긴 변 256칸 — 조각 4 × 2).
// 첫 G0은 시작 자리를 정할 뿐 이동이 아니라 소재 위 급속(G0 Z2)을 하나 두어 깎기 전 자리(이동 0 끝)로 되감을 수 있게 한다
const GROOVE = ['G21 G90 G17', 'T1 M6 (T1 D=6. FLAT END MILL)', 'G0 X0 Y0 Z5', 'G0 Z2', 'G1 Z-4 F300', 'G1 X40', 'G1 Y5', 'G0 Z5', 'M2'].join('\n');

/** 앱 하나를 시험 사이에 다시 쓴다(앱은 창 키 듣기를 떼지 않는다) */
let shared: NcViewerApp | null = null;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** 코어 그리기(rAF)와 앱의 두 프레임 뒤 맞추기(schedule)가 끝날 때까지 */
const frames = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await tick();
};
const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const lockOf = (app: NcViewerApp): MeasureLock => (app as unknown as { mlock: MeasureLock }).mlock;
/** 지금 코어 미리 보기로 다시 맞춘 툴팁 상태 */
const fresh = (app: NcViewerApp): ReturnType<MeasureLock['snapshot']> => {
  const l = lockOf(app);
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

/** 화면 자리로 마우스 포인터 사건(코어 듣기 → 앱 듣기, 거품) */
function pointer(v: Viewer3d, type: string, p: readonly number[]): void {
  const s = v.project(p)!;
  expect(s.onScreen).toBe(true);
  const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  v.canvas.dispatchEvent(e);
}

async function hover(v: Viewer3d, p: readonly number[]): Promise<void> {
  pointer(v, 'pointermove', p);
  v.renderNow();
  await frames();
}

async function click(v: Viewer3d, p: readonly number[]): Promise<void> {
  await hover(v, p);
  pointer(v, 'pointerdown', p);
  pointer(v, 'pointerup', p);
  v.renderNow();
  await frames();
}

/** 시뮬레이션이 목표(이동 번호 — null이면 프로그램 끝)까지 깎아 장면에 올렸다(계산 중이 아님 = 워커가 보낸 마지막 답이 그 목표에 닿음) */
function simAt(app: NcViewerApp, move: number | null): boolean {
  const s = app.state().sim;
  if (!s || !s.on || !s.shown || s.computing || !s.target) return false;
  return s.target.move === (move ?? app.doc!.nc!.moves.count);
}

/** 시뮬레이션의 장면 전체 다시 올리기(16 ms 타이머)가 남았으면 그것까지 */
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 60));
  await frames();
};

/** 홈 문서를 깎기 시뮬레이션을 켜고(공구 경로는 빼고 — 소재 메시만) 프로그램 끝까지 깎은 장면으로 */
async function openGroove(): Promise<{ app: NcViewerApp; v: Viewer3d; feeds: number[] }> {
  const { app, v } = await open('groove.nc', GROOVE);
  await window.opencadApp!.setSim(true, { res: 256, paths: false });
  await until(() => simAt(app, null));
  await settle();
  const kinds = app.doc!.nc!.moves.kind;
  const feeds = [...kinds.keys()].filter((i) => kinds[i] === MOVE_FEED);
  // 내려가기·홈·짧은 이동
  expect(feeds).toHaveLength(3);
  expect(feeds[0]).toBeGreaterThan(0);
  return { app, v, feeds };
}

describe('97차: 재생으로 장면이 바뀐 뒤 마우스를 멈춘 채면 측정 툴팁이 코어의 새 미리 보기를 따른다', () => {
  it('재생 붙잡기 한도: 원호 중심 위에 멈춘 채 원호 앞으로 되감으면(중심이 빠짐) 툴팁도 거둔다', async () => {
    const { app, v } = await open('arc.nc', ARC);
    app.toggleMeasure(true);
    await vi.waitFor(() => expect(app.state().measuring).toBe(true));
    top(v);
    await hover(v, [30, 0, 0]);
    const pre = app.state().measureLock!;
    expect(v.measureHoverSnap?.snap).toBe('center');
    expect(pre.tip).toBe('중심');
    expect(pre).toEqual(fresh(app));
    // 원호 바로 앞 이동이 끝난 자리로(한 이동씩 걷기와 같은 길): 붙잡기 한도 = 원호 번호 → 그 중심은 빠진다
    const arc = app.doc!.nc!.moves.kind.indexOf(MOVE_ARC);
    expect(arc).toBeGreaterThan(0);
    app.seekMove(arc - 1);
    await frames();
    expect(v.measureSnapLimit).toBe(arc);
    const shown = app.state().measureLock!;
    const now = fresh(app);
    expect(now.tip).not.toBe('중심');
    expect(shown).toEqual(now);
  });

  it('깎기 재생 메시 바꾸기: 홈 바닥 마디 위에 멈춘 채 깎기 전으로 되감으면(소재 메시를 setMesh로) 툴팁이 새 미리 보기를 따른다', async () => {
    const { app, v, feeds } = await openGroove();
    app.toggleMeasure(true);
    await vi.waitFor(() => expect(app.state().measuring).toBe(true));
    top(v);
    // 첫 점: 깎이지 않은 소재 윗면(둘째 줄 조각 가운데 높이, 조각 가장자리·가운데 점에서 떨어진 곳 — 경계를 정확히 가리키지 않는다).
    // 측정 점이 있으면 시뮬레이션은 장면 전체 대신 늘 메시 하나씩 바꾼다(점을 지킨다)
    const g = (app as unknown as { sim: { spec: GridSpec } }).sim.spec;
    expect(g.ny - 1).toBeGreaterThan(64);
    await click(v, [g.x0 + 16 * g.dx, g.y0 + ((64 + (g.ny - 1)) / 2) * g.dy, g.top]);
    expect(v.measurePointCount).toBe(1);
    // 둘째 점을 잡는 커서: 홈 바닥(깊이 4)의 격자 마디 — 깎은 조각은 마디마다 꼭짓점
    const i = Math.round((10 - g.x0) / g.dx);
    const j = Math.round((0 - g.y0) / g.dy);
    await hover(v, [g.x0 + i * g.dx, g.y0 + j * g.dy, -4]);
    const pre = app.state().measureLock!;
    expect(pre.tip).not.toBeNull();
    expect(pre).toEqual(fresh(app));
    const up = { ...app.state().sim!.uploads };
    // 내려가기 앞 이동이 끝난 자리로 — 홈이 없어지고 그 조각은 깎이지 않은 평평한 메시(가운데 점 + 가장자리)
    app.seekMove(feeds[0]! - 1);
    await until(() => simAt(app, feeds[0]! - 1));
    await settle();
    const sim = app.state().sim!;
    expect(sim.uploads.scenes).toBe(up.scenes);
    expect(sim.uploads.meshes).toBeGreaterThan(up.meshes);
    expect(v.measurePointCount).toBe(1);
    const shown = app.state().measureLock!;
    const now = fresh(app);
    expect(now.tip).not.toBe(pre.tip);
    expect(shown).toEqual(now);
  });

  it('측정을 끈 재생은 그대로: 시뮬레이션이 메시를 바꿔도 툴팁을 맞추지 않는다', async () => {
    const { app, feeds } = await openGroove();
    expect(app.state().measuring).toBe(false);
    // 짧은 이동 앞으로 되감아 두고(끝 조각만 바뀐다)
    app.seekMove(feeds[1]!);
    await until(() => simAt(app, feeds[1]!));
    await settle();
    const lock = lockOf(app);
    const schedule = vi.spyOn(lock, 'schedule');
    const update = vi.spyOn(lock, 'update');
    try {
      const up = { ...app.state().sim!.uploads };
      app.seekMove(feeds[2]!);
      await until(() => simAt(app, feeds[2]!));
      await settle();
      const sim = app.state().sim!;
      expect(sim.uploads.scenes).toBe(up.scenes);
      expect(sim.uploads.meshes).toBeGreaterThan(up.meshes);
      expect(schedule).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    } finally {
      schedule.mockRestore();
      update.mockRestore();
    }
  });
});
