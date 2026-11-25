// @vitest-environment jsdom
/**
 * 109차: 측정 스냅의 두 새 선택(3D 뷰어 코어 0.115.0 inference.perpendicularDirs · 0.116.0 setMeasureSnap tabCycle)을 앱이 켜는지 실제 코어(가짜 WebGL)로.
 * - 첫 점 뒤 지나간 곧은 모서리에 수직인 방향 위 점: 코어 값이 'perpendicular'에 perpendicularDir이고, 툴팁·측정 결과 이름은 「모서리에 수직」
 *   (첫 점에서 내린 수직 발 「수직점」과 가른다 — 끌어온 점의 「끌어온 점에서 모서리에 수직」과 같은 말). Shift로 잠글 방향은 수직(잠금 이름 그대로)
 * - 마우스 미리 보기 자리에 후보가 둘 이상이면 캔버스 Tab·Shift+Tab이 후보를 돌리고(앱 창 키 듣기가 가로채지 않는다) 툴팁 이름이 코어 미리 보기 알림으로 따라온다.
 *   돌리는 중 Esc는 돌리기만 풀어 첫 후보로 돌아가고(찍은 첫 점은 그대로 — 앱이 측정을 지우지 않는다) 그 자리의 다음 Tab은 초점 이동(기본 동작 그대로)
 * - 112차(코어 0.118.0 MeasureHoverSnap.cycle): 돌린 동안만 툴팁 이름 뒤에 「i+1/n」을 붙이고 같은 글을 가상 커서 알림 영역에 넣는다.
 *   Esc로 풀거나 포인터가 그 자리를 벗어나면 전과 같은 이름만
 * 가리키는 자리는 선 위를 조금 비킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureHoverSnap } from 'opencad-viewer3d';

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

import { catalogs, translate } from '../../site/i18n.mjs';
import { NcViewerApp } from '../../src/app/app';
import { snapLabel, snapPair } from '../../src/app/measure';
import { MeasureLock, PERPENDICULAR_DIR_LABEL, snapTip, trackDirNames } from '../../src/app/measure-lock';
import { parseForView } from '../../src/app/payload';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions } from '../../src/app/refine';
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
type V3 = [number, number, number];
const unit = (v: readonly number[]): V3 => {
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n];
};
const sameDir = (a: readonly number[], b: readonly number[]): boolean => {
  const u = unit(a);
  const w = unit(b);
  return Math.abs(Math.abs(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) - 1) < 1e-4;
};
const along = (p: readonly number[], d: readonly number[], t: number): V3 => {
  const u = unit(d);
  return [p[0]! + u[0] * t + 0.07, p[1]! + u[1] * t + 0.05, p[2]! + u[2] * t];
};
const edgeDir = (e: readonly (readonly number[])[]): V3 => [e[1]![0]! - e[0]![0]!, e[1]![1]! - e[0]![1]!, e[1]![2]! - e[0]![2]!];

// 위에서 본 G-code: 기운 직선 (0,0) → (40,20), 급속 → (100,100) → (60,50). 첫 점은 마지막 급속의 끝 (60,50) — 기운 직선에서 내린 수직 발은 직선 밖
const GCODE = ['G21 G90 G17', 'G0 X0 Y0 Z0', 'G1 X40 Y20 F500', 'G0 X100 Y100', 'G0 X60 Y50', 'M2'].join('\n');
const FIRST: V3 = [60, 50, 0];
const SLANT: V3 = [2, 1, 0];
// 첫 점에서 기운 직선으로 내린 수직(첫 점 → 발) — 축을 그 직선에 수직인 평면에 비친 방향(X → (1,-2), Y → (-1,2), Z는 축이라 뺌)도 같은 선
const PERP: V3 = [1, -2, 0];

function setup() {
  const r = parseForView('perp.nc', enc(GCODE));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  v.setMeasureSnap(ncSnapOptions(r.nc!, arcCenters(r.nc!), null, (r.scene.meta as { arcAngle?: number }).arcAngle));
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const ptr = (type: string, p: readonly number[]): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[]) => {
    ptr('pointermove', p);
    v.renderNow();
    lock.update();
    return { h: v.measureHoverSnap, tip: lock.snapshot().tip, hoverLock: lock.snapshot().hoverLock };
  };
  const click = (p: readonly number[]): void => {
    hover(p);
    ptr('pointerdown', p);
    ptr('pointerup', p);
    v.renderNow();
    lock.update();
  };
  return { v, hover, click };
}

describe('109차: 첫 점에서 지나간 모서리에 수직인 방향(코어 0.115.0 perpendicularDirs)', () => {
  it('이름: perpendicularDir이면 「모서리에 수직」, 수직 발은 「수직점」 그대로(툴팁·결과 이름, 다섯 언어)', () => {
    const foot: MeasureHoverSnap = { snap: 'perpendicular', point: [1, 2, 0], direction: [0, 1, 0] };
    expect(snapTip(foot)).toEqual({ name: '수직점', locked: false });
    expect(snapTip({ ...foot, perpendicularDir: true })).toEqual({ name: PERPENDICULAR_DIR_LABEL, locked: false });
    expect(PERPENDICULAR_DIR_LABEL).toBe('모서리에 수직');
    expect(PERPENDICULAR_DIR_LABEL).not.toBe(snapLabel('perpendicular'));
    // 측정 결과(코어 결과에는 perpendicularDir이 없다 — 앱이 찍은 점 measurePoints로 이름을 붙이고 첫 화면 snapPair가 그대로 쓴다)
    expect(trackDirNames([{ snap: 'endpoint' }, { ...foot, perpendicularDir: true }])).toEqual({ nameB: PERPENDICULAR_DIR_LABEL });
    expect(trackDirNames([{ snap: 'endpoint' }, foot])).toEqual({});
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      expect(catalogs[code]![PERPENDICULAR_DIR_LABEL], code).toBeTruthy();
      expect(translate(PERPENDICULAR_DIR_LABEL, code), code).not.toBe(translate('수직점', code));
    }
    expect(translate(PERPENDICULAR_DIR_LABEL, 'en')).toBe('Perpendicular to edge');
  });

  it('G-code: 기운 직선을 지나간 뒤 첫 점에서 그에 수직인 방향 위는 「모서리에 수직」, Shift로 잠글 방향은 수직, 찍으면 결과 이름도 같다', () => {
    const { v, hover, click } = setup();
    click(FIRST);
    expect(v.measurePointCount).toBe(1);
    // 기준 선분: 커서가 지나간 기운 직선(곧은 경로 — 앱 거르기 trackDirEdge가 받는다)
    hover(along([0, 0, 0], SLANT, 20));
    const at = along(FIRST, PERP, 15);
    const g = hover(at);
    expect(g.h).toMatchObject({ snap: 'perpendicular', perpendicularDir: true });
    expect(g.h!.trackFrom).toBeUndefined();
    expect(sameDir(g.h!.direction!, PERP)).toBe(true);
    expect(sameDir(edgeDir(g.h!.edge!), SLANT)).toBe(true);
    expect(g.tip).toBe(PERPENDICULAR_DIR_LABEL);
    expect(g.hoverLock).toBe('perpendicular');
    click(at);
    expect(v.measurePointCount).toBe(2);
    const pts = v.measurePoints;
    expect(pts[1]).toMatchObject({ snap: 'perpendicular', perpendicularDir: true });
    const names = trackDirNames(pts);
    expect(names).toEqual({ nameB: PERPENDICULAR_DIR_LABEL });
    expect(snapPair({ snapA: pts[0]!.snap, snapB: pts[1]!.snap, ...names })).toEqual(['끝점', PERPENDICULAR_DIR_LABEL, false]);
  });
});

// 마우스 미리 보기 Tab: 짧은 이동(20 → 20.4)의 두 끝점과 가운데 점이 몇 화소 안에 겹친다
const SHORT = ['G21 G90 G17', 'G0 X0 Y0 Z5', 'G1 Z0 F300', 'G1 X20', 'G1 X20.4', 'G1 X60', 'G0 Z5', 'M2'].join('\n');

let shared: NcViewerApp | null = null;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const frames = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await tick();
};
type Inner = { mlock: MeasureLock };
const fresh = (app: NcViewerApp): ReturnType<MeasureLock['snapshot']> => {
  const l = (app as unknown as Inner).mlock;
  l.update();
  return l.snapshot();
};

/** 세계 점 p의 화면 자리(조금 옆)로 포인터 사건 */
function ptrAt(v: Viewer3d, type: string, p: readonly number[], dx = 1, dy = 1): void {
  const s = v.project(p)!;
  expect(s.onScreen).toBe(true);
  const e = new MouseEvent(type, { clientX: s.x + dx, clientY: s.y + dy, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  v.canvas.dispatchEvent(e);
}
async function hoverAt(v: Viewer3d, p: readonly number[]): Promise<void> {
  ptrAt(v, 'pointermove', p);
  v.renderNow();
  await frames();
}
/** 캔버스가 받은 키(창 캡처 단계의 앱 키 듣기 → 캔버스의 코어 키 듣기) */
function key(v: Viewer3d, k: string, shift = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true });
  v.canvas.dispatchEvent(e);
  return e;
}
const sameSnap = (a: MeasureHoverSnap | null, b: MeasureHoverSnap | undefined): boolean => !!a && !!b && a.snap === b.snap && a.point.every((x, i) => Math.abs(x - b.point[i]!) < 1e-9);

