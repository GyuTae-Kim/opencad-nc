// Siemens CYCLE97(나사 깎기, 45차): SINUMERIK 840D sl 사이클 프로그래밍 설명서(6FC5398-3BP20-0BA0, 2006-11) 4.7절 327~334쪽.
// 매개변수 차례·VARI 표·사이클 시작·끝 자리(APP·ROP, 지름 + _VRT)·깊이 나누기(같은 절입·같은 단면)·다듬질·빈 패스·여러 줄·길이/가로 나사·IANG를
// 설명서 예(329쪽)와 합성 프로그램으로 본다. 실제 Siemens 선반 표본이 없어 설명서 예제와 합성 프로그램으로만 시험한다
import { describe, expect, it } from 'vitest';
import { FLAG_CYCLE, FLAG_PER_REV, MOVE_FEED, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

const run = (text: string, o: Record<string, unknown> = {}): NcProgram => parseSiemens(makeSource(text), { lathe: true, initialPosition: [100, 0, 100], ...o });
const RETRACT = 'CYCLE97: 물러나는 길(나사 끝에서 _VRT 밖으로 G0, 다음 패스 시작으로 G0)은 정해 그림';
const FLANK = 'CYCLE97: 측면 절입(IANG)은 패스마다 깊이 × tan IANG만큼 깎는 방향으로 옮겨 그림 — 설명서는 그림만 있어 정한 것';
// 지름 기본값 알림(45차)은 siemens-diam.test.ts에서 본다
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, '')).filter((w) => !w.startsWith('지름·반지름 지정(DIAMON·DIAMOF) 전의 X'));
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
const cyc = (p: NcProgram): number[] => {
  const out: number[] = [];
  for (let i = 0; i < p.moves.count; i++) if (p.moves.flags[i]! & FLAG_CYCLE) out.push(i);
  return out;
};
/** 나사 이송(사이클 안의 이송 직선)마다 [시작, 끝](X 반지름·Z) */
const threads = (p: NcProgram): number[][][] =>
  cyc(p)
    .filter((i) => p.moves.kind[i] === MOVE_FEED)
    .map((i) => [moveStart(p.moves, i), moveEnd(p.moves, i)].map((e) => [r4(e[0]), r4(e[2])]));

/** 설명서 예(329쪽): M42 바깥 나사, 같은 단면 절입(VARI 3), 깊이 1.23·여유 0으로 5번, 빈 패스 2번, 측면 절입 30도 */
const EX = `DEF REAL MPIT=42, SPL=0, FPL=-35, DM1=42, DM2=42, APP=10, ROP=3, TDEP=1.23, FAL=0, IANG=30, NSP=0
DEF INT NRC=5, NID=2, VARI=3, NUMT=1
N10 G0 G18 G90 Z100 X60
N20 G95 D1 T1 S1000 M4
N30 CYCLE97( , MPIT, SPL, FPL, DM1, DM2, APP, ROP, TDEP, FAL, IANG, NSP, NRC, NID, VARI, NUMT)
N40 G90 G0 X100 Z100
N50 M30`;
const T30 = Math.tan(Math.PI / 6);

