// @vitest-environment jsdom
/**
 * 228차(WCAG 2.5.3 이름 안의 보이는 글 — Label in Name): 글이 보이는 누를 칸의 접근 이름(aria-label·aria-labelledby·title이 이름이 되는 경우)이 보이는 글을 담는지
 * 다섯 언어 화면에서 본다(.runtime/r228/progress.md 표와 같은 번호). 말로 조작하는 사용자가 화면에 보이는 낱말로 그 칸을 부를 수 있어야 한다.
 * - 감사(.runtime/r228 — 222차 걸음 넓은 화면 17·휴대폰 6 × 다섯 언어)로 정한 표의 꼴마다 그 꼴이 보이는 상태 셋만 센다(리드 요청 — CI 시간: 처음 실행 21초):
 *   ① 처음 화면 + 단축키 창(#1·#3·#4), ② 예제 프로그램 코드 탭(#2·#4·#6), ③ 같은 문서 깎기 탭(#7·#8·#9). 앱은 한 번 붙이고 상태마다 언어 메뉴로 ko·en·ja·zh-CN·de를 돌며
 *   (다음 상태는 거꾸로 — 앱이 패널·띠를 다시 그리고 번역층이 글·속성을 다시 옮김) 같은 DOM을 넓은 화면(1280×800 마우스)·휴대폰(390×844 손가락) CSS 두 꼴로 센다
 *   (휴대폰 꼴은 CSS로 글이 숨는 칸 — 도구·제목 막대 글, 시작 화면 마우스·손가락 글 — 만 갈림).
 * - 셈 대상: 누를 칸(222차 SEMANTIC) 가운데 보이는 글(CSS로 숨은 마디·그림 빼고 aria-hidden 글은 넣음 — 입력 칸은 감싼 라벨·설정 줄 이름·열 머리·자리 글)이 있고
 *   이름이 그 글 그대로가 아닌 칸(aria-label·aria-labelledby·title, 또는 aria-hidden 글이 빠진 글 이름). 그린 칸은 모두 표(TABLE)의 한 꼴에 들어야 한다.
 * - 새 칸 막기는 소스 글로: src의 이름 다는 자리(aria-label·aria-labelledby 줄)는 모두 SITES 표(DOM 표 꼴 번호 또는 셈 밖 까닭)에 들어야 한다 — 새 자리면 판정과 함께 표에.
 * - 담는가: 대소문자·문장부호·기호를 빼고 빈칸을 모은 글(한자·가나·한글 옆 빈칸은 뺌)로 견준다. 184차 꼴 — 한 글자 낱말(R)로 끝나면 이름에서 뒤가 글자로 이어지지 않아야,
 *   한 줄 이름이 여러 칸을 부르면 칸 몫 조각(「 · 」·「・」·「 — 」·「 – 」로 가름, 끝 단위 괄호 뺀 낱말도) 하나. 다른 언어에서 한글이 남으면 어긋남.
 * - jsdom은 CSS를 그리지 않아 숨김(display: none)은 vlist·styles·shortcuts.css 규칙을 읽어 그 꼴의 @media만 켜고 특정도·차례로 겹쳐 셈한다(222차 꼴을 display 하나로 줄임).
 * 고친 것: 시작 화면 열기 칸 — 이름(「NC 파일 열기 — 눌러서 고르거나 끌어다 놓기」)이 보이는 제목을 다섯 언어 모두 품지 않았다 → 보이는 제목 둘을 감싼 칸을 aria-labelledby로.
 * 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView), 깎기 워커는 같은 실행기를 같은 스레드에서(222차 꼴).
 */
import { readdirSync, readFileSync } from 'node:fs';
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

import { catalogs, translate } from '../../site/i18n.mjs';
import { NcViewerApp } from '../../src/app/app';
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

// 처음 화면 최근 문서(Siemens 짧은 프로그램 — 여는 것은 아니고 목록 줄만)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');

const LANGS = ['ko', 'en', 'ja', 'zh-CN', 'de'] as const;

// ───────────────────────── 감사 표 ─────────────────────────

