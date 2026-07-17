"use client";

import { useState } from "react";
import { rollDice } from "@/lib/dice";
import { getSupabase } from "@/lib/supabase";

export default function DiceRoller({
  campaignId,
  userId,
  onRolled,
}: {
  campaignId: string;
  userId: string;
  onRolled?: () => void;
}) {
  const [expression, setExpression] = useState("1d20");
  const [message, setMessage] = useState("");
  const [rolling, setRolling] = useState(false);

  async function roll() {
    setRolling(true);
    setMessage("");
    try {
      const result = rollDice(expression);
      const { error } = await getSupabase().from("dice_rolls").insert({
        campaign_id: campaignId,
        user_id: userId,
        expression: result.expression,
        result: result.total,
        detail: result.detail,
      });
      if (error) throw error;
      setMessage(`ผลลัพธ์ ${result.total} — ${result.detail}`);
      onRolled?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ทอยลูกเต๋าไม่สำเร็จ");
    } finally {
      setRolling(false);
    }
  }

  return (
    <section className="panel dicePanel">
      <div className="panelTitleRow">
        <div>
          <p className="eyebrow">Dice Chamber</p>
          <h2>ห้องทอยลูกเต๋า</h2>
        </div>
        <span className="diceIcon">⚄</span>
      </div>
      <div className="inlineForm">
        <input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="1d20+5" />
        <button className="button" onClick={roll} disabled={rolling}>{rolling ? "กำลังทอย…" : "ทอย"}</button>
      </div>
      <div className="dicePresets">
        {["1d4", "1d6", "1d8", "1d10", "1d12", "1d20", "1d100"].map((preset) => (
          <button key={preset} className="tinyButton" onClick={() => setExpression(preset)}>{preset}</button>
        ))}
      </div>
      {message ? <p className="notice">{message}</p> : null}
    </section>
  );
}
