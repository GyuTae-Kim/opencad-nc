// LinuxCNC 선반 G76 나사 사이클(46차): 설명서 G-code 절 "G76 Threading Cycle"(linuxcnc.org 공개 HTML)의 글대로
// H(스프링 패스)·Q(복합 각)·E·L(끝 테이퍼)·G7 지름 모드의 I·J·K·끝 자리(구동선 끝)를 본다. 합성 프로그램으로만 시험한다
import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { MOVE_FEED, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';
import { languages, translate } from '../site/i18n.mjs';

const llathe = (text: string): NcProgram => parseGcode(text, { dialect: 'linuxcnc', lathe: true, initialPosition: [30, 0, 30] });
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
/** G76 줄(3번 줄, 0부터 2)의 이동: [종류, X, Z] */
const thread = (p: NcProgram, ln = 2): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < p.moves.count; i++) {
    if (p.moves.line[i] !== ln) continue;
    const e = moveEnd(p.moves, i);
    out.push([p.moves.kind[i]!, r3(e[0]), r3(e[2])]);
  }
  return out;
};
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, '')).filter((w) => w.startsWith('G76'));
const R = MOVE_RAPID;
const F = MOVE_FEED;
const BASE = 'G18 G21 G8\nG0 X15 Z2\nG76 P1.5 Z-20 I-0.5 J0.2 K1 R1';

