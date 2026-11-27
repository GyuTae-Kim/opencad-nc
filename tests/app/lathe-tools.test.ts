// @vitest-environment jsdom
/**
 * 정보 탭의 선반 공구 표(28차 — 선반 공구 끝 R 보정): 보정 경로 보기를 켠 선반 프로그램에서 보정 구간이 쓰는 공구마다 노즈 반지름(mm)·
 * 공구 방향을 고르면 기계·읽기 설정에 기억하고 다시 읽어 보정 구간에 쓴다(파일에 값이 없을 때). 뷰어 코어(WebGL)는 가짜로,
 * 해석은 워커와 같은 길(parseForView)로 바로 부른다.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../site/i18n.mjs';

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
    get measurePointCount(): number {
      return 0;
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
  return { FakeViewer, opens: [] as { name: string; opts: unknown }[] };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown) {
      fake.opens.push({ name, opts });
      return parseForView(name, new Uint8Array(data), (opts ?? {}) as object);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';
import { SETTINGS_KEY } from '../../src/app/settings';

/** Fanuc 선반(T0101 — 노즈 R·공구 방향은 기계의 보정 표에 있어 파일에 없다) */
const LATHE = `O1000\nG18 G21 G40 G99\nT0101\nG0 X80. Z5.\nG42 G1 X40. Z2. F0.2\nG1 Z-20.\nX60.\nG40 G0 X80.\nM30\n`;
/** 밀링 반경 보정 구간 둘(6번 줄 G41 왼쪽·9번 줄 G42 오른쪽 — 공구 지름은 주석) */
const MILL = `G21 G90 G17\n(T1 D=10.)\nT1 M6\nG0 X-20 Y-20 Z5\nG1 Z-2 F100\nG41 D1 X0 Y0 F500\nY50\nG40 X-20 Y70\nG42 D1 X0 Y100\nX50\nG40 X70 Y120\nM30\n`;
const ROOT = resolve(__dirname, '../..');

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean): Promise<void> => {
  const end = Date.now() + 5000;
  for (let i = 0; (i < 50 || Date.now() < end) && !ok(); i++) await tick();
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  localStorage.clear();
  fake.opens.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('정보 탭: 선반 공구 표', () => {
  it('노즈 반지름·공구 방향을 고르면 기억하고 다시 읽어 보정 구간에 쓴다(공구 방향 줄에 값과 출처)', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const dirRow = (): string | null => {
      const r = [...root.querySelectorAll('.prop-row')].find((e) => e.querySelector('.k')?.textContent === '공구 방향');
      return r?.querySelector('.v')?.textContent ?? null;
    };
    expect(dirRow()).toBe('모름 — 노즈 중심');
    expect([...root.querySelectorAll('.prop-row .k')].map((k) => k.textContent)).toContain('T1 노즈 R(mm) · 방향');
    const radius = root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 R(mm)"]')!;
    expect(radius.value).toBe('');
    radius.value = '0.4';
    radius.dispatchEvent(new Event('change'));
    await until(() => fake.opens.length === 2 && api.state.parsed);
    await tick();
    const sel = root.querySelector<HTMLSelectElement>('select[aria-label="T1 공구 방향"]')!;
    expect([...sel.options].map((o) => o.value)).toEqual(['', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    sel.value = '3';
    sel.dispatchEvent(new Event('change'));
    await until(() => fake.opens.length === 3 && api.state.parsed);
    await tick();
    expect(fake.opens[2]!.opts).toMatchObject({ comp: true, machine: { latheToolsMm: { 1: { radiusMm: 0.4, orientation: 3 } } } });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).latheTools).toEqual({ 1: { radiusMm: 0.4, orientation: 3 } });
    expect(dirRow()).toBe('3 · 선반 공구 표 T1');
    // 보정 구간 줄: 반지름과 출처를 조각으로(출처가 따로 옮겨지게) — 통째로 옮겨질 풍선 글은 두지 않는다(30차)
    const runRow = [...root.querySelectorAll('.prop-row')].find((e) => /번 줄 오른쪽$/.test(e.querySelector('.k')?.textContent ?? ''))!;
    expect(runRow.querySelector('.v')!.textContent).toBe('반지름 0.4 mm (선반 공구 표 T1)');
    expect(runRow.querySelector('.v')!.hasAttribute('title')).toBe(false);
    expect(root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 R(mm)"]')!.value).toBe('0.4');
    // 비우면 기억에서 빼고 다시 읽는다
    const r2 = root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 R(mm)"]')!;
    const s2 = root.querySelector<HTMLSelectElement>('select[aria-label="T1 공구 방향"]')!;
    r2.value = '';
    s2.value = '';
    s2.dispatchEvent(new Event('change'));
    await until(() => fake.opens.length === 4 && api.state.parsed);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).latheTools).toEqual({});
    expect(dirRow()).toBe('모름 — 노즈 중심');
  });
});

