import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { parseForView } from '../src/app/payload';
import { cutRangeText } from '../src/app/doc';

const PROG = `G21 G17 G90 G54
T1 M6
S1000 M3
G0 X0 Y0 Z10
G43 H1 Z5
G1 Z-2 F100
X50
G2 X50 Y20 I0 J10
G0 Z30
T2 M6
G0 X10 Y10
G43 H2 Z5
G81 Z-12 R2 F80
X20
G80
G53 G0 Z0
M30`;

describe('공구별·전체 절삭 범위', () => {
  it('공구마다 절삭(이송·호·드릴) 범위와 가장 깊은 줄 — 급속·안전 높이는 빼고, 호는 사분점까지', () => {
    const p = parseGcode(PROG, { initialPosition: [0, 0, 50] });
    const t1 = p.tools.find((t) => t.number === 1)!;
    const t2 = p.tools.find((t) => t.number === 2)!;
    expect(t1.cutMin).toEqual([0, 0, -2]);
    // G2 (50,0)→(50,20) 중심 (50,10) 시계: 왼쪽 사분점(x 40)을 지나 X 최대는 50
    expect(t1.cutMax).toEqual([50, 20, 5]);
    expect(t1.minZLine).toBe(5);
    expect(t2.cutMin).toEqual([10, 10, -12]);
    expect(t2.cutMax![2]).toBe(2);
    expect(t2.minZLine).toBe(12);
    expect(p.feedBounds).toEqual({ min: [0, 0, -12], max: [50, 20, 5] });
  });

  it('화면 자료(cutBounds)와 범위 글', () => {
    const r = parseForView('a.nc', new TextEncoder().encode(PROG));
    expect(r.nc!.cutBounds!.min[2]).toBe(-12);
    expect(cutRangeText([0, 0, -2], [60, 20, 5], 'mm')).toBe('X 0 ~ 60 · Y 0 ~ 20 · Z -2 ~ 5 mm');
  });
});
