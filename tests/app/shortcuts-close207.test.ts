// @vitest-environment jsdom
/**
 * 207차: 키보드 단축키 창(src/app/shortcuts.ts — 205·206차)을 닫은 뒤.
 * (가) 창이 열린 동안 parent(#app)의 다른 자식은 inert라, 그 안의 알림 영역(.app-live 판단 띠·.sim-live 깎기 계산·가상 커서 .key-live·측정 띠 위 알림·
 *   시작 화면 오류 칸·상태 막대 등 — aria-live(off 뺌)·role=status·alert)에 들어온 글은 보이지도 화면 읽기에 읽히지도 않고, 닫아 inert를 풀어도 다시 읽히지 않았다(WCAG 4.1.3).
 *   열 때 있던 글을 적어 두고, 닫은 뒤 숨지 않고 다른 inert 밖인 영역의 글 가운데 열 때 없던 글(같은 글 한 번, 한 영역은 마지막 글)을 창의 알림 영역(.sc-live)에 한 번 넣는다.
 *   .sc-live는 창을 처음 열 때 빈 채로 붙여 두고(156·198차 — 영역이 글보다 먼저), 닫은 뒤 한 프레임 다음에 글을 넣는다(닫을 때 옮긴 초점 글 다음). 열 때와 닫을 때 언어가 다르면 넣지 않고,
 *   언어가 바뀌면 비운다(201·202차 앞 언어 글 비우기). 열 때 있던 글은 다시 넣지 않는다(198차 새로 나온 글만).
 * (나) 창이 열린 동안 연 곳이 숨거나 떼어지면(읽는 중 「취소」·끌어 놓기로 숨은 시작 화면·다시 그린 깎기 탭 칸) 초점이 문서로 빠졌다(WCAG 2.4.3) —
 *   패널에서 열었으면 패널 지금 탭 버튼, 아니면 180차 덮개 「취소」와 같은 남는 칸(문서가 있으면 3D 보기, 없으면 시작 화면 열기 칸).
 * jsdom은 inert·숨은 칸의 초점 규칙(HTML — inert와 그려지지 않은 칸은 초점을 받지 않는다)을 두지 않아 HTMLElement.focus를 그 규칙으로 감싼다(브라우저와 같게).
 * 창 조각·앱이 기다리지 않고 받는 조각은 미리 받아 둔다(ci-guard 5번). 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView — i18n-live201.test.ts 꼴).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      // 코어 캔버스는 키보드 초점을 받는다(tabindex 0)
      this.canvas.tabIndex = 0;
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

import { NcViewerApp } from '../../src/app/app';
import { loadPanelInfo } from '../../src/app/panel';
import { RecentStore } from '../../src/app/recent';
import { openShortcutsDialog } from '../../src/app/shortcuts';
import { memoryBackend } from './recent-memory';

// Siemens: 다른 파일의 부프로그램(L9001 — 해석 판단 띠 새 줄 → .app-live, i18n-live201.test.ts와 같은 예제)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
const enc = new TextEncoder();
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
/** 닫은 뒤 글을 넣는 차례(한 프레임 + 타이머)가 지나도록 */
const frames = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
const keydown = (el: EventTarget, key: string, o: KeyboardEventInit = {}): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o });
  el.dispatchEvent(ev);
  return ev;
};
/** 창의 알림 영역 글(문단마다) */
const said = (parent: ParentNode): string[] | null => {
  const s = parent.querySelector('.sc-live');
  return s ? [...s.childNodes].map((n) => n.textContent ?? '') : null;
};

const realFocus = HTMLElement.prototype.focus;
beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(3D 보기 위 UI·측정 도구·정보 탭 공구 경로 부분)을 미리 받아 둔다(ci-guard 5번). 창 조각은 위 정적 가져오기
  await import('../../src/app/viewer-ui');
  await import('../../src/app/measure-tools');
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
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  // 브라우저 초점 규칙: inert 안·숨은(hidden) 칸은 초점을 받지 않는다
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, o?: FocusOptions) {
    if (!this.closest('[inert], [hidden]')) realFocus.call(this, o);
  });
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  localStorage.clear();
});

/** 글을 가진 칸 */
const el = (attrs: Record<string, string>, text = ''): HTMLDivElement => {
  const d = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v);
  d.textContent = text;
  return d;
};

