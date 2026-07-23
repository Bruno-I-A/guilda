"use client";

import {
  Building2,
  CalendarCheck2,
  CircleUser,
  Home,
  ListTodo,
  LogOut,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { initials, ROLE_LABELS } from "@/lib/people";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Início", icon: Home },
  { href: "/tasks", label: "Missões", icon: ListTodo },
  { href: "/closings", label: "Fechamentos", icon: CalendarCheck2 },
  { href: "/clients", label: "Clientes", icon: Building2 },
  { href: "/leaderboard", label: "Ranking", icon: Trophy },
  { href: "/members", label: "Membros", icon: Users },
  { href: "/profile", label: "Perfil", icon: CircleUser },
] as const;

function UserMenu({
  user,
  role,
}: {
  user: { name: string; email: string };
  role: string;
}) {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menu do usuário"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
          <Badge variant="secondary" className="mt-1 w-fit">
            {ROLE_LABELS[role] ?? role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <CircleUser aria-hidden /> Perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={handleSignOut}>
          <LogOut aria-hidden /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  orgName,
  user,
  role,
  children,
}: {
  orgName: string;
  user: { name: string; email: string };
  role: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-svh w-full">
      {/* Sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4 font-heading text-lg font-semibold tracking-wider">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Swords className="size-4" aria-hidden />
          </span>
          Guilda
        </div>
        <div className="px-4 py-3">
          <p className="hud-label">Organização</p>
          <p className="truncate text-sm font-medium">{orgName}</p>
        </div>
        <div className="divider-rune mx-4 mb-2" />
        <nav className="flex flex-1 flex-col gap-1 px-2" aria-label="Principal">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-accent/60 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-between border-t p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <UserMenu user={user} role={role} />
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col md:pl-56">
        {/* Header — mobile */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <div className="flex min-w-0 items-center gap-2 font-semibold">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Swords className="size-4" aria-hidden />
            </span>
            <span className="truncate">{orgName}</span>
          </div>
          <UserMenu user={user} role={role} />
        </header>

        <main className="flex-1 px-4 py-6 pb-24 md:px-8 md:pb-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>

        {/* Tab bar — mobile */}
        <nav
          aria-label="Navegação inferior"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t bg-background/95 backdrop-blur md:hidden"
        >
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 border-t-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-[11px] font-medium",
                  active ? "border-primary text-primary" : "border-transparent text-muted-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="max-w-full truncate px-0.5">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
