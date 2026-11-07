// Fanuc 선반 G71·G72 II형(43차): FANUC Series 0i-F 선반 조작 설명서(B-64604EN-1/01) 4.2.1절 "Stock Removal in Turning (G71)"(52~65쪽)·
// 4.2.2절 "Stock Removal in Facing (G72)"(66~69쪽).
// - 윤곽 첫 블록(ns)에 한 축만(G71은 X(U), G72는 Z(W)) 지령하면 I형, 두 축 모두(움직이지 않으면 W0·U0) 지령하면 II형(55·69쪽)
// - II형 윤곽은 절삭 축(G71 = Z, G72 = X)으로 한 방향으로만 바뀌어야 하고(아니면 알람 — 54·57쪽), 단계 축으로는 오목한 곳(포켓)이 있어도 된다(57쪽)
// - 층을 절삭 축으로 깎은 뒤 공구가 윤곽을 따라 깎고 이송으로 물러난다(58쪽 (3)), 포켓은 시작점에서 가까운 것부터 하나씩(60쪽 주의 1),
//   거친 깎기가 끝나면 시작점으로 돌아가 다듬질 윤곽을 따라간다(58쪽 (5))
// 따라 깎는 끝(앞 층 높이)·물러나는 방향(단계 축)·포켓에 들어가는 길은 설명서 그림으로만 보여 정한 대로 그리고 알린다
import { describe, expect, it } from 'vitest';
import { parseGcode, type GcodeOptions } from '../src/gcode';
import { moveEnd, moveStart, MOVE_RAPID, type NcProgram } from '../src/model';
import { g71Type2, polyMonotonic } from '../src/lathe-g7x';
import { languages, translate } from '../site/i18n.mjs';

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
const opts: GcodeOptions = { dialect: 'fanuc', lathe: true, initialPosition: [30, 0, 50] };
const run = (text: string, o: GcodeOptions = opts): NcProgram => parseGcode(text, o);
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
/** 이동마다 [급속 1·이송 0, X 반지름, Z] */
const path = (p: NcProgram): number[][] => Array.from({ length: p.moves.count }, (_, i) => {
  const e = moveEnd(p.moves, i);
  return [p.moves.kind[i] === MOVE_RAPID ? 1 : 0, r6(e[0]!), r6(e[2]!)];
});
const TYPE2 = (n: string, ax: string): string => `${n}: 윤곽 첫 블록에 X·Z가 있어 II형으로 그림 — 층 끝에서 윤곽을 따라 앞 층 높이까지 깎고 ${ax}로 물러나는 길은 설명서 그림으로 정함`;
const POCKET = (n: string): string => `${n}: II형 포켓에 들어가는 길은 설명서에 그림으로만 있어 위 층에서 곧게 내려가게 그림`;
const prog = (body: string, first: string, cyc = 'G71 U2 R0.5\nG71 P10 Q20 U0 W0 F0.2'): string => `G21 G18\nG0 X44 Z2\n${cyc}\n${first}\n${body}\nG0 X99\nM30`;

/**
 * 깎은 경로가 다듬질 윤곽(반지름·Z 점열) 안(부품 쪽)으로 들어가지 않는지: 단계 축 s(0 = X, 2 = Z)·살 쪽 방향 dir로,
 * 절삭 축 c 자리마다 윤곽의 가장 살 쪽 값을 경계로 본다(세운 벽은 그 자리 전체가 경계)
 */
function gouges(p: NcProgram, prof: number[][], s: 0 | 2, dir: number): number {
  const c = s === 0 ? 2 : 0;
  const bound = (cv: number): number | undefined => {
    let b: number | undefined;
    for (let i = 0; i + 1 < prof.length; i++) {
      const [a, q] = [prof[i]!, prof[i + 1]!];
      const ac = a[c === 0 ? 0 : 1]!;
      const qc = q[c === 0 ? 0 : 1]!;
      const as = a[s === 0 ? 0 : 1]!;
      const qs = q[s === 0 ? 0 : 1]!;
      if (cv < Math.min(ac, qc) - 1e-9 || cv > Math.max(ac, qc) + 1e-9) continue;
      const vals = Math.abs(qc - ac) < 1e-12 ? [as, qs] : [as + ((cv - ac) / (qc - ac)) * (qs - as)];
      for (const v of vals) b = b === undefined ? v : dir < 0 ? Math.min(b, v) : Math.max(b, v);
    }
    return b;
  };
  let bad = 0;
  for (let i = 0; i < p.moves.count; i++) {
    const a = moveStart(p.moves, i);
    const e = moveEnd(p.moves, i);
    for (let k = 0; k <= 16; k++) {
      const pt = [a[0]! + ((e[0]! - a[0]!) * k) / 16, 0, a[2]! + ((e[2]! - a[2]!) * k) / 16];
      const b = bound(pt[c]!);
      if (b !== undefined && dir * (pt[s]! - b) > 1e-6) bad++;
    }
  }
  return bad;
}

