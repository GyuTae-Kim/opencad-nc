// @vitest-environment jsdom
/**
 * 휴대폰·터치 화면(app.ts): 좁은 화면 도구 막대, "보기 설정" 메뉴, 측정 띠, 손가락 기기의 파일 고르기·안내 글, 시작 화면의 최근 문서.
 * 뷰어 코어(WebGL)와 해석 워커는 가짜로 바꾼다 — 코어 쪽은 앱이 부르는 것만 흉내 내고 나머지 부르기는 null을 돌려준다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Cb = (m: unknown) => void;
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    measurePts = 0;
    readonly measureCbs: Cb[] = [];
    projection: 'perspective' | 'orthographic' = 'perspective';
    renderMode = 'shadedEdges';
    gridVisible = true;
    viewCubeVisible = true;
    axesVisible = true;
    viewCubeSize = 112;
    fitCalls = 0;
    fit(): void { this.fitCalls++; }
    section = null;
    /** 코어 측정 읽기(시험이 바꾼다): 미리 보기·잠금(0.10.0), Shift로 잠글 방향·거리 글상자 자리(0.12.0) */
    measureHoverSnap = null;
    measureInferenceLock = null;
    measureHoverLock = null;
    measureLabelRect = null;
    constructor(host: HTMLElement, opts?: { viewCubeSize?: number }) {
      if (opts?.viewCubeSize) this.viewCubeSize = opts.viewCubeSize;
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      FakeViewer.last = this;
      // 앱이 부르는 나머지(setScene·highlight·setMarker…)는 아무 일도 하지 않는다
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return this.measurePts;
    }
    setMeasureMode(on: boolean): void {
      this.measureMode = on;
      if (!on) this.clearMeasure();
    }
    clearMeasure(): void {
      const had = this.measurePts > 0;
      this.measurePts = 0;
      if (had) for (const cb of this.measureCbs) cb(null);
    }
    /** 코어가 두 점을 찍은 것처럼 결과를 알린다 */
    emitMeasure(m: { distance: number; dx: number; dy: number; dz: number }): void {
      this.measurePts = 2;
      for (const cb of this.measureCbs) cb({ a: [0, 0, 0], b: [m.dx, m.dy, m.dz], ...m });
    }
    onMeasure(cb: Cb): () => void {
      this.measureCbs.push(cb);
      return () => {};
    }
    setScene(): void {
      this.measurePts = 0;
    }
    getProjection(): string {
      return this.projection;
    }
    setProjection(p: 'perspective' | 'orthographic'): void {
      this.projection = p;
    }
    getRenderMode(): string {
      return this.renderMode;
    }
    setRenderMode(m: string): void {
      this.renderMode = m;
    }
    setGridVisible(on: boolean): void {
      this.gridVisible = on;
    }
    setViewCubeVisible(on: boolean): void {
      this.viewCubeVisible = on;
    }
    setAxesVisible(on: boolean): void {
      this.axesVisible = on;
    }
    groups(): unknown[] {
      return [];
    }
  }
  return { FakeViewer, parses: 0 };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { loadNcFile } = await import('../../src/index');
  const { ncPayload } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer) {
      fake.parses++;
      const { parsed, scene } = loadNcFile(name, new Uint8Array(data));
      const out: Record<string, unknown> = { kind: parsed.kind, scene, ms: 1 };
      if ('part' in parsed) out.mpr = { lines: parsed.part.lines };
      else out.nc = ncPayload(parsed.program);
      return out;
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

// 알림(toast)은 그대로 띄우되 부른 글을 볼 수 있게 감싼다
vi.mock('../../src/app/dom', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/app/dom')>();
  return { ...m, toast: vi.fn(m.toast) };
});

import { NcViewerApp } from '../../src/app/app';
import { toast } from '../../src/app/dom';
import { BINARY_MESSAGE } from '../../src/app/format';
import { ARROW_LOCK_HINT, SHIFT_LOCK_HINTS, measureHint, panelMeasureHint, statusMeasureHint } from '../../src/app/measure';
import { RecentStore, recentId } from '../../src/app/recent';
import { memoryBackend, type MemoryBackend } from './recent-memory';
import { translate } from '../../site/i18n.mjs';