describe('207차 (가): 창이 열린 동안 parent 안 알림 영역에 들어온 글은 닫은 뒤 한 번 알린다', () => {
  it('열 때 없던 글만(영역마다 마지막 글·같은 글 한 번), 숨은 칸·다른 inert 안·aria-live=off는 빼고 — 영역은 글보다 먼저, 다시 열면 비우고, 언어가 다르면 넣지 않으며 언어가 바뀌면 비운다', async () => {
    const parent = document.createElement('div');
    const opener = document.createElement('button');
    const kept = el({ role: 'status' }, '열 때 있던 글');
    const polite = el({ 'aria-live': 'polite' });
    const last = el({ 'aria-live': 'polite' }, 'A');
    const alert = el({ role: 'alert' });
    alert.hidden = true;
    const off = el({ 'aria-live': 'off' });
    const veil = el({});
    veil.hidden = true;
    const gone = el({ role: 'status' });
    veil.append(gone);
    const lid = el({});
    const under = el({ role: 'status' });
    lid.append(under);
    const twinA = el({ role: 'status' });
    const twinB = el({ 'aria-live': 'polite' });
    const a = el({});
    a.append(opener, kept, polite, last);
    const b = el({});
    b.append(alert, off, veil, lid, twinA, twinB);
    parent.append(a, b);
    document.body.append(parent);
    opener.focus();
    const close = openShortcutsDialog(parent, () => {});
    // 창의 알림 영역은 열 때 빈 채로 parent에 있다(창이 열린 동안은 다른 자식과 함께 inert)
    const sc = parent.querySelector<HTMLElement>('.sc-live')!;
    expect(sc).not.toBeNull();
    expect([sc.getAttribute('role'), sc.getAttribute('aria-live'), sc.hasAttribute('data-i18n-skip'), sc.textContent, sc.hasAttribute('inert'), parent.lastElementChild!.className]).toEqual(['status', 'polite', true, '', true, 'sc-back']);
    // 창이 열린 동안 들어온 글
    polite.textContent = '깎기 계산을 마쳤습니다';
    last.textContent = 'B';
    last.textContent = 'C';
    alert.textContent = 'notes.md: 열지 못했습니다';
    alert.hidden = false;
    off.textContent = '재생 7/9';
    gone.textContent = '숨은 칸 글';
    lid.setAttribute('inert', '');
    under.textContent = '읽는 중 덮개 밑 글';
    twinA.textContent = '같은 끝 글';
    twinB.textContent = '같은 끝 글';
    // 다시 그린 칸(새 요소)의 같은 글은 새 글이 아니다
    a.append(el({ role: 'status' }, '열 때 있던 글'));
    close();
    // 닫은 차례: 초점은 연 곳, 영역은 아직 빈 채(inert를 푼 뒤 한 프레임 다음에 글)
    expect([document.activeElement, sc.textContent, sc.hasAttribute('inert')]).toEqual([opener, '', false]);
    await until(() => !!sc.textContent);
    expect(said(parent)).toEqual(['깎기 계산을 마쳤습니다', 'C', 'notes.md: 열지 못했습니다', '같은 끝 글']);
    // 다시 열면 비우고, 열린 동안 바뀐 것이 없으면 닫아도 넣지 않는다
    openShortcutsDialog(parent)();
    await frames();
    expect(said(parent)).toEqual([]);
    expect(parent.querySelectorAll('.sc-live')).toHaveLength(1);
    // 열 때와 닫을 때 언어가 다르면 넣지 않는다(앞 언어로 넣은 글을 번역층이 새 언어로 다시 옮겨 「바뀐 글」처럼 보임 — 201·202차)
    const shut = openShortcutsDialog(parent);
    polite.textContent = '새 글';
    document.documentElement.lang = 'en';
    shut();
    await frames();
    expect(said(parent)).toEqual([]);
    // 넣은 뒤 언어가 바뀌면(languagechange) 비운다
    const again = openShortcutsDialog(parent);
    polite.textContent = '또 새 글';
    again();
    await until(() => !!sc.textContent);
    expect(said(parent)).toEqual(['또 새 글']);
    parent.dispatchEvent(new CustomEvent('languagechange', { detail: 'en' }));
    expect(said(parent)).toEqual([]);
  });
});