/** 담음 = 이름이 보이는 글을 담음(지킴) · 고침 = 228차에 고쳐 담음(지킴) · 셈 밖 = 보이는 글이 이름표가 아닌 칸(까닭) */
type How = '담음' | '고침' | '셈 밖';
/** whole = 보이는 글 통째 · front = 앞 조각(자리 글의 「찾기 — 보기…」) · piece = 칸 몫 조각 하나(끝 단위 괄호 뺀 낱말도) */
type Part = 'whole' | 'front' | 'piece';
interface Entry {
  readonly n: number;
  readonly sel: string;
  readonly what: string;
  readonly how: How;
  readonly part?: Part;
  /** 보이는 글을 정하는 칸(기본: 그 칸의 글 — 입력 칸은 감싼 라벨·줄 이름·열 머리·자리 글) */
  readonly label?: (el: Element, c: Ctx) => string;
}
/** 위에서 처음 맞는 꼴이 그 마디의 꼴(progress.md 표 번호 그대로) */
const TABLE: readonly Entry[] = [
  { n: 1, sel: '.sc-body', what: '단축키 창 본문(굴림 영역 — 이름은 보이는 창 제목을 aria-labelledby로, 본문 글은 이름표가 아님)', how: '셈 밖' },
  { n: 2, sel: '.vlist', what: '코드 목록 상자(보이는 글은 프로그램 줄 — 파일 글, 이름표가 아님)', how: '셈 밖' },
  {
    n: 3,
    sel: '.dropzone',
    what: '시작 화면 열기 칸(보이는 제목 — 마우스·손가락 가운데 보이는 하나)',
    how: '고침',
    part: 'whole',
    label: (el, c) => {
      const t = [...el.querySelectorAll('.dz-title')].find((p) => shown(p, c));
      return t ? textOf(t, c, false) : '';
    },
  },
  { n: 4, sel: '.tbtn', what: '제목·도구 막대 버튼·링크(그림 + 글 — 설정 ⊂ 앱 설정·원근 ⊂ 원근 투영(…)·멈춤 ⊂ 재생 멈춤)', how: '담음', part: 'whole' },
  { n: 5, sel: '.sim-steps .mb-btn', what: '가공 하나씩 따라가기 단추(깎기 탭 「끝까지」 ⊂ 「모든 가공 깎기(끝까지)」)', how: '담음', part: 'whole' },
  { n: 6, sel: '.code-search input', what: '코드 찾기 칸(자리 글 앞 조각 「찾기」 ⊂ 「코드에서 찾기」)', how: '담음', part: 'front' },
  { n: 7, sel: 'label.prop-row select, label.prop-row input', what: '설정 줄 고르기·숫자 칸(감싼 라벨 글)', how: '담음', part: 'whole' },
  { n: 8, sel: '.prop-row .xyz-input input, .prop-row .sim-pair input, .prop-row .sim-pair select', what: '설정 줄의 여러 칸(줄 이름의 칸 몫 조각 — 축·최소·최대·노즈 R·방향)', how: '담음', part: 'piece' },
  { n: 9, sel: 'table.sim-tools select, table.sim-tools input', what: '깎기 공구 표 칸(열 머리 — 종류·지름·모서리 R·끝 각)', how: '담음', part: 'piece' },
];

/**
 * 소스 글의 이름 다는 자리(주석 밖 줄 — aria-label·aria-labelledby 속성 글·setAttribute('aria-label')): [파일, 줄 조각, 줄 수, 판정].
 * 판정은 DOM 표 꼴 번호(#n — 보이는 글이 있는 칸) 또는 셈 밖 까닭(그림·기호만·누를 칸 아님·보이는 이름표 없음·번역층·읽기). 새 자리가 생기면 판정과 함께 여기에(보이는 글이 있으면 DOM 표에도)
 */
