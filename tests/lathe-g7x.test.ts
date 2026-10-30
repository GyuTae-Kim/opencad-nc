/**
 * LinuxCNC 선반 G70·G71·G72(.1·.2) — 윤곽은 o-코드 서브루틴 Q(LinuxCNC 설명서 G-code 절 "G70 Lathe finishing cycle"·
 * "G71 G72 Lathe roughing cycles"의 꼴로 쓴 짧은 합성 프로그램). 경로 끝점·층 깊이·떨어진 윤곽 값을 본다.
 */
import { describe, expect, it } from 'vitest';
import { catalogs, languages, translate } from '../site/i18n.mjs';
import { detectGcodeDialect, detectLathe, parseGcode } from '../src/gcode';
import { g7xCorners, g7xLine, g7xMonotonic, g7xOffset, g7xRough, type G7xEl } from '../src/lathe-g7x';
import { MOVE_ARC, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const linux = (text: string, opts = {}): NcProgram => parseGcode(text, { dialect: 'linuxcnc', lathe: true, initialPosition: [30, 0, 30], ...opts });
/** 줄 line의 이동: [종류(R 급속·F 이송·A 원호), X 반지름, Z] */
const movesOn = (p: NcProgram, line: number): [string, number, number][] => {
  const out: [string, number, number][] = [];
  for (let i = 0; i < p.moves.count; i++) {
    if (p.moves.line[i] !== line) continue;
    const e = moveEnd(p.moves, i);
    out.push([p.moves.kind[i] === MOVE_RAPID ? 'R' : p.moves.kind[i] === MOVE_ARC ? 'A' : 'F', r3(e[0]), r3(e[2])]);
  }
  return out;
};
const texts = (p: NcProgram): string[] => (p.warningItems ?? []).map((w) => w.text);

/** 바깥지름 윤곽(반지름): Z0에서 X5, Z-10까지 원통, Z-20에서 X10으로 비스듬히, 어깨 X15 */
const SUB100 = `o100 sub
G1 X5 Z0
G1 Z-10
G1 X10 Z-20
G1 X15
o100 endsub`;

describe('LinuxCNC G71·G70 (o-코드 윤곽)', () => {
  it('G71: 시작점에서 I씩 층으로 깎고(끝은 D만큼 떨어진 윤곽), 떨어진 윤곽을 따라가 그 끝에 선다. G70은 윤곽 그대로', () => {
    const p = linux(`G18 G21 G8
G0 X15 Z2
${SUB100}
G71 Q100 D0.5 I2 R0.5 F0.2
G70 Q100 X15 Z2
M2`);
    expect(p.lathe).toBe(true);
    const g71 = movesOn(p, 8);
    // 층 X 13·11·9·7(반지름, 떨어진 윤곽의 가장 깊은 점 5.5 앞까지) × 4이동 + 떨어진 윤곽(급속 1 + 3)
    expect(g71).toHaveLength(4 * 4 + 4);
    expect(g71.slice(0, 4)).toEqual([
      ['R', 13, 2],
      ['F', 13, -19.5],
      ['F', 13.5, -19],
      ['R', 13.5, 2],
    ]);
    // 층 깊이와 절삭 끝(윤곽 사선을 0.5 떨어뜨린 선과 만나는 Z)
    expect(g71.filter((_, i) => i < 16 && i % 4 === 1)).toEqual([
      ['F', 13, -19.5],
      ['F', 11, -19.5],
      ['F', 9, -16.882],
      ['F', 7, -12.882],
    ]);
    // 떨어진 윤곽: 원통 X5.5, 사선과 어깨는 교점까지 자르고, 끝은 어깨 Z-20에서 0.5 떨어진 Z-19.5
    expect(g71.slice(16)).toEqual([
      ['R', 5.5, 0],
      ['F', 5.5, -9.882],
      ['F', 10.309, -19.5],
      ['F', 15, -19.5],
    ]);
    // G70: X·Z 자리로 급속 → 윤곽 시작으로 급속 → 윤곽(D·E 기본 0) → 윤곽 끝에 선다
    expect(movesOn(p, 9)).toEqual([
      ['R', 15, 2],
      ['R', 5, 0],
      ['F', 5, -10],
      ['F', 10, -20],
      ['F', 15, -20],
    ]);
    // 서브루틴 줄(0부터 센 2~7번)은 주 프로그램에서 실행하지 않는다
    expect(Array.from(p.moves.line).filter((l) => l >= 2 && l <= 7)).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it('G7 지름 모드: X는 지름(같은 경로), D·I·R은 반지름 거리로 보고 경고. 설명서에 없는 낱말(J·L)도 경고', () => {
    const p = linux(`G18 G21 G7
G0 X30 Z2
o100 sub
G1 X10 Z0
G1 Z-10
G1 X20 Z-20
G1 X30
o100 endsub
G71 Q100 D0.5 I2 R0.5 J1 L2 F0.2
M2`);
    const g71 = movesOn(p, 8);
    expect(g71).toHaveLength(20);
    expect(g71[1]).toEqual(['F', 13, -19.5]);
    expect(g71[g71.length - 1]).toEqual(['F', 15, -19.5]);
    expect(texts(p)).toEqual(['G71: LinuxCNC 설명서에 없는 낱말 J·L — 읽지 않음', 'G71: 지름 모드(G7)에서 D·I·R는 반지름 거리로 봄(설명서에 정해지지 않음)']);
  });

  it('I·R·D를 빼면 기본값(절입 1, 물러남 0.5, 남길 거리 0)', () => {
    const p = linux(`G18 G21\nG0 X8 Z1\n${SUB100}\nG71 Q100 F0.2\nM2`);
    const g71 = movesOn(p, 8);
    // 층 X 7·6(5 = 윤곽 맨 아래 앞까지) × 4 + 윤곽(급속 1 + 3)
    expect(g71).toHaveLength(2 * 4 + 4);
    expect(g71.slice(0, 4)).toEqual([
      ['R', 7, 1],
      ['F', 7, -14],
      ['F', 7.5, -13.5],
      ['R', 7.5, 1],
    ]);
    expect(g71[g71.length - 1]).toEqual(['F', 15, -20]);
  });

  it('G70 P2 D1: 차례마다 (차례-1)(D-E)/P+E 떨어진 윤곽(먼저 0.5, 마지막 E = 0), 차례 사이에 시작점으로 급속', () => {
    const p = linux(`G18 G21\nG0 X15 Z2\n${SUB100}\nG70 Q100 D1 E0 P2 F0.1\nM2`);
    expect(movesOn(p, 8)).toEqual([
      ['R', 5.5, 0],
      ['F', 5.5, -9.882],
      ['F', 10.309, -19.5],
      ['F', 15, -19.5],
      ['R', 15, 2],
      ['R', 5, 0],
      ['F', 5, -10],
      ['F', 10, -20],
      ['F', 15, -20],
    ]);
  });

  it('G70 E: 볼록한 모서리는 반지름 E인 호로 잇고 오목한 모서리는 교점까지 자른다', () => {
    const p = linux(`G18 G21
G0 X15 Z2
o100 sub
G1 X5 Z0
G1 Z-10
G1 X10
G1 Z-20
o100 endsub
G70 Q100 E0.5 F0.1
M2`);
    const g70 = movesOn(p, 8);
    expect(g70).toEqual([
      ['R', 5.5, 0],
      ['F', 5.5, -9.5],
      ['F', 10, -9.5],
      ['A', 10.5, -10],
      ['F', 10.5, -20],
    ]);
    const ai = Array.from(p.moves.kind).indexOf(MOVE_ARC);
    const a = p.moves.arc[ai]!;
    expect([r3(p.arcs.center[a * 3]!), r3(p.arcs.center[a * 3 + 2]!)]).toEqual([10, -10]);
    expect(r3(p.arcs.sweep[a]!)).toBe(r3(Math.PI / 2));
  });

  it('윤곽의 A(둥글리기)·C(모따기 — 같은 크기 둥글리기와 두 끝이 같음)', () => {
    const p = linux(`G18 G21
G0 X15 Z2
o400 sub
G1 X5 Z0
G1 Z-10 A2
G1 X10 C1
G1 Z-20
o400 endsub
G70 Q400 X15 Z2 F0.1
M2`);
    // X15 Z2는 지금 자리라 급속 이동이 없다
    expect(movesOn(p, 8)).toEqual([
      ['R', 5, 0],
      ['F', 5, -8],
      ['A', 7, -10],
      ['F', 9, -10],
      ['F', 10, -11],
      ['F', 10, -20],
    ]);
    const a = p.moves.arc[Array.from(p.moves.kind).indexOf(MOVE_ARC)]!;
    expect([r3(p.arcs.center[a * 3]!), r3(p.arcs.center[a * 3 + 2]!)]).toEqual([7, -8]);
    expect(r3(p.arcs.sweep[a]!)).toBe(r3(-Math.PI / 2));
    expect(p.warnings).toEqual([]);
    // 앞뒤 이동보다 큰 둥글리기는 넣지 않고 경고
    const big = linux(`G18 G21\nG0 X15 Z2\no1 sub\nG1 X5 Z0\nG1 Z-10 A20\nG1 X10\no1 endsub\nG70 Q1 F0.1\nM2`);
    expect(texts(big)).toEqual(['G70: 모서리 둥글리기·모따기(A·C)를 넣을 수 없음 — 모서리 그대로 그림']);
    expect(movesOn(big, 7).slice(-2)).toEqual([
      ['F', 5, -10],
      ['F', 10, -10],
    ]);
  });

  it('윤곽 안의 원호(G2·G3)는 원호 그대로 따라가고, D만큼 떨어지면 반지름이 바뀐다(볼록한 어깨는 반지름 D인 호로 이음)', () => {
    const p = linux(`G18 G21
G0 X15 Z2
o100 sub
G1 X5 Z0
G1 Z-5
G2 X10 Z-10 R5
G1 Z-20
o100 endsub
G71 Q100 D0.5 I5 F0.2
G70 Q100 F0.1
M2`);
    const ai = Array.from(p.moves.kind).indexOf(MOVE_ARC);
    expect(p.moves.line[ai]).toBe(8);
    const a = p.moves.arc[ai]!;
    // 오목한 R5(중심 X10 Z-5) — 시작점 쪽으로 0.5 떨어지면 R4.5, 원호 끝 어깨(볼록)는 중심 X10 Z-10 R0.5 호로 잇는다
    expect([r3(p.arcs.center[a * 3]!), r3(p.arcs.center[a * 3 + 2]!)]).toEqual([10, -5]);
    expect(movesOn(p, 8).slice(-4)).toEqual([
      ['F', 5.5, -5],
      ['A', 10, -9.5],
      ['A', 10.5, -10],
      ['F', 10.5, -20],
    ]);
    expect(movesOn(p, 9).slice(-3)).toEqual([
      ['F', 5, -5],
      ['A', 10, -10],
      ['F', 10, -20],
    ]);
  });
});

describe('LinuxCNC G72 (단면 거친 깎기)', () => {
  it('Z 방향으로 I씩 층, X 방향으로 깎고 윤곽(X가 한 방향)을 따라가 끝에 선다', () => {
    const p = linux(`G18 G21
G0 X26 Z2
o200 sub
G1 X25 Z-6
G1 X10
G1 Z0
o200 endsub
G72 Q200 I2 R0.5 F0.2
M2`);
    const g72 = movesOn(p, 7);
    expect(g72).toHaveLength(3 * 4 + 3);
    expect(g72.filter((_, i) => i < 12 && i % 4 === 1)).toEqual([
      ['F', 10, 0],
      ['F', 10, -2],
      ['F', 10, -4],
    ]);
    expect(g72.slice(0, 4)).toEqual([
      ['R', 26, 0],
      ['F', 10, 0],
      ['F', 10.5, 0.5],
      ['R', 26, 0.5],
    ]);
    expect(g72.slice(12)).toEqual([
      ['R', 25, -6],
      ['F', 10, -6],
      ['F', 10, 0],
    ]);
  });
});

/** 오목한 곳(포켓)이 있는 윤곽: X8 Z-6 꼭대기 뒤 X6 바닥(Z-10~-14), Z-18에서 X10 */
const POCKET = `o300 sub
G1 X5 Z0
G1 X8 Z-6
G1 X6 Z-10
G1 Z-14
G1 X10 Z-18
o300 endsub`;

describe('LinuxCNC G71 포켓(G71 전부·G71.1 포켓 빼고·G71.2 포켓만)', () => {
  const run = (g: string): NcProgram => linux(`G18 G21\nG0 X12 Z2\n${POCKET}\n${g} Q300 I1 R0.5 F0.2\nM2`);
  it('G71: 열린 층(6개)을 깎은 뒤 포켓을 위 층을 따라 내려가 깎고, 시작점으로 올라와 윤곽', () => {
    const p = run('G71');
    const m = movesOn(p, 9);
    expect(m.slice(0, 24).filter((_, i) => i % 4 === 1)).toEqual([
      ['F', 11, -18],
      ['F', 10, -18],
      ['F', 9, -17],
      ['F', 8, -6],
      ['F', 7, -4],
      ['F', 6, -2],
    ]);
    expect(m.slice(24, 35)).toEqual([
      ['R', 9.5, 2],
      ['R', 9.5, -6],
      ['F', 8, -6],
      ['F', 8, -16],
      ['F', 8.5, -15.5],
      ['R', 8.5, -8],
      ['F', 7, -8],
      ['F', 7, -15],
      ['F', 7.5, -14.5],
      ['R', 12, -14.5],
      ['R', 12, 2],
    ]);
    expect(m.slice(35)).toEqual([
      ['R', 5, 0],
      ['F', 8, -6],
      ['F', 6, -10],
      ['F', 6, -14],
      ['F', 10, -18],
    ]);
    expect(texts(p)).toEqual(['G71: 오목한 곳(포켓)에 들어가는 차례는 설명서에 없어 위 층을 따라 내려가게 그림']);
  });
  it('G71.1은 포켓을 깎지 않고 꼭대기에서 멈추고, G71.2는 포켓만 깎고 거기서 이어 윤곽 끝까지', () => {
    const p1 = movesOn(run('G71.1'), 9);
    expect(p1).toHaveLength(24 + 2);
    expect(p1.slice(24)).toEqual([
      ['R', 5, 0],
      ['F', 8, -6],
    ]);
    const p2 = run('G71.2');
    const m2 = movesOn(p2, 9);
    expect(m2.slice(0, 2)).toEqual([
      ['R', 9.5, 2],
      ['R', 9.5, -6],
    ]);
    expect(m2.slice(-4)).toEqual([
      ['R', 8, -6],
      ['F', 6, -10],
      ['F', 6, -14],
      ['F', 10, -18],
    ]);
    expect(texts(p2)).toContain('G71.2: 멈추고 이어 깎는 자리는 설명서에 자세히 없어 윤곽이 처음 다시 깊어지는 꼭짓점으로 봄');
  });
});

describe('LinuxCNC G71 — 설명서의 오류 조건과 다른 방언', () => {
  it('윤곽이 앞뒤로 오가면·서브루틴이 없으면·Q가 없으면 경고(LinuxCNC는 오류)하고 사이클을 그리지 않는다', () => {
    const p = linux(`G18 G21
G0 X15 Z2
o500 sub
G1 X5 Z0
G1 Z-10
G1 Z-5
o500 endsub
G71 Q500
G71 Q999
G71 D1
M2`);
    expect(movesOn(p, 7)).toEqual([]);
    expect(movesOn(p, 8)).toEqual([]);
    expect(movesOn(p, 9)).toEqual([]);
    expect(texts(p)).toEqual([
      'G71: 윤곽의 Z가 한 방향으로만 바뀌지 않음 — LinuxCNC는 오류(사이클을 그리지 않음)',
      'G71: 윤곽 서브루틴 o999 sub를 찾지 못함 — LinuxCNC는 오류',
      'G71에 윤곽 서브루틴 번호 Q가 없음 — LinuxCNC는 오류',
    ]);
  });
  it('반경 보정 중·G18이 아닌 평면은 경고(그림은 그린다)', () => {
    const p = linux(`G18 G21\nG0 X15 Z2\n${SUB100}\nG41\nG71 Q100 I2 F0.2\nG40 G17\nG70 Q100\nM2`);
    expect(movesOn(p, 9).length).toBeGreaterThan(0);
    expect(movesOn(p, 11).length).toBeGreaterThan(0);
    expect(texts(p)).toContain('G71: 반경 보정(G41/G42) 중 — LinuxCNC는 오류');
    expect(texts(p)).toContain('G70: G18(ZX) 평면이 아님 — LinuxCNC는 오류(ZX 단면으로 그림)');
  });
  it('설명서 문제 보고(D를 쓴 G71에 반원이 생기던 것)와 같은 꼴: 앞면을 내려와 원뿔로 오르는 윤곽은 반원 없이 D만큼 떨어진다', () => {
    const p = linux(`G18 G21 G8
G0 Z14.4
o100 sub
G1 X14.3 Z12.5
G1 X0.01
G1 Z0 X14.325
G1 X15
o100 endsub
G71 Q100 X14.3 Z12.5 D0.25 I2 R1 F0.1
M2`);
    const m = movesOn(p, 8);
    expect(m.some((x) => x[0] === 'A')).toBe(false);
    expect(m[0]).toEqual(['R', 14.3, 12.5]);
    // 첫 층 X12.3은 0.25 떨어진 원뿔과 Z2.1에서 만난다
    expect(m.slice(1, 3)).toEqual([
      ['R', 12.3, 12.5],
      ['F', 12.3, 2.1],
    ]);
    // 떨어진 윤곽: 앞면은 Z12.25, 끝(X15 어깨)은 Z0.25
    expect(m[m.length - 4]).toEqual(['R', 14.3, 12.25]);
    expect(m[m.length - 1]).toEqual(['F', 15, 0.25]);
  });
  it('LinuxCNC 판별·선반 판별은 그대로, GRBL·밀링·Fanuc의 G70~G72는 예전과 같다', () => {
    const prog = `(LinuxCNC lathe)\nG18 G7 G21\nG96 D2500 S200 M3\nG0 X30 Z2\n${SUB100}\nG71 Q100 D0.5 I1\nG70 Q100\nM2`;
    expect(detectGcodeDialect(prog)).toBe('linuxcnc');
    expect(detectLathe(prog)).toBe(true);
    expect(parseGcode(prog, { lathe: 'auto' }).lathe).toBe(true);
    const grbl = parseGcode(`G18 G21\nG0 X15 Z2\nG71 Q100\nM2`, { dialect: 'grbl', lathe: true });
    expect(texts(grbl)).toContain('G71(LinuxCNC 선반 사이클)은 지원하지 않음');
    const mill = parseGcode(`G21\nG0 X15 Z2\nG71 Q100\nM2`, { dialect: 'linuxcnc' });
    expect(texts(mill)).toContain('지원하지 않는 G71');
    const g73 = linux(`G18 G21\nG0 X15 Z2\nG73 Q100\nM2`);
    expect(texts(g73)).toContain('G73(LinuxCNC 선반 사이클)은 지원하지 않음');
  });
  it('새 경고 문구는 모든 언어 사전에 있다', () => {
    const progs = [
      linux(`G18 G21 G7\nG0 X30 Z2\n${SUB100}\nG41\nG71 Q100 D0.5 I0 J1 F0.2\nG40\no9 sub\nG1 X5 Z0\nG1 Z-10 A30\nG1 Z-5\no9 endsub\nG71 Q9\nG71 Q8\nG71\nG17\nG70 Q100 E0.5\nM2`),
      linux(`G18 G21\nG0 X12 Z2\n${POCKET}\nG71.1 Q300 F0.2\nG71 Q300\nM2`),
    ];
    const all = progs.flatMap(texts).filter((t) => /^G7[0-2]/.test(t));
    expect(new Set(all).size).toBeGreaterThanOrEqual(12);
    for (const { code } of languages.filter((l) => l.code !== 'ko'))
      for (const t of all) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate('G71: 윤곽 서브루틴 o999 sub를 찾지 못함 — LinuxCNC는 오류', 'en')).toBe('G71: contour subroutine o999 sub not found — an error in LinuxCNC');
    expect(Object.keys(catalogs.en).length).toBeGreaterThan(0);
  });
});

describe('lathe-g7x 기하', () => {
  const L = g7xLine;
  it('한 방향 검사: 원호는 그 축의 끝값에서 나눠 본다', () => {
    const up: G7xEl[] = [L(0, 5, -10, 5), L(-10, 5, -20, 10)];
    expect(g7xMonotonic(up, 0, 1e-9)).toBe(-1);
    expect(g7xMonotonic(up, 1, 1e-9)).toBe(1);
    // 중심 (-10, 5), 반지름 5, (-5, 5)에서 반시계 180° → (-15, 5): u는 -5 → -15로 가지만 v는 5 → 10 → 5(오가는 원호)
    const half: G7xEl = { arc: true, su: -5, sv: 5, eu: -15, ev: 5, cu: -10, cv: 5, sweep: Math.PI };
    expect(g7xMonotonic([half], 0, 1e-9)).toBe(-1);
    expect(g7xMonotonic([half], 1, 1e-9)).toBe(0);
  });
  it('떨어진 곡선: 직선은 평행, 원호는 같은 중심에 반지름 ± d, 볼록한 모서리는 호', () => {
    const off = g7xOffset([L(0, 5, -10, 5), L(-10, 5, -10, 10), L(-10, 10, -20, 10)], 0.5, -1);
    expect(off.map((e) => [e.arc, r3(e.su), r3(e.sv), r3(e.eu), r3(e.ev)])).toEqual([
      [false, 0, 5.5, -9.5, 5.5],
      [false, -9.5, 5.5, -9.5, 10],
      [true, -9.5, 10, -10, 10.5],
      [false, -10, 10.5, -20, 10.5],
    ]);
    const arc: G7xEl = { arc: true, su: -5, sv: 5, eu: -10, ev: 10, cu: -5, cv: 10, sweep: -Math.PI / 2 };
    const o = g7xOffset([arc], 0.5, -1)[0]!;
    expect([r3(o.su), r3(o.sv), r3(o.eu), r3(o.ev)]).toEqual([-5, 5.5, -9.5, 10]);
  });
  it('모서리 둥글리기가 앞뒤 요소보다 크면 그대로 두고 센다', () => {
    const r = g7xCorners([L(0, 5, -10, 5), L(-10, 5, -10, 6)], [{ at: 0, kind: 'round', size: 3 }]);
    expect(r.failed).toBe(1);
    expect(r.els).toHaveLength(2);
  });
  it('거친 깎기 층 수 한도와 절입 0', () => {
    const pts = [0, 0, -10, 0];
    expect(g7xRough(pts, [2, 10], 1, -1, 0, 0.5, 0).moves).toEqual([]);
    expect(g7xRough(pts, [2, 10], 1, -1, 1, 0.5, 0, 3).levels).toBe(3);
  });
});