describe('207차 (나): 창이 열린 동안 연 곳이 숨거나 떼어지면 닫을 때 남는 칸으로', () => {
  it('창: 연 곳이 초점을 받으면 그대로, 숨거나 떼어졌으면 spare 차례에서 초점을 받는 첫 칸(없는 칸·숨은 칸은 건너뜀)', () => {
    const parent = document.createElement('div');
    const box = el({});
    const opener = document.createElement('button');
    const hiddenSpare = document.createElement('button');
    const spare = document.createElement('button');
    box.append(opener);
    const wrap = el({});
    wrap.hidden = true;
    wrap.append(hiddenSpare);
    parent.append(box, wrap, spare);
    document.body.append(parent);
    const list = (): (HTMLElement | null)[] => [null, hiddenSpare, spare];
    // 연 곳이 그대로면 연 곳
    opener.focus();
    openShortcutsDialog(parent, undefined, list)();
    expect(document.activeElement).toBe(opener);
    // 연 곳이 숨음
    openShortcutsDialog(parent, undefined, list);
    box.hidden = true;
    keydown(document.activeElement!, 'Escape');
    expect(document.activeElement).toBe(spare);
    // 연 곳이 떼어짐
    box.hidden = false;
    opener.focus();
    openShortcutsDialog(parent, undefined, list);
    opener.remove();
    keydown(document.activeElement!, 'Escape');
    expect(document.activeElement).toBe(spare);
  });

  const mountApp = (): { app: NcViewerApp; root: HTMLElement; dialogs: () => HTMLElement[] } => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const app = new NcViewerApp(root, { recent: new RecentStore(memoryBackend()) });
    return { app, root, dialogs: () => [...root.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')] };
  };
  const escape = (dialogs: () => HTMLElement[]): void => {
    keydown(dialogs()[0]!.querySelector('button')!, 'Escape');
    expect(dialogs()).toHaveLength(0);
  };

  it('읽는 중 덮개 「취소」에서 연 창 → 열린 동안 읽기가 끝나 덮개가 숨음 → 닫으면 시작 화면 열기 칸(문서 없음)', async () => {
    const { app, root, dialogs } = mountApp();
    const busy = app as unknown as { setBusy(stage: string | null, fraction?: number, name?: string): void };
    busy.setBusy('여는 중', 0.1, 'part.MPF');
    const cancel = root.querySelector<HTMLButtonElement>('.busy-cancel')!;
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    expect(keydown(cancel, '?', { shiftKey: true }).defaultPrevented).toBe(true);
    await until(() => dialogs().length > 0);
    busy.setBusy(null);
    expect(root.querySelector<HTMLElement>('.busy')!.hidden).toBe(true);
    escape(dialogs);
    expect(document.activeElement).toBe(root.querySelector('.start .dropzone'));
  });

  it('시작 화면 열기 칸에서 연 창 → 열린 동안 끌어 놓은 파일이 열려 시작 화면이 숨음 → 닫으면 3D 보기, 열린 동안 바뀐 상태 막대·판단 띠 알림은 닫은 뒤 한 번', async () => {
    const { app, root, dialogs } = mountApp();
    const zone = root.querySelector<HTMLElement>('.start .dropzone')!;
    zone.focus();
    const before = root.querySelector('.statusbar')!.textContent!;
    keydown(zone, '?', { shiftKey: true });
    await until(() => dialogs().length > 0);
    // 열린 동안 문서가 열림(끌어 놓기·연결 프로그램과 같은 길 — 3D 보기 초점은 inert라 창이 그대로 가짐)
    expect(await app.openBuffer('part.MPF', enc.encode(SIE).buffer as ArrayBuffer)).toBe(true);
    await tick();
    expect([root.querySelector<HTMLElement>('.start')!.hidden, document.activeElement]).toEqual([true, dialogs()[0]!.querySelector('button')]);
    const live = root.querySelector<HTMLElement>(':scope > .app-live')!.textContent!;
    const status = root.querySelector('.statusbar')!.textContent!;
    expect(live).toContain('찾지 못했습니다');
    expect(status).not.toBe(before);
    escape(dialogs);
    const canvas = root.querySelector<HTMLCanvasElement>('.v3d canvas')!;
    expect(document.activeElement).toBe(canvas);
    await until(() => !!root.querySelector('.sc-live')?.textContent);
    const heard = said(root)!;
    expect(heard).toContain(live);
    expect(heard).toContain(status);
    expect(heard).not.toContain(before);
  });

  it('패널 칸에서 연 창 → 열린 동안 패널을 다시 그려 그 칸이 떼어짐(깎기 탭 계산 끝 redrawTab과 같은 panel.refresh) → 닫으면 패널 지금 탭 버튼', async () => {
    const { app, root, dialogs } = mountApp();
    expect(await app.openBuffer('part.MPF', enc.encode(SIE).buffer as ArrayBuffer)).toBe(true);
    await tick();
    app.togglePanel(true);
    root.querySelector<HTMLButtonElement>('.panel-tab[data-tab="tools"]')!.click();
    const btn = root.querySelector<HTMLButtonElement>('.panel-body button:not(:disabled)')!;
    btn.focus();
    expect(document.activeElement).toBe(btn);
    keydown(btn, '?', { shiftKey: true });
    await until(() => dialogs().length > 0);
    (app as unknown as { panel: { refresh(): void } }).panel.refresh();
    expect(btn.isConnected).toBe(false);
    escape(dialogs);
    const tab = root.querySelector<HTMLElement>('.panel-tab.active')!;
    expect([tab.dataset.tab, document.activeElement]).toEqual(['tools', tab]);
  });
});
