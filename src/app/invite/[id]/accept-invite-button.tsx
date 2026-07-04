"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export function AcceptInviteButton({
  invitationId,
  organizationId,
}: {
  invitationId: string;
  organizationId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function accept() {
    setSubmitting(true);
    const { error } = await authClient.organization.acceptInvitation({
      invitationId,
    });
    if (error) {
      setSubmitting(false);
      toast.error(authErrorMessage(error));
      return;
    }
    await authClient.organization.setActive({ organizationId });
    toast.success("Bem-vindo(a) à guilda!");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Button onClick={accept} disabled={submitting} className="w-full">
      {submitting ? "Aceitando…" : "Aceitar convite"}
    </Button>
  );
}
