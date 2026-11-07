/**
 * Heidenhain 사이클 25 윤곽 트레인·사이클 270 윤곽 트레인 자료(49차): HEIDENHAIN TNC 640 가공 사이클 프로그래밍 설명서(34059x-17, 10/2022)
 * 9.10절 292~295쪽(25 — 열린·닫힌 윤곽, 하향·상향은 대칭해도 그대로, 첫 LBL만, Q1 = 0이면 실행하지 않음, Q15 = 0이면 왕복),
 * 9.9절 290~291쪽(270 — 접근·이탈 Q390·보정 Q391·Q392~Q394), 9.12절 302쪽(진입을 되풀이하는 차례), 311~312쪽 예제 "Contour train" 꼴.
 * 기대 값은 설명서 예제 수치에서 손으로 셈한 것(공구 반지름 10 — 예제의 지름 20 공구). 모두 직접 만든 작은 합성 프로그램
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { parseHeidenhain } from '../src/heidenhain';
import { MOVE_ARC, MOVE_FEED, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const p3 = (q: number[]): number[] => q.map(r3);
const plain = (ws: string[]): string[] => ws.map((w) => w.replace(/^\d+번 줄: /, ''));
const ct = (q: Record<string, number>): string =>
  `CYCL DEF 25 CONTOUR TRAIN ~\n` +
  Object.entries({ Q1: -20, Q3: 0, Q5: 0, Q7: 250, Q10: -5, Q11: 100, Q12: 200, Q15: 1, Q18: 0, Q446: 0.01, Q447: 10, Q448: 2, ...q })
    .map(([k, v]) => `  ${k}=${v >= 0 ? '+' : ''}${v}`)
    .join(' ~\n');
const data270 = (q: Record<string, number>): string =>
  `CYCL DEF 270 CONTOUR TRAIN DATA ~\n` +
  Object.entries({ Q390: 1, Q391: 1, Q392: 5, Q393: 90, Q394: 0, ...q })
    .map(([k, v]) => `  ${k}=${v >= 0 ? '+' : ''}${v}`)
    .join(' ~\n');
/** 설명서 311~312쪽 예제 꼴(공구 지름 20 — 반지름 10). extra는 사이클 앞에 끼우는 블록 */
const prog = (q: Record<string, number>, contour: string, extra = '', labels = 'LABEL1'): string => `0 BEGIN PGM 3 MM
1 BLK FORM 0.1 Z X+0 Y+0 Z-40
2 BLK FORM 0.2 X+100 Y+100 Z+0
3 TOOL DEF 10 L+0 R+10
4 TOOL CALL 10 Z S2000
5 L Z+100 R0 FMAX M3
${extra}6 CYCL DEF 14.0 CONTOUR
7 CYCL DEF 14.1 CONTOUR ${labels}
8 ${ct(q)}
9 CYCL CALL
10 L Z+250 R0 FMAX
11 M30
12 LBL 1
${contour}
19 LBL 0
20 LBL 2
21 L X+0 Y+0 RL
22 L X+5
23 LBL 0
24 END PGM 3 MM
`;
const EX = `13 L X+0 Y+15 RL
14 L X+5 Y+20
15 CT X+5 Y+75
16 L Y+95
17 RND R7.5
18 L X+50
19 RND R7.5
20 L X+100 Y+80`;
const callMoves = (p: NcProgram, src: string): number[] => {
  const line = src.split('\n').findIndex((l) => l.includes('9 CYCL CALL'));
  return [...Array(p.moves.count).keys()].filter((i) => p.moves.line[i] === line);
};
/** 절삭(이송·호) 가운데 평면 안 이동(z 그대로)을 층별로: [시작점, 끝점] */
const passes = (p: NcProgram, ids: number[]): Map<number, number[][]> => {
  const m = new Map<number, number[][]>();
  for (const i of ids) {
    if (p.moves.kind[i] !== MOVE_FEED && p.moves.kind[i] !== MOVE_ARC) continue;
    const s = moveStart(p.moves, i);
    const e = moveEnd(p.moves, i);
    if (Math.abs(s[2] - e[2]) > 1e-9) continue;
    const z = r3(e[2]);
    if (!m.has(z)) m.set(z, []);
    m.get(z)!.push([...s.slice(0, 2), ...e.slice(0, 2)]);
  }
  return m;
};
const S = [-7.071, 22.071];
const E = [102.873, 89.578];

