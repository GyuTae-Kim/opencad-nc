// @vitest-environment jsdom
/**
 * 29차(3D 뷰어 코어 0.27.0 setItemPickThrough): 판재 포켓·홈 그물의 뚜껑(들어가는 판 면 자리의 끝면)만 판 너머 고르기에서 지나간다.
 * 앱(app.ts applyDoc)처럼 doc.ts boardThrough의 그물을 고르기 불투명으로 켜고 boardLid(해석기 meta.lids)를 준 뒤, 진짜 Viewer3d(가짜 WebGL)로
 * - 판 위에서 포켓 바닥·안쪽 벽, 바닥에 뚫은 구멍 기둥 벽을 잰다(28차는 포켓 윗면 높이 18에서 멈췄다 — lid = false로 견준다)
 * - 첫 점의 X축이 판 위에서 들여다본 포켓 안쪽 벽을 뚫는 점
 * - 윤곽선(포켓 위 테두리)·포켓 바깥의 판 위·바깥에서 본 벽은 28차와 같은 값, 그림 겉모습(투명도·색)과 그물은 그대로
 * - 보기에서 누르기(앱 전체): 포켓 바닥 구멍을 위에서 누르면 그 구멍(28차는 포켓·구멍 윗면이 같은 높이라 장면 차례대로 포켓), 포켓 바닥은 포켓, 홈은 홈
 * 화면 자리는 그물 경계·윤곽선·삼각형 모서리를 정확히 가리키지 않는다(16차 — Node 판마다 마지막 자리 반올림이 다르다).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions } from 'opencad-viewer3d';
import { boardLid, boardThrough } from '../../src/app/doc';
import { parseForView } from '../../src/app/payload';
import { MeasureLock } from '../../src/app/measure-lock';
import { panelSnapOptions } from '../../src/app/refine';
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

import { NcViewerApp } from '../../src/app/app';

let restore: () => void;
const scroll = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  Element.prototype.scrollIntoView = () => {};
});
afterAll(() => {
  restore();
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
});

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const D = Math.PI / 180;

// 판 400 × 300 × 18: 가공 1 윗면 포켓 80 × 60 R10(중심 (100,100), 깊이 6 — 바닥 높이 12, 둘레 x 60~140·y 70~130),
// 가공 2 포켓 바닥에 뚫은 수직 구멍 Ø10(중심 (112,98), 깊이 12 — 그물은 판 윗면 18에서 6까지), 가공 3 윗면 톱 홈(폭 8·깊이 5 — (250,200)→(350,200)),
// 가공 4 포켓 밖 수직 구멍 Ø10(중심 (150,22))
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <pocket length="80" width="60" depth="6" direction="z-" cornerRadius="10" angle="0" centerX="100" centerY="100" centerZ="0" enable="1" order="1"/>
  <hole x="112" y="98" z="0" diameter="10" depth="12" direction="z-" enable="1" order="2"/>
  <line startX="250" startY="200" startZ="0" endX="350" endY="200" endZ="0" width="8" depth="5" direction="z-" isSaw="1" enable="1" order="3"/>
  <hole x="150" y="22" z="0" diameter="10" depth="12" direction="z-" enable="1" order="4"/>
 </panel>
</pgi>`;
const P = parseForView('p.pgi', enc(PANEL));
const FIRST = [0, 100, 15];
type Hover = Viewer3d['measureHoverSnap'];
const view = (h: Hover) => h && { snap: h.snap, point: h.point.map((x) => Number(x.toFixed(6))), axis: h.axis ?? null, refined: !!h.refined, face: h.face?.id ?? null, segment: h.segment?.id ?? null };

/** 앱(app.ts applyDoc)처럼 장면을 올린 뒤 판 너머 고르기에서 멈출 그물을 켜고 뚜껑을 준다. lid = false면 28차(뚜껑 없이 그물 전체에서 멈춤) */
function open(lid = true, tweak: (o: MeasureSnapOptions) => MeasureSnapOptions = (o) => o) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(P.scene);
  for (const id of boardThrough(P.scene) ?? []) {
    v.setItemPickOpaque(id, true);
    const r = lid ? boardLid(P.scene, id) : null;
    if (r) v.setItemPickThrough(id, [r]);
  }
  v.setView('seIso', false);
  v.fit(false);
  v.setMeasureMode(true);
  const o = panelSnapOptions(P.mpr!.snap!);
  const faces: string[] = [];
  v.setMeasureSnap(tweak({ ...o, points: [...(o.points ?? []), { point: FIRST, kind: 'center' }], refineFace: (c) => (faces.push(`${c.kind}:${c.face.id}`), o.refineFace!(c)) }));
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const ptr = (type: string, p: readonly number[]): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
    v.renderNow();
    lock.update();
  };
  const hover = (p: readonly number[]): Hover => (ptr('pointermove', p), v.measureHoverSnap);
  /** 그 자리 판 너머 면 고르기(측정 붙잡기와 같은 고르기 — 붙잡지 않은 미리 보기에는 면 id가 실리지 않는다) */
  const faceAt = (p: readonly number[]): string | null => {
    const s = v.project(p)!;
    return v.pick(s.x, s.y, { meshesOnly: true, throughTranslucent: true })?.id ?? null;
  };
  const click = (p: readonly number[]): void => {
    ptr('pointermove', p);
    ptr('pointerdown', p);
    ptr('pointerup', p);
  };
  const zoomBox = (lo: readonly number[], hi: readonly number[], name: 'seIso' | 'top' = 'seIso'): void => {
    v.setView(name, false);
    v.fit(false);
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
  return { v, lock, faces, hover, faceAt, click, zoomBox };
}

