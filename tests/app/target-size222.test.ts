// @vitest-environment jsdom
/**
 * 222차(WCAG 2.5.8 대상 크기(최소) — 24×24 CSS px 또는 예외): 누를 수 있는 마디의 감사 표(TABLE — .runtime/r222/progress.md 표와 같은 번호)를 두 꼴로 지킨다.
 * - 넓은 화면(1280×800 마우스)·휴대폰(390×844 손가락) 꼴마다 jsdom에서 처음 화면·최근 문서·단축키 창·알림 상자와 예제 프로그램(코드·공구·정보·깎기 탭·재생 띠)·
 *   Siemens(해석 판단 띠·정보 탭)·판재 MPR(가공·변수·깎기 탭)을 그려, 누를 마디(button·a[href]·input·select·누를 role·tabindex ≥0·컨트롤을 감싼 label·
 *   click/pointerdown을 듣는 칸·CSS cursor pointer/grab/resize 규칙에 맞는 칸)를 모아 모두 표의 한 꼴에 드는지 본다 — 새 누를 칸이 생기면 표에 더해야 통과한다.
 * - jsdom은 배치를 하지 않아 크기는 styles.css·vlist.css·shortcuts.css 규칙을 읽어 셈한다(160차 CSS 글 시험 꼴을 넓힘): 그 꼴의 @media만 켜고 특정도·차례로 겹쳐
 *   (인라인 style 포함, font·line-height 이어받기, 사용자 정의 속성) 높이(height·min-height 또는 줄 높이 + padding + border, 표 줄은 칸, flex 늘어남)와
 *   폭(width·min-width 또는 안 글·그림 폭 — 채우는 칸은 「채움」)을 어림한다. 숨김 상태([hidden])는 셈 밖(보일 때의 크기), @media로 안 보이는 꼴은 건너뛴다.
 * - 판정 대조: 「24 넘음」 꼴은 셈한 폭·높이 24 이상, 예외(간격·동등·글줄 안·브라우저 기본)·「고르지 않음」 꼴은 그 꼴에서 24 미만(24 이상이 되면 표를 고쳐야 — 낡은 예외 막기).
 * 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView), 깎기 워커는 같은 실행기를 같은 스레드에서(i18n-screens199 꼴).
 */
import { readFileSync } from 'node:fs';
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
import { toast } from '../../src/app/dom';
import { installLocalization } from '../../src/app/i18n';
import { loadPanelInfo } from '../../src/app/panel';
import { RecentStore } from '../../src/app/recent';
import { SimRunner } from '../../src/sim/runner';
import { ncSampleProgram } from '../../src/view/sample';
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

// Siemens: 다른 파일의 부프로그램(L9001 — 해석 판단 띠 「찾지 못했습니다」·동작 버튼·✕)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
// woodWOP MPR: 판 600 × 400 × 19, 윗면 구멍·포켓, 옆면 구멍, 변수 하나(가공·변수 탭)
const MPR = [
  '[H',
  'VERSION="4.0 Alpha"',
  '_BSX=600',
  '_BSY=400',
  '_BSZ=19',
  '',
  '[001',
  'DM="12"',
  'KM="DEPTH"',
  '',
  '<100 \\WerkStck\\',
  'LA="600"',
  'BR="400"',
  'DI="19"',
  '',
  '<102 \\BohrVert\\',
  'XA="100"',
  'YA="100"',
  'TI="DM"',
  'DU="8"',
  '',
  '<112 \\Tasche\\',
  'XA="300"',
  'YA="200"',
  'LA="100"',
  'BR="50"',
  'TI="10"',
  '',
  '<103 \\BohrHoriz\\',
  'XA="0"',
  'YA="100"',
  'ZA="9.5"',
  'DU="8"',
  'TI="30"',
  'BM="XP"',
  '!',
  '',
].join('\n');

// ───────────────────────── 감사 표 ─────────────────────────

