/**
 * NC 형식(G-code·Heidenhain 평문·woodWOP MPR·WangShi PGI·KDT XML) 공개 진입점.
 * 파일 이름·앞부분으로 형식을 고르고, 모델과 장면을 만든다. DOM·WebGL 없이 돈다(워커 가능).
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import { detectGcodeDialect, parseGcode, type GcodeOptions } from './gcode';
// Siemens 해석기를 G-code 방언으로 등록한다(parseGcode가 dialect 'siemens'면 부른다)
import './siemens';
import { parseHeidenhain, type HeidenhainOptions } from './heidenhain';
import type { NcProgram } from './model';
import { looksLikeMpr, parseMpr, type MprOptions, type MprPart } from './mpr';
import { mprToScene, ncToScene, type MprSceneOptions, type NcSceneOptions } from './scene';
import { GCODE_EXTENSIONS, HEIDENHAIN_EXTENSIONS, MPR_EXTENSIONS, PGI_EXTENSIONS, type PanelFileKind } from './extensions';
import { makeSource } from './text';
import { combineNcJob, type NcJob, type NcJobFile } from './job';
import { looksLikeKdtXml, looksLikePgi, parseKdtXml, parsePgi, type PanelReadOptions } from './wangs';

export * from './model';
export { parseGcode, detectGcodeDialect, detectLathe, jobFileLines, looksSiemens, type GcodeOptions } from './gcode';
export { parseSiemens } from './siemens';
export { ncCompPath, compPathSegments, type NcCompPath, type CompPathOptions } from './comp';
export { parseHeidenhain, type HeidenhainOptions } from './heidenhain';
export { parseMpr, looksLikeMpr, type MprPart, type MprOperation, type MprContour, type MprContourElement, type MprDrillOp, type MprContourOp, type MprBoxOp, type MprOtherOp, type MprHole, type MprWorkpiece, type MprVariable, type MprOptions, type PanelFace } from './mpr';
export { parsePgi, parseKdtXml, looksLikePgi, looksLikeKdtXml, type PanelReadOptions } from './wangs';
export { parseXml, xmlRootName, type XmlElement } from './xml';
export { ncToScene, mprToScene, toolColors, type NcSceneOptions, type MprSceneOptions, type PanelSnapTable } from './scene';
export { makeSource, sourceLine, splitLines, type NcSource } from './text';
export { evalMprExpr } from './expr';
export { combineNcJob, splitNcJob, type NcJob, type NcJobFile } from './job';

export type NcFileKind = 'gcode' | 'heidenhain' | PanelFileKind;

export { GCODE_EXTENSIONS, HEIDENHAIN_EXTENSIONS, MPR_EXTENSIONS, PGI_EXTENSIONS, XML_EXTENSIONS, NC_EXTENSIONS, isPanelKind, type PanelFileKind } from './extensions';

function ext(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/**
 * 형식 판별. 앞부분 글로 먼저 보고(MPR·PGI·KDT XML·Heidenhain 표지), 없으면 확장자, 그래도 모르면 G-code로 본다.
 * .xml은 확장자만으로 정하지 않는다(뿌리가 <KDTPanelFormat>일 때만). G-code처럼 보이지도 않으면 null.
 */
export function detectNcFormat(name: string, data: Uint8Array | string): NcFileKind | null {
  const head = typeof data === 'string' ? data.slice(0, 65536) : new TextDecoder('latin1').decode(data.subarray(0, 65536));
  if (looksLikeMpr(head)) return 'mpr';
  if (looksLikePgi(head)) return 'pgi';
  if (looksLikeKdtXml(head)) return 'xml';
  if (detectGcodeDialect(head) === 'heidenhain') return 'heidenhain';
  const e = ext(name);
  if (MPR_EXTENSIONS.includes(e)) return 'mpr';
  if (PGI_EXTENSIONS.includes(e)) return 'pgi';
  if (HEIDENHAIN_EXTENSIONS.includes(e)) return 'heidenhain';
  if (GCODE_EXTENSIONS.includes(e)) return 'gcode';
  // 내용으로: G·M 낱말이 여럿 보이면 G-code
  const words = head.match(/(?:^|[\s\dA-Z])[GM]\s*\d{1,3}\b/gim)?.length ?? 0;
  const axes = head.match(/[XYZ]\s*[-+]?\d*\.?\d+/gi)?.length ?? 0;
  return words >= 3 && axes >= 3 ? 'gcode' : null;
}

/** 여러 파일을 한 작업으로 잇는다(주 프로그램 + 부프로그램·불리는 프로그램 파일, job.ts). main = 주 프로그램 파일 이름(없으면 고른다) */
export function combineNcFiles(files: NcJobFile[], main?: string): NcJob {
  return combineNcJob(files, detectNcFormat, main);
}

export type NcParsed = { kind: 'gcode' | 'heidenhain'; program: NcProgram } | { kind: PanelFileKind; part: MprPart };

export interface NcParseOptions {
  gcode?: GcodeOptions;
  heidenhain?: HeidenhainOptions;
  mpr?: MprOptions;
  /** PGI·KDT XML */
  panel?: PanelReadOptions;
  /** 형식을 정해 줄 때 */
  kind?: NcFileKind;
}

/** 파일을 해석한다(형식은 자동 판별). 이름은 프로그램 이름으로도 쓴다 */
export function parseNcFile(name: string, data: Uint8Array | ArrayBuffer | string, opts: NcParseOptions = {}): NcParsed {
  const bytes = typeof data === 'string' ? data : data instanceof Uint8Array ? data : new Uint8Array(data);
  const kind = opts.kind ?? detectNcFormat(name, bytes) ?? 'gcode';
  const base = name.replace(/^.*[\\/]/, '');
  if (kind === 'mpr') return { kind, part: parseMpr(bytes, { name: base, ...opts.mpr }) };
  if (kind === 'pgi') return { kind, part: parsePgi(bytes, { name: base, ...opts.panel }) };
  if (kind === 'xml') return { kind, part: parseKdtXml(bytes, { name: base, ...opts.panel }) };
  const src = makeSource(bytes);
  if (kind === 'heidenhain') return { kind, program: parseHeidenhain(src, { name: base, ...opts.heidenhain }) };
  return { kind: 'gcode', program: parseGcode(src, { name: base, ...opts.gcode }) };
}

/** 해석 결과를 장면으로 */
export function ncParsedToScene(p: NcParsed, opts: { nc?: NcSceneOptions; mpr?: MprSceneOptions } = {}): Scene3d {
  return 'part' in p ? mprToScene(p.part, opts.mpr) : ncToScene(p.program, opts.nc);
}

/** 파일 → 모델 + 장면(한 번에) */
export function loadNcFile(
  name: string,
  data: Uint8Array | ArrayBuffer | string,
  opts: NcParseOptions & { scene?: { nc?: NcSceneOptions; mpr?: MprSceneOptions } } = {},
): { parsed: NcParsed; scene: Scene3d } {
  const parsed = parseNcFile(name, data, opts);
  return { parsed, scene: ncParsedToScene(parsed, opts.scene) };
}
