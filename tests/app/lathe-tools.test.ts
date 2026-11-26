// @vitest-environment jsdom
/**
 * 정보 탭의 선반 공구 표(28차 — 선반 공구 끝 R 보정): 보정 경로 보기를 켠 선반 프로그램에서 보정 구간이 쓰는 공구마다 노즈 반지름(mm)·
 * 공구 방향을 고르면 기계·읽기 설정에 기억하고 다시 읽어 보정 구간에 쓴다(파일에 값이 없을 때). 뷰어 코어(WebGL)는 가짜로,
 * 해석은 워커와 같은 길(parseForView)로 바로 부른다.
 */
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
    const radius = root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 반지름(mm)"]')!;
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
    expect(root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 반지름(mm)"]')!.value).toBe('0.4');
    // 비우면 기억에서 빼고 다시 읽는다
    const r2 = root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 반지름(mm)"]')!;
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
    expect(['급속 속도(mm/분)', '공구 교환 시간(초)', 'T1 노즈 반지름(mm)'].map((l) => input(l).getAttribute('inputmode'))).toEqual(['decimal', 'decimal', 'decimal']);
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
