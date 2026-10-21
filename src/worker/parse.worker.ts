/**
 * NC 해석 워커: G-code·Heidenhain·woodWOP MPR 파일을 화면 밖에서 해석해 Scene3d와 패널 자료로 돌려준다.
 * 함께 연 파일(extra)이 있으면 주 프로그램과 이어 한 작업으로 읽는다(job.ts).
 * 결과의 형식 배열은 이전 가능한 버퍼로 넘긴다(protocol.ts collectTransfers). 해석 길은 payload.ts parseForView(시험과 같다).
 */
/// <reference lib="webworker" />
import { parseForView } from '../app/payload';
import { collectTransfers, errorText, type ParseRequest, type ParseResponse, type ParseResult } from '../app/protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: ParseResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function open(req: ParseRequest): ParseResult {
  const id = req.id;
  const progress = (fraction: number, stage: string): void => post({ id, type: 'progress', fraction: Math.max(0, Math.min(1, fraction)), stage });
  const extra = (req.extra ?? []).map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) }));
  return parseForView(req.name, new Uint8Array(req.bytes), req.nc ?? {}, progress, extra);
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
