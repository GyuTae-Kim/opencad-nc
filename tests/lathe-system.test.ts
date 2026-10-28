/**
 * Fanuc 선반 G 코드 체계 A·B·C(Fanuc 선반 설명서의 G 코드 표): 판별(단순 사이클 꼴), B·C 체계로 읽은 경로가 같은 A 프로그램과 같은지,
 * G90/G91 절대·증분, B·C의 G92(좌표 설정·최고 회전수)·G94/G95(이송 단위), C의 G70/G71(inch·mm)·G72~G78(복합 사이클),
 * 정할 수 없을 때(A + 띠·경고)와 고른 체계, 화면 띠.
 */
import { describe, expect, it } from 'vitest';
import { detectLatheSystem, parseGcode } from '../src/gcode';
import { moveEnd, MOVE_FEED, MOVE_RAPID, type NcProgram } from '../src/model';
import { parseForView } from '../src/app/payload';
import { createDoc, noticeViews } from '../src/app/doc';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const xz = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) {
    const e = moveEnd(p.moves, i);
    out.push([r3(e[0]), r3(e[2])]);
  }
  return out;
};
const kinds = (p: NcProgram): number[] => Array.from(p.moves.kind.subarray(0, p.moves.count));
const lathe = (text: string, opts = {}): NcProgram => parseGcode(text, { initialPosition: [50, 0, 50], lathe: true, ...opts });
const enc = new TextEncoder();

const A_SIMPLE = `O0001
G21 G18
G0 X50 Z2
G90 X40 Z-20 F0.2
X35
G0 X50 Z2
G92 X38 Z-30 F1.5
G0 X50 Z2
G94 X20 Z-2 F0.2
M30`;
const B_SIMPLE = A_SIMPLE.replace('G90 X40', 'G77 X40').replace('G92 X38', 'G78 X38').replace('G94 X20', 'G79 X20');
const C_SIMPLE = A_SIMPLE.replace('G21 G18', 'G71 G18').replace('G90 X40', 'G20 X40').replace('G92 X38', 'G21 X38').replace('G94 X20', 'G24 X20');

const A_ROUGH = `O0002
G21 G18
G0 X52 Z2
G71 U2 R0.5
G71 P10 Q20 U0.4 W0.1 F0.25
N10 G0 X20
G1 Z-20 F0.1
X40 Z-30
N20 X52
G70 P10 Q20
G74 R1
G74 Z-10 Q2000 F0.1
M30`;
const C_ROUGH = A_ROUGH.replace('G21 G18', 'G71 G18')
  .replace(/G71 U2/, 'G73 U2')
  .replace(/G71 P10/, 'G73 P10')
  .replace('G70 P10', 'G72 P10')
  .replace(/G74 R1/, 'G76 R1')
  .replace(/G74 Z-10/, 'G76 Z-10');

