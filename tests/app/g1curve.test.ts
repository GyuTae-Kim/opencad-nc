/**
 * G1으로 풀어 쓴 곡선 토막 찾기(34차 — src/app/g1curve.ts)를 합성 프로그램으로.
 * - 곡선: CAM처럼 처짐 허용치로 나눈 원·사분원(좌표 소수 셋째 자리), 나선 진입, 타원(고르지 않은 나눔), S자, 곡면 줄 가공,
 *   회전축 감기(A가 바뀌는 이동), 좌표 회전(G68) 중 평면이 다른 원호(직선 조각으로 그림) — 그 토막은 곡선 조각, 앞뒤 접선 직선은 아니다
 * - 진짜 직선: 모따기 사각형, 6·8·12·16각형, 지그재그, 반올림 흔들림이 있는 나눈 직선(평면·비스듬히), 긴 직선 사이 짧은 직선(완만한 꺾임),
 *   모서리를 도는 짧은 직선(30°·22.5°·45°), 계단, 드릴, 진짜 원호(G2/G3)와 직선 — 곡선 조각이 하나도 없다
 * - 판정 한도를 조금씩 바꿔도(꺾임각 15°, 비 1.5·2.2 등) 진짜 직선은 곡선 조각이 되지 않는다
 */
import { describe, expect, it } from 'vitest';
import { parseForView } from '../../src/app/payload';
import { G1_CURVE_RULES, g1CurvePieces, type G1CurveRules } from '../../src/app/g1curve';
import { MOVE_FEED, MOVE_RAPID } from '../../src/model';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const D = Math.PI / 180;
const f3 = (x: number): string => (Math.round(x * 1000) / 1000).toFixed(3);
type Lab = 'c' | 's' | null;

/** 줄마다 이름표(c 곡선 토막, s 진짜 직선)를 단 합성 프로그램 */
class Prog {
  lines: string[] = ['G21 G90 G17 G94'];
  labs: Lab[] = [null];
  x = 0;
  y = 0;
  z = 0;
  add(l: string, lab: Lab = null): void {
    this.lines.push(l);
    this.labs.push(lab);
  }
  g0(x: number, y: number, z: number): void {
    this.add(`G0 X${f3(x)} Y${f3(y)} Z${f3(z)}`);
    [this.x, this.y, this.z] = [x, y, z];
  }
  g1(x: number, y: number, z: number, lab: Lab): void {
    this.add(`G1 X${f3(x)} Y${f3(y)} Z${f3(z)} F800`, lab);
    [this.x, this.y, this.z] = [x, y, z];
  }
  text(): string {
    return [...this.lines, 'M30'].join('\n');
  }
}

/** 원호를 처짐 tol로 나눈 G1(시작점은 이미 거기), z0 → z1(나선) */
function arcG1(p: Prog, cx: number, cy: number, r: number, a0: number, sweep: number, tol: number, z0: number, z1 = z0): void {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (2 * Math.acos(1 - tol / r))));
  for (let k = 1; k <= n; k++) {
    const a = a0 + (sweep * k) / n;
    p.g1(cx + r * Math.cos(a), cy + r * Math.sin(a), z0 + ((z1 - z0) * k) / n, 'c');
  }
}

/** 접선 진입(길이 lead) → 원호 → 접선 나가기 */
function leadArc(p: Prog, r: number, sweep: number, tol: number, lead: number): void {
  const a0 = 10 * D;
  const sg = Math.sign(sweep);
  const t0 = [-Math.sin(a0) * sg, Math.cos(a0) * sg];
  p.g0(r * Math.cos(a0) - lead * t0[0]!, r * Math.sin(a0) - lead * t0[1]!, 0);
  p.g1(r * Math.cos(a0), r * Math.sin(a0), 0, 's');
  arcG1(p, 0, 0, r, a0, sweep, tol, 0);
  const a1 = a0 + sweep;
  p.g1(p.x - Math.sin(a1) * sg * lead, p.y + Math.cos(a1) * sg * lead, 0, 's');
}