describe('LinuxCNC G76', () => {
  it('패스마다 깊이로 급속 → 끝 Z까지 이송 → 구동선으로 급속 → 시작 Z, 마지막 패스 뒤는 구동선 끝(설명서: 끝 자리는 Z, 구동선 끝)', () => {
    const p = llathe(`${BASE}\nM2`);
    const m = thread(p);
    // R1 = 같은 깊이: 0.2·0.4·0.6·0.8·1 — 산 14.5에서 바깥나사(I 음수)라 안쪽으로
    expect(m.length).toBe(5 * 4 - 1);
    expect(m.slice(0, 4)).toEqual([
      [R, 14.3, 2],
      [F, 14.3, -20],
      [R, 15, -20],
      [R, 15, 2],
    ]);
    expect(m.slice(-3)).toEqual([
      [R, 13.5, 2],
      [F, 13.5, -20],
      [R, 15, -20],
    ]);
    expect(warns(p)).toEqual([]);
  });

  it('G7 지름 모드면 I·J·K도 지름 값(설명서) — 반지름 모드의 반 값과 같은 길', () => {
    const dia = llathe('G18 G21 G7\nG0 X30 Z2\nG76 P1.5 Z-20 I-1 J0.4 K2 R1\nM2');
    expect(thread(dia)).toEqual(thread(llathe(`${BASE}\nM2`)));
  });

  it('H = 스프링 패스: 나사 높이에서 H번 더', () => {
    const m = thread(llathe(`${BASE} H2\nM2`));
    expect(m.length).toBe(7 * 4 - 1);
    expect(m.filter((x) => x[0] === F && x[1] === 13.5).length).toBe(3);
    expect(m[m.length - 1]).toEqual([R, 15, -20]);
  });

  it('Q = 복합 각: 패스 시작 Z를 (깊이 − K) × tan Q만큼 깎는 방향으로 — 나사 높이 패스가 시작 Z(정한 것), 얕은 패스는 시작 쪽으로', () => {
    const p = llathe(`${BASE} Q29.5\nM2`);
    const m = thread(p);
    const t = Math.tan((29.5 * Math.PI) / 180);
    // 첫 패스(깊이 0.2): 구동선을 따라 시작 Z + 0.8 tan Q로 → 깊이로 → 끝까지
    expect(m.slice(0, 5)).toEqual([
      [R, 15, r3(2 + 0.8 * t)],
      [R, 14.3, r3(2 + 0.8 * t)],
      [F, 14.3, -20],
      [R, 15, -20],
      [R, 15, 2],
    ]);
    // 마지막 패스(깊이 1)는 시작 Z에서 바로
    expect(m.slice(-3)).toEqual([
      [R, 13.5, 2],
      [F, 13.5, -20],
      [R, 15, -20],
    ]);
    expect(warns(p)).toEqual(['G76: Q(복합 각)는 패스 시작 Z를 (깊이 − K) × tan Q만큼 깎는 방향으로 옮겨 그림(나사 높이 패스가 시작 Z — 정한 것)']);
    // 음수 Q는 반대쪽, 90도 이상은 옮기지 않음
    expect(thread(llathe(`${BASE} Q-29.5\nM2`))[0]).toEqual([R, 15, r3(2 - 0.8 * t)]);
    const q90 = llathe(`${BASE} Q90\nM2`);
    expect(thread(q90)).toEqual(thread(llathe(`${BASE}\nM2`)));
    expect(warns(q90)).toEqual(['G76: Q(복합 각)가 90도 이상 — 패스를 옮기지 않음']);
  });

  it('E·L = 끝 테이퍼: 마지막 패스가 E 거리에서 산까지(같은 각 — 얕은 패스는 짧게), 들어가는 쪽은 구동선에서 산으로 이송 뒤 테이퍼', () => {
    const m = thread(llathe(`${BASE} E2 L3\nM2`));
    // 첫 패스(깊이 0.2): 구동선 → 산(이송) → 0.2 깊이까지 테이퍼(Z 0.4) → 끝 테이퍼 시작 → 산 → 구동선
    expect(m.slice(0, 6)).toEqual([
      [F, 14.5, 2],
      [F, 14.3, 1.6],
      [F, 14.3, -19.6],
      [F, 14.5, -20],
      [R, 15, -20],
      [R, 15, 2],
    ]);
    // 마지막 패스(깊이 1): E = 2 거리 테이퍼
    expect(m.slice(-5)).toEqual([
      [F, 14.5, 2],
      [F, 13.5, 0],
      [F, 13.5, -18],
      [F, 14.5, -20],
      [R, 15, -20],
    ]);
    // L1 = 들어가는 쪽만, L2 = 나오는 쪽만, L0·E0 = 없음
    expect(thread(llathe(`${BASE} E2 L1\nM2`)).slice(0, 4)).toEqual([
      [F, 14.5, 2],
      [F, 14.3, 1.6],
      [F, 14.3, -20],
      [R, 15, -20],
    ]);
    expect(thread(llathe(`${BASE} E2 L2\nM2`)).slice(0, 4)).toEqual([
      [R, 14.3, 2],
      [F, 14.3, -19.6],
      [F, 14.5, -20],
      [R, 15, -20],
    ]);
    expect(thread(llathe(`${BASE} E2 L0\nM2`))).toEqual(thread(llathe(`${BASE}\nM2`)));
    expect(thread(llathe(`${BASE} E0 L3\nM2`))).toEqual(thread(llathe(`${BASE}\nM2`)));
  });

  it('E가 구동선 길이의 반보다 크거나 L이 0~3이 아니면 경고하고 테이퍼 없이', () => {
    const big = llathe(`${BASE} E12 L3\nM2`);
    expect(warns(big)).toEqual(['G76: E(테이퍼 거리)가 구동선 길이의 반보다 큼 — LinuxCNC는 오류(테이퍼 없이 그림)']);
    expect(thread(big)).toEqual(thread(llathe(`${BASE}\nM2`)));
    const bad = llathe(`${BASE} E2 L5\nM2`);
    expect(warns(bad)).toEqual(['G76: L(테이퍼 고르기)은 0~3 — 테이퍼 없이 그림']);
    expect(thread(bad)).toEqual(thread(llathe(`${BASE}\nM2`)));
  });

  it('새 경고가 네 언어에서 한국어 없이 옮겨진다', () => {
    const texts = [
      'G76: Q(복합 각)는 패스 시작 Z를 (깊이 − K) × tan Q만큼 깎는 방향으로 옮겨 그림(나사 높이 패스가 시작 Z — 정한 것)',
      'G76: Q(복합 각)가 90도 이상 — 패스를 옮기지 않음',
      'G76: E(테이퍼 거리)가 구동선 길이의 반보다 큼 — LinuxCNC는 오류(테이퍼 없이 그림)',
      'G76: L(테이퍼 고르기)은 0~3 — 테이퍼 없이 그림',
    ];
    for (const t of texts) for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate(texts[2]!, 'en')).toBe('G76: E (taper distance) is greater than half the drive line length — an error in LinuxCNC (drawn without taper)');
  });
});
