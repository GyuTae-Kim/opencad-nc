/**
 * 233차(WCAG 2.1.2 키보드 함정 없음): 키보드로 초점이 들어간 칸에서는 키보드만으로 나올 수 있어야 한다 — 보통 키(Tab·Shift+Tab, 대화 상자·메뉴·팝업은 Esc)로 나오거나,
 * 보통 키가 아니면 그 길을 안내에 알려 둔다. 감사 표는 .runtime/r233/progress.md 표 1과 같은 줄(실패 0 — 고친 것 없음, 이 파일은 셈만).
 * - 소스 글: src(.ts는 주석 줄 — //·*·/* 로 시작 — 뺌, .css는 덧글 덩이 뺌)에서 Tab을 가로채는 줄·초점 사건(blur·focusout·focusin) 줄·inert/aria-modal 줄은 모두
 *   판정과 함께 아래 표에 — 표 밖에 새로 생기거나 사라지면 판정과 함께 표를 고쳐야 통과한다(pointer-cancel232·hover-focus226·status-live231 소스 셈과 같은 꼴;
 *   app.ts의 `['pointerdown', 'focusin']` 줄은 pointer-cancel232 표와 같은 글).
 * - 3D 보기가 Tab을 받는 두 길(코어 가상 커서·마우스 Tab 돌리기 — node_modules 몫, 보고만)은 Esc로 나온다: 그 안내(캔버스 설명 KEY_HELP·단축키 창 줄)가 남아 있는지도 본다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** Tab을 견주는 키 처리(리드 grep 꼴 `key === 'Tab'|key == 'Tab'|'Tab'\)|case 'Tab'|!== 'Tab'` — 따옴표 셋) */
const TAB = /\b(?:key|code)\s*(?:===?|!==?)\s*(['"`])Tab\1|(['"`])Tab\2\s*\)|\bcase\s+(['"`])Tab\3/g;
/** 초점 사건 이름(따옴표 글)과 속성 꼴 */
const FOCUS = /(['"`])(blur|focusout|focusin)\1|\bon(blur|focusout|focusin)\b/gi;
/** inert·aria-modal·showModal(낱말 경계 — inertia 꼴은 셈 밖) */
const MODAL = /\binert\b|aria-modal|ariaModal|showModal/g;

type Judge = '통과' | '셈 밖';
interface Site {
  /** progress.md 표 1의 칸 이름 */
  readonly row: string;
  readonly file: string;
  /** 그 코드 줄(앞뒤 빈칸 뺌) */
  readonly line: string;
  readonly what: string;
  readonly judge: Judge;
}

const TAB_SITES: readonly Site[] = [
  { row: 'T1', file: 'src/app/app.ts', line: "if (ev.key === 'Tab') return close();", what: '펼침 메뉴 Tab·Shift+Tab — 닫기만(막지 않음, 다음 칸·메뉴 버튼으로)', judge: '통과' },
  {
    row: 'T2',
    file: 'src/app/measure-lock.ts',
    line: "if (!u || !v || !v.handleKey || !l || e.key !== 'Tab' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;",
    what: '같은 누름 첫 Shift+Tab — 원호 접선 잠금 풀고 코어 마우스 Tab 돌리기에(받지 않으면 초점 이동, 받으면 Esc로 돌리기 풀기)',
    judge: '통과',
  },
  { row: 'T3', file: 'src/app/shortcuts.ts', line: "} else if (e.key === 'Tab') {", what: '단축키 창(모달) 안 돌기 — Esc·닫기 버튼·바깥 누르기로 나옴', judge: '통과' },
];

const FOCUS_SITES: readonly Site[] = [
  { row: 'F1', file: 'src/app/app.ts', line: "window.addEventListener('blur', () => {", what: '창 흐려짐에 Shift 원호 잠금 풀기(초점 가져오지 않음)', judge: '통과' },
  { row: 'F2', file: 'src/app/app.ts', line: "for (const type of ['pointerdown', 'focusin'] as const)", what: '초점이 펼친 메뉴·단면 상자 밖이면 닫기(초점 옮기지 않음)', judge: '통과' },
  { row: 'F3', file: 'src/app/dom.ts', line: "if (!watching) document.addEventListener('focusin', unhide);", what: '초점 칸을 덮은 알림 상자 비켜 올림(초점 그대로)', judge: '통과' },
  { row: 'F4', file: 'src/app/dom.ts', line: "el.addEventListener('focusout', t.later);", what: '알림 시간 닫힘 다시 재기(초점 그대로)', judge: '통과' },
  { row: 'F5', file: 'src/app/notices.ts', line: "row.addEventListener('focusout', (e) => {", what: 'Esc로 접은 판단 띠 줄 풀기(class만)', judge: '통과' },
  { row: 'F6', file: 'src/app/sim.ts', line: "to.addEventListener('blur', end);", what: '깎기 탭 칸 떠날 때 change 한 번(초점 가져오지 않음 — 다시 그리면 지금 초점 칸으로만)', judge: '통과' },
];