describe('사이클 25 윤곽 트레인 — 설명서 예제 꼴(9.10절, 311쪽)', () => {
  it('RL·Q15 = +1(하향): 윤곽 왼쪽으로 공구 반지름만큼, Q10 = -5씩 -20까지 네 층, 층마다 Q7로 올라 시작점으로 돌아감', () => {
    const src = prog({}, EX);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    const ids = callMoves(p, src);
    const ps = passes(p, ids);
    expect([...ps.keys()]).toEqual([-5, -10, -15, -20]);
    for (const segs of ps.values()) {
      // 첫 선분 (0,15)→(5,20)을 왼쪽으로 10 옮긴 것에서 시작, 끝 (100,80)을 왼쪽으로 10 옮긴 곳에서 끝(열린 윤곽 — 시작점으로 닫지 않음)
      expect(p3(segs[0]!.slice(0, 2))).toEqual(S);
      expect(p3(segs[0]!.slice(2))).toEqual([-2.071, 27.071]);
      expect(p3(segs[segs.length - 1]!.slice(2))).toEqual(E);
    }
    // 층 사이: 끝에서 Q7(250)로 급속, 시작점 위로 급속, Q11로 내려감
    const rapids = ids.filter((i) => p.moves.kind[i] === MOVE_RAPID).map((i) => p3(moveEnd(p.moves, i)));
    expect(rapids).toContainEqual([...E, 250]);
    expect(rapids).toContainEqual([...S, 250]);
    // 끝: 공구 축으로만 Q7
    expect(p3(moveEnd(p.moves, ids[ids.length - 1]!))).toEqual([...E, 250]);
  });
  it('Q15 = -1(상향): 같은 길을 거꾸로(끝에서 시작)', () => {
    const src = prog({ Q15: -1 }, EX);
    const p = parseHeidenhain(src);
    const segs = passes(p, callMoves(p, src)).get(-5)!;
    expect(p3(segs[0]!.slice(0, 2))).toEqual(E);
    expect(p3(segs[segs.length - 1]!.slice(2))).toEqual(S);
  });
  it('Q15 = 0: 층마다 번갈아 왕복하고 끝과 시작에서 그대로 내려감(302쪽) — 층 사이에 급속이 없음', () => {
    const src = prog({ Q15: 0 }, EX);
    const p = parseHeidenhain(src);
    const ids = callMoves(p, src);
    const ps = passes(p, ids);
    expect(p3(ps.get(-5)![0]!.slice(0, 2))).toEqual(S);
    expect(p3(ps.get(-10)![0]!.slice(0, 2))).toEqual(E);
    expect(p3(ps.get(-15)![0]!.slice(0, 2))).toEqual(S);
    // 급속은 처음(Q7로·시작점 위로)과 끝(Q7로)뿐
    expect(ids.filter((i) => p.moves.kind[i] === MOVE_RAPID).length).toBeLessThanOrEqual(3);
    // 끝 자리에서 공구 축으로 내려가는 이송
    const down = ids.filter((i) => p.moves.kind[i] === MOVE_FEED && r3(moveStart(p.moves, i)[2]) === -5 && r3(moveEnd(p.moves, i)[2]) === -10);
    expect(down).toHaveLength(1);
    expect(p3(moveEnd(p.moves, down[0]!).slice(0, 2))).toEqual(E);
  });
  it('RR이면 오른쪽으로 옮기고, Q15 = +1(하향)이면 거꾸로 돈다(공구가 진행 방향 왼쪽이 되게)', () => {
    const src = prog({ Q1: -5 }, EX.replace('RL', 'RR'));
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    const segs = passes(p, callMoves(p, src)).get(-5)!;
    expect(p3(segs[0]!.slice(0, 2))).toEqual([97.127, 70.422]);
    expect(p3(segs[segs.length - 1]!.slice(2))).toEqual([7.071, 7.929]);
  });
  it('한 축 대칭(사이클 8 X)이어도 하향은 그대로(292쪽): 화면에서 대칭된 끝에서 시작', () => {
    const src = prog({ Q1: -5 }, EX, '5 CYCL DEF 8.0 MIRROR IMAGE\n5 CYCL DEF 8.1 X\n');
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    const segs = passes(p, callMoves(p, src)).get(-5)!;
    expect(p3(segs[0]!.slice(0, 2))).toEqual([-E[0]!, E[1]!]);
    expect(p3(segs[segs.length - 1]!.slice(2))).toEqual([-S[0]!, S[1]!]);
  });
  it('R0이면 공구 중심이 윤곽 위(알림), 깊이 Q1 = 0이면 실행하지 않음(293쪽)', () => {
    const src = prog({ Q1: -5 }, EX.replace(' RL', ''));
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual(['CYCL DEF 25: 윤곽에 RL·RR이 없어 공구 중심이 윤곽 위를 감(하향·상향 Q15는 프로그램 차례로)']);
    const segs = passes(p, callMoves(p, src)).get(-5)!;
    expect(p3(segs[0]!.slice(0, 2))).toEqual([0, 15]);
    expect(p3(segs[segs.length - 1]!.slice(2))).toEqual([100, 80]);
    const zero = prog({ Q1: 0 }, EX);
    const q = parseHeidenhain(zero);
    expect(plain(q.warnings)).toEqual(['CYCL DEF 25: 깊이(Q1)가 0이라 그리지 않음']);
    expect(callMoves(q, zero)).toEqual([]);
  });
  it('공구가 들어가지 못하는 홈은 깎아 들어가지 않고 건너 넘는다(292쪽 — 윤곽 손상 막음)', () => {
    // 너비 3 홈(X 40~43, 깊이 5)을 반지름 10 공구로: 공구 중심은 홈의 두 모서리에서 10 떨어진 두 호가 만나는 자리로 넘어간다
    const src = prog({ Q1: -5 }, '13 L X+0 Y+50 RL\n14 L X+40\n15 L Y+45\n16 L X+43\n17 L Y+50\n18 L X+90');
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual(['CYCL DEF 25: 공구가 커서 윤곽 일부는 깎지 않음(윤곽을 깎아 들어가지 않게)']);
    const ids = callMoves(p, src);
    const segs = passes(p, ids).get(-5)!;
    expect(segs.map((s) => p3(s.slice(2)))).toEqual([
      [40, 60],
      [41.5, 59.887],
      [43, 60],
      [90, 60],
    ]);
    // 이어진 한 길(층 안에서 급속 없음)
    expect(ids.filter((i) => p.moves.kind[i] === MOVE_RAPID)).toHaveLength(3);
  });
  it('사이클 14에 윤곽이 여럿이면 첫 LBL만 쓴다(293쪽)', () => {
    const src = prog({ Q1: -5 }, EX, '', 'LABEL1 /2');
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual(['CYCL DEF 25: 윤곽 LBL이 여럿이라 첫 LBL 1만 씀']);
    expect(p3(passes(p, callMoves(p, src)).get(-5)![0]!.slice(0, 2))).toEqual(S);
  });
  it('아주 작은 Q10은 다른 사이클과 같은 9999층 안전장치', () => {
    const src = prog({ Q10: -0.001 }, EX);
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual(['CYCL DEF 25: 층이 9999개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감']);
    const ps = passes(p, callMoves(p, src));
    expect(ps.size).toBe(10000);
    expect(ps.has(-20)).toBe(true);
  });
  it('DIN/ISO: G37 P01 1(사이클 14)·G125(25)·G79는 평문과 같은 길', () => {
    const plainSrc = prog({ Q1: -5 }, '13 L X+0 Y+15 RL\n14 L X+5 Y+20\n15 L Y+75\n16 L X+50 Y+95');
    const iso = `%CTI G71 *
N10 G99 T10 L+0 R+10 *
N20 T10 G17 S2000 *
N30 G00 Z+100 G40 *
N40 G37 P01 1 *
N50 G125 Q1=-5 Q3=+0 Q5=+0 Q7=+250 Q10=-5 Q11=+100 Q12=+200 Q15=+1 Q18=+0 Q446=+0.01 Q447=+10 Q448=+2 *
N60 G79 *
N70 M30 *
N80 G98 L1 *
N90 G01 G41 X+0 Y+15 *
N100 X+5 Y+20 *
N110 Y+75 *
N120 X+50 Y+95 *
N130 G98 L0 *
N99999999 %CTI G71 *
`;
    const a = parseHeidenhain(plainSrc);
    const b = parseHeidenhain(iso);
    expect(b.warnings).toEqual([]);
    const lineB = iso.split('\n').findIndex((l) => l.startsWith('N60 G79'));
    const idsB = [...Array(b.moves.count).keys()].filter((i) => b.moves.line[i] === lineB);
    expect([...passes(b, idsB).values()].map((s) => s.map(p3))).toEqual([...passes(a, callMoves(a, plainSrc)).values()].map((s) => s.map(p3)));
  });
});

