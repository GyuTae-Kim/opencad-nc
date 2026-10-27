/**
 * 모서리 다듬기(Heidenhain RND·CHF·DIN/ISO G24·G25, Siemens RND·RNDM·CHF·CHR)와 Siemens CT(접선 원호, 모달).
 * 앞 직선 끝을 접점까지 줄이고 둥근 호·모따기 직선을 넣으며, 프로그램 위치(증분의 기준)는 모서리 그대로다.
 */
import { describe, expect, it } from 'vitest';
import { parseHeidenhain as parseH } from '../src/heidenhain';
import { MOVE_ARC, MOVE_FEED, moveEnd, type NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';

/** 시작 위치를 아는 Heidenhain(첫 이동도 보이게) */
const parseHeidenhain = (text: string): NcProgram => parseH(text, { initialPosition: [0, 0, 50] });

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const kinds = (p: NcProgram): number[] => Array.from(p.moves.kind.subarray(0, p.moves.count));
/** i번째 이동의 원호(중심 xyz, 중심각 도) */
const arcOf = (p: NcProgram, i: number): { c: number[]; deg: number } => {
  const a = p.moves.arc[i]!;
  return { c: Array.from(p.arcs.center.subarray(a * 3, a * 3 + 3)).map(r3), deg: r3((p.arcs.sweep[a]! * 180) / Math.PI) };
};
const feedLen = (p: NcProgram): number => r3(p.stats.feedLength);

describe('Heidenhain RND·CHF', () => {
  const PGM = `0 BEGIN PGM T MM
1 TOOL CALL 1 Z S1000
2 L X+0 Y+0 Z-1 R0 F100
3 L X+50
4 RND R10
5 L Y+40
6 CHF 5
7 L X+0
8 L IY-10
9 END PGM T MM
`;

  it('직선 사이 모서리: RND는 앞뒤 직선에 접하는 호(앞 직선 끝을 줄임), CHF는 모서리에서 앞뒤로 5씩 자르는 직선', () => {
    const p = parseHeidenhain(PGM);
    expect(p.warnings).toEqual([]);
    expect(ends(p)).toEqual([
      [0, 0, -1],
      [40, 0, -1],
      [50, 10, -1],
      [50, 35, -1],
      [45, 40, -1],
      [0, 40, -1],
      // L IY-10: 증분의 기준은 프로그램 모서리(0, 40) 그대로
      [0, 30, -1],
    ]);
    expect(kinds(p)).toEqual([MOVE_FEED, MOVE_FEED, MOVE_ARC, MOVE_FEED, MOVE_FEED, MOVE_FEED, MOVE_FEED]);
    expect(arcOf(p, 2)).toEqual({ c: [40, 10, -1], deg: 90 });
    // 둥근 호·모따기는 RND·CHF 블록의 줄(0부터 4·6)
    expect(p.moves.line[2]).toBe(4);
    expect(p.moves.line[4]).toBe(6);
    // 이송 길이: 51(시작 높이에서) + 40 + 호(5π) + 25 + 5√2 + 45 + 10
    expect(feedLen(p)).toBe(r3(51 + 40 + 5 * Math.PI + 25 + 5 * Math.SQRT2 + 45 + 10));
  });

  it('오른쪽으로 도는 모서리는 시계 방향 호, 둔각도 접점 거리 R·tan(θ/2)', () => {
    const p = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+20 Y+0\n3 RND R5\n4 L X+20 Y-20\n5 RND R4 F50\n6 L X+40 Y-40\n7 END PGM T MM\n`);
    expect(p.warnings).toEqual([]);
    // 첫 모서리: 아래로 꺾음(오른쪽) — 시계 방향 90도, 중심 (15, -5)
    expect(arcOf(p, 2)).toEqual({ c: [15, -5, 0], deg: -90 });
    expect(ends(p)[1]).toEqual([15, 0, 0]);
    expect(ends(p)[2]).toEqual([20, -5, 0]);
    // 둘째 모서리: 아래 → 오른쪽 아래 45도(왼쪽으로 돎) — 접점 거리 4·tan(22.5°)
    const d = 4 * Math.tan(Math.PI / 8);
    expect(ends(p)[3]).toEqual([20, r3(-20 + d), 0]);
    expect(arcOf(p, 4).deg).toBe(45);
    // RND의 F는 둥근 호에만
    expect(p.moves.feed[4]).toBe(50);
    expect(p.moves.feed[5]).toBe(100);
  });

  it('접하며 이어지는 원호·평면 밖 모서리·너무 큰 값은 모서리 그대로 두고, 앞 둘만 알린다', () => {
    // 직선 끝에서 원호가 접선으로 이어지면 다듬을 모서리가 없다(알리지 않음)
    const arc = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+20\n3 RND R5\n4 CC X+20 Y+10\n5 C X+30 Y+10 DR+\n6 END PGM T MM\n`);
    expect(arc.warnings).toEqual([]);
    expect(ends(arc)[1]).toEqual([20, 0, 0]);
    const z = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+20\n3 RND R5\n4 L Z-5\n5 END PGM T MM\n`);
    expect(z.warnings.some((w) => w.includes('작업 평면 밖'))).toBe(true);
    const big = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+5\n3 CHF 8\n4 L Y+20\n5 END PGM T MM\n`);
    expect(big.warnings.some((w) => w.includes('CHF: 값이 앞뒤 요소보다 커서'))).toBe(true);
    expect(ends(big)).toEqual([
      [0, 0, 0],
      [5, 0, 0],
      [5, 20, 0],
    ]);
  });

  it('좌표 변환(사이클 7 원점 이동·10 회전·11 배율) 안에서도 다듬고, 배율은 반지름에도', () => {
    const p = parseHeidenhain(`0 BEGIN PGM T MM
1 CYCL DEF 7.0 DATUM SHIFT
2 CYCL DEF 7.1 X+100
3 CYCL DEF 11.0 SCALING
4 CYCL DEF 11.1 SCL2
5 L X+0 Y+0 Z+0 F100
6 L X+10
7 RND R2
8 L Y+10
9 END PGM T MM
`);
    expect(p.warnings).toEqual([]);
    // 배율 2: 모서리 (120, 0), 반지름 4
    expect(ends(p)).toEqual([
      [100, 0, 0],
      [116, 0, 0],
      [120, 4, 0],
      [120, 20, 0],
    ]);
    expect(arcOf(p, 2)).toEqual({ c: [116, 4, 0], deg: 90 });
  });

  it('DIN/ISO G25 R(둥글리기)·G24 R(모따기)도 같은 길', () => {
    const p = parseHeidenhain(`%T G71 *
N10 G01 X+0 Y+0 Z+0 F100 *
N20 X+30 *
N30 G25 R5 *
N40 Y+30 *
N50 G24 R3 *
N60 X+0 *
N99999 %T G71 *
`);
    expect(p.warnings).toEqual([]);
    expect(ends(p)).toEqual([
      [0, 0, 0],
      [25, 0, 0],
      [30, 5, 0],
      [30, 27, 0],
      [27, 30, 0],
      [0, 30, 0],
    ]);
  });
});

