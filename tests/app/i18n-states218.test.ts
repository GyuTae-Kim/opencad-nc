// @vitest-environment jsdom
/**
 * 218차(WCAG 3.1.2): 다른 언어 화면에 한국어가 남는 자리 감사 둘째 — 199·201차 시험(i18n-screens199·i18n-live201)이 그리지 않는, 203~217차가 더한 화면·상태를
 * 네 언어(en·ja·zh-CN·de)로 만들어 글 마디와 title·aria-label·aria-description·placeholder·alt에 한글이 없는지 센다(199차 거르개 — 예제에 한글이 없어 파일 글 칸도 함께 센다).
 * (1) 시작 화면: 열 때 받는 조각을 받지 못한 오류 칸(예제 열기·`?open=` 주소의 3D 보기 코어 — 다시 시도·「새로 고침」, 215차), 손에 바이트가 없는 열기(파일 고르기)의
 *     코어 받기 실패 「이름: 3D 보기를 만들지 못했습니다: 까닭」(107·215차), 언어 사전 받기 실패 알림(212차) — 그 언어에서 그린 것과 언어를 바꾼 뒤.
 * (1b) 같은 오류 칸의 다른 길 — 코어는 받았는데 뷰어를 만들지 못함(WebGL2 없음 — 코어 Error 글이 까닭, 107차): 그 언어에서 그린 것, 다른 언어에서 바꾼 것, 한국어 화면에서 바꾼 것.
 * (2) 문서가 열린 뒤: 3D 보기 띠·탭 몸통(공구·정보·깎기)·소재 깎기 메뉴·키보드 단축키 창·예제 열기의 받기 실패 알림과 몸통 글, 누른 다시 시도도 받지 못한 「새로 고침」(211~215차),
 *     앱 설정 메뉴를 연 상태, 그대로 언어를 바꾼 뒤(알림 상자 relangToasts·다시 그린 몸통).
 * (3) 늦게 받는 조각: 받는 동안의 탭 몸통 「불러오는 중…」(210차 — 언어를 바꿔도)과 받은 뒤 늦게 그린 몸통, 조용한 다시 받기로 늦게 붙은 3D 보기 띠(213차),
 *     메뉴 항목으로 연 단축키 창(205·206차), 창이 열린 동안 알림 영역에 든 글을 닫은 뒤 다시 알림(`.sc-live` — 207차).
 * (4) 가상 커서가 켜진 동안 X·Y·Z 축 잠금·풀기와 L 지금 방향 잠금(203·204차 — 가상 커서 알림 영역·측정 띠·상태 줄, 실제 코어·가짜 WebGL — 199차 measureTour 꼴).
 * 고치기 전: (1)(1b)의 「3D 보기를 만들지 못했습니다: 까닭」은 던질 때(app.ts ensureViewer — uiText) 그 언어 글로 굳어 글 마디로 붙었다. 언어를 바꾸면 번역층은 틀이 잡은 값을
 * 옮기지 않아 한국어 화면에서 바꾼 다른 언어에 한국어 까닭이 남고(「Failed to create 3D view: 이 브라우저는 WebGL2를 지원하지 않아 …」 — 받기 실패면 「파일을 받지 못했습니다(네트워크 오류).」),
 * 다른 언어에서 바꾸면 앞 언어 글 그대로였다.
 * 가짜 받기 실패는 loadfail211 꼴: vi.mock 공장이 ctl.fail에 그 조각 이름이 있는 동안 던지고(던진 공장은 캐시되지 않음), 받으면 캐시되어 그 뒤로는 실패시킬 수 없어 시험 차례가
 * 그것을 따른다 — 코어는 (1)에서 받지 않고 (1b)에서 받음, 3D 보기 띠·정보 탭·단축키 창은 (3)에서 받음(문서를 열 때 함께 받는 3D 보기 띠·정보 탭은 그 앞 시험 내내 받지 못하게),
 * 깎기·예제는 받지 않음, 독일어 사전은 (1) 영어 걸음의 실패 뒤에 받음.
 * 원래 모듈은 beforeAll에서 importActual로 미리 평가(ci-guard 5번). 기다림은 마감 시간과 조건, 번역층이 옮기기를 기다릴 때는 DOM이 잇달아 조용할 때까지(13번).
 * 「다시 시도」 셈(dom.ts tried)은 모듈에 남아 언어 걸음마다 이름으로 비운다(loadDone) — 정보 탭 조각의 셈 열쇠는 받기 함수라 둘째 언어부터 몸통은 곧바로 「새로 고침」.
 */
