import { describe, expect, it } from 'vitest';
import { detectNcFormat, parseNcFile } from '../src/index';
import { parseHeidenhain } from '../src/heidenhain';
import { MOVE_ARC, MOVE_DRILL, moveEnd, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};

const ISO = `%TEST G71 *
N10 G30 G17 X+0 Y+0 Z-40 *
N20 G31 G90 X+100 Y+100 Z+0 *
N30 G99 T1 L+0 R+5 *
N40 T1 G17 S3000 *
N50 G00 G40 G90 Z+50 *
N60 X+10 Y+10 *
N70 G01 Z-5 F200 *
N80 X+50 *
N90 I+50 J+30 *
N100 G02 X+50 Y+50 *
N110 G03 X+30 Y+50 R+10 *
N120 G91 G01 X-10 *
N130 G90 G00 Z+50 *
N140 G200 BOHREN
    Q200=2 ;SICHERHEITS-ABST.
    Q201=-15 ;TIEFE
    Q206=150 ;VORSCHUB
    Q202=5 ;ZUSTELL-TIEFE
    Q203=+0 ;KOOR. OBERFL.
    Q204=50 ;2. S.-ABSTAND *
N150 X+20 Y+80 M99 *
N160 G79 *
N170 D00 Q5 P01 +2 *
N180 D01 Q6 P01 +Q5 P02 +3 *
N190 G98 L1 *
N200 G91 G01 X+Q6 *
N210 G90 *
N220 G98 L0 *
N230 L1,2 *
N240 G04 F1.5 *
N250 M30 *
N99999999 %TEST G71 *`;

describe('Heidenhain DIN/ISO', () => {
  it('판별: "%이름 G71 *" 머리는 Heidenhain(ISO), 띠로 알림', () => {
    expect(detectNcFormat('a.nc', ISO)).toBe('heidenhain');
    expect(detectNcFormat('a.i', 'N10 G00 X+1 *')).toBe('heidenhain');
    const p = parseNcFile('test.i', ISO);
    expect(p.kind).toBe('heidenhain');
    if (p.kind !== 'mpr') expect(p.program.notices).toEqual([{ kind: 'dialect', dialect: 'heidenhain-iso' }]);
  });

  it('공작물·공구·직선·원 중심 I·J(절대)·G02/G03·R·G91·드릴 사이클·LBL·D 함수·휴지', () => {
    const p = parseHeidenhain(ISO);
    expect(p.name).toBe('TEST');
    expect(p.units).toBe('mm');
    expect(p.stock).toEqual({ min: [0, 0, -40], max: [100, 100, 0] });
    expect(p.tools.map((t) => [t.number, t.diameter])).toEqual([[1, 10]]);
    const e = ends(p);
    expect(e.slice(0, 5)).toEqual([
      [10, 10, -5],
      [50, 10, -5],
      [50, 50, -5],
      [30, 50, -5],
      [20, 50, -5],
    ]);
    // G02 = 시계(중심 50,30), G03 R+10 = 반시계
    expect(Array.from(p.arcs.center.slice(0, 2))).toEqual([50, 30]);
    expect(p.arcs.sweep[0]! < 0 && p.arcs.sweep[1]! > 0).toBe(true);
    expect(Array.from(p.moves.kind).filter((k) => k === MOVE_ARC).length).toBe(2);
    // 드릴: M99와 G79로 두 번(같은 자리)
    expect(p.holes.count).toBe(2);
    expect(Array.from(p.holes.top.slice(0, 3))).toEqual([20, 80, 2]);
    expect(Array.from(p.moves.kind).filter((k) => k === MOVE_DRILL).length).toBeGreaterThan(2);
    // D00·D01 → Q6 = 5, LBL 1 구간을 L1,2로 두 번 더 → X가 5씩 세 번
    expect(e.slice(-3).map((x) => x[0])).toEqual([25, 30, 35]);
    expect(p.stats.dwellTime).toBeCloseTo(1.5);
    expect(p.warnings).toEqual([]);
  });

  it('G54 원점 이동·G73 회전·G28 대칭·G83 옛 쪼기 사이클', () => {
    const p = parseHeidenhain(`%T2 G71 *
N10 T1 G17 S1000 *
N20 G00 X+0 Y+0 Z+10 *
N30 G54 X+50 *
N40 G73 G90 H+90 *
N50 G01 X+10 Y+0 F100 *
N60 G73 G90 H+0 *
N70 G28 X *
N80 G01 X+10 Y+5 *
N90 G28 *
N100 G83 P01 +2 P02 -10 P03 +5 P04 0 P05 100 *
N110 G79 *
N120 M30 *
N99999999 %T2 G71 *`);
    const e = ends(p);
    expect(e[0]).toEqual([50, 10, 10]);
    expect(e[1]).toEqual([40, 5, 10]);
    expect(p.holes.count).toBe(1);
    expect(p.warnings).toEqual([]);
  });
});
