/**
 * 사이클 하나 안의 고정 횟수 안전장치(40차): 아주 작은 절입·간격이 끝나지 않게 쪼기(구멍·자리마다 1만 번)·층(사이클마다 1만 개 안팎)·
 * G12·G13 원(1,000개)·G76 절입(499번)에서 멈추는데, 예전에는 경고 없이 도중에 끝나거나 마지막 층으로 건너뛰었다.
 * 이제 그린 자리는 그대로 두고 그 줄에 사이클 이름과 함께 한 번 경고한다(구멍이 여럿이면 횟수로 묶임). 이동 한도가 먼저 막으면 한도 경고만 남는다.
 * 모두 직접 만든 짧은 합성 프로그램이다.
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { LATHE_LAYER_MAX, PECK_MAX, RING_MAX, THREAD_PASS_MAX, parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import { G7X_MAX_LEVELS, g7xRough } from '../src/lathe-g7x';
import { MOVE_DRILL, moveEnd, type NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';

const fanuc = (text: string, o: Record<string, unknown> = {}): NcProgram => parseGcode(text, { dialect: 'fanuc', initialPosition: [0, 0, 50], ...o });
const haas = (text: string, o: Record<string, unknown> = {}): NcProgram => parseGcode(text, { dialect: 'haas', initialPosition: [0, 0, 50], ...o });
const lathe = (text: string, o: Record<string, unknown> = {}): NcProgram => parseGcode(text, { dialect: 'fanuc', lathe: true, initialPosition: [50, 0, 50], ...o });
const llathe = (text: string, o: Record<string, unknown> = {}): NcProgram => parseGcode(text, { dialect: 'linuxcnc', lathe: true, initialPosition: [30, 0, 30], ...o });
const siemens = (text: string, o: Record<string, unknown> = {}): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], ...o });
const heid = (body: string, o: Record<string, unknown> = {}): NcProgram => parseHeidenhain(`0 BEGIN PGM P MM\n${body}\n99 END PGM P MM\n`, o);
const cyc = (n: number, qs: string, r = 5): string =>
  `1 TOOL DEF 1 L+0 R+${r}\n2 TOOL CALL 1 Z S3000 F500\n3 L Z+50 R0 FMAX\n4 L X+50 Y+40 R0 FMAX\n5 CYCL DEF ${n} TEST ~\n  ${qs.trim().split(/\s+/).join(' ~\n  ')}\n6 CYCL CALL\n7 L X+99 FMAX`;
/** cyc 프로그램에서 CYCL CALL이 있는 줄(1부터 — 앞의 BEGIN PGM 줄을 셈) */
const callLine = (body: string): number => body.split('\n').findIndex((l) => /CYCL CALL/.test(l)) + 2;
const SUB100 = 'o100 sub\nG1 X5 Z0\nG1 Z-10\nG1 X10 Z-20\nG1 X15\no100 endsub';

const PECK = (name: string): string => `${name}: 쪼기가 ${PECK_MAX}번을 넘어 바닥에 닿기 전에 멈춤`;
const guards = (p: NcProgram): string[] => p.warnings.filter((w) => /안전|쪼기가 \d+번|층이 \d+개를 넘어 그 뒤|원이 \d+개를 넘어 그 뒤|나사 절입이 \d+번/.test(w));
const ends = (p: NcProgram): number[][] => Array.from({ length: p.moves.count }, (_, i) => moveEnd(p.moves, i));
const minAxis = (p: NcProgram, a: number): number => Math.min(...ends(p).map((e) => e[a]!));

