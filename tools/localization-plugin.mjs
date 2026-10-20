import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderMetadata, metadata } from './site-metadata.mjs';
import { currentLanguage, languages, languageUrl, translate } from '../site/i18n.mjs';
const escape = value => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const decode = value => value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
export function localizeHtml(html, language) {
  html=html.replace(/<!-- localized-metadata:start -->[\s\S]*?<!-- localized-metadata:end -->/,`<!-- localized-metadata:start -->${renderMetadata(language)}<!-- localized-metadata:end -->`);
  const body=html.indexOf('<body');
  let raw=false;
  html=html.slice(0,body)+html.slice(body).replace(/<[^>]+>|[^<]+/g,token=>{
    if(token.startsWith('<')){
      if(/^<(?:script|style)\b/i.test(token))raw=true;
      if(/^<\/(?:script|style)>/i.test(token))raw=false;
      return raw?token:token.replace(/\b(alt|title|aria-label|placeholder|href)="([^"]*)"/g,(_,name,value)=>`${name}="${escape(name==='href'?languageUrl(decode(value),language):translate(decode(value),language))}"`);
    }
    if(raw)return token;
    const translated=translate(decode(token),language);
    return translated===decode(token)?token:(token.match(/^\s*/)?.[0]??'')+escape(translated)+(token.match(/\s*$/)?.[0]??'');
  });
  const navigation = `<nav data-static-languages aria-label="Language">${languages.map(item => `<a href="${languageUrl(metadata.url,item.code)}" lang="${item.code}" hreflang="${item.code}"${item.code===language?' aria-current="true"':''}>${item.label}</a>`).join(' · ')}</nav>`;
  if (html.includes('data-static-languages')) html=html.replace(/<nav data-static-languages[^>]*>[\s\S]*?<\/nav>/,navigation);
  else html=html.replace(/(<main\b[^>]*>)/,'$1'+navigation);
  html=html.replace(/<html lang="[^"]*"/,`<html lang="${language}"`);
  if(language!=='ko')html=html.replace('<head>','<head>\n    <base href="../">');
  return html;
}
export function siteLocalization(){
 return {
  name:'opencad-localized-pages',enforce:'post',
  transformIndexHtml:{order:'post',handler(html,ctx){return localizeHtml(html,currentLanguage(new URL(ctx.originalUrl??ctx.path,'http://localhost').href));}},
  writeBundle(options){
    const root=options.dir??'dist';const html=readFileSync(join(root,'index.html'),'utf8');
    for(const{code}of languages.filter(item=>item.code!=='ko')){
      mkdirSync(join(root,code),{recursive:true});writeFileSync(join(root,code,'index.html'),localizeHtml(html,code));
    }
  },
 };
}
