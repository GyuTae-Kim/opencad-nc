// @vitest-environment jsdom
/**
 * 파일에서 온 글(이름 붙은 공구·작업 파일 이름·찾지 못한 프로그램·판재 가공 이름·줄 원문)이 화면 번역층에 바뀌지 않는지(54차).
 * 번역층은 사전 열쇠와 같은 글 마디를 통째로 바꾸고(가공 이름 "무늬" → "Texture"), 다른 언어 사전의 번역 글을 원문으로 되찾으며
 * (일본어 화면의 "Texture" → "テクスチャ"), 틀이 맞지 않으면 " · "·" — "로 나눈 조각마다 옮긴다(공구 "무늬 · 연구" → "Texture · 연구").
 * 사전 열쇠·번역 글·나눔 글·HTML 같은 이름을 가진 합성 프로그램을 영어·독일어·일본어·중국어 화면으로 열어 패널(공구·정보·가공 탭, 아래 띠, 재생 막대)·
 * 상태 줄·안내 띠·재생 띠를 돌며, 번역층이 이름이었던 글 마디·속성을 다른 글로 바꾼 일이 없는지와 앱 글은 옮겨지는지 본다.
 * 뷰어 코어(WebGL)는 가짜로, 해석은 워커와 같은 길(parseForView)로 바로 부른다(job.test.ts와 같은 꼴).
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
  return { FakeViewer };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown, _progress: unknown, extra: { name: string; bytes: ArrayBuffer }[] = []) {
      return parseForView(name, new Uint8Array(data), (opts ?? {}) as object, () => {}, extra.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })));
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';
import { createDoc, itemName, lineLabel, opLabel } from '../../src/app/doc';
import { filePrefix, fileText, joinMixed, mix, plainText } from '../../src/app/filetext';
import { installLocalization, mixNodes, mixText } from '../../src/app/i18n';
import { parseForView } from '../../src/app/payload';
import { translate } from '../../site/i18n.mjs';

const XSS = '<img src=x onerror="window.__xss=1">';
/** 사전 열쇠(무늬·바둑판·연구)·다른 언어 번역 글(Texture·Textur·テクスチャ·纹理)·나눔 글을 품은 이름·HTML 같은 이름 */
const NAMES = ['무늬', '바둑판', '연구', 'Texture', 'Textur', 'テクスチャ', '纹理', '무늬 · 연구', 'Research — 바둑판', XSS];

