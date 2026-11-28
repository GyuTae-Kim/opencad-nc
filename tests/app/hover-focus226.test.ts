// @vitest-environment jsdom
/**
 * 226차(WCAG 1.4.13 올림·초점으로 뜨는 내용): 앱이 포인터 올림·키보드 초점으로 띄우는 내용(브라우저 title 풍선 글은 셈 밖)은
 * (가) 포인터·초점을 옮기지 않고 닫을 수 있고(Esc — 다른 내용을 가리지 않으면 예외), (나) 포인터로 띄운 것은 그 위로 옮겨도 사라지지 않고,
 * (다) 올림·초점이 걷히거나 사용자가 닫거나 정보가 낡을 때까지 남아야 한다(시간으로 저절로 닫히지 않음). 감사 표는 .runtime/r226/progress.md와 같은 줄.
 * - 소스 글: src의 올림·초점 사건 자리(사건 이름 문자열·코어 미리 보기 알림 부름 — 주석 줄 뺌)는 모두 TS_TABLE에, 세 CSS 파일의 :hover·:focus 규칙은
 *   모양(바탕·글자·테두리 색·outline)만 바꾸거나 CSS_TABLE에 있어야 한다 — 새로 띄우는 자리가 표 밖에 생기면 판정과 함께 표에 더해야 통과한다.
 * - 고친 것(226차): 좁은 화면 판단 띠 글은 키보드 초점이 그 줄에 들면 펼친다(223차 :has(:focus-visible)) — 3D 보기를 더 덮는데 초점을 옮기지 않고 접을 길이 없었다.
 *   이제 Esc가 먼저 접고(그 줄 shut — 초점 그대로, 측정·고른 것 지우기는 다음 Esc), 초점이 줄을 떠나면 풀려 다시 들면 다시 펼친다. 포인터 이동·60초(가짜 시계)에 그대로인지도 본다.
 * - 225차가 새로 본 것: 단면 상자 뒤집기 버튼의 눌림(aria-pressed)에 모양 규칙이 없던 것 — 작은 버튼 눌림 꼴(.btn.small.on)을 같이 쓴다.
 * 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView — view-tools·target-size222 꼴).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      // 코어 캔버스는 키보드 초점을 받는다(코어 viewer.ts tabIndex 0 — target-size222 가짜와 같게)
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

vi.mock('opencad-viewer3d', async (importOriginal) => {
  const core = await importOriginal<typeof import('opencad-viewer3d')>();
  // new로 부르면 돌려준 객체가 그 값이 된다(가짜 뷰어의 Proxy와 같은 길)
  function Viewer3d(host: HTMLElement): object {
    return new fake.FakeViewer(host);
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

import { NcViewerApp } from '../../src/app/app';
import { loadPanelInfo } from '../../src/app/panel';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// ───────────────────────── 소스 글: TS 사건 자리 ─────────────────────────

/** 올림·초점으로 띄울 수 있는 사건 이름(문자열)과 코어 측정 미리 보기 알림(포인터 올림이 바꾸는 값) */
const EVENT = /(['"`])(mouseenter|mouseover|mousemove|pointerenter|pointerover|pointermove|focus|focusin|dragenter|dragover)\1/g;
const HOVER_HOOK = /\bonMeasureHoverChange\??\.?\(/g;
type Judge = '지킴' | '대상 밖' | '고침';
interface TsEntry {
  /** progress.md 표 1의 줄 번호 */
  readonly row: number;
  readonly file: string;
  readonly ev: string;
  readonly n: number;
  readonly what: string;
  readonly judge: Judge;
}
const TS_TABLE: readonly TsEntry[] = [
  { row: 1, file: 'src/app/measure-lock.ts', ev: 'onMeasureHoverChange()', n: 1, what: '측정 중 포인터 올림 → 붙잡기 툴팁(.snap-tip) — Esc(escTip·측정 지우기·끄기), 따라가는 글, 시간 닫힘 없음', judge: '지킴' },
  { row: 2, file: 'src/app/measure-lock.ts', ev: 'pointermove', n: 1, what: '캔버스 포인터 자리 기록(116차 Shift+Tab 되돌리기) — 띄우는 것 없음', judge: '대상 밖' },
  { row: 3, file: 'src/app/dom.ts', ev: 'pointerenter', n: 1, what: '알림 상자 위 올림은 닫힘을 미룸(157차 — 알림은 사건이 띄움)', judge: '대상 밖' },
  { row: 4, file: 'src/app/panel.ts', ev: 'pointermove', n: 2, what: '패널 크기 손잡이 끌기(누른 동안)', judge: '대상 밖' },
  { row: 4, file: 'src/app/panel.ts', ev: 'focus', n: 1, what: '손잡이 초점에 값·방향 맞춤(aria — 보이는 내용 없음)', judge: '대상 밖' },
  { row: 5, file: 'src/app/viewer-ui.ts', ev: 'pointermove', n: 1, what: '단면 손잡이 끌기(누른 동안)', judge: '대상 밖' },
  { row: 6, file: 'src/app/aim.ts', ev: 'pointermove', n: 4, what: '손가락 정밀 조준(길게 누른 동안 — 누름)', judge: '대상 밖' },
  { row: 7, file: 'src/app/app.ts', ev: 'focusin', n: 1, what: '바깥 초점에 펼친 메뉴·단면 상자 닫기(띄우지 않음)', judge: '대상 밖' },
  { row: 8, file: 'src/app/app.ts', ev: 'dragenter', n: 1, what: '파일을 끌어 올림 → 끌어 놓기 덮개(Esc·창 밖·놓기에 거둠, 시간 닫힘 없음)', judge: '지킴' },
  { row: 8, file: 'src/app/app.ts', ev: 'dragover', n: 1, what: '같은 덮개(끄는 동안 놓기 꼴)', judge: '지킴' },
  // 227차(표 1 밖 새 줄 — .runtime/r227/progress.md 표 #1): 알림 상자 비키기는 띄우지 않고 옮기기만 한다(WCAG 2.4.11 — focus-obscured227)
  { row: 9, file: 'src/app/dom.ts', ev: 'focusin', n: 1, what: '초점 든 칸을 통째로 덮은 알림 상자를 그 칸 위로 비켜 올림(띄우는 것 없음)', judge: '대상 밖' },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}
/** 파일·사건마다 코드 줄(주석 줄 — //·*·/* 로 시작 — 뺌)의 수 */
function eventSites(): Map<string, number> {
  const seen = new Map<string, number>();
  for (const f of tsFiles('src')) {
    for (const line of read(f).split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      const keys = [...line.matchAll(EVENT)].map((m) => m[2]!).concat([...line.matchAll(HOVER_HOOK)].map(() => 'onMeasureHoverChange()'));
      for (const k of keys) seen.set(`${f} ${k}`, (seen.get(`${f} ${k}`) ?? 0) + 1);
    }
  }
  return seen;
}

// ───────────────────────── 소스 글: CSS 규칙 ─────────────────────────

const SHEETS = { vlist: 'src/view/vlist.css', styles: 'src/app/styles.css', shortcuts: 'src/app/shortcuts.css' } as const;
type Sheet = keyof typeof SHEETS;
interface Rule {
  readonly sheet: Sheet;
  readonly media: string;
  readonly sel: string;
  readonly d: readonly (readonly [string, string])[];
}
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** 225차 text-spacing225 꼴: 주석을 빼고 @media 덩어리 안팎 규칙을 읽는다(선택자 목록은 「, 」로 모음) */
function rulesOf(sheet: Sheet): Rule[] {
  const css = read(SHEETS[sheet]).replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@(?!media\b)[a-z-]+/.test(css)) throw new Error(`${sheet}: 모르는 @규칙`);
  const out: Rule[] = [];
  const add = (media: string, sel: string, body: string): void => {
    const d = body
      .split(';')
      .map((x) => x.trim())
      .filter((x) => x.includes(':'))
      .map((x): [string, string] => {
        const i = x.indexOf(':');
        return [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim().replace(/\s*!important$/, '')];
      });
    out.push({ sheet, media: norm(media), sel: norm(sel).replace(/\s*,\s*/g, ', '), d });
  };
  let blocks = 0;
  for (const m of css.matchAll(/@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}|([^{}@]+)\{([^{}]*)\}/g)) {
    if (m[1] !== undefined) {
      blocks++;
      for (const r of m[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) add(m[1], r[1]!, r[2]!);
    } else add('', m[3]!, m[4]!);
  }
  if (blocks !== (css.match(/@media/g) ?? []).length) throw new Error(`${sheet}: @media 덩어리를 다 읽지 못함`);
  return out;
}
const RULES: readonly Rule[] = (Object.keys(SHEETS) as Sheet[]).flatMap(rulesOf);
const where = (r: { sheet: Sheet; media: string; sel: string }): string => `${r.sheet}${r.media ? ` ${r.media}` : ''} ${r.sel}`;
/** 올림·초점 상태로 맞는 규칙 */
const HOVER_FOCUS = /:(hover|focus|focus-visible|focus-within)\b/;
/** 모양만 바꾸는 속성(바탕·글자·테두리 색·초점 테두리) — 새 내용을 띄우지 않는다 */
const LOOK = /^(background(-color)?|color|border(-(top|right|bottom|left))?-color|outline(-(color|style|width|offset))?)$/;
/** 선택자 하나의 특정도(id·클래스/속성/가상 클래스·요소) — :not()·:has()·:is()는 안 인자로 센다 */
function specificity(sel: string): [number, number, number] {
  const s = sel.replace(/:(not|has|is)\(/g, '(').replace(/:where\([^)]*\)/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const els = (s.replace(/\[[^\]]+\]|"[^"]*"|'[^']*'/g, '').match(/(^|[\s>+~(])[a-z][\w-]*/gi) ?? []).length;
  return [ids, cls, els];
}
const NARROW = '(max-width: 759.98px)';
const OPEN = '.notice:has(:focus-visible) .nt-text';
const SHUT = '.notice.shut:not(.open) .nt-text';
/** 올림·초점으로 내용을 펼치거나 띄우는 CSS 규칙(모양만 바꾸는 규칙은 표 밖) */
const CSS_TABLE: readonly { sheet: Sheet; media: string; sel: string; what: string; judge: Judge; shut?: string }[] = [
  { sheet: 'styles', media: NARROW, sel: OPEN, what: '좁은 화면 판단 띠 글 펼침(223차 — 키보드 초점이 줄에 들면) — 3D 보기를 더 덮음, 226차: Esc로 접기', judge: '고침', shut: SHUT },
];

// ───────────────────────── 앱 그리기 ─────────────────────────

const enc = new TextEncoder();
// Siemens: 다른 파일의 부프로그램(L9001 — 해석 판단 띠 「찾지 못했습니다」·동작 버튼·✕) — target-size222와 같은 글
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');

/** 넓은 화면(1280×800) 또는 좁은 창(390×844 — 마우스·키보드 기기)에서 앱을 세우고 Siemens 프로그램을 연다 */
async function boot(narrow: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: narrow && q.includes(NARROW), addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal('innerWidth', narrow ? 390 : 1280);
  vi.stubGlobal('innerHeight', narrow ? 844 : 800);
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const app = new NcViewerApp(root);
  expect(await app.openBuffer('part.MPF', enc.encode(SIE).buffer as ArrayBuffer)).toBe(true);
  const api = window.opencadApp!;
  const row = root.querySelector<HTMLElement>('.notice-bar .notice')!;
  return {
    root,
    api,
    row,
    text: row.querySelector<HTMLElement>('.nt-text')!,
    act: row.querySelector<HTMLElement>('.mb-btn:not(.icon)')!,
    close: row.querySelector<HTMLElement>('.mb-btn.icon')!,
    canvas: root.querySelector<HTMLCanvasElement>('.v3d canvas')!,
  };
}
const esc = (el: Element): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};
/** 좁은 화면 판단 띠 글이 펼쳐 보이는지: 펼친 규칙(223차)이 맞고, 접는 규칙(226차 — CSS에 있을 때)이 맞지 않음 */
const shutRule = (): Rule | undefined => RULES.find((r) => r.sheet === 'styles' && r.media === NARROW && r.sel === SHUT);
const expanded = (t: HTMLElement): boolean => t.matches(OPEN) && !(shutRule() && t.matches(SHUT));
/** 포인터를 옮겨 본다(띠 줄 위·글 위·3D 보기 위·바깥) — jsdom에는 PointerEvent 생성자가 없어 MouseEvent에 그 사건 이름 */
function wander(...els: Element[]): void {
  for (const el of els)
    for (const type of ['pointerover', 'pointerenter', 'pointermove', 'mousemove', 'pointerleave', 'pointerout'])
      el.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', clientX: 20, clientY: 20 }));
}

// 시험이 건 실제 타이머를 적어 두고 시험마다 지운다(view-tools 110차 꼴 — 파일 끝 뒤 jsdom을 내린 다음 돌면 document가 없어 흔들림)
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const timers = new Set<unknown>();

beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(3D 보기 위 UI·정보 탭·깎기·측정 도구)을 미리 받아 둔다(ci-guard 5번 — target-size222와 같은 목록, 모두 맨 위 곁효과 없음)
  await import('../../src/app/viewer-ui');
  await loadPanelInfo();
  await import('../../src/app/sim');
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
  vi.stubGlobal('setTimeout', (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id: unknown = realSetTimeout(() => {
      timers.delete(id);
      cb(...args);
    }, ms);
    timers.add(id);
    return id;
  });
  vi.stubGlobal('clearTimeout', (id: unknown) => {
    timers.delete(id);
    realClearTimeout(id as Parameters<typeof clearTimeout>[0]);
  });
  // 그릴 때마다 지금의 setTimeout을 부른다(가짜 시계를 켜면 그 시계로)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => globalThis.setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => globalThis.clearTimeout(id));
  vi.stubGlobal(
    'Worker',
    class {
      onmessage = null;
      onerror = null;
      postMessage(): void {}
      terminate(): void {}
    },
  );
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  for (const id of timers) realClearTimeout(id as Parameters<typeof clearTimeout>[0]);
  timers.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('226차 올림·초점으로 뜨는 내용(WCAG 1.4.13) 감사 표', () => {
  it('소스 글: src의 올림·초점 사건 자리는 모두 TS_TABLE에(새 자리는 판정과 함께 표에), 표 줄의 자리는 모두 있다 — 툴팁을 시간으로 숨기는 타이머는 없다', () => {
    const seen = eventSites();
    const want = new Map(TS_TABLE.map((e) => [`${e.file} ${e.ev}`, e.n]));
    const outside = [...seen].filter(([k, n]) => want.get(k) !== n).map(([k, n]) => `${k} ×${n}(표 ×${want.get(k) ?? 0})`);
    const stale = [...want].filter(([k]) => !seen.has(k)).map(([k]) => k);
    expect({ outside, stale }).toEqual({ outside: [], stale: [] });
    // (다) 붙잡기 툴팁(표 1 #1): 측정 조각의 타이머는 띠 위 알림 거두기뿐 — 툴팁 숨김은 update·follow·escTip·reset(사건·Esc·측정 끄기)
    const lock = read('src/app/measure-lock.ts');
    expect([...lock.matchAll(/setTimeout\(\(\) => ([^,]+),/g)].map((m) => m[1])).toEqual(['this.dropFlash(null)']);
    expect(/pointer-events: none/.test(RULES.filter((r) => r.sheet === 'styles' && r.sel === '.snap-tip').flatMap((r) => r.d.map(([k, v]) => `${k}: ${v}`)).join(';'))).toBe(true);
  });

  it('소스 글: 세 CSS 파일의 :hover·:focus 규칙은 모양만 바꾸거나 CSS_TABLE에 있다 — 펼친 글을 접는 규칙(226차)은 펼친 규칙보다 특정도가 높다', () => {
    const hf = RULES.filter((r) => HOVER_FOCUS.test(r.sel));
    const keys = new Set(CSS_TABLE.map(where));
    const content = hf.filter((r) => !r.d.every(([k]) => LOOK.test(k)));
    expect({ outside: content.map(where).filter((k) => !keys.has(k)), stale: CSS_TABLE.map(where).filter((k) => !hf.some((r) => where(r) === k)) }).toEqual({ outside: [], stale: [] });
    // 모양만 바꾸는 올림·초점 규칙 26개(:hover 18 — vlist 2 포함, :focus·:focus-visible만 8 — progress.md 표 2) + 내용을 펼치는 규칙 1
    expect([hf.length - content.length, content.length]).toEqual([26, 1]);
    for (const e of CSS_TABLE.filter((x) => x.shut)) {
      const open = RULES.find((r) => where(r) === where(e))!;
      const shut = RULES.find((r) => r.sheet === e.sheet && r.media === e.media && r.sel === e.shut);
      expect(shut, `${e.shut} 규칙`).toBeDefined();
      // 접으면 바탕 자름 꼴로 돌아간다(줄 수는 바탕 규칙 .notice .nt-text 그대로), 펼친 규칙과 같은 속성을 덮는다
      expect(Object.fromEntries(shut!.d)).toEqual({ display: '-webkit-box', overflow: 'hidden' });
      expect(Object.fromEntries(open.d)).toEqual({ display: 'block', overflow: 'visible' });
      const [a, b] = [specificity(e.shut!), specificity(e.sel)];
      expect(a[0] * 1e4 + a[1] * 1e2 + a[2], `${e.shut} ${a} > ${e.sel} ${b}`).toBeGreaterThan(b[0] * 1e4 + b[1] * 1e2 + b[2]);
    }
  });

  it('좁은 화면 판단 띠 글(키보드 초점으로 펼침): Esc가 먼저 접고(초점 그대로·고른 것 지우기는 다음 Esc), 포인터를 옮겨도·60초가 지나도 그대로, 줄을 떠나면 풀려 다시 들면 다시 펼친다', async () => {
    const { api, row, text, act, close, canvas } = await boot(true);
    api.selectLine(6);
    expect(api.state.selLine).toBe(6);
    // 223차: 줄 버튼에 키보드 초점 → 펼침
    act.focus();
    expect([document.activeElement === act, expanded(text)]).toEqual([true, true]);
    // (나) 초점으로 띄운 것 — 포인터를 어디로 옮겨도 그대로, (다) 60초(가짜 시계)가 지나도 그대로
    wander(row, text, canvas, document.body);
    vi.useFakeTimers();
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();
    expect([document.activeElement === act, row.isConnected, expanded(text)]).toEqual([true, true, true]);
    // (가) Esc: 초점을 옮기지 않고 접는다 — 이 Esc는 그 몫으로 막고(기본 동작·전파), 고른 줄은 그대로
    const first = esc(act);
    expect({ prevented: first.defaultPrevented, shut: row.classList.contains('shut'), expanded: expanded(text), focus: document.activeElement === act, sel: api.state.selLine }).toEqual({
      prevented: true,
      shut: true,
      expanded: false,
      focus: true,
      sel: 6,
    });
    // 닫은 것은 초점이 줄 안에 있는 동안 그대로(포인터 이동·시간·같은 줄 ✕로 옮김)
    wander(row, text, canvas);
    vi.useFakeTimers();
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();
    close.focus();
    expect([row.classList.contains('shut'), expanded(text)]).toEqual([true, false]);
    // 다음 Esc는 전과 같은 앱 Esc(측정 중이 아니면 고른 것 지우기)
    esc(close);
    expect([api.state.selLine, row.classList.contains('shut')]).toEqual([-1, true]);
    // 초점이 줄을 떠나면 풀리고, 다시 들면 다시 펼친다(223차 키보드 길)
    canvas.focus();
    expect(row.classList.contains('shut')).toBe(false);
    act.focus();
    expect(expanded(text)).toBe(true);
    // 글을 눌러 펼친 줄(.open — 초점 아님)은 Esc가 접지 않는다(누르기로 닫음)
    row.classList.add('open');
    esc(act);
    expect(row.classList.contains('shut')).toBe(false);
  });

  it('넓은 화면은 판단 띠 글을 자르지 않아(펼침 규칙 없음) 줄 버튼의 Esc는 전과 같이 고른 것 지우기 — 접기 갈래를 타지 않는다', async () => {
    const { api, row, act } = await boot(false);
    api.selectLine(6);
    act.focus();
    const e = esc(act);
    expect([e.defaultPrevented, api.state.selLine, row.classList.contains('shut')]).toEqual([true, -1, false]);
  });

  it('225차가 본 것: 단면 상자 뒤집기 버튼의 눌림(aria-pressed)은 작은 버튼 눌림 꼴(.btn.small.on과 같은 규칙)로 보인다 — 값 글만이 아니다', async () => {
    const { root } = await boot(false);
    const flip = root.querySelector<HTMLButtonElement>('.sec-pop .sec-row .btn.small')!;
    expect([flip.textContent, flip.getAttribute('aria-pressed')]).toEqual(['뒤집기', 'false']);
    const hits = (): Rule[] =>
      RULES.filter((r) => {
        try {
          return r.sheet === 'styles' && r.media === '' && flip.matches(r.sel);
        } catch {
          return false;
        }
      });
    const off = new Set(hits());
    flip.setAttribute('aria-pressed', 'true');
    const on = hits().filter((r) => !off.has(r));
    expect(on.map((r) => [r.sel, Object.fromEntries(r.d)])).toEqual([
      [".btn.small.on, .btn.small[aria-pressed='true']", { 'border-color': 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }],
    ]);
  });
});
