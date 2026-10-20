import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { installLocalization } from '../src/app/i18n';
import { catalogs, currentLanguage, languageUrl, languages, translate } from '../site/i18n.mjs';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); vi.unstubAllGlobals(); });
describe('language URLs and UI presentation', () => {
  it('keeps launch parameters and fragments, with explicit language URLs', () => {
    expect(currentLanguage('https://example.test/opencad-skp/ja/?sample#view')).toBe('ja');
    expect(currentLanguage('https://example.test/opencad-skp/?lang=de')).toBe('de');
    const url = new URL(languageUrl('https://gyutae-kim.github.io/opencad-skp/?sample&open=a.skp#view','en'));
    expect(url.pathname).toBe('/opencad-skp/en/'); expect(url.searchParams.has('sample')).toBe(true);
    expect(url.searchParams.get('open')).toBe('a.skp'); expect(url.hash).toBe('#view');
  });
  it('ships matching catalogs and preserves numbered parameters', () => {
    const keys = Object.keys(catalogs['en']).sort();
    for (const {code} of languages.filter(item => item.code !== 'ko')) {
      expect(Object.keys(catalogs[code]).sort()).toEqual(keys);
      for (const key of keys) expect((catalogs[code][key].match(/\{\d+\}/g) ?? []).sort()).toEqual((key.match(/\{\d+\}/g) ?? []).sort());
    }
    expect(translate('열기 ▾','en')).toBe('Open ▾');
    const template = Object.keys(catalogs.en).find(key => key.includes('{0}') && /[가-힣]/.test(key))!;
    const example = template.replace(/\{\d+\}/g, 'FILE_A.skp');
    expect(translate(example,'en')).toContain('FILE_A.skp');
    expect(translate(example,'en')).not.toBe(example);
  });
  it('updates dynamic UI and switches languages without changing document data or listeners', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"><button>열기</button><span class="docname">열기</span></header><canvas></canvas><div class="anno-layer">열기</div><input value="열기" placeholder="열기"><div contenteditable="true">열기</div><div translate="no">열기</div><p id="status">열기</p></div></body></html>', {url:'https://gyutae-kim.github.io/opencad-skp/en/?sample#view'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    const existing=document.createElement('p');existing.id='pretranslated';existing.textContent=translate('열기','en');root.append(existing);
    const canvas = root.querySelector('canvas');
    const button = root.querySelector('button')!; const clicked = vi.fn(); button.addEventListener('click',clicked);
    dispose=await installLocalization(root);
    expect(button.textContent).toBe(translate('열기','en'));
    expect(root.querySelector('.docname')!.textContent).toBe('열기'); expect(root.querySelector('input')!.value).toBe('열기');
    expect(root.querySelector('input')!.placeholder).toBe(translate('열기','en'));
    expect(root.querySelector('[contenteditable]')!.textContent).toBe('열기');
    expect(root.querySelector('.anno-layer')!.textContent).toBe('열기');
    const status = document.getElementById('status')!; status.textContent='닫기';
    await new Promise(resolve=>setTimeout(resolve,0)); expect(status.textContent).toBe(translate('닫기','en'));
    const dialog=document.createElement('div');dialog.textContent='닫기';document.body.append(dialog);
    await new Promise(resolve=>setTimeout(resolve,0));expect(dialog.textContent).toBe(translate('닫기','en'));
    const select=root.querySelector('select')!;select.value='de';select.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(document.getElementById('pretranslated')!.textContent).toBe(translate('열기','de'));
    expect(document.documentElement.lang).toBe('de');expect(button.textContent).toBe(translate('열기','de'));
    expect(dialog.textContent).toBe(translate('닫기','de'));
    expect(location.search).toBe('?sample');expect(location.hash).toBe('#view');
    select.value='ko';select.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve=>setTimeout(resolve,0));expect(button.textContent).toBe('열기');
    expect(root.querySelector('canvas')).toBe(canvas);button.click();expect(clicked).toHaveBeenCalledOnce();
    expect(root.querySelector('[translate="no"]:not(select)')!.textContent).toBe('열기');
    dispose();dispose=undefined;dom.window.close();
  });
});
