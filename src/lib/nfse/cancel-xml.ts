import {
  buildCancelRequestId,
  NFSE_CANCEL_TEXT_MAX,
  NFSE_CANCEL_TEXT_MIN,
  type NfseCancelReasonCode,
} from "@/domain/nfse";

import {
  element,
  NFSE_APP_VERSION,
  NFSE_LAYOUT_VERSION,
  NFSE_NAMESPACE,
  XML_DECLARATION,
} from "./xml";

export interface CancelRequestInput {
  environment: 1 | 2;
  requestedAt: string;
  providerCnpj: string;
  accessKey: string;
  reasonCode: NfseCancelReasonCode;
  reasonText: string;
}

/** Pedido de registro do evento 101101 (cancelamento de NFS-e). */
export function buildCancelRequestXml(input: CancelRequestInput): { id: string; xml: string } {
  const reason = input.reasonText.replace(/\s+/g, " ").trim();
  if (reason.length < NFSE_CANCEL_TEXT_MIN || reason.length > NFSE_CANCEL_TEXT_MAX) {
    throw new Error(
      `A justificativa do cancelamento deve ter de ${NFSE_CANCEL_TEXT_MIN} a ${NFSE_CANCEL_TEXT_MAX} caracteres.`,
    );
  }
  const id = buildCancelRequestId(input.accessKey);
  const infPedReg =
    `<infPedReg Id="${id}">` +
    `${element("tpAmb", String(input.environment))}` +
    `${element("verAplic", NFSE_APP_VERSION)}` +
    `${element("dhEvento", input.requestedAt)}` +
    `${element("CNPJAutor", input.providerCnpj)}` +
    `${element("chNFSe", input.accessKey)}` +
    `<e101101>${element("xDesc", "Cancelamento de NFS-e")}` +
    `${element("cMotivo", String(input.reasonCode))}${element("xMotivo", reason)}</e101101>` +
    `</infPedReg>`;
  return {
    id,
    xml: `${XML_DECLARATION}<pedRegEvento xmlns="${NFSE_NAMESPACE}" versao="${NFSE_LAYOUT_VERSION}">${infPedReg}</pedRegEvento>`,
  };
}
