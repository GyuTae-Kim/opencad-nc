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

  it('원호와 만나는 모서리·평면 밖 모서리·너무 큰 값은 모서리 그대로 두고 알린다', () => {
    const arc = parseHeidenhain(`0 BEGIN PGM T MM\n1 L X+0 Y+0 Z+0 F100\n2 L X+20\n3 RND R5\n4 CC X+20 Y+10\n5 C X+30 Y+10 DR+\n6 END PGM T MM\n`);
    expect(arc.warnings.some((w) => w.includes('RND: 원호와 만나는 모서리는 그대로 그림'))).toBe(true);
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

  it('RND 뒤가 원호면 모서리 그대로 알린다(그리는 길은 예전과 같음)', () => {
    const p = siemens(`G0 X0 Y0 Z0\nG1 X10 F200 RND=2\nG3 X20 Y10 CR=10\n`);
    expect(p.warnings.some((w) => w.includes('RND: 원호와 만나는 모서리는 그대로 그림'))).toBe(true);
    expect(ends(p)[1]).toEqual([10, 0, 0]);
  });
});