describe('Siemens RND·CHF·CHR·RNDM과 CT', () => {
  const siemens = (body: string): NcProgram => parseSiemens(makeSource(`%_N_T_MPF\nG54 G17 G90 G71\nT="CUT" D1 M6\nS1000 M3\n${body}M30\n`), { initialPosition: [0, 0, 50] });

  it('RND=는 그 블록 끝 모서리를 다음 직선과 둥글게, CHF=는 모따기 선 길이, CHR=는 모서리에서 자르는 길이', () => {
    const p = siemens(`G0 X0 Y0 Z0\nG1 X40 F200 RND=10\nY40 CHF=${5 * Math.SQRT2}\nX0 CHR=4\nY0\n`);
    expect(p.dialect).toBe('siemens');
    expect(p.warnings.filter((w) => /RND|CHF|CHR|모서리/.test(w))).toEqual([]);
    expect(ends(p).slice(1)).toEqual([
      [30, 0, 0],
      [40, 10, 0],
      [40, 35, 0],
      [35, 40, 0],
      [4, 40, 0],
      [0, 36, 0],
      [0, 0, 0],
    ]);
    expect(arcOf(p, 2)).toEqual({ c: [30, 10, 0], deg: 90 });
  });

  it('RNDM=은 끌 때까지(RNDM=0) 모든 직선 모서리를 둥글게, 급속 모서리는 건드리지 않는다', () => {
    const p = siemens(`G0 X0 Y0 Z0\nG1 X20 F200 RNDM=2\nY20\nX0 RNDM=0\nY0\nX20\n`);
    expect(p.warnings.filter((w) => /RND|모서리/.test(w))).toEqual([]);
    const k = kinds(p);
    expect(k.filter((v) => v === MOVE_ARC)).toHaveLength(2);
    // 끈 뒤의 (0, 20) → (0, 0) → (20, 0) 모서리는 그대로
    expect(ends(p).slice(-2)).toEqual([
      [0, 0, 0],
      [20, 0, 0],
    ]);
  });

  it('CT: 앞 직선에 접하는 원호로 끝점까지, 모달이라 다음 블록도 앞 원호에 접하는 원호, G1이 끈다', () => {
    const p = siemens(`G0 X0 Y0 Z0\nG1 X10 F200\nCT X20 Y10\nX30 Y20\nG1 X40\n`);
    expect(p.warnings.filter((w) => w.includes('CT'))).toEqual([]);
    const k = kinds(p);
    expect(k.slice(1)).toEqual([MOVE_FEED, MOVE_ARC, MOVE_ARC, MOVE_FEED]);
    // (10,0)에서 +X에 접해 (20,10): 중심 (10,10), 반시계 90도
    expect(arcOf(p, 2)).toEqual({ c: [10, 10, 0], deg: 90 });
    // 다음 CT: (20,10)에서 +Y에 접해 (30,20) — 오른쪽으로 도는 호, 중심 (30,10)
    expect(arcOf(p, 3)).toEqual({ c: [30, 10, 0], deg: -90 });
    expect(ends(p).slice(-1)).toEqual([[40, 20, 0]]);
  });

  it('CT 끝점이 접선 위면 직선, 앞 요소가 없으면 직선으로 그리고 알린다', () => {
    const p = siemens(`G0 X0 Y0 Z0\nG1 X10 F200\nCT X30\n`);
    expect(kinds(p).slice(-1)).toEqual([MOVE_FEED]);
    const q = parseSiemens(makeSource(`%_N_T_MPF\nG17 G90 G71\nCT X10 Y10 F100\nM30\n`), { initialPosition: [0, 0, 0] });
    expect(q.warnings.some((w) => w.includes('CT 앞에 방향을 정할 요소가 없음'))).toBe(true);
  });

  it('RND 뒤 원호가 접선으로 이어지면 모서리 그대로(알리지 않음)', () => {
    const p = siemens(`G0 X0 Y0 Z0\nG1 X10 F200 RND=2\nG3 X20 Y10 CR=10\n`);
    expect(p.warnings.filter((w) => /RND|모서리/.test(w))).toEqual([]);
    expect(ends(p)[1]).toEqual([10, 0, 0]);
  });
});

