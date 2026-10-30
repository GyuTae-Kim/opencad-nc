// @vitest-environment jsdom
/**
 * 축·잠근 선이 꺾은선 토막의 활꼴만 지날 때의 곡선 위 교차와 축이 아닌 잠근 선의 다듬기(22차 — 3D 뷰어 코어 0.20.0 refine 'axisEdge'의 open,
 * SnapRefineLine.axis 선택)를 실제 코어 판정으로: 해석기가 읽은 합성 G-code·PGI 장면을 진짜 Viewer3d에 올리고 앱과 같은 붙잡기 선택
 * (refine.ts ncSnapOptions·panelSnapOptions)과 잠금(MeasureLock)으로
 * - 같은 윤곽을 두 깊이로 깎는 경로: 위 점에서 끌어온 Z축이 위·아래 원호를 뚫는 점은 원 위(현과는 처짐만큼 떨어져 지나가 코어 교차가 없다 — 열린 후보)
 *   — '끌어온 점에서 Z축 · 모서리 위'. 첫 점 Z축은 첫 점에서 내린 수직 발이 같은 원 위 점이다
 * - 나선: 첫 점 Z축·끌어온 Z축·잠근 Z축이 나선을 뚫는 점은 나선 위(높이까지)
 * - 스플라인(G5): 끌어온 Z축이 곡선을 뚫는 점은 곡선 위
 * - 나란한 방향(앱이 정한 방향)으로 잠근 선이 원호와 만나는 점·원호 평면을 뚫는 점, 원호 접선으로 잠근 선이 다른 원과 만나는 점은 원 위
 * - 기울여 잠근 선이 판 외곽선 R50 벽을 뚫는 점은 원기둥 위(refineFaceSnap — 22차에 기운 직선도 푼다)
 * - 열린 후보·축이 아닌 선을 다듬지 않으면(0.19.0이 넘기던 것만) 그 밖의 자리 미리 보기는 같다
 * 머무르기는 코어의 setTimeout(0.5초)이라 횟수가 아니라 시간(0.7초)으로 기다린다. 커서는 선·경로·면 경계를 정확히 가리키지 않고 몇 화소 옆을 가리킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions, type SnapRefineFaceInput, type SnapRefineInput } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { snapPair, trackMark, trackMarks } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters, movePointAt } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions } from '../../src/app/refine';
import { ArcTangents } from '../../src/app/tangent';
import { MOVE_ARC } from '../../src/model';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

// 반지름 25 1/4 원(중심 (0,0), 0° → 90°, 5°씩 18개 현)을 Z 0과 Z −5에서 깎고 (20,15,10)으로 — (20,15)는 36.87°(현 35°→40° 가운데쯤)
const DEPTH = ['G21 G90 G17', 'G0 X25 Y0 Z0', 'G3 X0 Y25 I-25 J0 F500', 'G0 Z5', 'G0 X25 Y0', 'G1 Z-5', 'G3 X0 Y25 I-25 J0', 'G0 Z10', 'G0 X20 Y15'].join('\n');
// 나선: (25,0,0)에서 한 바퀴(G3) Z −10 — (20,15) 위 나선 높이 −10 · 36.87° / 360°
const HELIX = ['G21 G90 G17', 'G0 X25 Y0 Z0', 'G3 X25 Y0 I-25 J0 Z-10 F500', 'G0 Z10', 'G0 X20 Y15'].join('\n');
const ZH = (-10 * Math.atan2(15, 20)) / (2 * Math.PI);
// 3차 베지어 (0,0) → (40,0), 조정점 (0,20)·(40,20): t = 0.25에서 (6.25, 11.25) — 82조각의 20번 가운데쯤
const SPLINE = ['G21 G90 G17', 'G0 X0 Y0 Z0', 'G5 X40 Y0 I0 J20 P0 Q20 F500', 'G0 Z10', 'G0 X6.25 Y11.25'].join('\n');
// 같은 1/4 원 뒤 (0,25) → (30,25): 첫 점 (30,25,0)에서 (1,1) 방향 선은 원과 (20,15)에서 만난다
const QUARTER = ['G21 G90 G17', 'G0 X25 Y0 Z0', 'G3 X0 Y25 I-25 J0 F500', 'G1 X30 Y25'].join('\n');
// 같은 1/4 원 뒤 (30,25,5)로: 첫 점에서 (−10,−10,−5) 방향 선은 원 평면을 (20,15,0)에서 뚫는다
const QUARTER_UP = ['G21 G90 G17', 'G0 X25 Y0 Z0', 'G3 X0 Y25 I-25 J0 F500', 'G0 Z5', 'G0 X30 Y25'].join('\n');
// 시계 방향 1/4 원 (0,40) → (40,40)(중심 (20,20)) → (60,40), 그 뒤 원(중심 (20,70), R10 — (28,76)에서 한 바퀴). 끝 (40,40)에서 원호 쪽 접선 (−1, 1)은 그 원과 (20,60)에서 만난다
const TAN = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G0 X28 Y76', 'G2 X28 Y76 I-8 J-6'].join('\n');
// 판 400 × 300 × 18, 오른쪽 앞 모서리 R50(중심 (350,50)), 왼쪽면 수평 구멍 Ø8(y 20, z 9)
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <outlines>
   <outline x="0" y="0" bulge="0" banding="0"/>
   <outline x="350" y="0" bulge="0.41421356237309503" banding="0"/>
   <outline x="400" y="50" bulge="0" banding="0"/>
   <outline x="400" y="300" bulge="0" banding="0"/>
   <outline x="0" y="300" bulge="0" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0"/>
  </outlines>
  <hole x="0" y="20" z="9" diameter="8" depth="30" direction="x+" enable="1" order="1"/>
 </panel>
</pgi>`;

/** 0.19.0이 넘기던 것만 다듬는 붙잡기(열린 후보·축이 아닌 잠근 선은 null — 코어는 null이면 0.19.0과 같은 값) */
const legacy = (o: MeasureSnapOptions): MeasureSnapOptions => ({
  ...o,
  refine: o.refine && ((c) => (c.kind === 'axisEdge' && (c.open || !c.line?.axis) ? null : o.refine!(c))),
  ...(o.refineFace ? { refineFace: (c: SnapRefineFaceInput) => (c.line.axis ? o.refineFace!(c) : null) } : {}),
});

