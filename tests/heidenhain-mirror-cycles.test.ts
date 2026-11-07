/**
 * Heidenhain 사이클 8(대칭) 아래 고정 사이클의 가공 방향(48차): 한 축만 대칭하면 공구의 가공 방향이 바뀌지만 고정 사이클은 빼고
 * (HEIDENHAIN TNC 310 사용 설명서 4/2003 8.6절 140쪽 "except in fixed cycles"), 사이클 208은 "대칭이 사이클의 밀링 꼴에 영향 없음"
 * (TNC 640 가공 사이클 프로그래밍 34059x-17 104쪽). 자리는 대칭되고 Q351(하향·상향)의 돌아가는 방향은 대칭 없을 때와 같다.
 * 두 축 대칭은 전과 같다(방향이 원래 그대로). 모두 직접 만든 작은 합성 프로그램
 */
import { describe, expect, it } from 'vitest';
import { parseHeidenhain } from '../src/heidenhain';
import { MOVE_ARC, MOVE_DRILL, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const mir = (m: string): string => (m ? `3 CYCL DEF 8.0 MIRROR IMAGE\n3 CYCL DEF 8.1 ${m}\n` : '');
const fixed = (cyc: string, m: string): NcProgram =>
  parseHeidenhain(`0 BEGIN PGM MF MM
1 TOOL DEF 1 L+0 R+3
2 TOOL CALL 1 Z S3000 F500
${mir(m)}4 L X+20 Y+10 Z+50 R0 FMAX
5 ${cyc}
6 CYCL CALL
7 L Z+50 FMAX
8 END PGM MF MM
`);
/** 깊이 z에서 평면 안을 도는 절삭의 부호 있는 넓이(반시계 +, 원호는 활꼴까지) */
const turn = (p: NcProgram, z: number): number => {
  let a = 0;
  for (let i = 0; i < p.moves.count; i++) {
    if (p.moves.kind[i] === MOVE_RAPID || p.moves.kind[i] === MOVE_DRILL) continue;
    const s = moveStart(p.moves, i);
    const e = moveEnd(p.moves, i);
    if (Math.abs(s[2] - z) > 1e-9 || Math.abs(e[2] - z) > 1e-9) continue;
    a += (s[0] * e[1] - e[0] * s[1]) / 2;
    if (p.moves.kind[i] === MOVE_ARC) {
      const k = p.moves.arc[i]!;
      const sw = p.arcs.sweep[k]!;
      const rr = Math.hypot(e[0] - p.arcs.center[k * 3]!, e[1] - p.arcs.center[k * 3 + 1]!);
      a += ((rr * rr) / 2) * (sw - Math.sin(sw));
    }
  }
  return a;
};
const P251 = (q351: number): string =>
  `CYCL DEF 251 RECTANGULAR POCKET ~\n Q215=0 ~\n Q218=60 ~\n Q219=40 ~\n Q220=5 ~\n Q368=0 ~\n Q224=0 ~\n Q367=0 ~\n Q207=500 ~\n Q351=${q351} ~\n Q201=-4 ~\n Q202=4 ~\n Q206=150 ~\n Q200=2 ~\n Q203=+0 ~\n Q204=10 ~\n Q370=1`;
const P252 = 'CYCL DEF 252 CIRCULAR POCKET ~\n Q215=0 ~\n Q223=50 ~\n Q368=0 ~\n Q207=500 ~\n Q351=+1 ~\n Q201=-4 ~\n Q202=4 ~\n Q206=150 ~\n Q200=2 ~\n Q203=+0 ~\n Q204=10 ~\n Q370=1';
const P208 = 'CYCL DEF 208 BORE MILLING ~\n Q200=2 ~\n Q201=-10 ~\n Q206=150 ~\n Q334=0.5 ~\n Q203=+0 ~\n Q204=10 ~\n Q335=20 ~\n Q351=+1';

describe('사이클 8 대칭 아래 고정 사이클의 가공 방향', () => {
  it('251 사각 포켓: 한 축 대칭이어도 Q351 = +1(하향 — 반시계)·-1(상향 — 시계) 그대로, 자리만 대칭', () => {
    for (const q351 of [1, -1]) {
      const base = fixed(P251(q351), '');
      const sign = Math.sign(turn(base, -4));
      expect(sign).toBe(q351);
      for (const m of ['X', 'Y', 'X Y']) {
        const p = fixed(P251(q351), m);
        expect(p.moves.count).toBe(base.moves.count);
        expect(Math.sign(turn(p, -4)), `${q351} ${m}`).toBe(sign);
        // 자리는 대칭: 포켓 가운데(X20 Y10)가 축마다 뒤집힌 자리, 넓이(고리 크기)는 같음
        const xs = [...Array(p.moves.count).keys()].map((i) => moveEnd(p.moves, i));
        const cx = (Math.min(...xs.map((q) => q[0])) + Math.max(...xs.map((q) => q[0]))) / 2;
        const cy = (Math.min(...xs.map((q) => q[1])) + Math.max(...xs.map((q) => q[1]))) / 2;
        expect([r3(cx), r3(cy)]).toEqual([m.includes('X') ? -20 : 20, m.includes('Y') ? -10 : 10]);
        expect(r3(Math.abs(turn(p, -4)))).toBe(r3(Math.abs(turn(base, -4))));
      }
    }
  });
  it('252 원 포켓·208 보어 밀링: 한 축 대칭이어도 반시계(Q351 = +1) 그대로', () => {
    for (const m of ['', 'X', 'Y', 'X Y']) {
      expect(turn(fixed(P252, m), -4), m).toBeGreaterThan(0);
      const p = fixed(P208, m);
      expect(p.arcs.count).toBeGreaterThan(0);
      expect([...p.arcs.sweep].every((s) => s > 0), m).toBe(true);
    }
  });
});
