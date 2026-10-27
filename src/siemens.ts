/**
 * Siemens Sinumerik(840D sl·828D 꼴) 프로그램 해석기.
 *
 * 이동·원호·좌표 변환·반경 보정·기계 좌표 규칙은 gcode.ts의 Runner를 그대로 쓰고, 블록 읽기·식·흐름·사이클·프레임만 Siemens 꼴로 읽는다.
 *
 * 지원: `;` 주석, N 번호·표지(LABEL:), 주소 = 식(X=R1*2), 축별 AC(…)/IC(…), 원호 CR=(음수 = 180도 넘음)·I/J/K(I=AC(…) 절대 중심)·
 * AR=(여는 각)·CIP(중간점 I1/J1/K1)·TURN=(나선 바퀴), 극좌표 G110/G111/G112 + AP=·RP=, 공구 T="이름"·T번호·D·M6,
 * R 매개변수(R1·R[식])·DEF REAL/INT/BOOL 변수·PROC 매개변수, 식(+ - * / DIV MOD, 비교, AND/OR/NOT, SIN·COS·TAN·ASIN·ACOS·ATAN2·SQRT·
 * POT·ABS·TRUNC·ROUND·ROUNDUP·MIN·MAX·LN·EXP), 흐름(IF … GOTOF/GOTOB/GOTO/GOTOC, IF/ELSE/ENDIF, WHILE/ENDWHILE, FOR/ENDFOR,
 * REPEAT/UNTIL, LOOP/ENDLOOP, REPEAT 표지 [표지] P=n), 부프로그램(L123 P3, 이름, 이름(인수), CALL "이름", MCALL 이름 — 같은 글의
 * PROC·%_N_이름_SPF 머리나 함께 연 파일), RET·M17, 드릴 사이클 CYCLE81~89·CYCLE840(모달 MCALL 포함)과 HOLES1·HOLES2 점 패턴,
 * 프레임 TRANS·ATRANS·ROT·AROT(RPL·X·Y·Z)·SCALE·ASCALE·MIRROR·AMIRROR·G58·G59, 작업 좌표계 G54~G57·G505~G599,
 * 기계 좌표 쪽 이동 SUPA·G53·G153·G74·G75(위치를 모르면 안전 높이 규칙), 단위 G70/G71/G700/G710, G4 F(초)·S(회전).
 * CT(접선 원호, 모달)는 앞 요소에 접하는 원호로, RND·RNDM·CHF·CHR은 앞뒤가 직선인 모서리를 다듬는다(원호와 만나면 그대로, 경고).
 * 그리지 않는 것(경고): CYCLE800(기울인 평면), 밀링·선반 사이클(POCKET·SLOT·CYCLE95 등),
 * 시스템 변수($…), 배열·문자열 변수.
 */
import { ExprError } from './expr';
import { Block, Runner, ZERO3, affine, composeAffine, diagAbout, registerDialectParser, rotAbout, type Affine, type GcodeOptions } from './gcode';
import { JOB_FILE_MARK, MOVE_ARC, MOVE_FEED, PLANE_AXES, type NcProgram } from './model';
import { sourceLine, type NcSource } from './text';

const DEG = Math.PI / 180;
const LET = (c: string): number => c.charCodeAt(0) - 65;
const AX = ['X', 'Y', 'Z'];
const CENTER = ['I', 'J', 'K'];

/** 무시해도 되는 낱말(가공 모양에 영향 없는 모드·제어) */
const IGNORE_WORDS = new Set([
  'SOFT', 'BRISK', 'DRIVE', 'CFC', 'CFTCP', 'CFIN', 'FFWON', 'FFWOF', 'COMPON', 'COMPOF', 'COMPCURV', 'COMPCAD', 'UPATH', 'SPATH',
  'BTAN', 'BSPLINE', 'POLY', 'ASPLINE', 'CSPLINE', 'G642', 'TRAORI', 'TRAFOOF', 'ORIWKS', 'ORIMKS', 'ORIAXES', 'ORIVECT', 'CUT2D', 'CUT3DC',
  'CUT2DF', 'CDON', 'CDOF', 'CDOF2', 'DISKUL', 'DISKUM', 'DITS', 'DITE', 'STOPRE', 'SPCON', 'SPCOF', 'SETMS', 'ACN', 'ACP', 'DC', 'FGROUP',
  'FNORM', 'FLIN', 'FCUB', 'OFFN', 'KONT', 'KONTC', 'KONTT', 'NORM', 'DIAMOF', 'DIAMON', 'DIAM90', 'DIAMCYCOF', 'PTP', 'CP', 'TCARR', 'TCOABS',
  'TCOFR', 'PAROT', 'PAROTOF', 'TOROT', 'TOROTOF', 'TOFRAME', 'TOROTZ', 'WALIMON', 'WALIMOF', 'SBLOF', 'SBLON', 'DISPLOF', 'DISPLON',
  'SUPD', 'ORIC', 'ORID', 'ORIS', 'FENDNORM', 'CTOL', 'OTOL', 'ATOL', 'SPOF', 'SPON', 'GWPSON', 'GWPSOF', 'DRFOF', 'SETPIECE',
]);
/** 무시하는 주소(값을 읽고 버린다) */
const IGNORE_ADDR = new Set(['SPOS', 'SPOSA', 'OFFN', 'ACC', 'FA', 'FL', 'SF', 'H', 'E', 'Q', 'U', 'V', 'W', 'O', 'SPI', 'OVR', 'SCC', 'LIMS', 'CTOL', 'OTOL', 'ATOL', 'ADIS', 'ADISPOS', 'FFWON', 'FFWOF', 'DITS', 'DITE', 'DISCL', 'DISR', 'DISRP', 'FAD', 'PM', 'PR', 'LF', 'DIAMCYCOF']);
/** 지원하지 않는 사이클(그리지 않음) */
const UNSUPPORTED_CYCLE = /^(?:POCKET\d|SLOT\d|LONGHOLE|CYCLE7\d|CYCLE9\d|CYCLE6\d+|CYCLE899|CYCLE952|CYCLE930|CYCLE940|CYCLE951|CYCLE99|CYCLE98|CYCLE97|CYCLE96|CYCLE95|CYCLE92|CYCLE90|CYCLE802|CYCLE801|CYCLE90\d?|E_\w+|F_\w+)$/;

type Word = { name: string; value?: number; str?: string; mode?: 'AC' | 'IC' };

/** 줄 글을 주석과 코드로(따옴표 밖 ;부터 주석, 코드는 따옴표 밖만 대문자) */
function splitLine(raw: string): { code: string; comment: string } {
  let q = false;
  let code = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '"') q = !q;
    if (c === ';' && !q) return { code, comment: raw.slice(i + 1).trim() };
    code += q ? c : c.toUpperCase();
  }
  return { code, comment: '' };
}

/** 식·낱말 읽기 */
class Scan {
  i = 0;
  constructor(readonly s: string) {}
  ws(): void {
    while (this.i < this.s.length && (this.s[this.i] === ' ' || this.s[this.i] === '\t' || this.s[this.i] === '\r')) this.i++;
  }
  end(): boolean {
    this.ws();
    return this.i >= this.s.length;
  }
  peek(): string {
    this.ws();
    return this.s[this.i] ?? '';
  }
  eat(t: string): boolean {
    this.ws();
    if (this.s.startsWith(t, this.i)) {
      this.i += t.length;
      return true;
    }
    return false;
  }
  /** 낱말(뒤에 글자·숫자가 이어지지 않을 때만) */
  eatWord(w: string): boolean {
    this.ws();
    if (this.s.startsWith(w, this.i) && !/[A-Z0-9_]/.test(this.s[this.i + w.length] ?? '')) {
      this.i += w.length;
      return true;
    }
    return false;
  }
  ident(): string {
    this.ws();
    const m = /^[A-Z_$][A-Z0-9_]*/.exec(this.s.slice(this.i));
    if (!m) return '';
    this.i += m[0].length;
    return m[0];
  }
  number(): number | undefined {
    this.ws();
    const m = /^[-+]?\s*(?:\d+\.?\d*|\.\d+)/.exec(this.s.slice(this.i));
    if (!m) return undefined;
    this.i += m[0].length;
    return parseFloat(m[0].replace(/\s+/g, ''));
  }
  str(): string | undefined {
    this.ws();
    if (this.s[this.i] !== '"') return undefined;
    const e = this.s.indexOf('"', this.i + 1);
    if (e < 0) throw new ExprError('" 없음');
    const v = this.s.slice(this.i + 1, e);
    this.i = e + 1;
    return v;
  }
  rest(): string {
    return this.s.slice(this.i).trim();
  }
}

