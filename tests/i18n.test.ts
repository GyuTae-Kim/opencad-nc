import { metadataForLanguage } from '../site/i18n.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { installLocalization, localizeCubeFaces } from '../src/app/i18n';
import { catalogs, currentLanguage, languageUrl, languages, translate } from '../site/i18n.mjs';
import { NC_DIALECT_NAMES } from '../src/model';
import { parseGcode } from '../src/gcode';
import { noticeViews } from '../src/app/doc';
import { plainText } from '../src/app/filetext';

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
        // 32차: 거리(distance)를 길거리로, 선반(lathe)을 책꽂이로, 보정(compensation)을 교정(calibration)으로, 현(chord)을 화음으로, 판(panel)을 회로 기판으로,
        // 합성(synthetic)을 작곡으로, "선반 모드에서만 읽음"을 읽기 전용으로, 휴지(dwell)를 공회전으로, 회전축 감기를 코일 감기로, 주속 일정(constant surface speed)을 일정표로 옮긴 말
        expect(value, `${code}: ${key}`).not.toMatch(/通り|棚|搁板|Regal|shelf|Kalibrier|calibrat|校正|Akkord|Platine|komposition|只读|Leerlauf|空闲|Wicklung|スケジュール|速度表|schedule/);
        // 47차: "…로 봄"(~로 여김)의 봄을 계절 봄(春)으로 옮긴 말
        expect(value, `${code}: ${key}`).not.toMatch(/春|Frühling|\bspring\b/);
      }
    expect(translate('거리', 'ja')).toBe('距離');
    expect(translate('선반 프로그램으로 보임', 'en')).toBe('Appears to be a lathe program');
    expect(translate('· 선반', 'zh-CN')).toBe('· 车床');
    expect(translate('직선 이송', 'de')).toBe('Geradenvorschub');
    expect(translate('급속', 'de')).toBe('Eilgang');
    expect(translate('홈 · 포켓', 'en')).toBe('Grooves · Pockets');
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      expect(translate('woodWOP MPR 읽는 중', code), code).toContain('woodWOP MPR');
    }
    expect(translate('G-code 읽는 중', 'de')).not.toMatch(/^Reading/);
    // 도구 모음(OpenCAD 도구를 모은 쪽)을 도구 막대(toolbar)로 옮긴 말 — 제목 줄 단추 설명(다른 OpenCAD 앱과 같은 말)
    expect(['en', 'ja', 'zh-CN', 'de'].map((code) => translate('OpenCAD 도구 모음', code))).toEqual(['OpenCAD Tool List', 'OpenCADツールのリスト', 'OpenCAD 工具列表', 'OpenCAD-Toolliste']);
  });
  it('keeps NC homonyms, statements, code words and one term per concept in every catalog (52nd review)', () => {
    const codes = ['en', 'ja', 'zh-CN', 'de'];
    // [한국어 열쇠에 든 말, 언어(*는 넷 다), 있어야 할 말(없으면 null), 없어야 할 말] — 52차에 사전 전체를 읽고 찾은 오역·들쭉날쭉한 용어
    const rules: [string, string, RegExp | null, RegExp][] = [
      // 동음이의: 고름(고른 것)→고름(膿), 무늬(texture)→무늬(pattern — NC에는 PATTERN DEF가 따로 있다), 합성(synthetic)→복합, 상자(3D box)→칸·정사각형,
      // 올리다(upload)→들어 올리다·반올림, 원점(origin)→출신, 뷰(view 명사)→보다(동사), 단면(section)→한쪽 면, 감지 않음(감지 않다=wrap 안 함)→감지(detect),
      // 표지(label)→책 표지, 자리(position)→숫자 자리, 열 파일(열 것)→열(列), 몇(how many)→몇몇, 주(main)→주석(注), 가공도(…도 그리기)→가공도(그림),
      // 멈춤(stopped)→갇힘, 둘레 상자(bounding box)→둘레(circumference), 기본 단위(default unit)→기본 부품·장치, 묶음(group)→꾸러미(bundle), 가공→과정(process),
      // 공구 끝점(tool tip)→끝점(end point), 드릴(drilling)→연습(drill), 해(solution)→해(年), 모서리(corner)→변(edge), 선반(lathe)→책꽂이, 멈추다(그만두다)→일시 멈춤,
      // 식이 끝났다(뜻밖에 끝남)→완료, 다시 읽음(다시 읽는다)→끝남·명령, 임의(arbitrary)→무작위, 급속(rapid)→빠른, 식(expression)→방정식
      ['고름:', '*', null, /Pus|Eiter|膿|脓|更正/],
      ['무늬', '*', null, /Pattern|Muster|柄|图案|パターン|模様/],
      ['합성 장면', '*', null, /Composite|Komposition|複合/],
      ['상자', '*', null, /\bFeld\b|Quadrat|方框|^框$|Umfangskasten|周边盒子|円周/],
      ['올리는 중', '*', null, /Anheben|提升/],
      ['다 올림', '*', null, /上へ|向上取整|werden hochgeladen|Uploading all/],
      ['원점', '*', null, /Herkunft|起源/],
      ['뷰 큐브', 'de', /Ansichtswürfel/, /Würfel anzeigen/],
      ['뷰 큐브', 'zh-CN', /视图立方体/, /查看立方体|立方体视图/],
      ['단면', 'en', /[Ss]ection/, /Single-sided|Cross/],
      ['단면', 'de', /Schnitt/, /Einseitig|Querschnitt|Abschnitt/],
      ['단면', 'zh-CN', null, /部分/],
      ['감지 않음', '*', null, /sensed|検出|检测|erfasst/],
      ['표지', '*', null, /cover|カバー|前盖|Etikett/i],
      ['자리가 아님', '*', null, /digit|Ziffer|数字|場所/],
      ['열 파일 주소', '*', null, /Column|Spalte|列/],
      ['몇 선분', '*', null, /a few|ein paar|从哪个|数線分/],
      ['주 프로그램', 'zh-CN', /主程序/, /注释/],
      ['꺼진 가공도', '*', null, /diagram|Diagramm|オフセット|凹槽/],
      ['멈춤', '*', null, /\bstuck\b|\bSTOP\b|hängen|steckt fest|卡住/],
      ['둘레 상자', '*', null, /perimeter|円周|周边|Umfang/],
      ['기본 단위', '*', null, /Basic unit|基本单元|Grundgerät/],
      ['묶음', '*', null, /Bundle|Bündel|捆绑/i],
      ['가공', 'zh-CN', null, /进程/],
      ['가공', 'de', null, /\bProzess/],
      ['공구 끝점 제어', '*', null, /end point control|終点|终点|Endpunktsteuerung/i],
      ['드릴처럼', '*', null, /Übung|就像钻头/],
      ['해 고르기', 'ja', null, /年/],
      ['모서리', '*', null, /\bEdges overlap|エッジが重な|边重叠|Kanten überlappen|draws the edges|按原样绘制边缘|zeichnet die Kanten/],
      ['선반', 'ja', null, /シェルフ|棚/],
      ['읽기를 멈췄', '*', null, /pausier|暂停/],
      ['읽기 멈추기', '*', null, /pausier|暂停/],
      ['식이 끝났다', '*', null, /complete|完成|abgeschlossen|終了しました/],
      ['다시 읽음', '*', null, /^Read again$|済み|已重新|Lesen Sie/],
      ['임의', '*', null, /random|随机|Zufällig/i],
      ['급속', 'de', null, /Schnell/],
      ['식', 'zh-CN', null, /方程/],
      ['식', 'de', null, /Gleichung/],
      // 같은 개념은 한 말로: NC 블록은 중국어 程序段·독일어 Satz(HEIDENHAIN·SINUMERIK 독일어 설명서의 NC-Satz)
      ['블록', 'zh-CN', null, /块(?!数据)|模块/],
      ['블록', 'de', null, /\bBlock|Blöcke/],
    ];
    for (const [term, lang, need, ban] of rules)
      for (const code of lang === '*' ? codes : [lang])
        for (const [key, value] of Object.entries(catalogs[code])) {
          if (!key.includes(term)) continue;
          if (need) expect(value, `${code}: ${key}`).toMatch(need);
          expect(value, `${code}: ${key}`).not.toMatch(ban);
        }
    // 코드 낱말(키워드·이름)은 옮기지 않는다(THEN→然后·DANN, WHILE … DO→过了一段时间就不要做, TOOL CALL→刀具调用, STEP→步骤, Tasche→塔, LinuxCNC→Linux数控)
    const code = /\b(?:THEN|WHILE|GOTO|ENDIF|TOOL CALL|CYCL CALL|LinuxCNC|STEP|Tasche|createImageBitmap|Heidenhain)\b/g;
    for (const lang of codes)
      for (const [key, value] of Object.entries(catalogs[lang])) {
        // 서술 경고를 1인칭("I don't know"·"Ich kenne"·"我不知道")이나 명령형("Ignore …"·"Zeichnen Sie …")으로 옮긴 것, 섞여 들어온 쓰레기 글
        expect(value, `${lang}: ${key}`).not.toMatch(/\bI (?:do|don't|read|work|assume)\b|\bso I\b|\bIch\b|我(?!们)|私は/);
        expect(value, `${lang}: ${key}`).not.toMatch(/^Ignore |— do not draw|, draw with|Zeichnen Sie (?:keine|ein)|Öffnen Sie keine|(?:Linie|Halbkreis) zeichnen|nicht zeichnen\b|ignorieren \(/);
        expect(value, `${lang}: ${key}`).not.toMatch(/Stuck|Sep 24|2016|\bnein\b|\{\d+\}第二/);
        // 검색 제목(언어별로 일부러 다르게 쓴 글)은 뺀다
        if (!key.startsWith('OpenCAD 무료 NC·G-code 뷰어 |')) for (const word of key.match(code) ?? []) expect(value, `${lang}: ${key}`).toContain(word);
        // 화면에서 옮기지 않는 인라인 스크립트 열쇠도 코드는 원문 그대로(옮긴 글이 data-theme·catch를 바꾸거나 가운데를 잘랐다)
        if (key.startsWith('// ') && key.includes('(function')) expect(value.endsWith(key.slice(key.indexOf('(function'))), `${lang}: script`).toBe(true);
      }
    // 고친 말(4개 언어): 고른 것, 3D 무늬, 뷰 큐브, 경고 되풀이 수, 식 오류, 공구 끝점 제어, 열 파일 주소
    const want: [string, string[]][] = [
      ['고름: {0} "{1}" #{2}{3} ({4})', ['Selected: {0} "{1}" #{2}{3} ({4})', '選択：{0} "{1}" #{2}{3} ({4})', '已选：{0} "{1}" #{2}{3} ({4})', 'Ausgewählt: {0} „{1}“ #{2}{3} ({4})']],
      ['무늬', ['Texture', 'テクスチャ', '纹理', 'Textur']],
      ['뷰 큐브', ['View Cube', 'ビューキューブ', '视图立方体', 'Ansichtswürfel']],
      ['{0}{1} (모두 {2}번)', ['{0}{1} ({2} times in total)', '{0}{1}（全 {2} 回）', '{0}{1}（共 {2} 次）', '{0}{1} (insgesamt {2}-mal)']],
      ['식이 끝났다', ['Unexpected end of expression', '式が途中で終わった', '表达式意外结束', 'Ausdruck endet unerwartet']],
      ['G43.4 공구 끝점 제어는 위치만 그림(회전축 무시)', ['G43.4 tool center point control: only positions are drawn (rotary axes ignored)', 'G43.4 工具先端点制御は位置のみ描画（回転軸は無視）', 'G43.4 刀尖点控制仅绘制位置（忽略旋转轴）', 'G43.4 TCP-Steuerung: nur die Position wird gezeichnet (Drehachsen ignoriert)']],
      ['열 파일 주소(?open=)가 비어 있습니다.', ['The address of the file to open (?open=) is empty.', '開くファイルのアドレス（?open=）が空です。', '要打开的文件地址（?open=）为空。', 'Die Adresse der zu öffnenden Datei (?open=) ist leer.']],
    ];
    for (const [ko, values] of want) expect(codes.map((code) => translate(ko, code)), ko).toEqual(values);
    // 경고 글 안에 끼워 쓴 꼴: 실제 해석 경고(경고 되풀이 수·멈춤·1인칭이던 오프셋 경고)
    expect(translate('GOTO 10: N20 블록이 없음 — 멈춤', 'en')).toBe('GOTO 10: no N20 block — stopped');
    expect(translate('G55 오프셋 값을 몰라 G54와 같은 원점으로 그림', 'de')).toBe('G55-Versatzwert unbekannt — mit demselben Nullpunkt wie G54 gezeichnet');
    expect(translate('THEN 없음', 'zh-CN')).toBe('缺少 THEN');
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
      for (const text of [...texts, ...notices.map((n) => plainText(n.text)), ...ui]) expect(translate(text, code), `${code}: ${text}`).not.toMatch(/[가-힣]/);
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
  it('translates the view cube faces the core loads later (55th — viewcube left the first-screen graph) and restores them on dispose', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"></div></body></html>', {url:'https://gyutae-kim.github.io/opencad-nc/en/'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const { CUBE_FACES } = await import('opencad-viewer3d/viewcube');
    const ko = CUBE_FACES.map(face => face.label);
    dispose = await installLocalization(document.getElementById('app')!);
    // 코어를 받기 전(첫 화면)에는 큐브 글을 모른다 — 받으면(core.ts loadViewerCore) 지금 언어로, 같은 목록을 다시 받아도 원래 글에서 옮긴다
    expect(CUBE_FACES.map(face => face.label)).toEqual(ko);
    localizeCubeFaces(CUBE_FACES);
    localizeCubeFaces(CUBE_FACES);
    expect(CUBE_FACES.map(face => face.label)).toEqual(ko.map(label => translate(label,'en')));
    expect(CUBE_FACES.find(face => face.name === 'top')!.label).toBe('Top');
    dispose(); dispose = undefined;
    expect(CUBE_FACES.map(face => face.label)).toEqual(ko);
    dom.window.close();
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
