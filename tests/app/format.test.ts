import { describe, expect, it } from 'vitest';
import { NC_EXTENSIONS } from '../../src/index';
import { extensionList, fileAccept, fileBaseName, fileExtension, fmtCount, fmtNum, fmtPt, formatBytes, formatMs, isNcFileName, parseStartParams, rgbCss } from '../../src/app/format';

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
