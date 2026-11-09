// @vitest-environment jsdom
/**
 * 55차(코어 0.39.0 refineSnapToExact — panelSnapOptions가 켠다): 끌어온 X축이 세운 구멍(지름 10·깊이 12) 벽 칸을 얕게 뚫는 교차를 구멍 안에서 보면,
 * 커서가 그물 교차 X 쪽인 자리가 현 위 "면 위"(다듬지 않음)에서 같은 선의 원기둥 위 교차로 옮겨진다(42차 측정 탐색 하네스의 합성 판 한 경우).
 * - 앱 선택은 판재만 켜고(ncSnapOptions는 주지 않음), 끈 판과 켠 판을 같은 화면 격자로 견준다
 * - 바뀐 자리는 모두 끈 판의 현 위 "면 위"(그 선 위·구멍 그물 면 위·원기둥 위 아님)에서 그 선 위·원기둥 위·다듬은 점으로, 그 밖의 자리는 같다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureHoverSnap } from 'opencad-viewer3d';
import { defaultCamera, dirToAngles } from 'opencad-viewer3d/camera';
import { parseForView } from '../../src/app/payload';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions, panelWalls } from '../../src/app/refine';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

type V3 = [number, number, number];
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="600" width="400" thickness="18" name="p" quantity="1">
  <hole x="100" y="100" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
 </panel>
</pgi>`;

describe('55차 refineSnapToExact: 판재 구멍 벽을 얕게 뚫는 끌어온 X축의 교차', () => {
  it('앱 선택은 판재만 켠다', () => {
    const r = parseForView('p.pgi', new TextEncoder().encode(PANEL));
    expect(panelSnapOptions(r.mpr!.snap!).refineSnapToExact).toBe(true);
    const g = parseForView('a.nc', new TextEncoder().encode('G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG2 X20 Y0 I10 J0\nM30'));
    expect(ncSnapOptions(g.nc!, arcCenters(g.nc!)).refineSnapToExact).toBeUndefined();
  });

  it('구멍 안 거리 3·4에서 커서가 그물 교차 쪽인 현 위 "면 위"가 같은 선의 원기둥 위 교차로, 그 밖은 같다', () => {
    const r = parseForView('p.pgi', new TextEncoder().encode(PANEL));
    const t = r.mpr!.snap!;
    const mesh = r.scene.meshes.find((m) => /드릴/.test(m.name ?? ''))!;
    const w = panelWalls(t, mesh.id)[0]!;
    expect(w.a2).toBe(2);
    expect(w.r).toBeCloseTo(5, 9);
    // 끌어온 X축: 단면에서 축으로부터 r × (1 − 0.06)를 지나 벽과 두 점 M±에서 만난다(42차 하네스 lineFor — 보통 거리 보기 쪽 벽)
    const off = w.r * 0.94;
    const P0: V3 = [w.cu, w.cv - off, (w.lo + w.hi) / 2];
    const tt = Math.sqrt(w.r * w.r - off * off);
    const M: V3 = [P0[0] + tt, P0[1], P0[2]];
    const T: V3 = [P0[0] - tt - 20, P0[1], P0[2]];
    let changed = 0;
    for (const d of [3, 4]) {
      const rows: Record<string, (MeasureHoverSnap | null)[]> = {};
      for (const exact of [false, true]) {
        document.body.innerHTML = '';
        const host = document.createElement('div');
        document.body.append(host);
        const v = new Viewer3d(host, { animate: false });
        v.setScene(r.scene);
        v.setView('seIso', false);
        v.fit(false);
        v.setMeasureMode(true);
        const o = panelSnapOptions(t);
        v.setMeasureSnap(exact ? o : { ...o, refineSnapToExact: false });
        const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
        v.setMeasureTrackPoints([T]);
        // 구멍 안에서 M을 보는 방향: 단면에서 축 쪽 + 입구 쪽 0.3(하네스 inward)
        const a = dirToAngles([-(M[0] - w.cu) / w.r, -(M[1] - w.cv) / w.r, 0.3]);
        v.setCamera({ ...defaultCamera(), yaw: a.yaw, pitch: a.pitch, target: [...M], distance: d, projection: 'perspective' });
        v.renderNow();
        const c = v.project(M)!;
        expect(c.onScreen).toBe(true);
        const got: (MeasureHoverSnap | null)[] = [];
        for (let iy = -4; iy <= 4; iy++)
          for (let ix = -4; ix <= 4; ix++) {
            const e = new MouseEvent('pointermove', { clientX: c.x + ix * 2 + 0.31, clientY: c.y + iy * 2 + 0.17, bubbles: true, cancelable: true });
            Object.defineProperty(e, 'pointerId', { value: 1 });
            Object.defineProperty(e, 'pointerType', { value: 'mouse' });
            v.canvas.dispatchEvent(e);
            v.renderNow();
            lock.update();
            got.push(v.measureHoverSnap);
          }
        rows[String(exact)] = got;
        v.dispose();
      }
      const onLine = (p: readonly number[]): boolean => Math.abs(p[1]! - T[1]) < 1e-6 && Math.abs(p[2]! - T[2]) < 1e-6;
      const onCyl = (p: readonly number[]): boolean => Math.abs(Math.hypot(p[0]! - w.cu, p[1]! - w.cv) - w.r) < 1e-6;
      for (let i = 0; i < 81; i++) {
        const a = rows.false![i]!, b = rows.true![i]!;
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
        changed++;
        // 끈 판: 그 선 위·구멍 그물 면 위·원기둥 위 아님·다듬지 않음(현 위 "면 위")
        expect(a.face?.id, `${d} ${i}`).toBe(mesh.id);
        expect(a.refined ?? false).toBe(false);
        expect(onLine(a.point)).toBe(true);
        expect(onCyl(a.point)).toBe(false);
        // 켠 판: 같은 선의 원기둥 위 교차(M 쪽 근)이고 다듬은 점
        expect(b).toMatchObject({ refined: true, trackFrom: T });
        expect(onLine(b.point)).toBe(true);
        expect(onCyl(b.point)).toBe(true);
        expect(Math.hypot(b.point[0] - M[0], b.point[1] - M[1], b.point[2] - M[2])).toBeLessThan(1e-4);
      }
    }
    expect(changed).toBeGreaterThan(0);
  });
});
