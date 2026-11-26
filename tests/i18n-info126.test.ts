// @vitest-environment jsdom
/**
 * 126차: 122차(깎기 탭)·125차(측정 화면) 밖의 화면 — 정보 탭·패널 틀·기계/읽기 설정·시작 화면·문서 상태 줄·3D 보기 띠와 해석기 경고 — 의 보이는 원문을
 * 네 언어 번역과 대조해(README 개발 126차 문단), 원문의 CAD·가공 뜻(이송 feed, 배율 scale, 절입 cut depth, 블록 Satz, 드릴 가공 drilling,
 * 공구 표 tool table, 기계 좌표 쪽 machine-coordinate side)과 어긋난 줄을 같은 사전 안의 번역으로 고쳤다. 예: 상태 줄 이동 종류 「원호 이송」이
 * 영어 Arc move·일본어 円弧移動(이송이 빠짐 — 같은 묶음 「직선 이송」 Linear feed, 「이송」 送り), 패널 탭 「코드」가 Source·源代码·Quellcode
 * (같은 탭을 부르는 「코드 탭」은 Code tab·代码标签·Code-Tab), 공구 묶음의 드릴 이동 선 「T1 드릴」이 钻头·Bohrer(드릴 공구 — 「드릴」 이동은 钻孔·Bohren).
 * 사전에 없어 네 언어 모두 한국어로 남던 Siemens 식 오류 「_ZSD[…] = 없음」을 더하고, 쓰는 곳 없는 옛 측정 열쇠를 지웠다(125차 보고 둔 것).
 */
import { describe, expect, it } from 'vitest';
import { catalogs, translate } from '../site/i18n.mjs';
import { panelTabs } from '../src/app/doc';
import { panelMeasureHint, statusMeasureHint } from '../src/app/measure';
import type { NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const dict = (lang: string): Record<string, string> => catalogs[lang] as Record<string, string>;
/** 열쇠 머리로 찾기(가운뎃점·줄표 글자를 시험에 다시 쓰지 않게) */
const keyOf = (head: string): string => {
  const key = Object.keys(dict('en')).find((k) => k.startsWith(head));
  if (!key) throw new Error(`열쇠 없음: ${head}`);
  return key;
};
const HAAS = (): string => keyOf('Haas 프로그램으로 읽었습니다(판별) — G73');
const HAAS_PECK = (): string => keyOf('G{0}의 I·J·K를 Haas 쪼기');
const G51_ZERO = (): string => keyOf('G51 배율이 0');
const G51_NONE = (): string => keyOf('G51에 배율(P');
const BLOCK_LIMIT = (): string => keyOf('실행 블록이 {0}개를 넘어 멈춤');
const OLD_MEASURE = '측정: {0} mm (ΔX {1} ΔY {2} ΔZ {3})';
/** 마우스 측정 안내 셋(상태 막대·패널 띠 — measure.ts)과 같은 패널 띠의 손가락 짝 */
const MOUSE_HINTS = (): string[] => [statusMeasureHint(false), panelMeasureHint(false), panelMeasureHint(false, true)];
const plain = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));

