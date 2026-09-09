"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { formatCnpjInput, normalizeCnpj } from "@/domain/cnpj";
import { caretFromRight, deleteBesideSeparator } from "@/lib/input-mask";
import { Input } from "./input";

type CnpjInputProps = Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange" | "type"> & {
  value: string;
  onValueChange: (digits: string) => void;
};

/** Display a progressive mask; forms and callbacks receive only the digits. */
export function CnpjInput({ value, onValueChange, name, onKeyDown, ...props }: CnpjInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [revision, setRevision] = useState(0);
  const formatted = formatCnpjInput(value);

  useLayoutEffect(() => {
    if (caret.current === null || document.activeElement !== input.current) return;
    const position = caretFromRight(formatted, caret.current);
    input.current?.setSelectionRange(position, position);
    caret.current = null;
  }, [formatted, revision]);

  function change(text: string, position: number) {
    const digits = normalizeCnpj(text).slice(0, 14);
    const digitsBefore = normalizeCnpj(text.slice(0, position)).length;
    caret.current = Math.max(0, digits.length - digitsBefore);
    onValueChange(digits);
    setRevision((current) => current + 1);
  }

  return (
    <>
      <Input
        placeholder="00.000.000/0000-00"
        {...props}
        ref={input}
        type="text"
        inputMode="numeric"
        value={formatted}
        onChange={(event) => change(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || (event.key !== "Backspace" && event.key !== "Delete")) return;
          const target = event.currentTarget;
          if (target.selectionStart !== target.selectionEnd) return;
          const edit = deleteBesideSeparator(target.value, target.selectionStart ?? 0, event.key);
          if (edit) {
            event.preventDefault();
            change(edit.text, edit.caret);
          }
        }}
      />
      {name ? <input type="hidden" name={name} disabled={props.disabled} value={normalizeCnpj(value).slice(0, 14)} /> : null}
    </>
  );
}
