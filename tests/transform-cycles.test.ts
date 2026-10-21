import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import { parseSiemens } from '../src/siemens';
import { FLAG_MACHINE_EST, moveEnd, type NcProgram } from '../src/model';
import { makeSource } from '../src/text';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const holes = (p: NcProgram, which: 'top' | 'bottom' = 'top'): number[][] => {
  const out: number[][] = [];
  const a = which === 'top' ? p.holes.top : p.holes.bottom;
  for (let h = 0; h < p.holes.count; h++) out.push([0, 1, 2].map((k) => r3(a[h * 3 + k]!)));
  return out;
};
const H = (body: string): string => `0 BEGIN PGM T MM\n1 TOOL CALL 1 Z S1000\n2 L X+0 Y+0 Z+10 R0 FMAX\n${body}\n99 END PGM T MM`;

describe('Heidenhain 좌표 변환 사이클', () => {
  it('7 원점 이동 + 10 회전: 원점 둘레로 돌고, ROT+0으로 끝', () => {
    const p = parseHeidenhain(
      H(`3 CYCL DEF 7.0 DATUM SHIFT
4 CYCL DEF 7.1 X+50
5 CYCL DEF 10.0 ROTATION
6 CYCL DEF 10.1 ROT+90
7 L X+10 Y+0 R0 F200
8 CYCL DEF 10.0 ROTATION
9 CYCL DEF 10.1 ROT+0
10 L X+10 Y+0 R0 F200`),
    );
    expect(ends(p)).toEqual([
      [50, 10, 10],
      [60, 0, 10],
    ]);
    expect(p.warnings.filter((w) => w.includes('지원하지 않음'))).toEqual([]);
  });

  it('8 대칭: 축을 뒤집고 원호 방향도 뒤집는다, 8.1에 축이 없으면 끔', () => {
    const p = parseHeidenhain(
      H(`3 CYCL DEF 8.0 MIRROR IMAGE
4 CYCL DEF 8.1 X
5 L X+10 Y+0 R0 F200
6 CC X+10 Y+10
7 C X+20 Y+10 DR+
8 CYCL DEF 8.0 MIRROR IMAGE
9 CYCL DEF 8.1
10 L X+5 Y+5 R0 F200`),
    );
    const e = ends(p);
    expect(e[0]).toEqual([-10, 0, 10]);
    expect(e[1]).toEqual([-20, 10, 10]);
    expect(Math.sign(p.arcs.sweep[0]!)).toBe(-1);
    expect(Array.from(p.arcs.center.slice(0, 2))).toEqual([-10, 10]);
    expect(e[2]).toEqual([5, 5, 10]);
  });

  it('11 배율·26 축별 배율(중심), TRANS DATUM AXIS·RESET', () => {
    const p = parseHeidenhain(
      H(`3 CYCL DEF 11.0 SCALING
4 CYCL DEF 11.1 SCL 2
5 L X+10 Y+5 R0 F200
6 CYCL DEF 11.0 SCALING
7 CYCL DEF 11.1 SCL 1
8 CYCL DEF 26.0 AXIS-SPECIFIC SCALING
9 CYCL DEF 26.1 X2 Y0.5 CCX+10 CCY+0
10 L X+20 Y+10 R0 F200
11 CYCL DEF 26.0 AXIS-SPECIFIC SCALING
12 CYCL DEF 26.1 X1 Y1
13 TRANS DATUM AXIS X+100 Y+0
14 L X+1 Y+1 R0 F200
15 TRANS DATUM RESET
16 L X+2 Y+2 R0 F200`),
    );
    expect(ends(p)).toEqual([
      [20, 10, 10],
      [30, 5, 10],
      [101, 1, 10],
      [2, 2, 10],
    ]);
  });

  it('회전 중 드릴 사이클 구멍 자리도 돌고, M91은 변환 밖(안전 높이)', () => {
    const p = parseHeidenhain(
      H(`3 CYCL DEF 10.0 ROTATION
4 CYCL DEF 10.1 ROT+90
5 CYCL DEF 200 DRILLING ~
   Q200=+2 ;SET-UP ~
   Q201=-5 ;DEPTH ~
   Q206=+100 ;FEED ~
   Q202=+0 ;PLUNGE ~
   Q203=+0 ;SURFACE ~
   Q204=+20 ;2ND SET-UP
6 L X+30 Y+0 R0 FMAX M99
7 L Z-5 R0 FMAX M91`),
    );
    expect(holes(p)).toEqual([[0, 30, 2]]);
    expect(p.moves.flags[p.moves.count - 1]! & FLAG_MACHINE_EST).toBe(FLAG_MACHINE_EST);
    expect(ends(p).slice(-1)[0]!.slice(0, 2)).toEqual([0, 30]);
  });
});

describe('G68.2 기울인 작업 평면(Fanuc)·G268(Haas)', () => {
  const T = `G21 G17 G90 G54
G0 X0 Y0 Z50
G68.2 X0 Y0 Z0 I0 J45 K0
G53.1
G1 X10 Y0 Z0 F100
G1 X0 Y10 Z0
G81 X0 Y0 Z-10 R2 F100
G80
G69
G0 Z50`;

  it('블록의 X·Y·Z·I·J·K는 이동이 아니고, 이후 좌표는 X축 둘레 45도 기운 평면에서', () => {
    const p = parseGcode(T, { initialPosition: [0, 0, 50] });
    const e = ends(p);
    expect(e[0]).toEqual([10, 0, 0]);
    expect(e[1]).toEqual([0, 7.071, 7.071]);
    // 드릴은 기운 공구 축 방향: R2 = (0,-1.414,1.414), 바닥 -10 = (0,7.071,-7.071)
    expect(holes(p)).toEqual([[0, -1.414, 1.414]]);
    expect(holes(p, 'bottom')).toEqual([[0, 7.071, -7.071]]);
    // G69 뒤 Z만 주면 X·Y는 마지막 구멍의 R 점 자리 그대로
    expect(e[e.length - 1]).toEqual([0, -1.414, 50]);
    expect(p.warnings.filter((w) => w.includes('G68.2') || w.includes('G53.1'))).toEqual([]);
  });

  it('Haas G268 Q313은 G68.2와 같고, G269로 끈다', () => {
    const h = parseGcode(T.replace('G68.2 X0 Y0 Z0 I0 J45 K0', 'G268 X0 Y0 Z0 I0 J45 K0 Q313').replace('G69', 'G269'), { dialect: 'haas', initialPosition: [0, 0, 50] });
    expect(ends(h)[1]).toEqual([0, 7.071, 7.071]);
    expect(ends(h).slice(-1)[0]).toEqual([0, -1.414, 50]);
  });
});

describe('Siemens ROT X: 기운 프레임의 드릴 사이클', () => {
  it('공구 축도 함께 기운다', () => {
    const p = parseSiemens(makeSource(`G71 G90 G17 G0 X0 Y0 Z50\nROT X45\nG0 X0 Y0\nCYCLE81(10, 0, 2, -10)\nROT`), { initialPosition: [0, 0, 50] });
    expect(holes(p)).toEqual([[0, -1.414, 1.414]]);
    expect(holes(p, 'bottom')).toEqual([[0, 7.071, -7.071]]);
  });
});