describe('Fanuc 선반 G 코드 체계 판별', () => {
  it('B: G79 또는 P·Q 없는 G77·G78이 좌표와 함께, C: G20·G21·G24가 좌표와 함께(다른 이동 G 없이)', () => {
    expect(detectLatheSystem(B_SIMPLE)).toEqual({ system: 'B', hints: [] });
    expect(detectLatheSystem('G0X50Z2\nG77X40.Z-20.F0.2\n')).toEqual({ system: 'B', hints: [] });
    expect(detectLatheSystem(C_SIMPLE)).toEqual({ system: 'C', hints: [] });
    // C의 G77(홈 쪼기 — A의 G75)·G78(복합 나사 — A의 G76)은 P·Q가 있어 B 표지가 아니다
    expect(detectLatheSystem('G71\nG24 X20 Z-2 F0.2\nG77 X30 Z-20 P1000 Q2000 F0.1\nG78 X38 Z-30 P900 Q300 F1.5').system).toBe('C');
    expect(detectLatheSystem(A_SIMPLE)).toEqual({ system: 'A', hints: [] });
    expect(detectLatheSystem(A_ROUGH)).toEqual({ system: 'A', hints: [] });
    // A의 "G21 G0 X… Z…"(mm + 급속)·괄호 주석 속 코드는 C 표지가 아니다
    expect(detectLatheSystem('G21 G0 X50 Z2 (G20 X1 Z1)\nG1 Z-10 F0.2')).toEqual({ system: 'A', hints: [] });
  });

  it('정할 수 없으면 A + 표지: G91, A 사이클과 섞인 G77~G79, 낱말 없는 G70·G71', () => {
    expect(detectLatheSystem('G21\nG91 G0 X-10 Z-2\nG90')).toEqual({ system: 'A', hints: ['G91'] });
    expect(detectLatheSystem(`${A_SIMPLE}\nG77 X30 Z-10 F0.2`)).toEqual({ system: 'A', hints: ['G77·G78·G79'] });
    expect(detectLatheSystem('G71\nG0 X50 Z2\nG1 X40 F0.2')).toEqual({ system: 'A', hints: ['G70·G71'] });
    // B 체계에만 있는 G79와 C 체계 사이클이 함께 있으면 정하지 않는다(P·Q 없는 G77은 C 체계의 홈 사이클일 수 있어 C로)
    expect(detectLatheSystem('G79 X40 Z-2 F0.2\nG20 X40 Z-20 F0.2').hints).toEqual(['G77·G78·G79', 'G20·G21·G24']);
    expect(detectLatheSystem('G77 X40 Z-20 F0.2\nG20 X40 Z-20 F0.2').system).toBe('C');
  });
});

