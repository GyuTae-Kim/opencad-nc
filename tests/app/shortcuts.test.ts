// @vitest-environment jsdom
/**
 * 205차(WCAG 2.1.1 도움 — 3.3.5 도움말): 키보드 단축키 창(src/app/shortcuts.ts — ? 키·앱 설정 메뉴 「키보드 단축키」로 열고, 창 글·그리기는 열 때 받는 조각).
 * 204차까지 NC의 키 도움말은 시작 화면 키 줄(문서를 열면 닫힘)·3D 보기 설명(KEY_HELP)·README 키 표뿐이라, 문서를 연 뒤에는 측정 잠금 키·가상 커서·코드 찾기 키를 앱 안에서 볼 곳이 없었다.
 * - 창 줄(SHORTCUTS)은 앱이 실제로 받는 키와 같다: keys.ts keyAction이 고르는 키(문맥을 모두 돌림)와 측정 조각 lockKeyOf 글자는 모두 창에 있고(새 키를 더하고 창에 넣지 않으면 실패),
 *   창의 키는 모두 앱·코어(VIEW_KEYS·F·Esc·Shift·가상 커서 KEY_SNAP_KEYS·Shift+화살표)·측정 조각이 받는 키다(옛 키가 남으면 실패).
 * - 상자: role=dialog·aria-modal·aria-labelledby, 열면 닫기 버튼에 초점, Tab·Shift+Tab은 닫기 버튼 ↔ 굴리는 본문(이름 있는 영역), Esc·닫기·바깥 누르기(마우스 pointerdown,
 *   손가락·펜은 그 탭의 click — SKP 140차)로 닫고 parent의 다른 자식 inert(이미 inert였던 것은 그대로 — SKP 165차)를 푼 뒤 연 곳에 초점. 키는 <kbd translate="no">, 끝 줄 안내는 기기 갈래(SKP 143차).
 * - 앱: ? 키(문서 없이도 — 시작 화면)·설정 메뉴 항목으로 열고, 받는 동안 두 번 열지 않으며, 상자 안의 키는 앱 키가 고르지 않는다(SKP 160차 — Ctrl+O 열기 등).
 *   171차 설정 「3D 보기 밖에서도 한 글자 단축키」를 끄면 ?도 3D 보기에 초점이 있을 때만(WCAG 2.1.4 — 메뉴 항목은 늘 됨).
 * - 창 글은 이미 있는 원문(시작 화면 키 줄·KEY_HELP·코어 가상 커서 안내·측정 띠 버튼)과 같은 낱말이고, 네 언어 값도 같은 사전의 그 낱말을 쓴다.
 * - (ㄴ) 가상 커서가 켜진 동안의 잠금 안내(CURSOR_LOCK_HINT)는 측정 잠금 글자(lockKeyOf — 204차 L 포함)를 모두 적는다.
 * 창 조각은 정적 가져오기로 미리 받아 둔다(앱의 `void import('./shortcuts')`가 시험이 끝난 뒤 모듈을 평가하지 않게 — ci-guard 5번).
 * 206차: (ㄱ) 열린 메뉴 항목에서 ?로 열면 창이 받는 초점에 메뉴가 닫혀 연 항목이 숨어, 닫을 때 초점이 문서로 빠졌다(WCAG 2.4.3) — 메뉴 항목 누름과 같게 메뉴 버튼으로.
 *   (ㄴ) 창이 열린 동안 뜬 알림 상자(body 쪽 — 창의 inert 밖이라 읽힘)가 덮개 밑에 가려 보는 사람만 못 봤다(1.3.2·4.1.3) — 덮개를 알림 상자 밑으로, 열린 동안 알림은 누르기를 덮개로.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_SNAP_KEYS } from 'opencad-viewer3d';
import { VIEW_KEYS } from 'opencad-viewer3d/camera';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
  }
  return { FakeViewer };
});
vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));

import { catalogs, translate } from '../../site/i18n.mjs';
import { NcViewerApp } from '../../src/app/app';
import { toast, toastArea } from '../../src/app/dom';
import { keyAction, type KeyContext } from '../../src/app/keys';
import { KEY_HELP } from '../../src/app/keysnap';
import { CURSOR_LOCK_HINT, lockHint, lockKeyOf } from '../../src/app/measure-lock';
import { SHORTCUTS, SHORTCUT_NOTES, SHORTCUTS_TITLE, openShortcutsDialog } from '../../src/app/shortcuts';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const dict = (lang: string): Record<string, string> => catalogs[lang] as Record<string, string>;
const HANGUL = /[가-힣]/;
/** 시작 화면 키 줄(app.ts buildStart — 키 이름 + 기능) */
const KEYS_LINE = '키: F 전체 보기 · 1~7 표준 뷰 · F7 격자 · Space 재생/멈춤 · Enter 가상 커서 · Esc 고른 것 지우기 · Shift 측정 중 방향 잠금 · Ctrl+O 열기';
/** 시작 화면 손가락 기기 줄(같은 열쇠 — 창 끝 줄 손가락 안내) */
const TOUCH_LINE = '한 손가락 끌기 회전 · 두 손가락 이동·확대 · 측정 중 길게 누르면 정밀 조준';

