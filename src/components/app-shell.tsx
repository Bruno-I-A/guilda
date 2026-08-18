"use client";

import {
  Building2,
  CircleUser,
  Flag,
  Home,
  Inbox,
  KeyRound,
  ListTodo,
  LogOut,
  MoreHorizontal,
  ScrollText,
  Settings,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { GuildSeal } from "@/components/guild-crest";
import { isAdminRole } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { initials, ROLE_LABELS } from "@/lib/people";
import { cn } from "@/lib/utils";

/**
 * A sidebar do desktop lista tudo. A tab bar do celular mostra apenas CINCO
 * alvos — em 360px, dez colunas dariam ~36px por item, o que não é tocável —
 * e o restante vive na folha "Mais".
 */
const NAV_ITEMS = [
  { href: "/dashboard", label: "Início", icon: Home },
  { href: "/tasks", label: "Missões", icon: ListTodo },
  { href: "/mural", label: "Mural", icon: ScrollText },
  { href: "/clans", label: "Meu clã", icon: Flag },
  { href: "/informativos", label: "Informativos", icon: Inbox },
  { href: "/clients", label: "Clientes", icon: Building2 },
  { href: "/leaderboard", label: "Ranking", icon: Trophy },
  { href: "/members", label: "Membros", icon: Users },
  { href: "/profile", label: "Perfil", icon: CircleUser },
  { href: "/settings", label: "Configurações", icon: Settings, adminOnly: true },
] as const;

const MOBILE_PRIMARY_HREFS = [
  "/dashboard",
  "/tasks",
  "/mural",
  "/clans",
] as const;

/**
 * Esconder o item não é a proteção — a própria rota /settings redireciona
 * quem não é admin. Aqui é só não oferecer porta que não abre.
 */
function navItemsFor(role: string) {
  const admin = isAdminRole(role as OrgRole);
  return NAV_ITEMS.filter((item) => !("adminOnly" in item) || admin);
}

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
        <DropdownMenuItem asChild>
          <Link href="/change-password">
            <KeyRound aria-hidden /> Alterar senha
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={handleSignOut}>
          <LogOut aria-hidden /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Contador de avisos do mural aguardando a confirmação desta pessoa. */
function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} aviso(s) aguardando confirmação`}
      className="inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[10px] leading-4 text-destructive-foreground"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function AppShell({
  orgName,
  user,
  role,
  pendingNotices = 0,
  children,
}: {
  orgName: string;
  user: { name: string; email: string };
  role: string;
  /** Avisos do mural que exigem ciência e ainda não foram confirmados. */
  pendingNotices?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [overflowOpen, setOverflowOpen] = useState(false);

  const navItems = useMemo(() => navItemsFor(role), [role]);
  const mobilePrimary = navItems.filter((item) =>
    (MOBILE_PRIMARY_HREFS as readonly string[]).includes(item.href),
  );
  const mobileOverflow = navItems.filter(
    (item) => !(MOBILE_PRIMARY_HREFS as readonly string[]).includes(item.href),
  );

  const overflowActive = mobileOverflow.some((item) =>
    pathname.startsWith(item.href),
  );

  return (
    <div className="flex min-h-svh w-full">
      {/* Sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4 font-heading text-lg font-semibold tracking-wider">
          <GuildSeal className="size-7" />
          Guilda
        </div>
        <div className="px-4 py-3">
          <p className="hud-label">Organização</p>
          <p className="truncate text-sm font-medium">{orgName}</p>
        </div>
        <div className="divider-rune mx-4 mb-2" />
        <nav className="flex flex-1 flex-col gap-1 px-2" aria-label="Principal">
          {navItems.map(({ href, label, icon: Icon }) => {
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
                <span className="flex-1">{label}</span>
                {href === "/mural" ? <PendingBadge count={pendingNotices} /> : null}
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
            <GuildSeal className="size-7" />
            <span className="truncate">{orgName}</span>
          </div>
          <UserMenu user={user} role={role} />
        </header>

        <main className="flex-1 px-4 py-6 pb-24 md:px-8 md:pb-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>

        {/* Tab bar — mobile: 4 rotas fixas + a folha "Mais" */}
        <nav
          aria-label="Navegação inferior"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 backdrop-blur md:hidden"
        >
          {mobilePrimary.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 border-t-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-[11px] font-medium",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden />
                  {href === "/mural" && pendingNotices > 0 ? (
                    <span className="absolute -top-1 -right-2">
                      <PendingBadge count={pendingNotices} />
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate px-0.5">{label}</span>
              </Link>
            );
          })}

          <Sheet open={overflowOpen} onOpenChange={setOverflowOpen}>
            <SheetTrigger
              className={cn(
                "flex flex-col items-center gap-1 border-t-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-[11px] font-medium",
                overflowActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground",
              )}
            >
              <MoreHorizontal className="size-5" aria-hidden />
              <span className="max-w-full truncate px-0.5">Mais</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
              <SheetHeader>
                <SheetTitle>Mais da Guilda</SheetTitle>
              </SheetHeader>
              <nav className="grid gap-1 px-4 pb-6" aria-label="Rotas adicionais">
                {mobileOverflow.map(({ href, label, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      // Fechar é consequência do clique, não sincronia de efeito.
                      onClick={() => setOverflowOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-md border-l-2 px-3 py-3 text-sm font-medium",
                        active
                          ? "border-primary bg-accent/60 text-foreground"
                          : "border-transparent text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      {label}
                    </Link>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
    </div>
  );
}
