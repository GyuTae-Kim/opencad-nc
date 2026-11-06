/**
 * Heidenhain SL 사이클(48차): HEIDENHAIN TNC 640 가공 사이클 프로그래밍 설명서(34059x-17, 10/2022) 9장의 규칙 —
 * 9.1절 266쪽 포켓·섬 판정(RR·RL과 돌아가는 방향), 9.2절 사이클 14, 9.3절 270~272쪽 겹친 윤곽(합·차·교집합), 9.4절 Q1~Q9,
 * 9.5~9.8절 사이클 21~24, 9.13절 307~310쪽 예제 꼴 — 과 7.3절 232쪽 사이클 8(SL 사이클은 대칭해도 가공 방향이 그대로).
 * 기대 값은 설명서 수치에서 손으로 셈한 것(공구 중심 = 윤곽에서 공구 반지름 + 여유만큼 안쪽). 모두 직접 만든 작은 합성 프로그램
 */
import { describe, expect, it } from 'vitest';
import { parseHeidenhain } from '../src/heidenhain';
import { MOVE_ARC, MOVE_DRILL, MOVE_FEED, MOVE_RAPID, moveEnd, moveStart, type NcProgram } from '../src/model';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const pgm = (body: string): string => `0 BEGIN PGM SL MM\n${body}\n999 END PGM SL MM\n`;
const lineOf = (src: string, text: string): number => src.split('\n').findIndex((l) => l.includes(text));
/** 그 줄에서 나온 이동 */
const movesAt = (p: NcProgram, line: number): number[] => [...Array(p.moves.count).keys()].filter((i) => p.moves.line[i] === line);
/** 절삭(이송·호) 이동의 끝점 */
const cutEnds = (p: NcProgram, ids: number[]): number[][] => ids.filter((i) => p.moves.kind[i] === MOVE_FEED || p.moves.kind[i] === MOVE_ARC).map((i) => moveEnd(p.moves, i));
/** 깊이 z에서 평면 안을 도는 절삭의 부호 있는 넓이(반시계 +, 원호는 활꼴까지) — 고리들의 돌아가는 방향 */
const turn = (p: NcProgram, ids: number[], z: number): number => {
  let a = 0;
  for (const i of ids) {
    if (p.moves.kind[i] === MOVE_RAPID || p.moves.kind[i] === MOVE_DRILL) continue;
    const s = moveStart(p.moves, i);
    const e = moveEnd(p.moves, i);
    if (Math.abs(s[2] - z) > 1e-9 || Math.abs(e[2] - z) > 1e-9) continue;
    a += (s[0] * e[1] - e[0] * s[1]) / 2;
    if (p.moves.kind[i] === MOVE_ARC) {
      const k = p.moves.arc[i]!;
      const sw = p.arcs.sweep[k]!;
      const rr = Math.hypot(e[0] - p.arcs.center[k * 3]!, e[1] - p.arcs.center[k * 3 + 1]!);
      a += ((rr * rr) / 2) * (sw - Math.sin(sw));
    }
  }
  return a;
};
/** 절삭(이송·호)이 지나는 점: 직선은 끝점, 원호는 64조각으로 나눈 점(작업 평면 XY) */
const cutPath = (p: NcProgram, ids: number[]): number[][] => {
  const out: number[][] = [];
  for (const i of ids) {
    if (p.moves.kind[i] === MOVE_FEED) out.push(moveEnd(p.moves, i));
    else if (p.moves.kind[i] === MOVE_ARC) {
      const s = moveStart(p.moves, i);
      const e = moveEnd(p.moves, i);
      const k = p.moves.arc[i]!;
      const cx = p.arcs.center[k * 3]!;
      const cy = p.arcs.center[k * 3 + 1]!;
      const a0 = Math.atan2(s[1] - cy, s[0] - cx);
      const rr = Math.hypot(s[0] - cx, s[1] - cy);
      for (let j = 1; j <= 64; j++) {
        const a = a0 + (p.arcs.sweep[k]! * j) / 64;
        out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a), s[2] + ((e[2] - s[2]) * j) / 64]);
      }
    }
  }
  return out;
};
const box = (pts: number[][]): number[] => [0, 1].flatMap((a) => [r3(Math.min(...pts.map((q) => q[a]!))), r3(Math.max(...pts.map((q) => q[a]!)))]);
/** 점에서 축과 나란한 사각형(테두리)까지 거리 */
const rectDist = (q: number[], x0: number, x1: number, y0: number, y1: number): number => {
  const dx = Math.max(x0 - q[0]!, 0, q[0]! - x1);
  const dy = Math.max(y0 - q[1]!, 0, q[1]! - y1);
  return dx || dy ? Math.hypot(dx, dy) : Math.min(q[0]! - x0, x1 - q[0]!, q[1]! - y0, y1 - q[1]!);
};

