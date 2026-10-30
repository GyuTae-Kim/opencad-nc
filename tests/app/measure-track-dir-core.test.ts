// @vitest-environment jsdom
/**
 * 끌어온 점에서 지나간 모서리와 나란함·수직(30차 — 3D 뷰어 코어 0.28.0 inference.trackDirs { edge })을 실제 코어 판정으로.
 * 앱 붙잡기(ncSnapOptions·panelSnapOptions)는 기준 선분 거르기(refine.ts trackDirEdge)로 곧은 경로 선분·곧은 윤곽 요소·곧은 모서리만 기준으로 받는다.
 * - 거르기 자체: G-code 원호 이동·스플라인 조각·보정 경로 호의 토막은 받지 않고 곧은 이동·급속·보정 경로의 직선 조각은 받는다.
 *   판재 윤곽 호·구멍 테두리의 토막은 받지 않고 윤곽 직선·판·홈 모서리는 받는다(시작 깊이 선처럼 표에 없는 토막·모르는 묶음은 받지 않는다)
 * - G-code: 기운 직선 이동을 지나간 뒤 끌어온 점에서 그와 나란한 선·수직인 선 위는 '끌어온 점에서 모서리와 나란히'·'끌어온 점에서 모서리에 수직'
 *   (툴팁·결과 이름·다섯 언어). 그 뒤 원호 이동의 현을 지나가도 기준은 기운 직선 그대로다(거르지 않으면 — trackDirs: true — 현 방향에 붙는다)
 * - 판재: 구멍 테두리의 현을 지나가도 기운 홈 모서리 기준이 남는다. 판 모서리(X축과 나란함)를 지나간 뒤 끌어온 점의 X·Y축 위는 끌어온 축이다
 *   (코어 차례 — 축과 같은 선은 끌어온 축이 맡는다)
 * - 끌어온 점 단추는 끌어온 점의 선 위 점('perpendicular'에 trackFrom)을 끌어오지 않는다(코어 머무르기와 같다)
 * 끌어온 점은 setMeasureTrackPoints로 준다(머무르기 시간을 기다리지 않는다). 가리키는 자리는 선 끝·꼭짓점을 비킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions } from 'opencad-viewer3d';
import { MOVE_ARC } from '../../src/model';
import { MeasureLock } from '../../src/app/measure-lock';
import { TRACK_PARALLEL_LABEL, TRACK_PERPENDICULAR_LABEL, snapPair, trackMark, trackMarks } from '../../src/app/measure';
import { trackPointOf } from '../../src/app/measure-track';
import { parseForView } from '../../src/app/payload';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions, trackDirEdge } from '../../src/app/refine';
import { catalogs, translate } from '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const D = Math.PI / 180;
type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const unit = (v: readonly number[]): V3 => {
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n];
};
/** 두 방향이 같은 직선인지(부호 무시, 1e-4 안) */
const sameDir = (a: readonly number[], b: readonly number[]): boolean => {
  const u = unit(a);
  const w = unit(b);
  return Math.abs(Math.abs(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) - 1) < 1e-4;
};

// 위에서 본 G-code: 기운 직선 (0,0) → (40,20), 반시계 반원(중심 (40,40) R20) (40,20) → (40,60), 급속 → (160,100)
const GCODE = ['G21 G90 G17', 'G0 X0 Y0 Z0', 'G1 X40 Y20 F500', 'G3 X40 Y60 I0 J20', 'G0 X160 Y100', 'M2'].join('\n');
const T: V3 = [120, 20, 0];
const SLANT: V3 = [2, 1, 0];
// 판재: 구멍(중심 (150,150) 지름 10)과 기운 톱 홈(중심선 (250,50) → (350,150), 너비 8)
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <hole x="150" y="150" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
  <line startX="250" startY="50" startZ="0" endX="350" endY="150" endZ="0" width="8" depth="5" direction="z-" isSaw="1" enable="1" order="2"/>
 </panel>
