/**
 * 원호 접선(tangent.ts): 측정 첫 점이 원호 이동의 시작·끝이고 커서 아래 점이 그 원호 위일 때 잠글 접선 방향.
 * 해석기로 읽은 합성 G-code와 손으로 만든 여러 바퀴 나선으로 접선 방향·원호 위 판정(현의 처짐 안)·끝 고르기를 본다.
 */
import { describe, expect, it } from 'vitest';
import { MOVE_ARC } from '../../src/model';
import { parseNcFile } from '../../src/index';
import { movePointAt, type SnapMoves } from '../../src/app/snap';
import { ArcTangents, arcChordSag, arcEndTangent, arcEndsAt, arcNearest, arcTangentAt } from '../../src/app/tangent';

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