import type { Viewer3d } from 'opencad-viewer3d';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ctl = vi.hoisted(() => ({
  fail: new Set<string>(),
  /** 정보 탭 조각을 늦게 주는 문(풀릴 때까지 받기가 끝나지 않음) */
  gate: null as Promise<void> | null,
  error: (): Error => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/assets/chunk-x.js'),
}));

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
    get scene(): unknown {
      return null;
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
  /** real이면 실제 코어 뷰어((4) 가상 커서 잠금 — 가짜 WebGL), 아니면 가짜 뷰어. noGl이면 뷰어를 만들 때 코어가 던지는 한국어 Error(WebGL2 없음 — (1b)) */
  return { FakeViewer, mode: { real: false, noGl: false } };
});

// 3D 보기 코어 조각: 이 파일에서 처음 받을 때만 실패시킬 수 있다(받으면 캐시 — core.ts loadViewerCore 약속도 남음)
vi.mock('opencad-viewer3d', async (importOriginal) => {
  if (ctl.fail.has('core')) throw ctl.error();
  const core = await importOriginal<typeof import('opencad-viewer3d')>();
  // new로 부르면 돌려준 객체가 그 값이 된다(가짜 뷰어의 Proxy와 같은 길)
  function Viewer3d(host: HTMLElement, opts?: ConstructorParameters<typeof core.Viewer3d>[1]): object {
    if (fake.mode.noGl) throw new Error('이 브라우저는 WebGL2를 지원하지 않아 3D 보기를 열 수 없습니다');
    return fake.mode.real ? new core.Viewer3d(host, opts) : new fake.FakeViewer(host);
  }
  return { ...core, Viewer3d };
});
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
// 열 때 받는 조각: 이름이 ctl.fail에 있는 동안 받기 실패(정보 탭 조각은 ctl.gate가 풀릴 때까지 늦게)
vi.mock('../../src/app/panel-info', async (importOriginal) => {
  if (ctl.fail.has('info')) throw ctl.error();
  if (ctl.gate) await ctl.gate;
  return importOriginal();
});
vi.mock('../../src/app/shortcuts', async (importOriginal) => {
  if (ctl.fail.has('shortcuts')) throw ctl.error();
  return importOriginal();
});
vi.mock('../../src/app/sim', async (importOriginal) => {
  if (ctl.fail.has('sim')) throw ctl.error();
  return importOriginal();
});
vi.mock('../../src/app/viewer-ui', async (importOriginal) => {
  if (ctl.fail.has('ui')) throw ctl.error();
  return importOriginal();
});
vi.mock('../../src/view/sample', async (importOriginal) => {
  if (ctl.fail.has('sample')) throw ctl.error();
  return importOriginal();
});
vi.mock('../../site/locales/de.json', async (importOriginal) => {
  if (ctl.fail.has('de')) throw ctl.error();
  return importOriginal();
});

// 사전 값은 번역층이 받아 등록한 사전으로 본다(site/i18n.mjs는 네 사전을 정적으로 가져와 독일어 사전 실패를 막는다)
import { translate } from '../../site/i18n-core.mjs';
import { NcViewerApp } from '../../src/app/app';
import { loadDone } from '../../src/app/dom';
import { installLocalization } from '../../src/app/i18n';
import { errorText } from '../../src/app/protocol';
import { RecentStore } from '../../src/app/recent';
import { installCanvasFakes } from './fake-webgl';
import { memoryBackend } from './recent-memory';

// Siemens 예제(199·201·211차 시험과 같음 — 다른 파일의 부프로그램 L9001이 해석 판단 띠 새 줄 「찾지 못했습니다」)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
// (4) 가상 커서 걸음(199·200차 measureTour와 같은 예제): 가운데 (20,15)를 지나는 줄 4(G1 X40 Y15)와 그 둘레
const LINES = ['G21 G90 G17', 'G0 X0 Y15 Z5', 'G1 Z0 F300', 'G1 X40 Y15', 'G1 X40 Y30', 'G1 X0 Y30', 'G0 Z5', 'M2'].join('\n');
const LANGS = ['en', 'ja', 'zh-CN', 'de'];
const enc = (t: string): ArrayBuffer => new TextEncoder().encode(t).buffer as ArrayBuffer;

