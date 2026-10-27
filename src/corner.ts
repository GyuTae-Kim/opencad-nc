/**
 * 모서리 다듬기 기하(순수 함수, 작업 평면 두 축): 직선·원호 두 요소가 만나는 모서리 P를 둥글리기(두 요소에 접하는 호)나
 * 모따기(두 요소 위 두 점을 잇는 직선)로 다듬는다. G-code·Heidenhain·Siemens의 RND·CHF·CHR(emitter.ts)과 woodWOP MPR 윤곽의
 * KR·KF(mpr.ts)가 함께 쓴다. 일반 평면 기하로 짰다(다른 NC 해석기 코드를 보지 않았다).
 *
 * - 둥글리기 중심 = 두 요소를 도는 쪽으로 반지름만큼 옮긴 선·원의 교점 가운데 모서리에 가까운 것, 접점 = 그 중심에서 각 요소로 내린 발
 * - 원호 위 모따기 점은 모서리에서 현 길이 d인 점. chamferHyp(모따기 선 길이가 값)면 두 점 사이가 값이 되게 d를 맞춘다
 * - 원호의 중심은 그대로 두고 앞 원호는 끝을, 뒤 원호는 시작을 접점으로 옮긴다(angA·angB — 시작에서 접점까지 돈 각)
 */

/**
 * 모서리 다듬기 꼴: round = 둥글리기(값 = 반지름), chamferLeg = 모따기(값 = 모서리에서 각 요소를 따라 자르는 길이 —
 * Heidenhain CHF·Siemens CHR·MPR KF), chamferHyp = 모따기(값 = 모따기 선 자체의 길이 — Siemens CHF)
 */
export type CornerKind = 'round' | 'chamferLeg' | 'chamferHyp';

/** 모서리 다듬기의 요소 하나(작업 평면 두 축): 직선(시작 f → 끝 t, 방향 u) 또는 원호(중심 c, 반지름 r, 방향 dir 1 = 반시계, 중심각 sweep) */
export interface CornerElem {
  arc: boolean;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  len: number;
  ux: number;
  uy: number;
  cx: number;
  cy: number;
  r: number;
  dir: 1 | -1;
  sweep: number;
}

/** 요소 만들기(길이·반지름·중심각이 0이면 null) */
export function cornerElem(fx: number, fy: number, tx: number, ty: number, arc: { cx: number; cy: number; sweep: number } | null): CornerElem | null {
  if (!arc) {
    const l = Math.hypot(tx - fx, ty - fy);
    return l < 1e-9 ? null : { arc: false, fx, fy, tx, ty, len: l, ux: (tx - fx) / l, uy: (ty - fy) / l, cx: 0, cy: 0, r: 0, dir: 1, sweep: 0 };
  }
  const { cx, cy, sweep } = arc;
  const r = Math.hypot(fx - cx, fy - cy);
  return r < 1e-9 || Math.abs(sweep) < 1e-12 ? null : { arc: true, fx, fy, tx, ty, len: r * Math.abs(sweep), ux: 0, uy: 0, cx, cy, r, dir: sweep > 0 ? 1 : -1, sweep };
}

/** 두 요소(직선은 무한 직선, 원호는 온 원)의 교점 */
export function cornerIntersections(a: CornerElem, b: CornerElem): [number, number][] {
  if (!a.arc && !b.arc) {
    const den = a.ux * b.uy - a.uy * b.ux;
    if (Math.abs(den) < 1e-12) return [];
    const t = ((b.fx - a.fx) * b.uy - (b.fy - a.fy) * b.ux) / den;
    return [[a.fx + a.ux * t, a.fy + a.uy * t]];
  }
  if (a.arc && b.arc) {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-12) return [];
    const k = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
    let h2 = a.r * a.r - k * k;
    if (h2 < 0) {
      if (h2 < -1e-9 * Math.max(1, a.r * a.r)) return [];
      h2 = 0;
    }
    const h = Math.sqrt(h2);
    const mx = a.cx + (dx * k) / d;
    const my = a.cy + (dy * k) / d;
    return [
      [mx - (dy * h) / d, my + (dx * h) / d],
      [mx + (dy * h) / d, my - (dx * h) / d],
    ];
  }
  const ln = a.arc ? b : a;
  const ci = a.arc ? a : b;
  // ln.f + ln.u·t 가 원 위: t² + 2t(u·w) + |w|² - r² = 0 (w = f - c)
  const wx = ln.fx - ci.cx;
  const wy = ln.fy - ci.cy;
  const bq = ln.ux * wx + ln.uy * wy;
  let disc = bq * bq - (wx * wx + wy * wy - ci.r * ci.r);
  if (disc < 0) {
    if (disc < -1e-9 * Math.max(1, ci.r * ci.r)) return [];
    disc = 0;
  }
  const sq = Math.sqrt(disc);
  return [-bq - sq, -bq + sq].map((t) => [ln.fx + ln.ux * t, ln.fy + ln.uy * t] as [number, number]);
}