const SITES: readonly (readonly [string, string, number, string])[] = [
  ['src/app/i18n.ts', "for (const name of ['title','aria-label'", 1, '번역층 — 이름 속성을 옮기는 자리'],
  ['src/app/i18n.ts', "el.setAttribute('aria-label', label)", 1, '언어 버튼·목록 이름(그림만 — 셈 밖)'],
  ['src/app/i18n.ts', "attributeFilter:['title','aria-label'", 1, '번역층 감시'],
  ['src/app/dom.ts', "class: 'toast-x'", 1, '알림 닫기(기호 ×만)'],
  ['src/app/panel.ts', "class: 'panel-tabs', role: 'tablist'", 1, '탭 줄 무리(누를 칸 아님)'],
  ['src/app/panel.ts', "class: 'icon-btn'", 1, '패널 닫기(그림만)'],
  ['src/app/panel.ts', "'aria-label': '문서 패널'", 1, '영역(누를 칸 아님)'],
  ['src/app/panel.ts', "this.body.setAttribute('aria-labelledby'", 1, '탭 몸통(이름 = 보이는 탭 글)'],
  ['src/app/panel.ts', "getAttribute('aria-label') ?? el.closest('label')", 1, '읽기 — 초점 열쇠'],
  ['src/app/panel.ts', "'aria-label': '재생 속도'", 1, '재생 속도 고르기(보이는 이름표 없음 — 고른 값만)'],
  ['src/app/panel.ts', "'aria-label': '재생 위치'", 1, '재생 막대(보이는 글 없음)'],
  ['src/app/panel.ts', "title, 'aria-label': label, html: icon(ic)", 1, '재생 막대 한 이동·여기까지(그림만)'],
  ['src/app/panel.ts', "this.code.el.setAttribute('aria-label', '프로그램 코드')", 1, '#2'],
  ['src/app/panel.ts', "placeholder: '찾기 — T5", 1, '#6'],
  ['src/app/panel.ts', "title: label, 'aria-label': label, html: icon(ic)", 1, '찾기 ↑↓(그림만)'],
  ['src/app/app.ts', "title, 'aria-label': label, html:", 1, '#4'],
  ['src/app/app.ts', "'aria-label': 'OpenCAD 도구'", 1, '#4'],
  ['src/app/app.ts', "'aria-label': 'GitHub'", 1, '#4'],
  ['src/app/app.ts', "class: 'toolbar', role: 'toolbar'", 1, '도구 막대 무리(누를 칸 아님)'],
  ['src/app/app.ts', "'aria-label': '측정 끝내기'", 1, '측정 띠 ✕(그림만)'],
  ['src/app/app.ts', "class: 'measure-bar', role: 'group'", 1, '측정 띠 무리(누를 칸 아님)'],
  ['src/app/app.ts', "'aria-labelledby': 'dz-name'", 1, '#3'],
  ['src/app/app.ts', "'aria-label': '지원 형식'", 1, '형식 목록(누를 칸 아님)'],
  ['src/app/app.ts', "'aria-labelledby': 'recent-title'", 1, '최근 문서 영역(누를 칸 아님)'],
  ['src/app/app.ts', "class: 'recent-del'", 1, '최근 문서 지우기(그림만)'],
  ['src/app/app.ts', "'aria-label': '단면 위치'", 1, '단면 위치 막대(보이는 글 없음)'],
  ['src/app/app.ts', "'aria-label': '단면 보기'", 1, '단면 상자(대화 상자 — 누를 칸 아님)'],
  ['src/app/app.ts', "'aria-label': '자를 축'", 1, '단면 축 무리(누를 칸 아님 — 축 버튼은 글 이름)'],
  ['src/app/app.ts', "this.themeBtn.setAttribute('aria-label', '앱 설정')", 1, '#4'],
  ['src/app/app.ts', "this.projBtn.setAttribute('aria-label'", 1, '#4'],
  ['src/app/app.ts', "this.playBtn.setAttribute('aria-label'", 1, '#4'],
  ['src/app/app.ts', "class: 'mb-btn icon', type: 'button', title: label, 'aria-label': label", 1, '재생 띠 버튼(그림만)'],
  ['src/app/app.ts', "'aria-label': '재생 속도'", 1, '재생 띠 속도 고르기(보이는 이름표 없음)'],
  ['src/app/app.ts', "'aria-label': '재생 위치'", 1, '재생 띠 막대(보이는 글 없음)'],
  ['src/app/app.ts', "class: 'play-strip', role: 'group'", 1, '재생 띠 무리(누를 칸 아님)'],
  ['src/app/app.ts', "s.play.setAttribute('aria-label'", 1, '재생 띠 재생(그림만)'],
  ['src/app/panel-info.ts', "const eye = h('button'", 1, '공구 표 눈(그림만)'],
  ['src/app/panel-info.ts', "h('th', { 'aria-label': '보이기' }", 1, '표 머리(누를 칸 아님)'],
  ['src/app/panel-info.ts', "'aria-labelledby': 'panel-groups-title'", 1, '켜고 끄는 줄 무리(이름 = 보이는 묶음 제목)'],
  ['src/app/panel-info.ts', "'aria-label': '주 프로그램'", 1, '#7'],
  ['src/app/panel-info.ts', "'aria-label': 'G-code 형식'", 1, '#7'],
  ['src/app/panel-info.ts', "'aria-label': '기본 단위'", 1, '#7'],
  ['src/app/panel-info.ts', "class: 'num-input', 'aria-label': label, placeholder", 1, '#7'],
  ['src/app/panel-info.ts', "노즈 R(mm)`, placeholder: 'R'", 1, '#8'],
  ['src/app/panel-info.ts', '공구 방향`', 1, '#8'],
  ['src/app/panel-info.ts', "'aria-label': '선반 G 코드 체계'", 1, '#7'],
  ['src/app/notices.ts', "'aria-label': '이 안내 닫기'", 1, '판단 띠 ✕(그림만)'],
  ['src/app/measure-track.ts', "'aria-label': TRACK_LABEL", 1, '끌어온 점(배지 수 — 사전 it)'],
  ['src/app/measure-track.ts', "this.button.setAttribute('aria-label', (this.label = label))", 1, '끌어온 점(배지 수 — 사전 it)'],
  ['src/app/shortcuts.ts', "class: 'sc-body', role: 'region'", 1, '#1'],
  ['src/app/shortcuts.ts', "class: 'sc-box', role: 'dialog'", 1, '단축키 창 상자(대화 상자 — 이름 = 보이는 제목)'],
  ['src/app/sim.ts', "getAttribute('aria-label') ?? el.closest('label')", 1, '읽기 — 초점 열쇠'],
  ['src/app/sim.ts', "class: 'num-input', 'aria-label': label })", 1, '#8'],
  ['src/app/sim.ts', "'aria-label': '해상도(긴 변 칸)'", 1, '#7'],
  ['src/app/sim.ts', "'aria-label': '색'", 1, '#7'],
  ['src/app/sim.ts', "{ 'aria-label': mixText([{ file: named }", 1, '#9'],
  ['src/app/sim.ts', "'aria-label': label, html: `${icon(ic)}${text", 1, '#5'],
  ['src/app/sim.ts', "'aria-label': '깎은 가공 수'", 1, '따라가기 막대(보이는 글 없음)'],
  ['src/app/sim.ts', "'aria-label': '가공 하나씩 따라가기'", 1, '따라가기 무리(누를 칸 아님)'],
  ['src/app/measure-lock.ts', "class: 'mb-btn icon mb-lock'", 1, '방향 잠금(그림만)'],
];
const NAME_SITE = /'aria-label(?:ledby)?'|setAttribute\('aria-label/;
/** src/app·src/view·src/sim의 주석 밖 이름 다는 줄 */
function nameSites(): { file: string; line: string }[] {
  const out: { file: string; line: string }[] = [];
  for (const dir of ['src/app', 'src/view', 'src/sim'])
    for (const n of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.ts')))
      for (const line of readFileSync(join(ROOT, dir, n), 'utf8').split('\n'))
        if (!/^\s*(?:\/\/|\*|\/\*)/.test(line) && NAME_SITE.test(line)) out.push({ file: `${dir}/${n}`, line: line.trim() });
  return out;
}

// ───────────────────────── CSS 숨김 읽기(222차 꼴 — display 하나) ─────────────────────────

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
    const ok = p.split(/\s+and\s+/).every((cond) => {
      const m = /^\(\s*([a-z-]+)\s*:\s*([^)]*?)\s*\)$/.exec(cond.trim());
      if (!m) throw new Error(`모르는 @media 조건: ${cond}`);
      const k = m[1]!;
      const v = m[2]!;
      if (k === 'max-width') return f.w <= parseFloat(v);
      if (k === 'max-height') return f.h <= parseFloat(v);
      if (k === 'pointer') return (v === 'coarse') === f.coarse;
      if (k === 'display-mode' || k === 'prefers-color-scheme') return false;
      throw new Error(`모르는 @media 조건: ${cond}`);
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
  readonly decls: readonly (readonly [string, boolean])[];
}
let ORDER = 0;
/** display를 정하는 규칙만(덧붙은 그림 칸 ::before·::after 등은 글 마디가 아니라 뺀다) */
function rulesOf(text: string, file: string): Rule[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let blocks = 0;
  const add = (m: string | null, sels: string, body: string): void => {
    const decls = body
      .split(';')
      .map((d) => d.trim())
      .filter((d) => /^display\s*:/i.test(d))
      .map((d): [string, boolean] => {
        const v = d.slice(d.indexOf(':') + 1).trim();
        return [v.replace(/\s*!important$/, ''), /!important$/.test(v)];
      });
    if (!decls.length) return;
    for (const s of splitTop(sels)) if (!/::[\w-]+|:(?:before|after)\b/.test(s)) out.push({ media: m, sel: s, spec: spec(s), order: ORDER++, key: keyOf(s), decls });
  };
  for (const m of css.matchAll(/@([\w-]+)([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}|([^{}@]+)\{([^{}]*)\}/g)) {
    if (m[1] !== undefined) {
      if (m[1] !== 'media') throw new Error(`${file}: 모르는 @규칙 @${m[1]}`);
      blocks++;
      for (const r of m[3]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) add(m[2]!.trim(), r[1]!, r[2]!);
    } else add(null, m[4]!, m[5]!);
  }
  if (blocks !== (css.match(/@media/g) ?? []).length) throw new Error(`${file}: @media 덩어리를 다 읽지 못함`);
  return out;
}
const ROOT = resolve(__dirname, '../..');
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
interface Ctx {
  readonly memo: Map<Element, string>;
  readonly active: readonly Rule[];
}
/** 그 마디의 display(규칙·인라인 style을 겹친 값, 없으면 '') — [hidden]은 styles.css의 !important 규칙이 정한다 */
function displayOf(el: Element, c: Ctx): string {
  const got = c.memo.get(el);
  if (got !== undefined) return got;
  let best = -1;
  let v = '';
  for (const r of c.active) {
    const k = r.key;
    if ((k.tag && k.tag !== '*' && k.tag !== el.localName) || (k.id && el.id !== k.id) || !k.cls.every((x) => el.classList.contains(x))) continue;
    if (!hit(el, r.sel)) continue;
    for (const [val, imp] of r.decls) {
      const w = (imp ? 2e9 : 0) + r.spec * 1e4 + r.order;
      if (w > best) {
        best = w;
        v = val;
      }
    }
  }
  const inline = /(?:^|;)\s*display\s*:\s*([^;!]+?)\s*(!important)?\s*(?:;|$)/i.exec(el.getAttribute('style') ?? '');
  if (inline && (inline[2] ? 3e9 : 1e9) > best) v = inline[1]!;
  c.memo.set(el, v);
  return v;
}
function shown(el: Element, c: Ctx): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) if (displayOf(n, c) === 'none') return false;
  return true;
}

// ───────────────────────── 보이는 글·이름 ─────────────────────────

const CONTROL = /^(input|select|textarea)$/;
/** 보이는 글(aria=false) 또는 이름 계산의 글(aria=true — aria-hidden 마디를 뺌). CSS로 숨은 마디·그림은 뺀다, skip이면 컨트롤(입력 칸·고르기) 마디도 뺀다 */
function textOf(node: Node, c: Ctx, aria: boolean, skip = false): string {
  let s = '';
  for (const k of node.childNodes) {
    if (k.nodeType === 3) s += k.nodeValue ?? '';
    else if (k.nodeType === 1) {
      const e = k as Element;
      if (/^(svg|script|style|template)$/.test(e.localName) || displayOf(e, c) === 'none') continue;
      if (aria && e.getAttribute('aria-hidden') === 'true') continue;
      if (skip && CONTROL.test(e.localName)) continue;
      s += textOf(e, c, aria, skip);
    }
  }
  return s;
}
/** 입력 칸·고르기의 보이는 이름표: 감싼 label 글(컨트롤 뺌) → 설정 줄 이름(.k) → 표 칸의 열 머리 → 자리 글(값이 비었을 때). 고른 값·친 값은 이름표가 아님 */
function controlLabel(el: Element, c: Ctx): string {
  const lab = el.closest('label');
  if (lab) return textOf(lab, c, false, true);
  const k = el.closest('.prop-row')?.querySelector(':scope > .k');
  if (k) return textOf(k, c, false);
  const td = el.closest('td');
  if (td?.parentElement) {
    const th = td.closest('table')?.querySelector('thead tr')?.children[[...td.parentElement.children].indexOf(td)];
    if (th) return textOf(th, c, false);
  }
  const ph = el.getAttribute('placeholder');
  return ph && !(el as HTMLInputElement).value ? ph : '';
}
const visible = (el: Element, c: Ctx, e?: Entry): string => (e?.label ? e.label(el, c) : CONTROL.test(el.localName) ? controlLabel(el, c) : textOf(el, c, false));
interface Name {
  readonly src: 'labelledby' | 'aria-label' | 'label' | 'content' | 'title' | 'placeholder' | 'none';
  readonly text: string;
}
/** 접근 이름(이름 계산을 줄인 꼴): aria-labelledby(가리킨 마디의 보이는 글 — 그 안 숨은 마디는 뺌) → aria-label → 감싼 label·글 → title → placeholder */
function nameOf(el: Element, c: Ctx): Name {
  const ids = el.getAttribute('aria-labelledby')?.trim();
  if (ids)
    return {
      src: 'labelledby',
      text: ids
        .split(/\s+/)
        .map((id) => {
          const r = document.getElementById(id);
          return r ? textOf(r, c, true) : '';
        })
        .join(' '),
    };
  const al = el.getAttribute('aria-label')?.trim();
  if (al) return { src: 'aria-label', text: al };
  if (CONTROL.test(el.localName)) {
    const lab = el.closest('label');
    const t = lab ? textOf(lab, c, true, true) : '';
    if (norm(t)) return { src: 'label', text: t };
  } else {
    const t = textOf(el, c, true);
    if (norm(t)) return { src: 'content', text: t };
  }
  const title = el.getAttribute('title')?.trim();
  if (title) return { src: 'title', text: title };
  const ph = el.getAttribute('placeholder')?.trim();
  return ph ? { src: 'placeholder', text: ph } : { src: 'none', text: '' };
}

/** 견줄 글: 대소문자·문장부호·기호를 빼고(빈칸으로) 빈칸을 모으고, 한자·가나·한글 옆 빈칸은 뺀다 */
const norm = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ ?([\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]) ?/gu, '$1');
/** 이름이 보이는 글을 품는가(184차 holds 꼴 — 한 글자 낱말로 끝나면 이름에서 뒤가 글자로 이어지지 않아야: 「Corner R」은 「corner radius」를 품지 않음) */
function holds(name: string, vis: string): boolean {
  const n = norm(name);
  const v = norm(vis);
  if (!v) return false;
  const short = /(?:^|[^a-z])[a-z]$/.test(v);
  for (let i = n.indexOf(v); i >= 0; i = n.indexOf(v, i + 1)) if (!short || !/[\p{L}\p{N}]/u.test(n[i + v.length] ?? '')) return true;
  return false;
}
const pieces = (t: string): string[] => t.split(/\s+[·—–]\s+|\s*・\s*/).filter((p) => norm(p));
const word = (t: string): string => t.replace(/\s*[(（][^()（）]*[)）]\s*$/, '');
function contains(name: string, vis: string, part: Part): boolean {
  if (part === 'front') return holds(name, pieces(vis)[0] ?? vis);
  if (part === 'piece') return pieces(vis).some((p) => holds(name, p) || holds(name, word(p)));
  return holds(name, vis);
}

