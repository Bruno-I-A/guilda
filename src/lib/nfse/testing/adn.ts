// Fixtures da distribuição de documentos do ADN (Sistema Nacional da NFS-e).
// Os nomes do corpo JSON (StatusProcessamento, LoteDFe, NSU, TipoDocumento,
// ArquivoXml...) vêm do Manual dos Contribuintes — APIs do ADN v1.0 e de
// implementações de terceiros, e serão conferidos no teste real com uma empresa.
import { gzipBase64, NFSE_NAMESPACE } from "../xml";

/** Evento do Sistema Nacional (TCEvento) com o pedido de cancelamento dentro. */
export function testEventXml(accessKey: string, code = "e101101"): string {
  return (
    `<evento xmlns="${NFSE_NAMESPACE}" versao="1.01"><infEvento Id="EVT${accessKey}${code.slice(1)}001">` +
    `<verAplic>SefinNac</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento>` +
    `<dhProc>2026-10-20T10:00:00-03:00</dhProc><nDFSe>99</nDFSe>` +
    `<pedRegEvento versao="1.01"><infPedReg Id="PRE${accessKey}${code.slice(1)}">` +
    `<tpAmb>1</tpAmb><verAplic>Guilda-1.0</verAplic><dhEvento>2026-10-20T09:59:00-03:00</dhEvento>` +
    `<CNPJAutor>11222333000181</CNPJAutor><chNFSe>${accessKey}</chNFSe>` +
    `<${code}><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro na emissão da nota</xMotivo></${code}>` +
    `</infPedReg></pedRegEvento></infEvento></evento>`
  );
}

/** Corpo JSON de GET /contribuintes/DFe/{NSU}?lote=true. */
export function testAdnBatchBody(documents: { nsu: number; xml: string; type?: string }[]): string {
  return JSON.stringify({
    StatusProcessamento: documents.length > 0 ? "DOCUMENTOS_LOCALIZADOS" : "NENHUM_DOCUMENTO_LOCALIZADO",
    LoteDFe: documents.map((doc) => ({
      NSU: doc.nsu,
      ChaveAcesso: null,
      TipoDocumento: doc.type ?? "NFSE",
      ArquivoXml: gzipBase64(doc.xml),
      DataHoraGeracao: "2026-10-20T10:00:00",
    })),
  });
}
