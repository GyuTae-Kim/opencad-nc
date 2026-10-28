/**
 * 깎기 시뮬레이션 성능 재기: 합성 프로그램(수만~수십만 이동)을 해석해 끝까지 깎는 시간·메모리·그물 크기를 표로 찍는다.
 *
 *   npm run sim:bench -- [--moves 300000] [--res auto,1024,384] [--only raster,pocket,drill,panel]   (res: 칸 수·auto·auto-phone)
 *
 * 프로그램은 코드로 만든다(실제 파일을 쓰지 않는다): raster = 볼 엔드밀 Ø6 3D 곡면 지그재그(짧은 기울어진 선분),
 * pocket = 평 엔드밀 Ø10 층마다 지그재그 + 원호 모서리, drill = 드릴 Ø6 쪼아 깎기(G83) 구멍 격자,
 * panel = 판 2400 × 1200 × 19 MPR(32 mm 줄 구멍 600개·홈·포켓·자유 형상 포켓·보정 윤곽 — --moves와 상관없이 같은 크기).
 * 그물 열의 괄호는 마디 법선(매끈한 음영)이 차지하는 몫: 법선을 다시 계산한 시간, 법선 바이트, 법선을 넣은 조각 / 깎인 조각.
 */
import { parseGcode } from '../../src/gcode';
import { parseMpr } from '../../src/mpr';
import type { NcProgram } from '../../src/model';
import { SimEngine, type SimMoves } from '../../src/sim/engine';
import { HeightGrid, gridFor } from '../../src/sim/grid';
import { WALL_SLOPE, gridOrigin, panelWallSlope, takeDirtyTiles, tileNormals } from '../../src/sim/mesh';
import { panelSimMoves, panelStock } from '../../src/sim/panel';
import { panelSimSource } from '../../src/sim/panel-source';
import { autoLongCells, defaultStock, panelToolRows, sweepArea, type SimBox } from '../../src/sim/setup';
import { prepareTool, type PreparedTool, type SimTool } from '../../src/sim/tool';

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const MOVES = Number(opt('moves', '300000'));
/** 해상도(긴 변 칸): 수, 또는 auto(넓은 화면 자동 — 기기 1024에서 계산량 어림으로 낮춤)·auto-phone(휴대폰 자동) */
const RES = opt('res', 'auto,1024,384').split(',');
const ONLY = opt('only', 'raster,pocket,drill,panel').split(',');

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

/** 판 2400 × 1200 × 19 MPR: 32 mm 줄 구멍(Ø5 깊이 13) 600개, 관통 구멍 Ø35 20개, 홈 12줄, 포켓 30개, 자유 형상 포켓 8개, 왼쪽 보정 윤곽 4개 */
function panelMpr(): string {
  const o = ['[H', 'VERSION="4.0 Alpha"', 'INCH="0"', '_BSX=2400', '_BSY=1200', '_BSZ=19', ''];
  // 자유 형상 포켓 윤곽(원 둘 반 — 호 두 개) 1~8, 보정 윤곽(모서리를 깎은 사각형) 9~12
  for (let k = 0; k < 8; k++) {
    const cx = 300 + k * 250;
    o.push(`]${k + 1}`, '$E0', 'KP', `X=${cx + 40}`, 'Y=900', 'Z=19', '', '$E1', 'KA', `X=${cx - 40}`, 'Y=900', 'DS=1', 'R=40', '', '$E2', 'KA', `X=${cx + 40}`, 'Y=900', 'DS=1', 'R=40', '');
  }
  for (let k = 0; k < 4; k++) {
    const x0 = 200 + k * 520;
    const pts = [
      [x0, 1000],
      [x0 + 400, 1000],
      [x0 + 400, 1150],
      [x0, 1150],
      [x0, 1000],
    ];
    o.push(`]${9 + k}`, ...pts.flatMap(([x, y], i) => [`$E${i}`, i ? 'KL' : 'KP', `X=${x}`, `Y=${y}`, ...(i ? [] : ['Z=19']), '']));
  }
  o.push('<100 \\WerkStck\\', 'LA="2400"', 'BR="1200"', 'DI="19"', '');
  for (let r = 0; r < 30; r++) o.push('<102 \\BohrVert\\', `XA="${37 + (r % 3) * 780}"`, `YA="${37 + Math.floor(r / 3) * 115}"`, 'TI="13"', 'DU="5"', 'AN="20"', 'AB="32"', '');
  for (let k = 0; k < 20; k++) o.push('<102 \\BohrVert\\', `XA="${120 + k * 110}"`, 'YA="600"', 'TI="25"', 'DU="35"', '');
  for (let k = 0; k < 12; k++) o.push('<109 \\Nuten\\', 'XA="0"', `YA="${150 + k * 30}"`, 'XE="2400"', `YE="${150 + k * 30}"`, 'NB="4"', 'TI="8"', '');
  for (let k = 0; k < 30; k++) o.push('<112 \\Tasche\\', `XA="${120 + (k % 15) * 150}"`, `YA="${k < 15 ? 700 : 780}"`, 'LA="80"', 'BR="40"', 'TI="10"', `WI="${(k * 12) % 90}"`, '');
  for (let k = 0; k < 8; k++) o.push('<181 \\FreiFormTasche\\', `EA="${k + 1}:0"`, 'TI="6"', '');
  for (let k = 0; k < 4; k++) o.push('<105 \\Konturfraesen\\', `EA="${9 + k}:0"`, `EE="${9 + k}:4"`, 'RK="WRKL"', 'TNO="101"', 'ZA="19"', '');
  o.push('!');
  return o.join('\n');
}