/** 사이클 20 블록 */
const data = (q: Record<string, number>): string =>
  `CYCL DEF 20 CONTOUR DATA ~\n` +
  Object.entries({ Q1: -5, Q2: 1, Q3: 0, Q4: 0, Q5: 0, Q6: 2, Q7: 50, Q8: 0, Q9: 1, ...q })
    .map(([k, v]) => `  ${k}=${v >= 0 ? '+' : ''}${v}`)
    .join(' ~\n');
const rough = (q: Record<string, number> = {}): string =>
  `CYCL DEF 22 ROUGH-OUT ~\n` +
  Object.entries({ Q10: -5, Q11: 150, Q12: 500, Q18: 0, Q19: 0, Q208: 99999, Q401: 100, Q404: 0, ...q })
    .map(([k, v]) => `  ${k}=${v >= 0 ? '+' : ''}${v}`)
    .join(' ~\n');

// 설명서 9.13절 307~308쪽 예제 꼴: 한 포켓(모서리 RND), 공구 반지름 15, Q8 = 0.2
const EX1 = pgm(`1 BLK FORM 0.1 Z X+0 Y+0 Z-20
2 BLK FORM 0.2 X+100 Y+100 Z+0
3 TOOL DEF 15 L+0 R+15
4 TOOL CALL 15 Z S4500
5 L Z+100 R0 FMAX M3
6 CYCL DEF 14.0 CONTOUR
7 CYCL DEF 14.1 CONTOUR LABEL 1
8 ${data({ Q8: 0.2 })}
9 ${rough({ Q11: 150, Q12: 500 })}
10 CYCL CALL
11 L Z+200 R0 FMAX
12 M30
13 LBL 1
14 L X+5 Y+50 RR
15 L Y+90
16 RND R19
17 L X+60
18 RND R8
19 L X+90 Y+80
20 RND R10
21 L Y+40
22 RND R20
23 L X+60 Y+10
24 RND R8
25 L X+5
26 RND R10
27 L X+5 Y+50
28 LBL 0`);

// 설명서 9.13절 309~310쪽 예제 꼴: 겹친 두 원 포켓 + 사각·세모 섬, 21·22·23·24
const EX2 = pgm(`1 BLK FORM 0.1 Z X+0 Y+0 Z-40
2 BLK FORM 0.2 X+100 Y+100 Z+0
3 TOOL DEF 6 L+0 R+6
4 TOOL CALL 6 Z S2500
5 L Z+250 R0 FMAX M3
6 CYCL DEF 14.0 CONTOUR
7 CYCL DEF 14.1 CONTOUR LABEL1 /2 /3 /4
8 ${data({ Q1: -20, Q3: 0.5, Q4: 0.5, Q7: 100, Q8: 0.1, Q9: -1 })}
9 CYCL DEF 21 PILOT DRILLING ~
  Q10=-5 ;PLUNGING DEPTH ~
  Q11=+150 ;FEED RATE FOR PLNGNG ~
  Q13=+0 ;ROUGH-OUT TOOL
10 CYCL CALL
11 ${rough({ Q11: 100, Q12: 350 })}
12 CYCL CALL
13 CYCL DEF 23 FLOOR FINISHING ~
  Q11=+100 ~
  Q12=+200 ~
  Q208=+99999
14 CYCL CALL
15 CYCL DEF 24 SIDE FINISHING ~
  Q9=+1 ~
  Q10=-5 ~
  Q11=+100 ~
  Q12=+400 ~
  Q14=+0 ~
  Q438=-1
16 CYCL CALL
17 L Z+100 R0 FMAX
18 M30
19 LBL 1
20 CC X+35 Y+50
21 L X+10 Y+50 RR
22 C X+10 DR-
23 LBL 0
24 LBL 2
25 CC X+65 Y+50
26 L X+90 Y+50 RR
27 C X+90 DR-
28 LBL 0
29 LBL 3
30 L X+27 Y+50 RL
31 L Y+58
32 L X+43
33 L Y+42
34 L X+27
35 LBL 0
36 LBL 4
37 L X+65 Y+42 RL
38 L X+57
39 L X+65 Y+58
40 L X+73 Y+42
41 LBL 0`);