/**
 * 119차: 기계·읽기 설정의 기계 좌표(G54 원점·G28 기준점)와 허용 범위 칸은 음수를 쳐 넣는다(기계 좌표는 흔히 음수, 범위 최소도).
 * `inputmode="decimal"` 소수 자판은 음수 기호를 약속하지 않아(HTML inputmode — "may or may not show a minus key") 휴대폰·태블릿에서 쳐 넣지 못할 수 있었다.
 * 그래서 이 칸은 inputmode를 두지 않고 type="number"에 맞춰 브라우저가 고르는 자판에 맡긴다. 0보다 큰 값만 쓰는 칸은 소수 자판 그대로.
 */
describe('정보 탭: 음수를 쳐 넣는 숫자 칸(119차)', () => {
  it('기계 좌표·허용 범위 칸은 inputmode가 없고(소수 자판 아님), 쳐 넣은 음수 기계 좌표로 다시 읽는다', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const input = (label: string): HTMLInputElement => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const signed = ['G54 원점의 기계 좌표(mm)', 'G28 기준점 기계 좌표(mm)', '허용 범위 최소(mm)', '허용 범위 최대(mm)'].flatMap((k) => ['X', 'Y', 'Z'].map((a) => `${k} — ${a}`));
    expect(signed.map((l) => [l, input(l)?.type, input(l)?.getAttribute('inputmode')])).toEqual(signed.map((l) => [l, 'number', null]));
    // 0보다 큰 값만 쓰는 칸은 소수 자판 그대로
    expect(['급속 속도(mm/분)', '공구 교환 시간(초)', 'T1 노즈 R(mm)'].map((l) => input(l).getAttribute('inputmode'))).toEqual(['decimal', 'decimal', 'decimal']);
    // 쳐 넣은 음수 기계 좌표: 세 축이 다 차면 다시 읽고 해석 옵션에 그 값
    for (const [a, v] of [['X', '-500'], ['Y', '-300.5'], ['Z', '-400']] as const) {
      const el = input(`G54 원점의 기계 좌표(mm) — ${a}`);
      el.value = v;
      el.dispatchEvent(new Event('change'));
    }
    await until(() => fake.opens.length === 2 && api.state.parsed);
    await tick();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).offsetMm).toEqual([-500, -300.5, -400]);
    expect(fake.opens[1]!.opts).toMatchObject({ machine: { offsetMm: [-500, -300.5, -400], referenceMm: [0, 0, 0] } });
    expect(input('G54 원점의 기계 좌표(mm) — Z').value).toBe('-400');
  });
});

/**
 * 127차: 정보 탭 칸 풀이는 title(마우스를 올려야 뜨는 풍선 글)뿐이라 휴대폰·태블릿(손가락 기기)에서 볼 수 없었다(HTML 표준 title 절 — 풍선 글에 포인터 기기가 필요해
 * 손가락만 쓰는 사용자가 빠진다). 해석 설정·보기 선택·기계·읽기 설정 묶음 바로 아래 칸 가운데 풀이가 있는 칸마다 같은 글의 안내 줄(coarse-only — 마우스 기기는 CSS가 감춤,
 * 시작 화면 손가락 안내와 같은 길)을 그 칸 바로 밑에 둔다. 풍선 글은 그대로이고, 값 칸(.v)의 풍선 글(잘린 값의 온 글)에는 두지 않는다
 */
