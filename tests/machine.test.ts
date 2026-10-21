import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import { FLAG_MACHINE_EST, moveEnd, type NcProgram } from '../src/model';
import { ncToScene } from '../src/scene';

const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map((v) => Math.round(v * 1000) / 1000));
  return out;
};
const est = (p: NcProgram): boolean[] => Array.from(p.moves.flags, (f) => !!(f & FLAG_MACHINE_EST));

/** Fusion Haas 포스트처럼 공구 교환마다 G53 G0 Z0 */
const HAAS = `%
O3000 (G53 G28 TEST)
G21 G90 G17
G53 G0 Z0.
T1 M6
G0 G54 X50 Y50
G43 H1 Z25
G1 Z-5 F200
X100
G0 Z25
G53 G0 Z0
G91 G28 Z0
G28 X0 Y0
G90
T2 M6
G0 G54 X10 Y10
G43 H2 Z25
G1 Z-3 F200
X20
G0 Z25
G53 G0 Z0.
M30
%`;

describe('기계 좌표 쪽 이동(G53·G28·M91)', () => {
  it('작업 원점의 기계 위치를 모르면 공구 축을 안전 높이(경로 맨 위 + 25mm)로 그리고 범위에서 뺀다', () => {
    const p = parseGcode(HAAS);
    // 첫 진입은 안전 높이에서 내려온다(첫 G53 Z0이 시작점을 안전 높이로)
    expect(ends(p)).toEqual([
      [50, 50, 25],
      [50, 50, -5],
      [100, 50, -5],
      [100, 50, 25],
      [100, 50, 50],
      [10, 10, 50],
      [10, 10, 25],
      [10, 10, -3],
      [20, 10, -3],
      [20, 10, 25],
      [20, 10, 50],
    ]);
    expect(Array.from(p.moves.points.slice(0, 3))).toEqual([50, 50, 50]);
    expect(est(p)).toEqual([true, false, false, false, true, true, true, false, false, false, true]);
    // 작업 Z0(공작물 윗면)까지 내려가는 급속은 없다
    for (let i = 0; i < p.moves.count; i++) if (p.moves.kind[i] === 0) expect(moveEnd(p.moves, i)[2]).toBeGreaterThan(0);
    expect(p.bounds!.max[2]).toBe(25);
    expect(p.bounds!.min).toEqual([10, 10, -5]);
    expect(p.warnings.some((w) => w.includes('G53 기계 좌표 쪽 이동'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('G28 X·Y 기계 위치를 몰라'))).toBe(true);
    // 시간·길이는 고친 점으로 다시 셈(급속 시간 = 급속 길이 / 10000 mm/분)
    expect(p.stats.rapidTime).toBeCloseTo((p.stats.rapidLength / 10000) * 60, 6);
    let sum = 0;
    for (let i = 0; i < p.moves.count; i++) sum += p.moves.time[i]!;
    expect(sum).toBeCloseTo(p.stats.time, 3);
  });

  it('장면: 추정 이동은 따로 점선 묶음, 장면 범위에 넣지 않음', () => {
    const p = parseGcode(HAAS);
    const s = ncToScene(p);
    const m = s.lines.find((l) => l.id === 'nc-machine')!;
    expect(m.dashed).toBe(true);
    expect(Array.from(m.segmentIds!)).toEqual([0, 4, 5, 6, 10]);
    expect(s.lines.find((l) => l.id === 'nc-rapid')!.segmentIds!.includes(4)).toBe(false);
    expect(s.bounds!.max[2]).toBe(25);
  });

  it('G53 X·Y는 제자리, 기계 위치(machineOffset)를 주면 실제 위치', () => {
    const p = parseGcode(`G90 G54 G0 X10 Y10 Z5\nG1 Z-1 F100\nG53 G0 Z0 Y0`, { initialPosition: [0, 0, 0] });
    expect(ends(p).slice(-1)).toEqual([[10, 10, 30]]);
    expect(p.warnings.some((w) => w.includes('G53 X·Y'))).toBe(true);
    const q = parseGcode(`G21 G90 G54 G0 X10 Y10 Z5\nG53 G0 Z0\nG28 G91 Y0`, { initialPosition: [0, 0, 0], machineOffset: [-300, -200, -400] });
    expect(ends(q)).toEqual([
      [10, 10, 5],
      [10, 10, 400],
      [10, 200, 400],
    ]);
    expect(est(q)).toEqual([false, false, false]);
    expect(q.warnings).toEqual([]);
  });

  it('선반 G28 U0 W0은 X·Z를 안전 위치로(+X·+Z)', () => {
    const p = parseGcode(`G18 G21\nT0101\nG0 X50 Z2\nG1 X40 Z-20 F0.2\nG28 U0 W0\nM30`, { lathe: true });
    const e = ends(p);
    expect(e[e.length - 1]).toEqual([25 + 25, 0, 2 + 25]);
  });

  it('Heidenhain M91: 시작이 공작물 속에서 시작하지 않고, 기계 위치를 주면 실제 값', () => {
    const text = `0 BEGIN PGM T MM
1 TOOL CALL 5 Z S3000
2 L Z-5 R0 FMAX M91
3 L X+20 Y+20 R0 FMAX
4 L Z+2 R0 FMAX
5 L Z-3 F200
6 L X+80
7 L Z-10 R0 FMAX M91
8 END PGM T MM`;
    const p = parseHeidenhain(text);
    expect(Array.from(p.moves.points.slice(0, 3))).toEqual([20, 20, 27]);
    expect(p.bounds!.min[2]).toBe(-3);
    expect(ends(p).slice(-1)).toEqual([[80, 20, 27]]);
    expect(p.warnings.some((w) => w.includes('M91 기계 좌표 쪽 이동'))).toBe(true);
    const q = parseHeidenhain(text, { machineOffset: [0, 0, -500] });
    expect(ends(q).slice(-1)).toEqual([[80, 20, 490]]);
  });

  it('G53 없는 프로그램은 그대로(추정 표시 없음)', () => {
    const p = parseGcode(`G0 X0 Y0 Z5\nG1 Z-1 F100\nX10\nG0 Z5`, { initialPosition: [0, 0, 10] });
    expect(est(p).some(Boolean)).toBe(false);
    expect(ncToScene(p).lines.some((l) => l.id === 'nc-machine')).toBe(false);
  });
});
