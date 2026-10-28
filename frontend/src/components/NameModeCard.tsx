"use client";

import { useEffect, useState } from "react";
import { readNameMode, saveNameMode, type NameMode } from "@/lib/nameMode";

export default function NameModeCard() {
  const [mode, setMode] = useState<NameMode>("alias");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(readNameMode());
  }, []);

  function choose(next: NameMode) {
    setMode(next);
    saveNameMode(next);
  }

  return (
    <section className="card">
      <h2 className="card-title" style={{ marginBottom: 4 }}>
        친구 이름 표시
      </h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        친구들을 어떤 이름으로 볼지 골라요. 이 기기에서만 적용돼요.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="radio"
            name="nameMode"
            checked={mode === "alias"}
            onChange={() => choose("alias")}
          />
          그룹 별명으로 보기 (별명이 없으면 닉네임)
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="radio"
            name="nameMode"
            checked={mode === "nickname"}
            onChange={() => choose("nickname")}
          />
          원래 닉네임으로 보기
        </label>
      </div>
    </section>
  );
}
