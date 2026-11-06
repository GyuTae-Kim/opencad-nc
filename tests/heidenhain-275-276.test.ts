/**
 * Heidenhain 사이클 275 트로코이드 홈·276 3D 윤곽 트레인(50차): HEIDENHAIN TNC 640 가공 사이클 프로그래밍 설명서(34059x-17, 10/2022)
 * 9.11절 296~301쪽(275 — 홈 가운데 선, 닫힌·열린 홈, 원 운동으로 한 바퀴에 Q436씩, 너비 = 공구 지름이면 긴 구멍, 너비는 공구 지름의 두 배까지,
 * 옆·바닥 여유가 있을 때만 다듬질, Q201 = 0이면 실행하지 않음)과 9.12절 302~306쪽(276 — 25에 윤곽 부프로그램의 공구 축 좌표를 더함, Q1 = 0이면
 * 그 좌표 그대로 한 번, 아니면 Q10씩 되풀이). 기대 값은 손으로 셈한 것. 모두 직접 만든 작은 합성 프로그램
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { parseHeidenhain } from '../src/heidenhain';
import { MOVE_ARC, MOVE_FEED, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const plain = (ws: string[]): string[] => ws.map((w) => w.replace(/^\d+번 줄: /, ''));
const qs = (q: Record<string, number>): string =>
  Object.entries(q)
    .map(([k, v]) => `  ${k}=${v >= 0 ? '+' : ''}${v}`)
    .join(' ~\n');
/** 설명서 301쪽 예제 값(공구 반지름 3 — 지름 6, 홈 너비 10). extra는 사이클 앞에 끼우는 블록 */
const slot = (q: Record<string, number>, contour: string, extra = ''): string => `0 BEGIN PGM T MM
1 BLK FORM 0.1 Z X+0 Y+0 Z-40
2 BLK FORM 0.2 X+100 Y+100 Z+0
3 TOOL DEF 1 L+0 R+3
4 TOOL CALL 1 Z S3000
5 L Z+100 R0 FMAX M3
${extra}6 CYCL DEF 14.0 CONTOUR
7 CYCL DEF 14.1 CONTOUR LABEL 10
8 CYCL DEF 275 TROCHOIDAL SLOT ~
${qs({ Q215: 0, Q219: 10, Q368: 0, Q436: 2, Q207: 500, Q351: 1, Q201: -20, Q202: 5, Q206: 150, Q338: 0, Q385: 500, Q200: 2, Q203: 0, Q204: 50, Q366: 0, Q369: 0, Q439: 0, ...q })}
9 CYCL CALL
10 L Z+250 R0 FMAX M2
11 LBL 10
${contour}
12 LBL 0
13 END PGM T MM
`;
const train3 = (q: Record<string, number>, contour: string, extra = ''): string => `0 BEGIN PGM T MM
3 TOOL DEF 1 L+0 R+3
4 TOOL CALL 1 Z S3000
5 L Z+100 R0 FMAX M3
${extra}6 CYCL DEF 14.0 CONTOUR
7 CYCL DEF 14.1 CONTOUR LABEL 10
9 CYCL DEF 276 THREE-D CONT. TRAIN ~
${qs({ Q1: 0, Q3: 0, Q7: 50, Q10: -5, Q11: 150, Q12: 500, Q15: 1, Q18: 0, Q446: 0.01, Q447: 10, Q448: 2, ...q })}
10 CYCL CALL
11 L Z+250 R0 FMAX M2
12 LBL 10
${contour}
13 LBL 0
14 END PGM T MM
`;
/** CYCL CALL 줄에서 그린 이동 */
const callMoves = (p: NcProgram, src: string): number[] => {
  const line = src.split('\n').findIndex((l) => /^\d+ CYCL CALL/.test(l));
  return [...Array(p.moves.count).keys()].filter((i) => p.moves.line[i] === line);
};
/** 이송 끝점의 서로 다른 높이(위 → 아래) */
const levels = (p: NcProgram, ids: number[]): number[] =>
  [...new Set(ids.filter((i) => p.moves.kind[i] === MOVE_FEED || p.moves.kind[i] === MOVE_ARC).map((i) => r3(moveEnd(p.moves, i)[2])))].sort((a, b) => b - a);
