/**
 * Two-pass assembler for the supported 8086 subset.
 *
 * Pass 1 splits every line into label / mnemonic / operands and records label
 * addresses and EQU constants. Pass 2 resolves operands, validates them
 * against the instruction registry and produces `Instruction` objects.
 *
 * Instructions are addressed by index (IP = instruction number); machine code
 * bytes are not generated.
 */
import { INSTRUCTIONS, KNOWN_UNSUPPORTED } from './instructions';
import { parseNumber } from './numbers';
import { isReg16, isReg8, SEGMENT_REGS } from './registers';
import type { AssembleResult, BaseReg, Diagnostic, IndexReg, Instruction, Operand, Program, RegName, Variable } from './types';

const IDENT = /^[A-Za-z_.@?][\w.@?$]*$/;

/** DB/DW data is placed in memory starting at this address (segments are not modelled). */
export const DATA_BASE = 0x0100;

interface RawOperand {
  text: string;
  col: number; // 1-based start column
}

interface ParsedLine {
  line: number;
  mnemonic: string;
  mnemonicCol: number;
  operands: RawOperand[];
  index: number;
}

/** Finds a `;` that is not inside a character literal. */
function commentStart(src: string): number {
  let inQuote = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'") inQuote = !inQuote;
    else if (ch === ';' && !inQuote) return i;
  }
  return -1;
}