/** 두 원(중심 35·65, 반지름 25)의 합 바깥 경계까지 거리(설명서 예제 꼴) */
const unionDist = (q: number[]): number => {
  let d = Infinity;
  for (const [cx, keep] of [
    [35, (x: number): boolean => x <= 50],
    [65, (x: number): boolean => x >= 50],
  ] as const) {
    const a = Math.atan2(q[1]! - 50, q[0]! - cx);
    const px = cx + 25 * Math.cos(a);
    d = Math.min(d, keep(px) ? Math.abs(25 - Math.hypot(q[0]! - cx, q[1]! - 50)) : Infinity);
  }
  return Math.min(d, Math.hypot(q[0]! - 50, q[1]! - 30), Math.hypot(q[0]! - 50, q[1]! - 70));
};
/** 세모 섬 (65,42)·(57,42)·(65,58)·(73,42)까지 거리(바깥 점) */
const triDist = (q: number[]): number => {
  const P = [
    [57, 42],
    [65, 58],
    [73, 42],
  ];
  let d = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = P[k]!;
    const b = P[(k + 1) % 3]!;
    const t = Math.max(0, Math.min(1, ((q[0]! - a[0]!) * (b[0]! - a[0]!) + (q[1]! - a[1]!) * (b[1]! - a[1]!)) / ((b[0]! - a[0]!) ** 2 + (b[1]! - a[1]!) ** 2)));
    d = Math.min(d, Math.hypot(q[0]! - a[0]! - t * (b[0]! - a[0]!), q[1]! - a[1]! - t * (b[1]! - a[1]!)));
  }
  return d;
};

