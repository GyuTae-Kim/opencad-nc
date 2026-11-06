// Siemens POCKET1(사각 포켓)·POCKET2(원 포켓)(41차): SINUMERIK 840D sl 사이클 프로그래밍 설명서(6FC5398-3BP20-0BA0, 2006-11)
// 3.7절(130~135쪽)·3.8절(136~140쪽)의 매개변수 차례·순서대로, FFD·FFP1·MID·CDIR·FAL·VARI·MIDF·FFP2·SSF는 3.5절 SLOT1(120~121쪽) 설명대로 그린다.
// 실제 Siemens 표본이 없어 설명서 예제와 합성 프로그램으로만 시험한다
import { describe, expect, it } from 'vitest';
import { parseSiemens } from '../src/siemens';
import { FLAG_CYCLE, MOVE_ARC, MOVE_FEED, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

type Tools = Record<number, { diameter?: number; radius?: number }>;
const D10: Tools = { 1: { diameter: 10 } };
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const run = (text: string, toolTable: Tools | undefined = D10, maxMoves?: number): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable, maxMoves });
const end = (p: NcProgram, i: number): number[] => moveEnd(p.moves, i).map(r3);
/** 포켓 사이클이 만든 이동(FLAG_CYCLE) 차례 */
const cyc = (p: NcProgram): number[] => {
  const out: number[] = [];
  for (let i = 0; i < p.moves.count; i++) if (p.moves.flags[i]! & FLAG_CYCLE) out.push(i);
  return out;
};
/** 사이클 이송(직선·원호) 끝점의 축 k 값 — 이어진 같은 값은 하나로 */
const depths = (p: NcProgram, k = 2): number[] => {
  const out: number[] = [];
  for (const i of cyc(p)) {
    if (p.moves.kind[i] === MOVE_RAPID) continue;
    const z = end(p, i)[k]!;
    if (out[out.length - 1] !== z) out.push(z);
  }
  return out;
};
/** 사이클 이동 끝점의 평면 상자 [u 최소, u 최대, v 최소, v 최대](축 a0·a1) */
const box = (p: NcProgram, a0 = 0, a1 = 1, only = (_i: number) => true): number[] => {
  let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const i of cyc(p)) {
    if (!only(i)) continue;
    const e = moveEnd(p.moves, i);
    u0 = Math.min(u0, e[a0]!);
    u1 = Math.max(u1, e[a0]!);
    v0 = Math.min(v0, e[a1]!);
    v1 = Math.max(v1, e[a1]!);
  }
  return [u0, u1, v0, v1].map(r3);
};
/** 사이클 원호의 회전 각(도) */
const sweeps = (p: NcProgram): number[] => cyc(p).filter((i) => p.moves.kind[i] === MOVE_ARC).map((i) => Math.round((p.arcs.sweep[p.moves.arc[i]!]! * 180) / Math.PI));
const head = (more = ''): string => `G71 G17 G90 T1 D1 S1000 M3${more}\nG0 X0 Y0 Z10\n`;
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));

/** 설명서 3.7절 예제(132쪽): 길이 60·너비 40·모서리 8·깊이 DPR 17.5, 중심 (60, 40), 가장자리 여유 0.75, 안전 거리 0.5, 절입 4, G2 */
const EXAMPLE1 = (vari: string, more = ''): string => `DEF REAL LENG, WID, DPR, CRAD
DEF INT VARI
N10 LENG=60 WID=40 DPR=17.5 CRAD=8
N20 VARI=${vari}
N30 G71 G90 S600 M4
N35 T20 D2
N37 M6
N40 G17 G0 X60 Y40 Z5
N50 POCKET1(5, 0, 0.5, , DPR, LENG, WID, CRAD, 60, 40, 0, 120, 300, 4, 2, 0.75, VARI${more})
N55 G1 X100 F50
N60 M30`;
const T20: Tools = { 20: { diameter: 10 } };

