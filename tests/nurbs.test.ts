/**
 * LinuxCNC G5.2 … G5.3 NURBS: 조정점(X·Y)·가중치 P·계수 L을 모아 G5.3에서 열린 균일 매듭의 NURBS 곡선으로 그린다.
 * 곡선 위의 점(따로 짠 Cox–de Boor 기저 함수와 견줌)·현의 처짐 0.005 mm 안·원호 근사(가중 2차)·3차(L4)·
 * G91(첫 조정점에서 잼)·이송 F·줄 연결·모달(G5.3 뒤)·규칙에 어긋난 블록(차수·가중치·평면·조정점 수)을 본다.
 */
import { describe, expect, it } from 'vitest';
import { nurbsKnots, parseGcode } from '../src/gcode';
import { MOVE_FEED, MOVE_RAPID, moveEnd, type NcProgram } from '../src/model';

const pts = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i));
  return out;
};
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
const run = (body: string, start = 'G0 X0 Y0 Z0'): NcProgram =>
  parseGcode(`G21 G17 G90 G54\n${start}\n${body}M2\n`, { dialect: 'linuxcnc', initialPosition: [0, 0, 0] });
/** 급속 시작 이동을 뺀 이동 끝점 */
const curve = (p: NcProgram): number[][] => pts(p).filter((_, i) => p.moves.kind[i] !== MOVE_RAPID);

/** 따로 짠 기준: LinuxCNC 매듭(앞뒤 L개 겹침, 사이 1씩)과 Cox–de Boor 기저 함수로 곡선 위의 점 */
const knotsRef = (count: number, k: number): number[] => {
  const t: number[] = [];
  for (let i = 0; i < k; i++) t.push(0);
  for (let i = 1; i <= count - k; i++) t.push(i);
  for (let i = 0; i < k; i++) t.push(count - k + 1);
  return t;
};
const basis = (i: number, k: number, u: number, t: number[]): number => {
  if (k === 1) {
    const end = t[t.length - 1]!;
    return (t[i]! <= u && u < t[i + 1]!) || (u === end && t[i]! < end && t[i + 1] === end) ? 1 : 0;
  }
  let a = 0;
  let b = 0;
  if (t[i + k - 1]! > t[i]!) a = ((u - t[i]!) / (t[i + k - 1]! - t[i]!)) * basis(i, k - 1, u, t);
  if (t[i + k]! > t[i + 1]!) b = ((t[i + k]! - u) / (t[i + k]! - t[i + 1]!)) * basis(i + 1, k - 1, u, t);
  return a + b;
};
const refCurve = (cp: number[][], w: number[], k: number, samples = 4000): number[][] => {
  const t = knotsRef(cp.length, k);
  const umax = t[t.length - 1]!;
  const out: number[][] = [];
  for (let s = 0; s <= samples; s++) {
    const u = (umax * s) / samples;
    let x = 0;
    let y = 0;
    let d = 0;
    for (let i = 0; i < cp.length; i++) {
      const nb = basis(i, k, u, t) * w[i]!;
      x += nb * cp[i]![0]!;
      y += nb * cp[i]![1]!;
      d += nb;
    }
    out.push([x / d, y / d]);
  }
  return out;
};
/** 점과 꺾은선 사이 거리 */
const distToPolyline = (q: number[], line: number[][]): number => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const vx = b[0]! - a[0]!;
    const vy = b[1]! - a[1]!;
    const l2 = vx * vx + vy * vy;
    const tt = l2 > 0 ? Math.min(1, Math.max(0, ((q[0]! - a[0]!) * vx + (q[1]! - a[1]!) * vy) / l2)) : 0;
    best = Math.min(best, Math.hypot(a[0]! + vx * tt - q[0]!, a[1]! + vy * tt - q[1]!));
  }
  return best;
};
/** 그린 꺾은선(시작점 포함)이 기준 곡선 위에 있고(꼭짓점), 곡선이 꺾은선에서 tol 안(처짐) */
const expectOnCurve = (drawn: number[][], ref: number[][], tol = 0.0051): void => {
  for (const q of drawn) expect(distToPolyline(q, ref)).toBeLessThan(1e-4);
  let worst = 0;
  for (const q of ref) worst = Math.max(worst, distToPolyline(q, drawn));
  expect(worst).toBeLessThan(tol);
};

