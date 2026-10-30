/**
 * 29차: LinuxCNC 반경 보정의 길이 규칙과 여러 급속(LinuxCNC 설명서 G-code 절 "G40"·"G41, G42"와 "Cutter Compensation"의 Programming Entry Moves).
 * - 들어가기 이동은 공구 반지름 이상("The lead in move must be at least as long as the tool radius") — 짧으면 경고
 * - G40 뒤 첫 이동은 공구 지름보다 긴 직선이어야 하고, 원호이거나 더 짧은 직선이면 LinuxCNC가 오류로 멈춘다 — 경고(Z만 움직이면 보지 않음)
 * - G41/G42 뒤 급속이 여럿이면 마지막 급속만 보정 자리로 간다 — 앞 급속은 보정 없이 그리고 마지막 급속을 들어가기로 본다
 * LinuxCNC 방언에만 쓰고, 다른 방언(ISO·Fanuc)은 예전과 같다. 밀링(XY)·선반(XZ) 모두. 합성 프로그램만 쓴다.
 */
import { describe, expect, it } from 'vitest';
import { ncCompPath, type NcCompPath } from '../src/comp';
import { parseGcode, type GcodeOptions } from '../src/gcode';
import { ncToScene } from '../src/scene';
import { languages, translate } from '../site/i18n.mjs';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
/** 조각 시작·끝(xy) */
const xy = (c: NcCompPath): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < c.count; i++) out.push([c.points[i * 6]!, c.points[i * 6 + 1]!, c.points[i * 6 + 3]!, c.points[i * 6 + 4]!].map(r3));
  return out;
};
/** 조각 시작·끝(선반 XZ 단면 — [시작 Z, 시작 X, 끝 Z, 끝 X]) */
const zx = (c: NcCompPath): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < c.count; i++) out.push([c.points[i * 6 + 2]!, c.points[i * 6]!, c.points[i * 6 + 5]!, c.points[i * 6 + 3]!].map(r3));
  return out;
};
const run = (text: string, opts: GcodeOptions = {}) => parseGcode(text, { initialPosition: [0, 0, 0], ...opts });
const LCNC: GcodeOptions = { dialect: 'linuxcnc' };
const ISO: GcodeOptions = { dialect: 'iso' };

/** 시계 방향 정사각형(0,0)-(0,50)-(50,50)-(50,0), 공구 지름 10(주석). pre = 보정 켜기와 들어가기, post = 보정 끄기와 나오기 */
const square = (pre: string, post = 'G40 G1 X-20 Y-20'): string => `G21 G90 G17
(T1 D=10. FLAT END MILL)
T1 M6
G0 X-40 Y-40 Z5
${pre}
G1 Z-2 F100
G1 Y50 F500
X50
Y0
X0
${post}
G0 Z5
M2`;

describe('LinuxCNC 반경 보정: G41/G42 뒤 여러 급속', () => {
  const two = square('G41 D1\nG0 X-30 Y-20\nG0 X0 Y0');

  it('마지막 급속만 보정 자리로: 앞 급속은 프로그램 점 그대로, 마지막 급속이 들어가기(다음 요소에 수직으로 옮긴 점까지)', () => {
    const c = ncCompPath(run(two, LCNC));
    expect(xy(c).slice(0, 4)).toEqual([
      [-40, -40, -30, -20], // 앞 급속 — 보정 없이
      [-30, -20, -5, 0], // 마지막 급속 — 들어가기
      [-5, 0, -5, 0], // Z 내리기(그 자리)
      [-5, 0, -5, 50],
    ]);
    expect(Array.from(c.move.slice(0, 2))).toEqual([1, 2]);
    expect(c.warnings).toEqual([]);
  });

  it('다른 방언은 예전처럼 보정을 켠 뒤 첫 평면 이동을 들어가기로 본다', () => {
    const c = ncCompPath(run(two, ISO));
    expect(xy(c)[0]!.slice(0, 2)).toEqual([-40, -40]);
    expect(xy(c)[0]!.slice(2)).not.toEqual([-30, -20]);
    expect(c.move[0]).toBe(1);
    // 급속 하나뿐이면 LinuxCNC도 같은 경로
    const one = square('G41 D1\nG0 X0 Y0');
    expect(xy(ncCompPath(run(one, LCNC)))).toEqual(xy(ncCompPath(run(one, ISO))));
  });

  it('급속 사이에 이송이 끼면(Z 이송 포함) 그 앞 급속까지만 이어진 급속으로 본다 — 급속이 셋이면 앞 둘을 보정 없이', () => {
    const feedBetween = square('G41 D1\nG0 X-30 Y-20\nG1 Z4 F100\nG0 X0 Y0');
    expect(xy(ncCompPath(run(feedBetween, LCNC)))).toEqual(xy(ncCompPath(run(feedBetween, ISO))));
    const three = ncCompPath(run(square('G41 D1\nG0 X-30 Y-20\nG0 X-30 Y-10\nG0 X0 Y0'), LCNC));
    expect(xy(three).slice(0, 3)).toEqual([
      [-40, -40, -30, -20],
      [-30, -20, -30, -10],
      [-30, -10, -5, 0],
    ]);
  });
});