describe('Siemens CYCLE97 — 설명서 예', () => {
  it('예(329쪽): 5번 같은 단면(깊이 ∝ √k)으로 1.23까지, 빈 패스 2번 — 패스마다 측면(30도)을 따라 깎는 방향으로 옮김', () => {
    const p = run(EX);
    const t = threads(p);
    const d = [...[1, 2, 3, 4, 5].map((k) => 1.23 * Math.sqrt(k / 5)), 1.23, 1.23];
    expect(t.length).toBe(7);
    // 지름 42(반지름 21)에서 깊이만큼 안쪽, Z는 SPL + APP(10)에서 FPL − ROP(−38)까지 — 깎는 방향(−Z)으로 깊이 × tan 30°만큼 옮김
    expect(t).toEqual(d.map((v) => [[r4(21 - v), r4(10 - v * T30)], [r4(21 - v), r4(-38 - v * T30)]]));
    expect(warns(p)).toEqual(['단위 코드(G70/G71)가 없어 mm로 봄', RETRACT, FLANK]);
  });

  it('예: 시작 자리(지름 + 1 mm, SPL + APP)로 G0, 패스마다 깊이로 G0 → 나사 이송 → 바깥으로 G0, 끝나면 시작 자리', () => {
    const p = run(EX);
    const ids = cyc(p);
    expect(moveEnd(p.moves, ids[0]!).map(r4)).toEqual([22, 0, 10]);
    expect(p.moves.kind[ids[0]!]).toBe(MOVE_RAPID);
    expect(moveEnd(p.moves, ids[ids.length - 1]!).map(r4)).toEqual([22, 0, 10]);
    // 첫 패스: 측면 자리로 G0(바깥 높이), 깊이로 G0, 이송, 바깥으로 G0
    expect(ids.slice(1, 5).map((i) => p.moves.kind[i])).toEqual([MOVE_RAPID, MOVE_RAPID, MOVE_FEED, MOVE_RAPID]);
    expect(moveEnd(p.moves, ids[4]!).map(r4)).toEqual([22, 0, r4(-38 - 1.23 * Math.sqrt(0.2) * T30)]);
    // 사이클 뒤 N40 G90 G0 X100 Z100(지름)
    expect(moveEnd(p.moves, p.moves.count - 1).map(r4)).toEqual([50, 0, 100]);
  });

  it('예: 나사 이송은 피치(MPIT 42 → ISO 261 보통 나사 4.5 mm)를 회전당 이송으로', () => {
    const p = run(EX);
    for (const i of cyc(p).filter((k) => p.moves.kind[k] === MOVE_FEED)) {
      expect(p.moves.feed[i]).toBeCloseTo(4.5, 6);
      expect(p.moves.flags[i]! & FLAG_PER_REV).toBe(FLAG_PER_REV);
    }
    const pit = run(EX.replace('CYCLE97( , MPIT', 'CYCLE97(2, ').replace('MPIT=42, ', ''));
    expect(threads(pit)).toEqual(threads(p));
    expect(pit.moves.feed[cyc(pit).find((k) => pit.moves.kind[k] === MOVE_FEED)!]).toBeCloseTo(2, 6);
  });

  it('밀링 모드도 같은 사이클 길(DM은 늘 지름), 선반 모드의 DIAMOF에서도 DM은 지름', () => {
    const lathe = threads(run(EX));
    expect(threads(parseSiemens(makeSource(EX), { initialPosition: [100, 0, 100] }))).toEqual(lathe);
    expect(threads(run(`DIAMOF\n${EX.replace('X60', 'X30').replace('X100 Z100', 'X50 Z100')}`))).toEqual(lathe);
  });
});

