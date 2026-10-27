/**
 * MPR 188 Easyedge(엣지 밴딩): EA..EE 윤곽 구간의 판 옆면에 두께 DK의 띠. 공구 경로가 아니라 윤곽 가공·시간에 넣지 않고
 * 묶음 "엣지 밴딩"의 테두리 선(띠 두께만큼 판 재료에서 먼 쪽으로 띄움)으로 그린다.
 */
import { describe, expect, it } from 'vitest';
import { parseMpr, type MprEdgeOp } from '../src/mpr';
import { mprToScene } from '../src/scene';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const head = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n_BSX=600\n_BSY=400\n_BSZ=19\n`;
const board = `<100 \\WerkStck\\\nLA="600"\nBR="400"\nDI="19"\n`;
/** 판 외곽(시계 방향: 왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래 → 처음) */
const outline = `]1\n$E0\nKP\nX=0\nY=400\nZ=0\n$E1\nKL\nX=600\nY=400\nZ=0\n$E2\nKL\nX=600\nY=0\nZ=0\n$E3\nKL\nX=0\nY=0\nZ=0\n$E4\nKL\nX=0\nY=400\nZ=0\n`;
const edge = (ea: string, ee: string, dk: string): string =>
  `<188 \\Easyedge\\\nMDA="TAN"\nMDE="TAN_AB"\nEA="${ea}"\nEE="${ee}"\nNM="STANDARD"\nTNO="STANDARD"\nDK="${dk}"\nRI="1"\nMNM="Kante ${dk}"\n`;

/** 선분 묶음의 선분들(xyz 쌍, 반올림) */
const segs = (pos: Float32Array): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < pos.length; i += 6) out.push(Array.from(pos.subarray(i, i + 6)).map(r3));
  return out;
};

describe('MPR Easyedge(엣지 밴딩)', () => {
  const text = `${head}${board}${outline}${edge('1:0', '1:1', '1')}${edge('1:1', '1:2', '0.5')}${edge('1:3', '1:2', '2')}!\n`;
  const part = parseMpr(text);
  const ops = part.operations.filter((o): o is MprEdgeOp => o.kind === 'edge');

  it('윤곽 구간·두께·띠 쪽을 읽고, 모르는 매크로 경고를 내지 않는다', () => {
    expect(part.warnings).toEqual([]);
    expect(ops.length).toBe(3);
    expect(ops.map((o) => [o.contour, o.startElement, o.endElement, o.thickness, o.side])).toEqual([
      [1, 0, 1, 1, 1],
      [1, 1, 2, 0.5, 1],
      // EA·EE가 거꾸로여도 앞쪽 차례로(띠는 방향이 없다)
      [1, 2, 3, 2, 1],
    ]);
    expect(ops[0]!.path!.map((p) => [p.x, p.y])).toEqual([
      [0, 400],
      [600, 400],
    ]);
    // 윤곽 가공·기타가 아니라 엣지 밴딩으로 센다
    expect(part.stats).toMatchObject({ contourOps: 0, other: 0, edges: 3 });
  });

  it('장면: 판 바깥으로 두께만큼 띄운 윗변·아랫변과 양 끝 세로선, 묶음 "엣지 밴딩"', () => {
    const s = mprToScene(part);
    const l = s.lines.find((x) => x.id === 'mpr-op-0')!;
    expect(l.group).toBe('엣지 밴딩');
    expect(l.name).toBe('Kante 1');
    expect(segs(l.positions)).toEqual([
      [0, 401, 0, 600, 401, 0],
      [0, 401, 19, 600, 401, 19],
      [0, 401, 0, 0, 401, 19],
      [600, 401, 0, 600, 401, 19],
    ]);
    expect(Array.from(l.segmentIds!)).toEqual([0, 0, 0, 0]);
    // 오른쪽 변(X = 600)은 X+ 쪽으로 0.5
    expect(segs(s.lines.find((x) => x.id === 'mpr-op-1')!.positions)[0]).toEqual([600.5, 400, 0, 600.5, 0, 0]);
    // 띠가 쓴 윤곽은 "윤곽(가공 없음)"으로 다시 그리지 않는다
    expect(s.lines.some((x) => x.id === 'mpr-contours')).toBe(false);
    // 가공 목록에 두께, 범위에 띠
    const meta = s.meta as { operations: { kind: string; thickness?: number }[]; stats: { edges?: number } };
    expect(meta.operations.map((o) => [o.kind, o.thickness])).toEqual([
      ['edge', 1],
      ['edge', 0.5],
      ['edge', 2],
    ]);
    expect(meta.stats.edges).toBe(3);
    expect(s.bounds!.max.map(r3)).toEqual([600.5, 401, 19]);
    expect(s.bounds!.min.map(r3)).toEqual([0, -2, 0]);
  });

  it('여러 요소에 걸친 구간은 꺾이는 점에서 띠가 벌어지지 않게 잇는다', () => {
    const p = parseMpr(`${head}${board}${outline}${edge('1:0', '1:2', '1')}!\n`);
    const l = mprToScene(p).lines.find((x) => x.group === '엣지 밴딩')!;
    expect(segs(l.positions).slice(0, 2)).toEqual([
      [0, 401, 0, 601, 401, 0],
      [601, 401, 0, 601, 0, 0],
    ]);
  });

  it('판 안의 닫힌 윤곽(따낸 구멍)은 구멍 쪽으로 띠를 붙인다', () => {
    const hole = `]2\n$E0\nKP\nX=100\nY=100\nZ=0\n$E1\nKL\nX=200\nY=100\nZ=0\n$E2\nKL\nX=200\nY=200\nZ=0\n$E3\nKL\nX=100\nY=200\nZ=0\n$E4\nKL\nX=100\nY=100\nZ=0\n`;
    const p = parseMpr(`${head}${board}${outline}${hole}${edge('2:0', '2:1', '1')}!\n`);
    const op = p.operations.find((o): o is MprEdgeOp => o.kind === 'edge')!;
    // 반시계로 도는 구멍의 아래 변: 왼쪽(+Y)이 구멍 안
    expect(op.side).toBe(1);
    expect(segs(mprToScene(p).lines.find((x) => x.id === 'mpr-op-0')!.positions)[0]).toEqual([100, 101, 0, 200, 101, 0]);
  });

  it('호가 낀 구간도 띠를 띄워 긋는다(바깥으로 볼록한 모서리)', () => {
    const round = `]1\n$E0\nKP\nX=0\nY=0\nZ=0\n$E1\nKL\nX=550\nY=0\nZ=0\n$E2\nKA\nX=600\nY=50\nZ=0\nDS=1\nR=50\n$E3\nKL\nX=600\nY=400\nZ=0\n`;
    const p = parseMpr(`${head}${board}${round}${edge('1:1', '1:2', '1')}!\n`);
    const op = p.operations.find((o): o is MprEdgeOp => o.kind === 'edge')!;
    // 반시계 호(아래 → 오른쪽 위): 판 바깥은 오른쪽
    expect(op.side).toBe(-1);
    const top = segs(mprToScene(p).lines.find((x) => x.id === 'mpr-op-0')!.positions).filter((q) => q[2] === 0);
    // 띄운 호의 점은 모두 중심(550, 50)에서 51 안팎
    for (const q of top) expect(Math.abs(Math.hypot(q[3]! - 550, q[4]! - 50) - 51)).toBeLessThan(0.02);
  });

  it('EA가 없거나 윤곽이 없으면 경고하고 목록에만', () => {
    const p = parseMpr(`${head}${board}${outline}<188 \\Easyedge\\\nDK="1"\n<188 \\Easyedge\\\nEA="7:0"\nEE="7:1"\nDK="1"\n<188 \\Easyedge\\\nEA="1:2"\nEE="1:2"\nDK="1"\n!\n`);
    expect(p.warnings.some((w) => w.includes('Easyedge에 시작 요소(EA)가 없음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('Easyedge: 윤곽 7이 없음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('Easyedge: 윤곽 구간이 비어 있음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('지원하지 않는 매크로'))).toBe(false);
    const s = mprToScene(p);
    expect(s.lines.some((x) => x.group === '엣지 밴딩')).toBe(false);
    expect((s.meta as { operations: unknown[] }).operations.length).toBe(3);
  });

  it('판 크기를 모르면 윤곽 높이에 한 줄, 꺼진 띠(??=0)는 그리지 않음', () => {
    const p = parseMpr(`[H\nVERSION="4.0 Alpha"\n${outline}${edge('1:0', '1:1', '1')}<188 \\Easyedge\\\nEA="1:1"\nEE="1:2"\nDK="1"\n??="0"\n!\n`);
    const s = mprToScene(p);
    const band = s.lines.filter((x) => x.group === '엣지 밴딩');
    expect(band.length).toBe(1);
    expect(segs(band[0]!.positions)).toEqual([[0, 401, 0, 600, 401, 0]]);
    expect(p.stats.edges).toBe(1);
    expect(p.stats.disabled).toBe(1);
  });
});
