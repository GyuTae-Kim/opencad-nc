/**
 * 195차: 도구 막대 묶음(제목 막대 예제 열기·설정 메뉴, 보기 도구 막대 전체 보기·표준 뷰·투영·그리기·격자·단면, 시작 화면 키 안내 줄·최근 문서)의 네 언어 번역을
 * 같은 사전 안의 낱말과 대조했다. 한 기능의 버튼 보이는 글·풍선 글·이름·키 안내 줄·메뉴 항목은 보이는 글의 낱말을 쓴다(WCAG 2.5.3 음성 입력 — 183·184·194차 꼴).
 * 고친 것은 사전 값과 새 틀 하나(원문·코드 그대로):
 * 「전체 보기 (F)」 풍선 글·키 안내 줄(View all·全体表示·查看全部·Alle anzeigen → 보이는 글 Fit to view·全体を表示·适合窗口·Gesamtansicht),
 * 「표준 뷰」 풍선 글의 뷰 이름(일본어 等角·중국어 俯视图/底视图·독일어 Vorderansicht/Rückansicht/Isometrisch → 메뉴 항목 アイソメ·上/下·Vorne/Hinten/Isometrie)과 독일어 키 안내 Standardansicht,
 * 「그리기」 풍선 글의 모드 이름(메뉴 항목 글 — 음영 + 모서리·X-ray 등), 독일어 격자 풍선 글 Bodengitter → Bodenraster, 독일어 투영 풍선 글 Perspektivische Projektion → Perspektive,
 * 독일어 테마 메뉴 항목 Thema(주제) → Design, 단면 「자를 축」(Clipping·切り取る·裁剪 → cutting·切断·剖切)·독일어 뒤집기(Spiegelung·umkehren → Umdrehen),
 * 단면 값 글 「X = 5 mm (뒤집음)」 틀(맞는 틀이 없어 네 언어 모두 「(뒤집음)」이 한국어로 남았다), 영어 예제 풍선 글 example → sample, 최근 문서 「모두 지우기」 풍선 글(영어·중국어·독일어).
 */
import { describe, expect, it } from 'vitest';
import { catalogs, sourceMessage, translate } from '../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const dict = (lang: string): Record<string, string> => catalogs[lang] as Record<string, string>;
/** 품음(대소문자 무시 — 184·194차 꼴) */
const has = (whole: string, part: string): boolean => whole.toLowerCase().includes(part.toLowerCase());
/**
 * 시작 화면 키 안내 줄(app.ts 시작 화면 fine-only). 204차: 「Esc 고른 것 지우기」 뒤에 「Shift 측정 중 방향 잠금」을 더했다 — 마우스·가상 커서 어느 쪽에서도 지금 방향을 잠그는 키는 Shift 하나라
 * 한 줄 요약에 넣고(화살표·X·Y·Z·L은 가상 커서가 켜졌는지에 따라 갈려 그때 맞는 안내가 측정 띠·상태 막대에 뜬다), 낱말은 측정 띠 잠금 버튼 이름 「방향 잠금」(아래 묶음)
 */
const KEYS_LINE = '키: F 전체 보기 · 1~7 표준 뷰 · F7 격자 · Space 재생/멈춤 · Enter 가상 커서 · Esc 고른 것 지우기 · Shift 측정 중 방향 잠금 · Ctrl+O 열기';
const VIEWS_TIP = '표준 뷰 (1 앞 · 2 뒤 · 3 왼쪽 · 4 오른쪽 · 5 위 · 6 아래 · 7 등각)';
const RENDER_TIP = '그리기 모드: 음영 · 음영+모서리 · 와이어프레임 · X-ray';
const SECTION_TIP = '단면 보기: 자를 축(X·Y·Z)·위치·뒤집기';
const CLEAR_TIP = '최근 문서 목록을 모두 지웁니다(원래 파일은 그대로)';
/** 투영 버튼: 원근일 때·평행일 때 풍선 글, 처음 풍선 글, 원근일 때·평행일 때 이름 */
const PROJ = ['지금 원근 투영 — 누르면 평행 투영', '지금 평행 투영 — 누르면 원근 투영', '투영: 원근 ↔ 평행', '원근 투영(누르면 평행)', '평행 투영(누르면 원근)'];
/** 표준 뷰 메뉴 항목(코어 VIEW_KEYS·VIEW_LABELS — 1 앞 2 뒤 3 왼쪽 4 오른쪽 5 위 6 아래 7 남동 등각) */
const VIEW_ITEMS = ['앞', '뒤', '왼쪽', '오른쪽', '위', '아래', '남동 등각'];