describe('POCKET1 사각 포켓', () => {
  it('설명서 3.7절 예제(황삭 VARI = 1): 후퇴 면에서 중심 위 → 기준면 + 안전 거리 → 층마다 중심에서 G1(FFD) 진입 → 가장자리 여유까지 평면 가공(FFP1) → 중심 위 후퇴 면', () => {
    const p = run(EXAMPLE1('1'), T20);
    expect(p.warnings).toEqual([]);
    // RFP + SDIS = 0.5에서 DPR 17.5(-17.5)까지 4 이하 같은 절입 다섯 층
    expect(depths(p)).toEqual([-3.1, -6.7, -10.3, -13.9, -17.5]);
    // 공구 중심: 반길이 30 - 반지름 5 - 여유 0.75, 반너비 20 - 5 - 0.75
    expect(box(p)).toEqual([35.75, 84.25, 25.75, 54.25]);
    // 모서리(공구 중심 8 - 5 - 0.75)는 층마다 마지막 고리에만, CDIR = 2는 G2(시계)
    expect(sweeps(p)).toHaveLength(20);
    expect(new Set(sweeps(p))).toEqual(new Set([-90]));
    const c = cyc(p);
    expect(c.every((i) => p.moves.line[i] === 8)).toBe(true);
    const first = c.find((i) => p.moves.kind[i] !== MOVE_RAPID)!;
    // 진입 앞은 급속뿐이고 기준면 + 안전 거리(0.5)에서 끝난다
    expect(c.slice(0, c.indexOf(first)).map((i) => [p.moves.kind[i], ...end(p, i)]).at(-1)).toEqual([MOVE_RAPID, 60, 40, 0.5]);
    expect(end(p, first)).toEqual([60, 40, -3.1]);
    expect(p.moves.kind[first]).toBe(MOVE_FEED);
    expect(p.moves.feed[first]).toBe(120);
    expect(c.filter((i) => p.moves.kind[i] !== MOVE_RAPID && end(p, i)[2] === -3.1).slice(1).every((i) => p.moves.feed[i] === 300)).toBe(true);
    // 끝: 포켓 중심 위 후퇴 면(설명서), 사이클 뒤 G1 F50은 그대로
    expect(end(p, c[c.length - 1]!)).toEqual([60, 40, 5]);
    expect(p.moves.kind[c[c.length - 1]!]).toBe(MOVE_RAPID);
    const after = c[c.length - 1]! + 1;
    expect(p.moves.flags[after]! & FLAG_CYCLE).toBe(0);
    expect(end(p, after)).toEqual([100, 40, 5]);
    expect(p.moves.feed[after]).toBe(50);
  });

  it('온 가공(VARI = 0): 황삭 뒤 안전 높이로 올라가 MIDF 층마다 중심에서 진입해 윤곽 한 바퀴(FFP2) — MIDF = 0이면 바닥 한 번', () => {
    const p = run(EXAMPLE1('0', ', 6, 200'), T20);
    expect(p.warnings).toEqual([]);
    expect(depths(p)).toEqual([-3.1, -6.7, -10.3, -13.9, -17.5, -5.5, -11.5, -17.5]);
    // 정삭은 완성 윤곽(공구 중심 반길이 25·반너비 15)을 FFP2로
    const fin = (i: number): boolean => p.moves.feed[i] === 200;
    expect(box(p, 0, 1, fin)).toEqual([35, 85, 25, 55]);
    expect(cyc(p).filter((i) => fin(i) && p.moves.kind[i] === MOVE_ARC)).toHaveLength(3 * 4);
    // 황삭 끝에서 안전 높이로 급속, 정삭 진입은 중심에서 FFD
    const c = cyc(p);
    const ups = c.filter((i) => p.moves.kind[i] === MOVE_RAPID && end(p, i).join() === '60,40,0.5');
    expect(ups).toHaveLength(2);
    const next = c[c.indexOf(ups[1]!) + 1]!;
    expect(end(p, next)).toEqual([60, 40, -5.5]);
    expect(p.moves.kind[next]).toBe(MOVE_FEED);
    expect(p.moves.feed[next]).toBe(120);
    expect(depths(run(EXAMPLE1('0', ', 0, 200'), T20))).toEqual([-3.1, -6.7, -10.3, -13.9, -17.5]);
    // 정삭만(VARI = 2): 정삭 층만, FFP2가 없으면 FFP1
    const fin2 = run(EXAMPLE1('2', ', 6'), T20);
    expect(depths(fin2)).toEqual([-5.5, -11.5, -17.5]);
    expect(new Set(cyc(fin2).filter((i) => fin2.moves.kind[i] === MOVE_ARC).map((i) => fin2.moves.feed[i]))).toEqual(new Set([300]));
    expect(depths(run(EXAMPLE1('2'), T20))).toEqual([-17.5]);
    // 정삭 회전수 SSF는 반영하지 않음(경고)
    expect(warns(run(EXAMPLE1('0', ', 6, 200, 1200'), T20))).toEqual(['POCKET1: 정삭 회전수(SSF)는 반영하지 않음']);
    expect(warns(run(EXAMPLE1('1', ', 6, 200, 1200'), T20))).toEqual([]);
  });

  it('STA1은 긴 축을 돌리고, 공구보다 작은 모서리는 공구 반지름, 너무 큰 FAL은 가능한 만큼으로 줄인다(설명서 121쪽)', () => {
    const p = run(head() + 'POCKET1(10, 0, 2, -5, , 40, 20, 0, 0, 0, 30, 100, 300, 0, 2, 0, 1)');
    const [ca, sa] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    let [mu, mv] = [0, 0];
    for (const i of cyc(p)) {
      const [x, y] = moveEnd(p.moves, i);
      const u = x * ca + y * sa;
      const v = -x * sa + y * ca;
      expect(Math.abs(u)).toBeLessThanOrEqual(15 + 1e-9);
      expect(Math.abs(v)).toBeLessThanOrEqual(5 + 1e-9);
      mu = Math.max(mu, Math.abs(u));
      mv = Math.max(mv, Math.abs(v));
    }
    expect([r3(mu), r3(mv)]).toEqual([15, 5]);
    expect(sweeps(run(head() + 'POCKET1(10, 0, 2, -5, , 40, 20, 3, 0, 0, 0, 100, 300, 0, 2, 0, 1)'))).toEqual([]);
    // FAL 40은 반너비(공구 중심 5)까지만: 긴 축 위 왕복만 남는다
    expect(box(run(head() + 'POCKET1(10, 0, 2, -5, , 40, 20, 0, 0, 0, 0, 100, 300, 0, 2, 40, 1)'))).toEqual([-10, 10, 0, 0]);
  });

  it('잘못된 값: 깊이·크기 없음, 공구가 포켓보다 큼(알람 61105), VARI가 0·1·2가 아님(알람 61102)은 그리지 않고, 공구 반지름 모름은 경고하고 그림', () => {
    const call = (dp: string, leng: string, wid: string, vari: string) => head() + `POCKET1(10, 0, 2, ${dp}, , ${leng}, ${wid}, 5, 0, 0, 0, 100, 300, 0, 2, 0, ${vari})`;
    const cases: [string, string][] = [
      [call('', '40', '30', '1'), 'POCKET1: 깊이(DP·DPR)가 없음 — 그리지 않음'],
      [call('-5', '', '30', '1'), 'POCKET1: 길이·너비(LENG·WID)가 없음 — 그리지 않음'],
      [call('-5', '40', '8', '1'), 'POCKET1: 공구 반지름이 포켓보다 큼 — 그리지 않음'],
      [call('-5', '40', '30', '3'), 'POCKET1: 가공 종류(VARI = 3)가 맞지 않음 — 그리지 않음'],
      [call('-5', '40', '30', '11'), 'POCKET1: 가공 종류(VARI = 11)가 맞지 않음 — 그리지 않음'],
    ];
    for (const [text, w] of cases) {
      const p = run(text);
      expect(warns(p), w).toEqual([w]);
      expect(cyc(p), w).toEqual([]);
    }
    // 공구 반지름 = 반너비는 된다(폭 0 고리 — 긴 축 왕복)
    expect(box(run(call('-5', '40', '10', '1')))).toEqual([-15, 15, 0, 0]);
    const noTool = run(call('-5', '40', '30', '1'), {});
    expect(warns(noTool)).toEqual(['POCKET1: 공구 반지름을 몰라 반지름 0으로 그림']);
    expect(box(noTool)).toEqual([-20, 20, -15, 15]);
  });
});

