// @vitest-environment jsdom
/**
 * 여러 파일을 한 작업으로(app.ts·panel.ts·doc.ts): 여러 개 고르기·끌어다 놓기, 주 프로그램 바꾸기, 작업 파일 목록,
 * 찾지 못한 프로그램 띠와 파일 더하기, 최근 문서. 뷰어 코어(WebGL)는 가짜로, 해석은 워커와 같은 길(parseForView)로 바로 부른다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
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
  return { FakeViewer, opens: [] as { name: string; opts: unknown; extra: string[] }[] };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown, _progress: unknown, extra: { name: string; bytes: ArrayBuffer }[] = []) {
      fake.opens.push({ name, opts, extra: extra.map((f) => f.name) });
      return parseForView(
        name,
        new Uint8Array(data),
        (opts ?? {}) as object,
        () => {},
        extra.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
      );
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';
import { RecentStore } from '../../src/app/recent';
import { memoryBackend, type MemoryBackend } from './recent-memory';

const MAIN = `%
O1000 (MAIN)
G21 G17 G90 G54
T1 M6
S1000 M3
G0 X0 Y0 Z5
M98 P1001
G0 X100 Y0
M98 P1002
M30
%
`;
const SUB_A = `%
O1001 (SUB A)
G1 Z-1 F100
X10
G0 Z5
M99
%
`;
const SUB_B = `G91 G1 X5 F100
G90
M99
`;

/** 고른 파일 흉내(글 내용) */
function textFile(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, slice: () => ({ arrayBuffer: async () => bytes.slice().buffer }), arrayBuffer: async () => bytes.slice().buffer } as unknown as File;
}

