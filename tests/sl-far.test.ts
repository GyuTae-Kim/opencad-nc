/**
 * 원점에서 아주 먼 작은 윤곽의 SL 옆 간격 고리(53차 — src/sl.ts SHIFT_RATIO). 모두 직접 만든 작은 합성 도형·프로그램.
 * 판정 여유는 윤곽 크기 × 10⁻⁹인데 좌표 반올림은 좌표 크기 × 2⁻⁵²라, 좌표가 윤곽 크기의 10⁶배쯤이면(0.1 mm 윤곽이 10⁶ mm 자리 등)
 * 고리를 잃거나 단계가 끊겼다. 이제 좌표/크기가 10⁴을 넘으면 둘레 상자 가운데를 빼고 셈해 되돌린다:
 * 같은(반올림된) 입력을 원점 근처로 옮겨 셈한 것과 단계·고리·요소 수가 같고 끝점은 좌표 반올림 단위(ulp) 하나 안에서 같다.
 * 문턱 아래(보통 좌표)는 예전 길 그대로다.
 */
import { describe, expect, it } from 'vitest';
import { parseHeidenhain } from '../src/heidenhain';
import { g7xLine } from '../src/lathe-g7x';
import { moveEnd } from '../src/model';
import { slDist, slInside, slLevels, slNear, slOffset, slRegion, slSegmentFree, type SlEl, type SlLoop } from '../src/sl';

const line = (a: number[], b: number[]): SlEl => g7xLine(a[0]!, a[1]!, b[0]!, b[1]!);
const poly = (pts: number[][]): SlLoop => pts.map((p, i) => line(p, pts[(i + 1) % pts.length]!));
/** 시계 방향(RR이면 포켓) 꼴들 — 자리 (T, V), 크기 s */
const shapes: Record<string, (T: number, V: number, s: number) => SlLoop> = {
  // 오목 꼭짓점 12개의 별
  star: (T, V, s) => poly([...Array(24).keys()].map((k) => [T + 5 * s + (k % 2 ? 2.2 : 4.5) * s * Math.cos((-k / 24) * Math.PI * 2), V + 5 * s + (k % 2 ? 2.2 : 4.5) * s * Math.sin((-k / 24) * Math.PI * 2)])),
  ngon: (T, V, s) => poly([...Array(200).keys()].map((k) => [T + 5 * s + 4 * s * Math.cos((-k / 200) * Math.PI * 2), V + 5 * s + 4 * s * Math.sin((-k / 200) * Math.PI * 2)])),
  round: (T, V, s) => {
    const r = 1.5 * s;
    const w = 10 * s;
    const h = 6 * s;
    const arc = (a: number[], b: number[], c: number[]): SlEl => ({ arc: true, su: a[0]!, sv: a[1]!, eu: b[0]!, ev: b[1]!, cu: c[0]!, cv: c[1]!, sweep: -Math.PI / 2 });
    return [
      line([T, V + r], [T, V + h - r]),
      arc([T, V + h - r], [T + r, V + h], [T + r, V + h - r]),
      line([T + r, V + h], [T + w - r, V + h]),
      arc([T + w - r, V + h], [T + w, V + h - r], [T + w - r, V + h - r]),
      line([T + w, V + h - r], [T + w, V + r]),
      arc([T + w, V + r], [T + w - r, V], [T + w - r, V + r]),
      line([T + w - r, V], [T + r, V]),
      arc([T + r, V], [T, V + r], [T + r, V + r]),
    ];
  },
};
/** 윤곽에서 (T, V)를 뺀 것 — 좌표가 T·V의 절반~두 배라 정확(Sterbenz) */
const back = (els: SlLoop, T: number, V: number): SlLoop => els.map((e) => ({ ...e, su: e.su - T, sv: e.sv - V, eu: e.eu - T, ev: e.ev - V, ...(e.arc ? { cu: e.cu - T, cv: e.cv - V } : {}) }));
const sig = (levels: SlLoop[][]): string => levels.map((ls) => ls.map((l) => l.length).join('+')).join(',');