/**
 * 모서리 다듬기 결과: t1 = 앞 요소의 새 끝(접점), t2 = 뒤 요소의 새 시작, fillet = 둥글리기 호(중심·중심각 — 없으면 t1 → t2 직선),
 * angA·angB = 원호 요소의 시작에서 t1·t2까지 진행 방향으로 돈 각(직선이면 0).
 * 다듬지 못하면 reason: straight(곧게 이어짐 — 다듬을 것 없음), reverse(되돌아감), too-big(값이 앞뒤 요소보다 큼)
 */
export type CornerCut =
  | { ok: true; t1: [number, number]; t2: [number, number]; fillet: { cx: number; cy: number; sweep: number } | null; angA: number; angB: number }
  | { ok: false; reason: 'straight' | 'reverse' | 'too-big' };

const TAU = Math.PI * 2;

/** 모서리 P(px, py)에서 앞 요소 A(→ P)와 뒤 요소 B(P →) 사이를 kind·size로 다듬는 기하 */
export function cornerCut(A: CornerElem, B: CornerElem, px: number, py: number, kind: CornerKind, size: number): CornerCut {
  /** 모서리 P에서의 진행 방향 */
  const tangent = (e: CornerElem): [number, number] => {
    if (!e.arc) return [e.ux, e.uy];
    const l = Math.hypot(px - e.cx, py - e.cy);
    return [(-(py - e.cy) / l) * e.dir, ((px - e.cx) / l) * e.dir];
  };
  const tA = tangent(A);
  const tB = tangent(B);
  const cr = tA[0] * tB[1] - tA[1] * tB[0];
  const th = Math.atan2(Math.abs(cr), tA[0] * tB[0] + tA[1] * tB[1]);
  if (th < 1e-6) return { ok: false, reason: 'straight' };
  if (Math.PI - th < 1e-6) return { ok: false, reason: 'reverse' };
  /** 원호 e의 시작에서 점(qx, qy)까지 진행 방향으로 돈 각(0 ~ 2π) */
  const along = (e: CornerElem, qx: number, qy: number): number => {
    let a = (Math.atan2(qy - e.cy, qx - e.cx) - Math.atan2(e.fy - e.cy, e.fx - e.cx)) * e.dir;
    while (a < -1e-12) a += TAU;
    while (a >= TAU - 1e-12) a -= TAU;
    return Math.max(0, a);
  };
  /** 점이 요소 위(시작 ~ 끝 사이)인지와, 원호면 시작에서 그 점까지의 각 */
  const onElem = (e: CornerElem, qx: number, qy: number): { ok: boolean; ang: number } => {
    const eps = 1e-9 * Math.max(1, e.len);
    if (!e.arc) {
      const t = (qx - e.fx) * e.ux + (qy - e.fy) * e.uy;
      return { ok: t >= -eps && t <= e.len + eps, ang: 0 };
    }
    const full = Math.abs(e.sweep);
    let ang = along(e, qx, qy);
    // 끝점(P)과 겹친 0도는 끝까지 돈 것
    if (ang < 1e-9 && full > TAU - 1e-9) ang = full;
    return { ok: ang <= full + 1e-9, ang };
  };
  let T1: [number, number];
  let T2: [number, number];
  let F: [number, number] | null = null;
  let sg = 1;
  if (kind === 'round') {
    const R = size;
    sg = cr > 0 ? 1 : -1;
    // 도는 쪽(sg: 왼쪽 1)으로 R만큼 옮긴 요소: 직선은 평행선, 원호는 반지름 r - sg·dir·R
    const shifted = (e: CornerElem): CornerElem | null => {
      if (!e.arc) return { ...e, fx: e.fx - e.uy * R * sg, fy: e.fy + e.ux * R * sg };
      const r = e.r - sg * e.dir * R;
      return r > 1e-9 ? { ...e, r } : null;
    };
    const oA = shifted(A);
    const oB = shifted(B);
    const cands = oA && oB ? cornerIntersections(oA, oB) : [];
    let best = Infinity;
    for (const q of cands) {
      const d = Math.hypot(q[0] - px, q[1] - py);
      if (d < best) {
        best = d;
        F = q;
      }
    }
    if (!F) return { ok: false, reason: 'too-big' };
    const foot = (e: CornerElem, q: [number, number]): [number, number] => {
      if (!e.arc) {
        const t = (q[0] - e.fx) * e.ux + (q[1] - e.fy) * e.uy;
        return [e.fx + e.ux * t, e.fy + e.uy * t];
      }
      const l = Math.hypot(q[0] - e.cx, q[1] - e.cy);
      return [e.cx + ((q[0] - e.cx) / l) * e.r, e.cy + ((q[1] - e.cy) / l) * e.r];
    };
    T1 = foot(A, F);
    T2 = foot(B, F);
  } else {
    // 모서리에서 요소를 따라 현 길이 d인 점(앞 요소는 거꾸로)
    const at = (e: CornerElem, d: number, back: boolean): [number, number] | null => {
      if (!e.arc) {
        if (d > e.len * (1 + 1e-9) + 1e-9) return null;
        const k = back ? -d : d;
        return [px + e.ux * k, py + e.uy * k];
      }
      if (d > 2 * e.r) return null;
      const a = 2 * Math.asin(Math.min(1, d / (2 * e.r)));
      if (a > Math.abs(e.sweep) + 1e-9) return null;
      const t = Math.atan2(py - e.cy, px - e.cx) + (back ? -1 : 1) * e.dir * a;
      return [e.cx + e.r * Math.cos(t), e.cy + e.r * Math.sin(t)];
    };
    let d = kind === 'chamferLeg' ? size : size / (2 * Math.cos(th / 2));
    let p1 = at(A, d, true);
    let p2 = at(B, d, false);
    // CHF: 두 점 사이가 값과 같아지게 거리를 맞춘다(직선끼리면 처음 값이 답)
    for (let k = 0; kind === 'chamferHyp' && p1 && p2 && k < 50; k++) {
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (Math.abs(len - size) <= 1e-12 * Math.max(1, size) || len < 1e-12) break;
      d *= size / len;
      p1 = at(A, d, true);
      p2 = at(B, d, false);
    }
    if (!p1 || !p2) return { ok: false, reason: 'too-big' };
    T1 = p1;
    T2 = p2;
  }
  const on1 = onElem(A, T1[0], T1[1]);
  const on2 = onElem(B, T2[0], T2[1]);
  // 뒤 원호는 접점 뒤로 조금이라도 남아야 한다(호 표의 차례를 지키려고)
  if (!on1.ok || !on2.ok || (B.arc && on2.ang >= Math.abs(B.sweep) - 1e-9)) return { ok: false, reason: 'too-big' };
  let fillet: { cx: number; cy: number; sweep: number } | null = null;
  if (F) {
    let sw = Math.atan2(T2[1] - F[1], T2[0] - F[0]) - Math.atan2(T1[1] - F[1], T1[0] - F[0]);
    if (sg > 0) while (sw <= 0) sw += TAU;
    else while (sw >= 0) sw -= TAU;
    if (Math.abs(sw) > 1e-9 && Math.abs(sw) < TAU - 1e-9) fillet = { cx: F[0], cy: F[1], sweep: sw };
  }
  return { ok: true, t1: T1, t2: T2, fillet, angA: on1.ang, angB: on2.ang };
}
