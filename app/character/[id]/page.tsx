"use client";

import { useParams } from "next/navigation";
import { ChangeEvent, useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import CharacterInventory, { type InventoryItem } from "@/components/CharacterInventory";
import CharacterReadOnly from "@/components/CharacterReadOnly";
import Loading from "@/components/Loading";
import { useAuth } from "@/lib/useAuth";
import { getSupabase } from "@/lib/supabase";

const STAT_KEYS = ["STR", "VIT", "AGI", "INT", "DEX", "WIS", "CHA"];

export default function CharacterPage() {
  const params = useParams();
  const id = params.id as string;
  const { user, loading: authLoading } = useAuth();
  const [character, setCharacter] = useState<any>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [conditions, setConditions] = useState<any[]>([]);
  const [inventoryCapacity, setInventoryCapacity] = useState(10);
  const [inventoryReady, setInventoryReady] = useState(true);
  const [isDm, setIsDm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeView, setActiveView] = useState<"status" | "inventory">("status");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !id) return;
    const supabase = getSupabase();
    const [characterResult, skillResult, itemResult, conditionResult, inventoryResult] = await Promise.all([
      supabase.from("characters").select("*").eq("id", id).single(),
      supabase.from("skills").select("*").eq("character_id", id).order("sort_order"),
      supabase.from("inventory_items").select("*").eq("character_id", id),
      supabase.from("conditions").select("*").eq("character_id", id).order("created_at"),
      supabase.from("character_inventories").select("capacity").eq("character_id", id).maybeSingle(),
    ]);
    const char = characterResult.data;
    setCharacter(char);
    setSkills(skillResult.data ?? []);
    setItems((itemResult.data ?? []).map((item: any, index: number) => ({
      ...item,
      category: item.category ?? "item",
      image_path: item.image_path ?? null,
      slot_index: Number.isInteger(item.slot_index) ? item.slot_index : index,
      allowed_equipment_slot: item.allowed_equipment_slot ?? (item.category === "weapon" ? "hand" : item.category === "equipment" ? "chest" : null),
      equipment_slot: item.equipment_slot ?? null,
    })).sort((a: InventoryItem, b: InventoryItem) => a.slot_index - b.slot_index));
    setConditions(conditionResult.data ?? []);
    setInventoryCapacity(inventoryResult.data?.capacity ?? 10);
    setInventoryReady(!inventoryResult.error && !itemResult.error);
    if (char?.campaign_id) {
      const { data: campaign } = await supabase.from("campaigns").select("dm_user_id").eq("id", char.campaign_id).maybeSingle();
      setIsDm(campaign?.dm_user_id === user.id);
    } else setIsDm(false);
    if (characterResult.error) setMessage(characterResult.error.message);
    setLoading(false);
  }, [id, user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (window.location.hash === "#inventory") setActiveView("inventory");
  }, []);

  useEffect(() => {
    if (!user || !id) return;
    const supabase = getSupabase();
    const channel = supabase.channel(`inventory-${id}-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_items", filter: `character_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "character_inventories", filter: `character_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, load, user]);

  function updateField(field: string, value: any) {
    setCharacter((current: any) => ({ ...current, [field]: value }));
  }

  function updateStat(key: string, value: number) {
    setCharacter((current: any) => ({ ...current, stats: { ...(current.stats ?? {}), [key]: Math.min(100, Math.max(0, value || 0)) } }));
  }

  async function saveAll() {
    if (!character) return;
    setMessage("");
    const supabase = getSupabase();
    const { error } = await supabase.from("characters").update({
      name: character.name,
      title: character.title,
      class_name: character.class_name,
      level: Number(character.level),
      rank: character.rank,
      element: character.element,
      race: character.race,
      stars: character.stars,
      condition_text: character.condition_text,
      memory: character.memory,
      current_hp: Number(character.current_hp),
      max_hp: Math.max(1, Number(character.max_hp)),
      current_mp: Number(character.current_mp),
      max_mp: Math.max(0, Number(character.max_mp)),
      stats: character.stats,
      is_public: Boolean(character.is_public),
    }).eq("id", id);
    if (error) return setMessage(error.message);

    for (const skill of skills) {
      const { error: skillError } = await supabase.from("skills").upsert({ ...skill, character_id: id });
      if (skillError) return setMessage(skillError.message);
    }
    for (const condition of conditions) {
      const { error: conditionError } = await supabase.from("conditions").upsert({ ...condition, character_id: id });
      if (conditionError) return setMessage(conditionError.message);
    }

    setEditing(false);
    setMessage("บันทึกข้อมูลตัวละครแล้ว");
    load();
  }

  async function uploadPortrait(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user || !character) return;
    setUploading(true);
    const supabase = getSupabase();
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/${character.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("character-portraits").upload(path, file, { upsert: false });
    if (error) { setMessage(error.message); setUploading(false); return; }
    const { data } = supabase.storage.from("character-portraits").getPublicUrl(path);
    const { error: updateError } = await supabase.from("characters").update({ portrait_url: data.publicUrl }).eq("id", character.id);
    if (updateError) setMessage(updateError.message); else setMessage("อัปโหลดภาพแล้ว");
    setUploading(false);
    load();
  }

  function addSkill() { setSkills((current) => [...current, { id: crypto.randomUUID(), character_id: id, name: "สกิลใหม่", skill_type: "ทั่วไป", description: "", cost: "", sort_order: current.length }]); }
  function addCondition() { setConditions((current) => [...current, { id: crypto.randomUUID(), character_id: id, name: "สถานะใหม่", description: "" }]); }

  async function removeRow(table: string, rowId: string, setter: (fn: (rows: any[]) => any[]) => void) {
    const { error } = await getSupabase().from(table).delete().eq("id", rowId);
    if (error) return setMessage(error.message);
    setter((rows) => rows.filter((row) => row.id !== rowId));
  }

  async function copyShareLink() {
    if (!character) return;
    const url = `${window.location.origin}/share/${character.share_token}`;
    await navigator.clipboard.writeText(url);
    setMessage(character.is_public ? "คัดลอกลิงก์สาธารณะแล้ว" : "ต้องเปิดการแชร์สาธารณะและบันทึกก่อน");
  }

  function changeView(view: "status" | "inventory") {
    setActiveView(view);
    const nextUrl = view === "inventory"
      ? `${window.location.pathname}${window.location.search}#inventory`
      : `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", nextUrl);
  }

  if (authLoading || loading) return <main className="appShell"><Loading text="กำลังเรียกหน้าต่างสเตตัส…" /></main>;
  if (!character) return <main className="appShell"><AppNav /><div className="emptyPanel">ไม่พบตัวละคร หรือคุณไม่มีสิทธิ์เข้าถึง</div></main>;
  const canEdit = character.owner_id === user?.id || isDm;
  const canViewInventory = character.owner_id === user?.id || isDm;
  const displayedView = activeView === "inventory" && canViewInventory ? "inventory" : "status";

  return (
    <main className="appShell wideShell">
      <AppNav subtitle={character.name} />
      <div className="characterToolbar">
        <div aria-live="polite">{message ? <span className="notice compact">{message}</span> : <span className="mutedText">เจ้าของตัวละครและ DM สามารถแก้ไขได้</span>}</div>
        <div className="navActions">
          {character.is_public ? <button className="button ghost" onClick={copyShareLink}>คัดลอกลิงก์แชร์</button> : null}
          {displayedView === "status" && canEdit ? <button className="button" onClick={() => editing ? saveAll() : setEditing(true)}>{editing ? "บันทึกทั้งหมด" : "แก้ไขตัวละคร"}</button> : null}
          {displayedView === "status" && editing ? <button className="button ghost" onClick={() => { setEditing(false); load(); }}>ยกเลิก</button> : null}
        </div>
      </div>

      <nav className="characterViewTabs" aria-label="เมนูตัวละคร">
        <button type="button" className={displayedView === "status" ? "active" : ""} aria-pressed={displayedView === "status"} onClick={() => changeView("status")}><span>✧</span><div><small>Character</small><strong>หน้าต่างสเตตัส</strong></div></button>
        {canViewInventory ? <button type="button" className={displayedView === "inventory" ? "active" : ""} aria-pressed={displayedView === "inventory"} onClick={() => changeView("inventory")}><span>▦</span><div><small>Inventory</small><strong>ช่องเก็บของ</strong></div><b>{items.length}/{inventoryCapacity}</b></button> : null}
      </nav>

      {displayedView === "status" && !editing ? (
        <CharacterReadOnly character={character} skills={skills} conditions={conditions} actions={canEdit ? <label className="button uploadButton">{uploading ? "กำลังอัปโหลด…" : "เปลี่ยนภาพตัวละคร"}<input type="file" accept="image/*" hidden onChange={uploadPortrait} disabled={uploading} /></label> : undefined} />
      ) : null}

      {displayedView === "status" && editing ? (
        <section className="editorLayout">
          <section className="panel editorPanel">
            <p className="eyebrow">Identity</p><h2>ข้อมูลหลัก</h2>
            <div className="editGrid">
              <Field label="ชื่อ"><input value={character.name} onChange={(e) => updateField("name", e.target.value)} /></Field>
              <Field label="ฉายา"><input value={character.title || ""} onChange={(e) => updateField("title", e.target.value)} /></Field>
              <Field label="คลาส"><input value={character.class_name || ""} onChange={(e) => updateField("class_name", e.target.value)} /></Field>
              <Field label="ระดับ"><input type="number" min="1" value={character.level} onChange={(e) => updateField("level", e.target.value)} /></Field>
              <Field label="แรงค์"><input value={character.rank || ""} onChange={(e) => updateField("rank", e.target.value)} /></Field>
              <Field label="ธาตุ"><input value={character.element || ""} onChange={(e) => updateField("element", e.target.value)} /></Field>
              <Field label="เผ่าพันธุ์"><input value={character.race || ""} onChange={(e) => updateField("race", e.target.value)} /></Field>
              <Field label="ดาว"><input value={character.stars || ""} onChange={(e) => updateField("stars", e.target.value)} /></Field>
              <Field label="สถานะ"><input value={character.condition_text || ""} onChange={(e) => updateField("condition_text", e.target.value)} /></Field>
            </div>
            <div className="editGrid resourcesEdit">
              {[["HP ปัจจุบัน","current_hp"],["HP สูงสุด","max_hp"],["MP ปัจจุบัน","current_mp"],["MP สูงสุด","max_mp"]].map(([label,key]) => <Field label={label} key={key}><input type="number" min="0" value={character[key]} onChange={(e) => updateField(key, Number(e.target.value))} /></Field>)}
            </div>
            <h3>ค่าสถานะ</h3><div className="editGrid statEditGrid">{STAT_KEYS.map((key) => <Field label={key} key={key}><input type="number" min="0" max="100" value={character.stats?.[key] ?? 0} onChange={(e) => updateStat(key, Number(e.target.value))} /></Field>)}</div>
            <Field label="จิ๊กซอว์ความทรงจำ"><textarea rows={3} value={character.memory || ""} onChange={(e) => updateField("memory", e.target.value)} /></Field>
            <label className="toggleLine"><input type="checkbox" checked={Boolean(character.is_public)} onChange={(e) => updateField("is_public", e.target.checked)} /><span>อนุญาตให้คนทั่วไปเปิดดูด้วยลิงก์แชร์</span></label>
          </section>

          <section className="panel editorPanel"><div className="panelTitleRow"><div><p className="eyebrow">Skills</p><h2>สกิล</h2></div><button className="tinyButton" onClick={addSkill}>＋ เพิ่ม</button></div><div className="editorCards">{skills.map((skill, index) => <div className="editorCard" key={skill.id}><input value={skill.name} onChange={(e) => setSkills(rows => rows.map((row,i) => i===index ? {...row,name:e.target.value}:row))} /><input value={skill.skill_type || ""} onChange={(e) => setSkills(rows => rows.map((row,i) => i===index ? {...row,skill_type:e.target.value}:row))} placeholder="ประเภท" /><textarea value={skill.description || ""} onChange={(e) => setSkills(rows => rows.map((row,i) => i===index ? {...row,description:e.target.value}:row))} placeholder="คำอธิบาย" /><input value={skill.cost || ""} onChange={(e) => setSkills(rows => rows.map((row,i) => i===index ? {...row,cost:e.target.value}:row))} placeholder="มานา / คูลดาวน์" /><button className="tinyButton danger" onClick={() => removeRow("skills", skill.id, setSkills)}>ลบ</button></div>)}</div></section>

          <section className="panel editorPanel"><div className="panelTitleRow"><div><p className="eyebrow">Conditions</p><h2>สถานะผิดปกติ</h2></div><button className="tinyButton" onClick={addCondition}>＋ เพิ่ม</button></div><div className="editorCards">{conditions.map((condition, index) => <div className="editorCard" key={condition.id}><input value={condition.name} onChange={(e) => setConditions(rows => rows.map((row,i) => i===index ? {...row,name:e.target.value}:row))} /><textarea value={condition.description || ""} onChange={(e) => setConditions(rows => rows.map((row,i) => i===index ? {...row,description:e.target.value}:row))} placeholder="รายละเอียด" /><button className="tinyButton danger" onClick={() => removeRow("conditions", condition.id, setConditions)}>ลบ</button></div>)}</div></section>
        </section>
      ) : null}

      {displayedView === "inventory" ? (
        <CharacterInventory
          character={character}
          items={items}
          capacity={inventoryCapacity}
          canManage={isDm}
          databaseReady={inventoryReady}
          onChanged={load}
          onMessage={setMessage}
        />
      ) : null}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="fieldLabel"><span>{label}</span>{children}</label>; }
