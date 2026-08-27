"use client";

import { useState } from "react";

import { SegmentedNav, type SegmentedNavItem } from "@/components/segmented-nav";
import { type ClanTab, clanTabsFor } from "@/lib/clan-tabs";

/**
 * Seções do clã.
 *
 * A navegação continua sendo por URL — cada aba é um <Link> —, então quem
 * desenha as abas é o <SegmentedNav>. Isto aqui era uma das quatro cópias
 * byte-idênticas da pílula `bg-background shadow-sm`, o controle mais genérico
 * que existia no app; sobrou só a montagem dos itens.
 *
 * É client component por um motivo só: `aria-busy`. Trocar de aba aqui é ida e
 * volta ao servidor (cada aba faz a própria consulta), e antes disto não havia
 * sinal nenhum de que algo estava acontecendo — a tela ficava parada e o
 * leitor de tela não tinha como saber que a região ia mudar.
 */
export function ClanTabNav({
  clanId,
  clanSlug,
  active,
}: {
  clanId: string;
  clanSlug: string;
  active: ClanTab;
}) {
  const [pending, setPending] = useState(false);
  const [navigatingFrom, setNavigatingFrom] = useState(active);

  // A aba ativa vem do servidor: quando ela muda, a navegação terminou.
  // Ajuste durante o render (padrão do React para estado derivado de prop),
  // não efeito: o efeito só rodaria DEPOIS de pintar, e existiria um quadro
  // com a aba nova já visível e ainda marcada como pendente.
  // (Também zera se o usuário voltar pelo histórico para a aba de origem.)
  if (navigatingFrom !== active) {
    setNavigatingFrom(active);
    setPending(false);
  }

  const items: SegmentedNavItem[] = clanTabsFor(clanSlug).map(
    ({ key, label }) => ({
      key,
      label,
      href: `/clans/${clanId}?tab=${key}`,
    }),
  );

  return (
    // Delegação de clique: o <Link> é do SegmentedNav e o evento sobe até
    // aqui. Nada é interceptado — sem `preventDefault`, o Link navega como
    // sempre, e ctrl/cmd/shift-clique (nova aba) nem chega a marcar pendente,
    // porque essa navegação não acontece nesta página.
    <div
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const link = target.closest("a");
        // Clicar na aba já aberta não navega — marcar pendente aqui deixaria o
        // estado preso, porque `active` nunca mudaria para destravá-lo.
        if (!link || link.getAttribute("aria-current") === "page") return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        setPending(true);
      }}
    >
      <SegmentedNav
        items={items}
        active={active}
        label="Seções do clã"
        busy={pending}
      />
    </div>
  );
}