describe('Heidenhain SL 사이클 22 거친 깎기 — 설명서 예제 꼴', () => {
  it('한 포켓(9.13절 307쪽): 공구 반지름 15만큼 안쪽 고리들, 깊이 Q1 = -5 한 층, Q11로 들어가 Q12로 깎고 끝나면 Q7로', () => {
    const p = parseHeidenhain(EX1);
    expect(p.warnings).toEqual([]);
    const call = movesAt(p, lineOf(EX1, '10 CYCL CALL'));
    const cut = cutEnds(p, call);
    // 윤곽 X 5~90·Y 10~90에서 15 안쪽 — 가장 바깥 고리가 X 20~75·Y 25~75
    expect(box(cut)).toEqual([20, 75, 25, 75]);
    expect(new Set(cut.map((q) => r3(q[2]!)))).toEqual(new Set([-5]));
    // 첫 이동: 들어가는 자리 위 안전 거리(Z+2)로 급속, Q11(150)로 Z-5까지
    const [a, b] = call;
    expect(p.moves.kind[a!]).toBe(MOVE_RAPID);
    expect(r3(moveEnd(p.moves, a!)[2])).toBe(2);
    expect(p.moves.kind[b!]).toBe(MOVE_FEED);
    expect(r3(moveEnd(p.moves, b!)[2])).toBe(-5);
    expect(p.moves.feed[b!]).toBe(150);
    expect(call.filter((i) => p.moves.kind[i] !== MOVE_RAPID).slice(1).every((i) => p.moves.feed[i] === 500)).toBe(true);
    // 끝: 공구 축만 Q7(Z+50)로
    const last = call[call.length - 1]!;
    expect(p.moves.kind[last]).toBe(MOVE_RAPID);
    expect(moveStart(p.moves, last).slice(0, 2)).toEqual(moveEnd(p.moves, last).slice(0, 2));
    expect(r3(moveEnd(p.moves, last)[2])).toBe(50);
    // Q8 = 0.2: 가장 바깥 고리의 날카로운 안쪽 모서리(RND R8 — 반지름 8 < 15라 공구 중심 경로에서는 모서리)를 반지름 0.2 호로
    const radii = call.filter((i) => p.moves.kind[i] === MOVE_ARC).map((i) => r3(Math.hypot(moveEnd(p.moves, i)[0] - p.arcs.center[p.moves.arc[i]! * 3]!, moveEnd(p.moves, i)[1] - p.arcs.center[p.moves.arc[i]! * 3 + 1]!)));
    expect(radii).toContain(0.2);
    // RND R19 모서리는 공구 중심에서 반지름 19 - 15 = 4 호(중심 X24 Y71)
    expect(radii).toContain(4);
    // Q9 = +1: 반시계(하향)
    expect(turn(p, call, -5)).toBeGreaterThan(0);
  });

  it('겹친 두 원 포켓과 섬 둘(9.13절 309쪽): 깊이 Q10씩 바닥 여유 Q4를 남긴 -19.5까지, 공구 중심은 늘 벽·섬에서 6.5(반지름 + Q3) 이상', () => {
    const p = parseHeidenhain(EX2);
    expect(p.warnings).toEqual([]);
    const call = movesAt(p, lineOf(EX2, '12 CYCL CALL'));
    const cut = cutPath(p, call);
    expect([...new Set(cut.map((q) => r3(q[2]!)))].sort((x, y) => y - x)).toEqual([-5, -10, -15, -19.5]);
    for (const q of cut) {
      expect(unionDist(q)).toBeGreaterThanOrEqual(6.5 - 1e-6);
      expect(rectDist(q, 27, 43, 42, 58)).toBeGreaterThanOrEqual(6.5 - 1e-6);
      expect(triDist(q)).toBeGreaterThanOrEqual(6.5 - 1e-6);
    }
    // 섬 둘레를 한 바퀴 도는 고리가 있다(사각 섬 X 27~43에서 6.5 바깥 — X 20.5와 49.5)
    expect(cut.some((q) => r3(q[0]!) === 20.5)).toBe(true);
    expect(cut.some((q) => r3(q[0]!) === 49.5)).toBe(true);
    // Q9 = -1: 시계(상향) — 포켓 벽 고리가 시계라 바닥 층 넓이가 음
    expect(turn(p, call, -19.5)).toBeLessThan(0);
  });
});

