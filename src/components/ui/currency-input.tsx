"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { formatBRLCurrency, parseCurrencyDigits } from "@/lib/currency";
import { caretFromRight, deleteBesideSeparator } from "@/lib/input-mask";
import { Input } from "./input";

interface CurrencyInputProps extends Omit<ComponentProps<typeof Input>, "defaultValue" | "name" | "onChange" | "type" | "value"> {
  name?: string;
  value?: string;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  allowNegative?: boolean;
}

/** BRL input with cents-first typing; submits a canonical decimal, never the mask. */
export function CurrencyInput({
  name, value, defaultValue, onValueChange, allowNegative = false,
  placeholder = "R$ 0,00", onKeyDown, ...props
}: CurrencyInputProps) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [revision, setRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const rawValue = controlled ? value : internalValue;
  const formatted = formatBRLCurrency(rawValue);

  useLayoutEffect(() => {
    if (caret.current === null || document.activeElement !== input.current) return;
    const position = caretFromRight(formatted, caret.current);
    input.current?.setSelectionRange(position, position);
    caret.current = null;
  }, [formatted, revision]);

  function update(next: string) {
    if (!controlled) setInternalValue(next);
    setRevision((current) => current + 1);
    onValueChange?.(next);
  }

  function change(text: string, position: number) {
    caret.current = text.slice(position).replace(/\D/g, "").length;
    update(parseCurrencyDigits(text, allowNegative));
  }

  return (
    <>
      <Input
        {...props}
        ref={input}
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        autoComplete="off"
        value={formatted}
        onChange={(event) => change(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (allowNegative && event.key === "-") {
            event.preventDefault();
            caret.current = 0;
            update(rawValue.startsWith("-") ? rawValue.slice(1) : "-" + (rawValue || "0.00"));
            return;
          }
          if (event.key !== "Backspace" && event.key !== "Delete") return;
          const target = event.currentTarget;
          if (target.selectionStart !== target.selectionEnd) return;
          const edit = deleteBesideSeparator(target.value, target.selectionStart ?? 0, event.key);
          if (edit) {
            event.preventDefault();
            change(edit.text, edit.caret);
          }
        }}
      />
      {name ? <input type="hidden" name={name} disabled={props.disabled} value={rawValue} /> : null}
    </>
  );
}
