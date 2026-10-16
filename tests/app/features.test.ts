import { describe, expect, it } from 'vitest';
import { loadNcFile } from '../../src/index';
import { ncPayload } from '../../src/app/payload';
import type { ParseResult } from '../../src/app/protocol';
import { createDoc, moveSegments, sceneFeatures, toolFirstMoveLine, toolSelectLine, warningLabel } from '../../src/app/doc';

const enc = new TextEncoder();
function parse(name: string, text: string, scene = {}): ParseResult {
  const { parsed, scene: s } = loadNcFile(name, enc.encode(text), { scene: { nc: scene } });
  const out: ParseResult = { kind: parsed.kind, scene: s, ms: 1 };
  if (parsed.kind === 'mpr') out.mpr = { lines: parsed.part.lines };
  else out.nc = ncPayload(parsed.program);
  return out;
}

const PROG = `G21 G90 G17
(T1 D=10.)
T1 M6
S1000 M3
G0 X-20 Y-20 Z5
G1 Z-2 F100
G41 D1 X0 Y0 F500
Y50
X50
G40 X70 Y70
(T2 D=6.)
T2 M6
G0 X0 Y0
G1 Z-1 F100
M30`;

describe('앱 도움 함수(선택 기능)', () => {
  it('공구 줄 고르기: 처음 나온 줄(T1 M6)이 이동을 만들지 않으면 그 공구의 첫 이동 줄', () => {
    const res = parse('a.nc', PROG);
    const nc = res.nc!;
    const t1 = nc.tools.find((t) => t.number === 1)!;
    expect(t1.firstLine).toBe(2);
    // 첫 G0은 시작점이 되어 이동이 없다 → 첫 이동은 6번째 줄(G1 Z-2)
    expect(toolFirstMoveLine(nc, 1)).toBe(5);
    expect(toolSelectLine(nc, 1, t1.firstLine)).toBe(5);
    // 첫 줄이 그 공구의 이동을 만들면 그대로
    expect(toolSelectLine(nc, 1, 6)).toBe(6);
    expect(toolFirstMoveLine(nc, 9)).toBe(-1);
    expect(toolSelectLine(nc, 9, 3)).toBe(3);
  });

  it('경고 단추 글·장면 선택 기능 정보', () => {
    const plain = parse('a.nc', PROG);
    const d = createDoc('a.nc', 10, plain);
    expect(warningLabel(d)).toBe('');
    const warn = createDoc('b.nc', 10, parse('b.nc', 'G1 X1 F100\nG1 A5'));
    expect(warningLabel(warn)).toMatch(/^경고 \d+개$/);
    const f = sceneFeatures(plain.scene);
    expect(f).toEqual({ compRunCount: 1, compRuns: null, lathe: false, rotaryAxes: false, disabledOps: 0 });
    const comp = parse('a.nc', PROG, { compPath: true });
    const g = sceneFeatures(comp.scene);
    expect(g.compRuns).toEqual([expect.objectContaining({ radius: 5, computed: true, side: 1 })]);
  });

  it('선분 강조는 보정 경로(nc-comp)를 빼고, 고르면 넣는다', () => {
    const res = parse('a.nc', PROG, { compPath: true });
    expect(res.scene.lines.some((l) => l.id === 'nc-comp')).toBe(true);
    // 이동 4 = G40 나오기
    const plain = moveSegments(res.scene, [4]);
    const withComp = moveSegments(res.scene, [4], 200_000, true);
    expect(plain.length).toBe(6);
    expect(withComp.length).toBeGreaterThan(6);
  });
});
