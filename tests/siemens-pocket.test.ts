// Siemens POCKET3(사각 포켓)·POCKET4(원 포켓)(38차): SINUMERIK 840D sl 사이클 프로그래밍 설명서 3.9·3.10절의 매개변수·순서대로 그린다
import { describe, expect, it } from 'vitest';
import { parseSiemens } from '../src/siemens';
import { FLAG_CYCLE, MOVE_ARC, MOVE_FEED, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

type Tools = Record<number, { diameter?: number; radius?: number }>;
const D10: Tools = { 1: { diameter: 10 } };
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const run = (text: string, toolTable: Tools | undefined = D10): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable });
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
const box = (p: NcProgram, a0 = 0, a1 = 1): number[] => {
  let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const i of cyc(p)) {
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
const has = (p: NcProgram, text: string): boolean => p.warnings.some((w) => w.includes(text));

describe('POCKET3 사각 포켓', () => {
  it('설명서 3.9절 예제 꼴: 층(_MID)·옆 간격(_MIDA)·바닥 여유(_FALD)·모서리·하향(M4 → G2)·후퇴 면, 앞 모드는 그대로', () => {
    const p = run(`N10 G71 G90 S600 M4
N15 T10 D1
N17 M6
N20 G17 G1 X60 Y40 Z5 F300
N25 _ZSD[2]=0
N30 POCKET3(5, 0, 0.5, -17.5, 60, 40, 8, 60, 40, 0, 4, 0.75, 0.2, 1000, 750, 0, 11, 5)
N40 X100
N50 M30`);
    expect(p.warnings).toEqual([]);
    // RFP + SDIS = 0.5에서 DP + FALD = -17.3까지 4 이하 같은 절입 다섯 층
    expect(depths(p)).toEqual([-3.06, -6.62, -10.18, -13.74, -17.3]);
    // 공구 중심: 반길이 30 - 반지름 5 - 가장자리 여유 0.75, 반너비 20 - 5 - 0.75
    expect(box(p)).toEqual([35.75, 84.25, 25.75, 54.25]);
    // 모서리 원호는 층마다 마지막 고리에만(공구 중심 모서리 8 - 5 - 0.75), M4 하향은 시계
    expect(sweeps(p)).toHaveLength(20);
    expect(new Set(sweeps(p))).toEqual(new Set([-90]));
    const c = cyc(p);
    expect(c.every((i) => p.moves.line[i] === 5)).toBe(true);
    // 수직 진입은 _FFD, 평면은 _FFP1
    const first = c.find((i) => p.moves.kind[i] !== MOVE_RAPID)!;
    expect(end(p, first)).toEqual([60, 40, -3.06]);
    expect(p.moves.feed[first]).toBe(750);
    expect(c.filter((i) => p.moves.kind[i] !== MOVE_RAPID && end(p, i)[2] === -3.06).slice(1).every((i) => p.moves.feed[i] === 1000)).toBe(true);
    // 고리는 중심에서 바깥으로: 옆 간격 _MIDA 5 이하(14.25를 세 번) — 첫 고리는 폭 0(긴 쪽 왕복)
    expect(end(p, first + 1)).toEqual([70, 40, -3.06]);
    expect(end(p, first + 2)).toEqual([50, 40, -3.06]);
    // 끝: 포켓 중심 위 후퇴 면
    expect(end(p, c[c.length - 1]!)).toEqual([60, 40, 5]);
    expect(p.moves.kind[c[c.length - 1]!]).toBe(MOVE_RAPID);
    // 사이클 뒤 X100은 앞의 G1·F300 그대로
    const after = c[c.length - 1]! + 1;
    expect(p.moves.flags[after]! & FLAG_CYCLE).toBe(0);
    expect(p.moves.kind[after]).toBe(MOVE_FEED);
    expect(p.moves.feed[after]).toBe(300);
    expect(end(p, after)).toEqual([100, 40, 5]);
  });

  it('모서리 기준(_ZSD[2] = 1): 부호 있는 _LENG·_WID 쪽, _STA는 모서리 둘레(_ZSD[9] = 1이면 중심 둘레)', () => {
    const call = (sta: number) => `POCKET3(10, 0, 2, -5, -40, 30, 5, 10, 20, ${sta}, 0, 0, 0, 500, 100, 0, 11, 0)`;
    // 모서리 (10, 20)에서 X -40·Y +30 → 중심 (-10, 35), 공구 중심 반길이 15·반너비 10
    const p = run(head() + `_ZSD[2]=1\n${call(0)}`);
    expect(p.warnings).toEqual([]);
    expect(depths(p)).toEqual([-5]);
    expect(box(p)).toEqual([-25, 5, 25, 45]);
    expect(cyc(p).some((i) => p.moves.kind[i] === MOVE_RAPID && end(p, i).join() === '-10,35,10')).toBe(true);
    // 모서리 둘레로 90도: 포켓 X -20~10, Y -20~20(중심 (-5, 0))
    expect(box(run(head() + `_ZSD[2]=1\n${call(90)}`))).toEqual([-15, 5, -15, 15]);
    // 중심 둘레로 90도: 중심 (-10, 35)에서 긴 축이 Y
    expect(box(run(head() + `_ZSD[2]=1\n_ZSD[9]=1\n${call(90)}`))).toEqual([-20, 0, 20, 50]);
    // _ZSD[2] = 0(기본)이면 (_PA, _PO)가 중심
    expect(box(run(head() + call(0)))).toEqual([-5, 25, 10, 30]);
  });

  it('_STA(중심 기준)는 긴 축을 돌린다 — 모든 점이 돌린 사각 안, 끝 고리가 가장자리에', () => {
    const p = run(head() + 'POCKET3(10, 0, 2, -5, 40, 20, 0, 0, 0, 30, 0, 0, 0, 500, 100, 0, 11, 0)');
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
    // 모서리 반지름 0 → 원호 없음
    expect(sweeps(p)).toEqual([]);
  });

  it('공구 반지름보다 작은 모서리 반지름은 공구 반지름(공구 중심 모서리 0), 공구가 크면 그리지 않음(알람 61105)', () => {
    expect(sweeps(run(head() + 'POCKET3(10, 0, 2, -5, 40, 20, 3, 0, 0, 0, 0, 0, 0, 500, 100, 0, 11, 0)'))).toEqual([]);
    const big = run(head() + 'POCKET3(10, 0, 2, -5, 40, 8, 3, 0, 0, 0, 0, 0, 0, 500, 100, 0, 11, 0)');
    expect(has(big, 'POCKET3: 공구 반지름이 포켓보다 큼 — 그리지 않음')).toBe(true);
    expect(cyc(big)).toEqual([]);
  });

  it('정삭(_VARI = X2): 가장자리는 바닥 여유 높이에서 한 바퀴만, 바닥은 _DP + _FALD + _SDIS까지 급속 후 _FFD로 내려가 한 번', () => {
    const p = run(head() + 'POCKET3(10, 0, 2, -8, 60, 40, 10, 0, 0, 0, 4, 1, 0.5, 500, 100, 0, 12, 0)');
    expect(p.warnings).toEqual([]);
    expect(depths(p)).toEqual([-7.5, -8]);
    const c = cyc(p);
    const rapidTo = (pt: string) => c.find((i) => p.moves.kind[i] === MOVE_RAPID && end(p, i).join() === pt);
    const edgeDown = rapidTo('0,0,-7.5')!;
    expect(edgeDown).toBeDefined();
    // 곧게 가장자리(공구 중심 반길이 25)로 — 가장자리 여유까지 깎으므로 완성 윤곽
    expect(end(p, edgeDown + 1)).toEqual([25, 0, -7.5]);
    expect(rapidTo('0,0,-5.5')).toBeGreaterThan(edgeDown);
    const baseDown = c.find((i) => p.moves.kind[i] === MOVE_FEED && end(p, i).join() === '0,0,-8')!;
    expect(p.moves.feed[baseDown]).toBe(100);
    expect(box(p)).toEqual([-25, 25, -15, 15]);
    // 가장자리 한 바퀴 4 모서리 + 바닥 끝 고리 4 모서리, M3 하향은 반시계
    expect(sweeps(p)).toEqual([90, 90, 90, 90, 90, 90, 90, 90]);
    // 여유가 둘 다 0이면 정삭할 것이 없다(급속만)
    const none = run(head() + 'POCKET3(10, 0, 2, -8, 60, 40, 10, 0, 0, 0, 4, 0, 0, 500, 100, 0, 12, 0)');
    expect(cyc(none).length).toBeGreaterThan(0);
    expect(cyc(none).every((i) => none.moves.kind[i] === MOVE_RAPID)).toBe(true);
  });

  it('진입(_VARI 십의 자리): 0 = 수직 G0, 1 = 수직 G1, 2 = 나선(_RAD1·_DP1), 3 = 왕복은 수직 G1로(경고)', () => {
    const call = (vari: number, rad1 = '', dp1 = '') => head() + `POCKET3(10, 0, 2, -5, 40, 30, 5, 0, 0, 0, 0, 0, 0, 500, 100, 0, ${vari}, 0, , , , ${rad1}, ${dp1})`;
    const downAt = (p: NcProgram): number => cyc(p).find((i) => end(p, i)[2] === -5)!;
    const g0 = run(call(1));
    expect(g0.moves.kind[downAt(g0)]).toBe(MOVE_RAPID);
    const g1 = run(call(11));
    expect(g1.moves.kind[downAt(g1)]).toBe(MOVE_FEED);
    expect(g1.moves.feed[downAt(g1)]).toBe(100);
    // 나선: 긴 축 + 쪽 (3, 0)에서 G1, 깊이 7(2 → -5)을 바퀴 깊이 4 이하 → 두 바퀴, 그 깊이에서 한 바퀴 더(반원 둘씩)
    const helix = run(call(21, '3', '4'));
    expect(helix.warnings).toEqual([]);
    const hc = cyc(helix);
    const start = hc.find((i) => helix.moves.kind[i] === MOVE_FEED)!;
    expect(end(helix, start)).toEqual([3, 0, 2]);
    expect(helix.moves.feed[start]).toBe(100);
    const turns = hc.slice(hc.indexOf(start) + 1, hc.indexOf(start) + 7).map((i) => end(helix, i));
    expect(turns).toEqual([
      [-3, 0, 0.25],
      [3, 0, -1.5],
      [-3, 0, -3.25],
      [3, 0, -5],
      [-3, 0, -5],
      [3, 0, -5],
    ]);
    expect(end(helix, hc[hc.indexOf(start) + 7]!)).toEqual([0, 0, -5]);
    // 나선 자료가 없으면·왕복이면 수직 G1(경고)
    const noHelix = run(call(21));
    expect(has(noHelix, 'POCKET3: 나선 진입 반지름·깊이(_RAD1·_DP1)가 없어 수직 이송으로 그림')).toBe(true);
    expect(noHelix.moves.kind[downAt(noHelix)]).toBe(MOVE_FEED);
    const osc = run(call(31, '5'));
    expect(has(osc, 'POCKET3: 긴 축 왕복 진입(_VARI 3X)은 수직 이송으로 그림')).toBe(true);
    expect(osc.moves.kind[downAt(osc)]).toBe(MOVE_FEED);
  });

  it('깊이 시작(_ZSD[1]): 0이면 기준면 + 안전 거리, 1이면 기준면부터 _MID 절입', () => {
    const call = 'POCKET3(10, 0, 2, -10, 40, 30, 5, 0, 0, 0, 5, 0, 0, 500, 100, 0, 11, 0)';
    expect(depths(run(head() + call))).toEqual([-2, -6, -10]);
    expect(depths(run(head() + `_ZSD[1]=1\n${call}`))).toEqual([-5, -10]);
    // _MID = 0이면 한 번에
    expect(depths(run(head() + call.replace(', 5, 0, 0, 500', ', 0, 0, 0, 500')))).toEqual([-10]);
  });

  it('잘못된 값: 깊이·크기 없음, _VARI가 맞지 않음은 그리지 않고, 블랭크 치수·공구 반지름 모름은 경고하고 그림', () => {
    const noDp = run(head() + 'POCKET3(10, 0, 2)');
    expect(has(noDp, 'POCKET3: 깊이(_DP)가 없음 — 그리지 않음')).toBe(true);
    expect(cyc(noDp)).toEqual([]);
    for (const vari of [0, 13, 41, 111, 1011]) {
      const p = run(head() + `POCKET3(10, 0, 2, -5, 40, 30, 5, 0, 0, 0, 0, 0, 0, 500, 100, 0, ${vari}, 0)`);
      expect(has(p, `POCKET3: 가공 종류(_VARI = ${vari})가 맞지 않음 — 그리지 않음`), String(vari)).toBe(true);
      expect(cyc(p)).toEqual([]);
    }
    const noSize = run(head() + 'POCKET3(10, 0, 2, -5, , 30, 5, 0, 0, 0, 0, 0, 0, 500, 100, 0, 11, 0)');
    expect(has(noSize, 'POCKET3: 길이·너비(_LENG·_WID)가 없음 — 그리지 않음')).toBe(true);
    expect(cyc(noSize)).toEqual([]);
    const blank = run(head() + 'POCKET3(10, 0, 2, -5, 40, 30, 5, 0, 0, 0, 0, 0, 0, 500, 100, 0, 11, 0, 20, 10, 1)');
    expect(has(blank, 'POCKET3: 블랭크 치수(_AP·_AD)는 반영하지 않고 온 포켓으로 그림')).toBe(true);
    expect(box(blank)).toEqual([-15, 15, -10, 10]);
    // 공구를 모르면 반지름 0(공구 중심 = 포켓 윤곽)
    const noTool = run(head() + 'POCKET3(10, 0, 2, -5, 40, 30, 5, 0, 0, 0, 0, 0, 0, 500, 100, 0, 11, 8)', {});
    expect(has(noTool, 'POCKET3: 공구 반지름을 몰라 반지름 0으로 그림')).toBe(true);
    expect(box(noTool)).toEqual([-20, 20, -15, 15]);
  });
});

describe('POCKET4 원 포켓', () => {
  it('설명서 3.10절 예제 꼴(G19): 나선 진입(_VARI 21)·층마다 원 고리·후퇴 면', () => {
    const p = run(`N10 G71 G19 G90 G0 S650 M3
N15 T20 D1
N17 M6
N20 Y50 Z50
N30 POCKET4(3, 0, 0, -20, 25, 50, 50, 6, 0, 0, 200, 100, 1, 21, 0, 0, 0, 2, 3)
N40 M30`);
    expect(p.warnings).toEqual([]);
    const c = cyc(p);
    // 공구 축 X: 0에서 -20까지 6 이하 같은 절입 네 층
    const planeX = [...new Set(c.filter((i) => p.moves.kind[i] !== MOVE_RAPID && p.moves.feed[i] === 200).map((i) => end(p, i)[0]!))];
    expect(planeX).toEqual([-5, -10, -15, -20]);
    // 나선은 긴 축(Y) + 쪽 (Y52)에서 G1 _FFD로 시작, 반지름 2
    const start = c.find((i) => p.moves.kind[i] === MOVE_FEED)!;
    expect(end(p, start)).toEqual([0, 52, 50]);
    expect(p.moves.feed[start]).toBe(100);
    const dist = (i: number): number => r3(Math.hypot(end(p, i)[1]! - 50, end(p, i)[2]! - 50));
    const arcs = c.filter((i) => p.moves.kind[i] === MOVE_ARC);
    expect(new Set(arcs.filter((i) => p.moves.feed[i] === 100).map(dist))).toEqual(new Set([2]));
    // 층마다 바퀴 깊이 3 이하 → 두 바퀴 + 한 바퀴(반원 여섯), 원 고리는 공구 지름 × 0.8 이하 간격으로 셋(반원 여섯)
    expect(arcs.filter((i) => p.moves.feed[i] === 100)).toHaveLength(24);
    expect(new Set(arcs.filter((i) => p.moves.feed[i] === 200).map(dist))).toEqual(new Set([6.667, 13.333, 20]));
    expect(arcs).toHaveLength(48);
    // _CDIR = 1·M3 → 상향(G2) 한 방향 — 나선도 같은 방향
    expect(new Set(sweeps(p).map(Math.sign))).toEqual(new Set([-1]));
    expect(end(p, c[c.length - 1]!)).toEqual([3, 50, 50]);
  });

  it('가공 방향(_CDIR): 2 = G2, 3 = G3, 0 = 하향(M3 → G3, M4 → G2), 1 = 상향(M3 → G2, M4 → G3), 그 밖은 경고하고 하향', () => {
    const call = (cdir: number, m = 'M3') => `G71 G17 G90 T1 D1 S1000 ${m}\nG0 X0 Y0 Z10\nPOCKET4(10, 0, 2, -5, 15, 0, 0, 0, 0, 0, 300, 100, ${cdir}, 11, 0)`;
    const dir = (p: NcProgram): number[] => [...new Set(sweeps(p).map(Math.sign))];
    expect(dir(run(call(2)))).toEqual([-1]);
    expect(dir(run(call(3, 'M4')))).toEqual([1]);
    expect(dir(run(call(0)))).toEqual([1]);
    expect(dir(run(call(0, 'M4')))).toEqual([-1]);
    expect(dir(run(call(1)))).toEqual([-1]);
    expect(dir(run(call(1, 'M4')))).toEqual([1]);
    const bad = run(call(7));
    expect(has(bad, 'POCKET4: 가공 방향(_CDIR = 7)이 맞지 않아 하향으로 그림')).toBe(true);
    expect(dir(bad)).toEqual([1]);
  });

  it('평면 G18: 첫 축 Z·둘째 축 X에 중심, 공구 축 Y로 깊이', () => {
    const p = run('G71 G18 G90 T1 D1 S1000 M3\nG0 X10 Y20 Z30\nPOCKET4(10, 0, 2, -5, 15, 30, 10, 0, 0, 0, 300, 100, 0, 11, 0)');
    expect(p.warnings).toEqual([]);
    const c = cyc(p);
    expect(c.some((i) => p.moves.kind[i] === MOVE_RAPID && end(p, i).join() === '10,10,30')).toBe(true);
    expect(depths(p, 1)).toEqual([-5]);
    // 이송 끝점은 모두 중심 (Z30, X10)에서 공구 중심 반지름 10 안
    const far = Math.max(...c.filter((i) => p.moves.kind[i] !== MOVE_RAPID).map((i) => Math.hypot(end(p, i)[2]! - 30, end(p, i)[0]! - 10)));
    expect(r3(far)).toBe(10);
    expect(end(p, c[c.length - 1]!)).toEqual([10, 10, 30]);
  });

  it('프레임: TRANS는 옮기고, ROT은 POCKET3의 긴 축을 돌리고, MIRROR는 방향을 뒤집는다', () => {
    const moved = run(head() + 'TRANS X100 Y50\nPOCKET4(10, 0, 2, -5, 15, 0, 0, 0, 0, 0, 300, 100, 3, 11, 0)');
    // 원 고리의 끝점은 첫 축 위(중심 ± 10)
    expect(box(moved)).toEqual([90, 110, 50, 50]);
    const rot = run(head() + 'ROT RPL=90\nPOCKET3(10, 0, 2, -5, 40, 20, 0, 0, 0, 0, 0, 0, 0, 500, 100, 0, 11, 0)');
    expect(box(rot)).toEqual([-5, 5, -15, 15]);
    const mirror = run(head() + 'MIRROR X0\nPOCKET4(10, 0, 2, -5, 15, 20, 0, 0, 0, 0, 300, 100, 3, 11, 0)');
    expect(box(mirror)).toEqual([-30, -10, 0, 0]);
    expect([...new Set(sweeps(mirror).map(Math.sign))]).toEqual([-1]);
  });

  it('잘못된 값: _PRAD 없음·공구가 큼·_VARI(왕복 3X는 POCKET4에 없음)는 그리지 않고, 나선 가공(1xxx)·블랭크는 경고하고 그림', () => {
    const call = (prad: string, vari: number, more = '') => head() + `POCKET4(10, 0, 2, -5, ${prad}, 0, 0, 0, 0, 0, 300, 100, 0, ${vari}, 0${more})`;
    const noR = run(call('', 11));
    expect(has(noR, 'POCKET4: 포켓 반지름(_PRAD)이 없음 — 그리지 않음')).toBe(true);
    expect(cyc(noR)).toEqual([]);
    const big = run(call('4', 11));
    expect(has(big, 'POCKET4: 공구 반지름이 포켓보다 큼 — 그리지 않음')).toBe(true);
    expect(cyc(big)).toEqual([]);
    for (const vari of [31, 2011, 12]) {
      const p = run(call('15', vari));
      if (vari === 12) {
        expect(p.warnings).toEqual([]);
        continue;
      }
      expect(has(p, `POCKET4: 가공 종류(_VARI = ${vari})가 맞지 않음 — 그리지 않음`), String(vari)).toBe(true);
      expect(cyc(p)).toEqual([]);
    }
    const helical = run(call('15', 1011));
    expect(has(helical, 'POCKET4: 나선 가공(_VARI 1xxx)은 층마다 평면 가공으로 그림')).toBe(true);
    expect(box(helical)).toEqual([-10, 10, 0, 0]);
    const blank = run(call('15', 11, ', 0, 12, 1'));
    expect(has(blank, 'POCKET4: 블랭크 치수(_AP·_AD)는 반영하지 않고 온 포켓으로 그림')).toBe(true);
    const noDp = run(head() + 'POCKET4(10, 0, 2)');
    expect(has(noDp, 'POCKET4: 깊이(_DP)가 없음 — 그리지 않음')).toBe(true);
  });
});

describe('이동 한도(한 블록 안의 층·고리·나선 바퀴)', () => {
  const LIMIT = 2000;
  const limited = (call: string, maxMoves = LIMIT): { p: NcProgram; ms: number } => {
    const t0 = performance.now();
    const p = parseSiemens(makeSource(head() + call + '\nG0 X100'), { initialPosition: [0, 0, 50], toolTable: D10, maxMoves });
    return { p, ms: performance.now() - t0 };
  };
  const over = (p: NcProgram, n = LIMIT): number => p.warnings.filter((w) => w.includes(`이동이 ${n}개를 넘어 나머지는 읽지 않음`)).length;

  it('절입이 작아 층이 많으면 한도에서 멈추고 한 번 경고, 다음 줄은 읽지 않는다', () => {
    // 깊이 12를 0.001씩: 층 12,000개 × 이동 17개 — 블록 사이에서만 한도를 보면 한 블록에서 20만 개를 넘게 만든다
    const { p } = limited('POCKET3(10, 0, 2, -10, 40, 30, 5, 0, 0, 0, 0.001, 0, 0, 500, 100, 0, 11, 0)');
    expect(p.moves.count).toBeLessThanOrEqual(LIMIT);
    expect(over(p)).toBe(1);
    expect(end(p, p.moves.count - 1)[0]).not.toBe(100);
  });

  it('아주 작은 _MID·_MIDA·_DP1, 아주 큰 깊이·크기, 길이 0 층도 시간 안에 한도 안에서 멈춘다', () => {
    const calls = [
      'POCKET3(10, 0, 2, -10, 40, 30, 5, 0, 0, 0, 0.000001, 0, 0, 500, 100, 0, 11, 0)',
      'POCKET3(10, 0, 2, -1000000000000, 40, 30, 5, 0, 0, 0, 1, 0, 0, 500, 100, 0, 11, 0)',
      'POCKET3(10, 0, 2, -5, 40, 30, 5, 0, 0, 0, 0, 0, 0, 500, 100, 0, 11, 0.000001)',
      'POCKET3(10, 0, 2, -5, 1000000000000, 1000000000000, 0, 0, 0, 0, 0, 0, 0, 500, 100, 0, 11, 0)',
      'POCKET4(10, 0, 2, -10, 15, 0, 0, 0, 0, 0, 300, 100, 0, 21, 0, 0, 0, 3, 0.000001)',
      // 공구 반지름 = 포켓 반지름(고리 없음)·절입 1e-12: 층마다 이동이 거의 없어도 반복 수로 멈춘다
      'POCKET4(10, 0, 2, -10, 5, 0, 0, 0.000000000001, 0, 0, 300, 100, 0, 1, 0)',
    ];
    for (const call of calls) {
      const { p, ms } = limited(call);
      expect(ms, call).toBeLessThan(2000);
      expect(p.moves.count, call).toBeLessThanOrEqual(LIMIT);
      expect(over(p), call).toBe(1);
    }
  });

  it('한도 안에 드는 포켓은 그대로(반복 수로 일찍 멈추지 않는다)', () => {
    const call = 'POCKET3(5, 0, 0.5, -17.5, 60, 40, 8, 60, 40, 0, 4, 0.75, 0.2, 1000, 750, 0, 11, 5)';
    const full = limited(call, 8_000_000).p;
    const fit = limited(call, full.moves.count + 1).p;
    expect(fit.moves.count).toBe(full.moves.count);
    expect(over(fit, full.moves.count + 1)).toBe(0);
    expect(end(fit, fit.moves.count - 1)).toEqual([100, 40, 5]);
  });
});

describe('POCKET 없는 프로그램·번역', () => {
  it('사이클 설정 _ZSD 대입만으로는 이동이 바뀌지 않는다', () => {
    const base = 'G71 G17 G90 T1 D1 S1000 M3\nG0 X0 Y0 Z10\nG1 Z-1 F100\nG2 X20 Y0 CR=10\nG0 Z10\nM30';
    const plain = run(base);
    const zsd = run(base.replace('G0 X0 Y0 Z10', 'G0 X0 Y0 Z10\n_ZSD[1]=1\n_ZSD[2]=1\n_ZSD[9]=1'));
    const all = (p: NcProgram): number[][] => Array.from({ length: p.moves.count }, (_, i) => [p.moves.kind[i]!, ...end(p, i), p.moves.feed[i]!, p.moves.flags[i]!]);
    expect(all(zsd)).toEqual(all(plain));
    const text = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
    expect(text(zsd)).toEqual(text(plain));
    expect(cyc(plain)).toEqual([]);
  });

  it('새 경고 글은 네 언어 사전에 있다', () => {
    const texts = [
      'POCKET3: 깊이(_DP)가 없음 — 그리지 않음',
      'POCKET4: 가공 종류(_VARI = 31)가 맞지 않음 — 그리지 않음',
      'POCKET3: 공구 반지름을 몰라 반지름 0으로 그림',
      'POCKET3: 길이·너비(_LENG·_WID)가 없음 — 그리지 않음',
      'POCKET4: 공구 반지름이 포켓보다 큼 — 그리지 않음',
      'POCKET4: 포켓 반지름(_PRAD)이 없음 — 그리지 않음',
      'POCKET3: 블랭크 치수(_AP·_AD)는 반영하지 않고 온 포켓으로 그림',
      'POCKET4: 나선 가공(_VARI 1xxx)은 층마다 평면 가공으로 그림',
      'POCKET4: 가공 방향(_CDIR = 7)이 맞지 않아 하향으로 그림',
      'POCKET3: 나선 진입 반지름·깊이(_RAD1·_DP1)가 없어 수직 이송으로 그림',
      'POCKET3: 긴 축 왕복 진입(_VARI 3X)은 수직 이송으로 그림',
    ];
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate('POCKET3: 가공 종류(_VARI = 0)가 맞지 않음 — 그리지 않음', 'en')).toBe('POCKET3: invalid machining type (_VARI = 0) — not drawn');
    expect(translate('POCKET4: 가공 방향(_CDIR = 7)이 맞지 않아 하향으로 그림', 'de')).toBe('POCKET4: ungültige Fräsrichtung (_CDIR = 7) — im Gleichlauf gezeichnet');
  });
});