type Verdict = '24 넘음' | '간격' | '동등' | '글줄 안' | '브라우저 기본' | '고르지 않음' | '대상 아님' | '큼';
/** 24 미만으로 두는 판정(예외·디자인 결정) — 셈이 24 이상이면 표가 낡음 */
const SMALL: readonly Verdict[] = ['간격', '동등', '글줄 안', '브라우저 기본', '고르지 않음'];
interface Entry {
  readonly n: number;
  readonly sel: string;
  readonly name: string;
  readonly wide: Verdict;
  readonly phone: Verdict;
}
/** 위에서 처음 맞는 꼴이 그 마디의 꼴(progress.md 표 번호 그대로 — 99는 시험 걸음 밖) */
const TABLE: readonly Entry[] = [
  { n: 1, sel: 'input[type="file"]', name: '파일 고르기 칸(숨김 — 열기 버튼이 엶)', wide: '대상 아님', phone: '대상 아님' },
  { n: 2, sel: '.v3d, .v3d canvas', name: '3D 보기(캔버스와 감싼 칸 — 정밀 조준이 캡처 단계에서 받음)', wide: '큼', phone: '큼' },
  { n: 3, sel: '.dropzone', name: '시작 화면 열기 칸', wide: '큼', phone: '큼' },
  { n: 4, sel: '.sc-back', name: '단축키 창 덮개(바깥 누르기)', wide: '큼', phone: '큼' },
  { n: 5, sel: '.sc-body', name: '단축키 창 본문(키보드 굴림 영역)', wide: '큼', phone: '큼' },
  { n: 6, sel: '.vlist', name: '코드 목록 상자(줄 누르기 위임)', wide: '큼', phone: '큼' },
  { n: 7, sel: '.menu', name: '메뉴 상자(항목 누르기 뒤 닫기만 — 위임)', wide: '대상 아님', phone: '대상 아님' },
  { n: 8, sel: '.language-list button', name: '언어 목록 항목', wide: '24 넘음', phone: '24 넘음' },
  { n: 9, sel: '.language-trigger', name: '언어 버튼', wide: '24 넘음', phone: '24 넘음' },
  { n: 10, sel: '.menu button', name: '메뉴 항목', wide: '24 넘음', phone: '24 넘음' },
  { n: 11, sel: '.tbtn', name: '제목·도구 막대 버튼·링크', wide: '24 넘음', phone: '24 넘음' },
  { n: 12, sel: '.icon-btn', name: '패널 ✕', wide: '24 넘음', phone: '24 넘음' },
  { n: 13, sel: '.panel-tab', name: '패널 탭', wide: '24 넘음', phone: '24 넘음' },
  { n: 14, sel: '.panel-grip', name: '패널 크기 손잡이(넓히면 3D 보기·탭 줄 누르기를 가로챔)', wide: '고르지 않음', phone: '고르지 않음' },
  { n: 15, sel: '.code-search input', name: '코드 찾기 칸', wide: '24 넘음', phone: '24 넘음' },
  { n: 16, sel: '.st-warn', name: '상태 막대 경고(원이 막대 글 줄 안)', wide: '간격', phone: '간격' },
  { n: 17, sel: '.notice .nt-text', name: '해석 판단 띠 글(좁은 화면에서 펼침)', wide: '대상 아님', phone: '간격' },
  { n: 18, sel: '.mb-btn', name: '측정·재생·따라가기·판단 띠 버튼', wide: '24 넘음', phone: '24 넘음' },
  { n: 19, sel: '.toast-act, .toast-x', name: '알림 상자 동작·닫기', wide: '24 넘음', phone: '24 넘음' },
  { n: 20, sel: '.vlist-row', name: '코드 목록 줄(같은 일을 찾기 칸 :줄 번호·↑↓·재생 걷기로)', wide: '동등', phone: '24 넘음' },
  { n: 21, sel: '.recent-open, .recent-del', name: '최근 문서 줄·지우기', wide: '24 넘음', phone: '24 넘음' },
  { n: 22, sel: '.btn.small', name: '작은 버튼', wide: '24 넘음', phone: '24 넘음' },
  { n: 23, sel: 'select.select', name: '고르기', wide: '24 넘음', phone: '24 넘음' },
  { n: 24, sel: '.seg', name: '단면 축', wide: '24 넘음', phone: '24 넘음' },
  { n: 25, sel: '.sec-row input[type="range"]', name: '단면 위치 막대', wide: '24 넘음', phone: '24 넘음' },
  { n: 26, sel: 'input[type="range"]', name: '재생·따라가기 막대(브라우저 기본 높이 — 위아래 틈)', wide: '간격', phone: '간격' },
  { n: 27, sel: '.sec-handle', name: '화면 위 단면 손잡이(같은 일을 단면 위치 막대로)', wide: '동등', phone: '24 넘음' },
  { n: 28, sel: 'table.grid button.linkish', name: '공구 표 Z 최저', wide: '24 넘음', phone: '24 넘음' },
  { n: 29, sel: 'button.linkish', name: '깎기 탭 문장 안 줄 버튼', wide: '글줄 안', phone: '글줄 안' },
  { n: 30, sel: 'tr.clickable', name: '줄을 누르는 표', wide: '24 넘음', phone: '24 넘음' },
  { n: 31, sel: '.toggle', name: '공구 표 눈', wide: '24 넘음', phone: '24 넘음' },
  { n: 32, sel: '.warn-item', name: '경고·파일·급속·가공 목록 줄', wide: '24 넘음', phone: '24 넘음' },
  { n: 33, sel: 'label.group-item', name: '켜고 끄는 줄(체크 상자를 감싼 라벨)', wide: '24 넘음', phone: '24 넘음' },
  { n: 34, sel: 'input[type="checkbox"]', name: '체크 상자(감싼 라벨이 누름 자리)', wide: '브라우저 기본', phone: '브라우저 기본' },
  { n: 35, sel: 'label.prop-row', name: '설정 줄(고르기·숫자 칸을 감싼 라벨)', wide: '24 넘음', phone: '24 넘음' },
  { n: 36, sel: 'input.num-input', name: '숫자 칸', wide: '24 넘음', phone: '24 넘음' },
  { n: 37, sel: '.site-intro a', name: '앱이 서기 전 안내 링크(index.html — 앱이 서면 지움)', wide: '글줄 안', phone: '글줄 안' },
  { n: 99, sel: '#opencad-analytics-choice button', name: '방문 통계 동의 상자 버튼(사이트 도구 — 인라인 크기)', wide: '24 넘음', phone: '24 넘음' },
];

