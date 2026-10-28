/**
 * 원호 접선(tangent.ts): 측정 첫 점이 원호 이동의 시작·끝·가운데 점이나 그 밖의 원호 위 자리(15차)이고 커서 아래 점이 그 원호 위일 때
 * 잠글 접선 방향. 해석기로 읽은 합성 G-code와 손으로 만든 여러 바퀴 나선으로 접선 방향·원호 위 판정(현의 처짐 안)·끝 고르기를 보고,
 * 판재(MPR) 윤곽 호(워커 길의 붙잡기 표)도 같은 규칙인지 본다(15차).
 */
import { describe, expect, it } from 'vitest';
import { MOVE_ARC } from '../../src/model';
import { parseNcFile } from '../../src/index';
import { parseForView } from '../../src/app/payload';
import { movePointAt, type SnapMoves } from '../../src/app/snap';
import { moveEndTime } from '../../src/view/playback';
import {
  ArcTangents,
  arcChordSag,
  arcEndTangent,
  arcEndsAt,
  arcMidsAt,
  arcNearest,
  arcTangentAt,
  arcTangentAtF,
  arcsOnAt,
  panelArcs,
  panelArcsAt,
  type TangentDoc,
} from '../../src/app/tangent';

function program(text: string): SnapMoves {
  const p = parseNcFile('t.nc', text);
  if (!('program' in p)) throw new Error('G-code가 아님');
  return p.program;
}

/** 이동 가운데 원호 번호(차례대로) */
function arcMoves(nc: SnapMoves): number[] {
  const out: number[] = [];
  for (let i = 0; i < nc.moves.count; i++) if (nc.moves.kind[i] === MOVE_ARC) out.push(i);
  return out;
}

const close = (a: readonly number[] | null, b: readonly number[], eps = 1e-9): void => {
  expect(a).not.toBeNull();
  for (let k = 0; k < 3; k++) expect(a![k]!).toBeCloseTo(b[k]!, -Math.log10(eps));
};

const H = Math.SQRT1_2;

