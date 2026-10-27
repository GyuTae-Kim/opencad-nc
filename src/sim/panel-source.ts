/**
 * 판재 가공 모델(MprPart — MPR·PGI·XML 공용) → 깎기 시뮬레이션 재료(PanelSimSource). 해석 워커가 부른다(해석기를 가져오므로 화면 코드에서
 * 부르지 않는다). 해석 결과(장면·가공 목록)는 바꾸지 않고, 해석기가 이미 만든 구멍·상자·기둥·경로만 읽는다.
 *
 * 윗면에서 위→아래로 하는 가공만 고른다: 수직 구멍(BohrVert, PGI·XML 윗면 구멍), 홈(Nuten, 톱 홈 상자), 포켓(Tasche, 사각·원형·경로 포켓),
 * 자유 형상 포켓(TI > 0), 윤곽·경로. 들어가는 면이 없는 MPR은 모양으로 정한다(구멍 방향 +Z = 아랫면 UfluBohr, 기둥 방향 +Z = 아랫면 포켓).
 * 그 밖(옆면·아랫면, 엣지 밴딩, 모르는 매크로, 모양 값이 모자란 가공)은 까닭과 함께 skipped로, 꺼진 가공은 수만 센다. 주석은 뺀다.
 */
import { pathPolyline, type MprBoxOp, type MprOperation, type MprPart } from '../mpr';
import type { PanelSimItem, PanelSimSkip, PanelSimSource, PanelSimTool } from './panel';

const EPS = 1e-6;

/** 가공이 들어가는 쪽 */
function opSide(op: MprOperation): 'top' | 'bottom' | 'side' {
  if (op.face) return op.face === 'top' ? 'top' : op.face === 'bottom' ? 'bottom' : 'side';
  if (op.kind === 'drillH') return 'side';
  if (op.kind === 'drillV') return op.holes.some((h) => h.dir[2] > 0) ? 'bottom' : 'top';
  if ((op.kind === 'pocket' || op.kind === 'groove') && op.prism) {
    const d = op.prism.dir[2];
    return d < -0.999 ? 'top' : d > 0.999 ? 'bottom' : 'side';
  }
  return 'top';
}

/** 홈·포켓의 바닥 영역(위에서 본 고리와 바닥 높이). 윗면에서 수직으로 내려간 상자·기둥이 아니면 null */
function regionOf(op: MprBoxOp): { rings: number[][]; z: number } | null {
  if (op.prism) {
    const pr = op.prism;
    if (!(pr.dir[2] < -0.999) || !(pr.depth > 0) || pr.outline.length < 9) return null;
    const ring: number[] = [];
    let top = -Infinity;
    for (let k = 0; k + 2 < pr.outline.length; k += 3) {
      ring.push(pr.outline[k]!, pr.outline[k + 1]!);
      top = Math.max(top, pr.outline[k + 2]!);
    }
    return { rings: [ring], z: top - pr.depth };
  }
  if (op.box) {
    const { origin: o, u, v, w } = op.box;
    if (Math.abs(u[2]!) > EPS || Math.abs(v[2]!) > EPS || Math.hypot(w[0]!, w[1]!) > EPS || !(Math.abs(w[2]!) > EPS)) return null;
    const ring = [o[0]!, o[1]!, o[0]! + u[0]!, o[1]! + u[1]!, o[0]! + u[0]! + v[0]!, o[1]! + u[1]! + v[1]!, o[0]! + v[0]!, o[1]! + v[1]!];
    if (Math.abs(u[0]! * v[1]! - u[1]! * v[0]!) <= EPS) return null;
    return { rings: [ring], z: Math.min(o[2]!, o[2]! + w[2]!) };
  }
  return null;
}

/** 열쇠에 쓰는 수(소수 셋째 자리까지) */
const keyNum = (v: number): string => String(Math.round(v * 1000) / 1000);

export function panelSimSource(part: MprPart): PanelSimSource {
  const wp = part.workpiece;
  const board = wp && wp.length > 0 && wp.width > 0 && wp.thickness > 0 ? { length: wp.length, width: wp.width, thickness: wp.thickness } : null;
  let outline: number[] | null = null;
  if (board && wp!.outline && wp!.outline.length > 2) outline = pathPolyline(wp!.outline).flatMap(([x, y]) => [x, y]);
  const tools: PanelSimTool[] = [];
  const byKey = new Map<string, number>();
  const toolOf = (t: PanelSimTool): number => {
    const k = byKey.get(t.key);
    if (k !== undefined) {
      if (tools[k]!.diameter === undefined && t.diameter !== undefined) tools[k]!.diameter = t.diameter;
      return k;
    }
    byKey.set(t.key, tools.length);
    tools.push(t);
    return tools.length - 1;
  };
  const items: PanelSimItem[] = [];
  const skipped: PanelSimSkip[] = [];
  let disabled = 0;
  part.operations.forEach((op, i) => {
    if (op.kind === 'comment') return;
    if (!op.enabled) {
      disabled++;
      return;
    }
    const skip = (code: PanelSimSkip['code']): void => void skipped.push({ op: i, code, label: op.label, line: op.line });
    if (op.kind === 'edge') return skip('edge');
    if (op.kind === 'other') return skip('unsupported');
    const side = opSide(op);
    if (side !== 'top') return skip(side);
    switch (op.kind) {
      case 'drillV': {
        const holes: number[] = [];
        for (const h of op.holes) if (h.depth > 0) holes.push(h.start[0], h.start[1], h.start[2], h.start[2] - h.depth);
        if (!(op.diameter > 0) || !holes.length) return skip('no-shape');
        items.push({ op: i, type: 'drill', tool: toolOf({ key: `D${keyNum(op.diameter)}`, type: 'drill', diameter: op.diameter }), holes });
        return;
      }
      case 'groove':
      case 'pocket': {
        const reg = regionOf(op);
        if (!reg) return skip('no-shape');
        items.push({ op: i, type: 'region', ...reg });
        return;
      }
      case 'contour': {
        const path = op.path;
        if (!path || path.length < 2) return skip('no-shape');
        const d = op.diameter !== undefined && op.diameter > 0 ? op.diameter : undefined;
        const key = op.tool !== undefined ? `T${op.tool}` : d !== undefined ? `R${keyNum(d)}` : 'R';
        const tool = toolOf({ key, type: 'router', ...(op.tool !== undefined ? { tno: op.tool } : {}), ...(d !== undefined ? { diameter: d } : {}) });
        items.push({ op: i, type: 'path', tool, comp: op.comp, path: path.map((p) => ({ x: p.x, y: p.y, z: p.z, ...(p.arc ? { arc: { ...p.arc } } : {}) })) });
        return;
      }
      default:
        return skip('side');
    }
  });
  return { units: part.units, board, outline, items, tools, skipped, disabled };
}
