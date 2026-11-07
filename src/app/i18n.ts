import { createLanguageMenu } from 'opencad-site-kit/i18n/language-menu';
import { VIEW_LABELS } from 'opencad-viewer3d/camera';
import { CUBE_FACES } from 'opencad-viewer3d/viewcube';
/** Localize only presentation DOM. CAD data, input values and command keys stay intact. */
import { currentLanguage, languages, languageUrl, metadataForLanguage, registerCatalog, sourceMessage, translate } from '../../site/i18n-core.mjs';
import type { Mixed } from './filetext';

const loaders: Record<string, () => Promise<{default: Record<string,string>}>> = {
  en: () => import('../../site/locales/en.json'), ja: () => import('../../site/locales/ja.json'),
  'zh-CN': () => import('../../site/locales/zh-CN.json'), de: () => import('../../site/locales/de.json'),
};
async function loadLanguage(language: string): Promise<void> { if (loaders[language]) registerCatalog(language,(await loaders[language]()).default); }

/** 지금 화면 언어(사전을 받은 뒤 installLocalization이 정하고 언어를 바꾸면 따라간다 — 그 전과 닫은 뒤는 한국어) */
let active = 'ko';
/**
 * 파일 글이 섞인 글(filetext.ts)을 지금 언어로(54차, opencad-skp 52차와 같은 꼴): 파일 글 자리를 번역기가 보지 않는 사용 영역 글자(U+E000~)로
 * 바꿔 옮긴 뒤 되돌린다(사전 틀의 {0}이 그 글자를 그대로 잡고, 나눔 글로 조각낼 때도 한글이 없는 조각이라 그대로 둔다).
 * 옮긴 글을 넣은 속성은 data-i18n-keep에, 마디를 담은 요소는 data-i18n-skip으로 번역층에서 빼고, 언어를 바꾸면 앱이 다시 그린다(app.ts languagechange)
 */
function mixed(parts: Mixed): [string, string[]] {
  const files: string[] = [];
  return [translate(parts.map(p => typeof p === 'string' ? p : String.fromCharCode(0xe000 + files.push(p.file) - 1)).join(''), active), files];
}
/** 글자 c가 파일 글 자리면 그 파일 글(아니면 undefined) */
const slot = (c: string, files: string[]): string | undefined => c.length === 1 ? files[c.charCodeAt(0) - 0xe000] : undefined;
export function mixText(parts: Mixed): string {
  const [text, files] = mixed(parts);
  return Array.from(text, c => slot(c, files) ?? c).join('');
}
/** 섞은 글 → 화면 마디(파일 글은 translate="no" 묶음). 담는 요소에 data-i18n-skip을 둔다 */
export function mixNodes(parts: Mixed): (string | Node)[] {
  const [text, files] = mixed(parts);
  const out: (string | Node)[] = [];
  let run = '';
  for (const c of text) {
    const file = slot(c, files);
    if (file === undefined) {
      run += c;
      continue;
    }
    if (run) out.push(run);
    run = '';
    const el = document.createElement('span'); el.setAttribute('translate', 'no'); el.textContent = file;
    out.push(el);
  }
  if (run) out.push(run);
  return out;
}

