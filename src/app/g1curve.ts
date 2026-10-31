/**
 * G1으로 풀어 쓴 곡선 토막 찾기(34차 — 측정 도구 조각, 순수 함수, DOM 없음).
 *
 * CAM이 곡선을 짧은 직선 이송(G1)으로 풀어 쓴 프로그램, 회전축 감기로 나눈 이동, 좌표 변환 평면과 다른 평면의 원호·선반 윤곽 원호를 나눈 조각은
 * 이동 목록에서 곧은 이동이라, 측정에서 끌어온 점 나란함·수직과 첫 점 나란한 방향의 기준이 됐다(곡선과 상관없는 현의 방향 — refine.ts trackDirEdge).
 * 원호 정의가 없어도 이웃 토막 사이 꺾임으로 그런 구간을 찾아 "곡선 조각"으로 표시한다. 판정 규칙(정한 것):
 * - 토막: 원호·스플라인 조각·드릴이 아닌 곧은 이동(이송·급속), 길이 > 0. 이웃 두 토막은 같은 선분 묶음(ncPathSetId — 급속·이송·공구·기계 좌표 쪽 추정)일 때만 잇는다
 * - 굽은 마디: 이웃 두 토막 사이 꺾임각이 0.1° 이상 20° 이하이고 두 토막 길이 비가 2 이하
 * - 굽이 잇기: 이웃 두 굽은 마디의 꺾는 쪽(두 방향의 외적)이 45° 안으로 같고(S자 굽이의 뒤집히는 마디에서 끊는다) 꺾임각 비가 1.8 이하
 * - 구간 끝 다듬기: 이은 구간의 첫·끝 마디 꺾임이 안쪽 마디(넷까지) 꺾임 평균의 1/1.4보다 작으면 그 마디를 뺀다
 *   (접선으로 이어 들어오거나 나가는 직선과 첫·끝 현 사이 꺾임은 현끼리 꺾임의 반 — 그 직선은 남는다. 짧은 현에서는 좌표 반올림 흔들림이
 *   꺾임각만큼 커서 이웃 둘만 견주면 이을 수 있어 구간 안쪽 평균과 견준다)
 * - 곡선 구간: 남은 굽은 마디가 3개 이상(토막 4개 이상)이고, 구간 꼭짓점이 처음·끝 꼭짓점을 잇는 직선에서 0.005(문서 단위 — mm·inch)보다 멀리 벗어난다
 *   (끝이 처음으로 돌아온 고리는 처음 꼭짓점에서 거리). 좌표 반올림 흔들림으로 생긴 거짓 굽이를 뺀다.
 *   같은 길이 토막 셋이 같은 쪽으로 20° 안쪽씩 두 번 꺾인 꺾은선은 현 셋으로 나눈 원호와 가를 수 없어 직선으로 남긴다
 * - 곡선 구간의 토막은 모두 곡선 조각. 구간 밖 토막(긴 직선, 모서리를 도는 짧은 직선 — 꺾임이 20°보다 크거나 길이가 이웃과 크게 다름)은 그대로 기준이다
 */
import { FLAG_MACHINE_EST, MOVE_FEED, MOVE_RAPID } from '../model';
import type { SnapMoves } from './snap';

/** 판정 한도(시험·탐색이 흔들림을 보려고 바꿔 줄 수 있다 — 앱은 기본값) */
export interface G1CurveRules {
  /** 굽은 마디의 꺾임각 범위(라디안) */
  turnMin: number;
  turnMax: number;
  /** 굽은 마디 두 토막의 길이 비 한도 */
  lenRatio: number;
  /** 이은 두 마디의 꺾임각 비 한도 */
  turnRatio: number;
  /** 이은 두 마디의 꺾는 쪽(외적 방향) 사이 각의 코사인 한도 */
  sideCos: number;
  /** 구간 끝 마디를 빼는 꺾임 비(안쪽 마디 넷까지의 평균 ÷ 끝 마디) */
  endRatio: number;
  /** 곡선 구간의 굽은 마디 수 하한 */
  minTurns: number;
  /** 곡선 구간의 처짐 한도(문서 단위 — mm 문서면 0.005 mm, 좌표 소수 셋째 자리 반올림 흔들림의 몇 배) */
  sag: number;
}

