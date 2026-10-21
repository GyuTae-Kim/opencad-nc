/**
 * 해석 워커 손님: 파일 바이트를 워커로 넘기고(이전), 진행률을 받아 결과를 돌려받는다.
 * 워커는 처음 쓸 때 만들고 하나를 계속 쓴다. 워커가 죽으면 기다리던 요청을 모두 실패로 끝내고 다음에 새로 만든다.
 */
import type { NcOpenOptions, ParseRequest, ParseResponse, ParseResult } from './protocol';

interface Pending {
  resolve: (r: ParseResult) => void;
  reject: (e: Error) => void;
  progress?: (fraction: number, stage: string) => void;
}

export class ParseWorkerClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  /** 파일 해석(data와 함께 여는 파일 extra는 이전되어 비워진다) */
  open(
    name: string,
    data: ArrayBuffer,
    nc: NcOpenOptions = {},
    progress?: (fraction: number, stage: string) => void,
    extra: { name: string; bytes: ArrayBuffer }[] = [],
  ): Promise<ParseResult> {
    let w: Worker;
    try {
      w = this.ensure();
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const id = ++this.seq;
    return new Promise<ParseResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      const req: ParseRequest = { id, type: 'open', name, bytes: data, nc, ...(extra.length ? { extra } : {}) };
      try {
        w.postMessage(req, [data, ...extra.map((f) => f.bytes)]);
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  dispose(): void {
    this.fail(new Error('해석을 멈췄습니다'));
    this.worker?.terminate();
    this.worker = null;
  }

  /** 지금 해석을 멈춘다(워커를 끝내고 기다리던 요청은 실패로). 다음 요청에서 워커를 새로 만든다 */
  cancel(): boolean {
    const had = this.pending.size > 0;
    this.dispose();
    return had;
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../worker/parse.worker.ts', import.meta.url), { type: 'module', name: 'opencad-nc-parse' });
    w.onmessage = (ev: MessageEvent<ParseResponse>) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') {
        p.progress?.(m.fraction, m.stage);
        return;
      }
      this.pending.delete(m.id);
      if (m.type === 'done') p.resolve(m.result);
      else p.reject(new Error(m.message));
    };
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      this.fail(new Error(ev.message || '해석 워커가 멈췄습니다(메모리가 모자랄 수 있습니다)'));
      w.terminate();
      if (this.worker === w) this.worker = null;
    };
    this.worker = w;
    return w;
  }

  private fail(e: Error): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(e);
  }
}
