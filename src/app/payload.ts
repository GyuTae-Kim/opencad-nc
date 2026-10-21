/**
 * 워커 쪽 도움(순수 함수): 들어온 바이트가 NC 프로그램으로 읽을 만한지 보고, 해석 결과를 화면에 보낼 자료로 줄인다.
 * 해석기를 가져오므로 화면 코드(app.ts·panel.ts)에서는 부르지 않는다(워커와 시험만).
 */
import { detectNcFormat, type NcFileKind } from '../index';
import { NC_EXTENSIONS, XML_EXTENSIONS } from '../extensions';
import { ncLineMoves, ncTimeline, type NcProgram } from '../model';
import { xmlRootName } from '../xml';
import { BINARY_MESSAGE, looksBinary } from './format';
import type { NcPayload } from './protocol';

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
    moves: { count: m.count, kind: m.kind, points: m.points, line: m.line, tool: m.tool, feed: m.feed },
    timeline: ncTimeline(p),
    lineMoves: ncLineMoves(p),
    tools: p.tools,
    stats: p.stats,
  };
}
