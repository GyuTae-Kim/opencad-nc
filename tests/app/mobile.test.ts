// @vitest-environment jsdom
/**
 * 휴대폰·터치 화면(app.ts): 좁은 화면 도구 막대, "보기 설정" 메뉴, 측정 띠, 손가락 기기의 파일 고르기·안내 글.
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
    section = null;
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
      if (parsed.kind === 'mpr') out.mpr = { lines: parsed.part.lines };
      else out.nc = ncPayload(parsed.program);
      return out;
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';
import { BINARY_MESSAGE } from '../../src/app/format';
import { measureHint, panelMeasureHint, statusMeasureHint } from '../../src/app/measure';

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

function makeApp(narrow = false, coarse = false, low = false): { app: NcViewerApp; root: HTMLElement } {
  media(narrow, coarse, low);
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root), root };
}

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
    const [clear, close] = [...bar.querySelectorAll<HTMLButtonElement>('.mb-btn')];
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
    expect(text()).toBe(measureHint(1, false));
    expect(clear!.disabled).toBe(false);

    v.emitMeasure({ distance: 50, dx: 30, dy: -40, dz: 0 });
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
    expect(root.querySelector('.panel-foot')!.textContent).toContain(panelMeasureHint(true));
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
    expect(fine).toEqual(['NC 파일을 여기에 끌어다 놓으십시오', '창 어디에 놓아도 열립니다. 한 번에 파일 하나를 엽니다.', expect.stringMatching(/^키: F 전체 보기/)]);
    expect(coarse).toEqual(['NC 파일을 골라 여십시오', '한 번에 파일 하나를 엽니다.', '한 손가락 끌기 회전 · 두 손가락 이동·확대 · 측정 중 길게 누르면 정밀 조준']);
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