describe('Heidenhain SL 사이클 21·23·24', () => {
  const p = parseHeidenhain(EX2);
  it('21 예비 드릴: 22가 들어가는 자리마다 Q10씩 쪼아 Q1 + Q4(-19.5)까지, 다시 들어갈 때 앞 깊이 + 0.6(깊이 30 mm 이하)', () => {
    const call = movesAt(p, lineOf(EX2, '10 CYCL CALL'));
    expect(p.holes.count).toBeGreaterThan(0);
    for (let i = 0; i < p.holes.count; i++) {
      expect(r3(p.holes.top[i * 3 + 2]!)).toBe(2);
      expect(r3(p.holes.bottom[i * 3 + 2]!)).toBe(-19.5);
    }
    const drills = call.filter((i) => p.moves.kind[i] === MOVE_DRILL).map((i) => r3(moveEnd(p.moves, i)[2]));
    expect(drills.slice(0, 4)).toEqual([-5, -10, -15, -19.5]);
    // 쪼기 사이 급속: 안전 거리(Z+2)로 올라 앞 깊이 - 0.6 위(Z-4.4)까지
    const rapids = call.filter((i) => p.moves.kind[i] === MOVE_RAPID).map((i) => r3(moveEnd(p.moves, i)[2]));
    expect(rapids).toContain(-4.4);
    expect(rapids).toContain(-9.4);
    // 들어가는 자리는 22의 첫 들어감과 같다(설명서 276쪽 — 드릴 자리가 거친 깎기 시작점)
    const r22 = movesAt(p, lineOf(EX2, '12 CYCL CALL'));
    const firstPlunge = r22.find((i) => p.moves.kind[i] === MOVE_FEED)!;
    expect(moveEnd(p.moves, firstPlunge).slice(0, 2).map(r3)).toEqual([r3(p.holes.top[0]!), r3(p.holes.top[1]!)]);
  });
  it('23 바닥 다듬질: Q7로 급속 → Q11로 바닥(Q1 = -20)까지 → Q12로 22와 같은 고리 한 층', () => {
    const call = movesAt(p, lineOf(EX2, '14 CYCL CALL'));
    const cut = cutEnds(p, call);
    expect(new Set(cut.map((q) => r3(q[2]!)))).toEqual(new Set([-20]));
    const plunge = call.find((i) => p.moves.kind[i] === MOVE_FEED)!;
    expect(r3(moveStart(p.moves, plunge)[2])).toBe(100);
    expect(p.moves.feed[plunge]).toBe(100);
    expect(call.filter((i) => p.moves.kind[i] === MOVE_ARC).every((i) => p.moves.feed[i] === 200)).toBe(true);
  });
  it('24 옆면 다듬질: 경계에서 공구 반지름 + Q14(6) 고리마다 따로, 층마다 접선 나선 호(높이 Q6/25 = 0.08)로 들어가고 나옴', () => {
    const call = movesAt(p, lineOf(EX2, '16 CYCL CALL'));
    const cut = cutEnds(p, call);
    expect([...new Set(cut.map((q) => r3(q[2]!)))].sort((x, y) => y - x)).toEqual([-4.92, -5, -9.92, -10, -14.92, -15, -19.92, -20]);
    // 사각 섬 X 27~43·Y 42~58에서 6 바깥: X 21·49, Y 36·64인 고리
    const at20 = cut.filter((q) => r3(q[2]!) === -20);
    for (const v of [21, 49]) expect(at20.some((q) => r3(q[0]!) === v)).toBe(true);
    for (const v of [36, 64]) expect(at20.some((q) => r3(q[1]!) === v)).toBe(true);
    for (const q of cutPath(p, call).filter((q) => r3(q[2]!) === -20)) {
      expect(unionDist(q)).toBeGreaterThanOrEqual(6 - 1e-6);
      expect(rectDist(q, 27, 43, 42, 58)).toBeGreaterThanOrEqual(6 - 1e-6);
      expect(triDist(q)).toBeGreaterThanOrEqual(6 - 1e-6);
    }
    // 들어가는 나선 호: Z-4.92 → Z-5, 나오는 호: Z-5 → Z-4.92
    const helix = call.filter((i) => p.moves.kind[i] === MOVE_ARC && r3(moveStart(p.moves, i)[2]) !== r3(moveEnd(p.moves, i)[2]));
    expect(helix.length).toBeGreaterThan(0);
    expect(helix.every((i) => Math.abs(moveStart(p.moves, i)[2] - moveEnd(p.moves, i)[2]) < 0.0801)).toBe(true);
    // Q9 = +1(사이클 24): 포켓 벽은 반시계·섬은 시계 — 섬 둘레가 섞여도 포켓 벽 고리가 커서 넓이 양
    expect(turn(p, call, -20)).toBeGreaterThan(0);
  });
  it('24는 사이클 20의 옆 여유 Q3 = 0이면 그리지 않는다(설명서 287쪽 — 컨트롤러 오류)', () => {
    const src = EX2.replace('Q3=+0.5', 'Q3=+0');
    const q = parseHeidenhain(src);
    expect(movesAt(q, lineOf(src, '16 CYCL CALL'))).toEqual([]);
    expect(q.warnings.some((w) => w.includes('CYCL DEF 24: 사이클 20에 옆 여유(Q3)가 없어 그리지 않음'))).toBe(true);
  });
});

