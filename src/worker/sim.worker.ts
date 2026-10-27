/**
 * 깎기 시뮬레이션 워커: 높이 지도를 화면 밖에서 계산하고 바뀐 조각 그물만 돌려준다(몸통은 src/sim/runner.ts, 메시지는 src/sim/protocol.ts).
 */
/// <reference lib="webworker" />
import type { SimRequest } from '../sim/protocol';
import { SimRunner } from '../sim/runner';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const runner = new SimRunner((msg, transfer) => ctx.postMessage(msg, transfer));
ctx.onmessage = (ev: MessageEvent<SimRequest>) => runner.handle(ev.data);
