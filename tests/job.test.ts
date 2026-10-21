import { describe, expect, it } from 'vitest';
import { combineNcFiles, parseNcFile, splitNcJob, type NcJobFile } from '../src/index';
import { moveEnd, type NcProgram } from '../src/model';
import { parseForView } from '../src/app/payload';

const enc = new TextEncoder();
const dec = new TextDecoder();
const file = (name: string, text: string): NcJobFile => ({ name, bytes: enc.encode(text) });
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const ends = (p: NcProgram): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.moves.count; i++) out.push(moveEnd(p.moves, i).map(r3));
  return out;
};
const prog = (name: string, bytes: Uint8Array): NcProgram => {
  const r = parseNcFile(name, bytes);
  if ('part' in r) throw new Error('panel');
  return r.program;
};
const joined = (files: NcJobFile[], main?: string): NcProgram => {
  const j = combineNcFiles(files, main);
  return prog(j.main, j.bytes);
};

// ── Fanuc: M98 P(O 줄 있는 파일·파일 이름만 있는 파일)·G65 매크로 ──
const MAIN = `%
O1000 (MAIN)
G21 G17 G90 G54
T1 M6
S1000 M3
G0 X0 Y0 Z5
M98 P1001
G0 X100 Y0
M98 P1002 L2
G65 P2000 A5.
G0 Z50
M30
%
`;
const SUB_A = `%
O1001 (SUB A)
G1 Z-1 F100
X10
G0 Z5
M99
%
`;
const SUB_B = `G91 G1 X5 F100
G90
M99
`;
const MACRO = `O2000
G1 Y#1 F100
M99
`;
// 첫 G0 X0 Y0 Z5는 시작 자리(처음 자리를 모르므로 이동으로 세지 않는다)
const FANUC_ENDS = [
  [0, 0, -1],
  [10, 0, -1],
  [10, 0, 5],
  [100, 0, 5],
  [105, 0, 5],
  [110, 0, 5],
  [110, 5, 5],
  [110, 5, 50],
];

describe('여러 파일을 한 작업으로(G-code)', () => {
  it('다른 파일의 O 번호(O 줄·파일 이름)와 G65 매크로를 찾아 그리고, 주 프로그램은 다음 파일 앞에서 끝난다', () => {
    const files = [file('O1001.nc', SUB_A), file('main.nc', MAIN), file('1002.nc', SUB_B), file('O2000.nc', MACRO)];
    const j = combineNcFiles(files);
    expect(j.main).toBe('main.nc');
    expect(j.files).toEqual(['main.nc', 'O1001.nc', '1002.nc', 'O2000.nc']);
    expect(j.skipped).toEqual([]);
    const text = dec.decode(j.bytes);
    expect(text).toContain('(OPENCAD-JOB-FILE O1001.nc)\n');
    const p = prog(j.main, j.bytes);
    expect(ends(p)).toEqual(FANUC_ENDS);
    expect(p.warnings.filter((w) => w.includes('찾지 못함'))).toEqual([]);
    expect(p.notices?.some((n) => n.kind === 'missing-program')).toBeFalsy();
  });

  it('부프로그램 파일이 없으면 찾지 못한 프로그램을 경고와 띠(missing-program)로 알린다', () => {
    const p = prog('main.nc', enc.encode(MAIN));
    expect(p.warnings.some((w) => w.includes('M98 P1001: O1001를 찾지 못함 — 다른 파일이면 함께 열어야 읽음'))).toBe(true);
    expect(p.notices?.find((n) => n.kind === 'missing-program')?.programs).toEqual(['O1001', 'O1002', 'O2000']);
    // O9000번대 G65는 기계에 든 매크로로 알린다
    const probe = prog('p.nc', enc.encode('G21 G90\nG0 X0 Y0 Z5\nG65 P9810 X10. Y10.\nG0 X20\nM30\n'));
    expect(probe.warnings.some((w) => w.includes('기계에 든 매크로(O9000번대)'))).toBe(true);
  });

  it('M99 없이 파일 끝에 닿은 부프로그램은 부른 곳으로 돌아가고, M30 없는 주 프로그램은 다음 파일 앞에서 멈춘다', () => {
    const p = joined([file('main.nc', 'G21 G90\nG0 X0 Y0 Z5\nM98 P7\nG0 X50\n'), file('O0007.nc', 'G1 X10 F100\n')]);
    expect(ends(p)).toEqual([
      [10, 0, 5],
      [50, 0, 5],
    ]);
  });

  it('LinuxCNC o<이름> call은 다른 파일의 o<이름> sub를 찾는다', () => {
    const p = joined([
      file('main.ngc', 'G21 G90\nG0 X0 Y0 Z5\no<hole> call [3]\nG0 X20\nM2\n'),
      file('hole.ngc', 'o<hole> sub\nG1 Z[-#1] F50\nG0 Z5\no<hole> endsub\nM2\n'),
    ]);
    expect(ends(p)).toEqual([
      [0, 0, -3],
      [0, 0, 5],
      [20, 0, 5],
    ]);
  });

  it('주 프로그램을 고를 수 있고, 형식이 다른 파일(MPR)은 잇지 않는다', () => {
    const files = [file('main.nc', MAIN), file('O1001.nc', SUB_A), file('part.mpr', '[H\nVERSION="4.0"\n]\n<100 \\WerkStck\\\nLA="100"\n')];
    const j = combineNcFiles(files, 'O1001.nc');
    expect(j.main).toBe('O1001.nc');
    expect(j.files).toEqual(['O1001.nc', 'main.nc']);
    expect(j.skipped).toEqual(['part.mpr']);
  });

  it('주 프로그램을 고르지 않으면 M30으로 끝나고 다른 파일이 부르지 않는 파일', () => {
    // 아무도 부르지 않는 두 파일: M30으로 끝나는 쪽
    expect(combineNcFiles([file('a.nc', 'G0 X1 Y1 Z1\nM99\n'), file('b.nc', 'G0 X2 Y2 Z2\nM30\n')]).main).toBe('b.nc');
    // UTF-8 BOM은 이은 글 가운데에서 뗀다
    const bom = combineNcFiles([file('m.nc', 'G0 X1 Y1 Z1\nM98 P5\nM30\n'), { name: 'O0005.nc', bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('G1 X5 F100\nM99')]) }]);
    expect(dec.decode(bom.bytes)).toBe('G0 X1 Y1 Z1\nM98 P5\nM30\n(OPENCAD-JOB-FILE O0005.nc)\nG1 X5 F100\nM99\n');
  });

  it('이은 글을 다시 파일로 나누고(splitNcJob) 같은 글이 된다', () => {
    const j = combineNcFiles([file('main.nc', MAIN), file('O1001.nc', SUB_A)]);
    const parts = splitNcJob(j.main, j.bytes)!;
    expect(parts.map((p) => p.name)).toEqual(['main.nc', 'O1001.nc']);
    expect(dec.decode(parts[1]!.bytes)).toBe(SUB_A);
    expect(dec.decode(combineNcFiles(parts, 'main.nc').bytes)).toBe(dec.decode(j.bytes));
    expect(splitNcJob('x.nc', enc.encode(MAIN))).toBeNull();
  });
});