describe('도구 막대 묶음 번역(195차)', () => {
  it('한 기능의 보이는 글·풍선 글·이름·키 안내 줄·메뉴 항목이 보이는 글의 낱말을 쓴다', () => {
    // [언어, 보이는 글(버튼·메뉴 항목 — 열쇠가 없는 X-ray는 원문 그대로 보임), 그 낱말을 품어야 할 열쇠]
    const groups: [langs: readonly string[], word: string, keys: string[]][] = [
      [LANGS, '전체 보기', ['전체 보기 (F)', KEYS_LINE]],
      [LANGS, '표준 뷰', [VIEWS_TIP, KEYS_LINE]],
      [LANGS, '격자', ['바닥 격자 (F7)', KEYS_LINE]],
      // 204차: 측정 띠 잠금 버튼 이름(「방향 잠금」)과 키 안내 줄의 Shift 항목
      [LANGS, '방향 잠금', [KEYS_LINE]],
      // 투영 버튼(보이는 글 원근·평행) — 누르면 바뀔 쪽 낱말도 같은 말
      [LANGS, '원근', PROJ],
      [LANGS, '평행', PROJ],
      // 그리기 버튼과 메뉴 항목 — 독일어 Zeichnen ↔ Zeichenmodi는 195차에 보고 둔 것
      [['en', 'ja', 'zh-CN'], '그리기', [RENDER_TIP]],
      ...['음영', '음영 + 모서리', '와이어프레임', 'X-ray'].map((item): [readonly string[], string, string[]] => [LANGS, item, [RENDER_TIP]]),
      // 단면 상자: 「자를 축」 묶음 이름과 「뒤집기」 버튼
      [LANGS, '자를 축', [SECTION_TIP]],
      [LANGS, '뒤집기', ['잘라 내는 쪽 뒤집기', SECTION_TIP]],
      // 설정 메뉴의 테마 항목(제목 막대 버튼은 처음부터 「설정」 — 같은 사전의 「테마」 낱말)
      [LANGS, '테마', ['테마 바꾸기', '밝은 / 어두운 테마로 바꾸기']],
      // 최근 문서 「모두 지우기」 — 독일어는 아래 고친 값 시험(Alle … entfernen — 한 항목 지우기와 같은 꼴)
      [['en', 'ja', 'zh-CN'], '모두 지우기', [CLEAR_TIP]],
    ];
    const misses: string[] = [];
    for (const [langs, word, keys] of groups)
      for (const lang of langs)
        for (const key of keys) {
          const w = translate(word, lang);
          const v = translate(key, lang);
          if (!has(v, w)) misses.push(`${lang}: ${word} ${w} ⊄ ${v}`);
        }
    // 표준 뷰 풍선 글의 「n 이름」은 메뉴 항목 글의 낱말(중국어 视图·图 꼬리는 뺌 — 前视图 ↔ 前, 等轴测图 ↔ 东南等轴测)
    for (const lang of LANGS) {
      const tip = translate(VIEWS_TIP, lang);
      const names = tip.slice(tip.search(/[(（]/) + 1).replace(/[)）]\s*$/, '').split(/\s+·\s+/).map((p) => p.replace(/^\d\s*/, ''));
      expect(names, `${lang}: ${tip}`).toHaveLength(7);
      names.forEach((name, i) => {
        const item = translate(VIEW_ITEMS[i]!, lang);
        if (!has(item, name.replace(/(?<=.)(?:视图|图)$/u, ''))) misses.push(`${lang}: ${i + 1} ${name} ⊄ ${item}`);
      });
    }
    expect(misses).toEqual([]);
  });

  it('고친 값은 같은 사전의 낱말이고, 거꾸로 찾으면 그 열쇠다(다른 열쇠와 같은 값이 아님)', () => {
    const want: Record<string, Record<string, string>> = {
      en: {
        '전체 보기 (F)': 'Fit to view (F)',
        // 204차: 키 안내 줄 통째(영어는 「키 - 기능」 꼴 — 「방향 잠금」 Direction lock, coarse 줄 「측정 중」 While measuring)
        [KEYS_LINE]: 'Keys: F - Fit to View · 1–7 - Standard Views · F7 - Grid · Space - Play/Pause · Enter - Virtual Cursor · Esc - Deselect · Shift - Direction Lock While Measuring · Ctrl+O - Open',
        [RENDER_TIP]: 'Drawing modes: Shaded · Shaded with edges · Wireframe · X-ray',
        '자를 축': 'Cutting axis',
        '(뒤집음)': '(flipped)',
        '{0} = {1} (뒤집음)': '{0} = {1} (flipped)',
        '합성 예제 G-code 열기': 'Open synthetic sample G-code',
        [CLEAR_TIP]: 'Clear all recent documents (your original files are not affected)',
      },
      ja: {
        '전체 보기 (F)': '全体を表示 (F)',
        // 204차: 「Shift 測定中の方向ロック」(「方向 잠금」 方向ロック, coarse 줄 「측정 중」 測定中)
        [KEYS_LINE]: 'キー: F 全体を表示 · 1～7 標準ビュー · F7 グリッド · Space 再生/一時停止 · Enter 仮想カーソル · Esc 選択解除 · Shift 測定中の方向ロック · Ctrl+O 開く',
        [VIEWS_TIP]: '標準ビュー（1 前 · 2 後 · 3 左 · 4 右 · 5 上 · 6 下 · 7 アイソメ）',
        [RENDER_TIP]: '描画モード：シェーディング · シェーディング + エッジ · ワイヤーフレーム · X-ray',
        '자를 축': '切断軸',
        '(뒤집음)': '(反転)',
        '{0} = {1} (뒤집음)': '{0} = {1} (反転)',
      },
      'zh-CN': {
        '전체 보기 (F)': '适合窗口 (F)',
        // 204차: 「Shift 测量时方向锁定」(「방향 잠금」 方向锁定, coarse 줄 「측정 중」 测量时)
        [KEYS_LINE]: '快捷键：F 适合窗口 · 1–7 标准视图 · F7 网格 · 空格键 播放/暂停 · Enter 虚拟光标 · Esc 清除所选 · Shift 测量时方向锁定 · Ctrl+O 打开',
        [VIEWS_TIP]: '标准视图（1 前视图 · 2 后视图 · 3 左视图 · 4 右视图 · 5 上视图 · 6 下视图 · 7 等轴测图）',
        [RENDER_TIP]: '绘图模式：着色 · 着色 + 边缘 · 线框 · X-ray',
        '자를 축': '剖切轴',
        [SECTION_TIP]: '剖面视图：剖切轴 (X·Y·Z)·位置·翻转',
        '(뒤집음)': '（翻转）',
        '{0} = {1} (뒤집음)': '{0} = {1}（翻转）',
        [CLEAR_TIP]: '全部清除最近的文档（原始文件不受影响）',
      },
      de: {
        '전체 보기 (F)': 'Gesamtansicht (F)',
        // 204차: 「Shift Richtungssperre beim Messen」(「방향 잠금」 Richtungssperre, coarse 줄 「측정 중」 Beim Messen, 잠금 안내 「Shift sperrt …」도 Shift)
        // 217차: 「Enter virtueller Cursor」 → 「Enter Virtueller Cursor」(키 줄 항목의 기능 글은 홀로 쓰는 값 그대로 — 단축키 창 묶음 제목 「가상 커서」 Virtueller Cursor, 나머지 일곱 항목과 같은 꼴 — tests/i18n.test.ts 217차)
        [KEYS_LINE]: 'Tasten: F Gesamtansicht · 1–7 Standardansichten · F7 Raster · Leertaste Wiedergabe/Pause · Enter Virtueller Cursor · Esc Auswahl löschen · Shift Richtungssperre beim Messen · Strg+O Öffnen',
        [VIEWS_TIP]: 'Standardansichten (1 Vorne · 2 Hinten · 3 Links · 4 Rechts · 5 Oben · 6 Unten · 7 Isometrie)',
        [RENDER_TIP]: 'Zeichenmodi: Schattierung · Schattierung + Kanten · Drahtgittermodell · X-ray',
        '바닥 격자 (F7)': 'Bodenraster (F7)',
        [PROJ[0]!]: 'Jetzt Perspektive – Drücken für Parallelprojektion',
        [PROJ[1]!]: 'Jetzt Parallelprojektion – Drücken für Perspektive',
        '밝은 / 어두운 테마로 바꾸기': 'Wechseln Sie zum Hell-/Dunkel-Design',
        '잘라 내는 쪽 뒤집기': 'Schnittseite umdrehen',
        [SECTION_TIP]: 'Schnittansicht: Schnittachse (X·Y·Z)·Position·Umdrehen',
        '(뒤집음)': '(umgedreht)',
        '{0} = {1} (뒤집음)': '{0} = {1} (umgedreht)',
        [CLEAR_TIP]: 'Alle aus „Zuletzt geöffnet“ entfernen (die Originaldateien bleiben unverändert)',
      },
    };
    for (const [lang, values] of Object.entries(want))
      for (const [key, value] of Object.entries(values)) {
        expect(dict(lang)[key], `${lang}: ${key}`).toBe(value);
        expect(sourceMessage(value), `${lang}: ${value}`).toBe(key);
      }
    // 근거: 독일어 「모두 지우기」 Alle entfernen과 한 항목 지우기 「{0} aus „Zuletzt geöffnet“ entfernen」 꼴, 같은 사전의 테마 Design
    expect(dict('de')['모두 지우기']).toBe('Alle entfernen');
    expect(dict('de')[CLEAR_TIP]).toBe(dict('de')['최근 문서에서 {0} 지우기']!.replace('{0}', 'Alle') + ' (die Originaldateien bleiben unverändert)');
    expect([dict('de')['테마'], dict('de')['테마 바꾸기']]).toEqual(['Design', 'Design ändern']);
  });

  it('단면 값 글은 뒤집었을 때도 화면 언어로 옮긴다(「(뒤집음)」이 한국어로 남지 않음)', () => {
    expect(LANGS.map((lang) => translate('X = 5 mm (뒤집음)', lang))).toEqual(['X = 5 mm (flipped)', 'X = 5 mm (反転)', 'X = 5 mm（翻转）', 'X = 5 mm (umgedreht)']);
    for (const lang of LANGS) {
      expect(translate('Z = 0.25 in (뒤집음)', lang), lang).not.toMatch(/[가-힣]/);
      // 뒤집은 값 글의 낱말은 「뒤집기」 버튼 낱말(독일어는 같은 동사 umdrehen의 과거분사 umgedreht)
      const flip = translate('뒤집기', lang).toLowerCase();
      expect(translate('X = 5 mm (뒤집음)', lang).toLowerCase(), lang).toContain(lang === 'de' ? 'umgedreht' : flip);
      // 뒤집지 않은 값 글은 그대로
      expect(translate('X = 5 mm', lang), lang).toBe('X = 5 mm');
    }
  });
});
