/**
 * 선반 공구 끝 R 보정(G41/G42 노즈 R — 28차): LinuxCNC 설명서(Cutter Compensation·Lathe User Information의 공구 방향 그림·
 * G10 L1 Q·G41.1/G42.1 L)대로, 노즈 반지름을 둥근 공구로 보고 구한 노즈 중심 경로를 공구 방향(1~8)의 가상 공구 끝으로 옮긴다.
 * 합성 프로그램만 쓴다.
 */
import { describe, expect, it } from 'vitest';
import { LATHE_TIP, ncCompPath, type NcCompPath } from '../src/comp';
import { parseGcode, type GcodeOptions } from '../src/gcode';
import { ncToScene } from '../src/scene';

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
/** 조각마다 [시작 Z, 시작 X, 끝 Z, 끝 X](XZ 단면 — Y는 0) */
const zx = (c: NcCompPath): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < c.count; i++) out.push([c.points[i * 6 + 2]!, c.points[i * 6]!, c.points[i * 6 + 5]!, c.points[i * 6 + 3]!].map(r4));
  return out;
};
const lathe = (text: string, opts: GcodeOptions = {}) => parseGcode(text, { lathe: true, ...opts });

/**
 * 바깥지름 어깨(척 쪽 −Z로 깎음, G42 — 공구는 +X 쪽): X20 직선 → 끝면(+X) → X30 직선 → 45° 테이퍼 → G2 R10 → 나오기.
 * LinuxCNC 반지름 모드(G8 — X = 반지름)
 */
const SHOULDER = (pre: string, comp = 'G42'): string => `G18 G21 G90 G40
${pre}
T1 M6
G0 X40 Z5
${comp} G1 X20 Z2 F0.2
G1 Z-20
G1 X30
G1 Z-40
G1 X40 Z-50
G2 X50 Z-55 R10
G40 G0 X60 Z-55
M2`;