/** 화면 폭·높이·누르개 흉내(matchMedia). 쉼표는 "또는", and는 "그리고"로 조건마다 흉내 낸 값을 본다 */
function media(narrow: boolean, coarse: boolean, low: boolean): void {
  const one = (c: string): boolean => (c.includes('coarse') ? coarse : c.includes('max-width') ? narrow : c.includes('max-height') ? low : false);
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q,
    matches: q.split(',').some((part) => part.split(' and ').every(one)),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function makeApp(narrow = false, coarse = false, low = false, recent?: MemoryBackend): { app: NcViewerApp; root: HTMLElement } {
  media(narrow, coarse, low);
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root, recent ? { recent: new RecentStore(recent) } : {}), root };
}

/** 고른 파일 흉내(글 내용) */
function textFile(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, slice: () => ({ arrayBuffer: async () => bytes.slice().buffer }), arrayBuffer: async () => bytes.slice().buffer } as unknown as File;
}
const PROGRAM = 'G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X20 Y10\nM30\n';

const label = (el: Element): string => el.getAttribute('aria-label') ?? '';
const menuButton = (root: HTMLElement, name: string): HTMLButtonElement => [...root.querySelectorAll<HTMLButtonElement>('.toolbar .tbtn')].find((b) => label(b) === name)!;
const menuItems = (wrap: Element): HTMLButtonElement[] => [...wrap.querySelectorAll<HTMLButtonElement>('.menu button')];
const itemByText = (wrap: Element, text: string): HTMLButtonElement => menuItems(wrap).find((b) => b.textContent === text)!;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  fake.parses = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('좁은 화면 도구 막대', () => {
  it('새 문서는 패널 배치 뒤 맞추고, 뒤늦게 온 이전 문서의 맞춤은 건너뛴다', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    const { app } = makeApp(false, true);
    expect(await app.openSample()).toBe(true);
    expect(await app.openSample()).toBe(true);
    const viewer = fake.FakeViewer.last!;
    expect(app.state().panelOpen).toBe(true);
    expect(viewer.fitCalls).toBe(0);
    for (let round = 0; round < 3; round++) {
      const ready = frames.splice(0);
      ready.forEach(cb => cb(round * 16));
    }
    expect(viewer.fitCalls).toBe(1);
  });
  it('휴대폰 한 줄에는 보기·측정 단추만 남기고, 나머지는 넓은 화면 전용(보기 설정 메뉴로 모음)', () => {
    const { root } = makeApp();
    const bar = root.querySelector('.toolbar')!;
    const narrow = [...bar.querySelectorAll(':scope > .tbtn:not(.wide-only), :scope > .menu-wrap:not(.wide-only) > .tbtn')].map(label);
    expect(narrow).toEqual(['전체 보기', '표준 뷰', '보기 설정', '단면', '측정', '재생', '패널']);
    const wide = [...bar.querySelectorAll(':scope > .wide-only')].map((el) => (el.classList.contains('menu-wrap') ? label(el.querySelector('.tbtn')!) : el.classList.contains('tb-sep') ? '|' : label(el)));
    expect(wide).toEqual(['원근 투영(누르면 평행)', '|', '그리기', '격자', '뷰 큐브', '좌표축', 'PNG 저장']);
    // "보기 설정"은 좁은 화면에서만
    expect(menuButton(root, '보기 설정').closest('.menu-wrap')!.classList.contains('narrow-only')).toBe(true);
  });

  it('"보기 설정" 메뉴: 투영(하나 고르기)·그리기 모드·격자·뷰 큐브·좌표축(켜고 끄기)·PNG 저장, 상태를 따라간다', async () => {
    const { app, root } = makeApp(true);
    const more = menuButton(root, '보기 설정');
    expect(more.disabled).toBe(true);
    expect(await app.openSample()).toBe(true);
    expect(more.disabled).toBe(false);
    const wrap = more.closest('.menu-wrap')!;
    const list = wrap.querySelector<HTMLElement>('.menu')!;
    expect(menuItems(wrap).map((b) => `${b.textContent}:${b.getAttribute('role')}:${b.getAttribute('aria-checked')}`)).toEqual([
      '원근 투영:menuitemradio:true',
      '평행 투영:menuitemradio:false',
      '음영:menuitemradio:false',
      '음영 + 모서리:menuitemradio:true',
      '와이어프레임:menuitemradio:false',
      'X-ray:menuitemradio:false',
      '격자:menuitemcheckbox:true',
      '뷰 큐브:menuitemcheckbox:true',
      '좌표축:menuitemcheckbox:true',
      '소재 깎기:menuitemcheckbox:false',
      'PNG 저장:menuitem:null',
    ]);
    expect(list.querySelectorAll('.menu-sep')).toHaveLength(3);

    more.click();
    expect(list.hidden).toBe(false);
    itemByText(wrap, '평행 투영').click();
    expect(list.hidden).toBe(true);
    const v = fake.FakeViewer.last!;
    expect(v.projection).toBe('orthographic');
    expect(itemByText(wrap, '평행 투영').getAttribute('aria-checked')).toBe('true');
    expect(itemByText(wrap, '원근 투영').getAttribute('aria-checked')).toBe('false');

    itemByText(wrap, '격자').click();
    expect(v.gridVisible).toBe(false);
    expect(itemByText(wrap, '격자').getAttribute('aria-checked')).toBe('false');
    itemByText(wrap, '와이어프레임').click();
    expect(v.renderMode).toBe('wireframe');
    // 넓은 화면 그리기 모드 메뉴도 같은 상태
    const render = menuButton(root, '그리기').closest('.menu-wrap')!;
    expect(itemByText(render, '와이어프레임').getAttribute('aria-checked')).toBe('true');
  });

  it('휴대폰 가로(손가락 기기에 낮은 화면)는 폭이 넓어도 처음엔 패널을 닫고 뷰 큐브를 작게 — 태블릿·컴퓨터는 그대로', async () => {
    const cases: Array<[string, boolean, boolean, boolean, boolean, number]> = [
      ['휴대폰 가로', false, true, true, false, 76],
      ['휴대폰 세로', true, true, false, false, 76],
      ['태블릿', false, true, false, true, 112],
      ['컴퓨터의 낮은 창', false, false, true, true, 112],
    ];
    for (const [name, narrow, coarse, low, panelOpen, cube] of cases) {
      const { app } = makeApp(narrow, coarse, low);
      expect(await app.openSample(), name).toBe(true);
      expect(app.state().panelOpen, name).toBe(panelOpen);
      expect(fake.FakeViewer.last!.viewCubeSize, name).toBe(cube);
    }
  });
});

