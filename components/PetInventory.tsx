"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import styles from "./PetInventory.module.css";

type InventoryCategory = "food" | "weapon" | "equipment" | "item";

type EquipmentSlot =
  | "head"
  | "neck"
  | "chest"
  | "ring"
  | "legs"
  | "feet"
  | "left_hand"
  | "right_hand";

type AllowedEquipmentSlot =
  | "head"
  | "neck"
  | "chest"
  | "ring"
  | "legs"
  | "feet"
  | "hand";

type EquipmentSlotSettings = Record<EquipmentSlot, boolean>;

type CharacterItem = {
  id: string;
  character_id: string;
  name: string;
  item_type: string;
  category: InventoryCategory;
  quantity: number;
  description: string;
  image_path: string | null;
  slot_index: number;
  allowed_equipment_slot: AllowedEquipmentSlot | null;
  equipment_slot: EquipmentSlot | null;
  equipped: boolean;
  created_at?: string;
};

type PetItem = Omit<CharacterItem, "character_id"> & {
  pet_id: string;
};

type PetInventoryPet = {
  id: string;
  name: string;
  status: string;
  inventory_capacity: number;
  equipment_slots: Partial<EquipmentSlotSettings> | null;
};

type PetInventoryCharacter = {
  id: string;
  name: string;
};

type SelectedItem =
  | { source: "character"; item: CharacterItem }
  | { source: "pet"; item: PetItem }
  | null;

const EQUIPMENT_SLOTS: Array<{
  key: EquipmentSlot;
  label: string;
  symbol: string;
}> = [
  { key: "head", label: "ศีรษะ", symbol: "♛" },
  { key: "neck", label: "ลำคอ", symbol: "◇" },
  { key: "chest", label: "ลำตัว", symbol: "♜" },
  { key: "ring", label: "เครื่องประดับ", symbol: "◈" },
  { key: "legs", label: "ช่วงขา", symbol: "♟" },
  { key: "feet", label: "เท้า", symbol: "⌁" },
  { key: "left_hand", label: "มือซ้าย", symbol: "L" },
  { key: "right_hand", label: "มือขวา", symbol: "R" },
];

const CATEGORY_OPTIONS: Array<{
  key: "all" | InventoryCategory;
  label: string;
}> = [
  { key: "all", label: "ทั้งหมด" },
  { key: "food", label: "อาหาร" },
  { key: "weapon", label: "อาวุธ" },
  { key: "equipment", label: "เครื่องสวมใส่" },
  { key: "item", label: "ไอเทม" },
];

const DEFAULT_EQUIPMENT_SLOTS: EquipmentSlotSettings = {
  head: true,
  neck: true,
  chest: true,
  ring: true,
  legs: true,
  feet: true,
  left_hand: true,
  right_hand: true,
};

function normalizeEquipmentSlots(
  value: Partial<EquipmentSlotSettings> | null | undefined
): EquipmentSlotSettings {
  return Object.fromEntries(
    EQUIPMENT_SLOTS.map(({ key }) => [
      key,
      typeof value?.[key] === "boolean"
        ? Boolean(value[key])
        : DEFAULT_EQUIPMENT_SLOTS[key],
    ])
  ) as EquipmentSlotSettings;
}

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

function categoryLabel(category: InventoryCategory) {
  return (
    CATEGORY_OPTIONS.find((option) => option.key === category)?.label ??
    "ไอเทม"
  );
}

function equipmentSlotLabel(slot: EquipmentSlot | null) {
  if (!slot) return "อยู่ในกระเป๋า";
  return EQUIPMENT_SLOTS.find((item) => item.key === slot)?.label ?? slot;
}

function allowedSlotLabel(slot: AllowedEquipmentSlot | null) {
  if (!slot) return "ใช้ไม่ได้";
  if (slot === "hand") return "มือซ้ายหรือมือขวา";
  return EQUIPMENT_SLOTS.find((item) => item.key === slot)?.label ?? slot;
}

function isCompatible(
  allowed: AllowedEquipmentSlot | null,
  target: EquipmentSlot
) {
  if (!allowed) return false;
  if (allowed === "hand") {
    return target === "left_hand" || target === "right_hand";
  }
  return allowed === target;
}

