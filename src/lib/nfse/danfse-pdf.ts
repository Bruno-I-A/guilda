import { PageSizes, PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import qrcode from "qrcode-generator";

import type { Danfse, DanfseField, DanfseSection } from "./danfse-data";
import { NFSE_LOGO_PNG_BASE64 } from "./nfse-logo";

/**
 * Desenha o DANFSe v2.0 (NT 008/2026) numa página A4. As medidas, em pontos
 * a partir do topo, copiam o DANFSe que o Portal Nacional gera: quatro
 * colunas iguais, linhas de 0,5 pt entre blocos, borda de 1 pt, título de
 * bloco e destaques em cinza 5%. A NT pede Arial nos rótulos e Microsoft Sans
 * Serif no conteúdo; as fontes-padrão do PDF trazem a Helvetica, de métrica
 * igual à da Arial, e assim nenhuma fonte precisa ser embutida.
 */

const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.A4;
const LEFT = 8.5;
const RIGHT = 586.8;
const COLUMN = (RIGHT - LEFT) / 4;
const PAD = 3.4;
const ROW = 19.1;
const LINE = 8;
const LABEL_BASELINE = 5.7;
const VALUE_BASELINE = 13.4;
const TITLE_BASELINE = 6.6;
/** Campo sem rótulo (a descrição do código de tributação): o valor sobe para o lugar do rótulo. */
const BARE_BASELINE = 6.4;
const NOTICE_HEIGHT = 8.4;
const STUB_TOP = 795.8;
const STUB_HEIGHT = 20.1;

const BLACK = rgb(0, 0, 0);
const RED = rgb(1, 0, 0);
const SHADE = rgb(0.949, 0.949, 0.949);

const QR_CAPTION = [
  "A autenticidade desta NFS-e pode ser verificada",
  "pela leitura deste código QR ou pela consulta da",
  "chave de acesso no portal nacional da NFS-e",
];

interface Style {
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
}

class Sheet {
  private readonly encodable: Set<number>;

  constructor(
    readonly page: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    // As fontes-padrão só codificam o WinAnsi; o resto vira "?" em vez de quebrar o PDF.
    this.encodable = new Set(regular.getCharacterSet());
  }

  private safe(text: string): string {
    return Array.from(text.replace(/[–—]/g, "-"), (char) =>
      this.encodable.has(char.codePointAt(0) ?? 0) ? char : "?",
    ).join("");
  }

  width(text: string, style: Style): number {
    return style.font.widthOfTextAtSize(this.safe(text), style.size);
  }

  /** Cabe na largura ou é cortado com reticências. */
  fit(text: string, style: Style, maxWidth: number): string {
    if (this.width(text, style) <= maxWidth) return text;
    let cut = text;
    while (cut.length > 0 && this.width(`${cut.trimEnd()} ...`, style) > maxWidth) cut = cut.slice(0, -1);
    return `${cut.trimEnd()} ...`;
  }

  /** Quebra em linhas pela largura; a última linha visível leva reticências. */
  wrap(text: string, style: Style, maxWidth: number, maxLines = Infinity): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.width(candidate, style) <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = word;
        while (this.width(line, style) > maxWidth) {
          let size = line.length - 1;
          while (size > 1 && this.width(line.slice(0, size), style) > maxWidth) size--;
          lines.push(line.slice(0, size));
          line = line.slice(size);
        }
      }
      lines.push(line);
    }
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = this.fit(`${kept[maxLines - 1]} ${lines[maxLines]}`, style, maxWidth);
    return kept;
  }

  text(value: string, x: number, baseline: number, style: Style) {
    this.page.drawText(this.safe(value), {
      x,
      y: PAGE_HEIGHT - baseline,
      size: style.size,
      font: style.font,
      color: style.color ?? BLACK,
    });
  }

  centered(value: string, center: number, baseline: number, style: Style) {
    this.text(value, center - this.width(value, style) / 2, baseline, style);
  }

  fill(x: number, top: number, width: number, height: number) {
    this.page.drawRectangle({ x, y: PAGE_HEIGHT - top - height, width, height, color: SHADE });
  }

  rule(top: number, thickness = 0.5, from = LEFT, to = RIGHT) {
    this.page.drawLine({
      start: { x: from, y: PAGE_HEIGHT - top },
      end: { x: to, y: PAGE_HEIGHT - top },
      thickness,
      color: BLACK,
    });
  }

  vertical(x: number, top: number, bottom: number, thickness = 1) {
    this.page.drawLine({
      start: { x, y: PAGE_HEIGHT - top },
      end: { x, y: PAGE_HEIGHT - bottom },
      thickness,
      color: BLACK,
    });
  }
}

