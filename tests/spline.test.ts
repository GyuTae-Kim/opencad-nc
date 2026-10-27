/**
 * LinuxCNC 스플라인 G5(3차 — I·J·P·Q)·G5.1(2차 — I·J): 휘는 정도에 맞춘 이송 직선 조각, 이어 쓰는 G5의 접선, 모달 이동 꼴, 규칙에 어긋난 블록.
 */
import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { MOVE_FEED, moveEnd, type NcProgram } from '../src/model';

const pts = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i));
  return out;
};
const run = (body: string): NcProgram => parseGcode(`G21 G17 G90 G54\nG0 X0 Y0 Z0\n${body}M2\n`, { dialect: 'linuxcnc', initialPosition: [0, 0, 0] });
/** 3차 베지어 위의 점 */
const cubic = (a: number[], b: number[], c: number[], d: number[], t: number): number[] => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * a[k]! + 3 * u * u * t * b[k]! + 3 * u * t * t * c[k]! + t * t * t * d[k]!);
};

describe('LinuxCNC G5·G5.1 스플라인', () => {
  it('G5: 조정점 (0,5)·(10,5)인 3차 곡선을 곡선 위의 점들로 잇고, 조각과 곡선의 차이는 0.005 mm 안', () => {
    const p = run('G5 X10 Y0 I0 J5 P0 Q5 F300\n');
    expect(p.warnings).toEqual([]);
    const all = pts(p);
    expect(all.length).toBeGreaterThan(10);
    expect(all.length).toBeLessThan(200);
    expect(Array.from(p.moves.kind.subarray(0, p.moves.count)).every((k) => k === MOVE_FEED)).toBe(true);
    expect(all.at(-1)!.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([10, 0, 0]);
    // 꼭짓점은 곡선 위(t = k/n), 가장 높은 곳은 t = 0.5의 y = 3.75 가까이
    const n = all.length;
    for (let k = 0; k < n; k++) {
      const c = cubic([0, 0], [0, 5], [10, 5], [10, 0], (k + 1) / n);
      expect(Math.hypot(all[k]![0]! - c[0]!, all[k]![1]! - c[1]!)).toBeLessThan(1e-9);
    }
    // 조각의 가운데와 곡선의 차이
    let worst = 0;
    for (let k = 0; k < n; k++) {
      const a = k === 0 ? [0, 0] : all[k - 1]!;
      const b = all[k]!;
      const mid = cubic([0, 0], [0, 5], [10, 5], [10, 0], (k + 0.5) / n);
      worst = Math.max(worst, Math.hypot((a[0]! + b[0]!) / 2 - mid[0]!, (a[1]! + b[1]!) / 2 - mid[1]!));
    }
    expect(worst).toBeLessThan(0.006);
    expect(Math.max(...all.map((q) => q[1]!))).toBeCloseTo(3.75, 2);
    // 처음 조각은 첫 조정점 쪽(+Y)으로 나간다
    expect(all[0]![1]!).toBeGreaterThan(all[0]![0]! * 10);
    expect(p.moves.line[0]).toBe(2);
  });

  it('이어 쓰는 G5는 I·J를 빼면 앞 G5의 -P·-Q로 접선을 잇고, 이동 꼴은 모달(G5 없이 좌표만 써도 스플라인)', () => {
    const p = run('G5 X10 Y0 I0 J5 P0 Q5 F300\nG5 X20 Y0 P0 Q-5\nX30 Y0 I0 J5 P0 Q5\n');
    expect(p.warnings).toEqual([]);
    const all = pts(p);
    // 둘째 곡선: 조정점 (10,-5)·(20,-5) — 아래로 볼록
    expect(Math.min(...all.map((q) => q[1]!))).toBeCloseTo(-3.75, 2);
    // 셋째(G5 모달): 다시 위로, 끝 (30, 0)
    expect(all.filter((q) => q[0]! > 20).every((q) => q[1]! >= -1e-9)).toBe(true);
    expect(all.at(-1)!.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([30, 0, 0]);
  });

  it('G5.1: 조정점 하나(시작 + I·J)인 2차 곡선', () => {
    const p = run('G5.1 X10 Y0 I5 J5 F300\n');
    expect(p.warnings).toEqual([]);
    const all = pts(p);
    expect(Math.max(...all.map((q) => q[1]!))).toBeCloseTo(2.5, 2);
    expect(all.at(-1)!.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([10, 0, 0]);
  });

  it('규칙에 어긋나면(P·Q 없음, 첫 G5에 I·J 없음, G17 밖, Z) 끝점까지 직선으로 그리고 알린다', () => {
    const noPQ = run('G5 X10 Y0 I0 J5 F300\n');
    expect(noPQ.warnings.some((w) => w.includes('G5: 끝 쪽 조정점 P·Q가 없음'))).toBe(true);
    expect(pts(noPQ).map((q) => q.map((v) => Math.round(v * 1000) / 1000 + 0))).toEqual([[10, 0, 0]]);
    expect(run('G5 X10 Y0 P0 Q5 F300\n').warnings.some((w) => w.includes('이어 쓸 앞 G5가 없는데'))).toBe(true);
    // 사이에 다른 이동이 끼면 이어 쓸 수 없다
    expect(run('G5 X10 Y0 I0 J5 P0 Q5 F300\nG1 X12\nG5 X20 Y0 P0 Q-5\n').warnings.some((w) => w.includes('이어 쓸 앞 G5가 없는데'))).toBe(true);
    expect(run('G18\nG5 X10 Z0 I0 J5 P0 Q5 F300\n').warnings.some((w) => w.includes('G17(XY) 평면에서만'))).toBe(true);
    expect(run('G5.1 X10 Y0 F300\n').warnings.some((w) => w.includes('G5.1: 조정점 I·J가 없음'))).toBe(true);
  });

  it('좌표 없는 Fanuc G05(고속 가공 모드 켜기)는 그대로 무시한다', () => {
    const p = parseGcode('O1\nG21 G90\nG05 P10000\nG0 X0 Y0 Z5\nG1 X10 F100\nG05 P0\nM30\n');
    expect(p.warnings.some((w) => w.includes('G5'))).toBe(false);
    expect(p.moves.count).toBe(1);
  });
});
