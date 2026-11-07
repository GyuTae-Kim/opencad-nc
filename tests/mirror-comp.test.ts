// 47차: 대칭 아래 반경 보정 쪽. 표시 좌표의 이동은 이미 대칭된 것이므로, 한 축(평면 안) 대칭이면 보정 경로를 프로그램의 반대쪽으로 계산해
// 프로그램 좌표에서 G41/G42로 계산한 공구 중심 경로를 대칭한 것과 같게 한다.
// - Siemens: SINUMERIK 840D sl / 828D Fundamentals 프로그래밍 설명서(6FC5398-1BP40-3BA1, 03/2013) 12.7절 349~350쪽 —
//   대칭이면 컨트롤러가 경로 보정 명령(G41/G42)과 원호 방향(G2/G3)을 새 가공 방향에 맞게 바꾼다.
// - Heidenhain: TNC 310 사용 설명서(4/2003) 8.6절 140쪽 사이클 8 — 한 축 대칭이면 가공 방향이 바뀌고, 두 축이면 그대로.
// - Fanuc 계열(G51.1·음수 배율): 공개 설명서 근거를 찾지 못해 프로그램 쪽 그대로 두고 알린다.
// 윤곽은 직접 만든 합성 프로그램(설명서 예 1의 부프로그램 네 번 부르기 꼴만 따름)
import { describe, expect, it } from 'vitest';
import { ncCompPath, type NcCompPath } from '../src/comp';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import type { NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
type Piece = { m: number; s: number[]; e: number[]; c: number[]; sw: number; arc: boolean };
const pieces = (c: NcCompPath): Piece[] => {
  const out: Piece[] = [];
  for (let k = 0; k < c.count; k++) {
    const p = Array.from(c.points.slice(k * 6, k * 6 + 6)).map(r6);
    out.push({ m: c.move[k]!, s: p.slice(0, 3), e: p.slice(3), c: Array.from(c.center.slice(k * 3, k * 3 + 3)).map(r6), sw: r6(c.sweep[k]!), arc: c.kind[k] === 1 });
  }
  return out;
};
/** 조각을 축별 부호(f)로 옮김: 대칭이 한 축(평면 안)이면 호 방향도 바뀐다 */
const flip = (ps: Piece[], f: number[], arcSign: number): Omit<Piece, 'm'>[] =>
  ps.map((p) => ({ s: p.s.map((v, a) => r6(v * f[a]!)), e: p.e.map((v, a) => r6(v * f[a]!)), c: p.arc ? p.c.map((v, a) => r6(v * f[a]!)) : p.c, sw: r6(p.sw * arcSign), arc: p.arc }));
const noMove = (ps: Piece[]): Omit<Piece, 'm'>[] => ps.map(({ m: _m, ...rest }) => rest);

const T5 = { 1: { radius: 5 } };
const sie = (frame: string, plane: 'G17' | 'G18' = 'G17'): NcProgram => {
  const [A, B, C] = plane === 'G17' ? ['X', 'Y', 'Z'] : ['Z', 'X', 'Y'];
  const text = `G71 ${plane} G90 G94\nT1 D1\nM6\nS1000 M3 F500\n${frame}\nG0 ${A}10 ${B}10 ${C}5\nG1 ${C}-2\nG41 G1 ${A}20 ${B}10\n${A}60\nG3 ${A}70 ${B}20 CR=10\nG1 ${B}50\n${A}20\n${B}10\nG40 G1 ${A}10 ${B}5\nG0 ${C}50\nM30\n`;
  return parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable: T5 });
};

