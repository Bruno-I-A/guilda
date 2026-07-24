import type { Metadata } from "next";

import { requireSession } from "@/lib/session";

import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Alterar senha" };

export default async function ChangePasswordPage() {
  const session = await requireSession();
  return <ChangePasswordForm forced={session.user.mustChangePassword} />;
}
