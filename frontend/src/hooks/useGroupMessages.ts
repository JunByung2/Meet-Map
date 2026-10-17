"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type ChatMessage = {
  id: number;
  group_id: number;
  user_id: number;
  text: string | null;
  created_at: string;
};

/** 그룹 채팅 메시지 조회 / 전송 / 실시간 구독 */
export function useGroupMessages(groupId: number, userId: number | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const activeGroup = useRef(groupId);

  const load = useCallback(async () => {
    const requested = groupId;
    const { data, error } = await getSupabase()
      .from("messages")
      .select("*")
      .eq("group_id", requested)
      .order("created_at", { ascending: true });

    if (activeGroup.current !== requested) return;

    if (error) {
      console.error("메시지 조회 실패:", error);
      setStatus("메시지를 불러오지 못했어요. Supabase 권한을 확인해 주세요.");
      setLoading(false);
      return;
    }

    setMessages((data as ChatMessage[]) ?? []);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    activeGroup.current = groupId;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setMessages([]);
    load();

    const supabase = getSupabase();
    const channel = supabase
      .channel(`messages-group-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          if (activeGroup.current === groupId) load();
        },
      )
      .subscribe((s) => {
        if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
          setStatus(
            "실시간 연결에 실패했어요. Supabase의 Realtime 설정을 확인해 주세요.",
          );
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, load]);

  const send = useCallback(
    async (rawText: string): Promise<boolean> => {
      const text = rawText.trim();
      if (sending || !text || userId === null) return false;

      setSending(true);
      const { error } = await getSupabase()
        .from("messages")
        .insert({ group_id: groupId, user_id: userId, text });
      setSending(false);

      if (error) {
        console.error("메시지 전송 실패:", error);
        setStatus("메시지를 보내지 못했어요. Supabase 권한을 확인해 주세요.");
        return false;
      }

      setStatus("");
      await load();
      return true;
    },
    [groupId, userId, sending, load],
  );

  return { messages, loading, sending, status, setStatus, send };
}
