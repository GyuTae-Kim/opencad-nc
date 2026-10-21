/**
 * G-code·Heidenhain 해석기가 함께 쓰는 이동 쌓기: 위치·공구·이송 상태, 이동 더하기(시간·길이 통계),
 * 공구 목록, 범위 계산, NcProgram 만들기.
 *
 * 선택 기능(기본은 꺼짐 — 켜지 않으면 이동·시간은 예전과 같다):
 * - 반경 보정 구간 기록(noteComp): 보정 코드가 나올 때만 사건을 쌓고, build()에서 NcProgram.compRuns로 만든다.
 * - 회전축 감기(setRotary): A·B·C 각을 축 둘레로 감아 공작물 기준 공구 끝 경로를 만든다(각이 바뀌는 이동은 잘게 나눈다).
 */
import type { Box3 } from 'opencad-viewer3d/types';
import { affinePlane, applyAffine, invertAffine, isIdentityAffine, type Affine } from './affine';
import {
  FLAG_COMP_LEFT,
  FLAG_COMP_RIGHT,
  FLAG_COOLANT,
  FLAG_INVERSE_TIME,
  FLAG_MACHINE,
  FLAG_MACHINE_EST,
  FLAG_PER_REV,
  FLAG_TOOL_LENGTH,
  MOVE_ARC,
  MOVE_FEED,
  MOVE_RAPID,
  MoveBuilder,
  NcWarnings,
  arcExtend,
  arcLength,
  arcPoints,
  boxOf,
  emptyBox,
  extendBox,
  toolInfoFromComment,
  type NcCompRun,
  type NcDialect,
  type NcNotice,
  type NcPlane,
  type NcProgram,
  type NcRotaryOptions,
  type NcTool,
} from './model';

/** 반경 보정 사건(보정이 켜지거나 꺼지거나 반지름이 바뀐 곳) */
interface CompEvent {
  move: number;
  side: number;
  plane: number;
  radius: number | undefined;
  source: string;
  d: number;
  tool: number;
  line: number;
}

const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2 };
import type { NcSource } from './text';

export class NcEmitter {
  protected src: NcSource;
  protected w = new NcWarnings();
  protected mb: MoveBuilder;

  /** 지금 위치(표시 좌표) */
  protected pos = new Float64Array(3);
  /** 알려진 축 비트(1 x, 2 y, 4 z) — 첫 이동 전 모르는 축은 끝점과 같게 둔다 */
  protected known = 0;
  protected tool = -1;
  protected feed = 0;
  protected speed = 0;
  protected spindleDir = 0;
  protected feedMode = 94;
  protected comp = 0;
  protected tlc = false;
  protected coolant = false;
  protected wcs = 0;
  protected displayInch = false;
  protected rapidFeed = 10000;
  protected tol = 0.002;

  protected tools = new Map<number, NcTool>();
  protected toolInfo = new Map<number, { diameter?: number; name?: string }>();
  protected lastComment: { text: string; line: number } | null = null;
  protected toolChanges = 0;
  protected rapidLen = 0;
  protected feedLen = 0;
  protected rapidTime = 0;
  protected feedTime = 0;
  protected dwellTime = 0;
  protected name = '';
  private warnedNoFeed = false;

  /** 반경 보정 사건(보정 코드가 있을 때만 쌓인다) */
  protected compEvents: CompEvent[] = [];
  /** 화면이 띠로 알릴 해석 판단 */
  protected notices: NcNotice[] = [];
  /** 선반 모드로 읽음(build에서 NcProgram.lathe) */
  protected latheMode = false;
  /** 회전축 낱말을 보았음 */
  protected sawRotary = false;

  // ── 회전축 감기(선택) ──
  /** A·B·C → 도는 직선 축 번호(0 x, 1 y, 2 z, -1 무시). null이면 감기 꺼짐 */
  protected rotAxis: Int8Array | null = null;
  private rotSign = 1;
  private rotCenter = [0, 0, 0];
  private rotStep = 2;
  /** 감기를 잠시 끈다(공구 끝점 제어 G43.4 등 — 프로그램 좌표가 이미 공구 끝) */
  protected rotOff = false;
  /** 지금 회전 각(도, A·B·C) */
  protected ang = new Float64Array(3);
  /** 다음 이동이 끝날 때의 각(블록에서 정한다. 이동이 쓰면 지운다) */
  protected angTo: Float64Array | null = null;