/** z 높이의 평면 이동 끝점들 */
const at = (p: NcProgram, ids: number[], z: number): number[][] =>
  ids.filter((i) => (p.moves.kind[i] === MOVE_FEED || p.moves.kind[i] === MOVE_ARC) && r3(moveEnd(p.moves, i)[2]) === z && r3(moveStart(p.moves, i)[2]) === z).map((i) => moveEnd(p.moves, i));
/** 끝점 열의 부호 있는 넓이(반시계 +) */
const area = (pts: number[][]): number => {
  let a = 0;
  for (let i = 0; i + 1 < pts.length; i++) a += pts[i]![0]! * pts[i + 1]![1]! - pts[i + 1]![0]! * pts[i]![1]!;
  return a / 2;
};
const W275 = 'CYCL DEF 275: 원 운동(트로코이드)의 반지름·나눔과 벽 다듬질의 들어가기·나가기는 설명서에 자세히 없어 정해 그림';

describe('사이클 275 트로코이드 홈(9.11절 296~301쪽)', () => {
  const LINE = 'L X+20 Y+50\nL X+80 Y+50';
  it('설명서 예제 값의 열린 홈: Q202씩 네 층, 원 운동이 홈 안(가운데 선에서 너비/2 − 공구 반지름), 한 바퀴에 Q436씩 나아감', () => {
    const src = slot({}, LINE);
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual([W275]);
    const ids = callMoves(p, src);
    expect(levels(p, ids)).toEqual([-5, -10, -15, -20]);
    // 원 반지름 5 − 3 = 2: 공구 중심은 y 48~52, x 18~82(처음·끝 자리에서 한 바퀴씩)
    const pts = at(p, ids, -10);
    for (const q of pts) {
      expect(Math.abs(q[1]! - 50)).toBeLessThanOrEqual(2 + 1e-9);
      expect(q[0]!).toBeGreaterThanOrEqual(18 - 1e-9);
      expect(q[0]!).toBeLessThanOrEqual(82 + 1e-9);
    }
    expect(Math.min(...pts.map((q) => q[0]!))).toBeCloseTo(18, 6);
    expect(Math.max(...pts.map((q) => q[0]!))).toBeCloseTo(82, 6);
    // 길이 60 / Q436 2 = 30바퀴 + 처음·끝 한 바퀴씩 = 32바퀴 × 32토막 + 가운데로 들고 남
    expect(pts.length).toBe(32 * 32 + 1 + 1);
    // 하향(Q351 = +1, M3) → 원은 반시계: 첫 바퀴 넓이 +
    expect(area(pts.slice(1, 34))).toBeGreaterThan(0);
    // 마지막은 가운데 선 끝으로
    expect(pts.at(-1)!.map(r3)).toEqual([80, 50, -10]);
  });
  it('상향(Q351 = -1)은 시계, 한 축 대칭(사이클 8)이어도 화면에서 하향·상향은 그대로', () => {
    const up = parseHeidenhain(slot({ Q351: -1, Q201: -5 }, LINE));
    expect(area(at(up, callMoves(up, slot({ Q351: -1, Q201: -5 }, LINE)), -5).slice(1, 34))).toBeLessThan(0);
    const mir = '5 CYCL DEF 8.0 MIRROR IMAGE\n5 CYCL DEF 8.1 X\n';
    const src = slot({ Q201: -5 }, LINE, mir);
    const m = parseHeidenhain(src);
    const pts = at(m, callMoves(m, src), -5);
    expect(pts[1]![0]!).toBeLessThan(0);
    expect(area(pts.slice(1, 34))).toBeGreaterThan(0);
  });
  it('닫힌 홈(원 가운데 선) + 옆 여유: 거친 깎기는 가운데 선에서 1.5 안, 다듬질은 양쪽 벽(28·32) 두 바퀴', () => {
    const src = slot({ Q368: 0.5, Q201: -5 }, 'L X+50 Y+20\nCC X+50 Y+50\nC X+50 Y+20 DR+');
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual([W275]);
    const ids = callMoves(p, src);
    const feeds = ids.filter((i) => p.moves.kind[i] === MOVE_FEED && r3(moveEnd(p.moves, i)[2]) === -5);
    for (const i of feeds) {
      const e = moveEnd(p.moves, i);
      expect(Math.abs(Math.hypot(e[0] - 50, e[1] - 50) - 30)).toBeLessThanOrEqual(1.5 + 1e-6);
    }
    // 다듬질 원호(벽 길): 반지름 28·32 — 들어가는 반원(지름 2)도
    const radii = new Set(
      ids
        .filter((i) => p.moves.kind[i] === MOVE_ARC)
        .map((i) => {
          const e = moveEnd(p.moves, i);
          return r3(Math.hypot(e[0] - 50, e[1] - 50));
        }),
    );
    expect(radii.has(28)).toBe(true);
    expect(radii.has(32)).toBe(true);
  });
  it('너비 = 공구 지름이면 긴 구멍(가운데 선을 곧게), 너비가 공구 지름의 두 배를 넘으면 거친 깎기는 그리지 않음', () => {
    const src = slot({ Q219: 6 }, LINE);
    const p = parseHeidenhain(src);
    const ids = callMoves(p, src).filter((i) => p.moves.kind[i] === MOVE_FEED);
    for (const i of ids) expect(r3(moveEnd(p.moves, i)[1])).toBe(50);
    expect(levels(p, ids)).toEqual([-5, -10, -15, -20]);
    const wide = parseHeidenhain(slot({ Q219: 30 }, LINE));
    expect(plain(wide.warnings)).toEqual(['CYCL DEF 275: 홈 너비(Q219)가 공구 지름의 두 배를 넘어 거친 깎기는 그리지 않음']);
    expect(callMoves(wide, slot({ Q219: 30 }, LINE)).filter((i) => wide.moves.kind[i] === MOVE_FEED)).toEqual([]);
  });
  it('바닥 여유(Q369)는 거친 깎기를 여유만큼 위에서 멈추고 바닥에서 한 번 더(Q385), 다듬질만(Q215 = 2)이면 벽 길만 바닥에서', () => {
    const src = slot({ Q369: 0.3, Q201: -10 }, LINE);
    const p = parseHeidenhain(src);
    expect(levels(p, callMoves(p, src))).toEqual([-5, -9.7, -10]);
    const fin = slot({ Q215: 2, Q368: 0.5 }, LINE);
    const f = parseHeidenhain(fin);
    const ids = callMoves(f, fin);
    expect(levels(f, ids)).toEqual([-20]);
    // 벽 길: 오른쪽 벽(y 48)을 앞으로, 끝 반원, 왼쪽 벽(y 52)을 뒤로, 처음 반원
    const ends = at(f, ids, -20).map((q) => [r3(q[0]!), r3(q[1]!)]);
    expect(ends).toContainEqual([80, 48]);
    expect(ends).toContainEqual([80, 52]);
    expect(ends).toContainEqual([20, 52]);
    expect(ends).toContainEqual([20, 48]);
  });
  it('실행하지 않거나 그리지 않는 경우와 DIN/ISO G275', () => {
    expect(plain(parseHeidenhain(slot({ Q201: 0 }, LINE)).warnings)).toEqual(['CYCL DEF 275: 깊이(Q201)가 0이라 그리지 않음']);
    expect(plain(parseHeidenhain(slot({ Q215: 2 }, LINE)).warnings)).toEqual(['CYCL DEF 275: 다듬질 여유(Q368·Q369)가 없어 그리지 않음']);
    expect(plain(parseHeidenhain(slot({ Q219: 4 }, LINE)).warnings)).toEqual(['CYCL DEF 275: 홈 너비(Q219)가 없거나 공구보다 좁아 그리지 않음']);
    expect(plain(parseHeidenhain(slot({ Q436: 0 }, LINE)).warnings)).toEqual(['CYCL DEF 275: 한 바퀴에 나아감(Q436)이 0이라 거친 깎기는 그리지 않음']);
    expect(plain(parseHeidenhain(slot({ Q366: 2, Q201: -5 }, LINE)).warnings)).toEqual(['CYCL DEF 275: 왕복 들어가기(Q366 = 2)는 공구 표 ANGLE을 몰라 곧게 내려감', W275]);
    const plainSrc = slot({ Q201: -5 }, LINE);
    const iso = `%TS G71 *
N10 G99 T1 L+0 R+3 *
N20 T1 G17 S3000 *
N30 G00 Z+100 G40 *
N40 G37 P01 10 *
N50 G275 Q215=+0 Q219=+10 Q368=+0 Q436=+2 Q207=+500 Q351=+1 Q201=-5 Q202=+5 Q206=+150 Q338=+0 Q385=+500 Q200=+2 Q203=+0 Q204=+50 Q366=+0 Q369=+0 Q439=+0 *
N60 G79 *
N70 M30 *
N80 G98 L10 *
N90 G01 X+20 Y+50 *
N100 X+80 *
N110 G98 L0 *
N99999999 %TS G71 *
`;
    const a = parseHeidenhain(plainSrc);
    const b = parseHeidenhain(iso);
    expect(plain(b.warnings)).toEqual([W275]);
    const lineB = iso.split('\n').findIndex((l) => l.startsWith('N60 G79'));
    const idsB = [...Array(b.moves.count).keys()].filter((i) => b.moves.line[i] === lineB);
    expect(at(b, idsB, -5).map((q) => q.map(r3))).toEqual(at(a, callMoves(a, plainSrc), -5).map((q) => q.map(r3)));
  });
});

