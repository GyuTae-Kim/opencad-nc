// @vitest-environment jsdom
/**
 * 56차 키보드 붙잡기 알림 글(keysnap.ts — 코어 0.47.0 setKeyboardSnap messages)의 순수 부분(고르기 묶음 단위 Tab은 58차부터 코어 pickCycle group — keysnap-core.test.ts).
 * - 알림 틀은 코어 기본 한국어 틀을 네 언어 사전 열쇠로 쓴다(한글이 있는 것). 짧은 틀도 사전 열쇠라 화면 번역층(site-kit translate)이 모든 열쇠를
 *   {0} 틀로 맞춰 보는데, 그 틀이 다른 글을 바꾸지 않아야 한다: 앱 소스의 한글 글·사전 열쇠(값을 채운 꼴)를 알림 열쇠를 뺀 사전과 넣은 사전으로 옮겨 같은지 본다.
 *   '{0}축'(axisKind)은 '축'으로 끝나는 모든 글의 틀이 되어 다른 글을 반만 옮겼다('끌어온 축' → '끌어온  axis') — 그래서 'X축'·'Y축'·'Z축' 열쇠에서 틀을 만든다
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KEY_SNAP_MESSAGES, candidateText, formatKeySnapMessage, keySnapHint, keySnapMessages, KEY_SNAP_KEYS, type KeySnapMessageKey } from 'opencad-viewer3d';
import { catalogs, registerCatalog, translate } from '../../site/i18n.mjs';
import { AXIS_KEYS, KEY_HELP, KEY_SNAP_DICT_KEYS, keySnapTemplates } from '../../src/app/keysnap';

const ROOT = resolve(__dirname, '../..');
const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
const HANGUL = /[가-힣]/;
const slots = (s: string): string[] => (s.match(/\{\d+\}/g) ?? []).sort();
/** 이 차수가 사전에 더한 열쇠(알림 틀·축 이름·캔버스 설명) */
const ADDED = new Set<string>([...KEY_SNAP_DICT_KEYS.map((k) => KEY_SNAP_MESSAGES[k]), ...AXIS_KEYS, KEY_HELP]);

const saved = Object.fromEntries(LANGS.map((l) => [l, catalogs[l]]));
afterEach(() => {
  for (const l of LANGS) registerCatalog(l, saved[l]);
});