describe('109차: 마우스 미리 보기 자리 후보를 Tab으로 돌리기(코어 0.116.0 tabCycle)', () => {
  it('겹친 후보 자리: Tab·Shift+Tab이 후보를 돌리고 툴팁 이름이 따라오며, Esc는 돌리기만 풀고 다음 Tab은 초점 이동', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    shared = new NcViewerApp(document.getElementById('app')!);
    const app = shared;
    expect(await app.openBuffer('short.nc', enc(SHORT).buffer as ArrayBuffer)).toBe(true);
    const v = app.viewer!;
    app.toggleMeasure(true);
    await vi.waitFor(() => expect(app.state().measuring).toBe(true));
    v.setView('top', false);
    v.fit(false);
    v.renderNow();
    await frames();
    // 첫 점: 오른쪽 끝 (60,0)
    await hoverAt(v, [60, 0, 0]);
    ptrAt(v, 'pointerdown', [60, 0, 0]);
    ptrAt(v, 'pointerup', [60, 0, 0]);
    await frames();
    expect(v.measurePointCount).toBe(1);
    await hoverAt(v, [20.2, 0, 0]);
    const s = v.project([20.2, 0, 0])!;
    const list = v.measureCandidates(s.x + 1, s.y + 1);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(sameSnap(v.measureHoverSnap, list[0])).toBe(true);
    const name = (i: number): string | null => snapTip(list[i])?.name ?? null;
    expect(app.state().measureLock!.tip).toBe(name(0));
    v.canvas.focus();
    // 112차(코어 0.118.0 cycle): Tab으로 돌린 동안만 툴팁 이름 뒤 「i+1/n」, 같은 글을 가상 커서 알림 영역에(화면 읽기)
    const n = list.length;
    const live = document.querySelector('.key-live')!;
    expect(live).toBeTruthy();
    expect(v.measureHoverSnap!.cycle).toBeUndefined();
    expect(live.textContent).toBe('');

    const tab = key(v, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    await frames();
    expect(sameSnap(v.measureHoverSnap, list[1])).toBe(true);
    expect(v.measureHoverSnap!.cycle).toEqual({ index: 1, count: n });
    expect(name(1)).not.toBe(name(0));
    expect(app.state().measureLock!.tip).toBe(`${name(1)} 2/${n}`);
    expect(app.state().measureLock).toEqual(fresh(app));
    expect(live.textContent).toBe(`${name(1)} 2/${n}`);

    const back = key(v, 'Tab', true);
    expect(back.defaultPrevented).toBe(true);
    await frames();
    expect(sameSnap(v.measureHoverSnap, list[0])).toBe(true);
    expect(app.state().measureLock!.tip).toBe(`${name(0)} 1/${n}`);
    expect(live.textContent).toBe(`${name(0)} 1/${n}`);

    expect(key(v, 'Tab').defaultPrevented).toBe(true);
    await frames();
    expect(app.state().measureLock!.tip).toBe(`${name(1)} 2/${n}`);
    const esc = key(v, 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    await frames();
    // 돌리기만 풀었다 — 찍은 첫 점·측정 모드는 그대로, 툴팁은 차례·수 없이 전과 같은 글(알림은 그대로 — 칸이 없으면 알리지 않는다)
    expect(v.measurePointCount).toBe(1);
    expect(app.state().measuring).toBe(true);
    expect(sameSnap(v.measureHoverSnap, list[0])).toBe(true);
    expect(v.measureHoverSnap!.cycle).toBeUndefined();
    expect(app.state().measureLock!.tip).toBe(name(0));
    expect(live.textContent).toBe(`${name(1)} 2/${n}`);
    // 푼 뒤 그 자리의 Tab은 막지 않는다(키보드 덫이 아니다)
    expect(key(v, 'Tab').defaultPrevented).toBe(false);

    // 다시 돌린 뒤 포인터가 그 자리를 벗어나면(4화소 넘게) 칸이 없어져 툴팁에서도 차례·수가 빠진다
    await hoverAt(v, [40, 0, 0]);
    await hoverAt(v, [20.2, 0, 0]);
    expect(sameSnap(v.measureHoverSnap, list[0])).toBe(true);
    expect(key(v, 'Tab').defaultPrevented).toBe(true);
    await frames();
    expect(app.state().measureLock!.tip).toBe(`${name(1)} 2/${n}`);
    await hoverAt(v, [40, 0, 0]);
    expect(v.measureHoverSnap?.cycle).toBeUndefined();
    const away = app.state().measureLock!.tip;
    expect(away).toBe(snapTip(v.measureHoverSnap)?.name ?? null);
    expect(away ?? '').not.toMatch(/\d+\/\d+$/);
  });
});