describe('원호 접선', () => {
  // (0,40) → (40,40) 시계 방향 1/4 원(중심 (20,20)), 이어서 직선, 떨어진 곳에 한 바퀴 원(시작 = 끝 = (100,0))
  const nc = program(['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G0 X100 Y0', 'G2 X100 Y0 I-10 J0'].join('\n'));
  const [q, circle] = arcMoves(nc) as [number, number];

  it('첫 점에 닿는 원호 끝을 찾고, 끝마다 원호 쪽으로 가는 접선을 준다', () => {
    expect(arcEndsAt(nc, [0, 40, 0])).toEqual([{ move: q, end: 0 }]);
    expect(arcEndsAt(nc, [40, 40, 0])).toEqual([{ move: q, end: 1 }]);
    // float32 장면 좌표의 반올림만큼 어긋나도 같은 자리
    expect(arcEndsAt(nc, [Math.fround(40.00001), 40, 0])).toEqual([{ move: q, end: 1 }]);
    expect(arcEndsAt(nc, [60, 40, 0])).toEqual([]);
    // 시계 방향: 시작 (0,40)에서 오른쪽 위로, 끝 (40,40)에서는 원호 쪽(왼쪽 위)으로
    close(arcEndTangent(nc, q, 0), [H, H, 0]);
    close(arcEndTangent(nc, q, 1), [-H, H, 0]);
    // 한 바퀴 원은 두 끝이 같은 자리
    expect(arcEndsAt(nc, [100, 0, 0])).toEqual([
      { move: circle, end: 0 },
      { move: circle, end: 1 },
    ]);
  });

  it('커서 아래 점이 원호 위(가운데 점·다른 끝·현 위 — 처짐 안)면 접선, 원호에서 벗어나거나 첫 점 자리면 null', () => {
    const ends = arcEndsAt(nc, [0, 40, 0]);
    const mid = movePointAt(nc, q, 0.5)!;
    close(mid, [20, 20 + Math.hypot(20, 20), 0]);
    close(arcTangentAt(nc, ends, [0, 40, 0], mid), [H, H, 0]);
    close(arcTangentAt(nc, ends, [0, 40, 0], [40, 40, 0]), [H, H, 0]);
    // 장면은 1/4 원을 5°씩 18개 현으로 나눈다: 첫 현의 가운데(원호에서 처짐만큼 안쪽)도 원호 위
    const r = Math.hypot(20, 20);
    const sag = arcChordSag(nc, q, Math.PI / 36);
    expect(sag).toBeCloseTo(r * (1 - Math.cos(Math.PI / 72)), 12);
    const v1 = movePointAt(nc, q, 1 / 18)!;
    const chordMid = [(0 + v1[0]) / 2, (40 + v1[1]) / 2, 0];
    expect(arcNearest(nc, q, chordMid)!.dist).toBeCloseTo(sag, 9);
    close(arcTangentAt(nc, ends, [0, 40, 0], chordMid), [H, H, 0]);
    // 나누기 각이 작으면(현이 원호에 붙으면) 같은 점이 원호 밖
    expect(arcTangentAt(nc, ends, [0, 40, 0], chordMid, Math.PI / 360)).toBeNull();
    // 원호 바깥 1 mm, 첫 점 자리, 이어지는 직선 위
    expect(arcTangentAt(nc, ends, [0, 40, 0], [mid[0], mid[1] + 1, 0])).toBeNull();
    expect(arcTangentAt(nc, ends, [0, 40, 0], [0, 40, 0])).toBeNull();
    expect(arcTangentAt(nc, arcEndsAt(nc, [40, 40, 0]), [40, 40, 0], [50, 40, 0])).toBeNull();
    // 재생 중 아직 그리지 않은 원호는 보지 않는다
    expect(arcTangentAt(nc, ends, [0, 40, 0], mid, Math.PI / 36, q - 1)).toBeNull();
    expect(arcTangentAt(nc, ends, [0, 40, 0], mid, Math.PI / 36, q)).not.toBeNull();
  });

  it('한 바퀴 원(시작 = 끝)은 커서가 놓인 쪽 끝의 접선(같은 선, 원호 쪽 방향)', () => {
    const a = [100, 0, 0];
    const ends = arcEndsAt(nc, a);
    // 시계 방향, 중심 (90,0): 시작에서 아래(−Y)로 — 첫 1/4 위 점은 시작 끝, 마지막 1/4 위 점은 끝(원호 쪽 = 위)
    close(arcTangentAt(nc, ends, a, movePointAt(nc, circle, 0.2)!), [0, -1, 0]);
    close(arcTangentAt(nc, ends, a, movePointAt(nc, circle, 0.8)!), [0, 1, 0]);
  });

  it('나선(G17 G3 Z): 접선에 높이 기울기가 들고, 여러 바퀴면 높이로 바퀴를 가른다', () => {
    const hx = program(['G21 G90 G17', 'G0 X100 Y0 Z0', 'G3 X100 Y0 Z-6 I-10 J0 F300'].join('\n'));
    const [i] = arcMoves(hx) as [number];
    expect(arcEndsAt(hx, [100, 0, 0])).toEqual([{ move: i, end: 0 }]);
    const lead = Math.hypot(2 * Math.PI * 10, 6);
    close(arcEndTangent(hx, i, 0), [0, (2 * Math.PI * 10) / lead, -6 / lead]);
    close(arcEndTangent(hx, i, 1), [0, -(2 * Math.PI * 10) / lead, 6 / lead]);
    // 한 바퀴 반 지난 자리의 점(손으로 만든 두 바퀴 나선, 중심 (0,0), 반지름 10, Z 0 → −8)
    const two: SnapMoves = {
      moves: { count: 1, kind: Uint8Array.of(MOVE_ARC), points: Float64Array.of(10, 0, 0, 10, 0, -8), tool: Int32Array.of(1), flags: new Uint16Array(1), arc: Int32Array.of(0) },
      arcs: { center: Float64Array.of(0, 0, 0), plane: Uint8Array.of(0), sweep: Float64Array.of(4 * Math.PI) },
    };
    const n = arcNearest(two, 0, [0, 10, -5])!;
    expect(n.f).toBeCloseTo(0.625, 12);
    expect(n.dist).toBeLessThan(1e-9);
    // 첫 바퀴의 같은 각(Z −1)도 원호 위
    expect(arcNearest(two, 0, [0, 10, -1])!.f).toBeCloseTo(0.125, 12);
    expect(arcTangentAt(two, arcEndsAt(two, [10, 0, -8]), [10, 0, -8], [0, 10, -5])).not.toBeNull();
  });

  it('G18 평면 원호의 접선은 XZ 평면에 있고 반지름에 수직이다', () => {
    const g18 = program(['G21 G90 G18', 'G0 X0 Y5 Z0', 'G2 X20 Z0 I10 K0 F300'].join('\n'));
    const [i] = arcMoves(g18) as [number];
    const t = arcEndTangent(g18, i, 0)!;
    expect(t[1]).toBeCloseTo(0, 12);
    // 중심 (10, 5, 0)에서 시작 (0, 5, 0)으로의 반지름에 수직 — 접선은 ±Z
    expect(Math.abs(t[2])).toBeCloseTo(1, 12);
  });

  it('ArcTangents는 첫 점·문서 자료마다 한 번 찾아 둔다', () => {
    const c = new ArcTangents();
    const mid = movePointAt(nc, q, 0.5)!;
    close(c.at(nc, [0, 40, 0], mid), [H, H, 0]);
    close(c.at(nc, [40, 40, 0], mid), [-H, H, 0]);
    expect(c.at(nc, [60, 40, 0], mid)).toBeNull();
  });
});

