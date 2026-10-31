import { describe, expect, it } from 'vitest';
import { detectGcodeDialect, looksSiemens } from '../src/gcode';
import { parseNcFile } from '../src/index';
import { parseSiemens } from '../src/siemens';
import { FLAG_MACHINE_EST, MOVE_ARC, MOVE_DRILL, moveEnd, type NcProgram } from '../src/model';
import { makeSource } from '../src/text';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const run = (text: string): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 50] });
const holes = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let h = 0; h < p.holes.count; h++) out.push([0, 1, 2].map((k) => r3(p.holes.top[h * 3 + k]!)));
  return out;
};
const sweeps = (p: NcProgram): number[] => Array.from(p.arcs.sweep, (s) => Math.round((s * 180) / Math.PI));

const BASIC = `; SINUMERIK TEST
N10 G90 G17 G54 G71
N20 T="CUTTER_10" D1
N30 M6
N40 S3000 M3
N50 G0 X0 Y0 Z10
N60 R1=20
N70 G1 X=R1 Y0 Z-1 F200
N80 G2 X40 Y0 CR=10
N90 G1 X=IC(10)
N100 G3 X50 Y20 I=AC(50) J=AC(10)
N110 G0 Z10
N120 MCALL CYCLE81(10,0,2,-5,)
N130 X10 Y10
N140 X20 Y10
N150 MCALL
N160 TRANS X100
N170 ROT RPL=30
N180 G0 X0 Y0
N190 G1 X10 F100
N200 TRANS
N210 L100
N220 SUPA G0 Z0
N230 M30`;