// ───────────────────────── 걸음 ─────────────────────────

const SEMANTIC =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], [tabindex]:not([tabindex="-1"])';
const entryOf = (el: Element): Entry | undefined => TABLE.find((e) => hit(el, e.sel));
const desc = (el: Element): string =>
  `${el.localName}${[...el.classList].map((k) => `.${k}`).join('')}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.getAttribute('type') ? `[type=${el.getAttribute('type')}]` : ''} (안: ${el.parentElement?.className || el.parentElement?.localName || '-'})`;
const clip = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
};

const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
/** DOM이 quietMs 잇달아 조용할 때까지(마감 4초 — ci-guard 13번: 횟수가 아니라 시간과 조건) */
const quiet = (quietMs = 40): Promise<void> =>
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
      t = setTimeout(fin, quietMs);
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    t = setTimeout(fin, quietMs);
    const cap = setTimeout(fin, 4000);
  });
const enc = new TextEncoder();

interface Report {
  readonly problems: Set<string>;
  /** CSS 꼴 이름마다 본 표 번호 */
  readonly seen: Map<string, Set<number>>;
  /** 넓은 화면 꼴의 언어별 짝(보이는 글 ⊂ 이름 — 셋까지, progress 표 근거) */
  readonly pairs: Map<number, Map<string, Set<string>>>;
  named: number;
  looks: number;
}

