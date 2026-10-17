"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type Meeting = {
  id: number;
  title: string;
  location: string;
  meeting_time: string;
  status: string | null;
};

export type NewMeeting = {
  title: string;
  location: string;
  meetingTime: string; // datetime-local 값
};

/** 약속 목록 조회 / 등록 */
export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("meetings")
      .select("id, title, location, meeting_time, status")
      .order("meeting_time", { ascending: true });

    if (error) {
      console.error("약속 조회 실패:", error);
      setStatus("약속을 불러오지 못했어요. meetings 테이블과 권한을 확인해 주세요.");
      setLoading(false);
      return;
    }

    setMeetings((data as Meeting[]) ?? []);
    setStatus("");
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const create = useCallback(
    async (input: NewMeeting): Promise<boolean> => {
      const title = input.title.trim();
      const location = input.location.trim();

      if (!title || !location || !input.meetingTime) {
        setStatus("모든 항목을 입력해 주세요.");
        return false;
      }

      const date = new Date(input.meetingTime);
      if (Number.isNaN(date.getTime())) {
        setStatus("날짜와 시간을 확인해 주세요.");
        return false;
      }

      setStatus("약속을 등록하고 있어요.");

      const { error } = await getSupabase().from("meetings").insert({
        title,
        location,
        meeting_time: date.toISOString(),
        status: "confirmed",
      });

      if (error) {
        console.error("약속 등록 실패:", error);
        setStatus("약속 등록에 실패했어요. Supabase 테이블과 권한을 확인해 주세요.");
        return false;
      }

      await load();
      setStatus("약속을 등록했어요!");
      return true;
    },
    [load],
  );

  return { meetings, loading, status, create };
}
