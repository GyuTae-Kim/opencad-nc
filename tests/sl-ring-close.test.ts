/**
 * SL 옆 간격 고리가 끊기던 두 꼴(51차 — src/sl.ts offsetUpTo의 bridge·prune). 모두 직접 만든 작은 합성 도형·프로그램.
 * 1) 점으로 준 원호(가공 면 쪽으로 볼록하고 반지름이 d 이하)의 끝이 오목한 꼭짓점이면 그 둘레 반지름 d 호가 떨어진 곡선의 일부다 —
 *    50차까지는 건너뛴 자리를 곧게 이어 그 호가 빠졌다. 고리가 끊기면 그 단계에서 멈춰 안쪽을 깎지 않은 채 남겼고(잇지 못함 알림),
 *    끊기지 않아도 곧은 잇기가 남아 공구 중심이 경계에 d보다 가까이 들어갔다(벽을 깎아 들어감).
 * 2) 볼록한 꼭짓점의 아주 얇은 제비꼬리 조각(원호 끝의 거의 곧은 꼭짓점, 꼭짓점이 반올림된 원꼴 다각형, 요소 천 개 넘는 정다각형의 바깥 고리)이
 *    남기는 판정 여유(크기의 10⁻⁷) 안이라 남아 사슬이 그 가지로 들어가 끊기거나 고리를 통째로 잃었다 — 여유를 10⁻⁹로 좁히고,
 *    그래도 잇지 못한 사슬이 있으면 끊긴 가지를 빼고 다시 잇는다.
 * 고친 고리의 바름: 요소 위 점의 경계까지 거리 = d, 가공 면 안, 이어진 닫힌 고리, 넓이 합이 단계마다 줄어듦. 버려질 팔을 셈해도 같은 답.
 */
import { describe, expect, it } from 'vitest';
import { parseHeidenhain } from '../src/heidenhain';
import { g7xLine } from '../src/lathe-g7x';
import { moveEnd } from '../src/model';
import { slArea, slAt, slDist, slInside, slIsPocket, slLevels, slOffset, slRegion, type SlLoop, type SlRegion } from '../src/sl';

/**
 * 시계 방향 들쭉날쭉 n각형(중심 50·50, 꼭짓점 반지름 40과 40 + wob 번갈아 — RR이면 포켓). m > 0이면 k % m = off인 변을 바깥으로 볼록한
 * 반지름 cr 원호(시계 — 중심은 진행 방향 오른쪽)로. dp ≥ 0이면 꼭짓점을 소수 dp 자리로 반올림
 */
function jagged(n: number, wob: number, cr = 0, m = 0, off = 3, dp = -1): SlLoop {
  const q = (x: number): number => (dp >= 0 ? Number(x.toFixed(dp)) : x);
  const pts: [number, number][] = [...Array(n).keys()].map((k) => {
    const a = (-k / n) * Math.PI * 2;
    const rr = 40 + (k % 2 ? wob : 0);
    return [q(50 + rr * Math.cos(a)), q(50 + rr * Math.sin(a))];
  });
  return pts.map((s, k) => {
    const e = pts[(k + 1) % n]!;
    if (!(cr > 0 && m > 0 && k % m === off)) return g7xLine(s[0], s[1], e[0], e[1]);
    const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
    const tu = (e[0] - s[0]) / len;
    const tv = (e[1] - s[1]) / len;
    const h = Math.sqrt(cr * cr - (len / 2) ** 2);
    return { arc: true, su: s[0], sv: s[1], eu: e[0], ev: e[1], cu: (s[0] + e[0]) / 2 + tv * h, cv: (s[1] + e[1]) / 2 - tu * h, sweep: -2 * Math.asin(len / 2 / cr) };
  });
}
const pocket = (els: SlLoop): SlRegion => slRegion([{ els, pocket: slIsPocket(els, 2) }]);