/** 사각 윤곽 하나(X 0~80, Y 0~60): 시계(위로 → 오른쪽 → 아래로 → 왼쪽)나 반시계, 보정 RL·RR·R0 */
const square = (cw: boolean, comp: string): string =>
  cw ? `L X+0 Y+0 ${comp}\nL Y+60\nL X+80\nL Y+0\nL X+0` : `L X+0 Y+0 ${comp}\nL X+80\nL Y+60\nL X+0\nL Y+0`;
const one = (contour: string, extra = '', d: Record<string, number> = {}): string =>
  pgm(`1 TOOL DEF 1 L+0 R+5
2 TOOL CALL 1 Z S3000
3 L X+0 Y+0 Z+50 R0 FMAX
${extra}4 CYCL DEF 14.0 CONTOUR
5 CYCL DEF 14.1 CONTOUR LABEL 7
6 ${data({ Q1: -4, Q7: 20, ...d })}
7 ${rough({ Q10: 0 })}
8 CYCL CALL
9 M30
10 LBL 7
${contour}
11 LBL 0`);

describe('포켓·섬 판정과 겹친 윤곽(설명서 9.1·9.3절)', () => {
  it('시계 + RR·반시계 + RL은 포켓(공구 경로가 윤곽 안), 시계 + RL·반시계 + RR은 섬', () => {
    for (const [cw, comp, pocket] of [
      [true, 'RR', true],
      [false, 'RL', true],
      [true, 'RL', false],
      [false, 'RR', false],
    ] as const) {
      const src = one(square(cw, comp));
      const p = parseHeidenhain(src);
      const cut = cutEnds(p, movesAt(p, lineOf(src, '8 CYCL CALL')));
      if (pocket) {
        expect(p.warnings, `${cw} ${comp}`).toEqual([]);
        expect(box(cut)).toEqual([5, 75, 5, 55]);
      } else {
        expect(cut).toEqual([]);
        expect(p.warnings).toHaveLength(1);
        expect(p.warnings[0]).toMatch(/CYCL DEF 22: 포켓 없이 섬만 있어 그리지 않음$/);
      }
    }
  });
  it('RL·RR이 없으면(R0) 포켓으로 보고 알린다', () => {
    const src = one(square(true, 'R0'));
    const p = parseHeidenhain(src);
    expect(box(cutEnds(p, movesAt(p, lineOf(src, '8 CYCL CALL'))))).toEqual([5, 75, 5, 55]);
    expect(p.warnings.some((w) => w.includes('CYCL DEF 14: 윤곽 LBL 7에 RL·RR이 없어 포켓으로 봄'))).toBe(true);
  });

  const two = (a: string, b: string): string =>
    pgm(`1 TOOL DEF 1 L+0 R+2
2 TOOL CALL 1 Z S3000
3 L X+0 Y+0 Z+50 R0 FMAX
4 CYCL DEF 14.0 CONTOUR
5 CYCL DEF 14.1 CONTOUR LABEL1 /2
6 ${data({ Q1: -3, Q7: 20 })}
7 ${rough({ Q10: 0 })}
8 CYCL CALL
9 M30
11 LBL 1
${a}
15 LBL 0
16 LBL 2
${b}
20 LBL 0`);
  const cut2 = (src: string): number[][] => {
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    return cutPath(p, movesAt(p, lineOf(src, '8 CYCL CALL')));
  };
  it('합(270~271쪽): 두 포켓 — 첫 포켓이 둘째 포켓 밖에서 시작', () => {
    const cut = cut2(two('12 L X+10 Y+50 RR\n13 CC X+35 Y+50\n14 C X+10 Y+50 DR-', '17 L X+90 Y+50 RR\n18 CC X+65 Y+50\n19 C X+90 Y+50 DR-'));
    // 호를 64조각으로 나눈 점이라 꼭대기는 0.01 안
    expect(box(cut).map((v) => Math.round(v * 10) / 10)).toEqual([12, 88, 27, 73]);
  });
  it('차(272쪽): 포켓 A − 섬 B — 공구 중심은 B에서 반지름만큼 밖', () => {
    const cut = cut2(two('12 L X+10 Y+50 RR\n13 CC X+35 Y+50\n14 C X+10 Y+50 DR-', '17 L X+40 Y+50 RL\n18 CC X+65 Y+50\n19 C X+40 Y+50 DR-'));
    expect(r3(Math.min(...cut.map((q) => q[0]!)))).toBe(12);
    for (const q of cut) {
      expect(Math.hypot(q[0]! - 65, q[1]! - 50)).toBeGreaterThanOrEqual(27 - 1e-6);
      expect(Math.hypot(q[0]! - 35, q[1]! - 50)).toBeLessThanOrEqual(23 + 1e-6);
    }
  });
  it('교집합(272쪽): 두 포켓 — 첫 포켓이 둘째 포켓 안에서 시작하면 겹친 곳만', () => {
    const cut = cut2(two('12 L X+60 Y+50 RR\n13 CC X+35 Y+50\n14 C X+60 Y+50 DR-', '17 L X+90 Y+50 RR\n18 CC X+65 Y+50\n19 C X+90 Y+50 DR-'));
    for (const q of cut) {
      expect(Math.hypot(q[0]! - 35, q[1]! - 50)).toBeLessThanOrEqual(23 + 1e-6);
      expect(Math.hypot(q[0]! - 65, q[1]! - 50)).toBeLessThanOrEqual(23 + 1e-6);
    }
    expect(box(cut).slice(0, 2)).toEqual([42, 58]);
  });
});

