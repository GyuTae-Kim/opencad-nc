// @vitest-environment jsdom
/**
 * 224차(WCAG 3.1.2 — 220차 묶음 다수 꼴): 화면 글을 코드로 이어 붙이는 문장부호(사전 밖)의 감사와 고침.
 * 번역층은 글 마디마다(조각 목록) 또는 섞은 글 통째(mixSpan — 사전 틀이 맞으면 사전 값이, 아니면 「 · 」·「 — 」로 나눈 조각마다) 옮기고, 문장부호만 든 조각·나눔 글자·
 * 코어 기본 틀(앱 글 함수가 한글 없는 틀이라 넘긴 것)은 옮기지 않는다. 사전 다수 꼴(220차 기준 — 묶음 다수가 3분의 2 이상이고 사전 전체 다수와 같을 때만):
 * 중국어 쌍점 「：」·한자 풀이 괄호 전각(괄호 앞 빈칸 없음), 「 · 」·「 — 」는 중국어·일본어 모두 반각, 일본어 쌍점은 반각, 일본어 괄호는 반반.
 * 그래서 갈리던 자리는 중국어의 넷 — 열기 오류 「이름: 까닭」(openUrl·openBuffer — 202차 남은 일), 그릴 것이 없는 프로그램 알림 「이름: 안내 (해석 경고: N번 줄: 경고 · 모두 N번)」,
 * 가상 커서 후보 알림(코어 기본 틀 「{0}: {1}」) — 이고, 이어 붙임을 틀 열쇠(「{0}: {1}」·「{0} (해석 경고: {1})」·「{0} · {1}번 줄: {2}」·「{0} · 모두 {1}번」, 네 언어)로 옮겼다.
 * 영어·일본어·독일어 값은 조각마다 옮긴 글과 같고(작업 파일 줄 이름만 바로잡힘 — 전에는 「 · N번 줄」 조각을 「{0}번 줄」 틀이 「Line · 2」로 옮김), 한국어 글은 그대로다.
 * 재발 막기: src의 두 grep 꼴(문장부호만 든 조각 글·두 보간 사이 문장부호)이 아래 표 밖에서 새로 생기면 실패한다 — 새 자리는 판정(사전 틀·둠·뺌·고침)과 함께 표에 적는다.
 * 고치기 전: 조각 표 밖 「': '」 조각 넷(app.ts 열기 오류 셋·doc.ts 빈 프로그램 알림)·새 열쇠 없음 — 중국어 「pick.nc: …」·「 (解析警告: 第 3 行: …)」, 가상 커서 「…Z 轴: X 0…」.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as core from 'opencad-viewer3d';
import { keySnapText, orderedText } from 'opencad-viewer3d';
import { catalogs, registerCatalog, translate } from '../../site/i18n.mjs';
import { installLocalization } from '../../src/app/i18n';
import { mixSpan } from '../../src/app/dom';
import { fileText, mix, plainText, type Mixed } from '../../src/app/filetext';
import { emptyProgramParts } from '../../src/app/doc';
import { dictLookup, keySnapMessageFn } from '../../src/app/keysnap';
import { errorText } from '../../src/app/protocol';

const ROOT = resolve(__dirname, '../..');
const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const HANGUL = /[가-힣]/;
const d = (l: string): Record<string, string> => catalogs[l] as Record<string, string>;
const saved = Object.fromEntries(LANGS.map((l) => [l, catalogs[l]]));
/** 224차 새 틀 열쇠 */
const NEW = ['{0}: {1}', '{0} (해석 경고: {1})', '{0} · {1}번 줄: {2}', '{0} · 모두 {1}번'];

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  for (const l of LANGS) registerCatalog(l, saved[l]!);
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