describe('측정 띠(휴대폰·터치)', () => {
  it('측정을 켜면 다음에 누를 곳 안내, 결과는 거리와 dx·dy·dz, 다시 재기·끝내기 단추(Esc 대신)', async () => {
    const { app, root } = makeApp(true);
    await app.openSample();
    const bar = root.querySelector<HTMLElement>('.measure-bar')!;
    const text = (): string => bar.querySelector('.mb-text')!.textContent ?? '';
    const [clear, close] = [...bar.querySelectorAll<HTMLButtonElement>('.mb-btn:not(.mb-lock)')];
    expect(bar.hidden).toBe(true);

    menuButton(root, '측정').click();
    expect(app.state().measuring).toBe(true);
    expect(bar.hidden).toBe(false);
    expect(text()).toBe(measureHint(0, false));
    expect(clear!.disabled).toBe(true);

    // 첫 점: 코어 알림이 없으니 떼기(버블)에서 맞춘다
    const v = fake.FakeViewer.last!;
    v.measurePts = 1;
    v.canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    // 둘째 점 방향을 잡는 동안: 안내 다음에 따로 방향 잠금 안내(키보드 기기 — Shift로 잠글 방향이 없으면 화살표)와 잠금 단추
    expect(bar.querySelector('.mb-hint')!.textContent).toBe(measureHint(1, false));
    expect(bar.querySelector('.mb-lock-hint')!.textContent).toBe(ARROW_LOCK_HINT);
    expect(bar.querySelector<HTMLButtonElement>('.mb-lock')!.hidden).toBe(false);
    expect(clear!.disabled).toBe(false);
    // 커서가 코어가 Shift로 잠글 방향(measureHoverLock — 모서리 끝의 모서리 방향 등) 위면 그 방향을 알린다(측정 띠·상태 줄)
    (v as unknown as { measureHoverLock: unknown }).measureHoverLock = { kind: 'axis', axis: 'x', direction: [1, 0, 0] };
    v.canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(bar.querySelector('.mb-lock-hint')!.textContent).toBe(SHIFT_LOCK_HINTS.x);
    expect(root.querySelector('.st-sel')!.textContent).toContain(SHIFT_LOCK_HINTS.x);
    (v as unknown as { measureHoverLock: unknown }).measureHoverLock = null;

    v.emitMeasure({ distance: 50, dx: 30, dy: -40, dz: 0 });
    expect(bar.querySelector<HTMLButtonElement>('.mb-lock')!.hidden).toBe(true);
    expect(bar.querySelector('.mb-value')!.textContent).toBe('50 mm');
    expect(bar.querySelector('.mb-sub')!.textContent).toBe('dx 30 · dy -40 · dz 0');
    expect(root.querySelector('.st-sel')!.textContent).toContain('거리 50 mm');

    clear!.click();
    expect(v.measurePts).toBe(0);
    expect(text()).toBe(measureHint(0, false));
    expect(clear!.disabled).toBe(true);

    expect(label(close!)).toBe('측정 끝내기');
    close!.click();
    expect(app.state().measuring).toBe(false);
    expect(bar.hidden).toBe(true);
    expect(menuButton(root, '측정').getAttribute('aria-pressed')).toBe('false');
    expect(app.state().aiming).toBe(false);
  });

  it('손가락 기기: 띠·패널·상태 막대 안내에서 Esc 설명을 빼고 길게 누르기(정밀 조준)를 알린다', async () => {
    const { app, root } = makeApp(true, true);
    await app.openSample();
    menuButton(root, '측정').click();
    expect(root.querySelector('.measure-bar .mb-text')!.textContent).toBe(measureHint(0, false, true));
    // 예제는 G-code라 원호 중심·이동 가운데 점 붙잡기도 알린다
    expect(root.querySelector('.panel-foot')!.textContent).toContain(panelMeasureHint(true, true));
    expect(root.querySelector('.st-sel')!.textContent).toBe(statusMeasureHint(true));
    expect(root.textContent).not.toMatch(/Esc = 지우기|Esc 취소/);
    // 십자선 층은 3D 보기 위에
    expect(root.querySelector('.view > .aim-layer .aim-reticle')).not.toBeNull();
  });
});

