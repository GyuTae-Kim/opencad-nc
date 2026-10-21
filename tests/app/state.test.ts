import { describe, expect, it } from 'vitest';
import { parseForView } from '../../src/app/payload';
import { moveState, moveSummary, wcsLabel } from '../../src/app/doc';

const PROG = `G21 G17 G90 G55
T7 M6
S2500 M3
M8
G0 X0 Y0 Z10
G43 H7 Z5
G1 Z-1 F300
G41 D7 X10 Y0
G2 X20 Y10 I0 J10
G40 G1 X30
G91 G1 X5
G90
G81 X50 Y0 Z-5 R2 F80
G80
M5
M30`;

describe('현재 블록 상태(이동마다 모달)', () => {
  const r = parseForView('s.nc', new TextEncoder().encode(PROG));
  const nc = r.nc!;
  const at = (line: number): number => {
    for (let i = 0; i < nc.moves.count; i++) if (nc.moves.line[i] === line) return i;
    return -1;
  };

  it('이송·주축·냉각·공구·H·D·좌표계·G90/G91·평면·원호', () => {
    const arc = moveState(nc, at(8), 'mm')!;
    expect(arc.motion).toBe('원호 이송 · F300 · S2500 M3 · 냉각');
    expect(arc.modal).toBe('T7 · G43 H7 · G41 D7 · G55 · G90 · G17');
    expect(arc.pos).toBe('X 20 · Y 10 · Z -1 mm');
    expect(arc.arc).toBe('중심 10, 10, -1 · R 10 · 시계 270°');
    const inc = moveState(nc, at(10), 'mm')!;
    expect(inc.modal).toBe('T7 · G43 H7 · G55 · G91 · G17');
    const drill = moveState(nc, at(12) + 2, 'mm')!;
    expect(drill.modal).toContain('G81 사이클');
    expect(moveSummary(nc, at(6))).toBe('직선 이송 · T7 · F300');
    expect(moveState(nc, -1, 'mm')).toBeNull();
  });

  it('좌표계 이름(Siemens G505~, 기계 좌표)', () => {
    expect(wcsLabel(0, 'fanuc')).toBe('G54');
    expect(wcsLabel(6, 'fanuc')).toBe('G54.1 P1');
    expect(wcsLabel(6, 'siemens')).toBe('G505');
    expect(wcsLabel(255, 'fanuc')).toBe('기계 좌표(G53)');
  });
});
