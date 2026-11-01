/**
 * 한 블록 안 반복의 이동 한도(39차 — 38차 Siemens 포켓과 같은 꼴): 파일 값(반복 수·절입·간격·겹침)이 반복 수를 정하는 자리가
 * 블록 사이 검사에 닿기 전에 이동을 한도 너머로 쌓거나 메모리를 다 쓰지 않는다. 넘으면 그 줄에서 기존 경고를 한 번 남기고 다음 줄을 읽지 않는다.
 * 모두 직접 만든 짧은 합성 프로그램이고, 값은 각 제어기 설명서의 낱말 뜻대로 썼다.
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { nurbsSegments, parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import { g7xRough } from '../src/lathe-g7x';
import { moveEnd, type NcProgram } from '../src/model';
import { parseMpr } from '../src/mpr';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';

const LIMIT = 2000;
type Run = (o: { maxMoves: number }) => NcProgram;

const fanuc =
  (text: string): Run =>
  (o) =>
    parseGcode(text, { dialect: 'fanuc', initialPosition: [0, 0, 50], ...o });
const haas =
  (text: string): Run =>
  (o) =>
    parseGcode(text, { dialect: 'haas', initialPosition: [0, 0, 50], ...o });
const linuxcnc =
  (text: string): Run =>
  (o) =>
    parseGcode(text, { dialect: 'linuxcnc', initialPosition: [0, 0, 50], ...o });
const lathe =
  (text: string): Run =>
  (o) =>
    parseGcode(text, { dialect: 'fanuc', lathe: true, initialPosition: [50, 0, 50], ...o });
const llathe =
  (text: string): Run =>
  (o) =>
    parseGcode(text, { dialect: 'linuxcnc', lathe: true, initialPosition: [30, 0, 30], ...o });
const siemens =
  (text: string): Run =>
  (o) =>
    parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], ...o });
const heidenhain =
  (body: string): Run =>
  (o) =>
    parseHeidenhain(`0 BEGIN PGM P MM\n${body}\n99 END PGM P MM\n`, o);

/** 사이클 정의 + 호출(공구 반지름 r) 뒤에 X99로 가는 블록 */
const cyc = (n: number, qs: string, r = 5): Run =>
  heidenhain(`1 TOOL DEF 1 L+0 R+${r}
2 TOOL CALL 1 Z S3000 F500
3 L Z+50 R0 FMAX
4 L X+50 Y+40 R0 FMAX
5 CYCL DEF ${n} TEST ~
  ${qs.trim().split(/\s+/).join(' ~\n  ')}
6 CYCL CALL
7 L X+99 FMAX`);
const pattern = (def: string): Run =>
  heidenhain(`1 TOOL CALL 1 Z S2000 F100
3 CYCL DEF 200 BOHREN ~
    Q200=+2 ~
    Q201=-5 ~
    Q206=+100 ~
    Q202=+5 ~
    Q203=+0 ~
    Q204=+20
${def}
5 L X+99 FMAX`);
const grid = (cols: string, rows: string): Run => pattern(`4 CYCL DEF 221 MUSTER ~\n Q225=+10 ~\n Q226=+5 ~\n Q237=+30 ~\n Q238=+20 ~\n Q242=+${cols} ~\n Q243=+${rows} ~\n Q224=+0`);
const circle = (n: string): Run => pattern(`4 CYCL DEF 220 MUSTER ~\n Q216=+50 ~\n Q217=+50 ~\n Q244=+40 ~\n Q245=+0 ~\n Q246=+360 ~\n Q247=+0 ~\n Q241=+${n}`);

const P251 = 'Q218=60 Q219=40 Q220=10 Q368=0 Q207=500 Q351=+1 Q201=-5 Q202=5 Q206=150 Q200=2 Q203=+0 Q204=50';
const P252 = 'Q223=50 Q368=0 Q207=500 Q351=+1 Q201=-6 Q202=3 Q206=150 Q200=2 Q203=+0 Q204=50';
const P253 = 'Q218=60 Q219=20 Q368=0 Q374=0 Q367=0 Q207=500 Q351=+1 Q201=-6 Q202=3 Q206=150 Q200=2 Q203=+0 Q204=50';
const P256 = 'Q218=40 Q424=60 Q219=30 Q425=50 Q220=0 Q368=0 Q224=0 Q367=0 Q207=500 Q351=+1 Q201=-6 Q202=3 Q206=150 Q200=2 Q203=+0 Q204=50';
const P257 = 'Q223=40 Q222=50 Q368=0 Q207=500 Q351=+1 Q201=-4 Q202=4 Q206=150 Q200=2 Q203=+0 Q204=50';
const P232 = 'Q389=0 Q225=0 Q226=0 Q227=0 Q386=-2 Q218=100 Q219=50 Q202=1 Q207=500 Q200=2 Q204=50';

