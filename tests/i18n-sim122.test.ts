/**
 * 122차: 깎기(소재 깎기 시뮬레이션) 탭과 그 탭이 쓰는 공용 글(공구 표·G-code 재생 띠·소재 범위 칸)의 네 언어 번역을 코드가 하는 일(가공 뜻)과 대조해,
 * 뜻이 어긋난 줄을 같은 사전 안의 번역으로 고치고 사전에 없어 네 언어 모두 한국어로 남던 공구 표 칸 이름을 더했다(README 개발 122차 문단).
 * 예: 공구 없음 No tools(공구가 하나도 없다는 뜻 — 같은 사전 「공구 없음 종류」 Type (no tool)), 재생 멈춤 再生停止(그만두기 — 같은 사전 「재생 / 멈춤」 一時停止),
 * 일본어 「앞으로 감기」 早送り(이 사전에서 早送り는 모두 급속 rapid — 같은 탭의 급속 줄과 겹침), 독일어 최대 Maximal(형용사 — 같은 사전 「최대가 최소보다」 das Maximum).
 * 공구 표 칸 이름은 `${이름} 모서리 R`·`${이름} 끝 각(도)`(src/app/sim.ts aria-label)이라 이름이 「공구 없음」·「—」이면 맞는 틀이 없었다.
 */
import { describe, expect, it } from 'vitest';
import { catalogs, translate } from '../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const dict = (lang: string): Record<string, string> => catalogs[lang] as Record<string, string>;
const PLAY_HINT = '재생 막대를 따라 공구가 소재를 깎은 모양을 그립니다(앞으로 감기는 이어서, 되감기는 저장점에서 다시 계산).';

describe('깎기 탭 번역(122차)', () => {
  it('옛 오역 낱말이 다시 들어오지 않는다', () => {
    // [열쇠에 든 말, 언어, 없어야 할 말]
    const bans: [term: string, lang: string, ban: RegExp][] = [
      ['공구 없음', 'en', /\bNo tools\b/],
      ['재생 멈춤', 'ja', /再生停止/],
      ['앞으로 감기', 'ja', /早送り/],
      ['최대', 'de', /\bMaximal\b/],
    ];
    for (const [term, lang, ban] of bans)
      for (const [key, value] of Object.entries(dict(lang))) {
        if (!key.includes(term)) continue;
        expect(value, `${lang}: ${key}`).not.toMatch(ban);
      }
  });

  it('고친 줄은 같은 사전의 낱말을 쓴다', () => {
    expect(dict('en')['공구 없음']).toBe('No tool');
    expect(dict('ja')['재생 멈춤']).toBe('再生を一時停止');
    expect(dict('ja')[PLAY_HINT]).toContain('先へ進めると続きから、巻き戻すと保存点から再計算');
    expect(dict('de')['최대']).toBe('Maximum');
    expect(translate('X 범위 — 최대', 'de')).toBe('X-Bereich — Maximum');
  });

  it('공구 표 칸 이름(공구 없음·이름 없는 공구의 모서리 R·끝 각)을 네 언어로 옮긴다', () => {
    for (const lang of LANGS)
      for (const text of ['공구 없음 모서리 R', '공구 없음 끝 각(도)', '— 모서리 R', '— 끝 각(도)'])
        expect(translate(text, lang), `${lang}: ${text}`).not.toMatch(/[가-힣]/);
    expect(LANGS.map((lang) => translate('공구 없음 모서리 R', lang))).toEqual(['Corner radius (no tool)', 'コーナーR（工具なし）', '圆角半径（无刀具）', 'Eckenradius (kein Werkzeug)']);
    expect(LANGS.map((lang) => translate('공구 없음 끝 각(도)', lang))).toEqual(['Tip angle (degrees, no tool)', '先端角（度、工具なし）', '刃尖角（度，无刀具）', 'Spitzenwinkel (Grad, kein Werkzeug)']);
    expect(LANGS.map((lang) => translate('— 모서리 R', lang))).toEqual(['— corner radius', '— のコーナーR', '— 圆角半径', '— Eckenradius']);
  });

  it('번호 있는 공구·이미 있던 칸 이름은 그대로', () => {
    expect(translate('T3 모서리 R', 'en')).toBe('T3 corner radius');
    expect(translate('T3 끝 각(도)', 'zh-CN')).toBe('T3 刃尖角(度)');
    expect(translate('구멍 Ø8 끝 각(도)', 'ja')).toBe('穴 Ø8 先端角(度)');
    expect(translate('공구 없음 종류', 'de')).toBe('Typ (kein Werkzeug)');
    expect(translate('X 범위 — 최소', 'de')).toBe('X-Bereich — Minimum');
  });
});
