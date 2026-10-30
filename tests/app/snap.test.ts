// @vitest-environment jsdom
/**
 * 두 점 측정 붙잡기(app/snap.ts, app.ts syncMeasureSnap): 원호 중심(해석기의 호 표, 그 호의 선분 묶음 id),
 * 이동 가운데 점(원호는 현이 아니라 호 위 — 장면이 그린 꺾은선과 같은 식), 재생 중 중심 거르기, 결과의 붙잡은 종류 글.
 * 뷰어 코어(WebGL)와 해석 워커는 가짜로 바꾼다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pick3d, SnapPoint } from 'opencad-viewer3d/types';

const fake = vi.hoisted(() => {
  type Cb = (m: unknown) => void;
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    measurePts = 0;
    readonly measureCbs: Cb[] = [];
    /** setMeasureSnap으로 받은 것(차례대로) */
    readonly snaps: unknown[] = [];
    constructor(host: HTMLElement) {
      this.canvas = document.createElement('canvas');
      host.append(this.canvas);
      FakeViewer.last = this;
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return this.measurePts;
    }
    setMeasureMode(on: boolean): void {
      this.measureMode = on;
    }
    /** 붙잡기 한도(코어 0.10.0): setMeasureSnap의 limit, 그 뒤 setMeasureSnapLimit으로 바꾼 값 */
    readonly limits: (number | null)[] = [];
    setMeasureSnap(o: { limit?: number | null } | null): void {
      this.snaps.push(o);
      if (o) this.limits.push(o.limit ?? null);
    }
    setMeasureSnapLimit(n: number | null): void {
      this.limits.push(n);
    }
    get measureSnapLimit(): number | null {
      return this.limits.at(-1) ?? null;
    }
    get measureSnap(): unknown {
      return this.snaps.at(-1) ?? null;
    }
    emitMeasure(m: Record<string, unknown>): void {
      this.measurePts = 2;
      for (const cb of this.measureCbs) cb({ a: [0, 0, 0], b: [1, 0, 0], distance: 1, dx: 1, dy: 0, dz: 0, ...m });
    }
    onMeasure(cb: Cb): () => void {
      this.measureCbs.push(cb);
      return () => {};
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
    // 워커와 같은 길(판재 붙잡기 표·보정 조각까지)
    async open(name: string, data: ArrayBuffer, opts = {}) {
      return parseForView(name, new Uint8Array(data), opts);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';
import { arcCenterCount, arcCenters, movePointAt, moveSnapPoints, snapLabel, snapPair } from '../../src/app/snap';
import { ncPayload } from '../../src/app/payload';
import { loadNcFile, ncPathSetId, MOVE_ARC } from '../../src/index';
import { catalogs, translate } from '../../site/i18n.mjs';

/** 원호(G2·G3)·여러 바퀴 나선·G18 호·드릴 사이클·기계 원점 복귀(추정 이동)·공구 셋 */
const PROGRAM = `G21 G17 G90 G54
T1 M6
S9000 M3
G0 X0 Y0 Z10
G1 Z-1 F200
G1 X40 F600
G3 X60 Y20 I0 J20
G1 Y40
G2 X40 Y60 I-20 J0
G1 X0
G0 Z10
G0 X20 Y30
G1 Z-2 F200
G2 X20 Y30 I8 J0 Z-4
G2 X20 Y30 I8 J0 Z-6
G0 Z10
T2 M6
G0 X-10 Y70 Z5
G18
G1 Z0 F300
G2 X10 Z0 I10 K0
G17
G28 G91 Z0
G90
T3 M6
G0 X10 Y10 Z5
G81 X10 Y10 Z-8 R2 F120
X50 Y10
G80
M30
`;

function load(text = PROGRAM) {
  const { parsed, scene } = loadNcFile('snap-test.nc', text);
  if ('part' in parsed) throw new Error('not nc');
  return { nc: ncPayload(parsed.program), scene, program: parsed.program };
}

const linePick = (id: string, index: number): Pick3d => ({ kind: 'line', id, index, raw: 0, point: [0, 0, 0] }) as unknown as Pick3d;

describe('원호 중심 붙잡기 점', () => {
  const { nc, scene } = load();
  const c = arcCenters(nc);

  it('해석기가 아는 G2/G3 중심을 그 호가 그려진 선분 묶음 id와 함께(같은 묶음 안 같은 자리는 하나로)', () => {
    const pts = c.points.map((p) => [p.id, ...p.point.map((v) => Math.round(v * 1000) / 1000)]);
    // G3(40,0)→(60,20) 중심 (40,20), G2(60,40)→(40,60) 중심 (40,40), 두 바퀴 나선의 중심 (28,30)은 바퀴마다 높이가 달라 둘, G18 호 중심 (0,70,0)
    expect(pts).toEqual([
      ['nc-cut-1', 40, 20, -1],
      ['nc-cut-1', 40, 40, -1],
      ['nc-cut-1', 28, 30, -2],
      ['nc-cut-1', 28, 30, -4],
      ['nc-cut-2', 0, 70, 0],
    ]);
    expect(c.points.every((p) => p.kind === 'center')).toBe(true);
    // 그 id의 묶음이 장면에 있고 그 이동을 담는다
    c.points.forEach((p, k) => {
      const set = scene.lines.find((l) => l.id === p.id)!;
      expect([...set.segmentIds!]).toContain(c.moves[k]);
    });
    // 올라갔다가 첫 바퀴를 같은 높이에서 다시 돌아도 같은 자리 중심은 하나
    const again = load(PROGRAM.replace('G0 Z10\nT2', 'G0 Z10\nG0 X20 Y30\nG1 Z-2 F200\nG2 X20 Y30 I8 J0 Z-4\nG0 Z10\nT2'));
    expect(arcCenters(again.nc).points.length).toBe(5);
  });

  it('재생 중에는 그린 이동까지 처음 나온 중심만', () => {
    expect(arcCenterCount(c, null)).toBe(5);
    expect(arcCenterCount(c, -1)).toBe(0);
    expect(arcCenterCount(c, c.moves[0]!)).toBe(1);
    expect(arcCenterCount(c, c.moves[2]! - 1)).toBe(2);
    expect(arcCenterCount(c, nc.moves.count)).toBe(5);
  });

  it('차례(order) = 처음 그린 이동 번호: 코어 한도 lastMove + 1로 거른 점 = 예전처럼 그 이동까지 잘라 다시 준 목록', () => {
    expect(c.points.map((p) => p.order)).toEqual([...c.moves]);
    for (let last = -1; last <= nc.moves.count; last++) {
      const limit = last + 1;
      const filtered = c.points.filter((p) => p.order === undefined || p.order < limit);
      expect(filtered).toEqual(c.points.slice(0, arcCenterCount(c, last)));
    }
  });

  it('너무 많으면 limit까지', () => {
    expect(arcCenters(nc, 2).points.length).toBe(2);
  });
});

describe('선분 묶음 id 규칙(장면과 같음)', () => {
  it('모든 공구 경로 선분의 묶음 id = ncPathSetId(종류, 비트, 공구)', () => {
    const { nc, scene } = load();
    const sets = scene.lines.filter((l) => /^nc-(cut|drill|rapid|machine)/.test(l.id));
    expect(sets.map((l) => l.id).sort()).toEqual(['nc-cut-1', 'nc-cut-2', 'nc-drill-3', 'nc-machine', 'nc-rapid']);
    for (const l of sets)
      for (const i of l.segmentIds!) expect(ncPathSetId(nc.moves.kind[i]!, nc.moves.flags[i]!, nc.moves.tool[i]!), `${l.id} ${i}`).toBe(l.id);
    expect(ncPathSetId(MOVE_ARC, 0, -1)).toBe('nc-cut-none');
  });
});

describe('이동 가운데 점', () => {
  const { nc, scene } = load();
  const arcs = [...Array(nc.moves.count).keys()].filter((i) => nc.moves.kind[i] === MOVE_ARC);

  it('원호는 현이 아니라 호 위의 점: 중심에서 반지름만큼, 각은 반, 나선은 높이도 반', () => {
    const i = arcs[0]!; // G3 (40,0) → (60,20), 중심 (40,20), R20
    const mid = movePointAt(nc, i, 0.5)!;
    expect(Math.hypot(mid[0] - 40, mid[1] - 20)).toBeCloseTo(20, 9);
    expect(mid[0]).toBeCloseTo(40 + 20 * Math.cos(-Math.PI / 4), 9);
    expect(mid[1]).toBeCloseTo(20 + 20 * Math.sin(-Math.PI / 4), 9);
    // 현의 가운데 (50, 10)과는 다르다
    expect(Math.hypot(mid[0] - 50, mid[1] - 10)).toBeGreaterThan(4);
    const helix = arcs[2]!; // 한 바퀴 나선 Z-2 → Z-4: 시작 반대편, 높이 -3
    const hm = movePointAt(nc, helix, 0.5)!;
    expect(hm[0]).toBeCloseTo(36, 9);
    expect(hm[1]).toBeCloseTo(30, 9);
    expect(hm[2]).toBeCloseTo(-3, 9);
    const g18 = arcs[4]!; // G18 X-10 → X10, 중심 X0 Z0, R10: 가운데는 Z 축 위
    const gm = movePointAt(nc, g18, 0.5)!;
    expect(Math.hypot(gm[0], gm[2])).toBeCloseTo(10, 9);
    expect(gm[1]).toBeCloseTo(70, 9);
  });

  it('장면이 그린 호 꺾은선의 꼭짓점과 같다(나눈 수가 짝수인 호)', () => {
    for (const i of arcs) {
      const set = scene.lines.find((l) => l.id === ncPathSetId(MOVE_ARC, nc.moves.flags[i]!, nc.moves.tool[i]!))!;
      const segs = [...set.segmentIds!.keys()].filter((k) => set.segmentIds![k] === i);
      if (segs.length % 2) continue;
      const k = segs[segs.length / 2]!; // 뒤쪽 반의 첫 조각 시작 = 가운데 꼭짓점
      const v = [set.positions[k * 6]!, set.positions[k * 6 + 1]!, set.positions[k * 6 + 2]!];
      const mid = movePointAt(nc, i, 0.5)!;
      for (let a = 0; a < 3; a++) expect(Math.abs(v[a]! - mid[a]!)).toBeLessThan(1e-4);
    }
  });

  it('고른 선분(이동 번호)에서 더할 점: 직선은 가운데 점, 원호는 호 위 가운데 점과 중심', () => {
    const line = [...Array(nc.moves.count).keys()].find((i) => nc.moves.kind[i] === 1 && nc.moves.points[i * 3] === 0 && nc.moves.points[i * 3 + 3] === 40)!;
    expect(moveSnapPoints(linePick('nc-cut-1', line), nc)).toEqual([{ point: [20, 0, -1], kind: 'midpoint' }]);
    const arc = moveSnapPoints(linePick('nc-cut-1', arcs[0]!), nc)!;
    expect(arc.map((p) => p.kind)).toEqual(['midpoint', 'center']);
    expect(arc[1]!.point).toEqual([40, 20, -1]);
    // 급속·드릴·기계 원점 쪽 이동도 공구 경로
    const rapid = [...Array(nc.moves.count).keys()].find((i) => nc.moves.kind[i] === 0)!;
    expect(moveSnapPoints(linePick('nc-rapid', rapid), nc)?.[0]?.kind).toBe('midpoint');
  });

  it('공구 경로가 아니거나(보정 경로·회전축·구멍 점) 번호가 없거나 길이가 없으면 없음', () => {
    expect(moveSnapPoints(linePick('nc-comp', arcs[0]!), nc)).toBeNull();
    expect(moveSnapPoints(linePick('lathe-axis', 0), nc)).toBeNull();
    expect(moveSnapPoints({ kind: 'point', id: 'nc-holes', index: 3, raw: 0, point: [0, 0, 0] } as unknown as Pick3d, nc)).toBeNull();
    expect(moveSnapPoints(linePick('nc-cut-1', -1), nc)).toBeNull();
    expect(moveSnapPoints(linePick('nc-cut-1', nc.moves.count), nc)).toBeNull();
    const still = load('G21 G90\nG0 X0 Y0 Z5\nG1 Z0 F100\nG1 Z0\nM30\n');
    const zero = [...Array(still.nc.moves.count).keys()].find((i) => still.nc.moves.kind[i] === 1 && still.nc.moves.points[i * 3 + 2] === still.nc.moves.points[i * 3 + 5]);
    if (zero !== undefined) expect(moveSnapPoints(linePick('nc-cut-none', zero), still.nc)).toBeNull();
  });
});

describe('붙잡은 종류 글', () => {
  it('이름과 두 점 짝(붙잡기를 켠 결과만)', () => {
    expect(snapPair({ snapA: 'center', snapB: 'endpoint' })).toEqual(['중심', '끝점', false]);
    expect(snapPair({ snapA: 'midpoint', snapB: null })).toEqual(['가운데 점', '붙잡지 않은 점', false]);
    expect(snapPair({ snapA: null, snapB: null })).toBeNull();
    expect(snapPair({})).toBeNull();
    expect(snapLabel('vertex')).toBe('꼭짓점');
    expect(snapLabel('point')).toBe('붙잡은 점');
  });

  it('추론 붙잡기(코어 0.9.0): 교차점·수직 발, 축 방향은 코어가 준 축(axisB, 코어 0.9.1)', () => {
    expect(snapPair({ snapA: 'intersection', snapB: 'perpendicular' })).toEqual(['교차점', '수직 발', false]);
    expect(snapPair({ snapA: 'center', snapB: 'axis', axisB: 'y' })).toEqual(['중심', 'Y축 방향', false]);
    expect(snapPair({ snapA: 'endpoint', snapB: 'axis', axisB: 'z' })).toEqual(['끝점', 'Z축 방향', false]);
    // 축이 없으면(옛 결과) 그냥 '축 방향' — dx·dy·dz로 짐작하지 않는다
    expect(snapPair({ snapA: 'endpoint', snapB: 'axis' })).toEqual(['끝점', '축 방향', false]);
    expect(snapLabel('axis', 'x')).toBe('X축 방향');
  });

  it('나란함·잠금(코어 0.10.0): 나란한 방향, 잠근 선 위에 찍은 둘째 점은 셋째 값', () => {
    expect(snapLabel('parallel')).toBe('나란한 방향');
    expect(snapPair({ snapA: 'endpoint', snapB: 'parallel' })).toEqual(['끝점', '나란한 방향', false]);
    expect(snapPair({ snapA: 'endpoint', snapB: 'axis', axisB: 'z', lockedB: true })).toEqual(['끝점', 'Z축 방향', true]);
  });

  it('네 언어 모두 번역이 있다', () => {
    const names = [...(['vertex', 'endpoint', 'midpoint', 'center', 'point', 'intersection', 'perpendicular', 'axis', null] as const).map((k) => snapLabel(k)), ...(['x', 'y', 'z'] as const).map((a) => snapLabel('axis', a))];
    for (const lang of ['en', 'ja', 'zh-CN', 'de'])
      for (const t of names) {
        expect(catalogs[lang]?.[t], `${lang}: ${t}`).toBeTruthy();
        expect(translate(t, lang)).not.toMatch(/[가-힣]/);
      }
    expect(translate('중심', 'en')).toBe('Center');
  });
});

describe('앱: 측정 중에만 붙잡기를 켜고 결과에 종류를 보인다', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
    vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const makeApp = () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    return { app: new NcViewerApp(root), root };
  };
  const measureBtn = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.toolbar .tbtn')].find((b) => b.getAttribute('aria-label') === '측정')!;
  type Snap = { points: SnapPoint[]; pointsFor: (p: Pick3d) => SnapPoint[] | null } | null;

  it('G-code: 측정을 켜면 원호 중심과 고른 이동의 가운데 점, 끄면 끈다', async () => {
    const { app, root } = makeApp();
    expect(await app.openBuffer('snap-test.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer)).toBe(true);
    const v = fake.FakeViewer.last!;
    expect(v.snaps).toEqual([]);
    measureBtn(root).click();
    const s = v.snaps.at(-1) as Snap & { inference?: unknown };
    expect(s!.points.length).toBe(5);
    // 추론 붙잡기(교차점·수직 발·축 방향)와 코어 0.10.0 나란함·Shift 잠금, 0.16.0 끌어온 축(18차), 0.18.0 축과 모서리·면의 교차(20차),
    // 0.19.0 잠근 선과 모서리·면의 교차(21차), 0.21.0 잠근 선과 끌어온 축의 교차(25차)도 켠다. 0.23.0 반투명 공작물 너머 고르기(25차)
    expect(s!.inference).toEqual({ intersections: true, perpendicular: true, axes: true, parallel: true, lock: true, track: true, axisEdges: true, axisFaces: true, lockEdges: true, lockFaces: true, lockTracks: true });
    expect((s as { throughTranslucent?: boolean }).throughTranslucent).toBe(true);
    expect(s!.points[0]).toMatchObject({ point: [40, 20, -1], kind: 'center', id: 'nc-cut-1' });
    const nc = app.doc!.nc!;
    const arc = [...Array(nc.moves.count).keys()].find((i) => nc.moves.kind[i] === MOVE_ARC)!;
    expect(s!.pointsFor(linePick('nc-cut-1', arc))!.map((p) => p.kind)).toEqual(['midpoint', 'center']);
    // 같은 상태로 다시 맞춰도 코어에 또 주지 않는다
    const n = v.snaps.length;
    app.seek(null);
    expect(v.snaps.length).toBe(n);
    measureBtn(root).click();
    expect(v.snaps.at(-1)).toBeNull();
  });

  it('재생 중에는 그린 이동까지의 중심만(코어 붙잡기 한도 — 점 목록은 다시 주지 않는다), 재생을 끝내면 모두', async () => {
    const { app, root } = makeApp();
    await app.openBuffer('snap-test.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer);
    const v = fake.FakeViewer.last!;
    measureBtn(root).click();
    const nc = app.doc!.nc!;
    const c = arcCenters(nc);
    const given = v.snaps.length;
    const shown = (): SnapPoint[] => {
      const lim = v.measureSnapLimit;
      return (v.snaps.at(-1) as Snap)!.points.filter((p) => lim === null || p.order === undefined || p.order < lim);
    };
    // 셋째 중심(나선 첫 바퀴)을 그리기 직전 이동의 끝 시각
    const before = c.moves[2]! - 1;
    app.seek(nc.timeline[before]! - 1e-6);
    expect(v.snaps.length).toBe(given);
    expect(v.measureSnapLimit).toBe(before + 1);
    expect(shown()).toEqual(c.points.slice(0, 2));
    // 같은 이동 안에서 시각만 바뀌면 한도도 그대로(코어를 부르지 않는다)
    const calls = v.limits.length;
    app.seek(nc.timeline[before]! - 2e-6);
    expect(v.limits.length).toBe(calls);
    app.seek(null);
    expect(v.measureSnapLimit).toBeNull();
    expect(shown()).toEqual(c.points);
    expect(v.snaps.length).toBe(given);
  });

  it('결과의 붙잡은 종류를 측정 띠·상태 막대·패널에 "중심 → 끝점"으로', async () => {
    const { app, root } = makeApp();
    await app.openBuffer('snap-test.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer);
    measureBtn(root).click();
    fake.FakeViewer.last!.emitMeasure({ distance: 20, dx: 20, dy: 0, dz: 0, snapA: 'center', snapB: 'endpoint' });
    expect(root.querySelector('.measure-bar .mb-snap')!.textContent).toBe('중심 → 끝점');
    expect(root.querySelector('.st-sel')!.textContent).toBe('거리 20 mm · dx 20 · dy 0 · dz 0 · 중심 → 끝점');
    // 이름은 따로 번역되게 조각으로
    expect([...root.querySelectorAll('.st-sel span')].map((e) => e.textContent)).toEqual(['중심', '끝점']);
    expect(root.querySelector('.panel-foot')!.textContent).toContain('중심 → 끝점');
    // 잠근 선 위에 찍은 둘째 점(코어 0.10.0 lockedB)은 "잠금"을 따로 붙인다
    fake.FakeViewer.last!.emitMeasure({ distance: 20, dx: 0, dy: 0, dz: 20, snapA: 'endpoint', snapB: 'axis', axisB: 'z', lockedB: true });
    expect(root.querySelector('.measure-bar .mb-snap')!.textContent).toBe('끝점 → Z축 방향 · 잠금');
    expect([...root.querySelectorAll('.st-sel span')].map((e) => e.textContent)).toEqual(['끝점', 'Z축 방향', '잠금']);
    expect(root.querySelector('.panel-foot')!.textContent).toContain('끝점 → Z축 방향 · 잠금');
    // 붙잡기를 켜지 않은 결과(snapA·snapB 없음)는 예전 그대로
    fake.FakeViewer.last!.emitMeasure({ distance: 5, dx: 5, dy: 0, dz: 0, snapA: undefined, snapB: undefined });
    expect(root.querySelector('.st-sel')!.textContent).toBe('거리 5 mm · dx 5 · dy 0 · dz 0');
    expect(root.querySelector('.measure-bar .mb-snap')).toBeNull();
  });

  it('문서를 열면 캔버스에 초점: 앞의 초점이 키보드 초점일 때만 테두리(코어 0.9.0 :focus-visible)', async () => {
    const focus = vi.spyOn(HTMLCanvasElement.prototype, 'focus');
    try {
      const { app, root } = makeApp();
      // 주소(?sample)·공유·파일 연결로 연 첫 화면처럼 입력이 없으면 테두리 없이
      await app.openBuffer('snap-test.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer);
      expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true, focusVisible: false }]);
      // 키보드로 고른 단추(:focus-visible)에서 열면 테두리를 보인다
      const btn = root.querySelector<HTMLButtonElement>('.toolbar .tbtn')!;
      btn.focus();
      const matches = vi.spyOn(btn, 'matches').mockImplementation((s: string) => s === ':focus-visible');
      await app.openBuffer('snap-test.nc', new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer);
      expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true, focusVisible: true }]);
      matches.mockRestore();
    } finally {
      focus.mockRestore();
    }
  });

  it('판재 가공(MPR): 워커가 보낸 붙잡기 표로 원호 중심과 고른 윤곽 요소의 가운데 점, 추론 붙잡기', async () => {
    const { app, root } = makeApp();
    const mpr = '[H\nVERSION="4.0 Alpha"\n_BSX=100.000000\n_BSY=50.000000\n_BSZ=19.000000\n\n]1\n$E0\nKP\nX=10\nY=10\nZ=19\n\n$E1\nKA\nX=30\nY=10\nDS=1\nI=20\nJ=10\n\n<100 \\WerkStck\\\nLA="100"\nBR="50"\nDI="19"\n\n<102 \\BohrVert\\\nXA="20"\nYA="25"\nTI="10"\nDU="8"\n!\n';
    expect(await app.openBuffer('panel.mpr', new TextEncoder().encode(mpr).buffer as ArrayBuffer)).toBe(true);
    const v = fake.FakeViewer.last!;
    expect(v.snaps).toEqual([]);
    measureBtn(root).click();
    expect(app.state().measuring).toBe(true);
    const s = v.snaps.at(-1) as Snap & { inference?: unknown };
    expect(s!.inference).toEqual({ intersections: true, perpendicular: true, axes: true, parallel: true, lock: true, track: true, axisEdges: true, axisFaces: true, lockEdges: true, lockFaces: true, lockTracks: true });
    expect((s as { throughTranslucent?: boolean }).throughTranslucent).toBe(true);
    // 가공 없는 윤곽(반원 (10,10) → (30,10), 중심 (20,10))
    expect(s!.points).toEqual([{ point: [20, 10, 19], kind: 'center', id: 'mpr-contours' }]);
    expect(s!.pointsFor({ ...linePick('mpr-contours', 1), point: [20, 0.2, 19] })!.map((p) => [p.kind, ...p.point.map((x) => Math.round(x * 1000) / 1000 + 0)])).toEqual([
      ['midpoint', 20, 0, 19],
      ['center', 20, 10, 19],
    ]);
    // 같은 문서로 다시 맞춰도 코어에 또 주지 않고, 측정을 끄면 끈다
    const n = v.snaps.length;
    app.togglePanel(true);
    expect(v.snaps.length).toBe(n);
    measureBtn(root).click();
    expect(v.snaps.at(-1)).toBeNull();
  });
});
