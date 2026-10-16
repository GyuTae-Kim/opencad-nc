/**
 * 해석 워커(src/worker/parse.worker.ts)와 화면 사이의 메시지 꼴과 직렬화 도움(순수 함수, DOM 없음).
 *
 * 파일 바이트는 화면 → 워커로 이전(transfer)하고, 결과 장면·NC 자료의 형식 배열은 워커 → 화면으로 이전한다
 * (복사 없이 넘긴다). 한 메시지 안에서 같은 버퍼를 여러 곳이 가리킬 수 있으므로(예: scene.meta.moveLine = moves.line)
 * 이전 목록에는 버퍼마다 한 번만 넣는다.
 *
 * 이 파일은 화면 쪽에서도 불러오므로 해석기(무거운 코드)를 가져오지 않는다 — 워커 쪽 도움은 payload.ts에 있다.
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import type { NcDialect, NcStats, NcTool } from '../model';
import type { NcSource } from '../text';

/** 다시 해석할 때 고르는 것 */
export interface NcOpenOptions {
  /** G-code 방언(기본 'auto') */
  dialect?: NcDialect | 'auto';
  /** G20/G21이 없을 때의 단위(기본 mm) */
  units?: 'mm' | 'inch';
  /** 반경 보정 경로(공구 중심)를 따로 그릴지(G-code·Heidenhain) */
  comp?: boolean;
  /** 선반 모드로 읽기(G-code) */
  lathe?: boolean;
  /** 회전축 A·B·C 감기(G-code) */
  rotary?: boolean;
  /** 꺼진 가공도 그리기(MPR) */
  mprDisabled?: boolean;
}

export interface ParseRequest {
  id: number;
  type: 'open';
  /** 파일 이름(장면·프로그램 이름) */
  name: string;
  /** 파일 바이트(이전된다) */
  bytes: ArrayBuffer;
  nc?: NcOpenOptions;
}

export type ParseResponse =
  | { id: number; type: 'progress'; fraction: number; stage: string }
  | { id: number; type: 'done'; result: ParseResult }
  | { id: number; type: 'error'; message: string };

/** 화면 패널이 쓰는 G-code·Heidenhain 자료. 모델 전체가 아니라 패널에 필요한 것만 */
export interface NcPayload {
  kind: 'gcode' | 'heidenhain';
  dialect: NcDialect;
  units: 'mm' | 'inch';
  /** 원본 글(줄 글은 sourceLine(source, i)) */
  source: NcSource;
  moves: {
    count: number;
    kind: Uint8Array;
    /** 점 xyz(길이 3*(count+1)) — 이동 i는 점 i → 점 i+1 */
    points: Float64Array;
    line: Uint32Array;
    tool: Int32Array;
    feed: Float32Array;
  };
  /** 이동마다 끝난 시각(초, 누적) */
  timeline: Float64Array;
  /** 줄 → 이동(CSR) */
  lineMoves: { offsets: Uint32Array; moves: Uint32Array };
  tools: NcTool[];
  stats: NcStats;
}

/** MPR 패널 자료(가공·변수는 scene.meta에 있다) */
export interface MprPayload {
  /** 원본 줄 */
  lines: string[];
}

export type NcKind = 'gcode' | 'heidenhain' | 'mpr';

export interface ParseResult {
  kind: NcKind;
  scene: Scene3d;
  nc?: NcPayload;
  mpr?: MprPayload;
  /** 해석 시간(ms) */
  ms: number;
}

/**
 * 값 안의 모든 ArrayBuffer(형식 배열의 버퍼 포함)를 한 번씩 모은다 — postMessage 이전 목록.
 * 일반 객체·배열·Map·Set을 따라 들어가고, 같은 객체는 한 번만 본다. SharedArrayBuffer와 빈 버퍼는 넣지 않는다.
 */
export function collectTransfers(value: unknown): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (v instanceof ArrayBuffer) {
      if (v.byteLength > 0) out.add(v);
      continue;
    }
    if (ArrayBuffer.isView(v)) {
      const b = v.buffer;
      if (b instanceof ArrayBuffer && b.byteLength > 0) out.add(b);
      continue;
    }
    if (Array.isArray(v)) {
      for (const x of v) if (x !== null && typeof x === 'object') stack.push(x);
      continue;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) {
        stack.push(k);
        stack.push(x);
      }
      continue;
    }
    if (v instanceof Set) {
      for (const x of v) stack.push(x);
      continue;
    }
    for (const x of Object.values(v)) if (x !== null && typeof x === 'object') stack.push(x);
  }
  return [...out];
}

/** 장면에 그릴 것이 있는지(그물·선분·점) */
export function sceneHasGeometry(s: Scene3d): boolean {
  return (
    s.meshes.some((m) => m.positions.length >= 9) ||
    s.lines.some((l) => l.positions.length >= 6) ||
    (s.points ?? []).some((p) => p.positions.length >= 3)
  );
}

/** 오류 값 → 사람이 읽는 글(메모리 부족처럼 알기 어려운 것은 풀어 쓴다) */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message || e.name : String(e ?? '');
  const name = e instanceof Error ? e.name : '';
  if (name === 'RangeError' && /array buffer|allocation|memory|invalid (typed )?array length/i.test(raw)) return '메모리가 모자라 파일을 끝까지 읽지 못했습니다. 더 작은 파일로 나누거나 다른 브라우저에서 열어 보십시오.';
  if (/out of memory/i.test(raw)) return '메모리가 모자라 파일을 끝까지 읽지 못했습니다.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return '파일을 받지 못했습니다(네트워크 오류).';
  return raw || '알 수 없는 오류가 났습니다.';
}
