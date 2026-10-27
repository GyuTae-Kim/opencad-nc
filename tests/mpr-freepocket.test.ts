/**
 * MPR 181 FreiFormTasche(자유 형상 포켓): EA가 가리키는 닫힌 윤곽 안을 깊이 |TI|로 판 기둥.
 * TI가 음수면 아랫면(Z 0)에서 위로, 0보다 크면 윗면에서 아래로(실제 파일로 정한 뜻).
 */
import { describe, expect, it } from 'vitest';
import { parseMpr, type MprBoxOp } from '../src/mpr';
import { mprToScene } from '../src/scene';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const head = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n_BSX=400\n_BSY=300\n_BSZ=19\n`;
const board = `<100 \\WerkStck\\\nLA="400"\nBR="300"\nDI="19"\n`;
/** 중심 (100, 22.5), 반지름 17.5인 원(반시계 호 둘) */
const circle = `]2\n$E0\nKP\nX=117.5\nY=22.5\nZ=0\n$E1\nKA\nX=82.5\nY=22.5\nZ=0\nDS=1\nR=17.5\n$E2\nKA\nX=117.5\nY=22.5\nZ=0\nDS=1\nR=17.5\n`;
/** 직사각형 50 × 30(왼쪽 아래 200, 100) */
const rect = `]3\n$E0\nKP\nX=200\nY=100\nZ=0\n$E1\nKL\nX=250\nY=100\nZ=0\n$E2\nKL\nX=250\nY=130\nZ=0\n$E3\nKL\nX=200\nY=130\nZ=0\n$E4\nKL\nX=200\nY=100\nZ=0\n`;
/** 반원 둘과 직선 둘로 된 긴 구멍(가운데 (300, 200), 폭 20, 곧은 부분 10) */
const slot = `]4\n$E0\nKP\nX=300\nY=185\nZ=0\n$E1\nKA\nX=310\nY=195\nZ=0\nDS=1\nR=10\n$E2\nKL\nX=310\nY=205\nZ=0\n$E3\nKA\nX=290\nY=205\nZ=0\nDS=1\nR=10\n$E4\nKL\nX=290\nY=195\nZ=0\n$E5\nKA\nX=300\nY=185\nZ=0\nDS=1\nR=10\n`;
const pocket = (ea: string, ti: string, extra = ''): string =>
  `<181 \\FreiFormTasche\\\nEA="${ea}"\nAD="0"\nAZ="0"\nZU="0"\nTI="${ti}"\nZT="0"\nXY="50"\nT_="0"\nF_="5"\nDS="1"\nMNM="free form pocket"\n${extra}`;

/** 기둥 외곽의 xy 넓이(신발끈) */
const area = (o: number[]): number => {
  let a = 0;
  const n = o.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += o[i * 3]! * o[j * 3 + 1]! - o[j * 3]! * o[i * 3 + 1]!;
  }
  return Math.abs(a) / 2;
};

describe('MPR FreiFormTasche(자유 형상 포켓)', () => {
  const text = `${head}${board}${circle}${rect}${slot}${pocket('2:0', '-13')}${pocket('3:0', '8')}${pocket('4:0', '-2', 'ZA="0"\n')}!\n`;
  const part = parseMpr(text);
  const ops = part.operations.filter((o): o is MprBoxOp => o.kind === 'pocket');

  it('윤곽을 기둥 외곽으로, TI 부호로 면을 정하고, 모르는 매크로 경고를 내지 않는다', () => {
    expect(part.warnings).toEqual([]);
    expect(ops.length).toBe(3);
    expect(part.stats).toMatchObject({ pockets: 3, other: 0 });
    // 원(Ø35): 아랫면 Z 0에서 위로 13
    const c = ops[0]!;
    expect(c.depth).toBe(13);
    expect(c.diameter).toBe(35);
    expect(c.contour).toBe(2);
    expect(c.prism!.dir).toEqual([0, 0, 1]);
    expect(c.prism!.depth).toBe(13);
    const zs = new Set(c.prism!.outline.filter((_, i) => i % 3 === 2));
    expect([...zs]).toEqual([0]);
    // 원 넓이에 가깝게(5도 조각)
    expect(Math.abs(area(c.prism!.outline) - Math.PI * 17.5 * 17.5) / (Math.PI * 17.5 * 17.5)).toBeLessThan(0.003);
    // 사각(TI 8): 윗면 Z 19에서 아래로 8, 지름 없음
    const r = ops[1]!;
    expect(r.prism!.dir).toEqual([0, 0, -1]);
    expect(r.prism!.outline.slice(0, 3)).toEqual([200, 100, 19]);
    expect(r3(area(r.prism!.outline))).toBe(1500);
    expect(r.diameter).toBeUndefined();
    // 긴 구멍: 직선과 호가 섞인 윤곽, 넓이 = 원(R10) + 20 × 10
    const s = ops[2]!;
    expect(Math.abs(area(s.prism!.outline) - (Math.PI * 100 + 200))).toBeLessThan(1);
    expect(s.diameter).toBeUndefined();
  });

  it('장면: 묶음 "포켓"의 기둥, 범위에 깊이, 쓴 윤곽은 "윤곽(가공 없음)"으로 그리지 않음', () => {
    const s = mprToScene(part);
    const m = s.meshes.filter((x) => x.group === '포켓');
    expect(m.map((x) => x.name)).toEqual(['free form pocket', 'free form pocket', 'free form pocket']);
    expect(s.lines.some((x) => x.id === 'mpr-contours')).toBe(false);
    const meta = s.meta as { operations: { kind: string; depth?: number; diameter?: number }[] };
    expect(meta.operations.map((o) => [o.kind, o.depth, o.diameter])).toEqual([
      ['pocket', 13, 35],
      ['pocket', 8, undefined],
      ['pocket', 2, undefined],
    ]);
    // 아랫면 포켓 기둥은 Z 0 ~ 13
    const pos = s.meshes.find((x) => x.id === 'mpr-op-0')!.positions;
    const z = Array.from(pos).filter((_, i) => i % 3 === 2);
    expect([Math.min(...z), Math.max(...z)]).toEqual([0, 13]);
  });

  it('판 두께보다 깊으면 두께까지, 깊이·윤곽이 없거나 닫히지 않으면 알림', () => {
    const deep = parseMpr(`${head}${board}${rect}${pocket('3:0', '-25')}!\n`);
    const d = deep.operations.find((o): o is MprBoxOp => o.kind === 'pocket')!;
    expect(d.depth).toBe(25);
    expect(d.prism!.depth).toBe(19);
    const open = `]5\n$E0\nKP\nX=10\nY=10\nZ=0\n$E1\nKL\nX=60\nY=10\nZ=0\n$E2\nKL\nX=60\nY=40\nZ=0\n`;
    const p = parseMpr(`${head}${board}${rect}${open}<181 \\FreiFormTasche\\\nTI="-5"\n${pocket('9:0', '-5')}${pocket('3:0', '0')}${pocket('5:0', '-5')}!\n`);
    expect(p.warnings.some((w) => w.includes('FreiFormTasche에 시작 요소(EA)가 없음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('FreiFormTasche: 윤곽 9이 없음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('FreiFormTasche에 깊이(TI)가 없음 — 목록에만 넣음'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('FreiFormTasche: 윤곽 5이 닫히지 않음 — 끝을 이어 포켓으로 그림'))).toBe(true);
    const drawn = p.operations.filter((o): o is MprBoxOp => o.kind === 'pocket' && !!o.prism);
    expect(drawn.map((o) => o.contour)).toEqual([5]);
    // 그리지 못한 포켓의 윤곽(3)은 "윤곽(가공 없음)"으로 남는다
    const s = mprToScene(p);
    expect(Array.from(new Set(s.lines.find((x) => x.id === 'mpr-contours')!.segmentIds!))).toEqual([3]);
  });
});