describe('사이클 276 3D 윤곽 트레인(9.12절 302~306쪽)', () => {
  // 사각 윤곽의 세 변: 아래 변이 Z 0 → -10으로 내려가고 위 변이 다시 0으로
  const RAMP = 'L X+10 Y+10 Z+0 RL\nL X+90 Z-10\nL Y+60\nL X+10 Z+0';
  it('Q1 = 0: 윤곽의 공구 축 좌표 그대로 한 번(공구 중심 경로의 점마다 윤곽 위 가장 가까운 자리의 높이)', () => {
    const src = train3({}, RAMP);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    const ids = callMoves(p, src).filter((i) => p.moves.kind[i] === MOVE_FEED || p.moves.kind[i] === MOVE_ARC);
    // 공구가 윤곽 왼쪽(RL)으로 3: 아래 변 y 13, 오른쪽 변 x 87, 위 변 y 57 — 안쪽 모서리 (87, 13)은 지나온 아래 변(x 87에서 -9.625),
    // (87, 57)은 지나온 오른쪽 변(-10), 끝은 위 변 끝(0)
    const ends = ids.map((i) => moveEnd(p.moves, i).map(r3));
    expect(ends).toEqual([
      [10, 13, 0],
      [87, 13, -9.625],
      [87, 57, -10],
      [10, 57, 0],
    ]);
  });
  it('Q1 ≠ 0: 그 좌표에서 Q10씩 Q1까지 되풀이하고, 기준면을 정해 그렸다고 알림', () => {
    const src = train3({ Q1: -6, Q10: -3 }, RAMP);
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual(['CYCL DEF 276: 깊이(Q1)는 윤곽 부프로그램의 공구 축 좌표에서부터 셈함(설명서에 기준면이 없어 정함)']);
    const ends = callMoves(p, src)
      .filter((i) => p.moves.kind[i] === MOVE_FEED)
      .map((i) => moveEnd(p.moves, i).map(r3));
    expect(ends).toContainEqual([87, 13, -12.625]);
    expect(ends).toContainEqual([87, 13, -15.625]);
    expect(ends).toContainEqual([10, 57, -6]);
    expect(Math.min(...ends.map((q) => q[2]!))).toBe(-16);
  });
  it('닫힌 나선 윤곽(반원 둘로 0 → -10): 끝이 시작점과 겹쳐도 지나온 쪽 높이(원호는 나선), 270 없이 RR이면 바깥(반지름 13)', () => {
    const HELIX = 'L X+60 Y+50 Z+0 RR\nCC X+50 Y+50\nC X+40 Y+50 Z-5 DR+\nC X+60 Y+50 Z-10 DR+';
    // 상향(Q15 = -1): RR(공구가 진행 방향 오른쪽)이면 프로그램 차례로 — 0에서 -10까지
    const up = train3({ Q15: -1 }, HELIX);
    const a = parseHeidenhain(up);
    expect(a.warnings).toEqual([]);
    const ia = callMoves(a, up).filter((i) => a.moves.kind[i] !== MOVE_RAPID);
    expect(ia.map((i) => moveEnd(a.moves, i).map(r3))).toEqual([
      [63, 50, 0],
      [37, 50, -5],
      [63, 50, -10],
    ]);
    // 하향(Q15 = +1)이면 거꾸로 — 끝(-10)에서 들어가 0까지
    const src = train3({}, HELIX);
    const p = parseHeidenhain(src);
    const ip = callMoves(p, src).filter((i) => p.moves.kind[i] !== MOVE_RAPID);
    expect(ip.map((i) => moveEnd(p.moves, i).map(r3))).toEqual([
      [63, 50, -10],
      [37, 50, -5],
      [63, 50, 0],
    ]);
    expect(ip.slice(1).every((i) => p.moves.kind[i] === MOVE_ARC)).toBe(true);
  });
  it('Q15 = 0(왕복): 두 번째 층은 거꾸로 돌며 높이도 윤곽을 따라감, 25의 경고 글은 276에도', () => {
    const src = train3({ Q1: -4, Q10: -2, Q15: 0 }, RAMP).replace('CONTOUR LABEL 10', 'CONTOUR LABEL 10 /11');
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toContain('CYCL DEF 276: 윤곽 LBL이 여럿이라 첫 LBL 10만 씀');
    const ends = callMoves(p, src)
      .filter((i) => p.moves.kind[i] === MOVE_FEED)
      .map((i) => moveEnd(p.moves, i).map(r3));
    // 첫 층(-2)은 앞으로 끝(10, 57)까지, 둘째 층(-4)은 그 자리에서 내려가 거꾸로 시작(10, 13)까지 — 모서리 높이는 지나온 변에서
    expect(ends).toEqual([
      [10, 13, -2],
      [87, 13, -11.625],
      [87, 57, -12],
      [10, 57, -2],
      [10, 57, -4],
      [87, 57, -13.625],
      [87, 13, -14],
      [10, 13, -4],
    ]);
  });
});

