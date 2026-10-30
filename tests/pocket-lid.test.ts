/**
 * 29차: 판재 포켓·홈 그물의 뚜껑(들어가는 판 면 자리의 끝면) 삼각형 구간 — 장면 meta.lids(scene.ts mprToScene, MeshAccum.caps).
 * 앱이 판 너머 고르기에서 뚜껑만 지나가게 준다(app.ts applyDoc — 코어 0.27.0 setItemPickThrough). 그물(정점·번호·윤곽선)은 그대로다.
 * MPR 상자(Tasche·Nuten — 원점이 바닥이라 +w 면)·기둥(Tasche RD·FreiFormTasche, 아랫면에서 판 것 포함), PGI 기둥(포켓 — 윗면·아랫면)·
 * 상자(톱 홈 — 원점이 면 위라 원점 쪽 면)에서 뚜껑은 들어가는 면 위에 있고 바깥(판 밖)을 향한다. 판을 꿰뚫은 홈도 들어가는 면만 뚜껑이다.
 */
import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import { parseMpr } from '../src/mpr';
import { mprToScene } from '../src/scene';
import { MeshAccum } from '../src/mesh';
import { parsePgi } from '../src/index';

type Lids = Record<string, { start: number; count: number }>;
const lids = (s: Scene3d): Lids => ((s.meta as { lids?: Lids }).lids ?? {});

/** 그물 id의 뚜껑 삼각형 꼭짓점 좌표(축 k)의 값 모음과 정점 법선(축 k)의 값 모음, 나머지 삼각형 가운데 뚜껑 평면 위에만 있는 것의 수 */
function lidOn(s: Scene3d, id: string, k: number): { at: number[]; normal: number[]; others: number } {
  const r = lids(s)[id]!;
  const m = s.meshes.find((x) => x.id === id)!;
  const at = new Set<number>();
  const normal = new Set<number>();
  for (let t = r.start; t < r.start + r.count; t++)
    for (let j = 0; j < 3; j++) {
      const v = m.indices![t * 3 + j]!;
      at.add(Math.round(m.positions[v * 3 + k]! * 1e4) / 1e4 + 0);
      normal.add(Math.round((m.normals as Float32Array)[v * 3 + k]! * 1e4) / 1e4 + 0);
    }
  const plane = [...at][0]!;
  let others = 0;
  for (let t = 0; t < m.indices!.length / 3; t++) {
    if (t >= r.start && t < r.start + r.count) continue;
    if ([0, 1, 2].every((j) => Math.abs(m.positions[m.indices![t * 3 + j]! * 3 + k]! - plane) < 1e-4)) others++;
  }
  return { at: [...at], normal: [...normal], others };
}

describe('MeshAccum.caps', () => {
  it('상자는 원점 쪽(−w)·+w 면 두 삼각형씩, 기둥은 다각형 쪽·민 쪽 뚜껑(귀 자르기 삼각형 수) — 앞에 쌓인 삼각형 뒤 번호', () => {
    const a = new MeshAccum();
    a.box([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    expect(a.caps).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 2 },
    ]);
    a.prism([0, 0, 5, 10, 0, 5, 10, 10, 5, 5, 15, 5, 0, 10, 5], [0, 0, -1], 2);
    // 앞 상자 12개 뒤, 오각형 뚜껑 세 삼각형씩
    expect(a.caps).toEqual([
      { start: 12, count: 3 },
      { start: 15, count: 3 },
    ]);
    expect(a.triangleCount).toBe(12 + 3 * 2 + 5 * 2);
  });
});

