/**
 * 뷰어를 만들 때 코어와 함께 나눠 받는 3D 보기 위 앱 UI(56차 — core.ts loadViewerCore가 코어와 함께 받고 viewerUi로 준다): 단면 손잡이 끌기와 키보드 붙잡기·고르기(keysnap.ts).
 * 둘 다 뷰어가 생긴 뒤에만 쓰므로 첫 화면 JS(시작 화면 — 파일 열기·최근 문서·예제·언어 메뉴)에서 뺐다(첫 화면 조각을 55차 이하로).
 * 받지 못하면(오프라인에서 새 판 등) 문서는 그대로 열고 단면 손잡이·키보드 붙잡기만 없다(단면은 도구 막대 범위 막대로 옮긴다)
 */
import type { Viewer3d } from 'opencad-viewer3d';
import { h } from './dom';

export { KeySnap, type KeySnapHost } from './keysnap';

/** 단면 손잡이 끌기 → moveSectionByPixels(UI는 알림으로 맞춘다 — app.ts renderSection·placeSecHandle) */
export function makeSecHandle(viewer: () => Viewer3d | null): HTMLDivElement {
  const el = h('div', { class: 'sec-handle', hidden: true, title: '끌어서 단면 옮기기', 'aria-hidden': 'true' });
  let last: { x: number; y: number; id: number } | null = null;
  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    last = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    el.classList.add('dragging');
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      /* 합성 사건 */
    }
  });
  el.addEventListener('pointermove', (ev) => {
    if (!last || ev.pointerId !== last.id) return;
    viewer()?.moveSectionByPixels(ev.clientX - last.x, ev.clientY - last.y);
    last = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
  });
  const end = (): void => {
    last = null;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return el;
}