describe('I형·II형 고르기(윤곽 첫 블록)', () => {
  const body = 'G1 Z-10\nG1 X30 Z-20\nN20 G1 X44';
  it('X만이면 I형(지금까지의 그림 — 층 끝에서 45°로 물러남), X·Z나 X·W0이면 II형', () => {
    const one = run(prog(body, 'N10 G0 X12'));
    expect(warns(one)).toEqual([]);
    // I형 첫 층: 급속으로 X20(지름 40), Z-20까지 이송, 45°로 0.5 물러남
    expect(path(one).slice(1, 5)).toEqual([[1, 20, 2], [0, 20, -20], [0, 20.5, -19.5], [1, 20.5, 2]]);
    const two = run(prog(body, 'N10 G0 X12 Z0'));
    expect(warns(two)).toEqual([TYPE2('G71', 'X')]);
    const w0 = run(prog(body, 'N10 G0 X12 W0'));
    expect(warns(w0)).toEqual([TYPE2('G71', 'X')]);
    // W0은 Z를 움직이지 않는다: 윤곽 시작이 시작점 Z(2)라 I형과 같은 다듬질 윤곽
    expect(path(w0).slice(-4)).toEqual(path(one).slice(-4));
  });

  it('G72는 Z만이면 I형, Z·X(U0)면 II형', () => {
    const cyc = 'G72 W2 R0.5\nG72 P10 Q20 U0 W0 F0.2';
    const fb = 'G1 X30\nG1 X20 Z-10\nN20 G1 Z0';
    expect(warns(run(prog(fb, 'N10 G0 Z-20', cyc)))).toEqual([]);
    expect(warns(run(prog(fb, 'N10 G0 Z-20 X44', cyc)))).toEqual([TYPE2('G72', 'Z')]);
    expect(warns(run(prog(fb, 'N10 G0 Z-20 U0', cyc)))).toEqual([TYPE2('G72', 'Z')]);
  });
});