// ───────────────────────── CSS 규칙 읽기 ─────────────────────────

interface Form {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly coarse: boolean;
}
const WIDE: Form = { name: '넓은 화면', w: 1280, h: 800, coarse: false };
const PHONE: Form = { name: '휴대폰', w: 390, h: 844, coarse: true };

/** @media 조건(앱 CSS·앱 matchMedia가 쓰는 꼴만 — 모르는 조건이면 던져 이 시험을 고치게) */
function media(q: string, f: Form): boolean {
  return q.split(',').some((part) => {
    let p = part.trim();
    const not = p.startsWith('not all and ');
    if (not) p = p.slice('not all and '.length);
    const ok = p.split(/\s+and\s+/).every((c) => {
      const m = /^\(\s*([a-z-]+)\s*:\s*([^)]*?)\s*\)$/.exec(c.trim());
      if (!m) throw new Error(`모르는 @media 조건: ${c}`);
      const k = m[1]!;
      const v = m[2]!;
      if (k === 'max-width') return f.w <= parseFloat(v);
      if (k === 'max-height') return f.h <= parseFloat(v);
      if (k === 'pointer') return (v === 'coarse') === f.coarse;
      if (k === 'display-mode' || k === 'prefers-color-scheme') return false;
      throw new Error(`모르는 @media 조건: ${c}`);
    });
    return not ? !ok : ok;
  });
}

