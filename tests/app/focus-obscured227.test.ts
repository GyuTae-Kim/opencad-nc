// @vitest-environment jsdom
/**
 * 227차(WCAG 2.4.11 초점이 가려지지 않음 — 최소 기준): 키보드 초점을 받은 칸이 앱이 만든 다른 내용(3D 보기 위 띠·알림 상자·덮개 등)에 통째로 가려지면 안 된다
 * (일부만 가려지면 통과, 사용자가 연 내용 — 메뉴·대화 상자·단면 상자 — 이 가리는 것은 그 내용을 닫을 수 있으면 예외). 감사 표는 .runtime/r227/progress.md와 같은 줄.
 * - 소스 글: 세 CSS 파일에서 떠 있는 칸 규칙(position fixed·absolute·sticky 또는 z-index)은 모두 FLOAT 표에 판정과 함께 있어야 한다 — 표 밖에 새 규칙이 생기면 실패하고,
 *   표 줄마다 판정의 근거(보기보다 좁은 폭·누르기 통과·제 칸 안·붙지 않는 표 머리·inert 덮개·닫는 길 — 규칙 값·코드 글)를 본다. src의 인라인 위치 글은 1화소 알림 영역뿐이다.
 * - 고친 것(227차): 알림 상자(z 80, 화면 아래 가운데)가 패널·시트 몸통·시작 화면·메뉴 아래쪽의 초점 칸을 통째로 덮을 수 있었다(칸이 굴림 칸 안이라 브라우저가 굴리지 않고,
 *   몸통 끝 줄은 더 굴릴 수도 없음) — 초점이 든 칸이 알림 하나 안에 다 들면 상자를 그 칸 위로 비켜 올리고, 알림 밖 다른 칸으로 가면 제자리.
 *   jsdom은 배치를 하지 않아 자리(getBoundingClientRect)를 칸마다 준다(110·191차 꼴).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, toastArea } from '../../src/app/dom';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// ───────────────────────── 소스 글: CSS 규칙(226차 hover-focus226 꼴) ─────────────────────────

const SHEETS = { vlist: 'src/view/vlist.css', styles: 'src/app/styles.css', shortcuts: 'src/app/shortcuts.css' } as const;
type Sheet = keyof typeof SHEETS;
interface Rule {
  readonly sheet: Sheet;
  readonly media: string;
  readonly sel: string;
  readonly d: readonly (readonly [string, string])[];
}
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** 주석을 빼고 @media 덩어리 안팎 규칙을 읽는다(선택자 목록은 「, 」로 모음) */
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
type At = { readonly sheet: Sheet; readonly media: string; readonly sel: string };
const where = (r: At): string => `${r.sheet}${r.media ? ` ${r.media}` : ''} ${r.sel}`;
const find = (at: At): Rule | undefined => RULES.find((r) => r.sheet === at.sheet && r.media === at.media && r.sel === at.sel);
const val = (r: Rule | undefined, prop: string): string | undefined => r?.d.find(([k]) => k === prop)?.[1];
/** 떠 있는 칸 규칙: 제자리를 떠나 다른 칸 위에 놓일 수 있는 것(fixed·absolute·sticky) 또는 쌓는 차례(z-index)를 정하는 것 */
const floats = (): Rule[] => RULES.filter((r) => r.d.some(([k, v]) => (k === 'position' && /^(fixed|absolute|sticky)$/.test(v)) || k === 'z-index'));

// ───────────────────────── 감사 표 ─────────────────────────

