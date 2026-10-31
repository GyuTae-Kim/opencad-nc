/**
 * Heidenhain PATTERN DEF·CYCL CALL PAT(34차): HEIDENHAIN 공식 설명서(TNC 640 가공 사이클 프로그래밍 34059x-17 3.3절, TNC 320 사이클 프로그래밍 771851-06 3.3절)의
 * 입력 값 차례·절대/증분·각 기준과 위치 사이 옮기기(안전 높이·이송), GLOBAL DEF 125 Q345, 원점 이동·회전, 경고와 한도. 모두 직접 만든 작은 합성 프로그램
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { parseHeidenhain } from '../src/heidenhain';
import { FLAG_CYCLE, MOVE_DRILL, MOVE_FEED, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const pgm = (body: string): string => `0 BEGIN PGM PAT MM\n${body}\n99 END PGM PAT MM\n`;
const tops = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.holes.count; i++) out.push([0, 1, 2].map((a) => r3(p.holes.top[i * 3 + a]!)));
  return out;
};
const bottoms = (p: NcProgram): number[] => {
  const out: number[] = [];
  for (let i = 0; i < p.holes.count; i++) out.push(r3(p.holes.bottom[i * 3 + 2]!));
  return out;
};
/** 그 줄에서 나온 이동(끝점·종류·이송) */
const movesAt = (p: NcProgram, line: number): { end: number[]; kind: number; feed: number; flags: number }[] => {
  const out: { end: number[]; kind: number; feed: number; flags: number }[] = [];
  for (let i = 0; i < p.moves.count; i++)
    if (p.moves.line[i] === line) out.push({ end: moveEnd(p.moves, i).map(r3), kind: p.moves.kind[i]!, feed: p.moves.feed[i]!, flags: p.moves.flags[i]! });
  return out;
};
const lineOf = (src: string, text: string): number => src.split('\n').findIndex((l) => l.includes(text));

const DRILL = `CYCL DEF 200 DRILLING ~
  Q200=+2 ;SET-UP CLEARANCE ~
  Q201=-5 ;DEPTH ~
  Q206=+150 ;FEED RATE FOR PLNGNG ~
  Q202=+5 ;PLUNGING DEPTH ~
  Q210=+0 ;DWELL TIME AT TOP ~
  Q203=+0 ;SURFACE COORDINATE ~
  Q204=+10 ;2ND SET-UP CLEARANCE ~
  Q211=+0 ;DWELL TIME AT DEPTH`;