</pgi>`;
const HC: V3 = [150, 150, 18];

function setup(name: string, text: string, raw = false, opts: Record<string, unknown> = {}) {
  const r = parseForView(name, enc(text), opts);
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const o: MeasureSnapOptions = r.nc ? ncSnapOptions(r.nc, arcCenters(r.nc), null, (r.scene.meta as { arcAngle?: number }).arcAngle) : panelSnapOptions(r.mpr!.snap!);
  // raw: 거르지 않은 0.27.0 꼴(trackDirs: true) — 지나간 아무 선분이 기준
  v.setMeasureSnap(raw ? { ...o, inference: { ...(o.inference as object), trackDirs: true } } : o);
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const zoom = (lo: readonly number[], hi: readonly number[]): void => {
    const a = v.project([lo[0]!, lo[1]!, lo[2] ?? 0])!;
    const b = v.project([hi[0]!, hi[1]!, hi[2] ?? 0])!;
    v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
    v.renderNow();
  };
  const ptr = (type: string, p: readonly number[]): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[]) => {
    ptr('pointermove', p);
    v.renderNow();
    lock.update();
    return { h: v.measureHoverSnap, tip: lock.snapshot().tip };
  };
  const click = (p: readonly number[]): void => {
    hover(p);
    ptr('pointerdown', p);
    ptr('pointerup', p);
    v.renderNow();
    lock.update();
  };
  return { r, v, lock, zoom, hover, click };
}

describe('기준 선분 거르기(trackDirEdge)', () => {
  const segs = (positions: Float32Array, ids?: Uint32Array): { ends: [V3, V3]; raw: number; index: number }[] => {
    const out = [];
    for (let j = 0; j * 6 < positions.length; j++) {
      const o = j * 6;
      out.push({ ends: [[positions[o]!, positions[o + 1]!, positions[o + 2]!], [positions[o + 3]!, positions[o + 4]!, positions[o + 5]!]] as [V3, V3], raw: j, index: ids ? ids[j]! : j });
    }
    return out;
  };

  it('G-code: 원호·나선 이동과 스플라인 조각의 토막은 받지 않고 곧은 이송·급속은 받는다', () => {
    const text = ['G21 G90 G17', 'G0 X0 Y0 Z0', 'G1 X40 Y20 F500', 'G3 X40 Y60 I0 J20', 'G2 X60 Y40 Z-5 I20 J0', 'G5.1 X80 Y60 I10 J0', 'G0 X160 Y100', 'G81 X170 Y100 Z-5 R2 F100', 'G80', 'M2'].join('\n');
    const r = parseForView('f.nc', enc(text));
    const nc = r.nc!;
    const edge = trackDirEdge(nc);
    const seen = { arc: 0, spline: 0, straight: 0 };
    for (const ls of r.scene.lines) {
      for (const s of segs(ls.positions, ls.segmentIds)) {
        const ok = edge({ kind: 'line', id: ls.id, index: s.index, raw: s.raw, ends: s.ends });
        const m = s.index;
        const arc = /^nc-cut-/.test(ls.id) && nc.moves.kind[m] === MOVE_ARC;
        const spline = /^nc-cut-/.test(ls.id) && !!nc.splines && [...Array(nc.splines.count).keys()].some((k) => m >= nc.splines!.move[k]! && m < nc.splines!.move[k]! + nc.splines!.moves[k]!);
        expect(ok, `${ls.id}#${m}`).toBe(!arc && !spline);
        seen[arc ? 'arc' : spline ? 'spline' : 'straight']++;
      }
    }
    expect(seen.arc).toBeGreaterThan(10);
    expect(seen.spline).toBeGreaterThan(1);
    // 곧은 이송 하나, 급속 셋 이상(시작·원호 뒤·드릴 사이클), 드릴
    expect(seen.straight).toBeGreaterThanOrEqual(4);
    // 모르는 묶음·범위 밖 번호·윤곽선은 받지 않는다
    const any = { raw: 0, ends: [[0, 0, 0], [1, 1, 0]] as [V3, V3] };
    expect(edge({ ...any, kind: 'line', id: 'lathe-axis', index: 0 })).toBe(false);
    expect(edge({ ...any, kind: 'line', id: 'nc-cut-none', index: 9999 })).toBe(false);
    expect(edge({ ...any, kind: 'edge', id: 'nc-cut-none', index: 1 })).toBe(false);
  });

  it('보정 경로: 호 조각의 토막은 받지 않고 직선 조각은 받는다', () => {
    // G42 공구 지름 6: 반시계 반원 R10 → 보정 호 R13(중심 (0,0)), 시계 1/4 원 R20(중심 (0,30)) → 보정 호 R17
    const text = ['G21 G90 G17', 'T1 M6 (D=6)', 'G0 X-20 Y-20 Z0', 'G42 D1 G1 X0 Y-10 F300', 'G3 X0 Y10 I0 J10', 'G1 X-20 Y10', 'G1 X-20 Y30', 'G2 X0 Y50 I20 J0', 'G40 G1 X20 Y50', 'M2'].join('\n');
    const r = parseForView('comp.nc', enc(text), { comp: true });
    const edge = trackDirEdge(r.nc!);
    const comp = r.scene.lines.find((l) => l.id === 'nc-comp')!;
    const on = (p: readonly number[], c: readonly number[], rr: number): boolean => Math.abs(Math.hypot(p[0]! - c[0]!, p[1]! - c[1]!) - rr) < 1e-3;
    let arcs = 0;
    let lines = 0;
    for (const s of segs(comp.positions, comp.segmentIds)) {
      const arc = s.ends.every((p) => on(p, [0, 0], 13)) || s.ends.every((p) => on(p, [0, 30], 17));
      expect(edge({ kind: 'line', id: 'nc-comp', index: s.index, raw: s.raw, ends: s.ends }), `comp ${s.raw}`).toBe(!arc);
      if (arc) arcs++;
      else lines++;
    }
    expect(arcs).toBeGreaterThan(20);
    expect(lines).toBeGreaterThanOrEqual(3);
  });

  it('판재: 구멍 테두리·윤곽 호의 토막은 받지 않고 판·홈 모서리와 윤곽 직선은 받는다', () => {
    const r = parseForView('p.pgi', enc(PANEL));
    const edge = trackDirEdge(r.mpr!.snap!);
    const count: Record<string, [number, number]> = {};
    for (const m of r.scene.meshes) {
      if (!m.edges) continue;
      for (const s of segs(m.edges)) {
        const c = (count[m.id] ??= [0, 0]);
        c[edge({ kind: 'edge', id: m.id, index: s.raw, raw: s.raw, ends: s.ends }) ? 0 : 1]++;
      }
    }
    // 판(직사각형)·홈(상자)은 모두 받고, 구멍(원기둥 위·아래 테두리)은 받지 않는다
    expect(count['mpr-board']).toEqual([12, 0]);
    const ids = Object.keys(count).filter((k) => k !== 'mpr-board');
    const hole = ids.find((k) => count[k]![1] > 0)!;
    const groove = ids.find((k) => k !== hole)!;
    expect(count[hole]![0]).toBe(0);
    expect(count[hole]![1]).toBeGreaterThan(20);
    expect(count[groove]![1]).toBe(0);
    expect(count[groove]![0]).toBeGreaterThanOrEqual(12);
    // 모르는 그물(붙잡기 표에 없는 id)은 받지 않는다
    expect(edge({ kind: 'edge', id: 'mpr-unknown', index: 0, raw: 0, ends: [[0, 0, 18], [10, 0, 18]] })).toBe(false);

    // MPR 가공 없는 윤곽: 반원 (10,10) → (30,10)(중심 (20,10)) 다음 직선 → (60,30)
    const mpr =
      '[H\nVERSION="4.0 Alpha"\n_BSX=100.000000\n_BSY=50.000000\n_BSZ=19.000000\n\n]1\n$E0\nKP\nX=10\nY=10\nZ=19\n\n$E1\nKA\nX=30\nY=10\nDS=1\nI=20\nJ=10\n\n$E2\nKL\nX=60\nY=30\n\n<100 \\WerkStck\\\nLA="100"\nBR="50"\nDI="19"\n!\n';
    const q = parseForView('c.mpr', enc(mpr));
    const e2 = trackDirEdge(q.mpr!.snap!);
    const ct = q.scene.lines.find((l) => l.id === 'mpr-contours')!;
    let arc = 0;
    let line = 0;
    for (const s of segs(ct.positions, ct.segmentIds)) {
      const onArc = s.ends.every((p) => Math.abs(Math.hypot(p[0]! - 20, p[1]! - 10) - 10) < 1e-3);
      expect(e2({ kind: 'line', id: 'mpr-contours', index: s.index, raw: s.raw, ends: s.ends })).toBe(!onArc);
      if (onArc) arc++;
      else line++;
    }
    expect(arc).toBeGreaterThan(10);
    expect(line).toBe(1);
    // 표에 없는 토막(요소 위가 아닌 선)은 받지 않는다
    expect(e2({ kind: 'line', id: 'mpr-contours', index: ct.segmentIds![0]!, raw: 0, ends: [[10, 10, 19], [10, 10, 9]] })).toBe(false);
  });
});

