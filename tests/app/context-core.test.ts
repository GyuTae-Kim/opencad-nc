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
  /**
   * 198차: 안내(.gl-lost)가 role=status로 글과 함께 새로 붙어 화면 읽기 프로그램이 첫 글을 읽지 않을 수 있었다(알림 영역은 글이 바뀌기 전에 있어야 읽음 — 117·156·197차 꼴).
   * 보이는 안내는 그대로 두고 알림 영역에서 떼어, 앱을 만들 때 #app 바로 밑에 빈 채로 붙여 둔 알림 영역에 같은 글을 잃을 때 한 번 넣고 되찾으면 비운다
   */
  it('잃으면 가운데 안내 하나(두 번 와도 하나), 되찾으면 거두고 코어는 놓은 것이 없어 빈 need — 198차: 안내는 알림 영역이 아니고 미리 붙여 둔 알림 영역에 같은 글을 한 번, 되찾으면 비움', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = new NcViewerApp(document.getElementById('app')!);
    // 198차: 열기 전부터 숨김 없이 비어 있다
    const live = document.querySelector<HTMLElement>('#app > .app-live');
    expect([live?.getAttribute('role'), live?.getAttribute('aria-live'), live?.textContent, live?.hidden]).toEqual(['status', 'polite', '', false]);
    expect(await app.openBuffer('a.nc', new TextEncoder().encode('G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG2 X20 Y0 I10 J0\nM30\n').buffer as ArrayBuffer)).toBe(true);
    const v = app.viewer!;
    const needs: unknown[] = [];
    v.onContextRestore((n) => void needs.push(n));
    const notes = (): Element[] => [...document.querySelectorAll('.view .gl-lost')];
    expect(notes()).toEqual([]);
    // 영역에 넣은 글(비우면 빈 글) — 연 뒤부터 센다
    const obs = new MutationObserver(() => {});
    obs.observe(live!, { childList: true, characterData: true, subtree: true });
    const writes = (): string[] => obs.takeRecords().map((r) => [...r.addedNodes].map((n) => n.textContent).join(''));
    v.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    v.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(notes().length).toBe(1);
    expect(notes()[0]!.textContent).toBe('그래픽을 다시 준비하는 중…');
    // 198차: 보이는 안내는 알림 영역이 아니다(같은 글은 미리 붙여 둔 영역에 한 번 — 두 번 와도 하나)
    expect(notes()[0]!.getAttribute('role')).toBeNull();
    expect([writes(), live!.textContent, document.querySelector('#app > .app-live')]).toEqual([['그래픽을 다시 준비하는 중…'], '그래픽을 다시 준비하는 중…', live]);
    v.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(notes()).toEqual([]);
    expect([writes(), live!.textContent]).toEqual([[''], '']);
    expect(needs).toEqual([{ meshes: [], textures: [] }]);
    expect(v.restoreNeed).toBeNull();
    // 장면은 그대로(코어가 다시 올림) — 문서 선분 수가 같다
    expect(v.scene?.lines.length).toBe(app.doc!.scene.lines.length);
    // 다시 잃으면 안내 하나와 영역 글 한 번이 다시(되찾을 때 비워 같은 글도 바뀜이 된다)
    v.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect([notes().length, writes(), live!.textContent]).toEqual([1, ['그래픽을 다시 준비하는 중…'], '그래픽을 다시 준비하는 중…']);
    v.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect([notes(), writes()]).toEqual([[], ['']]);
    obs.disconnect();
  });
});
