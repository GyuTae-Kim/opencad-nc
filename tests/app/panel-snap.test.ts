/**
 * 판재 가공(MPR·PGI)과 반경 보정 경로의 측정 붙잡기(scene.ts PanelSnapTable, app/snap.ts panelSnapPoints·compSnapPoints):
 * 워커 길(parseForView)이 장면과 같은 묶음 id로 만든 표에서 원호 중심, 고른 윤곽 요소의 진짜 가운데 점(호는 현이 아니라 호 위).
 */
import { describe, expect, it } from 'vitest';
import type { Pick3d } from 'opencad-viewer3d/types';
import { parseForView } from '../../src/app/payload';
import { compSnapPoints, moveSnapPoints, panelCenters, panelSnapPoints } from '../../src/app/snap';
import { MOVE_ARC } from '../../src/index';

const enc = new TextEncoder();
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const pt = (p: readonly number[]): number[] => p.map(r3);
const linePick = (id: string, index: number, point: number[]): Pick3d => ({ kind: 'line', id, index, raw: 0, point }) as unknown as Pick3d;

// 판 300×200×19: 윤곽 1(직선 → 반시계 호 R20 → 직선)을 따라 가는 윤곽 가공, 가공 없는 원 윤곽 2(R20), 자유 형상 포켓이 쓰는 윤곽 3(R10 원)
const MPR = `[H
VERSION="4.0 Alpha"
_BSX=300.000000
_BSY=200.000000
_BSZ=19.000000

]1
$E0
KP
X=20
Y=20
Z=19

$E1
KL
X=80
Y=20

$E2
KA
X=100
Y=40
DS=1
R=20

$E3
KL
X=100
Y=80

]2
$E0
KP
X=200
Y=50
Z=19

$E1
KA
X=240
Y=50
DS=1
I=220
J=50

$E2
KA
X=200
Y=50
DS=1
I=220
J=50

]3
$E0
KP
X=160
Y=150
Z=19

$E1
KA
X=180
Y=150
DS=1
I=170
J=150

$E2
KA
X=160
Y=150
DS=1
I=170
J=150

<100 \\WerkStck\\
LA="300"
BR="200"
DI="19"

<105 \\Konturfraesen\\
EA="1:0"
EE="1:3"
TNO="101"
ZA="5"

<186 \\FreiFormTasche\\
EA="3:0"
TI="-6"
!
`;

describe('판재 붙잡기 표(MPR)', () => {
  const r = parseForView('snap.mpr', enc.encode(MPR));
  const t = r.mpr!.snap!;
  const ops = (r.scene.meta as { operations: { kind: string }[] }).operations;
  const route = ops.findIndex((o) => o.kind === 'contour');
  const pocket = ops.findIndex((o) => o.kind === 'pocket');
  const set = r.scene.lines.find((l) => l.id === `mpr-op-${route}`)!;
  const z = set.positions[2]!;

  it('윤곽 가공·가공 없는 윤곽의 원호 중심, 자유 형상 포켓의 원 중심을 늘 후보로(장면과 같은 묶음 id)', () => {
    const c = panelCenters(t).map((p) => [p.id, ...pt(p.point)]);
    expect(c).toEqual(
      expect.arrayContaining([
        [`mpr-op-${route}`, 80, 40, r3(z)],
        ['mpr-contours', 220, 50, 19],
        [`mpr-op-${pocket}`, 170, 150, 0],
      ]),
    );
    // 같은 묶음 안 같은 자리(원 윤곽의 두 반원)는 하나
    expect(c.filter((p) => p[0] === 'mpr-contours').length).toBe(1);
    expect(panelCenters(t).every((p) => p.kind === 'center')).toBe(true);
    // 그 id의 묶음이 장면에 있다
    for (const p of panelCenters(t)) expect([...r.scene.lines, ...r.scene.meshes].some((x) => x.id === p.id), p.id).toBe(true);
  });

  it('고른 윤곽 선분: 그 요소의 가운데 점(호는 호 위)과 호 중심', () => {
    // 호 (80,20) → (100,40), 중심 (80,40): 현 위 한 점을 골라도 호 위 -45° 자리
    const onChord = [91, 23, z];
    const arc = panelSnapPoints(linePick(set.id, route, onChord), t)!;
    expect(arc.map((p) => p.kind)).toEqual(['midpoint', 'center']);
    expect(pt(arc[0]!.point)).toEqual([r3(80 + 20 * Math.SQRT1_2), r3(40 - 20 * Math.SQRT1_2), r3(z)]);
    expect(pt(arc[1]!.point)).toEqual([80, 40, r3(z)]);
    // 직선 (20,20) → (80,20)
    expect(panelSnapPoints(linePick(set.id, route, [30, 20, z]), t)!.map((p) => pt(p.point))).toEqual([[50, 20, r3(z)]]);
    // 직선 (100,40) → (100,80)
    expect(panelSnapPoints(linePick(set.id, route, [100, 75, z]), t)!.map((p) => pt(p.point))).toEqual([[100, 60, r3(z)]]);
    // 가공 없는 원 윤곽(segmentIds = 윤곽 번호 2): 아래 반원(200,50)→(240,50)의 가운데 (220,30)
    const circle = panelSnapPoints(linePick('mpr-contours', 2, [221, 31, 19]), t)!;
    expect(circle.map((p) => [p.kind, ...pt(p.point)])).toEqual([
      ['midpoint', 220, 30, 19],
      ['center', 220, 50, 19],
    ]);
  });

  it('표에 없는 것(구멍·포켓 그물·다른 번호)은 없음', () => {
    expect(panelSnapPoints(linePick(set.id, route + 1, [30, 20, z]), t)).toBeNull();
    expect(panelSnapPoints({ kind: 'mesh', id: `mpr-op-${pocket}`, index: 0, point: [165, 150, 0] } as unknown as Pick3d, t)).toBeNull();
  });

  it('붙잡기 표는 장면을 바꾸지 않는다(같은 파일의 장면 선분·그물이 같다)', async () => {
    const { mprToScene, parseMpr } = await import('../../src/index');
    const plain = mprToScene(parseMpr(MPR));
    expect(plain.lines.map((l) => [l.id, Array.from(l.positions)])).toEqual(r.scene.lines.map((l) => [l.id, Array.from(l.positions)]));
    expect(plain.meshes.map((m) => [m.id, m.positions.length])).toEqual(r.scene.meshes.map((m) => [m.id, m.positions.length]));
  });
});

