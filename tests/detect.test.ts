import { describe, expect, it } from 'vitest';
import { detectGcodeDialect, looksSiemens, stripParenComments } from '../src/gcode';
import { parseNcFile } from '../src/index';
import { moveEnd, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const program = (name: string, text: string): NcProgram => {
  const r = parseNcFile(name, text);
  if (r.kind === 'mpr') throw new Error('mpr');
  return r.program;
};
const unreadable = (p: NcProgram): string[] => p.warnings.filter((w) => w.includes('읽을 수 없는'));

describe('방언 판별: 낱말에 붙은 주석·겹친 주석은 Siemens 표지가 아니다', () => {
  it('stripParenComments: N1(…)·T1M6(…)·G0X0(…)·((…))는 떼고 CYCLE81(…)·=AC(…)·식 괄호는 남긴다', () => {
    expect(stripParenComments('N1(FACE MILL D80 CR=0.8)\nG0')).toBe('N1 \nG0');
    expect(stripParenComments('T1M6(T1 CR=0.5)')).toBe('T1M6 ');
    expect(stripParenComments('G0X0Y0(START CR=0)')).toBe('G0X0Y0 ');
    expect(stripParenComments('(T1 D=10. CR=0. - DRILL (SPOT))\nG0')).toBe(' \nG0');
    expect(stripParenComments('IF[#1GT5]GOTO10(LOOP CR=1)')).toBe('IF[#1GT5]GOTO10 ');
    expect(stripParenComments('/(SKIP CR=1)')).toBe('/ ');
    expect(stripParenComments('(OPEN CR=1\nG0 X1')).toBe(' \nG0 X1');
    expect(stripParenComments('MCALL CYCLE81(10,0,2,-5,)')).toBe('MCALL CYCLE81(10,0,2,-5,)');
    expect(stripParenComments('G1 X=AC(10) Y=IC(5)')).toBe('G1 X=AC(10) Y=IC(5)');
    expect(stripParenComments('R3=R1*(R2+1) X=(R1+2) Z=SIN(30)')).toBe('R3=R1*(R2+1) X=(R1+2) Z=SIN(30)');
  });

  it('Fanuc 프로그램(O 번호·주석 속 CR=·GOTOF)은 Fanuc으로 읽고, G99 사이클은 R 점으로 물러난다', () => {
    const text = `%
O0002(PLATE)
N1(FACE MILL D80 CR=0.8 GOTOF)
G0G17G40G49G80G90
G91G28Z0
T1M6
G90G54G0X-50.Y0S1200M3
G43H1Z50.M8
G1Z0F300
X150.F800
G0Z50.
N2(CENTER DRILL)
T2M6(SPOT D10 CR=0)
G90G54G0X10.Y10.S2000M3
G43H2Z50.M8
G99G81X10.Y10.Z-3.R3.F100
X90.
G98X10.Y40.
G80
M30
%`;
    expect(detectGcodeDialect(text)).toBe('fanuc');
    const p = program('plate.nc', text);
    expect(p.dialect).toBe('fanuc');
    expect(p.notices ?? []).toEqual([]);
    expect(unreadable(p)).toEqual([]);
    // G99: 구멍 사이는 R3 높이, G98은 처음 높이(Z50)로
    const e = ends(p);
    const drill = e.findIndex((v) => v[2] === -3);
    expect(e[drill + 1]).toEqual([10, 10, 3]);
    expect(e.slice(-1)).toEqual([[10, 40, 50]]);
    expect(p.tools.map((t) => t.number)).toEqual([1, 2]);
  });

  it('T1M6(… CR=0.5) — 공구 번호는 T1', () => {
    const p = program('t.nc', `%\nO1100\nG21 G90 G17 G54\nT1M6(T1 EM D=10 CR=0.5)\nS1000M3\nG0X0Y0(START CR=0)\nG43H1Z10.\nG1Z-1.F100\nX50.\nM30\n%`);
    expect(p.dialect).toBe('fanuc');
    expect(p.tools.map((t) => t.number)).toEqual([1]);
  });

  it('겹친 주석 "(… (SPOT))"이 있는 드릴 프로그램: G91 G99 G81 … K3은 구멍 세 개', () => {
    const text = `%
O1000 (DRILL TEST)
(T1 D=10. CR=0. - ZMIN=-20. - DRILL (SPOT))
G21 G17 G40 G49 G80 G90
T1 M6
S1500 M3
G54 G0 X10. Y10.
G43 H1 Z50. M8
G99 G81 X10. Y10. Z-20. R2. F150.
G80
G0 Z50.
G0 X0 Y0
G91 G99 G81 X10. Y0 Z-15. R-48. K3 F100.
G90 G80
G0 Z50.
M30
%`;
    const p = program('drill.nc', text);
    expect(p.dialect).toBe('fanuc');
    expect(unreadable(p)).toEqual([]);
    expect(p.holes.count).toBe(4);
    const tops: number[][] = [];
    for (let h = 0; h < p.holes.count; h++) tops.push([0, 1, 2].map((k) => r3(p.holes.top[h * 3 + k]!)));
    expect(tops).toEqual([
      [10, 10, 2],
      [10, 0, 2],
      [20, 0, 2],
      [30, 0, 2],
    ]);
  });

  it('겹친 주석이 있는 매크로(#·[식]·WHILE)와 M98 프로그램도 Fanuc으로 끝까지 읽는다', () => {
    const macro = `%
O5000
(T6 D=6. CR=0. (BALL))
G21 G90 G17 G54
T6 M6
S2000 M3
G0 X0 Y0 Z10.
#100=0
WHILE [#100 LT 3] DO1
G0 X[#100*10] Y0
G1 Z-2. F100.
G0 Z2.
#100=#100+1
END1
M30
%`;
    const p = program('macro.nc', macro);
    expect(p.dialect).toBe('fanuc');
    expect(unreadable(p)).toEqual([]);
    // 첫 G0 X0(제자리)은 이동이 아니다: 구멍 세 곳 × (내려가기·올라오기) + 옆으로 두 번
    expect(p.moves.count).toBe(8);
    expect(ends(p).slice(-2)).toEqual([
      [20, 0, -2],
      [20, 0, 2],
    ]);
    const subs = `%
O4000
(T5 D=8. CR=0.5 (BULL))
G21 G90 G17 G54
T5 M6
S2000 M3
G0 X0 Y0 Z10.
M98 P4100 L2
M30
O4100 (SUB)
G91 G1 Z-11. F100.
X10.
G0 Z11.
G90
M99
%`;
    const q = program('subs.nc', subs);
    expect(q.dialect).toBe('fanuc');
    expect(q.warnings.filter((w) => w.includes('M98'))).toEqual([]);
    expect(ends(q).slice(-1)).toEqual([[20, 0, 10]]);
  });

  it('LinuxCNC o-코드 프로그램은 G0 X0(CR=1) 하나로 Siemens가 되지 않는다', () => {
    const text = `o100 sub\nG1 X1 F100\no100 endsub\nG21 G90\nG0 X0(CR=1)\no100 call\nM2`;
    expect(detectGcodeDialect(text)).toBe('linuxcnc');
  });

  it('Siemens 표지 하나는 Fanuc 표지(O 번호·# 변수·M98/G65 P)가 있으면 이기지 못하고, 둘이면 Siemens', () => {
    expect(detectGcodeDialect('%\nO1000\nG0 X0 Y0\nN10 G1 X10 CR=5\nM30')).toBe('fanuc');
    expect(detectGcodeDialect('#1=5\nG1 X10 CR=5')).not.toBe('siemens');
    expect(detectGcodeDialect('G0 X0\nM98 P100\nG1 X10 CR=5')).not.toBe('siemens');
    // Fanuc 표지가 없으면 하나로도 Siemens(예전과 같음)
    expect(detectGcodeDialect('N10 G1 X10 CR=5')).toBe('siemens');
    expect(detectGcodeDialect('N10 G0 X0\nN20 R1=5\nN30 G1 X=R1')).toBe('siemens');
    // 표지 둘(T="…"·MCALL CYCLE81)이면 O 번호가 있어도 Siemens
    expect(detectGcodeDialect('O1\nT="DRILL" D1\nMCALL CYCLE81(10,0,2,-5,)\nX10 Y10\nMCALL')).toBe('siemens');
    expect(looksSiemens('G0 X0 (CR=1)')).toBe(false);
    expect(looksSiemens('G1 X=AC(10)')).toBe(true);
  });
});
