// @vitest-environment jsdom
/**
 * 229차(WCAG 3.3.1 오류 알림 · 3.3.3 오류 제안): 사용자가 값을 넣는 칸에 받을 수 없는 값을 넣으면 (가) 오류가 글로 알려지고(색·모양만이 아님),
 * (나) 그 칸에 이어지며(aria-invalid + aria-describedby), (다) 받는 꼴(허용 범위·꼴)을 제안하는지 본다(.runtime/r229/progress.md 표와 같은 번호).
 * - 고친 것: 168·169차 숫자 칸(정보 탭 기계·읽기 설정·선반 노즈 R, 깎기 탭 소재 범위·공구 지름·모서리 R·끝 각)은 받지 않는 값을 걸지 않고 aria-invalid·굵은 위험 색
 *   테두리만 두어 무엇을 넣어야 하는지 글이 없었다 → 받는 꼴 글 줄(설정 줄 바로 밑·공구 표 칸 안 — 보이는 .hint)을 aria-describedby로 잇는다(받는 값이면 거둠).
 *   깎기 탭 소재 최대 ≤ 최소는 탭 맨 위 상태 글(role=alert)에만 알려 칸에 이어지지 않았다 → 그 축 최소·최대 칸에 aria-invalid + aria-describedby(상태 글 칸).
 * - 실제 사건(input → change, Enter 뒤 change)으로 한국어·영어 두 화면에서(언어 메뉴로 바꿈 — 앱이 패널을 다시 그리고 번역층이 글을 옮김) 보고,
 *   일본어·중국어·독일어는 사전으로 본다. 찾기 칸 `:줄 번호`(맞춤 — 간 줄이 보이고 상태 줄이 읽음)·밀대·상자·파일 칸은 받을 수 없는 값이 없어 표에 판정만.
 * - 새 칸 막기는 소스 글로: src에서 값을 받는 칸(input·textarea·contenteditable)을 만드는 줄은 모두 SITES 표(판정과 함께)에 들어야 하고,
 *   숫자 칸 값 읽기(readNum)는 모두 받는 꼴 글을 넘긴다.
 * 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView), 깎기 워커는 같은 실행기를 같은 스레드에서(228차 꼴).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      this.canvas.tabIndex = 0;
      wrap.append(this.canvas);
      host.append(wrap);
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return 0;
    }
    get scene(): unknown {
      return null;
    }
    getProjection(): string {
      return 'perspective';
    }
    getRenderMode(): string {
      return 'shadedEdges';
    }
    groups(): unknown[] {
      return [];
    }
  }
  return { FakeViewer };
});

vi.mock('opencad-viewer3d', async (importOriginal) => {
  const core = await importOriginal<typeof import('opencad-viewer3d')>();
  // new로 부르면 돌려준 객체가 그 값이 된다(가짜 뷰어의 Proxy와 같은 길)
  function Viewer3d(host: HTMLElement): object {
    return new fake.FakeViewer(host);
  }
  return { ...core, Viewer3d };
});
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown) {
      return parseForView(name, new Uint8Array(data), (opts ?? {}) as object);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { catalogs, translate } from '../../site/i18n.mjs';
import { NcViewerApp } from '../../src/app/app';
import { installLocalization } from '../../src/app/i18n';
import { loadPanelInfo } from '../../src/app/panel';
import { SimRunner } from '../../src/sim/runner';
import { ncSampleProgram } from '../../src/view/sample';

/** 워커 대신: 같은 실행기를 이 스레드에서(메시지는 다음 틱에) */
class FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  private dead = false;
  private readonly runner = new SimRunner((msg) => setTimeout(() => !this.dead && this.onmessage?.({ data: msg }), 0));
  postMessage(msg: Parameters<SimRunner['handle']>[0]): void {
    if (!this.dead) this.runner.handle(msg);
  }
  terminate(): void {
    this.dead = true;
  }
}

const ROOT = resolve(__dirname, '../..');
/** Fanuc 선반(T0101 — 보정 구간이 쓰는 공구 T1의 노즈 R 칸이 정보 탭에 생김) */
const LATHE = `O1000\nG18 G21 G40 G99\nT0101\nG0 X80. Z5.\nG42 G1 X40. Z2. F0.2\nG1 Z-20.\nX60.\nG40 G0 X80.\nM30\n`;