describe('새 경고 글은 네 언어 사전에 있다(50차)', () => {
  it('한국어 글자가 남지 않는다', () => {
    const texts = [
      W275,
      'CYCL DEF 275: 깊이(Q201)가 0이라 그리지 않음',
      'CYCL DEF 275: 홈 너비(Q219)가 없거나 공구보다 좁아 그리지 않음',
      'CYCL DEF 275: 다듬질 여유(Q368·Q369)가 없어 그리지 않음',
      'CYCL DEF 275: 홈 너비(Q219)가 공구 지름의 두 배를 넘어 거친 깎기는 그리지 않음',
      'CYCL DEF 275: 한 바퀴에 나아감(Q436)이 0이라 거친 깎기는 그리지 않음',
      'CYCL DEF 275: 왕복 들어가기(Q366 = 2)는 공구 표 ANGLE을 몰라 곧게 내려감',
      'CYCL DEF 275: 공구가 커서 홈 벽 다듬질은 그리지 않음',
      'CYCL DEF 275: 윤곽 LBL이 여럿이라 첫 LBL 4만 씀',
      'CYCL DEF 275: 앞에 CYCL DEF 14(윤곽)가 없어 그리지 않음',
      'CYCL DEF 275: 이동이 1000000개를 넘어 그 뒤는 그리지 않음',
      'CYCL DEF 276: 깊이(Q1)는 윤곽 부프로그램의 공구 축 좌표에서부터 셈함(설명서에 기준면이 없어 정함)',
      'CYCL DEF 276: 사이클 270이 있어 윤곽 부프로그램의 RL·RR 대신 Q391로 그림',
      'CYCL DEF 276: 윤곽에 RL·RR이 없어 공구 중심이 윤곽 위를 감(하향·상향 Q15는 프로그램 차례로)',
      'CYCL DEF 276: Q18(앞서 거친 깎기 한 공구)이 남긴 곳만 깎는 것은 그리지 않고 윤곽 전체를 그림',
      'CYCL DEF 276: 공구가 커서 윤곽 일부는 깎지 않음(윤곽을 깎아 들어가지 않게)',
      'CYCL DEF 276: 안전 높이(Q7)가 없어 지금 공구 높이로 셈',
      'CYCL DEF 276: 보정 없이(R0) 접근·이탈(Q390)은 그리지 않음',
      'CYCL DEF 276: 공구가 윤곽보다 커서 그리지 않음',
    ];
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate('CYCL DEF 276: 윤곽 LBL이 여럿이라 첫 LBL 3만 씀', 'en')).toBe('CYCL DEF 276: several contour LBLs — only the first one, LBL 3, is used');
  });
});