describe('정보 탭: 손가락 기기의 칸 풀이(127차)', () => {
  it('풀이가 있는 칸마다 바로 밑에 같은 글의 손가락 기기 안내 줄(coarse-only), 풍선 글은 그대로', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const group = (t: string): HTMLElement | undefined => [...root.querySelectorAll<HTMLElement>('.prop-group')].find((g) => g.querySelector('h3')?.textContent === t);
    await until(() => !!group('기계·읽기 설정'));
    const titled = (t: string): HTMLElement[] => [...group(t)!.querySelectorAll<HTMLElement>(':scope > [title]')];
    const tip = (el: HTMLElement): (string | null)[] => {
      const n = el.nextElementSibling;
      return [n?.tagName ?? null, n?.className ?? null, n?.textContent ?? null];
    };
    const three = ['해석 설정', '보기 선택', '기계·읽기 설정'];
    for (const t of three) for (const el of titled(t)) expect(tip(el), `${t}: ${el.title}`).toEqual(['P', 'hint coarse-only', el.title]);
    expect(titled('해석 설정').map((el) => el.title)).toContain('G20/G21이 없을 때 쓰는 단위');
    expect(titled('보기 선택').map((el) => el.querySelector('.name')?.textContent)).toEqual(['보정 경로 보기', '선반 모드']);
    // 기계·읽기 설정: 풀이 열 개(빈 칸의 뜻은 손가락 기기에서 이 줄로만 볼 수 있다)
    const settings = titled('기계·읽기 설정').map((el) => el.title);
    expect(settings).toHaveLength(10);
    expect(settings.filter((t) => /비우면|빈 칸은/.test(t))).toEqual([
      '시간 계산에 쓰는 급속 속도. 비우면 10000 mm/분(inch 프로그램은 400 inch/분).',
      'G54 원점의 기계 좌표와 함께 씁니다. 빈 칸은 0.',
      '작업 좌표(G54) 기준. 벗어나는 이동을 경고합니다. 빈 칸은 제한 없음.',
      '작업 좌표(G54) 기준. 벗어나는 이동을 경고합니다. 빈 칸은 제한 없음.',
    ]);
    // 정보 탭의 안내 줄은 이 세 묶음의 풀이 칸에만 — 공구 경로 값 칸(.v)의 풍선 글에는 없다
    expect(root.querySelector('.panel-body')!.querySelectorAll('.coarse-only')).toHaveLength(three.reduce((n, t) => n + titled(t).length, 0));
    expect(group('공구 경로')!.querySelector('.v[title]')).not.toBeNull();
  });
});

/**
 * 142차: 칸 풀이(title)가 감싼 label·div에만 있으면 칸에 초점을 둔 화면 읽기 프로그램이 풀이를 칸의 설명으로 듣지 못한다(HTML-AAM 설명 차례는
 * aria-describedby → 칸 자신의 title이고 감싼 요소의 title은 쓰지 않는다). 풀이가 있는 칸마다 그 안의 상자·숫자 칸·고르기 자신에도 같은 title을 둔다
 * (이름은 aria-label이나 감싼 label 글이 따로 있어 title은 이름이 아니라 설명이 된다). 감싼 요소의 title(마우스 풍선 글)·손가락 기기 안내 줄은 그대로
 */
