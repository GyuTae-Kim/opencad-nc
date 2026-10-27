// @vitest-environment jsdom
/**
 * 깎기 시뮬레이션 화면(app.ts·sim.ts): 켜고 끄기, 문서 장면 + 소재 그물, 재생 막대 따라가기, 깎기 탭(소재·공구 표·급속 경고),
 * 시뮬레이션하지 않는 프로그램 알림. 뷰어 코어(WebGL)는 가짜, 워커는 같은 실행기(SimRunner)를 같은 스레드에서 돌리는 가짜.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    scenes: { meshes: { id: string }[]; lines: unknown[]; bounds?: unknown }[] = [];
    keepView: boolean[] = [];
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      FakeViewer.last = this;
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return 0;
    }
    get scene(): unknown {
      return this.scenes[this.scenes.length - 1] ?? null;
    }
    setScene(s: FakeViewer['scenes'][number], o: { keepView?: boolean } = {}): void {
      this.scenes.push(s);
      this.keepView.push(!!o.keepView);
    }
    getCamera(): object {
      return { cam: 1 };
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

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
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
import { SIM_GROUP, composeSimScene } from '../../src/app/sim';
import type { SimRequest } from '../../src/sim/protocol';
import { SIM_BLOCK_TEXT } from '../../src/sim/setup';
import { SimRunner } from '../../src/sim/runner';
import { ncSampleProgram } from '../../src/view/sample';

/** 워커 대신: 같은 실행기를 이 스레드에서(메시지는 다음 틱에) */
class FakeWorker {
  static made = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  private dead = false;
  private readonly runner = new SimRunner((msg) => setTimeout(() => !this.dead && this.onmessage?.({ data: msg }), 0));
  constructor() {
    FakeWorker.made++;
  }
  postMessage(msg: SimRequest): void {
    if (!this.dead) this.runner.handle(msg);
  }
  terminate(): void {
    this.dead = true;
  }
}

