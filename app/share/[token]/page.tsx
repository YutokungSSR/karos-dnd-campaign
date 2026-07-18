"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import CharacterReadOnly from "@/components/CharacterReadOnly";
import Loading from "@/components/Loading";
import { getSupabase } from "@/lib/supabase";

export default function SharedCharacterPage() {
  const params = useParams();
  const token = params.token as string;
  const [character, setCharacter] = useState<any>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [conditions, setConditions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const { data: char } = await supabase.from("characters").select("*").eq("share_token", token).eq("is_public", true).maybeSingle();
      if (!char) { setLoading(false); return; }
      const [skillResult, conditionResult] = await Promise.all([
        supabase.from("skills").select("*").eq("character_id", char.id).order("sort_order"),
        supabase.from("conditions").select("*").eq("character_id", char.id).order("created_at"),
      ]);
      setCharacter(char); setSkills(skillResult.data ?? []); setConditions(conditionResult.data ?? []); setLoading(false);
    }
    load();
  }, [token]);

  if (loading) return <main className="appShell"><Loading /></main>;
  if (!character) return <main className="appShell"><div className="sharedHeader"><Link href="/" className="brandLink"><small>Karos Campaign Archive</small><strong>มหาคัมภีร์แห่งออดมา</strong></Link></div><div className="emptyPanel">ไม่พบตัวละคร หรือลิงก์นี้ถูกปิดการแชร์แล้ว</div></main>;

  return <main className="appShell wideShell"><div className="sharedHeader"><Link href="/" className="brandLink"><small>Public Character Record</small><strong>มหาคัมภีร์แห่งออดมา</strong></Link><span>โหมดดูอย่างเดียว</span></div><CharacterReadOnly character={character} skills={skills} conditions={conditions} /></main>;
}
