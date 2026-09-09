import { describe, expect, it } from "vitest";
import { formatCnpjInput } from "@/domain/cnpj";
import { parseCurrencyDigits } from "./currency";
import { caretFromRight, deleteBesideSeparator } from "./input-mask";

describe("progressive CNPJ input", () => {
  it("formats partial typing and both masked and unmasked pasted numbers", () => {
    const digits = "12234515000112";
    const stages = ["1", "12", "12.2", "12.23", "12.234", "12.234.5", "12.234.51", "12.234.515", "12.234.515/0", "12.234.515/00", "12.234.515/000", "12.234.515/0001", "12.234.515/0001-1", "12.234.515/0001-12"];
    stages.forEach((stage, i) => expect(formatCnpjInput(digits.slice(0, i + 1))).toBe(stage));
    expect(formatCnpjInput("12.234.515/0001-12")).toBe(stages.at(-1));
    expect(formatCnpjInput(digits + "999")).toBe(stages.at(-1));
    expect(formatCnpjInput("")).toBe("");
  });
});

describe("cents-first BRL input", () => {
  it("preserves cents during typing, replacement and paste", () => {
    expect(parseCurrencyDigits("1")).toBe("0.01");
    expect(parseCurrencyDigits("12")).toBe("0.12");
    expect(parseCurrencyDigits("1234")).toBe("12.34");
    expect(parseCurrencyDigits("R$ 1.234,56")).toBe("1234.56");
    expect(parseCurrencyDigits("1234.56")).toBe("1234.56");
    expect(parseCurrencyDigits("R$ 0,001")).toBe("0.01");
    expect(parseCurrencyDigits("")).toBe("");
    expect(parseCurrencyDigits("-R$ 12,34", true)).toBe("-12.34");
    expect(parseCurrencyDigits("-R$ 12,34")).toBe("12.34");
  });
  it("keeps editing possible around formatting characters", () => {
    expect(deleteBesideSeparator("12.234", 3, "Backspace")).toEqual({ text: "1.234", caret: 1 });
    expect(deleteBesideSeparator("12.234", 2, "Delete")).toEqual({ text: "12.34", caret: 2 });
    expect(deleteBesideSeparator("R$ 12,34", 6, "Backspace")).toEqual({ text: "R$ 1,34", caret: 4 });
    expect(caretFromRight("12.234.515/0001-12", 2)).toBe(16);
  });
});
