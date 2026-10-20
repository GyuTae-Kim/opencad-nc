import { VIEW_LABELS } from 'opencad-viewer3d';
import { CUBE_FACES } from 'opencad-viewer3d/viewcube';
/** Localize only presentation DOM. CAD data, input values and command keys stay intact. */
import { currentLanguage, languages, languageUrl, metadataForLanguage, registerCatalog, sourceMessage, translate } from '../../site/i18n-core.mjs';

const loaders: Record<string, () => Promise<{default: Record<string,string>}>> = {
  en: () => import('../../site/locales/en.json'), ja: () => import('../../site/locales/ja.json'),
  'zh-CN': () => import('../../site/locales/zh-CN.json'), de: () => import('../../site/locales/de.json'),
};
async function loadLanguage(language: string): Promise<void> { if (loaders[language]) registerCatalog(language,(await loaders[language]()).default); }

type RecordValue = { source: string; rendered: string };
const SKIP = '[data-static-languages], [translate="no"], [data-i18n-skip], script, style, [contenteditable]:not([contenteditable="false"]), textarea, input, code, pre, canvas, svg, .anno-layer, .pmi-layer, .docname, .doc-name, .code-list, .cmd-input, .file-name, .tree .name, .tree-name, .boot-recent-list button, .plist .name, .def-cell, .scene-tabs, .scene-cap, .group-item:not(.opt) .name';
export async function installLocalization(root: HTMLElement): Promise<() => void> {
  let language = currentLanguage(location.href);
  await loadLanguage(language);
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
  const options = languages;
  const selector = document.createElement('select');
  selector.className = 'language-selector'; selector.setAttribute('aria-label', 'Language'); selector.setAttribute('translate', 'no');
  for (const item of options) { const option = document.createElement('option'); option.value = item.code; option.lang = item.code; option.textContent = item.label; selector.append(option); }
  selector.value = language;
  function value(current: string, record?: RecordValue): RecordValue {
    const source = record && current === record.rendered ? record.source : sourceMessage(current);
    const rendered = translate(source, language);
    // Keep spacing around split text nodes and inline elements.
    return { source, rendered: rendered === source ? source : (source.match(/^\s*/)?.[0] ?? '') + rendered + (source.match(/\s*$/)?.[0] ?? '') };
  }
  function element(el: Element): void {
    if ((el.matches(SKIP) && !el.matches('input, textarea, canvas, [contenteditable]')) || el.closest('[translate="no"], [data-i18n-skip]')) return;
    const records = attributes.get(el) ?? new Map<string, RecordValue>(); attributes.set(el, records);
    for (const name of ['title','aria-label','aria-description','placeholder','alt']) {
      if (!el.hasAttribute(name)) continue;
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
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement || node.parentElement.closest(SKIP)) return;
      const record = value(node.nodeValue ?? '', texts.get(node)); texts.set(node, record);
      if (node.nodeValue !== record.rendered) node.nodeValue = record.rendered;
      return;
    }
    if (!(node instanceof Element) || node.parentElement?.closest(SKIP)) return;
    if (node.matches(SKIP)) { if (node.matches('input, textarea, canvas, [contenteditable]')) element(node); return; }
    element(node);
    for (const child of Array.from(node.childNodes)) update(child);
  }
  function mountSelector(): void {
    const host = root.querySelector('.titlebar, .topbar, .start-actions, .welcome-actions, .boot-actions, header');
    if (host) { selector.classList.remove('language-selector-floating'); if (selector.parentNode !== host) host.append(selector); }
    if (!selector.isConnected) { selector.classList.add('language-selector-floating'); root.append(selector); }
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
      ['meta[property="og:site_name"]',data.siteName],['meta[property="og:image:alt"]',data.image.alt],
      ['meta[name="twitter:title"]',data.title],['meta[name="twitter:description"]',data.description],['meta[name="twitter:image:alt"]',data.image.alt],
    ];
    for (const [query,content] of fields) document.querySelector(query)?.setAttribute('content',content);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href',data.url);
    const graph = document.querySelector('script[type="application/ld+json"]');
    if (graph?.textContent) {
      const existing = JSON.parse(graph.textContent);
      for (const item of existing['@graph'] ?? []) {
        if (item['@type'] === 'WebApplication') Object.assign(item,{...data.application,'@id':data.url+'#app',url:data.url,description:data.description,inLanguage:language,author:data.author});
        if (item['@type'] === 'BreadcrumbList') item.itemListElement=data.breadcrumbs;
      }
      graph.textContent=JSON.stringify(existing).replace(/</g,'\\u003c');
    }
  }
  selector.addEventListener('change', async () => {
    selector.disabled=true;
    try { await loadLanguage(selector.value); } catch { selector.value=language; selector.disabled=false; return; }
    selector.disabled=false;
    const url = new URL(languageUrl(location.href,selector.value));
    // Dev servers use /en/; published apps use /opencad-<format>/en/.
    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
      const base = location.pathname.match(/^\/(?:2dcad-viewer|opencad-(?:dwgdxf|skp|step|nc))\//)?.[0] ?? '/';
      url.pathname = base + (selector.value === 'ko' ? '' : selector.value + '/');
    }
    language = selector.value;
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
    metadata(); canvasLabels(); update(presentationRoot);
    root.dispatchEvent(new CustomEvent('languagechange',{detail:language}));
  });
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
    observer.disconnect(); titleObserver.disconnect(); selector.remove();
    for (const [view,label] of originalViews) VIEW_LABELS[view as keyof typeof VIEW_LABELS]=label;
    CUBE_FACES.forEach((face,index) => { face.label=originalFaces[index]!; });
  };
}
