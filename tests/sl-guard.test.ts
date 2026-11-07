/**
 * SL 사이클 출력·셈 안전장치(49차): 층 × 고리 이동 한도(사이클 한 번 100만 개 — 넘으면 앞 층 몇 개와 바닥 층만, 41차 9999층 안전장치와 같은 꼴)와
 * 옆 간격 고리 셈의 일 한도, 요소 상자 나무(slNear·slInside)가 모든 요소를 차례로 본 답과 같음. 모두 직접 만든 작은 합성 프로그램·도형
 */
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../site/i18n.mjs';
import { parseHeidenhain } from '../src/heidenhain';
import { g7xLine } from '../src/lathe-g7x';
import { MOVE_ARC, MOVE_FEED, moveEnd } from '../src/model';
import { slContains, slDist, slInside, slIsPocket, slLevels, slNear, slOffset, slRegion, type SlLoop } from '../src/sl';

const pgm = (body: string): string => `0 BEGIN PGM SL MM\n${body}\n999 END PGM SL MM\n`;
const data = (q: Record<string, number>): string =>
  `CYCL DEF 20 CONTOUR DATA ~\n` +
  Object.entries({ Q1: -5, Q2: 1, Q3: 0, Q4: 0, Q5: 0, Q6: 2, Q7: 50, Q8: 0, Q9: 1, ...q })
    .map(([k, v]) => `  ${k}=${v >= 0 ? '+' : ''}${v}`)
    .join(' ~\n');
const rough = (q10: number): string => `CYCL DEF 22 ROUGH-OUT ~\n  Q10=${q10} ~\n  Q11=+150 ~\n  Q12=+500 ~\n  Q18=+0 ~\n  Q19=+0 ~\n  Q208=+99999 ~\n  Q401=+100 ~\n  Q404=+0`;
/** 시계 방향 n각형(중심 50·50, 반지름 rr) — RR이면 포켓 */
const poly = (n: number, rr = 40): string =>
  [...Array(n + 1).keys()]
    .map((k) => {
      const a = (-k / n) * Math.PI * 2;
      return `L X+${(50 + rr * Math.cos(a)).toFixed(4)} Y+${(50 + rr * Math.sin(a)).toFixed(4)}${k === 0 ? ' RR' : ''}`;
    })
    .join('\n');
const square = 'L X+0 Y+0 RR\nL Y+60\nL X+80\nL Y+0\nL X+0';
const prog = (contour: string, r: number, d: Record<string, number>, cycle: string): string =>
  pgm(`1 TOOL DEF 1 L+0 R+${r}
2 TOOL CALL 1 Z S3000
3 L X+0 Y+0 Z+50 R0 FMAX
4 CYCL DEF 14.0 CONTOUR
5 CYCL DEF 14.1 CONTOUR LABEL 7
6 ${data(d)}
7 ${cycle}
8 CYCL CALL
9 M30
10 LBL 7
${contour}
11 LBL 0`);
/** 줄 번호를 뗀 경고 */
const plain = (ws: string[]): string[] => ws.map((w) => w.replace(/^\d+번 줄: /, ''));
/** 절삭(이송·호) 끝점의 서로 다른 깊이 */
const depths = (p: ReturnType<typeof parseHeidenhain>): number[] => {
  const s = new Set<number>();
  for (let i = 0; i < p.moves.count; i++) if (p.moves.kind[i] === MOVE_FEED || p.moves.kind[i] === MOVE_ARC) s.add(Math.round(moveEnd(p.moves, i)[2] * 1e6) / 1e6);
  return [...s].sort((a, b) => b - a);
};