/** 창의 키 글 → 키 꼴('ctrl+o'·'shift+ArrowRight'·'f'·'?' — 글자는 작은 글자, Ctrl/⌘는 둘 다, 1~7은 펼침) */
const NAMED: Record<string, string> = { '→': 'ArrowRight', '←': 'ArrowLeft', '↑': 'ArrowUp', '↓': 'ArrowDown', Space: ' ', Esc: 'Escape' };
function combos(label: string): string[] {
  const range = /^(\d)~(\d)$/.exec(label);
  if (range) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => String(Number(range[1]) + i));
  const parts = label.split('+');
  const last = parts.pop()!;
  const key = NAMED[last] ?? (last.length === 1 ? last.toLowerCase() : last);
  const shift = parts.includes('Shift') ? 'shift+' : '';
  return parts.includes('Ctrl/⌘') ? [`ctrl+${shift}${key}`, `meta+${shift}${key}`] : [`${shift}${key}`];
}

/** keys.ts keyAction이 앱 할 일로 고르는 키 꼴 전부(코어로 넘기는 viewer는 뺀다 — 아래 코어 키): 키 × 수정 키 × 문맥 여덟 켜고 끄기(256) */
function appKeys(): Set<string> {
  const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
  const named = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Escape', 'Enter', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace', 'Insert', 'Shift', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)];
  const flags = ['hasDoc', 'canPlay', 'canStepOps', 'measureDirecting', 'onCanvas', 'inCode', 'hasCode', 'keyCursor'] as const;
  const out = new Set<string>();
  for (let m = 0; m < 1 << flags.length; m++) {
    const ctx: KeyContext = { key: '', ctrl: false, meta: false, alt: false, editable: false, onButton: false, onCanvas: false, hasDoc: false, canPlay: false, arrowOwner: false, charKeysOff: false };
    flags.forEach((f, i) => (ctx[f] = !!(m & (1 << i))));
    for (const key of [...printable, ...named])
      for (const mod of ['', 'ctrl', 'meta', 'alt', 'shift'] as const) {
        // 글자 키의 Shift는 적힌 글자(?·대문자)로 온다
        if (mod === 'shift' && key.length === 1) continue;
        const c: KeyContext = { ...ctx, key, ctrl: mod === 'ctrl', meta: mod === 'meta', alt: mod === 'alt', shift: mod === 'shift' };
        const a = keyAction(c);
        if (!a || a.type === 'viewer') continue;
        // Shift가 할 일을 바꾸는 키만 shift+ 꼴(← → 10개씩), 같으면 Shift 없는 꼴
        const same = mod === 'shift' && JSON.stringify(keyAction({ ...c, shift: false })) === JSON.stringify(a);
        out.add(`${mod && !same ? `${mod}+` : ''}${key.length === 1 ? key.toLowerCase() : key}`);
      }
  }
  return out;
}

/** 코어가 받는 키: 보기 키(F·VIEW_KEYS — handleKey), Esc(측정 지우기·돌리기 풀기), Shift(방향 잠금), Tab·Shift+Tab(마우스 스냅 돌리기), 가상 커서 KEY_SNAP_KEYS와 Shift+화살표(크게 — 코어 keySnapAction SHIFT_OK) */
function coreKeys(): Set<string> {
  const out = new Set<string>(['f', ...Object.keys(VIEW_KEYS), 'Escape', 'Shift', 'Tab', 'shift+Tab']);
  for (const ks of Object.values(KEY_SNAP_KEYS)) for (const k of ks) out.add(k.replace(/^Shift\+/, 'shift+'));
  for (const k of [...KEY_SNAP_KEYS.left, ...KEY_SNAP_KEYS.right, ...KEY_SNAP_KEYS.up, ...KEY_SNAP_KEYS.down]) out.add(`shift+${k}`);
  return out;
}