  // ── 기계 좌표 쪽 추정 위치(G53·G28·M91 등, 작업 원점의 기계 위치를 모를 때) ──
  /** 지금 "안전 높이"(추정)에 있는 축 비트(1 x, 2 y, 4 z) */
  protected machHigh = 0;
  /** 안전 높이로 옮기는 축(밀링 = 공구 축 Z, 선반 = X·Z) */
  protected machSafeAxes = 4;
  /** 마지막 점이 안전 높이였던 축 */
  private machLast = 0;
  /** build에서 안전 높이 값을 넣을 점 [점 번호, 축 비트]… */
  private machFix: number[] = [];
  /** 지금까지 지난 점의 축별 최댓값(안전 높이 추정용) */
  private seenMax = [-Infinity, -Infinity, -Infinity];

  constructor(src: NcSource, start?: readonly number[]) {
    this.src = src;
    if (start) {
      this.pos[0] = start[0]!;
      this.pos[1] = start[1]!;
      this.pos[2] = start[2]!;
      this.known = 7;
    }
    this.mb = new MoveBuilder(this.pos, 1024);
  }

  protected flags(): number {
    let f = 0;
    if (this.comp === 1) f |= FLAG_COMP_LEFT;
    else if (this.comp === 2) f |= FLAG_COMP_RIGHT;
    if (this.tlc) f |= FLAG_TOOL_LENGTH;
    if (this.feedMode === 93) f |= FLAG_INVERSE_TIME;
    else if (this.feedMode === 95) f |= FLAG_PER_REV;
    if (this.coolant) f |= FLAG_COOLANT;
    return f;
  }

  protected toolAcc(): NcTool {
    let t = this.tools.get(this.tool);
    if (!t) {
      t = { number: this.tool, firstLine: -1, moveCount: 0, feedLength: 0, rapidLength: 0, time: 0 };
      this.tools.set(this.tool, t);
    }
    return t;
  }

  // ── 출력 변환(Heidenhain 좌표 변환 사이클 8·10·11·26): this.pos는 변환 전 좌표, 쌓는 점은 변환 뒤 ──
  protected outXf: Affine | null = null;
  private outInv: Affine | null = null;

  /** 출력 변환을 바꾼다. 지금 공구 자리(화면)는 그대로 두고 변환 전 좌표를 새 변환으로 다시 셈한다 */
  protected setOutXf(m: Affine | null): void {
    const d = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    if (this.outXf) applyAffine(this.outXf, this.pos, d);
    const inv = m && !isIdentityAffine(m) ? invertAffine(m) : null;
    this.outXf = inv ? m : null;
    this.outInv = inv;
    if (inv) applyAffine(inv, d, this.pos);
    else this.pos.set(d);
  }

  /** 변환 전 좌표 → 쌓는(화면) 좌표 */
  protected outPoint(p: ArrayLike<number>): number[] {
    const d = [p[0]!, p[1]!, p[2]!];
    if (this.outXf) applyAffine(this.outXf, d, d);
    return d;
  }

  /** 출력 변환 중의 이동: 화면 좌표로 바꿔 보통 길로 쌓고, 지금 자리는 변환 전 좌표로 둔다 */
  private emitOut(kind: number, x: number, y: number, z: number, line: number, extraFlags: number, arcIdx: number, arcLen: number): boolean {
    const xf = this.outXf!;
    const prog = [x, y, z];
    const p = this.pos;
    const first = this.known !== 7 && this.mb.count === 0;
    if (first) for (let a = 0; a < 3; a++) if (!(this.known & (1 << a))) p[a] = prog[a]!;
    const s = [0, 0, 0];
    const e = [0, 0, 0];
    applyAffine(xf, p, s);
    applyAffine(xf, prog, e);
    if (first) this.mb.setLast(s[0]!, s[1]!, s[2]!);
    const known = this.known;
    this.outXf = null;
    this.known = 7;
    p.set(s);
    const ok = this.emit(kind, e[0]!, e[1]!, e[2]!, line, extraFlags, arcIdx, arcLen);
    this.outXf = xf;
    this.known = known;
    p.set(prog);
    return ok;
  }

