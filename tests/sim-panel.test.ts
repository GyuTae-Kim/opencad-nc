/**
 * 판재 가공(MPR·PGI·XML) 깎기 시뮬레이션: 재료 고르기(윗면만 — 옆면·아랫면·엣지 밴딩·모르는 매크로는 목록으로), 구멍·홈·포켓·자유 형상 포켓의
 * 깊이·폭(해석적 값), 윤곽 공구 보정(WRKL·WRKR), 직사각형이 아닌 판의 밖, 해석 결과(장면)는 그대로.
 * 격자는 1 mm 간격(판 600 × 400 → 600 × 400칸)이라 마디가 정수 좌표에 놓인다.
 */
import { describe, expect, it } from 'vitest';
import { parseForView } from '../src/app/payload';
import { parsePgi } from '../src/index';
import { parseMpr } from '../src/mpr';
import { mprToScene } from '../src/scene';
import { SimEngine } from '../src/sim/engine';
import { HeightGrid, MARK_OUTSIDE, gridFor } from '../src/sim/grid';
import { offsetPath, panelSimMoves, panelStock, type PanelSimSource } from '../src/sim/panel';
import { panelSimSource } from '../src/sim/panel-source';
import { panelBlocker, panelToolRows, type SimBox } from '../src/sim/setup';
import { prepareTool, type SimToolTable } from '../src/sim/tool';

