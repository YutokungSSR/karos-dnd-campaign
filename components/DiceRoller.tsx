"use client";

import { useEffect, useRef, useState } from "react";
import { rollDice } from "@/lib/dice";
import { getSupabase } from "@/lib/supabase";
import styles from "./DiceRoller.module.css";

type RollRecord = {
  id: string;
  campaign_id: string;
  user_id: string;
  expression: string;
  result: number;
  detail: string;
  created_at?: string;
  profiles?: { display_name?: string | null } | null;
};

type GlowTier = "white" | "green" | "blue" | "red" | "gold" | "rainbow";

type AnimatedRoll = {
  id: string;
  expression: string;
  result: number;
  rollerName: string;
  tier: GlowTier;
  meteor: boolean;
};

function getRollValue(detail: string, fallback: number) {
  const match = detail.match(/^\[(\d+)/);
  return match ? Number(match[1]) : fallback;
}

function getRollEffect(expression: string, detail: string, total: number) {
  const normalized = expression.trim().toLowerCase();
  const match = normalized.match(/^1d(4|6|8|10|12|20|100)$/);

  if (!match) {
    return { tier: "white" as GlowTier, meteor: false };
  }

  const sides = Number(match[1]);
  const value = getRollValue(detail, total);

  if (sides === 4) {
    return { tier: value === 4 ? "gold" : "white", meteor: false } as const;
  }

  if (sides === 6) {
    return { tier: value === 6 ? "gold" : "white", meteor: false } as const;
  }

  if (sides === 8) {
    return { tier: value >= 7 ? "gold" : "white", meteor: false } as const;
  }

  if (sides === 10) {
    return { tier: value >= 8 ? "gold" : "white", meteor: false } as const;
  }

  if (sides === 12) {
    if (value === 12) return { tier: "rainbow", meteor: false } as const;
    return { tier: value >= 10 ? "gold" : "white", meteor: false } as const;
  }

  if (sides === 20) {
    if (value === 20) return { tier: "rainbow", meteor: false } as const;
    return { tier: value >= 15 ? "gold" : "green", meteor: false } as const;
  }

  if (value >= 90) {
    return { tier: "rainbow", meteor: true } as const;
  }
  if (value >= 70) {
    return { tier: "rainbow", meteor: false } as const;
  }
  if (value >= 50) {
    return { tier: "gold", meteor: false } as const;
  }
  if (value >= 30) {
    return { tier: "red", meteor: false } as const;
  }
  if (value >= 15) {
    return { tier: "blue", meteor: false } as const;
  }

  return { tier: "green", meteor: false } as const;
}

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
  const [animatedRoll, setAnimatedRoll] = useState<AnimatedRoll | null>(null);
  const shownRollIds = useRef(new Set<string>());
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showRoll(record: RollRecord) {
    if (!record.id || shownRollIds.current.has(record.id)) return;

    shownRollIds.current.add(record.id);
    const effect = getRollEffect(
      record.expression,
      record.detail,
      record.result
    );

    setAnimatedRoll({
      id: record.id,
      expression: record.expression,
      result: record.result,
      rollerName: record.profiles?.display_name || "นักผจญภัย",
      tier: effect.tier,
      meteor: effect.meteor,
    });

    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
    }

    animationTimer.current = setTimeout(
      () => setAnimatedRoll(null),
      effect.meteor ? 6500 : 4200
    );
  }

  useEffect(() => {
    const supabase = getSupabase();

    const channel = supabase
      .channel(`dice-animation-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dice_rolls",
          filter: `campaign_id=eq.${campaignId}`,
        },
        async (payload) => {
          const rollId = String(payload.new.id);

          if (shownRollIds.current.has(rollId)) return;

          const { data } = await supabase
            .from("dice_rolls")
            .select("*,profiles(display_name)")
            .eq("id", rollId)
            .single();

          if (data) showRoll(data as RollRecord);
        }
      )
      .subscribe();

    return () => {
      if (animationTimer.current) clearTimeout(animationTimer.current);
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  async function roll() {
    setRolling(true);
    setMessage("");

    try {
      const result = rollDice(expression);
      const { data, error } = await getSupabase()
        .from("dice_rolls")
        .insert({
          campaign_id: campaignId,
          user_id: userId,
          expression: result.expression,
          result: result.total,
          detail: result.detail,
        })
        .select("*,profiles(display_name)")
        .single();

      if (error) throw error;

      if (data) showRoll(data as RollRecord);
      setMessage(`ผลลัพธ์ ${result.total} — ${result.detail}`);
      onRolled?.();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ทอยลูกเต๋าไม่สำเร็จ"
      );
    } finally {
      setRolling(false);
    }
  }

  return (
    <>
      <section className="panel dicePanel">
        <div className="panelTitleRow">
          <div>
            <p className="eyebrow">Dice Chamber</p>
            <h2>ห้องทอยลูกเต๋า</h2>
          </div>
          <span className="diceIcon">⚄</span>
        </div>

        <div className="inlineForm">
          <input
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
            placeholder="1d20+5"
            aria-label="สูตรลูกเต๋า"
          />
          <button className="button" onClick={roll} disabled={rolling}>
            {rolling ? "กำลังทอย…" : "ทอย"}
          </button>
        </div>

        <div className="dicePresets">
          {["1d4", "1d6", "1d8", "1d10", "1d12", "1d20", "1d100"].map(
            (preset) => (
              <button
                key={preset}
                className="tinyButton"
                onClick={() => setExpression(preset)}
              >
                {preset}
              </button>
            )
          )}
        </div>

        {message ? <p className="notice">{message}</p> : null}
      </section>

      {animatedRoll ? (
        <div
          className={`${styles.rollOverlay} ${
            animatedRoll.meteor ? styles.meteorMode : ""
          }`}
          role="status"
          aria-live="assertive"
        >
          {animatedRoll.meteor ? (
            <div className={styles.skyCutscene} aria-hidden="true">
              <span className={styles.skyGlow} />
              <span className={`${styles.star} ${styles.starOne}`} />
              <span className={`${styles.star} ${styles.starTwo}`} />
              <span className={`${styles.star} ${styles.starThree}`} />
              <span className={styles.meteor} />
              <span className={styles.impactFlash} />
            </div>
          ) : null}

          <div
            className={`${styles.resultCard} ${
              styles[`tier_${animatedRoll.tier}`]
            }`}
          >
            <div className={styles.rollerBadge}>
              <span>ผู้ทอย</span>
              <strong>{animatedRoll.rollerName}</strong>
            </div>

            <div className={styles.cardSigil}>✦</div>
            <small className={styles.expression}>{animatedRoll.expression}</small>
            <strong className={styles.resultNumber}>{animatedRoll.result}</strong>
            <span className={styles.resultLabel}>ผลการทอย</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
