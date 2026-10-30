/**
 * 축이 면을 뚫는 점 다듬기(21차 — 3D 뷰어 코어 0.19.0 refineFace 'axisFace'): 첫 점 축·끌어온 축·잠근 축이 판재 그물의 원기둥 벽
 * (판 외곽선 둥근 모서리, 수평·수직 구멍 벽, 원형 포켓 벽, 둥근 사각 포켓 모서리)을 나눈 삼각형과 만나는 코어 점을 축 직선과 그 원기둥의 정확한 교차점으로 옮긴다.
 * 코어 점은 진짜 장면 그물의 삼각형에서 코어처럼 구한다(축 직선과 맞은 삼각형 평면의 교차, 법선은 float32 꼭짓점의 외적) — 진짜 코어 판정은 measure-face-core.test.ts.
 * 답을 아는 합성 판(PGI): 400 × 300 × 18, 오른쪽 앞 모서리 R50(중심 (350,50)), 왼쪽면 수평 구멍 Ø8(y 20, z 9, 깊이 30), 수직 구멍 Ø20(중심 (300,200), 깊이 12),
 * 원형 포켓 Ø40(중심 (100,150), 깊이 10), 수직 구멍 Ø10(중심 (150,22), 깊이 12), 둥근 사각 포켓 60 × 40 R10(중심 (200,60), 깊이 5).
 * 평면(윗면·곧은 옆면·구멍 바닥), 기둥과 나란한 축, 모르는 그물·종류는 null(코어 점 그대로).
 */
import { describe, expect, it } from 'vitest';
import type { Mesh3d, SnapRefineFaceInput } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { ncSnapOptions, panelSnapOptions, panelWalls, refineFaceSnap } from '../../src/app/refine';
import { arcCenters } from '../../src/app/snap';

type V3 = [number, number, number];
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const AX: Record<'x' | 'y' | 'z', V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(...sub(a, b));

const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <outlines>
   <outline x="0" y="0" bulge="0" banding="0"/>
   <outline x="350" y="0" bulge="0.41421356237309503" banding="0"/>
   <outline x="400" y="50" bulge="0" banding="0"/>
   <outline x="400" y="300" bulge="0" banding="0"/>
   <outline x="0" y="300" bulge="0" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0"/>
  </outlines>
  <hole x="0" y="20" z="9" diameter="8" depth="30" direction="x+" enable="1" order="1"/>
  <circle centerX="300" centerY="200" centerZ="0" radius="10" width="20" depth="12" direction="z-" empty="1" enable="1" order="2"/>
  <circle centerX="100" centerY="150" centerZ="0" radius="20" width="8" depth="10" direction="z-" empty="1" enable="1" order="3"/>
  <hole x="150" y="22" z="0" diameter="10" depth="12" direction="z-" enable="1" order="4"/>
  <pocket length="60" width="40" depth="5" direction="z-" cornerRadius="10" angle="0" centerX="200" centerY="60" centerZ="0" enable="1" order="5"/>
 </panel>