describe('Heidenhain PATTERN DEF와 CYCL CALL PAT', () => {
  const SRC = pgm(`1 BLK FORM 0.1 Z X+0 Y+0 Z-20
2 BLK FORM 0.2 X+100 Y+100 Z+0
3 TOOL CALL 1 Z S5000
4 L X+0 Y+0 Z+50 R0 FMAX
5 PATTERN DEF ~
  POS1( X+10 Y+10 Z+0 ) ~
  POS2( X+40 Y+30 Z+0 ) ~
  POS3( IX+10 IY-5 Z+0 )
6 ${DRILL}
7 CYCL CALL PAT F5000 M3
8 L Z+100 R0 FMAX`);

  it('POS(둘째부터 증분): 위치마다 200번 사이클, 위치 사이는 부른 높이(Z+50)에서 그 블록 F로, 공구 축은 급속', () => {
    const p = parseHeidenhain(SRC);
    expect(p.warnings).toEqual([]);
    expect(tops(p)).toEqual([
      [10, 10, 2],
      [40, 30, 2],
      [50, 25, 2],
    ]);
    expect(bottoms(p)).toEqual([-5, -5, -5]);
    const m = movesAt(p, lineOf(SRC, 'CYCL CALL PAT'));
    const F = MOVE_FEED;
    const R = MOVE_RAPID;
    const D = MOVE_DRILL;
    expect(m.map((x) => [...x.end, x.kind])).toEqual([
      [10, 10, 50, F],
      [10, 10, 2, R],
      [10, 10, -5, D],
      [10, 10, 10, R],
      [10, 10, 50, R],
      [40, 30, 50, F],
      [40, 30, 2, R],
      [40, 30, -5, D],
      [40, 30, 10, R],
      [40, 30, 50, R],
      [50, 25, 50, F],
      [50, 25, 2, R],
      [50, 25, -5, D],
      [50, 25, 10, R],
      [50, 25, 50, R],
    ]);
    // 위치 사이는 CYCL CALL PAT의 F, 드릴은 Q206 — 모두 사이클 이동
    expect(m.filter((x) => x.kind === F).map((x) => x.feed)).toEqual([5000, 5000, 5000]);
    expect(m.filter((x) => x.kind === D).map((x) => x.feed)).toEqual([150, 150, 150]);
    expect(m.every((x) => (x.flags & FLAG_CYCLE) !== 0)).toBe(true);
  });

  it('이어 쓰기(~) 없이 다음 줄에 쓴 요소(예전 설명서 꼴)도 같은 패턴', () => {
    const old = pgm(`1 TOOL CALL 1 Z S5000
2 L X+0 Y+0 Z+50 R0 FMAX
3 PATTERN DEF
POS1( X+10 Y+10 Z+0 )
POS2( X+40 Y+30 Z+0 )
POS3( IX+10 IY-5 Z+0 )
4 CYCL DEF 200 DRILLING
Q200=+2 ;SET-UP CLEARANCE
Q201=-5 ;DEPTH
Q206=+150 ;FEED RATE FOR PLNGNG
Q202=+5 ;PLUNGING DEPTH
Q203=+0 ;SURFACE COORDINATE
Q204=+10 ;2ND SET-UP CLEARANCE
5 CYCL CALL PAT F5000 M3`);
    const p = parseHeidenhain(old);
    expect(p.warnings).toEqual([]);
    expect(tops(p)).toEqual(tops(parseHeidenhain(SRC)));
  });

  it('GLOBAL DEF 125 Q345=1: 위치 사이를 늘 2차 안전 거리로(경고는 34차 전과 같음)', () => {
    const src = SRC.replace('7 CYCL CALL PAT', '7 GLOBAL DEF 125 POSITIONING ~\n  Q345=+1 ;SELECT POS. HEIGHT\n7 CYCL CALL PAT');
    const p = parseHeidenhain(src);
    expect(tops(p)).toEqual(tops(parseHeidenhain(SRC)));
    const m = movesAt(p, lineOf(src, 'CYCL CALL PAT'));
    // 첫 위치는 부른 높이(Z+50)에서 옮기고(내리지 않음), 그다음부터는 2차 안전 거리 Z+10에서
    expect(m.filter((x) => x.kind === MOVE_FEED).map((x) => x.end)).toEqual([
      [10, 10, 50],
      [40, 30, 10],
      [50, 25, 10],
    ]);
    expect(m[m.length - 1]!.end).toEqual([50, 25, 10]);
    expect(p.warnings.some((w) => w.includes("알 수 없는 블록 'GLOBAL'"))).toBe(true);
    // 예전 꼴(Q345가 다음 줄)도 같다
    const old = SRC.replace('7 CYCL CALL PAT', '7 GLOBAL DEF 125 POSITIONING\nQ345=+1 ;SELECT POS. HEIGHT\n7 CYCL CALL PAT');
    expect(movesAt(parseHeidenhain(old), lineOf(old, 'CYCL CALL PAT')).map((x) => x.end)).toEqual(m.map((x) => x.end));
  });

  it('FMAX면 위치 사이를 급속으로, F가 없으면 마지막 이송으로', () => {
    const fmax = SRC.replace('CYCL CALL PAT F5000 M3', 'CYCL CALL PAT FMAX M3');
    const a = movesAt(parseHeidenhain(fmax), lineOf(fmax, 'CYCL CALL PAT'));
    expect(a.filter((x) => x.kind === MOVE_FEED)).toEqual([]);
    expect(a.filter((x) => x.end[2] === 50 && x.kind === MOVE_RAPID).length).toBe(6);
    const noF = SRC.replace('4 L X+0 Y+0 Z+50 R0 FMAX', '4 L X+0 Y+0 Z+50 R0 F300').replace('CYCL CALL PAT F5000 M3', 'CYCL CALL PAT M3');
    const b = movesAt(parseHeidenhain(noF), lineOf(noF, 'CYCL CALL PAT'));
    expect(b.filter((x) => x.kind === MOVE_FEED).map((x) => x.feed)).toEqual([300, 300, 300]);
  });

  it('ROW·PAT(돌림·일그러뜨림)·CIRC·PITCHCIRC의 입력 값 차례와 각 기준(작업 평면 첫 축 X), 새 PATTERN DEF는 새 패턴', () => {
    const p = parseHeidenhain(
      pgm(`1 TOOL CALL 1 Z S5000
2 L X+0 Y+0 Z+50 R0 FMAX
3 ${DRILL}
4 PATTERN DEF ~
  ROW1( X+10 Y+5 D+8 NUM3 ROT+90 Z+0 )
5 CYCL CALL PAT F1000
6 PATTERN DEF ~
  PAT1( X+0 Y+0 DX+10 DY+20 NUMX2 NUMY2 ROT+90 ROTX+0 ROTY+0 Z+0 )
7 CYCL CALL PAT F1000
8 PATTERN DEF ~
  PAT1( X+100 Y+0 DX+10 DY+10 NUMX2 NUMY2 ROT+0 ROTX+0 ROTY+45 Z+0 )
9 CYCL CALL PAT F1000
10 PATTERN DEF ~
  CIRC1( X+50 Y+50 D40 START+90 NUM4 Z+0 )
11 CYCL CALL PAT F1000
12 PATTERN DEF ~
  PITCHCIRC1( X+0 Y+0 D20 START+0 STEP+30 NUM3 Z+0 )
13 CYCL CALL PAT F1000`),
    );
    expect(p.warnings).toEqual([]);
    expect(tops(p).map((t) => [t[0], t[1]])).toEqual([
      // ROW: 시작점에서 ROT(90°) 방향으로 D씩
      [10, 5],
      [10, 13],
      [10, 21],
      // PAT ROT+90: 열(DX)은 +Y로, 줄(DY)은 −X로 — 줄마다 첫 열부터
      [0, 0],
      [0, 10],
      [-20, 0],
      [-20, 10],
      // PAT ROTY+45: 둘째 축만 45° 더 돌림(열은 X 그대로)
      [100, 0],
      [110, 0],
      [92.929, 7.071],
      [102.929, 7.071],
      // CIRC: START에서 고르게 NUM개(반시계)
      [50, 70],
      [30, 50],
      [50, 30],
      [70, 50],
      // PITCHCIRC: START에서 STEP씩
      [10, 0],
      [8.66, 5],
      [5, 8.66],
    ]);
  });

  it('Z는 사이클 공작물 윗면(Q203)에 더함 — 안전 높이는 가장 높은 윗면 + Q204, 끝나면 Q203은 그대로', () => {
    const src = pgm(`1 TOOL CALL 1 Z S5000
2 L X+0 Y+0 Z+5 R0 FMAX
3 CYCL DEF 200 DRILLING ~
  Q200=+2 ;SET-UP CLEARANCE ~
  Q201=-3 ;DEPTH ~
  Q206=+150 ;FEED RATE FOR PLNGNG ~
  Q202=+0 ;PLUNGING DEPTH ~
  Q203=-2 ;SURFACE COORDINATE ~
  Q204=+10 ;2ND SET-UP CLEARANCE
4 PATTERN DEF ~
  POS1( X+0 Y+0 Z+5 ) ~
  POS2( X+20 Y+0 IZ-5 )
5 CYCL CALL PAT F1000
6 L X+50 Y+50 R0 FMAX M99`);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    // 윗면 −2+5 = 3 → 구멍 위 5·바닥 0, 윗면 −2+0 → 위 0·바닥 −5, 다음 M99는 Q203 = −2 그대로
    expect(tops(p)).toEqual([
      [0, 0, 5],
      [20, 0, 0],
      [50, 50, 0],
    ]);
    expect(bottoms(p)).toEqual([0, -5, -5]);
    // 부른 높이 Z+5가 안전 높이 3 + 10 = 13보다 낮아 먼저 13으로 올리고(첫 자리는 그 위라 옮기지 않음), 두 번째 자리로도 13에서(낮은 윗면 기준 8로 내리지 않음)
    const m = movesAt(p, lineOf(src, 'CYCL CALL PAT'));
    expect(m[0]).toMatchObject({ end: [0, 0, 13], kind: MOVE_RAPID });
    expect(m.filter((x) => x.kind === MOVE_FEED).map((x) => x.end)).toEqual([[20, 0, 13]]);
    expect(m[m.length - 1]!.end).toEqual([20, 0, 13]);
  });

  it('원점 이동·회전은 CYCL CALL PAT 때의 것을 쓴다', () => {
    const body = (xf: string): string =>
      pgm(`1 TOOL CALL 1 Z S5000
2 L X+0 Y+0 Z+50 R0 FMAX
3 PATTERN DEF ~
  POS1( X+0 Y+0 Z+0 ) ~
  POS2( X+10 Y+0 Z+0 )
4 ${DRILL}
${xf}
6 CYCL CALL PAT F1000`);
    expect(tops(parseHeidenhain(body('5 TRANS DATUM AXIS X+100 Y+50'))).map((t) => [t[0], t[1]])).toEqual([
      [100, 50],
      [110, 50],
    ]);
    expect(tops(parseHeidenhain(body('5 CYCL DEF 10.0 ROTATION\n5 CYCL DEF 10.1 ROT+90'))).map((t) => [t[0], t[1]])).toEqual([
      [0, 0],
      [0, 10],
    ]);
  });

  it('밀링 사이클(252 원 포켓)도 위치마다 같은 길을 옮겨 그린다', () => {
    const body = (pos: string): string =>
      pgm(`1 TOOL DEF 1 L+0 R+2
2 TOOL CALL 1 Z S5000
3 L X+0 Y+0 Z+50 R0 FMAX
4 CYCL DEF 252 CIRCULAR POCKET ~
  Q215=+0 ;MACHINING OPERATION ~
  Q223=+20 ;CIRCLE DIAMETER ~
  Q207=+500 ;FEED RATE MILLING ~
  Q201=-4 ;DEPTH ~
  Q202=+2 ;PLUNGING DEPTH ~
  Q206=+150 ;FEED RATE FOR PLNGNG ~
  Q200=+2 ;SET-UP CLEARANCE ~
  Q203=+0 ;SURFACE COORDINATE ~
  Q204=+10 ;2ND SET-UP CLEARANCE ~
  Q370=+1 ;TOOL PATH OVERLAP
5 PATTERN DEF ~
  ${pos}
6 CYCL CALL PAT F2000`);
    const one = body('POS1( X+30 Y+30 Z+0 )');
    const two = body('POS1( X+30 Y+30 Z+0 ) ~\n  POS2( X+70 Y+40 Z+0 )');
    const a = parseHeidenhain(one);
    const b = parseHeidenhain(two);
    expect(a.warnings).toEqual([]);
    const ma = movesAt(a, lineOf(one, 'CYCL CALL PAT'));
    const mb = movesAt(b, lineOf(two, 'CYCL CALL PAT'));
    expect(ma.length).toBeGreaterThan(10);
    expect(mb.length).toBe(2 * ma.length);
    // 둘째 위치의 길(첫 옮기기 뒤) = 첫 위치의 길을 (40, 10) 옮긴 것
    const second = mb.slice(ma.length + 1).map((x) => [r3(x.end[0]! - 40), r3(x.end[1]! - 10), x.end[2]]);
    expect(second).toEqual(ma.slice(1).map((x) => x.end));
    expect(a.arcs.count * 2).toBe(b.arcs.count);
  });

  it('경고: FRAME·값이 모자란 요소는 빼고 나머지만, 첫 POS 증분, 위치 수 한도, 점 표·PATTERN DEF 없음·다른 공구 축·부르지 않는 사이클', () => {
    const warn = (body: string): string[] => parseHeidenhain(pgm(body)).warnings;
    const p = parseHeidenhain(
      pgm(`1 TOOL CALL 1 Z S5000
2 L X+0 Y+0 Z+50 R0 FMAX
3 ${DRILL}
4 PATTERN DEF ~
  FRAME1( X+0 Y+0 DX+10 DY+10 NUMX3 NUMY3 ROT+0 ROTX+0 ROTY+0 Z+0 ) ~
  ROW1( X+0 Y+0 NUM3 ROT+0 Z+0 ) ~
  CIRC1( X+0 Y+0 D10 START+0 NUM2.5 Z+0 ) ~
  PITCHCIRC1( X+0 Y+0 D10 START+0 END+90 NUM3 Z+0 ) ~
  POS1( X+5 Y+5 Z+0 )
5 CYCL CALL PAT F1000`),
    );
    expect(tops(p).map((t) => [t[0], t[1]])).toEqual([[5, 5]]);
    expect(p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''))).toEqual([
      'PATTERN DEF FRAME(테두리 꼴)은 지원하지 않음 — 그 자리는 빼고 그림',
      'PATTERN DEF ROW: 값이 모자라거나 맞지 않아 그 자리는 빼고 그림',
      'PATTERN DEF CIRC: 값이 모자라거나 맞지 않아 그 자리는 빼고 그림',
      'PATTERN DEF PITCHCIRC: 값이 모자라거나 맞지 않아 그 자리는 빼고 그림',
    ]);
    expect(warn('1 PATTERN DEF ~\n  POS1( IX+5 IY+5 Z+0 )')).toEqual(['2번 줄: PATTERN DEF POS: 값이 모자라거나 맞지 않아 그 자리는 빼고 그림']);
    expect(warn('1 PATTERN DEF ~\n  PAT1( X+0 Y+0 DX+1 DY+1 NUMX999 NUMY999 ROT+0 ROTX+0 ROTY+0 Z+0 )')).toEqual([
      '2번 줄: PATTERN DEF PAT: 가공 위치가 100000개를 넘어 거기까지 그림',
    ]);
    const call = '9 CYCL CALL PAT F1000';
    expect(warn(`1 ${DRILL}\n2 SEL PATTERN "HOLES.PNT"\n${call}`)).toEqual(['11번 줄: SEL 블록은 지원하지 않음', '12번 줄: SEL PATTERN 점 표는 읽지 않아 CYCL CALL PAT를 그리지 않음']);
    expect(warn(`1 ${DRILL}\n${call}`)).toEqual(['11번 줄: PATTERN DEF 없이 CYCL CALL PAT — 그리지 않음']);
    expect(warn(`1 TOOL CALL 1 X S5000\n2 PATTERN DEF ~\n  POS1( X+5 Y+5 Z+0 )\n3 ${DRILL}\n${call}`)).toEqual(['14번 줄: PATTERN DEF는 공구 축 Z에서만 씀 — CYCL CALL PAT를 그리지 않음']);
    expect(warn(`1 PATTERN DEF ~\n  POS1( X+5 Y+5 Z+0 )\n3 CYCL DEF 1.0 PECKING\n4 CYCL DEF 1.2 DEPTH -10\n${call}`)).toEqual(['6번 줄: CYCL CALL PAT: 사이클 1은 가공 위치마다 부르지 않음 — 그리지 않음']);
    expect(warn(`1 PATTERN DEF ~\n  POS1( X+5 Y+5 Z+0 )\n3 CYCL DEF 232 FACE MILLING ~\n  Q225=+0 ~\n  Q386=-1\n${call}`)).toEqual(['7번 줄: CYCL CALL PAT: 사이클 232은 가공 위치마다 부르지 않음 — 그리지 않음']);
  });

  it('PATTERN DEF는 그냥 CYCL CALL·M99를 바꾸지 않는다', () => {
    const src = pgm(`1 TOOL CALL 1 Z S5000
2 L X+0 Y+0 Z+50 R0 FMAX
3 PATTERN DEF ~
  POS1( X+10 Y+10 Z+0 )
4 ${DRILL}
5 L X+30 Y+30 R0 FMAX M99
6 CYCL CALL`);
    expect(tops(parseHeidenhain(src))).toEqual([
      [30, 30, 2],
      [30, 30, 2],
    ]);
  });

  it('새 경고 글은 네 언어 사전에 있다', () => {
    const texts = [
      'PATTERN DEF FRAME(테두리 꼴)은 지원하지 않음 — 그 자리는 빼고 그림',
      'PATTERN DEF ROW: 값이 모자라거나 맞지 않아 그 자리는 빼고 그림',
      'PATTERN DEF PAT: 가공 위치가 100000개를 넘어 거기까지 그림',
      'SEL PATTERN 점 표는 읽지 않아 CYCL CALL PAT를 그리지 않음',
      'PATTERN DEF 없이 CYCL CALL PAT — 그리지 않음',
      'PATTERN DEF는 공구 축 Z에서만 씀 — CYCL CALL PAT를 그리지 않음',
      'CYCL CALL PAT: 사이클 232은 가공 위치마다 부르지 않음 — 그리지 않음',
      'CYCL DEF 220: 부를 드릴 사이클이 없음',
    ];
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate('PATTERN DEF PAT: 가공 위치가 100000개를 넘어 거기까지 그림', 'en')).toBe('PATTERN DEF PAT: more than 100000 machining positions — drawn up to that limit');
    // 옛 번역: "부를"(call)을 "셀"(count)·말풍선으로, 포켓을 공구 꽂이·자리로 옮겼던 것
    expect(translate('CYCL DEF 220: 부를 드릴 사이클이 없음', 'en')).toBe('CYCL DEF 220: no drill cycle to call');
    expect(translate('CYCL DEF 220: 부를 드릴 사이클이 없음', 'ja')).not.toContain('吹き出し');
    expect(translate('CYCL DEF 252: 공구가 포켓보다 큼', 'zh-CN')).toBe('CYCL DEF 252：刀具大于型腔');
    expect(translate('CYCL DEF 252: 공구가 포켓보다 큼', 'de')).toBe('CYCL DEF 252: Werkzeug ist größer als die Tasche');
  });
});
