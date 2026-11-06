/**
 * Heidenhain 평문(Klartext, .h) 해석기 — 자주 쓰는 것만.
 *
 * 지원: BEGIN/END PGM(단위), BLK FORM 0.1/0.2(공작물 상자), TOOL DEF(반지름 → 지름), TOOL CALL(번호·이름, 축, S, F),
 * L(FMAX·F·R0/RL/RR·M), CC(극), C(DR±), CR(R±), CT(접선 호), LP·CP(극좌표, IPA 나선), Q 변수(Qn = 식, FN 0~8),
 * CYCL DEF 200·201·202·203·205·240·206·207·209·1(드릴 계열)과 CYCL CALL·M99·M89, CYCL DEF 7(원점 이동),
 * 밀링 사이클 208(보어 밀링 나선)·251(사각 포켓)·252(원 포켓)·253(홈)·256(사각 보스)·257(원 보스)·232(정면 밀링),
 * SL 사이클(48차) 14 윤곽·20 윤곽 자료·21 예비 드릴·22 거친 깎기·23 바닥 다듬질·24 옆면 다듬질(윤곽 부프로그램을 읽어 포켓 − 섬 면을 깎는 길 — sl.ts),
 * FK 자유 윤곽(FPOL·FL·FLT·FC·FCT — 한 블록 안 자료로 정해지는 경우), RL/RR 반경 보정 구간 기록,
 * LBL·CALL LBL REP(구간 반복·부프로그램, 앞쪽 표지 + LBL 0이면 부프로그램), FN 9~12 조건 점프,
 * PATTERN DEF(POS·ROW·PAT·CIRC·PITCHCIRC — 34차, 숨긴 자리 /POS — 36차)와 CYCL CALL PAT(200번대 사이클을 가공 위치마다, GLOBAL DEF 125의 Q345).
 * 근사: RND는 작업 평면 안의 직선·원호 모서리를 접하는 호로, CHF는 두 직선 사이 모서리만 다듬고(원호와 만나면 모서리 그대로, 경고), APPR·DEP는 끝점까지 직선(경고), 포켓 사이클은 동심 윤곽으로 깎는 길(공구 반지름은 TOOL DEF).
 * 좌표 변환: 7 원점 이동·TRANS DATUM AXIS/RESET, 8 대칭, 10 회전, 11 배율, 26 축별 배율(원점 둘레, 출력 변환 — 원호·사이클도 함께).
 * 지원하지 않음: PLANE·19 기울인 평면, 윤곽 트레인 25·270 등 다른 윤곽 사이클, 다음 블록 자료가 필요한 FK, PATTERN DEF FRAME·SEL PATTERN 점 표(경고).
 */
import { affinePlane, applyAffine, composeAffine, diagAbout, invertAffine, isIdentityAffine, rotAbout, translateAffine, ZERO3, type Affine } from './affine';
import { NcEmitter } from './emitter';
import { ExprError, evalMprExpr } from './expr';
import { FLAG_CYCLE, FLAG_MACHINE, MODAL_XF, MOVE_DRILL, MOVE_FEED, MOVE_RAPID, PLANE_AXES, type NcMachineOptions, type NcPlane, type NcProgram } from './model';

const TAU = Math.PI * 2;
import type { Box3 } from 'opencad-viewer3d/types';
import { makeSource, sourceLine, type NcSource } from './text';
import { isSource, jobFileLines, PECK_MAX } from './gcode';
import { g7xCorners, g7xLine, type G7xCorner } from './lathe-g7x';
import {
  slArea,
  slElLen,
  slInside,
  slIsPocket,
  slLevels,
  slNear,
  slOffset,
  slOrder,
  slRegion,
  slReverse,
  slRound,
  slSegmentFree,
  slStartLongest,
  slTanAt,
  slTrain,
  type SlLoop,
} from './sl';

export interface HeidenhainOptions {
  name?: string;
  /** 급속 속도(표시 단위/분, 기본 mm 10000 · inch 400) */
  rapidFeed?: number;
  /** 시작 위치 */
  initialPosition?: [number, number, number];
  /** 실행 블록 수 한도 */
  maxBlocks?: number;
  maxMoves?: number;
  /** 반경 보정·포켓 사이클용 공구 표(표시 단위, 키 = 공구 번호). 없으면 TOOL DEF R + TOOL CALL DR */
  toolTable?: Record<number, { diameter?: number; radius?: number }>;
  /** 공작물 원점의 기계 좌표(표시 단위). 주면 M91 값을 실제 위치로 그린다. 없으면 공구 축을 안전 높이(추정)로 */
  machineOffset?: [number, number, number];
  /** 기계·읽기 설정(mm 기준, 앱 설정 — GcodeOptions.machine과 같음) */
  machine?: NcMachineOptions;
}

/** 프로그램 이름 → 비교용(따옴표·경로·확장자를 떼고 대문자): "TNC:\\DIR\\SUB1.H" → SUB1 */
function pgmBase(s: string): string {
  return s
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/^.*[\\/:]/, '')
    .replace(/\.[^.]*$/, '')
    .toUpperCase();
}