/** 이름표별 셈: 곡선 토막 가운데 곡선 조각으로 본 수·놓친 수, 진짜 직선 가운데 곡선 조각으로 본 수(잘못) */
function tally(p: Prog, rules: Readonly<G1CurveRules> = G1_CURVE_RULES, rotary = false) {
  const r = parseForView('t.nc', enc(p.text()), rotary ? { rotary: true } : {});
  const nc = r.nc!;
  const mark = g1CurvePieces(nc, rules);
  const m = nc.moves;
  const o = { curve: 0, found: 0, missed: 0, straight: 0, wrong: 0 };
  for (let i = 0; i < m.count; i++) {
    if (m.kind[i] !== MOVE_FEED && m.kind[i] !== MOVE_RAPID) {
      expect(mark[i], `곧은 이동이 아닌 이동 ${i}`).toBe(0);
      continue;
    }
    const lab = p.labs[m.line[i]!] ?? null;
    if (lab === 'c') {
      o.curve++;
      if (mark[i]) o.found++;
      else o.missed++;
    } else if (lab === 's') {
      o.straight++;
      if (mark[i]) o.wrong++;
    }
  }
  return o;
}

function curvePrograms(): { key: string; p: Prog; rotary?: boolean }[] {
  const out: { key: string; p: Prog; rotary?: boolean }[] = [];
  for (const [r, tol] of [[2, 0.005], [10, 0.001], [10, 0.01], [50, 0.01], [250, 0.005]] as const)
    for (const sw of [360, 90]) {
      const p = new Prog();
      leadArc(p, r, sw * D, tol, Math.max(20, 3 * r));
      out.push({ key: `arc ${sw}° R${r} tol ${tol}`, p });
      // 현과 같은 길이의 접선 진입·나가기(반대 방향)
      const q = new Prog();
      leadArc(q, r, -sw * D, tol, 2 * r * Math.sin(Math.acos(1 - tol / r)));
      out.push({ key: `arc ${sw}° R${r} tol ${tol} short lead`, p: q });
    }
  {
    const p = new Prog();
    p.g0(10, 0, 2);
    p.g1(10, 0, 0, 's');
    arcG1(p, 0, 0, 10, 0, 4 * 360 * D, 0.005, 0, -8);
    out.push({ key: 'helix', p });
  }
  {
    const p = new Prog();
    p.g0(50, 0, 0);
    let t = 0;
    while (t < 2 * Math.PI - 1e-9) {
      const rho = Math.pow(2500 * Math.sin(t) ** 2 + 400 * Math.cos(t) ** 2, 1.5) / 1000;
      t = Math.min(2 * Math.PI, t + (rho * 2 * Math.acos(1 - 0.01 / rho)) / Math.hypot(50 * Math.sin(t), 20 * Math.cos(t)));
      p.g1(50 * Math.cos(t), 20 * Math.sin(t), 0, 'c');
    }
    out.push({ key: 'ellipse', p });
  }
  {
    const p = new Prog();
    p.g0(-30, -10, 0);
    p.g1(0, -10, 0, 's');
    arcG1(p, 0, 0, 10, -90 * D, 180 * D, 0.01, 0);
    arcG1(p, 0, 20, 10, -90 * D, -180 * D, 0.01, 0);
    p.g1(-30, 30, 0, 's');
    out.push({ key: 'S-curve', p });
  }
  {
    const p = new Prog();
    const R = 40;
    const a0 = Math.acos(-30 / R);
    const a1 = Math.acos(30 / R);
    p.g0(-30, 0, R * Math.sin(a0) - R);
    for (let row = 0; row < 6; row++) {
      const n = Math.ceil(Math.abs(a0 - a1) / (2 * Math.acos(1 - 0.005 / R)));
      for (let k = 1; k <= n; k++) {
        const a = row % 2 ? a1 + ((a0 - a1) * k) / n : a0 + ((a1 - a0) * k) / n;
        p.g1(R * Math.cos(a), row, R * Math.sin(a) - R, 'c');
      }
      p.g1(p.x, row + 1, p.z, 's');
    }
    out.push({ key: 'surface raster', p });
  }
  {
    const p = new Prog();
    p.add('G0 X0 Y0 Z20 A0');
    p.add('G1 Z10 F500', 's');
    p.add('G1 X50 F500', 's');
    p.add('G1 A90', 'c');
    p.add('G1 X0 A180', 'c');
    p.add('G1 X30', 's');
    p.add('G0 Z30');
    out.push({ key: 'rotary wrap', p, rotary: true });
  }
  {
    const p = new Prog();
    p.add('G0 X0 Y0 Z0');
    p.add('G68 X0 Y0 R30');
    p.add('G18');
    p.add('G1 X10 F500', 's');
    p.add('G2 X30 Z0 I10 K0', 'c');
    p.add('G1 X50', 's');
    p.add('G17 G69');
    out.push({ key: 'G68 + G18 arc', p });
  }
  return out;
}

