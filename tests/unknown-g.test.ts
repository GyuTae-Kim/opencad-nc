import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { MOVE_ARC, MOVE_DRILL, MOVE_FEED, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';

const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map((v) => Math.round(v * 10000) / 10000));
  return out;
};
const run = (text: string, opts = {}): NcProgram => parseGcode(`G21\n${text}`, { initialPosition: [0, 0, 50], ...opts });

describe('모르는 G 코드 블록의 좌표', () => {
  it('좌표 낱말을 지금 모달 이동으로 실행하지 않는다(가짜 급속 내리꽂기 없음)', () => {
    const p = run(`G0 X10 Y10
G22 X100 Y100 Z-50 I-100 J-100 K-50
G150 P1 Z-5 Q2 R1 F200
G47 P0 X1 Y1 Z-1 E10 F100 (TEXT)
G1 X20 F100`);
    expect(ends(p)).toEqual([
      [10, 10, 50],
      [20, 10, 50],
    ]);
    expect(p.warnings.some((w) => w.includes('G22 블록의 좌표는 이동으로 그리지 않음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('G150 블록의 좌표는 이동으로 그리지 않음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('G47 블록의 좌표는 이동으로 그리지 않음'))).toBe(true);
  });

  it('Haas G154 P·G110~G129는 작업 좌표계 고르기(같은 블록의 좌표는 이동)', () => {
    const p = run(`G0 G154 P1 X1. Y1.\nG1 Z-1 F100\nG0 Z5\nG110 X2. Y2.\nG129 X3`, { workOffsets: { 'G54.1P1': [0, 0, 0], 'G54.1P20': [100, 0, 0] } });
    expect(ends(p)).toEqual([
      [1, 1, 50],
      [1, 1, -1],
      [1, 1, 5],
      [2, 2, 5],
      [103, 2, 5],
    ]);
    expect(Array.from(p.moves.wcs)).toEqual([6, 6, 6, 6, 25]);
    expect(p.warnings.filter((w) => w.includes('지원하지 않는'))).toEqual([]);
  });

  it('G110~G129 좌표계는 Haas에서만: Fanuc 계열에서는 사용자 매크로일 수 있어 모르는 G, 선반 G112·G113은 극좌표 보간', () => {
    const f = run(`G0 X1. Y1.\nG110 X2. Y2.\nG1 X3. F100`, { dialect: 'fanuc' });
    expect(ends(f)).toEqual([
      [1, 1, 50],
      [3, 1, 50],
    ]);
    expect(f.warnings.some((w) => w.includes('지원하지 않는 G110'))).toBe(true);
    expect(Array.from(f.moves.wcs)).toEqual([0, 0]);
    // Fanuc 선반의 G112(극좌표 보간)는 Haas 표지가 아니고, Haas 선반에서도 좌표계가 아니다
    const lathe = `%\nO0009(MILLTURN)\nG21 G99\nT0101\nG97 S1000 M3\nG0 X50. Z2.\nG1 Z-20. F0.2\nG0 X60.\nG112\nG1 X20. C10. F100\nG113\nG0 X100. Z100.\nM30\n%`;
    const p = parseGcode(lathe, { lathe: 'auto' });
    expect(p.dialect).toBe('fanuc');
    const h = parseGcode(lathe, { lathe: true, dialect: 'haas' });
    expect(h.warnings.some((w) => w.includes('G54.1'))).toBe(false);
    expect(h.warnings.some((w) => w.includes('지원하지 않는 G112'))).toBe(true);
    expect(Array.from(h.moves.wcs).every((w) => w === 0)).toBe(true);
  });

  it('G9·G62·G63은 이동을 그대로, G60·G27·G29는 급속 한 번(모달은 그대로)', () => {
    const p = run(`G1 X5 F100
G9 G1 X10
G60 X20 Y5
X30
G27 X0 Y0 Z50`);
    expect(ends(p)).toEqual([
      [5, 0, 50],
      [10, 0, 50],
      [20, 5, 50],
      [30, 5, 50],
      [0, 0, 50],
    ]);
    expect(Array.from(p.moves.kind)).toEqual([MOVE_FEED, MOVE_FEED, MOVE_RAPID, MOVE_FEED, MOVE_RAPID]);
    expect(p.warnings.filter((w) => w.includes('지원하지 않는'))).toEqual([]);
  });

  it('G33(밀링)은 끝점까지 이송 직선, LinuxCNC G33.1 탭은 들어갔다 나온다', () => {
    const p = run(`G0 X0 Y0 Z5\nG33 Z-10 K1.5`);
    expect(ends(p).slice(-1)).toEqual([[0, 0, -10]]);
    expect(p.moves.kind[p.moves.count - 1]).toBe(MOVE_FEED);
    const q = run(`G0 X0 Y0 Z5\nG33.1 Z-10 K1.5`, { dialect: 'linuxcnc' });
    expect(ends(q).slice(-2)).toEqual([
      [0, 0, -10],
      [0, 0, 5],
    ]);
    expect(q.moves.kind[q.moves.count - 2]).toBe(MOVE_DRILL);
  });
});

describe('Haas 원형 포켓 G12·G13', () => {
  it('I·K·Q·Z: 공구 반지름(주석 1/2 ENDMILL)만큼 줄인 원들을 돌고 중심으로 돌아온다', () => {
    const p = parseGcode(`G20 G17 G90
T1 M06 (1/2 ENDMILL)
G0 X2. Y2. Z0.1
G12 I0.5 K1. Q0.25 Z-0.25 D01 F20.
G0 Z1.`);
    const e = ends(p);
    // 중심에서 Z-0.25로 내려가고, 반지름 0.25·0.5·0.75(포켓 0.5·0.75·1.0 - 공구 0.25) 원
    expect(e).toContainEqual([2, 2, -0.25]);
    const arcs = Array.from(p.moves.kind).filter((k) => k === MOVE_ARC).length;
    expect(arcs).toBe(3);
    const r = [];
    for (let i = 0; i < p.moves.count; i++) if (p.moves.kind[i] === MOVE_ARC) r.push(Math.round((moveEnd(p.moves, i)[0] - 2) * 1000) / 1000);
    expect(r).toEqual([0.25, 0.5, 0.75]);
    // G12 = 시계(중심각 음수)
    expect(Array.from(p.arcs.sweep).every((s) => s < 0)).toBe(true);
    // 끝은 중심, 그 뒤 G0 Z1
    expect(e.slice(-2)).toEqual([
      [2, 2, -0.25],
      [2, 2, 1],
    ]);
    expect(p.warnings.filter((w) => w.includes('G12'))).toEqual([]);
  });

  it('G13은 반시계, I만 있으면 한 바퀴, 공구 반지름을 모르면 경고', () => {
    const p = run(`G0 X0 Y0 Z1\nG13 I10 Z-2 F100`);
    expect(Array.from(p.arcs.sweep).map((s) => Math.round((s * 180) / Math.PI))).toEqual([360]);
    expect(ends(p)).toContainEqual([10, 0, -2]);
    expect(p.warnings.some((w) => w.includes('공구 반지름을 몰라'))).toBe(true);
  });

  it('L번 반복은 G91 Z 증분만큼 더 깊게', () => {
    const p = run(`(T1 D=4.)\nT1 M6\nG0 X0 Y0 Z0\nG91 G12 I10 Z-1 L3 F100\nG90`);
    const zs = new Set<number>();
    for (let i = 0; i < p.moves.count; i++) if (p.moves.kind[i] === MOVE_ARC) zs.add(Math.round(moveEnd(p.moves, i)[2] * 1000) / 1000);
    expect([...zs]).toEqual([-1, -2, -3]);
  });
});
