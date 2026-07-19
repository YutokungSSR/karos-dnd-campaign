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
  const [deletingCampaignId, setDeletingCampaignId] = useState<string | null>(
    null
  );
  const [deletingCharacterId, setDeletingCharacterId] = useState<string | null>(
    null
  );

  const loadData = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    const supabase = getSupabase();

    const [campaignResult, characterResult, profileResult] = await Promise.all([
      supabase
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("characters")
        .select("*")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false }),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    ]);

    if (campaignResult.error || characterResult.error) {
      setMessage(
        campaignResult.error?.message ||
          characterResult.error?.message ||
          "โหลดข้อมูลไม่สำเร็จ"
      );
    }

    setCampaigns(campaignResult.data ?? []);
    setCharacters(characterResult.data ?? []);
    setProfile(profileResult.data);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

    const { error } = await getSupabase().rpc("join_campaign_by_code", {
      code_input: joinCode.trim(),
    });

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

  async function deleteCampaign(campaign: any) {
    if (!user || campaign.dm_user_id !== user.id) {
      setMessage("เฉพาะ DM เจ้าของแคมเปญเท่านั้นที่สามารถลบแคมเปญได้");
      return;
    }

    const confirmed = window.confirm(
      `ต้องการลบแคมเปญ “${campaign.name}” ใช่ไหม?\n\nสมาชิกและประวัติการทอยของแคมเปญจะถูกลบ ส่วนตัวละครจะถูกย้ายออกจากแคมเปญ การกระทำนี้ย้อนกลับไม่ได้`
    );

    if (!confirmed) return;

    setDeletingCampaignId(campaign.id);
    setMessage("");

    try {
      const { error, count } = await getSupabase()
        .from("campaigns")
        .delete({ count: "exact" })
        .eq("id", campaign.id)
        .eq("dm_user_id", user.id);

      if (error) {
        setMessage(error.message);
        return;
      }

      if (!count) {
        setMessage("ลบแคมเปญไม่สำเร็จ หรือคุณไม่มีสิทธิ์ลบแคมเปญนี้");
        return;
      }

      setMessage(`ลบแคมเปญ “${campaign.name}” แล้ว`);
      await loadData();
    } finally {
      setDeletingCampaignId(null);
    }
  }

  async function deleteCharacter(character: any) {
    if (!user || character.owner_id !== user.id) {
      setMessage("คุณไม่มีสิทธิ์ลบตัวละครนี้");
      return;
    }

    const confirmed = window.confirm(
      `ต้องการลบตัวละคร “${character.name}” ใช่ไหม?\n\nสกิล สถานะ และไอเทมทั้งหมดของตัวละครจะถูกลบถาวร การกระทำนี้ย้อนกลับไม่ได้`
    );

    if (!confirmed) return;

    setDeletingCharacterId(character.id);
    setMessage("");

    try {
      const { error, count } = await getSupabase()
        .from("characters")
        .delete({ count: "exact" })
        .eq("id", character.id)
        .eq("owner_id", user.id);

      if (error) {
        setMessage(error.message);
        return;
      }

      if (!count) {
        setMessage("ลบตัวละครไม่สำเร็จ หรือคุณไม่มีสิทธิ์ลบตัวละครนี้");
        return;
      }

      setMessage(`ลบตัวละคร “${character.name}” แล้ว`);
      await loadData();
    } finally {
      setDeletingCharacterId(null);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="appShell">
        <Loading />
      </main>
    );
  }

  return (
    <main className="appShell">
      <AppNav
        subtitle={`ยินดีต้อนรับ ${
          profile?.display_name || user?.email || "นักผจญภัย"
        }`}
      />

      <section className="dashboardHero">
        <div>
          <p className="eyebrow">Campaign Command Center</p>
          <h1>ศูนย์บัญชาการการผจญภัย</h1>
          <p>สร้างแคมเปญ เข้าร่วมโต๊ะ และจัดการตัวละครทั้งหมดจากที่เดียว</p>
        </div>

        <div className="heroCounters">
          <div>
            <strong>{campaigns.length}</strong>
            <span>แคมเปญ</span>
          </div>
          <div>
            <strong>{characters.length}</strong>
            <span>ตัวละคร</span>
          </div>
        </div>
      </section>

      {message ? <p className="notice banner">{message}</p> : null}

      <section className="dashboardGrid">
        <section className="panel">
          <p className="eyebrow">Dungeon Master</p>
          <h2>สร้างแคมเปญใหม่</h2>

          <form className="formStack" onSubmit={createCampaign}>
            <label>
              ชื่อแคมเปญ
              <input
                required
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder="เช่น สุสานเทพทอดทิ้ง"
              />
            </label>

            <label>
              คำอธิบาย
              <textarea
                value={campaignDescription}
                onChange={(event) =>
                  setCampaignDescription(event.target.value)
                }
                placeholder="เรื่องย่อหรือกติกาของโต๊ะ"
              />
            </label>

            <button className="button">สร้างแคมเปญ</button>
          </form>
        </section>

        <section className="panel">
          <p className="eyebrow">Adventurer</p>
          <h2>เข้าร่วมด้วยรหัสเชิญ</h2>

          <form className="inlineForm" onSubmit={joinCampaign}>
            <input
              required
              value={joinCode}
              onChange={(event) =>
                setJoinCode(event.target.value.toUpperCase())
              }
              placeholder="AB12CD34"
              maxLength={8}
            />
            <button className="button">เข้าร่วม</button>
          </form>

          <hr className="softDivider" />
          <h3>สร้างตัวละคร</h3>

          <form className="formStack" onSubmit={createCharacter}>
            <label>
              ชื่อตัวละคร
              <input
                required
                value={characterName}
                onChange={(event) => setCharacterName(event.target.value)}
                placeholder="ชื่อของนักผจญภัย"
              />
            </label>

            <label>
              สังกัดแคมเปญ
              <select
                value={characterCampaign}
                onChange={(event) => setCharacterCampaign(event.target.value)}
              >
                <option value="">ยังไม่สังกัดแคมเปญ</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>

            <button className="button">สร้างหน้าต่างสเตตัส</button>
          </form>
        </section>
      </section>

      <section className="contentSection">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Your Tables</p>
            <h2>แคมเปญของคุณ</h2>
          </div>
        </div>

        <div className="tileGrid">
          {campaigns.length ? (
            campaigns.map((campaign) => {
              const isDm = campaign.dm_user_id === user?.id;
              const isDeleting = deletingCampaignId === campaign.id;

              return (
                <article className="campaignTile" key={campaign.id}>
                  <Link href={`/campaign/${campaign.id}`}>
                    <span className="tileRune">✦</span>
                    <small>{isDm ? "DM" : "PLAYER"}</small>
                    <h3>{campaign.name}</h3>
                    <p>{campaign.description || "ยังไม่มีคำอธิบาย"}</p>
                    <b>เปิดแคมเปญ →</b>
                  </Link>

                  {isDm ? (
                    <button
                      type="button"
                      className="tinyButton danger topGap"
                      onClick={() => deleteCampaign(campaign)}
                      disabled={isDeleting}
                      aria-label={`ลบแคมเปญ ${campaign.name}`}
                    >
                      {isDeleting ? "กำลังลบ…" : "ลบแคมเปญ"}
                    </button>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="emptyPanel">
              ยังไม่มีแคมเปญ ลองสร้างใหม่หรือใช้รหัสเชิญจาก DM
            </div>
          )}
        </div>
      </section>

      <section className="contentSection">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Character Archive</p>
            <h2>ตัวละครของคุณ</h2>
          </div>
        </div>

        <div className="characterTiles">
          {characters.length ? (
            characters.map((character) => {
              const isDeleting = deletingCharacterId === character.id;

              return (
                <article className="characterTile" key={character.id}>
                  <Link
                    href={`/character/${character.id}`}
                    className="characterThumb"
                  >
                    {character.portrait_url ? (
                      <img src={character.portrait_url} alt="" />
                    ) : (
                      <span>♜</span>
                    )}
                  </Link>

                  <div>
                    <Link href={`/character/${character.id}`}>
                      <small>
                        {character.rank || "F"} · LV.{character.level}
                      </small>
                      <h3>{character.name}</h3>
                      <p>{character.class_name || "ยังไม่ระบุคลาส"}</p>
                    </Link>

                    <button
                      type="button"
                      className="tinyButton danger topGap"
                      onClick={() => deleteCharacter(character)}
                      disabled={isDeleting}
                      aria-label={`ลบตัวละคร ${character.name}`}
                    >
                      {isDeleting ? "กำลังลบ…" : "ลบตัวละคร"}
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="emptyPanel">
              ยังไม่มีตัวละคร สร้างตัวแรกจากแบบฟอร์มด้านบน
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
