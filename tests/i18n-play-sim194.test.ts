/**
 * 194차: 재생·깎기 시뮬레이션 묶음(도구 막대 「재생」, 패널 재생 막대, 3D 보기 아래 재생 띠, 판재 가공 하나씩 따라가기, 깎기 탭 격자·상태 줄)의 네 언어 번역을
 * 같은 사전 안의 낱말과 대조했다. 한 기능의 버튼 보이는 글·풍선 글·이름·바로 가기 줄은 한 낱말을 쓴다(WCAG 2.5.3 음성 입력 — 183·184차 꼴).
 * 고친 것은 사전 값과 새 틀 하나(원문·코드 그대로):
 * 패널 「처음」 영어 First·독일어 Erste(서수 뜻) → Start·Anfang(「처음으로」 Go to start·Zum Anfang), 「처음으로」 일본어 先頭へ·중국어 到开始 → 最初へ·到开头(보이는 글 最初·开头),
 * 재생 띠 ✕ 「재생 끝내기(전체 경로)」 영어 whole path·일본어 全経路 → full path·経路全体, 중국어 「전체 경로」·「전체 경로 보기」 完整路径 → 全部路径(보이는 글 「전체」 全部),
 * 독일어 도구 막대 풍선 글 abspielen/pausieren → Wiedergabe/Pause, 일본어 「격자」 格子 → グリッド(「격자·색」 グリッド・色·「바닥 격자 (F7)」 床グリッド),
 * 판재 상태 줄 「가공 N / M개까지 깎았습니다 · T초」 틀(조각으로 옮겨져 영어·독일어 초가 seconds·Sekunden — G-code 상태 줄은 s).
 */
import { describe, expect, it } from 'vitest';
import { catalogs, sourceMessage, translate } from '../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const dict = (lang: string): Record<string, string> => catalogs[lang] as Record<string, string>;
/** 품음(대소문자 무시 — 184차 꼴) */
const has = (whole: string, part: string): boolean => whole.toLowerCase().includes(part.toLowerCase());
/** 시작 화면 키 안내 줄(app.ts). 204차: 「Esc 고른 것 지우기」 뒤에 「Shift 측정 중 방향 잠금」을 더했다(i18n-toolbar195 — 재생·멈춤·격자 낱말 기대는 그대로) */
const KEYS_LINE = '키: F 전체 보기 · 1~7 표준 뷰 · F7 격자 · Space 재생/멈춤 · Enter 가상 커서 · Esc 고른 것 지우기 · Shift 측정 중 방향 잠금 · Ctrl+O 열기';

describe('재생·깎기 묶음 번역(194차)', () => {
  it('한 기능의 보이는 글·풍선 글·이름·바로 가기 줄이 한 낱말을 쓴다', () => {
    // [언어, 낱말 열쇠(보이는 글이나 같은 일의 줄 글), 그 낱말을 품어야 할 열쇠]
    const groups: [langs: readonly string[], word: string, keys: string[]][] = [
      // 패널 재생 막대 「처음」 버튼(풍선 글 「처음으로」)·재생 띠 「처음으로」 버튼·판재 따라가기 「처음으로(깎기 전)」 — 재생 자리를 처음으로
      [LANGS, '처음', ['처음으로', '처음으로(깎기 전)']],
      // 패널 「전체」 버튼 풍선 글·재생 줄이 없을 때 줄 글·재생 띠 ✕ — 같은 일(재생을 끝내고 전체 경로)
      [LANGS, '전체 경로', ['전체 경로 보기', '재생 끝내기(전체 경로)']],
      [['ja', 'zh-CN'], '전체', ['전체 경로', '전체 경로 보기', '재생 끝내기(전체 경로)']],
      // 도구 막대·패널 재생 버튼 보이는 글(재생·멈춤) — 두 풍선 글과 키 안내 줄
      [LANGS, '재생', ['공구 경로 재생 / 멈춤 (Space)', '재생 / 멈춤 (Space)', KEYS_LINE]],
      [LANGS, '멈춤', ['공구 경로 재생 / 멈춤 (Space)', '재생 / 멈춤 (Space)', KEYS_LINE]],
      // 깎기 탭 「격자·색」 묶음과 그 안 「격자」 줄(같은 열쇠가 도구 막대 격자 버튼 보이는 글) — 독일어 도구 막대 풍선 글 Bodengitter는 묶음 밖(194차에 보고 둔 것)
      [LANGS, '격자', ['격자·색']],
      [['en', 'ja', 'zh-CN'], '격자', ['바닥 격자 (F7)', KEYS_LINE]],
    ];
    const misses: string[] = [];
    for (const [langs, word, keys] of groups)
      for (const lang of langs)
        for (const key of keys) {
          const w = dict(lang)[word]!;
          const v = dict(lang)[key]!;
          if (!has(v, w)) misses.push(`${lang}: ${word} ${w} ⊄ ${v}`);
        }
    expect(misses).toEqual([]);
  });

  it('고친 값은 같은 사전의 낱말이고, 거꾸로 찾으면 그 열쇠다(다른 열쇠와 같은 값이 아님)', () => {
    const want: Record<string, Record<string, string>> = {
      en: { 처음: 'Start', '재생 끝내기(전체 경로)': 'End playback (full path)' },
      ja: { 처음으로: '最初へ', '처음으로(깎기 전)': '最初へ(削る前)', '재생 끝내기(전체 경로)': '再生を終える(経路全体)', 격자: 'グリッド' },
      'zh-CN': { 처음으로: '到开头', '처음으로(깎기 전)': '到开头(切削前)', '전체 경로 보기': '查看全部路径', '전체 경로': '全部路径' },
      de: { 처음: 'Anfang', '공구 경로 재생 / 멈춤 (Space)': 'Wiedergabe/Pause des Werkzeugwegs (Leertaste)' },
    };
    for (const [lang, values] of Object.entries(want))
      for (const [key, value] of Object.entries(values)) {
        expect(dict(lang)[key], `${lang}: ${key}`).toBe(value);
        expect(sourceMessage(value), `${lang}: ${value}`).toBe(key);
      }
  });

  it('깎기 탭 상태 줄은 판재도 G-code와 같은 초 꼴', () => {
    for (const lang of LANGS) {
      const tail = (text: string): string => text.slice(text.lastIndexOf(' · '));
      const nc = translate('이동 5 / 77까지 깎았습니다 · 0.01초', lang);
      const whole = translate('전체 프로그램을 깎았습니다 · 0.01초', lang);
      const panel = translate('가공 3 / 12개까지 깎았습니다 · 0.01초', lang);
      expect(tail(panel), `${lang}: ${panel}`).toBe(tail(nc));
      expect(tail(whole), `${lang}: ${whole}`).toBe(tail(nc));
      expect(panel, lang).not.toMatch(/[가-힣]/);
    }
    expect(LANGS.map((lang) => translate('가공 3 / 12개까지 깎았습니다 · 0.01초', lang))).toEqual([
      'Cut 3 of 12 operations · 0.01 s',
      '加工 3 / 12 個まで削りました · 0.01秒',
      '已切削到第 3 / 12 个加工 · 0.01 秒',
      '3 von 12 Bearbeitungen geschnitten · 0.01 s',
    ]);
  });
});
