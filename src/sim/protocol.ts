/**
 * 깎기 시뮬레이션 워커(src/worker/sim.worker.ts)와 화면(src/app/sim.ts) 사이의 메시지 꼴.
 * 화면 → 워커: 처음(이동·격자·공구), 목표 자리(재생 막대), 색 바꾸기. 워커 → 화면: 바뀐 조각 그물·옆면·바닥, 급속 사건, 계산 통계.
 * gen은 설정을 바꿔 새로 시작할 때마다 늘린다(옛 결과는 화면이 버린다).
 */
import type { SimEvent, SimMoves, SimPosition } from './engine';
import type { GridSpec } from './grid';
import type { PlainArrays, SimColorMode, TileArrays } from './mesh';
import type { SimTool } from './tool';

export interface SimInitRequest {
  type: 'init';
  gen: number;
  moves: SimMoves;
  grid: GridSpec;
  /** 공구 번호별 값(없는 번호는 defaultTool) */
  tools: { number: number; tool: SimTool }[];
  defaultTool: SimTool;
  mode: SimColorMode;
  /** 급속 사건으로 볼 깊이 */
  rapidTol: number;
  /** 저장점에 쓸 메모리(바이트) */
  checkpointBytes: number;
  target: SimPosition;
  /** 매끈한 음영의 벽 문턱(칸 크기에 곱할 값, 없으면 WALL_SLOPE — 판재는 panelWallSlope) */
  wallSlope?: number;
}

export type SimRequest = SimInitRequest | { type: 'target'; gen: number; target: SimPosition } | { type: 'mode'; gen: number; mode: SimColorMode };

export interface SimStats {
  /** 계산에 쓴 시간 합(ms, 그물 만들기 빼고) */
  computeMs: number;
  /** 그물 만들기 시간 합(ms) */
  meshMs: number;
  /** 살펴본 마디 수 합 */
  work: number;
  checkpoints: number;
  checkpointBytes: number;
  rewinds: number;
}

export interface SimUpdate {
  type: 'update';
  gen: number;
  /** 지금 계산한 자리 */
  at: SimPosition;
  target: SimPosition;
  reached: boolean;
  tiles: TileArrays[];
  walls?: PlainArrays;
  bottom?: PlainArrays;
  /** 지금 자리까지 급속이 소재를 깎은 이동 */
  events: SimEvent[];
  stats: SimStats;
}

export type SimResponse = SimUpdate | { type: 'error'; gen: number; message: string };