/** 괄호 밖 쉼표로 나눈다 */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let d = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') d--;
    if (ch === ',' && d === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
/** 맨 오른쪽 겹 선택자(결합자 밖) */
function lastCompound(s: string): string {
  let d = 0;
  let cur = '';
  let gap = false;
  for (const ch of s) {
    if (d === 0 && /[\s>+~]/.test(ch)) {
      gap = true;
      continue;
    }
    if (gap) {
      cur = '';
      gap = false;
    }
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') d--;
    cur += ch;
  }
  return cur;
}
const FN = /:(not|is|has|where)\(((?:[^()]|\([^()]*\))*)\)/g;
/** 특정도(a·b·c를 한 수로 — :not·:is·:has는 안의 가장 큰 것, :where는 0) */
function spec(sel: string): number {
  let extra = 0;
  const rest = sel.replace(FN, (_m, fn: string, inner: string) => {
    if (fn !== 'where') extra += Math.max(0, ...splitTop(inner).map(spec));
    return '';
  });
  const a = (rest.match(/#[\w-]+/g) ?? []).length;
  const b = (rest.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+(?:\([^)]*\))?/g) ?? []).length;
  const c = (rest.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return a * 10000 + b * 100 + c + extra;
}
/** 빨리 거르는 열쇠: 맨 오른쪽 겹 선택자의 태그·class·id */
function keyOf(sel: string): { tag: string | null; cls: string[]; id: string | null } {
  const c = lastCompound(sel).replace(FN, '').replace(/\[[^\]]*\]/g, '').replace(/::?[\w-]+(?:\([^)]*\))?/g, '');
  return { tag: /^[a-z][\w-]*/i.exec(c)?.[0]?.toLowerCase() ?? null, cls: [...c.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!), id: /#([\w-]+)/.exec(c)?.[1] ?? null };
}

interface Rule {
  readonly media: string | null;
  readonly sel: string;
  readonly spec: number;
  readonly order: number;
  readonly key: ReturnType<typeof keyOf>;
  readonly decls: readonly (readonly [string, string, boolean])[];
}
let ORDER = 0;
function rulesOf(text: string, file: string): Rule[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let blocks = 0;
  const add = (m: string | null, sels: string, body: string): void => {
    const decls = body
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d.includes(':'))
      .map((d): [string, string, boolean] => {
        const i = d.indexOf(':');
        const v = d.slice(i + 1).trim();
        return [d.slice(0, i).trim().toLowerCase(), v.replace(/\s*!important$/, ''), /!important$/.test(v)];
      });
    for (const s of splitTop(sels)) {
      // 덧붙은 그림 칸(::before·::after)은 누름 자리를 넓히지 않는 한 셈 밖 — 222차에 넓힌 칸 없음
      if (/::?(?:before|after)\b/.test(s)) continue;
      // 숨김 상태는 셈 밖(보일 때의 크기): :not([hidden])은 맞는 것으로, [hidden] 규칙은 뺀다. 특정도는 원래 선택자로
      const sel = s.replace(/:not\(\[hidden\]\)/g, '');
      if (sel.includes('[hidden]')) continue;
      out.push({ media: m, sel, spec: spec(s), order: ORDER++, key: keyOf(sel), decls });
    }
  };
  for (const m of css.matchAll(/@([\w-]+)([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}|([^{}@]+)\{([^{}]*)\}/g)) {
    if (m[1] !== undefined) {
      if (m[1] !== 'media') throw new Error(`${file}: 모르는 @규칙 @${m[1]}`);
      blocks++;
      for (const r of m[3]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) add(m[2]!.trim(), r[1]!, r[2]!);
    } else add(null, m[4]!, m[5]!);
  }
  // @media 덩어리를 모두 읽었는지(겹친 덩어리를 못 읽으면 안 규칙이 맨 바깥으로 새어 셈이 틀린다)
  if (blocks !== (css.match(/@media/g) ?? []).length) throw new Error(`${file}: @media 덩어리를 다 읽지 못함`);
  return out;
}
const ROOT = resolve(__dirname, '../..');
// main.ts가 vlist.css → styles.css 차례로 가져오고, shortcuts.css는 창 조각과 함께 뒤에 붙는다
const RULES: readonly Rule[] = ['src/view/vlist.css', 'src/app/styles.css', 'src/app/shortcuts.css'].flatMap((p) => rulesOf(readFileSync(join(ROOT, p), 'utf8'), p));
const threw = new Set<string>();
const hit = (el: Element, sel: string): boolean => {
  if (threw.has(sel)) return false;
  try {
    return el.matches(sel);
  } catch {
    threw.add(sel);
    return false;
  }
};

// ───────────────────────── 크기 어림 ─────────────────────────

interface Sides {
  t: number;
  r: number;
  b: number;
  l: number;
}
interface Style {
  readonly p: ReadonlyMap<string, string>;
  readonly fs: number;
  readonly lh: { readonly n?: number; readonly px?: number };
  readonly vars: ReadonlyMap<string, string>;
  readonly display: string;
  readonly pad: Sides;
  readonly bd: Sides;
}
const ROOT_STYLE: Style = { p: new Map(), fs: 16, lh: { n: 1.2 }, vars: new Map(), display: 'block', pad: { t: 0, r: 0, b: 0, l: 0 }, bd: { t: 0, r: 0, b: 0, l: 0 } };
const UA_DISPLAY: Record<string, string> = {
  button: 'inline-block',
  input: 'inline-block',
  select: 'inline-block',
  textarea: 'inline-block',
  a: 'inline',
  span: 'inline',
  b: 'inline',
  i: 'inline',
  kbd: 'inline',
  label: 'inline',
  svg: 'inline',
  canvas: 'inline',
  strong: 'inline',
  em: 'inline',
  code: 'inline',
  tr: 'table-row',
  td: 'table-cell',
  th: 'table-cell',
  table: 'table',
  thead: 'table-header-group',
  tbody: 'table-row-group',
  li: 'list-item',
  script: 'none',
  style: 'none',
  template: 'none',
};
/** 길이(px·em, 0) — %·auto·calc·env는 null */
const lenOf = (v: string | undefined, fs: number): number | null => {
  if (v === undefined) return null;
  if (v === '0') return 0;
  const m = /^(-?[\d.]+)(px|em)$/.exec(v.trim());
  return m ? (m[2] === 'em' ? +m[1]! * fs : +m[1]!) : null;
};
const four = (v: string, fs: number): [number, number, number, number] => {
  const t = v.split(/\s+/).map((x) => lenOf(x, fs) ?? 0);
  return [t[0] ?? 0, t[1] ?? t[0] ?? 0, t[2] ?? t[0] ?? 0, t[3] ?? t[1] ?? t[0] ?? 0];
};
const borderW = (v: string, fs: number): number => {
  if (/^(none|0)$/.test(v.trim())) return 0;
  for (const t of v.split(/\s+/)) {
    const n = lenOf(t, fs);
    if (n !== null) return n;
    if (t === 'thin') return 1;
    if (t === 'medium') return 3;
    if (t === 'thick') return 5;
  }
  return 3;
};
const SIDE = { top: 't', right: 'r', bottom: 'b', left: 'l' } as const;

function styleOf(el: Element, f: Form, memo: Map<Element, Style>, active: readonly Rule[]): Style {
  const got = memo.get(el);
  if (got) return got;
  const up = el.parentElement ? styleOf(el.parentElement, f, memo, active) : ROOT_STYLE;
  const decl: { w: number; p: string; v: string }[] = [];
  for (const r of active) {
    const k = r.key;
    if ((k.tag && k.tag !== '*' && k.tag !== el.localName) || (k.id && el.id !== k.id) || !k.cls.every((c) => el.classList.contains(c))) continue;
    if (!hit(el, r.sel)) continue;
    for (const [p, v, imp] of r.decls) decl.push({ w: (imp ? 2e9 : 0) + r.spec * 1e4 + r.order, p, v });
  }
  const inline = el.getAttribute('style');
  if (inline)
    for (const d of inline.split(';')) {
      const i = d.indexOf(':');
      if (i <= 0) continue;
      const v = d.slice(i + 1).trim();
      decl.push({ w: /!important$/.test(v) ? 3e9 : 1e9, p: d.slice(0, i).trim().toLowerCase(), v: v.replace(/\s*!important$/, '') });
    }
  decl.sort((a, b) => a.w - b.w);
  const vars = new Map(up.vars);
  for (const d of decl) if (d.p.startsWith('--')) vars.set(d.p, d.v);
  const sub = (v: string): string => {
    for (let k = 0; k < 5 && v.includes('var('); k++) v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_m, n: string, fb?: string) => vars.get(n) ?? fb ?? '');
    return v;
  };
  const p = new Map<string, string>();
  let fs = up.fs;
  let lh = up.lh;
  // 브라우저 기본 여백·테두리(버튼 1px 6px·2px, 입력 칸 2px, 고르기 1px)
  const tag = el.localName;
  const pad: Sides = tag === 'button' ? { t: 1, r: 6, b: 1, l: 6 } : tag === 'input' ? { t: 1, r: 2, b: 1, l: 2 } : { t: 0, r: 0, b: 0, l: 0 };
  const bw = tag === 'button' || tag === 'input' ? 2 : tag === 'select' ? 1 : 0;
  const bd: Sides = { t: bw, r: bw, b: bw, l: bw };
  for (const d of decl) {
    if (d.p.startsWith('--')) continue;
    const v = sub(d.v);
    p.set(d.p, v);
    if (d.p === 'font') {
      if (v === 'inherit') {
        fs = up.fs;
        lh = up.lh;
      } else {
        const m = /([\d.]+)(px|em)(?:\s*\/\s*([\d.]+)(px)?)?/.exec(v);
        if (m) {
          fs = m[2] === 'em' ? +m[1]! * up.fs : +m[1]!;
          lh = m[3] ? (m[4] ? { px: +m[3] } : { n: +m[3] }) : { n: 1.2 };
        }
      }
    } else if (d.p === 'font-size') fs = v === 'inherit' ? up.fs : v.endsWith('em') ? parseFloat(v) * up.fs : parseFloat(v) || fs;
    else if (d.p === 'line-height') lh = v === 'inherit' ? up.lh : v === 'normal' ? { n: 1.2 } : v.endsWith('px') ? { px: parseFloat(v) } : { n: parseFloat(v) };
    else if (d.p === 'padding') [pad.t, pad.r, pad.b, pad.l] = four(v, fs);
    else if (/^padding-(top|right|bottom|left)$/.test(d.p)) pad[SIDE[d.p.slice(8) as keyof typeof SIDE]] = lenOf(v, fs) ?? 0;
    else if (d.p === 'border') bd.t = bd.r = bd.b = bd.l = borderW(v, fs);
    else if (d.p === 'border-width') [bd.t, bd.r, bd.b, bd.l] = four(v, fs);
    else if (/^border-(top|right|bottom|left)(-width)?$/.test(d.p)) bd[SIDE[d.p.split('-')[1] as keyof typeof SIDE]] = borderW(v, fs);
  }
  let display = p.get('display') ?? UA_DISPLAY[tag] ?? 'block';
  // flex·grid 칸의 아이는 블록이 된다
  if (/^(inline-)?(flex|grid)$/.test(up.display)) display = display.replace(/^inline-(flex|grid|table)$/, '$1').replace(/^inline(-block)?$/, 'block');
  const s: Style = { p, fs, lh, vars, display, pad, bd };
  memo.set(el, s);
  return s;
}

