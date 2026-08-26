import { clanTabsFor, type ClanTab } from "@/lib/clan-tabs";

export const MAX_DASHBOARD_SHORTCUTS = 8;

export type DashboardShortcutIcon =
  | "tasks"
  | "new-task"
  | "mural"
  | "informatives"
  | "clients"
  | "missions"
  | "members"
  | "campaigns"
  | "commitments"
  | "portfolio"
  | "installments"
  | "fees"
  | "closings"
  | "company-data"
  | "flow";

export interface DashboardShortcutOption {
  target: string;
  label: string;
  description: string;
  href: string;
  icon: DashboardShortcutIcon;
  group: string;
}

export interface ShortcutClan {
  id: string;
  name: string;
  slug: string;
}

const GENERAL_OPTIONS: readonly DashboardShortcutOption[] = [
  {
    target: "tasks",
    label: "Minhas missões",
    description: "Acompanhar o trabalho em aberto",
    href: "/tasks",
    icon: "tasks",
    group: "Geral",
  },
  {
    target: "new-task",
    label: "Nova missão",
    description: "Criar uma missão rapidamente",
    href: "/tasks/new",
    icon: "new-task",
    group: "Geral",
  },
  {
    target: "mural",
    label: "Mural",
    description: "Ler avisos da Guilda",
    href: "/mural",
    icon: "mural",
    group: "Geral",
  },
  {
    target: "informatives",
    label: "Informativos",
    description: "Preparar e confirmar informativos",
    href: "/informativos",
    icon: "informatives",
    group: "Geral",
  },
  {
    target: "clients",
    label: "Clientes",
    description: "Consultar o cadastro das empresas",
    href: "/clients",
    icon: "clients",
    group: "Geral",
  },
];

const TAB_DESCRIPTION: Record<ClanTab, string> = {
  missions: "Missões e distribuição do clã",
  members: "Integrantes e funções do clã",
  campaigns: "Campanhas e rotinas recorrentes",
  commitments: "Planejamento de distribuição de lucros",
  portfolio: "Carteira e fichas fiscais",
  installments: "Controle dos parcelamentos",
  fees: "Controle mensal de honorários",
  closings: "Fechamentos da Contabilidade",
  "company-data": "Consulta cadastral por CNPJ",
  flow: "Fluxos de abertura, alteração e baixa",
};

export function dashboardShortcutOptions(
  clans: readonly ShortcutClan[],
): DashboardShortcutOption[] {
  const options = [...GENERAL_OPTIONS];
  for (const clan of clans) {
    for (const tab of clanTabsFor(clan.slug)) {
      options.push({
        target: `clan:${clan.id}:${tab.key}`,
        label: `${clan.name} · ${tab.label}`,
        description: TAB_DESCRIPTION[tab.key],
        href: `/clans/${clan.id}?tab=${tab.key}`,
        icon: tab.key,
        group: clan.name,
      });
    }
  }
  return options;
}

export function resolveDashboardShortcuts(
  stored: readonly { target: string; label: string }[],
  options: readonly DashboardShortcutOption[],
): DashboardShortcutOption[] {
  const optionByTarget = new Map(options.map((option) => [option.target, option]));
  return stored.flatMap((shortcut) => {
    const option = optionByTarget.get(shortcut.target);
    return option ? [{ ...option, label: shortcut.label }] : [];
  });
}
