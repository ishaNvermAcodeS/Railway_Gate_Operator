/**
 * Numeric literal parsing in MASM/TASM style.
 *
 *   25, 25d          decimal
 *   0FFh, 1Ah        hexadecimal (must start with a digit)
 *   0x1A             C-style hexadecimal
 *   1010b, 0b1010    binary
 *   'A'              character (ASCII code)
 *
 * Returns the value, `null` if the text is not a number at all, or an error
 * message string when it looks like a number but is malformed.
 */
export type NumberParse = { ok: true; value: number } | { ok: false; error: string } | null;

export function parseNumber(raw: string): NumberParse {
  const text = raw.trim();
  if (text === '') return null;

  let sign = 1;
  let body = text;
  if (body.startsWith('-') || body.startsWith('+')) {
    sign = body.startsWith('-') ? -1 : 1;
    body = body.slice(1).trim();
  }

  const charLit = /^'(.)'$/.exec(body);
  if (charLit) return { ok: true, value: sign * charLit[1].charCodeAt(0) };

  if (/^0x[0-9a-f]+$/i.test(body)) return { ok: true, value: sign * parseInt(body.slice(2), 16) };
  if (/^0b[01]+$/i.test(body)) return { ok: true, value: sign * parseInt(body.slice(2), 2) };
  if (/^[0-9][0-9a-f]*h$/i.test(body)) return { ok: true, value: sign * parseInt(body.slice(0, -1), 16) };
  if (/^[01]+b$/i.test(body)) return { ok: true, value: sign * parseInt(body.slice(0, -1), 2) };
  if (/^[0-9]+d?$/i.test(body)) return { ok: true, value: sign * parseInt(body, 10) };

  if (/^[a-f][0-9a-f]*h$/i.test(body)) {
    return { ok: false, error: `Hex literal "${body}" must start with a digit — write 0${body}` };
  }
  if (/^[0-9]/.test(body)) {
    return { ok: false, error: `Malformed number "${body}" (use 25, 0FFh, 0x1F or 1010b)` };
  }
  return null;
}