describe('사이클 8 대칭 아래 가공 방향(설명서 7.3절 232쪽 — SL 사이클은 한 축 대칭이어도 방향이 바뀌지 않음)', () => {
  const mir = (m: string): string => (m ? `3 CYCL DEF 8.0 MIRROR IMAGE\n3 CYCL DEF 8.1 ${m}\n` : '');
  it('SL 22: 한 축(X) 대칭이면 자리는 대칭되지만 돌아가는 방향(Q9 = +1 반시계)은 그대로', () => {
    for (const m of ['', 'X', 'Y', 'X Y']) {
      const src = one(square(true, 'RR'), mir(m));
      const p = parseHeidenhain(src);
      const call = movesAt(p, lineOf(src, '8 CYCL CALL'));
      const b = box(cutEnds(p, call));
      expect(b).toEqual([m.includes('X') ? -75 : 5, m.includes('X') ? -5 : 75, m.includes('Y') ? -55 : 5, m.includes('Y') ? -5 : 55]);
      expect(turn(p, call, -4), m).toBeGreaterThan(0);
    }
    const src = one(square(true, 'RR'), mir('X'), { Q9: -1 });
    const p = parseHeidenhain(src);
    expect(turn(p, movesAt(p, lineOf(src, '8 CYCL CALL')), -4)).toBeLessThan(0);
  });
});