/** 지금 화면을 그 언어로 셈한다(모든 누를 칸 — 보이는 글이 있고 이름이 그 글 그대로가 아닌 칸) */
function scan(f: Form, lang: string, active: readonly Rule[], rep: Report, sink = rep.problems, record = true): void {
  const c: Ctx = { memo: new Map(), active };
  if (record) rep.looks++;
  for (const el of document.querySelectorAll(SEMANTIC)) {
    if (!shown(el, c)) continue;
    const e = entryOf(el);
    const vis = visible(el, c, e);
    if (!norm(vis)) continue;
    const nm = nameOf(el, c);
    if ((nm.src === 'content' || nm.src === 'label') && norm(nm.text) === norm(vis)) continue;
    if (record) rep.named++;
    if (!e) {
      sink.add(`${f.name} · ${lang} · 표에 없음 · 「${clip(vis)}」 / 「${clip(nm.text)}」(${nm.src}) · ${desc(el)}`);
      continue;
    }
    if (record) rep.seen.get(f.name)?.add(e.n);
    if (record && f === WIDE) {
      const by = rep.pairs.get(e.n) ?? new Map<string, Set<string>>();
      rep.pairs.set(e.n, by);
      const set = by.get(lang) ?? new Set<string>();
      by.set(lang, set);
      if (set.size < 3) set.add(`「${clip(vis)}」→「${clip(nm.text)}」`);
    }
    if (e.how === '셈 밖') continue;
    if (lang !== 'ko' && /[가-힣]/.test(vis + nm.text)) sink.add(`${f.name} · ${lang} · #${e.n} ${e.what} · 한국어 남음 · 「${clip(vis)}」 / 「${clip(nm.text)}」 · ${desc(el)}`);
    else if (!contains(nm.text, vis, e.part ?? 'whole')) sink.add(`${f.name} · ${lang} · #${e.n} ${e.what} · 담지 않음 · 「${clip(vis)}」 ⊄ 「${clip(nm.text)}」(${nm.src}) · ${desc(el)}`);
  }
  // 223차 패널 크기 손잡이: 보이는 글이 없어 셈 밖이지만 이름(title)이 그 언어로 옮겨지는지
  for (const g of document.querySelectorAll('.panel-grip')) {
    if (!shown(g, c)) continue;
    const t = g.getAttribute('title') ?? '';
    if (!t.trim() || (lang !== 'ko' && /[가-힣]/.test(t))) sink.add(`${f.name} · ${lang} · 패널 크기 손잡이 이름 「${t}」`);
  }
}

