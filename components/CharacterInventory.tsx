"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type InventoryCategory = "food" | "weapon" | "equipment" | "item";
export type EquipmentSlot = "head" | "neck" | "chest" | "ring" | "legs" | "feet" | "left_hand" | "right_hand";
export type AllowedEquipmentSlot = "head" | "neck" | "chest" | "ring" | "legs" | "feet" | "hand";

export type InventoryItem = {
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
};

type InventoryCharacter = {
  id: string;
  name: string;
  portrait_url: string | null;
};

type ItemForm = {
  name: string;
  itemType: string;
  category: InventoryCategory;
  allowedEquipmentSlot: AllowedEquipmentSlot | "";
  quantity: number;
  description: string;
};

type DialogState =
  | { kind: "item"; itemId: string | null; slotIndex: number }
  | { kind: "equipment"; equipmentSlot: EquipmentSlot }
  | null;

const CATEGORY_OPTIONS: Array<{ key: "all" | InventoryCategory; label: string; symbol: string }> = [
  { key: "all", label: "ทั้งหมด", symbol: "✦" },
  { key: "food", label: "อาหาร", symbol: "♨" },
  { key: "weapon", label: "อาวุธ", symbol: "⚔" },
  { key: "equipment", label: "เครื่องสวมใส่", symbol: "♜" },
  { key: "item", label: "ไอเทม", symbol: "◆" },
];

const EQUIPMENT_SLOTS: Array<{ key: EquipmentSlot; label: string; shortLabel: string }> = [
  { key: "head", label: "หมวก", shortLabel: "ศีรษะ" },
  { key: "neck", label: "สร้อย", shortLabel: "ลำคอ" },
  { key: "chest", label: "เสื้อ / เกราะ", shortLabel: "ลำตัว" },
  { key: "ring", label: "แหวน", shortLabel: "นิ้วมือ" },
  { key: "legs", label: "กางเกง", shortLabel: "ช่วงขา" },
  { key: "feet", label: "รองเท้า", shortLabel: "เท้า" },
  { key: "left_hand", label: "มือซ้าย", shortLabel: "มือซ้าย" },
  { key: "right_hand", label: "มือขวา", shortLabel: "มือขวา" },
];

const ALLOWED_EQUIPMENT_SLOTS: Array<{ key: AllowedEquipmentSlot; label: string }> = [
  { key: "head", label: "หมวก · ศีรษะ" },
  { key: "neck", label: "สร้อย · ลำคอ" },
  { key: "chest", label: "เสื้อ / เกราะ · ลำตัว" },
  { key: "ring", label: "แหวน · นิ้วมือ" },
  { key: "legs", label: "กางเกง · ช่วงขา" },
  { key: "feet", label: "รองเท้า · เท้า" },
  { key: "hand", label: "อาวุธ · มือซ้ายหรือมือขวา" },
];

