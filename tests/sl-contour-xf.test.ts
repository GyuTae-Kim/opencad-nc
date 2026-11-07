/**
 * 윤곽 부프로그램 안의 좌표 변환(49차): HEIDENHAIN TNC 640 가공 사이클 프로그래밍 설명서(34059x-17, 10/2022) 9.1절 266쪽
 * "Coordinate transformations are permitted" — 윤곽 부프로그램 안의 좌표 변환은 그 윤곽과 뒤 부프로그램에 듣고, 사이클 뒤에는 되돌릴 필요가 없다.
 * 사이클 7(원점 이동)·8(대칭)·10(회전)·TRANS DATUM을 SL 사이클 22와 윤곽 트레인 25로 본다. 모두 직접 만든 작은 합성 프로그램
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { parseHeidenhain } from '../src/heidenhain';
import { MOVE_ARC, MOVE_FEED, moveEnd, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const lineOf = (src: string, text: string): number => src.split('\n').findIndex((l) => l.includes(text));
const movesAt = (p: NcProgram, line: number): number[] => [...Array(p.moves.count).keys()].filter((i) => p.moves.line[i] === line);
const cutBox = (p: NcProgram, ids: number[]): number[] => {
  const pts = ids.filter((i) => p.moves.kind[i] === MOVE_FEED || p.moves.kind[i] === MOVE_ARC).map((i) => moveEnd(p.moves, i));
  return [0, 1].flatMap((a) => [r3(Math.min(...pts.map((q) => q[a]!))), r3(Math.max(...pts.map((q) => q[a]!)))]);
};
const data = 'CYCL DEF 20 CONTOUR DATA Q1=-4 Q2=1 Q3=0 Q4=0 Q5=0 Q6=2 Q7=20 Q8=0 Q9=1';
const rough = 'CYCL DEF 22 ROUGH-OUT Q10=0 Q11=150 Q12=500 Q18=0 Q19=0 Q208=99999 Q401=100 Q404=0';
/** 사각 윤곽(X 0~80, Y 0~60, 시계 + RR = 포켓) */
const square = 'L X+0 Y+0 RR\nL Y+60\nL X+80\nL Y+0\nL X+0';
const prog = (labels: string, subs: string, cycle = `${data}\n7 ${rough}`): string => `0 BEGIN PGM XF MM
1 TOOL DEF 1 L+0 R+5
2 TOOL CALL 1 Z S3000
3 L X+0 Y+0 Z+50 R0 FMAX
4 CYCL DEF 14.0 CONTOUR
5 CYCL DEF 14.1 CONTOUR ${labels}
6 ${cycle}
8 CYCL CALL
9 L X+10 Y+10 FMAX
10 M30
${subs}
99 END PGM XF MM
`;