const SUB100 = 'o100 sub\nG1 X5 Z0\nG1 Z-10\nG1 X10 Z-20\nG1 X15\no100 endsub';
/** Z는 한 방향, X는 톱니 — 층마다 포켓 구간이 많다 */
const teeth = (n: number): string => {
  const out = ['o100 sub', 'G1 X5 Z0'];
  for (let k = 1; k <= n; k++) out.push(`G1 X${k % 2 ? 9 : 5} Z-${(k * 0.1).toFixed(1)}`);
  out.push(`G1 X15 Z-${((n + 1) * 0.1).toFixed(1)}`, 'o100 endsub');
  return out.join('\n');
};
const nurbsCtrl = (n: number): string => {
  const out: string[] = [];
  for (let k = 1; k <= n; k++) out.push(`X${(1e7 * Math.cos(k * 2)).toFixed(3)} Y${(1e7 * Math.sin(k * 2)).toFixed(3)}`);
  return out.join('\n');
};

/** 반복이 아주 많지만 고치기 전에도 끝까지 도는 값: 한도를 넘게 쌓았다 */
const MANY: [string, Run][] = [
  ['G81 반복 L', fanuc('G21 G90 G17\nG91 G81 X1 Z-1 R1 F100 L100000\nG80\nG90\nG0 X99\nM2')],
  ['G81 반복 K', fanuc('G21 G90 G17\nG91 G81 X1 Z-1 R1 F100 K100000\nG80\nG90\nG0 X99\nM2')],
  ['G81 반복 L(좌표 회전)', fanuc('G21 G90 G17\nG68 X0 Y0 R30\nG91 G81 X1 Z-1 R1 F100 L100000\nG80\nG90\nG0 X99\nM2')],
  ['G83 작은 Q × 반복 L', fanuc('G21 G90 G17\nG0 X0 Y0 Z1\nG91 G83 X1 Z-10 R1 Q0.001 F100 L1000\nG80\nG90\nG0 X99\nM2')],
  ['Haas G70 구멍 수 L', haas('G21 G17\nG0 X0 Y0 Z1\nG81 Z-1 R0.5 F100 L0\nG70 I10 J0 L100000\nG80\nG0 X99\nM2')],
  ['Haas G71 구멍 수 L', haas('G21 G17\nG0 X0 Y0 Z1\nG81 Z-1 R0.5 F100 L0\nG71 I10 J0 K1 L100000\nG80\nG0 X99\nM2')],
  ['Haas G72 구멍 수 L', haas('G21 G17\nG0 X0 Y0 Z1\nG81 Z-1 R0.5 F100 L0\nG72 I1 J0 L100000\nG80\nG0 X99\nM2')],
  ['G12 반복 L', haas('G21 G17\nG0 X0 Y0 Z1\nG91 G12 I10 Z-0.001 L100000 F100\nG90\nG0 X99\nM2')],
  ['G5.3 NURBS 조각', linuxcnc(`G21 G17 G90\nG0 X0 Y0 Z1\nG1 F100\nG5.2 X10 Y10000000 L3\n${nurbsCtrl(60)}\nG5.3\nG0 X99\nM2`)],
  ['선반 G73 횟수 R', lathe('G21 G18\nG0 X40 Z5\nG73 U2 W0 R100000\nG73 P10 Q20 U0.1 W0.1 F0.2\nN10 G1 X10 Z0\nG1 Z-10\nN20 G1 X20\nG0 X99\nM30')],
  ['선반 G74 작은 옮김 P', lathe('G21 G18\nG0 X0 Z5\nG74 R1\nG74 X100 Z-10 P1 Q1000 F0.1\nG0 X99\nM30')],
  ['선반 G75 작은 옮김 Q', lathe('G21 G18\nG0 X50 Z5\nG75 R1\nG75 X40 Z-100 P1000 Q1 F0.1\nG0 X99\nM30')],
  ['선반 G76 다듬질 횟수 P', lathe('G21 G18\nG0 X30 Z5\nG76 P1000000060 Q100 R0.05\nG76 X26 Z-20 P1000 Q300 F1.5\nG0 X99\nM30')],
  ['LinuxCNC G70 횟수 P', llathe(`G18 G21 G8\nG0 X15 Z2\n${SUB100}\nG70 Q100 X15 Z2 D1 E0 P100000\nG0 X99\nM2`)],
  ['LinuxCNC G71 톱니 윤곽·작은 I', llathe(`G18 G21 G8\nG0 X9.5 Z2\n${teeth(40)}\nG71 Q100 D0 I0.01 R0.1 F0.2\nG0 X99\nM2`)],
  ['HOLES1 NUM', siemens('G17 G90 G71\nG0 X0 Y0 Z50\nMCALL CYCLE81(10, 0, 2, -5)\nHOLES1(0, 0, 0, 10, 1, 100000)\nMCALL\nG0 X99\nM30')],
  ['HOLES2 NUM', siemens('G17 G90 G71\nG0 X0 Y0 Z50\nMCALL CYCLE81(10, 0, 2, -5)\nHOLES2(0, 0, 20, 0, 0, 100000)\nMCALL\nG0 X99\nM30')],
  ['HOLES1 NUM(MCALL 없음)', siemens('G17 G90 G71\nG0 X0 Y0 Z50\nHOLES1(0, 0, 0, 10, 1, 100000)\nG0 X99\nM30')],
  ['CYCL DEF 221 줄·칸', grid('1000', '1000')],
  ['CYCL DEF 220 점', circle('100000')],
  ['CYCL DEF 251 작은 Q370', cyc(251, `${P251} Q370=0.0001`)],
  ['CYCL DEF 251 작은 Q202', cyc(251, 'Q218=60 Q219=40 Q220=10 Q368=0 Q207=500 Q351=+1 Q201=-10 Q202=0.001 Q206=150 Q200=2 Q203=+0 Q204=50 Q370=1')],
  ['CYCL DEF 252 작은 Q370', cyc(252, `${P252} Q370=0.0001`)],
  ['CYCL DEF 253 작은 Q370', cyc(253, `${P253} Q370=0.0001`, 2)],
  ['CYCL DEF 256 작은 Q370', cyc(256, `${P256} Q370=0.0001`)],
  ['CYCL DEF 257 작은 Q370', cyc(257, `${P257} Q370=0.0001`)],
  ['CYCL DEF 232 작은 Q370', cyc(232, `${P232} Q370=0.0001`)],
];

