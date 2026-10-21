import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { installLocalization } from '../src/app/i18n';
import { catalogs, currentLanguage, languageUrl, languages, translate } from '../site/i18n.mjs';
import { NC_DIALECT_NAMES } from '../src/model';

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
  it('has no machine-translation leftovers: stray extra lines or wrong-sense words', () => {
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const [key, value] of Object.entries(catalogs[code])) {
        expect(value.split('\n').length, `${code}: ${key}`).toBe(key.split('\n').length);
        // 해석(parse)을 통역으로, 그릴(draw)을 석쇠로, 이송(feed)을 송금·전송으로, 주석(annotation)을 주석(錫)으로, 개(個)를 개(犬)로 옮긴 말
        expect(value, `${code}: ${key}`).not.toMatch(/译员|Dolmetsch|grill|Grill|格栅|转账|转移|Übertrag|錫|犬|Revision|Processing/);
      }
    expect(translate('직선 이송', 'de')).toBe('Geradenvorschub');
    expect(translate('급속', 'de')).toBe('Eilgang');
  });
  it('translates every piece of a " · "-joined sentence, even when a short pattern would swallow the rest', () => {
    const hangul = /[가-힣]/;
    // "줄 {0}"·"중심 {0}"·"{0} · 줄 {1}"이 문장 끝까지 잡아 나머지가 한국어로 남던 줄(상태 막대의 고른 이동·원호 상태)
    const lines = ['줄 12 · 직선 이송 · T1 · F100 · 1, 2, 3', '줄 3 · 급속 · T2 · 0, 0, 5', 'O1001.nc · 줄 4 · 직선 이송 · T1 · F100 · 1, 2, 3',
      'O1001.nc · 줄 4 · 이동 없음', '중심 10 20 -5 · R 5 · 시계 90°', '중심 0 0 0 · R 2.5 · 반시계 180°'];
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const line of lines) expect(translate(line, code), `${code}: ${line}`).not.toMatch(hangul);
    expect(translate('줄 12 · 직선 이송 · T1 · F100 · 1, 2, 3', 'en')).toBe('Line 12 · Linear feed · T1 · F100 · 1, 2, 3');
    expect(translate('O1001.nc · 줄 4 · 직선 이송 · T1 · F100 · 1, 2, 3', 'en')).toBe('O1001.nc · Line 4 · Linear feed · T1 · F100 · 1, 2, 3');
    expect(translate('중심 10 20 -5 · R 5 · 시계 90°', 'en')).toBe('Center 10 20 -5 · R 5 · CW 90°');
    // 잡은 값(파일 이름·공구 이름)은 그대로: 한국어 공구 이름도 바꾸지 않는다
    expect(translate('줄 3 · 급속 · 공구 모서리 · 0, 0, 5', 'en')).toBe('Line 3 · Rapid · 공구 모서리 · 0, 0, 5');
    expect(translate('줄 3 · 급속 · CUTTER_A · 0, 0, 5', 'en')).toBe('Line 3 · Rapid · CUTTER_A · 0, 0, 5');
  });
  it('names the detected dialect in the "자동 (…)" option in every language', () => {
    // 정보 탭 방언 고르기의 첫 항목: 방언 이름이 한국어인 것(일반 ISO·Heidenhain 평문)도 그 언어로
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const name of Object.values(NC_DIALECT_NAMES)) expect(translate(`자동 (${name})`, code), `${code}: ${name}`).not.toMatch(/[가-힣]/);
    expect(translate('자동 (일반 ISO)', 'en')).toBe('Automatic (General ISO)');
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
    const trigger=root.querySelector<HTMLButtonElement>('.language-trigger')!;
    trigger.click();expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu=document.querySelector<HTMLElement>('.language-list')!;
    expect(menu.hidden).toBe(false);expect(menu.querySelectorAll('[role=menuitemradio]')).toHaveLength(5);
    (menu.querySelector('[data-language=de]') as HTMLButtonElement).click();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(document.getElementById('pretranslated')!.textContent).toBe(translate('열기','de'));
    expect(document.documentElement.lang).toBe('de');expect(button.textContent).toBe(translate('열기','de'));
    expect(dialog.textContent).toBe(translate('닫기','de'));
    expect(location.search).toBe('?sample');expect(location.hash).toBe('#view');
    expect(menu.hidden).toBe(true);
    expect(menu.querySelector('[data-language=de]')!.getAttribute('aria-checked')).toBe('true');
    trigger.click();
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    expect(menu.hidden).toBe(true);expect(document.activeElement).toBe(trigger);
    trigger.click();(menu.querySelector('[data-language=ko]') as HTMLButtonElement).click();
    await new Promise(resolve=>setTimeout(resolve,0));expect(button.textContent).toBe('열기');
    expect(root.querySelector('canvas')).toBe(canvas);button.click();expect(clicked).toHaveBeenCalledOnce();
    expect(root.querySelector('[translate="no"]:not(.language-control):not(.language-list)')!.textContent).toBe('열기');
    dispose();dispose=undefined;dom.window.close();
  });
  it('dismisses the language menu with Escape without cancelling a file import', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header></div></body></html>', {url:'https://gyutae-kim.github.io/opencad-nc/'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const { NcViewerApp } = await import('../src/app/app');
    dispose=await installLocalization(document.getElementById('app')!);
    const cancelLoad=vi.fn();
    const app={busy:true,cancelLoad};
    const onKey=(NcViewerApp.prototype as unknown as {onKey(event: KeyboardEvent):void}).onKey;
    const captured=(event: KeyboardEvent) => onKey.call(app,event);
    window.addEventListener('keydown',captured,true);
    try {
      const trigger=document.querySelector<HTMLButtonElement>('.language-trigger')!;
      trigger.click();
      const menu=document.querySelector<HTMLElement>('.language-list')!;
      document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      expect(menu.hidden).toBe(true);expect(document.activeElement).toBe(trigger);expect(cancelLoad).not.toHaveBeenCalled();
      document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      expect(cancelLoad).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('keydown',captured,true);dispose();dispose=undefined;dom.window.close(); }
  });
});