describe('원호 가운데 점의 접선(14차)', () => {
  // 위와 같은 1/4 원과 한 바퀴 원, G18 반원, 나선
  const nc = program(
    ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G0 X100 Y0', 'G2 X100 Y0 I-10 J0', 'G18', 'G0 X200 Y5 Z0', 'G2 X220 Z0 I10 K0', 'G17', 'G0 X300 Y0 Z0', 'G3 X300 Y0 Z-6 I-10 J0'].join('\n'),
  );
  const [q, circle, half, helix] = arcMoves(nc) as [number, number, number, number];
  const r = Math.hypot(20, 20);

  it('가운데 점(앱의 원호 가운데 점 붙잡기와 같은 자리)인 원호를 찾는다 — 끝·다른 자리·직선 가운데는 아니다', () => {
    const mid = movePointAt(nc, q, 0.5)!;
    close(mid, [20, 20 + r, 0]);
    expect(arcMidsAt(nc, mid)).toEqual([{ move: q, end: 0.5 }]);
    // float32 장면 좌표의 반올림만큼 어긋나도 같은 자리
    expect(arcMidsAt(nc, mid.map((x) => Math.fround(x)))).toEqual([{ move: q, end: 0.5 }]);
    expect(arcMidsAt(nc, [0, 40, 0])).toEqual([]);
    expect(arcMidsAt(nc, movePointAt(nc, q, 0.4)!)).toEqual([]);
    expect(arcMidsAt(nc, [50, 40, 0])).toEqual([]);
    // 한 바퀴 원의 가운데 점은 시작의 맞은편, G18 반원은 XZ 평면, 나선은 높이도 반
    expect(arcMidsAt(nc, [80, 0, 0])).toEqual([{ move: circle, end: 0.5 }]);
    expect(arcMidsAt(nc, movePointAt(nc, half, 0.5)!)).toEqual([{ move: half, end: 0.5 }]);
    expect(arcMidsAt(nc, movePointAt(nc, helix, 0.5)!)).toEqual([{ move: helix, end: 0.5 }]);
    expect(arcMidsAt(nc, [280, 0, 0])).toEqual([]);
    close(movePointAt(nc, helix, 0.5)!, [280, 0, -3]);
  });

  it('첫 점이 가운데 점이고 커서가 그 원호 위(양쪽 반, 끝, 현 위)면 그 점의 접선, 원호 밖·첫 점 자리면 null', () => {
    const c = new ArcTangents();
    const mid = movePointAt(nc, q, 0.5)!;
    // 시계 방향 1/4 원의 꼭대기: 진행 방향 +X — 커서가 뒤(시작 쪽 반)면 반대(15차 — 원호를 따라 커서 쪽)
    close(arcTangentAtF(nc, q, 0.5), [1, 0, 0]);
    for (const f of [0.7, 0.95, 1]) close(c.at(nc, mid, movePointAt(nc, q, f)!), [1, 0, 0]);
    for (const f of [0.1, 0.3, 0]) close(c.at(nc, mid, movePointAt(nc, q, f)!), [-1, 0, 0]);
    // 원호를 나눈 현의 가운데(처짐 안)
    const v9 = movePointAt(nc, q, 9 / 18)!;
    const v10 = movePointAt(nc, q, 10 / 18)!;
    close(c.at(nc, mid, [(v9[0] + v10[0]) / 2, (v9[1] + v10[1]) / 2, 0]), [1, 0, 0]);
    expect(c.at(nc, mid, [mid[0] + 5, mid[1] + 1, 0])).toBeNull();
    expect(c.at(nc, mid, mid)).toBeNull();
    // 재생 중 아직 그리지 않은 원호는 보지 않는다
    expect(c.at(nc, mid, [0, 40, 0], Math.PI / 36, q - 1)).toBeNull();
  });

  it('한 바퀴 원·G18 반원·나선의 가운데 점 접선', () => {
    const c = new ArcTangents();
    // 시계 방향 원(중심 (90,0))의 맞은편 (80,0): 진행 방향 +Y — 커서가 뒤(앞 반 바퀴)면 반대
    close(c.at(nc, [80, 0, 0], movePointAt(nc, circle, 0.8)!), [0, 1, 0]);
    close(c.at(nc, [80, 0, 0], movePointAt(nc, circle, 0.2)!), [0, -1, 0]);
    // G18 반원 (200,5,0) → (220,5,0), 중심 (210,5,0): 가운데 점에서 접선은 X 방향(XZ 평면, 반지름에 수직)
    const hm = movePointAt(nc, half, 0.5)!;
    const ht = c.at(nc, hm, movePointAt(nc, half, 0.2)!)!;
    expect(ht[1]).toBeCloseTo(0, 12);
    expect(Math.abs(ht[0])).toBeCloseTo(1, 12);
    // 나선: 높이 기울기가 든다(반시계, 반지름 10, 한 바퀴에 −6)
    const lead = Math.hypot(2 * Math.PI * 10, 6);
    close(c.at(nc, [280, 0, -3], movePointAt(nc, helix, 0.8)!), [0, -(2 * Math.PI * 10) / lead, -6 / lead]);
  });

  it('끝과 가운데 점이 겹치면(두 원호) 커서가 놓인 원호의 것을 준다', () => {
    // 첫 원호 (0,0)→(20,0) 반원(중심 (10,0), 시계 — 가운데 점 (10,10)), 둘째 원호 (10,10)→(30,10) 반원 시작
    const two = program(['G21 G90 G17', 'G0 X0 Y0', 'G2 X20 Y0 I10 J0 F300', 'G0 X10 Y10', 'G2 X30 Y10 I10 J0'].join('\n'));
    const [i, j] = arcMoves(two) as [number, number];
    const c = new ArcTangents();
    close(movePointAt(two, i, 0.5)!, [10, 10, 0]);
    // 첫 원호 위를 가리키면 그 가운데 점의 접선(커서가 앞 반이면 −X, 뒤 반이면 +X), 둘째 원호 위면 그 시작의 접선(+Y)
    close(c.at(two, [10, 10, 0], movePointAt(two, i, 0.2)!), [-1, 0, 0]);
    close(c.at(two, [10, 10, 0], movePointAt(two, i, 0.8)!), [1, 0, 0]);
    close(c.at(two, [10, 10, 0], movePointAt(two, j, 0.3)!), [0, 1, 0]);
  });
});

