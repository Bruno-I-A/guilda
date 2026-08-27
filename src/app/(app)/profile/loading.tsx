import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /profile.
 *
 * O perfil resolve cinco coisas em paralelo (XP total, missões concluídas,
 * histórico do ledger, conexão do Telegram e o usuário do bot). A silhueta:
 * cabeçalho, identidade, o card de vitrine com a constelação e a barra de
 * XP, e as seções de preferências e histórico.
 */

/** A constelação é um SVG 680x300 — o bloco reserva a mesma proporção. */
const CONSTELLATION_ASPECT = "aspect-[68/30]";

/** Chaves de notificação do Telegram: linhas com rótulo + interruptor. */
const TELEGRAM_ROWS = ["w-40", "w-48", "w-36", "w-44"] as const;

/** Últimos lançamentos do ledger de XP. */
const HISTORY_ROWS = ["w-2/3", "w-1/2", "w-3/5", "w-2/5", "w-3/4"] as const;

export default function ProfileLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando o seu perfil"
      className="grid gap-6"
    >
      <span className="sr-only">Carregando o seu perfil…</span>

      <div aria-hidden className="grid gap-6">
        {/* Cabeçalho */}
        <Skeleton className="h-7 w-28 rounded-none" />

        {/* Identidade: avatar, nome/e-mail e o papel na org */}
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Skeleton className="h-4 w-40 rounded-none" />
            <Skeleton className="h-3 w-56 max-w-full rounded-none" />
          </div>
          <Skeleton className="h-5 w-20 shrink-0 rounded-none" />
        </div>

        {/* Vitrine: constelação de progressão + barra de XP */}
        <section className="panel-cut texture-iron grid gap-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-3 w-48 rounded-none" />
            <Skeleton className="h-3.5 w-24 rounded-none" />
          </div>
          <Skeleton className={`w-full rounded-none ${CONSTELLATION_ASPECT}`} />
          {/* Barra de XP: h-5, igual ao <XpBar>. */}
          <Skeleton className="h-5 w-full rounded-none" />
          <Skeleton className="h-3.5 w-full max-w-md rounded-none" />
        </section>

        {/* Notificações do Telegram */}
        <section className="panel-cut grid gap-4 p-5">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-40 rounded-none" />
            <Skeleton className="h-3.5 w-64 max-w-full rounded-none" />
          </div>
          <div className="grid gap-3">
            {TELEGRAM_ROWS.map((width, index) => (
              <div key={index} className="flex items-center justify-between gap-3">
                <Skeleton className={`h-3.5 rounded-none ${width}`} />
                <Skeleton className="h-5 w-9 shrink-0 rounded-none" />
              </div>
            ))}
          </div>
        </section>

        {/* Histórico de XP: lançamentos do ledger */}
        <section className="panel-cut grid gap-3 py-5">
          <div className="grid gap-2 px-6">
            <Skeleton className="h-4 w-36 rounded-none" />
            <Skeleton className="h-3.5 w-56 max-w-full rounded-none" />
          </div>
          <div className="grid">
            {HISTORY_ROWS.map((width, index) => (
              <div
                key={index}
                className="flex items-center gap-3 border-b border-border px-6 py-2.5 last:border-b-0"
              >
                <Skeleton className="size-4 shrink-0 rounded-none" />
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <Skeleton className={`h-4 rounded-none ${width}`} />
                  <Skeleton className="h-3 w-40 max-w-full rounded-none" />
                </div>
                <Skeleton className="h-4 w-16 shrink-0 rounded-none" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
