// Siemens CYCLE95(선반 윤곽 거친 깎기, 44차): SINUMERIK 840D sl 사이클 프로그래밍 설명서(6FC5398-3BP20-0BA0, 2006-11) 4.5절 309~322쪽.
// 매개변수 차례·VARI 표·윤곽 부프로그램 찾기·시작 자리·구간마다 다시 나누는 절입(316쪽 보기)을 설명서 예 1·2와 합성 윤곽으로 본다.
// 실제 Siemens 선반 표본이 없어 설명서 예제와 합성 프로그램으로만 시험한다
import { describe, expect, it } from 'vitest';
import { cycle95Rough } from '../src/lathe-g7x';
import { FLAG_CYCLE, MOVE_FEED, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

const run = (text: string, o: Record<string, unknown> = {}): NcProgram => parseSiemens(makeSource(text), { lathe: true, initialPosition: [100, 0, 200], ...o });
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
/** 사이클이 만든 이동(FLAG_CYCLE) 차례 */
const cyc = (p: NcProgram): number[] => {
  const out: number[] = [];
  for (let i = 0; i < p.moves.count; i++) if (p.moves.flags[i]! & FLAG_CYCLE) out.push(i);
  return out;
};
/**
 * 축과 나란한 거친 깎기(같은 X에서 Z로 가는 이송) — 첫 구간은 급속 바로 뒤, 언더컷은 FF2(느린 이송) 바로 뒤의 FF1 이송. X(반지름)를 차례대로.
 * 가로 가공이면 axis = 2(같은 Z에서 X로 감)
 */
const cuts = (p: NcProgram, axis: 0 | 2 = 0): number[] => {
  const out: number[] = [];
  const ids = cyc(p);
  for (let k = 1; k < ids.length; k++) {
    const i = ids[k]!;
    const j = ids[k - 1]!;
    if (p.moves.kind[i] !== MOVE_FEED) continue;
    const s = moveStart(p.moves, i);
    const e = moveEnd(p.moves, i);
    if (Math.abs(s[axis] - e[axis]) > 1e-9 || Math.abs(s[2 - axis] - e[2 - axis]) < 1e-9) continue;
    const after = p.moves.kind[j] === MOVE_RAPID || (p.moves.kind[j] === MOVE_FEED && p.moves.feed[j]! < p.moves.feed[i]!);
    if (after) out.push(r4(e[axis]));
  }
  return out;
};

/** 설명서 예 1(311쪽): 길이 바깥 온 가공(VARI 9), MID 5, FALZ 1.2, FALX 0.6, FF1 0.2, FF2 0.1, FF3 0.2, _VRT 0.5. 윤곽은 따로 된 부프로그램 */
const EX1 = (vari = 9, more = '', contour = 'N130 G1 Z95 X65 RND=5'): string => `DEF STRING[8] UPNAME
G71 G18 G90 G95
N10 T1 D1 G0 S500 M3 Z125 X81
UPNAME="KONTUR_1"
N20 CYCLE95(UPNAME, 5, ${more || '1.2, 0.6, '}, 0.2, 0.1, 0.2, ${vari}, , , 0.5)
N30 G0 G90 X90
N40 Z130
N50 M30
%_N_KONTUR_1_SPF
N100 G1 Z120 X37
N110 Z117 X40
N120 Z112
${contour}
N140 Z87
N150 Z77 X29
N160 Z62
N170 Z58 X44
N180 Z52
N190 Z41 X37
N200 Z35
N210 G1 X76
N220 M17
`;

/** 설명서 예 2(312쪽): 부른 프로그램 안 표지 구간 "ANFANG:ENDE", 윤곽 정의 ANG, 길이 바깥 거친 깎기(VARI 1). DIAMOF 대신 밀링 모드(X 반지름) */
const EX2 = `N110 G18 G71 G90 G96 F0.8
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

describe('Siemens CYCLE95 — 설명서 예', () => {
  it('예 1: 세 구간을 설명서 316쪽처럼 나눈다(지름 39·36·7 mm를 8·8·2번 — 4.875·4.5·3.5 mm)', () => {
    const p = run(EX1(1));
    const c = cuts(p);
    // 반지름 값: 첫 구간 38.6(X76 + 여유 0.6)에서 19.1(X37 + 0.6)까지, 구간 2는 33.1(X65)에서 15.1(X29)까지, 구간 3은 22.6(X44)에서 19.1(X37)까지
    const want = [
      ...Array.from({ length: 8 }, (_, k) => 38.6 - 2.4375 * (k + 1)),
      ...Array.from({ length: 8 }, (_, k) => 33.1 - 2.25 * (k + 1)),
      ...Array.from({ length: 2 }, (_, k) => 22.6 - 1.75 * (k + 1)),
    ].map(r4);
    expect(c).toEqual(want);
    expect(warns(p)).toEqual([
      'CYCLE95: 물러나는 길과 언더컷으로 옮겨 가는 길은 설명서 그림으로 정해 그림',
      'CYCLE95: 언더컷이 있는데 축 방향 여유 FALZ가 0이 아님 — 윤곽을 시작 쪽으로 옮겨 그려 언더컷의 내려가는 벽은 여유만큼 파고들 수 있음',
    ]);
  });

  it('예 1: 시작 자리(322쪽)로 두 축 함께 G0, 끝나면 시작 자리, 사이클 뒤 G90 X90은 절대 이동(선반 모드에서도 Fanuc 단순 사이클이 아님)', () => {
    const p = run(EX1());
    const ids = cyc(p);
    // 시작 자리: X(반지름) = 38(X76) + 0.6 + 0.5, Z = 120 + 1.2 + 0.5
    expect(moveEnd(p.moves, ids[0]!).map(r4)).toEqual([39.1, 0, 121.7]);
    expect(moveEnd(p.moves, ids[ids.length - 1]!).map(r4)).toEqual([39.1, 0, 121.7]);
    const last = p.moves.count - 1;
    expect(moveEnd(p.moves, last - 1).map(r4)).toEqual([45, 0, 121.7]);
    expect(moveEnd(p.moves, last).map(r4)).toEqual([45, 0, 130]);
    expect(p.moves.count - 1 - ids[ids.length - 1]!).toBe(2);
  });

  it('예 1: 다듬질(314쪽)은 윤곽 시작보다 여유 + 1 mm 앞에서 G1로 들어가 윤곽(RND 원호 포함)을 FF3로 따라간다', () => {
    const p = run(EX1(5));
    const ids = cyc(p);
    // 축과 나란한 이송은 윤곽 시작으로 들어가는 G1 하나뿐(거친 깎기 없음)
    expect(cuts(p)).toEqual([18.5]);
    const ends = ids.map((i) => moveEnd(p.moves, i).map(r4));
    expect(ends[0]).toEqual([39.1, 0, 121.7]);
    expect(ends[1]).toEqual([18.5, 0, 122.2]);
    expect(ends[2]).toEqual([18.5, 0, 120]);
    expect(ends[ends.length - 2]).toEqual([38, 0, 35]);
    expect(ends[ends.length - 1]).toEqual([39.1, 0, 121.7]);
    expect(ids.some((i) => p.moves.kind[i] === 2)).toBe(true);
    expect(warns(p)).toEqual([]);
  });

  it('예 2: 표지 구간·윤곽 정의 ANG를 읽고 MID 2.5로 40 mm를 16번(밀링 모드 — X 반지름)', () => {
    const p = parseSiemens(makeSource(EX2), { initialPosition: [100, 0, 200] });
    const c = cuts(p);
    expect(c).toEqual(Array.from({ length: 16 }, (_, k) => r4(50.8 - 2.5 * (k + 1))));
    expect(warns(p)).toEqual(['CYCLE95: 물러나는 길과 언더컷으로 옮겨 가는 길은 설명서 그림으로 정해 그림']);
    // 첫 층: 시작 자리 Z(100 + 0.8 + _VRT 1 mm)에서 끝 면(Z50 + 0.8)까지
    const first = cyc(p).find((i) => p.moves.kind[i] === MOVE_FEED)!;
    expect(moveStart(p.moves, first).map(r4)).toEqual([48.3, 0, 101.8]);
    expect(moveEnd(p.moves, first).map(r4)).toEqual([48.3, 0, 50.8]);
  });
});

describe('Siemens CYCLE95 — 꼴과 알람', () => {
  const SUB = (body: string): string => `%_N_K1_SPF\n${body}\nM17\n`;
  const prog = (call: string, body: string, head = ''): string => `${head}G71 G18 G90 G95\nT1 D1\nS500 M3\nG0 X100 Z10\n${call}\nG0 X120\nM30\n${SUB(body)}`;
  const MONO = 'G1 X20 Z0\nZ-10\nX40 Z-15\nZ-25\nX60';

  it('윤곽을 거꾸로 적어도 거친 깎기는 같은 길(321쪽 — 깊은 끝에서 시작), 다듬질만은 프로그램 차례', () => {
    const fwd = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', MONO));
    const rev = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', 'G1 X60 Z-25\nX40\nZ-15\nX20 Z-10\nZ0'));
    const ends = (p: NcProgram): number[][] => cyc(p).map((i) => moveEnd(p.moves, i).map(r4));
    expect(ends(rev)).toEqual(ends(fwd));
    // MID 2는 지름 값(_ZSD[0] = 0, 지름 지정) — 반지름 30(X60)에서 10(X20)까지 1 mm씩 20번
    expect(cuts(fwd)).toEqual(Array.from({ length: 20 }, (_, k) => 29 - k));
    // 다듬질만(VARI 5): 거꾸로 적으면 끝(X20 Z0)에서 끝나고, 온 가공(9)은 거친 깎기 방향(Z0에서 Z-25 쪽)으로 다듬는다
    const finRev = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 5)', 'G1 X60 Z-25\nX40\nZ-15\nX20 Z-10\nZ0'));
    const f = ends(finRev);
    expect(f[f.length - 2]).toEqual([10, 0, 0]);
    const compRev = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 9)', 'G1 X60 Z-25\nX40\nZ-15\nX20 Z-10\nZ0'));
    const g = ends(compRev);
    expect(g[g.length - 2]).toEqual([30, 0, -25]);
  });

  it('여유 없이 깎은 거친 깎기는 다듬질 윤곽 안으로 파고들지 않는다(언더컷·봉우리 포함)', () => {
    const body = 'G1 X20 Z0\nZ-10\nX40 Z-12\nZ-18\nX24 Z-22\nZ-30\nX50 Z-34\nZ-40\nX44 Z-44\nZ-50\nX60';
    const p = run(prog('CYCLE95("K1", 1.5, 0, 0, 0, 0.3, 0.1, 0.2, 1, , , 0.5)', body));
    // 다듬질 윤곽(반지름): Z에서 가장 큰 X(수직 벽은 아래 끝) — 그보다 안쪽(작은 X)에 이송 끝점이 있으면 파고든 것
    const pts: [number, number][] = [];
    for (const l of body.split('\n')) {
      const x = /X(-?[\d.]+)/.exec(l);
      const z = /Z(-?[\d.]+)/.exec(l);
      const prev = pts[pts.length - 1];
      pts.push([z ? +z[1]! : prev![0], x ? +x[1]! / 2 : prev![1]]);
    }
    const partX = (z: number): number => {
      let best = Infinity;
      for (let k = 0; k + 1 < pts.length; k++) {
        const [za, xa] = pts[k]!;
        const [zb, xb] = pts[k + 1]!;
        if (z > Math.max(za, zb) + 1e-9 || z < Math.min(za, zb) - 1e-9) continue;
        best = Math.min(best, Math.abs(za - zb) < 1e-12 ? Math.min(xa, xb) : xa + ((xb - xa) * (z - za)) / (zb - za));
      }
      return best;
    };
    let checked = 0;
    for (const i of cyc(p)) {
      if (p.moves.kind[i] === MOVE_RAPID) continue;
      const [x, , z] = moveEnd(p.moves, i);
      if (z > 0 || z < -50) continue;
      checked++;
      expect(x, `${i}: Z${z}`).toBeGreaterThanOrEqual(partX(z) - 1e-6);
    }
    expect(checked).toBeGreaterThan(40);
    // 반지름 30(X60)에서: 첫 구간은 10(X20)까지 20 mm를 MID 0.75(지름 1.5)로 27번, 언더컷 둘은 봉우리 20(X40)에서 골 12(X24)까지 8 mm를 11번,
    // 봉우리 25(X50)에서 골 22(X44)까지 3 mm를 4번
    const c = cuts(p);
    expect(c.length).toBe(42);
    expect(c[26]).toBe(10);
    expect(c[37]).toBe(12);
    expect(c[41]).toBe(22);
  });

  it('안(VARI 3)은 양의 쪽으로, 가로(VARI 2)는 Z로 절입하고 X로 깎는다', () => {
    const bore = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 3)', 'G1 X40 Z0\nZ-10\nX30 Z-15\nZ-30\nX20'));
    // 구멍(반지름 10)에서 20까지 2 mm씩(반지름 1 mm)
    expect(cuts(bore)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const face = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 2)', 'G1 X60 Z-10\nZ-8\nX40 Z-6\nX30\nZ0\nX10'));
    // 가로 가공: MID는 Z(긴 축) 2 mm — Z0에서 -10까지 5번, 같은 Z에서 X로 깎는다
    expect(cuts(face, 2)).toEqual([-2, -4, -6, -8, -10]);
  });

  it('_ZSD[0] = 1이면 MID가 반지름 값(지름 지정에서 층이 반)', () => {
    const p = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', MONO, '_ZSD[0]=1\n'));
    expect(cuts(p)).toEqual([28, 26, 24, 22, 20, 18, 16, 14, 12, 10]);
  });

  it('찾는 꼴: 경로·_N_·_SPF가 붙은 이름, "이름:N…:N…" 구간, PROC — 못 찾으면 함께 열 파일 띠', () => {
    const named = run(prog('CYCLE95("/_N_SPF_DIR/_N_K1_SPF", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', MONO));
    expect(cuts(named).length).toBe(20);
    const nrange = run(`G71 G18 G90 G95\nT1 D1\nG0 X100 Z10\nCYCLE95("K2:N20:N60", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)\nM30\n%_N_K2_SPF\nN10 G0 X99 Z99\nN20 G1 X20 Z0\nN30 Z-10\nN40 X40 Z-15\nN50 Z-25\nN60 X60\nN70 X99\nM17\n`);
    expect(cuts(nrange)).toEqual(cuts(named));
    const proc = run(`G71 G18 G90 G95\nT1 D1\nG0 X100 Z10\nCYCLE95("K3", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)\nM30\nPROC K3\n${MONO}\nRET\n`);
    expect(cuts(proc)).toEqual(cuts(named));
    const missing = run(prog('CYCLE95("NOPE", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', MONO));
    expect(cyc(missing)).toEqual([]);
    expect(warns(missing)).toEqual(['CYCLE95: 윤곽 NOPE을(를) 찾지 못함 — 다른 파일이면 함께 열어야 읽음']);
    expect(missing.notices?.some((n) => n.kind === 'missing-program')).toBe(true);
    const badRange = run(prog('CYCLE95("A1:B1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', MONO));
    expect(warns(badRange)).toEqual(['CYCLE95: 윤곽 구간 A1:B1을(를) 찾지 못함 — 그리지 않음']);
  });

  it('알람 61002·10933·15800, 걸친 윤곽, MID 없음, 이름 없음은 경고한다', () => {
    const w = (call: string, body = MONO): string[] => warns(run(prog(call, body)));
    expect(w('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 13)')).toEqual(['CYCLE95: 가공 종류(VARI = 13)가 맞지 않음(알람 61002) — 그리지 않음']);
    expect(w('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 101)')).toEqual(['CYCLE95: 가공 종류(VARI = 101)가 맞지 않음(알람 61002) — 그리지 않음']);
    expect(w('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', 'G1 X20 Z0\nX40 Z-10')).toEqual(['CYCLE95: 윤곽 이동 블록이 3개보다 적음(알람 10933) — 그리지 않음']);
    expect(w('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', 'X20 Z0\nG1 Z-10\nX40 Z-15\nX60')).toEqual(['CYCLE95: 윤곽 첫 이동 블록에 G0~G3이 없음(알람 15800) — 그리지 않음']);
    expect(warns(run(prog('G42\nCYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', MONO)))).toContain('CYCLE95: 반경 보정(G41·G42)이 켜져 있음(알람 15800) — 그리지 않음');
    const over = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 9)', 'G1 X20 Z0\nZ-10\nX30 Z-5\nX40 Z-20\nX50'));
    expect(warns(over)).toEqual(['CYCLE95: 윤곽이 깎는 축(Z)으로 되돌아감(걸친 윤곽 — 설명서: CYCLE95로 깎을 수 없음) — 거친 깎기를 그리지 않음']);
    // 거친 깎기 없이 다듬질만(윤곽 시작으로 들어가는 G1 하나)
    expect(cuts(over)).toEqual([10]);
    expect(cyc(over).length).toBeGreaterThan(4);
    expect(w('CYCLE95("K1", 0, 0, 0, 0, 0.3, 0.1, 0.2, 1)')).toEqual(['CYCLE95: 절입 깊이(MID)가 없어 거친 깎기를 그리지 않음']);
    expect(w('CYCLE95(, 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)')).toEqual(['CYCLE95: 윤곽 이름(NPP)이 없음 — 그리지 않음']);
    expect(w('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', 'G1 X20 Z0\nZ-10\nIF R1==0 GOTOF L1\nX40 Z-15\nL1:\nX60')).toEqual(['CYCLE95: 윤곽의 IF은(는) 읽지 않음 — 그리지 않음']);
    expect(w('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1)', 'G1 X20 Z0\nCIP X30 Z-10 I1=25 K1=-3\nG1 X40\nX60')).toEqual(['CYCLE95: 윤곽의 CIP은(는) 읽지 않음 — 그리지 않음']);
    expect(w('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 1, 0.5, 3)')).toEqual(['CYCLE95: 물러나는 길과 언더컷으로 옮겨 가는 길은 설명서 그림으로 정해 그림', 'CYCLE95: 칩 끊기(DT·DAM)는 그리지 않음']);
  });

  it('모따기 CHR·CHF와 원호 CR·I=AC를 윤곽에 넣는다', () => {
    const p = run(prog('CYCLE95("K1", 2, 0, 0, 0, 0.3, 0.1, 0.2, 5)', 'G1 X20 Z0\nZ-10 CHR=1\nX40 CHF=1.4142135623730951\nZ-15\nG3 X60 Z-25 CR=10\nG2 X60 Z-35 I=AC(35) K=AC(-30)\nG1 X80'));
    expect(warns(p)).toEqual([]);
    const ends = cyc(p).map((i) => moveEnd(p.moves, i).map(r4));
    // CHR=1(Z-10·반지름 10 모서리 — 두 요소를 따라 1 mm), CHF=√2(Z-10·반지름 20 모서리 — 모따기 선 √2, 직각이라 다리 1 mm)
    expect(ends).toContainEqual([10, 0, -9]);
    expect(ends).toContainEqual([11, 0, -10]);
    expect(ends).toContainEqual([19, 0, -10]);
    expect(ends).toContainEqual([20, 0, -11]);
    expect(cyc(p).filter((i) => p.moves.kind[i] === 2).length).toBe(2);
    expect(ends[ends.length - 2]).toEqual([40, 0, -35]);
  });

  it('아주 작은 MID는 층 안전장치에서 멈추고, 이동 한도에서 멈춘다', () => {
    const tiny = run(prog('CYCLE95("K1", 0.0001, 0, 0, 0, 0.3, 0.1, 0.2, 1)', MONO));
    expect(warns(tiny)).toContain('CYCLE95: 층이 10000개를 넘어 그 뒤 층은 건너뜀');
    const lim = run(prog('CYCLE95("K1", 0.01, 0, 0, 0, 0.3, 0.1, 0.2, 1)', MONO), { maxMoves: 500 });
    expect(lim.moves.count).toBe(500);
    expect(warns(lim).some((w) => /이동이 500개를 넘어/.test(w))).toBe(true);
  });

  it('cycle95Rough: 윤곽이 블랭크 겉에서 시작하면 첫 구간 없이 언더컷만', () => {
    // p 0→10에서 깊이 0 → 4 → 0(골 하나)
    const moves: [number, number, number][] = [];
    const out = cycle95Rough([0, 0, 2, 4, 8, 4, 10, 0], 0, -1, 2, 1, (k, p, q) => (moves.push([k, p, q]), true));
    expect(out).toEqual({ levels: 2, sections: 1, levelCap: false });
    // 봉우리(p 0, 깊이 0) 위 _VRT에서 FF2로 붙어 깊이 2까지 윤곽을 따라 들어가고 FF1로 깎는다
    // 깊이 2: 첫 층의 축과 나란한 깎기 끝(오르는 벽)과 둘째 층이 앞 층 깊이까지 깎아 오른 끝
    expect(moves.filter((m) => m[0] === 1 && Math.abs(m[2] - 2) < 1e-9).map((m) => m[1])).toEqual([9, 9]);
    expect(moves.filter((m) => m[0] === 2).map((m) => [m[1], m[2]])).toEqual([
      [0, 0],
      [1, 2],
      [1, 2],
      [2, 4],
    ]);
    expect(moves[moves.length - 1]).toEqual([0, -1, -1]);
  });

  it('새 경고 글은 네 언어 사전에 있다', () => {
    const texts = [
      'CYCLE95: 윤곽 이름(NPP)이 없음 — 그리지 않음',
      'CYCLE95: 가공 종류(VARI = 13)가 맞지 않음(알람 61002) — 그리지 않음',
      'CYCLE95: 반경 보정(G41·G42)이 켜져 있음(알람 15800) — 그리지 않음',
      'CYCLE95: 윤곽 이동 블록이 3개보다 적음(알람 10933) — 그리지 않음',
      'CYCLE95: 모서리 둥글리기·모따기(RND·CHF·CHR)를 넣을 수 없음 — 모서리 그대로 그림',
      'CYCLE95: 윤곽 점이 모자람 — 그리지 않음',
      'CYCLE95: 윤곽이 깎는 축(Z)으로 움직이지 않음 — 그리지 않음',
      'CYCLE95: 절입 깊이(MID)가 없어 거친 깎기를 그리지 않음',
      'CYCLE95: 윤곽이 깎는 축(Z)으로 되돌아감(걸친 윤곽 — 설명서: CYCLE95로 깎을 수 없음) — 거친 깎기를 그리지 않음',
      'CYCLE95: 층이 10000개를 넘어 그 뒤 층은 건너뜀',
      'CYCLE95: 물러나는 길과 언더컷으로 옮겨 가는 길은 설명서 그림으로 정해 그림',
      'CYCLE95: 언더컷이 있는데 축 방향 여유 FALZ가 0이 아님 — 윤곽을 시작 쪽으로 옮겨 그려 언더컷의 내려가는 벽은 여유만큼 파고들 수 있음',
      'CYCLE95: 칩 끊기(DT·DAM)는 그리지 않음',
      'CYCLE95: 윤곽 KONTUR_1을(를) 찾지 못함 — 다른 파일이면 함께 열어야 읽음',
      'CYCLE95: 윤곽 구간 A:B을(를) 찾지 못함 — 그리지 않음',
      'CYCLE95: 윤곽의 IF은(는) 읽지 않음 — 그리지 않음',
      'CYCLE95: 윤곽 첫 이동 블록에 G0~G3이 없음(알람 15800) — 그리지 않음',
      'CYCLE95: 윤곽 첫 블록에 두 축 좌표가 다 있어야 함 — 없는 축은 지금 자리로 봄',
      'CYCLE95: 윤곽 원호에 중심(I·J·K)·반지름(CR)이 없음 — 그리지 않음',
      'CYCLE95: 윤곽 블록을 읽을 수 없음 — 0으로 나눔',
    ];
    for (const t of texts) for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate('CYCLE95: 칩 끊기(DT·DAM)는 그리지 않음', 'en')).toBe('CYCLE95: chip breaking (DT, DAM) is not drawn');
  });
});
