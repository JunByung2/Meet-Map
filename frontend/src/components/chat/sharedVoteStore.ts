// 같은 탭의 같은 그룹은 요청과 타이머를 공유한다. 마지막 구독이 끝나면 데이터를 버린다.
export function createSharedStore<T>(load: (groupId: number) => Promise<T>, interval = 5000) {
  type Entry = {
    value: T | null
    listeners: Set<() => void>
    timer?: ReturnType<typeof setInterval>
    pending?: Promise<void>
  }
  const entries = new Map<number, Entry>()
  const entry = (id: number) => {
    let item = entries.get(id)
    if (!item) {
      item = { value: null, listeners: new Set() }
      entries.set(id, item)
    }
    return item
  }
  async function refresh(id: number, item: Entry): Promise<void> {
    if (item.pending) return item.pending
    const task = (async () => {
      try {
        const data = await load(id)
        if (entries.get(id) !== item) return
        item.value = data
        item.listeners.forEach(fn => fn())
      } catch {
        // 일시 오류는 다음 주기에 재시도한다.
      }
    })()
    item.pending = task
    try { await task } finally { if (item.pending === task) item.pending = undefined }
  }
  return {
    snapshot: (id: number) => entries.get(id)?.value ?? null,
    subscribe(id: number, listener: () => void) {
      const item = entry(id)
      item.listeners.add(listener)
      if (!item.timer) {
        void refresh(id, item)
        item.timer = setInterval(() => {
          if (typeof document === 'undefined' || !document.hidden) void refresh(id, item)
        }, interval)
      }
      return () => {
        item.listeners.delete(listener)
        if (!item.listeners.size) {
          clearInterval(item.timer)
          if (entries.get(id) === item) entries.delete(id)
        }
      }
    },
    async reload(id: number) {
      const item = entries.get(id)
      if (!item) return
      // 투표 변경 전에 시작한 조회는 기다린 후 다시 읽어 변경 결과를 보장한다.
      if (item.pending) await item.pending
      if (entries.get(id) === item) await refresh(id, item)
    },
  }
}