/** 고리들의 바름(위 머리글) — |경계 거리 − d|의 가장 큰 값을 돌려준다 */
function check(R: SlRegion, levels: SlLoop[][], d0: number, step: number): number {
  let worst = 0;
  let prev = Infinity;
  levels.forEach((loops, k) => {
    const d = d0 + k * step;
    let area = 0;
    expect(loops.length, `d = ${d}`).toBeGreaterThan(0);
    for (const l of loops) {
      l.forEach((a, i) => {
        const b = l[(i + 1) % l.length]!;
        expect(Math.hypot(a.eu - b.su, a.ev - b.sv)).toBeLessThan(1e-12);
        for (const t of [0.25, 0.5, 0.75]) {
          const [u, v] = slAt(a, t);
          worst = Math.max(worst, Math.abs(slDist(R, u, v) - d));
          expect(slInside(R, u, v)).toBe(true);
        }
      });
      area += slArea(l);
    }
    expect(area, `d = ${d}`).toBeLessThan(prev);
    prev = area;
  });
  return worst;
}
/** 공구 중심 경로가 지나는 반지름 d 호 가운데 중심이 원호 끝 꼭짓점인 것이 있는지(오목한 꼭짓점 호) */
const cornerArcAtArcEnd = (R: SlRegion, loops: SlLoop[], d: number): boolean => {
  const ends = new Set(R.loops[0]!.filter((e) => e.arc).flatMap((e) => [`${e.su},${e.sv}`, `${e.eu},${e.ev}`]));
  return loops.flat().some((e) => e.arc && ends.has(`${e.cu},${e.cv}`) && Math.abs(Math.hypot(e.su - e.cu, e.sv - e.cv) - d) < 1e-9);
};

describe('51차: 점으로 준 원호 양 끝의 오목한 꼭짓점 호', () => {
  it('조금 들쭉날쭉한 48각형 + 반지름 20 원호: 원호가 점으로 줄어든 단계(d 20.2)에서도 고리가 닫혀 가운데까지 간다', () => {
    const R = pocket(jagged(48, 0.5, 20, 7));
    const L = slLevels(R, 5.2, 5, 2000);
    // 50차는 d 20.2에서 고리를 잇지 못해 바깥 3겹에서 멈췄다
    expect(L.capped).toBe(false);
    expect(L.levels).toHaveLength(7);
    expect(check(R, L.levels, 5.2, 5)).toBeLessThan(1e-12);
    expect(cornerArcAtArcEnd(R, L.levels[3]!, 20.2)).toBe(true);
  });
  it('더 들쭉날쭉한 90각형: 고리는 닫혀도 곧은 잇기가 남아 경계에 0.1 가까이 들어가던 것이 이제 정확히 d', () => {
    const R = pocket(jagged(90, 2, 20, 7));
    const L = slLevels(R, 5.2, 5, 2000);
    expect(L.capped).toBe(false);
    expect(L.levels).toHaveLength(7);
    expect(check(R, L.levels, 5.2, 5)).toBeLessThan(1e-12);
    expect(cornerArcAtArcEnd(R, L.levels[3]!, 20.2)).toBe(true);
  });
  it('반지름 20 원호를 섞은 정 120각형(d 20.2)', () => {
    const R = pocket(jagged(120, 0, 20, 7, 0));
    const L = slLevels(R, 0.7, 0.5, 2000);
    expect(L.capped).toBe(false);
    expect(L.levels.length).toBeGreaterThan(39);
    expect(check(R, L.levels, 0.7, 0.5)).toBeLessThan(1e-8);
  });
  it('버려질 팔을 셈해도 모든 조각을 물은 것과 같다', () => {
    for (const els of [jagged(48, 0.5, 20, 7), jagged(90, 2, 20, 7)]) {
      const R = pocket(els);
      for (const d of [5.2, 19.9, 20.2, 25.2, 30.2]) expect(slOffset(R, d), `d = ${d}`).toStrictEqual(slOffset(R, d, true));
    }
  });
  it('SL 22 프로그램(CR R+20 섞인 들쭉날쭉한 48각형): 잇지 못한 고리 알림 없이 가운데까지 그린다', () => {
    const pts: string[] = [];
    for (let k = 0; k <= 48; k++) {
      const a = (-k * Math.PI * 2) / 48;
      const rr = 40 + (k % 2 ? 0.5 : 0);
      const xy = `X+${(50 + rr * Math.cos(a)).toFixed(3)} Y+${(50 + rr * Math.sin(a)).toFixed(3)}`;
      pts.push(k === 0 ? `L ${xy} RR` : k % 7 === 4 ? `CR ${xy} R+20 DR-` : `L ${xy}`);
    }
    const src = `0 BEGIN PGM SL MM
1 TOOL DEF 1 L+0 R+5
2 TOOL CALL 1 Z S3000
3 L X+0 Y+0 Z+50 R0 FMAX
4 CYCL DEF 14.0 CONTOUR
5 CYCL DEF 14.1 CONTOUR LABEL 7
6 CYCL DEF 20 CONTOUR DATA ~
  Q1=-5 ~
  Q2=+1 ~
  Q3=+0.2 ~
  Q4=+0 ~
  Q5=+0 ~
  Q6=+2 ~
  Q7=+50 ~
  Q8=+0 ~
  Q9=+1
7 CYCL DEF 22 ROUGH-OUT ~
  Q10=-5 ~
  Q11=+150 ~
  Q12=+500 ~
  Q18=+0 ~
  Q19=+0 ~
  Q208=+99999 ~
  Q401=+100 ~
  Q404=+0
8 CYCL CALL
9 M30
10 LBL 7
${pts.join('\n')}
11 LBL 0
999 END PGM SL MM
`;
    const p = parseHeidenhain(src);
    expect(p.warnings.filter((w) => w.includes('고리'))).toEqual([]);
    // 가장 안쪽 고리(d 35.2)까지 — 가운데에서 5 안쪽으로 들어간 자리
    let rMin = Infinity;
    for (let i = 0; i < p.moves.count; i++) {
      const e = moveEnd(p.moves, i);
      rMin = Math.min(rMin, Math.hypot(e[0] - 50, e[1] - 50));
    }
    expect(rMin).toBeLessThan(5);
  });
});

