/**
 * 깎기 시뮬레이션 준비: 3축이 아닌 프로그램 알리기, 소재 기본값, 격자 크기, 공구 표(파일 값 + 사용자 표).
 */
import { describe, expect, it } from 'vitest';
import { parseGcode } from '../src/gcode';
import { parseHeidenhain } from '../src/heidenhain';
import { autoLongCells, blankComments, defaultStock, hasCutMoves, longCellsFor, rapidEventRows, simBlocker, simToolRows, sweepArea, usedTools } from '../src/sim/setup';
import { cornerFromText, fileTool, prepareTool, profileAt, resolveTool, toolKindFromText } from '../src/sim/tool';
import { sourceLine } from '../src/text';
import type { NcProgram } from '../src/model';

const block = (text: string, kind = 'gcode', extra: Partial<{ lathe: boolean; rotaryAxes: boolean; hasCut: boolean }> = {}) =>
  simBlocker({ kind, lathe: false, rotaryAxes: false, text, hasCut: true, ...extra });

describe('3축이 아니면 시뮬레이션하지 않는다', () => {
  it('G-code: 기울인 평면·공구 끝점 제어·5축 변환 — 주석 속 낱말은 보지 않는다', () => {
    expect(block('G0 X0 Y0\nG1 Z-1 F100\n')).toBeNull();
    expect(block('G0 X0\n(G68.2 IS NOT USED HERE)\n; TRAORI too\nG1 Z-1\n')).toBeNull();
    expect(block('G0 X0\nG68.2 X0 Y0 Z0 I0 J45 K0\nG53.1\n')).toEqual({ code: 'tilt', token: 'G68.2', line: 1 });
    expect(block('G43.4 H1\n')?.token).toBe('G43.4');
    expect(block('N10 TRAORI\n')?.code).toBe('tilt');
    expect(block('CYCLE800(1,"TC1",200000,57,0,0,0,0,30,0,0,0,0,-1,100,1)\n')?.token).toBe('CYCLE800');
    expect(block('ROT X30\n')?.token).toBe('ROT X');
    // 평면 안 회전(G68 R, ROT Z·RPL)은 3축 그대로
    expect(block('G68 X0 Y0 R30\nROT Z45\nAROT RPL=10\n')).toBeNull();
    expect(block('G68.25\n')).toBeNull();
  });

  it('Heidenhain: PLANE(RESET 빼고)·CYCL DEF 19·M128·TCPM·공구 축 X/Y', () => {
    const H = (s: string) => block(s, 'heidenhain');
    expect(H('0 BEGIN PGM A MM\n1 TOOL CALL 1 Z S3000\n2 PLANE RESET STAY\n')).toBeNull();
    expect(H('1 TOOL CALL 1 Z S3000\n2 PLANE SPATIAL SPA+0 SPB+10 SPC+0 TURN\n')).toEqual({ code: 'tilt', token: 'PLANE SPATIAL', line: 1 });
    expect(H('5 CYCL DEF 19.0 WORKING PLANE\n')?.code).toBe('tilt');
    expect(H('5 L X+0 R0 FMAX M128\n')?.token).toBe('M128');
    expect(H('5 FUNCTION TCPM F TCP AXIS POS PATHCTRL AXIS\n')?.code).toBe('tilt');
    expect(H('3 TOOL CALL 5 X S1000\n')).toEqual({ code: 'tool-axis', token: 'TOOL CALL 5 X', line: 0 });
    expect(H('3 TOOL CALL "MILL_D10" Y S1000\n')?.code).toBe('tool-axis');
    expect(H('3 TOOL CALL "MILL_D10" Z S1000\n4 TOOL CALL Z S2000\n; TOOL CALL 1 X in a comment\n')).toBeNull();
    expect(H('%P G71 *\nN30 T1 G18 S3000 *\n')?.code).toBe('tool-axis');
  });

  it('선반·회전축·판재·절삭 없음', () => {
    expect(block('G0 X0', 'gcode', { lathe: true })?.code).toBe('lathe');
    expect(block('G0 X0', 'gcode', { rotaryAxes: true })?.code).toBe('rotary');
    expect(block('', 'mpr')?.code).toBe('panel');
    expect(block('G0 X0', 'gcode', { hasCut: false })?.code).toBe('no-cut');
  });

  it('주석을 지워도 줄 위치를 지킨다', () => {
    const t = 'G0 X0 (A\nB) ; c\nG1 (x) Z1 ; y';
    const b = blankComments(t);
    expect(b.length).toBe(t.length);
    expect(b.split('\n').length).toBe(3);
    expect(b).not.toMatch(/[xy]/);
  });
});