function setup(name: string, text: string, view: 'top' | 'seIso' = 'seIso', tweak: (o: MeasureSnapOptions) => MeasureSnapOptions = (o) => o) {
  const r = parseForView(name, enc(text));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  // 판재: 수평 구멍 그물(불투명)이 그 시작 중심(첫 점)을 가리지 않게 숨긴다
  if (r.mpr) v.setItemVisible('mpr-op-0', false);
  v.setView(view, false);
  v.fit(false);
  v.setMeasureMode(true);
  const angle = (r.scene.meta as { arcAngle?: number }).arcAngle;
  // 앱(app.ts syncMeasureSnap)과 같은 붙잡기 선택 — 코어가 다듬기를 부른 입력을 모은다
  const o = tweak(r.mpr ? panelSnapOptions(r.mpr.snap!) : ncSnapOptions(r.nc!, arcCenters(r.nc!), null, angle));
  const calls: SnapRefineInput[] = [];
  const faces: SnapRefineFaceInput[] = [];
  v.setMeasureSnap({
    ...o,
    ...(o.refine ? { refine: (c: SnapRefineInput) => (calls.push(c), o.refine!(c)) } : {}),
    ...(o.refineFace ? { refineFace: (c: SnapRefineFaceInput) => (faces.push(c), o.refineFace!(c)) } : {}),
  });
  v.renderNow();
  const tangents = new ArcTangents();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn(), ...(r.nc ? { arcTangent: (a, p) => tangents.at(r.nc!, a, p, angle) } : {}) });
  /** Shift를 누른 채인지(코어는 포인터 사건의 shiftKey가 없으면 Shift 잠금을 푼다) */
  let shift = false;
  /** 세계 점 p의 화면 자리에서 (dx, dy) 화소 옆 */
  const ptr = (type: string, p: readonly number[], dx: number, dy: number): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x + dx, clientY: s.y + dy, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, shiftKey: shift });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[], dx = 2, dy = 1): void => {
    ptr('pointermove', p, dx, dy);
    v.renderNow();
    lock.update();
  };
  const click = (p: readonly number[], dx = 1, dy = 1): void => {
    hover(p, dx, dy);
    ptr('pointerdown', p, dx, dy);
    ptr('pointerup', p, dx, dy);
    v.renderNow();
    lock.update();
  };
  /** 앱 onKey가 넘기는 길(handleKey) — 코어가 커서 아래 잠글 방향으로 잠근다 */
  const shiftDown = (): void => {
    shift = true;
    v.handleKey(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    v.renderNow();
    lock.update();
  };
  const dwell = async (p: readonly number[]): Promise<void> => {
    hover(p, 1, 1);
    await wait(700);
    v.renderNow();
  };
  /** 세계 상자(두 구석)가 화면을 채우게 */
  const zoomBox = (lo: readonly number[], hi: readonly number[]): void => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [lo[0]!, hi[0]!])
      for (const y of [lo[1]!, hi[1]!])
        for (const z of [lo[2]!, hi[2]!]) {
          const s = v.project([x, y, z])!;
          x0 = Math.min(x0, s.x);
          y0 = Math.min(y0, s.y);
          x1 = Math.max(x1, s.x);
          y1 = Math.max(y1, s.y);
        }
    v.zoomToRect(x0, y0, x1, y1, false);
    v.renderNow();
  };
  /** 그 자리 미리 보기에서 코어가 새로 부른 다듬기 입력(종류·열린 후보·축 이름) */
  const asked = (p: readonly number[]): { kind: string; open: boolean; axis: string | null }[] => {
    calls.length = 0;
    hover(p);
    return calls.map((c) => ({ kind: c.kind, open: !!c.open, axis: c.line?.axis ?? null }));
  };
  return { v, r, lock, hover, click, shiftDown, dwell, zoomBox, asked, faces };
}

