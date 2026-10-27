import { describe, expect, it } from 'vitest';
import { parseMpr, type MprOtherOp } from '../src/mpr';
import { mprToScene } from '../src/scene';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const head = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n`;
const board = `<100 \\WerkStck\\\nLA="200"\nBR="100"\nDI="19"\n`;

describe('MPR 보완', () => {
  it('뒤에 정의된 변수를 쓰는 식도 풀고(안내 경고), 함수 인수 구분 ;', () => {
    const p = parseMpr(`${head}[001\nA="B*2"\nKM="a"\nB="5"\nKM="b"\nM="MAX(3;7)+IF(0;1;2)"\nKM="m"\n${board}!\n`);
    expect(p.variables.map((v) => [v.name, v.value])).toEqual([
      ['A', 10],
      ['B', 5],
      ['M', 9],
    ]);
    expect(p.warnings.some((w) => w.includes('뒤에 정의된 변수'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('계산할 수 없음'))).toBe(false);
  });

  it('윤곽 KR(둥글리기)·KF(모따기): 앞뒤 직선 모서리를 자르고 호·직선을 넣는다', () => {
    const p = parseMpr(`${head}${board}]1
$E0
KP
X=0
Y=0
Z=19

$E1
KL
X=100
Y=0

$E2
KR
R=10

$E3
KL
X=100
Y=50

$E4
KF
R=5

$E5
KL
X=0
Y=50
!
`);
    const els = p.contours[0]!.elements;
    expect(els.map((e) => [e.type, e.index, r3(e.x), r3(e.y)])).toEqual([
      ['KP', 0, 0, 0],
      ['KL', 1, 90, 0],
      ['KR', 2, 100, 10],
      ['KL', 3, 100, 45],
      ['KF', 4, 95, 50],
      ['KL', 5, 0, 50],
    ]);
    const kr = els[2]!;
    expect([r3(kr.arc!.cx), r3(kr.arc!.cy), r3(kr.arc!.sweep)]).toEqual([90, 10, r3(Math.PI / 2)]);
    expect(kr.radius).toBe(10);
    expect(els[4]!.arc).toBeUndefined();
    expect(p.warnings.filter((w) => w.includes('KR') || w.includes('KF'))).toEqual([]);
  });

  it('크기 없음·변보다 큰 둥글리기는 모서리 그대로(경고 — 원호가 낀 모서리는 mpr-arc-corner.test.ts)', () => {
    const p = parseMpr(`${head}${board}]1
$E0
KP
X=0
Y=0

$E1
KL
X=10
Y=0

$E2
KR
R=50

$E3
KL
X=10
Y=10

$E4
KR

$E5
KA
X=20
Y=20
R=10
DS=1
!
`);
    expect(p.contours[0]!.elements.map((e) => e.type)).toEqual(['KP', 'KL', 'KL', 'KA']);
    expect(p.warnings.some((w) => w.includes('크기가 변보다 큼'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('KR에 크기(R)가 없음'))).toBe(true);
  });

  it('모르는 매크로는 XA·YA 위치를 점으로(묶음 기타 가공(위치))', () => {
    const p = parseMpr(`${head}${board}<139 \\Komponente\\\nXA="50"\nYA="20"\n<140 \\Etwas\\\nIN="1"\n!\n`);
    const ops = p.operations.filter((o) => o.kind === 'other') as MprOtherOp[];
    expect(ops.map((o) => o.at)).toEqual([[50, 20, 19], undefined]);
    expect(p.warnings.some((w) => w.includes('위치(점)'))).toBe(true);
    const s = mprToScene(p);
    const pts = s.points!.find((x) => x.id === 'mpr-other-pos')!;
    expect(pts.group).toBe('기타 가공(위치)');
    expect(Array.from(pts.positions)).toEqual([50, 20, 19]);
    expect(Array.from(pts.pointIds!)).toEqual([0]);
  });

  it('값 "STANDARD"(이송·공구 기본값)는 식으로 계산하지 않고 경고 없이 기본값으로 읽는다', () => {
    const p = parseMpr(`${head}${board}]1
$E0
KP
X=0
Y=0
Z=19

$E1
KL
X=200
Y=0

<105 \\Konturfraesen\\
EA="1:0"
EE="1:1"
TI="5"
F_="STANDARD"
TNO="STANDARD"
S_="standard"

<102 \\BohrVert\\
XA="50"
YA="50"
TI="10"
DU="8"
TNO=" STANDARD "
!
`);
    expect(p.warnings.filter((w) => w.includes('계산할 수 없음'))).toEqual([]);
    const c = p.operations.find((o) => o.kind === 'contour')!;
    expect(c.tool).toBeUndefined();
    expect('feed' in c ? c.feed : undefined).toBeUndefined();
    // 수나 식은 그대로 계산
    const q = parseMpr(`${head}${board}<102 \\BohrVert\\\nXA="50"\nYA="50"\nTI="10"\nDU="8"\nTNO="3+2"\n!\n`);
    expect(q.operations[0]!.tool).toBe(5);
    // 모르는 이름은 여전히 경고
    const bad = parseMpr(`${head}${board}<102 \\BohrVert\\\nXA="50"\nYA="50"\nTI="10"\nDU="8"\nTNO="STANDARDX"\n!\n`);
    expect(bad.warnings.some((w) => w.includes('계산할 수 없음'))).toBe(true);
  });

  it('131 UfluBohr(아래쪽 드릴 장치): 위에서 본 (XA, YA)에서 아랫면(Z 0) 위로 TI만큼 수직 구멍', () => {
    const p = parseMpr(`${head}${board}<131 \\UfluBohr\\
XA="40"
YA="30"
TI="12"
DU="5"
AB="10"
WI="0"
F_="STANDARD"

<131 \\UfluBohr\\
XA="60"
YA="30"
TI="25"
DU="5"
AN="3"
AB="32"
WI="90"
!
`);
    expect(p.warnings).toEqual([]);
    const [a, b] = p.operations as import('../src/mpr').MprDrillOp[];
    expect(a!.kind).toBe('drillV');
    expect(a!.macro).toBe('UfluBohr');
    expect(a!.holes).toEqual([{ start: [40, 30, 0], dir: [0, 0, 1], depth: 12 }]);
    expect(a!.diameter).toBe(5);
    expect(a!.through).toBe(false);
    // 여러 구멍(AN·AB·WI)과 두께보다 깊은 TI(관통 — 두께까지)
    expect(b!.holes.map((h) => h.start.map(r3))).toEqual([
      [60, 30, 0],
      [60, 62, 0],
      [60, 94, 0],
    ]);
    expect(b!.holes[0]!.depth).toBe(19);
    expect(b!.through).toBe(true);
    expect(p.stats).toMatchObject({ drillOps: 2, holes: 4, other: 0 });
    // 장면: 수직 구멍 묶음의 원기둥이 Z 0~12(아랫면 쪽)에 있고 위치 점(지원하지 않는 가공)은 없다
    const s = mprToScene(p);
    const m = s.meshes.find((x) => x.id === 'mpr-op-0')!;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 2; i < m.positions.length; i += 3) {
      zMin = Math.min(zMin, m.positions[i]!);
      zMax = Math.max(zMax, m.positions[i]!);
    }
    expect([r3(zMin), r3(zMax)]).toEqual([0, 12]);
    expect(m.group).toBe('수직 구멍');
    expect((s.points ?? []).some((q) => q.id === 'mpr-other-pos')).toBe(false);
  });
});
