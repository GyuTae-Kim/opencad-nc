import { describe, expect, it } from 'vitest';
import type { Pick3d, Scene3d } from 'opencad-viewer3d';
import { loadNcFile } from '../../src/index';
import { ncSampleProgram, NC_SAMPLE_NAME } from '../../src/view/sample';
import { NOT_NC_MESSAGE, checkNcInput, ncPayload } from '../../src/app/payload';
import { collectTransfers, errorText, sceneHasGeometry, type ParseResult } from '../../src/app/protocol';
import {
  createDoc,
  docLabel,
  lineMoveList,
  moveEndPoint,
  moveSegments,
  moveSummary,
  mprOpAtLine,
  mprOps,
  mprVars,
  panelTabs,
  replaceResult,
  sceneCounts,
  selectedLineText,
  selectionSummary,
  statusParts,
  toolGroup,
  toolItems,
  unitLabel,
  warningLabel,
} from '../../src/app/doc';
import { translate } from '../../site/i18n.mjs';

const enc = new TextEncoder();

/** 워커가 하는 일을 그대로: 해석 → 결과 묶음 */
function parse(name: string, text: string): ParseResult {
  const { parsed, scene } = loadNcFile(name, enc.encode(text));
  const out: ParseResult = { kind: parsed.kind, scene, ms: 12 };
  if ('part' in parsed) out.mpr = { lines: parsed.part.lines };
  else out.nc = ncPayload(parsed.program);
  return out;
}

const MPR = `[H
VERSION="4.0 Alpha"
INCH="0"
_BSX=600.000000
_BSY=400.000000
_BSZ=19.000000

[001
L="600"
KM="Laenge"
B="400"
KM="Breite"

<100 \\WerkStck\\
LA="L"
BR="B"
DI="19"

<101 \\Kommentar\\
KM="Probe"

<102 \\BohrVert\\
XA="100"
YA="100"
TI="12"
DU="8"
MNM="Loch"

<102 \\BohrVert\\
XA="10"
YA="10"
TI="5"
DU="5"
??="L<100"
!
`;

describe('이전 목록(collectTransfers)', () => {
  it('같은 버퍼는 한 번만, 빈 버퍼는 빼고, Map·Set·순환도 따라간다', () => {
    const a = new Float32Array(8);
    const b = new Uint32Array(4);
    const view = new Uint8Array(a.buffer, 4, 4);
    const raw = new ArrayBuffer(16);
    const cyc: Record<string, unknown> = { a, view };
    cyc.self = cyc;
    const list = collectTransfers({ cyc, arr: [b, a, new Uint8Array(0)], m: new Map([['k', raw]]), s: new Set([b]), n: 3, t: 'x', z: null });
    expect(list).toHaveLength(3);
    expect(list).toContain(a.buffer);
    expect(list).toContain(b.buffer);
    expect(list).toContain(raw);
  });

  it('NC 결과를 이전해 보내면 받는 쪽에서 그대로 쓰고 보낸 쪽 버퍼는 비워진다', () => {
    const res = parse(NC_SAMPLE_NAME, ncSampleProgram());
    const moves = res.nc!.moves.count;
    const line5 = res.nc!.moves.line[5];
    const transfer = collectTransfers(res);
    // scene.meta.moveLine은 moves.line과 같은 버퍼 — 한 번만 넣어야 이전이 실패하지 않는다
    expect((res.scene.meta as { moveLine: Uint32Array }).moveLine.buffer).toBe(res.nc!.moves.line.buffer);
    expect(new Set(transfer).size).toBe(transfer.length);
    const got = structuredClone(res, { transfer });
    expect(got.nc!.moves.count).toBe(moves);
    expect(got.nc!.moves.line[5]).toBe(line5);
    expect(got.nc!.source.lineCount).toBeGreaterThan(80);
    expect(res.nc!.moves.line.byteLength).toBe(0);
  });

  it('장면에 그릴 것이 있는지', () => {
    const empty: Scene3d = { name: 'x', units: 'mm', meshes: [], lines: [] };
    expect(sceneHasGeometry(empty)).toBe(false);
    expect(sceneHasGeometry({ ...empty, lines: [{ id: 'l', positions: new Float32Array(6) }] })).toBe(true);
    expect(sceneHasGeometry({ ...empty, points: [{ id: 'p', positions: new Float32Array(3) }] })).toBe(true);
    expect(sceneHasGeometry({ ...empty, meshes: [{ id: 'm', positions: new Float32Array(6), color: [1, 1, 1, 1] }] })).toBe(false);
  });

  it('오류 글', () => {
    expect(errorText(new Error('잘못된 줄'))).toBe('잘못된 줄');
    expect(errorText(new RangeError('Array buffer allocation failed'))).toMatch(/메모리가 모자라/);
    expect(errorText(new TypeError('Failed to fetch'))).toMatch(/네트워크/);
    expect(errorText('그냥 글')).toBe('그냥 글');
    expect(errorText(undefined)).toBe('알 수 없는 오류가 났습니다.');
  });
});

