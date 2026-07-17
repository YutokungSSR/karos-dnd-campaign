"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export function useAuth(redirectWhenSignedOut = true) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabase();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
      if (!data.user && redirectWhenSignedOut) router.replace("/");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (!session?.user && redirectWhenSignedOut) router.replace("/");
    });

    return () => listener.subscription.unsubscribe();
  }, [redirectWhenSignedOut, router]);

  return { user, loading };
}
