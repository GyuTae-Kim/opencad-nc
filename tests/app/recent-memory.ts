/**
 * 시험용 최근 문서 바탕(메모리). fail을 켜면 모든 일이 실패한다(비공개 창·막힌 저장소 흉내).
 */
import type { RecentBackend, RecentData, RecentEntry, SharedFile } from '../../src/app/recent';

export interface MemoryBackend extends RecentBackend {
  readonly entries: Map<string, { entry: RecentEntry; data: RecentData }>;
  /** 공유 받은 한 번 쓸 자리(열쇠 = share: 뒤) */
  readonly shares: Map<string, SharedFile[]>;
  fail: boolean;
}

export function memoryBackend(): MemoryBackend {
  const entries = new Map<string, { entry: RecentEntry; data: RecentData }>();
  const shares = new Map<string, SharedFile[]>();
  const self: MemoryBackend = {
    entries,
    shares,
    fail: false,
    async list() {
      check();
      return [...entries.values()].map((v) => ({ ...v.entry }));
    },
    async read(id) {
      check();
      return entries.get(id)?.data ?? null;
    },
    async put(entry, data) {
      check();
      entries.set(entry.id, { entry: { ...entry }, data });
    },
    async touch(id, time) {
      check();
      const v = entries.get(id);
      if (v) v.entry.time = time;
    },
    async remove(ids) {
      check();
      for (const id of ids) entries.delete(id);
    },
    async clear() {
      check();
      entries.clear();
      shares.clear();
    },
    async takeShare(key) {
      check();
      const v = shares.get(key) ?? null;
      shares.clear();
      return v;
    },
  };
  function check(): void {
    if (self.fail) throw new Error('저장소를 쓸 수 없음');
  }
  return self;
}