describe('사이클 270 윤곽 트레인 자료(9.9절 290~291쪽)', () => {
  it('Q390 = 1 접선 원호(반지름 Q392 5·중심각 Q393 90°): 원호 시작점에서 내려가 원호로 들어가고 끝에서 같은 꼴로 나옴', () => {
    const src = prog({ Q1: -5 }, EX.replace(' RL', ''), `5 ${data270({})}\n`);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    const ids = callMoves(p, src);
    // 시작점 위로 급속 → 접근 원호 시작점 (-14.142, 22.071)
    const firstDown = ids.find((i) => p.moves.kind[i] === MOVE_FEED && r3(moveEnd(p.moves, i)[2]) === -5)!;
    expect(p3(moveEnd(p.moves, firstDown))).toEqual([-14.142, 22.071, -5]);
    const arcs = ids.filter((i) => p.moves.kind[i] === MOVE_ARC);
    const first = arcs[0]!;
    expect(p3(moveEnd(p.moves, first))).toEqual([...S, -5]);
    expect(r3(p.arcs.sweep[p.moves.arc[first]!]!)).toBe(r3(Math.PI / 2));
    // 이탈 원호 끝
    expect(p3(moveEnd(p.moves, arcs[arcs.length - 1]!))).toEqual([109.099, 92.931, -5]);
  });
  it('Q390 = 2 접선 직선·3 수직(Q394 5), Q391이 윤곽 부프로그램의 RL·RR을 대신함(알림)', () => {
    const tan = prog({ Q1: -5 }, EX.replace(' RL', ''), `5 ${data270({ Q390: 2, Q394: 5 })}\n`);
    const a = parseHeidenhain(tan);
    const down = callMoves(a, tan).find((i) => a.moves.kind[i] === MOVE_FEED && r3(moveEnd(a.moves, i)[2]) === -5)!;
    expect(p3(moveEnd(a.moves, down))).toEqual([-10.607, 18.536, -5]);
    const perp = prog({ Q1: -5 }, EX.replace(' RL', ''), `5 ${data270({ Q390: 3, Q394: 5 })}\n`);
    const b = parseHeidenhain(perp);
    const down2 = callMoves(b, perp).find((i) => b.moves.kind[i] === MOVE_FEED && r3(moveEnd(b.moves, i)[2]) === -5)!;
    expect(p3(moveEnd(b.moves, down2))).toEqual([-10.607, 25.607, -5]);
    // RL이 있는 윤곽 + Q391 = 2(RR): 오른쪽으로(하향이라 거꾸로) — 알림
    const over = prog({ Q1: -5 }, EX, `5 ${data270({ Q390: 0, Q391: 2 })}\n`);
    const c = parseHeidenhain(over);
    expect(plain(c.warnings)).toEqual(['CYCL DEF 25: 사이클 270이 있어 윤곽 부프로그램의 RL·RR 대신 Q391로 그림']);
    expect(p3(passes(c, callMoves(c, over)).get(-5)![0]!.slice(0, 2))).toEqual([97.127, 70.422]);
    // Q391 = 0(R0)이면 접근·이탈을 그리지 않음
    const r0 = prog({ Q1: -5 }, EX.replace(' RL', ''), `5 ${data270({ Q390: 1, Q391: 0 })}\n`);
    expect(plain(parseHeidenhain(r0).warnings)).toEqual(['CYCL DEF 25: 보정 없이(R0) 접근·이탈(Q390)은 그리지 않음']);
  });
});

