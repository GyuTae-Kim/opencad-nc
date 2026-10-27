/**
 * 홈 화면 앱(PWA) 연결: 오프라인 서비스 워커 등록과 새 판 알림, 데스크톱 파일 열기(file_handlers → launchQueue).
 * - 서비스 워커(빌드가 만든 sw.js — tools/sw-plugin.mjs)는 앱 뿌리에 있다. 언어 페이지는 <base href="../">라 document.baseURI가 뿌리다.
 * - 새 판이 설치돼 기다리면 onUpdate(적용 함수)를 부른다. 적용하면 새 워커가 넘겨받은 뒤 한 번 다시 읽는다
 *   (처음 설치 때의 넘겨받기는 다시 읽지 않는다 — 처음 설치는 알리지 않는다).
 * - 개발 서버(import.meta.env.DEV)와 서비스 워커가 없는 브라우저는 아무것도 하지 않는다.
 * - 브라우저 기능은 넘겨받아 쓴다(시험은 가짜를 넘긴다).
 *
 * opencad-step의 src/app/pwa.ts를 따라 짜고, 데스크톱에서 여러 파일(주 프로그램 + 부프로그램)을 함께 열면 한 작업으로 넘긴다.
 */

export interface SwWorker {
  readonly state: string;
  postMessage(msg: unknown): void;
  addEventListener(type: 'statechange', fn: () => void): void;
}

export interface SwRegistration {
  readonly waiting: SwWorker | null;
  readonly installing: SwWorker | null;
  addEventListener(type: 'updatefound', fn: () => void): void;
  update?(): Promise<unknown>;
}

export interface SwContainer {
  readonly controller: unknown;
  register(url: string | URL, opts?: { scope?: string }): Promise<SwRegistration>;
  addEventListener(type: 'controllerchange', fn: () => void): void;
}

export interface PwaEnv {
  /** navigator.serviceWorker(없으면 아무것도 하지 않는다) */
  sw?: SwContainer;
  /** 앱 뿌리 주소(document.baseURI) */
  base: string;
  reload: () => void;
  /** 앱으로 돌아올 때 부를 함수를 건다(새 판 확인) */
  onVisible?: (fn: () => void) => void;
}

const browserEnv = (): PwaEnv | null => {
  if (import.meta.env?.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return {
    sw: navigator.serviceWorker as unknown as SwContainer,
    base: document.baseURI,
    reload: () => location.reload(),
    onVisible: (fn) =>
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') fn();
      }),
  };
};

/** 서비스 워커 등록(오프라인)과 새 판 알림. 등록하지 못하면(비공개 창·파일 주소 등) 조용히 null — 오프라인 없이 그대로 쓴다 */
export async function registerServiceWorker(onUpdate: (apply: () => void) => void, env: PwaEnv | null = browserEnv()): Promise<SwRegistration | null> {
  const sw = env?.sw;
  if (!env || !sw) return null;
  let applied = false;
  sw.addEventListener('controllerchange', () => {
    if (!applied) return;
    applied = false;
    env.reload();
  });
  const url = new URL('sw.js', env.base);
  let reg: SwRegistration;
  try {
    reg = await sw.register(url, { scope: new URL('./', url).href });
  } catch {
    return null;
  }
  const offer = (w: SwWorker | null): void => {
    // 처음 설치(맡은 워커가 없음)는 알리지 않는다 — 다음 방문부터 오프라인으로 열린다
    if (!w || !sw.controller) return;
    onUpdate(() => {
      applied = true;
      w.postMessage({ type: 'SKIP_WAITING' });
    });
  };
  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') offer(reg.waiting ?? w);
    });
  });
  // 앱으로 돌아올 때 새 판이 있는지 본다(홈 화면 앱은 오래 열려 있다)
  env.onVisible?.(() => void reg.update?.().catch(() => {}));
  return reg;
}

interface LaunchParams {
  files?: readonly { getFile(): Promise<File> }[];
}

interface LaunchQueueHost {
  launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void };
}

/**
 * 데스크톱 홈 화면 앱으로 파일을 열면(파일 탐색기 "연결 프로그램") 그 파일들을 넘긴다(여럿이면 한 작업으로 열도록 모두 함께).
 * 읽지 못한 파일은 빼고, 하나도 못 읽으면 부르지 않는다. launchQueue가 있으면 true
 */
export function consumeLaunchQueue(open: (files: File[]) => void, host: LaunchQueueHost = globalThis as LaunchQueueHost): boolean {
  const lq = host.launchQueue;
  if (!lq || typeof lq.setConsumer !== 'function') return false;
  lq.setConsumer((params) => {
    const handles = params.files ?? [];
    if (!handles.length) return;
    void Promise.all(handles.map((h) => h.getFile().then((f) => f, () => null))).then((files) => {
      const ok = files.filter((f): f is File => !!f);
      if (ok.length) open(ok);
    });
  });
  return true;
}
