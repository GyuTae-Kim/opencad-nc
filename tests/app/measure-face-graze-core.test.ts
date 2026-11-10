// @vitest-environment jsdom
/**
 * 57차: 끌어온 축이 판재 구멍 벽을 스치는 자리를 실제 코어 판정으로(판재 구멍 측정 탐색의 한 경우를 그대로 — 합성 판).
 * 판 600 × 400 × 18 위 수직 구멍 Ø15 × 3(중심 (520,100), Z 15~18). 끌어온 점 T(구멍 밖 20)의 X축이 단면에서 구멍 중심으로부터 r × 0.98을 지나
 * 벽과 M± = (520 ± √(7.5² − 7.35²), 92.65, 16.5)에서 만난다. 원근 등각(거리 60)으로 구멍 가운데를 보고 M+ 화면 자리 둘레 9 × 9(2화소 칸)를 가리킨다.
 * 코어(0.18.0 axisFaceSnap)는 그 선과 커서 아래 칸 평면의 교차를 다시 맞춰 화면 반 화소 안의 이웃 칸으로 받는데, 그 점은 칸 평면을 꼭짓점 너머로 늘인 자리라
 * 원기둥 밖이다(ρ > r). 56차까지 앱 refineFaceSnap이 원 안만 받아 그 자리는 현 위 "끌어온 점에서 X축 · 면 위"(다듬지 않음)로 남았고(이 경우 81자리 가운데 27),
 * 57차부터 접선 길이가 현 반 길이 안이면 X 쪽 근을 줘 원기둥 위 M+로 붙는다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type SnapRefineFaceInput } from 'opencad-viewer3d';
import { defaultCamera, dirToAngles } from 'opencad-viewer3d/camera';
import { parseForView } from '../../src/app/payload';
import { MeasureLock } from '../../src/app/measure-lock';
import { panelSnapOptions, panelWalls } from '../../src/app/refine';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const G = (27 * Math.PI) / 180;
const GE = [150 + 100 * Math.cos(G), 180 + 100 * Math.sin(G)].map((x) => +x.toFixed(6));
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="600" width="400" thickness="18" name="p" quantity="1">
  <hole x="100" y="100" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
  <hole x="200" y="100" z="0" diameter="5" depth="10" direction="z-" enable="1" order="2"/>
  <hole x="300" y="100" z="0" diameter="8" depth="18" direction="z-" enable="1" order="3"/>
  <hole x="420" y="120" z="0" diameter="35" depth="12.5" direction="z-" enable="1" order="4"/>
  <hole x="520" y="100" z="0" diameter="15" depth="3" direction="z-" enable="1" order="5"/>
  <hole x="0" y="250" z="9" diameter="8" depth="30" direction="x+" enable="1" order="6"/>
  <hole x="0" y="320" z="9" diameter="5" depth="12" direction="x+" enable="1" order="7"/>
  <line startX="150" startY="180" startZ="0" endX="${GE[0]}" endY="${GE[1]}" endZ="0" width="8" depth="5" direction="z-" isSaw="1" enable="1" order="8"/>
 </panel>
</pgi>`;
const r = parseForView('p.pgi', new TextEncoder().encode(PANEL));
const t = r.mpr!.snap!;
const hole = r.scene.meshes.find((m) => /Ø15/.test(m.name ?? ''))!;
const W = panelWalls(t, hole.id)[0]!;
const off = W.r * 0.98;
const tt = Math.sqrt(W.r * W.r - off * off);
const Y = W.cv - off;
const Z = (W.lo + W.hi) / 2;
const M = [W.cu + tt, Y, Z];
const T = [W.cu - tt - 20, Y, Z];

describe('57차: 끌어온 X축이 구멍 벽을 스치는 자리(실제 코어 — 닫힌 코어 점이 원기둥 밖)', () => {
  it('전제: 구멍 벽 중심 (520,100)·반지름 7.5·높이 15~18', () => {
    expect([W.a2, W.cu, W.cv, W.r, W.lo, W.hi]).toEqual([2, 520, 100, 7.5, 15, 18]);
  });

  it('M+ 둘레 81자리: 그 선 위 면 위 점은 모두 원기둥 위 M+(다듬음 — "끌어온 점에서 X축 · 면 위"), 원기둥 밖 코어 점을 앱이 받는다', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    const v = new Viewer3d(host, { animate: false });
    v.setScene(r.scene);
    v.setView('seIso', false);
    v.fit(false);
    v.setMeasureMode(true);
    const so = panelSnapOptions(t);
    const calls: { c: SnapRefineFaceInput; out: readonly number[] | null | undefined }[] = [];
    v.setMeasureSnap({ ...so, refineFace: (c) => { const out = so.refineFace!(c); calls.push({ c, out }); return out; } });
    v.renderNow();
    const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
    const move = (x: number, y: number): void => {
      const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      v.canvas.dispatchEvent(e);
      v.renderNow();
      lock.update();
    };
    v.setMeasureTrackPoints([T]);
    const a = dirToAngles([1, -1, 1]);
    v.setCamera({ ...defaultCamera(), yaw: a.yaw, pitch: a.pitch, target: [W.cu, W.cv, Z], distance: 60, projection: 'perspective' });
    v.renderNow();
    const c = v.project(M)!;
    expect(c.onScreen).toBe(true);
    let onLine = 0;
    let onCyl = 0;
    for (let iy = -4; iy <= 4; iy++)
      for (let ix = -4; ix <= 4; ix++) {
        move(c.x + ix * 2 + 0.31, c.y + iy * 2 + 0.17);
        const s = v.measureHoverSnap;
        if (!s || !s.face || !s.trackFrom || Math.hypot(s.trackFrom[0] - T[0]!, s.trackFrom[1] - T[1]!, s.trackFrom[2] - T[2]!) > 1e-9) continue;
        if (Math.abs(s.point[1] - Y) > 1e-9 || Math.abs(s.point[2] - Z) > 1e-9) continue;
        onLine++;
        const rad = Math.hypot(s.point[0] - W.cu, s.point[1] - W.cv);
        if (Math.abs(rad - W.r) < 1e-6 && s.face.id === hole.id) {
          onCyl++;
          expect(s.refined).toBe(true);
          expect(Math.abs(s.point[0] - M[0]!)).toBeLessThan(1e-9);
          expect(lock.snapshot().tip).toBe('끌어온 점에서 X축 · 면 위');
        }
      }
    // 그 선 위 면 위 점은 모두 원기둥 위(56차까지는 27자리가 현 위)
    expect(onLine).toBeGreaterThanOrEqual(27);
    expect(onCyl).toBe(onLine);
    // 앱이 받은 닫힌 'axisFace' 가운데 코어 점이 원기둥 밖(ρ > r)이고 M+를 준 것
    const graze = calls.filter(({ c, out }) => c.kind === 'axisFace' && !c.open && Math.hypot(c.point[0] - W.cu, c.point[1] - W.cv) > W.r + 1e-3 && out && Math.abs(out[0]! - M[0]!) < 1e-9);
    expect(graze.length).toBeGreaterThan(0);
    for (const { c } of graze) expect(Math.sqrt(Math.hypot(c.point[0] - W.cu, c.point[1] - W.cv) ** 2 - W.r ** 2)).toBeLessThan(W.r * Math.sin(W.half));
    v.dispose();
  });
});
