// @vitest-environment jsdom
/**
 * 끌어온 점 안내 선(나란한 선·수직인 선)의 열린 교차(33차 — 3D 뷰어 코어 0.31.0 inference.trackDirs { meets: { open: true } })를 실제 코어 판정으로.
 * 안내 선이 곡선을 나눈 토막과 3D로 만나지 않고 그 활꼴(현과 곡선 사이)만 지나는 자리에서 코어가 앱 refine을 'axisEdge'·open으로 불러 곡선 위 교차점에 붙는다.
 * - G-code 두 깊이 사분원(반지름 25, Z 0·−5) + 경사 진입 (40,0,0) → (43,4,−5): 진입을 지나간 뒤 끌어온 점 T에서 진입과 나란한 안내 선이
 *   아래 원호 평면을 47.5°(토막 가운데 — 현에서 처짐만큼 떨어진 곡선 위)에서 뚫는다. 32차 꼴(meets: { guides: true })이면 그 자리는 안내 선 위 커서 자리다
 * - 판재 구멍 테두리(지름 10): 기운 톱 홈(32.5°) 윗모서리를 지나간 뒤 그와 나란한 안내 선이 테두리에 거의 닿듯(중심 쪽으로 0.002) 지나 한 토막 활꼴을 두 번 지난다
 * - 이름은 0.29.0 만나는 점과 같은 '끌어온 점에서 모서리와 나란히 · 모서리 위', 첫 점을 지나는 선이 아니라 잠글 방향이 없다
 * 끌어온 점은 setMeasureTrackPoints로 준다. 커서는 교차점에서 조금 비킨 빈 곳을 가리킨다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions } from 'opencad-viewer3d';
import { MeasureLock } from '../../src/app/measure-lock';
import { parseForView } from '../../src/app/payload';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions } from '../../src/app/refine';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const D = Math.PI / 180;
const RAMP = ['G21 G90 G17', 'G0 X25 Y0 Z0', 'G3 X0 Y25 I-25 J0 F500', 'G0 Z5', 'G0 X25 Y0', 'G1 Z-5', 'G3 X0 Y25 I-25 J0', 'G0 Z10', 'G0 X40 Y0 Z0', 'G1 X43 Y4 Z-5', 'G0 Z10', 'M2'].join('\n');
/** 아래 원호 위 47.5°와 그곳으로 진입 방향 (3,4,−5)을 거슬러 Z 0까지 간 끌어온 점 */
const Q = [25 * Math.cos(47.5 * D), 25 * Math.sin(47.5 * D), -5];
const T = [Q[0]! - 3, Q[1]! - 4, 0];
const GROOVE = 32.5;
const grooveEnd = [250 + 100 * Math.cos(GROOVE * D), 50 + 100 * Math.sin(GROOVE * D)].map((x) => +x.toFixed(6));
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <hole x="150" y="150" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
  <line startX="250" startY="50" startZ="0" endX="${grooveEnd[0]}" endY="${grooveEnd[1]}" endZ="0" width="8" depth="5" direction="z-" isSaw="1" enable="1" order="2"/>
 </panel>
