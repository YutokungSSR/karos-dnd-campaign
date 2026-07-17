"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import DiceRoller from "@/components/DiceRoller";
import Loading from "@/components/Loading";
import { useAuth } from "@/lib/useAuth";
import { getSupabase } from "@/lib/supabase";

export default function CampaignPage() {
  const params = useParams();
  const id = params.id as string;
  const { user, loading: authLoading } = useAuth();
  const [campaign, setCampaign] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [rolls, setRolls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [newCharacterName, setNewCharacterName] = useState("");

  const load = useCallback(async () => {
    if (!user || !id) return;
    const supabase = getSupabase();
    const [campaignResult, membersResult, charactersResult, rollsResult] = await Promise.all([
      supabase.from("campaigns").select("*").eq("id", id).single(),
      supabase.from("campaign_members").select("user_id,role,joined_at,profiles(display_name,avatar_url)").eq("campaign_id", id).order("joined_at"),
      supabase.from("characters").select("*").eq("campaign_id", id).order("updated_at", { ascending: false }),
      supabase.from("dice_rolls").select("*,profiles(display_name)").eq("campaign_id", id).order("created_at", { ascending: false }).limit(20),
    ]);
    if (campaignResult.error) setMessage(campaignResult.error.message);
    setCampaign(campaignResult.data);
    setMembers(membersResult.data ?? []);
    setCharacters(charactersResult.data ?? []);
    setRolls(rollsResult.data ?? []);
    setLoading(false);
  }, [id, user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!id) return;
    const supabase = getSupabase();
    const channel = supabase.channel(`campaign-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "characters", filter: `campaign_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dice_rolls", filter: `campaign_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, load]);

  async function createCharacter(event: FormEvent) {
    event.preventDefault();
    if (!user || !newCharacterName.trim()) return;
    const { data, error } = await getSupabase().from("characters").insert({ owner_id: user.id, campaign_id: id, name: newCharacterName.trim() }).select("id").single();
    if (error) return setMessage(error.message);
    window.location.href = `/character/${data.id}`;
  }

  async function changeHp(character: any, amount: number) {
    const next = Math.min(character.max_hp, Math.max(0, character.current_hp + amount));
    const { error } = await getSupabase().from("characters").update({ current_hp: next }).eq("id", character.id);
    if (error) setMessage(error.message); else load();
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(campaign.invite_code);
    setMessage("คัดลอกรหัสเชิญแล้ว");
  }

  if (authLoading || loading) return <main className="appShell"><Loading text="กำลังเปิดบันทึกแคมเปญ…" /></main>;
  if (!campaign) return <main className="appShell"><AppNav /><div className="emptyPanel">ไม่พบแคมเปญ หรือคุณไม่มีสิทธิ์เข้าถึง</div></main>;
  const isDm = campaign.dm_user_id === user?.id;

  return (
    <main className="appShell">
      <AppNav subtitle={campaign.name} />
      <section className="campaignHeader">
        <div><p className="eyebrow">{isDm ? "Dungeon Master View" : "Adventurer View"}</p><h1>{campaign.name}</h1><p>{campaign.description || "ยังไม่มีคำอธิบายแคมเปญ"}</p></div>
        <div className="inviteSeal"><small>รหัสเชิญ</small><strong>{campaign.invite_code}</strong><button className="tinyButton" onClick={copyInvite}>คัดลอก</button></div>
      </section>
      {message ? <p className="notice banner">{message}</p> : null}

      <section className="campaignLayout">
        <div className="mainColumn">
          <section className="panel">
            <div className="panelTitleRow"><div><p className="eyebrow">Party Status</p><h2>สมาชิกและตัวละคร</h2></div><span className="counterPill">{characters.length} ตัวละคร</span></div>
            <div className="partyList">
              {characters.length ? characters.map((character) => {
                const hpPercent = character.max_hp ? Math.round(character.current_hp / character.max_hp * 100) : 0;
                return <div className="partyRow" key={character.id}>
                  <Link href={`/character/${character.id}`} className="partyIdentity"><div className="avatarCircle">{character.portrait_url ? <img src={character.portrait_url} alt="" /> : "♜"}</div><div><small>{character.rank} · LV.{character.level}</small><strong>{character.name}</strong><span>{character.class_name || "ไม่ระบุคลาส"}</span></div></Link>
                  <div className="partyResources"><div className="miniResource"><span>HP {character.current_hp}/{character.max_hp}</span><div><i style={{ width: `${hpPercent}%` }} /></div></div>{isDm ? <div className="hpControls"><button onClick={() => changeHp(character, -5)}>−5</button><button onClick={() => changeHp(character, -1)}>−1</button><button onClick={() => changeHp(character, 1)}>+1</button><button onClick={() => changeHp(character, 5)}>+5</button></div> : null}</div>
                </div>;
              }) : <p className="emptyText">ยังไม่มีตัวละครในแคมเปญนี้</p>}
            </div>
            <form className="inlineForm topGap" onSubmit={createCharacter}><input value={newCharacterName} onChange={(e) => setNewCharacterName(e.target.value)} placeholder="ชื่อตัวละครใหม่" required /><button className="button">เพิ่มตัวละครของฉัน</button></form>
          </section>

          {user ? <DiceRoller campaignId={id} userId={user.id} onRolled={load} /> : null}

          <section className="panel">
            <p className="eyebrow">Roll History</p><h2>ประวัติการทอยล่าสุด</h2>
            <div className="rollLog">{rolls.length ? rolls.map((roll) => <div className="rollRow" key={roll.id}><span className="rollTotal">{roll.result}</span><div><strong>{roll.profiles?.display_name || "นักผจญภัย"}</strong><p>{roll.expression} · {roll.detail}</p></div><time>{new Date(roll.created_at).toLocaleString("th-TH")}</time></div>) : <p className="emptyText">ยังไม่มีการทอยลูกเต๋า</p>}</div>
          </section>
        </div>

        <aside className="sideColumn">
          <section className="panel stickyPanel"><p className="eyebrow">Party Members</p><h2>สมาชิกโต๊ะ</h2><div className="memberList">{members.map((member) => <div className="memberRow" key={member.user_id}><div className="avatarSmall">{member.profiles?.display_name?.[0] || "?"}</div><div><strong>{member.profiles?.display_name || "ผู้เล่น"}</strong><small>{member.role === "dm" ? "Dungeon Master" : "Player"}</small></div></div>)}</div></section>
        </aside>
      </section>
    </main>
  );
}
