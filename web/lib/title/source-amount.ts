/** Parse a complete source amount for comparison without changing its evidence. */
export function parseSourceAmount(value: string): number | null {
  const match = /^(?:(?:USD|US\$)\s*|\$\s*)?((?:\d{1,12}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{2})?)$/.exec(value);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}
