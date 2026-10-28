/**
 * 문서를 열 때 나눠 받는 조각(dynamic import — 첫 화면 JS에서 문서가 없을 때 쓰지 않는 코드를 뺀다).
 *
 * - 3D 뷰어 코어(opencad-viewer3d 입구 → viewer·renderer): 시작 화면(파일 열기·최근 문서·예제·언어 메뉴)은 코어 없이 그린다.
 *   앱은 코어의 작은 모듈(camera 뷰 이름·뷰 키 표, pointer 터치 거리, viewcube 뷰 큐브 글)만 바로 가져오고, 코어 입구는 여기서만 가져온다.
 * - 측정 도구(measure-tools.ts — 방향 잠금·툴팁, 붙잡기 점, 정밀 조준, 원호 접선): 안내·이름 글은 measure.ts(첫 화면)에 남긴다.
 * - 파일을 열기 시작하면 워커 해석과 함께 둘 다 받기 시작한다(app.ts openBuffer). 첫 문서는 둘 다 받은 뒤 보이므로 측정이 바로 켜지고,
 *   측정 도구를 받지 못해도 문서는 연다(그 뒤 측정을 켜면 FirstUse로 다시 받는다). 오프라인 앱은 서비스 워커가 이 조각들도 미리 담아 둔다.
 * - 받지 못하면(오프라인에서 새 판 등) 약속을 비워 다음 부름에서 다시 받는다(onceImport).
 */
type Core = typeof import('opencad-viewer3d');
type MeasureTools = typeof import('./measure-tools');

/** import()를 한 번만 부르는 받기: 받는 동안·받은 뒤에는 같은 약속을 주고, 받지 못하면 비워 다음 부름에서 다시 받는다 */
export function onceImport<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      const p = load();
      pending = p;
      p.catch(() => {
        if (pending === p) pending = null;
      });
    }
    return pending;
  };
}

/** 코어 입구 모듈(한 번만 받는다) */
export const loadViewerCore: () => Promise<Core> = onceImport(() => import('opencad-viewer3d'));

/** 측정 도구 조각(한 번만 받는다) */
export const loadMeasureTools: () => Promise<MeasureTools> = onceImport(() => import('./measure-tools'));

/** 나눠 받는 조각을 받지 못한 오류인지(브라우저마다 글이 다르다: Chrome·Edge, Firefox, Safari) */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload/i.test(msg);
}

/**
 * 측정 도구 조각 받기 실패 안내: 연결이 끊겼으면 연결된 뒤 다시 누르기, 아니면 앱의 새 버전이 나와 예전 조각이 없을 수 있으니 새로 고친 뒤
 * (열어 둔 파일은 최근 문서에서 다시). 받지 못한 조각은 다음 누르기에서 다시 받는다(onceImport)
 */
export function measureFailText(online: boolean): string {
  return online
    ? '측정 도구를 받지 못했습니다. 앱의 새 버전이 나왔을 수 있으니 새로 고친 뒤 파일을 최근 문서에서 다시 여십시오.'
    : '인터넷 연결이 끊겨 측정 도구를 받지 못했습니다. 연결되면 측정 단추를 다시 누르십시오.';
}

/**
 * 처음 켤 때 조각을 받는 도구 켜기(opencad-skp와 같은 꼴): 받는 동안 다시 부르면 바란 값만 바꾸고(받기는 한 번 — 단추를 여러 번 눌러도
 * 꼬이지 않는다), null이면 바람을 거둔다(같은 단추 다시 누르기·Esc). 받기가 끝나면 그때 바라던 값과 오류(없으면 null)를 done에 넘긴다.
 */
export class FirstUse<M> {
  private wantValue: M | null = null;
  private loadingValue = false;

  constructor(
    private readonly load: () => Promise<unknown>,
    private readonly done: (want: M | null, error: unknown) => void,
  ) {}

  /** 받는 중인지 */
  get loading(): boolean {
    return this.loadingValue;
  }

  /** 받는 동안 바라는 값(받는 중이 아니면 null) */
  get wanted(): M | null {
    return this.loadingValue ? this.wantValue : null;
  }

  /** 바라는 값을 정한다. 받는 중이 아니고 값이 있으면 받기 시작한다 */
  request(want: M | null): void {
    this.wantValue = want;
    if (want === null || this.loadingValue) return;
    this.loadingValue = true;
    this.load().then(
      () => this.finish(null),
      (e: unknown) => this.finish(e ?? new Error('load failed')),
    );
  }

  private finish(error: unknown): void {
    const want = this.wantValue;
    this.loadingValue = false;
    this.wantValue = null;
    this.done(want, error);
  }
}
