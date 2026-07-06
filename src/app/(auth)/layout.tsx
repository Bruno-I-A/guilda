import { Swords } from "lucide-react";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center gap-3 font-heading text-2xl font-semibold tracking-widest">
        <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Swords className="size-5" aria-hidden />
        </span>
        Guilda
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
