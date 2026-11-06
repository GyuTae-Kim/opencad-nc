// 47차: Siemens 공구 데이터 시스템 변수 $TC_DPn[공구, 날] = 값. Fundamentals(6FC5398-1BP40-3BA1, 03/2013) 90쪽 — 공구 반지름은 $TC_DP6(기하)과
// $TC_DP15(마모), 268·281·285·287쪽 예(프로그램 머리에서 $TC_DP1 = 공구 종류·$TC_DP6 = 반지름을 대입), 73쪽 — D가 없으면 날은 기계 데이터가 정함.
// 사이클 설명서(6FC5398-3BP20-0BA0) 예도 같은 꼴($TC_DP1[t,d]=120 $TC_DP3[t,d]=… $TC_DP6[t,d]=…)이다.
// 프로그램 안에서 대입한 반지름만 공구 표처럼 쓴다(기계에 둔 공구 데이터는 모름). 옵션 공구 표가 먼저다
import { describe, expect, it } from 'vitest';
import { ncCompPath } from '../src/comp';
import { looksSiemens } from '../src/gcode';
import type { NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

type Tools = Record<number, { diameter?: number; radius?: number }>;
const run = (text: string, toolTable?: Tools): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 100], ...(toolTable ? { toolTable } : {}) });
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
const G41 = (head: string, td = 'T1 D1'): string => `${head}\nG71 G17 G90 G94\n${td}\nM6\nS1000 M3 F500\nG0 X-10 Y-10 Z5\nG1 Z-2\nG41 G1 X0 Y0\nX40\nY30\nX0\nY0\nG40 G1 X-10 Y-10\nG0 Z50\nM30\n`;
const pts = (p: NcProgram): number[] => Array.from(p.moves.points.slice(0, (p.moves.count + 1) * 3)).map((v) => Math.round(v * 1e6) / 1e6);

describe('Siemens $TC_DP 공구 데이터 대입(47차)', () => {
  it('설명서 예 꼴 한 줄: $TC_DP6이 반경 보정 반지름이 되고, 반지름 경고는 없으며 $TC_DP1·$TC_DP3은 전처럼 무시함', () => {
    const p = run(G41('$TC_DP1[1,1]=120 $TC_DP3[1,1]=111 $TC_DP6[1,1]=6'));
    expect(p.compRuns).toEqual([expect.objectContaining({ radius: 6, source: '$TC_DP6 T1 D1', side: 1 })]);
    const w = warns(p);
    expect(w.filter((x) => x.includes('$TC_DP6'))).toEqual([]);
    expect(w).toContain("Siemens 낱말 '$TC_DP1'은(는) 무시함");
    expect(w).toContain("Siemens 낱말 '$TC_DP3'은(는) 무시함");
    expect(ncCompPath(p).runs[0]!.used).toBe(6);
  });

  it('$TC_DP15(마모)를 더하고, 식·대입 순서(T D 뒤)도 읽는다', () => {
    expect(run(G41('$TC_DP6[1,1]=6\n$TC_DP15[1,1]=-0.25')).compRuns![0]).toEqual(expect.objectContaining({ radius: 5.75, source: '$TC_DP6 + $TC_DP15 T1 D1' }));
    expect(run(G41('R1=2.5\n$TC_DP6[1, 1] = R1*2')).compRuns![0]!.radius).toBe(5);
    const after = 'G71 G17 G90 G94\nT2 D3\nM6\n$TC_DP6[2,3]=4\nS1000 M3 F500\nG0 X-10 Y-10 Z5\nG1 Z-2\nG41 G1 X0 Y0\nX40\nG40 G1 X50 Y-10\nM30\n';
    expect(run(after).compRuns![0]).toEqual(expect.objectContaining({ radius: 4, source: '$TC_DP6 T2 D3' }));
  });

  it('다른 공구·다른 날·D0·D 없음(날을 기계 데이터가 정함)이면 쓰지 않고, 옵션 공구 표가 먼저', () => {
    expect(run(G41('$TC_DP6[2,1]=6')).compRuns![0]!.radius).toBeNaN();
    expect(run(G41('$TC_DP6[1,2]=6')).compRuns![0]!.radius).toBeNaN();
    expect(run(G41('$TC_DP6[1,1]=6', 'T1')).compRuns![0]!.radius).toBeNaN();
    expect(run(G41('$TC_DP6[1,1]=6'), { 1: { diameter: 10 } }).compRuns![0]).toEqual(expect.objectContaining({ radius: 5, source: '공구 표 T1' }));
    // 대입 경고가 사라진 것은 같다(읽었으나 이 날에는 쓰지 않음)
    expect(warns(run(G41('$TC_DP6[2,1]=6'))).filter((x) => x.includes('$TC_DP6'))).toEqual([]);
  });

  it('첨자가 [공구, 날] 꼴이 아니면(설명서 예의 [1.1] 같은 오타) 무시하고 알림', () => {
    const p = run(G41('$TC_DP6[1.1] =10'));
    const W = '$TC_DP6: 첨자가 [공구 번호, 날 번호] 꼴이 아님 — 무시함';
    expect(warns(p)).toContain(W);
    expect(p.compRuns![0]!.radius).toBeNaN();
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(W, code), code).not.toMatch(/[가-힣]/);
  });

  it('$TC_…[…] 대입은 Siemens 표지(머리에 공구 데이터만 둔 프로그램도 Siemens로 읽음), GRBL $ 설정은 아님', () => {
    expect(looksSiemens(G41('$TC_DP1[1,1]=120 $TC_DP3[1,1]=111 $TC_DP6[1,1]=6').replace('G71 ', ''))).toBe(true);
    expect(looksSiemens('$H\n$32=1\nG21 G90\nG0 X10 Y10\nM30\n')).toBe(false);
    expect(looksSiemens('G21 G90 G17\nT1 M6\nG0 X0 Y0 Z5\nM30\n')).toBe(false);
  });

  it('사이클(CYCLE72·POCKET3·SLOT1)도 같은 반지름: 옵션 공구 표로 준 것과 같은 길, 반지름 모름 경고 없음', () => {
    const c72 = 'G0 X0 Y0 Z20\nCYCLE72("K", 10, 0, 2, -6, 4, 1, 0.5, 500, 100, 1, 41, 1, 5, 900)\nG0 X0 Y0\nM30\n%_N_K_SPF\nG0 G90 X0 Y0\nG1 X40\nY30\nX0\nY0\nM17\n';
    const p3 = 'G0 X0 Y0 Z20\nPOCKET3(10, 0, 2, -5, 40, 30, 5, 20, 15, 0, 2, 0, 0, 500, 100, 0, 11, 0)\nM30\n';
    const s1 = 'G0 X0 Y0 Z20\nSLOT1(5, 0, 1, -10, , 3, 30, 12, 0, 0, 20, 0, 90, 100, 320, 5, 0, 0, 0)\nM30\n';
    for (const body of [c72, p3, s1]) {
      const head = 'G71 G17 G90 G94\nT5 D1\nM6\nS1000 M3 F500\n';
      const viaTc = run(`$TC_DP1[5,1]=120 $TC_DP3[5,1]=111 $TC_DP6[5,1]=3\n${head}${body}`);
      const viaOpt = run(`${head}${body}`, { 5: { radius: 3 } });
      expect(pts(viaTc)).toEqual(pts(viaOpt));
      expect(warns(viaTc).filter((w) => w.includes('공구 반지름을 몰라'))).toEqual([]);
      expect(warns(run(`${head}${body}`)).some((w) => w.includes('공구 반지름을 몰라'))).toBe(true);
    }
  });
});