describe('Fanuc 선반 B·C 체계로 읽기', () => {
  it('B: G77·G78·G79 단순 사이클은 같은 A 프로그램의 G90·G92·G94와 같은 경로, 띠로 알린다', () => {
    const a = lathe(A_SIMPLE);
    const b = lathe(B_SIMPLE);
    expect(a.latheSystem).toBe('A');
    expect(b.latheSystem).toBe('B');
    expect(xz(b)).toEqual(xz(a));
    expect(kinds(b)).toEqual(kinds(a));
    expect(b.warnings).toEqual(a.warnings);
    expect(b.notices).toEqual([{ kind: 'lathe-system', system: 'B' }]);
    expect(a.notices).toBeUndefined();
    // 나사 사이클(G78)의 셋째 이동(물러남)은 급속
    expect(xz(b).slice(9, 13)).toEqual([
      [19, 2],
      [19, -30],
      [25, -30],
      [25, 2],
    ]);
    expect(kinds(b).slice(9, 13)).toEqual([MOVE_RAPID, MOVE_FEED, MOVE_RAPID, MOVE_RAPID]);
  });

  it('C: G20·G21·G24 단순 사이클, G71 = mm, G73·G72·G76(A의 G71·G70·G74) 복합 사이클도 A와 같은 경로', () => {
    const a = lathe(A_SIMPLE);
    const c = lathe(C_SIMPLE);
    expect(c.latheSystem).toBe('C');
    expect(c.units).toBe('mm');
    expect(xz(c)).toEqual(xz(a));
    expect(c.warnings).toEqual(a.warnings);
    const ar = lathe(A_ROUGH);
    const cr = lathe(C_ROUGH, { latheSystem: 'C' });
    expect(ar.warnings).toEqual([]);
    expect(cr.warnings).toEqual([]);
    expect(xz(cr)).toEqual(xz(ar));
    expect(xz(cr).length).toBeGreaterThan(20);
    // C의 G70 = inch(G20은 단순 사이클)
    const inch = lathe(C_SIMPLE.replace('G71 G18', 'G70 G18'));
    expect(inch.units).toBe('inch');
    expect(xz(inch)).toEqual(xz(a));
  });

  it('B·C: G90/G91은 절대·증분(사이클이 아님), G92는 좌표 설정·최고 회전수, G94/G95는 분당·회전당 이송', () => {
    const b = lathe(`G21 G18
G00 G90 X40. Z10.
G91 G01 X-10. Z-5. F100
G94
G77 X-10. Z-20. F0.2
G90 G00 X60. Z20.
G92 X100. Z50. S1500
G0 X80.
M30`, { latheSystem: 'B' });
    expect(b.warnings).toEqual([]);
    // G00 G90은 급속(A 체계면 G90 사이클이 될 자리), G91 이송은 증분
    expect(xz(b).slice(0, 2)).toEqual([
      [20, 10],
      [15, 5],
    ]);
    // G91 G77: 끝점은 시작점에서 X -10(지름)·Z -20
    expect(xz(b).slice(2, 6)).toEqual([
      [10, 5],
      [10, -15],
      [15, -15],
      [15, 5],
    ]);
    // G94 = 분당 이송: 이송 0.2 mm/분이라 오래 걸림(회전당이면 주축이 없어 시간 0)
    expect(b.stats.feedTime).toBeGreaterThan(60);
    // G92 X100 Z50: 지금 자리(반지름 30, Z 20)가 X100(지름)·Z50 → X80 = 반지름 30 - 10
    expect(xz(b).at(-1)).toEqual([20, 20]);
  });

  it('고른 체계가 먼저: B 프로그램을 A로 고르면 예전처럼 G77~G79를 모르는 코드로, 밀링이면 체계를 보지 않는다', () => {
    const a = lathe(B_SIMPLE, { latheSystem: 'A' });
    expect(a.latheSystem).toBe('A');
    expect(a.notices).toBeUndefined();
    expect(a.warnings.some((w) => w.includes('지원하지 않는 G77'))).toBe(true);
    expect(a.warnings.some((w) => w.includes('지원하지 않는 G79'))).toBe(true);
    const mill = parseGcode(B_SIMPLE);
    expect(mill.latheSystem).toBeUndefined();
    expect(lathe('G18 G21\nG0 X10 Z2\nG1 X40 F100', { dialect: 'linuxcnc' }).latheSystem).toBeUndefined();
  });

  it('정할 수 없으면 A로 읽고 경고와 띠(G91처럼 B·C 체계에만 있는 코드)', () => {
    const p = lathe('O1\nG21 G18\nG0 X50 Z2\nG91 G1 X-10 F0.2\nG90\nM30');
    expect(p.latheSystem).toBe('A');
    expect(p.notices).toEqual([{ kind: 'lathe-system', system: 'A', hints: ['G91'] }]);
    expect(p.warnings.some((w) => w.includes('Fanuc 선반 G 코드 B·C 체계일 수 있음(G91) — A 체계로 읽음'))).toBe(true);
  });

  it('화면: 판별한 체계·표지를 띠로(체계 바꾸기 → 정보 탭), 고르면 그 체계로 다시 읽는다', () => {
    // 화면은 선반을 글로 판별한다(T0101·G96·G18)
    const B_FILE = B_SIMPLE.replace('G21 G18', 'T0101\nG21 G18\nG96 S200 M3');
    const d = createDoc('b.nc', 1, parseForView('b.nc', enc.encode(B_FILE)));
    expect(d.nc!.latheSystem).toBe('B');
    const v = noticeViews(d);
    expect(v.map((n) => [n.key, n.action?.tab])).toEqual([
      ['lathe-auto', undefined],
      ['lathe-system-B', 'info'],
    ]);
    expect(v[1]!.text).toContain('B 체계로 읽었습니다');
    const hint = createDoc('h.nc', 1, parseForView('h.nc', enc.encode('O1\nT0101\nG21 G18 G99\nG96 S200 M3\nG0 X50 Z2\nG91 G1 W-10 F0.2\nG90\nM30')));
    expect(noticeViews(hint).find((n) => n.key === 'lathe-system-A')?.text).toBe(
      'Fanuc 선반 G 코드 B·C 체계일 수 있습니다(G91) — A 체계(G90·G92·G94 단순 사이클)로 읽었습니다.',
    );
    const forced = parseForView('b.nc', enc.encode(B_FILE), { latheSystem: 'A' });
    expect(forced.nc!.latheSystem).toBe('A');
    expect(forced.nc!.notices).toEqual([{ kind: 'lathe-auto' }]);
  });
});
