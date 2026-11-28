// @vitest-environment jsdom
/**
 * 231차(WCAG 4.1.3 상태 메시지): 초점을 옮기지 않고 나타나는 상태 글(결과·진행·오류·수)은 화면 읽기에 알려져야 하고(role=status·alert·aria-live 칸),
 * 같은 글이 짧은 사이에 거듭 알려지지 않아야 한다. 감사 표는 .runtime/r231/progress.md 표 1·2와 같은 줄.
 * - 소스 글: src에서 알림 칸을 두거나 그 꼴을 바꾸는 줄(aria-live·status·alert·log 따옴표 글 — 주석 줄 뺌)은 모두 LIVE_SITES에 —
 *   알림 칸이 표 밖에 새로 생기면 판정과 함께 표에 더해야 통과한다(timing230·hover-focus226 소스 셈과 같은 꼴).
 * - 고친 것(231차 F2): 상태 줄(footer 통째 live)·측정 띠 글·패널 아래 띠는 다시 그릴 때마다 통째로 새 마디를 넣어, 그대로인 문서 요약·경고 수·고른 줄·안내를
 *   거듭 넣었다 — 코드 목록 줄 옮김·같은 줄 다시 고르기·패널 다시 그리기(깎기 계산 사건마다 refreshPanel), 측정 중 포인터가 점에 머물러 코어가 끌어온 점을 기억하거나
 *   커서 아래 Shift로 잠글 방향이 바뀔 때마다(MeasureLock 열쇠 → renderStatus). dom.ts putLive가 앞에서부터 같은 마디는 두고 바뀐 마디만 바꾼다(언어가 바뀌면 통째로).
 *   (F1) 깎기 탭 상태 글 칸의 오류 아닌 글은 aria-live=off — tests/app/sim.test.ts 135·221차 시험이 본다(끝 글은 .sim-live 한 칸에만).
 * 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(mobile.test 꼴). 기다림은 마감 시간과 조건(13번).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Cb = (m: unknown) => void;
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    measurePts = 0;
    readonly measureCbs: Cb[] = [];
    viewCubeSize = 112;
    gridVisible = true;
    viewCubeVisible = true;
    axesVisible = true;
    section = null;
    /** 코어 측정 읽기(시험이 바꾼다): 미리 보기·잠금, 커서 아래 Shift로 잠글 방향, 거리 글상자 자리 */
    measureHoverSnap = null;
    measureInferenceLock = null;
    measureHoverLock: unknown = null;
    measureLabelRect = null;
    /** 끌어온 점(코어가 커서가 머무른 점을 기억한 것) */
    trackPts: number[][] = [];
    get measureTrackPoints(): number[][] {
      return this.trackPts.map((p) => [...p]);
    }
    constructor(host: HTMLElement) {
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
    }
    onMeasure(cb: Cb): () => void {
      this.measureCbs.push(cb);
      return () => {};
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
  const { loadNcFile } = await import('../../src/index');
  const { ncPayload } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer) {
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

import { NcViewerApp } from '../../src/app/app';
import { ARROW_LOCK_HINT, SHIFT_LOCK_HINTS } from '../../src/app/measure-lock';
import { loadPanelInfo } from '../../src/app/panel';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// ───────────────────────── 소스 글: 알림 칸 자리 ─────────────────────────

/** 알림 칸을 두거나 그 꼴을 바꾸는 줄(aria-live, 따옴표 안 status·alert·log) */
const LIVE_LINE = /aria-live|['"`](?:status|alert|log)['"`]/;
type Judge = '둠' | '고침' | '셈 밖';
/** [progress.md 표 1의 줄, 파일, 줄 조각, 줄 수, 칸, 판정] */
type Row = readonly [row: string, file: string, snip: string, n: number, what: string, judge: Judge];
const LIVE_SITES: readonly Row[] = [
  ['1', 'src/app/app.ts', "class: 'start-error', role: 'alert'", 1, '시작 화면 오류 칸 — 문서가 있으면 알림 상자만(showError 배타)', '둠'],
  ['2', 'src/app/app.ts', "class: 'busy-stage', role: 'status', 'aria-live': 'polite'", 1, '여는 중 단계 글 — 단계마다 다른 글, 비율은 aria-hidden 막대', '둠'],
  ['3', 'src/app/app.ts', "class: 'mb-text', 'aria-live': 'polite'", 1, '측정 띠 글 — 다시 그릴 때 바뀐 마디만(putLive)', '고침'],
  ['4', 'src/app/app.ts', "class: 'statusbar', 'aria-live': 'polite'", 1, '상태 줄(문서 요약·경고·고른 것 통째 live) — 바뀐 마디만(putLive)', '고침'],
  ['5', 'src/app/app.ts', "class: 'app-live', role: 'status', 'aria-live': 'polite'", 1, '첫 화면 알림 칸 — 판단 띠 새 줄·그래픽 잃음', '둠'],
  ['6', 'src/app/dom.ts', "class: 'toasts', 'aria-live': 'polite'", 1, '알림 상자(156차 빈 채로 미리)', '둠'],
  ['6', 'src/app/dom.ts', "role: kind === 'error' ? 'alert' : 'status'", 1, '알림마다 role(같은 글 하나 — 211차)', '둠'],
  ['7', 'src/app/dom.ts', "role: fail === was ? null : 'alert'", 1, '탭 몸통 받기 실패 글(220차 같은 글이면 role 없이)', '둠'],
  ['8', 'src/app/keysnap.ts', "class: 'key-live', role: 'status', 'aria-live': 'polite'", 1, '가상 커서 알림(같은 글은 NBSP로 의도된 다시 읽기만)', '둠'],
  ['9', 'src/app/measure-lock.ts', "class: 'measure-flash', role: 'status'", 1, '측정 띠 위 알림(117차 늘 있는 칸)', '둠'],
  ['10', 'src/app/panel.ts', "class: 'panel-foot', hidden: true, 'aria-live': 'polite'", 1, '패널 아래 띠 — 다시 그릴 때 바뀐 마디만(putLive)', '고침'],
  ['11', 'src/app/panel.ts', "class: 'play-state', 'aria-live': 'off'", 1, '재생 상태 — 줄마다 바뀌어 알리지 않음', '셈 밖'],
  ['12', 'src/app/panel.ts', "class: 'mono-dim find-count', 'aria-live': 'polite'", 1, '찾기 수(221차 지은 글이 바뀔 때만)', '둠'],
  ['13', 'src/app/shortcuts.ts', "const LIVE = '[aria-live]", 1, '알림 칸 선택자(207차 창을 연 동안 들어온 글)', '셈 밖'],
  ['13', 'src/app/shortcuts.ts', "class: 'sc-live', role: 'status', 'aria-live': 'polite'", 1, '단축키 창을 닫은 뒤 새 글 한 번', '둠'],
  ['14', 'src/app/sim.ts', "el.setAttribute('role', 'alert')", 1, '깎기 탭 상태 글 — 계산하지 못한 오류(135·221차)', '둠'],
  ['14', 'src/app/sim.ts', "el.removeAttribute('aria-live')", 1, '깎기 탭 상태 글 — 오류 칸은 alert만', '둠'],
  ['14', 'src/app/sim.ts', "el.setAttribute('aria-live', 'off')", 1, '깎기 탭 상태 글 — 오류 아닌 글(진행 %·재생 따라가기·끝 — 끝은 .sim-live 한 번)', '고침'],
  ['14', 'src/app/sim.ts', "(el.getAttribute('role') === 'alert')", 1, '깎기 탭 상태 글 — 꼴을 바꿀지 견줌', '셈 밖'],
  ['15', 'src/app/sim.ts', "class: 'sim-live', role: 'status', 'aria-live': 'polite'", 1, '깎기 계산 알림 — 새 계산의 시작·끝 한 번(197차)', '둠'],
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    const p = `${dir}/${name}`;
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

// ───────────────────────── 앱(가짜 뷰어) ─────────────────────────

const PROGRAM = 'G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X20 Y10\nM30\n';
const bytes = (): ArrayBuffer => new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer;

function makeApp(): { app: NcViewerApp; root: HTMLElement } {
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root), root };
}

/** 조건이 맞을 때까지(마감 3초 — 13번) */
async function until(ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다린 조건이 마감 안에 맞지 않음');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** 칸 안의 바뀜 기록을 모은다(takeRecords로 그 자리까지) */
function watch(el: Element): MutationObserver {
  const mo = new MutationObserver(() => {});
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  return mo;
}
/** 기록에서 새로 붙은 마디의 글 */
const added = (rs: MutationRecord[]): string[] => rs.flatMap((r) => [...r.addedNodes].map((n) => n.textContent ?? ''));

beforeAll(async () => {
  // 앱이 문서를 열 때 기다리지 않고 받는 조각(3D 보기 위 UI·측정 도구·정보 탭·판단 띠)을 미리 받아 둔다(ci-guard 5번)
  await import('../../src/app/viewer-ui');
  await import('../../src/app/measure-tools');
  await import('../../src/app/notices');
  await loadPanelInfo();
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('lang');
  document.body.innerHTML = '';
});

describe('231차 상태 메시지(WCAG 4.1.3) 감사 표', () => {
  it('소스 글: src에서 알림 칸을 두거나 꼴을 바꾸는 줄은 모두 LIVE_SITES에(새 칸은 판정과 함께 표에), 표 줄은 모두 있다 — 깎기 탭 상태 글의 오류 아닌 글은 aria-live=off', () => {
    const found: { file: string; line: string }[] = [];
    for (const f of tsFiles('src'))
      for (const line of read(f).split('\n')) if (!/^\s*(?:\/\/|\*|\/\*)/.test(line) && LIVE_LINE.test(line)) found.push({ file: f, line: line.trim() });
    const stray = found.filter((s) => !LIVE_SITES.some(([, f, snip]) => f === s.file && s.line.includes(snip)));
    expect(stray.map((s) => `${s.file}: ${s.line}`)).toEqual([]);
    const off = LIVE_SITES.map(([row, f, snip, n]) => [row, f, snip, found.filter((s) => s.file === f && s.line.includes(snip)).length, n] as const).filter(([, , , got, n]) => got !== n);
    expect(off).toEqual([]);
    // 표 1의 알림 칸 15자리가 모두 표에 있다(줄 번호 1~15)
    expect([...new Set(LIVE_SITES.map(([row]) => row))]).toEqual(Array.from({ length: 15 }, (_, i) => String(i + 1)));
  });
});

describe('231차 F2: 다시 그릴 때 같은 글을 알림 칸에 다시 넣지 않음', () => {
  it('줄을 고르면 상태 줄은 고른 것 칸만 바뀌고(문서 요약은 같은 마디), 같은 줄을 다시 고르거나 패널을 다시 그려도 상태 줄·패널 아래 띠에 바뀜 0, 언어가 바뀌면 통째로', async () => {
    const { app, root } = makeApp();
    expect(await app.openBuffer('a.nc', bytes())).toBe(true);
    await until(() => !!(app as unknown as { mlock: unknown }).mlock);
    const bar = root.querySelector('.statusbar')!;
    const foot = root.querySelector('.panel-foot')!;
    const main = root.querySelector('.st-main')!.firstChild;
    expect(main?.textContent).toContain('이동');
    const sb = watch(bar);
    const ft = watch(foot);
    const inSel = (n: Node): boolean => !!(n instanceof Element ? n : n.parentElement)?.closest('.st-sel');

    // 줄 고르기(코드 목록 ↑↓·3D 고르기와 같은 길): 바뀐 곳은 고른 것 칸 안뿐 — 문서 요약·경고 칸은 손대지 않는다
    app.selectLine(3, undefined, true);
    const rs = sb.takeRecords();
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.filter((r) => !inSel(r.target)).map((r) => (r.target as Element).className ?? r.target.nodeName)).toEqual([]);
    expect(root.querySelector('.st-main')!.firstChild).toBe(main);
    expect(ft.takeRecords().length).toBeGreaterThan(0);
    expect(foot.textContent).toContain('G1 X20 Y10');

    // 같은 줄을 다시 고름·패널 다시 그리기(깎기 계산 사건의 refreshPanel과 같은 render): 같은 글 — 두 칸 모두 바뀜 0
    app.selectLine(3, undefined, true);
    app.panel.render();
    expect([sb.takeRecords().length, ft.takeRecords().length]).toEqual([0, 0]);

    // 언어가 바뀌면 앱이 통째로 다시 그린다(54·201차 — 그때 언어로 옮긴 조각)
    document.documentElement.lang = 'en';
    root.dispatchEvent(new CustomEvent('languagechange', { detail: 'en' }));
    expect(root.querySelector('.st-main')!.firstChild).not.toBe(main);
    expect([sb.takeRecords().length > 0, ft.takeRecords().length > 0]).toEqual([true, true]);
    sb.disconnect();
    ft.disconnect();
  });

  it('측정 중 포인터: 코어가 머무른 점을 끌어온 점으로 기억해도(MeasureLock 열쇠 → 상태 줄 다시 그림) 상태 줄·측정 띠 글 바뀜 0, Shift로 잠글 방향이 바뀌면 그 안내 마디 하나만', async () => {
    const { app, root } = makeApp();
    expect(await app.openBuffer('a.nc', bytes())).toBe(true);
    await until(() => !!(app as unknown as { mlock: unknown }).mlock);
    [...root.querySelectorAll<HTMLButtonElement>('.toolbar .tbtn')].find((b) => b.getAttribute('aria-label') === '측정')!.click();
    expect(app.state().measuring).toBe(true);
    // 첫 점: 코어 알림이 없어 떼기에서 맞춘다 — 둘째 점 방향을 잡는 동안 화살표 안내(상태 줄·측정 띠)
    const v = fake.FakeViewer.last!;
    v.measurePts = 1;
    v.canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect([root.querySelector('.st-sel .st-lock')?.textContent, root.querySelector('.mb-text .mb-lock-hint')?.textContent]).toEqual([ARROW_LOCK_HINT, ARROW_LOCK_HINT]);
    const sb = watch(root.querySelector('.statusbar')!);
    const mt = watch(root.querySelector('.mb-text')!);

    // 커서가 점에 머물러 코어가 끌어온 점으로 기억(점 수가 바뀌어 MeasureLock이 앱에 알림 — 글은 그대로)
    v.trackPts = [[20, 10, -1]];
    v.canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect([sb.takeRecords().length, mt.takeRecords().length]).toEqual([0, 0]);

    // 커서 아래 Shift로 잠글 방향(코어 measureHoverLock)이 생김: 두 칸 모두 그 안내 마디 하나만 새로 붙는다(앞 안내·문서 요약은 그대로)
    v.measureHoverLock = { kind: 'axis', axis: 'x', direction: [1, 0, 0] };
    v.canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect([added(sb.takeRecords()), added(mt.takeRecords())]).toEqual([[SHIFT_LOCK_HINTS.x], [SHIFT_LOCK_HINTS.x]]);
    sb.disconnect();
    mt.disconnect();
  });
});
