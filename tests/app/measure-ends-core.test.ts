// @vitest-environment jsdom
/**
 * 35차(코어 0.33.0 refineEnds — ncSnapOptions·panelSnapOptions가 켠다): 켠 선(끌어온 축)이 곡선을 나눈 꺾은선 꼭짓점을 화면 반 화소 안으로 지나면
 * 코어가 그 꼭짓점의 두 토막을 앱 refine('axisEdge'·open)에 물어, 곡선과의 정확한 교차가 꼭짓점에서 반 화소 넘게 떨어져 있으면 끝점보다 먼저 받는다.
 * 원호 꼭대기처럼 선이 곡선에 거의 닿듯 지나는 자리에서 34차까지는 꼭짓점(끝점)이나 축 위 커서 자리였다.
 * - G-code 원호 꼭대기(90° — 꼭짓점)를 스치는 끌어온 X축, 판재 구멍 테두리 꼭대기(꼭짓점)를 스치는 끌어온 X축: 원·테두리 위 교차
 * - 곧은 꺾은선 꼭짓점(G1 모서리·판 모서리)을 반 화소 안으로 지나는 끌어온 축: 앱이 null이라 끝점 그대로
 * - 화면 격자: 끄고·켜서 바뀐 자리는 모두 원 위·축 위의 다듬은 교차
 * 커서는 겨냥한 점에서 화면 (1, 2)화소 옆을 가리킨다(선의 경계를 정확히 가리키지 않는다)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureHoverSnap } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions } from '../../src/app/refine';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
// 원호: 중심 (20,20), 반지름 √800, 135° → 45° 시계 방향(5° 토막 18개 — 꼭대기 90°가 꼭짓점)
const ARC = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G1 X60 Y45', 'G0 X100 Y60', 'G1 X120 Y20'].join('\n');
const RA = Math.sqrt(800);
const TOP = [20, 20 + RA, 0];
// 판재: 세운 구멍(중심 (150,150), 지름 10 — 테두리 18° 토막, 꼭대기 90°가 꼭짓점)
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <hole x="150" y="150" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
 </panel>
</pgi>`;

function setup(name: string, text: string, ends: boolean) {
  const r = parseForView(name, enc(text));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const opts = r.nc ? ncSnapOptions(r.nc, arcCenters(r.nc), null, (r.scene.meta as { arcAngle?: number }).arcAngle) : panelSnapOptions(r.mpr!.snap!);
  expect(opts.refineEnds).toBe(true);
  v.setMeasureSnap(ends ? opts : { ...opts, refineEnds: false });
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const ptr = (type: string, p: readonly number[], dx: number, dy: number): void => {
    const s = v.project(p)!;
    const e = new MouseEvent(type, { clientX: s.x + dx, clientY: s.y + dy, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[], dx = 1, dy = 2): MeasureHoverSnap | null => {
    ptr('pointermove', p, dx, dy);
    v.renderNow();
    lock.update();
    return v.measureHoverSnap;
  };
  /** 첫 점 찍기(36차 잠근 선 — 그 점을 지나는 선을 잠근다) */
  const click = (p: readonly number[]): void => {
    hover(p, 0.3, 0.2);
    ptr('pointerdown', p, 0.3, 0.2);
    ptr('pointerup', p, 0.3, 0.2);
    v.renderNow();
    lock.update();
  };
  /** 위에서 본 보기: c 둘레를 1화소 ≈ w로 — 실제 1화소 길이 */
  const zoom = (c: readonly number[], w: number): number => {
    const a = v.project([c[0]! - 400 * w, c[1]! - 300 * w, c[2]!])!;
    const b = v.project([c[0]! + 400 * w, c[1]! + 300 * w, c[2]!])!;
    v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
    v.renderNow();
    const p0 = v.project(c)!;
    const p1 = v.project([c[0]! + 1, c[1]!, c[2]!])!;
    return 1 / Math.abs(p1.x - p0.x);
  };
  return { v, lock, hover, click, zoom };
}

