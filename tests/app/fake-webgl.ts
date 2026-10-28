/**
 * 시험용 가짜 WebGL2·2D 캔버스 문맥(jsdom에서 실제 3D 뷰어 코어를 만들어 고르기·측정 판정을 돌린다 — 그림은 그리지 않는다).
 * 코어의 시험 도우미(tests/fakegl.ts)를 줄인 것: 대문자 이름은 상수, 그 밖의 함수는 아무것도 하지 않고, 셰이더·틀 버퍼는 늘 성공한다.
 * 2D 문맥의 글 폭은 글자 수 × 7화소(코어 측정 거리 글상자 크기가 글에 따라 바뀌게).
 * installCanvasFakes()가 HTMLCanvasElement·요소 크기·ResizeObserver·matchMedia·포인터 잡기를 깔고, 돌려준 함수로 걷는다.
 */
import { vi } from 'vitest';

function fakeGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const consts = new Map<string, number>();
  const C = (k: string): number => {
    let v = consts.get(k);
    if (v === undefined) consts.set(k, (v = 0x1000 + consts.size));
    return v;
  };
  let ids = 0;
  const obj = (): object => ({ id: ++ids });
  const base: Record<string, unknown> = {
    canvas,
    get drawingBufferWidth() {
      return canvas.width;
    },
    get drawingBufferHeight() {
      return canvas.height;
    },
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getUniformLocation: obj,
    getAttribLocation: () => 0,
    getContextAttributes: () => ({ stencil: true }),
    getExtension: () => null,
    isContextLost: () => false,
    checkFramebufferStatus: () => C('FRAMEBUFFER_COMPLETE'),
    getParameter: (p: number) =>
      p === C('MAX_TEXTURE_SIZE') || p === C('MAX_RENDERBUFFER_SIZE') ? 4096 : p === C('MAX_VIEWPORT_DIMS') ? new Int32Array([4096, 4096]) : p === C('MAX_SAMPLES') ? 4 : 0,
  };
  return new Proxy(base, {
    get: (t, k) => {
      if (typeof k !== 'string' || k in t) return t[k as string];
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return C(k);
      return k.startsWith('create') ? obj : () => undefined;
    },
  }) as unknown as WebGL2RenderingContext;
}

function fake2d(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif', globalAlpha: 1 };
  const grad = { addColorStop() {} };
  return new Proxy(store, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 });
      return () => grad;
    },
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** 캔버스 문맥·모든 요소 크기(왼쪽 위 0, w × h)·ResizeObserver·matchMedia·포인터 잡기를 가짜로 깐다 */
export function installCanvasFakes(w = 800, h = 600): () => void {
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const el = Element.prototype as unknown as Record<string, unknown>;
  const saved = { getContext: proto.getContext, rect: el.getBoundingClientRect, set: el.setPointerCapture, rel: el.releasePointerCapture, has: el.hasPointerCapture };
  proto.getContext = function (this: HTMLCanvasElement, type: string) {
    const self = this as unknown as { __gl?: WebGL2RenderingContext };
    if (type === 'webgl2') return (self.__gl ??= fakeGL(this));
    return type === '2d' ? fake2d() : null;
  };
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON() {} });
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  el.hasPointerCapture = () => false;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  return () => {
    proto.getContext = saved.getContext;
    el.getBoundingClientRect = saved.rect;
    el.setPointerCapture = saved.set;
    el.releasePointerCapture = saved.rel;
    el.hasPointerCapture = saved.has;
    vi.unstubAllGlobals();
  };
}