describe('새 경고 글은 네 언어 사전에 있다', () => {
  it('한국어 글자가 남지 않는다', () => {
    const texts = [
      'CYCL DEF 25: 깊이(Q1)가 0이라 그리지 않음',
      'CYCL DEF 25: 윤곽 LBL이 여럿이라 첫 LBL 1만 씀',
      'CYCL DEF 25: 사이클 270이 있어 윤곽 부프로그램의 RL·RR 대신 Q391로 그림',
      'CYCL DEF 25: 윤곽에 RL·RR이 없어 공구 중심이 윤곽 위를 감(하향·상향 Q15는 프로그램 차례로)',
      'CYCL DEF 25: Q18(앞서 거친 깎기 한 공구)이 남긴 곳만 깎는 것은 그리지 않고 윤곽 전체를 그림',
      'CYCL DEF 25: 공구가 커서 윤곽 일부는 깎지 않음(윤곽을 깎아 들어가지 않게)',
      'CYCL DEF 25: 안전 높이(Q7)가 없어 지금 공구 높이로 셈',
      'CYCL DEF 25: 보정 없이(R0) 접근·이탈(Q390)은 그리지 않음',
      'CYCL DEF 25: 앞에 CYCL DEF 14(윤곽)가 없어 그리지 않음',
      'CYCL DEF 25: 공구가 윤곽보다 커서 그리지 않음',
      'CYCL DEF 25: 층이 9999개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감',
    ];
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate('CYCL DEF 25: 윤곽 LBL이 여럿이라 첫 LBL 3만 씀', 'en')).toBe('CYCL DEF 25: several contour LBLs — only the first one, LBL 3, is used');
  });
});