/** 고치기 전에는 메모리를 다 쓰거나 끝나지 않던 값(좌표에 더해도 값이 안 바뀌는 간격, 길이 0 이동만 만드는 반복 포함) */
const HUGE: [string, Run][] = [
  ['G81 반복 L 20억', fanuc('G21 G90 G17\nG91 G81 X1 Z-1 R1 F100 L2000000000\nG80\nG90\nG0 X99\nM2')],
  ['G81 길이 0 반복', fanuc('G21 G90 G17\nG0 X0 Y0 Z1\nG81 X0 Y0 Z1 R1 F100 L2000000000\nG80\nG0 X99\nM2')],
  ['Haas G70 구멍 수 20억', haas('G21 G17\nG0 X0 Y0 Z1\nG81 Z-1 R0.5 F100 L0\nG70 I10 J0 L2000000000\nG80\nG0 X99\nM2')],
  ['Haas G70 길이 0 구멍', haas('G21 G17\nG0 X0 Y0 Z0.5\nG81 Z0.5 R0.5 F100 L0\nG70 I0 J0 L2000000000\nG80\nG0 X99\nM2')],
  ['G12 반복 20억', haas('G21 G17\nG0 X0 Y0 Z1\nG91 G12 I10 Z-0.001 L2000000000 F100\nG90\nG0 X99\nM2')],
  ['선반 G73 횟수 20억', lathe('G21 G18\nG0 X40 Z5\nG73 U2 W0 R2000000000\nG73 P10 Q20 U0.1 W0.1 F0.2\nN10 G1 X10 Z0\nG1 Z-10\nN20 G1 X20\nG0 X99\nM30')],
  ['선반 G74 더해도 안 바뀌는 옮김', lathe('G21 G18\nG0 X100 Z5\nG74 R1\nG74 X90 Z-10 P0.00000000000000000001 Q1000 F0.1\nG0 X99\nM30')],
  ['선반 G76 다듬질 횟수 1조', lathe('G21 G18\nG0 X30 Z5\nG76 P99999999999990060 Q100 R0.05\nG76 X26 Z-20 P1000 Q300 F1.5\nG0 X99\nM30')],
  ['LinuxCNC G70 횟수 20억', llathe(`G18 G21 G8\nG0 X15 Z2\n${SUB100}\nG70 Q100 X15 Z2 D1 E0 P2000000000\nG0 X99\nM2`)],
  ['HOLES1 NUM 20억', siemens('G17 G90 G71\nG0 X0 Y0 Z50\nMCALL CYCLE81(10, 0, 2, -5)\nHOLES1(0, 0, 0, 10, 1, 2000000000)\nMCALL\nG0 X99\nM30')],
  ['HOLES2 길이 0 자리', siemens('G17 G90 G71\nG0 X0 Y0 Z50\nHOLES2(0, 0, 0, 0, 0, 2000000000)\nG0 X99\nM30')],
  ['CYCL DEF 221 100억 점', grid('100000', '100000')],
  ['CYCL DEF 220 20억 점', circle('2000000000')],
  ['CYCL DEF 251 더해도 안 바뀌는 간격', cyc(251, `${P251} Q370=0.00000000000000000000000000000000000001`)],
  ['CYCL DEF 252 아주 작은 Q370', cyc(252, `${P252} Q370=0.000000001`)],
  ['CYCL DEF 253 아주 작은 Q370', cyc(253, `${P253} Q370=0.000000001`, 2)],
  ['CYCL DEF 256 아주 작은 Q370', cyc(256, `${P256} Q370=0.000000001`)],
  ['CYCL DEF 257 아주 작은 Q370', cyc(257, `${P257} Q370=0.000000001`)],
  ['CYCL DEF 232 아주 작은 Q370', cyc(232, `${P232} Q370=0.000000001`)],
];