function makeApp(): { app: NcViewerApp; root: HTMLElement } {
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root), root };
}
const open = (app: NcViewerApp, name: string, text: string): Promise<boolean> => app.openBuffer(name, new TextEncoder().encode(text).buffer as ArrayBuffer);
const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const settled = (): boolean => {
  const s = window.opencadApp!.state.sim;
  return !!s && s.on && s.shown && !s.computing && FakeViewer().scenes.length > 0 && FakeViewer().scene !== null && simMeshes().length > 0;
};
const FakeViewer = () => fake.FakeViewer.last!;
/** "소재 깎기" 메뉴 항목(휴대폰 보기 설정, 넓은 화면 그리기 차례) */
const simItems = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.toolbar .menu button')].filter((b) => b.textContent === '소재 깎기');
const simMeshes = (): string[] => (FakeViewer().scenes[FakeViewer().scenes.length - 1]?.meshes ?? []).map((m) => m.id).filter((id) => id.startsWith('sim-'));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('Worker', FakeWorker);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('깎기 시뮬레이션 켜고 끄기', () => {
  it('켜면 문서 장면 + 소재 그물(조각·옆면·바닥)을 카메라를 지킨 채 올리고, 끄면 문서 장면으로', async () => {
    const { app, root } = makeApp();
    await open(app, 'opencad-sample.nc', ncSampleProgram());
    const api = window.opencadApp!;
    expect(api.state.sim).toBeNull();
    // 넓은 화면 "그리기" 메뉴와 휴대폰 "보기 설정" 메뉴의 "소재 깎기"(도구 막대는 넓히지 않는다)
    const items = simItems(root);
    expect(items.map((b) => b.closest('.menu-wrap')!.classList.contains('wide-only'))).toEqual([false, true]);
    expect(items.every((b) => !b.hidden && b.getAttribute('aria-checked') === 'false')).toBe(true);
    const btn = items[1]!;
    btn.click();
    await until(settled);
    const sc = FakeViewer().scenes[FakeViewer().scenes.length - 1]!;
    expect(FakeViewer().keepView[FakeViewer().keepView.length - 1]).toBe(true);
    expect(simMeshes()).toContain('sim-walls');
    expect(simMeshes()).toContain('sim-bottom');
    expect(simMeshes().filter((id) => id.startsWith('sim-tile-')).length).toBe(api.state.sim!.grid![0] > 1 ? Math.ceil((api.state.sim!.grid![0] - 1) / 64) * Math.ceil((api.state.sim!.grid![1] - 1) / 64) : 0);
    // 공구 경로는 그대로 함께
    expect(sc.lines.length).toBe(app.doc!.scene.lines.length);
    expect(items.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    // 전체 경로 = 프로그램 끝까지
    expect(api.state.sim!.at).toEqual({ move: app.doc!.nc!.moves.count, frac: 0 });
    // 공구 경로 빼기
    await api.setSim(true, { paths: false });
    await until(() => FakeViewer().scenes[FakeViewer().scenes.length - 1]!.lines.length === 0);
    // 끄기
    await api.setSim(false);
    await until(() => simMeshes().length === 0);
    expect(FakeViewer().scenes[FakeViewer().scenes.length - 1]).toBe(app.doc!.scene);
    expect(btn.getAttribute('aria-checked')).toBe('false');
  });

  it('재생 자리를 따라 깎고(되감으면 다시), 새 문서를 열면 그 문서로 다시 계산', async () => {
    const { app } = makeApp();
    await open(app, 'opencad-sample.nc', ncSampleProgram());
    const api = window.opencadApp!;
    await api.setSim(true);
    await until(settled);
    api.seek(9);
    await until(() => settled() && api.state.sim!.at!.move < app.doc!.nc!.moves.count);
    const at = api.state.sim!.at!;
    expect(at.move).toBeGreaterThan(0);
    expect(api.state.sim!.stats!.rewinds).toBe(1);
    api.seek(null);
    await until(() => settled() && api.state.sim!.at!.move === app.doc!.nc!.moves.count);
    // 다른 문서
    await open(app, 'b.nc', 'G21 G90\nT1 M6 (T1 D=4. FLAT END MILL)\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X20\nG0 Z5\n');
    await until(() => settled() && api.state.sim!.at!.move === app.doc!.nc!.moves.count);
    expect(api.state.sim!.grid).not.toBeNull();
  });
});

describe('깎기 탭', () => {
  it('소재 상자·해상도·공구 표(파일 값 → 바꾸면 기억), 바꾸면 다시 계산', async () => {
    const { app, root } = makeApp();
    await open(app, 'opencad-sample.nc', ncSampleProgram());
    const api = window.opencadApp!;
    api.togglePanel(true);
    api.setPanelTab('sim');
    await until(() => !!root.querySelector('.panel-body .sim-status'));
    let body = root.querySelector('.panel-body')!;
    expect(body.textContent).toContain('깎인 소재 보이기');
    expect(body.textContent).toContain('꺼져 있습니다');
    // 공구 표: 주석의 지름·이름(T3 DRILL은 드릴)
    const kinds = [...body.querySelectorAll<HTMLSelectElement>('table.sim-tools select')].map((s) => s.value);
    expect(kinds).toEqual(['flat', 'flat', 'drill']);
    const dias = [...body.querySelectorAll<HTMLInputElement>('table.sim-tools input[aria-label$="지름"]')].map((i) => Number(i.value));
    expect(dias).toEqual([10, 6, 8]);
    // 켜기(탭의 상자)
    const on = [...body.querySelectorAll<HTMLInputElement>('input[type=checkbox]')][0]!;
    on.click();
    await until(settled);
    body = root.querySelector('.panel-body')!;
    expect(body.querySelector('.sim-status')!.textContent).toContain('전체 프로그램을 깎았습니다');
    // 소재 X 최대 바꾸기 → 다시 계산, "직접 정함"
    const xmax = body.querySelector<HTMLInputElement>('input[aria-label="X 범위 — 최대"]')!;
    xmax.value = '90';
    xmax.dispatchEvent(new Event('change'));
    await until(settled);
    expect(root.querySelector('.panel-body')!.textContent).toContain('직접 정함');
    // T2를 볼 엔드밀로 → 기억, 출처 "사용자 값"
    const t2 = root.querySelector<HTMLSelectElement>('select[aria-label="T2 종류"]')!;
    t2.value = 'ball';
    t2.dispatchEvent(new Event('change'));
    await until(settled);
    expect(JSON.parse(localStorage.getItem('opencad-nc.sim.tools')!)).toEqual({ 2: { kind: 'ball' } });
    expect(root.querySelector('table.sim-tools tbody tr:nth-child(2)')!.textContent).toContain('사용자 값');
  });

  it('급속이 소재를 지난 줄을 보이고(누르면 그 줄로), 해석 경고에 이미 있는 줄은 뺀다', async () => {
    const { app, root } = makeApp();
    const text = ['G21 G90 G17', 'T1 M6 (T1 D=4. FLAT END MILL)', 'G0 X-30 Y0 Z5', 'G1 Z-5 F100', 'G1 X30', 'G0 Z5', 'G0 X-30 Y10', 'G0 Z-1', 'G0 X30', 'G0 Z-8', 'G0 Z5', 'M30'].join('\n');
    await open(app, 'r.nc', text);
    const api = window.opencadApp!;
    api.togglePanel(true);
    api.setPanelTab('sim');
    await api.setSim(true, { stock: { min: [-40, -20, -20], max: [40, 20, 0] } });
    await until(() => settled() && api.state.sim!.rapidEvents > 0 && !!root.querySelector('.panel-body .warn-item'));
    const items = [...root.querySelectorAll<HTMLButtonElement>('.panel-body .warn-item')];
    // 8번 줄(G0 Z−1)·9번 줄(G0 X30, Z−1 높이) — 10번 줄(G0 Z−8)은 해석 경고("가장 깊은 절삭보다 아래")에 있어 뺀다
    expect(items.map((b) => b.querySelector('.ln')!.textContent)).toEqual(['8번 줄', '9번 줄']);
    expect(root.querySelector('.panel-body')!.textContent).toContain('해석 경고에 이미 있는 줄 1곳은 뺐습니다.');
    items[1]!.click();
    expect(api.state.selLine).toBe(8);
  });

  it('선반·기울인 평면 프로그램은 시뮬레이션하지 않고 까닭을, 판재 파일에는 깎기 단추가 없다', async () => {
    const { app, root } = makeApp();
    await open(app, 't.nc', 'G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG68.2 X0 Y0 Z0 I0 J30 K0\nG53.1\nG1 X10\nM30\n');
    const api = window.opencadApp!;
    api.togglePanel(true);
    api.setPanelTab('sim');
    await api.setSim(true);
    await until(() => root.querySelector('.panel-body')!.textContent!.includes('시뮬레이션하지 않음'));
    const body = root.querySelector('.panel-body')!;
    expect(body.textContent).toContain(SIM_BLOCK_TEXT.tilt);
    expect(body.querySelector('.sim-block button')!.textContent).toBe('4번 줄');
    expect(api.state.sim!.blocked).toBe(SIM_BLOCK_TEXT.tilt);
    expect(simMeshes()).toEqual([]);
    expect(FakeWorker.made).toBeGreaterThanOrEqual(0);
    await open(app, 'p.mpr', '[H\nVERSION="4.0 Alpha"\n_BSX=600\n_BSY=400\n_BSZ=19\n\n<102 \\BohrVert\\\nXA="100"\nYA="100"\nTI="10"\nDU="8"\n');
    expect(simItems(root).every((b) => b.hidden)).toBe(true);
    expect([...root.querySelectorAll('.panel-tabs [role=tab]')].map((b) => b.textContent)).not.toContain('깎기');
  });
});

describe('장면 합치기·번역', () => {
  it('공작물 상자(nc-stock)를 빼고 소재 그물을 더하며 범위를 넓힌다', () => {
    const base = { name: 'a', units: 'mm' as const, meshes: [{ id: 'nc-stock', positions: new Float32Array(9), color: [1, 1, 1, 1] as const }], lines: [{ id: 'nc-cut-1', positions: new Float32Array(6) }], points: [], bounds: { min: [0, 0, -1] as [number, number, number], max: [10, 10, 5] as [number, number, number] } };
    const m = { id: 'sim-walls', positions: new Float32Array(9), color: [1, 1, 1, 1] as const };
    const s = composeSimScene(base, [m], false, { min: [-5, 0, -20], max: [10, 12, 0] });
    expect(s.meshes.map((x) => x.id)).toEqual(['sim-walls']);
    expect(s.lines).toEqual([]);
    expect(s.bounds).toEqual({ min: [-5, 0, -20], max: [10, 12, 5] });
    expect(composeSimScene(base, [m], true, null).lines.length).toBe(1);
  });

  it('새 화면 글은 네 언어 사전에 있다', () => {
    const texts = [
      '깎기',
      '소재 깎기',
      SIM_GROUP,
      ...Object.values(SIM_BLOCK_TEXT),
      '소재 깎기 시뮬레이션',
      '깎인 소재 보이기',
      '공구 경로도 보이기',
      '재생 막대를 따라 공구가 소재를 깎은 모양을 그립니다(앞으로 감기는 이어서, 되감기는 저장점에서 다시 계산).',
      '꺼져 있습니다 — 켜면 재생 막대를 따라 소재를 깎아 보입니다.',
      '시뮬레이션하지 않음',
      '3축(공구 방향 Z) 높이 지도로 깎은 근사 결과입니다. 칸보다 작은 모양, 공구 아래로 파인 곳(언더컷), 공구 홀더·자루 충돌은 보지 않습니다.',
      '급속이 깎은 자리는 빨갛게 그립니다(지금 재생 자리까지).',
      '소재',
      'X 범위',
      'Y 범위',
      'Z 범위(바닥 ~ 윗면)',
      '정한 곳',
      '직접 정함',
      '프로그램의 공작물(BLK FORM)',
      '절삭 범위에서 추정',
      '자동은 절삭 범위(공구 중심)에 공구 반지름과 여유를 더하고, Z0 아래를 깎으면 Z0을 윗면으로 봅니다. 바꾸면 처음부터 다시 계산합니다.',
      '자동으로',
      '격자·색',
      '해상도(긴 변 칸)',
      '격자',
      '깊이로',
      '소재 색',
      '자동은 기기(휴대폰은 낮게)와 프로그램 크기로 정합니다. 칸이 많을수록 또렷하지만 계산과 메모리가 늘어납니다.',
      '평 엔드밀',
      '볼 엔드밀',
      '불 노즈',
      '드릴·V 날',
      '파일 값',
      '사용자 값',
      '기본값',
      '모서리 R · 끝 각',
      '출처',
      '파일(공구 주석·공구 정의)에서 알 수 없는 값은 기본값(평 엔드밀 Ø6 mm · 0.25 inch)입니다. 바꾼 값은 공구 번호별로 이 브라우저에 기억하고 파일 값보다 먼저 씁니다.',
      '기억 지우기',
      '불러오는 중…',
      '소재 상자가 올바르지 않습니다(최대가 최소보다 커야 합니다).',
    ];
    const samples = [
      '소재 계산 중 45%',
      '계산하는 중… 12%',
      '전체 프로그램을 깎았습니다 · 0.07초',
      '이동 5 / 77까지 깎았습니다 · 0.08초',
      '급속 이동이 소재를 지남 3곳',
      '해석 경고에 이미 있는 줄 2곳은 뺐습니다.',
      '깊이 1.2 mm',
      '1,024 × 752칸 · 칸 0.147 mm',
      '지름(mm)',
      '파일 값 Ø10',
      'X 범위 — 최소',
      'T2 종류',
      'T2 지름',
      'T3 끝 각(도)',
      'T3 모서리 R',
      '시뮬레이션하지 않음 — 선반 프로그램은 시뮬레이션하지 않습니다.',
      '시뮬레이션을 계산하지 못했습니다: out of memory',
      '시뮬레이션을 불러오지 못했습니다: x',
    ];
    for (const lang of ['en', 'ja', 'zh-CN', 'de']) {
      for (const t of texts) {
        expect(catalogs[lang]?.[t], `${lang}: ${t}`).toBeTruthy();
        expect(translate(t, lang), `${lang}: ${t}`).not.toMatch(/[가-힣]/);
      }
      for (const t of samples) expect(translate(t, lang), `${lang}: ${t}`).not.toMatch(/[가-힣]/);
    }
  });
});