// ───────── src 두 grep 꼴의 표 ─────────
const DIRS = ['src/app', 'src/view', 'src/sim'];
/** (가) 문장부호만 든 조각 글(조각 목록의 글 마디·나눔 글 — 앞이 ( [ , ? : = +, 뒤가 , ) ] + : ; 줄 끝. 객체 열쇠 「'a': 'b'」는 걸리지 않는다) */
const PIECE = /(?:^|[(\[,?:=+])\s*(['`])(?:: |, | \(|\)| · | — )\1\s*(?:[,)\]+:;]|$)/;
/** (나) 두 보간 사이 문장부호(또는 보간 앞 「 (」) — 템플릿 글 안 */
const BETWEEN = /\}(?:: |, | \(| · | — )\$\{| \(\$\{/;
/** [파일, 줄 조각, 줄 수, 판정] */
type Row = [string, string, number, string];
const PIECES: Row[] = [
  ['src/app/filetext.ts', "sep = ' · '", 1, '둠 — joinMixed 기본 나눔(재생 상태 modal), 두 언어 「 · 」 다수'],
  ['src/app/app.ts', "bad.join(', ')", 3, '뺌 — 파일 이름 목록(파일 글 칸)'],
  ['src/app/app.ts', "statusParts(d).join(' · ')", 1, '둠 — 상태 줄'],
  ['src/app/app.ts', "...(sp ? [' · ', h('span', {}, sp[0])", 1, '둠 — 상태 줄 스냅 짝'],
  ['src/app/app.ts', "...(lock ? [' · ', h('span', { class: 'st-lock' }, lock)]", 1, '둠 — 상태 줄 잠금'],
  ['src/app/app.ts', "t.append(h('span', { class: 'mb-sub mb-snap' }", 1, '둠 — 측정 띠 스냅 짝'],
  ['src/app/doc.ts', "motion: parts.join(' · ')", 1, '둠 — 재생 상태'],
  ['src/app/panel.ts', "if (sp) lines.push(h('div', { class: 'dim' }, h('span', {}, sp[0])", 1, '둠 — 패널 측정 스냅 짝'],
  ['src/app/panel-info.ts', "detail.flatMap((t, i) => [i ? ' · ' : null", 1, '둠 — 판재 가공 표 상세 칸'],
  ['src/app/panel-info.ts', "job.skipped.join(', ')", 1, '뺌 — 파일 이름 목록'],
  ['src/app/panel-info.ts', "missing.join(', ')", 1, '뺌 — 프로그램 이름 목록'],
  ['src/app/panel-info.ts', 've.replaceChildren(`반지름', 1, '둠 — 보정 구간 「반지름 (출처)」 괄호, 정보·공구 탭 묶음 반반(220차 16 : 14)'],
  ['src/app/panel-info.ts', "String(r.orientation), ' · '", 1, '둠 — 선반 공구 방향 「번호 · 출처」'],
  ['src/app/measure-lock.ts', "this.tip.replaceChildren(h('span', {}, tip.name)", 1, '둠 — 측정 툴팁 「이름 · 잠금」'],
  ['src/app/notices.ts', "(n.hints ?? []).join(' · ')", 1, '뺌 — G 코드(사전 틀이 잡은 값)'],
  ['src/app/notices.ts', "n.programs.join(', ')", 1, '뺌 — 프로그램 이름 목록'],
  ['src/app/sim.ts', "s.name.replaceChildren(h('span', {}, `가공", 1, '둠 — 깎기 따라가기 「가공 N · 이름」'],
];
const BETWEENS: Row[] = [
  ['src/app/app.ts', '`${formatBytes(e.size)} · ${formatRecentTime', 1, '둠 — 최근 문서 크기·시각(translate="no" 칸)'],
  ['src/app/app.ts', '}: ${BINARY_MESSAGE}`', 2, '사전 틀 — 「{0}: 글 파일이 아닌 …」(값이 꼴을 정함)'],
  ['src/app/app.ts', '}: ${errorText(e)}`)', 2, '224차 틀 「{0}: {1}」 — 열기 오류 「이름: 까닭」(openUrl·openBuffer)'],
  ['src/app/app.ts', '}: ${emptyProgramParts(res)}`)', 1, '224차 틀 「{0}: {1}」 — 그릴 것이 없는 프로그램 알림'],
  ['src/app/app.ts', 's.state.replaceChildren(...mixNodes(st ? mix`${st.motion}', 1, '둠 — 재생 띠 상태'],
  ['src/app/doc.ts', 'mix`${fileText(j.file)} · ${j.local}번 줄`', 1, '사전 틀 — 「{0} · {1}번 줄」'],
  ['src/app/doc.ts', 'arc = `중심 ${fmtPt(c)} · R', 1, '둠 — 원호 「중심 · R · 방향」'],
  ['src/app/doc.ts', 'return mix`${head} · ${moveSummary', 1, '둠 — 고른 것 요약'],
  ['src/app/doc.ts', 'mix`가공 ${op.index + 1} · ${opLabel(d, op)}', 1, '둠 — 고른 가공 요약'],
  ['src/app/doc.ts', 'mix`${itemName(d, p.id, item?.name, item?.group)} · ${fmtPt', 1, '둠 — 고른 것 요약'],
  ['src/app/keysnap.ts', 'mix`${lineLabel(d, line)} · ${moveSummary', 1, '둠 — 가상 커서 고르기 이름'],
  ['src/app/keysnap.ts', 'mix`가공 ${op.index + 1} · ${opLabel(d, op)}', 1, '둠 — 가상 커서 고르기 이름'],
  ['src/app/format.ts', '`${fmtNum(p[0])}, ${fmtNum(p[1])}', 1, '뺌 — 좌표 수(숫자 단위)'],
  ['src/app/measure.ts', '`잠근 ${base} · ${t === ', 1, '둠 — 측정 잠금 이름'],
  ['src/app/measure.ts', 'return `${a} · ${tracked === ', 1, '둠 — 측정 끌어온 점 이름'],
  ['src/app/measure.ts', '`끌어온 점에서 ${a} · ${tracked === ', 1, '둠 — 측정 끌어온 점 이름'],
  ['src/app/panel.ts', 'p.state.replaceChildren(...mixNodes(mix`${st.motion}', 1, '둠 — 패널 재생 상태'],
  ['src/app/payload.ts', '`${job.files[k]} · ${k ?', 1, '뺌 — 작업 파일 이름 · 줄 수'],
  ['src/app/measure-lock.ts', 'TRACK_PERPENDICULAR_LABEL} · ${MEET_AT[m]} 위`', 1, '둠 — 측정 만나는 점 이름'],
  ['src/app/measure-lock.ts', '`${head} · ${now}`', 1, '둠 — 잠금 글 · 코어 다시 구한 알림(가상 커서 알림 영역)'],
  ['src/app/panel-info.ts', 'tr.title = `${tr.title} · ${cutRangeText', 1, '둠 — 공구 줄 풍선'],
  ['src/app/panel-info.ts', '`${st.grooves ?? 0} · ${st.pockets ?? 0}`', 1, '둠 — 정보 탭 셈 줄(수)'],
  ['src/app/panel-info.ts', '`자동 (${NC_DIALECT_NAMES[nc.dialect]})`', 1, '사전 틀 — 「자동 ({0})」'],
  ['src/app/panel-info.ts', 'r.source ? ` (${r.source})`', 1, '둠 — 보정 구간 반지름(그린 뒤 조각으로 바뀜 — 정보·공구 탭 괄호 반반)'],
  ['src/app/panel-info.ts', "row('G-code 형식 · 단위'", 1, '둠 — 정보 탭 셈 줄'],
  ['src/app/panel-info.ts', "row('줄 · 실행 블록'", 1, '둠 — 정보 탭 셈 줄(수)'],
  ['src/app/panel-info.ts', "row('이송 · 급속 · 휴지'", 1, '둠 — 정보 탭 셈 줄(시간)'],
  ['src/app/panel-info.ts', "row('공구 교환 · 원호 · 구멍'", 1, '둠 — 정보 탭 셈 줄(수)'],
  ['src/app/panel-info.ts', "`${label} — ${'XYZ'[a]}`", 1, '둠 — 소재 칸 이름 「이름 — X」(두 언어 「 — 」 다수)'],
  ['src/app/panel-info.ts', '`자동 (${read} 체계)`', 1, '사전 틀 — 「자동 (A 체계)」 등'],
  ['src/app/sim.ts', '`자동 (${autoN})`', 1, '사전 틀 — 「자동 ({0})」'],
];

/** 그 꼴에 걸리는 src 줄(주석 줄 뺌) */
function sites(re: RegExp): { file: string; line: string }[] {
  const out: { file: string; line: string }[] = [];
  for (const dir of DIRS)
    for (const n of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.ts')).sort())
      for (const line of readFileSync(join(ROOT, dir, n), 'utf8').split('\n'))
        if (!/^\s*(?:\/\/|\*|\/\*)/.test(line) && re.test(line)) out.push({ file: `${dir}/${n}`, line: line.trim() });
  return out;
}
function checkTable(re: RegExp, table: Row[]): void {
  const found = sites(re);
  const stray = found.filter((s) => !table.some(([f, snip]) => f === s.file && s.line.includes(snip)));
  expect(stray.map((s) => `${s.file}: ${s.line}`)).toEqual([]);
  const off = table.map(([f, snip, n]) => [f, snip, found.filter((s) => s.file === f && s.line.includes(snip)).length, n] as const).filter(([, , got, n]) => got !== n);
  expect(off).toEqual([]);
}

/** 224차 앞 꼴(조각마다 글 마디 — 번역층이 따로 옮기고 사이 글은 그대로)로 지은 글. zh면 사이 글 「: 」·「 (」·「)」를 묶음 다수 꼴로 바꾼 기대 */
const ZH: Record<string, string> = { ': ': '：', ' (': '（', ')': '）' };
const pieced = (parts: string[], l: string, zh = false, ui = false): string => parts.map((p) => (zh && ZH[p] !== undefined ? ZH[p] : translate(p, l, ui))).join('');

const EMPTY = '그릴 공구 경로를 찾지 못했습니다. 이동 명령(G0·G1·L 등)이 없는 프로그램일 수 있습니다.';
/** 「 — 」가 든 경고(사전 틀 「CALL PGM {0}: …」)와 나눔 글자가 없는 경고(「단위 코드(G20/G21)가 없어 {0}로 봄」) */
const T1 = 'CALL PGM SUB: 프로그램을 찾지 못함 — 다른 파일이면 함께 열어야 읽음';
const T2 = '단위 코드(G20/G21)가 없어 mm로 봄';
type Res = Parameters<typeof emptyProgramParts>[0];
const item = (text: string, line: number, count: number): Res => ({ scene: {}, job: null, nc: { warnItems: [{ text, line, count, lines: [line] }] } }) as unknown as Res;

async function at(lang: string): Promise<void> {
  history.replaceState(null, '', lang === 'ko' ? '/opencad-nc/' : `/opencad-nc/${lang}/`);
  document.body.innerHTML = '<div id="app"></div>';
  dispose = await installLocalization(document.getElementById('app')!);
}
/** 시작 화면 오류 칸·알림 상자가 그리는 칸(app.ts errorNodes — 틀이 잡은 앱 글까지 그릴 때 언어로) */
const shown = (m: Mixed): string => mixSpan(m, undefined, true).textContent ?? '';

describe('224차: 화면 글을 코드로 이어 붙이는 문장부호 — 사전 다수 꼴', () => {
  it('src의 두 grep 꼴(문장부호만 든 조각 글 19줄·두 보간 사이 33줄)이 표와 같다 — 새 자리는 판정과 함께 표에(갈리면 틀 열쇠로)', () => {
    checkTable(PIECE, PIECES);
    checkTable(BETWEEN, BETWEENS);
    expect([PIECES.reduce((n, r) => n + r[2], 0), BETWEENS.reduce((n, r) => n + r[2], 0)]).toEqual([19, 33]);
  });

  it('둔 까닭과 고친 까닭의 사전 다수 꼴, 새 틀 열쇠 넷의 네 언어 값(중국어는 묶음 다수 꼴, 다른 언어는 조각마다 옮긴 글과 같은 꼴)', () => {
    // 「 · 」·「 — 」가 든 열쇠의 값: 두 언어 모두 3분의 2 넘게 반각 그대로 — 나눔 글자로 이은 자리는 둠
    const keep = (l: string, sep: string): number => {
      const v = Object.entries(d(l)).filter(([k]) => k.includes(sep)).map(([, x]) => x);
      return v.filter((x) => x.includes(sep)).length / v.length;
    };
    for (const l of ['ja', 'zh-CN']) for (const sep of [' · ', ' — ']) expect(keep(l, sep), `${l} ${sep}`).toBeGreaterThanOrEqual(2 / 3);
    // 쌍점: 중국어는 「：」 다수(갈림 — 고침), 일본어는 반각 다수(둠)
    const full = (l: string): number => {
      const v = Object.values(d(l));
      const f = v.filter((x) => x.includes('：')).length;
      return f / (f + v.filter((x) => x.includes(': ')).length);
    };
    expect(full('zh-CN')).toBeGreaterThanOrEqual(2 / 3);
    expect(full('ja')).toBeLessThanOrEqual(1 / 3);
    // 한자·가나가 든 풀이 괄호: 중국어는 전각 다수(괄호 앞 빈칸 0), 일본어는 반반(둠)
    const W = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}]';
    const fullParen = (l: string): number => {
      const v = Object.values(d(l));
      const f = v.filter((x) => new RegExp(`（[^（）]*${W}[^（）]*）`, 'u').test(x)).length;
      return f / (f + v.filter((x) => new RegExp(`\\([^()]*${W}[^()]*\\)`, 'u').test(x)).length);
    };
    expect(fullParen('zh-CN')).toBeGreaterThanOrEqual(2 / 3);
    expect(fullParen('ja')).toBeGreaterThan(1 / 3);
    expect(fullParen('ja')).toBeLessThan(2 / 3);
    expect(Object.values(d('zh-CN')).filter((v) => v.includes(' （'))).toEqual([]);
    // 새 열쇠 넷
    expect(NEW.map((k) => d('zh-CN')[k])).toEqual(['{0}：{1}', '{0}（解析警告：{1}）', '{0} · 第 {1} 行：{2}', '{0} · 共 {1} 次']);
    for (const l of ['en', 'ja', 'de'])
      expect(NEW.map((k) => d(l)[k]), l).toEqual(['{0}: {1}', `{0} (${d(l)['해석 경고']}: {1})`, `${d(l)['{0} · {1}번 줄']}: {2}`, `{0} · ${d(l)['모두 {0}번']!.replace('{0}', '{1}')}`]);
  });

  it('새 틀 열쇠 넷이 다른 글(사전 열쇠·앱 소스 한글 글)의 번역을 바꾸지 않는다 — 사전 열쇠 0, 소스 글은 옮기지 못한 「A: B」 글의 빈칸 모음·중국어 쌍점과 고친 자리뿐(keysnap 56차 꼴)', () => {
    // 「{0}: {1}」은 한글 없는 틀이라 번역기가 「A: B」 글 모두의 마지막 틀이 된다(가장 짧은 틀이라 다른 틀 뒤에, 잡은 값에 나눔 글자와 한글이 들면 미룸).
    // 옮기지 못한 글(사전에 없는 「A: B」)은 전에는 그대로 돌려받았고 이제는 틀을 채운 글 — 잡은 값 그대로라 영어·일본어·독일어는 빈칸만 하나로 모이고(번역층은 앞뒤 빈칸을 되붙인다),
    // 중국어는 그 쌍점이 「：」. 그런 글은 화면 글이면 다른 언어에 한국어가 남은 것(i18n-screens199 등이 잡는다) — 아래는 소스의 따옴표 짝이 어긋난 코드 조각뿐이다(224차 첫 실행 영어 5)
    const keys = new Set<string>();
    for (const k of Object.keys(d('en'))) {
      if (NEW.includes(k)) continue;
      if (!/\{\d+\}/.test(k)) keys.add(k);
      for (const f of ['12', 'T1', '공구', '끝점', 'X']) keys.add(k.replace(/\{\d+\}/g, f));
    }
    const src = new Set<string>();
    for (const dir of ['src/app', 'src', 'src/view', 'src/sim'])
      for (const n of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.ts'))) {
        for (const m of readFileSync(join(ROOT, dir, n), 'utf8').matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
          const t = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, '7');
          if (!HANGUL.test(t) || t.length > 300) continue;
          for (const piece of [t, ...t.split(/ · |\n/)]) if (HANGUL.test(piece) && !keys.has(piece)) src.add(piece);
        }
      }
    expect(keys.size + src.size).toBeGreaterThan(3000);
    const own = NEW.map((k) => new RegExp('^' + k.split(/\{\d+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$'));
    const hangul = (s: string): number => (s.match(/[가-힣]/g) ?? []).length;
    const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();
    const diff = (list: string[], l: string): (readonly [string, string, string])[] => {
      registerCatalog(l, Object.fromEntries(Object.entries(saved[l]!).filter(([k]) => !NEW.includes(k))));
      const before = list.map((t) => translate(t, l));
      registerCatalog(l, saved[l]!);
      return list.map((t, i) => [t, before[i]!, translate(t, l)] as const).filter(([, b, a]) => b !== a);
    };
    for (const l of LANGS) {
      expect(diff([...keys], l), `${l} 사전 열쇠`).toEqual([]);
      const changed = diff([...src], l);
      // 옮기지 못한 글(전과 같은 한글 수)의 빈칸 모음 — 중국어는 첫 쌍점 「：」도. 고친 자리(새 틀 꼴의 소스 글)는 다 옮겨진 쪽
      const ok = ([t, b, a]: readonly [string, string, string]): boolean =>
        own.some((re) => re.test(flat(t))) || (hangul(a) === hangul(b) && hangul(b) > 0 && a === (l === 'zh-CN' ? flat(b).replace(': ', '：') : flat(b)));
      expect(changed.filter((c) => !ok(c)), l).toEqual([]);
      // 영어·일본어·독일어는 빈칸이 고르지 않은 조각만(224차 영어 5). 중국어는 옮기지 못한 「A: B」 조각 모두의 첫 쌍점이라 수가 크다(224차 73 — 주석·코드 조각의 따옴표 짝) — 수 한도 없음
      if (l !== 'zh-CN') expect(changed.length, l).toBeLessThan(20);
    }
  });

  it('열기 오류 「이름: 까닭」과 그릴 것이 없는 프로그램 알림: 중국어는 「：」·「（…）」(괄호 앞 빈칸 없음), 영어·일본어·독일어는 조각마다 옮기던 글 그대로, 한국어 글 그대로 — 다섯 언어 화면', async () => {
    const CORE = '이 브라우저는 WebGL2를 지원하지 않아 3D 보기를 열 수 없습니다';
    const opens: [Mixed, string[], boolean][] = [
      [mix`${fileText('pick.nc')}: ${errorText(new Error('파일을 받지 못했습니다(HTTP 404).'))}`, ['pick.nc', ': ', '파일을 받지 못했습니다(HTTP 404).'], true],
      [mix`${fileText('pick.nc')}: ${errorText(new TypeError('Failed to fetch'))}`, ['pick.nc', ': ', '파일을 받지 못했습니다(네트워크 오류).'], true],
      [mix`${fileText('pick.MPF')}: ${errorText(new Error(`3D 보기를 만들지 못했습니다: ${CORE}`))}`, ['pick.MPF', ': ', `3D 보기를 만들지 못했습니다: ${CORE}`], true],
    ];
    const empties: [Res, string[]][] = [
      [item(T1, 2, 1), ['sub.h', ': ', EMPTY, ' (', '해석 경고', ': ', '3번 줄', ': ', T1, ')']],
      [item(T1, 2, 3), ['sub.h', ': ', EMPTY, ' (', '해석 경고', ': ', '3번 줄', ': ', T1, ' · ', '모두 3번', ')']],
      [item(T2, 0, 2), ['sub.h', ': ', EMPTY, ' (', '해석 경고', ': ', '1번 줄', ': ', T2, ' · ', '모두 2번', ')']],
      [item(T2, -1, 1), ['sub.h', ': ', EMPTY, ' (', '해석 경고', ': ', T2, ')']],
      [{ scene: { warnings: [T2] }, job: null } as unknown as Res, ['sub.h', ': ', EMPTY, ' (', '해석 경고', ': ', T2, ')']],
      [{ scene: {}, job: null } as unknown as Res, ['sub.h', ': ', EMPTY]],
    ];
    const msgs: [Mixed, string[], boolean][] = [...opens, ...empties.map(([res, parts]) => [mix`${fileText('sub.h')}: ${emptyProgramParts(res)}`, parts, false] as [Mixed, string[], boolean])];
    // 작업 파일 줄(여러 파일 — 둘째 파일 sub.h의 2번 줄): 전에는 「 · 2번 줄」 조각을 「{0}번 줄」 틀이 「第 · 2 行」·「Line · 2」로 옮겼다
    const job = { scene: {}, job: { main: 'main.h', files: ['main.h', 'sub.h'], starts: [0, 10], skipped: [] }, nc: { warnItems: [{ text: T1, line: 12, count: 2, lines: [12] }] } } as unknown as Res;
    const jobMsg = mix`${fileText('main.h')}: ${emptyProgramParts(job)}`;
    for (const lang of ['ko', ...LANGS]) {
      await at(lang);
      for (const [m, parts, ui] of msgs) {
        const got = shown(m);
        if (lang === 'ko') expect([got, plainText(m)]).toEqual([parts.join(''), parts.join('')]);
        else if (lang === 'zh-CN') expect(got, parts.join('')).toBe(pieced(parts, lang, true, ui));
        else expect(got, `${lang}: ${parts.join('')}`).toBe(pieced(parts, lang, false, ui));
        expect(HANGUL.test(got), `${lang}: ${got}`).toBe(lang === 'ko');
      }
      const line = lang === 'ko' ? 'sub.h · 2번 줄' : d(lang)['{0} · {1}번 줄']!.replace('{0}', 'sub.h').replace('{1}', '2');
      const sep = lang === 'zh-CN' ? '：' : ': ';
      const tail = lang === 'ko' ? '모두 2번' : d(lang)['모두 {0}번']!.replace('{0}', '2');
      const warn = `${line}${sep}${translate(T1, lang)} · ${tail}`;
      expect(shown(jobMsg), lang).toBe(
        lang === 'ko' ? `main.h: ${EMPTY} (해석 경고: ${warn})` : lang === 'zh-CN' ? `main.h：${translate(EMPTY, lang)}（${d(lang)['해석 경고']}：${warn}）` : `main.h: ${translate(EMPTY, lang)} (${d(lang)['해석 경고']}: ${warn})`,
      );
      dispose!();
      dispose = undefined;
    }
  });

  it('가상 커서 후보 알림(코어 기본 틀 「{0}: {1}」): 중국어는 같은 틀 열쇠로 「：」 — 같은 알림의 거리 있는 후보(사전 틀)와 같은 쌍점, 다른 언어는 지금처럼 코어 기본(같은 글)', () => {
    const M = (l: string) => keySnapMessageFn(core, dictLookup(l));
    expect(keySnapText(M('zh-CN'), 'candidate', ['锁定线上的Z 轴', 'X 0, Y 0, Z 1'])).toBe('锁定线上的Z 轴：X 0, Y 0, Z 1');
    expect([orderedText('端点', 0, 2, 'X 1, Y 2, Z 3', null, M('zh-CN')), orderedText('端点', 0, 2, 'X 1, Y 2, Z 3', '5 mm', M('zh-CN'))]).toEqual(['端点 1/2：X 1, Y 2, Z 3', '端点 1/2：X 1, Y 2, Z 3，距离 5 mm']);
    for (const l of ['ko', 'en', 'ja', 'de']) expect(M(l)('candidate', ['a', 'b']), l).toBeUndefined();
    // 한글 없는 다른 틀(차례·점·고르기·키 안내 나눔)은 사전에 없어 네 언어 모두 코어 기본
    for (const l of LANGS) for (const k of ['order', 'point', 'pickItem', 'hintJoin'] as const) expect(M(l)(k, ['a', 'b', 'c']), `${l}: ${k}`).toBeUndefined();
  });
});