function drawQrCode(sheet: Sheet, url: string, x: number, top: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  for (let row = 0; row < count; row++) {
    // Módulos escuros vizinhos na mesma linha viram um retângulo só.
    for (let col = 0; col < count; ) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < count && qr.isDark(row, col)) col++;
      sheet.page.drawRectangle({
        x: x + start * cell,
        y: PAGE_HEIGHT - top - (row + 1) * cell,
        width: (col - start) * cell,
        height: cell,
        color: BLACK,
      });
    }
  }
}

function drawHeader(sheet: Sheet, danfse: Danfse, logo: Awaited<ReturnType<PDFDocument["embedPng"]>>) {
  const title: Style = { font: sheet.bold, size: 9 };
  sheet.fill(LEFT, 5.7, RIGHT - LEFT, 34);
  sheet.page.drawImage(logo, { x: 11.9, y: PAGE_HEIGHT - 33.2, width: 115.7, height: 22.9 });

  const center = (LEFT + RIGHT) / 2;
  if (danfse.homologation) {
    sheet.centered("DANFSe v2.0", center, 15.6, title);
    sheet.centered("Documento Auxiliar da NFS-e", center, 25.4, title);
    sheet.centered("NFS-e SEM VALIDADE JURÍDICA", center, 35.2, { ...title, color: RED });
  } else {
    sheet.centered("DANFSe v2.0", center, 20.8, title);
    sheet.centered("Documento Auxiliar da NFS-e", center, 31.1, title);
  }

  const x = LEFT + 3 * COLUMN + PAD;
  const width = RIGHT - x - PAD;
  const small: Style = { font: sheet.regular, size: 6 };
  const city = sheet.wrap(danfse.header.city, { font: sheet.regular, size: 8 }, width, 2);
  const cityBaselines = city.length === 1 ? [18.7] : [14.3, 22.3];
  city.forEach((line, index) => sheet.text(line, x, cityBaselines[index], { font: sheet.regular, size: 8 }));
  const after = cityBaselines[cityBaselines.length - 1];
  sheet.text(danfse.header.generator, x, after + 7.2, small);
  sheet.text(danfse.header.environment, x, after + 14, small);
  sheet.rule(39.9);
}

function drawIdentification(sheet: Sheet, danfse: Danfse) {
  const label: Style = { font: sheet.bold, size: 7 };
  const value: Style = { font: sheet.regular, size: 7 };
  const top = 44.4;
  const step = 20.2;
  const keyWidth = 3 * COLUMN - 2 * PAD;
  sheet.text("CHAVE DE ACESSO DA NFS-e", LEFT + PAD, top + 6.6, label);
  sheet.text(sheet.fit(danfse.accessKey, value, keyWidth), LEFT + PAD, top + 14.5, value);
  danfse.identification.forEach((row, rowIndex) => {
    const rowTop = top + (rowIndex + 1) * step;
    row.forEach((field, col) => {
      const x = LEFT + col * COLUMN;
      if (field.shaded) sheet.fill(x, rowTop + 0.1, COLUMN, step);
      sheet.text(sheet.fit(field.label, label, COLUMN - 2 * PAD), x + PAD, rowTop + 6.6, label);
      sheet.text(sheet.fit(field.value, value, COLUMN - 2 * PAD), x + PAD, rowTop + 14.5, value);
    });
  });
  drawQrCode(sheet, danfse.qrCodeUrl, 492, 44.8, 45);
  const caption: Style = { font: sheet.regular, size: 6 };
  QR_CAPTION.forEach((line, index) => sheet.text(line, LEFT + 3 * COLUMN + PAD, 97.4 + index * 6.8, caption));
}

interface LaidOutField {
  field: DanfseField;
  x: number;
  width: number;
  lines: string[];
}

function layoutRow(sheet: Sheet, row: DanfseField[], firstColumn: number): { fields: LaidOutField[]; height: number } {
  const value: Style = { font: sheet.regular, size: 7 };
  let col = firstColumn;
  let height = 0;
  const fields = row.map((field) => {
    const span = field.span ?? 1;
    const x = LEFT + col * COLUMN;
    const width = span * COLUMN;
    col += span;
    const lines = field.multiline
      ? sheet.wrap(field.value, value, width - 2 * PAD)
      : [sheet.fit(field.value, value, width - 2 * PAD)];
    const firstBaseline = field.label ? VALUE_BASELINE : BARE_BASELINE;
    height = Math.max(height, firstBaseline + (lines.length - 1) * LINE + LABEL_BASELINE);
    return { field, x, width, lines };
  });
  return { fields, height };
}