export const G1_CURVE_RULES: Readonly<G1CurveRules> = Object.freeze({
  turnMin: (0.1 * Math.PI) / 180,
  turnMax: (20 * Math.PI) / 180,
  lenRatio: 2,
  turnRatio: 1.8,
  sideCos: Math.SQRT1_2,
  endRatio: 1.4,
  minTurns: 3,
  sag: 0.005,
});

/** 구간 끝 마디와 견주는 안쪽 마디 수 */
const TRIM_SPAN = 4;

const cache = new WeakMap<object, Uint8Array>();

/**
 * 이동마다 곡선 조각이면 1(길이 = 이동 수). 기본 한도면 이동 표마다 한 번 셈해 둔다(O(이동 수), 이동 수만큼의 바이트 하나만 남긴다)
 */
export function g1CurvePieces(nc: SnapMoves, rules: Readonly<G1CurveRules> = G1_CURVE_RULES): Uint8Array {
  const m = nc.moves;
  const mine = rules === G1_CURVE_RULES;
  const hit = mine ? cache.get(m) : undefined;
  if (hit) return hit;
  const n = m.count;
  const out = new Uint8Array(n);
  if (mine) cache.set(m, out);
  if (n < 3) return out;
  const { turnMin, turnMax, lenRatio, turnRatio, sideCos, endRatio, minTurns, sag } = rules;
  // 덜 꺾인 마디만 꺾임각을 센다(코사인 한도 — 반올림 여유)
  const cosMax = Math.cos(turnMax) - 1e-12;
  const P = m.points;
  // 스플라인 조각(곡선 정의가 있어 따로 거른다 — 표는 첫 이동 번호 오름차순)
  const sp = nc.splines;
  let sk = 0;
  const inSpline = (i: number): boolean => {
    if (!sp) return false;
    while (sk < sp.count && sp.move[sk]! + sp.moves[sk]! <= i) sk++;
    return sk < sp.count && sp.move[sk]! <= i;
  };
  // 토막 i의 묶음 열쇠(곧은 이동이 아니면 NaN — 잇지 않는다). i는 오름차순으로만 묻는다
  const key = (i: number): number => {
    const k = m.kind[i];
    if ((k !== MOVE_FEED && k !== MOVE_RAPID) || inSpline(i)) return NaN;
    if (m.flags[i]! & FLAG_MACHINE_EST) return -3;
    return k === MOVE_RAPID ? -2 : Math.max(-1, m.tool[i]!);
  };
  // 지금 구간: 첫 마디 cs(없으면 −1), 마지막 마디의 꺾임각·꺾는 쪽
  let cs = -1;
  let ce = -1;
  let pt = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  const close = (): void => {
    if (cs >= 0 && ce > cs) {
      // 구간 끝 마디가 안쪽 마디(넷까지)의 꺾임 평균보다 endRatio배 넘게 작으면(접선으로 이어진 직선과 첫·끝 현 — 현 꺾임의 반) 그 마디를 뺀다.
      // 이웃 둘만 견주는 잇기는 짧은 현에서 좌표 반올림 흔들림이 꺾임각만큼 커서 그 직선을 이을 수 있다
      const k = Math.min(TRIM_SPAN, ce - cs);
      let a = 0;
      let b = 0;
      for (let q = 1; q <= k; q++) {
        a += jointTurn(P, cs + q);
        b += jointTurn(P, ce - q);
      }
      let s = cs;
      let e = ce;
      if (a / k > endRatio * jointTurn(P, cs)) s++;
      if (b / k > endRatio * jointTurn(P, ce)) e--;
      if (e - s + 1 >= minTurns && sagOver(P, s, e + 2, sag)) for (let i = s; i <= e + 1; i++) out[i] = 1;
    }
    cs = -1;
  };
  let k0 = key(0);
  let ux = 0;
  let uy = 0;
  let uz = 0;
  let lu = 0;
  {
    const dx = P[3]! - P[0]!;
    const dy = P[4]! - P[1]!;
    const dz = P[5]! - P[2]!;
    lu = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (lu > 0) {
      ux = dx / lu;
      uy = dy / lu;
      uz = dz / lu;
    }
  }
  for (let j = 0; j + 1 < n; j++) {
    const b = j + 1;
    const k1 = key(b);
    const o = 3 * b;
    const dx = P[o + 3]! - P[o]!;
    const dy = P[o + 4]! - P[o + 1]!;
    const dz = P[o + 5]! - P[o + 2]!;
    const lv = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const vx = lv > 0 ? dx / lv : 0;
    const vy = lv > 0 ? dy / lv : 0;
    const vz = lv > 0 ? dz / lv : 0;
    // 마디 j(토막 j → j + 1)가 굽은 마디인지(꺾임각은 20°보다 덜 꺾인 마디만 셈)
    let t = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const dot = ux * vx + uy * vy + uz * vz;
    if (k0 === k1 && lu > 0 && lv > 0 && dot >= cosMax && Math.max(lu, lv) <= lenRatio * Math.min(lu, lv)) {
      cx = uy * vz - uz * vy;
      cy = uz * vx - ux * vz;
      cz = ux * vy - uy * vx;
      const s = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const a = Math.atan2(s, dot);
      if (a >= turnMin && a <= turnMax && s > 0) {
        t = a;
        cx /= s;
        cy /= s;
        cz /= s;
      }
    }
    if (t > 0) {
      // 앞 마디와 이을 수 있으면 구간을 늘리고, 아니면 앞 구간을 닫고 여기서 새로
      const join = cs >= 0 && ce === j - 1 && Math.max(t, pt) <= turnRatio * Math.min(t, pt) && cx * px + cy * py + cz * pz >= sideCos;
      if (!join) {
        close();
        cs = j;
      }
      ce = j;
      pt = t;
      px = cx;
      py = cy;
      pz = cz;
    } else close();
    k0 = k1;
    ux = vx;
    uy = vy;
    uz = vz;
    lu = lv;
  }
  close();
  return out;
}

