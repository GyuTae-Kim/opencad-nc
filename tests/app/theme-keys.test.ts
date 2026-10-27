import { describe, expect, it } from 'vitest';
import { THEME_KEY, otherTheme, readThemePref, resolveTheme, writeThemePref, type ThemeStorage } from '../../src/app/theme';
import { VIEW_KEYS } from 'opencad-viewer3d';
import { VIEW_KEYS as APP_VIEW_KEYS, isEditableTarget, keyAction, viewKeyOf, type KeyContext } from '../../src/app/keys';

function memory(): ThemeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const broken: ThemeStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('테마', () => {
  it('기억한 선택이 없으면 시스템 설정을 따른다', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(otherTheme('light')).toBe('dark');
  });

  it('저장소에 기억하고 읽는다(이상한 값은 무시)', () => {
    const s = memory();
    expect(readThemePref(s)).toBeNull();
    expect(writeThemePref(s, 'light')).toBe(true);
    expect(s.data.get(THEME_KEY)).toBe('light');
    expect(readThemePref(s)).toBe('light');
    s.data.set(THEME_KEY, 'blue');
    expect(readThemePref(s)).toBeNull();
  });

  it('저장소가 없거나 예외를 던져도 넘어간다', () => {
    expect(readThemePref(null)).toBeNull();
    expect(writeThemePref(null, 'dark')).toBe(false);
    expect(readThemePref(broken)).toBeNull();
    expect(writeThemePref(broken, 'dark')).toBe(false);
  });
});

describe('키 고르기', () => {
  const base: KeyContext = { key: '', ctrl: false, meta: false, alt: false, editable: false, onButton: false, onCanvas: false, hasDoc: true, canPlay: true };
  const k = (key: string, more: Partial<KeyContext> = {}) => keyAction({ ...base, key, ...more });

  it('캔버스 밖의 키는 뷰어 규칙(handleKey)으로 넘기고, Esc는 앱이 먼저 본다', () => {
    expect(k('f')).toEqual({ type: 'viewer' });
    expect(k('F')).toEqual({ type: 'viewer' });
    expect(k('1')).toEqual({ type: 'viewer' });
    expect(k('7')).toEqual({ type: 'viewer' });
    // 뷰어가 받지 않는 키도 넘긴다(handleKey가 false를 돌려주면 앱은 아무것도 막지 않는다)
    expect(k('8')).toEqual({ type: 'viewer' });
    expect(k('Escape')).toEqual({ type: 'escape', canvas: false });
  });

  it('캔버스에 초점이 있으면 뷰어 키는 뷰어가 직접 받는다', () => {
    expect(k('f', { onCanvas: true })).toBeNull();
    expect(k('3', { onCanvas: true })).toBeNull();
    expect(k('Escape', { onCanvas: true })).toEqual({ type: 'escape', canvas: true });
    expect(k('F7', { onCanvas: true })).toEqual({ type: 'grid' });
    expect(k(' ', { onCanvas: true })).toEqual({ type: 'play' });
  });

  it('표준 뷰 메뉴의 키 글은 코어 VIEW_KEYS를 따른다(첫 화면용 앱 표가 코어 표와 같다)', () => {
    expect(APP_VIEW_KEYS).toEqual(VIEW_KEYS);
    for (const [key, view] of Object.entries(VIEW_KEYS)) expect(viewKeyOf(view)).toBe(key);
    expect(viewKeyOf('top')).toBe('5');
    expect(viewKeyOf('nwIso')).toBeUndefined();
  });

  it('← → 한 이동씩(Shift 10), ↑ ↓는 캔버스·코드 목록에서 줄, Ctrl/⌘+F·G 찾기', () => {
    expect(k('ArrowRight')).toEqual({ type: 'step', delta: 1 });
    expect(k('ArrowLeft', { shift: true })).toEqual({ type: 'step', delta: -10 });
    expect(k('ArrowRight', { canPlay: false })).toEqual({ type: 'viewer' });
    expect(k('ArrowRight', { editable: true })).toBeNull();
    expect(k('ArrowDown', { onCanvas: true })).toEqual({ type: 'line', delta: 1 });
    expect(k('ArrowUp', { inCode: true })).toEqual({ type: 'line', delta: -1 });
    expect(k('ArrowUp')).toEqual({ type: 'viewer' });
    expect(k('f', { ctrl: true, hasCode: true })).toEqual({ type: 'find', next: false });
    expect(k('g', { meta: true, hasCode: true })).toEqual({ type: 'find', next: true });
    expect(k('f', { ctrl: true, hasCode: false })).toBeNull();
  });

  it('F7 격자, Space 재생(단추 위·재생 못 할 때는 아님)', () => {
    expect(k('F7')).toEqual({ type: 'grid' });
    expect(k(' ')).toEqual({ type: 'play' });
    expect(k(' ', { onButton: true })).toBeNull();
    expect(k(' ', { canPlay: false })).toBeNull();
  });

  it('입력 칸·조합 키·문서 없음에서는 가로채지 않는다(Ctrl+O 열기만)', () => {
    expect(k('f', { editable: true })).toBeNull();
    expect(k('Escape', { editable: true })).toBeNull();
    expect(k(' ', { editable: true })).toBeNull();
    expect(k('f', { ctrl: true })).toBeNull();
    expect(k('1', { alt: true })).toBeNull();
    expect(k('f', { hasDoc: false })).toBeNull();
    expect(k('F7', { hasDoc: false })).toBeNull();
    expect(k('o', { ctrl: true, hasDoc: false })).toEqual({ type: 'open' });
    expect(k('O', { meta: true })).toEqual({ type: 'open' });
    expect(k('o', { ctrl: true, editable: true })).toBeNull();
  });

  it('입력 칸 가리기', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isEditableTarget({ tagName: 'input' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget({ tagName: 'CANVAS' })).toBe(false);
  });
});
