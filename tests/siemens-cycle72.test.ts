// Siemens CYCLE72(윤곽 밀링, 46차): SINUMERIK 840D sl 사이클 프로그래밍 설명서(6FC5398-3BP20-0BA0, 2006-11) 3.12절 163~170쪽.
// 윤곽 부프로그램(이름·표지 구간)을 읽어 층마다 접근(직선·사분원·반원, 평면·3D) → 윤곽 → 물러남 → 층 사이 길을 그리고, 반경 보정은 사이클이 낸
// G41·G42·G40 블록으로 보정 구간(compRuns)에 적어 기존 보정 경로(comp.ts)가 공구 중심을 그린다. 접근·물러남 길이는 SAR의 DISR 뜻
// (840D sl 프로그래밍 설명서 6FC5398-1BP40-5BA2 11.4절 269쪽 — 직선 = 날 끝에서 윤곽 시작까지, 원 = 공구 중심 길 반지름)을 따른다.
// 실제 Siemens 표본이 없어 설명서 예제와 합성 프로그램으로만 시험한다
import { describe, expect, it } from 'vitest';
import { ncCompPath } from '../src/comp';
import { FLAG_CYCLE, MOVE_ARC, MOVE_FEED, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

type Tools = Record<number, { diameter?: number; radius?: number }>;
const R7: Tools = { 20: { radius: 7 } };
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const run = (text: string, toolTable: Tools | undefined = R7, maxMoves?: number): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 300], toolTable, maxMoves });
/** 경고(줄 번호 뺌 — 설명서 예처럼 단위 코드가 없는 프로그램의 단위 알림은 뺌) */
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, '')).filter((w) => !w.startsWith('단위 코드'));
const DECIDED = 'CYCLE72: 층 사이 길(물러남 끝에서 들어 올리고 보정을 끈 공구 중심 자리로, 다음 층 접근 시작으로)과 3D 물러남 높이(_SDIS)는 정해 그림';
const cyc = (p: NcProgram): number[] => {
  const out: number[] = [];
  for (let i = 0; i < p.moves.count; i++) if (p.moves.flags[i]! & FLAG_CYCLE) out.push(i);
  return out;
};
const end3 = (p: NcProgram, i: number): number[] => moveEnd(p.moves, i).map(r3);
/** 평면 이송(이송 f — 윤곽의 _FFP1)·원호 끝점의 Z — 이어진 같은 값은 하나로(윤곽을 깎는 높이) */
const contourLevels = (p: NcProgram, f: number): number[] => {
  const out: number[] = [];
  for (const i of cyc(p)) {
    if (p.moves.kind[i] === MOVE_RAPID || p.moves.feed[i] !== f) continue;
    const s = moveStart(p.moves, i);
    const e = moveEnd(p.moves, i);
    // 평면에서 움직이고 높이가 그대로인 이동만
    if (Math.abs(s[2] - e[2]) > 1e-9 || Math.hypot(e[0] - s[0], e[1] - s[1]) < 1e-9) continue;
    const z = r3(e[2]);
    if (out[out.length - 1] !== z) out.push(z);
  }
  return out;
};
/** 설명서 예 1(165~166쪽): 부프로그램 이름을 부르는 이름과 맞춤(설명서는 MYCONTOUR를 부르고 %_N_MYCONTUR_SPF로 적음 — 오타) */
const EX1 = (call = '"MYCONTOUR", 250, 200, 3, 175, 10, 1, 1.5, 800, 400, 111, 41, 2, 20, 1000, 2, 20', head = ''): string =>
  `${head}N10 T20 D1\nN15 M6\nN20 S500 M3 F3000\nN25 G17 G0 G90 X100 Y200 Z250 G94\nN30 CYCLE72(${call})\nN90 X100 Y200\nN95 M02\n%_N_MYCONTOUR_SPF\nN100 G1 G90 X150 Y160\nN110 X230 CHF=10\nN120 Y80 CHF=10\nN130 X125\nN140 Y135\nN150 G2 X150 Y160 CR=25\nN160 M17\n`;
