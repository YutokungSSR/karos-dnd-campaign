"use client";

import { useEffect, useRef, useState } from "react";
import LiveSceneStage from "@/components/LiveSceneStage";
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
  tickerMax: number;
  revealDelayMs: number;
  totalDurationMs: number;
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

  if (sides === 4) return { tier: value === 4 ? "gold" : "white", meteor: false } as const;
  if (sides === 6) return { tier: value === 6 ? "gold" : "white", meteor: false } as const;
  if (sides === 8) return { tier: value >= 7 ? "gold" : "white", meteor: false } as const;
  if (sides === 10) return { tier: value >= 8 ? "gold" : "white", meteor: false } as const;

  if (sides === 12) {
    if (value === 12) return { tier: "rainbow", meteor: false } as const;
    return { tier: value >= 10 ? "gold" : "white", meteor: false } as const;
  }

  if (sides === 20) {
    if (value === 20) return { tier: "rainbow", meteor: false } as const;
    return { tier: value >= 15 ? "gold" : "green", meteor: false } as const;
  }

  if (value >= 90) return { tier: "rainbow", meteor: true } as const;
  if (value >= 70) return { tier: "rainbow", meteor: false } as const;
  if (value >= 50) return { tier: "gold", meteor: false } as const;
  if (value >= 30) return { tier: "red", meteor: false } as const;
  if (value >= 15) return { tier: "blue", meteor: false } as const;

  return { tier: "green", meteor: false } as const;
}