describe('LinuxCNC 반경 보정: 들어가기·나오기 길이', () => {
  it('들어가기 이동이 공구 반지름(5)보다 짧으면 경고(설명서: 반지름 이상), 반지름과 같으면 경고 없음 — 다른 방언은 경고 없음', () => {
    const short = square('G0 X-3 Y0\nG41 D1 G1 X0 Y0 F500');
    const w = ncCompPath(run(short, LCNC)).warnings;
    expect(w).toEqual(['6번 줄: 들어가기 이동 길이(3)가 공구 반지름(5)보다 짧음 — LinuxCNC 설명서는 반지름 이상을 요구']);
    expect(ncCompPath(run(short, ISO)).warnings).toEqual([]);
    expect(ncCompPath(run(square('G0 X-5 Y0\nG41 D1 G1 X0 Y0 F500'), LCNC)).warnings).toEqual([]);
  });

  it('G40 뒤 첫 직선이 공구 지름(10)보다 짧으면 경고(LinuxCNC는 오류로 멈춤), 원호면 LinuxCNC 오류 경고, Z만 움직이면 보지 않음', () => {
    const pre = 'G41 D1\nG0 X0 Y0';
    expect(ncCompPath(run(square(pre, 'G40 G1 X-6 Y0'), LCNC)).warnings).toEqual(['12번 줄: 보정을 끈 뒤 첫 직선 이동 길이(6)가 공구 지름(10)보다 짧음 — LinuxCNC는 오류로 멈춤']);
    expect(ncCompPath(run(square(pre, 'G40 G1 X-10 Y0'), LCNC)).warnings).toEqual([]);
    expect(ncCompPath(run(square(pre, 'G40 G1 X-6 Y0'), ISO)).warnings).toEqual([]);
    expect(ncCompPath(run(square(pre, 'G40 G2 X-20 Y0 R10'), LCNC)).warnings).toEqual(['12번 줄: 보정을 끈 첫 이동이 원호 — LinuxCNC는 오류로 멈춤(현(직선)으로 그림)']);
    expect(ncCompPath(run(square(pre, 'G40 G2 X-20 Y0 R10'), ISO)).warnings).toEqual(['12번 줄: 보정을 끈 첫 이동이 원호 — 현(직선)으로 나옴']);
    expect(ncCompPath(run(square(pre, 'G40\nG0 Z10'), LCNC)).warnings).toEqual([]);
    // 경고는 그리기를 바꾸지 않는다
    expect(xy(ncCompPath(run(square(pre, 'G40 G1 X-6 Y0'), LCNC)))).toEqual(xy(ncCompPath(run(square(pre, 'G40 G1 X-6 Y0'), ISO))));
  });
});

