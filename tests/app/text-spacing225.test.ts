/**
 * 225차(WCAG 1.4.12 글 간격 — 사용자가 줄 높이를 글자 크기의 1.5배, 문단 뒤 간격을 2배, 글자 간격을 0.12em, 낱말 간격을 0.16em로 넓혀도 글·기능이 잘리거나 겹치지 않는지):
 * 글이 드는 칸의 CSS 규칙을 감사 표(TABLE — .runtime/r225/progress.md 표와 같은 번호)로 지킨다. jsdom은 배치를 하지 않아 세 CSS 파일 규칙 글을 읽어 셈한다(222차 target-size222 꼴 — 이 파일은 DOM 없이).
 * - 거르는 꼴(말줄임·line-clamp·px 줄 높이·overflow hidden + 고정 높이/줄 바꿈 막기·고정 높이 + 줄 바꿈 막기/글꼴/줄 높이)에 걸리는 규칙은 모두 표에 있어야 한다 —
 *   새 글 칸 규칙이 생기면 판정(넓혀도 듦·다른 길·펼침·설계·고침·대상 아님)과 함께 표에 더해야 통과한다. 표 줄의 규칙이 없어지면 낡은 줄로 실패한다.
 * - 고정 높이 칸은 칸 안 높이(height − 위아래 여백·테두리) ≥ 1.5 × 글자 크기, 다른 길 칸은 그 길(소스 글 조각), 펼침 칸은 펼친 규칙, 고친 칸은 잘림 없음(줄 바꿈).
 * 고친 셋(넓히면 잘리고 보는 다른 길이 없던 칸): 정보 탭 풀이 글 없는 값 칸(보정 구간 출처·공구 방향)·켜고 끄는 줄 이름·단면 상자 값 — 말줄임 대신 줄 바꿈.
 * 글 폭 어림은 222차 꼴(한글·한자 1em, 빈칸 0.3em, 그 밖 0.55em) + 넓힘(글자마다 0.12em, 빈칸마다 0.16em 더).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const cache = new Map<string, string>();
const read = (p: string): string => {
  let t = cache.get(p);
  if (t === undefined) cache.set(p, (t = readFileSync(join(ROOT, p), 'utf8')));
  return t;
};
// main.ts가 vlist.css → styles.css 차례로 가져오고, shortcuts.css는 단축키 창 조각과 함께 붙는다
const SHEETS = { vlist: 'src/view/vlist.css', styles: 'src/app/styles.css', shortcuts: 'src/app/shortcuts.css' } as const;
type Sheet = keyof typeof SHEETS;

// ───────────────────────── CSS 규칙 읽기 ─────────────────────────

interface Rule {
  readonly sheet: Sheet;
  readonly media: string;
  readonly sel: string;
  readonly d: readonly (readonly [string, string])[];
}
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
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
  // @media 덩어리를 모두 읽었는지(못 읽으면 안 규칙이 맨 바깥으로 새어 셈이 틀린다)
  if (blocks !== (css.match(/@media/g) ?? []).length) throw new Error(`${sheet}: @media 덩어리를 다 읽지 못함`);
  return out;
}
const RULES: readonly Rule[] = (Object.keys(SHEETS) as Sheet[]).flatMap(rulesOf);
const rulesAt = (sheet: Sheet, media: string, sel: string): Rule[] => RULES.filter((r) => r.sheet === sheet && r.media === media && r.sel === sel);
/** 같은 자리 규칙의 선언을 차례로 겹친 것(뒤가 이김) */
const declOf = (rs: readonly Rule[]): Map<string, string> => new Map(rs.flatMap((r) => r.d));
const decl = (sheet: Sheet, sel: string, media = ''): Map<string, string> => declOf(rulesAt(sheet, media, sel));

/** 거르는 꼴: 글이 넓어진 간격을 받지 못할 수 있는 규칙 */
function guarded(r: Rule): boolean {
  const has = (p: RegExp, v: RegExp): boolean => r.d.some(([k, x]) => p.test(k) && v.test(x));
  const clip = has(/^text-overflow$/, /ellipsis/) || has(/^(-webkit-)?line-clamp$/, /./);
  const hidden = has(/^overflow(-x|-y)?$/, /^(hidden|clip)$/);
  const fixed = has(/^(max-)?height$/, /^-?[\d.]+(px|em)$/);
  const nowrap = has(/^white-space$/, /^(nowrap|pre)$/);
  const pxLine = has(/^line-height$/, /^[\d.]+px$/) || has(/^font$/, /[\d.]+px\s*\/\s*[\d.]+px/);
  const font = has(/^(font|font-size|line-height)$/, /./);
  return clip || pxLine || (hidden && (fixed || nowrap)) || (fixed && (nowrap || font));
}

