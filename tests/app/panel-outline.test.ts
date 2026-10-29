/**
 * 판재 둘레 호의 붙잡기 표(17차 — scene.ts PanelSnapTable.outlines·outlineForms): 구멍 테두리(원기둥 위·아래 원), PGI·XML 둥근 사각 포켓 모서리(1/4 원 8토막),
 * 경로 포켓의 호, 옆면 원형 포켓·옆면 구멍(ZX·YZ 평면). 보이는 모양은 그대로이고(그물 윤곽선 꼭짓점이 표의 호를 그 나눈 각으로 나눈 점),
 * 측정이 그 위 점을 원 위로 다듬고(refine.ts) 접선으로 잠그며(tangent.ts) 가운데 점·중심을 준다(snap.ts).
 */
import { describe, expect, it } from 'vitest';
import type { SnapRefineInput } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import { PLANE_AXES } from '../../src/model';
import { parseForView } from '../../src/app/payload';
import { refineSnap } from '../../src/app/refine';
import { panelSnapPoints } from '../../src/app/snap';
import { ArcTangents, panelArcsOf, shapeAt, shapeChords, shapeNearest } from '../../src/app/tangent';
import type { PanelSnapTable } from '../../src/scene';

type V3 = [number, number, number];
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const D = Math.PI / 180;

// 판 400 × 300 × 18
// 0: 윗면 구멍 Ø8 셋(줄 — 16토막) 1: 오른쪽면 구멍 Ø8(x- — YZ 평면, 깊이 30) 2: 30° 돌린 모서리 R5 사각 포켓 80 × 40
// 3: 경로 포켓(닫힌 empty — 반원 하나와 직선 셋) 4: 뒷면 원형 포켓 Ø12(y- — ZX 평면, 48각) 5: 각진 사각 포켓(호 없음 — 표에 없다)
const PGI = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <hole x="50" y="50" z="0" diameter="8" depth="10" direction="z-" no="3" xi="32" yi="0" zi="0" enable="1" order="1"/>
  <hole x="400" y="150" z="9" diameter="8" depth="30" direction="x-" enable="1" order="2"/>
  <pocket length="80" width="40" depth="10" direction="z-" cornerRadius="5" angle="30" centerX="200" centerY="150" centerZ="0" enable="1" order="3"/>
  <path direction="z-" toolOffset="middle" width="6" depth="8" close="1" empty="1" enable="1" order="4">
   <vertex x="300" y="200" z="0" bulge="0"/>
   <vertex x="340" y="200" z="0" bulge="1"/>
   <vertex x="340" y="240" z="0" bulge="0"/>
   <vertex x="300" y="240" z="0" bulge="0"/>
  </path>
  <circle centerX="100" centerY="9" centerZ="0" radius="6" width="6" depth="12" direction="y-" empty="1" enable="1" order="5"/>
  <pocket length="40" width="20" depth="4" direction="z-" cornerRadius="0" angle="0" centerX="100" centerY="250" centerZ="0" enable="1" order="6"/>
 </panel>