describe('II형 거친 깎기', () => {
  it('단조 윤곽: 층마다 Z로 깎고 윤곽을 따라 앞 층 높이까지 깎은 뒤 X로 R만큼 이송으로 물러나고, 끝나면 시작점으로 돌아가 다듬질', () => {
    const p = run(prog('G1 Z-10\nG1 X30 Z-20\nN20 G1 X44', 'N10 G0 X12 Z0'));
    const pa = path(p);
    // 첫 층(X20): Z-20 벽까지 → 벽을 따라 시작 높이(X22)까지 → X로 0.5 → 급속으로 시작 Z
    expect(pa.slice(1, 6)).toEqual([[1, 20, 2], [0, 20, -20], [0, 22, -20], [0, 22.5, -20], [1, 22.5, 2]]);
    // 테이퍼 층(X12, 지름 24): 테이퍼에서 멈춰 그 위 층(X14)까지 테이퍼를 따라 깎는다
    const k = pa.findIndex((m, i) => i > 0 && m[0] === 0 && m[1] === 12);
    expect(pa.slice(k, k + 3)).toEqual([[0, 12, -16.666667], [0, 14, -18.888889], [0, 14.5, -18.888889]]);
    // 거친 깎기 뒤 시작점(X22 Z2)으로 돌아가고, 다듬질 윤곽(A' = X6 Z0)을 따라간다
    const fin = pa.findIndex((m) => m[1] === 6 && m[2] === 0);
    expect(pa[fin - 1]).toEqual([1, 22, 2]);
    expect(pa.slice(fin, fin + 4)).toEqual([[1, 6, 0], [0, 6, -10], [0, 15, -20], [0, 22, -20]]);
    expect(gouges(p, [[6, 0], [6, -10], [15, -20], [22, -20]], 0, -1)).toBe(0);
  });

  it('포켓: 시작점 쪽 열린 곳을 다 깎은 뒤 포켓을 위 층에서 내려가 깎고, 윤곽 안으로 파고들지 않는다', () => {
    const p = run(prog('G1 Z-5\nG1 X36 Z-8\nG1 Z-12\nG1 X20 Z-16\nG1 Z-20\nG1 X40 Z-24\nN20 G1 X44', 'N10 G0 X12 Z0'));
    expect(warns(p)).toEqual([TYPE2('G71', 'X'), POCKET('G71')]);
    const prof = [[6, 0], [6, -5], [18, -8], [18, -12], [10, -16], [10, -20], [20, -24], [22, -24]];
    expect(gouges(p, prof, 0, -1)).toBe(0);
    const pa = path(p);
    // 포켓 안(Z -12 ~ -24, 혹 높이 X18 아래)을 깎는 이송이 있고, 모두 열린 곳의 마지막 층(X8)보다 뒤에 온다
    const inPocket = pa.map((m, i) => (m[0] === 0 && m[1] < 18 - 1e-9 && m[2] < -12 - 1e-9 && m[2] > -24 + 1e-9 ? i : -1)).filter((i) => i >= 0);
    const lastOpen = pa.findIndex((m) => m[0] === 0 && m[1] === 8);
    expect(inPocket.length).toBeGreaterThan(4);
    expect(lastOpen).toBeGreaterThan(0);
    // 다듬질 윤곽(끝의 이송)은 빼고 본다: 거친 깎기의 포켓 이송은 열린 곳 다음
    const finStart = pa.findIndex((m) => m[1] === 6 && m[2] === 0);
    expect(inPocket.filter((i) => i < finStart).every((i) => i > lastOpen)).toBe(true);
    // 포켓 층의 가장 깊은 깎기는 X12(층 X12 — 바닥 X10 앞)
    expect(Math.min(...inPocket.filter((i) => i < finStart).map((i) => pa[i]![1]!))).toBe(12);
  });

  it('포켓이 있는데 Z 다듬질 여유 W가 0이 아니면 설명서 주의를 알린다(G71)', () => {
    const p = run(prog('G1 Z-5\nG1 X36 Z-8\nG1 Z-12\nG1 X20 Z-16\nG1 Z-20\nG1 X40 Z-24\nN20 G1 X44', 'N10 G0 X12 Z0', 'G71 U2 R0.5\nG71 P10 Q20 U0.4 W0.1 F0.2'));
    expect(warns(p)).toContain('G71: II형 포켓이 있는데 Z 다듬질 여유 W가 0이 아님 — 설명서는 한쪽 벽을 팔 수 있다고 함');
  });

  it('Z가 오고 가는 II형 윤곽은 알람이라 그리지 않고 윤곽 블록을 건너뛴다(G72는 X)', () => {
    const p = run(prog('G1 Z-10\nG1 X30 Z-6\nN20 G1 X44 Z-20', 'N10 G0 X12 Z0'));
    expect(warns(p)).toEqual(['G71: II형 윤곽의 Z가 한 방향으로만 바뀌지 않음(알람 PS0064) — 그리지 않음']);
    expect(path(p)).toEqual([[1, 22, 2], [1, 49.5, 2]]);
    // I형은 예전처럼 그린다(바뀌지 않음)
    expect(warns(run(prog('G1 Z-10\nG1 X30 Z-6\nN20 G1 X44 Z-20', 'N10 G0 X12')))).toEqual([]);
    const g72 = run(prog('G1 X40\nG1 X44 Z-10\nG1 X30 Z-6\nN20 G1 X10', 'N10 G0 Z-20 X44', 'G72 W2 R0.5\nG72 P10 Q20 U0 W0 F0.2'));
    expect(warns(g72)).toEqual(['G72: II형 윤곽의 X가 한 방향으로만 바뀌지 않음(알람 PS0329) — 그리지 않음']);
  });

  it('G72 II형: 층마다 X로 깎고 윤곽을 따라 앞 층 높이까지 깎은 뒤 Z로 물러나며, 포켓도 윤곽 안으로 파고들지 않는다', () => {
    const cyc = 'G72 W2 R0.5\nG72 P10 Q20 U0 W0 F0.2';
    const p = run(prog('G1 X30\nG1 X20 Z-10\nN20 G1 Z0', 'N10 G0 Z-20 X44', cyc));
    const pa = path(p);
    // 둘째 층(Z-2): X10(지름 20)까지 → 윤곽을 따라 앞 층(Z0)까지 → Z로 0.5
    const k = pa.findIndex((m) => m[0] === 0 && m[2] === -2);
    expect(pa.slice(k, k + 3)).toEqual([[0, 10, -2], [0, 10, 0], [0, 10, 0.5]]);
    expect(gouges(p, [[22, -20], [15, -20], [10, -10], [10, 0]], 2, -1)).toBe(0);
    const q = run(prog('G1 X40\nG1 X38 Z-6\nG1 X32\nG1 X28 Z-14\nG1 X22\nG1 X18 Z-4\nN20 G1 X10', 'N10 G0 Z-20 X44', cyc));
    expect(warns(q)).toEqual([TYPE2('G72', 'Z'), POCKET('G72')]);
    expect(gouges(q, [[22, -20], [20, -20], [19, -6], [16, -6], [14, -14], [11, -14], [9, -4], [5, -4]], 2, -1)).toBe(0);
    // 포켓(X 16 ~ 9, 혹 높이 Z-6 아래)을 깎는 이송이 있다
    expect(path(q).some((m) => m[0] === 0 && m[2] < -6 - 1e-9 && m[1] < 16 - 1e-9 && m[1] > 9 + 1e-9)).toBe(true);
  });

  it('Haas·B 체계도 같은 규칙, 거친 깎기 층 안전장치·이동 한도는 I형과 같다', () => {
    const body = 'G1 Z-10\nG1 X30 Z-20\nN20 G1 X44';
    expect(warns(run(prog(body, 'N10 G0 X12 Z0'), { ...opts, dialect: 'haas' }))).toEqual([TYPE2('G71', 'X')]);
    expect(warns(run(prog(body, 'N10 G0 X12 Z0'), { ...opts, latheSystem: 'B' }))).toEqual([TYPE2('G71', 'X')]);
    const tiny = run(prog(body, 'N10 G0 X12 Z0', 'G71 U0.00001 R0.1\nG71 P10 Q20 U0 W0 F0.2'));
    expect(warns(tiny)).toContain('G71: 층이 9999개를 넘어 그 뒤 층은 건너뛰고 다듬질 윤곽으로 감');
    const lim = run(prog(body, 'N10 G0 X12 Z0'), { ...opts, maxMoves: 20 });
    expect(lim.moves.count).toBe(20);
    expect(lim.warnings.some((w) => w.includes('이동이 20개를 넘어 나머지는 읽지 않음'))).toBe(true);
  });
});