const HANGUL = /[가-힣]/;
const ATTRS = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt'];
/** 파일 글 칸: 번역하지 않는 칸(translate="no")과 코드 목록의 줄 글(199차 — 자리 이름에만 쓴다) */
const FILE_CELL = '[translate="no"], .code-list .tx';
/** 언어를 한국어로 표시한 칸(언어 메뉴의 「한국어」 — 문서 뿌리 html의 lang은 화면 언어라 빼지 않는다) */
const koPart = (el: Element): boolean => {
  const l = el.closest('[lang]');
  return !!l && l !== document.documentElement && /^ko\b/.test(l.getAttribute('lang') ?? '');
};
const where = (el: Element): string => {
  const c = el.closest('[class]') ?? el;
  return `${el.closest(FILE_CELL) ? '파일 글 칸 ' : ''}${c.tagName.toLowerCase()}.${[...c.classList].join('.')}`;
};
/** 문서에 남은 한글: 「자리: 글」(199차 hangulLeft와 같다) */
function hangulLeft(): string[] {
  const out: string[] = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('script, style') || koPart(el) || !HANGUL.test(n.nodeValue ?? '')) continue;
    out.push(`${where(el)}: ${(n.nodeValue ?? '').trim()}`);
  }
  for (const el of document.body.querySelectorAll('*')) {
    if (koPart(el)) continue;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && HANGUL.test(v)) out.push(`${where(el)} @${a}: ${v}`);
    }
  }
  return out;
}

const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
/** 번역층(MutationObserver)·다시 그리기가 끝날 때까지: 문서의 글·이름 속성이 잇달아 세 번(setTimeout 0) 바뀌지 않을 때까지, 마감 5초(ci-guard 13번 — 횟수가 아니라 조건) */
async function settle(ms = 5000): Promise<void> {
  let moved = true;
  const mo = new MutationObserver(() => (moved = true));
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const end = Date.now() + ms;
  try {
    for (let calm = 0; calm < 3; calm = moved ? 0 : calm + 1) {
      if (Date.now() > end) throw new Error('문서가 조용해지지 않음');
      moved = false;
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    mo.disconnect();
  }
}
type Seen = Map<string, string>;
/** 조용해진 뒤 남은 한글을 모은다(글 → 처음 본 걸음) */
const look = async (seen: Seen, step: string): Promise<void> => {
  await settle();
  for (const t of hangulLeft()) if (!seen.has(t)) seen.set(t, step);
};
const report = (seen: Seen): string[] => [...seen].map(([t, step]) => `${step} · ${t}`);

/** 그 언어 화면의 앱 하나(번역층을 붙인 뒤 — 199차 tour 꼴) */
async function mount(lang: string): Promise<{ app: NcViewerApp; root: HTMLElement; dispose: () => void }> {
  history.replaceState(null, '', lang === 'ko' ? '/opencad-nc/' : `/opencad-nc/${lang}/`);
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const app = new NcViewerApp(root, { recent: new RecentStore(memoryBackend()) });
  const dispose = await installLocalization(root);
  return { app, root, dispose };
}
/** 언어 메뉴로 화면 언어를 바꾼다 */
const switchTo = async (lang: string): Promise<void> => {
  document.querySelector<HTMLButtonElement>(`.language-list [data-language="${lang}"]`)!.click();
  await until(() => document.documentElement.lang === lang);
};
/** 211차 실패 글(그 언어 — 앱은 mixSpan ui로 틀이 잡은 이름도 옮긴다) */
const fail = (name: string, lang: string): string => translate(`${name}을(를) 불러오지 못했습니다.`, lang, true);
/** 글이 text인 오류 알림(첫 마디가 실패 글) */
const toastOf = (text: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('.toasts > .toast.error')].find((t) => t.firstChild?.textContent === text);
/** 앱 설정 메뉴 항목 「키보드 단축키」(그 언어 글) */
const keysItem = (root: HTMLElement, lang: string): HTMLButtonElement =>
  [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.querySelector('span')?.textContent === translate('키보드 단축키', lang))!;
/** 앱 설정 메뉴를 연다(그 항목을 담은 펼침 메뉴의 버튼) */
const openMenuOf = (item: HTMLElement): void => item.closest('.menu-wrap')!.querySelector<HTMLButtonElement>(':scope > button')!.click();

/**
 * 실패 글 칸(오류 칸·탭 몸통·알림 상자)의 버튼: 「다시 시도」면 눌러(또 받지 못함) 「새로 고침」이 된 새 칸까지 기다린다(214·215차). 이미 「새로 고침」이면 그대로
 * (location.reload는 누르지 않는다). 버튼 글은 번역층이 옮긴 뒤에 본다
 */
async function retryAgain(find: () => Element | null | undefined, lang: string): Promise<void> {
  const btn = (): HTMLButtonElement | null | undefined => find()?.querySelector<HTMLButtonElement>('button.toast-act, button[data-key="load"]');
  await until(() => !!btn());
  await settle();
  const first = btn()!;
  if (first.textContent === translate('다시 시도', lang)) {
    first.click();
    await until(() => !!btn() && btn() !== first);
    await settle();
  }
  expect(btn()!.textContent, lang).toBe(translate('새로 고침', lang));
}

beforeAll(async () => {
  // 원래 조각을 미리 평가해 둔다(ci-guard 5번 — 공장이 받기를 허락할 때 바로 준다; import로 받으면 공장이 받기를 허락해 캐시되어 실패시킬 수 없어 importActual)
  const actual = ['../../src/app/panel-info', '../../src/app/shortcuts', '../../src/app/sim', '../../src/app/viewer-ui', '../../src/view/sample', '../../site/locales/de.json'];
  await Promise.all(actual.map((m) => vi.importActual(m)));
  // 문서를 열 때 기다리지 않고 받는 측정 도구 조각(app.ts ensureMeasureTools — 맨 위 곁효과 없음, 가짜로 두지 않음)
  await import('../../src/app/measure-tools');
});
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
});
afterEach(() => {
  ctl.fail.clear();
  ctl.gate = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/');
});

