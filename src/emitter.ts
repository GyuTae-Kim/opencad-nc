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
  FLAG_CYCLE,
  FLAG_INVERSE_TIME,
  FLAG_MACHINE,
  FLAG_MACHINE_EST,
  FLAG_PER_REV,
  FLAG_START_EST,
  FLAG_TOOL_LENGTH,
  MOVE_ARC,
  MOVE_FEED,
  MOVE_RAPID,
  MoveBuilder,
  NcWarnings,
  SplineBuilder,
  PLANE_AXES,
  arcExtend,
  arcLength,
  arcPoints,
  boxOf,
  emptyBox,
  extendBox,
  toolInfoFromComment,
  type NcCompRun,
  type NcDialect,
  type NcMachineOptions,
  type NcNotice,
  type NcPlane,
  type NcProgram,
  type NcRotaryOptions,
  type NcTool,
} from './model';

/** 쌓는 중인 스플라인 곡선: 첫 이동 번호, 지금까지 쌓은 조각 끝 매개변수(첫 값 = 곡선 시작), 조각을 그대로 쌓지 못했는지 */
export interface SplineRec {
  move: number;
  params: number[];
  bad: boolean;
}

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
  /** 선반 모드만: 공구 방향과 그 출처, 앱 선반 공구 표 열쇠 */
  tip?: CompTip;
}

/** 선반 반경 보정의 공구 끝: 앱 선반 공구 표 열쇠(공구 번호)와 공구 방향(LinuxCNC 0~9, 모르면 없음) */
export interface CompTip {
  tool: number;
  orientation?: number;
  source?: string;
}

const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2 };

export type { CornerKind } from './corner';

