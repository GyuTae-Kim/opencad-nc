import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {languages,catalogs,metadataForLanguage} from '../site/i18n.mjs';
const keys=Object.keys(catalogs.en).sort();
const sw=readFileSync('dist/sw.js','utf8');
for(const{code}of languages){
 if(code!=='ko'){
  const catalog=catalogs[code];assert.deepEqual(Object.keys(catalog).sort(),keys,code);
  for(const key of keys){assert.ok(catalog[key]?.trim(),`${code}: empty ${key}`);assert.deepEqual((catalog[key].match(/\{\d+\}/g)??[]).sort(),(key.match(/\{\d+\}/g)??[]).sort(),`${code}: parameters ${key}`);}
 }
 const raw=readFileSync(`dist/${code==='ko'?'':code+'/'}index.html`,'utf8');const metadata=metadataForLanguage(code);const dom=new JSDOM(raw,{url:metadata.url});const doc=dom.window.document;
 assert.equal(doc.documentElement.lang,code);assert.equal(doc.title,metadata.title);assert.equal(doc.querySelector('link[rel=canonical]').href,metadata.url);
 assert.equal(doc.querySelectorAll('link[rel=alternate][hreflang]').length,6);
 for(const item of languages)assert.equal(doc.querySelector(`link[hreflang="${item.code}"]`).href,metadataForLanguage(item.code).url);
 for(const script of doc.querySelectorAll('script[src]'))assert.equal(new URL(script.src).pathname.includes(`/${code}/assets/`),false,'nested language assets must resolve to application root');
 // Home-screen install: each language page links its own manifest that starts on that page, covers the whole app and has existing icons.
 const root=metadataForLanguage('ko').url,file=url=>{assert.ok(url.startsWith(root),url);return 'dist/'+url.slice(root.length);};
 const manifestUrl=doc.querySelector('link[rel=manifest]').href,manifest=JSON.parse(readFileSync(file(manifestUrl),'utf8'));
 assert.equal(new URL(manifest.start_url,manifestUrl).href,metadata.url,`${code}: manifest start_url`);assert.equal(new URL(manifest.scope,manifestUrl).href,root,`${code}: manifest scope`);
 assert.equal(manifest.lang,code);assert.equal(doc.querySelector('meta[name="apple-mobile-web-app-title"]').content,manifest.short_name);
 for(const icon of manifest.icons)assert.ok(existsSync(file(new URL(icon.src,manifestUrl).href)),`${code}: ${icon.src}`);
 assert.ok(existsSync(file(doc.querySelector('link[rel=apple-touch-icon]').href)),`${code}: apple-touch-icon`);
 if(code!=='ko')assert.doesNotMatch(`${manifest.name} ${manifest.short_name} ${manifest.description}`,/[가-힣]/,`${code}: untranslated manifest`);
 // Offline app: shared files and desktop "Open with" land on this language page; the service worker caches the page.
 assert.equal(new URL(manifest.file_handlers?.[0]?.action??'',manifestUrl).href,metadata.url,`${code}: file_handlers action`);
 assert.equal(new URL(manifest.share_target?.action??'',manifestUrl).href,metadata.url+'share-target',`${code}: share_target action`);
 assert.ok(sw.includes(JSON.stringify(code==='ko'?'./':code+'/')),`${code}: page not precached by sw.js`);
 if(code!=='ko'){
  const main=doc.querySelector('main');main.querySelectorAll('[data-static-languages]').forEach(el=>el.remove());
  assert.doesNotMatch(main.textContent,/[가-힣]/,`${code}: untranslated static introduction`);
 }
 dom.window.close();
}
console.log(`i18n check passed: five static language pages, reciprocal alternatives, relative assets, home-screen manifests with file handling, offline pages and ${keys.length} catalog messages.`);