function straightPrograms(): { key: string; p: Prog }[] {
  const out: { key: string; p: Prog }[] = [];
  for (const [w, h, c] of [[100, 60, 5], [100, 60, 0.5], [20, 10, 1]] as const) {
    const p = new Prog();
    const pts = [[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c], [c, 0]];
    p.g0(c, 0, -1);
    for (const q of pts.slice(1)) p.g1(q[0]!, q[1]!, -1, 's');
    out.push({ key: `chamfer ${w}x${h} c${c}`, p });
  }
  for (const N of [6, 8, 12, 16]) {
    const p = new Prog();
    p.g0(30, 0, -1);
    for (let k = 1; k <= N; k++) p.g1(30 * Math.cos((2 * Math.PI * k) / N), 30 * Math.sin((2 * Math.PI * k) / N), -1, 's');
    out.push({ key: `${N}-gon`, p });
  }
  for (const step of [2, 0.1]) {
    const p = new Prog();
    p.g0(0, 0, -2);
    for (let k = 0; k < 10; k++) {
      p.g1(k % 2 ? 0 : 100, k * step, -2, 's');
      p.g1(p.x, (k + 1) * step, -2, 's');
    }
    out.push({ key: `zigzag ${step}`, p });
  }
  for (const L of [0.05, 0.2, 1, 5])
    for (const deg of [17.3, 0.7]) {
      const p = new Prog();
      p.g0(1.2345, 2.3456, -1);
      for (let k = 1; k <= 120; k++) p.g1(1.2345 + Math.cos(deg * D) * L * k, 2.3456 + Math.sin(deg * D) * L * k, -1, 's');
      out.push({ key: `split line ${L} at ${deg}°`, p });
      const q = new Prog();
      q.g0(0, 0, 0);
      for (let k = 1; k <= 120; k++) q.g1(Math.cos(deg * D) * L * k * 0.8, Math.sin(deg * D) * L * k * 0.8, -L * k * 0.6, 's');
      out.push({ key: `split 3D line ${L} at ${deg}°`, p: q });
    }
  {
    const p = new Prog();
    p.g0(0, 0, -1);
    p.g1(50, 0, -1, 's');
    p.g1(50 + 5 * Math.cos(10 * D), 5 * Math.sin(10 * D), -1, 's');
    p.g1(p.x + 50 * Math.cos(20 * D), p.y + 50 * Math.sin(20 * D), -1, 's');
    out.push({ key: 'gentle bend', p });
  }
  for (const [k, n, len] of [['30°', 3, 2], ['22.5°', 4, 1.5], ['30° short', 3, 0.3], ['45°', 2, 3]] as const) {
    const q = new Prog();
    q.g0(0, 0, -1);
    q.g1(40, 0, -1, 's');
    let a = 0;
    for (let i = 0; i < n - 1; i++) {
      a += (90 / n) * D;
      q.g1(q.x + len * Math.cos(a), q.y + len * Math.sin(a), -1, 's');
    }
    q.g1(q.x, q.y + 40, -1, 's');
    out.push({ key: `corner ${k}`, p: q });
  }
  {
    const p = new Prog();
    p.g0(0, 0, -1);
    for (let k = 0; k < 10; k++) {
      p.g1(p.x + 5, p.y, -1, 's');
      p.g1(p.x, p.y + 3, -1, 's');
    }
    out.push({ key: 'stairs', p });
  }
  {
    const p = new Prog();
    p.add('G0 X0 Y0 Z5');
    p.add('G81 X10 Y10 Z-5 R2 F100');
    for (let k = 0; k < 6; k++) p.add(`X${10 + 7 * k} Y${10 + 3 * (k % 2)}`);
    p.add('G80');
    out.push({ key: 'drill', p });
  }
  {
    const p = new Prog();
    p.g0(0, 0, -1);
    p.g1(20, 0, -1, 's');
    p.add('G3 X30 Y10 I0 J10');
    p.g1(30, 40, -1, 's');
    out.push({ key: 'G3 arc between lines', p });
  }
  return out;
}

