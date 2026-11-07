/**
 * 54차: 같은 상태로 되돌아오는 끝없는 고리(emitter.ts repeatStop). 증분 이동을 되풀이하는 WHILE·GOTO·LOOP·o-코드·CALL LBL은 변수·반복 횟수·부르기가
 * 그대로라 조건이 늘 같게 풀려 끝나지 않는데, 53차까지는 실행 블록 한도(500만 — Heidenhain 200만)까지 돌아 Siemens에서 5~15초 걸렸다.
 * 해석기는 결정적이므로, 같은 되돌아가는 뛰기를 다시 할 때 그 사이에 변수 대입·위치 같은 시스템 변수 읽기·반복 상태가 바뀌지 않았으면 멈추고 알린다.
 * 실제 매크로 프로그램(횟수를 세는 고리, 위치를 읽어 끝나는 고리, 큰 반복 횟수의 부프로그램)은 자르지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { REPEAT_MIN } from '../src/emitter';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import type { NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';

const STOP = '같은 상태(변수·반복 횟수·부르기)로 같은 줄을 되풀이하는 끝없는 반복이라 멈춤';
const stopped = (p: NcProgram): boolean => p.warnings.some((w) => w.includes(STOP));
const blockLimit = (p: NcProgram): boolean => p.warnings.some((w) => w.includes('실행 블록이'));
/** 마지막 이동 끝 X */
const lastX = (p: NcProgram): number => p.moves.points[p.moves.count * 3]!;

describe('같은 상태로 되돌아오는 끝없는 고리는 둘째 바퀴 근처에서 멈춘다', () => {
  it('Siemens GOTOB·WHILE·LOOP, Fanuc WHILE·GOTO, LinuxCNC while, Heidenhain FN 9 뛰기', () => {
    const t0 = performance.now();
    const progs: [string, NcProgram][] = [
      ['siemens GOTOB', parseSiemens(makeSource('G17 G90\nG0 X0 Y0 Z5\nMARKE7: G1 X=IC(1) F100\nGOTOB MARKE7\nM30\n'))],
      ['siemens WHILE', parseSiemens(makeSource('G17 G90\nG0 X0 Y0 Z5\nR1=3\nWHILE R1 > 2\nG91 G1 X1 F100\nENDWHILE\nM30\n'))],
      ['siemens LOOP', parseSiemens(makeSource('G17 G90\nG0 X0 Y0 Z5\nLOOP\nG1 X=IC(0.5) F100\nG1 Y=IC(0.5)\nENDLOOP\nM30\n'))],
      ['fanuc WHILE', parseGcode('G21 G90\nG0 X0 Y0 Z5\n#1=5\nWHILE [#1 GT 0] DO1\nG91 G1 X1 F100\nEND1\nM30\n', { dialect: 'fanuc' })],
      ['fanuc GOTO', parseGcode('G21 G91\nN10 G1 X1 F100\nGOTO 10\nM30\n', { dialect: 'fanuc' })],
      ['linuxcnc while', parseGcode('G21 G91\no771 while [1]\nG1 X1 F100\no771 endwhile\nM2\n', { dialect: 'linuxcnc' })],
      ['heidenhain FN 9', parseHeidenhain('0 BEGIN PGM P MM\n1 L X+0 Y+0 Z+5 FMAX\n2 LBL 1\n3 L IX+1 F100\n4 FN 9: IF +0 EQU +0 GOTO LBL 1\n5 END PGM P MM\n')],
    ];
    expect(performance.now() - t0).toBeLessThan(5000);
    for (const [name, p] of progs) {
      expect(stopped(p), name).toBe(true);
      expect(blockLimit(p), name).toBe(false);
      // 줄 수 + REPEAT_MIN 블록을 지나 둘째·셋째 바퀴에서 멈춘다(블록 한도 수백만까지 돌지 않는다)
      expect(p.stats.blocks, name).toBeLessThan(REPEAT_MIN + 100);
      expect(p.moves.count, name).toBeGreaterThan(1000);
    }
    for (const code of languages.filter((l: { code: string }) => l.code !== 'ko').map((l: { code: string }) => l.code)) expect(translate(STOP, code)).not.toMatch(/[가-힣]/);
  });
});

describe('끝나는 고리는 자르지 않는다', () => {
  it('횟수를 세는 고리(변수가 바뀜)는 끝까지', () => {
    const n = 3 * REPEAT_MIN;
    const s = parseSiemens(makeSource(`G17 G90\nG0 X0 Y0 Z5\nR1=0\nWHILE R1 < ${n}\nG91 G1 X1 F100\nR1=R1+1\nENDWHILE\nG90 G0 Z50\nM30\n`));
    const f = parseGcode(`G21 G90\nG0 X0 Y0 Z5\n#1=0\nWHILE [#1 LT ${n}] DO1\nG91 G1 X1 F100\n#1=#1+1\nEND1\nG90 G0 Z50\nM30\n`, { dialect: 'fanuc' });
    const h = parseHeidenhain(`0 BEGIN PGM P MM\n1 L X+0 Y+0 Z+5 FMAX\n2 Q1 = 0\n3 LBL 1\n4 L IX+1 F100\n5 Q1 = Q1 + 1\n6 FN 12: IF +Q1 LT +${n} GOTO LBL 1\n7 L Z+50 FMAX\n8 END PGM P MM\n`);
    for (const p of [s, f, h]) {
      expect(stopped(p)).toBe(false);
      expect(p.moves.count).toBeGreaterThanOrEqual(n + 1);
      expect(lastX(p)).toBeCloseTo(n, 6);
    }
  });

  it('위치를 읽어 끝나는 고리(Fanuc #5001 — 변수는 그대로)는 끝까지', () => {
    const n = 3 * REPEAT_MIN;
    const f = parseGcode(`G21 G90\nG0 X0 Y0 Z5\nWHILE [#5001 LT ${n}] DO1\nG91 G1 X1 F100\nG90\nEND1\nG0 Z50\nM30\n`, { dialect: 'fanuc' });
    expect(stopped(f)).toBe(false);
    expect(lastX(f)).toBeCloseTo(n, 6);
  });

  it('반복 횟수가 큰 부르기·구간 반복(남은 횟수가 줄어듦)은 끝까지', () => {
    const n = 2 * REPEAT_MIN;
    const f = parseGcode(`G21 G90\nG0 X0 Y0 Z5\nM98 P100 L${n}\nG0 Z50\nM30\nO100\nG91 G1 X1 F100\nG90\nM99\n`, { dialect: 'fanuc' });
    const s = parseSiemens(makeSource(`G17 G90\nG0 X0 Y0 Z5\nANF: G1 X=IC(1) F100\nENDE:\nREPEAT ANF ENDE P=${n}\nM30\n`));
    const h = parseHeidenhain(`0 BEGIN PGM P MM\n1 L X+0 Y+0 Z+5 FMAX\n2 LBL 1\n3 L IX+1 F100\n4 CALL LBL 1 REP ${n}\n5 END PGM P MM\n`);
    for (const p of [f, s, h]) {
      expect(stopped(p)).toBe(false);
      expect(lastX(p)).toBeGreaterThanOrEqual(n);
    }
  });
});