  /** 이동 하나(직선·급속·드릴, 호면 arcIdx·arcLen). 길이 0이면 넣지 않는다 */
  protected emit(kind: number, x: number, y: number, z: number, line: number, extraFlags = 0, arcIdx = -1, arcLen = -1): boolean {
    if (this.outXf) return this.emitOut(kind, x, y, z, line, extraFlags, arcIdx, arcLen);
    if (this.rotAxis !== null && !this.rotOff && this.rotActive()) return this.emitRot(kind, x, y, z, line, extraFlags, arcIdx, arcLen);
    const p = this.pos;
    if (this.known !== 7 && this.mb.count === 0) {
      if (!(this.known & 1)) p[0] = x;
      if (!(this.known & 2)) p[1] = y;
      if (!(this.known & 4)) p[2] = z;
      this.mb.setLast(p[0]!, p[1]!, p[2]!);
    }
    const len = arcLen >= 0 ? arcLen : Math.hypot(x - p[0]!, y - p[1]!, z - p[2]!);
    // 안전 높이(추정)에 있던 축이 다른 값으로 가면 그 축은 안전 높이를 떠난다
    if (this.machHigh !== 0) this.leaveMachHigh(x, y, z);
    if (this.machPending !== 0) this.machHigh |= this.machPending;
    p[0] = x;
    p[1] = y;
    p[2] = z;
    if (len < 1e-12) return false;
    const wcs = extraFlags & FLAG_MACHINE ? 255 : this.wcs;
    const sp = this.spindleDir === 4 ? -this.speed : this.spindleDir === 3 ? this.speed : 0;
    const i = this.mb.push(kind, x, y, z, line, this.tool, this.feed, sp, this.flags() | extraFlags, wcs, arcIdx);
    const endHigh = this.machHigh;
    if (endHigh !== 0 || this.machLast !== 0) {
      this.mb.flags[i] = this.mb.flags[i]! | FLAG_MACHINE_EST;
      if (endHigh !== 0) this.machFix.push(i + 1, endHigh);
      this.machLast = endHigh;
    }
    const sm = this.seenMax;
    if (x > sm[0]! && !(endHigh & 1)) sm[0] = x;
    if (y > sm[1]! && !(endHigh & 2)) sm[1] = y;
    if (z > sm[2]! && !(endHigh & 4)) sm[2] = z;
    let t = 0;
    const acc = this.toolAcc();
    if (acc.firstLine < 0) acc.firstLine = line;
    acc.moveCount++;
    if (kind === MOVE_RAPID) {
      t = (len / this.rapidFeed) * 60;
      this.rapidLen += len;
      this.rapidTime += t;
      acc.rapidLength += len;
    } else {
      const f = this.feed;
      if (this.feedMode === 93) t = f > 0 ? 60 / f : 0;
      else if (this.feedMode === 95) t = f > 0 && this.speed > 0 ? (len / (f * this.speed)) * 60 : 0;
      else t = f > 0 ? (len / f) * 60 : 0;
      if (!(f > 0) && !this.warnedNoFeed) {
        this.warnedNoFeed = true;
        this.w.add('이송 속도(F) 없이 절삭 이동 — 시간 계산에서 뺌', line);
      }
      this.feedLen += len;
      this.feedTime += t;
      acc.feedLength += len;
    }
    acc.time += t;
    this.mb.time[i] = t;
    return true;
  }

  private leaveMachHigh(x: number, y: number, z: number): void {
    const p = this.pos;
    if (this.machHigh & 1 && x !== p[0]) this.machHigh &= ~1;
    if (this.machHigh & 2 && y !== p[1]) this.machHigh &= ~2;
    if (this.machHigh & 4 && z !== p[2]) this.machHigh &= ~4;
  }

  /**
   * 기계 좌표 쪽 이동(G53·G28·G30·M91·SUPA·G74 등)인데 작업 원점의 기계 위치를 모를 때: mask 축 가운데 안전 높이 축
   * (machSafeAxes — 밀링 Z, 선반 X·Z)은 "안전 높이"(경로의 그 축 최댓값 + 여유, build에서 정한다)로 옮기고,
   * 나머지 축(밀링 X·Y — 기계 원점 방향을 알 수 없다)은 제자리에 둔다. 옮기지 않은 축 비트를 돌려준다.
   * 위치를 아직 모르는 첫 이동 전이면 이동 없이 시작점을 안전 높이로 둔다(뒤의 첫 진입이 위에서 내려오게).
   */
  protected machineRetract(mask: number, line: number, kind = MOVE_RAPID): number {
    const safe = mask & this.machSafeAxes;
    if (!safe) return mask;
    if (this.outXf) {
      // 기계 좌표는 좌표 변환 밖: 화면 좌표에서 물러나고 지금 자리를 변환 전 좌표로 되돌린다
      const xf = this.outXf;
      const inv = this.outInv!;
      applyAffine(xf, this.pos, this.pos);
      this.outXf = null;
      const r = this.machineRetract(mask, line, kind);
      this.outXf = xf;
      applyAffine(inv, this.pos, this.pos);
      return r;
    }
    const t = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    const margin = this.displayInch ? 1 : 25;
    for (let a = 0; a < 3; a++) {
      if (!(safe & (1 << a))) continue;
      if (this.machHigh & (1 << a)) continue;
      const top = Number.isFinite(this.seenMax[a]!) ? this.seenMax[a]! : this.pos[a]!;
      // 프로그램 값과 우연히 같지 않게 조금 비튼 임시 값(build에서 고친다)
      t[a] = top + margin + 0.000123457;
    }
    if (this.mb.count === 0 && this.known !== 7) {
      // 첫 이동 전: 시작점을 안전 높이로
      for (let a = 0; a < 3; a++)
        if (safe & (1 << a)) {
          this.pos[a] = t[a]!;
          this.known |= 1 << a;
        }
      this.machHigh |= safe;
      this.machLast = this.machHigh;
      this.machFix.push(0, this.machHigh);
      return mask & ~safe;
    }
    // 이동 끝에서 안전 높이 비트를 켠다(emit이 leaveMachHigh 다음에 더한다)
    this.machPending = safe;
    this.emit(kind, t[0]!, t[1]!, t[2]!, line, FLAG_MACHINE);
    this.machPending = 0;
    return mask & ~safe;
  }
  /** machineRetract가 내는 이동이 끝날 때 켤 안전 높이 비트 */
  private machPending = 0;

