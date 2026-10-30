// @vitest-environment jsdom
/**
 * 27차: 보기(측정이 아닐 때)에서 판재 문서의 반투명 판 너머 구멍·포켓을 누르면 그 가공을 고른다(app.ts — 3D 뷰어 코어 0.23.0 onPick의
 * throughTranslucent, 0.24.0 setItemPickOpaque). 앱을 진짜 코어(가짜 WebGL)로 띄우고 해석 워커만 같은 스레드의 parseForView로 바꾼다.
 * - 판 너머 수직 구멍 윗면·포켓 윗면을 누르면 그 가공(상태 막대 "가공 N · …" — 가공 목록에서 고른 것과 같다), 뒤에 아무것도 없는 판 위는 판(26차 그대로)
 * - 앱이 단 두 알림(판 너머·가장 앞 면)은 한 누르기에서 같은 사건 객체를 받고 판 너머 알림이 먼저다(앱이 그 짝으로 판 너머 고르기를 쓴다)
 * 화면 자리는 그물 경계·윤곽선을 정확히 가리키지 않는다(구멍·포켓 가운데 쪽).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pick3d, PickEvent, Viewer3d } from 'opencad-viewer3d';
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
  // jsdom에는 없다(가공 탭에서 고른 줄을 보이게 할 때 부른다)
  Element.prototype.scrollIntoView = () => {};
});
afterAll(() => {
  restore();
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
});

// 판 400 × 300 × 18: 수직 구멍 Ø10(중심 (150,22), 깊이 12 — 가공 1), 윗면 포켓 80 × 60(중심 (100,150), 깊이 6 — 가공 2), 수평 구멍 Ø8(왼쪽면 y 250, z 9 — 가공 3)
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <hole x="150" y="22" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
  <pocket length="80" width="60" depth="6" direction="z-" cornerRadius="0" angle="0" centerX="100" centerY="150" centerZ="0" enable="1" order="2"/>
  <hole x="0" y="250" z="9" diameter="8" depth="30" direction="x+" enable="1" order="3"/>
 </panel>
</pgi>`;

async function openPanel() {
  document.body.innerHTML = '<div id="app"></div>';
  const app = new NcViewerApp(document.getElementById('app')!);
  expect(await app.openBuffer('p.pgi', new TextEncoder().encode(PANEL).buffer as ArrayBuffer)).toBe(true);
  const v = app.viewer!;
  expect(v).toBeTruthy();
  v.setView('top', false);
  v.fit(false);
  v.renderNow();
  /** 세계 점의 화면 자리를 누른다(마우스 — 끌지 않음) */
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
  /** 위에서 본 세계 사각형(x0, y0)~(x1, y1)이 화면을 채우게(구멍 중심 점이 누른 자리에서 붙잡기 거리 밖이 되게) */
  const zoom = (x0: number, y0: number, x1: number, y1: number): void => {
    v.setView('top', false);
    v.fit(false);
    const a = v.project([x0, y0, 18])!;
    const b = v.project([x1, y1, 18])!;
    v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
    v.renderNow();
  };
  const status = (): string => document.querySelector('.st-sel')?.textContent ?? '';
  return { app, v, click, zoom, status };
}
// 수직 구멍 윗면에서 중심을 비킨 자리(중심에서 3.9 — 테두리에서 1.1), 포켓 윗면, 뒤에 아무것도 없는 판 위
const HOLE = [153, 24.5, 18];
const POCKET = [93.3, 141.7, 18];
const BOARD = [300.4, 200.3, 18];

describe('보기에서 반투명 판 너머 가공 누르기(27차, 실제 코어 판정)', () => {
  it('판 너머 수직 구멍·포켓을 누르면 그 가공을 고르고, 뒤에 아무것도 없는 판 위는 판', async () => {
    const { app, click, zoom, status } = await openPanel();
    expect(app.doc!.scene.meshes.map((m) => m.id)).toEqual(['mpr-board', 'mpr-op-0', 'mpr-op-1', 'mpr-op-2']);
    // 수직 구멍(가공 1 — 불투명 기둥) 윗면
    zoom(140, 12, 160, 32);
    click(HOLE);
    expect(app.doc!.pick).toMatchObject({ kind: 'mesh', id: 'mpr-op-0' });
    expect(app.doc!.selKey).toBe('0');
    expect(app.doc!.highlight).toEqual(['mpr-op-0']);
    expect(status()).toMatch(/^가공 1 · /);
    // 포켓(가공 2 — 반투명으로 그리지만 고르기에서 불투명) 윗면
    zoom(70, 120, 130, 180);
    click(POCKET);
    expect(app.doc!.pick).toMatchObject({ kind: 'mesh', id: 'mpr-op-1' });
    expect(app.doc!.selKey).toBe('1');
    expect(status()).toMatch(/^가공 2 · /);
    // 뒤에 아무것도 없는 판 위: 판(26차와 같다)
    zoom(280, 180, 320, 220);
    click(BOARD);
    expect(app.doc!.pick).toMatchObject({ kind: 'mesh', id: 'mpr-board' });
    expect(app.doc!.selKey).toBeNull();
    expect(app.doc!.highlight).toEqual(['mpr-board']);
    expect(status()).toMatch(/^판 400×300×18 · /);
  });

  it('코어는 한 누르기의 판 너머 알림과 가장 앞 면 알림에 같은 사건 객체를 단 차례대로 준다(앱이 그 짝을 쓴다)', async () => {
    const { v, click, zoom } = await openPanel();
    const got: { through: boolean; p: Pick3d | null; e: PickEvent }[] = [];
    const off = [v.onPick((p, e) => got.push({ through: true, p, e }), { throughTranslucent: true }), v.onPick((p, e) => got.push({ through: false, p, e }))];
    zoom(140, 12, 160, 32);
    click(HOLE);
    off.forEach((f) => f());
    // 앱이 먼저 단 둘(판 너머·가장 앞)과 시험이 단 둘: 판 너머 알림끼리·가장 앞 알림끼리 같은 고르기, 모두 같은 사건 객체
    expect(got.map((g) => [g.through, g.p?.id ?? null])).toEqual([
      [true, 'mpr-op-0'],
      [false, 'mpr-board'],
    ]);
    expect(got[0]!.e).toBe(got[1]!.e);
  });

  it('측정 중 누르기는 고르지 않는다(코어가 알리지 않는다 — 예전 그대로)', async () => {
    const { app, v, click } = await openPanel();
    const measureBtn = [...document.querySelectorAll<HTMLButtonElement>('.toolbar .tbtn')].find((b) => b.getAttribute('aria-label') === '측정')!;
    measureBtn.click();
    await vi.waitFor(() => expect((v as Viewer3d).measureMode).toBe(true), { timeout: 5000 });
    click(HOLE);
    expect(app.doc!.pick).toBeNull();
    expect(app.doc!.selKey).toBeNull();
  });
});
