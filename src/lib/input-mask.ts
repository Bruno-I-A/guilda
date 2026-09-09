/** Restore the caret by counting digits, independently of mask punctuation. */
export function caretFromRight(text: string, digitsToRight: number): number {
  if (digitsToRight === 0) return text.length;
  let remaining = digitsToRight;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (/\d/.test(text[index]) && --remaining === 0) return index;
  }
  return 0;
}

/** Backspace/Delete over punctuation should remove a digit, not get stuck. */
export function deleteBesideSeparator(text: string, caret: number, key: string) {
  const backwards = key === "Backspace";
  let index = backwards ? caret - 1 : caret;
  if (index < 0 || index >= text.length || /\d/.test(text[index])) return null;
  const step = backwards ? -1 : 1;
  while (index >= 0 && index < text.length && !/\d/.test(text[index])) index += step;
  if (index < 0 || index >= text.length) return null;
  return {
    text: text.slice(0, index) + text.slice(index + 1),
    caret: backwards ? index : caret,
  };
}