describe('SL 사이클 층 × 고리 이동 한도(사이클 한 번 100만 개)', () => {
  it('Q10이 아주 작아 9999층 × 고리가 100만 개를 넘으면 앞 층 몇 개와 바닥 층만 그리고 알린다', () => {
    // 사각 80 × 60, 공구 0.5·겹침 0.5 → 고리 100개 남짓(층 하나 이동 수백 개), Q1 -20 · Q10 0.002 → 9999층
    const src = prog(square, 0.5, { Q1: -20, Q2: 0.5 }, rough(-0.002));
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual(['CYCL DEF 22: 층 × 고리 이동이 1000000개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감']);
    expect(p.moves.count).toBeLessThanOrEqual(1_000_000 + 10);
    const z = depths(p);
    // 바닥 층(-20)은 그리고, 앞 층은 0.002씩
    expect(z[z.length - 1]).toBe(-20);
    expect(z[0]).toBe(-0.002);
    expect(z[1]).toBe(-0.004);
    expect(z.length).toBeGreaterThan(100);
    expect(z.length).toBeLessThan(9999);
    // 바닥 바로 앞 층과 바닥 사이는 건너뜀
    expect(z[z.length - 2]!).toBeGreaterThan(-19);
  });
  it('층 × 고리가 한도 안이면 예전 그대로(9999층 안전장치만)', () => {
    // 작은 사각(공구 반지름에 가까움) → 층 하나가 몇 개 이동이라 9999층 × 이동이 한도 안
    const tiny = 'L X+0 Y+0 RR\nL Y+12\nL X+12\nL Y+0\nL X+0';
    const src = prog(tiny, 5, { Q1: -20 }, rough(-0.001));
    const p = parseHeidenhain(src);
    expect(plain(p.warnings)).toEqual(['CYCL DEF 22: 층이 9999개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감']);
    expect(depths(p)).toHaveLength(10000);
  });
  it('24 옆면 다듬질도 층 × 고리 이동이 한도를 넘으면 앞 층 몇 개와 바닥 층만', () => {
    const src = prog(poly(400), 2, { Q1: -20, Q3: 0.2 }, 'CYCL DEF 24 SIDE FINISHING ~\n  Q9=+1 ~\n  Q10=-0.002 ~\n  Q11=+100 ~\n  Q12=+400 ~\n  Q14=+0 ~\n  Q438=-1');
    const p = parseHeidenhain(src);
    expect(plain(p.warnings).filter((w) => !w.includes('Q14 + 공구 반지름'))).toEqual(['CYCL DEF 24: 층 × 고리 이동이 1000000개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감']);
    expect(p.moves.count).toBeLessThanOrEqual(1_000_000 + 10);
    expect(depths(p).at(-1)).toBe(-20);
  });
});

describe('SL 옆 간격 고리 셈의 일 한도', () => {
  it('요소가 아주 많은 원꼴 윤곽 + 작은 공구: 50차부터 일 한도에 닿지 않고, 고리를 잇지 못한 단계에서 멈추면 그렇게 알린다', () => {
    // 1600각형(반지름 40, 꼭짓점 소수 넷째 자리) · 공구 0.5 · 겹침 Q2 0.5(간격 0.25) → 고리 158개. 49차에는 가운데 가까운 고리의 버려질 조각마다
    // 거리를 물어 일 한도(1억)에 닿아 바깥 고리 몇 겹까지만 그렸다 — 50차는 버려질 팔·고리띠 조각으로 같은 고리를 일 몇백만으로 셈한다.
    // 꼭짓점이 반올림된 아주 잘은 원꼴 윤곽은 가운데 가까운 고리(반지름 3.5쯤)의 남은 조각이 끊겨 닫힌 고리가 되지 않는다(49차도 같은 길 —
    // 그 앞 고리까지만 그림). 49차는 그 전에 일 한도 경고가 났고, 50차는 고리를 잇지 못했다고 알린다
    const src = prog(poly(1600), 0.5, { Q1: -5, Q2: 0.5 }, rough(-5));
    const t0 = performance.now();
    const p = parseHeidenhain(src);
    const ms = performance.now() - t0;
    expect(p.warnings).toHaveLength(1);
    expect(plain(p.warnings)[0]).toMatch(/^CYCL DEF 22: 옆 간격 고리를 잇지 못해 바깥 고리 \d+겹까지만 그림$/);
    const rings = Number(/고리 (\d+)겹/.exec(p.warnings[0]!)![1]);
    expect(rings).toBeGreaterThan(100);
    expect(rings).toBeLessThan(158);
    // 그린 고리는 모두 벽에서 공구 반지름 이상 안쪽이고, 가장 안쪽 고리는 그린 고리 수만큼 들어간 자리
    let rMin = Infinity;
    for (let i = 0; i < p.moves.count; i++)
      if (p.moves.kind[i] === MOVE_FEED) {
        const e = moveEnd(p.moves, i);
        const rr = Math.hypot(e[0] - 50, e[1] - 50);
        // 꼭짓점 좌표를 소수 넷째 자리로 적어 반지름이 1e-4까지 들쭉날쭉
        expect(rr).toBeLessThanOrEqual(40 - 0.5 + 1e-4);
        rMin = Math.min(rMin, rr);
      }
    expect(rMin).toBeGreaterThan(40 - 0.5 - 0.25 * rings - 0.01);
    expect(rMin).toBeLessThan(40 - 0.5 - 0.25 * (rings - 2));
    // 한도는 일(셈 수)로 정해 기계 빠르기와 상관없이 같은 결과 — 여기서는 시간이 넉넉히 짧음만 본다
    expect(ms).toBeLessThan(30_000);
  });
  it('고리 셈의 일이 한도(evals)를 넘으면 그 고리부터 셈하지 않고 바깥 고리까지만 돌려준다(그린 고리는 한도 없을 때와 같다)', () => {
    const els = polyEls(500);
    const full = slLevels(slRegion([{ els, pocket: slIsPocket(els, 2) }]), 0.5, 0.25, 2000);
    expect(full.capped).toBe(false);
    expect(full.levels).toHaveLength(158);
    const R = slRegion([{ els, pocket: slIsPocket(els, 2) }]);
    const w0 = R.work ?? 0;
    const cut = slLevels(R, 0.5, 0.25, 2000, undefined, 200_000);
    expect(cut.capped).toBe('work');
    expect(cut.levels.length).toBeGreaterThan(5);
    expect(cut.levels.length).toBeLessThan(158);
    expect(cut.levels).toStrictEqual(full.levels.slice(0, cut.levels.length));
    // 넘은 고리 하나만큼 더 셈하고 그만둔다
    expect((R.work ?? 0) - w0).toBeLessThan(200_000 + 100_000);
  });
});

