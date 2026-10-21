import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { MOVE_DRILL, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const ends = (p: NcProgram, from = 0): number[][] => {
  const out: number[][] = [];
  for (let i = from; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const run = (text: string, opts = {}): NcProgram => parseGcode(`G21 G17 G90\n${text}`, { initialPosition: [0, 0, 20], ...opts });

describe('보링 사이클과 R 점 아래에서의 위치 결정', () => {
  it('Fanuc G87 뒤 보링: 처음 높이에서 시프트 → 구멍 아래(R)로 → 되돌려 위로 이송 → 시프트 → 처음 높이로', () => {
    const p = run(`G98 G87 X30 Y10 Z-10 R-12 Q0.5 F50\nG80`);
    expect(ends(p)).toEqual([
      [30, 10, 20],
      [30.5, 10, 20],
      [30.5, 10, -12],
      [30, 10, -12],
      [30, 10, -10],
      [30.5, 10, -10],
      [30.5, 10, 20],
      [30, 10, 20],
    ]);
    // 앞 자리에서 곧장 공작물 속으로 내려가는 급속도, 공작물 속 긴 수평 급속도 없다
    for (let i = 0; i < p.moves.count; i++) {
      const s = moveStart(p.moves, i);
      const e = moveEnd(p.moves, i);
      if (p.moves.kind[i] === MOVE_RAPID && Math.min(s[2], e[2]) < 0) expect(Math.hypot(e[0] - s[0], e[1] - s[1])).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    expect(p.moves.kind[4]).toBe(MOVE_DRILL);
    expect(p.warnings.some((w) => w.includes('시프트 Q는 평면 첫 축'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('G86처럼'))).toBe(false);
  });

  it('Fanuc G76 정밀 보링: 바닥에서 시프트 후 급속 복귀, 소수점 없는 Q는 최소 입력 단위', () => {
    const p = run(`G99 G76 X10 Y10 Z-10 R2 Q500 P500 F50\nG80`);
    expect(ends(p)).toEqual([
      [10, 10, 20],
      [10, 10, 2],
      [10, 10, -10],
      [10.5, 10, -10],
      [10.5, 10, 2],
      [10, 10, 2],
    ]);
    expect(p.stats.dwellTime).toBeCloseTo(0.5);
  });

  it('Haas G76·G77: I·J 시프트, G77 = 뒤 보링, G87 = 수동 복귀(경고)', () => {
    const h = run(`G98 G76 X10 Y10 Z-10 R2 I-0.2 J0.1 F50\nG80\nG98 G77 X20 Y10 Z-10 R-12 I0.3 F50\nG80\nG98 G87 X40 Y10 Z-5 R2 F50\nG80`, { dialect: 'haas' });
    const e = ends(h);
    expect(e[3]).toEqual([9.8, 10.1, -10]);
    expect(e).toContainEqual([20.3, 10, -12]);
    expect(h.warnings.some((w) => w.includes('G87 사이클(수동 복귀)'))).toBe(true);
    expect(h.warnings.some((w) => w.includes('시프트 Q'))).toBe(false);
  });

  it('R 점보다 낮은 자리에서 시작하면 컨트롤러처럼 그 높이로 옮긴 뒤 R 점으로(위험을 숨기지 않음)', () => {
    const p = run(`G0 X0 Y0 Z-5\nG99 G81 X10 Y0 Z-10 R2 F100\nG80`);
    expect(ends(p).slice(1, 3)).toEqual([
      [10, 0, -5],
      [10, 0, 2],
    ]);
  });
});