describe('소재 기본값', () => {
  it('BLK FORM이 있으면 그대로', () => {
    const p = parseHeidenhain('0 BEGIN PGM T MM\n1 BLK FORM 0.1 Z X+0 Y+0 Z-20\n2 BLK FORM 0.2 X+100 Y+80 Z+0\n3 TOOL DEF 1 L+0 R+5\n4 TOOL CALL 1 Z S3000\n5 L X+10 Y+10 Z+5 R0 FMAX\n6 L Z-2 F200\n7 L X+50\n8 END PGM T MM\n');
    expect(defaultStock({ stock: p.stock ?? null, cutBounds: p.feedBounds ?? null, units: 'mm' }, 5)).toEqual({ min: [0, 0, -20], max: [100, 80, 0] });
  });

  it('절삭 범위에서: 옆은 공구 반지름 + 여유, 윗면 Z0, 바닥은 가장 깊은 절삭 아래', () => {
    const p = parseGcode('G21 G90\nG0 X0 Y0 Z5\nG1 Z-4 F100\nG1 X100 Y50\nG0 Z5\n');
    const s = defaultStock({ cutBounds: p.feedBounds ?? null, units: 'mm', moves: p.moves }, 5)!;
    // 여유 = 5 + max(2, 4) = 9
    expect(s.min).toEqual([-9, -9, -6]);
    expect(s.max).toEqual([109, 59, 0]);
  });

  it('작업 원점이 소재 아래면(모든 절삭이 Z0 위) 가장 높은 수평 절삭 높이를 윗면으로', () => {
    const p = parseGcode('G20 G90\nG0 X0 Y0 Z2\nG1 Z0.75 F10\nG1 X4\nG1 Z0.5\nG1 X0\nG0 Z2\n');
    const s = defaultStock({ cutBounds: p.feedBounds ?? null, units: 'inch', moves: p.moves }, 0.125)!;
    expect(s.max[2]).toBeCloseTo(0.75, 9);
    expect(s.min[2]).toBeCloseTo(0.5 - 2 / 25.4, 9);
  });

  it('격자 크기: 고른 값, 자동은 휴대폰 384 · 넓은 화면 1024(메모리가 적으면 낮게)', () => {
    expect(longCellsFor(512, true)).toBe(512);
    expect(longCellsFor('auto', true)).toBe(384);
    expect(longCellsFor('auto', false)).toBe(1024);
    expect(longCellsFor('auto', false, 4)).toBe(512);
    expect(longCellsFor('auto', false, 2)).toBe(384);
  });

  it('자동 해상도: 계산량 어림이 한도를 넘으면 칸을 키운다(256칸 아래로는 줄이지 않음)', () => {
    // 3D 다듬기처럼 짧은 기울어진 이동 30만 개(공구 반지름 3): 공구 원 넓이만 약 850만 mm²
    const n = 300000;
    const points = new Float64Array((n + 1) * 3);
    for (let i = 0; i <= n; i++) {
      points[i * 3] = (i % 1000) * 0.1;
      points[i * 3 + 1] = Math.floor(i / 1000) * 0.3;
      points[i * 3 + 2] = -1 - (i % 2) * 0.01;
    }
    const m = { count: n, kind: new Uint8Array(n).fill(1), points, flags: new Uint16Array(n) };
    const area = sweepArea(m, () => 3, 0);
    expect(area).toBeGreaterThan(n * Math.PI * 9);
    expect(autoLongCells(1024, 100, area, false)).toBeLessThan(1024);
    expect(autoLongCells(1024, 100, area, false)).toBeGreaterThanOrEqual(256);
    expect(autoLongCells(384, 100, area, true)).toBe(256);
    // 작은 프로그램은 그대로
    expect(autoLongCells(1024, 100, 5000, false)).toBe(1024);
    // 소재 위(윗면 0 위)만 지나는 이동은 세지 않는다
    expect(sweepArea({ ...m, points: points.map((v, k) => (k % 3 === 2 ? 5 : v)) }, () => 3, 0)).toBe(0);
  });

  it('급속 사건 → 줄마다 한 줄, 해석 경고에 급속 경고가 있는 줄은 빼고 센다', () => {
    const line = new Uint32Array([0, 1, 2, 2, 3]);
    const ev = [
      { move: 1, depth: 0.5 },
      { move: 2, depth: 1 },
      { move: 3, depth: 2 },
      { move: 4, depth: 3 },
    ];
    const warn = [{ text: '급속 이동이 가장 깊은 절삭(Z-5)보다 아래로 내려감', line: 3, lines: [3] }, { text: '다른 경고', line: 1, lines: [1] }];
    expect(rapidEventRows(ev, line, warn)).toEqual({
      rows: [
        { move: 1, line: 1, depth: 0.5 },
        { move: 2, line: 2, depth: 2 },
      ],
      skipped: 1,
    });
    expect(rapidEventRows(ev, line, [{ text: '공작물 윗면(Z0)보다 낮은 높이에서 급속 수평 이동', line: 2, lines: [] }]).skipped).toBe(1);
  });

  it('절삭 이동·쓰인 공구', () => {
    const p = parseGcode('G0 X0 Y0 Z5\nG0 X2\nT1 M6\nG0 X1\nT2 M6\nG1 Z-1 F100\n');
    expect(hasCutMoves(p.moves)).toBe(true);
    expect(usedTools(p.moves.tool, p.moves.count)).toEqual([-1, 1, 2]);
    expect(hasCutMoves(parseGcode('G0 X0 Y0 Z5\nG0 X10\n').moves)).toBe(false);
  });
});