/** 시계 방향 n각형 요소(중심 50·50, 반지름 rr) — cr이 있으면 꼭짓점 사이를 반지름 cr 원호(바깥으로 볼록)로 */
function polyEls(n: number, rr = 40, cr = 0): SlLoop {
  const out: SlLoop = [];
  for (let k = 0; k < n; k++) {
    const a0 = (-k / n) * Math.PI * 2;
    const a1 = (-(k + 1) / n) * Math.PI * 2;
    const s = [50 + rr * Math.cos(a0), 50 + rr * Math.sin(a0)] as const;
    const e = [50 + rr * Math.cos(a1), 50 + rr * Math.sin(a1)] as const;
    if (!cr) {
      out.push(g7xLine(s[0], s[1], e[0], e[1]));
      continue;
    }
    // 현의 가운데에서 안쪽(윤곽 가운데 쪽)으로 중심 — 시계 원호
    const mu = (s[0] + e[0]) / 2;
    const mv = (s[1] + e[1]) / 2;
    const half = Math.hypot(e[0] - s[0], e[1] - s[1]) / 2;
    const h = Math.sqrt(cr * cr - half * half);
    const nu = (50 - mu) / Math.hypot(50 - mu, 50 - mv);
    const nv = (50 - mv) / Math.hypot(50 - mu, 50 - mv);
    const cu = mu + nu * h;
    const cv = mv + nv * h;
    const sw = -2 * Math.asin(half / cr);
    out.push({ arc: true, su: s[0], sv: s[1], eu: e[0], ev: e[1], cu, cv, sweep: sw });
  }
  return out;
}

