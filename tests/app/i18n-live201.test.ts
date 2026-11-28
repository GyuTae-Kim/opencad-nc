// @vitest-environment jsdom
/**
 * 201차(WCAG 3.1.2): 언어를 바꾼 뒤 알림 영역에 남는 앞 언어 글과 중국어 열기 오류의 조각 사이 글.
 * (ㄱ) 첫 화면 알림 영역 `.app-live`(198차)는 판단 띠 새 줄 글을 그때 언어로 옮긴 조각(data-i18n-skip — 번역층이 건너뜀)으로 넣고, 언어를 바꾸면 같은 줄을 다시 넣지 않아
 * 앞 언어 글이 다음 새 줄까지 남았다(화면에는 보이지 않으나 화면 읽기 프로그램의 읽기 모드로 읽힘 — 200차 가상 커서 알림 영역 `.key-live`와 같은 꼴). 언어가 바뀌면 비운다.
 * 같은 꼴인지 함께 본 것: 그래픽 잃음 안내·깎기 계산 알림(`.sim-live`)은 글 마디라 번역층이 새 언어로 다시 옮기고(앞 언어 글 남지 않음), 판단 띠·상태 막대는 앱이 다시 그린다.
 * 알림 상자의 그때 언어 조각(「…: 다시 읽었습니다.」)은 잠깐 뒤 상자에서 빠질 때까지 앞 언어였다(201차 둠 — 보이는 글, 비우면 읽지 못한 알림을 잃음).
 * 202차: 언어가 바뀌면 깎기 계산 알림 영역(.sim-live — 보이지 않는 영역, 글 마디라 번역층이 지난 끝 글을 새 언어로 다시 옮겨 또 읽힐 수 있었음)을 비우고,
 * 알림 상자의 그때 언어 조각과 까닭까지 옮긴 오류 글(uiText)은 원문을 든 조각(mixSpan)이라 새 언어로 다시 옮긴다(dom.ts relangToasts — 거두지 않음).
 * 글 마디 알림 상자·측정 띠 위 알림은 번역층이 옮긴다(보이는 글 — 그대로).
 * (ㄴ) 열기 오류 「이름: 까닭」(시작 화면 오류 줄·알림 상자)은 조각마다 글 마디라 사이 글 ': '도 번역층을 지난다 — 201차는 사전 열쇠 ':'(중국어 「：」)로 옮겼으나
 * 202차에 되돌렸다: 사이트 키트 translate가 앞뒤 빈칸을 뺀 열쇠로 찾아 값만 돌려줘, 조각을 이어 옮기는 길(mixNodes·uiText·조각마다 옮기기)에서 영어 「: 」가 「:」로
 * 빈칸을 잃었다(mobile.test 31차 시험 「sub.h:No tool …」 — PR CI 실패, ci-guard 9번). 사이 글은 네 언어 모두 원문 ': ' 그대로다(중국어 「：」는 보고 둔 것).
 * 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView), 깎기 워커는 같은 실행기를 같은 스레드에서(i18n-screens199.test.ts 꼴).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  /** 앱이 넘긴 그래픽 문맥 잃음·되찾음 알림 함수, 단면 알림 함수(221차 — 시험이 단면 상태를 넘긴다) */
  const ctx: { lost: (() => void) | null; restore: (() => void) | null; section: ((s: unknown) => void) | null } = { lost: null, restore: null, section: null };
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
    onContextLost(cb: () => void): void {
      ctx.lost = cb;
    }
    onContextRestore(cb: () => void): void {
      ctx.restore = cb;
    }
    onSectionChange(cb: (s: unknown) => void): void {
      ctx.section = cb;
    }
  }
  return { FakeViewer, ctx };
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
import { toast, toastArea } from '../../src/app/dom';
import { installLocalization } from '../../src/app/i18n';
// 216차: 잠글 방향이 없을 때 글은 측정 도구 조각만 써 measure.ts(첫 화면)에서 measure-lock.ts로 옮겼다
import { MeasureLock, NO_LOCK_MOUSE } from '../../src/app/measure-lock';
import { loadPanelInfo } from '../../src/app/panel';
import { NOT_NC_MESSAGE } from '../../src/app/payload';
import { RecentStore } from '../../src/app/recent';
import { SimRunner } from '../../src/sim/runner';
import { memoryBackend } from './recent-memory';