/** 재기 한 건: 이동·소재·공구 */
interface Case {
  moves: SimMoves;
  stock: SimBox;
  area: number;
  toolFor: (n: number) => PreparedTool;
  parseMs: number;
  /** 매끈한 음영의 벽 문턱(G-code WALL_SLOPE, 판재 panelWallSlope — 앱과 같게) */
  slope: number;
}

function ncCase(name: string): Case | null {
  const gen = GEN[name];
  if (!gen) return null;
  const { text, tool } = gen(MOVES);
  const t0 = performance.now();
  const p: NcProgram = parseGcode(text);
  const parseMs = performance.now() - t0;
  const stock = defaultStock({ cutBounds: p.feedBounds ?? null, units: 'mm', moves: p.moves }, tool.diameter / 2)!;
  const area = sweepArea(p.moves, () => tool.diameter / 2, stock.max[2]);
  const t = prepareTool(tool);
  const m = p.moves;
  return { moves: { count: m.count, kind: m.kind, points: m.points, tool: m.tool, flags: m.flags, arc: m.arc, arcCenter: p.arcs.center, arcPlane: p.arcs.plane, arcSweep: p.arcs.sweep }, stock, area, toolFor: () => t, parseMs, slope: WALL_SLOPE };
}

function panelCase(): Case {
  const t0 = performance.now();
  const src = panelSimSource(parseMpr(panelMpr()));
  const rows = panelToolRows(src, { 'panel:T101': { diameter: 12 } });
  const radius = (t: number): number => (rows[t]?.tool.diameter ?? 6) / 2;
  const stock = panelStock(src, radius)!;
  const moves = panelSimMoves(src, radius, stock);
  const parseMs = performance.now() - t0;
  const tools = rows.map((r) => prepareTool(r.tool));
  return { moves, stock, area: moves.area, toolFor: (n) => tools[n]!, parseMs, slope: panelWallSlope(rows.map((r) => r.tool)) };
}

const GEN: Record<string, (n: number) => { text: string; tool: SimTool }> = { raster, pocket, drill };
const mb = (b: number): string => (b / 1048576).toFixed(1);

console.log(`| 프로그램 | 이동 | 해석 ms | 격자(긴 변) | 마디 | 깎기 ms | 마디/이동 | 저장점 | 저장점 MB | 그물 ms (법선) | 그물 MB (법선) | 법선 조각 / 깎인 조각 | 높이 지도 MB | RSS MB |`);
console.log(`|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
for (const name of ONLY) {
  const c = name === 'panel' ? panelCase() : ncCase(name);
  if (!c) continue;
  const { stock, area, moves: m } = c;
  const longSide = Math.max(stock.max[0] - stock.min[0], stock.max[1] - stock.min[1]);
  for (const r of RES) {
    const res = r === 'auto' ? autoLongCells(1024, longSide, area, false) : r === 'auto-phone' ? autoLongCells(384, longSide, area, true) : Number(r);
    const spec = gridFor(stock, res);
    const grid = new HeightGrid(spec);
    const nodes = spec.nx * spec.ny;
    const maxCheckpoints = Math.max(2, Math.min(48, Math.floor((96 * 1048576) / (nodes * 5))));
    const engine = new SimEngine(m, grid, c.toolFor, { maxCheckpoints });
    const t1 = performance.now();
    engine.advance({ move: m.count, frac: 0 });
    const simMs = performance.now() - t1;
    const t2 = performance.now();
    const tiles = takeDirtyTiles(grid, gridOrigin(grid), 'depth', c.slope);
    const meshMs = performance.now() - t2;
    const cut = tiles.filter((x) => !x.flat);
    const meshBytes = tiles.reduce((s, x) => s + x.positions.byteLength + x.colors.byteLength + (x.normals?.byteLength ?? 0), 0);
    const normalBytes = tiles.reduce((s, x) => s + (x.normals?.byteLength ?? 0), 0);
    // 법선이 그물 만들기에서 차지하는 시간: 깎인 조각의 법선을 다시 계산해 잰다
    const t3 = performance.now();
    for (const x of cut) {
      const i0 = x.tx * grid.tile;
      const j0 = x.ty * grid.tile;
      tileNormals(grid, i0, Math.min(spec.nx - 1, i0 + grid.tile), j0, Math.min(spec.ny - 1, j0 + grid.tile), c.slope);
    }
    const normalMs = performance.now() - t3;
    const cp = engine.checkpointInfo;
    const rss = process.memoryUsage().rss;
    console.log(
      `| ${name} | ${m.count.toLocaleString('en-US')} | ${c.parseMs.toFixed(0)} | ${spec.nx - 1} × ${spec.ny - 1} (${r === String(res) ? res : `${r} ${res}`}) | ${nodes.toLocaleString('en-US')} | ${simMs.toFixed(0)} | ${(engine.work / m.count).toFixed(0)} | ${cp.count} | ${mb(cp.bytes)} | ${meshMs.toFixed(0)} (${normalMs.toFixed(0)}) | ${mb(meshBytes)} (${mb(normalBytes)}) | ${tiles.filter((x) => x.normals).length} / ${cut.length} | ${mb(grid.h.byteLength + grid.mark.byteLength)} | ${mb(rss)} |`,
    );
  }
}
