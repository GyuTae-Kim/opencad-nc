// @vitest-environment jsdom
/**
 * 끌어온 점 안내 선이 원기둥 벽 곡면만 뚫는 면의 열린 교차(34차 — 3D 뷰어 코어 0.32.0 inference.trackDirs { meets: { openFaces: true } }, 판재만)를 실제 코어 판정으로.
 * 판재 세운 구멍(지름 10, 벽 Z 6~18 — 둘레를 반각 9° 토막으로 그림)과 기운 톱 홈(27°): 홈 윗모서리를 지나간 뒤 끌어온 점 T에서 그와 나란한 안내 선이
 * 높이 12에서 벽에 거의 닿듯(축에서 4.97 — 토막 가운데 297°의 현은 축에서 5·cos 9° ≈ 4.938) 지나 삼각형은 뚫지 않고 벽 곡면만 두 번 뚫는다.
 * 코어가 앱 refineFace를 'axisFace'·open으로 불러 원기둥 위 정확한 교차점에 붙는다(이름 '… · 면 위', 잠글 방향 없음). 33차 꼴(meets { guides, open })이면 안내 선 위 커서 자리다.
 * 벽 둘레를 훑어 바뀐 자리는 모두 그 교차점이다. NC 문서(refineFace 없음)에는 주지 않는다.
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
const GROOVE = 27;
const grooveEnd = [250 + 100 * Math.cos(GROOVE * D), 50 + 100 * Math.sin(GROOVE * D)].map((x) => +x.toFixed(6));
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <hole x="150" y="150" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
  <line startX="250" startY="50" startZ="0" endX="${grooveEnd[0]}" endY="${grooveEnd[1]}" endZ="0" width="8" depth="5" direction="z-" isSaw="1" enable="1" order="2"/>
 </panel>
</pgi>`;
const DIR = [Math.cos(GROOVE * D), Math.sin(GROOVE * D), 0];
const A = (GROOVE + 270) * D;
const NRM = [Math.cos(A), Math.sin(A)];
const Z = 12;
/** 끌어온 점: 안내 선이 축에서 4.97을 지나게 */
const T = [150 + 4.97 * NRM[0]! - 20 * DIR[0]!, 150 + 4.97 * NRM[1]! - 20 * DIR[1]!, Z];
const C = [150 + 5 * NRM[0]!, 150 + 5 * NRM[1]!, Z];
/** 안내 선과 원기둥의 두 교차 각(297° ± acos(4.97/5)) */
const HALF = Math.acos(4.97 / 5);
// 홈 윗모서리(홈 가운데 선에서 왼쪽 위로 4) 가운데쯤
const REF = [(250 + grooveEnd[0]!) / 2 - Math.sin(GROOVE * D) * 4 + 0.013, (50 + grooveEnd[1]!) / 2 + Math.cos(GROOVE * D) * 4 + 0.011, 18];
const wallAt = (a: number, z: number) => [150 + 5 * Math.cos(a), 150 + 5 * Math.sin(a), z];

/** faces: false면 33차 꼴(meets: { guides: true, open: true }) */
function setup(faces: boolean) {
  const r = parseForView('p.pgi', enc(PANEL));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('seIso', false);
  v.fit(false);
  v.setMeasureMode(true);
  const o = panelSnapOptions(r.mpr!.snap!);
  const inf = o.inference as Record<string, unknown>;
  expect(inf.trackDirs).toMatchObject({ meets: { guides: true, open: true, openFaces: true } });
  const edge = (inf.trackDirs as { edge: unknown }).edge;
  v.setMeasureSnap(faces ? o : { ...o, inference: { ...inf, trackDirs: { edge, meets: { guides: true, open: true } } } as MeasureSnapOptions['inference'] });
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
    return { h: v.measureHoverSnap, tip: lock.snapshot().tip };
  };
  const zoom = (lo: readonly number[], hi: readonly number[]): void => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [lo[0]!, hi[0]!]) for (const y of [lo[1]!, hi[1]!]) for (const z of [lo[2]!, hi[2]!]) {
      const s = v.project([x, y, z])!;
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
    }
    v.zoomToRect(x0, y0, x1, y1, false);
    v.renderNow();
  };
  expect(v.setMeasureTrackPoints([T])).toBe(1);
  hover(REF);
  zoom([C[0]! - 3, C[1]! - 3, Z - 2], [C[0]! + 3, C[1]! + 3, Z + 2]);
  return { v, hover };
}