describe('35차 refineEnds: 끌어온 축이 곡선을 나눈 꼭짓점을 반 화소 안으로 지나는 자리', () => {
  it('G-code 원호 꼭대기를 스치는 끌어온 X축: 끄면 축 위 커서 자리, 켜면 원 위 교차(꼭짓점에서 수십 화소 — 토막 안)', () => {
    const d = 0.002;
    const T = [70, TOP[1]! - d, 0];
    const xi = Math.sqrt(RA * RA - (RA - d) ** 2);
    const Q = [TOP[0]! + xi, T[1]!, 0];
    const got: Record<string, MeasureHoverSnap | null> = {};
    for (const ends of [false, true]) {
      const w = setup('a.nc', ARC, ends);
      w.v.setMeasureTrackPoints([T]);
      const px = w.zoom(TOP, 0.012);
      // 전제: 축이 꼭대기 꼭짓점을 반 화소 안으로 지나고, 원 위 교차는 꼭짓점에서 반 화소 넘게(수십 화소) 떨어져 있다
      expect(d / px).toBeLessThan(0.5);
      expect(xi / px).toBeGreaterThan(20);
      got[String(ends)] = w.hover(Q);
      w.v.dispose();
    }
    expect(got.false).toMatchObject({ snap: 'axis', axis: 'x', trackFrom: T });
    expect(got.false!.segment).toBeFalsy();
    const h = got.true!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', trackFrom: T, refined: true });
    expect(h.segment).toMatchObject({ kind: 'line' });
    expect(h.point[1]).toBe(T[1]);
    expect(h.point[2]).toBe(0);
    expect(Math.abs(Math.hypot(h.point[0] - 20, h.point[1] - 20) - RA)).toBeLessThan(1e-6);
    expect(Math.abs(h.point[0] - Q[0]!)).toBeLessThan(1e-6);
  });

  it('36차: 잠근 X·Y·임의 선이 원호 꼭짓점을 스칠 때도 — 끄면 다듬지 않은 자리, 켜면 원 위 교차(잠금 그대로)', () => {
    const d = 0.002;
    // 첫 점 = 짧은 직선 이송의 끝 F. 잠근 선이 꼭짓점 V에서 원 안쪽으로 d 떨어져 지나고, Q는 그 선과 원이 만나는 점
    const cases: { lock: 'x' | 'y' | number[]; V: number[]; F: number[]; Q: number[] }[] = [];
    {
      // 잠근 X: 꼭대기(90°)
      const xi = Math.sqrt(RA * RA - (RA - d) ** 2);
      cases.push({ lock: 'x', V: TOP, F: [110, TOP[1]! - d, 0], Q: [TOP[0]! + xi, TOP[1]! - d, 0] });
    }
    for (const [deg, lk] of [
      [180, 'y'],
      [100, 'dir'],
    ] as const) {
      // 잠근 Y: 원의 180° 자리는 이 원호 밖이라 쓰지 않는다 — 대신 같은 원을 온 원으로 그린 장면에서 왼쪽 꼭짓점
      // 임의 방향: 100° 꼭짓점의 접선과 나란히 잠근 선
      const a = (deg * Math.PI) / 180;
      const n = [Math.cos(a), Math.sin(a)];
      const t = [-Math.sin(a), Math.cos(a), 0];
      const V = [20 + RA * n[0]!, 20 + RA * n[1]!, 0];
      const P = [20 + (RA - d) * n[0]!, 20 + (RA - d) * n[1]!];
      const s = Math.sqrt(RA * RA - (RA - d) ** 2);
      cases.push({ lock: lk === 'y' ? 'y' : t, V, F: [P[0]! - 70 * t[0]!, P[1]! - 70 * t[1]!, 0], Q: [P[0]! + s * t[0]!, P[1]! + s * t[1]!, 0] });
    }
    // 온 원(중심 (20,20), 5° 토막 — 180°가 꼭짓점)과 1/4 원호
    const FULL = ['G21 G90 G17', `G0 X${(20 + RA).toFixed(6)} Y20 Z0`, `G2 X${(20 + RA).toFixed(6)} Y20 I${(-RA).toFixed(6)} J0 F500`, 'G1 X80 Y20'].join('\n');
    for (const c of cases) {
      const base = c.lock === 'x' ? ARC : FULL;
      const text = [base, `G0 X${(c.F[0]! + 1.5).toFixed(6)} Y${c.F[1]!.toFixed(6)} Z0`, `G1 X${c.F[0]!.toFixed(6)} Y${c.F[1]!.toFixed(6)}`].join('\n');
      const got: Record<string, MeasureHoverSnap | null> = {};
      let first: number[] = [];
      let dir: number[] = [];
      for (const ends of [false, true]) {
        const w = setup('a.nc', text, ends);
        w.click(c.F);
        expect(w.v.measurePoints[0]).toMatchObject({ snap: 'endpoint' });
        first = [...w.v.measurePoints[0]!.point];
        if (Array.isArray(c.lock)) expect(w.v.setMeasureInferenceLock({ direction: c.lock, kind: 'parallel' })).toBe(true);
        else w.lock.arrow(c.lock);
        dir = [...w.v.measureInferenceLock!.direction];
        const px = w.zoom(c.V, 0.012);
        expect(d / px).toBeLessThan(0.5);
        got[String(ends)] = w.hover(c.Q);
        w.v.dispose();
      }
      expect(got.false?.refined ?? false).toBe(false);
      const h = got.true!;
      expect(h, String(c.lock)).toMatchObject({ locked: true, refined: true });
      expect(h.segment).toMatchObject({ kind: 'line' });
      // 원 위, 첫 점을 지나는 잠근 선 위(F는 소수 여섯째 자리로 적어 Q에서 조금 비킨다), Q 쪽 근
      expect(Math.abs(Math.hypot(h.point[0] - 20, h.point[1] - 20) - RA)).toBeLessThan(1e-6);
      const q = [h.point[0] - first[0]!, h.point[1] - first[1]!];
      expect(Math.abs(q[0]! * dir[1]! - q[1]! * dir[0]!) / Math.hypot(dir[0]!, dir[1]!)).toBeLessThan(1e-6);
      expect(Math.hypot(h.point[0] - c.Q[0]!, h.point[1] - c.Q[1]!)).toBeLessThan(1e-3);
    }
  });

  it('판재 구멍 테두리 꼭대기를 스치는 끌어온 X축: 켜면 테두리(원) 위 교차', () => {
    const d = 0.002;
    const V = [150, 155, 18];
    const T = [190, 155 - d, 18];
    const xi = Math.sqrt(25 - (5 - d) ** 2);
    const Q = [150 + xi, T[1]!, 18];
    const got: Record<string, MeasureHoverSnap | null> = {};
    for (const ends of [false, true]) {
      const w = setup('p.pgi', PANEL, ends);
      w.v.setMeasureTrackPoints([T]);
      const px = w.zoom(V, 0.006);
      expect(d / px).toBeLessThan(0.5);
      expect(xi / px).toBeGreaterThan(15);
      got[String(ends)] = w.hover(Q);
      w.v.dispose();
    }
    expect(got.false?.refined ?? false).toBe(false);
    const h = got.true!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', trackFrom: T, refined: true });
    expect(h.segment).toMatchObject({ kind: 'edge' });
    expect(h.point[1]).toBe(T[1]);
    expect(h.point[2]).toBe(18);
    expect(Math.abs(Math.hypot(h.point[0] - 150, h.point[1] - 150) - 5)).toBeLessThan(1e-6);
  });

  it('곧은 꺾은선 꼭짓점(G1 모서리, 판 모서리)을 반 화소 안으로 지나는 끌어온 축: 켜도 끝점 그대로', () => {
    for (const [name, text, V, z] of [
      ['a.nc', ARC, [60, 40], 0],
      ['a.nc', ARC, [60, 45], 0],
      ['p.pgi', PANEL, [0, 300], 18],
    ] as const) {
      const got: (MeasureHoverSnap | null)[] = [];
      for (const ends of [false, true]) {
        const w = setup(name, text, ends);
        const P = [V[0], V[1], z];
        // 꼭짓점에서 0.2화소 옆을 지나는 X축·Y축(끌어온 점 둘)
        w.v.setMeasureTrackPoints([
          [V[0] + 40, V[1] + 0.2 * 0.01, z],
          [V[0] + 0.2 * 0.01, V[1] - 40, z],
        ]);
        // 평행 투영(원근으로 판 모서리를 크게 당기면 그 점이 눈 뒤로 넘어간다)
        w.v.setProjection('orthographic');
        expect(w.zoom(P, 0.01)).toBeCloseTo(0.01, 3);
        got.push(w.hover(P, 2, 1));
        w.v.dispose();
      }
      expect(got[0]).toMatchObject({ snap: 'endpoint', point: [V[0], V[1], z] });
      expect(got[1]).toEqual(got[0]);
    }
  });

  it('화면 격자(원호 꼭대기 둘레 15 × 15): 바뀐 자리는 모두 축 위·원 위 다듬은 교차, 그 밖은 그대로', () => {
    const d = 0.002;
    const T = [70, TOP[1]! - d, 0];
    const xi = Math.sqrt(RA * RA - (RA - d) ** 2);
    const h = 1.4 * xi;
    const grid: number[][] = [];
    for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) grid.push([TOP[0]! - h + (2 * h * i) / 14.3 + h * 0.013, TOP[1]! - h + (2 * h * j) / 14.3 + h * 0.007, 0]);
    const rows: Record<string, (MeasureHoverSnap | null)[]> = {};
    for (const ends of [false, true]) {
      const w = setup('a.nc', ARC, ends);
      w.v.setMeasureTrackPoints([T]);
      w.zoom(TOP, 0.012);
      rows[String(ends)] = grid.map((g) => w.hover(g, 0, 0));
      w.v.dispose();
    }
    let changed = 0;
    for (let i = 0; i < grid.length; i++) {
      const a = rows.false![i]!, b = rows.true![i]!;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      changed++;
      expect(b).toMatchObject({ snap: 'axis', axis: 'x', trackFrom: T, refined: true });
      expect(b.segment).toBeTruthy();
      expect(b.point[1]).toBe(T[1]);
      expect(Math.abs(Math.hypot(b.point[0] - 20, b.point[1] - 20) - RA)).toBeLessThan(1e-6);
      // 두 근(꼭대기 양옆) 가운데 하나
      expect(Math.abs(Math.abs(b.point[0] - 20) - xi)).toBeLessThan(1e-6);
      expect(['endpoint', 'axis']).toContain(a?.snap);
    }
    expect(changed).toBeGreaterThan(0);
  });
});
