// @vitest-environment jsdom
/**
 * 같은 평면에서 원호 꼭대기에 거의 닿듯 지나는 축(22차 남은 일 — 코어 0.20.0 열린 교차 'axisEdge' open)의 재현 기록(23차)과 코어 0.23.0에서의 값(25차).
 * 23차(코어 0.20.0)에는 어느 확대에서도 원 위 교차가 붙지 않아 그 근거 값을 남겼고, 코어가 받는 한도를 바꿨다:
 * 0.22.0 둘째 힌트(한 토막 활꼴을 두 번 지날 수 있는 토막은 코어 점 거리 대신 토막 범위로 받는다)가 이 경우를 맡고, 0.23.0이 모든 열린 교차 후보로 넓혔다.
 * 이제 확대 12단 가운데 8단에서 원 위 교차에 붙고, 그 단은 아래 같은 셈에서 "코어 점에서의 한도"를 뺀 규칙(wide)이 붙는다고 한 단과 같다
 * (코어 tests/v0230.test.ts가 이 측정 모델을 옮겨 같은 값을 적는다).
 *
 * 합성 경로: 반지름 25 원호(중심 (0,0), 152.5° → −12.49° 시계 방향 — 33토막(한 토막 약 5°)이라 꼭대기 90°가 92.504°~87.504° 토막 가운데쯤)와
 * (40, 25 − δ)까지 급속 이동. 첫 점 (40, 25 − δ)의 X축은 꼭대기 토막의 현(y ≈ 24.9762)과 호 사이(활꼴)만 지나 현과 만나지 않는다.
 * 축이 원과 만나는 점은 x = √(25² − (25 − δ)²)(첫 점 쪽). 커서는 그 점에서 화면 (1, 2)화소 옆이다(선의 경계를 정확히 가리키지 않는다).
 *
 * 코어 0.20.0 열린 후보의 코어 점은 축 위에서 토막에 가장 가까운 점인데, 축과 현이 거의 나란해(현이 조금 기울었다) 현의 높은 쪽 끝(꼭짓점) 위다.
 * 0.20.0 받는 규칙은 앱이 준 원 위 점이 코어 점에서 붙잡기 거리(10화소) 안이어야 하므로, 붙으려면 커서가 그 꼭짓점에서 10화소 남짓 안이어야 하고
 * 그 자리에서는 꼭짓점(끝점 붙잡기 — 점 붙잡기가 먼저다)이 이긴다. 그래서 원 위 교차는 거의 붙지 않았다.
 * 확대 12단(1화소의 세계 길이 0.002~0.1)마다 실제 코어(가짜 WebGL 위 Viewer3d — 앱과 같은 붙잡기 선택)가 고른 것을 적고,
 * 받는 한도(코어 점에서 붙잡기 거리 안)를 "현 위 자리가 그 토막 안"(0.23.0 토막 범위 판정)으로만 두면 붙을 확대 수를 같은 셈으로 센다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions } from '../../src/app/refine';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const DEG = Math.PI / 180;
/** 시작·끝(소수 여섯째 자리 — 원호 가운데 점 70°는 꼭대기에서 멀다). 끝을 −12.49°로 둬 반올림한 좌표로도 33토막(⌈164.99° / 5°⌉) */
const S = [25 * Math.cos(152.5 * DEG), 25 * Math.sin(152.5 * DEG)].map((x) => +x.toFixed(6));
const E = [25 * Math.cos(-12.49 * DEG), 25 * Math.sin(-12.49 * DEG)].map((x) => +x.toFixed(6));
/** 해석기가 읽는 반지름(반올림한 시작점과 중심 사이) */
const R = Math.hypot(S[0]!, S[1]!);
const SNAP = 10;

type V2 = [number, number];
/** 확대 하나에서 실제로 붙은 것: o = 원 위 교차(열린 교차를 받음), v = 꼭짓점(끝점), a = 축 위 커서 자리(X축 방향), - = 그 밖 */
type Seen = 'o' | 'v' | 'a' | '-';

/**
 * 같은 셈(코어 0.20.0 openEdgeCandidates·openEdgeSnap 규칙을 이 경우로 — 위에서 본 평면, 1화소 = w): 축 y = yl과 꼭대기 토막 a → b,
 * 원 위 교차 q = (xi, yl), 커서 c. now = 0.20.0 규칙으로 열린 교차가 붙는지(꼭짓점이 커서에서 붙잡기 거리 안이면 꼭짓점이 먼저),
 * wide = 코어 점에서의 한도(후보 2 × 붙잡기 거리·받기 붙잡기 거리)를 빼면 붙는지(0.22.0 둘째 힌트 토막·0.23.0 열린 교차의 받는 규칙)
 */
