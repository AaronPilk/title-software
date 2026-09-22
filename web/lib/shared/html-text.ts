/** Display-only HTML text. A forward-only scan bounds work even for malformed mail.
 * This is not an HTML sanitizer: callers must render the returned string as text.
 */
export function htmlPlainText(html: string): string {
  // ASCII casing keeps source offsets stable (Unicode lowercasing can expand characters).
  const lower = html.replace(/[A-Z]/g, character => character.toLowerCase());
  const parts: string[] = [];
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const space = (c: string) => c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f";
  const alpha = (c: string) => c >= "a" && c <= "z";
  let i = 0;
  let rawTag = "";
  while (i < html.length) {
    if (rawTag) {
      const end = lower.indexOf(`</${rawTag}`, i);
      if (end < 0) break; // An unfinished script/style never becomes displayed text.
      const after = lower[end + rawTag.length + 2] || "";
      i = end;
      if (after !== ">" && after !== "/" && !space(after)) { i += rawTag.length + 2; continue; }
      rawTag = "";
    }
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (html[i] === "<") {
      let at = i + 1;
      while (space(lower[at] || "")) at++;
      const closing = lower[at] === "/";
      if (closing) at++;
      const start = at;
      while (alpha(lower[at] || "") || /[0-9:-]/.test(lower[at] || "")) at++;
      const name = lower.slice(start, at);
      if ((name && alpha(name[0])) || lower[start] === "!" || lower[start] === "?") {
        let quote = "";
        let end = at;
        for (; end < html.length; end++) {
          const c = html[end];
          if (quote) { if (c === quote) quote = ""; }
          else if (c === '"' || c === "'") quote = c;
          else if (c === ">") break;
        }
        if (end === html.length) { parts.push(html.slice(i)); break; }
        if (!closing && (name === "script" || name === "style")) rawTag = name;
        else if (name === "br" || closing && ["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"].includes(name)) parts.push("\n");
        else if (closing && (name === "td" || name === "th")) parts.push(" | ");
        i = end + 1;
        continue;
      }
    }
    if (html[i] === "&") {
      // Limit lookahead; a string of ampersands without semicolons remains linear.
      let end = i + 1;
      while (end < html.length && end - i <= 32 && /[a-zA-Z0-9#]/.test(html[end])) end++;
      if (html[end] === ";") {
        const entity = lower.slice(i + 1, end);
        let value = Object.hasOwn(entities, entity) ? entities[entity] : undefined;
        if (/^#(?:x[0-9a-f]+|[0-9]+)$/.test(entity)) {
          const n = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
          value = n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
        }
        if (value !== undefined) { parts.push(value); i = end + 1; continue; }
      }
    }
    parts.push(html[i++]);
  }
  // Avoid unanchored whitespace regexes: long spaces without a newline can also
  // trigger quadratic backtracking. Remove line-end spaces in a second linear pass.
  const text = parts.join("");
  const cleaned: string[] = [];
  let horizontalStart = -1;
  let newlines = 0;
  for (let at = 0; at < text.length; at++) {
    const c = text[at];
    if (c === " " || c === "\t") { if (horizontalStart < 0) horizontalStart = at; continue; }
    if (c === "\n") {
      horizontalStart = -1;
      if (newlines < 2) cleaned.push(c);
      newlines++;
    } else {
      if (horizontalStart >= 0) cleaned.push(text.slice(horizontalStart, at));
      horizontalStart = -1;
      newlines = 0;
      cleaned.push(c);
    }
  }
  return cleaned.join("").trim();
}
