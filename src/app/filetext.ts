/**
 * 파일에서 온 글(주석·공구 이름·프로그램 이름·작업 파일 이름·판재 가공 이름 등)을 앱 글과 섞을 때 쓰는 꼴(DOM·번역 없음 — 54차, opencad-skp 52차와 같은 꼴).
 * 화면 번역층(i18n.ts)은 사전 열쇠와 같은 글 마디를 통째로 바꾸고, 다른 언어 사전의 번역 글을 열쇠로 되찾으며, 틀이 맞지 않으면 " · "·" — "로
 * 나눈 조각마다 옮긴다. 그래서 이름을 앱 글에 그대로 이어 붙이면 이름까지 바뀌었다(공구 "무늬 · 연구" → "Texture · 연구",
 * 일본어 화면의 가공 이름 "Texture" → "テクスチャ"). 섞은 글은 i18n.ts의 mixText(속성 글)·mixNodes(화면 마디)로 옮긴다 — 파일 글 자리는 번역기가 보지 않는다.
 */
export interface FileText {
  readonly file: string;
}

/** 앱 글(문자열)과 파일 글이 섞인 글 */
export type Mixed = readonly (string | FileText)[];

export const fileText = (file: string): FileText => ({ file });

/** 앱 글 틀에 값 끼우기: mix`공구 ${fileText(name)} 숨기기`. fileText·섞은 글이 아닌 값(수·앱 글)은 앱 글로 잇는다 */
export function mix(s: TemplateStringsArray, ...v: (string | number | FileText | Mixed)[]): Mixed {
  const out: (string | FileText)[] = [];
  let t = s[0]!;
  v.forEach((x, i) => {
    for (const p of Array.isArray(x) ? x : [x]) {
      if (typeof p === 'object') {
        out.push(t, p);
        t = '';
      } else t += String(p);
    }
    t += s[i + 1]!;
  });
  out.push(t);
  return out.filter((p) => p !== '');
}

/** 섞은 글 여럿을 나눔 글로 잇기 */
export function joinMixed(list: readonly Mixed[], sep = ' · '): Mixed {
  return list.flatMap((m, i) => (i ? [sep, ...m] : m));
}

/** 섞은 글의 원문(한국어 화면·복사·시험) */
export const plainText = (m: Mixed | string): string => (typeof m === 'string' ? m : m.map((p) => (typeof p === 'string' ? p : p.file)).join(''));

/** 앱이 지은 이름의 앞이 파일 글이면(공구 이름 + " 이송", 판재 가공 이름 + " Ø8 깊이 12") 그 앞만 파일 글로 */
export function filePrefix(name: string, file: string | undefined): Mixed {
  return file && name.startsWith(file) ? mix`${fileText(file)}${name.slice(file.length)}` : [name];
}
