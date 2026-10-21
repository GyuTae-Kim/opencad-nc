/**
 * 최근 문서 저장(recent.ts)의 순수 부분: 순서(새것 먼저)·개수 한도(8)·크기 한도(60MB)·같은 파일 하나로·실패는 조용히.
 * IndexedDB 대신 메모리 바탕을 끼운다.
 */
import { describe, expect, it } from 'vitest';
import { RECENT_MAX, RECENT_MAX_SIZE, RecentStore, fitsRecent, formatRecentTime, overflowIds, recentId, sortRecent, type RecentEntry } from '../../src/app/recent';
import { memoryBackend } from './recent-memory';

const bytes = (n: number, fill = 1): ArrayBuffer => new Uint8Array(n).fill(fill).buffer as ArrayBuffer;
/** 크기만 있는 가짜 Blob(60MB를 실제로 만들지 않는다) */
const fakeBlob = (size: number): Blob => ({ size, arrayBuffer: async () => bytes(4) }) as unknown as Blob;
const entry = (name: string, time: number, size = 10): RecentEntry => ({ id: recentId(name, size), name, size, time });

describe('최근 문서 순수 함수', () => {
  it('새것이 먼저, 시각이 같으면 이름 순', () => {
    const list = [entry('b.nc', 1), entry('c.nc', 3), entry('a.nc', 1), entry('d.nc', 2)];
    expect(sortRecent(list).map((e) => e.name)).toEqual(['c.nc', 'd.nc', 'a.nc', 'b.nc']);
    // 원래 배열은 그대로
    expect(list[0]!.name).toBe('b.nc');
  });

  it('한도를 넘는 오래된 항목만 고른다', () => {
    const list = Array.from({ length: 10 }, (_, i) => entry(`p${i}.nc`, i));
    expect(overflowIds(list)).toEqual([recentId('p1.nc', 10), recentId('p0.nc', 10)]);
    expect(overflowIds(list.slice(0, RECENT_MAX))).toEqual([]);
  });

  it('빈 파일과 60MB 넘는 파일은 두지 않는다', () => {
    expect(fitsRecent(0)).toBe(false);
    expect(fitsRecent(1)).toBe(true);
    expect(fitsRecent(RECENT_MAX_SIZE)).toBe(true);
    expect(fitsRecent(RECENT_MAX_SIZE + 1)).toBe(false);
    expect(fitsRecent(Number.NaN)).toBe(false);
  });

  it('연 시각 글: 오늘은 시각만, 올해는 월·일, 지난해는 연도까지', () => {
    const now = new Date(2026, 9, 21, 15, 30).getTime();
    const today = formatRecentTime(new Date(2026, 9, 21, 9, 5).getTime(), now, 'en');
    expect(today).toMatch(/9:05/);
    expect(today).not.toMatch(/Oct/);
    expect(formatRecentTime(new Date(2026, 2, 3, 9, 5).getTime(), now, 'en')).toMatch(/Mar 3/);
    expect(formatRecentTime(new Date(2025, 2, 3).getTime(), now, 'en')).toMatch(/2025/);
    // 모르는 언어 꼬리표는 한국어 형식으로
    expect(formatRecentTime(now, now, 'not a language!')).toBe(formatRecentTime(now, now, 'ko'));
  });
});

describe('RecentStore', () => {
  it('새것이 먼저 보이고, 같은 이름·크기는 한 항목으로 맨 앞에 온다', async () => {
    const store = new RecentStore(memoryBackend());
    expect(await store.add('a.nc', bytes(10), 1)).toBe(true);
    expect(await store.add('b.nc', bytes(20), 2)).toBe(true);
    expect(await store.add('a.nc', bytes(10, 2), 3)).toBe(true);
    const list = await store.list();
    expect(list.map((e) => `${e.name}:${e.size}:${e.time}`)).toEqual(['a.nc:10:3', 'b.nc:20:2']);
    // 같은 이름이라도 크기가 다르면 다른 파일
    await store.add('a.nc', bytes(11), 4);
    expect((await store.list()).map((e) => e.id)).toEqual([recentId('a.nc', 11), recentId('a.nc', 10), recentId('b.nc', 20)]);
  });

  it('8개를 넘으면 오래된 것부터 지운다', async () => {
    const backend = memoryBackend();
    const store = new RecentStore(backend);
    for (let i = 0; i < RECENT_MAX + 3; i++) await store.add(`p${i}.nc`, bytes(5), 100 + i);
    const list = await store.list();
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]!.name).toBe(`p${RECENT_MAX + 2}.nc`);
    expect(list.at(-1)!.name).toBe('p3.nc');
    // 내용도 함께 지운다
    expect(backend.entries.size).toBe(RECENT_MAX);
  });

  it('60MB 넘는 파일과 빈 파일은 두지 않는다(Blob 크기로 판단)', async () => {
    const store = new RecentStore(memoryBackend());
    expect(await store.add('big.nc', fakeBlob(RECENT_MAX_SIZE + 1), 1)).toBe(false);
    expect(await store.add('empty.nc', bytes(0), 2)).toBe(false);
    expect(await store.add('edge.nc', fakeBlob(RECENT_MAX_SIZE), 3)).toBe(true);
    expect((await store.list()).map((e) => e.name)).toEqual(['edge.nc']);
  });

  it('읽기는 사본을 준다(워커로 넘겨 비워져도 저장한 것은 그대로), 다시 열면 맨 앞으로', async () => {
    const store = new RecentStore(memoryBackend());
    await store.add('a.nc', bytes(8, 7), 1);
    await store.add('b.nc', bytes(8, 9), 2);
    const id = recentId('a.nc', 8);
    const first = await store.read(id);
    expect(new Uint8Array(first!)[0]).toBe(7);
    structuredClone(first, { transfer: [first!] });
    expect(first!.byteLength).toBe(0);
    expect((await store.read(id))!.byteLength).toBe(8);
    await store.touch(id, 5);
    expect((await store.list())[0]!.name).toBe('a.nc');
    expect(await store.read('없는 id')).toBeNull();
  });

  it('지우기와 모두 지우기', async () => {
    const store = new RecentStore(memoryBackend());
    await store.add('a.nc', bytes(3), 1);
    await store.add('b.nc', bytes(3), 2);
    await store.remove(recentId('a.nc', 3));
    expect((await store.list()).map((e) => e.name)).toEqual(['b.nc']);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('저장소를 못 쓰면(IndexedDB 없음·비공개 창) 조용히 빈손', async () => {
    const none = new RecentStore(null);
    expect(none.available).toBe(false);
    expect(await none.add('a.nc', bytes(3))).toBe(false);
    expect(await none.list()).toEqual([]);
    expect(await none.read('a.nc:3')).toBeNull();
    await expect(none.clear()).resolves.toBeUndefined();

    const backend = memoryBackend();
    const store = new RecentStore(backend);
    await store.add('a.nc', bytes(3), 1);
    backend.fail = true;
    expect(await store.add('b.nc', bytes(3), 2)).toBe(false);
    expect(await store.list()).toEqual([]);
    expect(await store.read(recentId('a.nc', 3))).toBeNull();
    await expect(store.touch(recentId('a.nc', 3))).resolves.toBeUndefined();
    await expect(store.remove(recentId('a.nc', 3))).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('jsdom·Node처럼 indexedDB가 없으면 기본 저장소는 쓸 수 없음으로', () => {
    expect(typeof indexedDB).toBe('undefined');
    expect(new RecentStore().available).toBe(false);
  });
});
