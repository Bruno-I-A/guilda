import type { Metadata } from "next";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // evita open redirect: só aceita caminhos internos
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return <SignInForm next={safeNext} />;
}
