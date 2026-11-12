import writeExcelFile, { type Row } from "write-excel-file/node";

import {
  CLIENT_EXPORT_COLUMNS,
  clientExportRows,
  SHARE_CAPITAL_COLUMN,
  type ExportClient,
} from "./export-rows";

/**
 * O .xlsx das empresas: cabeçalho em negrito e fixo no topo, larguras por
 * coluna e capital social com formato de moeda. Texto continua texto — CNAE e
 * código da Domínio não perdem zero à esquerda virando número.
 */
export async function buildClientsWorkbook(clients: readonly ExportClient[]): Promise<Buffer> {
  const sheet: Row[] = [
    CLIENT_EXPORT_COLUMNS.map((column) => ({ value: column.header, fontWeight: "bold" as const })),
    ...clientExportRows(clients).map((row) =>
      row.map((value, index) =>
        index === SHARE_CAPITAL_COLUMN && typeof value === "number"
          ? { value, format: "#,##0.00" }
          : value,
      ),
    ),
  ];

  return writeExcelFile(sheet, {
    sheet: "Empresas",
    stickyRowsCount: 1,
    columns: CLIENT_EXPORT_COLUMNS.map((column) => ({ width: column.width })),
  }).toBuffer();
}