const AXES = 'XYZ';
/** PATTERN DEF 요소 낱말(요소 이름 + 번호, 괄호가 붙을 수 있음 — 숨긴 자리 /POS도) */
const PATTERN_ITEM = /^(?:\/?POS|ROW|PAT|FRAME|CIRC|PITCHCIRC)\d*(?:\(.*)?$/;
/** PATTERN DEF 한 패턴에서 그리는 가공 위치 수 한도 */
const PATTERN_MAX = 100_000;
/** CYCL CALL에서 밀링 길을 만드는 사이클 */
const MILL_CYCLES = new Set([208, 251, 252, 253, 256, 257, 232]);
/** 밀링 사이클의 깊이 층 안전장치(아주 작은 Q202가 끝나지 않게): 마지막 깊이 앞 층은 이 수까지, 넘으면 그 뒤 층은 건너뛰고 바닥 층으로(경고) */
const MILL_LEVEL_MAX = 9999;
/** SL 사이클(48차): 윤곽 부프로그램 하나를 읽는 블록 수 한도(끝없는 FN 점프 막기)·윤곽 요소 수 한도(설명서 9.1절 266쪽 — 한 SL 사이클에 16384개) */
const SL_BLOCK_MAX = 200_000;
const SL_ELEMENT_MAX = 16384;
/** SL 거친 깎기의 옆 간격 고리 수 안전장치(아주 작은 공구 반지름·Q2) */
const SL_RING_MAX = 2000;
/**
 * 49차 SL 사이클 출력·셈 안전장치(41차 층·쪼기 상한과 같은 규칙 — 닿으면 그 줄에 경고하고 그린 것은 그대로):
 * - SL_MOVE_MAX: 사이클 한 번(CYCL CALL·M99)이 그리는 층 × 고리 이동 수. 층마다 같은 고리를 도는 22·24는 다 그리면 넘을 때 앞 층 몇 개와
 *   바닥 층만 그린다(9999층 안전장치처럼 그 뒤 층은 건너뛰고 바닥 층으로). 그래도 넘으면(층 하나가 너무 큼) 넘는 곳에서 멈춘다.
 *   프로그램 전체 이동 한도(기본 800만)의 1/8 — 사이클 하나가 한도를 다 쓰지 않게
 * - SL_EVAL_CALL·SL_EVAL_PGM: 옆 간격 고리 셈의 일(상자 나무에서 본 마디·요소 수와 교점 셈 수 — sl.ts R.work)을 사이클 한 번·프로그램 전체에서.
 *   넘으면 그 안쪽 고리는 셈하지 않고 바깥 고리까지만 그린다(윤곽 요소가 수천 개이고 고리가 많을 때 — 원에 가까운 윤곽은 안쪽 고리마다
 *   거의 모든 요소를 봐야 해서 요소 수의 제곱으로 는다). 일 하나가 이 기계에서 약 20 ns라 한 번 0.4초·전체 1.6초 안팎의 셈
 */
const SL_MOVE_MAX = 1_000_000;
const SL_EVAL_CALL = 20_000_000;
const SL_EVAL_PGM = 80_000_000;

/** 윤곽 부프로그램을 읽는 동안 모은 요소(작업 평면 두 축, 프로그램 좌표)와 RND·CHF, 처음 만난 보정(RL 1·RR 2) */
interface SlCapture {
  els: { arc: boolean; su: number; sv: number; eu: number; ev: number; cu: number; cv: number; sweep: number }[];
  corners: (G7xCorner & { chf: boolean; line: number })[];
  comp: number;
  start: [number, number] | null;
  axis: boolean;
  skipped: Set<string>;
  /**
   * 49차: 윤곽 부프로그램 안의 좌표 변환(설명서 9.1절 266쪽 — 허용, 뒤 부프로그램에도 듣고 사이클 뒤에는 되돌림):
   * xf0 = 사이클을 부를 때의 출력 변환, toCall = 지금 변환(mFor) 좌표를 xf0 좌표로 옮기는 변환(같으면 null)
   */
  xf0: Affine | null;
  mFor: Affine | null;
  toCall: Affine | null;
  /** 축별 배율로 원호가 타원이 되는 것을 알렸는지와 알릴 줄(사이클을 부른 줄) */
  oval: boolean;
  line: number;
}

/** 한 블록: 원본 첫 줄 번호와 낱말들 */
interface HBlock {
  line: number;
  /** 다음 블록이 시작하는 줄 */
  next: number;
  toks: string[];
  text: string;
}

class HRunner extends NcEmitter {
  private o: HeidenhainOptions;
  private plane: NcPlane = 0;
  // 좌표 변환 사이클: 8 대칭(축별 ±1)·10 회전(도, 작업 평면)·11 배율·26 축별 배율(중심) — 원점(cycle 7) 둘레
  private mirror = [1, 1, 1];
  private rotDeg = 0;
  private scaleF = 1;
  private scale26 = [1, 1, 1];
  private center26 = [0, 0, 0];
  private cc: [number, number] | null = null;
  private lastDir: [number, number] | null = null;
  private dr = 1;
  private q = new Map<string, number>();
  private shift = [0, 0, 0];
  private blkMin: number[] | null = null;
  private blkMax: number[] | null = null;
  private stock: Box3 | undefined;
  private autoFeed = 0;
  private cycle: { n: number; ok: boolean } | null = null;
  private modalCall = false;
  /** PATTERN DEF 가공 위치(34차): 작업 평면 X·Y(원점 이동은 CYCL CALL PAT 때 더한다)와 사이클 공작물 윗면(Q203)에 더할 높이. 새 PATTERN DEF·SEL PATTERN까지 남는다 */
  private pattern: { x: number; y: number; z: number }[] | null = null;
  /** 지금 패턴에서 마지막으로 정의한 자리(숨긴 /POS 포함 — 다음 POS 증분의 기준, 36차) */
  private patternLast: { x: number; y: number; z: number } | null = null;
  /** 바로 앞 블록이 PATTERN DEF(또는 그 이어 쓴 요소)였는지 */
  private patternOpen = false;
  /** SEL PATTERN(점 표)을 골랐는지 — 점 표는 읽지 않는다 */
  private patternTable = false;
  private labels: Map<string, number> | null = null;
  /** 부르기 쌓기: LBL 부프로그램과 CALL PGM(pgmEnd = 그 프로그램 구획 끝 줄) */
  private stack: { ret: number; reps: number; start: number; pgmEnd?: number }[] = [];
  /** 프로그램 구획(BEGIN PGM·%이름 G7x·함께 연 파일 줄마다): 이름들·머리 줄·본문 첫 줄·끝(다음 구획 머리) */
  private pgms: { names: string[]; head: number; body: number; end: number; job: boolean }[] | null = null;
  /** 여러 파일을 한 작업으로 열었는지(함께 연 파일 줄이 있음) — 주 프로그램은 자기 구획 끝에서 멈춘다 */
  private multi = false;
  /** SEL PGM으로 고른 프로그램(CALL SELECTED PGM) */
  private selPgm: string | null = null;
  private sectionReps = new Map<number, number>();
  private pc = 0;
  private ended = false;
  private blocks = 0;
  private toolNames = new Map<string, number>();
  /** FK 극(FPOL) */
  private fkPole: [number, number] | null = null;
  /** TOOL DEF 반지름 */
  private toolR = new Map<number, number>();
  /** TOOL CALL DR(반지름 덧값) */
  private toolDR = 0;
  private maxBlocks: number;
  // ── DIN/ISO(%이름 G71 * 꼴) ──
  private iso = false;
  private isoAbs = true;
  /** 이동 모드: 0 급속, 1 직선, 2 시계, 3 반시계, 5 방향 없는 원호, 6 접선 원호, 10/11 극 직선, 12/13/15 극 원호 */
  private isoMot = 1;
  private isoComp = 0;
  private isoSeenStart = false;
  // ── SL 사이클(48차) ──
  /** 사이클 14의 윤곽 표지(정의 전이면 null) */
  private slLabels: string[] | null = null;
  /** 사이클 20(윤곽 자료)을 정의했는지 — Q1~Q9는 q 표에 있다 */
  private slData = false;
  /** 윤곽 부프로그램을 읽는 중이면 이동을 그리지 않고 모은다 */
  private cap: SlCapture | null = null;
  /** 마지막 거친 깎기(22)의 공구 반지름(24의 Q438 = -1) */
  private slRoughR: number | undefined;
  /** 49차: 이 프로그램에서 SL 고리 셈에 쓴 일(SL_EVAL_PGM까지) */
  private slEvals = 0;
  /** 49차: 사이클 270(윤곽 트레인 자료)을 정의했는지 — Q390~Q394는 q 표에 있다 */
  private ct270 = false;

  constructor(src: NcSource, opts: HeidenhainOptions) {
    super(src, opts.initialPosition, opts.maxMoves);
    this.o = opts;
    // 47차: TOOL CALL 축이 공구 축(작업 평면) — 공구 축 Y·X 구간의 급속은 안전 검사에서 뺀다(emitter.ts)
    this.toolAxisByPlane = true;
    this.maxBlocks = opts.maxBlocks ?? Math.max(src.lineCount * 20, 2_000_000);
    this.multi = jobFileLines(src) !== null;
    // 단위: BEGIN PGM … MM|INCH, DIN/ISO는 %이름 G71(mm)·G70(inch)
    for (let i = 0; i < Math.min(src.lineCount, 50); i++) {
      const t = sourceLine(src, i);
      const m = /BEGIN\s+PGM\s+(\S+)\s+(MM|INCH)/i.exec(t);
      if (m) {
        this.name = m[1]!;
        this.displayInch = m[2]!.toUpperCase() === 'INCH';
        break;
      }
      const iso = /^\s*%([^\s*;]+)\s+G7([01])\b/i.exec(t);
      if (iso) {
        this.iso = true;
        this.name = iso[1]!;
        this.displayInch = iso[2] === '0';
        this.notices.push({ kind: 'dialect', dialect: 'heidenhain-iso' });
        break;
      }
    }
    this.tol = this.displayInch ? 0.0001 : 0.002;
    this.rapidFeed = this.displayInch ? 400 : 10000;
    if (opts.machine) {
      const mc = this.applyMachine(opts.machine);
      if (!opts.machineOffset && mc.offset) this.o = { ...opts, machineOffset: mc.offset };
    }
    if (opts.rapidFeed) this.rapidFeed = opts.rapidFeed;
    this.feedMode = 94;
  }

  /** 이동마다 남기는 모달 상태: 작업 평면·좌표 변환(사이클 번호는 200번대라 남기지 않는다) */
  protected override modalState(): number {
    return this.plane | (this.outXf ? MODAL_XF : 0);
  }

  /** 48차: 윤곽 부프로그램을 읽는 동안의 이동은 그리지 않고 윤곽 요소로 모은다 */
  protected override emit(kind: number, x: number, y: number, z: number, line: number, extraFlags = 0, arcIdx = -1, arcLen = -1): boolean {
    if (this.cap) return this.capMove(null, x, y, z);
    return super.emit(kind, x, y, z, line, extraFlags, arcIdx, arcLen);
  }

  protected override emitArc(plane: number, c: readonly number[], sweep: number, x: number, y: number, z: number, line: number, extraFlags = 0): void {
    if (this.cap) {
      this.capMove({ c, sweep }, x, y, z);
      return;
    }
    super.emitArc(plane, c, sweep, x, y, z, line, extraFlags);
  }

  /** 윤곽 요소 하나 모으기: 첫 이동은 윤곽 시작점만 정한다(설명서 9.1절 266쪽 — 첫 블록에 두 축을 다 씀). 공구 축 좌표는 쓰지 않는다 */
  private capMove(arc: { c: readonly number[]; sweep: number } | null, x: number, y: number, z: number): boolean {
    const cap = this.cap!;
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const p = this.pos;
    const e = [x, y, z];
    if (Math.abs(e[a2]! - p[a2]!) > this.tol) cap.axis = true;
    // 49차: 윤곽 안에서 좌표 변환을 바꿨으면 지금 좌표를 사이클을 부를 때의 좌표로 옮긴다(원호는 거울이면 돌아가는 방향이 바뀜)
    let M: Affine | null = null;
    let sign = 1;
    if (this.outXf !== cap.xf0) {
      if (cap.mFor !== this.outXf || !cap.toCall) {
        const inv0 = cap.xf0 ? invertAffine(cap.xf0) : null;
        const cur = this.outXf;
        cap.toCall = cur ? (inv0 ? composeAffine(inv0, cur) : cur) : inv0;
        cap.mFor = cur;
      }
      M = cap.toCall && !isIdentityAffine(cap.toCall) ? cap.toCall : null;
      if (M) {
        const ap = affinePlane(M, this.plane);
        sign = ap.sign;
        if (arc && !ap.uniform && !cap.oval) {
          cap.oval = true;
          this.w.add('CYCL DEF 14: 윤곽 안 축별 배율로 원호가 타원이 되어 끝점·중심만 옮긴 원호로 그림', cap.line);
        }
      }
    }
    const map = (u: number, v: number): [number, number] => {
      if (!M) return [u, v];
      const q = [0, 0, 0];
      q[a0] = u;
      q[a1] = v;
      q[a2] = p[a2]!;
      const o = [0, 0, 0];
      applyAffine(M, q, o);
      return [o[a0]!, o[a1]!];
    };
    const [su, sv] = map(p[a0]!, p[a1]!);
    const [eu, ev] = map(e[a0]!, e[a1]!);
    // 보정 쪽도 사이클을 부를 때의 좌표에서(거울이면 RL·RR이 바뀜)
    if (cap.comp <= 0 && this.comp) cap.comp = sign < 0 ? 3 - this.comp : this.comp;
    if (!cap.start) cap.start = [eu, ev];
    else if (arc) {
      const sw = Math.max(-TAU, Math.min(TAU, arc.sweep)) * sign;
      const [cu, cv] = map(arc.c[a0]!, arc.c[a1]!);
      if (cap.els.length < SL_ELEMENT_MAX + 1) cap.els.push({ arc: true, su, sv, eu, ev, cu, cv, sweep: sw });
    } else if (Math.hypot(eu - su, ev - sv) > 1e-12 && cap.els.length < SL_ELEMENT_MAX + 1) cap.els.push(g7xLine(su, sv, eu, ev));
    p[a0] = e[a0]!;
    p[a1] = e[a1]!;
    this.known = 7;
    return true;
  }

  /** 줄 i부터 블록 하나(~ 이어 쓰기 포함) */
  private readBlock(i: number): HBlock {
    let text = '';
    let j = i;
    for (;;) {
      // 이어 쓰기 표시 ~는 주석(;) 뒤 줄 끝에 온다 — 주석을 떼기 전에 본다
      let t = sourceLine(this.src, j).trimEnd();
      const cont = t.endsWith('~');
      if (cont) t = t.slice(0, -1);
      const sc = indexOutsideQuotes(t, ';');
      if (sc >= 0) t = t.slice(0, sc);
      t = t.trim();
      text += (text ? ' ' : '') + t;
      j++;
      if (!cont || j >= this.src.lineCount) break;
    }
    // 블록 번호 떼기(DIN/ISO는 블록 끝 * 도)
    text = text.replace(/^\s*N?\d+(?:\s+|$)/, '').trim();
    if (this.iso) text = text.replace(/\s*\*\s*$/, '').trim();
    return { line: i, next: j, toks: tokenize(text), text };
  }

  run(): void {
    // 여러 파일 작업이면 글 끝(마지막 파일 끝)에서도 불린 프로그램은 돌아간다(아래 구획 끝 확인)
    while (!this.ended && (this.pc < this.src.lineCount || this.multi)) {
      // 여러 파일을 함께 열었으면: 불린 프로그램은 자기 구획 끝에서 돌아가고, 주 프로그램은 다음 파일 앞에서 멈춘다
      if (this.multi) {
        const f = this.stack.findLast((x) => x.pgmEnd !== undefined);
        const end = f ? f.pgmEnd! : (this.pgmIndex()[0]?.end ?? this.src.lineCount);
        if (this.pc >= end) {
          if (this.returnPgm()) continue;
          break;
        }
      }
      if (++this.blocks > this.maxBlocks) {
        this.w.add(`실행 블록이 ${this.maxBlocks}개를 넘어 멈춤(끝없는 반복일 수 있음)`, this.pc);
        break;
      }
      const b = this.readBlock(this.pc);
      this.pc = b.next;
      if (!b.toks.length) continue;
      try {
        if (this.iso) {
          // DIN/ISO 블록을 평문 블록(하나 이상)으로 옮겨 같은 길로 실행
          for (const t of this.isoBlock(b.text, b.line)) {
            this.exec({ line: b.line, next: b.next, text: t, toks: tokenize(t) });
            if (this.ended || this.pc !== b.next) break;
          }
        } else this.exec(b);
      } catch (err) {
        if (!(err instanceof ExprError)) throw err;
        this.w.add(`읽을 수 없는 블록 — ${err.message}`, b.line);
      }
      if (this.mb.full()) {
        this.w.add(`이동이 ${this.maxMoves}개를 넘어 나머지는 읽지 않음`, b.line);
        break;
      }
    }
  }

  // ── DIN/ISO → 평문 ──
  /**
   * DIN/ISO 블록 하나를 평문 블록 글(하나 이상)로 옮긴다:
   * G00/G01 → L(FMAX), G02/G03 → C·CR(R), G05 → C(방향 그대로), G06 → CT, G10/G11 R H → LP, G12/G13/G15 H → CP, I·J·K → CC(절대 원 중심),
   * G29 → CC(마지막 자리), G40/G41/G42 → R0/RL/RR, G90/G91 → I 붙임, G30/G31 → BLK FORM, G99 T L R → TOOL DEF, T G17 S → TOOL CALL,
   * G2xx → CYCL DEF, G79 → CYCL CALL, G83 P01… → 옛 쪼기 사이클 1, G54 → 사이클 7, G28 → 8, G73 H → 10, G72 F → 11,
   * G98 L n → LBL n, L n,m → CALL LBL n REP m, D00~D13 → FN, G04 F → 휴지, G38 → STOP, %이름 → 시작·끝(다른 이름이면 CALL PGM)
   */
  private isoBlock(text: string, line: number): string[] {
    const t = text.trim();
    if (!t) return [];
    // %이름 G71: 처음이면 시작, 그다음(N99999999 %이름 …)은 끝, 다른 이름이면 프로그램 부르기
    let m = /^%([^\s*;]+)/.exec(t);
    if (m) {
      if (!this.isoSeenStart) {
        this.isoSeenStart = true;
        return [];
      }
      // 지금 프로그램 구획의 이름이면 끝(불린 프로그램이면 돌아간다)
      const nm = pgmBase(m[1]!);
      const here = this.pgmIndex()[this.sectionAt(line)];
      return (here ? here.names.includes(nm) : nm === pgmBase(this.name)) ? ['END PGM'] : [`CALL PGM ${m[1]}`];
    }
    // Q 공식(Q1 = …)은 그대로
    if (/^Q[LRS]?\d+\s*=/.test(t)) return [t];
    // D 함수: D00 Q1 P01 +5 / D01 Q1 P01 Q2 P02 +3 / D09 P01 +Q1 P02 +10 P03 5
    if ((m = /^D(\d+)\s+(.*)$/i.exec(t))) return [this.isoFn(+m[1]!, m[2]!, line)];
    // 낱말: 글자 + 값(+5·-2.5·Q3·+Q3), L n,m(부르기)
    const W: { k: string; v: string }[] = [];
    const re = /([A-Z]+)\s*((?:[-+]?(?:\d+\.?\d*|\.\d+)(?:,\d+)?)|[-+]?Q[LRS]?\d+)?/gi;
    let mm: RegExpExecArray | null;
    let rest = '';
    while ((mm = re.exec(t))) {
      const k = mm[1]!.toUpperCase();
      // 사이클 이름(BOHREN 등)·이름 뒤 Q 대입은 그대로 넘긴다
      if (/^Q[LRS]?$/.test(k) && t[re.lastIndex] === '=') {
        rest = t.slice(mm.index);
        break;
      }
      W.push({ k, v: mm[2] ?? '' });
    }
    const gs = W.filter((w) => w.k === 'G').map((w) => Math.round(parseFloat(w.v)));
    const word = (k: string): string | undefined => W.find((w) => w.k === k)?.v;
    const has = (k: string): boolean => W.some((w) => w.k === k);
    const out: string[] = [];
    // 모드
    for (const g of gs) {
      if (g === 90) this.isoAbs = true;
      else if (g === 91) this.isoAbs = false;
      else if (g === 40) this.isoComp = 0;
      else if (g === 41) this.isoComp = 1;
      else if (g === 42) this.isoComp = 2;
      else if ([0, 1, 2, 3, 5, 6, 7, 10, 11, 12, 13, 15, 16].includes(g)) this.isoMot = g;
    }
    const inc = this.isoAbs ? '' : 'I';
    const sgn = (v: string): string => (/^[-+]/.test(v) ? v : `+${v}`);
    const axes = (letters: string[]): string =>
      letters
        .filter((a) => has(a))
        .map((a) => `${inc}${a}${sgn(word(a)!)}`)
        .join(' ');
    const ms = W.filter((w) => w.k === 'M').map((w) => `M${w.v}`);
    const feed = has('F') ? ` F${word('F')}` : '';
    const g = (n: number): boolean => gs.includes(n);
    // 블록 꼴
    if (g(30) || g(31)) {
      const ax = g(18) ? 'Y' : g(19) ? 'X' : 'Z';
      return [g(30) ? `BLK FORM 0.1 ${ax} ${axes(['X', 'Y', 'Z'])}` : `BLK FORM 0.2 ${axes(['X', 'Y', 'Z'])}`];
    }
    if (g(99) && has('T')) return [`TOOL DEF ${word('T')} L${sgn(word('L') ?? '0')} R${sgn(word('R') ?? '0')}`];
    if (has('T')) {
      const ax = g(18) ? 'Y' : g(19) ? 'X' : 'Z';
      const extra = ['S', 'F', 'DL', 'DR'].filter(has).map((k) => ` ${k}${word(k)}`).join('');
      out.push(`TOOL CALL ${word('T')} ${ax}${extra}`);
      if (ms.length) out.push(ms.join(' '));
      return out;
    }
    if (g(98) && has('L')) return [`LBL ${word('L')}`];
    if (has('L') && /,/.test(word('L') ?? '')) {
      const [n, rep] = word('L')!.split(',');
      return [rep && +rep > 0 ? `CALL LBL ${n} REP ${rep}` : `CALL LBL ${n}`];
    }
    if (g(38)) return ['STOP'];
    if (g(4)) return [`DWELL ${word('F') ?? '0'}`];
    const big = gs.find((n) => n >= 200 && n <= 299);
    if (big !== undefined) return [`CYCL DEF ${big} ${rest || W.filter((w) => w.k !== 'G').map((w) => w.k + w.v).join(' ')}`.trim()];
    // 48차 SL 사이클: G120~G124 → 사이클 20~24(설명서 9.4~9.8절의 ISO 이름), G37 → 사이클 14(9.2절 — 표지 번호는 P01 1 P02 2 꼴의 P 값으로 읽음)
    // 49차: G125 → 사이클 25(9.10절 292쪽). G270은 위의 200번대로 사이클 270
    const sl = gs.find((n) => n >= 120 && n <= 125);
    if (sl !== undefined) return [`CYCL DEF ${sl - 100} ${rest || W.filter((w) => w.k !== 'G').map((w) => w.k + w.v).join(' ')}`.trim()];
    if (g(37)) return ['CYCL DEF 14.0', `CYCL DEF 14.1 ${[...t.matchAll(/P\d+\s*\+?(\d+)/gi)].map((m) => m[1]).join(' /')}`];
    if (g(79)) return [`CYCL CALL${feed}${ms.length ? ' ' + ms.join(' ') : ''}`];
    if (g(83) || g(84)) {
      // 옛 사이클 1(쪼기)·2(탭): P01 안전 거리 P02 깊이 P03 절입(탭은 휴지) P04 휴지(탭은 이송) P05 이송
      const pv = (k: string): string => {
        const r = new RegExp(`P0?${k}\\s*([-+]?(?:\\d+\\.?\\d*|\\.\\d+|Q\\d+))`, 'i').exec(t);
        return r ? r[1]! : '0';
      };
      if (g(83)) return ['CYCL DEF 1.0', `CYCL DEF 1.1 SET UP ${pv('1')}`, `CYCL DEF 1.2 DEPTH ${pv('2')}`, `CYCL DEF 1.3 PECKG ${pv('3')}`, `CYCL DEF 1.4 DWELL ${pv('4')}`, `CYCL DEF 1.5 F${pv('5')}`];
      return ['CYCL DEF 2.0', `CYCL DEF 2.1 SET UP ${pv('1')}`, `CYCL DEF 2.2 DEPTH ${pv('2')}`, `CYCL DEF 2.3 DWELL ${pv('3')}`, `CYCL DEF 2.4 F${pv('4')}`];
    }
    if (g(54)) return ['CYCL DEF 7.0', ...['X', 'Y', 'Z'].filter(has).map((a, k) => `CYCL DEF 7.${k + 1} ${inc}${a}${sgn(word(a)!)}`)];
    if (g(28)) return ['CYCL DEF 8.0', `CYCL DEF 8.1 ${['X', 'Y', 'Z'].filter(has).join(' ')}`.trim()];
    if (g(73)) return ['CYCL DEF 10.0', `CYCL DEF 10.1 ${inc}ROT${sgn(word('H') ?? '0')}`];
    if (g(72)) return ['CYCL DEF 11.0', `CYCL DEF 11.1 SCL${word('F') ?? '1'}`];
    if (g(80)) {
      this.w.add('DIN/ISO G80(기울인 작업 평면)은 지원하지 않음(변환 없이 그림)', line);
      return [];
    }
    if (g(53)) {
      this.w.add('DIN/ISO G53(원점 표)는 읽지 않음', line);
      return [];
    }
    // G24 R = 모따기 길이, G25 R = 둥글리기 반지름(F = 이송) → 평문 CHF·RND
    if (g(24) || g(25)) {
      const r = word('R');
      const f = word('F');
      if (r === undefined) {
        this.w.add(`${g(24) ? 'G24(모따기)' : 'G25(둥글리기)'}에 R이 없어 모서리 그대로 그림`, line);
        return [];
      }
      return [`${g(24) ? `CHF ${r}` : `RND R${r}`}${f !== undefined ? ` F${f}` : ''}`];
    }
    if (g(26) || g(27)) this.w.add('APPR·DEP(접근·이탈)는 끝점까지 직선으로 그림', line);
    // 원 중심(극) I·J·K, G29 = 마지막 자리
    const ijk = ['I', 'J', 'K'].filter(has);
    if (ijk.length) out.push(`CC ${ijk.map((k) => `${inc}${'XYZ'['IJK'.indexOf(k)]}${sgn(word(k)!)}`).join(' ')}`);
    if (g(29)) out.push('CC');
    // 이동
    const xyz = axes(['X', 'Y', 'Z']);
    const comp = this.isoComp === 1 ? 'RL' : this.isoComp === 2 ? 'RR' : 'R0';
    const tail = `${feed}${ms.length ? ' ' + ms.join(' ') : ''}`;
    const mot = this.isoMot;
    const hasPolar = has('H') || (has('R') && (mot === 10 || mot === 11));
    if (mot === 10 || mot === 11 ? hasPolar : mot >= 12 && mot <= 16 ? has('H') : !!xyz) {
      if (mot === 0 || mot === 1 || mot === 7) out.push(`L ${xyz} ${comp}${mot === 0 ? ' FMAX' : ''}${tail}`);
      else if (mot === 2 || mot === 3) out.push(has('R') ? `CR ${xyz} R${sgn(word('R')!)} DR${mot === 2 ? '-' : '+'}${tail}` : `C ${xyz} DR${mot === 2 ? '-' : '+'}${tail}`);
      else if (mot === 5) out.push(`C ${xyz}${tail}`);
      else if (mot === 6) out.push(`CT ${xyz}${tail}`);
      else if (mot === 10 || mot === 11) {
        const pr = has('R') ? ` ${this.isoAbs ? '' : 'I'}PR${sgn(word('R')!)}` : '';
        const pa = has('H') ? ` ${this.isoAbs ? '' : 'I'}PA${sgn(word('H')!)}` : '';
        out.push(`LP${pr}${pa} ${comp}${mot === 10 ? ' FMAX' : ''}${tail}`);
      } else {
        const pa = ` ${this.isoAbs ? '' : 'I'}PA${sgn(word('H')!)}`;
        const z = has('Z') ? ` ${inc}Z${sgn(word('Z')!)}` : '';
        out.push(`CP${pa}${z}${mot === 12 ? ' DR-' : mot === 13 ? ' DR+' : ''}${tail}`);
      }
    } else if (feed || ms.length || gs.some((n) => n >= 40 && n <= 42)) out.push(`L ${comp}${tail}`.trim());
    return out;
  }

  /** D 함수 → FN 글 */
  private isoFn(k: number, body: string, line: number): string {
    const toks = body.trim().split(/\s+/);
    const target = /^Q[LRS]?\d+$/i.test(toks[0] ?? '') ? toks.shift()! : '';
    // P01 값 P02 값 P03 값
    const p: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      const m = /^P0?(\d)$/i.exec(toks[i]!);
      if (m) p[+m[1]! - 1] = toks[++i] ?? '0';
    }
    const v = (i: number): string => p[i] ?? '0';
    switch (k) {
      case 0:
        return `FN 0: ${target} = ${v(0)}`;
      case 1:
        return `FN 1: ${target} = ${v(0)} + ${v(1)}`;
      case 2:
        return `FN 2: ${target} = ${v(0)} - ${v(1)}`;
      case 3:
        return `FN 3: ${target} = ${v(0)} * ${v(1)}`;
      case 4:
        return `FN 4: ${target} = ${v(0)} DIV ${v(1)}`;
      case 5:
        return `FN 5: ${target} = SQRT ${v(0)}`;
      case 6:
        return `FN 6: ${target} = SIN ${v(0)}`;
      case 7:
        return `FN 7: ${target} = COS ${v(0)}`;
      case 8:
        return `FN 8: ${target} = ${v(0)} LEN ${v(1)}`;
      case 9:
      case 10:
      case 11:
      case 12:
        return `FN ${k}: IF ${v(0)} ${['EQU', 'NE', 'GT', 'LT'][k - 9]} ${v(1)} GOTO LBL ${v(2)}`;
      case 13:
        return `FN 13: ${target} = ${v(0)} ANG ${v(1)}`;
      case 14:
        return 'FN 14: ERROR';
    }
    this.w.add(`D${String(k).padStart(2, '0')} 함수는 지원하지 않음`, line);
    return '';
  }

  // ── 값 ──
  private value(s: string): number {
    const t = s.trim();
    if (t === '') throw new ExprError('값 없음');
    const n = Number(t);
    if (Number.isFinite(n)) return n;
    return this.expr(t);
  }
  private expr(e: string): number {
    const v = evalMprExpr(e.replace(/\bDIV\b/gi, '/'), {
      get: (name) => {
        const k = name.toUpperCase();
        if (/^Q[LRS]?\d+$/.test(k)) return this.q.get(k) ?? 0;
        return undefined;
      },
    });
    return v;
  }

  // ── 실행 ──
  private exec(b: HBlock): void {
    const T = b.toks;
    const t0 = T[0]!.toUpperCase();
    const t1 = (T[1] ?? '').toUpperCase();
    const line = b.line;
    // PATTERN DEF 요소를 이어 쓰기(~) 없이 다음 줄에 쓴 꼴(2018년 설명서 예처럼 블록 번호 없이 POS1( … )·ROW1( … ))도 그 패턴에 더한다
    if (this.patternOpen && PATTERN_ITEM.test(t0)) return this.patternDef(b.text, line, true);
    this.patternOpen = false;
    if (t0 === '*' || t0.startsWith('*')) return; // 구조 주석
    if (t0 === 'BEGIN') return;
    if (t0 === 'END' && t1 === 'PGM') {
      if (!this.returnPgm()) this.ended = true;
      return;
    }
    if (t0 === 'DWELL') {
      // DIN/ISO G04 F(초)
      this.dwell(this.value(t1 || '0'));
      return;
    }
    if (t0 === 'BLK' && t1 === 'FORM') return this.blkForm(T, line);
    if (t0 === 'TOOL' && t1 === 'DEF') {
      const n = parseInt(T[2] ?? '', 10);
      const r = findWord(T, 'R');
      if (Number.isFinite(n) && r !== undefined) {
        const rv = this.value(r);
        this.toolR.set(n, rv);
        this.setToolInfo(n, { diameter: 2 * rv });
      }
      return;
    }
    if (t0 === 'TOOL' && t1 === 'CALL') return this.toolCall(T, line);
    if (t0 === 'CYCL' && t1 === 'DEF') return this.cyclDef(T, line);
    if (t0 === 'PATTERN' && t1 === 'DEF') return this.patternDef(b.text, line, false);
    if (t0 === 'SEL' && t1 === 'PATTERN') {
      // 점 표를 고르면 PATTERN DEF 패턴은 끝난다(점 표 파일은 읽지 않는다 — 경고는 34차 전과 같다)
      this.pattern = null;
      this.patternTable = true;
      this.w.add('SEL 블록은 지원하지 않음', line);
      this.mWords(T, line, false);
      return;
    }
    if (t0 === 'CYCL' && t1 === 'CALL') {
      if ((T[2] ?? '').toUpperCase() === 'PAT') return this.cycleCallPat(T, line);
      const f = findWord(T, 'F');
      if (f !== undefined) this.feed = this.value(f);
      this.mWords(T, line, true);
      return this.cycleCall(line);
    }
    if (t0 === 'GLOBAL' && t1 === 'DEF') {
      // GLOBAL DEF 125 POSITIONING의 Q345(CYCL CALL PAT 위치 높이 — 34차)만 읽는다. 다른 기본값은 읽지 않고 경고도 34차 전과 같다
      for (const w of T.slice(2)) {
        const m = /^Q345=(.+)$/i.exec(w);
        if (m) this.q.set('Q345', this.value(m[1]!));
      }
      this.w.add(`알 수 없는 블록 '${t0}'`, line);
      return;
    }
    if (t0 === 'LBL') {
      // LBL 0 = 부프로그램 끝(부른 곳으로 돌아간다). 다른 LBL은 표지일 뿐
      const f = this.stack[this.stack.length - 1];
      if ((T[1] === '0' || T[1] === '"0"') && f && f.pgmEnd === undefined) {
        if (f.reps > 1) {
          f.reps--;
          this.pc = f.start;
        } else {
          this.stack.pop();
          this.pc = f.ret;
        }
      }
      return;
    }
    if (t0 === 'CALL' && t1 === 'LBL') return this.callLbl(T, line);
    if (t0 === 'CALL' && t1 === 'PGM') return this.callPgm(/^CALL\s+PGM\s+("[^"]*"|\S+)/i.exec(b.text)?.[1] ?? '', line);
    // SEL PGM 이름 … CALL SELECTED PGM: 고른 프로그램 부르기
    if (t0 === 'SEL' && t1 === 'PGM') {
      this.selPgm = /^SEL\s+PGM\s+("[^"]*"|\S+)/i.exec(b.text)?.[1] ?? null;
      return;
    }
    if (t0 === 'CALL' && t1 === 'SELECTED') {
      if (this.selPgm) return this.callPgm(this.selPgm, line);
      this.w.add('CALL SELECTED PGM: 앞에 SEL PGM이 없음', line);
      return;
    }
    if (t0 === 'FN') return this.fn(b, line);
    if (/^Q[LRS]?\d+$/.test(t0) || /^Q[LRS]?\d+=/.test(t0)) return this.qAssign(b.text);
    if (t0 === 'L') return this.linear(T, line);
    // 'L' 없이 좌표로 시작하는 블록(예: "8 A+180 R0 FMAX")도 직선으로
    if (/^I?[XYZABCUVW][+-]/.test(t0)) return this.linear(['L', ...T], line);
    if (t0 === 'CC') return this.pole(T);
    if (t0 === 'C') return this.circle(T, line);
    if (t0 === 'CR') return this.circleR(T, line);
    if (t0 === 'CT') return this.circleT(T, line);
    if (t0 === 'LP') return this.linearPolar(T, line);
    if (t0 === 'CP') return this.circlePolar(T, line);
    if (t0 === 'FPOL' || t0 === 'FL' || t0 === 'FLT' || t0 === 'FC' || t0 === 'FCT') return this.fk(t0, T, line);
    if (t0 === 'FSELECT') {
      this.w.add('FSELECT(FK 해 고르기)는 무시함 — 한 블록으로 정해지는 해만 그림', line);
      return;
    }
    if (t0 === 'TRANS') return this.transDatum(T, line);
    if (t0 === 'RND' || t0 === 'CHF') return this.cornerBlock(t0, T, line);
    if (t0.startsWith('APPR') || t0.startsWith('DEP')) {
      this.w.add('APPR·DEP(접근·이탈)는 끝점까지 직선으로 그림', line);
      return this.linear(T, line);
    }
    if (t0 === 'STOP' || t0 === 'FUNCTION' || t0 === 'TCH' || t0 === 'PATTERN' || t0 === 'PLANE' || t0 === 'SEL' || t0 === 'DECLARE') {
      if (t0 !== 'STOP') this.w.add(`${t0} 블록은 지원하지 않음`, line);
      this.mWords(T, line, false);
      return;
    }
    if (/^M\d+$/.test(t0)) {
      this.mWords(T, line, false);
      return;
    }
    this.w.add(`알 수 없는 블록 '${t0}'`, line);
  }

  /**
   * RND R…(모서리 둥글리기, R = 반지름)·CHF …(모따기, 값 = 모서리에서 앞뒤 요소를 따라 자르는 길이), 둘 다 F = 그 부분의 이송(선택).
   * emitter의 requestCorner로 앞 요소 끝을 줄이고 호·직선을 넣는다. RND는 작업 평면 안의 직선·원호 어느 조합이든(앞뒤 요소에 접하는 호),
   * CHF는 Heidenhain 설명서대로 두 직선 사이 모서리에만(원호와 만나면 모서리 그대로, 경고)
   */
  private cornerBlock(t0: 'RND' | 'CHF', T: string[], line: number): void {
    let size: number | undefined;
    let feed: number | undefined;
    for (const w of T.slice(1)) {
      const u = w.toUpperCase();
      if (/^F[+-]?(?:[\d.]+|Q[LRS]?\d+)$/.test(u)) feed = this.value(w.slice(1));
      else if (t0 === 'RND' && /^R[+-]?(?:[\d.]+|Q[LRS]?\d+)$/.test(u)) size = this.value(w.slice(1));
      else if (t0 === 'CHF' && /^L?[+-]?(?:[\d.]+|Q[LRS]?\d+)$/.test(u)) size = this.value(u.startsWith('L') ? w.slice(1) : w);
    }
    if (size === undefined) {
      this.w.add(t0 === 'RND' ? 'RND에 반지름 R이 없어 모서리 그대로 그림' : 'CHF에 길이가 없어 모서리 그대로 그림', line);
      return;
    }
    if (this.cap) {
      // 윤곽 부프로그램: 앞 요소 끝 모서리에 적어 두고 윤곽을 다 모은 뒤 다듬는다
      if (size !== 0) this.cap.corners.push({ at: this.cap.els.length - 1, kind: t0 === 'RND' ? 'round' : 'chamferLeg', size: Math.abs(size), chf: t0 === 'CHF', line });
      return;
    }
    this.requestCorner(t0 === 'RND' ? 'round' : 'chamferLeg', Math.abs(size), line, this.plane, t0, feed, t0 === 'CHF');
  }

  private blkForm(T: string[], line: number): void {
    const kind = T[2] ?? '';
    const pt = (): number[] => {
      const p = [NaN, NaN, NaN];
      for (const w of T.slice(3)) {
        const m = /^(I?)([XYZ])(.+)$/i.exec(w);
        if (!m) continue;
        const a = AXES.indexOf(m[2]!.toUpperCase());
        const v = this.value(m[3]!);
        p[a] = m[1] ? (this.blkMin?.[a] ?? 0) + v : v;
      }
      return p;
    };
    if (kind === '0.1') {
      this.blkMin = pt();
      const ax = (T[3] ?? 'Z').toUpperCase();
      this.plane = ax === 'Y' ? 1 : ax === 'X' ? 2 : 0;
    } else if (kind === '0.2' && this.blkMin) {
      this.blkMax = pt();
      const a = this.blkMin;
      const b = this.blkMax;
      if ([0, 1, 2].every((k) => Number.isFinite(a[k]!) && Number.isFinite(b[k]!)))
        this.stock = {
          min: [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.min(a[2]!, b[2]!)],
          max: [Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!), Math.max(a[2]!, b[2]!)],
        };
    } else if (kind.toUpperCase() === 'CYLINDER') {
      // BLK FORM CYLINDER 축 R(또는 D) L — 축 방향으로 0에서 -L까지(추정), 둘레 상자로 그린다
      const r = findWord(T, 'R');
      const d = findWord(T, 'D');
      const l = findWord(T, 'L');
      const R = r !== undefined ? this.value(r) : d !== undefined ? this.value(d) / 2 : undefined;
      if (R !== undefined && l !== undefined) {
        const L = this.value(l);
        const ax = AXES.indexOf((T[3] ?? 'Z').toUpperCase());
        const min: [number, number, number] = [-R, -R, -R];
        const max: [number, number, number] = [R, R, R];
        const a = ax < 0 ? 2 : ax;
        min[a] = -L;
        max[a] = 0;
        this.stock = { min, max };
        this.w.add('BLK FORM CYLINDER는 둘레 상자로 그림', line);
      }
    }
  }

  private toolCall(T: string[], line: number): void {
    const id = T[2] ?? '';
    let n: number;
    if (/^\d+$/.test(id)) n = +id;
    else if (/^".*"$/.test(id)) {
      const name = id.slice(1, -1);
      n = this.toolNames.get(name) ?? 100000 + this.toolNames.size;
      this.toolNames.set(name, n);
      this.setToolInfo(n, { name });
    } else n = this.tool >= 0 ? this.tool : 0;
    const ax = (T[3] ?? '').toUpperCase();
    if (ax === 'Z') this.plane = 0;
    else if (ax === 'Y') this.plane = 1;
    else if (ax === 'X') this.plane = 2;
    const s = findWord(T, 'S');
    if (s !== undefined) this.speed = Math.abs(this.value(s));
    const f = findWord(T, 'F');
    if (f !== undefined && /^[+-]?[\d.Q]/i.test(f)) this.autoFeed = this.value(f);
    const dr = findWord(T, 'DR');
    this.toolDR = dr !== undefined ? this.value(dr) : 0;
    this.changeTool(n, line);
    if (this.comp) this.compNote(line);
  }

  /** 지금 공구의 반지름(공구 표 → TOOL DEF R, + TOOL CALL DR). 모르면 undefined */
  private toolRadius(): number | undefined {
    const t = this.tool;
    const tt = this.o.toolTable?.[t];
    const base = tt ? (tt.radius ?? (tt.diameter !== undefined ? tt.diameter / 2 : undefined)) : this.toolR.get(t);
    return base === undefined ? undefined : base + this.toolDR;
  }

  /** 반경 보정 구간 기록 */
  private compNote(line: number): void {
    const r = this.comp ? this.toolRadius() : undefined;
    this.noteComp(this.plane, line, r, r === undefined ? '' : `T${this.tool} R${this.toolDR ? ' + DR' : ''}`, this.tool);
  }

  /**
   * 47차: 사이클 8(대칭)로 보정 평면 안 한 축이 뒤집혔으면 RL/RR을 표시 좌표에서 반대로 센다 — 설명서(TNC 310 사용 설명서 4/2003, 8.6절 140쪽
   * "MIRROR IMAGE (Cycle 8)")대로 한 축 대칭은 가공 방향이 바뀌고(공구 경로가 대칭된 모양 그대로) 두 축 대칭은 그대로. 회전·배율과 함께여도 평면 안 방향으로 정한다
   */
  protected override compMirrored(plane: number): boolean {
    return !!this.outXf && affinePlane(this.outXf, plane).sign < 0;
  }

  /** 48차: 지금 작업 평면이 한 축 대칭(좌표 변환의 평면 안 행렬식 < 0)인지 — 고정·SL 사이클의 가공 방향을 지키는 데 쓴다 */
  private cycleMirrored(): boolean {
    return !!this.outXf && affinePlane(this.outXf, this.plane).sign < 0;
  }

  private cyclDef(T: string[], line: number): void {
    const num = T[2] ?? '';
    // Q 값 대입(새 꼴: 한 블록 안에 Q200=… 가 이어짐)
    for (const w of T.slice(3)) {
      const m = /^(Q[LR]?\d+)=(.+)$/i.exec(w);
      if (m && !m[2]!.startsWith('"')) this.q.set(m[1]!.toUpperCase(), this.value(m[2]!));
    }
    const major = parseInt(num, 10);
    // 예전 꼴: CYCL DEF 1.0 PECKING / 1.1 SET UP 2 / 1.2 DEPTH -20 / 1.3 PECKG 5 / 1.4 DWELL 0 / 1.5 F100
    if (/^\d+\.\d+$/.test(num)) {
      const sub = Math.round((parseFloat(num) - major) * 10);
      const last = T[T.length - 1] ?? '';
      const val = (): number | undefined => {
        const m = /^F?([+-]?[\d.]+)$/i.exec(last);
        return m ? parseFloat(m[1]!) : undefined;
      };
      if (major === 7) {
        // 원점 이동: 7.1 X+10 / 7.2 Y+5 / 7.3 Z…
        for (const w of T.slice(3)) {
          const m = /^(I?)([XYZ])(.+)$/i.exec(w);
          if (!m) continue;
          const a = AXES.indexOf(m[2]!.toUpperCase());
          const v = this.value(m[3]!);
          this.shift[a] = m[1] ? this.shift[a]! + v : v;
        }
        this.updateXf();
        return;
      }
      if (major === 8) {
        // 대칭: 8.1 X Y(대칭할 축, 없으면 끔)
        if (sub === 1) {
          this.mirror = [1, 1, 1];
          for (const w of T.slice(3)) {
            const a = AXES.indexOf(w.toUpperCase().replace(/^I/, ''));
            if (a >= 0) this.mirror[a] = -1;
          }
          this.updateXf();
        }
        return;
      }
      if (major === 10) {
        // 회전: 10.1 ROT+45(IROT는 더하기). 지금 작업 평면에서 원점 둘레
        if (sub === 1) {
          const tok = T.slice(3).join('').toUpperCase();
          const m = /^(I?)ROT([-+]?.+)$/.exec(tok);
          if (m) {
            const v = this.value(m[2]!);
            this.rotDeg = m[1] ? this.rotDeg + v : v;
            this.updateXf();
          }
        }
        return;
      }
      if (major === 11) {
        // 배율: 11.1 SCL 0.75
        if (sub === 1) {
          const tok = T.slice(3).join('').toUpperCase();
          const m = /^SCL([-+]?.+)$/.exec(tok);
          if (m) {
            const v = this.value(m[1]!);
            if (v > 0) this.scaleF = v;
            this.updateXf();
          }
        }
        return;
      }
      if (major === 26) {
        // 축별 배율: 26.1 X1.4 Y0.6 CCX+15 CCY+20
        if (sub === 1) {
          this.scale26 = [1, 1, 1];
          this.center26 = [0, 0, 0];
          for (const w of T.slice(3)) {
            let m = /^CC([XYZ])(.+)$/i.exec(w);
            if (m) {
              this.center26[AXES.indexOf(m[1]!.toUpperCase())] = this.value(m[2]!);
              continue;
            }
            m = /^([XYZ])(.+)$/i.exec(w);
            if (m) {
              const v = this.value(m[2]!);
              if (v > 0) this.scale26[AXES.indexOf(m[1]!.toUpperCase())] = v;
            }
          }
          this.updateXf();
        }
        return;
      }
      if (major === 19) {
        if (sub === 0) this.w.add('CYCL DEF 19(기울인 작업 평면)은 지원하지 않음(변환 없이 그림)', line);
        return;
      }
      if (major === 14) {
        // 윤곽: 14.0 CONTOUR / 14.1 CONTOUR LABEL1 /2 /3(설명서 9.2절 269쪽 — 12개까지). 정의하면 바로 쓴다
        if (sub === 0) this.slLabels = [];
        else this.slLabels = [...(this.slLabels ?? []), ...slLabelWords(T.slice(3))];
        return;
      }
      if (major >= 20 && major <= 25) {
        // 예전 꼴 머리(CYCL DEF 20.0 CONTOUR DATA …)도 같은 사이클로(49차: 25 윤곽 트레인도)
        if (sub === 0) this.slDef(major);
        return;
      }
      if (major === 1 || major === 2 || major === 17) {
        if (sub === 0) this.cycle = { n: major, ok: true };
        const v = val();
        if (v !== undefined) {
          const key = ['', 'O1', 'O2', 'O3', 'O4', 'O5'][sub];
          if (key) this.q.set('OLD' + key, v);
        }
        return;
      }
      if (sub === 0) this.w.add(`CYCL DEF ${major}은 지원하지 않음`, line);
      return;
    }
    if ([200, 201, 202, 203, 205, 240, 206, 207, 209, 204, 208, 251, 252, 253, 256, 257, 232].includes(major)) {
      this.cycle = { n: major, ok: true };
      if (major === 204) this.w.add(`CYCL DEF ${major}은 드릴처럼(내려가서 올라옴) 그림`, line);
      return;
    }
    // 점 패턴(정의하면 바로 앞 가공 사이클을 점마다 부른다)
    if (major === 220 || major === 221) return this.patternCycle(major, line);
    if (major === 14) {
      this.slLabels = slLabelWords(T.slice(3));
      return;
    }
    if (major >= 20 && major <= 25) return this.slDef(major);
    if (major === 270) {
      // 49차: 사이클 270 윤곽 트레인 자료(설명서 9.9절 290쪽 — 정의하면 바로 쓰고 사이클 25의 접근·이탈·보정을 정함, 지금 가공 사이클은 그대로)
      this.ct270 = true;
      return;
    }
    this.cycle = { n: major, ok: false };
    this.w.add(`CYCL DEF ${num}은 지원하지 않음(호출해도 그리지 않음)`, line);
  }

  /** SL 사이클 정의: 20(윤곽 자료)은 정의하면 바로 쓰고(지금 가공 사이클은 그대로), 21~24는 CYCL CALL·M99로 부른다(설명서 9.4~9.8절) */
  private slDef(n: number): void {
    if (n === 20) this.slData = true;
    else this.cycle = { n, ok: true };
  }

  /**
   * 좌표 변환(8 대칭·10 회전·11/26 배율)을 원점 이동(7·TRANS DATUM) 둘레의 출력 변환으로:
   * 화면 = 원점 + M(R(S(p - 원점))) — 원점 이동 → 대칭 → 회전 → 배율 차례(Heidenhain)
   */
  private updateXf(): void {
    const sh = this.shift;
    const s = this.scaleF;
    let L = composeAffine(diagAbout(ZERO3, this.mirror), rotAbout(ZERO3, this.rotDeg, this.plane));
    L = composeAffine(L, composeAffine(diagAbout(ZERO3, [s, s, s]), diagAbout(this.center26, this.scale26)));
    if (isIdentityAffine(L)) {
      this.setOutXf(null);
      return;
    }
    this.setOutXf(composeAffine(composeAffine(translateAffine(sh), L), translateAffine([-sh[0]!, -sh[1]!, -sh[2]!])));
  }

  /** TRANS DATUM AXIS X… Y…(원점 이동)·TRANS DATUM RESET */
  private transDatum(T: string[], line: number): void {
    const what = (T[2] ?? '').toUpperCase();
    if ((T[1] ?? '').toUpperCase() !== 'DATUM') {
      this.w.add(`${T.slice(0, 2).join(' ')} 블록은 지원하지 않음`, line);
      return;
    }
    if (what === 'RESET') this.shift = [0, 0, 0];
    else if (what === 'AXIS') {
      for (const w of T.slice(3)) {
        const m = /^(I?)([XYZ])(.+)$/i.exec(w);
        if (!m) continue;
        const a = AXES.indexOf(m[2]!.toUpperCase());
        const v = this.value(m[3]!);
        this.shift[a] = m[1] ? this.shift[a]! + v : v;
      }
    } else {
      this.w.add(`TRANS DATUM ${what}(원점 표)는 읽지 않음`, line);
      return;
    }
    this.updateXf();
  }

  /**
   * PATTERN DEF(34차): HEIDENHAIN 공식 설명서(TNC 640 가공 사이클 프로그래밍 34059x-17, 2022-10, 3.3절 — TNC 320 771851-06, 2018-10, 3.3절도 같음)의
   * 입력 값대로 블록 안 요소마다 가공 위치를 더한다(새 PATTERN DEF 블록이면 새 패턴). 위치는 작업 평면(공구 축 Z) X·Y이고 원점 이동은 CYCL CALL PAT 때 더한다.
   * 시작점·중심은 절대, 간격은 증분, 각은 작업 평면 첫 축(X)에서 잰다. Z는 사이클의 공작물 윗면(Q203)에 더하는 높이(없으면 0).
   * - POS(X Y Z): 그 자리 하나. 둘째부터는 IX·IY·IZ(앞 자리에서 증분)도 된다.
   *   /POS(36차 — TNC7 가공 사이클 설명서 81762x-19, 2024-09, 7.6.1절)는 정의한 자리를 숨긴 것이라 가공하지 않는다(다음 POS의 증분 기준으로는 남는다)
   * - ROW(X Y D NUM ROT Z): 시작점에서 ROT 방향으로 간격 D씩 NUM개
   * - PAT(X Y DX DY NUMX NUMY ROT ROTX ROTY Z): 시작점에서 열(첫 축 쪽, 간격 DX) NUMX개 × 줄(둘째 축 쪽, 간격 DY) NUMY개. 패턴 전체를 ROT만큼 시작점 둘레로 돌리고,
   *   ROTX·ROTY는 거기에 첫 축·둘째 축만 더 돌린다(일그러뜨린 패턴). 위치 차례는 설명서에 없어 줄마다 첫 열부터(정한 것 — 사이클 221과 같음)
   * - CIRC(X Y D START NUM Z): 중심·지름 D 원 위에 START 각에서 고르게 NUM개
   * - PITCHCIRC(X Y D START STEP NUM Z): 같은 원 위 START 각에서 STEP 각씩 NUM개(STEP 대신 끝 각으로 준 꼴은 낱말을 몰라 빼고 경고)
   * - FRAME: 설명서 글로는 어느 자리인지(테두리만인지) 정할 수 없어 빼고 경고
   * 값이 모자라거나 수가 0 이상 정수가 아니면 그 요소는 빼고 경고. 한 패턴에 PATTERN_MAX개까지
   */
  private patternDef(text: string, line: number, cont: boolean): void {
    if (!cont || !this.pattern) {
      this.pattern = [];
      this.patternLast = null;
    }
    this.patternOpen = true;
    this.patternTable = false;
    const out = this.pattern;
    const re = /(\/\s*)?\b(POS|ROW|PAT|FRAME|CIRC|PITCHCIRC)(\d*)\s*\(([^)]*)\)/gi;
    const deg = Math.PI / 180;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const kind = m[2]!.toUpperCase();
      if (kind === 'FRAME') {
        this.w.add('PATTERN DEF FRAME(테두리 꼴)은 지원하지 않음 — 그 자리는 빼고 그림', line);
        continue;
      }
      const W = tokenize(m[4]!);
      const get = (k: string): number | undefined => {
        const s = findWord(W, k);
        return s === undefined ? undefined : this.value(s);
      };
      let ok = true;
      const need = (k: string): number => {
        const v = get(k);
        if (v === undefined) ok = false;
        return v ?? 0;
      };
      const count = (k: string): number => {
        const v = get(k);
        if (v === undefined || !Number.isInteger(v) || v < 0) {
          ok = false;
          return 0;
        }
        return v;
      };
      const room = PATTERN_MAX - out.length;
      const pts: [number, number][] = [];
      let z = get('Z') ?? 0;
      let want = 0;
      if (kind === 'POS') {
        // 둘째 자리부터 증분(IX·IY·IZ)은 앞 자리에서(숨긴 /POS도 앞 자리)
        const prev = this.patternLast;
        const axis = (k: 'X' | 'Y' | 'Z', base: number | undefined): number | undefined => {
          const a = get(k);
          if (a !== undefined) return a;
          const i = get('I' + k);
          return i === undefined || base === undefined ? undefined : base + i;
        };
        const x = axis('X', prev?.x);
        const y = axis('Y', prev?.y);
        z = axis('Z', prev?.z) ?? 0;
        if (x === undefined || y === undefined) ok = false;
        else if (m[1]) {
          // 숨긴 자리: 정의만 남기고 가공하지 않는다
          this.patternLast = { x, y, z };
          continue;
        } else {
          want = 1;
          if (room > 0) pts.push([x, y]);
        }
      } else if (kind === 'ROW') {
        const x = need('X');
        const y = need('Y');
        const d = need('D');
        const n = count('NUM');
        const rot = (get('ROT') ?? 0) * deg;
        want = n;
        if (ok) for (let k = 0; k < n && k < room; k++) pts.push([x + k * d * Math.cos(rot), y + k * d * Math.sin(rot)]);
      } else if (kind === 'PAT') {
        const x = need('X');
        const y = need('Y');
        const dx = need('DX');
        const dy = need('DY');
        const nx = count('NUMX');
        const ny = count('NUMY');
        const rot = get('ROT') ?? 0;
        const ax = (rot + (get('ROTX') ?? 0)) * deg;
        const ay = (rot + (get('ROTY') ?? 0)) * deg;
        want = nx * ny;
        if (ok)
          for (let j = 0; j < ny && pts.length < room; j++)
            for (let i = 0; i < nx && pts.length < room; i++)
              pts.push([x + i * dx * Math.cos(ax) - j * dy * Math.sin(ay), y + i * dx * Math.sin(ax) + j * dy * Math.cos(ay)]);
      } else {
        // CIRC·PITCHCIRC
        const x = need('X');
        const y = need('Y');
        const r = need('D') / 2;
        const start = get('START') ?? 0;
        const n = count('NUM');
        const step = kind === 'CIRC' ? 360 / Math.max(1, n) : need('STEP');
        want = n;
        if (ok) for (let k = 0; k < n && k < room; k++) pts.push([x + r * Math.cos((start + k * step) * deg), y + r * Math.sin((start + k * step) * deg)]);
      }
      if (!ok) {
        this.w.add(`PATTERN DEF ${kind}: 값이 모자라거나 맞지 않아 그 자리는 빼고 그림`, line);
        continue;
      }
      if (want > pts.length) this.w.add(`PATTERN DEF ${kind}: 가공 위치가 ${PATTERN_MAX}개를 넘어 거기까지 그림`, line);
      for (const [u, v] of pts) out.push({ x: u, y: v, z });
      if (pts.length) this.patternLast = out[out.length - 1]!;
    }
  }

  /**
   * CYCL CALL PAT(34차): 마지막에 정의한 사이클을 PATTERN DEF의 가공 위치마다 부른다. 설명서(3.1·3.3·3.4절)대로
   * - 위치 사이의 안전 높이 = CYCL CALL PAT 자리의 공구 축 좌표와 2차 안전 거리(공작물 윗면 + Q204) 가운데 높은 쪽.
   *   GLOBAL DEF 125의 Q345=1이면 늘 2차 안전 거리. 윗면이 다른 위치가 섞이면 가장 높은 윗면으로(설명서: 점 패턴의 안전 높이는 패턴 안 모든 Z의 최댓값으로 셈)
   * - 공구 축은 급속(FMAX)으로 올리고, 작업 평면은 그 블록의 F(없으면 마지막 이송, FMAX면 급속)로 옮긴 뒤 사이클을 부른다. 위치마다 끝나면 안전 높이로 올린다
   * - 위치마다 공작물 윗면은 Q203 + 패턴의 Z(사이클이 읽는 Q203을 잠시 바꾸고 되돌린다). 원점 이동은 지금 것을 더한다
   * 200~209·240·251~257(지금 자리에서 하는 사이클)만 — 예전 꼴 사이클 1·2·17과 시작점을 따로 받는 232는 부르지 않고 경고.
   * PATTERN DEF는 공구 축 Z에서만 쓴다(다른 축이면 경고). 점 표(SEL PATTERN)는 읽지 않는다
   */
  private cycleCallPat(T: string[], line: number): void {
    const pts = this.pattern;
    if (!pts) {
      this.w.add(this.patternTable ? 'SEL PATTERN 점 표는 읽지 않아 CYCL CALL PAT를 그리지 않음' : 'PATTERN DEF 없이 CYCL CALL PAT — 그리지 않음', line);
      return;
    }
    const c = this.cycle;
    if (!c) {
      this.w.add('정의된 드릴 사이클 없이 CYCL CALL', line);
      return;
    }
    if (!c.ok) return;
    if (c.n < 200 || c.n === 232) {
      this.w.add(`CYCL CALL PAT: 사이클 ${c.n}은 가공 위치마다 부르지 않음 — 그리지 않음`, line);
      return;
    }
    if (this.plane !== 0) {
      this.w.add('PATTERN DEF는 공구 축 Z에서만 씀 — CYCL CALL PAT를 그리지 않음', line);
      return;
    }
    const f = findWord(T, 'F');
    if (f !== undefined) this.feed = this.value(f);
    const fmax = T.some((w) => w.toUpperCase() === 'FMAX');
    this.mWords(T, line, true);
    if (!pts.length) return;
    const q203 = this.q.get('Q203');
    const sh = this.shift;
    let top = -Infinity;
    for (const p of pts) top = Math.max(top, p.z);
    const clear = (q203 ?? 0) + top + sh[2]! + Math.abs(this.q.get('Q204') ?? 0);
    const h = this.q.get('Q345') === 1 ? clear : Math.max(this.pos[2]!, clear);
    const lift = (): void => {
      if (this.pos[2]! < h - 1e-9) this.emit(MOVE_RAPID, this.pos[0]!, this.pos[1]!, h, line, FLAG_CYCLE);
    };
    try {
      for (const p of pts) {
        // 한 블록에서 이동 한도를 넘지 않게(넘으면 run이 경고하고 멈춘다)
        if (this.mb.full()) break;
        lift();
        this.emit(fmax ? MOVE_RAPID : MOVE_FEED, p.x + sh[0]!, p.y + sh[1]!, this.pos[2]!, line, FLAG_CYCLE);
        this.known = 7;
        this.q.set('Q203', (q203 ?? 0) + p.z);
        this.cycleCall(line);
      }
      lift();
    } finally {
      if (q203 === undefined) this.q.delete('Q203');
      else this.q.set('Q203', q203);
    }
  }

  /** 지금 위치에서 드릴 사이클 실행 */
  private cycleCall(line: number): void {
    const c = this.cycle;
    if (!c) {
      this.w.add('정의된 드릴 사이클 없이 CYCL CALL', line);
      return;
    }
    if (!c.ok) return;
    if (MILL_CYCLES.has(c.n)) return this.millCycle(c.n, line);
    if (c.n >= 21 && c.n <= 24) return this.slCycle(c.n, line);
    if (c.n === 25) return this.slTrainCycle(line);
    const [p0, p1, da] = PLANE_AXES[this.plane]!;
    const Q = (k: string, d: number): number => this.q.get(k) ?? d;
    let setup: number;
    let depth: number;
    let peck: number;
    let surface: number;
    let second: number;
    let feed: number;
    let dwellBottom = 0;
    if (c.n === 1 || c.n === 2 || c.n === 17) {
      // 예전 꼴: 지금 위치가 안전 거리 위
      setup = Math.abs(Q('OLDO1', 2));
      depth = Q('OLDO2', 0);
      peck = c.n === 1 ? Math.abs(Q('OLDO3', 0)) : 0;
      dwellBottom = Q('OLDO4', 0);
      feed = Q('OLDO5', this.feed);
      surface = this.pos[da]! - setup;
      second = setup;
    } else {
      setup = Math.abs(Q('Q200', 2));
      depth = Q('Q201', 0);
      peck = c.n === 200 || c.n === 203 || c.n === 205 ? Math.abs(Q('Q202', 0)) : 0;
      surface = Q('Q203', 0) + this.shift[da]!;
      second = Math.abs(Q('Q204', 0));
      feed = Q('Q206', this.feed || this.autoFeed);
      dwellBottom = Q('Q211', 0);
      if (c.n === 240) depth = Q('Q201', depth);
    }
    if (depth === 0) {
      this.w.add('드릴 사이클 깊이(Q201)가 0', line);
      return;
    }
    const up = depth < 0 ? 1 : -1;
    const rD = surface + up * setup;
    const zD = surface + depth;
    const clear = surface + up * Math.max(setup, second);
    const saveFeed = this.feed;
    const pt = [0, 0, 0];
    const go = (kind: number, d: number): void => {
      pt[p0] = this.pos[p0]!;
      pt[p1] = this.pos[p1]!;
      pt[da] = d;
      this.emit(kind, pt[0]!, pt[1]!, pt[2]!, line, FLAG_CYCLE);
    };
    go(MOVE_RAPID, rD);
    this.feed = feed;
    const first = this.mb.count;
    if (peck > 0) {
      // 절입 깊이는 공작물 윗면(Q203)부터 잰다
      let d = surface;
      let first = true;
      let guard = 0;
      while (up * (d - zD) > 1e-9 && guard++ < PECK_MAX) {
        const next = up > 0 ? Math.max(zD, d - peck) : Math.min(zD, d + peck);
        if (!first) go(MOVE_RAPID, d + up * Math.min(setup, 0.5));
        go(MOVE_DRILL, next);
        if (next !== zD) go(MOVE_RAPID, rD);
        d = next;
        first = false;
      }
      // 안전장치에 닿아 바닥 앞에서 멈췄다(그 깊이에서 물러나는 그대로 그린다)
      if (up * (d - zD) > 1e-9) this.guardStop(`CYCL DEF ${c.n}: 쪼기가 ${PECK_MAX}번을 넘어 바닥에 닿기 전에 멈춤`, line);
    } else go(MOVE_DRILL, zD);
    this.dwell(dwellBottom);
    if (c.n === 201 || c.n === 206 || c.n === 207 || c.n === 209 || c.n === 2 || c.n === 17) go(MOVE_FEED, rD);
    go(MOVE_RAPID, clear);
    if (this.mb.count > first) {
      const top = [0, 0, 0];
      top[p0] = this.pos[p0]!;
      top[p1] = this.pos[p1]!;
      top[da] = rD;
      const bottom = [top[0]!, top[1]!, top[2]!];
      bottom[da] = zD;
      // 이동 한도에 막혀 바닥에 닿지 못한 구멍은 구멍 표에 넣지 않는다(뚫린 깊이가 다르다)
      if (this.holeDrawn(first, bottom)) this.pushHoleOut(top, bottom, line, c.n, first);
    }
    this.feed = saveFeed;
  }

  /** CYCL DEF 220(원 패턴)·221(격자 패턴): 점마다 두 번째 안전 높이로 옮겨 앞 사이클을 부른다 */
  private patternCycle(n: number, line: number): void {
    if (!this.cycle || !this.cycle.ok) {
      this.w.add(`CYCL DEF ${n}: 부를 드릴 사이클이 없음`, line);
      return;
    }
    const Q = (k: string, d = 0): number => this.q.get(k) ?? d;
    const [p0, p1, da] = PLANE_AXES[this.plane]!;
    const clear = Q('Q203') + this.shift[da]! + Math.max(Math.abs(Q('Q200', 2)), Math.abs(Q('Q204')));
    const t = [0, 0, 0];
    const visit = (u: number, v: number): void => {
      t[p0] = this.pos[p0]!;
      t[p1] = this.pos[p1]!;
      t[da] = Math.max(this.pos[da]!, clear);
      this.emit(MOVE_RAPID, t[0]!, t[1]!, t[2]!, line, FLAG_CYCLE);
      t[p0] = u + this.shift[p0]!;
      t[p1] = v + this.shift[p1]!;
      this.emit(MOVE_RAPID, t[0]!, t[1]!, t[2]!, line, FLAG_CYCLE);
      this.known = 7;
      this.cycleCall(line);
    };
    // 점 수(Q241·Q242 × Q243)가 아주 크면 이동 한도에서 멈추도록 점을 모아 두지 않는다
    const more = this.blockLoop();
    if (n === 221) {
      const cols = Math.max(1, Math.round(Q('Q242', 1)));
      const rows = Math.max(1, Math.round(Q('Q243', 1)));
      const rot = (Q('Q224') * Math.PI) / 180;
      const x0 = Q('Q225');
      const y0 = Q('Q226');
      for (let j = 0; j < rows && !this.mb.overflow; j++)
        for (let i = 0; i < cols && more(); i++) {
          const dx = i * Q('Q237');
          const dy = j * Q('Q238');
          visit(x0 + dx * Math.cos(rot) - dy * Math.sin(rot), y0 + dx * Math.sin(rot) + dy * Math.cos(rot));
        }
    } else {
      const cx = Q('Q216');
      const cy = Q('Q217');
      const r = Q('Q244') / 2;
      const a0 = Q('Q245');
      const a1 = Q('Q246', 360);
      const cnt = Math.max(1, Math.round(Q('Q241', 1)));
      let step = Q('Q247');
      const full = Math.abs(Math.abs(a1 - a0) - 360) < 1e-9;
      if (!step) step = cnt > 1 ? (a1 - a0) / (full ? cnt : cnt - 1) : 0;
      for (let k = 0; k < cnt && more(); k++) {
        const a = ((a0 + k * step) * Math.PI) / 180;
        visit(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
    }
  }

  /** 표지 줄(여러 파일을 함께 열었으면 지금 줄이 든 프로그램 구획 안에서만 — 표지는 프로그램마다 따로) */
  private findLabel(name: string, at: number): number {
    if (!this.labels) {
      this.labels = new Map();
      // 평문 LBL 이름, DIN/ISO G98 L 번호
      const re = this.iso ? /^\s*(?:N?\d+\s+)?G98\s+L\s*(\d+)\b/i : /^\s*(?:N?\d+\s+)?LBL\s+("[^"]*"|[^"\s;]+)/i;
      for (let i = 0; i < this.src.lineCount; i++) {
        const m = re.exec(sourceLine(this.src, i));
        if (!m) continue;
        const key = `${this.multi ? this.sectionAt(i) : 0}:${m[1]!.toUpperCase()}`;
        if (!this.labels.has(key)) this.labels.set(key, i);
      }
    }
    return this.labels.get(`${this.multi ? this.sectionAt(at) : 0}:${name.toUpperCase()}`) ?? -1;
  }

  // ── 다른 프로그램 부르기(CALL PGM, DIN/ISO %이름) — 함께 연 파일·같은 글의 BEGIN PGM 구획 ──
  private pgmIndex(): { names: string[]; head: number; body: number; end: number; job: boolean }[] {
    if (this.pgms) return this.pgms;
    const out: { names: string[]; head: number; body: number; end: number; job: boolean }[] = [];
    const reBegin = /^\s*(?:N?\d+\s+)?BEGIN\s+PGM\s+("[^"]*"|\S+)/i;
    const reIso = /^\s*%([^\s*;]+)\s+G7[01]\b/i;
    const jobs = jobFileLines(this.src);
    let last: (typeof out)[number] | null = null;
    for (let i = 0; i < this.src.lineCount; i++) {
      const job = jobs?.get(i);
      if (job !== undefined) {
        last = { names: [pgmBase(job)], head: i, body: i + 1, end: this.src.lineCount, job: true };
        out.push(last);
        continue;
      }
      const t = sourceLine(this.src, i);
      const m = reBegin.exec(t) ?? reIso.exec(t);
      if (!m) continue;
      if (last?.job && last.names.length === 1) {
        // 함께 연 파일의 머리: 파일 이름과 프로그램 이름 모두로 부를 수 있다
        last.names.push(pgmBase(m[1]!));
        last.body = i + 1;
      } else {
        last = { names: [pgmBase(m[1]!)], head: i, body: i + 1, end: this.src.lineCount, job: false };
        out.push(last);
      }
    }
    // 주 프로그램에 머리가 없으면(조각) 맨 앞을 주 프로그램 구획으로
    if (!out.length || out[0]!.job) out.unshift({ names: [pgmBase(this.name)], head: 0, body: 0, end: this.src.lineCount, job: false });
    for (let k = 0; k < out.length - 1; k++) out[k]!.end = out[k + 1]!.head;
    return (this.pgms = out);
  }

  /** 줄 i가 든 프로그램 구획 번호(첫 머리 앞이면 0) */
  private sectionAt(i: number): number {
    const p = this.pgmIndex();
    let k = 0;
    while (k + 1 < p.length && p[k + 1]!.head <= i) k++;
    return k;
  }

  private callPgm(arg: string, line: number): void {
    const want = pgmBase(arg);
    const p = this.pgmIndex();
    const cur = this.sectionAt(line);
    const target = p.findIndex((s, k) => k !== cur && s.names.includes(want));
    if (target < 0) {
      this.missingProgram(want, `CALL PGM ${want}: 프로그램을 찾지 못함 — 다른 파일이면 함께 열어야 읽음`, line);
      return;
    }
    if (this.stack.length > 64) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    const s = p[target]!;
    this.stack.push({ ret: this.pc, reps: 1, start: s.body, pgmEnd: s.end });
    this.pc = s.body;
  }

  /** 불린 프로그램의 끝(END PGM·구획 끝): 부른 곳으로 돌아간다. 불린 프로그램 안이 아니면 false */
  private returnPgm(): boolean {
    let k = this.stack.length - 1;
    while (k >= 0 && this.stack[k]!.pgmEnd === undefined) k--;
    if (k < 0) return false;
    this.pc = this.stack[k]!.ret;
    this.stack.length = k;
    return true;
  }

  private callLbl(T: string[], line: number): void {
    const name = T[2] ?? '';
    const target = this.findLabel(name, line);
    if (target < 0) {
      this.w.add(`CALL LBL ${name}: 표지가 없음`, line);
      return;
    }
    const repTok = T.findIndex((x) => /^REP/i.test(x));
    let rep = 0;
    if (repTok >= 0) {
      const v = /^REP(\d+)?/i.exec(T[repTok]!)![1] ?? T[repTok + 1];
      rep = parseInt(v ?? '0', 10) || 0;
    }
    if (target < line && repTok < 0 && this.lbl0Between(target, line)) {
      // REP 없이 앞쪽 표지를 부르고 그 사이에 LBL 0이 있으면 부프로그램 호출
      if (this.stack.length > 64) {
        this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
        this.ended = true;
        return;
      }
      this.stack.push({ ret: this.pc, reps: 1, start: target + 1 });
      this.pc = target + 1;
      return;
    }
    if (target < line) {
      // 구간 반복: LBL과 CALL 사이를 rep번 더
      if (repTok < 0) this.w.add(`CALL LBL ${name}: REP 없는 앞쪽 표지(구간 반복 0번) — 아무것도 하지 않음`, line);
      const left = this.sectionReps.get(line) ?? rep;
      if (left > 0) {
        this.sectionReps.set(line, left - 1);
        this.pc = target + 1;
      } else this.sectionReps.delete(line);
      return;
    }
    if (this.stack.length > 64) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    this.stack.push({ ret: this.pc, reps: Math.max(1, rep + (rep > 0 ? 1 : 0)), start: target + 1 });
    this.pc = target + 1;
  }

  /** 줄 a와 b 사이에 LBL 0이 있는지 */
  private lbl0Between(a: number, b: number): boolean {
    const re = this.iso ? /^\s*(?:N?\d+\s+)?G98\s+L\s*0\b/i : /^\s*(?:N?\d+\s+)?LBL\s+"?0"?\s*(?:;|$)/i;
    for (let i = a + 1; i < b; i++) if (re.test(sourceLine(this.src, i))) return true;
    return false;
  }

  private fn(b: HBlock, line: number): void {
    const m = /^FN\s*(\d+)\s*:\s*(.*)$/i.exec(b.text);
    if (!m) return;
    const k = +m[1]!;
    const body = m[2]!.trim();
    if (k <= 8 || k === 13) {
      const a = /^(Q[LRS]?\d+)\s*=\s*(.+)$/i.exec(body);
      if (!a) return;
      let e = a[2]!;
      if (k === 4) e = e.replace(/\bDIV\b/gi, '/');
      if (k === 5) e = `SQRT(${e.replace(/^SQRT\s*/i, '')})`;
      if (k === 6) e = `SIN(${e.replace(/^SIN\s*/i, '')})`;
      if (k === 7) e = `COS(${e.replace(/^COS\s*/i, '')})`;
      if (k === 8) {
        const [x, y] = e.split(/\bLEN\b/i);
        e = `SQRT((${x})^2+(${y ?? 0})^2)`;
      }
      if (k === 13) {
        const [x, y] = e.split(/\bANG\b/i);
        e = `ATAN2(${y ?? 0},${x})`;
      }
      this.q.set(a[1]!.toUpperCase(), this.expr(e));
      return;
    }
    if (k >= 9 && k <= 12) {
      const c = /^IF\s+(.+?)\s+(EQU|NE|GT|LT)\s+(.+?)\s+GOTO\s+LBL\s+(\S+)/i.exec(body);
      if (!c) return;
      const x = this.value(c[1]!);
      const y = this.value(c[3]!);
      const op = c[2]!.toUpperCase();
      const ok = op === 'EQU' ? Math.abs(x - y) < 1e-9 : op === 'NE' ? Math.abs(x - y) >= 1e-9 : op === 'GT' ? x > y : x < y;
      if (ok) {
        const t = this.findLabel(c[4]!, line);
        if (t >= 0) this.pc = t + 1;
        else this.w.add(`FN ${k}: LBL ${c[4]}이 없음`, line);
      }
      return;
    }
    if (k === 14) {
      this.w.add('FN 14 오류 신호 — 멈춤', line);
      this.ended = true;
      return;
    }
    this.w.add(`FN ${k}은 지원하지 않음`, line);
  }

  private qAssign(text: string): void {
    const a = /^(Q[LRS]?\d+)\s*=\s*(.+)$/i.exec(text);
    // QS(글 변수)는 좌표에 쓰이지 않는다
    if (!a || /^QS/i.test(a[1]!) || a[2]!.trim().startsWith('"')) return;
    this.q.set(a[1]!.toUpperCase(), this.value(a[2]!));
  }

  /** M 낱말 처리. 블록 끝에서 할 일(M99 사이클 호출)은 afterMove로 */
  private mWords(T: string[], line: number, inCycleCall: boolean): { m99: boolean } {
    let m99 = false;
    for (const w of T) {
      const m = /^M(\d+)$/i.exec(w);
      if (!m) continue;
      const n = +m[1]!;
      if (n === 3 || n === 13) this.spindleDir = 3;
      else if (n === 4 || n === 14) this.spindleDir = 4;
      else if (n === 5 || n === 0) this.spindleDir = 0;
      if (n === 7 || n === 8 || n === 13 || n === 14) this.coolant = true;
      else if (n === 9) this.coolant = false;
      else if (n === 99) m99 = !inCycleCall;
      else if (n === 89) this.modalCall = true;
      else if (n === 2 || n === 30) {
        // 부프로그램(LBL)이 M30 뒤에 오는 것이 흔하다 — 끝
        this.ended = true;
      } else if (n === 140) this.w.add('M140(공구 축 방향 물러나기)은 그리지 않음', line);
    }
    return { m99 };
  }

  /** 낱말에서 좌표 읽기(I 증분, Q 변수, 원점 이동 반영). 주어지지 않은 축은 undefined */
  private coords(T: string[]): (number | undefined)[] {
    const out: (number | undefined)[] = [undefined, undefined, undefined];
    for (const w of T.slice(1)) {
      const m = /^(I?)([XYZ])([+-]?[\d.]*Q?[LRS]?\d*[\d.]*)$/i.exec(w);
      if (!m || m[3] === '') continue;
      const a = AXES.indexOf(m[2]!.toUpperCase());
      const v = this.value(m[3]!);
      out[a] = m[1] ? this.pos[a]! + v : v + this.shift[a]!;
    }
    return out;
  }

  /** 반경 보정·이송·M 낱말 */
  private modal(T: string[], line: number): { rapid: boolean; m99: boolean; machine: number } {
    let rapid = false;
    /** 0 = 아님, 91 = M91(기계 원점 기준), 92 = M92(기계 고정점 기준) */
    let machine = 0;
    const compBefore = this.comp;
    for (let i = 1; i < T.length; i++) {
      const w = T[i]!.toUpperCase();
      if (w === 'R0') this.comp = 0;
      else if (w === 'RL') this.comp = 1;
      else if (w === 'RR') this.comp = 2;
      else if (w === 'FMAX') rapid = true;
      else if (w === 'FAUTO' || (w === 'F' && (T[i + 1] ?? '').toUpperCase() === 'AUTO')) this.feed = this.autoFeed;
      else if (/^F[+-]?[\d.]+$/.test(w) || /^F[+-]?Q/.test(w)) this.feed = this.value(w.slice(1));
      else if (w === 'M91') machine = 91;
      else if (w === 'M92') machine = 92;
    }
    // 윤곽 부프로그램(SL 사이클): 보정은 윤곽의 쪽을 정할 뿐이고 이송·M 기능은 읽지 않는다(설명서 9.1절 266쪽)
    if (this.cap) return { rapid, m99: false, machine: 0 };
    if (this.comp !== compBefore) this.compNote(line);
    const { m99 } = this.mWords(T, line, false);
    return { rapid, m99, machine };
  }

  private afterMove(m99: boolean, line: number): void {
    if (this.cap) return;
    if (m99 || this.modalCall) this.cycleCall(line);
  }

  private setDir(x0: number, y0: number, x1: number, y1: number): void {
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l > 1e-12) this.lastDir = [(x1 - x0) / l, (y1 - y0) / l];
  }

  private linear(T: string[], line: number): void {
    const c = this.coords(T);
    const { rapid, m99, machine } = this.modal(T, line);
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const s0 = this.pos[a0]!;
    const s1 = this.pos[a1]!;
    if (machine && c.some((v) => v !== undefined)) {
      const mo = this.o.machineOffset;
      if (machine === 91 && mo) {
        // M91 값은 기계 원점 기준: 공작물 원점의 기계 좌표를 알면 실제 위치로
        for (let a = 0; a < 3; a++) if (c[a] !== undefined) c[a] = c[a]! - this.shift[a]! - mo[a]!;
      } else {
        const mask = (c[0] !== undefined ? 1 : 0) | (c[1] !== undefined ? 2 : 0) | (c[2] !== undefined ? 4 : 0);
        this.machSafeAxes = 1 << PLANE_AXES[this.plane]![2];
        this.w.add(`M${machine} 기계 좌표 쪽 이동 — 작업 원점의 기계 위치를 몰라 공구 축을 안전 높이(경로 맨 위 + 여유)로 그림`, line);
        if (this.machineRetract(mask, line, rapid ? MOVE_RAPID : MOVE_FEED)) this.w.add(`M${machine} X·Y 기계 위치를 몰라 그 축은 제자리에 둠`, line);
        return this.afterMove(m99, line);
      }
    }
    const x = c[0] ?? this.pos[0]!;
    const y = c[1] ?? this.pos[1]!;
    const z = c[2] ?? this.pos[2]!;
    if (c.some((v) => v !== undefined)) {
      this.emit(rapid ? MOVE_RAPID : MOVE_FEED, x, y, z, line, machine ? FLAG_MACHINE : 0);
      this.known |= (c[0] !== undefined ? 1 : 0) | (c[1] !== undefined ? 2 : 0) | (c[2] !== undefined ? 4 : 0);
      this.setDir(s0, s1, this.pos[a0]!, this.pos[a1]!);
    }
    this.afterMove(m99, line);
  }

  private pole(T: string[]): void {
    const [a0, a1] = PLANE_AXES[this.plane]!;
    let u = this.pos[a0]!;
    let v = this.pos[a1]!;
    for (const w of T.slice(1)) {
      const m = /^(I?)([XYZ])(.+)$/i.exec(w);
      if (!m) continue;
      const a = AXES.indexOf(m[2]!.toUpperCase());
      const val = this.value(m[3]!);
      const abs = m[1] ? this.pos[a]! + val : val + this.shift[a]!;
      if (a === a0) u = abs;
      else if (a === a1) v = abs;
    }
    this.cc = [u, v];
  }

  private drWord(T: string[]): number {
    for (const w of T) {
      const u = w.toUpperCase();
      if (u === 'DR+') return 1;
      if (u === 'DR-') return -1;
    }
    return this.dr;
  }

  private arcTo(cu: number, cv: number, ccw: boolean, x: number, y: number, z: number, line: number, extraTurns = 0): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const s = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    const e = [x, y, z];
    const u0 = s[a0]! - cu;
    const v0 = s[a1]! - cv;
    const u1 = e[a0]! - cu;
    const v1 = e[a1]! - cv;
    const r0 = Math.hypot(u0, v0);
    if (r0 < 1e-9) {
      this.w.add('원호 반지름이 0 — 직선으로 그림', line);
      this.emit(MOVE_FEED, x, y, z, line);
      return;
    }
    if (Math.abs(r0 - Math.hypot(u1, v1)) > Math.max(this.tol, r0 * 1e-3)) this.w.add('원호 시작·끝 반지름이 다름(나선형으로 이어 그림)', line);
    const TAU = Math.PI * 2;
    const same = Math.hypot(u1 - u0, v1 - v0) <= Math.max(1e-7, r0 * 1e-9);
    let sweep = Math.atan2(v1, u1) - Math.atan2(v0, u0);
    if (ccw) {
      if (same) sweep = TAU;
      else while (sweep <= 0) sweep += TAU;
    } else if (same) sweep = -TAU;
    else while (sweep >= 0) sweep -= TAU;
    sweep += (ccw ? 1 : -1) * TAU * extraTurns;
    const c = [0, 0, 0];
    c[a0] = cu;
    c[a1] = cv;
    c[a2] = s[a2]!;
    this.emitArc(this.plane, c, sweep, x, y, z, line);
    // 끝 접선
    const t = Math.atan2(v1, u1) + (ccw ? Math.PI / 2 : -Math.PI / 2);
    this.lastDir = [Math.cos(t), Math.sin(t)];
  }

  private circle(T: string[], line: number): void {
    const c = this.coords(T);
    const { m99 } = this.modal(T, line);
    this.dr = this.drWord(T);
    if (!this.cc) {
      this.w.add('C(원호)에 극(CC)이 없음 — 직선으로 그림', line);
      this.emit(MOVE_FEED, c[0] ?? this.pos[0]!, c[1] ?? this.pos[1]!, c[2] ?? this.pos[2]!, line);
    } else this.arcTo(this.cc[0], this.cc[1], this.dr > 0, c[0] ?? this.pos[0]!, c[1] ?? this.pos[1]!, c[2] ?? this.pos[2]!, line);
    this.afterMove(m99, line);
  }

  private circleR(T: string[], line: number): void {
    const c = this.coords(T);
    const { m99 } = this.modal(T, line);
    this.dr = this.drWord(T);
    const rTok = T.slice(1).find((w) => /^R[+-]?[\d.Q]/i.test(w) && !/^R[LR0]$/i.test(w));
    const x = c[0] ?? this.pos[0]!;
    const y = c[1] ?? this.pos[1]!;
    const z = c[2] ?? this.pos[2]!;
    if (!rTok) {
      this.w.add('CR에 반지름 R이 없음 — 직선으로 그림', line);
      this.emit(MOVE_FEED, x, y, z, line);
      return this.afterMove(m99, line);
    }
    const R = this.value(rTok.slice(1));
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const e = [x, y, z];
    const su = this.pos[a0]!;
    const sv = this.pos[a1]!;
    const du = e[a0]! - su;
    const dv = e[a1]! - sv;
    const d = Math.hypot(du, dv);
    if (d < 1e-9) {
      this.w.add('CR로는 완전한 원을 만들 수 없음', line);
      return this.afterMove(m99, line);
    }
    let r = Math.abs(R);
    if (d / 2 > r) r = d / 2;
    const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
    const ccw = this.dr > 0;
    const side = (ccw ? 1 : -1) * (R < 0 ? -1 : 1);
    const cu = su + du / 2 - (side * h * dv) / d;
    const cv = sv + dv / 2 + (side * h * du) / d;
    this.arcTo(cu, cv, ccw, x, y, z, line);
    this.afterMove(m99, line);
  }

  private circleT(T: string[], line: number): void {
    const c = this.coords(T);
    const { m99 } = this.modal(T, line);
    const x = c[0] ?? this.pos[0]!;
    const y = c[1] ?? this.pos[1]!;
    const z = c[2] ?? this.pos[2]!;
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const t = this.lastDir;
    const e = [x, y, z];
    const su = this.pos[a0]!;
    const sv = this.pos[a1]!;
    const wu = su - e[a0]!;
    const wv = sv - e[a1]!;
    if (!t) {
      this.w.add('CT 앞에 방향을 정할 요소가 없음 — 직선으로 그림', line);
      this.emit(MOVE_FEED, x, y, z, line);
      return this.afterMove(m99, line);
    }
    // 중심 = 시작 + n·k (n = 접선의 왼쪽 법선), |중심 - 끝| = |k|
    const nu = -t[1];
    const nv = t[0];
    const dot = nu * wu + nv * wv;
    if (Math.abs(dot) < 1e-12) {
      this.emit(MOVE_FEED, x, y, z, line);
      this.setDir(su, sv, e[a0]!, e[a1]!);
      return this.afterMove(m99, line);
    }
    const k = -(wu * wu + wv * wv) / (2 * dot);
    this.arcTo(su + nu * k, sv + nv * k, k > 0, x, y, z, line);
    this.afterMove(m99, line);
  }

  private polarParams(T: string[]): { pr?: number; ipr?: number; pa?: number; ipa?: number } {
    const o: { pr?: number; ipr?: number; pa?: number; ipa?: number } = {};
    for (const w of T.slice(1)) {
      const m = /^(I?)(PR|PA)(.+)$/i.exec(w);
      if (!m) continue;
      const v = this.value(m[3]!);
      const key = ((m[1] ? 'i' : '') + m[2]!.toLowerCase()) as 'pr' | 'ipr' | 'pa' | 'ipa';
      o[key] = v;
    }
    return o;
  }

  private linearPolar(T: string[], line: number): void {
    const { rapid, m99 } = this.modal(T, line);
    if (!this.cc) {
      this.w.add('LP에 극(CC)이 없음', line);
      return this.afterMove(m99, line);
    }
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const p = this.polarParams(T);
    const cu = this.cc[0];
    const cv = this.cc[1];
    const r0 = Math.hypot(this.pos[a0]! - cu, this.pos[a1]! - cv);
    const t0 = (Math.atan2(this.pos[a1]! - cv, this.pos[a0]! - cu) * 180) / Math.PI;
    const r = p.pr ?? r0 + (p.ipr ?? 0);
    const a = ((p.pa ?? t0 + (p.ipa ?? 0)) * Math.PI) / 180;
    const c = this.coords(T);
    const e = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    e[a0] = cu + r * Math.cos(a);
    e[a1] = cv + r * Math.sin(a);
    if (c[a2] !== undefined) e[a2] = c[a2]!;
    const su = this.pos[a0]!;
    const sv = this.pos[a1]!;
    this.emit(rapid ? MOVE_RAPID : MOVE_FEED, e[0]!, e[1]!, e[2]!, line);
    this.known = 7;
    this.setDir(su, sv, e[a0]!, e[a1]!);
    this.afterMove(m99, line);
  }

  private circlePolar(T: string[], line: number): void {
    const { m99 } = this.modal(T, line);
    this.dr = this.drWord(T);
    if (!this.cc) {
      this.w.add('CP에 극(CC)이 없음', line);
      return this.afterMove(m99, line);
    }
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const p = this.polarParams(T);
    const cu = this.cc[0];
    const cv = this.cc[1];
    const r = Math.hypot(this.pos[a0]! - cu, this.pos[a1]! - cv);
    const t0 = Math.atan2(this.pos[a1]! - cv, this.pos[a0]! - cu);
    const c = this.coords(T);
    const e = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    if (c[a2] !== undefined) e[a2] = c[a2]!;
    if (p.ipa !== undefined) {
      // 증분 각: 여러 바퀴(나선) 가능
      const sweep = (p.ipa * Math.PI) / 180;
      const t1 = t0 + sweep;
      e[a0] = cu + r * Math.cos(t1);
      e[a1] = cv + r * Math.sin(t1);
      const cc = [0, 0, 0];
      cc[a0] = cu;
      cc[a1] = cv;
      cc[a2] = this.pos[a2]!;
      this.emitArc(this.plane, cc, sweep, e[0]!, e[1]!, e[2]!, line);
      const tt = t1 + (sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.lastDir = [Math.cos(tt), Math.sin(tt)];
    } else {
      const a = p.pa !== undefined ? (p.pa * Math.PI) / 180 : t0;
      e[a0] = cu + r * Math.cos(a);
      e[a1] = cv + r * Math.sin(a);
      this.arcTo(cu, cv, this.dr > 0, e[0]!, e[1]!, e[2]!, line);
    }
    this.afterMove(m99, line);
  }

  // ───────────────────────── FK 자유 윤곽 ─────────────────────────

  /**
   * FK(FPOL·FL·FLT·FC·FCT): 한 블록 안의 자료로 끝점이 정해지는 경우만 그린다.
   * FL: 끝점 X·Y(I 증분), PR·PA(FPOL 기준 극좌표), 방향 AN(IAN = 앞 요소 방향에 더함, FLT = 앞 요소 접선) + LEN 또는 좌표 하나.
   * FC: 방향 DR±, 중심 CCX·CCY(ICC 증분, CCPR·CCPA 극좌표), 반지름 R, 끝점(좌표 둘 또는 하나), FCT = 앞 요소에 접함.
   */
  private fk(kind: string, T: string[], line: number): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    if (kind === 'FPOL') {
      let u = this.fkPole?.[0] ?? this.pos[a0]!;
      let v = this.fkPole?.[1] ?? this.pos[a1]!;
      for (const w of T.slice(1)) {
        const m = /^(I?)([XYZ])(.+)$/i.exec(w);
        if (!m) continue;
        const a = AXES.indexOf(m[2]!.toUpperCase());
        const val = this.value(m[3]!);
        const abs = m[1] ? this.pos[a]! + val : val + this.shift[a]!;
        if (a === a0) u = abs;
        else if (a === a1) v = abs;
      }
      this.fkPole = [u, v];
      return;
    }
    const { rapid, m99 } = this.modal(T, line);
    const c = this.coords(T);
    const su = this.pos[a0]!;
    const sv = this.pos[a1]!;
    let eu = c[a0];
    let ev = c[a1];
    const ew = c[a2] ?? this.pos[a2]!;
    let an: number | undefined;
    let ian: number | undefined;
    let len: number | undefined;
    let rad: number | undefined;
    let ccu: number | undefined;
    let ccv: number | undefined;
    let pr: number | undefined;
    let pa: number | undefined;
    let ccpr: number | undefined;
    let ccpa: number | undefined;
    let rel = false;
    for (let i = 1; i < T.length; i++) {
      const w = T[i]!.toUpperCase();
      let m: RegExpExecArray | null;
      if ((m = /^(I?)AN([+-]?.+)$/.exec(w))) {
        const v = this.value(m[2]!);
        if (m[1]) ian = v;
        else an = v;
      } else if (w === 'LEN') len = this.value(T[++i] ?? '');
      else if ((m = /^LEN([+-]?.+)$/.exec(w))) len = this.value(m[1]!);
      else if ((m = /^(I?)CCP([RA])([+-]?.+)$/.exec(w))) {
        if (m[2] === 'R') ccpr = this.value(m[3]!);
        else ccpa = this.value(m[3]!);
      } else if ((m = /^(I?)CC([XYZ])([+-]?.+)$/.exec(w))) {
        const a = AXES.indexOf(m[2]!);
        const v = this.value(m[3]!);
        const abs = m[1] ? this.pos[a]! + v : v + this.shift[a]!;
        if (a === a0) ccu = abs;
        else if (a === a1) ccv = abs;
      } else if ((m = /^(I?)P([RA])([+-]?.+)$/.exec(w))) {
        if (m[2] === 'R') pr = this.value(m[3]!);
        else pa = this.value(m[3]!);
      } else if ((m = /^R([+-]?(?:[\d.]+|Q[LRS]?\d+))$/.exec(w))) rad = Math.abs(this.value(m[1]!));
      else if (/^(?:RX|RY|RZ|PDX|PDY|PDZ|RAN|RLEN|RCCX|RCCY|RPR|RPA|PAR|PDX\d|RX\d)/.test(w)) rel = true;
    }
    if (rel) this.w.add('FK 상대 자료(RX·PDX·PAR 등, 다른 블록 참조)는 지원하지 않음', line);
    const pole = this.fkPole ?? this.cc;
    if (pr !== undefined && pa !== undefined && pole && (eu === undefined || ev === undefined)) {
      const t = (pa * Math.PI) / 180;
      eu = pole[0] + pr * Math.cos(t);
      ev = pole[1] + pr * Math.sin(t);
    }
    const tangent = kind === 'FLT' || kind === 'FCT' ? this.lastDir : null;
    if ((kind === 'FLT' || kind === 'FCT') && !tangent) this.w.add(`${kind}: 앞에 접선을 정할 요소가 없음`, line);
    const put = (u: number, v: number): number[] => {
      const p = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
      p[a0] = u;
      p[a1] = v;
      p[a2] = ew;
      return p;
    };
    const fail = (why: string): void => {
      this.w.add(`${kind}: ${why} — 다음 블록 자료가 필요한 FK는 그리지 않음`, line);
      if (c[a2] !== undefined) {
        const p = put(su, sv);
        this.emit(MOVE_FEED, p[0]!, p[1]!, p[2]!, line);
      }
      this.afterMove(m99, line);
    };
    if (kind === 'FL' || kind === 'FLT') {
      // 방향
      let dir: [number, number] | null = null;
      if (an !== undefined) dir = [Math.cos((an * Math.PI) / 180), Math.sin((an * Math.PI) / 180)];
      else if (ian !== undefined && this.lastDir) {
        const t = Math.atan2(this.lastDir[1], this.lastDir[0]) + (ian * Math.PI) / 180;
        dir = [Math.cos(t), Math.sin(t)];
      } else if (tangent) dir = [tangent[0], tangent[1]];
      if (eu === undefined || ev === undefined) {
        if (dir && len !== undefined) {
          eu = su + dir[0] * len;
          ev = sv + dir[1] * len;
        } else if (dir && eu !== undefined && Math.abs(dir[0]) > 1e-12) {
          ev = sv + ((eu - su) / dir[0]) * dir[1];
        } else if (dir && ev !== undefined && Math.abs(dir[1]) > 1e-12) {
          eu = su + ((ev - sv) / dir[1]) * dir[0];
        } else if (eu === undefined && ev === undefined && len === undefined && dir === null && c[a2] !== undefined) {
          eu = su;
          ev = sv;
        }
      }
      if (eu === undefined || ev === undefined) return fail('끝점을 정할 자료가 모자람');
      const p = put(eu, ev);
      this.emit(rapid ? MOVE_RAPID : MOVE_FEED, p[0]!, p[1]!, p[2]!, line);
      this.known = 7;
      this.setDir(su, sv, eu, ev);
      return this.afterMove(m99, line);
    }
    // FC·FCT
    const ccw = this.drWord(T) > 0;
    this.dr = ccw ? 1 : -1;
    if (ccpr !== undefined && ccpa !== undefined && pole && (ccu === undefined || ccv === undefined)) {
      const t = (ccpa * Math.PI) / 180;
      ccu = pole[0] + ccpr * Math.cos(t);
      ccv = pole[1] + ccpr * Math.sin(t);
    }
    if ((ccu === undefined || ccv === undefined) && tangent && rad !== undefined) {
      // 접선 왼쪽(DR+) 또는 오른쪽(DR-)으로 R만큼
      const k = ccw ? 1 : -1;
      ccu = su - tangent[1] * rad * k;
      ccv = sv + tangent[0] * rad * k;
    }
    if (ccu !== undefined && ccv !== undefined) {
      const R = Math.hypot(su - ccu, sv - ccv);
      if (eu === undefined || ev === undefined) {
        // 좌표 하나: 원과 직선의 교점 중 진행 방향으로 먼저 닿는 것
        const known = eu !== undefined ? 0 : ev !== undefined ? 1 : -1;
        if (known < 0) return fail('원호 끝점이 없음');
        const kv = known === 0 ? eu! : ev!;
        const off = kv - (known === 0 ? ccu : ccv);
        if (Math.abs(off) > R + 1e-9) return fail('끝 좌표가 원 밖');
        const h = Math.sqrt(Math.max(0, R * R - off * off));
        const t0 = Math.atan2(sv - ccv, su - ccu);
        let best: [number, number] | null = null;
        let bestSweep = Infinity;
        for (const sg of [1, -1]) {
          const pu = known === 0 ? kv : ccu + sg * h;
          const pv = known === 0 ? ccv + sg * h : kv;
          let d = Math.atan2(pv - ccv, pu - ccu) - t0;
          d = ccw ? ((d % TAU) + TAU) % TAU : ((-d % TAU) + TAU) % TAU;
          if (d < 1e-9) d = TAU;
          if (d < bestSweep) {
            bestSweep = d;
            best = [pu, pv];
          }
        }
        eu = best![0];
        ev = best![1];
      } else if (Math.abs(Math.hypot(eu - ccu, ev - ccv) - R) > Math.max(this.tol, R * 1e-3)) this.w.add(`${kind}: 끝점이 원 위에 있지 않음(나선형으로 이어 그림)`, line);
      const p = put(eu, ev);
      this.arcTo(ccu, ccv, ccw, p[0]!, p[1]!, p[2]!, line);
      this.known = 7;
      return this.afterMove(m99, line);
    }
    if (eu === undefined || ev === undefined) return fail('원호 중심·끝점을 정할 자료가 모자람');
    if (tangent) {
      // FCT + 끝점: 앞 요소에 접하고 끝점을 지나는 원(CT와 같음)
      this.lastDir = tangent;
      return this.circleT(['CT', ...T.slice(1)], line);
    }
    if (rad !== undefined) {
      this.w.add(`${kind}: 반지름·끝점만으로는 해가 둘 — 짧은 호로 그림`, line);
      const du = eu - su;
      const dv = ev - sv;
      const d = Math.hypot(du, dv);
      if (d < 1e-9) return fail('시작점과 끝점이 같음');
      const r = Math.max(rad, d / 2);
      const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
      const side = ccw ? 1 : -1;
      const p = put(eu, ev);
      this.arcTo(su + du / 2 - (side * h * dv) / d, sv + dv / 2 + (side * h * du) / d, ccw, p[0]!, p[1]!, p[2]!, line);
      this.known = 7;
      return this.afterMove(m99, line);
    }
    return fail('원호 중심·반지름이 없음');
  }

  // ───────────────────────── 밀링 사이클 ─────────────────────────

  /** 평면 좌표(u, v)와 공구 축 높이 w로 이동 */
  private go3(kind: number, u: number, v: number, w: number, line: number): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const p = [0, 0, 0];
    p[a0] = u;
    p[a1] = v;
    p[a2] = w;
    this.emit(kind, p[0]!, p[1]!, p[2]!, line, FLAG_CYCLE);
  }

  /** 평면 원호(중심 cu, cv · 중심각 sweep)로 (u, v, w)까지. 높이가 바뀌면 나선 */
  private arc3(cu: number, cv: number, sweep: number, u: number, v: number, w: number, line: number): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const c = [0, 0, 0];
    c[a0] = cu;
    c[a1] = cv;
    c[a2] = this.pos[a2]!;
    const e = [0, 0, 0];
    e[a0] = u;
    e[a1] = v;
    e[a2] = w;
    this.emitArc(this.plane, c, sweep, e[0]!, e[1]!, e[2]!, line, FLAG_CYCLE);
  }

  /**
   * 밀링 사이클(CYCL CALL 자리에서): 208 보어 밀링, 251 사각 포켓, 252 원 포켓, 253 홈, 256 사각 보스, 257 원 보스, 232 정면 밀링.
   * 깊이는 Q203(윗면)에서 Q202씩 Q201까지, 옆 간격은 공구 지름 × Q370. 공구 반지름은 공구 표 → TOOL DEF R(+DR).
   */
  private millCycle(n: number, line: number): void {
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const Q = (k: string, d = 0): number => this.q.get(k) ?? d;
    let r = this.toolRadius();
    if (r === undefined) {
      this.w.add(`CYCL DEF ${n}: 공구 반지름을 몰라(TOOL DEF R 없음) 반지름 0으로 그림`, line);
      r = 0;
    }
    const setup = Math.abs(Q('Q200', 2));
    const second = Math.abs(Q('Q204', 0));
    const surface = (n === 232 ? Q('Q227', 0) : Q('Q203', 0)) + this.shift[a2]!;
    const depth = n === 232 ? Q('Q386', 0) - Q('Q227', 0) : Q('Q201', 0);
    const plungeStep = Math.abs(Q('Q202', 0));
    const up = depth < 0 ? 1 : -1;
    const zEnd = surface + depth;
    const clear = surface + up * Math.max(setup, second);
    const safe = surface + up * setup;
    const overlap = Q('Q370', 1) > 0 ? Q('Q370', 1) : 1;
    const step0 = r > 0 ? 2 * r * overlap : Infinity;
    const saveFeed = this.feed;
    const fMill = Q('Q207', this.feed || this.autoFeed);
    const fPlunge = Q('Q206', fMill);
    // 48차: 한 축 대칭(사이클 8) 아래에서도 고정 사이클의 가공 방향(하향·상향)은 그대로(TNC 310 사용 설명서 8.6절 140쪽 "except in fixed cycles",
    // TNC 640 가공 사이클 설명서 34059x-17 사이클 208 절 104쪽 "대칭은 사이클의 밀링 꼴에 영향 없음") — 프로그램 좌표에서 방향을 바꿔 두면 대칭한 화면에서 원래 방향이 된다
    const climb = (Q('Q351', 1) >= 0) !== this.cycleMirrored();
    const cu0 = this.pos[a0]!;
    const cv0 = this.pos[a1]!;
    if (depth === 0) {
      this.w.add(`CYCL DEF ${n}: 깊이가 0`, line);
      return;
    }
    // 깊이 단계(윗면부터)
    const levels: number[] = [];
    if (plungeStep > 0) {
      for (let k = 1; k <= MILL_LEVEL_MAX; k++) {
        const d = surface - up * k * plungeStep;
        if (up * (d - zEnd) <= 1e-9) break;
        levels.push(d);
      }
    }
    // 안전장치: 층이 더 남았으면 그 뒤 층은 건너뛰고 바닥 층으로 간다(그대로 그리고, 그린 뒤 이동 한도에 닿지 않았으면 알린다). 층은 k마다 단조라 다음 층 하나만 본다
    const levelCap = plungeStep > 0 && up * (surface - up * (MILL_LEVEL_MAX + 1) * plungeStep - zEnd) > 1e-9;
    levels.push(zEnd);
    // 이동 한도: 층 × 고리는 한 블록 안에서 돌아 run의 블록 사이 검사가 닿지 않는다(겹침 Q370·공구 반지름이 아주 작으면 고리가 아주 많다).
    // 고리·줄 목록도 남은 이동 수까지만 모은다(고리 하나는 이동 하나 이상이라 그만큼이면 한도에 닿는다)
    const more = this.blockLoop();
    const room = Math.max(0, this.maxMoves - this.mb.count);
    const F = MOVE_FEED;
    const Rp = MOVE_RAPID;
    let w = this.pos[a2]!;
    const go = (kind: number, u: number, v: number, ww = w): void => {
      this.go3(kind, u, v, ww, line);
      w = ww;
    };
    // 지역 좌표(중심 c, 각 ang) → 평면
    let cu = cu0;
    let cv = cv0;
    let ca = 1;
    let sa = 0;
    const P = (lu: number, lv: number): [number, number] => [cu + lu * ca - lv * sa, cv + lu * sa + lv * ca];
    const goL = (kind: number, lu: number, lv: number): void => {
      const p = P(lu, lv);
      go(kind, p[0], p[1]);
    };
    const arcL = (lcu: number, lcv: number, sweep: number, lu: number, lv: number): void => {
      const c = P(lcu, lcv);
      const p = P(lu, lv);
      this.arc3(c[0], c[1], sweep, p[0], p[1], w, line);
    };
    /** 둥근 모서리 사각 고리(반너비 hx, hy, 모서리 rc), 오른쪽 가운데에서 시작해 ccw면 반시계 */
    const rectLoop = (hx: number, hy: number, rc: number, ccw: boolean): void => {
      rc = Math.max(0, Math.min(rc, hx, hy));
      const s = ccw ? 1 : -1;
      const q = (s * Math.PI) / 2;
      goL(F, hx, 0);
      if (hx < 1e-9 || hy < 1e-9) {
        // 폭 0인 고리: 긴 쪽으로 왕복
        goL(F, -hx, -s * hy);
        goL(F, hx, s * hy);
        goL(F, hx, 0);
        return;
      }
      goL(F, hx, s * (hy - rc));
      if (rc > 0) arcL(hx - rc, s * (hy - rc), q, hx - rc, s * hy);
      goL(F, -hx + rc, s * hy);
      if (rc > 0) arcL(-hx + rc, s * (hy - rc), q, -hx, s * (hy - rc));
      goL(F, -hx, -s * (hy - rc));
      if (rc > 0) arcL(-hx + rc, -s * (hy - rc), q, -hx + rc, -s * hy);
      goL(F, hx - rc, -s * hy);
      if (rc > 0) arcL(hx - rc, -s * (hy - rc), q, hx, -s * (hy - rc));
      goL(F, hx, 0);
    };
    const circleLoop = (rr: number, ccw: boolean): void => {
      goL(F, rr, 0);
      if (rr > 1e-9) arcL(0, 0, ccw ? TAU : -TAU, rr, 0);
    };
    this.feed = fMill;
    const drawnBefore = this.mb.count;
    switch (n) {
      case 251:
      case 256: {
        const Lx = Q('Q218');
        const Wy = Q('Q219');
        const rc = Q('Q220');
        const al = Q('Q368');
        const ang = (Q(n === 251 ? 'Q224' : 'Q224') * Math.PI) / 180;
        ca = Math.cos(ang);
        sa = Math.sin(ang);
        const posK = Math.round(Q('Q367'));
        const off: [number, number] = posK === 1 ? [Lx / 2, Wy / 2] : posK === 2 ? [-Lx / 2, Wy / 2] : posK === 3 ? [-Lx / 2, -Wy / 2] : posK === 4 ? [Lx / 2, -Wy / 2] : [0, 0];
        cu = cu0 + off[0] * ca - off[1] * sa;
        cv = cv0 + off[0] * sa + off[1] * ca;
        if (!(Lx > 0 && Wy > 0)) {
          this.w.add(`CYCL DEF ${n}: 크기(Q218·Q219)가 없음`, line);
          break;
        }
        if (n === 251) {
          const hx = Lx / 2 - r - al;
          const hy = Wy / 2 - r - al;
          if (hx < -1e-9 || hy < -1e-9) {
            this.w.add('CYCL DEF 251: 공구가 포켓보다 큼', line);
            break;
          }
          const m = Math.min(hx, hy);
          const loops: number[] = [];
          for (let e = 0; e < m - 1e-9 && loops.length < room; e += step0) loops.push(e);
          loops.push(m);
          go(Rp, ...P(0, 0), clear);
          go(Rp, ...P(0, 0), safe);
          for (let l = 0; l < levels.length && more(); l++) {
            const d = levels[l]!;
            goL(F, 0, 0);
            this.feed = fPlunge;
            go(F, ...P(0, 0), d);
            this.feed = fMill;
            for (let k = 0; k < loops.length && more(); k++) {
              const e = loops[k]!;
              const last = k === loops.length - 1;
              rectLoop(hx - m + e, hy - m + e, last ? rc - r - al : 0, climb);
            }
          }
          if (al > 0 && Q('Q215') !== 1) rectLoop(Lx / 2 - r, Wy / 2 - r, rc - r, climb);
          goL(F, 0, 0);
        } else {
          // 보스: 바깥에서 안쪽으로(블랭크 Q424·Q425 → 완성 크기 + 여유)
          const hx = Lx / 2 + r + al;
          const hy = Wy / 2 + r + al;
          const bx = Math.max(Q('Q424', Lx), Lx) / 2 + r;
          const by = Math.max(Q('Q425', Wy), Wy) / 2 + r;
          const span = Math.max(bx - hx, by - hy, 0);
          const loops: number[] = [];
          for (let e = span; e > 1e-9 && loops.length < room; e -= step0) loops.push(e);
          loops.push(0);
          go(Rp, ...P(bx + r + setup, 0), clear);
          go(Rp, ...P(bx + r + setup, 0), safe);
          for (let l = 0; l < levels.length && more(); l++) {
            const d = levels[l]!;
            this.feed = fPlunge;
            go(F, ...P(bx + r + setup, 0), d);
            this.feed = fMill;
            for (let k = 0; k < loops.length && more(); k++) {
              const e = loops[k]!;
              rectLoop(hx + e, hy + e, k === loops.length - 1 ? rc + r + al : 0, !climb);
            }
            goL(F, bx + r + setup, 0);
          }
        }
        break;
      }
      case 252:
      case 257:
      case 208: {
        if (n === 208) {
          // 보어 밀링: 나선으로 내려가 바닥에서 한 바퀴
          const D = Q('Q335');
          const pitch = Math.abs(Q('Q334', 0.25));
          const rp = D / 2 - r;
          if (!(rp > 1e-9)) {
            this.w.add('CYCL DEF 208: 공구가 구멍보다 큼(또는 지름 Q335 없음)', line);
            break;
          }
          go(Rp, cu, cv, clear);
          go(Rp, cu, cv, safe);
          this.feed = fMill;
          goL(F, rp, 0);
          const travel = Math.abs(safe - zEnd);
          const turns = pitch > 0 ? travel / pitch : 1;
          const s = climb ? 1 : -1;
          const sweep = s * TAU * Math.max(turns, 1e-3);
          const ea = sweep;
          this.arc3(cu, cv, sweep, cu + rp * Math.cos(ea), cv + rp * Math.sin(ea), zEnd, line);
          w = zEnd;
          const p = [this.pos[a0]!, this.pos[a1]!];
          this.arc3(cu, cv, s * TAU, p[0]!, p[1]!, zEnd, line);
          go(F, cu, cv);
          break;
        }
        const D = Q('Q223');
        const al = n === 252 ? Q('Q368') : Q('Q368');
        if (!(D > 0)) {
          this.w.add(`CYCL DEF ${n}: 지름(Q223)이 없음`, line);
          break;
        }
        if (n === 252) {
          const rr = D / 2 - r - al;
          if (rr < -1e-9) {
            this.w.add('CYCL DEF 252: 공구가 포켓보다 큼', line);
            break;
          }
          const radii: number[] = [];
          for (let e = step0; e < rr - 1e-9 && radii.length < room; e += step0) radii.push(e);
          radii.push(Math.max(0, rr));
          go(Rp, cu, cv, clear);
          go(Rp, cu, cv, safe);
          for (let l = 0; l < levels.length && more(); l++) {
            const d = levels[l]!;
            goL(F, 0, 0);
            this.feed = fPlunge;
            go(F, cu, cv, d);
            this.feed = fMill;
            for (let k = 0; k < radii.length && more(); k++) circleLoop(radii[k]!, climb);
          }
          if (al > 0 && Q('Q215') !== 1) circleLoop(D / 2 - r, climb);
          goL(F, 0, 0);
        } else {
          const rf = D / 2 + r + al;
          const rb = Math.max(Q('Q222', D), D) / 2 + r;
          const radii: number[] = [];
          for (let e = rb; e > rf + 1e-9 && radii.length < room; e -= step0) radii.push(e);
          radii.push(rf);
          const start = rb + r + setup;
          go(Rp, cu + start, cv, clear);
          go(Rp, cu + start, cv, safe);
          for (let l = 0; l < levels.length && more(); l++) {
            const d = levels[l]!;
            this.feed = fPlunge;
            go(F, cu + start, cv, d);
            this.feed = fMill;
            for (let k = 0; k < radii.length && more(); k++) circleLoop(radii[k]!, !climb);
            goL(F, start, 0);
          }
        }
        break;
      }
      case 253: {
        const Ls = Q('Q218');
        const Ws = Q('Q219');
        const al = Q('Q368');
        const ang = (Q('Q374') * Math.PI) / 180;
        ca = Math.cos(ang);
        sa = Math.sin(ang);
        const half = Ls / 2 - Ws / 2;
        const posK = Math.round(Q('Q367'));
        const shiftL = posK === 1 ? Ls / 2 : posK === 2 ? half : posK === 3 ? -Ls / 2 : posK === 4 ? -half : 0;
        cu = cu0 + shiftL * ca;
        cv = cv0 + shiftL * sa;
        const rr = Ws / 2 - r - al;
        if (!(Ls > 0 && Ws > 0) || rr < -1e-9 || half < -1e-9) {
          this.w.add('CYCL DEF 253: 홈 크기(Q218·Q219)가 없거나 공구가 홈보다 큼', line);
          break;
        }
        const widths: number[] = [];
        for (let e = step0 / 2; e < rr - 1e-9 && widths.length < room; e += step0) widths.push(e);
        if (rr > 1e-9) widths.push(rr);
        const s = climb ? 1 : -1;
        go(Rp, ...P(-half, 0), clear);
        go(Rp, ...P(-half, 0), safe);
        for (let l = 0; l < levels.length && more(); l++) {
          const d = levels[l]!;
          goL(F, -half, 0);
          this.feed = fPlunge;
          go(F, ...P(-half, 0), d);
          this.feed = fMill;
          goL(F, half, 0);
          for (let k = 0; k < widths.length && more(); k++) {
            const e = widths[k]!;
            // 경기장 꼴: 오른쪽 반원 → 위 직선 → 왼쪽 반원 → 아래 직선
            goL(F, half, -s * e);
            arcL(half, 0, s * Math.PI, half, s * e);
            goL(F, -half, s * e);
            arcL(-half, 0, s * Math.PI, -half, -s * e);
            goL(F, half, -s * e);
          }
          goL(F, half, 0);
        }
        break;
      }
      case 232: {
        const u0 = Q('Q225') + this.shift[a0]!;
        const v0 = Q('Q226') + this.shift[a1]!;
        const Lx = Q('Q218');
        const Wy = Q('Q219');
        const strategy = Math.round(Q('Q389'));
        if (strategy === 2) this.w.add('CYCL DEF 232: Q389=2(나선)는 지그재그로 그림', line);
        const step = Number.isFinite(step0) ? step0 : Math.abs(Wy) / 10 || 1;
        const sgnW = Wy < 0 ? -1 : 1;
        const rows: number[] = [];
        for (let e = 0; e < Math.abs(Wy) - 1e-9 && rows.length < room; e += step) rows.push(v0 + sgnW * e);
        rows.push(v0 + Wy);
        const uA = u0 - r - setup;
        const uB = u0 + Lx + r + setup;
        go(Rp, uA, rows[0]!, clear);
        go(Rp, uA, rows[0]!, safe);
        for (let l = 0; l < levels.length && more(); l++) {
          const d = levels[l]!;
          go(Rp, uA, rows[0]!, safe);
          this.feed = fPlunge;
          go(F, uA, rows[0]!, d);
          this.feed = fMill;
          for (let k = 0; k < rows.length && more(); k++) {
            const v = rows[k]!;
            const fwd = strategy === 1 || k % 2 === 0;
            const [from, to] = fwd ? [uA, uB] : [uB, uA];
            if (strategy === 1 && k > 0) {
              go(Rp, this.pos[a0]!, this.pos[a1]!, safe);
              go(Rp, from, v, safe);
              go(F, from, v, d);
            } else go(F, from, v);
            go(F, to, v);
          }
        }
        break;
      }
    }
    // 층 안전장치: 층을 돈 사이클(208 나선은 층을 쓰지 않는다)이 이동 한도 전에 바닥 층까지 그렸으면 알린다
    if (levelCap && n !== 208 && this.mb.count > drawnBefore) this.guardStop(`CYCL DEF ${n}: 층이 ${MILL_LEVEL_MAX}개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감`, line);
    go(Rp, this.pos[a0]!, this.pos[a1]!, clear);
    // 사이클 뒤 공구는 시작 자리 위(평면 위치는 CYCL CALL 자리)로
    if (n !== 232) go(Rp, cu0, cv0, clear);
    this.feed = saveFeed;
    this.known = 7;
  }

  // ───────────────────────── SL 사이클(48차) ─────────────────────────

  /**
   * SL 사이클의 깊이 층: 윗면에서 step씩, 마지막은 bottom(step 0이면 bottom 하나). per = 층 하나의 이동 수(어림 — 49차):
   * 층 수 × per가 SL_MOVE_MAX를 넘으면 앞 층 몇 개와 바닥 층만 남기고 알린다(넘지 않으면 9999층 안전장치만)
   */
  private slPasses(C: string, line: number, surface: number, up: number, bottom: number, step: number, per: number): number[] {
    const out: number[] = [];
    if (step > 0)
      for (let k = 1; k <= MILL_LEVEL_MAX; k++) {
        const d = surface - up * k * step;
        if (up * (d - bottom) <= 1e-9) break;
        out.push(d);
      }
    out.push(bottom);
    if (out.length * per > SL_MOVE_MAX) {
      const keep = Math.max(1, Math.floor(SL_MOVE_MAX / Math.max(per, 1)));
      if (keep < out.length) {
        this.guardStop(`${C}: 층 × 고리 이동이 ${SL_MOVE_MAX}개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감`, line);
        return [...out.slice(0, keep - 1), bottom];
      }
    }
    if (step > 0 && up * (surface - up * (MILL_LEVEL_MAX + 1) * step - bottom) > 1e-9) this.guardStop(`${C}: 층이 ${MILL_LEVEL_MAX}개를 넘어 그 뒤 층은 건너뛰고 바닥 층으로 감`, line);
    return out;
  }

  /** 공구 반지름(공구 표 → TOOL DEF R, DR 없이) — 사이클 21 Q13·24 Q438의 거친 깎기 공구 */
  private toolBaseRadius(t: number): number | undefined {
    const tt = this.o.toolTable?.[t];
    return tt ? (tt.radius ?? (tt.diameter !== undefined ? tt.diameter / 2 : undefined)) : this.toolR.get(t);
  }

  /**
   * 사이클 14의 윤곽 부프로그램(LBL n … LBL 0)을 읽어 윤곽마다 닫힌 요소 열과 포켓·섬을 돌려준다. 블록을 실행하되 이동은 그리지 않고 모은다(capMove).
   * L·C·CR·CT·CC·LP·CP·FK·RND·CHF와 Q 계산·FN만 읽고 이송·M 기능·공구 축 좌표는 쓰지 않는다(설명서 9.1절 266쪽 — 다른 블록은 읽지 않고 알림).
   * 다 읽은 뒤 지금 자리·보정·극·Q 등은 되돌린다. 윤곽 끝이 시작점과 다르면 직선으로 닫는다(설명서 예제 310쪽 섬 윤곽도 닫는 변을 적지 않음).
   * 포켓·섬은 보정 쪽과 돌아가는 방향으로(sl.ts slIsPocket).
   * 49차: open이면 윤곽 트레인(사이클 25)용 — 닫지 않고 넓이·포켓을 보지 않으며 처음 만난 보정(comp: RL 1·RR 2·없음 0)을 함께 돌려준다
   */
  private slCapture(labels: readonly string[], line: number, open = false): { els: SlLoop; pocket: boolean; comp: number }[] | null {
    const save = {
      pc: this.pc,
      pos: [this.pos[0]!, this.pos[1]!, this.pos[2]!],
      known: this.known,
      comp: this.comp,
      feed: this.feed,
      cc: this.cc,
      lastDir: this.lastDir,
      dr: this.dr,
      fkPole: this.fkPole,
      q: new Map(this.q),
      isoAbs: this.isoAbs,
      isoMot: this.isoMot,
      isoComp: this.isoComp,
      // 49차: 좌표 변환(윤곽 안에서 바꿔도 사이클 뒤에는 되돌림 — 설명서 9.1절 266쪽)
      xf: this.outXf,
      shift: [...this.shift],
      mirror: [...this.mirror],
      rotDeg: this.rotDeg,
      scaleF: this.scaleF,
      scale26: [...this.scale26],
      center26: [...this.center26],
    };
    const out: { els: SlLoop; pocket: boolean; comp: number }[] = [];
    let total = 0;
    try {
      for (const lb of labels) {
        const target = this.findLabel(lb, line);
        if (target < 0) {
          this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}이 없음`, line);
          continue;
        }
        const cap: SlCapture = { els: [], corners: [], comp: 0, start: null, axis: false, skipped: new Set(), xf0: save.xf, mFor: null, toCall: null, oval: false, line };
        this.cap = cap;
        this.comp = 0;
        this.lastDir = null;
        this.pc = target + 1;
        let steps = 0;
        let end = false;
        let found0 = false;
        while (!end && !this.ended && this.pc < this.src.lineCount) {
          if (++steps > SL_BLOCK_MAX || ++this.blocks > this.maxBlocks) {
            this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}을 읽는 블록이 너무 많아 멈춤`, line);
            break;
          }
          const b = this.readBlock(this.pc);
          this.pc = b.next;
          if (!b.toks.length) continue;
          try {
            for (const t of this.iso ? this.isoBlock(b.text, b.line) : [b.text]) {
              const T = tokenize(t);
              if (!T.length) continue;
              const t0 = T[0]!.toUpperCase();
              if (t0 === 'LBL' && /^"?0"?$/.test(T[1] ?? '')) {
                end = found0 = true;
                break;
              }
              if (t0 === 'END' || t0 === 'BEGIN') {
                end = true;
                break;
              }
              // 49차: 좌표 변환(사이클 7·8·10·11·26, TRANS DATUM)도 읽는다(설명서 9.1절 266쪽 — 윤곽 안에서 허용, 뒤 부프로그램에도 들음)
              const xfBlock = t0 === 'TRANS' || (t0 === 'CYCL' && (T[1] ?? '').toUpperCase() === 'DEF' && SL_CAP_XF.has(parseInt(T[2] ?? '', 10)));
              if (xfBlock || SL_CAP_WORDS.has(t0) || t0.startsWith('*') || t0.startsWith('APPR') || t0.startsWith('DEP') || /^Q[LRS]?\d+(=|$)/.test(t0) || /^I?[XYZ][+-]/.test(t0)) {
                this.exec({ line: b.line, next: b.next, text: t, toks: T });
              } else if (t0 !== 'LBL' && !/^M\d+$/.test(t0) && t0 !== 'STOP' && !cap.skipped.has(t0)) {
                cap.skipped.add(t0);
                this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}의 '${t0}' 블록은 읽지 않음`, b.line);
              }
              if (this.pc !== b.next) break;
            }
          } catch (err) {
            if (!(err instanceof ExprError)) throw err;
            this.w.add(`읽을 수 없는 블록 — ${err.message}`, b.line);
          }
        }
        this.cap = null;
        if (!found0) this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}에 끝(LBL 0)이 없음`, line);
        if (cap.axis) this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}의 공구 축 좌표는 쓰지 않음(윤곽은 작업 평면 안)`, line);
        const els = cap.els;
        if (!cap.start || !els.length) {
          this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}에 윤곽 요소가 없음`, line);
          continue;
        }
        const last = els[els.length - 1]!;
        const closedAlready = Math.hypot(last.eu - cap.start[0], last.ev - cap.start[1]) <= Math.max(this.tol, 1e-9);
        if (closedAlready) {
          last.eu = cap.start[0];
          last.ev = cap.start[1];
        } else if (!open) els.push(g7xLine(last.eu, last.ev, cap.start[0], cap.start[1]));
        // RND·CHF(앞 요소 끝 모서리): CHF는 두 직선 사이에만(그리기와 같은 규칙), 윤곽 처음·끝 모서리는 그대로
        const corners: G7xCorner[] = [];
        for (const c of cap.corners) {
          const label = c.chf ? 'CHF' : 'RND';
          if (c.at < 0 || c.at + 1 >= els.length) this.w.add(`${label}: 윤곽 처음·끝 모서리는 그대로 그림`, c.line);
          else if (c.chf && (els[c.at]!.arc || els[c.at + 1]!.arc)) this.w.add(`${label}: 두 직선 사이에만 쓰는 모따기라 원호와 만나는 모서리는 그대로 그림`, c.line);
          else corners.push({ at: c.at, kind: c.kind, size: c.size });
        }
        const done = corners.length ? g7xCorners(els, corners) : { els, failed: 0 };
        if (done.failed) this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}의 RND·CHF ${done.failed}개는 값이 앞뒤 요소보다 커서 모서리 그대로 그림`, line);
        total += done.els.length;
        if (open) {
          out.push({ els: done.els, pocket: true, comp: cap.comp });
          continue;
        }
        if (Math.abs(slArea(done.els)) <= 1e-12 * Math.max(1, done.els.reduce((s, e) => s + slElLen(e), 0)) ** 2) {
          this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}이 넓이 없는 윤곽이라 빼고 그림`, line);
          continue;
        }
        if (!cap.comp) this.w.add(`CYCL DEF 14: 윤곽 LBL ${lb}에 RL·RR이 없어 포켓으로 봄`, line);
        out.push({ els: done.els, pocket: slIsPocket(done.els, cap.comp), comp: cap.comp });
      }
    } finally {
      this.cap = null;
      this.pc = save.pc;
      // 49차: 윤곽 안에서 바꾼 좌표 변환은 사이클 뒤에 되돌린다(출력 변환을 먼저 되돌리고 자리는 아래에서 그대로)
      this.shift = save.shift;
      this.mirror = save.mirror;
      this.rotDeg = save.rotDeg;
      this.scaleF = save.scaleF;
      this.scale26 = save.scale26;
      this.center26 = save.center26;
      if (this.outXf !== save.xf) this.setOutXf(save.xf);
      this.pos[0] = save.pos[0]!;
      this.pos[1] = save.pos[1]!;
      this.pos[2] = save.pos[2]!;
      this.known = save.known;
      this.comp = save.comp;
      this.feed = save.feed;
      this.cc = save.cc;
      this.lastDir = save.lastDir;
      this.dr = save.dr;
      this.fkPole = save.fkPole;
      this.q = save.q;
      this.isoAbs = save.isoAbs;
      this.isoMot = save.isoMot;
      this.isoComp = save.isoComp;
    }
    if (total > SL_ELEMENT_MAX) {
      this.w.add(`CYCL DEF 14: 윤곽 요소가 ${SL_ELEMENT_MAX}개를 넘어 그리지 않음`, line);
      return null;
    }
    return out;
  }

  /**
   * SL 사이클 21·22·23·24를 부른다(설명서 9.5~9.8절). 사이클 14의 윤곽으로 가공 면(포켓 − 섬)을 만들고 사이클 20의 Q1~Q9로:
   * - 22 거친 깎기: 경계에서 공구 반지름 + Q3 떨어진 곡선부터 Q2 × 공구 반지름 간격으로 안쪽 고리들을 셈해, 깊이 Q10씩(바닥 = Q5 + Q1 + 바닥 여유 Q4)
   *   안쪽 고리에서 바깥으로 깎는다(278쪽 — 들어간 자리에서 바깥으로, 섬은 둘러 깎음). 가장 바깥 고리의 안쪽 모서리는 Q8로 둥글림(274쪽).
   *   고리 사이는 바깥 고리 안으로 곧게 갈 수 있으면 Q12 이송으로, 아니면 안전 거리(Q5 + Q6)로 올라 옮긴 뒤 Q11로 다시 들어간다
   * - 21 예비 드릴: 22와 같은 셈(공구 Q13 — 0이면 지금 공구, 반지름에 DR은 넣지 않음 — 277쪽)으로 들어가는 자리마다 Q10씩 쪼아 Q5 + Q1 + Q4까지,
   *   쪼기 사이는 안전 거리로 급속, 다시 들어갈 때 앞 깊이 − 앞당김 t(30 mm까지 0.6 mm, 넘으면 깊이/50, 많아야 7 mm — 276쪽)까지 급속
   * - 23 바닥 다듬질: Q7로 급속 → 공구 축 Q11 → 바닥(Q5 + Q1)에서 22와 같은 고리 한 층(Q12)(283쪽 — 세로 접선 호 접근은 곧게)
   * - 24 옆면 다듬질: 경계에서 공구 반지름 + Q14 떨어진 고리마다 따로(286쪽), Q10씩 층마다 접선 나선 호(높이 Q6/25, 많아야 층 간격)로 들어가 한 바퀴 돌고 나온다.
   *   사이클 20의 Q3 = 0이면 컨트롤러가 오류("Tool radius too large")로 멈추므로 그리지 않는다(287쪽)
   * 가공 방향: Q9 = +1(0도)이면 포켓 반시계·섬 시계(하향), -1이면 반대(274·289쪽). 한 축 대칭이어도 방향은 그대로(232쪽 — SL 사이클은 방향이 바뀌지 않음).
   * 끝나면 공구 축으로 Q7 높이(기계 매개변수 posAfterContPocket = ToolAxClearanceHeight로 정함 — 평면 자리는 그대로)
   */
  private slCycle(n: number, line: number): void {
    const C = `CYCL DEF ${n}`;
    const labels = this.slLabels;
    if (!labels?.length) {
      this.w.add(`${C}: 앞에 CYCL DEF 14(윤곽)가 없어 그리지 않음`, line);
      return;
    }
    if (!this.slData) {
      this.w.add(`${C}: 앞에 CYCL DEF 20(윤곽 자료)이 없어 그리지 않음`, line);
      return;
    }
    const cs = this.slCapture(labels, line);
    if (!cs?.length) return;
    const R = slRegion(cs);
    if (!R.loops.length) {
      this.w.add(`${C}: 윤곽이 가공할 면을 이루지 않아 그리지 않음`, line);
      return;
    }
    if (R.open) this.w.add(`${C}: 윤곽 경계 가운데 잇지 못한 조각 ${R.open}개는 빼고 그림`, line);
    if (!R.pockets.length && n !== 24) {
      this.w.add(`${C}: 포켓 없이 섬만 있어 그리지 않음`, line);
      return;
    }
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const Q = (k: string, d = 0): number => this.q.get(k) ?? d;
    const depth = Q('Q1');
    const up = depth > 0 ? -1 : 1;
    const surface = Q('Q5') + this.shift[a2]!;
    const setup = Math.abs(Q('Q6', 2));
    const safe = surface + up * setup;
    const q7 = this.q.get('Q7');
    let clear = q7 === undefined ? safe : q7 + this.shift[a2]!;
    if (up * (clear - safe) < -1e-9) {
      this.w.add(`${C}: 안전 높이(Q7)가 안전 거리(Q5 + Q6)보다 아래라 안전 거리로 셈`, line);
      clear = safe;
    }
    let r = this.toolRadius();
    if (r === undefined) {
      this.w.add(`${C}: 공구 반지름을 몰라(TOOL DEF R 없음) 반지름 0으로 그림`, line);
      r = 0;
    }
    const q8 = Math.max(0, Q('Q8'));
    // Q9 = -1이면 시계(상향), 0·+1은 반시계(하향). 대칭이면 프로그램 좌표에서 거꾸로 돌려 화면에서 같은 방향이 되게
    const flip = Q('Q9', 1) < 0 !== this.cycleMirrored();
    const fPlunge = Q('Q11', this.feed || this.autoFeed);
    const fMill = Q('Q12', this.feed || this.autoFeed);
    const saveFeed = this.feed;
    const loop = this.blockLoop();
    // 49차: 사이클 한 번이 그리는 이동 수 한도(SL_MOVE_MAX) — 닿으면 그 뒤는 그리지 않고 끝에 알린다
    const callStart = this.mb.count;
    let hardStop = false;
    const more = (): boolean => {
      if (!loop()) return false;
      if (this.mb.count - callStart < SL_MOVE_MAX) return true;
      hardStop = true;
      return false;
    };
    const F = MOVE_FEED;
    const Rp = MOVE_RAPID;
    let w = this.pos[a2]!;
    const here = (): [number, number] => [this.pos[a0]!, this.pos[a1]!];
    const go = (kind: number, u: number, v: number, ww = w): void => {
      this.go3(kind, u, v, ww, line);
      w = ww;
    };
    const toClear = (): void => {
      if (up * (w - clear) < 0) go(Rp, ...here(), clear);
    };
    const mill = (loop: SlLoop, ww: number): void => {
      for (const e of loop) {
        if (!more()) return;
        if (e.arc) {
          this.arc3(e.cu, e.cv, e.sweep, e.eu, e.ev, ww, line);
          w = ww;
        } else go(F, e.eu, e.ev, ww);
      }
    };
    const passes = (bottom: number, step: number, per: number): number[] => this.slPasses(C, line, surface, up, bottom, step, per);
    /** 거친 깎기·바닥 다듬질 고리 차례(반지름 rad, 첫 윤곽 시작점에서 셈 — 21과 22의 들어가는 자리가 같게) */
    const plan = (rad: number): { d0: number; outer: SlLoop[]; order: SlLoop[] } | null => {
      const d0 = Math.max(0, rad + Q('Q3'));
      // 49차: 고리 셈의 일 — 사이클 한 번 SL_EVAL_CALL, 프로그램 전체 SL_EVAL_PGM까지
      const w0 = R.work ?? 0;
      const L = slLevels(R, d0, Math.abs(Q('Q2', 1)) * rad, SL_RING_MAX, undefined, Math.max(0, Math.min(SL_EVAL_CALL, SL_EVAL_PGM - this.slEvals)));
      this.slEvals += (R.work ?? 0) - w0;
      if (!L.levels.length) {
        this.w.add(L.capped === 'work' ? `${C}: 옆 간격 고리 셈이 한도를 넘어 그리지 않음` : `${C}: 공구가 윤곽보다 커서 그리지 않음`, line);
        return null;
      }
      if (L.capped === 'rings') this.guardStop(`${C}: 옆 간격 고리가 ${SL_RING_MAX}개를 넘어 그 안쪽은 그리지 않음`, line);
      else if (L.capped === 'work') this.guardStop(`${C}: 옆 간격 고리 셈이 한도를 넘어 바깥 고리 ${L.levels.length}겹까지만 그림`, line);
      const lv = L.levels.map((ls, k) => ls.map((l) => (k === 0 && q8 > 0 ? slRound(l, q8, R.eps) : l)));
      const s = cs[0]!.els[0]!;
      return { d0, outer: L.levels[0]!, order: slOrder(lv, [s.su, s.sv], R.eps, flip) };
    };
    /** 고리 시작마다 앞 고리 끝에서 곧게 갈 수 있는지(첫 고리는 들어가는 자리) */
    const plunges = (p: { d0: number; outer: SlLoop[]; order: SlLoop[] }): boolean[] =>
      p.order.map((l, i) => {
        if (i === 0) return true;
        const e = p.order[i - 1]![p.order[i - 1]!.length - 1]!;
        return !slSegmentFree(R, p.outer, p.d0, e.eu, e.ev, l[0]!.su, l[0]!.sv);
      });
    this.feed = fMill;
    switch (n) {
      case 21: {
        const q13 = Math.round(Q('Q13'));
        let rr = this.toolBaseRadius(q13 > 0 ? q13 : this.tool);
        if (rr === undefined) {
          this.w.add(`${C}: 거친 깎기 공구(Q13)의 반지름을 몰라 0으로 셈`, line);
          rr = 0;
        }
        const p = plan(rr);
        if (!p) break;
        const bottom = depth === 0 ? surface : surface + depth + up * Q('Q4');
        const total = Math.abs(bottom - surface);
        if (total <= 1e-9) {
          this.w.add(`${C}: 깊이가 0`, line);
          break;
        }
        const unit = this.displayInch ? 1 / 25.4 : 1;
        const adv = Math.min(7 * unit, total <= 30 * unit ? 0.6 * unit : total / 50);
        const peck = Math.abs(Q('Q10'));
        const pl = plunges(p);
        this.feed = fPlunge;
        p.order.forEach((l, i) => {
          if (!pl[i] || !more()) return;
          const u = l[0]!.su;
          const v = l[0]!.sv;
          toClear();
          go(Rp, u, v);
          go(Rp, u, v, safe);
          const first = this.mb.count;
          let d = surface;
          let guard = 0;
          while (up * (d - bottom) > 1e-9 && guard++ < PECK_MAX) {
            const next = peck > 0 ? (up > 0 ? Math.max(bottom, d - peck) : Math.min(bottom, d + peck)) : bottom;
            if (d !== surface) go(Rp, u, v, d + up * adv);
            go(MOVE_DRILL, u, v, next);
            if (next !== bottom) go(Rp, u, v, safe);
            d = next;
          }
          if (up * (d - bottom) > 1e-9) this.guardStop(`${C}: 쪼기가 ${PECK_MAX}번을 넘어 바닥에 닿기 전에 멈춤`, line);
          go(Rp, u, v, clear);
          const top = [0, 0, 0];
          top[a0] = u;
          top[a1] = v;
          top[a2] = safe;
          const bot = [top[0]!, top[1]!, top[2]!];
          bot[a2] = bottom;
          if (this.mb.count > first && this.holeDrawn(first, bot)) this.pushHoleOut(top, bot, line, 21, first);
        });
        break;
      }
      case 22:
      case 23: {
        if (n === 22) {
          if (Q('Q18') !== 0) this.w.add(`${C}: Q18(앞서 거친 깎기 한 공구)이 남긴 곳만 깎는 것은 그리지 않고 전체를 거친 깎기로 그림`, line);
          if (Q('Q19') > 0) this.w.add(`${C}: Q19(왕복 진입 이송)는 공구 표의 ANGLE을 몰라 곧게 들어가는 것으로 그림`, line);
        }
        const bottom = n === 23 || depth === 0 ? surface + depth : surface + depth + up * Q('Q4');
        if (n === 22 && depth !== 0 && up * (surface - bottom) <= 1e-9) {
          this.w.add(`${C}: 깊이(Q1)가 바닥 여유(Q4)보다 얕아 그리지 않음`, line);
          break;
        }
        const p = plan(r);
        if (!p) break;
        if (n === 22) this.slRoughR = r;
        // 층 하나의 이동(어림): 고리마다 요소 + 잇기(들어 올려 옮기면 4), 첫 고리로 들어가기
        const zs = n === 22 ? passes(bottom, Math.abs(Q('Q10')), p.order.reduce((s, l) => s + l.length + 4, 2)) : [bottom];
        const pl = plunges(p);
        const first = p.order[0]![0]!;
        toClear();
        go(Rp, first.su, first.sv);
        if (n === 22) go(Rp, first.su, first.sv, safe);
        const link = (l: SlLoop, z: number, lift: boolean): void => {
          const s = l[0]!;
          const [pu, pv] = here();
          if (Math.hypot(s.su - pu, s.sv - pv) <= 1e-9) return;
          if (!lift) {
            go(F, s.su, s.sv, z);
            return;
          }
          go(Rp, pu, pv, safe);
          go(Rp, s.su, s.sv, safe);
          this.feed = fPlunge;
          go(F, s.su, s.sv, z);
          this.feed = fMill;
        };
        for (let j = 0; j < zs.length && more(); j++) {
          const z = zs[j]!;
          if (j > 0) {
            const [pu, pv] = here();
            link(p.order[0]!, zs[j - 1]!, !slSegmentFree(R, p.outer, p.d0, pu, pv, first.su, first.sv));
          }
          this.feed = fPlunge;
          go(F, first.su, first.sv, z);
          this.feed = fMill;
          for (let i = 0; i < p.order.length && more(); i++) {
            if (i > 0) link(p.order[i]!, z, pl[i]!);
            mill(p.order[i]!, z);
          }
        }
        // 물러남: Q208(0이면 Q12, 99999 이상이면 급속)
        const q208 = this.q.get('Q208');
        if (q208 === undefined || q208 >= 99999) go(Rp, ...here(), clear);
        else {
          this.feed = q208 > 0 ? q208 : fMill;
          go(F, ...here(), clear);
        }
        break;
      }
      case 24: {
        if (Q('Q3') === 0) {
          this.w.add(`${C}: 사이클 20에 옆 여유(Q3)가 없어 그리지 않음 — 컨트롤러는 "Tool radius too large" 오류로 멈춤`, line);
          break;
        }
        const q14 = Q('Q14');
        const q438 = Math.round(Q('Q438', -1));
        const rRough = q438 < 0 ? (this.slRoughR ?? 0) : q438 === 0 ? 0 : (this.toolBaseRadius(q438) ?? 0);
        if (q14 + r >= Q('Q3') + rRough - 1e-9) this.w.add(`${C}: Q14 + 공구 반지름이 사이클 20의 Q3 + 거친 깎기 공구 반지름보다 작지 않음`, line);
        const d = Math.max(0, r + q14);
        let loops = slOffset(R, d);
        if (!loops.length) {
          this.w.add(`${C}: 공구가 윤곽보다 커서 그리지 않음`, line);
          break;
        }
        loops = loops.map((l) => slStartLongest(q8 > 0 ? slRound(l, q8, R.eps) : l, R.eps)).map((l) => (flip ? slReverse(l) : l));
        const bottom = surface + depth;
        // 층 하나의 이동(어림): 고리마다 요소 + 들어가고 나오는 호·옮기기 6
        const zs = passes(bottom, Math.abs(Q('Q10')), loops.reduce((s, l) => s + l.length + 6, 0));
        const side = flip ? -1 : 1;
        const tolD = Math.max(R.scale, d) * 1e-7;
        const free = (u: number, v: number): boolean => slInside(R, u, v) && !slNear(R, u, v, d - tolD);
        const left = loops.slice();
        while (left.length && more()) {
          // 지금 자리에서 가장 가까운 시작점의 고리부터 하나씩(설명서 286쪽 — 윤곽마다 따로)
          const [hu, hv] = here();
          let bi = 0;
          left.forEach((l, i) => {
            if (Math.hypot(l[0]!.su - hu, l[0]!.sv - hv) < Math.hypot(left[bi]![0]!.su - hu, left[bi]![0]!.sv - hv)) bi = i;
          });
          const l = left.splice(bi, 1)[0]!;
          const s = l[0]!;
          const t = slTanAt(s, 0);
          const nl = [-t[1], t[0]];
          // 접선 접근 호: 반지름은 공구 반지름(없으면 1 mm)에서 가공 면 안에 들 때까지 반씩(네 번까지, 안 되면 곧게)
          let rho = r > 0 ? r : this.displayInch ? 0.04 : 1;
          let ok = false;
          for (let k = 0; k < 5 && !ok; k++, rho /= 2) {
            const cu = s.su + side * rho * nl[0]!;
            const cv = s.sv + side * rho * nl[1]!;
            ok = [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75].every((f) => {
              // 들어오는 호(f < 0)와 나가는 호(f > 0)의 점: 시작점에서 중심 둘레로 f·90°
              const a = Math.atan2(s.sv - cv, s.su - cu) + side * f * (Math.PI / 2);
              return free(cu + rho * Math.cos(a), cv + rho * Math.sin(a));
            });
            if (ok) break;
          }
          const A: [number, number] = ok ? [s.su + side * rho * nl[0]! - rho * t[0], s.sv + side * rho * nl[1]! - rho * t[1]] : [s.su, s.sv];
          const D: [number, number] = ok ? [s.su + side * rho * nl[0]! + rho * t[0], s.sv + side * rho * nl[1]! + rho * t[1]] : [s.su, s.sv];
          const cu = s.su + side * rho * nl[0]!;
          const cv = s.sv + side * rho * nl[1]!;
          toClear();
          go(Rp, A[0], A[1]);
          go(Rp, A[0], A[1], safe);
          for (let j = 0; j < zs.length && more(); j++) {
            const z = zs[j]!;
            const gap = Math.abs(z - (j > 0 ? zs[j - 1]! : surface));
            const zh = ok ? z + up * Math.min(setup / 25, gap) : z;
            if (j > 0 && ok) go(F, A[0], A[1]);
            this.feed = fPlunge;
            go(F, A[0], A[1], zh);
            this.feed = fMill;
            if (ok) {
              this.arc3(cu, cv, side * (Math.PI / 2), s.su, s.sv, z, line);
              w = z;
            }
            mill(l, z);
            if (ok) {
              this.arc3(cu, cv, side * (Math.PI / 2), D[0], D[1], zh, line);
              w = zh;
            }
          }
          go(Rp, ...here(), clear);
        }
        break;
      }
    }
    if (hardStop) this.guardStop(`${C}: 이동이 ${SL_MOVE_MAX}개를 넘어 그 뒤는 그리지 않음`, line);
    this.feed = saveFeed;
    this.known = 7;
  }

  /**
   * 사이클 25 윤곽 트레인(49차 — TNC 640 가공 사이클 설명서 34059x-17 9.10절 292~295쪽, 사이클 270은 9.9절 290~291쪽,
   * 진입을 되풀이하는 차례는 같은 장 9.12절 302쪽 사이클 276의 "Cycle sequence" — 276은 25에 공구 축 좌표를 더한 것):
   * - 사이클 14의 첫 윤곽 LBL만 쓰고(293쪽) 열린 윤곽은 닫지 않는다. 사이클 20은 쓰지 않는다(293쪽 — Q1·Q3·Q5·Q7·Q10·Q11·Q12·Q15는 이 사이클 값)
   * - 공구 중심: 윤곽 부프로그램의 RL·RR 쪽(사이클 270이 있으면 Q391 — 290쪽)으로 공구 반지름 + Q3, R0이면 윤곽 위.
   *   윤곽을 깎아 들어가지 않게(292쪽) 공구가 들어가지 못하는 곳은 빼고 그린다(sl.ts slTrain)
   * - 깊이: 윗면 Q5에서 Q10씩 Q5 + Q1까지(Q1 = 0이면 실행하지 않음 — 293쪽). 층마다 Q15 = +1 하향·-1 상향(M3 공구가 진행 방향 왼쪽이면 하향),
   *   한 축 대칭이어도 하향·상향은 그대로(292쪽). Q15 = 0이면 층마다 번갈아 왕복하고 끝과 시작에서 내려간다(302쪽), 아니면 안전 높이로 올라
   *   시작점으로 돌아가 다음 층(302쪽)
   * - 접근·이탈(사이클 270 Q390 — 290~291쪽): 1 접선 원호(반지름 Q392·중심각 Q393), 2 접선 직선(Q394), 3 수직(Q394), 0·4 없음. 접근 시작점에서 내려간다(302쪽)
   * - 정해 그린 것: 사이클 25에는 안전 거리(Q6)가 없어 안전 높이 Q7에서 Q11로 내려간다. Q15 = 0의 첫 층은 하향 쪽. R0이면 Q15는 프로그램 차례로.
   *   끝나면 공구 축으로 Q7(평면 자리는 그대로 — 293쪽 posAfterContPocket)
   */
  private slTrainCycle(line: number): void {
    const C = 'CYCL DEF 25';
    const labels = this.slLabels;
    if (!labels?.length) {
      this.w.add(`${C}: 앞에 CYCL DEF 14(윤곽)가 없어 그리지 않음`, line);
      return;
    }
    const Q = (k: string, d = 0): number => this.q.get(k) ?? d;
    const depth = Q('Q1');
    if (depth === 0) {
      this.w.add(`${C}: 깊이(Q1)가 0이라 그리지 않음`, line);
      return;
    }
    if (labels.length > 1) this.w.add(`${C}: 윤곽 LBL이 여럿이라 첫 LBL ${labels[0]}만 씀`, line);
    const cs = this.slCapture(labels.slice(0, 1), line, true);
    if (!cs?.length) return;
    const contour = cs[0]!;
    let side = contour.comp === 1 ? 1 : contour.comp === 2 ? -1 : 0;
    if (this.ct270) {
      if (contour.comp) this.w.add(`${C}: 사이클 270이 있어 윤곽 부프로그램의 RL·RR 대신 Q391로 그림`, line);
      const q391 = Math.round(Q('Q391'));
      side = q391 === 1 ? 1 : q391 === 2 ? -1 : 0;
    } else if (!side) this.w.add(`${C}: 윤곽에 RL·RR이 없어 공구 중심이 윤곽 위를 감(하향·상향 Q15는 프로그램 차례로)`, line);
    let r = this.toolRadius();
    if (r === undefined) {
      if (side) this.w.add(`${C}: 공구 반지름을 몰라(TOOL DEF R 없음) 반지름 0으로 그림`, line);
      r = 0;
    }
    if (Q('Q18') !== 0) this.w.add(`${C}: Q18(앞서 거친 깎기 한 공구)이 남긴 곳만 깎는 것은 그리지 않고 윤곽 전체를 그림`, line);
    const T = slTrain(contour.els, Math.max(0, r + Q('Q3')), side);
    if (!T.runs.length) {
      this.w.add(`${C}: 공구가 윤곽보다 커서 그리지 않음`, line);
      return;
    }
    if (T.cut) this.w.add(`${C}: 공구가 커서 윤곽 일부는 깎지 않음(윤곽을 깎아 들어가지 않게)`, line);
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    const up = depth > 0 ? -1 : 1;
    const surface = Q('Q5') + this.shift[a2]!;
    const bottom = surface + depth;
    let w = this.pos[a2]!;
    const q7 = this.q.get('Q7');
    let clear: number;
    if (q7 === undefined) {
      this.w.add(`${C}: 안전 높이(Q7)가 없어 지금 공구 높이로 셈`, line);
      clear = up * (w - surface) < 0 ? w : surface;
    } else clear = q7 + this.shift[a2]!;
    const fPlunge = Q('Q11', this.feed || this.autoFeed);
    const fMill = Q('Q12', this.feed || this.autoFeed);
    const saveFeed = this.feed;
    const loop = this.blockLoop();
    const callStart = this.mb.count;
    let hardStop = false;
    const more = (): boolean => {
      if (!loop()) return false;
      if (this.mb.count - callStart < SL_MOVE_MAX) return true;
      hardStop = true;
      return false;
    };
    const F = MOVE_FEED;
    const Rp = MOVE_RAPID;
    const here = (): [number, number] => [this.pos[a0]!, this.pos[a1]!];
    const go = (kind: number, u: number, v: number, ww = w): void => {
      this.go3(kind, u, v, ww, line);
      w = ww;
    };
    const arc = (cu: number, cv: number, sweep: number, eu: number, ev: number): void => {
      this.arc3(cu, cv, sweep, eu, ev, w, line);
    };
    const toClear = (): void => {
      if (up * (w - clear) < 0) go(Rp, ...here(), clear);
    };
    const mill = (l: SlLoop): void => {
      for (const e of l) {
        if (!more()) return;
        if (e.arc) arc(e.cu, e.cv, e.sweep, e.eu, e.ev);
        else go(F, e.eu, e.ev);
      }
    };
    // 하향이 프로그램 차례인지(공구가 진행 방향 왼쪽 — RL). 한 축 대칭이면 화면에서 반대가 되므로 거꾸로 돌려 하향·상향을 지킨다
    const q15 = Math.round(Q('Q15', 1));
    const climbFwd = (side > 0) !== this.cycleMirrored();
    const firstFwd = side === 0 ? true : q15 < 0 ? !climbFwd : climbFwd;
    const fwdRuns = T.runs;
    const backRuns = T.runs
      .slice()
      .reverse()
      .map((l) => slReverse(l));
    // 접근·이탈(사이클 270)
    let kind = this.ct270 ? Math.round(Q('Q390')) : 0;
    if (kind >= 1 && kind <= 3 && !side) {
      this.w.add(`${C}: 보정 없이(R0) 접근·이탈(Q390)은 그리지 않음`, line);
      kind = 0;
    }
    const rho = Q('Q392');
    const beta = (Q('Q393') * Math.PI) / 180;
    const dist = Q('Q394');
    if ((kind === 1 && !(rho > 0 && beta > 0)) || ((kind === 2 || kind === 3) && !(dist > 0))) kind = 0;
    /** 접근 시작점과 접근 그리기(fwd = 프로그램 차례로 도는지 — 공구가 진행 방향의 어느 쪽에 비켜 있는지가 바뀐다) */
    const rot = (pu: number, pv: number, cu: number, cv: number, a: number): [number, number] => [cu + (pu - cu) * Math.cos(a) - (pv - cv) * Math.sin(a), cv + (pu - cu) * Math.sin(a) + (pv - cv) * Math.cos(a)];
    const ends = (runs: SlLoop[], fwd: boolean) => {
      // 비킨 쪽(윤곽에서 먼 쪽): 진행 방향 왼쪽이면 +1
      const fs = side > 0 === fwd ? 1 : -1;
      const s = runs[0]![0]!;
      const t = slTanAt(s, 0);
      const last = runs[runs.length - 1]!;
      const e = last[last.length - 1]!;
      const te = slTanAt(e, 1);
      let A: [number, number] = [s.su, s.sv];
      let D: [number, number] = [e.eu, e.ev];
      let into = (): void => {};
      let out = (): void => {};
      if (kind === 1) {
        const cu = s.su - fs * rho * t[1];
        const cv = s.sv + fs * rho * t[0];
        A = rot(s.su, s.sv, cu, cv, -fs * beta);
        into = () => arc(cu, cv, fs * beta, s.su, s.sv);
        const du = e.eu - fs * rho * te[1];
        const dv = e.ev + fs * rho * te[0];
        D = rot(e.eu, e.ev, du, dv, fs * beta);
        out = () => arc(du, dv, fs * beta, D[0], D[1]);
      } else if (kind === 2) {
        A = [s.su - dist * t[0], s.sv - dist * t[1]];
        into = () => go(F, s.su, s.sv);
        D = [e.eu + dist * te[0], e.ev + dist * te[1]];
        out = () => go(F, D[0], D[1]);
      } else if (kind === 3) {
        A = [s.su - fs * dist * t[1], s.sv + fs * dist * t[0]];
        into = () => go(F, s.su, s.sv);
        D = [e.eu - fs * dist * te[1], e.ev + fs * dist * te[0]];
        out = () => go(F, D[0], D[1]);
      }
      return { A, into, out };
    };
    /** 한 층: 들어가는 자리에서 z로 내려가(fromClear면 안전 높이에서 옮겨 와서) 고리 조각들을 차례로, 조각 사이는 올라 옮긴다 */
    const pass = (runs: SlLoop[], fwd: boolean, z: number, fromClear: boolean, approach: boolean, depart: boolean): void => {
      const E = ends(runs, fwd);
      runs.forEach((l, k) => {
        if (!more()) return;
        const s = l[0]!;
        const P: [number, number] = k === 0 && approach ? E.A : [s.su, s.sv];
        if (k > 0 || fromClear) {
          toClear();
          go(Rp, P[0], P[1]);
        }
        this.feed = fPlunge;
        go(F, P[0], P[1], z);
        this.feed = fMill;
        if (k === 0 && approach) E.into();
        mill(l);
        if (k < runs.length - 1) toClear();
      });
      if (depart && more()) E.out();
    };
    // 층 하나의 이동(어림): 조각 요소 + 옮기기·내려가기 4씩 + 접근·이탈 4
    const per = T.runs.reduce((s, l) => s + l.length + 4, 4);
    const zs = this.slPasses(C, line, surface, up, bottom, Math.abs(Q('Q10')), per);
    this.feed = fMill;
    toClear();
    for (let j = 0; j < zs.length && more(); j++) {
      const z = zs[j]!;
      if (q15 === 0) {
        // 왕복: 층마다 방향을 바꾸고 끝 자리에서 그대로 내려간다(접근은 처음, 이탈은 마지막에만)
        const fwd = j % 2 === 0 ? firstFwd : !firstFwd;
        pass(fwd ? fwdRuns : backRuns, fwd, z, j === 0, j === 0 && kind > 0, j === zs.length - 1 && kind > 0);
      } else {
        pass(firstFwd ? fwdRuns : backRuns, firstFwd, z, true, kind > 0, kind > 0);
        go(Rp, ...here(), clear);
      }
    }
    go(Rp, ...here(), clear);
    if (hardStop) this.guardStop(`${C}: 이동이 ${SL_MOVE_MAX}개를 넘어 그 뒤는 그리지 않음`, line);
    this.feed = saveFeed;
    this.known = 7;
  }

  finish(): NcProgram {
    return this.build({ name: this.o.name ?? (this.name || 'Heidenhain'), format: 'heidenhain', dialect: 'heidenhain', blocks: this.blocks, stock: this.stock });
  }

}

