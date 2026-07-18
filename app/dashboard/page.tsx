"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import Loading from "@/components/Loading";
import { useAuth } from "@/lib/useAuth";
import { getSupabase } from "@/lib/supabase";

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterCampaign, setCharacterCampaign] = useState("");

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const supabase = getSupabase();
    const [campaignResult, characterResult, profileResult] = await Promise.all([
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("characters").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    ]);
    if (campaignResult.error || characterResult.error) setMessage(campaignResult.error?.message || characterResult.error?.message || "โหลดข้อมูลไม่สำเร็จ");
    setCampaigns(campaignResult.data ?? []);
    setCharacters(characterResult.data ?? []);
    setProfile(profileResult.data);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    if (!user || !campaignName.trim()) return;
    const { error } = await getSupabase().from("campaigns").insert({
      dm_user_id: user.id,
      name: campaignName.trim(),
      description: campaignDescription.trim(),
    });
    if (error) return setMessage(error.message);
    setCampaignName("");
    setCampaignDescription("");
    setMessage("สร้างแคมเปญแล้ว");
    loadData();
  }

  async function joinCampaign(event: FormEvent) {
    event.preventDefault();
    if (!joinCode.trim()) return;
    const { error } = await getSupabase().rpc("join_campaign_by_code", { code_input: joinCode.trim() });
    if (error) return setMessage(error.message);
    setJoinCode("");
    setMessage("เข้าร่วมแคมเปญสำเร็จ");
    loadData();
  }

  async function createCharacter(event: FormEvent) {
    event.preventDefault();
    if (!user || !characterName.trim()) return;
    const characterId = crypto.randomUUID();
    const { error } = await getSupabase().from("characters").insert({
      id: characterId,
      owner_id: user.id,
      campaign_id: characterCampaign || null,
      name: characterName.trim(),
    });
    if (error) return setMessage(error.message);
    window.location.href = `/character/${characterId}`;
  }

  if (authLoading || loading) return <main className="appShell"><Loading /></main>;

  return (
    <main className="appShell">
      <AppNav subtitle={`ยินดีต้อนรับ ${profile?.display_name || user?.email || "นักผจญภัย"}`} />
      <section className="dashboardHero">
        <div><p className="eyebrow">Campaign Command Center</p><h1>ศูนย์บัญชาการการผจญภัย</h1><p>สร้างแคมเปญ เข้าร่วมโต๊ะ และจัดการตัวละครทั้งหมดจากที่เดียว</p></div>
        <div className="heroCounters"><div><strong>{campaigns.length}</strong><span>แคมเปญ</span></div><div><strong>{characters.length}</strong><span>ตัวละคร</span></div></div>
      </section>

      {message ? <p className="notice banner">{message}</p> : null}

      <section className="dashboardGrid">
        <section className="panel">
          <p className="eyebrow">Dungeon Master</p><h2>สร้างแคมเปญใหม่</h2>
          <form className="formStack" onSubmit={createCampaign}>
            <label>ชื่อแคมเปญ<input required value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="เช่น สุสานเทพทอดทิ้ง" /></label>
            <label>คำอธิบาย<textarea value={campaignDescription} onChange={(e) => setCampaignDescription(e.target.value)} placeholder="เรื่องย่อหรือกติกาของโต๊ะ" /></label>
            <button className="button">สร้างแคมเปญ</button>
          </form>
        </section>

        <section className="panel">
          <p className="eyebrow">Adventurer</p><h2>เข้าร่วมด้วยรหัสเชิญ</h2>
          <form className="inlineForm" onSubmit={joinCampaign}>
            <input required value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="AB12CD34" maxLength={8} />
            <button className="button">เข้าร่วม</button>
          </form>
          <hr className="softDivider" />
          <h3>สร้างตัวละคร</h3>
          <form className="formStack" onSubmit={createCharacter}>
            <label>ชื่อตัวละคร<input required value={characterName} onChange={(e) => setCharacterName(e.target.value)} placeholder="ชื่อของนักผจญภัย" /></label>
            <label>สังกัดแคมเปญ<select value={characterCampaign} onChange={(e) => setCharacterCampaign(e.target.value)}><option value="">ยังไม่สังกัดแคมเปญ</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
            <button className="button">สร้างหน้าต่างสเตตัส</button>
          </form>
        </section>
      </section>

      <section className="contentSection">
        <div className="sectionHeading"><div><p className="eyebrow">Your Tables</p><h2>แคมเปญของคุณ</h2></div></div>
        <div className="tileGrid">
          {campaigns.length ? campaigns.map((campaign) => (
            <Link href={`/campaign/${campaign.id}`} className="campaignTile" key={campaign.id}>
              <span className="tileRune">✦</span><small>{campaign.dm_user_id === user?.id ? "DM" : "PLAYER"}</small><h3>{campaign.name}</h3><p>{campaign.description || "ยังไม่มีคำอธิบาย"}</p><b>เปิดแคมเปญ →</b>
            </Link>
          )) : <div className="emptyPanel">ยังไม่มีแคมเปญ ลองสร้างใหม่หรือใช้รหัสเชิญจาก DM</div>}
        </div>
      </section>

      <section className="contentSection">
        <div className="sectionHeading"><div><p className="eyebrow">Character Archive</p><h2>ตัวละครของคุณ</h2></div></div>
        <div className="characterTiles">
          {characters.length ? characters.map((character) => (
            <Link href={`/character/${character.id}`} className="characterTile" key={character.id}>
              <div className="characterThumb">{character.portrait_url ? <img src={character.portrait_url} alt="" /> : <span>♜</span>}</div>
              <div><small>{character.rank || "F"} · LV.{character.level}</small><h3>{character.name}</h3><p>{character.class_name || "ยังไม่ระบุคลาส"}</p></div>
            </Link>
          )) : <div className="emptyPanel">ยังไม่มีตัวละคร สร้างตัวแรกจากแบบฟอร์มด้านบน</div>}
        </div>
      </section>
    </main>
  );
}