describe('POCKET2 원 포켓', () => {
  it('설명서 3.8절 예제(138쪽, G19): 공구 축 X로 6 이하 층마다 원 고리, VARI·FAL을 빼 온 가공 — MIDF 0이면 바닥에서 윤곽 한 바퀴(FFP2 없으면 FFP1), 끝은 중심 위 후퇴 면', () => {
    const p = run(`DEF REAL RTP=3, RFP=0, DP=-20, PRAD=25, FFD=100, FFP1, MID=6
N10 FFP1=FFD*2
N20 G71 G19 G90 G0 S650 M3
N25 T1 D1
N27 M6
N30 Y50 Z50
N40 POCKET2(RTP, RFP, , DP, , PRAD, 50, 50, FFD, FFP1, MID, 3, )
N50 M30`);
    expect(p.warnings).toEqual([]);
    const c = cyc(p);
    // 깊이 축 X: 0(기준면 + 안전 거리 0)에서 -20까지 네 층, 정삭은 -20 한 번
    expect(depths(p, 0)).toEqual([-5, -10, -15, -20]);
    const planeX = [...new Set(c.filter((i) => p.moves.kind[i] === MOVE_ARC).map((i) => end(p, i)[0]!))];
    expect(planeX).toEqual([-5, -10, -15, -20]);
    // 진입은 늘 중심(설명서 139쪽)에서 FFD
    const plunges = c.filter((i) => p.moves.kind[i] === MOVE_FEED && p.moves.feed[i] === 100);
    expect(plunges.map((i) => end(p, i))).toEqual([
      [-5, 50, 50],
      [-10, 50, 50],
      [-15, 50, 50],
      [-20, 50, 50],
      [-20, 50, 50],
    ]);
    // 원 고리: 공구 중심 반지름 20을 공구 지름 × 0.8 이하 간격으로 셋, 층마다 + 정삭 한 바퀴
    const dist = (i: number): number => r3(Math.hypot(end(p, i)[1]! - 50, end(p, i)[2]! - 50));
    const arcs = c.filter((i) => p.moves.kind[i] === MOVE_ARC);
    expect(new Set(arcs.map(dist))).toEqual(new Set([6.667, 13.333, 20]));
    expect(arcs).toHaveLength(4 * 3 * 2 + 2);
    expect(new Set(arcs.map((i) => p.moves.feed[i]))).toEqual(new Set([200]));
    // CDIR = 3은 G3
    expect(new Set(sweeps(p).map(Math.sign))).toEqual(new Set([1]));
    expect(end(p, c[c.length - 1]!)).toEqual([3, 50, 50]);
  });

  it('가공 방향 CDIR: 2 = G2, 3 = G3, 그 밖(0·1·5 — 매개변수 표에 2·3만)은 경고하고 하향(M3 → G3, M4 → G2)', () => {
    const call = (cdir: string, m = 'M3') => `G71 G17 G90 T1 D1 S1000 ${m}\nG0 X0 Y0 Z10\nPOCKET2(10, 0, 2, -5, , 15, 0, 0, 100, 300, 0, ${cdir}, 0, 1)`;
    const dir = (p: NcProgram): number[] => [...new Set(sweeps(p).map(Math.sign))];
    expect(dir(run(call('2')))).toEqual([-1]);
    expect(dir(run(call('3', 'M4')))).toEqual([1]);
    for (const [cdir, m, d] of [
      ['0', 'M3', 1],
      ['1', 'M4', -1],
      ['5', 'M3', 1],
    ] as const) {
      const p = run(call(cdir, m));
      expect(warns(p), cdir).toEqual([`POCKET2: 가공 방향(CDIR = ${cdir})이 맞지 않아 하향으로 그림`]);
      expect(dir(p), cdir).toEqual([d]);
    }
  });

  it('깊이: DPR(후퇴 면 반대쪽, 둘 다 있으면 DPR), _ZSD[1] = 1이면 기준면부터, 평면 G18·프레임을 따른다', () => {
    const call = (dp: string, dpr: string, rtp = '10') => `POCKET2(${rtp}, 0, 2, ${dp}, ${dpr}, 15, 0, 0, 100, 300, 5, 3, 0, 1)`;
    expect(depths(run(head() + call('-10', '')))).toEqual([-2, -6, -10]);
    expect(depths(run(head() + `_ZSD[1]=1\n${call('-10', '')}`))).toEqual([-5, -10]);
    expect(depths(run(head() + call('', '10')))).toEqual([-2, -6, -10]);
    const both = run(head() + call('-4', '10'));
    expect(depths(both)).toEqual([-2, -6, -10]);
    expect(warns(both)).toEqual(['POCKET2: DP와 DPR이 달라 DPR 깊이로 그림']);
    // 후퇴 면이 기준면 아래면 DPR은 위로
    expect(depths(run(head() + call('', '10', '-10')))).toEqual([2, 6, 10]);
    expect(warns(run(head() + call('', '')))).toEqual(['POCKET2: 깊이(DP·DPR)가 없음 — 그리지 않음']);
    // G18: 첫 축 Z·둘째 축 X에 중심, 공구 축 Y
    const g18 = run('G71 G18 G90 T1 D1 S1000 M3\nG0 X10 Y20 Z30\nPOCKET2(10, 0, 2, -5, , 15, 30, 10, 100, 300, 0, 3, 0, 1)');
    expect(g18.warnings).toEqual([]);
    expect(depths(g18, 1)).toEqual([-5]);
    expect(end(g18, cyc(g18).at(-1)!)).toEqual([10, 10, 30]);
    const moved = run(head() + 'TRANS X100 Y50\nPOCKET2(10, 0, 2, -5, , 15, 0, 0, 100, 300, 0, 3, 0, 1)');
    expect(box(moved)).toEqual([90, 110, 50, 50]);
    const rot = run(head() + 'ROT RPL=90\nPOCKET1(10, 0, 2, -5, , 40, 20, 0, 0, 0, 0, 100, 300, 0, 3, 0, 1)');
    expect(box(rot)).toEqual([-5, 5, -15, 15]);
  });

  it('잘못된 값: PRAD 없음·공구가 큼·VARI는 그리지 않음', () => {
    const call = (prad: string, vari: string) => head() + `POCKET2(10, 0, 2, -5, , ${prad}, 0, 0, 100, 300, 0, 3, 0, ${vari})`;
    expect(warns(run(call('', '1')))).toEqual(['POCKET2: 포켓 반지름(PRAD)이 없음 — 그리지 않음']);
    expect(warns(run(call('4', '1')))).toEqual(['POCKET2: 공구 반지름이 포켓보다 큼 — 그리지 않음']);
    expect(warns(run(call('15', '21')))).toEqual(['POCKET2: 가공 종류(VARI = 21)가 맞지 않음 — 그리지 않음']);
    for (const t of [call('', '1'), call('4', '1'), call('15', '21')]) expect(cyc(run(t))).toEqual([]);
    // 공구 반지름 = 포켓 반지름: 중심에서 진입만
    const tight = run(call('5', '1'));
    expect(tight.warnings).toEqual([]);
    expect(box(tight)).toEqual([0, 0, 0, 0]);
  });
});

