import { cn } from "@/lib/utils";

/**
 * Brasão da guilda — Yggdrasil, a árvore do mundo, dentro de um escudo heráldico
 * rebitado. A copa aberta em cima e as raízes abrindo embaixo antecipam a árvore
 * de habilidades da tela de perfil: a marca é a semente daquela mesma imagem.
 *
 * Duas densidades da MESMA silhueta — o detalhe é que muda, não a forma:
 *
 * - <GuildCrest /> traz os quatorze rebites, o bisel interno e os galhos
 *   secundários. Usar a partir de ~40px (login, onboarding, perfil, README).
 * - <GuildSeal /> descarta o detalhe e engrossa o traço. Usar até ~32px
 *   (sidebar, header mobile, favicon). Abaixo de 40px os rebites do completo
 *   viram ruído — é o motivo de as duas versões existirem.
 *
 * Cores saem dos tokens --crest-* (globals.css), então o brasão acompanha o tema.
 * O ícone estático equivalente vive em src/app/icon.svg, com as cores literais.
 */

type CrestProps = React.SVGProps<SVGSVGElement>;

export function GuildCrest({ className, ...props }: CrestProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      aria-hidden
      {...props}
    >
      {/* Escudo: ombros chanfrados em 45°, mesma linguagem dos painéis do app */}
      <path
        d="M17 7H47L57 17V30C57 43.5 46.6 53.6 32 59C17.4 53.6 7 43.5 7 30V17Z"
        fill="var(--crest-plate)"
        stroke="var(--crest-edge)"
        strokeWidth="2.4"
        strokeLinejoin="miter"
      />
      <path
        d="M20 11.5H45.2L52.8 19.1V30C52.8 41.2 44.3 49.7 32 54.6C19.7 49.7 11.2 41.2 11.2 30V19.1Z"
        fill="none"
        stroke="var(--crest-bevel)"
        strokeWidth="1"
      />
      {/* Rebites acompanhando a moldura de ferro */}
      <g fill="var(--crest-edge)">
        <circle cx="24" cy="9.2" r="1.15" />
        <circle cx="32" cy="9.2" r="1.15" />
        <circle cx="40" cy="9.2" r="1.15" />
        <circle cx="50.4" cy="13.6" r="1.15" />
        <circle cx="13.6" cy="13.6" r="1.15" />
        <circle cx="54.9" cy="23" r="1.15" />
        <circle cx="54.9" cy="31" r="1.15" />
        <circle cx="9.1" cy="23" r="1.15" />
        <circle cx="9.1" cy="31" r="1.15" />
        <circle cx="52.3" cy="39.5" r="1.15" />
        <circle cx="11.7" cy="39.5" r="1.15" />
        {/* Os dois últimos param na altura em que as raízes ainda não chegam —
            mais abaixo eles encostavam nas pontas e viravam nó visual. */}
        <circle cx="48.6" cy="44.5" r="1.15" />
        <circle cx="15.4" cy="44.5" r="1.15" />
      </g>
      {/*
        Yggdrasil: tronco, copa em três níveis, raízes espelhando a copa.
        Cap e join redondos porque cada bifurcação é um subpath que começa no
        ponto onde o anterior termina — com ponta reta, a emenda abre um entalhe
        visível quando o brasão é rasterizado grande (README, apresentação).
      */}
      <g
        stroke="var(--crest-mark)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 42V18" />
        <path d="M32 32L24 25M24 25L19.5 20.5M24 25L23.5 19" />
        <path d="M32 32L40 25M40 25L44.5 20.5M40 25L40.5 19" />
        <path d="M32 26L26.5 20M26.5 20L23 15.5M26.5 20L27.5 14.5" />
        <path d="M32 26L37.5 20M37.5 20L41 15.5M37.5 20L36.5 14.5" />
        <path d="M32 22L28.5 17M32 22L35.5 17" />
        <path d="M32 42L25 47M25 47L20.5 49M25 47L24.5 51" />
        <path d="M32 42L39 47M39 47L43.5 49M39 47L39.5 51" />
        <path d="M32 42V50" />
      </g>
    </svg>
  );
}

export function GuildSeal({ className, ...props }: CrestProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      aria-hidden
      {...props}
    >
      {/*
        O selo é monocromático: aro e entalhe na mesma cor, formando uma peça só.
        O completo é bicromático (aro prata + entalhe gelo) — a prata some aqui
        porque, abaixo de ~32px, duas cores de metal viram uma mancha cinza.
        A árvore também é maior e mais aberta que a do completo: com menos pixels,
        ela precisa ocupar a placa em vez de flutuar no meio dela.
      */}
      <path
        d="M17 7H47L57 17V30C57 43.5 46.6 53.6 32 59C17.4 53.6 7 43.5 7 30V17Z"
        fill="var(--crest-plate)"
        stroke="var(--crest-mark)"
        strokeWidth="4.5"
        strokeLinejoin="miter"
      />
      <g
        stroke="var(--crest-mark)"
        strokeWidth="4.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 44V15" />
        <path d="M32 31L19.5 21M32 31L44.5 21" />
        <path d="M32 22L24 14M32 22L40 14" />
        <path d="M32 44L22.5 49M32 44L41.5 49" />
      </g>
    </svg>
  );
}
