// @vitest-environment jsdom
/**
 * 첫 점 나란함(코어 0.10.0 parallel — 첫 점에서 커서가 지나간 모서리와 나란한 선)의 기준 선분 거르기(31차 — 코어 0.29.0 inference.parallelEdge)를 실제 코어 판정으로.
 * 앱은 끌어온 점 나란함·수직과 같은 거르기(refine.ts trackDirEdge)를 준다: 원호 경로·구멍 테두리를 나눈 현을 지나가도 첫 점 나란함의 기준은 앞서 지나간 곧은 모서리 그대로다.
 * 거르지 않으면(30차 꼴 — parallelEdge 없음) 현이 기준이 되어 첫 점에서 그 현과 나란한 엉뚱한 방향에 '나란한 방향'으로 붙는다.
 * 곧은 모서리만 지나가면 거르기 전·후가 같다. 가리키는 자리는 선 위를 조금 비킨다.
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

// 시계 원호(중심 (20,20) R √800) (0,40) → (40,40), 직선 → (60,40) → (60,45), 급속 → (100,60), 기운 직선 → (120,20)
const GCODE = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G1 X60 Y45', 'G0 X100 Y60', 'G1 X120 Y20', 'M2'].join('\n');
const R = Math.sqrt(800);
const FIRST: V3 = [60, 45, 0];
const SLANT: V3 = [1, -2, 0];
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <hole x="150" y="150" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
  <line startX="250" startY="50" startZ="0" endX="350" endY="150" endZ="0" width="8" depth="5" direction="z-" isSaw="1" enable="1" order="2"/>
 </panel>
</pgi>`;

/** filtered: false면 30차 꼴(parallelEdge 없음 — 지나간 아무 선분이 첫 점 나란함의 기준) */
function setup(name: string, text: string, filtered: boolean) {
  const r = parseForView(name, enc(text));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const o: MeasureSnapOptions = r.nc ? ncSnapOptions(r.nc, arcCenters(r.nc), null, (r.scene.meta as { arcAngle?: number }).arcAngle) : panelSnapOptions(r.mpr!.snap!);
  const { parallelEdge: _p, ...rest } = o.inference as Record<string, unknown>;
  v.setMeasureSnap(filtered ? o : { ...o, inference: rest as MeasureSnapOptions['inference'] });
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
    return { h: v.measureHoverSnap, tip: lock.snapshot().tip };
  };
  const click = (p: readonly number[]): void => {
    hover(p);
    ptr('pointerdown', p);
    ptr('pointerup', p);
    v.renderNow();
    lock.update();
  };
  const zoom = (lo: readonly number[], hi: readonly number[]): void => {
    const a = v.project(lo)!;
    const b = v.project(hi)!;
    v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
    v.renderNow();
  };
  return { r, v, hover, click, zoom };
}

describe('첫 점 나란함의 기준 거르기(parallelEdge)', () => {
  it('앱은 끌어온 점 나란함과 같은 거르기 함수를 준다(코어가 같은 선분을 한 번만 묻는다)', () => {
    const { v } = setup('a.nc', GCODE, true);
    const inf = v.measureSnap!.inference as { parallel?: boolean; parallelEdge?: unknown; trackDirs?: { edge?: unknown } };
    expect(inf.parallel).toBe(true);
    expect(typeof inf.parallelEdge).toBe('function');
    expect(inf.parallelEdge).toBe(inf.trackDirs!.edge);
  });

  it('G-code: 기운 직선 뒤 원호의 현을 지나가도 첫 점 나란함의 기준은 기운 직선(거르지 않으면 현)', () => {
    for (const filtered of [true, false]) {
      const { r, v, hover, click } = setup('a.nc', GCODE, filtered);
      click(FIRST);
      expect(v.measurePointCount).toBe(1);
      hover([110.1, 40.1, 0]);
      // 원호(135° → 45° 시계)를 나눈 현 가운데 62° 둘레 현의 가운데(현 위 — 곡선에서 처짐만큼 안쪽). 첫 점에서 그 현과 나란한 선은 다른 경로를 비켜 간다
      const step = (90 * D) / Math.ceil((90 * D) / (r.scene.meta as { arcAngle: number }).arcAngle - 1e-9);
      const t = 135 * D - (Math.floor((73 * D) / step) + 0.5) * step;
      const chordMid: V3 = [20 + R * Math.cos(step / 2) * Math.cos(t), 20 + R * Math.cos(step / 2) * Math.sin(t), 0];
      const chordDir: V3 = [Math.sin(t), -Math.cos(t), 0];
      hover(chordMid);
      const slant = hover(along(FIRST, SLANT, -15));
      const chord = hover(along(FIRST, chordDir, 15));
      if (filtered) {
        expect(slant.h).toMatchObject({ snap: 'parallel' });
        expect(slant.h!.trackFrom).toBeUndefined();
        expect(sameDir(edgeDir(slant.h!.edge!), SLANT)).toBe(true);
        expect(slant.tip).toBe('나란한 방향');
        // 현 방향에는 붙지 않는다
        expect(chord.h?.snap === 'parallel' && !!chord.h.edge && sameDir(edgeDir(chord.h.edge), chordDir)).toBe(false);
      } else {
        expect(slant.h?.snap === 'parallel' && !!slant.h.edge && sameDir(edgeDir(slant.h.edge), SLANT)).toBe(false);
        expect(chord.h).toMatchObject({ snap: 'parallel' });
        for (const e of chord.h!.edge!) expect(Math.abs(Math.hypot(e[0]! - 20, e[1]! - 20) - R)).toBeLessThan(1e-3);
      }
    }
  });

  it('G-code: 곧은 모서리만 지나가면 거르기 전·후가 같다', () => {
    const got = [true, false].map((filtered) => {
      const { hover, click } = setup('a.nc', GCODE, filtered);
      click(FIRST);
      hover([110.1, 40.1, 0]);
      const a = hover(along(FIRST, SLANT, -15));
      return { snap: a.h?.snap, point: a.h?.point, edge: a.h?.edge, tip: a.tip };
    });
    expect(got[0]).toMatchObject({ snap: 'parallel', tip: '나란한 방향' });
    expect(got[0]).toEqual(got[1]);
  });

  it('판재: 기운 홈 모서리 뒤 구멍 테두리의 현을 지나가도 구멍 중심 첫 점의 나란함 기준은 홈 모서리', () => {
    for (const filtered of [true, false]) {
      const { v, hover, click, zoom } = setup('p.pgi', PANEL, filtered);
      zoom([100, 30, 18], [310, 200, 18]);
      click([150, 150, 18]);
      expect(v.measurePointCount).toBe(1);
      hover([296.9, 103.2, 18]);
      // 구멍 테두리(지름 10) 22.5° 둘레
      hover([150 + 5 * Math.cos(22.5 * D), 150 + 5 * Math.sin(22.5 * D), 18]);
      const g = hover(along([150, 150, 18], [1, 1, 0], 28.3));
      if (filtered) {
        expect(g.h).toMatchObject({ snap: 'parallel' });
        expect(g.h!.trackFrom).toBeUndefined();
        expect(sameDir(edgeDir(g.h!.edge!), [1, 1, 0])).toBe(true);
      } else expect(g.h?.snap === 'parallel' && !!g.h.edge && sameDir(edgeDir(g.h.edge), [1, 1, 0])).toBe(false);
    }
  });
});
