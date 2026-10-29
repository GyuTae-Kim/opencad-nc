import { metadataForLanguage } from '../site/i18n.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { installLocalization } from '../src/app/i18n';
import { catalogs, currentLanguage, languageUrl, languages, translate } from '../site/i18n.mjs';
import { NC_DIALECT_NAMES } from '../src/model';
import { parseGcode } from '../src/gcode';
import { noticeViews } from '../src/app/doc';

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
    expect(translate('홈 · 포켓', 'en')).toBe('Grooves · Pockets');
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      expect(translate('woodWOP MPR 읽는 중', code), code).toContain('woodWOP MPR');
    }
    expect(translate('G-code 읽는 중', 'de')).not.toMatch(/^Reading/);
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
  it('translates each line of a multi-line warning tooltip, even when one pattern would swallow both lines', () => {
    // 코드 목록의 경고 줄 번호 칸 title: 한 줄에 경고 둘("T{0}: …"가 두 줄을 다 잡아 앞 줄이 한국어로 남던 것)
    const tip = 'T2: 공구 교환 뒤 공구 길이 보정(G43 H) 없이 절삭\nT2: 주축이 멈춘 채(M5·S0) 절삭 이동';
    for (const {code} of languages.filter(item => item.code !== 'ko')) {
      expect(translate(tip, code), code).not.toMatch(/[가-힣]/);
      expect(translate('지원하지 않는 G150\nG150 블록의 좌표는 이동으로 그리지 않음', code), code).not.toMatch(/[가-힣]/);
    }
    expect(translate(tip, 'en')).toBe('T2: cutting after the tool change without tool length offset (G43 H)\nT2: cutting move with the spindle stopped (M5 · S0)');
    // 묶음 이름·형식 조각·공구 숨기기 단추
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const text of ['급속 이송', '기계 원점 쪽 이동(추정)', '공구 없음', '보정 경로', '꺼진 가공', '기타 가공(위치)', 'Fanuc · 선반 · mm', 'T1 숨기기', 'T1 보이기', '화면으로 보내는 중'])
        expect(translate(text, code), `${code}: ${text}`).not.toMatch(/[가-힣]/);
  });
  it('translates the NURBS warnings and the lathe G code system notices and choices in every language', () => {
    const nurbs = parseGcode('G21 G17\nG0 X0 Y0 Z0\nG5.2 L1 X5 Y5 Z1 F100\nX10\nG5.3 X1\nX20 Y0\nG5.3\nG18\nG5.2 X1 Y1\nG5.3\nG17\nG5.2 X1 Y1 P0\nG5.3\nG5.2 L5 X1 Y1\nG5.3\nG5.2 L2 X1 Y1\nG5.3\nG5.2 X1 Y1\nG1 X0\nG5.2 X1 Y1\n', { dialect: 'linuxcnc' });
    const hint = parseGcode('O1\nG21 G18\nG0 X50 Z2\nG91 G1 X-10 F0.2\nG90\nM30', { lathe: true });
    const named = parseGcode('G21\n#<a> = 1\no1 sub\nG1 X#<a> F100\no1 endsub\no1 call\nM2\n', { dialect: 'linuxcnc' });
    const texts = [...nurbs.warningItems!, ...hint.warningItems!, ...named.warningItems!].map((w) => w.text).filter((t) => /NURBS|G5\.[23]|체계|이름 변수/.test(t));
    expect(texts.length).toBeGreaterThanOrEqual(11);
    expect(texts).toContain('지역 이름 변수 #<a>가 이 범위에서 정해지지 않음 — LinuxCNC는 오류(빈 값으로 읽음)');
    const notices = noticeViews({ nc: { notices: [{ kind: 'lathe-system', system: 'B' }, { kind: 'lathe-system', system: 'C' }, { kind: 'lathe-system', system: 'A', hints: ['G91', 'G77·G78·G79'] }] } as never, ncOptions: {}, dismissedNotices: new Set() });
    expect(notices).toHaveLength(3);
    const ui = ['체계 바꾸기', '선반 G 코드', '선반 G 코드 체계', '자동 (A 체계)', '자동 (B 체계)', '자동 (C 체계)', 'A 체계', 'B 체계', 'C 체계',
      'Fanuc 선반 G 코드 체계 — A: G90·G92·G94 단순 사이클·U/W 증분, B: G77·G78·G79 단순 사이클·G90/G91 절대/증분, C: G20·G21·G24 단순 사이클·G70/G71 inch/mm'];
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const text of [...texts, ...notices.map((n) => n.text), ...ui]) expect(translate(text, code), `${code}: ${text}`).not.toMatch(/[가-힣]/);
    expect(translate('G5.2 NURBS: 조정점 2개가 계수 L3보다 적음 — 조정점을 직선으로 이음', 'en')).toBe('G5.2 NURBS: 2 control points are fewer than the order L3 — control points joined with straight lines');
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
  it('translates code-list tooltips and NC group names but leaves program text and named-tool groups alone', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header>'
      + '<div class="vlist code-list" aria-label="프로그램 코드"><div class="vlist-row warn"><span class="ln" title="T1: 주축이 멈춘 채(M5·S0) 절삭 이동">12</span><span class="tx">(급속 이송)</span></div></div>'
      + '<label class="group-item"><span class="name">급속 이송</span></label><label class="group-item"><span class="name" translate="no">공구 없음</span></label>'
      + '</div></body></html>', {url:'https://gyutae-kim.github.io/opencad-nc/en/'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose = await installLocalization(root);
    const list = root.querySelector('.code-list')!;
    expect(list.getAttribute('aria-label')).toBe(translate('프로그램 코드','en'));
    expect(root.querySelector('.ln')!.getAttribute('title')).toBe(translate('T1: 주축이 멈춘 채(M5·S0) 절삭 이동','en'));
    expect(root.querySelector('.tx')!.textContent).toBe('(급속 이송)');
    const names = [...root.querySelectorAll('.group-item .name')].map(n => n.textContent);
    expect(names).toEqual([translate('급속 이송','en'), '공구 없음']);
    // 가상 목록이 새 줄을 그리면(스크롤) 그 줄의 경고 title도 옮긴다
    const row = document.createElement('div'); row.className = 'vlist-row warn';
    row.innerHTML = '<span class="ln" title="지원하지 않는 G150">40</span><span class="tx">G150 X5</span>';
    list.append(row);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(row.querySelector('.ln')!.getAttribute('title')).toBe(translate('지원하지 않는 G150','en'));
    expect(row.querySelector('.tx')!.textContent).toBe('G150 X5');
    dispose(); dispose = undefined; dom.window.close();
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
  it('switches actual sharing image URLs and native control names while preserving source data', async () => {
    const korean = metadataForLanguage('ko');
    const dom = new JSDOM(`<!doctype html><html><head><title>OpenCAD</title><meta property="og:image"><meta property="og:image:secure_url"><meta name="twitter:image"><script type="application/ld+json">{"@graph":[{"@type":"WebApplication"}]}</script></head><body><div id="app"><header class="titlebar"><button>열기</button></header><span class="docname">열기.skp</span></div></body></html>`, {url:languageUrl(korean.url,'en')+'?sample#view'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose=await installLocalization(root);
    const labels = {en:'Choose language', de:'Sprache wählen', ko:'언어 선택'};
    for (const code of ['en','de','ko'] as const) {
      if (code!=='en') {
        (document.querySelector(`.language-list [data-language="${code}"]`) as HTMLButtonElement).click();
        for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
      }
      const image = code==='ko' ? korean.image.url : `https://gyutae-kim.github.io/assets/i18n/${code}/og/opencad.jpg`;
      for (const selector of ['meta[property="og:image"]','meta[property="og:image:secure_url"]','meta[name="twitter:image"]']) expect(document.querySelector(selector)!.getAttribute('content')).toBe(image);
      expect(JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!)['@graph'][0].image).toBe(image);
      expect(root.querySelector('.language-trigger')!.getAttribute('aria-label')).toBe(labels[code]);
      expect(root.querySelector('.docname')!.textContent).toBe('열기.skp');

    }
    dispose();dispose=undefined;dom.window.close();
  });

});
