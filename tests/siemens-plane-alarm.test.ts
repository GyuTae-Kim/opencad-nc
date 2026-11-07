// Siemens 사이클의 후퇴 면·기준면(43차): SINUMERIK 840D sl 사이클 프로그래밍 설명서(6FC5398-3BP20-0BA0, 2006-11)
// 2.1.3절 CYCLE81 44쪽 — 사이클은 후퇴 면(RTP)이 기준면(RFP) 앞(최종 깊이에서 더 멂)이라고 본다. 두 값이 같으면 상대 깊이는 허용되지 않아
// 알람 61101 "Reference plane defined incorrectly"을 내고 사이클을 하지 않으며, 후퇴 면이 기준면 뒤(최종 깊이까지 더 가까움)여도 같은 알람이다.
// 2.1.1절 40쪽 — 기하 매개변수는 드릴·패턴·밀링 사이클에 같다(다른 사이클의 RTP·RFP 설명도 CYCLE81을 가리킨다).
// 그래서 알람 꼴은 그리지 않고 그 줄에 알리며, 그린 사이클의 후퇴 면 쪽은 늘 공구가 들어오는 쪽이다 — 후퇴 면이 기준면 아래(위로 뚫음)인 사이클은
// "급속 이동이 가장 깊은 절삭보다 아래로 내려감" 검사(공구가 위에서 내려온다고 봄)에서 그 이동을 빼고, 가장 깊은 절삭도 그 사이클을 빼고 잰다
import { describe, expect, it } from 'vitest';
import { parseSiemens } from '../src/siemens';
import { parseGcode } from '../src/gcode';
import { moveEnd, type NcProgram } from '../src/model';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
const run = (text: string): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable: { 1: { diameter: 6 } } });
const head = 'G71 G17 G90 T1 D1 S1000 M3 F100\nG0 X0 Y0 Z50\n';
const path = (p: NcProgram): number[][] => Array.from({ length: p.moves.count }, (_, i) => [p.moves.kind[i]!, ...moveEnd(p.moves, i).map(r6)]);
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
const SAME = (n: string): string => `${n}: 후퇴 면과 기준면이 같은데 상대 깊이(DPR)를 줌(알람 61101) — 그리지 않음`;
const AFTER = (n: string): string => `${n}: 후퇴 면이 기준면보다 최종 깊이에 가까움(알람 61101) — 그리지 않음`;
const RAPID = /^급속 이동이 가장 깊은 절삭/;
const zs = (p: NcProgram): number[] => Array.from({ length: p.moves.count }, (_, i) => r6(moveEnd(p.moves, i)[2]!));

