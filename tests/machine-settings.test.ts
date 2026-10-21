import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import { FLAG_MACHINE_EST, MOVE_RAPID, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const pts = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i <= p.moves.count; i++) out.push([0, 1, 2].map((a) => r3(p.moves.points[i * 3 + a]!)));
  return out;
};

describe('기계 설정: 급속 속도·공구 교환 시간', () => {
  it('공구 교환마다 시간을 더하고(통계·이동 시간) 급속 속도는 mm 기준 → inch 프로그램이면 바꿔 쓴다', () => {
    const text = `G21 G90 G54\nT1 M06\nG0 X0 Y0 Z10\nG1 Z0 F600\nT2 M06\nG0 X100\nM30`;
    const p = parseGcode(text, { dialect: 'fanuc', machine: { toolChangeSec: 6, rapidFeedMm: 6000 } });
    expect(p.stats.toolChanges).toBe(2);
    expect(p.stats.toolChangeTime).toBeCloseTo(12);
    expect(p.stats.rapidFeed).toBe(6000);
    // 급속 100 mm @ 6000 mm/분 = 1초, 절삭 10 mm @ 600 = 1초, 공구 교환 2번 = 12초
    expect(p.stats.time).toBeCloseTo(p.stats.rapidTime + p.stats.feedTime + 12);
    let sum = 0;
    for (let i = 0; i < p.moves.count; i++) sum += p.moves.time[i]!;
    expect(sum).toBeCloseTo(p.stats.time - p.stats.dwellTime);
    const inch = parseGcode(`G20 G90\nG0 X1 Y1 Z1`, { dialect: 'fanuc', machine: { rapidFeedMm: 2540 } });
    expect(inch.stats.rapidFeed).toBeCloseTo(100);
    // 따로 준 rapidFeed가 먼저
    expect(parseGcode(`G21 G0 X1`, { rapidFeed: 5000, machine: { rapidFeedMm: 2000 } }).stats.rapidFeed).toBe(5000);
  });
});

describe('도그레그 급속', () => {
  it('여러 축 급속을 짧은 축부터 멈추는 꺾인 길로, 시간은 가장 긴 축 이동', () => {
    const text = `G21 G90\nG0 X0 Y0 Z10\nG0 X10 Y5 Z0\nG1 X20 F100`;
    const off = parseGcode(text, { dialect: 'fanuc', machine: { rapidFeedMm: 600 } });
    const on = parseGcode(text, { dialect: 'fanuc', machine: { rapidFeedMm: 600, dogleg: true } });
    expect(off.moves.count).toBe(2);
    expect(pts(on)).toEqual([
      [0, 0, 10],
      [5, 5, 5],
      [10, 5, 0],
      [20, 5, 0],
    ]);
    expect(on.moves.kind[1]).toBe(MOVE_RAPID);
    expect(on.moves.line[0]).toBe(2);
    expect(on.moves.line[1]).toBe(2);
    // 가장 긴 축 이동 10 mm @ 600 mm/분 = 1초(직선 길이로 셈하면 1.5초)
    expect(on.moves.time[0]! + on.moves.time[1]!).toBeCloseTo(1);
    expect(off.moves.time[0]!).toBeCloseTo(1.5);
    // 한 축·같은 거리 축(대각선)은 그대로
    expect(parseGcode(`G21 G90\nG0 X0 Y0 Z0\nG0 X5 Y5`, { machine: { dogleg: true } }).moves.count).toBe(1);
  });
});

describe('허용 범위', () => {
  it('축별 최소·최대를 벗어나는 이동을 줄과 함께 경고(inch 프로그램은 mm 값을 바꿔 비교)', () => {
    const p = parseGcode(`G21 G90\nG0 X0 Y0 Z5\nG1 Z-30 F100\nG0 Z5\nG0 X600`, { dialect: 'fanuc', machine: { limitsMm: { min: [null, null, -20], max: [500, null, null] } } });
    const items = p.warningItems ?? [];
    const zMin = items.find((w) => w.text.includes('Z가 허용 범위 최솟값 -20보다 작은 곳으로 이동'));
    expect(zMin?.lines).toEqual([2]);
    expect(items.find((w) => w.text.includes('X가 허용 범위 최댓값 500보다 큰 곳으로 이동'))?.lines).toEqual([4]);
    const inch = parseGcode(`G20 G90\nG0 X0 Y0 Z1\nG1 Z-1 F10`, { machine: { limitsMm: { min: [null, null, -12.7], max: [null, null, null] } } });
    expect(inch.warnings.some((w) => w.includes('Z가 허용 범위 최솟값 -0.5보다'))).toBe(true);
  });
});

describe('기계 오프셋·기준점(mm 설정)', () => {
  it('G53·G28을 실제 위치로(추정 표시 없음), inch 프로그램은 바꿔 쓴다', () => {
    const p = parseGcode(`G21 G90 G54\nG0 X0 Y0 Z10\nG53 Z0\nG0 Z20\nG28 G91 Z0`, { dialect: 'fanuc', machine: { offsetMm: [-400, -200, -300], referenceMm: [0, 0, 0] } });
    expect(pts(p).slice(-3)).toEqual([
      [0, 0, 300],
      [0, 0, 20],
      [0, 0, 300],
    ]);
    for (let i = 0; i < p.moves.count; i++) expect(p.moves.flags[i]! & FLAG_MACHINE_EST).toBe(0);
    const inch = parseGcode(`G20 G90 G54\nG0 X0 Y0 Z1\nG53 Z0`, { dialect: 'fanuc', machine: { offsetMm: [0, 0, -254] } });
    expect(pts(inch).at(-1)).toEqual([0, 0, 10]);
  });

  it('Heidenhain M91도 같은 설정으로', () => {
    const text = `0 BEGIN PGM T MM\n1 TOOL CALL 1 Z S1000\n2 L X0 Y0 Z10 R0 FMAX\n3 L Z0 R0 FMAX M91\n4 END PGM T MM`;
    const p = parseHeidenhain(text, { machine: { offsetMm: [0, 0, -300] } });
    expect(pts(p).at(-1)).toEqual([0, 0, 300]);
  });
});
