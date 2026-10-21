/**
 * 작은 XML 읽기(WangShi PGI·KDT XML용). 웹 워커에는 DOMParser가 없고, 코드 보기와 가공을 잇자면 요소마다
 * 원본 줄 번호가 필요해서 직접 읽는다.
 *
 * - 요소·속성·글·CDATA를 읽고 주석·처리 명령(<?…?>)은 건너뛴다.
 * - 개체는 미리 정해진 다섯 개(&lt; &gt; &amp; &quot; &apos;)와 숫자 참조(&#9; &#x41;)만 푼다. DOCTYPE은 읽지 않고
 *   건너뛰므로 선언한 개체도 풀지 않는다(바깥 파일·개체 폭증 걱정 없음).
 * - 문서가 중간에 끊기거나 닫는 태그가 어긋나도 그때까지 읽은 요소를 돌려주고 problems에 적는다. 닫히지 않은
 *   요소는 endLine = -1이다.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** 바로 아래 글(자식 요소의 글은 빼고, 앞뒤 공백 그대로) */
  text: string;
  /** 여는 태그 줄(0부터) */
  line: number;
  /** 닫는 태그 줄(0부터, 빈 요소면 line과 같다). 닫히지 않았으면 -1 */
  endLine: number;
}

export interface XmlProblem {
  message: string;
  /** 줄(0부터) */
  line: number;
}

export class XmlError extends Error {
  constructor(
    message: string,
    readonly line = -1,
  ) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlParseOptions {
  /** 요소 수 한도(기본 20만) */
  maxElements?: number;
  /** 중첩 깊이 한도(기본 256) */
  maxDepth?: number;
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function tryDecode(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * XML 바이트 → 글. BOM(UTF-8·UTF-16) → UTF-8 → XML 선언의 encoding(gb2312·euc-kr 등, 브라우저가 아는 이름) →
 * CP949 → windows-1252 차례로 맞는 것을 쓴다. UTF-8을 선언보다 먼저 보는 것은 선언과 달리 UTF-8로 저장된 파일(다시 읽기 포함)
 * 때문이다 — GBK·CP949 한자·한글 글이 우연히 맞는 UTF-8일 일은 거의 없다.
 */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  const utf8 = tryDecode(bytes, 'utf-8');
  if (utf8 !== null) return utf8;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
  return (declared ? tryDecode(bytes, declared) : null) ?? tryDecode(bytes, 'euc-kr') ?? new TextDecoder('windows-1252').decode(bytes);
}

/** 개체 참조를 푼다(모르는 이름은 그대로 둔다) */
export function decodeXmlEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return NAMED[body] ?? all;
  });
}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_RE = /[A-Za-z_:À-￿][-A-Za-z0-9_:.·À-￿]*/y;
const ATTR_RE = /\s*([A-Za-z_:À-￿][-A-Za-z0-9_:.·À-￿]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/=]+)))?/y;