/** 측정 조각이 받는 글자(가상 커서가 켜진 동안 — lockKeyOf) */
const lockLetters = (): string[] => [...'abcdefghijklmnopqrstuvwxyz'].filter((c) => lockKeyOf({ key: c }) !== null);

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean): Promise<void> => {
  const end = Date.now() + 5000;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await tick();
  }
};
const keydown = (el: EventTarget, key: string, o: KeyboardEventInit = {}): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o });
  el.dispatchEvent(ev);
  return ev;
};
/** PointerEvent가 없는 jsdom: MouseEvent에 pointerType을 덧붙인다 */
const pointer = (el: Element, type: string, pointerType: string): void => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  el.dispatchEvent(ev);
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('205차: 키보드 단축키 창의 줄은 앱이 실제로 받는 키와 같다', () => {
  it('keys.ts가 고르는 키·측정 잠금 글자는 모두 창에 있고, 창의 키는 모두 앱·코어·측정 조각이 받는다', () => {
    const shown = new Set(SHORTCUTS.flatMap((g) => g.rows.flatMap((r) => r.keys.flatMap(combos))));
    const app = appKeys();
    const core = coreKeys();
    const lock = lockLetters();
    // 훑기 자체가 비지 않았다: 지금 앱 키(Space·? ·화살표·Esc·F7·Ctrl/⌘+O·F·G, Shift+← → 10개씩)
    expect([...app].sort()).toEqual([' ', '?', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Escape', 'F7', 'ctrl+f', 'ctrl+g', 'ctrl+o', 'meta+f', 'meta+g', 'meta+o', 'shift+ArrowLeft', 'shift+ArrowRight']);
    expect(lock).toEqual(['l', 'x', 'y', 'z']);
    // 새 키를 더하고 창에 넣지 않으면 여기서 실패
    expect([...app].filter((k) => !shown.has(k)).sort()).toEqual([]);
    expect(lock.filter((k) => !shown.has(k))).toEqual([]);
    expect([...core].filter((k) => !shown.has(k)).sort()).toEqual([]);
    // 받지 않는 키가 창에 남으면 여기서 실패
    expect([...shown].filter((k) => !app.has(k) && !core.has(k) && !lock.includes(k)).sort()).toEqual([]);
    // 줄마다 키와 하는 일이 있다
    for (const g of SHORTCUTS) {
      expect(g.title).toMatch(HANGUL);
      for (const r of g.rows) {
        expect(r.keys.length, r.label).toBeGreaterThan(0);
        expect(r.label).toMatch(HANGUL);
        for (const k of r.keys) expect(k, r.label).not.toMatch(HANGUL);
      }
    }
  });

  it('?는 키보드 단축키 창 — 문서가 없어도(시작 화면), 입력 칸·수정 키에서는 아님, 171차 설정을 끄면 3D 보기에서만', () => {
    const base: KeyContext = { key: '?', ctrl: false, meta: false, alt: false, editable: false, onButton: false, onCanvas: false, hasDoc: false, canPlay: false };
    expect(keyAction(base)).toEqual({ type: 'shortcuts' });
    expect(keyAction({ ...base, hasDoc: true, onButton: true })).toEqual({ type: 'shortcuts' });
    expect(keyAction({ ...base, onCanvas: true, hasDoc: true })).toEqual({ type: 'shortcuts' });
    expect(keyAction({ ...base, editable: true })).toBeNull();
    expect(keyAction({ ...base, ctrl: true })).toBeNull();
    expect(keyAction({ ...base, alt: true })).toBeNull();
    expect(keyAction({ ...base, charKeysOff: true })).toBeNull();
    expect(keyAction({ ...base, charKeysOff: true, onCanvas: true, hasDoc: true })).toEqual({ type: 'shortcuts' });
  });

  it('(ㄴ) 가상 커서가 켜진 동안의 잠금 안내는 측정 잠금 글자를 모두 적는다(204차 L — 3D 보기 설명 KEY_HELP와 같은 낱말)', () => {
    expect(lockHint(1, false, null, false, null, true)).toBe(CURSOR_LOCK_HINT);
    expect(CURSOR_LOCK_HINT).toBe('X·Y·Z로 축 방향, L로 지금 방향 잠금');
    for (const c of lockLetters()) expect(CURSOR_LOCK_HINT, c).toContain(c.toUpperCase());
    expect(KEY_HELP).toContain('X·Y·Z로 축 방향을, L로 지금 방향을 잠급니다');
  });
});

describe('205차: 키보드 단축키 창(상자)', () => {
  /** parent 안에 버튼(연 곳)·이미 inert인 칸·다른 칸을 두고 연다 */
  const mount = () => {
    const parent = document.createElement('div');
    const opener = document.createElement('button');
    const a = document.createElement('div');
    a.append(opener);
    const b = document.createElement('div');
    b.setAttribute('inert', '');
    const c = document.createElement('div');
    parent.append(a, b, c);
    document.body.append(parent);
    opener.focus();
    const onClose = vi.fn();
    const close = openShortcutsDialog(parent, onClose);
    const dlg = parent.querySelector<HTMLElement>('[role="dialog"]')!;
    return { parent, opener, a, b, c, onClose, close, dlg };
  };

  it('이름 있는 모달 상자 — 닫기 버튼에 초점, Tab은 닫기 버튼 ↔ 굴리는 본문, 다른 자식 inert(이미 inert는 그대로), Esc로 닫으면 inert를 풀고 연 곳으로', () => {
    const { parent, opener, a, b, c, onClose, close, dlg } = mount();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dlg.getAttribute('aria-labelledby')!)!;
    expect(title.textContent).toBe(SHORTCUTS_TITLE);
    expect(SHORTCUTS_TITLE).toBe('키보드 단축키');
    const shut = dlg.querySelector<HTMLButtonElement>('button')!;
    expect(shut.textContent).toBe('닫기');
    expect(document.activeElement).toBe(shut);
    const region = dlg.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.getAttribute('aria-labelledby')).toBe(title.id);
    expect(region.tabIndex).toBe(0);
    // 묶음 제목·줄(키는 옮기지 않는 kbd)·끝 줄 안내(마우스·손가락·둘 다)
    expect([...region.querySelectorAll('h3')].map((e) => e.textContent)).toEqual(SHORTCUTS.map((g) => g.title));
    expect([...region.querySelectorAll('dd')].map((e) => e.textContent)).toEqual(SHORTCUTS.flatMap((g) => g.rows.map((r) => r.label)));
    const kbd = [...region.querySelectorAll('kbd')];
    expect(kbd.map((e) => e.textContent)).toEqual(SHORTCUTS.flatMap((g) => g.rows.flatMap((r) => r.keys)));
    expect(kbd.every((e) => e.getAttribute('translate') === 'no')).toBe(true);
    expect([...region.querySelectorAll('p')].map((e) => [e.className, e.textContent])).toEqual(SHORTCUT_NOTES.map(([t, cls]) => [`sc-note${cls ? ` ${cls}` : ''}`, t]));
    expect(SHORTCUT_NOTES.map(([, cls]) => cls)).toEqual(['fine-only', 'coarse-only', '']);
    // inert: 다른 자식만(상자 자신은 아님), 이미 inert였던 것은 그대로
    expect([a, b, c].map((e) => e.hasAttribute('inert'))).toEqual([true, true, true]);
    expect(parent.lastElementChild!.contains(dlg)).toBe(true);
    expect(parent.lastElementChild!.hasAttribute('inert')).toBe(false);
    // Tab·Shift+Tab: 닫기 버튼 ↔ 본문(상자 밖으로 나가지 않음)
    expect(keydown(shut, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(region);
    keydown(region, 'Tab');
    expect(document.activeElement).toBe(shut);
    keydown(shut, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(region);
    keydown(region, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(shut);
    // Esc: 닫고 inert를 푼 뒤 연 곳으로(이미 inert였던 칸은 그대로)
    expect(keydown(shut, 'Escape').defaultPrevented).toBe(true);
    expect(parent.querySelector('[role="dialog"]')).toBeNull();
    expect([a, b, c].map((e) => e.hasAttribute('inert'))).toEqual([false, true, false]);
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(1);
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('바깥 누르기: 마우스는 pointerdown에서 닫고, 손가락·펜은 그 탭의 click에서 닫는다(안에서 누르고 바깥에서 뗀 click은 닫지 않음). 닫기 버튼도 닫는다', () => {
    let m = mount();
    const back = (): HTMLElement => m.parent.lastElementChild as HTMLElement;
    pointer(back(), 'pointerdown', 'mouse');
    expect(m.parent.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(m.opener);
    document.body.innerHTML = '';
    // 손가락: 누를 때는 그대로(떼면 click이 밑의 버튼을 누른다 — SKP 140차), 그 탭의 click에서 닫음
    m = mount();
    pointer(back(), 'pointerdown', 'touch');
    expect(m.parent.querySelector('[role="dialog"]')).not.toBeNull();
    back().click();
    expect(m.parent.querySelector('[role="dialog"]')).toBeNull();
    document.body.innerHTML = '';
    // 펜도 같다. 상자 안에서 누르고 바깥에서 뗀 click은 닫지 않는다
    m = mount();
    pointer(back(), 'pointerdown', 'pen');
    expect(m.parent.querySelector('[role="dialog"]')).not.toBeNull();
    pointer(m.dlg, 'pointerdown', 'mouse');
    back().click();
    expect(m.parent.querySelector('[role="dialog"]')).not.toBeNull();
    m.dlg.querySelector('h2')!.click();
    expect(m.parent.querySelector('[role="dialog"]')).not.toBeNull();
    m.dlg.querySelector<HTMLButtonElement>('button')!.click();
    expect(m.parent.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(m.opener);
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });

  it('창 글은 이미 있는 원문(키 줄·KEY_HELP·코어 가상 커서 안내)의 낱말이고 네 언어 값도 같은 사전의 그 낱말 — 한글 0, 키 이름은 옮기지 않음', () => {
    const labels = new Map(SHORTCUTS.flatMap((g) => g.rows.map((r) => [r.label, r.keys] as const)));
    // 키 줄의 「키 이름 + 기능」(한 기능 한 낱말 — 194·195·204차)
    for (const [key, label] of [['F', '전체 보기'], ['1~7', '표준 뷰'], ['F7', '격자'], ['Space', '재생/멈춤'], ['Esc', '고른 것 지우기'], ['Shift', '측정 중 방향 잠금']] as const) {
      expect(KEYS_LINE, label).toContain(`${key} ${label}`);
      expect(labels.get(label), label).toContain(key);
    }
    expect(SHORTCUTS.map((g) => g.title)).toContain('가상 커서');
    expect(KEYS_LINE).toContain('Enter 가상 커서');
    expect(SHORTCUT_NOTES[1]![0]).toBe(TOUCH_LINE);
    // [창 글, 근거 열쇠, 언어마다 둘 다에 든 낱말(대소문자 무시)]
    const basis: [string, string, Record<(typeof LANGS)[number], string>][] = [
      ['재생/멈춤', KEYS_LINE, { en: 'Play/Pause', ja: '再生/一時停止', 'zh-CN': '播放/暂停', de: 'Wiedergabe/Pause' }],
      ['고른 것 지우기', KEYS_LINE, { en: 'Deselect', ja: '選択解除', 'zh-CN': '清除所选', de: 'Auswahl löschen' }],
      ['측정 중 방향 잠금', KEYS_LINE, { en: 'Direction lock while measuring', ja: '測定中の方向ロック', 'zh-CN': '测量时方向锁定', de: 'Richtungssperre beim Messen' }],
      ['가상 커서', KEYS_LINE, { en: 'Virtual cursor', ja: '仮想カーソル', 'zh-CN': '虚拟光标', de: 'Virtueller Cursor' }],
      ['겹친 후보 돌리기', KEY_HELP, { en: 'overlapping candidates', ja: '重なった候補を切り替え', 'zh-CN': '切换重叠的候选', de: 'überlappende Kandidaten' }],
      ['마우스 커서 자리에 겹친 후보 돌리기', KEY_HELP, { en: 'candidates overlapping at the mouse pointer', ja: 'マウスポインターの位置で重なった候補', 'zh-CN': '鼠标指针处重叠的候选', de: 'am Mauszeiger überlappende' }],
      ['고르거나 찍기', KEY_HELP, { en: 'select', ja: '選ぶか点を打', 'zh-CN': '选择或选点', de: 'Punkt' }],
      ['가상 커서 켜기', KEY_HELP, { en: 'virtual cursor', ja: '仮想カーソルをオン', 'zh-CN': '打开虚拟光标', de: 'virtuelle' }],
      ['가상 커서 끄기', '가상 커서를 껐습니다', { en: 'virtual cursor', ja: '仮想カーソルをオフ', 'zh-CN': '关闭虚拟光标', de: 'virtuelle' }],
      ['가상 커서 끄기', '[가상 커서 알림] 끄기 {0}', { en: 'Turn off', ja: 'オフ', 'zh-CN': '关闭', de: 'ausschalten' }],
      ['커서 옮기기', '[가상 커서 알림] 옮기기 {0}', { en: 'Move', ja: '移動', 'zh-CN': '移动', de: 'bewegen' }],
      ['커서 크게 옮기기', '[가상 커서 알림] 옮기기 {0}', { en: 'Move', ja: '移動', 'zh-CN': '移动', de: 'bewegen' }],
      ['다음 찾기', '다음 찾기 (Enter)', { en: 'Find next', ja: '次を検索', 'zh-CN': '查找下一个', de: 'Nächstes suchen' }],
      ['다음·이전 이동(10개씩)', '다음 이동', { en: 'move', ja: '移動', 'zh-CN': '移动', de: 'Bewegung' }],
      ['다음 줄 · 이전 줄', '고른 줄까지 그리기', { en: 'line', ja: '行', 'zh-CN': '行', de: 'Zeile' }],
      ['X·Y·Z축 방향 잠그기(다시 누르면 풀기)', '지금 방향 잠그기(다시 누르면 풀기)', { en: '(press again to unlock)', ja: '（もう一度押すと解除）', 'zh-CN': '（再按一次解除）', de: '(erneut drücken zum Entsperren)' }],
      ['X·Y·Z축 방향 잠그기(다시 누르면 풀기)', 'Shift로 X축 방향 잠그기', { en: 'axis', ja: '軸方向にロック', 'zh-CN': '锁定为', de: '-Richtung' }],
      [SHORTCUTS_TITLE, '3D 보기 밖에서도 한 글자 단축키(F·1~7·?)', { en: 'shortcuts', ja: 'ショートカット', 'zh-CN': '快捷键', de: 'Tastenkürzel' }],
      [SHORTCUT_NOTES[2]![0], '3D 보기 밖에서도 한 글자 단축키(F·1~7·?)', { en: 'shortcuts', ja: 'ショートカット', 'zh-CN': '快捷键', de: 'Tastenkürzel' }],
      [SHORTCUT_NOTES[0]![0], '3D 보기', { en: '3D view', ja: '3Dビュー', 'zh-CN': '3D视图', de: '3D-Ansicht' }],
    ];
    for (const lang of LANGS)
      for (const [ko, base, word] of basis) {
        const low = (s: string | undefined): string => (s ?? '').toLowerCase();
        expect(low(dict(lang)[ko]), `${lang}: ${ko}`).toContain(low(word[lang]));
        expect(low(dict(lang)[base]), `${lang}: ${base}`).toContain(low(word[lang]));
      }
    // 창 글 모두(제목·묶음·줄·끝 줄) 네 언어에 한글 0, 키 글은 한글이 없어 옮기지 않는다
    const texts = [SHORTCUTS_TITLE, '닫기', ...SHORTCUTS.flatMap((g) => [g.title, ...g.rows.map((r) => r.label)]), ...SHORTCUT_NOTES.map(([t]) => t)];
    for (const lang of LANGS) for (const t of texts) expect(translate(t, lang), `${lang}: ${t}`).not.toMatch(HANGUL);
  });
});

describe('205차: 앱에서 키보드 단축키 창 열기(? 키·설정 메뉴)', () => {
  it('? 키는 문서 없이도 열고(받는 동안 두 번 열지 않음), 상자 안의 키는 앱 키가 고르지 않으며, 설정 메뉴 항목으로도 열고 닫으면 연 곳으로 — 171차 설정을 끄면 ?는 3D 보기에서만', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const app = new NcViewerApp(root);
    const choose = vi.spyOn(app as unknown as { chooseFile(): void }, 'chooseFile').mockImplementation(() => {});
    const dialogs = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')];
    // 시작 화면 키 줄·손가락 줄이 창 시험의 원문과 같다
    expect(root.querySelector('.start .keys.fine-only')!.textContent).toBe(KEYS_LINE);
    expect(root.querySelector('.start .keys.coarse-only')!.textContent).toBe(TOUCH_LINE);
    // ? (body — 초점 없음): 막고 연다. 받는 동안 한 번 더 눌러도 하나
    expect(keydown(document.body, '?', { shiftKey: true }).defaultPrevented).toBe(true);
    keydown(document.body, '?', { shiftKey: true });
    await until(() => dialogs().length > 0);
    await tick();
    expect(dialogs()).toHaveLength(1);
    const shut = dialogs()[0]!.querySelector<HTMLButtonElement>('button')!;
    expect(document.activeElement).toBe(shut);
    // 앱의 다른 칸은 inert(상자를 담은 칸 빼고)
    expect([...root.children].filter((e) => !e.contains(shut)).every((e) => e.hasAttribute('inert'))).toBe(true);
    // 상자 안의 키는 상자 몫: Ctrl+O(앱 열기)·?를 앱이 고르지 않는다
    expect(keydown(shut, 'o', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(choose).not.toHaveBeenCalled();
    keydown(shut, '?', { shiftKey: true });
    await tick();
    expect(dialogs()).toHaveLength(1);
    // Esc: 닫고 inert를 푼다(연 곳은 초점 없는 body)
    keydown(shut, 'Escape');
    expect(dialogs()).toHaveLength(0);
    expect([...root.children].some((e) => e.hasAttribute('inert'))).toBe(false);
    // 닫은 뒤에는 앱 키 그대로
    expect(keydown(document.body, 'o', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(choose).toHaveBeenCalledTimes(1);

    // 앱 설정 메뉴: 「3D 보기 밖에서도 한 글자 단축키(F·1~7·?)」 바로 뒤 「키보드 단축키」(kbd ?)
    const settings = root.querySelector<HTMLButtonElement>('.titlebar button[aria-label="앱 설정"]')!;
    const items = (): HTMLButtonElement[] => [...settings.parentElement!.querySelectorAll<HTMLButtonElement>('.menu button')];
    settings.click();
    const names = items().map((b) => b.textContent);
    const at = names.indexOf('3D 보기 밖에서도 한 글자 단축키(F·1~7·?)');
    expect(at).toBeGreaterThanOrEqual(0);
    const item = items()[at + 1]!;
    expect([item.getAttribute('role'), item.querySelector('span')!.textContent, item.querySelector('kbd')!.textContent, item.querySelector('kbd')!.getAttribute('translate')]).toEqual(['menuitem', SHORTCUTS_TITLE, '?', 'no']);
    item.click();
    await until(() => dialogs().length > 0);
    expect(document.activeElement).toBe(dialogs()[0]!.querySelector('button'));
    dialogs()[0]!.querySelector<HTMLButtonElement>('button')!.click();
    expect(dialogs()).toHaveLength(0);
    // 연 곳(메뉴를 닫으며 초점을 받은 설정 버튼)으로
    expect(document.activeElement).toBe(settings);

    // 171차 설정을 끄면 ?는 3D 보기 밖에서 듣지 않는다(메뉴 항목은 그대로 연다)
    settings.click();
    items()[at]!.click();
    expect(items()[at]!.getAttribute('aria-checked')).toBe('false');
    expect(keydown(document.body, '?', { shiftKey: true }).defaultPrevented).toBe(false);
    for (let i = 0; i < 10; i++) await tick();
    expect(dialogs()).toHaveLength(0);
    settings.click();
    items()[at + 1]!.click();
    await until(() => dialogs().length > 0);
    keydown(dialogs()[0]!.querySelector('button')!, 'Escape');
    expect(dialogs()).toHaveLength(0);
    settings.click();
    items()[at]!.click();
    expect(items()[at]!.getAttribute('aria-checked')).toBe('true');
  });
});

/** CSS 글의 z-index 규칙(주석 뺌 — @media 안 규칙도): 선택자·값. jsdom은 CSS를 그리지 않아 글로 본다(148차 꼴) */
const cssRules = (file: string): { sel: string; body: string }[] =>
  [...readFileSync(join(__dirname, '../..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const zRules = (file: string): { sel: string; z: number }[] =>
  cssRules(file).flatMap((r) => {
    const z = /z-index:\s*(\d+)/.exec(r.body);
    return z ? [{ sel: r.sel, z: Number(z[1]) }] : [];
  });

describe('206차: 키보드 단축키 창을 닫은 뒤 초점·창이 열린 동안의 알림 상자', () => {
  const mountApp = (): { root: HTMLElement; dialogs: () => HTMLElement[] } => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    return { root, dialogs: () => [...root.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')] };
  };

  it('(ㄱ) 열린 메뉴 항목에서 ?로 열면 메뉴 항목 누름과 같게 메뉴를 닫고 메뉴 버튼에서 열어, 닫으면 메뉴 버튼으로(숨은 항목이 아님) — 시작 화면에서 연 길은 그대로 연 곳으로', async () => {
    const { root, dialogs } = mountApp();
    // 시작 화면 열기 칸에서 연 길: 닫으면 그 칸
    const zone = root.querySelector<HTMLElement>('.start .dropzone')!;
    zone.focus();
    expect(keydown(zone, '?', { shiftKey: true }).defaultPrevented).toBe(true);
    await until(() => dialogs().length > 0);
    keydown(document.activeElement!, 'Escape');
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(zone);
    // 열린 설정 메뉴: 메뉴를 열면 첫 항목에 초점
    const settings = root.querySelector<HTMLButtonElement>('.titlebar button[aria-label="앱 설정"]')!;
    const list = settings.parentElement!.querySelector<HTMLElement>('.menu')!;
    settings.click();
    const item = document.activeElement as HTMLElement;
    expect([list.hidden, list.contains(item)]).toEqual([false, true]);
    // 메뉴 항목에서 ?: 앱이 받아 막고, 메뉴를 닫고 메뉴 버튼에 초점을 둔 뒤 연다(창 닫기 버튼이 받는 초점에 메뉴가 닫혀 연 항목이 숨지 않게)
    expect(keydown(item, '?', { shiftKey: true }).defaultPrevented).toBe(true);
    expect([list.hidden, settings.getAttribute('aria-expanded'), document.activeElement]).toEqual([true, 'false', settings]);
    await until(() => dialogs().length > 0);
    expect(document.activeElement).toBe(dialogs()[0]!.querySelector('button'));
    keydown(document.activeElement!, 'Escape');
    expect(dialogs()).toHaveLength(0);
    // 닫으면 메뉴 버튼(연 곳의 주인) — 숨은 칸이 아니다
    expect(document.activeElement).toBe(settings);
    expect(document.activeElement!.closest('[hidden]')).toBeNull();
    expect(list.hidden).toBe(true);
  });

  it('(ㄴ) 창이 열린 동안 뜬 알림 상자는 창의 inert 밖(body 쪽 — 읽힘)이고 덮개 위에 보이며(z-index), 열린 동안은 누르기를 덮개로 넘긴다', async () => {
    const { root, dialogs } = mountApp();
    keydown(document.body, '?', { shiftKey: true });
    await until(() => dialogs().length > 0);
    // 창이 열린 동안 뜬 오류(앱의 알림은 모두 dom.ts toast — 같은 알림 상자)
    toast('최근 문서를 지우지 못했습니다. 잠시 뒤 다시 해 보십시오.', 'error', 30);
    const area = toastArea();
    const el = area.lastElementChild as HTMLElement;
    expect([el.className, el.getAttribute('role'), el.firstChild?.textContent]).toEqual(['toast error', 'alert', '최근 문서를 지우지 못했습니다. 잠시 뒤 다시 해 보십시오.']);
    // 창 덮개는 #app 안, 알림 상자는 body의 다른 자식 — 창이 inert로 두는 #app 자식 밖이라 화면 읽기 프로그램에 읽힌다(aria-live)
    const back = dialogs()[0]!.parentElement!;
    expect([back.className, back.parentElement === root]).toEqual(['sc-back', true]);
    expect([area.parentElement === document.body, root.contains(area), !!area.closest('[inert]'), area.getAttribute('aria-live')]).toEqual([true, false, false, 'polite']);
    expect([...root.children].filter((c) => c !== back).every((c) => c.hasAttribute('inert'))).toBe(true);
    // 보임: 덮개(shortcuts.css .sc-back)는 알림 상자(styles.css .toasts)보다 아래, 앱의 다른 층(끌어 놓기·읽는 중 덮개·메뉴 등)보다 위 — 언어 고르기만 제 층으로 위
    const dlg = zRules('src/app/shortcuts.css').find((r) => r.sel === '.sc-back')!.z;
    const app = zRules('src/app/styles.css');
    const toasts = app.find((r) => r.sel === '.toasts')!.z;
    expect(dlg).toBeLessThan(toasts);
    expect(app.filter((r) => r.sel !== '.toasts' && !r.sel.includes('language') && r.z >= dlg)).toEqual([]);
    // 열린 동안 알림은 누르기를 받지 않는다(누르면 밑의 덮개가 받아 바깥 누르기로 닫음 — 모달 밖 칸은 입력을 받지 않음). 알림 버튼은 따로 두지 않아 물려받는다
    expect(cssRules('src/app/shortcuts.css').find((r) => r.sel === 'body:has(.sc-back) .toast')?.body).toMatch(/pointer-events:\s*none/);
    expect(cssRules('src/app/styles.css').filter((r) => /\.toast-(x|act)\b/.test(r.sel) && /pointer-events/.test(r.body))).toEqual([]);
    expect(cssRules('src/app/styles.css').find((r) => r.sel === '.toast')?.body).toMatch(/pointer-events:\s*auto/);
    // 알림은 제 시간에 진다(창과 따로)
    await until(() => !el.isConnected);
    keydown(dialogs()[0]!.querySelector('button')!, 'Escape');
    expect(dialogs()).toHaveLength(0);
  });
});