const stopsAtLimit = (name: string, run: Run): void => {
  const t0 = performance.now();
  const p = run({ maxMoves: LIMIT });
  const ms = performance.now() - t0;
  expect(ms, name).toBeLessThan(2000);
  expect(p.moves.count, name).toBeLessThanOrEqual(LIMIT);
  expect(p.warnings.filter((w) => w.includes(`이동이 ${LIMIT}개를 넘어 나머지는 읽지 않음`)).length, name).toBe(1);
  // 다음 줄(X99로 가는 블록)은 읽지 않는다
  if (p.moves.count) expect(moveEnd(p.moves, p.moves.count - 1)[0], name).not.toBe(99);
};

describe('한 블록 안 반복의 이동 한도', () => {
  // 반복이 많은 사이클은 한도에서 멈추고 그 줄에서 한 번 경고, 다음 줄은 읽지 않는다
  it.each(MANY)('많은 반복: %s', stopsAtLimit);

  // 아주 큰 반복 수, 좌표에 더해도 값이 안 바뀌는 간격, 길이 0 이동만 만드는 반복도 시간 안에 멈춘다
  it.each(HUGE)('극단값: %s', stopsAtLimit);

  it('한도 안이면 이동이 그대로다(반복 수·이동 수가 한도와 같거나 조금 작아도 다음 줄을 읽는다)', () => {
    const text = (n: number): string => `G21 G90 G17\nG91 G81 X1 Z-1 R1 F100 L${n}\nG80\nG90\nG0 X99\nM2`;
    const free = fanuc(text(10))({ maxMoves: 8_000_000 });
    const near = fanuc(text(10))({ maxMoves: free.moves.count + 1 });
    expect(near.moves.count).toBe(free.moves.count);
    expect(near.warnings).toEqual(free.warnings);
    expect(moveEnd(near.moves, near.moves.count - 1)[0]).toBe(99);
    // 마지막 이동으로 한도에 닿으면 그 뒤 줄이 없어도 지금처럼 경고한다
    const exact = fanuc(text(10))({ maxMoves: free.moves.count });
    expect(exact.moves.count).toBe(free.moves.count);
    expect(exact.warnings.filter((w) => w.includes('나머지는 읽지 않음')).length).toBe(1);
  });

  it('구멍 자리는 멈춘 곳까지 그대로다(HOLES1 앞 몇 구멍, 볼트 패턴 앞 몇 구멍)', () => {
    const go = siemens('G17 G90 G71\nG0 X0 Y0 Z50\nMCALL CYCLE81(10, 0, 2, -5)\nHOLES1(0, 0, 0, 10, 5, 100000)\nMCALL\nG0 X99\nM30');
    const p = go({ maxMoves: 200 });
    expect(p.holes.count).toBeGreaterThan(10);
    for (let k = 0; k < p.holes.count; k++) expect(p.holes.top[k * 3]).toBeCloseTo(10 + k * 5, 9);
    const h = haas('G21 G17\nG0 X0 Y0 Z1\nG81 Z-1 R0.5 F100 L0\nG70 I10 J0 L100000\nG80\nG0 X99\nM2')({ maxMoves: 200 });
    expect(h.holes.count).toBeGreaterThan(10);
    for (let k = 0; k < h.holes.count; k++) {
      const a = (k * 2 * Math.PI) / 100000;
      expect(h.holes.top[k * 3]).toBeCloseTo(10 * Math.cos(a), 9);
      expect(h.holes.top[k * 3 + 1]).toBeCloseTo(10 * Math.sin(a), 9);
    }
  });

  it('선반 G76 다듬질 되풀이: 절입 뒤 같은 깊이를 m - 1번 더(한도 안에서는 예전과 같다)', () => {
    const passes = (m: string): number[] => {
      const p = lathe(`G21 G18\nG0 X30 Z5\nG76 P${m}0060 Q100 R0.05\nG76 X26 Z-20 P1000 Q300 F1.5\nM30`)({ maxMoves: 8_000_000 });
      const xs: number[] = [];
      for (let i = 1; i < p.moves.count; i += 4) xs.push(Math.round(moveEnd(p.moves, i)[0] * 1000) / 1000);
      return xs;
    };
    const one = passes('01');
    const three = passes('03');
    expect(three.length).toBe(one.length + 2);
    expect(three.slice(0, one.length)).toEqual(one);
    expect(three.slice(-3)).toEqual([13, 13, 13]);
  });

  it('g7xRough: maxMoves까지만 쌓고 capped, 주지 않으면 그대로', () => {
    // 톱니 윤곽(u = Z, v = X): 층마다 구간이 많다
    const pts: number[] = [0, 5];
    for (let k = 1; k <= 41; k++) pts.push(-k * 0.1, k % 2 ? 9 : 5);
    const S: [number, number] = [2, 9.5];
    const free = g7xRough(pts, S, 1, -1, 0.01, 0.1, 0);
    expect(free.capped).toBe(false);
    expect(free.moves.length).toBeGreaterThan(5000);
    const cut = g7xRough(pts, S, 1, -1, 0.01, 0.1, 0, undefined, 1000);
    expect(cut.capped).toBe(true);
    expect(cut.moves.length).toBeLessThanOrEqual(1000);
    // 위 층부터 같은 층을 깎는다(구간을 그만큼만 모으므로 뒤쪽 포켓 차례는 예전과 다를 수 있다 — 어차피 그 줄에서 읽기를 멈춘다)
    expect(cut.moves.slice(0, 4)).toEqual(free.moves.slice(0, 4));
    expect(g7xRough(pts, S, 1, -1, 0.01, 0.1, 0, undefined, free.moves.length * 4).capped).toBe(false);
  });

  it('nurbsSegments: emit이 false면 거기서 멈추고, 값을 돌려주지 않으면 끝까지', () => {
    const xs = [0, 10, 20, 30];
    const ys = [0, 10, -10, 0];
    const ws = [1, 1, 1, 1];
    let all = 0;
    nurbsSegments(xs, ys, ws, 3, 0.001, () => {
      all++;
    });
    expect(all).toBeGreaterThan(10);
    let some = 0;
    nurbsSegments(xs, ys, ws, 3, 0.001, () => ++some < 5);
    expect(some).toBe(5);
  });

  it('이미 막혀 있는 자리: 작은 Q·절입·피치, 큰 바퀴 수, 부프로그램 반복은 한 블록에서 끝이 있다', () => {
    const ok: [string, Run, number][] = [
      ['G83 Q 1e-5', fanuc('G21 G90 G17\nG0 X0 Y0 Z1\nG83 X0 Y0 Z-100 R1 Q0.00001 F100\nG80\nM2'), 30_002],
      ['선반 G71 U 1e-5', lathe('G21 G18\nG0 X40 Z5\nG71 U0.00001 R0.1\nG71 P10 Q20 U0.1 W0.1 F0.2\nN10 G1 X10 Z0\nG1 Z-10\nN20 G1 X20\nM30'), 40_100],
      ['G2 P 20억 바퀴', linuxcnc('G21 G17 G90\nG0 X0 Y0 Z1\nG2 X0 Y0 I10 Z0 P2000000000 F100\nM2'), 3],
      ['CYCL 200 Q202 1e-5', cyc(200, 'Q200=2 Q201=-100 Q206=100 Q202=0.00001 Q203=+0 Q204=20'), 30_010],
      ['CYCL 208 피치 1e-10', cyc(208, 'Q200=2 Q201=-10 Q206=100 Q334=0.0000000001 Q203=+0 Q204=20 Q335=30 Q207=500 Q351=+1 Q370=0.5'), 12],
    ];
    for (const [name, run, most] of ok) {
      const p = run({ maxMoves: 8_000_000 });
      expect(p.moves.count, name).toBeLessThanOrEqual(most);
      expect(p.warnings.some((w) => w.includes('나머지는 읽지 않음')), name).toBe(false);
    }
    // 블록을 되풀이하는 반복은 실행 블록 한도가 막는다(한 블록 안 반복이 아니다)
    const blocks: [string, NcProgram][] = [
      ['M98 L', parseGcode('O0001\nG21\nM98 P100 L2000000000\nM30\nO100\nM99', { dialect: 'fanuc', maxBlocks: 20000 })],
      ['G65 L', parseGcode('O0001\nG21\nG65 P100 L2000000000\nM30\nO100\nM99', { dialect: 'fanuc', maxBlocks: 20000 })],
      ['Siemens REPEAT P', parseSiemens(makeSource('G17 G90\nA1: G0 X1\nB1: G0 X2\nREPEAT A1 B1 P=2000000000\nM30'), { maxBlocks: 20000 })],
      ['Heidenhain CALL LBL REP', parseHeidenhain('0 BEGIN PGM P MM\n1 LBL 1\n2 L X+1 FMAX\n3 L X+2 FMAX\n4 CALL LBL 1 REP 2000000000/2000000000\n99 END PGM P MM\n', { maxBlocks: 20000 })],
    ];
    for (const [name, p] of blocks) expect(p.warnings.some((w) => w.includes('실행 블록이')), name).toBe(true);
  });
});