/** XML 글을 읽어 첫 뿌리 요소를 돌려준다. 뿌리가 없으면 XmlError */
export function parseXml(text: string, opts: XmlParseOptions = {}): { root: XmlElement; problems: XmlProblem[] } {
  const maxElements = opts.maxElements ?? 200_000;
  const maxDepth = opts.maxDepth ?? 256;
  const problems: XmlProblem[] = [];
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let elements = 0;
  let line = 0;
  let pos = 0;
  const n = text.length;
  /** pos에서 to까지 건너뛰며 줄을 센다 */
  const skipTo = (to: number): void => {
    for (let i = pos; i < to; i++) if (text.charCodeAt(i) === 10) line++;
    pos = to;
  };
  const addText = (s: string): void => {
    const top = stack[stack.length - 1];
    if (top) top.text += s;
  };
  if (text.charCodeAt(0) === 0xfeff) pos = 1;
  while (pos < n) {
    const lt = text.indexOf('<', pos);
    if (lt < 0) {
      if (stack.length) addText(decodeXmlEntities(text.slice(pos)));
      skipTo(n);
      break;
    }
    if (lt > pos) {
      if (stack.length) addText(decodeXmlEntities(text.slice(pos, lt)));
      else if (root && text.slice(pos, lt).trim()) problems.push({ message: '뿌리 요소 뒤의 글은 읽지 않음', line });
      skipTo(lt);
    }
    if (text.startsWith('<!--', pos)) {
      const e = text.indexOf('-->', pos + 4);
      skipTo(e < 0 ? n : e + 3);
      continue;
    }
    if (text.startsWith('<![CDATA[', pos)) {
      const e = text.indexOf(']]>', pos + 9);
      addText(text.slice(pos + 9, e < 0 ? n : e));
      skipTo(e < 0 ? n : e + 3);
      continue;
    }
    if (text.startsWith('<?', pos)) {
      const e = text.indexOf('?>', pos + 2);
      skipTo(e < 0 ? n : e + 2);
      continue;
    }
    if (text.startsWith('<!', pos)) {
      // DOCTYPE(안쪽 [ … ] 포함)·그 밖의 선언: 읽지 않고 건너뛴다
      let i = pos + 2;
      let depth = 0;
      for (; i < n; i++) {
        const c = text[i];
        if (c === '[') depth++;
        else if (c === ']') depth = Math.max(0, depth - 1);
        else if (c === '>' && depth === 0) break;
      }
      problems.push({ message: 'DOCTYPE 선언은 읽지 않음(개체 선언도 풀지 않음)', line });
      skipTo(Math.min(n, i + 1));
      continue;
    }
    if (text[pos + 1] === '/') {
      const startLine = line;
      NAME_RE.lastIndex = pos + 2;
      const m = NAME_RE.exec(text);
      const name = m ? m[0] : '';
      const gt = text.indexOf('>', pos + 2);
      skipTo(gt < 0 ? n : gt + 1);
      let k = stack.length - 1;
      while (k >= 0 && stack[k]!.name !== name) k--;
      if (k < 0) {
        problems.push({ message: `여는 태그가 없는 닫는 태그(</${name}>)를 건너뜀`, line: startLine });
        continue;
      }
      if (k < stack.length - 1) problems.push({ message: `닫히지 않은 <${stack[stack.length - 1]!.name}> 안에서 닫는 태그(</${name}>)가 나옴`, line: startLine });
      stack[k]!.endLine = startLine;
      stack.length = k;
      continue;
    }
    if (!NAME_START.test(text[pos + 1] ?? '')) {
      // 태그가 아닌 '<': 글로 둔다
      addText('<');
      skipTo(pos + 1);
      continue;
    }
    // 여는 태그
    const startLine = line;
    NAME_RE.lastIndex = pos + 1;
    const name = NAME_RE.exec(text)![0];
    let i = pos + 1 + name.length;
    const attrs: Record<string, string> = {};
    let selfClose = false;
    let closed = false;
    for (;;) {
      ATTR_RE.lastIndex = i;
      const a = ATTR_RE.exec(text);
      if (a && a[0].length) {
        const value = a[2] ?? a[3] ?? a[4] ?? '';
        if (!(a[1]! in attrs)) attrs[a[1]!] = decodeXmlEntities(value);
        i += a[0].length;
        continue;
      }
      while (i < n && /\s/.test(text[i]!)) i++;
      if (text[i] === '/' && text[i + 1] === '>') {
        selfClose = true;
        closed = true;
        i += 2;
      } else if (text[i] === '>') {
        closed = true;
        i += 1;
      }
      break;
    }
    if (!closed) {
      // 태그 안에서 끊김(또는 알 수 없는 글자): 다음 '>'까지 건너뛴다
      const gt = text.indexOf('>', i);
      problems.push({ message: `<${name}> 태그를 끝까지 읽지 못함`, line: startLine });
      skipTo(gt < 0 ? n : gt + 1);
      if (gt < 0) break;
      continue;
    }
    skipTo(i);
    if (++elements > maxElements) throw new XmlError(`XML 요소가 ${maxElements}개를 넘음`, startLine);
    if (stack.length >= maxDepth) throw new XmlError(`XML 요소가 ${maxDepth}단보다 깊게 겹침`, startLine);
    const el: XmlElement = { name, attrs, children: [], text: '', line: startLine, endLine: selfClose ? startLine : -1 };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else if (!root) root = el;
    else {
      problems.push({ message: `뿌리 요소가 둘 이상 — 첫 <${root.name}>만 읽음`, line: startLine });
      if (!selfClose) stack.push(el); // 안쪽은 읽되 버린다
      continue;
    }
    if (!selfClose) stack.push(el);
  }
  if (!root) throw new XmlError('XML 요소가 없음');
  if (stack.length) problems.push({ message: `문서가 <${stack[stack.length - 1]!.name}> 안에서 끊김 — 그 앞까지 닫힌 요소만 씀`, line });
  return { root, problems };
}

/** 이름이 같은 첫 자식(대소문자 무시) */
export function xmlChild(el: XmlElement, name: string): XmlElement | undefined {
  const exact = el.children.find((c) => c.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return el.children.find((c) => c.name.toLowerCase() === lower);
}

/** 이름이 같은 자식들(대소문자 무시) */
export function xmlChildren(el: XmlElement, name: string): XmlElement[] {
  const lower = name.toLowerCase();
  return el.children.filter((c) => c.name.toLowerCase() === lower);
}

/** 자식 요소의 글(앞뒤 공백 뺌). 자식이 없으면 undefined */
export function xmlField(el: XmlElement, name: string): string | undefined {
  const c = xmlChild(el, name);
  return c ? c.text.trim() : undefined;
}

/** 속성(이름이 정확히 같은 것, 없으면 대소문자 무시) */
export function xmlAttr(el: XmlElement, name: string): string | undefined {
  const v = el.attrs[name];
  if (v !== undefined) return v;
  const lower = name.toLowerCase();
  for (const k of Object.keys(el.attrs)) if (k.toLowerCase() === lower) return el.attrs[k];
  return undefined;
}

/**
 * 글 앞부분이 XML이면 뿌리 요소 이름(XML 선언·주석·DOCTYPE은 건너뜀). XML이 아니면 null.
 * MPR 매크로 줄(`<100 \WerkStck\`)처럼 '<' 뒤가 이름이 아닌 글은 XML로 보지 않는다.
 */
export function xmlRootName(head: string): string | null {
  let i = head.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < head.length && /\s/.test(head[i]!)) i++;
    if (head[i] !== '<') return null;
    if (head.startsWith('<?', i)) {
      const e = head.indexOf('?>', i + 2);
      if (e < 0) return null;
      i = e + 2;
      continue;
    }
    if (head.startsWith('<!--', i)) {
      const e = head.indexOf('-->', i + 4);
      if (e < 0) return null;
      i = e + 3;
      continue;
    }
    if (head.startsWith('<!', i)) {
      const e = head.indexOf('>', i + 2);
      if (e < 0) return null;
      i = e + 1;
      continue;
    }
    NAME_RE.lastIndex = i + 1;
    const m = NAME_RE.exec(head);
    if (!m || m.index !== i + 1) return null;
    const after = head[i + 1 + m[0].length];
    return after === undefined || /[\s/>]/.test(after) ? m[0] : null;
  }
}
