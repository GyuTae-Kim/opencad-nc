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
import { MoveBuilder, moveEnd, type NcProgram } from '../src/model';
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

  it('g7xRough: 이동을 넘겨받는 함수가 false를 돌려주면 거기서 멈춘다, 주지 않으면 그대로 모은다', () => {
    // 톱니 윤곽(u = Z, v = X): 층마다 구간이 많다
    const pts: number[] = [0, 5];
    for (let k = 1; k <= 41; k++) pts.push(-k * 0.1, k % 2 ? 9 : 5);
    const S: [number, number] = [2, 9.5];
    const free = g7xRough(pts, S, 1, -1, 0.01, 0.1, 0);
    expect(free.capped).toBe(false);
    expect(free.moves.length).toBeGreaterThan(5000);
    const got: { rapid: boolean; u: number; v: number }[] = [];
    const cut = g7xRough(pts, S, 1, -1, 0.01, 0.1, 0, undefined, (rapid, u, v) => {
      got.push({ rapid, u, v });
      return got.length < 3000;
    });
    expect(cut.capped).toBe(false);
    expect(cut.moves).toEqual([]);
    // 끊어도 전체 계획의 앞부분이다(포켓 차례 포함 — 열린 구간이 앞이라 3,000개면 포켓까지 들어간다)
    expect(got).toEqual(free.moves.slice(0, 3000));
  });

  it('g7xRough: 구간 상한은 메모리 보호이고 그 part에서 이동을 만드는 구간만 센다', () => {
    const pts: number[] = [0, 5];
    for (let k = 1; k <= 41; k++) pts.push(-k * 0.1, k % 2 ? 9 : 5);
    const S: [number, number] = [2, 9.5];
    const rough = (part: 0 | 1 | 2, maxRuns?: number) => g7xRough(pts, S, 1, -1, 0.01, 0.1, part, undefined, undefined, maxRuns);
    const all = rough(0);
    const open = rough(1);
    const pocket = rough(2);
    const opens = open.moves.length / 4;
    const pockets = (pocket.moves.length - 2) / 5;
    expect(opens).toBeGreaterThan(10);
    expect(pockets).toBeGreaterThan(100);
    expect(all.moves.length).toBe(open.moves.length + pocket.moves.length);
    // G7x.1은 포켓을, G7x.2는 열린 구간을 세지 않는다: 만드는 구간 수와 같은 상한이면 그대로
    expect(rough(1, opens).capped).toBe(false);
    expect(rough(1, opens).moves).toEqual(open.moves);
    expect(rough(2, pockets).capped).toBe(false);
    expect(rough(2, pockets).moves).toEqual(pocket.moves);
    expect(rough(0, opens + pockets).capped).toBe(false);
    expect(rough(0, opens + pockets).moves).toEqual(all.moves);
    // 상한을 넘으면 알린다
    expect(rough(0, 20).capped).toBe(true);
    expect(rough(2, 20).capped).toBe(true);
    expect(rough(1, 2).capped).toBe(true);
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

/**
 * 이동을 쌓는 자리의 한도: 한 이동이 여러 이동이 되는 길(모서리 다듬기, 회전축 감기, 도그레그, 곡선을 나눈 조각)도 한도를 넘지 않는다.
 * 프로그램마다 한도 1부터 전체 이동 수 + 1까지 모두 돌려, 이동 수·경고·멈춘 줄·값·호 표·시간을 본다
 */
describe('이동을 쌓는 자리의 한도', () => {
  const FREE = 8_000_000;
  const sie = (mid: string): Run => siemens(`G17 G90 G71\nG0 X0 Y0 Z0\n${mid}\nG0 X99\nM30`);
  const rot = (text: string): Run => (o) => parseGcode(text, { dialect: 'fanuc', initialPosition: [0, 0, 50], rotary: true, ...o });
  const dog = (text: string): Run => (o) => parseGcode(text, { dialect: 'fanuc', initialPosition: [0, 0, 50], machine: { dogleg: true }, ...o });

  /** 뒤 이동이 없어 다듬지 못한 모서리가 끝에 남을 수 있는 프로그램은 true(그 마지막 이동만 끝점이 전체 경로와 다르다) */
  const PROGRAMS: [string, Run, boolean][] = [
    ['Siemens RND 직선-직선', sie('G1 X10 Y0 RND=2 F100\nG1 X10 Y10\nG1 X20 Y10'), true],
    ['Siemens CHF 직선-직선', sie('G1 X10 Y0 CHF=2 F100\nG1 X10 Y10\nG1 X20 Y10'), true],
    ['Siemens CHR 직선-직선', sie('G1 X10 Y0 CHR=2 F100\nG1 X10 Y10\nG1 X20 Y10'), true],
    ['Siemens RND 직선-원호', sie('G1 X10 Y0 RND=2 F100\nG3 X20 Y10 I10 J0\nG1 X30 Y10'), true],
    ['Siemens CHF 직선-원호', sie('G1 X10 Y0 CHF=2 F100\nG3 X20 Y10 I10 J0\nG1 X30 Y10'), true],
    ['Siemens RND 원호-원호', sie('G2 X10 Y10 I10 J0 RND=1 F100\nG2 X20 Y20 I10 J0\nG1 X30 Y20'), true],
    ['Siemens RNDM 모달', sie('RNDM=2\nG1 X10 Y0 F100\nG1 X10 Y10\nG1 X20 Y10\nRNDM=0'), true],
    ['Heidenhain RND', heidenhain('1 L X+0 Y+0 Z+0 FMAX\n2 L X+10 Y+0 F100\n3 RND R2\n4 L X+10 Y+10\n5 L X+20 Y+10\n6 L X+99 FMAX'), true],
    ['Heidenhain CHF', heidenhain('1 L X+0 Y+0 Z+0 FMAX\n2 L X+10 Y+0 F100\n3 CHF 2\n4 L X+10 Y+10\n5 L X+20 Y+10\n6 L X+99 FMAX'), true],
    ['Heidenhain RND 좌표 회전', heidenhain('1 L X+0 Y+0 Z+0 FMAX\n2 CYCL DEF 10.0 DREHUNG\n3 CYCL DEF 10.1 ROT+30\n4 L X+10 Y+0 F100\n5 RND R2\n6 L X+10 Y+10\n7 L X+20 Y+10\n8 L X+99 FMAX'), true],
    ['Heidenhain RND 직선-원호 좌표 회전', heidenhain('1 L X+0 Y+0 Z+0 FMAX\n2 CYCL DEF 10.0 DREHUNG\n3 CYCL DEF 10.1 ROT+30\n4 L X+10 Y+0 F100\n5 RND R2\n6 CC X+20 Y+0\n7 C X+20 Y+10 DR-\n8 L X+99 FMAX'), true],
    ['회전축 직선', rot('G21\nG0 X0 Y0 Z10\nG1 X10 A90 F100\nG1 X20\nG0 X99\nM30'), false],
    ['회전축 호', rot('G21\nG0 X0 Y0 Z10\nG2 X20 Y0 I10 J0 A90 F100\nG1 X30\nG0 X99\nM30'), false],
    ['회전축 급속', rot('G21\nG0 X0 Y0 Z10\nG0 X10 A90\nG1 X20 F100\nG0 X99\nM30'), false],
    ['회전축 Siemens 모서리는 그대로', (o) => parseSiemens(makeSource('G17 G90 G71\nG0 X0 Y0 Z10 A0\nG1 X10 RND=2 F100\nG1 Y10 A90\nG0 X99\nM30'), { initialPosition: [0, 0, 50], rotary: true, ...o }), false],
    ['도그레그 급속', dog('G21\nG0 X0 Y0 Z10\nG0 X10 Y20 Z30\nG1 X20 F100\nG0 X99\nM30'), false],
    ['좌표 회전 평면과 다른 평면의 원호(조각)', siemens('G17 G90 G71\nG0 X0 Y0 Z10\nROT X30\nG2 X0 Y0 I10 F100\nROT\nG0 X99\nM30'), false],
    ['Heidenhain 출력 변환 평면과 다른 원호(조각)', heidenhain('1 TOOL CALL 1 Z S1000\n2 L X+10 Y+0 Z+0 FMAX\n3 CYCL DEF 10.0 DREHUNG\n4 CYCL DEF 10.1 ROT+30\n5 TOOL CALL 2 Y S1000\n6 CC Z+0 X+0\n7 C Z+0 X-10 DR+ F100\n8 L X+99 FMAX'), false],
    ['LinuxCNC G5 스플라인', linuxcnc('G21 G17 G90\nG0 X0 Y0 Z1\nG5 I30 J30 P-30 Q30 X60 Y0 F100\nG0 X99\nM2'), false],
    ['LinuxCNC G5.2 NURBS', linuxcnc('G21 G17 G90\nG0 X0 Y0 Z1\nG1 F100\nG5.2 X10 Y100 L3\nX20 Y-100\nX30 Y100\nX40 Y-100\nX50 Y0\nG5.3\nG0 X99\nM2'), false],
    ['G83 쪼기', fanuc('G21 G90 G17\nG0 X0 Y0 Z5\nG83 X0 Y0 Z-10 R1 Q2 F100\nG80\nG0 X99\nM2'), false],
    ['Heidenhain 251', cyc(251, `${P251} Q370=0.5`), false],
    ['Siemens POCKET3', siemens('G17 G90 G71\nT1 D1\nG0 X0 Y0 Z50\nPOCKET3(10, 0, 2, -4, 40, 30, 5, 0, 0, 0, 2, 0, 0, 500, 100, 0, 11, 0)\nG0 X99\nM30'), false],
    ['선반 G71', lathe('G21 G18\nG0 X40 Z5\nG71 U2 R0.5\nG71 P10 Q20 U0 W0 F0.2\nN10 G1 X10 Z0\nG1 Z-10\nN20 G1 X20\nG0 X99\nM30'), false],
    ['LinuxCNC G71 원호 윤곽', llathe(`G18 G21 G8\nG0 X15 Z2\n${SUB100}\nG71 Q100 D0.5 I2 R0.5 F0.2\nG0 X99\nM2`), false],
    ['LinuxCNC G71 톱니', llathe(`G18 G21 G8\nG0 X9.5 Z2\n${teeth(8)}\nG71 Q100 D0 I0.5 R0.1 F0.2\nG0 X99\nM2`), false],
    ['LinuxCNC G71.1 톱니', llathe(`G18 G21 G8\nG0 X9.5 Z2\n${teeth(8)}\nG71.1 Q100 D0 I0.2 R0.1 F0.2\nG0 X99\nM2`), false],
    ['LinuxCNC G71.2 톱니', llathe(`G18 G21 G8\nG0 X9.5 Z2\n${teeth(8)}\nG71.2 Q100 D0 I0.5 R0.1 F0.2\nG0 X99\nM2`), false],
    ['LinuxCNC G71 물러남 0(길이 0 계획 이동)', llathe(`G18 G21 G8\nG0 X9.5 Z2\n${teeth(8)}\nG71 Q100 D0 I0.5 R0 F0.2\nG0 X99\nM2`), false],
  ];

  const ends = (p: NcProgram): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i));
    return out;
  };
  const OVER = (n: number): string => `이동이 ${n}개를 넘어 나머지는 읽지 않음`;

  it.each(PROGRAMS)('한도마다: %s', (name, run, cornerEnd) => {
    const full = run({ maxMoves: FREE });
    const n = full.moves.count;
    expect(n, name).toBeGreaterThan(2);
    const fe = ends(full);
    for (let limit = 1; limit <= n + 1; limit++) {
      const label = `${name} 한도 ${limit}`;
      const p = run({ maxMoves: limit });
      const m = p.moves;
      // 이동 수는 어떤 경우에도 한도를 넘지 않고, 전체 이동이 한도보다 많으면 한도까지 꼭 찬다
      expect(m.count, label).toBe(Math.min(limit, n));
      // 경고는 한 번(한도가 전체보다 크면 없음)
      expect(p.warnings.filter((w) => w.includes(OVER(limit))).length, label).toBe(limit <= n ? 1 : 0);
      // 한도가 전체보다 하나만 커도 전체와 같다(경고까지)
      if (limit > n) expect(p.warnings, label).toEqual(full.warnings);
      const e = ends(p);
      for (let i = 0; i < m.count; i++) {
        // 뒤 블록은 실행하지 않았다: 줄·종류가 전체 경로의 앞부분 그대로
        expect(m.line[i], `${label} 이동 ${i} 줄`).toBe(full.moves.line[i]);
        expect(m.kind[i], `${label} 이동 ${i} 종류`).toBe(full.moves.kind[i]);
        const last = i === m.count - 1;
        if (last && cornerEnd) continue;
        for (let a = 0; a < 3; a++) expect(e[i]![a]!, `${label} 이동 ${i} 끝점`).toBeCloseTo(fe[i]![a]!, 6);
        // 호 표: 번호가 표 안이고 값이 그대로
        if (m.arc[i]! >= 0) {
          expect(m.arc[i]!, `${label} 이동 ${i} 호 번호`).toBeLessThan(p.arcs.count);
          expect(p.arcs.sweep[m.arc[i]!]!, `${label} 이동 ${i} 중심각`).toBeCloseTo(full.arcs.sweep[full.moves.arc[i]!]!, 9);
          for (let a = 0; a < 3; a++) expect(p.arcs.center[m.arc[i]! * 3 + a]!, `${label} 이동 ${i} 중심`).toBeCloseTo(full.arcs.center[full.moves.arc[i]! * 3 + a]!, 9);
        }
      }
      // 쓰지 않는 호가 표에 남지 않는다
      const used = new Set<number>();
      for (let i = 0; i < m.count; i++) if (m.arc[i]! >= 0) used.add(m.arc[i]!);
      expect(p.arcs.count, `${label} 호 표`).toBe(used.size);
      // 시간·공구 이동 수는 쌓인 이동만큼(조각 일부만 쌓여도)
      let t = 0;
      for (let i = 0; i < m.count; i++) t += m.time[i]!;
      expect(Math.abs(t - p.stats.time), `${label} 시간`).toBeLessThan(1e-5 * (1 + p.stats.time));
      expect(p.stats.moveCount, `${label} 이동 수`).toBe(m.count);
      expect(p.tools.reduce((s, x) => s + x.moveCount, 0), `${label} 공구 이동 수`).toBe(m.count);
      // 범위는 쌓인 이동을 담는다
      for (const q of e) for (let a = 0; a < 3; a++) {
        expect(q[a]!, `${label} 범위`).toBeGreaterThanOrEqual(p.bounds!.min[a]! - 1e-6);
        expect(q[a]!, `${label} 범위`).toBeLessThanOrEqual(p.bounds!.max[a]! + 1e-6);
      }
    }
  });

  it('나눠 그리는 원호 프로그램은 조각 길을 지난다(시험이 그 길을 보는지)', () => {
    const tilted = PROGRAMS.filter(([name]) => name.includes('(조각)'));
    expect(tilted.length).toBe(2);
    for (const [name, run] of tilted) {
      const p = run({ maxMoves: FREE });
      expect(p.moves.count, name).toBeGreaterThan(36);
      expect(p.warnings.some((w) => w.includes('다른 평면의 원호는 직선 조각으로 그림')), name).toBe(true);
    }
  });

  it('남은 자리 하나에서 모서리: 앞 이동을 접점까지 줄이고 둥근 호로 끝난다(다음 이동은 넣지 않는다)', () => {
    const run = sie('G1 X10 Y0 RND=2 F100\nG1 X10 Y10\nG1 X20 Y10');
    const p = run({ maxMoves: 3 });
    expect(p.moves.count).toBe(3);
    const near = (q: number[], x: number, y: number): void => {
      expect(q[0]).toBeCloseTo(x, 9);
      expect(q[1]).toBeCloseTo(y, 9);
    };
    near(ends(p)[1]!, 8, 0);
    near(ends(p)[2]!, 10, 2);
    expect(p.warnings.filter((w) => w.includes(OVER(3)))).toEqual([`4번 줄: ${OVER(3)}`]);
  });

  it('남은 자리 하나에서 뒤 요소가 원호면 그 호는 표에서 빠지고 모서리 호는 제 값을 지킨다', () => {
    const run = sie('G1 X10 Y0 RND=2 F100\nG3 X20 Y10 I10 J0\nG1 X30 Y10');
    const full = run({ maxMoves: FREE });
    const p = run({ maxMoves: 3 });
    expect(p.moves.count).toBe(3);
    expect(p.arcs.count).toBe(1);
    expect(p.moves.arc[2]).toBe(0);
    expect(p.arcs.sweep[0]).toBeCloseTo(full.arcs.sweep[full.moves.arc[2]!]!, 12);
    // 원호-원호: 앞 원호는 접점까지 줄고 둥근 호가 표의 다음 자리로 당겨진다
    const both = sie('G2 X10 Y10 I10 J0 RND=1 F100\nG2 X20 Y20 I10 J0\nG1 X30 Y20');
    const whole = both({ maxMoves: FREE });
    expect(whole.arcs.count).toBe(3);
    const q = both({ maxMoves: 3 });
    expect(q.arcs.count).toBe(2);
    expect([q.moves.arc[1], q.moves.arc[2]]).toEqual([0, 1]);
    expect(q.arcs.sweep[1]).toBeCloseTo(whole.arcs.sweep[whole.moves.arc[2]!]!, 12);
  });

  it('모서리를 보류한 채 한도에 닿으면 프로그램이 끝날 때처럼 모서리 그대로 끝난다', () => {
    const p = sie('G1 X10 Y0 RND=2 F100\nG1 X10 Y10')({ maxMoves: 2 });
    expect(p.moves.count).toBe(2);
    expect(ends(p)[1]!.slice(0, 2)).toEqual([10, 0]);
    expect(p.warnings.filter((w) => w.includes(OVER(2))).length).toBe(1);
  });

  it('회전축 이동이 여러 조각이면 남은 자리만큼 쌓고 길이·시간도 그만큼만 센다', () => {
    const run = rot('G21\nG0 X0 Y0 Z10\nG1 X10 A90 F100\nG1 X20\nG0 X99\nM30');
    const full = run({ maxMoves: FREE });
    const p = run({ maxMoves: 11 });
    expect(p.moves.count).toBe(11);
    // 급속 하나 + 45조각 가운데 10조각
    expect(full.moves.count).toBe(48);
    let t = 0;
    for (let i = 1; i < 11; i++) t += full.moves.time[i]!;
    expect(p.stats.feedTime).toBeCloseTo(t, 3);
    expect(p.stats.feedLength).toBeLessThan(full.stats.feedLength);
    expect(p.warnings.filter((w) => w.includes(OVER(11)))).toEqual([`3번 줄: ${OVER(11)}`]);
  });

  it('블록 사이 검사가 닿지 않는 끝맺음(G5.3 없는 NURBS)도 한도에 막히면 경고한다', () => {
    const run = linuxcnc('G21 G17 G90\nG0 X0 Y0 Z1\nG1 F100\nG5.2 X10 Y10 L3\nX20 Y0\nX30 Y10\nX40 Y0\nX50 Y10');
    const full = run({ maxMoves: FREE });
    expect(full.moves.count).toBeGreaterThan(4);
    const p = run({ maxMoves: 3 });
    expect(p.moves.count).toBe(3);
    expect(p.warnings.filter((w) => w.includes(OVER(3))).length).toBe(1);
  });

  it('MoveBuilder: 한도에서 push를 받지 않고 overflow를 켠다, dropArc는 뒤 호를 당기고 그 이동의 번호를 고친다', () => {
    const b = new MoveBuilder([0, 0, 0], 2, 3);
    expect(b.push(0, 1, 0, 0, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(b.full()).toBe(false);
    b.pushArc(0, 0, 0, 0, 1);
    const a = b.pushArc(5, 0, 0, 0, 2);
    const c = b.pushArc(7, 0, 0, 0, 3);
    expect(b.push(1, 2, 0, 0, 0, 0, 0, 0, 0, 0, c)).toBe(1);
    b.dropArc(a);
    expect(b.arcCount).toBe(2);
    expect(b.arc[1]).toBe(a);
    expect(b.arcSweep[a]).toBe(3);
    expect(b.arcCenter[a * 3]).toBe(7);
    b.dropArc(b.arcCount - 1);
    expect(b.arcCount).toBe(1);
    expect(b.push(0, 3, 0, 0, 0, 0, 0, 0, 0, 0)).toBe(2);
    expect(b.overflow).toBe(false);
    expect(b.push(0, 4, 0, 0, 0, 0, 0, 0, 0, 0)).toBe(-1);
    expect(b.count).toBe(3);
    expect(b.overflow).toBe(true);
    expect(b.lastX()).toBe(3);
  });
});

/**
 * 선반 거친 깎기는 쌓은 결과로만 멈춘다: 길이 0 계획 이동은 쌓이지 않고, G7x.1의 포켓과 G7x.2의 열린 구간은 이동을 만들지 않으므로
 * 자리가 남았는데 잘리면 안 된다. 잘릴 때는 전체 경로의 앞부분이 한도까지 쌓인다
 */
describe('선반 G71·G71.1·G71.2 한도', () => {
  const FREE = 8_000_000;
  const run = (text: string, maxMoves = FREE): NcProgram => parseGcode(text, { dialect: 'linuxcnc', lathe: true, initialPosition: [30, 0, 30], maxMoves });
  const over = (p: NcProgram): string[] => p.warnings.filter((w) => w.includes('개를 넘어 나머지는 읽지 않음'));
  const program = (code: string, I: string, R = '0.1', n = 40): string => `G18 G21 G8\nG0 X9.5 Z2\n${teeth(n)}\n${code} Q100 D0 I${I} R${R} F0.2\nG0 X99\nM2`;
  const samePrefix = (p: NcProgram, full: NcProgram, label: string): void => {
    for (let i = 0; i < p.moves.count; i++) {
      expect(p.moves.line[i], `${label} 이동 ${i}`).toBe(full.moves.line[i]);
      expect(p.moves.kind[i], `${label} 이동 ${i}`).toBe(full.moves.kind[i]);
      const a = moveEnd(p.moves, i);
      const b = moveEnd(full.moves, i);
      for (let k = 0; k < 3; k++) expect(a[k], `${label} 이동 ${i}`).toBe(b[k]);
    }
  };

  it.each([
    ['G71', '0.05', '0.1'],
    ['G71.1', '0.05', '0.1'],
    ['G71.2', '0.05', '0.1'],
    ['G71', '0.05', '0'],
    ['G71.2', '0.05', '0'],
  ])('%s I%s R%s: 한도 n + 1은 전체와 같고, 작은 한도는 전체 경로의 앞부분', (code, I, R) => {
    const text = program(code, I, R);
    const full = run(text);
    const n = full.moves.count;
    expect(over(full)).toEqual([]);
    for (const L of [n + 1, n + 2, n + 10, Math.ceil(n * 1.25), n * 2, n * 3]) {
      const p = run(text, L);
      expect(p.moves.count, `한도 ${L}`).toBe(n);
      expect(p.warnings, `한도 ${L}`).toEqual(full.warnings);
      expect(Array.from(p.moves.points), `한도 ${L}`).toEqual(Array.from(full.moves.points));
    }
    const atN = run(text, n);
    expect(atN.moves.count).toBe(n);
    expect(over(atN).length).toBe(1);
    for (const L of [1, 2, 3, 5, 50, 285, 300, Math.floor(n / 4), Math.floor(n / 2), n - 1]) {
      if (L >= n) continue;
      const p = run(text, L);
      expect(p.moves.count, `한도 ${L}`).toBe(L);
      expect(over(p).length, `한도 ${L}`).toBe(1);
      samePrefix(p, full, `한도 ${L}`);
    }
  });

  it('G71.1 작은 윤곽: 전체 27이동, 한도 28·29에서 잘리지 않는다', () => {
    const text = 'G18 G21\nG0 X12 Z2\no300 sub\nG1 X5 Z0\nG1 X8 Z-6\nG1 X6 Z-10\nG1 Z-14\nG1 X10 Z-18\no300 endsub\nG71.1 Q300 I1 R0.5 F0.2\nM2';
    const full = run(text);
    expect(full.moves.count).toBe(27);
    for (const L of [28, 29, 30, 60]) {
      const p = run(text, L);
      expect(p.moves.count, `한도 ${L}`).toBe(27);
      expect(p.warnings, `한도 ${L}`).toEqual(full.warnings);
    }
  });

  it('긴 프로그램 뒤에 오는 평범한 G71.1도 남은 자리만큼 쌓는다', () => {
    const text = `G18 G21 G8\n${teeth(6)}\nG0 X9.5 Z2\nG71.1 Q100 D0 I0.2 R0.1 F0.2\nG0 X99\nM2`;
    const full = run(text);
    for (const extra of [1, 3, 10, 30]) {
      const p = run(text, full.moves.count + extra);
      expect(p.moves.count, `여유 ${extra}`).toBe(full.moves.count);
      expect(over(p), `여유 ${extra}`).toEqual([]);
    }
  });

  it('기본 한도: 층이 1만 개인 G71.1 톱니 윤곽도 끝까지 그린다(한도에 닿지 않는다)', () => {
    const p = run(program('G71.1', '0.0004', '0.1', 500));
    expect(p.moves.count).toBe(40_004);
    expect(over(p)).toEqual([]);
    expect(moveEnd(p.moves, p.moves.count - 1)[0]).toBe(99);
  });

  it('G71 톱니 I0.01, 한도 2000: 포켓까지 전체 경로의 앞부분이 한도까지', () => {
    const text = program('G71', '0.01');
    const full = run(text);
    expect(full.moves.count).toBeGreaterThan(30_000);
    const p = run(text, 2000);
    expect(p.moves.count).toBe(2000);
    expect(over(p).length).toBe(1);
    samePrefix(p, full, '한도 2000');
  });

  it('길이 0 계획 이동이 많아도 시간 안에 끝나고 한도로 잘못 멈추지 않는다', () => {
    // 층 1만 개, 물러남 0, 층 사이 1e-13: 층을 옮기는 이동과 물러나는 이동은 길이 0이라 쌓이지 않는다
    const text = 'G18 G21 G8\nG0 X12 Z2\no100 sub\nG1 X5 Z0\nG1 X5 Z-10\nG1 X15 Z-20\no100 endsub\nG71 Q100 D0 I0.0000000000001 R0 F0.2\nG0 X99\nM2';
    const t0 = performance.now();
    const full = run(text);
    const planned = 40_000;
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(full.moves.count).toBeLessThan(planned);
    expect(over(full)).toEqual([]);
    const p = run(text, full.moves.count + 1);
    expect(p.moves.count).toBe(full.moves.count);
    expect(over(p)).toEqual([]);
  });
});

describe('한도와 블록 실행', () => {
  const FREE = 8_000_000;
  const over = (p: NcProgram): string[] => p.warnings.filter((w) => w.includes('개를 넘어 나머지는 읽지 않음'));

  it('지우는 블록에서 끝나는 G70이 한도에 닿으면 G70 줄에서 멈추고 다음 블록을 실행하지 않는다', () => {
    const text = 'G21 G18\nG0 X40 Z5\nG71 U2 R0.5\nG71 P10 Q20 U0 W0 F0.2\nN10 G1 X10 Z0\nG1 Z-10\n/N20 G1 X20\nG70 P10 Q20\nT0202\nG4 P5000\nG0 X99\nM30';
    const go = (maxMoves: number): NcProgram => parseGcode(text, { dialect: 'fanuc', lathe: true, blockDelete: true, initialPosition: [50, 0, 50], maxMoves });
    const full = go(FREE);
    expect(full.moves.count).toBe(39);
    expect(full.stats.toolChanges).toBe(1);
    for (const L of [37, 38]) {
      const p = go(L);
      expect(p.moves.count, `한도 ${L}`).toBe(L);
      expect(p.stats.toolChanges, `한도 ${L}`).toBe(0);
      expect(p.stats.dwellTime, `한도 ${L}`).toBe(0);
      expect(over(p), `한도 ${L}`).toEqual([`8번 줄: 이동이 ${L}개를 넘어 나머지는 읽지 않음`]);
    }
  });

  it('끝맺음(G5.3 없는 NURBS)에서 한도에 정확히 닿아도 경고한다', () => {
    const text = 'G21 G17 G90\nG0 X0 Y0 Z1\nG1 F100\nG5.2 X10 Y10 L3\nX20 Y0\nX30 Y10\nX40 Y0\nX50 Y10';
    const go = (maxMoves: number): NcProgram => parseGcode(text, { dialect: 'linuxcnc', initialPosition: [0, 0, 50], maxMoves });
    const full = go(FREE);
    expect(full.moves.count).toBe(6);
    expect(over(full)).toEqual([]);
    expect(over(go(7))).toEqual([]);
    const p = go(6);
    expect(p.moves.count).toBe(6);
    expect(over(p).length).toBe(1);
    expect(over(go(5)).length).toBe(1);
  });

  it('한도에서 잘린 쪼기 구멍은 구멍 표에 끝까지 뚫린 것으로 남지 않는다', () => {
    const lowest = (p: NcProgram): number => {
      let z = Infinity;
      for (let i = 0; i < p.moves.count; i++) z = Math.min(z, moveEnd(p.moves, i)[2]);
      return z;
    };
    const cases: [string, Run][] = [
      ['G83', fanuc('G21 G90 G17\nG0 X0 Y0 Z5\nG83 X0 Y0 Z-10 R1 Q2 F100\nG80\nG0 X99\nM2')],
      ['CYCL 200', cyc(200, 'Q200=2 Q201=-10 Q206=100 Q202=2 Q203=+0 Q204=20')],
    ];
    for (const [name, go] of cases) {
      const full = go({ maxMoves: FREE });
      expect(full.holes.count, name).toBe(1);
      const n = full.moves.count;
      for (let L = 1; L < n; L++) {
        const p = go({ maxMoves: L });
        for (let h = 0; h < p.holes.count; h++) expect(lowest(p), `${name} 한도 ${L}`).toBeLessThanOrEqual(p.holes.bottom[h * 3 + 2]! + 1e-9);
      }
      expect(go({ maxMoves: n + 1 }).holes.count, name).toBe(1);
    }
  });

  it('구멍 표는 잘린 이동이 아니라 바닥에 닿았는지로 정한다: 길이 0 꼬리만 막히거나 복귀만 잘린 구멍은 남는다', () => {
    const count = (go: Run, maxMoves: number): number => go({ maxMoves }).holes.count;
    // 꼬리 이동의 길이가 0이고 마지막 구멍의 이동이 한도와 꼭 맞는다
    const h201 = heidenhain('1 L X+0 Y+0 Z+9 FMAX\n2 L Z+2 FMAX\n3 CYCL DEF 201 REIBEN ~\n  Q200=2 ~\n  Q201=-5 ~\n  Q206=100 ~\n  Q203=+0 ~\n  Q204=0\n4 CYCL CALL\n5 L X+10 FMAX\n6 CYCL CALL');
    const g76 = fanuc('G21 G90 G17\nG0 X0 Y0 Z5\nG98 G76 X0 Y0 Z-10 R1 P100 F100 L2\nG80\nM2');
    // 쪼기 1만 번 안전장치가 바닥에 닿기 전에 끝난 구멍도 이동이 다 쌓였으면 전체와 같다
    const guard = fanuc('G21 G90 G17\nG0 X0 Y0 Z1\nG83 X0 Y0 Z-100 R1 Q0.00001 F100\nG80\nG0 X99\nM2');
    expect(h201({ maxMoves: FREE }).moves.count).toBe(6);
    expect(count(h201, FREE)).toBe(2);
    expect(count(h201, 6)).toBe(2);
    expect(g76({ maxMoves: FREE }).moves.count).toBe(7);
    expect(count(g76, 7)).toBe(2);
    expect(count(guard, FREE)).toBe(1);
    expect(count(guard, 30_000)).toBe(1);
    // 바닥까지 뚫고 복귀만 잘린 구멍은 남고, 바닥 전에 잘린 구멍은 빠진다
    const g81 = fanuc('G21 G90 G17\nG0 X0 Y0 Z5\nG81 X0 Y0 Z-10 R1 F100\nG80\nG0 X99\nM2');
    expect(count(g81, 2)).toBe(0);
    expect(count(g81, 3)).toBe(1);
    const g83 = fanuc('G21 G90 G17\nG0 X0 Y0 Z5\nG83 X0 Y0 Z-10 R1 Q2 F100\nG80\nG0 X99\nM2');
    const n83 = g83({ maxMoves: FREE }).moves.count;
    expect(count(g83, 3)).toBe(0);
    // 마지막 두 이동은 복귀와 X99: 그 앞까지 쌓으면 바닥에 닿았다
    expect(count(g83, n83 - 3)).toBe(0);
    expect(count(g83, n83 - 2)).toBe(1);
  });

  it('구멍 바닥은 좌표 변환을 적용해 견준다(Heidenhain 회전 사이클, Siemens 기운 프레임)', () => {
    const rot = heidenhain('1 L X+10 Y+0 Z+9 FMAX\n2 L Z+2 FMAX\n3 CYCL DEF 10.0 DREHUNG\n4 CYCL DEF 10.1 ROT+30\n5 CYCL DEF 201 REIBEN ~\n  Q200=2 ~\n  Q201=-5 ~\n  Q206=100 ~\n  Q203=+0 ~\n  Q204=20\n6 CYCL CALL\n7 L X+99 FMAX');
    const tilt = siemens('G17 G90 G71\nG0 X10 Y0 Z10\nROT X30\nCYCLE81(10, 0, 2, -5)\nROT\nG0 X99\nM30');
    for (const [name, go] of [
      ['Heidenhain', rot],
      ['Siemens', tilt],
    ] as const) {
      const full = go({ maxMoves: FREE });
      expect(full.holes.count, name).toBe(1);
      const b = [full.holes.bottom[0]!, full.holes.bottom[1]!, full.holes.bottom[2]!];
      // 바닥에 닿는 이동의 번호: 그 수까지만 쌓아도 구멍이 남고, 하나 적으면 빠진다
      let at = -1;
      for (let i = 0; i < full.moves.count && at < 0; i++) {
        const e = moveEnd(full.moves, i);
        if (Math.hypot(e[0] - b[0]!, e[1] - b[1]!, e[2] - b[2]!) < 1e-6) at = i;
      }
      expect(at, name).toBeGreaterThan(0);
      expect(go({ maxMoves: at + 1 }).holes.count, name).toBe(1);
      expect(go({ maxMoves: at }).holes.count, name).toBe(0);
    }
  });

  it('쌓지 못한 드릴의 휴지는 시간에 넣지 않는다', () => {
    const go = fanuc('G21 G90 G17\nG0 X0 Y0 Z5\nG82 X0 Y0 Z-10 R1 P9000 F100\nG80\nM2');
    const sum = (p: NcProgram): number => {
      let t = 0;
      for (let i = 0; i < p.moves.count; i++) t += p.moves.time[i]!;
      return t;
    };
    const p = go({ maxMoves: 2 });
    expect(p.stats.dwellTime).toBe(0);
    expect(sum(p)).toBeCloseTo(p.stats.time, 3);
    const q = go({ maxMoves: 3 });
    expect(q.stats.dwellTime).toBe(9);
    expect(sum(q)).toBeCloseTo(q.stats.time, 3);
    expect(go({ maxMoves: FREE }).stats.dwellTime).toBe(9);
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

  it('꺼진 구멍 줄은 켜진 구멍의 한도를 쓰지 않는다, 꺼진 줄끼리도 파일 전체로 막는다', () => {
    const off = (an: string, x = 50): string => vert(an, x).replace('DU="8"', 'DU="8"\nEN="0"');
    const on = (p: ReturnType<typeof parseMpr>): number[] => p.operations.flatMap((o) => ('holes' in o ? [o.holes.length] : []));
    const p = parseMpr(`${head}${off('100000')}${vert('5', 60)}!\n`);
    expect(on(p)).toEqual([100_000, 5]);
    expect(p.stats.holes).toBe(5);
    expect(p.stats.disabled).toBe(1);
    expect(p.warnings.filter((w) => w.includes('거기까지 그림'))).toEqual([]);
    const q = parseMpr(`${head}${vert('100000', 60)}${off('7')}!\n`);
    expect(on(q)).toEqual([100_000, 7]);
    const big = parseMpr(`${head}${off('2000000000')}${off('2000000000', 60)}${vert('5', 70)}!\n`);
    expect(on(big)).toEqual([100_000, 0, 5]);
    expect(big.stats.holes).toBe(5);
    expect(big.warnings.filter((w) => w.includes('구멍이 100000개를 넘어 거기까지 그림')).length).toBe(1);
  });

  it('새 경고는 네 언어로 옮긴다', () => {
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate('구멍이 100000개를 넘어 거기까지 그림', code), code).not.toMatch(/[가-힣]/);
    expect(translate('구멍이 100000개를 넘어 거기까지 그림', 'en')).toBe('More than 100000 holes — drawn up to that limit');
  });
});