describe('Siemens CYCLE97 — 꼴', () => {
  const prog = (call: string, head = ''): string => `${head}G71 G18 G90 G95 DIAMON\nT1 D1\nS500 M3\nG0 X60 Z20\n${call}\nG0 X100\nM30`;

  it('같은 절입(VARI 1): 여유를 뺀 깊이를 NRC번 같게, 다듬질 한 번(TDEP), 빈 패스 NID번 — NUMT줄이면 온 차례를 되풀이', () => {
    const p = run(prog('CYCLE97(2, , 0, -20, 30, 30, 5, 2, 1.2, 0.3, 0, , 3, 1, 1, 2)'));
    const x = threads(p).map((t) => t[0]![0]);
    // 반지름 15에서 0.3·0.6·0.9(거친 깎기 3번), 1.2(다듬질), 1.2(빈 패스) — 두 줄
    const one = [14.7, 14.4, 14.1, 13.8, 13.8];
    expect(x).toEqual([...one, ...one]);
    expect(threads(p)[0]).toEqual([
      [14.7, 5],
      [14.7, -22],
    ]);
    expect(warns(p)).toEqual([RETRACT]);
  });

  it('안나사(VARI 2·4)는 양의 쪽으로 절입하고 시작 자리는 지름에서 _VRT 안쪽', () => {
    const p = run(prog('CYCLE97(1.5, , 0, -20, 20, 20, 3, 2, 0.9, 0, 0, , 3, 0, 2, , 2)'));
    expect(threads(p).map((t) => t[0]![0])).toEqual([10.3, 10.6, 10.9]);
    // _VRT 2: 반지름 10 − 2
    expect(moveEnd(p.moves, cyc(p)[0]!).map(r4)).toEqual([8, 0, 3]);
    const area = run(prog('CYCLE97(1.5, , 0, -20, 20, 20, 3, 2, 0.9, 0, 0, , 4, 0, 4)'));
    expect(threads(area).map((t) => t[0]![0])).toEqual([1, 2, 3, 4].map((k) => r4(10 + 0.9 * Math.sqrt(k / 4))));
  });

  it('테이퍼 나사는 원뿔과 나란히 깎고(APP·ROP는 같은 직선을 늘임) 끝에서는 그 자리 지름 + _VRT로 물러남', () => {
    const p = run(prog('CYCLE97(2, , 0, -20, 30, 34, 5, 2, 1.2, 0, 0, , 2, 0, 1, , 2)'));
    // 반지름 15(Z0)에서 17(Z−20) — Z5에서 14.5, Z−22에서 17.2
    expect(threads(p)).toEqual([
      [
        [13.9, 5],
        [16.6, -22],
      ],
      [
        [13.3, 5],
        [16, -22],
      ],
    ]);
    const ids = cyc(p);
    const out = ids.find((i) => p.moves.kind[i] === MOVE_FEED)! + 1;
    expect(moveEnd(p.moves, out).map(r4)).toEqual([19.2, 0, -22]);
    expect(moveEnd(p.moves, ids[0]!).map(r4)).toEqual([16.5, 0, 5]);
  });

  it('가로 나사(테이퍼 각 45도 넘음)는 X로 깎고 Z로 절입한다(바깥은 −Z — 정한 것, 경고)', () => {
    const p = run(prog('CYCLE97(2, , 0, -5, 30, 90, 2, 2, 1, 0, 0, , 2, 0, 1)'));
    const q = (x: number): number => (-5 * (x - 15)) / 30;
    expect(threads(p)).toEqual(
      [0.5, 1].map((d) => [
        [13, r4(q(13) - d)],
        [47, r4(q(47) - d)],
      ]),
    );
    expect(warns(p)).toContain('CYCLE97: 가로 나사(테이퍼 각 45도 넘음)는 바깥 나사를 긴 축 음의 쪽으로 절입하는 것으로 정해 그림');
  });

  it('IANG 음수는 원통 나사에서 거친 깎기 패스마다 양 측면 번갈아(다듬질·빈 패스는 가운데), 테이퍼면 한쪽 측면', () => {
    const alt = run(prog('CYCLE97(1.5, , 0, -20, 20, 20, 3, 2, 0.9, 0, -30, , 4, 1, 4)'));
    const z = threads(alt).map((t) => t[0]![1]);
    const d = [1, 2, 3, 4].map((k) => 0.9 * Math.sqrt(k / 4));
    // 깎는 방향 −Z: 첫 패스는 −Z 쪽, 둘째는 +Z 쪽 …, 빈 패스는 옮기지 않음
    expect(z).toEqual([r4(3 - d[0]! * T30), r4(3 + d[1]! * T30), r4(3 - d[2]! * T30), r4(3 + d[3]! * T30), 3]);
    expect(warns(alt)).toEqual([RETRACT, FLANK]);
    const cone = run(prog('CYCLE97(1.5, , 0, -20, 20, 22, 3, 2, 0.9, 0, -30, , 2, 0, 2)'));
    const zc = threads(cone).map((t) => t[0]![1]);
    expect(zc).toEqual([1, 2].map((k) => r4(3 - 0.9 * (k / 2) * T30)));
  });
});