describe('알람 61101 — 그리지 않음', () => {
  it('후퇴 면 = 기준면에 상대 깊이 DPR: 사이클을 그리지 않고 알린다(절대 깊이 DP·DPR 0은 그대로 그림)', () => {
    for (const n of ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89']) {
      const bad = run(head + `G0 X10 Y10 Z5\n${n}(0, 0, 2, , 12)\nG0 Z50`);
      expect(warns(bad), n).toContain(SAME(n));
      // 사이클 이동이 없다: 앞 급속과 뒤 급속만
      expect(path(bad), n).toEqual(path(run(head + 'G0 X10 Y10 Z5\nG0 Z50')));
    }
    // DP와 DPR을 함께 줘도 깊이는 DPR에서 오므로 같은 알람
    expect(warns(run(head + 'CYCLE81(0, 0, 2, -12, 12)'))).toEqual([SAME('CYCLE81')]);
    // 절대 깊이(DP)나 DPR 0(빠진 매개변수)은 허용 — 전처럼 아래로 그림
    const dp = run(head + 'G0 X10 Y10 Z5\nCYCLE81(0, 0, 2, -12)');
    expect(warns(dp)).toEqual([]);
    expect(Math.min(...zs(dp))).toBe(-12);
    expect(path(run(head + 'G0 X10 Y10 Z5\nCYCLE81(0, 0, 2, -12, 0)'))).toEqual(path(dp));
  });

  it('후퇴 면이 기준면 뒤(최종 깊이까지 더 가까움): 기준면과 깊이 사이·깊이 너머 모두 알람, 같은 거리(후퇴 면 = 기준면 + DP)는 허용', () => {
    expect(warns(run(head + 'CYCLE81(5, 10, 2, 0)'))).toEqual([AFTER('CYCLE81')]);
    expect(warns(run(head + 'CYCLE82(-5, 10, 2, 0, , 1)'))).toEqual([AFTER('CYCLE82')]);
    expect(warns(run(head + 'G0 X10 Y10 Z5\nCYCLE81(0, 0, 2, -12)'))).toEqual([]);
    // 위로 뚫는 사이클(후퇴 면 아래·깊이 위)은 알람이 아니다
    expect(warns(run(head + 'G0 X10 Y10 Z-10\nCYCLE81(-10, 0, 2, 15)'))).toEqual([]);
    // 위로 뚫는데 후퇴 면이 깊이 너머(위)면 알람
    expect(warns(run(head + 'CYCLE81(20, 0, 2, 15)'))).toEqual([AFTER('CYCLE81')]);
  });

  it('MCALL·HOLES는 자리마다 같은 알람 하나로 묶이고 구멍을 그리지 않는다', () => {
    const m = run(head + 'G0 Z5\nMCALL CYCLE83(0, 0, 2, , 20, , 5, 1, 0, 0, 1, 1)\nHOLES1(0, 0, 0, 10, 10, 3)\nMCALL');
    expect(m.warnings).toEqual([`5번 줄: ${SAME('CYCLE83')} (모두 3번)`]);
    expect(m.holes.count).toBe(0);
    expect(Math.min(...zs(m))).toBe(5);
  });

  it('홈·포켓 사이클도 같은 기하 매개변수라 같은 알람(POCKET3·4는 절대 깊이만이라 둘째 꼴만)', () => {
    expect(warns(run(head + 'LONGHOLE(0, 0, 1, , 12, 4, 30, 0, 0, 20, 0, 90, 100, 320, 6)'))).toEqual([SAME('LONGHOLE')]);
    expect(warns(run(head + 'SLOT1(5, 10, 1, 0, , 4, 30, 15, 0, 0, 30, 0, 90, 100, 320, 6, 2, 0.5, 0, 0, 400)'))).toEqual([AFTER('SLOT1')]);
    expect(warns(run(head + 'SLOT2(0, 0, 2, , 10, 3, 70, 15, 0, 0, 42, 0, 120, 100, 300, 6, 2, 0.5, 0)'))).toEqual([SAME('SLOT2')]);
    expect(warns(run(head + 'POCKET1(0, 0, 0.5, , 17.5, 60, 40, 8, 60, 40, 0, 120, 300, 4, 2, 0.75, 0, 6, 200)'))).toEqual([SAME('POCKET1')]);
    expect(warns(run(head + 'POCKET2(5, 10, 0.5, 0, , 25, 50, 50, 100, 200, 6, 3, 0.5, 0, 0, 150)'))).toEqual([AFTER('POCKET2')]);
    const p3 = run(head + 'POCKET3(5, 10, 1, 0, 60, 40, 8, 60, 40, 0, 4, 0.5, 0.2, 800, 200, 0, 11, 6)');
    expect(warns(p3)).toEqual([AFTER('POCKET3')]);
    expect(p3.moves.count).toBe(0);
    // 후퇴 면 = 기준면 + 절대 깊이는 POCKET3에서도 그림
    expect(run(head + 'POCKET3(0, 0, 1, -10, 60, 40, 8, 60, 40, 0, 4, 0.5, 0.2, 800, 200, 0, 11, 6)').moves.count).toBeGreaterThan(10);
  });
});

