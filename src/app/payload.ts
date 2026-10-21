/**
 * 워커 쪽 도움(순수 함수): 들어온 바이트가 NC 프로그램으로 읽을 만한지 보고, 해석 결과를 화면에 보낼 자료로 줄인다.
 * 해석기를 가져오므로 화면 코드(app.ts·panel.ts)에서는 부르지 않는다(워커와 시험만).
 */
import { detectNcFormat, ncParsedToScene, parseNcFile, type NcFileKind, type NcParseOptions } from '../index';
import { NC_EXTENSIONS } from '../extensions';
import { ncLineMoves, ncTimeline, type NcProgram } from '../model';
import { BINARY_MESSAGE, looksBinary } from './format';
import type { NcOpenOptions, NcPayload, ParseResult } from './protocol';

/** 확장자도 내용도 NC로 보이지 않을 때 */
export const NOT_NC_MESSAGE = 'NC 프로그램으로 보이지 않습니다. G-code·Heidenhain 평문(.h)·woodWOP MPR(.mpr) 파일을 여십시오.';

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
  if (!kind && !NC_EXTENSIONS.includes(extOf(name))) return { ok: false, message: NOT_NC_MESSAGE };
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
export function parseForView(name: string, bytes: Uint8Array, o: NcOpenOptions = {}, progress: (fraction: number, stage: string) => void = () => {}): ParseResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const base = name.replace(/^.*[\\/]/, '');
  progress(0.05, '파일 확인 중');
  const check = checkNcInput(base, bytes);
  if (!check.ok) throw new Error(check.message);
  progress(0.15, check.kind === 'mpr' ? 'woodWOP MPR 읽는 중' : check.kind === 'heidenhain' ? 'Heidenhain 프로그램 읽는 중' : 'G-code 읽는 중');
  const parsed = parseNcFile(base, bytes, parseOptions(check.kind, o));
  progress(0.7, '공구 경로 만드는 중');
  const scene = ncParsedToScene(parsed, { nc: o.comp ? { compPath: true } : {}, mpr: o.mprDisabled ? { disabled: true } : {} });
  progress(0.95, '화면으로 보내는 중');
  const out: ParseResult = { kind: parsed.kind, scene, ms: 0 };
  if (parsed.kind === 'mpr') out.mpr = { lines: parsed.part.lines };
  else out.nc = ncPayload(parsed.program);
  out.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return out;
}
