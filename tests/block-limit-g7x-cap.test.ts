/**
 * LinuxCNC G71·G72의 구간 상한(메모리 보호)에 걸렸을 때의 경고: 이동은 한도에 닿지 않았으므로 "이동이 …개를 넘어"가 아니라 구간 경고로 그 줄에서 멈춘다.
 * 실제 상한(200만 구간)까지 가는 입력은 무거우므로 상수만 작게 바꿔 해석기 길을 본다
 */
import { describe, expect, it, vi } from 'vitest';
import { catalogs, languages, translate } from '../site/i18n.mjs';
import { parseGcode } from '../src/gcode';
import { moveEnd, type NcProgram } from '../src/model';

vi.mock('../src/lathe-g7x', async (orig) => ({ ...(await orig<typeof import('../src/lathe-g7x')>()), G7X_MAX_RUNS: 50 }));

const FREE = 8_000_000;
const teeth = (n: number): string => {
  const out = ['o100 sub', 'G1 X5 Z0'];
  for (let k = 1; k <= n; k++) out.push(`G1 X${k % 2 ? 9 : 5} Z-${(k * 0.1).toFixed(1)}`);
  out.push(`G1 X15 Z-${((n + 1) * 0.1).toFixed(1)}`, 'o100 endsub');
  return out.join('\n');
};
const lines = (code: string, R: string): string[] => ['G18 G21 G8', 'G0 X9.5 Z2', ...teeth(40).split('\n'), `${code} Q100 D0 I0.01 R${R} F0.2`, 'T0202', 'G4 P5000', 'G0 X99', 'M2'];
const run = (text: string, maxMoves = FREE): NcProgram => parseGcode(text, { dialect: 'linuxcnc', lathe: true, initialPosition: [30, 0, 30], maxMoves });
const CAP = '구간이 50개를 넘어 나머지는 읽지 않음';
const MOVES = /이동이 \d+개를 넘어/;

describe('G71·G72 구간 상한의 경고', () => {
  it.each([
    ['G71', '0.1'],
    ['G71', '0'],
    ['G71.1', '0.1'],
    ['G71.2', '0'],
  ])('%s R%s: 이동 한도 경고 없이 구간 경고 한 번, 그 줄에서 멈춘다', (code, R) => {
    const src = lines(code, R);
    const line = src.findIndex((l) => l.startsWith(`${code} Q100`)) + 1;
    const p = run(src.join('\n'));
    expect(p.moves.count).toBeGreaterThan(0);
    expect(p.moves.count).toBeLessThan(FREE);
    expect(p.warnings.filter((w) => w.includes(CAP))).toEqual([`${line}번 줄: ${CAP}`]);
    expect(p.warnings.filter((w) => MOVES.test(w))).toEqual([]);
    // 뒤 블록을 읽지 않았다
    expect(p.stats.toolChanges).toBe(0);
    expect(p.stats.dwellTime).toBe(0);
    expect(moveEnd(p.moves, p.moves.count - 1)[0]).not.toBe(99);
  });

  it('이동 한도에 먼저 닿으면 이동 한도 경고만 낸다', () => {
    const p = run(lines('G71', '0.1').join('\n'), 20);
    expect(p.moves.count).toBe(20);
    expect(p.warnings.filter((w) => w.includes('구간이'))).toEqual([]);
    expect(p.warnings.filter((w) => MOVES.test(w)).length).toBe(1);
  });

  it('상한에 걸리지 않는 프로그램은 경고가 없다', () => {
    const src = ['G18 G21 G8', 'G0 X15 Z2', 'o100 sub', 'G1 X5 Z0', 'G1 Z-10', 'G1 X10 Z-20', 'G1 X15', 'o100 endsub', 'G71 Q100 D0.5 I2 R0.5 F0.2', 'G0 X99', 'M2'];
    const p = run(src.join('\n'));
    expect(p.warnings.filter((w) => w.includes('구간이'))).toEqual([]);
    expect(moveEnd(p.moves, p.moves.count - 1)[0]).toBe(99);
  });

  it('새 경고는 네 언어로 옮긴다', () => {
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate('구간이 2000000개를 넘어 나머지는 읽지 않음', code), code).not.toMatch(/[가-힣]/);
    expect(catalogs).toBeDefined();
    expect(translate('구간이 2000000개를 넘어 나머지는 읽지 않음', 'en')).toBe('More than 2000000 roughing spans; the rest is not read');
  });
});
