/**
 * 깎기 시뮬레이션 성능 재기: 합성 프로그램(수만~수십만 이동)을 해석해 끝까지 깎는 시간·메모리·그물 크기를 표로 찍는다.
 *
 *   npm run sim:bench -- [--moves 300000] [--res auto,1024,384] [--only raster,pocket,drill]   (res: 칸 수·auto·auto-phone)
 *
 * 프로그램은 코드로 만든다(실제 파일을 쓰지 않는다): raster = 볼 엔드밀 Ø6 3D 곡면 지그재그(짧은 기울어진 선분),
 * pocket = 평 엔드밀 Ø10 층마다 지그재그 + 원호 모서리, drill = 드릴 Ø6 쪼아 깎기(G83) 구멍 격자.
 */
import { parseGcode } from '../../src/gcode';
import type { NcProgram } from '../../src/model';
import { SimEngine } from '../../src/sim/engine';
import { HeightGrid, gridFor } from '../../src/sim/grid';
import { gridOrigin, takeDirtyTiles } from '../../src/sim/mesh';
import { autoLongCells, defaultStock, sweepArea } from '../../src/sim/setup';
import { prepareTool, type SimTool } from '../../src/sim/tool';

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const MOVES = Number(opt('moves', '300000'));
/** 해상도(긴 변 칸): 수, 또는 auto(넓은 화면 자동 — 기기 1024에서 계산량 어림으로 낮춤)·auto-phone(휴대폰 자동) */
const RES = opt('res', 'auto,1024,384').split(',');
const ONLY = opt('only', 'raster,pocket,drill').split(',');

const f = (v: number): string => (Math.round(v * 1000) / 1000).toString();

function raster(n: number): { text: string; tool: SimTool } {
  // 100 × 100 곡면, 줄 수 × 줄마다 선분 수 ≈ n
  const lines = Math.max(10, Math.round(Math.sqrt(n / 2)));
  const segs = Math.max(10, Math.round(n / lines));
  const o = ['G21 G90 G17', 'T1 M6 (T1 D=6. CR=3. - ball end mill)', 'G0 X0 Y0 Z10', 'G1 Z0 F2000'];
  const z = (x: number, y: number) => -6 + 2 * Math.sin(x / 9) * Math.cos(y / 13) + 0.02 * x;
  for (let l = 0; l < lines; l++) {
    const y = (l / (lines - 1)) * 100;
    for (let s = 0; s <= segs; s++) {
      const x = ((l % 2 ? segs - s : s) / segs) * 100;
      o.push(`G1 X${f(x)} Y${f(y)} Z${f(z(x, y))}`);
    }
  }
  o.push('G0 Z10', 'M30');
  return { text: o.join('\n'), tool: { kind: 'ball', diameter: 6, corner: 3, angle: 118 } };
}

function pocket(n: number): { text: string; tool: SimTool } {
  // 120 × 80 포켓, 층 10개, 지그재그 선분을 잘게 나눠 이동 수를 맞춘다(모서리는 원호)
  const levels = 10;
  const passes = 16;
  const per = Math.max(2, Math.round(n / (levels * passes)));
  const o = ['G21 G90 G17', 'T2 M6 (T2 D=10. FLAT END MILL)', 'G0 X0 Y0 Z5'];
  for (let k = 1; k <= levels; k++) {
    o.push(`G1 Z${f(-k)} F500`);
    for (let p = 0; p < passes; p++) {
      const y = (p / (passes - 1)) * 75 + 2.5;
      const right = p % 2 === 0;
      for (let s = 1; s <= per; s++) o.push(`G1 X${f(5 + ((right ? s : per - s) / per) * 110)} Y${f(y)} F2000`);
      if (p + 1 < passes) o.push(`G${right ? 3 : 2} X${f(right ? 115 : 5)} Y${f(y + 75 / (passes - 1))} R${f(75 / (passes - 1) / 2)}`);
    }
    o.push('G0 Z5', 'G0 X0 Y0');
  }
  o.push('M30');
  return { text: o.join('\n'), tool: { kind: 'flat', diameter: 10, corner: 0, angle: 118 } };
}