describe('축이 다른 깊이의 곡선을 뚫는 점(코어 0.20.0 열린 교차, 실제 코어 판정)', () => {
  it('두 깊이 원호: 끌어온 Z축이 위·아래 원호를 뚫는 점은 원 위 — "끌어온 점에서 Z축 · 모서리 위"', async () => {
    const w = setup('d.nc', DEPTH);
    const { v, lock } = w;
    await w.dwell([20, 15, 10]);
    expect(v.measureTrackPoints).toEqual([[20, 15, 10]]);
    w.zoomBox([18, 13, -6], [22, 17, 1]);
    for (const z of [0, -5]) {
      expect(w.asked([20, 15, z])).toEqual([{ kind: 'axisEdge', open: true, axis: 'z' }]);
      const h = v.measureHoverSnap!;
      expect(h).toMatchObject({ snap: 'axis', axis: 'z', trackFrom: [20, 15, 10], refined: true, segment: { kind: 'line' } });
      expect([h.point[0], h.point[1]]).toEqual([20, 15]);
      expect(Math.abs(h.point[2] - z)).toBeLessThan(1e-12);
      expect(trackMark(h)).toBe('edge');
      expect(lock.snapshot().tip).toBe('끌어온 점에서 Z축 · 모서리 위');
    }
  });

  it('두 깊이 원호: 첫 점 Z축은 첫 점에서 내린 수직 발이 아래 원 위 점(거리 15)', () => {
    const w = setup('d.nc', DEPTH);
    const { v } = w;
    w.click([20, 15, 10]);
    expect(v.measurePoints[0]).toMatchObject({ point: [20, 15, 10], snap: 'endpoint' });
    w.zoomBox([18, 13, -6], [22, 17, 1]);
    w.hover([20, 15, -5]);
    const h = v.measureHoverSnap!;
    expect(h.refined).toBe(true);
    expect(dist(h.point, [20, 15, -5])).toBeLessThan(1e-9);
    w.click([20, 15, -5], 2, 1);
    expect(Math.abs(v.measurement()!.distance - 15)).toBeLessThan(1e-9);
  });

  it('나선: 첫 점 Z축·끌어온 Z축·잠근 Z축이 나선을 뚫는 점은 나선 위(높이까지)', async () => {
    const want = [20, 15, ZH];
    const tips: string[] = [];
    for (const mode of ['first', 'track', 'lock'] as const) {
      const w = setup('h.nc', HELIX);
      const { v, lock } = w;
      if (mode === 'track') await w.dwell([20, 15, 10]);
      else w.click([20, 15, 10]);
      if (mode === 'lock') lock.arrow('z');
      w.zoomBox([18, 13, ZH - 2], [22, 17, ZH + 2]);
      expect(w.asked(want)).toEqual([{ kind: 'axisEdge', open: true, axis: 'z' }]);
      const h = v.measureHoverSnap!;
      expect(h).toMatchObject({ snap: 'axis', axis: 'z', refined: true, segment: { kind: 'line' } });
      expect([h.point[0], h.point[1]]).toEqual([20, 15]);
      expect(Math.abs(h.point[2] - ZH)).toBeLessThan(1e-9);
      tips.push(lock.snapshot().tip!);
      if (mode === 'lock') {
        w.click(want, 2, 1);
        const m = v.measurement()!;
        expect(Math.abs(m.distance - (10 - ZH))).toBeLessThan(1e-9);
        expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', '잠근 Z축 · 모서리 위', false]);
      }
    }
    expect(tips).toEqual(['Z축 · 모서리 위', '끌어온 점에서 Z축 · 모서리 위', '잠근 Z축 · 모서리 위']);
  });

  it('스플라인(G5): 끌어온 Z축이 곡선을 뚫는 점은 곡선 위', async () => {
    const w = setup('s.nc', SPLINE);
    const { v, lock } = w;
    await w.dwell([6.25, 11.25, 10]);
    w.zoomBox([5.75, 10.75, -0.5], [6.75, 11.75, 0.5]);
    expect(w.asked([6.25, 11.25, 0])).toEqual([{ kind: 'axisEdge', open: true, axis: 'z' }]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'z', trackFrom: [6.25, 11.25, 10], refined: true });
    expect([h.point[0], h.point[1]]).toEqual([6.25, 11.25]);
    expect(Math.abs(h.point[2])).toBeLessThan(1e-9);
    expect(lock.snapshot().tip).toBe('끌어온 점에서 Z축 · 모서리 위');
  });
});

