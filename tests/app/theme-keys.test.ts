import { describe, expect, it } from 'vitest';
import { THEME_KEY, otherTheme, readThemePref, resolveTheme, writeThemePref, type ThemeStorage } from '../../src/app/theme';
import { isEditableTarget, keyAction, type KeyContext } from '../../src/app/keys';

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

  it('캔버스 밖에서도 F·1~7·Esc가 뷰어로 간다', () => {
    expect(k('f')).toEqual({ type: 'fit' });
    expect(k('F')).toEqual({ type: 'fit' });
    expect(k('1')).toEqual({ type: 'view', view: 'front' });
    expect(k('5')).toEqual({ type: 'view', view: 'top' });
    expect(k('7')).toEqual({ type: 'view', view: 'seIso' });
    expect(k('8')).toBeNull();
    expect(k('Escape')).toEqual({ type: 'escape', canvas: false });
  });

  it('캔버스에 초점이 있으면 F·1~7은 뷰어가 직접 받는다', () => {
    expect(k('f', { onCanvas: true })).toBeNull();
    expect(k('3', { onCanvas: true })).toBeNull();
    expect(k('Escape', { onCanvas: true })).toEqual({ type: 'escape', canvas: true });
    expect(k('F7', { onCanvas: true })).toEqual({ type: 'grid' });
    expect(k(' ', { onCanvas: true })).toEqual({ type: 'play' });
  });

  it('F7 격자, Space 재생(단추 위·재생 못 할 때는 아님)', () => {
    expect(k('F7')).toEqual({ type: 'grid' });
    expect(k(' ')).toEqual({ type: 'play' });
    expect(k(' ', { onButton: true })).toBeNull();
    expect(k(' ', { canPlay: false })).toBeNull();
  });

  it('입력 칸·조합 키·문서 없음에서는 가로채지 않는다(Ctrl+O 열기만)', () => {
    expect(k('f', { editable: true })).toBeNull();
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
