// Siemens LONGHOLE(원 위 긴 구멍)·SLOT1(원 위 홈)·SLOT2(원주 홈)(40차): SINUMERIK 840D sl 사이클 프로그래밍 설명서 3.4~3.6절의 매개변수·순서대로 그린다
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { FLAG_CYCLE, MOVE_ARC, MOVE_FEED, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';

type Tools = Record<number, { diameter?: number; radius?: number }>;
const D10: Tools = { 1: { diameter: 10 } };
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const run = (text: string, toolTable: Tools | undefined = D10, maxMoves?: number): NcProgram =>
  parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable, ...(maxMoves ? { maxMoves } : {}) });
const end = (p: NcProgram, i: number): number[] => moveEnd(p.moves, i);
/** 사이클 이동(FLAG_CYCLE) 차례 */
const cyc = (p: NcProgram): number[] => Array.from({ length: p.moves.count }, (_, i) => i).filter((i) => p.moves.flags[i]! & FLAG_CYCLE);
/** 사이클 이송(직선·원호) 끝점의 축 k 값 — 이어진 같은 값은 하나로 */
const depths = (p: NcProgram, k: number): number[] => {
  const out: number[] = [];
  for (const i of cyc(p)) {
    if (p.moves.kind[i] === MOVE_RAPID) continue;
    const z = r3(end(p, i)[k]!);
    if (out[out.length - 1] !== z) out.push(z);
  }
  return out;
};
/** 점 q에서 선분 ab까지 거리 */
const segDist = (q: number[], a: number[], b: number[]): number => {
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((q[0]! - a[0]!) * dx + (q[1]! - a[1]!) * dy) / L2)) : 0;
  return Math.hypot(q[0]! - a[0]! - t * dx, q[1]! - a[1]! - t * dy);
};
const DEG = Math.PI / 180;

// 설명서 3.4절 예제(공구는 지름 10으로 정함 — 예제에 없다): G19 평면, 원 중심 Y40 Z45, 반지름 20, 시작 45°·간격 90°, 길이 30, 상대 깊이 23, 최대 절입 6
const LONGHOLE_EX = 'N10 G71 G19 G90 S600 M3\nT10 D1\nM6\nN20 G0 Y50 Z25 X5\nN30 LONGHOLE (5, 0, 1, , 23, 4, 30, 40, 45, 20, 45, 90, 100, 320, 6)\nN40 M30';
// 설명서 3.5절 예제: 같은 자리에 길이 30·너비 15 홈, 깊이 -23, G2, 마무리 여유 0.5, 최대 절입 10, VARI 30(완전 가공·왕복 진입), MIDF 10, FFP2 400, SSF 1200, _FALD 0.6, _STA2 5
const SLOT1_EX = 'N10 G71 G19 G90 S600 M3\nN15 T10 D1\nN17 M6\nN20 G0 Y20 Z50 X5\nN30 SLOT1 (5, 0, 1, -23, , 4, 30, 15, 40, 45, 20, 45, 90, 100, 320, 10, 2, 0.5, 30, 10, 400, 1200, 0.6, 5)\nN40 M30';
// 설명서 3.6절 예제: G17, 원 중심 X60 Y60 반지름 42에 홈 3개(각 70°·너비 15·깊이 -23), 간격 120°, FFD = 100(DEF), FFP1 = FFD + 200, 최대 절입 6, G2, 마무리 여유 0.5
const SLOT2_EX = 'DEF REAL FFD=100\nN10 G71 G17 G90 S600 M3\nN15 T10 D1\nN17 M6\nN20 G0 X60 Y60 Z5\nN30 SLOT2 (2, 0, 2, -23, , 3, 70, 15, 60, 60, 42, , 120, FFD, FFD+200, 6, 2, 0.5)\nN40 M30';