/** i번째 이동의 길이(직선 또는 평면 원호) */
const moveLen = (p: NcProgram, i: number): number => {
  const s = i === 0 ? Array.from(p.moves.points.subarray(0, 3)) : moveEnd(p.moves, i - 1);
  const e = moveEnd(p.moves, i);
  const a = p.moves.arc[i]!;
  if (p.moves.kind[i] !== MOVE_ARC || a < 0) return Math.hypot(e[0]! - s[0]!, e[1]! - s[1]!, e[2]! - s[2]!);
  const r = Math.hypot(s[0]! - p.arcs.center[a * 3]!, s[1]! - p.arcs.center[a * 3 + 1]!);
  return r * Math.abs(p.arcs.sweep[a]!);
};
const totalFeed = (p: NcProgram): number => {
  let t = 0;
  for (let i = 0; i < p.moves.count; i++) if (p.moves.kind[i] !== 0) t += moveLen(p, i);
  return r3(t);
};
/** 원호 이동 i의 시작·끝이 중심에서 같은 거리인지 */
const arcConsistent = (p: NcProgram, i: number): boolean => {
  const s = moveEnd(p.moves, i - 1);
  const e = moveEnd(p.moves, i);
  const a = p.moves.arc[i]!;
  const c = [p.arcs.center[a * 3]!, p.arcs.center[a * 3 + 1]!];
  return Math.abs(Math.hypot(s[0]! - c[0]!, s[1]! - c[1]!) - Math.hypot(e[0]! - c[0]!, e[1]! - c[1]!)) < 1e-9;
};

