"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import styles from "./GodGiftSystem.module.css";

type InventoryCategory = "food" | "weapon" | "equipment" | "item";
type AllowedEquipmentSlot =
  | "head"
  | "neck"
  | "chest"
  | "ring"
  | "legs"
  | "feet"
  | "hand";

type VaultItem = {
  id: string;
  name: string;
  description: string;
  image_path: string;
  original_filename: string | null;
  mime_type: string | null;
  category_ids: string[];
  signed_url?: string;
};

type VaultCategory = {
  id: string;
  name: string;
};

type CharacterOption = {
  id: string;
  name: string;
  portrait_url: string | null;
  capacity: number;
  used_slots: number;
};

type GiftHistory = {
  id: string;
  character_id: string;
  item_name: string;
  quantity: number;
  notify_player: boolean;
  created_at: string;
};

type GiftNotification = {
  id: string;
  recipient_character_id: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

type Progress = {
  current: number;
  total: number;
  success: number;
  failed: number;
  current_name: string;
};

const CATEGORY_OPTIONS: Array<{ value: InventoryCategory; label: string }> = [
  { value: "item", label: "ไอเทมทั่วไป" },
  { value: "weapon", label: "อาวุธ" },
  { value: "equipment", label: "เครื่องสวมใส่" },
  { value: "food", label: "อาหาร" },
];

const EQUIPMENT_OPTIONS: Array<{
  value: AllowedEquipmentSlot;
  label: string;
}> = [
  { value: "head", label: "ศีรษะ" },
  { value: "neck", label: "ลำคอ" },
  { value: "chest", label: "ลำตัว" },
  { value: "ring", label: "แหวน" },
  { value: "legs", label: "ช่วงขา" },
  { value: "feet", label: "เท้า" },
  { value: "hand", label: "มือซ้ายหรือขวา" },
];

const EMPTY_PROGRESS: Progress = {
  current: 0,
  total: 0,
  success: 0,
  failed: 0,
  current_name: "",
};

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "ดำเนินการมอบของไม่สำเร็จ";
}

function extensionFrom(item: VaultItem) {
  const filenameExtension = item.original_filename
    ?.split(".")
    .pop()
    ?.toLowerCase();

  if (filenameExtension && /^[a-z0-9]{2,5}$/.test(filenameExtension)) {
    return filenameExtension;
  }

  if (item.mime_type === "image/png") return "png";
  if (item.mime_type === "image/webp") return "webp";
  if (item.mime_type === "image/gif") return "gif";
  return "jpg";
}

function inferInventoryCategory(names: string[]): InventoryCategory {
  const text = names.join(" ").toLocaleLowerCase("th-TH");
  if (text.includes("อาวุธ") || text.includes("ดาบ") || text.includes("ธนู")) {
    return "weapon";
  }
  if (
    text.includes("เกราะ") ||
    text.includes("เครื่องสวมใส่") ||
    text.includes("เครื่องประดับ")
  ) {
    return "equipment";
  }
  if (text.includes("อาหาร") || text.includes("เครื่องดื่ม")) return "food";
  return "item";
}

function defaultItemType(names: string[]) {
  return names.find(Boolean) || "ไอเทม";
}

