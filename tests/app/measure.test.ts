import { describe, expect, it } from 'vitest';
import { measureHint, measureLines, panelMeasureHint, statusMeasureHint } from '../../src/app/measure';
import { selectionSummary } from '../../src/app/doc';
import { BINARY_MESSAGE, looksBinary } from '../../src/app/format';
import { catalogs, translate } from '../../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'];

describe('측정 안내(휴대폰·터치)', () => {
  it('손가락 기기는 키(Esc) 설명 대신 길게 누르기를 알리고, 마우스 글은 그대로', () => {
    for (const [n, has] of [[0, false], [1, false], [2, true], [0, true]] as const) {
      const t = measureHint(n, has, true);
      expect(t).not.toMatch(/Esc/);
      // 앞부분(다음에 누를 곳)은 같다
      expect(t.split(' · ')[0]).toBe(measureHint(n, has).split(' · ')[0]);
    }
    expect(measureHint(0, false, true)).toBe('측정: 잴 시작점을 누르십시오 · 길게 누르면 정밀 조준');
    expect(measureHint(1, false, true)).toBe('측정: 끝점을 누르십시오');
    expect(measureHint(1, false)).toBe('측정: 끝점을 누르십시오 · Esc 취소');
    expect(measureHint(2, false)).toContain('Esc 지우기');

    expect(panelMeasureHint()).toContain('Esc = 지우기');
    expect(panelMeasureHint(true)).not.toMatch(/Esc/);
    expect(panelMeasureHint(true)).toContain('길게 누르면 정밀 조준');
    expect(statusMeasureHint()).toBe('측정: 두 점을 누르십시오(Esc = 지우기)');
    expect(statusMeasureHint(true)).toBe('측정: 두 점을 누르십시오');
  });

  it('상태 막대 요약도 손가락 기기면 Esc 설명을 뺀다', () => {
    const d = { scene: { units: 'mm' }, measure: null } as unknown as Parameters<typeof selectionSummary>[0];
    expect(selectionSummary(d, true)).toBe(statusMeasureHint(false));
    expect(selectionSummary(d, true, true)).toBe(statusMeasureHint(true));
  });

  it('결과 글: 거리(단위)와 dx·dy·dz', () => {
    expect(measureLines({ distance: 50, dx: 30, dy: -40, dz: 0 }, 'mm')).toEqual({ value: '50 mm', axes: 'dx 30 · dy -40 · dz 0' });
    expect(measureLines({ distance: 1.23456, dx: 1.23456, dy: 0, dz: 0 }, '')).toEqual({ value: '1.235', axes: 'dx 1.235 · dy 0 · dz 0' });
  });

  it('새 안내 글은 네 언어 모두 번역이 있다', () => {
    const texts = [
      ...[0, 1, 2].flatMap((n) => [measureHint(n, false), measureHint(n, false, true)]),
      measureHint(0, true),
      measureHint(0, true, true),
      panelMeasureHint(),
      panelMeasureHint(true),
      statusMeasureHint(),
      statusMeasureHint(true),
      '보기 설정',
      '원근 투영',
      '평행 투영',
      '다시 재기',
      '찍은 점과 결과 지우기',
      '측정 끝내기',
      'NC 파일을 골라 여십시오',
      '한 번에 파일 하나를 엽니다.',
      '한 손가락 끌기 회전 · 두 손가락 이동·확대 · 측정 중 길게 누르면 정밀 조준',
    ];
    for (const lang of LANGS) {
      for (const t of texts) {
        expect(catalogs[lang]?.[t], `${lang}: ${t}`).toBeTruthy();
        expect(translate(t, lang)).not.toMatch(/[가-힣]/);
      }
      expect(translate(`a.jpg: ${BINARY_MESSAGE}`, lang)).toMatch(/^a\.jpg/);
      expect(translate(`a.jpg: ${BINARY_MESSAGE}`, lang)).not.toMatch(/[가-힣]/);
    }
  });
});

describe('이진 파일 거르기(확장자를 거르지 않는 손가락 기기)', () => {
  it('앞부분에 NUL 바이트가 여럿이면 이진 파일', () => {
    const text = new TextEncoder().encode('G0 X0 Y0\nG1 X10 F100\n'.repeat(200));
    expect(looksBinary(text)).toBe(false);
    const png = new Uint8Array(4096);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    expect(looksBinary(png)).toBe(true);
    // 4KB 넘는 부분은 보지 않는다
    const tail = new Uint8Array(8192).fill(0x41);
    tail.fill(0, 4096);
    expect(looksBinary(tail)).toBe(false);
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });
});