function drill(n: number): { text: string; tool: SimTool } {
  // G83 쪼아 깎기 한 구멍 ≈ 10 이동
  const holes = Math.max(4, Math.round(n / 10));
  const side = Math.ceil(Math.sqrt(holes));
  const o = ['G21 G90 G17', 'T3 M6 (T3 D=6. DRILL)', 'G0 X0 Y0 Z10', `G98 G83 X0 Y0 Z-12 R2 Q3 F200`];
  let c = 0;
  for (let j = 0; j < side && c < holes; j++)
    for (let i = 0; i < side && c < holes; i++, c++) o.push(`X${f((i / side) * 200)} Y${f((j / side) * 200)}`);
  o.push('G80', 'G0 Z20', 'M30');
  return { text: o.join('\n'), tool: { kind: 'drill', diameter: 6, corner: 0, angle: 118 } };
}

const GEN: Record<string, (n: number) => { text: string; tool: SimTool }> = { raster, pocket, drill };
const mb = (b: number): string => (b / 1048576).toFixed(1);

console.log(`| 프로그램 | 이동 | 해석 ms | 격자(긴 변) | 마디 | 깎기 ms | 마디/이동 | 저장점 | 저장점 MB | 그물 ms | 그물 MB(깎인 조각) | 높이 지도 MB | RSS MB |`);
console.log(`|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
for (const name of ONLY) {
  const gen = GEN[name];
  if (!gen) continue;
  const { text, tool } = gen(MOVES);
  const t0 = performance.now();
  const p: NcProgram = parseGcode(text);
  const parseMs = performance.now() - t0;
  const stock = defaultStock({ cutBounds: p.feedBounds ?? null, units: 'mm', moves: p.moves }, tool.diameter / 2)!;
  const area = sweepArea(p.moves, () => tool.diameter / 2, stock.max[2]);
  const longSide = Math.max(stock.max[0] - stock.min[0], stock.max[1] - stock.min[1]);
  for (const r of RES) {
    const res = r === 'auto' ? autoLongCells(1024, longSide, area, false) : r === 'auto-phone' ? autoLongCells(384, longSide, area, true) : Number(r);
    const spec = gridFor(stock, res);
    const grid = new HeightGrid(spec);
    const nodes = spec.nx * spec.ny;
    const maxCheckpoints = Math.max(2, Math.min(48, Math.floor((96 * 1048576) / (nodes * 5))));
    const t = prepareTool(tool);
    const m = p.moves;
    const engine = new SimEngine({ count: m.count, kind: m.kind, points: m.points, tool: m.tool, flags: m.flags, arc: m.arc, arcCenter: p.arcs.center, arcPlane: p.arcs.plane, arcSweep: p.arcs.sweep }, grid, () => t, { maxCheckpoints });
    const t1 = performance.now();
    engine.advance({ move: m.count, frac: 0 });
    const simMs = performance.now() - t1;
    const t2 = performance.now();
    const tiles = takeDirtyTiles(grid, gridOrigin(grid), 'depth');
    const meshMs = performance.now() - t2;
    const meshBytes = tiles.reduce((s, x) => s + x.positions.byteLength + x.colors.byteLength, 0);
    const cp = engine.checkpointInfo;
    const rss = process.memoryUsage().rss;
    console.log(
      `| ${name} | ${m.count.toLocaleString('en-US')} | ${parseMs.toFixed(0)} | ${spec.nx - 1} × ${spec.ny - 1} (${r === String(res) ? res : `${r} ${res}`}) | ${nodes.toLocaleString('en-US')} | ${simMs.toFixed(0)} | ${(engine.work / m.count).toFixed(0)} | ${cp.count} | ${mb(cp.bytes)} | ${meshMs.toFixed(0)} | ${mb(meshBytes)} | ${mb(grid.h.byteLength + grid.mark.byteLength)} | ${mb(rss)} |`,
    );
  }
}