function getTickerMax(expression: string, total: number) {
  const normalized = expression.trim().toLowerCase();
  const singleDie = normalized.match(/^1d(\d+)$/);
  if (singleDie) return Math.max(2, Number(singleDie[1]));
  return Math.max(12, total);
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

type DiceSoundKind = "dice-charge" | "dice-tick" | "dice-reveal" | "dice-stop";

type DiceSoundDetail = {
  progress?: number;
  durationMs?: number;
  tier?: GlowTier;
  meteor?: boolean;
  tick?: number;
};

function emitDiceSound(kind: DiceSoundKind, detail: DiceSoundDetail = {}) {
  window.dispatchEvent(
    new CustomEvent("karos-ui-sound", {
      detail: { kind, ...detail },
    })
  );
}

function getDifferentRandom(current: number | null, max: number) {
  if (max <= 1) return 1;
  let next = randomInt(1, max);
  if (current === null) return next;

  let guard = 0;
  while (next === current && guard < 8) {
    next = randomInt(1, max);
    guard += 1;
  }

  return next;
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
  const [displayValue, setDisplayValue] = useState<number | null>(null);
  const [isResultRevealed, setIsResultRevealed] = useState(false);
  const [phaseText, setPhaseText] = useState("ชะตากำลังหมุนวน...");
  const [tickerSeed, setTickerSeed] = useState(0);

  const shownRollIds = useRef(new Set<string>());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearAnimationTimers() {
    if (tickerTimer.current) clearTimeout(tickerTimer.current);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    tickerTimer.current = null;
    revealTimer.current = null;
    hideTimer.current = null;
  }

  function runTicker(max: number, revealDelayMs: number) {
    const startedAt = Date.now();
    let tickIndex = 0;

    const tick = () => {
      setDisplayValue((current) => getDifferentRandom(current, max));
      setTickerSeed((seed) => seed + 1);

      const elapsed = Date.now() - startedAt;
      const progress = Math.min(elapsed / revealDelayMs, 1);
      const soundEvery = progress < 0.58 ? 2 : 1;
      if (tickIndex % soundEvery === 0) {
        emitDiceSound("dice-tick", { progress, tick: tickIndex });
      }
      tickIndex += 1;

      const nextDelay = progress < 0.55 ? 68 : progress < 0.82 ? 92 : 128;
      tickerTimer.current = setTimeout(tick, nextDelay);
    };

    tick();
  }

  function hideAnimatedRoll() {
    clearAnimationTimers();
    emitDiceSound("dice-stop");
    setAnimatedRoll(null);
    setDisplayValue(null);
    setIsResultRevealed(false);
    setPhaseText("ชะตากำลังหมุนวน...");
    setTickerSeed(0);
  }

  function showRoll(record: RollRecord) {
    if (!record.id || shownRollIds.current.has(record.id)) return;

    shownRollIds.current.add(record.id);

    const effect = getRollEffect(record.expression, record.detail, record.result);
    const tickerMax = getTickerMax(record.expression, record.result);
    const revealDelayMs = effect.meteor ? 3600 : 2600;
    const totalDurationMs = effect.meteor ? 7000 : 5200;

    clearAnimationTimers();
    emitDiceSound("dice-stop");

    setAnimatedRoll({
      id: record.id,
      expression: record.expression,
      result: record.result,
      rollerName: record.profiles?.display_name || "นักผจญภัย",
      tier: effect.tier,
      meteor: effect.meteor,
      tickerMax,
      revealDelayMs,
      totalDurationMs,
    });

    setDisplayValue(getDifferentRandom(null, tickerMax));
    setIsResultRevealed(false);
    setPhaseText(effect.meteor ? "ดาวตกกำลังขีดชะตา..." : "ชะตากำลังหมุนวน...");
    setTickerSeed((seed) => seed + 1);

    emitDiceSound("dice-charge", {
      durationMs: revealDelayMs,
      tier: effect.tier,
      meteor: effect.meteor,
    });
    runTicker(tickerMax, revealDelayMs);

    revealTimer.current = setTimeout(() => {
      if (tickerTimer.current) clearTimeout(tickerTimer.current);
      tickerTimer.current = null;
      setDisplayValue(record.result);
      setIsResultRevealed(true);
      setPhaseText(effect.meteor ? "พรจากฟากฟ้าตอบรับแล้ว" : "ผลลัพธ์ปรากฏแล้ว");
      emitDiceSound("dice-reveal", {
        tier: effect.tier,
        meteor: effect.meteor,
      });
    }, revealDelayMs);

    hideTimer.current = setTimeout(() => {
      hideAnimatedRoll();
    }, totalDurationMs);
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
      clearAnimationTimers();
      emitDiceSound("dice-stop");
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
      setMessage(error instanceof Error ? error.message : "ทอยลูกเต๋าไม่สำเร็จ");
    } finally {
      setRolling(false);
    }
  }

  const rollingGhostAbove = animatedRoll ? ((displayValue ?? 1) % animatedRoll.tickerMax) + 1 : null;
  const rollingGhostBelow = animatedRoll
    ? (((displayValue ?? 1) + animatedRoll.tickerMax - 2) % animatedRoll.tickerMax) + 1
    : null;

  return (
    <>
      <LiveSceneStage campaignId={campaignId} userId={userId} />

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
          <button
            className="button"
            onClick={roll}
            disabled={rolling}
            data-ui-sound="off"
          >
            {rolling ? "กำลังทอย…" : "ทอย"}
          </button>
        </div>

        <div className="dicePresets">
          {["1d4", "1d6", "1d8", "1d10", "1d12", "1d20", "1d100"].map((preset) => (
            <button key={preset} className="tinyButton" onClick={() => setExpression(preset)}>
              {preset}
            </button>
          ))}
        </div>

        {message ? <p className="notice">{message}</p> : null}
      </section>

      {animatedRoll ? (
        <div
          className={`${styles.rollOverlay} ${animatedRoll.meteor ? styles.meteorMode : ""} ${
            isResultRevealed ? styles.overlayReveal : styles.overlayCharge
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
            className={`${styles.resultCard} ${styles[`tier_${animatedRoll.tier}`]} ${
              isResultRevealed ? styles.cardReveal : styles.cardCharge
            }`}
          >
            <div className={styles.rollerBadge}>
              <span>ผู้ทอย</span>
              <strong>{animatedRoll.rollerName}</strong>
            </div>

            <span className={styles.cardHalo} aria-hidden="true" />
            <span className={styles.cardSparkLeft} aria-hidden="true" />
            <span className={styles.cardSparkRight} aria-hidden="true" />

            <div className={styles.phaseBanner}>{phaseText}</div>
            <div className={styles.cardSigil}>{isResultRevealed ? "✦" : "✧"}</div>
            <small className={styles.expression}>{animatedRoll.expression}</small>

            <div className={styles.resultViewport}>
              {!isResultRevealed ? (
                <>
                  <span className={`${styles.resultGhost} ${styles.resultGhostTop}`}>{rollingGhostAbove}</span>
                  <strong key={tickerSeed} className={`${styles.resultNumber} ${styles.resultNumberRolling}`}>
                    {displayValue ?? animatedRoll.result}
                  </strong>
                  <span className={`${styles.resultGhost} ${styles.resultGhostBottom}`}>{rollingGhostBelow}</span>
                </>
              ) : (
                <strong className={`${styles.resultNumber} ${styles.resultNumberReveal}`}>
                  {animatedRoll.result}
                </strong>
              )}
            </div>

            <div className={styles.cardFooter}>
              <span className={styles.resultLabel}>{isResultRevealed ? "ผลลัพธ์สุดท้าย" : "กำลังสุ่มชะตา"}</span>
              <span className={styles.durationHint}>
                {isResultRevealed ? "คำตอบถูกเปิดเผยแล้ว" : "ตัวเลขกำลังไหลเวียน..."}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
