"use client";

import { createContext, useContext } from "react";

export const HelpUIContext = createContext<(() => void) | null>(null);
export const useOpenProductHelp = () => useContext(HelpUIContext);

// Radix registers its top layer after paint. Protect an underlying draft even
// when Escape or an outside interaction arrives before that registration.
export function guardProductHelpDismissal<E extends { preventDefault(): void }>(handler?: (event: E) => void) {
  return (event: E) => {
    if (document.querySelector('[data-product-help="open"]')) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
