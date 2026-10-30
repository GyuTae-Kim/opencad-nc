// @vitest-environment jsdom
/**
 * 28차: 그래픽 문맥을 잃으면 3D 보기 가운데에 안내를 보이고 되찾으면 거둔다(app.ts — 3D 뷰어 코어 0.25.0 onContextLost·onContextRestore).
 * 놓기(release)는 쓰지 않으므로 코어가 장면을 그대로 다시 올리고 다시 줄 것(need)은 빈 목록이다.
 * 앱을 진짜 코어(가짜 WebGL)로 띄우고 해석 워커만 같은 스레드의 parseForView로 바꾼다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

describe('그래픽 문맥 잃음·되찾음 안내', () => {
  it('잃으면 가운데 안내 하나(두 번 와도 하나), 되찾으면 거두고 코어는 놓은 것이 없어 빈 need', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = new NcViewerApp(document.getElementById('app')!);
    expect(await app.openBuffer('a.nc', new TextEncoder().encode('G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG2 X20 Y0 I10 J0\nM30\n').buffer as ArrayBuffer)).toBe(true);
    const v = app.viewer!;
    const needs: unknown[] = [];
    v.onContextRestore((n) => void needs.push(n));
    const notes = (): Element[] => [...document.querySelectorAll('.view .gl-lost')];
    expect(notes()).toEqual([]);
    v.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    v.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(notes().length).toBe(1);
    expect(notes()[0]!.textContent).toBe('그래픽을 다시 준비하는 중…');
    expect(notes()[0]!.getAttribute('role')).toBe('status');
    v.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(notes()).toEqual([]);
    expect(needs).toEqual([{ meshes: [], textures: [] }]);
    expect(v.restoreNeed).toBeNull();
    // 장면은 그대로(코어가 다시 올림) — 문서 선분 수가 같다
    expect(v.scene?.lines.length).toBe(app.doc!.scene.lines.length);
  });
});