describe('쪼기 안전장치(구멍·자리마다 1만 번)', () => {
  it('G83 아주 작은 Q: 1만 번 쫀 깊이에서 물러나는 그대로 그리고 그 줄에 경고', () => {
    const p = fanuc('G21 G90 G17\nG0 X0 Y0 Z1\nG83 X0 Y0 Z-100 R1 Q0.00001 F100\nG80\nG0 X99\nM2');
    expect(guards(p)).toEqual([`3번 줄: ${PECK('G83')}`]);
    // 1만 번 × 0.00001 = 0.1만 내려갔다(바닥 -100까지 가지 않는다) — 고치기 전과 같은 그림
    const drills = ends(p).filter((_, i) => p.moves.kind[i] === MOVE_DRILL);
    expect(drills.length).toBe(PECK_MAX);
    expect(Math.min(...drills.map((e) => e[2]!))).toBeCloseTo(0.9, 6);
    // 구멍 표는 예전처럼 바닥 깊이(이동 한도로 잃은 이동이 없어서) — README 남은 일
    expect(p.holes.count).toBe(1);
    expect(p.holes.bottom[2]).toBeCloseTo(-100, 9);
    // 다음 블록은 그대로 읽는다(이동 한도 경고가 아니다)
    expect(moveEnd(p.moves, p.moves.count - 1)[0]).toBe(99);
    expect(p.warnings.some((w) => w.includes('나머지는 읽지 않음'))).toBe(false);
  });

  it('구멍이 여럿이면 경고 하나에 횟수(구멍마다 닿음)', () => {
    const p = fanuc('G21 G90 G17\nG0 X0 Y0 Z1\nG73 X0 Y0 Z-50 R1 Q0.00001 F100\nX10\nX20\nG80\nM2');
    expect(guards(p)).toEqual([`3번 줄: ${PECK('G73')} (모두 3번)`]);
  });

  it('Haas I·J·K 쪼기·Siemens CYCLE83(HOLES1 자리마다)도 사이클 이름으로', () => {
    const h = haas('G21 G17\nG0 X0 Y0 Z1\nG83 Z-100 R1 I0.00001 J0 K0.00001 F100\nG80\nM2');
    expect(guards(h)).toEqual([`3번 줄: ${PECK('G83')}`]);
    const s = siemens('G17 G90 G71\nG0 X0 Y0 Z50\nCYCLE83(10, 0, 2, -100, , , 0.00001, 0, 0, 0, 1, 1)\nG0 X99\nM30');
    expect(guards(s)).toEqual([`3번 줄: ${PECK('CYCLE83')}`]);
    const m = siemens('G17 G90 G71\nG0 X0 Y0 Z50\nMCALL CYCLE83(10, 0, 2, -100, , , 0.00001, 0, 0, 0, 1, 1)\nHOLES1(0, 0, 0, 10, 5, 2)\nMCALL\nG0 X99\nM30');
    expect(guards(m)).toEqual([`4번 줄: ${PECK('CYCLE83')} (모두 2번)`]);
  });

  it('Heidenhain 200·203·205·옛 사이클 1', () => {
    for (const n of [200, 203, 205]) {
      const body = cyc(n, 'Q200=2 Q201=-100 Q206=100 Q202=0.00001 Q203=+0 Q204=20');
      expect(guards(heid(body)), String(n)).toEqual([`${callLine(body)}번 줄: ${PECK(`CYCL DEF ${n}`)}`]);
    }
    const old = heid('1 TOOL CALL 1 Z S1000\n2 L X+0 Y+0 Z+5 FMAX\n3 CYCL DEF 1.0 PECKING\n4 CYCL DEF 1.1 SET UP 2\n5 CYCL DEF 1.2 DEPTH -100\n6 CYCL DEF 1.3 PECKG 0.00001\n7 CYCL DEF 1.4 DWELL 0\n8 CYCL DEF 1.5 F100\n9 CYCL CALL\n10 L X+99 FMAX');
    expect(guards(old)).toEqual([`10번 줄: ${PECK('CYCL DEF 1')}`]);
  });

  it('선반 G74·G75: 자리마다 1만 번', () => {
    const z = lathe('G21 G18\nG0 X0 Z5\nG74 R1\nG74 Z-100 Q1 F0.1\nG0 X99\nM30');
    expect(guards(z)).toEqual([`4번 줄: ${PECK('G74')}`]);
    // 1만 번 × 0.001 = 10만 내려가 Z-5에서 물러난다
    expect(minAxis(z, 2)).toBeCloseTo(-5, 6);
    const x = lathe('G21 G18\nG0 X50 Z0\nG75 R1\nG75 X10 Z-10 P1 Q5000 F0.1\nG0 X99\nM30');
    expect(guards(x)).toEqual([`4번 줄: ${PECK('G75')} (모두 3번)`]);
  });

  it('정상 쪼기·한도 안 쪼기는 경고가 없다', () => {
    expect(guards(fanuc('G21 G90 G17\nG0 X0 Y0 Z5\nG83 X0 Y0 Z-20 R1 Q2 F100\nG80\nM2'))).toEqual([]);
    // 꼭 1만 번이면 바닥에 닿는다(안전장치 아님)
    expect(guards(fanuc('G21 G90 G17\nG0 X0 Y0 Z1\nG83 X0 Y0 Z-9 R1 Q0.001 F100\nG80\nM2'))).toEqual([]);
    expect(guards(heid(cyc(200, 'Q200=2 Q201=-20 Q206=100 Q202=5 Q203=+0 Q204=20')))).toEqual([]);
    expect(guards(lathe('G21 G18\nG0 X0 Z5\nG74 R1\nG74 Z-20 Q8000 F0.1\nM30'))).toEqual([]);
  });

  it('이동 한도가 먼저 막으면 한도 경고만(쌓지 못한 쪼기는 안전장치 탓이 아니다)', () => {
    const p = fanuc('G21 G90 G17\nG0 X0 Y0 Z1\nG83 X0 Y0 Z-100 R1 Q0.00001 F100\nG80\nG0 X99\nM2', { maxMoves: 1000 });
    expect(guards(p)).toEqual([]);
    expect(p.warnings).toEqual(['3번 줄: 이동이 1000개를 넘어 나머지는 읽지 않음']);
    expect(p.moves.count).toBe(1000);
  });
});

