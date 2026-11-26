/**
 * 깎기 시뮬레이션 실행기(워커 몸통 — src/worker/sim.worker.ts가 감싼다. 시험은 워커 없이 바로 쓴다).
 * 목표 자리(재생 막대)를 받으면 40 ms씩 나눠 나아가며 그 사이에 새 목표를 받는다(앞으로 감기는 이어서, 되감기는 저장점에서).
 * 목표에 닿으면, 오래 걸리면 0.25초마다 바뀐 조각 그물·옆면·바닥과 급속 사건을 보낸다.
 */
import { SimEngine, comparePosition, type SimPosition } from './engine';
import { HeightGrid } from './grid';
import { WALL_SLOPE, buildBottom, buildWalls, gridOrigin, takeDirtyTiles, type SimColorMode } from './mesh';
import type { SimRequest, SimResponse, SimUpdate } from './protocol';
import { prepareTool, type PreparedTool } from './tool';

/** 급속 사건을 객체로 보내는 수(그 뒤는 SimUpdate.moreEvents) */
const EVENT_OBJECTS = 2000;

interface State {
  gen: number;
  grid: HeightGrid;
  engine: SimEngine;
  origin: [number, number, number];
  mode: SimColorMode;
  /** 벽 문턱(칸 크기에 곱할 값) */
  slope: number;
  target: SimPosition;
  computeMs: number;
  meshMs: number;
  sentBottom: boolean;
  /** 조각마다 관통해 뺀 삼각형의 서명(바뀌면 바닥을 다시 만든다 — TileArrays.holes) */
  holes: Int32Array;
  sentEvents: number;
  lastPost: number;
  /** 지금 목표에 닿았다고 이미 알렸는지 */
  told: boolean;
}

export class SimRunner {
  private st: State | null = null;
  private scheduled = false;

  constructor(
    private readonly post: (msg: SimResponse, transfer: Transferable[]) => void,
    private readonly later: (run: () => void) => void = (run) => setTimeout(run, 0),
    private readonly sliceMs = 40,
  ) {}

  handle(req: SimRequest): void {
    if (!req) return;
    if (req.type === 'init') {
      try {
        const grid = new HeightGrid(req.grid);
        const prepared = new Map<number, PreparedTool>();
        for (const t of req.tools) prepared.set(t.number, prepareTool(t.tool));
        const fallback = prepareTool(req.defaultTool);
        const nodes = req.grid.nx * req.grid.ny;
        const maxCheckpoints = Math.max(2, Math.min(48, Math.floor(req.checkpointBytes / Math.max(1, nodes * 5))));
        const engine = new SimEngine(req.moves, grid, (n) => prepared.get(n) ?? fallback, { rapidTol: req.rapidTol, maxCheckpoints });
        this.st = { gen: req.gen, grid, engine, origin: gridOrigin(grid), mode: req.mode, slope: req.wallSlope ?? WALL_SLOPE, target: req.target, computeMs: 0, meshMs: 0, sentBottom: false, holes: new Int32Array(grid.tilesX * grid.tilesY), sentEvents: -1, lastPost: 0, told: false };
        this.schedule();
      } catch (e) {
        this.st = null;
        this.post({ type: 'error', gen: req.gen, message: e instanceof Error ? e.message : String(e) }, []);
      }
      return;
    }
    const s = this.st;
    if (!s || req.gen !== s.gen) return;
    if (req.type === 'target') {
      if (comparePosition(req.target, s.target) === 0) return;
      s.target = req.target;
      s.told = false;
    } else if (req.type === 'mode') {
      if (req.mode === s.mode) return;
      s.mode = req.mode;
      s.grid.dirty.fill(1);
      s.grid.wallDirty = true;
      s.told = false;
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.later(() => this.run());
  }

  private run(): void {
    this.scheduled = false;
    const s = this.st;
    if (!s) return;
    try {
      const t0 = performance.now();
      const reached = s.engine.advance(s.target, this.sliceMs);
      const t1 = performance.now();
      s.computeMs += t1 - t0;
      const changed = s.grid.wallDirty || !s.sentBottom || s.grid.dirty.includes(1) || s.engine.events.length !== s.sentEvents;
      if ((reached && (!s.told || changed)) || (changed && t1 - s.lastPost > 250)) this.send(s, reached);
      if (!reached) this.schedule();
    } catch (e) {
      this.post({ type: 'error', gen: s.gen, message: e instanceof Error ? e.message : String(e) }, []);
      this.st = null;
    }
  }

  private send(s: State, reached: boolean): void {
    const t0 = performance.now();
    const tiles = takeDirtyTiles(s.grid, s.origin, s.mode, s.slope);
    const walls = s.grid.wallDirty ? buildWalls(s.grid, s.origin, s.mode) : undefined;
    // 관통해 뺀 윗면 삼각형이 바뀐 조각이 있으면 바닥도 그 나머지로 다시(관통이 없으면 처음 한 번 — 사각형 하나)
    let holed = false;
    for (const t of tiles) {
      const k = t.ty * s.grid.tilesX + t.tx;
      if (s.holes[k] !== t.holes) {
        s.holes[k] = t.holes;
        holed = true;
      }
    }
    const bottom = s.sentBottom && !holed ? undefined : buildBottom(s.grid, s.origin);
    s.sentBottom = true;
    s.meshMs += performance.now() - t0;
    const cp = s.engine.checkpointInfo;
    // 사건은 처음 2,000개만 객체로(복제 부담), 그 뒤는 형식 배열 둘로 옮겨 넘긴다(131차 — 예전에는 버려 깎기 탭 제목 수가 적게 보였다)
    const ev = s.engine.events;
    let more: SimUpdate['moreEvents'];
    if (ev.length > EVENT_OBJECTS) {
      const n = ev.length - EVENT_OBJECTS;
      more = { move: new Int32Array(n), depth: new Float64Array(n) };
      for (let i = 0; i < n; i++) {
        more.move[i] = ev[EVENT_OBJECTS + i]!.move;
        more.depth[i] = ev[EVENT_OBJECTS + i]!.depth;
      }
    }
    const msg: SimUpdate = {
      type: 'update',
      gen: s.gen,
      at: s.engine.position,
      target: s.target,
      reached,
      tiles,
      ...(walls ? { walls } : {}),
      ...(bottom ? { bottom } : {}),
      events: ev.slice(0, EVENT_OBJECTS),
      ...(more ? { moreEvents: more } : {}),
      stats: { computeMs: s.computeMs, meshMs: s.meshMs, work: s.engine.work, checkpoints: cp.count, checkpointBytes: cp.bytes, rewinds: s.engine.rewinds },
    };
    s.sentEvents = s.engine.events.length;
    s.lastPost = performance.now();
    s.told = reached;
    const transfer: Transferable[] = [];
    for (const t of tiles) transfer.push(t.positions.buffer, t.colors.buffer, ...(t.normals ? [t.normals.buffer] : []), ...(t.indices ? [t.indices.buffer] : []));
    for (const p of [walls, bottom]) if (p) transfer.push(p.positions.buffer, p.colors.buffer, p.indices.buffer);
    if (more) transfer.push(more.move.buffer, more.depth.buffer);
    this.post(msg, transfer);
  }
}