type Verdict = '통째' | '일부' | '없음' | '예외';
/** 판정 근거: 규칙 값(at을 주면 그 규칙 — 값 꼴이 null이면 그 속성이 없어야 함) 또는 src 글(not이면 없어야 함) */
type Ev = { readonly css: readonly [string, RegExp | null]; readonly at?: At } | { readonly src: string; readonly re: RegExp; readonly not?: true };
interface Float extends At {
  /** progress.md 표 줄 번호 */
  readonly row: number;
  readonly verdict: Verdict;
  readonly what: string;
  readonly ev: readonly Ev[];
  /** 3D 보기 위에 뜨는 칸 — 폭(width·max-width·left) 근거가 있어야 한다(캔버스 양옆이 남음) */
  readonly view?: true;
}
const NARROW = '(max-width: 759.98px)';
const S = (sel: string, media = ''): At => ({ sheet: 'styles', media, sel });
const MENU_CLOSE: readonly Ev[] = [
  { src: 'src/app/app.ts', re: /for \(const type of \['pointerdown', 'focusin'\] as const\)/ },
  { src: 'src/app/app.ts', re: /if \(this\.openMenu && !this\.openMenu\.wrap\.contains\(ev\.target as Node\)\) this\.closeMenu\(\);/ },
];
const FLOAT: readonly Float[] = [
  { row: 1, ...S('.toasts'), verdict: '통째', what: '알림 상자 — 패널·시트 몸통·시작 화면·메뉴 아래쪽 위(넷까지 쌓임) — 227차 고침: 초점 칸을 통째로 덮으면 그 칸 위로 비킴', ev: [{ css: ['position', /^fixed$/] }, { css: ['z-index', /^80$/] }, { css: ['pointer-events', /^auto$/], at: S('.toast') }] },
  { row: 2, ...S('.measure-bar'), verdict: '일부', view: true, what: '측정 띠(좁은 화면·손가락) — 3D 보기 아래', ev: [{ css: ['max-width', /^calc\(100% - 16px\)$/] }, { css: ['z-index', /^7$/] }] },
  { row: 3, ...S('.measure-flash'), verdict: '일부', view: true, what: '측정 띠 위 알림 — 판단 띠·알림 상자·툴팁은 비킴(192·193차)', ev: [{ css: ['max-width', /^calc\(100vw - 32px\)$/] }] },
  { row: 4, ...S('.snap-tip'), verdict: '일부', view: true, what: '커서 옆 붙잡기 툴팁 — 띠·뷰 큐브를 비킴(191차)', ev: [{ css: ['max-width', /^calc\(100% - 8px\)$/] }, { css: ['pointer-events', /^none$/] }] },
  { row: 5, ...S('.play-strip'), verdict: '일부', view: true, what: '재생 띠 — 넓은 화면 아주 낮은 보기에서만 판단 띠 아래쪽과 겹침(드묾)', ev: [{ css: ['width', /^min\(560px, calc\(100% - 16px\)\)$/] }] },
  {
    row: 6,
    ...S('.notice-bar'),
    verdict: '일부',
    view: true,
    what: '해석 판단 띠 — 넓은 화면 위(양옆 70px), 좁은 화면 아래 띠 위. 덮는 깎기 진행 칩은 초점 칸이 아님(225차)',
    ev: [{ css: ['max-width', /^calc\(100% - 140px\)$/] }, { css: ['max-width', /^calc\(100% - 16px\)$/], at: S('.notice-bar', NARROW) }, { src: 'src/app/sim.ts', re: /class: 'sim-chip', 'aria-hidden': 'true'/ }],
  },
  { row: 7, ...S('.sim-chip'), verdict: '일부', view: true, what: '깎기 진행 칩(왼쪽 위)', ev: [{ css: ['left', /^8px$/] }, { css: ['pointer-events', /^none$/] }, { css: ['z-index', /^6$/] }] },
  { row: 8, ...S('.gl-lost'), verdict: '일부', view: true, what: '그래픽 잃음 안내(가운데 한 줄)', ev: [{ css: ['max-width', /^calc\(100% - 32px\)$/] }, { css: ['pointer-events', /^none$/] }] },
  { row: 9, ...S('.sec-handle'), verdict: '일부', view: true, what: '화면 위 단면 손잡이(20·32px 원)', ev: [{ css: ['width', /^var\(--sec-size\)$/] }, { css: ['--sec-size', /^20px$/] }, { css: ['z-index', /^6$/] }] },
  { row: 10, ...S('.aim-layer'), verdict: '없음', what: '정밀 조준 층 — 투명(바탕 없음)·누르기 통과', ev: [{ css: ['pointer-events', /^none$/] }, { css: ['background', null] }] },
  { row: 11, ...S('.aim-reticle'), verdict: '일부', view: true, what: '정밀 조준 십자선(길게 누른 동안)', ev: [{ css: ['width', /^48px$/] }] },
  { row: 12, ...S('.panel-grip'), verdict: '없음', what: '패널 크기 손잡이 — 투명(바탕 없음)', ev: [{ css: ['background', null] }, { css: ['z-index', /^5$/] }] },
  { row: 13, ...S('.panel-grip::after', NARROW), verdict: '없음', what: '시트 손잡이 막대 — 시트 머리 위 여백 안', ev: [{ css: ['top', /^4px$/] }, { css: ['height', /^4px$/] }, { css: ['padding-top', /^10px$/], at: S('.panel-head', NARROW) }] },
  {
    row: 14,
    ...S('.start'),
    verdict: '없음',
    what: '시작 화면 — 문서 전에는 패널이 숨고 3D 보기는 빔, 문서를 열면 숨고 다시 뜨지 않음',
    ev: [
      { src: 'src/app/app.ts', re: /this\.startEl\.hidden = true;/ },
      { src: 'src/app/app.ts', re: /startEl\.hidden = (?!true;)|startEl\.toggleAttribute\(/, not: true },
      { src: 'src/app/panel.ts', re: /this\.el\.hidden = !on \|\| !this\.doc;/ },
    ],
  },
  { row: 15, ...S('.busy'), verdict: '없음', what: '읽는 중 덮개 — 덮는 칸은 inert(182차)', ev: [{ src: 'src/app/app.ts', re: /for \(const el of this\.workspace\.children\) if \(el !== this\.busyEl\) el\.toggleAttribute\('inert', this\.busy\);/ }] },
  { row: 16, ...S('.dropmask'), verdict: '없음', what: '끌어 놓기 덮개 — 끄는 동안만', ev: [{ css: ['pointer-events', /^none$/] }, { src: 'src/app/app.ts', re: /class: 'dropmask', hidden: true, 'aria-hidden': 'true'/ }] },
  { row: 17, ...S('.menu'), verdict: '예외', what: '펼친 메뉴 — Esc·바깥 초점에 닫힘(152차)', ev: MENU_CLOSE },
  { row: 18, ...S('.sec-pop'), verdict: '예외', what: '단면 상자 — 같은 닫힘(openMenu)', ev: [...MENU_CLOSE, { src: 'src/app/app.ts', re: /class: 'sec-pop', role: 'dialog'/ }] },
  { row: 19, ...S('.language-list'), verdict: '예외', what: '언어 목록(사이트 키트) — 알림 상자보다 위, Esc·Tab에 닫힘', ev: [{ css: ['z-index', /^10001$/] }] },
  { row: 20, sheet: 'shortcuts', media: '', sel: '.sc-back', verdict: '예외', what: '단축키 창 덮개 — 열린 동안 밖 칸 inert, Esc·닫기', ev: [{ src: 'src/app/shortcuts.ts', re: /for \(const el of made\) el\.setAttribute\('inert', ''\);/ }, { css: ['z-index', /^75$/] }] },
  { row: 21, ...S('.language-control-floating'), verdict: '없음', what: '앱이 서기 전 언어 단추 — 제목 막대가 서면 뗌', ev: [{ src: 'src/app/i18n.ts', re: /classList\.remove\('language-control-floating'\)/ }] },
  { row: 22, ...S('table.grid th'), verdict: '없음', what: '표 머리(sticky) — 표는 모두 .table-wrap(굴림 칸 — 높이 제한 없음) 안이라 몸통 굴림에 붙지 않음', ev: [{ css: ['overflow-x', /^auto$/], at: S('.table-wrap') }, { css: ['max-height', null], at: S('.table-wrap') }] },
  { row: 23, sheet: 'vlist', media: '', sel: '.vlist-rows', verdict: '없음', what: '코드 목록 줄 층 — 목록 자신의 안', ev: [{ css: ['position', /^relative$/], at: { sheet: 'vlist', media: '', sel: '.vlist-inner' } }, { src: 'src/view/vlist.ts', re: /if \(!center && rowVisible\(row, this\.el\.scrollTop/ }] },
  { row: 24, ...S('.mb-badge'), verdict: '없음', what: '끌어온 점 수 — 제 버튼 모서리', ev: [{ css: ['position', /^relative$/], at: S('.mb-btn.mb-track') }, { css: ['pointer-events', /^none$/] }] },
  { row: 25, ...S('.toast-x'), verdict: '없음', what: '알림 ✕ — 제 알림 오른쪽 여백(34px) 안', ev: [{ css: ['padding', /^8px 34px 8px 12px$/], at: S('.toast') }, { css: ['width', /^26px$/] }, { css: ['right', /^4px$/] }] },
  { row: 26, ...S(".menu button[aria-checked='true']::before"), verdict: '없음', what: '메뉴 고른 점 — 제 항목 왼쪽 여백(26px) 안', ev: [{ css: ['padding', /^0 10px 0 26px$/], at: S('.menu button') }, { css: ['left', /^9px$/] }, { css: ['width', /^8px$/] }] },
  { row: 27, ...S('.sec-handle::after'), verdict: '일부', view: true, what: '단면 손잡이 화살표', ev: [{ css: ['left', /^50%$/] }, { css: ['border-left', /^8px solid/] }] },
  { row: 28, sheet: 'shortcuts', media: '', sel: '.sc-live', verdict: '없음', what: '창을 닫은 뒤 알림 영역 — 1화소로 자름', ev: [{ css: ['width', /^1px$/] }, { css: ['clip', /^rect\(0 0 0 0\)$/] }] },
];

/** 표 줄 근거 가운데 맞지 않는 것 */
function evProblems(f: Float): string[] {
  const out: string[] = [];
  for (const e of f.ev) {
    if ('src' in e) {
      if (e.re.test(read(e.src)) === Boolean(e.not)) out.push(`#${f.row} ${e.src}: ${e.not ? '없어야 함' : '없음'} ${e.re}`);
      continue;
    }
    const at = e.at ?? f;
    const r = find(at);
    const v = val(r, e.css[0]);
    if (!r) out.push(`#${f.row} 규칙 없음 ${where(at)}`);
    else if (e.css[1] === null ? v !== undefined : v === undefined || !e.css[1].test(v)) out.push(`#${f.row} ${where(at)} ${e.css[0]}: ${v}`);
  }
  return out;
}

// ───────────────────────── 알림 상자 자리(jsdom — 배치가 없어 자리를 준다) ─────────────────────────

const box =
  (left: number, top: number, width: number, height: number) =>
  (): DOMRect =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
function button(text: string, at: () => DOMRect): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.getBoundingClientRect = at;
  document.body.append(b);
  return b;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('innerHeight', 844);
  document.body.innerHTML = '';
});
afterEach(() => {
  // 남은 알림은 제 시간에 닫힌다 — 다음 시험이 빈 상자에서
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('227차 초점이 가려지지 않음(WCAG 2.4.11) 감사 표', () => {
  it('소스 글: 세 CSS 파일의 떠 있는 칸 규칙(fixed·absolute·sticky·z-index)은 모두 FLOAT 표에(새 규칙은 판정과 함께 표에), 표 줄의 규칙은 모두 있다 — 28개: 통째 1·일부 10·없음 13·예외 4', () => {
    const seen = floats().map(where);
    const keys = FLOAT.map(where);
    expect({ outside: seen.filter((k) => !keys.includes(k)), stale: keys.filter((k) => !seen.includes(k)), twice: keys.filter((k, i) => keys.indexOf(k) !== i) }).toEqual({ outside: [], stale: [], twice: [] });
    const count = (v: Verdict): number => FLOAT.filter((f) => f.verdict === v).length;
    expect([FLOAT.length, count('통째'), count('일부'), count('없음'), count('예외')]).toEqual([28, 1, 10, 13, 4]);
    // 줄 번호는 progress.md 표 차례(1~28 — 겹치지 않음)
    expect(FLOAT.map((f) => f.row)).toEqual(FLOAT.map((_, i) => i + 1));
  });

  it('판정 근거: 줄마다 규칙 값·코드 글이 판정대로다 — 3D 보기 위 칸은 폭 근거, 누르기 통과·투명 층, 제 칸 안 장식, 붙지 않는 표 머리, inert 덮개, 사용자가 연 내용의 닫는 길', () => {
    expect(FLOAT.flatMap(evProblems)).toEqual([]);
    // 3D 보기 위 칸은 폭(width·max-width·left) 근거를 적는다 — 새 띠도 캔버스 양옆이 남는지 적어야 통과
    const noWidth = FLOAT.filter((f) => f.view && !f.ev.some((e) => 'css' in e && !e.at && ['width', 'max-width', 'left'].includes(e.css[0])));
    expect(noWidth.map(where)).toEqual([]);
    // 표 머리(sticky)가 붙을 굴림 칸: 앱이 만드는 표(class grid)는 모두 바로 .table-wrap 안
    const grids: string[] = [];
    for (const f of ['src/app/panel-info.ts', 'src/app/sim.ts']) {
      const t = read(f);
      for (const m of t.matchAll(/class: 'grid/g)) grids.push(`${f} ${t.slice(Math.max(0, m.index! - 120), m.index).includes("{ class: 'table-wrap' }")}`);
    }
    expect(grids).toEqual(['src/app/panel-info.ts true', 'src/app/panel-info.ts true', 'src/app/panel-info.ts true', 'src/app/sim.ts true']);
  });

  it('3D 보기 캔버스(한 칸)는 일부 가림이라 통과 — 보기 위 칸은 모두 보기보다 좁고, 휴대폰 시트(패널)는 3D 보기 다음 줄이라 덮지 않는다', () => {
    // 보기 위 칸: 측정·재생·판단(좁은 화면) 띠 100% − 16px, 넓은 판단 띠 100% − 140px, 툴팁 100% − 8px, 그래픽 잃음 100% − 32px, 칩 왼쪽 8px, 손잡이·십자선은 작은 칸
    expect(FLOAT.filter((f) => f.view).map((f) => f.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 11, 27]);
    // 휴대폰: 작업 영역은 세로 줄(3D 보기 → 시트), 패널은 어느 미디어에서도 떠 있지 않다
    expect(val(find(S('.workspace', NARROW)), 'flex-direction')).toBe('column');
    const panel = RULES.filter((r) => r.sheet === 'styles' && r.sel === '.panel');
    expect(panel.map((r) => [r.media, val(r, 'position') ?? '-'])).toEqual([
      ['', 'relative'],
      [NARROW, '-'],
      ['(max-width: 759.98px) and (max-height: 499.98px)', '-'],
    ]);
    // 코어 캔버스 초점 테두리는 안쪽(outline-offset −2px) — 양옆에 남는 캔버스에 세로 테두리가 보인다
    expect(read('node_modules/opencad-viewer3d/src/theme.ts')).toMatch(/:where\(canvas\.v3d-gl\):focus-visible\{outline:2px solid [^;]+;outline-offset:-2px\}/);
  });

  it('소스 글: src의 인라인 위치 글(position:…)은 1화소로 자른 알림 영역 넷뿐이고, 코드로 위치·쌓는 차례를 바꾸는 곳은 없다', () => {
    const files = (dir: string): string[] =>
      readdirSync(join(ROOT, dir)).flatMap((n) => (statSync(join(ROOT, dir, n)).isDirectory() ? files(`${dir}/${n}`) : n.endsWith('.ts') ? [`${dir}/${n}`] : []));
    const inline: string[] = [];
    const set: string[] = [];
    for (const f of files('src'))
      for (const line of read(f).split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (/position: ?(fixed|absolute|sticky)/.test(line)) inline.push(`${f} ${line.includes('width:1px;height:1px') && line.includes('clip:rect(0 0 0 0)')}`);
        if (/\.style\.(position|zIndex)\b|setProperty\('(position|z-index)'/.test(line)) set.push(f);
      }
    expect(inline.sort()).toEqual(['src/app/app.ts true', 'src/app/keysnap.ts true', 'src/app/measure-lock.ts true', 'src/app/sim.ts true']);
    expect(set).toEqual([]);
  });

  it('고친 것: 초점이 든 칸이 알림 하나 안에 다 들면 알림 상자를 그 칸 위로 비켜 올리고 알림 밖 다른 칸으로 가면 제자리 — 일부만 가림·좁은 알림 옆·위에 자리 없음·알림 안 초점·알림 없음은 그대로', () => {
    toast('이 줄은 이동을 만들지 않습니다.', 'info', 2500);
    const host = toastArea();
    const note = host.querySelector<HTMLElement>('.toast')!;
    // 390×844 휴대폰 시트 꼴: 알림 하나(높이 37) — 화면 아래 38px 위(769~806), 폭 366(12~378)
    host.getBoundingClientRect = box(12, 769, 366, 37);
    note.getBoundingClientRect = box(12, 769, 366, 37);
    const under = button('눈', box(300, 774, 28, 26)); // 시트 몸통 아래쪽 칸 — 알림 안에 다 듦
    const part = button('줄', box(20, 752, 300, 26)); // 위 17px가 알림 밖 — 일부
    const free = button('탭', box(20, 500, 60, 36)); // 알림 밖
    expect(host.style.bottom).toBe('');
    under.focus();
    // 칸 위 6px로: 844 − 774 + 6
    expect([document.activeElement === under, host.style.bottom]).toEqual([true, '76px']);
    // 알림 안 초점(✕ — Tab)은 그대로: 상자가 초점 밑에서 튀지 않게
    note.querySelector<HTMLElement>('.toast-x')!.focus();
    expect(host.style.bottom).toBe('76px');
    // 알림 밖 다른 칸으로 가면 CSS 자리로, 일부만 가린 칸은 그대로(최소 기준 통과)
    free.focus();
    expect(host.style.bottom).toBe('');
    part.focus();
    expect(host.style.bottom).toBe('');
    // 상자보다 좁은 알림 옆 칸(상자 자리 안이지만 알림 밖 — 보임)은 올리지 않는다
    note.getBoundingClientRect = box(100, 769, 190, 37);
    under.focus();
    expect(host.style.bottom).toBe('');
    // 칸 위에 상자가 들 자리가 없으면(칸 위 공간 < 상자 높이 + 6) 올리지 않는다 — 화면 밖으로 밀지 않음
    host.getBoundingClientRect = box(12, 10, 366, 37);
    note.getBoundingClientRect = box(12, 10, 366, 37);
    button('위', box(40, 15, 28, 26)).focus();
    expect(host.style.bottom).toBe('');
    // 다시 아래 자리 — 덮인 칸이면 올리고, 알림이 다 빠지면 그대로
    host.getBoundingClientRect = box(12, 769, 366, 37);
    note.getBoundingClientRect = box(12, 769, 366, 37);
    under.focus();
    expect(host.style.bottom).toBe('76px');
    note.remove();
    free.focus();
    under.focus();
    expect(host.style.bottom).toBe('');
  });
});