describe('LinuxCNC 선반 공구 끝 R 보정(XZ)도 같은 규칙', () => {
  /** 바깥지름 어깨(LinuxCNC 반지름 모드, 노즈 R 0.8·방향 9 — 노즈 중심). pre = 보정 켜기와 들어가기, post = 나오기 */
  const shoulder = (pre: string, post = 'G40 G0 X60 Z-40'): string => `G18 G21 G90 G40
G10 L1 P1 R0.8 Q9
T1 M6
G0 X40 Z5
${pre}
G1 Z-20 F0.2
G1 X30
G1 Z-40
${post}
M2`;
  const lathe = (text: string, o: GcodeOptions) => parseGcode(text, { lathe: true, ...o });

  it('G42 뒤 급속 둘: 앞 급속은 보정 없이, 마지막 급속이 들어가기', () => {
    const t = shoulder('G42 G0 X30 Z5\nG0 X20 Z2');
    const c = ncCompPath(lathe(t, LCNC));
    expect(zx(c).slice(0, 2)).toEqual([
      [5, 40, 5, 30],
      [5, 30, 2, 20.8],
    ]);
    expect(c.warnings).toEqual([]);
    // ISO(G10 L1 R을 읽지 않아 같은 반지름을 준다 — X는 지름이라 반지름 20·15)는 첫 급속이 들어가기: 보정 자리로 옮긴 점까지
    const iso = ncCompPath(lathe(t, ISO), { radius: 0.8 });
    expect(zx(iso)[0]!.slice(0, 2)).toEqual([5, 20]);
    expect(zx(iso)[0]!.slice(2)).not.toEqual([5, 15]);
  });

  it('들어가기가 노즈 반지름(0.8)보다 짧거나 G40 뒤 직선이 노즈 지름(1.6)보다 짧으면 경고', () => {
    const c = ncCompPath(lathe(shoulder('G0 X20.5 Z2.5\nG42 G1 X20 Z2', 'G40 G1 X31'), LCNC));
    expect(c.warnings).toEqual([
      '6번 줄: 들어가기 이동 길이(0.707)가 공구 반지름(0.8)보다 짧음 — LinuxCNC 설명서는 반지름 이상을 요구',
      '10번 줄: 보정을 끈 뒤 첫 직선 이동 길이(1)가 공구 지름(1.6)보다 짧음 — LinuxCNC는 오류로 멈춤',
    ]);
  });
});

describe('새 경고 글', () => {
  it('장면 경고("보정 경로: …")로 나오고 네 언어로 옮긴다', () => {
    const pre = 'G0 X-3 Y0\nG41 D1 G1 X0 Y0 F500';
    const texts = [
      ...ncToScene(run(square(pre, 'G40 G1 X-6 Y0'), LCNC), { compPath: true }).warnings!,
      ...ncToScene(run(square(pre, 'G40 G2 X-20 Y0 R10'), LCNC), { compPath: true }).warnings!,
    ].filter((w) => w.includes('LinuxCNC'));
    expect(texts).toEqual([
      '보정 경로: 6번 줄: 들어가기 이동 길이(3)가 공구 반지름(5)보다 짧음 — LinuxCNC 설명서는 반지름 이상을 요구',
      '보정 경로: 12번 줄: 보정을 끈 뒤 첫 직선 이동 길이(6)가 공구 지름(10)보다 짧음 — LinuxCNC는 오류로 멈춤',
      '보정 경로: 6번 줄: 들어가기 이동 길이(3)가 공구 반지름(5)보다 짧음 — LinuxCNC 설명서는 반지름 이상을 요구',
      '보정 경로: 12번 줄: 보정을 끈 첫 이동이 원호 — LinuxCNC는 오류로 멈춤(현(직선)으로 그림)',
    ]);
    // 정보 탭 경고 목록은 글 그대로 옮긴다(잡은 값은 옮기지 않음) — 사전 열쇠가 "보정 경로: {0}번 줄: …" 꼴 전체다
    for (const { code } of languages.filter((l: { code: string }) => l.code !== 'ko'))
      for (const t of texts) {
        const out = translate(t, code);
        expect(out, `${code}: ${t}`).not.toMatch(/[가-힣]/);
        expect(out).toContain('LinuxCNC');
      }
    expect(translate(texts[1]!, 'en')).toBe('Correction path: Line 12: The first straight move after compensation off (6 long) is shorter than the tool diameter (10) — LinuxCNC stops with an error');
  });
});