</pgi>`;
const r = parseForView('o.pgi', enc(PGI));
const t = r.mpr!.snap! as PanelSnapTable;
const scene = r.scene as Scene3d;

/** 그물 윤곽선 토막(float32 끝점) */
function edges(id: string): [V3, V3][] {
  const e = scene.meshes.find((m) => m.id === id)!.edges!;
  const out: [V3, V3][] = [];
  for (let k = 0; k * 6 < e.length; k++) out.push([[e[k * 6]!, e[k * 6 + 1]!, e[k * 6 + 2]!], [e[k * 6 + 3]!, e[k * 6 + 4]!, e[k * 6 + 5]!]]);
  return out;
}

/** 표의 호마다 그 위에 두 끝이 놓인 윤곽선 토막 수 */
function chordsOn(id: string): number[] {
  const es = edges(id);
  return panelArcsOf(t, `edge:${id}`).map((g) => es.filter(([a, b]) => shapeNearest(g, a).dist < 1e-4 && shapeNearest(g, b).dist < 1e-4).length);
}

function edgeInput(kind: SnapRefineInput['kind'], id: string, seg: [V3, V3], point: readonly number[], first: readonly number[] | null = null): SnapRefineInput {
  return {
    kind,
    point: [point[0]!, point[1]!, point[2]!],
    segment: { kind: 'edge', id, index: 0, raw: 0, ends: seg },
    first: first ? [first[0]!, first[1]!, first[2]!] : null,
    ray: { origin: [point[0]! + 100, point[1]!, point[2]!], dir: [-1, 0, 0] },
  };
}

describe('둘레 호 붙잡기 표', () => {
  it('구멍·둥근 사각·경로·옆면 원형 포켓은 둘레 호와 평면·나눈 각이 있고, 각진 포켓은 없다', () => {
    expect([...t.outlines!.keys()]).toEqual(['mpr-op-0', 'mpr-op-1', 'mpr-op-2', 'mpr-op-3', 'mpr-op-4']);
    expect(Object.fromEntries(t.outlineForms!)).toEqual({
      'mpr-op-0': { plane: 0, step: (2 * Math.PI) / 16 },
      'mpr-op-1': { plane: 2, step: (2 * Math.PI) / 16 },
      'mpr-op-2': { plane: 0, step: Math.PI / 16 },
      'mpr-op-4': { plane: 1, step: Math.PI / 24 },
    });
    // 구멍 셋 × 위·아래 원, 옆면 구멍 위·아래, 모서리 넷 × 두 고리, 반원 × 두 고리, 원 × 두 고리
    expect([0, 1, 2, 3, 4].map((i) => t.outlines!.get(`mpr-op-${i}`)!.length / 9)).toEqual([6, 2, 8, 2, 2]);
  });

  it('그물 윤곽선(보이는 모양)은 표의 호를 그 나눈 각으로 나눈 토막 그대로다', () => {
    for (const id of ['mpr-op-0', 'mpr-op-1', 'mpr-op-2', 'mpr-op-3', 'mpr-op-4']) {
      const gs = panelArcsOf(t, `edge:${id}`);
      expect(chordsOn(id)).toEqual(gs.map((g) => shapeChords(g, Math.PI / 36)));
    }
    expect(chordsOn('mpr-op-0')).toEqual([16, 16, 16, 16, 16, 16]);
    expect(chordsOn('mpr-op-2')).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
    expect(chordsOn('mpr-op-3')).toEqual([36, 36]);
    expect(chordsOn('mpr-op-4')).toEqual([48, 48]);
    // 옆면 구멍: x = 400·370의 YZ 평면 원, 중심 (150, 9)
    const [a, b] = panelArcsOf(t, 'edge:mpr-op-1');
    expect([a!.a0, a!.a1, a!.a2, a!.cu, a!.cv, a!.s[0], b!.s[0], a!.r0]).toEqual([1, 2, 0, 150, 9, 400, 370, 4]);
    // 돌린 둥근 사각: 모서리 중심이 포켓 중심에서 (35, 15)를 30° 돌린 자리
    const c = panelArcsOf(t, 'edge:mpr-op-2').map((g) => [g.cu - 200, g.cv - 150]);
    const rot = ([x, y]: number[]): number[] => [x! * Math.cos(30 * D) - y! * Math.sin(30 * D), x! * Math.sin(30 * D) + y! * Math.cos(30 * D)];
    expect(dist([...c[0]!, 0], [...rot([35, -15]), 0])).toBeLessThan(1e-9);
    expect(dist([...c[1]!, 0], [...rot([35, 15]), 0])).toBeLessThan(1e-9);
  });
});

describe('둘레 호 위 측정(다듬기·가운데 점·중심·접선)', () => {
  it('옆면 구멍 테두리(YZ 평면) 현 위 점·수직 발은 원 위, 가운데 점·중심은 그 평면', () => {
    const g = panelArcsOf(t, 'edge:mpr-op-1')[0]!;
    const es = edges('mpr-op-1').filter(([p, q]) => shapeNearest(g, p).dist < 1e-4 && shapeNearest(g, q).dist < 1e-4);
    const seg = es[5]!;
    const mid = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2, (seg[0][2] + seg[1][2]) / 2];
    const q = refineSnap(edgeInput('onEdge', 'mpr-op-1', seg, mid), t)!;
    expect(q[0]).toBeCloseTo(400, 9);
    expect(Math.abs(Math.hypot(q[1] - 150, q[2] - 9) - 4)).toBeLessThan(1e-9);
    // 다듬기 전 현 가운데는 처짐 4(1 − cos 11.25°) ≈ 0.077 mm 안쪽
    expect(4 - Math.hypot(mid[1]! - 150, mid[2]! - 9)).toBeGreaterThan(0.07);
    // 바깥 첫 점에서 내린 발: 반지름 방향의 원 위 점
    const ang = Math.atan2(mid[2]! - 9, mid[1]! - 150);
    const first = [400, 150 + 20 * Math.cos(ang + 0.01), 9 + 20 * Math.sin(ang + 0.01)];
    const f = refineSnap(edgeInput('perpendicular', 'mpr-op-1', seg, mid, first), t)!;
    expect(dist(f, [400, 150 + 4 * Math.cos(ang + 0.01), 9 + 4 * Math.sin(ang + 0.01)])).toBeLessThan(1e-9);
    const pts = panelSnapPoints({ kind: 'edge', id: 'mpr-op-1', index: 0, point: mid } as never, t)!;
    expect(pts.map((p) => p.kind)).toEqual(['midpoint', 'center']);
    expect(dist(pts[1]!.point, [400, 150, 9])).toBeLessThan(1e-9);
    expect(Math.abs(Math.hypot(pts[0]!.point[1] - 150, pts[0]!.point[2] - 9) - 4)).toBeLessThan(1e-9);
  });

  it('옆면 구멍 테두리 위 첫 점에서 접선은 그 평면 안(반지름·X축에 수직), 커서 쪽', () => {
    const g = panelArcsOf(t, 'edge:mpr-op-1')[0]!;
    const a = shapeAt(g, 0.25);
    const p = shapeAt(g, 0.3);
    const d = new ArcTangents().at(t, a, p)!;
    expect(Math.abs(d[0])).toBeLessThan(1e-12);
    expect(Math.abs(dot(d, [0, a[1] - 150, a[2] - 9]))).toBeLessThan(1e-9);
    // 커서 쪽(f가 커지는 쪽)
    expect(dot(d, [p[0] - a[0], p[1] - a[1], p[2] - a[2]])).toBeGreaterThan(0);
    // 18차: 코어가 그물 윤곽선 식별자(edge — 그물 id)를 실은 첫 점은 그 그물의 둘레 호만 보고 같은 접선을 준다
    const c = new ArcTangents();
    expect(c.at(t, { point: a, segment: { kind: 'edge', id: 'mpr-op-1', index: 3, raw: 3, ends: [a as V3, p as V3] } }, p)).toEqual(d);
    expect(c.by).toBe('segment');
    // 표에 둘레 호가 없는 그물(각진 포켓)의 식별자는 좌표로
    expect(c.at(t, { point: a, segment: { kind: 'edge', id: 'mpr-op-5', index: 0, raw: 0, ends: [a as V3, p as V3] } }, p)).toEqual(d);
    expect(c.by).toBe('coords');
  });

  it('둥근 사각 포켓 모서리·뒷면 원형 포켓(ZX 평면)·경로 포켓 반원 현 위 점은 원 위', () => {
    for (const [id, k] of [
      ['mpr-op-2', 3],
      ['mpr-op-4', 1],
      ['mpr-op-3', 0],
    ] as const) {
      const g = panelArcsOf(t, `edge:${id}`)[k]!;
      const seg = edges(id).find(([p, q]) => shapeNearest(g, p).dist < 1e-4 && shapeNearest(g, q).dist < 1e-4 && dist(p, q) > 1e-6)!;
      const mid = [0, 1, 2].map((i) => seg[0][i]! * 0.6 + seg[1][i]! * 0.4);
      const q = refineSnap(edgeInput('onEdge', id, seg, mid), t)!;
      expect(shapeNearest(g, q).dist).toBeLessThan(1e-9);
      const [a0, a1] = PLANE_AXES[t.outlineForms?.get(id)?.plane ?? 0]!;
      expect(Math.abs(Math.hypot(q[a0]! - g.cu, q[a1]! - g.cv) - g.r0)).toBeLessThan(1e-9);
    }
  });

  it('각진 포켓 모서리(표에 없음)는 다듬지 않는다', () => {
    const seg = edges('mpr-op-5')[0]!;
    const mid = [0, 1, 2].map((i) => (seg[0][i]! + seg[1][i]!) / 2);
    expect(refineSnap(edgeInput('onEdge', 'mpr-op-5', seg, mid), t)).toBeNull();
    expect(panelSnapPoints({ kind: 'edge', id: 'mpr-op-5', index: 0, point: mid } as never, t)).toBeNull();
  });
});