/**
 * 넓은 화면 앱 하나를 붙여 상태 셋(① 처음 화면 + 단축키 창 · ② 예제 코드 탭 · ③ 같은 문서 깎기 탭)마다 다섯 언어로 바꿔
 * 같은 DOM을 넓은 화면·휴대폰 CSS 두 꼴로 센다(휴대폰 꼴은 CSS로 글이 숨는 칸만 갈린다 — 앱을 꼴마다 새로 붙이지 않음)
 */
async function tour(): Promise<Report> {
  vi.stubGlobal('matchMedia', (q: string) => {
    let matches = false;
    try {
      matches = media(q, WIDE);
    } catch {
      /* 앱이 모르는 질의를 물으면 거짓 */
    }
    return { media: q, matches, addEventListener: () => {}, removeEventListener: () => {} };
  });
  vi.stubGlobal('innerWidth', WIDE.w);
  vi.stubGlobal('innerHeight', WIDE.h);
  history.replaceState(null, '', '/opencad-nc/');
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const backend = memoryBackend();
  backend.entries.set('a', { entry: { id: 'a', name: 'part.nc', size: 2048, time: Date.now() - 3_600_000, files: 2 }, data: enc.encode(SIE).buffer as ArrayBuffer });
  const app = new NcViewerApp(root, { recent: new RecentStore(backend) });
  dispose = await installLocalization(root);
  const api = window.opencadApp!;
  const forms = [WIDE, PHONE].map((f) => [f, RULES.filter((r) => r.media === null || media(r.media, f))] as const);
  const rep: Report = { problems: new Set(), seen: new Map(forms.map(([f]) => [f.name, new Set<number>()])), pairs: new Map(), named: 0, looks: 0 };
  let lang = 'ko';
  let forward = true;
  const switchTo = async (next: string): Promise<void> => {
    if (next === lang) return;
    document.querySelector<HTMLButtonElement>(`.language-list [data-language="${next}"]`)!.click();
    await until(() => document.documentElement.lang === next);
    lang = next;
    await quiet(20);
  };
  /** 한 상태: 화면이 가라앉으면 다섯 언어를 돌며 두 CSS 꼴로 센다(다음 상태는 거꾸로 — 언어 바꿈 수를 줄임) */
  const look = async (): Promise<void> => {
    await quiet();
    for (const l of forward ? LANGS : [...LANGS].reverse()) {
      await switchTo(l);
      for (const [f, active] of forms) scan(f, l, active, rep);
    }
    forward = !forward;
  };
  await app.renderRecent();
  // ① 처음 화면 + 키보드 단축키 창(? 키 — 문서 없이도): 창 본문(#1)·열기 칸(#3 — 창 밖은 inert지만 보임)·제목·도구 막대(#4).
  // jsdom은 inert로 누름을 막지 않아 창을 연 채 언어 메뉴로 바꿀 수 있다(창 글은 번역층이 옮김)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
  await until(() => !!document.querySelector('[role="dialog"][aria-modal="true"]'));
  await look();
  // 언어 메뉴를 누르면 초점이 언어 버튼으로 가 창 밖이다 — Esc는 창 안 닫기 버튼에서(창 상자가 받음)
  document.querySelector('.sc-close')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await until(() => !document.querySelector('[role="dialog"][aria-modal="true"]'));
  // ② 예제 프로그램 코드 탭: 코드 목록(#2)·찾기 칸(#6)·문서가 있는 도구 막대(#4 — 투영·재생)
  expect(await app.openBuffer('opencad-sample.nc', enc.encode(ncSampleProgram()).buffer as ArrayBuffer)).toBe(true);
  api.togglePanel(true);
  const tab = async (k: string): Promise<void> => {
    api.setPanelTab(k);
    await until(() => root.querySelector(`.panel-tab[data-tab="${k}"]`)?.getAttribute('aria-selected') === 'true');
  };
  await tab('code');
  await look();
  // ③ 같은 문서 깎기 탭: 해상도·색(#7)·소재 범위 최소·최대(#8)·공구 표(#9)
  await tab('sim');
  await until(() => !!root.querySelector('.panel-body table.sim-tools'));
  await look();
  // 스스로 확인(한국어 화면, 두 꼴): 이름을 따로 단 표에 없는 새 버튼은 「표에 없음」, 담음 꼴(설정 줄 고르기 — 두 꼴 모두 보임)에 보이는 글과 다른 이름을 주면 「담지 않음」으로 잡혀야 한다
  await switchTo('ko');
  const fresh = document.createElement('button');
  fresh.type = 'button';
  fresh.className = 'r228-new';
  fresh.setAttribute('aria-label', '다른 이름');
  fresh.textContent = '보이는 글';
  const bad = document.createElement('label');
  bad.className = 'prop-row edit';
  bad.innerHTML = '<span class="k">격자</span><select aria-label="엉뚱한 이름"></select>';
  document.body.append(fresh, bad);
  await quiet(20);
  for (const [f, active] of forms) {
    const self = new Set<string>();
    scan(f, 'ko', active, rep, self, false);
    expect([...self].filter((m) => m.includes('표에 없음') && m.includes('button.r228-new')), f.name).toHaveLength(1);
    expect([...self].filter((m) => m.includes('담지 않음') && m.includes('「격자」 ⊄ 「엉뚱한 이름」')), f.name).toHaveLength(1);
  }
  fresh.remove();
  bad.remove();
  return rep;
}