</pgi>`;

const r = parseForView('p.pgi', enc(PANEL));
const t = r.mpr!.snap!;
const meshOf = (name: RegExp): Mesh3d => r.scene.meshes.find((m) => name.test(m.name ?? ''))!;

/**
 * 코어처럼(0.18.0 axisFaceSnap): 축 직선(지나는 점 o, 세계 축)이 그물 삼각형 평면과 만나는 점 가운데 삼각형 안이고 guess에 가장 가까운 것 —
 * 평면 위 점은 첫 꼭짓점, 법선은 float32 꼭짓점 외적(눈 쪽은 상관없다 — 앱은 부호를 보지 않는다).
 * axis 대신 방향(수 셋)을 주면 코어 0.20.0의 축이 아닌 잠근 선(단위 방향, line.axis 없음)
 */
function coreFace(m: Mesh3d, o: readonly number[], axis: 'x' | 'y' | 'z' | readonly number[], guess: readonly number[]): SnapRefineFaceInput {
  const raw = typeof axis === 'string' ? AX[axis] : axis;
  const dl = Math.hypot(raw[0]!, raw[1]!, raw[2]!);
  const d: V3 = [raw[0]! / dl, raw[1]! / dl, raw[2]! / dl];
  const P = m.positions;
  const I = m.indices!;
  let best: { p: V3; n: V3; i: number } | null = null;
  for (let k = 0; k + 2 < I.length; k += 3) {
    const [a, b, c] = [I[k]!, I[k + 1]!, I[k + 2]!].map((j) => [P[j * 3]!, P[j * 3 + 1]!, P[j * 3 + 2]!] as V3);
    const nn = cross(sub(b!, a!), sub(c!, a!));
    const l = Math.hypot(...nn);
    if (!(l > 0)) continue;
    const n: V3 = [nn[0] / l, nn[1] / l, nn[2] / l];
    const den = dot(n, d);
    if (Math.abs(den) < 1e-9) continue;
    const s = dot(n, sub(a!, o)) / den;
    const p: V3 = [o[0]! + d[0] * s, o[1]! + d[1] * s, o[2]! + d[2] * s];
    // 삼각형 안(무게중심 좌표, 조금 넉넉히)
    const v0 = sub(b!, a!), v1 = sub(c!, a!), v2 = sub(p, a!);
    const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
    const den2 = d00 * d11 - d01 * d01;
    const v = (d11 * d20 - d01 * d21) / den2;
    const w = (d00 * d21 - d01 * d20) / den2;
    if (v < -1e-7 || w < -1e-7 || v + w > 1 + 1e-7) continue;
    if (!best || dist(p, guess) < dist(best.p, guess)) best = { p, n, i: k / 3 };
  }
  expect(best, `${m.id}: 축이 그물을 뚫지 않음`).toBeTruthy();
  const line = typeof axis === 'string' ? { origin: [...o] as V3, dir: [...d] as V3, axis } : { origin: [...o] as V3, dir: [...d] as V3 };
  return { kind: 'axisFace', point: best!.p, face: { id: m.id, index: best!.i, normal: best!.n }, line, first: [...o] as V3, ray: { origin: [0, 0, 100], dir: [0, 0, -1] } };
}

/** 다듬은 점 q가 축 직선 위(남은 두 좌표가 지나는 점 그대로)인지 */
const onAxis = (q: readonly number[], o: readonly number[], axis: 'x' | 'y' | 'z'): boolean => ['x', 'y', 'z'].every((a, i) => a === axis || q[i] === o[i]);

describe('판재 원기둥 벽(붙잡기 표의 위·아래 고리 한 쌍)', () => {
  it('판 외곽선 R50, 구멍·원형 포켓(한 바퀴), 둥근 사각 포켓 모서리 넷: 중심·반지름·높이 범위', () => {
    const w = (re: RegExp) => panelWalls(t, meshOf(re).id).map((x) => ({ a2: x.a2, c: [x.cu, x.cv].map((v) => +v.toFixed(9)), r: +x.r.toFixed(9), lo: x.lo, hi: x.hi, turn: Math.abs(x.sweep) > 6 }));
    expect(w(/^판/)).toEqual([{ a2: 2, c: [350, 50], r: 50, lo: 0, hi: 18, turn: false }]);
    expect(w(/수평 드릴/)).toEqual([{ a2: 0, c: [20, 9], r: 4, lo: 0, hi: 30, turn: true }]);
    expect(w(/Ø20/)).toEqual([{ a2: 2, c: [300, 200], r: 10, lo: 6, hi: 18, turn: true }]);
    expect(w(/원형 포켓/)).toEqual([{ a2: 2, c: [100, 150], r: 20, lo: 8, hi: 18, turn: true }]);
    expect(w(/Ø10/)).toEqual([{ a2: 2, c: [150, 22], r: 5, lo: 6, hi: 18, turn: true }]);
    expect(w(/^포켓/).map((x) => x.c)).toEqual([[220, 50], [220, 70], [180, 70], [180, 50]]);
    expect(w(/^포켓/).every((x) => x.r === 10 && x.lo === 13 && x.hi === 18 && !x.turn)).toBe(true);
    expect(panelWalls(t, 'nc-stock')).toEqual([]);
  });
});

describe('축이 원기둥 벽을 뚫는 점(정확한 원기둥 위, 남은 좌표가 지나는 점 그대로)', () => {
  const cases: { name: string; mesh: RegExp; o: V3; axis: 'x' | 'y' | 'z'; want: V3 }[] = [
    // 판 모서리 R50: y = 20(−36.87° — 현 −40°→−35°) → x = 350 + 40
    { name: '판 외곽선 R50 × X축', mesh: /^판/, o: [0, 20, 9], axis: 'x', want: [390, 20, 9] },
    { name: '판 외곽선 R50 × Y축', mesh: /^판/, o: [380, 300, 4], axis: 'y', want: [380, 10, 4] },
    // 수직 구멍 Ø20: x = 306 → y = 200 ± 8(들어가는 벽·나오는 벽)
    { name: '구멍 Ø20 × Y축(먼 벽)', mesh: /Ø20/, o: [306, 0, 12], axis: 'y', want: [306, 208, 12] },
    { name: '구멍 Ø20 × Y축(가까운 벽)', mesh: /Ø20/, o: [306, 0, 12], axis: 'y', want: [306, 192, 12] },
    // 수직 구멍 Ø10(중심 (150,22)): 옆면 구멍 중심 (0,20,9)에서 X축 → x = 150 + √21(23.6° — 현 18°→36°)
    { name: '구멍 Ø10 × X축(첫 점이 옆면 구멍 중심)', mesh: /Ø10/, o: [0, 20, 9], axis: 'x', want: [150 + Math.sqrt(21), 20, 9] },
    // 수평 구멍 Ø8(기둥 방향 X, 평면 YZ): x = 10에서 Z축 y = 22 → z = 9 ± √12, Y축 z = 11 → y = 20 ± √12
    { name: '수평 구멍 × Z축', mesh: /수평 드릴/, o: [10, 22, 0], axis: 'z', want: [10, 22, 9 + Math.sqrt(12)] },
    { name: '수평 구멍 × Y축', mesh: /수평 드릴/, o: [10, 0, 11], axis: 'y', want: [10, 20 - Math.sqrt(12), 11] },
    // 원형 포켓 Ø40: y = 162 → x = 100 ± 16
    { name: '원형 포켓 × X축', mesh: /원형 포켓/, o: [0, 162, 13], axis: 'x', want: [84, 162, 13] },
    // 둥근 사각 포켓 모서리(중심 (220,70) R10): y = 76 → x = 228
    { name: '둥근 사각 포켓 모서리 × X축', mesh: /^포켓/, o: [0, 76, 15], axis: 'x', want: [228, 76, 15] },
  ];
  for (const c of cases)
    it(c.name, () => {
      const inp = coreFace(meshOf(c.mesh), c.o, c.axis, c.want);
      // 코어 점은 삼각형(현) 위라 원기둥에서 처짐만큼 벗어난다
      expect(dist(inp.point, c.want)).toBeGreaterThan(1e-4);
      expect(dist(inp.point, c.want)).toBeLessThan(0.2);
      const q = refineFaceSnap(inp, t)!;
      expect(q).toBeTruthy();
      expect(onAxis(q, c.o, c.axis)).toBe(true);
      expect(dist(q, c.want)).toBeLessThan(1e-9);
      // 결과는 커서 광선과 상관없다
      expect(refineFaceSnap({ ...inp, ray: { origin: [1, 2, 3], dir: [0, 1, 0] } }, t)).toEqual(q);
    });
});

describe('기운 잠근 선이 원기둥 벽을 뚫는 점(22차 — 코어 0.20.0 나란함·수직·접선 잠금, line.axis 없음)', () => {
  /** 점 q에서 직선(o, 단위 방향 d)까지 거리 */
  const offLine = (q: readonly number[], o: readonly number[], d: readonly number[]): number => Math.hypot(...cross(sub(q, o), d));
  /** 직선 o + s·e(e 단위)가 Z 방향 원기둥(중심 (cx, cy), 반지름 r)을 나가는 근(큰 s) */
  const exitZ = (o: readonly number[], dir: readonly number[], cx: number, cy: number, r: number): V3 => {
    const l = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
    const e = dir.map((x) => x / l);
    const A = e[0]! ** 2 + e[1]! ** 2;
    const B = (o[0]! - cx) * e[0]! + (o[1]! - cy) * e[1]!;
    const C = (o[0]! - cx) ** 2 + (o[1]! - cy) ** 2 - r * r;
    const s = (-B + Math.sqrt(B * B - A * C)) / A;
    return [o[0]! + e[0]! * s, o[1]! + e[1]! * s, o[2]! + e[2]! * s];
  };
  const cases: { name: string; mesh: RegExp; o: V3; dir: V3; want: V3 }[] = [
    { name: '판 외곽선 R50 × 비탈진 선(1, 0.02, 0.01)', mesh: /^판/, o: [0, 20, 9], dir: [1, 0.02, 0.01], want: exitZ([0, 20, 9], [1, 0.02, 0.01], 350, 50, 50) },
    { name: '판 외곽선 R50 × 수평으로 기운 선(1, 0.02, 0)', mesh: /^판/, o: [0, 20, 9], dir: [1, 0.02, 0], want: exitZ([0, 20, 9], [1, 0.02, 0], 350, 50, 50) },
    // 수직 구멍 Ø10: 단면에 비춘 선은 y = 20 그대로 — x = 150 + √21, 높이는 그 자리까지 오른 만큼
    { name: '구멍 Ø10 × 비탈진 선(1, 0, 0.02)', mesh: /Ø10/, o: [0, 20, 9], dir: [1, 0, 0.02], want: [150 + Math.sqrt(21), 20, 9 + 0.02 * (150 + Math.sqrt(21))] },
    // 수평 구멍 Ø8(기둥 방향 X): 단면(YZ)에 비춘 선은 y = 22 그대로 — z = 9 + √12, x는 그 높이까지 간 만큼
    { name: '수평 구멍 × 기운 선(0.1, 0, 1)', mesh: /수평 드릴/, o: [10, 22, 0], dir: [0.1, 0, 1], want: [10 + 0.1 * (9 + Math.sqrt(12)), 22, 9 + Math.sqrt(12)] },
  ];
  for (const c of cases)
    it(c.name, () => {
      const inp = coreFace(meshOf(c.mesh), c.o, c.dir, c.want);
      expect(inp.line.axis).toBeUndefined();
      expect(dist(inp.point, c.want)).toBeGreaterThan(1e-4);
      expect(dist(inp.point, c.want)).toBeLessThan(0.2);
      const q = refineFaceSnap(inp, t)!;
      expect(q).toBeTruthy();
      expect(dist(q, c.want)).toBeLessThan(1e-9);
      expect(offLine(q, inp.line.origin, inp.line.dir)).toBeLessThan(1e-9);
    });

  it('가파른 선: 벽 높이 안에서 뚫으면 원기둥 위, 뚫는 점이 벽 위·아래 밖이면(판 윗면 위) null, 기둥과 거의 나란하면 null', () => {
    const base = coreFace(meshOf(/^판/), [0, 20, 9], 'x', [390, 20, 9]);
    const p = base.point;
    const steep = (dx: number): SnapRefineFaceInput => {
      const l = Math.hypot(dx, 0, 1);
      const d: V3 = [dx / l, 0, 1 / l];
      return { ...base, line: { origin: [p[0] - d[0] * 5, p[1], p[2] - d[2] * 5], dir: d } };
    };
    // (0.05, 0, 1): 현에서 원기둥까지 x로 몇 백분의 1 — 높이는 1 남짓 오른다
    const ok = steep(0.05);
    const q = refineFaceSnap(ok, t)!;
    expect(q).toBeTruthy();
    expect(Math.abs(Math.hypot(q[0] - 350, q[1] - 50) - 50)).toBeLessThan(1e-9);
    expect(offLine(q, ok.line.origin, ok.line.dir)).toBeLessThan(1e-9);
    expect(q[2]).toBeGreaterThan(9);
    expect(q[2]).toBeLessThan(18);
    // (0.002, 0, 1): 같은 만큼 바깥으로 가는 동안 높이가 판 두께(18)를 넘는다
    expect(refineFaceSnap(steep(0.002), t)).toBeNull();
    expect(refineFaceSnap(steep(1e-6), t)).toBeNull();
  });
});

describe('25차: 커서 광선이 원기둥 벽을 맞은 점(코어 0.21.0 onFace — 붙잡지 않은 면 위 점, line = 커서 광선)', () => {
  /** 코어 0.21.0처럼: 눈 eye에서 to를 향한 커서 광선이 그물을 맞은 삼각형 위 점(to에 가까운 것) — line·ray 모두 커서 광선, 축 이름 없음 */
  const rayFace = (m: Mesh3d, eye: V3, to: V3): SnapRefineFaceInput => {
    const inp = coreFace(m, eye, sub(to, eye), to);
    const ray = { origin: inp.line.origin, dir: inp.line.dir };
    return { ...inp, kind: 'onFace', line: ray, ray, first: null };
  };
  const D = Math.PI / 180;
  /** 광선(눈 eye, 단위 방향 d) 위 점인지 */
  const offRay = (q: readonly number[], eye: readonly number[], to: readonly number[]): number => {
    const d = sub(to, eye);
    const l = Math.hypot(...d);
    return Math.hypot(...cross(sub(q, eye), [d[0] / l, d[1] / l, d[2] / l]));
  };
  const cases: { name: string; mesh: RegExp; eye: V3; want: V3 }[] = [
    // 위에서 비스듬히 구멍 Ø20(중심 (300,200), Z 6~18)을 들여다보면 맞은편 벽: 광선이 원기둥을 나가는 근
    { name: '구멍 Ø20 맞은편 벽(오목 — 광선이 나가는 근)', mesh: /Ø20/, eye: [260, 195, 60], want: [300 + 10 * Math.cos(12 * D), 200 + 10 * Math.sin(12 * D), 12] },
    // 판 바깥에서 오른쪽 앞 R50 둥근 모서리(중심 (350,50), Z 0~18)를 보면 앞쪽 근
    { name: '판 외곽선 R50(볼록 — 광선이 먼저 닿는 근)', mesh: /^판/, eye: [500, -100, 40], want: [350 + 50 * Math.cos(-33 * D), 50 + 50 * Math.sin(-33 * D), 9] },
    // 왼쪽면 수평 구멍 Ø8(기둥 방향 X, 중심 y 20 · z 9)을 옆에서 들여다본 벽
    { name: '수평 구멍 Ø8 안쪽 벽', mesh: /수평 드릴/, eye: [-40, 20.5, 9.5], want: [15, 20 + 4 * Math.cos(70 * D), 9 + 4 * Math.sin(70 * D)] },
    // 원형 포켓 Ø40(중심 (100,150), Z 8~18) 맞은편 벽
    { name: '원형 포켓 맞은편 벽', mesh: /원형 포켓/, eye: [60, 150, 50], want: [100 + 20 * Math.cos(-8 * D), 150 + 20 * Math.sin(-8 * D), 12] },
  ];
  for (const c of cases)
    it(c.name, () => {
      const inp = rayFace(meshOf(c.mesh), c.eye, c.want);
      // 맞은 점은 삼각형(현) 위라 원기둥에서 처짐만큼 벗어난다(벽을 비스듬히 보면 광선을 따라 처짐보다 길게 — 수평 구멍은 0.5 남짓)
      expect(dist(inp.point, c.want)).toBeGreaterThan(1e-4);
      expect(dist(inp.point, c.want)).toBeLessThan(1);
      const q = refineFaceSnap(inp, t)!;
      expect(q).toBeTruthy();
      expect(dist(q, c.want)).toBeLessThan(1e-9);
      expect(offRay(q, c.eye, c.want)).toBeLessThan(1e-9);
    });

  it('평면(판 윗면·곧은 옆면·구멍 바닥·포켓 바닥)과 모르는 그물은 null, 같은 자리의 축 다듬기(axisFace)는 그대로', () => {
    expect(refineFaceSnap(rayFace(meshOf(/^판/), [50, 40, 80], [52, 50, 18]), t)).toBeNull();
    expect(refineFaceSnap(rayFace(meshOf(/^판/), [100, -80, 30], [110, 0, 9]), t)).toBeNull();
    expect(refineFaceSnap(rayFace(meshOf(/Ø20/), [298, 199, 40], [302, 201, 6]), t)).toBeNull();
    expect(refineFaceSnap(rayFace(meshOf(/^포켓/), [195, 55, 40], [200, 60, 13]), t)).toBeNull();
    const wall = rayFace(meshOf(/Ø20/), [260, 195, 60], [300 + 10 * Math.cos(12 * D), 200 + 10 * Math.sin(12 * D), 12]);
    expect(refineFaceSnap({ ...wall, face: { ...wall.face, id: 'nc-stock' } }, t)).toBeNull();
    // 같은 입력을 축 다듬기로 넘기면 코어 점에 가까운 근 — 맞은편 벽 하나뿐이라 같은 점
    expect(refineFaceSnap({ ...wall, kind: 'axisFace' }, t)).toEqual(refineFaceSnap(wall, t));
  });
});

describe('25차: 축이 벽 삼각형을 비켜 가며 원기둥만 뚫는 자리(코어 0.22.0 면의 열린 교차 — axisFace open)', () => {
  // 판 위쪽 변에 볼록 호(중심 (200,260), R50, 37°→121° — 17토막, 꼭대기 90°가 86.412°~91.353° 토막 안이라 X축이 꼭대기를 그 현 바깥으로 스칠 수 있다)
  const D = Math.PI / 180;
  const at = (deg: number): number[] => [200 + 50 * Math.cos(deg * D), 260 + 50 * Math.sin(deg * D)].map((x) => +x.toFixed(6));
  const [A0, A1] = [at(37), at(121)];
  const BUMP = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <outlines>
   <outline x="0" y="0" bulge="0" banding="0"/>
   <outline x="400" y="0" bulge="0" banding="0"/>
   <outline x="400" y="300" bulge="0" banding="0"/>
   <outline x="${A0[0]}" y="${A0[1]}" bulge="${Math.tan(21 * D)}" banding="0"/>
   <outline x="${A1[0]}" y="${A1[1]}" bulge="0" banding="0"/>
   <outline x="0" y="300" bulge="0" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0"/>
  </outlines>
 </panel>
</pgi>`;
  const rb = parseForView('b.pgi', enc(BUMP));
  const tb = rb.mpr!.snap!;
  const board = rb.scene.meshes.find((m) => m.id === 'mpr-board')!;
  /** 법선 방향 각(도)이 deg인 옆면 삼각형들(꼭짓점·무게중심·법선 — float32 꼭짓점 외적, 바깥쪽) */
  const trisAt = (deg: number) => {
    const P = board.positions;
    const I = board.indices!;
    const out: { i: number; c: V3; n: V3; v: V3[] }[] = [];
    for (let k = 0; k + 2 < I.length; k += 3) {
      const v = [I[k]!, I[k + 1]!, I[k + 2]!].map((j) => [P[j * 3]!, P[j * 3 + 1]!, P[j * 3 + 2]!] as V3);
      const nn = cross(sub(v[1]!, v[0]!), sub(v[2]!, v[0]!));
      const l = Math.hypot(...nn);
      if (!(l > 0) || Math.abs(nn[2] / l) > 1e-6) continue;
      const n: V3 = [nn[0] / l, nn[1] / l, 0];
      const a = Math.atan2(n[1], n[0]) / D;
      const out_ = Math.abs(a - deg) < 0.01 ? n : Math.abs(Math.abs(a - deg) - 180) < 0.01 ? (n.map((x) => -x) as V3) : null;
      if (out_) out.push({ i: k / 3, c: [(v[0]![0] + v[1]![0] + v[2]![0]) / 3, (v[0]![1] + v[1]![1] + v[2]![1]) / 3, (v[0]![2] + v[1]![2] + v[2]![2]) / 3], n: out_, v });
    }
    return out;
  };
  /** 첫 점 o의 X축과 삼각형 tri의 열린 후보(코어 0.22.0처럼 — point = 선 위에서 무게중심에 가장 가까운 점), 커서 광선은 눈 eye에서 aim으로 */
  const openX = (o: V3, tri: { i: number; c: V3; n: V3 }, eye: V3, aim: V3): SnapRefineFaceInput => {
    const hint: V3 = [tri.c[0], o[1], o[2]];
    const dir = sub(aim, eye);
    const l = Math.hypot(...dir);
    return { kind: 'axisFace', open: true, point: hint, face: { id: board.id, index: tri.i, normal: tri.n }, line: { origin: o, dir: [1, 0, 0], axis: 'x' }, first: o, ray: { origin: eye, dir: [dir[0] / l, dir[1] / l, dir[2] / l] } };
  };
  // 꼭대기 토막(86.412°~91.353°)의 가운데 각
  const MID = (86.412 + 91.353) / 2;
  const YL = 309.995;
  // 해석기가 읽은 벽(반올림한 시작·끝점에서 구한 중심·반지름)과 X축(y = YL)의 두 교차
  const W = panelWalls(tb, 'mpr-board')[0]!;
  const S = Math.sqrt(W.r * W.r - (YL - W.cv) ** 2);
  const Q1: V3 = [W.cu - S, YL, 3];
  const Q2: V3 = [W.cu + S, YL, 3];
  const EYE = (q: V3): V3 => [q[0] + 0.3, 400, q[2] + 0.2];

  it('전제: 꼭대기 토막 삼각형 둘, X축(y = 309.995)은 그 현과 만나지 않고 두 근 모두 그 토막 각 안이다. 한 삼각형의 무게중심 쪽 힌트는 원기둥 밖이다', () => {
    expect(panelWalls(tb, 'mpr-board')).toHaveLength(1);
    expect(Math.abs(W.r - 50)).toBeLessThan(1e-4);
    const tris = trisAt(MID);
    expect(tris).toHaveLength(2);
    for (const q of [Q1, Q2]) {
      const a = Math.atan2(q[1] - 260, q[0] - 200) / D;
      expect(a).toBeGreaterThan(86.412);
      expect(a).toBeLessThan(91.353);
    }
    // 현(두 꼭짓점의 y)은 모두 선보다 아래 — 선은 현 바깥(활꼴)만 지난다
    for (const tri of tris) for (const v of tri.v) expect(v[1]).toBeLessThan(YL);
    const rho = tris.map((tri) => Math.hypot(tri.c[0] - 200, YL - 260));
    expect(Math.min(...rho)).toBeLessThan(50);
    expect(Math.max(...rho)).toBeGreaterThan(50);
  });

  it('두 삼각형 어느 힌트로 불려도 그 힌트에 가까운 근(원기둥 위, 축 위 — 남은 좌표는 첫 점 그대로), 커서 광선과 상관없다(코어가 광선 없는 열쇠로 기억한다)', () => {
    const o: V3 = [100, YL, 3];
    for (const tri of trisAt(MID)) {
      const r = refineFaceSnap(openX(o, tri, EYE(Q2), Q2), tb)!;
      expect(r, `${tri.i}`).toBeTruthy();
      // 두 힌트(x ≈ 200.26·201.69) 모두 Q2(x ≈ 200.71) 쪽
      expect(dist(r, Q2)).toBeLessThan(1e-9);
      expect(r[1]).toBe(YL);
      expect(r[2]).toBe(3);
      expect(Math.abs(Math.hypot(r[0] - W.cu, r[1] - W.cv) - W.r)).toBeLessThan(1e-9);
      expect(refineFaceSnap(openX(o, tri, EYE(Q1), Q1), tb)).toEqual(r);
    }
  });

  it('22차까지의 길(open 없이 — 코어 점에서 바깥쪽 근)이면 원기둥 밖 힌트는 null, 원기둥 안 힌트는 같은 근', () => {
    const o: V3 = [100, YL, 3];
    const [inside, outside] = [...trisAt(MID)].sort((a, b) => Math.hypot(a.c[0] - W.cu, YL - W.cv) - Math.hypot(b.c[0] - W.cu, YL - W.cv));
    const old = (tri: typeof inside) => refineFaceSnap({ ...openX(o, tri!, EYE(Q2), Q2), open: undefined }, tb);
    expect(old(outside!)).toBeNull();
    expect(dist(old(inside!)!, Q2)).toBeLessThan(1e-9);
  });

  it('null: 선이 원기둥을 비켜 감(y = 310.01), 근이 그 토막 각 밖(이웃 토막 삼각형), 평면(윗면·곧은 옆면), 모르는 그물', () => {
    const tri = trisAt(MID)[0]!;
    expect(refineFaceSnap(openX([100, 310.01, 3], tri, EYE(Q1), Q1), tb)).toBeNull();
    for (const nb of [...trisAt((81.471 + 86.412) / 2), ...trisAt((91.353 + 96.294) / 2)]) {
      expect(refineFaceSnap(openX([100, YL, 3], nb, EYE(Q1), Q1), tb)).toBeNull();
      expect(refineFaceSnap(openX([100, YL, 3], nb, EYE(Q2), Q2), tb)).toBeNull();
    }
    const flat = openX([100, YL, 3], tri, EYE(Q1), Q1);
    expect(refineFaceSnap({ ...flat, face: { ...flat.face, normal: [0, 0, 1] } }, tb)).toBeNull();
    expect(refineFaceSnap({ ...flat, face: { ...flat.face, normal: [1, 0, 0] } }, tb)).toBeNull();
    expect(refineFaceSnap({ ...flat, face: { ...flat.face, id: 'nc-stock' } }, tb)).toBeNull();
    // 기둥과 나란한 Z축은 뚫지 않는다
    expect(refineFaceSnap({ ...flat, line: { origin: [200, YL, 0], dir: [0, 0, 1], axis: 'z' } }, tb)).toBeNull();
  });

  it('판 외곽선 R50(−90°~0°, 꼭짓점이 축 방향 접점)의 열린 후보: 근이 그 토막 각 안일 때만 원기둥 위', () => {
    // 첫 점 (0,20,9) X축은 R50을 −36.87°에서 뚫는다(−40°~−35° 토막). 그 토막 삼각형으로 열린 후보를 만들면 그 근, 이웃 토막이면 null
    const m = meshOf(/^판/);
    const wall = coreFace(m, [0, 20, 9], 'x', [390, 20, 9]);
    const inp: SnapRefineFaceInput = { ...wall, open: true, point: [wall.point[0] + 0.1, 20, 9], ray: { origin: [390.2, -300, 9.1], dir: [0, 1, 0] } };
    const q = refineFaceSnap(inp, t)!;
    expect(dist(q, [390, 20, 9])).toBeLessThan(1e-9);
    const nb = Math.atan2(wall.face.normal[1], wall.face.normal[0]) + 5 * D;
    expect(refineFaceSnap({ ...inp, face: { ...inp.face, normal: [Math.cos(nb), Math.sin(nb), 0] } }, t)).toBeNull();
  });
});

