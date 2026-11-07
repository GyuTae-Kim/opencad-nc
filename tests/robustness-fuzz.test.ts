/**
 * 53차 대량 퍼징(로컬 표본 + 합성 씨앗 × tests/nc-mutate.ts 11종, 7,700번)에서 찾은 결함의 최소 재현(모두 직접 만든 작은 합성 입력).
 * A 식 겹침 — 괄호·변수 참조가 1천 겹쯤이면 계산이 호출 쌓기를 넘어(RangeError) 파일을 통째로 열지 못했다 → 200겹 넘으면 읽을 수 없는 블록·식
 * B 0으로 나눔·넘침·아주 큰 값 — NaN·무한 좌표가 경로·화면 좌표에 들어갔다 → 읽을 수 없는 블록, 그리지 않는 이동, 판재 값 한도
 * C 판별 정규식 — 빈 줄(CR) 수만 개·'(' 수만 개에서 글 길이의 제곱·세제곱으로 느렸다(18 KB MPR에 150초 넘음)
 * D 끝없는 고리 — 이동 없이·깨진 블록만 도는 고리가 실행 블록 한도 500만까지 돌아 15~25초 걸렸다
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { parseForView } from '../src/app/payload';
import { evalMprExpr, ExprError, GExpr } from '../src/expr';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import { detectNcFormat } from '../src/index';
import { parseMpr } from '../src/mpr';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';
import { parsePgi } from '../src/wangs';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const hangul = /[가-힣]/;
const codes = languages.filter((l: { code: string }) => l.code !== 'ko').map((l: { code: string }) => l.code);
/** 장면·이동의 좌표가 모두 유한한지 */
const finiteScene = (name: string, text: string): { ok: boolean; warnings: string[] } => {
  const r = parseForView(name, enc(text));
  let ok = true;
  for (const x of [...r.scene.meshes, ...r.scene.lines, ...(r.scene.points ?? [])]) for (const v of x.positions) if (!Number.isFinite(v)) ok = false;
  if (r.nc) for (let i = 0; i < (r.nc.moves.count + 1) * 3; i++) if (!Number.isFinite(r.nc.moves.points[i]!)) ok = false;
  const warnings = (r.nc?.warnItems ?? r.mpr?.warnItems ?? []).map((w) => (typeof w === 'string' ? w : (w as { text: string }).text));
  return { ok, warnings };
};
/** 경고 글(앞의 "N번 줄: "은 화면이 따로 옮긴다)이 네 언어에서 한국어 없이 옮겨지는지 */
const translated = (w: string): void => {
  const t = w.replace(/^\d+번 줄: /, '');
  for (const code of codes) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
};
const fanuc = (text: string) => parseGcode(text, { dialect: 'fanuc' });

describe('A 식 겹침 한도(200겹)', () => {
  const deep = (open: string, close: string, n: number, inner = '1'): string => open.repeat(n) + inner + close.repeat(n);
  it('G-code 식: 1만 겹 괄호·변수 참조는 예외 없이 읽을 수 없는 블록, 몇 겹은 그대로 셈', () => {
    const env = { get: (r: string | number) => (r === 1 ? 5 : undefined) };
    expect(() => new GExpr(deep('[', ']', 10_000), 0, env).expr()).toThrow(ExprError);
    expect(() => new GExpr(`#${'#'.repeat(10_000)}1`, 0, env).expr()).toThrow(ExprError);
    expect(new GExpr(deep('[', ']', 150, '2+3'), 0, env).expr()).toBe(5);
    // ** 사슬은 되부르지 않고 오른쪽부터(2 ** (1 ** …) = 2)
    expect(new GExpr(`2${'**1'.repeat(50_000)}`, 0, env).expr()).toBe(2);
    expect(new GExpr('2**3**2', 0, env).expr()).toBe(512);
    const p = fanuc(`G21 G90\nG0 X0 Y0 Z5\n#1=${deep('[', ']', 10_000)}\nG1 X10 F100\nM30\n`);
    expect(p.moves.count).toBe(fanuc('G21 G90\nG0 X0 Y0 Z5\nG1 X10 F100\nM30\n').moves.count);
    const w = p.warnings.find((x) => x.includes('겹보다 깊게 겹침'))!;
    expect(w).toContain('읽을 수 없는 블록');
    translated(w);
  });
  it('MPR·Heidenhain 식: 1만 겹 괄호는 ExprError, ^·NOT·부호 사슬은 되부르지 않고 같은 값', () => {
    const env = { get: () => undefined };
    expect(() => evalMprExpr(deep('(', ')', 10_000), env)).toThrow(ExprError);
    expect(evalMprExpr(deep('(', ')', 150, '2*3'), env)).toBe(6);
    expect(evalMprExpr(`2${'^1'.repeat(50_000)}`, env)).toBe(2);
    expect(evalMprExpr('2^3^2', env)).toBe(512);
    expect(evalMprExpr(`${'NOT '.repeat(50_001)}0`, env)).toBe(1);
    expect(evalMprExpr(`${'-'.repeat(50_001)}4`, env)).toBe(-4);
    expect(evalMprExpr('-2^2', env)).toBe(4);
    const h = parseHeidenhain(`0 BEGIN PGM P MM\n1 L X+0 Y+0 Z+5 FMAX\n2 Q1 = ${deep('(', ')', 10_000)}\n3 L X+10 Y+0 FMAX\n4 END PGM P MM\n`);
    expect(h.moves.count).toBe(parseHeidenhain('0 BEGIN PGM P MM\n1 L X+0 Y+0 Z+5 FMAX\n3 L X+10 Y+0 FMAX\n4 END PGM P MM\n').moves.count);
    expect(h.warnings.some((x) => x.includes('겹보다 깊게 겹침'))).toBe(true);
  });
  it('Siemens 식: 1만 겹 괄호는 읽을 수 없는 블록, NOT 사슬은 같은 값', () => {
    const p = parseSiemens(makeSource(`G17 G90\nG0 X0 Y0 Z5\nR1=${deep('(', ')', 10_000)}\nR2=NOT NOT NOT 0\nG1 X=R2*10 F100\nM30\n`));
    expect(p.warnings.some((x) => x.includes('겹보다 깊게 겹침'))).toBe(true);
    // NOT 셋 = 1 → X10
    const e = p.moves.points.slice(p.moves.count * 3, p.moves.count * 3 + 3);
    expect(Array.from(e)).toEqual([10, 0, 5]);
  });
});

