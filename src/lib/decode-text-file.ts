/**
 * Decode a statement file to text, honouring the charset it declares.
 *
 * `File.text()` always assumes UTF-8. Brazilian banks routinely export OFX and
 * CSV in Windows-1252 — the reference file in this repo declares
 * `CHARSET:1252` — so accented words came through as U+FFFD and were written
 * that way into `statement_entries.rawDescription`, which the project treats as
 * immutable. It also poisoned deduplication: the hash covers the description,
 * so the same statement re-exported in UTF-8 hashed differently and imported
 * twice.
 */
export function decodeTextFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  const asUtf8 = new TextDecoder("utf-8").decode(bytes);

  // An OFX header states the charset outright.
  const header = asUtf8.slice(0, 2048).toUpperCase();
  const declaresWindows1252 =
    /CHARSET\s*:\s*(1252|WINDOWS-1252)/.test(header) ||
    /ENCODING\s*:\s*(USASCII|ISO-8859-1|LATIN-?1)/.test(header);

  // Otherwise, replacement characters mean the bytes were not UTF-8 after all.
  const hasReplacementChars = asUtf8.includes("�");

  if (declaresWindows1252 || hasReplacementChars) {
    return new TextDecoder("windows-1252").decode(bytes);
  }

  return asUtf8;
}