describe('윤곽 부프로그램 안의 좌표 변환(설명서 9.1절 266쪽)', () => {
  it('사이클 7 원점 이동: 그 윤곽이 옮겨 그려지고, 사이클 뒤 이동은 옮기지 않은 자리(되돌림)', () => {
    const src = prog('LABEL1', `11 LBL 1\n12 CYCL DEF 7.0 DATUM SHIFT\n13 CYCL DEF 7.1 X+100\n${square}\n14 LBL 0`);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    expect(cutBox(p, movesAt(p, lineOf(src, '8 CYCL CALL')))).toEqual([105, 175, 5, 55]);
    const after = movesAt(p, lineOf(src, '9 L X+10'));
    expect(moveEnd(p.moves, after[after.length - 1]!).slice(0, 2).map(r3)).toEqual([10, 10]);
  });
  it('뒤 부프로그램에도 듣는다: 첫 윤곽(포켓)의 TRANS DATUM이 둘째 윤곽(섬)도 옮김', () => {
    // 섬 X 30~50·Y 20~40(시계 + RL)을 포켓과 함께 +100 옮김 — 공구 중심은 섬에서 5 밖
    const island = 'L X+30 Y+20 RL\nL Y+40\nL X+50\nL Y+20\nL X+30';
    const src = prog('LABEL1 /2', `11 LBL 1\n12 TRANS DATUM AXIS X+100\n${square}\n13 LBL 0\n14 LBL 2\n${island}\n15 LBL 0`);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    const ids = movesAt(p, lineOf(src, '8 CYCL CALL'));
    expect(cutBox(p, ids)).toEqual([105, 175, 5, 55]);
    for (const i of ids) {
      if (p.moves.kind[i] !== MOVE_FEED && p.moves.kind[i] !== MOVE_ARC) continue;
      const q = moveEnd(p.moves, i);
      // 옮긴 섬(X 130~150·Y 20~40)에서 공구 반지름 5보다 가까이 들어가지 않음
      const dx = Math.max(130 - q[0]!, 0, q[0]! - 150);
      const dy = Math.max(20 - q[1]!, 0, q[1]! - 40);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(5 - 1e-6);
    }
  });
  it('사이클 8 대칭(X): 대칭된 자리에 포켓 그대로(보정 쪽도 대칭 좌표에서 셈), 사이클 뒤에는 대칭 없음', () => {
    const src = prog('LABEL1', `11 LBL 1\n12 CYCL DEF 8.0 MIRROR IMAGE\n13 CYCL DEF 8.1 X\n${square}\n14 LBL 0`);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    expect(cutBox(p, movesAt(p, lineOf(src, '8 CYCL CALL')))).toEqual([-75, -5, 5, 55]);
    const after = movesAt(p, lineOf(src, '9 L X+10'));
    expect(moveEnd(p.moves, after[after.length - 1]!).slice(0, 2).map(r3)).toEqual([10, 10]);
  });
  it('사이클 10 회전 90°: 윤곽이 원점 둘레로 돌아 X -55~-5·Y 5~75', () => {
    const src = prog('LABEL1', `11 LBL 1\n12 CYCL DEF 10.0 ROTATION\n13 CYCL DEF 10.1 ROT+90\n${square}\n14 LBL 0`);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    expect(cutBox(p, movesAt(p, lineOf(src, '8 CYCL CALL')))).toEqual([-55, -5, 5, 75]);
  });
  it('사이클 26 축별 배율 아래 원호는 타원이 되어 끝점·중심만 옮긴 원호로 그리고 알린다(번역 있음)', () => {
    const circle = 'CC X+40 Y+30\nL X+70 Y+30 RR\nC X+70 Y+30 DR-';
    const src = prog('LABEL1', `11 LBL 1\n12 CYCL DEF 26.0 AXIS-SPECIFIC SCALING\n13 CYCL DEF 26.1 X1.5 CCX+0 CCY+0\n${circle}\n14 LBL 0`);
    const p = parseHeidenhain(src);
    const w = p.warnings.map((x) => x.replace(/^\d+번 줄: /, ''));
    expect(w).toEqual(['CYCL DEF 14: 윤곽 안 축별 배율로 원호가 타원이 되어 끝점·중심만 옮긴 원호로 그림']);
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(w[0]!, code)).not.toMatch(/[가-힣]/);
  });
  it('윤곽 트레인(사이클 25)에도: 원점 이동한 열린 윤곽을 따라', () => {
    const ct = 'CYCL DEF 25 CONTOUR TRAIN Q1=-5 Q3=0 Q5=0 Q7=50 Q10=-5 Q11=100 Q12=200 Q15=1 Q18=0 Q446=0.01 Q447=10 Q448=2';
    const src = prog('LABEL1', `11 LBL 1\n12 CYCL DEF 7.0 DATUM SHIFT\n13 CYCL DEF 7.1 Y+20\n14 L X+0 Y+0 RL\n15 L X+50\n16 LBL 0`, ct);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    // (0,20)→(50,20)에서 왼쪽(Y+)으로 5
    expect(cutBox(p, movesAt(p, lineOf(src, '8 CYCL CALL')))).toEqual([0, 50, 25, 25]);
  });
});