describe('g71Type2(점열)', () => {
  it('절삭 축 단조 검사와 빈 입력', () => {
    expect(polyMonotonic([0, 0, -1, 1, -2, 0], 0, 1e-9)).toBe(-1);
    expect(polyMonotonic([0, 0, -1, 1, -0.5, 2], 0, 1e-9)).toBe(0);
    expect(g71Type2([0, 0], [2, 10], 1, -1, 1, 0.5).moves).toEqual([]);
    expect(g71Type2([0, 0, -5, 0], [2, 10], 1, -1, 0, 0.5).moves).toEqual([]);
  });
});

describe('번역', () => {
  it('새 경고 글은 네 언어 사전에 있다', () => {
    const texts = [TYPE2('G71', 'X'), TYPE2('G72', 'Z'), POCKET('G71'), 'G71: II형 포켓이 있는데 Z 다듬질 여유 W가 0이 아님 — 설명서는 한쪽 벽을 팔 수 있다고 함', 'G71: II형 윤곽의 Z가 한 방향으로만 바뀌지 않음(알람 PS0064) — 그리지 않음'];
    for (const t of texts) for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate(POCKET('G71'), 'en')).toBe("G71: the path into type II pockets is only shown in the manual's figures — drawn going straight down from the layer above");
  });
});
