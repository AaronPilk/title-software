# CSV preview integrity

September 12, 2026. Built during direct Codex/Claude coordination from main `5534200`.

The accounting CSV scaffold previously keyed mappings by header text without checking that the text was unique. For `Date,Amount,Amount`, changing one Amount control changed both. An unterminated quoted field could also consume later lines and show a plausible but incorrect record count.

The preview now rejects duplicate headers (ignoring case and surrounding spaces), unnamed headers, empty files, malformed quoting and data records with different field counts than the header. Error text identifies the problematic record or column. These checks cover the entire input, including rows beyond the visible preview.

Valid quoted commas/newlines, doubled quotes, UTF-8 BOMs, LF/CRLF/CR record separators and explicit empty fields remain supported. A final record separator does not create an extra record. A quoted empty field or intentionally empty final row is preserved.

The upload component clears obsolete preview state, displays read/parse failures, limits input to 10 MB and ignores asynchronous results from an earlier file selection. Template matching checks owned keys and supported target values, so headers such as `constructor` cannot inherit an unintended mapping from Object.prototype. Saved templates, account records and financial records are not changed by validation failure.

Verification: **83 domain tests pass**, including seven dedicated CSV integrity cases and all 76 prior tests. TypeScript checking and the production build pass. An independent read-only code review found no parser or upload-sequencing regression. This record does not claim a new browser interaction pass.

Claude owns the concurrent revision work. Separate reproduced loan-target and stale-reply findings, plus recovery and backup follow-ups, were handed directly to Claude and recorded in the local `CODEX_PARALLEL_WORK.md`. The company-materials and versioned-publication implementation remains documented in `docs/company-materials-publication.md`.
