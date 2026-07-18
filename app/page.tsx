"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

type AuthMode = "login" | "signup" | "forgot" | "recovery";

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const search = new URLSearchParams(window.location.search);
    const recoveryLink =
      hash.get("type") === "recovery" ||
      search.get("type") === "recovery" ||
      search.has("code");

    const errorDescription =
      hash.get("error_description") || search.get("error_description");

    if (errorDescription) {
      setMessage(decodeURIComponent(errorDescription.replace(/\+/g, " ")));
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (event === "PASSWORD_RECOVERY") {
        setMode("recovery");
        setMessage("ลิงก์กู้คืนได้รับการยืนยันแล้ว กรุณาตั้งรหัสผ่านใหม่");
        return;
      }

      if (event === "SIGNED_IN" && session && !recoveryLink) {
        router.replace("/dashboard");
      }
    });

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;

      if (recoveryLink) {
        setMode("recovery");
        return;
      }

      if (data.user) router.replace("/dashboard");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    setPassword("");
    setConfirmPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const supabase = getSupabase();
    const normalizedEmail = email.trim().toLowerCase();

    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          normalizedEmail,
          {
            redirectTo: `${window.location.origin}/`,
          }
        );

        if (error) throw error;

        setMessage(
          "หากอีเมลนี้มีบัญชีอยู่ ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว กรุณาตรวจกล่องจดหมายและจดหมายขยะ"
        );
        return;
      }

      if (mode === "recovery") {
        if (password.length < 6) {
          setMessage("รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร");
          return;
        }

        if (password !== confirmPassword) {
          setMessage("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
          return;
        }

        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;

        await supabase.auth.signOut();
        window.history.replaceState({}, "", "/");

        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setMessage(
          "ตั้งรหัสผ่านใหม่สำเร็จแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่"
        );
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              display_name:
                displayName.trim() || normalizedEmail.split("@")[0],
            },
            emailRedirectTo: `${window.location.origin}/dashboard`,
          },
        });

        if (error) throw error;

        if (data.session) router.replace("/dashboard");
        else setMessage("สร้างบัญชีแล้ว กรุณาตรวจอีเมลเพื่อยืนยันบัญชี");

        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) throw error;
      router.replace("/dashboard");
    } catch (error) {
      const fallback =
        mode === "forgot"
          ? "ส่งอีเมลตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณารอสักครู่แล้วลองอีกครั้ง"
          : mode === "recovery"
            ? "ตั้งรหัสผ่านใหม่ไม่สำเร็จ ลิงก์อาจหมดอายุ กรุณาขอลิงก์ใหม่"
            : "เข้าสู่ระบบไม่สำเร็จ";

      setMessage(error instanceof Error ? error.message : fallback);
    } finally {
      setLoading(false);
    }
  }

  const submitLabel = loading
    ? mode === "forgot"
      ? "กำลังส่งคัมภีร์กู้คืน…"
      : mode === "recovery"
        ? "กำลังผนึกรหัสผ่านใหม่…"
        : "กำลังเปิดประตูมิติ…"
    : mode === "login"
      ? "เข้าสู่มหาคัมภีร์"
      : mode === "signup"
        ? "สร้างนักผจญภัย"
        : mode === "forgot"
          ? "ส่งลิงก์ตั้งรหัสผ่านใหม่"
          : "ยืนยันรหัสผ่านใหม่";

  return (
    <main className="landingShell">
      <section className="heroPanel">
        <div className="heroSigil">✦</div>
        <p className="eyebrow">The Chronicles of Audma</p>
        <h1>มหาคัมภีร์แห่งออดมา</h1>
        <p className="heroLead">
          ศูนย์รวมแคมเปญ ตัวละคร สกิล ไอเทม และบันทึกการผจญภัย
          สำหรับจักรวาล D&D ของคุณ
        </p>
        <div className="featureRunes">
          <span>⚔ แคมเปญออนไลน์</span>
          <span>♜ หน้าต่างสเตตัส</span>
          <span>⚄ ทอยลูกเต๋า</span>
          <span>✧ สิทธิ์ DM</span>
        </div>
      </section>

      <section className="authPanel">
        {mode !== "recovery" ? (
          <div className="authTabs">
            <button
              type="button"
              className={mode !== "signup" ? "active" : ""}
              onClick={() => changeMode("login")}
            >
              เข้าสู่ระบบ
            </button>
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => changeMode("signup")}
            >
              สร้างบัญชี
            </button>
          </div>
        ) : null}

        {mode === "forgot" ? (
          <div>
            <p className="eyebrow">Password Recovery</p>
            <h2>กู้คืนรหัสผ่าน</h2>
            <p className="mutedText">
              กรอกอีเมลที่ใช้สมัคร
              ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้คุณ
            </p>
          </div>
        ) : null}

        {mode === "recovery" ? (
          <div>
            <p className="eyebrow">New Password</p>
            <h2>ตั้งรหัสผ่านใหม่</h2>
            <p className="mutedText">
              กำหนดรหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร
              แล้วใช้รหัสนี้เข้าสู่ระบบครั้งถัดไป
            </p>
          </div>
        ) : null}

        <form onSubmit={submit} className="formStack">
          {mode === "signup" ? (
            <label>
              ชื่อที่แสดง
              <input
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="เช่น Karos"
              />
            </label>
          ) : null}

          {mode !== "recovery" ? (
            <label>
              อีเมล
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
              />
            </label>
          ) : null}

          {mode !== "forgot" ? (
            <label>
              {mode === "recovery" ? "รหัสผ่านใหม่" : "รหัสผ่าน"}
              <input
                required
                minLength={6}
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="อย่างน้อย 6 ตัวอักษร"
              />
            </label>
          ) : null}

          {mode === "recovery" ? (
            <label>
              ยืนยันรหัสผ่านใหม่
              <input
                required
                minLength={6}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
              />
            </label>
          ) : null}

          <button className="button large" disabled={loading}>
            {submitLabel}
          </button>

          {mode === "login" ? (
            <button
              type="button"
              className="tinyButton ghost"
              onClick={() => changeMode("forgot")}
            >
              ลืมรหัสผ่าน?
            </button>
          ) : null}

          {mode === "forgot" ? (
            <button
              type="button"
              className="tinyButton ghost"
              onClick={() => changeMode("login")}
            >
              ← กลับไปเข้าสู่ระบบ
            </button>
          ) : null}
        </form>

        {message ? <p className="notice">{message}</p> : null}
      </section>
    </main>
  );
}
