/**
 * SL 옆 간격 고리 잇기(59차 — src/sl.ts chainBack·dropRetrace). 모두 직접 만든 작은 합성 도형·프로그램.
 * 1) 갈림길에서 되돌아가는 잇기: 벽에 아주 작은 턱(높이 0.00002 mm의 경사 두 토막 — 볼록한 꼭짓점 둘과 오목한 꼭짓점 하나가 0.01 mm 안에 붙음)이
 *    있으면 그 둘레의 떨어진 곡선 조각(꼭짓점 호, 판정 여유 안이라 남은 얇은 제비꼬리)이 잇기 허용(윤곽 크기의 백만분의 1) 안에 몰려 갈림길이 여럿 생긴다.
 *    가장 오른쪽으로 꺾는 조각만 고르는 잇기(chain)는 제비꼬리 쪽으로 들어가 되돌아 나올 조각을 앞서 써 버려 막히고, 끊긴 가지를 빼도(prune)
 *    다시 막혀 그 단계의 고리를 통째로 잃었다(58차 — 단계가 비면 잇지 못함 알림, 그 안쪽은 그리지 않음). 이제 막히면 되돌아가 다른 길로 닫는다.
 * 2) 작은 고리 빼기: 꺾임이 아주 작은 오목한 꼭짓점의 호(길이 d × 꺾임 — 0.0001 mm 안팎)를 긴 고리가 잇기 허용 안에서 건너 이으면 그 호가 따로
 *    작은 고리로 남아 거친 깎기가 그 자리를 한 번 더 돌았다. 다른 고리가 지나는 자리의 작은 고리(잇기 허용의 100배 이하이고 꼭짓점이 모두
 *    다른 고리에서 잇기 허용 안)는 뺀다.
 */
import { describe, expect, it } from 'vitest';
import { parseHeidenhain } from '../src/heidenhain';
import { g7xLine } from '../src/lathe-g7x';
import { MOVE_ARC, MOVE_FEED, moveEnd } from '../src/model';
import { slAt, slDist, slElLen, slInside, slLevels, slOffset, slRegion, type SlLoop, type SlRegion } from '../src/sl';

/** 꼭짓점 목록(반시계 — 가공 면이 왼쪽)을 직선 고리로 */
const poly = (pts: readonly (readonly [number, number])[]): SlLoop => pts.map((s, k) => g7xLine(s[0], s[1], pts[(k + 1) % pts.length]![0], pts[(k + 1) % pts.length]![1]));
/** 아래 변의 작은 턱: 0.01 mm 동안 0.00002 mm 오르는 경사 두 토막(소수 다섯째 자리 좌표) */
const RAMP: [number, number][] = [
  [0, 0],
  [50, 0],
  [50.00505, 0.00001],
  [50.00957, 0.00002],
  [100, 0.00002],
  [100, 100],
  [0, 100],
];
/** 아래 변 가운데를 dl만큼 올린 사각 — (50, dl)은 꺾임 4·dl/100의 오목한 꼭짓점 */
const kink = (dl: number): [number, number][] => [
  [0, 0],
  [50, dl],
  [100, 0],
  [100, 100],
  [0, 100],
];
const pocket = (pts: readonly (readonly [number, number])[]): SlRegion => slRegion([{ els: poly(pts), pocket: true }]);
const len = (l: SlLoop): number => l.reduce((s, e) => s + slElLen(e), 0);

/**
 * 고리들의 바름 — 이어진 닫힌 고리, 요소 위 점이 가공 면 안이고 경계까지 거리가 d. |거리 − d|의 가장 큰 값을 돌려준다
 * (턱 둘레는 판정 여유 — 윤곽 크기의 10⁻⁹, 여기서 1.4 × 10⁻⁷ — 안이라 남은 얇은 제비꼬리 조각이 고리에 들 수 있어 그만큼 벗어남)
 */
function check(R: SlRegion, loops: SlLoop[], d: number): number {
  let worst = 0;
  for (const l of loops)
    l.forEach((a, i) => {
      const b = l[(i + 1) % l.length]!;
      expect(Math.hypot(a.eu - b.su, a.ev - b.sv)).toBeLessThan(1e-12);
      for (const t of [0.25, 0.5, 0.75]) {
        const [u, v] = slAt(a, t);
        worst = Math.max(worst, Math.abs(slDist(R, u, v) - d));
        expect(slInside(R, u, v)).toBe(true);
      }
    });
  return worst;
}

const prog = (contour: string, r: number): string => `0 BEGIN PGM SL MM
1 TOOL DEF 1 L+0 R+${r}
2 TOOL CALL 1 Z S3000
3 L X+50 Y+50 Z+50 R0 FMAX
4 CYCL DEF 14.0 CONTOUR
5 CYCL DEF 14.1 CONTOUR LABEL 7
6 CYCL DEF 20 CONTOUR DATA ~
  Q1=-5 ~
  Q2=+1 ~
  Q3=+0 ~
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
${contour}
11 LBL 0
999 END PGM SL MM
`;
/** 반시계 꼭짓점 목록 → 윤곽 줄(RL — 포켓) */
const contourOf = (pts: readonly (readonly [number, number])[]): string =>
  [...pts, pts[0]!].map((p, k) => `L X${p[0] >= 0 ? '+' : ''}${p[0]} Y${p[1] >= 0 ? '+' : ''}${p[1]}${k === 0 ? ' RL' : ''}`).join('\n');
