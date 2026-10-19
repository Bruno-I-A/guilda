import { strToU8, zipSync } from "fflate";

export interface ArchiveNote {
  fileName: string;
  xml: string;
  /** XML do evento de cancelamento; preenchido = nota cancelada. */
  cancellation: string | null;
}

export interface ArchiveCompany {
  folder: string;
  notes: ArchiveNote[];
}

export interface ArchiveMissing {
  companyName: string;
  reason: string;
}

export type XmlArchive = { kind: "xml" | "zip"; fileName: string; body: Uint8Array };

/** Uma empresa com uma nota não cancelada vem como o próprio XML (a regra do PDF); o resto, .zip. */
export function buildXmlArchive(input: {
  baseName: string;
  rangeLabel: string;
  singleCompany: boolean;
  companies: ArchiveCompany[];
  missing: ArchiveMissing[];
}): XmlArchive {
  const [only] = input.companies;
  if (input.singleCompany && input.companies.length === 1 && input.missing.length === 0 && only.notes.length === 1 && !only.notes[0].cancellation) {
    return { kind: "xml", fileName: `${only.folder}-${only.notes[0].fileName}`, body: strToU8(only.notes[0].xml) };
  }
  const files: Record<string, Uint8Array> = {};
  for (const company of input.companies) {
    for (const note of company.notes) {
      if (note.cancellation) {
        files[`${company.folder}/canceladas/${note.fileName}`] = strToU8(note.xml);
        files[`${company.folder}/canceladas/${note.fileName.replace(/\.xml$/, "-cancelamento.xml")}`] = strToU8(note.cancellation);
      } else {
        files[`${company.folder}/${note.fileName}`] = strToU8(note.xml);
      }
    }
  }
  if (input.missing.length > 0) {
    const lines = input.missing.map((item) => `${item.companyName}: ${item.reason}`);
    files["LEIA-ME.txt"] = strToU8(`NFS-e prestadas ${input.rangeLabel}.\n\nEmpresas sem XML neste arquivo:\n\n${lines.join("\n")}\n`);
  } else if (Object.keys(files).length === 0) {
    files["LEIA-ME.txt"] = strToU8(`Nenhuma NFS-e prestada ${input.rangeLabel}.\n`);
  }
  const fileName = input.singleCompany && only ? `${input.baseName}-${only.folder}.zip` : `${input.baseName}.zip`;
  return { kind: "zip", fileName, body: zipSync(files, { level: 6 }) };
}
