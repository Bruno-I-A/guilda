"use client";

import {
  Building2,
  ChevronRight,
  CircleUser,
  Flag,
  Home,
  Inbox,
  KeyRound,
  ListTodo,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";

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
 * No desktop, a navegação deixa de ser uma lista indiferenciada. A barra vira
 * um mapa de rotas: primeiro o trabalho do dia, depois a operação e, por
 * fim, os espaços da Guilda. Perfil e ajustes vivem junto da identidade.
 */
const DESKTOP_NAV_GROUPS = [
  { code: "01", label: "Jornada", hrefs: ["/dashboard", "/tasks", "/mural"] },
  { code: "02", label: "Operação", hrefs: ["/clans", "/informativos", "/clients"] },
  { code: "03", label: "Guilda", hrefs: ["/leaderboard", "/members"] },
] as const;

const DESKTOP_ACCOUNT_HREFS = ["/profile", "/settings"] as const;

const SIDEBAR_PREFERENCE_KEY = "guilda.sidebar-collapsed";
const SIDEBAR_PREFERENCE_EVENT = "guilda:sidebar-preference-changed";

function subscribeToSidebarPreference(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SIDEBAR_PREFERENCE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SIDEBAR_PREFERENCE_EVENT, onStoreChange);
  };
}

function getSidebarPreference() {
  return window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === "true";
}

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
      className="inline-flex min-w-5 items-center justify-center border border-destructive/80 bg-destructive px-1 font-mono text-[10px] leading-4 text-destructive-foreground [clip-path:polygon(0.2rem_0,100%_0,100%_calc(100%-0.2rem),calc(100%-0.2rem)_100%,0_100%,0_0.2rem)]"
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
  const sidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarPreference,
    getSidebarPreference,
    () => false,
  );

  function setSidebarVisibility(collapsed: boolean) {
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(collapsed));
    window.dispatchEvent(new Event(SIDEBAR_PREFERENCE_EVENT));
  }

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
  const navByHref = new Map(navItems.map((item) => [item.href, item]));
  const accountItems = DESKTOP_ACCOUNT_HREFS
    .map((href) => navByHref.get(href))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));

  return (
    <div className="flex min-h-svh w-full">
      {/* Sidebar — desktop */}
      <aside
        inert={sidebarCollapsed}
        aria-hidden={sidebarCollapsed || undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-72 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar/95 transition-transform duration-300 ease-out md:flex",
          sidebarCollapsed ? "-translate-x-full" : "translate-x-0",
        )}
      >
        <div className="relative px-5 pt-5 pb-4">
          <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          <div className="flex items-start justify-between gap-3">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-3" aria-label="Ir para o início">
              <span className="grid size-10 shrink-0 place-items-center border border-primary/50 bg-primary/10 [clip-path:polygon(0.45rem_0,100%_0,100%_calc(100%-0.45rem),calc(100%-0.45rem)_100%,0_100%,0_0.45rem)]">
                <GuildSeal className="size-7" />
              </span>
              <span className="grid min-w-0 leading-none">
                <span className="hud-label truncate text-[9px] tracking-[0.28em]">Mesa de comando</span>
                <span className="mt-1 font-heading text-xl font-semibold tracking-[0.11em]">Guilda</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setSidebarVisibility(true)}
              aria-label="Esconder navegação lateral"
              title="Esconder navegação lateral"
              className="grid size-8 shrink-0 place-items-center border border-sidebar-border text-muted-foreground transition-colors hover:border-primary/60 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PanelLeftClose className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="mx-4 border border-sidebar-border bg-[linear-gradient(120deg,oklch(0.3_0.04_245_/_35%),transparent_65%)] px-3 py-3 [clip-path:polygon(0.55rem_0,100%_0,100%_calc(100%-0.55rem),calc(100%-0.55rem)_100%,0_100%,0_0.55rem)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="hud-label text-[9px]">Organização ativa</p>
              <p className="mt-1 truncate font-heading text-base font-medium tracking-wide">{orgName}</p>
            </div>
            <span className="mt-1 size-2 shrink-0 border border-primary/80 bg-primary/40 [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]" aria-label="Organização ativa" />
          </div>
          <p className="mt-2 border-t border-sidebar-border pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">ambiente de trabalho</p>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-4 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Principal">
          <div className="grid gap-5">
            {DESKTOP_NAV_GROUPS.map((group) => (
              <section key={group.code}>
                <div className="flex items-center gap-2 px-1">
                  <span className="font-mono text-[10px] text-primary/80">{group.code}</span>
                  <p className="hud-label text-[9px]">{group.label}</p>
                  <span className="h-px flex-1 bg-sidebar-border" aria-hidden />
                </div>
                <div className="relative mt-2 grid gap-1">
                  <span aria-hidden className="absolute top-4 bottom-4 left-4 w-px bg-gradient-to-b from-primary/40 via-sidebar-border to-transparent" />
                  {group.hrefs.map((href) => {
                    const item = navByHref.get(href);
                    if (!item) return null;
                    const { label, icon: Icon } = item;
                    const active = pathname.startsWith(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group relative z-10 flex min-h-11 items-center gap-3 border border-transparent py-1 pr-2 pl-1 transition-all",
                          active
                            ? "border-primary/45 bg-primary/10 text-foreground [clip-path:polygon(0.5rem_0,100%_0,100%_calc(100%-0.5rem),calc(100%-0.5rem)_100%,0_100%,0_0.5rem)]"
                            : "text-muted-foreground hover:border-sidebar-border hover:bg-accent/35 hover:text-foreground",
                        )}
                      >
                        <span className={cn("grid size-8 place-items-center border bg-sidebar transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-sidebar-border group-hover:border-primary/55")}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
                        {href === "/mural" ? <PendingBadge count={pendingNotices} /> : null}
                        {active ? <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-primary">agora</span> : <ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-70" aria-hidden />}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-auto pt-6">
            <div className="divider-rune mb-4" />
            <div className="flex items-center gap-2 px-1">
              <span className="font-mono text-[10px] text-primary/80">04</span>
              <p className="hud-label text-[9px]">Conta</p>
              <span className="h-px flex-1 bg-sidebar-border" aria-hidden />
            </div>
            <div className="mt-2 grid gap-1">
              {accountItems.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 border-l-2 px-2 py-2 text-sm font-medium transition-colors", active ? "border-primary bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-accent/35 hover:text-foreground")}>
                    <Icon className="size-4" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {active ? <span className="size-1.5 bg-primary [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]" aria-hidden /> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        <div className="border-t border-sidebar-border bg-background/20 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <UserMenu user={user} role={role} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{ROLE_LABELS[role] ?? role}</p>
            </div>
            <span className="size-1.5 bg-success [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]" aria-label="Conectado" />
          </div>
        </div>
      </aside>

      <button
        type="button"
        onClick={() => setSidebarVisibility(false)}
        aria-label="Mostrar navegação lateral"
        title="Mostrar navegação lateral"
        className={cn(
          "fixed top-5 left-0 z-40 hidden size-10 place-items-center border border-l-0 border-sidebar-border bg-sidebar text-muted-foreground shadow-lg transition-all duration-300 hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid",
          sidebarCollapsed
            ? "translate-x-0 opacity-100"
            : "-translate-x-full opacity-0 pointer-events-none",
        )}
      >
        <PanelLeftOpen className="size-4" aria-hidden />
      </button>

      {/* Conteúdo */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-300 ease-out",
          sidebarCollapsed ? "md:pl-0" : "md:pl-72",
        )}
      >
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