describe('해석 전 확인(checkNcInput)', () => {
  it('빈 파일·이진 자료·NC가 아닌 글을 막는다', () => {
    expect(checkNcInput('a.nc', new Uint8Array(0))).toEqual({ ok: false, message: '빈 파일입니다.' });
    const bin = new Uint8Array(200);
    bin.set(enc.encode('PNG'), 1);
    expect(checkNcInput('a.nc', bin).ok).toBe(false);
    expect(checkNcInput('notes.txt', enc.encode('그냥 메모입니다\n아무것도 없음\n'))).toEqual({ ok: false, message: NOT_NC_MESSAGE });
  });

  it('확장자나 내용으로 형식을 고른다', () => {
    expect(checkNcInput('part.NC', enc.encode('(empty)\n'))).toEqual({ ok: true, kind: 'gcode' });
    expect(checkNcInput('part.txt', enc.encode('G0 X0 Y0 Z5\nG1 X10 Y0 Z0 F100\nG1 X10 Y10\nM30\n'))).toEqual({ ok: true, kind: 'gcode' });
    expect(checkNcInput('teil.H', enc.encode('0 BEGIN PGM TEIL MM\n1 END PGM TEIL MM\n'))).toEqual({ ok: true, kind: 'heidenhain' });
    expect(checkNcInput('board.dat', enc.encode(MPR))).toEqual({ ok: true, kind: 'mpr' });
  });
});