/** 손에 바이트가 없는 열기(파일 고르기)가 뷰어를 만들지 못한 까닭의 원문(app.ts ensureViewer — 코어 Error 글 「WebGL2 없음」, 107차) */
const VIEWER_FAIL = `3D 보기를 만들지 못했습니다: ${errorText(new Error('이 브라우저는 WebGL2를 지원하지 않아 3D 보기를 열 수 없습니다'))}`;
/** 시작 화면 오류 칸의 까닭(파일 이름 조각 뒤) */
// 224차: 「이름: 까닭」 사이 글은 틀 열쇠 「{0}: {1}」 — 중국어는 사전 다수 꼴 「：」(i18n-joins224.test.ts)
const reason = (el: Element): string => (el.textContent ?? '').replace(/^pick\.MPF(?:: |：)/, '');

describe('218차: 199·201차 시험이 그리지 않는 203~217차 화면·상태에 한국어가 남지 않는다', () => {
  it('(1) 시작 화면: 받기 실패 오류 칸(예제·주소의 코어 — 다시 시도·새로 고침)·고른 파일의 코어 받기 실패·언어 사전 실패 알림 — 그 언어로 그린 것과 언어를 바꾼 뒤', async () => {
    // 문서를 열 때 함께 받는 조각(3D 보기 띠·정보 탭)도 받지 못하게 둔다 — 여기서 받으면 캐시되어 (2)(3)이 실패시킬 수 없다
    for (const k of ['sample', 'core', 'ui', 'info']) ctl.fail.add(k);
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, arrayBuffer: async () => enc(SIE) }));
    const left: Record<string, string[]> = {};
    for (const [i, lang] of LANGS.entries()) {
      for (const n of ['예제 열기', '3D 보기']) loadDone(n);
      const { app, root, dispose } = await mount(lang);
      const err = root.querySelector<HTMLElement>('.start-error')!;
      const seen: Seen = new Map();
      try {
        await look(seen, '처음 화면');
        expect(await app.openSample()).toBe(false);
        await until(() => err.firstChild?.textContent === fail('예제 열기', lang));
        await look(seen, '예제 조각 받기 실패');
        await retryAgain(() => err, lang);
        await look(seen, '예제 조각 — 새로 고침');
        expect(await app.openUrl('/files/url.MPF')).toBe(false);
        await until(() => err.firstChild?.textContent === fail('3D 보기', lang));
        await look(seen, '주소 열기의 코어 받기 실패');
        await retryAgain(() => err, lang);
        await look(seen, '주소 열기의 코어 — 새로 고침');
        // 손에 바이트가 없는 열기: 다시 시도 없이 「이름: 3D 보기를 만들지 못했습니다: 까닭」(215차 — 지금처럼. 이 시험 틀의 까닭은 vitest가 감싼 공장 오류 글 —
        // 브라우저의 받기 실패 글은 errorText가 「파일을 받지 못했습니다(네트워크 오류).」로 바꾼다: 한국어 까닭이 끼는 같은 길은 (1b)의 뷰어 만들기 실패가 본다)
        expect(await app.openBuffer('pick.MPF', enc(SIE))).toBe(false);
        // 224차: 사이 글은 「{0}: {1}」 틀 값(중국어 「：」)
        expect([err.querySelector('button'), err.textContent!.startsWith(`pick.MPF${translate('{0}: {1}', lang).slice(3, -3)}${translate('3D 보기를 만들지 못했습니다: {0}', lang).replace('{0}', '')}`)]).toEqual([null, true]);
        await look(seen, '고른 파일의 코어 받기 실패');
        if (lang === 'en') {
          // 언어 메뉴로 고른 독일어 사전을 받지 못함: 지금 화면 언어 글에 언어 메뉴 이름(212차) — 그 뒤 독일어 사전은 받는다(받으면 캐시)
          ctl.fail.add('de');
          document.querySelector<HTMLButtonElement>('.language-list [data-language="de"]')!.click();
          await until(() => !!toastOf(fail('Deutsch', 'en')));
          await look(seen, '언어 사전 받기 실패 알림');
          ctl.fail.delete('de');
        }
        // 그대로 다음 언어로: 오류 칸·알림을 새 언어로 다시 그린다
        const next = LANGS[(i + 1) % LANGS.length]!;
        await switchTo(next);
        await look(seen, `${next}로 바꿈`);
      } finally {
        dispose();
      }
      left[lang] = report(seen);
    }
    expect(left).toEqual({ en: [], ja: [], 'zh-CN': [], de: [] });
  });

  it('(1b) 시작 화면: 고른 파일의 뷰어를 만들지 못함(WebGL2 없음 — 코어 Error 글이 까닭) — 그 언어로 그린 것, 다른 언어에서 바꾼 것, 한국어 화면에서 바꾼 것 모두 그 언어 글', async () => {
    // 코어는 여기서 처음 받는다(받으면 캐시 — 뷰어를 만들 때 던짐). 문서를 열 때 함께 받는 조각은 (2)(3) 몫이라 받지 못하게 둔다
    for (const k of ['ui', 'info', 'sample']) ctl.fail.add(k);
    fake.mode.noGl = true;
    const left: Record<string, string[]> = {};
    /** 오류 칸의 까닭이 지금 화면 언어 글인가(아니면 남은 글) */
    const relang: Record<string, string> = {};
    const check = async (label: string, lang: string, err: Element): Promise<void> => {
      await settle();
      relang[label] = reason(err) === translate(VIEWER_FAIL, lang, true) ? 'ok' : reason(err);
      const seen: Seen = new Map();
      await look(seen, label);
      left[label] = report(seen);
    };
    try {
      for (const [i, lang] of LANGS.entries()) {
        const { app, root, dispose } = await mount(lang);
        const err = root.querySelector<HTMLElement>('.start-error')!;
        try {
          expect(await app.openBuffer('pick.MPF', enc(SIE))).toBe(false);
          expect(err.querySelector('button')).toBeNull();
          await check(lang, lang, err);
          const next = LANGS[(i + 1) % LANGS.length]!;
          await switchTo(next);
          await check(`${lang}→${next}`, next, err);
        } finally {
          dispose();
        }
      }
      // 한국어 화면에서 그린 같은 오류를 네 언어로 차례로 바꾼다(201차 꼴 — 언어 메뉴)
      const { app, root, dispose } = await mount('ko');
      const err = root.querySelector<HTMLElement>('.start-error')!;
      try {
        expect(await app.openBuffer('pick.MPF', enc(SIE))).toBe(false);
        await settle();
        // 거르개가 그 글을 찾는다(한국어 화면 — 비지 않음)
        expect(hangulLeft().filter((t) => t.startsWith('div.start-error: ') && t.includes('3D 보기를 만들지 못했습니다'))).toHaveLength(1);
        for (const lang of LANGS) {
          await switchTo(lang);
          await check(`ko…→${lang}`, lang, err);
        }
      } finally {
        dispose();
      }
    } finally {
      fake.mode.noGl = false;
    }
    const labels = [...LANGS, 'en→ja', 'ja→zh-CN', 'zh-CN→de', 'de→en', ...LANGS.map((l) => `ko…→${l}`)];
    expect(left).toEqual(Object.fromEntries(labels.map((l) => [l, []])));
    expect(relang).toEqual(Object.fromEntries(labels.map((l) => [l, 'ok'])));
  });

  it('(2) 문서가 열린 뒤: 3D 보기 띠·탭 몸통(공구·정보·깎기)·소재 깎기·단축키 창·예제의 받기 실패 알림과 몸통 글, 「새로 고침」, 앱 설정 메뉴를 연 상태 — 그대로 언어를 바꾼 뒤도', async () => {
    // 코어는 (1b)에서 받았다(캐시). 나머지 열 때 받는 조각은 받지 못하게
    for (const k of ['ui', 'info', 'sim', 'shortcuts', 'sample']) ctl.fail.add(k);
    const left: Record<string, string[]> = {};
    for (const [i, lang] of LANGS.entries()) {
      for (const n of ['가상 커서', '소재 깎기', '키보드 단축키', '예제 열기']) loadDone(n);
      const { app, root, dispose } = await mount(lang);
      const api = window.opencadApp!;
      // 220차: 실패 글 칸은 role이 아니라 그 버튼(data-key="load")으로 찾는다 — 언어를 바꿔 같은 탭을 다시 그리면 같은 글은 role 없이 그린다(다시 읽히지 않게, dom.ts loadFailed)
      const body = (): HTMLElement | null => [...root.querySelectorAll<HTMLElement>('.panel-body p.hint')].find((p) => p.querySelector('button[data-key="load"]')) ?? null;
      const seen: Seen = new Map();
      try {
        expect(await app.openBuffer('part.MPF', enc(SIE))).toBe(true);
        // 3D 보기 띠 조각(212차): 문서는 열고 알림 상자에 실패 글
        await until(() => !!toastOf(fail('가상 커서', lang)));
        await look(seen, '3D 보기 띠 받기 실패');
        await retryAgain(() => toastOf(fail('가상 커서', lang)), lang);
        await look(seen, '3D 보기 띠 — 새로 고침');
        // 탭 몸통(211·215차): 정보 탭 조각의 공구·정보 탭, 깎기 조각의 깎기 탭
        api.togglePanel(true);
        for (const [tab, name] of [
          ['tools', '공구'],
          ['info', '정보'],
          ['sim', '깎기'],
        ] as const) {
          api.setPanelTab(tab);
          await until(() => body()?.firstChild?.textContent === fail(name, lang));
          await look(seen, `${tab} 탭 몸통 받기 실패`);
          await retryAgain(body, lang);
          await look(seen, `${tab} 탭 몸통 — 새로 고침`);
        }
        // 소재 깎기 메뉴 길(215차)
        await api.setSim(true);
        await until(() => !!toastOf(fail('소재 깎기', lang)));
        await look(seen, '소재 깎기 받기 실패');
        await retryAgain(() => toastOf(fail('소재 깎기', lang)), lang);
        await look(seen, '소재 깎기 — 새로 고침');
        // 앱 설정 메뉴를 연 상태 → 메뉴 항목 「키보드 단축키」(206차 길): 창 조각을 받지 못함(211차)
        const item = keysItem(root, lang);
        openMenuOf(item);
        await look(seen, '앱 설정 메뉴 열림');
        item.click();
        await until(() => !!toastOf(fail('키보드 단축키', lang)));
        await look(seen, '단축키 창 받기 실패');
        await retryAgain(() => toastOf(fail('키보드 단축키', lang)), lang);
        await look(seen, '단축키 창 — 새로 고침');
        // 문서가 열린 뒤의 예제 열기(215차 — 알림 상자)
        expect(await app.openSample()).toBe(false);
        await until(() => !!toastOf(fail('예제 열기', lang)));
        await look(seen, '예제 조각 받기 실패(문서 있음)');
        await retryAgain(() => toastOf(fail('예제 열기', lang)), lang);
        await look(seen, '예제 조각 — 새로 고침');
        // 그대로 다음 언어로: 알림 상자 조각은 원문에서 새 언어로(202차 relangToasts), 몸통은 다시 그린다.
        // 알림은 포인터를 올려 두어 8초가 되어도 닫지 않게(157차 — 부하에 걸음이 길어져도 견줄 알림이 남게)
        for (const t of document.querySelectorAll('.toasts > .toast')) t.dispatchEvent(new Event('pointerenter'));
        const next = LANGS[(i + 1) % LANGS.length]!;
        await switchTo(next);
        await settle();
        // 220차: 다시 그린 몸통의 같은 실패 글은 role 없음(새 언어 글로 바뀌어도 새 alert 마디가 아님)
        expect([!!toastOf(fail('예제 열기', next)), !!toastOf(fail('가상 커서', next)), body()?.firstChild?.textContent, body()?.getAttribute('role')]).toEqual([true, true, fail('깎기', next), null]);
        await look(seen, `${next}로 바꿈`);
      } finally {
        dispose();
      }
      left[lang] = report(seen);
    }
    expect(left).toEqual({ en: [], ja: [], 'zh-CN': [], de: [] });
  });

  it('(3) 늦게 받는 조각: 받는 동안 「불러오는 중…」(언어를 바꿔도)·늦게 그린 몸통·늦게 붙은 3D 보기 띠, 메뉴 항목으로 연 단축키 창·닫은 뒤 다시 알림(.sc-live)', async () => {
    ctl.fail.add('ui');
    ctl.fail.add('info');
    for (const n of ['가상 커서', '키보드 단축키']) loadDone(n);
    const { app, root, dispose } = await mount('en');
    const api = window.opencadApp!;
    const seen: Seen = new Map();
    try {
      expect(await app.openBuffer('part.MPF', enc(SIE))).toBe(true);
      await until(() => !!toastOf(fail('가상 커서', 'en')));
      // 정보 탭 조각: 이제 받기는 하되 늦게(문서는 받기 실패로 곧 열렸다 — 탭이 받기 전에 그린다)
      ctl.fail.delete('info');
      let release!: () => void;
      ctl.gate = new Promise<void>((r) => (release = r));
      api.togglePanel(true);
      api.setPanelTab('info');
      const loading = (): Element | null => root.querySelector('.panel-body > p.hint:not([role])');
      await until(() => loading()?.textContent === translate('불러오는 중…', 'en'));
      await look(seen, '정보 탭 받는 중');
      for (const lang of ['ja', 'zh-CN', 'de']) {
        await switchTo(lang);
        await until(() => loading()?.textContent === translate('불러오는 중…', lang));
        await look(seen, `정보 탭 받는 중 — ${lang}`);
      }
      release();
      ctl.gate = null;
      await until(() => !loading() && !!root.querySelector('.panel-body')?.childElementCount);
      await look(seen, '늦게 그린 정보 탭(de)');
      // 3D 보기 띠: 이제 받는다 — 다음 문서 열기의 조용한 다시 받기(213차)로 늦게 붙고 실패 알림은 닫힌다(214차)
      ctl.fail.delete('ui');
      expect(await app.openBuffer('part2.MPF', enc(SIE))).toBe(true);
      await until(() => !!root.querySelector('.key-live') && !toastOf(fail('가상 커서', 'de')));
      expect(app.viewer!.canvas.getAttribute('aria-description')).not.toBeNull();
      await look(seen, '늦게 붙은 3D 보기 띠(de)');
      // 언어마다(바꾸면 앞 알림 영역이 빈다 — 201·207차): 앱 설정 메뉴를 연 상태 → 메뉴 항목으로 연 단축키 창 → 창이 열린 동안 새 문서(판단 띠 새 줄 알림) → 닫으면 다시 알림
      for (const lang of LANGS) {
        await switchTo(lang);
        await settle();
        const item = keysItem(root, lang);
        openMenuOf(item);
        await look(seen, `앱 설정 메뉴 열림 — ${lang}`);
        item.click();
        await until(() => !!root.querySelector('[role="dialog"][aria-modal="true"]'));
        await look(seen, `메뉴로 연 단축키 창 — ${lang}`);
        expect(await app.openBuffer(`part-${lang}.MPF`, enc(SIE))).toBe(true);
        root.querySelector<HTMLButtonElement>('.sc-close')!.click();
        await until(() => !!root.querySelector('.sc-live p'));
        await look(seen, `창을 닫은 뒤 다시 알림 — ${lang}`);
      }
    } finally {
      dispose();
    }
    expect(report(seen)).toEqual([]);
  });

  it('(4) 가상 커서가 켜진 동안 X·Y·Z 축 잠금·풀기와 L 지금 방향 잠금 — 한국어 화면은 거르개가 그 알림을 찾고, 언어 메뉴로 바꾼 네 언어에는 한글 0', async () => {
    const restore = installCanvasFakes(800, 600);
    const scroll = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    fake.mode.real = true;
    const { app, root, dispose } = await mount('ko');
    /** 세계 점 p를 화면 가운데로(위에서 본 보기, 가로 반폭 w — 화면 800 × 600 — 199차 measureTour center)하고 3D 보기에 초점 */
    const center = (v: Viewer3d, p: readonly number[], w: number): void => {
      v.setView('top', false);
      v.fit(false);
      const a = v.project([p[0]! - w, p[1]! - w * 0.75, p[2]!])!;
      const b = v.project([p[0]! + w, p[1]! + w * 0.75, p[2]!])!;
      v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
      v.renderNow();
      const s = v.project(p)!;
      expect(Math.abs(s.x - 400)).toBeLessThan(1);
      expect(Math.abs(s.y - 300)).toBeLessThan(1);
      v.canvas.focus();
    };
    /** 캔버스가 받은 키(창 캡처의 앱 키·측정 잠금 키 → 캔버스의 코어 키) */
    const key = (v: Viewer3d, k: string, o: KeyboardEventInit = {}): void => void v.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
    const lock = (): string | null => app.state().measureLock?.lock ?? null;
    const tour = async (): Promise<Seen> => {
      const seen: Seen = new Map();
      if (app.state().measuring) app.toggleMeasure(false);
      app.viewer?.canvas.blur();
      expect(await app.openBuffer('a.nc', enc(LINES))).toBe(true);
      const v = app.viewer!;
      // 연 뒤 두 프레임 뒤의 처음 맞춤(app.ts setDoc)이 지난 다음에 가운데로(199차 measureTour와 같은 까닭)
      await look(seen, '공구 경로 열기');
      app.toggleMeasure(true);
      await until(() => app.state().measuring);
      center(v, [20, 15, 0], 25);
      key(v, 'Enter');
      expect(v.keyboardCursor).toMatchObject({ mode: 'measure' });
      key(v, 'Enter');
      expect(v.measurePoints).toHaveLength(1);
      await look(seen, '측정 첫 점 — 가상 커서 잠금 안내');
      // 203차: X(KeyX)로 X축 잠금, 같은 키로 풀기 — 가상 커서 알림 영역(.key-live)·측정 띠·상태 줄
      key(v, 'x', { code: 'KeyX' });
      await until(() => lock() === 'x');
      await look(seen, 'X축 잠금');
      key(v, 'x', { code: 'KeyX' });
      await until(() => lock() === null);
      await look(seen, 'X축 잠금 풀기');
      // 204차: 커서를 줄 따라 옮긴 뒤 L로 지금 방향 잠금(잠글 방향이 없으면 띠 위 알림), 같은 키로 풀기
      key(v, 'ArrowRight', { shiftKey: true });
      key(v, 'ArrowRight', { shiftKey: true });
      await settle();
      key(v, 'l', { code: 'KeyL' });
      await until(() => lock() !== null || !!root.querySelector('.measure-flash')?.textContent);
      await look(seen, 'L 지금 방향');
      if (lock()) {
        key(v, 'l', { code: 'KeyL' });
        await until(() => lock() === null);
        await look(seen, 'L 풀기');
      }
      v.clearMeasure();
      app.toggleMeasure(false);
      v.canvas.blur();
      await look(seen, '측정 끄기');
      return seen;
    };
    try {
      const left: Record<string, string[]> = {};
      for (const lang of ['ko', ...LANGS]) {
        if (lang !== 'ko') await switchTo(lang);
        const seen = await tour();
        if (lang === 'ko') {
          // 걸음이 그 글을 냈다: 잠근 축·푼 것 알림(.key-live — measure-lock.ts sayLock), 가상 커서가 켜진 동안 잠금 안내(CURSOR_LOCK_HINT)
          const all = [...seen.keys()];
          const heads = ['div.key-live: X축 방향으로 잠금', 'div.key-live: 방향 잠금을 풀었습니다', 'span.mb-sub.mb-lock-hint: X축 방향으로 잠금'];
          expect(heads.filter((head) => !all.some((t) => t.startsWith(head)))).toEqual([]);
          continue;
        }
        left[lang] = report(seen);
      }
      expect(left).toEqual({ en: [], ja: [], 'zh-CN': [], de: [] });
    } finally {
      dispose();
      fake.mode.real = false;
      (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
      restore();
    }
  });
});