// ───────────────────────── 감사 표 ─────────────────────────

/**
 * 듦 = 고정 높이 칸에 1.5배 한 줄이 듦 · 넘쳐 보임 = 1px 안 넘치나 overflow 보임(잘림 없음) · 다른 길 = 잘리지만 온 글을 볼 길(title·이름·다른 자리 — alt 소스 조각) ·
 * 펼침 = 줄 수로 자르고 펼친 규칙(open) · 설계 = 그 꼴이어야 하는 까닭(alt) · 고침 = 225차에 줄 바꿈으로 · 대상 아님 = 글 없음·화면 읽기 전용·기호 · 높이 없음 = px 줄 높이지만 칸이 늚
 */
type Kind = '듦' | '넘쳐 보임' | '다른 길' | '펼침' | '설계' | '고침' | '대상 아님' | '높이 없음';
interface Entry {
  readonly n: number;
  readonly sheet: Sheet;
  readonly media?: string;
  readonly sel: string;
  /** 담는 글(222차 누를 칸 표 이름을 빌려) */
  readonly text: string;
  readonly kind: Kind;
  /** 듦·넘쳐 보임: 글자 크기(px) — 규칙(또는 fsSel 규칙)이 px 글자 크기를 정하면 같아야 한다 */
  readonly fs?: number;
  readonly fsSel?: string;
  /** 여백·테두리·높이를 받는 바탕 규칙(넓은 화면 맨 바깥 — 차례대로 먼저 겹침) */
  readonly also?: readonly string[];
  /** 다른 길·설계: [소스 파일, 그 길이 있는 글 조각] */
  readonly alt?: readonly [string, string];
  /** 펼침: 같은 조건의 펼친 규칙 */
  readonly open?: readonly string[];
  readonly why?: string;
}
const COARSE = '(pointer: coarse)';
const NARROW = '(max-width: 759.98px)';
const PHONE_TITLE = '(max-width: 767px)';
const FIXED_V = '.prop-row .v:not([title]):not(.sim-v)';
const TABLE: readonly Entry[] = [
  // A. 고정 높이 글 칸
  { n: 1, sheet: 'styles', sel: '.titlebar', text: '제목 막대(앱 이름 15px·#11 버튼)', kind: '듦', fs: 15, fsSel: '.brand' },
  { n: 2, sheet: 'styles', media: PHONE_TITLE, sel: '.titlebar', text: '제목 막대(휴대폰 — 위아래 여백 0)', kind: '듦', fs: 15, fsSel: '.brand' },
  { n: 3, sheet: 'styles', sel: '.tbtn', text: '#11 제목·도구 막대 버튼', kind: '듦', fs: 13 },
  { n: 4, sheet: 'styles', media: COARSE, sel: '.tbtn', text: '#11 (손가락)', kind: '듦', fs: 13 },
  { n: 5, sheet: 'styles', sel: '.tbtn.big', text: '시작 화면 큰 버튼', kind: '듦', fs: 14, also: ['.tbtn'] },
  { n: 6, sheet: 'styles', media: COARSE, sel: '.tbtn.recent-clear', text: '최근 문서 모두 지우기(손가락)', kind: '듦', fs: 13, also: ['.tbtn'] },
  { n: 7, sheet: 'styles', sel: '.mb-btn', text: '#18 측정·재생·따라가기·판단 띠 버튼', kind: '듦', fs: 13 },
  { n: 8, sheet: 'styles', sel: '.notice .mb-btn', text: '#18 판단 띠 버튼', kind: '듦', fs: 13, also: ['.mb-btn'] },
  { n: 9, sheet: 'styles', sel: '.code-search input', text: '#15 코드 찾기 칸', kind: '듦', fs: 12.5 },
  { n: 10, sheet: 'styles', media: COARSE, sel: '.code-search input', text: '#15 (손가락)', kind: '듦', fs: 16 },
  { n: 11, sheet: 'styles', sel: '.statusbar', text: '상태 막대(가로는 안 칸 말줄임 — 27·28)', kind: '듦', fs: 12 },
  { n: 12, sheet: 'styles', sel: '.st-warn', text: '#16 상태 막대 경고(여유 0)', kind: '듦', fs: 12 },
  { n: 13, sheet: 'styles', sel: '.panel-tab', text: '#13 패널 탭(가로는 탭 줄 굴림)', kind: '듦', fs: 13 },
  { n: 14, sheet: 'styles', sel: '.btn.small', text: '#22 작은 버튼', kind: '듦', fs: 13 },
  { n: 15, sheet: 'styles', media: COARSE, sel: '.btn.small, .select, .select.small', text: '#22·#23 (손가락)', kind: '듦', fs: 13, also: ['.btn.small'] },
  { n: 16, sheet: 'styles', sel: '.select', text: '#23 고르기(보이는 글은 브라우저가 자름 — 펼친 목록이 온 글)', kind: '듦', fs: 13 },
  { n: 17, sheet: 'styles', sel: '.select.small', text: '#23 재생 속도·공구 고르기', kind: '듦', fs: 13, also: ['.select'] },
  { n: 18, sheet: 'styles', sel: '.seg', text: '#24 단면 축(끔·X·Y·Z)', kind: '듦', fs: 13 },
  { n: 19, sheet: 'styles', media: COARSE, sel: '.seg', text: '#24 (손가락)', kind: '듦', fs: 13 },
  { n: 20, sheet: 'styles', sel: '.num-input', text: '#36 숫자 칸', kind: '듦', fs: 13 },
  { n: 21, sheet: 'styles', media: COARSE, sel: '.num-input', text: '#36 (손가락)', kind: '듦', fs: 16 },
  { n: 22, sheet: 'styles', sel: ".num-input[aria-invalid='true']", text: '#36 틀린 값(테두리 2px)', kind: '듦', fs: 13, also: ['.num-input'] },
  { n: 23, sheet: 'styles', sel: '.mb-badge', text: '측정 띠 끌어온 점 수(16px 칸에 16.5 — 170차)', kind: '넘쳐 보임', fs: 11 },
  { n: 24, sheet: 'styles', sel: '.toast-x', text: '#19 알림 ✕', kind: '대상 아님', why: '기호 「×」 하나(이름은 aria-label)' },
  // B. 말줄임·자름·overflow hidden
  { n: 25, sheet: 'styles', sel: '.docname', text: '제목 막대 문서 이름', kind: '다른 길', alt: ['src/app/app.ts', 'this.docNameEl.title = d.name'] },
  { n: 26, sheet: 'styles', media: PHONE_TITLE, sel: '.titlebar .brand', text: '앱 이름(휴대폰 — 390 폭 넓히면 잘림)', kind: '다른 길', alt: ['src/app/app.ts', 'document.title = `${d.name} - ${APP_TITLE}`'] },
  { n: 27, sheet: 'styles', sel: '.st-main', text: '상태 막대 문서 요약 → 정보 탭 같은 값 줄', kind: '다른 길', alt: ['src/app/panel-info.ts', "row('읽은 시간', formatMs(d.ms))"] },
  { n: 28, sheet: 'styles', sel: '.st-sel', text: '상태 막대 고른 것 요약', kind: '다른 길', alt: ['src/app/app.ts', 'this.stSel.title = mixText(sel)'] },
  { n: 29, sheet: 'styles', sel: '.play-strip .ps-state', text: '재생 띠 상태 → 패널 재생 칸 상태(줄 바꿈)', kind: '다른 길', alt: ['src/app/panel.ts', 'p.state.replaceChildren(...mixNodes(mix`${st.motion} · ${st.modal}'] },
  { n: 30, sheet: 'styles', sel: '.recent-name', text: '#21 최근 문서 이름 → 옆 ✕ 풍선 글·이름', kind: '다른 길', alt: ['src/app/app.ts', 'mix`최근 문서에서 ${fileText(e.name)} 지우기`'] },
  { n: 31, sheet: 'styles', sel: '.busy-name', text: '읽는 중 파일 이름 → 읽은 뒤 제목 막대 title·정보 탭 파일 줄', kind: '다른 길', alt: ['src/app/app.ts', 'this.docNameEl.title = d.name'] },
  { n: 32, sheet: 'styles', sel: '.prop-row .v', text: '정보 탭 값', kind: '다른 길', alt: ['src/app/panel-info.ts', "h('span', { class: 'v', title: v"] },
  { n: 33, sheet: 'styles', sel: FIXED_V, text: '정보 탭 보정 구간 출처 줄·공구 방향 줄(풀이 글 없음)', kind: '고침' },
  { n: 34, sheet: 'styles', sel: '.group-item .name', text: '#33 안 묶음 이름·켜고 끄는 줄 이름(풀이 글은 이름이 아님)', kind: '고침' },
  { n: 35, sheet: 'styles', sel: '.sec-val', text: '단면 상자 값(뒤집음 표시 — 226차부터 뒤집기 버튼 눌림 모양도)', kind: '고침' },
  { n: 36, sheet: 'styles', media: NARROW, sel: '.notice .nt-text', text: '#17 판단 띠 글 두 줄', kind: '펼침', open: ['.notice.open .nt-text', '.notice:has(:focus-visible) .nt-text'] },
  {
    n: 37,
    sheet: 'styles',
    media: NARROW,
    sel: '.notice-bar:has(.notice + .notice) .notice .nt-text, .view:has(.play-strip:not([hidden])) .notice .nt-text',
    text: '#17 판단 띠 글 한 줄',
    kind: '펼침',
    open: ['.notice.open .nt-text', '.notice:has(:focus-visible) .nt-text'],
  },
  { n: 38, sheet: 'vlist', sel: '.vlist-row', text: '#20 코드 목록 줄(가상 목록 — 굴림 셈이 JS 줄 높이에 묶임)', kind: '설계', alt: ['src/app/panel.ts', 'rowHeight: coarse ? 24 : 18'] },
  { n: 39, sheet: 'vlist', sel: '.vlist-row .tx', text: '코드 줄 글 → 고른 줄 원문(패널 아래 띠, 80자까지)', kind: '다른 길', alt: ['src/app/panel.ts', 'selectedLineText(d, 80)'] },
  { n: 40, sheet: 'styles', sel: '.progress', text: '읽는 중 막대', kind: '대상 아님', why: '글 없음' },
  { n: 41, sheet: 'shortcuts', sel: '.sc-live', text: '창을 닫은 뒤 알림', kind: '대상 아님', why: '1화소로 감춘 화면 읽기 전용 영역' },
  // C. px 줄 높이(높이 없는 칸)
  { n: 42, sheet: 'styles', sel: 'kbd', text: '키 글(메뉴·단축키 창)', kind: '높이 없음' },
  { n: 43, sheet: 'styles', sel: '.chip', text: '정보 탭 묶음 수', kind: '높이 없음' },
];
const where = (e: { sheet: Sheet; media?: string; sel: string }): string => `${e.sheet}${e.media ? ` ${e.media}` : ''} ${e.sel}`;