describe('G-code 문서', () => {
  const res = parse(NC_SAMPLE_NAME, ncSampleProgram());
  const nc = res.nc!;

  it('문서 만들기·탭·이름표', () => {
    const d = createDoc(NC_SAMPLE_NAME, 1234, res, { dialect: 'auto' });
    expect(d.kind).toBe('gcode');
    expect(d.panelTab).toBe('code');
    expect(panelTabs(d).map(([k]) => k)).toEqual(['code', 'tools', 'info', 'sim']);
    expect(docLabel(d)).toMatch(/^G-code · /);
    expect(unitLabel(d.scene.units)).toBe('mm');
    expect(unitLabel('inch')).toBe('in');
    const st = statusParts(d);
    expect(st[1]).toBe('단위 mm');
    expect(st[2]).toBe('1.21 KB');
    expect(st).toContain(`이동 ${nc.moves.count.toLocaleString('ko-KR')}개`);
    expect(st.at(-1)).toBe('읽기 12 ms');
    expect(sceneCounts(d.scene).segments).toBeGreaterThan(nc.moves.count);
  });

  it('줄 ↔ 이동 ↔ 선분', () => {
    // 표본 프로그램에서 G2 호가 있는 줄을 찾는다
    let arcLine = -1;
    for (let i = 0; i < nc.source.lineCount && arcLine < 0; i++) if (/^G2 /.test(new TextDecoder().decode(nc.source.bytes.subarray(nc.source.lineStart[i]!, nc.source.lineStart[i + 1]!)))) arcLine = i;
    expect(arcLine).toBeGreaterThan(0);
    const moves = lineMoveList(nc, arcLine);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(nc.moves.line[m]).toBe(arcLine);
    const segs = moveSegments(res.scene, moves);
    // 호는 여러 선분으로 나뉜다
    expect(segs.length / 6).toBeGreaterThan(moves.length);
    // 마지막 선분 끝 = 이동의 끝점
    const end = moveEndPoint(nc, moves.at(-1)!)!;
    expect(segs[segs.length - 3]).toBeCloseTo(end[0], 3);
    expect(segs[segs.length - 2]).toBeCloseTo(end[1], 3);
    expect(moveSegments(res.scene, moves, 2).length).toBe(12);
    expect(lineMoveList(nc, -1)).toEqual([]);
    expect(lineMoveList(nc, 1e9)).toEqual([]);
    expect(moveEndPoint(nc, -1)).toBeNull();
    expect(moveSummary(nc, moves[0]!)).toMatch(/^원호 이송 · T1 · F/);
  });

  it('공구 묶음', () => {
    expect(toolGroup(res.scene, 1)).toBeTruthy();
    expect(toolItems(res.scene, 3)).toContain('nc-drill-3');
    expect(toolGroup(res.scene, 99)).toBeNull();
    expect(toolItems(res.scene, 99)).toEqual([]);
  });

  it('고른 것 요약', () => {
    const d = createDoc(NC_SAMPLE_NAME, 100, res);
    expect(selectionSummary(null)).toBe('');
    expect(selectionSummary(d)).toBe('');
    expect(selectionSummary(d, true)).toMatch(/^측정/);
    d.selLine = 0;
    d.selMoves = [];
    expect(selectionSummary(d)).toBe('줄 1 · 이동 없음');
    expect(selectedLineText(d)).toBe('%');
    const m = nc.moves.count - 1;
    d.selLine = nc.moves.line[m]!;
    d.selMoves = [m];
    d.pick = { kind: 'line', id: 'nc-rapid', index: m, point: [1, 2, 3] } satisfies Pick3d;
    expect(selectionSummary(d)).toMatch(new RegExp(`^줄 ${d.selLine + 1} · .+ · 1, 2, 3$`));
    d.measure = { a: [0, 0, 0], b: [3, 4, 0], distance: 5, dx: 3, dy: 4, dz: 0 };
    expect(selectionSummary(d)).toBe('거리 5 mm · dx 3 · dy 4 · dz 0');
  });

  it('다시 읽은 결과로 바꾸면 고른 것·재생이 지워진다', () => {
    const d = createDoc(NC_SAMPLE_NAME, 100, res);
    d.selLine = 3;
    d.selMoves = [1];
    d.playSec = 2;
    d.hiddenGroups.add('급속 이송');
    d.panelTab = 'tools';
    replaceResult(d, parse(NC_SAMPLE_NAME, ncSampleProgram()), { dialect: 'linuxcnc' });
    expect(d.selLine).toBe(-1);
    expect(d.selMoves).toEqual([]);
    expect(d.playSec).toBeNull();
    expect(d.hiddenGroups.size).toBe(0);
    expect(d.panelTab).toBe('tools');
    expect(d.ncOptions).toEqual({ dialect: 'linuxcnc' });
  });
});

describe('MPR 문서', () => {
  const res = parse('board.mpr', MPR);
  it('가공·변수·탭·요약', () => {
    const d = createDoc('board.mpr', MPR.length, res);
    expect(d.kind).toBe('mpr');
    expect(d.nc).toBeNull();
    expect(d.panelTab).toBe('ops');
    expect(panelTabs(d).map(([k]) => k)).toEqual(['ops', 'vars', 'code', 'info']);
    expect(docLabel(d)).toBe('woodWOP MPR 4.0 Alpha');
    const ops = mprOps(d.scene);
    expect(ops.map((o) => o.kind)).toEqual(['comment', 'drillV', 'drillV']);
    expect(ops[2]!.enabled).toBe(false);
    expect(mprVars(d.scene).map((v) => [v.name, v.value])).toEqual([
      ['L', 600],
      ['B', 400],
    ]);
    expect(statusParts(d)).toContain('가공 3개');
    // 줄 → 그 줄을 품은 가공
    const drillLine = ops[1]!.line!;
    expect(mprOpAtLine(ops, drillLine + 2)).toBe(1);
    expect(mprOpAtLine(ops, 0)).toBe(-1);
    d.selKey = '2';
    expect(selectionSummary(d)).toBe('가공 3 · BohrVert · 꺼짐');
    d.selKey = '1';
    expect(selectionSummary(d)).toBe('가공 2 · Loch');
    d.selLine = drillLine;
    expect(selectedLineText(d)).toBe('<102 \\BohrVert\\');
  });
});