describe('손가락 기기의 파일 고르기와 시작 화면', () => {
  it('마우스 기기는 확장자로 거르고, 손가락 기기는 거르지 않는다(iOS가 .nc·.mpr를 흐리게 막지 않게)', () => {
    let input = makeApp(false, false).root.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.getAttribute('accept')).toContain('.nc');
    expect(input.getAttribute('accept')).toContain('.mpr');
    input = makeApp(true, true).root.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.hasAttribute('accept')).toBe(false);
  });

  it('시작 화면은 끌어다 놓기·키 안내(마우스)와 고르기·손가락 안내(터치)를 둘 다 두고 CSS가 고른다', () => {
    const { root } = makeApp();
    const fine = [...root.querySelectorAll('.start .fine-only')].map((e) => e.textContent);
    const coarse = [...root.querySelectorAll('.start .coarse-only')].map((e) => e.textContent);
    expect(fine).toEqual(['NC 파일을 여기에 끌어다 놓으십시오', '창 어디에 놓아도 열립니다. 주 프로그램과 부프로그램 파일을 함께 놓으면 한 작업으로 읽습니다.', expect.stringMatching(/^키: F 전체 보기/)]);
    expect(coarse).toEqual(['NC 파일을 골라 여십시오', '주 프로그램과 부프로그램 파일을 함께 고르면 한 작업으로 읽습니다.', '한 손가락 끌기 회전 · 두 손가락 이동·확대 · 측정 중 길게 누르면 정밀 조준']);
  });

  it('모르는 확장자는 앞부분만 읽어 이진 파일(사진·동영상)을 바로 막는다 — 파일 전체를 읽지 않는다', async () => {
    const { app, root } = makeApp(true, true);
    const head = new Uint8Array(4096);
    head.set([0xff, 0xd8, 0xff, 0xe0]);
    const whole = vi.fn();
    const file = { name: 'IMG_0001.jpg', size: 50_000_000, slice: () => ({ arrayBuffer: async () => head.buffer }), arrayBuffer: whole } as unknown as File;
    expect(await app.openFile(file)).toBe(false);
    expect(whole).not.toHaveBeenCalled();
    expect(fake.parses).toBe(0);
    expect(app.state().error).toBe(`IMG_0001.jpg: ${BINARY_MESSAGE}`);
    expect(root.querySelector('.start-error')!.textContent).toBe(`IMG_0001.jpg: ${BINARY_MESSAGE}`);

    // 글 파일이면 확장자가 낯설어도 연다(내용으로 판별)
    const text = new TextEncoder().encode('G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X20 Y10\nM30\n');
    const ok = { name: 'program.txt', size: text.length, slice: () => ({ arrayBuffer: async () => text.slice().buffer }), arrayBuffer: async () => text.slice().buffer } as unknown as File;
    expect(await app.openFile(ok)).toBe(true);
    expect(app.state().docName).toBe('program.txt');
  });
});

