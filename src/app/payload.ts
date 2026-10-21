/**
 * 워커 쪽 도움(순수 함수): 들어온 바이트가 NC 프로그램으로 읽을 만한지 보고, 해석 결과를 화면에 보낼 자료로 줄인다.
 * 해석기를 가져오므로 화면 코드(app.ts·panel.ts)에서는 부르지 않는다(워커와 시험만).
 */
import { combineNcFiles, detectNcFormat, jobFileLines, ncParsedToScene, parseNcFile, splitNcJob, type NcFileKind, type NcParseOptions } from '../index';
import { NC_EXTENSIONS, XML_EXTENSIONS } from '../extensions';
import { ncLineMoves, ncTimeline, type NcProgram } from '../model';
import { xmlRootName } from '../xml';
import { BINARY_MESSAGE, looksBinary } from './format';
import type { NcOpenOptions, NcPayload, ParseResult } from './protocol';

/** 형식마다 워커 진행 글 */
const READING: Record<NcFileKind, string> = {
  gcode: 'G-code 읽는 중',
  heidenhain: 'Heidenhain 프로그램 읽는 중',
  mpr: 'woodWOP MPR 읽는 중',
  pgi: 'WangShi PGI 읽는 중',
  xml: 'WangShi XML 읽는 중',
};

/** 확장자도 내용도 NC로 보이지 않을 때 */
export const NOT_NC_MESSAGE = 'NC 프로그램으로 보이지 않습니다. G-code·Heidenhain 평문(.h)·woodWOP MPR(.mpr)·WangShi PGI(.pgi)·XML(.xml) 파일을 여십시오.';
/** woodWOP MPRX(XML 형식)를 열었을 때 */
export const MPRX_MESSAGE = 'woodWOP MPRX(XML 형식)는 읽지 못합니다. woodWOP에서 MPR(.mpr)로 저장해 여십시오.';
/** WangShi가 아닌 XML을 열었을 때 */
export const OTHER_XML_MESSAGE = 'WangShi PGI(<pgi>)·KDT XML(<KDTPanelFormat>)이 아닌 XML 파일입니다.';

function extOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/**
 * 해석 전 확인: 빈 파일, 글이 아닌 이진 파일, 확장자도 내용도 NC가 아닌 파일을 알기 쉬운 글로 막는다.
 * 읽을 만하면 판별한 형식(모르면 null — 해석기가 G-code로 읽는다)을, 아니면 오류 글을 돌려준다.
 */
export function checkNcInput(name: string, bytes: Uint8Array): { ok: true; kind: NcFileKind | null } | { ok: false; message: string } {
  if (!bytes.length) return { ok: false, message: '빈 파일입니다.' };
  if (looksBinary(bytes.subarray(0, 4096))) return { ok: false, message: BINARY_MESSAGE };
  const kind = detectNcFormat(name, bytes);
  if (!kind) {
    // XML인데 PGI·KDT XML이 아니면 G-code로 읽지 않는다(.xml은 확장자만으로 정하지 않는다)
    const ext = extOf(name);
    const root = xmlRootName(new TextDecoder('latin1').decode(bytes.subarray(0, 4096)));
    if (ext === 'mprx' || ext === 'mprxe' || (root && /mpr|woodwop/i.test(root))) return { ok: false, message: MPRX_MESSAGE };
    if (root || XML_EXTENSIONS.includes(ext)) return { ok: false, message: OTHER_XML_MESSAGE };
    if (!NC_EXTENSIONS.includes(ext)) return { ok: false, message: NOT_NC_MESSAGE };
  }
  return { ok: true, kind };
}

/** NC 모델 → 패널 자료 */
export function ncPayload(p: NcProgram): NcPayload {
  const m = p.moves;
  return {
    kind: p.format,
    dialect: p.dialect,
    units: p.units,
    source: p.source,
    moves: { count: m.count, kind: m.kind, points: m.points, line: m.line, tool: m.tool, feed: m.feed, spindle: m.spindle, flags: m.flags, wcs: m.wcs, modal: m.modal, hNum: m.hNum, dNum: m.dNum, arc: m.arc },
    arcs: { center: p.arcs.center, plane: p.arcs.plane, sweep: p.arcs.sweep },
    timeline: ncTimeline(p),
    lineMoves: ncLineMoves(p),
    tools: p.tools,
    stats: p.stats,
    notices: p.notices ?? [],
    warnItems: p.warningItems ?? [],
    ...(p.feedBounds ? { cutBounds: { min: [p.feedBounds.min[0], p.feedBounds.min[1], p.feedBounds.min[2]], max: [p.feedBounds.max[0], p.feedBounds.max[1], p.feedBounds.max[2]] } } : {}),
  };
}