describe('다듬지 않는 것(null — 코어 점 그대로)', () => {
  it('평면: 판 윗면, 곧은 옆면, 구멍 바닥, 포켓 바닥', () => {
    expect(refineFaceSnap(coreFace(meshOf(/^판/), [50, 50, 30], 'z', [50, 50, 18]), t)).toBeNull();
    expect(refineFaceSnap(coreFace(meshOf(/^판/), [100, -50, 9], 'y', [100, 0, 9]), t)).toBeNull();
    expect(refineFaceSnap(coreFace(meshOf(/^판/), [500, 200, 9], 'x', [400, 200, 9]), t)).toBeNull();
    expect(refineFaceSnap(coreFace(meshOf(/Ø20/), [302, 201, 30], 'z', [302, 201, 6]), t)).toBeNull();
    expect(refineFaceSnap(coreFace(meshOf(/^포켓/), [200, 60, 30], 'z', [200, 60, 13]), t)).toBeNull();
  });

  it('기둥과 나란한 축(벽을 따라가는 선), 모르는 그물·종류, NC 문서(공작물 상자 — 평면)는 refineFace가 없다', () => {
    const inp = coreFace(meshOf(/Ø20/), [306, 0, 12], 'y', [306, 208, 12]);
    expect(refineFaceSnap({ ...inp, line: { ...inp.line, dir: [0, 0, 1], axis: 'z' } }, t)).toBeNull();
    expect(refineFaceSnap({ ...inp, face: { ...inp.face, id: 'nc-stock' } }, t)).toBeNull();
    expect(refineFaceSnap({ ...inp, kind: 'other' as 'axisFace' }, t)).toBeNull();
    // 면 법선이 그 자리 반지름 방향이 아니면(다른 면) 다듬지 않는다
    expect(refineFaceSnap({ ...inp, face: { ...inp.face, normal: [Math.SQRT1_2, Math.SQRT1_2, 0] } }, t)).toBeNull();
    expect(typeof panelSnapOptions(t).refineFace).toBe('function');
    const nc = parseForView('a.nc', enc('G21 G90\nG0 X0 Y0 Z0\nG1 X10 F100')).nc!;
    expect(ncSnapOptions(nc, arcCenters(nc)).refineFace).toBeUndefined();
  });
});