describe('원호 위 아무 점의 접선(15차)', () => {
  // 위와 같은 1/4 원(시계, 중심 (20,20), 5°씩 18개 현)과 이어지는 직선, 한 바퀴 원(시작 = 끝 = (100,0)), 한 바퀴 나선
  const nc = program(['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G0 X100 Y0', 'G2 X100 Y0 I-10 J0', 'G0 X300 Y0 Z0', 'G3 X300 Y0 Z-6 I-10 J0'].join('\n'));
  const [q, circle, helix] = arcMoves(nc) as [number, number, number];
  const v3 = movePointAt(nc, q, 3 / 18)!;
  const v4 = movePointAt(nc, q, 4 / 18)!;
  // 넷째 현의 가운데: 원호에서 처짐만큼 안쪽(코어가 현 위에 찍은 첫 점)
  const chordMid = [(v3[0] + v4[0]) / 2, (v3[1] + v4[1]) / 2, 0];
  const fa = 3.5 / 18;
  // 시계 방향이라 진행 방향 접선은 (sin t, −cos t) — t = 시작 각 135°에서 −90° × f
  const t = (3 * Math.PI) / 4 - (Math.PI / 2) * fa;
  const T = [Math.sin(t), -Math.cos(t), 0];
  const neg = (v: readonly number[]): number[] => v.map((x) => -x + 0);

  it('끝·가운데 점이 아닌 원호 위 자리(현의 가운데·현의 끝)를 찾고, 원호 위 가장 가까운 자리를 준다', () => {
    const on = arcsOnAt(nc, chordMid);
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ move: q, end: 'on' });
    expect(on[0]!.f).toBeCloseTo(fa, 9);
    // 현의 끝(코어 끝점 붙잡기 — 원호 위)
    const v5 = movePointAt(nc, q, 5 / 18)!;
    expect(arcsOnAt(nc, v5)[0]!.f).toBeCloseTo(5 / 18, 9);
    // float32 장면 좌표의 반올림만큼 어긋나도
    expect(arcsOnAt(nc, chordMid.map((x) => Math.fround(x)))).toHaveLength(1);
    // 이미 끝으로 찾은 원호는 뺀다
    expect(arcsOnAt(nc, [0, 40, 0], Math.PI / 36, new Set([q]))).toEqual([]);
    // 원호 밖 0.5 mm, 다른 높이, 이어지는 직선 위, 나누기 각이 작아 현이 원호에 붙으면(처짐이 작음) 원호 밖
    const r = Math.hypot(20, 20);
    const out = [20 + ((chordMid[0]! - 20) * (r + 0.5)) / r, 20 + ((chordMid[1]! - 20) * (r + 0.5)) / r, 0];
    expect(arcsOnAt(nc, out)).toEqual([]);
    expect(arcsOnAt(nc, [chordMid[0]!, chordMid[1]!, 1])).toEqual([]);
    expect(arcsOnAt(nc, [50, 40, 0])).toEqual([]);
    expect(arcsOnAt(nc, chordMid, Math.PI / 360)).toEqual([]);
  });

  it('그 자리의 접선을 원호를 따라 커서 쪽으로 준다(첫 점은 현 위라 원호에서 조금 벗어나도 방향만)', () => {
    const ends = arcsOnAt(nc, chordMid);
    close(arcTangentAtF(nc, q, fa), T);
    for (const f of [0.3, 0.6, 1]) close(arcTangentAt(nc, ends, chordMid, movePointAt(nc, q, f)!), T);
    for (const f of [0, 0.1]) close(arcTangentAt(nc, ends, chordMid, movePointAt(nc, q, f)!), neg(T));
    // 원호 밖·이어지는 직선 위·첫 점 자리면 없다
    expect(arcTangentAt(nc, ends, chordMid, [50, 40, 0])).toBeNull();
    expect(arcTangentAt(nc, ends, chordMid, chordMid)).toBeNull();
    // 재생 중 아직 그리지 않은 원호
    expect(arcTangentAt(nc, ends, chordMid, movePointAt(nc, q, 0.6)!, Math.PI / 36, q - 1)).toBeNull();
  });

  it('ArcTangents가 첫 점마다 원호 위 자리도 찾는다 — 나누기 각이 바뀌면 다시 찾는다', () => {
    const c = new ArcTangents();
    close(c.at(nc, chordMid, movePointAt(nc, q, 0.6)!), T);
    expect(c.at(nc, chordMid, movePointAt(nc, q, 0.6)!, Math.PI / 360)).toBeNull();
    // 끝·가운데 점은 예전 그대로(끝은 원호 쪽, 가운데 점은 커서 쪽)
    close(c.at(nc, [40, 40, 0], movePointAt(nc, q, 0.6)!), [-H, H, 0]);
    close(c.at(nc, movePointAt(nc, q, 0.5)!, movePointAt(nc, q, 0.2)!), [-1, 0, 0]);
  });

  it('한 바퀴 원은 가까운 쪽으로 돌고, 나선은 높이 기울기가 든다', () => {
    const c = new ArcTangents();
    const a = movePointAt(nc, circle, 0.1)!;
    const fwd = arcTangentAtF(nc, circle, 0.1)!;
    close(c.at(nc, a, movePointAt(nc, circle, 0.3)!), fwd);
    close(c.at(nc, a, movePointAt(nc, circle, 0.05)!), neg(fwd));
    // 0.9는 앞으로 0.8바퀴보다 뒤로(시작을 지나) 0.2바퀴가 가깝다
    close(c.at(nc, a, movePointAt(nc, circle, 0.9)!), neg(fwd));
    // 나선(시작 ≠ 끝)은 f 차례 그대로
    const h = movePointAt(nc, helix, 0.3)!;
    const lead = Math.hypot(2 * Math.PI * 10, 6);
    const ht = arcTangentAtF(nc, helix, 0.3)!;
    expect(ht[2]).toBeCloseTo(-6 / lead, 12);
    close(c.at(nc, h, movePointAt(nc, helix, 0.95)!), ht);
    close(c.at(nc, h, movePointAt(nc, helix, 0.1)!), neg(ht));
  });
});

