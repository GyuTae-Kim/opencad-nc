// @vitest-environment jsdom
/**
 * 125차: 측정 화면(줄자·방향 잠금·끌어온 점·가상 커서 알림·측정 띠·측정값 칸)의 보이는 원문을 네 언어 번역과 대조해(README 개발 125차 문단),
 * 원문의 CAD 뜻(끝점 endpoint, 중간점 midpoint, 수직점 perpendicular foot, 나란함 parallel, 접선 tangent, 잠금 lock, 끌어온 점 tracking point)과 어긋난 줄을
 * 같은 사전 안의 번역으로 고쳤다. 예: 중국어 마우스 측정 안내 「꼭짓점·끝점 가까우면 그 점에 붙습니다」가 「如果靠近顶点/端点，则捕捉到顶点」(끝점 가까이에서도
 * 꼭짓점에 붙는다는 뜻)이었다 — 같은 안내의 손가락 꼴 「靠近顶点或端点时会捕捉到该点」(그 점에 붙음)과 같게.
 * 측정 화면이 번역층에 넘기는 이름(스냅 종류·끌어온 축·잠근 선 위 교차·끌어온 점 안내 선이 만나는 점)은 코드(snapLabel·lockMeetLabel·trackDirName)로 지어
 * 안내·버튼 이름·띠 위 알림(117·118차 글 포함)·가상 커서 알림 틀과 함께 네 언어 모두 한글 없이 옮겨지는지 본다.
 */
import { describe, expect, it } from 'vitest';
import { KEY_SNAP_MESSAGES } from 'opencad-viewer3d';
import { catalogs, translate } from '../site/i18n.mjs';
import { measureFailText } from '../src/app/core';
import { KEY_HELP, keySnapDictKey } from '../src/app/keysnap';
import { MEASURE_LOADING, TANGENT_LABEL, lockMeetLabel, measureHint, panelMeasureHint, snapLabel, statusMeasureHint, type LockMeet } from '../src/app/measure';
// 216차: 잠금 글 다섯은 측정 도구 조각만 써 measure.ts(첫 화면)에서 measure-lock.ts로 옮겼다
import {
  ARROW_LOCK_HINT,
  CURSOR_LOCK_HINT,
  LOCK_HINTS,
  NO_LOCK_MOUSE,
  NO_LOCK_TOUCH,
  PERPENDICULAR_DIR_LABEL,
  SHIFT_LOCK_HINTS,
  UNLOCK_SAID,
  trackDirName,
} from '../src/app/measure-lock';
import { NO_TRACK_MOUSE, NO_TRACK_TOUCH, TRACKED, TRACK_LABEL, TRACK_TITLE } from '../src/app/measure-track';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const dict = (lang: string): Record<string, string> => catalogs[lang] as Record<string, string>;
const AXES = ['x', 'y', 'z'] as const;
type Kind = Parameters<typeof snapLabel>[0];
type DirPoint = Parameters<typeof trackDirName>[0];

/** 측정 툴팁·측정 띠·상태 막대·결과 이름(코드로 지은 꼴 — 오지 않는 꼴은 빼고) */
function snapNames(): Set<string> {
  const names = new Set<string>();
  const kinds: Kind[] = ['vertex', 'endpoint', 'midpoint', 'center', 'point', 'intersection', 'perpendicular', 'parallel', 'axis', null];
  for (const k of kinds) names.add(snapLabel(k));
  for (const a of AXES) {
    names.add(snapLabel('axis', a));
    for (const t of [true, 'edge', 'face', 'axisEdge', 'axisFace'] as const) names.add(snapLabel('axis', a, t));
    for (const b of AXES) if (b !== a) names.add(snapLabel('axis', a, b));
    names.add(snapLabel('axis', a, 'lockFrom'));
  }
  // 잠근 선(축·나란함·수직·모르는 방향, 원호 접선)이 모서리·면·끌어온 점의 축과 만나는 점(잠근 축과 같은 축은 오지 않는다)
  const meets: LockMeet[] = ['lockEdge', 'lockFace', 'lockX', 'lockY', 'lockZ'];
  for (const t of meets) {
    for (const a of AXES) if (t.slice(4).toLowerCase() !== a) names.add(snapLabel('axis', a, t));
    for (const k of ['parallel', 'perpendicular', null] as Kind[]) names.add(snapLabel(k, null, t));
    names.add(lockMeetLabel(TANGENT_LABEL, t));
  }
  // 끌어온 점에서 지나간 모서리와 나란한 선·수직인 선, 그 선이 다른 것과 만나는 점(나란한 두 선은 만나지 않는다)
  for (const snap of ['parallel', 'perpendicular'] as const) {
    names.add(snapLabel(snap, null, 'dir'));
    const at: Record<string, unknown>[] = [
      ...AXES.map((axis) => ({ axis })),
      ...AXES.map((axis) => ({ trackOther: { axis } })),
      { segment: [[0, 0, 0], [1, 0, 0]] },
      { face: {} },
      { direction: [1, 0, 0] },
      { trackGuide: { kind: 'perpendicular' } },
      ...(snap === 'perpendicular' ? [{ trackGuide: { kind: 'parallel' } }] : []),
    ];
    for (const m of at) names.add(trackDirName({ snap, trackFrom: [0, 0, 0], ...m } as unknown as DirPoint) ?? '');
  }
  return names;
}