/** 마디 j(토막 j: 점 j → j + 1, 토막 j + 1: 점 j + 1 → j + 2)의 꺾임각 */
function jointTurn(P: Float64Array, j: number): number {
  const o = 3 * j;
  const ux = P[o + 3]! - P[o]!;
  const uy = P[o + 4]! - P[o + 1]!;
  const uz = P[o + 5]! - P[o + 2]!;
  const vx = P[o + 6]! - P[o + 3]!;
  const vy = P[o + 7]! - P[o + 4]!;
  const vz = P[o + 8]! - P[o + 5]!;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), ux * vx + uy * vy + uz * vz);
}

/** 점 a … b(점 번호) 가운데 점 a·b를 잇는 직선에서 lim보다 멀리 벗어난 점이 있는지(a·b가 같은 자리면 점 a에서 거리) */
function sagOver(P: Float64Array, a: number, b: number, lim: number): boolean {
  const ax = P[3 * a]!;
  const ay = P[3 * a + 1]!;
  const az = P[3 * a + 2]!;
  const dx = P[3 * b]! - ax;
  const dy = P[3 * b + 1]! - ay;
  const dz = P[3 * b + 2]! - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  const lim2 = lim * lim;
  for (let i = a + 1; i < b; i++) {
    const qx = P[3 * i]! - ax;
    const qy = P[3 * i + 1]! - ay;
    const qz = P[3 * i + 2]! - az;
    let d2: number;
    if (l2 > 1e-24) {
      const cx = qy * dz - qz * dy;
      const cy = qz * dx - qx * dz;
      const cz = qx * dy - qy * dx;
      d2 = (cx * cx + cy * cy + cz * cz) / l2;
    } else d2 = qx * qx + qy * qy + qz * qz;
    if (d2 > lim2) return true;
  }
  return false;
}
