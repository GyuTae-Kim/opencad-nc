/**
 * 184차: 이름 안의 보이는 글(WCAG 2.5.3 Label in Name)을 번역 뒤에도 — 보이는 글과 화면 읽기 이름(aria-label)이 다른 원문 열쇠인 칸은
 * 번역층이 둘을 따로 옮겨(src/app/i18n.ts — 글 마디·aria-label을 따로 translate) 한국어에서는 품던 이름이 한 언어에서만 보이는 글을 품지 않을 수 있다.
 * 183차 감사 표의 짝(보이는 글 열쇠 ↔ 이름 열쇠)을 실제 칸 글로 적어 두고, 다섯 언어에서 이름이 보이는 글(그 칸 몫 조각)을 품는지 본다.
 * 고친 것은 사전 값만(원문·코드 그대로): 일본어 투영 「원근」 遠近法 ↔ 遠近投影…, 독일어 「원근」 Perspektive ↔ Perspektivische Projektion …,
 * 독일어 재생 「멈춤」 Pause ↔ Wiedergabe pausieren, 영어·중국어 깎기 공구 표 머리 「모서리 R」 Corner R·圆角 R ↔ 칸 이름 corner radius·圆角半径.
 */
import { describe, expect, it } from 'vitest';
import { catalogs, translate } from '../site/i18n.mjs';

const LANGS = ['ko', 'en', 'ja', 'zh-CN', 'de'] as const;
const dict = (lang: string): Record<string, string> => catalogs[lang] as Record<string, string>;

/** 보이는 글에서 그 칸 몫: 통째, 줄 이름·열 머리의 앞/뒤 조각(「 · 」·「・」·「 — 」로 가름), 단위 괄호를 뺀 낱말 */
type Part = 'whole' | 'front' | 'back' | 'word';
const pieces = (text: string): string[] => text.split(/\s+[·—]\s+|\s*・\s*/);
const part = (text: string, which: Part): string =>
  which === 'front' ? pieces(text)[0]! : which === 'back' ? pieces(text).at(-1)! : which === 'word' ? text.replace(/\s*[(（][^()（）]*[)）]$/, '') : text;

/**
 * 이름이 보이는 글을 품는지(대소문자 무시 — 독일어 합성어 안 Parallel ⊂ Parallelprojektion도 183차처럼 품음).
 * 보이는 글이 한 글자 낱말(줄임 「R」)로 끝나면 이름에서 그 뒤가 글자로 이어지지 않아야 한다(「Corner R」이 「corner radius」의 글자에만 겹치는 것은 품음이 아님)
 */
function holds(name: string, visible: string): boolean {
  const n = name.toLowerCase();
  const v = visible.toLowerCase();
  const short = /(?:^|[^a-z])[a-z]$/.test(v);
  for (let i = n.indexOf(v); i >= 0; i = n.indexOf(v, i + 1)) if (!short || !/[\p{L}\p{N}]/u.test(n[i + v.length] ?? '')) return true;
  return false;
}