  /** 호 이동: 중심 c(xyz, 직선 축 값은 시작점), 부호 있는 중심각 */
  protected emitArc(plane: number, c: readonly number[], sweep: number, x: number, y: number, z: number, line: number, extraFlags = 0): void {
    if (this.outXf) return this.emitArcOut(plane, c, sweep, x, y, z, line, extraFlags);
    const s = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    const e = [x, y, z];
    const idx = this.mb.pushArc(c[0]!, c[1]!, c[2]!, plane, sweep);
    const len = arcLength(s, e, c, plane, sweep);
    if (!this.emit(MOVE_ARC, x, y, z, line, extraFlags, idx, len)) this.mb.arcCount--;
  }

  /** 출력 변환 중의 호: 평면을 지키면 중심·방향을 옮긴 호로, 아니면 직선 조각으로 */
  private emitArcOut(plane: number, c: readonly number[], sweep: number, x: number, y: number, z: number, line: number, extraFlags: number): void {
    const xf = this.outXf!;
    const info = affinePlane(xf, plane);
    const s = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    const e = [x, y, z];
    if (!info.keeps) {
      this.w.add('좌표 변환 평면과 다른 평면의 원호는 직선 조각으로 그림', line);
      const pts: number[] = [];
      const n = arcPoints(s, e, c, plane, sweep, Math.PI / 36, pts);
      for (let k = 0; k < n; k++) this.emit(MOVE_FEED, pts[k * 3]!, pts[k * 3 + 1]!, pts[k * 3 + 2]!, line, extraFlags);
      return;
    }
    if (!info.uniform) this.w.add('축마다 다른 배율의 원호는 타원 대신 반지름이 바뀌는 호로 그림', line);
    const sd = this.outPoint(s);
    const ed = this.outPoint(e);
    const cd = this.outPoint(c);
    const sw = sweep * info.sign;
    const idx = this.mb.pushArc(cd[0]!, cd[1]!, cd[2]!, plane, sw);
    const len = arcLength(sd, ed, cd, plane, sw);
    if (!this.emit(MOVE_ARC, x, y, z, line, extraFlags, idx, len)) this.mb.arcCount--;
  }

  /** 구멍(드릴 사이클) — 출력 변환 중이면 옮겨서 */
  protected pushHoleOut(top: ArrayLike<number>, bottom: ArrayLike<number>, line: number, cycle: number, first: number): void {
    this.mb.pushHole(this.outPoint(top), this.outPoint(bottom), line, this.tool, cycle, first);
  }

  // ───────────────────────── 회전축 감기 ─────────────────────────

  /** 회전축 감기를 켠다(해석 시작 전에) */
  protected setRotary(o: NcRotaryOptions): void {
    const ax = new Int8Array(3);
    const def = ['x', 'y', 'z'] as const;
    (['A', 'B', 'C'] as const).forEach((k, i) => {
      const v = o[k] === undefined ? def[i] : o[k];
      ax[i] = v === null ? -1 : (AXIS_INDEX[v] ?? -1);
    });
    this.rotAxis = ax;
    this.rotSign = o.reverse ? -1 : 1;
    if (o.center) this.rotCenter = [o.center[0], o.center[1], o.center[2]];
    this.rotStep = o.stepDeg && o.stepDeg > 0.01 ? o.stepDeg : 2;
  }

  /** 감아야 하는지(각이 0이 아니거나 이번 이동에서 바뀜) */
  private rotActive(): boolean {
    const a = this.ang;
    const t = this.angTo;
    if (t && (t[0] !== a[0] || t[1] !== a[1] || t[2] !== a[2])) return true;
    return a[0] !== 0 || a[1] !== 0 || a[2] !== 0;
  }

