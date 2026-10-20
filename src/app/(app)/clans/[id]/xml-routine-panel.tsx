"use client";

import { ArrowRight, Download } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { emissionRangeLabel } from "@/domain/nfse-xml";
import type { XmlRoutineView } from "@/lib/nfse/xml-requests";

import { useXmlAutoRefresh, xmlRoutineIsRunning, xmlRoutineStatusText } from "./xml-routine-settings";

/**
 * O XML no Controle mensal: a situação da rotina e o download da competência.
 * Certificados e configuração moram na aba XML das notas.
 */
export function XmlRoutinePanel({
  clanId,
  year,
  month,
  routine,
  totalNotes,
}: {
  clanId: string;
  year: number;
  month: number;
  routine: XmlRoutineView;
  totalNotes: number;
}) {
  useXmlAutoRefresh(routine.runRequested || xmlRoutineIsRunning(routine));

  return (
    <section className="grid min-w-0 gap-2 border-y py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3>XML das NFS-e prestadas</h3>
          <p className="text-sm text-muted-foreground">
            {xmlRoutineStatusText(routine)}
            {routine.problems.length > 0 ? ` · ${routine.problems.length} empresa(s) com problema` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button asChild size="sm" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal text-left">
            <a href={`/api/nfse/xml?clanId=${clanId}&year=${year}&month=${month}`}>
              <Download aria-hidden /> Baixar XML — {emissionRangeLabel(year, month)} ({totalNotes})
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost" className="touch-target">
            <Link href={`/clans/${clanId}?tab=xml&fiscalYear=${year}&fiscalMonth=${month}`}>
              Certificados e rotina <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
