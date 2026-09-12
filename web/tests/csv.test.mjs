import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, previewCsv } from "../.local-test/csv.js";

test("CSV preview rejects duplicate names instead of sharing a column mapping", () => {
  for (const headers of ["Date,Amount,Amount", "Date,Amount, amount "]) {
    assert.throws(
      () => previewCsv(`${headers}\n2026-09-11,125,40`),
      /Duplicate column header/,
    );
  }
});
test("CSV preview requires named headers and rejects an empty export", () => {
  assert.throws(() => previewCsv(""), /empty/);
  assert.throws(
    () => previewCsv("Date, ,Amount\n2026-09-11,expense,40"),
    /Column 2 has no header/,
  );
});
test("an unclosed CSV quote cannot silently swallow subsequent records", () => {
  assert.throws(
    () =>
      previewCsv(
        'Date,Description,Amount\n2026-09-11,"Unclosed,125\n2026-09-12,Next,40',
      ),
    /record 2: a quoted field is not closed/,
  );
});
test("CSV rejects stray quotes and text after a quoted field", () => {
  assert.throws(() => parseCsv('Amount\n12"5'), /inside an unquoted field/);
  assert.throws(() => parseCsv('Amount\n"125"40'), /after a closing quote/);
});
test("CSV preserves multiline text, quote escapes, BOM and common record separators", () => {
  for (const sep of ["\n", "\r\n", "\r"]) {
    const p = previewCsv(
      `\uFEFFDescription,Amount${sep}"First\nSaid ""hello""",125${sep}Second,-40${sep}`,
    );
    assert.deepEqual(p.rows, [
      ['First\nSaid "hello"', "125"],
      ["Second", "-40"],
    ]);
    assert.equal(p.totalDataRows, 2);
  }
});
test("CSV retains explicit empty final fields without inventing trailing records", () => {
  assert.deepEqual(parseCsv('""'), [[""]]);
  assert.deepEqual(parseCsv("a,b\n,"), [
    ["a", "b"],
    ["", ""],
  ]);
  assert.deepEqual(parseCsv("a\n\n"), [["a"], [""]]);
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});
test("CSV validates field counts beyond the displayed preview", () => {
  assert.throws(
    () => previewCsv("Date,Amount\n2026-09-11,125\n2026-09-12,40,extra", 1),
    /record 3 has 3 fields; the header has 2/,
  );
  assert.throws(
    () => previewCsv("Date,Amount\n2026-09-11"),
    /record 2 has 1 fields/,
  );
  const p = previewCsv("Date,Amount\n2026-09-11,125\n2026-09-12,40", 1);
  assert.equal(p.rows.length, 1);
  assert.equal(p.totalDataRows, 2);
});
