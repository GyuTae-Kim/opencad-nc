// @vitest-environment jsdom
/**
 * 코어 측정 거리 글상자의 글(32차 — measure-label.ts, 코어 setMeasureFormat; 33차 — 코어 0.31.0 글 꼴의 둘째 인자 MeasureFormatCore):
 * - 이름표 "거리"만 네 언어 사전으로 옮기고(일본어는 길거리 "通り"가 아니라 "距離") 수·단위·축별 줄은 코어가 넘긴 것 그대로인지(순수 — 코어 인자를 흉내)
 * - 실제 코어(가짜 캔버스)에 붙였을 때 한국어 화면은 코어 기본 글과 글자까지 같고, 다른 언어는 이름표만 바뀌는지(그린 글을 모아 견준다 — mm·인치).
 *   커서는 선 끝을 정확히 가리키지 않는다(끝점 붙잡기로 붙는다)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureFormat, type MeasureFormatCore } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { measureLabelFormat } from '../../src/app/measure-label';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions } from '../../src/app/refine';
// 네 언어 사전을 넣는다(앱은 src/app/i18n.ts가 넣는다 — measure-label.ts는 번역기만 쓴다)
import '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

/** 코어가 넘기는 둘째 인자 흉내(소수 digits자리, "-0"은 "0") */
function core(digits: number, unit: string, lines: string[], source: MeasureFormatCore['source'] = 'measure'): MeasureFormatCore {
  const num = (v: number): string => {
    const s = v.toFixed(digits);
    return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
  };
  return { lines, num, digits, unit, source };
}

describe('측정 글상자 글(순수 — 코어 인자 흉내)', () => {
  const m = { distance: 50, dx: 40, dy: -30, dz: -0.0001, units: 'mm' } as unknown as Parameters<MeasureFormat>[0];
  const LINES = ['거리 50.000 mm', 'ΔX 40.000  ΔY -30.000  ΔZ 0.000'];

  it('한국어는 코어 기본 줄과 같고, 다른 언어는 이름표만 바뀐다(둘째 줄은 코어 줄 그대로)', () => {
    expect(measureLabelFormat(() => 'ko')(m, core(3, 'mm', LINES))).toEqual(LINES);
    const want: Record<string, string> = { en: 'Distance', ja: '距離', 'zh-CN': '距离', de: 'Abstand' };
    for (const [code, word] of Object.entries(want)) expect(measureLabelFormat(() => code)(m, core(3, 'mm', LINES)), code).toEqual([`${word} 50.000 mm`, LINES[1]]);
  });

  it('수는 코어 수 꼴(c.num — 자릿수), 단위는 코어 단위 글(c.unit — 모르면 없음)', () => {
    expect(measureLabelFormat(() => 'en')(m, core(4, 'in', ['거리 50.0000 in', 'ΔX …']))).toEqual(['Distance 50.0000 in', 'ΔX …']);
    expect(measureLabelFormat(() => 'de')(m, core(1, '', ['거리 50.0', 'ΔX …']))).toEqual(['Abstand 50.0', 'ΔX …']);
    // "-0"도 코어 수 꼴이 맡는다
    expect(measureLabelFormat(() => 'en')({ ...m, distance: -0.0001 }, core(3, 'mm', LINES))[0]).toBe('Distance 0.000 mm');
    // 코어가 줄을 더 주면 둘째 줄부터 그대로
    expect(measureLabelFormat(() => 'ja')(m, core(0, 'mm', ['거리 50 mm', 'a', 'b']))).toEqual(['距離 50 mm', 'a', 'b']);
  });

  it('글을 주지 않은 거리 덧그림(annotation)은 코어 줄 그대로', () => {
    expect(measureLabelFormat(() => 'en')(m, core(3, 'mm', ['50.000 mm'], 'annotation'))).toEqual(['50.000 mm']);
  });

  it('언어는 그릴 때마다 읽는다(기본은 문서 언어 — 없으면 한국어)', () => {
    let lang = 'ko';
    const f = measureLabelFormat(() => lang);
    expect(f(m, core(3, 'mm', LINES))[0]).toBe('거리 50.000 mm');
    lang = 'en';
    expect(f(m, core(3, 'mm', LINES))[0]).toBe('Distance 50.000 mm');
    document.documentElement.lang = 'zh-CN';
    expect(measureLabelFormat()(m, core(3, 'mm', LINES))[0]).toBe('距离 50.000 mm');
    document.documentElement.lang = '';
    expect(measureLabelFormat()(m, core(3, 'mm', LINES))[0]).toBe('거리 50.000 mm');
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

  /** (60,45)·(100,60) 끝점을 재고 마지막 그리기의 글상자 글(거리·축 줄)과 코어가 넘긴 둘째 인자를 돌려준다 */
  function measure(lang: string | null, units?: 'inch'): { lines: string[]; rect: unknown; core: MeasureFormatCore | null } {
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
    let seen: MeasureFormatCore | null = null;
    if (lang) {
      const f = measureLabelFormat(() => lang);
      v.setMeasureFormat((x, c) => ((seen = c), f(x, c)));
    }
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
    return { lines, rect, core: seen };
  }

  it('한국어 화면은 코어 기본 글·글상자 자리와 같고, 다른 언어는 이름표만 바뀐다', () => {
    const base = measure(null);
    expect(base.lines.length).toBe(2);
    expect(base.lines[0]).toMatch(/^거리 42\.72\d* mm$/);
    const ko = measure('ko');
    expect(ko.lines).toEqual(base.lines);
    expect(ko.rect).toEqual(base.rect);
    // 코어가 넘긴 기본 줄이 글 꼴이 없을 때 그린 글과 같다
    expect(ko.core).toMatchObject({ lines: base.lines, unit: 'mm', source: 'measure' });
    const want: Record<string, string> = { en: 'Distance', ja: '距離', 'zh-CN': '距离', de: 'Abstand' };
    for (const [code, word] of Object.entries(want)) {
      const x = measure(code);
      expect(x.lines, code).toEqual([base.lines[0]!.replace('거리', word), base.lines[1]]);
    }
  });

  it('인치 문서는 in, 한국어는 코어 기본과 같다', () => {
    const base = measure(null, 'inch');
    expect(base.lines[0]).toMatch(/ in$/);
    const ko = measure('ko', 'inch');
    expect(ko.lines).toEqual(base.lines);
    expect(ko.core).toMatchObject({ unit: 'in' });
    expect(measure('en', 'inch').lines[0]).toBe(base.lines[0]!.replace('거리', 'Distance'));
  });
});
