// Siemens 지름·반지름 지정(45차): SINUMERIK 840D sl / 828D Fundamentals 프로그래밍 설명서(6FC5398-1BP40-3BA1, 2013-03)
// 8.3.6절 168~170쪽(DIAMON·DIAM90·DIAMOF·DIAMCYCOF, 지름 값이 걸리는 것), 8.3.7절 170~174쪽(DAC·DIC·RAC·RIC), 1.1.5절 20쪽(G91 거리),
// 16.4절 표 16-28 500쪽(29군 기본 DIAMOF — 기계 데이터 MD20150). CYCLE95의 _ZSD[0] = 0 MID는 사이클 설명서(6FC5398-3BP20-0BA0) 4.10절 356쪽.
// 선반 모드에서만 읽고 밀링 모드는 44차까지와 같다. 실제 Siemens 선반 표본이 없어 설명서 예와 합성 프로그램으로만 시험한다
import { describe, expect, it } from 'vitest';
import { FLAG_CYCLE, MOVE_FEED, moveEnd, type NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

const DEFAULT = '지름·반지름 지정(DIAMON·DIAMOF) 전의 X를 지름으로 봄 — 컨트롤러 기본값(기계 데이터 MD20150)에 따라 반지름일 수 있음';
const run = (text: string, o: Record<string, unknown> = {}): NcProgram => parseSiemens(makeSource(text), { lathe: true, initialPosition: [100, 0, 100], ...o });
const plain = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
const ends = (p: NcProgram): number[][] => Array.from({ length: p.moves.count }, (_, i) => moveEnd(p.moves, i).map(r4));
/** 이동 꼴·끝 자리·호 중심이 같은지(줄 번호·시간 등은 뺌) */
const shape = (p: NcProgram): unknown => ({ kind: Array.from(p.moves.kind), ends: ends(p), centers: Array.from(p.arcs.center, r4), sweep: Array.from(p.arcs.sweep, r4) });

/** 설명서 8.3.6절 예(169~170쪽) — G4 대신 끝 줄 M30 */
const EX = `G71 G18 G90
N10 G0 X0 Z0
N20 DIAMOF
N30 G1 X30 S2000 M03 F0.7
N40 DIAMON
N50 G1 X70 Z-20
N60 Z-30
N70 DIAM90
N80 G91 X10 Z-20
N90 G90 X10
N100 M30`;

describe('Siemens 지름·반지름 지정 — 29군', () => {
  it('설명서 예(169~170쪽): DIAMOF는 반지름 X30, DIAMON은 지름 X70, DIAM90은 G91 X10이 반지름·G90 X10이 지름', () => {
    const p = run(EX);
    expect(ends(p)).toEqual([
      [0, 0, 0],
      [30, 0, 0],
      [35, 0, -20],
      [35, 0, -30],
      [45, 0, -50],
      [5, 0, -50],
    ]);
    // 29군 명령 전의 X(N10)는 지름 기본값으로 읽어 한 번 알린다
    expect(p.warnings).toEqual([`2번 줄: ${DEFAULT}`]);
  });

  it('밀링 모드는 29군을 읽지 않는다(44차까지와 같음 — 가로 축 X는 선반 모드에서만)', () => {
    const p = parseSiemens(makeSource(EX), { initialPosition: [100, 0, 100] });
    expect(ends(p)).toEqual([
      [0, 0, 0],
      [30, 0, 0],
      [70, 0, -20],
      [70, 0, -30],
      [80, 0, -50],
      [10, 0, -50],
    ]);
    expect(p.warnings).toEqual([]);
  });

  it('DIAMON은 G91·IC도 지름, DIAM90은 G91·IC가 반지름이고 AC는 지름, DIAMOF·DIAMCYCOF는 모두 반지름', () => {
    const body = (mode: string): string => `G71 G18 G90 ${mode}\nG0 X40 Z0\nG91 G1 X10 Z-5 F0.2\nG90 X=IC(4) Z-10\nG91 X=AC(50) Z-5\nG90 Z-20`;
    const x = (p: NcProgram): number[] => ends(p).map((e) => e[0]!);
    expect(x(run(body('DIAMON')))).toEqual([20, 25, 27, 25, 25]);
    expect(x(run(body('DIAM90')))).toEqual([20, 30, 34, 25, 25]);
    expect(x(run(body('DIAMOF')))).toEqual([40, 50, 54, 50, 50]);
    expect(x(run(body('DIAMCYCOF')))).toEqual([40, 50, 54, 50, 50]);
    for (const m of ['DIAMON', 'DIAM90', 'DIAMOF', 'DIAMCYCOF']) expect(run(body(m)).warnings).toEqual([]);
  });

  it('같은 블록의 29군은 그 블록의 X부터 걸린다(설명서 173쪽 예 N10 G0 X0 Z0 DIAMON)', () => {
    const p = run('G71 G18 G90\nG0 X40 Z0 DIAMOF\nG1 X40 Z-5 DIAMON F0.2');
    expect(ends(p).map((e) => e[0])).toEqual([40, 20]);
    expect(p.warnings).toEqual([]);
  });

  it('옵션 latheDiameter로 처음 지름·반지름을 정하면 알리지 않는다(정하지 않으면 지름 — 44차까지와 같음)', () => {
    const text = 'G71 G18 G90\nG0 X40 Z0\nG1 X20 Z-5 F0.2';
    expect(ends(run(text)).map((e) => e[0])).toEqual([20, 10]);
    expect(plain(run(text))).toEqual([DEFAULT]);
    expect(ends(run(text, { latheDiameter: false })).map((e) => e[0])).toEqual([40, 20]);
    expect(run(text, { latheDiameter: false }).warnings).toEqual([]);
    expect(run(text, { latheDiameter: true }).warnings).toEqual([]);
    // X를 읽기 전에 29군이 오면 알리지 않는다
    expect(run(`DIAMON\n${text}`).warnings).toEqual([]);
  });
});

describe('Siemens 지름·반지름 지정 — 원호·중간점·극', () => {
  it('원호 중심은 AC로 줄 때만 지름(170쪽), 증분 I는 늘 반지름 — DIAMOF 반지름 프로그램과 같은 길', () => {
    const on = run('G71 G18 G90 DIAMON\nG0 X30 Z-10\nG2 X50 Z-20 I=AC(50) K=AC(-10) F0.2\nG3 X30 Z-30 I-10 K0\nG2 X50 Z-40 I=IC(10) K=AC(-30)');
    const of = run('G71 G18 G90 DIAMOF\nG0 X15 Z-10\nG2 X25 Z-20 I=AC(25) K=AC(-10) F0.2\nG3 X15 Z-30 I-10 K0\nG2 X25 Z-40 I=IC(10) K=AC(-30)');
    expect(shape(on)).toEqual(shape(of));
    expect(on.arcs.count).toBe(3);
    expect(on.warnings).toEqual([]);
    expect(Array.from(on.arcs.center.slice(0, 3), r4)).toEqual([25, 0, -10]);
  });

  it('DIAM90에서도 AC 중심은 지름이고, AR(중심 + 여는 각)의 AC 중심도 같다', () => {
    const p = run('G71 G18 G90 DIAM90\nG0 X30 Z-10\nG2 I=AC(50) K=AC(-10) AR=90 F0.2');
    const q = run('G71 G18 G90 DIAMOF\nG0 X15 Z-10\nG2 I=AC(25) K=AC(-10) AR=90 F0.2');
    expect(shape(p)).toEqual(shape(q));
  });

  it('CIP 중간점 I1은 X와 같은 규칙(DIAMON 지름, DIAM90 증분은 반지름)', () => {
    const on = run('G71 G18 G90 DIAMON\nG0 X20 Z0\nCIP X40 Z-10 I1=36 K1=-4 F0.2');
    const of = run('G71 G18 G90 DIAMOF\nG0 X10 Z0\nCIP X20 Z-10 I1=18 K1=-4 F0.2');
    expect(shape(on)).toEqual(shape(of));
    const d90 = run('G71 G18 G90 DIAM90\nG0 X20 Z0\nCIP X40 Z-10 I1=IC(8) K1=-4 F0.2');
    expect(shape(d90)).toEqual(shape(of));
  });

  it('극 G111 X는 지름(절대), G110은 앞 자리에서 증분(DIAM90이면 반지름)', () => {
    const on = run('G71 G18 G90 DIAMON\nG0 X0 Z0\nG111 X40 Z-10\nG1 RP=5 AP=90 F0.2');
    const of = run('G71 G18 G90 DIAMOF\nG0 X0 Z0\nG111 X20 Z-10\nG1 RP=5 AP=90 F0.2');
    expect(ends(on)).toEqual(ends(of));
    const inc = run('G71 G18 G90 DIAM90\nG0 X20 Z0\nG110 X5 Z-10\nG1 RP=5 AP=90 F0.2');
    const incOf = run('G71 G18 G90 DIAMOF\nG0 X10 Z0\nG110 X5 Z-10\nG1 RP=5 AP=90 F0.2');
    expect(ends(inc)).toEqual(ends(incOf));
  });
});

describe('Siemens 지름·반지름 지정 — DAC·DIC·RAC·RIC(8.3.7절)', () => {
  it('설명서 예 2(173~174쪽) 꼴: DIAMON에서 X=RIC(5)는 반지름 증분, X=RAC(80)은 반지름 절대, DAC·DIC는 지름', () => {
    const p = run('G71 G18 G90\nN10 DIAMON\nN15 G0 G90 X20 Z40\nN20 G01 X=RIC(5) F0.2\nN25 X=RAC(80)\nN30 X=DAC(10)\nN40 X=DIC(10)\nN50 X30');
    expect(ends(p).map((e) => e[0])).toEqual([10, 15, 80, 5, 10, 15]);
    expect(p.warnings).toEqual([]);
  });

  it('DIAMOF에서도 DAC·DIC는 지름, 원호 중심 I=DAC·RIC도 읽는다', () => {
    const p = run('G71 G18 G90 DIAMOF\nG0 X=DAC(30) Z-10\nG2 X=DAC(50) Z-20 I=DAC(50) K=AC(-10) F0.2\nG3 X=DAC(30) Z-30 I=RIC(-10) K0');
    const q = run('G71 G18 G90 DIAMOF\nG0 X15 Z-10\nG2 X25 Z-20 I=AC(25) K=AC(-10) F0.2\nG3 X15 Z-30 I-10 K0');
    expect(shape(p)).toEqual(shape(q));
    expect(p.warnings).toEqual([]);
  });

  it('가로 축이 아닌 축의 DAC 등은 절대·증분으로만 보고 알린다, 밀링 모드는 44차처럼 읽지 않는다', () => {
    const p = run('G71 G18 G90 DIAMON\nG0 X40 Z0\nG1 Z=DAC(-10) F0.2\nZ=RIC(-5)');
    expect(ends(p).map((e) => e[2])).toEqual([0, -10, -15]);
    expect(plain(p)).toEqual(['DAC·DIC·RAC·RIC는 가로 축 X와 I·I1에만 지름·반지름으로 읽음 — Z은(는) 절대·증분으로만 봄']);
    const mill = parseSiemens(makeSource('G71 G18 G90\nG0 X40 Z0\nG1 X=RAC(30) Z-5 F0.2'), { initialPosition: [100, 0, 100] });
    expect(plain(mill)).toEqual(['읽을 수 없는 블록 — 함수 RAC은 읽지 않음']);
  });

  it('축별 지름 지정(DIAMONA 등)은 44차처럼 무시하고 알린다', () => {
    const p = run('G71 G18 G90 DIAMON\nDIAMONA[X]\nG0 X40 Z0\nDIAMCHAN\nG1 X20 Z-5 F0.2');
    expect(ends(p).map((e) => e[0])).toEqual([20, 10]);
    expect(plain(p)).toEqual(["Siemens 낱말 'DIAMONA'은(는) 무시함", "Siemens 낱말 'DIAMCHAN'은(는) 무시함"]);
  });
});

describe('Siemens 지름·반지름 지정 — CYCLE95', () => {
  /** 사이클 설명서 4.5절 예 2(312쪽): N110 G18 DIAMOF … 표지 구간 ANFANG:ENDE, 윤곽 정의 ANG */
  const EX2 = `N110 G18 DIAMOF G71 G90 G96 F0.8
N120 S500 M3
N130 T11 D1
N140 G0 X70
N150 Z60
N160 CYCLE95("ANFANG:ENDE", 2.5, 0.8, 0.8, 0, 0.8, 0.75, 0.6, 1)
N170 M02
ANFANG:
N180 G1 X10 Z100 F0.6
N190 Z90
N200 Z=AC(70) ANG=150
N210 Z=AC(50) ANG=135
N220 Z=AC(50) X=AC(50)
ENDE:
N230 M02
`;

  it('설명서 예 2(DIAMOF)를 선반 모드로 읽으면 밀링 모드(X 반지름)와 같은 길 — MID 2.5는 반지름(356쪽 _ZSD[0] = 0)', () => {
    const lathe = run(EX2, { initialPosition: [100, 0, 200] });
    const mill = parseSiemens(makeSource(EX2), { initialPosition: [100, 0, 200] });
    expect(ends(lathe)).toEqual(ends(mill));
    expect(Array.from(lathe.moves.flags).map((f) => f & FLAG_CYCLE)).toEqual(Array.from(mill.moves.flags).map((f) => f & FLAG_CYCLE));
    expect(plain(lathe)).toEqual(['CYCLE95: 물러나는 길과 언더컷으로 옮겨 가는 길은 설명서 그림으로 정해 그림']);
  });

  const prog = (head: string, body: string, zsd = ''): string => `${zsd}G71 G18 G90 G95 ${head}\nT1 D1\nS500 M3\nG0 X100 Z10\nCYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)\nG0 X120\nM30\n%_N_K1_SPF\n${body}\nM17\n`;
  /** 축과 나란한 거친 깎기 층의 X(반지름) — FF1(0.3) 이송 가운데 Z로 가는 것 */
  const levels = (p: NcProgram): number[] => {
    const out: number[] = [];
    for (let i = 0; i < p.moves.count; i++) {
      if (!(p.moves.flags[i]! & FLAG_CYCLE) || p.moves.kind[i] !== MOVE_FEED) continue;
      const s = moveEnd(p.moves, i - 1);
      const e = moveEnd(p.moves, i);
      if (Math.abs(s[0] - e[0]) < 1e-9 && Math.abs(s[2] - e[2]) > 1e-9) out.push(r4(e[0]));
    }
    return [...new Set(out)];
  };

  it('_ZSD[0] = 0의 MID: DIAMON·DIAM90은 지름(반지름 1 mm씩), DIAMOF는 반지름(2 mm씩) — _ZSD[0] = 1·2는 29군과 상관없이', () => {
    const on = run(prog('DIAMON', 'G1 X20 Z0\nZ-10\nX60'));
    expect(levels(on)).toEqual([29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10]);
    expect(levels(run(prog('DIAM90', 'G1 X20 Z0\nZ-10\nX60')))).toEqual(levels(on));
    const of = run(prog('DIAMOF', 'G1 X10 Z0\nZ-10\nX30'));
    expect(levels(of)).toEqual([28, 26, 24, 22, 20, 18, 16, 14, 12, 10]);
    expect(levels(run(prog('DIAMOF', 'G1 X10 Z0\nZ-10\nX30', '_ZSD[0]=2\n')))).toEqual([29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10]);
    expect(levels(run(prog('DIAMON', 'G1 X20 Z0\nZ-10\nX60', '_ZSD[0]=1\n')))).toEqual([28, 26, 24, 22, 20, 18, 16, 14, 12, 10]);
  });

  it('윤곽 안의 29군·DAC 등은 윤곽에만 걸린다(사이클 뒤 X는 앞의 지름 지정 그대로)', () => {
    const inner = run(prog('DIAMON', 'G1 X20 Z0\nZ-10\nDIAMOF\nX30 Z-15\nZ-25\nX=DAC(60)'));
    const plainBody = run(prog('DIAMON', 'G1 X20 Z0\nZ-10\nX60 Z-15\nZ-25\nX60'));
    expect(ends(inner)).toEqual(ends(plainBody));
    // 사이클 뒤 G0 X120은 지름(반지름 60)
    expect(ends(inner)[inner.moves.count - 1]![0]).toBe(60);
  });

  it('윤곽 원호 I=AC는 지름(DIAMON), I=RAC는 반지름', () => {
    const ac = run(prog('DIAMON', 'G1 X20 Z0\nZ-10\nG2 X40 Z-20 I=AC(40) K=AC(-10)\nG1 Z-25\nX60'));
    const rac = run(prog('DIAMON', 'G1 X20 Z0\nZ-10\nG2 X40 Z-20 I=RAC(20) K=AC(-10)\nG1 Z-25\nX60'));
    expect(shape(ac)).toEqual(shape(rac));
    expect(ac.warnings).toEqual(rac.warnings);
  });
});

describe('Siemens 지름·반지름 지정 — 경고 글', () => {
  it('새 경고가 네 언어로 한국어 없이 옮겨진다', () => {
    // 화면은 줄 번호와 글을 따로 옮긴다(warningItems)
    const p = run('G71 G18 G90\nG0 X40 Z0\nG1 Z=DAC(-10) F0.2');
    const texts = p.warningItems!.map((w) => w.text);
    expect(texts).toEqual([DEFAULT, 'DAC·DIC·RAC·RIC는 가로 축 X와 I·I1에만 지름·반지름으로 읽음 — Z은(는) 절대·증분으로만 봄']);
    for (const t of texts) for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate(DEFAULT, 'en')).toBe('X before a diameter/radius setting (DIAMON, DIAMOF) is read as a diameter — depending on the control default (machine data MD20150) it may be a radius');
  });
});