describe('윤곽 부프로그램 읽기와 알림', () => {
  it('사이클 14·20이 없거나 표지가 없으면 그리지 않고 알린다', () => {
    const noData = one(square(true, 'RR')).replace(/6 CYCL DEF 20[^]*?Q9=\+1\n/, '');
    expect(parseHeidenhain(noData).warnings.some((w) => w.includes('CYCL DEF 22: 앞에 CYCL DEF 20(윤곽 자료)이 없어 그리지 않음'))).toBe(true);
    const noGeo = one(square(true, 'RR')).replace('4 CYCL DEF 14.0 CONTOUR\n5 CYCL DEF 14.1 CONTOUR LABEL 7\n', '');
    expect(parseHeidenhain(noGeo).warnings.some((w) => w.includes('CYCL DEF 22: 앞에 CYCL DEF 14(윤곽)가 없어 그리지 않음'))).toBe(true);
    const miss = one(square(true, 'RR')).replace('LABEL 7', 'LABEL 8');
    const p = parseHeidenhain(miss);
    expect(p.warnings.some((w) => w.includes('CYCL DEF 14: 윤곽 LBL 8이 없음'))).toBe(true);
    expect(movesAt(p, lineOf(miss, '8 CYCL CALL'))).toEqual([]);
  });
  it('공구가 윤곽보다 크면 그리지 않고, 윤곽 안의 공구 축 좌표·다른 블록은 쓰지 않고 알린다', () => {
    const big = one(square(true, 'RR')).replace('R+5', 'R+31');
    expect(parseHeidenhain(big).warnings.some((w) => w.includes('CYCL DEF 22: 공구가 윤곽보다 커서 그리지 않음'))).toBe(true);
    const src = one('L X+0 Y+0 Z-3 RR\nL Y+60 F200 M8\nTOOL CALL 2 Z\nL X+80\nL Y+0\nL X+0');
    const p = parseHeidenhain(src);
    expect(box(cutEnds(p, movesAt(p, lineOf(src, '8 CYCL CALL'))))).toEqual([5, 75, 5, 55]);
    expect(p.warnings.some((w) => w.includes("CYCL DEF 14: 윤곽 LBL 7의 'TOOL' 블록은 읽지 않음"))).toBe(true);
    expect(p.warnings.some((w) => w.includes('CYCL DEF 14: 윤곽 LBL 7의 공구 축 좌표는 쓰지 않음(윤곽은 작업 평면 안)'))).toBe(true);
  });
  it('닫히지 않은 윤곽은 직선으로 닫고(설명서 예제 310쪽 섬 꼴), 읽은 뒤 자리·보정·Q·이송은 사이클 전 그대로', () => {
    const src = pgm(`1 TOOL DEF 1 L+0 R+2
2 TOOL CALL 1 Z S3000 F777
3 L X+0 Y+0 Z+50 R0 FMAX
4 Q1 = 0
5 CYCL DEF 14.0 CONTOUR
6 CYCL DEF 14.1 CONTOUR LABEL 1
7 ${data({ Q1: -3, Q7: 20 })}
8 ${rough({ Q10: 0 })}
9 CYCL CALL
10 L IX+10 F100
11 M30
12 LBL 1
13 L X+0 Y+0 RR
14 Q55 = 9
15 L Y+20 F9999
16 L X+30
17 L Y+0
18 LBL 0`);
    const p = parseHeidenhain(src);
    expect(p.warnings).toEqual([]);
    const call = movesAt(p, lineOf(src, '9 CYCL CALL'));
    expect(box(cutEnds(p, call))).toEqual([2, 28, 2, 18]);
    const end = moveEnd(p.moves, call[call.length - 1]!);
    const after = movesAt(p, lineOf(src, '10 L IX+10'));
    expect(after).toHaveLength(1);
    expect(moveEnd(p.moves, after[0]!).map(r3)).toEqual([r3(end[0] + 10), r3(end[1]), 20]);
    expect(p.moves.flags[after[0]!]! & 3).toBe(0);
  });
  it('DIN/ISO: G37 P01 1 P02 2(사이클 14)·G120(20)·G122(22)·G79는 평문과 같은 길', () => {
    const plain = one(square(true, 'RR'));
    const iso = `%SLI G71 *
N10 G99 T1 L+0 R+5 *
N20 T1 G17 S3000 *
N30 G00 X+0 Y+0 Z+50 G40 *
N40 G37 P01 7 *
N50 G120 Q1=-4 Q2=1 Q3=0 Q4=0 Q5=0 Q6=2 Q7=20 Q8=0 Q9=1 *
N60 G122 Q10=0 Q11=150 Q12=500 Q18=0 Q19=0 Q208=99999 Q401=100 Q404=0 *
N70 G79 *
N80 M30 *
N90 G98 L7 *
N100 G01 G42 X+0 Y+0 *
N110 Y+60 *
N120 X+80 *
N130 Y+0 *
N140 X+0 *
N150 G98 L0 *
N99999999 %SLI G71 *
`;
    const a = parseHeidenhain(plain);
    const b = parseHeidenhain(iso);
    expect(b.warnings).toEqual([]);
    const ca = cutEnds(a, movesAt(a, lineOf(plain, '8 CYCL CALL'))).map((q) => q.map(r3));
    const cb = cutEnds(b, movesAt(b, lineOf(iso, 'N70 G79'))).map((q) => q.map(r3));
    expect(cb).toEqual(ca);
  });
});