describe('정보 탭: 칸 풀이를 칸 자신의 설명으로(142차)', () => {
  it('해석 설정·보기 선택·기계·읽기 설정의 풀이 칸마다 상자·숫자 칸·고르기 자신에도 같은 title, 판재 보기 선택 상자도', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const group = (t: string): HTMLElement | undefined => [...root.querySelectorAll<HTMLElement>('.prop-group')].find((g) => g.querySelector('h3')?.textContent === t);
    await until(() => !!group('기계·읽기 설정'));
    /** 묶음 바로 아래 풀이 칸마다 그 안의 칸(상자·숫자 칸·고르기 — 하나 이상)마다 [감싼 요소의 풀이, 칸 이름(aria-label 또는 감싼 label 글), 칸 자신의 title] */
    const fields = (t: string): (string | null)[][] =>
      [...group(t)!.querySelectorAll<HTMLElement>(':scope > [title]')].flatMap((el) => {
        const cs = [...el.querySelectorAll<HTMLElement>('input, select')];
        expect(cs.length, `${t}: ${el.title}`).toBeGreaterThan(0);
        return cs.map((c) => [el.title, c.getAttribute('aria-label') ?? c.closest('label')?.querySelector('.name')?.textContent ?? null, c.getAttribute('title')]);
      });
    for (const t of ['해석 설정', '보기 선택', '기계·읽기 설정'])
      for (const [tip, name, own] of fields(t)) {
        expect(name, `${t}: ${tip}`).toBeTruthy();
        expect(own, `${t}: ${name}`).toBe(tip);
      }
    expect(fields('해석 설정').map((f) => f[1])).toContain('기본 단위');
    expect(fields('보기 선택').map((f) => f[1])).toEqual(['보정 경로 보기', '선반 모드']);
    // 기계·읽기 설정: 숫자 칸 둘·상자 넷·세 칸 줄 넷(12칸) = 18칸
    expect(fields('기계·읽기 설정')).toHaveLength(18);
    expect(fields('기계·읽기 설정').find((f) => f[1] === '허용 범위 최대(mm) — Z')).toEqual([
      '작업 좌표(G54) 기준. 벗어나는 이동을 경고합니다. 빈 칸은 제한 없음.',
      '허용 범위 최대(mm) — Z',
      '작업 좌표(G54) 기준. 벗어나는 이동을 경고합니다. 빈 칸은 제한 없음.',
    ]);
    // 판재 정보 탭의 보기 선택(첫 화면 panel.ts optToggle — 손가락 기기 안내 줄 밖)도 상자 자신에
    await api.open('s.mpr', '[H\nVERSION="4.0 Alpha"\n_BSX=600\n_BSY=400\n_BSZ=19\n\n<103 \\BohrHoriz\\\nXA="0"\nYA="100"\nZA="9.5"\nDU="8"\nTI="30"\nBM="XP"\n!\n', { mprDisabled: true });
    await until(() => api.state.docName === 's.mpr' && api.state.parsed);
    api.setPanelTab('info');
    await until(() => !!group('보기 선택') && !group('기계·읽기 설정'));
    const off = '조건(??)이 0이거나 EN=0인 가공을 묶음 "꺼진 가공"으로 그립니다.';
    expect(fields('보기 선택')).toEqual([[off, '꺼진 가공도 그리기', off]]);
  });
});

/**
 * 145차: 127차 손가락 기기 안내 줄은 정보 탭 조각(panel-info.ts withTips)이 그리는 묶음에만 닿아, 첫 화면 조각(panel.ts)이 그리는 판재 정보 탭 보기 선택
 * 「꺼진 가공도 그리기」의 풀이는 풍선 글·상자 자신의 title(142차)뿐이라 휴대폰·태블릿에서 볼 수 없었다(142차 남은 일). 같은 규칙으로 상자 바로 밑에 같은 글의 안내 줄을 둔다
 */
describe('정보 탭: 판재 보기 선택의 손가락 기기 안내 줄(145차)', () => {
  it('「꺼진 가공도 그리기」 상자 바로 밑에 같은 글의 안내 줄(coarse-only), 풍선 글·상자 자신의 title은 그대로', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('s.mpr', '[H\nVERSION="4.0 Alpha"\n_BSX=600\n_BSY=400\n_BSZ=19\n\n<103 \\BohrHoriz\\\nXA="0"\nYA="100"\nZA="9.5"\nDU="8"\nTI="30"\nBM="XP"\n!\n', { mprDisabled: true });
    await until(() => api.state.docName === 's.mpr' && api.state.parsed);
    api.setPanelTab('info');
    const group = (t: string): HTMLElement | undefined => [...root.querySelectorAll<HTMLElement>('.prop-group')].find((g) => g.querySelector('h3')?.textContent === t);
    await until(() => !!group('보기 선택'));
    const off = '조건(??)이 0이거나 EN=0인 가공을 묶음 "꺼진 가공"으로 그립니다.';
    const label = group('보기 선택')!.querySelector<HTMLElement>(':scope > [title]')!;
    const n = label.nextElementSibling;
    expect([label.title, label.querySelector('input')!.title, n?.tagName, n?.className, n?.textContent]).toEqual([off, off, 'P', 'hint coarse-only', off]);
    expect(group('보기 선택')!.querySelectorAll('.coarse-only')).toHaveLength(1);
  });
});