// 포켓 바닥(높이 12) 위 구멍에서 떨어진 자리 — 위에서·남동 등각에서
const FLOOR = [83.3, 112.7, 12];
// 포켓 안쪽 서쪽 벽 x = 60(남동에서 뚜껑 너머로 보이는 안쪽 면, y 70~130 곧은 구간, 높이 12~18)
const WEST = [60, 103.3, 15.2];
// 포켓 바닥 구멍 Ø10(중심 (112,98)) 기둥 벽의 남동쪽(눈 쪽 −40.5°, 포켓 안 높이 15.3)
const HOLE_C = [112, 98];
const HOLE_WALL = [112 + 5 * Math.cos(-40.5 * D), 98 + 5 * Math.sin(-40.5 * D), 15.3];
const holeDev = (p: readonly number[]): number => Math.abs(Math.hypot(p[0]! - HOLE_C[0]!, p[1]! - HOLE_C[1]!) - 5);

describe('해석기가 준 포켓·홈 뚜껑(meta.lids)', () => {
  it('뚜껑은 들어가는 판 면(윗면 높이 18) 위 삼각형이고, 포켓·홈만 — 구멍·판은 없다', () => {
    expect(boardThrough(P.scene)).toEqual(['mpr-op-0', 'mpr-op-2']);
    expect(boardLid(P.scene, 'mpr-board')).toBeNull();
    expect(boardLid(P.scene, 'mpr-op-1')).toBeNull();
    for (const id of ['mpr-op-0', 'mpr-op-2']) {
      const r = boardLid(P.scene, id)!;
      expect(r.count).toBeGreaterThan(0);
      const m = P.scene.meshes.find((x) => x.id === id)!;
      const zs = new Set<number>();
      for (let t = r.start; t < r.start + r.count; t++) for (let k = 0; k < 3; k++) zs.add(m.positions[m.indices![t * 3 + k]! * 3 + 2]!);
      expect([...zs]).toEqual([18]);
      // 뚜껑 밖 삼각형에는 높이 18에만 있는 면이 없다(바닥·벽)
      const n = m.indices!.length / 3;
      for (let t = 0; t < n; t++) {
        if (t >= r.start && t < r.start + r.count) continue;
        const z = [0, 1, 2].map((k) => m.positions[m.indices![t * 3 + k]! * 3 + 2]!);
        expect(z.every((x) => x === 18)).toBe(false);
      }
    }
  });

  it('구간이 그물 삼각형 밖이거나 꼴이 틀리면 주지 않는다(28차처럼 그물 전체에서 멈춘다)', () => {
    const lids = (P.scene.meta as { lids: Record<string, unknown> }).lids;
    const s = { ...P.scene, meta: { ...P.scene.meta, lids: { ...lids, 'mpr-op-0': { start: 0, count: 1e6 }, 'mpr-op-2': { start: '0', count: 2 } } } };
    expect(boardLid(s, 'mpr-op-0')).toBeNull();
    expect(boardLid(s, 'mpr-op-2')).toBeNull();
    expect(boardLid({ ...P.scene, meta: {} }, 'mpr-op-0')).toBeNull();
  });
});