// ───────────────────────── 받는 꼴 글(새 원문 셋)과 소재 짝 오류 글(있던 원문) ─────────────────────────
const POS = '0보다 큰 수를 넣으십시오.';
const NONNEG = '0 이상의 수를 넣으십시오.';
const ANY = '-12.5처럼 수를 넣으십시오.';
const STOCK = '소재 상자가 올바르지 않습니다(최대가 최소보다 커야 합니다).';
/** (다) 옮겨도 그대로 남아야 할 받는 꼴의 수 글 */
const FORM: Record<string, string> = { [POS]: '0', [NONNEG]: '0', [ANY]: '-12.5' };
const OTHER = ['en', 'ja', 'zh-CN', 'de'] as const;

// ───────────────────────── 소스 글: 값을 받는 칸을 만드는 줄 ─────────────────────────
/**
 * [파일, 줄 조각, 줄 수, 판정(progress.md 표 #n — 고침: 받지 않는 값을 오류 글로 알림 · 맞춤: 가장 가까운 값으로 맞추고 보임 · 셈 밖: 받을 수 없는 값 없음)].
 * 새 자리가 생기면 판정과 함께 여기에(숫자·글 칸이면 받지 않는 값의 (가)(나)(다)를 위 it 꼴로)
 */
const SITES: readonly (readonly [string, string, number, string])[] = [
  ['src/app/panel.ts', "type: 'range', min: 0, max: 1000, step: 1, value: 1000", 1, '#9 셈 밖 — 패널 재생 막대 재생 위치 밀대'],
  ['src/app/panel.ts', "type: 'search'", 1, '#8 맞춤 — 코드 찾기 칸(`:줄 번호`는 첫·끝 줄로, 간 줄이 고른 줄·상태 줄에 보임)'],
  ['src/app/app.ts', "type: 'file'", 1, '#11 셈 밖 — 숨은 파일 칸(쳐 넣는 칸이 아님)'],
  ['src/app/app.ts', "'aria-label': '단면 위치'", 1, '#9 셈 밖 — 단면 위치 밀대'],
  ['src/app/app.ts', "type: 'range', min: 0, max: 1000, step: 1, value: 0,", 1, '#9 셈 밖 — 재생 띠 재생 위치 밀대'],
  ['src/app/sim.ts', "type: 'checkbox', title: hint || null", 1, '#10 셈 밖 — 깎기 탭 상자'],
  ['src/app/sim.ts', "type: 'number', step: 'any', class: 'num-input', 'aria-label': label", 1, '#5 고침 — 소재 범위 최소·최대'],
  ['src/app/sim.ts', "...label('지름')", 1, '#6 고침 — 공구 지름'],
  ['src/app/sim.ts', "label(isBull ? '모서리 R' : '끝 각(도)')", 1, '#7 고침 — 모서리 R·끝 각'],
  ['src/app/sim.ts', "'aria-label': '깎은 가공 수'", 1, '#9 셈 밖 — 따라가기 밀대'],
  ['src/app/panel-info.ts', "h('input', { type: 'checkbox' })", 2, '#10 셈 밖 — 묶음 눈·설정 상자'],
  ['src/app/panel-info.ts', "type: 'checkbox', title: hint })", 1, '#10 셈 밖 — 보기 선택 상자'],
  ['src/app/panel-info.ts', "class: 'num-input', 'aria-label': label, placeholder", 1, '#1~3 고침 — 기계·읽기 설정 숫자 칸'],
  ['src/app/panel-info.ts', "노즈 R(mm)`, placeholder: 'R'", 1, '#4 고침 — 선반 노즈 R'],
];
const FIELD_SITE = /\bh\(\s*'(?:input|textarea)'|createElement\(\s*'(?:input|textarea)'|\.contentEditable\s*=|'contenteditable'\s*:/;
/** src 전체(하위 폴더 포함)의 주석 밖 값 칸 만드는 줄 */
function fieldSites(): { file: string; line: string }[] {
  const out: { file: string; line: string }[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(n))
        for (const line of readFileSync(p, 'utf8').split('\n'))
          if (!/^\s*(?:\/\/|\*|\/\*)/.test(line) && FIELD_SITE.test(line)) out.push({ file: relative(ROOT, p).split('\\').join('/'), line: line.trim() });
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}

// ───────────────────────── DOM 도우미 ─────────────────────────
const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
/** DOM이 quietMs 잇달아 조용할 때까지(마감 4초 — ci-guard 13번: 횟수가 아니라 시간과 조건) */
const quiet = (quietMs = 30): Promise<void> =>
  new Promise((done) => {
    let t: ReturnType<typeof setTimeout>;
    const fin = (): void => {
      clearTimeout(t);
      clearTimeout(cap);
      mo.disconnect();
      done();
    };
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(fin, quietMs);
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    t = setTimeout(fin, quietMs);
    const cap = setTimeout(fin, 4000);
  });
/** 패널 몸통에서 이름(원문을 그 언어로 옮긴 글 — 번역층과 같은 함수)으로 찾은 숫자 칸(「~」 든 이름은 선택자 대신 이름으로 견줌) */
const ctl = (label: string, lang: string): HTMLInputElement | undefined => {
  const name = translate(label, lang);
  return [...document.querySelectorAll<HTMLInputElement>('.panel-body input')].find((el) => el.getAttribute('aria-label') === name);
};
/** 칸에 글을 치고(input 사건) 끝낸다 — enter면 Enter 뒤 change(브라우저 꼴), 아니면 change(다른 칸으로 옮김). bad면 브라우저가 읽지 못한 글(빈 값 + validity.badInput) */
function put(el: HTMLInputElement, v: string, o: { bad?: boolean; enter?: boolean } = {}): void {
  Object.defineProperty(el, 'validity', { configurable: true, value: { badInput: !!o.bad } });
  el.focus();
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  if (o.enter) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
/** (가)(나)(다)를 한 번에: [aria-invalid, 설명 칸 글(aria-describedby가 가리키는 칸), 그 칸 자리(보이는지)] */
function look(el: HTMLInputElement): [string | null, string | null, string] {
  const id = el.getAttribute('aria-describedby');
  const p = id ? (el.ownerDocument.getElementById(id) ?? el.closest('table, section')?.querySelector(`#${id}`) ?? null) : null;
  if (!p) return [el.getAttribute('aria-invalid'), null, '없음'];
  const at = p.id === 'sim-status' ? '상태 글' : p === el.closest('.prop-row')?.nextElementSibling ? '줄 밑' : p.parentElement === el.closest('td') ? '칸 안' : '딴 자리';
  const shown = !p.closest('[hidden], [aria-hidden="true"]') && !p.classList.contains('coarse-only');
  return [el.getAttribute('aria-invalid'), p.textContent, shown ? at : `${at}(안 보임)`];
}
const enc = new TextEncoder();

let dispose: (() => void) | undefined;
beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(깎기·정보 탭·3D 보기 위 UI·측정 도구·단축키 창)을 미리 받아 둔다(ci-guard 5번 — 222·228차 꼴)
  await import('../../src/app/sim');
  await import('../../src/app/viewer-ui');
  await loadPanelInfo();
  await import('../../src/app/measure-tools');
  await import('../../src/app/shortcuts');
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('Worker', FakeWorker);
  localStorage.clear();
  // 깎기 격자를 작게(계산 시간 — 시험 부하)
  localStorage.setItem('opencad-nc.sim', JSON.stringify({ res: 256, color: 'depth', paths: true }));
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/opencad-nc/');
});

describe('229차 입력 오류 알림(WCAG 3.3.1·3.3.3) — 받지 않는 값의 글·이음·제안', () => {
  it('정보 탭·깎기 탭 숫자 칸(한국어·영어 화면): 받지 않는 값이면 칸이 틀림이고 보이는 받는 꼴 글 줄을 aria-describedby로 가리키며, 받는 값이면 거둔다 — 소재 최대 ≤ 최소는 그 축 칸이 상태 글을 가리킨다', async () => {
    const t0 = Date.now();
    history.replaceState(null, '', '/opencad-nc/');
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const app = new NcViewerApp(root);
    dispose = await installLocalization(root);
    const api = window.opencadApp!;
    let lang = 'ko';
    const switchTo = async (next: string): Promise<void> => {
      if (next === lang) return;
      document.querySelector<HTMLButtonElement>(`.language-list [data-language="${next}"]`)!.click();
      await until(() => document.documentElement.lang === next);
      lang = next;
      await quiet();
    };
    const T = (k: string): string => translate(k, lang);

    // ① 선반 문서 정보 탭: 급속 속도(> 0)·공구 교환 시간(≥ 0 — Enter로 끝냄)·G54 원점 X·Y(읽지 못한 글 — 한 줄 칸 둘은 한 오류 줄)·T1 노즈 R(> 0)
    expect(await api.open('l.nc', LATHE, { lathe: true, comp: true })).toBe(true);
    await until(() => !!api.state.parsed);
    api.togglePanel(true);
    api.setPanelTab('info');
    for (const l of ['ko', 'en']) {
      await switchTo(l);
      await until(() => !!ctl('T1 노즈 R(mm)', l));
      await quiet();
      const c = (k: string): HTMLInputElement => ctl(k, l)!;
      const rapid = c('급속 속도(mm/분)');
      const change = c('공구 교환 시간(초)');
      const gx = c('G54 원점의 기계 좌표(mm) — X');
      const gy = c('G54 원점의 기계 좌표(mm) — Y');
      const nose = c('T1 노즈 R(mm)');
      put(rapid, '-5');
      put(change, '-2', { enter: true });
      put(gx, '', { bad: true });
      put(gy, '', { bad: true });
      put(nose, '0');
      await quiet();
      expect([look(rapid), look(change), look(gx), look(gy), look(nose)], `${l} 정보 탭`).toEqual([
        ['true', T(POS), '줄 밑'],
        ['true', T(NONNEG), '줄 밑'],
        ['true', T(ANY), '줄 밑'],
        ['true', T(ANY), '줄 밑'],
        ['true', T(POS), '줄 밑'],
      ]);
      expect(gx.getAttribute('aria-describedby'), `${l} 한 줄 칸 둘`).toBe(gy.getAttribute('aria-describedby'));
      if (l !== 'ko') continue;
      // 받는 값이면 그 자리에서 거둔다(다시 읽기 전): G54 X — 같은 줄 Y가 아직 틀려 오류 줄은 남고, 노즈 R — 줄의 칸이 모두 받는 값이라 오류 줄도 빠진다
      const noseRow = nose.closest('.prop-row')!;
      put(gx, '10');
      put(nose, '0.4');
      expect([look(gx), look(gy)[0], look(nose), noseRow.nextElementSibling?.textContent === POS]).toEqual([[null, null, '없음'], 'true', [null, null, '없음'], false]);
      await until(() => !nose.isConnected);
    }

    // ② 예제 프로그램 깎기 탭(켬): 소재 X 최대·최소(빈 칸·읽지 못한 글 — 한 줄)·T1 지름(0 — Enter)·T3 끝 각(-1) — 표 칸은 칸 안 줄
    expect(await app.openBuffer('opencad-sample.nc', enc.encode(ncSampleProgram()).buffer as ArrayBuffer)).toBe(true);
    api.setPanelTab('sim');
    await api.setSim(true);
    const done = (): boolean => {
      const s = api.state.sim;
      return !!s && s.on && !s.computing && !!s.stats;
    };
    await until(done);
    const Z_MIN = 'Z 범위(바닥 ~ 윗면) — 최소';
    const Z_MAX = 'Z 범위(바닥 ~ 윗면) — 최대';
    for (const l of ['en', 'ko']) {
      await switchTo(l);
      await until(() => !!ctl('T3 끝 각(도)', l));
      await quiet();
      const c = (k: string): HTMLInputElement => ctl(k, l)!;
      const xmax = c('X 범위 — 최대');
      const xmin = c('X 범위 — 최소');
      const dia = c('T1 지름');
      const ang = c('T3 끝 각(도)');
      put(xmax, '');
      put(xmin, '', { bad: true });
      put(dia, '0', { enter: true });
      put(ang, '-1');
      await quiet();
      expect([look(xmax), look(xmin), look(dia), look(ang)], `${l} 깎기 탭`).toEqual([
        ['true', T(ANY), '줄 밑'],
        ['true', T(ANY), '줄 밑'],
        ['true', T(POS), '칸 안'],
        ['true', T(POS), '칸 안'],
      ]);
      // 걸지 않음(169차 그대로): 다시 계산하지 않고 같은 칸이 남음
      expect([api.state.sim!.computing, c('T1 지름') === dia]).toEqual([false, true]);
      if (l === 'ko') {
        const cell = ang.closest('td')!;
        put(ang, '130');
        expect([look(ang), cell.querySelectorAll('.hint').length]).toEqual([[null, null, '없음'], 0]);
        await until(done);
        await quiet();
      }
      // 소재 짝: Z 최소를 최대보다 크게(받는 수 둘) → 계산하지 않고 상태 글 오류 — 다시 그린 그 축 최소·최대 칸이 상태 글을 가리킨다(X 칸은 아님)
      const zmin0 = c(Z_MIN).value;
      put(c(Z_MIN), String(Number(c(Z_MAX).value) + 10));
      await until(() => !!document.getElementById('sim-status')?.hasAttribute('data-fail'));
      await quiet();
      expect([look(c(Z_MIN)), look(c(Z_MAX)), c('X 범위 — 최대').hasAttribute('aria-invalid')], `${l} 소재 짝`).toEqual([
        ['true', T(STOCK), '상태 글'],
        ['true', T(STOCK), '상태 글'],
        false,
      ]);
      // 고치면 다시 계산하고 거둔다
      put(c(Z_MIN), zmin0);
      await until(done);
      await quiet();
      expect([look(c(Z_MIN)), look(c(Z_MAX))], `${l} 소재 짝 고침`).toEqual([
        [null, null, '없음'],
        [null, null, '없음'],
      ]);
    }
    console.info(`229차: 정보 탭 칸 5 · 깎기 탭 칸 4 + 소재 짝 2 × 두 언어 · ${Date.now() - t0} ms`);
  });

  it('사전: 받는 꼴 글 셋·소재 짝 오류 글은 네 언어에 있고 한글이 없으며, 받는 꼴의 수 글(0·-12.5)을 그대로 품는다', () => {
    for (const l of OTHER) {
      const d = catalogs[l] as Record<string, string>;
      for (const k of [POS, NONNEG, ANY, STOCK]) {
        const v = d[k];
        expect(v, `${l}: ${k}`).toBeTruthy();
        expect(/[가-힣]/.test(v!), `${l}: ${k}`).toBe(false);
        if (FORM[k]) expect(v!.includes(FORM[k]!), `${l}: ${k} → ${v}`).toBe(true);
      }
      // 셋은 서로 다른 글(받는 꼴이 다름)
      expect(new Set([POS, NONNEG, ANY].map((k) => d[k])).size, l).toBe(3);
    }
  });

  it('소스 글: 값을 받는 칸을 만드는 줄은 모두 SITES 표에 들고 줄 수가 같으며, 숫자 칸 값 읽기(readNum)는 모두 받는 꼴 글을 넘긴다', () => {
    const found = fieldSites();
    const stray = found.filter((s) => !SITES.some(([f, snip]) => f === s.file && s.line.includes(snip)));
    expect(stray.map((s) => `${s.file}: ${s.line.slice(0, 120)}`)).toEqual([]);
    const off = SITES.map(([f, snip, n]) => [f, snip, found.filter((s) => s.file === f && s.line.includes(snip)).length, n] as const).filter(([, , got, n]) => got !== n);
    expect(off).toEqual([]);
    expect(found.length).toBe(SITES.reduce((a, [, , n]) => a + n, 0));
    // 숫자 칸(type number)은 모두 「고침」 판정
    expect(found.filter((s) => s.line.includes("type: 'number'")).map((s) => SITES.find(([f, snip]) => f === s.file && s.line.includes(snip))![3]).filter((v) => !v.includes('고침'))).toEqual([]);
    // 숫자 칸을 만드는 두 조각: 받는 꼴 글 셋(이 시험과 같은 원문)을 두고, readNum 부름은 모두 둘째 인자로 그 글을 넘긴다
    for (const file of ['src/app/panel-info.ts', 'src/app/sim.ts']) {
      const code = readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
        .join('\n');
      const msgs = [...code.matchAll(/const (NUM_[A-Z]+) = '([^']+)';/g)].map((m) => m[2]);
      expect(msgs.every((m) => [POS, NONNEG, ANY].includes(m!)) && msgs.length > 0, `${file}: ${msgs.join(' / ')}`).toBe(true);
      const calls = [...code.matchAll(/readNum\(([^\n]*)/g)].map((m) => m[1]!).filter((a) => !/^\w+: HTMLInputElement/.test(a));
      expect(calls.length, file).toBeGreaterThan(0);
      expect(calls.filter((a) => !/^\w+, (?:NUM_[A-Z]+|msg)[,)]/.test(a)), file).toEqual([]);
    }
  });
});
