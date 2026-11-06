// 47차: 급속 검사("급속 이동이 가장 깊은 절삭보다 아래로")는 표시 Z를 깊이(공구 축)로 본다. Siemens는 작업 평면이 진입 방향을 정하고
// (Fundamentals 6FC5398-1BP40-3BA1, 03/2013, 8.2절 154쪽: G17 진입 Z·G18 진입 Y·G19 진입 X — 155쪽: 공구 길이 보정은 늘 돌리지 않은 작업 평면 기준),
// Heidenhain은 TOOL CALL의 축이 공구 축이다. G18·G19(공구 축 Y·X)에서는 표시 Z가 평면 안 좌표라 ROT 등으로 평면 안 자리가 낮아지면
// 거짓 경고가 났다(46차 확인) — 그 이동은 검사하지 않는다. G17(공구 축 Z)의 경고와 Fanuc 계열(공구 축 Z 고정)은 그대로다.
import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import type { NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';

const RAPID = '급속 이동이 가장 깊은 절삭';
const rapidWarns = (p: NcProgram): string[] => p.warnings.filter((w) => w.includes(RAPID));
const sie = (text: string): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 300], toolTable: { 1: { radius: 3 } } });

describe('평면이 정하는 공구 축의 급속 검사(47차)', () => {
  it('Siemens G19 + ROT RPL=30 CYCLE72(46차가 찾은 꼴): 거짓 경고 없음', () => {
    const p = sie('G71 G19 G90 G94\nT1 D1\nROT RPL=30\nG0 X0 Y0 Z20\nCYCLE72("K", 10, 0, 2, -6, 4, 1, 0.5, 500, 100, 1, 41, 1, 5, 900)\nG0 X0 Y0\nM30\n%_N_K_SPF\nG0 G90 Y0 Z0\nG1 Y40\nZ40\nY0\nZ0\nM17\n');
    expect(p.moves.count).toBeGreaterThan(20);
    expect(rapidWarns(p)).toEqual([]);
  });

  it('Siemens G18·G19: 평면 안에서 낮은 자리로 가는 급속은 깊이가 아니다(ROT·회전 없이도)', () => {
    for (const [plane, A, B, C] of [
      ['G18', 'Z', 'X', 'Y'],
      ['G19', 'Y', 'Z', 'X'],
    ]) {
      for (const frame of ['', 'ROT RPL=120'])
        expect(rapidWarns(sie(`G71 ${plane} G90\nT1 D1\nM6\n${frame}\nG0 ${A}0 ${B}0 ${C}10\nG1 ${C}-5 F300\n${A}30\nG0 ${C}10\nG0 ${A}-40 ${B}-60\nG1 ${C}-3\nG0 ${C}10\nM30`)), `${plane} ${frame}`).toEqual([]);
    }
  });

  it('G17은 그대로: ROT·AROT 아래에서도 가장 깊은 절삭보다 아래로 가는 급속은 경고', () => {
    for (const frame of ['', 'ROT RPL=30', 'AROT RPL=-45', 'ROT X30', 'MIRROR X0']) {
      const p = sie(`G71 G17 G90\nT1 D1\nM6\n${frame}\nG0 X0 Y0 Z10\nG1 Z-5 F300\nX30\nG0 Z10\nG0 X-20 Y-15\nG1 Z-3\nG0 Z-20\nG0 Z50\nM30`);
      expect(rapidWarns(p).length, frame).toBeGreaterThan(0);
    }
  });

  it('G18·G19 구간과 G17 구간이 섞이면 G17 급속만 검사한다', () => {
    const p = sie('G71 G17 G90\nT1 D1\nM6\nG0 X0 Y0 Z10\nG1 Z-5 F300\nX30\nG0 Z10\nG19\nROT RPL=30\nG0 Y-40 Z-60\nROT\nG17\nG0 X0 Y0 Z-20\nG0 Z50\nM30');
    expect(rapidWarns(p).map((w) => w.replace(/: .*/, ''))).toEqual(['13번 줄']);
  });

  it('Heidenhain 공구 축 Y·X(TOOL CALL 축) + 사이클 10 회전: 거짓 경고 없음, 공구 축 Z는 그대로 경고', () => {
    const H = (ax: string, A: string, B: string, low: boolean): NcProgram =>
      parseHeidenhain(
        ['BEGIN PGM R MM', 'TOOL DEF 1 L+0 R+3', `TOOL CALL 1 ${ax} S3000 F500`, 'CYCL DEF 10.0 ROTATION', 'CYCL DEF 10.1 ROT+120', `L ${A}+0 ${B}+0 ${ax}+10 R0 FMAX`, `L ${ax}-5 F300`, `L ${A}+30`, `L ${ax}+10 FMAX`, `L ${A}-40 ${B}-60 FMAX`, `L ${ax}-3`, `L ${ax}${low ? '-20' : '+10'} FMAX`, 'END PGM R MM']
          .map((l, i) => `${i} ${l}`)
          .join('\n'),
      );
    expect(rapidWarns(H('Y', 'Z', 'X', false))).toEqual([]);
    expect(rapidWarns(H('X', 'Y', 'Z', false))).toEqual([]);
    expect(rapidWarns(H('Z', 'X', 'Y', true)).length).toBeGreaterThan(0);
  });

  it('Fanuc 계열은 G18에서도 공구 축 Z로 보아 그대로 경고', () => {
    const p = parseGcode('G21 G90 G18\nT1 M6\nS1000 M3\nG0 X0 Y0 Z10\nG1 Z-5 F300\nX30\nG0 Z10\nG0 X-20\nG0 Z-20\nG0 Z50\nM30', { initialPosition: [0, 0, 50] });
    expect(rapidWarns(p).length).toBeGreaterThan(0);
  });
});
