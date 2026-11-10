// @vitest-environment jsdom
/**
 * 57차: 끌어온 축이 판재 구멍 벽을 스치는 자리를 실제 코어 판정으로(판재 구멍 측정 탐색의 한 경우를 그대로 — 합성 판).
 * 판 600 × 400 × 18 위 수직 구멍 Ø15 × 3(중심 (520,100), Z 15~18). 끌어온 점 T(구멍 밖 20)의 X축이 단면에서 구멍 중심으로부터 r × 0.98을 지나
 * 벽과 M± = (520 ± √(7.5² − 7.35²), 92.65, 16.5)에서 만난다. 원근 등각(거리 60)으로 구멍 가운데를 보고 M+ 화면 자리 둘레 9 × 9(2화소 칸)를 가리킨다.
 * 코어(0.18.0 axisFaceSnap)는 그 선과 커서 아래 칸 평면의 교차를 다시 맞춰 화면 반 화소 안의 이웃 칸으로 받는데, 그 점은 칸 평면을 꼭짓점 너머로 늘인 자리라
 * 원기둥 밖이다(ρ > r). 56차까지 앱 refineFaceSnap이 원 안만 받아 그 자리는 현 위 "끌어온 점에서 X축 · 면 위"(다듬지 않음)로 남았고(이 경우 81자리 가운데 27),
 * 57차부터 원기둥 위 M+로 붙는다(57차는 접선 길이가 현 반 길이 안이면 X 쪽 근, 60차부터 코어 0.55.0 plane이 받은 칸과 다르면 두 칸의 각 범위 안 근 가운데 X에 가까운 것).
 * 60차: 같은 판 Ø8 구멍(중심 (300,100), Z 0~18)을 기운 홈 모서리와 나란한 안내 선이 반지름의 0.2 %로 스치는 자리 — 선이 받은 칸의 현을 뚫지 않고
 * 현 평면과 그 칸 밖에서 만난다(판재 구멍 측정 탐색의 스침 107곳 꼴). 57차와 같은 원기둥 위 교차에 붙는다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type SnapRefineFaceInput } from 'opencad-viewer3d';
import { defaultCamera, dirToAngles } from 'opencad-viewer3d/camera';
import { parseForView } from '../../src/app/payload';
import { MeasureLock } from '../../src/app/measure-lock';
import { panelSnapOptions, panelWalls, type PanelWall } from '../../src/app/refine';
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
/** Ø8 수직 구멍(중심 (300,100)) — 같은 지름의 수평 구멍과 벽 축으로 가른다 */
const hole8 = r.scene.meshes.find((m) => /Ø8/.test(m.name ?? '') && panelWalls(t, m.id)[0]?.a2 === 2)!;
const W8 = panelWalls(t, hole8.id)[0]!;

/** 실제 코어 뷰어(가짜 WebGL)에 판을 올리고 앱 붙잡기 선택의 refineFace 부름을 모은다 */
function viewer() {
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
  return { v, lock, calls, move };
}

/**
 * 60차: 닫힌 'axisFace' 스침 부름(코어 0.55.0 plane이 받은 칸 법선과 다름)마다 — 코어 점의 받은 칸 현 평면(기둥 축에서 r·cos 반각)까지 거리,
 * 선과 그 현 평면의 교차가 그 칸 밖인지(현을 뚫지 않음), 코어 점의 반지름
 */
