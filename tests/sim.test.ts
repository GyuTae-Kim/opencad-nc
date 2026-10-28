/**
 * 깎기 시뮬레이션(높이 지도) — 합성 프로그램으로 해석적으로 아는 결과와 견준다.
 */
import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import type { NcProgram } from '../src/model';
import { SIM_MOVE_REGION, SimEngine, normalizePosition, type SimMoves } from '../src/sim/engine';
import { HeightGrid, MARK_OUTSIDE, gridFor, heightAt, type GridSpec } from '../src/sim/grid';
import { buildBottom, buildTile, buildWalls, fanIndices, gridIndices, gridOrigin, takeDirtyTiles } from '../src/sim/mesh';
import { prepareTool, profileAt, resolveTool, type SimTool } from '../src/sim/tool';
import { SimRunner } from '../src/sim/runner';
import type { SimUpdate } from '../src/sim/protocol';

const G = (body: string): NcProgram => parseGcode(`G21 G17 G90 G54\n${body}`, { initialPosition: [0, 0, 50] });

function simMoves(p: NcProgram): SimMoves {
  const m = p.moves;
  return { count: m.count, kind: m.kind, points: m.points, tool: m.tool, flags: m.flags, arc: m.arc, arcCenter: p.arcs.center, arcPlane: p.arcs.plane, arcSweep: p.arcs.sweep };
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({ min: [x0, y0, z0], max: [x1, y1, z1] });

/** 프로그램 전체를 내린 높이 지도 */
function run(p: NcProgram, spec: GridSpec, tools: Record<number, SimTool>, opts = {}): { grid: HeightGrid; engine: SimEngine } {
  const grid = new HeightGrid(spec);
  const prepared = new Map(Object.entries(tools).map(([k, t]) => [Number(k), prepareTool(t)]));
  const engine = new SimEngine(simMoves(p), grid, (n) => prepared.get(n) ?? prepareTool({ kind: 'flat', diameter: 1, corner: 0, angle: 118 }), opts);
  engine.advance({ move: p.moves.count, frac: 0 });
  return { grid, engine };
}

const flat = (d: number): SimTool => ({ kind: 'flat', diameter: d, corner: 0, angle: 118 });
const ball = (d: number): SimTool => ({ kind: 'ball', diameter: d, corner: d / 2, angle: 118 });
const bull = (d: number, rc: number): SimTool => ({ kind: 'bull', diameter: d, corner: rc, angle: 118 });
const drill = (d: number, angle = 118): SimTool => ({ kind: 'drill', diameter: d, corner: 0, angle });

/** 마디 좌표 */
const X = (s: GridSpec, i: number) => s.x0 + i * s.dx;
const Y = (s: GridSpec, j: number) => s.y0 + j * s.dy;

describe('격자', () => {
  it('긴 변 칸 수로 정사각형에 가까운 칸, 마디 수 한도', () => {
    const s = gridFor(box(-30, -10, -10, 30, 10, 0), 600);
    expect(s.nx).toBe(601);
    expect(s.ny).toBe(201);
    expect(s.dx).toBeCloseTo(0.1, 12);
    expect(s.dy).toBeCloseTo(0.1, 12);
    expect([s.top, s.bottom]).toEqual([0, -10]);
    const big = gridFor(box(0, 0, -1, 1000, 1000, 0), 2048, 1_000_000);
    expect(big.nx * big.ny).toBeLessThanOrEqual(1_000_000);
  });
});

describe('평 엔드밀 직선 홈', () => {
  const p = G('T1 M6 (T1 D=6. FLAT END MILL)\nG0 X-20 Y0 Z5\nG1 Z-2 F100\nG1 X20 F500\nG0 Z5');
  const spec = gridFor(box(-30, -10, -10, 30, 10, 0), 600);
  const { grid, engine } = run(p, spec, { 1: flat(6) });

  it('폭 = 지름, 깊이 = 2, 바닥이 평평하다', () => {
    const i = Math.round((0 - spec.x0) / spec.dx);
    const cut: number[] = [];
    for (let j = 0; j < spec.ny; j++) {
      const z = heightAt(grid, i, j);
      if (z < 0) {
        expect(z).toBe(-2);
        cut.push(Y(spec, j));
      } else expect(z).toBe(0);
    }
    const width = cut[cut.length - 1]! - cut[0]!;
    expect(width).toBeGreaterThan(6 - 2 * spec.dy - 1e-9);
    expect(width).toBeLessThanOrEqual(6 + 1e-9);
    expect(cut[0]!).toBeCloseTo(-3, 1);
  });

  it('홈 끝은 반원(가운데 줄에서 X ±23까지)', () => {
    const j = Math.round((0 - spec.y0) / spec.dy);
    const xs: number[] = [];
    for (let i = 0; i < spec.nx; i++) if (heightAt(grid, i, j) < 0) xs.push(X(spec, i));
    expect(xs[0]!).toBeCloseTo(-23, 1);
    expect(xs[xs.length - 1]!).toBeCloseTo(23, 1);
    // 끝 반원 위의 점: 중심 (20, 0)에서 2.9 떨어진 곳은 깎이고 3.1은 그대로
    const at = (x: number, y: number) => heightAt(grid, Math.round((x - spec.x0) / spec.dx), Math.round((y - spec.y0) / spec.dy));
    expect(at(20 + 2.9 * Math.cos(1), 2.9 * Math.sin(1))).toBe(-2);
    expect(at(20 + 3.2 * Math.cos(1), 3.2 * Math.sin(1))).toBe(0);
  });

  it('급속은 소재 위로만 — 사건 없음', () => {
    expect(engine.events).toEqual([]);
    expect(grid.mark.includes(1)).toBe(false);
  });
});

describe('볼 엔드밀 홈 단면은 원호', () => {
  it('수평 홈: z(y) = 끝 + R − √(R² − y²)', () => {
    const p = G('T2 M6 (T2 D=6. BALL END MILL)\nG0 X-20 Y0 Z5\nG1 Z-3 F100\nG1 X20 F500\nG0 Z5');
    const spec = gridFor(box(-30, -10, -10, 30, 10, 0), 600);
    const { grid } = run(p, spec, { 2: ball(6) });
    const i = Math.round((5 - spec.x0) / spec.dx);
    let n = 0;
    for (let j = 0; j < spec.ny; j++) {
      const y = Y(spec, j);
      const z = heightAt(grid, i, j);
      if (Math.abs(y) < 3) {
        // 깎인 단면이 반지름 3, 중심 z = 0인 원 위에
        expect(z).toBeCloseTo(-Math.sqrt(9 - y * y), 5);
        expect(Math.hypot(y, z - 0)).toBeCloseTo(3, 5);
        n++;
      } else expect(z).toBe(0);
    }
    expect(n).toBeGreaterThan(50);
  });

  it('기울어진 이동(경사 진입)은 닫힌 꼴 해가 촘촘한 표본과 같다 — 볼·평·불 노즈·드릴', () => {
    const spec = gridFor(box(-15, -6, -10, 15, 6, 0), 300);
    const seg = [-10, -1.5, -1, 10, 2, -4] as const;
    for (const tool of [ball(6), flat(6), bull(6, 1), drill(6, 90)]) {
      const g = new HeightGrid(spec);
      const t = prepareTool(tool);
      g.stampSegment(...seg, t);
      // 표본: 선분 위 2만 점의 공구 아랫면 최솟값(정확한 값보다 아주 조금 높을 수 있다)
      const N = 20000;
      let worst = 0;
      for (let j = 0; j < spec.ny; j += 7)
        for (let i = 0; i < spec.nx; i += 7) {
          const x = X(spec, i);
          const y = Y(spec, j);
          let best = Infinity;
          for (let k = 0; k <= N; k++) {
            const u = k / N;
            const px = seg[0] + (seg[3] - seg[0]) * u;
            const py = seg[1] + (seg[4] - seg[1]) * u;
            const pz = seg[2] + (seg[5] - seg[2]) * u;
            const d = Math.hypot(x - px, y - py);
            if (d <= t.r) best = Math.min(best, pz + profileAt(t, d));
          }
          const want = Math.max(spec.bottom, Math.min(0, best));
          const got = heightAt(g, i, j);
          worst = Math.max(worst, Math.abs(got - want));
        }
      expect(worst, tool.kind).toBeLessThan(2e-3);
    }
  });
});

describe('원형 포켓', () => {
  it('평 엔드밀 Ø6로 가운데 내린 뒤 원 5·8·11 — 반지름 14 안은 모두 −2', () => {
    const p = G(
      'T3 M6 (T3 D=6. FLAT END MILL)\nG0 X0 Y0 Z5\nG1 Z-2 F100\nG1 X5\nG3 X5 Y0 I-5 J0\nG1 X8\nG3 X8 Y0 I-8 J0\nG1 X11\nG3 X11 Y0 I-11 J0\nG0 Z5',
    );
    const spec = gridFor(box(-20, -20, -10, 20, 20, 0), 400);
    const { grid } = run(p, spec, { 3: flat(6) });
    let inside = 0;
    for (let j = 0; j < spec.ny; j++)
      for (let i = 0; i < spec.nx; i++) {
        const r = Math.hypot(X(spec, i), Y(spec, j));
        const z = heightAt(grid, i, j);
        if (r <= 13.95) {
          expect(z, `r=${r}`).toBe(-2);
          inside++;
        } else if (r >= 14.05) expect(z, `r=${r}`).toBe(0);
      }
    expect(inside).toBeGreaterThan(Math.PI * 13.9 * 13.9 * 90);
  });

  it('나선 진입(G3 Z)도 원 둘레를 따라 내려간다', () => {
    const p = G('T3 M6\nG0 X5 Y0 Z1\nG1 Z0 F100\nG3 X5 Y0 I-5 J0 Z-2\nG3 X5 Y0 I-5 J0 Z-2\nG0 Z5');
    const spec = gridFor(box(-10, -10, -5, 10, 10, 0), 200);
    const { grid } = run(p, spec, { 3: flat(2) });
    // 두 번째 바퀴가 평평하게 −2: 원 위(반지름 5)의 모든 점이 −2
    for (let a = 0; a < 360; a += 15) {
      const x = 5 * Math.cos((a * Math.PI) / 180);
      const y = 5 * Math.sin((a * Math.PI) / 180);
      expect(heightAt(grid, Math.round((x - spec.x0) / spec.dx), Math.round((y - spec.y0) / spec.dy))).toBeCloseTo(-2, 2);
    }
    // 가운데는 그대로(공구 Ø2)
    expect(heightAt(grid, Math.round(-spec.x0 / spec.dx), Math.round(-spec.y0 / spec.dy))).toBe(0);
  });
});

describe('드릴 사이클 구멍', () => {
  it('G81 Ø8 드릴(끝 각 118°): 가운데 −15, 반지름 r에서 −15 + r·cot 59°, 지름 밖은 그대로', () => {
    const p = G('T4 M6 (T4 D=8. DRILL)\nG0 X10 Y10 Z5\nG98 G81 X10 Y10 Z-15 R2 F100\nX30\nG80\nG0 Z20');
    const spec = gridFor(box(0, 0, -20, 40, 20, 0), 400);
    const tool = resolveTool(4, { kind: 'drill', diameter: 8, angle: 118 }, undefined, 'mm').tool;
    const { grid, engine } = run(p, spec, { 4: tool });
    const cot = 1 / Math.tan((59 * Math.PI) / 180);
    for (const cx of [10, 30]) {
      for (let j = 0; j < spec.ny; j++)
        for (let i = 0; i < spec.nx; i++) {
          const r = Math.hypot(X(spec, i) - cx, Y(spec, j) - 10);
          if (r > 6) continue;
          const z = heightAt(grid, i, j);
          if (r <= 3.98) expect(z).toBeCloseTo(-15 + r * cot, 4);
          else if (r >= 4.02) expect(z).toBe(0);
        }
      expect(heightAt(grid, Math.round((cx - spec.x0) / spec.dx), Math.round((10 - spec.y0) / spec.dy))).toBeCloseTo(-15, 5);
    }
    // 구멍 사이 급속 복귀·이동은 소재를 지나지 않는다(복귀가 소수점 끝만 다르게 같은 자리를 지나도 빨갛게 표시하지 않는다)
    expect(engine.events).toEqual([]);
    expect(grid.mark.includes(1)).toBe(false);
  });
});

describe('높이 지도 경계 밖 이동', () => {
  it('밖에 있는 이동은 아무것도 바꾸지 않고, 걸친 이동은 안쪽만 깎는다', () => {
    const spec = gridFor(box(0, 0, -5, 10, 10, 0), 100);
    const g = new HeightGrid(spec);
    const t = prepareTool(flat(2));
    expect(g.stampSegment(-50, -50, -1, -20, -40, -1, t).changed).toBe(0);
    expect(g.stampSegment(20, 5, -1, 40, 5, -1, t).changed).toBe(0);
    expect(g.stampSegment(NaN, 0, 0, 1, 1, -1, t).changed).toBe(0);
    expect(g.h.every((z) => z === 0)).toBe(true);
    // X −20 → 5: 안쪽 X 0~6 (끝 반원 포함)만
    const r = g.stampSegment(-20, 5, -1, 5, 5, -1, t);
    expect(r.changed).toBeGreaterThan(0);
    for (let i = 0; i < spec.nx; i++) {
      const z = heightAt(g, i, Math.round(5 / spec.dy));
      expect(z).toBe(X(spec, i) <= 6 + 1e-9 ? -1 : 0);
    }
    // 바닥 아래로 내려가도 바닥에서 멈춘다
    g.stampSegment(8, 8, -100, 8, 8, -100, t);
    expect(heightAt(g, 80, 80)).toBe(-5);
  });

  it('프로그램 전체가 소재 밖이면 사건·변화 없음', () => {
    const p = G('T1 M6\nG0 X100 Y100 Z5\nG1 Z-3 F100\nG1 X150\nG0 Z5');
    const spec = gridFor(box(0, 0, -5, 10, 10, 0), 50);
    const { grid, engine } = run(p, spec, { 1: flat(6) });
    expect(grid.h.every((z) => z === 0)).toBe(true);
    expect(engine.events).toEqual([]);
  });
});

describe('급속이 소재를 지나면 사건', () => {
  it('Z−1 높이 급속 수평 이동: 그 이동과 깊이 1, 깎은 마디 표시', () => {
    const p = G('T1 M6 (T1 D=4. FLAT END MILL)\nG0 X-5 Y0 Z5\nG0 Z-1\nG0 X5\nG0 Z5');
    const spec = gridFor(box(-10, -5, -5, 10, 5, 0), 200);
    const { grid, engine } = run(p, spec, { 1: flat(4) });
    expect(engine.events.length).toBe(2);
    const lines = engine.events.map((e) => p.moves.line[e.move]);
    expect(lines).toEqual([3, 4]);
    for (const e of engine.events) expect(e.depth).toBeCloseTo(1, 6);
    expect(grid.mark.includes(1)).toBe(true);
  });
});

describe('재생과 맞물림: 부분 이동·되감기·저장점', () => {
  const p = G(
    'T1 M6 (T1 D=6. FLAT END MILL)\nG0 X-20 Y-5 Z5\nG1 Z-1 F100\n' +
      Array.from({ length: 30 }, (_, k) => `G1 X${k % 2 ? -20 : 20} Y${-5 + k * 0.4}\nG2 X${k % 2 ? -20 : 20} Y${-5 + k * 0.4 + 0.2} R0.1`).join('\n') +
      '\nG0 Z5',
  );
  const spec = gridFor(box(-25, -10, -5, 25, 10, 0), 250);
  const tools = new Map([[1, prepareTool(flat(6))]]);
  const fresh = (pos: { move: number; frac: number }) => {
    const e = new SimEngine(simMoves(p), new HeightGrid(spec), (n) => tools.get(n)!);
    e.advance(pos);
    return e.grid.h;
  };

  it('끝까지 간 뒤 되감은 결과 = 처음부터 거기까지 계산한 결과(저장점 솎기 포함)', () => {
    const e = new SimEngine(simMoves(p), new HeightGrid(spec), (n) => tools.get(n)!, { checkpointWork: 2000, maxCheckpoints: 4 });
    e.advance({ move: p.moves.count, frac: 0 });
    expect(e.checkpointInfo.count).toBeGreaterThan(0);
    expect(e.checkpointInfo.count).toBeLessThanOrEqual(4);
    for (const pos of [{ move: 40, frac: 0.5 }, { move: 7, frac: 0 }, { move: 23, frac: 0.25 }, { move: 0, frac: 0 }]) {
      e.advance(pos);
      expect(e.position).toEqual(normalizePosition(pos, p.moves.count));
      expect(e.grid.h).toEqual(fresh(pos));
    }
    // 40.5 · 7 · 0은 되감기, 23.25는 7에서 앞으로
    expect(e.rewinds).toBe(3);
  });

  it('부분 이동 다음 앞으로 감기 = 한 번에 계산', () => {
    const e = new SimEngine(simMoves(p), new HeightGrid(spec), (n) => tools.get(n)!);
    e.advance({ move: 10, frac: 0.3 });
    e.advance({ move: 10, frac: 0.8 });
    e.advance({ move: 31, frac: 0.5 });
    expect(e.rewinds).toBe(0);
    expect(e.grid.h).toEqual(fresh({ move: 31, frac: 0.5 }));
  });

  it('시간 한도로 나눠 가도 같은 결과', () => {
    const e = new SimEngine(simMoves(p), new HeightGrid(spec), (n) => tools.get(n)!);
    let t = 0;
    let n = 0;
    while (!e.advance({ move: p.moves.count, frac: 0 }, 5, () => (t += 3))) n++;
    expect(n).toBeGreaterThan(3);
    expect(e.grid.h).toEqual(fresh({ move: p.moves.count, frac: 0 }));
  });
});

describe('그물', () => {
  const spec = gridFor(box(0, 0, -5, 200, 100, 0), 200);
  const g = new HeightGrid(spec);
  it('깎지 않은 조각은 가운데 점 + 가장자리 마디 고리(틈 없이), 깎은 조각은 마디마다 꼭짓점', () => {
    expect(g.tilesX).toBe(Math.ceil((spec.nx - 1) / 64));
    const o = gridOrigin(g);
    let tiles = takeDirtyTiles(g, o, 'depth');
    expect(tiles.length).toBe(g.tilesX * g.tilesY);
    expect(tiles.every((t) => t.flat && t.positions.length === (2 * (t.cols - 1) + 2 * (t.rows - 1) + 1) * 3)).toBe(true);
    // 고리의 꼭짓점은 이웃 조각과 같은 가장자리 마디(조각 0의 오른쪽 변 = 조각 1의 왼쪽 변)
    const ring = (t: (typeof tiles)[number]) => {
      const pts: string[] = [];
      for (let v = 1; v < t.positions.length / 3; v++) pts.push(`${t.positions[v * 3]},${t.positions[v * 3 + 1]}`);
      return new Set(pts);
    };
    const a = ring(tiles.find((t) => t.tx === 0 && t.ty === 0)!);
    const b = ring(tiles.find((t) => t.tx === 1 && t.ty === 0)!);
    expect([...a].filter((p) => b.has(p)).length).toBe(65);
    const fan = fanIndices(65, 65);
    expect(fan.length).toBe(256 * 3);
    expect(Math.max(...fan)).toBe(256);
    expect(takeDirtyTiles(g, o, 'depth')).toEqual([]);
    g.stampSegment(10, 10, -1, 20, 10, -1, prepareTool(flat(4)));
    tiles = takeDirtyTiles(g, o, 'depth');
    expect(tiles.length).toBe(1);
    const t = tiles[0]!;
    expect([t.tx, t.ty, t.cols, t.rows]).toEqual([0, 0, 65, 65]);
    expect(t.positions.length).toBe(65 * 65 * 3);
    // 원점 기준 좌표, 깎인 마디는 깊이 색(소재 색과 다름)
    const k = 10 * 65 + 15;
    expect(t.positions[k * 3 + 2]).toBe(-1);
    expect(t.colors[k * 4]).not.toBeCloseTo(t.colors[0]!, 3);
    // 그물 번호·옆면·바닥
    expect(gridIndices(65, 65).length).toBe(64 * 64 * 6);
    expect(Math.max(...gridIndices(3, 2))).toBe(5);
    const w = buildWalls(g, o, 'depth');
    expect(w.positions.length / 3).toBe(2 * (2 * spec.nx + 2 * spec.ny));
    expect(Math.max(...w.indices)).toBeLessThan(w.positions.length / 3);
    expect(buildBottom(g, o).indices.length).toBe(6);
    // 조각 경계 마디(64)를 바꾸면 두 조각 모두 다시 만든다
    g.stampSegment(64, 50, -1, 64, 50, -1, prepareTool(flat(0.5)));
    expect(takeDirtyTiles(g, o, 'stock').map((x) => x.tx).sort()).toEqual([0, 1]);
    expect(buildTile(g, 0, 0, o, 'stock').cols).toBe(65);
  });
});

describe('관통한 곳은 구멍으로(13차)', () => {
  // 200 × 100 × 5 소재(윗면 0, 바닥 −5), 칸 1 — 지름 10 평 엔드밀로 (30,30) → (60,30)을 바닥 아래까지
  const spec = gridFor(box(0, 0, -5, 200, 100, 0), 200);
  const cell = spec.dx * spec.dy;
  /** 바닥 그물 삼각형 넓이 합(위에서 본) */
  const area = (pos: Float32Array, idx: Uint32Array): number => {
    let a = 0;
    for (let k = 0; k < idx.length; k += 3) {
      const [p, q, r] = [idx[k]! * 3, idx[k + 1]! * 3, idx[k + 2]! * 3];
      a += Math.abs((pos[q]! - pos[p]!) * (pos[r + 1]! - pos[p + 1]!) - (pos[r]! - pos[p]!) * (pos[q + 1]! - pos[p + 1]!)) / 2;
    }
    return a;
  };

  it('세 마디가 모두 바닥까지 내려간 윗면 삼각형은 빼고, 바닥은 그 나머지(넓이 합 = 소재 넓이)', () => {
    const g = new HeightGrid(spec);
    const o = gridOrigin(g);
    g.stampSegment(30, 30, -10, 60, 30, -10, prepareTool(flat(10)));
    const bz = Math.fround(spec.bottom);
    expect(heightAt(g, 45, 30)).toBe(bz);
    const tiles = takeDirtyTiles(g, o, 'depth');
    const t = tiles.find((x) => x.tx === 0 && x.ty === 0)!;
    expect(t.indices).toBeDefined();
    expect(t.holes).not.toBe(0);
    // 뺀 삼각형(홈 끝 x 65는 이웃 조각까지)
    const removed = tiles.reduce((n, x) => n + (x.indices ? gridIndices(x.cols, x.rows).length / 3 - x.indices.length / 3 : 0), 0);
    expect(removed).toBeGreaterThan(30 * 9 * 2);
    // 남은 삼각형은 세 마디가 모두 바닥이 아니다(구멍 벽 칸은 남는다)
    const z = (v: number): number => t.positions[v * 3 + 2]! + o[2]!;
    for (let k = 0; k < t.indices!.length; k += 3) expect([t.indices![k]!, t.indices![k + 1]!, t.indices![k + 2]!].every((v) => z(v) <= bz)).toBe(false);
    // 남은 번호 = gridIndices에서 세 마디가 모두 관통한 삼각형만 뺀 것(차례 그대로), 워커가 넘기는 버퍼는 꼭 맞는 크기
    const thr = (v: number): boolean => {
      const k = Math.floor(v / t.cols) * spec.nx + (v % t.cols);
      return g.h[k]! <= bz && g.mark[k] !== MARK_OUTSIDE;
    };
    const full = gridIndices(t.cols, t.rows);
    const keep: number[] = [];
    for (let k = 0; k < full.length; k += 3) if (!(thr(full[k]!) && thr(full[k + 1]!) && thr(full[k + 2]!))) keep.push(full[k]!, full[k + 1]!, full[k + 2]!);
    expect(Array.from(t.indices!)).toEqual(keep);
    expect(t.indices!.buffer.byteLength).toBe(t.indices!.byteLength);
    // 바닥은 뺀 삼각형 자리만 비운다
    const b = buildBottom(g, o);
    expect(b.indices.length).toBeGreaterThan(6);
    expect(area(b.positions, b.indices) + removed * (cell / 2)).toBeCloseTo(200 * 100, 6);
    // 바닥 삼각형은 아래를 본다(위에서 보아 시계 방향)
    const [p, q, r] = [b.indices[0]! * 3, b.indices[1]! * 3, b.indices[2]! * 3];
    expect((b.positions[q]! - b.positions[p]!) * (b.positions[r + 1]! - b.positions[p + 1]!) - (b.positions[r]! - b.positions[p]!) * (b.positions[q + 1]! - b.positions[p + 1]!)).toBeLessThan(0);
    // 바닥에 닿지 않은 조각은 예전과 같다(번호 없음)
    const other = buildTile(g, 2, 1, o, 'depth');
    expect(other.indices).toBeUndefined();
    expect(other.holes).toBe(0);
  });

  it('바닥까지 가지 않은 홈·판 밖(바닥 색으로 그림)은 예전 그물 그대로', () => {
    const g = new HeightGrid(spec);
    const o = gridOrigin(g);
    g.stampSegment(30, 30, -4.99, 60, 30, -4.99, prepareTool(flat(10)));
    const t = takeDirtyTiles(g, o, 'depth').find((x) => x.tx === 0 && x.ty === 0)!;
    expect(t.indices).toBeUndefined();
    expect(t.holes).toBe(0);
    expect(Array.from(buildBottom(g, o).indices)).toEqual([0, 3, 2, 0, 2, 1]);
    // 판 외곽선 밖(왼쪽 아래 모서리를 따낸 판): 바닥까지 내리지만 구멍이 아니다
    const regions = { ringStart: Uint32Array.of(0, 1), pointStart: Uint32Array.of(0, 6), xy: Float64Array.of(0, 40, 0, 100, 200, 100, 200, 0, 50, 0, 50, 40), z: Float64Array.of(spec.bottom), outside: Uint8Array.of(1) };
    g.stampRegion(regions, 0);
    expect(g.mark[10 * spec.nx + 10]).toBe(MARK_OUTSIDE);
    expect(heightAt(g, 10, 10)).toBe(Math.fround(spec.bottom));
    expect(takeDirtyTiles(g, o, 'depth').every((x) => !x.indices && x.holes === 0)).toBe(true);
    expect(buildBottom(g, o).indices.length).toBe(6);
  });

  it('실행기는 관통해 뺀 삼각형이 바뀔 때만 바닥을 다시 보낸다(되감으면 사각형 하나로)', () => {
    const p = G('T1 M6\nG0 X30 Y30 Z5\nG1 Z-1 F100\nG1 X60\nG1 Z-10\nG1 X30\nG0 Z5\n');
    const sent: SimUpdate[] = [];
    const runs: (() => void)[] = [];
    const r = new SimRunner((m) => sent.push(m as SimUpdate), (run) => runs.push(run), 1e9);
    const drain = (): void => {
      while (runs.length) runs.shift()!();
    };
    const tool = { kind: 'flat', diameter: 10, corner: 0, angle: 118 } as const;
    r.handle({ type: 'init', gen: 1, moves: simMoves(p), grid: spec, tools: [{ number: 1, tool }], defaultTool: tool, mode: 'depth', rapidTol: 0.01, checkpointBytes: 1 << 26, target: { move: 3, frac: 0 } });
    drain();
    // 바닥에 닿기 전: 처음 바닥(사각형)
    expect(sent.at(-1)!.bottom!.indices.length).toBe(6);
    r.handle({ type: 'target', gen: 1, target: { move: p.moves.count, frac: 0 } });
    drain();
    const holed = sent.at(-1)!;
    expect(holed.tiles.some((t) => t.indices)).toBe(true);
    expect(holed.bottom!.indices.length).toBeGreaterThan(6);
    // 되감기: 관통 전 자리 — 조각이 다시 번호 없이, 바닥도 사각형으로
    r.handle({ type: 'target', gen: 1, target: { move: 3, frac: 0 } });
    drain();
    const back = sent.at(-1)!;
    expect(back.tiles.every((t) => !t.indices)).toBe(true);
    expect(back.bottom!.indices.length).toBe(6);
    // 색만 바꾸면(관통은 그대로) 바닥을 다시 보내지 않는다
    r.handle({ type: 'mode', gen: 1, mode: 'stock' });
    drain();
    expect(sent.at(-1)!.bottom).toBeUndefined();
    expect(SIM_MOVE_REGION).toBe(4);
  });
});