/** 워커 대신: 같은 실행기를 이 스레드에서(메시지는 다음 틱에) */
class FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  private dead = false;
  private readonly runner = new SimRunner((msg) => setTimeout(() => !this.dead && this.onmessage?.({ data: msg }), 0));
  postMessage(msg: Parameters<SimRunner['handle']>[0]): void {
    if (!this.dead) this.runner.handle(msg);
  }
  terminate(): void {
    this.dead = true;
  }
}

// Siemens: 다른 파일의 부프로그램(L9001 — 해석 판단 띠 「다른 파일의 프로그램 … 찾지 못했습니다」, i18n-screens199.test.ts와 같은 예제)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
const HANGUL = /[가-힣]/;
const enc = new TextEncoder();
const tick = async (k = 4): Promise<void> => {
  for (let i = 0; i < k; i++) await new Promise((r) => setTimeout(r, 0));
};
const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
/** 깎기 계산이 목표에 닿았다 */
const simDone = (): boolean => {
  const s = window.opencadApp!.state.sim;
  return !!s && s.on && !s.computing && (s.at !== null || s.blocked !== null);
};
const text = (sel: string): string => document.querySelector(sel)?.textContent ?? '';
/** 비지 않고 한글이 없는 글 */
const clean = (t: string | null): boolean => !!t?.trim() && !HANGUL.test(t);
/** 언어 메뉴로 화면 언어를 바꾼다(번역층이 옮기고 앱이 languagechange로 다시 그린 뒤) */
const to = async (lang: string): Promise<void> => {
  document.querySelector<HTMLButtonElement>(`.language-list [data-language="${lang}"]`)!.click();
  await until(() => document.documentElement.lang === lang);
  await tick();
};

let dispose: (() => void) | undefined;
beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(깎기·정보 탭 공구 경로 부분·3D 보기 위 UI·측정 도구)을 미리 받아 둔다(ci-guard 5번)
  await import('../../src/app/sim');
  await import('../../src/app/viewer-ui');
  await loadPanelInfo();
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
  vi.stubGlobal('Worker', FakeWorker);
  localStorage.clear();
  fake.ctx.lost = fake.ctx.restore = fake.ctx.section = null;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

async function makeApp(lang: string): Promise<{ app: NcViewerApp; root: HTMLElement }> {
  history.replaceState(null, '', lang === 'ko' ? '/opencad-nc/' : `/opencad-nc/${lang}/`);
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const app = new NcViewerApp(root, { recent: new RecentStore(memoryBackend()) });
  dispose = await installLocalization(root);
  return { app, root };
}

