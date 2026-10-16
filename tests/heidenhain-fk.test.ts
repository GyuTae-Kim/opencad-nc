import { describe, expect, it } from 'vitest';
import { parseHeidenhain } from '../src/heidenhain';
import { MOVE_ARC, moveEnd, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const pgm = (body: string): string => `0 BEGIN PGM T MM\n${body}\n99 END PGM T MM\n`;

describe('Heidenhain FK 자유 윤곽', () => {
  it('FL 끝점·방향+길이·방향+좌표, FCT 접원, FC 중심+끝점, FPOL 극좌표, 좌표 하나로 원과 만나는 점', () => {
    const p = parseHeidenhain(
      pgm(`1 TOOL DEF 1 L+0 R+5
2 TOOL CALL 1 Z S2000
3 L X+0 Y+0 Z-5 R0 F200
4 FL X+30 Y+0
5 FL AN+90 LEN 20
6 FL AN+180 X+10
7 FCT DR+ R10 X+0 Y+10
8 FC DR- CCX+0 CCY+0 X+10 Y+0
9 FPOL X+0 Y+0
10 FL PR+20 PA+45
11 FC DR+ CCX+0 CCY+0 X-14.1421356`),
    );
    expect(ends(p)).toEqual([
      [30, 0, -5],
      [30, 20, -5],
      [10, 20, -5],
      [0, 10, -5],
      [10, 0, -5],
      [14.142, 14.142, -5],
      [-14.142, 14.142, -5],
    ]);
    // FCT: 앞 요소(-X 방향)에 접하고 DR+ → 중심 (10, 10), 반시계 90도
    expect(p.moves.kind[3]).toBe(MOVE_ARC);
    const a = p.moves.arc[3]!;
    expect([r3(p.arcs.center[a * 3]!), r3(p.arcs.center[a * 3 + 1]!), r3(p.arcs.sweep[a]!)]).toEqual([10, 10, r3(Math.PI / 2)]);
    const b = p.moves.arc[4]!;
    expect(r3(p.arcs.sweep[b]!)).toBe(r3(-Math.PI / 2));
    // 좌표 하나: 반시계로 먼저 닿는 (−14.14, +14.14) — 45도에서 135도까지
    expect(r3(p.arcs.sweep[p.moves.arc[6]!]!)).toBe(r3(Math.PI / 2));
    expect(p.warnings).toEqual([]);
  });

  it('자료가 모자란 FK는 경고하고 그리지 않음, 상대 자료도 경고', () => {
    const p = parseHeidenhain(
      pgm(`1 L X+0 Y+0 Z+0 R0 F100
2 FL IX+5
3 FC DR+ R10 Y+5
4 FL X+10 Y+0 PDX+1
5 FSELECT 2`),
    );
    expect(ends(p)).toEqual([[10, 0, 0]]);
    expect(p.warnings.some((w) => w.includes('FL: 끝점을 정할 자료가 모자람'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('FC: 원호 중심'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('상대 자료'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('FSELECT'))).toBe(true);
  });
});

/** 사이클 정의 + 호출(가운데 (50, 40), 윗면 0) */
const cyc = (n: number, qs: string, r = 5): NcProgram =>
  parseHeidenhain(
    pgm(`1 TOOL DEF 1 L+0 R+${r}
2 TOOL CALL 1 Z S3000 F500
3 L Z+50 R0 FMAX
4 L X+50 Y+40 R0 FMAX
5 CYCL DEF ${n} TEST ~
  ${qs.trim().split(/\s+/).join(' ~\n  ')}
6 CYCL CALL
7 L Z+100 FMAX`),
  );

describe('Heidenhain 밀링 사이클', () => {
  it('252 원 포켓: 공구 지름 × 겹침 간격의 동심원, 깊이 단계마다', () => {
    const p = cyc(252, 'Q215=0 Q223=50 Q368=0 Q207=500 Q351=+1 Q201=-6 Q202=3 Q369=0 Q206=150 Q200=2 Q203=+0 Q204=50 Q370=1');
    expect(p.arcs.count).toBe(4);
    for (let i = 0; i < p.arcs.count; i++) expect(r3(p.arcs.sweep[i]!)).toBe(r3(Math.PI * 2));
    expect(r3(p.feedBounds!.max[0])).toBe(70);
    expect(r3(p.feedBounds!.min[2])).toBe(-6);
    expect(r3(moveEnd(p.moves, p.moves.count - 1)[2])).toBe(100);
    expect(p.warnings).toEqual([]);
  });

  it('251 사각 포켓: 안쪽 고리에서 바깥으로, 마지막 고리는 둥근 모서리(Q220 − 공구 반지름)', () => {
    const p = cyc(251, 'Q215=0 Q218=60 Q219=40 Q220=10 Q368=0 Q224=0 Q367=0 Q207=500 Q351=+1 Q201=-5 Q202=5 Q369=0 Q206=150 Q338=0 Q200=2 Q203=+0 Q204=50 Q370=1');
    const fb = p.feedBounds!;
    expect([r3(fb.min[0]), r3(fb.max[0]), r3(fb.min[1]), r3(fb.max[1])]).toEqual([25, 75, 25, 55]);
    expect(p.arcs.count).toBe(4);
    // 위치 Q367=1(왼쪽 아래 모서리), 회전 Q224=90
    const q = cyc(251, 'Q218=60 Q219=40 Q220=0 Q224=90 Q367=1 Q201=-5 Q202=5 Q203=+0 Q200=2 Q204=50');
    const qb = q.feedBounds!;
    // 중심 = (50, 40) + R90·(30, 20) = (30, 70), 회전 뒤 반너비 (15, 25)
    expect([r3(qb.min[0]), r3(qb.max[0]), r3(qb.min[1]), r3(qb.max[1])]).toEqual([15, 45, 45, 95]);
  });

  it('208 보어 밀링: 나선(피치 Q334)으로 내려가 바닥 한 바퀴', () => {
    const p = cyc(208, 'Q200=2 Q201=-6 Q206=150 Q334=2 Q203=+0 Q204=50 Q335=20 Q351=+1');
    expect(p.arcs.count).toBe(2);
    expect(r3(p.arcs.sweep[0]!)).toBe(r3(Math.PI * 8));
    expect(r3(p.feedBounds!.max[0])).toBe(55);
    expect(r3(p.feedBounds!.min[2])).toBe(-6);
  });

  it('253 홈·256 사각 보스·257 원 보스·232 정면 밀링', () => {
    const slot = cyc(253, 'Q218=50 Q219=12 Q368=0 Q374=0 Q367=0 Q201=-3 Q202=3 Q203=+0 Q200=2 Q204=50');
    expect(slot.arcs.count).toBe(2);
    expect(r3(slot.feedBounds!.max[0])).toBe(70);
    const stud = cyc(257, 'Q223=40 Q222=50 Q368=0 Q207=500 Q351=+1 Q201=-4 Q202=4 Q206=150 Q200=2 Q203=+0 Q204=50 Q370=1');
    // 블랭크 반지름 25 + 5 = 30, 완성 20 + 5 = 25 → 고리 2개(시계, 바깥 깎기)
    expect(stud.arcs.count).toBe(2);
    expect(stud.arcs.sweep[0]!).toBeLessThan(0);
    const rs = cyc(256, 'Q218=40 Q424=50 Q219=30 Q425=40 Q220=0 Q368=0 Q224=0 Q367=0 Q201=-4 Q202=4 Q203=+0 Q200=2 Q204=50');
    expect(rs.moves.count).toBeGreaterThan(10);
    const face = parseHeidenhain(
      pgm(`1 TOOL DEF 1 L+0 R+5
2 TOOL CALL 1 Z S3000 F500
3 L Z+50 R0 FMAX
4 CYCL DEF 232 FACE ~
  Q389=0 ~
  Q225=+0 ~
  Q226=+0 ~
  Q227=+0 ~
  Q386=-1 ~
  Q218=100 ~
  Q219=30 ~
  Q202=1 ~
  Q370=1 ~
  Q200=2 ~
  Q204=50
5 CYCL CALL`),
    );
    const ys = new Set<number>();
    for (let i = 0; i < face.moves.count; i++) if (r3(moveEnd(face.moves, i)[2]) === -1) ys.add(r3(moveEnd(face.moves, i)[1]));
    expect([...ys].sort((a, b) => a - b)).toEqual([0, 10, 20, 30]);
  });

  it('공구 반지름을 모르면 경고(반지름 0으로 그림)', () => {
    const p = parseHeidenhain(
      pgm(`1 TOOL CALL 7 Z S3000
2 L X+0 Y+0 Z+10 R0 FMAX
3 CYCL DEF 252 ~
  Q223=20 ~
  Q201=-2 ~
  Q203=+0
4 CYCL CALL`),
    );
    expect(p.warnings.some((w) => w.includes('공구 반지름을 몰라'))).toBe(true);
    expect(p.arcs.count).toBeGreaterThan(0);
  });
});

describe('Heidenhain LBL', () => {
  it('따옴표 표지 이름(빈칸), 앞쪽 표지 + LBL 0은 부프로그램 호출, REP 없는 앞쪽 표지는 경고', () => {
    const p = parseHeidenhain(
      pgm(`1 L X+0 Y+0 Z+0 R0 F100
2 LBL "MY SUB"
3 L IX+10
4 LBL 0
5 CALL LBL "MY SUB"
6 LBL 5
7 L IY+1
8 CALL LBL 5
9 CALL LBL 5 REP 2/2`),
    );
    // 2~4줄 한 번(그냥 지나감) + 부프로그램 호출 한 번, 6~8은 한 번, 9줄 REP 2 → 6~9 구간을 두 번 더
    expect(ends(p).map((e) => [e[0], e[1]])).toEqual([
      [10, 0],
      [20, 0],
      [20, 1],
      [20, 2],
      [20, 3],
    ]);
    expect(p.warnings.some((w) => w.includes('REP 없는 앞쪽 표지'))).toBe(true);
  });
});