const plain = (ws: string[]): string[] => ws.map((w) => w.replace(/^\d+번 줄: /, ''));
/** 절삭(이송·호) 끝점 가운데 가운데(50, 50)에서 가장 가까운 거리 */
const reach = (p: ReturnType<typeof parseHeidenhain>): number => {
  let m = Infinity;
  for (let i = 0; i < p.moves.count; i++) {
    if (p.moves.kind[i] !== MOVE_FEED && p.moves.kind[i] !== MOVE_ARC) continue;
    const e = moveEnd(p.moves, i);
    m = Math.min(m, Math.hypot(e[0] - 50, e[1] - 50));
  }
  return m;
};

describe('59차: 갈림길에서 되돌아가는 고리 잇기', () => {
  it('아래 변의 작은 턱(0.01 mm 동안 0.00002 mm): d 5의 고리를 잃지 않고 닫는다(58차는 고리 0개)', () => {
    const R = pocket(RAMP);
    const L = slOffset(R, 5);
    expect(L).toHaveLength(1);
    // 떨어진 사각(90 × 90)의 둘레 — 턱만큼 아주 조금 다름
    expect(Math.abs(len(L[0]!) - 360)).toBeLessThan(1e-3);
    expect(check(R, L, 5)).toBeLessThan(1.5e-7);
  });
  it('같은 꼴의 모든 단계(d 5 ~ 45)가 닫혀 가운데까지 간다', () => {
    const R = pocket(RAMP);
    const L = slLevels(R, 5, 5, 2000);
    expect(L.capped).toBe(false);
    expect(L.levels).toHaveLength(9);
    L.levels.forEach((loops, k) => {
      expect(loops, `d = ${5 + 5 * k}`).toHaveLength(1);
      expect(check(R, loops, 5 + 5 * k)).toBeLessThan(1.5e-7);
    });
  });
  it('SL 22 프로그램(소수 다섯째 자리 좌표의 턱): 잇지 못함 알림 없이 가운데까지 그린다', () => {
    const p = parseHeidenhain(prog(contourOf(RAMP), 5));
    expect(plain(p.warnings).filter((w) => w.includes('고리'))).toEqual([]);
    // 가장 안쪽 고리(d 45 — 10 × 10 사각)까지
    expect(reach(p)).toBeLessThan(8);
  });
});

describe('59차: 다른 고리가 지나는 자리의 작은 고리 빼기', () => {
  it('꺾임 0.00002 rad의 오목한 꼭짓점: 길이 0.0001의 꼭짓점 호가 따로 고리로 남지 않는다(58차는 고리 2개)', () => {
    const R = pocket(kink(0.0005));
    const L = slOffset(R, 5);
    expect(L).toHaveLength(1);
    expect(L[0]).toHaveLength(5);
    expect(check(R, L, 5)).toBeLessThan(1e-9);
  });
  it('호가 잇기 허용보다 길면 긴 고리에 그대로 든다(바뀌지 않음)', () => {
    const R = pocket(kink(0.01));
    const L = slOffset(R, 5);
    expect(L).toHaveLength(1);
    expect(L[0]).toHaveLength(6);
    expect(L[0]!.filter((e) => e.arc)).toHaveLength(1);
  });
  it('다른 고리에서 떨어진 아주 작은 고리(가운데에서 거의 사라지는 고리)는 남긴다', () => {
    // 반지름 10 원 포켓, d = 10 − 0.00001 → 반지름 0.00001 원(길이 0.000063 — 잇기 허용 0.000028의 2배쯤)
    const circle: SlLoop = [{ arc: true, su: 60, sv: 50, eu: 60, ev: 50, cu: 50, cv: 50, sweep: Math.PI * 2 }];
    const R = slRegion([{ els: circle, pocket: true }]);
    const L = slOffset(R, 10 - 0.00001);
    expect(L).toHaveLength(1);
    expect(len(L[0]!)).toBeCloseTo(Math.PI * 2 * 0.00001, 9);
  });
  it('SL 22 프로그램: d 5 단계의 꼭짓점 호를 따로 돌지 않는다 — 호 이동은 호가 잇기 허용보다 긴 단계(d 10 ~ 45)의 8개뿐', () => {
    const arcs = (p: ReturnType<typeof parseHeidenhain>): number => p.moves.kind.slice(0, p.moves.count).filter((k) => k === MOVE_ARC).length;
    const straight = parseHeidenhain(prog(contourOf([[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]]), 5));
    const bent = parseHeidenhain(prog(contourOf(kink(0.0005)), 5));
    expect(bent.warnings).toEqual(straight.warnings);
    expect(arcs(straight)).toBe(0);
    // 58차는 바깥 고리에 들어가기 전에 그 자리의 작은 고리(길이 0.0001 호)를 따로 한 번 돌았다(호 9개)
    expect(arcs(bent)).toBe(8);
    expect(bent.moves.count - straight.moves.count).toBe(8);
  });
});