interface Box {
  readonly w: number;
  readonly h: number;
}
interface Ctx {
  readonly f: Form;
  readonly memo: Map<Element, Style>;
  readonly active: readonly Rule[];
}
const st = (el: Element, c: Ctx): Style => styleOf(el, c.f, c.memo, c.active);
const shown = (el: Element, c: Ctx): boolean => {
  for (let n: Element | null = el; n; n = n.parentElement) if (st(n, c).display === 'none') return false;
  return true;
};
/** 글 폭 어림: 한글·한자 1em, 빈칸 0.3em, 그 밖 0.55em */
const textW = (t: string, fs: number): number => [...t].reduce((a, ch) => a + fs * (/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.55), 0);
const grow = (s: Style): number => {
  const g = s.p.get('flex-grow');
  if (g) return +g;
  const fl = s.p.get('flex');
  if (!fl || fl === 'none') return 0;
  return fl === 'auto' ? 1 : parseFloat(fl) || 0;
};
const set = (v?: string): boolean => v !== undefined && v !== 'auto';
/** 폭이 둘레를 채우는가(채우면 24를 넘는다고 본다 — 둘레 칸은 모두 24보다 넓다) */
function fills(el: Element, s: Style, c: Ctx): boolean {
  if (/%$/.test(s.p.get('width') ?? '')) return true;
  const pos = s.p.get('position');
  if (pos === 'absolute' || pos === 'fixed') return (set(s.p.get('left')) && set(s.p.get('right'))) || s.p.has('inset');
  const up = el.parentElement ? st(el.parentElement, c) : ROOT_STYLE;
  if (/flex/.test(up.display)) {
    if ((up.p.get('flex-direction') ?? 'row').startsWith('column')) return ['normal', 'stretch'].includes(s.p.get('align-self') ?? up.p.get('align-items') ?? 'normal');
    return grow(s) > 0;
  }
  if (/grid/.test(up.display)) return true;
  return /^(block|flex|grid|list-item|table|table-row|table-cell|-webkit-box)$/.test(s.display);
}
function contentW(el: Element, s: Style, c: Ctx): number {
  let sum = 0;
  let n = 0;
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      const t = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (t) {
        sum += textW(t, s.fs);
        n++;
      }
    } else if (node.nodeType === 1) {
      const k = node as Element;
      const ks = st(k, c);
      if (ks.display === 'none') continue;
      const b = boxOf(k, c, false);
      // 채우는 아이(고르기 안 option 등)는 제 글 폭으로
      sum += Number.isFinite(b.w) ? b.w : contentW(k, ks, c) + ks.pad.l + ks.pad.r + ks.bd.l + ks.bd.r;
      n++;
    }
  }
  if (/flex|grid/.test(s.display) && n > 1) sum += (lenOf(s.p.get('column-gap') ?? s.p.get('gap')?.split(/\s+/).pop(), s.fs) ?? 0) * (n - 1);
  return sum;
}
function boxOf(el: Element, c: Ctx, stretch = true): Box {
  const s = st(el, c);
  if (el.localName === 'svg') return { w: lenOf(s.p.get('width'), s.fs) ?? +(el.getAttribute('width') ?? 0), h: lenOf(s.p.get('height'), s.fs) ?? +(el.getAttribute('height') ?? 0) };
  // 브라우저가 그리는 칸(막대·체크 상자 — Chrome 기본 크기)
  const type = el.localName === 'input' ? (el.getAttribute('type') ?? 'text') : '';
  const ua = type === 'range' ? { w: 129, h: 16 } : type === 'checkbox' || type === 'radio' ? { w: 13, h: 13 } : null;
  const lhPx = s.lh.px ?? (s.lh.n ?? 1.2) * s.fs;
  const kids = [...el.children].filter((k) => st(k, c).display !== 'none');
  const text = [...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ''));
  const pos = s.p.get('position');
  let h = lenOf(s.p.get('height'), s.fs) ?? ua?.h ?? null;
  if (h === null) {
    if ((pos === 'absolute' || pos === 'fixed') && ((set(s.p.get('top')) && set(s.p.get('bottom'))) || s.p.has('inset'))) h = Infinity;
    else if (s.display === 'inline') h = s.fs * 1.2 + s.pad.t + s.pad.b + s.bd.t + s.bd.b;
    else if (s.display === 'table-row') h = Math.max(0, ...kids.map((k) => boxOf(k, c, false).h));
    else {
      const flexish = /flex|grid/.test(s.display);
      const inlineKids = kids.some((k) => /^inline/.test(st(k, c).display));
      const line = text || (!flexish && inlineKids) ? lhPx : 0;
      h = Math.max(line, ...kids.map((k) => boxOf(k, c, false).h)) + s.pad.t + s.pad.b + s.bd.t + s.bd.b;
      // flex 줄의 아이는 줄 높이까지 늘어난다(align-items 기본·stretch)
      const parent = el.parentElement;
      if (stretch && parent) {
        const ps = st(parent, c);
        if (/flex/.test(ps.display) && (ps.p.get('flex-direction') ?? 'row').startsWith('row') && ['normal', 'stretch'].includes(s.p.get('align-self') ?? ps.p.get('align-items') ?? 'normal'))
          h = Math.max(h, ...[...parent.children].filter((x) => x !== el && st(x, c).display !== 'none').map((x) => boxOf(x, c, false).h));
      }
    }
  }
  h = Math.max(h, lenOf(s.p.get('min-height'), s.fs) ?? 0);
  let w = lenOf(s.p.get('width'), s.fs);
  if (w === null) w = fills(el, s, c) ? Infinity : (ua?.w ?? contentW(el, s, c) + s.pad.l + s.pad.r + s.bd.l + s.bd.r);
  w = Math.max(w, lenOf(s.p.get('min-width'), s.fs) ?? 0);
  return { w, h };
}

