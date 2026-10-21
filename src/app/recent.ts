/**
 * 최근 문서: 열어 본 NC 파일을 이 브라우저의 IndexedDB(데이터베이스 `opencad-nc`, 저장소 `recent`)에만 둔다 — 서버로 보내지 않는다.
 *
 * 휴대폰 브라우저는 뒤로 간 탭(특히 WebGL 화면)을 버렸다가 돌아오면 페이지를 다시 읽어 열린 파일이 사라진다.
 * 시작 화면의 "최근 문서"에서 파일 앱을 다시 거치지 않고 바로 다시 연다.
 * - 새것이 먼저, 8개까지(넘치면 오래된 것부터 지운다). 60MB보다 큰 파일과 빈 파일은 두지 않는다.
 * - 같은 이름·크기는 한 항목(다시 열면 시각만 새로).
 * - IndexedDB를 못 쓰면(비공개 창·막힌 저장소·용량 부족) 조용히 아무 일도 하지 않는다.
 * - 목록(이름·크기·시각)과 내용은 열쇠를 나눠(`meta:`·`data:`) 두어, 목록을 읽을 때 파일 내용을 읽지 않는다.
 * - 저장 방식은 RecentBackend로 바꿔 끼운다(시험은 tests/app/recent-memory.ts의 메모리 바탕).
 *
 * 2dcad-viewer의 src/app/recent.ts(같은 한도)를 따라 다시 짰다.
 */

export interface RecentEntry {
  /** 이름·크기로 만든 열쇠 */
  id: string;
  name: string;
  /** 바이트 */
  size: number;
  /** 마지막으로 연 시각(ms) */
  time: number;
}

/** 파일 내용: 고른 파일(File·Blob) 그대로 또는 바이트 */
export type RecentData = Blob | ArrayBuffer;

/** 저장 바탕(IndexedDB·시험용 메모리) */
export interface RecentBackend {
  /** 목록(내용 없이) */
  list(): Promise<RecentEntry[]>;
  read(id: string): Promise<RecentData | null>;
  /** 목록 항목과 내용을 함께 둔다(같은 id면 바꾼다) */
  put(entry: RecentEntry, data: RecentData): Promise<void>;
  /** 시각만 새로 */
  touch(id: string, time: number): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

export const RECENT_DB = 'opencad-nc';
export const RECENT_STORE = 'recent';
export const RECENT_MAX = 8;
export const RECENT_MAX_SIZE = 60 * 1024 * 1024;

export const recentId = (name: string, size: number): string => `${name}:${size}`;

/** 최근 문서에 둘 크기인지(빈 파일·60MB 넘는 파일은 두지 않는다) */
export function fitsRecent(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= RECENT_MAX_SIZE;
}

/** 새것이 먼저(시각이 같으면 이름 순) */
export function sortRecent(list: readonly RecentEntry[]): RecentEntry[] {
  return [...list].sort((a, b) => b.time - a.time || a.name.localeCompare(b.name));
}

/** 한도를 넘는 오래된 항목의 id */
export function overflowIds(list: readonly RecentEntry[], max = RECENT_MAX): string[] {
  return sortRecent(list)
    .slice(max)
    .map((e) => e.id);
}

/**
 * 연 시각 글: 오늘이면 시각만, 올해면 월·일·시각, 그 앞이면 연·월·일(화면 언어 lang의 형식).
 * 화면 언어가 바뀌면 다시 그린다(앱의 languagechange).
 */
export function formatRecentTime(time: number, now: number, lang = 'ko'): string {
  const d = new Date(time);
  const n = new Date(now);
  const sameYear = d.getFullYear() === n.getFullYear();
  const sameDay = sameYear && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const opts: Intl.DateTimeFormatOptions = sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : sameYear
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { year: 'numeric', month: 'short', day: 'numeric' };
  try {
    return new Intl.DateTimeFormat(lang, opts).format(d);
  } catch {
    return new Intl.DateTimeFormat('ko', opts).format(d);
  }
}

/** Blob(File)인지 — 다른 영역(realm)의 ArrayBuffer도 바르게 가리게 instanceof 대신 모양으로 본다 */
const isBlob = (d: RecentData): d is Blob => typeof (d as Blob).arrayBuffer === 'function' && typeof (d as Blob).size === 'number';
const sizeOf = (d: RecentData): number => (isBlob(d) ? d.size : d.byteLength);

export class RecentStore {
  /** backend가 null이면(IndexedDB 없음) 모든 일이 빈손으로 끝난다 */
  constructor(private readonly backend: RecentBackend | null = indexedDbBackend()) {}

