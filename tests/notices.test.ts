import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { MOVE_DRILL, moveEnd, type NcProgram } from '../src/model';
import { parseForView } from '../src/app/payload';
import { createDoc, noticeViews } from '../src/app/doc';

const r3 = (v: number): number => Math.round(v * 10000) / 10000;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const enc = new TextEncoder();

const NODOT = `%
O9000 (FANUC NO DECIMAL)
G21 G90 G17
G0 X0 Y0 Z10000
G1 X12500 Y-3000 F100
G83 X20000 Y0 Z-10000 R2000 Q2000 F50
G80
M30
%`;

const LATHE = `%
O0001 (LATHE OD)
G21 G18 G99
G50 S3000
T0101
G96 S200 M3
G0 X52. Z2.
G71 U2. R0.5
G71 P10 Q20 U0.4 W0.1 F0.25
N10 G0 X20.
G1 Z-20. F0.1
X40. Z-30.
Z-50.
N20 X52.
G70 P10 Q20
M30
%`;

describe('소수점 없는 값 = 최소 입력 단위(Fanuc DPI = 0 꼴)', () => {
  it('켜면 X12500 = 12.5 mm, Q2000 = 2 mm 쪼기, 끄면 그대로 읽고 띠로 알린다', () => {
    const off = parseGcode(NODOT);
    expect(ends(off)[0]).toEqual([12500, -3000, 10000]);
    expect(off.notices).toEqual([{ kind: 'integer-units' }]);
    expect(off.warnings.some((w) => w.includes('소수점 없는 큰 좌표가 많음'))).toBe(true);
    const on = parseGcode(NODOT, { integerUnits: true });
    expect(ends(on)[0]).toEqual([12.5, -3, 10]);
    expect(on.notices).toBeUndefined();
    // G83 Q2000 = 2mm씩: R 2 → 0 → -2 … -10
    const drills: number[] = [];
    for (let i = 0; i < on.moves.count; i++) if (on.moves.kind[i] === MOVE_DRILL) drills.push(r3(moveEnd(on.moves, i)[2]));
    expect(drills).toEqual([0, -2, -4, -6, -8, -10]);
    // inch는 0.0001, A·B·C는 0.001도
    const inch = parseGcode('G20 G90 G1 X12500 F10', { integerUnits: true, initialPosition: [0, 0, 0] });
    expect(ends(inch)[0]![0]).toBeCloseTo(1.25);
  });

  it('켜도 반복 횟수 K(고정 사이클·M98)는 그대로, 식·변수가 있는 줄의 소수점 없는 수는 최소 단위로', () => {
    const holes = (p: NcProgram): number[][] => {
      const out: number[][] = [];
      for (let h = 0; h < p.holes.count; h++) out.push([0, 1, 2].map((k) => r3(p.holes.top[h * 3 + k]!)));
      return out;
    };
    // G91 G81 … K3: 구멍 세 개(예전에는 K가 0.003 → "정수가 아님 — 한 번"으로 둘이 빠졌다)
    const k3 = parseGcode('O1\nG21 G90 G17\nG0 X0 Y0 Z10000\nG91 G99 G81 X10000 Z-5000 R-8000 K3 F100\nG90 G80\nM30', { integerUnits: true });
    expect(holes(k3)).toEqual([
      [10, 0, 2],
      [20, 0, 2],
      [30, 0, 2],
    ]);
    expect(k3.warnings.some((w) => w.includes('정수가 아님'))).toBe(false);
    // Fanuc G83 K2는 반복 두 번(Haas 최소 절입으로 바뀌지 않는다)
    const g83 = parseGcode('O1\nG21 G90 G17\nG0 X0 Y0 Z10000\nG91 G83 X10000 Y0 Z-20000 R-8000 Q5000 K2 F100\nG90 G80\nM30', { integerUnits: true });
    expect(holes(g83)).toEqual([
      [10, 0, 2],
      [20, 0, 2],
    ]);
    expect(g83.warnings.some((w) => w.includes('Haas 쪼기'))).toBe(false);
    // M98 P K: 반복 세 번
    const sub = parseGcode('O1\nG21 G90 G17\nG0 X0 Y0 Z5000\nM98 P100 K3\nM30\nO100\nG91 G1 X10000 F100\nG90\nM99', { integerUnits: true });
    expect(ends(sub).slice(-1)).toEqual([[30, 0, 5]]);
    // 느린 길(변수·식이 있는 줄): 소수점 없는 X20000은 20 mm, 변수 값은 그대로
    const slow = parseGcode('O1\nG21 G90 G17\n#1=5.\n#2=7000\nG0 X0 Y0 Z10000\nG1 X20000 Y#1 F100\nG1 X30000 Y0\nG1 X[#2] Y[2000]\nM30', { integerUnits: true });
    expect(ends(slow)).toEqual([
      [20, 5, 10],
      [30, 0, 10],
      [7000, 2000, 10],
    ]);
  });

  it('소수점을 쓴 프로그램·0·작은 정수만 있는 프로그램은 알리지 않는다', () => {
    expect(parseGcode('G21 G90\nG0 X0 Y0 Z10\nG1 X125. Y-30. F100\nX150.5\nY200.').notices).toBeUndefined();
    expect(parseGcode('G21 G90\nG0 X0 Y0 Z10\nG1 X5 Y5 F100\nX10 Y0\nX0').notices).toBeUndefined();
  });
});