function model(w: number, yl: number, a: V2, b: V2, c: V2): { now: boolean; wide: boolean; gapPx: number; corePx: number; vertexPx: number } {
  const xi = Math.sqrt(R * R - yl * yl);
  // 축과 거의 나란한 현: 가장 가까운 자리는 높은 쪽 끝(축 위 코어 점은 그 끝의 x)
  const hi = a[1] >= b[1] ? a : b;
  const gap = yl - hi[1];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tol = 0.5 * w;
  const core: V2 = [hi[0], yl];
  const q: V2 = [xi, yl];
  const px = (p: V2, s: V2): number => Math.hypot(p[0] - s[0], p[1] - s[1]) / w;
  const u = ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / (L * L);
  const inGap = gap > tol && gap <= Math.min(0.1 * L, SNAP * w);
  const inSeg = u >= 0 && u <= 1 && px(q, a) > 0.5 && px(q, b) > 0.5 && px(q, c) <= SNAP;
  const vertexPx = Math.min(px(c, a), px(c, b));
  const free = vertexPx > SNAP;
  return { now: inGap && inSeg && free && px(core, c) <= 2 * SNAP && px(q, core) <= SNAP, wide: inGap && inSeg && free, gapPx: gap / w, corePx: px(q, core), vertexPx };
}