interface SFrame {
  kind: 'sub' | 'rep';
  ret: number;
  start: number;
  /** 구간 반복의 끝 줄 */
  end?: number;
  reps: number;
  locals: Map<string, number> | null;
  /** 모달 호출(MCALL)로 들어왔으면 true(안에서 다시 부르지 않는다) */
  modal?: boolean;
}

interface Section {
  name: string;
  /** 머리 줄(본문은 다음 줄부터) */
  line: number;
  params: string[];
}

type ModalCall = { kind: 'cycle'; name: string; args: (number | undefined)[] } | { kind: 'sub'; name: string } | null;

class SiemensRunner extends Runner {
  private sBlk = new Block();
  private r = new Map<number, number>();
  private vars = new Map<string, number>();
  private sStack: SFrame[] = [];
  private sections = new Map<string, Section>();
  private sectionLines = new Map<number, Section>();
  private mainHeader = -1;
  /** 앞 머리에 이어진 머리 줄(같은 프로그램의 시작 — 지나가도 프로그램 끝이 아니다) */
  private chainedHeads = new Set<number>();
  private labels = new Map<string, number[]>();
  private nLines = new Map<number, number[]>();
  private kwAt: (string | undefined)[] = [];
  private forActive = new Set<number>();
  private modalCall: ModalCall = null;
  private sMotion = 0;
  private sCip = false;
  /** CT(접선 원호) — G 그룹 1처럼 모달(G0~G3·CIP가 끔) */
  private sCt = false;
  /** RNDM(모달 둥글리기 반지름, 0 = 끔) */
  private sRndm = 0;
  private pole = [0, 0];
  private ap = 0;
  private rp = 0;
  private frame: Affine | null = null;
  private toolByName = new Map<string, number>();
  private warnedWord = new Set<string>();

  constructor(src: NcSource, opts: GcodeOptions, head: () => string) {
    super(src, opts, 'siemens', head);
  }

  // ───────────────────────── 색인 ─────────────────────────