describe('선반 자동 판별 띠', () => {
  it("lathe: 'auto'면 선반으로 읽고 'lathe-auto'를 단다, 고르지 않으면(라이브러리 기본) 예전처럼 경고만", () => {
    const auto = parseGcode(LATHE, { lathe: 'auto' });
    expect(auto.lathe).toBe(true);
    expect(auto.notices).toEqual([{ kind: 'lathe-auto' }]);
    expect(auto.stats.time).toBeLessThan(120);
    const plain = parseGcode(LATHE);
    expect(plain.lathe).toBeUndefined();
    expect(plain.warnings.some((w) => w.includes('선반 프로그램으로 보임'))).toBe(true);
  });

  it('화면: 기본은 자동 판별(선반 띠 + 밀링으로 읽기), 밀링으로 고르면 띠가 없다', () => {
    const res = parseForView('od.nc', enc.encode(LATHE));
    const d = createDoc('od.nc', 1, res);
    expect(res.nc!.notices).toEqual([{ kind: 'lathe-auto' }]);
    const v = noticeViews(d);
    expect(v.map((n) => n.key)).toEqual(['lathe-auto']);
    expect(v[0]!.action!.opts).toEqual({ lathe: false });
    const mill = parseForView('od.nc', enc.encode(LATHE), { lathe: false });
    expect(mill.nc!.notices).toEqual([]);
    d.dismissedNotices.add('lathe-auto');
    expect(noticeViews(d)).toEqual([]);
  });

  it('화면: 소수점 없는 좌표 띠는 최소 단위로 다시 읽기, Siemens는 판별 띠', () => {
    const d = createDoc('a.nc', 1, parseForView('a.nc', enc.encode(NODOT)));
    expect(noticeViews(d).map((n) => [n.key, n.action?.opts])).toEqual([['integer-units', { integerUnits: true }]]);
    const s = createDoc('s.mpf', 1, parseForView('s.mpf', enc.encode('N10 G71 G90 G0 X0 Y0 Z5\nN20 G1 X=IC(10) F100\nN30 M30')));
    expect(noticeViews(s).map((n) => [n.key, n.action?.tab])).toEqual([['dialect-siemens', 'info']]);
  });

  it('화면: Haas로 판별하면 띠로 알린다(방언 바꾸기), 방언을 고르면 띠가 없다', () => {
    const text = '%\nO1000 (HAAS VF2)\nG20 G90 G0 X0 Y0 Z1.\nG83 Z-0.5 Q0.1 K0.05 R0.1 F5.\nG80\nM30\n%';
    const d = createDoc('h.nc', 1, parseForView('h.nc', enc.encode(text)));
    const v = noticeViews(d);
    expect(v.map((n) => [n.key, n.action?.tab])).toEqual([['dialect-haas', 'info']]);
    expect(v[0]!.text).toContain('G73·G83의 K는 최소 절입');
    expect(parseGcode(text, { dialect: 'haas' }).notices).toBeUndefined();
    expect(parseGcode(text).notices).toEqual([{ kind: 'dialect', dialect: 'haas' }]);
  });
});