function makeApp(recent?: MemoryBackend): { app: NcViewerApp; root: HTMLElement } {
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root, recent ? { recent: new RecentStore(recent) } : {}), root };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !ok(); i++) await tick();
};
const notices = (root: HTMLElement): string[] => [...root.querySelectorAll('.notice-bar .notice')].map((n) => n.getAttribute('data-notice') ?? '');

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
  fake.opens.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('여러 파일을 한 작업으로 열기', () => {
  it('파일 고르기는 여러 개를 받고, 고른 파일들을 한 작업으로 읽어 띠·작업 파일 목록에 보인다', async () => {
    const recent = memoryBackend();
    const { root } = makeApp(recent);
    const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.multiple).toBe(true);
    Object.defineProperty(input, 'files', { configurable: true, value: [textFile('O1001.nc', SUB_A), textFile('main.nc', MAIN), textFile('1002.nc', SUB_B)] });
    input.dispatchEvent(new Event('change'));
    await until(() => !!window.opencadApp?.state.jobFiles);
    const st = window.opencadApp!.state;
    expect(st.docName).toBe('main.nc');
    expect(st.jobFiles).toEqual(['main.nc', 'O1001.nc', '1002.nc']);
    expect(st.moves).toBe(5);
    expect(fake.opens[0]).toMatchObject({ name: 'O1001.nc', extra: ['main.nc', '1002.nc'] });
    // 띠: 몇 개를 어떤 주 프로그램으로 읽었는지, 누르면 정보 탭
    expect(notices(root)).toEqual(['job']);
    const bar = root.querySelector('.notice-bar [data-notice=job]')!;
    expect(bar.textContent).toContain('파일 3개를 한 작업으로 읽었습니다 — 주 프로그램 main.nc');
    bar.querySelector<HTMLButtonElement>('.mb-btn:not(.icon)')!.click();
    expect(window.opencadApp!.state.panelTab).toBe('info');
    const info = root.querySelector('.panel')!;
    expect(info.textContent).toContain('작업 파일 3개');
    const items = [...info.querySelectorAll<HTMLButtonElement>('.job-files .warn-item')];
    expect(items.map((b) => b.textContent)).toEqual(['주 프로그램main.nc', '12번 줄O1001.nc', '20번 줄1002.nc']);
    // 파일을 누르면 코드 탭에서 그 파일이 시작하는 줄(표지 줄)로
    items[1]!.click();
    expect(window.opencadApp!.state.panelTab).toBe('code');
    expect(window.opencadApp!.state.selLine).toBe(11);
    // 최근 문서: 이은 글을 주 프로그램 이름으로, 파일 수와 함께
    await until(() => recent.entries.size > 0);
    const saved = [...recent.entries.values()];
    expect(saved.map((e) => [e.entry.name, e.entry.files])).toEqual([['main.nc', 3]]);
  });

  it('정보 탭에서 주 프로그램을 바꾸면 다시 잇고(이름도 바뀜), 다시 읽기는 같은 작업을 유지한다', async () => {
    const { app, root } = makeApp();
    await app.openFiles([textFile('main.nc', MAIN), textFile('O1001.nc', SUB_A), textFile('1002.nc', SUB_B)]);
    window.opencadApp!.setPanelTab('info');
    const sel = root.querySelector<HTMLSelectElement>('select[aria-label="주 프로그램"]')!;
    expect([...sel.options].map((o) => o.value)).toEqual(['main.nc', 'O1001.nc', '1002.nc']);
    sel.value = 'O1001.nc';
    sel.dispatchEvent(new Event('change'));
    await until(() => window.opencadApp!.state.docName === 'O1001.nc');
    expect(window.opencadApp!.state.jobFiles).toEqual(['O1001.nc', 'main.nc', '1002.nc']);
    expect(fake.opens.at(-1)!.opts).toMatchObject({ jobMain: 'O1001.nc' });
    // 방언을 바꿔 다시 읽어도 같은 작업
    await app.reparse({ ...app.doc!.ncOptions, dialect: 'fanuc' });
    expect(window.opencadApp!.state.jobFiles).toEqual(['O1001.nc', 'main.nc', '1002.nc']);
    expect(window.opencadApp!.state.docName).toBe('O1001.nc');
  });

  it('끌어다 놓은 여러 파일도 한 작업으로', async () => {
    const { root } = makeApp();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [textFile('main.nc', MAIN), textFile('O1001.nc', SUB_A)] } });
    window.dispatchEvent(drop);
    await until(() => !!window.opencadApp?.state.jobFiles);
    expect(window.opencadApp!.state.jobFiles).toEqual(['main.nc', 'O1001.nc']);
    // 1002는 아직 없다: 찾지 못한 프로그램 띠
    expect(notices(root)).toEqual(['job', 'missing-program']);
    expect(root.querySelector('[data-notice=missing-program]')!.textContent).toContain('다른 파일의 프로그램 O1002을(를) 찾지 못했습니다');
  });

  it('찾지 못한 프로그램 띠의 "파일 더하기"는 고른 파일을 열린 문서에 더해 다시 잇는다', async () => {
    const recent = memoryBackend();
    const { app, root } = makeApp(recent);
    await app.openBuffer('main.nc', new TextEncoder().encode(MAIN).buffer as ArrayBuffer);
    expect(window.opencadApp!.state.jobFiles).toBeNull();
    expect(notices(root)).toEqual(['missing-program']);
    const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    root.querySelector<HTMLButtonElement>('[data-notice=missing-program] .mb-btn:not(.icon)')!.click();
    expect(click).toHaveBeenCalledOnce();
    Object.defineProperty(input, 'files', { configurable: true, value: [textFile('O1001.nc', SUB_A), textFile('1002.nc', SUB_B)] });
    input.dispatchEvent(new Event('change'));
    await until(() => !!window.opencadApp?.state.jobFiles);
    expect(window.opencadApp!.state.jobFiles).toEqual(['main.nc', 'O1001.nc', '1002.nc']);
    expect(window.opencadApp!.state.docName).toBe('main.nc');
    expect(fake.opens.at(-1)).toMatchObject({ name: 'main.nc', opts: { jobMain: 'main.nc' }, extra: ['O1001.nc', '1002.nc'] });
    expect(notices(root)).toEqual(['job']);
    expect(window.opencadApp!.state.moves).toBe(5);
    // 다음 고르기는 다시 새로 열기
    Object.defineProperty(input, 'files', { configurable: true, value: [textFile('other.nc', 'G21 G90\nG0 X0 Y0 Z5\nG1 X10 F100\nM30\n')] });
    input.dispatchEvent(new Event('change'));
    await until(() => window.opencadApp!.state.docName === 'other.nc');
    expect(window.opencadApp!.state.jobFiles).toBeNull();
  });

  it('최근 문서의 작업은 파일 수를 보이고, 다시 열면 같은 작업으로 읽힌다', async () => {
    const recent = memoryBackend();
    const first = makeApp(recent);
    await first.app.openFiles([textFile('main.nc', MAIN), textFile('O1001.nc', SUB_A), textFile('1002.nc', SUB_B)]);
    await until(() => recent.entries.size > 0);
    const { root } = makeApp(recent);
    await until(() => root.querySelectorAll('.recent-item').length > 0);
    const row = root.querySelector('.recent-item')!;
    expect(row.querySelector('.recent-name')!.textContent).toBe('main.nc');
    expect(row.querySelector('.recent-files')!.textContent).toBe('파일 3개 작업');
    row.querySelector<HTMLButtonElement>('.recent-open')!.click();
    await until(() => !!window.opencadApp?.state.jobFiles);
    expect(window.opencadApp!.state.jobFiles).toEqual(['main.nc', 'O1001.nc', '1002.nc']);
    expect(window.opencadApp!.state.moves).toBe(5);
  });
});
