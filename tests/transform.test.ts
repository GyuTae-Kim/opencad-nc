import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { MOVE_ARC, moveEnd, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const run = (text: string, opts = {}): NcProgram => parseGcode(text, { initialPosition: [0, 0, 0], ...opts });

describe('좌표 회전 G68/G69', () => {
  it('원점·중심 둘레 회전, G69로 끄기, 경고 없음', () => {
    const p = run(`G21 G17 G90
G68 X0 Y0 R90
G1 X10 Y0 F100
G69
G1 X10 Y0
G68 X10 Y0 R90
G1 X20 Y0
G69`);
    expect(ends(p)).toEqual([
      [0, 10, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    expect(p.warnings).toEqual([]);
  });

  it('회전 중 증분·생략 축은 프로그램 좌표에서, G91 G68 R은 앞 각에 더하고 중심을 빼면 지금 위치', () => {
    const p = run(`G21 G17 G90
G68 X0 Y0 R90
G1 X10 Y0 F100
G91 G1 X5
G90 G1 Y3
G91 G68 R90
G90 G1 X10 Y0`);
    expect(ends(p)).toEqual([
      [0, 10, 0],
      [0, 15, 0],
      [-3, 15, 0],
      // (10, 0)을 지금 위치(프로그램 15, 3) 둘레로 180도
      [20, 6, 0],
    ]);
  });

  it('원호도 같이 돈다(중심·방향 유지)', () => {
    const p = run(`G21 G17 G90
G68 X0 Y0 R90
G1 X10 Y0 F100
G3 X0 Y10 I-10 J0`);
    expect(ends(p)[1]).toEqual([-10, 0, 0]);
    expect(p.moves.kind[1]).toBe(MOVE_ARC);
    const ai = p.moves.arc[1]!;
    expect([r3(p.arcs.center[ai * 3]!), r3(p.arcs.center[ai * 3 + 1]!)]).toEqual([0, 0]);
    expect(r3(p.arcs.sweep[ai]!)).toBe(r3(Math.PI / 2));
  });

  it('고정 사이클 구멍 자리도 돈다, #5001은 프로그램 좌표', () => {
    const p = run(`G21 G17 G90
G0 Z10
G68 X0 Y0 R90
G81 X10 Y0 Z-5 R1 F100
G80
G0 X7 Y2
#100 = #5001
#101 = #5002
G69
G0 X#100 Y#101`);
    expect(p.holes.count).toBe(1);
    expect([r3(p.holes.top[0]!), r3(p.holes.top[1]!), r3(p.holes.top[2]!)]).toEqual([0, 10, 1]);
    expect(r3(p.holes.bottom[2]!)).toBe(-5);
    expect(ends(p)[ends(p).length - 1]).toEqual([7, 2, 10]);
  });

  it('Mach3 G68 A·B 중심, LinuxCNC G10 L2 R 좌표계 회전, 다른 평면 원호는 직선 조각', () => {
    const m = run(`G21 G17
G68 A10 B0 R90
G1 X20 Y0 F100`, { dialect: 'mach3' });
    expect(ends(m)).toEqual([[10, 10, 0]]);
    expect(m.warnings).toEqual([]);
    const l = run(`G21 G17
G10 L2 P1 X0 Y0 Z0 R90
G54
G1 X10 Y0 F100`, { dialect: 'linuxcnc' });
    expect(ends(l)).toEqual([[0, 10, 0]]);
    const t = run(`G21 G17
G68 X0 Y0 R90
G18
G1 X10 Y0 Z0 F100
G2 X10 Z-10 I0 K-5`);
    expect(t.warnings.some((w) => w.includes('직선 조각'))).toBe(true);
    expect(t.moves.count).toBeGreaterThan(5);
  });
});

describe('배율 G51/G50, 거울 G51.1/G50.1', () => {
  it('Fanuc G51: 중심·P(소수점 없으면 0.001 단위)·I·J·K 축별(음수 = 거울)', () => {
    const p = run(`G21 G17 G90
G51 X0 Y0 P2000
G1 X10 Y5 F100
G50
G1 X10 Y5
G51 X10 Y0 P0.5
G1 X20 Y0
G50
G51 X0 Y0 I2000 J-1000
G1 X10 Y5
G50`);
    expect(ends(p)).toEqual([
      [20, 10, 0],
      [10, 5, 0],
      [15, 0, 0],
      [20, -5, 0],
    ]);
  });

  it('Mach3 G51 X·Y·Z는 축별 배율', () => {
    const p = run(`G21
G51 X2 Y3 Z1
G1 X10 Y10 F100`, { dialect: 'mach3' });
    expect(ends(p)).toEqual([[20, 30, 0]]);
  });

  it('G51.1 거울: 축선에 대해 뒤집고 원호 방향도 바뀐다, G50.1 X로 그 축만 끔', () => {
    const p = run(`G21 G17 G90
G51.1 X5
G1 X10 Y5 F100
G2 X15 Y0 I5 J0
G50.1 X0
G1 X10 Y5`);
    expect(ends(p)).toEqual([
      [0, 5, 0],
      [-5, 0, 0],
      [10, 5, 0],
    ]);
    const ai = p.moves.arc[1]!;
    // 시계(G2)가 거울에서 반시계로
    expect(p.arcs.sweep[ai]!).toBeGreaterThan(0);
    expect(r3(p.arcs.center[ai * 3]!)).toBe(-5);
  });

  it('축마다 다른 배율의 원호는 경고', () => {
    const p = run(`G21 G17
G51 X0 Y0 I2. J1.
G1 X10 Y0 F100
G3 X0 Y10 I-10 J0`);
    expect(p.warnings.some((w) => w.includes('축마다 다른 배율'))).toBe(true);
    expect(ends(p)[1]).toEqual([0, 10, 0]);
  });
});
