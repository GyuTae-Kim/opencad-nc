// @vitest-environment jsdom
/**
 * 209차: 208차가 보고 둔 「누름이 아닌 길로 초점 든 칸이 사라짐」 다섯(WCAG 2.4.3 — HTML focus fixup rule). 길마다 초점을 그 칸에 두고 다른 길을 일으킨 뒤
 * 브라우저라면 초점이 문서(body)로 빠지는지 본다(jsdom에 없는 초점 규칙은 focus-rules.ts — 207·208차 흉내).
 * ① 알림 넷 한도로 초점 든 알림이 빠짐 → 남은 알림의 같은 차례 같은 자리 버튼(208차 ✕·동작 버튼과 같은 함수).
 * ② 단면 상자 뒤집기에 초점인 채 다른 길(Ctrl+O로 고른 파일·끌어 놓기)로 연 파일이 열리지 않음 → 상자를 연 「단면」 버튼(열리면 3D 보기 — 이미 맞음).
 * ③ 측정 띠 잠금 버튼이 미리 보기 알림 길에서 숨음 → 재현되지 않음(점 수가 바뀌어 같은 차례에 측정 띠 맞추기가 3D 보기로 — 138·154차).
 * ④ 패널 「여기까지 그리기」에 초점인 채 Esc(고른 것 지우기)로 막힘 → 같은 줄의 앞 칸 「전체」(121차 깎기 탭 막힘 꼴).
 * ⑤ 열린 메뉴 항목에서 Ctrl+O로 고른 파일이 열리지 않음 → 메뉴 버튼(206차·메뉴 Esc와 같은 곳).
 * 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView — 208차 꼴). 앱이 기다리지 않고 받는 조각은 미리 받아 둔다(ci-guard 5번).
 * 기다림은 횟수가 아니라 마감 시간과 조건으로(ci-guard 13번).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Cb = (m: unknown) => void;
  type Section = { axis: string | null; t: number; flip: boolean; position: number };
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    measurePts = 0;
    readonly measureCbs: Cb[] = [];
    readonly hoverCbs: (() => void)[] = [];
    /** 코어 측정 읽기(시험이 바꾼다 — mobile.test 꼴) */
    measureHoverSnap = null;
    measureInferenceLock = null;
    measureHoverLock = null;
    measureLabelRect = null;
    trackPts: number[][] = [];
    /** 단면(코어 꼴 — setScene은 끈다, 바뀌면 onSectionChange) */
    section: Section | null = null;
    readonly sectionCbs: ((s: Section | null) => void)[] = [];
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      // 코어 캔버스는 키보드 초점을 받는다(tabindex 0)
      this.canvas.tabIndex = 0;
      wrap.append(this.canvas);
      host.append(wrap);
      FakeViewer.last = this;
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return this.measurePts;
    }
    get measureTrackPoints(): number[][] {
      return this.trackPts.map((p) => [...p]);
    }
    get scene(): unknown {
      return null;
    }
    setMeasureMode(on: boolean): void {
      this.measureMode = on;
      if (!on) this.measurePts = 0;
    }
    clearMeasure(): void {
      this.measurePts = 0;
    }
    onMeasure(cb: Cb): () => void {
      this.measureCbs.push(cb);
      return () => {};
    }
    onMeasureHoverChange(cb: () => void): () => void {
      this.hoverCbs.push(cb);
      return () => {};
    }
    onSectionChange(cb: (s: Section | null) => void): () => void {
      this.sectionCbs.push(cb);
      return () => {};
    }
    private setSec(s: Section | null): void {
      this.section = s;
      for (const cb of this.sectionCbs) cb(s);
    }
    setSectionAxis(axis: string, t: number, o: { flip?: boolean } = {}): void {
      this.setSec({ axis, t, flip: !!o.flip, position: t * 10 });
    }
    setSection(s: null): void {
      this.setSec(s);
    }
    setScene(): void {
      this.measurePts = 0;
      if (this.section) this.setSec(null);
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
import { toast, toastArea } from '../../src/app/dom';
import { loadPanelInfo } from '../../src/app/panel';
import { browserFocus, focused } from './focus-rules';

// Siemens 예제(208차 시험과 같음 — 재생·줄 고르기가 되는 G-code)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
const enc = (t: string): ArrayBuffer => new TextEncoder().encode(t).buffer as ArrayBuffer;
/** 조건을 마감 시간 안에서 기다린다(횟수가 아닌 시간 — ci-guard 13번) */
const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const keydown = (el: EventTarget, key: string, o: KeyboardEventInit = {}): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o });
  el.dispatchEvent(ev);
  return ev;
};

beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(3D 보기 위 UI·측정 도구·정보 탭 공구 경로 부분)을 미리 받아 둔다(ci-guard 5번)
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
  browserFocus();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

const mount = (): { app: NcViewerApp; root: HTMLElement } => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root), root };
};
/** 문서를 연 앱(측정 도구까지 받음) */
const opened = async (): Promise<{ app: NcViewerApp; root: HTMLElement; v: InstanceType<typeof fake.FakeViewer> }> => {
  const { app, root } = mount();
  expect(await app.openBuffer('part.MPF', enc(SIE))).toBe(true);
  await until(() => !!root.querySelector('.mb-lock'));
  return { app, root, v: fake.FakeViewer.last! };
};
const tool = (root: ParentNode, label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.toolbar button[aria-label="${label}"]`)!;

describe('209차: 누름이 아닌 길로 초점 든 칸이 사라질 때 초점이 문서(body)로 빠지지 않음', () => {
  it('① 알림 넷 한도: 초점 든 안내가 새 알림에 밀려 빠지면 남은 알림의 같은 차례 ✕로 — 초점 든 오류는 안내가 빠져 그대로(147차)', () => {
    toastArea().replaceChildren();
    for (const n of [1, 2, 3, 4]) toast(`알림 ${n}`);
    const xs = (): HTMLElement[] => [...toastArea().querySelectorAll<HTMLElement>('.toast-x')];
    xs()[0]!.focus();
    expect(document.activeElement).toBe(xs()[0]);
    toast('알림 5');
    expect([...toastArea().children].map((t) => t.firstChild!.textContent)).toEqual(['알림 2', '알림 3', '알림 4', '알림 5']);
    expect(focused()).toBe(xs()[0]);

    // 초점 든 알림이 오류면 한도는 가장 오래된 안내를 빼서 초점 칸은 남는다(전과 같음)
    toastArea().replaceChildren();
    toast('오류 하나', 'error');
    for (const n of [1, 2, 3]) toast(`안내 ${n}`);
    const err = toastArea().querySelector<HTMLElement>('.toast.error .toast-x')!;
    err.focus();
    toast('안내 4');
    expect([...toastArea().children].map((t) => t.firstChild!.textContent)).toEqual(['오류 하나', '안내 2', '안내 3', '안내 4']);
    expect(focused()).toBe(err);
  });

  it('② 단면 상자 뒤집기에 초점인 채 다른 길로 연 파일이 열리지 않으면 상자를 연 「단면」 버튼으로 — 열리면 3D 보기(새 장면이 단면을 꺼 뒤집기가 막혀도)', async () => {
    const { app, root, v } = await opened();
    const sec = root.querySelector<HTMLButtonElement>('.toolbar button[aria-haspopup="dialog"]')!;
    const pop = root.querySelector<HTMLElement>('.sec-pop')!;
    const flip = [...pop.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '뒤집기')!;
    const openFlip = (): void => {
      sec.click();
      expect(pop.hidden).toBe(false);
      [...pop.querySelectorAll<HTMLButtonElement>('.seg')].find((b) => b.textContent === 'X')!.click();
      expect([v.section?.axis, flip.disabled]).toEqual(['x', false]);
      flip.focus();
      expect(document.activeElement).toBe(flip);
    };
    // 열리지 않는 파일(빈 파일 — Ctrl+O로 고르거나 끌어 놓은 파일은 openFile → openBuffer): 상자가 닫히고 앞 문서·단면은 그대로
    openFlip();
    expect(await app.openBuffer('bad.MPF', enc(''))).toBe(false);
    expect([pop.hidden, v.section?.axis, app.state().docName]).toEqual([true, 'x', 'part.MPF']);
    expect(focused()).toBe(sec);
    // 열리면 새 장면이 단면을 끄고(뒤집기 막힘) 3D 보기로(setDoc — 이미 맞음)
    openFlip();
    expect(await app.openBuffer('next.MPF', enc(SIE))).toBe(true);
    expect([pop.hidden, v.section, flip.disabled]).toEqual([true, null, true]);
    expect(focused()).toBe(v.canvas);
  });

  it('③ 측정 띠 잠금 버튼이 미리 보기 알림 길에서 숨어도 같은 차례에 3D 보기로(재현되지 않음 — 점 수가 바뀌어 측정 띠 맞추기가 받음, 138·154차)', async () => {
    const { app, root, v } = await opened();
    tool(root, '측정').click();
    expect(app.state().measuring).toBe(true);
    const lock = root.querySelector<HTMLButtonElement>('.measure-bar .mb-lock')!;
    // 첫 점: 둘째 점 방향을 잡는 동안 잠금 버튼이 보인다(떼기 뒤 띠 맞추기 — 101차)
    v.measurePts = 1;
    v.canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(lock.hidden).toBe(false);
    lock.focus();
    expect(document.activeElement).toBe(lock);
    // 미리 보기 알림 길(measure-lock attach → update)만으로 점 수가 바뀌어(둘째 점) 버튼이 숨음
    v.measurePts = 2;
    for (const cb of v.hoverCbs) cb();
    expect(lock.hidden).toBe(true);
    expect(focused()).toBe(v.canvas);
  });

  it('④ 패널 「여기까지 그리기」에 초점인 채 Esc로 고른 줄을 지워 막히면 같은 줄의 앞 칸 「전체」로 — 초점이 밖이면 그대로', async () => {
    const { app, root } = await opened();
    const toHere = root.querySelector<HTMLButtonElement>('.play-row button[aria-label="여기까지 그리기"]')!;
    const all = toHere.previousElementSibling as HTMLButtonElement;
    expect(all.textContent).toBe('전체');
    app.selectLine(6);
    expect(toHere.disabled).toBe(false);
    toHere.focus();
    expect(document.activeElement).toBe(toHere);
    keydown(toHere, 'Escape');
    expect([app.doc!.selLine, toHere.disabled]).toEqual([-1, true]);
    expect(focused()).toBe(all);
    // 초점이 그 버튼 밖(재생 칸 「처음」)이면 막혀도 옮기지 않는다
    app.selectLine(6);
    const first = root.querySelector<HTMLButtonElement>('.play-row button')!;
    first.focus();
    keydown(first, 'Escape');
    expect([toHere.disabled, focused()]).toEqual([true, first]);
  });

  it('⑤ 열린 메뉴 항목에서 Ctrl+O로 고른 파일이 열리지 않으면 메뉴 버튼으로(메뉴는 닫힘) — 시작 화면', async () => {
    const { app, root } = mount();
    const choose = vi.spyOn(app as unknown as { chooseFile(): void }, 'chooseFile').mockImplementation(() => {});
    const settings = root.querySelector<HTMLButtonElement>('.titlebar button[aria-label="앱 설정"]')!;
    const menu = settings.parentElement!.querySelector<HTMLElement>('.menu')!;
    settings.click();
    const item = document.activeElement as HTMLElement;
    expect([menu.hidden, menu.contains(item)]).toEqual([false, true]);
    // Ctrl+O는 앱 키(파일 고르기) — 메뉴는 열린 채 초점은 그 항목
    expect(keydown(item, 'o', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect([choose.mock.calls.length, menu.hidden, document.activeElement === item]).toEqual([1, false, true]);
    // 고른 파일(빈 파일)이 열리지 않음: openBuffer가 메뉴를 닫는다
    expect(await app.openBuffer('bad.MPF', enc(''))).toBe(false);
    expect([menu.hidden, root.querySelector<HTMLElement>('.start-error')!.hidden]).toEqual([true, false]);
    expect(focused()).toBe(settings);
  });
});