  private index(): void {
    const n = this.src.lineCount;
    this.kwAt = new Array(n);
    let firstCode = -1;
    // 본문이 아직 없는 머리(함께 연 파일 표지 → %_N_…_SPF → PROC처럼 이어지면 마지막 머리가 본문 시작)
    let pending: Section | null = null;
    for (let i = 0; i < n; i++) {
      const raw = sourceLine(this.src, i);
      const { code, comment } = splitLine(raw);
      let sec: Section | null = null;
      const t = code.trim();
      let m: RegExpExecArray | null;
      if ((m = /^%_N_(\w+?)_(?:MPF|SPF)\b/.exec(t))) sec = { name: m[1]!, line: i, params: [] };
      else if ((m = /^(?:N\d+\s+)?PROC\s+([A-Z_][A-Z0-9_]*)\s*(?:\(([^)]*)\))?/.exec(t)))
        sec = { name: m[1]!, line: i, params: (m[2] ?? '').split(',').map((p) => (/([A-Z_][A-Z0-9_]*)\s*(?:\[[^\]]*\])?\s*$/.exec(p.trim().replace(/^VAR\s+/, ''))?.[1] ?? '')).filter(Boolean) };
      else if (!t && comment.startsWith(JOB_FILE_MARK)) {
        const name = comment.slice(JOB_FILE_MARK.length).trim().replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').toUpperCase();
        sec = { name, line: i, params: [] };
      }
      if (sec) {
        this.sectionLines.set(i, sec);
        // 머리 바로 뒤의 머리(파일 표지 뒤 %_N_…_SPF, 그 뒤 PROC): 앞 머리 이름으로 불러도 뒤 머리(인수 포함) 다음부터
        if (pending) {
          for (const [k, v] of this.sections) if (v === pending) this.sections.set(k, sec);
          this.chainedHeads.add(i);
        }
        if (!this.sections.has(sec.name)) this.sections.set(sec.name, sec);
        pending = sec;
        if (firstCode < 0) {
          firstCode = i;
          this.mainHeader = i;
        }
        continue;
      }
      if (!t) continue;
      if (t !== '%') pending = null;
      if (firstCode < 0 && t !== '%') firstCode = i;
      let s = t.replace(/^\/\d?\s*/, '');
      if ((m = /^N(\d+)\s*/.exec(s))) {
        const list = this.nLines.get(+m[1]!);
        if (list) list.push(i);
        else this.nLines.set(+m[1]!, [i]);
        s = s.slice(m[0].length);
      }
      if ((m = /^([A-Z_][A-Z0-9_]*)\s*:(?!=)\s*/.exec(s))) {
        const list = this.labels.get(m[1]!);
        if (list) list.push(i);
        else this.labels.set(m[1]!, [i]);
        s = s.slice(m[0].length);
      }
      const kw = /^[A-Z_]+/.exec(s)?.[0];
      if (kw === 'IF') {
        if (!/\bGOTO[FBC]?\b/.test(s)) this.kwAt[i] = 'IF';
      } else if (kw === 'REPEAT') {
        // "REPEAT 표지 …"는 구간 반복, 홀로 쓴 REPEAT는 UNTIL까지의 반복
        if (!/^REPEAT\s+[A-Z_]/.test(s)) this.kwAt[i] = 'REPEAT';
      } else if (kw && ['ELSE', 'ENDIF', 'WHILE', 'ENDWHILE', 'FOR', 'ENDFOR', 'UNTIL', 'LOOP', 'ENDLOOP'].includes(kw)) this.kwAt[i] = kw;
    }
  }

  /** open/close 짝: line 뒤에서 같은 깊이의 close(또는 mid) 줄 */
  private matchForward(line: number, open: string, close: string[], mid: string[] = []): number {
    let depth = 0;
    for (let i = line + 1; i < this.src.lineCount; i++) {
      const k = this.kwAt[i];
      if (!k) continue;
      if (k === open) depth++;
      else if (close.includes(k) || mid.includes(k)) {
        if (depth === 0) return i;
        if (close.includes(k)) depth--;
      }
    }
    return -1;
  }
  private matchBackward(line: number, open: string, close: string): number {
    let depth = 0;
    for (let i = line - 1; i >= 0; i--) {
      const k = this.kwAt[i];
      if (k === close) depth++;
      else if (k === open) {
        if (depth === 0) return i;
        depth--;
      }
    }
    return -1;
  }

  private findTarget(name: string, line: number, dir: 'F' | 'B' | 'FB'): number {
    const nm = /^N(\d+)$/.exec(name);
    const list = (nm ? this.nLines.get(+nm[1]!) : this.labels.get(name)) ?? [];
    if (dir !== 'B') {
      const f = list.find((l) => l > line);
      if (f !== undefined) return f;
    }
    if (dir !== 'F') {
      for (let k = list.length - 1; k >= 0; k--) if (list[k]! < line || (dir === 'FB' && list[k]! <= line)) return list[k]!;
    }
    return -1;
  }

  // ───────────────────────── 실행 ─────────────────────────

  override run(): void {
    this.index();
    this.pc = 0;
    while (!this.ended) {
      // 글 끝: 마지막 파일의 부프로그램이 RET·M17 없이 끝에 닿았으면 돌아간다
      if (this.pc >= this.src.lineCount) {
        if (!this.sStack.some((f) => f.kind === 'sub')) break;
        this.subReturn(-1);
        continue;
      }
      const line = this.pc++;
      if (++this.blocks > this.maxBlocks) {
        this.w.add(`실행 블록이 ${this.maxBlocks}개를 넘어 멈춤(끝없는 반복일 수 있음)`, line);
        this.hitLimit = true;
        break;
      }
      // 다른 프로그램(부프로그램 머리·PROC·함께 연 파일)이 시작하는 줄
      if (this.sectionLines.has(line) && line !== this.mainHeader) {
        if (this.chainedHeads.has(line)) continue;
        if (this.sStack.some((f) => f.kind === 'sub')) this.subReturn(line);
        else break;
        continue;
      }
      try {
        this.step(line);
      } catch (err) {
        if (!(err instanceof ExprError)) throw err;
        this.w.add(`읽을 수 없는 블록 — ${err.message}`, line);
      }
      this.afterLine(line);
      if (this.mb.count >= this.maxMoves) {
        this.w.add(`이동이 ${this.maxMoves}개를 넘어 나머지는 읽지 않음`, line);
        this.hitLimit = true;
        break;
      }
    }
  }

  /** 구간 반복(REPEAT 표지)의 끝 줄을 지났으면 다시 */
  private afterLine(line: number): void {
    const f = this.sStack[this.sStack.length - 1];
    if (!f || f.kind !== 'rep' || f.end !== line || this.pc !== line + 1) return;
    if (f.reps > 1) {
      f.reps--;
      this.pc = f.start;
    } else {
      this.sStack.pop();
      this.pc = f.ret;
    }
  }

  private step(line: number): void {
    const { code: rawCode, comment } = splitLine(sourceLine(this.src, line));
    let code = rawCode.trim();
    if (!code) {
      if (comment) this.passComment(comment, line);
      return;
    }
    if (code.startsWith('%')) return;
    if (code.startsWith('/')) {
      if (this.o.blockDelete) return;
      code = code.replace(/^\/\d?\s*/, '');
    }
    code = code.replace(/^N\d+\s*/, '');
    code = code.replace(/^[A-Z_][A-Z0-9_]*\s*:(?!=)\s*/, '');
    if (!code) {
      if (comment) this.passComment(comment, line);
      return;
    }
    const kw = /^[A-Z_]+/.exec(code)?.[0] ?? '';
    const sc = new Scan(code);
    switch (kw) {
      case 'IF':
        sc.eatWord('IF');
        return this.sIf(sc, line);
      case 'ELSE': {
        // 참 갈래를 끝내고 들어왔다 — 짝 ENDIF 뒤로
        const e = this.matchForward(line, 'IF', ['ENDIF']);
        if (e >= 0) this.pc = e + 1;
        return;
      }
      case 'ENDIF':
      case 'LOOP':
        return;
      case 'WHILE': {
        sc.eatWord('WHILE');
        if (!this.expr(sc)) this.jumpPast(line, 'WHILE', 'ENDWHILE');
        return;
      }
      case 'ENDWHILE': {
        const w = this.matchBackward(line, 'WHILE', 'ENDWHILE');
        if (w >= 0) this.pc = w;
        return;
      }
      case 'FOR':
        sc.eatWord('FOR');
        return this.sFor(sc, line);
      case 'ENDFOR': {
        const f = this.matchBackward(line, 'FOR', 'ENDFOR');
        if (f < 0) return;
        const m = /FOR\s+(R\d+|[A-Z_][A-Z0-9_]*)\s*=/.exec(splitLine(sourceLine(this.src, f)).code);
        if (m) this.sSet(m[1]!, (this.sGet(m[1]!) ?? 0) + 1);
        this.pc = f;
        return;
      }
      case 'UNTIL': {
        sc.eatWord('UNTIL');
        if (!this.expr(sc)) {
          const r = this.matchBackward(line, 'REPEAT', 'UNTIL');
          if (r >= 0) this.pc = r + 1;
        }
        return;
      }
      case 'ENDLOOP': {
        const l = this.matchBackward(line, 'LOOP', 'ENDLOOP');
        if (l >= 0) this.pc = l + 1;
        return;
      }
      case 'REPEAT':
      case 'REPEATB':
        if (this.kwAt[line] === 'REPEAT') return;
        return this.sRepeat(sc, kw, line);
      case 'GOTOF':
      case 'GOTOB':
      case 'GOTO':
      case 'GOTOC':
        sc.eatWord(kw);
        return this.sGoto(kw, sc.ident() || sc.rest(), line);
      case 'DEF':
        sc.eatWord('DEF');
        return this.sDef(sc);
      case 'PROC':
        return;
      case 'RET':
        return this.subReturn(line);
      case 'MSG':
      case 'EXTERN':
      case 'SAVE':
      case 'STOPRE':
      case 'SETAL':
      case 'WAITM':
      case 'WAITMC':
      case 'WAITE':
      case 'STOPFIFO':
      case 'STARTFIFO':
      case 'SBLOF':
      case 'SBLON':
      case 'DISPLOF':
      case 'DISPLON':
      case 'GETD':
      case 'RELEASE':
      case 'TRAFOOF':
      case 'TRAORI':
        return;
      case 'TRANS':
      case 'ATRANS':
      case 'ROT':
      case 'AROT':
      case 'SCALE':
      case 'ASCALE':
      case 'MIRROR':
      case 'AMIRROR':
        sc.eatWord(kw);
        return this.sFrame(kw, sc);
      case 'MCALL':
        sc.eatWord('MCALL');
        return this.sMcall(sc, line);
      case 'CALL':
      case 'PCALL': {
        sc.eatWord(kw);
        const name = sc.str() ?? sc.ident();
        return this.callSub(name.replace(/^.*\//, '').replace(/_SPF$|\.SPF$/i, '').toUpperCase(), 1, [], line, false);
      }
    }
    this.sBlock(sc, line, comment);
  }

  /** 주석만 있는 줄: 프로그램 이름·공구 목록 주석을 Runner 규칙으로 읽힌다 */
  private passComment(text: string, line: number): void {
    if (text.startsWith(JOB_FILE_MARK)) return;
    const b = this.sBlk;
    b.reset();
    b.comments.push(text);
    this.exec(b, line);
  }

  // ── 변수 ──
  private sGet(name: string): number | undefined {
    const m = /^R(\d+)$/.exec(name);
    if (m) return this.r.get(+m[1]!) ?? 0;
    for (let k = this.sStack.length - 1; k >= 0; k--) {
      const l = this.sStack[k]!.locals;
      if (l?.has(name)) return l.get(name);
      if (this.sStack[k]!.kind === 'sub') break;
    }
    return this.vars.get(name);
  }
  private sSet(name: string, v: number): void {
    const m = /^R(\d+)$/.exec(name);
    if (m) {
      this.r.set(+m[1]!, v);
      return;
    }
    for (let k = this.sStack.length - 1; k >= 0; k--) {
      const l = this.sStack[k]!.locals;
      if (l?.has(name)) {
        l.set(name, v);
        return;
      }
      if (this.sStack[k]!.kind === 'sub') break;
    }
    this.vars.set(name, v);
  }
  private isVar(name: string): boolean {
    if (/^R\d+$/.test(name)) return true;
    for (let k = this.sStack.length - 1; k >= 0; k--) {
      if (this.sStack[k]!.locals?.has(name)) return true;
      if (this.sStack[k]!.kind === 'sub') break;
    }
    return this.vars.has(name);
  }

  // ── 식 ──
  private expr(sc: Scan): number {
    let v = this.andExpr(sc);
    for (;;) {
      if (sc.eatWord('OR')) {
        const b = this.andExpr(sc);
        v = v !== 0 || b !== 0 ? 1 : 0;
      } else if (sc.eatWord('XOR')) {
        const b = this.andExpr(sc);
        v = (v !== 0) !== (b !== 0) ? 1 : 0;
      } else return v;
    }
  }
  private andExpr(sc: Scan): number {
    let v = this.notExpr(sc);
    while (sc.eatWord('AND')) {
      const b = this.notExpr(sc);
      v = v !== 0 && b !== 0 ? 1 : 0;
    }
    return v;
  }
  private notExpr(sc: Scan): number {
    if (sc.eatWord('NOT')) return this.notExpr(sc) === 0 ? 1 : 0;
    return this.cmpExpr(sc);
  }
  private cmpExpr(sc: Scan): number {
    const a = this.addExpr(sc);
    for (const op of ['==', '<>', '>=', '<=', '>', '<']) {
      if (sc.eat(op)) {
        const b = this.addExpr(sc);
        const eq = Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
        const r = op === '==' ? eq : op === '<>' ? !eq : op === '>=' ? a >= b || eq : op === '<=' ? a <= b || eq : op === '>' ? a > b && !eq : a < b && !eq;
        return r ? 1 : 0;
      }
    }
    return a;
  }
  private addExpr(sc: Scan): number {
    let v = this.mulExpr(sc);
    for (;;) {
      if (sc.eat('+')) v += this.mulExpr(sc);
      else if (sc.peek() === '-') {
        sc.i++;
        v -= this.mulExpr(sc);
      } else return v;
    }
  }
  private mulExpr(sc: Scan): number {
    let v = this.unary(sc);
    for (;;) {
      if (sc.eat('*')) v *= this.unary(sc);
      else if (sc.eat('/')) {
        const b = this.unary(sc);
        if (b === 0) throw new ExprError('0으로 나눔');
        v /= b;
      } else if (sc.eatWord('DIV')) {
        const b = this.unary(sc);
        if (b === 0) throw new ExprError('0으로 나눔');
        v = Math.trunc(v / b);
      } else if (sc.eatWord('MOD')) {
        const b = this.unary(sc);
        if (b === 0) throw new ExprError('0으로 나눔');
        v = v % b;
      } else return v;
    }
  }
  private unary(sc: Scan): number {
    if (sc.eat('-')) return -this.unary(sc);
    if (sc.eat('+')) return this.unary(sc);
    return this.primary(sc);
  }
  private primary(sc: Scan): number {
    sc.ws();
    const c = sc.peek();
    if (c === '(') {
      sc.i++;
      const v = this.expr(sc);
      if (!sc.eat(')')) throw new ExprError(') 없음');
      return v;
    }
    if (/[0-9.]/.test(c)) {
      const v = sc.number();
      if (v === undefined) throw new ExprError('수 없음');
      return v;
    }
    if (c === '"') throw new ExprError('글 값은 식에 쓸 수 없음');
    const id = sc.ident();
    if (!id) throw new ExprError(`알 수 없는 글자 '${c}'`);
    if (id.startsWith('$')) throw new ExprError(`시스템 변수 ${id}는 읽지 않음`);
    if (id === 'TRUE') return 1;
    if (id === 'FALSE') return 0;
    if (id === 'R' && sc.peek() === '[') {
      sc.i++;
      const k = Math.round(this.expr(sc));
      if (!sc.eat(']')) throw new ExprError('] 없음');
      return this.r.get(k) ?? 0;
    }
    if (sc.peek() === '(') {
      sc.i++;
      const args: number[] = [];
      if (!sc.eat(')')) {
        for (;;) {
          args.push(this.expr(sc));
          if (sc.eat(')')) break;
          if (!sc.eat(',')) throw new ExprError(', 없음');
        }
      }
      return this.func(id, args);
    }
    if (sc.peek() === '[') throw new ExprError(`배열 변수 ${id}[…]는 읽지 않음`);
    const v = this.sGet(id);
    if (v === undefined) throw new ExprError(`모르는 변수 ${id}`);
    return v;
  }
  private func(name: string, a: number[]): number {
    const x = a[0] ?? 0;
    switch (name) {
      case 'SIN':
        return Math.sin(x * DEG);
      case 'COS':
        return Math.cos(x * DEG);
      case 'TAN':
        return Math.tan(x * DEG);
      case 'ASIN':
        return Math.asin(x) / DEG;
      case 'ACOS':
        return Math.acos(x) / DEG;
      case 'ATAN2':
        return Math.atan2(x, a[1] ?? 1) / DEG;
      case 'SQRT':
        return Math.sqrt(x);
      case 'POT':
        return x * x;
      case 'ABS':
        return Math.abs(x);
      case 'TRUNC':
        return Math.trunc(x);
      case 'ROUND':
        return Math.sign(x) * Math.round(Math.abs(x));
      case 'ROUNDUP':
        return Math.ceil(x);
      case 'MIN':
        return Math.min(...a);
      case 'MAX':
        return Math.max(...a);
      case 'LN':
        return Math.log(x);
      case 'EXP':
        return Math.exp(x);
      case 'BOUND':
        return Math.min(Math.max(a[2] ?? 0, a[0] ?? 0), a[1] ?? 0);
    }
    throw new ExprError(`함수 ${name}은 읽지 않음`);
  }

  // ── 흐름 ──
  private jumpPast(line: number, open: string, close: string): void {
    const e = this.matchForward(line, open, [close]);
    if (e < 0) {
      this.w.add(`${open}에 맞는 ${close}이 없음 — 멈춤`, line);
      this.ended = true;
    } else this.pc = e + 1;
  }

  private sIf(sc: Scan, line: number): void {
    const cond = this.expr(sc);
    for (const g of ['GOTOF', 'GOTOB', 'GOTOC', 'GOTO']) {
      if (sc.eatWord(g)) {
        const target = sc.ident() || sc.rest();
        if (cond) this.sGoto(g, target, line);
        return;
      }
    }
    if (cond) return;
    // 거짓: 짝 ELSE 다음(또는 ENDIF 다음)으로
    const e = this.matchForward(line, 'IF', ['ENDIF'], ['ELSE']);
    if (e < 0) {
      this.w.add('IF에 맞는 ENDIF가 없음 — 멈춤', line);
      this.ended = true;
    } else this.pc = e + 1;
  }

  private sFor(sc: Scan, line: number): void {
    const name = sc.ident();
    if (!name || !sc.eat('=')) throw new ExprError('FOR 변수 없음');
    const from = this.expr(sc);
    if (!sc.eatWord('TO')) throw new ExprError('FOR … TO 없음');
    const to = this.expr(sc);
    if (!this.forActive.has(line)) {
      this.forActive.add(line);
      this.sSet(name, from);
    }
    if ((this.sGet(name) ?? 0) > to + 1e-9) {
      this.forActive.delete(line);
      this.jumpPast(line, 'FOR', 'ENDFOR');
    }
  }

  private sGoto(kind: string, target: string, line: number): void {
    const t = this.findTarget(target.trim(), line, kind === 'GOTOF' ? 'F' : kind === 'GOTOB' ? 'B' : 'FB');
    if (t < 0) {
      if (kind === 'GOTOC') return;
      this.w.add(`${kind} ${target}: 표지가 없음 — 멈춤`, line);
      this.ended = true;
      return;
    }
    this.pc = t;
  }

  /** REPEAT 표지 [끝 표지] P=n — 구간을 n번 하고 REPEAT 다음 줄로 */
  private sRepeat(sc: Scan, kw: string, line: number): void {
    sc.eatWord(kw);
    const a = sc.ident();
    let b = '';
    let p = 1;
    for (;;) {
      if (sc.end()) break;
      if (sc.eatWord('P')) {
        sc.eat('=');
        p = Math.round(this.expr(sc));
      } else {
        const id = sc.ident();
        if (!id) break;
        b = id;
      }
    }
    const start = kw === 'REPEATB' ? this.findTarget(a, line, 'B') : (this.findTarget(a, line, 'B') >= 0 ? this.findTarget(a, line, 'B') : this.findTarget(a, line, 'F'));
    if (start < 0) {
      this.w.add(`REPEAT ${a}: 표지가 없음`, line);
      return;
    }
    let end = start;
    if (b) {
      end = this.findTarget(b, start, b === 'ENDLABEL' ? 'F' : 'F');
      if (end < 0) end = start;
    }
    if (p <= 0) return;
    if (this.sStack.length >= 64) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    this.sStack.push({ kind: 'rep', ret: line + 1, start, end, reps: p, locals: null });
    this.pc = start;
  }

  private sDef(sc: Scan): void {
    const type = sc.ident();
    if (sc.peek() === '[') {
      // STRING[20] 꼴
      const e = sc.s.indexOf(']', sc.i);
      sc.i = e < 0 ? sc.s.length : e + 1;
    }
    if (!['REAL', 'INT', 'BOOL', 'CHAR', 'AXIS', 'STRING', 'FRAME'].includes(type)) throw new ExprError(`DEF ${type}`);
    const numeric = type === 'REAL' || type === 'INT' || type === 'BOOL' || type === 'CHAR';
    for (;;) {
      const name = sc.ident();
      if (!name) break;
      if (sc.peek() === '[') {
        const e = sc.s.indexOf(']', sc.i);
        sc.i = e < 0 ? sc.s.length : e + 1;
        this.w.add(`배열 변수 ${name}[…]는 읽지 않음`);
      }
      let v = 0;
      if (sc.eat('=')) {
        if (numeric) v = this.expr(sc);
        else {
          sc.str();
        }
      }
      if (numeric) {
        const top = this.sStack[this.sStack.length - 1];
        if (top && top.kind === 'sub' && top.locals) top.locals.set(name, type === 'INT' ? Math.trunc(v) : v);
        else this.vars.set(name, type === 'INT' ? Math.trunc(v) : v);
      }
      if (!sc.eat(',')) break;
    }
  }

  // ── 부프로그램 ──
  /** name 부프로그램을 reps번 부른다. 못 찾으면 경고 */
  private callSub(name: string, reps: number, args: (number | undefined)[], line: number, modal: boolean): void {
    const sec = this.sections.get(name) ?? this.sections.get(name.replace(/^L0*(\d+)$/, 'L$1'));
    if (!sec) {
      this.missingProgram(name, `부프로그램 ${name}을(를) 찾지 못함 — 다른 파일이면 함께 열어야 읽음`, line);
      return;
    }
    if (reps <= 0) return;
    if (this.sStack.length >= 64) {
      this.w.add('부프로그램 호출이 너무 깊음 — 멈춤', line);
      this.ended = true;
      return;
    }
    const locals = new Map<string, number>();
    sec.params.forEach((p, k) => locals.set(p, args[k] ?? 0));
    this.sStack.push({ kind: 'sub', ret: this.pc, start: sec.line + 1, reps, locals, modal });
    this.pc = sec.line + 1;
  }

  /** RET·M17·부프로그램 끝 */
  private subReturn(line: number): void {
    // 구간 반복 안에서 돌아가면 그 반복도 끝
    while (this.sStack.length && this.sStack[this.sStack.length - 1]!.kind === 'rep') this.sStack.pop();
    const f = this.sStack[this.sStack.length - 1];
    if (!f) {
      // 주 프로그램의 RET·M17 = 끝
      if (line >= 0) this.ended = true;
      return;
    }
    if (f.reps > 1) {
      f.reps--;
      this.pc = f.start;
      return;
    }
    this.sStack.pop();
    this.pc = f.ret;
  }

  private inModalCall(): boolean {
    return this.sStack.some((f) => f.modal);
  }

  private sMcall(sc: Scan, line: number): void {
    if (sc.end()) {
      this.modalCall = null;
      return;
    }
    const name = sc.ident();
    if (sc.peek() === '(') {
      const args = this.args(sc);
      if (/^CYCLE8\d+$|^CYCLE840$/.test(name)) this.modalCall = { kind: 'cycle', name, args };
      else if (this.sections.has(name)) this.modalCall = { kind: 'sub', name };
      else {
        this.w.add(`MCALL ${name}(…)은 지원하지 않음`, line);
        this.modalCall = null;
      }
      return;
    }
    this.modalCall = { kind: 'sub', name };
  }

  /** ( 식, 빈칸, … ) — 빈 자리는 undefined */
  private args(sc: Scan): (number | undefined)[] {
    const out: (number | undefined)[] = [];
    if (!sc.eat('(')) return out;
    if (sc.eat(')')) return out;
    for (;;) {
      sc.ws();
      if (sc.peek() === ',' || sc.peek() === ')') out.push(undefined);
      else if (sc.peek() === '"') {
        sc.str();
        out.push(undefined);
      } else out.push(this.expr(sc));
      if (sc.eat(')')) break;
      if (!sc.eat(',')) throw new ExprError(', 없음');
    }
    return out;
  }

  // ── 프레임 ──
  private setFrame(m: Affine | null): void {
    this.frame = m;
    this.progXf = m && !isIdentity(m) ? m : null;
    this.rebuildXf();
  }

  private sFrame(kw: string, sc: Scan): void {
    const vals: (number | undefined)[] = [undefined, undefined, undefined];
    let rpl: number | undefined;
    while (!sc.end()) {
      const c = sc.peek();
      if (c === 'X' || c === 'Y' || c === 'Z') {
        sc.i++;
        const a = AX.indexOf(c);
        if (sc.eat('=')) vals[a] = this.expr(sc);
        else vals[a] = sc.number() ?? 0;
        continue;
      }
      const id = sc.ident();
      if (id === 'RPL' && sc.eat('=')) {
        rpl = this.expr(sc);
        continue;
      }
      if (!id) throw new ExprError(`알 수 없는 글자 '${c}'`);
      if (sc.eat('=')) this.expr(sc);
    }
    const sc3 = this.scale;
    const none = vals.every((v) => v === undefined) && rpl === undefined;
    let m: Affine;
    switch (kw) {
      case 'TRANS':
      case 'ATRANS':
        m = affine([1, 0, 0, 0, 1, 0, 0, 0, 1], vals.map((v) => (v ?? 0) * sc3));
        break;
      case 'ROT':
      case 'AROT': {
        if (rpl !== undefined) m = rotAbout(ZERO3, rpl, this.plane);
        else {
          // RPY: Z → Y → X 차례(프로그램 좌표 → 작업 좌표 R = Rz·Ry·Rx)
          m = affine([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]);
          if (vals[0]) m = composeAffine(rotAbout(ZERO3, vals[0], 2), m);
          if (vals[1]) m = composeAffine(rotAbout(ZERO3, vals[1], 1), m);
          if (vals[2]) m = composeAffine(rotAbout(ZERO3, vals[2], 0), m);
        }
        break;
      }
      case 'SCALE':
      case 'ASCALE':
        m = diagAbout(ZERO3, vals.map((v) => v ?? 1));
        break;
      default:
        m = diagAbout(ZERO3, vals.map((v) => (v !== undefined ? -1 : 1)));
    }
    if (kw.startsWith('A')) this.setFrame(this.frame ? composeAffine(this.frame, m) : m);
    else this.setFrame(none ? null : m);
  }

  // ── 블록 ──
  private toolNumber(name: string): number {
    if (/^\d+$/.test(name)) return +name;
    let n = this.toolByName.get(name);
    if (n === undefined) {
      n = 100000 + this.toolByName.size;
      this.toolByName.set(name, n);
      this.addToolInfo(n, name);
      this.setToolInfo(n, { name });
    }
    return n;
  }

  private warnOnce(key: string, msg: string, line: number): void {
    if (this.warnedWord.has(key)) return;
    this.warnedWord.add(key);
    this.w.add(msg, line);
  }

  private sBlock(sc: Scan, line: number, comment: string): void {
    const words: Word[] = [];
    const gs: number[] = [];
    const ms: number[] = [];
    const idents: string[] = [];
    const calls: { name: string; args: (number | undefined)[] }[] = [];
    let lCall: number | undefined;
    let pRep: number | undefined;
    while (!sc.end()) {
      const c = sc.peek();
      if (/[A-Z_$]/.test(c)) {
        const nx = sc.s[sc.i + 1] ?? '';
        // 한 글자 주소 + 수(G01·X10·L100·T1), 또는 R1= 꼴 변수·X1= 꼴 주소
        if (/[A-Z]/.test(c) && /[0-9.+\-]/.test(nx)) {
          const ext = /^([A-Z])(\d+)\s*=(?!=)/.exec(sc.s.slice(sc.i));
          if (ext) {
            sc.i += ext[0].length;
            this.assignOrAddr(ext[1]! + ext[2]!, sc, words, line);
            continue;
          }
          sc.i++;
          const v = sc.number();
          if (v === undefined) throw new ExprError(`${c} 뒤에 수 없음`);
          if (c === 'G') gs.push(v);
          else if (c === 'M') ms.push(v);
          else if (c === 'L') lCall = v;
          else if (c === 'P') pRep = v;
          else if (c === 'N') {
            /* 가운데 N은 무시 */
          } else words.push({ name: c, value: v });
          continue;
        }
        const id = sc.ident();
        sc.ws();
        if (sc.s[sc.i] === '=' && sc.s[sc.i + 1] !== '=') {
          sc.i++;
          this.assignOrAddr(id, sc, words, line);
          continue;
        }
        if (id === 'R' && sc.peek() === '[') {
          sc.i++;
          const k = Math.round(this.expr(sc));
          if (!sc.eat(']') || !sc.eat('=')) throw new ExprError('R[…] = 없음');
          this.r.set(k, this.expr(sc));
          continue;
        }
        if (sc.peek() === '(') {
          calls.push({ name: id, args: this.args(sc) });
          continue;
        }
        if (sc.peek() === '[') {
          // FA[X]=… 꼴: 값을 읽고 버린다
          const e = sc.s.indexOf(']', sc.i);
          sc.i = e < 0 ? sc.s.length : e + 1;
          if (sc.eat('=')) this.skipValue(sc);
          this.warnOnce(id, `Siemens 낱말 '${id}'은(는) 무시함`, line);
          continue;
        }
        idents.push(id);
        continue;
      }
      if (c === '"') {
        sc.str();
        continue;
      }
      throw new ExprError(`알 수 없는 글자 '${c}'`);
    }

    const word = (n: string): Word | undefined => {
      for (let k = words.length - 1; k >= 0; k--) if (words[k]!.name === n) return words[k];
      return undefined;
    };
    // ── G 코드 고르기·바꾸기 ──
    const pass: number[] = [];
    let dwell = false;
    let refApproach = '';
    let poleMode = -1;
    let noMove = false;
    let frameShift = -1;
    for (const g of gs) {
      const gi = Math.round(g * 10);
      if (gi === 0 || gi === 10 || gi === 20 || gi === 30) {
        this.sMotion = gi;
        this.sCip = false;
        this.sCt = false;
        pass.push(g);
      } else if (gi === 40) dwell = true;
      else if (gi === 700 || gi === 7000) pass.push(20);
      else if (gi === 710 || gi === 7100) pass.push(21);
      else if (gi === 740 || gi === 750) refApproach = `G${g}`;
      else if (gi === 1100 || gi === 1110 || gi === 1120) poleMode = gi;
      else if (gi === 250 || gi === 260) noMove = true;
      else if (gi === 580 || gi === 590) frameShift = gi;
      else if (gi === 1530) pass.push(53);
      else if (gi >= 5050 && gi <= 5990 && gi % 10 === 0) this.selectWcs(6 + (gi / 10 - 505), line);
      else if (gi === 5000) this.warnOnce('G500', 'G500(설정 원점 끄기)은 첫 작업 좌표계와 같은 원점으로 그림', line);
      else if (gi === 3310 || gi === 3320 || gi === 630) {
        this.sMotion = 10;
        pass.push(1);
      } else if (gi === 340 || gi === 350) pass.push(33);
      else if ([1400, 1410, 1420, 1430, 1470, 1480, 2470, 2480, 3470, 3480].includes(gi)) {
        this.warnOnce(`G${g}`, `G${g}(부드러운 접근·이탈)은 끝점까지 이송 직선으로 그림`, line);
        this.sMotion = 10;
        pass.push(1);
      } else if (gi === 600 || gi === 90 || (gi >= 6410 && gi <= 6450) || (gi >= 6010 && gi <= 6030) || gi === 4500 || gi === 4510 || (gi >= 4600 && gi <= 4620) || gi === 3400 || gi === 3410 || gi === 2900 || gi === 2910 || gi === 50 || gi === 70 || gi === 40) {
        /* 정확 정지·연속 경로·모서리·이송 모드: 모양은 그대로 */
      } else pass.push(g);
    }

    // 같은 블록의 모드(G90/G91·평면·단위)는 목표점을 셈하기 전에(Runner.exec도 다시 건다)
    for (const g of pass) {
      const gi = Math.round(g * 10);
      if (gi === 900) this.absolute = true;
      else if (gi === 910) this.absolute = false;
      else if (gi === 170 || gi === 180 || gi === 190) this.plane = ((gi - 170) / 10) as 0 | 1 | 2;
      else if (gi === 200 || gi === 210) {
        this.blockInch = gi === 200;
        this.updateScale();
      }
    }
    if (pRep === undefined && word('P')?.value !== undefined) pRep = word('P')!.value;
    const [a0, a1] = PLANE_AXES[this.plane]!;

    if (dwell) {
      // G4 F = 초, G4 S = 주축 회전 수
      const f = word('F');
      const s = word('S');
      if (f?.value !== undefined) this.dwell(f.value);
      else if (s?.value !== undefined && this.speed > 0) this.dwell((s.value / this.speed) * 60);
      return;
    }

    // 기계 원점·고정점 접근(G74·G75): 기계 좌표 쪽 이동 규칙
    if (refApproach) {
      let mask = 0;
      for (let a = 0; a < 3; a++) if (word(`${AX[a]}1`) || word(AX[a]!)) mask |= 1 << a;
      if (!mask) mask = 7;
      this.machineEstimate(mask, line, refApproach);
      return;
    }

    // 극(G110·G111·G112): 이 블록의 평면 좌표는 극 위치
    if (poleMode >= 0) {
      const cur = this.progPos();
      const sc0 = this.axScale;
      const wu = word(AX[a0]!);
      const wv = word(AX[a1]!);
      const base = poleMode === 1100 ? [cur[a0]!, cur[a1]!] : poleMode === 1120 ? [this.pole[0]!, this.pole[1]!] : [0, 0];
      this.pole = [base[0]! + (wu?.value ?? 0) * sc0[a0]!, base[1]! + (wv?.value ?? 0) * sc0[a1]!];
      if (poleMode === 1110 && !wu && !wv) this.pole = [0, 0];
      words.splice(0, words.length, ...words.filter((w) => w.name !== AX[a0] && w.name !== AX[a1]));
    }

    // G58·G59: 축별 프로그램 원점 이동(대체·더하기)
    if (frameShift >= 0) {
      const t = [0, 0, 0];
      let any = false;
      for (let a = 0; a < 3; a++) {
        const w0 = word(AX[a]!);
        if (w0?.value !== undefined) {
          t[a] = w0.value * this.scale;
          any = true;
        }
      }
      if (any) {
        const m = affine([1, 0, 0, 0, 1, 0, 0, 0, 1], t);
        if (frameShift === 590 || !this.frame) this.setFrame(this.frame ? composeAffine(this.frame, m) : m);
        else {
          // G58: 이동 성분만 바꾼다
          const f = new Float64Array(this.frame);
          for (let a = 0; a < 3; a++) if (word(AX[a]!)) f[9 + a] = t[a]!;
          this.setFrame(f);
        }
      }
      noMove = true;
    }

    // ── 목표점(프로그램 좌표) ──
    const cur = Array.from(this.progPos());
    const incMode = (w: Word): boolean => (w.mode === 'IC' ? true : w.mode === 'AC' ? false : !this.absolute);
    const end = cur.slice();
    let moveAxes = 0;
    if (!noMove)
      for (let a = 0; a < 3; a++) {
        const w0 = word(AX[a]!);
        if (w0?.value === undefined) continue;
        const v = w0.value * this.axScale[a]!;
        end[a] = incMode(w0) ? cur[a]! + v : v;
        moveAxes |= 1 << a;
      }
    // 극좌표 AP·RP
    const wAp = word('AP');
    const wRp = word('RP');
    if (!noMove && (wAp || wRp)) {
      if (wAp?.value !== undefined) this.ap = wAp.mode === 'IC' ? this.ap + wAp.value : wAp.value;
      if (wRp?.value !== undefined) this.rp = wRp.mode === 'IC' ? this.rp + wRp.value * this.scale : wRp.value * this.scale;
      end[a0] = this.pole[0]! + this.rp * Math.cos(this.ap * DEG);
      end[a1] = this.pole[1]! + this.rp * Math.sin(this.ap * DEG);
      moveAxes |= (1 << a0) | (1 << a1);
    }

    // ── 원호 꼴 바꾸기 ──
    let motionOut = -1;
    let center: number[] | null = null;
    let radiusR: number | undefined;
    if (idents.includes('CIP')) {
      this.sCip = true;
      this.sCt = false;
      this.sMotion = 25;
    } else if (idents.includes('CT')) {
      // 앞 요소에 접하는 원호(끝점만 줌) — Runner에는 이송 직선으로 넘기고 그리는 자리에서 원호로 바꾼다(tangentArc)
      this.sCt = true;
      this.sMotion = 10;
      this.sCip = false;
    }
    if (this.sCt) motionOut = 10;
    const isArc = this.sMotion === 20 || this.sMotion === 30;
    if (this.sCip && moveAxes) {
      const mid = cur.slice();
      let gotMid = false;
      for (let a = 0; a < 3; a++) {
        const w0 = word(`${CENTER[a]}1`);
        if (w0?.value === undefined) continue;
        const v = w0.value * this.axScale[a]!;
        mid[a] = incMode(w0) ? cur[a]! + v : v;
        gotMid = true;
      }
      const c = gotMid ? circle3(cur, mid, end, a0, a1) : null;
      if (!c) {
        this.w.add(gotMid ? 'CIP 세 점이 한 직선 위 — 직선으로 그림' : 'CIP에 중간점(I1·J1·K1)이 없음 — 직선으로 그림', line);
        motionOut = 10;
      } else {
        motionOut = c.ccw ? 30 : 20;
        center = [0, 0, 0];
        center[a0] = c.cu;
        center[a1] = c.cv;
      }
    } else if (isArc) {
      const ar = word('AR');
      const cr = word('CR');
      if (ar?.value !== undefined) {
        const hasC = !!(word(CENTER[a0]!) || word(CENTER[a1]!));
        const ccw = this.sMotion === 30;
        if (hasC && !(moveAxes & ((1 << a0) | (1 << a1)))) {
          // 중심 + 여는 각 → 끝점
          const cu = this.centerValue(word(CENTER[a0]!), cur[a0]!);
          const cv = this.centerValue(word(CENTER[a1]!), cur[a1]!);
          const t = Math.atan2(cur[a1]! - cv, cur[a0]! - cu) + (ccw ? 1 : -1) * ar.value * DEG;
          const r = Math.hypot(cur[a0]! - cu, cur[a1]! - cv);
          end[a0] = cu + r * Math.cos(t);
          end[a1] = cv + r * Math.sin(t);
          moveAxes |= (1 << a0) | (1 << a1);
          center = [0, 0, 0];
          center[a0] = cu;
          center[a1] = cv;
        } else if (moveAxes) {
          // 끝점 + 여는 각 → 반지름(180도 넘으면 음수)
          const d = Math.hypot(end[a0]! - cur[a0]!, end[a1]! - cur[a1]!);
          const s = Math.sin((ar.value * DEG) / 2);
          if (d > 0 && Math.abs(s) > 1e-12) radiusR = ((d / 2 / Math.abs(s)) * (ar.value > 180 ? -1 : 1)) / this.scale;
        }
      } else if (cr?.value !== undefined) radiusR = cr.value;
    }

    // ── Runner 블록 ──
    const b = this.sBlk;
    b.reset();
    if (comment) b.comments.push(comment);
    for (const g of pass) b.set(6, g, true);
    if (motionOut >= 0 && !pass.some((g) => [0, 1, 2, 3].includes(g))) b.set(6, motionOut / 10, true);
    else if (this.sCip && motionOut < 0 && moveAxes) b.set(6, 1, true);
    let ret = false;
    let endProg = false;
    const inSub = this.sStack.some((f) => f.kind === 'sub');
    for (const m of ms) {
      if (m === 17) ret = true;
      else if ((m === 2 || m === 30) && inSub) ret = true;
      else if (m === 2 || m === 30) endProg = true;
      else b.set(12, m, true);
    }
    if (!noMove) {
      if (center) {
        for (let a = 0; a < 3; a++) {
          if (moveAxes & (1 << a)) {
            b.set(LET(AX[a]!), end[a]! / this.axScale[a]!, true);
            b.axAbs |= 1 << a;
          }
        }
        b.set(LET(CENTER[a0]!), center[a0]! / this.scale, true);
        b.set(LET(CENTER[a1]!), center[a1]! / this.scale, true);
        b.cAbs |= (1 << a0) | (1 << a1);
      } else {
        for (let a = 0; a < 3; a++) {
          if (!(moveAxes & (1 << a))) continue;
          b.set(LET(AX[a]!), end[a]! / this.axScale[a]!, true);
          b.axAbs |= 1 << a;
        }
        if (isArc && radiusR === undefined)
          for (let a = 0; a < 3; a++) {
            const w0 = word(CENTER[a]!);
            if (w0?.value === undefined) continue;
            b.set(LET(CENTER[a]!), w0.value, true);
            if (w0.mode === 'AC') b.cAbs |= 1 << a;
          }
        if (radiusR !== undefined) b.set(LET('R'), radiusR, true);
      }
      for (const n of ['A', 'B', 'C']) {
        const w0 = word(n);
        if (w0?.value !== undefined) b.set(LET(n), w0.value, true);
      }
      const turn = word('TURN');
      if (turn?.value !== undefined && isArc) b.set(LET('P'), turn.value + 1, true);
    }
    for (const n of ['F', 'S', 'D']) {
      const w0 = word(n);
      if (w0?.value !== undefined) b.set(LET(n), w0.value, true);
    }
    const t = word('T');
    if (t) b.set(LET('T'), t.str !== undefined ? this.toolNumber(t.str) : (t.value ?? 0), true);
    const wRndm = word('RNDM');
    if (wRndm?.value !== undefined) this.sRndm = Math.max(0, wRndm.value);
    if (idents.includes('SUPA')) b.set(6, 53, true);
    for (const id of idents) {
      if (id === 'CIP' || id === 'CT' || id === 'SUPA' || IGNORE_WORDS.has(id)) continue;
      if (/^G\d/.test(id)) continue;
      if (this.sections.has(id)) continue;
      this.warnOnce(id, `Siemens 낱말 '${id}'은(는) 무시함`, line);
    }
    if (endProg) b.set(12, 30, true);
    this.tangentArc = this.sCt && moveAxes !== 0;
    if (b.words > 0 || b.comments.length) this.exec(b, line);
    this.tangentArc = false;
    if (this.ended) return;
    // 이 블록 끝 모서리 다듬기(다음 직선·원호 이송과, 어느 조합이든): RND = 둥글리기 반지름, CHF = 모따기 선 길이,
    // CHR = 모서리에서 자르는 길이(원호 위는 현 길이), RNDM = 모달 둥글리기(직선·원호·CIP·CT 블록 모두)
    if (moveAxes !== 0) {
      const wRnd = word('RND');
      const wChf = word('CHF');
      const wChr = word('CHR');
      if (wRnd?.value !== undefined) this.requestCorner('round', wRnd.value * this.scale, line, this.plane, 'RND');
      else if (wChf?.value !== undefined) this.requestCorner('chamferHyp', wChf.value * this.scale, line, this.plane, 'CHF');
      else if (wChr?.value !== undefined) this.requestCorner('chamferLeg', wChr.value * this.scale, line, this.plane, 'CHR');
      else if (
        this.sRndm > 0 &&
        (this.sMotion === 10 || this.sMotion === 20 || this.sMotion === 30 || this.sMotion === 25) &&
        this.lastSeg?.i === this.mb.count - 1 &&
        (this.lastSeg.kind === MOVE_FEED || this.lastSeg.kind === MOVE_ARC)
      )
        this.requestCorner('round', this.sRndm * this.scale, line, this.plane, 'RNDM');
    }

    // ── 움직인 뒤: 사이클·패턴·부프로그램 ──
    const moved = moveAxes !== 0;
    for (const c of calls) {
      if (/^CYCLE8\d$|^CYCLE840$/.test(c.name)) this.sCycle(c.name, c.args, line);
      else if (c.name === 'HOLES1' || c.name === 'HOLES2') this.holes(c.name, c.args, line);
      else if (c.name === 'CYCLE832' || c.name === 'MSG' || c.name === 'SETAL') {
        /* 고속 가공 설정·글: 모양 없음 */
      } else if (c.name === 'CYCLE800') this.warnOnce('CYCLE800', 'CYCLE800 기울인 평면은 지원하지 않음(변환 없이 그림)', line);
      else if (this.sections.has(c.name)) this.callSub(c.name, 1, c.args, line, false);
      else if (UNSUPPORTED_CYCLE.test(c.name) || /^CYCLE/.test(c.name)) this.warnOnce(c.name, `Siemens 사이클 ${c.name}은(는) 지원하지 않음(그리지 않음)`, line);
      else this.callSub(c.name, 1, c.args, line, false);
    }
    if (moved && this.modalCall && !this.inModalCall()) {
      const mc = this.modalCall;
      if (mc.kind === 'cycle') this.sCycle(mc.name, mc.args, line);
      else this.callSub(mc.name, 1, [], line, true);
    }
    if (lCall !== undefined) this.callSub(`L${Math.round(lCall)}`, Math.max(1, Math.round(pRep ?? 1)), [], line, false);
    for (const id of idents) if (this.sections.has(id)) this.callSub(id, Math.max(1, Math.round(pRep ?? 1)), [], line, false);
    if (ret) this.subReturn(line);
  }

  private centerValue(w: Word | undefined, cur: number): number {
    if (w?.value === undefined) return cur;
    const v = w.value * this.scale;
    return w.mode === 'AC' ? v : cur + v;
  }

  private skipValue(sc: Scan): void {
    if (sc.str() !== undefined) return;
    try {
      this.expr(sc);
    } catch {
      sc.i = sc.s.length;
    }
  }

  /** NAME = 값: 변수면 대입, 주소면 낱말로 */
  private assignOrAddr(name: string, sc: Scan, words: Word[], line: number): void {
    sc.ws();
    if (name.startsWith('$')) {
      this.skipValue(sc);
      this.warnOnce(name, `시스템 변수 ${name} 대입은 무시함`, line);
      return;
    }
    if (sc.peek() === '"') {
      const s = sc.str()!;
      if (name === 'T') words.push({ name, str: s });
      else if (this.isVar(name)) {
        /* 글 변수: 무시 */
      } else this.warnOnce(name, `Siemens 낱말 '${name}'은(는) 무시함`, line);
      return;
    }
    let mode: 'AC' | 'IC' | undefined;
    const m = /^(AC|IC|DC|ACP|ACN|CAC|CIC|CDC|CACP|CACN)\s*\(/.exec(sc.s.slice(sc.i));
    let v: number;
    if (m) {
      sc.i += m[0].length;
      v = this.expr(sc);
      if (!sc.eat(')')) throw new ExprError(') 없음');
      mode = m[1] === 'IC' || m[1] === 'CIC' ? 'IC' : 'AC';
    } else v = this.expr(sc);
    if (this.isVar(name)) {
      this.sSet(name, v);
      return;
    }
    if (IGNORE_ADDR.has(name)) return;
    if (/^(?:[XYZABCIJKFSTDP]|CR|AR|AP|RP|TURN|I1|J1|K1|X1|Y1|Z1|FP|RND|RNDM|CHF|CHR)$/.test(name)) {
      words.push({ name, value: v, mode });
      return;
    }
    // 처음 보는 이름 = 대입(정의 없이 쓰는 변수로 본다)
    if (/^_?[A-Z][A-Z0-9_]{2,}$/.test(name)) {
      this.vars.set(name, v);
      return;
    }
    this.warnOnce(name, `Siemens 낱말 '${name}'은(는) 무시함`, line);
  }

  // ── 드릴 사이클·점 패턴 ──
  /** 프로그램 좌표의 공구 축 높이 h → 표시 좌표(지금 평면 자리에서) */
  private level(h: number, da: number): number {
    const q = Array.from(this.progPos());
    q[da] = h;
    const out = [0, 0, 0];
    this.toDisplay(q, out);
    return out[da]!;
  }

  /** CYCLE81~89·CYCLE840(RTP, RFP, SDIS, DP, DPR, …)을 지금 자리에서 */
  private sCycle(name: string, a: (number | undefined)[], line: number): void {
    const [p0, p1, da] = PLANE_AXES[this.plane]!;
    const s = this.scale;
    const rtp = (a[0] ?? 0) * s;
    const rfp = (a[1] ?? 0) * s;
    const sdis = Math.abs(a[2] ?? 0) * s;
    let dp: number;
    if (a[3] !== undefined) dp = a[3] * s;
    else if (a[4] !== undefined) dp = rfp - Math.abs(a[4]) * s;
    else {
      this.w.add(`${name}에 깊이(DP·DPR)가 없음`, line);
      return;
    }
    const up = rfp >= dp ? 1 : -1;
    const code: Record<string, number> = { CYCLE81: 810, CYCLE82: 820, CYCLE83: 830, CYCLE84: 840, CYCLE840: 840, CYCLE85: 850, CYCLE86: 860, CYCLE87: 860, CYCLE88: 880, CYCLE89: 890 };
    let c = code[name] ?? 810;
    const dtb = (k: number): number => Math.max(0, a[k] ?? 0);
    const saveQ = [this.cq, this.cp, this.cqI, this.cqJ, this.cqK, this.retractR ? 1 : 0, this.initLevel] as const;
    this.cq = 0;
    this.cp = 0;
    this.cqI = this.cqJ = this.cqK = 0;
    if (name === 'CYCLE82' || name === 'CYCLE84' || name === 'CYCLE840' || name === 'CYCLE85' || name === 'CYCLE86' || name === 'CYCLE88' || name === 'CYCLE89') this.cp = dtb(5);
    if (name === 'CYCLE83') {
      // FDEP(5) 첫 깊이 절대 · FDPR(6) 첫 깊이(기준면에서) · DAM(7) 줄이는 양 · DTB(8) · VARI(11) 0 = 칩 끊기, 1 = 칩 빼기
      const first = a[5] !== undefined ? Math.abs(rfp - a[5] * s) : a[6] !== undefined ? Math.abs(a[6]) * s : 0;
      const dam = Math.abs(a[7] ?? 0) * s;
      this.cp = dtb(8);
      if (first > 0) {
        this.cqI = first;
        this.cqJ = dam;
        this.cqK = dam > 0 ? dam : first;
        this.peckFirstExtra = sdis;
      }
      c = Math.round(a[11] ?? 1) === 0 ? 730 : 830;
    }
    this.retractR = false;
    if (!this.xfPlane(this.plane).keeps) {
      // 기울인 프레임(ROT X/Y): 프로그램 좌표에서 구멍 길을 만들고 점마다 옮긴다(공구 축도 기운다)
      const q = this.progPos();
      const saveInit = this.initLevelProg;
      this.initLevelProg = rtp;
      this.drillAt(c, p0, p1, da, q[p0]!, q[p1]!, rfp + up * sdis, dp, line, (v) => this.toDisplay(v, v));
      this.initLevelProg = saveInit;
    } else {
      this.initLevel = this.level(rtp, da);
      const rD = this.level(rfp + up * sdis, da);
      const zD = this.level(dp, da);
      this.drillAt(c, p0, p1, da, this.pos[p0]!, this.pos[p1]!, rD, zD, line);
    }
    this.peckFirstExtra = 0;
    [this.cq, this.cp, this.cqI, this.cqJ, this.cqK] = [saveQ[0], saveQ[1], saveQ[2], saveQ[3], saveQ[4]];
    this.retractR = !!saveQ[5];
    this.initLevel = saveQ[6];
    this.known = 7;
  }

  /** HOLES1(SPCA, SPCO, STA1, FDIS, DBH, NUM)·HOLES2(CPA, CPO, RAD, STA1, INDA, NUM): 자리마다 모달 사이클 */
  private holes(name: string, a: (number | undefined)[], line: number): void {
    const mc = this.modalCall;
    if (!mc || mc.kind !== 'cycle') {
      this.w.add(`${name} 앞에 MCALL 드릴 사이클이 없음 — 자리만 지나감`, line);
    }
    const s = this.scale;
    const pts: [number, number][] = [];
    const num = Math.max(0, Math.round(a[5] ?? 0));
    if (name === 'HOLES1') {
      const x0 = (a[0] ?? 0) * s;
      const y0 = (a[1] ?? 0) * s;
      const ang = (a[2] ?? 0) * DEG;
      const fdis = (a[3] ?? 0) * s;
      const dbh = (a[4] ?? 0) * s;
      for (let k = 0; k < num; k++) pts.push([x0 + (fdis + k * dbh) * Math.cos(ang), y0 + (fdis + k * dbh) * Math.sin(ang)]);
    } else {
      const cx = (a[0] ?? 0) * s;
      const cy = (a[1] ?? 0) * s;
      const r = (a[2] ?? 0) * s;
      const sta = a[3] ?? 0;
      const inda = a[4] ? a[4] : num > 0 ? 360 / num : 0;
      for (let k = 0; k < num; k++) pts.push([cx + r * Math.cos((sta + k * inda) * DEG), cy + r * Math.sin((sta + k * inda) * DEG)]);
    }
    const [a0, a1] = PLANE_AXES[this.plane]!;
    const b = new Block();
    for (const [u, v] of pts) {
      // 지금 높이에서 급속으로 자리 잡고 사이클
      b.reset();
      b.set(6, 0, true);
      b.set(LET(AX[a0]!), u / this.axScale[a0]!, true);
      b.set(LET(AX[a1]!), v / this.axScale[a1]!, true);
      b.axAbs = (1 << a0) | (1 << a1);
      this.exec(b, line);
      this.sMotion = 0;
      if (mc && mc.kind === 'cycle') this.sCycle(mc.name, mc.args, line);
    }

  }

  /** 작업 좌표계 이름(G505~G599) */
  protected override wcsLabel(idx: number): string {
    return idx >= 6 ? `G${505 + idx - 6}` : super.wcsLabel(idx);
  }
}

/** 평면 축 a0·a1에서 세 점을 지나는 원: 중심과 방향(시작 → 중간 → 끝이 반시계면 ccw) */
function circle3(s: number[], m: number[], e: number[], a0: number, a1: number): { cu: number; cv: number; ccw: boolean } | null {
  const ax = s[a0]!;
  const ay = s[a1]!;
  const bx = m[a0]!;
  const by = m[a1]!;
  const cx = e[a0]!;
  const cy = e[a1]!;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const scale = Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx - ax, cy - ay), 1e-9);
  if (Math.abs(d) < 1e-12 * scale * scale) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const cu = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const cv = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return { cu, cv, ccw: cross > 0 };
}

function isIdentity(m: Affine): boolean {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  for (let k = 0; k < 12; k++) if (Math.abs(m[k]! - id[k]!) > 1e-12) return false;
  return true;
}

/** Siemens Sinumerik 프로그램을 해석한다 */
export function parseSiemens(src: NcSource, opts: GcodeOptions = {}, head: () => string = () => ''): NcProgram {
  const r = new SiemensRunner(src, opts, head);
  r.run();
  return r.finish(opts);
}

registerDialectParser('siemens', parseSiemens);
