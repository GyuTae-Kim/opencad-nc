/**
 * 밝은·어두운 테마 고르기(순수 함수 + 저장소 감싸기).
 * 기본은 시스템 설정(prefers-color-scheme)을 따르고, 사용자가 단추로 고르면 localStorage에 기억한다.
 * 저장소는 사생활 보호 창·막힌 사이트 자료 등에서 없거나 예외를 던질 수 있어 늘 try/catch로 감싼다.
 */

export type ThemeName = 'light' | 'dark';

/** localStorage 열쇠 */
export const THEME_KEY = 'opencad-nc.theme';

/** getItem·setItem만 쓰는 저장소 꼴(시험에서 가짜를 넣는다) */
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** 창의 localStorage(접근이 막히면 null) */
export function safeStorage(): ThemeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 기억한 선택(없거나 못 읽으면 null) */
export function readThemePref(storage: ThemeStorage | null): ThemeName | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** 선택을 기억한다(실패해도 조용히 넘어간다). 기억했으면 true */
export function writeThemePref(storage: ThemeStorage | null, t: ThemeName): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_KEY, t);
    return true;
  } catch {
    return false;
  }
}

/** 기억한 선택이 있으면 그것, 없으면 시스템 설정 */
export function resolveTheme(pref: ThemeName | null, systemDark: boolean): ThemeName {
  return pref ?? (systemDark ? 'dark' : 'light');
}

/** 반대 테마 */
export function otherTheme(t: ThemeName): ThemeName {
  return t === 'dark' ? 'light' : 'dark';
}
