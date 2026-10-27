/**
 * MPR 윤곽 KR(둥글리기)·KF(모따기)가 원호와 만나는 모서리(corner.ts — G-code 원호 모서리와 같은 기하):
 * 둥글리기는 두 요소에 접하는 호, 모따기 점은 모서리에서 현 길이 R, 원호 요소는 중심 그대로 끝·시작만 접점으로.
 */
import { describe, expect, it } from 'vitest';
import { parseMpr, type MprContourElement } from '../src/mpr';
import { mprToScene } from '../src/scene';
import { cornerCut, cornerElem } from '../src/corner';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const head = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n<100 \\WerkStck\\\nLA="200"\nBR="100"\nDI="19"\n`;
const contour = (body: string): MprContourElement[] => {
  const p = parseMpr(`${head}]1\n${body}\n!\n`);
  expect(p.warnings.filter((w) => w.includes('둥글리기·모따기'))).toEqual([]);
  return p.contours[0]!.elements;
};
const row = (e: MprContourElement): (string | number)[] => [e.type, r3(e.x), r3(e.y), ...(e.arc ? [r3(e.arc.cx), r3(e.arc.cy), r3(e.arc.sweep)] : [])];
/** 원호 요소의 시작(앞 요소 끝)·끝이 모두 그 원 위인지 */
const onCircle = (els: MprContourElement[]): void => {
  for (let i = 1; i < els.length; i++) {
    const e = els[i]!;
    if (!e.arc) continue;
    const a = els[i - 1]!;
    const r0 = Math.hypot(a.x - e.arc.cx, a.y - e.arc.cy);
    const r1 = Math.hypot(e.x - e.arc.cx, e.y - e.arc.cy);
    expect(Math.abs(r0 - r1), `${e.type} ${i}`).toBeLessThan(1e-9);
  }
};

describe('MPR KR·KF가 원호와 만나는 모서리', () => {
  it('직선 → KR → 시계 호: 두 요소에 접하는 R5 호, 호는 중심 그대로 시작을 접점으로', () => {
    // (0,0)→(50,0) 다음 (50,0)→(70,20) 시계 호(중심 (70,0), R20): 모서리에서 왼쪽으로 90° 꺾인다
    const els = contour('$E0\nKP\nX=0\nY=0\nZ=19\n\n$E1\nKL\nX=50\nY=0\n\n$E2\nKR\nR=5\n\n$E3\nKA\nX=70\nY=20\nDS=0\nI=70\nJ=0');
    const s = Math.sqrt(600); // 옮긴 직선 y=5와 옮긴 원 R25의 교점 x = 70 - √600
    const ang = Math.atan2(4, -20 * (s / 25));
    const rest = -(Math.PI / 2 - (Math.PI - ang));
    expect(els.map(row)).toEqual([
      ['KP', 0, 0],
      ['KL', r3(70 - s), 0],
      ['KR', r3(70 - (s * 20) / 25), 4, r3(70 - s), 5, r3(-rest)],
      ['KA', 70, 20, 70, 0, r3(rest)],
    ]);
    expect(els[2]!.radius).toBe(5);
    expect(els[2]!.dir).toBe('ccw');
    onCircle(els);
    // 둥글리기 호의 시작·끝도 두 요소에 접한다: 중심에서 접점까지 5
    const kr = els[2]!;
    expect(r3(Math.hypot(els[1]!.x - kr.arc!.cx, els[1]!.y - kr.arc!.cy))).toBe(5);
  });

  it('반시계 호 → KF → 직선: 모서리에서 두 요소 위로 현 길이 3인 두 점을 잇는다', () => {
    // (0,0)→(20,20) 반시계 호(중심 (0,20), R20) 다음 (20,20)→(20,60) — 호 끝 방향 +y, 직선 +y: 꺾이지 않아 X로 꺾은 직선으로
    const els = contour('$E0\nKP\nX=0\nY=0\nZ=19\n\n$E1\nKA\nX=20\nY=20\nDS=1\nI=0\nJ=20\n\n$E2\nKF\nR=3\n\n$E3\nKL\nX=60\nY=20');
    const a = 2 * Math.asin(3 / 40); // 현 3에 대한 중심각
    expect(els.map(row)).toEqual([
      ['KP', 0, 0],
      ['KA', r3(20 * Math.cos(-a)), r3(20 + 20 * Math.sin(-a)), 0, 20, r3(Math.PI / 2 - a)],
      ['KF', 23, 20],
      ['KL', 60, 20],
    ]);
    expect(els[2]!.arc).toBeUndefined();
    // 모따기 양 끝이 모서리 (20,20)에서 3
    expect(r3(Math.hypot(els[1]!.x - 20, els[1]!.y - 20))).toBe(3);
    onCircle(els);
  });

  it('호 → KR → 호(두 원의 교점 모서리)도 접하는 호로, 장면 경로가 이어진다', () => {
    // (0,0)→(20,20) 반시계(중심 (0,20), 끝 방향 +Y) 다음 (20,20)→(40,40) 반시계(중심 (20,40), 시작 방향 +X) — 오른쪽으로 90° 꺾인다
    const p = parseMpr(`${head}]1\n$E0\nKP\nX=0\nY=0\nZ=19\n\n$E1\nKA\nX=20\nY=20\nDS=1\nI=0\nJ=20\n\n$E2\nKR\nR=4\n\n$E3\nKA\nX=40\nY=40\nDS=1\nI=20\nJ=40\n!\n`);
    const els = p.contours[0]!.elements;
    expect(els.map((e) => e.type)).toEqual(['KP', 'KA', 'KR', 'KA']);
    onCircle(els);
    const kr = els[2]!;
    expect(kr.dir).toBe('cw');
    // 접하는 호: 두 원 바깥으로 R만큼(24 = 20 + 4 — 오른쪽으로 꺾여 도는 쪽이 두 반시계 원의 바깥)
    expect(r3(Math.hypot(kr.arc!.cx - 0, kr.arc!.cy - 20))).toBe(24);
    expect(r3(Math.hypot(kr.arc!.cx - 20, kr.arc!.cy - 40))).toBe(24);
    // 앞 호는 줄고(90°보다 작게), 뒤 호도 시작이 접점으로 옮겨 줄었다
    expect(els[1]!.arc!.sweep).toBeLessThan(Math.PI / 2);
    expect(els[3]!.arc!.sweep).toBeLessThan(Math.PI / 2);
    expect(els[3]!.arc!.sweep).toBeGreaterThan(0);
    // 장면(가공 없는 윤곽 선): 끊김 없이 이어진 꺾은선
    const s = mprToScene(p).lines.find((l) => l.id === 'mpr-contours')!.positions;
    for (let i = 6; i < s.length; i += 6) for (let k = 0; k < 3; k++) expect(Math.abs(s[i + k]! - s[i - 3 + k]!)).toBeLessThan(1e-4);
  });

  it('값이 원호보다 크거나 되돌아가는 모서리는 그대로(경고)', () => {
    const p = parseMpr(`${head}]1\n$E0\nKP\nX=0\nY=0\nZ=19\n\n$E1\nKL\nX=10\nY=0\n\n$E2\nKF\nR=30\n\n$E3\nKA\nX=10\nY=10\nDS=1\nI=0\nJ=5\n!\n`);
    expect(p.contours[0]!.elements.map((e) => e.type)).toEqual(['KP', 'KL', 'KA']);
    expect(p.warnings.some((w) => w.includes('KF(모서리 둥글리기·모따기): 크기가 변보다 큼'))).toBe(true);
    const q = parseMpr(`${head}]1\n$E0\nKP\nX=0\nY=0\nZ=19\n\n$E2\nKR\nR=3\n\n$E3\nKA\nX=10\nY=10\nDS=1\nI=10\nJ=0\n!\n`);
    expect(q.warnings.some((w) => w.includes('KR(모서리 둥글리기·모따기): 앞뒤 요소가 직선·원호가 아님'))).toBe(true);
  });

  it('공용 기하(corner.ts): 직선끼리는 G-code 모서리와 같은 접점·호', () => {
    const A = cornerElem(0, 0, 10, 0, null)!;
    const B = cornerElem(10, 0, 10, 10, null)!;
    const cut = cornerCut(A, B, 10, 0, 'round', 2);
    expect(cut.ok && [cut.t1.map(r3), cut.t2.map(r3), r3(cut.fillet!.cx), r3(cut.fillet!.cy), r3(cut.fillet!.sweep)]).toEqual([[8, 0], [10, 2], 8, 2, r3(Math.PI / 2)]);
    expect(cornerCut(A, cornerElem(10, 0, 20, 0, null)!, 10, 0, 'round', 2)).toEqual({ ok: false, reason: 'straight' });
    expect(cornerCut(A, cornerElem(10, 0, 0, 0, null)!, 10, 0, 'round', 2)).toEqual({ ok: false, reason: 'reverse' });
    expect(cornerCut(A, B, 10, 0, 'chamferLeg', 20)).toEqual({ ok: false, reason: 'too-big' });
  });
});
