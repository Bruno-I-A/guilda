"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ChangeEvent,
} from "react";

import { formatBRLCurrency, parseBRLCurrencyInput } from "@/lib/currency";

import { Input } from "./input";

type InputProps = ComponentProps<typeof Input>;

interface CurrencyInputProps
  extends Omit<InputProps, "defaultValue" | "name" | "onChange" | "type" | "value"> {
  name?: string;
  value?: string;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  allowNegative?: boolean;
}

type PendingCaret =
  | { section: "integer"; digitsToRight: number }
  | { section: "decimal"; offset: number };

function integerCaretPosition(formatted: string, digitsToRight: number): number {
  const comma = formatted.indexOf(",");
  if (comma < 0 || digitsToRight === 0) return comma < 0 ? formatted.length : comma;
  let remaining = digitsToRight;
  for (let index = comma - 1; index >= 0; index -= 1) {
    if (/\d/.test(formatted[index] ?? "")) remaining -= 1;
    if (remaining === 0) return index;
  }
  return formatted.indexOf("R$") >= 0 ? 3 : 0;
}

/** Campo monetário controlável que exibe BRL e entrega um decimal canônico. */
export function CurrencyInput({
  name,
  value,
  defaultValue,
  onValueChange,
  allowNegative = false,
  placeholder = "R$ 0,00",
  onFocus,
  onKeyDown,
  ...props
}: CurrencyInputProps) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [revision, setRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<PendingCaret | null>(null);
  const rawValue = controlled ? value : internalValue;
  const formatted = formatBRLCurrency(rawValue);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = pendingCaret.current;
    if (!input || !caret || document.activeElement !== input) return;
    const comma = formatted.indexOf(",");
    const position =
      caret.section === "integer"
        ? integerCaretPosition(formatted, caret.digitsToRight)
        : Math.min(formatted.length, Math.max(comma + 1, comma + 1 + caret.offset));
    input.setSelectionRange(position, position);
    pendingCaret.current = null;
  }, [formatted, revision]);

  function change(event: ChangeEvent<HTMLInputElement>) {
    const text = event.currentTarget.value;
    const cursor = event.currentTarget.selectionStart ?? text.length;
    const comma = text.indexOf(",");
    if (comma >= 0 && cursor > comma) {
      pendingCaret.current = {
        section: "decimal",
        offset: (text.slice(comma + 1, cursor).match(/\d/g) ?? []).length,
      };
    } else {
      const integerEnd = comma >= 0 ? comma : text.length;
      pendingCaret.current = {
        section: "integer",
        digitsToRight: (text.slice(cursor, integerEnd).match(/\d/g) ?? []).length,
      };
    }

    const next = parseBRLCurrencyInput(text, { allowNegative });
    if (!controlled) setInternalValue(next);
    setRevision((current) => current + 1);
    onValueChange?.(next);
  }

  return (
    <>
      <Input
        {...props}
        ref={inputRef}
        value={formatted}
        onChange={change}
        onFocus={(event) => {
          onFocus?.(event);
          if (event.currentTarget.value && event.currentTarget.selectionStart === 0) {
            const comma = event.currentTarget.value.indexOf(",");
            const position = comma >= 0 ? comma : event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(position, position);
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !allowNegative || event.key !== "-") return;
          event.preventDefault();
          const next = rawValue.startsWith("-")
            ? rawValue.slice(1)
            : `-${rawValue || "0.00"}`;
          pendingCaret.current = { section: "integer", digitsToRight: 0 };
          if (!controlled) setInternalValue(next);
          setRevision((current) => current + 1);
          onValueChange?.(next);
        }}
        inputMode="decimal"
        placeholder={placeholder}
        autoComplete="off"
      />
      {name ? <input type="hidden" name={name} value={rawValue} /> : null}
    </>
  );
}
