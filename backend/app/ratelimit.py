"""간단한 횟수 제한기 (무차별 대입·도배 방지).

서버 프로세스 메모리에 저장하므로 서버를 여러 개 띄우면 서버마다 따로 센다.
(지금 규모에서는 충분하고, 커지면 Redis 등으로 바꾼다)
"""
import threading
import time
from collections import defaultdict, deque

_MAX_KEYS = 20000  # 메모리가 무한히 늘지 않게 하는 상한


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, window: float, now: float) -> deque:
        q = self._hits[key]
        while q and now - q[0] > window:
            q.popleft()
        return q

    def blocked(self, key: str, limit: int, window: float) -> int:
        """이미 한도를 넘었으면 풀릴 때까지 남은 초(1 이상)를, 아니면 0을 돌려준다. 횟수는 올리지 않는다."""
        now = time.monotonic()
        with self._lock:
            q = self._prune(key, window, now)
            if len(q) >= limit:
                return max(1, int(window - (now - q[0])) + 1)
            return 0

    def hit(self, key: str, window: float) -> None:
        """한 번 일어났다고 기록한다."""
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > _MAX_KEYS:
                for k in [k for k, q in self._hits.items() if not q or now - q[-1] > window]:
                    del self._hits[k]
            self._prune(key, window, now).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()