// 판 300×200×19: 윤곽 1(직선 → 반시계 호 R20 (80,20)→(100,40), 중심 (80,40) → 직선)을 따라 가는 윤곽 가공, 가공 없는 원 윤곽 2(R20 반원 둘)
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

<100 \\WerkStck\\
LA="300"
BR="200"
DI="19"

<105 \\Konturfraesen\\
EA="1:0"
EE="1:3"
TNO="101"
ZA="5"
!
`;

describe('판재 윤곽 호의 접선(15차)', () => {
  const r = parseForView('tan.mpr', new TextEncoder().encode(MPR));
  const t = r.mpr!.snap!;
  const arcs = panelArcs(t);
  const route = arcs.findIndex((g) => g.cu === 80 && g.cv === 40);
  const z = arcs[route]!.s[2]!;
  const S = [80, 20, z];
  const E = [100, 40, z];
  const at = (deg: number): number[] => [80 + 20 * Math.cos((deg * Math.PI) / 180), 40 + 20 * Math.sin((deg * Math.PI) / 180), z];
  const doc = (): TangentDoc => ({ nc: null, mpr: r.mpr!, playSec: null, playMove: -1, scene: r.scene });

  it('붙잡기 표에 호 정의(시작·끝·중심·중심각)가 남아 있어 호 요소를 모은다(직선은 뺀다) — 장면은 그대로', () => {
    // 윤곽 가공의 호 하나 + 가공 없는 원 윤곽의 반원 둘
    expect(arcs).toHaveLength(3);
    expect(arcs[route]).toMatchObject({ a0: 0, a1: 1, a2: 2, cu: 80, cv: 40 });
    expect(arcs[route]!.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(panelArcs(t)).toBe(arcs);
    // 장면의 호 나누기 각은 기본(meta에 없음)
    expect((r.scene.meta as { arcAngle?: number }).arcAngle).toBeUndefined();
  });

  it('첫 점에 닿는 호 요소: 시작·끝·가운데 점(앱 붙잡기와 같은 자리)·그 밖의 호 위, 직선 위는 아니다', () => {
    expect(panelArcsAt(arcs, S)).toEqual([{ move: route, end: 0 }]);
    expect(panelArcsAt(arcs, E)).toEqual([{ move: route, end: 1 }]);
    expect(panelArcsAt(arcs, at(-45))).toEqual([{ move: route, end: 0.5 }]);
    const on = panelArcsAt(arcs, at(-80));
    expect(on).toEqual([{ move: route, end: 'on', f: expect.closeTo(1 / 9, 9) }]);
    expect(panelArcsAt(arcs, [50, 20, z])).toEqual([]);
    expect(panelArcsAt(arcs, [100, 60, z])).toEqual([]);
  });

  it('끝은 호 쪽, 가운데 점·다른 자리는 커서 쪽 접선 — 문서(ofDoc)도 같은 것', () => {
    const c = new ArcTangents();
    close(c.at(t, S, at(-45)), [1, 0, 0]);
    close(c.at(t, E, at(-45)), [0, -1, 0]);
    close(c.at(t, at(-45), at(-20)), [H, H, 0]);
    close(c.at(t, at(-45), at(-70)), [-H, -H, 0]);
    // 현 위(첫 현의 가운데 — 호에서 처짐만큼 안쪽): 가장 가까운 자리(−87.5°)의 접선
    const m = [(S[0]! + at(-85)[0]!) / 2, (S[1]! + at(-85)[1]!) / 2, z];
    const u = (-87.5 * Math.PI) / 180;
    close(c.at(t, m, at(-30)), [-Math.sin(u), Math.cos(u), 0]);
    // 직선 위를 가리키거나 첫 점이 직선 위면 없다
    expect(c.at(t, at(-45), [100, 60, z])).toBeNull();
    expect(c.at(t, [50, 20, z], at(-45))).toBeNull();
    close(new ArcTangents().ofDoc(doc(), at(-45), at(-20)), [H, H, 0]);
  });

  it('가공 없는 원 윤곽: 두 반원이 만나는 점은 커서가 놓인 반원 쪽', () => {
    const c = new ArcTangents();
    // 아래 반원 (200,50)→(240,50)은 반시계(바닥에서 +X), 위 반원 (240,50)→(200,50)
    close(c.at(t, [220, 30, 19], [220 + 20 * Math.cos(-1), 50 + 20 * Math.sin(-1), 19]), [1, 0, 0]);
    close(c.at(t, [240, 50, 19], [220 + 20 * Math.cos(0.5), 50 + 20 * Math.sin(0.5), 19]), [0, 1, 0]);
    close(c.at(t, [240, 50, 19], [220 + 20 * Math.cos(-0.5), 50 + 20 * Math.sin(-0.5), 19]), [0, -1, 0]);
  });

  it('ofDoc: NC 문서는 이동(재생 중이면 그린 이동까지), 원호를 모르는 문서는 null', () => {
    const text = ['G21 G90 G17', 'G0 X0 Y30 Z0', 'G1 X0 Y40 F500', 'G2 X40 Y40 I20 J-20', 'G1 X60 Y40'].join('\n');
    const n = parseForView('t.nc', new TextEncoder().encode(text));
    const nc = n.nc!;
    const q = arcMoves(nc)[0]!;
    const d: TangentDoc = { nc, mpr: null, playSec: null, playMove: -1, scene: n.scene };
    const mid = movePointAt(nc, q, 0.5)!;
    close(new ArcTangents().ofDoc(d, [0, 40, 0], mid), [H, H, 0]);
    // 원호 앞 이동까지 그렸으면 없다, 원호까지 그렸으면 있다
    expect(new ArcTangents().ofDoc({ ...d, playSec: moveEndTime(nc.timeline, q - 1), playMove: q - 1 }, [0, 40, 0], mid)).toBeNull();
    expect(new ArcTangents().ofDoc({ ...d, playSec: moveEndTime(nc.timeline, q), playMove: q }, [0, 40, 0], mid)).not.toBeNull();
    expect(new ArcTangents().ofDoc({ ...d, nc: null }, [0, 40, 0], mid)).toBeNull();
  });
});