describe('다른 언어로 옮긴 상태 막대·고른 것 요약·경고', () => {
  const LANGS = ['en', 'ja', 'zh-CN', 'de'];
  const hangul = /[가-힣]/;
  it('상태 막대 개수·경고 단추와 고른 줄 요약("줄 N · 이동 N개")', () => {
    const res = parse(NC_SAMPLE_NAME, ncSampleProgram());
    const nc = res.nc!;
    const d = createDoc(NC_SAMPLE_NAME, 1234, res);
    const counts = statusParts(d).filter((p) => /^(이동|선분) /.test(p));
    expect(counts.length).toBe(2);
    d.selLine = 0;
    d.selMoves = [];
    const none = selectionSummary(d);
    const line = nc.moves.line[nc.moves.count - 1]!;
    d.selLine = line;
    d.selMoves = lineMoveList(nc, line);
    const some = selectionSummary(d);
    expect(some).toMatch(/^줄 [\d,]+ · 이동 [\d,]+개$/);
    const warn = warningLabel(createDoc('w.nc', 1, parse('w.nc', 'G1 X1 F100\nG1 X[1+\nG1 X2\n')));
    expect(warn).toMatch(/^경고 \d+개$/);
    for (const lang of LANGS) for (const t of [...counts, none, some, warn]) expect(translate(t, lang), `${lang}: ${t}`).not.toMatch(hangul);
    expect(translate(none, 'en')).toBe('Line 1 · No move');
    expect(translate(some, 'en')).toMatch(/^Line [\d,]+ · Moves [\d,]+$/);
    expect(translate(`이동 ${nc.moves.count.toLocaleString('ko-KR')}개`, 'en')).toBe(`Moves ${nc.moves.count.toLocaleString('ko-KR')}`);
  });
  it('읽을 수 없는 블록: 안쪽 까닭까지 그 언어로', () => {
    const res = parse('bad.nc', 'G1 X1 F100\nG1 X[1+\nG1 X[1+$]\n#2=FOO[1]\nG1 X2\n');
    const texts = res.nc!.warnItems.map((w) => w.text).filter((t) => t.startsWith('읽을 수 없는 블록 — '));
    expect(texts.length).toBe(3);
    for (const lang of LANGS) for (const t of texts) expect(translate(t, lang), `${lang}: ${t}`).not.toMatch(hangul);
    expect(translate("읽을 수 없는 블록 — 알 수 없는 글자 '('", 'en')).toBe("Unreadable block — Unknown character '('");
    expect(translate('읽을 수 없는 블록 — 식이 끝났다', 'de')).toMatch(/^Nicht lesbarer Block — [^가-힣]+$/);
  });
  it('여러 파일 작업의 줄 요약("O1001.nc · 줄 4 · 이동 2개"): 파일 이름은 그대로, 나머지는 그 언어로', () => {
    for (const t of ['O1001.nc · 줄 4 · 이동 2개', 'O1001.nc · 줄 1,204 · 이동 없음', 'O1001.nc · 4번 줄'])
      for (const lang of LANGS) expect(translate(t, lang), `${lang}: ${t}`).toMatch(/^O1001\.nc · [^가-힣]+$/);
    expect(translate('O1001.nc · 줄 4 · 이동 2개', 'en')).toBe('O1001.nc · Line 4 · Moves 2');
  });
});
