/**
 * Retenções da NFS-e de serviço, como o Fiscal configura: ISS retido pelo
 * tomador (com a alíquota) e os percentuais federais retidos na fonte. Os
 * valores saem daqui, calculados sobre o valor do serviço, e ficam congelados
 * no pedido da nota — o navegador só escolhe os percentuais.
 */

export interface NfseRetentions {
  /** ISS retido pelo tomador (tpRetISSQN = 2). */
  issWithheld: boolean;
  /** Alíquota do ISS ("2.00"); obrigatória com ISS retido. */
  issRate: string | null;
  /** Percentuais retidos ("1.50"); nulo = não retém. */
  irrf: string | null;
  /** INSS (contribuição previdenciária) retido. */
  cp: string | null;
  pis: string | null;
  cofins: string | null;
  csll: string | null;
  /** CST do PIS/COFINS, exigido quando PIS ou COFINS é retido. */
  pisCofinsCst: string;
}

export const NO_NFSE_RETENTIONS: NfseRetentions = {
  issWithheld: false,
  issRate: null,
  irrf: null,
  cp: null,
  pis: null,
  cofins: null,
  csll: null,
  pisCofinsCst: "01",
};

/** Percentual "1.50" (0,01 a 99,99), sem vírgula. */
export const RETENTION_PERCENT_PATTERN = /^(?:[1-9]\d?|0)(?:\.\d{1,2})?$/;

/** As retenções federais já em centavos, prontas para a DPS. */
export interface NfseFederalRetention {
  cpCents?: number;
  irrfCents?: number;
  csllCents?: number;
  pisCofins?: {
    cst: string;
    baseCents: number;
    pisPercent: string;
    cofinsPercent: string;
    pisCents: number;
    cofinsCents: number;
    /** tpRetPisCofins da tabela do leiaute (0 a 9). */
    retention: string;
  };
}

function positive(percent: string | null): string | null {
  return percent && Number(percent) > 0 ? Number(percent).toFixed(2) : null;
}

/** Valor retido: percentual sobre o valor do serviço, arredondado ao centavo. */
export function retentionCents(amountCents: number, percent: string): number {
  return Math.round((amountCents * Math.round(Number(percent) * 100)) / 10_000);
}

/**
 * tpRetPisCofins: a tabela do leiaute combina o que foi retido entre PIS,
 * COFINS e CSLL (0 = nada retido; 3 = os três).
 */
export function pisCofinsRetentionCode(pis: boolean, cofins: boolean, csll: boolean): string {
  const key = `${Number(pis)}${Number(cofins)}${Number(csll)}`;
  const table: Record<string, string> = {
    "000": "0",
    "111": "3",
    "110": "4",
    "100": "5",
    "010": "6",
    "011": "7",
    "001": "8",
    "101": "9",
  };
  return table[key];
}

export function hasNfseRetentions(retentions: NfseRetentions | null | undefined): boolean {
  if (!retentions) return false;
  return retentions.issWithheld || [retentions.irrf, retentions.cp, retentions.pis, retentions.cofins, retentions.csll].some((value) => positive(value) !== null);
}

/** O que a configuração retém numa nota deste valor, imposto por imposto. */
export function retentionBreakdown(retentions: NfseRetentions, amountCents: number): { label: string; cents: number }[] {
  const lines: { label: string; cents: number }[] = [];
  const issRate = retentions.issWithheld ? positive(retentions.issRate) : null;
  if (issRate) lines.push({ label: `ISS ${issRate.replace(".", ",")}%`, cents: retentionCents(amountCents, issRate) });
  for (const [label, value] of [["IR", retentions.irrf], ["INSS", retentions.cp], ["PIS", retentions.pis], ["COFINS", retentions.cofins], ["CSLL", retentions.csll]] as const) {
    const percent = positive(value);
    if (percent) lines.push({ label: `${label} ${percent.replace(".", ",")}%`, cents: retentionCents(amountCents, percent) });
  }
  return lines;
}

/** Os grupos da DPS: ISS retido no tribMun e as federais no tribFed. */
export function nfseRetentionGroups(
  retentions: NfseRetentions,
  amountCents: number,
): { issWithheld: boolean; issRate: string | null; federal: NfseFederalRetention | null } {
  const pis = positive(retentions.pis);
  const cofins = positive(retentions.cofins);
  const csll = positive(retentions.csll);
  const irrf = positive(retentions.irrf);
  const cp = positive(retentions.cp);
  const federal: NfseFederalRetention = {};
  if (cp) federal.cpCents = retentionCents(amountCents, cp);
  if (irrf) federal.irrfCents = retentionCents(amountCents, irrf);
  if (csll) federal.csllCents = retentionCents(amountCents, csll);
  if (pis || cofins) {
    federal.pisCofins = {
      cst: retentions.pisCofinsCst,
      baseCents: amountCents,
      pisPercent: pis ?? "0.00",
      cofinsPercent: cofins ?? "0.00",
      pisCents: pis ? retentionCents(amountCents, pis) : 0,
      cofinsCents: cofins ? retentionCents(amountCents, cofins) : 0,
      retention: pisCofinsRetentionCode(Boolean(pis), Boolean(cofins), Boolean(csll)),
    };
  }
  return {
    issWithheld: retentions.issWithheld,
    issRate: retentions.issWithheld ? positive(retentions.issRate) : null,
    federal: Object.keys(federal).length > 0 ? federal : null,
  };
}