describe('축이 아닌 잠근 선의 다듬기(코어 0.20.0 — line.axis 없음, 실제 코어 판정)', () => {
  it('나란한 방향으로 잠근 선이 원호와 만나는 점은 원 위 — "잠근 나란한 방향 · 모서리 위", 거리 10√2', () => {
    const w = setup('q.nc', QUARTER, 'top');
    const { v, lock } = w;
    w.click([30, 25, 0]);
    expect(v.measurePoints[0]).toMatchObject({ point: [30, 25, 0], snap: 'endpoint' });
    expect(v.setMeasureInferenceLock({ direction: [1, 1, 0] })).toBe(true);
    w.zoomBox([18, 13, -1], [22, 17, 1]);
    expect(w.asked([20, 15, 0])).toEqual([{ kind: 'axisEdge', open: false, axis: null }]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'parallel', locked: true, refined: true, segment: { kind: 'line' } });
    expect(dist(h.point, [20, 15, 0])).toBeLessThan(1e-12);
    expect(trackMark(h)).toBe('lockEdge');
    expect(lock.snapshot().tip).toBe('잠근 나란한 방향 · 모서리 위');
    w.click([20, 15, 0], 2, 1);
    const m = v.measurement()!;
    expect(Math.abs(m.distance - 10 * Math.SQRT2)).toBeLessThan(1e-12);
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', '잠근 나란한 방향 · 모서리 위', false]);
  });

  it('Shift로 첫 점의 선분 방향에 잠근 선(나란함)이 원호와 만나는 점도 원 위', () => {
    // 첫 점 (30,25)에서 (45,40)으로 가는 선분 위를 가리키고 Shift — 그 선분 방향 (1, 1)로 잠근다(코어 0.12.0)
    const w = setup('q.nc', `${QUARTER}\nG1 X45 Y40`, 'top');
    const { v, lock } = w;
    w.click([30, 25, 0]);
    w.hover([37.5, 32.5, 0], 1, 0);
    expect(v.measureHoverLock).toMatchObject({ kind: 'parallel' });
    w.shiftDown();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'parallel', source: 'shift' });
    expect(lock.lock).toBe('parallel');
    w.zoomBox([18, 13, -1], [22, 17, 1]);
    expect(w.asked([20, 15, 0])).toEqual([{ kind: 'axisEdge', open: false, axis: null }]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'parallel', locked: true, refined: true });
    expect(dist(h.point, [20, 15, 0])).toBeLessThan(1e-9);
    expect(lock.snapshot().tip).toBe('잠근 나란한 방향 · 모서리 위');
  });

  it('비스듬히 잠근 선이 원호 평면을 뚫는 점(열린 교차)도 원 위', () => {
    const w = setup('u.nc', QUARTER_UP);
    const { v, lock } = w;
    w.click([30, 25, 5]);
    expect(v.measurePoints[0]).toMatchObject({ point: [30, 25, 5], snap: 'endpoint' });
    expect(v.setMeasureInferenceLock({ direction: [-10, -10, -5] })).toBe(true);
    w.zoomBox([18, 13, -1], [22, 17, 1]);
    expect(w.asked([20, 15, 0])).toEqual([{ kind: 'axisEdge', open: true, axis: null }]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'parallel', locked: true, refined: true });
    expect(dist(h.point, [20, 15, 0])).toBeLessThan(1e-12);
    expect(lock.snapshot().tip).toBe('잠근 나란한 방향 · 모서리 위');
  });

  it('원호 접선으로 잠근 선이 다른 원과 만나는 점은 원 위 — "잠근 접선 방향 · 모서리 위"', () => {
    const w = setup('t.nc', TAN, 'top');
    const { v, r, lock } = w;
    w.click([40.2, 40.1, 0], 0, 0);
    expect(v.measurePoints[0]).toMatchObject({ point: [40, 40, 0], snap: 'endpoint' });
    const arc = [...r.nc!.moves.kind].indexOf(MOVE_ARC);
    w.hover(movePointAt(r.nc!, arc, 0.5)!, 0, 0);
    expect(lock.hoverLock).toBe('tangent');
    expect(lock.toggle()).toBe(true);
    w.zoomBox([16, 56, -1], [24, 64, 1]);
    expect(w.asked([20, 60, 0])).toEqual([{ kind: 'axisEdge', open: false, axis: null }]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'parallel', locked: true, refined: true });
    expect(dist(h.point, [20, 60, 0])).toBeLessThan(1e-12);
    expect(lock.snapshot().tip).toBe('잠근 접선 방향 · 모서리 위');
    w.click([20, 60, 0], 2, 1);
    const m = v.measurement()!;
    expect(lock.tangentResult(m)).toBe(true);
    expect(Math.abs(m.distance - 20 * Math.SQRT2)).toBeLessThan(1e-12);
  });

  it('기울여 잠근 선이 판 외곽선 R50 벽을 뚫는 점은 원기둥 위 — "잠근 나란한 방향 · 면 위"(수평·비탈 둘 다)', () => {
    for (const dir of [[1, 0.02, 0], [1, 0.02, 0.01]]) {
      const w = setup('p.pgi', PANEL);
      const { v, lock } = w;
      w.click([0, 20.2, 9.1], 0, 0);
      expect(v.measurePoints[0]!.point).toEqual([0, 20, 9]);
      expect(v.setMeasureInferenceLock({ direction: dir })).toBe(true);
      // 정확한 답: (0,20,9) + s·e가 원기둥 |xy − (350,50)| = 50을 나가는 근
      const n = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
      const e = dir.map((x) => x / n);
      const A = e[0]! ** 2 + e[1]! ** 2;
      const B = -350 * e[0]! - 30 * e[1]!;
      const s = (-B + Math.sqrt(B * B - A * (350 ** 2 + 30 ** 2 - 2500))) / A;
      const X = [e[0]! * s, 20 + e[1]! * s, 9 + e[2]! * s];
      w.zoomBox([360, 0, 0], [400, 40, 18]);
      w.hover(X);
      const h = v.measureHoverSnap!;
      expect(h).toMatchObject({ snap: 'parallel', locked: true, refined: true, face: { id: 'mpr-board' } });
      expect(w.faces.at(-1)!.line.axis).toBeUndefined();
      expect(dist(h.point, X)).toBeLessThan(1e-9);
      expect(Math.abs(Math.hypot(h.point[0] - 350, h.point[1] - 50) - 50)).toBeLessThan(1e-9);
      expect(trackMark(h)).toBe('lockFace');
      expect(lock.snapshot().tip).toBe('잠근 나란한 방향 · 면 위');
    }
  });
});