// ───────────────────────── 누를 마디 모으기 ─────────────────────────

const SEMANTIC =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], [tabindex]:not([tabindex="-1"])';
const POINTER = new Set(['click', 'dblclick', 'pointerdown', 'mousedown', 'touchstart']);
const CURSOR = /^(pointer|grab|grabbing|col-resize|row-resize)$/;
/** click·pointerdown을 듣는 칸(앱이 붙인 것 — 아래 beforeEach가 addEventListener를 엿본다) */
const heard = new Set<Element>();
function targets(c: Ctx): Element[] {
  const out = new Set<Element>(document.querySelectorAll(SEMANTIC));
  for (const l of document.querySelectorAll('label')) if (l.querySelector('input, select, textarea')) out.add(l);
  for (const el of heard) if (el.isConnected) out.add(el);
  for (const r of c.active)
    if (r.decls.some(([p, v]) => p === 'cursor' && CURSOR.test(v)))
      try {
        for (const el of document.querySelectorAll(r.sel)) out.add(el);
      } catch {
        threw.add(r.sel);
      }
  return [...out];
}
const entryOf = (el: Element): Entry | undefined => TABLE.find((e) => hit(el, e.sel));
const desc = (el: Element): string =>
  `${el.localName}${[...el.classList].map((k) => `.${k}`).join('')}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.getAttribute('type') ? `[type=${el.getAttribute('type')}]` : ''} (안: ${el.parentElement?.className || el.parentElement?.localName || '-'})`;