describe('층 안전장치(사이클마다)', () => {
  it('Fanuc 선반 G71·G72: 9,999층 뒤 다듬질 윤곽으로 — 그린 그대로 두고 경고', () => {
    const p = lathe('G21 G18\nG0 X40 Z5\nG71 U0.00001 R0.1\nG71 P10 Q20 U0.1 W0.1 F0.2\nN10 G1 X10 Z0\nG1 Z-10\nN20 G1 X20\nG0 X99\nM30');
    expect(guards(p)).toEqual([`4번 줄: G71: 층이 ${LATHE_LAYER_MAX}개를 넘어 그 뒤 층은 건너뛰고 다듬질 윤곽으로 감`]);
    expect(p.moves.count).toBeLessThanOrEqual(40_100);
    const q = lathe('G21 G18\nG0 X40 Z5\nG72 W0.00001 R0.1\nG72 P10 Q20 U0.1 W0.1 F0.2\nN10 G1 Z-20 X30\nG1 X12\nN20 G1 Z0\nG0 X99\nM30');
    expect(guards(q)).toEqual([`4번 줄: G72: 층이 ${LATHE_LAYER_MAX}개를 넘어 그 뒤 층은 건너뛰고 다듬질 윤곽으로 감`]);
    expect(guards(lathe('G21 G18\nG0 X40 Z5\nG71 U2 R0.5\nG71 P10 Q20 U0 W0 F0.2\nN10 G1 X10 Z0\nG1 Z-10\nN20 G1 X20\nM30'))).toEqual([]);
  });

  it('LinuxCNC G71·G72: 1만 층 뒤 다듬질 윤곽으로', () => {
    const p = llathe(`G18 G21 G8\nG0 X15 Z2\n${SUB100}\nG71 Q100 D0 I0.0001 R0.1 F0.2\nG0 X99\nM2`);
    expect(guards(p)).toEqual([`9번 줄: G71: 층이 ${G7X_MAX_LEVELS}개를 넘어 그 뒤 층은 건너뛰고 다듬질 윤곽으로 감`]);
    expect(guards(llathe(`G18 G21 G8\nG0 X15 Z2\n${SUB100}\nG71 Q100 D0.5 I0.5 R0.5 F0.2\nM2`))).toEqual([]);
    // g7xRough가 알린다(층 수는 그대로 상한까지)
    const pts = [0, 5, -10, 5, -20, 10, -21, 15];
    const plan = g7xRough(pts, [2, 15], 1, -1, 0.0001, 0.1, 0);
    expect(plan.levelCap).toBe(true);
    expect(plan.levels).toBe(G7X_MAX_LEVELS);
    expect(g7xRough(pts, [2, 15], 1, -1, 1, 0.1, 0).levelCap).toBe(false);
    expect(g7xRough(pts, [2, 15], 1, -1, 1, 0.1, 0, 3).levelCap).toBe(true);
  });

  it('Heidenhain 밀링 사이클: 9,999층 뒤 바닥 층으로 — 바닥 깊이는 그대로', () => {
    const b252 = cyc(252, 'Q223=12 Q368=0 Q207=500 Q351=+1 Q201=-10 Q202=0.0005 Q206=150 Q200=2 Q203=+0 Q204=50 Q370=1');
    const p = heid(b252);
    expect(guards(p)).toEqual([`${callLine(b252)}번 줄: CYCL DEF 252: 층이 9999개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감`]);
    expect(minAxis(p, 2)).toBeCloseTo(-10, 9);
    for (const n of [251, 253, 256, 257, 232]) {
      const qs = {
        251: 'Q218=14 Q219=12 Q220=0 Q368=0 Q207=500 Q351=+1 Q201=-10 Q202=0.0005 Q206=150 Q200=2 Q203=+0 Q204=50 Q370=1',
        253: 'Q218=30 Q219=12 Q368=0 Q374=0 Q367=0 Q207=500 Q351=+1 Q201=-10 Q202=0.0005 Q206=150 Q200=2 Q203=+0 Q204=50 Q370=1',
        256: 'Q218=40 Q424=42 Q219=30 Q425=32 Q220=0 Q368=0 Q224=0 Q367=0 Q207=500 Q351=+1 Q201=-10 Q202=0.0005 Q206=150 Q200=2 Q203=+0 Q204=50 Q370=1',
        257: 'Q223=40 Q222=42 Q368=0 Q207=500 Q351=+1 Q201=-10 Q202=0.0005 Q206=150 Q200=2 Q203=+0 Q204=50 Q370=1',
        232: 'Q389=0 Q225=0 Q226=0 Q227=0 Q386=-10 Q218=20 Q219=8 Q202=0.0005 Q207=500 Q200=2 Q204=50 Q370=1',
      }[n]!;
      const body = cyc(n, qs);
      expect(guards(heid(body)), String(n)).toEqual([`${callLine(body)}번 줄: CYCL DEF ${n}: 층이 9999개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감`]);
    }
    // 크기가 없어 그리지 않은 사이클·층을 쓰지 않는 208은 알리지 않는다
    expect(guards(heid(cyc(251, 'Q218=0 Q219=12 Q201=-10 Q202=0.0005 Q203=+0 Q204=50')))).toEqual([]);
    expect(guards(heid(cyc(208, 'Q200=2 Q201=-10 Q206=100 Q334=1 Q203=+0 Q204=20 Q335=30 Q207=500 Q351=+1 Q202=0.0005')))).toEqual([]);
    expect(guards(heid(cyc(252, 'Q223=50 Q368=0 Q207=500 Q351=+1 Q201=-6 Q202=3 Q206=150 Q200=2 Q203=+0 Q204=50')))).toEqual([]);
  });
});