describe('선반 공구 끝 R 보정(G41/G42 노즈 R)', () => {
  it('공구 방향 표는 LinuxCNC 그림대로(0°가 Z+, 시계 방향 90°가 X+ — 7·2·6·1·5·4·8·3, 9는 노즈 중심)', () => {
    expect(LATHE_TIP).toEqual({ 1: [-1, 1], 2: [1, 1], 3: [1, -1], 4: [-1, -1], 5: [-1, 0], 6: [0, 1], 7: [1, 0], 8: [0, -1], 9: [0, 0] });
    // 그림의 각(시계 방향, Z+에서): 7 0° · 2 45° · 6 90° · 1 135° · 5 180° · 4 225° · 8 270° · 3 315°
    for (const [q, deg] of [[7, 0], [2, 45], [6, 90], [1, 135], [5, 180], [4, 225], [8, 270], [3, 315]] as const) {
      const [dz, dx] = LATHE_TIP[q]!;
      expect(Math.sign(dz)).toBe(Math.sign(r4(Math.cos((deg * Math.PI) / 180))));
      expect(Math.sign(dx)).toBe(Math.sign(r4(Math.sin((deg * Math.PI) / 180))));
    }
  });

  it('LinuxCNC G10 L1 R·Q: 방향 4(−Z·−X 쪽 가상 공구 끝)면 축과 나란한 직선·끝면에서 공구 끝 경로가 프로그램 경로 위에 놓인다', () => {
    const p = lathe(SHOULDER('G10 L1 P1 R0.5 Q4'), { dialect: 'linuxcnc' });
    expect(p.compRuns).toEqual([
      { first: 0, end: 6, side: 2, plane: 1, radius: 0.5, source: 'G10 T1 반지름', line: 4, tool: 1, orientation: 4, orientationSource: 'G10 T1 Q' },
    ]);
    const c = ncCompPath(p);
    expect(c.warnings).toEqual([]);
    expect(c.runs[0]!.tip).toBe(true);
    const z = zx(c);
    // 들어가기: 보정 없는 시작점(Z5 X40)에서 다음 요소(Z2→Z-20, X20) 시작의 노즈 중심(Z2, X20.5) + 공구 끝 (−0.5, −0.5)
    expect(z[0]).toEqual([5, 40, 1.5, 20]);
    // X20 직선: 공구 끝은 X20 위(노즈 중심은 X20.5), 안쪽 모서리(어깨)에서 끝면과 만나는 곳까지 — 프로그램 모서리(Z-20, X20)
    expect(z[1]).toEqual([1.5, 20, -20, 20]);
    // 끝면(+X): 공구 끝 Z = −20(노즈 중심은 Z−19.5)
    expect(z[2]![0]).toBe(-20);
    expect(z[2]![2]).toBe(-20);
    // 나오기: 마지막 공구 끝에서 보정 없는 끝점(Z-55, X60)까지
    expect(z.at(-1)!.slice(2)).toEqual([-55, 60]);
    // 프로그램 경로는 그대로
    expect(Array.from(p.moves.points.slice(6, 9))).toEqual([20, 0, -20]);
  });

  it('공구 끝 경로 = 노즈 중심 경로 + 방향 벡터 × 반지름(들어가기 시작점·나오기 끝점 빼고, 원호 중심도 옮김)', () => {
    const tip = ncCompPath(lathe(SHOULDER('G10 L1 P1 R0.8 Q2'), { dialect: 'linuxcnc' }));
    const ctr = ncCompPath(lathe(SHOULDER('G10 L1 P1 R0.8 Q9'), { dialect: 'linuxcnc' }));
    expect(ctr.runs[0]!.orientation).toBe(9);
    expect(ctr.runs[0]!.tip).toBeUndefined();
    expect(ctr.warnings).toEqual([]);
    expect(Array.from(tip.kind)).toEqual(Array.from(ctr.kind));
    expect(Array.from(tip.move)).toEqual(Array.from(ctr.move));
    const [dz, dx] = [0.8, 0.8]; // 방향 2: Z+·X+
    const a = zx(tip);
    const b = zx(ctr);
    for (let i = 0; i < a.length; i++) {
      const s = i === 0 ? [0, 0] : [dz, dx];
      const e = i === a.length - 1 ? [0, 0] : [dz, dx];
      expect(a[i]).toEqual([r4(b[i]![0]! + s[0]!), r4(b[i]![1]! + s[1]!), r4(b[i]![2]! + e[0]!), r4(b[i]![3]! + e[1]!)]);
    }
    // 원호(G2 R5) 조각: 중심도 같은 만큼, 중심각은 그대로
    const k = Array.from(tip.kind).indexOf(1, 4);
    expect(k).toBeGreaterThan(0);
    expect(r4(tip.center[k * 3 + 2]! - ctr.center[k * 3 + 2]!)).toBe(dz);
    expect(r4(tip.center[k * 3]! - ctr.center[k * 3]!)).toBe(dx);
    expect(tip.sweep[k]).toBe(ctr.sweep[k]);
  });

  it('방향을 모르거나 0이면 노즈 중심 경로로 그리고 경고, 밀링 보정 값은 그대로', () => {
    const none = ncCompPath(lathe(SHOULDER('G10 L1 P1 R0.5'), { dialect: 'linuxcnc' }));
    const q9 = ncCompPath(lathe(SHOULDER('G10 L1 P1 R0.5 Q9'), { dialect: 'linuxcnc' }));
    const q0 = ncCompPath(lathe(SHOULDER('G10 L1 P1 R0.5 Q0'), { dialect: 'linuxcnc' }));
    expect(zx(none)).toEqual(zx(q9));
    expect(zx(q0)).toEqual(zx(q9));
    expect(none.runs[0]!.orientation).toBeUndefined();
    expect(none.warnings).toEqual(['5번 줄: 보정 구간(5번 줄): 선반 공구 방향(1~9)을 몰라 노즈 반지름 중심 경로로 그림']);
    // 노즈 중심은 X20 직선에서 X20.5
    expect(zx(none)[1]![1]).toBe(20.5);
    // 밀링(선반 모드 아님): 공구 표의 방향·앱 선반 공구 표는 쓰지 않는다(예전과 같은 공구 중심 경로)
    const mill = `G21 G90 G17\nG0 X-20 Y-20 Z5\nG41 D1 G1 X0 Y0 F500\nY50\nX50\nY0\nX0\nG40 X-20 Y-20\nM30`;
    const plain = parseGcode(mill, { toolTable: { 1: { radius: 5 } } });
    const extra = parseGcode(mill, { toolTable: { 1: { radius: 5, orientation: 4 } }, machine: { latheToolsMm: { 1: { radiusMm: 1, orientation: 2 } } } });
    expect(extra.compRuns).toEqual(plain.compRuns);
    expect(extra.compRuns![0]).toEqual({ first: 0, end: 5, side: 1, plane: 0, radius: 5, source: '공구 표 D1', line: 2 });
    const cp = ncCompPath(plain);
    expect(ncCompPath(extra)).toEqual(cp);
    expect(zx(cp).length).toBe(9);
    expect(Array.from(cp.points.slice(0, 6))).toEqual([-20, -20, 5, -5, 0, 5]);
  });

  it('G41.1/G42.1 D·L(LinuxCNC 동적 보정): D는 노즈 지름, L은 공구 방향(없으면 0 — 노즈 중심), 범위 밖 L은 경고', () => {
    const p = lathe(SHOULDER('', 'G42.1 D1 L4'), { dialect: 'linuxcnc' });
    expect(p.compRuns![0]).toMatchObject({ radius: 0.5, source: 'G42.1 D 지름', orientation: 4, orientationSource: 'G42.1 L' });
    expect(zx(ncCompPath(p))).toEqual(zx(ncCompPath(lathe(SHOULDER('G10 L1 P1 R0.5 Q4'), { dialect: 'linuxcnc' }))));
    const noL = lathe(SHOULDER('', 'G42.1 D1'), { dialect: 'linuxcnc' });
    expect(noL.compRuns![0]).toMatchObject({ orientation: 0, orientationSource: 'G42.1 L' });
    expect(ncCompPath(noL).warnings[0]).toContain('선반 공구 방향(1~9)을 몰라');
    const bad = lathe(SHOULDER('', 'G42.1 D1 L12'), { dialect: 'linuxcnc' });
    expect(bad.warnings.some((w) => w.includes('G41.1/G42.1 L(선반 공구 방향)이 0~9의 정수가 아님'))).toBe(true);
    expect(bad.compRuns![0]!.orientation).toBe(0);
    const badQ = lathe(SHOULDER('G10 L1 P1 R0.5 Q11'), { dialect: 'linuxcnc' });
    expect(badQ.warnings.some((w) => w.includes('G10 공구 방향 Q는 0~9의 정수 — 무시함'))).toBe(true);
    expect(badQ.compRuns![0]!.orientation).toBeUndefined();
  });

  it('앱 선반 공구 표(machine.latheToolsMm, mm): 파일에 값이 없을 때만 — 파일 값(G10 L1 R·Q)이 먼저, inch 프로그램은 바꿔 씀', () => {
    const table = { latheToolsMm: { 1: { radiusMm: 0.4, orientation: 3 } } };
    // Fanuc 선반(T0101 — 열쇠는 공구 번호): 파일에 노즈 R·방향이 없다
    const fanuc = `O1000\nG18 G21 G40 G99\nT0101\nG0 X80. Z5.\nG42 G1 X40. Z2. F0.2\nG1 Z-20.\nX60.\nG40 G0 X80.\nM30`;
    const f = lathe(fanuc, { machine: table });
    expect(f.compRuns![0]).toMatchObject({ radius: 0.4, source: '선반 공구 표 T1', tool: 1, orientation: 3, orientationSource: '선반 공구 표 T1' });
    const fc = ncCompPath(f);
    expect(fc.runs[0]!.tip).toBe(true);
    // 번호 체계는 LinuxCNC 그림 — 다른 컨트롤러는 경고
    expect(fc.warnings).toContain('선반 공구 방향 번호는 LinuxCNC 설명서의 그림대로 읽음 — 다른 컨트롤러는 번호가 다를 수 있음');
    // 표가 없으면 반지름을 몰라 그리지 않는다(예전과 같음)
    const none = lathe(fanuc);
    expect(none.compRuns![0]).toMatchObject({ tool: 1 });
    expect(none.compRuns![0]!.radius).toBeNaN();
    expect(ncCompPath(none).count).toBe(0);
    // 파일 값이 먼저: G10 L1 R0.5 Q4가 있으면 표의 0.4·3은 쓰지 않는다
    const file = lathe(SHOULDER('G10 L1 P1 R0.5 Q4'), { dialect: 'linuxcnc', machine: table });
    expect(file.compRuns![0]).toMatchObject({ radius: 0.5, source: 'G10 T1 반지름', orientation: 4, orientationSource: 'G10 T1 Q' });
    // 반지름만 파일에 있으면 방향은 표에서
    const half = lathe(SHOULDER('G10 L1 P1 R0.5'), { dialect: 'linuxcnc', machine: table });
    expect(half.compRuns![0]).toMatchObject({ radius: 0.5, orientation: 3, orientationSource: '선반 공구 표 T1' });
    // inch 프로그램: 0.508 mm = 0.02 inch
    const inch = lathe(fanuc.replace('G21', 'G20'), { machine: { latheToolsMm: { 1: { radiusMm: 0.508, orientation: 3 } } } });
    expect(inch.compRuns![0]!.radius).toBeCloseTo(0.02, 12);
  });

  it('장면: 공구 방향으로 옮긴 구간이 있으면 묶음 이름이 가상 공구 끝, meta에 공구 방향과 표 열쇠', () => {
    const s = ncToScene(lathe(SHOULDER('G10 L1 P1 R0.5 Q4'), { dialect: 'linuxcnc' }), { compPath: true });
    expect(s.lines.find((l) => l.id === 'nc-comp')!.name).toBe('보정 경로(가상 공구 끝)');
    expect((s.meta as { compRuns: unknown[] }).compRuns[0]).toMatchObject({ tool: 1, orientation: 4, orientationSource: 'G10 T1 Q', radius: 0.5, computed: true });
    const c = ncToScene(lathe(SHOULDER('G10 L1 P1 R0.5'), { dialect: 'linuxcnc' }), { compPath: true });
    expect(c.lines.find((l) => l.id === 'nc-comp')!.name).toBe('보정 경로(공구 중심)');
    expect((c.meta as { compRuns: Record<string, unknown>[] }).compRuns[0]!.orientation).toBeUndefined();
  });
});