describe('공구 표', () => {
  it('이름·주석 낱말로 종류, CR=로 모서리 반지름', () => {
    expect(toolKindFromText('1/2 BALL ENDMILL').kind).toBe('ball');
    expect(toolKindFromText('8MM DRILL')).toEqual({ kind: 'drill', angle: 118 });
    expect(toolKindFromText('SPOT DRILL 90DEG')).toEqual({ kind: 'drill', angle: 90 });
    expect(toolKindFromText('bull nose end mill').kind).toBe('bull');
    expect(toolKindFromText('FLAT END MILL').kind).toBeUndefined();
    expect(cornerFromText('T1 D=6. CR=0.5 - ZMIN=-5.')).toBe(0.5);
    expect(cornerFromText('T1 D=6. - flat')).toBeUndefined();
  });

  it('Fusion 꼴 머리 공구 목록(CR=)과 공구 교환 주석, Heidenhain TOOL DEF', () => {
    const text = [
      '%',
      'O1000 (PART)',
      '(T1 D=10. CR=0. - ZMIN=-6. - flat end mill)',
      '(T2 D=6. CR=3. - ZMIN=-4. - ball end mill)',
      '(T3 D=8. CR=1. - ZMIN=-4. - bull nose end mill)',
      'G21 G90',
      'T1 M6',
      'G0 X0 Y0 Z5',
      'G1 Z-1 F100',
      'T2 M6',
      'G1 X5',
      'T3 M6',
      'G1 X10',
      'T4 M6 (8MM DRILL)',
      'G1 Z-3',
      'T5 M6',
      'G1 X20',
      'M30',
    ].join('\n');
    const p = parseGcode(text);
    const rows = simToolRows(
      { tools: p.tools, units: 'mm', used: usedTools(p.moves.tool, p.moves.count).filter((n) => n >= 0), lineAt: (i) => sourceLine(p.source, i), lineCount: p.source.lineCount },
      { 5: { diameter: 12, kind: 'ball' } },
    );
    const by = Object.fromEntries(rows.map((r) => [r.number, r]));
    expect(by[1]!.tool).toMatchObject({ kind: 'flat', diameter: 10 });
    expect(by[2]!.tool).toMatchObject({ kind: 'ball', diameter: 6, corner: 3 });
    expect(by[3]!.tool).toMatchObject({ kind: 'bull', diameter: 8, corner: 1 });
    expect(by[4]!.tool).toMatchObject({ kind: 'drill', diameter: 8, angle: 118 });
    expect([by[4]!.diameterFrom, by[4]!.kindFrom]).toEqual(['file', 'file']);
    // 파일이 모르는 공구는 사용자 표
    expect(by[5]!.tool).toMatchObject({ kind: 'ball', diameter: 12, corner: 6 });
    expect([by[5]!.diameterFrom, by[5]!.kindFrom]).toEqual(['user', 'user']);
    const h: NcProgram = parseHeidenhain('0 BEGIN PGM T MM\n1 TOOL DEF 7 L+0 R+4\n2 TOOL CALL 7 Z S3000\n3 L X+0 Y+0 Z+5 R0 FMAX\n4 L Z-2 F100\n5 END PGM T MM\n');
    const hr = simToolRows({ tools: h.tools, units: 'mm', used: [7], lineAt: (i) => sourceLine(h.source, i), lineCount: h.source.lineCount }, {});
    expect(hr[0]!.tool).toMatchObject({ kind: 'flat', diameter: 8 });
  });

  it('모르면 기본값(평 엔드밀 6 mm · 0.25 inch), 사용자 값은 파일 값보다 먼저, 불 노즈 모서리는 반지름 안으로', () => {
    expect(resolveTool(9, {}, undefined, 'mm')).toMatchObject({ tool: { kind: 'flat', diameter: 6 }, diameterFrom: 'default', kindFrom: 'default' });
    expect(resolveTool(9, {}, undefined, 'inch').tool.diameter).toBe(0.25);
    expect(resolveTool(1, { diameter: 10, kind: 'flat' }, { diameter: 8 }, 'mm')).toMatchObject({ tool: { diameter: 8 }, diameterFrom: 'user', kindFrom: 'file' });
    expect(resolveTool(1, { diameter: 10 }, { kind: 'bull', corner: 9 }, 'mm').tool.corner).toBe(5);
    expect(resolveTool(1, { diameter: 10 }, { kind: 'bull' }, 'mm').tool.corner).toBe(1.25);
    expect(fileTool({ diameter: 6, name: 'END MILL' }, { corner: 3, text: 'CR=3.' }).kind).toBe('ball');
  });

  it('공구 단면 높이', () => {
    const b = prepareTool({ kind: 'bull', diameter: 10, corner: 2, angle: 118 });
    expect(profileAt(b, 3)).toBe(0);
    expect(profileAt(b, 5)).toBeCloseTo(2, 12);
    expect(profileAt(b, 4)).toBeCloseTo(2 - Math.sqrt(3), 12);
    const c = prepareTool({ kind: 'drill', diameter: 10, corner: 0, angle: 90 });
    expect(profileAt(c, 5)).toBeCloseTo(5, 12);
    expect(prepareTool({ kind: 'bull', diameter: 10, corner: 0, angle: 0 }).code).toBe(0);
  });
});