describe('끌어온 점에서 모서리와 나란함·수직(실제 코어 판정)', () => {
  /** 원호 (중심 (40,40) R20, −90° → 90°)에서 −40° 둘레 현 하나의 가운데 각(장면 나누기 각으로) */
  const chordAt = (step: number): { at: V3; dir: V3 } => {
    const k = Math.floor((50 * D) / step);
    const t = -90 * D + (k + 0.5) * step;
    return { at: [40 + 20 * Math.cos(t), 40 + 20 * Math.sin(t), 0], dir: [-Math.sin(t), Math.cos(t), 0] };
  };
  const along = (p: readonly number[], d: readonly number[], t: number): V3 => {
    const u = unit(d);
    return [p[0]! + u[0] * t, p[1]! + u[1] * t, p[2]! + u[2] * t];
  };
  /** 선 위 자리에서 조금 비킨 커서(선 위를 정확히 가리키지 않는다) */
  const off = (p: readonly number[]): V3 => [p[0]! + 0.07, p[1]! + 0.05, p[2]!];

  it('G-code: 기운 직선을 지나간 뒤 끌어온 점에서 그와 나란한 선·수직인 선 위(툴팁 이름)', () => {
    const { v, hover } = setup('a.nc', GCODE);
    expect(v.measureSnap?.inference).toMatchObject({ track: { dwellMs: 500 }, trackDirs: { edge: expect.any(Function) } });
    expect(v.setMeasureTrackPoints([T])).toBe(1);
    hover([12.1, 6.0, 0]);
    const par = hover(off(along(T, SLANT, -44.7)));
    expect(par.h).toMatchObject({ snap: 'parallel', trackFrom: T });
    expect(par.h!.locked).toBeFalsy();
    expect(sameDir(sub(par.h!.edge![1], par.h!.edge![0]), SLANT)).toBe(true);
    expect(par.tip).toBe(TRACK_PARALLEL_LABEL);
    expect(trackMark(par.h)).toBe('dir');
    const perp = hover(off(along(T, [1, -2, 0], 22.4)));
    expect(perp.h).toMatchObject({ snap: 'perpendicular', trackFrom: T });
    expect(perp.tip).toBe(TRACK_PERPENDICULAR_LABEL);
    // 선 위 점이라 끌어온 점 단추가 끌어오지 않는다(코어 머무르기와 같다)
    expect(trackPointOf(perp.h)).toBeNull();
    expect(v.measureHoverLock).toBeNull();
  });

  it('G-code: 원호의 현을 지나가도 기준은 기운 직선 그대로(거르지 않으면 현 방향에 붙는다)', () => {
    for (const raw of [false, true]) {
      const { r, v, hover } = setup('a.nc', GCODE, raw);
      const c = chordAt((r.scene.meta as { arcAngle: number }).arcAngle);
      v.setMeasureTrackPoints([T]);
      hover([12.1, 6.0, 0]);
      hover(c.at);
      const atChord = hover(off(along(T, c.dir, 25)));
      const atSlant = hover(off(along(T, SLANT, -44.7)));
      if (raw) {
        // 0.27.0 꼴: 현이 기준 — 현과 나란한 선 위에 붙고, 기운 직선과 나란한 선 위는 아니다
        expect(atChord.h).toMatchObject({ snap: 'parallel', trackFrom: T });
        expect(sameDir(sub(atChord.h!.edge![1], atChord.h!.edge![0]), c.dir)).toBe(true);
        for (const e of atChord.h!.edge!) expect(Math.abs(Math.hypot(e[0]! - 40, e[1]! - 40) - 20)).toBeLessThan(1e-3);
        expect(atSlant.h?.snap === 'parallel' && !!atSlant.h.trackFrom).toBe(false);
      } else {
        expect(atChord.h?.trackFrom && (atChord.h.snap === 'parallel' || atChord.h.snap === 'perpendicular')).toBeFalsy();
        expect(atSlant.h).toMatchObject({ snap: 'parallel', trackFrom: T });
        expect(sameDir(sub(atSlant.h!.edge![1], atSlant.h!.edge![0]), SLANT)).toBe(true);
      }
    }
  });

  it('G-code: 끌어온 점에서 나란한 선 위에 찍은 측정 결과의 이름', () => {
    const { v, hover, click } = setup('a.nc', GCODE);
    v.setMeasureTrackPoints([T]);
    click([159.9, 99.95, 0]);
    expect(v.measurePointCount).toBe(1);
    hover([12.1, 6.0, 0]);
    click(off(along(T, SLANT, -44.7)));
    const m = v.measurement()!;
    expect(m.snapB).toBe('parallel');
    expect(trackMarks(v.measurePoints)).toEqual({ trackB: 'dir' });
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', TRACK_PARALLEL_LABEL, false]);
  });

  it('판재: 구멍 테두리의 현을 지나가도 기운 홈 모서리 기준이 남는다(거르지 않으면 사라진다)', () => {
    for (const raw of [false, true]) {
      const { v, zoom, hover } = setup('p.pgi', PANEL, raw);
      zoom([100, 100, 18], [310, 200, 18]);
      v.setMeasureTrackPoints([HC]);
      // 홈의 기운 윗모서리(x − y = 194.34) → 구멍 테두리(22.5° 둘레)
      hover([300.1, 105.6, 18]);
      const g = hover(off(along(HC, [1, 1, 0], 28.3)));
      expect(g.h).toMatchObject({ snap: 'parallel', trackFrom: HC });
      expect(g.tip).toBe(TRACK_PARALLEL_LABEL);
      hover([150 + 5 * Math.cos(22.5 * D), 150 + 5 * Math.sin(22.5 * D), 18]);
      const after = hover(off(along(HC, [1, 1, 0], 28.3)));
      if (raw) expect(after.h?.snap === 'parallel' && !!after.h.trackFrom).toBe(false);
      else {
        expect(after.h).toMatchObject({ snap: 'parallel', trackFrom: HC });
        expect(sameDir(sub(after.h!.edge![1], after.h!.edge![0]), [1, 1, 0])).toBe(true);
      }
    }
  });

  it('판재: 축과 나란한 판 모서리를 지나간 뒤 끌어온 점의 X·Y축 위는 끌어온 축(코어 차례)', () => {
    const { v, zoom, hover } = setup('p.pgi', PANEL);
    zoom([100, -10, 18], [250, 160, 18]);
    v.setMeasureTrackPoints([HC]);
    hover([200.3, 0.2, 18]);
    const x = hover([190.2, 150.3, 18]);
    expect(x.h).toMatchObject({ snap: 'axis', axis: 'x', trackFrom: HC });
    expect(x.tip).toBe('끌어온 점에서 X축');
    const y = hover([150.3, 120.2, 18]);
    expect(y.h).toMatchObject({ snap: 'axis', axis: 'y', trackFrom: HC });
    expect(y.tip).toBe('끌어온 점에서 Y축');
  });

  it('새 이름 둘은 다섯 언어 사전에 있다', () => {
    for (const k of [TRACK_PARALLEL_LABEL, TRACK_PERPENDICULAR_LABEL]) for (const code of ['en', 'ja', 'zh-CN', 'de']) expect(catalogs[code]![k], `${code}: ${k}`).toBeTruthy();
    expect(translate(TRACK_PARALLEL_LABEL, 'en')).toBe('Parallel to edge from tracked point');
    expect(translate(TRACK_PERPENDICULAR_LABEL, 'de')).toBe('Senkrecht zur Kante vom gemerkten Punkt');
    // 첫 점의 나란함(trackFrom 없음)·수직 발은 예전 이름 그대로
    expect(trackMark({ snap: 'parallel', direction: [1, 0, 0] })).toBe(false);
    expect(trackMark({ snap: 'perpendicular' })).toBe(false);
    expect(trackMark({ snap: 'parallel', trackFrom: [0, 0, 0], locked: true })).toBe('lockFrom');
  });
});