describe('여러 파일을 한 작업으로(Siemens)', () => {
  it('L 번호 파일과 %_N_…_SPF·PROC 머리가 있는 파일을 이름으로 부른다(인수 포함)', () => {
    const files = [
      file('L100.SPF', 'G91 G1 X5 F200\nG90\nM17\n'),
      file('MAIN.MPF', '%_N_MAIN_MPF\nN10 G90 G17 G54 G71\nN20 G0 X0 Y0 Z10\nN30 L100\nN40 POCKETA(7)\nN50 G0 Z50\nN60 M30\n'),
      file('POCKETA.SPF', '%_N_POCKETA_SPF\n;$PATH=/_N_SPF_DIR\nPROC POCKETA(REAL DEPTH)\nG1 Z=-DEPTH F100\nG0 Z10\nRET\n'),
    ];
    const j = combineNcFiles(files);
    expect(j.main).toBe('MAIN.MPF');
    expect(dec.decode(j.bytes)).toContain('; OPENCAD-JOB-FILE L100.SPF\n');
    const p = prog(j.main, j.bytes);
    expect(p.dialect).toBe('siemens');
    expect(ends(p)).toEqual([
      [5, 0, 10],
      [5, 0, -7],
      [5, 0, 10],
      [5, 0, 50],
    ]);
    expect(p.warnings.filter((w) => w.includes('찾지 못함'))).toEqual([]);
  });
});