describe('53차: 원점에서 아주 먼 작은 윤곽의 옆 간격 고리', () => {
  const cases: [string, number, number, number, number, number][] = [
    // 꼴, 크기 s, 간격(× s), T, V, 52차까지의 단계 수(원점 42·16·59)
    ['star', 0.01, 0.05, 1e6, 1e6, 42],
    ['star', 0.01, 0.05, 1e7, 1e7, 42],
    ['star', 0.1, 0.25, -1e7, 1e7, 9],
    ['ngon', 0.01, 0.25, 1e6, 0, 16],
    ['round', 0.1, 0.05, 1e7, 1e7, 59],
  ];
  for (const [name, s, st, T, V, n] of cases) {
    it(`${name} s ${s} 간격 ${st}s 자리 (${T}, ${V}): 같은 입력을 원점 근처에서 셈한 것과 같음(끝점은 ulp 하나 안)`, () => {
      const els = shapes[name]!(T, V, s);
      const L = slLevels(slRegion([{ els, pocket: true }]), 0.1 * s, st * s, 400, 5_000_000);
      const P = slLevels(slRegion([{ els: back(els, T, V), pocket: true }]), 0.1 * s, st * s, 400, 5_000_000);
      // 52차까지는 몇 겹에서 'open'으로 멈추거나 고리를 잃었다
      expect(L.capped).toBe(false);
      expect(L.levels).toHaveLength(n);
      expect(P.levels).toHaveLength(n);
      expect(sig(L.levels)).toBe(sig(P.levels));
      const ulp = Math.max(Math.abs(T), Math.abs(V)) * 2 ** -52;
      let worst = 0;
      L.levels.forEach((ls, k) =>
        ls.forEach((l, j) =>
          l.forEach((e, q) => {
            const f = P.levels[k]![j]![q]!;
            worst = Math.max(worst, Math.abs(e.su - T - f.su), Math.abs(e.sv - V - f.sv), Math.abs(e.eu - T - f.eu), Math.abs(e.ev - V - f.ev));
            if (e.arc) worst = Math.max(worst, Math.abs(e.cu - T - f.cu), Math.abs(e.cv - V - f.cv));
          }),
        ),
      );
      expect(worst).toBeLessThanOrEqual(ulp);
    });
  }

  it('자리를 받는 함수(slInside·slNear·slDist·slOffset·slSegmentFree)도 프로그램 자리로 답한다', () => {
    const s = 0.1;
    const T = 1e7;
    const R = slRegion([{ els: shapes.star!(T, T, s), pocket: true }]);
    const R0 = slRegion([{ els: shapes.star!(0, 0, s), pocket: true }]);
    expect(R.ou).toBeDefined();
    expect(R0.ou).toBeUndefined();
    // 별 가운데(안)와 바깥, 경계에서 0.1 떨어진 자리
    expect(slInside(R, T + 5 * s, T + 5 * s)).toBe(true);
    expect(slInside(R, T + 5 * s, T + 10 * s)).toBe(false);
    expect(slDist(R, T + 5 * s, T + 5 * s)).toBeCloseTo(slDist(R0, 5 * s, 5 * s), 7);
    expect(slNear(R, T + 5 * s, T + 5 * s, 3 * s)).toBe(slNear(R0, 5 * s, 5 * s, 3 * s));
    const o = slOffset(R, 0.1 * s);
    const o0 = slOffset(R0, 0.1 * s);
    expect(o.map((l) => l.length)).toEqual(o0.map((l) => l.length));
    expect(Math.abs(o[0]![0]!.su - T - o0[0]![0]!.su)).toBeLessThan(1e-7);
    // 가운데를 지나는 짧은 선분은 고리 안, 별 끝 너머로 나가는 선분은 고리를 가로지름
    expect(slSegmentFree(R, o, 0.1 * s, T + 5 * s, T + 4.9 * s, T + 5 * s, T + 5.1 * s)).toBe(true);
    expect(slSegmentFree(R, o, 0.1 * s, T + 5 * s, T + 5 * s, T + 9.6 * s, T + 5 * s)).toBe(false);
  });

  it('문턱(좌표/크기 10⁴) 아래는 예전 길 그대로 — 기준점을 빼지 않는다', () => {
    // 크기 약 1.2(대각선)의 별: 자리 10³(비 약 800)은 그대로, 10⁵(비 약 8 × 10⁴)은 뺀다
    expect(slRegion([{ els: shapes.star!(1e3, 1e3, 0.1), pocket: true }]).ou).toBeUndefined();
    expect(slRegion([{ els: shapes.star!(1e5, 1e5, 0.1), pocket: true }]).ou).toBeDefined();
    // 유한하지 않은 좌표는 견줌이 거짓이라 그대로
    expect(slRegion([{ els: poly([[0, 0], [0, NaN], [1, 1]]), pocket: true }]).ou).toBeUndefined();
  });

  it('SL 22 프로그램: 원점에서 10⁷ mm 떨어진 0.9 mm 별 포켓을 원점 프로그램과 같은 이동으로 그린다', () => {
    const prog = (T: number): string => {
      const pts: string[] = [];
      for (let k = 0; k <= 24; k++) {
        const a = (-(k % 24) / 24) * Math.PI * 2;
        // 끝마다 길이를 조금씩 달리한다(대칭이면 고리 차례·시작점의 같은 거리를 반올림이 가른다)
        const rr = (k % 2 ? 0.22 : 0.45) * (1 + 0.04 * Math.sin(k * 1.7));
        const xy = `X${T + 0.5 + rr * Math.cos(a) >= 0 ? '+' : ''}${(T + 0.5 + rr * Math.cos(a)).toFixed(5)} Y${T + 0.5 + rr * Math.sin(a) >= 0 ? '+' : ''}${(T + 0.5 + rr * Math.sin(a)).toFixed(5)}`;
        pts.push(k === 0 ? `L ${xy} RR` : `L ${xy}`);
      }
      return `0 BEGIN PGM FAR MM
1 TOOL DEF 1 L+0 R+0.005
2 TOOL CALL 1 Z S3000
3 L X+${T} Y+${T} Z+50 R0 FMAX
4 CYCL DEF 14.0 CONTOUR
5 CYCL DEF 14.1 CONTOUR LABEL 7
6 CYCL DEF 20 CONTOUR DATA ~
  Q1=-1 ~
  Q2=+1 ~
  Q3=+0.005 ~
  Q4=+0 ~
  Q5=+0 ~
  Q6=+2 ~
  Q7=+50 ~
  Q8=+0 ~
  Q9=+1
7 CYCL DEF 22 ROUGH-OUT ~
  Q10=-1 ~
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
999 END PGM FAR MM
`;
    };
    const far = parseHeidenhain(prog(1e7));
    const near0 = parseHeidenhain(prog(0));
    // 52차까지는 "옆 간격 고리를 잇지 못해 바깥 고리 몇 겹까지만 그림"
    expect(far.warnings.filter((w) => w.includes('고리'))).toEqual([]);
    expect(near0.warnings.filter((w) => w.includes('고리'))).toEqual([]);
    expect(far.moves.count).toBe(near0.moves.count);
    // 고리 시작점은 앞 고리 끝(꼭짓점 — 윤곽 두 변의 이등분선 위)에서 같은 거리인 두 자리 가운데 반올림이 고르므로(직선·원호 차례가 돌아감)
    // 자리마다 견주지 않고 이동 갈래 수·깎는 길이·둘레 상자로 견준다(입력 좌표의 반올림 — 10⁷에서 1.9 × 10⁻⁹ — 몇 배 안)
    const kinds = (p: typeof far): Record<number, number> => {
      const c: Record<number, number> = {};
      for (let i = 0; i < p.moves.count; i++) c[p.moves.kind[i]!] = (c[p.moves.kind[i]!] ?? 0) + 1;
      return c;
    };
    expect(kinds(far)).toEqual(kinds(near0));
    expect(Math.abs(far.stats.feedLength - near0.stats.feedLength)).toBeLessThan(1e-6);
    const bounds = (p: typeof far, T: number): number[] => {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.moves.count; i++) {
        const e = moveEnd(p.moves, i);
        b[0] = Math.min(b[0]!, e[0] - T);
        b[1] = Math.min(b[1]!, e[1] - T);
        b[2] = Math.max(b[2]!, e[0] - T);
        b[3] = Math.max(b[3]!, e[1] - T);
      }
      return b;
    };
    const bf = bounds(far, 1e7);
    const bn = bounds(near0, 0);
    for (let k = 0; k < 4; k++) expect(Math.abs(bf[k]! - bn[k]!)).toBeLessThan(1e-7);
  });
});
