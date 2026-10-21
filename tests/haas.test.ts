import { describe, expect, it } from 'vitest';
import { detectGcodeDialect, parseGcode } from '../src/gcode';
import { MOVE_DRILL, moveEnd, type NcProgram } from '../src/model';

const holes = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let h = 0; h < p.holes.count; h++) out.push([0, 1].map((k) => Math.round(p.holes.top[h * 3 + k]! * 1000) / 1000));
  return out;
};
/** 구멍 h의 내려가기(드릴) 끝 깊이들 */
const pecks = (p: NcProgram, h: number): number[] => {
  const out: number[] = [];
  const first = p.holes.move[h]!;
  const last = h + 1 < p.holes.count ? p.holes.move[h + 1]! : p.moves.count;
  for (let i = first; i < last; i++) if (p.moves.kind[i] === MOVE_DRILL) out.push(Math.round(moveEnd(p.moves, i)[2] * 1000) / 1000);
  return out;
};

const HAAS = `%
O02000 (PECK TEST)
G20 G17 G90 G40 G80
T3 M06 (1/4 DRILL)
G00 G90 G54 X1. Y1. S2000 M03
G43 H03 Z1. M08
G83 Z-0.5 I0.1 J0.02 K0.05 R0.1 F5.
X2. Y1.
X3. Y1.
G80
M30
%`;

describe('Haas 방언', () => {
  it('판별: HAAS 주석·Haas만 쓰는 코드', () => {
    expect(detectGcodeDialect('%\nO1000 (HAAS VF2)\nG0 X0')).toBe('haas');
    expect(detectGcodeDialect('%\nO1000\nG187 P1 E0.01\nG0 X0')).toBe('haas');
    expect(detectGcodeDialect('%\nO1000\nG0 G154 P2 X1. Y1.')).toBe('haas');
    // M97(지역 부프로그램)은 다른 기계도 쓸 수 있어 표지로 보지 않는다(어느 방언이든 M97 P는 읽는다)
    expect(detectGcodeDialect('%\nO1000\nM97 P100\nM30')).toBe('fanuc');
    expect(detectGcodeDialect('%\nO1000\nM130 (VIDEO.MP4)\nM30')).toBe('haas');
    expect(detectGcodeDialect('%\nO1000\n#100=5\nG0 X0')).toBe('fanuc');
    expect(detectGcodeDialect(HAAS)).toBe('fanuc');
    expect(detectGcodeDialect(`(MACHINE: HAAS VF-2)\n${HAAS}`)).toBe('haas');
  });

  it('G83 I·J·K = 첫 절입·줄이는 양·최소 절입: 첫 구멍이 사라지지 않고 쪼기 깊이가 줄어든다', () => {
    const p = parseGcode(HAAS, { dialect: 'haas' });
    expect(holes(p)).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    // R0.1에서 0.1 · 0.08 · 0.06 · 0.05(최소) · 0.05 … 로 -0.5까지
    expect(pecks(p, 0)).toEqual([0, -0.08, -0.14, -0.19, -0.24, -0.29, -0.34, -0.39, -0.44, -0.49, -0.5]);
    expect(p.warnings.some((w) => w.includes('Haas 쪼기'))).toBe(false);
  });

  it('Fanuc으로 읽어도 I·J가 있거나 K가 정수가 아니면 Haas 쪼기로(경고), 구멍은 그대로', () => {
    const p = parseGcode(HAAS);
    expect(p.dialect).toBe('fanuc');
    expect(holes(p)).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(p.warnings.some((w) => w.includes('G83의 I·J·K를 Haas 쪼기'))).toBe(true);
  });

  it('Fanuc K는 반복 횟수(정수), 정수가 아니면 경고하고 한 번, Haas는 K를 반복으로 보지 않고 L로', () => {
    const base = 'G21 G90 G0 X0 Y0 Z10\n';
    expect(parseGcode(`${base}G91 G81 X10 Z-5 R-8 K3 F100`).holes.count).toBe(3);
    const f = parseGcode(`${base}G91 G81 X10 Z-5 R-8 K2.5 F100`);
    expect(f.holes.count).toBe(1);
    expect(f.warnings.some((w) => w.includes('K2.5가 정수가 아님'))).toBe(true);
    expect(parseGcode(`${base}G91 G81 X10 Z-5 R-8 K3 F100`, { dialect: 'haas' }).holes.count).toBe(1);
    expect(parseGcode(`${base}G91 G81 X10 Z-5 R-8 L3 F100`, { dialect: 'haas' }).holes.count).toBe(3);
  });

  it('Haas G4 P는 소수점 없으면 ms', () => {
    expect(parseGcode('G21 G1 X1 F60\nG4 P1500', { dialect: 'haas' }).stats.dwellTime).toBeCloseTo(1.5);
  });
});
