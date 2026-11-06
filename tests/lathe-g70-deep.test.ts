// Fanuc 선반 G70(다듬질)이 부프로그램 호출 한도(64겹 — 이 해석기의 안전장치, 실제 Fanuc의 겹 한도는 이보다 훨씬 작다)에 닿으면
// 알리고 건너뛴다(41차 — 전에는 알림 없이 건너뜀). 다른 호출(M98·G65·o-코드)은 그 자리에서 "너무 깊음 — 멈춤"
import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { moveEnd, type NcProgram } from '../src/model';
import { languages, translate } from '../site/i18n.mjs';

const lathe = (text: string, opts = {}): NcProgram => parseGcode(text, { dialect: 'fanuc', lathe: true, initialPosition: [50, 0, 50], ...opts });
const MAIN = ['O0001', 'G21 G18', 'G0 X44 Z2', 'G71 U1.5 R0.5', 'G71 P10 Q20 U0.4 W0.1 F0.25', 'N10 G0 X12', 'G1 Z-10', 'G1 X20 Z-20', 'N20 G1 X44', 'M98 P1001', 'G0 X100 Z100', 'M30'];
/** 부프로그램 d겹(M98 사슬) 맨 안쪽에서 G70 P10 Q20(윤곽은 주 프로그램 5~8번째 줄) */
const chain = (d: number): string => {
  const lines = MAIN.slice();
  for (let k = 1; k <= d; k++) lines.push(`O${1000 + k}`, k < d ? `M98 P${1001 + k}` : 'G70 P10 Q20', 'M99');
  return lines.join('\n');
};
/** 윤곽 줄(5~8번째, 0부터)에서 나온 이동 수 — G71 뒤에는 건너뛰므로 G70이 그린 것뿐 */
const profileMoves = (p: NcProgram): number => Array.from(p.moves.line.subarray(0, p.moves.count)).filter((l) => l >= 5 && l <= 8).length;
const last = (p: NcProgram): number[] => moveEnd(p.moves, p.moves.count - 1).map((v) => Math.round(v * 1000) / 1000 + 0);
const G70_DEEP = 'G70: 부프로그램 호출이 너무 깊어 다듬질을 건너뜀';

describe('깊게 겹친 부프로그램 안의 G70', () => {
  it('한도 안(62겹)이면 그대로 다듬질, 한도에 닿으면(63겹 — 주 프로그램과 64) 그 줄에 알리고 건너뛴 뒤 이어 읽는다', () => {
    const ok = lathe(chain(62));
    expect(profileMoves(ok)).toBe(4);
    expect(ok.warnings).toEqual([]);
    const text = chain(63);
    const deep = lathe(text);
    expect(profileMoves(deep)).toBe(0);
    const at = text.split('\n').indexOf('G70 P10 Q20');
    expect(deep.warnings).toEqual([`${at + 1}번 줄: ${G70_DEEP}`]);
    // 사슬을 빠져나와 주 프로그램 끝까지
    expect(last(deep)).toEqual([50, 0, 100]);
    // 한 겹 더 깊으면 M98이 먼저 멈춘다(G70 경고 없음)
    const over = lathe(chain(64));
    expect(over.warnings.map((w) => w.replace(/^\d+번 줄: /, ''))).toEqual(['부프로그램 호출이 너무 깊음 — 멈춤']);
  });

  it('제 윤곽 범위 안의 G70(스스로 다시 부름)은 한도에서 한 번 알리고, 그린 경로는 그대로', () => {
    const text = 'G21 G18\nG0 X44 Z2\nN10 G1 X20 Z0 F0.2\nG70 P10 Q20\nN20 G1 X30 Z-10\nG0 X100 Z50\nM30';
    const p = lathe(text);
    expect(p.warnings).toEqual([`4번 줄: ${G70_DEEP}`]);
    expect(last(p)).toEqual([50, 0, 50]);
  });

  it('G70에 닿기 전 이동 한도로 멈추면 G70 경고는 없다(이동 한도 경고만)', () => {
    const cut = lathe(chain(63), { maxMoves: 5 });
    expect(cut.warnings.map((w) => w.replace(/^\d+번 줄: /, ''))).toEqual(['이동이 5개를 넘어 나머지는 읽지 않음']);
  });

  it('새 경고 글은 네 언어 사전에 있다', () => {
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(G70_DEEP, code), code).not.toMatch(/[가-힣]/);
    expect(translate(G70_DEEP, 'en')).toBe('G70: subprogram calls nested too deeply — finishing cycle skipped');
  });
});