describe('50차 버려질 팔·고리띠 조각은 떨어진 곡선을 바꾸지 않는다', () => {
  /** 떨어진 곡선을 두 길(버려질 팔을 셈함·모든 조각을 물음)로 셈해 같은지, 셈한 일은 얼마인지 */
  const both = (R: ReturnType<typeof slRegion>, ds: number[]): { fast: number; plainWork: number } => {
    let fast = 0;
    let plainWork = 0;
    for (const d of ds) {
      const w0 = R.work ?? 0;
      const a = slOffset(R, d);
      const w1 = R.work ?? 0;
      const b = slOffset(R, d, true);
      fast += w1 - w0;
      plainWork += (R.work ?? 0) - w1;
      expect(a, `d = ${d}`).toStrictEqual(b);
    }
    return { fast, plainWork };
  };
  it('원꼴 다각형(300각형): 가운데 가까운 고리와 비는 고리까지 같고, 일은 훨씬 적다', () => {
    const els = polyEls(300);
    const R = slRegion([{ els, pocket: slIsPocket(els, 2) }]);
    const ap = 40 * Math.cos(Math.PI / 300);
    const w = both(R, [0.5, 10, 30, ap - 1, ap - 0.3, ap - 0.05, ap - 0.004, ap + 0.0005, ap + 0.01]);
    expect(slOffset(R, ap - 0.05).length).toBeGreaterThan(0);
    expect(slOffset(R, ap + 0.0005)).toEqual([]);
    expect(w.fast * 5).toBeLessThan(w.plainWork);
  });
  it('바깥으로 볼록한 원호 200개로 된 원꼴 윤곽(원호 날 요소는 팔을 셈하지 않음)', () => {
    const els = polyEls(200, 40, 300);
    const R = slRegion([{ els, pocket: slIsPocket(els, 2) }]);
    both(R, [0.5, 20, 38, 39.5, 39.9, 39.99]);
  });
  it('들쭉날쭉한 다각형 포켓 + 원호 섞인 섬, 오목한 꼭짓점이 많은 별꼴 포켓, 섬 여럿', () => {
    const pts: [number, number][] = [...Array(120).keys()].map((k) => {
      const a = (k / 120) * Math.PI * 2;
      const rr = 40 + (k % 3 === 0 ? 3 : k % 3 === 1 ? -2 : 0.5);
      return [50 + rr * Math.cos(a), 50 + rr * Math.sin(a)];
    });
    const jag: SlLoop = pts.map((p, i) => g7xLine(p[0], p[1], pts[(i + 1) % pts.length]![0], pts[(i + 1) % pts.length]![1]));
    const isl = polyEls(30, 10, 0).map((e) => ({ ...e, su: e.su + 5, eu: e.eu + 5, sv: e.sv - 2, ev: e.ev - 2 }));
    both(slRegion([{ els: jag, pocket: slIsPocket(jag, 1) }, { els: isl, pocket: false }]), [0.5, 2, 4, 8, 15, 25]);
    // 별꼴(꼭짓점 80개 — 오목한 꼭짓점 40개는 모서리 원호가 생김)
    const sp: [number, number][] = [...Array(80).keys()].map((k) => {
      const a = (k / 80) * Math.PI * 2;
      const rr = k % 2 ? 22 : 40;
      return [50 + rr * Math.cos(a), 50 + rr * Math.sin(a)];
    });
    const star: SlLoop = sp.map((p, i) => g7xLine(p[0], p[1], sp[(i + 1) % sp.length]![0], sp[(i + 1) % sp.length]![1]));
    both(slRegion([{ els: star, pocket: slIsPocket(star, 1) }]), [0.3, 1, 2, 3.5, 8, 15, 21]);
    // 사각 포켓 안 원꼴 섬 둘
    const sq: SlLoop = [g7xLine(0, 0, 0, 100), g7xLine(0, 100, 100, 100), g7xLine(100, 100, 100, 0), g7xLine(100, 0, 0, 0)];
    const i1 = polyEls(90, 12).map((e) => ({ ...e, su: e.su - 20, eu: e.eu - 20, cu: e.cu - 20 }));
    const i2 = polyEls(60, 15).map((e) => ({ ...e, su: e.su + 22, eu: e.eu + 22, cu: e.cu + 22, sv: e.sv + 5, ev: e.ev + 5, cv: e.cv + 5 }));
    both(slRegion([{ els: sq, pocket: true }, { els: i1, pocket: false }, { els: i2, pocket: false }]), [0.5, 3, 6, 11, 18, 30]);
  });
  it('고리띠 조각으로 가지친 거리 판정이 모든 요소를 차례로 본 답과 같다(원꼴 윤곽 가운데 가까운 점)', () => {
    for (const els of [polyEls(500), polyEls(150, 40, 200)]) {
      const R = slRegion([{ els, pocket: slIsPocket(els, 2) }]);
      expect(R.loopTree).toBeTruthy();
      let n = 0;
      for (let k = 0; k < 400; k++) {
        const a = k * 2.399963;
        const rr = 3 * Math.sqrt((k + 0.5) / 400);
        const u = 50 + rr * Math.cos(a);
        const v = 50 + rr * Math.sin(a);
        const d = slDist(R, u, v);
        for (const t of [d - 1e-6, d, d + 1e-9, d + 1e-6, d + 0.01, 0.5 * d]) {
          expect(slNear(R, u, v, t), `${u},${v},${t}`).toBe(d < t);
          n++;
        }
      }
      expect(n).toBe(2400);
    }
  });
});