describe('LONGHOLE 원 위 긴 구멍', () => {
  it('설명서 3.4절 예제: 가까운 끝부터 끝마다 진입하며 왕복, 구멍 사이는 후퇴 면, 마지막 자리에서 후퇴 면으로', () => {
    const p = run(LONGHOLE_EX.replace('T10', 'T1'));
    expect(p.warnings).toEqual([]);
    // G19: 공구 축 X. 기준면 + 안전 거리 1에서 -23까지 6 이하 같은 절입 넷(6씩)
    expect(depths(p, 0).filter((x) => x < 1)).toEqual([-5, -11, -17, -23, -5, -11, -17, -23, -5, -11, -17, -23, -5, -11, -17, -23]);
    // 공구 중심은 구멍 축 위: 원 중심에서 반지름 + 공구 반지름 = 25 ~ 반지름 + 길이 - 공구 반지름 = 45
    const holes = [45, 135, 225, 315].map((a) => [
      [40 + 25 * Math.cos(a * DEG), 45 + 25 * Math.sin(a * DEG)],
      [40 + 45 * Math.cos(a * DEG), 45 + 45 * Math.sin(a * DEG)],
    ]);
    for (const i of cyc(p)) {
      if (p.moves.kind[i] !== MOVE_FEED) continue;
      const q = [end(p, i)[1]!, end(p, i)[2]!];
      expect(Math.min(...holes.map(([a, b]) => segDist(q, a!, b!))), `이동 ${i}`).toBeLessThan(1e-9);
    }
    // 첫 진입은 시작 자리(Y50 Z25)에서 가까운 안쪽 끝, 층이 짝수라 구멍마다 같은 끝에서 끝난다
    const firstFeed = cyc(p).find((i) => p.moves.kind[i] === MOVE_FEED)!;
    expect(end(p, firstFeed).map(r3)).toEqual([-5, r3(40 + 25 * Math.cos(45 * DEG)), r3(45 + 25 * Math.sin(45 * DEG))]);
    // 끝: 후퇴 면 X5(마지막 구멍 안쪽 끝 위)
    expect(end(p, p.moves.count - 1).map(r3)).toEqual([5, r3(40 + 25 * Math.cos(315 * DEG)), r3(45 + 25 * Math.sin(315 * DEG))]);
  });

  it('공구가 길이보다 크면(알람 61105)·깊이·개수가 없으면 그리지 않는다', () => {
    const big = run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nLONGHOLE(5, 0, 1, -10, , 2, 8, 0, 0, 20, 0, 0, 100, 300, 5)\nG0 X99\nM30');
    expect(big.warnings).toEqual(['3번 줄: LONGHOLE: 공구가 홈보다 큼(알람 61105) — 그리지 않음']);
    expect(cyc(big)).toEqual([]);
    expect(run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nLONGHOLE(5, 0, 1, , , 2, 30, 0, 0, 20, 0, 0, 100, 300, 5)\nM30').warnings).toEqual(['3번 줄: LONGHOLE: 깊이(DP·DPR)가 없음 — 그리지 않음']);
    expect(run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nLONGHOLE(5, 0, 1, -10, , 0, 30, 0, 0, 20, 0, 0, 100, 300, 5)\nM30').warnings).toEqual(['3번 줄: LONGHOLE: 개수(NUM)가 없음 — 그리지 않음']);
  });

  it('구멍끼리 겹치면(알람 61104) 그리지 않는다 — 안쪽 끝끼리가 가장 가깝다', () => {
    // 반지름 5 원에 지름 10 구멍 8개: 안쪽 끝 반원 중심 거리 10 × sin(22.5°) < 5
    const p = run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nLONGHOLE(5, 0, 1, -10, , 8, 30, 0, 0, 5, 0, 0, 100, 300, 5)\nM30');
    expect(p.warnings).toEqual(['3번 줄: LONGHOLE: 홈끼리 겹침(알람 61104) — 그리지 않음']);
    // 반지름 20이면 25 × sin(22.5°) = 9.6 > 5 — 그린다
    expect(run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nLONGHOLE(5, 0, 1, -10, , 8, 30, 0, 0, 20, 0, 0, 100, 300, 5)\nM30').warnings).toEqual([]);
  });
});

describe('SLOT1 원 위 홈', () => {
  it('설명서 3.5절 예제: 왕복 진입(_STA2 5°)·층마다 홈 둘레 고리·바닥 여유·MIDF 정삭, SSF는 경고', () => {
    const p = run(SLOT1_EX.replace('T10', 'T1'));
    expect(p.warnings).toEqual(['5번 줄: SLOT1: 정삭 회전수(SSF)는 반영하지 않음']);
    // 공구 중심이 닿는 곳: 홈 축(안쪽 끝 반원 중심 27.5 ~ 바깥 42.5)에서 너비/2 - 반지름 = 2.5 안
    const axes = [45, 135, 225, 315].map((a) => [
      [40 + 27.5 * Math.cos(a * DEG), 45 + 27.5 * Math.sin(a * DEG)],
      [40 + 42.5 * Math.cos(a * DEG), 45 + 42.5 * Math.sin(a * DEG)],
    ]);
    let far = 0;
    for (const i of cyc(p)) {
      if (p.moves.kind[i] === MOVE_RAPID) continue;
      const q = [end(p, i)[1]!, end(p, i)[2]!];
      far = Math.max(far, Math.min(...axes.map(([a, b]) => segDist(q, a!, b!))));
    }
    expect(r3(far)).toBe(2.5);
    // 가장 깊은 곳은 -23(정삭 바닥), 황삭 바닥은 -23 + 0.6
    const xs = cyc(p).map((i) => r3(end(p, i)[0]!));
    expect(Math.min(...xs)).toBe(-23);
    expect(xs).toContain(-22.4);
    // 왕복 진입: 깊이와 평면이 함께 바뀌는 이송(경사 행정)이 있고, 경사는 5°를 넘지 않는다
    let ramps = 0;
    for (const i of cyc(p)) {
      if (p.moves.kind[i] !== MOVE_FEED) continue;
      const s = i > 0 ? end(p, i - 1) : [0, 0, 0];
      const e = end(p, i);
      const dz = Math.abs(e[0]! - s[0]!);
      const dl = Math.hypot(e[1]! - s[1]!, e[2]! - s[2]!);
      if (dz > 1e-9 && dl > 1e-9) {
        ramps++;
        expect(Math.atan2(dz, dl) / DEG).toBeLessThanOrEqual(5 + 1e-9);
      }
    }
    // 황삭 세 층(1 → -22.4, 7.8씩) × 행정 6(7.8 / (15 × tan 5°) → 6 — 짝수라 진입 끝에서 시작) × 홈 4
    expect(ramps).toBe(3 * 6 * 4);
  });

  it('수직 진입(VARI 10)·하향(CDIR 0, M3 → G3)·가공 방향 G3 고리, 끝은 후퇴 면', () => {
    const p = run('G71 G17 G90 T1 D1 S1000 M3\nG0 X0 Y0 Z10\nSLOT1(5, 0, 1, -6, , 1, 30, 12, 0, 0, 20, 0, 0, 100, 300, 3, 0, 0, 11)\nG0 X99\nM30');
    expect(p.warnings).toEqual([]);
    // 1 → -6을 3 이하 같은 절입 셋(7/3씩), 층마다 같은 자리(가까운 끝 = 안쪽 끝 반원 중심 X26)에서 수직 G1
    expect(depths(p, 2)).toEqual([-1.333, -3.667, -6]);
    const plunges = cyc(p).filter((i) => p.moves.kind[i] === MOVE_FEED && Math.abs(end(p, i)[2]! - end(p, i - 1)[2]!) > 1e-9);
    expect(plunges.map((i) => [r3(end(p, i)[0]!), r3(end(p, i)[1]!)])).toEqual([
      [26, 0],
      [26, 0],
      [26, 0],
    ]);
    // 고리의 원호는 모두 반시계(G3) — 반너비 6 - 5 = 1
    const arcs = cyc(p).filter((i) => p.moves.kind[i] === MOVE_ARC);
    expect(arcs.length).toBe(3 * 3);
    for (const i of arcs) expect(p.arcs.sweep[p.moves.arc[i]!]!).toBeGreaterThan(0);
    expect(end(p, p.moves.count - 1)[0]).toBe(99);
  });

  it('공구 지름 = 너비 - 2 FAL이면 LONGHOLE처럼 양 끝에서 번갈아 진입하며 왕복(설명서 SLOT2 특수한 경우와 같은 꼴)', () => {
    const p = run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nSLOT1(5, 0, 1, -6, , 1, 30, 10, 0, 0, 20, 0, 0, 100, 300, 3, 2, 0, 11)\nM30');
    expect(p.warnings).toEqual([]);
    expect(cyc(p).filter((i) => p.moves.kind[i] === MOVE_ARC)).toEqual([]);
    // 끝 반원 중심 X25 ↔ X45를 오가며 층마다 끝에서 진입
    const feeds = cyc(p)
      .filter((i) => p.moves.kind[i] === MOVE_FEED)
      .map((i) => [r3(end(p, i)[0]!), r3(end(p, i)[2]!)]);
    expect(feeds).toEqual([
      [25, -1.333],
      [45, -1.333],
      [45, -3.667],
      [25, -3.667],
      [25, -6],
      [45, -6],
    ]);
  });

  it('잘못된 값: 공구가 너비보다 큼(61105)·길이가 너비보다 작음·VARI(61102)·겹침(61104)', () => {
    const w = (call: string): string[] => run(`G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\n${call}\nM30`).warnings;
    expect(w('SLOT1(5, 0, 1, -6, , 1, 30, 8, 0, 0, 20, 0, 0, 100, 300, 3, 2, 0, 1)')).toEqual(['3번 줄: SLOT1: 공구가 홈보다 큼(알람 61105) — 그리지 않음']);
    expect(w('SLOT1(5, 0, 1, -6, , 1, 10, 12, 0, 0, 20, 0, 0, 100, 300, 3, 2, 0, 1)')).toEqual(['3번 줄: SLOT1: 홈 크기(LENG·WID)가 맞지 않음 — 그리지 않음']);
    expect(w('SLOT1(5, 0, 1, -6, , 1, 30, 12, 0, 0, 20, 0, 0, 100, 300, 3, 2, 0, 21)')).toEqual(['3번 줄: SLOT1: 가공 종류(VARI = 21)가 맞지 않음 — 그리지 않음']);
    expect(w('SLOT1(5, 0, 1, -6, , 6, 30, 12, 0, 0, 5, 0, 0, 100, 300, 3, 2, 0, 1)')).toEqual(['3번 줄: SLOT1: 홈끼리 겹침(알람 61104) — 그리지 않음']);
    expect(w('SLOT1(5, 0, 1, -6, , 1, 30, 12, 0, 0, 20, 0, 0, 100, 300, 3, 7, 0, 1)')).toEqual(['3번 줄: SLOT1: 가공 방향(CDIR = 7)이 맞지 않아 하향으로 그림']);
    expect(w('SLOT1(5, 0, 1, -6, , 1, 30, 12, 0, 0, 20, 0, 0, 100, 300, 3, 2, 0, 31)')).toEqual(['3번 줄: SLOT1: 왕복 진입 각(_STA2)이 없어 수직 이송으로 그림']);
  });

  it('프레임(TRANS)·평면을 따르고, 아주 작은 MID도 이동 한도에서 멈춘다', () => {
    const base = run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nSLOT1(5, 0, 1, -6, , 2, 30, 12, 0, 0, 20, 0, 0, 100, 300, 3, 2, 0, 11)\nM30');
    const moved = run('G71 G17 G90 T1 D1\nTRANS X10 Y-5\nG0 X0 Y0 Z10\nSLOT1(5, 0, 1, -6, , 2, 30, 12, 0, 0, 20, 0, 0, 100, 300, 3, 2, 0, 11)\nM30');
    const a = cyc(base);
    const b = cyc(moved);
    expect(b.length).toBe(a.length);
    for (let k = 0; k < a.length; k++) {
      const e0 = end(base, a[k]!);
      const e1 = end(moved, b[k]!);
      expect([r3(e1[0]! - e0[0]!), r3(e1[1]! - e0[1]!), r3(e1[2]! - e0[2]!)]).toEqual([10, -5, 0]);
    }
    const lim = run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nSLOT1(5, 0, 1, -6, , 2, 30, 12, 0, 0, 20, 0, 0, 100, 300, 0.000001, 2, 0, 11)\nG0 X99\nM30', D10, 3000);
    expect(lim.moves.count).toBe(3000);
    expect(lim.warnings).toEqual(['3번 줄: 이동이 3000개를 넘어 나머지는 읽지 않음']);
  });
});

describe('SLOT2 원주 홈', () => {
  it('설명서 3.6절 예제: 원 위 홈 3개(0°·120°·240°에서 70°), 층마다 홈 둘레 고리, 공구 중심은 원 반지름 ± 2.5 안', () => {
    const p = run(SLOT2_EX.replace('T10', 'T1'));
    expect(p.warnings).toEqual([]);
    // 기준면 + 안전 거리 2에서 -23까지 6 이하 같은 절입 다섯(5씩) — 정삭은 MIDF 0이라 바닥 한 번(같은 깊이라 묶임)
    const L = [-3, -8, -13, -18, -23];
    expect(depths(p, 2)).toEqual([...L, ...L, ...L]);
    let far = 0;
    for (const i of cyc(p)) {
      if (p.moves.kind[i] === MOVE_RAPID) continue;
      const e = end(p, i);
      far = Math.max(far, Math.abs(Math.hypot(e[0]! - 60, e[1]! - 60) - 42));
      // 홈 각 안(끝 반원 쪽으로 반너비만큼 넘을 수 있음)
      const ang = ((Math.atan2(e[1]! - 60, e[0]! - 60) / DEG) % 360 + 360) % 360;
      const inSlot = [0, 120, 240].some((s) => ((ang - s + 360) % 360) <= 70 + 4 || ((ang - s + 360) % 360) >= 360 - 4);
      expect(inSlot, `이동 ${i} 각 ${ang}`).toBe(true);
    }
    expect(r3(far)).toBe(2.5);
    // 마무리: 후퇴 면 Z2
    expect(r3(end(p, p.moves.count - 1)[2]!)).toBe(2);
  });

  it('홈 사이를 원을 따라 옮김(VARI 10, _FFCP)·고리 홈(NUM 1, AFSL 369)·가장자리만 정삭(VARI 3)', () => {
    // 시작 자리가 첫 홈의 시작 끝(0°)에 가까워 홈마다 시작 끝에서 들어가고 끝난다
    const circ = run('G71 G17 G90 T1 D1\nG0 X30 Y-5 Z10\nSLOT2(2, 0, 2, -6, , 3, 40, 12, 0, 0, 30, 0, 120, 100, 300, 6, 3, 0, 11, 0, 0, 0, 500)\nM30');
    expect(circ.warnings).toEqual([]);
    // 후퇴 면 높이(Z2)에서 원을 따라 옮김 둘(시작 끝 0° → 120° → 240°), 이송 _FFCP
    const moves = Array.from({ length: circ.moves.count }, (_, i) => i).filter((i) => circ.moves.kind[i] === MOVE_ARC && r3(end(circ, i)[2]!) === 2);
    expect(moves.length).toBe(2);
    for (const i of moves) {
      expect(Math.round((circ.arcs.sweep[circ.moves.arc[i]!]! * 180) / Math.PI)).toBe(120);
      expect(circ.moves.feed[i]).toBe(500);
    }
    const ring = run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nSLOT2(2, 0, 2, -6, , 1, 369, 12, 0, 0, 30, 0, 0, 100, 300, 0, 3, 0, 1)\nM30');
    expect(ring.warnings).toEqual([]);
    // 고리: 반지름 30 ± (6 - 5)인 두 원(반원 넷)
    const radii = cyc(ring)
      .filter((i) => ring.moves.kind[i] === MOVE_ARC)
      .map((i) => r3(Math.hypot(end(ring, i)[0]!, end(ring, i)[1]!)));
    expect(radii).toEqual([31, 31, 29, 29]);
    const edge = run('G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\nSLOT2(2, 0, 2, -6, , 1, 40, 12, 0, 0, 30, 0, 0, 100, 300, 3, 3, 0.5, 3)\nM30');
    expect(edge.warnings).toEqual([]);
    // 가장자리만: MID 3 층(2 → -6, 8/3씩)마다 윤곽(반너비 6 - 5 = 1) 한 바퀴
    expect(depths(edge, 2)).toEqual([-0.667, -3.333, -6]);
  });

  it('잘못된 값: 원 반지름이 반너비보다 작음·홈끼리 겹침·CDIR 2·3 밖', () => {
    const w = (call: string): string[] => run(`G71 G17 G90 T1 D1\nG0 X0 Y0 Z10\n${call}\nM30`).warnings;
    expect(w('SLOT2(2, 0, 2, -6, , 1, 40, 12, 0, 0, 5, 0, 0, 100, 300, 3, 3, 0, 1)')).toEqual(['3번 줄: SLOT2: 홈 크기(AFSL·WID·RAD)가 맞지 않음 — 그리지 않음']);
    expect(w('SLOT2(2, 0, 2, -6, , 3, 130, 12, 0, 0, 30, 0, 0, 100, 300, 3, 3, 0, 1)')).toEqual(['3번 줄: SLOT2: 홈끼리 겹침(알람 61104) — 그리지 않음']);
    expect(w('SLOT2(2, 0, 2, -6, , 1, 40, 12, 0, 0, 30, 0, 0, 100, 300, 3, 0, 0, 1)')).toEqual(['3번 줄: SLOT2: 가공 방향(CDIR = 0)이 맞지 않아 하향으로 그림']);
  });
});

describe('새 경고 글 번역', () => {
  const hangul = /[가-힣]/;
  const codes = languages.filter((l: { code: string }) => l.code !== 'ko').map((l: { code: string }) => l.code);
  it('네 언어에서 한국어가 남지 않는다', () => {
    const texts = [
      'SLOT1: 깊이(DP·DPR)가 없음 — 그리지 않음',
      'SLOT1: 가공 종류(VARI = 21)가 맞지 않음 — 그리지 않음',
      'LONGHOLE: 개수(NUM)가 없음 — 그리지 않음',
      'SLOT2: 홈 크기(AFSL·WID·RAD)가 맞지 않음 — 그리지 않음',
      'SLOT1: 공구가 홈보다 큼(알람 61105) — 그리지 않음',
      'SLOT2: 홈끼리 겹침(알람 61104) — 그리지 않음',
      'SLOT2: 가공 방향(CDIR = 0)이 맞지 않아 하향으로 그림',
      'SLOT1: 정삭 회전수(SSF)는 반영하지 않음',
      'SLOT1: 왕복 진입 각(_STA2)이 없어 수직 이송으로 그림',
      'LONGHOLE: 공구 반지름을 몰라 반지름 0으로 그림',
    ];
    for (const t of texts) for (const code of codes) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
    expect(translate('SLOT1: 홈 크기(LENG·WID)가 맞지 않음 — 그리지 않음', 'en')).toBe('SLOT1: invalid slot size (LENG·WID) — not drawn');
  });
});