describe('G12·G13 원·G76 절입 안전장치', () => {
  it('G12 아주 작은 Q: 1,000번째 원 뒤 마무리 원으로', () => {
    const p = haas('G21 G17\nG0 X0 Y0 Z1\nG12 I1 K30 Q0.001 Z-1 F100\nG0 X99\nM2');
    expect(guards(p)).toEqual([`3번 줄: G12: 원이 ${RING_MAX}개를 넘어 그 뒤 원은 건너뛰고 마무리 원으로 감`]);
    expect(guards(haas('G21 G17\nG0 X0 Y0 Z1\nG13 I1 K30 Q2 Z-1 F100\nM2'))).toEqual([]);
  });

  it('G76 아주 작은 첫 절입: 499번 뒤 절입은 건너뜀(Fanuc·LinuxCNC)', () => {
    const f = lathe('G21 G18\nG0 X30 Z5\nG76 P010060 Q0 R0.05\nG76 X26 Z-20 P1000 Q1 F1.5\nG0 X99\nM30');
    expect(guards(f)).toEqual([`4번 줄: G76: 나사 절입이 ${THREAD_PASS_MAX}번을 넘어 그 뒤 절입은 건너뜀`]);
    const l = llathe('G18 G21 G8\nG0 X15 Z2\nG76 P1.5 Z-20 I-0.5 J0.001 K1 R3\nG0 X99\nM2');
    expect(guards(l)).toEqual([`3번 줄: G76: 나사 절입이 ${THREAD_PASS_MAX}번을 넘어 그 뒤 절입은 건너뜀`]);
    expect(guards(lathe('G21 G18\nG0 X30 Z5\nG76 P010060 Q100 R0.05\nG76 X26 Z-20 P1000 Q300 F1.5\nM30'))).toEqual([]);
  });
});

describe('새 경고 글 번역', () => {
  const hangul = /[가-힣]/;
  const codes = languages.filter((l: { code: string }) => l.code !== 'ko').map((l: { code: string }) => l.code);
  const texts = [
    PECK('G83'),
    PECK('CYCLE83'),
    PECK('CYCL DEF 200'),
    `G71: 층이 ${LATHE_LAYER_MAX}개를 넘어 그 뒤 층은 건너뛰고 다듬질 윤곽으로 감`,
    'CYCL DEF 251: 층이 9999개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감',
    `G13: 원이 ${RING_MAX}개를 넘어 그 뒤 원은 건너뛰고 마무리 원으로 감`,
    `G76: 나사 절입이 ${THREAD_PASS_MAX}번을 넘어 그 뒤 절입은 건너뜀`,
  ];
  // 정보 탭은 경고 글(warningItems — 줄 번호 없이)을 옮기고 줄·횟수는 따로 보인다
  it('네 언어에서 한국어가 남지 않는다', () => {
    for (const t of texts) for (const code of codes) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
    expect(translate(PECK('G83'), 'en')).toBe(`G83: more than ${PECK_MAX} pecks — stopped before reaching the bottom`);
    expect(translate('CYCL DEF 251: 층이 9999개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감', 'de')).toBe('CYCL DEF 251: mehr als 9999 Zustellebenen — die übrigen Ebenen werden übersprungen, es geht direkt zur Bodenebene');
  });
});
