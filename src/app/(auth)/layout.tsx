import { GuildCrest } from "@/components/guild-crest";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="flex flex-col items-center gap-3 font-heading text-2xl font-semibold tracking-widest">
        <GuildCrest className="size-16" />
        Guilda
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