const MOUSE_VERTEX_HINT = '측정: 두 점을 누르십시오(꼭짓점·끝점 가까우면 그 점에 붙습니다). Esc = 지우기';
const TOUCH_VERTEX_HINT = '측정: 두 점을 누르십시오(꼭짓점·끝점 가까우면 그 점에 붙습니다) · 길게 누르면 정밀 조준';

describe('측정 화면 번역(125차)', () => {
  it('옛 오역 낱말이 다시 들어오지 않는다', () => {
    // [열쇠에 든 말, 언어, 없어야 할 말] — 끝점 가까이에서도 꼭짓점에 붙는다는 뜻
    const bans: [term: string, lang: string, ban: RegExp][] = [['가까우면 그 점에 붙습니다', 'zh-CN', /则捕捉到顶点|顶点\/端点/]];
    for (const [term, lang, ban] of bans)
      for (const [key, value] of Object.entries(dict(lang))) {
        if (!key.includes(term)) continue;
        expect(value, `${lang}: ${key}`).not.toMatch(ban);
      }
  });

  it('고친 줄은 같은 사전의 말을 쓴다', () => {
    const snaps = '（靠近顶点或端点时会捕捉到该点）';
    expect(dict('zh-CN')[TOUCH_VERTEX_HINT]).toContain(snaps);
    expect(dict('zh-CN')[MOUSE_VERTEX_HINT]).toBe(`测量：单击两点${snaps}。按 Esc 键清除`);
    expect(translate(panelMeasureHint(), 'zh-CN')).toBe('测量：单击两点（靠近顶点或端点时会捕捉到该点）。按 Esc 键清除');
  });

  it('측정 화면 이름·안내·버튼·알림을 네 언어로 옮긴다(117·118차 글 포함)', () => {
    const names = snapNames();
    expect(names.size).toBe(92);
    const texts = [
      ...names,
      MEASURE_LOADING,
      TANGENT_LABEL,
      PERPENDICULAR_DIR_LABEL,
      ...Object.values(LOCK_HINTS),
      ...Object.values(SHIFT_LOCK_HINTS),
      ARROW_LOCK_HINT,
      NO_LOCK_TOUCH,
      NO_LOCK_MOUSE,
      ...[0, 1, 2].flatMap((n) => [measureHint(n, false), measureHint(n, false, true)]),
      ...[false, true].flatMap((touch) => [panelMeasureHint(touch), panelMeasureHint(touch, true), statusMeasureHint(touch)]),
      // 끌어온 점 버튼(118차 — 기억한 점 수가 든 이름)과 띠 위 알림(117차)
      TRACK_LABEL,
      `${TRACK_LABEL} · 기억한 점 2개`,
      TRACK_TITLE,
      TRACKED,
      NO_TRACK_TOUCH,
      NO_TRACK_MOUSE,
      // 툴바·측정 띠·잠금 버튼·툴팁·측정값 칸(app.ts·measure-lock.ts·panel.ts·doc.ts 원문)
      '측정',
      '두 점 거리·dx·dy·dz (Esc로 지우기)',
      '측정 끝내기',
      '다시 재기',
      '찍은 점과 결과 지우기',
      '잠금',
      '방향 잠금',
      '방향 잠금 풀기',
      '지금 방향 잠그기(다시 누르면 풀기)',
      '거리',
      '거리 12.345 mm · dx 1 · dy -2 · dz 0',
      '한 손가락 끌기 회전 · 두 손가락 이동·확대 · 측정 중 길게 누르면 정밀 조준',
      measureFailText(true),
      measureFailText(false),
      '측정 도구를 열 수 없습니다: Load failed',
      // 가상 커서: 캔버스 설명과 코어 알림 틀(앱 사전 열쇠 — 고르기 종류는 앱 묶음 이름이 대신)
      KEY_HELP,
      ...Object.entries(KEY_SNAP_MESSAGES)
        .filter(([key, ko]) => /[가-힣]/.test(ko) && !key.startsWith('pick.'))
        .map(([, ko]) => keySnapDictKey(ko)),
    ];
    for (const lang of LANGS) for (const text of texts) expect(translate(text, lang), `${lang}: ${text}`).not.toMatch(/[가-힣]/);
  });

  it('그대로인 줄', () => {
    expect(translate(MOUSE_VERTEX_HINT, 'ja')).toBe('測定: 2点をクリックしてください（頂点や端点に近い場合、その点にスナップします）。Esc = 消去');
    expect(translate(TOUCH_VERTEX_HINT, 'zh-CN')).toBe('测量：点按两点（靠近顶点或端点时会捕捉到该点） · 长按可精确瞄准');
    expect(LANGS.map((lang) => translate('수직점', lang))).toEqual(['Perpendicular', '垂線の足', '垂足', 'Lotfußpunkt']);
    expect(LANGS.map((lang) => translate(PERPENDICULAR_DIR_LABEL, lang))).toEqual(['Perpendicular to edge', 'エッジに垂直', '垂直于边', 'Senkrecht zur Kante']);
    expect(translate(`${TRACK_LABEL} · 기억한 점 2개`, 'de')).toBe('Punkt merken · Gemerkte Punkte 2');
  });

  it('203차: 가상 커서 축 잠금 안내(X·Y·Z)·푼 알림·3D 보기 설명의 더한 문장을 같은 사전의 잠금 낱말로 네 언어에 옮긴다', () => {
    // [언어, 안내, 푼 알림, 3D 보기 설명에 더한 문장, 「Shift로 X축 방향 잠그기」의 잠금 낱말, 「방향 잠금 풀기」의 풂 낱말]
    // 204차: 같은 문장에 L(지금 방향 — 아래 204차 it)을 더했다(「X·Y·Z로 축 방향을 잠급니다」 → 「X·Y·Z로 축 방향을, L로 지금 방향을 잠급니다」) — X·Y·Z 부분 글은 그대로
    // 205차: 안내도 L을 품는다(「X·Y·Z로 축 방향 잠금」 → 「X·Y·Z로 축 방향, L로 지금 방향 잠금」 — 아래 205차 it). 일본어 잠금 낱말은 「軸方向に、L で現在の方向にロック」로 갈려 「にロック」
    // 217차: 일본어 설명도 키 이름 뒤 「で」를 띄운다(「後はX・Y・Zで…、Lで」 → 「後は X・Y・Z で…、L で」 — 같은 사전 키 이름 + で 띄움 35 : 붙임 7, 안내 「X・Y・Z で」와 한 꼴, tests/i18n.test.ts 217차)
    const want: [lang: string, hint: string, off: string, help: string, lockWord: string, offWord: string][] = [
      ['en', 'X, Y or Z locks to that axis and L locks the current direction', 'Direction unlocked', 'After the first point while measuring, X, Y or Z locks to that axis and L locks the current direction (press again to unlock).', 'locks to', 'nlock'],
      ['ja', 'X・Y・Z で軸方向に、L で現在の方向にロック', '方向ロックを解除しました', '測定の1点目の後は X・Y・Z で軸方向に、L で現在の方向にロックします（もう一度押すと解除）。', 'にロック', '方向ロックを解除'],
      ['zh-CN', '按 X、Y 或 Z 锁定为该轴方向，按 L 锁定当前方向', '已解除方向锁定', '测量选好第一个点后，按 X、Y 或 Z 锁定为该轴方向，按 L 锁定当前方向（再按一次解除）。', '锁定为', '解除方向锁定'],
      ['de', 'X, Y, Z sperren in X-, Y- bzw. Z-Richtung und L die aktuelle Richtung', 'Richtungssperre aufgehoben', 'Nach dem ersten Messpunkt sperren X, Y, Z in X-, Y- bzw. Z-Richtung und L die aktuelle Richtung (erneut drücken zum Entsperren).', '-Richtung', 'Richtungssperre auf'],
    ];
    expect(want.map(([l]) => l)).toEqual([...LANGS]);
    for (const [lang, hint, off, help, lockWord, offWord] of want) {
      expect(translate(CURSOR_LOCK_HINT, lang), lang).toBe(hint);
      expect(translate(UNLOCK_SAID, lang), lang).toBe(off);
      expect(translate(KEY_HELP, lang), lang).toContain(help);
      // 같은 사전 근거: 잠금 낱말·풂 낱말·「(다시 누르면 풀기)」 괄호 글
      expect(dict(lang)[SHIFT_LOCK_HINTS.x], lang).toContain(lockWord);
      expect(hint, lang).toContain(lockWord);
      expect(dict(lang)['방향 잠금 풀기'], lang).toContain(offWord);
      expect(off, lang).toContain(offWord);
      expect(help, lang).toContain(/[（(][^（(]+[)）]$/.exec(dict(lang)['지금 방향 잠그기(다시 누르면 풀기)']!)![0]);
    }
    expect(KEY_HELP).toContain('측정 첫 점 뒤에는 X·Y·Z로 축 방향을, L로 지금 방향을 잠급니다(다시 누르면 풀기).');
  });

  it('204차: 3D 보기 설명의 L(지금 방향 — 커서가 꺼졌을 때의 ↓)은 같은 사전 「지금 방향 잠그기(다시 누르면 풀기)」의 낱말로 네 언어에 옮긴다', () => {
    // [언어, 설명 안 L 글, 「지금 방향 잠그기(다시 누르면 풀기)」의 지금 방향 낱말]
    const want: [lang: string, part: string, now: string][] = [
      ['en', 'L locks the current direction', 'current direction'],
      // 217차: 「Lで」 → 「L で」(위 203차 it 주석)
      ['ja', 'L で現在の方向に', '現在の方向'],
      ['zh-CN', '按 L 锁定当前方向', '锁定当前方向'],
      ['de', 'L die aktuelle Richtung', 'ktuelle Richtung'],
    ];
    expect(want.map(([l]) => l)).toEqual([...LANGS]);
    for (const [lang, part, now] of want) {
      expect(translate(KEY_HELP, lang), lang).toContain(part);
      expect(part, lang).toContain(now);
      expect(dict(lang)['지금 방향 잠그기(다시 누르면 풀기)'], lang).toContain(now);
      expect(translate(KEY_HELP, lang), lang).not.toMatch(/[가-힣]/);
    }
    expect(KEY_HELP).toContain('L로 지금 방향을 잠급니다');
  });

  it('205차: 가상 커서가 켜진 동안의 잠금 안내에 L(지금 방향) — 3D 보기 설명(KEY_HELP)의 같은 낱말로 네 언어에 옮긴다', () => {
    // [언어, 안내 안 L 글(KEY_HELP 번역에도 그대로), 203차 안내의 X·Y·Z 글(그대로 남음)]
    const want: [lang: string, part: string, axes: string][] = [
      ['en', 'L locks the current direction', 'X, Y or Z locks to that axis'],
      ['ja', 'L で現在の方向にロック', 'X・Y・Z で軸方向に'],
      ['zh-CN', '按 L 锁定当前方向', '按 X、Y 或 Z 锁定为该轴方向'],
      ['de', 'L die aktuelle Richtung', 'X, Y, Z sperren in X-, Y- bzw. Z-Richtung'],
    ];
    expect(want.map(([l]) => l)).toEqual([...LANGS]);
    for (const [lang, part, axes] of want) {
      const hint = translate(CURSOR_LOCK_HINT, lang);
      expect(hint, lang).toContain(part);
      expect(hint, lang).toContain(axes);
      // 같은 사전 근거: 3D 보기 설명의 L 글(217차: 일본어 설명도 안내 꼴 「X・Y・Z で」처럼 글자 뒤 빈칸 — 205차는 설명이 붙여 써 빈칸을 넣어 견줬다)
      expect(translate(KEY_HELP, lang), lang).toContain(part);
      expect(hint, lang).not.toMatch(/[가-힣]/);
    }
    expect(CURSOR_LOCK_HINT).toBe('X·Y·Z로 축 방향, L로 지금 방향 잠금');
    // 203차 안내 열쇠는 바꿔 남지 않는다(같은 열쇠가 둘이 되지 않게)
    for (const lang of LANGS) expect(dict(lang)['X·Y·Z로 축 방향 잠금'], lang).toBeUndefined();
  });
});