describe('Siemens CYCLE97 — 알람과 안전장치', () => {
  const prog = (call: string): string => `G71 G18 G90 G95 DIAMON\nT1 D1\nS500 M3\nG0 X60 Z20\n${call}\nG0 X100\nM30`;
  const w = (call: string): string[] => warns(run(prog(call)));

  it('VARI가 1~4가 아니면 알람 61002, 피치가 어긋나거나 MPIT가 범위 밖이면 알람 61001, 피치·깊이·길이가 없으면 그리지 않는다', () => {
    expect(w('CYCLE97(2, , 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 3, 0, 5)')).toEqual(['CYCLE97: 가공 종류(VARI = 5)가 맞지 않음(알람 61002) — 그리지 않음']);
    expect(w('CYCLE97(2, , 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 3, 0, 0)')).toEqual(['CYCLE97: 가공 종류(VARI = 0)가 맞지 않음(알람 61002) — 그리지 않음']);
    expect(w('CYCLE97(2, 12, 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 3, 0, 1)')).toEqual(['CYCLE97: 나사 피치가 맞지 않음(PIT = 2, MPIT = 12)(알람 61001) — 그리지 않음']);
    expect(w('CYCLE97(, 61, 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 3, 0, 1)')).toEqual(['CYCLE97: 나사 피치가 맞지 않음(PIT = 0, MPIT = 61)(알람 61001) — 그리지 않음']);
    expect(w('CYCLE97(, , 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 3, 0, 1)')).toEqual(['CYCLE97: 나사 피치(PIT·MPIT)가 없음 — 그리지 않음']);
    expect(w('CYCLE97(2, , 0, -20, 30, 30, 5, 2, 0, 0, 0, , 3, 0, 1)')).toEqual(['CYCLE97: 나사 깊이(TDEP)가 없음 — 그리지 않음']);
    expect(w('CYCLE97(2, , 0, 0, 30, 30, 5, 2, 1, 0, 0, , 3, 0, 1)')).toEqual(['CYCLE97: 나사 시작과 끝(SPL·FPL·DM1·DM2)이 같음 — 그리지 않음']);
    for (const c of ['CYCLE97(2, , 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 3, 0, 5)', 'CYCLE97(, , 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 3, 0, 1)']) expect(cyc(run(prog(c)))).toEqual([]);
    // PIT와 MPIT가 같은 피치(M10 = 1.5)면 그린다
    expect(w('CYCLE97(1.5, 10, 0, -20, 10, 10, 5, 2, 0.9, 0, 0, , 3, 0, 1)')).toEqual([RETRACT]);
  });

  it('표에 없는 MPIT는 나사 이송 없이, NRC가 없으면 한 번, FAL이 TDEP보다 크면 다듬질만 그리고 알린다', () => {
    // 이송은 프로그램의 F 그대로(여기서는 F가 없어 이송 없는 절삭 경고)
    expect(w('CYCLE97(, 7, 0, -20, 7, 7, 5, 2, 0.6, 0, 0, , 3, 0, 1)')).toEqual(['CYCLE97: 나사 크기 MPIT = 7의 피치를 몰라 나사 이송 없이 그림', '이송 속도(F) 없이 절삭 이동 — 시간 계산에서 뺌', RETRACT]);
    const nrc = run(prog('CYCLE97(2, , 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 0, 0, 1)'));
    expect(threads(nrc).map((t) => t[0]![0])).toEqual([13.8]);
    expect(warns(nrc)).toEqual(['CYCLE97: 거친 깎기 횟수(NRC)가 없어 한 번으로 봄', RETRACT]);
    const fal = run(prog('CYCLE97(2, , 0, -20, 30, 30, 5, 2, 1, 2, 0, , 3, 0, 1)'));
    expect(threads(fal).map((t) => t[0]![0])).toEqual([14]);
    expect(warns(fal)).toEqual(['CYCLE97: 다듬질 여유(FAL)가 나사 깊이(TDEP)보다 큼 — 거친 깎기 없이 다듬질만 그림', RETRACT]);
  });

  it('패스가 499번을 넘으면 그 뒤를 건너뛰고, 이동 한도에서 멈춘다', () => {
    const cap = run(prog('CYCLE97(2, , 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 100000, 0, 1)'));
    expect(threads(cap).length).toBe(499);
    expect(warns(cap)).toContain('CYCLE97: 패스가 499번을 넘어 그 뒤 패스는 건너뜀');
    const lim = run(prog('CYCLE97(2, , 0, -20, 30, 30, 5, 2, 1.2, 0, 0, , 300, 0, 1)'), { maxMoves: 200 });
    expect(lim.moves.count).toBe(200);
    expect(warns(lim).some((m) => /이동이 200개를 넘어/.test(m))).toBe(true);
  });

  it('새 경고가 네 언어로 한국어 없이 옮겨진다', () => {
    const texts = [
      RETRACT,
      FLANK,
      'CYCLE97: 가로 나사(테이퍼 각 45도 넘음)는 바깥 나사를 긴 축 음의 쪽으로 절입하는 것으로 정해 그림',
      'CYCLE97: 가공 종류(VARI = 5)가 맞지 않음(알람 61002) — 그리지 않음',
      'CYCLE97: 나사 피치가 맞지 않음(PIT = 2, MPIT = 12)(알람 61001) — 그리지 않음',
      'CYCLE97: 나사 피치(PIT·MPIT)가 없음 — 그리지 않음',
      'CYCLE97: 나사 깊이(TDEP)가 없음 — 그리지 않음',
      'CYCLE97: 나사 시작과 끝(SPL·FPL·DM1·DM2)이 같음 — 그리지 않음',
      'CYCLE97: 나사 크기 MPIT = 7의 피치를 몰라 나사 이송 없이 그림',
      'CYCLE97: 거친 깎기 횟수(NRC)가 없어 한 번으로 봄',
      'CYCLE97: 다듬질 여유(FAL)가 나사 깊이(TDEP)보다 큼 — 거친 깎기 없이 다듬질만 그림',
      'CYCLE97: 패스가 499번을 넘어 그 뒤 패스는 건너뜀',
    ];
    for (const t of texts) for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate(RETRACT, 'en')).toBe('CYCLE97: the retraction path (G0 out by _VRT at the thread end, G0 to the next pass start) is drawn as decided');
  });
});