type RecordValue = { source: string; rendered: string };
// NC group names (rapid, tool groups, panel operation kinds) are app words; data names such as Siemens named tools carry translate="no".
const SKIP = '[data-static-languages], [translate="no"], [data-i18n-skip], script, style, [contenteditable]:not([contenteditable="false"]), textarea, input, code, pre, canvas, svg, .anno-layer, .pmi-layer, .docname, .doc-name, .code-list, .cmd-input, .file-name, .tree .name, .tree-name, .boot-recent-list button, .plist .name, .def-cell, .scene-tabs, .scene-cap';
/** Skipped elements whose own attributes (title, aria-label) are still UI words: inputs, and the program code list and its warning line-number tooltips */
const ATTR_SELF = 'input, textarea, canvas, [contenteditable], .code-list';
const ATTR_INSIDE = '.code-list .ln';
export async function installLocalization(root: HTMLElement): Promise<() => void> {
  let language = currentLanguage(location.href);
  await loadLanguage(language);
  active = language;
  const originalViews = Object.entries(VIEW_LABELS);
  const originalFaces = CUBE_FACES.map(face => face.label);
  function canvasLabels(): void {
    for (const [view,label] of originalViews) VIEW_LABELS[view as keyof typeof VIEW_LABELS] = translate(label,language);
    CUBE_FACES.forEach((face,index) => { face.label=translate(originalFaces[index]!,language); });
  }
  canvasLabels();
  const presentationRoot = document.body;
  const texts = new WeakMap<Node, RecordValue>();
  const attributes = new WeakMap<Element, Map<string, RecordValue>>();
  const control = createLanguageMenu(languages, language, changeLanguage);
  function value(current: string, record?: RecordValue): RecordValue {
    const source = record && current === record.rendered ? record.source : sourceMessage(current);
    const rendered = translate(source, language);
    // Keep spacing around split text nodes and inline elements.
    return { source, rendered: rendered === source ? source : (source.match(/^\s*/)?.[0] ?? '') + rendered + (source.match(/\s*$/)?.[0] ?? '') };
  }
  function element(el: Element): void {
    if ((el.matches(SKIP) && !el.matches(ATTR_SELF)) || el.closest('[translate="no"], [data-i18n-skip]')) return;
    const records = attributes.get(el) ?? new Map<string, RecordValue>(); attributes.set(el, records);
    // data-i18n-keep: 파일 글이거나 앱이 이미 옮겨 넣은 속성(mixText — 54차)
    const keep = el.getAttribute('data-i18n-keep')?.split(' ');
    for (const name of ['title','aria-label','aria-description','placeholder','alt']) {
      if (!el.hasAttribute(name) || keep?.includes(name)) continue;
      const record = value(el.getAttribute(name)!, records.get(name)); records.set(name, record);
      if (el.getAttribute(name) !== record.rendered) el.setAttribute(name, record.rendered);
    }
    if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) {
      const current = el.getAttribute('href')!; const old = records.get('href');
      const source = old && current === old.rendered ? old.source : current;
      const rendered = languageUrl(new URL(source, document.baseURI).href, language);
      records.set('href',{source,rendered}); if (el.getAttribute('href') !== rendered) el.setAttribute('href',rendered);
    }
  }
  function update(node: Node): void {
    // 감시 기록을 받을 때 이미 빠진 마디(가상 목록이 되돌려 둔 코드 줄 등)는 건너뛴다 — 건너뛸 조상(.code-list)을 잃어 파일 글을 옮겼다(54차)
    if (!node.isConnected) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement || node.parentElement.closest(SKIP)) return;
      const record = value(node.nodeValue ?? '', texts.get(node)); texts.set(node, record);
      if (node.nodeValue !== record.rendered) node.nodeValue = record.rendered;
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.parentElement?.closest(SKIP) || node.matches(SKIP)) {
      // Data text stays as it is; only the UI attributes of the skipped element and its code-list line numbers are translated.
      if (node.matches(ATTR_SELF) || node.matches(ATTR_INSIDE)) element(node);
      if (node.closest('.code-list')) node.querySelectorAll(ATTR_INSIDE).forEach(element);
      return;
    }
    element(node);
    for (const child of Array.from(node.childNodes)) update(child);
  }
  function mountSelector(): void {
    // The shared widget preserves native language names with translate="no".
    // Its own accessible name still follows the selected UI language.
    const label = translate('언어 선택', language);
    const trigger = control.element.querySelector('button');
    const menu = document.getElementById(trigger?.getAttribute('aria-controls') ?? '');
    for (const el of [trigger, menu]) if (el && el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
    if (trigger && trigger.title !== label) trigger.title = label;
    const host = root.querySelector('.titlebar, .topbar, header');
    if (host) { control.element.classList.remove('language-control-floating'); if (control.element.parentNode !== host) host.append(control.element); }
    if (!control.element.isConnected) { control.element.classList.add('language-control-floating'); root.append(control.element); }
  }
  let titleSource = sourceMessage(document.title);
  function metadata(): void {
    const data = metadataForLanguage(language);
    document.documentElement.lang = language;
    const previous = titleSource;
    document.title = translate(previous,language);
    const originalName = metadataForLanguage('ko').siteName;
    if (previous.endsWith(originalName)) document.title = previous.slice(0,-originalName.length) + translate(originalName,language);
    const fields: [string,string][] = [
      ['meta[name="description"]',data.description],['meta[name="author"]',data.author.name],['meta[property="og:locale"]',data.locale],
      ['meta[property="og:title"]',data.title],['meta[property="og:description"]',data.description],['meta[property="og:url"]',data.url],
      ['meta[property="og:site_name"]',data.siteName],['meta[property="og:image"]',data.image.url],['meta[property="og:image:secure_url"]',data.image.url],['meta[property="og:image:alt"]',data.image.alt],
      ['meta[name="twitter:title"]',data.title],['meta[name="twitter:description"]',data.description],['meta[name="twitter:image"]',data.image.url],['meta[name="twitter:image:alt"]',data.image.alt],
    ];
    for (const [query,content] of fields) document.querySelector(query)?.setAttribute('content',content);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href',data.url);
    const graph = document.querySelector('script[type="application/ld+json"]');
    if (graph?.textContent) {
      const existing = JSON.parse(graph.textContent);
      for (const item of existing['@graph'] ?? []) {
        if (item['@type'] === 'WebApplication') Object.assign(item,{...data.application,'@id':data.url+'#app',url:data.url,description:data.description,inLanguage:language,image:data.image.url,author:data.author});
        if (item['@type'] === 'BreadcrumbList') item.itemListElement=data.breadcrumbs;
      }
      graph.textContent=JSON.stringify(existing).replace(/</g,'\\u003c');
    }
  }
  async function changeLanguage(next: string): Promise<void> {
    try { await loadLanguage(next); } catch { return; }
    const url = new URL(languageUrl(location.href,next));
    // Dev servers use /en/; published apps use /opencad-<format>/en/.
    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
      const base = location.pathname.match(/^\/(?:2dcad-viewer|opencad-(?:dwgdxf|skp|step|nc))\//)?.[0] ?? '/';
      url.pathname = base + (next === 'ko' ? '' : next + '/');
    }
    language = next;
    active = next;
    control.setLanguage(language);
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
    metadata(); canvasLabels(); update(presentationRoot);
    mountSelector();
    root.dispatchEvent(new CustomEvent('languagechange',{detail:language}));
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') for (const node of Array.from(record.addedNodes)) update(node);
      else update(record.target);
    }
    mountSelector();
  });
  metadata(); update(presentationRoot); mountSelector();
  root.dispatchEvent(new CustomEvent('languagechange',{detail:language}));
  const title = document.querySelector('title');
  const titleObserver = new MutationObserver(() => {
    const current = document.title;
    const originalName = metadataForLanguage('ko').siteName;
    const translatedName = translate(originalName,language);
    if (current === translate(titleSource,language) || (titleSource.endsWith(originalName) && current === titleSource.slice(0,-originalName.length)+translatedName)) return;
    titleSource=sourceMessage(current);
    if (current.endsWith(originalName)) document.title=current.slice(0,-originalName.length)+translatedName;
    else document.title=translate(current,language);
  });
  if (title) titleObserver.observe(title,{childList:true,subtree:true,characterData:true});
  observer.observe(presentationRoot,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','aria-description','placeholder','alt','href']});
  return () => {
    active = 'ko';
    observer.disconnect(); titleObserver.disconnect(); control.dispose();
    for (const [view,label] of originalViews) VIEW_LABELS[view as keyof typeof VIEW_LABELS]=label;
    CUBE_FACES.forEach((face,index) => { face.label=originalFaces[index]!; });
  };
}