const sub = (a: readonly number[], b: readonly number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: readonly number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const offLine = (p: readonly number[], from: readonly number[], d: readonly number[]) => Math.hypot(...cross(sub(p, from), d)) / Math.hypot(d[0]!, d[1]!, d[2]!);
const onWall = (p: readonly number[]) => Math.abs(Math.hypot(p[0]! - 150, p[1]! - 150) - 5) < 1e-9 && p[2]! >= 6 && p[2]! <= 18;

describe('끌어온 점 안내 선의 면의 열린 교차(판재 구멍 벽, 실제 코어 판정)', () => {
  it('벽에 거의 닿듯 지나는 안내 선: 원기둥 위 교차점에 붙고, 33차 꼴은 안내 선 위 커서 자리', () => {
    // 첫 교차(297° − HALF) 둘레의 벽 위 자리 — 교차점에서 조금 비킨다
    const at = wallAt(A - HALF + 0.3 * D, Z + 0.04);
    const now = setup(true);
    const r = now.hover(at);
    const h = r.h!;
    expect(h).toMatchObject({ snap: 'parallel', trackFrom: T, refined: true });
    expect(h.face).toBeDefined();
    expect(h.segment).toBeUndefined();
    expect(onWall(h.point)).toBe(true);
    expect(h.point[2]).toBeCloseTo(Z, 9);
    // 안내 선은 홈 그물 윗모서리(기준 선분 — 단정밀도 꼭짓점)와 나란하다
    expect(offLine(h.point, T, sub(h.edge![1], h.edge![0]))).toBeLessThan(1e-9);
    expect(Math.hypot(...sub(h.point, wallAt(A - HALF, Z)))).toBeLessThan(1e-3);
    expect(h.direction).toBeUndefined();
    expect(r.tip).toBe('끌어온 점에서 모서리와 나란히 · 면 위');
    now.v.dispose();
    const old = setup(false);
    const o = old.hover(at);
    expect(o.h?.face).toBeUndefined();
    expect(o.h && Math.hypot(...sub(o.h.point, h.point))).toBeGreaterThan(1e-4);
    old.v.dispose();
  });

  it('벽 둘레를 훑으면 바뀐 자리는 모두 안내 선 위·원기둥 위 교차점(두 곳)이다', () => {
    const grid: number[][] = [];
    for (let i = 0; i < 13; i++) for (let j = 0; j < 9; j++) grid.push(wallAt(A - 13 * D + (26 * D * i) / 12.3 + 0.013 * D, Z - 1.2 + (2.4 * j) / 8.3 + 0.007));
    const rows = [true, false].map((faces) => {
      const w = setup(faces);
      const out = grid.map((g) => {
        const h = w.hover(g).h;
        return h ? { snap: h.snap ?? null, p: [...h.point], face: !!h.face, from: !!h.trackFrom, refined: !!h.refined, dir: !!h.direction, seg: !!h.segment, edge: h.edge } : null;
      });
      w.v.dispose();
      return out;
    });
    const [now, old] = rows as [typeof rows[0], typeof rows[0]];
    const changed = now.map((x, i) => [x, old[i]] as const).filter(([x, y]) => JSON.stringify(x) !== JSON.stringify(y));
    expect(changed.length).toBeGreaterThan(3);
    const points = new Set<string>();
    for (const [x] of changed) {
      expect(x).toMatchObject({ snap: 'parallel', face: true, from: true, refined: true, dir: false, seg: false });
      expect(onWall(x!.p)).toBe(true);
      expect(offLine(x!.p, T, sub(x!.edge![1]!, x!.edge![0]!))).toBeLessThan(1e-9);
      points.add(x!.p.map((q) => q.toFixed(5)).join(','));
    }
    expect(points.size).toBeLessThanOrEqual(2);
  });

  it('NC 문서에는 면의 열린 교차를 주지 않는다(refineFace가 없다)', () => {
    const r = parseForView('a.nc', enc(['G21 G90 G17', 'G0 X0 Y0 Z0', 'G1 X40 Y20 F500', 'M2'].join('\n')));
    const o = ncSnapOptions(r.nc!, arcCenters(r.nc!));
    expect(o.refineFace).toBeUndefined();
    expect((o.inference as { trackDirs: { meets: unknown } }).trackDirs.meets).toEqual({ guides: true, open: true });
  });
});