/** 열린 윤곽(직선 셋): (10, 10) → (50, 10) → (50, 40) → (80, 40) */
const OPEN = (call: string, head = ''): string => `${head}G71 G17 G90 G94\nT20 D1\nM6\nG0 X0 Y0 Z20\nCYCLE72(${call})\nG0 X0 Y0\nM30\n%_N_K1_SPF\nG0 G90 X10 Y10\nG1 X50\nY40\nX80\nM17\n`;

describe('Siemens CYCLE72', () => {
  it('설명서 예 1: 거친 깎기 3층(_ZSD[1] = 0 — 203에서 176.5까지 절입 10 이하), G41 사분원 접근·물러남, 층 사이는 _RFP + _SDIS로 G1(_FF3)', () => {
    const p = run(EX1());
    expect(warns(p)).toEqual([DECIDED]);
    expect(contourLevels(p, 800)).toEqual([194.167, 185.333, 176.5]);
    const c = cyc(p);
    // 첫 이동: 지금 높이(Z250)에서 접근 시작(프로그램 경로 — 윤곽을 _FAL 1만큼 왼쪽으로 옮긴 시작 (150, 161)에서 반지름 7 + 20 = 27인 사분원의 시작)
    expect(end3(p, c[0]!)).toEqual([123, 188, 250]);
    expect(p.moves.kind[c[0]!]).toBe(MOVE_FEED);
    // 깊이 진입: 층 + 안전 거리(G1 _FF3) → 층(_FFD) → 사분원(G3, _FFP1)
    expect(end3(p, c[1]!)).toEqual([123, 188, 197.167]);
    expect(end3(p, c[2]!)).toEqual([123, 188, 194.167]);
    expect(p.moves.kind[c[3]!]).toBe(MOVE_ARC);
    expect(end3(p, c[3]!)).toEqual([150, 161, 194.167]);
    expect(p.arcs.sweep[p.moves.arc[c[3]!]!]!).toBeCloseTo(Math.PI / 2, 9);
    // 보정 구간: 층마다 하나(G41, 공구 반지름 7)
    expect(p.compRuns?.map((r) => [r.side, r.radius])).toEqual([
      [1, 7],
      [1, 7],
      [1, 7],
    ]);
    // 끝: 물러남 사분원 끝(177, 188) 위 후퇴 면에서 보정을 끄고 공구 중심 자리(170, 188)로 — 설명서 167쪽 "물러난 자리 위 후퇴 면"
    const last = c[c.length - 1]!;
    expect(end3(p, last)).toEqual([170, 188, 250]);
    expect(end3(p, last - 1)).toEqual([177, 188, 250]);
    // 사이클 뒤 N90은 사이클이 끝난 자리에서(G0 모달 그대로)
    expect(p.moves.kind[last + 1]).toBe(MOVE_RAPID);
    expect(end3(p, last + 1)).toEqual([100, 200, 250]);
  });

  it('설명서 예 1의 보정 경로(공구 중심): 사분원 접근 반지름 = _LP1(20), 윤곽은 7 + _FAL 1만큼 바깥, 들어가기·나오기는 공구 중심 자리', () => {
    const p = run(EX1());
    const cp = ncCompPath(p);
    expect(cp.warnings).toEqual([]);
    // 첫 층 조각: 들어가기 (100, 200, 250) → (130, 188, 250)
    expect(Array.from(cp.points.slice(0, 6)).map(r3)).toEqual([100, 200, 250, 130, 188, 250]);
    // 접근 원호: 중심 (150, 188), 반지름 20, 반시계 90°
    const arcs: number[][] = [];
    for (let i = 0; i < cp.count; i++) {
      if (cp.kind[i] !== 1) continue;
      const cx = cp.center[i * 3]!;
      const cy = cp.center[i * 3 + 1]!;
      arcs.push([r3(cx), r3(cy), r3(Math.hypot(cp.points[i * 6]! - cx, cp.points[i * 6 + 1]! - cy)), r3(cp.sweep[i]!)]);
    }
    expect(arcs[0]).toEqual([150, 188, 20, r3(Math.PI / 2)]);
    // 윤곽 위 변(Y160)은 공구 중심 Y168(7 + 1)
    let top = false;
    for (let i = 0; i < cp.count; i++) if (cp.kind[i] === 0 && r3(cp.points[i * 6 + 1]!) === 168 && r3(cp.points[i * 6 + 4]!) === 168 && cp.points[i * 6 + 3]! > cp.points[i * 6]! + 10) top = true;
    expect(top).toBe(true);
  });

  it('다듬질(12)은 _FAL 없이 윤곽 그대로 _DP까지 층마다, G42 직선 접근(공구 중심이 _LP1 + 반지름만큼 접선 뒤에서) — _AS2를 주지 않으면 물러남도 같은 꼴', () => {
    const p = run(OPEN('"K1", 10, 0, 2, -11, 6, 1, 0.5, 500, 100, 12, 42, 1, 5, 900'));
    expect(warns(p)).toEqual([DECIDED]);
    // 다듬질도 절입 6 이하로 층마다(설명서 163·167쪽 — 기준면 + 안전 거리 2에서 -11까지 13을 셋)
    expect(contourLevels(p, 500)).toEqual([-2.333, -6.667, -11]);
    const c = cyc(p);
    // 접근 직선: 윤곽 시작 (10, 10)에서 접선 (1, 0)의 뒤로 5 + 7
    expect(end3(p, c[0]!)).toEqual([-2, 10, 20]);
    // 물러남 직선: 윤곽 끝 (80, 40)에서 접선 (1, 0)으로 5 + 7
    expect(cyc(p).some((i) => end3(p, i).join() === '92,40,-11')).toBe(true);
    expect(p.compRuns?.every((r) => r.side === 2 && r.radius === 7)).toBe(true);
    // 보정 경로: 오른쪽(G42) — 윤곽 첫 변(Y10)의 공구 중심은 Y3
    const cp = ncCompPath(p);
    let side = false;
    for (let i = 0; i < cp.count; i++) if (cp.kind[i] === 0 && r3(cp.points[i * 6 + 1]!) === 3 && r3(cp.points[i * 6 + 4]!) === 3) side = true;
    expect(side).toBe(true);
  });

  it('_RL = 40(가운데): 보정 없이 윤곽 그대로, 직선으로만 접근(_LP1 = 공구 중심에서 윤곽 시작까지), _FAL은 0이어야 함', () => {
    const p = run(OPEN('"K1", 10, 0, 2, -5, 0, 1, 0, 500, 100, 1, 40, 2, 5'));
    expect(warns(p)).toEqual([
      'CYCLE72: 가운데(_RL = 40)로 돌면 _FAL은 0이어야 함(설명서 169쪽) — 여유 없이 그림',
      'CYCLE72: 가운데(_RL = 40)는 직선으로만 접근·물러남(설명서 170쪽) — 직선으로 그림',
      DECIDED,
    ]);
    expect(p.compRuns ?? []).toEqual([]);
    const c = cyc(p);
    expect(end3(p, c[0]!)).toEqual([5, 10, 20]);
    // _MID = 0이면 한 층(_DP + _FALD)
    expect(contourLevels(p, 500)).toEqual([-5]);
    // 윤곽은 프로그램 그대로(여유 없음): 첫 변 끝 (50, 10)
    expect(c.some((i) => end3(p, i).join() === '50,10,-5')).toBe(true);
  });

  it('3D 접근·물러남(_AS1·_AS2 십의 자리 1): 접근 원호가 층 + 안전 거리에서 층으로 내려가며(_FFD) 물러남 원호는 안전 거리만큼 오름', () => {
    const p = run(OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 12, 5, , 13, 4'));
    const c = cyc(p);
    const arcs = c.filter((i) => p.moves.kind[i] === MOVE_ARC);
    expect(arcs.length).toBe(2);
    const a0 = arcs[0]!;
    expect(r3(moveStart(p.moves, a0)[2])).toBe(-3);
    expect(r3(moveEnd(p.moves, a0)[2])).toBe(-5);
    expect(p.moves.feed[a0]).toBe(100);
    const a1 = arcs[1]!;
    expect(r3(moveStart(p.moves, a1)[2])).toBe(-5);
    expect(r3(moveEnd(p.moves, a1)[2])).toBe(-3);
    // 물러남 반원(_AS2 = 13, _LP2 = 4): 윤곽 끝 (80, 40)에서 왼쪽으로 2 × (4 + 7)
    expect(end3(p, a1).slice(0, 2)).toEqual([80, 62]);
    expect(Math.abs(p.arcs.sweep[p.moves.arc[a1]!]!)).toBeCloseTo(Math.PI, 9);
  });

  it('_VARI 백의 자리(층 사이 들어 올림 0 = _RTP, 2 = 층 + _SDIS, 3 = 그대로)와 십의 자리 0(층 사이 길 G0)', () => {
    const lifts = (vari: number): number[] => {
      const p = run(OPEN(`"K1", 10, 0, 2, -10, 4, 0, 0, 500, 100, ${vari}, 41, 1, 5, 900`));
      const c = cyc(p);
      // 보정을 끈 뒤 공구 중심 자리로 가는 이동(물러남 끝 (92, 40)에서 왼쪽으로 7 — (92, 47))의 높이. 층은 -2·-6·-10, 마지막은 늘 _RTP
      return c.filter((i) => end3(p, i)[0] === 92 && end3(p, i)[1] === 47).map((i) => end3(p, i)[2]!);
    };
    expect(lifts(1)).toEqual([10, 10, 10]);
    expect(lifts(201)).toEqual([0, -4, 10]);
    expect(lifts(301)).toEqual([-2, -6, 10]);
    const g0 = run(OPEN('"K1", 10, 0, 2, -10, 4, 0, 0, 500, 100, 101, 41, 1, 5, 900'));
    const g1 = run(OPEN('"K1", 10, 0, 2, -10, 4, 0, 0, 500, 100, 111, 41, 1, 5, 900'));
    expect(g0.moves.kind[cyc(g0)[0]!]).toBe(MOVE_RAPID);
    expect(g1.moves.kind[cyc(g1)[0]!]).toBe(MOVE_FEED);
    expect(g1.moves.feed[cyc(g1)[0]!]).toBe(900);
    // _FF3를 주지 않으면 층 사이 G1은 _FFP1
    const g1f = run(OPEN('"K1", 10, 0, 2, -10, 4, 0, 0, 500, 100, 111, 41, 1, 5'));
    expect(g1f.moves.feed[cyc(g1f)[0]!]).toBe(500);
  });

  it('설명서 예 2 꼴: 부르는 프로그램 안 "START:END" 구간(GOTOF로 건너뜀) — 같은 블록의 이동 뒤에 사이클', () => {
    const text =
      '$TC_DP1[20,1]=120 $TC_DP6[20,1]=7\nN10 T20 D1\nN15 M6\nN20 S500 M3 F3000\nN25 G17 G0 G90 G94 X100 Y200 Z250 CYCLE72("START:END", 250, 200, 3, 175, 10, 1, 1.5, 800, 400, 11, 41, 2, 20, 1000, 2, 20)\nN30 G0 X100 Y200\nN35 GOTOF END\nSTART:\nN100 G1 G90 X150 Y160\nN110 X230 CHF=10\nN120 Y80 CHF=10\nN130 X125\nN140 Y135\nN150 G2 X150 Y160 CR=25\nEND:\nN160 M02\n';
    const p = run(text);
    expect(contourLevels(p, 800)).toEqual([194.167, 185.333, 176.5]);
    // 백의 자리 0: 층 사이 _RTP(250)로
    const c = cyc(p);
    expect(c.filter((i) => end3(p, i).join() === '170,188,250').length).toBe(3);
    // 윤곽 블록은 주 흐름에서 건너뜀: 사이클 뒤 N30 하나만
    expect(p.moves.count).toBe(c[c.length - 1]! + 2);
  });

  it('공구 반지름을 모르면 접근·물러남 길을 반지름 0으로 셈(경고), 보정 구간 반지름은 모름', () => {
    const p = run(OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 2, 5'), {});
    expect(warns(p)).toEqual(['CYCLE72: 공구 반지름을 몰라 접근·물러남 길을 반지름 0으로 셈 — 보정 경로는 공구 반지름을 알아야 그림', DECIDED]);
    // 사분원 시작 = 윤곽 시작 (10, 10) + 5·(0, 1) − 5·(1, 0)
    expect(end3(p, cyc(p)[0]!)).toEqual([5, 15, 20]);
    expect(Number.isNaN(p.compRuns![0]!.radius)).toBe(true);
  });

  it('온 원(G3 한 블록, 시작 = 끝)과 프레임(TRANS)·평면 G18을 따른다', () => {
    const circle = 'G71 G17 G90\nT20 D1\nG0 X0 Y0 Z20\nCYCLE72("C1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 2, 42, 1, 5)\nM30\n%_N_C1_SPF\nG0 G90 X20 Y0\nG3 X20 Y0 I-20 J0\nM17\n';
    const p = run(circle);
    const full = cyc(p).filter((i) => p.moves.kind[i] === MOVE_ARC);
    expect(full.length).toBe(1);
    expect(p.arcs.sweep[p.moves.arc[full[0]!]!]!).toBeCloseTo(2 * Math.PI, 9);
    const t = run(OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 2, 40, 1, 5', 'TRANS X100\n'));
    expect(end3(t, cyc(t)[0]!)).toEqual([105, 10, 20]);
    // G18: 평면 Z·X, 공구 축 Y
    const g18 = run('G71 G18 G90\nT20 D1\nG0 Z0 X0 Y20\nCYCLE72("K2", 10, 0, 2, -5, 0, 0, 0, 500, 100, 2, 40, 1, 5)\nM30\n%_N_K2_SPF\nG0 G90 Z10 X10\nG1 Z50\nX40\nM17\n');
    const c18 = cyc(g18);
    expect(end3(g18, c18[0]!)).toEqual([10, 20, 5]);
    expect(end3(g18, c18[2]!)).toEqual([10, -5, 5]);
  });

  it('그리지 않는 것: _KNAME 없음·윤곽 없음·블록 둘보다 적음·_VARI(61002)·_RL·_AS1·_LP1 = 0(61116)·_AS2를 주고 _LP2 = 0(61116)·D0(61000)·61101', () => {
    const cases: [string, string, Tools | undefined][] = [
      [OPEN('10, 0, 2, -5'), 'CYCLE72: 윤곽 이름(_KNAME)이 없음 — 그리지 않음', R7],
      [OPEN('"NOPE", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 1, 5'), 'CYCLE72: 윤곽 NOPE을(를) 찾지 못함 — 다른 파일이면 함께 열어야 읽음', R7],
      ['G17 G90\nT20 D1\nG0 X0 Y0 Z20\nCYCLE72("K3", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 1, 5)\nM30\n%_N_K3_SPF\nG0 X5 Y5\nM17\n', 'CYCLE72: 윤곽 블록이 2개보다 적음(설명서 163쪽 — 시작점과 끝점) — 그리지 않음', R7],
      [OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 3, 41, 1, 5'), 'CYCLE72: 가공 종류(_VARI = 3)가 맞지 않음(알람 61002) — 그리지 않음', R7],
      [OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 412, 41, 1, 5'), 'CYCLE72: 가공 종류(_VARI = 412)가 맞지 않음(알람 61002) — 그리지 않음', R7],
      [OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 43, 1, 5'), 'CYCLE72: 윤곽 쪽(_RL = 43)이 40·41·42가 아님 — 그리지 않음', R7],
      [OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 4, 5'), 'CYCLE72: 접근 방식(_AS1 = 4)이 맞지 않음 — 그리지 않음', R7],
      [OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 1, 0'), 'CYCLE72: 접근 길이·반지름(_LP1)이 0(알람 61116) — 그리지 않음', R7],
      [OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 1, 5, , 2, 0'), 'CYCLE72: 물러남 길이·반지름(_LP2)이 0(알람 61116) — 그리지 않음', R7],
      [OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 1, 5').replace('T20 D1', 'T20 D0'), 'CYCLE72: 공구 보정이 없음(D0 — 알람 61000) — 그리지 않음', R7],
      [OPEN('"K1", 0, 10, 2, -5, 0, 0, 0, 500, 100, 1, 41, 1, 5'), 'CYCLE72: 후퇴 면이 기준면보다 최종 깊이에 가까움(알람 61101) — 그리지 않음', R7],
      [OPEN('"K1", 10, 0, 2, , 0, 0, 0, 500, 100, 1, 41, 1, 5'), 'CYCLE72: 깊이(_DP)가 없음 — 그리지 않음', R7],
    ];
    for (const [text, w, tools] of cases) {
      const p = run(text, tools);
      expect(warns(p), w).toEqual([w]);
      expect(cyc(p).length, w).toBe(0);
      expect(p.compRuns ?? [], w).toEqual([]);
    }
  });

  it('윤곽 안 낱말: 반경 보정(G41)·CIP는 그리지 않고, 공구 축 좌표는 읽지 않음(경고)·첫 블록이 직선이 아님', () => {
    const body = (lines: string): string => `G17 G90\nT20 D1\nG0 X0 Y0 Z20\nCYCLE72("K4", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 41, 1, 5)\nM30\n%_N_K4_SPF\n${lines}\nM17\n`;
    expect(warns(run(body('G0 X0 Y0\nG41 G1 X10\nY10')))).toEqual(['CYCLE72: 윤곽의 G41은(는) 읽지 않음 — 그리지 않음']);
    expect(warns(run(body('G0 X0 Y0\nCIP X10 Y0 I1=5 J1=3\nY10')))).toEqual(['CYCLE72: 윤곽의 CIP은(는) 읽지 않음 — 그리지 않음']);
    const z = run(body('G0 X0 Y0\nG1 X10 Z-3\nY10'));
    expect(warns(z)).toEqual(['CYCLE72: 윤곽의 공구 축 좌표(Z)는 읽지 않음 — 윤곽은 한 평면(설명서 163쪽)', DECIDED]);
    const nog = run(body('X0 Y0\nG1 X10\nY10'));
    expect(warns(nog)).toEqual(['CYCLE72: 윤곽 첫 블록이 G0·G1 직선 블록이 아님(설명서 167쪽) — 첫 블록은 시작 자리로만 봄', DECIDED]);
  });

  it('반경 보정이 켜진 채 부르면 알리고 사이클 끝에서 보정을 끈다(G40)', () => {
    const p = run(OPEN('"K1", 10, 0, 2, -5, 0, 0, 0, 500, 100, 1, 42, 1, 5').replace('G0 X0 Y0 Z20', 'G41 G0 X0 Y0 Z20'));
    expect(warns(p)[0]).toBe('CYCLE72: 반경 보정(G41·G42)이 켜진 채 부름 — 사이클이 보정을 다시 고르고 끝에서 끔(G40)');
    const runs = p.compRuns!;
    expect(runs[runs.length - 1]!.side).toBe(2);
    // 사이클 뒤 이동은 보정 밖
    expect(runs[runs.length - 1]!.end).toBeLessThan(p.moves.count);
  });

  it('이동 한도에 닿으면 거기서 멈춘다', () => {
    const p = run(EX1('"MYCONTOUR", 250, 200, 3, 175, 0.01, 1, 1.5, 800, 400, 111, 41, 2, 20, 1000, 2, 20'), R7, 200);
    expect(p.moves.count).toBeLessThanOrEqual(200);
    expect(p.warnings.some((w) => w.includes('200개를 넘어'))).toBe(true);
  });

  it('새 경고가 네 언어에서 한국어 없이 옮겨진다', () => {
    const texts = [
      DECIDED,
      'CYCLE72: 가운데(_RL = 40)로 돌면 _FAL은 0이어야 함(설명서 169쪽) — 여유 없이 그림',
      'CYCLE72: 가운데(_RL = 40)는 직선으로만 접근·물러남(설명서 170쪽) — 직선으로 그림',
      'CYCLE72: 공구 반지름을 몰라 접근·물러남 길을 반지름 0으로 셈 — 보정 경로는 공구 반지름을 알아야 그림',
      'CYCLE72: 윤곽 이름(_KNAME)이 없음 — 그리지 않음',
      'CYCLE72: 윤곽 NOPE을(를) 찾지 못함 — 다른 파일이면 함께 열어야 읽음',
      'CYCLE72: 윤곽 구간 A:B을(를) 찾지 못함 — 그리지 않음',
      'CYCLE72: 윤곽 블록이 2개보다 적음(설명서 163쪽 — 시작점과 끝점) — 그리지 않음',
      'CYCLE72: 가공 종류(_VARI = 3)가 맞지 않음(알람 61002) — 그리지 않음',
      'CYCLE72: 윤곽 쪽(_RL = 43)이 40·41·42가 아님 — 그리지 않음',
      'CYCLE72: 접근 방식(_AS1 = 4)이 맞지 않음 — 그리지 않음',
      'CYCLE72: 물러남 방식(_AS2 = 4)이 맞지 않음 — 그리지 않음',
      'CYCLE72: 접근 길이·반지름(_LP1)이 0(알람 61116) — 그리지 않음',
      'CYCLE72: 물러남 길이·반지름(_LP2)이 0(알람 61116) — 그리지 않음',
      'CYCLE72: 공구 보정이 없음(D0 — 알람 61000) — 그리지 않음',
      'CYCLE72: 후퇴 면이 기준면보다 최종 깊이에 가까움(알람 61101) — 그리지 않음',
      'CYCLE72: 깊이(_DP)가 없음 — 그리지 않음',
      'CYCLE72: 윤곽의 G41은(는) 읽지 않음 — 그리지 않음',
      'CYCLE72: 윤곽 블록을 읽을 수 없음 — 0으로 나눔',
      'CYCLE72: 윤곽의 공구 축 좌표(Z)는 읽지 않음 — 윤곽은 한 평면(설명서 163쪽)',
      'CYCLE72: 윤곽 첫 블록이 G0·G1 직선 블록이 아님(설명서 167쪽) — 첫 블록은 시작 자리로만 봄',
      'CYCLE72: 윤곽 첫 블록에 두 축 좌표가 다 있어야 함 — 없는 축은 지금 자리로 봄',
      'CYCLE72: 윤곽 원호에 중심(I·J·K)·반지름(CR)이 없음 — 그리지 않음',
      'CYCLE72: 모서리 둥글리기·모따기(RND·CHF·CHR)를 넣을 수 없음 — 모서리 그대로 그림',
      'CYCLE72: 윤곽 점이 모자람 — 그리지 않음',
      'CYCLE72: 거친 깎기 끝(_DP + _FALD)이 시작 높이보다 위 — 깎을 층이 없음',
      'CYCLE72: 다듬질 여유(_FAL)를 둔 윤곽이 남지 않음 — 그리지 않음',
      'CYCLE72: 반경 보정(G41·G42)이 켜진 채 부름 — 사이클이 보정을 다시 고르고 끝에서 끔(G40)',
    ];
    for (const t of texts) for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate(DECIDED, 'en')).toBe(
      'CYCLE72: the paths between levels (lift at the retraction end, move to the tool-center point with compensation off, then to the next approach start) and the 3D retraction height (_SDIS) are drawn as decided',
    );
  });
});