// [칸, 보이는 글(한국어 원문 — 실제 칸 글), 몫, 이름(한국어 원문)]
const PAIRS: [place: string, visible: string, which: Part, name: string][] = [
  ['설정 버튼', '설정', 'whole', '앱 설정'],
  ['투영 버튼(원근)', '원근', 'whole', '원근 투영(누르면 평행)'],
  ['투영 버튼(평행)', '평행', 'whole', '평행 투영(누르면 원근)'],
  ['재생 버튼(멈춤)', '멈춤', 'whole', '재생 멈춤'],
  ['깎기 탭 끝까지', '끝까지', 'whole', '모든 가공 깎기(끝까지)'],
  ['선반 공구 표 노즈 R', 'T1 노즈 R(mm) · 방향', 'front', 'T1 노즈 R(mm)'],
  ['선반 공구 표 방향', 'T1 노즈 R(mm) · 방향', 'back', 'T1 공구 방향'],
  ['선반 G 코드', '선반 G 코드', 'whole', '선반 G 코드 체계'],
  ['코드 찾기 칸(자리 글)', '찾기 — T5 · G43 · N100 · :120(줄로 가기)', 'front', '코드에서 찾기'],
  ...['G54 원점의 기계 좌표(mm)', 'G28 기준점 기계 좌표(mm)', '허용 범위 최소(mm)', '허용 범위 최대(mm)'].flatMap((row) =>
    ['X', 'Y', 'Z'].map((a): [string, string, Part, string] => [`기계·읽기 설정 ${a}`, row, 'whole', `${row} — ${a}`]),
  ),
  ...['X 범위', 'Y 범위', 'Z 범위(바닥 ~ 윗면)'].flatMap((row) =>
    ['최소', '최대'].map((m): [string, string, Part, string] => [`소재 범위 ${m}`, row, 'whole', `${row} — ${m}`]),
  ),
  ...['T3', '공구 없음', '—', '구멍 Ø8', '경로 Ø12', '경로(지름 모름)', 'BULL_D10'].flatMap((tool): [string, string, Part, string][] => [
    [`깎기 공구 표 ${tool} 종류`, '종류', 'whole', `${tool} 종류`],
    [`깎기 공구 표 ${tool} 지름`, '지름(mm)', 'word', `${tool} 지름`],
    [`깎기 공구 표 ${tool} 모서리 R`, '모서리 R · 끝 각', 'front', `${tool} 모서리 R`],
    [`깎기 공구 표 ${tool} 끝 각`, '모서리 R · 끝 각', 'back', `${tool} 끝 각(도)`],
  ]),
];

// 184차에 고친 값: [언어, 열쇠, 값, 같은 사전의 근거 열쇠, 근거 값이 품는 낱말]
const FIXED: [lang: string, key: string, value: string, basis: string, word: string][] = [
  ['ja', '원근', '透視', '투영: 원근 ↔ 평행', '透視'],
  ['ja', '원근 투영(누르면 평행)', '透視投影（押すと平行投影に切り替え）', '원근 투영', '透視投影'],
  ['de', '원근 투영(누르면 평행)', 'Perspektive (Parallelprojektion durch Drücken)', '평행 투영(누르면 원근)', 'Perspektive durch Drücken'],
  ['de', '재생 멈춤', 'Pause (Wiedergabe)', '재생 / 멈춤 (Space)', 'Wiedergabe/Pause'],
  ['en', '모서리 R · 끝 각', 'Corner radius · tip angle', '{0} 모서리 R', 'corner radius'],
  ['zh-CN', '모서리 R · 끝 각', '圆角半径 · 刃尖角', '{0} 모서리 R', '圆角半径'],
];

describe('이름 안의 보이는 글 — 번역 뒤에도(184차)', () => {
  it('보이는 글 열쇠와 이름 열쇠가 다른 칸은 다섯 언어 모두 이름이 보이는 글(그 칸 몫)을 품는다', () => {
    expect(PAIRS).toHaveLength(55);
    const misses: string[] = [];
    for (const lang of LANGS)
      for (const [place, visible, which, name] of PAIRS) {
        const shown = part(translate(visible, lang), which);
        const said = translate(name, lang);
        // 옮기지 못해 한국어가 남으면 짝을 볼 수 없다 — 그것도 어긋남으로 센다
        if ((lang !== 'ko' && /[가-힣]/.test(shown + said)) || !holds(said, shown)) misses.push(`${lang} ${place}: 「${shown}」 ⊄ 「${said}」`);
      }
    expect(misses).toEqual([]);
  });

  it('고친 값은 같은 사전의 낱말이고 그 언어의 다른 열쇠와 같은 값이 아니다', () => {
    for (const [lang, key, value, basis, word] of FIXED) {
      expect(dict(lang)[key], `${lang}: ${key}`).toBe(value);
      expect(dict(lang)[basis], `${lang}: ${basis}`).toContain(word);
      expect(Object.entries(dict(lang)).filter(([k, v]) => k !== key && v === value).map(([k]) => k), `${lang}: ${value}`).toEqual([]);
    }
  });
});