function splitOperands(text: string, baseCol: number): RawOperand[] {
  const out: RawOperand[] = [];
  if (text.trim() === '') return out;
  let start = 0;
  let inQuote = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (ch === "'") inQuote = !inQuote;
    if (i === text.length || (ch === ',' && !inQuote)) {
      const piece = text.slice(start, i);
      const lead = piece.length - piece.trimStart().length;
      out.push({ text: piece.trim(), col: baseCol + start + lead });
      start = i + 1;
    }
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** "Did you mean …?" helper. */
export function suggest(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best !== null && bestDist <= Math.max(1, Math.round(name.length / 2.5)) ? best : null;
}

export function assemble(source: string): AssembleResult {
  const diagnostics: Diagnostic[] = [];
  const labels = new Map<string, number>();
  const labelLines = new Map<string, number>();
  const constants = new Map<string, number>();
  const variables = new Map<string, Variable>();
  const data: Array<[number, number]> = [];
  let dataPtr = DATA_BASE;
  const parsed: ParsedLine[] = [];

  const error = (line: number, startColumn: number, length: number, message: string) => {
    diagnostics.push({ severity: 'error', line, startColumn, endColumn: startColumn + Math.max(1, length), message });
  };

  const lines = source.split(/\r?\n/);

  // ───────────── pass 1: structure, labels and constants
  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const cut = commentStart(rawLine);
    const code = cut >= 0 ? rawLine.slice(0, cut) : rawLine;
    let rest = code;
    let offset = 0; // 0-based column offset of `rest` within the line

    const skipWs = () => {
      const lead = rest.length - rest.trimStart().length;
      offset += lead;
      rest = rest.trimStart();
    };
    skipWs();
    if (rest.trim() === '') return;

    // Label definition: NAME:
    const labelMatch = /^([A-Za-z_.@?][\w.@?$]*)\s*:/.exec(rest);
    if (labelMatch) {
      const name = labelMatch[1].toUpperCase();
      if (isReg16(name) || isReg8(name) || INSTRUCTIONS.has(name)) {
        error(lineNo, offset + 1, labelMatch[1].length, `"${labelMatch[1]}" is a reserved word and cannot be used as a label`);
      } else if (labels.has(name)) {
        error(lineNo, offset + 1, labelMatch[1].length, `Duplicate label "${labelMatch[1]}" (first defined on line ${labelLines.get(name)})`);
      } else {
        labels.set(name, parsed.length);
        labelLines.set(name, lineNo);
      }
      offset += labelMatch[0].length;
      rest = rest.slice(labelMatch[0].length);
      skipWs();
      if (rest.trim() === '') return;
    }

    // Data definition: [NAME] DB|DW item, item, …
    const dataMatch = /^(?:([A-Za-z_.@?][\w.@?$]*)\s+)?(DB|DW)\b\s*(.*)$/i.exec(rest.trimEnd());
    if (dataMatch) {
      const rawName = dataMatch[1];
      const size: 8 | 16 = dataMatch[2].toUpperCase() === 'DB' ? 8 : 16;
      const itemsText = dataMatch[3];
      const itemsCol = offset + rest.indexOf(itemsText, (rawName?.length ?? 0) + 2) + 1;
      if (rawName) {
        const name = rawName.toUpperCase();
        if (isReg16(name) || isReg8(name) || INSTRUCTIONS.has(name)) {
          error(lineNo, offset + 1, rawName.length, `"${rawName}" is a reserved word and cannot be used as a variable name`);
          return;
        }
        if (labels.has(name) || constants.has(name) || variables.has(name)) {
          error(lineNo, offset + 1, rawName.length, `Symbol "${rawName}" is already defined`);
          return;
        }
      }
      const values = parseDataItems(itemsText, size, constants);
      if (typeof values === 'string') {
        error(lineNo, itemsCol, Math.max(1, itemsText.trim().length), `${dataMatch[2].toUpperCase()}: ${values}`);
        return;
      }
      const start = dataPtr;
      for (const v of values) {
        data.push([dataPtr & 0xffff, v & 0xff]);
        if (size === 16) data.push([(dataPtr + 1) & 0xffff, (v >> 8) & 0xff]);
        dataPtr += size / 8;
      }
      if (rawName) variables.set(rawName.toUpperCase(), { name: rawName.toUpperCase(), address: start, size, count: values.length, line: lineNo });
      return;
    }

    // Constant definition: NAME EQU value
    const equMatch = /^([A-Za-z_.@?][\w.@?$]*)\s+EQU\s+(.+)$/i.exec(rest.trimEnd());
    if (equMatch) {
      const name = equMatch[1].toUpperCase();
      const valueText = equMatch[2].trim();
      const valueCol = offset + rest.indexOf(equMatch[2]) + 1;
      if (constants.has(name) || labels.has(name) || variables.has(name)) {
        error(lineNo, offset + 1, equMatch[1].length, `Symbol "${equMatch[1]}" is already defined`);
        return;
      }
      const num = parseNumber(valueText);
      if (num && num.ok) constants.set(name, num.value);
      else if (constants.has(valueText.toUpperCase())) constants.set(name, constants.get(valueText.toUpperCase())!);
      else error(lineNo, valueCol, valueText.length, num && !num.ok ? num.error : `EQU value "${valueText}" must be a number or a previously defined constant`);
      return;
    }

    const mm = /^(\S+)/.exec(rest)!;
    const mnemonicText = mm[1];
    const mnemonicCol = offset + 1;
    const mnemonic = mnemonicText.toUpperCase();
    const operandText = rest.slice(mnemonicText.length);
    const operands = splitOperands(operandText, offset + mnemonicText.length + 1);

    if (mnemonic.startsWith('.') || ['ORG', 'DD', 'DQ', 'SEGMENT', 'ENDS', 'ASSUME', 'PROC', 'ENDP', 'END', 'MODEL', 'CODE', 'DATA', 'STACK'].includes(mnemonic)) {
      error(lineNo, mnemonicCol, mnemonicText.length, `Directive "${mnemonicText}" is not supported. Hex86 programs are plain instruction lists; only labels, EQU constants and DB/DW data are needed.`);
      return;
    }
    if (operands.length > 0 && /^EQU$/i.test(operands[0].text.split(/\s+/)[0] ?? '')) {
      error(lineNo, mnemonicCol, mnemonicText.length, 'Malformed EQU — expected NAME EQU value');
      return;
    }
    if (!INSTRUCTIONS.has(mnemonic)) {
      if (KNOWN_UNSUPPORTED.has(mnemonic)) {
        error(lineNo, mnemonicCol, mnemonicText.length, `${mnemonic} is a valid 8086 instruction but is not supported by this simulator yet. See the instruction reference for the supported subset.`);
      } else {
        const hint = suggest(mnemonic, INSTRUCTIONS.keys());
        error(lineNo, mnemonicCol, mnemonicText.length, `Unknown instruction "${mnemonicText}".${hint ? ` Did you mean ${hint}?` : ''}`);
      }
      return;
    }
    parsed.push({ line: lineNo, mnemonic, mnemonicCol, operands, index: parsed.length });
  });

  // ───────────── pass 2: operands
  const instructions: Instruction[] = [];
  const lineToIndex = new Map<number, number>();

  for (const p of parsed) {
    const def = INSTRUCTIONS.get(p.mnemonic)!;
    const ops: Operand[] = [];
    let failed = false;

    for (const raw of p.operands) {
      const result = resolveOperand(raw, !!def.takesLabel, labels, constants, variables);
      if (typeof result === 'string') {
        error(p.line, raw.col, raw.text.length || 1, result);
        failed = true;
      } else {
        ops.push(result);
      }
    }
    if (failed) continue;

    const problem = def.validate(ops);
    if (problem) {
      const start = p.mnemonicCol;
      const last = p.operands[p.operands.length - 1];
      const end = last ? last.col + last.text.length : start + p.mnemonic.length;
      error(p.line, start, end - start, problem);
      continue;
    }

    const text = p.operands.length ? `${p.mnemonic} ${p.operands.map((o) => o.text).join(', ')}` : p.mnemonic;
    instructions.push({ index: p.index, mnemonic: p.mnemonic, operands: ops, line: p.line, text });
    lineToIndex.set(p.line, p.index);
  }

  if (parsed.length === 0 && diagnostics.length === 0) {
    diagnostics.push({ severity: 'error', line: 1, startColumn: 1, endColumn: 2, message: 'The program contains no instructions' });
  }

  for (const [name, idx] of labels) {
    if (idx >= parsed.length && parsed.length > 0) {
      const line = labelLines.get(name)!;
      diagnostics.push({ severity: 'warning', line, startColumn: 1, endColumn: name.length + 2, message: `Label "${name}" is at the end of the program — jumping there will run off the end` });
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  const program: Program | null = hasErrors ? null : { instructions, labels, constants, lineToIndex, variables: [...variables.values()], data };
  diagnostics.sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  return { program, diagnostics };
}

function resolveOperand(
  raw: RawOperand,
  takesLabel: boolean,
  labels: Map<string, number>,
  constants: Map<string, number>,
  variables: Map<string, Variable>,
): Operand | string {
  const text = raw.text;
  const upper = text.toUpperCase();
  if (text === '') return 'Missing operand';

  const offsetMatch = /^OFFSET\s+(.+)$/i.exec(text);
  if (offsetMatch) {
    const name = offsetMatch[1].trim().toUpperCase();
    const v = variables.get(name);
    if (v) return { kind: 'imm', value: v.address, text };
    return labels.has(name) ? `OFFSET of code label "${offsetMatch[1].trim()}" is not supported (code has no byte addresses)` : `OFFSET: undefined variable "${offsetMatch[1].trim()}"`;
  }
  const ptrMatch = /^(BYTE|WORD|DWORD)\s+PTR\s+(.+)$/i.exec(text);
  if (ptrMatch || text.includes('[') || text.includes(']') || variables.has(upper)) {
    return parseMemory(text, ptrMatch, constants, variables, labels);
  }
  if (isReg16(upper) || isReg8(upper)) {
    const reg = upper as RegName;
    return { kind: 'reg', reg, size: isReg8(upper) ? 8 : 16 };
  }
  if ((SEGMENT_REGS as readonly string[]).includes(upper)) {
    return `Segment register ${upper} is not modelled by this simulator`;
  }

  const num = parseNumber(text);
  if (num) return num.ok ? { kind: 'imm', value: num.value, text } : num.error;

  if (!IDENT.test(text)) return `Cannot parse operand "${text}"`;

  if (constants.has(upper)) return { kind: 'imm', value: constants.get(upper)!, text };

  if (takesLabel) {
    if (labels.has(upper)) return { kind: 'label', name: upper, target: labels.get(upper)! };
    const hint = suggest(upper, labels.keys());
    return `Undefined label "${text}".${hint ? ` Did you mean ${hint}?` : ''}`;
  }
  if (labels.has(upper)) {
    return `"${text}" is a code label and cannot be used as a value here`;
  }
  const hint = suggest(upper, [...constants.keys(), 'AX', 'BX', 'CX', 'DX', 'AL', 'AH', 'BL', 'BH', 'CL', 'CH', 'DL', 'DH', 'SI', 'DI', 'BP', 'SP']);
  return `Undefined symbol "${text}".${hint ? ` Did you mean ${hint}?` : ''}`;
}

/** Parses DB/DW items: numbers, constants, characters, strings (DB only), `?` and `n DUP(v)`. */
function parseDataItems(text: string, size: 8 | 16, constants: Map<string, number>): number[] | string {
  const items: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      items.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (quote) return 'unterminated string';
  items.push(cur.trim());
  if (items.length === 1 && items[0] === '') return 'expected at least one value';

  const max = size === 8 ? 0xff : 0xffff;
  const min = size === 8 ? -128 : -32768;
  const value = (t: string): number | string => {
    if (t === '?') return 0;
    const num = parseNumber(t);
    if (num) return num.ok ? num.value : num.error;
    const c = constants.get(t.toUpperCase());
    if (c !== undefined) return c;
    return `cannot parse value "${t}"`;
  };

  const out: number[] = [];
  for (const item of items) {
    if (item === '') return 'empty value between commas';
    const str = /^(['"])(.*)\1$/.exec(item);
    if (str && str[2].length !== 1) {
      if (size !== 8) return 'strings are only allowed in DB';
      for (const ch of str[2]) out.push(ch.charCodeAt(0));
      continue;
    }
    const dup = /^(.+?)\s+DUP\s*\(\s*(.+?)\s*\)$/i.exec(item);
    if (dup) {
      const n = value(dup[1].trim());
      const v = value(dup[2]);
      if (typeof n === 'string') return n;
      if (typeof v === 'string') return v;
      if (n < 1 || n > 4096) return `DUP count ${n} must be between 1 and 4096`;
      if (v < min || v > max) return `value ${dup[2]} does not fit in ${size} bits`;
      for (let i = 0; i < n; i++) out.push(v);
      continue;
    }
    const v = value(str ? `'${str[2]}'` : item);
    if (typeof v === 'string') return v;
    if (v < min || v > max) return `value ${item} does not fit in ${size} bits`;
    out.push(v);
  }
  return out;
}

/**
 * Parses a memory operand: [BX], [BX+SI+4], [SI-2], ARR, ARR[SI], [ARR+BX], BYTE PTR [DI] …
 * Valid 8086 address forms: optional base (BX/BP) + optional index (SI/DI) + displacement.
 */
function parseMemory(
  text: string,
  ptr: RegExpExecArray | null,
  constants: Map<string, number>,
  variables: Map<string, Variable>,
  labels: Map<string, number>,
): Operand | string {
  let size: 8 | 16 | null = null;
  let body = text;
  if (ptr) {
    if (ptr[1].toUpperCase() === 'DWORD') return 'DWORD PTR is not supported — the 8086 has 8- and 16-bit operands';
    size = ptr[1].toUpperCase() === 'BYTE' ? 8 : 16;
    body = ptr[2].trim();
  }
  // NAME[expr] → [NAME + expr]
  const indexed = /^([A-Za-z_.@?][\w.@?$]*)\s*\[(.*)\]$/.exec(body);
  let inner: string;
  if (indexed) inner = `${indexed[1]}+${indexed[2]}`;
  else if (/^\[.*\]$/.test(body)) inner = body.slice(1, -1);
  else inner = body;
  if (inner.includes('[') || inner.includes(']')) return `Cannot parse memory operand "${text}"`;
  if (inner.trim() === '') return `Empty memory operand "${text}"`;

  let base: BaseReg | null = null;
  let index: IndexReg | null = null;
  let disp = 0;
  let varSize: 8 | 16 | null = null;
  const terms = inner.replace(/\s+/g, '').match(/[+-]?[^+-]+/g) ?? [];
  for (const term of terms) {
    const neg = term.startsWith('-');
    const t = term.replace(/^[+-]/, '').toUpperCase();
    if (t === 'BX' || t === 'BP') {
      if (neg) return `"${text}": a register cannot be subtracted in an address`;
      if (base) return `"${text}": only one base register (BX or BP) is allowed`;
      base = t;
    } else if (t === 'SI' || t === 'DI') {
      if (neg) return `"${text}": a register cannot be subtracted in an address`;
      if (index) return `"${text}": only one index register (SI or DI) is allowed`;
      index = t;
    } else if (isReg16(t) || isReg8(t)) {
      return `[${t}] is not a valid 8086 address — use BX, BP, SI or DI (e.g. [BX+SI+2])`;
    } else if (variables.has(t)) {
      if (neg) return `"${text}": a variable address cannot be subtracted`;
      const v = variables.get(t)!;
      disp += v.address;
      varSize ??= v.size;
    } else if (constants.has(t)) {
      disp += (neg ? -1 : 1) * constants.get(t)!;
    } else {
      const num = parseNumber(t);
      if (num && num.ok) disp += (neg ? -1 : 1) * num.value;
      else if (num && !num.ok) return num.error;
      else if (labels.has(t)) return `"${t}" is a code label; memory operands need a DB/DW variable, a register or a number`;
      else {
        const hint = suggest(t, [...variables.keys(), ...constants.keys()]);
        return `Undefined symbol "${term.replace(/^[+-]/, '')}" in memory operand.${hint ? ` Did you mean ${hint}?` : ''}`;
      }
    }
  }
  return { kind: 'mem', base, index, disp: disp & 0xffff, size: size ?? varSize, text };
}
