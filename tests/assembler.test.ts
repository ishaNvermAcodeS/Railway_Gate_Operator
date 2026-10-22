import { describe, expect, it } from 'vitest';
import { assemble, parseNumber } from '../src/engine';
import { SAMPLES } from '../src/programs/samples';

function ok(src: string) {
  const r = assemble(src);
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, errors.map((e) => `${e.line}: ${e.message}`).join('\n')).toHaveLength(0);
  return r.program!;
}

function errorsOf(src: string) {
  return assemble(src).diagnostics.filter((d) => d.severity === 'error');
}

describe('number literals', () => {
  it.each([
    ['25', 25],
    ['25d', 25],
    ['0FFh', 255],
    ['1Ah', 26],
    ['0x1f', 31],
    ['1010b', 10],
    ['0b11', 3],
    ["'A'", 65],
    ['-1', -1],
  ])('parses %s', (text, value) => {
    expect(parseNumber(text)).toEqual({ ok: true, value });
  });

  it('explains hex literals that start with a letter', () => {
    const r = parseNumber('FFh');
    expect(r && !r.ok && r.error).toMatch(/must start with a digit — write 0FFh/);
  });

  it('returns null for identifiers', () => {
    expect(parseNumber('START')).toBeNull();
  });
});

describe('assembler parsing', () => {
  it('parses labels, comments, mixed case and blank lines', () => {
    const p = ok(`
      ; leading comment
      start:  mov al, 5   ; trailing comment
              Out 02h, AL
      loop1:
              jmp START
    `);
    expect(p.instructions.map((i) => i.mnemonic)).toEqual(['MOV', 'OUT', 'JMP']);
    expect(p.labels.get('START')).toBe(0);
    expect(p.labels.get('LOOP1')).toBe(2);
    expect(p.instructions[2].operands[0]).toEqual({ kind: 'label', name: 'START', target: 0 });
    expect(p.instructions[0].line).toBe(3);
    expect(p.lineToIndex.get(4)).toBe(1);
  });

  it('resolves EQU constants, including chained constants and forward use', () => {
    const p = ok(`
      MOV AL, MASK
      MASK EQU 0Fh
      ALIAS EQU MASK
      MOV BL, ALIAS
      HLT
    `);
    expect(p.instructions[0].operands[1]).toMatchObject({ kind: 'imm', value: 15 });
    expect(p.instructions[1].operands[1]).toMatchObject({ kind: 'imm', value: 15 });
  });

  it('keeps a semicolon inside a character literal', () => {
    const p = ok(`MOV AL, ';'\nHLT`);
    expect(p.instructions[0].operands[1]).toMatchObject({ value: 59 });
  });

  it('lays out DB/DW data and resolves memory operands', () => {
    const p = ok(`
      ARR   DB 1, 2, 'AB', 3 DUP(0)
      WORDS DW 1234h, ?
      MOV AL, ARR[SI]
      MOV AX, [WORDS+2]
      MOV BYTE PTR [BX+DI-1], 7
      MOV SI, OFFSET WORDS
      LEA DI, ARR
      HLT
    `);
    expect(p.variables.map((v) => [v.name, v.address, v.size, v.count])).toEqual([
      ['ARR', 0x100, 8, 7],
      ['WORDS', 0x107, 16, 2],
    ]);
    expect(p.data.slice(0, 5)).toEqual([[0x100, 1], [0x101, 2], [0x102, 65], [0x103, 66], [0x104, 0]]);
    expect(p.data).toContainEqual([0x107, 0x34]);
    expect(p.data).toContainEqual([0x108, 0x12]);
    expect(p.instructions[0].operands[1]).toMatchObject({ kind: 'mem', base: null, index: 'SI', disp: 0x100, size: 8 });
    expect(p.instructions[1].operands[1]).toMatchObject({ kind: 'mem', disp: 0x109, size: 16 });
    expect(p.instructions[2].operands[0]).toMatchObject({ kind: 'mem', base: 'BX', index: 'DI', disp: 0xffff, size: 8 });
    expect(p.instructions[3].operands[1]).toMatchObject({ kind: 'imm', value: 0x107 });
  });

  it('assembles every bundled sample program', () => {
    for (const s of SAMPLES) ok(s.source);
  });
});