export default function GodGiftSystem() {
  const pathname = usePathname();
  const { user } = useAuth(false);

  const campaignId = useMemo(
    () => pathname.match(/^\/campaign\/([^/?#]+)/)?.[1] ?? "",
    [pathname]
  );
  const characterId = useMemo(
    () => pathname.match(/^\/character\/([^/?#]+)/)?.[1] ?? "",
    [pathname]
  );

  const [isDm, setIsDm] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  const [items, setItems] = useState<VaultItem[]>([]);
  const [categories, setCategories] = useState<VaultCategory[]>([]);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [history, setHistory] = useState<GiftHistory[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const [targetCharacterId, setTargetCharacterId] = useState("");
  const [inventoryCategory, setInventoryCategory] =
    useState<InventoryCategory>("item");
  const [itemType, setItemType] = useState("ไอเทม");
  const [quantity, setQuantity] = useState(1);
  const [weight, setWeight] = useState("");
  const [allowedSlot, setAllowedSlot] =
    useState<AllowedEquipmentSlot | "">("");
  const [note, setNote] = useState("");
  const [preserveDescription, setPreserveDescription] = useState(true);
  const [notifyPlayer, setNotifyPlayer] = useState(true);
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [deliveryEffect, setDeliveryEffect] = useState<{
    count: number;
    recipient: string;
    silent: boolean;
  } | null>(null);

  const [giftToast, setGiftToast] = useState<GiftNotification | null>(null);
  const [giftQueue, setGiftQueue] = useState<GiftNotification[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const effectTimerRef = useRef<number | null>(null);
  const shownNotificationRef = useRef<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedSet.has(item.id)),
    [items, selectedSet]
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters]
  );

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("th-TH");
    if (!query) return items;
    return items.filter((item) => {
      const categoryText = item.category_ids
        .map((id) => categoryById.get(id)?.name ?? "")
        .join(" ")
        .toLocaleLowerCase("th-TH");
      return (
        item.name.toLocaleLowerCase("th-TH").includes(query) ||
        item.description.toLocaleLowerCase("th-TH").includes(query) ||
        categoryText.includes(query)
      );
    });
  }, [categoryById, items, search]);

  const targetCharacter = characterById.get(targetCharacterId) ?? null;

  const enqueueGiftNotification = useCallback((notification: GiftNotification) => {
    if (shownNotificationRef.current === notification.id) return;
    setGiftQueue((current) =>
      current.some((entry) => entry.id === notification.id)
        ? current
        : [...current, notification]
    );
  }, []);

  useEffect(() => {
    if (giftToast || !giftQueue.length) return;
    const notification = giftQueue[0];
    shownNotificationRef.current = notification.id;
    setGiftQueue((current) => current.slice(1));
    setGiftToast(notification);

    getSupabase()
      .from("god_gift_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notification.id);

    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setGiftToast(null), 8500);
  }, [giftQueue, giftToast]);

  const loadGiftData = useCallback(async () => {
    if (!campaignId || !user) return;
    setLoading(true);
    setMessage("");
    const supabase = getSupabase();

    const [
      itemResult,
      categoryResult,
      linkResult,
      characterResult,
      inventoryResult,
      inventoryItemResult,
      historyResult,
    ] = await Promise.all([
      supabase
        .from("god_vault_items")
        .select(
          "id,name,description,image_path,original_filename,mime_type,created_at"
        )
        .eq("campaign_id", campaignId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("god_vault_categories")
        .select("id,name")
        .eq("campaign_id", campaignId)
        .order("name"),
      supabase.from("god_vault_item_categories").select("item_id,category_id"),
      supabase
        .from("characters")
        .select("id,name,portrait_url")
        .eq("campaign_id", campaignId)
        .order("name"),
      supabase
        .from("character_inventories")
        .select("character_id,capacity"),
      supabase.from("inventory_items").select("character_id,id"),
      supabase
        .from("god_vault_grants")
        .select("id,character_id,item_name,quantity,notify_player,created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    const firstError =
      itemResult.error ||
      categoryResult.error ||
      linkResult.error ||
      characterResult.error ||
      inventoryResult.error ||
      inventoryItemResult.error ||
      historyResult.error;

    if (firstError) {
      setMessage(firstError.message);
      setLoading(false);
      return;
    }

    const rawItems = itemResult.data ?? [];
    const itemIdSet = new Set(rawItems.map((item) => item.id));
    const categoriesByItem = new Map<string, string[]>();
    for (const link of linkResult.data ?? []) {
      if (!itemIdSet.has(link.item_id)) continue;
      const current = categoriesByItem.get(link.item_id) ?? [];
      current.push(link.category_id);
      categoriesByItem.set(link.item_id, current);
    }

    const paths = rawItems.map((item) => item.image_path);
    const signedMap = new Map<string, string>();
    if (paths.length) {
      const { data } = await supabase.storage
        .from("god-vault-assets")
        .createSignedUrls(paths, 3600);
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) signedMap.set(entry.path, entry.signedUrl);
      }
    }

    const capacityByCharacter = new Map(
      (inventoryResult.data ?? []).map((row) => [
        row.character_id,
        Number(row.capacity ?? 10),
      ])
    );
    const usedByCharacter = new Map<string, number>();
    for (const row of inventoryItemResult.data ?? []) {
      usedByCharacter.set(
        row.character_id,
        (usedByCharacter.get(row.character_id) ?? 0) + 1
      );
    }

    const nextCharacters = (characterResult.data ?? []).map((character) => ({
      ...character,
      capacity: capacityByCharacter.get(character.id) ?? 10,
      used_slots: usedByCharacter.get(character.id) ?? 0,
    }));

    setCategories(categoryResult.data ?? []);
    setItems(
      rawItems.map((item) => ({
        ...item,
        category_ids: categoriesByItem.get(item.id) ?? [],
        signed_url: signedMap.get(item.image_path),
      }))
    );
    setCharacters(nextCharacters);
    setHistory((historyResult.data ?? []) as GiftHistory[]);
    setTargetCharacterId((current) =>
      current && nextCharacters.some((entry) => entry.id === current)
        ? current
        : nextCharacters[0]?.id ?? ""
    );
    setSelectedIds((current) =>
      current.filter((id) => rawItems.some((item) => item.id === id))
    );
    setLoading(false);
  }, [campaignId, user]);

  useEffect(() => {
    let cancelled = false;
    async function checkDm() {
      setIsDm(false);
      if (!campaignId || !user) return;
      const { data, error } = await getSupabase().rpc("is_campaign_dm", {
        target_campaign: campaignId,
      });
      if (!cancelled && !error) setIsDm(Boolean(data));
    }
    checkDm();
    return () => {
      cancelled = true;
    };
  }, [campaignId, user]);

  useEffect(() => {
    if (!open || !isDm) return;
    loadGiftData();
  }, [isDm, loadGiftData, open]);

  useEffect(() => {
    if (selectedItems.length !== 1) return;
    const categoryNames = selectedItems[0].category_ids
      .map((id) => categoryById.get(id)?.name ?? "")
      .filter(Boolean);
    const inferred = inferInventoryCategory(categoryNames);
    setInventoryCategory(inferred);
    setItemType(defaultItemType(categoryNames));
    setAllowedSlot(inferred === "weapon" ? "hand" : "");
  }, [categoryById, selectedItems]);

  useEffect(() => {
    if (!characterId || !user) return;
    let active = true;
    const supabase = getSupabase();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function startNotificationListener() {
      const { data: character, error } = await supabase
        .from("characters")
        .select("owner_id")
        .eq("id", characterId)
        .maybeSingle();

      if (!active || error || character?.owner_id !== user.id) return;

      const { data: unread } = await supabase
        .from("god_gift_notifications")
        .select("*")
        .eq("recipient_character_id", characterId)
        .is("read_at", null)
        .order("created_at", { ascending: true })
        .limit(10);

      if (active) {
        for (const notification of (unread ?? []) as GiftNotification[]) {
          enqueueGiftNotification(notification);
        }
      }

      channel = supabase
        .channel(`god-gifts-${characterId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "god_gift_notifications",
            filter: `recipient_character_id=eq.${characterId}`,
          },
          (payload) => enqueueGiftNotification(payload.new as GiftNotification)
        )
        .subscribe();
    }

    startNotificationListener();
    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [characterId, enqueueGiftNotification, user]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (effectTimerRef.current) window.clearTimeout(effectTimerRef.current);
    };
  }, []);

  function toggleItem(itemId: string) {
    setSelectedIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
    );
  }

  function selectVisible() {
    const visibleIds = visibleItems.map((item) => item.id);
    const allSelected = visibleIds.every((id) => selectedSet.has(id));
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds]))
    );
  }

  async function copyVaultImage(
    item: VaultItem,
    targetId: string,
    inventoryItemId: string
  ) {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage
      .from("god-vault-assets")
      .createSignedUrl(item.image_path, 120);
    if (error || !data?.signedUrl) {
      throw error ?? new Error("ไม่สามารถอ่านรูปจากคลังพระเจ้าได้");
    }

    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error(`อ่านรูปไม่สำเร็จ (${response.status})`);
    const blob = await response.blob();
    const destination = `${targetId}/${inventoryItemId}/${crypto.randomUUID()}.${extensionFrom(
      item
    )}`;

    const { error: uploadError } = await supabase.storage
      .from("inventory-item-images")
      .upload(destination, blob, {
        cacheControl: "3600",
        contentType: item.mime_type || blob.type || "image/jpeg",
        upsert: false,
      });
    if (uploadError) throw uploadError;
    return destination;
  }

  async function sendGifts() {
    if (!user || !targetCharacter || !selectedItems.length) {
      setMessage("กรุณาเลือกตัวละครผู้รับและของอย่างน้อย 1 รายการ");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setMessage("จำนวนต่อรายการต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
      return;
    }
    if (
      (inventoryCategory === "weapon" || inventoryCategory === "equipment") &&
      !allowedSlot
    ) {
      setMessage("กรุณาเลือกตำแหน่งที่สามารถสวมใส่ได้");
      return;
    }

    const freeSlots = targetCharacter.capacity - targetCharacter.used_slots;
    if (freeSlots < selectedItems.length) {
      setMessage(
        `คลังของ ${targetCharacter.name} เหลือ ${freeSlots} ช่อง แต่เลือกของไว้ ${selectedItems.length} รายการ`
      );
      return;
    }

    const confirmed = window.confirm(
      `มอบของ ${selectedItems.length} รายการให้ “${targetCharacter.name}” ใช่ไหม?\n\n${
        notifyPlayer
          ? "ผู้เล่นจะได้รับการแจ้งเตือน “ของขวัญจากพระเจ้า”"
          : "มอบแบบเงียบ ผู้เล่นจะไม่เห็นการแจ้งเตือน"
      }`
    );
    if (!confirmed) return;

    setSending(true);
    setMessage("");
    setProgress({
      current: 0,
      total: selectedItems.length,
      success: 0,
      failed: 0,
      current_name: "เตรียมของขวัญ…",
    });

    const supabase = getSupabase();
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let index = 0; index < selectedItems.length; index += 1) {
      const item = selectedItems[index];
      const inventoryItemId = crypto.randomUUID();
      let copiedImagePath = "";
      setProgress((current) => ({
        ...current,
        current: index,
        success,
        failed,
        current_name: item.name,
      }));

      try {
        copiedImagePath = await copyVaultImage(
          item,
          targetCharacter.id,
          inventoryItemId
        );

        const descriptionParts: string[] = [];
        if (preserveDescription && item.description.trim()) {
          descriptionParts.push(item.description.trim());
        }
        if (weight.trim()) descriptionParts.push(`น้ำหนัก: ${weight.trim()} กก.`);
        if (note.trim()) descriptionParts.push(`ข้อความจากพระเจ้า: ${note.trim()}`);

        const { error } = await supabase.rpc("grant_god_vault_gift", {
          target_campaign: campaignId,
          target_vault_item: item.id,
          target_character: targetCharacter.id,
          target_inventory_item: inventoryItemId,
          gift_name: item.name,
          gift_item_type: itemType.trim() || "ไอเทม",
          gift_category: inventoryCategory,
          gift_quantity: quantity,
          gift_description: descriptionParts.join("\n\n"),
          gift_image_path: copiedImagePath,
          gift_allowed_equipment_slot:
            inventoryCategory === "weapon" || inventoryCategory === "equipment"
              ? allowedSlot
              : null,
          gift_note: note.trim(),
          show_notification: notifyPlayer,
        });
        if (error) throw error;
        success += 1;
      } catch (error) {
        failed += 1;
        errors.push(`${item.name}: ${errorText(error)}`);
        if (copiedImagePath) {
          await supabase.storage
            .from("inventory-item-images")
            .remove([copiedImagePath]);
        }
      }

      setProgress({
        current: index + 1,
        total: selectedItems.length,
        success,
        failed,
        current_name: item.name,
      });
    }

    setSending(false);
    if (success > 0) {
      setDeliveryEffect({
        count: success,
        recipient: targetCharacter.name,
        silent: !notifyPlayer,
      });
      if (effectTimerRef.current) window.clearTimeout(effectTimerRef.current);
      effectTimerRef.current = window.setTimeout(
        () => setDeliveryEffect(null),
        3300
      );
    }

    setMessage(
      failed
        ? `มอบสำเร็จ ${success}/${selectedItems.length} รายการ — ${errors
            .slice(0, 2)
            .join(" | ")}`
        : `มอบของขวัญ ${success} รายการให้ ${targetCharacter.name} เรียบร้อยแล้ว`
    );
    setSelectedIds([]);
    await loadGiftData();
  }

  return (
    <>
      {campaignId && isDm ? (
        <button
          type="button"
          className={styles.launcher}
          onClick={() => setOpen(true)}
          aria-label="มอบของจากคลังพระเจ้า"
        >
          <span>✦</span>
          <div>
            <small>DIVINE GIFT</small>
            <strong>มอบของจากคลังพระเจ้า</strong>
          </div>
        </button>
      ) : null}

      {open && campaignId && isDm ? (
        <div
          className={styles.overlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !sending) setOpen(false);
          }}
        >
          <section className={styles.modal} role="dialog" aria-modal="true">
            <div className={styles.modalAura} />
            <header className={styles.header}>
              <div>
                <p>Divine Gift Distribution</p>
                <h2>✦ ของขวัญจากพระเจ้า</h2>
                <span>
                  เลือกของจากคลังพระเจ้า แล้วส่งสำเนาเข้าคลังของตัวละคร
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                aria-label="ปิด"
              >
                ×
              </button>
            </header>

            {message ? <p className={styles.message}>{message}</p> : null}

            <div className={styles.layout}>
              <section className={styles.libraryPane}>
                <div className={styles.libraryToolbar}>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ค้นหาของในคลังพระเจ้า…"
                  />
                  <button type="button" onClick={selectVisible}>
                    เลือก/ยกเลิกทั้งหมดที่เห็น
                  </button>
                  <button type="button" onClick={() => setSelectedIds([])}>
                    ล้างการเลือก
                  </button>
                </div>

                <div className={styles.selectionSummary}>
                  <strong>เลือกแล้ว {selectedItems.length} รายการ</strong>
                  <span>ต้นฉบับในคลังพระเจ้าจะไม่หายไป</span>
                </div>

                {loading ? (
                  <div className={styles.empty}>กำลังเปิดคลังพระเจ้า…</div>
                ) : visibleItems.length ? (
                  <div className={styles.itemGrid}>
                    {visibleItems.map((item) => {
                      const selected = selectedSet.has(item.id);
                      const itemCategories = item.category_ids
                        .map((id) => categoryById.get(id)?.name)
                        .filter(Boolean);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`${styles.itemCard} ${
                            selected ? styles.itemSelected : ""
                          }`}
                          onClick={() => toggleItem(item.id)}
                        >
                          <div>
                            {item.signed_url ? (
                              <img src={item.signed_url} alt={item.name} />
                            ) : (
                              <span>◆</span>
                            )}
                            <i>{selected ? "✓" : ""}</i>
                          </div>
                          <strong>{item.name}</strong>
                          <small>{itemCategories.join(" · ") || "ไม่มีหมวดหมู่"}</small>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.empty}>ไม่พบของในคลังพระเจ้า</div>
                )}
              </section>

              <aside className={styles.controlPane}>
                <div className={styles.controlHeading}>
                  <p>Recipient &amp; Rules</p>
                  <h3>ตั้งค่าของขวัญ</h3>
                </div>

                <label>
                  ตัวละครผู้รับ
                  <select
                    value={targetCharacterId}
                    onChange={(event) => setTargetCharacterId(event.target.value)}
                    disabled={sending}
                  >
                    <option value="">— เลือกตัวละคร —</option>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name} ({character.used_slots}/{character.capacity})
                      </option>
                    ))}
                  </select>
                </label>

                {targetCharacter ? (
                  <article className={styles.recipientCard}>
                    <div>
                      {targetCharacter.portrait_url ? (
                        <img
                          src={targetCharacter.portrait_url}
                          alt={targetCharacter.name}
                        />
                      ) : (
                        <span>{targetCharacter.name.slice(0, 1)}</span>
                      )}
                    </div>
                    <section>
                      <strong>{targetCharacter.name}</strong>
                      <small>
                        ช่องเก็บของ {targetCharacter.used_slots}/
                        {targetCharacter.capacity}
                      </small>
                    </section>
                  </article>
                ) : null}

                <div className={styles.formGrid}>
                  <label>
                    ประเภทในคลังผู้เล่น
                    <select
                      value={inventoryCategory}
                      onChange={(event) => {
                        const next = event.target.value as InventoryCategory;
                        setInventoryCategory(next);
                        if (next === "weapon") setAllowedSlot("hand");
                        else if (next !== "equipment") setAllowedSlot("");
                      }}
                      disabled={sending}
                    >
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    ชนิดของไอเทม
                    <input
                      value={itemType}
                      onChange={(event) => setItemType(event.target.value)}
                      placeholder="เช่น ดาบ โพชั่น วัตถุดิบ"
                      disabled={sending}
                    />
                  </label>

                  <label>
                    จำนวนต่อรายการ
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={quantity}
                      onChange={(event) =>
                        setQuantity(Math.max(1, Number(event.target.value) || 1))
                      }
                      disabled={sending}
                    />
                  </label>

                  <label>
                    น้ำหนักต่อชิ้น (กก.)
                    <input
                      value={weight}
                      onChange={(event) => setWeight(event.target.value)}
                      placeholder="ไม่บังคับ"
                      disabled={sending}
                    />
                  </label>
                </div>

                {inventoryCategory === "weapon" ||
                inventoryCategory === "equipment" ? (
                  <label>
                    ตำแหน่งที่สามารถสวมใส่
                    <select
                      value={allowedSlot}
                      onChange={(event) =>
                        setAllowedSlot(
                          event.target.value as AllowedEquipmentSlot | ""
                        )
                      }
                      disabled={sending}
                    >
                      <option value="">— เลือกตำแหน่ง —</option>
                      {EQUIPMENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label>
                  ข้อความจากพระเจ้า
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="ข้อความนี้จะถูกบันทึกในคำอธิบายของไอเทม"
                    disabled={sending}
                  />
                </label>

                <label className={styles.checkLine}>
                  <input
                    type="checkbox"
                    checked={preserveDescription}
                    onChange={(event) =>
                      setPreserveDescription(event.target.checked)
                    }
                    disabled={sending}
                  />
                  <span>คงคำอธิบายต้นฉบับจากคลังพระเจ้า</span>
                </label>

                <label
                  className={`${styles.notificationChoice} ${
                    notifyPlayer ? styles.notificationOn : styles.notificationOff
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={notifyPlayer}
                    onChange={(event) => setNotifyPlayer(event.target.checked)}
                    disabled={sending}
                  />
                  <div>
                    <strong>
                      {notifyPlayer
                        ? "เปิดการแจ้งเตือนให้ผู้เล่นเห็น"
                        : "มอบแบบเงียบ ไม่แจ้งผู้เล่น"}
                    </strong>
                    <span>
                      {notifyPlayer
                        ? "ผู้รับจะเห็นข้อความ “ของขวัญจากพระเจ้า” พร้อม Motion"
                        : "ของจะเข้าคลังทันที แต่ไม่มีหน้าต่างแจ้งเตือน"}
                    </span>
                  </div>
                </label>

                {sending ? (
                  <div className={styles.progressBox}>
                    <div>
                      <span>{progress.current_name}</span>
                      <strong>
                        {progress.current}/{progress.total}
                      </strong>
                    </div>
                    <div>
                      <i
                        style={{
                          width: `${
                            progress.total
                              ? (progress.current / progress.total) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <small>
                      สำเร็จ {progress.success} · ผิดพลาด {progress.failed}
                    </small>
                  </div>
                ) : null}

                <button
                  type="button"
                  className={styles.sendButton}
                  disabled={
                    sending || !targetCharacterId || selectedItems.length === 0
                  }
                  onClick={sendGifts}
                >
                  {sending
                    ? "กำลังประทานของขวัญ…"
                    : `✦ มอบของขวัญ ${selectedItems.length} รายการ`}
                </button>
              </aside>
            </div>

            <section className={styles.historyPane}>
              <div>
                <p>Recent Divine Gifts</p>
                <h3>ประวัติการมอบล่าสุด</h3>
              </div>
              <div className={styles.historyList}>
                {history.length ? (
                  history.map((entry) => {
                    const character = characterById.get(entry.character_id);
                    return (
                      <article key={entry.id}>
                        <span>✦</span>
                        <div>
                          <strong>{entry.item_name}</strong>
                          <small>
                            ให้ {character?.name || "ตัวละครที่ถูกลบ"} ×
                            {entry.quantity}
                          </small>
                        </div>
                        <b className={entry.notify_player ? "" : styles.silentTag}>
                          {entry.notify_player ? "แจ้งผู้เล่น" : "มอบแบบเงียบ"}
                        </b>
                        <time>
                          {new Date(entry.created_at).toLocaleString("th-TH")}
                        </time>
                      </article>
                    );
                  })
                ) : (
                  <p className={styles.emptyHistory}>ยังไม่มีประวัติการมอบของ</p>
                )}
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {giftToast ? (
        <aside className={styles.giftToast} role="status" aria-live="assertive">
          <div className={styles.toastRays} />
          <div className={styles.toastIcon}>✦</div>
          <div className={styles.toastText}>
            <small>DIVINE BESTOWAL</small>
            <strong>{giftToast.title || "ของขวัญจากพระเจ้า"}</strong>
            <p>{giftToast.body}</p>
          </div>
          <button type="button" onClick={() => setGiftToast(null)}>
            ×
          </button>
          <div className={styles.toastParticles} aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <i key={index} style={{ "--gift-particle": index } as React.CSSProperties} />
            ))}
          </div>
        </aside>
      ) : null}

      {deliveryEffect ? (
        <div className={styles.deliveryScene} aria-hidden="true">
          <div className={styles.deliveryBackdrop} />
          <div className={styles.divineSeal}>
            <i>✦</i>
            <span>ของขวัญจากพระเจ้า</span>
            <strong>
              {deliveryEffect.count} รายการ → {deliveryEffect.recipient}
            </strong>
            <small>
              {deliveryEffect.silent
                ? "ประทานแบบเงียบ"
                : "ส่งสัญญาณแจ้งเตือนถึงผู้รับแล้ว"}
            </small>
          </div>
        </div>
      ) : null}
    </>
  );
}