const HEAD = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n_BSX=600\n_BSY=400\n_BSZ=19\n\n`;
const CONTOURS = [
  // 1: 직선 하나(윤곽 보정 시험) — (400, 50) → (550, 50)
  `]1\n$E0\nKP\nX=400\nY=50\nZ=19\n\n$E1\nKL\nX=550\nY=50\n\n`,
  // 2: 닫힌 사각형(자유 형상 포켓 윗면) 50..150 × 250..350
  `]2\n$E0\nKP\nX=50\nY=250\nZ=19\n\n$E1\nKL\nX=150\nY=250\n\n$E2\nKL\nX=150\nY=350\n\n$E3\nKL\nX=50\nY=350\n\n$E4\nKL\nX=50\nY=250\n\n`,
  // 3: 닫힌 사각형(아랫면 자유 형상 포켓)
  `]3\n$E0\nKP\nX=450\nY=250\nZ=0\n\n$E1\nKL\nX=520\nY=250\n\n$E2\nKL\nX=520\nY=320\n\n$E3\nKL\nX=450\nY=320\n\n$E4\nKL\nX=450\nY=250\n\n`,
  // 4: 직선 하나(보정 없는 윤곽) — (400, 120) → (550, 120)
  `]4\n$E0\nKP\nX=400\nY=120\nZ=19\n\n$E1\nKL\nX=550\nY=120\n\n`,
].join('');
const MACROS = [
  `<100 \\WerkStck\\\nLA="600"\nBR="400"\nDI="19"\n`,
  `<101 \\Kommentar\\\nKM="합성 판"\n`,
  // 구멍 Ø8 깊이 12, 관통 구멍 Ø10
  `<102 \\BohrVert\\\nXA="100"\nYA="100"\nTI="12"\nDU="8"\n`,
  `<102 \\BohrVert\\\nXA="200"\nYA="100"\nTI="25"\nDU="10"\n`,
  // 홈 폭 4 깊이 8(y = 198 … 202)
  `<109 \\Nuten\\\nXA="0"\nYA="198"\nXE="600"\nYE="198"\nNB="4"\nTI="8"\nRK="WRKL"\n`,
  // 포켓 100 × 50 깊이 10(가운데 300, 300)
  `<112 \\Tasche\\\nXA="300"\nYA="300"\nLA="100"\nBR="50"\nTI="10"\n`,
  // 자유 형상 포켓: 윗면 깊이 6, 아랫면(TI < 0)
  `<181 \\FreiFormTasche\\\nEA="2:0"\nTI="6"\n`,
  `<181 \\FreiFormTasche\\\nEA="3:0"\nTI="-5"\n`,
  // 윤곽: 왼쪽 보정(T101 — 지름 모름 → 기본 Ø6), 보정 없음(T102)
  `<105 \\Konturfraesen\\\nEA="1:0"\nEE="1:1"\nRK="WRKL"\nTNO="101"\nZA="5"\n`,
  `<105 \\Konturfraesen\\\nEA="4:0"\nEE="4:1"\nRK="NOWRK"\nTNO="102"\nZA="3"\n`,
  // 옆면 구멍, 아랫면 구멍(UfluBohr), 엣지 밴딩, 모르는 매크로, 꺼진 구멍
  `<103 \\BohrHoriz\\\nXA="0"\nYA="100"\nZA="9.5"\nDU="8"\nTI="30"\nBM="XP"\n`,
  `<131 \\UfluBohr\\\nXA="500"\nYA="300"\nTI="10"\nDU="15"\n`,
  `<188 \\Easyedge\\\nEA="2:0"\nEE="2:4"\nDK="2"\n`,
  `<139 \\Komponente\\\nXA="10"\nYA="10"\n`,
  `<102 \\BohrVert\\\nXA="580"\nYA="380"\nTI="5"\nDU="5"\n??="0"\n`,
].join('\n');
const MPR = `${HEAD}${CONTOURS}${MACROS}!\n`;

/** 재료 → 끝까지 깎은 높이 지도(1 mm 격자) */
function simulate(src: PanelSimSource, user: SimToolTable = {}, stock?: SimBox) {
  const rows = panelToolRows(src, user);
  const radius = (t: number): number => (rows[t]?.tool.diameter ?? 6) / 2;
  const box = stock ?? panelStock(src, radius)!;
  const moves = panelSimMoves(src, radius, box);
  const spec = gridFor(box, Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]));
  const grid = new HeightGrid(spec);
  const tools = rows.map((r) => prepareTool(r.tool));
  const engine = new SimEngine(moves, grid, (n) => tools[n]!);
  engine.advance({ move: moves.count, frac: 0 });
  const idx = (x: number, y: number): number => Math.round((y - spec.y0) / spec.dy) * spec.nx + Math.round((x - spec.x0) / spec.dx);
  return { spec, grid, moves, rows, engine, at: (x: number, y: number): number => grid.h[idx(x, y)]!, mark: (x: number, y: number): number => grid.mark[idx(x, y)]! };
}

describe('판재 시뮬레이션 재료', () => {
  const part = parseMpr(MPR);
  const src = panelSimSource(part);

  it('윗면 가공만 재료로, 옆면·아랫면·엣지 밴딩·모르는 매크로는 까닭과 함께, 꺼진 가공은 수만', () => {
    expect(src.board).toEqual({ length: 600, width: 400, thickness: 19 });
    expect(src.items.map((i) => i.type)).toEqual(['drill', 'drill', 'region', 'region', 'region', 'path', 'path']);
    expect(src.skipped.map((s) => s.code)).toEqual(['bottom', 'side', 'bottom', 'edge', 'unsupported']);
    expect(src.skipped.map((s) => part.operations[s.op]!.macro)).toEqual(['FreiFormTasche', 'BohrHoriz', 'UfluBohr', 'Easyedge', 'Komponente']);
    expect(src.disabled).toBe(1);
    // 공구: 구멍은 지름별, 윤곽은 공구 번호별(지름 모름)
    expect(src.tools).toEqual([
      { key: 'D8', type: 'drill', diameter: 8 },
      { key: 'D10', type: 'drill', diameter: 10 },
      { key: 'T101', type: 'router', tno: 101 },
      { key: 'T102', type: 'router', tno: 102 },
    ]);
    const rows = panelToolRows(src, { 'panel:T101': { diameter: 12 } });
    expect(rows.map((r) => [r.key, r.tool.diameter, r.diameterFrom])).toEqual([
      ['panel:D8', 8, 'file'],
      ['panel:D10', 10, 'file'],
      ['panel:T101', 12, 'user'],
      ['panel:T102', 6, 'default'],
    ]);
    expect(panelBlocker(src)).toBeNull();
    expect(panelBlocker(null)?.code).toBe('panel');
  });

  it('윗면 가공이 없으면 panel-none(시뮬레이션할 것이 없음)', () => {
    const side = panelSimSource(parseMpr(`${HEAD}<100 \\WerkStck\\\nLA="600"\nBR="400"\nDI="19"\n\n<103 \\BohrHoriz\\\nXA="0"\nYA="100"\nZA="9.5"\nDU="8"\nTI="30"\nBM="XP"\n!\n`));
    expect(side.items).toEqual([]);
    expect(side.skipped.map((s) => s.code)).toEqual(['side']);
    expect(panelBlocker(side)?.code).toBe('panel-none');
  });

  it('화면 자료에 실리고 해석 결과(장면)는 그대로', () => {
    const res = parseForView('board.mpr', new TextEncoder().encode(MPR));
    expect(res.mpr!.sim!.items.length).toBe(7);
    const scene = mprToScene(parseMpr(MPR));
    expect(res.scene.meshes.map((m) => [m.id, m.positions.length])).toEqual(scene.meshes.map((m) => [m.id, m.positions.length]));
    expect(res.scene.lines.map((l) => [l.id, l.positions.length])).toEqual(scene.lines.map((l) => [l.id, l.positions.length]));
  });
});

describe('판재 깎기 — 깊이·폭', () => {
  const r = simulate(panelSimSource(parseMpr(MPR)));

  it('소재 = 판 크기, 격자 1 mm', () => {
    expect([r.spec.x0, r.spec.y0, r.spec.top, r.spec.bottom]).toEqual([0, 0, 19, 0]);
    expect([r.spec.dx, r.spec.dy, r.spec.nx, r.spec.ny]).toEqual([1, 1, 601, 401]);
  });

  it('수직 구멍: 지름 8 안은 19 − 12 = 7, 밖은 그대로. 관통 구멍은 판 바닥(0)까지', () => {
    expect(r.at(100, 100)).toBe(7);
    expect(r.at(104, 100)).toBe(7);
    expect(r.at(100, 96)).toBe(7);
    expect(r.at(103, 103)).toBe(19); // 거리 4.24 > 4
    expect(r.at(105, 100)).toBe(19);
    expect(r.at(200, 100)).toBe(0);
    expect(r.at(205, 100)).toBe(0);
    expect(r.at(206, 100)).toBe(19);
  });

  it('홈: 깊이 19 − 8 = 11, 단면의 깎인 마디가 y 198 … 202(폭 4, 경계 위 마디 포함)', () => {
    for (const x of [0, 1, 300, 600]) {
      const cut: number[] = [];
      for (let y = 190; y <= 210; y++) if (r.at(x, y) < 19) cut.push(y);
      expect(cut.every((y) => r.at(x, y) === 11)).toBe(true);
      expect(cut).toEqual([198, 199, 200, 201, 202]);
    }
  });

  it('포켓 100 × 50: 깊이 19 − 10 = 9, 모서리까지(모양 그대로)', () => {
    expect(r.at(300, 300)).toBe(9);
    expect(r.at(251, 276)).toBe(9);
    expect(r.at(349, 324)).toBe(9);
    expect(r.at(248, 300)).toBe(19);
    expect(r.at(300, 327)).toBe(19);
  });

  it('자유 형상 포켓(윗면): 깊이 6 → 13. 아랫면 포켓·아랫면 구멍·옆면 구멍은 깎지 않는다', () => {
    expect(r.at(100, 300)).toBe(13);
    expect(r.at(51, 251)).toBe(13);
    expect(r.at(48, 300)).toBe(19);
    // 아랫면 자유 형상 포켓(450..520 × 250..320), UfluBohr(500, 300), BohrHoriz(0 → 30, y 100)
    expect(r.at(480, 280)).toBe(19);
    expect(r.at(500, 300)).toBe(19);
    expect(r.at(10, 100)).toBe(19);
  });

  it('윤곽 왼쪽 보정(WRKL): 공구 중심이 왼쪽(+Y)으로 반지름 3 — 깎인 띠는 윤곽 y 50부터 56까지, 윤곽 아래쪽은 그대로', () => {
    for (const x of [430, 475, 520]) {
      expect(r.at(x, 49)).toBe(19);
      expect(r.at(x, 50)).toBe(14);
      expect(r.at(x, 53)).toBe(14);
      expect(r.at(x, 56)).toBe(14);
      expect(r.at(x, 57)).toBe(19);
    }
  });

  it('보정 없는 윤곽: 윤곽 위가 공구 중심 — 띠 y 117 … 123, 깊이 19 − 3 = 16', () => {
    expect(r.at(475, 116)).toBe(19);
    expect(r.at(475, 117)).toBe(16);
    expect(r.at(475, 120)).toBe(16);
    expect(r.at(475, 123)).toBe(16);
    expect(r.at(475, 124)).toBe(19);
  });

  it('사용자 표로 공구 지름을 바꾸면 보정 거리도 바뀐다(T101 Ø12 → 띠 50 … 62)', () => {
    const big = simulate(panelSimSource(parseMpr(MPR)), { 'panel:T101': { diameter: 12 } });
    expect(big.at(475, 49)).toBe(19);
    expect(big.at(475, 62)).toBe(14);
    expect(big.at(475, 63)).toBe(19);
  });

  it('급속은 안전 높이에서만 — 급속 사건이 없다', () => {
    expect(r.engine.events).toEqual([]);
    expect(r.moves.op.every((o) => o >= -1)).toBe(true);
  });
});

describe('PGI: 직사각형이 아닌 판·톱 홈·옆면', () => {
  // 오른쪽 앞 100 × 100을 따낸 판 600 × 400 × 18
  const PGI = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="600" width="400" thickness="18" name="n" frontID="F1">
  <outlines>
   <outline x="0" y="400" bulge="0"/>
   <outline x="600" y="400" bulge="0"/>
   <outline x="600" y="100" bulge="0"/>
   <outline x="500" y="100" bulge="0"/>
   <outline x="500" y="0" bulge="0"/>
   <outline x="0" y="0" bulge="0"/>
   <outline x="0" y="400" bulge="0"/>
  </outlines>
  <hole x="32" y="300" z="0" diameter="5" depth="13" direction="z-" no="3" xi="32" yi="0" zi="0" enable="1"/>
  <hole x="600" y="200" z="9" diameter="8" depth="30" direction="x-" enable="1"/>
  <line startX="20" startY="380" startZ="0" endX="480" endY="380" endZ="0" width="4" depth="7" direction="z-" isSaw="1" enable="1"/>
  <line startX="20" startY="20" startZ="0" endX="200" endY="20" endZ="0" width="8" depth="5" direction="z-" isSaw="0" enable="1"/>
  <pocket length="50" width="30" depth="4" direction="z+" cornerRadius="0" angle="0" centerX="300" centerY="200" centerZ="0" enable="1"/>
 </panel>
</pgi>`;
  const src = panelSimSource(parsePgi(PGI));

  it('윗면 구멍 줄·톱 홈·직선 경로는 재료로, 옆면 구멍·아랫면 포켓은 목록으로', () => {
    expect(src.items.map((i) => i.type)).toEqual(['drill', 'region', 'path']);
    expect(src.skipped.map((s) => s.code)).toEqual(['side', 'bottom']);
    expect(src.tools.map((t) => [t.key, t.diameter])).toEqual([
      ['D5', 5],
      ['R8', 8],
    ]);
    expect(src.outline!.length).toBeGreaterThanOrEqual(12);
  });

  it('판 밖(따낸 모서리)은 바닥까지 내리고 표시 2, 판 안은 그대로', () => {
    const r = simulate(src);
    expect(r.at(550, 50)).toBe(0);
    expect(r.mark(550, 50)).toBe(MARK_OUTSIDE);
    expect(r.at(450, 50)).toBe(18);
    expect(r.mark(450, 50)).toBe(0);
    // 구멍 줄(32, 64, 96 · y 300) 깊이 13 → 5
    expect([32, 64, 96].map((x) => r.at(x, 300))).toEqual([5, 5, 5]);
    // 톱 홈 폭 4 깊이 7(y 378 … 382) → 11
    expect(r.at(250, 380)).toBe(11);
    expect(r.at(250, 376)).toBe(18);
    // 직선 경로 Ø8 깊이 5(y 16 … 24) → 13
    expect(r.at(100, 20)).toBe(13);
    expect(r.at(100, 24)).toBe(13);
    expect(r.at(100, 25)).toBe(18);
    // 아랫면 포켓·옆면 구멍은 윗면에서 깎지 않음
    expect(r.at(300, 200)).toBe(18);
    expect(r.at(590, 200)).toBe(18);
  });
});