describe('이동 한도·번역', () => {
  it('아주 작은 MID·MIDF, 아주 큰 깊이도 한 블록 안에서 한도에 멈추고 한 번 경고', () => {
    const calls = [
      'POCKET1(10, 0, 2, -10, , 40, 30, 5, 0, 0, 0, 100, 300, 0.000001, 2, 0, 1)',
      'POCKET1(10, 0, 2, -10, , 40, 30, 5, 0, 0, 0, 100, 300, 0, 2, 0, 2, 0.000001)',
      'POCKET2(10, 0, 2, -1000000000000, , 15, 0, 0, 100, 300, 1, 3, 0, 0)',
      'POCKET2(10, 0, 2, -10, , 5, 0, 0, 100, 300, 0.000000000001, 3, 0, 1)',
    ];
    for (const call of calls) {
      const t0 = performance.now();
      const p = run(head() + call + '\nG0 X100', D10, 2000);
      expect(performance.now() - t0, call).toBeLessThan(2000);
      expect(p.moves.count, call).toBeLessThanOrEqual(2000);
      expect(p.warnings.filter((w) => w.includes('이동이 2000개를 넘어 나머지는 읽지 않음')), call).toHaveLength(1);
    }
  });

  it('새 경고 글은 네 언어 사전에 있다', () => {
    const texts = [
      'POCKET1: 길이·너비(LENG·WID)가 없음 — 그리지 않음',
      'POCKET2: 포켓 반지름(PRAD)이 없음 — 그리지 않음',
      'POCKET1: 깊이(DP·DPR)가 없음 — 그리지 않음',
      'POCKET2: 가공 종류(VARI = 21)가 맞지 않음 — 그리지 않음',
      'POCKET2: 가공 방향(CDIR = 5)이 맞지 않아 하향으로 그림',
      'POCKET1: 공구 반지름이 포켓보다 큼 — 그리지 않음',
      'POCKET1: 정삭 회전수(SSF)는 반영하지 않음',
      'POCKET2: DP와 DPR이 달라 DPR 깊이로 그림',
    ];
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate('POCKET1: 길이·너비(LENG·WID)가 없음 — 그리지 않음', 'en')).toBe('POCKET1: no length or width (LENG, WID) — not drawn');
    expect(translate('POCKET2: 포켓 반지름(PRAD)이 없음 — 그리지 않음', 'de')).toBe('POCKET2: kein Taschenradius (PRAD) — nicht gezeichnet');
  });
});
