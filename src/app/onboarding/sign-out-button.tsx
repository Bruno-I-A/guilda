"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** Encerra a sessão e volta ao login, onde a sessão nova escolhe uma organização válida. */
export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <Button type="button" onClick={signOut} disabled={busy} className="w-full">
      {busy ? "Saindo…" : label}
    </Button>
  );
}
