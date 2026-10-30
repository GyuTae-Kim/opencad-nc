/**
 * G-code(ISO 6983 / RS-274 계열) 해석기 — 블록을 읽고 모달 상태 기계로 실행해 이동 목록을 만든다.
 *
 * 블록 읽기: N 번호, 주석 `( )`·`;`, 블록 건너뛰기 `/`, `%`, 대소문자, 공백 없는 꼴(`G01X10Y5`).
 * 흔한 줄은 바이트에서 바로 읽고(빠른 길), `#`·`[`·`=`·낱말(IF·WHILE·GOTO·o-코드)이 있는 줄만 글로 바꿔 읽는다.
 *
 * 지원: G0 G1 G2 G3(IJK·R·나선·완전한 원·LinuxCNC P 바퀴 수) G5·G5.1(LinuxCNC 스플라인) G5.2/G5.3(LinuxCNC NURBS) G4 G10(L2/L20 좌표계 값) G17 G18 G19 G20 G21
 * G28 G30 G40 G41 G42 G43 G44 G49 G52 G53 G54~G59(G54.1 P·G59.1~3) G61 G64 G73 G74 G76 G80~G89 G90 G91
 * G90.1 G91.1 G92(.1/.2) G93 G94 G95 G98 G99, T M6 M3 M4 M5 M7 M8 M9 M0 M1 M2 M30 M98 M99 M97 G65,
 * 변수(#n, #[식], #<이름>)·식, Fanuc IF/GOTO/WHILE/DO/END, LinuxCNC o-코드(sub/call/if/while/do/repeat).
 * 좌표계 오프셋 값은 프로그램 안 G10이나 선택 사항으로 주어진 것만 알고, 모르면 0으로 본다(경고).
 *
 * 좌표 변환: G68/G69 회전(Mach3는 G68 A·B = 중심), G51/G50 배율(Fanuc: X·Y·Z 중심 + P 또는 I·J·K, Mach3: 축별 배율),
 * G51.1/G50.1 거울, LinuxCNC G10 L2 R(좌표계 회전). 변환은 프로그램 좌표에 거울 → 배율 → 회전 차례로 건다.
 * 반경 보정: G41/G42(D 번호 → 선택 공구 표·G10 L12/L13(Fanuc)·G10 L1 R(LinuxCNC·Mach3)·공구 주석 지름), G41.1/G42.1 D 지름.
 * 선반 모드는 공구 방향도 기록한다(G41.1/G42.1 L·공구 표·LinuxCNC G10 L1 Q, 없으면 앱 선반 공구 표 — 노즈 반지름도 파일에 없으면 그 표).
 * 프로그램 경로는 그대로 두고 구간만 기록한다(NcProgram.compRuns → comp.ts가 공구 중심·선반 가상 공구 끝 경로를 계산).
 * 선택: 선반 모드(lathe — G18, X 지름/반지름 G7/G8, U·W 증분, G96/G97, G90/G92/G94 단순 사이클, G70~G76 복합 사이클,
 * Fanuc G 코드 체계 B·C는 latheSysCode가 A 체계 코드로 바꿔 읽음, LinuxCNC G70·G71·G72(.1·.2)는 o-코드 윤곽 Q — lathe-g7x.ts),
 * 회전축 감기(rotary — A·B·C를 축 둘레로 감아 공구 끝 경로).
 */
import { affinePlane, applyAffine, composeAffine, diagAbout, invertAffine, rotAbout, rotAxis, translateAffine, ZERO3, type Affine } from './affine';
import { ExprError, GExpr, type GVarRef } from './expr';
import { NcEmitter, type CompTip } from './emitter';
import {
  FLAG_CYCLE,
  FLAG_MACHINE,
  JOB_FILE_MARK,
  MODAL_INC,
  MODAL_POLAR,
  MODAL_XF,
  MOVE_DRILL,
  MOVE_FEED,
  MOVE_RAPID,
  PLANE_AXES,
  arcPoints,
  toolInfoFromComment,
  type NcDialect,
  type NcMachineOptions,
  type NcPlane,
  type NcProgram,
  type NcRotaryOptions,
} from './model';
import { g7xCorners, g7xLine, g7xMonotonic, g7xOffset, g7xPolyline, g7xRidge, g7xRough, g7xSide, g7xSplit, type G7xCorner, type G7xEl } from './lathe-g7x';
import { decodeRange, lineRange, makeSource, sourceLine, type NcSource } from './text';

export interface GcodeOptions {
  /** 프로그램 이름(보통 파일 이름) */
  name?: string;
  /** 방언(기본 'auto' — 글에서 판별) */
  dialect?: NcDialect | 'auto';
  /** 단위 코드(G20/G21)가 없을 때의 단위(기본 mm) */
  units?: 'mm' | 'inch';
  /** 급속 속도(표시 단위/분, 기본 mm 10000 · inch 400) — 시간 계산용 */
  rapidFeed?: number;
  /** '/' 블록을 건너뛸지(기본 false: 블록 건너뛰기 스위치 꺼짐 = 실행) */
  blockDelete?: boolean;
  /** 이동 수 한도(기본 800만) */
  maxMoves?: number;
  /** 실행 블록 수 한도(기본 max(줄 수 × 20, 500만)) — 끝없는 반복 막기 */
  maxBlocks?: number;
  /** 시작 위치(주면 첫 이동부터 그린다. 없으면 처음 지정되는 좌표부터) */
  initialPosition?: [number, number, number];
  /** G28·G30 기준점(표시 좌표). 없고 machineOffset도 없으면 공구 축만 안전 높이(추정)로 옮긴다 */
  homePosition?: [number, number, number];
  /**
   * 첫 작업 좌표계 원점의 기계 좌표(표시 단위). 주면 G53 값과 G28·G30 기준점(referencePoint)을 실제 위치로 그린다.
   * 없으면 기계 좌표 쪽 이동은 공구 축을 "안전 높이"(경로 맨 위 + 여유)로 그리고 FLAG_MACHINE_EST를 단다
   */
  machineOffset?: [number, number, number];
  /** G28 기준점의 기계 좌표(machineOffset과 함께, 기본 0,0,0) */
  referencePoint?: [number, number, number];
  /** IJK를 절대값으로 볼지(G90.1 기본, 일부 Mach3 설정) */
  arcCenterAbsolute?: boolean;
  /** 작업 좌표계 오프셋(기계 좌표, 표시 단위). 키: 'G54'…'G59', 'G54.1P1'… */
  workOffsets?: Record<string, [number, number, number]>;
  /** G83 되돌아 들어갈 때 남기는 틈·G73 물러나는 양(표시 단위, 기본 mm 0.5 · inch 0.02) */
  peckClearance?: number;
  /**
   * 반경 보정용 공구 표(표시 단위). 키 = D 번호(LinuxCNC는 공구 번호). 선반 모드에서 radius·diameter는 노즈 반지름·지름이고,
   * orientation은 LinuxCNC 공구 방향(0~9 — 1~8이면 보정 경로를 가상 공구 끝으로, 9는 노즈 중심)
   */
  toolTable?: Record<number, { diameter?: number; radius?: number; orientation?: number }>;
  /**
   * 선반 모드(기본 false). true면 G18 평면, X를 지름으로(LinuxCNC·GRBL은 G7 전까지 반지름), U·W 증분(Fanuc 계열),
   * G90/G92/G94·G70~G76 선반 사이클로 읽고, 경로는 XZ 단면(X = 반지름)으로 만든다. 'auto'면 글 앞부분으로 판별
   */
  lathe?: boolean | 'auto';
  /** 선반 모드에서 처음부터 X를 지름으로 볼지(기본: LinuxCNC·GRBL은 반지름, 그 밖은 지름) */
  latheDiameter?: boolean;
  /**
   * Fanuc 계열 선반의 G 코드 체계(기본 'auto' — 글로 판별, 정할 수 없으면 A). A: G90/G92/G94 단순 사이클·U/W 증분·G98/G99 이송 단위,
   * B: G77/G78/G79 단순 사이클·G90/G91 절대/증분·G94/G95 이송 단위·G98/G99 복귀 높이·G92 좌표 설정,
   * C: B에 더해 G20/G21/G24 단순 사이클·G70/G71 inch/mm·G72~G78 복합 사이클(A의 G70~G76)
   */
  latheSystem?: 'A' | 'B' | 'C' | 'auto';
  /** 회전축 감기(기본 꺼짐 — A·B·C는 무시하고 경고). true면 A→X, B→Y, C→Z 축 둘레 */
  rotary?: boolean | NcRotaryOptions;
  /**
   * 소수점 없는 좌표 값을 최소 입력 단위로(Fanuc 매개변수 3401#0 DPI = 0 꼴, 기본 false): X·Y·Z·U·V·W·I·J·K·R·Q는
   * mm 0.001·inch 0.0001, A·B·C는 0.001도. 끄면 소수점 없는 큰 좌표가 많을 때 notices에 'integer-units'를 단다
   */
  integerUnits?: boolean;
  /** 공구 길이 보정 H·반경 보정 D 번호가 공구 번호와 다르면 경고(기본 true) */
  checkToolNumbers?: boolean;
  /**
   * 기계·읽기 설정(mm 기준, 앱 설정): 급속 속도·공구 교환 시간·도그레그 급속·축별 허용 범위, 기계 오프셋·기준점.
   * 프로그램 단위가 inch면 바꿔 쓴다. rapidFeed·machineOffset·referencePoint를 따로 주면 그쪽이 먼저
   */
  machine?: NcMachineOptions;
}

/** 소수점 없으면 최소 입력 단위로 읽는 낱말(X Y Z U V W I J K R Q A B C) */
const INT_LETTERS = [23, 24, 25, 20, 21, 22, 8, 9, 10, 17, 16, 0, 1, 2];

// ───────────────────────── 블록 ─────────────────────────

const A = 65;
const LX = 23,
  LY = 24,
  LZ = 25,
  LI = 8,
  LJ = 9,
  LK = 10,
  LR = 17,
  LP = 15,
  LQ = 16,
  LL = 11,
  LF = 5,
  LS = 18,
  LT = 19,
  LO = 14,
  LN = 13,
  LD = 3,
  LU = 20,
  LW = 22,
  LA = 0,
  LB = 1,
  LC = 2,
  LE = 4;
const AXIS_LETTER = [LX, LY, LZ];
const OFFSET_LETTER = [LI, LJ, LK];

type Ctrl =
  | { k: 'goto'; n: number }
  | { k: 'while'; ok: boolean; m: number }
  | { k: 'end'; m: number }
  | { k: 'do'; m: number }
  | { k: 'o'; label: string; kw: string; val: number | undefined; args: number[] };

export class Block {
  has = new Uint8Array(26);
  val = new Float64Array(26);
  dot = new Uint8Array(26);
  g = new Int32Array(24);
  gCount = 0;
  m = new Int32Array(12);
  mCount = 0;
  comments: string[] = [];
  blockDelete = false;
  percent = false;
  words = 0;
  assigns: [GVarRef, number | undefined][] = [];
  ctrl: Ctrl | null = null;
  // ── Siemens 꼴(siemens.ts가 채운다. G-code 해석은 늘 0·null) ──
  /** 축별 절대(AC)·증분(IC) 덮어쓰기 비트(1 x, 2 y, 4 z) */
  axAbs = 0;
  axInc = 0;
  /** 원호 중심 I·J·K 절대(AC) 비트(1 I, 2 J, 4 K) */
  cAbs = 0;
  /** 낱말이 아닌 것만 있는 줄(빈 줄·주석) */
  reset(): void {
    this.has.fill(0);
    this.gCount = 0;
    this.mCount = 0;
    if (this.comments.length) this.comments = [];
    this.blockDelete = false;
    this.percent = false;
    this.words = 0;
    if (this.assigns.length) this.assigns = [];
    this.ctrl = null;
    this.axAbs = this.axInc = this.cAbs = 0;
  }
  set(letter: number, v: number, dot: boolean): void {
    if (letter === 6) {
      if (this.gCount < this.g.length) this.g[this.gCount++] = Math.round(v * 10);
    } else if (letter === 12) {
      if (this.mCount < this.m.length) this.m[this.mCount++] = Math.round(v);
    } else {
      this.has[letter] = 1;
      this.val[letter] = v;
      this.dot[letter] = dot ? 1 : 0;
    }
    this.words++;
  }
  hasG(code: number): boolean {
    for (let i = 0; i < this.gCount; i++) if (this.g[i] === code) return true;
    return false;
  }
  hasM(code: number): boolean {
    for (let i = 0; i < this.mCount; i++) if (this.m[i] === code) return true;
    return false;
  }
}

const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];

/**
 * 빠른 길: 바이트에서 바로 낱말을 읽는다. 식·변수·낱말 연산이 있으면 false(글로 다시 읽는다).
 * 주석 글은 cb로 돌려준다.
 */
function parseFast(b: Uint8Array, s: number, e: number, blk: Block, onComment: (cs: number, ce: number) => void): boolean {
  let i = s;
  while (i < e && (b[i] === 32 || b[i] === 9)) i++;
  if (i < e && b[i] === 47) {
    // 블록 건너뛰기 / (Fanuc /1~/9 스위치 번호 포함)
    blk.blockDelete = true;
    i++;
    if (i < e && b[i]! >= 49 && b[i]! <= 57) i++;
  }
  if (i < e && b[i] === 37) {
    // '%' 줄
    let j = i + 1;
    while (j < e && (b[j] === 32 || b[j] === 9)) j++;
    if (j >= e || b[j] === 40 || b[j] === 59) {
      blk.percent = true;
      return true;
    }
  }
  while (i < e) {
    let c = b[i]!;
    if (c === 32 || c === 9 || c === 13) {
      i++;
      continue;
    }
    if (c === 40) {
      // ( 주석 ) — 안에 괄호가 있어도 짝을 맞춘다
      let j = i + 1;
      let depth = 1;
      while (j < e) {
        if (b[j] === 40) depth++;
        else if (b[j] === 41 && --depth === 0) break;
        j++;
      }
      onComment(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === 59) {
      onComment(i + 1, e);
      return true;
    }
    if (c >= 97 && c <= 122) c -= 32;
    else if (c === 58) c = 79; // ':' 프로그램 번호 = O
    if (c < 65 || c > 90) {
      if (c === 37) return true; // 줄 끝의 %
      return false;
    }
    const letter = c - A;
    i++;
    while (i < e && (b[i] === 32 || b[i] === 9)) i++;
    // 수
    let neg = false;
    let d = b[i];
    if (d === 45 || d === 43) {
      neg = d === 45;
      i++;
      while (i < e && (b[i] === 32 || b[i] === 9)) i++;
      d = b[i];
    }
    const n0 = i;
    let mant = 0;
    let digits = 0;
    let dec = -1;
    while (i < e) {
      d = b[i]!;
      if (d >= 48 && d <= 57) {
        mant = mant * 10 + (d - 48);
        digits++;
        if (dec >= 0) dec++;
        i++;
      } else if (d === 46 && dec < 0) {
        dec = 0;
        i++;
      } else break;
    }
    if (digits === 0) return false; // 글자 뒤에 수가 없다(낱말·식)
    let v: number;
    if (digits > 15) v = parseFloat(String.fromCharCode(...b.subarray(n0, Math.min(i, n0 + 64))));
    else v = dec > 0 ? mant / POW10[dec]! : mant;
    blk.set(letter, neg ? -v : v, dec >= 0);
  }
  return true;
}

/** 느린 길에서 쓰는 변수 저장소 연결 */
interface SlowEnv {
  get(ref: GVarRef): number | undefined;
  has?(ref: GVarRef): boolean;
  readonly fanucRounding?: boolean;
}

/** 소수점 없는 수 낱말 값(부호 + 숫자, 뒤에 숫자·소수점이 더 없음) — lastIndex에서 맞춘다 */
const INT_LITERAL = /[-+]?\d+(?![\d.])/y;

const O_KEYWORDS = ['ENDSUB', 'SUB', 'CALL', 'RETURN', 'ELSEIF', 'ELSE', 'ENDIF', 'IF', 'ENDWHILE', 'WHILE', 'DO', 'ENDREPEAT', 'REPEAT', 'BREAK', 'CONTINUE'];

/** 주석을 떼고 대문자·공백 없는 글로 */
function splitComments(text: string, comments: string[] | null): string {
  let code = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '(') {
      let j = i + 1;
      let depth = 1;
      while (j < n) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')' && --depth === 0) break;
        j++;
      }
      if (comments) comments.push(text.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    if (c === ';') {
      if (comments) comments.push(text.slice(i + 1));
      break;
    }
    if (c !== ' ' && c !== '\t' && c !== '\r') code += c;
    i++;
  }
  return code.toUpperCase();
}

/**
 * 느린 길: 식·변수·제어 낱말이 있는 줄. 식은 읽을 때 바로 계산한다(반복마다 다시 읽는다).
 * 실패하면 ExprError.
 */
function parseSlow(text: string, blk: Block, env: SlowEnv): void {
  let code = splitComments(text, blk.comments);
  if (code.startsWith('/')) {
    blk.blockDelete = true;
    code = code.slice(/^\/[1-9]/.test(code) ? 2 : 1);
  }
  if (code.startsWith(':')) code = 'O' + code.slice(1);
  // GRBL 설정·명령($H, $X, $J=…)은 이동이 아니다
  if (code.startsWith('$')) return;
  if (code === '%' || code === '') {
    if (code === '%') blk.percent = true;
    return;
  }
  const ex = new GExpr(code, 0, env);
  const s = code;
  // N 번호
  if (s[0] === 'N' && /[0-9]/.test(s[1] ?? '')) {
    ex.pos = 1;
    blk.set(LN, ex.number(), false);
  }
  // o-코드(LinuxCNC)·프로그램 번호
  if (s[ex.pos] === 'O' && /[0-9<]/.test(s[ex.pos + 1] ?? '')) {
    const p0 = ex.pos + 1;
    let label: string;
    let p = p0;
    if (s[p] === '<') {
      const e = s.indexOf('>', p);
      if (e < 0) throw new ExprError('> 없음');
      label = s.slice(p + 1, e).toLowerCase();
      p = e + 1;
    } else {
      while (p < s.length && /[0-9]/.test(s[p]!)) p++;
      label = String(parseInt(s.slice(p0, p), 10));
    }
    const kw = O_KEYWORDS.find((k) => s.startsWith(k, p));
    if (!kw) {
      if (p >= s.length && /^[0-9]+$/.test(label)) {
        blk.set(LO, +label, false);
        return;
      }
      throw new ExprError(`알 수 없는 o-코드 '${s.slice(p, p + 10)}'`);
    }
    p += kw.length;
    ex.pos = p;
    let val: number | undefined;
    const args: number[] = [];
    if (kw === 'CALL') {
      while (s[ex.pos] === '[') {
        ex.pos++;
        args.push(ex.expr());
        if (s[ex.pos] !== ']') throw new ExprError('] 없음');
        ex.pos++;
      }
    } else if (s[ex.pos] === '[') {
      ex.pos++;
      val = ex.expr();
      if (s[ex.pos] !== ']') throw new ExprError('] 없음');
      ex.pos++;
    }
    blk.ctrl = { k: 'o', label, kw, val, args };
    return;
  }
  const assign = (): void => {
    // ex.pos는 '#' 다음
    const ref = ex.varRef();
    if (s[ex.pos] !== '=') throw new ExprError('= 없음');
    ex.pos++;
    let v: number | undefined;
    if (/^#0(?![0-9])/.test(s.slice(ex.pos, ex.pos + 3))) ex.pos += 2;
    else v = ex.expr();
    blk.assigns.push([ref, v]);
  };
  while (ex.pos < s.length) {
    const c = s[ex.pos]!;
    if (c === '#') {
      ex.pos++;
      assign();
      continue;
    }
    if (s.startsWith('IF', ex.pos) && s[ex.pos + 2] === '[') {
      ex.pos += 3;
      const cond = ex.expr();
      if (s[ex.pos] !== ']') throw new ExprError('] 없음');
      ex.pos++;
      if (s.startsWith('GOTO', ex.pos)) {
        ex.pos += 4;
        const n = ex.unary() ?? 0;
        if (cond !== 0) blk.ctrl = { k: 'goto', n: Math.round(n) };
        return;
      }
      if (s.startsWith('THEN', ex.pos)) {
        ex.pos += 4;
        const before = blk.assigns.length;
        while (s[ex.pos] === '#') {
          ex.pos++;
          assign();
        }
        if (cond === 0) blk.assigns.length = before;
        return;
      }
      throw new ExprError('IF 뒤에 GOTO·THEN 없음');
    }
    if (s.startsWith('WHILE', ex.pos) && s[ex.pos + 5] === '[') {
      ex.pos += 6;
      const cond = ex.expr();
      if (s[ex.pos] !== ']') throw new ExprError('] 없음');
      ex.pos++;
      if (!s.startsWith('DO', ex.pos)) throw new ExprError('WHILE 뒤에 DO 없음');
      ex.pos += 2;
      blk.ctrl = { k: 'while', ok: cond !== 0, m: Math.round(ex.number()) };
      return;
    }
    if (s.startsWith('GOTO', ex.pos)) {
      ex.pos += 4;
      blk.ctrl = { k: 'goto', n: Math.round(ex.unary() ?? 0) };
      return;
    }
    if (s.startsWith('END', ex.pos) && /[0-9]/.test(s[ex.pos + 3] ?? '')) {
      ex.pos += 3;
      blk.ctrl = { k: 'end', m: Math.round(ex.number()) };
      return;
    }
    if (s.startsWith('DO', ex.pos) && /[0-9]/.test(s[ex.pos + 2] ?? '')) {
      ex.pos += 2;
      blk.ctrl = { k: 'do', m: Math.round(ex.number()) };
      return;
    }
    if (c >= 'A' && c <= 'Z') {
      ex.pos++;
      // Siemens 꼴 X=식
      let v: number | undefined;
      // 소수점 없는 수 그대로(X20000)인지 — 최소 입력 단위 읽기에 쓴다. 변수·식 값은 소수점이 있는 것으로 본다
      let dot = true;
      if (s[ex.pos] === '=') {
        ex.pos++;
        v = ex.expr();
      } else {
        INT_LITERAL.lastIndex = ex.pos;
        dot = !INT_LITERAL.test(s);
        v = ex.unary();
      }
      if (v !== undefined) blk.set(c.charCodeAt(0) - A, v, dot);
      continue;
    }
    if (c === '%') return;
    throw new ExprError(`알 수 없는 글자 '${c}'`);
  }
}

// ───────────────────────── 방언 판별 ─────────────────────────

/** Fanuc 제어 낱말(이 뒤의 괄호는 식이 아니라 주석): GOTO10(…)·DO1(…)·END1(…)·THEN(…) */
const FANUC_WORD_BEFORE_PAREN = /^(?:GOTO|DO|END|THEN|EQ|NE|GT|LT|GE|LE|AND|OR|XOR)\d*$/i;

/** text[i]의 "("가 Siemens 함수 인수·식 괄호인지: 두 글자 넘는 이름 바로 뒤(CYCLE81(·AC(·SIN(), = 또는 연산자·쉼표 뒤 */
function codeParen(text: string, i: number): boolean {
  const before = text.charCodeAt(i - 1);
  // 이름(글자·숫자·_)이 바로 붙어 있으면: 앞의 두 글자가 글자여야 함수 이름(N1(…)·T1M6(…)·X0(…)은 주석)
  if ((before >= 48 && before <= 57) || (before >= 65 && before <= 90) || (before >= 97 && before <= 122) || before === 95) {
    let k = i - 1;
    while (k > 0) {
      const c = text.charCodeAt(k - 1);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) k--;
      else break;
    }
    const name = text.slice(k, i);
    return /^[A-Z_][A-Z_]/i.test(name) && !FANUC_WORD_BEFORE_PAREN.test(name);
  }
  // 빈칸을 건너 바로 앞 글자: = 와 연산자·쉼표는 식 괄호(Siemens X=(R1+2)·R3=R1*(R2+1)). 줄 앞 '/'는 블록 건너뛰기
  let k = i - 1;
  while (k >= 0 && (text.charCodeAt(k) === 32 || text.charCodeAt(k) === 9)) k--;
  if (k < 0) return false;
  const c = text[k]!;
  if (c === '=' || c === '*' || c === '+' || c === '-' || c === ',') return true;
  if (c === '/') {
    let j = k - 1;
    while (j >= 0 && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) j--;
    return j >= 0 && text.charCodeAt(j) !== 10;
  }
  return false;
}

let stripCache: { text: string; out: string } | null = null;

/**
 * 괄호 주석 "( … )"을 떼고 빈칸으로 바꾼다(판별용). 낱말에 붙은 주석(N1(…)·T1M6(…)·G0X0(…))과 겹친 주석 "((…))"도 뗀다.
 * Siemens 함수 인수(CYCLE81(…)·=AC(…)·SIN(…))와 식 괄호(= ·연산자 뒤)는 남긴다. 닫히지 않은 주석은 줄 끝까지
 */
export function stripParenComments(text: string): string {
  if (stripCache && stripCache.text === text) return stripCache.out;
  if (text.indexOf('(') < 0) return text;
  const parts: string[] = [];
  let last = 0;
  let keep = 0; // 남긴(식) 괄호 깊이
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      keep = 0;
      continue;
    }
    if (c === 41) {
      if (keep > 0) keep--;
      continue;
    }
    if (c !== 40) continue;
    if (keep > 0 || codeParen(text, i)) {
      keep++;
      continue;
    }
    let j = i + 1;
    let depth = 1;
    while (j < n) {
      const cj = text.charCodeAt(j);
      if (cj === 10) break;
      if (cj === 40) depth++;
      else if (cj === 41 && --depth === 0) break;
      j++;
    }
    parts.push(text.slice(last, i), ' ');
    last = j < n && text.charCodeAt(j) === 41 ? j + 1 : j;
    i = last - 1;
  }
  parts.push(text.slice(last));
  const out = parts.join('');
  stripCache = { text, out };
  return out;
}