describe('원호와 만나는 모서리 다듬기', () => {
  it('Heidenhain RND: 직선 → 원호 모서리에 두 요소에 접하는 호(원호 중심은 그대로, 시작을 접점으로)', () => {
    // 직선 (0,0)→(20,0), 원호 중심 (30,0) 반지름 10 반시계로 (40,0)까지(아래로 감) — 오른쪽으로 90도 꺾임
    const p = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+20\n3 RND R2\n4 CC X+30 Y+0\n5 C X+40 Y+0 DR+\n6 END PGM T MM\n`);
    expect(p.warnings).toEqual([]);
    expect(kinds(p)).toEqual([MOVE_FEED, MOVE_FEED, MOVE_ARC, MOVE_ARC]);
    // 둥글리기 중심 F: 직선에서 2, 원 바깥으로 2(중심에서 12) → F = (30 - √140, -2)
    const fx = 30 - Math.sqrt(140);
    expect(ends(p)[1]).toEqual([r3(fx), 0, 0]);
    const t2 = [30 + (10 * (fx - 30)) / 12, (10 * -2) / 12];
    expect(ends(p)[2]).toEqual([r3(t2[0]!), r3(t2[1]!), 0]);
    expect(arcOf(p, 2).c).toEqual([r3(fx), -2, 0]);
    const filletDeg = ((Math.atan2(t2[1]! + 2, t2[0]! - fx) - Math.PI / 2) * 180) / Math.PI;
    expect(arcOf(p, 2).deg).toBe(r3(filletDeg));
    // 뒤 원호: 중심 그대로, 남은 각 = 180도 - 접점까지 돈 각
    const used = Math.atan2(-t2[1]!, -(t2[0]! - 30));
    expect(arcOf(p, 3)).toEqual({ c: [30, 0, 0], deg: r3(180 - (used * 180) / Math.PI) });
    expect(ends(p)[3]).toEqual([40, 0, 0]);
    expect(p.moves.line[2]).toBe(3);
    for (const i of [2, 3]) expect(arcConsistent(p, i)).toBe(true);
    // 이송 길이·시간은 줄어든 요소와 넣은 호 그대로
    expect(feedLen(p)).toBe(totalFeed(p));
  });

  it('Siemens RND=: 원호 → 직선 모서리(앞 원호 끝을 접점까지 줄임)', () => {
    // (10,0)에서 반시계 원호(중심 (10,10))로 (20,10) — 위로 가다 +X 직선: 오른쪽으로 90도
    const siemens = (body: string): NcProgram => parseSiemens(makeSource(`%_N_T_MPF\nG54 G17 G90 G71\nT="CUT" D1 M6\nS1000 M3\n${body}M30\n`), { initialPosition: [0, 0, 50] });
    const p = siemens(`G0 X0 Y0 Z0\nG1 X10 F200\nG3 X20 Y10 CR=10 RND=2\nG1 X30\n`);
    expect(p.warnings.filter((w) => /RND|모서리/.test(w))).toEqual([]);
    const k = kinds(p);
    expect(k.slice(-4)).toEqual([MOVE_FEED, MOVE_ARC, MOVE_ARC, MOVE_FEED]);
    const n = p.moves.count;
    // F = (10 + √140, 8): 직선 아래 2, 원 바깥 2
    const fx = 10 + Math.sqrt(140);
    const t1 = [10 + (10 * (fx - 10)) / 12, 10 + (10 * -2) / 12];
    expect(ends(p)[n - 3]).toEqual([r3(t1[0]!), r3(t1[1]!), 0]);
    expect(arcOf(p, n - 3)).toEqual({ c: [10, 10, 0], deg: r3(((Math.atan2(t1[1]! - 10, t1[0]! - 10) + Math.PI / 2) * 180) / Math.PI) });
    expect(arcOf(p, n - 2).c).toEqual([r3(fx), 8, 0]);
    expect(arcOf(p, n - 2).deg).toBeLessThan(0);
    expect(ends(p)[n - 2]).toEqual([r3(fx), 10, 0]);
    expect(ends(p)[n - 1]).toEqual([30, 10, 0]);
    for (const i of [n - 3, n - 2]) expect(arcConsistent(p, i)).toBe(true);
    expect(feedLen(p)).toBe(totalFeed(p));
  });

  it('Heidenhain RND: 원호 → 원호 모서리(두 원을 반지름만큼 옮긴 원의 교점이 중심)', () => {
    // 원호 A: 중심 (0,0), (10,0)→(0,10) 반시계. 원호 B: 중심 (-10,10), (0,10)→(-10,20) 반시계 — 오른쪽으로 90도
    const p = parseHeidenhain(`0 BEGIN PGM T MM
1 L X+10 Y+0 Z+0 R0 F100
2 CC X+0 Y+0
3 C X+0 Y+10 DR+
4 RND R2
5 CC X-10 Y+10
6 C X-10 Y+20 DR+
7 END PGM T MM
`);
    expect(p.warnings).toEqual([]);
    expect(kinds(p)).toEqual([MOVE_FEED, MOVE_ARC, MOVE_ARC, MOVE_ARC]);
    // 두 원(반지름 12)의 교점 가운데 모서리 (0,10)에 가까운 것
    const h = Math.sqrt(144 - 50) / Math.SQRT2;
    const F = [-5 + h, 5 + h];
    expect(arcOf(p, 2).c).toEqual([r3(F[0]!), r3(F[1]!), 0]);
    expect(ends(p)[1]).toEqual([r3((F[0]! * 10) / 12), r3((F[1]! * 10) / 12), 0]);
    expect(ends(p)[2]).toEqual([r3(-10 + ((F[0]! + 10) * 10) / 12), r3(10 + ((F[1]! - 10) * 10) / 12), 0]);
    expect(arcOf(p, 1).c).toEqual([0, 0, 0]);
    expect(arcOf(p, 3).c).toEqual([-10, 10, 0]);
    expect(ends(p)[3]).toEqual([-10, 20, 0]);
    for (const i of [1, 2, 3]) expect(arcConsistent(p, i)).toBe(true);
    // 다듬은 호는 오른쪽(시계)으로, 각 합 = A + 호 + B의 방향 변화가 모서리 없이 이어짐
    expect(arcOf(p, 2).deg).toBeLessThan(0);
    expect(feedLen(p)).toBe(totalFeed(p));
  });

  it('Siemens CHR=·CHF=: 원호 위는 모서리에서 현 길이로 같은 거리, CHF는 모따기 선 길이가 값', () => {
    const siemens = (body: string): NcProgram => parseSiemens(makeSource(`%_N_T_MPF\nG54 G17 G90 G71\nT="CUT" D1 M6\nS1000 M3\n${body}M30\n`), { initialPosition: [0, 0, 50] });
    const chr = siemens(`G0 X0 Y0 Z0\nG1 X20 F200 CHR=2\nG3 X40 Y0 CR=10\n`);
    expect(chr.warnings.filter((w) => /CHR|모서리/.test(w))).toEqual([]);
    const n = chr.moves.count;
    expect(kinds(chr).slice(-3)).toEqual([MOVE_FEED, MOVE_FEED, MOVE_ARC]);
    expect(ends(chr)[n - 3]).toEqual([18, 0, 0]);
    const a = 2 * Math.asin(0.1);
    expect(ends(chr)[n - 2]).toEqual([r3(30 - 10 * Math.cos(a)), r3(-10 * Math.sin(a)), 0]);
    expect(arcOf(chr, n - 1).deg).toBe(r3(180 - (a * 180) / Math.PI));
    expect(arcConsistent(chr, n - 1)).toBe(true);
    const L = 3;
    const chf = siemens(`G0 X0 Y0 Z0\nG1 X20 F200 CHF=${L}\nG3 X40 Y0 CR=10\n`);
    const m = chf.moves.count;
    const s = moveEnd(chf.moves, m - 3);
    const e = moveEnd(chf.moves, m - 2);
    expect(r3(Math.hypot(e[0]! - s[0]!, e[1]! - s[1]!))).toBe(L);
    // 두 다리(모서리 (20,0)에서 두 점까지)가 같다
    expect(r3(Math.hypot(s[0]! - 20, s[1]!))).toBe(r3(Math.hypot(e[0]! - 20, e[1]!)));
    expect(feedLen(chf)).toBe(totalFeed(chf));
  });

  it('Siemens RNDM=은 원호 블록 끝 모서리에도', () => {
    const siemens = (body: string): NcProgram => parseSiemens(makeSource(`%_N_T_MPF\nG54 G17 G90 G71\nT="CUT" D1 M6\nS1000 M3\n${body}M30\n`), { initialPosition: [0, 0, 50] });
    const p = siemens(`G0 X0 Y0 Z0\nG1 X10 F200 RNDM=1\nG3 X20 Y10 CR=10\nG1 X30\nRNDM=0\n`);
    expect(p.warnings.filter((w) => /RND|모서리/.test(w))).toEqual([]);
    // 직선 → 원호는 접선이라 그대로, 원호 → 직선은 둥글게
    expect(kinds(p).slice(-4)).toEqual([MOVE_FEED, MOVE_ARC, MOVE_ARC, MOVE_FEED]);
    expect(ends(p)[p.moves.count - 1]).toEqual([30, 10, 0]);
  });

  it('Heidenhain CHF는 두 직선 사이에만: 원호와 만나면 모서리 그대로 알림', () => {
    const p = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+20\n3 CHF 2\n4 CC X+30 Y+0\n5 C X+40 Y+0 DR+\n6 END PGM T MM\n`);
    expect(p.warnings.some((w) => w.includes('CHF: 두 직선 사이에만 쓰는 모따기라 원호와 만나는 모서리는 그대로 그림'))).toBe(true);
    expect(ends(p)[1]).toEqual([20, 0, 0]);
    const q = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+10 Y+0 Z+0 F100\n2 CC X+0 Y+0\n3 C X+0 Y+10 DR+\n4 CHF 2\n5 L X-10\n6 END PGM T MM\n`);
    expect(q.warnings.some((w) => w.includes('CHF: 두 직선 사이에만 쓰는 모따기라'))).toBe(true);
    // DIN/ISO G24도 같은 길
    const iso = parseHeidenhain(`%T G71 *\nN10 G01 X+0 Y+0 Z+0 F100 *\nN20 X+20 *\nN30 G24 R2 *\nN40 I+30 J+0 G02 X+40 Y+0 *\nN99999 %T G71 *\n`);
    expect(iso.warnings.some((w) => w.includes('두 직선 사이에만 쓰는 모따기라'))).toBe(true);
  });

  it('값이 원호보다 크거나 나선(작업 평면 밖)이면 모서리 그대로 알림, 좌표 변환 안에서도 다듬음', () => {
    const big = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+20\n3 RND R50\n4 CC X+30 Y+0\n5 C X+40 Y+0 DR+\n6 END PGM T MM\n`);
    expect(big.warnings.some((w) => w.includes('RND: 값이 앞뒤 요소보다 커서'))).toBe(true);
    expect(ends(big)[1]).toEqual([20, 0, 0]);
    const helix = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+20\n3 RND R2\n4 CC X+30 Y+0\n5 C X+40 Y+0 Z-5 DR+\n6 END PGM T MM\n`);
    expect(helix.warnings.some((w) => w.includes('RND: 작업 평면 밖'))).toBe(true);
    // 사이클 10(회전 90도): 같은 모양을 돌린 것
    const rot = parseHeidenhain(`0 BEGIN PGM T MM\n1 CYCL DEF 10.0 ROTATION\n2 CYCL DEF 10.1 ROT+90\n3 L X+0 Y+0 Z+0 F100\n4 L X+20\n5 RND R2\n6 CC X+30 Y+0\n7 C X+40 Y+0 DR+\n8 END PGM T MM\n`);
    expect(rot.warnings).toEqual([]);
    const fx = 30 - Math.sqrt(140);
    expect(ends(rot)[1]).toEqual([0, r3(fx), 0]);
    expect(arcOf(rot, 2).c).toEqual([2, r3(fx), 0]);
    expect(arcOf(rot, 3).c).toEqual([0, 30, 0]);
    expect(ends(rot)[3]).toEqual([0, 40, 0]);
  });
});

describe('원호 모서리 다듬기 — 무작위 윤곽(고정 씨앗)', () => {
  /** 이동 i의 시작·끝 방향(단위, XY) */
  const dirs = (p: NcProgram, i: number): [number[], number[]] => {
    const s = i === 0 ? Array.from(p.moves.points.subarray(0, 3)) : moveEnd(p.moves, i - 1);
    const e = moveEnd(p.moves, i);
    const a = p.moves.arc[i]!;
    if (p.moves.kind[i] !== MOVE_ARC || a < 0) {
      const l = Math.hypot(e[0]! - s[0]!, e[1]! - s[1]!);
      const u = [(e[0]! - s[0]!) / l, (e[1]! - s[1]!) / l];
      return [u, u];
    }
    const cx = p.arcs.center[a * 3]!;
    const cy = p.arcs.center[a * 3 + 1]!;
    const sg = p.arcs.sweep[a]! > 0 ? 1 : -1;
    const t = (q: number[]): number[] => {
      const l = Math.hypot(q[0]! - cx, q[1]! - cy);
      return [(-(q[1]! - cy) / l) * sg, ((q[0]! - cx) / l) * sg];
    };
    return [t(s), t(e)];
  };

  it('다듬은 곳은 앞뒤 요소와 접선이 이어지고, 원호는 중심에서 같은 거리, 이송 길이는 이동 합과 같다', () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let rounded = 0;
    for (let n = 0; n < 60; n++) {
      const body: string[] = ['G0 X0 Y0 Z0', 'G1 X10 F200'];
      for (let k = 0; k < 6; k++) {
        const x = (rnd() * 80 - 40).toFixed(3);
        const y = (rnd() * 80 - 40).toFixed(3);
        const g = rnd();
        const corner = rnd() < 0.5 ? ` RND=${(0.5 + rnd() * 3).toFixed(2)}` : rnd() < 0.5 ? ` CHR=${(0.5 + rnd() * 2).toFixed(2)}` : ` CHF=${(0.5 + rnd() * 2).toFixed(2)}`;
        if (g < 0.4) body.push(`G1 X${x} Y${y}${corner}`);
        else body.push(`G${g < 0.7 ? 2 : 3} X${x} Y${y} CR=${(40 + rnd() * 40).toFixed(2)}${corner}`);
      }
      const p = parseSiemens(makeSource(`%_N_T_MPF\nG17 G90 G71\nT="C" D1 M6\nS1000 M3\n${body.join('\n')}\nM30\n`), { initialPosition: [0, 0, 50] });
      for (let i = 0; i < p.moves.count; i++) {
        for (const v of moveEnd(p.moves, i)) expect(Number.isFinite(v)).toBe(true);
        if (p.moves.kind[i] === MOVE_ARC) expect(arcConsistent(p, i)).toBe(true);
      }
      // 둥글리기 호(이동 줄이 앞 이동과 같고 원호인 것)는 앞뒤와 접선
      for (let i = 2; i + 1 < p.moves.count; i++) {
        if (p.moves.kind[i] !== MOVE_ARC || p.moves.line[i] !== p.moves.line[i - 1]) continue;
        const prevEnd = dirs(p, i - 1)[1];
        const [fs, fe] = dirs(p, i);
        const nextStart = dirs(p, i + 1)[0];
        expect(Math.abs(prevEnd[0]! * fs[1]! - prevEnd[1]! * fs[0]!)).toBeLessThan(1e-6);
        expect(prevEnd[0]! * fs[0]! + prevEnd[1]! * fs[1]!).toBeGreaterThan(0);
        expect(Math.abs(fe[0]! * nextStart[1]! - fe[1]! * nextStart[0]!)).toBeLessThan(1e-6);
        expect(fe[0]! * nextStart[0]! + fe[1]! * nextStart[1]!).toBeGreaterThan(0);
        rounded++;
      }
      expect(feedLen(p)).toBe(totalFeed(p));
    }
    expect(rounded).toBeGreaterThan(30);
  });
});