export default function PetInventory({
  pet,
  character,
  isOwner,
  isDm,
  onMessage,
  onPetChanged,
}: {
  pet: PetInventoryPet;
  character: PetInventoryCharacter;
  isOwner: boolean;
  isDm: boolean;
  onMessage: (message: string) => void;
  onPetChanged: () => Promise<void> | void;
}) {
  const [petItems, setPetItems] = useState<PetItem[]>([]);
  const [characterItems, setCharacterItems] = useState<CharacterItem[]>([]);
  const [characterCapacity, setCharacterCapacity] = useState(0);
  const [signedImages, setSignedImages] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<
    "all" | InventoryCategory
  >("all");
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [capacityDraft, setCapacityDraft] = useState(
    Number(pet.inventory_capacity ?? 0)
  );
  const [slotDraft, setSlotDraft] = useState<EquipmentSlotSettings>(() =>
    normalizeEquipmentSlots(pet.equipment_slots)
  );

  const equipmentSlots = useMemo(
    () => normalizeEquipmentSlots(pet.equipment_slots),
    [pet.equipment_slots]
  );

  const canTransfer =
    (isOwner || isDm) &&
    (pet.status === "approved" || pet.status === "suspended");
  const canConfigure = isDm;

  const load = useCallback(async () => {
    const supabase = getSupabase();

    const [petItemsResult, characterItemsResult, inventoryResult] =
      await Promise.all([
        supabase
          .from("pet_inventory_items")
          .select("*")
          .eq("pet_id", pet.id)
          .order("slot_index", { ascending: true })
          .order("id", { ascending: true }),
        supabase
          .from("inventory_items")
          .select("*")
          .eq("character_id", character.id)
          .order("slot_index", { ascending: true })
          .order("id", { ascending: true }),
        supabase
          .from("character_inventories")
          .select("capacity")
          .eq("character_id", character.id)
          .maybeSingle(),
      ]);

    const firstError =
      petItemsResult.error ??
      characterItemsResult.error ??
      inventoryResult.error;

    if (firstError) {
      onMessage(firstError.message);
      setLoading(false);
      return;
    }

    const nextPetItems = (petItemsResult.data ?? []) as PetItem[];
    const nextCharacterItems = (characterItemsResult.data ??
      []) as CharacterItem[];

    const paths = [
      ...new Set(
        [...nextPetItems, ...nextCharacterItems]
          .map((item) => item.image_path)
          .filter((path): path is string => Boolean(path))
      ),
    ];

    const imageEntries = await Promise.all(
      paths.map(async (path) => {
        const { data } = await supabase.storage
          .from("inventory-item-images")
          .createSignedUrl(path, 3600);
        return [path, data?.signedUrl ?? ""] as const;
      })
    );

    setPetItems(nextPetItems);
    setCharacterItems(nextCharacterItems);
    setCharacterCapacity(Number(inventoryResult.data?.capacity ?? 0));
    setSignedImages(
      Object.fromEntries(imageEntries.filter(([, url]) => Boolean(url)))
    );
    setLoading(false);
  }, [character.id, onMessage, pet.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setCapacityDraft(Number(pet.inventory_capacity ?? 0));
    setSlotDraft(normalizeEquipmentSlots(pet.equipment_slots));
  }, [pet.equipment_slots, pet.id, pet.inventory_capacity]);

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`pet-inventory-${pet.id}-${character.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pet_inventory_items",
          filter: `pet_id=eq.${pet.id}`,
        },
        () => void load()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_items",
          filter: `character_id=eq.${character.id}`,
        },
        () => void load()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [character.id, load, pet.id]);

  const petItemBySlot = useMemo(
    () =>
      new Map(
        petItems
          .filter(
            (item) =>
              activeCategory === "all" || item.category === activeCategory
          )
          .map((item) => [item.slot_index, item])
      ),
    [activeCategory, petItems]
  );

  const equippedBySlot = useMemo(
    () =>
      new Map(
        petItems
          .filter((item) => item.equipment_slot)
          .map((item) => [item.equipment_slot as EquipmentSlot, item])
      ),
    [petItems]
  );

  const filteredCharacterItems = useMemo(
    () =>
      activeCategory === "all"
        ? characterItems
        : characterItems.filter((item) => item.category === activeCategory),
    [activeCategory, characterItems]
  );

  const filteredPetItems = useMemo(
    () =>
      activeCategory === "all"
        ? petItems
        : petItems.filter((item) => item.category === activeCategory),
    [activeCategory, petItems]
  );

  async function runAction(
    action: () => Promise<{ error: { message: string } | null }>,
    successMessage: string
  ) {
    if (busy) return;
    setBusy(true);
    onMessage("");

    try {
      const result = await action();
      if (result.error) throw result.error;

      emitSound("success");
      onMessage(successMessage);
      setSelectedItem(null);
      await load();
      await onPetChanged();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function moveCharacterItemToPet(item: CharacterItem) {
    if (!canTransfer) return;

    await runAction(
      async () =>
        getSupabase().rpc("move_character_item_to_pet", {
          target_item: item.id,
          target_pet: pet.id,
          target_slot: null,
        }),
      `ย้าย ${item.name} ให้ ${pet.name} แล้ว`
    );
  }

  async function movePetItemToCharacter(item: PetItem) {
    if (!canTransfer) return;

    await runAction(
      async () =>
        getSupabase().rpc("move_pet_item_to_character", {
          target_item: item.id,
          target_slot: null,
        }),
      `ย้าย ${item.name} กลับไปยังช่องเก็บของผู้เล่นแล้ว`
    );
  }

  async function equipPetItem(item: PetItem, slot: EquipmentSlot) {
    if (!canTransfer || !equipmentSlots[slot]) return;

    await runAction(
      async () =>
        getSupabase().rpc("equip_pet_item", {
          target_item: item.id,
          target_slot: slot,
        }),
      `${pet.name} สวมใส่ ${item.name} แล้ว`
    );
  }

  async function unequipPetItem(item: PetItem) {
    if (!canTransfer) return;

    await runAction(
      async () =>
        getSupabase().rpc("unequip_pet_item", {
          target_item: item.id,
        }),
      `ถอด ${item.name} แล้ว`
    );
  }

  async function savePetInventorySettings() {
    if (!canConfigure || busy) return;

    const capacity = Math.trunc(capacityDraft);
    if (capacity < 0 || capacity > 500) {
      onMessage("จำนวนช่องสัตว์เลี้ยงต้องอยู่ระหว่าง 0 ถึง 500");
      return;
    }

    await runAction(
      async () =>
        getSupabase().rpc("configure_pet_inventory", {
          target_pet: pet.id,
          target_capacity: capacity,
          enabled_slots: slotDraft,
        }),
      "บันทึกจำนวนช่องและตำแหน่งอุปกรณ์แล้ว"
    );
  }

  function openItem(
    source: "character" | "pet",
    item: CharacterItem | PetItem
  ) {
    emitSound("open");
    setSelectedItem(
      source === "pet"
        ? { source, item: item as PetItem }
        : { source, item: item as CharacterItem }
    );
  }

  if (loading) {
    return (
      <section className={styles.inventoryPanel}>
        <div className={styles.loadingSeal}>✦</div>
        <p>กำลังเปิดกระเป๋าสัตว์เลี้ยง…</p>
      </section>
    );
  }

  return (
    <section className={styles.inventoryPanel}>
      <header className={styles.inventoryHeader}>
        <div>
          <small>PET INVENTORY & EQUIPMENT</small>
          <h3>อุปกรณ์และกระเป๋าของ {pet.name}</h3>
          <p>
            ย้ายไอเทมทั้งกองระหว่างผู้เล่นกับสัตว์เลี้ยง และเลือกอุปกรณ์ที่
            DM อนุญาต
          </p>
        </div>
        <div className={styles.capacityBadges}>
          <span>
            กระเป๋าสัตว์เลี้ยง {petItems.length}/{pet.inventory_capacity}
          </span>
          <span>
            กระเป๋าผู้เล่น {characterItems.length}/{characterCapacity}
          </span>
        </div>
      </header>

      {canConfigure ? (
        <section className={styles.dmSettings}>
          <div className={styles.settingsHeading}>
            <div>
              <small>DM CONTROL</small>
              <strong>โครงสร้างอุปกรณ์และจำนวนช่อง</strong>
            </div>
            <label>
              <span>จำนวนช่อง</span>
              <input
                type="number"
                min={0}
                max={500}
                value={capacityDraft}
                onChange={(event) =>
                  setCapacityDraft(Number(event.target.value))
                }
              />
            </label>
          </div>

          <div className={styles.slotToggles}>
            {EQUIPMENT_SLOTS.map((slot) => (
              <label key={slot.key}>
                <input
                  type="checkbox"
                  checked={slotDraft[slot.key]}
                  onChange={(event) =>
                    setSlotDraft((current) => ({
                      ...current,
                      [slot.key]: event.target.checked,
                    }))
                  }
                />
                <span>{slot.label}</span>
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={savePetInventorySettings}
          >
            บันทึกการตั้งค่ากระเป๋า
          </button>
        </section>
      ) : null}

      <nav className={styles.categoryTabs} aria-label="หมวดไอเทมสัตว์เลี้ยง">
        {CATEGORY_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.key}
            className={activeCategory === option.key ? styles.active : ""}
            onClick={() => setActiveCategory(option.key)}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <div className={styles.inventoryLayout}>
        <section className={styles.equipmentPane}>
          <div className={styles.sectionTitle}>
            <small>EQUIPMENT</small>
            <strong>อุปกรณ์ที่สวมใส่</strong>
          </div>

          <div className={styles.equipmentBoard}>
            <div className={styles.petSilhouette}>♞</div>

            {EQUIPMENT_SLOTS.map((slot) => {
              const item = equippedBySlot.get(slot.key);
              const enabled = equipmentSlots[slot.key];

              return (
                <button
                  type="button"
                  key={slot.key}
                  className={`${styles.equipmentSlot} ${
                    styles[`slot_${slot.key}`]
                  } ${!enabled ? styles.disabledSlot : ""}`}
                  disabled={!enabled}
                  onClick={() => {
                    if (item) openItem("pet", item);
                  }}
                >
                  <small>{slot.label}</small>
                  {item ? (
                    <>
                      <ItemImage
                        item={item}
                        signedImages={signedImages}
                        symbol={slot.symbol}
                      />
                      <strong>{item.name}</strong>
                    </>
                  ) : (
                    <>
                      <span>{enabled ? slot.symbol : "×"}</span>
                      <em>{enabled ? "ว่าง" : "ปิด"}</em>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.bagPane}>
          <div className={styles.sectionTitle}>
            <small>PET BAG</small>
            <strong>ของที่สัตว์เลี้ยงเก็บไว้</strong>
          </div>

          {pet.inventory_capacity > 0 ? (
            <div className={styles.bagGrid}>
              {Array.from(
                { length: Number(pet.inventory_capacity) },
                (_, slotIndex) => {
                  const item = petItemBySlot.get(slotIndex);

                  return (
                    <button
                      type="button"
                      key={slotIndex}
                      className={styles.bagSlot}
                      onClick={() => {
                        if (item) openItem("pet", item);
                      }}
                    >
                      <small>{slotIndex + 1}</small>
                      {item ? (
                        <>
                          <ItemImage
                            item={item}
                            signedImages={signedImages}
                            symbol="◆"
                          />
                          <strong>{item.name}</strong>
                          <b>×{item.quantity}</b>
                          {item.equipment_slot ? (
                            <em>กำลังสวมใส่</em>
                          ) : null}
                        </>
                      ) : (
                        <span>＋</span>
                      )}
                    </button>
                  );
                }
              )}
            </div>
          ) : (
            <div className={styles.emptyState}>
              DM ยังไม่ได้เปิดช่องเก็บของให้สัตว์เลี้ยงตัวนี้
            </div>
          )}

          <div className={styles.filteredSummary}>
            แสดง {filteredPetItems.length} กองในหมวดนี้
          </div>
        </section>
      </div>

      <section className={styles.characterTransferPane}>
        <div className={styles.sectionTitle}>
          <small>CHARACTER INVENTORY</small>
          <strong>ย้ายของจาก {character.name}</strong>
        </div>

        <p className={styles.transferNotice}>
          การย้ายใน Phase 2 จะย้ายทั้งกอง ไอเทมที่กำลังสวมกับผู้เล่นจะถูกถอด
          อัตโนมัติก่อนย้าย
        </p>

        <div className={styles.transferGrid}>
          {filteredCharacterItems.length ? (
            filteredCharacterItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={styles.transferCard}
                onClick={() => openItem("character", item)}
              >
                <ItemImage
                  item={item}
                  signedImages={signedImages}
                  symbol="◆"
                />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {categoryLabel(item.category)} · ×{item.quantity}
                  </small>
                </span>
                <b>ดู</b>
              </button>
            ))
          ) : (
            <div className={styles.emptyState}>
              ไม่มีไอเทมในหมวดนี้ในกระเป๋าผู้เล่น
            </div>
          )}
        </div>
      </section>

      {selectedItem ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={`รายละเอียด ${selectedItem.item.name}`}
          onPointerDown={(event) => {
            if (!busy && event.target === event.currentTarget) {
              setSelectedItem(null);
            }
          }}
        >
          <section className={styles.itemModal}>
            <header>
              <div>
                <small>
                  {selectedItem.source === "pet"
                    ? "PET ITEM"
                    : "CHARACTER ITEM"}
                </small>
                <h4>{selectedItem.item.name}</h4>
                <span>
                  {categoryLabel(selectedItem.item.category)} ·{" "}
                  {selectedItem.item.item_type || "ไม่ระบุชนิด"}
                </span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelectedItem(null)}
                aria-label="ปิดรายละเอียดไอเทม"
              >
                ×
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.modalArtwork}>
                <ItemImage
                  item={selectedItem.item}
                  signedImages={signedImages}
                  symbol="◆"
                />
              </div>

              <div className={styles.modalInfo}>
                <p>
                  {selectedItem.item.description || "ไม่มีคำอธิบายไอเทม"}
                </p>
                <dl>
                  <div>
                    <dt>จำนวน</dt>
                    <dd>{selectedItem.item.quantity}</dd>
                  </div>
                  <div>
                    <dt>ตำแหน่งที่ใช้ได้</dt>
                    <dd>
                      {allowedSlotLabel(
                        selectedItem.item.allowed_equipment_slot
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>สถานะ</dt>
                    <dd>
                      {equipmentSlotLabel(selectedItem.item.equipment_slot)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <footer className={styles.modalActions}>
              {selectedItem.source === "character" ? (
                <button
                  type="button"
                  disabled={!canTransfer || busy}
                  onClick={() => moveCharacterItemToPet(selectedItem.item)}
                >
                  ย้ายทั้งกองให้ {pet.name}
                </button>
              ) : (
                <>
                  {selectedItem.item.equipment_slot ? (
                    <button
                      type="button"
                      disabled={!canTransfer || busy}
                      onClick={() => unequipPetItem(selectedItem.item)}
                    >
                      ถอดอุปกรณ์
                    </button>
                  ) : null}

                  {EQUIPMENT_SLOTS.filter(
                    (slot) =>
                      equipmentSlots[slot.key] &&
                      isCompatible(
                        selectedItem.item.allowed_equipment_slot,
                        slot.key
                      )
                  ).map((slot) => (
                    <button
                      type="button"
                      key={slot.key}
                      disabled={!canTransfer || busy}
                      onClick={() =>
                        equipPetItem(selectedItem.item, slot.key)
                      }
                    >
                      สวมที่ {slot.label}
                    </button>
                  ))}

                  <button
                    type="button"
                    className={styles.returnButton}
                    disabled={!canTransfer || busy}
                    onClick={() =>
                      movePetItemToCharacter(selectedItem.item)
                    }
                  >
                    ย้ายทั้งกองกลับผู้เล่น
                  </button>
                </>
              )}
            </footer>

            {!canTransfer ? (
              <p className={styles.readOnlyNotice}>
                สัตว์เลี้ยงสถานะนี้เปิดดูได้อย่างเดียว ไม่สามารถย้ายหรือสวมใส่
                ไอเทมได้
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ItemImage({
  item,
  signedImages,
  symbol,
}: {
  item: CharacterItem | PetItem;
  signedImages: Record<string, string>;
  symbol: string;
}) {
  const url = item.image_path ? signedImages[item.image_path] : "";

  return (
    <span className={styles.itemImage}>
      {url ? <img src={url} alt="" /> : symbol}
    </span>
  );
}
