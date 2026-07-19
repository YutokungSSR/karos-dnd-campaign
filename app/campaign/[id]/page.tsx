"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";
import DiceRoller from "@/components/DiceRoller";
import GodVault from "@/components/GodVault";
import Loading from "@/components/Loading";
import { useAuth } from "@/lib/useAuth";
import { getSupabase } from "@/lib/supabase";
import styles from "./CampaignPage.module.css";

type CampaignTab = "overview" | "vault" | "settings";

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
  const [activeTab, setActiveTab] = useState<CampaignTab>("overview");
  const [changingRoleUserId, setChangingRoleUserId] = useState<string | null>(
    null
  );

  const currentMember = useMemo(
    () => members.find((member) => member.user_id === user?.id),
    [members, user?.id]
  );

  const isOwner =
    campaign?.dm_user_id === user?.id || currentMember?.role === "owner";
  const isDm = isOwner || currentMember?.role === "dm";

  const refreshRolls = useCallback(async () => {
    if (!user || !id) return;

    const { data, error } = await getSupabase()
      .from("dice_rolls")
      .select("*,profiles(display_name)")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      setMessage(error.message);
      return;
    }

    setRolls(data ?? []);
  }, [id, user]);

  const refreshCharacters = useCallback(async () => {
    if (!user || !id) return;

    const { data, error } = await getSupabase()
      .from("characters")
      .select("*")
      .eq("campaign_id", id)
      .order("updated_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    setCharacters(data ?? []);
  }, [id, user]);

  const refreshMembers = useCallback(async () => {
    if (!user || !id) return;

    const { data, error } = await getSupabase()
      .from("campaign_members")
      .select("user_id,role,joined_at,profiles(display_name,avatar_url)")
      .eq("campaign_id", id)
      .order("joined_at");

    if (error) {
      setMessage(error.message);
      return;
    }

    setMembers(data ?? []);
  }, [id, user]);

  const loadInitialData = useCallback(async () => {
    if (!user || !id) return;

    setLoading(true);
    const supabase = getSupabase();

    const [campaignResult, membersResult, charactersResult, rollsResult] =
      await Promise.all([
        supabase.from("campaigns").select("*").eq("id", id).single(),
        supabase
          .from("campaign_members")
          .select(
            "user_id,role,joined_at,profiles(display_name,avatar_url)"
          )
          .eq("campaign_id", id)
          .order("joined_at"),
        supabase
          .from("characters")
          .select("*")
          .eq("campaign_id", id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("dice_rolls")
          .select("*,profiles(display_name)")
          .eq("campaign_id", id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    const firstError =
      campaignResult.error ||
      membersResult.error ||
      charactersResult.error ||
      rollsResult.error;

    if (firstError) {
      setMessage(firstError.message);
    }

    setCampaign(campaignResult.data);
    setMembers(membersResult.data ?? []);
    setCharacters(charactersResult.data ?? []);
    setRolls(rollsResult.data ?? []);
    setLoading(false);
  }, [id, user]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!id) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel(`campaign-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "characters",
          filter: `campaign_id=eq.${id}`,
        },
        () => refreshCharacters()
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dice_rolls",
          filter: `campaign_id=eq.${id}`,
        },
        () => refreshRolls()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaign_members",
          filter: `campaign_id=eq.${id}`,
        },
        () => refreshMembers()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, refreshCharacters, refreshMembers, refreshRolls]);

  useEffect(() => {
    if (!isDm && activeTab === "vault") setActiveTab("overview");
    if (!isOwner && activeTab === "settings") setActiveTab("overview");
  }, [activeTab, isDm, isOwner]);

  async function createCharacter(event: FormEvent) {
    event.preventDefault();
    if (!user || !newCharacterName.trim()) return;

    const characterId = crypto.randomUUID();
    const { error } = await getSupabase().from("characters").insert({
      id: characterId,
      owner_id: user.id,
      campaign_id: id,
      name: newCharacterName.trim(),
    });

    if (error) return setMessage(error.message);
    window.location.href = `/character/${characterId}`;
  }

  async function changeHp(character: any, amount: number) {
    const next = Math.min(
      character.max_hp,
      Math.max(0, character.current_hp + amount)
    );

    const { error } = await getSupabase()
      .from("characters")
      .update({ current_hp: next })
      .eq("id", character.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    await refreshCharacters();
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(campaign.invite_code);
    setMessage("คัดลอกรหัสเชิญแล้ว");
  }

  async function changeMemberRole(member: any, nextRole: "dm" | "player") {
    if (!isOwner) {
      setMessage("เฉพาะ Owner เท่านั้นที่เปลี่ยนยศสมาชิกได้");
      return;
    }

    const displayName = member.profiles?.display_name || "ผู้เล่น";
    const actionText =
      nextRole === "dm" ? "แต่งตั้งเป็น DM" : "ถอดยศ DM กลับเป็น Player";

    const confirmed = window.confirm(
      `ต้องการ${actionText}ให้ “${displayName}” ใช่ไหม?`
    );
    if (!confirmed) return;

    setChangingRoleUserId(member.user_id);
    setMessage("");

    try {
      const { error } = await getSupabase().rpc("set_campaign_member_role", {
        target_campaign: id,
        target_user: member.user_id,
        new_role: nextRole,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage(
        nextRole === "dm"
          ? `แต่งตั้ง ${displayName} เป็น DM แล้ว`
          : `ถอดยศ DM ของ ${displayName} แล้ว`
      );
      await refreshMembers();
    } finally {
      setChangingRoleUserId(null);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="appShell">
        <Loading text="กำลังเปิดบันทึกแคมเปญ…" />
      </main>
    );
  }

  if (!campaign) {
    return (
      <main className="appShell">
        <AppNav />
        <div className="emptyPanel">
          ไม่พบแคมเปญ หรือคุณไม่มีสิทธิ์เข้าถึง
        </div>
      </main>
    );
  }

  function roleLabel(role: string) {
    if (role === "owner") return "Owner";
    if (role === "dm") return "Dungeon Master";
    return "Player";
  }

  return (
    <main className="appShell">
      <AppNav subtitle={campaign.name} />

      <section className="campaignHeader">
        <div>
          <p className="eyebrow">
            {isOwner
              ? "Campaign Owner View"
              : isDm
              ? "Dungeon Master View"
              : "Adventurer View"}
          </p>
          <h1>{campaign.name}</h1>
          <p>{campaign.description || "ยังไม่มีคำอธิบายแคมเปญ"}</p>
        </div>

        <div className="inviteSeal">
          <small>รหัสเชิญ</small>
          <strong>{campaign.invite_code}</strong>
          <button className="tinyButton" onClick={copyInvite}>
            คัดลอก
          </button>
        </div>
      </section>

      <nav className={styles.campaignTabs} aria-label="เมนูแคมเปญ">
        <button
          className={activeTab === "overview" ? styles.active : ""}
          onClick={() => setActiveTab("overview")}
        >
          <span>⌂</span>
          <div>
            <small>OVERVIEW</small>
            <strong>ภาพรวม</strong>
          </div>
        </button>

        {isDm ? (
          <button
            className={activeTab === "vault" ? styles.active : ""}
            onClick={() => setActiveTab("vault")}
          >
            <span>♛</span>
            <div>
              <small>DM ONLY</small>
              <strong>คลังพระเจ้า</strong>
            </div>
          </button>
        ) : null}

        {isOwner ? (
          <button
            className={activeTab === "settings" ? styles.active : ""}
            onClick={() => setActiveTab("settings")}
          >
            <span>⚙</span>
            <div>
              <small>OWNER ONLY</small>
              <strong>ตั้งค่าแคมเปญ</strong>
            </div>
          </button>
        ) : null}
      </nav>

      {message ? <p className="notice banner">{message}</p> : null}

      {activeTab === "overview" ? (
        <section className="campaignLayout">
          <div className="mainColumn">
            <section className="panel">
              <div className="panelTitleRow">
                <div>
                  <p className="eyebrow">Party Status</p>
                  <h2>สมาชิกและตัวละคร</h2>
                </div>
                <span className="counterPill">
                  {characters.length} ตัวละคร
                </span>
              </div>

              <div className="partyList">
                {characters.length ? (
                  characters.map((character) => {
                    const hpPercent = character.max_hp
                      ? Math.round(
                          (character.current_hp / character.max_hp) * 100
                        )
                      : 0;

                    return (
                      <div className="partyRow" key={character.id}>
                        <Link
                          href={`/character/${character.id}`}
                          className="partyIdentity"
                        >
                          <div className="avatarCircle">
                            {character.portrait_url ? (
                              <img src={character.portrait_url} alt="" />
                            ) : (
                              "♜"
                            )}
                          </div>

                          <div>
                            <small>
                              {character.rank} · LV.{character.level}
                            </small>
                            <strong>{character.name}</strong>
                            <span>
                              {character.class_name || "ไม่ระบุคลาส"}
                            </span>
                          </div>
                        </Link>

                        <div className="partyResources">
                          <div className="miniResource">
                            <span>
                              HP {character.current_hp}/{character.max_hp}
                            </span>
                            <div>
                              <i style={{ width: `${hpPercent}%` }} />
                            </div>
                          </div>

                          {isDm ? (
                            <div className="hpControls">
                              <button onClick={() => changeHp(character, -5)}>
                                −5
                              </button>
                              <button onClick={() => changeHp(character, -1)}>
                                −1
                              </button>
                              <button onClick={() => changeHp(character, 1)}>
                                +1
                              </button>
                              <button onClick={() => changeHp(character, 5)}>
                                +5
                              </button>
                              <Link href={`/character/${character.id}#inventory`}>
                                เปิดคลัง
                              </Link>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="emptyText">ยังไม่มีตัวละครในแคมเปญนี้</p>
                )}
              </div>

              <form
                className="inlineForm topGap"
                onSubmit={createCharacter}
              >
                <input
                  value={newCharacterName}
                  onChange={(event) =>
                    setNewCharacterName(event.target.value)
                  }
                  placeholder="ชื่อตัวละครใหม่"
                  required
                />
                <button className="button">เพิ่มตัวละครของฉัน</button>
              </form>
            </section>

            {user ? (
              <DiceRoller
                campaignId={id}
                userId={user.id}
                onRolled={refreshRolls}
              />
            ) : null}

            <section className="panel">
              <p className="eyebrow">Roll History</p>
              <h2>ประวัติการทอยล่าสุด</h2>

              <div className="rollLog">
                {rolls.length ? (
                  rolls.map((roll) => (
                    <div className="rollRow" key={roll.id}>
                      <span className="rollTotal">{roll.result}</span>
                      <div>
                        <strong>
                          {roll.profiles?.display_name || "นักผจญภัย"}
                        </strong>
                        <p>
                          {roll.expression} · {roll.detail}
                        </p>
                      </div>
                      <time>
                        {new Date(roll.created_at).toLocaleString("th-TH")}
                      </time>
                    </div>
                  ))
                ) : (
                  <p className="emptyText">ยังไม่มีการทอยลูกเต๋า</p>
                )}
              </div>
            </section>
          </div>

          <aside className="sideColumn">
            <section className="panel stickyPanel">
              <p className="eyebrow">Party Members</p>
              <h2>สมาชิกโต๊ะ</h2>

              <div className="memberList">
                {members.map((member) => (
                  <div className="memberRow" key={member.user_id}>
                    <div className="avatarSmall">
                      {member.profiles?.display_name?.[0] || "?"}
                    </div>
                    <div>
                      <strong>
                        {member.profiles?.display_name || "ผู้เล่น"}
                      </strong>
                      <small>{roleLabel(member.role)}</small>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      ) : null}

      {activeTab === "vault" && isDm && user ? (
        <GodVault campaignId={id} userId={user.id} />
      ) : null}

      {activeTab === "settings" && isOwner ? (
        <section className={styles.settingsLayout}>
          <section className="panel">
            <p className="eyebrow">Campaign Authority</p>
            <h2>จัดการยศสมาชิก</h2>
            <p className="mutedText">
              เฉพาะ Owner เท่านั้นที่แต่งตั้งหรือถอดยศ DM ได้
            </p>

            <div className={styles.roleList}>
              {members.map((member) => {
                const changing = changingRoleUserId === member.user_id;
                const memberIsOwner =
                  member.role === "owner" ||
                  member.user_id === campaign.dm_user_id;

                return (
                  <article className={styles.roleCard} key={member.user_id}>
                    <div className="avatarSmall">
                      {member.profiles?.display_name?.[0] || "?"}
                    </div>

                    <div className={styles.roleIdentity}>
                      <strong>
                        {member.profiles?.display_name || "ผู้เล่น"}
                      </strong>
                      <span
                        className={`${styles.roleBadge} ${
                          styles[
                            `role_${memberIsOwner ? "owner" : member.role}`
                          ]
                        }`}
                      >
                        {memberIsOwner ? "Owner" : roleLabel(member.role)}
                      </span>
                    </div>

                    <div className={styles.roleActions}>
                      {memberIsOwner ? (
                        <span className={styles.protectedRole}>
                          เจ้าของแคมเปญ
                        </span>
                      ) : member.role === "dm" ? (
                        <button
                          className="tinyButton danger"
                          disabled={changing}
                          onClick={() =>
                            changeMemberRole(member, "player")
                          }
                        >
                          {changing ? "กำลังเปลี่ยน…" : "ถอดยศ DM"}
                        </button>
                      ) : (
                        <button
                          className="tinyButton"
                          disabled={changing}
                          onClick={() => changeMemberRole(member, "dm")}
                        >
                          {changing ? "กำลังเปลี่ยน…" : "แต่งตั้งเป็น DM"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="panel">
            <p className="eyebrow">Permission Rules</p>
            <h2>ขอบเขตอำนาจ</h2>
            <div className={styles.permissionNotes}>
              <p>
                <strong>Owner</strong>
                จัดการ DM ตั้งค่าแคมเปญ และลบแคมเปญได้
              </p>
              <p>
                <strong>DM</strong>
                ใช้คลังพระเจ้าและจัดการข้อมูลภายในแคมเปญได้
              </p>
              <p>
                <strong>Player</strong>
                ใช้ตัวละคร ทอยลูกเต๋า และดูข้อมูลที่ได้รับอนุญาต
              </p>
            </div>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