describe('MPR 구멍 줄 개수 AN', () => {
  const head = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n<100 \\WerkStck\\\nLA="200"\nBR="100"\nDI="19"\n`;
  const vert = (an: string, x = 50): string => `<102 \\BohrVert\\\nXA="${x}"\nYA="50"\nTI="10"\nDU="8"\nAN="${an}"\nAB="1"\nWI="0"\n`;
  const horiz = (an: string): string => `<103 \\BohrHoriz\\\nXA="0"\nYA="50"\nZA="9"\nTI="10"\nDU="8"\nBM="XP"\nAN="${an}"\nAB="1"\n`;
  const count = (p: ReturnType<typeof parseMpr>): number => p.operations.reduce((n, o) => n + ('holes' in o ? o.holes.length : 0), 0);

  it('아주 큰 AN도 시간 안에 파일 전체 100,000개까지 그리고 경고한다', () => {
    for (const macro of [vert('2000000000'), horiz('2000000000')]) {
      const t0 = performance.now();
      const p = parseMpr(`${head}${macro}!\n`);
      expect(performance.now() - t0).toBeLessThan(2000);
      expect(count(p)).toBe(100_000);
      expect(p.stats.holes).toBe(100_000);
      expect(p.warnings.filter((w) => w.includes('구멍이 100000개를 넘어 거기까지 그림')).length).toBe(1);
    }
  });

  it('줄마다가 아니라 파일 전체로 센다, 한도 안이면 경고가 없다', () => {
    const p = parseMpr(`${head}${vert('60000')}${vert('60000', 60)}${vert('5', 70)}!\n`);
    expect(count(p)).toBe(100_000);
    expect(p.warnings.filter((w) => w.includes('거기까지 그림')).length).toBe(1);
    const ok = parseMpr(`${head}${vert('60000')}${vert('40000', 60)}!\n`);
    expect(count(ok)).toBe(100_000);
    expect(ok.warnings.some((w) => w.includes('거기까지 그림'))).toBe(false);
  });

  it('새 경고는 네 언어로 옮긴다', () => {
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate('구멍이 100000개를 넘어 거기까지 그림', code), code).not.toMatch(/[가-힣]/);
    expect(translate('구멍이 100000개를 넘어 거기까지 그림', 'en')).toBe('More than 100000 holes — drawn up to that limit');
  });
});