describe('판 위에서 포켓 뚜껑 너머 재기(29차 — 코어 0.27.0 setItemPickThrough, 실제 코어 판정)', () => {
  it('겉모습은 고르기 불투명과 뚜껑 구간만(투명도·색 그대로), 장면을 다시 주면 코어가 비운다', () => {
    const w = open();
    expect(w.v.itemLook('mpr-op-0')).toEqual({ pickable: true, pickOpaque: true, pickThrough: [boardLid(P.scene, 'mpr-op-0')] });
    expect(w.v.itemLook('mpr-op-1')).toBeNull();
    expect(w.v.itemLook('mpr-board')).toBeNull();
    w.v.setScene(P.scene);
    expect(w.v.itemLook('mpr-op-0')).toBeNull();
  });

  it('위에서 포켓 바닥을 가리키면 바닥 높이 12(28차는 포켓 윗면 18)', () => {
    const rows = [true, false].map((lid) => {
      const w = open(lid);
      w.zoomBox([70, 90, 12], [100, 130, 18], 'top');
      return { h: w.hover(FLOOR)!, face: w.faceAt(FLOOR) };
    });
    expect(rows[0]!.h.snap).toBeNull();
    expect(Math.abs(rows[0]!.h.point[2] - 12)).toBeLessThan(1e-6);
    expect(rows[0]!.face).toBe('mpr-op-0');
    expect(Math.abs(rows[1]!.h.point[2] - 18)).toBeLessThan(1e-6);
    expect(rows[1]!.face).toBe('mpr-op-0');
  });

  it('위에서 포켓 바닥 구멍을 가리키면 구멍 기둥(28차는 포켓 윗면과 구멍 윗면이 같은 높이 18이라 장면 차례대로 포켓)', () => {
    const at = [115.1, 99.7, 18];
    const ids = [true, false].map((lid) => {
      const w = open(lid);
      w.zoomBox([104, 90, 12], [120, 106, 18], 'top');
      return w.faceAt(at);
    });
    expect(ids).toEqual(['mpr-op-1', 'mpr-op-0']);
  });

  it('남동 등각에서 뚜껑 너머 포켓 안쪽 벽(x = 60)과 바닥 구멍 기둥 벽(원기둥 위로 다듬음) — 28차는 포켓 윗면', () => {
    const w = open();
    w.zoomBox([55, 90, 10], [75, 115, 18]);
    const a = w.hover(WEST)!;
    expect(a.snap).toBeNull();
    expect(w.faceAt(WEST)).toBe('mpr-op-0');
    expect(Math.abs(a.point[0] - 60)).toBeLessThan(1e-4);
    expect(a.point[2]).toBeGreaterThan(12);
    expect(a.point[2]).toBeLessThan(18);
    w.zoomBox([104, 88, 10], [120, 104, 18]);
    const b = w.hover(HOLE_WALL)!;
    expect(w.faces).toContain('onFace:mpr-op-1');
    expect(w.faceAt(HOLE_WALL)).toBe('mpr-op-1');
    expect(b).toMatchObject({ snap: null, refined: true });
    expect(holeDev(b.point)).toBeLessThan(1e-9);
    expect(b.point[2]).toBeGreaterThan(12);
    expect(b.point[2]).toBeLessThan(18);
    const old = open(false);
    old.zoomBox([55, 90, 10], [75, 115, 18]);
    expect(Math.abs(old.hover(WEST)!.point[2] - 18)).toBeLessThan(1e-4);
    old.zoomBox([104, 88, 10], [120, 104, 18]);
    const g = old.hover(HOLE_WALL)!;
    expect(old.faces).not.toContain('onFace:mpr-op-1');
    expect(old.faceAt(HOLE_WALL)).toBe('mpr-op-0');
    expect(Math.abs(g.point[2] - 18)).toBeLessThan(1e-4);
  });

  it('판 왼쪽면 첫 점 (0,100,15)의 X축이 뚜껑 너머 포켓 안쪽 벽 x = 60을 뚫는 점 — "X축 · 면 위", 거리 60', () => {
    const w = open();
    w.click(FIRST);
    expect(w.v.measurePoints[0]).toMatchObject({ point: FIRST, snap: 'center' });
    w.zoomBox([55, 90, 10], [75, 115, 18]);
    const h = w.hover([60, 100.3, 15.2])!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', face: { id: 'mpr-op-0' } });
    expect(Math.abs(h.point[0] - 60)).toBeLessThan(1e-9);
    expect([h.point[1], h.point[2]]).toEqual([100, 15]);
    expect(w.lock.snapshot().tip).toBe('X축 · 면 위');
    w.click([60, 100.3, 15.2]);
    expect(Math.abs(w.v.measurement()!.distance - 60)).toBeLessThan(1e-9);
  });

  it('포켓 위 테두리(윤곽선)·포켓 밖 판 위·바깥에서 본 포켓 벽·포켓 밖 구멍은 뚜껑을 주든 않든 같은 값(첫 점 전·뒤)', () => {
    const spots = [
      [100.3, 130, 18], // 포켓 북쪽 위 테두리(윤곽선 — 눈에서 먼 쪽)
      [140, 100.3, 15.2], // 동쪽 벽 바깥(판 너머 — 27차)
      [200.3, 150.2, 18], // 판 위
      [153, 24.5, 18], // 포켓 밖 구멍 윗면
      [300.4, 196, 15.5], // 홈 남쪽 벽 바깥(27차)
    ];
    const rows = [open(), open(false)].map((w) => {
      const row = spots.map((p) => view(w.hover(p)));
      w.click(FIRST);
      for (const p of spots) row.push(view(w.hover(p)));
      return row;
    });
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[0]!.filter(Boolean).length).toBe(spots.length * 2);
  });
});