describe('201차: 언어를 바꾼 뒤 알림 영역의 앞 언어 글·열기 오류 조각 사이 글', () => {
  it('(ㄱ) 언어를 바꾸면 첫 화면 알림 영역이 앞 언어 글을 비우고 다음 새 줄은 새 언어로 — 그래픽 잃음·판단 띠·상태 막대는 앞 언어 글이 남지 않고, 깎기 알림은 비우며 알림 상자 조각은 새 언어로 다시 옮김(202차 — 201차는 깎기 알림을 새 언어로 다시 옮기고 조각은 빠질 때까지 앞 언어)', async () => {
    const { app, root } = await makeApp('ko');
    const api = window.opencadApp!;
    const live = root.querySelector<HTMLElement>(':scope > .app-live')!;
    // 한국어 화면: 판단 띠 새 줄 글(알림 영역)과 깎기 끝 알림(.sim-live)
    expect(await app.openBuffer('part.MPF', enc.encode(SIE).buffer as ArrayBuffer)).toBe(true);
    await tick();
    expect(live.textContent).toContain('찾지 못했습니다');
    await api.setSim(true);
    await until(simDone);
    await tick();
    expect(HANGUL.test(text('.sim-live'))).toBe(true);
    const seen: Record<string, unknown> = {};
    await to('en');
    // 202차: 깎기 계산 알림 영역도 빈다(201차는 번역층이 영어로 다시 옮긴 끝 글이 남음 — 또 읽힐 수 있음)
    seen.en = { appLive: live.textContent, simLive: text('.sim-live'), noticeBar: clean(text('.notice-bar')), status: clean(text('.statusbar')) };
    // 다음 새 줄(같은 파일을 다시 열어 새 문서)은 새 언어로 알린다
    await api.setSim(false);
    expect(await app.openBuffer('part.MPF', enc.encode(SIE).buffer as ArrayBuffer)).toBe(true);
    await tick();
    seen.enNew = clean(live.textContent);
    // 그래픽 잃음 안내(글 마디 — 번역층이 옮김): 잃은 동안 언어를 바꾼다
    fake.ctx.lost!();
    await tick();
    const glEn = live.textContent;
    await to('ja');
    seen.ja = { glEn: clean(glEn), appLive: live.textContent, glLost: clean(text('.gl-lost')) };
    fake.ctx.restore!();
    // 알림 상자의 그때 언어 조각(다시 읽었습니다 — 파일 이름이 섞인 글)
    await api.reparse({});
    await tick();
    const reread = (): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('.toast.info')].find((t) => t.querySelector('[translate="no"]')?.textContent === 'part.MPF');
    const piece = (): string | undefined => reread()?.querySelector('[data-i18n-skip]')?.textContent ?? undefined;
    const ja = piece() ?? '';
    await to('de');
    // 202차: 같은 알림이 원문에서 독일어로 다시 옮겨진다(201차는 빠질 때까지 일본어 그대로)
    seen.de = { toastJa: clean(ja), toastDe: piece() };
    expect(seen).toEqual({
      en: { appLive: '', simLive: '', noticeBar: true, status: true },
      enNew: true,
      ja: { glEn: true, appLive: '', glLost: true },
      de: { toastJa: true, toastDe: translate('part.MPF: 다시 읽었습니다.', 'de') },
    });
  });

  it('202차: 언어를 바꾸면 깎기 계산 알림 영역은 비우고, 알림 상자의 그때 언어 조각·까닭까지 옮긴 오류는 같은 알림 안에서 새 언어로 다시 옮기며, 글 마디 알림·측정 띠 위 알림은 번역층이 옮긴다', async () => {
    const { app, root } = await makeApp('ko');
    const api = window.opencadApp!;
    expect(await app.openBuffer('part.MPF', enc.encode(SIE).buffer as ArrayBuffer)).toBe(true);
    await tick();
    toastArea().replaceChildren();
    // 알림 셋(마우스를 올려 두어 시간이 되어도 닫지 않음 — 157차): 그때 언어 조각(다시 읽었습니다 — 파일 이름이 섞인 글),
    // 까닭까지 옮긴 오류(PNG 저장 — 코어 Error 글을 끼움, uiText 길), 글 마디 알림(번역층이 옮김)
    const held = (): Element => {
      const el = toastArea().lastElementChild!;
      el.dispatchEvent(new Event('pointerenter'));
      return el;
    };
    await api.reparse({});
    await tick();
    const reread = held();
    (app as unknown as { viewer: { toBlob(): Promise<Blob> } }).viewer.toBlob = () => Promise.reject(new Error('그림을 만들지 못했습니다'));
    await app.savePng();
    const png = held();
    toast('최근 문서를 모두 지웠습니다.', 'info', 60_000);
    const plain = held();
    // 측정 띠 위 알림(측정 조각 — 띠 안 늘 있는 알림 영역, 글 마디)
    const lock = new MeasureLock({ viewer: () => null, touch: () => false, layer: root, changed: () => {} });
    lock.schedule = () => {};
    document.body.append(lock.flash);
    lock.showFlash(NO_LOCK_MOUSE, 60_000);
    // 깎기 끝 알림(.sim-live — 한국어 끝 글)
    await api.setSim(true);
    await until(simDone);
    await tick();
    expect(HANGUL.test(text('.sim-live'))).toBe(true);
    expect([reread, png, plain].map((t) => t.isConnected && HANGUL.test(t.textContent ?? ''))).toEqual([true, true, true]);
    // 언어를 바꾸는 동안 알림 영역 안의 글이 바뀌었는지(바뀌면 화면 읽기 프로그램에 따라 다시 읽힘 — 보이는 글은 번역층의 글 마디 옮기기와 같음)
    const recs: MutationRecord[] = [];
    const mo = new MutationObserver((r) => recs.push(...r));
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    await to('en');
    recs.push(...mo.takeRecords());
    mo.disconnect();
    const body = (el: Element): string => [...el.childNodes].filter((n) => !(n instanceof HTMLButtonElement)).map((n) => n.textContent).join('');
    const seen = (el: Element) => ({ text: body(el), same: el.isConnected, moved: recs.some((r) => el.contains(r.target)) });
    expect({ simLive: text('.sim-live'), reread: seen(reread), png: seen(png), plain: seen(plain), flash: seen(lock.flash) }).toEqual({
      simLive: '',
      reread: { text: translate('part.MPF: 다시 읽었습니다.', 'en'), same: true, moved: true },
      png: { text: translate('그림을 저장하지 못했습니다: 그림을 만들지 못했습니다', 'en', true), same: true, moved: true },
      plain: { text: translate('최근 문서를 모두 지웠습니다.', 'en'), same: true, moved: true },
      flash: { text: translate(NO_LOCK_MOUSE, 'en'), same: true, moved: true },
    });
  });

  // 202차: 201차의 사전 열쇠 ':'(중국어 「：」)를 되돌려 사이 글은 네 언어 모두 원문 ': ' 그대로다 — 그 열쇠는 조각을 이어 옮기는 길에서 영어 「: 」의 빈칸을 지웠다
  // (위 머리 주석, ci-guard 9번). 기호 하나를 언어마다 다르게 하려면 그 기호가 든 통째 원문·틀 열쇠로 해야 해 중국어 「：」는 보고 둔 것이다
  it.each(['zh-CN', 'en', 'ja', 'de'])('(ㄴ) %s: 열기 오류 「이름: 까닭」 — 조각 사이 글은 원문 「: 」 그대로(202차 — 기호 열쇠를 되돌림)', async (lang) => {
    const { app, root } = await makeApp(lang);
    // 시작 화면 오류 줄: 파일 이름(파일 글 칸) · 사이 글 · 까닭(앱 글)
    expect(await app.openBuffer('notes.md', enc.encode('hello world\nsecond line\n').buffer as ArrayBuffer)).toBe(false);
    await tick();
    const err = root.querySelector<HTMLElement>('.start-error')!;
    expect([...err.childNodes].map((n) => n.textContent)).toEqual(['notes.md', ': ', translate(NOT_NC_MESSAGE, lang)]);
    if (lang !== 'zh-CN') return;
    // 문서가 열린 뒤의 열기 오류(알림 상자 — 같은 조각): 중국어 → 영어로 바꾸어도 사이 글은 ': ', 까닭은 번역층이 새 언어로 옮긴다
    expect(await app.openBuffer('part.MPF', enc.encode(SIE).buffer as ArrayBuffer)).toBe(true);
    expect(await app.openBuffer('notes.md', enc.encode('hello world\n').buffer as ArrayBuffer)).toBe(false);
    await tick();
    const box = (): string[] => [...document.querySelector<HTMLElement>('.toast.error')!.childNodes].slice(0, 3).map((n) => n.textContent ?? '');
    expect(box()).toEqual(['notes.md', ': ', translate(NOT_NC_MESSAGE, 'zh-CN')]);
    await to('en');
    expect(box()).toEqual(['notes.md', ': ', translate(NOT_NC_MESSAGE, 'en')]);
  });
});

