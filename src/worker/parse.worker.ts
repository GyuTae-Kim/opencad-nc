/**
 * NC 해석 워커: G-code·Heidenhain·woodWOP MPR 파일을 화면 밖에서 해석해 Scene3d와 패널 자료로 돌려준다.
 * 결과의 형식 배열은 이전 가능한 버퍼로 넘긴다(protocol.ts collectTransfers).
 */
/// <reference lib="webworker" />
import { ncParsedToScene, parseNcFile } from '../index';
import { checkNcInput, ncPayload } from '../app/payload';
import { collectTransfers, errorText, type ParseRequest, type ParseResponse, type ParseResult } from '../app/protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: ParseResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function open(req: ParseRequest): ParseResult {
  const id = req.id;
  const progress = (fraction: number, stage: string): void => post({ id, type: 'progress', fraction: Math.max(0, Math.min(1, fraction)), stage });
  const t0 = performance.now();
  const bytes = new Uint8Array(req.bytes);
  const base = req.name.replace(/^.*[\\/]/, '');
  progress(0.05, '파일 확인 중');
  const check = checkNcInput(base, bytes);
  if (!check.ok) throw new Error(check.message);
  progress(0.15, check.kind === 'mpr' ? 'woodWOP MPR 읽는 중' : check.kind === 'heidenhain' ? 'Heidenhain 프로그램 읽는 중' : 'G-code 읽는 중');
  const o = req.nc ?? {};
  const parsed = parseNcFile(base, bytes, {
    ...(check.kind ? { kind: check.kind } : {}),
    gcode: { dialect: o.dialect ?? 'auto', ...(o.units ? { units: o.units } : {}) },
  });
  progress(0.7, '공구 경로 만드는 중');
  const scene = ncParsedToScene(parsed);
  progress(0.95, '화면으로 보내는 중');
  const out: ParseResult = { kind: parsed.kind, scene, ms: 0 };
  if (parsed.kind === 'mpr') out.mpr = { lines: parsed.part.lines };
  else out.nc = ncPayload(parsed.program);
  out.ms = performance.now() - t0;
  return out;
}

ctx.onmessage = (ev: MessageEvent<ParseRequest>) => {
  const req = ev.data;
  if (!req || req.type !== 'open') return;
  let result: ParseResult;
  try {
    result = open(req);
  } catch (e) {
    post({ id: req.id, type: 'error', message: errorText(e) });
    return;
  }
  try {
    post({ id: req.id, type: 'done', result }, collectTransfers(result));
  } catch {
    // 이전이 막히면(드문 경우) 복사로 보낸다
    post({ id: req.id, type: 'done', result });
  }
};