function grazeCalls(calls: { c: SnapRefineFaceInput; out: readonly number[] | null | undefined }[], w: PanelWall) {
  return calls
    .filter(({ c }) => c.kind === 'axisFace' && !c.open && !!c.plane && Math.abs(c.plane.normal[0] * c.face.normal[0] + c.plane.normal[1] * c.face.normal[1] + c.plane.normal[2] * c.face.normal[2]) / Math.hypot(...c.plane.normal) < 1 - 1e-9)
    .map(({ c, out }) => {
      const l = Math.hypot(c.face.normal[0], c.face.normal[1]);
      let ux = c.face.normal[0] / l;
      let uy = c.face.normal[1] / l;
      if (ux * (c.point[0] - w.cu) + uy * (c.point[1] - w.cv) < 0) [ux, uy] = [-ux, -uy];
      const h = w.r * Math.cos(w.half);
      const off = Math.abs((c.point[0] - w.cu) * ux + (c.point[1] - w.cv) * uy - h);
      const den = c.line.dir[0] * ux + c.line.dir[1] * uy;
      const s = (h - ((c.line.origin[0] - w.cu) * ux + (c.line.origin[1] - w.cv) * uy)) / den;
      const xa = Math.atan2(c.line.origin[1] + c.line.dir[1] * s - w.cv, c.line.origin[0] + c.line.dir[0] * s - w.cu);
      const d = Math.abs(((((xa - Math.atan2(uy, ux)) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      return { c, out, off, cutOut: !(d <= w.half), rho: Math.hypot(c.point[0] - w.cu, c.point[1] - w.cv) };
    });
}

describe('57·60차: 끌어온 X축·안내 선이 구멍 벽을 스치는 자리(실제 코어 — 닫힌 코어 점이 원기둥 밖)', () => {
  it('전제: 구멍 벽 중심 (520,100)·반지름 7.5·높이 15~18, Ø8 (300,100)·반지름 4·높이 0~18', () => {
    expect([W.a2, W.cu, W.cv, W.r, W.lo, W.hi]).toEqual([2, 520, 100, 7.5, 15, 18]);
    expect([W8.cu, W8.cv, W8.r, W8.lo, W8.hi]).toEqual([300, 100, 4, 0, 18]);
  });

  it('M+ 둘레 81자리: 그 선 위 면 위 점은 모두 원기둥 위 M+(다듬음 — "끌어온 점에서 X축 · 면 위"), 원기둥 밖 코어 점을 앱이 받는다', () => {
    const { v, lock, calls, move } = viewer();
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
    // 앱이 받은 닫힌 'axisFace' 가운데 코어 점이 원기둥 밖(ρ > r)인 것은 모두 M+를 준 스침 부름이다 — 60차: 코어 plane이 받은 칸과 다르고
    // 코어 점은 받은 칸 현 평면에서 코어 tol(그 깊이 화면 반 화소) 안
    const outside = calls.filter(({ c, out }) => c.kind === 'axisFace' && !c.open && out && Math.hypot(c.point[0] - W.cu, c.point[1] - W.cv) > W.r + 1e-3);
    const graze = grazeCalls(calls, W).filter((g) => g.rho > W.r + 1e-3 && g.out && Math.abs(g.out[0]! - M[0]!) < 1e-9);
    expect(graze.length).toBeGreaterThan(0);
    expect(graze.length).toBe(outside.length);
    for (const g of graze) expect(g.off).toBeLessThanOrEqual(g.c.tol!);
    v.dispose();
  });

  it('60차: Ø8 구멍을 홈 모서리와 나란한 안내 선이 반지름의 0.2 %로 스치는 M− 둘레 81자리 — 받은 칸의 현을 뚫지 않는 스침도 그 선의 원기둥 위 교차', () => {
    // 42차 탐색 하네스의 선: 기준 홈 모서리(27°)와 나란히, 단면에서 중심으로부터 r × 0.998(보통 거리 보기의 눈 쪽 벽), 끌어온 점 T8은 M−에서 20 앞
    const g0 = [Math.cos(G), Math.sin(G)];
    let n8 = [-g0[1]!, g0[0]!];
    if (0.4 * n8[0]! - 0.8 * n8[1]! < 0) n8 = [-n8[0]!, -n8[1]!];
    const off8 = W8.r * 0.998;
    const P0 = [W8.cu + off8 * n8[0]!, W8.cv + off8 * n8[1]!, (W8.lo + W8.hi) / 2];
    const tt8 = Math.sqrt(W8.r * W8.r - off8 * off8);
    const at = (s: number) => [P0[0]! + g0[0]! * s, P0[1]! + g0[1]! * s, P0[2]!];
    const M8 = at(-tt8);
    const M8p = at(tt8);
    const T8 = at(-(tt8 + 20));
    // 기운 홈 윗모서리(가운데 선에서 왼쪽 위로 4) 가운데쯤 — 커서가 지나 나란함 기준을 잡는다
    const REF = [(150 + GE[0]!) / 2 - Math.sin(G) * 4 + 0.013, (180 + GE[1]!) / 2 + Math.cos(G) * 4 + 0.011, 18];
    const { v, lock, calls, move } = viewer();
    v.setMeasureTrackPoints([T8]);
    const sr = v.project(REF)!;
    expect(sr.onScreen).toBe(true);
    move(sr.x + 0.3, sr.y + 0.2);
    const a = dirToAngles([1, -1, 1]);
    v.setCamera({ ...defaultCamera(), yaw: a.yaw, pitch: a.pitch, target: [W8.cu, W8.cv, P0[2]!], distance: 60, projection: 'perspective' });
    v.renderNow();
    const c = v.project(M8)!;
    expect(c.onScreen).toBe(true);
    let onWall = 0;
    let onCyl = 0;
    let nearM = 0;
    for (let iy = -4; iy <= 4; iy++)
      for (let ix = -4; ix <= 4; ix++) {
        move(c.x + ix * 2 + 0.31, c.y + iy * 2 + 0.17);
        const s = v.measureHoverSnap;
        if (!s || !s.face || s.face.id !== hole8.id || !s.trackFrom || Math.hypot(s.trackFrom[0] - T8[0]!, s.trackFrom[1] - T8[1]!, s.trackFrom[2] - T8[2]!) > 1e-9) continue;
        onWall++;
        if (Math.abs(Math.hypot(s.point[0] - W8.cu, s.point[1] - W8.cv) - W8.r) < 1e-6) {
          onCyl++;
          expect(s.refined).toBe(true);
          // 그 선의 두 교차 가운데 하나(M−에서 화면 7화소 남짓 떨어진 M+ 둘레 커서도 격자에 든다) — 안내 선 방향은 기준 모서리의 float32 방향이라 27°로 셈한 M±에서 1e-4 안
          const dm = Math.min(Math.hypot(s.point[0] - M8[0]!, s.point[1] - M8[1]!, s.point[2] - M8[2]!), Math.hypot(s.point[0] - M8p[0]!, s.point[1] - M8p[1]!, s.point[2] - M8p[2]!));
          expect(dm).toBeLessThan(1e-4);
          if (Math.hypot(s.point[0] - M8[0]!, s.point[1] - M8[1]!) < 1e-4) nearM++;
          expect(lock.snapshot().tip).toBe('끌어온 점에서 모서리와 나란히 · 면 위');
        }
      }
    // 끌어온 점에서 그 구멍 벽 면 위 점은 모두 원기둥 위(60차 첫 판처럼 받은 칸 현 평면과 선의 교차만 보면 현 위로 남는다)
    expect(onWall).toBeGreaterThanOrEqual(60);
    expect(onCyl).toBe(onWall);
    expect(nearM).toBeGreaterThan(onWall / 2);
    // 스침 부름: 선이 받은 칸의 현 평면과 그 칸 밖에서 만나는(현을 뚫지 않는) 것이 있고, 모두 코어 점이 받은 칸 현 평면에서 tol 안·원기둥 위 근을 받았다
    const graze = grazeCalls(calls, W8).filter((g) => g.rho > W8.r);
    expect(graze.some((g) => g.cutOut)).toBe(true);
    for (const g of graze) {
      expect(g.off).toBeLessThanOrEqual(g.c.tol!);
      expect(g.out).toBeTruthy();
      expect(Math.abs(Math.hypot(g.out![0]! - W8.cu, g.out![1]! - W8.cv) - W8.r)).toBeLessThan(1e-9);
    }
    v.dispose();
  });
});