// ───────────────────────── 셈 ─────────────────────────

/** 괄호 밖 빈칸으로 나눈 값 조각 */
const toks = (v: string): string[] => v.trim().split(/\s+(?![^()]*\))/);
/** px 길이(그 밖 0 — 0·env()·var()) */
const len = (v: string | undefined): number => {
  const m = /^(-?[\d.]+)px$/.exec((v ?? '').trim());
  return m ? +m[1]! : 0;
};
/** 테두리 줄임 값의 굵기 */
const bw = (v: string): number => (/^(none|0)(\s|$)/.test(v.trim()) ? 0 : +(/(-?[\d.]+)px/.exec(v)?.[1] ?? 3));
/** 높이와 칸 안 높이(border-box는 위아래 여백·테두리를 뺀다) */
function vertical(m: ReadonlyMap<string, string>): { h: number; inner: number } {
  const h = len(m.get('height'));
  let pt = 0;
  let pb = 0;
  const p = m.get('padding');
  if (p !== undefined) [pt, pb] = ((t) => [len(t[0]), len(t[2] ?? t[0])])(toks(p));
  const pk = m.get('padding-block');
  if (pk !== undefined) [pt, pb] = ((t) => [len(t[0]), len(t[1] ?? t[0])])(toks(pk));
  if (m.has('padding-top')) pt = len(m.get('padding-top'));
  if (m.has('padding-bottom')) pb = len(m.get('padding-bottom'));
  let bt = 0;
  let bb = 0;
  const b = m.get('border');
  if (b !== undefined) bt = bb = bw(b);
  const bwd = m.get('border-width');
  if (bwd !== undefined) [bt, bb] = ((t) => [len(t[0]), len(t[2] ?? t[0])])(toks(bwd));
  if (m.has('border-top')) bt = bw(m.get('border-top')!);
  if (m.has('border-bottom')) bb = bw(m.get('border-bottom')!);
  return { h, inner: m.get('box-sizing') === 'content-box' ? h : h - pt - pb - bt - bb };
}
/** 규칙이 정한 px 글자 크기(없으면 null — 이어받음) */
const fontPx = (m: ReadonlyMap<string, string>): number | null => {
  const fs = m.get('font-size');
  if (fs && /px$/.test(fs)) return parseFloat(fs);
  const x = /([\d.]+)px/.exec(m.get('font') ?? '');
  return x ? +x[1]! : null;
};
/** 그 표 줄의 겹친 선언(바탕 규칙 → 맨 바깥 같은 선택자 → 그 조건) */
const merged = (e: Entry): Map<string, string> =>
  declOf([...(e.also ?? []).flatMap((s) => rulesAt(e.sheet, '', s)), ...(e.media ? rulesAt(e.sheet, '', e.sel) : []), ...rulesAt(e.sheet, e.media ?? '', e.sel)]);
