"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import PetInventory from "./PetInventory";
import styles from "./PetPhase2.module.css";

type LifecycleMode = "release" | "delete" | null;

type PetPhase2Record = {
  id: string;
  name: string;
  status: string;
  inventory_capacity: number;
  equipment_slots: Record<string, boolean> | null;
  release_note: string;
  released_at: string | null;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(
      (error as { message?: unknown }).message ?? "เกิดข้อผิดพลาด"
    );
  }
  return "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
}

function emitSound(kind: "success" | "warning" | "open" | "click") {
  window.dispatchEvent(
    new CustomEvent("karos-ui-sound", {
      detail: { kind },
    })
  );
}

export default function PetPhase2({
  petId,
  petName,
  petStatus,
  characterId,
  characterName,
  isOwner,
  isDm,
  onMessage,
  onChanged,
}: {
  petId: string;
  petName: string;
  petStatus: string;
  characterId: string;
  characterName: string;
  isOwner: boolean;
  isDm: boolean;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [pet, setPet] = useState<PetPhase2Record>({
    id: petId,
    name: petName,
    status: petStatus,
    inventory_capacity: 0,
    equipment_slots: null,
    release_note: "",
    released_at: null,
  });
  const [itemCount, setItemCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<LifecycleMode>(null);
  const [confirmationName, setConfirmationName] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [petResult, countResult] = await Promise.all([
      supabase
        .from("pets")
        .select(
          "id,name,status,inventory_capacity,equipment_slots,release_note,released_at"
        )
        .eq("id", petId)
        .single(),
      supabase
        .from("pet_inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("pet_id", petId),
    ]);

    if (petResult.error) {
      onMessage(petResult.error.message);
      setLoading(false);
      return;
    }

    if (countResult.error) {
      onMessage(countResult.error.message);
    }

    setPet(petResult.data as PetPhase2Record);
    setItemCount(Number(countResult.count ?? 0));
    setLoading(false);
  }, [onMessage, petId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPet((current) => ({
      ...current,
      id: petId,
      name: petName,
      status: petStatus,
    }));
    setMode(null);
    setConfirmationName("");
    setNote("");
  }, [petId, petName, petStatus]);

  function openModal(nextMode: Exclude<LifecycleMode, null>) {
    setMode(nextMode);
    setConfirmationName("");
    setNote("");
    emitSound("open");
  }

  function closeModal() {
    if (busy) return;
    setMode(null);
    setConfirmationName("");
    setNote("");
  }

  async function refreshAll(message: string) {
    emitSound("success");
    onMessage(message);
    setMode(null);
    setConfirmationName("");
    setNote("");
    await load();
    await onChanged();
  }

  async function releasePet() {
    if (!isOwner || busy || confirmationName !== pet.name) return;
    setBusy(true);
    onMessage("");

    try {
      const { error } = await getSupabase().rpc("release_pet", {
        target_pet: pet.id,
        confirmation_name: confirmationName,
        note: note.trim(),
      });
      if (error) throw error;
      await refreshAll(`ปล่อย ${pet.name} แล้ว ข้อมูลถูกเก็บไว้ให้ DM กู้คืนได้`);
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function restorePet() {
    if (!isDm || busy) return;
    setBusy(true);
    onMessage("");

    try {
      const { error } = await getSupabase().rpc("restore_released_pet", {
        target_pet: pet.id,
        note: "กู้คืนสัตว์เลี้ยงโดย DM",
      });
      if (error) throw error;
      await refreshAll(`กู้คืน ${pet.name} และเปลี่ยนกลับเป็นสถานะอนุมัติแล้ว`);
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function deletePetPermanently() {
    if (!isDm || busy || confirmationName !== pet.name) return;
    setBusy(true);
    onMessage("");

    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("delete_pet_permanently", {
        target_pet: pet.id,
        confirmation_name: confirmationName,
      });
      if (error) throw error;

      const imagePaths = Array.isArray(data)
        ? data.filter((path): path is string => typeof path === "string")
        : [];

      let cleanupWarning = "";
      if (imagePaths.length) {
        const { error: storageError } = await supabase.storage
          .from("pet-images")
          .remove(imagePaths);

        if (storageError) {
          cleanupWarning = storageError.message;
        } else {
          const { error: cleanupError } = await supabase.rpc(
            "complete_pet_image_cleanup",
            { object_names: imagePaths }
          );
          if (cleanupError) cleanupWarning = cleanupError.message;
        }
      }

      emitSound("warning");
      onMessage(
        cleanupWarning
          ? `ลบ ${pet.name} จากระบบแล้ว แต่การล้างไฟล์รูปยังไม่สมบูรณ์: ${cleanupWarning}`
          : `ลบ ${pet.name} ถาวรเรียบร้อยแล้ว`
      );
      setMode(null);
      await onChanged();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const canRelease =
    isOwner &&
    (pet.status === "approved" || pet.status === "suspended") &&
    itemCount === 0;
  const canRestore = isDm && pet.status === "released";
  const canDelete =
    isDm &&
    (pet.status === "released" || pet.status === "rejected") &&
    itemCount === 0;
  const showInventory =
    pet.status === "approved" || pet.status === "suspended";

  if (loading) {
    return (
      <section className={styles.phasePanel}>
        <p>กำลังตรวจข้อมูล Phase 2…</p>
      </section>
    );
  }

  return (
    <>
      <section className={styles.lifecyclePanel}>
        <header>
          <div>
            <small>PET LIFECYCLE</small>
            <h3>ปล่อย กู้คืน และลบสัตว์เลี้ยง</h3>
            <p>
              การปล่อยจะเก็บข้อมูลเดิมไว้ ส่วนการลบถาวรทำได้เฉพาะ DM
            </p>
          </div>
          <span>{itemCount} กองไอเทม</span>
        </header>

        {pet.status === "released" ? (
          <div className={styles.releasedNotice}>
            <strong>สัตว์เลี้ยงตัวนี้ถูกปล่อยแล้ว</strong>
            <p>{pet.release_note || "ไม่ได้ระบุเหตุผล"}</p>
            {pet.released_at ? (
              <small>
                เวลา {new Date(pet.released_at).toLocaleString("th-TH")}
              </small>
            ) : null}
          </div>
        ) : null}

        <div className={styles.lifecycleActions}>
          {isOwner &&
          (pet.status === "approved" || pet.status === "suspended") ? (
            <button
              type="button"
              className={styles.releaseButton}
              disabled={!canRelease || busy}
              onClick={() => openModal("release")}
            >
              ปล่อยสัตว์เลี้ยง
            </button>
          ) : null}

          {canRestore ? (
            <button type="button" disabled={busy} onClick={restorePet}>
              กู้คืนสัตว์เลี้ยง
            </button>
          ) : null}

          {isDm &&
          (pet.status === "released" || pet.status === "rejected") ? (
            <button
              type="button"
              className={styles.deleteButton}
              disabled={!canDelete || busy}
              onClick={() => openModal("delete")}
            >
              ลบถาวร
            </button>
          ) : null}
        </div>

        {itemCount > 0 ? (
          <p className={styles.inventoryBlockWarning}>
            ต้องย้ายไอเทมและถอดอุปกรณ์ออกจากสัตว์เลี้ยงให้หมดก่อนจึงจะปล่อยหรือ
            ลบได้
          </p>
        ) : null}
      </section>

      {showInventory ? (
        <PetInventory
          pet={pet}
          character={{ id: characterId, name: characterName }}
          isOwner={isOwner}
          isDm={isDm}
          onMessage={onMessage}
          onPetChanged={async () => {
            await load();
            await onChanged();
          }}
        />
      ) : (
        <section className={styles.closedInventory}>
          <strong>กระเป๋าสัตว์เลี้ยงถูกปิดในสถานะนี้</strong>
          <p>
            กู้คืนหรืออนุมัติสัตว์เลี้ยงก่อนจึงจะเปิดใช้อุปกรณ์และย้ายไอเทมได้
          </p>
        </section>
      )}

      {mode ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={
            mode === "release" ? "ยืนยันการปล่อยสัตว์เลี้ยง" : "ยืนยันการลบถาวร"
          }
          onPointerDown={(event) => {
            if (!busy && event.target === event.currentTarget) closeModal();
          }}
        >
          <section className={styles.confirmModal}>
            <header>
              <div>
                <small>{mode === "release" ? "RELEASE PET" : "PERMANENT DELETE"}</small>
                <h3>
                  {mode === "release"
                    ? `ปล่อย ${pet.name}`
                    : `ลบ ${pet.name} ถาวร`}
                </h3>
              </div>
              <button type="button" disabled={busy} onClick={closeModal}>
                ×
              </button>
            </header>

            <div className={styles.confirmBody}>
              {mode === "release" ? (
                <>
                  <p>
                    สัตว์เลี้ยงจะไม่กินจำนวนช่อง ไม่สามารถเรียกใช้หรือเพิ่ม
                    ความสัมพันธ์ได้ แต่ข้อมูล ร่าง สกิล และประวัติยังคงอยู่
                  </p>
                  <label>
                    <span>ข้อความอำลาหรือเหตุผล</span>
                    <textarea
                      rows={3}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="ไม่บังคับ"
                    />
                  </label>
                </>
              ) : (
                <p className={styles.permanentWarning}>
                  การลบถาวรไม่สามารถกู้คืนได้ ตาราง ร่าง สกิล ประวัติ
                  ความสัมพันธ์ และรูปสัตว์เลี้ยงจะถูกลบ
                </p>
              )}

              <label>
                <span>
                  พิมพ์ชื่อ <b>{pet.name}</b> เพื่อยืนยัน
                </span>
                <input
                  value={confirmationName}
                  onChange={(event) =>
                    setConfirmationName(event.target.value)
                  }
                  autoComplete="off"
                />
              </label>
            </div>

            <footer>
              <button type="button" disabled={busy} onClick={closeModal}>
                ยกเลิก
              </button>
              <button
                type="button"
                className={
                  mode === "release"
                    ? styles.releaseButton
                    : styles.deleteButton
                }
                disabled={busy || confirmationName !== pet.name}
                onClick={
                  mode === "release" ? releasePet : deletePetPermanently
                }
              >
                {busy
                  ? "กำลังดำเนินการ…"
                  : mode === "release"
                    ? "ยืนยันการปล่อย"
                    : "ยืนยันการลบถาวร"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