let dispose: (() => void) | undefined;
beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(깎기·정보 탭·3D 보기 위 UI·측정 도구·단축키 창)을 미리 받아 둔다(ci-guard 5번 — 222차 꼴)
  await import('../../src/app/sim');
  await import('../../src/app/viewer-ui');
  await loadPanelInfo();
  await import('../../src/app/measure-tools');
  await import('../../src/app/shortcuts');
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
  vi.stubGlobal('Worker', FakeWorker);
  localStorage.clear();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/opencad-nc/');
});

describe('228차 이름 안의 보이는 글(WCAG 2.5.3) — 다섯 언어 화면', () => {
  it('다섯 언어 화면(앱 하나 — 넓은 화면·휴대폰 CSS 두 꼴): 그린 칸 가운데 보이는 글이 있고 이름을 따로 단 칸은 모두 표에 들고, 「담음」·「고침」 꼴은 다섯 언어 모두 이름이 보이는 글을 담는다', async () => {
    const t0 = Date.now();
    const rep = await tour();
    const must: Record<string, readonly number[]> = { [WIDE.name]: [1, 2, 3, 4, 6, 7, 8, 9], [PHONE.name]: [1, 2, 3, 6, 7, 8, 9] };
    for (const [form, seen] of rep.seen)
      console.info(`228차 ${form}: 표 ${seen.size}/${TABLE.length}꼴 · 못 본 꼴 ${TABLE.filter((e) => !seen.has(e.n)).map((e) => `#${e.n}`).join('·') || '없음'}`);
    console.info(`228차: 셈 ${rep.looks}번(상태 셋 × 다섯 언어 × 두 꼴) · 이름을 따로 단 칸 ${rep.named}개 · ${Date.now() - t0} ms`);
    for (const [n, by] of [...rep.pairs].sort((a, b) => a[0] - b[0])) console.info(`  #${n} ${[...by].map(([l, s]) => `${l} ${[...s].join(' ')}`).join(' | ')}`);
    expect([...rep.problems]).toEqual([]);
    expect(Object.entries(must).flatMap(([form, ns]) => ns.filter((n) => !rep.seen.get(form)?.has(n)).map((n) => `${form} #${n}`))).toEqual([]);
    // 표시 규칙(display)을 jsdom이 못 읽은 선택자는 글 칸을 숨기지 않는 것뿐(띠·알림 자리 :has — 판단 띠 글 펼침은 누를 칸이 아님)
    expect(RULES.filter((r) => threw.has(r.sel) && !/\.nt-text|\.notice-bar|\.toasts?\b/.test(r.sel)).map((r) => r.sel)).toEqual([]);
  });

  it('소스 글: 이름 다는 자리(aria-label·aria-labelledby 줄)는 모두 SITES 표에 들고 줄 수가 같다 — 새 자리는 판정(DOM 표 꼴 번호 또는 셈 밖 까닭)과 함께 표에', () => {
    const found = nameSites();
    const stray = found.filter((s) => !SITES.some(([f, snip]) => f === s.file && s.line.includes(snip)));
    expect(stray.map((s) => `${s.file}: ${s.line.slice(0, 120)}`)).toEqual([]);
    const off = SITES.map(([f, snip, n]) => [f, snip, found.filter((s) => s.file === f && s.line.includes(snip)).length, n] as const).filter(([, , got, n]) => got !== n);
    expect(off).toEqual([]);
    // 판정 #n은 DOM 표에 있는 꼴
    expect(SITES.filter(([, , , v]) => /^#\d+$/.test(v) && !TABLE.some((e) => `#${e.n}` === v)).map(([f, s]) => `${f}: ${s}`)).toEqual([]);
    expect(found.length).toBe(SITES.reduce((a, [, , n]) => a + n, 0));
  });

  it('사전: 측정 중에만 보이는 끌어온 점 버튼 — 보이는 수(배지)를 이름 틀이 네 언어 모두 품고, 열기 칸 보이는 제목 둘은 네 언어에 있다', () => {
    for (const lang of LANGS) {
      expect(holds(translate('끌어온 점 기억 · 기억한 점 2개', lang), '2'), lang).toBe(true);
      if (lang === 'ko') continue;
      const d = catalogs[lang] as Record<string, string>;
      expect(d['끌어온 점 기억 · 기억한 점 {0}개'], lang).toContain('{0}');
      for (const k of ['NC 파일을 여기에 끌어다 놓으십시오', 'NC 파일을 골라 여십시오']) expect(d[k], `${lang} ${k}`).toBeTruthy();
    }
  });
});
