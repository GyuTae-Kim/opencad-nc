/**
 * 화면 글 만들기와 파일 이름·주소 다루기(순수 함수, DOM 없음).
 * 숫자·크기·시간 글, 열기 상자 accept, `?open=`·`?sample` 주소 인자를 여기서 정한다.
 */
import { NC_EXTENSIONS } from '../extensions';

/** 바이트 수 → "512 B" / "1.5 KB" / "12.3 MB" / "1.02 GB" */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${Number(v.toFixed(digits))} ${units[i]}`;
}

/** 읽은 시간(ms) → "850 ms" / "1.2초" / "12초" / "2분 5초" */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${Number(s.toFixed(1))}초`;
  if (s < 60) return `${Math.round(s)}초`;
  const m = Math.floor(s / 60);
  return `${m}분 ${Math.round(s - m * 60)}초`;
}

/** 숫자 → 글(소수 digits자리까지, 끝 0 없이, 천 단위 쉼표). 값이 없으면 "—" */
export function fmtNum(v: number | undefined | null, digits = 3): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) || r === 0 ? '0' : r.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

/** 점 → "x, y, z" */
export function fmtPt(p: readonly number[] | undefined | null): string {
  if (!p) return '—';
  return `${fmtNum(p[0])}, ${fmtNum(p[1])}, ${fmtNum(p[2])}`;
}

/** 개수 글 "1,234개" */
export function fmtCount(n: number, unit = '개'): string {
  return `${Math.max(0, Math.round(n)).toLocaleString('ko-KR')}${unit}`;
}

/** RGBA(0~1) → CSS rgb() */
export function rgbCss(c: readonly number[]): string {
  const ch = (v: number | undefined): number => Math.max(0, Math.min(255, Math.round((v ?? 0) * 255)));
  return `rgb(${ch(c[0])},${ch(c[1])},${ch(c[2])})`;
}

/** 경로·주소의 마지막 이름(쿼리·조각 뺌) */
export function fileBaseName(path: string): string {
  const clean = path.replace(/[?#].*$/, '');
  const base = clean.replace(/^.*[\\/]/, '');
  return base;
}

/** 파일 이름의 확장자(소문자, 점 없이). 없으면 '' */
export function fileExtension(name: string): string {
  const m = /\.([^./\\]+)$/.exec(fileBaseName(name));
  return m ? m[1]!.toLowerCase() : '';
}

/** NC 뷰어가 아는 확장자인지(대소문자 무관) */
export function isNcFileName(name: string, exts: readonly string[] = NC_EXTENSIONS): boolean {
  const e = fileExtension(name);
  return !!e && exts.includes(e);
}

/** 글이 아닌 파일일 때 */
export const BINARY_MESSAGE = '글 파일이 아닌 이진 자료로 보입니다. NC 프로그램은 글(텍스트) 파일이어야 합니다.';

/** 파일 앞부분(4KB 남짓)에 NUL 바이트가 여럿이면 글 파일이 아니다(그림·동영상·압축·CAD 이진 등) */
export function looksBinary(head: Uint8Array): boolean {
  const n = Math.min(head.length, 4096);
  let zeros = 0;
  for (let i = 0; i < n; i++) if (head[i] === 0) zeros++;
  return zeros > Math.max(4, n / 100);
}

/** 열기 상자의 accept 값: 확장자마다 소문자·대문자 둘 다(".nc,.NC,…") */
export function fileAccept(exts: readonly string[] = NC_EXTENSIONS): string {
  const out: string[] = [];
  for (const e of exts) {
    out.push(`.${e.toLowerCase()}`);
    if (e.toUpperCase() !== e.toLowerCase()) out.push(`.${e.toUpperCase()}`);
  }
  return [...new Set(out)].join(',');
}

/** 시작 화면에 보이는 확장자 글(".nc .ngc …") */
export function extensionList(exts: readonly string[]): string {
  return exts.map((e) => `.${e}`).join(' ');
}

/** 주소 인자로 정한 시작 동작 */
export type StartRequest = { kind: 'sample' } | { kind: 'url'; url: string; name: string } | { kind: 'error'; message: string };

/**
 * 주소 인자 읽기: `?open=<같은 출처 주소>`(자동 확인용) 또는 `?sample`(예제 바로 열기).
 * 다른 출처 주소는 열지 않는다(파일이 이 브라우저 밖으로 나가지 않는다는 약속과 맞추고, 남의 서버를 부르지 않게).
 */
export function parseStartParams(search: string, pageHref: string): StartRequest | null {
  const q = new URLSearchParams(search);
  if (q.has('open')) {
    const raw = (q.get('open') ?? '').trim();
    if (!raw) return { kind: 'error', message: '열 파일 주소(?open=)가 비어 있습니다.' };
    let u: URL;
    let page: URL;
    try {
      page = new URL(pageHref);
      u = new URL(raw, page);
    } catch {
      return { kind: 'error', message: '열 파일 주소(?open=)가 올바르지 않습니다.' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { kind: 'error', message: '열 파일 주소는 http·https 주소여야 합니다.' };
    if (u.origin !== page.origin) return { kind: 'error', message: '다른 사이트의 파일은 열지 않습니다. 주소 인자 open에는 이 사이트 안의 주소만 쓸 수 있습니다.' };
    let name = fileBaseName(u.pathname);
    try {
      name = decodeURIComponent(name);
    } catch {
      /* 그대로 쓴다 */
    }
    return { kind: 'url', url: u.href, name: name || 'program.nc' };
  }
  if (q.has('sample')) return { kind: 'sample' };
  return null;
}