describe('대칭 아래 반경 보정 쪽(47차)', () => {
  it('Siemens MIRROR X0(한 축): 보정 경로는 대칭 없는 경로를 X로 대칭한 것(원호 방향도 바뀜), 구간에 mirror', () => {
    const base = pieces(ncCompPath(sie('')));
    const p = sie('MIRROR X0');
    expect(p.compRuns).toHaveLength(1);
    expect(p.compRuns![0]!.mirror).toBe(true);
    expect(p.compRuns![0]!.side).toBe(1);
    const c = ncCompPath(p);
    expect(c.warnings).toEqual([]);
    expect(noMove(pieces(c))).toEqual(flip(base, [-1, 1, 1], -1));
    expect(base.some((q) => q.arc)).toBe(true);
  });

  it('Siemens MIRROR Y0·G18의 MIRROR Z0(평면 안 한 축)도 뒤집고, 두 축(MIRROR X0 Y0)·공구 축(MIRROR Z0)·AMIRROR 두 번은 그대로', () => {
    const base = pieces(ncCompPath(sie('')));
    expect(noMove(pieces(ncCompPath(sie('MIRROR Y0'))))).toEqual(flip(base, [1, -1, 1], -1));
    const two = sie('MIRROR X0 Y0');
    expect(two.compRuns![0]!.mirror).toBeUndefined();
    expect(noMove(pieces(ncCompPath(two)))).toEqual(flip(base, [-1, -1, 1], 1));
    const tool = sie('MIRROR Z0');
    expect(tool.compRuns![0]!.mirror).toBeUndefined();
    expect(noMove(pieces(ncCompPath(tool)))).toEqual(flip(base, [1, 1, -1], 1));
    const twice = sie('AMIRROR X0\nAMIRROR X0');
    expect(twice.compRuns![0]!.mirror).toBeUndefined();
    expect(noMove(pieces(ncCompPath(twice)))).toEqual(noMove(base));
    // G18(Z/X 평면, 진입 Y): Z를 대칭하면 평면 안 한 축
    const b18 = pieces(ncCompPath(sie('', 'G18')));
    const m18 = sie('MIRROR Z0', 'G18');
    expect(m18.compRuns![0]!.mirror).toBe(true);
    expect(noMove(pieces(ncCompPath(m18)))).toEqual(flip(b18, [1, 1, -1], -1));
    // 회전과 함께여도 평면 안 방향으로 정한다(대칭 + 회전 = 여전히 한 축)
    expect(sie('MIRROR X0\nAROT RPL=30').compRuns![0]!.mirror).toBe(true);
  });

  it('Fundamentals 12.7절 예 1 꼴: 부프로그램을 MIRROR X0 → AMIRROR Y0 → MIRROR Y0로 네 번 — 한 축일 때만 보정 쪽을 바꿔 네 경로가 서로 대칭', () => {
    const L10 = '%_N_L10_SPF\nG0 X10 Y10 Z5\nG1 Z-2 F500\nG41 G1 X20 Y10\nX60\nG3 X70 Y20 CR=10\nG1 Y50\nX20\nY10\nG40 G1 X10 Y5\nG0 Z5\nM17\n';
    const text = `N5 T1 D1\nN6 M6\nN7 S1000 M3\nN10 G17 G54\nN20 L10\nN30 MIRROR X0\nN40 L10\nN50 AMIRROR Y0\nN60 L10\nN70 MIRROR Y0\nN80 L10\nN90 MIRROR\nN100 G0 X100 Y100 Z50\nN110 M30\n${L10}`;
    const p = parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable: T5 });
    expect(p.compRuns!.map((r) => !!r.mirror)).toEqual([false, true, false, true]);
    const c = ncCompPath(p);
    expect(c.warnings).toEqual([]);
    const all = pieces(c);
    const byRun = p.compRuns!.map((r) => all.filter((q) => q.m >= r.first && q.m <= r.end));
    const f = [
      [1, 1, 1, 1],
      [-1, 1, 1, -1],
      [-1, -1, 1, 1],
      [1, -1, 1, -1],
    ];
    for (let k = 1; k < 4; k++) expect(noMove(byRun[k]!), `부르기 ${k + 1}`).toEqual(flip(byRun[0]!, f[k]!.slice(0, 3), f[k]![3]!));
  });

  it('보정 중에 대칭을 켜면 다음 이동부터 쪽을 바꾼 구간이 이어진다(보정 경로는 앞 구간 끝에서 이어짐)', () => {
    const text = 'G71 G17 G90 G94\nT1 D1\nM6\nS1000 M3 F500\nG0 X10 Y10 Z5\nG1 Z-2\nG41 G1 X20 Y10\nX60\nMIRROR X0\nG1 X-20 Y40\nX-60\nG40 G1 X-70 Y50\nM30\n';
    const p = parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable: T5 });
    expect(p.compRuns!.map((r) => [r.first, r.end, !!r.mirror])).toEqual([
      [2, 4, false],
      [4, 6, true],
    ]);
    const ps = pieces(ncCompPath(p));
    const k = ps.findIndex((q) => q.m === 4);
    expect(k).toBeGreaterThan(0);
    expect(ps[k]!.s).toEqual(ps[k - 1]!.e);
  });

  it('Heidenhain 사이클 8: X(한 축)면 RL을 반대로 세어 대칭 경로, X Y(두 축)면 그대로', () => {
    const H = (cyc: string[]): NcProgram => {
      const ls = ['BEGIN PGM MIR MM', 'TOOL DEF 1 L+0 R+4', 'TOOL CALL 1 Z S3000 F500', ...cyc, 'L X+10 Y+10 Z+5 R0 FMAX', 'L Z-2 F500', 'L X+20 Y+10 RL', 'L X+60', 'CC X+60 Y+20', 'C X+70 Y+20 DR+', 'L Y+50', 'L X+20', 'L Y+10', 'L X+10 Y+5 R0', 'L Z+50 R0 FMAX', 'END PGM MIR MM'];
      return parseHeidenhain(ls.map((l, i) => `${i} ${l}`).join('\n') + '\n');
    };
    const base = pieces(ncCompPath(H([])));
    const one = H(['CYCL DEF 8.0 MIRROR IMAGE', 'CYCL DEF 8.1 X']);
    expect(one.compRuns![0]!.mirror).toBe(true);
    expect(noMove(pieces(ncCompPath(one)))).toEqual(flip(base, [-1, 1, 1], -1));
    const two = H(['CYCL DEF 8.0 MIRROR IMAGE', 'CYCL DEF 8.1 X Y']);
    expect(two.compRuns![0]!.mirror).toBeUndefined();
    expect(noMove(pieces(ncCompPath(two)))).toEqual(flip(base, [-1, -1, 1], 1));
  });

  it('Fanuc 계열 G51.1(한 축)·음수 배율: 보정 쪽은 프로그램 그대로 두고 알림, 두 축은 알리지 않음', () => {
    const F = (m: string, dialect: 'fanuc' | 'haas' = 'fanuc'): NcProgram =>
      parseGcode(`G21 G90 G17\nT1 M6\nS1000 M3\n${m}\nG0 X10 Y10 Z5\nG1 Z-2 F500\nG41 D1 G1 X20 Y10\nX60\nG3 X70 Y20 R10.\nG1 Y50\nX20\nY10\nG40 G1 X10 Y5\nG0 Z50\nM30`, { dialect, initialPosition: [0, 0, 50], toolTable: T5 });
    const W = '한 축 대칭(G51.1·음수 배율) 아래의 반경 보정(G41/G42) — 보정 쪽은 프로그램 그대로 셈(뒤집는 근거를 찾지 못함)';
    for (const p of [F('G51.1 X0'), F('G51 X0 Y0 I-1. J1.'), F('G51.1 Y0', 'haas')]) {
      expect(p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''))).toContain(W);
      expect(p.compRuns![0]!.mirror).toBeUndefined();
    }
    expect(F('G51.1 X0 Y0').warnings.some((w) => w.includes('한 축 대칭'))).toBe(false);
    expect(F('G51.1 Z0').warnings.some((w) => w.includes('한 축 대칭'))).toBe(false);
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(W, code), code).not.toMatch(/[가-힣]/);
  });

  it('CYCLE72 + MIRROR X0 + _RL 42: 보정 구간이 대칭이라 46차의 "안쪽 원호" 거짓 경고가 없고, 경로는 대칭 없는 것의 대칭', () => {
    const C = (frame: string): NcProgram =>
      parseSiemens(makeSource(`G71 G17 G90 G94\nT1 D1\n${frame}\nG0 X0 Y0 Z20\nCYCLE72("K", 10, 0, 2, -6, 4, 1, 0.5, 500, 100, 1, 42, 1, 5, 900)\nG0 X0 Y0\nM30\n%_N_K_SPF\nG0 G90 X0 Y0\nG1 X40\nY40\nX0\nY0\nM17\n`), { initialPosition: [0, 0, 300], toolTable: { 1: { radius: 3 } } });
    const base = ncCompPath(C(''));
    const p = C('MIRROR X0');
    expect(p.compRuns!.every((r) => r.mirror)).toBe(true);
    const c = ncCompPath(p);
    expect(c.warnings.filter((w) => w.includes('안쪽 원호'))).toEqual([]);
    expect(noMove(pieces(c))).toEqual(flip(pieces(base), [-1, 1, 1], -1));
  });
});