/**
 * 148차: 정보 탭 보기 선택의 보정 구간 줄(20개까지)·공구 방향 줄은 div.prop-row가 이어질 뿐이라 화면 읽기 프로그램이 몇 구간인지·몇째인지 듣지 못했다(135차 감사 표 3).
 * 구간마다 그 줄(선반이면 바로 밑 공구 방향 줄과 함께)을 role=listitem 칸에 담아 role=list로 묶는다(WAI-ARIA list·listitem — SKP 156차처럼 ul·li의 들여쓰기·글머리표를 지울 스타일시트 없이).
 * 묶음에 상자·안내 줄·선반 공구 표 줄이 섞여 묶음 자신을 목록으로 할 수 없어 감싼다 — 감싼 칸은 블록 div이고 묶음·정보 탭 몸통은 블록, 묶음·줄을 결합자로 꾸미는 규칙이 없어 모양 그대로
 */
describe('정보 탭: 보정 구간 줄을 목록으로(148차)', () => {
  it('구간마다 한 항목(선반은 공구 방향 줄과 함께)을 보기 선택 묶음 바로 아래 목록에, 선반 공구 표는 목록 밖, 스타일시트는 감싼 칸에 닿지 않음', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    const group = (t: string): HTMLElement | undefined => [...root.querySelectorAll<HTMLElement>('.prop-group')].find((g) => g.querySelector('h3')?.textContent === t);
    /** 보기 선택 묶음 안 목록마다 [부모가 그 묶음인지, 항목마다 [role, 그 항목 바로 아래 줄의 이름…]] */
    const lists = (): unknown[] =>
      [...(group('보기 선택')?.querySelectorAll<HTMLElement>('[role="list"]') ?? [])].map((l) => [
        l.parentElement === group('보기 선택'),
        [...l.children].map((li) => [li.getAttribute('role'), ...[...li.querySelectorAll(':scope > .prop-row > .k')].map((k) => k.textContent)]),
      ]);
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    await until(() => !!group('기계·읽기 설정'));
    expect(lists()).toEqual([[true, [['listitem', '5번 줄 오른쪽', '공구 방향']]]]);
    // 선반 공구 표(넣는 칸 줄)는 목록 밖 — 묶음 바로 아래 그대로
    expect(group('보기 선택')!.querySelector(':scope > .prop-row.edit > .k')?.textContent).toBe('T1 노즈 R(mm) · 방향');
    // 밀링: 구간 둘 → 항목 둘(공구 방향 줄 없음)
    await api.open('m.nc', MILL, { comp: true });
    await until(() => api.state.docName === 'm.nc' && api.state.parsed);
    api.setPanelTab('info');
    await until(() => !!group('기계·읽기 설정') && lists().length > 0);
    expect(lists()).toEqual([[true, [['listitem', '6번 줄 왼쪽'], ['listitem', '9번 줄 오른쪽']]]]);
    // 스타일시트: role로 꾸미는 목록 규칙이 없고, 묶음·줄 선택자에 자식·형제 결합자가 없으며, 묶음 자신과 정보 탭 몸통은 블록(감싼 블록 div가 자리·간격을 바꾸지 않음)
    const css = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const sels = [...css.matchAll(/([^{}]*)\{/g)].map((m) => m[1]!.trim()).filter((s) => /prop-(group|row)/.test(s));
    expect(sels).toContain('.prop-row');
    expect(css).not.toMatch(/\[role=['"]?list/);
    expect(sels.filter((s) => /[>+~]/.test(s) || s.split(',').some((x) => x.trim() === '.prop-group'))).toEqual([]);
    expect(css.match(/(^|\n)\.panel-body\s*\{([^}]*)\}/)![2]).not.toMatch(/display/);
  });
});

/**
 * 168차: 기계·읽기 설정 숫자 칸과 선반 공구 표 노즈 R 칸은 읽지 못한 글(브라우저가 빈 값으로 돌리고 validity.badInput — 쉼표 소수 등)·받지 않는 수(급속 속도 0·음수,
 * 공구 교환 시간 음수, 노즈 R 0·음수)를 빈 칸처럼 null로 걸어 기억한 값을 말없이 지우고 다시 읽었다(WCAG 3.3.1 — 무엇이 틀렸는지 알 길 없음).
 * 이제 걸지 않고(기억한 값·다시 읽기 그대로) 칸에 aria-invalid="true"를 두며, 받는 값·빈 칸을 넣으면 거두고 전처럼 건다
 */
describe('정보 탭: 받지 않는 숫자 값(168차)', () => {
  it('읽지 못한 글·받지 않는 수는 기억한 값을 지우지 않고 다시 읽지 않으며 칸에 aria-invalid, 받는 값·빈 칸이면 거두고 건다', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const input = (label: string): HTMLInputElement => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await until(() => !!input('급속 속도(mm/분)'));
    const saved = (): Record<string, unknown> => JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
    /** 칸에 글을 넣고 change — bad면 브라우저가 읽지 못한 글(빈 값 + validity.badInput) */
    const put = (label: string, v: string, bad = false): HTMLInputElement => {
      const el = input(label);
      if (bad) Object.defineProperty(el, 'validity', { configurable: true, value: { badInput: true } });
      el.value = v;
      el.dispatchEvent(new Event('change'));
      return el;
    };
    const settle = async (n: number): Promise<void> => {
      await until(() => fake.opens.length === n && api.state.parsed);
      await tick();
    };
    put('급속 속도(mm/분)', '5000');
    await settle(2);
    put('T1 노즈 R(mm)', '0.4');
    await settle(3);
    expect([saved().rapidFeedMm, saved().latheTools]).toEqual([5000, { 1: { radiusMm: 0.4, orientation: null } }]);
    const bad: [string, string, boolean][] = [
      ['급속 속도(mm/분)', '0', false],
      ['급속 속도(mm/분)', '-1', false],
      ['급속 속도(mm/분)', '', true],
      ['공구 교환 시간(초)', '-2', false],
      ['G54 원점의 기계 좌표(mm) — X', '', true],
      ['T1 노즈 R(mm)', '0', false],
      ['T1 노즈 R(mm)', '-0.2', false],
      ['T1 노즈 R(mm)', '', true],
    ];
    const marks = bad.map(([l, v, b]) => [l, v, put(l, v, b).getAttribute('aria-invalid')]);
    await tick();
    await tick();
    expect(marks).toEqual(bad.map(([l, v]) => [l, v, 'true']));
    expect(fake.opens).toHaveLength(3);
    expect([saved().rapidFeedMm, saved().toolChangeSec, saved().offsetMm, saved().latheTools]).toEqual([5000, null, [null, null, null], { 1: { radiusMm: 0.4, orientation: null } }]);
    // 받는 값을 넣으면 거둔다(공구 교환 시간 0은 전처럼 null = 0초 — 다시 읽지 않음)
    expect(put('공구 교환 시간(초)', '0').hasAttribute('aria-invalid')).toBe(false);
    expect(saved().toolChangeSec).toBe(null);
    // 노즈 R 칸이 받지 않는 값인 채 방향을 고르면 반지름은 기억한 값으로(전에는 지워짐)
    const q = root.querySelector<HTMLSelectElement>('select[aria-label="T1 공구 방향"]')!;
    q.value = '3';
    q.dispatchEvent(new Event('change'));
    await settle(4);
    expect(saved().latheTools).toEqual({ 1: { radiusMm: 0.4, orientation: 3 } });
    expect([input('T1 노즈 R(mm)').value, input('T1 노즈 R(mm)').hasAttribute('aria-invalid'), input('급속 속도(mm/분)').value]).toEqual(['0.4', false, '5000']);
    // 빈 칸은 전처럼 기본값으로 걸고 다시 읽는다
    expect(put('급속 속도(mm/분)', '').hasAttribute('aria-invalid')).toBe(false);
    await settle(5);
    expect(saved().rapidFeedMm).toBe(null);
  });
});

/**
 * 169차: 168차 aria-invalid는 화면 읽기에만 닿았다 — 스타일시트에 `[aria-invalid]` 규칙이 없어 틀린 값 칸이 눈에는 받는 칸과 같았다(WCAG 3.3.1).
 * 받지 않는 값인 숫자 칸(.num-input — 정보 탭·깎기 탭)은 테두리를 1px에서 2px로 굵게 위험 색(--danger)으로: 색만이 아니고(굵기 — 1.4.1, 강제 색 모드에서도 남음),
 * 높이는 고정·border-box라 줄 높이 그대로, 초점 테두리(바깥 1px 띄운 강조 outline)와 겹치지 않는다. 표시와 칸 바탕·패널 바탕의 대비는 두 테마 모두 3:1 넘음(1.4.11)
 */
describe('정보 탭: 받지 않는 숫자 값의 보이는 표시(169차)', () => {
  it('aria-invalid 칸만 테두리 2px 위험 색(두 테마 모두 칸 바탕·패널 바탕과 3:1 넘음), 칸 높이 고정·border-box, 손가락 화면 규칙은 테두리를 바꾸지 않고 초점은 바깥 outline 그대로', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const input = (label: string): HTMLInputElement => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await until(() => !!input('급속 속도(mm/분)'));
    const bad = input('급속 속도(mm/분)');
    bad.value = '0';
    bad.dispatchEvent(new Event('change'));
    const good = input('공구 교환 시간(초)');
    expect([bad.getAttribute('aria-invalid'), good.hasAttribute('aria-invalid')]).toEqual(['true', false]);
    // jsdom은 CSS를 그리지 않아 styles.css 글로 본다(160~167차 꼴): 주석을 뺀 글의 맨 바깥 규칙, @media 덩어리는 따로
    const raw = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const media = /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
    const decl = (body: string): Record<string, string> =>
      Object.fromEntries(body.split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k!.trim(), v.join(':').trim()]));
    const parse = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()), body: decl(m[2]!) }));
    const rules = parse(raw.replace(media, ''));
    const body = (sel: string): Record<string, string> | undefined => rules.find((r) => r.sels.includes(sel))?.body;
    // 틀린 값 표시 규칙은 하나 — aria-invalid 칸에만 맞고 받는 칸에는 맞지 않으며, 테두리 굵기·색만(높이·여백·outline·그림자는 그대로)
    const marks = rules.filter((r) => r.sels.some((s) => s.includes('aria-invalid')));
    expect(marks.map((r) => r.body)).toEqual([{ 'border-width': '2px', 'border-color': 'var(--danger)' }]);
    expect(marks[0]!.sels.map((s) => [bad.matches(s), good.matches(s)])).toEqual([[true, false]]);
    // 받는 칸은 1px 흐린 테두리, 높이 고정 + border-box라 2px로 굵어져도 칸 바깥 크기·줄 높이 그대로
    expect(body('.num-input')).toMatchObject({ height: '28px', border: '1px solid var(--border-soft)' });
    expect(body('*')).toEqual({ 'box-sizing': 'border-box' });
    // 손가락 화면 규칙은 높이·글자 크기만(테두리를 건드리지 않음)
    const coarse = [...raw.matchAll(media)].map((m) => m[0]).filter((b) => b.includes('.num-input'));
    expect(coarse.flatMap((b) => parse(b).filter((r) => r.sels.includes('.num-input')).map((r) => r.body))).toEqual([{ height: '36px', 'font-size': '16px' }]);
    // 초점은 맨 :focus-visible 바깥 테두리(칸 경계 밖 1px 띄움) 그대로 — 숫자 칸만의 상태 규칙이 없어 안쪽 위험 색 테두리와 겹치지 않음
    expect(body(':focus-visible')).toEqual({ outline: '2px solid var(--accent)', 'outline-offset': '1px' });
    expect(rules.filter((r) => r.sels.some((s) => s.includes('num-input') && s.includes(':')))).toEqual([]);
    // 대비(WCAG 1.4.11 — 상대 휘도): 위험 색 vs 칸 바탕·패널 바탕, 어두운(:root)·밝은 테마 모두 3:1 넘음(손셈 5.69·4.46 / 5.62·5.44)
    const lum = (hex: string): number =>
      [0.2126, 0.7152, 0.0722].reduce((s, w, i) => {
        const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
        return s + w * (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      }, 0);
    const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const theme of [':root', ":root[data-theme='light']"]) {
      const v = body(theme)!;
      expect(Math.min(ratio(v['--danger']!, v['--bg-input']!), ratio(v['--danger']!, v['--bg-panel']!))).toBeGreaterThan(3);
    }
  });
});

