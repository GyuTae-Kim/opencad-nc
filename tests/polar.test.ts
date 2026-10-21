import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { moveEnd, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const holes = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let h = 0; h < p.holes.count; h++) out.push([0, 1].map((k) => r3(p.holes.top[h * 3 + k]!)));
  return out;
};
const run = (text: string): NcProgram => parseGcode(`G21 G17 G90 G54\n${text}`, { initialPosition: [0, 0, 10] });

describe('G16 극좌표(Fanuc)', () => {
  it('G90: 반지름·각을 작업 원점 기준으로 — 볼트 원 구멍', () => {
    const p = run(`G16\nG81 X50 Y0 Z-5 R2 F100\nY90\nY180\nY270\nG80\nG15`);
    expect(holes(p)).toEqual([
      [50, 0],
      [0, 50],
      [-50, 0],
      [0, -50],
    ]);
    expect(p.warnings.some((w) => w.includes('G16'))).toBe(false);
  });

  it('G91 각 증분 + K 반복: 반복마다 더 돈다(반지름 원점은 그대로)', () => {
    const p = run(`G16\nG81 X40 Y0 Z-5 R2 F100\nG91 Y90 K3\nG90 G80 G15`);
    expect(holes(p)).toEqual([
      [40, 0],
      [0, 40],
      [-40, 0],
      [0, -40],
    ]);
  });

  it('G91 반지름은 지금 자리가 극 원점, 이동도 극좌표, G15로 끝', () => {
    const p = run(`G0 X100 Y0\nG16\nG91 G1 X10 Y90 F100\nG90 G15\nG1 X5 Y5`);
    const e: number[][] = [];
    for (let i = 0; i < p.moves.count; i++) e.push(moveEnd(p.moves, i).map(r3));
    expect(e).toEqual([
      [100, 0, 10],
      [100, 10, 10],
      [5, 5, 10],
    ]);
  });
});
