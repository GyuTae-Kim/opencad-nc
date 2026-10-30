// @vitest-environment jsdom
/**
 * 깎기 시뮬레이션 화면(app.ts·sim.ts): 켜고 끄기, 문서 장면 + 소재 그물, 재생 막대 따라가기, 깎기 탭(소재·공구 표·급속 경고),
 * 시뮬레이션하지 않는 프로그램 알림. 뷰어 코어(WebGL)는 가짜, 워커는 같은 실행기(SimRunner)를 같은 스레드에서 돌리는 가짜.
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    scenes: { meshes: { id: string }[]; lines: unknown[]; bounds?: unknown }[] = [];
    keepView: boolean[] = [];
    /** 코어 0.11.0 setMesh처럼: 같은 id 자리에서 바꾼 새 장면 객체(장면 전체를 다시 주지 않았다) */
    current: FakeViewer['scenes'][number] | null = null;
    meshEdits: { id: string }[] = [];
    points = 0;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      FakeViewer.last = this;
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return this.points;
    }
    get scene(): unknown {
      return this.current;
    }
    setScene(s: FakeViewer['scenes'][number], o: { keepView?: boolean } = {}): void {
      this.scenes.push(s);
      this.current = s;
      this.keepView.push(!!o.keepView);
      // 코어처럼 장면을 바꾸면 겉모습(고르기 불투명·지나갈 삼각형 포함)을 비운다
      this.pickOpaque = new Set();
      this.pickThrough = new Map();
    }
    /** 코어 0.24.0 setItemPickOpaque로 켠 그물(지금 장면에서) */
    pickOpaque = new Set<string>();
    /** 코어 0.27.0 setItemPickThrough로 준 그물별 삼각형 구간(지금 장면에서) */
    pickThrough = new Map<string, unknown>();
    /** 누르기 알림(단 차례대로) */
    picks: { cb: (p: unknown, e: object) => void; through: boolean; front: boolean }[] = [];
    onPick(cb: (p: unknown, e: object) => void, o?: { throughTranslucent?: boolean; front?: boolean }): () => void {
      this.picks.push({ cb, through: !!o?.throughTranslucent, front: !!o?.front });
      return () => {};
    }
    /** 누르기 한 번: 판 너머 알림에는 through(코어 0.26.0 front를 준 알림이면 사건의 front에 가장 앞 고르기), 나머지에는 front */
    click(front: unknown, through: unknown): void {
      const e = { clicks: 1, button: 0, pointerType: 'mouse' };
      for (const k of this.picks) k.cb(k.through ? through : front, k.front ? { ...e, front } : e);
    }
    setItemPickOpaque(id: string, on: boolean): void {
      if (on) this.pickOpaque.add(id);
      else this.pickOpaque.delete(id);
    }
    setItemPickThrough(id: string, ranges: unknown): void {
      if (ranges) this.pickThrough.set(id, ranges);
      else this.pickThrough.delete(id);
    }
    setMesh(m: { id: string }): boolean {
      const s = this.current;
      if (!s) return false;
      const meshes = s.meshes.slice();
      const k = meshes.findIndex((x) => x.id === m.id);
      if (k >= 0) meshes[k] = m;
      else meshes.push(m);
      this.current = { ...s, meshes };
      this.meshEdits.push(m);
      return true;
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
import { mprOps } from '../../src/app/doc';
import { SIM_GROUP, composeSimScene, fullSceneCheaper, panelToolLabel, sumBytes } from '../../src/app/sim';
import { PANEL_SKIP_TEXT, panelOpSteps, panelStepTarget } from '../../src/sim/panel';
import type { SimRequest } from '../../src/sim/protocol';
import { SIM_BLOCK_TEXT } from '../../src/sim/setup';
import { SimRunner } from '../../src/sim/runner';
import { ncSampleProgram } from '../../src/view/sample';

/** 워커 대신: 같은 실행기를 이 스레드에서(메시지는 다음 틱에) */
class FakeWorker {
  static made = 0;
  /** 받은 처음 요청(벽 문턱 등) */
  static inits: Extract<SimRequest, { type: 'init' }>[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  private dead = false;
  private readonly runner = new SimRunner((msg) => setTimeout(() => !this.dead && this.onmessage?.({ data: msg }), 0));
  constructor() {
    FakeWorker.made++;
  }
  postMessage(msg: SimRequest): void {
    if (msg.type === 'init') FakeWorker.inits.push(msg);
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
/** 판 600 × 400 × 19: 윗면 구멍·포켓, 옆면 구멍, 아랫면 구멍(UfluBohr) */
const PANEL_MPR = [
  '[H',
  'VERSION="4.0 Alpha"',
  '_BSX=600',
  '_BSY=400',
  '_BSZ=19',
  '',
  '<100 \\WerkStck\\',
  'LA="600"',
  'BR="400"',
  'DI="19"',
  '',
  '<102 \\BohrVert\\',
  'XA="100"',
  'YA="100"',
  'TI="10"',
  'DU="8"',
  '',
  '<112 \\Tasche\\',
  'XA="300"',
  'YA="200"',
  'LA="100"',
  'BR="50"',
  'TI="10"',
  '',
  '<103 \\BohrHoriz\\',
  'XA="0"',
  'YA="100"',
  'ZA="9.5"',
  'DU="8"',
  'TI="30"',
  'BM="XP"',
  '',
  '<131 \\UfluBohr\\',
  'XA="500"',
  'YA="300"',
  'TI="10"',
  'DU="15"',
  '!',
  '',
].join('\n');
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
    // G-code는 벽 문턱을 주지 않는다(워커 기본 WALL_SLOPE)
    expect(FakeWorker.inits.at(-1)!.wallSlope).toBeUndefined();
    expect(api.state.sim!.stats!.rewinds).toBe(1);
    api.seek(null);
    await until(() => settled() && api.state.sim!.at!.move === app.doc!.nc!.moves.count);
    // 다른 문서
    await open(app, 'b.nc', 'G21 G90\nT1 M6 (T1 D=4. FLAT END MILL)\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X20\nG0 Z5\n');
    await until(() => settled() && api.state.sim!.at!.move === app.doc!.nc!.moves.count);
    expect(api.state.sim!.grid).not.toBeNull();
  });

  it('소재가 처음 다 모였을 때만 장면 전체를 올리고, 그 뒤 바뀐 조각은 그물 하나 바꾸기(setMesh)로 — 측정 중에도 기다리지 않는다', async () => {
    const { app, root } = makeApp();
    await open(app, 'opencad-sample.nc', ncSampleProgram());
    const api = window.opencadApp!;
    const v = FakeViewer();
    const before = v.scenes.length;
    await api.setSim(true);
    await until(settled);
    // 켜서 다 모인 뒤 장면 전체는 한 번(문서 장면 + 공구 경로 + 소재)
    expect(v.scenes.length).toBe(before + 1);
    expect(api.state.sim!.uploads.scenes).toBe(1);
    const edits0 = v.meshEdits.length;
    // 측정 점을 찍었어도(장면 전체를 바꾸면 지워진다) 되감기 결과는 바로 그물 하나씩
    v.points = 1;
    api.seek(9);
    await until(() => settled() && api.state.sim!.at!.move < app.doc!.nc!.moves.count && v.meshEdits.length > edits0);
    expect(v.scenes.length).toBe(before + 1);
    const edited = v.meshEdits.slice(edits0).map((m) => m.id);
    expect(edited.every((id) => /^sim-(tile-\d+-\d+|walls)$/.test(id))).toBe(true);
    expect(api.state.sim!.uploads.meshes).toBe(v.meshEdits.length);
    // 뷰어의 장면에는 워커가 마지막으로 보낸 그물이 있고, 공구 경로·다른 그물 차례는 그대로
    const cur = v.scene as { meshes: { id: string }[]; lines: unknown[] };
    const last = v.scenes[v.scenes.length - 1]!;
    expect(cur.meshes.map((m) => m.id)).toEqual(last.meshes.map((m) => m.id));
    expect(cur.lines).toBe(last.lines);
    const lastEdit = v.meshEdits[v.meshEdits.length - 1]!;
    expect(cur.meshes.find((m) => m.id === lastEdit.id)).toBe(lastEdit);
    // 측정 중에 색을 바꾸면(조각이 모두 바뀐다) 측정을 지키려고 그물만
    api.seek(null);
    await until(() => settled() && api.state.sim!.at!.move === app.doc!.nc!.moves.count);
    const e1 = v.meshEdits.length;
    await api.setSim(true, { color: 'stock' });
    await until(() => settled() && v.meshEdits.length > e1);
    expect(v.scenes.length).toBe(before + 1);
    v.points = 0;
    // 측정 중이 아니고 조각이 모두 바뀌면(같은 격자로 다시 계산 — 공구 바꾸기) 공구 경로가 작은 이 예제는 장면 전체가 싸다
    // (계산이 여러 번에 나뉘어 오면 그 뒤 조각은 그물만이거나, 많이 바뀌었으면 다시 장면 전체 — 기계 부하에 따라 횟수가 다르다)
    const count = app.doc!.nc!.moves.count;
    api.togglePanel(true);
    api.setPanelTab('sim');
    await until(() => !!root.querySelector('select[aria-label="T2 종류"]'));
    const t2 = root.querySelector<HTMLSelectElement>('select[aria-label="T2 종류"]')!;
    const n0 = v.scenes.length;
    t2.value = 'ball';
    t2.dispatchEvent(new Event('change'));
    await until(() => settled() && v.scenes.length > n0 && api.state.sim!.at!.move === count);
    expect(api.state.sim!.uploads.scenes).toBeGreaterThanOrEqual(1);
    // 해상도를 바꾸면 격자가 달라져(조각 id·크기가 다르다) 장면 전체
    const n1 = v.scenes.length;
    await api.setSim(true, { res: 256 });
    await until(() => settled() && v.scenes.length > n1 && api.state.sim!.at!.move === count);
    expect(api.state.sim!.uploads.scenes).toBeGreaterThanOrEqual(1);
    // 공구 경로 보이기를 바꾸면 장면 전체(선분 묶음이 빠진다)
    const n2 = v.scenes.length;
    await api.setSim(true, { paths: false });
    await until(() => v.scenes.length > n2);
    expect(v.scenes[v.scenes.length - 1]!.lines).toEqual([]);
    // 누가 장면을 바꿔 놓았으면(소재 그물이 없는 장면) 그물 하나 바꾸기 대신 장면 전체를 다시
    v.setScene(app.doc!.scene as unknown as InstanceType<typeof fake.FakeViewer>['scenes'][number], { keepView: true });
    const n = v.scenes.length;
    api.seek(3);
    await until(() => settled() && v.scenes.length > n && simMeshes().length > 0);
    expect(simMeshes()).toContain('sim-bottom');
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

  it('판재 파일: 깎기 메뉴·탭이 있고 판 윗면 가공만 깎으며, 시뮬레이션하지 않은 가공은 까닭별로(누르면 그 가공)', async () => {
    const { app, root } = makeApp();
    await open(app, 'p.mpr', PANEL_MPR);
    const api = window.opencadApp!;
    expect(simItems(root).every((b) => !b.hidden)).toBe(true);
    api.togglePanel(true);
    expect([...root.querySelectorAll('.panel-tabs [role=tab]')].map((b) => b.textContent)).toContain('깎기');
    api.setPanelTab('sim');
    await api.setSim(true);
    await until(settled);
    const s = api.state.sim!;
    expect(s.blocked).toBeNull();
    expect(s.panel).toEqual({ items: 2, skipped: { side: 1, bottom: 1 }, disabled: 0 });
    // 판재 구멍은 평 끝 공구라 기울어진 면이 없다 — 벽 문턱 0(칸이 굵어도 얕은 구멍이 매끈한 오목이 되지 않게)
    expect(FakeWorker.inits.at(-1)!.wallSlope).toBe(0);
    expect(s.at).toEqual({ move: s.target!.move, frac: 0 });
    // 판 그물은 빼고(소재가 대신), 가공 그림(구멍 기둥·포켓 상자)은 함께
    let ids = FakeViewer().scenes[FakeViewer().scenes.length - 1]!.meshes.map((m) => m.id);
    expect(ids).not.toContain('mpr-board');
    expect(ids.filter((id) => id.startsWith('mpr-op-')).length).toBeGreaterThan(0);
    await until(() => root.querySelector('.panel-body')!.textContent!.includes('시뮬레이션하지 않은 가공 2개'));
    const body = root.querySelector('.panel-body')!;
    expect(body.textContent).toContain('옆면 가공(수평 구멍·옆면 홈·경로) — 위에서 내려오지 않음');
    expect(body.textContent).toContain('아랫면 가공 — 위에서 내려오지 않음');
    expect(body.textContent).toContain('판 크기(LA·BR·DI)');
    expect([...body.querySelectorAll('table.sim-tools tbody tr td:first-child')].map((td) => td.textContent)).toEqual(['구멍 Ø8']);
    expect(body.querySelector<HTMLInputElement>('input[aria-label="X 범위 — 최대"]')!.value).toBe('600');
    // 옆면 구멍(가공 3)을 누르면 그 가공을 고른다
    const items = [...body.querySelectorAll<HTMLButtonElement>('.warn-item')];
    expect(items.map((b) => b.querySelector('.ln')!.textContent)).toEqual(['가공 3', '가공 4']);
    items[0]!.click();
    expect(app.doc!.selKey).toBe('2');
    expect(api.state.selLine).toBe(mprOps(app.doc!.scene)[2]!.line);
    // 공구 지름 바꾸기 → 'panel:' 열쇠로 기억
    const dia = body.querySelector<HTMLInputElement>('input[aria-label="구멍 Ø8 지름"]')!;
    dia.value = '10';
    dia.dispatchEvent(new Event('change'));
    await until(settled);
    expect(JSON.parse(localStorage.getItem('opencad-nc.sim.tools')!)).toEqual({ 'panel:D8': { diameter: 10 } });
    // 가공 그림을 빼면 가공 그물도 뺀다
    await api.setSim(true, { paths: false });
    await until(() => FakeViewer().scenes[FakeViewer().scenes.length - 1]!.meshes.every((m) => !m.id.startsWith('mpr-op-')) && settled());
    ids = FakeViewer().scenes[FakeViewer().scenes.length - 1]!.meshes.map((m) => m.id);
    expect(ids.every((id) => id.startsWith('sim-'))).toBe(true);
  });

  it('판 윗면 가공이 없는 판재 파일은 까닭과 목록만', async () => {
    const { app, root } = makeApp();
    await open(app, 's.mpr', '[H\nVERSION="4.0 Alpha"\n_BSX=600\n_BSY=400\n_BSZ=19\n\n<103 \\BohrHoriz\\\nXA="0"\nYA="100"\nZA="9.5"\nDU="8"\nTI="30"\nBM="XP"\n!\n');
    const api = window.opencadApp!;
    api.togglePanel(true);
    api.setPanelTab('sim');
    await api.setSim(true);
    await until(() => root.querySelector('.panel-body')!.textContent!.includes('시뮬레이션하지 않음'));
    expect(api.state.sim!.blocked).toBe(SIM_BLOCK_TEXT['panel-none']);
    expect(root.querySelector('.panel-body')!.textContent).toContain('시뮬레이션하지 않은 가공 1개');
    expect(simMeshes()).toEqual([]);
    expect(app.doc!.kind).toBe('mpr');
  });

  it('선반·기울인 평면 프로그램은 시뮬레이션하지 않고 까닭을 보인다', async () => {
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
  });
});

describe('판 너머 고르기에서 멈출 포켓·홈 그물(27차 — 코어 0.24.0 setItemPickOpaque)', () => {
  it('판재 문서 장면을 올릴 때마다 반투명 포켓 그물만 켜고(판·구멍은 아님), 판을 뺀 소재 장면에서는 켜지 않는다', async () => {
    const { app } = makeApp();
    await open(app, 'p.mpr', PANEL_MPR);
    const api = window.opencadApp!;
    const pocket = app.doc!.scene.meshes.filter((m) => m.id.startsWith('mpr-op-') && m.color[3] < 1).map((m) => m.id);
    expect(pocket).toEqual(['mpr-op-1']);
    expect(app.doc!.scene.meshes.find((m) => m.id === 'mpr-board')!.color[3]).toBeLessThan(1);
    expect([...FakeViewer().pickOpaque]).toEqual(pocket);
    const n = FakeViewer().scenes.length;
    await api.setSim(true);
    await until(settled);
    expect(FakeViewer().scenes.length).toBeGreaterThan(n);
    // 소재 장면: 판을 빼고 소재(불투명) 위에 가공 그물을 겹친다 — 측정은 예전처럼 겹친 그물을 지나 소재를 고른다
    expect(FakeViewer().scenes.at(-1)!.meshes.map((m) => m.id)).toContain('mpr-op-1');
    expect([...FakeViewer().pickOpaque]).toEqual([]);
    await api.setSim(false);
    await until(() => simMeshes().length === 0);
    // 문서 장면을 다시 올리면(setScene이 겉모습을 비운다) 다시 켠다
    expect(FakeViewer().scenes.at(-1)).toBe(app.doc!.scene);
    expect([...FakeViewer().pickOpaque]).toEqual(pocket);
    // G-code 문서(공작물 상자 — 반투명)는 켜지 않는다
    await open(app, 'opencad-sample.nc', ncSampleProgram());
    expect(FakeViewer().scenes.at(-1)).toBe(app.doc!.scene);
    expect([...FakeViewer().pickOpaque]).toEqual([]);
  });

  it('보기에서 누르기: 판이 있는 문서 장면은 판 너머 고르기(구멍을 누르면 그 가공), 소재 장면은 예전처럼 가장 앞 면(겹친 포켓 그물을 누르면 그 가공)', async () => {
    // jsdom에는 없다(가공 탭에서 고른 줄을 보이게 할 때 부른다)
    const proto = Element.prototype as { scrollIntoView?: unknown };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = () => {};
    onTestFinished(() => {
      proto.scrollIntoView = had;
    });
    const { app } = makeApp();
    await open(app, 'p.mpr', PANEL_MPR);
    const api = window.opencadApp!;
    const v = FakeViewer();
    // 29차(코어 0.26.0): 앱은 판 너머 알림 하나에 가장 앞 고르기(e.front)를 함께 받는다
    expect(v.picks.map((k) => [k.through, k.front])).toEqual([[true, true]]);
    const mesh = (id: string) => ({ kind: 'mesh', id, index: 0, point: [0, 0, 0] });
    v.click(mesh('mpr-board'), mesh('mpr-op-0'));
    expect(app.doc!.selKey).toBe('0');
    expect(app.doc!.highlight).toEqual(['mpr-op-0']);
    // 뒤에 아무것도 없으면 두 고르기가 같다(판)
    v.click(mesh('mpr-board'), mesh('mpr-board'));
    expect(app.doc!.selKey).toBeNull();
    expect(app.doc!.highlight).toEqual(['mpr-board']);
    await api.setSim(true);
    await until(settled);
    v.click(mesh('mpr-op-1'), mesh('sim-tile-0-0'));
    expect(app.doc!.selKey).toBe('1');
    await api.setSim(false);
    await until(() => simMeshes().length === 0);
    v.click(mesh('mpr-board'), mesh('mpr-op-1'));
    expect(app.doc!.selKey).toBe('1');
    v.click(mesh('mpr-board'), mesh('mpr-op-0'));
    expect(app.doc!.selKey).toBe('0');
  });
});

describe('판재 가공 하나씩 따라가기', () => {
  it('가공 차례: 이동 차례로 처음 나온 가공마다 한 걸음(판 밖 영역은 빼고), k걸음 = k번째 걸음의 첫 이동 앞', () => {
    const op = Int32Array.of(-1, 3, 3, 3, 5, 5, 3, 7);
    const steps = panelOpSteps({ count: op.length, op });
    expect(steps).toEqual([
      { op: 3, move: 1 },
      { op: 5, move: 4 },
      { op: 7, move: 7 },
    ]);
    expect(panelStepTarget(steps, 0, 8)).toEqual({ move: 1, frac: 0 });
    expect(panelStepTarget(steps, 2, 8)).toEqual({ move: 7, frac: 0 });
    expect(panelStepTarget(steps, 3, 8)).toEqual({ move: 8, frac: 0 });
  });

  it('깎기 탭의 처음·다음·이전·막대·끝까지로 가공 k개까지 깎고 지금 가공을 고르며, 패널을 닫으면 3D 보기 아래 띠(측정 중엔 숨김)', async () => {
    const { app, root } = makeApp();
    await open(app, 'p.mpr', PANEL_MPR);
    const api = window.opencadApp!;
    api.togglePanel(true);
    api.setPanelTab('sim');
    await api.setSim(true);
    await until(settled);
    const end = api.state.sim!.at!.move;
    expect(api.state.sim!.step).toBeNull();
    await until(() => !!root.querySelector('.panel-body .sim-steps'));
    const box = (): Element => root.querySelector('.panel-body .sim-steps')!;
    const btn = (label: string, scope: Element = box()): HTMLButtonElement => scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const text = (sel: string, scope: Element = box()): string => scope.querySelector(sel)!.textContent!;
    expect(text('.ss-count')).toBe('2 / 2');
    expect(text('.ss-name')).toBe('모든 가공');
    // 모든 가공에서도 다음 가공은 누를 수 있다(첫 가공부터 — 아래에서 확인)
    expect(btn('다음 가공').disabled).toBe(false);
    expect(btn('모든 가공 깎기(끝까지)').disabled).toBe(true);
    // 단추는 측정 띠와 같은 38px 꼴(mb-btn)
    expect([...box().querySelectorAll('button')].every((b) => b.classList.contains('mb-btn'))).toBe(true);
    // 처음: 깎기 전(판 그대로) — 고른 것 지움
    api.selectLine(0);
    btn('처음으로(깎기 전)').click();
    await until(() => settled() && api.state.sim!.at!.move < end);
    expect(api.state.sim!.step).toEqual({ at: 0, count: 2, op: null, strip: false });
    expect(app.doc!.selKey).toBeNull();
    const t0 = api.state.sim!.at!.move;
    expect(text('.ss-name')).toBe('깎기 전');
    expect(btn('이전 가공').disabled).toBe(true);
    expect(root.querySelector('.sim-status')!.textContent).toMatch(/^가공 0 \/ 2개까지 깎았습니다 · /);
    // 다음: 첫 가공(수직 구멍)까지 — 그 가공을 고른다
    btn('다음 가공').click();
    await until(() => settled() && api.state.sim!.at!.move > t0);
    expect(api.state.sim!.step).toMatchObject({ at: 1, count: 2, op: 0 });
    expect(app.doc!.selKey).toBe('0');
    expect(text('.ss-count')).toBe('1 / 2');
    expect(text('.ss-name')).toMatch(/^가공 1 · /);
    const t1 = api.state.sim!.at!.move;
    expect(t1).toBeLessThan(end);
    // 막대 끝(2): 두 가공 모두 — 지금 가공은 포켓
    const range = box().querySelector<HTMLInputElement>('input[type=range]')!;
    expect(range.max).toBe('2');
    range.value = '2';
    range.dispatchEvent(new Event('input'));
    await until(() => settled() && api.state.sim!.at!.move === end);
    expect(api.state.sim!.step).toMatchObject({ at: 2, op: 1 });
    expect(app.doc!.selKey).toBe('1');
    expect(btn('다음 가공').disabled).toBe(true);
    btn('이전 가공').click();
    await until(() => settled() && api.state.sim!.at!.move === t1);
    // 패널을 닫으면 3D 보기 아래 띠(같은 단추), 측정 중에는 숨김
    api.togglePanel(false);
    const strip = root.querySelector<HTMLElement>('.play-strip.sim-steps')!;
    expect(strip.hidden).toBe(false);
    expect(api.state.sim!.step!.strip).toBe(true);
    expect(text('.ss-count', strip)).toBe('1 / 2');
    btn('다음 가공', strip).click();
    await until(() => settled() && api.state.sim!.at!.move === end);
    expect(text('.ss-count', strip)).toBe('2 / 2');
    // (가짜 뷰어는 측정 모드를 스스로 바꾸지 않는다 — 코어처럼 켜고 끈다)
    FakeViewer().measureMode = true;
    app.toggleMeasure(true);
    expect(strip.hidden).toBe(true);
    FakeViewer().measureMode = false;
    app.toggleMeasure(false);
    expect(strip.hidden).toBe(false);
    // ✕: 따라가기를 끝내고(끝까지) 띠를 거둔다
    btn('하나씩 따라가기 끝내기(모든 가공)', strip).click();
    expect(api.state.sim!.step).toBeNull();
    expect(strip.hidden).toBe(true);
    // ← →: 끝까지 보고 있으면 뒤로는 마지막 가공 앞(1), 앞으로는 하나씩(재생 막대의 한 이동씩과 같은 차례)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(api.state.sim!.step).toMatchObject({ at: 1, count: 2 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(api.state.sim!.step).toMatchObject({ at: 2 });
    btn('하나씩 따라가기 끝내기(모든 가공)', strip).click();
    // 모든 가공에서 깎기 탭의 다음 가공: 첫 가공부터(→ 키, G-code 재생 띠의 다음 이동과 같은 차례)
    api.togglePanel(true);
    await until(() => !!root.querySelector('.panel-body .sim-steps'));
    expect(text('.ss-name')).toBe('모든 가공');
    expect(btn('다음 가공').disabled).toBe(false);
    btn('다음 가공').click();
    expect(api.state.sim!.step).toMatchObject({ at: 1, count: 2, op: 0 });
    expect(text('.ss-count')).toBe('1 / 2');
    await until(() => settled() && api.state.sim!.at!.move === t1);
    // 자동 확인: setSim(true, { step })
    await api.setSim(true, { step: 1 });
    await until(() => settled() && api.state.sim!.at!.move === t1);
    // 끄면 따라가기도 끝
    await api.setSim(false);
    expect(api.state.sim!.step).toBeNull();
    expect(strip.hidden).toBe(true);
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
    // 판재: 판 그물은 늘 빼고, 가공 그물(mpr-op-*)은 가공 그림을 보일 때만
    const panel = { ...base, meshes: [{ id: 'mpr-board', positions: new Float32Array(9), color: [1, 1, 1, 1] as const }, { id: 'mpr-op-0', positions: new Float32Array(9), color: [1, 1, 1, 1] as const }] };
    expect(composeSimScene(panel, [m], true, null).meshes.map((x) => x.id)).toEqual(['mpr-op-0', 'sim-walls']);
    expect(composeSimScene(panel, [m], false, null).meshes.map((x) => x.id)).toEqual(['sim-walls']);
  });

  it('그물 하나씩 바꾸기와 장면 전체: 바뀐 바이트가 장면 전체의 반을 넘으면 장면 전체', () => {
    const tile = { id: 'sim-tile-0-0', positions: new Float32Array(30), colors: new Float32Array(30), indices: new Uint32Array(12), color: [1, 1, 1, 1] as const };
    expect(sumBytes([tile])).toBe(30 * 4 * 2 + 12 * 4);
    expect(sumBytes([{ id: 'nc-cut-1', positions: new Float32Array(6), name: 'x' }])).toBe(24);
    // 공구 경로가 작고 조각이 모두 바뀜 → 장면 전체. 큰 공구 경로(수십만 이동) 또는 조각 몇 개 → 그물만
    expect(fullSceneCheaper(100, 10, 100)).toBe(true);
    expect(fullSceneCheaper(100, 300, 100)).toBe(false);
    expect(fullSceneCheaper(10, 10, 100)).toBe(false);
  });

  it('판재 공구 이름: 구멍 지름, 공구 번호, 경로 폭', () => {
    expect(panelToolLabel({ key: 'D8', type: 'drill', diameter: 8 })).toBe('구멍 Ø8');
    expect(panelToolLabel({ key: 'T101', type: 'router', tno: 101 })).toBe('T101');
    expect(panelToolLabel({ key: 'T101', type: 'router', tno: 101, diameter: 12 })).toBe('T101 Ø12');
    expect(panelToolLabel({ key: 'R12', type: 'router', diameter: 12 })).toBe('경로 Ø12');
    expect(panelToolLabel({ key: 'R', type: 'router' })).toBe('경로(지름 모름)');
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
      // 판재
      ...Object.values(PANEL_SKIP_TEXT),
      '판 윗면 가공으로 판을 깎은 모양을 그립니다.',
      '가공 그림도 보이기',
      '해석한 구멍·홈·포켓·윤곽 그림을 함께 그립니다.',
      '판 윗면에서 위→아래로 하는 가공(수직 구멍·홈·포켓·자유 형상 포켓·윤곽)을 3축 높이 지도로 깎은 근사 결과입니다. 구멍은 구멍 지름의 평 끝 공구로, 홈·포켓은 파일이 정한 모양 그대로(공구 모서리 R 없이), 윤곽은 공구 보정(왼쪽·오른쪽)을 넣어 깎습니다. 칸보다 작은 모양은 보지 않습니다.',
      '판 크기(LA·BR·DI)',
      '판 정보(길이·폭·두께)',
      '가공 범위에서 추정',
      '자동은 판 크기(원점 = 판 왼쪽 앞 아래 모서리)입니다. 직사각형이 아닌 판은 외곽선 밖을 바닥 색으로 그립니다. 바꾸면 처음부터 다시 계산합니다.',
      '공구',
      '구멍은 파일의 구멍 지름, 경로는 파일의 공구 폭(PGI·XML)을 씁니다. 공구 번호만 있는 MPR 윤곽처럼 지름을 모르면 기본값(평 엔드밀 Ø6 mm · 0.25 inch)이니 지름을 넣으십시오. 홈·포켓은 공구 없이 파일의 모양 그대로 깎습니다. 바꾼 값은 이 브라우저에 기억합니다.',
      '누르면 그 가공을 고릅니다',
      '경로(지름 모름)',
      // 판재 가공 하나씩 따라가기(13차)
      '가공 하나씩 따라가기',
      '가공 목록 차례대로 한 가공씩 깎아 봅니다. 지금 가공은 가공 그림(가공 그림도 보이기)과 가공 탭에서 강조합니다. 패널을 닫으면 3D 보기 아래에 같은 단추가 남습니다.',
      '처음으로(깎기 전)',
      '이전 가공',
      '다음 가공',
      '하나씩 따라가기 끝내기(모든 가공)',
      '모든 가공 깎기(끝까지)',
      '끝까지',
      '깎은 가공 수',
      '모든 가공',
      '깎기 전',
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
      '시뮬레이션하지 않은 가공 3개',
      '가공 12',
      '그 밖 7개는 가공 탭에서 보십시오.',
      '꺼진 가공 2개는 깎지 않습니다.',
      '구멍 Ø8',
      '경로 Ø12',
      '구멍 Ø8 종류',
      '구멍 Ø8 지름',
      '구멍 Ø8 끝 각(도)',
      '구멍 Ø8 모서리 R',
      '경로 Ø12 종류',
      '경로 Ø12 지름',
      '경로 Ø12 끝 각(도)',
      '경로 Ø12 모서리 R',
      '경로(지름 모름) 종류',
      '경로(지름 모름) 지름',
      '경로(지름 모름) 끝 각(도)',
      '경로(지름 모름) 모서리 R',
      'T101 Ø12 종류',
      '시뮬레이션하지 않음 — 판 윗면에서 위→아래로 깎는 가공이 없어 시뮬레이션할 것이 없습니다.',
      '가공 3 / 12개까지 깎았습니다 · 0.01초',
      '가공 0 / 2개까지 깎았습니다 · 0초',
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
