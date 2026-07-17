"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export default function AppNav({ subtitle }: { subtitle?: string }) {
  const router = useRouter();

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace("/");
  }

  return (
    <header className="topbar">
      <Link href="/dashboard" className="brandLink">
        <small>Karos Campaign Archive</small>
        <strong>มหาคัมภีร์แห่งออดมา</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </Link>
      <nav className="navActions">
        <Link className="button ghost" href="/dashboard">หน้าหลัก</Link>
        <button className="button danger" onClick={signOut}>ออกจากระบบ</button>
      </nav>
    </header>
  );
}
