// @vitest-environment jsdom
/**
 * 코어 측정 거리 글상자의 글(32차 — measure-label.ts, 코어 setMeasureFormat):
 * - 자릿수·"-0"·단위가 코어 기본 글과 같은 규칙인지(순수)
 * - 이름표 "거리"를 네 언어 사전으로 옮기는지(일본어는 길거리 "通り"가 아니라 "距離")
 * - 실제 코어(가짜 캔버스)에 붙였을 때 한국어 화면은 코어 기본 글과 글자까지 같고, 다른 언어는 이름표만 바뀌는지(그린 글을 모아 견준다).
 *   커서는 선 끝을 정확히 가리키지 않는다(끝점 붙잡기로 붙는다)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { fixedNum, measureDigits, measureLabelFormat, measureLabelLines } from '../../src/app/measure-label';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions } from '../../src/app/refine';
import { translate } from '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

const box = (lo: number[], hi: number[]) => ({ min: lo as [number, number, number], max: hi as [number, number, number] });

describe('측정 글상자 글(순수)', () => {
  it('자릿수는 장면 범위 대각선으로(코어 규칙): 0~6자리, 빈 범위는 0자리', () => {
    expect(measureDigits(box([0, 0, 0], [100, 100, 100]))).toBe(3); // 대각선 173
    expect(measureDigits(box([0, 0, 0], [3000, 0, 0]))).toBe(2);
    expect(measureDigits(box([0, 0, 0], [0.5, 0, 0]))).toBe(6);
    expect(measureDigits(box([0, 0, 0], [1e-6, 0, 0]))).toBe(6);
    expect(measureDigits(box([0, 0, 0], [2e6, 0, 0]))).toBe(0);
    expect(measureDigits(box([5, 5, 5], [5, 5, 5]))).toBe(5); // 크기 0 — 1로 본다
    expect(measureDigits(box([Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]))).toBe(0);
    expect(fixedNum(-0.0001, 3)).toBe('0.000');
    expect(fixedNum(-0.001, 3)).toBe('-0.001');
    expect(fixedNum(12.3456, 2)).toBe('12.35');
  });

  it('두 줄: 거리·단위와 축별 길이, 이름표만 옮긴다', () => {
    const m = { distance: 50, dx: 40, dy: -30, dz: 0, units: 'mm' as const };
    expect(measureLabelLines(m, 3)).toEqual(['거리 50.000 mm', 'ΔX 40.000  ΔY -30.000  ΔZ 0.000']);
    expect(measureLabelLines({ ...m, units: 'inch' }, 4)[0]).toBe('거리 50.0000 in');
    expect(measureLabelLines({ ...m, units: 'unknown' }, 1)[0]).toBe('거리 50.0');
    const tr = (code: string) => (ko: string) => translate(ko, code);
    expect(measureLabelLines(m, 3, tr('en'))[0]).toBe('Distance 50.000 mm');
    expect(measureLabelLines(m, 3, tr('ja'))[0]).toBe('距離 50.000 mm');
    expect(measureLabelLines(m, 3, tr('zh-CN'))[0]).toBe('距离 50.000 mm');
    expect(measureLabelLines(m, 3, tr('de'))[0]).toBe('Abstand 50.000 mm');
    for (const code of ['en', 'ja', 'zh-CN', 'de']) expect(measureLabelLines(m, 3, tr(code))[1]).toBe('ΔX 40.000  ΔY -30.000  ΔZ 0.000');
  });
});

describe('실제 코어에 붙인 측정 글상자', () => {
  const texts: string[] = [];
  let restore: () => void;
  beforeAll(() => {
    restore = installCanvasFakes(800, 600);
    // 2D 문맥의 fillText를 모은다(가짜 문맥은 그리지 않는다)
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (this: HTMLCanvasElement, t: string) => unknown };
    const fake = proto.getContext;
    proto.getContext = function (t: string) {
      const c = fake.call(this, t) as object | null;
      if (t !== '2d' || !c) return c;
      return new Proxy(c, { get: (o, k) => (k === 'fillText' ? (s: string) => texts.push(String(s)) : Reflect.get(o, k)) });
    };
  });
  afterAll(() => restore());

  const ARC = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G1 X60 Y45', 'G0 X100 Y60', 'G1 X120 Y20'].join('\n');

  /** (60,45)·(100,60) 끝점을 재고 마지막 그리기의 글상자 글(거리·축 줄)을 돌려준다 */
  function measure(lang: string | null, units?: 'inch'): { lines: string[]; rect: unknown } {
    const r = parseForView('a.nc', new TextEncoder().encode(units ? ARC.replace('G21', 'G20') : ARC));
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    const v = new Viewer3d(host, { animate: false });
    v.setScene(r.scene);
    v.setView('top', false);
    v.fit(false);
    v.setMeasureMode(true);
    v.setMeasureSnap(ncSnapOptions(r.nc!, arcCenters(r.nc!), null, (r.scene.meta as { arcAngle?: number }).arcAngle));
    if (lang) v.setMeasureFormat(measureLabelFormat(v, () => lang));
    const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
    const ptr = (type: string, p: readonly number[]): void => {
      const s = v.project(p)!;
      const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      v.canvas.dispatchEvent(e);
    };
    for (const p of [[60.2, 45.1, 0], [100.2, 60.1, 0]]) {
      ptr('pointermove', p);
      ptr('pointerdown', p);
      ptr('pointerup', p);
      v.renderNow();
      lock.update();
    }
    expect(v.measurePointCount).toBe(2);
    texts.length = 0;
    v.renderNow();
    const lines = texts.filter((t) => /ΔX|\d+\.\d+ (mm|in)$/.test(t));
    const rect = v.measureLabelRect;
    v.dispose();
    return { lines, rect };
  }

  it('한국어 화면은 코어 기본 글과 같고, 다른 언어는 이름표만 바뀐다', () => {
    const core = measure(null);
    expect(core.lines.length).toBe(2);
    expect(core.lines[0]).toMatch(/^거리 42\.72\d* mm$/);
    const ko = measure('ko');
    expect(ko.lines).toEqual(core.lines);
    expect(ko.rect).toEqual(core.rect);
    const want: Record<string, string> = { en: 'Distance', ja: '距離', 'zh-CN': '距离', de: 'Abstand' };
    for (const [code, word] of Object.entries(want)) {
      const x = measure(code);
      expect(x.lines, code).toEqual([core.lines[0]!.replace('거리', word), core.lines[1]]);
    }
  });

  it('인치 문서는 in, 한국어는 코어 기본과 같다', () => {
    const core = measure(null, 'inch');
    expect(core.lines[0]).toMatch(/ in$/);
    expect(measure('ko', 'inch').lines).toEqual(core.lines);
    expect(measure('en', 'inch').lines[0]).toBe(core.lines[0]!.replace('거리', 'Distance'));
  });
});