// Siemens: 이름 공구(T="…"), 주석, 없는 부프로그램
const SIE = ['; 무늬 · 연구', 'G71 G17 G90', 'T="무늬" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'T="무늬 · 연구" D1', 'M6', 'G1 Y20', `T="${XSS}" D1`, 'M6', 'G1 X0', 'T="Research — 바둑판" D1', 'M6', 'G1 Y0', 'L9001', 'M30', ''].join('\n');
// woodWOP MPR: 가공 이름(MNM)이 열쇠·번역 글·나눔 글
const MPR = `[H\nVERSION="4.0 Alpha"\n_BSX=600.000000\n_BSY=400.000000\n_BSZ=19.000000\n\n<100 \\WerkStck\\\nLA="600"\nBR="400"\nDI="19"\n\n${['무늬', 'Texture', 'Textur', 'テクスチャ', '纹理', '무늬 · 연구'].map((m, i) => `<102 \\BohrVert\\\nXA="${100 + 50 * i}"\nYA="100"\nTI="12"\nDU="8"\nMNM="${m}"\n`).join('\n')}`;
// 여러 파일 작업: 파일 이름에 열쇠·나눔 글
const MAIN = '%\nO1000 (MAIN)\nT1 M6 (T1 D=6. 무늬)\nG0 X0 Y0 Z5\nG1 Z-1 F100\nM98 P2000\nG0 Z50\nM30\n%\n';
const SUB = '%\nO2000 (SUB)\nG1 X20 F100\nY20\nX0\nM99\n%\n';

/**
 * 번역층이 글을 바꾸는 길(글 마디 nodeValue 쓰기·붙은 요소의 setAttribute)만 가로채(앱은 textContent·새 요소·title 속성으로 쓴다),
 * 이름이었던 글이 그 이름을 잃은 바뀜을 모은다(조각 — " · "·" — "·": ·괄호·따옴표로 나눈 것 — 가운데 하나가 이름이고 새 글에 그 조각이 없으면)
 */
function watch(): { hits: string[]; layer: number[]; stop: () => void } {
  const names = new Set(NAMES);
  const toks = (s: string | null): string[] => (s ?? '').split(/\n| · | \| | — |: |[()"]/).map((x) => x.trim()).filter(Boolean);
  const hits: string[] = [];
  const layer = [0, 0];
  const check = (old: string | null, now: string | null, where: string, k: number): void => {
    if (old === null || old === now) return;
    layer[k]!++;
    const t = new Set(toks(now));
    for (const n of new Set([...toks(old), old.trim()])) if (names.has(n) && !t.has(n) && !(n.length > 2 && (now ?? '').includes(n))) hits.push(`${where}: ${old} → ${now}`);
  };
  const nv = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeValue')!;
  Object.defineProperty(Node.prototype, 'nodeValue', {
    configurable: true,
    get: nv.get,
    set(v: string) {
      check(nv.get!.call(this), v, ((this as Node).parentElement?.className as string) || 'text', 0);
      nv.set!.call(this, v);
    },
  });
  const sa = Element.prototype.setAttribute;
  const WATCH = new Set(['title', 'aria-label', 'alt']);
  Element.prototype.setAttribute = function (this: Element, n: string, v: string) {
    if (WATCH.has(n) && this.isConnected) check(this.getAttribute(n), String(v), `${this.tagName}@${n}`, 1);
    return sa.call(this, n, v);
  };
  return {
    hits,
    layer,
    stop: () => {
      Object.defineProperty(Node.prototype, 'nodeValue', nv);
      Element.prototype.setAttribute = sa;
    },
  };
}

const tick = async (k = 4): Promise<void> => {
  for (let i = 0; i < k; i++) await new Promise((r) => setTimeout(r, 0));
};
const enc = new TextEncoder();

function makeApp(): { app: NcViewerApp; root: HTMLElement } {
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root), root };
}

let dispose: (() => void) | undefined;
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
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('파일 글을 앱 글과 섞기(filetext·mixText)', () => {
  it('mix·joinMixed·plainText·filePrefix: 파일 글 자리와 원문', () => {
    const m = mix`공구 ${fileText('무늬 · 연구')} · 줄 ${12}`;
    expect(m).toEqual(['공구 ', { file: '무늬 · 연구' }, ' · 줄 12']);
    expect(plainText(joinMixed([m, ['이동 3']]))).toBe('공구 무늬 · 연구 · 줄 12 · 이동 3');
    expect(filePrefix('무늬 이송', '무늬')).toEqual([{ file: '무늬' }, ' 이송']);
    expect(filePrefix('T1 이송', undefined)).toEqual(['T1 이송']);
  });

  it('줄 이름·장면 항목 이름·판재 가공 이름: 파일 글 자리', () => {
    const job = { main: '무늬 · 연구.nc', files: ['무늬 · 연구.nc', 'Texture — 바둑판.nc'], starts: [0, 9], skipped: [] };
    expect(lineLabel({ job }, 10)).toEqual([{ file: 'Texture — 바둑판.nc' }, ' · 줄 1']);
    const sie = createDoc('a.mpf', 1, parseForView('a.mpf', enc.encode(SIE)));
    const named = sie.scene.lines.find((l) => l.group === '무늬 · 연구')!;
    expect(itemName(sie, named.id, named.name, named.group)).toEqual([{ file: '무늬 · 연구' }, ' 이송']);
    expect(itemName(sie, 'nc-rapid', '급속 이송', '급속 이송')).toEqual(['급속 이송']);
    expect(itemName(sie, 'sim-stock', undefined, undefined)).toEqual(['깎인 소재']);
    const mpr = createDoc('a.mpr', 1, parseForView('a.mpr', enc.encode(MPR)));
    expect(opLabel(mpr, { label: '무늬', kind: 'drillV' })).toEqual({ file: '무늬' });
    expect(opLabel({ kind: 'pgi' }, { label: '수직 드릴 Ø5 × 13', kind: 'drillV' })).toBe('수직 드릴 Ø5 × 13');
  });

  it('지금 언어로 옮기되 파일 글은 그대로(사전 열쇠·나눔 글이어도), 마디는 translate="no" 묶음', async () => {
    history.replaceState(null, '', '/opencad-nc/en/');
    dispose = await installLocalization(document.body);
    // 예전 꼴(한 글로 이은 것)은 이름까지 바뀌었다
    expect(translate('무늬 · 연구.nc · 줄 2 · 이동 없음', 'en')).toBe('Texture · 연구.nc · Line 2 · No move');
    expect(mixText(mix`${fileText('무늬 · 연구.nc')} · 줄 2 · 이동 없음`)).toBe('무늬 · 연구.nc · Line 2 · No move');
    const hide = mixText(mix`${fileText('무늬')} 숨기기`);
    expect(hide).toContain('무늬');
    expect(hide).not.toContain('숨기기');
    const nodes = mixNodes(mix`다른 파일의 프로그램 ${fileText('무늬 · 바둑판')}을(를) 찾지 못했습니다 — 그 파일을 더하면 이어서 그립니다.`);
    const span = nodes.find((x): x is HTMLElement => typeof x !== 'string')!;
    expect(span.getAttribute('translate')).toBe('no');
    expect(span.textContent).toBe('무늬 · 바둑판');
    expect(nodes.filter((x) => typeof x === 'string').join('')).not.toMatch(/[가-힣]/);
  });
});

describe('화면 번역이 파일 글을 바꾸지 않는다(네 언어와 언어 바꾸기)', () => {
  it.each(['en', 'de', 'ja', 'zh-CN'])('%s: 패널·상태 줄·안내 띠·재생 띠에서 이름 그대로, 앱 글은 옮긴다', async (lang) => {
    history.replaceState(null, '', `/opencad-nc/${lang}/`);
    const { app, root } = makeApp();
    const w = watch();
    dispose = await installLocalization(root);
    const api = window.opencadApp!;
    const tour = async (): Promise<void> => {
      api.togglePanel(true);
      for (const tab of ['tools', 'info', 'ops', 'vars', 'code']) {
        api.setPanelTab(tab);
        await tick();
      }
      for (const l of [0, 1, 3, 9, 12]) {
        api.selectLine(l);
        await tick();
      }
      api.seek(0);
      for (let k = 0; k < 8; k++) {
        api.stepMove(1);
        await tick(2);
      }
      api.togglePanel(false);
      await tick();
      api.togglePanel(true);
      api.seek(null);
      await tick();
    };
    await app.openBuffer('무늬.MPF', enc.encode(SIE).buffer as ArrayBuffer);
    await tour();
    // 이름 붙은 공구의 숨기기 단추 이름: 이름은 그대로, 앱 글은 옮긴다
    api.setPanelTab('tools');
    await tick();
    const eye = [...root.querySelectorAll('.grid.tools button.toggle')].map((b) => b.getAttribute('aria-label')!);
    expect(eye.some((l) => l.includes('무늬 · 연구'))).toBe(true);
    expect(eye.join('\n')).not.toContain('숨기기');
    // 찾지 못한 프로그램 띠
    const notice = root.querySelector('[data-notice=missing-program] .nt-text')!;
    expect(notice.textContent).toContain('L9001');
    expect(notice.textContent).not.toMatch(/찾지 못했습니다/);
    await app.openFiles([
      { name: '무늬 · 연구.nc', size: MAIN.length, slice: () => ({ arrayBuffer: async () => enc.encode(MAIN).buffer }), arrayBuffer: async () => enc.encode(MAIN).buffer } as unknown as File,
      { name: 'Texture — 바둑판.nc', size: SUB.length, slice: () => ({ arrayBuffer: async () => enc.encode(SUB).buffer }), arrayBuffer: async () => enc.encode(SUB).buffer } as unknown as File,
    ]);
    await tour();
    expect(root.querySelector('.st-sel')!.textContent).toContain('무늬 · 연구.nc');
    await app.openBuffer('바둑판.mpr', enc.encode(MPR).buffer as ArrayBuffer);
    await tour();
    api.setPanelTab('ops');
    await tick();
    const opNames = [...root.querySelectorAll('.panel-body tbody tr td:nth-child(2)')].map((td) => td.textContent);
    expect(opNames).toEqual(['무늬', 'Texture', 'Textur', 'テクスチャ', '纹理', '무늬 · 연구']);
    // 앱 글(패널 탭)은 그 언어로
    expect(root.querySelector('.panel-tab[data-tab=ops]')!.textContent).toBe(translate('가공', lang));
    // 언어를 바꿔도(다시 그린다) 이름은 그대로
    const other = lang === 'ja' ? 'de' : 'ja';
    document.querySelector<HTMLButtonElement>(`.language-list [data-language="${other}"]`)!.click();
    await tick(8);
    await app.openBuffer('무늬.MPF', enc.encode(SIE).buffer as ArrayBuffer);
    await tour();
    w.stop();
    expect(w.hits).toEqual([]);
    // 번역층은 앱 글을 계속 옮긴다(글 마디·속성)
    expect(w.layer[0]).toBeGreaterThan(100);
    expect(w.layer[1]).toBeGreaterThan(50);
    expect(document.querySelectorAll('img[src="x"], [data-xss]').length).toBe(0);
  });
});