describe('G1으로 풀어 쓴 곡선 토막(g1CurvePieces)', () => {
  it('곡선을 나눈 G1·회전축 감기·평면이 다른 원호 조각은 곡선 조각, 앞뒤 접선 직선은 아니다', () => {
    let curve = 0;
    let found = 0;
    for (const { key, p, rotary } of curvePrograms()) {
      const o = tally(p, G1_CURVE_RULES, rotary);
      expect(o.wrong, key).toBe(0);
      expect(o.curve, key).toBeGreaterThan(0);
      // 원 하나·나선·타원 같은 이은 곡선은 거의 다(놓치는 것은 한 바퀴를 닫는 마디 둘레 몇 개까지)
      expect(o.missed, key).toBeLessThanOrEqual(2);
      curve += o.curve;
      found += o.found;
    }
    expect(found / curve).toBeGreaterThan(0.99);
  });

  it('진짜 직선(모따기·다각형·지그재그·나눈 직선·완만한 꺾임·모서리를 도는 짧은 직선·계단·드릴)은 곡선 조각이 없다', () => {
    let straight = 0;
    for (const { key, p } of straightPrograms()) {
      const o = tally(p);
      expect(o.wrong, key).toBe(0);
      straight += o.straight;
    }
    expect(straight).toBeGreaterThan(2000);
  });

  it('한도를 조금씩 바꿔도 진짜 직선은 곡선 조각이 되지 않고 곡선은 대부분 남는다(판정이 흔들리지 않는다)', () => {
    const variants: Partial<G1CurveRules>[] = [{ turnMax: 15 * D }, { turnMin: 0.05 * D }, { turnRatio: 1.5 }, { turnRatio: 2.2 }, { lenRatio: 1.5 }, { lenRatio: 3 }, { sideCos: Math.cos(30 * D) }, { sideCos: 0.5 }, { endRatio: 1.25 }, { sag: 0.002 }, { sag: 0.01 }];
    for (const v of variants) {
      const rules = { ...G1_CURVE_RULES, ...v };
      let curve = 0;
      let found = 0;
      for (const { key, p } of straightPrograms()) expect(tally(p, rules).wrong, `${key} ${JSON.stringify(v)}`).toBe(0);
      for (const { p, rotary } of curvePrograms()) {
        const o = tally(p, rules, rotary);
        curve += o.curve;
        found += o.found;
      }
      expect(found / curve, JSON.stringify(v)).toBeGreaterThan(0.98);
    }
  });

  it('토막 셋이 같은 쪽으로 두 번만 꺾인 꺾은선은 곡선 조각으로 보지 않는다(현 셋으로 나눈 원호와 가를 수 없다 — 넷부터)', () => {
    const three = new Prog();
    three.g0(0, 0, 0);
    for (let k = 1; k <= 3; k++) three.g1(three.x + 5 * Math.cos(10 * k * D), three.y + 5 * Math.sin(10 * k * D), 0, 's');
    expect(tally(three).wrong).toBe(0);
    const four = new Prog();
    four.g0(0, 0, 0);
    for (let k = 1; k <= 4; k++) four.g1(four.x + 5 * Math.cos(10 * k * D), four.y + 5 * Math.sin(10 * k * D), 0, 'c');
    expect(tally(four)).toMatchObject({ curve: 4, found: 4 });
  });

  it('이동 표마다 한 번 셈해 같은 배열을 돌려준다(한도를 바꿔 주면 새로 셈)', () => {
    const p = new Prog();
    p.g0(10, 0, 0);
    arcG1(p, 0, 0, 10, 0, 2 * Math.PI, 0.01, 0);
    const nc = parseForView('c.nc', enc(p.text())).nc!;
    const a = g1CurvePieces(nc);
    expect(g1CurvePieces(nc)).toBe(a);
    expect(g1CurvePieces(nc, { ...G1_CURVE_RULES })).not.toBe(a);
    expect([...g1CurvePieces(nc, { ...G1_CURVE_RULES })]).toEqual([...a]);
    expect(a.length).toBe(nc.moves.count);
  });

  it('공구가 바뀌거나 급속·이송이 갈리는 자리에서는 잇지 않는다(같은 묶음의 현 여섯은 곡선, 셋씩 갈리면 아니다)', () => {
    const six = (split: 'none' | 'tool' | 'rapid'): number => {
      const p = new Prog();
      p.add('T1 M6');
      p.g0(10, 0, 0);
      for (let k = 1; k <= 6; k++) {
        if (k === 4 && split === 'tool') p.add('T2 M6');
        const a = k * 8 * D;
        const x = f3(10 * Math.cos(a));
        const y = f3(10 * Math.sin(a));
        p.add(k >= 4 && split === 'rapid' ? `G0 X${x} Y${y}` : `G1 X${x} Y${y} F800`);
      }
      const nc = parseForView('t.nc', enc(p.text())).nc!;
      return g1CurvePieces(nc).reduce((s, x) => s + x, 0);
    };
    expect(six('none')).toBe(6);
    expect(six('tool')).toBe(0);
    expect(six('rapid')).toBe(0);
  });
});