/** 마지막으로 넣은 이동(출력 좌표) — 모서리 다듬기·접선 원호가 쓴다 */
interface LastSeg {
  i: number;
  kind: number;
  s: [number, number, number];
  e: [number, number, number];
  arc: number;
  /** 이 이동의 움직임 시간(공구 교환 시간 빼고) */
  t: number;
}
import type { NcSource } from './text';
import { cornerCut, cornerElem, type CornerKind } from './corner';


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
  /** 찾지 못한 프로그램(다른 파일에 있을 부프로그램 — 함께 열면 읽는다) */
  private missingPrograms = new Set<string>();

  /** 부른 프로그램을 찾지 못함: 경고(줄과 함께)를 남기고 이름을 모아 화면 띠로 알린다 */
  protected missingProgram(name: string, msg: string, line: number): void {
    this.w.add(msg, line);
    if (this.missingPrograms.size < 20) this.missingPrograms.add(name);
  }

  // ── 안전 확인(공구 길이 보정·주축·급속 깊이) ──
  /** H·D 번호가 공구 번호와 다르면 경고(기본 켬) */
  protected checkNumbers = true;
  /** 공구 길이 보정을 확인할지(G-code 밀링만) */
  protected checkTlc = false;
  /** 프로그램 어디선가 공구 길이 보정을 썼는지 */
  private tlcAny = false;
  /** 지금 공구로 바꾼 뒤 공구 길이 보정을 했는지 */
  private tlcTool = false;
  /** 공구 길이 보정 없이 절삭한 공구(첫 줄) — 끝에 tlcAny면 경고 */
  private noTlcCut = new Map<number, number>();
  /** 주축이 멈춘 채 절삭한 공구(첫 줄) — 끝에 주축을 돌린 적이 있으면 경고 */
  private stoppedCut = new Map<number, number>();
  private spindleSeen = false;
  /** 주축 확인을 할지(GRBL 레이저 M3 S0 등은 끔) */
  protected checkSpindle = true;
  private warnedNumber = new Set<string>();

  // ── 기계 설정(급속 속도·공구 교환 시간·도그레그·허용 범위) ──
  protected toolChangeSec = 0;
  private changeTime = 0;
  /** 아직 이동이 없어 넣지 못한 공구 교환 시간 */
  private pendingTime = 0;
  protected dogleg = false;
  private inDogleg = false;
  /** 시간 계산에 쓸 길이(도그레그: 가장 긴 축 이동, -1 = 이동 길이) */
  private timeLen = -1;
  private limits: { min: (number | null)[]; max: (number | null)[] } | null = null;
  /** 앱 선반 공구 표(표시 단위 — 공구 번호 → 노즈 반지름·공구 방향). 선반 반경 보정에서 파일에 값이 없을 때만 */
  protected latheTools: Map<number, { radius?: number; orientation?: number }> | null = null;

  /**
   * 기계 설정을 지금 표시 단위로(해석기가 단위를 정한 뒤 부른다): 급속 속도·공구 교환 시간·도그레그·허용 범위.
   * 기계 오프셋·기준점은 표시 단위로 돌려준다(해석기가 기계 좌표 쪽 이동에 쓴다)
   */
  protected applyMachine(m: NcMachineOptions | undefined): { offset?: [number, number, number]; reference?: [number, number, number] } {
    if (!m) return {};
    const k = this.displayInch ? 1 / 25.4 : 1;
    if (m.rapidFeedMm && m.rapidFeedMm > 0) this.rapidFeed = m.rapidFeedMm * k;
    if (m.toolChangeSec && m.toolChangeSec > 0) this.toolChangeSec = m.toolChangeSec;
    this.dogleg = !!m.dogleg;
    if (m.limitsMm) {
      const f = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : v * k);
      this.limits = { min: [0, 1, 2].map((a) => f(m.limitsMm!.min[a])), max: [0, 1, 2].map((a) => f(m.limitsMm!.max[a])) };
    }
    if (m.latheToolsMm) {
      for (const [key, t] of Object.entries(m.latheToolsMm)) {
        const n = Number(key);
        if (!Number.isInteger(n) || n < 0 || !t) continue;
        const e: { radius?: number; orientation?: number } = {};
        if (typeof t.radiusMm === 'number' && Number.isFinite(t.radiusMm)) e.radius = t.radiusMm * k;
        if (typeof t.orientation === 'number' && Number.isInteger(t.orientation) && t.orientation >= 0 && t.orientation <= 9) e.orientation = t.orientation;
        if (e.radius !== undefined || e.orientation !== undefined) (this.latheTools ??= new Map()).set(n, e);
      }
    }
    const conv = (v: [number, number, number] | undefined): [number, number, number] | undefined => (v ? [v[0] * k, v[1] * k, v[2] * k] : undefined);
    return { offset: conv(m.offsetMm), reference: conv(m.referenceMm) };
  }

  /** 축별 허용 범위(표시 좌표) 밖으로 가는 이동을 경고(축·방향마다 한 문구, 줄은 모두 남긴다). 기계 좌표 쪽 추정 이동은 빼고 */
  private checkLimits(x: number, y: number, z: number, line: number, extraFlags: number): void {
    const lim = this.limits!;
    if (this.machHigh !== 0 || extraFlags & FLAG_MACHINE_EST) return;
    const v = [x, y, z];
    const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);
    for (let a = 0; a < 3; a++) {
      const lo = lim.min[a];
      const hi = lim.max[a];
      const ax = 'XYZ'[a]!;
      if (lo !== null && lo !== undefined && v[a]! < lo - 1e-9) this.w.add(`${ax}가 허용 범위 최솟값 ${fmt(lo)}보다 작은 곳으로 이동`, line);
      if (hi !== null && hi !== undefined && v[a]! > hi + 1e-9) this.w.add(`${ax}가 허용 범위 최댓값 ${fmt(hi)}보다 큰 곳으로 이동`, line);
    }
  }

  /** 급속을 도그레그로: 모든 축이 같은 속도로 함께 가다 짧은 축부터 멈춘다(조각마다 가장 긴 축 이동으로 시간) */
  private emitDogleg(x: number, y: number, z: number, line: number, extraFlags: number): boolean {
    const p = this.pos;
    const target = [x, y, z];
    const rem = [x - p[0]!, y - p[1]!, z - p[2]!];
    const cur = [p[0]!, p[1]!, p[2]!];
    let any = false;
    this.inDogleg = true;
    for (let guard = 0; guard < 3; guard++) {
      const mags = rem.map(Math.abs).filter((v) => v > 1e-9);
      if (!mags.length) break;
      const m = Math.min(...mags);
      const last = mags.every((v) => v - m <= 1e-9);
      const next = cur.map((c, a) => (last ? target[a]! : Math.abs(rem[a]!) > 1e-9 ? c + Math.sign(rem[a]!) * m : c));
      this.timeLen = m;
      any = this.emit(MOVE_RAPID, next[0]!, next[1]!, next[2]!, line, extraFlags) || any;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(rem[a]!) > 1e-9) rem[a] = rem[a]! - Math.sign(rem[a]!) * m;
        cur[a] = next[a]!;
      }
      if (last) break;
    }
    this.timeLen = -1;
    this.inDogleg = false;
    return any;
  }

  // ── 이동마다 남기는 모달 상태(화면의 현재 블록 표시) ──
  /** 켜진 공구 길이 보정 H 번호(-1 = 없음) */
  protected hNum = -1;
  /** 켜진 반경 보정 D 번호(-1 = 없음) */
  protected dNum = -1;
  /** 모달 상태 비트(MODAL_* + 위 8비트 사이클 G 번호) — 해석기가 덮어쓴다 */
  protected modalState(): number {
    return 0;
  }

  /** G43/G44(h = H 번호) — 공구 바꾼 뒤 보정 했음, H≠T면 경고 */
  protected noteToolLength(h: number | undefined, line: number): void {
    this.tlcAny = true;
    this.tlcTool = true;
    if (h !== undefined) this.hNum = h;
    if (h !== undefined && h !== 0) this.checkToolNumber('H', h, line);
  }

  /** H·D 번호 ≠ 공구 번호면 경고(공구마다 한 번) */
  protected checkToolNumber(letter: 'H' | 'D', n: number, line: number): void {
    const t = this.tool;
    if (!this.checkNumbers || t < 0 || t >= 100000 || n === t) return;
    const key = `${letter}${n}T${t}`;
    if (this.warnedNumber.has(key)) return;
    this.warnedNumber.add(key);
    this.w.add(`T${t}인데 ${letter === 'H' ? '공구 길이 보정' : '반경 보정'}이 ${letter}${n} — 번호가 맞는지 확인하십시오`, line);
  }

  /** 절삭 이동 하나의 안전 확인(공구 길이 보정·주축) */
  private safetyCut(line: number): void {
    const t = this.tool;
    if (this.checkTlc && !this.tlcTool && t >= 0 && !this.noTlcCut.has(t)) this.noTlcCut.set(t, line);
    if (this.checkSpindle && (this.spindleDir === 0 || !(this.speed > 0)) && !this.stoppedCut.has(t)) this.stoppedCut.set(t, line);
  }

  /** 끝에서: 모아 둔 안전 확인 경고 */
  private safetyFinish(): void {
    if (this.tlcAny) for (const [t, line] of this.noTlcCut) this.w.add(`T${t}: 공구 교환 뒤 공구 길이 보정(G43 H) 없이 절삭`, line);
    if (this.spindleSeen) for (const [t, line] of this.stoppedCut) this.w.add(`${t >= 0 && t < 100000 ? `T${t}: ` : ''}주축이 멈춘 채(M5·S0) 절삭 이동`, line);
  }
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
    if (this.corner) {
      // 뒤 요소가 원호면 다듬은 만큼 줄어든 길이가 돌아온다
      const l = this.applyCorner(kind, x, y, z, extraFlags, arcIdx);
      if (l >= 0) arcLen = l;
    }
    if (this.rotAxis !== null && !this.rotOff && this.rotActive()) return this.emitRot(kind, x, y, z, line, extraFlags, arcIdx, arcLen);
    // 도그레그 급속(여러 축이 함께 움직이는 급속, 위치를 알 때만)
    if (this.dogleg && !this.inDogleg && kind === MOVE_RAPID && arcIdx < 0 && this.known === 7 && this.machHigh === 0 && this.machPending === 0 && !(extraFlags & FLAG_MACHINE)) {
      const d = [x - this.pos[0]!, y - this.pos[1]!, z - this.pos[2]!].filter((v) => Math.abs(v) > 1e-9);
      if (d.length >= 2 && new Set(d.map((v) => Math.abs(v).toFixed(9))).size > 1) return this.emitDogleg(x, y, z, line, extraFlags);
    }
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
    const sx = p[0]!;
    const sy = p[1]!;
    const sz = p[2]!;
    p[0] = x;
    p[1] = y;
    p[2] = z;
    if (len < 1e-12) return false;
    const wcs = extraFlags & FLAG_MACHINE ? 255 : this.wcs;
    const sp = this.spindleDir === 4 ? -this.speed : this.spindleDir === 3 ? this.speed : 0;
    const i = this.mb.push(kind, x, y, z, line, this.tool, this.feed, sp, this.flags() | extraFlags, wcs, arcIdx, this.modalState(), this.tlc ? this.hNum : -1, this.comp ? this.dNum : -1);
    const endHigh = this.machHigh;
    let est = false;
    if (endHigh !== 0 || this.machLast !== 0) {
      // 추정 높이에 닿거나 머무는 이동·거기서 출발한 급속은 추정 이동. 거기서 출발한 이송·호·드릴은 보통 이동(출발점만 추정)
      est = endHigh !== 0 || kind === MOVE_RAPID;
      // FLAG_START_EST = 출발점만 추정(끝점은 실제) — 추정 높이에서 출발한 급속은 추정 묶음이지만 끝점은 범위·급속 깊이 확인에 넣는다
      this.mb.flags[i] = this.mb.flags[i]! | (est ? FLAG_MACHINE_EST : 0) | (endHigh === 0 ? FLAG_START_EST : 0);
      if (endHigh !== 0) this.machFix.push(i + 1, endHigh);
      this.machLast = endHigh;
    }
    if (!est && kind !== MOVE_RAPID) this.safetyCut(line);
    if (this.spindleDir !== 0) this.spindleSeen = true;
    const sm = this.seenMax;
    if (x > sm[0]! && !(endHigh & 1)) sm[0] = x;
    if (y > sm[1]! && !(endHigh & 2)) sm[1] = y;
    if (z > sm[2]! && !(endHigh & 4)) sm[2] = z;
    let t = 0;
    const acc = this.toolAcc();
    if (acc.firstLine < 0) acc.firstLine = line;
    acc.moveCount++;
    if (kind === MOVE_RAPID) {
      t = ((this.timeLen >= 0 ? this.timeLen : len) / this.rapidFeed) * 60;
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
    this.mb.time[i] = t + this.pendingTime;
    this.pendingTime = 0;
    // 마지막 이동(모서리 다듬기·접선 원호용) — 이동마다 새 객체를 만들지 않는다(100만 줄도 빠르게)
    const ls = this.lastSeg ?? (this.lastSeg = { i, kind, s: [0, 0, 0], e: [0, 0, 0], arc: arcIdx, t });
    ls.i = i;
    ls.kind = kind;
    ls.s[0] = sx;
    ls.s[1] = sy;
    ls.s[2] = sz;
    ls.e[0] = x;
    ls.e[1] = y;
    ls.e[2] = z;
    ls.arc = arcIdx;
    ls.t = t;
    if (this.limits) this.checkLimits(x, y, z, line, extraFlags);
    return true;
  }

  // ───────────── 모서리 다듬기(Heidenhain RND·CHF, Siemens RND·RNDM·CHF·CHR)와 접선 원호(Siemens CT) ─────────────

  /** 마지막으로 넣은 이동(출력 좌표) */
  protected lastSeg: LastSeg | null = null;
  /** 예약한 모서리 다듬기: 앞 이동(i)의 끝 모서리를 다음 직선·원호 이송과 잇는다 */
  private corner: { kind: CornerKind; size: number; line: number; plane: number; i: number; feed?: number; label: string; linesOnly: boolean } | null = null;

  /**
   * 바로 앞 이동(직선·원호 이송)의 끝 모서리를 다음 직선·원호 이송과 둥글리기·모따기로 잇게 예약한다. 다음 이동을 넣을 때 앞 이동 끝을
   * 접점까지 줄이고 둥근 호(또는 모따기 직선)를 넣은 뒤 다음 이동을 접점에서 시작한다(프로그램 위치는 모서리 그대로 —
   * 증분 좌표의 기준이 바뀌지 않는다. 원호의 중심도 그대로). size는 프로그램 단위(좌표 변환의 배율을 곱한다), 0이면 모서리 그대로.
   * linesOnly(Heidenhain CHF·DIN/ISO G24 — 두 직선 사이에만 쓰는 모따기)면 원호와 만나는 모서리는 그대로 둔다.
   * 작업 평면 밖으로 움직이는 모서리(나선 포함)·앞뒤 요소보다 큰 값은 경고하고 모서리 그대로 둔다.
   */
  protected requestCorner(kind: CornerKind, size: number, line: number, plane: number, label: string, feed?: number, linesOnly = false): void {
    this.corner = null;
    if (!(size > 0)) return;
    const seg = this.lastSeg;
    if (!seg || seg.i !== this.mb.count - 1) {
      this.w.add(`${label}: 앞에 이동이 없어 그리지 않음`, line);
      return;
    }
    const prevArc = seg.kind === MOVE_ARC && seg.arc >= 0;
    if (!prevArc && (seg.kind !== MOVE_FEED || seg.arc >= 0)) {
      this.w.add(`${label}: 급속·구멍 이동 뒤 모서리는 그대로 그림`, line);
      return;
    }
    if (prevArc && linesOnly) {
      this.w.add(`${label}: 두 직선 사이에만 쓰는 모따기라 원호와 만나는 모서리는 그대로 그림`, line);
      return;
    }
    const scale = this.outXf ? affinePlane(this.outXf, plane).scale : 1;
    this.corner = { kind, size: size * scale, line, plane, i: seg.i, label, linesOnly, ...(feed !== undefined && feed > 0 ? { feed } : {}) };
  }

  /**
   * 예약한 모서리를 다음 이동(출력 좌표)과 함께 그린다 — emit의 앞머리에서 부른다. 다음 이동이 원호라 시작점을 접점으로 옮겼으면
   * 그 원호의 새 길이를, 아니면 -1을 돌려준다
   */
  private applyCorner(kind: number, x: number, y: number, z: number, extraFlags: number, arcIdx: number): number {
    const c = this.corner!;
    this.corner = null;
    const seg = this.lastSeg;
    if (!seg || seg.i !== c.i || seg.i !== this.mb.count - 1 || this.mb.tool[seg.i] !== this.tool) return -1;
    const nextArc = kind === MOVE_ARC && arcIdx >= 0;
    if (extraFlags & (FLAG_MACHINE | FLAG_CYCLE) || (!nextArc && (kind !== MOVE_FEED || arcIdx >= 0))) {
      this.w.add(`${c.label}: 뒤 요소가 직선·원호 이송이 아닌 모서리는 그대로 그림`, c.line);
      return -1;
    }
    if (nextArc && c.linesOnly) {
      this.w.add(`${c.label}: 두 직선 사이에만 쓰는 모따기라 원호와 만나는 모서리는 그대로 그림`, c.line);
      return -1;
    }
    if (this.rotAxis !== null && !this.rotOff && this.rotActive()) {
      this.w.add(`${c.label}: 회전축을 감는 동안의 모서리는 그대로 그림`, c.line);
      return -1;
    }
    const [a0, a1, a2] = PLANE_AXES[c.plane] ?? PLANE_AXES[0]!;
    const S = seg.s;
    const P = seg.e;
    const E = [x, y, z];
    const tol = 1e-7 * Math.max(1, Math.abs(P[a2]!));
    const prevArc = seg.arc >= 0;
    if (
      Math.abs(P[a2]! - S[a2]!) > tol ||
      Math.abs(E[a2]! - P[a2]!) > tol ||
      (prevArc && this.mb.arcPlane[seg.arc] !== c.plane) ||
      (nextArc && this.mb.arcPlane[arcIdx] !== c.plane)
    ) {
      this.w.add(`${c.label}: 작업 평면 밖으로 움직이는 모서리는 그대로 그림`, c.line);
      return -1;
    }
    if (prevArc || nextArc) return this.arcCorner(c, seg, E, arcIdx, a0, a1);
    const l1 = Math.hypot(P[a0]! - S[a0]!, P[a1]! - S[a1]!);
    const l2 = Math.hypot(E[a0]! - P[a0]!, E[a1]! - P[a1]!);
    if (l1 < 1e-9 || l2 < 1e-9) return -1;
    const u1 = [(P[a0]! - S[a0]!) / l1, (P[a1]! - S[a1]!) / l1];
    const u2 = [(E[a0]! - P[a0]!) / l2, (E[a1]! - P[a1]!) / l2];
    const cr = u1[0]! * u2[1]! - u1[1]! * u2[0]!;
    const th = Math.atan2(Math.abs(cr), u1[0]! * u2[0]! + u1[1]! * u2[1]!);
    // 곧게 이어지면 다듬을 모서리가 없다
    if (th < 1e-6) return -1;
    if (Math.PI - th < 1e-6) {
      this.w.add(`${c.label}: 되돌아가는 모서리는 그대로 그림`, c.line);
      return -1;
    }
    const d = c.kind === 'round' ? c.size * Math.tan(th / 2) : c.kind === 'chamferLeg' ? c.size : c.size / (2 * Math.cos(th / 2));
    if (d > l1 * (1 + 1e-9) + 1e-9 || d > l2 * (1 + 1e-9) + 1e-9) {
      this.w.add(`${c.label}: 값이 앞뒤 요소보다 커서 모서리 그대로 그림`, c.line);
      return -1;
    }
    const t1 = [P[0]!, P[1]!, P[2]!];
    const t2 = [P[0]!, P[1]!, P[2]!];
    t1[a0] = P[a0]! - u1[0]! * d;
    t1[a1] = P[a1]! - u1[1]! * d;
    t2[a0] = P[a0]! + u2[0]! * d;
    t2[a1] = P[a1]! + u2[1]! * d;
    this.trimLast(t1);
    const feed0 = this.feed;
    if (c.feed !== undefined) this.feed = c.feed;
    if (c.kind === 'round') {
      // 중심: 접점에서 도는 쪽(왼쪽으로 돌면 왼쪽 법선)으로 반지름만큼
      const sg = cr > 0 ? 1 : -1;
      const ctr = [t1[0]!, t1[1]!, t1[2]!];
      ctr[a0] = t1[a0]! - u1[1]! * c.size * sg;
      ctr[a1] = t1[a1]! + u1[0]! * c.size * sg;
      this.emitArc(c.plane, ctr, sg * th, t2[0]!, t2[1]!, t2[2]!, c.line);
    } else this.emit(MOVE_FEED, t2[0]!, t2[1]!, t2[2]!, c.line);
    this.feed = feed0;
    return -1;
  }

  /**
   * 원호가 낀 모서리(직선-원호·원호-직선·원호-원호, 작업 평면 안). Heidenhain RND·Siemens RND/RNDM은 두 요소에 접하는 원호,
   * Siemens CHR은 모서리에서 두 요소 위로 같은 거리(현 길이)인 두 점을 잇는 직선, CHF는 그 직선의 길이가 값이 되게 거리를 맞춘다.
   * 둥글리기 중심 = 두 요소를 도는 쪽으로 반지름만큼 옮긴 선·원의 교점 가운데 모서리에 가까운 것. 원호의 중심은 그대로 두고
   * 앞 원호는 끝을, 뒤 원호는 시작을 접점으로 옮긴다(기하는 corner.ts — MPR 윤곽 KR·KF와 함께 쓴다)
   */
  private arcCorner(c: NonNullable<NcEmitter["corner"]>, seg: LastSeg, E: readonly number[], arcIdx: number, a0: number, a1: number): number {
    const mb = this.mb;
    const P = seg.e;
    const arcOf = (ai: number): { cx: number; cy: number; sweep: number } | null =>
      ai < 0 ? null : { cx: mb.arcCenter[ai * 3 + a0]!, cy: mb.arcCenter[ai * 3 + a1]!, sweep: mb.arcSweep[ai]! };
    const A = cornerElem(seg.s[a0]!, seg.s[a1]!, P[a0]!, P[a1]!, arcOf(seg.arc));
    const B = cornerElem(P[a0]!, P[a1]!, E[a0]!, E[a1]!, arcOf(arcIdx));
    if (!A || !B) return -1;
    const cut = cornerCut(A, B, P[a0]!, P[a1]!, c.kind, c.size);
    if (!cut.ok) {
      if (cut.reason === 'reverse') this.w.add(`${c.label}: 되돌아가는 모서리는 그대로 그림`, c.line);
      else if (cut.reason === 'too-big') this.w.add(`${c.label}: 값이 앞뒤 요소보다 커서 모서리 그대로 그림`, c.line);
      return -1;
    }
    const to3 = (q: readonly [number, number]): number[] => {
      const v = [P[0]!, P[1]!, P[2]!];
      v[a0] = q[0];
      v[a1] = q[1];
      return v;
    };
    const t1 = to3(cut.t1);
    const t2 = to3(cut.t2);
    this.trimLast(t1, A.arc ? A.dir * cut.angA : undefined);
    const feed0 = this.feed;
    if (c.feed !== undefined) this.feed = c.feed;
    if (cut.fillet) this.emitArc(c.plane, to3([cut.fillet.cx, cut.fillet.cy]), cut.fillet.sweep, t2[0]!, t2[1]!, t2[2]!, c.line);
    else this.emit(MOVE_FEED, t2[0]!, t2[1]!, t2[2]!, c.line);
    this.feed = feed0;
    if (!B.arc) return -1;
    // 뒤 원호: 중심 그대로, 접점에서 끝까지
    const rest = B.dir * (Math.abs(B.sweep) - cut.angB);
    mb.arcSweep[arcIdx] = rest;
    const ctr = [mb.arcCenter[arcIdx * 3]!, mb.arcCenter[arcIdx * 3 + 1]!, mb.arcCenter[arcIdx * 3 + 2]!];
    return arcLength(this.pos, E, ctr, c.plane, rest);
  }

  /** 마지막 이동의 끝을 n(출력 좌표)으로 줄인다: 길이·시간도 줄인 만큼 덜고 지금 자리를 n으로. 원호면 새 중심각(sweep)도 */
  private trimLast(n: readonly number[], sweep?: number): void {
    const seg = this.lastSeg!;
    const i = seg.i;
    let oldLen: number;
    let newLen: number;
    if (seg.arc >= 0 && sweep !== undefined) {
      const a = seg.arc;
      const ctr = [this.mb.arcCenter[a * 3]!, this.mb.arcCenter[a * 3 + 1]!, this.mb.arcCenter[a * 3 + 2]!];
      const plane = this.mb.arcPlane[a]!;
      oldLen = arcLength(seg.s, seg.e, ctr, plane, this.mb.arcSweep[a]!);
      newLen = arcLength(seg.s, n, ctr, plane, sweep);
      this.mb.arcSweep[a] = sweep;
    } else {
      oldLen = Math.hypot(seg.e[0] - seg.s[0], seg.e[1] - seg.s[1], seg.e[2] - seg.s[2]);
      newLen = Math.hypot(n[0]! - seg.s[0], n[1]! - seg.s[1], n[2]! - seg.s[2]);
    }
    const k = (i + 1) * 3;
    this.mb.points[k] = n[0]!;
    this.mb.points[k + 1] = n[1]!;
    this.mb.points[k + 2] = n[2]!;
    const dl = oldLen - newLen;
    const nt = this.feedMode === 93 || oldLen <= 0 ? seg.t : (seg.t * newLen) / oldLen;
    const dt = seg.t - nt;
    const acc = this.toolAcc();
    this.feedLen -= dl;
    this.feedTime -= dt;
    acc.feedLength -= dl;
    acc.time -= dt;
    this.mb.time[i] = this.mb.time[i]! - dt;
    seg.e[0] = n[0]!;
    seg.e[1] = n[1]!;
    seg.e[2] = n[2]!;
    seg.t = nt;
    this.pos[0] = n[0]!;
    this.pos[1] = n[1]!;
    this.pos[2] = n[2]!;
  }

  /** 마지막 이동 끝의 접선(작업 평면 plane의 두 축, 출력 좌표 — 단위 벡터). 모르면 null */
  protected lastTangent(plane: number): [number, number] | null {
    const seg = this.lastSeg;
    if (!seg || seg.i !== this.mb.count - 1) return null;
    const [a0, a1] = PLANE_AXES[plane] ?? PLANE_AXES[0]!;
    if (seg.arc >= 0) {
      if (this.mb.arcPlane[seg.arc] !== plane) return null;
      const du = seg.e[a0]! - this.mb.arcCenter[seg.arc * 3 + a0]!;
      const dv = seg.e[a1]! - this.mb.arcCenter[seg.arc * 3 + a1]!;
      const l = Math.hypot(du, dv);
      if (l < 1e-12) return null;
      return this.mb.arcSweep[seg.arc]! > 0 ? [-dv / l, du / l] : [dv / l, -du / l];
    }
    const du = seg.e[a0]! - seg.s[a0]!;
    const dv = seg.e[a1]! - seg.s[a1]!;
    const l = Math.hypot(du, dv);
    return l < 1e-12 ? null : [du / l, dv / l];
  }

  /**
   * 접선 원호(Siemens CT): 지금 자리에서 앞 요소에 접하며 (x, y, z)(출력 좌표)로 가는 원호. 앞 요소가 없거나 끝점이 접선 위면 직선.
   * 공구 축 쪽 움직임은 나선처럼 함께 간다
   */
  protected emitTangentArc(plane: number, x: number, y: number, z: number, line: number, label: string): void {
    const [a0, a1, a2] = PLANE_AXES[plane] ?? PLANE_AXES[0]!;
    const t = this.lastTangent(plane);
    const S = this.pos;
    const e = [x, y, z];
    if (!t) {
      this.w.add(`${label} 앞에 방향을 정할 요소가 없음 — 직선으로 그림`, line);
      this.emit(MOVE_FEED, x, y, z, line);
      return;
    }
    // 중심 = 시작 + n·k (n = 접선의 왼쪽 법선), |중심 - 끝| = |k|
    const wu = S[a0]! - e[a0]!;
    const wv = S[a1]! - e[a1]!;
    const dot = -t[1] * wu + t[0] * wv;
    if (Math.abs(dot) < 1e-12 * Math.max(1, Math.hypot(wu, wv))) {
      this.emit(MOVE_FEED, x, y, z, line);
      return;
    }
    const k = -(wu * wu + wv * wv) / (2 * dot);
    const cu = S[a0]! - t[1] * k;
    const cv = S[a1]! + t[0] * k;
    const ccw = k > 0;
    const TAU = Math.PI * 2;
    let sweep = Math.atan2(e[a1]! - cv, e[a0]! - cu) - Math.atan2(S[a1]! - cv, S[a0]! - cu);
    if (ccw) while (sweep <= 0) sweep += TAU;
    else while (sweep >= 0) sweep -= TAU;
    const c = [0, 0, 0];
    c[a0] = cu;
    c[a1] = cv;
    c[a2] = S[a2]!;
    this.emitArc(plane, c, sweep, x, y, z, line);
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

  /** 끝에서 축 mask가 추정 안전 높이에 있는 이동(고정 사이클이 추정 높이였던 처음 높이로 돌아갈 때 — build에서 값을 고친다) */
  protected emitToEstimated(mask: number, kind: number, x: number, y: number, z: number, line: number, extraFlags = 0): boolean {
    this.machPending = mask;
    const ok = this.emit(kind, x, y, z, line, extraFlags);
    this.machPending = 0;
    return ok;
  }

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
    const startEst = this.machLast !== 0;
    const estFlag = this.machHigh !== 0 || (startEst && kind === MOVE_RAPID) ? FLAG_MACHINE_EST : 0;
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
    const modal = this.modalState();
    const hN = this.tlc ? this.hNum : -1;
    const dN = this.comp ? this.dNum : -1;
    if (kind !== MOVE_RAPID && !estFlag) this.safetyCut(line);
    if (this.spindleDir !== 0) this.spindleSeen = true;
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
      // 출발점만 추정: 이송은 첫 조각에, 추정 급속은 끝점이 실제인 마지막 조각에 FLAG_START_EST
      const startOnly = startEst && this.machHigh === 0 && (estFlag ? k === n : k === 1);
      const i = this.mb.push(pieceKind, lx, ly, lz, line, this.tool, this.feed, sp, startOnly ? flags | FLAG_START_EST : flags, wcs, -1, modal, hN, dN);
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
  protected noteComp(plane: number, line: number, radius?: number, source = '', d = -1, tip?: CompTip): void {
    const evs = this.compEvents;
    const last = evs[evs.length - 1];
    if (!last && this.comp === 0) return;
    const ev: CompEvent = { move: this.mb.count, side: this.comp, plane, radius, source, d, tool: this.tool, line, ...(tip ? { tip } : {}) };
    const sameTip = (a?: CompTip, b?: CompTip): boolean => a?.tool === b?.tool && a?.orientation === b?.orientation && a?.source === b?.source;
    if (last && last.side === ev.side && last.plane === ev.plane && last.radius === ev.radius && last.d === ev.d && last.tool === ev.tool && sameTip(last.tip, ev.tip)) return;
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
      const run: NcCompRun = { first: ev.move, end, side: ev.side, plane: (ev.plane as NcPlane) ?? 0, radius: radius ?? NaN, source: radius === undefined ? '' : source, line: ev.line };
      if (ev.tip) {
        run.tool = ev.tip.tool;
        if (ev.tip.orientation !== undefined) {
          run.orientation = ev.tip.orientation;
          run.orientationSource = ev.tip.source ?? '';
        }
      }
      out.push(run);
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
    this.tlcTool = false;
    this.toolChanges++;
    if (this.toolChangeSec > 0) {
      this.changeTime += this.toolChangeSec;
      // 공구 교환 시간은 바로 앞 이동 뒤에(재생 시간 축), 아직 이동이 없으면 첫 이동에 붙인다
      if (this.mb.count > 0) this.mb.time[this.mb.count - 1] = this.mb.time[this.mb.count - 1]! + this.toolChangeSec;
      else this.pendingTime += this.toolChangeSec;
    }
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
      const k = i * 3;
      if (mb.flags[i]! & FLAG_START_EST) extendBox(box, pts[k + 3]!, pts[k + 4]!, pts[k + 5]!);
      else if (mb.flags[i]! & FLAG_MACHINE_EST) continue;
      else if (mb.kind[i] === MOVE_ARC && mb.arc[i]! >= 0) {
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

  // ── 스플라인 표(측정용 곡선 정의 — 이동·장면은 그대로) ──
  private splineTable = new SplineBuilder();

  /**
   * 스플라인 곡선을 이송 직선 조각으로 쌓기 전에(u0 = 곡선 시작 매개변수): 조각이 곡선 위 점 그대로 쌓이는 때만 기록을 시작한다.
   * 출력 변환(좌표 변환 사이클)·예약한 모서리 다듬기·회전축 감기·기계 좌표 쪽 추정 높이·첫 이동의 모르는 축이면 null(표에 넣지 않는다)
   */
  protected splineBegin(u0: number): SplineRec | null {
    if (this.outXf || this.corner || (this.rotAxis !== null && !this.rotOff && this.rotActive())) return null;
    if (this.machHigh !== 0 || this.machPending !== 0 || this.machLast !== 0 || (this.known !== 7 && this.mb.count === 0)) return null;
    return { move: this.mb.count, params: [u0], bad: false };
  }

  /** 조각 하나를 emit한 뒤(u = 그 조각 끝 매개변수): 이동이 하나 늘었으면 매개변수를 남기고, 길이 0으로 빠졌으면 넘어가고, 그 밖이면 버린다 */
  protected splineStep(r: SplineRec | null, u: number): void {
    if (!r || r.bad) return;
    const n = r.move + r.params.length - 1;
    if (this.mb.count === n + 1) r.params.push(u);
    else if (this.mb.count !== n) r.bad = true;
  }

  /** 곡선을 다 쌓았다: 차수·매듭·조정점 xyz(표시 좌표)·가중치와 함께 표에 넣는다(조각이 하나도 없거나 버렸으면 넣지 않는다) */
  protected splineEnd(r: SplineRec | null, degree: number, knots: readonly number[], ctrl: readonly number[], weight: readonly number[]): void {
    if (!r || r.bad || r.params.length < 2) return;
    this.splineTable.add(r.move, degree, knots, ctrl, weight, r.params);
  }

  /** 모델로 마무리 */
  protected build(o: { name: string; format: NcProgram['format']; dialect: NcDialect; blocks: number; stock?: Box3 }): NcProgram {
    this.fixMachine();
    const { moves, arcs, holes } = this.mb.finish();
    const all = emptyBox();
    const cut = emptyBox();
    // 공구별 절삭 범위와 가장 깊은 절삭 줄
    const toolBox = new Map<number, { box: Float64Array; minZ: number; line: number }>();
    const pts = moves.points;
    const s = [0, 0, 0];
    const e = [0, 0, 0];
    const c = [0, 0, 0];
    for (let i = 0; i < moves.count; i++) {
      // 기계 좌표 쪽 추정 이동(안전 높이)은 범위에 넣지 않는다
      const k = i * 3;
      if (moves.flags[i]! & FLAG_MACHINE_EST) {
        // 추정 높이에서 출발한 급속: 끝점은 실제라 전체 범위에 넣는다
        if (moves.flags[i]! & FLAG_START_EST) extendBox(all, pts[k + 3]!, pts[k + 4]!, pts[k + 5]!);
        continue;
      }
      s[0] = pts[k]!;
      s[1] = pts[k + 1]!;
      s[2] = pts[k + 2]!;
      e[0] = pts[k + 3]!;
      e[1] = pts[k + 4]!;
      e[2] = pts[k + 5]!;
      const kind = moves.kind[i]!;
      // 출발점이 추정 안전 높이인 이동은 끝점만 범위에
      const startEst = (moves.flags[i]! & FLAG_START_EST) !== 0;
      if (startEst) {
        s[0] = e[0];
        s[1] = e[1];
        s[2] = e[2];
      }
      let tb: { box: Float64Array; minZ: number; line: number } | undefined;
      if (kind !== MOVE_RAPID) {
        const t = moves.tool[i]!;
        tb = toolBox.get(t);
        if (!tb) toolBox.set(t, (tb = { box: emptyBox(), minZ: Infinity, line: -1 }));
        const z = Math.min(s[2], e[2]);
        if (z < tb.minZ) {
          tb.minZ = z;
          tb.line = moves.line[i]!;
        }
      }
      if (kind === MOVE_ARC && !startEst) {
        const ai = moves.arc[i]!;
        c[0] = arcs.center[ai * 3]!;
        c[1] = arcs.center[ai * 3 + 1]!;
        c[2] = arcs.center[ai * 3 + 2]!;
        arcExtend(s, e, c, arcs.plane[ai]!, arcs.sweep[ai]!, all);
        arcExtend(s, e, c, arcs.plane[ai]!, arcs.sweep[ai]!, cut);
        arcExtend(s, e, c, arcs.plane[ai]!, arcs.sweep[ai]!, tb!.box);
      } else {
        extendBox(all, s[0], s[1], s[2]);
        extendBox(all, e[0], e[1], e[2]);
        if (tb) {
          extendBox(cut, s[0], s[1], s[2]);
          extendBox(cut, e[0], e[1], e[2]);
          extendBox(tb.box, s[0], s[1], s[2]);
          extendBox(tb.box, e[0], e[1], e[2]);
        }
      }
    }
    // 안전 확인: 공구 길이 보정·주축(모아 둔 것), 급속이 가장 깊은 절삭보다 아래로·공작물 윗면 아래 급속 수평 이동
    this.safetyFinish();
    if (!this.latheMode && cut[2]! <= cut[5]!) {
      const tol = this.displayInch ? 0.0005 : 0.01;
      const minCut = cut[2]!;
      const top = o.stock ? o.stock.max[2] : undefined;
      const fz = (v: number): string => String(Number(v.toFixed(this.displayInch ? 4 : 3)));
      for (let i = 0; i < moves.count; i++) {
        const fl = moves.flags[i]!;
        if (moves.kind[i] !== MOVE_RAPID || (fl & FLAG_MACHINE_EST && !(fl & FLAG_START_EST))) continue;
        const k = i * 3;
        const z1 = pts[k + 5]!;
        const line = moves.line[i]!;
        // 추정 높이에서 출발한 급속은 끝점만 본다(출발 높이는 추정)
        if (fl & FLAG_MACHINE_EST) {
          if (z1 < minCut - tol) this.w.add(`급속 이동이 가장 깊은 절삭(Z${fz(minCut)})보다 아래로 내려감`, line);
          continue;
        }
        const z0 = pts[k + 2]!;
        const xy = Math.hypot(pts[k + 3]! - pts[k]!, pts[k + 4]! - pts[k + 1]!) > tol;
        // 끝이 가장 깊은 절삭보다 아래거나, 그 아래에서 옆으로 움직이는 급속(곧장 올라오는 것은 앞 이동의 결과라 세지 않음)
        if (z1 < minCut - tol || (z0 < minCut - tol && xy)) this.w.add(`급속 이동이 가장 깊은 절삭(Z${fz(minCut)})보다 아래로 내려감`, line);
        else if (top !== undefined && !(moves.flags[i]! & FLAG_CYCLE) && Math.max(z0, z1) < top - tol && xy) this.w.add(`공작물 윗면(Z${fz(top)})보다 낮은 높이에서 급속 수평 이동`, line);
      }
    }
    const tools: NcTool[] = [];
    for (const t of this.tools.values()) {
      if (t.number < 0 && t.moveCount === 0) continue;
      const info = this.toolInfo.get(t.number);
      if (info?.diameter !== undefined) t.diameter = info.diameter;
      if (info?.name !== undefined) t.name = info.name;
      const tb = toolBox.get(t.number);
      if (tb && tb.box[0]! <= tb.box[3]!) {
        t.cutMin = [tb.box[0]!, tb.box[1]!, tb.box[2]!];
        t.cutMax = [tb.box[3]!, tb.box[4]!, tb.box[5]!];
        t.minZLine = tb.line;
      }
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
        time: this.rapidTime + this.feedTime + this.dwellTime + this.changeTime,
        rapidTime: this.rapidTime,
        feedTime: this.feedTime,
        dwellTime: this.dwellTime,
        toolChangeTime: this.changeTime,
        blocks: o.blocks,
        rapidFeed: this.rapidFeed,
      },
      warnings: this.w.list(),
      warningItems: this.w.items(),
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
    if (this.missingPrograms.size) this.notices.push({ kind: 'missing-program', programs: [...this.missingPrograms] });
    if (this.notices.length) prog.notices = this.notices.slice();
    const splines = this.splineTable.finish();
    if (splines) prog.splines = splines;
    return prog;
  }
}