describe('키보드 붙잡기 알림 틀(56차)', () => {
  it('한글이 있는 코어 틀은 모두 사전 열쇠(axisKind는 축 열쇠 셋, 고르기 종류 pick.*는 앱 묶음 이름)이고 네 언어에 같은 자리로 있다', () => {
    const hangul = (Object.keys(KEY_SNAP_MESSAGES) as KeySnapMessageKey[]).filter((k) => HANGUL.test(KEY_SNAP_MESSAGES[k]));
    const left = hangul.filter((k) => !(KEY_SNAP_DICT_KEYS as readonly string[]).includes(k));
    expect(left.sort()).toEqual(['axisKind', 'pick.edge', 'pick.line', 'pick.mesh', 'pick.point', 'pick.section']);
    for (const k of KEY_SNAP_DICT_KEYS) expect(HANGUL.test(KEY_SNAP_MESSAGES[k]), k).toBe(true);
    for (const l of LANGS)
      for (const key of ADDED) {
        const v = catalogs[l][key];
        expect(v, `${l}: ${key}`).toBeTruthy();
        expect(slots(v!), `${l}: ${key}`).toEqual(slots(key));
        expect(HANGUL.test(v!), `${l}: ${key}`).toBe(false);
      }
  });

  it('지금 언어의 틀: 한국어는 코어 기본과 같고, 다른 언어는 자리가 같고 한글이 없으며 축 틀은 X·Y·Z 열쇠와 맞는다', () => {
    const ko = keySnapTemplates(KEY_SNAP_MESSAGES, (s) => translate(s, 'ko'));
    for (const [k, v] of Object.entries(ko)) expect(v, k).toBe(KEY_SNAP_MESSAGES[k as KeySnapMessageKey]);
    expect(ko.axisKind).toBe('{0}축');
    for (const l of LANGS) {
      const t = keySnapTemplates(KEY_SNAP_MESSAGES, (s) => translate(s, l));
      expect(Object.keys(t).length, l).toBe(KEY_SNAP_DICT_KEYS.length + 1);
      for (const [k, v] of Object.entries(t)) {
        expect(slots(v), `${l}: ${k}`).toEqual(slots(KEY_SNAP_MESSAGES[k as KeySnapMessageKey]));
        expect(HANGUL.test(v), `${l}: ${k}`).toBe(false);
      }
      for (const a of ['X', 'Y', 'Z']) expect(formatKeySnapMessage(t.axisKind!, [a]), l).toBe(translate(`${a}축`, l));
    }
    // 영어 측정 알림(코어 글 함수에 틀) — 값(종류·좌표·거리)은 그대로
    const en = keySnapMessages(keySnapTemplates(KEY_SNAP_MESSAGES, (s) => translate(s, 'en')));
    const num = (v: number): string => String(v);
    const body = candidateText({ kind: 'endpoint', point: [40, 15, 0] }, 0, 2, num, 5, 'mm', en);
    expect(body).toBe('Endpoint 1/2: X 40, Y 15, Z 0, distance 5 mm');
    expect(formatKeySnapMessage(en.start, [body, keySnapHint(KEY_SNAP_KEYS, 'measure', true, en)])).toBe(
      'Virtual cursor on. Endpoint 1/2: X 40, Y 15, Z 0, distance 5 mm. Move ←→↑↓ · Next candidate Tab · Pick point Enter · Turn off Esc',
    );
    expect(candidateText({ kind: 'axis', axis: 'z', locked: true, point: [0, 0, 1] }, 0, 1, num, null, 'mm', en)).toBe('Z axis on the locked line: X 0, Y 0, Z 1');
    expect(keySnapHint(KEY_SNAP_KEYS, 'pick', true, keySnapMessages(keySnapTemplates(KEY_SNAP_MESSAGES, (s) => translate(s, 'de'))))).toBe(
      'Bewegen ←→↑↓ · Nächster Kandidat Tab · Auswählen Enter · Ausschalten Esc',
    );
  });

  it('짧은 알림 틀이 화면 번역층에서 다른 글(앱 소스 한글 글·사전 열쇠)을 바꾸지 않는다 — "{0}축" 틀은 바꾸므로 축 열쇠 셋으로', () => {
    const corpus = new Set<string>();
    for (const k of Object.keys(catalogs.en!)) {
      if (ADDED.has(k)) continue;
      if (!/\{\d+\}/.test(k)) corpus.add(k);
      for (const f of ['12', 'T1', '공구', '끝점', 'X']) corpus.add(k.replace(/\{\d+\}/g, f));
    }
    // 키보드 붙잡기 모듈 자신(알림 틀·그 설명 주석)은 뺀다
    for (const dir of ['src/app', 'src', 'src/view', 'src/sim'])
      for (const n of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.ts') && x !== 'keysnap.ts')) {
        const text = readFileSync(join(ROOT, dir, n), 'utf8');
        for (const m of text.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
          const t = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, '7');
          if (!HANGUL.test(t) || t.length > 300) continue;
          for (const piece of [t, ...t.split(/ · |\n/)]) if (HANGUL.test(piece) && !ADDED.has(piece)) corpus.add(piece);
        }
      }
    const list = [...corpus];
    expect(list.length).toBeGreaterThan(3000);
    const without = (l: string): Record<string, string> => Object.fromEntries(Object.entries(saved[l]!).filter(([k]) => !ADDED.has(k)));
    for (const l of LANGS) {
      registerCatalog(l, without(l));
      const before = list.map((t) => translate(t, l));
      registerCatalog(l, saved[l]!);
      const after = list.map((t) => translate(t, l));
      expect(list.filter((_, i) => before[i] !== after[i]), l).toEqual([]);
    }
    // 우회의 까닭: '{0}축' 틀을 열쇠로 넣으면 축으로 끝나는 다른 글이 반만 옮겨진다
    registerCatalog('en', { ...saved.en!, '{0}축': '{0} axis' });
    expect(translate('끌어온 축', 'en')).toBe('끌어온  axis');
    expect(translate('잠근 X축', 'en')).toBe('잠근 X axis');
    registerCatalog('en', saved.en!);
    expect(translate('끌어온 축', 'en')).toBe('끌어온 축');
    expect(translate('잠근 X축', 'en')).toBe('잠근 X축');
    expect(translate('X축', 'en')).toBe('X axis');
  });
});