/**
 * 183차(WCAG 2.5.3 이름 안의 보이는 글): 선반 공구 표 노즈 R 숫자 칸의 이름이 「T1 노즈 반지름(mm)」이라 보이는 줄 이름 「T1 노즈 R(mm) · 방향」의 「R」을 품지 않아
 * 음성 입력으로 보이는 글을 말하면(「T1 노즈 R」 누르기) 칸이 맞지 않았다(164차 다음 후보). 줄 이름 하나가 두 칸을 함께 불러 이름을 지우거나 줄 이름을 잇지 않고,
 * 칸 이름을 줄 이름의 앞 조각 「T1 노즈 R(mm)」로 둔다. 번역층은 줄 이름(글)과 칸 이름(aria-label)을 따로 옮기므로 네 언어 사전에서도 같은 관계인지 본다
 */
describe('정보 탭: 선반 공구 표 칸 이름이 보이는 줄 이름을 품음(183차)', () => {
  it('노즈 R 칸 이름은 줄 이름 앞 조각을 앞머리에, 방향 고르기 이름은 뒤 조각을 품는다 — 한국어와 네 언어 번역 뒤 모두', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const row = (): HTMLElement | undefined => [...root.querySelectorAll<HTMLElement>('.prop-row.edit')].find((r) => r.querySelector('.k')?.textContent?.startsWith('T1 '));
    await until(() => !!row());
    const shown = row()!.querySelector('.k')!.textContent!;
    const [radius, orient] = [...row()!.querySelectorAll<HTMLElement>('input, select')].map((c) => c.getAttribute('aria-label')!);
    expect(shown).toBe('T1 노즈 R(mm) · 방향');
    /** 보이는 줄 이름 「앞 조각 · 뒤 조각」: 숫자 칸 이름은 앞 조각으로 시작하고, 고르기 이름은 뒤 조각을 품는다(대소문자 무시) */
    const check = (lang: string, s: string, r: string, o: string): void => {
      const [head, tail] = s.split(' · ');
      expect([r.startsWith(head!), o.toLowerCase().includes(tail!.toLowerCase())], `${lang}: ${s} / ${r} / ${o}`).toEqual([true, true]);
    };
    check('ko', shown, radius!, orient!);
    expect([radius, orient]).toEqual(['T1 노즈 R(mm)', 'T1 공구 방향']);
    for (const lang of ['en', 'ja', 'zh-CN', 'de']) {
      const [s, r, o] = [shown, radius!, orient!].map((t) => translate(t, lang));
      expect([s, r, o].filter((t) => /[가-힣]/.test(t!)), lang).toEqual([]);
      check(lang, s!, r!, o!);
    }
    expect([shown, radius, orient].map((t) => translate(t!, 'en'))).toEqual(['T1 nose R (mm) · orientation', 'T1 nose R (mm)', 'T1 tool orientation']);
  });
});