describe('위로 뚫는 사이클의 급속 안전 검사', () => {
  it('후퇴 면이 기준면 아래인 드릴 사이클은 "가장 깊은 절삭보다 아래로" 경고가 붙지 않는다 — 한 번·MCALL·HOLES·쪼기', () => {
    for (const body of [
      'G0 X10 Y10 Z-10\nCYCLE81(-10, 0, 2, , 15)',
      'G0 Z-10\nMCALL CYCLE83(-10, 0, 2, 20, , , 5, 1, 0, 0, 1, 1)\nX10 Y10\nX20\nMCALL',
      'G0 Z-10\nMCALL CYCLE82(-10, 0, 2, 12, , 1)\nHOLES2(0, 0, 20, 0, 45, 4)\nMCALL',
    ]) {
      const p = run(head + body + '\nG0 Z-10\nM30');
      expect(warns(p).filter((w) => RAPID.test(w)), body).toEqual([]);
      // 구멍은 위로: 바닥이 기준면보다 높다
      expect(Math.max(...zs(p)), body).toBeGreaterThan(10);
    }
  });

  it('프레임으로 뒤집혀 표시 좌표에서 위로 가면(MIRROR Z) 같은 처리, 아래로 뚫는 보통 사이클의 경고는 그대로', () => {
    const mir = run(head + 'MIRROR Z0\nG0 X10 Y10 Z10\nCYCLE81(10, 0, 2, -5)\nG0 Z50');
    expect(Math.max(...zs(mir))).toBe(5);
    expect(warns(mir).filter((w) => RAPID.test(w))).toEqual([]);
    // 보통 사이클 + 정말 위험한 급속(가장 깊은 절삭 아래에서 옆으로): 그대로 경고
    const low = run(head + 'G0 X10 Y10 Z10\nCYCLE81(10, 0, 2, -5)\nG0 Z-8\nG0 X30\nG0 Z50');
    expect(warns(low).filter((w) => RAPID.test(w))).toEqual(['급속 이동이 가장 깊은 절삭(Z-5)보다 아래로 내려감 (모두 2번)']);
  });

  it('다른 절삭과 섞이면 가장 깊은 절삭은 위로 뚫는 사이클을 빼고 재고, 사이클 밖 급속은 그대로 본다', () => {
    // 윗면 절삭 Z-2 + 아래에서 위로 뚫는 사이클(기준면 Z-20, 후퇴 면 Z-30): 사이클의 급속(후퇴 면 Z-30)은 보지 않고,
    // 사이클 밖에서 Z-30으로 내려가는 급속은 윗면 절삭(Z-2) 기준으로 알린다(전에는 사이클의 R 점 Z-22가 가장 깊은 절삭이었다)
    const p = run(head + 'G1 Z-2\nG1 X5\nG0 Z50\nG0 X10 Y10\nG0 Z-30\nCYCLE81(-30, -20, 2, -10)\nG0 Z-30\nG0 X40\nM30');
    // 사이클 밖 두 급속(7번 줄 Z-30으로 내려감·10번 줄 그 높이에서 옆으로)만 — 사이클의 후퇴 면 급속은 세지 않는다
    expect(p.warnings.filter((w) => /급속 이동이 가장 깊은 절삭/.test(w))).toEqual(['7번 줄: 급속 이동이 가장 깊은 절삭(Z-2)보다 아래로 내려감 (모두 2번)']);
    // HOLES1·HOLES2가 구멍 자리를 찾아가는 급속은 패턴 사이클의 몫(설명서 2.3절 92쪽)이라 함께 빠진다 — 사이클 밖 6번 줄만
    const h = run(head + 'G1 Z-2\nG1 X5\nG0 Z50\nG0 Z-10\nMCALL CYCLE81(-10, 0, 2, 15)\nHOLES1(0, 0, 0, 10, 10, 3)\nMCALL\nM30');
    expect(h.holes.count).toBe(3);
    expect(h.warnings.filter((w) => /급속 이동이 가장 깊은 절삭/.test(w))).toEqual(['6번 줄: 급속 이동이 가장 깊은 절삭(Z-2)보다 아래로 내려감']);
  });

  it('Fanuc 등 다른 방언의 고정 사이클은 그대로(설명서 근거가 Siemens 후퇴 면 규칙뿐)', () => {
    const g = parseGcode('G21 G90 G17\nG0 X0 Y0 Z-10\nG98 G81 X10 Y10 Z15 R-2 F100\nG80\nM30', { dialect: 'fanuc', initialPosition: [0, 0, 50] });
    expect(g.warnings.some((w) => /급속 이동이 가장 깊은 절삭/.test(w))).toBe(true);
  });

  it('후퇴 면이 기준면 아래인 포켓 사이클도 같은 처리', () => {
    const p = run(head + 'G0 X0 Y0 Z-10\nPOCKET2(-10, 0, 2, 10, , 20, 50, 50, 100, 200, 4, 3, 0.5, 1)\nG0 Z-10\nM30');
    expect(Math.max(...zs(p))).toBe(10);
    expect(warns(p).filter((w) => RAPID.test(w))).toEqual([]);
  });
});

describe('번역', () => {
  it('새 경고 글은 네 언어 사전에 있다', () => {
    const texts = [SAME('CYCLE81'), AFTER('POCKET3')];
    for (const t of texts) for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate(AFTER('CYCLE81'), 'en')).toBe('CYCLE81: the retraction plane is closer to the final depth than the reference plane (alarm 61101) — not drawn');
  });
});
