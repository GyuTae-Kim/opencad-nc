// @vitest-environment jsdom
/**
 * 55차(코어 0.50.0 sceneIssues·onSceneIssues): 코어가 장면 입력에서 빼거나 고친 것을 정보 탭 "3D 보기 경고"에 앱 말로 보인다(app.ts syncSceneIssues·panel-info.ts).
 * - 실제 코어(가짜 WebGL): 좌표 NaN·아주 큰 값이 든 공구 경로 선분·점, 정점 수 밖 색인·NaN 윤곽선이 든 그물, 놓을 자리를 모르는 그물 → 알림마다 앱 글(개수 그대로)
 * - 모든 code의 앱 글이 네 언어 사전에 있다(옮긴 글에 한글이 없고 개수 자리를 지킨다)
 * - 앱(가짜 뷰어): 문서를 열면 알림이 있으면 한 번 알리고 정보 탭에 묶음, 알림이 바뀌면 다시 그리고, 알림이 없는 장면으로 다시 읽으면 앞 묶음이 남지 않는다.
 *   뷰어는 animate: 'auto'(코어 0.48.0)로 만든다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneIssue, SceneIssueCode } from 'opencad-viewer3d';

const fake = vi.hoisted(() => {
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    issues: SceneIssue[] = [];
    issueCb: (() => void) | null = null;
    readonly opts: unknown;
    constructor(host: HTMLElement, opts?: unknown) {
      this.opts = opts;
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      FakeViewer.last = this;
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get sceneIssues(): readonly SceneIssue[] {
      return this.issues;
    }
    onSceneIssues(cb: () => void): () => void {
      this.issueCb = cb;
      return () => (this.issueCb = null);
    }
    get measurePointCount(): number {
      return 0;
    }
    getProjection(): string {
      return 'perspective';
    }
    getRenderMode(): string {
      return 'shadedEdges';
    }
    groups(): unknown[] {
      return [];
    }
  }
  return { FakeViewer };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown) {
      return parseForView(name, new Uint8Array(data), (opts ?? {}) as object);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { translate } from '../../site/i18n.mjs';
import { NcViewerApp } from '../../src/app/app';
import { sceneIssueGroup, sceneIssueText } from '../../src/app/panel-info';
import { installCanvasFakes } from './fake-webgl';

const MILL = 'G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z-1 F100\nX20\nY20\nG0 Z5\nM30';
const ALL: SceneIssue[] = [
  { code: 'positions', action: 'fixed', kind: 'line', id: 'nc-cut', field: 'positions', count: 3 },
  { code: 'positions', action: 'fixed', kind: 'point', id: 'nc-holes', field: 'positions', count: 1 },
  { code: 'positions', action: 'fixed', kind: 'mesh', id: 'm', field: 'positions', count: 1200 },
  { code: 'positions', action: 'fixed', kind: 'mesh', id: 'm', field: 'edges', count: 2 },
  ...(['bounds', 'placement', 'billboard', 'indices', 'length', 'normals', 'colors', 'uvs', 'color', 'material', 'width', 'size', 'ids', 'duplicate-id'] as SceneIssueCode[]).map(
    (code): SceneIssue => ({ code, action: 'kept', kind: 'mesh', id: 'm', count: 2 }),
  ),
];

describe('코어 장면 알림의 앱 글(panel-info.ts)', () => {
  it('실제 코어가 깨진 공구 경로·점·그물에서 낸 알림을 항목 종류별 앱 글로(개수 그대로)', async () => {
    const restore = installCanvasFakes(800, 600);
    try {
      const { Viewer3d } = await vi.importActual<typeof import('opencad-viewer3d')>('opencad-viewer3d');
      const host = document.createElement('div');
      document.body.append(host);
      const v = new Viewer3d(host, { animate: false });
      const seen: SceneIssue[][] = [];
      v.onSceneIssues((list) => seen.push([...list]));
      const box = new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]);
      v.setScene({
        name: 's',
        units: 'mm',
        meshes: [
          // 정점 수(4) 밖 색인이 든 삼각형 하나, 끝점이 NaN인 윤곽선 하나
          { id: 'm', positions: box, indices: new Uint32Array([0, 1, 2, 0, 2, 9]), color: [0.5, 0.5, 0.5, 1], edges: new Float32Array([0, 0, 0, 10, 0, 0, NaN, 0, 0, 0, 10, 0]) },
          // 놓을 자리(원점)를 모름
          { id: 'far', positions: box, color: [0.5, 0.5, 0.5, 1], origin: [NaN, 0, 0] },
        ],
        lines: [{ id: 'nc-cut', positions: new Float32Array([0, 0, 0, 5, 0, 0, 5, 0, 0, NaN, 0, 0, 5, 0, 0, 5, 1e30, 0]) }],
        points: [{ id: 'nc-holes', positions: new Float32Array([1, 1, 0, Infinity, 1, 0]) }],
      });
      // setScene 안에서 한 번 불리고, 읽기 sceneIssues와 같은 알림
      expect(seen).toHaveLength(1);
      expect(v.sceneIssues).toEqual(seen[0]);
      const texts = v.sceneIssues.map(sceneIssueText);
      expect(texts).toEqual(
        expect.arrayContaining([
          '공구 경로 선분 2개는 좌표가 수가 아니거나 너무 커서 그리지 않았습니다.',
          '점 1개는 좌표가 수가 아니거나 너무 커서 그리지 않았습니다.',
          '윤곽선 1개는 좌표가 수가 아니거나 너무 커서 그리지 않았습니다.',
          '없는 꼭짓점을 가리키는 삼각형 1개를 그리지 않았습니다.',
          '놓을 자리를 알 수 없는 묶음을 그리지 않았습니다.',
        ]),
      );
      expect(texts).toHaveLength(5);
      // 멀쩡한 장면은 알림이 없다(처리기를 부르지 않는다)
      v.setScene({ name: 's', units: 'mm', meshes: [], lines: [{ id: 'nc-cut', positions: new Float32Array([0, 0, 0, 5, 0, 0]) }] });
      expect(v.sceneIssues).toEqual([]);
      expect(seen).toHaveLength(1);
      v.dispose();
    } finally {
      restore();
    }
  });

  it('모든 code의 앱 글이 네 언어 사전에 있다(한글 없이, 개수 자리를 지킨다) — 묶음 제목·안내도', () => {
    const texts = [...ALL.map(sceneIssueText), '3D 보기 경고 12개', '3D 보기 경고 1,234개 — 패널의 "정보" 탭에서 볼 수 있습니다.'];
    const group = sceneIssueGroup(ALL.slice(0, 2));
    texts.push(group.querySelector('.hint')!.textContent!);
    expect(new Set(texts).size).toBe(texts.length);
    expect(sceneIssueText(ALL[2]!)).toContain('1,200개');
    for (const code of ['en', 'ja', 'zh-CN', 'de'])
      for (const t of texts) {
        const out = translate(t, code);
        expect(out, `${code}: ${t}`).not.toMatch(/[가-힣]/);
        for (const n of t.match(/\d[\d,]*(?=개)/g) ?? []) expect(out, `${code}: ${t}`).toContain(n);
      }
    expect(group.querySelector('h3')!.textContent).toBe('3D 보기 경고 2개');
    expect([...group.querySelectorAll('.warn-list li')].map((li) => li.textContent)).toEqual(ALL.slice(0, 2).map(sceneIssueText));
  });
});

describe('앱이 코어 장면 알림을 정보 탭에 잇는다(app.ts syncSceneIssues)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('알림이 있으면 한 번 알리고 정보 탭에 묶음, 바뀌면 다시 그리고, 알림 없는 문서에는 남지 않는다', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = new NcViewerApp(document.getElementById('app')!);
    const open = (name: string): Promise<boolean> => app.openBuffer(name, new TextEncoder().encode(MILL).buffer as ArrayBuffer);
    const infoGroups = (): string[] => [...document.querySelectorAll('.prop-group h3')].map((e) => e.textContent ?? '').filter((t) => t.startsWith('3D 보기 경고'));
    // 알림 글(닫기 단추 글은 빼고 — 첫 마디)
    const toasts = (): string[] => [...document.querySelectorAll('.toast')].map((e) => e.firstChild?.textContent ?? '').filter((t) => t.startsWith('3D 보기 경고'));
    // 첫 문서: 뷰어를 만들 때 알림이 없다
    expect(await open('a.nc')).toBe(true);
    const v = fake.FakeViewer.last!;
    expect(typeof v.issueCb).toBe('function');
    // 55차(코어 0.48.0): 카메라 움직임은 움직임 줄이기 선호를 코어가 따른다
    expect(v.opts).toMatchObject({ animate: 'auto' });
    window.opencadApp!.setPanelTab('info');
    expect(infoGroups()).toEqual([]);
    expect(app.state().sceneIssues).toBe(0);
    // 코어가 알림을 내면(setMesh 등 — onSceneIssues) 정보 탭을 다시 그리고 한 번 알린다
    v.issues = ALL.slice(0, 2);
    v.issueCb!();
    await vi.waitFor(() => expect(infoGroups()).toEqual(['3D 보기 경고 2개']));
    expect(toasts()).toEqual(['3D 보기 경고 2개 — 패널의 "정보" 탭에서 볼 수 있습니다.']);
    expect(app.state().sceneIssues).toBe(2);
    // 같은 알림이면 다시 그리지 않고, 알림이 늘면 다시 그리되 같은 문서에서는 다시 알리지 않는다
    v.issueCb!();
    v.issues = ALL.slice(0, 3);
    v.issueCb!();
    expect(infoGroups()).toEqual(['3D 보기 경고 3개']);
    expect(toasts()).toHaveLength(1);
    // 같은 문서를 다시 읽으면(정보 탭에서 방언 바꾸기 등 — 패널을 먼저 그리고 장면을 올린다) 알림이 없어진 장면에서 앞 묶음이 남지 않는다
    v.issues = [];
    await window.opencadApp!.reparse({});
    expect(app.doc!.panelTab).toBe('info');
    expect(infoGroups()).toEqual([]);
    expect(app.state().sceneIssues).toBe(0);
    // 알림이 있는 새 문서는 다시 알린다(문서마다 한 번)
    v.issues = ALL.slice(3, 4);
    expect(await open('b.nc')).toBe(true);
    expect(toasts()).toHaveLength(2);
    expect(app.state().sceneIssues).toBe(1);
  });
});
