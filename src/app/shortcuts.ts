/**
 * 키보드 단축키 창(205차 — WCAG 2.1.1 도움, 3.3.5 도움말). 204차까지 키 도움말은 시작 화면 키 줄(문서를 열면 닫힘)·3D 보기 설명(keysnap.ts KEY_HELP)·README 키 표뿐이라,
 * 문서를 연 뒤에는 측정 잠금 키(Shift·화살표·X·Y·Z·L)·가상 커서·코드 찾기 키를 앱 안에서 볼 곳이 없었다.
 *
 * - 여는 길: ? 키(keys.ts keyAction — 문서 없이도)·앱 설정 메뉴 「키보드 단축키」(app.ts openShortcuts). 이 조각은 열 때 받는다(`void import('./shortcuts')` — 첫 화면 JS 밖,
 *   오프라인은 서비스 워커가 빌드 조각을 미리 담는다). 스타일(shortcuts.css)도 이 조각과 함께 받는다.
 * - SHORTCUTS는 순수 자료다 — 앱이 실제로 받는 키(keys.ts keyAction·코어 handleKey·가상 커서 KEY_SNAP_KEYS·측정 조각 lockKeyOf)와 같게 둔다(tests/app/shortcuts.test.ts가 맞춰 본다:
 *   새 키를 더하고 여기 넣지 않거나, 받지 않는 키가 남으면 실패). 「하는 일」은 이미 있는 원문(키 줄·KEY_HELP·측정 띠 버튼·코어 가상 커서 안내)과 같은 낱말(한 기능 한 낱말).
 *   글은 화면 번역층이 옮기고, 키는 옮기지 않는다(`<kbd translate="no">`).
 * - 상자(SKP 앱 꼴): role=dialog·aria-modal·aria-labelledby(제목), 열면 닫기 버튼에 초점, Tab·Shift+Tab은 닫기 버튼 ↔ 굴리는 본문(이름 있는 영역)만 돈다.
 *   Esc·닫기·바깥 누르기로 닫는다 — 바깥 누르기는 마우스는 pointerdown, 손가락·펜은 그 탭의 click(누를 때 떼면 뗀 뒤 click이 밑의 버튼을 누른다 — SKP 140차).
 *   열린 동안 parent의 다른 자식은 inert(이미 inert인 것 — 읽는 중 덮개 등 — 은 건드리지 않는다), 닫으면 초점을 돌려주기 전에 푼다(SKP 165차). 앱 창 키는 상자 안 키를 고르지 않는다(app.ts onKey).
 */
import './shortcuts.css';
import { h } from './dom';

/** 창 한 줄: 키(옮기지 않는 키 이름 — 여럿이면 그 차례)와 하는 일 */
export interface ShortcutRow {
  readonly keys: readonly string[];
  readonly label: string;
}

/** 묶음 하나: 제목과 줄 */
export interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

/** 창 제목·앱 설정 메뉴 항목 글(app.ts 메뉴 항목과 같은 글 — 171차 설정 「한 글자 단축키」의 낱말) */
export const SHORTCUTS_TITLE = '키보드 단축키';

const ARROWS = ['←', '→', '↑', '↓'];
/** 축 잠금 줄(측정 화살표·가상 커서 X·Y·Z — 같은 하는 일) */
const AXIS_LOCK = 'X·Y·Z축 방향 잠그기(다시 누르면 풀기)';
/** 지금 방향 잠금 줄(측정 ↓·가상 커서 L — 측정 띠 잠금 버튼 풍선 글) */
const NOW_LOCK = '지금 방향 잠그기(다시 누르면 풀기)';

