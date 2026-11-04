"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { shrinkImage } from "@/lib/imageShrink";
import { postWithProgress } from "@/lib/postWithProgress";

export type OutStatus = "wait" | "up" | "done" | "fail";
export type OutItem = { id: string; file: File; preview: string; status: OutStatus; progress: number; attId?: number; error?: string };
export type OutGroup = { key: string; bundle: boolean; items: OutItem[]; working: boolean };

const PARALLEL = 5; // 동시에 올리는 장수
export const BUNDLE_MAX = 16; // 한 말풍선에 묶이는 최대 장수 (4x4). 더 많으면 16장씩 나눠 여러 말풍선으로 보낸다

/**
 * 채팅에서 사진을 보낼 때, 카톡처럼 '보내는 중' 말풍선을 보여 주기 위한 상태.
 * - 사진을 브라우저에서 줄이고(imageShrink) 5장씩 동시에 올려요.
 * - 장마다 진행률(%)이 보이고, 실패한 장은 다시 시도할 수 있어요.
 * - 전부 올라가면 채팅 메시지를 보내고(묶음이면 한 말풍선) 이 말풍선은 사라져요.
 */
export function useOutgoingPhotos(groupId: number, send: (text: string) => Promise<boolean>) {
  const [groups, setGroups] = useState<OutGroup[]>([]);
  const ref = useRef<OutGroup[]>([]);
  const chainRef = useRef<Promise<void>>(Promise.resolve()); // 말풍선은 순서대로 하나씩 올린다
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const commit = useCallback((fn: (cur: OutGroup[]) => OutGroup[]) => {
    ref.current = fn(ref.current);
    setGroups(ref.current);
  }, []);
  const patchItem = useCallback(
    (key: string, id: string, patch: Partial<OutItem>) =>
      commit((cur) =>
        cur.map((g) => (g.key !== key ? g : { ...g, items: g.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
      ),
    [commit],
  );
  const patchGroup = useCallback(
    (key: string, patch: Partial<OutGroup>) => commit((cur) => cur.map((g) => (g.key === key ? { ...g, ...patch } : g))),
    [commit],
  );
  const find = (key: string) => ref.current.find((g) => g.key === key);

  const sendText = useCallback(async (text: string) => {
    // send() 는 이미 다른 전송 중이면 false 를 돌려줘요 → 잠깐 기다렸다가 다시 시도
    for (let n = 0; n < 40; n += 1) {
      if (await sendRef.current(text)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }, []);

  const uploadItem = useCallback(
    async (key: string, id: string) => {
      const item = find(key)?.items.find((i) => i.id === id);
      if (!item) return;
      patchItem(key, id, { status: "up", progress: 0, error: undefined });
      try {
        const small = await shrinkImage(item.file);
        const form = new FormData();
        form.append("file", small);
        form.append("kind", "image");
        const att = await postWithProgress<{ id: number }>(`/groups/${groupId}/chat-files?light=1`, form, (p) =>
          patchItem(key, id, { progress: p }),
        );
        patchItem(key, id, { status: "done", progress: 100, attId: att.id });
      } catch (e) {
        patchItem(key, id, { status: "fail", error: e instanceof ApiError ? e.message : "올리지 못했어요." });
      }
    },
    [groupId, patchItem],
  );

  const drop = useCallback(
    (key: string) => {
      const g = find(key);
      g?.items.forEach((i) => URL.revokeObjectURL(i.preview));
      commit((cur) => cur.filter((x) => x.key !== key));
    },
    [commit],
  );

  // 올라간 사진을 채팅 메시지로 보낸다. 묶음이면 한 말풍선, 아니면 한 장씩.
  const finish = useCallback(
    async (key: string, onlyDone = false) => {
      const g = find(key);
      if (!g) return;
      const done = g.items.filter((i) => i.status === "done" && i.attId);
      const allDone = done.length === g.items.length;
      if (!allDone && !onlyDone) return; // 실패한 장이 있으면 사용자가 고르게 둔다
      if (done.length === 0) return;
      if (g.bundle && done.length > 1) {
        const ok = await sendText(`📷 사진 ${done.length}장\nattach:${done.map((i) => i.attId).join(",")}`);
        if (ok) drop(key);
        return;
      }
      for (const it of done) {
        const ok = await sendText(`📷 사진\nattach:${it.attId}`);
        if (!ok) return;
        URL.revokeObjectURL(it.preview);
        commit((cur) => cur.map((x) => (x.key === key ? { ...x, items: x.items.filter((i) => i.id !== it.id) } : x)));
      }
      if ((find(key)?.items.length ?? 0) === 0) drop(key);
    },
    [commit, drop, sendText],
  );

  const run = useCallback(
    async (key: string) => {
      const g = find(key);
      if (!g || g.working) return;
      patchGroup(key, { working: true });
      const queue = g.items.filter((i) => i.status === "wait" || i.status === "fail").map((i) => i.id);
      let next = 0;
      const worker = async () => {
        while (next < queue.length) {
          const id = queue[next];
          next += 1;
          await uploadItem(key, id);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
      if (find(key)) patchGroup(key, { working: false });
      await finish(key);
    },
    [finish, patchGroup, uploadItem],
  );

  const start = useCallback(
    (files: File[], bundle: boolean) => {
      if (!files.length) return;
      const parts: File[][] = [];
      if (bundle) for (let i = 0; i < files.length; i += BUNDLE_MAX) parts.push(files.slice(i, i + BUNDLE_MAX));
      else parts.push(files);
      const made: OutGroup[] = parts.map((part) => ({
        key: crypto.randomUUID(),
        bundle,
        working: false,
        items: part.map((file) => ({
          id: crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
          status: "wait" as OutStatus,
          progress: 0,
        })),
      }));
      commit((cur) => [...cur, ...made]);
      for (const g of made) chainRef.current = chainRef.current.then(() => run(g.key)).catch(() => undefined);
    },
    [commit, run],
  );

  const retry = useCallback((key: string) => void run(key), [run]);
  const sendDoneOnly = useCallback(
    (key: string) => {
      const g = find(key);
      if (!g) return;
      // 실패한 장은 빼고 올라간 것만 보낸다
      commit((cur) =>
        cur.map((x) => {
          if (x.key !== key) return x;
          x.items.filter((i) => i.status !== "done").forEach((i) => URL.revokeObjectURL(i.preview));
          return { ...x, items: x.items.filter((i) => i.status === "done") };
        }),
      );
      void finish(key, true);
    },
    [commit, finish],
  );

  useEffect(
    () => () => {
      ref.current.forEach((g) => g.items.forEach((i) => URL.revokeObjectURL(i.preview)));
    },
    [],
  );

  return { groups, start, retry, discard: drop, sendDoneOnly };
}