function setup(d: number) {
  const text = ['G21 G90 G17', `G0 X${S[0]} Y${S[1]} Z0`, `G2 X${E[0]} Y${E[1]} I${-S[0]!} J${-S[1]!} F500`, `G0 X40 Y${(25 - d).toFixed(6)}`].join('\n');
  const r = parseForView('apex.nc', enc(text));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  v.setMeasureSnap(ncSnapOptions(r.nc!, arcCenters(r.nc!), null, (r.scene.meta as { arcAngle?: number }).arcAngle));
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  // 꼭대기 토막(장면 float32 꼭짓점 — 두 끝이 꼭대기 양쪽)
  const pos = r.scene.lines.find((l) => /^nc-cut/.test(l.id))!.positions;
  let apex: [V2, V2] | null = null;
  for (let i = 0; i + 5 < pos.length; i += 6) if (pos[i]! < 0 && pos[i + 3]! > 0 && pos[i + 1]! > 20) apex = [[pos[i]!, pos[i + 1]!], [pos[i + 3]!, pos[i + 4]!]];
  const ptr = (type: string, p: readonly number[], dx: number, dy: number): void => {
    const s = v.project(p)!;
    const e = new MouseEvent(type, { clientX: s.x + dx, clientY: s.y + dy, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[], dx: number, dy: number): void => {
    ptr('pointermove', p, dx, dy);
    v.renderNow();
    lock.update();
  };
  const click = (p: readonly number[]): void => {
    hover(p, 1, 1);
    ptr('pointerdown', p, 1, 1);
    ptr('pointerup', p, 1, 1);
    v.renderNow();
    lock.update();
  };
  /** 꼭대기 둘레를 1화소 = w(세계)쯤으로(화면 가로 800화소) — 실제 1화소 길이 */
  const zoom = (w: number): number => {
    const hw = 400 * w;
    const a = v.project([-hw, 25 - 0.75 * hw, 0])!;
    const b = v.project([hw, 25 + 0.75 * hw, 0])!;
    v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
    v.renderNow();
    const p0 = v.project([0, 25, 0])!;
    const p1 = v.project([1, 25, 0])!;
    return 1 / Math.abs(p1.x - p0.x);
  };
  return { v, apex: apex!, hover, click, zoom };
}

describe('같은 평면에서 원호 꼭대기에 거의 닿는 축(23차 재현 기록 → 코어 0.23.0 받는 한도)', () => {
  // 1화소의 세계 길이 0.002~0.1 사이 12단(곱 비 약 1.43)
  const steps = Array.from({ length: 12 }, (_, k) => 0.002 * Math.pow(50, k / 11));
  const rows: { d: number; seen: string; now: string; wide: string; minus: string }[] = [];
  /** 미리 보기 하나를 기호로(붙으면 원 위 — 축 위, 남은 두 좌표는 첫 점 그대로) */
  const sign = (h: ReturnType<typeof setup>['v']['measureHoverSnap'], yl: number): Seen => {
    if (h?.snap === 'endpoint') return 'v';
    if (h?.snap === 'axis' && h.axis === 'x' && h.segment && h.refined) {
      expect(h.point[1]).toBe(yl);
      expect(Math.abs(Math.hypot(h.point[0], h.point[1]) - R)).toBeLessThan(1e-6);
      return 'o';
    }
    return h?.snap === 'axis' && h.axis === 'x' && !h.segment ? 'a' : '-';
  };
  for (const d of [0.0001, 0.001, 0.003, 0.01]) {
    it(`δ = ${d}: 붙은 것을 적고, 열린 교차가 붙은 확대는 같은 셈(코어 점에서의 한도를 뺀 규칙)과 같다`, () => {
      const w = setup(d);
      const { v, apex } = w;
      // 꼭대기 토막은 87.5°·92.5° 둘레 꼭짓점, 높은 쪽 끝이 오른쪽(현이 조금 기울었다)
      expect(Math.atan2(apex[0][1], apex[0][0]) / DEG).toBeCloseTo(92.504, 2);
      expect(Math.atan2(apex[1][1], apex[1][0]) / DEG).toBeCloseTo(87.504, 2);
      expect(apex[1][1]).toBeGreaterThan(apex[0][1]);
      w.click([40, 25 - d, 0]);
      expect(v.measurePoints[0]).toMatchObject({ point: [40, Math.fround(25 - d), 0], snap: 'endpoint' });
      const yl = v.measurePoints[0]!.point[1];
      const xi = Math.sqrt(R * R - yl * yl);
      let seen = '';
      let now = '';
      let wide = '';
      let minus = '';
      for (const s of steps) {
        const px = w.zoom(s);
        w.hover([xi, yl, 0], 1, 2);
        // 커서(세계): 원 위 교차에서 화면 (1, 2)화소 — 위에서 본 보기라 x는 +1화소, y는 −2화소
        const m = model(px, yl, apex[0], apex[1], [xi + px, yl - 2 * px]);
        seen += sign(v.measureHoverSnap, yl);
        now += m.now ? 'o' : '.';
        wide += m.wide ? 'o' : '.';
        // 같은 토막의 다른 교차(−xi — 코어 0.22.0 둘째 힌트)
        w.hover([-xi, yl, 0], 1, 2);
        minus += sign(v.measureHoverSnap, yl);
      }
      rows.push({ d, seen, now, wide, minus });
      // 열린 교차가 붙은 확대 = 같은 셈이 코어 점에서의 한도를 뺀 규칙으로 붙는다고 한 확대(0.20.0 규칙 now는 어느 단에서도 붙지 않는다)
      expect(seen.replace(/[^o]/g, '.')).toBe(wide);
    });
  }

  it('기록: 코어 0.23.0은 12단 가운데 8단에서 원 위 교차에 붙는다(0.20.0 규칙으로는 0단 — 23차 기록)', () => {
    // 23차(코어 0.20.0)에 본 값(확대가 작은 쪽부터): δ 0.0001·0.001 'aaaaaaaaaaav', 0.003 'aaaaaaaaaavv', 0.01 'aaaaaaaaavvv'
    // (a = X축 방향 커서 자리, v = 꼭짓점 끝점, o = 원 위 교차). 25차(0.23.0): 앞 1단(δ 0.01은 0단)은 틈이 붙잡기 거리보다 넓어 커서 자리,
    // 뒤 3~4단은 틈이 반 화소 아래이거나 꼭짓점이 커서에서 붙잡기 거리 안이라 커서 자리·끝점이다(코어 v0.23.0 README의 12단 가운데 8단)
    expect(rows.map((r) => r.d)).toEqual([0.0001, 0.001, 0.003, 0.01]);
    expect(rows.map((r) => r.seen)).toEqual(['aooooooooaav', 'aooooooooaav', 'aooooooooavv', 'ooooooooavvv']);
    for (const r of rows) expect(r.now).toBe('............');
    // 넓힌 규칙: 틈이 반~10화소이고 꼭짓점이 붙잡기 거리 밖인 확대(앞 1단은 틈이 10화소를 넘고, 뒤 3~4단은 틈이 반 화소 아래거나 꼭짓점이 가깝다)
    expect(rows.map((r) => r.wide)).toEqual(['.oooooooo...', '.oooooooo...', '.oooooooo...', 'oooooooo....']);
    // 다른 교차(첫 점에서 먼 쪽 −xi)도 같은 8단에서 붙는다 — 앱 refine이 열린 후보의 둘째 힌트(현의 다른 끝 발)를 그 둘레 근으로 풀어 준다
    expect(rows.map((r) => r.minus.replace(/[^o]/g, '.'))).toEqual(rows.map((r) => r.wide));
  });
});
