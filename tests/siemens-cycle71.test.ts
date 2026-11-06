// Siemens CYCLE71(평면 밀링, 44차): SINUMERIK 840D sl 사이클 프로그래밍 설명서(6FC5398-3BP20-0BA0, 2006-11) 3.11절 156~162쪽.
// 매개변수 차례·_VARI(거친·다듬질 × 한 방향·오감 × 축)·폭 절입(첫 길 = _MIDA − 공구 반지름, 마지막 = 너비 + _FDP1 − 공구 반지름)·층을
// 설명서 예(158쪽)와 합성 프로그램으로 본다. 실제 Siemens 표본이 없어 설명서 예제와 합성 프로그램으로만 시험한다
import { describe, expect, it } from 'vitest';
import { FLAG_CYCLE, MOVE_FEED, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';
import { parseSiemens } from '../src/siemens';
import { makeSource } from '../src/text';
import { languages, translate } from '../site/i18n.mjs';

type Tools = Record<number, { diameter?: number; radius?: number }>;
const R10: Tools = { 1: { radius: 10 } };
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const run = (text: string, toolTable: Tools | undefined = R10, maxMoves?: number): NcProgram => parseSiemens(makeSource(text), { initialPosition: [0, 0, 50], toolTable, maxMoves });
const warns = (p: NcProgram): string[] => p.warnings.map((w) => w.replace(/^\d+번 줄: /, ''));
const cyc = (p: NcProgram): number[] => {
  const out: number[] = [];
  for (let i = 0; i < p.moves.count; i++) if (p.moves.flags[i]! & FLAG_CYCLE) out.push(i);
  return out;
};
const feeds = (p: NcProgram): number[] => cyc(p).filter((i) => p.moves.kind[i] === MOVE_FEED);
/** 사이클 이송 끝점의 Z — 이어진 같은 값은 하나로 */
const levels = (p: NcProgram): number[] => {
  const out: number[] = [];
  for (const i of feeds(p)) {
    const z = r3(moveEnd(p.moves, i)[2]);
    if (out[out.length - 1] !== z) out.push(z);
  }
  return out;
};
/** 설명서 158쪽 예: 후퇴 면 10, 기준면 0, 안전 거리 2, 깊이 -11, (100, 100)에서 60 × 40, 10° 돌림, 절입 6, 폭 절입 10, 물러남 5, 오가며 X와 나란히 거친 깎기(31), 넘어감 2 */
const EX = (vari = 31, more = '', head = ''): string => `${head}G71 G17 G90 G94\nN100 T1 D1\nN102 M06\nN110 G17 G0 G90 G54 G94 F2000 X0 Y0 Z20\nCYCLE71(10, 0, 2, -11, 100, 100, 60, 40, 10, 6, 10, 5, ${more || '0'}, 4000, ${vari}, 2)\nN125 G0 G90 X0 Y0\nN130 M30`;
const ca = Math.cos((10 * Math.PI) / 180);
const sa = Math.sin((10 * Math.PI) / 180);
/** 면 지역 좌표(긴 축 c, 수직 축 t) → 프로그램 X·Y */
const P = (c: number, t: number): number[] => [r3(100 + c * ca - t * sa), r3(100 + c * sa + t * ca)];

describe('Siemens CYCLE71', () => {
  it('설명서 예: 13 mm를 절입 6 이하로 3층, 폭은 0·8·16·24·32(공구 반지름 10 — 첫 길 = _MIDA − 반지름, 마지막 = 40 + 2 − 10)에서 오가며', () => {
    const p = run(EX());
    expect(warns(p)).toEqual([]);
    expect(levels(p)).toEqual([-2.333, -6.667, -11]);
    const f = feeds(p);
    // 층마다 다섯 길과 길 사이 옮김 넷
    expect(f.length).toBe(27);
    const ends = f.slice(0, 9).map((i) => moveEnd(p.moves, i).slice(0, 2).map(r3));
    expect(ends).toEqual([P(75, 0), P(75, 8), P(-15, 8), P(-15, 16), P(75, 16), P(75, 24), P(-15, 24), P(-15, 32), P(75, 32)]);
    // 진입: 지금 높이(Z20)에서 진입 자리 위 → 기준면 + 안전 거리(Z2) → 첫 층(G0 — 면 밖)
    const c = cyc(p);
    expect(moveEnd(p.moves, c[0]!).map(r3)).toEqual([...P(-15, 0), 20]);
    expect(moveEnd(p.moves, c[1]!).map(r3)).toEqual([...P(-15, 0), 2]);
    expect(p.moves.kind[c[2]!]).toBe(MOVE_RAPID);
    // 끝나면 후퇴 면
    expect(r3(moveEnd(p.moves, c[c.length - 1]!)[2])).toBe(10);
  });

  it('한 방향(11)은 길마다 그 층 + 안전 거리로 들어 올려 급속으로 시작 자리, 다듬질(12)은 _DP에서 한 번(_DP + _FALD + 안전 거리로 들어 올림)', () => {
    const one = run(EX(11));
    expect(levels(one)).toEqual([-2.333, -6.667, -11]);
    expect(feeds(one).length).toBe(15);
    // 공구 축만 움직이는 급속: 기준면 + 안전 거리(2), 층으로 내림, 층 + 안전 거리로 들어 올림, 끝의 후퇴 면(10)
    const zs = new Set(cyc(one).filter((i) => p0(one, i)).map((i) => r3(moveEnd(one.moves, i)[2])));
    expect([...zs].sort((a, b) => a - b)).toEqual([-11, -9, -6.667, -4.667, -2.333, -0.333, 2, 10]);
    const fin = run(EX(12, '1'));
    expect(levels(fin)).toEqual([-11]);
    expect(feeds(fin).length).toBe(5);
    expect(cyc(fin).some((i) => r3(moveEnd(fin.moves, i)[2]) === -8)).toBe(true);
    // 수직 축과 나란히(21·41): 길이 Y(지역 t)로
    const v = run(EX(41));
    const first = feeds(v)[0]!;
    const s = moveStart(v.moves, first);
    const e = moveEnd(v.moves, first);
    expect([r3(s[0]), r3(s[1])]).toEqual(P(0, -15));
    expect([r3(e[0]), r3(e[1])]).toEqual(P(0, 55));
  });

  it('_ZSD[1] = 1이면 기준면부터, _LENG·_WID 부호가 면이 놓이는 쪽, 바닥 여유가 깊이보다 크면 거친 깎기 층이 없음', () => {
    const z = run(EX(31, '', '_ZSD[1]=1\n'));
    expect(levels(z)).toEqual([-5.5, -11]);
    // 깊이 0·안전 거리 0인데 바닥 여유 1: 깎을 것이 없어 이송 없이 후퇴 면으로(시작 높이 아래로 내려갔다 오르지 않음)
    const none = run('G71 G17 G90\nT1 D1\nG0 X0 Y0 Z20\nCYCLE71(10, 0, 0, 0, 0, 0, 60, 40, 0, 6, 10, 5, 1, 1000, 31, 0)\nM30');
    expect(feeds(none)).toEqual([]);
    expect(warns(none)).toEqual([]);
    const neg = run('G71 G17 G90\nT1 D1\nG0 X0 Y0 Z20\nCYCLE71(10, 0, 2, -5, 0, 0, -60, -40, 0, 0, 10, 5, 0, 1000, 11, 0)\nM30');
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const i of feeds(neg))
      for (const [x, y] of [moveStart(neg.moves, i), moveEnd(neg.moves, i)]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    expect([x0, x1, y0, y1].map(r3)).toEqual([-75, 15, -30, 0]);
  });

  it('알람 61002·61101, 깊이·크기 없음, 공구 반지름을 모름, _FDP 0은 경고', () => {
    const w = (call: string, tools: Tools = R10): string[] => warns(run(`G71 G17 G90\nT1 D1\nG0 X0 Y0 Z20\n${call}\nM30`, tools));
    expect(w('CYCLE71(10, 0, 2, -5, 0, 0, 60, 40, 0, 0, 10, 5, 0, 1000, 13, 0)')).toEqual(['CYCLE71: 가공 종류(_VARI = 13)가 맞지 않음(알람 61002) — 그리지 않음']);
    expect(w('CYCLE71(10, 0, 2, -5, 0, 0, 60, 40, 0, 0, 10, 5, 0, 1000, 51, 0)')).toEqual(['CYCLE71: 가공 종류(_VARI = 51)가 맞지 않음(알람 61002) — 그리지 않음']);
    expect(w('CYCLE71(-10, 0, 2, -11, 0, 0, 60, 40, 0, 0, 10, 5, 0, 1000, 11, 0)')).toEqual(['CYCLE71: 후퇴 면이 기준면보다 최종 깊이에 가까움(알람 61101) — 그리지 않음']);
    expect(w('CYCLE71(10, 0, 2, , 0, 0, 60, 40, 0, 0, 10, 5, 0, 1000, 11, 0)')).toEqual(['CYCLE71: 깊이(_DP)가 없음 — 그리지 않음']);
    expect(w('CYCLE71(10, 0, 2, -5, 0, 0, 60, 0, 0, 0, 10, 5, 0, 1000, 11, 0)')).toEqual(['CYCLE71: 면 크기(_LENG·_WID)가 없음 — 그리지 않음']);
    expect(w('CYCLE71(10, 0, 2, -5, 0, 0, 60, 40, 0, 0, 0, 5, 0, 1000, 11, 0)', {})).toEqual(['CYCLE71: 공구 반지름을 몰라 폭 절입(_MIDA)을 정할 수 없음 — 그리지 않음']);
    expect(w('CYCLE71(10, 0, 2, -5, 0, 0, 60, 40, 0, 0, 10, 5, 0, 1000, 11, 0)', {})).toEqual(['CYCLE71: 공구 반지름을 몰라 반지름 0으로 그림']);
    expect(w('CYCLE71(10, 0, 2, -5, 0, 0, 60, 40, 0, 0, 10, 0, 0, 1000, 11, 0)')).toEqual(['CYCLE71: 물러남(_FDP)이 0 — 설명서는 0보다 커야 한다고 함(0으로 그림)']);
    // _MIDA가 0이면 공구 지름의 80 %(16): 첫 길 = 16 − 10 = 6, 마지막 = 너비 40 + _FDP1 0 − 10 = 30, 사이 ≤ 16
    const p = run('G71 G17 G90\nT1 D1\nG0 X0 Y0 Z20\nCYCLE71(10, 0, 2, -5, 0, 0, 60, 40, 0, 0, 0, 5, 0, 1000, 11, 0)\nM30');
    const ys = [...new Set(feeds(p).map((i) => r3(moveEnd(p.moves, i)[1])))];
    expect(ys).toEqual([6, 18, 30]);
  });

  it('아주 작은 _MIDA·_MID는 이동 한도에서 멈춘다', () => {
    const p = run('G71 G17 G90\nT1 D1\nG0 X0 Y0 Z20\nCYCLE71(10, 0, 2, -5, 0, 0, 60, 40, 0, 0.0001, 0.0001, 5, 0, 1000, 31, 0)\nM30', R10, 2000);
    expect(p.moves.count).toBe(2000);
    expect(warns(p).some((w) => /이동이 2000개를 넘어/.test(w))).toBe(true);
  });

  it('새 경고 글은 네 언어 사전에 있다', () => {
    const texts = [
      'CYCLE71: 깊이(_DP)가 없음 — 그리지 않음',
      'CYCLE71: 가공 종류(_VARI = 13)가 맞지 않음(알람 61002) — 그리지 않음',
      'CYCLE71: 면 크기(_LENG·_WID)가 없음 — 그리지 않음',
      'CYCLE71: 공구 반지름을 몰라 폭 절입(_MIDA)을 정할 수 없음 — 그리지 않음',
      'CYCLE71: 공구 반지름을 몰라 반지름 0으로 그림',
      'CYCLE71: 물러남(_FDP)이 0 — 설명서는 0보다 커야 한다고 함(0으로 그림)',
    ];
    for (const t of texts) for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko')) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
  });
});

/** 들어 올림·다시 내림 같은 공구 축만 움직이는 급속(X·Y가 앞 끝과 같음) */
function p0(p: NcProgram, i: number): boolean {
  if (p.moves.kind[i] !== MOVE_RAPID) return false;
  const s = moveStart(p.moves, i);
  const e = moveEnd(p.moves, i);
  return Math.abs(s[0] - e[0]) < 1e-9 && Math.abs(s[1] - e[1]) < 1e-9;
}