function drawSection(sheet: Sheet, section: DanfseSection, top: number): number {
  sheet.rule(top);
  if (section.kind === "notice") {
    sheet.centered(section.text, (LEFT + RIGHT) / 2, top + 6.7, { font: sheet.regular, size: 7 });
    return top + NOTICE_HEIGHT;
  }
  const label: Style = { font: sheet.bold, size: 6 };
  const value: Style = { font: sheet.regular, size: 7 };
  let rowTop = top + 0.2;
  section.rows.forEach((row, index) => {
    const laid = layoutRow(sheet, row, index === 0 ? 1 : 0);
    const { fields } = laid;
    const height = index === 0 ? Math.max(laid.height, ROW) : laid.height;
    if (index === 0) {
      sheet.fill(LEFT, rowTop, COLUMN, ROW);
      sheet.text(section.title, LEFT + PAD, rowTop + TITLE_BASELINE, { font: sheet.bold, size: 7 });
    }
    for (const { field, x, width, lines } of fields) {
      if (field.shaded) sheet.fill(x, rowTop, width, height);
      if (field.label) sheet.text(sheet.fit(field.label, label, width - 2 * PAD), x + PAD, rowTop + LABEL_BASELINE, label);
      const first = field.label ? VALUE_BASELINE : BARE_BASELINE;
      lines.forEach((line, lineIndex) => sheet.text(line, x + PAD, rowTop + first + lineIndex * LINE, value));
    }
    rowTop += height;
  });
  return rowTop;
}

function drawComplementary(sheet: Sheet, danfse: Danfse, top: number) {
  sheet.rule(top);
  sheet.fill(LEFT, top + 0.2, COLUMN, ROW);
  sheet.text("INFORMAÇÕES COMPLEMENTARES", LEFT + PAD, top + 0.2 + TITLE_BASELINE, { font: sheet.bold, size: 7 });
  const value: Style = { font: sheet.regular, size: 7 };
  const width = RIGHT - LEFT - 2 * PAD;
  const first = top + 26.9;
  const room = Math.max(0, Math.floor((STUB_TOP - 6 - first) / LINE));
  const taxes = sheet.wrap(danfse.complementary.approximateTaxes, value, width);
  // A linha dos tributos aproximados é fixa (NT 008): o texto livre cede espaço a ela.
  const text = danfse.complementary.text
    ? sheet.wrap(danfse.complementary.text, value, width, Math.max(1, room - taxes.length))
    : [];
  [...text, ...taxes].slice(0, Math.max(room, taxes.length)).forEach((line, index) =>
    sheet.text(line, LEFT + PAD, first + index * LINE, value),
  );
}

function drawStub(sheet: Sheet, danfse: Danfse) {
  const bottom = STUB_TOP + STUB_HEIGHT;
  sheet.rule(STUB_TOP, 1);
  sheet.rule(bottom, 1);
  for (const x of [LEFT, LEFT + COLUMN, LEFT + 2 * COLUMN, RIGHT]) sheet.vertical(x, STUB_TOP, bottom);
  const label: Style = { font: sheet.bold, size: 6 };
  sheet.text("DATA CIENTIFICAÇÃO:", LEFT + 4.4, STUB_TOP + 6.1, label);
  sheet.text("IDENTIFICAÇÃO E ASSINATURA", LEFT + COLUMN + 4.4, STUB_TOP + 6.1, label);
  sheet.text("N° NFS-e / CHAVE NFS-e", LEFT + 2 * COLUMN + 4.4, STUB_TOP + 6.1, label);
  const value: Style = { font: sheet.regular, size: 7 };
  sheet.text(sheet.fit(danfse.stub, value, 2 * COLUMN - 2 * PAD), LEFT + 2 * COLUMN + 4.4, STUB_TOP + 13.9, value);
}

export async function renderDanfsePdf(danfse: Danfse): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`DANFSe ${danfse.accessKey}`);
  document.setProducer("Guilda");
  document.setCreator("Guilda");
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const sheet = new Sheet(
    page,
    await document.embedFont(StandardFonts.Helvetica),
    await document.embedFont(StandardFonts.HelveticaBold),
  );
  const logo = await document.embedPng(Buffer.from(NFSE_LOGO_PNG_BASE64, "base64"));

  page.drawRectangle({ x: 5, y: 5, width: PAGE_WIDTH - 10, height: PAGE_HEIGHT - 10, borderColor: BLACK, borderWidth: 1 });
  drawHeader(sheet, danfse, logo);
  drawIdentification(sheet, danfse);
  let top = 125.6;
  for (const section of danfse.sections) top = drawSection(sheet, section, top);
  drawComplementary(sheet, danfse, top);
  drawStub(sheet, danfse);
  return document.save();
}