/**
 * 221차: 화면 글에 넣는 수 꼴(format.ts — 셈 수 fmtInt·fmtCount의 천 단위는 화면 언어, 프로그램 값 fmtNum·fmtPt는 소수점 「.」에 천 단위 쉼표는 소수점이 「.」인 언어만).
 * 번역층은 틀이 잡은 수 글을 그대로 끼워, 전에는 독일어 화면에도 한국어 꼴 「1,202」(소수로 읽힘)·「X 2,000.5」가 갔다. 언어를 바꾸면 앱이 다시 그리는 칸(상태 줄·패널 아래 띠·정보 탭)은
 * 새 언어 꼴로, 다시 그리지 않던 코드 탭 찾기 칸 셈·단면 값 칸도 다시 쓴다. 파일 크기(16.5 KB)는 어느 언어든 그대로. 한국어·영어 글은 지금과 같다(ci-guard 6번 — 독일어만 바뀜)
 */
describe('221차: 화면 글의 수 꼴 — 셈 수 천 단위는 화면 언어, 프로그램 값은 소수점 「.」(독일어는 천 단위 없이), 언어를 바꾸면 다시 그림', () => {
  // 이동 1,200개 남짓·X 1000.5~2199.5(1,000 넘는 수라 천 단위가 보인다) — 16,855바이트(16.5 KB)
  const BIG = ['G21 G90', 'T1 M6', 'S1000 M3', 'G0 X1000 Y0 Z5', 'G1 Z-1 F1200', ...Array.from({ length: 1200 }, (_, i) => `G1 X${1000.5 + i} Y${i % 2}`), 'M30', ''].join('\n');
  /** 언어 메뉴로 바꾸고 앱이 다시 그린 칸을 번역층이 옮길 때까지(시간과 조건 — ci-guard 13번) */
  const switchTo = async (lang: string, word: string): Promise<void> => {
    document.querySelector<HTMLButtonElement>(`.language-list [data-language="${lang}"]`)!.click();
    await until(() => document.documentElement.lang === lang && text('.st-main').includes(word));
  };
  const snap = () => ({ main: text('.st-main'), foot: text('.panel-foot'), find: text('.find-count'), sec: text('.sec-val') });

  it('한국어 → 독일어 → 영어: 상태 줄 이동 수·아래 띠 줄 번호·이송·끝점·찾기 칸 셈·단면 값, 독일어 정보 탭', async () => {
    const { app, root } = await makeApp('ko');
    const api = window.opencadApp!;
    expect(await app.openBuffer('big.nc', enc.encode(BIG).buffer as ArrayBuffer)).toBe(true);
    api.togglePanel(true);
    api.setPanelTab('code');
    // 코드 찾기: G1 줄 1,201개 — Enter로 첫 줄(1/1,201)
    const find = root.querySelector<HTMLInputElement>('.code-search input')!;
    find.value = 'G1';
    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    // 1,006번째 줄(G1 X2000.5 Y0)을 고르고 X 단면을 그 자리에(가짜 뷰어 — 코어가 알리는 단면 상태를 넘긴다)
    api.selectLine(1005);
    fake.ctx.section!({ axis: 'x', t: 0.5, position: 2000.5, flip: false });
    const ko = snap();
    const moves = /이동 (\d),(\d{3})개/.exec(ko.main);
    expect(moves).not.toBeNull();
    const [, a, b] = moves!;
    expect(ko).toEqual({
      main: expect.stringContaining('16.5 KB'),
      foot: expect.stringMatching(/^줄 1,006 G1 X2000\.5 Y0.*F1,200.*X 2,000\.5 · Y 0 · Z -1 mm/s),
      find: '1/1,201',
      sec: 'X = 2,000.5 mm',
    });
    // 독일어: 셈 수는 「Bewegungen 1.201」·「Zeile 1.006」·「1/1.201」, 프로그램 값(이송·끝점·단면)은 소수점 「.」에 천 단위 없이 — 크기는 그대로
    await switchTo('de', 'Bewegungen');
    expect(snap()).toEqual({
      main: expect.stringMatching(new RegExp(`16\\.5 KB · Bewegungen ${a}\\.${b}`)),
      foot: expect.stringMatching(/^Zeile 1\.006 G1 X2000\.5 Y0.*F1200.*X 2000\.5 · Y 0 · Z -1 mm/s),
      find: '1/1.201',
      sec: 'X = 2000.5 mm',
    });
    // 독일어 정보 탭(열 때 받는 조각): 이동 수·범위 최대 X(사전의 풀이 글은 독일어 소수 「0,001°」를 쓴다 — 앱이 끼운 수만 본다)
    api.setPanelTab('info');
    await until(() => text('.panel-body').includes('Bewegungen'));
    const info = text('.panel-body');
    expect([info.includes(`${a}.${b}`), info.includes('2199.5'), info.includes(`${a},${b}`), info.includes('2,199.5')]).toEqual([true, true, false, false]);
    // 영어: 한국어와 같은 꼴(찾기 칸은 코드 탭을 다시 그릴 때)
    await switchTo('en', 'Moves');
    api.setPanelTab('code');
    expect(snap()).toEqual({
      main: expect.stringMatching(new RegExp(`16\\.5 KB · Moves ${a},${b}`)),
      foot: expect.stringMatching(/^Line 1,006 G1 X2000\.5 Y0.*F1,200.*X 2,000\.5 · Y 0 · Z -1 mm/s),
      find: '1/1,201',
      sec: 'X = 2,000.5 mm',
    });
  });
});
