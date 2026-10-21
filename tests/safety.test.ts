import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';

const has = (w: string[], s: string): boolean => w.some((x) => x.includes(s));
const G = (body: string, opts = {}) => parseGcode(`G21 G17 G90 G54\n${body}`, { initialPosition: [0, 0, 100], ...opts });

describe('안전 확인 경고', () => {
  it('H 번호가 공구 번호와 다르면(줄 번호와 함께), 끌 수 있음', () => {
    const body = `T1 M6\nS1000 M3\nG0 X0 Y0\nG43 H1 Z50\nG1 Z-1 F100\nT2 M6\nG0 X10 Y0\nG43 H1 Z50\nG1 Z-1 F100`;
    const p = G(body);
    expect(p.warnings.filter((w) => w.includes('공구 길이 보정이 H'))).toEqual(['9번 줄: T2인데 공구 길이 보정이 H1 — 번호가 맞는지 확인하십시오']);
    expect(has(G(body, { checkToolNumbers: false }).warnings, '공구 길이 보정이 H')).toBe(false);
    // 같은 블록의 T·M6·G43 H는 교환 뒤에 본다
    expect(has(G(`T3 M6 G43 H3 Z50\nS1000 M3\nG1 Z-1 F100`).warnings, '공구 길이 보정')).toBe(false);
  });

  it('D 번호가 공구 번호와 다르면', () => {
    const p = G(`T1 M6\nS1000 M3\nG43 H1 Z5\nG1 Z-1 F100\nG41 D5 X10 Y0\nX20\nG40 X30`);
    expect(has(p.warnings, 'T1인데 반경 보정이 D5')).toBe(true);
  });

  it('공구 교환 뒤 G43 없이 절삭(프로그램이 G43을 쓸 때만)', () => {
    const p = G(`T1 M6\nS1000 M3\nG43 H1 Z5\nG1 Z-1 F100\nT2 M6\nG0 X10\nZ5\nG1 Z-1 F100`);
    expect(p.warnings.filter((w) => w.includes('공구 길이 보정(G43 H) 없이'))).toEqual(['9번 줄: T2: 공구 교환 뒤 공구 길이 보정(G43 H) 없이 절삭']);
    expect(has(G(`T1 M6\nS1000 M3\nG0 Z5\nG1 Z-1 F100\nT2 M6\nG1 Z-2`).warnings, '없이 절삭')).toBe(false);
  });

  it('주축이 멈춘 채 절삭(M5·S0) — 주축을 쓰는 프로그램에서만', () => {
    const p = G(`T1 M6\nS1000 M3\nG43 H1 Z5\nG1 Z-1 F100\nM5\nG1 X10`);
    expect(p.warnings.filter((w) => w.includes('주축이 멈춘 채'))).toEqual(['7번 줄: T1: 주축이 멈춘 채(M5·S0) 절삭 이동']);
    expect(has(G(`G1 Z-1 F100\nX10`).warnings, '주축')).toBe(false);
  });

  it('급속이 가장 깊은 절삭보다 아래로', () => {
    const p = G(`S1000 M3\nG0 X0 Y0 Z5\nG1 Z-2 F100\nX10\nG0 Z-6\nG0 Z20`);
    expect(p.warnings.filter((w) => w.includes('급속 이동이 가장 깊은 절삭'))).toEqual(['6번 줄: 급속 이동이 가장 깊은 절삭(Z-2)보다 아래로 내려감']);
    expect(has(G(`S1000 M3\nG0 X0 Y0 Z5\nG1 Z-2 F100\nG0 Z5\nX20`).warnings, '급속 이동이')).toBe(false);
  });

  it('Heidenhain: 공작물(BLK FORM) 윗면보다 낮은 급속 수평 이동', () => {
    const p = parseHeidenhain(`0 BEGIN PGM T MM
1 BLK FORM 0.1 Z X+0 Y+0 Z-20
2 BLK FORM 0.2 X+100 Y+100 Z+0
3 TOOL CALL 1 Z S1000
4 L X+10 Y+10 Z+5 R0 FMAX M3
5 L Z-5 F100
6 L Z-2 FMAX
7 L X+50 FMAX
8 L Z+50 FMAX
9 END PGM T MM`);
    expect(has(p.warnings, '공작물 윗면(Z0)보다 낮은 높이에서 급속 수평 이동')).toBe(true);
  });
});