describe('보기에서 누르기(앱 — 판 너머 알림 하나에 가장 앞 고르기 e.front)', () => {
  async function openApp() {
    document.body.innerHTML = '<div id="app"></div>';
    const app = new NcViewerApp(document.getElementById('app')!);
    expect(await app.openBuffer('p.pgi', enc(PANEL).buffer as ArrayBuffer)).toBe(true);
    const v = app.viewer!;
    const click = (p: readonly number[]): void => {
      const s = v.project(p)!;
      expect(s.onScreen).toBe(true);
      for (const type of ['pointerdown', 'pointerup']) {
        const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
        Object.defineProperty(e, 'pointerId', { value: 1 });
        Object.defineProperty(e, 'pointerType', { value: 'mouse' });
        v.canvas.dispatchEvent(e);
      }
    };
    const zoom = (x0: number, y0: number, x1: number, y1: number): void => {
      v.setView('top', false);
      v.fit(false);
      const a = v.project([x0, y0, 18])!;
      const b = v.project([x1, y1, 18])!;
      v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
      v.renderNow();
    };
    return { app, v, click, zoom };
  }

  it('앱은 뚜껑을 주고, 포켓 바닥 구멍을 위에서 누르면 그 구멍(가공 2), 포켓 바닥은 포켓(가공 1), 홈은 홈(가공 3)', async () => {
    const { app, v, click, zoom } = await openApp();
    expect(v.itemLook('mpr-op-0')?.pickThrough).toEqual([boardLid(app.doc!.scene, 'mpr-op-0')]);
    expect(v.itemLook('mpr-op-2')?.pickThrough).toEqual([boardLid(app.doc!.scene, 'mpr-op-2')]);
    // 구멍 중심에서 3.6 비킨 자리(중심 점에 붙지 않게 크게 당긴다)
    zoom(104, 90, 120, 106);
    click([115.1, 99.7, 18]);
    expect(app.doc!.pick).toMatchObject({ kind: 'mesh', id: 'mpr-op-1' });
    expect(app.doc!.selKey).toBe('1');
    zoom(70, 90, 100, 130);
    click(FLOOR);
    expect(app.doc!.pick).toMatchObject({ kind: 'mesh', id: 'mpr-op-0' });
    expect(app.doc!.selKey).toBe('0');
    zoom(285, 185, 315, 215);
    click([300.4, 201.2, 18]);
    expect(app.doc!.pick).toMatchObject({ kind: 'mesh', id: 'mpr-op-2' });
    expect(app.doc!.selKey).toBe('2');
    // 뒤에 아무것도 없는 판 위는 판
    zoom(280, 40, 320, 80);
    click([300.4, 60.3, 18]);
    expect(app.doc!.pick).toMatchObject({ kind: 'mesh', id: 'mpr-board' });
    expect(app.doc!.selKey).toBeNull();
  });

  it('같은 문서를 다시 열어도(장면을 새로 올림) 뚜껑을 다시 준다', async () => {
    const { app, v } = await openApp();
    expect(await app.openBuffer('p.pgi', enc(PANEL).buffer as ArrayBuffer)).toBe(true);
    expect(app.viewer).toBe(v);
    expect(v.itemLook('mpr-op-0')).toEqual({ pickable: true, pickOpaque: true, pickThrough: [boardLid(app.doc!.scene, 'mpr-op-0')] });
  });
});