/** 앱이 받는 키(묶음마다). 같은 키가 문맥(문서 종류·측정 중·가상 커서)에 따라 여러 묶음에 나온다 */
export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: '보기 도구',
    rows: [
      { keys: ['F'], label: '전체 보기' },
      { keys: ['1~7'], label: '표준 뷰' },
      { keys: ['F7'], label: '격자' },
    ],
  },
  {
    title: '재생',
    rows: [
      { keys: ['Space'], label: '재생/멈춤' },
      { keys: ['→', '←'], label: '다음 이동 · 이전 이동' },
      { keys: ['Shift+→', 'Shift+←'], label: '다음·이전 이동(10개씩)' },
      // 판재 깎기의 가공 하나씩 따라가기
      { keys: ['→', '←'], label: '다음 가공 · 이전 가공' },
    ],
  },
  {
    title: '코드',
    rows: [
      { keys: ['↓', '↑'], label: '다음 줄 · 이전 줄' },
      { keys: ['Ctrl/⌘+F'], label: '코드에서 찾기' },
      { keys: ['Ctrl/⌘+G'], label: '다음 찾기' },
    ],
  },
  {
    title: '측정',
    rows: [
      { keys: ['Shift'], label: '측정 중 방향 잠금' },
      { keys: ['→', '←', '↑'], label: AXIS_LOCK },
      { keys: ['↓'], label: NOW_LOCK },
      { keys: ['Tab', 'Shift+Tab'], label: '마우스 커서 자리에 겹친 후보 돌리기' },
      { keys: ['Esc'], label: '찍은 점과 결과 지우기' },
    ],
  },
  {
    title: '가상 커서',
    rows: [
      { keys: ['Enter'], label: '가상 커서 켜기' },
      { keys: ARROWS, label: '커서 옮기기' },
      { keys: ARROWS.map((k) => `Shift+${k}`), label: '커서 크게 옮기기' },
      { keys: ['Tab', 'Shift+Tab'], label: '겹친 후보 돌리기' },
      { keys: ['Enter'], label: '고르거나 찍기' },
      { keys: ['Esc'], label: '가상 커서 끄기' },
      { keys: ['X', 'Y', 'Z'], label: AXIS_LOCK },
      { keys: ['L'], label: NOW_LOCK },
    ],
  },
  {
    title: '기타',
    rows: [
      { keys: ['Ctrl/⌘+O'], label: '파일 열기' },
      { keys: ['Esc'], label: '고른 것 지우기' },
      { keys: ['?'], label: SHORTCUTS_TITLE },
    ],
  },
];

/**
 * 끝 줄 안내: [글, 기기 갈래 class](SKP 143차 꼴 — 마우스 기기 fine-only, 손가락 기기 coarse-only, 빈 것은 둘 다).
 * 손가락 줄은 시작 화면 손가락 줄(app.ts buildStart)과 같은 글이다(같은 열쇠)
 */
export const SHORTCUT_NOTES: readonly (readonly [text: string, cls: string])[] = [
  ['가상 커서 키는 3D 보기를 누른 뒤 씁니다.', 'fine-only'],
  ['한 손가락 끌기 회전 · 두 손가락 이동·확대 · 측정 중 길게 누르면 정밀 조준', 'coarse-only'],
  ['입력 칸에 글을 넣는 동안에는 단축키가 듣지 않습니다.', ''],
];

let seq = 0;

/** 키보드 단축키 창을 parent 끝에 열고 닫기 함수를 돌려준다(닫으면 onClose 한 번 — 두 번 닫아도 한 번) */
export function openShortcutsDialog(parent: HTMLElement, onClose?: () => void): () => void {
  const opener = document.activeElement as HTMLElement | null;
  const id = `sc-title-${++seq}`;
  const shut = h('button', { class: 'btn small sc-close', type: 'button' }, '닫기');
  const kbd = (keys: readonly string[]): (Node | string)[] => keys.flatMap((k, i) => [...(i ? [' '] : []), h('kbd', { translate: 'no' }, k)]);
  const body = h(
    'div',
    { class: 'sc-body', role: 'region', 'aria-labelledby': id, tabindex: 0 },
    ...SHORTCUTS.flatMap((g) => [h('h3', {}, g.title), h('dl', {}, ...g.rows.flatMap((r) => [h('dt', {}, ...kbd(r.keys)), h('dd', {}, r.label)]))]),
    ...SHORTCUT_NOTES.map(([t, cls]) => h('p', { class: `sc-note ${cls}`.trim() }, t)),
  );
  // 상자 자신도 초점을 받을 수 있게(-1): 본문 글을 눌러도 초점이 상자 밖(문서)으로 빠지지 않는다
  const box = h('div', { class: 'sc-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: -1 }, h('div', { class: 'sc-head' }, h('h2', { id }, SHORTCUTS_TITLE), shut), body);
  const back = h('div', { class: 'sc-back' }, box);
  const made = [...parent.children].filter((el) => !el.hasAttribute('inert'));
  for (const el of made) el.setAttribute('inert', '');
  parent.append(back);
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    back.remove();
    for (const el of made) el.removeAttribute('inert');
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    onClose?.();
  };
  shut.addEventListener('click', close);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      (document.activeElement === shut ? body : shut).focus();
    }
  });
  let tap = false;
  back.addEventListener('pointerdown', (e) => {
    const out = !box.contains(e.target as Node);
    if (out && e.pointerType === 'mouse') close();
    tap = out && e.pointerType !== 'mouse';
  });
  back.addEventListener('click', (e) => {
    if (tap && !box.contains(e.target as Node)) close();
    tap = false;
  });
  shut.focus();
  return close;
}