// PGI: 오른쪽 앞 모서리를 R100 호로 둥글린 판 600×400×18, 원형 포켓 Ø40(외곽선 48각형), 원 경로 Ø30
const PGI = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="600" width="400" thickness="18" name="snap" quantity="1">
  <outlines>
   <outline x="0" y="0" bulge="0"/>
   <outline x="500" y="0" bulge="0.41421356"/>
   <outline x="600" y="100" bulge="0"/>
   <outline x="600" y="400" bulge="0"/>
   <outline x="0" y="400" bulge="0"/>
   <outline x="0" y="0" bulge="0"/>
  </outlines>
  <circle centerX="420" centerY="150" centerZ="0" radius="20" width="8" depth="10" direction="z-" empty="1" enable="1" order="1"/>
  <circle centerX="420" centerY="300" centerZ="0" radius="15" width="6" depth="3" direction="z-" empty="0" enable="1" order="2"/>
 </panel>
</pgi>
`;

describe('판재 붙잡기 표(PGI)', () => {
  const r = parseForView('snap.pgi', enc.encode(PGI));
  const t = r.mpr!.snap!;
  const c = panelCenters(t).map((p) => [p.id, ...pt(p.point)]);

  it('판 외곽선의 원호 중심(윗면), 원형 포켓 중심(들어가는 면), 원 경로 중심(경로 깊이)', () => {
    expect(c).toContainEqual(['mpr-board', 500, 100, 18]);
    expect(c.filter((p) => p[1] === 420 && p[2] === 150)).toEqual([[expect.stringMatching(/^mpr-op-/), 420, 150, 18]]);
    expect(c.filter((p) => p[1] === 420 && p[2] === 300)).toEqual([[expect.stringMatching(/^mpr-op-/), 420, 300, 15]]);
  });
});

describe('반경 보정 경로 붙잡기', () => {
  // 공구 지름 10, 반시계 원(R20) 안쪽 G41 → 공구 중심 반지름 15
  const PROGRAM = `G21 G90 G17
(T1 D=10.)
T1 M6
G0 X0 Y0 Z5
G1 Z-1 F100
G41 D1 G1 X20 Y0 F500
G3 X20 Y0 I-20 J0
G40 G1 X0 Y0
M30
`;
  const r = parseForView('comp.nc', enc.encode(PROGRAM), { comp: true });
  const nc = r.nc!;
  const arc = [...Array(nc.moves.count).keys()].find((i) => nc.moves.kind[i] === MOVE_ARC)!;

  it('보정 조각을 워커가 보낸다(보정을 그리지 않으면 없음)', () => {
    expect(nc.comp?.count).toBe(3);
    expect(parseForView('comp.nc', enc.encode(PROGRAM)).nc!.comp).toBeUndefined();
  });

  it("'nc-comp' 선분: 그 이동의 보정 조각 가운데 점(공구 중심 호 위 — 반지름 15)과 호 중심", () => {
    const p = moveSnapPoints(linePick('nc-comp', arc, [-14.9, 0.5, -1]), nc)!;
    expect(p.map((q) => q.kind)).toEqual(['midpoint', 'center']);
    expect(pt(p[0]!.point)).toEqual([-15, 0, -1]);
    expect(pt(p[1]!.point)).toEqual([0, 0, -1]);
    // 들어가기 직선 (0,0) → (15,0)
    const enter = nc.moves.line[arc]! - 1;
    const lead = [...Array(nc.moves.count).keys()].find((i) => nc.moves.line[i] === enter && nc.moves.kind[i] !== MOVE_ARC)!;
    expect(compSnapPoints(linePick('nc-comp', lead, [10, 0, -1]), nc.comp!)!.map((q) => pt(q.point))).toEqual([[7.5, 0, -1]]);
    // 보정 조각이 없는 이동
    expect(compSnapPoints(linePick('nc-comp', 0, [0, 0, 5]), nc.comp!)).toBeNull();
  });
});