describe('LinuxCNC G5.2/G5.3 NURBS', () => {
  it('매듭은 LinuxCNC처럼 열린 균일(앞뒤 L개 겹침, 사이 1씩)', () => {
    expect(nurbsKnots(4, 3)).toEqual([0, 0, 0, 1, 2, 3, 3, 3]);
    expect(nurbsKnots(3, 4)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(nurbsKnots(1, 2)).toEqual([0, 0, 1, 1]);
    expect(nurbsKnots(5, 3)).toEqual(knotsRef(6, 3));
  });

  it('기본 계수 L3(2차): 첫 조정점은 G5.2 앞 자리, 곡선 위의 점을 이송 직선으로 잇고 끝은 마지막 조정점', () => {
    const p = run('F10\nG5.2 P1 L3\nX0 Y1 P1\nX2 Y2 P1\nX2 Y0 P1\nX0 Y0 P2\nG5.3\n');
    expect(p.warnings).toEqual([]);
    const all = curve(p);
    expect(Array.from(p.moves.kind.subarray(0, p.moves.count)).every((k) => k === MOVE_FEED)).toBe(true);
    expect(all.length).toBeGreaterThan(20);
    expect(all.length).toBeLessThan(400);
    expect(all.at(-1)!.map(r6)).toEqual([0, 0, 0]);
    const ref = refCurve(
      [
        [0, 0],
        [0, 1],
        [2, 2],
        [2, 0],
        [0, 0],
      ],
      [1, 1, 1, 1, 2],
      3,
    );
    expectOnCurve([[0, 0], ...all], ref);
    // 높이는 그대로, 이송은 F10
    expect(all.every((q) => q[2] === 0)).toBe(true);
    expect(p.moves.feed[0]).toBe(10);
  });

  it('직선과 같은 2점: L2(1차) 조정점 하나면 끝점까지 직선 하나', () => {
    const p = run('G5.2 L2 X10 Y0 F300\nG5.3\n');
    expect(p.warnings).toEqual([]);
    expect(pts(p).map((q) => q.map(r6))).toEqual([[10, 0, 0]]);
    expect(p.moves.kind[0]).toBe(MOVE_FEED);
    // 한 줄에 놓인 세 조정점(L3)도 직선 위
    const q = run('G5.2 X5 Y5 F300\nX10 Y10\nG5.3\n');
    expect(q.warnings).toEqual([]);
    for (const v of curve(q)) expect(Math.abs(v[0]! - v[1]!)).toBeLessThan(1e-9);
    expect(curve(q).at(-1)!.map(r6)).toEqual([10, 10, 0]);
  });

  it('원호 근사: 가중치 1·√2/2·1인 2차 NURBS는 반지름 10의 1/4 원 — 꼭짓점은 원 위, 현의 처짐 0.005 mm 안', () => {
    const p = run(`G5.2 P1 L3 F500\nX10 Y10 P${Math.SQRT1_2}\nX0 Y10 P1\nG5.3\n`, 'G0 X10 Y0 Z-1');
    expect(p.warnings).toEqual([]);
    const all = curve(p);
    for (const q of all) expect(Math.abs(Math.hypot(q[0]!, q[1]!) - 10)).toBeLessThan(1e-9);
    let prev = [10, 0];
    let sag = 0;
    for (const q of all) {
      sag = Math.max(sag, 10 - Math.hypot((prev[0]! + q[0]!) / 2, (prev[1]! + q[1]!) / 2));
      prev = q;
    }
    expect(sag).toBeLessThan(0.005);
    expect(sag).toBeGreaterThan(0.0005);
    expect(all.at(-1)!.map(r6)).toEqual([0, 10, -1]);
    // 길이·시간은 곡선 조각 그대로(1/4 원 = 15.708)
    expect(p.stats.feedLength).toBeCloseTo((Math.PI * 10) / 2, 2);
    expect(p.stats.feedTime).toBeCloseTo((p.stats.feedLength / 500) * 60, 6);
  });

  it('차수 3(L4): 조정점 넷은 3차 베지어, 여섯이면 3차 B-스플라인 — 끝점을 지나고 첫 조각은 둘째 조정점 쪽', () => {
    const bez = run('G5.2 L4 X0 Y10 F300\nX10 Y10\nX10 Y0\nG5.3\n');
    expect(bez.warnings).toEqual([]);
    const cubic = (t: number): number[] => {
      const u = 1 - t;
      return [3 * u * t * t * 10 + t * t * t * 10, 3 * u * u * t * 10 + 3 * u * t * t * 10];
    };
    const bAll = curve(bez);
    const dense = Array.from({ length: 4001 }, (_, s) => cubic(s / 4000));
    expectOnCurve([[0, 0], ...bAll], dense);
    expect(Math.max(...bAll.map((q) => q[1]!))).toBeCloseTo(7.5, 2);
    const cp = [
      [0, 0],
      [0, 10],
      [10, 10],
      [20, -10],
      [30, 10],
      [30, 0],
    ];
    const six = run(`G5.2 L4 F300\n${cp
      .slice(1)
      .map((c) => `X${c[0]} Y${c[1]}`)
      .join('\n')}\nG5.3\n`);
    expect(six.warnings).toEqual([]);
    const sAll = curve(six);
    expectOnCurve([[0, 0], ...sAll], refCurve(cp, [1, 1, 1, 1, 1, 1], 4));
    expect(sAll.at(-1)!.map(r6)).toEqual([30, 0, 0]);
    expect(Math.abs(sAll[0]![0]!)).toBeLessThan(Math.abs(sAll[0]![1]!));
  });

  it('G91: 조정점은 모두 곡선 시작점(G5.2 앞 자리)에서 잰다 — LinuxCNC는 G5.3까지 지금 자리를 바꾸지 않음', () => {
    const inc = run('G91 G5.2 L2 X10 Y0 F100\nX10 Y10\nG5.3\nG90\n', 'G0 X5 Y5 Z0');
    const abs = run('G5.2 L2 X15 Y5 F100\nX15 Y15\nG5.3\n', 'G0 X5 Y5 Z0');
    expect(inc.warnings).toEqual([]);
    expect(curve(inc).map((q) => q.map(r6))).toEqual([
      [15, 5, 0],
      [15, 15, 0],
    ]);
    expect(curve(inc)).toEqual(curve(abs));
  });

  it('이송 F는 G5.3에서 그릴 때의 값(조정점 블록의 F도 모달로 바뀜)', () => {
    const p = run('F100\nG5.2 X10 Y10\nX20 Y0 F200\nG5.3\n');
    expect(p.warnings).toEqual([]);
    for (let i = 0; i < p.moves.count; i++) expect(p.moves.feed[i]).toBe(200);
  });

  it('곡선 조각은 가장 가까운 조정점 블록의 줄 — 차례대로 늘고, 끝 조각은 마지막 조정점 줄', () => {
    // 줄: 0 G21…, 1 G0, 2 G5.2, 3~6 조정점, 7 G5.3
    const p = run('G5.2 P1 L3 F100\nX0 Y10\nX10 Y10\nX10 Y0\nX20 Y0\nG5.3\n');
    const lines = Array.from(p.moves.line.subarray(0, p.moves.count));
    expect(lines[0]).toBe(2);
    expect(lines.at(-1)).toBe(6);
    for (let i = 1; i < lines.length; i++) expect(lines[i]!).toBeGreaterThanOrEqual(lines[i - 1]!);
    expect(new Set(lines)).toEqual(new Set([2, 3, 4, 5, 6]));
  });

  it('조정점의 Z는 쓰지 않고(높이 그대로) 알리며, G5.3 뒤 이동 꼴 없는 좌표는 이송 직선으로 그리고 알린다', () => {
    const p = run('G5.2 X5 Y5 Z-3 F100\nX10 Y0\nG5.3\nX20 Y0\n', 'G0 X0 Y0 Z2');
    expect(p.warnings.some((w) => w.includes('G5.2 조정점의 Z는 쓰지 않음'))).toBe(true);
    expect(curve(p).every((q) => q[2] === 2)).toBe(true);
    expect(p.warnings.some((w) => w.includes('G5.3 뒤에 이동 꼴(G0·G1 등) 없이 좌표가 옴'))).toBe(true);
    expect(curve(p).at(-1)!.map(r6)).toEqual([20, 0, 2]);
  });

  it('규칙에 어긋나면(계수·가중치·평면·조정점 수·X만) 알리고 조정점을 직선으로 잇는다', () => {
    const poly = (p: NcProgram): number[][] => curve(p).map((q) => q.map(r6));
    const l1 = run('G5.2 L1 X5 Y5 F100\nX10 Y0\nG5.3\n');
    expect(l1.warnings.some((w) => w.includes('G5.2 NURBS: 계수 L1이 2 이상의 정수가 아님 — 조정점을 직선으로 이음'))).toBe(true);
    expect(poly(l1)).toEqual([
      [5, 5, 0],
      [10, 0, 0],
    ]);
    expect(run('G5.2 L2.5 X5 Y5 F100\nX10 Y0\nG5.3\n').warnings.some((w) => w.includes('계수 L2.5이 2 이상의 정수가 아님'))).toBe(true);
    const few = run('G5.2 L5 X5 Y5 F100\nX10 Y0\nG5.3\n');
    expect(few.warnings.some((w) => w.includes('조정점 3개가 계수 L5보다 적음'))).toBe(true);
    // 기본 L3에 조정점 둘(지금 자리 + 하나)도 모자람 — 끝점까지 직선
    const two = run('G5.2 X10 Y0 F100\nG5.3\n');
    expect(two.warnings.some((w) => w.includes('조정점 2개가 계수 L3보다 적음'))).toBe(true);
    expect(poly(two)).toEqual([[10, 0, 0]]);
    const w0 = run('G5.2 X5 Y5 F100\nX10 Y0 P0\nG5.3\n');
    expect(w0.warnings.some((w) => w.includes('가중치 P0가 0보다 크지 않음'))).toBe(true);
    expect(poly(w0)).toEqual([
      [5, 5, 0],
      [10, 0, 0],
    ]);
    expect(run('G5.2 P-1 F100\nX5 Y5\nX10 Y0\nG5.3\n').warnings.some((w) => w.includes('가중치 P-1가 0보다 크지 않음'))).toBe(true);
    const g18 = run('G18\nG5.2 X5 Y5 F100\nX10 Y0\nG5.3\n');
    expect(g18.warnings.some((w) => w.includes('G5.2 NURBS: NURBS는 G17(XY) 평면에서만 읽음'))).toBe(true);
    expect(poly(g18)).toEqual([
      [5, 5, 0],
      [10, 0, 0],
    ]);
    const xOnly = run('G5.2 X5 Y5 F100\nX10\nG5.3\n');
    expect(xOnly.warnings.some((w) => w.includes('X·Y 가운데 하나만 있는 조정점'))).toBe(true);
    expect(poly(xOnly)).toEqual([
      [5, 5, 0],
      [10, 5, 0],
    ]);
  });

  it('G5.3 없이 다른 이동 꼴이 오거나 프로그램이 끝나면 알리고 직선으로, G5.2 없는 G5.3은 알림만', () => {
    const cut = run('G5.2 X5 Y5 F100\nX10 Y0\nG1 X20 Y0\n');
    expect(cut.warnings.some((w) => w.includes('G5.2 NURBS: G5.3 없이 다른 이동 꼴이 옴'))).toBe(true);
    expect(curve(cut).map((q) => q.map(r6))).toEqual([
      [5, 5, 0],
      [10, 0, 0],
      [20, 0, 0],
    ]);
    const end = run('G5.2 X5 Y5 F100\nX10 Y0\n');
    expect(end.warnings.some((w) => w.includes('G5.3 없이 프로그램이 끝남'))).toBe(true);
    expect(curve(end).length).toBe(2);
    const lone = run('G1 X5 Y5 F100\nG5.3\n');
    expect(lone.warnings.some((w) => w.includes('G5.3 앞에 G5.2가 없음'))).toBe(true);
    expect(curve(lone).length).toBe(1);
  });

  it('곡선 정의를 스플라인 표에 남긴다(측정용 — 이동은 그대로): 열린 균일 매듭·가중치·조정점, 조각 끝 매개변수의 곡선 점 = 이동 끝점', () => {
    const p = run('F10\nG5.2 P1 L3\nX0 Y1 P1\nX2 Y2 P1\nX2 Y0 P1\nX0 Y0 P2\nG5.3\nG1 X5\n');
    expect(p.warnings).toEqual([]);
    const t = p.splines!;
    expect(t.count).toBe(1);
    expect(t.degree[0]).toBe(2);
    expect([...t.knots]).toEqual(nurbsKnots(4, 3));
    expect([...t.weight]).toEqual([1, 1, 1, 1, 2]);
    expect([...t.ctrl]).toEqual([0, 0, 0, 0, 1, 0, 2, 2, 0, 2, 0, 0, 0, 0, 0]);
    const n = t.moves[0]!;
    expect(t.move[0]).toBe(0);
    expect(n).toBe(p.moves.count - 1);
    const par = [...t.param];
    expect(par[0]).toBe(0);
    expect(par[n]).toBe(3);
    // 조각 끝 매개변수에서 따로 짠 Cox–de Boor 곡선 점 = 이동 끝점
    const cp = [
      [0, 0],
      [0, 1],
      [2, 2],
      [2, 0],
      [0, 0],
    ];
    const w = [1, 1, 1, 1, 2];
    const kt = knotsRef(5, 3);
    const all = pts(p);
    for (let k = 1; k <= n; k++) {
      let x = 0;
      let y = 0;
      let d = 0;
      for (let i = 0; i < 5; i++) {
        const nb = basis(i, 3, par[k]!, kt) * w[i]!;
        x += nb * cp[i]![0]!;
        y += nb * cp[i]![1]!;
        d += nb;
      }
      expect(Math.hypot(all[k - 1]![0]! - x / d, all[k - 1]![1]! - y / d)).toBeLessThan(1e-12);
      expect(par[k]!).toBeGreaterThan(par[k - 1]!);
    }
    // 규칙에 어긋나 직선으로 이은 NURBS는 표에 넣지 않는다
    expect(run('G5.2 X5 Y5 F100\nX10 Y0\nG1 X20 Y0\n').splines).toBeUndefined();
  });

  it('작업 좌표계 원점·inch 단위도 다른 이동과 같게', () => {
    const p = parseGcode('G20 G17 G90\nG54 G0 X0 Y0 Z0\nG10 L2 P2 X1 Y2 Z0\nG55 G0 X0 Y0\nG5.2 L2 X1 Y0 F10\nG5.3\nM2\n', { dialect: 'linuxcnc', initialPosition: [0, 0, 0] });
    expect(p.warnings).toEqual([]);
    expect(p.units).toBe('inch');
    expect(pts(p).at(-1)!.map(r6)).toEqual([2, 2, 0]);
  });
});