const EMPTY_FORM: ItemForm = {
  name: "",
  itemType: "",
  category: "item",
  allowedEquipmentSlot: "",
  quantity: 1,
  description: "",
};

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export default function CharacterInventory({
  character,
  items,
  capacity,
  canManage,
  canAddItems,
  databaseReady,
  onChanged,
  onMessage,
}: {
  character: InventoryCharacter;
  items: InventoryItem[];
  capacity: number;
  canManage: boolean;
  canAddItems: boolean;
  databaseReady: boolean;
  onChanged: () => Promise<void> | void;
  onMessage: (message: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<"all" | InventoryCategory>("all");
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [signedImages, setSignedImages] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [capacityDraft, setCapacityDraft] = useState(capacity);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canManageInventory = canManage && databaseReady;
  const canAdd = canAddItems && databaseReady;
  const canEquip = canAddItems && databaseReady;

  useEffect(() => setCapacityDraft(capacity), [capacity]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogState && !dialog.open) dialog.showModal();
    if (!dialogState && dialog.open) dialog.close();
  }, [dialogState]);

  useEffect(() => {
    let active = true;
    const paths = [...new Set(items.map((item) => item.image_path).filter((path): path is string => Boolean(path)))];
    if (!paths.length) {
      setSignedImages({});
      return () => { active = false; };
    }

    async function loadSignedImages() {
      const results = await Promise.all(paths.map(async (path) => {
        const { data } = await getSupabase().storage.from("inventory-item-images").createSignedUrl(path, 3600);
        return [path, data?.signedUrl ?? ""] as const;
      }));
      if (active) setSignedImages(Object.fromEntries(results.filter(([, url]) => Boolean(url))));
    }

    loadSignedImages();
    return () => { active = false; };
  }, [items]);

  const itemBySlot = useMemo(() => new Map(items.map((item) => [item.slot_index, item])), [items]);
  const equippedBySlot = useMemo(
    () => new Map(items.filter((item) => item.equipment_slot).map((item) => [item.equipment_slot as EquipmentSlot, item])),
    [items],
  );
  const isFull = items.length >= capacity;

  function closeDialog() {
    if (saving) return;
    setDialogState(null);
    setImageFile(null);
  }

  function openNewItem(slotIndex?: number) {
    if (!canAdd) return;
    const firstEmpty = slotIndex ?? Array.from({ length: capacity }, (_, index) => index).find((index) => !itemBySlot.has(index));
    if (firstEmpty === undefined) {
      onMessage("คลังไอเทมเต็มแล้ว กรุณาเพิ่มจำนวนช่องก่อน");
      return;
    }
    setForm(EMPTY_FORM);
    setImageFile(null);
    setDialogState({ kind: "item", itemId: null, slotIndex: firstEmpty });
  }

  function openItem(item: InventoryItem) {
    setForm({
      name: item.name,
      itemType: item.item_type ?? "",
      category: item.category ?? "item",
      allowedEquipmentSlot: item.allowed_equipment_slot ?? defaultAllowedSlot(item.category ?? "item"),
      quantity: item.quantity,
      description: item.description ?? "",
    });
    setImageFile(null);
    setDialogState({ kind: "item", itemId: item.id, slotIndex: item.slot_index });
  }

  function openEquipmentSlot(slot: EquipmentSlot) {
    const equipped = equippedBySlot.get(slot);
    if (equipped) openItem(equipped);
    else if (canEquip) setDialogState({ kind: "equipment", equipmentSlot: slot });
  }

  function validateImage(file: File) {
    if (!MIME_EXTENSIONS[file.type]) return "รองรับเฉพาะภาพ JPEG, PNG, WebP และ GIF";
    if (file.size > 5 * 1024 * 1024) return "ภาพต้องมีขนาดไม่เกิน 5 MB";
    return "";
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return setImageFile(null);
    const validationMessage = validateImage(file);
    if (validationMessage) {
      onMessage(validationMessage);
      event.target.value = "";
      return;
    }
    setImageFile(file);
  }

  async function uploadImageFile(itemId: string) {
    if (!imageFile) return null;
    const extension = MIME_EXTENSIONS[imageFile.type];
    const newPath = `${character.id}/${itemId}/${crypto.randomUUID()}.${extension}`;
    const storage = getSupabase().storage.from("inventory-item-images");
    const { error: uploadError } = await storage.upload(newPath, imageFile, {
      cacheControl: "3600",
      contentType: imageFile.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    return newPath;
  }

  async function replaceItemImage(itemId: string, oldPath: string | null) {
    const newPath = await uploadImageFile(itemId);
    if (!newPath) return null;
    const storage = getSupabase().storage.from("inventory-item-images");

    const { error: updateError } = await getSupabase()
      .from("inventory_items")
      .update({ image_path: newPath })
      .eq("id", itemId);
    if (updateError) {
      await storage.remove([newPath]);
      throw updateError;
    }
    if (oldPath) await storage.remove([oldPath]);
    return newPath;
  }

  async function saveItem() {
    if (!dialogState || dialogState.kind !== "item") return;
    const existing = dialogState.itemId ? items.find((item) => item.id === dialogState.itemId) : null;
    if ((existing && !canManageInventory) || (!existing && !canAdd)) return;
    const name = form.name.trim();
    if (!name) return onMessage("กรุณาใส่ชื่อไอเทม");
    if (!Number.isInteger(form.quantity) || form.quantity < 1 || form.quantity > 2147483647) return onMessage("จำนวนไอเทมต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
    if ((form.category === "weapon" || form.category === "equipment") && !form.allowedEquipmentSlot) return onMessage("กรุณาเลือกตำแหน่งที่ไอเทมนี้ใช้สวมใส่");

    setSaving(true);
    const supabase = getSupabase();
    const compatibleEquipmentSlot = existing?.equipment_slot && isCompatible(form.allowedEquipmentSlot || null, existing.equipment_slot)
      ? existing.equipment_slot
      : null;
    const payload = {
      name,
      item_type: form.itemType.trim() || categoryLabel(form.category),
      category: form.category,
      allowed_equipment_slot: form.category === "weapon" || form.category === "equipment" ? form.allowedEquipmentSlot : null,
      quantity: Number(form.quantity),
      description: form.description.trim(),
      equipment_slot: compatibleEquipmentSlot,
    };

    try {
      let itemId = existing?.id ?? "";
      if (existing) {
        const { error } = await supabase.from("inventory_items").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        itemId = crypto.randomUUID();
        let uploadedImagePath: string | null = null;
        try {
          uploadedImagePath = await uploadImageFile(itemId);
          const { error } = await supabase.from("inventory_items").insert({
            ...payload,
            id: itemId,
            character_id: character.id,
            image_path: uploadedImagePath,
            slot_index: dialogState.slotIndex,
          });
          if (error) throw error;
        } catch (error) {
          if (uploadedImagePath) {
            await supabase.storage.from("inventory-item-images").remove([uploadedImagePath]);
          }
          throw error;
        }
      }

      let imageWarning = "";
      if (existing) {
        try {
          await replaceItemImage(itemId, existing.image_path);
        } catch (error) {
          imageWarning = errorMessage(error);
        }
      }
      onMessage(imageWarning
        ? `บันทึกข้อมูลไอเทมแล้ว แต่บันทึกภาพไม่สำเร็จ: ${imageWarning}`
        : (existing ? "บันทึกไอเทมแล้ว" : "เพิ่มไอเทมเข้าคลังแล้ว"));
      setDialogState(null);
      setImageFile(null);
      await onChanged();
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(item: InventoryItem) {
    if (!canManageInventory || saving) return;
    if (!window.confirm(`ลบ “${item.name}” ออกจากคลังใช่หรือไม่?`)) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("inventory_items").delete().eq("id", item.id);
      if (error) throw error;
      if (item.image_path) await supabase.storage.from("inventory-item-images").remove([item.image_path]);
      onMessage("ลบไอเทมออกจากคลังแล้ว");
      setDialogState(null);
      await onChanged();
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function equipItem(item: InventoryItem, slot: EquipmentSlot) {
    if (!canEquip || saving) return;
    setSaving(true);
    try {
      const { error } = await getSupabase().rpc("equip_inventory_item", {
        target_item_id: item.id,
        target_slot: slot,
      });
      if (error) throw error;
      onMessage(`สวม ${item.name} ที่${equipmentLabel(slot)}แล้ว`);
      setDialogState(null);
      await onChanged();
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function unequipItem(item: InventoryItem) {
    if (!canEquip || saving) return;
    setSaving(true);
    try {
      const { error } = await getSupabase().rpc("unequip_inventory_item", { target_item_id: item.id });
      if (error) throw error;
      onMessage(`ถอด ${item.name} แล้ว`);
      setDialogState(null);
      await onChanged();
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveCapacity() {
    if (!canManageInventory || saving) return;
    const nextCapacity = Number(capacityDraft);
    if (!Number.isInteger(nextCapacity) || nextCapacity < 1 || nextCapacity > 200) {
      onMessage("จำนวนช่องต้องเป็นเลขระหว่าง 1 ถึง 200");
      return;
    }
    if (nextCapacity < items.length) {
      onMessage(`ยังมีไอเทม ${items.length} ชิ้น จึงลดคลังต่ำกว่าจำนวนไอเทมไม่ได้`);
      return;
    }
    setSaving(true);
    try {
      const { error } = await getSupabase().rpc("resize_character_inventory", {
        target_character_id: character.id,
        target_capacity: nextCapacity,
      });
      if (error) throw error;
      onMessage(`ปรับคลังเป็น ${nextCapacity} ช่องแล้ว`);
      await onChanged();
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const selectedItem = dialogState?.kind === "item" && dialogState.itemId
    ? items.find((item) => item.id === dialogState.itemId) ?? null
    : null;
  const equipmentPickerItems = dialogState?.kind === "equipment"
    ? items.filter((item) => isCompatible(item.allowed_equipment_slot, dialogState.equipmentSlot))
    : [];
  const hasUnsavedChanges = Boolean(selectedItem && (
    form.name.trim() !== selectedItem.name
    || form.itemType.trim() !== (selectedItem.item_type ?? "")
    || form.category !== selectedItem.category
    || (form.allowedEquipmentSlot || null) !== selectedItem.allowed_equipment_slot
    || form.quantity !== selectedItem.quantity
    || form.description.trim() !== (selectedItem.description ?? "")
    || imageFile
  ));
  const canEditItemForm = dialogState?.kind === "item"
    && (selectedItem ? canManageInventory : canAdd);

  return (
    <section className="inventoryPanel" id="inventory" aria-labelledby="inventory-title">
      <div className="inventoryHeader">
        <div>
          <p className="eyebrow">Adventurer Inventory</p>
          <h2 id="inventory-title">คลังสมบัติของ {character.name}</h2>
          <p>{canManage ? "โหมด Dungeon Master · จัดการคลังและอุปกรณ์ได้ทั้งหมด" : "โหมดผู้เล่น · เพิ่มไอเทมและสวมใส่ได้ · การแก้หรือลบให้ DM จัดการ"}</p>
        </div>
        {canAddItems ? <button className="button" type="button" onClick={() => openNewItem()} disabled={isFull || !canAdd}>＋ เพิ่มไอเทม</button> : null}
      </div>

      {!databaseReady ? (
        <p className="notice banner">ระบบฐานข้อมูลคลังไอเทมเวอร์ชันใหม่ยังไม่ถูกติดตั้ง จึงเปิดดูตัวอย่างได้แต่ยังบันทึกไม่ได้</p>
      ) : null}

      <div className="inventoryShell">
        <section className="equipmentPane" aria-label="อุปกรณ์สวมใส่">
          <div className="equipmentPaneTitle"><span>✦</span><div><small>Equipment</small><strong>ชุดสวมใส่</strong></div><span>✦</span></div>
          <div className="equipmentBoard">
            <div className="inventoryCharacterFigure" aria-label={`ภาพตัวละคร ${character.name}`}>
              {character.portrait_url ? <img src={character.portrait_url} alt={character.name} /> : <div className="characterSilhouette" aria-hidden="true"><span className="silhouetteHead" /><span className="silhouetteBody" /></div>}
              <div className="figureGlow" />
            </div>
            {EQUIPMENT_SLOTS.map((slot) => {
              const item = equippedBySlot.get(slot.key);
              return (
                <button
                  type="button"
                  className={`equipmentSlot ${item ? "occupied" : ""}`}
                  data-slot={slot.key}
                  key={slot.key}
                  onClick={() => openEquipmentSlot(slot.key)}
                  disabled={!item && !canEquip}
                  aria-label={`${slot.label}: ${item?.name ?? "ว่าง"}`}
                >
                  <small>{slot.label}</small>
                  <ItemArtwork item={item} signedImages={signedImages} compact />
                  <span>{item?.name ?? slot.shortLabel}</span>
                </button>
              );
            })}
          </div>
          <p className="equipmentHint">{canEquip ? "กดช่องว่างเพื่อเลือกของมาสวม · กดของที่สวมแล้วเพื่อดูหรือถอด" : "กดไอเทมเพื่อดูรายละเอียด"}</p>
        </section>

        <section className="bagPane" aria-label="ช่องเก็บของ">
          <div className="inventoryFilters" aria-label="หมวดหมู่ไอเทม">
            {CATEGORY_OPTIONS.map((category) => (
              <button
                type="button"
                key={category.key}
                className={activeCategory === category.key ? "active" : ""}
                aria-pressed={activeCategory === category.key}
                onClick={() => setActiveCategory(category.key)}
              >
                <span>{category.symbol}</span>{category.label}
              </button>
            ))}
          </div>

          <div className="inventoryGrid">
            {Array.from({ length: capacity }, (_, slotIndex) => {
              const item = itemBySlot.get(slotIndex);
              const visible = item && (activeCategory === "all" || item.category === activeCategory);
              return (
                <button
                  type="button"
                  key={slotIndex}
                  className={`inventoryCell ${visible ? "occupied" : ""} ${item && !visible ? "filtered" : ""}`}
                  onClick={() => visible ? openItem(item) : (!item ? openNewItem(slotIndex) : undefined)}
                  disabled={Boolean(item && !visible) || (!item && !canAdd)}
                  aria-label={visible ? `ช่อง ${slotIndex + 1}: ${item.name} จำนวน ${item.quantity}` : `ช่อง ${slotIndex + 1}: ${item ? "ถูกซ่อนด้วยตัวกรอง" : "ว่าง"}`}
                >
                  <span className="slotNumber">{slotIndex + 1}</span>
                  {visible ? (
                    <>
                      <ItemArtwork item={item} signedImages={signedImages} />
                      <strong>{item.name}</strong>
                      <span className="quantityBadge">×{item.quantity}</span>
                      {item.equipment_slot ? <span className="equippedBadge">สวมอยู่</span> : null}
                    </>
                  ) : <span className="emptySlotRune">◇</span>}
                </button>
              );
            })}
          </div>

          <footer className="capacityFooter">
            <div className="capacityMeter" role="progressbar" aria-label={`ใช้ ${items.length} จาก ${capacity} ช่อง`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={items.length}>
              <span style={{ width: `${capacity ? Math.min(100, (items.length / capacity) * 100) : 0}%` }} />
            </div>
            <div className="capacitySummary"><span>ช่องที่ใช้</span><strong>{items.length} / {capacity}</strong></div>
            {canManage ? (
              <div className="capacityEditor">
                <label htmlFor="inventory-capacity">ลิมิตช่อง</label>
                <input id="inventory-capacity" type="number" min={Math.max(1, items.length)} max="200" value={capacityDraft} disabled={!canManageInventory} onChange={(event) => setCapacityDraft(Number(event.target.value))} />
                <button className="tinyButton" type="button" onClick={saveCapacity} disabled={saving || capacityDraft === capacity || !canManageInventory}>บันทึก</button>
              </div>
            ) : null}
          </footer>
        </section>
      </div>

      <dialog ref={dialogRef} className="inventoryDialog" onClose={closeDialog} onCancel={(event) => { if (saving) event.preventDefault(); }} aria-labelledby="inventory-dialog-title">
        {dialogState?.kind === "item" ? (
          <div className="inventoryDialogBody">
            <div className="dialogTitleRow">
              <div><p className="eyebrow">{selectedItem ? "Item Detail" : "New Treasure"}</p><h2 id="inventory-dialog-title">{selectedItem ? selectedItem.name : `เพิ่มไอเทมในช่อง ${dialogState.slotIndex + 1}`}</h2></div>
              <button className="dialogClose" type="button" onClick={closeDialog} aria-label="ปิด">×</button>
            </div>

            <div className="dialogItemPreview">
              <ItemArtwork item={selectedItem ?? undefined} signedImages={signedImages} />
              <div><span>{categoryLabel(form.category)}</span><strong>{form.name || "ไอเทมไร้นาม"}</strong><small>จำนวน {form.quantity || 0}</small></div>
            </div>

            <div className="inventoryFormGrid">
              <label>ชื่อไอเทม<input value={form.name} disabled={!canEditItemForm} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>หมวดหมู่<select value={form.category} disabled={!canEditItemForm} onChange={(event) => { const category = event.target.value as InventoryCategory; setForm((current) => ({ ...current, category, allowedEquipmentSlot: defaultAllowedSlot(category, current.allowedEquipmentSlot) })); }}>{CATEGORY_OPTIONS.filter((option) => option.key !== "all").map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
              <label>ชนิด / ระดับ<input value={form.itemType} disabled={!canEditItemForm} onChange={(event) => setForm((current) => ({ ...current, itemType: event.target.value }))} placeholder="เช่น ดาบยาว · Rare" /></label>
              <label>จำนวน<input type="number" min="1" max="2147483647" value={form.quantity} disabled={!canEditItemForm} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} /></label>
              {form.category === "weapon" || form.category === "equipment" ? <label>ตำแหน่งอุปกรณ์<select value={form.allowedEquipmentSlot} disabled={!canEditItemForm} onChange={(event) => setForm((current) => ({ ...current, allowedEquipmentSlot: event.target.value as AllowedEquipmentSlot }))}>{ALLOWED_EQUIPMENT_SLOTS.filter((slot) => form.category === "weapon" ? slot.key === "hand" : slot.key !== "hand").map((slot) => <option key={slot.key} value={slot.key}>{slot.label}</option>)}</select></label> : null}
              <label className="fullField">รายละเอียด<textarea rows={4} value={form.description} disabled={!canEditItemForm} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="คุณสมบัติ เรื่องราว หรือผลของไอเทม" /></label>
              {canEditItemForm ? <label className="fullField filePicker">ภาพไอเทม<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={chooseImage} /><small>{imageFile ? imageFile.name : "JPEG, PNG, WebP หรือ GIF · ไม่เกิน 5 MB"}</small></label> : null}
            </div>

            {selectedItem && (selectedItem.category === "weapon" || selectedItem.category === "equipment") ? (
              <div className="equipActions">
                <span>ตำแหน่งสวมใส่</span>
                {hasUnsavedChanges ? <small>บันทึกการแก้ไขไอเทมก่อน จึงจะเปลี่ยนตำแหน่งสวมใส่ได้</small> : null}
                <div>{EQUIPMENT_SLOTS.filter((slot) => isCompatible(selectedItem.allowed_equipment_slot, slot.key)).map((slot) => <button className={selectedItem.equipment_slot === slot.key ? "active" : ""} type="button" key={slot.key} disabled={!canEquip || saving || hasUnsavedChanges} onClick={() => equipItem(selectedItem, slot.key)}>{slot.label}</button>)}</div>
                {selectedItem.equipment_slot ? <button className="tinyButton ghost" type="button" disabled={!canEquip || saving || hasUnsavedChanges} onClick={() => unequipItem(selectedItem)}>ถอดออกจาก {equipmentLabel(selectedItem.equipment_slot)}</button> : null}
              </div>
            ) : null}

            <div className="dialogActions">
              {selectedItem && canManageInventory ? <button className="button danger" type="button" onClick={() => deleteItem(selectedItem)} disabled={saving}>ลบไอเทม</button> : <span />}
              <div><button className="button ghost" type="button" onClick={closeDialog} disabled={saving}>{canEditItemForm ? "ยกเลิก" : "ปิด"}</button>{canEditItemForm ? <button className="button" type="button" onClick={saveItem} disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกไอเทม"}</button> : null}</div>
            </div>
          </div>
        ) : null}

        {dialogState?.kind === "equipment" ? (
          <div className="inventoryDialogBody equipmentPicker">
            <div className="dialogTitleRow"><div><p className="eyebrow">Equip Item</p><h2 id="inventory-dialog-title">เลือกไอเทมสำหรับ {equipmentLabel(dialogState.equipmentSlot)}</h2></div><button className="dialogClose" type="button" onClick={closeDialog} aria-label="ปิด">×</button></div>
            <div className="equipmentPickerList">
              {equipmentPickerItems.length ? equipmentPickerItems.map((item) => <button type="button" key={item.id} onClick={() => equipItem(item, dialogState.equipmentSlot)} disabled={saving || !canEquip}><ItemArtwork item={item} signedImages={signedImages} compact /><span><strong>{item.name}</strong><small>{item.item_type || categoryLabel(item.category)} · จำนวน {item.quantity}</small></span><b>สวมใส่</b></button>) : <p className="emptyText">ยังไม่มีไอเทมที่ใส่ในตำแหน่งนี้ได้</p>}
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}

function ItemArtwork({ item, signedImages, compact = false }: { item?: InventoryItem; signedImages: Record<string, string>; compact?: boolean }) {
  const imageUrl = item?.image_path ? signedImages[item.image_path] : "";
  return (
    <span className={`itemArtwork ${compact ? "compact" : ""}`}>
      {imageUrl ? <img src={imageUrl} alt={item?.name ?? "ไอเทม"} loading="lazy" decoding="async" /> : <span aria-hidden="true">{categorySymbol(item?.category)}</span>}
    </span>
  );
}

function categoryLabel(category: InventoryCategory) {
  return CATEGORY_OPTIONS.find((option) => option.key === category)?.label ?? "ไอเทม";
}

function categorySymbol(category?: InventoryCategory) {
  return CATEGORY_OPTIONS.find((option) => option.key === category)?.symbol ?? "◇";
}

function equipmentLabel(slot: EquipmentSlot) {
  return EQUIPMENT_SLOTS.find((option) => option.key === slot)?.label ?? slot;
}

function defaultAllowedSlot(category: InventoryCategory, current: AllowedEquipmentSlot | "" = ""): AllowedEquipmentSlot | "" {
  if (category === "weapon") return "hand";
  if (category === "equipment") return current && current !== "hand" ? current : "chest";
  return "";
}

function isCompatible(allowedSlot: AllowedEquipmentSlot | null, slot: EquipmentSlot) {
  if (allowedSlot === "hand") return slot === "left_hand" || slot === "right_hand";
  return allowedSlot === slot;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "บันทึกคลังไอเทมไม่สำเร็จ";
}
