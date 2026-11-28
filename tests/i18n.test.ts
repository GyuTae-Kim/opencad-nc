import { metadataForLanguage } from '../site/i18n.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { installLocalization, localizeCubeFaces, uiText } from '../src/app/i18n';
import { catalogs, currentLanguage, languageUrl, languages, sourceMessage, translate } from '../site/i18n.mjs';
import { NC_DIALECT_NAMES } from '../src/model';
import { parseGcode } from '../src/gcode';
// 216차: 판단 띠 글은 문서가 있을 때만 써 doc.ts(첫 화면)에서 코어와 함께 받는 notices.ts로 옮겼다
import { noticeViews } from '../src/app/notices';
import { fileText, mix, plainText, type Mixed } from '../src/app/filetext';
import { BINARY_MESSAGE } from '../src/app/format';
import { errorText } from '../src/app/protocol';
import { measureFailText } from '../src/app/core';

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
  it('keeps every catalog key a Korean text or a {n} template — no bare symbol key besides the sharing image URL (202nd)', () => {
    // 202차(ci-guard 9번): 201차가 더한 열쇠 ':'(중국어 「：」)는 translate가 앞뒤 빈칸을 뺀 열쇠로 찾아 값만 돌려줘, 조각을 이어 옮기는 길(mixNodes·uiText·조각마다 옮기기)에서
    // 영어 「: 」가 「:」로 빈칸을 잃었다(mobile.test 31차 「sub.h:No tool …」 — PR CI 실패). 기호 하나를 언어마다 다르게 하려면 그 기호가 든 통째 원문·틀 열쇠로
    const image = metadataForLanguage('ko').image.url;
    for (const {code} of languages.filter(item => item.code !== 'ko')) {
      expect(Object.keys(catalogs[code]).filter(key => !/[가-힣]/.test(key) && !/\{\d+\}/.test(key)), code).toEqual([image]);
      for (const piece of [': ', ' (', ')']) expect(translate(piece, code), `${code}: ${piece}`).toBe(piece);
    }
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
  it('shows the core error reason inside app error messages in the screen language: PNG save failure and 3D view creation (107th)', async () => {
    // 3D 뷰어 코어(0.114.0)가 앱에 던지는 한국어 Error 글: 문맥을 잃은 동안 toBlob, 캔버스 toBlob이 null, WebGL2 없음(뷰어를 만들 때)
    const core = ['3D 보기 문맥이 없어 그림을 만들 수 없습니다', '그림을 만들지 못했습니다', '이 브라우저는 WebGL2를 지원하지 않아 3D 보기를 열 수 없습니다'];
    const shown = [`그림을 저장하지 못했습니다: ${core[0]}`, `그림을 저장하지 못했습니다: ${core[1]}`, `3D 보기를 만들지 못했습니다: ${core[2]}`];
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      for (const text of core) expect(catalogs[code]?.[text], `${code}: ${text}`).toBeTruthy();
      // 화면 번역층(잡은 값 그대로)은 까닭을 한국어로 남긴다 — 앱은 uiText로 잡은 값까지 옮긴다
      expect(translate(shown[0]!, code), code).toMatch(/[가-힣]/);
      for (const text of shown) expect(translate(text, code, true), `${code}: ${text}`).not.toMatch(/[가-힣]/);
    }
    expect(translate(shown[0]!, 'en', true)).toBe('Failed to save picture: Cannot create the picture because the 3D view has no graphics context');
    // PNG 저장(savePng): 문맥을 잃은 동안 코어 toBlob이 거절하면 알림이 그 언어 글만
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header></div></body></html>', {url:'https://gyutae-kim.github.io/opencad-nc/de/'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const { NcViewerApp } = await import('../src/app/app');
    dispose = await installLocalization(document.getElementById('app')!);
    expect(uiText(shown[2]!)).toBe(translate(shown[2]!, 'de', true));
    const savePng = (NcViewerApp.prototype as unknown as { savePng(): Promise<void> }).savePng;
    await savePng.call({ viewer: { toBlob: () => Promise.reject(new Error(core[0])) }, doc: { name: 'a.nc' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.querySelector('.toast.error')!.firstChild!.textContent).toBe('Bild konnte nicht gespeichert werden: Bild kann nicht erstellt werden, weil die 3D-Ansicht keinen Grafikkontext hat');
    dispose(); dispose = undefined;
    // 한국어 화면(닫은 뒤)은 그대로
    expect(uiText(shown[0]!)).toBe(shown[0]);
    dom.window.close();
  });
  it('shows the app reason inside the measure, simulation load and simulation compute messages in the screen language, but leaves file names alone (108th)', async () => {
    // 앱이 지은 틀에 끼우는 앱 글: errorText가 네트워크 오류를 바꾼 글(측정 도구·시뮬레이션 조각을 받지 못함 — Safari "Load failed"), 계산 워커가 멈춘 글
    const network = errorText(new TypeError('Load failed'));
    const worker = '워커가 멈췄습니다(메모리가 모자랄 수 있습니다)';
    expect(network).toBe('파일을 받지 못했습니다(네트워크 오류).');
    const shown = [`측정 도구를 열 수 없습니다: ${network}`, `시뮬레이션을 불러오지 못했습니다: ${network}`, `시뮬레이션을 계산하지 못했습니다: ${worker}`];
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      for (const text of [network, worker]) expect(catalogs[code]?.[text], `${code}: ${text}`).toBeTruthy();
      for (const text of shown) {
        // 화면 번역층(잡은 값 그대로)은 까닭을 한국어로 남긴다 — 앱은 uiText로 잡은 값까지 옮긴다
        expect(translate(text, code), `${code}: ${text}`).toMatch(/[가-힣]/);
        expect(translate(text, code, true), `${code}: ${text}`).not.toMatch(/[가-힣]/);
      }
    }
    expect(translate(shown[1]!, 'en', true)).toBe('Could not load the simulation: Failed to receive the file (network error).');
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header><p class="start-error" hidden></p></div></body></html>', {url:'https://gyutae-kim.github.io/opencad-nc/de/'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const [{ NcViewerApp }, { SimView }] = await Promise.all([import('../src/app/app'), import('../src/app/sim')]);
    dispose = await installLocalization(document.getElementById('app')!);
    expect(uiText(shown[0]!)).toBe('Messwerkzeuge können nicht geöffnet werden: Datei konnte nicht empfangen werden (Netzwerkfehler).');
    // 깎기 탭 상태 줄(sim.ts): 계산 워커가 멈추면 원문은 그대로 두고 그릴 때 까닭까지 독일어로
    const sim = SimView.prototype as unknown as { fail(message: string): void; statusText(): string };
    const state = { on: true, error: null as string | null, stop: () => undefined, showError: () => undefined, host: { refreshPanel: () => undefined } };
    sim.fail.call(state, worker);
    expect(state.error).toBe(shown[2]);
    expect(sim.statusText.call(state)).toBe('Simulation konnte nicht berechnet werden: Worker beendet (möglicherweise nicht genügend Arbeitsspeicher)');
    // 파일 이름이 끼는 열기 오류(mix로 섞어 showError)는 감싸지 않는다: 사전 낱말과 같은 파일 이름("열기")도 그대로, 앱 글만 독일어
    const proto = NcViewerApp.prototype as unknown as { showError(msg: Mixed): void; errorNodes(): (string | Node)[] };
    const startError = document.querySelector<HTMLElement>('.start-error')!;
    proto.showError.call({ doc: null, startError, errorNodes: proto.errorNodes }, mix`${fileText('열기')}: ${BINARY_MESSAGE}`);
    expect(startError.hidden).toBe(false);
    expect(startError.textContent).toBe(catalogs.de![`{0}: ${BINARY_MESSAGE}`]!.replace('{0}', '열기'));
    // uiText로 감쌌다면 파일 이름까지 사전에서 옮겼다
    expect(uiText(`열기: ${BINARY_MESSAGE}`)).toMatch(/^Öffnen: /);
    dispose(); dispose = undefined;
    expect(sim.statusText.call(state)).toBe(shown[2]);
    dom.window.close();
  });
  it('reads the opening stage of the busy card differently from the Open command in every language (166th — WCAG 3.2.4·2.4.6)', async () => {
    // 읽는 동안 덮개 단계 칸(app.ts busyStage — role=status, 첫 글 「여는 중…」 한 마디, setBusy는 단계 글과 「…」 두 마디)과 제목 막대 「열기」 버튼(보이는 글·aria-label):
    // 다른 일(진행 상태·파일 고르기 명령)인데 독일어만 둘 다 「Öffnen」이라 화면 읽기가 상태를 명령 이름으로 읽었다
    const stages = ['여는 중', '여는 중…', '다시 읽는 중', '파일 받는 중', '최근 문서 읽는 중'];
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      const open = translate('열기', code);
      for (const stage of stages) expect(translate(stage, code), `${code}: ${stage}`).not.toBe(open);
      expect(translate('여는 중…', code), code).not.toBe(`${open}…`);
      expect(translate('여는 중…', code), code).toBe(`${translate('여는 중', code)}…`);
    }
    // 독일어는 같은 사전의 진행 꼴(「다시 읽는 중」 Wird neu gelesen·「불러오는 중…」 Wird geladen…)과 「geöffnet」(「최근 문서」 Zuletzt geöffnet)으로, 명령 「열기」는 그대로
    expect([translate('다시 읽는 중', 'de'), translate('불러오는 중…', 'de'), translate('최근 문서', 'de')]).toEqual(['Wird neu gelesen', 'Wird geladen…', 'Zuletzt geöffnet']);
    expect([translate('여는 중', 'de'), translate('여는 중…', 'de'), translate('열기', 'de')]).toEqual(['Wird geöffnet', 'Wird geöffnet…', 'Öffnen']);
    // 옮긴 글을 원문으로 되찾을 때(번역층 sourceMessage — 같은 값이면 열쇠 하나로만 돌아갔다)도 갈린다
    expect([sourceMessage(translate('여는 중', 'de')), sourceMessage(translate('열기', 'de'))]).toEqual(['여는 중', '열기']);
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"><button class="tbtn primary" type="button" title="파일 열기 (Ctrl+O)" aria-label="열기"><span class="lbl">열기</span></button></header><div class="busy-stage" role="status" aria-live="polite">여는 중…</div></div></body></html>', {url:'https://gyutae-kim.github.io/opencad-nc/de/'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    dispose = await installLocalization(document.getElementById('app')!);
    const button = document.querySelector<HTMLButtonElement>('button.tbtn')!;
    const stage = document.querySelector<HTMLElement>('.busy-stage')!;
    expect([button.textContent, button.getAttribute('aria-label')]).toEqual(['Öffnen', 'Öffnen']);
    expect(stage.textContent).toBe('Wird geöffnet…');
    stage.replaceChildren(document.createTextNode('여는 중'), document.createTextNode('…'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stage.textContent).toBe('Wird geöffnet…');
    dispose(); dispose = undefined;
    dom.window.close();
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

/**
 * 217차: 203~216차에 더한 열쇠(가상 커서 X·Y·Z·L 잠금과 안내·키보드 단축키 창·키 줄·「{0}을(를) 불러오지 못했습니다.」·「다시 시도」 — `git diff 1b319e5 origin/main -- site/locales/`의 25열쇠와
 * 「새로 고침」)를 네 언어마다 같은 사전의 다수 꼴과 견줘(README 개발 217차 문단) 갈린 값 여섯을 고쳤다(원문·코드 그대로). 같은 꼴이 다시 갈리지 않게 사전 전체에서 센다.
 */
describe('203~216차 원문의 네 언어 꼴(217차)', () => {
  const dict = (code: string): Record<string, string> => catalogs[code] as Record<string, string>;
  const KEYS_LINE = Object.keys(dict('en')).find((k) => k.startsWith('키: F 전체 보기 · '))!;
  const KEY_HELP = Object.keys(dict('en')).find((k) => k.startsWith('Enter로 가상 커서를 켭니다.'))!;
  it('일본어는 키 이름 뒤 「で」를 띄우고(「Shift で」 꼴), 원문 낱말 사이 「·」는 일본어 「・」·영어 붙인 「/」', () => {
    // 일본어 키 이름 + で: 띄움 35 : 붙임 7 — 붙임 가운데 키 이름은 3D 보기 설명(KEY_HELP 「Enterで…Tabで…X・Y・Zで…、Lで」) 하나였다(같은 문장의 잠금 안내는 「X・Y・Z で軸方向に、L で現在の方向にロック」)
    for (const [key, value] of Object.entries(dict('ja'))) expect(value, key).not.toMatch(/(?:Enter|Tab|Esc|Shift|Space)で|[A-Z]・[A-Z](?:・[A-Z])*で|、[A-Z]で/);
    // 원문 한글 사이 「·」(「다음·이전」 꼴): 일본어 「・」 66 : 「/」 2(「次/前の移動」 하나 — 다른 하나는 원문이 G7/G8), 영어 「낱말/낱말」 붙임 27 : 띄움 2(「Next / previous move」 하나)
    const dotted = Object.keys(dict('en')).filter((k) => /[가-힣]·[가-힣]/.test(k));
    expect(dotted.length).toBeGreaterThan(80);
    for (const key of dotted) {
      expect(dict('ja')[key], key).not.toMatch(/[぀-ヿ一-鿿]\/[぀-ヿ一-鿿]/);
      expect(dict('en')[key], key).not.toMatch(/[a-z] \/ [a-z]/i);
    }
  });
  it('중국어 키 글 괄호는 반각 + 빈칸(「适合窗口 (F)」 꼴)이고, 키 줄 항목의 기능 글은 그 원문을 홀로 옮긴 값', () => {
    // 키 글만 든 괄호: 「适合窗口 (F)」·「地板网格 (F7)」·「打开文件 (Ctrl+O)」·「停止读取 (Esc)」 — 전각은 「在 3D 视图外…（F · 1–7 · ?）」 하나였다
    const KEY = String.raw`(?:F\d*|\d–\d|\?|Esc|Enter|Tab|Shift|Ctrl\+\w+)`;
    const fullKeys = new RegExp(`（${KEY}(?: · ${KEY})*）`);
    for (const [key, value] of Object.entries(dict('zh-CN'))) expect(value, key).not.toMatch(fullKeys);
    // 키 줄(시작 화면): 「키 + 기능」마다 기능은 그 원문을 홀로 옮긴 값 그대로(독일어 「Enter virtueller Cursor」만 단축키 창 묶음 제목 Virtueller Cursor와 갈렸다 —
    // 나머지 일곱은 Gesamtansicht·…·Öffnen). 영어는 줄 전체가 제목 꼴(Fit to View)이라 대소문자만 무시한다
    const items = KEYS_LINE.split(' · ').map((p) => p.replace(/^(?:키: )?\S+ /, ''));
    expect(items).toEqual(['전체 보기', '표준 뷰', '격자', '재생/멈춤', '가상 커서', '고른 것 지우기', '측정 중 방향 잠금', '열기']);
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      const line = dict(code)[KEYS_LINE]!.split(' · ');
      expect(line, code).toHaveLength(items.length);
      items.forEach((ko, i) => {
        const fold = (s: string): string => (code === 'en' ? s.toLowerCase() : s);
        expect(fold(line[i]!).endsWith(` ${fold(dict(code)[ko]!)}`), `${code}: ${line[i]} ← ${ko}`).toBe(true);
      });
    }
  });
  it('고친 값 여섯은 그 값 그대로이고 거꾸로 찾으면 그 열쇠(다른 열쇠와 같은 값이 아님)', () => {
    // 중국어 「单击 3D 视图后」: 라틴 글자·한자 사이 띄움 363 : 붙임 31, 문장 안 「3D 视图」 5 : 「3D视图」 2 — 사전 전체 규칙은 열쇠 밖 「已由3D视图省略」·이름 「3D视图」에 걸려 값만 고정한다
    // (218차: 그 둘·경고 칩 값도 띄워 사전 전체 규칙을 아래 218차 시험에 둠)
    const want: [code: string, key: string, value: string][] = [
      ['ja', KEY_HELP, 'Enter で仮想カーソルをオンにします。矢印キーで移動、Tab で重なった候補を切り替え、Enter で選ぶか点を打ち、Esc でオフにします。測定の1点目の後は X・Y・Z で軸方向に、L で現在の方向にロックします（もう一度押すと解除）。測定中はマウスポインターの位置で重なった候補も Tab・Shift+Tab で切り替え、Esc で切り替えを解除します'],
      ['en', '다음·이전 이동(10개씩)', 'Next/previous move (10 at a time)'],
      ['ja', '다음·이전 이동(10개씩)', '次・前の移動（10個ずつ）'],
      ['zh-CN', '3D 보기 밖에서도 한 글자 단축키(F·1~7·?)', '在 3D 视图外也使用单字符快捷键 (F · 1–7 · ?)'],
      ['zh-CN', '가상 커서 키는 3D 보기를 누른 뒤 씁니다.', '单击 3D 视图后即可使用虚拟光标键。'],
      ['de', KEYS_LINE, 'Tasten: F Gesamtansicht · 1–7 Standardansichten · F7 Raster · Leertaste Wiedergabe/Pause · Enter Virtueller Cursor · Esc Auswahl löschen · Shift Richtungssperre beim Messen · Strg+O Öffnen'],
    ];
    for (const [code, key, value] of want) {
      expect(dict(code)[key], `${code}: ${key}`).toBe(value);
      expect(sourceMessage(value), `${code}: ${value}`).toBe(key);
    }
    // 같은 문장의 잠금 안내(CURSOR_LOCK_HINT)와 3D 보기 설명의 X·Y·Z·L 글이 한 꼴
    expect(dict('ja')[KEY_HELP]).toContain(dict('ja')['X·Y·Z로 축 방향, L로 지금 방향 잠금']!);
  });
});

/**
 * 218차: 217차가 보고 둔 사전 갈림 넷(README 남은 일 217차 줄)을 같은 사전의 다수 꼴로 맞췄다(원문·코드 그대로, 새 열쇠 0 — README 개발 218차 문단).
 */
describe('217차가 남긴 사전 갈림(218차)', () => {
  const dict = (code: string): Record<string, string> => catalogs[code] as Record<string, string>;
  it('일본어 「새로 고침」(쪽을 새로 받음)은 「다시 읽음」(파일을 다시 해석)과 다른 값이고, 네 언어 모두 거꾸로 찾으면 그 열쇠', () => {
    // 再読み込み 든 값 일곱: 파일을 다시 해석하는 다섯(다시 읽음·다시 읽는 중·{0}: 다시 읽었습니다.·{0}: 다시 읽지 못했습니다 — {1}·바꾸면 파일을 다시 읽습니다.)과
    // 쪽을 새로 받는 둘(새로 고침·…새로 고친 뒤…) — 버튼 「새로 고침」은 같은 사전 「Webページ」의 낱말 + 버튼 「を + 명사」 꼴(짧은 값 29 : 동사 끝 10 — 方向ロックを解除·言語を選択)로 가른다
    expect([dict('ja')['새로 고침'], dict('ja')['다시 읽음']]).toEqual(['ページを再読み込み', '再読み込み']);
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      expect(dict(code)['새로 고침'], code).not.toBe(dict(code)['다시 읽음']);
      expect([sourceMessage(dict(code)['새로 고침']!), sourceMessage(dict(code)['다시 읽음']!)], code).toEqual(['새로 고침', '다시 읽음']);
    }
  });
  it('중국어 「3D 보기」는 라틴 글자·한자 사이를 띄운 「3D 视图」 — 이름과 그 이름을 품은 값, 이름이 끼는 틀까지', () => {
    // 라틴 글자·한자 사이 띄움 363 : 붙임 31(217차 셈), 「3D 视图」 6 : 「3D视图」 4(이름·경고 칩 둘·해석 판단 글 — 이번에 맞춤)
    expect(dict('zh-CN')['3D 보기']).toBe('3D 视图');
    for (const [key, value] of Object.entries(dict('zh-CN'))) expect(value, key).not.toMatch(/3D视图/);
    // 열 때 받는 조각을 받지 못한 글(211차 틀 — 앱은 mixSpan ui로 이름도 옮긴다)
    expect(translate('3D 보기을(를) 불러오지 못했습니다.', 'zh-CN', true)).toBe('无法加载“3D 视图”。');
  });
  it('중국어 키 이름 괄호(空格键도)는 반각 + 빈칸, 영어 단축키 창 묶음 제목은 첫 낱말만 대문자', () => {
    // 키 글만 든 괄호: 반각 + 빈칸 5(「适合窗口 (F)」·「打开文件 (Ctrl+O)」 등) : 전각 2(재생 버튼 풍선 글의 「（空格键）」 둘 — 이번에 맞춤, 217차 시험의 키 목록에 空格键을 더함)
    const KEY = String.raw`(?:F\d*|\d–\d|\?|Esc|Enter|Tab|Shift|Ctrl\+\w+|空格键)`;
    const fullKeys = new RegExp(`（${KEY}(?: · ${KEY})*）`);
    for (const [key, value] of Object.entries(dict('zh-CN'))) expect(value, key).not.toMatch(fullKeys);
    expect([dict('zh-CN')['재생 / 멈춤 (Space)'], dict('zh-CN')['공구 경로 재생 / 멈춤 (Space)']]).toEqual(['播放/暂停 (空格键)', '播放刀具路径/暂停 (空格键)']);
    // 단축키 창 묶음 제목(src/app/shortcuts.ts SHORTCUTS — 창 글 전체는 tests/app/shortcuts.test.ts가 본다): Play·Code·Measure·Virtual cursor·Others처럼 View tools
    // (짧은 값 두세 낱말에서 첫 낱말만 대문자 154 : 모든 낱말 대문자 19 — 고유 이름 Heidenhain Klartext 등 포함)
    for (const title of ['보기 도구', '재생', '코드', '측정', '가상 커서', '기타']) expect(dict('en')[title], title).toMatch(/^[A-Z][^A-Z]*$/);
  });
});

/**
 * 219차: 218차가 남긴 일본어 문장 「…새로 고친 뒤…」(측정 도구를 받지 못함 — 앱 새 버전) — 버튼 「새로 고침」만 ページを再読み込み로 갈라(218차) 문장은 再読み込みしてから(파일 다시 읽기와 같은 낱말)였다.
 * 문장이 가리키는 것은 페이지 새로 고침(en reload the page · zh 刷新页面 · de Laden Sie die Seite neu — 셋 모두 쪽)이라 버튼 값을 그대로 품는 꼴로(한 기능 한 낱말 — WCAG 3.2.4, 원문·새 열쇠 0)
 */
describe('218차가 남긴 일본어 「…새로 고친 뒤…」(219차)', () => {
  const dict = (code: string): Record<string, string> => catalogs[code] as Record<string, string>;
  it('측정 도구를 받지 못한 문장의 새로 고침은 버튼 「새로 고침」 값을 품고(ページを再読み込みしてから), 거꾸로 찾으면 그 열쇠', () => {
    const key = measureFailText(true);
    const ja = dict('ja')[key]!;
    expect(ja).toContain(`${dict('ja')['새로 고침']}してから`);
    expect(ja).toBe('測定ツールを読み込めませんでした。アプリの新しいバージョンが公開された可能性があります。ページを再読み込みしてから、最近のドキュメントでファイルを開き直してください。');
    expect(sourceMessage(ja)).toBe(key);
    // 再読み込み 든 일본어 값: 쪽을 새로 받는 둘은 「ページを再読み込み」를 품고, 파일을 다시 해석하는 다섯은 품지 않는다(218차 갈림을 문장까지)
    const page = ['새로 고침', key];
    for (const [k, v] of Object.entries(dict('ja')).filter(([, v]) => v.includes('再読み込み'))) expect(v.includes('ページを再読み込み'), k).toBe(page.includes(k));
    expect(Object.values(dict('ja')).filter((v) => v.includes('再読み込み'))).toHaveLength(7);
  });
});

/**
 * 220차: 219차 표가 고르지 않고 둔 중국어 쌍점·한자가 든 풀이 괄호 — 사전 전체를 묶음(화면 자리)마다 세어(.runtime 셈 — README 개발 220차 문단), 묶음 다수가 3분의 2 이상이고
 * 사전 전체 다수(「：」 312 : 반각 53 · 전각 괄호 209 : 반각 91)와 같은 꼴이면 적은 꼴을 바꿨다(원문·코드 그대로, 새 열쇠 0). 키 글·코드·셈식 괄호는 그대로(217·218차).
 */
describe('219차가 고르지 않은 중국어 쌍점·풀이 괄호(220차)', () => {
  const zh = catalogs['zh-CN'] as Record<string, string>;
  const HALF = /\([^()]*\p{Script=Han}[^()]*\)/u;
  it('반각 쌍점은 코드 셋뿐(인라인 스크립트의 CSS 「prefers-color-scheme: dark」·og 그림 주소·찾기 칸의 줄 번호 「:120」) — 해석 경고(「：」 244 : 반각 46)·정보 탭·깎기 탭·알림 글 모두 「：」', () => {
    const code = Object.keys(zh).filter((k) => /^\/\/ |^https:\/\/|:120\(/.test(k));
    expect(code).toHaveLength(3);
    expect(Object.keys(zh).filter((k) => zh[k]!.includes(':')).sort()).toEqual(code.sort());
    // 해석 경고 줄 앞머리 틀(model.ts 「N번 줄: …」)과 WangShi 해석기 「{0}: …」(같은 묶음 「{0}：…」 74 : 「{0}: …」 25였다)
    expect([zh['{0}번 줄: {1}'], zh['{0}번 줄:'], zh['{0}: 뿌리 요소 뒤의 글은 읽지 않음']]).toEqual(['第 {0} 行：{1}', '第 {0} 行：', '{0}：不读取根元素之后的文本']);
    expect(translate('<panel>: 해석하지 못해 목록에만 넣음', 'zh-CN')).toBe('<panel>：无法解析，仅列入列表');
  });
  it('해석 경고(전각 115 : 반각 28)·알림 오류 글(4 : 1)의 한자 풀이 괄호는 전각(같은 값 안 코드 괄호도) — 「(알람 N)」 조각은 모두 「（报警 N）— 」, 둔 묶음의 반각 값은 62 그대로', () => {
    const alarm = Object.entries(zh).filter(([k]) => k.includes('(알람 '));
    expect(alarm).toHaveLength(15);
    for (const [k, v] of alarm) {
      expect(v, k).toMatch(/（报警 [^）]+）/);
      expect(v, k).not.toMatch(/\(报警|） —/);
    }
    expect(zh['CYCLE95: 가공 종류(VARI = {0})가 맞지 않음(알람 61002) — 그리지 않음']).toBe('CYCLE95：加工类型（VARI = {0}）无效（报警 61002）— 不绘制');
    expect(zh[errorText(new TypeError('Failed to fetch'))]).toBe('无法接收文件（网络错误）。');
    expect(zh['소수점 없는 큰 좌표가 많음({0}개) — Fanuc 최소 입력 단위(0.001)로 쓴 프로그램이면 "소수점 없는 값 = 최소 단위"를 켜십시오']).toBe('没有小数点的大坐标很多（{0} 个）— 如果程序使用 Fanuc 最小输入单位（0.001），请打开“无小数点的值 = 最小单位”');
    // 둔 묶음의 반각(한자 든 풀이 괄호): 깎기 탭 29(반각이 묶음 다수 — 사전 다수와 갈림)·정보 탭 14(16 : 14 반반)·판단 띠 5(5 : 3)·상태 줄 4·재생·따라가기 띠 4(섞임 없음)·
    // 키 글 4(「(空格键)」·「(→, Shift+→ 10개)」)·「(추정)」 짝 1(3D 보기 묶음 이름 — 상태 줄 둘과 같은 조각, 126차)·셈식 1(G76 「(深度 − K)」) — 새 값은 전각으로(늘면 실패)
    expect(Object.values(zh).filter((v) => HALF.test(v))).toHaveLength(62);
    expect(zh['기계 원점 쪽 이동(추정)']).toBe('机床原点方向移动(估计)');
  });
});