const fmt = (b: Box): string => [b.w, b.h].map((v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '채움')).join('×');

// ───────────────────────── 걸음 ─────────────────────────

const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
/** DOM이 40ms 잇달아 조용할 때까지(마감 4초 — ci-guard 13번: 횟수가 아니라 시간과 조건) */
const quiet = (): Promise<void> =>
  new Promise((done) => {
    let t: ReturnType<typeof setTimeout>;
    const fin = (): void => {
      clearTimeout(t);
      clearTimeout(cap);
      mo.disconnect();
      done();
    };
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(fin, 40);
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    t = setTimeout(fin, 40);
    const cap = setTimeout(fin, 4000);
  });
const enc = new TextEncoder();

interface Report {
  readonly problems: Set<string>;
  readonly seen: Set<Entry>;
  readonly under: Set<Entry>;
  nodes: number;
  steps: number;
}

/** 그 꼴의 화면을 만들어 걸으며 누를 마디를 모아 표·크기와 맞대 본다 */
async function tour(f: Form): Promise<Report> {
  vi.stubGlobal('matchMedia', (q: string) => {
    let matches = false;
    try {
      matches = media(q, f);
    } catch {
      /* 앱이 모르는 질의를 물으면 거짓 */
    }
    return { media: q, matches, addEventListener: () => {}, removeEventListener: () => {} };
  });
  vi.stubGlobal('innerWidth', f.w);
  vi.stubGlobal('innerHeight', f.h);
  history.replaceState(null, '', '/opencad-nc/');
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const backend = memoryBackend();
  backend.entries.set('a', { entry: { id: 'a', name: 'part.nc', size: 2048, time: Date.now() - 3_600_000, files: 2 }, data: enc.encode(SIE).buffer as ArrayBuffer });
  const app = new NcViewerApp(root, { recent: new RecentStore(backend) });
  dispose = await installLocalization(root);
  const api = window.opencadApp!;
  const active = RULES.filter((r) => r.media === null || media(r.media, f));
  const rep: Report = { problems: new Set(), seen: new Set(), under: new Set(), nodes: 0, steps: 0 };
  const look = async (step: string, sink = rep.problems, record = true): Promise<void> => {
    await quiet();
    const c: Ctx = { f, memo: new Map(), active };
    const list = targets(c);
    if (record) {
      rep.nodes += list.length;
      rep.steps++;
    }
    for (const el of list) {
      const e = entryOf(el);
      if (!e) {
        sink.add(`${f.name} · ${step} · 표에 없음 · ${desc(el)}`);
        continue;
      }
      if (record) rep.seen.add(e);
      const v = f === WIDE ? e.wide : e.phone;
      if (v === '대상 아님' || v === '큼' || !shown(el, c)) continue;
      const b = boxOf(el, c);
      const small = Math.min(b.w, b.h) < 24;
      if (small && record) rep.under.add(e);
      if (v === '24 넘음' && small) sink.add(`${f.name} · ${step} · #${e.n} ${e.name} · 24 미만 ${fmt(b)} · ${desc(el)}`);
      if (SMALL.includes(v) && !small) sink.add(`${f.name} · ${step} · #${e.n} ${e.name} · 「${v}」로 둔 칸이 ${fmt(b)} — 표를 「24 넘음」으로 · ${desc(el)}`);
    }
  };
  await app.renderRecent();
  await look('처음 화면');
  // 키보드 단축키 창(? 키 — 문서 없이도). 열린 동안 다른 칸은 inert라 Esc로 닫고 다음 걸음
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
  await until(() => !!document.querySelector('[role="dialog"][aria-modal="true"]'));
  await look('키보드 단축키 창');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await until(() => !document.querySelector('[role="dialog"][aria-modal="true"]'));
  // 알림 상자(동작 버튼 「다시 시도」·닫기 ✕)
  toast('조각을 불러오지 못했습니다.', 'error', 4000, { label: '다시 시도', run: () => {} });
  await look('알림 상자');
  document.querySelector<HTMLButtonElement>('.toast-x')?.click();
  const programs: [string, string, string[]][] = [
    ['opencad-sample.nc', ncSampleProgram(), ['code', 'tools', 'info', 'sim']],
    ['part.MPF', SIE, ['info']],
    ['panel.mpr', MPR, ['ops', 'vars', 'sim']],
  ];
  for (const [name, text, tabs] of programs) {
    expect(await app.openBuffer(name, enc.encode(text).buffer as ArrayBuffer), name).toBe(true);
    await look(`${name} 열기`);
    api.togglePanel(true);
    for (const tab of tabs) {
      api.setPanelTab(tab);
      await until(() => root.querySelector(`.panel-tab[data-tab="${tab}"]`)?.getAttribute('aria-selected') === 'true');
      if (tab === 'sim') await until(() => !!root.querySelector('.panel-body table.sim-tools'));
      await look(`${name} ${tab} 탭`);
    }
    api.togglePanel(false);
    await look(`${name} 패널 닫음`);
  }
  // 스스로 확인: 표에 없는 새 버튼은 「표에 없음」, 24 넘음 꼴(.btn.small)에 높이 20을 주면 「24 미만」으로 잡혀야 한다
  const fresh = document.createElement('button');
  fresh.type = 'button';
  fresh.className = 'r222-new';
  fresh.textContent = '새 칸';
  const tiny = document.createElement('button');
  tiny.type = 'button';
  tiny.className = 'btn small';
  tiny.setAttribute('style', 'height: 20px');
  tiny.textContent = '작게';
  document.body.append(fresh, tiny);
  const self = new Set<string>();
  await look('스스로 확인', self, false);
  fresh.remove();
  tiny.remove();
  expect([...self].filter((m) => m.includes('표에 없음') && m.includes('r222-new'))).toHaveLength(1);
  expect([...self].filter((m) => m.includes('24 미만') && m.includes('×20 ') && m.includes('button.btn.small'))).toHaveLength(1);
  return rep;
}

