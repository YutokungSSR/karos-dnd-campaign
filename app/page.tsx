"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/dashboard");
    });
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const supabase = getSupabase();

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName.trim() || email.split("@")[0] },
            emailRedirectTo: `${window.location.origin}/dashboard`,
          },
        });
        if (error) throw error;
        if (data.session) router.replace("/dashboard");
        else setMessage("สร้างบัญชีแล้ว กรุณาตรวจอีเมลเพื่อยืนยันบัญชี");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/dashboard");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="landingShell">
      <section className="heroPanel">
        <div className="heroSigil">✦</div>
        <p className="eyebrow">The Chronicles of Audma</p>
        <h1>มหาคัมภีร์แห่งออดมา</h1>
        <p className="heroLead">ศูนย์รวมแคมเปญ ตัวละคร สกิล ไอเทม และบันทึกการผจญภัย สำหรับจักรวาล D&D ของคุณ</p>
        <div className="featureRunes">
          <span>⚔ แคมเปญออนไลน์</span><span>♜ หน้าต่างสเตตัส</span><span>⚄ ทอยลูกเต๋า</span><span>✧ สิทธิ์ DM</span>
        </div>
      </section>

      <section className="authPanel">
        <div className="authTabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>เข้าสู่ระบบ</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>สร้างบัญชี</button>
        </div>
        <form onSubmit={submit} className="formStack">
          {mode === "signup" ? <label>ชื่อที่แสดง<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="เช่น Karos" /></label> : null}
          <label>อีเมล<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
          <label>รหัสผ่าน<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" /></label>
          <button className="button large" disabled={loading}>{loading ? "กำลังเปิดประตูมิติ…" : mode === "login" ? "เข้าสู่มหาคัมภีร์" : "สร้างนักผจญภัย"}</button>
        </form>
        {message ? <p className="notice">{message}</p> : null}
      </section>
    </main>
  );
}