describe('정보 탭·설정·시작 화면·상태 줄·해석 경고 번역(126차)', () => {
  it('옛 오역 낱말이 다시 들어오지 않고 쓰지 않는 옛 측정 열쇠는 없다', () => {
    // [열쇠에 든 말, 언어, 없어야 할 말]
    const bans: [term: string, lang: string, ban: RegExp][] = [
      ['배율', 'en', /magnif/i],
      ['배율', 'de', /\bSkala\b|Vergrößerung/],
      ['블록', 'de', /[Bb]löck/],
      ['최소 절입', 'zh-CN', /进给量/],
      ['공구 표', 'zh-CN', /工具表/],
      ['기계 좌표 쪽', 'zh-CN', /机床坐标方向/],
    ];
    for (const [term, lang, ban] of bans)
      for (const [key, value] of Object.entries(dict(lang))) {
        if (!key.includes(term)) continue;
        expect(value, `${lang}: ${key}`).not.toMatch(ban);
      }
    // [열쇠(그 글 그대로), 언어, 없어야 할 말]
    const exact: [key: string, lang: string, ban: RegExp][] = [
      ['원호 이송', 'en', /move/i],
      ['원호 이송', 'ja', /移動/],
      ['직선 이송', 'ja', /移動/],
      ['코드', 'en', /Source/],
      ['코드', 'zh-CN', /源/],
      ['코드', 'de', /Quell/],
      ['{0} 드릴', 'zh-CN', /钻头/],
      ['{0} 드릴', 'de', /Bohrer/],
      ...MOUSE_HINTS().map((key): [string, string, RegExp] => [key, 'en', /Measurement|Select|selected/]),
    ];
    for (const [key, lang, ban] of exact) expect(dict(lang)[key], `${lang}: ${key}`).not.toMatch(ban);
    for (const lang of LANGS) expect(Object.hasOwn(dict(lang), OLD_MEASURE), lang).toBe(false);
  });

  it('고친 줄은 같은 사전의 말을 쓴다', () => {
    // 상태 줄 이동 종류(doc.ts): 이송은 feed·送り — 「직선 이송」과 같은 꼴
    expect(LANGS.map((lang) => translate('원호 이송', lang))).toEqual(['Arc feed', '円弧送り', '圆弧进给', 'Bogenvorschub']);
    expect(LANGS.map((lang) => translate('직선 이송', lang))).toEqual(['Linear feed', '直線送り', '直线进给', 'Geradenvorschub']);
    expect(dict('ja')['이송 · 급속 · 휴지']).toMatch(/^送り/);
    // G51 배율: 영어 scale(「G51 배율이 0」)·독일어 Skalierung(「좌표 회전·배율·거울」)
    expect(dict('en')[G51_ZERO()]).toContain('G51 scale is 0');
    expect(dict('en')[G51_NONE()]).toBe('There is no scale (P or I·J·K) in G51, so it is assumed to be 1.');
    expect(dict('de')[G51_ZERO()]).toMatch(/^G51-Skalierung ist 0 /);
    expect(dict('de')[G51_NONE()]).toContain('keine Skalierung (P oder I');
    expect(dict('de')[keyOf('ISO·Fanuc·LinuxCNC')]).toContain('Skalierung');
    // Haas 판별 알림의 최소 절입: 같은 Haas 쪼기 경고의 最小切深
    expect(dict('zh-CN')[HAAS_PECK()]).toContain('最小切深');
    expect(dict('zh-CN')[HAAS()]).toContain('K 视为最小切深');
    // 실행 블록 한도: 독일어 블록은 Satz(「줄 · 실행 블록」 Ausführungssatz)
    expect(dict('de')[BLOCK_LIMIT()]).toBe('Abbruch nach Überschreiten von {0} Ausführungssätzen (Endlosschleife möglich)');
    expect(dict('de')[keyOf('줄 · 실행 블록')]).toContain('Ausführungssatz');
    // 패널 탭 이름(doc.ts panelTabs)은 그 탭을 부르는 「코드 탭」과 같은 말
    const tabs = panelTabs({ kind: 'gcode' }).map(([, name]) => name);
    expect(tabs).toContain('코드');
    expect(LANGS.map((lang) => translate('코드', lang))).toEqual(['Code', 'コード', '代码', 'Code']);
    const codeTab = '누르면 코드 탭에서 이 파일이 시작하는 줄로';
    expect(LANGS.map((lang) => dict(lang)[codeTab]!.includes(['Code tab', 'コードタブ', '代码标签', 'Code-Tab'][LANGS.indexOf(lang)]!))).toEqual([true, true, true, true]);
    // 공구 묶음의 드릴 이동 선(scene.ts `${group} 드릴`)은 「{0} 이송」의 짝 — 드릴 가공
    expect(LANGS.map((lang) => translate('T1 드릴', lang))).toEqual(['T1 Drill', 'T1ドリル', 'T1 钻孔', 'T1 Bohren']);
    expect(LANGS.map((lang) => translate('T1 이송', lang))).toEqual(['T1 feed', 'T1 送り', 'T1 进给', 'T1 Vorschub']);
    // 정보 탭 보정 반지름 출처(gcode.ts `공구 표 ${name}`)·상태 줄 이동 설명(doc.ts)
    expect(translate('공구 표 T3', 'zh-CN')).toBe('刀具表 T3');
    expect(translate('선반 공구 표 T3', 'zh-CN')).toBe('车床刀具表 T3');
    expect(translate('기계 좌표 쪽(추정)', 'zh-CN')).toBe('机床坐标侧(估计)');
    expect(dict('zh-CN')[keyOf('출발 높이 추정(기계 좌표 쪽)')]).toContain('机床坐标侧');
    // 마우스 측정 안내(125차 보고 둔 것): 다른 마우스 안내의 Measure: Click …, 괄호 글은 손가락 짝과 같게
    const [status, basic, paths] = MOUSE_HINTS().map((key) => dict('en')[key]);
    expect(status).toBe('Measure: Click two points (Esc = Clear)');
    expect(dict('en')[keyOf('측정: 잴 시작점을 누르십시오')]).toMatch(/^Measure: (Click|Tap) the start point/);
    for (const [mouse, touch] of [[basic, panelMeasureHint(true)], [paths, panelMeasureHint(true, true)]] as const) {
      const paren = /\(.*\)/.exec(dict('en')[touch]!)![0];
      expect(mouse).toBe(`Measure: Click two points ${paren}. Esc = Clear`);
    }
  });

  it('해석기가 화면으로 내는 Siemens 식 오류 「_ZSD[…] = 없음」을 네 언어로 옮긴다', () => {
    const p = parseSiemens(makeSource('%_N_T_MPF\nG17 G90 G71\n_ZSD[2]\nG0 X10 Y10 Z5\nM30\n'), { initialPosition: [0, 0, 50] });
    const warn = '읽을 수 없는 블록 — _ZSD[…] = 없음';
    expect(plain(p)).toContain(warn);
    for (const lang of LANGS) expect(translate(warn, lang), lang).not.toMatch(/[가-힣]/);
    // 같은 꼴 「R[…] = 없음」과 같은 말
    expect(LANGS.map((lang) => translate('_ZSD[…] = 없음', lang))).toEqual(['_ZSD[…] = missing', '_ZSD[…] = がない', '缺少 _ZSD[…] =', '_ZSD[…] = fehlt']);
    expect(LANGS.map((lang) => translate('R[…] = 없음', lang))).toEqual(['R[…] = missing', 'R[…] = がない', '缺少 R[…] =', 'R[…] = fehlt']);
  });

  it('그대로인 줄', () => {
    expect(LANGS.map((lang) => translate('G-code 형식', lang))).toEqual(['Dialect', '方言', '方言', 'Dialekt']);
    expect(LANGS.map((lang) => translate('정보', lang))).toEqual(['Information', '情報', '信息', 'Informationen']);
    expect(LANGS.map((lang) => translate('급속 이송', lang))).toEqual(['Rapid traverse', '早送り移動', '快速进给', 'Eilgang']);
    expect(dict('en')[HAAS_PECK()]).toContain('minimum peck');
    expect(dict('en')[panelMeasureHint(true)]).toBe('Measure: Tap two points (snaps to vertices or endpoints if nearby) · Press and hold to aim precisely');
    expect(translate('기계 원점 쪽 이동(추정)', 'zh-CN')).toBe('机床原点方向移动(估计)');
  });
});