describe('B 수가 아니거나 아주 큰 값', () => {
  it('Fanuc 0으로 나눈 변수는 대입을 읽지 않고(경고), 빈 변수인 X는 빠진다 — NaN 좌표 없음', () => {
    const r = finiteScene('d.nc', 'G21 G90 G17\nG0 X0 Y0 Z5\n#3=1/0\nG1 X#3 Y10 F100\n#4=1E300*1E300\nG1 X#4\nM30\n');
    expect(r.ok).toBe(true);
    const w = r.warnings.find((x) => x.includes('유한한 수가 아님'))!;
    expect(w).toBeTruthy();
    translated(w);
  });
  it('Heidenhain 넘친 Q 값·LinuxCNC 1/0 값도 읽을 수 없는 블록', () => {
    const h = finiteScene('h.h', '0 BEGIN PGM P MM\n1 L X+0 Y+0 Z+5 FMAX\n2 Q1 = 1E300 * 1E300\n3 Q2 = 1E999\n4 L X+Q1 Y+Q2 FMAX\n5 L X+5 Y+5 FMAX\n6 END PGM P MM\n');
    expect(h.ok).toBe(true);
    expect(h.warnings.some((x) => x.includes('유한한 수가 아님'))).toBe(true);
    const l = finiteScene('l.ngc', 'G21 G90\n#<a> = [1/0]\nG1 X#<a> F100\nG1 X5 Y5\nM2\n');
    expect(l.ok).toBe(true);
  });
  it('32비트 실수로 나타낼 수 없는 좌표(아주 긴 수 글)의 이동은 그리지 않고 알린다 — 다음 이동부터 다시', () => {
    const r = finiteScene('big.nc', `G21 G90\nG0 X0 Y0 Z5\nG1 X${'9'.repeat(60)} F100\nG1 X10 Y10\nM30\n`);
    expect(r.ok).toBe(true);
    const w = r.warnings.find((x) => x.includes('너무 커서'))!;
    expect(w).toBeTruthy();
    translated(w);
    const p = fanuc(`G21 G90\nG0 X0 Y0 Z5\nG1 X${'9'.repeat(60)} F100\nG1 X10 Y10\nM30\n`);
    expect(p.moves.count).toBe(fanuc('G21 G90\nG0 X0 Y0 Z5\nG1 F100\nG1 X10 Y10\nM30\n').moves.count);
    expect(Array.from(p.moves.points.slice(p.moves.count * 3))).toEqual([10, 10, 5]);
  });
  it('판재 값 한도(1e7): MPR 지름 1e308·PGI 판 두께 1e308은 읽을 수 없는 값으로 알리고, 구멍 개수 AN은 따로 막는다', () => {
    const head = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n<100 \\WerkStck\\\nLA="200"\nBR="100"\nDI="19"\n`;
    const m = parseMpr(`${head}<102 \\BohrVert\\\nXA="50"\nYA="50"\nTI="10"\nDU="1E308"\nAN="1"\n!\n`);
    const w = m.warnings.find((x) => x.includes('너무 큼'))!;
    expect(w).toBeTruthy();
    translated(w);
    expect(finiteScene('m.mpr', `${head}<102 \\BohrVert\\\nXA="50"\nYA="1E308"\nTI="10"\nDU="8"\nAN="1"\n!\n`).ok).toBe(true);
    const pgi = '<pgi><panel length="600" width="400" thickness="1E308"><outlines/></panel></pgi>';
    expect(() => parsePgi(pgi)).toThrow('판 크기(thickness)');
  });
});

describe('C 판별 정규식(빈 줄·괄호 수만 개)', () => {
  it('CR 6만 개 뒤의 G-code·MPR, 괄호 6만 개 줄도 2초 안에 판별하고 연다', () => {
    const crs = '\r'.repeat(60_000);
    const cases: [string, string][] = [
      ['c.nc', `${crs}\nG21 G90\nG1 X10 Y10 F100\nM30\n`],
      ['s.nc', `G21 G90\n${' '.repeat(60_000)}G1 X1\nM30\n`],
      ['p.nc', `G21 G90\n${'('.repeat(60_000)}\nG1 X10 F100\nM30\n`],
      ['m.mpr', `[H\r\nVERSION="4.0 Alpha"\r\n${crs}\r\n<100 \\WerkStck\\\r\nLA="200"\r\nBR="100"\r\nDI="19"\r\n!\r\n`],
    ];
    for (const [name, text] of cases) {
      const t0 = performance.now();
      detectNcFormat(name, enc(text));
      parseForView(name, enc(text));
      expect(performance.now() - t0, name).toBeLessThan(2000);
    }
    // 줄여 봐도 판별은 같다
    expect(detectNcFormat('x', enc(`${crs}\n0 BEGIN PGM P MM\n1 L X+1 FMAX\n2 END PGM P MM\n`))).toBe('heidenhain');
    expect(detectNcFormat('x.nc', enc(`(${' '.repeat(100)}HAAS VF2)\nG0 X1\n`))).toBe('gcode');
  });
});

describe('D 끝없는 고리', () => {
  it('이동 없이 도는 고리(Fanuc GOTO·Siemens LOOP·Heidenhain 점프)는 줄 수 + 10만 블록에서 멈추고 알린다', () => {
    const t0 = performance.now();
    const f = fanuc('G21 G90\nG0 X0 Y0 Z5\nG1 X1 F100\nN1 #1=#1+1\nGOTO1\nM30\n');
    const s = parseSiemens(makeSource('G17 G90\nG0 X0 Y0 Z5\nG1 X1 F100\nLOOP\nR1=R1+1\nENDLOOP\nM30\n'));
    const h = parseHeidenhain('0 BEGIN PGM P MM\n1 L X+0 Y+0 Z+5 FMAX\n2 L X+1 FMAX\n3 LBL 1\n4 Q1 = Q1 + 1\n5 FN 9: IF +0 EQU +0 GOTO LBL 1\n6 END PGM P MM\n');
    expect(performance.now() - t0).toBeLessThan(4000);
    for (const p of [f, s, h]) {
      // 고리 앞 이동은 그대로, 블록 한도(수백만)까지 돌지 않는다
      expect(Array.from(p.moves.points.slice(p.moves.count * 3))).toEqual([1, 0, 5]);
      expect(p.warnings.some((x) => x.includes('실행 블록이'))).toBe(false);
      const w = p.warnings.find((x) => x.includes('이동 없이'))!;
      expect(w).toMatch(/이동 없이 1000\d\d블록 넘게 실행해 멈춤/);
      translated(w);
    }
  });
  it('깨진 블록만 되풀이하는 고리는 줄 수 + 1만 번에서 멈춘다(고리가 아니면 줄 수를 넘지 않아 멈추지 않음)', () => {
    const p = fanuc('G21 G90\nG0 X0 Y0 Z5\nG1 X1 F100\nWHILE[1EQ1]DO1\nG1 X[\nG1 X2\nG1 X1\nEND1\nM30\n');
    const w = p.warnings.find((x) => x.includes('읽을 수 없는 블록을'))!;
    expect(w).toMatch(/읽을 수 없는 블록을 100\d\d번 넘게 실행해 멈춤/);
    translated(w);
    expect(p.warnings.some((x) => x.includes('실행 블록이'))).toBe(false);
    // 깨진 블록 2만 줄이 고리 없이 이어진 프로그램은 끝까지 읽는다
    const lines = Array.from({ length: 20_000 }, () => 'G1 X[');
    const q = fanuc(`G21 G90\nG0 X0 Y0 Z5\n${lines.join('\n')}\nG1 X5 F100\nM30\n`);
    expect(Array.from(q.moves.points.slice(q.moves.count * 3))).toEqual([5, 0, 5]);
    expect(q.warnings.some((x) => x.includes('읽을 수 없는 블록을'))).toBe(false);
  });
});