  get available(): boolean {
    return !!this.backend;
  }

  /** 새것이 먼저. 못 읽으면 빈 목록 */
  async list(): Promise<RecentEntry[]> {
    if (!this.backend) return [];
    try {
      return sortRecent(await this.backend.list());
    } catch {
      return [];
    }
  }

  /** 열린 파일을 둔다. 두었으면 true(너무 큰 파일·저장 실패는 false) */
  async add(name: string, data: RecentData, now = Date.now()): Promise<boolean> {
    const size = sizeOf(data);
    if (!this.backend || !fitsRecent(size)) return false;
    try {
      await this.backend.put({ id: recentId(name, size), name, size, time: now }, data);
      const extra = overflowIds(await this.backend.list());
      if (extra.length) await this.backend.remove(extra);
      return true;
    } catch {
      return false;
    }
  }

  /** 내용(바이트 사본 — 워커로 넘겨도 저장한 것은 그대로). 없거나 못 읽으면 null */
  async read(id: string): Promise<ArrayBuffer | null> {
    if (!this.backend) return null;
    try {
      const d = await this.backend.read(id);
      if (!d) return null;
      return isBlob(d) ? await d.arrayBuffer() : d.slice(0);
    } catch {
      return null;
    }
  }

  /** 다시 연 항목을 맨 앞으로 */
  async touch(id: string, now = Date.now()): Promise<void> {
    try {
      await this.backend?.touch(id, now);
    } catch {
      /* 저장소를 못 쓰면 넘어간다 */
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.backend?.remove([id]);
    } catch {
      /* 저장소를 못 쓰면 넘어간다 */
    }
  }

  async clear(): Promise<void> {
    try {
      await this.backend?.clear();
    } catch {
      /* 저장소를 못 쓰면 넘어간다 */
    }
  }
}

// ───────────────────────── IndexedDB ─────────────────────────

const META = 'meta:';
const DATA = 'data:';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function finished(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('IndexedDB 작업이 취소되었습니다.'));
  });
}

/**
 * IndexedDB 바탕. 저장소 하나에 열쇠를 밖에 두고(out-of-line) 목록은 `meta:<id>`, 내용은 `data:<id>`(Blob)로 둔다.
 * IndexedDB가 없거나 막혀 있으면 null.
 */
export function indexedDbBackend(dbName = RECENT_DB): RecentBackend | null {
  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    return null;
  }
  if (!factory) return null;
  const idb = factory;
  let opening: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = idb.open(dbName, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(RECENT_STORE)) r.result.createObjectStore(RECENT_STORE);
      };
      r.onsuccess = () => {
        const db = r.result;
        // 다른 탭이 판을 올리면 닫고 다음에 다시 연다
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      r.onerror = () => reject(r.error);
    }).catch((e: unknown) => {
      opening = null;
      throw e;
    });
    return opening;
  };
  /** 거래 하나: fn이 돌려준 요청의 결과를 거래가 끝난 뒤 돌려준다 */
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> => {
    const t = (await open()).transaction(RECENT_STORE, mode);
    const r = fn(t.objectStore(RECENT_STORE));
    const [value] = await Promise.all([r ? request(r) : undefined, finished(t)]);
    return value;
  };
  const metaRange = (): IDBKeyRange => IDBKeyRange.bound(META, `${META}\uffff`);
  return {
    async list() {
      return ((await run('readonly', (s) => s.getAll(metaRange()))) ?? []) as RecentEntry[];
    },
    async read(id) {
      return ((await run('readonly', (s) => s.get(DATA + id))) as RecentData | undefined) ?? null;
    },
    async put(entry, data) {
      // 바이트는 Blob으로 감싸 둔다(목록을 읽을 때 내용을 메모리에 올리지 않게)
      const blob = isBlob(data) ? data : new Blob([data]);
      await run('readwrite', (s) => {
        s.put(blob, DATA + entry.id);
        s.put(entry, META + entry.id);
        return null;
      });
    },
    async touch(id, time) {
      await run('readwrite', (s) => {
        const r = s.get(META + id);
        r.onsuccess = () => {
          const e = r.result as RecentEntry | undefined;
          if (e) s.put({ ...e, time }, META + id);
        };
        return null;
      });
    },
    async remove(ids) {
      await run('readwrite', (s) => {
        for (const id of ids) {
          s.delete(META + id);
          s.delete(DATA + id);
        }
        return null;
      });
    },
    async clear() {
      await run('readwrite', (s) => s.clear());
    },
  };
}
