import { describe, expect, it } from 'vitest';
import { detectLathe, parseGcode } from '../src/gcode';
import { MOVE_ARC, MOVE_FEED, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';
import { ncToScene } from '../src/scene';
import { ncSampleProgram } from '../src/view/sample';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
/** 이동 끝점 (X, Z) */
const xz = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) {
    const e = moveEnd(p.moves, i);
    out.push([r3(e[0]), r3(e[2])]);
  }
  return out;
};
const lathe = (text: string, opts = {}): NcProgram => parseGcode(text, { initialPosition: [50, 0, 50], lathe: true, ...opts });

describe('선반 모드', () => {
  it('Fanuc: X는 지름(반지름으로 그림), U·W 증분, G18 원호(I·K), T0101 = 공구 1, Y는 0', () => {
    const p = lathe(`O0001
G21 G18 G99
T0101
G0 X40 Z2
G1 Z-20 F0.2
U10 W-5
G2 X60 Z-35 R10
G0 X100 Z50
M30`);
    expect(p.lathe).toBe(true);
    expect(xz(p)).toEqual([
      [20, 2],
      [20, -20],
      [25, -25],
      [30, -35],
      [50, 50],
    ]);
    expect(p.moves.kind[3]).toBe(MOVE_ARC);
    expect(p.arcs.plane[p.moves.arc[3]!]).toBe(1);
    expect(p.tools.map((t) => t.number)).toEqual([1]);
    for (let i = 0; i < p.moves.count; i++) expect(moveEnd(p.moves, i)[1]).toBe(0);
    expect(p.warnings).toEqual([]);
  });

  it('LinuxCNC: 기본 반지름(G8), G7이면 지름, G33은 이송 직선', () => {
    const p = lathe(`G18 G21
G0 X10 Z2
G7
G1 X40 F100
G8
G1 X10
G33 Z-20 K1.5`, { dialect: 'linuxcnc' });
    expect(xz(p)).toEqual([
      [10, 2],
      [20, 2],
      [10, 2],
      [10, -20],
    ]);
    expect(p.moves.kind[3]).toBe(MOVE_FEED);
  });

  it('G90 바깥지름 단순 사이클(모달 반복)·G94 단면 사이클은 시작점으로 돌아온다', () => {
    const p = lathe(`G21
G0 X50 Z2
G90 X40 Z-20 F0.2
X35
G0 X50 Z2
G94 X20 Z-2 F0.2`);
    expect(xz(p).slice(1, 9)).toEqual([
      [20, 2],
      [20, -20],
      [25, -20],
      [25, 2],
      [17.5, 2],
      [17.5, -20],
      [25, -20],
      [25, 2],
    ]);
    expect(xz(p).slice(9)).toEqual([
      [25, -2],
      [10, -2],
      [10, 2],
      [25, 2],
    ]);
    expect(p.moves.kind[1]).toBe(MOVE_RAPID);
    expect(p.moves.kind[2]).toBe(MOVE_FEED);
  });

  it('G71 거친 깎기 → 윤곽 블록 건너뛰기 → G70 다듬질(윤곽 줄에 이어짐)', () => {
    const src = `G21
G0 X50 Z2
G71 U2 R0.5
G71 P10 Q40 U0 W0 F0.25
N10 G0 X20
N20 G1 Z-10
N30 X40 Z-20
N40 X50
G70 P10 Q40
G0 X100 Z50
M30`;
    const p = lathe(src);
    const L71 = 3;
    const rough: number[] = [];
    for (let i = 0; i < p.moves.count; i++) if (p.moves.line[i] === L71) rough.push(i);
    // 7단(X 반지름 23, 21, …, 11) × 4이동 + 다듬질 윤곽(4) + 돌아오기(윤곽 끝 X가 시작 X와 같아 Z만 1)
    expect(rough.length).toBe(7 * 4 + 4 + 1);
    const ends71 = rough.map((i) => [r3(moveEnd(p.moves, i)[0]), r3(moveEnd(p.moves, i)[2])]);
    expect(ends71.slice(0, 4)).toEqual([
      [23, 2],
      [23, -20],
      [23.5, -19.5],
      [23.5, 2],
    ]);
    // X 반지름 15 단은 윤곽 사선(10,-10)-(20,-20)과 Z -15에서 만난다
    expect(ends71.slice(16, 18)).toEqual([
      [15, 2],
      [15, -15],
    ]);
    // 윤곽 블록(4~7번 줄)의 이동은 G70이 한 번 실행한 것뿐
    const profMoves = Array.from(p.moves.line).filter((l) => l >= 4 && l <= 7);
    expect(profMoves).toEqual([4, 5, 6, 7]);
    // G70 뒤 시작점(25, 2)으로 돌아오고 다음 블록
    const tail = xz(p).slice(-3);
    expect(tail).toEqual([
      [25, -20],
      [25, 2],
      [50, 50],
    ]);
    expect(p.warnings).toEqual([]);
  });

  it('G72 단면 거친 깎기·G73 형상 반복(나눔 수만큼 윤곽)', () => {
    const p72 = lathe(`G21
G0 X50 Z2
G72 W2 R0.5
G72 P10 Q30 U0 W0 F0.2
N10 G0 Z-6
N20 G1 X20
N30 Z2`);
    const l72 = Array.from(p72.moves.line).filter((l) => l === 3).length;
    // Z 단 0, -2, -4 (3단 × 4) + 윤곽 3 + 돌아오기 1(Z는 이미 시작 높이)
    expect(l72).toBe(3 * 4 + 3 + 1);
    const p73 = lathe(`G21
G0 X50 Z2
G73 U4 W0 R3
G73 P10 Q20 U0 W0 F0.2
N10 G0 X20
N20 G1 Z-10`);
    const l73 = Array.from(p73.moves.line).filter((l) => l === 3).length;
    expect(l73).toBe(3 * (2 + 2));
  });

  it('G96 주속 일정: 반지름에서 회전수를 구해 회전당 이송 시간을 낸다(G50 S 최고 회전수)', () => {
    const p = lathe(`G21
G50 S2000
G96 S200 M3
G99
G0 X40 Z0
G1 Z-100 F0.2`);
    const rpm = (1000 * 200) / (2 * Math.PI * 20);
    expect(p.moves.time[1]!).toBeCloseTo((100 / (0.2 * rpm)) * 60, 1);
    const q = lathe(`G21
G50 S1000
G96 S200 M3
G0 X10 Z0
G1 Z-10 F0.2`);
    // 반지름 5에서 6366rpm → 1000rpm으로 자름
    expect(q.moves.time[1]!).toBeCloseTo((10 / (0.2 * 1000)) * 60, 3);
  });

  it('G74 정면 쪼아 드릴·G76 나사(여러 번)·G83 정면 드릴(Z 방향)', () => {
    const p = lathe(`G21
G0 X0 Z5
G74 R1
G74 Z-20 Q8000 F0.1`);
    const zs = xz(p)
      .slice(1)
      .map((e) => e[1]);
    // 8씩 쪼고 1 물러남, 바닥 뒤 시작 Z로(길이 0인 이동은 넣지 않음)
    expect(zs).toEqual([-3, -2, -11, -10, -19, -18, -20, 5]);
    const t = lathe(`G21
G0 X30 Z5
G76 P020060 Q100 R0.05
G76 X26 Z-20 P1000 Q300 F1.5`);
    const passes = Array.from(t.moves.line).filter((l) => l === 3).length / 4;
    expect(passes).toBeGreaterThan(3);
    const d = lathe(`G21
G0 X0 Z5
G83 X0 Z-15 R2 Q5 F0.1
G80`);
    expect(d.holes.count).toBe(1);
    expect([r3(d.holes.bottom[0]!), r3(d.holes.bottom[2]!)]).toEqual([0, -15]);
  });

  it('판별: 선반 글은 자동으로, 밀링으로 읽으면 안내 경고, 예제(밀링)는 아님', () => {
    const turn = `O1000 (LATHE PART)
G21 G99
T0101
G96 S180 M3
G0 X52 Z2
G71 U1.5 R0.5
G71 P10 Q20 U0.4 W0.1 F0.25
N10 G0 X30
N20 G1 Z-30
M30`;
    expect(detectLathe(turn)).toBe(true);
    expect(detectLathe(ncSampleProgram())).toBe(false);
    const mill = parseGcode(turn);
    expect(mill.lathe).toBeUndefined();
    expect(mill.warnings.some((w) => w.includes('선반 프로그램으로 보임'))).toBe(true);
    expect(parseGcode(turn, { lathe: 'auto' }).lathe).toBe(true);
    expect(parseGcode(ncSampleProgram()).warnings.some((w) => w.includes('선반'))).toBe(false);
  });

  it('장면: 회전축(Z) 점선과 meta.lathe', () => {
    const p = lathe(`G21\nG0 X40 Z2\nG1 Z-20 F0.2`);
    const s = ncToScene(p);
    expect(s.lines.find((l) => l.id === 'lathe-axis')?.group).toBe('회전축');
    expect((s.meta as { lathe: boolean }).lathe).toBe(true);
    expect(ncToScene(parseGcode('G1 X1 F1')).lines.some((l) => l.id === 'lathe-axis')).toBe(false);
  });
});
