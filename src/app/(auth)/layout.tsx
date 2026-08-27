import { GuildCrest } from "@/components/guild-crest";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      {/*
        Logotipo, não heading: é o mesmo em sign-in, sign-up e change-password,
        então um <h1> aqui diria "Guilda" nas três e não distinguiria nenhuma.
        O <h1> de verdade é o título do card ("Entrar", "Criar conta"…).
        O `tracking-widest` é exceção deliberada da escala — é logotipo.
      */}
      <div className="flex flex-col items-center gap-3 font-heading text-2xl font-semibold tracking-widest">
        <GuildCrest className="size-16" />
        Guilda
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
