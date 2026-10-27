/**
 * 3D 뷰어 코어(opencad-viewer3d)를 문서를 열 때 나눠 받는다(dynamic import — 첫 화면 JS에서 코어의 그리기·고르기를 뺀다).
 *
 * - 시작 화면(파일 열기·최근 문서·예제·언어 메뉴)은 코어 없이 그린다. 앱은 코어의 작은 모듈(camera 뷰 이름·뷰 키 표, pointer 터치 거리,
 *   viewcube 뷰 큐브 글)만 바로 가져오고, 코어 입구(index → viewer·renderer)는 여기서만 가져온다.
 * - 파일을 열기 시작하면 워커 해석과 함께 받기 시작한다(app.ts openBuffer). 오프라인 앱은 서비스 워커가 이 조각도 미리 담아 둔다.
 * - 받지 못하면(오프라인에서 새 판 등) 약속을 비워 다음 열기에서 다시 받는다.
 */
type Core = typeof import('opencad-viewer3d');

let pending: Promise<Core> | null = null;

/** 코어 입구 모듈(한 번만 받는다) */
export function loadViewerCore(): Promise<Core> {
  if (!pending) {
    const p = import('opencad-viewer3d');
    pending = p;
    p.catch(() => {
      if (pending === p) pending = null;
    });
  }
  return pending;
}