  /** 직선 축 좌표 p를 각 ang(도)만큼 감는다(out에). C → B → A 차례로 돈다(R = R_A·R_B·R_C) */
  protected wrapPoint(px: number, py: number, pz: number, ang: ArrayLike<number>, out: number[]): void {
    const c = this.rotCenter;
    const q = [px - c[0]!, py - c[1]!, pz - c[2]!];
    const axes = this.rotAxis;
    if (axes)
      for (let k = 2; k >= 0; k--) {
        const ax = axes[k]!;
        const deg = ang[k]!;
        if (ax < 0 || deg === 0) continue;
        const t = ((this.rotSign * deg) / 180) * Math.PI;
        const cs = Math.cos(t);
        const sn = Math.sin(t);
        const i = (ax + 1) % 3;
        const j = (ax + 2) % 3;
        const u = q[i]!;
        const v = q[j]!;
        q[i] = u * cs - v * sn;
        q[j] = u * sn + v * cs;
      }
    out[0] = q[0]! + c[0]!;
    out[1] = q[1]! + c[1]!;
    out[2] = q[2]! + c[2]!;
  }

  /** 회전축이 감긴 이동: 직선 축·각을 함께 고르게 바꾸며 잘게 나눠 넣는다. 시간은 (직선 길이, 각) 합성 길이로 */
  private emitRot(kind: number, x: number, y: number, z: number, line: number, extraFlags: number, arcIdx: number, arcLen: number): boolean {
    const p = this.pos;
    const a0 = [this.ang[0]!, this.ang[1]!, this.ang[2]!];
    const a1 = this.angTo ? [this.angTo[0]!, this.angTo[1]!, this.angTo[2]!] : a0;
    this.angTo = null;
    const w = [0, 0, 0];
    if (this.known !== 7 && this.mb.count === 0) {
      if (!(this.known & 1)) p[0] = x;
      if (!(this.known & 2)) p[1] = y;
      if (!(this.known & 4)) p[2] = z;
      this.wrapPoint(p[0]!, p[1]!, p[2]!, a0, w);
      this.mb.setLast(w[0]!, w[1]!, w[2]!);
    }
    const s = [p[0]!, p[1]!, p[2]!];
    const e = [x, y, z];
    // 회전축 감기 중의 안전 높이(추정)는 값을 고치지 않고 표시만 한다
    if (this.machHigh !== 0) this.leaveMachHigh(x, y, z);
    if (this.machPending !== 0) this.machHigh |= this.machPending;
    const estFlag = this.machHigh !== 0 || this.machLast !== 0 ? FLAG_MACHINE_EST : 0;
    this.machLast = this.machHigh;
    const dA = [a1[0]! - a0[0]!, a1[1]! - a0[1]!, a1[2]! - a0[2]!];
    const dlin = arcLen >= 0 ? arcLen : Math.hypot(x - s[0]!, y - s[1]!, z - s[2]!);
    const combined = Math.hypot(dlin, dA[0]!, dA[1]!, dA[2]!);
    p[0] = x;
    p[1] = y;
    p[2] = z;
    this.ang[0] = a1[0]!;
    this.ang[1] = a1[1]!;
    this.ang[2] = a1[2]!;
    if (combined < 1e-12) return false;
    let n = Math.max(1, Math.ceil(Math.max(Math.abs(dA[0]!), Math.abs(dA[1]!), Math.abs(dA[2]!)) / this.rotStep - 1e-9));
    let pts: number[] | null = null;
    if (arcIdx >= 0) {
      // 호는 직선 축에서 나눈 점을 감는다(감긴 호는 더 이상 평면 호가 아니므로 직선 조각으로)
      const mb = this.mb;
      const c = [mb.arcCenter[arcIdx * 3]!, mb.arcCenter[arcIdx * 3 + 1]!, mb.arcCenter[arcIdx * 3 + 2]!];
      const sweep = mb.arcSweep[arcIdx]!;
      n = Math.max(n, Math.ceil(Math.abs(sweep) / (Math.PI / 36) - 1e-9));
      pts = [];
      n = arcPoints(s, e, c, mb.arcPlane[arcIdx]!, sweep, Math.abs(sweep) / n, pts);
      mb.arcCount--;
    }
    if (n > 100000) n = 100000;
    const pieceKind = kind === MOVE_ARC ? MOVE_FEED : kind;
    // 시간(합성 길이)
    let t = 0;
    if (kind === MOVE_RAPID) t = (combined / this.rapidFeed) * 60;
    else {
      const f = this.feed;
      if (this.feedMode === 93) t = f > 0 ? 60 / f : 0;
      else if (this.feedMode === 95) t = f > 0 && this.speed > 0 ? (combined / (f * this.speed)) * 60 : 0;
      else t = f > 0 ? (combined / f) * 60 : 0;
      if (!(f > 0) && !this.warnedNoFeed) {
        this.warnedNoFeed = true;
        this.w.add('이송 속도(F) 없이 절삭 이동 — 시간 계산에서 뺌', line);
      }
    }
    const wcs = extraFlags & FLAG_MACHINE ? 255 : this.wcs;
    const sp = this.spindleDir === 4 ? -this.speed : this.spindleDir === 3 ? this.speed : 0;
    const flags = this.flags() | extraFlags | estFlag;
    const acc = this.toolAcc();
    if (acc.firstLine < 0) acc.firstLine = line;
    let lx = this.mb.lastX();
    let ly = this.mb.lastY();
    let lz = this.mb.lastZ();
    let len = 0;
    const ang = [0, 0, 0];
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      let qx: number;
      let qy: number;
      let qz: number;
      if (pts) {
        qx = pts[(k - 1) * 3]!;
        qy = pts[(k - 1) * 3 + 1]!;
        qz = pts[(k - 1) * 3 + 2]!;
      } else {
        qx = s[0]! + (e[0]! - s[0]!) * f;
        qy = s[1]! + (e[1]! - s[1]!) * f;
        qz = s[2]! + (e[2]! - s[2]!) * f;
      }
      ang[0] = a0[0]! + dA[0]! * f;
      ang[1] = a0[1]! + dA[1]! * f;
      ang[2] = a0[2]! + dA[2]! * f;
      this.wrapPoint(qx, qy, qz, ang, w);
      len += Math.hypot(w[0]! - lx, w[1]! - ly, w[2]! - lz);
      lx = w[0]!;
      ly = w[1]!;
      lz = w[2]!;
      const i = this.mb.push(pieceKind, lx, ly, lz, line, this.tool, this.feed, sp, flags, wcs);
      this.mb.time[i] = t / n;
      acc.moveCount++;
    }
    if (kind === MOVE_RAPID) {
      this.rapidLen += len;
      this.rapidTime += t;
      acc.rapidLength += len;
    } else {
      this.feedLen += len;
      this.feedTime += t;
      acc.feedLength += len;
    }
    acc.time += t;
    return true;
  }

  // ───────────────────────── 반경 보정 기록 ─────────────────────────

  /**
   * 보정 상태(this.comp)나 반지름이 바뀌었을 때 부른다. radius를 모르면 build()에서 공구 지름(D 번호 → 공구 번호 차례)으로 찾는다.
   * 다음에 만드는 이동부터 적용된다.
   */
  protected noteComp(plane: number, line: number, radius?: number, source = '', d = -1): void {
    const evs = this.compEvents;
    const last = evs[evs.length - 1];
    if (!last && this.comp === 0) return;
    const ev: CompEvent = { move: this.mb.count, side: this.comp, plane, radius, source, d, tool: this.tool, line };
    if (last && last.side === ev.side && last.plane === ev.plane && last.radius === ev.radius && last.d === ev.d && last.tool === ev.tool) return;
    if (last && last.move === ev.move) evs[evs.length - 1] = ev;
    else evs.push(ev);
  }

  /** 보정 사건 → 구간 */
  private compRuns(moveCount: number): NcCompRun[] {
    const out: NcCompRun[] = [];
    const evs = this.compEvents;
    for (let k = 0; k < evs.length; k++) {
      const ev = evs[k]!;
      if (ev.side !== 1 && ev.side !== 2) continue;
      const end = k + 1 < evs.length ? evs[k + 1]!.move : moveCount;
      if (end <= ev.move) continue;
      let radius = ev.radius;
      let source = ev.source;
      if (radius === undefined) {
        for (const t of ev.d >= 0 && ev.d !== ev.tool ? [ev.d, ev.tool] : [ev.tool]) {
          const dia = this.toolInfo.get(t)?.diameter;
          if (dia !== undefined) {
            radius = dia / 2;
            source = `${t < 0 ? '공구' : `T${t}`} 지름(주석·공구 정의)`;
            break;
          }
        }
      }
      out.push({ first: ev.move, end, side: ev.side, plane: (ev.plane as NcPlane) ?? 0, radius: radius ?? NaN, source: radius === undefined ? '' : source, line: ev.line });
    }
    return out;
  }

  protected dwell(sec: number): void {
    if (!(sec > 0)) return;
    this.dwellTime += sec;
    if (this.mb.count > 0) this.mb.time[this.mb.count - 1] = this.mb.time[this.mb.count - 1]! + sec;
    this.toolAcc().time += sec;
  }

  protected addToolInfo(n: number, text: string): void {
    const info = toolInfoFromComment(text, this.displayInch ? 'inch' : 'mm');
    this.setToolInfo(n, info);
  }

  protected setToolInfo(n: number, info: { diameter?: number; name?: string }): void {
    const cur = this.toolInfo.get(n) ?? {};
    if (cur.diameter === undefined && info.diameter !== undefined) cur.diameter = info.diameter;
    if (cur.name === undefined && info.name !== undefined) cur.name = info.name;
    this.toolInfo.set(n, cur);
  }

  protected changeTool(t: number, line: number): void {
    if (t === this.tool) return;
    this.tool = t;
    this.toolChanges++;
    const acc = this.toolAcc();
    if (acc.firstLine < 0) acc.firstLine = line;
    const lc = this.lastComment;
    if (!this.toolInfo.get(t)?.name && lc && line - lc.line <= 2 && line >= lc.line) this.addToolInfo(t, lc.text);
  }

  /** 이동 i의 길이(호·나선 포함) */
  private moveLen(i: number): number {
    const mb = this.mb;
    const pts = mb.points;
    const k = i * 3;
    if (mb.kind[i] === MOVE_ARC && mb.arc[i]! >= 0) {
      const ai = mb.arc[i]!;
      const c = [mb.arcCenter[ai * 3]!, mb.arcCenter[ai * 3 + 1]!, mb.arcCenter[ai * 3 + 2]!];
      return arcLength(pts.subarray(k, k + 3), pts.subarray(k + 3, k + 6), c, mb.arcPlane[ai]!, mb.arcSweep[ai]!);
    }
    return Math.hypot(pts[k + 3]! - pts[k]!, pts[k + 4]! - pts[k + 1]!, pts[k + 5]! - pts[k + 2]!);
  }

  /**
   * 안전 높이(추정) 점에 값을 넣는다: 추정 이동이 아닌 이동이 지난 점의 축별 최댓값 + 여유(mm 25 · inch 1).
   * 바뀐 점에 닿는 이동의 길이·시간·통계를 다시 맞춘다. 회전축 감기 중이면 임시 값을 그대로 둔다.
   */
  private fixMachine(): void {
    const fix = this.machFix;
    if (!fix.length || this.rotAxis !== null) return;
    const mb = this.mb;
    const n = mb.count;
    const pts = mb.points;
    const box = emptyBox();
    const c = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      if (mb.flags[i]! & FLAG_MACHINE_EST) continue;
      const k = i * 3;
      if (mb.kind[i] === MOVE_ARC && mb.arc[i]! >= 0) {
        const ai = mb.arc[i]!;
        c[0] = mb.arcCenter[ai * 3]!;
        c[1] = mb.arcCenter[ai * 3 + 1]!;
        c[2] = mb.arcCenter[ai * 3 + 2]!;
        arcExtend(pts.subarray(k, k + 3), pts.subarray(k + 3, k + 6), c, mb.arcPlane[ai]!, mb.arcSweep[ai]!, box);
      } else {
        extendBox(box, pts[k]!, pts[k + 1]!, pts[k + 2]!);
        extendBox(box, pts[k + 3]!, pts[k + 4]!, pts[k + 5]!);
      }
    }
    for (let h = 0; h < mb.holeCount; h++) extendBox(box, mb.holeTop[h * 3]!, mb.holeTop[h * 3 + 1]!, mb.holeTop[h * 3 + 2]!);
    const margin = this.displayInch ? 1 : 25;
    const safe = [0, 1, 2].map((a) => (Number.isFinite(box[3 + a]!) ? box[3 + a]! : 0) + margin);
    const changed = new Uint8Array(n + 1);
    for (let j = 0; j < fix.length; j += 2) changed[fix[j]!] = 1;
    const affected: number[] = [];
    const oldLen: number[] = [];
    for (let i = 0; i < n; i++)
      if (changed[i] || changed[i + 1]) {
        affected.push(i);
        oldLen.push(this.moveLen(i));
      }
    for (let j = 0; j < fix.length; j += 2) {
      const k = fix[j]! * 3;
      const m = fix[j + 1]!;
      for (let a = 0; a < 3; a++) if (m & (1 << a)) pts[k + a] = safe[a]!;
    }
    affected.forEach((i, q) => {
      const dl = this.moveLen(i) - oldLen[q]!;
      if (Math.abs(dl) < 1e-12) return;
      const acc = this.tools.get(mb.tool[i]!);
      let dt = 0;
      if (mb.kind[i] === MOVE_RAPID) {
        dt = (dl / this.rapidFeed) * 60;
        this.rapidLen += dl;
        this.rapidTime += dt;
        if (acc) acc.rapidLength += dl;
      } else {
        const f = mb.feed[i]!;
        const fl = mb.flags[i]!;
        if (fl & FLAG_INVERSE_TIME) dt = 0;
        else if (fl & FLAG_PER_REV) {
          const s = Math.abs(mb.spindle[i]!);
          dt = f > 0 && s > 0 ? (dl / (f * s)) * 60 : 0;
        } else dt = f > 0 ? (dl / f) * 60 : 0;
        this.feedLen += dl;
        this.feedTime += dt;
        if (acc) acc.feedLength += dl;
      }
      mb.time[i] = mb.time[i]! + dt;
      if (acc) acc.time += dt;
    });
    // 끝난 위치도 고친다(build 뒤에 쓰지 않지만 일관되게)
    for (let a = 0; a < 3; a++) if (this.machHigh & (1 << a)) this.pos[a] = safe[a]!;
  }

  /** 모델로 마무리 */
  protected build(o: { name: string; format: NcProgram['format']; dialect: NcDialect; blocks: number; stock?: Box3 }): NcProgram {
    this.fixMachine();
    const { moves, arcs, holes } = this.mb.finish();
    const all = emptyBox();
    const cut = emptyBox();
    const pts = moves.points;
    const s = [0, 0, 0];
    const e = [0, 0, 0];
    const c = [0, 0, 0];
    for (let i = 0; i < moves.count; i++) {
      // 기계 좌표 쪽 추정 이동(안전 높이)은 범위에 넣지 않는다
      if (moves.flags[i]! & FLAG_MACHINE_EST) continue;
      const k = i * 3;
      s[0] = pts[k]!;
      s[1] = pts[k + 1]!;
      s[2] = pts[k + 2]!;
      e[0] = pts[k + 3]!;
      e[1] = pts[k + 4]!;
      e[2] = pts[k + 5]!;
      const kind = moves.kind[i]!;
      if (kind === MOVE_ARC) {
        const ai = moves.arc[i]!;
        c[0] = arcs.center[ai * 3]!;
        c[1] = arcs.center[ai * 3 + 1]!;
        c[2] = arcs.center[ai * 3 + 2]!;
        arcExtend(s, e, c, arcs.plane[ai]!, arcs.sweep[ai]!, all);
        arcExtend(s, e, c, arcs.plane[ai]!, arcs.sweep[ai]!, cut);
      } else {
        extendBox(all, s[0], s[1], s[2]);
        extendBox(all, e[0], e[1], e[2]);
        if (kind !== MOVE_RAPID) {
          extendBox(cut, s[0], s[1], s[2]);
          extendBox(cut, e[0], e[1], e[2]);
        }
      }
    }
    const tools: NcTool[] = [];
    for (const t of this.tools.values()) {
      if (t.number < 0 && t.moveCount === 0) continue;
      const info = this.toolInfo.get(t.number);
      if (info?.diameter !== undefined) t.diameter = info.diameter;
      if (info?.name !== undefined) t.name = info.name;
      tools.push(t);
    }
    // 주석·공구 정의에만 있고 쓰이지 않은 공구도 목록에(이동 0)
    for (const [n, info] of this.toolInfo)
      if (!this.tools.has(n)) tools.push({ number: n, ...info, firstLine: -1, moveCount: 0, feedLength: 0, rapidLength: 0, time: 0 });
    tools.sort((a, b) => (a.firstLine < 0 ? 1e15 : a.firstLine) - (b.firstLine < 0 ? 1e15 : b.firstLine) || a.number - b.number);
    const prog: NcProgram = {
      name: o.name,
      format: o.format,
      dialect: o.dialect,
      units: this.displayInch ? 'inch' : 'mm',
      source: this.src,
      moves,
      arcs,
      holes,
      tools,
      stats: {
        moveCount: moves.count,
        rapidLength: this.rapidLen,
        feedLength: this.feedLen,
        arcCount: arcs.count,
        holeCount: holes.count,
        toolChanges: this.toolChanges,
        time: this.rapidTime + this.feedTime + this.dwellTime,
        rapidTime: this.rapidTime,
        feedTime: this.feedTime,
        dwellTime: this.dwellTime,
        blocks: o.blocks,
        rapidFeed: this.rapidFeed,
      },
      warnings: this.w.list(),
    };
    const b = boxOf(all);
    if (b) prog.bounds = b;
    const fb = boxOf(cut);
    if (fb) prog.feedBounds = fb;
    if (o.stock) prog.stock = o.stock;
    if (this.compEvents.length) {
      const runs = this.compRuns(moves.count);
      if (runs.length) prog.compRuns = runs;
    }
    if (this.latheMode) prog.lathe = true;
    if (this.sawRotary) prog.rotaryAxes = true;
    if (this.notices.length) prog.notices = this.notices.slice();
    return prog;
  }
}
