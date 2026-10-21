import { describe, expect, it } from 'vitest';
import { looksOkuma, parseGcode } from '../src/gcode';
import { type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const holes = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let h = 0; h < p.holes.count; h++) out.push([0, 1].map((k) => r3(p.holes.top[h * 3 + k]!)));
  return out;
};
const H = (body: string): NcProgram => parseGcode(`G20 G17 G90 G54\nT1 M06\n${body}`, { dialect: 'haas', initialPosition: [0, 0, 1] });

describe('Haas 볼트 구멍 패턴', () => {
  it('G70: 지금 자리를 중심으로 반지름 I·시작 각 J·L개(L0 사이클 정의는 그 자리에 구멍을 내지 않음)', () => {
    const p = H(`G0 X2. Y2.\nG81 Z-0.5 R0.1 F10. L0\nG70 I1. J0. L4\nG80`);
    expect(holes(p)).toEqual([
      [3, 2],
      [2, 3],
      [1, 2],
      [2, 1],
    ]);
  });

  it('G71 호(K 각 간격)·G72 직선(I 간격, J 각) — 고정 사이클이 없으면 경고', () => {
    const a = H(`G0 X0 Y0\nG81 Z-0.5 R0.1 F10. L0\nG71 I1. J0. K90. L3\nG80`);
    expect(holes(a)).toEqual([
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
    const b = H(`G0 X0 Y0\nG81 Z-0.5 R0.1 F10. L0\nG72 I0.5 J90. L3\nG80`);
    expect(holes(b)).toEqual([
      [0, 0.5],
      [0, 1],
      [0, 1.5],
    ]);
    expect(H(`G0 X0 Y0\nG70 I1. J0. L4`).warnings.some((w) => w.includes('G70 볼트 구멍 패턴 앞에 고정 사이클이 없음'))).toBe(true);
    // Fanuc 밀링의 G70은 모르는 G(좌표를 그리지 않음)
    expect(parseGcode(`G21 G0 X0 Y0 Z5\nG70 X10 Y10`, { dialect: 'fanuc', initialPosition: [0, 0, 5] }).moves.count).toBe(0);
  });
});

describe('Okuma OSP', () => {
  it('판별해 띠·경고로 알리고, G15 H는 작업 좌표계', () => {
    const text = `O1234 (OKUMA)\nG15 H2\nG0 X0 Y0 Z50\nVC1=10\nCALL O100 PX=VC1\nM02`;
    expect(looksOkuma(text)).toBe(true);
    expect(looksOkuma('%\nO1000\nG0 X0\nG15\nM30')).toBe(false);
    const p = parseGcode(text, { workOffsets: { G55: [100, 0, 0] }, initialPosition: [0, 0, 60] });
    expect(p.notices).toEqual([{ kind: 'dialect', dialect: 'okuma' }]);
    expect(p.warnings.some((w) => w.includes('Okuma OSP 프로그램으로 보임'))).toBe(true);
    expect(Array.from(p.moves.wcs)).toEqual([1]);
  });
});