const clips = (m: ReadonlyMap<string, string>): boolean => /ellipsis/.test(m.get('text-overflow') ?? '') || /^(nowrap|pre)$/.test(m.get('white-space') ?? '') || /^(hidden|clip)$/.test(m.get('overflow') ?? '');
/** 글 폭 어림(222차 꼴) — wide면 글 간격을 넓힌 폭 */
const textW = (t: string, fs: number, wide: boolean): number =>
  [...t].reduce((a, ch) => a + fs * ((/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.55) + (wide ? 0.12 + (ch === ' ' ? 0.16 : 0) : 0)), 0);
const firstPx = (v: string | undefined): number => +(/(-?[\d.]+)px/.exec(v ?? '')?.[1] ?? NaN);
/** 좌우 여백 합(줄임 값) */
const hpad = (v: string | undefined): number => {
  const t = toks(v ?? '0');
  return len(t[1] ?? t[0]) + len(t[3] ?? t[1] ?? t[0]);
};
const r2 = (v: number): number => Math.round(v * 100) / 100;

describe('글 간격 감사(225차 — WCAG 1.4.12)', () => {
  it('표 번호는 progress.md 표와 같은 차례이고, 거르는 꼴에 걸리는 규칙은 모두 표에, 표 줄의 규칙은 모두 CSS에 있다', () => {
    expect(TABLE.map((e) => e.n)).toEqual(Array.from({ length: 43 }, (_, i) => i + 1));
    const keys = new Set(TABLE.map(where));
    const outside = [...new Set(RULES.filter(guarded).map((r) => where({ sheet: r.sheet, media: r.media || undefined, sel: r.sel })))].filter((k) => !keys.has(k));
    const stale = TABLE.filter((e) => !rulesAt(e.sheet, e.media ?? '', e.sel).length).map(where);
    expect({ outside, stale }).toEqual({ outside: [], stale: [] });
  });

  it('고정 높이 글 칸(A): 칸 안 높이에 넓힌 줄 높이(1.5 × 글자 크기) 한 줄이 든다 — 끌어온 점 수(23)만 0.5px 넘쳐 보이고 잘리지 않는다', () => {
    const bad: string[] = [];
    const seen: string[] = [];
    for (const e of TABLE.filter((x) => x.kind === '듦' || x.kind === '넘쳐 보임')) {
      const m = merged(e);
      const fs = fontPx(e.fsSel ? decl(e.sheet, e.fsSel) : m);
      if (fs !== null && fs !== e.fs) bad.push(`${e.n} ${where(e)}: 글자 크기 ${fs} ≠ 표 ${e.fs}`);
      const { h, inner } = vertical(m);
      const need = 1.5 * e.fs!;
      if (!(h > 0)) bad.push(`${e.n} ${where(e)}: 고정 높이 없음 — 표가 낡음`);
      else if (e.kind === '듦' && inner < need) bad.push(`${e.n} ${where(e)}: 칸 안 ${inner} < ${need}`);
      else if (e.kind === '넘쳐 보임' && !(inner < need && need - inner <= 1 && !clips(m))) bad.push(`${e.n} ${where(e)}: 넘쳐 보임 판정이 낡음(칸 안 ${inner}·필요 ${need})`);
      seen.push(`${e.n}:${inner}`);
    }
    expect(bad).toEqual([]);
    // 손셈과 같은 칸 안 높이(progress.md A 표)
    expect(seen.join(' ')).toBe(
      '1:43 2:43 3:30 4:36 5:38 6:42 7:36 8:30 9:26 10:36 11:25 12:18 13:34 14:26 15:32 16:26 17:26 18:30 19:38 20:26 21:34 22:24 23:16',
    );
  });

  it('잘리는 칸(B)은 다른 길·펼침·설계가 있고, 대상 아님·높이 없음 판정도 지금 규칙과 맞는다', () => {
    const bad: string[] = [];
    for (const e of TABLE) {
      const m = merged(e);
      if ((e.kind === '다른 길' || e.kind === '설계') && !(e.alt && read(e.alt[0]).includes(e.alt[1]))) bad.push(`${e.n} ${where(e)}: 다른 길(${e.alt?.join(' — ')})이 소스에 없음`);
      if (e.kind === '펼침')
        for (const o of e.open ?? []) {
          const d = decl(e.sheet, o, e.media);
          if (d.get('overflow') !== 'visible' || d.get('display') !== 'block') bad.push(`${e.n} ${where(e)}: 펼친 규칙 ${o}이 없거나 자름`);
        }
      if (e.kind === '대상 아님' && !e.why) bad.push(`${e.n} ${where(e)}: 까닭 없음`);
      if (e.kind === '높이 없음' && (m.has('height') || m.has('max-height'))) bad.push(`${e.n} ${where(e)}: 높이가 생김 — 칸 안 높이를 셈해 A로`);
    }
    // 화면 읽기 전용 영역은 1화소로 잘라 감춘 꼴(hidden 아님 — 207차)
    expect([decl('shortcuts', '.sc-live').get('width'), decl('shortcuts', '.sc-live').get('clip')]).toEqual(['1px', 'rect(0 0 0 0)']);
    expect(bad).toEqual([]);
  });

  it('225차 고침: 넓히면 잘리고 보는 다른 길이 없던 셋은 말줄임 대신 줄을 바꾼다 — 풀이 글(title)이 있는 정보 탭 값 칸·깎기 탭 값 칸은 그대로', () => {
    const fixed = TABLE.filter((e) => e.kind === '고침');
    expect(fixed.map((e) => e.n)).toEqual([33, 34, 35]);
    const bad: string[] = [];
    for (const e of fixed) {
      const d = decl(e.sheet, e.sel, e.media);
      if (!d.size) bad.push(`${e.n} ${e.sel}: 규칙 없음`);
      else if (clips(d) || d.get('overflow-wrap') !== 'anywhere') bad.push(`${e.n} ${e.sel}: 아직 자름(${[...d].map(([k, v]) => `${k}: ${v}`).join('; ')})`);
    }
    expect(bad).toEqual([]);
    // 33은 title 없는 값 칸에만(32 말줄임·title 그대로 — 특정도 0,4,0이 0,2,0을 이김, 깎기 탭 .sim-v는 163차 규칙 그대로)
    expect(decl('styles', FIXED_V).get('white-space')).toBe('normal');
    expect(decl('styles', FIXED_V).get('overflow')).toBe('visible');
    expect([decl('styles', '.prop-row .v').get('text-overflow'), decl('styles', '.prop-row .sim-v').get('white-space')]).toEqual(['ellipsis', 'normal']);
    // title 없는 값 칸 둘: 보정 구간 출처(30차 — 출처를 따로 옮기려고 title을 뺌)·공구 방향 줄(title 없음)
    const info = read('src/app/panel-info.ts');
    expect([info.includes("ve.removeAttribute('title')"), info.includes("h('span', { class: 'v' }, String(r.orientation)")]).toEqual([true, true]);
  });

  it('손셈: 고친 셋은 보통 간격에서 칸에 들고, 글 간격을 넓히면 칸을 넘어 말줄임이면 잘렸다', () => {
    const en = JSON.parse(read('site/locales/en.json')) as Record<string, string>;
    const de = JSON.parse(read('site/locales/de.json')) as Record<string, string>;
    const body = 13;
    // 33: 넓은 화면 패널(380 − 왼쪽 테두리 1 − 몸통 좌우 여백 20 = 359), 값 칸 = 359 − max(96, 42%) − 틈 8
    const panel = decl('styles', '.panel');
    const inner380 = firstPx(panel.get('width')) - firstPx(panel.get('border-left')) - hpad(decl('styles', '.panel-body').get('padding'));
    const cols = /minmax\((\d+)px, (\d+)%\)/.exec(decl('styles', '.prop-row').get('grid-template-columns') ?? '')!;
    const valCol = inner380 - Math.max(+cols[1]!, (+cols[2]! / 100) * inner380) - len(decl('styles', '.prop-row').get('gap'));
    const src = '반지름 0.4 mm (선반 공구 표 T1)';
    expect(read('src/app/panel-info.ts')).toContain("ve.replaceChildren(`반지름 ${fmtNum(r.radius)} ${u}`, ' (', h('span', {}, r.source), ')')");
    // 34: 휴대폰 320(시트 — 왼쪽 테두리 0), 이름 칸 = 300 − 체크 상자 13 − 틈 8 × 2 − 풀이 「다시 읽음」(11px)
    expect(decl('styles', '.panel', NARROW).get('border-left')).toBe('0');
    const inner320 = 320 - hpad(decl('styles', '.panel-body').get('padding'));
    const gap = len(decl('styles', '.group-item').get('gap'));
    const hintFs = len(decl('styles', '.group-item.opt .hint.inline').get('font-size'));
    const nameCol = (wide: boolean): number => inner320 - 13 - 2 * gap - textW(en['다시 읽음']!, hintFs, wide);
    const name = en['꺼진 가공도 그리기']!;
    // 35: 단면 상자(280 − 여백 20 − 테두리 2) − 틈 8 − 뒤집기 버튼(글 + 좌우 여백 16 + 테두리 2)
    const pop = decl('styles', '.sec-pop');
    const small = decl('styles', '.btn.small');
    const popIn = firstPx(pop.get('width')) - hpad(pop.get('padding')) - 2 * bw(pop.get('border') ?? '0');
    const valW = (wide: boolean): number => popIn - len(decl('styles', '.sec-row').get('gap')) - (textW(de['뒤집기']!, body, wide) + hpad(small.get('padding')) + 2 * bw(small.get('border') ?? '0'));
    const sec = de['{0} = {1} (뒤집음)']!.replace('{0}', 'X').replace('{1}', '12,345 mm');
    const secFs = len(decl('styles', '.sec-val').get('font-size'));
    const rows = [
      ['33 보정 구간 출처(ko, 넓은 화면)', textW(src, body, false), valCol, textW(src, body, true), valCol],
      [`34 「${name}」(en, 320)`, textW(name, body, false), nameCol(false), textW(name, body, true), nameCol(true)],
      [`35 「${sec}」(de)`, textW(sec, secFs, false), valW(false), textW(sec, secFs, true), valW(true)],
    ] as const;
    expect(rows.map(([k, a, b, c, d]) => [k, r2(a), r2(b), r2(c), r2(d)])).toEqual([
      ['33 보정 구간 출처(ko, 넓은 화면)', 191.75, 200.22, 240.11, 200.22],
      ['34 「Also draw operations turned off」(en, 320)', 208.65, 222.6, 265.33, 212.04],
      ['35 「X = 12,345 mm (umgedreht)」(de)', 153, 174.8, 196.68, 162.32],
    ]);
    for (const [k, normal, room, wide, roomWide] of rows) {
      expect(normal <= room, `${k}: 보통 간격에서 듦`).toBe(true);
      expect(wide > roomWide, `${k}: 넓히면 넘침`).toBe(true);
    }
  });

  it('코드 목록(38): 줄 높이는 JS가 18px(손가락 24px)로 정하고 12px 고정 폭 글꼴의 넓힌 줄 높이 18px가 든다(여유 0 — 가상 목록 설계)', () => {
    const m = /rowHeight: coarse \? (\d+) : (\d+)/.exec(read('src/app/panel.ts'))!;
    const fs = len(decl('vlist', '.vlist').get('font-size'));
    expect([+m[2]!, +m[1]!, 1.5 * fs]).toEqual([18, 24, 18]);
  });
});