describe('공구 보정 경로(offsetPath)', () => {
  it('사각형 바깥을 왼쪽 보정으로 돌면 바깥 모서리는 반지름 r 호, 변은 r만큼 떨어진다', () => {
    // 시계 방향으로 돌면 왼쪽 = 바깥
    const sq = [
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 10, z: -1 },
      { x: 10, y: 10, z: -1 },
      { x: 10, y: 0, z: -1 },
      { x: 0, y: 0, z: -1 },
    ];
    const p = offsetPath(sq, 'left', 2)!;
    expect(p).not.toBeNull();
    // 들어가기: 첫 변(위로)의 왼쪽(−X)으로 2r 떨어진 점에서
    expect([p[0]!.x, p[0]!.y]).toEqual([-4, 0]);
    // 변 위 점은 사각형에서 2 떨어진다, 호는 꼭짓점 중심 반지름 2
    const arcs = p.filter((q) => q.arc);
    expect(arcs.length).toBe(3);
    for (const q of arcs) expect(Math.hypot(q.x - q.arc!.cx, q.y - q.arc!.cy)).toBeCloseTo(2, 9);
    expect(p.some((q) => Math.abs(q.x - -2) < 1e-9 && Math.abs(q.y - 10) < 1e-9)).toBe(true);
    expect(p.some((q) => Math.abs(q.x - 10) < 1e-9 && Math.abs(q.y - 12) < 1e-9)).toBe(true);
    expect(p.every((q) => q.z === -1)).toBe(true);
    // 오른쪽 보정(안쪽): 안쪽 모서리는 교점까지 — 호가 없다
    const inner = offsetPath(sq, 'right', 2)!;
    expect(inner.filter((q) => q.arc).length).toBe(0);
    expect(inner.some((q) => Math.abs(q.x - 2) < 1e-9 && Math.abs(q.y - 8) < 1e-9)).toBe(true);
  });

  it('원호 요소는 반지름을 바꾼다(반시계 원호의 왼쪽 = 안쪽)', () => {
    const p = offsetPath(
      [
        { x: 10, y: 0, z: 0 },
        { x: -10, y: 0, z: 0, arc: { cx: 0, cy: 0, sweep: Math.PI } },
      ],
      'left',
      3,
    )!;
    const a = p.find((q) => q.arc)!;
    expect(Math.hypot(a.x - a.arc!.cx, a.y - a.arc!.cy)).toBeCloseTo(7, 9);
  });

  it('반지름 0이거나 점이 모자라면 null', () => {
    expect(offsetPath([{ x: 0, y: 0, z: 0 }], 'left', 1)).toBeNull();
    expect(
      offsetPath(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        'left',
        0,
      ),
    ).toBeNull();
  });
});

describe('판을 모르는 MPR', () => {
  it('가공 범위 + 공구 반지름 + 여유로 소재를 정하고 윗면은 Z0', () => {
    // 머리에 계산된 판 크기(_BSX·_BSY·_BSZ)도 WerkStck도 없는 파일
    const src = panelSimSource(parseMpr(`[H\nVERSION="4.0 Alpha"\nINCH="0"\n\n<102 \\BohrVert\\\nXA="100"\nYA="50"\nTI="10"\nDU="8"\n\n<102 \\BohrVert\\\nXA="300"\nYA="150"\nTI="10"\nDU="8"\n!\n`));
    expect(src.board).toBeNull();
    const box = panelStock(src, () => 4)!;
    expect(box.max[2]).toBe(0);
    expect(box.min[2]).toBeLessThan(-10);
    expect(box.min[0]).toBeLessThan(96);
    expect(box.max[0]).toBeGreaterThan(304);
  });
});