describe('판재 포켓·홈 뚜껑(meta.lids)', () => {
  it('MPR: 사각 포켓(상자)·둥근 포켓(기둥)·홈(상자, 판을 꿰뚫음)은 윗면 높이 19, 아랫면에서 판 자유 형상 포켓은 높이 0 — 구멍·판·윤곽은 없다', () => {
    const head = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n_BSX=400\n_BSY=300\n_BSZ=19\n`;
    const board = `<100 \\WerkStck\\\nLA="400"\nBR="300"\nDI="19"\n`;
    const rect = `]3\n$E0\nKP\nX=200\nY=100\nZ=0\n$E1\nKL\nX=250\nY=100\nZ=0\n$E2\nKL\nX=250\nY=130\nZ=0\n$E3\nKL\nX=200\nY=130\nZ=0\n$E4\nKL\nX=200\nY=100\nZ=0\n`;
    const text = [
      `${head}${board}${rect}`,
      `<102 \\BohrVert\\\nXA="50"\nYA="50"\nTI="10"\nDU="8"\n`,
      `<112 \\Tasche\\\nXA="300"\nYA="200"\nLA="100"\nBR="50"\nTI="10"\nWI="0"\n`,
      `<112 \\Tasche\\\nXA="100"\nYA="200"\nLA="80"\nBR="60"\nTI="6"\nWI="30"\nRD="10"\n`,
      `<109 \\Nuten\\\nXA="0"\nYA="20"\nXE="400"\nYE="20"\nNB="4"\nTI="25"\n`,
      `<181 \\FreiFormTasche\\\nEA="3:0"\nAD="0"\nAZ="0"\nZU="0"\nTI="-5"\nZT="0"\nXY="50"\nT_="0"\nF_="5"\nDS="1"\n`,
      '!\n',
    ].join('\n');
    const s = mprToScene(parseMpr(text));
    expect(Object.keys(lids(s)).sort()).toEqual(['mpr-op-1', 'mpr-op-2', 'mpr-op-3', 'mpr-op-4']);
    for (const id of ['mpr-op-1', 'mpr-op-2', 'mpr-op-3']) expect(lidOn(s, id, 2)).toEqual({ at: [19], normal: [1], others: 0 });
    // 판을 꿰뚫은 홈(깊이 19)도 뚜껑은 들어가는 윗면만(아랫면 높이 0은 바닥)
    expect(s.meshes.find((m) => m.id === 'mpr-op-3')!.positions.some((x, i) => i % 3 === 2 && x === 0)).toBe(true);
    expect(lidOn(s, 'mpr-op-4', 2)).toEqual({ at: [0], normal: [-1], others: 0 });
  });

  it('PGI: 윗면·아랫면 포켓(기둥)과 톱 홈(상자)은 들어가는 면 위, 바깥을 향한다', () => {
    const pgi = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <pocket length="80" width="60" depth="6" direction="z-" cornerRadius="10" angle="0" centerX="100" centerY="100" centerZ="0" enable="1" order="1"/>
  <line startX="250" startY="200" startZ="0" endX="350" endY="200" endZ="0" width="8" depth="5" direction="z-" isSaw="1" enable="1" order="2"/>
  <line startX="20" startY="280" startZ="0" endX="380" endY="280" endZ="0" width="4" depth="7" direction="z+" isSaw="1" enable="1" order="3"/>
  <pocket length="50" width="30" depth="4" direction="z+" cornerRadius="0" angle="0" centerX="300" centerY="80" centerZ="0" enable="1" order="4"/>
  <hole x="150" y="22" z="0" diameter="10" depth="12" direction="z-" enable="1" order="5"/>
 </panel>
</pgi>`;
    const s = mprToScene(parsePgi(pgi));
    expect(Object.keys(lids(s)).sort()).toEqual(['mpr-op-0', 'mpr-op-1', 'mpr-op-2', 'mpr-op-3']);
    for (const id of ['mpr-op-0', 'mpr-op-1']) expect(lidOn(s, id, 2)).toEqual({ at: [18], normal: [1], others: 0 });
    for (const id of ['mpr-op-2', 'mpr-op-3']) expect(lidOn(s, id, 2)).toEqual({ at: [0], normal: [-1], others: 0 });
  });
});
