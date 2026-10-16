import { describe, expect, it } from 'vitest';
import { compPathSegments, ncCompPath, type NcCompPath } from '../src/comp';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import { ncToScene } from '../src/scene';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** 조각 시작·끝(xy, 소수 3자리) */
const pieces = (c: NcCompPath): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < c.count; i++) out.push([c.points[i * 6]!, c.points[i * 6 + 1]!, c.points[i * 6 + 3]!, c.points[i * 6 + 4]!].map(r3));
  return out;
};
const run = (text: string, opts = {}) => parseGcode(text, { initialPosition: [0, 0, 0], ...opts });

/** 시계 방향 정사각형(0,0)-(0,50)-(50,50)-(50,0), 공구 지름 10(주석) */
const square = (g: string): string => `G21 G90 G17
(T1 D=10. FLAT END MILL)
T1 M6
G0 X-20 Y-20 Z5
G1 Z-2 F100
${g} D1 X0 Y0 F500
Y50
X50
Y0
X0
G40 X-20 Y-20
M30`;

describe('반경 보정 경로', () => {
  it('보정 구간 기록: 들어가기·나오기 이동 번호, 반지름은 공구 주석 지름', () => {
    const p = run(square('G41'));
    expect(p.compRuns).toEqual([{ first: 2, end: 7, side: 1, plane: 0, radius: 5, source: 'T1 지름(주석·공구 정의)', line: 5 }]);
    // 프로그램 경로는 그대로
    expect(Array.from(p.moves.points.slice(9, 12))).toEqual([0, 0, -2]);
    expect(run('G1 X10 F100\nG1 Y10').compRuns).toBeUndefined();
  });

  it('바깥 모서리(G41 시계 방향 윤곽)는 반지름 r 호로 잇는다', () => {
    const c = ncCompPath(run(square('G41')));
    expect(Array.from(c.kind)).toEqual([0, 0, 1, 0, 1, 0, 1, 0, 0]);
    expect(Array.from(c.move)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 7]);
    expect(pieces(c)).toEqual([
      [-20, -20, -5, 0], // 들어가기: 다음 요소에 수직으로 옮긴 점까지
      [-5, 0, -5, 50],
      [-5, 50, 0, 55],
      [0, 55, 50, 55],
      [50, 55, 55, 50],
      [55, 50, 55, 0],
      [55, 0, 50, -5],
      [50, -5, 0, -5],
      [0, -5, -20, -20], // 나오기
    ]);
    expect(r3(c.sweep[2]!)).toBe(r3(-Math.PI / 2));
    expect([c.center[6], c.center[7]]).toEqual([0, 50]);
    expect(c.warnings).toEqual([]);
    expect(c.runs[0]!.computed).toBe(true);
  });

  it('안쪽 모서리(G42)는 옮긴 두 직선의 교점까지 자른다', () => {
    const c = ncCompPath(run(square('G42')));
    expect(Array.from(c.kind)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(pieces(c)).toEqual([
      [-20, -20, 5, 0],
      [5, 0, 5, 45],
      [5, 45, 45, 45],
      [45, 45, 45, 5],
      [45, 5, 0, 5],
      [0, 5, -20, -20],
    ]);
  });

  it('원호: 반시계 원 안쪽(G41)은 반지름 R-r, 접선으로 이어지는 직선·호는 그대로 잇는다', () => {
    const c = ncCompPath(run(`(T1 D=10.)
T1 M6
G41 D1 G1 X20 Y0 F100
G3 X20 Y0 I-20 J0
G40 G1 X0 Y0`));
    expect(Array.from(c.kind)).toEqual([0, 1, 0]);
    expect(pieces(c)[0]).toEqual([0, 0, 15, 0]);
    expect(r3(c.sweep[1]!)).toBe(r3(Math.PI * 2));
    expect([c.center[3], c.center[4]]).toEqual([0, 0]);
    // 직선 → 접하는 반시계 호: 모서리 조각 없이 이어진다
    const d = ncCompPath(run(`(T1 D=10.)
T1 M6
G0 X0 Y-10
G41 D1 G1 X0 Y0 F100
X30
G3 X40 Y10 I0 J10
G40 G1 X60 Y10`));
    expect(Array.from(d.kind)).toEqual([0, 0, 1, 0]);
    expect(pieces(d).slice(1, 3)).toEqual([
      [0, 5, 30, 5],
      [30, 5, 35, 10],
    ]);
    expect(r3(d.sweep[2]!)).toBe(r3(Math.PI / 2));
  });

  it('직선 → 시계 호의 안쪽 모서리는 직선과 넓힌 원의 교점', () => {
    const c = ncCompPath(run(`(T1 D=10.)
T1 M6
G0 X-10 Y-10
G41 D1 G1 X0 Y0 F100
X30
G2 X50 Y0 I10 J0
G40 G1 X60 Y-10`));
    const x = 40 - Math.sqrt(15 * 15 - 25);
    expect(pieces(c)[1]).toEqual([0, 5, r3(x), 5]);
    expect(c.kind[2]).toBe(1);
    expect(pieces(c)[2]![0]).toBe(r3(x));
    // 호는 반지름 15로 (55, 0)에서 끝난다
    expect(pieces(c)[2]!.slice(2)).toEqual([55, 0]);
  });

  it('반지름 출처: G10 L12(Fanuc), G41.1 D 지름(LinuxCNC), 공구 표 선택, 모르면 경고·계산 안 함', () => {
    const f = run(`G10 L12 P2 R4.\nG10 L13 P2 R0.1\nG41 D2 G1 X10 F100\nY10\nG40 X0`);
    expect(f.compRuns![0]!.radius).toBeCloseTo(4.1);
    expect(f.compRuns![0]!.source).toBe('G10 D2 반지름');
    const l = run(`G41.1 D8 G1 X10 F100\nY10\nG40 X0`, { dialect: 'linuxcnc' });
    expect(l.compRuns![0]!.radius).toBe(4);
    const t = run(`G42 D3 G1 X10 F100\nY10\nG40 X0`, { toolTable: { 3: { diameter: 6 } } });
    expect([t.compRuns![0]!.radius, t.compRuns![0]!.side, t.compRuns![0]!.source]).toEqual([3, 2, '공구 표 D3']);
    const u = run(`G41 D7 G1 X10 F100\nY10\nG40 X0`);
    expect(u.compRuns![0]!.radius).toBeNaN();
    const cu = ncCompPath(u);
    expect(cu.count).toBe(0);
    expect(cu.warnings[0]).toContain('공구 반지름을 몰라');
    expect(ncCompPath(u, { defaultRadius: 2 }).count).toBeGreaterThan(0);
    // D0은 보정 없음, 음수 반지름은 쪽을 바꾼다
    expect(ncCompPath(run(`G41 D0 G1 X10 F100\nY10\nG40 X0`)).count).toBe(0);
    const neg = ncCompPath(run(square('G41')), { radius: -5 });
    expect(pieces(neg)[1]).toEqual([5, 0, 5, 45]);
  });

  it('간섭: 공구보다 짧은 요소는 경고, Z만 움직이는 이동은 그 자리에서', () => {
    const c = ncCompPath(run(`(T1 D=10.)
T1 M6
G0 X-10 Y0
G42 D1 G1 X0 Y0 F100
Y20
X2
Y0
G40 X-10`));
    expect(c.warnings.some((w) => w.includes('간섭'))).toBe(true);
    const z = ncCompPath(run(`(T1 D=10.)
T1 M6
G0 X-10 Y-10 Z5
G41 D1 G1 X0 Y0 F100
Z-2
Y20
G40 X-10 Y30`));
    // 들어가기(-10,-10 → -5,0), Z 내리기(-5,0 제자리), 왼쪽 변, 나오기
    expect(pieces(z)).toEqual([
      [-10, -10, -5, 0],
      [-5, 0, -5, 0],
      [-5, 0, -5, 20],
      [-5, 20, -10, 30],
    ]);
    expect(Array.from(z.move)).toEqual([1, 2, 3, 4]);
  });

  it('Heidenhain RL/RR: TOOL DEF 반지름 + TOOL CALL DR', () => {
    const p = parseHeidenhain(`0 BEGIN PGM C MM
1 TOOL DEF 3 L+0 R+4
2 TOOL CALL 3 Z S1000 DR+0.5
3 L X-20 Y-20 Z-2 R0 FMAX
4 L X+0 Y+0 RL F200
5 L Y+50
6 L X+50
7 L X+70 Y+70 R0
8 END PGM C MM`);
    expect(p.compRuns).toEqual([{ first: 0, end: 3, side: 1, plane: 0, radius: 4.5, source: 'T3 R + DR', line: 4 }]);
    const c = ncCompPath(p);
    expect(pieces(c)[0]).toEqual([-20, -20, -4.5, 0]);
    expect(c.count).toBe(5);
  });

  it('장면: 선택하면 nc-comp 묶음(보정 경로)·meta, 기본은 없음', () => {
    const p = run(square('G41'));
    expect(ncToScene(p).lines.some((l) => l.id === 'nc-comp')).toBe(false);
    expect((ncToScene(p).meta as { compRunCount: number }).compRunCount).toBe(1);
    const s = ncToScene(p, { compPath: true });
    const l = s.lines.find((x) => x.id === 'nc-comp')!;
    expect(l.group).toBe('보정 경로');
    expect(l.dashed).toBeFalsy();
    const ids = Array.from(l.segmentIds!);
    expect(ids.every((v, i) => i === 0 || v >= ids[i - 1]!)).toBe(true);
    expect(ids[0]).toBe(2);
    expect(ids[ids.length - 1]).toBe(7);
    expect(s.bounds!.max[1]).toBeCloseTo(55, 3);
    const meta = s.meta as { compRuns: { radius: number; computed: boolean }[] };
    expect(meta.compRuns).toEqual([expect.objectContaining({ radius: 5, computed: true })]);
    const seg = compPathSegments(ncCompPath(p), Math.PI / 4);
    // 직선 6 + 90도 호 3개 × 2조각
    expect(seg.ids.length).toBe(6 + 3 * 2);
  });
});
