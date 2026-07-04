import type { Metadata } from "next";

import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Criar conta" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; email?: string }>;
}) {
  const { invite, email } = await searchParams;
  return <SignUpForm inviteId={invite} inviteEmail={email} />;
}