describe('최근 문서(시작 화면)', () => {
  const card = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('.start .recent')!;
  const rows = (root: HTMLElement): HTMLLIElement[] => [...root.querySelectorAll<HTMLLIElement>('.recent-item')];
  const names = (root: HTMLElement): string[] => rows(root).map((li) => li.querySelector('.recent-name')!.textContent ?? '');

  it('비어 있으면 카드를 숨기고, 고른 파일이 열리면 이름·크기·시각을 보인다 — 예제·열리지 않은 파일은 두지 않는다', async () => {
    const backend = memoryBackend();
    const { app, root } = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(card(root).hidden).toBe(true));
    // 열기 상자 바로 아래, 지원 형식 앞
    expect(card(root).previousElementSibling?.classList.contains('start-error')).toBe(true);
    expect(card(root).nextElementSibling?.classList.contains('formats')).toBe(true);
    expect(card(root).textContent).toContain('이 기기의 이 브라우저에만 저장하며 서버로 보내지 않습니다');

    expect(await app.openSample()).toBe(true);
    const bad = textFile('comment-only.nc', '(no moves)\n');
    expect(await makeApp(true, true, false, backend).app.openFile(bad)).toBe(false);
    expect(backend.entries.size).toBe(0);

    const { app: app2, root: root2 } = makeApp(true, true, false, backend);
    expect(await app2.openFile(textFile('part.nc', PROGRAM))).toBe(true);
    await vi.waitFor(() => expect(backend.entries.size).toBe(1));
    expect([...backend.entries.keys()]).toEqual([recentId('part.nc', PROGRAM.length)]);
    await vi.waitFor(() => expect(names(root2)).toEqual(['part.nc']));
    expect(card(root2).hidden).toBe(false);
    const row = rows(root2)[0]!;
    expect(row.querySelector('.recent-meta')!.textContent).toMatch(new RegExp(`^${PROGRAM.length} B · `));
    // 파일 이름·크기·시각은 번역하지 않는다
    expect(row.querySelector('.recent-name')!.getAttribute('translate')).toBe('no');
    expect(row.querySelector('.recent-meta')!.getAttribute('translate')).toBe('no');
  });

  it('다시 읽은 페이지(탭이 버려졌다 돌아옴)에서 줄을 누르면 그 파일을 다시 열고 맨 앞으로 올린다', async () => {
    const backend = memoryBackend();
    const first = makeApp(true, true, false, backend);
    expect(await first.app.openFile(textFile('a.nc', PROGRAM))).toBe(true);
    expect(await first.app.openFile(textFile('b.nc', `${PROGRAM}\n`))).toBe(true);
    await vi.waitFor(() => expect(backend.entries.size).toBe(2));
    for (const [i, v] of [...backend.entries.values()].entries()) v.entry.time = 1000 + i;

    // 새로 읽은 페이지: 문서 없이 시작 화면
    const { app, root } = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(names(root)).toEqual(['b.nc', 'a.nc']));
    expect(app.state().docName).toBeNull();
    const before = fake.parses;
    rows(root)[1]!.querySelector<HTMLButtonElement>('.recent-open')!.click();
    await vi.waitFor(() => expect(app.state().docName).toBe('a.nc'));
    expect(fake.parses).toBe(before + 1);
    expect(app.state().parsed).toBe(true);
    await vi.waitFor(() => expect(names(root)).toEqual(['a.nc', 'b.nc']));
  });

  it('✕는 그 항목만, 모두 지우기는 전부 지우고 비면 카드를 숨긴다(손가락 기기 줄은 CSS로 44px 이상)', async () => {
    const backend = memoryBackend();
    const store = new RecentStore(backend);
    await store.add('a.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer, 1);
    await store.add('b.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer, 2);
    await store.add('c.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer, 3);
    const { root } = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(names(root)).toEqual(['c.nc', 'b.nc', 'a.nc']));

    const del = rows(root)[1]!.querySelector<HTMLButtonElement>('.recent-del')!;
    expect(label(del)).toBe('최근 문서에서 b.nc 지우기');
    expect(del.type).toBe('button');
    del.focus();
    del.click();
    await vi.waitFor(() => expect(names(root)).toEqual(['c.nc', 'a.nc']));
    // 초점은 다음 항목의 지우기 단추로
    expect(document.activeElement).toBe(rows(root)[1]!.querySelector('.recent-del'));

    const clear = [...root.querySelectorAll<HTMLButtonElement>('.recent button')].find((b) => b.textContent === '모두 지우기')!;
    clear.click();
    await vi.waitFor(() => expect(card(root).hidden).toBe(true));
    expect(backend.entries.size).toBe(0);
    expect(rows(root)).toHaveLength(0);
  });

  it('카드의 글·설명·알림은 네 언어 사전에 있고, 파일 이름은 번역하지 않고 그대로 넣는다', async () => {
    const backend = memoryBackend();
    const name = '부품 가공 1.nc';
    await new RecentStore(backend).add(name, new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer, 1);
    const { root } = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(names(root)).toEqual([name]));
    const texts = new Set<string>([
      `${name}: 이 브라우저에 저장된 내용을 찾지 못해 최근 문서에서 지웠습니다.`,
      `${name}: 이 브라우저에 저장된 내용을 읽지 못했습니다. 잠시 뒤 다시 눌러 보십시오.`,
      '최근 문서를 모두 지웠습니다.',
      '최근 문서를 지우지 못했습니다. 잠시 뒤 다시 해 보십시오.',
      '최근 문서 읽는 중…',
    ]);
    const walk = (el: Element): void => {
      if (el.getAttribute('translate') === 'no') return;
      for (const a of ['title', 'aria-label']) if (el.hasAttribute(a)) texts.add(el.getAttribute(a)!);
      for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) texts.add(n.textContent!.trim());
        else if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
      }
    };
    walk(card(root));
    expect(texts.size).toBeGreaterThanOrEqual(10);
    for (const lang of ['en', 'ja', 'zh-CN', 'de']) {
      for (const t of texts) {
        const out = translate(t, lang);
        if (t.includes(name)) expect(out, `${lang}: ${t}`).toContain(name);
        expect(out.replace(name, ''), `${lang}: ${t}`).not.toMatch(/[가-힣]/);
      }
    }
  });

  it('내용을 못 찾은 항목은 알리고 목록에서 지운다 · 저장소를 못 쓰면(비공개 창) 카드 없이 그냥 연다', async () => {
    const backend = memoryBackend();
    const store = new RecentStore(backend);
    await store.add('gone.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer, 1);
    const { app, root } = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(names(root)).toEqual(['gone.nc']));
    backend.entries.get(recentId('gone.nc', PROGRAM.length))!.data = null as unknown as ArrayBuffer;
    rows(root)[0]!.querySelector<HTMLButtonElement>('.recent-open')!.click();
    await vi.waitFor(() => expect(card(root).hidden).toBe(true));
    expect(app.state().docName).toBeNull();
    expect(root.querySelector('.start-error')!.textContent).toContain('gone.nc: 이 브라우저에 저장된 내용을 찾지 못해');

    const blocked = memoryBackend();
    blocked.fail = true;
    const b = makeApp(true, true, false, blocked);
    expect(await b.app.openFile(textFile('part.nc', PROGRAM))).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(card(b.root).hidden).toBe(true);
  });

  const enc = (t: string): ArrayBuffer => new TextEncoder().encode(t).buffer as ArrayBuffer;

  it('잠깐 못 읽으면(연결 끊김·메모리 부족) 항목을 두고 다시 해 보라고 알린다', async () => {
    const backend = memoryBackend();
    await new RecentStore(backend).add('keep.nc', enc(PROGRAM), 1);
    const { app, root } = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(names(root)).toEqual(['keep.nc']));
    const read = backend.read;
    backend.read = async () => {
      throw new DOMException('Connection to Indexed Database server lost', 'UnknownError');
    };
    rows(root)[0]!.querySelector<HTMLButtonElement>('.recent-open')!.click();
    await vi.waitFor(() => expect(root.querySelector('.start-error')!.textContent).toBe('keep.nc: 이 브라우저에 저장된 내용을 읽지 못했습니다. 잠시 뒤 다시 눌러 보십시오.'));
    expect(app.state().busy).toBe(false);
    expect(app.state().docName).toBeNull();
    expect(backend.entries.size).toBe(1);
    expect(names(root)).toEqual(['keep.nc']);
    // 다시 누르면 열린다
    backend.read = read;
    rows(root)[0]!.querySelector<HTMLButtonElement>('.recent-open')!.click();
    await vi.waitFor(() => expect(app.state().docName).toBe('keep.nc'));
  });

  it('읽는 동안 덮개(취소 가능)를 보이고, 그 사이 다른 파일을 열거나 취소하면 늦게 온 최근 문서는 버린다', async () => {
    const backend = memoryBackend();
    await new RecentStore(backend).add('old.nc', enc(PROGRAM), 1);
    const { app, root } = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(names(root)).toEqual(['old.nc']));
    const read = backend.read;
    let release = (): void => {};
    backend.read = async (id) => {
      await new Promise<void>((r) => (release = r));
      return read(id);
    };
    const open = (): void => rows(root)[0]!.querySelector<HTMLButtonElement>('.recent-open')!.click();

    open();
    expect(app.state().busy).toBe(true);
    expect(app.state().stage).toBe('최근 문서 읽는 중');
    expect(root.querySelector('.busy-stage')!.textContent).toBe('최근 문서 읽는 중…');
    expect(root.querySelector('.busy-name')!.textContent).toBe('old.nc');
    // 그 사이 다른 파일을 열었다
    const before = fake.parses;
    expect(await app.openFile(textFile('new.nc', `${PROGRAM}\n`))).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(app.state().docName).toBe('new.nc');
    expect(fake.parses).toBe(before + 1);

    // 취소(덮개의 취소·Esc)해도 버린다
    const second = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(names(second.root)[0]).toBeDefined());
    second.root.querySelector<HTMLButtonElement>('.recent-open')!.click();
    expect(second.app.state().busy).toBe(true);
    expect(second.app.cancelLoad()).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(second.app.state().busy).toBe(false);
    expect(second.app.state().docName).toBeNull();
    expect(second.app.state().error).toBeNull();
  });

  it('지우기에 실패하면 성공이라고 하지 않고 실패를 알린다(항목은 그대로)', async () => {
    const backend = memoryBackend();
    await new RecentStore(backend).add('a.nc', enc(PROGRAM), 1);
    const { root } = makeApp(true, true, false, backend);
    await vi.waitFor(() => expect(names(root)).toEqual(['a.nc']));
    backend.clear = async () => {
      throw new DOMException('lost', 'UnknownError');
    };
    backend.remove = backend.clear;
    vi.mocked(toast).mockClear();
    [...root.querySelectorAll<HTMLButtonElement>('.recent button')].find((b) => b.textContent === '모두 지우기')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('최근 문서를 지우지 못했습니다. 잠시 뒤 다시 해 보십시오.', 'error', 5000));
    expect(toast).not.toHaveBeenCalledWith('최근 문서를 모두 지웠습니다.', 'info', 2500);
    rows(root)[0]!.querySelector<HTMLButtonElement>('.recent-del')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(names(root)).toEqual(['a.nc']);
    expect(card(root).hidden).toBe(false);
  });
});
