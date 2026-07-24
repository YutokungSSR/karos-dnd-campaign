"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import styles from "./PartyVitals.module.css";

type VitalKey = "hp" | "mp" | "food" | "water";

type PartyCharacter = {
  id: string;
  current_hp?: number | null;
  max_hp?: number | null;
  current_mp?: number | null;
  max_mp?: number | null;
  current_food?: number | null;
  max_food?: number | null;
  current_water?: number | null;
  max_water?: number | null;
};

type PartyVitalsProps = {
  character: PartyCharacter;
  canEdit: boolean;
  onUpdated: () => Promise<void> | void;
  onMessage?: (message: string) => void;
};

type VitalSpec = {
  key: VitalKey;
  label: string;
  currentField: keyof PartyCharacter;
  maxField: keyof PartyCharacter;
  fallbackCurrent: number;
  fallbackMax: number;
};

const VITALS: VitalSpec[] = [
  {
    key: "hp",
    label: "HP",
    currentField: "current_hp",
    maxField: "max_hp",
    fallbackCurrent: 20,
    fallbackMax: 20,
  },
  {
    key: "mp",
    label: "MP",
    currentField: "current_mp",
    maxField: "max_mp",
    fallbackCurrent: 10,
    fallbackMax: 10,
  },
  {
    key: "food",
    label: "อาหาร",
    currentField: "current_food",
    maxField: "max_food",
    fallbackCurrent: 100,
    fallbackMax: 100,
  },
  {
    key: "water",
    label: "น้ำ",
    currentField: "current_water",
    maxField: "max_water",
    fallbackCurrent: 100,
    fallbackMax: 100,
  },
];

function safeNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function emitSound(kind: "success" | "warning") {
  window.dispatchEvent(
    new CustomEvent("karos-ui-sound", {
      detail: { kind },
    })
  );
}

export default function PartyVitals({
  character,
  canEdit,
  onUpdated,
  onMessage,
}: PartyVitalsProps) {
  const [busyKey, setBusyKey] = useState<VitalKey | null>(null);

  const resources = useMemo(
    () =>
      VITALS.map((spec) => {
        const maximum = Math.max(
          spec.key === "mp" ? 0 : 1,
          safeNumber(character[spec.maxField], spec.fallbackMax)
        );
        const current = clamp(
          safeNumber(character[spec.currentField], spec.fallbackCurrent),
          0,
          maximum
        );
        const percent = maximum > 0 ? (current / maximum) * 100 : 0;
        return { ...spec, current, maximum, percent };
      }),
    [character]
  );

  async function adjustVital(vital: VitalKey, amount: number) {
    if (!canEdit || busyKey) return;

    setBusyKey(vital);
    onMessage?.("");

    try {
      const { error } = await getSupabase().rpc("adjust_character_vital", {
        target_character: character.id,
        vital_name: vital,
        delta_amount: amount,
      });

      if (error) {
        emitSound("warning");
        onMessage?.(error.message);
        return;
      }

      emitSound("success");
      await onUpdated();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className={styles.vitalsPanel}>
      <div className={styles.vitalsGrid}>
        {resources.map((resource) => {
          const busy = busyKey === resource.key;

          return (
            <article
              className={`${styles.vitalCard} ${styles[`vital_${resource.key}`]}`}
              key={resource.key}
            >
              <div className={styles.vitalHeader}>
                <strong>{resource.label}</strong>
                <span>
                  {resource.current}/{resource.maximum}
                </span>
              </div>

              <div
                className={styles.vitalTrack}
                role="progressbar"
                aria-label={`${resource.label} ${resource.current} จาก ${resource.maximum}`}
                aria-valuemin={0}
                aria-valuemax={resource.maximum}
                aria-valuenow={resource.current}
              >
                <i style={{ width: `${resource.percent}%` }} />
              </div>

              {canEdit ? (
                <div className={styles.vitalControls}>
                  {[-5, -1, 1, 5].map((amount) => (
                    <button
                      type="button"
                      key={amount}
                      disabled={Boolean(busyKey)}
                      onClick={() => adjustVital(resource.key, amount)}
                      aria-label={`${amount > 0 ? "เพิ่ม" : "ลด"}${resource.label} ${Math.abs(
                        amount
                      )}`}
                    >
                      {busy ? "…" : amount > 0 ? `+${amount}` : `−${Math.abs(amount)}`}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className={styles.vitalsFooter}>
        <span>{canEdit ? "DM CONTROL" : "READ ONLY"}</span>
        <Link href={`/character/${character.id}#inventory`}>เปิดคลัง</Link>
      </div>
    </div>
  );
}