let dispose: (() => void) | undefined;
const realAdd = EventTarget.prototype.addEventListener;
beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(깎기·정보 탭·3D 보기 위 UI·측정 도구·단축키 창)을 미리 받아 둔다(ci-guard 5번 — 모두 맨 위 곁효과 없음, 단축키 창은 스타일 가져오기뿐)
  await import('../../src/app/sim');
  await import('../../src/app/viewer-ui');
  await loadPanelInfo();
  await import('../../src/app/measure-tools');
  await import('../../src/app/shortcuts');
});
beforeEach(() => {
  heard.clear();
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (POINTER.has(type) && this instanceof Element) heard.add(this);
    realAdd.call(this, type, listener, options);
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('Worker', FakeWorker);
  localStorage.clear();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  EventTarget.prototype.addEventListener = realAdd;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/opencad-nc/');
});

describe('222차 포인터 대상 크기(WCAG 2.5.8) 감사 표', () => {
  it('CSS 규칙 읽기: 셈이 기대는 규칙은 모두 읽혔다(jsdom이 못 읽는 선택자는 크기 속성이 없는 것뿐), 표의 꼴은 겹치지 않는 번호', () => {
    expect(RULES.length).toBeGreaterThan(250);
    // 걸음을 돈 뒤에도 같은지는 아래 두 시험 끝에서 다시 본다
    const box = /^(display|(min-)?(width|height)|padding(-\w+)?|border(-(top|right|bottom|left))?(-width)?|font(-size)?|line-height)$/;
    for (const r of RULES) hit(document.documentElement, r.sel);
    expect(RULES.filter((r) => threw.has(r.sel) && r.decls.some(([p]) => box.test(p))).map((r) => r.sel)).toEqual([]);
    expect(new Set(TABLE.map((e) => e.n)).size).toBe(TABLE.length);
  });

  for (const f of [WIDE, PHONE]) {
    it(`${f.name}: 그린 화면의 누를 마디는 모두 표에 들고, 「24 넘음」은 셈이 24×24 이상·예외로 둔 꼴은 24 미만`, async () => {
      const rep = await tour(f);
      const unseen = TABLE.filter((e) => !rep.seen.has(e)).map((e) => `#${e.n}`);
      console.info(
        `222차 ${f.name}: 걸음 ${rep.steps} · 누를 마디 ${rep.nodes}개 · 표 ${rep.seen.size}/${TABLE.length}꼴 · 24 미만 ${[...rep.under].map((e) => `#${e.n}`).join('·') || '없음'} · 못 본 꼴 ${unseen.join('·') || '없음'}`,
      );
      expect([...rep.problems]).toEqual([]);
      expect(rep.seen.size).toBeGreaterThanOrEqual(25);
      const box = /^(display|(min-)?(width|height)|padding(-\w+)?|border(-(top|right|bottom|left))?(-width)?|font(-size)?|line-height)$/;
      expect(RULES.filter((r) => threw.has(r.sel) && r.decls.some(([p]) => box.test(p))).map((r) => r.sel)).toEqual([]);
    });
  }
});
