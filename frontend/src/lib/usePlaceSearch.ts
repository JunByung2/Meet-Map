"use client";

import { useEffect, useRef, useState } from "react";
import { loadKakao, searchKeyword, type PlaceResult } from "@/lib/kakao";

/** 장소 검색창 공통 로직: 검색어 / 결과 / 로딩 / 안내 메시지 (사진 올리기, 출발지, KakaoMap 이 같이 사용) */
export function usePlaceSearch() {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(""); // SDK/키 문제 (검색 자체를 못 하는 경우)
  const [message, setMessage] = useState(""); // 결과 없음 같은 안내
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kakaoRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    loadKakao()
      .then((k) => {
        if (cancelled) return;
        kakaoRef.current = k;
        setReady(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run() {
    const q = keyword.trim();
    if (!q) {
      setMessage("검색할 장소를 입력해 주세요.");
      return;
    }
    if (!kakaoRef.current) {
      setMessage("장소 검색을 준비하는 중이에요. 잠시 후 다시 눌러 주세요.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const found = await searchKeyword(kakaoRef.current, q);
      setResults(found);
      if (!found.length) setMessage("검색 결과가 없어요. 다른 이름으로 검색해 보세요.");
    } catch (e) {
      setResults([]);
      setMessage(e instanceof Error ? e.message : "장소 검색 중 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setResults([]);
    setMessage("");
  }

  return { keyword, setKeyword, results, loading, ready, error, message, run, clear };
}