/** 해석 옵션(화면 고르기) → 해석기 옵션 */
export function parseOptions(kind: NcFileKind | null, o: NcOpenOptions): NcParseOptions {
  return {
    ...(kind ? { kind } : {}),
    gcode: {
      dialect: o.dialect ?? 'auto',
      ...(o.units ? { units: o.units } : {}),
      // 고르지 않았으면 글로 판별(선반처럼 보이면 선반 모드)
      lathe: o.lathe === undefined ? 'auto' : o.lathe,
      ...(o.rotary ? { rotary: true } : {}),
      ...(o.integerUnits ? { integerUnits: true } : {}),
      ...(o.blockDelete ? { blockDelete: true } : {}),
      ...(o.checkToolNumbers === false ? { checkToolNumbers: false } : {}),
      ...(o.machine ? { machine: o.machine } : {}),
    },
    ...(o.machine ? { heidenhain: { machine: o.machine } } : {}),
  };
}

/**
 * 파일 하나를 화면 자료로(워커가 부른다. 시험도 같은 길로): 확인 → 해석 → 장면 → 패널 자료.
 * 읽을 수 없으면 Error(사람이 읽는 글)
 */
export function parseForView(
  name: string,
  bytes: Uint8Array,
  o: NcOpenOptions = {},
  progress: (fraction: number, stage: string) => void = () => {},
  extra: { name: string; bytes: Uint8Array }[] = [],
): ParseResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let base = name.replace(/^.*[\\/]/, '');
  progress(0.05, '파일 확인 중');
  let job: ParseResult['job'];
  // 이미 이은 작업(다시 읽기·최근 문서)이면 파일로 다시 나눈다 — 주 프로그램을 바꾸거나 파일을 더할 때 다시 잇는다
  const parts = splitNcJob(base, bytes);
  if (extra.length || (parts && o.jobMain && o.jobMain !== base)) {
    // 여러 파일을 한 작업으로: 읽을 수 없는 파일(빈·이진·NC 아님)은 빼고 주 프로그램 뒤에 잇는다
    const bad: string[] = [];
    const named = extra.map((f) => ({ name: f.name.replace(/^.*[\\/]/, ''), bytes: f.bytes }));
    // 같은 이름을 다시 더하면 새 파일로 바꾼다
    const kept = (parts ?? [{ name: base, bytes }]).filter((p, k) => k === 0 || !named.some((f) => f.name === p.name));
    const files = [...kept, ...named].filter((f) => checkNcInput(f.name, f.bytes).ok || (bad.push(f.name), false));
    if (!files.length) {
      const c = checkNcInput(base, bytes);
      throw new Error(c.ok ? NOT_NC_MESSAGE : c.message);
    }
    const j = combineNcFiles(files, o.jobMain);
    base = j.main;
    bytes = j.bytes;
    job = { main: j.main, files: j.files, starts: [], skipped: [...bad, ...j.skipped] };
  } else if (parts) job = { main: base, files: parts.map((p) => p.name), starts: [], skipped: [] };
  const check = checkNcInput(base, bytes);
  if (!check.ok) throw new Error(check.message);
  progress(0.15, READING[check.kind ?? 'gcode']);
  const parsed = parseNcFile(base, bytes, parseOptions(check.kind, o));
  progress(0.7, '공구 경로 만드는 중');
  const scene = ncParsedToScene(parsed, { nc: o.comp ? { compPath: true } : {}, mpr: o.mprDisabled ? { disabled: true } : {} });
  progress(0.95, '화면으로 보내는 중');
  const out: ParseResult = { kind: parsed.kind, scene, ms: 0 };
  if ('part' in parsed) out.mpr = { lines: parsed.part.lines };
  else out.nc = ncPayload(parsed.program);
  if (job) {
    // 파일마다 시작 줄(코드 탭에서 그 파일로 가기): 주 프로그램 0, 그다음은 표지 줄
    const marks = 'part' in parsed ? null : jobFileLines(parsed.program.source);
    job.starts = [0, ...(marks ? [...marks.keys()] : [])].slice(0, job.files.length);
    out.job = job;
  }
  out.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return out;
}
