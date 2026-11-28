import { afterEach, describe, expect, it } from 'vitest';
import { NC_EXTENSIONS } from '../../src/index';
import { extensionList, fileAccept, fileBaseName, fileExtension, fmtCount, fmtInt, fmtNum, fmtPt, formatBytes, formatMs, isNcFileName, parseStartParams, rgbCss, setNumberLanguage } from '../../src/app/format';

describe('크기·시간·숫자 글', () => {
  it('바이트 수', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 * 12.34)).toBe('12.3 MB');
    expect(formatBytes(1024 * 1024 * 250)).toBe('250 MB');
    expect(formatBytes(1024 ** 3 * 1.02)).toBe('1.02 GB');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('읽은 시간', () => {
    expect(formatMs(4.4)).toBe('4 ms');
    expect(formatMs(850)).toBe('850 ms');
    expect(formatMs(1234)).toBe('1.2초');
    expect(formatMs(12_400)).toBe('12초');
    expect(formatMs(125_000)).toBe('2분 5초');
    expect(formatMs(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('숫자·점·개수·색', () => {
    expect(fmtNum(1234.5678)).toBe('1,234.568');
    expect(fmtNum(2.5, 0)).toBe('3');
    expect(fmtNum(-0.0001)).toBe('0');
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtNum(Number.NaN)).toBe('—');
    expect(fmtPt([1, -2.5, 0])).toBe('1, -2.5, 0');
    expect(fmtPt(null)).toBe('—');
    expect(fmtCount(12345)).toBe('12,345개');
    expect(fmtCount(3, '줄')).toBe('3줄');
    expect(rgbCss([1, 0.5, 0, 1])).toBe('rgb(255,128,0)');
    expect(rgbCss([2, -1, 0.2])).toBe('rgb(255,0,51)');
  });
});

/**
 * 221차: 화면 글에 넣는 수 꼴. 번역층은 사전 틀이 잡은 수 글을 그대로 끼워, 앱이 그릴 때 정한 꼴이 모든 언어에 간다 — 전에는 모두 한국어 꼴로 고정이라
 * 독일어 화면에서 「12,345」(소수로 읽힘)·「2,000.5」였다. 사람이 읽는 셈 수(fmtInt·fmtCount — 개수·줄 번호·차례)의 천 단위는 화면 언어 꼴(i18n.ts가 언어를 정할 때
 * setNumberLanguage), 프로그램 값(fmtNum·fmtPt — 좌표·길이·이송)은 어느 언어든 소수점 「.」(NC 프로그램 글·제어기 위치 표시 꼴, 앱 안 다수 꼴)이고 천 단위 쉼표는
 * 소수점이 「.」인 화면 언어에서만. Intl 꼴은 ko·en·ja·zh-CN이 같고 de만 달라 한국어·영어(와 일본어·중국어) 화면 글은 위 시험 그대로, 독일어만 바뀐다(ci-guard 6번).
 * 파일 크기·읽은 시간은 천 단위가 생기지 않아(1,024 안·분 단위) 소수점 「.」 그대로
 */
describe('221차: 화면 언어의 수 꼴', () => {
  afterEach(() => setNumberLanguage('ko'));

  it('독일어: 셈 수는 천 단위 「.」(12.345), 프로그램 값은 소수점 「.」에 천 단위 없이(1234.568 — 프로그램 글과 같은 수 글), 크기·시간은 그대로', () => {
    setNumberLanguage('de');
    expect([fmtInt(12345), fmtInt(999), fmtCount(12345), fmtCount(1202, '줄')]).toEqual(['12.345', '999', '12.345개', '1.202줄']);
    expect([fmtNum(1234.5678), fmtNum(-2000.5), fmtNum(2.5, 0), fmtNum(-0.0001), fmtNum(0.25), fmtNum(1200, 1)]).toEqual(['1234.568', '-2000.5', '3', '0', '0.25', '1200']);
    expect(fmtPt([1234.5, -2.5, 0])).toBe('1234.5, -2.5, 0');
    expect([formatBytes(1536), formatBytes(1024 ** 3 * 1.02), formatMs(1234), formatMs(125_000)]).toEqual(['1.5 KB', '1.02 GB', '1.2초', '2분 5초']);
  });

  it('영어·일본어·중국어는 한국어와 같은 꼴(12,345 · 1,234.568), 한국어로 돌리면 처음과 같다', () => {
    for (const lang of ['en', 'ja', 'zh-CN', 'ko']) {
      setNumberLanguage(lang);
      expect([fmtInt(12345), fmtCount(12345), fmtNum(1234.5678), fmtNum(1200, 1), fmtPt([1234.5, -2.5, 0]), formatBytes(1536)], lang).toEqual(['12,345', '12,345개', '1,234.568', '1,200', '1,234.5, -2.5, 0', '1.5 KB']);
    }
  });
});

describe('파일 이름·열기 상자', () => {
  it('이름과 확장자', () => {
    expect(fileBaseName('C:\\jobs\\PART.NC')).toBe('PART.NC');
    expect(fileBaseName('/a/b/c.mpr?x=1#y')).toBe('c.mpr');
    expect(fileExtension('PART.NC')).toBe('nc');
    expect(fileExtension('teil.H')).toBe('h');
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('dir.v2/file')).toBe('');
    expect(isNcFileName('x.TAP')).toBe(true);
    expect(isNcFileName('x.mpr')).toBe(true);
    expect(isNcFileName('x.txt')).toBe(false);
  });

  it('accept는 해석기의 확장자를 소문자·대문자 모두 담는다', () => {
    const a = fileAccept().split(',');
    expect(a).toContain('.nc');
    expect(a).toContain('.NC');
    expect(a).toContain('.h');
    expect(a).toContain('.H');
    expect(a).toContain('.mpr');
    expect(a).toContain('.MPR');
    expect(a.length).toBe(NC_EXTENSIONS.length * 2);
    expect(new Set(a).size).toBe(a.length);
    expect(fileAccept(['nc', 'NC', 'nc1'])).toBe('.nc,.NC,.nc1,.NC1');
    expect(extensionList(['h', 'mpr'])).toBe('.h .mpr');
  });
});

describe('주소 인자', () => {
  const page = 'https://gyutae-kim.github.io/opencad-nc/';
  it('?sample', () => {
    expect(parseStartParams('?sample', page)).toEqual({ kind: 'sample' });
    expect(parseStartParams('?sample=1', page)).toEqual({ kind: 'sample' });
    expect(parseStartParams('', page)).toBeNull();
    expect(parseStartParams('?theme=dark', page)).toBeNull();
  });

  it('?open=은 같은 출처만', () => {
    expect(parseStartParams('?open=samples/part%201.nc', page)).toEqual({ kind: 'url', url: 'https://gyutae-kim.github.io/opencad-nc/samples/part%201.nc', name: 'part 1.nc' });
    expect(parseStartParams('?open=/x/TEIL.H', page)).toEqual({ kind: 'url', url: 'https://gyutae-kim.github.io/x/TEIL.H', name: 'TEIL.H' });
    const cross = parseStartParams('?open=https://example.com/a.nc', page);
    expect(cross?.kind).toBe('error');
    expect(parseStartParams('?open=', page)?.kind).toBe('error');
    expect(parseStartParams('?open=javascript:alert(1)', page)?.kind).toBe('error');
    // open이 sample보다 앞선다
    expect(parseStartParams('?sample&open=a.nc', page)?.kind).toBe('url');
  });
});