describe('요소 상자 나무(slNear·slInside)는 모든 요소를 차례로 본 답과 같다', () => {
  // 들쭉날쭉한 다각형 포켓(요소 120개 — 나무를 만드는 수 이상) + 원호 섞인 섬
  const pts: [number, number][] = [...Array(120).keys()].map((k) => {
    const a = (k / 120) * Math.PI * 2;
    const rr = 40 + (k % 3 === 0 ? 3 : k % 3 === 1 ? -2 : 0.5);
    return [50 + rr * Math.cos(a), 50 + rr * Math.sin(a)];
  });
  const pocket: SlLoop = pts.map((p, i) => g7xLine(p[0], p[1], pts[(i + 1) % pts.length]![0], pts[(i + 1) % pts.length]![1]));
  const isl: SlLoop = [];
  for (let k = 0; k < 30; k++) {
    const a0 = (-k / 30) * Math.PI * 2;
    const a1 = (-(k + 1) / 30) * Math.PI * 2;
    const p0 = [55 + 10 * Math.cos(a0), 48 + 10 * Math.sin(a0)];
    const p1 = [55 + 10 * Math.cos(a1), 48 + 10 * Math.sin(a1)];
    isl.push(k % 4 === 0 ? { arc: true, su: p0[0]!, sv: p0[1]!, eu: p1[0]!, ev: p1[1]!, cu: 55, cv: 48, sweep: a1 - a0 } : g7xLine(p0[0]!, p0[1]!, p1[0]!, p1[1]!));
  }
  const R = slRegion([
    { els: pocket, pocket: slIsPocket(pocket, 1) },
    { els: isl, pocket: false },
  ]);
  it('나무가 만들어지고, 격자 점과 경계 가까운 점에서 안쪽 판정·거리 판정이 차례로 본 것과 같다', () => {
    expect(R.pocketTrees?.[0]).toBeTruthy();
    expect(R.islandTrees?.[0]).toBeTruthy();
    expect(R.loopTree).toBeTruthy();
    let n = 0;
    for (let u = 5; u <= 95; u += 0.731)
      for (let v = 5; v <= 95; v += 0.913) {
        const brute = slContains(pocket, u, v) && !slContains(isl, u, v);
        expect(slInside(R, u, v), `${u},${v}`).toBe(brute);
        for (const t of [0.01, 0.5, 3, 12.7]) expect(slNear(R, u, v, t), `${u},${v},${t}`).toBe(slDist(R, u, v) < t);
        n++;
      }
    expect(n).toBeGreaterThan(5000);
    // 경계 위·꼭짓점·원호 끝 바로 옆(반올림이 걸리는 자리)
    for (const l of [pocket, isl])
      for (const e of l)
        for (const [du, dv] of [
          [0, 0],
          [1e-9, 0],
          [0, -1e-9],
          [1e-6, 1e-6],
        ]) {
          const u = e.su + du!;
          const v = e.sv + dv!;
          expect(slInside(R, u, v)).toBe(slContains(pocket, u, v) && !slContains(isl, u, v));
          for (const t of [1e-9, 1e-6, 0.3]) expect(slNear(R, u, v, t)).toBe(slDist(R, u, v) < t);
        }
  });
  it('떨어진 곡선은 나무 없이(요소를 차례로 보는 길) 셈한 것과 같다', () => {
    const off = slOffset(R, 4);
    const brute = slOffset({ ...R, pocketTrees: undefined, islandTrees: undefined, loopTree: null, work: 0 }, 4);
    expect(off).toEqual(brute);
    expect(off.length).toBeGreaterThanOrEqual(2);
    for (const l of off)
      for (const e of l) {
        // 요소 가운데 점(원호는 호 위)
        const a = Math.atan2(e.sv - e.cv, e.su - e.cu) + e.sweep / 2;
        const rr = Math.hypot(e.su - e.cu, e.sv - e.cv);
        const mu = e.arc ? e.cu + rr * Math.cos(a) : (e.su + e.eu) / 2;
        const mv = e.arc ? e.cv + rr * Math.sin(a) : (e.sv + e.ev) / 2;
        // 공구 중심 경로의 점은 경계에서 4 안쪽 이상이고 가공 면 안
        expect(slDist(R, mu, mv)).toBeGreaterThan(4 - 1e-6);
        expect(slInside(R, mu, mv)).toBe(true);
      }
  });
});

describe('새 경고 글은 네 언어 사전에 있다', () => {
  it('한국어 글자가 남지 않는다', () => {
    const texts = [
      'CYCL DEF 22: 층 × 고리 이동이 1000000개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감',
      'CYCL DEF 22: 이동이 1000000개를 넘어 그 뒤는 그리지 않음',
      'CYCL DEF 22: 옆 간격 고리 셈이 한도를 넘어 바깥 고리 12겹까지만 그림',
      'CYCL DEF 21: 옆 간격 고리 셈이 한도를 넘어 그리지 않음',
      'CYCL DEF 22: 옆 간격 고리를 잇지 못해 바깥 고리 144겹까지만 그림',
      'CYCL DEF 23: 옆 간격 고리를 잇지 못해 그리지 않음',
    ];
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
  });
});
