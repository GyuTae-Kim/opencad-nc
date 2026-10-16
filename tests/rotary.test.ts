import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { MOVE_FEED, moveEnd, type NcProgram } from '../src/model';
import { ncToScene } from '../src/scene';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const last = (p: NcProgram): number[] => moveEnd(p.moves, p.moves.count - 1).map(r3);
const run = (text: string, opts = {}): NcProgram => parseGcode(text, { initialPosition: [0, 0, 0], ...opts });

describe('회전축 A·B·C', () => {
  it('기본은 무시하고 경고(예전과 같음), rotaryAxes 표시', () => {
    const p = run(`G21\nG1 Z10 F100\nG1 A90`);
    expect(p.moves.count).toBe(1);
    expect(p.warnings).toContain('3번 줄: 회전축(A·B·C)은 무시함');
    expect(p.rotaryAxes).toBe(true);
  });

  it('감기: A는 X축 둘레 — 회전만 하는 이동도 공구 끝이 원을 그린다(2도씩)', () => {
    const p = run(`G21\nG1 Z10 F100\nG1 A90`, { rotary: true });
    // Z 이동 1 + 90도/2도 = 45조각
    expect(p.moves.count).toBe(1 + 45);
    expect(last(p)).toEqual([0, -10, 0]);
    for (let i = 1; i < p.moves.count; i++) {
      const e = moveEnd(p.moves, i);
      expect(Math.hypot(e[1], e[2])).toBeCloseTo(10, 9);
      expect(p.moves.line[i]).toBe(2);
    }
    // 시간: 합성 길이(직선 0, 각 90) / F
    let t = 0;
    for (let i = 1; i < p.moves.count; i++) t += p.moves.time[i]!;
    expect(t).toBeCloseTo((90 / 100) * 60, 3);
    expect(p.warnings).toEqual([]);
  });

  it('직선 축과 함께 돌면 나선(원통 감기), 증분 G91, 각을 유지하는 다음 이동도 감긴 채', () => {
    const p = run(`G21\nG1 Z10 F100\nG1 X20 A180\nG91 G1 A-90\nG90 G1 X30`, { rotary: { stepDeg: 10 } });
    // X20 A180: 18조각, 끝 (20, 0, -10)
    expect(r3(moveEnd(p.moves, 18)[0])).toBe(20);
    expect(r3(moveEnd(p.moves, 18)[2])).toBe(-10);
    expect(r3(moveEnd(p.moves, 9)[0])).toBe(10);
    expect(r3(moveEnd(p.moves, 9)[1])).toBe(-10);
    // A-90(증분) → 90도: (20, -10, 0)
    expect(last({ ...p, moves: { ...p.moves, count: 28 } })).toEqual([20, -10, 0]);
    // 각 90도인 채로 X30
    expect(last(p)).toEqual([30, -10, 0]);
  });

  it('C는 Z축 둘레, 축 바꾸기·방향 뒤집기, 원호는 직선 조각으로 감긴다', () => {
    const c = run(`G21\nG1 X10 F100\nG1 C90`, { rotary: { stepDeg: 5 } });
    expect(last(c)).toEqual([0, 10, 0]);
    const r = run(`G21\nG1 X10 F100\nG1 C90`, { rotary: { reverse: true } });
    expect(last(r)).toEqual([0, -10, 0]);
    const b = run(`G21\nG1 Z10 F100\nG1 B90`, { rotary: { B: 'x' } });
    expect(last(b)).toEqual([0, -10, 0]);
    const a = run(`G21\nG1 Z10 F100\nG0 A90\nG2 X10 Y0 I5 J0`, { rotary: true });
    expect(a.arcs.count).toBe(0);
    expect(a.moves.kind[a.moves.count - 1]).toBe(MOVE_FEED);
    // 원호(직선 축 XY) 위 점이 90도 감김: (x, y, 10) → (x, -10, y)
    expect(last(a)).toEqual([10, -10, 0]);
  });

  it('공구 끝점 제어(G43.4) 동안은 감지 않는다', () => {
    const p = run(`G21\nG43.4 H1\nG1 Z10 F100\nG1 X5 A90\nG49`, { rotary: true });
    expect(p.moves.count).toBe(2);
    expect(last(p)).toEqual([5, 0, 10]);
    expect(p.warnings.some((w) => w.includes('공구 끝점 제어'))).toBe(true);
  });

  it('감긴 고정 사이클 구멍과 장면 범위', () => {
    const p = run(`G21\nG0 Z20\nG0 A90\nG81 X0 Y0 Z5 R12 F100\nG80`, { rotary: true });
    expect(p.holes.count).toBe(1);
    // (0,0,12) → (0,-12,0)
    expect([r3(p.holes.top[0]!), r3(p.holes.top[1]!), r3(p.holes.top[2]!)]).toEqual([0, -12, 0]);
    const s = ncToScene(p);
    expect(r3(s.bounds!.min[1])).toBe(-20);
    expect((s.meta as { rotaryAxes: boolean }).rotaryAxes).toBe(true);
  });
});
