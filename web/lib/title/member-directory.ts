/** Optional business contact details. Older name/share-only members stay valid. */
export function normalizeMemberContacts(input: { email?: unknown; phone?: unknown }): {
  email?: string;
  phone?: string;
} {
  const result: { email?: string; phone?: string } = {};
  if (input.email !== undefined) {
    if (typeof input.email !== "string") throw new Error("Enter a valid member email address.");
    const email = input.email.trim();
    if (email && (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))
      throw new Error("Enter a valid member email address.");
    if (email) result.email = email;
  }
  if (input.phone !== undefined) {
    if (typeof input.phone !== "string") throw new Error("Enter a valid member phone number.");
    const phone = input.phone.trim();
    if (phone) {
      const match = /^(\+?[\d().\s-]+?)(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?$/i.exec(phone);
      const digits = match?.[1].replace(/\D/g, "") || "";
      if (phone.length > 60 || !match || digits.length < 7 || digits.length > 15)
        throw new Error("Enter a phone number with 7–15 digits and an optional extension.");
      result.phone = phone;
    }
  }
  return result;
}

export function memberContactError(input: { email?: unknown; phone?: unknown }): string {
  try {
    normalizeMemberContacts(input);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Review this member's contact details.";
  }
}
