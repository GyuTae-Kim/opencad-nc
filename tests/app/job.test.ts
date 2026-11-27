// @vitest-environment jsdom
/**
 * 여러 파일을 한 작업으로(app.ts·panel.ts·doc.ts): 여러 개 고르기·끌어다 놓기, 주 프로그램 바꾸기, 작업 파일 목록,
 * 찾지 못한 프로그램 띠와 파일 더하기, 최근 문서. 뷰어 코어(WebGL)는 가짜로, 해석은 워커와 같은 길(parseForView)로 바로 부른다.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import { jobLineOf, jobLineToGlobal, lineAtLabel, lineLabel, lineNumberText } from '../../src/app/doc';
import { jobLineText } from '../../src/app/payload';
import { plainText } from '../../src/app/filetext';
import { RecentStore } from '../../src/app/recent';
import { memoryBackend, type MemoryBackend } from './recent-memory';

const ROOT = resolve(__dirname, '../..');

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
  // 첫 열기는 코어 모듈을 처음 받느라 오래 걸릴 수 있다(기계가 바쁘면 틱 50번으로 모자람) — 시간으로 5초까지
  const end = Date.now() + 5000;
  for (let i = 0; (i < 50 || Date.now() < end) && !ok(); i++) await tick();
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
    expect(items.map((b) => b.textContent)).toEqual(['주 프로그램main.nc', '함께 연 파일O1001.nc', '함께 연 파일1002.nc']);
    // 파일을 누르면 코드 탭에서 그 파일이 시작하는 줄(표지 줄)로 — 175차: 키보드로 누르면(초점이 그 버튼) 초점은 새 몸통의 코드 목록으로
    items[1]!.focus();
    items[1]!.click();
    expect(window.opencadApp!.state.panelTab).toBe('code');
    expect(window.opencadApp!.state.selLine).toBe(11);
    expect(document.activeElement).toBe(root.querySelector('.panel-body .code-list'));
    // 최근 문서: 이은 글을 주 프로그램 이름으로, 파일 수와 함께
    await until(() => recent.entries.size > 0);
    const saved = [...recent.entries.values()];
    expect(saved.map((e) => [e.entry.name, e.entry.files])).toEqual([['main.nc', 3]]);
  });

  it('경고·코드 줄 번호·상태는 원래 파일의 줄(파일 이름 + 줄), ":4"는 고른 줄이 있는 파일의 4번 줄로', async () => {
    const SUB = `%\nO1001 (SUB A)\nG1 Z-1 F100\nG22 X1 Y1\nX10\nG0 Z5\nM99\n%\n`;
    const { app, root } = makeApp();
    await app.openFiles([textFile('main.nc', MAIN), textFile('O1001.nc', SUB), textFile('1002.nc', SUB_B)]);
    window.opencadApp!.setPanelTab('info');
    const w = [...root.querySelectorAll<HTMLButtonElement>('.warn-list .warn-item')].find((b) => b.textContent!.includes('G22'))!;
    // 이은 글의 16번째 줄(표지 줄 12 + 4) = O1001.nc의 4번 줄
    expect(w.querySelector('.ln')!.textContent).toBe('O1001.nc · 4번 줄');
    w.click();
    expect(window.opencadApp!.state.selLine).toBe(15);
    expect(root.querySelector('.st-sel')!.textContent).toContain('O1001.nc · 줄 4');
    // 코드 줄 번호 칸: 주 프로그램은 그대로, 함께 연 파일은 그 파일 안 번호(표지 줄은 비움)
    const job = { main: 'main.nc', files: ['main.nc', 'O1001.nc', '1002.nc'], starts: [0, 11, 20], skipped: [] };
    expect([5, 11, 12, 15, 20, 21].map((l) => lineNumberText({ job }, l))).toEqual(['6', '', '1', '4', '', '1']);
    expect(lineNumberText({ job: null }, 15)).toBe('16');
    // 파일 이름은 파일 글(번역하지 않는 자리 — 54차)
    expect(lineAtLabel({ job }, 21)).toEqual([{ file: '1002.nc' }, ' · 1번 줄']);
    expect(plainText(lineLabel({ job }, 3))).toBe('main.nc · 줄 4');
    expect(lineLabel({ job: null }, 3)).toEqual(['줄 4']);
    expect(jobLineOf({ ...job, files: ['main.nc'] }, 3)).toBeNull();
    // ":4"(줄로 가기): 고른 줄이 있는 파일의 4번 줄, 그 파일 범위 밖이면 그 파일 끝
    expect(jobLineToGlobal(job, 1, 4)).toBe(15);
    expect(jobLineToGlobal(job, 1, 99)).toBe(19);
    expect(jobLineToGlobal(job, 0, 4)).toBe(3);
    expect(jobLineToGlobal(null, 0, 4)).toBe(3);
    // 글 하나에 끼우는 줄 표기(62차 — 보정 경로 경고)
    expect([3, 15, 21].map((l) => jobLineText(job, l))).toEqual(['main.nc · 4', 'O1001.nc · 4', '1002.nc · 1']);
    expect(jobLineText({ ...job, files: ['main.nc'], starts: [0] }, 15)).toBe('16');
  });

  it('공구 표의 "처음 나온 줄" 풍선 글도 그 파일 안의 줄(62차)', async () => {
    const SUB = 'O1001\nT7 M6\nG1 Z-1 F100\nM99\n';
    const { app, root } = makeApp();
    await app.openFiles([textFile('main.nc', MAIN), textFile('O1001.nc', SUB)]);
    window.opencadApp!.setPanelTab('tools');
    const titles = [...root.querySelectorAll('tr.clickable')].map((r) => r.getAttribute('title'));
    // T1은 주 프로그램 4번 줄, T7은 O1001.nc 2번 줄(이은 글에서는 13번째 줄)
    expect(titles[0]).toBe('처음 나온 줄 4');
    expect(titles[1]).toMatch(/^처음 나온 줄 2( · |$)/);
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

  it('142차: 주 프로그램 고르기의 풀이(title)는 감싼 label과 고르기 자신에 함께 — 고르기에 초점을 두면 화면 읽기가 설명으로 읽음(이름은 aria-label 그대로)', async () => {
    const { app, root } = makeApp();
    await app.openFiles([textFile('main.nc', MAIN), textFile('O1001.nc', SUB_A), textFile('1002.nc', SUB_B)]);
    window.opencadApp!.setPanelTab('info');
    const sel = root.querySelector<HTMLSelectElement>('select[aria-label="주 프로그램"]')!;
    // HTML-AAM 설명 차례는 aria-describedby → 고르기 자신의 title(감싼 label의 title은 쓰지 않음)
    const tip = '부르는 쪽(M98·G65 P, CALL PGM, Siemens 이름 부르기)을 처음부터 실행할 파일';
    expect([sel.closest('label')!.getAttribute('title'), sel.getAttribute('title'), sel.getAttribute('aria-label')]).toEqual([tip, tip, '주 프로그램']);
  });

  it('145차: 주 프로그램 고르기의 풀이도 고르기 바로 밑에 같은 글의 손가락 기기 안내 줄(127차 coarse-only) — 풍선 글뿐이라 휴대폰·태블릿에서 볼 수 없었다', async () => {
    const { app, root } = makeApp();
    await app.openFiles([textFile('main.nc', MAIN), textFile('O1001.nc', SUB_A), textFile('1002.nc', SUB_B)]);
    window.opencadApp!.setPanelTab('info');
    const sel = root.querySelector<HTMLSelectElement>('select[aria-label="주 프로그램"]')!;
    const tip = '부르는 쪽(M98·G65 P, CALL PGM, Siemens 이름 부르기)을 처음부터 실행할 파일';
    const n = sel.closest('label')!.nextElementSibling;
    expect([n?.tagName, n?.className, n?.textContent]).toEqual(['P', 'hint coarse-only', tip]);
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

  it('띠 ✕를 키보드로 누르면(초점이 그 버튼) 초점은 남은 안내의 같은 차례(모자라면 마지막) 줄의 ✕로, 띠가 숨으면 3D 보기로(176차)', async () => {
    const { app, root } = makeApp();
    const both = (): Promise<boolean> => app.openFiles([textFile('main.nc', MAIN), textFile('O1001.nc', SUB_A)]);
    const btn = (k: string, x = true): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[data-notice=${k}] .mb-btn${x ? '.icon' : ':not(.icon)'}`)!;
    await both();
    expect(notices(root)).toEqual(['job', 'missing-program']);
    // 코어 캔버스는 키보드 초점을 받는다(tabIndex 0 — 가짜 뷰어는 캔버스만 만든다)
    const canvas = root.querySelector<HTMLCanvasElement>('.v3d canvas')!;
    canvas.tabIndex = 0;
    // 둘째(마지막) 줄 ✕ → 남은 줄이 하나라 그 마지막 줄의 ✕
    btn('missing-program').focus();
    btn('missing-program').click();
    expect(notices(root)).toEqual(['job']);
    expect(document.activeElement).toBe(btn('job'));
    // 새 문서는 전처럼 3D 보기로(setDoc) — 첫 줄 ✕ → 같은 번째(이제 첫 줄)의 ✕
    await both();
    expect(document.activeElement).toBe(canvas);
    btn('job').focus();
    btn('job').click();
    expect(notices(root)).toEqual(['missing-program']);
    expect(document.activeElement).toBe(btn('missing-program'));
    // 띠를 다시 그리면(언어 바꿈) 동작 버튼은 같은 줄 동작 버튼으로
    btn('missing-program', false).focus();
    root.dispatchEvent(new CustomEvent('languagechange', { detail: 'ko' }));
    expect(document.activeElement).toBe(btn('missing-program', false));
    // 마지막 안내 ✕ → 띠가 숨어 3D 보기로
    btn('missing-program').focus();
    btn('missing-program').click();
    expect(root.querySelector<HTMLElement>('.notice-bar')!.hidden).toBe(true);
    expect(document.activeElement).toBe(canvas);
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

describe('패널 재생 칸 줄 글(190차)', () => {
  it('190차: 여러 파일 작업의 줄 글(「파일 · 줄 N」)은 줄을 바꾸지 않아(.mono-dim nowrap) 파일 이름이 길면 재생 칸보다 넓어져 오른쪽(줄 번호)이 잘리고 낮은 창 시트(186차 굴림 상자)는 가로로 굴던 것을 — 남는 폭이 모자랄 때만 줄 글을 감아(WCAG 1.4.10), 넉넉하면 한 줄 그대로', async () => {
    const LONG = 'O1000_bracket_left_side_finishing_op20.nc';
    const MAIN2 = `%\nO1000 (MAIN)\nG21 G17 G90 G54\nT1 M6\nS1000 M3\nG0 X0 Y0 Z5\nG1 Z-1 F100\nX20\nM98 P1001\nM30\n%\n`;
    const { app, root } = makeApp();
    await app.openFiles([textFile(LONG, MAIN2), textFile('O1001.nc', SUB_A)]);
    app.togglePanel(true);
    app.stepMove(1);
    // 실제 칸(panel.ts buildPlay): 재생 막대 줄 끝 play-info 안 mono-dim 둘(시간·줄) — 줄 글은 주 프로그램 파일 이름과 그 파일 안 줄
    const info = root.querySelector<HTMLElement>('aside.panel > .play > .play-row > .play-info')!;
    const spans = [...info.children] as HTMLElement[];
    const text = spans[1]!.textContent!;
    expect([window.opencadApp!.state.jobFiles?.length, spans.length, spans.every((s) => s.matches('span.mono-dim')), text.startsWith(`${LONG} · 줄 `), /^\d$/.test(text.slice(LONG.length + 5))]).toEqual([
      2,
      2,
      true,
      true,
      true,
    ]);
    // jsdom은 CSS를 그리지 않아 styles.css 글로 본다(186차 꼴): 주석을 뺀 글의 맨 바깥 규칙과 @media 덩어리(조건 글로 고름)
    const raw = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const media = /@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
    const decl = (b: string): Record<string, string> =>
      Object.fromEntries(b.split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k!.trim(), v.join(':').trim()]));
    const parse = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()), body: decl(m[2]!) }));
    const pick = (rules: ReturnType<typeof parse>, sel: string): Record<string, string> => Object.assign({}, ...rules.filter((r) => r.sels.includes(sel)).map((r) => r.body));
    const at = (q: string) => [...raw.matchAll(media)].filter((m) => m[1]!.trim() === q).flatMap((m) => parse(m[2]!));
    const wide = parse(raw.replace(media, ''));
    const [narrow, low] = [at('(max-width: 759.98px)'), at('(max-width: 759.98px) and (max-height: 499.98px)')];
    const o = (sel: string): Record<string, string> => pick(wide, sel);
    const n = (sel: string): Record<string, string> => ({ ...o(sel), ...pick(narrow, sel) });
    const px = (v: string | undefined): number => parseFloat(v ?? '0') || 0;
    // 줄 글 꼴: .mono-dim(11.5px 고정폭)에 play-info 안 규칙을 겹침. 글 폭 어림 — 한글 1em(고정폭 글꼴에 없어 대신 글꼴), 그 밖 0.6em
    const line = { ...o('.mono-dim'), ...o('.play-info .mono-dim') };
    const em = px(line.font);
    const cw = (c: string): number => (/[ㄱ-ㆎ가-힣]/.test(c) ? 1 : 0.6) * em;
    const width = (s: string): number => [...s].reduce((a, c) => a + cw(c), 0);
    // 최소 내용 폭(flex 항목 play-info가 줄 수 있는 끝): 줄을 바꾸지 않으면 글 전체, 감으면 빈칸 사이 낱말 — overflow-wrap: anywhere면 글자 하나
    const minContent = (s: string): number =>
      line['white-space'] === 'nowrap' ? width(s) : line['overflow-wrap'] === 'anywhere' ? Math.max(...[...s].map(cw)) : Math.max(...s.split(' ').map(width));
    // 줄 칸 폭 = 패널(border-box) − 왼쪽 테두리(넓은 화면 옆 패널만) − .play 좌우 여백. 넓은 화면 패널은 손잡이 「작게」 260·CSS 기본 380(panel.ts), 좁은 화면은 창 폭
    const side = o('.play').padding!.split(' ').map(px);
    const inner = (w: number, sel: (s: string) => Record<string, string>): number => w - px(sel('.panel')['border-left']) - 2 * side[1]!;
    const rows = [
      { at: '넓은 화면 작게 260', w: inner(260, o), low: false },
      { at: '넓은 화면 보통 380', w: inner(380, o), low: false },
      { at: '320', w: inner(320, n), low: false },
      { at: '320 낮은 창', w: inner(320, n), low: true },
      { at: '360', w: inner(360, n), low: false },
      { at: '390', w: inner(390, n), low: false },
    ];
    expect([em, Math.round(width(text) * 10) / 10, ...rows.map((r) => r.w)]).toEqual([11.5, 328.9, 243, 363, 304, 304, 344, 374]);
    // 넘친 몫: 옆 패널·높은 창 시트는 작업 영역(overflow: hidden)이 잘라 줄 번호가 먼저 사라지고, 낮은 창 시트는 굴림 상자(overflow-y: auto라 x도 auto)라 시트가 가로로 굴렀다
    const scrolls = pick(low, '.panel')['overflow-y'] === 'auto' && !o('.panel')['overflow-x'];
    const bad: string[] = [];
    for (const r of rows) {
      const over = minContent(text) - r.w;
      if (over > 0) bad.push(`${r.at}: ${r.low && scrolls ? '시트 가로 굴림' : '잘림'} ${Math.round(over)}px`);
    }
    expect(bad).toEqual([]);
    // 고친 길: play-info 안 두 글만 감고(찾기 줄 수 .mono-dim은 그대로), 넉넉한 폭은 한 줄 그대로(최대 내용 폭은 같은 글 — 줄 나누기 차례도 그대로)
    expect([o('.mono-dim')['white-space'], o('.play-info .mono-dim'), rows.filter((r) => width(text) <= r.w).map((r) => r.at)]).toEqual([
      'nowrap',
      { 'white-space': 'normal', 'overflow-wrap': 'anywhere' },
      ['넓은 화면 보통 380', '360', '390'],
    ]);
  });
});