describe('여러 파일을 한 작업으로(Heidenhain)', () => {
  const MAIN_H = `0 BEGIN PGM MAIN MM
1 BLK FORM 0.1 Z X+0 Y+0 Z-20
2 BLK FORM 0.2 X+100 Y+100 Z+0
3 TOOL CALL 1 Z S2000
4 L X+0 Y+0 Z+10 R0 FMAX M3
5 CALL PGM TNC:\\PARTS\\SUB1.H
6 CALL LBL 1
7 L Z+50 R0 FMAX
8 M30
9 LBL 1
10 L X+50 Y+50 R0 FMAX
11 LBL 0
12 END PGM MAIN MM
`;
  const SUB1 = `0 BEGIN PGM SUB1 MM
1 L X+20 Y+0 R0 FMAX
2 CALL LBL 1
3 L Z+10 R0 FMAX
4 END PGM SUB1 MM
5 LBL 1
6 L Z-2 R0 F100
7 LBL 0
`;
  const H_ENDS = [
    [20, 0, 10],
    [20, 0, -2],
    [20, 0, 10],
    [50, 50, 10],
    [50, 50, 50],
  ];
  it('CALL PGM은 함께 연 파일을 부르고 END PGM에서 돌아온다(표지는 프로그램마다 따로)', () => {
    const j = combineNcFiles([file('SUB1.H', SUB1), file('MAIN.H', MAIN_H)]);
    expect(j.main).toBe('MAIN.H');
    const p = prog(j.main, j.bytes);
    expect(ends(p)).toEqual(H_ENDS);
    expect(p.warnings.filter((w) => w.includes('찾지 못함'))).toEqual([]);
    // 없으면 경고와 띠
    const alone = prog('MAIN.H', enc.encode(MAIN_H));
    expect(alone.warnings.some((w) => w.includes('CALL PGM SUB1: 프로그램을 찾지 못함'))).toBe(true);
    expect(alone.notices?.find((n) => n.kind === 'missing-program')?.programs).toEqual(['SUB1']);
  });

  it('SEL PGM … CALL SELECTED PGM과 DIN/ISO %이름 부르기', () => {
    const sel = MAIN_H.replace('5 CALL PGM TNC:\\PARTS\\SUB1.H', '5 SEL PGM "SUB1"\n5 CALL SELECTED PGM');
    expect(ends(joined([file('MAIN.H', sel), file('SUB1.H', SUB1)]))).toEqual(H_ENDS);
    const iso = joined([
      file('MAINI.I', '%MAINI G71 *\nN10 G30 G17 X+0 Y+0 Z-20 *\nN20 G31 X+100 Y+100 Z+0 *\nN30 T1 G17 S2000 *\nN40 G00 X+0 Y+0 Z+10 *\nN50 %SUBI *\nN60 G00 Z+50 *\nN99999 %MAINI G71 *\n'),
      file('SUBI.I', '%SUBI G71 *\nN10 G01 X+30 Y+0 F200 *\nN99999 %SUBI G71 *\n'),
    ]);
    expect(ends(iso).slice(-2)).toEqual([
      [30, 0, 10],
      [30, 0, 50],
    ]);
  });
});

describe('화면 자료(parseForView): 함께 연 파일·다시 읽기·주 프로그램 바꾸기·더하기', () => {
  const b = (t: string): Uint8Array => enc.encode(t);
  it('함께 연 파일을 잇고, 이은 글을 다시 읽으면(최근 문서·설정 바꿈) 같은 작업으로 읽는다', () => {
    const r = parseForView('O1001.nc', b(SUB_A), {}, () => {}, [
      { name: 'dir/main.nc', bytes: b(MAIN) },
      { name: '1002.nc', bytes: b(SUB_B) },
      { name: 'O2000.nc', bytes: b(MACRO) },
      { name: 'photo.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) },
    ]);
    expect(r.job).toEqual({ main: 'main.nc', files: ['main.nc', 'O1001.nc', '1002.nc', 'O2000.nc'], starts: [0, 13, 21, 25], skipped: ['photo.png'] });
    expect(r.nc!.stats.moveCount).toBe(FANUC_ENDS.length);
    const again = parseForView('main.nc', r.nc!.source.bytes.slice());
    expect(again.job).toEqual({ main: 'main.nc', files: ['main.nc', 'O1001.nc', '1002.nc', 'O2000.nc'], starts: [0, 13, 21, 25], skipped: [] });
    expect(again.nc!.stats.moveCount).toBe(FANUC_ENDS.length);
    // 주 프로그램 바꾸기: 이은 글을 나눠 다시 잇는다
    const sw = parseForView('main.nc', r.nc!.source.bytes.slice(), { jobMain: 'O1001.nc' });
    expect(sw.job!.main).toBe('O1001.nc');
    expect(sw.job!.files[0]).toBe('O1001.nc');
    expect(dec.decode(sw.nc!.source.bytes).startsWith(SUB_A)).toBe(true);
    expect(sw.nc!.source.lineCount).toBe(r.nc!.source.lineCount);
  });

  it('열린 작업에 파일을 더하면(같은 이름은 바꾼다) 찾지 못했던 부르기를 읽는다', () => {
    const one = parseForView('main.nc', b(MAIN));
    expect(one.job).toBeUndefined();
    expect(one.nc!.notices?.find((n) => n.kind === 'missing-program')?.programs).toEqual(['O1001', 'O1002', 'O2000']);
    const two = parseForView('main.nc', b(MAIN), { jobMain: 'main.nc' }, () => {}, [{ name: 'O1001.nc', bytes: b(SUB_A) }]);
    expect(two.job!.files).toEqual(['main.nc', 'O1001.nc']);
    expect(two.nc!.notices?.find((n) => n.kind === 'missing-program')?.programs).toEqual(['O1002', 'O2000']);
    const three = parseForView('main.nc', two.nc!.source.bytes.slice(), { jobMain: 'main.nc' }, () => {}, [
      { name: 'O1001.nc', bytes: b(SUB_A) },
      { name: '1002.nc', bytes: b(SUB_B) },
      { name: 'O2000.nc', bytes: b(MACRO) },
    ]);
    expect(three.job!.files).toEqual(['main.nc', 'O1001.nc', '1002.nc', 'O2000.nc']);
    expect(three.nc!.notices?.some((n) => n.kind === 'missing-program')).toBeFalsy();
    expect(three.nc!.stats.moveCount).toBe(FANUC_ENDS.length);
  });
});