describe('assembler errors', () => {
  it('reports unknown instructions with a suggestion and column span', () => {
    const [e] = errorsOf('  MOOV AL, 1');
    expect(e.message).toMatch(/Unknown instruction "MOOV".*Did you mean MOV\?/);
    expect(e).toMatchObject({ line: 1, startColumn: 3, endColumn: 7 });
  });

  it('distinguishes real-but-unsupported 8086 instructions', () => {
    const [e] = errorsOf('MUL BL');
    expect(e.message).toMatch(/valid 8086 instruction but is not supported/);
  });

  it('reports undefined labels with suggestions', () => {
    const [e] = errorsOf('START: NOP\nJMP STRAT');
    expect(e.message).toMatch(/Undefined label "STRAT".*Did you mean START\?/);
    expect(e.line).toBe(2);
  });

  it('reports duplicate labels', () => {
    const [e] = errorsOf('A: NOP\nA: NOP');
    expect(e.message).toMatch(/Duplicate label "A" \(first defined on line 1\)/);
  });

  it('rejects operand size mismatches', () => {
    expect(errorsOf('MOV AL, BX')[0].message).toMatch(/size mismatch/);
  });

  it('rejects immediates that do not fit', () => {
    expect(errorsOf('MOV AL, 300')[0].message).toMatch(/does not fit in 8-bit register AL/);
    expect(errorsOf('MOV AX, 70000')[0].message).toMatch(/does not fit in 16-bit/);
  });

  it('rejects invalid memory operands with specific messages', () => {
    expect(errorsOf('MOV AL, [AX]')[0].message).toMatch(/not a valid 8086 address — use BX, BP, SI or DI/);
    expect(errorsOf('MOV AL, [BX+BP]')[0].message).toMatch(/only one base register/);
    expect(errorsOf('MOV [BX], 5')[0].message).toMatch(/BYTE PTR or WORD PTR/);
    expect(errorsOf('A DB 1\nB DB 2\nMOV A, B')[0].message).toMatch(/two memory operands/);
    expect(errorsOf('W DW 1\nMOV AL, W')[0].message).toMatch(/size mismatch/);
    expect(errorsOf('MOV AL, [NOPE]')[0].message).toMatch(/Undefined symbol "NOPE"/);
  });

  it('rejects bad data definitions', () => {
    expect(errorsOf('X DB 300')[0].message).toMatch(/does not fit in 8 bits/);
    expect(errorsOf('X DW "ab"')[0].message).toMatch(/only allowed in DB/);
    expect(errorsOf('X DB 1\nX DB 2')[0].message).toMatch(/already defined/);
  });

  it('validates IN/OUT forms', () => {
    expect(errorsOf('IN BL, 3')[0].message).toMatch(/destination must be AL/);
    expect(errorsOf('OUT 2, BL')[0].message).toMatch(/source must be AL/);
    expect(errorsOf('OUT 300, AL')[0].message).toMatch(/out of range/);
    expect(errorsOf('IN AL, CX')[0].message).toMatch(/must be DX/);
  });

  it('validates operand counts', () => {
    expect(errorsOf('MOV AL')[0].message).toMatch(/takes 2 operands, but 1 was given/);
    expect(errorsOf('HLT 5')[0].message).toMatch(/takes no operands/);
  });

  it('rejects directives explicitly', () => {
    expect(errorsOf('.CODE\nHLT')[0].message).toMatch(/Directive ".CODE" is not supported/);
  });

  it('rejects jumping to a number', () => {
    expect(errorsOf('JMP 5')[0].message).toMatch(/must be a code label/);
  });

  it('collects multiple errors and produces no program', () => {
    const r = assemble('FOO\nMOV AL, 999\nJMP NOWHERE');
    expect(r.program).toBeNull();
    expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.line)).toEqual([1, 2, 3]);
  });

  it('rejects an empty program', () => {
    expect(errorsOf('; nothing here')[0].message).toMatch(/no instructions/);
  });
});