const MODAL_SITES: readonly Site[] = [
  {
    row: 'M1',
    file: 'src/app/app.ts',
    line: "for (const el of this.workspace.children) if (el !== this.busyEl) el.toggleAttribute('inert', this.busy);",
    what: '여는 중 덮개 동안 작업 영역 inert — 걷히면 풂, Esc·「취소」로 나옴',
    judge: '통과',
  },
  { row: 'M2', file: 'src/app/app.ts', line: "if (t?.closest?.('.language-control, .language-list, [aria-modal=\"true\"]')) return;", what: '모달 안 키는 상자 몫(앱 키가 Esc를 먼저 가져가지 않음)', judge: '통과' },
  {
    row: 'M3',
    file: 'src/app/shortcuts.ts',
    line: "const box = h('div', { class: 'sc-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: -1 }, h('div', { class: 'sc-head' }, h('h2', { id }, SHORTCUTS_TITLE), shut), body);",
    what: '단축키 창 상자(모달)',
    judge: '통과',
  },
  { row: 'M4', file: 'src/app/shortcuts.ts', line: "const made = [...parent.children].filter((el) => !el.hasAttribute('inert'));", what: '열 때 inert 아닌 자식만 고름', judge: '통과' },
  { row: 'M5', file: 'src/app/shortcuts.ts', line: "for (const el of made) el.setAttribute('inert', '');", what: '열 때 inert — 닫을 때 풂', judge: '통과' },
  { row: 'M6', file: 'src/app/shortcuts.ts', line: "for (const el of made) el.removeAttribute('inert');", what: '닫을 때(모든 닫는 길) inert 풂 — 초점 돌려주기 전', judge: '통과' },
  { row: 'M7', file: 'src/app/shortcuts.ts', line: "const news = [...new Set(heard('[hidden], [inert]'))].filter((t) => t.trim() && !before.has(t));", what: '알릴 글 모으기 거르개(inert를 걸지 않음)', judge: '셈 밖' },
];

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...srcFiles(p));
    else if (name.endsWith('.ts') || name.endsWith('.css')) out.push(p);
  }
  return out;
}

/** 파일·코드 줄마다 re에 걸린 수(.ts 주석 줄·.css 덧글 덩이는 뺀다) */
function sites(re: RegExp): Map<string, number> {
  const seen = new Map<string, number>();
  for (const f of srcFiles('src')) {
    const css = f.endsWith('.css');
    const text = css ? read(f).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')) : read(f);
    for (const raw of text.split('\n')) {
      if (!css && /^\s*(\/\/|\*|\/\*)/.test(raw)) continue;
      const n = [...raw.matchAll(re)].length;
      const k = `${f}\t${raw.trim()}`;
      if (n) seen.set(k, (seen.get(k) ?? 0) + n);
    }
  }
  return seen;
}

/** 표와 소스를 견준다 — 표 밖 새 줄(또는 수가 다른 줄)·사라진 줄 */
function compare(re: RegExp, table: readonly Site[]): { outside: string[]; stale: string[] } {
  const seen = sites(re);
  const want = new Map(table.map((s) => [`${s.file}\t${s.line}`, 1]));
  return {
    outside: [...seen].filter(([k, n]) => want.get(k) !== n).map(([k, n]) => `${k.replace('\t', ': ')} ×${n}`),
    stale: [...want.keys()].filter((k) => !seen.has(k)).map((k) => k.replace('\t', ': ')),
  };
}

const judged = (t: readonly Site[]): Record<Judge, string[]> => ({ 통과: t.filter((s) => s.judge === '통과').map((s) => s.row), '셈 밖': t.filter((s) => s.judge === '셈 밖').map((s) => s.row) });

describe('소스 글: 키보드 함정 감사 자리(233차)', () => {
  it('Tab을 가로채는 키 처리는 3곳·3파일 모두 표에 — 메뉴 닫기·같은 누름 Shift+Tab 되돌리기·모달 돌기, 실패 0', () => {
    expect(compare(TAB, TAB_SITES)).toEqual({ outside: [], stale: [] });
    expect(new Set(TAB_SITES.map((s) => s.file)).size).toBe(3);
    expect(judged(TAB_SITES)).toEqual({ 통과: ['T1', 'T2', 'T3'], '셈 밖': [] });
  });

  it('초점 사건(blur 2·focusout 2·focusin 2)은 6곳 모두 표에 — 초점을 도로 가져오는 줄 0', () => {
    expect(compare(FOCUS, FOCUS_SITES)).toEqual({ outside: [], stale: [] });
    const kinds = FOCUS_SITES.map((s) => /'(blur|focusout|focusin)'/.exec(s.line)![1]);
    expect(kinds.sort()).toEqual(['blur', 'blur', 'focusin', 'focusin', 'focusout', 'focusout']);
    expect(FOCUS_SITES.filter((s) => s.line.includes('.focus('))).toEqual([]);
    expect(judged(FOCUS_SITES)).toEqual({ 통과: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'], '셈 밖': [] });
  });

  it('inert·aria-modal 코드 줄은 7(app.ts 2·shortcuts.ts 5) 모두 표에 — 주석 줄(keys.ts·shortcuts.css 등)은 셈 밖', () => {
    expect(compare(MODAL, MODAL_SITES)).toEqual({ outside: [], stale: [] });
    expect(MODAL_SITES.map((s) => s.file.replace('src/app/', ''))).toEqual(['app.ts', 'app.ts', 'shortcuts.ts', 'shortcuts.ts', 'shortcuts.ts', 'shortcuts.ts', 'shortcuts.ts']);
    expect(judged(MODAL_SITES)).toEqual({ 통과: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'], '셈 밖': ['M7'] });
  });

  it('3D 보기가 Tab을 받는 길(가상 커서·마우스 Tab 돌리기)의 나오는 키 Esc가 안내에 남아 있다', () => {
    const help = /export const KEY_HELP = '([^']*)'/.exec(read('src/app/keysnap.ts'))?.[1] ?? '';
    expect(help).toContain('Esc로 끕니다');
    expect(help).toContain('Esc로 돌리기를 풉니다');
    expect(read('src/app/shortcuts.ts')).toContain("{ keys: ['Esc'], label: '가상 커서 끄기' }");
  });
});