describe('51차: 볼록한 꼭짓점의 얇은 제비꼬리 조각(끊긴 가지 빼고 다시 잇기)', () => {
  it('반지름 41 원호를 섞은 정 120각형 — 원호 끝 거의 곧은 꼭짓점(50차는 d 30.25에서 멈춤)', () => {
    const R = pocket(jagged(120, 0, 41, 7, 0));
    const L = slLevels(R, 0.5, 0.25, 2000);
    expect(L.capped).toBe(false);
    expect(L.levels.length).toBeGreaterThan(119);
    expect(check(R, L.levels, 0.5, 0.25)).toBeLessThan(1e-6);
  });
  it('꼭짓점을 소수 둘째 자리로 반올림한 250각형·400각형(50차는 116겹·100겹에서 멈춤)', () => {
    for (const n of [250, 400]) {
      const R = pocket(jagged(n, 0, 0, 0, 0, 2));
      const L = slLevels(R, 0.5, 0.3, 2000);
      expect(L.capped, `${n}`).toBe(false);
      expect(L.levels, `${n}`).toHaveLength(132);
      expect(check(R, L.levels, 0.5, 0.3)).toBeLessThan(1e-6);
    }
  });
  it('정 1000각형의 바깥 고리(d 0.5): 꼭짓점마다 남던 얇은 제비꼬리 없이 요소 1000개 고리 하나(50차는 길이 0.006 삼각형 하나만)', () => {
    const R = pocket(jagged(1000, 0));
    const L = slOffset(R, 0.5);
    expect(L).toHaveLength(1);
    expect(L[0]).toHaveLength(1000);
    // 떨어진 정다각형의 둘레 = 2n · 변심거리 · tan(π/n)
    const a = 40 * Math.cos(Math.PI / 1000) - 0.5;
    expect(Math.abs(L[0]!.reduce((s, e) => s + Math.hypot(e.eu - e.su, e.ev - e.sv), 0) - 2000 * a * Math.tan(Math.PI / 1000))).toBeLessThan(1e-9);
    expect(check(R, [L], 0.5, 0)).toBeLessThan(1e-12);
  });
});