describe('Siemens Sinumerik', () => {
  it('판별: MCALL·CYCLE·T="…"·CR=·AC(…)·%_N_ 머리, 다른 방언은 아님', () => {
    expect(looksSiemens(BASIC)).toBe(true);
    expect(detectGcodeDialect(BASIC)).toBe('siemens');
    expect(detectGcodeDialect('%_N_PART1_MPF\n;$PATH=/_N_WKS_DIR/_N_A_WPD\nG0 X0')).toBe('siemens');
    expect(detectGcodeDialect('N10 G1 X10 CR=5')).toBe('siemens');
    expect(detectGcodeDialect('%\nO1000\nG0 X0 Y0\nG81 X1 Y1 Z-1 R1 F100\nM30\n%')).toBe('fanuc');
    expect(detectGcodeDialect('o100 sub\nG1 X1\no100 endsub')).toBe('linuxcnc');
    expect(detectGcodeDialect('%\nO1000 (HAAS)\nG0 X0')).toBe('haas');
    // Fanuc 괄호 주석 안의 CR=·T="…"·MCALL은 Siemens 표지가 아니다
    expect(detectGcodeDialect('%\nO0004 (COMP)\n(T1 D=10. CR=0. - FLAT END MILL)\n(MCALL T="X")\nG0 X0\nM30\n%')).toBe('fanuc');
    expect(parseNcFile('part.mpf', BASIC).kind).toBe('gcode');
    const p = parseNcFile('part.mpf', BASIC);
    if ('program' in p) expect(p.program.dialect).toBe('siemens');
  });

  it('주소 = 식, IC/AC, CR=, I=AC, MCALL CYCLE81, TRANS·ROT(절대 지령은 프레임을 바꾼다), SUPA', () => {
    const p = parseSiemens(makeSource(BASIC));
    expect(ends(p).slice(0, 4)).toEqual([
      [20, 0, -1],
      [40, 0, -1],
      [50, 0, -1],
      [50, 20, -1],
    ]);
    expect(sweeps(p)).toEqual([-180, 180]);
    expect(Array.from(p.arcs.center.slice(3, 5))).toEqual([50, 10]);
    expect(holes(p)).toEqual([
      [10, 10, 2],
      [20, 10, 2],
    ]);
    // ROT RPL=30이 TRANS X100을 지운다 → X10이 30도 돈 자리
    expect(ends(p)).toContainEqual([8.66, 5, 10]);
    expect(p.tools.map((t) => t.name)).toEqual(['CUTTER_10']);
    expect(p.warnings.some((w) => w.includes('부프로그램 L100을(를) 찾지 못함'))).toBe(true);
    // SUPA Z0 = 기계 좌표 쪽(안전 높이)
    expect(p.moves.flags[p.moves.count - 1]! & FLAG_MACHINE_EST).toBe(FLAG_MACHINE_EST);
    expect(p.units).toBe('mm');
    expect(p.warnings.some((w) => w.includes('읽을 수 없는'))).toBe(false);
  });

  it('흐름: IF GOTOF·IF/ELSE/ENDIF·WHILE·FOR·REPEAT/UNTIL·REPEAT 표지 P=', () => {
    const p = run(`G71 G90 G1 F100
R1=0
WHILE R1<3
X=R1*10 Y0
R1=R1+1
ENDWHILE
FOR R2=1 TO 2
Y=R2*5
ENDFOR
R3=0
REPEAT
R3=R3+1
UNTIL R3>=2
X=R3*100
IF R3==2 GOTOF SKIP
X999
SKIP: Y99
IF R3>5
X777
ELSE
X55
ENDIF
START: Z-1
END1: Z-2
REPEAT START END1 P=2
M30`);
    expect(ends(p).map((e) => [e[0], e[1], e[2]])).toEqual([
      [0, 0, 50],
      [10, 0, 50],
      [20, 0, 50],
      [20, 5, 50],
      [20, 10, 50],
      [200, 10, 50],
      [200, 99, 50],
      [55, 99, 50],
      [55, 99, -1],
      [55, 99, -2],
      [55, 99, -1],
      [55, 99, -2],
      [55, 99, -1],
      [55, 99, -2],
    ].slice(1));
  });

  it('부프로그램: %_N_…_SPF 머리·PROC 매개변수·L 번호·P 반복·M17·RET', () => {
    const p = run(`%_N_MAIN_MPF
G71 G90 G0 X0 Y0 Z5
HOLEROW P2
L100
DRILLAT(30, 40)
M30
%_N_HOLEROW_SPF
G91 G1 X10 F100
G90
M17
%_N_L100_SPF
G0 Y-5
RET
PROC DRILLAT(REAL XX, REAL YY)
G0 X=XX Y=YY
M17`);
    expect(ends(p)).toEqual([
      [0, 0, 5],
      [10, 0, 5],
      [20, 0, 5],
      [20, -5, 5],
      [30, 40, 5],
    ]);
    expect(p.warnings).toEqual([]);
  });

  it('원호: CIP 중간점, AR 여는 각(중심·끝점), TURN 나선, 극좌표 G111 AP·RP', () => {
    const p = run(`G71 G90 G17 G1 X0 Y0 Z0 F100
CIP X20 Y0 I1=10 J1=10
G2 X40 Y0 AR=180
G3 I-10 J0 AR=90
G2 X50 Y10 I0 J10 TURN=1 Z-4
G111 X100 Y100
G1 RP=10 AP=90
AP=180`);
    // CIP: (0,0) → (10,10) → (20,0) = 중심 (10,0) 시계
    expect(Array.from(p.arcs.center.slice(0, 2)).map(r3)).toEqual([10, 0]);
    expect(sweeps(p)[0]).toBe(-180);
    expect(sweeps(p)[1]).toBe(-180);
    // 중심 (30,0)에서 (40,0)을 반시계 90도 → (30,10)
    expect(ends(p)[3]).toEqual([30, 10, 0]);
    // TURN=1: 한 바퀴 더(360 + 원래 호)
    expect(Math.abs(sweeps(p)[3]!)).toBeGreaterThan(360);
    expect(ends(p).slice(-2)).toEqual([
      [100, 110, -4],
      [90, 100, -4],
    ]);
    expect(Array.from(p.moves.kind).filter((k) => k === MOVE_ARC).length).toBe(4);
  });

  it('HOLES1·HOLES2 + MCALL CYCLE83(쪼기)·CYCLE82(휴지)', () => {
    const p = run(`G71 G90 G17 T1 M6
G0 X0 Y0 Z20
MCALL CYCLE83(10, 0, 2, -12, , -4, , 2, 0, 0, 1, 1)
HOLES1(0, 0, 0, 10, 10, 3)
MCALL CYCLE82(10, 0, 2, -3, , 1.5)
HOLES2(50, 50, 20, 0, 0, 4)
MCALL
M30`);
    expect(holes(p).map((h) => [h[0], h[1]])).toEqual([
      [10, 0],
      [20, 0],
      [30, 0],
      [70, 50],
      [50, 70],
      [30, 50],
      [50, 30],
    ]);
    // CYCLE83: 첫 절입 4(FDEP -4), 2씩 줄여 최소 2 → -4, -6, -8, -10, -12
    const drills: number[] = [];
    for (let i = p.holes.move[0]!; i < p.holes.move[1]!; i++) if (p.moves.kind[i] === MOVE_DRILL) drills.push(r3(moveEnd(p.moves, i)[2]));
    expect(drills).toEqual([-4, -6, -8, -10, -12]);
    expect(p.stats.dwellTime).toBeCloseTo(1.5 * 4);
  });

  it('프레임: ATRANS·AROT 덧붙이기, MIRROR는 원호 방향을 뒤집고, SCALE은 배율', () => {
    const p = run(`G71 G90 G17 G1 F100 X0 Y0 Z0
TRANS X10
ATRANS Y5
AROT RPL=90
G1 X10 Y0
TRANS
MIRROR X0
G0 X0 Y0
G2 X10 Y0 CR=5
MIRROR
SCALE X2 Y2
G1 X10 Y10
SCALE`);
    // (10,0)을 90도 돌리고 (10,5)만큼: (10, 15)
    expect(ends(p)[1]).toEqual([10, 15, 0]);
    // 거울 X: (10,0) → (-10,0), 시계 → 반시계
    const arcIdx = Array.from(p.moves.kind).indexOf(MOVE_ARC);
    expect(ends(p)[arcIdx]).toEqual([-10, 0, 0]);
    expect(Math.sign(p.arcs.sweep[0]!)).toBe(1);
    expect(ends(p)[ends(p).length - 1]).toEqual([20, 20, 0]);
  });

  it('G74 기준점 접근, G4 F 초, G70 inch, 지원하지 않는 사이클·시스템 변수는 경고', () => {
    const p = run(`G70 G90 G0 X1 Y1 Z1
G4 F2.5
G1 Z-0.1 F10
G74 Z1=0
SLOT1(10, 0, 1, -5)
R5=$AA_IW[X]
G0 X2`);
    expect(p.units).toBe('inch');
    expect(p.stats.dwellTime).toBeCloseTo(2.5);
    expect(p.moves.flags[2]! & FLAG_MACHINE_EST).toBe(FLAG_MACHINE_EST);
    expect(p.warnings.some((w) => w.includes('SLOT1') && w.includes('지원하지 않음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('$AA_IW'))).toBe(true);
    expect(ends(p).slice(-1)[0]![0]).toBe(2);
  });
});