function indexOutsideQuotes(s: string, ch: string): number {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    else if (c === ch && !q) return i;
  }
  return -1;
}

/** 윤곽 부프로그램(SL 사이클)에서 읽는 블록(경로 요소·모서리·Q 계산) — 48차 */
const SL_CAP_WORDS = new Set(['L', 'C', 'CR', 'CT', 'CC', 'LP', 'CP', 'FPOL', 'FL', 'FLT', 'FC', 'FCT', 'FSELECT', 'RND', 'CHF', 'FN']);
/** 윤곽 부프로그램에서 읽는 좌표 변환 사이클(49차): 7 원점 이동·8 대칭·10 회전·11 배율·26 축별 배율 */
const SL_CAP_XF = new Set([7, 8, 10, 11, 26]);

/** 사이클 14의 표지 낱말(CONTOUR LABEL1 /2 /3·KONTURLABEL1 /2·DIN/ISO G37 P01 1 P02 2를 옮긴 1 /2)에서 표지 번호 */
function slLabelWords(T: readonly string[]): string[] {
  return [...T.join(' ').matchAll(/\d+/g)].map((m) => String(+m[0]));
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /"[^"]*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0]);
  // "Q1 = 5" 꼴을 한 낱말로 붙이지는 않는다(qAssign은 글 전체를 본다)
  return out;
}

/** 'R+5', 'S3000' 꼴에서 글자 뒤 값 */
function findWord(T: string[], letter: string): string | undefined {
  const re = new RegExp(`^${letter}([+-]?(?:[\\d.]+|Q[LRS]?\\d+))$`, 'i');
  for (const w of T) {
    const m = re.exec(w);
    if (m) return m[1];
  }
  return undefined;
}

/** Heidenhain 평문을 해석한다 */
export function parseHeidenhain(input: Uint8Array | ArrayBuffer | string | NcSource, opts: HeidenhainOptions = {}): NcProgram {
  const src = isSource(input) ? input : makeSource(input);
  const r = new HRunner(src, opts);
  r.run();
  return r.finish();
}