describe('0.19.0이 넘기던 것만 다듬을 때와 같은 자리', () => {
  const view = (h: Viewer3d['measureHoverSnap']) =>
    h && { snap: h.snap, point: h.point, axis: h.axis ?? null, refined: !!h.refined, segment: h.segment ?? null, face: h.face ?? null, locked: !!h.locked, trackFrom: h.trackFrom ?? null };

  it('나선: 첫 점 전·뒤, Z축으로 잠근 뒤 열린 교차가 없는 자리는 같고, 축이 나선을 뚫는 자리만 나선 위로 바뀐다', () => {
    const before = [[25.1, 0.2, 0], [20.2, 15.1, 10], [0.3, 24.8, -2.5], [-24.9, 0.4, -5]];
    const after = [[0.3, 24.8, -2.5], [-24.9, 0.4, -5], [20, 15, 4], [24.6, 4.2, -0.2]];
    const locked = [[20, 15, 4], [20, 15, -6], [20, 15, 8]];
    const seen: unknown[][] = [[], []];
    const meet: number[][] = [];
    [setup('h.nc', HELIX), setup('h.nc', HELIX, 'seIso', legacy)].forEach((w, k) => {
      for (const p of before) {
        w.hover(p);
        seen[k]!.push(view(w.v.measureHoverSnap));
      }
      w.click([20, 15, 10]);
      for (const p of after) {
        w.hover(p);
        seen[k]!.push(view(w.v.measureHoverSnap));
      }
      w.lock.arrow('z');
      for (const p of locked) {
        w.hover(p);
        seen[k]!.push(view(w.v.measureHoverSnap));
      }
      w.zoomBox([18, 13, ZH - 2], [22, 17, ZH + 2]);
      w.hover([20, 15, ZH]);
      meet.push(w.v.measureHoverSnap!.point);
    });
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0]!.filter(Boolean).length).toBeGreaterThan(8);
    // 다듬는 쪽은 나선 위, 0.19.0 쪽은 커서에 가까운 잠근 선 위 점(나선 높이에서 벗어난다)
    expect(Math.abs(meet[0]![2]! - ZH)).toBeLessThan(1e-9);
    expect(Math.abs(meet[1]![2]! - ZH)).toBeGreaterThan(1e-4);
  });
});