</pgi>`;

/** open: false면 32차 꼴(meets: { guides: true }) */
function setup(name: string, text: string, view: 'top' | 'seIso', open: boolean) {
  const r = parseForView(name, enc(text));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView(view, false);
  v.fit(false);
  v.setMeasureMode(true);
  const o = r.nc ? ncSnapOptions(r.nc, arcCenters(r.nc), null, (r.scene.meta as { arcAngle?: number }).arcAngle) : panelSnapOptions(r.mpr!.snap!);
  const inf = o.inference as Record<string, unknown>;
  expect(inf.trackDirs).toMatchObject({ meets: { guides: true, open: true } });
  const edge = (inf.trackDirs as { edge: unknown }).edge;
  v.setMeasureSnap(open ? o : { ...o, inference: { ...inf, trackDirs: { edge, meets: { guides: true } } } as MeasureSnapOptions['inference'] });
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const hover = (p: readonly number[]) => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent('pointermove', { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
    v.renderNow();
    lock.update();
    return { h: v.measureHoverSnap, tip: lock.snapshot().tip, hoverLock: v.measureHoverLock };
  };
  /** 세계 상자 lo~hi가 화면을 채우게 당긴다 */
  const zoom = (lo: readonly number[], hi: readonly number[]): void => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [lo[0]!, hi[0]!]) for (const y of [lo[1]!, hi[1]!]) for (const z of [lo[2]!, hi[2]!]) {
      const s = v.project([x, y, z])!;
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
    }
    v.zoomToRect(x0, y0, x1, y1, false);
    v.renderNow();
  };
  return { v, hover, zoom };
}

const sub = (a: readonly number[], b: readonly number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: readonly number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
/** 점 p가 from을 지나는 방향 d 직선에서 떨어진 거리 */
const offLine = (p: readonly number[], from: readonly number[], d: readonly number[]) => Math.hypot(...cross(sub(p, from), d)) / Math.hypot(d[0]!, d[1]!, d[2]!);

describe('끌어온 점 안내 선의 열린 교차(실제 코어 판정)', () => {
  it('두 깊이 원호: 경사 진입과 나란한 안내 선이 아래 원호 평면을 뚫는 곡선 위 점에 붙고, 32차 꼴은 안내 선 위 커서 자리', () => {
    const ramp = [41.51, 2.02, -2.52];
    // 교차점 Q에서 조금 비킨 커서(아래 원호 평면 위 — 빈 곳)
    const at = [Q[0]! + 0.03, Q[1]! - 0.02, -5];
    const run = (open: boolean) => {
      const w = setup('r.nc', RAMP, 'seIso', open);
      expect(w.v.setMeasureTrackPoints([T])).toBe(1);
      w.hover(ramp);
      w.zoom([Q[0]! - 5, Q[1]! - 5, -5], [Q[0]! + 5, Q[1]! + 5, -5]);
      const r = w.hover(at);
      w.v.dispose();
      return r;
    };
    const now = run(true);
    const h = now.h!;
    expect(h).toMatchObject({ snap: 'parallel', trackFrom: T, refined: true });
    expect(h.segment).toMatchObject({ kind: 'line' });
    // 곡선(반지름 25, Z −5) 위 정확한 교차 — 안내 선 위
    expect(Math.abs(Math.hypot(h.point[0], h.point[1]) - 25)).toBeLessThan(1e-9);
    expect(Math.abs(h.point[2] + 5)).toBeLessThan(1e-9);
    expect(offLine(h.point, T, [3, 4, -5])).toBeLessThan(1e-9);
    expect(Math.hypot(...sub(h.point, Q))).toBeLessThan(1e-6);
    // 기준 선분은 경사 진입, 첫 점을 지나는 선이 아니라 방향이 없다
    expect(h.edge).toEqual([[40, 0, 0], [43, 4, -5]]);
    expect(h.direction).toBeUndefined();
    expect(now.tip).toBe('끌어온 점에서 모서리와 나란히 · 모서리 위');
    // 32차 꼴: 같은 자리가 안내 선 위 커서 자리(곡선 위가 아니다)
    const old = run(false);
    expect(old.h).toMatchObject({ snap: 'parallel', trackFrom: T });
    expect(old.h!.segment).toBeUndefined();
    expect(Math.hypot(...sub(old.h!.point, h.point))).toBeGreaterThan(1e-4);
    expect(old.tip).toBe('끌어온 점에서 모서리와 나란히');
  });

  it('구멍 테두리: 기운 홈 모서리와 나란한 안내 선이 테두리에 거의 닿듯 지나면 한 토막 활꼴의 곡선 위 교차점에 붙는다', () => {
    const n = [Math.cos((GROOVE + 90) * D), Math.sin((GROOVE + 90) * D)];
    const dir = [Math.cos(GROOVE * D), Math.sin(GROOVE * D), 0];
    const P0 = [150 + 4.998 * n[0]!, 150 + 4.998 * n[1]!];
    const TP = [P0[0]! - 20 * dir[0]!, P0[1]! - 20 * dir[1]!, 18];
    const C = [150 + 5 * n[0]!, 150 + 5 * n[1]!];
    // 홈 윗모서리(홈 가운데 선에서 왼쪽 위로 4) 가운데쯤을 지나 기준으로
    const ref = [(250 + grooveEnd[0]!) / 2 - Math.sin(GROOVE * D) * 4 + 0.013, (50 + grooveEnd[1]!) / 2 + Math.cos(GROOVE * D) * 4 + 0.011, 18];
    const at = [C[0]! - 0.123, C[1]! - 0.084, 18];
    const run = (open: boolean) => {
      const w = setup('p.pgi', PANEL, 'top', open);
      expect(w.v.setMeasureTrackPoints([TP])).toBe(1);
      w.hover(ref);
      w.zoom([C[0]! - 1.2, C[1]! - 0.9, 18], [C[0]! + 1.2, C[1]! + 0.9, 18]);
      const r = w.hover(at);
      w.v.dispose();
      return r;
    };
    const now = run(true);
    const h = now.h!;
    expect(h).toMatchObject({ snap: 'parallel', trackFrom: TP, refined: true });
    expect(h.segment).toMatchObject({ kind: 'edge' });
    expect(Math.abs(Math.hypot(h.point[0] - 150, h.point[1] - 150) - 5)).toBeLessThan(1e-9);
    expect(h.point[2]).toBeCloseTo(18, 9);
    // 안내 선은 그물 윗모서리(기준 선분 — 단정밀도 꼭짓점)와 나란하다
    expect(offLine(h.point, TP, sub(h.edge![1], h.edge![0]))).toBeLessThan(1e-9);
    expect(offLine(h.point, TP, dir)).toBeLessThan(1e-5);
    expect(h.direction).toBeUndefined();
    expect(now.tip).toBe('끌어온 점에서 모서리와 나란히 · 모서리 위');
    const old = run(false);
    expect(old.h).toMatchObject({ snap: 'parallel', trackFrom: TP });
    expect(old.h!.segment).toBeUndefined();
    expect(Math.hypot(...sub(old.h!.point, h.point))).toBeGreaterThan(1e-4);
  });
});