/** Siemens 표지(주석을 뗀 글에서): 맞은 표지 종류 수 */
const SIEMENS_MARKS: RegExp[] = [
  /\bMCALL\b/i,
  /\b(?:CYCLE\d{2,3}|HOLES[12]|POCKET[1-4]|SLOT[12]|LONGHOLE)\s*\(/i,
  /\bT\s*=\s*"/i,
  /\bCR\s*=\s*[-+.\dR(]/i,
  /=\s*(?:AC|IC)\s*\(/i,
  /\bGOTO[FB]\b/i,
  /\bDEF\s+(?:REAL|INT|BOOL|CHAR|STRING|AXIS|FRAME)\b/i,
  /\b(?:SUPA|ATRANS|AROT|AMIRROR|ASCALE)\b/i,
  /^\s*(?:N\d+\s+)?(?:TRANS|ROT|MIRROR|SCALE)\s+(?:[XYZ][-+.\d]|RPL\s*=)/im,
  /(?:^|\s)G(?:64[1-5]|700|710|500|50[5-9]|5[1-9]\d)(?![\d.])/im,
  /^\s*(?:N\d+\s+)?R\d+\s*=/im,
];

/** 판별용 코드 글: 괄호 주석과 ; 주석을 뗀다 */
let codeCache: { head: string; code: string } | null = null;
function detectCode(head: string): string {
  if (codeCache && codeCache.head === head) return codeCache.code;
  const code = stripParenComments(head).replace(/;[^\n]*/g, ' ');
  codeCache = { head, code };
  return code;
}

function siemensHeader(head: string): boolean {
  return /^\s*%_N_\w+_(?:MPF|SPF)\b/im.test(head) || /\$PATH\s*=\s*\/_N_/i.test(head);
}

/** Siemens 표지 종류 수(%_N_ 머리·$PATH는 따로) */
function siemensMarks(code: string): number {
  let n = 0;
  for (const re of SIEMENS_MARKS) if (re.test(code)) n++;
  return n;
}

/**
 * Siemens Sinumerik 표지: %_N_…_MPF/SPF 머리·$PATH, MCALL, CYCLE8x(…)·HOLES·CYCLE800, T="이름", CR=, =AC(…)·=IC(…),
 * GOTOF/GOTOB, DEF REAL/INT, SUPA, TRANS/ATRANS/AROT/AMIRROR, G64x, G700/G710, R 변수 대입. 주석(; …·괄호 주석)은 떼고 본다
 */
export function looksSiemens(head: string): boolean {
  return siemensHeader(head) || siemensMarks(detectCode(head)) > 0;
}

/** Okuma OSP 표지: CALL O…, VC 변수 대입, G15 H, NLAP, RTS(부프로그램 끝) */
export function looksOkuma(head: string): boolean {
  const code = stripParenComments(head);
  return /\bCALL\s+O\w+/i.test(code) || /(?:^|\s)VC\d+\s*=/im.test(code) || /\bG15\s*H\d/i.test(code) || /\bNLAP\b/i.test(code) || /^\s*(?:N\d+\s+)?RTS\b/im.test(code) || /\bokuma\b/i.test(head);
}

/**
 * 글 앞부분으로 방언을 판별한다.
 * Siemens 표지가 하나뿐이면 Fanuc·LinuxCNC의 뚜렷한 표지(O 번호 줄, # 변수, M98·G65 P 부르기, o-코드 부프로그램)가 없을 때만
 * Siemens로 본다(표지가 둘 넘으면 Siemens). Haas는 주석의 HAAS나 Haas만 쓰는 코드로 본다
 */
export function detectGcodeDialect(head: string): NcDialect {
  if (/^\s*\d*\s*BEGIN\s+PGM\b/im.test(head) || /^\s*\d+\s+(?:L|CC|CR|CT|LP|CP|TOOL\s+CALL|CYCL\s+DEF|BLK\s+FORM)\b[^\n]*$/m.test(head))
    return 'heidenhain';
  // Heidenhain DIN/ISO: "%이름 G71 *" 머리, 블록 끝 * 과 G30/G31 공작물
  if (/^\s*%[^\s*;(]+\s+G7[01]\b/im.test(head) || /^\s*N\d+\s+G3[01]\b[^\n]*\*\s*$/im.test(head)) return 'heidenhain';
  if (siemensHeader(head)) return 'siemens';
  const code = detectCode(head);
  const linuxSub = /^\s*o(?:\d+|<[^>]+>)\s*(?:sub|call|if|while|do|repeat)\b/im.test(code) || /#<[_a-z]/i.test(code);
  const fanucStrong = /^\s*(?:N\d+\s*)?O\d{1,8}(?!\d)/im.test(code) || /#\d/.test(code) || /(?:^|[^A-Z0-9.#])(?:M\s*98|G\s*65)\s*P/im.test(code);
  const sm = siemensMarks(code);
  if (sm >= 2 || (sm === 1 && !linuxSub && !fanucStrong)) return 'siemens';
  if (linuxSub || /linuxcnc|\bemc2?\b/i.test(head)) return 'linuxcnc';
  if (/\bgrbl\b/i.test(head) || /^\s*\$[A-Z0-9$#]/m.test(head)) return 'grbl';
  if (/\bmach\s*[34]\b/i.test(head)) return 'mach3';
  // Haas: 주석의 "HAAS"(Fusion·Mastercam 포스트 머리), Haas만 쓰는 코드 G187·G103·G154·G110~G129·G150·M130.
  // 선반 프로그램의 G112·G113(극좌표 보간)은 빼고, M97(Haas 지역 부프로그램)은 다른 기계도 쓸 수 있어 표지로 보지 않는다(어느 방언이든 읽는다)
  if (/\(\s*[^)\n]*\bhaas\b/i.test(head)) return 'haas';
  {
    let lathe: boolean | undefined;
    const re = /(?:^|[^A-Z0-9.#])G\s*(187|103|154|1[12]\d|150)(?![\d.])/gim;
    for (let m = re.exec(code); m; m = re.exec(code)) if (!((m[1] === '112' || m[1] === '113') && (lathe ??= detectLathe(head)))) return 'haas';
    if (/(?:^|[^A-Z0-9.#])M\s*130(?!\d)/im.test(code)) return 'haas';
  }
  if (/^\s*[O:]\d{1,8}\b/m.test(code) || /\b(?:G65|WHILE\s*\[|IF\s*\[|GOTO\s*\d)/i.test(code) || /#[1-9]\d{2,3}\s*=/.test(code) || /\bfanuc\b/i.test(head))
    return 'fanuc';
  return 'iso';
}

/**
 * 선반(턴닝) 프로그램처럼 보이는지 점수로 판별한다(Y 낱말이 없고 T0101·G96·G71 P Q·U/W·G18 같은 표지).
 * 선택(lathe: 'auto')과 밀링으로 읽을 때의 안내 경고에 쓴다.
 */
export function detectLathe(head: string): boolean {
  const code = detectCode(head);
  let score = 0;
  if (/(?:^|[^A-Z])T\s*\d{4}(?!\d)/im.test(code)) score += 2;
  if (/(?:^|[^A-Z0-9.])G\s*0?9[67](?!\d)/im.test(code)) score += 2;
  if (/(?:^|[^A-Z0-9.])G\s*7[0-3](?![\d.])[^\n]*\bP\s*\d+[^\n]*\bQ\s*\d+/im.test(code)) score += 3;
  if (/(?:^|[^A-Z0-9.])G\s*0?7(?![\d.])/im.test(code)) score += 1;
  if (/(?:^|[^A-Z0-9.])G\s*18(?!\d)/im.test(code)) score += 1;
  if (/(?:^|[\s\d.])[UW]\s*[-+]?\d/im.test(code)) score += 1;
  if (/\b(?:lathe|turning|drehen|torno)\b/i.test(head)) score += 2;
  if (/(?:^|[\s\d.])Y\s*[-+]?\.?\d/im.test(code)) score -= 4;
  if (/(?:^|[^A-Z0-9.])G\s*17(?!\d)/im.test(code)) score -= 2;
  return score >= 4;
}

/** detectLatheSystem 결과: 체계와(정하지 못했을 때) B·C 체계일 수 있는 표지 코드 */
export interface LatheSystemGuess {
  system: 'A' | 'B' | 'C';
  /** A로 읽지만 B·C 체계일 수 있는 표지(G91, G77·G78·G79 사이클, G20·G21·G24 사이클, 낱말 없는 G70·G71) */
  hints: string[];
}

/**
 * Fanuc 선반 G 코드 체계(A·B·C — Fanuc 선반 설명서의 G 코드 표)를 글로 판별한다. 단순 사이클이 쓰인 꼴로만 정한다:
 * B = G79(끝면) 또는 P·Q 없는 G77·G78(바깥지름·나사)이 좌표와 함께, C = G20·G21·G24가 좌표와 함께(같은 블록에 G0~G3·G32·G33 없이).
 * A 체계 사이클 꼴(G90·G94·G92가 F·좌표와 함께, 다른 이동 G 없이)이 함께 있거나 B·C 꼴이 엇갈리면 정하지 않는다(A + hints)
 */
export function detectLatheSystem(head: string): LatheSystemGuess {
  const code = detectCode(head);
  const coord = /(?:^|[^A-Z])[XZUW]\s*[-+]?(?:\d|\.\d|#|\[)/i;
  const pq = /(?:^|[^A-Z])[PQ]\s*[-+]?(?:\d|\.\d|#|\[)/i;
  const feed = /(?:^|[^A-Z])F\s*[-+]?(?:\d|\.\d|#|\[)/i;
  let b79 = 0;
  let b78 = 0;
  let c = 0;
  let a = 0;
  let inc = 0;
  let cUnits = 0;
  for (const raw of code.split('\n')) {
    if (!/G/i.test(raw)) continue;
    const gs = new Set<number>();
    const re = /(?<![A-Z_#])G\s*(\d{1,3})(\.\d)?(?![\d.])/gi;
    for (let m = re.exec(raw); m; m = re.exec(raw)) if (!m[2]) gs.add(+m[1]!);
    if (!gs.size) continue;
    const xz = coord.test(raw);
    const motion = gs.has(0) || gs.has(1) || gs.has(2) || gs.has(3) || gs.has(32) || gs.has(33);
    if (gs.has(91)) inc++;
    if (gs.has(79) && xz) b79++;
    if ((gs.has(77) || gs.has(78)) && xz && !pq.test(raw)) b78++;
    if ((gs.has(20) || gs.has(21) || gs.has(24)) && xz && !motion) c++;
    if ((gs.has(90) || gs.has(94) || gs.has(92)) && xz && !motion && feed.test(raw)) a++;
    // 낱말 없는 G70·G71(C 체계의 inch·mm — A·B 체계의 G70·G71은 P·Q·U·R 낱말이 있는 사이클)
    if ((gs.has(70) || gs.has(71)) && !/[A-FH-MO-Z]/i.test(raw.replace(/^\s*N\d+/i, ''))) cUnits++;
  }
  if (a === 0) {
    if (c > 0 && b79 === 0) return { system: 'C', hints: [] };
    if (b79 + b78 > 0 && c === 0) return { system: 'B', hints: [] };
  }
  const hints: string[] = [];
  if (inc) hints.push('G91');
  if (b79 + b78) hints.push('G77·G78·G79');
  if (c) hints.push('G20·G21·G24');
  if (cUnits) hints.push('G70·G71');
  return { system: 'A', hints };
}

// ───────────────────────── 실행 ─────────────────────────

interface Frame {
  kind: 'main' | 'm98' | 'g65' | 'ocall' | 'm97';
  ret: number;
  start: number;
  reps: number;
  locals: Map<number, number> | null;
  named: Map<string, number> | null;
  label?: string;
  /** 줄 범위 실행(G70): 이 줄을 실행하면 돌아간다 */
  endLine?: number;
  /** 범위 실행이 끝나면 급속으로 돌아갈 점(G70 시작점)과 그 줄 */
  back?: [number, number, number];
  backLine?: number;
}

export { affine, applyAffine, composeAffine, diagAbout, invertAffine, rotAbout, ZERO3, type Affine } from './affine';

const MAX_CALL_DEPTH = 64;

/** Siemens: 앞쪽 줄에서 처음 나오는 G70/G700(inch)·G71/G710(mm) */
function prescanSiemensUnits(src: NcSource): boolean | undefined {
  const n = Math.min(src.lineCount, 5000);
  for (let i = 0; i < n; i++) {
    const t = sourceLine(src, i);
    const c = t.indexOf(';');
    const m = /(?:^|[^A-Z0-9_])G0*7(00|0|10|1)(?![0-9])/i.exec(c >= 0 ? t.slice(0, c) : t);
    if (m) return m[1] === '0' || m[1] === '00';
  }
  return undefined;
}

/** 공구를 적은 주석인지(지름 또는 공구 종류 낱말): 프로그램 이름 주석과 가른다 */
const TOOL_WORDS = /(?:END\s*MILL|ENDMILL|\bE\/?M\b|\bFLAT\b|\bBALL|\bBULL|DRILL|\bTAP\b|REAM|\bMILL\b|SPOT|CHAMF|CENTER|\bBOR(?:E|ING)\b|CUTTER|\bSLOT|INSERT|\bTOOL\b)/i;
function looksLikeTool(text: string): boolean {
  return TOOL_WORDS.test(text) || toolInfoFromComment(text, 'mm').diameter !== undefined;
}

/**
 * 함께 연 파일이 시작하는 줄: "(OPENCAD-JOB-FILE 이름)" 또는 "; OPENCAD-JOB-FILE 이름"(앱이 여러 파일을 한 작업으로 이을 때 넣는다).
 * 줄 번호 → 파일 이름, 없으면 null
 */
export function jobFileLines(src: NcSource): Map<number, string> | null {
  const b = src.bytes;
  const mark = JOB_FILE_MARK;
  let out: Map<number, string> | null = null;
  for (let i = 0; i < src.lineCount; i++) {
    const [s, e] = lineRange(src, i);
    let k = s;
    while (k < e && (b[k] === 32 || b[k] === 9)) k++;
    if (b[k] !== 40 && b[k] !== 59) continue;
    k++;
    while (k < e && b[k] === 32) k++;
    if (e - k < mark.length) continue;
    let ok = true;
    for (let j = 0; j < mark.length && ok; j++) ok = b[k + j] === mark.charCodeAt(j);
    if (!ok) continue;
    const name = decodeRange(src, k + mark.length, e).replace(/\)\s*$/, '').trim();
    (out ??= new Map()).set(i, name);
  }
  return out;
}

/** 앞쪽 줄에서 처음 나오는 G20/G21(Fanuc 선반 C 체계는 G70/G71)로 표시 단위를 정한다(true = inch) */
function prescanUnits(src: NcSource, systemC = false): boolean | undefined {
  const b = new Block();
  const n = Math.min(src.lineCount, 5000);
  const inch = systemC ? 700 : 200;
  const mm = systemC ? 710 : 210;
  for (let i = 0; i < n; i++) {
    b.reset();
    const [s, e] = lineRange(src, i);
    if (!parseFast(src.bytes, s, e, b, () => {})) continue;
    for (let k = 0; k < b.gCount; k++) {
      const g = b.g[k];
      if (g === inch) return true;
      if (g === mm) return false;
    }
  }
  return undefined;
}

export class Runner extends NcEmitter {
  protected blk = new Block();
  protected dialect: NcDialect;
  protected o: GcodeOptions;

  // 상태
  protected motion = 0; // ×10: 0, 10, 20, 30
  protected cycle = 0; // ×10: 0 = 없음, 810…
  protected cycleFresh = true;
  protected initLevel = 0;
  /** 고정 사이클 처음 높이가 추정 안전 높이인지 */
  protected initEst = false;
  protected cz: number | undefined;
  protected cr: number | undefined;
  protected cq = 0;
  protected cp = 0;
  /** Haas 쪼기: 첫 절입 I·줄이는 양 J·최소 절입 K(표시 단위) */
  protected cqI = 0;
  protected cqJ = 0;
  protected cqK = 0;
  /** 첫 절입에 더할 길이(Siemens CYCLE83은 첫 깊이를 기준면에서 잰다 — R 점까지의 안전 거리) */
  protected peckFirstExtra = 0;
  // ── 소수점 없는 좌표(최소 입력 단위) ──
  /** 0이 아닌 X·Y·Z 낱말 수와 그 가운데 소수점 없이 100 이상인 것 */
  protected axisWords = 0;
  protected intBig = 0;

  /** integerUnits면 소수점 없는 좌표 값을 최소 입력 단위로 바꾸고, 아니면 안내용으로 센다 */
  protected integerWords(blk: Block): void {
    const opt = this.o.integerUnits;
    for (const L of INT_LETTERS) {
      if (!blk.has[L]) continue;
      if (opt) {
        // 반복 횟수 K(Fanuc 계열 고정 사이클·M98)는 길이가 아니다
        if (L === LK && this.kIsCount(blk)) continue;
        if (!blk.dot[L]) {
          blk.val[L] = blk.val[L]! / (L <= 2 ? 1000 : this.blockInch ? 10000 : 1000);
          blk.dot[L] = 1;
        }
        continue;
      }
      if (L >= LX && L <= LZ) {
        const v = blk.val[L]!;
        if (v !== 0) {
          this.axisWords++;
          if (!blk.dot[L] && Math.abs(v) >= 100) this.intBig++;
        }
      }
    }
  }

  /**
   * 이 블록의 K가 반복 횟수인지: M98·M97 블록, 또는 Fanuc 계열(LinuxCNC·Haas가 아닌) 고정 사이클 블록(이 블록에서 켜거나 켜져 있는 사이클 —
   * G80·G0~G3이 같은 블록에 있으면 끈다). 선반 모드는 정면·측면 드릴 G81~G89만(G76 나사의 K는 높이)
   */
  protected kIsCount(blk: Block): boolean {
    if (blk.hasM(98) || blk.hasM(97)) return true;
    if (this.dialect === 'linuxcnc' || this.dialect === 'haas') return false;
    let cyc = this.cycle;
    for (let k = 0; k < blk.gCount; k++) {
      const g = blk.g[k]!;
      if (g === 0 || g === 10 || g === 20 || g === 30 || g === 800) cyc = 0;
      else if (g >= 810 && g <= 890) cyc = g;
      else if (g === 730 || g === 740 || g === 760) cyc = g;
    }
    return this.lathe ? cyc >= 810 && cyc <= 890 : cyc > 0;
  }

  // ── 극좌표(G16) ──
  protected polar = false;
  /** 극 원점(평면 두 축, 프로그램 좌표)·반지름·각(도) */
  protected polarO: [number, number] = [0, 0];
  protected polarR = 0;
  protected polarA = 0;

  /**
   * G16 블록: 반지름(평면 첫 축 낱말)을 G90으로 주면 극 원점 = 작업 원점, G91로 주면 지금 자리.
   * 각(둘째 축 낱말)은 G90이면 그 값, G91이면 앞 각에 더한다. 빠진 값은 앞 값. 결과를 절대 직교 좌표 낱말로 바꾼다
   */
  protected polarBlock(blk: Block): void {
    this.polarAgain = null;
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const L0 = AXIS_LETTER[a0]!;
    const L1 = AXIS_LETTER[a1]!;
    if (!blk.has[L0] && !blk.has[L1]) return;
    const hasR = !!blk.has[L0];
    const hasA = !!blk.has[L1];
    const rv = blk.val[L0]!;
    const av = blk.val[L1]!;
    const abs = this.absolute;
    const apply = (): void => {
      const q = this.progPos();
      if (hasR) {
        this.polarR = rv * this.axScale[a0]!;
        this.polarO = abs ? [0, 0] : [q[a0]!, q[a1]!];
      }
      if (hasA) this.polarA = abs ? av : this.polarA + av;
      const t = (this.polarA * Math.PI) / 180;
      blk.has[L0] = blk.has[L1] = 1;
      blk.val[L0] = (this.polarO[0] + this.polarR * Math.cos(t)) / this.axScale[a0]!;
      blk.val[L1] = (this.polarO[1] + this.polarR * Math.sin(t)) / this.axScale[a1]!;
      blk.dot[L0] = blk.dot[L1] = 1;
      blk.axAbs |= (1 << a0) | (1 << a1);
    };
    apply();
    // 고정 사이클 반복(K·L)은 같은 낱말을 다시 준 것처럼(G91 각이면 반복마다 더 돈다)
    this.polarAgain = apply;
  }
  /** 이 블록의 극좌표 바꾸기를 한 번 더(고정 사이클 반복용) */
  protected polarAgain: (() => void) | null = null;

  /** 낱말이 증분인지(블록의 축별 AC/IC 덮어쓰기 → G90/G91) */
  protected incAxis(blk: Block, a: number): boolean {
    return blk.axInc & (1 << a) ? true : blk.axAbs & (1 << a) ? false : !this.absolute;
  }

  /** 보링 시프트(G76·G87·Haas G77): 평면 두 축(프로그램 좌표)과 표시 좌표, Q로 정했는지 */
  protected cShift: [number, number] = [0, 0];
  protected cShiftD: [number, number] = [0, 0];
  protected cShiftQ = false;

  /** 보링 시프트 안내(한 번) */
  protected noteShift(line: number): void {
    if (this.cShiftQ) this.w.add('보링 사이클 시프트 Q는 평면 첫 축 + 방향으로 봄(기계 매개변수에 따라 다름)', line);
    else if (!this.cShift[0] && !this.cShift[1]) this.w.add('보링 사이클에 시프트 양(Q 또는 I·J)이 없음 — 시프트 없이 그림', line);
  }
  protected plane: NcPlane = 0;
  protected blockInch = false;
  protected scale = 1;
  protected absolute = true;
  protected arcAbs = false;
  protected retractR = false;
  protected selTool = -1;
  protected seenM6 = false;
  protected baseWcs = -1;
  protected wcsOff = new Map<number, [number, number, number]>();
  protected wcsKnown = new Set<number>();
  protected g92 = [0, 0, 0];
  protected g52 = [0, 0, 0];
  protected off = [0, 0, 0];
  protected stored28: [number, number, number] | null = null;
  protected stored30: [number, number, number] | null = null;
  protected peck: number;

  // 반경 보정
  protected dReg: number | undefined;
  protected dDirect: number | undefined;
  protected radiusGeo = new Map<number, number>();
  protected radiusWear = new Map<number, number>();
  /** LinuxCNC G10 L1·L10·L11 Q: 공구 번호 → 선반 공구 방향(0~9) */
  protected orientGeo = new Map<number, number>();
  /** LinuxCNC G41.1/G42.1 L: 선반 공구 방향(없으면 0) */
  protected lDirect = 0;

  // 좌표 변환(거울·배율·회전) — 없으면 null(빠른 길)
  protected mirrorXf: { c: number[]; s: number[] } | null = null;
  protected scaleXf: { c: number[]; f: number[] } | null = null;
  protected rotXf: { c: number[]; deg: number; plane: NcPlane } | null = null;
  protected wcsRot = new Map<number, number>();
  /** 가장 바깥 변환(Siemens 프레임) — 프로그램 좌표 → 작업 좌표 */
  protected progXf: Affine | null = null;
  /** G68.2·Haas G268 기울인 작업 평면(G68 회전 등 바깥) */
  protected tiltXf: Affine | null = null;
  protected xf: Affine | null = null;
  protected xfInv: Affine | null = null;
  protected pp = new Float64Array(3);
  protected ppT = new Float64Array(3);
  protected initLevelProg = 0;
  /** 축 낱말 값 → 표시 단위(단위 배율 × 선반 지름이면 X에 0.5) */
  protected axScale = new Float64Array([1, 1, 1]);
  protected tt = new Float64Array(3);

  // 선반
  protected lathe = false;
  /** Fanuc 계열 선반(A 체계): U·W 증분, G90/G92/G94 사이클, G98/G99 이송 단위, G50 좌표 설정 */
  protected fanucLathe = false;
  /** Fanuc 선반 G 코드 체계(B·C는 latheSysCode가 A 체계 뜻으로 바꾼다) */
  protected latheSys: 'A' | 'B' | 'C' = 'A';
  protected xMul = 1;
  protected css = false;
  protected cssV = 0;
  protected maxRpm = 0;
  protected lcmd = 0;
  protected rangeEnd = -1;
  protected boxX = NaN;
  protected boxZ = NaN;
  protected roughD = 0;
  protected roughE = 0;
  /** LinuxCNC G70~G72 블록의 D(보정 번호로 읽기 전에 떼어 둔 값, 없으면 NaN) */
  protected g7xD = NaN;
  protected g73: [number, number, number] = [0, 0, 1];
  protected peckE = 0;
  protected thread: { m: number; dmin: number; d: number } = { m: 1, dmin: 0, d: 0 };

  // 프로그램 흐름
  protected pc = 0;
  protected ended = false;
  protected started = false;
  protected stack: Frame[] = [];
  protected globals = new Map<number, number>();
  protected namedGlobals = new Map<string, number>();
  protected loops: { m: number; line: number }[] = [];
  protected oIndex: Map<number, number> | null = null;
  /** 함께 연 파일이 시작하는 줄(JOB_FILE_MARK 주석 줄) → 파일 이름. 없으면 null */
  protected jobLines: Map<number, string> | null = null;
  protected nIndex: Map<number, number[]> | null = null;
  protected oCodes: Map<string, { line: number; kw: string }[]> | null = null;
  protected ifTaken = new Map<string, boolean>();
  protected repeatLeft = new Map<string, number>();
  protected blocks = 0;
  protected maxBlocks: number;
  protected maxMoves: number;
  protected hitLimit = false;

  constructor(src: NcSource, opts: GcodeOptions, dialect: NcDialect, head: () => string) {
    super(src, opts.initialPosition);
    this.o = opts;
    this.dialect = dialect;
    // Okuma OSP: CALL O…·VC 변수·NLAP·RTS 등은 읽지 않으므로 띠와 경고로 알린다(G15 H는 작업 좌표계로 읽음)
    if ((dialect === 'fanuc' || dialect === 'iso') && src.lineCount > 0 && looksOkuma(head())) {
      this.notices.push({ kind: 'dialect', dialect: 'okuma' });
      this.w.add('Okuma OSP 프로그램으로 보임 — CALL·VC 변수·NLAP·RTS는 읽지 않아 경로가 모자랄 수 있음');
    }
    const latheAuto = opts.lathe === 'auto' && detectLathe(head());
    if (latheAuto) this.notices.push({ kind: 'lathe-auto' });
    if (opts.lathe === true || latheAuto) {
      this.lathe = true;
      this.latheMode = true;
      this.fanucLathe = dialect !== 'linuxcnc' && dialect !== 'grbl';
      this.plane = 1;
      this.xMul = (opts.latheDiameter ?? this.fanucLathe) ? 0.5 : 1;
      // Fanuc 선반은 켜질 때 회전당 이송(G99)이 흔하다
      if (this.fanucLathe) this.feedMode = 95;
      // 선반의 기계 원점은 +X·+Z 쪽(공구대가 멀리 물러난다)
      this.machSafeAxes = 5;
      // Fanuc 선반 G 코드 체계: 고르지 않았으면 단순 사이클 꼴로 판별(정할 수 없으면 A — B·C 표지가 있으면 띠·경고)
      if (this.fanucLathe) {
        const want = opts.latheSystem && opts.latheSystem !== 'auto' ? opts.latheSystem : null;
        if (want) this.latheSys = want;
        else if (src.lineCount > 0) {
          const guess = detectLatheSystem(head());
          this.latheSys = guess.system;
          if (guess.system !== 'A') this.notices.push({ kind: 'lathe-system', system: guess.system });
          else if (guess.hints.length) {
            this.notices.push({ kind: 'lathe-system', system: 'A', hints: guess.hints });
            this.w.add(`Fanuc 선반 G 코드 B·C 체계일 수 있음(${guess.hints.join(' · ')}) — A 체계로 읽음`);
          }
        }
      }
    } else if (opts.lathe === undefined && src.lineCount > 0 && detectLathe(head()))
      this.w.add('선반 프로그램으로 보임 — 선반 모드로 읽으면 X를 지름으로 보고 선반 사이클을 그림');
    if (opts.rotary) this.setRotary(opts.rotary === true ? {} : opts.rotary);
    // C 체계 선반은 G70/G71이 inch/mm(G20/G21은 단순 사이클)
    const unitsC = dialect === 'siemens' || this.latheSys === 'C';
    const pre = dialect === 'siemens' ? prescanSiemensUnits(src) : prescanUnits(src, this.latheSys === 'C');
    this.displayInch = pre ?? opts.units === 'inch';
    if (pre === undefined && src.lineCount > 0)
      this.w.add(unitsC ? `단위 코드(G70/G71)가 없어 ${this.displayInch ? 'inch' : 'mm'}로 봄` : `단위 코드(G20/G21)가 없어 ${this.displayInch ? 'inch' : 'mm'}로 봄`);
    this.blockInch = this.displayInch;
    this.updateScale();
    this.tol = this.displayInch ? 0.0001 : 0.002;
    this.rapidFeed = this.displayInch ? 400 : 10000;
    if (opts.machine) {
      const mc = this.applyMachine(opts.machine);
      this.o = { ...opts, machineOffset: opts.machineOffset ?? mc.offset, referencePoint: opts.referencePoint ?? mc.reference };
    }
    if (opts.rapidFeed) this.rapidFeed = opts.rapidFeed;
    // 안전 확인: 공구 길이 보정(G43)은 밀링 Fanuc 계열에서, 주축은 GRBL(레이저 M3 S0)이 아니면
    this.checkNumbers = opts.checkToolNumbers !== false;
    this.checkTlc = !this.lathe && dialect !== 'grbl' && dialect !== 'siemens';
    this.checkSpindle = dialect !== 'grbl';
    this.peck = opts.peckClearance ?? (this.displayInch ? 0.02 : 0.5);
    this.arcAbs = !!opts.arcCenterAbsolute;
    this.maxMoves = opts.maxMoves ?? 8_000_000;
    this.maxBlocks = opts.maxBlocks ?? Math.max(src.lineCount * 20, 5_000_000);
    if (opts.workOffsets)
      for (const [k, v] of Object.entries(opts.workOffsets)) {
        const idx = wcsIndexFromName(k);
        if (idx >= 0) {
          this.wcsOff.set(idx, [v[0], v[1], v[2]]);
          this.wcsKnown.add(idx);
        }
      }
    this.jobLines = jobFileLines(src);
    this.stack.push({ kind: 'main', ret: -1, start: 0, reps: 1, locals: new Map(), named: new Map() });
  }

  /** 함께 연 파일 경계에 닿음: 주 프로그램이면 끝(true), 부프로그램이 M99 없이 파일 끝에 닿았으면 M99처럼 돌아간다 */
  protected jobFileEnd(): boolean {
    const f = this.stack[this.stack.length - 1]!;
    if (f.kind === 'main') {
      this.ended = true;
      return true;
    }
    if (f.reps > 1) {
      f.reps--;
      this.pc = f.start;
      return false;
    }
    this.stack.pop();
    this.pc = f.ret;
    return false;
  }

  run(): void {
    const src = this.src;
    const blk = this.blk;
    const bytes = src.bytes;
    const cm: number[] = [];
    const onComment = (cs: number, ce: number): void => {
      cm.push(cs, ce);
    };
    while (!this.ended) {
      // 글 끝: 여러 파일 작업이면 마지막 파일의 부프로그램이 M99 없이 끝에 닿은 것이니 돌아간다
      if (this.pc >= src.lineCount) {
        if (!this.jobLines || this.jobFileEnd()) break;
        continue;
      }
      const line = this.pc++;
      if (++this.blocks > this.maxBlocks) {
        this.w.add(`실행 블록이 ${this.maxBlocks}개를 넘어 멈춤(끝없는 반복일 수 있음)`, line);
        this.hitLimit = true;
        break;
      }
      // 함께 연 다음 파일: 주 프로그램은 여기서 끝, 부프로그램이 M99 없이 파일 끝에 닿으면 돌아간다
      if (this.jobLines?.has(line)) {
        if (this.jobFileEnd()) break;
        continue;
      }
      blk.reset();
      cm.length = 0;
      const [s, e] = lineRange(src, line);
      if (s === e) continue;
      let ok = parseFast(bytes, s, e, blk, onComment);
      if (ok) for (let k = 0; k < cm.length; k += 2) blk.comments.push(decodeRange(src, cm[k]!, cm[k + 1]!));
      if (!ok) {
        blk.reset();
        try {
          parseSlow(decodeRange(src, s, e), blk, this);
          ok = true;
        } catch (err) {
          if (!(err instanceof ExprError)) throw err;
          this.w.add(`읽을 수 없는 블록 — ${err.message}`, line);
          continue;
        }
      }
      if (blk.blockDelete && this.o.blockDelete) {
        if (line === this.rangeEnd) this.endRange();
        continue;
      }
      this.exec(blk, line);
      if (line === this.rangeEnd) this.endRange();
      if (this.mb.count >= this.maxMoves) {
        this.w.add(`이동이 ${this.maxMoves}개를 넘어 나머지는 읽지 않음`, line);
        this.hitLimit = true;
        break;
      }
    }
  }

  /** 식의 FIX·FUP를 Fanuc 매크로 B처럼(소수 버림·올림 — 음수도 절댓값 기준). LinuxCNC 등은 floor·ceil */
  get fanucRounding(): boolean {
    return this.dialect === 'fanuc' || this.dialect === 'iso' || this.dialect === 'haas';
  }

  // ── 변수 ──
  /**
   * 변수 값. LinuxCNC에서 이 범위(주 프로그램·o-코드 부프로그램마다 따로)에 없는 지역 이름 변수(#<이름>)를 읽으면 LinuxCNC는
   * "Named parameter not defined" 오류로 멈추므로 경고한다(여기서는 빈 값 — 낱말을 빼거나 식에서 0). 전역(#<_이름>)은
   * LinuxCNC가 미리 정한 것(#<_x> 등)이 많아 보지 않는다
   */
  get(ref: GVarRef): number | undefined {
    const v = this.lookup(ref);
    if (v === undefined && typeof ref === 'string' && this.dialect === 'linuxcnc' && !ref.startsWith('_'))
      this.w.add(`지역 이름 변수 #<${ref}>가 이 범위에서 정해지지 않음 — LinuxCNC는 오류(빈 값으로 읽음)`, this.pc - 1);
    return v;
  }
  /** 변수가 있는지(EXISTS — 경고 없이) */
  has(ref: GVarRef): boolean {
    return this.lookup(ref) !== undefined;
  }
  protected lookup(ref: GVarRef): number | undefined {
    const f = this.stack[this.stack.length - 1]!;
    if (typeof ref === 'string') {
      if (ref.startsWith('_')) return this.namedGlobals.get(ref);
      return f.named?.get(ref) ?? this.namedGlobals.get(ref);
    }
    if (ref === 0) return undefined;
    if (ref >= 1 && ref <= 33) return f.locals?.get(ref);
    if (ref >= 5001 && ref <= 5003) return this.progCoord(ref - 5001);
    if (ref >= 5021 && ref <= 5023) return this.pos[ref - 5021];
    if (ref >= 5041 && ref <= 5043) return this.progCoord(ref - 5041);
    if (ref === 4001) return this.cycle ? this.cycle / 10 : this.motion / 10;
    if (ref === 4003) return this.absolute ? 90 : 91;
    if (ref === 4006) return this.blockInch ? 20 : 21;
    if (ref === 4120) return this.tool;
    if (ref === 5400 || ref === 4014) return 54 + this.wcs;
    return this.globals.get(ref);
  }
  protected setVar(ref: GVarRef, v: number | undefined): void {
    const f = this.stack[this.stack.length - 1]!;
    if (typeof ref === 'string') {
      const m = ref.startsWith('_') ? this.namedGlobals : (f.named ??= new Map());
      if (v === undefined) m.delete(ref);
      else m.set(ref, v);
      return;
    }
    if (ref <= 0) return;
    const m = ref <= 33 ? (f.locals ??= new Map()) : this.globals;
    if (v === undefined) m.delete(ref);
    else m.set(ref, v);
  }

  protected progCoord(a: number): number {
    if (this.xfInv) return this.progPos()[a]! / this.scale;
    return (this.pos[a]! - this.off[a]!) / this.scale;
  }

  // ── 좌표 ──
  protected updateScale(): void {
    this.scale = this.blockInch === this.displayInch ? 1 : this.blockInch ? 25.4 : 1 / 25.4;
    this.axScale[0] = this.scale * this.xMul;
    this.axScale[1] = this.scale;
    this.axScale[2] = this.scale;
  }
  protected updateOff(): void {
    const w = this.wcsOff.get(this.wcs) ?? [0, 0, 0];
    const b = this.wcsOff.get(this.baseWcs < 0 ? this.wcs : this.baseWcs) ?? [0, 0, 0];
    for (let a = 0; a < 3; a++) this.off[a] = w[a]! - b[a]! + this.g92[a]! + this.g52[a]!;
  }

  /** 낱말 값을 표시 좌표로(절대·증분, G53) */
  protected target(blk: Block, a: number, machine: boolean, inc = !this.absolute): number {
    const L = AXIS_LETTER[a]!;
    if (!blk.has[L]) return this.pos[a]!;
    const v = blk.val[L]! * this.axScale[a]!;
    if (blk.axInc & (1 << a)) inc = true;
    else if (blk.axAbs & (1 << a)) inc = false;
    if (machine) {
      const b = this.machineBase();
      return v - (b ? b[a]! : 0);
    }
    return inc ? this.pos[a]! + v : v + this.off[a]!;
  }

  /** 첫 작업 좌표계 원점의 기계 좌표(모르면 null) */
  protected machineBase(): readonly number[] | null {
    return this.o.machineOffset ?? this.wcsOff.get(this.baseWcs < 0 ? this.wcs : this.baseWcs) ?? null;
  }

  /** G28·G30 기준점(표시 좌표, 모르면 null) */
  protected homeFor(g: number): readonly number[] | null {
    const stored = g === 280 ? this.stored28 : this.stored30;
    if (stored) return stored;
    if (this.o.homePosition) return this.o.homePosition;
    const mo = this.o.machineOffset;
    if (mo) {
      const r = this.o.referencePoint ?? [0, 0, 0];
      return [r[0] - mo[0], r[1] - mo[1], r[2] - mo[2]];
    }
    return null;
  }

  /**
   * 기계 위치를 모르는 기계 좌표 쪽 이동(G53·G28·G30 기준점): 공구 축(선반은 X·Z)을 안전 높이로, 나머지 축은 제자리에 두고 경고
   * mask = 주어진 축 비트. what = 경고에 쓰는 코드 이름
   */
  protected machineEstimate(mask: number, line: number, what: string, kind = MOVE_RAPID): void {
    this.w.add(`${what} 기계 좌표 쪽 이동 — 작업 원점의 기계 위치를 몰라 공구 축을 안전 높이(경로 맨 위 + 여유)로 그림`, line);
    const rest = this.machineRetract(mask, line, kind);
    if (rest) this.w.add(`${what} X·Y 기계 위치를 몰라 그 축은 제자리에 둠`, line);
  }

  /** 블록의 끝점(표시 좌표) — 좌표 변환·선반 U/W를 함께 본다. 돌려주는 배열은 다음 부름에서 다시 쓴다 */
  protected targets(blk: Block, machine: boolean): Float64Array {
    const t = this.tt;
    if (this.xf !== null && !machine) {
      this.targetXf(blk, t);
      return t;
    }
    t[0] = this.target(blk, 0, machine);
    t[1] = this.target(blk, 1, machine);
    t[2] = this.target(blk, 2, machine);
    if (this.fanucLathe) {
      if (blk.has[LU] && !blk.has[LX]) t[0] = this.pos[0]! + blk.val[LU]! * this.axScale[0]!;
      if (blk.has[LW] && !blk.has[LZ]) t[2] = this.pos[2]! + blk.val[LW]! * this.axScale[2]!;
    }
    return t;
  }

  /** 지금 위치의 프로그램 좌표(변환 전, 표시 단위). 돌려주는 배열은 다음 부름에서 다시 쓴다 */
  protected progPos(): Float64Array {
    const q = this.pp;
    q[0] = this.pos[0]! - this.off[0]!;
    q[1] = this.pos[1]! - this.off[1]!;
    q[2] = this.pos[2]! - this.off[2]!;
    if (this.xfInv) applyAffine(this.xfInv, q, q);
    return q;
  }

  /** 프로그램 좌표 → 표시 좌표(변환 + 오프셋) */
  protected toDisplay(p: ArrayLike<number>, out: number[] | Float64Array): void {
    if (this.xf) applyAffine(this.xf, p, out);
    else {
      out[0] = p[0]!;
      out[1] = p[1]!;
      out[2] = p[2]!;
    }
    out[0] += this.off[0]!;
    out[1] += this.off[1]!;
    out[2] += this.off[2]!;
  }

  /** 변환이 켜진 동안의 끝점: 프로그램 좌표에서 정하고(this.ppT) 변환한다 */
  protected targetXf(blk: Block, out: Float64Array): void {
    const q = this.progPos();
    for (let a = 0; a < 3; a++) {
      const L = AXIS_LETTER[a]!;
      if (!blk.has[L]) continue;
      const v = blk.val[L]! * this.axScale[a]!;
      const inc = blk.axInc & (1 << a) ? true : blk.axAbs & (1 << a) ? false : !this.absolute;
      q[a] = inc ? q[a]! + v : v;
    }
    if (this.fanucLathe) {
      if (blk.has[LU] && !blk.has[LX]) q[0] = q[0]! + blk.val[LU]! * this.axScale[0]!;
      if (blk.has[LW] && !blk.has[LZ]) q[2] = q[2]! + blk.val[LW]! * this.axScale[2]!;
    }
    this.ppT.set(q);
    this.toDisplay(q, out);
  }

  /** 거울·배율·회전을 하나의 변환으로 */
  protected rebuildXf(): void {
    let m: Affine | null = null;
    const put = (n: Affine): void => {
      m = m ? composeAffine(n, m) : n;
    };
    if (this.mirrorXf) put(diagAbout(this.mirrorXf.c, this.mirrorXf.s));
    if (this.scaleXf) put(diagAbout(this.scaleXf.c, this.scaleXf.f));
    if (this.rotXf) put(rotAbout(this.rotXf.c, this.rotXf.deg, this.rotXf.plane));
    const wr = this.wcsRot.get(this.wcs);
    if (wr) put(rotAbout(ZERO3, wr, 0));
    // 가장 바깥: Siemens 프로그램 프레임(TRANS·ROT·SCALE·MIRROR)·G68.2 기울인 평면
    if (this.tiltXf) put(this.tiltXf);
    if (this.progXf) put(this.progXf);
    this.xf = m;
    this.xfInv = m ? invertAffine(m) : null;
    if (m && !this.xfInv) {
      this.w.add('배율이 0인 좌표 변환 — 변환을 끔');
      this.xf = null;
    }
  }

  /** 변환이 평면 plane을 그대로 두는지(원호를 원호로 옮길 수 있는지), 평면 안 방향 부호(거울이면 -1), 평면 안 배율이 고른지 */
  /** 이동마다 남기는 모달 상태: 평면·G91·G16·좌표 변환·고정 사이클 번호 */
  protected override modalState(): number {
    return this.plane | (this.absolute ? 0 : MODAL_INC) | (this.polar ? MODAL_POLAR : 0) | (this.xf ? MODAL_XF : 0) | (Math.round(this.cycle / 10) << 8);
  }

  protected xfPlane(plane: number): { keeps: boolean; sign: number; uniform: boolean } {
    return affinePlane(this.xf, plane);
  }

  /** G51(배율) — Fanuc: X·Y·Z 중심(없으면 지금 위치), P 모든 축 또는 I·J·K 축별. Mach3: X·Y·Z가 축별 배율 */
  protected g51(blk: Block, line: number): void {
    const cur = Array.from(this.progPos());
    let c = [0, 1, 2].map((a) => (blk.has[AXIS_LETTER[a]!] ? blk.val[AXIS_LETTER[a]!]! * this.axScale[a]! : cur[a]!));
    const factor = (L: number): number => {
      const v = blk.val[L]!;
      // 소수점 없는 큰 정수는 0.001 단위(Fanuc 기본 설정)로 본다
      return blk.dot[L] || Math.abs(v) < 100 ? v : v / 1000;
    };
    let f = [1, 1, 1];
    if (this.dialect === 'mach3') {
      f = [0, 1, 2].map((a) => (blk.has[AXIS_LETTER[a]!] ? blk.val[AXIS_LETTER[a]!]! : 1));
      c = [0, 0, 0];
    } else if (blk.has[LP]) {
      const p = factor(LP);
      f = [p, p, p];
    } else if (blk.has[LI] || blk.has[LJ] || blk.has[LK]) f = [LI, LJ, LK].map((L) => (blk.has[L] ? factor(L) : 1));
    else this.w.add('G51에 배율(P 또는 I·J·K)이 없어 1로 봄', line);
    if (f.some((v) => !Number.isFinite(v) || v === 0)) {
      this.w.add('G51 배율이 0 — 무시함', line);
      return;
    }
    this.scaleXf = f.every((v) => v === 1) ? null : { c, f };
    this.rebuildXf();
  }

  /** G51.1(거울): 주어진 축을 그 값의 축선에 대해 뒤집는다 */
  protected g511(blk: Block): void {
    const m = this.mirrorXf ?? { c: [0, 0, 0], s: [1, 1, 1] };
    for (let a = 0; a < 3; a++) {
      const L = AXIS_LETTER[a]!;
      if (!blk.has[L]) continue;
      m.s[a] = -1;
      m.c[a] = blk.val[L]! * this.axScale[a]!;
    }
    this.mirrorXf = m.s.every((v) => v === 1) ? null : m;
    this.rebuildXf();
  }

  /** G50.1: 주어진 축(없으면 모두)의 거울을 끈다 */
  protected g501(blk: Block): void {
    const m = this.mirrorXf;
    if (!m) return;
    const any = blk.has[LX] || blk.has[LY] || blk.has[LZ];
    for (let a = 0; a < 3; a++) if (!any || blk.has[AXIS_LETTER[a]!]) m.s[a] = 1;
    this.mirrorXf = m.s.every((v) => v === 1) ? null : m;
    this.rebuildXf();
  }

  /** G68(좌표 회전): 지금 평면에서 중심(평면 두 축 낱말, Mach3는 A·B도) 둘레로 R도. G91이면 R은 앞 각에 더한다 */
  protected g68(blk: Block, line: number): void {
    const plane = this.plane;
    const [a0, a1] = PLANE_AXES[plane]!;
    const cur = Array.from(this.progPos());
    const c = [cur[0]!, cur[1]!, cur[2]!];
    for (const [a, L, alt] of [
      [a0, AXIS_LETTER[a0]!, LA],
      [a1, AXIS_LETTER[a1]!, LB],
    ] as const) {
      if (blk.has[L]) c[a] = blk.val[L]! * this.axScale[a]!;
      else if (this.dialect === 'mach3' && blk.has[alt]) c[a] = blk.val[alt]! * this.axScale[a]!;
    }
    let deg = 0;
    if (blk.has[LR]) deg = blk.val[LR]!;
    else this.w.add('G68에 각도 R이 없어 0도로 봄', line);
    if (!this.absolute && this.rotXf && this.rotXf.plane === plane) deg += this.rotXf.deg;
    this.rotXf = deg === 0 ? null : { c, deg, plane };
    this.rebuildXf();
  }

  /**
   * G68.2(Fanuc)·G268(Haas) 기울인 작업 평면: X·Y·Z = 피처 좌표계 원점(지금 프로그램 좌표), I·J·K = 오일러 각(도).
   * P0(기본)·Haas Q313 = Z-X-Z, Fanuc P1·Haas Q123 = X-Y-Z(고정 축 롤·피치·요). 그 밖은 경고하고 변환 없이.
   * 이후 블록의 좌표(원호·고정 사이클 포함)는 이 평면에서 읽는다. G69로 끈다
   */
  protected g682(blk: Block, line: number): void {
    const o = [0, 1, 2].map((a) => (blk.has[AXIS_LETTER[a]!] ? blk.val[AXIS_LETTER[a]!]! * this.axScale[a]! : 0));
    const ang = [LI, LJ, LK].map((L) => (blk.has[L] ? blk.val[L]! : 0));
    const haas = this.dialect === 'haas';
    const p = blk.has[LP] ? Math.round(blk.val[LP]!) : 0;
    const q = blk.has[LQ] ? Math.round(blk.val[LQ]!) : haas ? 313 : 0;
    let r: Affine;
    if ((!haas && p === 0) || (haas && q === 313)) r = composeAffine(composeAffine(rotAxis(2, ang[0]!), rotAxis(0, ang[1]!)), rotAxis(2, ang[2]!));
    else if ((!haas && p === 1) || (haas && q === 123)) r = composeAffine(composeAffine(rotAxis(2, ang[2]!), rotAxis(1, ang[1]!)), rotAxis(0, ang[0]!));
    else {
      this.w.add(`G68.2 꼴(P${p}${haas ? ` Q${q}` : ''})은 지원하지 않음 — 변환 없이 그림`, line);
      return;
    }
    this.tiltXf = composeAffine(translateAffine(o), r);
    this.rebuildXf();
  }

  /** P 낱말을 초로(Fanuc·ISO: 소수점 없는 P는 ms) */
  protected dwellSeconds(blk: Block, letter: number): number {
    const v = blk.val[letter]!;
    if (letter === LX) return v;
    if ((this.dialect === 'fanuc' || this.dialect === 'iso' || this.dialect === 'haas') && !blk.dot[letter]) return v / 1000;
    return v;
  }

  // ── 블록 실행 ──
  protected exec(blk: Block, line: number): void {
    if (blk.percent) {
      // 부프로그램 안의 % (함께 연 부프로그램 파일의 머리·꼬리)는 프로그램 끝이 아니다
      if (this.started && this.stack[this.stack.length - 1]!.kind === 'main') this.ended = true;
      return;
    }
    if (blk.comments.length) this.onComments(blk, line);
    if (blk.ctrl) {
      for (const [r, v] of blk.assigns) this.setVar(r, v);
      this.control(blk.ctrl, line);
      return;
    }
    if (blk.words === 0) {
      for (const [r, v] of blk.assigns) this.setVar(r, v);
      return;
    }
    // 프로그램 번호만 있는 줄
    if (blk.has[LO] && blk.words === 1) {
      if (!this.started && !this.name) this.name = `O${Math.round(blk.val[LO]!)}`;
      return;
    }
    this.started = true;
    this.integerWords(blk);
    if (blk.hasG(650)) {
      // G65 블록의 낱말은 모두 인수(이송·공구로 보지 않는다)
      this.endBlock(blk, line, true);
      return this.macroCall(blk, line);
    }

    let motionG = -1;
    let cycleG = -1;
    let nonModal = -1;
    let machine = false;
    const compBefore = this.comp;
    let compDirect = false;
    /** 그리지 않는(모르거나 매개변수만 받는) G — 이 블록의 좌표 낱말은 이동이 아니다 */
    let unknownG = -1;
    /** 한 블록만 급속 위치 결정(G60 한 방향 위치 결정·G27·G29) */
    let oneShot = false;
    /** Haas·Mach3 원형 포켓 G12(시계)·G13(반시계) */
    let pocket = -1;
    /** LinuxCNC G33.1 강성 탭(들어갔다 나온다) */
    let tapOneShot = false;
    /** 이 블록에 G43·G44·G43.4/5(공구 길이 보정)가 있음 */
    let tlcOn = false;
    /** Haas 볼트 구멍 패턴(G70·G71·G72) */
    let boltG = -1;
    for (let k = 0; k < blk.gCount; k++) {
      let g = blk.g[k]!;
      if (this.lathe) {
        // Fanuc 선반 B·C 체계: A 체계와 뜻이 다른 코드는 여기서 처리하거나(-1) A 체계 코드로 바꾼다
        if (this.latheSys !== 'A') {
          g = this.latheSysCode(g);
          if (g < 0) continue;
        }
        const lr = this.latheCode(g, blk, line);
        if (lr >= 0) {
          if (lr > 0) motionG = lr;
          continue;
        }
      }
      switch (g) {
        case 0:
        case 10:
        case 20:
        case 30:
          motionG = g;
          break;
        case 50:
        case 51:
          // 좌표가 있으면 LinuxCNC 스플라인(G5 3차 — I·J·P·Q, G5.1 2차 — I·J, 모달 이동 꼴), 없으면 Fanuc 고속·AI 모드 켜기(무시)
          if (blk.has[LX] || blk.has[LY] || blk.has[LZ]) motionG = g;
          break;
        case 52:
        case 53:
          // LinuxCNC G5.2 NURBS 조정점 블록(X·Y·P 가중치·L 계수) … G5.3 끝 — 이동 꼴(모달). 조정점을 모아 G5.3에서 곡선으로 그린다
          motionG = g;
          break;
        case 382:
        case 383:
        case 384:
        case 385:
        case 310:
          this.w.add('프로브(G38·G31) 이동은 끝점까지 직선으로 그림', line);
          motionG = 10;
          break;
        case 770:
          // Haas G77 뒤 보링(밀링). 그 밖에서는 모르는 G
          if (this.dialect === 'haas' && !this.lathe) cycleG = g;
          else {
            this.w.add('지원하지 않는 G77', line);
            if (unknownG < 0) unknownG = g;
          }
          break;
        case 730:
        case 740:
        case 760:
        case 800:
        case 810:
        case 820:
        case 830:
        case 840:
        case 842:
        case 843:
        case 850:
        case 860:
        case 870:
        case 880:
        case 890:
          cycleG = g;
          break;
        case 40:
        case 100:
        case 280:
        case 281:
        case 300:
        case 301:
        case 520:
        case 920:
        case 921:
        case 922:
        case 923:
        case 110:
        case 510:
        case 511:
        case 680:
          nonModal = g;
          break;
        case 501:
          // G50.1 X… : 그 축의 거울만 끈다(축 낱말은 이동이 아니다)
          if (blk.has[LX] || blk.has[LY] || blk.has[LZ]) nonModal = g;
          else if (this.mirrorXf) {
            this.mirrorXf = null;
            this.rebuildXf();
          }
          break;
        case 500:
          if (this.scaleXf) {
            this.scaleXf = null;
            this.rebuildXf();
          }
          break;
        case 690:
          // G69: 좌표 회전과 기울인 평면(G68.2·Haas G268 대신 G269)을 끈다
          if (this.rotXf || this.tiltXf) {
            this.rotXf = null;
            this.tiltXf = null;
            this.rebuildXf();
          }
          break;
        case 2690:
          if (this.dialect === 'haas' && this.tiltXf) {
            this.tiltXf = null;
            this.rebuildXf();
          }
          break;
        case 531:
        case 532:
          // G53.1·G53.6 공구 축을 기울인 평면에 맞춤 — 공구 끝 경로는 그대로
          break;
        case 530:
          machine = true;
          break;
        case 170:
          this.plane = 0;
          break;
        case 180:
          this.plane = 1;
          break;
        case 190:
          this.plane = 2;
          break;
        case 200:
          this.blockInch = true;
          this.updateScale();
          break;
        case 210:
          this.blockInch = false;
          this.updateScale();
          break;
        case 400:
          this.comp = 0;
          break;
        case 410:
        case 411:
          this.comp = 1;
          compDirect = g === 411;
          break;
        case 420:
        case 421:
          this.comp = 2;
          compDirect = g === 421;
          break;
        case 430:
        case 431:
        case 440:
        case 434:
        case 435:
          this.tlc = true;
          tlcOn = true;
          if (g === 434 || g === 435) {
            if (this.rotAxis) {
              this.rotOff = true;
              this.w.add(`G${g / 10} 공구 끝점 제어: 프로그램 좌표를 공구 끝 경로로 그대로 그림(공구 방향은 그리지 않음)`, line);
            } else if (g === 434) this.w.add('G43.4 공구 끝점 제어는 위치만 그림(회전축 무시)', line);
          }
          break;
        case 1430:
        case 2340:
          // Haas G143(5축 공구 길이 보정)·G234(공구 중심점 제어 TCPC): G43·G43.4처럼 공구 길이 보정을 켜고, 블록의 좌표는 이동
          if (this.dialect !== 'haas') {
            this.w.add(`지원하지 않는 G${g / 10}`, line);
            if (unknownG < 0) unknownG = g;
            break;
          }
          this.tlc = true;
          tlcOn = true;
          if (g === 2340 && this.rotAxis) {
            this.rotOff = true;
            this.w.add(`G${g / 10} 공구 끝점 제어: 프로그램 좌표를 공구 끝 경로로 그대로 그림(공구 방향은 그리지 않음)`, line);
          }
          break;
        case 490:
          this.tlc = false;
          this.rotOff = false;
          this.hNum = -1;
          break;
        case 540:
        case 550:
        case 560:
        case 570:
        case 580:
        case 590:
          this.selectWcs((g - 540) / 10, line);
          break;
        case 541: {
          const p = blk.has[LP] ? Math.round(blk.val[LP]!) : 1;
          blk.has[LP] = 0;
          this.selectWcs(5 + p, line);
          break;
        }
        case 591:
        case 592:
        case 593:
          this.selectWcs(6 + (g - 591), line);
          break;
        case 1540: {
          // Haas G154 P1~P99 = 추가 작업 좌표계(G54.1 P와 같은 번호)
          const p = blk.has[LP] ? Math.round(blk.val[LP]!) : 1;
          blk.has[LP] = 0;
          this.selectWcs(5 + p, line);
          break;
        }
        case 150:
          // G15 극좌표 끝. Okuma G15 Hn은 작업 좌표계 n 고르기
          if (blk.has[7]) {
            this.selectWcs(Math.max(0, Math.round(blk.val[7]!) - 1), line);
            blk.has[7] = 0;
          } else this.polar = false;
          break;
        case 700:
        case 710:
        case 720:
          // Haas 밀링 볼트 구멍 패턴 G70(원)·G71(호)·G72(직선) — 선반 모드의 G70~G72는 latheCode가 먼저 받는다
          if (this.dialect === 'haas') boltG = g;
          else {
            this.w.add(`지원하지 않는 G${g / 10}`, line);
            if (unknownG < 0) unknownG = g;
          }
          break;
        case 610:
        case 611:
        case 640:
        case 960:
        case 970:
        case 1030:
        case 1870:
        case 940:
          if (g === 940) this.feedMode = 94;
          break;
        case 930:
          this.feedMode = 93;
          break;
        case 950:
          this.feedMode = 95;
          break;
        case 900:
          this.absolute = true;
          break;
        case 910:
          this.absolute = false;
          break;
        case 901:
          this.arcAbs = true;
          break;
        case 911:
          this.arcAbs = false;
          break;
        case 980:
          this.retractR = false;
          break;
        case 990:
          this.retractR = true;
          break;
        case 160:
          // G16 극좌표: 평면 첫 축 = 반지름, 둘째 축 = 각(도). 처음 반지름·각은 지금 자리(원점 기준)
          if (!this.polar) {
            const q = this.progPos();
            const [u0, u1] = PLANE_AXES[this.plane]!;
            this.polar = true;
            this.polarO = [0, 0];
            this.polarR = Math.hypot(q[u0]!, q[u1]!);
            this.polarA = (Math.atan2(q[u1]!, q[u0]!) * 180) / Math.PI;
          }
          break;
        case 682:
          // G68.2 기울인 작업 평면: 이 블록의 X·Y·Z·I·J·K는 원점과 각(이동이 아니다)
          nonModal = 682;
          break;
        case 2680:
          // Haas G268(기울인 평면 — G68.2와 같은 꼴, Q는 오일러 차례)
          if (this.dialect === 'haas') nonModal = 682;
          else {
            this.w.add('지원하지 않는 G268', line);
            if (unknownG < 0) unknownG = g;
          }
          break;
        case 90:
        case 620:
        case 630:
          // G9 정확 정지(한 블록)·G62 모서리 이송 조정·G63 태핑 모드: 이동은 그대로
          break;
        case 600:
        case 270:
        case 290:
          // G60 한 방향 위치 결정·G27 기준점 확인·G29 기준점에서 복귀: 끝점까지 급속 한 번
          oneShot = true;
          break;
        case 331:
          // LinuxCNC G33.1 강성 탭: 끝점까지 이송으로 들어갔다 같은 길로 나온다
          tapOneShot = true;
          break;
        case 120:
        case 130:
          if (this.dialect === 'linuxcnc') {
            this.w.add(`지원하지 않는 G${g / 10}`, line);
            unknownG = g;
          } else pocket = g;
          break;
        case 70:
        case 80:
          // LinuxCNC 선반 지름·반지름 모드(선반 모드에서만 읽는다). Fanuc G08은 미리 읽기(무시)
          if (this.dialect === 'linuxcnc') this.w.add('G7/G8 선반 지름·반지름 모드는 선반 모드에서만 읽음', line);
          break;
        case 330:
          // 밀링의 G33 나사 깎기는 끝점까지 이송 직선(나사 이송은 리드 F)
          this.w.add('나사 깎기(G33)는 끝점까지 이송 직선으로 그림', line);
          motionG = 10;
          break;
        default:
          if (g >= 1100 && g <= 1290 && g % 10 === 0 && this.dialect === 'haas' && !(this.lathe && (g === 1120 || g === 1130))) {
            // Haas G110~G129 = G154 P1~P20(Fanuc 계열에서는 사용자 매크로 G일 수 있고, 선반 G112·G113은 극좌표 보간)
            this.selectWcs(5 + (g / 10 - 109), line);
            break;
          }
          this.w.add(`지원하지 않는 G${(g / 10).toFixed(g % 10 ? 1 : 0)}`, line);
          if (unknownG < 0) unknownG = g;
      }
    }
    // 반경 보정 구간 기록(보정 경로 계산용 — 프로그램 경로는 그대로)
    if (blk.has[LD] && !compDirect && this.comp === compBefore && !this.comp) this.dReg = Math.round(blk.val[LD]!);
    else if (this.comp !== compBefore || compDirect || (blk.has[LD] && this.comp)) this.compChange(blk, line, compDirect);

    // 이송·주축·공구
    if (blk.has[LF]) this.feed = this.feedMode === 93 ? blk.val[LF]! : blk.val[LF]! * this.scale;
    if (blk.has[LS]) {
      if (this.css) this.cssV = Math.abs(blk.val[LS]!);
      else this.speed = Math.abs(blk.val[LS]!);
    }
    let m6 = false;
    for (let k = 0; k < blk.mCount; k++) {
      const m = blk.m[k]!;
      if (m === 6) m6 = true;
      else if (m === 3 || m === 4) this.spindleDir = m;
      else if (m === 5) this.spindleDir = 0;
      else if (m === 7 || m === 8) this.coolant = true;
      else if (m === 9) this.coolant = false;
    }
    if (blk.has[LT]) {
      this.selTool = Math.round(blk.val[LT]!);
      // 선반 T0101 = 공구 01·보정 01
      if (this.lathe && this.selTool >= 100) this.selTool = Math.floor(this.selTool / 100);
      const tInfo = blk.comments.length ? blk.comments.join(' ') : '';
      if (tInfo) this.addToolInfo(this.selTool, tInfo);
      if (!this.seenM6 && !m6) this.changeTool(this.selTool, line);
    }
    if (m6) {
      this.seenM6 = true;
      if (this.selTool >= 0) this.changeTool(this.selTool, line);
    }
    // 안전 확인: 공구 길이 보정 번호(H)·반경 보정 번호(D)가 공구 번호와 다른지(공구 교환 뒤에 본다)
    if (tlcOn) this.noteToolLength(blk.has[7] ? Math.round(blk.val[7]!) : undefined, line);
    if ((this.comp === 1 || this.comp === 2) && blk.has[LD] && !compDirect && this.dialect !== 'siemens') this.checkToolNumber('D', Math.round(blk.val[LD]!), line);
    // 현재 블록 표시용 D 번호(Siemens는 날 번호 그대로)
    if (blk.has[LD] && !compDirect) this.dNum = Math.round(blk.val[LD]!);

    // 휴지
    if (nonModal === 40) {
      if (blk.has[LP]) this.dwell(this.dwellSeconds(blk, LP));
      else if (blk.has[LX]) this.dwell(blk.val[LX]!);
      else if (blk.has[20]) this.dwell(blk.val[20]!); // U
      return this.endBlock(blk, line);
    }

    const uw = this.fanucLathe && (blk.has[LU] || blk.has[LW]);
    const axisGiven = blk.has[LX] || blk.has[LY] || blk.has[LZ] || uw;
    const rotGiven = blk.has[0] || blk.has[1] || blk.has[2];
    if (rotGiven) {
      this.sawRotary = true;
      if (!this.rotAxis && !(nonModal === 680 && this.dialect === 'mach3')) this.w.add('회전축(A·B·C)은 무시함', line);
    }
    if ((this.fanucLathe ? blk.has[21] : blk.has[20] || blk.has[21] || blk.has[22]) && nonModal !== 40) this.w.add('U·V·W 축은 무시함', line);

    // 비모달
    switch (nonModal) {
      case 100:
        this.g10(blk, line);
        return this.endBlock(blk, line);
      case 110:
        return this.endBlock(blk, line);
      case 920: {
        for (let a = 0; a < 3; a++) {
          const L = AXIS_LETTER[a]!;
          if (!blk.has[L]) continue;
          // 지금 위치의 프로그램 좌표가 주어진 값이 되게
          this.g92[a] = 0;
          this.updateOff();
          this.g92[a] = this.pos[a]! - blk.val[L]! * this.axScale[a]! - this.off[a]!;
        }
        this.updateOff();
        return this.endBlock(blk, line);
      }
      case 921:
      case 922:
        this.g92 = [0, 0, 0];
        this.updateOff();
        return this.endBlock(blk, line);
      case 923:
        return this.endBlock(blk, line);
      case 520:
        for (let a = 0; a < 3; a++) {
          const L = AXIS_LETTER[a]!;
          if (blk.has[L]) this.g52[a] = blk.val[L]! * this.axScale[a]!;
        }
        this.updateOff();
        return this.endBlock(blk, line);
      case 510:
        this.g51(blk, line);
        return this.endBlock(blk, line);
      case 511:
        this.g511(blk);
        return this.endBlock(blk, line);
      case 501:
        this.g501(blk);
        return this.endBlock(blk, line);
      case 680:
        this.g68(blk, line);
        return this.endBlock(blk, line);
      case 682:
        this.g682(blk, line);
        return this.endBlock(blk, line);
      case 280:
      case 300: {
        // 중간점 → 기준점
        const mid = this.targets(blk, false);
        this.emit(MOVE_RAPID, mid[0]!, mid[1]!, mid[2]!, line);
        const home = this.homeFor(nonModal);
        const all = !axisGiven;
        const given = (a: number): boolean => all || !!blk.has[AXIS_LETTER[a]!] || (a === 0 && !!uw && !!blk.has[LU]) || (a === 2 && !!uw && !!blk.has[LW]);
        if (home) {
          const t = [0, 1, 2].map((a) => (given(a) ? home[a]! : this.pos[a]!));
          this.emit(MOVE_RAPID, t[0]!, t[1]!, t[2]!, line, FLAG_MACHINE);
        } else this.machineEstimate((given(0) ? 1 : 0) | (given(1) ? 2 : 0) | (given(2) ? 4 : 0), line, `G${nonModal / 10}`);
        return this.endBlock(blk, line);
      }
      case 281:
        this.stored28 = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
        return this.endBlock(blk, line);
      case 301:
        this.stored30 = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
        return this.endBlock(blk, line);
    }

    // 극좌표(G16): 평면 두 축 낱말(반지름·각)을 절대 직교 좌표로 바꿔 둔다(이동·고정 사이클 모두)
    this.polarAgain = null;
    if (this.polar && !this.lathe) this.polarBlock(blk);

    // Haas 볼트 구멍 패턴: 지금 고정 사이클을 패턴 자리마다
    if (boltG >= 0) {
      this.boltPattern(boltG, blk, line);
      return this.endBlock(blk, line);
    }
    // 원형 포켓(G12·G13): 지금 자리를 중심으로
    if (pocket >= 0) {
      this.circPocket(blk, line, pocket === 130);
      return this.endBlock(blk, line);
    }
    // 모르는(또는 매개변수만 받는) G가 있는 블록의 좌표는 이동이 아니다 — 그리지 않는다
    if (unknownG >= 0 && (axisGiven || rotGiven)) {
      this.w.add(`G${(unknownG / 10).toFixed(unknownG % 10 ? 1 : 0)} 블록의 좌표는 이동으로 그리지 않음`, line);
      // 이동은 그리지 않아도 같은 블록의 모달 낱말(G0~G3 이동 꼴, G80 취소·고정 사이클 고르기)은 다음 블록에 남는다
      this.modalOnly(motionG, cycleG);
      return this.endBlock(blk, line);
    }

    // 회전축 각(감기를 켰을 때) — 이번 블록의 이동이 이 각까지 고르게 돈다
    if (rotGiven && this.rotAxis) {
      const t = new Float64Array(this.ang);
      for (let k = 0; k < 3; k++) if (blk.has[k]) t[k] = this.absolute ? blk.val[k]! : t[k]! + blk.val[k]!;
      this.angTo = t;
    }

    // 선반 복합 사이클·좌표 설정
    if (this.lcmd) {
      const c = this.lcmd;
      this.lcmd = 0;
      this.latheCmd(c, blk, line);
      this.finishAng();
      return this.endBlock(blk, line);
    }

    if (tapOneShot && axisGiven) {
      const s = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
      const t = this.targets(blk, false);
      this.emit(MOVE_DRILL, t[0]!, t[1]!, t[2]!, line, FLAG_CYCLE);
      this.emit(MOVE_FEED, s[0]!, s[1]!, s[2]!, line, FLAG_CYCLE);
      this.finishAng();
      return this.endBlock(blk, line);
    }
    // 한 블록 위치 결정(G60·G27·G29): 모달 이동은 그대로 두고 끝점까지 급속
    if (oneShot && axisGiven) {
      const t = this.targets(blk, false);
      this.emit(MOVE_RAPID, t[0]!, t[1]!, t[2]!, line);
      this.known |= (blk.has[LX] ? 1 : 0) | (blk.has[LY] ? 2 : 0) | (blk.has[LZ] ? 4 : 0);
      this.finishAng();
      return this.endBlock(blk, line);
    }

    // LinuxCNC NURBS(G5.2 … G5.3): 다른 이동 꼴·고정 사이클이 끼면 모은 조정점은 G5.3 없이 끝난다
    if (this.nurbs && ((motionG >= 0 && motionG !== 52 && motionG !== 53) || cycleG > 0)) this.nurbsFallback('G5.3 없이 다른 이동 꼴이 옴', line);
    if (motionG === 52 || motionG === 53 || (motionG < 0 && cycleG <= 0 && this.motion === 52)) {
      if (motionG >= 0) {
        this.motion = motionG;
        if (this.cycle) this.cancelCycle();
      }
      this.splinePQ = null;
      this.nurbsBlock(blk, line, motionG === 53, machine);
      this.finishAng();
      return this.endBlock(blk, line);
    }
    if (motionG < 0 && cycleG <= 0 && this.motion === 53 && axisGiven && !this.cycle) this.w.add('G5.3 뒤에 이동 꼴(G0·G1 등) 없이 좌표가 옴 — 이송 직선으로 그림', line);

    // 이동
    if (motionG >= 0) {
      if (motionG !== this.motion && motionG < 900) this.boxX = this.boxZ = NaN;
      this.motion = motionG;
      if (this.cycle) this.cancelCycle();
    }
    if (cycleG === 800) this.cancelCycle();
    else if (cycleG > 0) {
      if (this.cycle !== cycleG) {
        if (!this.cycle) this.cycleFresh = true;
        this.cycle = cycleG;
      }
    }
    if (this.cycle && motionG < 0) {
      if (axisGiven || blk.has[LR] || cycleG > 0) this.doCycle(blk, line);
    } else if (axisGiven && machine && !this.machineBase()) {
      // G53인데 작업 원점의 기계 위치를 모른다: 공구 축만 안전 높이로(추정)
      const mask = (blk.has[LX] ? 1 : 0) | (blk.has[LY] ? 2 : 0) | (blk.has[LZ] ? 4 : 0);
      this.machineEstimate(mask, line, 'G53', this.motion === 0 ? MOVE_RAPID : MOVE_FEED);
    } else if (axisGiven) {
      if (machine && this.motion > 10) this.w.add('G53과 원호는 함께 쓸 수 없음', line);
      const t = this.targets(blk, machine);
      const x = t[0]!;
      const y = t[1]!;
      const z = t[2]!;
      // G5가 I·J 없이 앞 스플라인을 이어 쓰는 것은 G5끼리만(다른 이동이 끼면 끊긴다)
      if (this.motion !== 50) this.splinePQ = null;
      if (this.css) this.cssSpeed((Math.abs(this.pos[0]!) + Math.abs(x)) / 2);
      if (this.motion >= 900) this.latheBox(this.motion, x, z, blk, line);
      else if (this.motion === 20 || this.motion === 30) this.arc(blk, line, x, y, z);
      else if ((this.motion === 50 || this.motion === 51) && !machine) this.spline(blk, line, x, y, z);
      else if (this.tangentArc && this.motion === 10 && !machine) this.emitTangentArc(this.plane, x, y, z, line, 'CT');
      else this.emit(this.motion === 0 ? MOVE_RAPID : MOVE_FEED, x, y, z, line, machine ? FLAG_MACHINE : 0);
      this.known |= (blk.has[LX] || (uw && blk.has[LU]) ? 1 : 0) | (blk.has[LY] ? 2 : 0) | (blk.has[LZ] || (uw && blk.has[LW]) ? 4 : 0);
    } else if ((motionG === 20 || motionG === 30) && (blk.has[LI] || blk.has[LJ] || blk.has[LK])) {
      // 끝점 없이 IJK만: 제자리 완전한 원
      this.arc(blk, line, this.pos[0]!, this.pos[1]!, this.pos[2]!, true);
    } else if (this.angTo && !this.cycle) {
      // 회전축만 움직이는 블록
      this.emit(this.motion === 0 ? MOVE_RAPID : MOVE_FEED, this.pos[0]!, this.pos[1]!, this.pos[2]!, line);
    }
    this.finishAng();
    this.endBlock(blk, line);
  }

  /** 이동 없이 모달만: 이동 꼴(G0~G3이 고정 사이클을 끈다)과 G80 취소·고정 사이클 고르기(구멍은 다음 블록부터) */
  protected modalOnly(motionG: number, cycleG: number): void {
    if (motionG >= 0) {
      if (motionG !== this.motion && motionG < 900) this.boxX = this.boxZ = NaN;
      this.motion = motionG;
      if (this.cycle) this.cancelCycle();
    }
    if (cycleG === 800) this.cancelCycle();
    else if (cycleG > 0 && this.cycle !== cycleG) {
      if (!this.cycle) this.cycleFresh = true;
      this.cycle = cycleG;
    }
  }

  /** 블록에서 쓰지 않은 회전 각을 지금 각으로 */
  protected finishAng(): void {
    if (this.angTo) {
      this.ang.set(this.angTo);
      this.angTo = null;
    }
  }

  /** 반경 보정 상태·반지름 바뀜 기록. D: Fanuc 계열은 보정 번호, LinuxCNC는 공구 번호(없으면 지금 공구), G41.1/G42.1은 지름 */
  protected compChange(blk: Block, line: number, direct: boolean): void {
    if (blk.has[LD]) {
      if (direct) this.dDirect = Math.abs(blk.val[LD]!) * this.scale;
      else this.dReg = Math.round(blk.val[LD]!);
    }
    // LinuxCNC G41.1/G42.1 L: 선반 공구 방향(0~9, 없으면 0 — XZ 평면에서만). 범위 밖은 LinuxCNC 오류라 경고하고 0으로
    if (direct) {
      const l = blk.has[LL] ? blk.val[LL]! : 0;
      const ok = Number.isInteger(l) && l >= 0 && l <= 9;
      if (!ok && this.lathe) this.w.add('G41.1/G42.1 L(선반 공구 방향)이 0~9의 정수가 아님 — LinuxCNC는 오류, 방향 없이 그림', line);
      this.lDirect = ok ? l : 0;
    }
    if (this.comp === 0) return this.noteComp(this.plane, line);
    const tag = `G4${this.comp === 1 ? 1 : 2}.1`;
    const linux = this.dialect === 'linuxcnc' || this.dialect === 'siemens';
    const d = this.dialect === 'siemens' ? this.tool : (this.dReg ?? (linux ? this.tool : -1));
    const latheXZ = this.lathe && this.plane === 1;
    // 선반(XZ)은 D가 없으면(Fanuc 선반 — 노즈 R은 T의 보정 번호 쪽) 지금 공구 번호로 공구 표를 찾는다
    const key = latheXZ && d < 0 ? this.tool : d;
    const name = `${linux || key !== d ? 'T' : 'D'}${key}`;
    const dynamic = direct && this.dDirect !== undefined;
    let radius: number | undefined;
    let source = '';
    let dd = d;
    const tt = !dynamic && key >= 0 ? this.o.toolTable?.[key] : undefined;
    if (dynamic) {
      radius = this.dDirect! / 2;
      source = `${tag} D 지름`;
      dd = -1;
    } else {
      const g = this.radiusGeo.get(key);
      const wear = this.radiusWear.get(key);
      if (tt && (tt.radius !== undefined || tt.diameter !== undefined)) {
        radius = tt.radius ?? tt.diameter! / 2;
        source = `공구 표 ${name}`;
      } else if (g !== undefined || wear !== undefined) {
        radius = (g ?? 0) + (wear ?? 0);
        source = `G10 ${name} 반지름`;
      } else if (d === 0 && !linux) {
        radius = 0;
        source = 'D0';
      }
    }
    if (!latheXZ) return this.noteComp(this.plane, line, radius, source, dd);
    // 선반(XZ): 노즈 반지름과 공구 방향(LinuxCNC Lathe User Information "Tool Positions") — 파일 값(G41.1/G42.1 L, 옵션 공구 표,
    // G10 L1 Q)이 먼저이고 없으면 앱 선반 공구 표(machine.latheToolsMm). 방향 0은 정하지 않은 것으로 보고 다음 출처를 본다(G41.1 L만은 그대로)
    const app = key >= 0 ? this.latheTools?.get(key) : undefined;
    const appName = `선반 공구 표 T${key}`;
    if (radius === undefined && app?.radius !== undefined) {
      radius = app.radius;
      source = appName;
    }
    const tip: CompTip = { tool: key };
    const g10q = this.orientGeo.get(key);
    if (dynamic) {
      tip.orientation = this.lDirect;
      tip.source = `${tag} L`;
    } else if (tt?.orientation) {
      tip.orientation = tt.orientation;
      tip.source = `공구 표 ${name}`;
    } else if (g10q) {
      tip.orientation = g10q;
      tip.source = `G10 ${name} Q`;
    } else if (app?.orientation !== undefined) {
      tip.orientation = app.orientation;
      tip.source = appName;
    }
    this.noteComp(this.plane, line, radius, source, dd, tip);
  }

  /** 블록 끝: 프로그램 흐름 M 코드와 변수 대입 */
  protected endBlock(blk: Block, line: number, assignsOnly = false): void {
    for (const [r, v] of blk.assigns) this.setVar(r, v);
    if (assignsOnly) return;
    for (let k = 0; k < blk.mCount; k++) {
      const m = blk.m[k]!;
      if (m === 2 || m === 30) {
        this.ended = true;
        return;
      }
      if (m === 98) return this.m98(blk, line);
      if (m === 97) return this.m97(blk, line);
      if (m === 99) return this.m99(blk, line);
    }
  }

  protected onComments(blk: Block, line: number): void {
    const text = blk.comments.join(' ').trim();
    if (!text) return;
    // 프로그램 머리 주석(O 번호 줄의 주석, 시작 전 첫 주석이라 프로그램 이름이 된 것 — 공구처럼 보이지 않으면)은
    // 바로 뒤 공구 교환의 공구 이름으로 쓰지 않는다("O1000 (ARC TEST)" 다음 줄 T1 M6)
    let header = !!blk.has[LO];
    if (!this.started && !this.name && line < 5 && !/^\s*T\s*\d/i.test(text)) {
      this.name = text.slice(0, 80);
      if (!looksLikeTool(text)) header = true;
    }
    // 머리말의 공구 목록: (T1 D=6 ...) (TOOL 2 - ...)
    const m = /^\s*(?:T|TOOL)\s*#?\s*(\d+)\b/i.exec(text);
    if (m && !blk.has[LT]) this.addToolInfo(+m[1]!, text);
    this.lastComment = header ? null : { text, line };
  }

  /** 작업 좌표계 번호 → 이름(경고 글) */
  protected wcsLabel(idx: number): string {
    return wcsName(idx);
  }

  protected selectWcs(idx: number, line: number): void {
    if (this.baseWcs < 0) this.baseWcs = idx;
    if (idx !== this.wcs || this.baseWcs === idx) {
      if (idx !== this.baseWcs && !this.wcsKnown.has(idx))
        this.w.add(`${this.wcsLabel(idx)} 오프셋 값을 몰라 ${this.wcsLabel(this.baseWcs)}와 같은 원점으로 그림`, line);
    }
    const rotChanged = (this.wcsRot.get(this.wcs) ?? 0) !== (this.wcsRot.get(idx) ?? 0);
    this.wcs = idx;
    this.updateOff();
    if (rotChanged) this.rebuildXf();
  }

  protected g10(blk: Block, line: number): void {
    const l = blk.has[LL] ? Math.round(blk.val[LL]!) : -1;
    if (l !== 2 && l !== 20) {
      if (l !== 1 && l !== 10 && l !== 11 && l !== 12 && l !== 13) this.w.add(`G10 L${l}은 무시함`, line);
      else if (blk.has[LR]) {
        // 공구 반지름: Fanuc 계열 L12(형상)·L13(마모), LinuxCNC·Mach3 L1·L10·L11
        const p = blk.has[LP] ? Math.round(blk.val[LP]!) : -1;
        const v = blk.val[LR]! * this.scale;
        const nist = this.dialect === 'linuxcnc' || this.dialect === 'mach3';
        const map = nist ? (l === 13 ? null : this.radiusGeo) : l === 12 ? this.radiusGeo : l === 13 ? this.radiusWear : null;
        if (map && p >= 0) map.set(p, this.absolute ? v : (map.get(p) ?? 0) + v);
      }
      // LinuxCNC 선반 공구 방향 Q(설명서 "G10 L1 Set Tool Table" — 0~9, 예 G10 L1 P2 R0.015 Q3). 선반 반경 보정이 쓴다
      if (blk.has[LQ] && this.dialect === 'linuxcnc' && l >= 1 && l <= 11) {
        const p = blk.has[LP] ? Math.round(blk.val[LP]!) : -1;
        const q = blk.val[LQ]!;
        if (p >= 0 && Number.isInteger(q) && q >= 0 && q <= 9) this.orientGeo.set(p, q);
        else this.w.add('G10 공구 방향 Q는 0~9의 정수 — 무시함', line);
      }
      return;
    }
    let p = blk.has[LP] ? Math.round(blk.val[LP]!) : 0;
    if (p === 0) p = this.wcs + 1;
    const idx = p - 1;
    if (blk.has[LR]) {
      // LinuxCNC: 좌표계 회전(XY, 도)
      this.wcsRot.set(idx, blk.val[LR]!);
      if (idx === this.wcs) this.rebuildXf();
    }
    const cur = this.wcsOff.get(idx) ?? [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const L = AXIS_LETTER[a]!;
      if (!blk.has[L]) continue;
      const v = blk.val[L]! * this.axScale[a]!;
      if (l === 2) cur[a] = this.absolute ? v : cur[a]! + v;
      else {
        // L20: 지금 위치가 v가 되게
        const machinePos = this.pos[a]! + (this.wcsOff.get(this.baseWcs < 0 ? this.wcs : this.baseWcs)?.[a] ?? 0) - this.g92[a]! - this.g52[a]!;
        cur[a] = machinePos - v;
      }
    }
    this.wcsOff.set(idx, cur);
    this.wcsKnown.add(idx);
    this.updateOff();
  }

  /** 이 블록의 이송 직선을 앞 요소에 접하는 원호로(Siemens CT — 방언이 블록마다 켠다) */
  protected tangentArc = false;
  /** 앞 G5의 끝 쪽 조정점 오프셋 P·Q(프로그램 좌표) — 다음 G5가 I·J 없이 이어 쓴다 */
  protected splinePQ: [number, number] | null = null;

  /**
   * LinuxCNC 스플라인(G17 평면 X·Y만): G5 = 3차 베지어(I·J = 시작점에서 첫 조정점까지, P·Q = 끝점에서 둘째 조정점까지 — 증분,
   * 이어지는 G5가 I·J를 빼면 앞 G5의 -P·-Q로 접선을 잇는다), G5.1 = 2차(I·J = 시작점에서 조정점까지).
   * 휘는 정도에 맞춰 이송 직선 조각으로 나눈다(조각과 곡선의 차이 0.005 mm 안팎). 규칙에 어긋나면 끝점까지 직선으로 그리고 알린다
   */
  protected spline(blk: Block, line: number, x: number, y: number, z: number): void {
    const name = this.motion === 50 ? 'G5' : 'G5.1';
    const straight = (why: string): void => {
      this.w.add(`${name}: ${why} — 끝점까지 직선으로 그림`, line);
      this.splinePQ = null;
      this.emit(MOVE_FEED, x, y, z, line);
    };
    if (this.plane !== 0) return straight('스플라인은 G17(XY) 평면에서만 읽음');
    if (blk.has[LZ]) return straight('스플라인 블록에 Z가 있음');
    const s = Array.from(this.progPos());
    const e = this.xf ? Array.from(this.ppT) : [x - this.off[0]!, y - this.off[1]!, z - this.off[2]!];
    const kx = this.axScale[0]!;
    const ky = this.axScale[1]!;
    const hasI = blk.has[LI];
    const hasJ = blk.has[LJ];
    const ctrl: number[][] = [];
    if (this.motion === 51) {
      const i = hasI ? blk.val[LI]! * kx : 0;
      const j = hasJ ? blk.val[LJ]! * ky : 0;
      if (i === 0 && j === 0) return straight('조정점 I·J가 없음');
      ctrl.push([s[0]! + i, s[1]! + j]);
      this.splinePQ = null;
    } else {
      if (!blk.has[LP] || !blk.has[LQ]) return straight('끝 쪽 조정점 P·Q가 없음');
      if (hasI !== hasJ) return straight('I·J 가운데 하나만 있음');
      let i: number;
      let j: number;
      if (hasI) {
        i = blk.val[LI]! * kx;
        j = blk.val[LJ]! * ky;
      } else if (this.splinePQ) {
        i = -this.splinePQ[0];
        j = -this.splinePQ[1];
      } else return straight('이어 쓸 앞 G5가 없는데 I·J가 없음');
      const pq: [number, number] = [blk.val[LP]! * kx, blk.val[LQ]! * ky];
      ctrl.push([s[0]! + i, s[1]! + j], [e[0]! + pq[0], e[1]! + pq[1]]);
      this.splinePQ = pq;
    }
    // 조각 수: 2차 미분 크기 M으로 줄 차이 ≤ M/(8n²)
    const pts = [[s[0]!, s[1]!], ...ctrl, [e[0]!, e[1]!]];
    const deg = pts.length - 1;
    let m = 0;
    for (let k = 0; k + 2 < pts.length; k++) m = Math.max(m, Math.hypot(pts[k]![0]! - 2 * pts[k + 1]![0]! + pts[k + 2]![0]!, pts[k]![1]! - 2 * pts[k + 1]![1]! + pts[k + 2]![1]!));
    const tol = this.displayInch ? 0.0002 : 0.005;
    const n = Math.max(2, Math.min(2000, Math.ceil(Math.sqrt((deg * (deg - 1) * m) / (8 * tol)))));
    const q = [0, 0, s[2]!];
    const out = [0, 0, 0];
    // 측정용 곡선 정의(베지어 = 매듭 0·1이 차수 + 1개씩인 B-스플라인, 조정점은 표시 좌표): 조각 끝 매개변수 k/n과 함께 남긴다
    const rec = this.splineBegin(0);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const u = 1 - t;
      if (deg === 2) {
        q[0] = u * u * pts[0]![0]! + 2 * u * t * pts[1]![0]! + t * t * pts[2]![0]!;
        q[1] = u * u * pts[0]![1]! + 2 * u * t * pts[1]![1]! + t * t * pts[2]![1]!;
      } else {
        q[0] = u * u * u * pts[0]![0]! + 3 * u * u * t * pts[1]![0]! + 3 * u * t * t * pts[2]![0]! + t * t * t * pts[3]![0]!;
        q[1] = u * u * u * pts[0]![1]! + 3 * u * u * t * pts[1]![1]! + 3 * u * t * t * pts[2]![1]! + t * t * t * pts[3]![1]!;
      }
      this.toDisplay(q, out);
      this.emit(MOVE_FEED, out[0]!, out[1]!, out[2]!, line);
      this.splineStep(rec, t);
    }
    this.emit(MOVE_FEED, x, y, z, line);
    this.splineStep(rec, 1);
    if (rec) {
      const ctrl: number[] = [];
      for (const c of pts) {
        q[0] = c[0]!;
        q[1] = c[1]!;
        this.toDisplay(q, out);
        ctrl.push(out[0]!, out[1]!, out[2]!);
      }
      const knots = [...Array<number>(deg + 1).fill(0), ...Array<number>(deg + 1).fill(1)];
      this.splineEnd(rec, deg, knots, ctrl, Array<number>(deg + 1).fill(1));
    }
  }

  /**
   * LinuxCNC G5.2 NURBS로 모은 조정점(프로그램 좌표 x·y)·가중치 w·그 블록 줄, 계수(order) L. 첫 조정점은 G5.2 앞의 지금 자리이고,
   * G5.3에서 곡선으로 그린다. bad = 규칙에 어긋난 까닭(있으면 조정점을 직선으로 잇는다)
   */
  protected nurbs: { x: number[]; y: number[]; w: number[]; lines: number[]; order: number; bad: string | null; zWarned: boolean } | null = null;

  /**
   * G5.2 블록(조정점 X·Y + 가중치 P, 계수 L)과 G5.3(끝) — LinuxCNC 설명서 "G5.2 G5.3 NURBS Block"대로:
   * G17 평면만, X·Y는 둘 다, P(기본 1)는 0보다 커야, L(기본 3)은 조정점 수 이하. 첫 G5.2 블록의 P는 첫 조정점(지금 자리)의 가중치도 된다.
   * LinuxCNC는 G5.3까지 지금 자리를 바꾸지 않으므로 G91 조정점은 모두 곡선 시작점(G5.2 앞 자리)에서 잰다. Z는 쓰지 않는다(높이 그대로)
   */
  protected nurbsBlock(blk: Block, line: number, end: boolean, machine: boolean): void {
    const hx = !!blk.has[LX];
    const hy = !!blk.has[LY];
    if (end) {
      if (!this.nurbs) {
        this.w.add('G5.3 앞에 G5.2가 없음', line);
        return;
      }
      if (hx || hy || blk.has[LZ]) this.w.add('G5.3 블록의 좌표는 쓰지 않음', line);
      return this.nurbsFinish(line);
    }
    const p = blk.has[LP] ? blk.val[LP]! : 1;
    let n = this.nurbs;
    if (!n) {
      const q = this.progPos();
      n = this.nurbs = { x: [q[0]!], y: [q[1]!], w: [p], lines: [line], order: 3, bad: null, zWarned: false };
      if (this.plane !== 0) n.bad = 'NURBS는 G17(XY) 평면에서만 읽음';
    }
    if (blk.has[LL]) {
      const l = blk.val[LL]!;
      if (Number.isInteger(l) && l >= 2) n.order = l;
      else n.bad ??= `계수 L${fmtWord(l)}이 2 이상의 정수가 아님`;
    }
    if (!(p > 0)) n.bad ??= `가중치 P${fmtWord(p)}가 0보다 크지 않음`;
    if (blk.has[LZ] && !n.zWarned) {
      n.zWarned = true;
      this.w.add('G5.2 조정점의 Z는 쓰지 않음(높이는 그대로)', line);
    }
    if (!hx && !hy) return;
    if (hx !== hy) n.bad ??= 'X·Y 가운데 하나만 있는 조정점';
    if (machine) n.bad ??= 'G53과 함께 쓸 수 없음';
    // G91: LinuxCNC는 G5.3까지 지금 자리를 바꾸지 않아 증분은 첫 조정점(곡선 시작점)에서 잰다
    const k = n.x.length - 1;
    const coord = (has: boolean, letter: number, bit: number, scale: number, start: number, prev: number): number => {
      if (!has) return prev;
      const v = blk.val[letter]! * scale;
      const inc = blk.axInc & bit ? true : blk.axAbs & bit ? false : !this.absolute;
      return inc ? start + v : v;
    };
    n.x.push(coord(hx, LX, 1, this.axScale[0]!, n.x[0]!, n.x[k]!));
    n.y.push(coord(hy, LY, 2, this.axScale[1]!, n.y[0]!, n.y[k]!));
    n.w.push(p);
    n.lines.push(line);
  }

  /** G5.3: 모은 조정점을 NURBS 곡선으로(열린 균일 매듭 — LinuxCNC와 같음) 이송 직선 조각으로 나눠 그린다 */
  protected nurbsFinish(line: number): void {
    const n = this.nurbs!;
    const cnt = n.x.length;
    if (!n.bad && cnt < 2) n.bad = '조정점이 없음';
    if (!n.bad && cnt < n.order) n.bad = `조정점 ${cnt}개가 계수 L${n.order}보다 적음`;
    if (n.bad) return this.nurbsFallback(n.bad, line);
    this.nurbs = null;
    const z = this.progPos()[2]!;
    const tol = this.displayInch ? 0.0002 : 0.005;
    const q = [0, 0, z];
    const out = [0, 0, 0];
    // 측정용 곡선 정의(조정점은 표시 좌표, 매듭은 LinuxCNC 열린 균일): 조각 끝 매개변수와 함께 남긴다
    const rec = this.splineBegin(0);
    nurbsSegments(n.x, n.y, n.w, n.order, tol, (x, y, k, u) => {
      q[0] = x;
      q[1] = y;
      this.toDisplay(q, out);
      this.emit(MOVE_FEED, out[0]!, out[1]!, out[2]!, n.lines[k]!);
      this.splineStep(rec, u);
    });
    if (rec) {
      const ctrl: number[] = [];
      for (let i = 0; i < cnt; i++) {
        q[0] = n.x[i]!;
        q[1] = n.y[i]!;
        this.toDisplay(q, out);
        ctrl.push(out[0]!, out[1]!, out[2]!);
      }
      this.splineEnd(rec, n.order - 1, nurbsKnots(cnt - 1, n.order), ctrl, n.w);
    }
    this.known |= 3;
  }

  /** 규칙에 어긋난(또는 G5.3 없이 끝난) NURBS: 경고하고 조정점을 차례로 이송 직선으로 잇는다(예전처럼) */
  protected nurbsFallback(why: string, line: number): void {
    const n = this.nurbs;
    if (!n) return;
    this.nurbs = null;
    this.w.add(`G5.2 NURBS: ${why} — 조정점을 직선으로 이음`, line);
    const q = [0, 0, this.progPos()[2]!];
    const out = [0, 0, 0];
    for (let k = 1; k < n.x.length; k++) {
      q[0] = n.x[k]!;
      q[1] = n.y[k]!;
      this.toDisplay(q, out);
      this.emit(MOVE_FEED, out[0]!, out[1]!, out[2]!, n.lines[k]!);
    }
    if (n.x.length > 1) this.known |= 3;
  }

  protected cancelCycle(): void {
    this.cycle = 0;
    this.cycleFresh = true;
    this.cz = undefined;
    this.cr = undefined;
    this.cq = 0;
    this.cp = 0;
    this.cqI = 0;
    this.cqJ = 0;
    this.cqK = 0;
    this.cShift = [0, 0];
    this.cShiftD = [0, 0];
    this.cShiftQ = false;
  }

  // ── 원호 ──
  protected arc(blk: Block, line: number, x: number, y: number, z: number, noEnd = false): void {
    if (this.xf) return this.arcXf(blk, line, noEnd);
    const g = this.arcGeom(blk, line, this.pos, [x, y, z], this.off);
    if (!g) {
      this.emit(MOVE_FEED, x, y, z, line);
      return;
    }
    this.emitArc(this.plane, g.c, g.sweep, x, y, z, line);
  }

  /** 좌표 변환이 켜진 원호: 프로그램 좌표에서 중심을 구하고 옮긴다(거울이면 방향을 바꾼다) */
  protected arcXf(blk: Block, line: number, noEnd: boolean): void {
    const sP = Array.from(this.progPos());
    const eP = noEnd ? sP.slice() : Array.from(this.ppT);
    const e = [0, 0, 0];
    this.toDisplay(eP, e);
    const g = this.arcGeom(blk, line, sP, eP, ZERO3);
    if (!g) {
      this.emit(MOVE_FEED, e[0]!, e[1]!, e[2]!, line);
      return;
    }
    const info = this.xfPlane(this.plane);
    if (!info.keeps) {
      // 회전 평면과 원호 평면이 다르면 원호가 기울어진다 — 잘게 나눈 직선으로
      this.w.add('좌표 회전 평면과 다른 평면의 원호는 직선 조각으로 그림', line);
      const pts: number[] = [];
      const n = arcPoints(sP, eP, g.c, this.plane, g.sweep, Math.PI / 36, pts);
      const q = [0, 0, 0];
      for (let k = 0; k < n; k++) {
        this.toDisplay([pts[k * 3]!, pts[k * 3 + 1]!, pts[k * 3 + 2]!], q);
        this.emit(MOVE_FEED, q[0]!, q[1]!, q[2]!, line);
      }
      return;
    }
    if (!info.uniform) this.w.add('축마다 다른 배율의 원호는 타원 대신 반지름이 바뀌는 호로 그림', line);
    const c = [0, 0, 0];
    this.toDisplay(g.c, c);
    this.emitArc(this.plane, c, g.sweep * info.sign, e[0]!, e[1]!, e[2]!, line);
  }

  /** 원호 중심(c, 직선 축은 시작점)과 부호 있는 중심각. 만들 수 없으면 경고를 남기고 null(직선으로 그린다) */
  protected arcGeom(blk: Block, line: number, s: ArrayLike<number>, e: ArrayLike<number>, absOff: ArrayLike<number>): { c: number[]; sweep: number } | null {
    const ccw = this.motion === 30;
    const [a0, a1, a2] = PLANE_AXES[this.plane]!;
    let c0: number;
    let c1: number;
    if (blk.has[LR]) {
      const R = blk.val[LR]! * this.scale;
      const dx = e[a0]! - s[a0]!;
      const dy = e[a1]! - s[a1]!;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) {
        this.w.add('R 방식으로는 완전한 원을 만들 수 없음 — 직선으로 그림', line);
        return null;
      }
      let r = Math.abs(R);
      if (d / 2 > r) {
        if (d / 2 - r > this.tol) this.w.add('호 반지름 R이 두 점 거리의 절반보다 작음 — 반원으로 그림', line);
        r = d / 2;
      }
      const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
      const side = (ccw ? 1 : -1) * (R < 0 ? -1 : 1);
      c0 = s[a0]! + dx / 2 - (side * h * dy) / d;
      c1 = s[a1]! + dy / 2 + (side * h * dx) / d;
    } else {
      const hasOff = blk.has[OFFSET_LETTER[a0]!] || blk.has[OFFSET_LETTER[a1]!];
      if (!hasOff) {
        this.w.add('원호에 I·J·K·R이 없음 — 직선으로 그림', line);
        return null;
      }
      const o0 = blk.has[OFFSET_LETTER[a0]!] ? blk.val[OFFSET_LETTER[a0]!]! * this.scale : 0;
      const o1 = blk.has[OFFSET_LETTER[a1]!] ? blk.val[OFFSET_LETTER[a1]!]! * this.scale : 0;
      // 절대 중심: G90.1(arcAbs) 또는 Siemens I=AC(…)(축별)
      const abs0 = this.arcAbs || (blk.cAbs & (1 << a0)) !== 0;
      const abs1 = this.arcAbs || (blk.cAbs & (1 << a1)) !== 0;
      c0 = abs0 ? (blk.has[OFFSET_LETTER[a0]!] ? o0 + absOff[a0]! : s[a0]!) : s[a0]! + o0;
      c1 = abs1 ? (blk.has[OFFSET_LETTER[a1]!] ? o1 + absOff[a1]! : s[a1]!) : s[a1]! + o1;
    }
    const u0 = s[a0]! - c0;
    const v0 = s[a1]! - c1;
    const u1 = e[a0]! - c0;
    const v1 = e[a1]! - c1;
    const r0 = Math.hypot(u0, v0);
    const r1 = Math.hypot(u1, v1);
    if (r0 < 1e-9) {
      this.w.add('원호 반지름이 0 — 직선으로 그림', line);
      return null;
    }
    if (Math.abs(r0 - r1) > Math.max(this.tol, r0 * 1e-3)) this.w.add('원호 시작·끝 반지름이 다름(나선형으로 이어 그림)', line);
    const same = Math.hypot(e[a0]! - s[a0]!, e[a1]! - s[a1]!) <= Math.max(1e-7, r0 * 1e-9);
    let sweep = Math.atan2(v1, u1) - Math.atan2(v0, u0);
    const TAU = Math.PI * 2;
    if (ccw) {
      if (same) sweep = TAU;
      else while (sweep <= 0) sweep += TAU;
    } else {
      if (same) sweep = -TAU;
      else while (sweep >= 0) sweep -= TAU;
    }
    if (blk.has[LP] && !blk.has[LR]) {
      const turns = Math.round(blk.val[LP]!);
      if (turns > 1) sweep += (ccw ? 1 : -1) * TAU * (turns - 1);
    }
    const c = [0, 0, 0];
    c[a0] = c0;
    c[a1] = c1;
    c[a2] = s[a2]!;
    return { c, sweep };
  }

  // ── 고정 사이클 ──
  protected doCycle(blk: Block, line: number): void {
    const code = this.cycle;
    // 선반 모드: 정면 드릴(G81~G86, Z 방향)·측면(G87~G89, X 방향)
    const cp = this.lathe ? (code >= 870 && code <= 890 ? 2 : 0) : this.plane;
    const [p0, p1, da] = PLANE_AXES[cp]!;
    if (this.cycleFresh) {
      this.initLevel = this.pos[da]!;
      this.initLevelProg = this.progPos()[da]!;
      // 처음 높이가 기계 좌표 쪽 추정 안전 높이면 그리로 돌아가는 이동도 추정(G53 Z0 뒤의 G98 사이클)
      this.initEst = (this.machHigh & (1 << da)) !== 0;
      this.cycleFresh = false;
    }
    const sc = this.scale;
    const DL = AXIS_LETTER[da]!;
    const dsc = this.axScale[da]!;
    if (blk.has[DL]) this.cz = blk.val[DL]! * dsc;
    if (blk.has[LR]) this.cr = blk.val[LR]! * sc;
    if (blk.has[LQ]) this.cq = Math.abs(blk.val[LQ]!) * sc;
    if (blk.has[LP]) this.cp = this.dwellSeconds(blk, LP);
    // 쪼기 사이클(G73·G83)의 I·J·K: Haas는 첫 절입·줄이는 양·최소 절입(반복은 L). Fanuc 계열도 I·J가 있거나
    // K가 정수가 아니면 Haas 꼴로 본다(K .05를 반복 0번으로 읽어 구멍이 사라지지 않게)
    const peck = code === 730 || code === 830;
    const kFrac = blk.has[LK] && !Number.isInteger(blk.val[LK]!);
    const haasPeck = peck && (this.dialect === 'haas' || blk.has[LI] || blk.has[LJ] || kFrac);
    if (haasPeck) {
      if (this.dialect !== 'haas' && (blk.has[LI] || blk.has[LJ] || blk.has[LK])) this.w.add(`G${code / 10}의 I·J·K를 Haas 쪼기(첫 절입·줄이는 양·최소 절입)로 봄 — 반복은 L`, line);
      if (blk.has[LI]) this.cqI = Math.abs(blk.val[LI]!) * sc;
      if (blk.has[LJ]) this.cqJ = Math.abs(blk.val[LJ]!) * sc;
      if (blk.has[LK]) this.cqK = Math.abs(blk.val[LK]!) * sc;
    }
    // 보링 시프트: Haas는 I·J(방향과 양), Fanuc은 Q(양, 소수점 없으면 최소 입력 단위)를 평면 첫 축 + 방향으로
    if (!this.lathe && (code === 760 || code === 870 || code === 770)) {
      const O0 = OFFSET_LETTER[p0]!;
      const O1 = OFFSET_LETTER[p1]!;
      if (blk.has[O0] || blk.has[O1]) {
        this.cShift = [(blk.has[O0] ? blk.val[O0]! : 0) * sc, (blk.has[O1] ? blk.val[O1]! : 0) * sc];
        this.cShiftQ = false;
      } else if (blk.has[LQ]) {
        const v = Math.abs(blk.val[LQ]!);
        const fanucInt = (this.dialect === 'fanuc' || this.dialect === 'iso') && !blk.dot[LQ];
        this.cShift = [(fanucInt ? v / (this.blockInch ? 10000 : 1000) : v) * sc, 0];
        this.cShiftQ = true;
      }
      // 표시 좌표 방향(좌표 회전·거울이 있으면 함께 돌린다)
      const v3 = [0, 0, 0];
      v3[p0] = this.cShift[0];
      v3[p1] = this.cShift[1];
      if (this.xf) {
        const o = [0, 0, 0];
        const z = [0, 0, 0];
        applyAffine(this.xf, v3, o);
        applyAffine(this.xf, ZERO3, z);
        this.cShiftD = [o[p0]! - z[p0]!, o[p1]! - z[p1]!];
      } else this.cShiftD = [this.cShift[0], this.cShift[1]];
    }
    let reps = 1;
    if (blk.has[LL]) reps = Math.round(blk.val[LL]!);
    else if (blk.has[LK] && cp === 0 && this.dialect !== 'linuxcnc' && this.dialect !== 'haas' && !haasPeck) {
      if (kFrac) {
        this.w.add(`고정 사이클 반복 횟수 K${blk.val[LK]}가 정수가 아님 — 한 번으로 봄`, line);
        reps = 1;
      } else reps = Math.round(blk.val[LK]!);
    }
    if (this.cr === undefined) this.cr = this.absolute ? (this.xf ? this.progPos()[da]! : this.pos[da]! - this.off[da]!) : 0;
    if (this.cz === undefined) {
      this.w.add('고정 사이클에 깊이(Z)가 없음', line);
      return;
    }
    if (reps <= 0) return;
    const L0 = AXIS_LETTER[p0]!;
    const L1 = AXIS_LETTER[p1]!;
    const s0 = this.axScale[p0]!;
    const s1 = this.axScale[p1]!;
    if (this.xf) {
      // 좌표 변환: 프로그램 좌표에서 구멍 자리·높이를 정하고 옮긴다
      const rP = this.absolute ? this.cr : this.initLevelProg + this.cr;
      const zP = this.absolute ? this.cz : rP + this.cz;
      const top = [0, 0, 0];
      const bot = [0, 0, 0];
      // 공구 축이 기울면(G68.2·Siemens ROT X/Y) 프로그램 좌표에서 구멍 길을 만들고 점마다 옮긴다
      const tilted = !this.xfPlane(cp).keeps;
      const map = (v: number[]): void => this.toDisplay(v, v);
      for (let k = 0; k < reps; k++) {
        if (k > 0 && this.polarAgain) this.polarAgain();
        const q = Array.from(this.progPos());
        if (blk.has[L0]) q[p0] = this.incAxis(blk, p0) ? q[p0]! + blk.val[L0]! * s0 : blk.val[L0]! * s0;
        if (blk.has[L1]) q[p1] = this.incAxis(blk, p1) ? q[p1]! + blk.val[L1]! * s1 : blk.val[L1]! * s1;
        if (tilted) {
          this.drillAt(code, p0, p1, da, q[p0]!, q[p1]!, rP, zP, line, map);
          continue;
        }
        q[da] = rP;
        this.toDisplay(q, top);
        q[da] = zP;
        this.toDisplay(q, bot);
        this.drillAt(code, p0, p1, da, top[p0]!, top[p1]!, top[da]!, bot[da]!, line);
      }
      this.known = 7;
      return;
    }
    let rD: number;
    let zD: number;
    if (this.absolute) {
      rD = this.cr + this.off[da]!;
      zD = this.cz + this.off[da]!;
    } else {
      rD = this.initLevel + this.cr;
      zD = rD + this.cz;
    }
    for (let k = 0; k < reps; k++) {
      if (k > 0 && this.polarAgain) this.polarAgain();
      let x = this.pos[p0]!;
      let y = this.pos[p1]!;
      if (blk.has[L0]) x = this.incAxis(blk, p0) ? x + blk.val[L0]! * s0 : blk.val[L0]! * s0 + this.off[p0]!;
      if (blk.has[L1]) y = this.incAxis(blk, p1) ? y + blk.val[L1]! * s1 : blk.val[L1]! * s1 + this.off[p1]!;
      if (this.fanucLathe) {
        if (p0 === 0 && blk.has[LU] && !blk.has[LX]) x = this.pos[0]! + blk.val[LU]! * s0;
        if (p1 === 2 && blk.has[LW] && !blk.has[LZ]) y = this.pos[2]! + blk.val[LW]! * s1;
      }
      this.drillAt(code, p0, p1, da, x, y, rD, zD, line);
    }
    this.known = 7;
  }

  /**
   * 구멍 하나(고정 사이클 몸통). 위치·높이는 표시 좌표, map을 주면 프로그램 좌표(기울인 평면 — 점마다 map으로 표시 좌표로 옮긴다)
   */
  protected drillAt(code: number, p0: number, p1: number, da: number, x: number, y: number, rD: number, zD: number, line: number, map?: (q: number[]) => void): void {
    const up = rD >= zD ? 1 : -1;
    const init = map ? this.initLevelProg : this.initLevel;
    const clear = this.retractR ? rD : up * (init - rD) > 0 ? init : rD;
    // 지금 자리(작업 공간 — map이 있으면 프로그램 좌표)
    const cur = map ? Array.from(this.progPos()) : [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    const pt = [0, 0, 0];
    // 처음 높이가 추정 안전 높이면 그리로 돌아가는 이동의 끝도 추정(build에서 안전 높이 값으로 고친다)
    const estInit = this.initEst && !map;
    const go = (kind: number, depth: number, px = cur[p0]!, py = cur[p1]!): void => {
      cur[p0] = px;
      cur[p1] = py;
      cur[da] = depth;
      pt[0] = cur[0]!;
      pt[1] = cur[1]!;
      pt[2] = cur[2]!;
      if (map) map(pt);
      if (estInit && depth === init) this.emitToEstimated(1 << da, kind, pt[0]!, pt[1]!, pt[2]!, line, FLAG_CYCLE);
      else this.emit(kind, pt[0]!, pt[1]!, pt[2]!, line, FLAG_CYCLE);
    };
    // 컨트롤러처럼: 지금 높이에서 구멍 자리로 옮긴 뒤 R 점으로(지금 높이가 R보다 낮으면 낮은 채 옮겨 간다 — 실제 위험을 숨기지 않게)
    go(MOVE_RAPID, cur[da]!, x, y);
    // 뒤 보링(Fanuc 밀링 G87·Haas G77): 시프트한 자리에서 구멍 아래(R)로 내려간다
    const backBore = !this.lathe && ((code === 870 && this.dialect !== 'haas') || (code === 770 && this.dialect === 'haas'));
    const [sx, sy] = map ? this.cShift : this.cShiftD;
    if (backBore) {
      this.noteShift(line);
      go(MOVE_RAPID, cur[da]!, x + sx, y + sy);
      go(MOVE_RAPID, rD, x + sx, y + sy);
      go(MOVE_RAPID, rD, x, y);
    } else go(MOVE_RAPID, rD);
    const first = this.mb.count;
    const top = [0, 0, 0];
    top[p0] = x;
    top[p1] = y;
    top[da] = rD;
    const bottom = [top[0]!, top[1]!, top[2]!];
    bottom[da] = zD;
    // Haas I·J·K 쪼기(첫 절입 I, 매번 J만큼 줄여 K까지)가 있으면 그것을, 없으면 일정한 Q
    const haasPeck = this.cqI > 0;
    let qb = haasPeck ? this.cqI : this.cq;
    // 첫 절입은 R 점이 아니라 기준면에서 재는 꼴(Siemens CYCLE83)이면 그만큼 더
    let q = haasPeck ? qb + this.peckFirstExtra : qb;
    const qMin = haasPeck ? (this.cqK > 0 ? this.cqK : this.cqJ > 0 ? Math.min(this.cqI, this.cqJ) : this.cqI) : q;
    switch (code) {
      case 830:
      case 730:
        if (q > 0) {
          let d = rD;
          let guard = 0;
          while (up * (d - zD) > 1e-9 && guard++ < 10000) {
            const next = up > 0 ? Math.max(zD, d - q) : Math.min(zD, d + q);
            if (code === 830 && d !== rD) go(MOVE_RAPID, d + up * this.peck);
            go(MOVE_DRILL, next);
            if (next !== zD) go(MOVE_RAPID, code === 830 ? rD : next + up * this.peck);
            d = next;
            if (haasPeck) {
              qb = Math.max(qMin, qb - this.cqJ);
              q = qb;
            }
          }
          go(MOVE_RAPID, clear);
          break;
        }
        go(MOVE_DRILL, zD);
        go(MOVE_RAPID, clear);
        break;
      case 810:
        go(MOVE_DRILL, zD);
        go(MOVE_RAPID, clear);
        break;
      case 820:
        go(MOVE_DRILL, zD);
        this.dwell(this.cp);
        go(MOVE_RAPID, clear);
        break;
      case 840:
      case 842:
      case 843:
      case 740:
      case 850:
      case 890:
        go(MOVE_DRILL, zD);
        if (code === 890 || code === 840 || code === 740) this.dwell(this.cp);
        go(MOVE_FEED, rD);
        if (clear !== rD) go(MOVE_RAPID, clear);
        break;
      case 760:
        if (this.lathe) {
          go(MOVE_DRILL, zD);
          go(MOVE_RAPID, clear);
          break;
        }
        // 정밀 보링: 바닥에서 휴지 → 주축 정위치 → 시프트(벽에서 떨어짐) → 급속 복귀 → 시프트 되돌림
        this.noteShift(line);
        go(MOVE_DRILL, zD);
        this.dwell(this.cp);
        go(MOVE_RAPID, zD, x + sx, y + sy);
        go(MOVE_RAPID, clear, x + sx, y + sy);
        go(MOVE_RAPID, clear, x, y);
        break;
      case 870:
      case 770:
        if (backBore) {
          // 뒤 보링: 아래(R)에서 위(Z)로 이송 → 휴지 → 시프트 → 늘 처음 높이로 급속 → 시프트 되돌림
          go(MOVE_DRILL, zD);
          this.dwell(this.cp);
          go(MOVE_RAPID, zD, x + sx, y + sy);
          go(MOVE_RAPID, init, x + sx, y + sy);
          go(MOVE_RAPID, init, x, y);
          break;
        }
        this.w.add(`G${code / 10} 사이클(수동 복귀)은 내려가서 급속 복귀로 그림`, line);
        go(MOVE_DRILL, zD);
        go(MOVE_RAPID, clear);
        break;
      case 860:
      case 880:
        if (code === 880) this.w.add('G88 사이클(바닥 휴지 뒤 수동 복귀)은 급속 복귀로 그림', line);
        go(MOVE_DRILL, zD);
        if (code === 880) this.dwell(this.cp);
        go(MOVE_RAPID, clear);
        break;
      default:
        go(MOVE_DRILL, zD);
        go(MOVE_RAPID, clear);
    }
    if (this.mb.count > first) {
      if (map) {
        map(top);
        map(bottom);
      }
      if (this.rotAxis && !this.rotOff && (this.ang[0] || this.ang[1] || this.ang[2])) {
        const w = [0, 0, 0];
        this.wrapPoint(top[0]!, top[1]!, top[2]!, this.ang, w);
        top[0] = w[0]!;
        top[1] = w[1]!;
        top[2] = w[2]!;
        this.wrapPoint(bottom[0]!, bottom[1]!, bottom[2]!, this.ang, w);
        bottom[0] = w[0]!;
        bottom[1] = w[1]!;
        bottom[2] = w[2]!;
      }
      this.mb.pushHole(top, bottom, line, this.tool, code / 10, first);
    }
  }

  /**
   * Haas 볼트 구멍 패턴(지금 자리가 기준, 지금 고정 사이클을 자리마다):
   * G70 I 반지름 J 시작 각 L 개수(원 둘레에 고르게), G71 I 반지름 J 시작 각 K 각 간격 L 개수(호),
   * G72 I 간격 J 각 L 개수(지금 자리에서 그 방향으로 I씩 — 첫 구멍은 I만큼 떨어진 곳). 끝나면 마지막 구멍 자리에 있다
   */
  private boltPattern(g: number, blk: Block, line: number): void {
    const name = `G${g / 10}`;
    if (!this.cycle) {
      this.w.add(`${name} 볼트 구멍 패턴 앞에 고정 사이클이 없음 — 그리지 않음`, line);
      return;
    }
    const sc = this.scale;
    const I = blk.has[LI] ? blk.val[LI]! * sc : 0;
    const J = blk.has[LJ] ? blk.val[LJ]! : 0;
    const K = blk.has[LK] ? blk.val[LK]! : 0;
    const L = blk.has[LL] ? Math.max(0, Math.round(blk.val[LL]!)) : 0;
    if (!L) {
      this.w.add(`${name} 볼트 구멍 패턴에 구멍 수 L이 없음`, line);
      return;
    }
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const c = this.progPos();
    const cu = c[a0]!;
    const cv = c[a1]!;
    const pts: [number, number][] = [];
    for (let k = 0; k < L; k++) {
      if (g === 720) {
        const t = (J * Math.PI) / 180;
        pts.push([cu + (k + 1) * I * Math.cos(t), cv + (k + 1) * I * Math.sin(t)]);
      } else {
        const ang = ((J + k * (g === 700 ? 360 / L : K)) * Math.PI) / 180;
        pts.push([cu + I * Math.cos(ang), cv + I * Math.sin(ang)]);
      }
    }
    // 자리마다 절대 좌표 블록으로 고정 사이클을 부른다(R·Z·Q 등은 사이클의 모달 값)
    const b = new Block();
    for (const [u, v] of pts) {
      b.reset();
      b.set(AXIS_LETTER[a0]!, u / this.axScale[a0]!, true);
      b.set(AXIS_LETTER[a1]!, v / this.axScale[a1]!, true);
      b.axAbs = (1 << a0) | (1 << a1);
      this.doCycle(b, line);
    }
  }

  /** 지금 공구 반지름(D 번호 → G10 L12/L13·공구 표, 없으면 지금 공구의 공구 표·주석 지름). 모르면 undefined */
  protected toolRadiusFor(d: number | undefined): number | undefined {
    if (d !== undefined && d >= 0) {
      const tt = this.o.toolTable?.[d];
      if (tt && (tt.radius !== undefined || tt.diameter !== undefined)) return tt.radius ?? tt.diameter! / 2;
      const g = this.radiusGeo.get(d);
      const w = this.radiusWear.get(d);
      if (g !== undefined || w !== undefined) return (g ?? 0) + (w ?? 0);
    }
    const t = this.tool;
    const tt = this.o.toolTable?.[t];
    if (tt && (tt.radius !== undefined || tt.diameter !== undefined)) return tt.radius ?? tt.diameter! / 2;
    const dia = this.toolInfo.get(t)?.diameter;
    return dia !== undefined ? dia / 2 : undefined;
  }

  /**
   * Haas·Mach3 원형 포켓 G12(시계)·G13(반시계): 지금 자리가 중심. I = 첫 원 반지름(K 없으면 마무리), K = 마무리 반지름,
   * Q = 반지름 증분(K와 함께), Z = 깊이(G91이면 증분, L번 반복하며 더 깊게), D = 공구 반지름 번호.
   * 공구 중심은 포켓 반지름 - 공구 반지름. 원마다 중심에서 직선으로 나가 한 바퀴 돌고, 끝나면 중심으로 돌아온다.
   */
  protected circPocket(blk: Block, line: number, ccw: boolean): void {
    const name = ccw ? 'G13' : 'G12';
    const sc = this.scale;
    if (!blk.has[LI]) {
      this.w.add(`${name} 원형 포켓에 반지름 I가 없음 — 그리지 않음`, line);
      return;
    }
    let tr = this.toolRadiusFor(blk.has[LD] ? Math.round(blk.val[LD]!) : undefined);
    if (tr === undefined) {
      this.w.add(`${name} 원형 포켓: 공구 반지름을 몰라 포켓 반지름 그대로 그림`, line);
      tr = 0;
    }
    const r1 = Math.abs(blk.val[LI]!) * sc;
    const rk = blk.has[LK] ? Math.abs(blk.val[LK]!) * sc : r1;
    const q = blk.has[LQ] ? Math.abs(blk.val[LQ]!) * sc : 0;
    const radii: number[] = [];
    if (blk.has[LK] && q > 0) {
      for (let r = r1; r < rk - 1e-9 && radii.length < 1000; r += q) radii.push(r);
    } else if (blk.has[LK]) radii.push(r1);
    radii.push(rk);
    const path = radii.map((r) => r - tr!).filter((r) => r > 1e-9);
    if (!path.length) {
      this.w.add(`${name} 원형 포켓: 공구가 포켓보다 큼 — 그리지 않음`, line);
      return;
    }
    const loops = Math.max(1, blk.has[LL] ? Math.round(blk.val[LL]!) : 1);
    const cx = this.pos[0]!;
    const cy = this.pos[1]!;
    let z = this.pos[2]!;
    const zStep = blk.has[LZ] ? blk.val[LZ]! * this.axScale[2]! : 0;
    for (let n = 0; n < loops; n++) {
      if (blk.has[LZ]) z = this.absolute ? zStep + this.off[2]! : z + zStep;
      this.emit(MOVE_FEED, cx, cy, z, line, FLAG_CYCLE);
      for (const r of path) {
        this.emit(MOVE_FEED, cx + r, cy, z, line, FLAG_CYCLE);
        this.emitArc(0, [cx, cy, z], ccw ? Math.PI * 2 : -Math.PI * 2, cx + r, cy, z, line, FLAG_CYCLE);
      }
      this.emit(MOVE_FEED, cx, cy, z, line, FLAG_CYCLE);
    }
    this.known = 7;
  }

  // ── 선반 ──

  /** 선반 모드의 G 코드. -1 = 선반 코드가 아님(보통 처리), 0 = 처리함, 그 밖 = 이동 모드(×10) */
  protected latheCode(g: number, blk: Block, line: number): number {
    switch (g) {
      case 70:
      case 80:
        this.xMul = g === 70 ? 0.5 : 1;
        this.updateScale();
        return 0;
      case 960:
        this.css = true;
        if (blk.has[LD]) {
          // LinuxCNC G96 D = 최고 회전수
          this.maxRpm = Math.abs(blk.val[LD]!);
          blk.has[LD] = 0;
        }
        return 0;
      case 970:
        this.css = false;
        return 0;
      case 320:
      case 330:
      case 331:
        // 나사 깎기 이동(G32·G33)은 이송 직선으로
        return 10;
    }
    const xz = blk.has[LX] || blk.has[LU] || blk.has[LZ] || blk.has[LW];
    if (!this.fanucLathe) {
      if (g === 760) {
        this.lcmd = 760;
        return 0;
      }
      if (this.dialect === 'linuxcnc' && (g === 700 || g === 710 || g === 711 || g === 712 || g === 720 || g === 721 || g === 722)) {
        // LinuxCNC G70·G71·G72(.1·.2): D는 윤곽까지 남길 거리(보정 번호가 아니다)
        this.lcmd = g;
        this.g7xD = blk.has[LD] ? blk.val[LD]! : NaN;
        blk.has[LD] = 0;
        return 0;
      }
      if (g === 700 || g === 710 || g === 720 || g === 730) {
        this.w.add(`G${g / 10}(LinuxCNC 선반 사이클)은 지원하지 않음`, line);
        return 0;
      }
      return -1;
    }
    // B·C 체계에서 바꿔 온 단순 사이클(G77/G78/G79·G20/G21/G24)은 좌표가 없어도 사이클(모달)
    const sys = this.latheSys !== 'A';
    switch (g) {
      case 900:
        // A 체계: 바깥·안지름 단순 사이클. 좌표가 없으면 절대 지령(B 체계)으로 본다
        if (xz || sys) return 900;
        this.absolute = true;
        return 0;
      case 920:
        // 나사 단순 사이클(리드 F가 있을 때). 아니면 좌표 설정(G92)으로
        return (xz && blk.has[LF]) || sys ? 920 : -1;
      case 940:
        if (xz || sys) return 940;
        this.feedMode = 94;
        return 0;
      case 980:
        this.feedMode = 94;
        return 0;
      case 990:
        this.feedMode = 95;
        return 0;
      case 500:
        if (blk.has[LS]) {
          this.maxRpm = Math.abs(blk.val[LS]!);
          blk.has[LS] = 0;
        }
        if (xz) this.lcmd = 500;
        return 0;
      case 700:
      case 710:
      case 720:
      case 730:
      case 740:
      case 750:
      case 760:
        this.lcmd = g;
        // 한 블록 꼴 G71/G72 … D(절입)는 보정 번호가 아니다
        if (blk.has[LD] && (g === 710 || g === 720)) this.roughD = this.incVal(blk, LD);
        blk.has[LD] = 0;
        return 0;
    }
    return -1;
  }

  /**
   * Fanuc 선반 B·C 체계 코드(×10) → A 체계 코드(Fanuc 선반 설명서의 G 코드 표). A와 뜻이 다른 G90/G91(절대·증분)·G94/G95(분당·회전당 이송)·
   * G98/G99(고정 사이클 복귀 높이)와 C 체계의 G70/G71(inch·mm)은 여기서 처리하고 -1. B: G77→G90·G78→G92·G79→G94·G92→G50,
   * C: G20→G90·G21→G92·G24→G94·G72~G78→G70~G76·G92→G50. U·W는 A처럼 증분으로도 읽는다
   */
  protected latheSysCode(g: number): number {
    switch (g) {
      case 900:
      case 910:
        this.absolute = g === 900;
        return -1;
      case 940:
      case 950:
        this.feedMode = g === 940 ? 94 : 95;
        return -1;
      case 980:
      case 990:
        this.retractR = g === 990;
        return -1;
      case 920:
        return 500;
    }
    if (this.latheSys === 'B') return g === 770 ? 900 : g === 780 ? 920 : g === 790 ? 940 : g;
    switch (g) {
      case 200:
        return 900;
      case 210:
        return 920;
      case 240:
        return 940;
      case 700:
      case 710:
        this.blockInch = g === 700;
        this.updateScale();
        return -1;
      case 720:
      case 730:
      case 740:
      case 750:
      case 760:
      case 770:
      case 780:
        return g - 20;
    }
    return g;
  }

  /** 주속 일정(G96): 반지름 r에서의 회전수로 this.speed를 맞춘다(최고 회전수로 자름) */
  protected cssSpeed(r: number): void {
    if (!(this.cssV > 0)) return;
    const rr = Math.max(Math.abs(r), this.displayInch ? 0.02 : 0.5);
    let rpm = this.displayInch ? (12 * this.cssV) / (2 * Math.PI * rr) : (1000 * this.cssV) / (2 * Math.PI * rr);
    const cap = this.maxRpm > 0 ? this.maxRpm : 10000;
    if (rpm > cap) {
      if (!(this.maxRpm > 0)) this.w.add('G96 주속 일정에 최고 회전수(G50 S·G96 D)가 없어 10000rpm으로 자름');
      rpm = cap;
    }
    this.speed = rpm;
  }

  /** 선반 이동(XZ, Y는 그대로) */
  protected lgo(kind: number, x: number, z: number, line: number): void {
    if (this.css) this.cssSpeed((Math.abs(this.pos[0]!) + Math.abs(x)) / 2);
    this.emit(kind, x, this.pos[1]!, z, line, FLAG_CYCLE);
  }

  /** G90(바깥·안지름)·G92(나사)·G94(단면) 단순 사이클: 시작점으로 돌아오는 네 이동. R = 테이퍼 */
  protected latheBox(code: number, xt: number, zt: number, blk: Block, line: number): void {
    const xs = this.pos[0]!;
    const zs = this.pos[2]!;
    // 사이클 값은 모달: 다음 블록에서 빠진 X·Z는 앞 사이클 값
    if (blk.has[LX] || blk.has[LU]) this.boxX = xt;
    else if (Number.isFinite(this.boxX)) xt = this.boxX;
    if (blk.has[LZ] || blk.has[LW]) this.boxZ = zt;
    else if (Number.isFinite(this.boxZ)) zt = this.boxZ;
    const r = blk.has[LR] ? blk.val[LR]! * this.scale : 0;
    if (code === 940) {
      this.lgo(MOVE_RAPID, xs, zt + r, line);
      this.lgo(MOVE_FEED, xt, zt, line);
      this.lgo(MOVE_FEED, xt, zs, line);
      this.lgo(MOVE_RAPID, xs, zs, line);
    } else {
      this.lgo(MOVE_RAPID, xt + r, zs, line);
      this.lgo(MOVE_FEED, xt, zt, line);
      this.lgo(code === 920 ? MOVE_RAPID : MOVE_FEED, xs, zt, line);
      this.lgo(MOVE_RAPID, xs, zs, line);
    }
    this.known = 7;
  }

  /** P·Q 같은 소수점 없는 거리(최소 입력 단위 0.001 mm · 0.0001 inch) */
  protected incVal(blk: Block, L: number): number {
    const v = Math.abs(blk.val[L]!);
    return (blk.dot[L] ? v : v / (this.blockInch ? 10000 : 1000)) * this.scale;
  }

  /** 선반 복합 사이클·좌표 설정 */
  protected latheCmd(c: number, blk: Block, line: number): void {
    if (!this.fanucLathe && c >= 700 && c < 730) return this.linuxG7x(c, blk, line);
    switch (c) {
      case 500: {
        // G50 X Z: 지금 위치의 좌표를 주어진 값으로(G92와 같음)
        for (const [a, L] of [
          [0, LX],
          [2, LZ],
        ] as const) {
          if (!blk.has[L]) continue;
          this.g92[a] = 0;
          this.updateOff();
          this.g92[a] = this.pos[a]! - blk.val[L]! * this.axScale[a]! - this.off[a]!;
        }
        this.updateOff();
        return;
      }
      case 700:
        return this.g70(blk, line);
      case 710:
      case 720:
      case 730:
        return this.roughCycle(c, blk, line);
      case 740:
      case 750:
        return this.peckCycle(c, blk, line);
      case 760:
        return this.threadCycle(blk, line);
    }
  }

  /** o-코드 서브루틴 label의 몸통 줄 범위(sub 다음 줄 ~ endsub 앞 줄). 없으면 null */
  protected oSubBody(label: string): [number, number] | null {
    const list = this.buildOCodes().get(label);
    const def = list?.find((x) => x.kw === 'SUB');
    const end = def && list!.find((x) => x.line > def.line && x.kw === 'ENDSUB');
    return def && end ? [def.line + 1, end.line - 1] : null;
  }

  /**
   * LinuxCNC G70·G71·G72 윤곽: 서브루틴 몸통(줄 s~e)의 G0(G1로 봄)·G1·G2·G3을 상태를 건드리지 않고 요소로(u = Z, v = X 반지름).
   * 첫 이동의 끝이 윤곽 시작이다(사이클은 그 점까지 급속으로 간다). U·W는 증분, A·C는 그 이동 끝 모서리의 둥글리기·모따기 크기.
   * 그 밖의 낱말(이송·주축 등)과 o-코드 흐름 줄은 읽지 않는다
   */
  protected linuxProfile(s: number, e: number): { els: G7xEl[]; corners: G7xCorner[] } {
    const b = new Block();
    const bytes = this.src.bytes;
    let u = this.pos[2]!;
    let v = this.pos[0]!;
    let mot = 10;
    let abs = this.absolute;
    let first = true;
    const els: G7xEl[] = [];
    const corners: G7xCorner[] = [];
    for (let i = s; i <= e; i++) {
      b.reset();
      const [s0, e0] = lineRange(this.src, i);
      if (!parseFast(bytes, s0, e0, b, () => {})) {
        b.reset();
        try {
          parseSlow(decodeRange(this.src, s0, e0), b, this);
        } catch {
          continue;
        }
      }
      if (b.ctrl) continue;
      if (this.o.integerUnits) this.integerWords(b);
      for (let k = 0; k < b.gCount; k++) {
        const g = b.g[k]!;
        if (g === 0 || g === 10) mot = 10;
        else if (g === 20 || g === 30) mot = g;
        else if (g === 900 || g === 910) abs = g === 900;
      }
      if (!b.has[LX] && !b.has[LU] && !b.has[LZ] && !b.has[LW]) continue;
      let nv = v;
      let nu = u;
      if (b.has[LX]) nv = abs ? b.val[LX]! * this.axScale[0]! + this.off[0]! : v + b.val[LX]! * this.axScale[0]!;
      else if (b.has[LU]) nv = v + b.val[LU]! * this.axScale[0]!;
      if (b.has[LZ]) nu = abs ? b.val[LZ]! * this.axScale[2]! + this.off[2]! : u + b.val[LZ]! * this.axScale[2]!;
      else if (b.has[LW]) nu = u + b.val[LW]! * this.axScale[2]!;
      if (!first && Math.hypot(nu - u, nv - v) > 1e-9) {
        if (mot === 20 || mot === 30) {
          // G18 원호(I = X, K = Z 증분 중심, 또는 R)
          const ccw = mot === 30;
          let cu: number;
          let cv: number;
          if (b.has[LR]) {
            const R = b.val[LR]! * this.scale;
            const du = nu - u;
            const dv = nv - v;
            const d = Math.hypot(du, dv);
            const r = Math.max(Math.abs(R), d / 2);
            const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
            const side = (ccw ? 1 : -1) * (R < 0 ? -1 : 1);
            cu = u + du / 2 - (side * h * dv) / d;
            cv = v + dv / 2 + (side * h * du) / d;
          } else {
            cu = u + (b.has[LK] ? b.val[LK]! * this.scale : 0);
            cv = v + (b.has[LI] ? b.val[LI]! * this.scale : 0);
          }
          let sw = Math.atan2(nv - cv, nu - cu) - Math.atan2(v - cv, u - cu);
          if (ccw) while (sw <= 0) sw += Math.PI * 2;
          else while (sw >= 0) sw -= Math.PI * 2;
          els.push({ arc: true, su: u, sv: v, eu: nu, ev: nv, cu, cv, sweep: sw });
        } else els.push(g7xLine(u, v, nu, nv));
        const fa = b.has[LA] ? b.val[LA]! : 0;
        const fc = b.has[LC] ? b.val[LC]! : 0;
        if (fa > 0 || fc > 0) corners.push({ at: els.length - 1, kind: fa > 0 ? 'round' : 'chamfer', size: (fa > 0 ? fa : fc) * this.scale });
      }
      first = false;
      u = nu;
      v = nv;
    }
    return { els, corners };
  }

  /**
   * LinuxCNC 선반 G70(다듬질)·G71/G72(거친 깎기 — G7x.1은 포켓을 빼고, G7x.2는 포켓만): 윤곽은 o-코드 서브루틴 Q
   * (LinuxCNC 설명서 G-code 절 "G70 Lathe finishing cycle"·"G71 G72 Lathe roughing cycles"). X·Z가 있으면 먼저 그 자리로 급속(시작점).
   * G71·G72는 윤곽에서 시작점 쪽으로 D(기본 0)만큼 떨어진 곡선까지 I(절입, 기본 1)씩 층으로 깎고 R(물러남, 기본 0.5)만큼 물러나며,
   * 끝나면 떨어진 윤곽을 따라가 그 끝에 선다. G70은 P(횟수, 기본 1)번, 차례마다 윤곽에서 (차례 - 1)(D - E)/P + E 떨어진 곡선을 따라가고
   * (마지막 차례가 E), 차례 사이에 시작점으로 급속. 그리는 꼴과 설명서가 정하지 않은 자리는 lathe-g7x.ts
   */
  protected linuxG7x(c: number, blk: Block, line: number): void {
    const name = `G${(c / 10).toFixed(c % 10 ? 1 : 0)}`;
    const finish = c === 700;
    const facing = c >= 720;
    const part = (c % 10) as 0 | 1 | 2;
    const D = Number.isNaN(this.g7xD) ? 0 : this.g7xD * this.scale;
    this.g7xD = NaN;
    const known = finish ? 'QXZDEP' : 'QXZDIR';
    const extra: string[] = [];
    for (const ch of 'ABCEHIJKLPRUVWY') if (blk.has[ch.charCodeAt(0) - A] && !known.includes(ch)) extra.push(ch);
    if (extra.length) this.w.add(`${name}: LinuxCNC 설명서에 없는 낱말 ${extra.join('·')} — 읽지 않음`, line);
    if (!blk.has[LQ]) {
      this.w.add(`${name}에 윤곽 서브루틴 번호 Q가 없음 — LinuxCNC는 오류`, line);
      return;
    }
    const q = Math.round(blk.val[LQ]!);
    const body = this.oSubBody(String(q));
    if (!body) {
      this.w.add(`${name}: 윤곽 서브루틴 o${q} sub를 찾지 못함 — LinuxCNC는 오류`, line);
      return;
    }
    if (this.plane !== 1) this.w.add(`${name}: G18(ZX) 평면이 아님 — LinuxCNC는 오류(ZX 단면으로 그림)`, line);
    if (!finish && this.comp) this.w.add(`${name}: 반경 보정(G41/G42) 중 — LinuxCNC는 오류`, line);
    if (blk.has[LX] || blk.has[LZ]) this.lgo(MOVE_RAPID, this.target(blk, 0, false), this.target(blk, 2, false), line);
    const S: [number, number] = [this.pos[2]!, this.pos[0]!];
    const prof = this.linuxProfile(body[0], body[1]);
    const cut = g7xCorners(prof.els, prof.corners);
    if (cut.failed) this.w.add(`${name}: 모서리 둥글리기·모따기(A·C)를 넣을 수 없음 — 모서리 그대로 그림`, line);
    const els = cut.els;
    if (!els.length) {
      this.w.add(`${name}: 윤곽 점이 모자람`, line);
      return;
    }
    let ext = Math.max(1, Math.abs(S[0]), Math.abs(S[1]));
    for (const e of els) ext = Math.max(ext, Math.abs(e.su), Math.abs(e.sv), Math.abs(e.eu), Math.abs(e.ev));
    const tol = 1e-7 * ext;
    // 한 방향으로만 바뀌어야 하는 축: G71 = Z(u), G72 = X(v), G70 = 둘 가운데 하나
    let m: 0 | 1 = facing ? 1 : 0;
    let sg = g7xMonotonic(els, m, tol);
    if (!sg && finish) {
      m = 1;
      sg = g7xMonotonic(els, 1, tol);
    }
    if (!sg) {
      this.w.add(`${name}: 윤곽의 ${finish ? 'Z·X' : facing ? 'X' : 'Z'}가 한 방향으로만 바뀌지 않음 — LinuxCNC는 오류(사이클을 그리지 않음)`, line);
      return;
    }
    const { side, k } = g7xSide(els, S, m);
    const dia = this.xMul !== 1;
    if (finish) {
      const E = blk.has[LE] ? blk.val[LE]! * this.scale : 0;
      const P = Math.max(1, Math.round(blk.has[LP] ? blk.val[LP]! : 1));
      if (dia && (D !== 0 || E !== 0)) this.w.add(`${name}: 지름 모드(G7)에서 D·E는 반지름 거리로 봄(설명서에 정해지지 않음)`, line);
      const mid = [this.pos[0]!, this.pos[2]!];
      for (let pass = P; pass >= 1; pass--) {
        if (pass < P) this.lgo(MOVE_RAPID, mid[0]!, mid[1]!, line);
        this.followG7x(g7xOffset(els, ((pass - 1) * (D - E)) / P + E, k), line);
      }
    } else {
      const I = blk.has[LI] ? Math.abs(blk.val[LI]!) * this.scale : this.scale;
      const R = blk.has[LR] ? Math.abs(blk.val[LR]!) * this.scale : 0.5 * this.scale;
      if (dia) this.w.add(`${name}: 지름 모드(G7)에서 D·I·R는 반지름 거리로 봄(설명서에 정해지지 않음)`, line);
      if (!(I > 0)) this.w.add(`${name}: 절입 I가 0임 — 다듬질 윤곽만 그림`, line);
      const off = g7xOffset(els, D, k);
      const poly = g7xPolyline(off, Math.PI / 90);
      const s = (1 - m) as 0 | 1;
      const dir = -side;
      const plan = g7xRough(poly.pts, S, s, dir, I, R, part);
      for (const mv of plan.moves) this.lgo(mv.rapid ? MOVE_RAPID : MOVE_FEED, mv.v, mv.u, line);
      if (plan.pockets) this.w.add(`${name}: 오목한 곳(포켓)에 들어가는 차례는 설명서에 없어 위 층을 따라 내려가게 그림`, line);
      let path = off;
      if (part) {
        // G7x.1은 윤곽이 처음 다시 깊어지는 꼭짓점에서 멈추고, G7x.2는 거기서 이어 끝까지
        const ridge = g7xRidge(poly.pts, s, dir, tol);
        if (ridge >= 0) {
          this.w.add(`${name}: 멈추고 이어 깎는 자리는 설명서에 자세히 없어 윤곽이 처음 다시 깊어지는 꼭짓점으로 봄`, line);
          const el = poly.el[ridge]!;
          const [a, b] = el < 0 ? [[], off] : g7xSplit(off, el, poly.frac[ridge]!);
          path = part === 1 ? a : b;
        } else if (part === 2) path = [];
      }
      this.followG7x(path, line);
    }
    this.known = 7;
  }

  /** G70·G71·G72 윤곽 따라가기: 시작까지 급속, 직선은 이송, 원호는 G18 원호로 */
  protected followG7x(els: readonly G7xEl[], line: number): void {
    if (!els.length) return;
    this.lgo(MOVE_RAPID, els[0]!.sv, els[0]!.su, line);
    for (const e of els) {
      if (!e.arc) {
        this.lgo(MOVE_FEED, e.ev, e.eu, line);
        continue;
      }
      if (this.css) this.cssSpeed((Math.abs(this.pos[0]!) + Math.abs(e.ev)) / 2);
      this.emitArc(1, [e.cv, this.pos[1]!, e.cu], e.sweep, e.ev, this.pos[1]!, e.eu, line, FLAG_CYCLE);
    }
  }

  /** N 번호 P·Q로 윤곽 줄 범위 */
  protected profileRange(blk: Block, line: number, what: string): [number, number] | null {
    if (!blk.has[LP] || !blk.has[LQ]) {
      this.w.add(`${what}에 윤곽 범위 P·Q가 없음`, line);
      return null;
    }
    const ns = Math.round(blk.val[LP]!);
    const nf = Math.round(blk.val[LQ]!);
    const s = this.findN(ns);
    const e = this.findN(nf);
    if (s < 0 || e < 0 || e < s) {
      this.w.add(`${what}: 윤곽 N${ns}~N${nf}을 찾지 못함`, line);
      return null;
    }
    return [s, e];
  }

  /** G70 P Q: 윤곽 블록을 그대로 실행하고 시작점으로 돌아온다 */
  protected g70(blk: Block, line: number): void {
    const r = this.profileRange(blk, line, 'G70');
    if (!r) return;
    if (this.stack.length >= MAX_CALL_DEPTH) return;
    const f = this.stack[this.stack.length - 1]!;
    this.stack.push({
      kind: 'm97',
      ret: line + 1,
      start: r[0],
      reps: 1,
      locals: f.locals,
      named: f.named,
      endLine: r[1],
      back: [this.pos[0]!, this.pos[1]!, this.pos[2]!],
      backLine: line,
    });
    this.rangeEnd = r[1];
    this.pc = r[0];
  }

  /** 줄 범위 실행(G70)이 끝남 */
  protected endRange(): void {
    const f = this.stack[this.stack.length - 1]!;
    if (f.endLine === undefined) {
      this.rangeEnd = -1;
      return;
    }
    this.stack.pop();
    this.pc = f.ret;
    this.rangeEnd = this.stack[this.stack.length - 1]?.endLine ?? -1;
    if (f.back) {
      const b = f.back;
      const ln = f.backLine ?? 0;
      this.lgo(MOVE_RAPID, b[0], this.pos[2]!, ln);
      this.lgo(MOVE_RAPID, b[0], b[2], ln);
    }
  }

  /** 윤곽 블록(줄 s~e)을 상태를 건드리지 않고 읽어 XZ 점열(표시 좌표, X = 반지름)로. 원호는 5도로 나눈다 */
  protected profile(s: number, e: number): number[] {
    const b = new Block();
    const bytes = this.src.bytes;
    let x = this.pos[0]!;
    let z = this.pos[2]!;
    let mot = this.motion < 900 ? this.motion : 0;
    let abs = this.absolute;
    const pts: number[] = [];
    for (let i = s; i <= e; i++) {
      b.reset();
      const [s0, e0] = lineRange(this.src, i);
      if (!parseFast(bytes, s0, e0, b, () => {})) {
        b.reset();
        try {
          parseSlow(decodeRange(this.src, s0, e0), b, this);
        } catch {
          continue;
        }
      }
      // 윤곽 블록도 소수점 없는 값을 최소 입력 단위로(켰을 때만 — 끄면 세기는 실행할 때 한다)
      if (this.o.integerUnits) this.integerWords(b);
      for (let k = 0; k < b.gCount; k++) {
        const g = b.g[k]!;
        if (g === 0 || g === 10 || g === 20 || g === 30) mot = g;
        else if ((!this.fanucLathe || this.latheSys !== 'A') && (g === 900 || g === 910)) abs = g === 900;
      }
      const hx = b.has[LX] || (this.fanucLathe && b.has[LU]);
      const hz = b.has[LZ] || (this.fanucLathe && b.has[LW]);
      if (!hx && !hz) continue;
      let nx = x;
      let nz = z;
      if (b.has[LX]) nx = abs ? b.val[LX]! * this.axScale[0]! + this.off[0]! : x + b.val[LX]! * this.axScale[0]!;
      else if (this.fanucLathe && b.has[LU]) nx = x + b.val[LU]! * this.axScale[0]!;
      if (b.has[LZ]) nz = abs ? b.val[LZ]! * this.axScale[2]! + this.off[2]! : z + b.val[LZ]! * this.axScale[2]!;
      else if (this.fanucLathe && b.has[LW]) nz = z + b.val[LW]! * this.axScale[2]!;
      if (mot === 20 || mot === 30) {
        // G18: 평면 축 (Z, X)
        const ccw = mot === 30;
        let cu: number;
        let cv: number;
        if (b.has[LR]) {
          const R = b.val[LR]! * this.scale;
          const du = nz - z;
          const dv = nx - x;
          const d = Math.hypot(du, dv);
          const r = Math.max(Math.abs(R), d / 2);
          const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
          const side = (ccw ? 1 : -1) * (R < 0 ? -1 : 1);
          cu = d > 0 ? z + du / 2 - (side * h * dv) / d : z;
          cv = d > 0 ? x + dv / 2 + (side * h * du) / d : x;
        } else {
          cu = z + (b.has[LK] ? b.val[LK]! * this.scale : 0);
          cv = x + (b.has[LI] ? b.val[LI]! * this.scale : 0);
        }
        let sw = Math.atan2(nx - cv, nz - cu) - Math.atan2(x - cv, z - cu);
        if (ccw) while (sw <= 0) sw += Math.PI * 2;
        else while (sw >= 0) sw -= Math.PI * 2;
        const tmp: number[] = [];
        arcPoints([x, 0, z], [nx, 0, nz], [cv, 0, cu], 1, sw, Math.PI / 36, tmp);
        for (let k = 0; k < tmp.length; k += 3) pts.push(tmp[k]!, tmp[k + 2]!);
      } else pts.push(nx, nz);
      x = nx;
      z = nz;
    }
    return pts;
  }

  /**
   * G71(바깥·안지름 거친 깎기, Z 방향 절삭)·G72(단면 거친 깎기, X 방향 절삭)·G73(형상 반복).
   * 첫 블록(G71 U R · G72 W R · G73 U W R)은 절입·물러남을 정하고, P·Q가 있는 블록이 윤곽(다듬질 여유 U·W만큼 옮김)을 따라 깎는다.
   * 끝나면 시작점으로 돌아오고 윤곽 블록 다음 줄부터 이어 읽는다.
   */
  protected roughCycle(code: number, blk: Block, line: number): void {
    const name = `G${code / 10}`;
    if (!blk.has[LP] || !blk.has[LQ]) {
      // 첫 블록
      if (code === 730) {
        this.g73 = [blk.has[LU] ? blk.val[LU]! * this.scale : this.g73[0], blk.has[LW] ? blk.val[LW]! * this.scale : this.g73[1], blk.has[LR] ? Math.max(1, Math.round(blk.val[LR]!)) : this.g73[2]];
      } else {
        const dL = code === 710 ? LU : LW;
        if (blk.has[dL]) this.roughD = Math.abs(blk.val[dL]!) * this.scale;
        if (blk.has[LR]) this.roughE = Math.abs(blk.val[LR]!) * this.scale;
      }
      return;
    }
    const r = this.profileRange(blk, line, name);
    if (!r) return;
    const prof = this.profile(r[0], r[1]);
    if (prof.length < 4) {
      this.w.add(`${name}: 윤곽 점이 모자람`, line);
      return;
    }
    // 다듬질 여유: U는 지름 값(X), W는 Z
    const du = blk.has[LU] ? (blk.val[LU]! * this.scale) / 2 : 0;
    const dw = blk.has[LW] ? blk.val[LW]! * this.scale : 0;
    const sh = prof.map((v, i) => (i % 2 === 0 ? v + du : v + dw));
    const xs = this.pos[0]!;
    const zs = this.pos[2]!;
    const n = sh.length / 2;
    const F = MOVE_FEED;
    const R = MOVE_RAPID;
    const back = (): void => {
      this.lgo(R, xs, this.pos[2]!, line);
      this.lgo(R, xs, zs, line);
    };
    const follow = (ox: number, oz: number): void => {
      this.lgo(R, sh[0]! + ox, sh[1]! + oz, line);
      for (let k = 1; k < n; k++) this.lgo(F, sh[k * 2]! + ox, sh[k * 2 + 1]! + oz, line);
    };
    if (code === 730) {
      const [ri, rk, nd] = this.g73;
      for (let k = 1; k <= nd; k++) {
        const f = nd > 1 ? (nd - k) / (nd - 1) : 0;
        follow(ri * f, rk * f);
        back();
      }
    } else {
      const d = this.roughD;
      const e = this.roughE;
      if (!(d > 0)) {
        this.w.add(`${name}: 절입 깊이(첫 블록 ${code === 710 ? 'U' : 'W'})가 없어 다듬질 윤곽만 그림`, line);
      } else {
        // 단계 축 s(G71 = X, G72 = Z)와 절삭 축 c
        const si = code === 710 ? 0 : 1;
        const ci = 1 - si;
        const start = [xs, zs];
        const sv = start[si]!;
        const cv0 = start[ci]!;
        const A = [sh[0]!, sh[1]!];
        const dir = Math.sign(A[si]! - sv) || -1;
        const at = (sVal: number, cVal: number): [number, number] => (si === 0 ? [sVal, cVal] : [cVal, sVal]);
        for (let k = 1; k < 10000; k++) {
          const lev = sv + dir * k * d;
          if (dir * (lev - A[si]!) >= -1e-9) break;
          // 윤곽과 만나는 절삭 끝
          let cEnd = sh[(n - 1) * 2 + ci]!;
          for (let j = 0; j + 1 < n; j++) {
            const ps = sh[j * 2 + si]!;
            const qs = sh[(j + 1) * 2 + si]!;
            if ((ps - lev) * (qs - lev) <= 0 && ps !== qs) {
              cEnd = sh[j * 2 + ci]! + ((lev - ps) / (qs - ps)) * (sh[(j + 1) * 2 + ci]! - sh[j * 2 + ci]!);
              break;
            }
          }
          const bk = Math.sign(cv0 - cEnd) || 1;
          let p = at(lev, cv0);
          this.lgo(R, p[0], p[1], line);
          p = at(lev, cEnd);
          this.lgo(F, p[0], p[1], line);
          p = at(lev - dir * e, cEnd + bk * e);
          this.lgo(F, p[0], p[1], line);
          p = at(lev - dir * e, cv0);
          this.lgo(R, p[0], p[1], line);
        }
      }
      follow(0, 0);
      back();
    }
    this.known = 7;
    // 윤곽 블록은 건너뛴다(사이클 뒤 Q 블록 다음부터)
    if (r[1] >= line && r[0] > line) this.pc = r[1] + 1;
  }

  /** G74(Z 방향 쪼아 드릴·정면 홈)·G75(X 방향 홈): 첫 블록 R = 물러남, 둘째 블록 X(U) Z(W) P Q */
  protected peckCycle(code: number, blk: Block, line: number): void {
    const hasT = blk.has[LX] || blk.has[LU] || blk.has[LZ] || blk.has[LW];
    if (!hasT) {
      if (blk.has[LR]) this.peckE = Math.abs(blk.val[LR]!) * this.scale;
      return;
    }
    const t = this.targets(blk, false);
    const xs = this.pos[0]!;
    const zs = this.pos[2]!;
    const xt = t[0]!;
    const zt = t[2]!;
    const pD = blk.has[LP] ? this.incVal(blk, LP) : 0;
    const qD = blk.has[LQ] ? this.incVal(blk, LQ) : 0;
    const e = this.peckE;
    // 쪼는 축(G74 = Z, G75 = X)과 옮기는 축
    const zPeck = code === 740;
    const step = zPeck ? qD : pD;
    const shift = zPeck ? pD : qD;
    const s0 = zPeck ? zs : xs;
    const s1 = zPeck ? zt : xt;
    const m0 = zPeck ? xs : zs;
    const m1 = zPeck ? xt : zt;
    const at = (peck: number, move: number): [number, number] => (zPeck ? [move, peck] : [peck, move]);
    const positions: number[] = [];
    if (shift > 0 && Math.abs(m1 - m0) > 1e-9) {
      const dir = Math.sign(m1 - m0);
      for (let v = m0; dir * (v - m1) < 1e-9; v += dir * shift) positions.push(v);
      if (Math.abs(positions[positions.length - 1]! - m1) > 1e-9) positions.push(m1);
    } else positions.push(m1);
    const dir = Math.sign(s1 - s0) || -1;
    for (const mv of positions) {
      let p = at(s0, mv);
      this.lgo(MOVE_RAPID, p[0], p[1], line);
      let d = s0;
      let guard = 0;
      while (dir * (s1 - d) > 1e-9 && guard++ < 10000) {
        const next = step > 0 ? (dir > 0 ? Math.min(s1, d + step) : Math.max(s1, d - step)) : s1;
        p = at(next, mv);
        this.lgo(MOVE_FEED, p[0], p[1], line);
        if (next !== s1 && e > 0) {
          p = at(next - dir * e, mv);
          this.lgo(MOVE_RAPID, p[0], p[1], line);
        }
        d = next;
      }
      p = at(s0, mv);
      this.lgo(MOVE_RAPID, p[0], p[1], line);
    }
    const home = at(s0, m0);
    this.lgo(MOVE_RAPID, home[0], home[1], line);
    this.known = 7;
  }

  /** G76 나사 사이클: 깊이를 나눠 여러 번 깎는다(Fanuc 두 블록 꼴, LinuxCNC P·Z·I·J·K 꼴) */
  protected threadCycle(blk: Block, line: number): void {
    const xs = this.pos[0]!;
    const zs = this.pos[2]!;
    const passes: number[] = [];
    let xt: number;
    let zt: number;
    let taper = 0;
    if (!this.fanucLathe) {
      // LinuxCNC: I = 산 위치(구동선에서, 음수 = 바깥나사), J = 첫 절입, K = 나사 높이, R = 절입 감소 지수
      if (!blk.has[LZ]) {
        this.w.add('G76에 끝 Z가 없음', line);
        return;
      }
      zt = this.target(blk, 2, false);
      const I = blk.has[LI] ? blk.val[LI]! * this.scale : 0;
      const J = blk.has[LJ] ? Math.abs(blk.val[LJ]!) * this.scale : 0;
      const K = blk.has[LK] ? Math.abs(blk.val[LK]!) * this.scale : 0;
      const deg = blk.has[LR] && blk.val[LR]! > 0 ? blk.val[LR]! : 1;
      const sg = I < 0 ? -1 : 1;
      const crest = xs + I;
      for (let n = 1; n < 500 && J > 0; n++) {
        const d = Math.min(K, J * Math.pow(n, 1 / deg));
        passes.push(crest + sg * d);
        if (d >= K) break;
      }
      if (!passes.length) passes.push(crest + sg * K);
      xt = passes[passes.length - 1]!;
    } else {
      const hasT = blk.has[LX] || blk.has[LU] || blk.has[LZ] || blk.has[LW];
      if (!hasT) {
        // 첫 블록: P(다듬질 횟수 m·모따기 r·각 a 두 자리씩) Q(최소 절입) R(다듬질 여유)
        if (blk.has[LP]) this.thread.m = Math.max(1, Math.floor(Math.abs(blk.val[LP]!) / 10000));
        if (blk.has[LQ]) this.thread.dmin = this.incVal(blk, LQ);
        if (blk.has[LR]) this.thread.d = Math.abs(blk.val[LR]!) * this.scale;
        return;
      }
      const t = this.targets(blk, false);
      xt = t[0]!;
      zt = t[2]!;
      taper = blk.has[LR] ? blk.val[LR]! * this.scale : 0;
      const k = blk.has[LP] ? this.incVal(blk, LP) : 0;
      const d1 = blk.has[LQ] ? this.incVal(blk, LQ) : k;
      const sg = xt < xs ? 1 : -1; // 바깥나사면 산(xt + k)에서 안쪽으로
      for (let n = 1; n < 500 && d1 > 0; n++) {
        const d = Math.min(k, Math.max(d1 * Math.sqrt(n), n > 1 ? this.thread.dmin * n : 0));
        passes.push(xt + sg * (k - d));
        if (d >= k) break;
      }
      for (let m = 1; m < this.thread.m; m++) passes.push(xt);
      if (!passes.length) passes.push(xt);
    }
    for (const x of passes) {
      this.lgo(MOVE_RAPID, x + taper, zs, line);
      this.lgo(MOVE_FEED, x, zt, line);
      this.lgo(MOVE_RAPID, xs, zt, line);
      this.lgo(MOVE_RAPID, xs, zs, line);
    }
    this.known = 7;
  }

  // ── 프로그램 흐름 ──
  protected buildOIndex(): Map<number, number> {
    if (this.oIndex) return this.oIndex;
    const map = new Map<number, number>();
    const b = this.src.bytes;
    for (let i = 0; i < this.src.lineCount; i++) {
      const [s, e] = lineRange(this.src, i);
      let k = s;
      while (k < e && (b[k] === 32 || b[k] === 9)) k++;
      const c = b[k];
      if (c !== 79 && c !== 111 && c !== 58) continue;
      k++;
      const d0 = k;
      let n = 0;
      while (k < e && b[k]! >= 48 && b[k]! <= 57) n = n * 10 + (b[k++]! - 48);
      if (k === d0) continue;
      while (k < e && (b[k] === 32 || b[k] === 9)) k++;
      // 뒤에 낱말(sub·call…)이 오면 LinuxCNC o-코드
      const nx = b[k];
      if (k < e && nx !== 40 && nx !== 59 && ((nx! >= 65 && nx! <= 90) || (nx! >= 97 && nx! <= 122))) {
        if (c === 111 || c === 79) {
          const rest = decodeRange(this.src, k, Math.min(e, k + 10)).toUpperCase();
          if (O_KEYWORDS.some((w) => rest.startsWith(w))) continue;
        }
      }
      if (!map.has(n)) map.set(n, i);
    }
    // 함께 연 파일: O 번호 줄이 없으면 파일 이름(O1001.nc·1001.nc)을 프로그램 번호로
    if (this.jobLines)
      for (const [i, name] of this.jobLines) {
        const m = /^O?(\d+)(?:\.[^.]*)?$/i.exec(name.replace(/^.*[\\/]/, ''));
        // 값 = 표지 줄(부르기는 그다음 줄, 곧 파일 첫 줄부터 실행한다 — O 줄과 같은 꼴)
        if (m && !map.has(+m[1]!)) map.set(+m[1]!, i);
      }
    return (this.oIndex = map);
  }

  protected buildNIndex(): Map<number, number[]> {
    if (this.nIndex) return this.nIndex;
    const map = new Map<number, number[]>();
    const b = this.src.bytes;
    for (let i = 0; i < this.src.lineCount; i++) {
      const [s, e] = lineRange(this.src, i);
      let k = s;
      while (k < e && (b[k] === 32 || b[k] === 9 || b[k] === 47)) k++;
      if (b[k] !== 78 && b[k] !== 110) continue;
      k++;
      while (k < e && b[k] === 32) k++;
      const d0 = k;
      let n = 0;
      while (k < e && b[k]! >= 48 && b[k]! <= 57) n = n * 10 + (b[k++]! - 48);
      if (k === d0) continue;
      const list = map.get(n);
      if (list) list.push(i);
      else map.set(n, [i]);
    }
    return (this.nIndex = map);
  }

  protected findN(n: number): number {
    const list = this.buildNIndex().get(n);
    if (!list) return -1;
    const start = this.stack[this.stack.length - 1]!.start;
    for (const l of list) if (l >= start) return l;
    return list[0]!;
  }

  protected buildOCodes(): Map<string, { line: number; kw: string }[]> {
    if (this.oCodes) return this.oCodes;
    const map = new Map<string, { line: number; kw: string }[]>();
    const b = this.src.bytes;
    for (let i = 0; i < this.src.lineCount; i++) {
      const [s, e] = lineRange(this.src, i);
      let k = s;
      while (k < e && (b[k] === 32 || b[k] === 9)) k++;
      if (b[k] !== 79 && b[k] !== 111) continue;
      const code = splitComments(decodeRange(this.src, k, e), null);
      const m = /^O(\d+|<[^>]*>)([A-Z]+)/.exec(code);
      if (!m) continue;
      const kw = O_KEYWORDS.find((w) => m[2]!.startsWith(w));
      if (!kw) continue;
      const label = m[1]!.startsWith('<') ? m[1]!.slice(1, -1).toLowerCase() : String(parseInt(m[1]!, 10));
      const list = map.get(label);
      if (list) list.push({ line: i, kw });
      else map.set(label, [{ line: i, kw }]);
    }
    return (this.oCodes = map);
  }

  /** label의 kws 중 line 뒤에 처음 나오는 것 */
  protected nextO(label: string, line: number, kws: string[]): { line: number; kw: string } | undefined {
    const list = this.buildOCodes().get(label);
    if (!list) return undefined;
    return list.find((x) => x.line > line && kws.includes(x.kw));
  }
  protected prevO(label: string, line: number, kws: string[]): { line: number; kw: string } | undefined {
    const list = this.buildOCodes().get(label);
    if (!list) return undefined;
    let r: { line: number; kw: string } | undefined;
    for (const x of list) if (x.line < line && kws.includes(x.kw)) r = x;
    return r;
  }

  protected control(c: Ctrl, line: number): void {
    switch (c.k) {
      case 'goto': {
        const t = this.findN(c.n);
        if (t < 0) {
          this.w.add(`GOTO ${c.n}: N${c.n} 블록이 없음 — 멈춤`, line);
          this.ended = true;
        } else this.pc = t;
        return;
      }
      case 'while': {
        if (c.ok) {
          const top = this.loops[this.loops.length - 1];
          if (!top || top.m !== c.m || top.line !== line) this.loops.push({ m: c.m, line });
          return;
        }
        while (this.loops.length && this.loops[this.loops.length - 1]!.m !== c.m) this.loops.pop();
        if (this.loops.length) this.loops.pop();
        const end = this.findEnd(c.m, line);
        if (end < 0) {
          this.w.add(`WHILE … DO${c.m}에 맞는 END${c.m}이 없음 — 멈춤`, line);
          this.ended = true;
        } else this.pc = end + 1;
        return;
      }
      case 'do':
        this.loops.push({ m: c.m, line: line + 1 });
        return;
      case 'end': {
        // WHILE은 조건 줄로, DO 단독(끝없는 반복)은 몸통 첫 줄로 돌아간다
        for (let i = this.loops.length - 1; i >= 0; i--)
          if (this.loops[i]!.m === c.m) {
            this.loops.length = i + 1;
            this.pc = this.loops[i]!.line;
            return;
          }
        this.w.add(`END${c.m}에 맞는 WHILE·DO가 없음`, line);
        return;
      }
      case 'o':
        return this.oControl(c, line);
    }
  }

  /** line 뒤에서 END m 줄을 찾는다 */
  protected findEnd(m: number, line: number): number {
    const re = new RegExp(`(^|[^A-Z])END${m}(?![0-9])`);
    for (let i = line + 1; i < this.src.lineCount; i++) {
      const t = sourceLine(this.src, i);
      if (!/end/i.test(t)) continue;
      if (re.test(splitComments(t, null))) return i;
    }
    return -1;
  }

  protected oControl(c: Extract<Ctrl, { k: 'o' }>, line: number): void {
    const { label, kw } = c;
    const jumpPast = (kws: string[]): void => {
      const t = this.nextO(label, line, kws);
      if (!t) {
        this.w.add(`o${label}: 짝이 되는 ${kws.join('/').toLowerCase()}이 없음 — 멈춤`, line);
        this.ended = true;
      } else this.pc = t.line + 1;
    };
    const jumpTo = (kws: string[]): void => {
      const t = this.nextO(label, line, kws);
      if (!t) {
        this.w.add(`o${label}: 짝이 되는 ${kws.join('/').toLowerCase()}이 없음 — 멈춤`, line);
        this.ended = true;
      } else this.pc = t.line;
    };
    switch (kw) {
      case 'SUB':
        // 정의는 건너뛴다(부를 때만 들어간다)
        return jumpPast(['ENDSUB']);
      case 'ENDSUB':
      case 'RETURN': {
        if (c.val !== undefined) this.namedGlobals.set('_value', c.val);
        const f = this.stack[this.stack.length - 1]!;
        if (f.kind === 'ocall') {
          this.stack.pop();
          this.pc = f.ret;
        }
        return;
      }
      case 'CALL': {
        const def = this.buildOCodes()
          .get(label)
          ?.find((x) => x.kw === 'SUB');
        if (!def) {
          this.missingProgram(`o<${label}>`, `o${label} call: sub 정의를 찾지 못함 — 다른 파일이면 함께 열어야 읽음`, line);
          return;
        }
        if (this.stack.length >= MAX_CALL_DEPTH) {
          this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
          this.ended = true;
          return;
        }
        const locals = new Map<number, number>();
        c.args.forEach((v, i) => locals.set(i + 1, v));
        this.stack.push({ kind: 'ocall', ret: line + 1, start: def.line, reps: 1, locals, named: new Map(), label });
        this.pc = def.line + 1;
        return;
      }
      case 'IF':
        if (c.val) this.ifTaken.set(label, true);
        else {
          this.ifTaken.set(label, false);
          jumpTo(['ELSEIF', 'ELSE', 'ENDIF']);
        }
        return;
      case 'ELSEIF':
        if (this.ifTaken.get(label)) return jumpTo(['ENDIF']);
        if (c.val) this.ifTaken.set(label, true);
        else jumpTo(['ELSEIF', 'ELSE', 'ENDIF']);
        return;
      case 'ELSE':
        if (this.ifTaken.get(label)) return jumpTo(['ENDIF']);
        this.ifTaken.set(label, true);
        return;
      case 'ENDIF':
        this.ifTaken.delete(label);
        return;
      case 'DO':
        return;
      case 'WHILE': {
        // do … while(끝)인지 while … endwhile(처음)인지
        const doLine = this.prevO(label, line, ['DO']);
        const endW = this.nextO(label, line, ['ENDWHILE']);
        if (doLine && !endW) {
          if (c.val) this.pc = doLine.line + 1;
          return;
        }
        if (!c.val) jumpPast(['ENDWHILE']);
        return;
      }
      case 'ENDWHILE': {
        const w = this.prevO(label, line, ['WHILE']);
        if (w) this.pc = w.line;
        return;
      }
      case 'REPEAT': {
        const n = Math.round(c.val ?? 0);
        if (n <= 0) return jumpPast(['ENDREPEAT']);
        this.repeatLeft.set(label, n);
        return;
      }
      case 'ENDREPEAT': {
        const left = (this.repeatLeft.get(label) ?? 1) - 1;
        if (left > 0) {
          this.repeatLeft.set(label, left);
          const r = this.prevO(label, line, ['REPEAT']);
          if (r) this.pc = r.line + 1;
        } else this.repeatLeft.delete(label);
        return;
      }
      case 'BREAK': {
        const t = this.nextO(label, line, ['ENDWHILE', 'ENDREPEAT', 'WHILE']);
        if (t) this.pc = t.line + 1;
        this.repeatLeft.delete(label);
        return;
      }
      case 'CONTINUE': {
        // 반복 끝 줄(endwhile·endrepeat·do-while의 while)로 가서 다음 차례를 정한다
        const t = this.nextO(label, line, ['ENDWHILE', 'ENDREPEAT', 'WHILE']);
        if (t) this.pc = t.line;
        return;
      }
    }
  }

  protected m98(blk: Block, line: number): void {
    if (!blk.has[LP]) {
      this.w.add('M98에 P(프로그램 번호)가 없음', line);
      return;
    }
    let prog = Math.round(blk.val[LP]!);
    let reps = blk.has[LL] ? Math.round(blk.val[LL]!) : blk.has[LK] ? Math.round(blk.val[LK]!) : 1;
    const idx = this.buildOIndex();
    if (!idx.has(prog) && prog > 9999 && !blk.has[LL] && !blk.has[LK]) {
      reps = Math.floor(prog / 10000);
      prog = prog % 10000;
    }
    const start = idx.get(prog);
    if (start === undefined) {
      this.missingProgram(`O${prog}`, `M98 P${prog}: O${prog}를 찾지 못함 — 다른 파일이면 함께 열어야 읽음`, line);
      return;
    }
    if (reps <= 0) return;
    if (this.stack.length >= MAX_CALL_DEPTH) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    const f = this.stack[this.stack.length - 1]!;
    this.stack.push({ kind: 'm98', ret: line + 1, start: start + 1, reps, locals: f.locals, named: f.named });
    this.pc = start + 1;
  }

  protected m97(blk: Block, line: number): void {
    const n = blk.has[LP] ? Math.round(blk.val[LP]!) : -1;
    const t = n >= 0 ? this.findN(n) : -1;
    if (t < 0) {
      this.w.add(`M97 P${n}: N${n} 블록이 없음`, line);
      return;
    }
    const f = this.stack[this.stack.length - 1]!;
    const reps = blk.has[LL] ? Math.round(blk.val[LL]!) : 1;
    this.stack.push({ kind: 'm97', ret: line + 1, start: t, reps, locals: f.locals, named: f.named });
    this.pc = t;
  }

  protected m99(blk: Block, line: number): void {
    const f = this.stack[this.stack.length - 1]!;
    if (f.kind === 'main') {
      if (this.started) this.w.add('주 프로그램의 M99(처음부터 반복) — 한 번만 그림', line);
      this.ended = true;
      return;
    }
    if (f.reps > 1) {
      f.reps--;
      this.pc = f.start;
      return;
    }
    this.stack.pop();
    this.pc = f.ret;
    if (blk.has[LP]) {
      const t = this.findN(Math.round(blk.val[LP]!));
      if (t >= 0) this.pc = t;
    }
  }

  /** G65 P… A… B…: 매크로 호출(인수 → 지역 변수) */
  protected macroCall(blk: Block, line: number): void {
    if (!blk.has[LP]) {
      this.w.add('G65에 P가 없음', line);
      return;
    }
    const prog = Math.round(blk.val[LP]!);
    const start = this.buildOIndex().get(prog);
    if (start === undefined) {
      // O9000번대는 대개 기계에 든 매크로(프로브·공구 측정 등)
      this.missingProgram(
        `O${prog}`,
        prog >= 9000 && prog <= 9999 ? `G65 P${prog}: O${prog}를 찾지 못해 건너뜀 — 기계에 든 매크로(O9000번대)로 보임, 파일이 있으면 함께 열어야 읽음` : `G65 P${prog}: O${prog}를 찾지 못함 — 다른 파일이면 함께 열어야 읽음`,
        line,
      );
      return;
    }
    if (this.stack.length >= MAX_CALL_DEPTH) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    // 인수 지정 I: A=1 B=2 C=3 I=4 J=5 K=6 D=7 E=8 F=9 H=11 M=13 Q=17 R=18 S=19 T=20 U=21 V=22 W=23 X=24 Y=25 Z=26
    const map: Record<number, number> = { 0: 1, 1: 2, 2: 3, 8: 4, 9: 5, 10: 6, 3: 7, 4: 8, 5: 9, 7: 11, 12: 13, 16: 17, 17: 18, 18: 19, 19: 20, 20: 21, 21: 22, 22: 23, 23: 24, 24: 25, 25: 26 };
    const locals = new Map<number, number>();
    for (const [l, v] of Object.entries(map)) if (blk.has[+l] && +l !== LP && +l !== LL) locals.set(v, blk.val[+l]!);
    const reps = blk.has[LL] ? Math.round(blk.val[LL]!) : 1;
    this.stack.push({ kind: 'g65', ret: line + 1, start: start + 1, reps, locals, named: new Map() });
    this.pc = start + 1;
  }

  finish(opts: GcodeOptions): NcProgram {
    if (this.nurbs) this.nurbsFallback('G5.3 없이 프로그램이 끝남', this.nurbs.lines[this.nurbs.lines.length - 1]!);
    if (this.stack.length > 1 && !this.hitLimit && !this.ended) this.w.add('부프로그램 안에서 프로그램이 끝남(M99 없음)');
    // 소수점 없는 큰 좌표가 절반 넘으면 최소 입력 단위(0.001)로 쓴 프로그램일 수 있다고 알린다
    if (!opts.integerUnits && (this.dialect === 'fanuc' || this.dialect === 'iso' || this.dialect === 'haas') && this.intBig >= 3 && this.intBig * 2 >= this.axisWords) {
      this.w.add(`소수점 없는 큰 좌표가 많음(${this.intBig}개) — Fanuc 최소 입력 단위(0.001)로 쓴 프로그램이면 "소수점 없는 값 = 최소 단위"를 켜십시오`);
      this.notices.push({ kind: 'integer-units' });
    }
    const prog = this.build({ name: opts.name ?? (this.name || 'G-code'), format: 'gcode', dialect: this.dialect, blocks: Math.min(this.blocks, this.maxBlocks) });
    if (this.fanucLathe) prog.latheSystem = this.latheSys;
    return prog;
  }
}

/** 낱말 값을 경고 글로(소수 6자리까지) */
function fmtWord(v: number): string {
  return String(Math.round(v * 1e6) / 1e6);
}

/** LinuxCNC G5.2 매듭(열린 균일): 조정점 n+1개·계수 k → 앞 k개는 0, 사이는 1씩, 뒤 k개는 n-k+2 */
export function nurbsKnots(n: number, k: number): number[] {
  const t: number[] = [];
  for (let i = 0; i <= n + k; i++) t.push(i < k ? 0 : i <= n ? i - k + 1 : n - k + 2);
  return t;
}

/**
 * NURBS 곡선(조정점 xs·ys, 가중치 ws, 계수 order = 차수 + 1, 매듭은 nurbsKnots)을 직선 조각으로 나눈다.
 * 매듭 구간마다 조각의 1/4·1/2·3/4 점이 현에서 tol보다 멀면 반으로 나눈다(12번까지 — 4차 이상은 한 번은 나눔).
 * emit(x, y, k, u): 조각 끝점과 그 조각 가운데에 가장 가까운 그레빌 점의 조정점 번호(줄 번호를 고르는 데 쓴다 — 같으면 뒤 점), 조각 끝 매개변수(측정용 곡선 정의).
 * 마지막 끝점은 마지막 조정점 그대로
 */
export function nurbsSegments(xs: readonly number[], ys: readonly number[], ws: readonly number[], order: number, tol: number, emit: (x: number, y: number, k: number, u: number) => void): void {
  const n = xs.length - 1;
  const p = order - 1;
  if (n < 1 || p < 1 || n < p) return;
  const knots = nurbsKnots(n, order);
  const grev: number[] = [];
  for (let i = 0; i <= n; i++) {
    let s = 0;
    for (let j = 1; j <= p; j++) s += knots[i + j]!;
    grev.push(s / p);
  }
  const dx = new Float64Array(order);
  const dy = new Float64Array(order);
  const dw = new Float64Array(order);
  // 구간 s(knots[s] ≤ u ≤ knots[s+1]) 위의 점 — 동차 좌표의 de Boor
  const at = (s: number, u: number, out: number[]): void => {
    for (let j = 0; j <= p; j++) {
      const i = s - p + j;
      const w = ws[i]!;
      dx[j] = xs[i]! * w;
      dy[j] = ys[i]! * w;
      dw[j] = w;
    }
    for (let r = 1; r <= p; r++)
      for (let j = p; j >= r; j--) {
        const t0 = knots[j + s - p]!;
        const t1 = knots[j + 1 + s - r]!;
        const a = t1 > t0 ? (u - t0) / (t1 - t0) : 0;
        dx[j] = (1 - a) * dx[j - 1]! + a * dx[j]!;
        dy[j] = (1 - a) * dy[j - 1]! + a * dy[j]!;
        dw[j] = (1 - a) * dw[j - 1]! + a * dw[j]!;
      }
    out[0] = dx[p]! / dw[p]!;
    out[1] = dy[p]! / dw[p]!;
  };
  const tol2 = tol * tol;
  const q = [0, 0];
  // 점 q와 선분 a-b 사이 거리의 제곱
  const off2 = (ax: number, ay: number, bx: number, by: number): number => {
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy;
    let t = l2 > 0 ? ((q[0]! - ax) * vx + (q[1]! - ay) * vy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + vx * t - q[0]!;
    const ey = ay + vy * t - q[1]!;
    return ex * ex + ey * ey;
  };
  let gi = 0;
  const minDepth = p >= 4 ? 1 : 0;
  const last = knots[n + 1]!;
  const piece = (s: number, a: number, ax: number, ay: number, b: number, bx: number, by: number, depth: number): void => {
    let worst = 0;
    let mx = 0;
    let my = 0;
    for (const f of [0.5, 0.25, 0.75]) {
      at(s, a + (b - a) * f, q);
      if (f === 0.5) {
        mx = q[0]!;
        my = q[1]!;
      }
      worst = Math.max(worst, off2(ax, ay, bx, by));
    }
    if (depth < 12 && (depth < minDepth || worst > tol2)) {
      const m = (a + b) / 2;
      piece(s, a, ax, ay, m, mx, my, depth + 1);
      piece(s, m, mx, my, b, bx, by, depth + 1);
      return;
    }
    const mid = (a + b) / 2;
    while (gi < n && Math.abs(grev[gi + 1]! - mid) <= Math.abs(grev[gi]! - mid)) gi++;
    emit(bx, by, gi, b);
  };
  const pa = [xs[0]!, ys[0]!];
  const pb = [0, 0];
  for (let s = p; s <= n; s++) {
    const u0 = knots[s]!;
    const u1 = knots[s + 1]!;
    if (!(u1 > u0)) continue;
    if (u1 >= last) {
      pb[0] = xs[n]!;
      pb[1] = ys[n]!;
    } else at(s, u1, pb);
    piece(s, u0, pa[0]!, pa[1]!, u1, pb[0]!, pb[1]!, 0);
    pa[0] = pb[0]!;
    pa[1] = pb[1]!;
  }
}

function wcsName(idx: number): string {
  if (idx < 0) return 'G54';
  return idx <= 5 ? `G${54 + idx}` : `G54.1 P${idx - 5}`;
}

function wcsIndexFromName(k: string): number {
  const s = k.toUpperCase().replace(/\s+/g, '');
  let m = /^G5([4-9])$/.exec(s);
  if (m) return +m[1]! - 4;
  m = /^G54\.1P(\d+)$/.exec(s);
  if (m) return 5 + +m[1]!;
  return -1;
}

/** 원본 글 앞부분(판별용) */
function headText(src: NcSource): string {
  const n = Math.min(src.bytes.length, 256 * 1024);
  return decodeRange(src, 0, n);
}

/**
 * G-code를 해석한다. input은 바이트(권장 — 큰 파일)나 글.
 * Heidenhain 평문이면 parseHeidenhain을 쓴다(parseNc가 골라 준다).
 */
export function parseGcode(input: Uint8Array | ArrayBuffer | string | NcSource, opts: GcodeOptions = {}): NcProgram {
  const src = isSource(input) ? input : makeSource(input);
  let head: string | undefined;
  const getHead = (): string => (head ??= headText(src));
  let dialect = opts.dialect && opts.dialect !== 'auto' ? opts.dialect : detectGcodeDialect(getHead());
  if (dialect === 'heidenhain') dialect = 'iso';
  const special = DIALECT_PARSERS[dialect];
  if (special) {
    const p = special(src, opts, getHead);
    // 글로 판별해 따로 된 해석기(Siemens)로 읽었으면 알린다
    if (!opts.dialect || opts.dialect === 'auto') (p.notices ??= []).unshift({ kind: 'dialect', dialect });
    return p;
  }
  if (dialect === 'siemens') {
    // Siemens 해석기(siemens.ts)를 불러오지 않은 채 부르면 ISO로 읽고 알린다
    const r = new Runner(src, opts, 'iso', getHead);
    r.run();
    const p = r.finish(opts);
    p.warnings.unshift('Siemens 해석기를 불러오지 않아 ISO로 읽음');
    p.warningItems?.unshift({ text: 'Siemens 해석기를 불러오지 않아 ISO로 읽음', line: -1, count: 1, lines: [] });
    return p;
  }
  const r = new Runner(src, opts, dialect, getHead);
  r.run();
  const p = r.finish(opts);
  // Haas로 판별했으면 알린다(G73·G83의 K = 최소 절입, G70~G72 = 볼트 구멍 패턴처럼 뜻이 바뀌는 코드가 있다)
  if (dialect === 'haas' && (!opts.dialect || opts.dialect === 'auto')) (p.notices ??= []).unshift({ kind: 'dialect', dialect });
  return p;
}

/** 따로 된 방언 해석기(siemens.ts가 등록한다 — gcode.ts가 그것을 불러오면 순환 참조가 되므로) */
const DIALECT_PARSERS: Partial<Record<NcDialect, (src: NcSource, opts: GcodeOptions, head: () => string) => NcProgram>> = {};
export function registerDialectParser(d: NcDialect, fn: (src: NcSource, opts: GcodeOptions, head: () => string) => NcProgram): void {
  DIALECT_PARSERS[d] = fn;
}

export function isSource(x: unknown): x is NcSource {
  return !!x && typeof x === 'object' && 'lineStart' in x && 'bytes' in x;
}

export { headText };
