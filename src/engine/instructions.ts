/**
 * Instruction set registry.
 *
 * Every supported mnemonic is described by an `InstructionDef`: its
 * documentation (used by the editor hover, the in-app reference and the
 * README), an operand validator used at assembly time, and an executor used
 * at run time. Adding an instruction means adding one entry here — nothing
 * else in the engine needs to change.
 */
import { addWithFlags, logicFlags, maskFor, setResultFlags, signBitFor, subWithFlags } from './flags';
import { getReg, hex, setReg } from './registers';
import { AsmRuntimeError, type CpuState, type Flags, type Instruction, type IoBus, type Operand } from './types';

export interface ExecContext {
  cpu: CpuState;
  bus: IoBus;
  effects: string[];
  io?: { dir: 'in' | 'out'; port: number; value: number };
  /** Set by control-transfer instructions; otherwise IP advances by one. */
  nextIp?: number;
}

export type InstructionGroup = 'Data transfer' | 'Arithmetic' | 'Logic' | 'Control transfer' | 'I/O' | 'Processor control';

export interface InstructionDef {
  mnemonic: string;
  group: InstructionGroup;
  syntax: string[];
  summary: string;
  flags: string;
  /** Returns an error message, or null if the operands are acceptable. */
  validate(ops: Operand[]): string | null;
  execute(ctx: ExecContext, instr: Instruction): void;
  /** True when a bare identifier operand should be treated as a code label. */
  takesLabel?: boolean;
}

// ───────────────────────── operand helpers ─────────────────────────

const isReg = (o: Operand | undefined): o is Extract<Operand, { kind: 'reg' }> => o?.kind === 'reg';
const isImm = (o: Operand | undefined): o is Extract<Operand, { kind: 'imm' }> => o?.kind === 'imm';
const isLabel = (o: Operand | undefined): o is Extract<Operand, { kind: 'label' }> => o?.kind === 'label';
const isMem = (o: Operand | undefined): o is MemOperand => o?.kind === 'mem';

type MemOperand = Extract<Operand, { kind: 'mem' }>;
/** A register or memory operand that can be written. */
type RmOperand = Extract<Operand, { kind: 'reg' }> | MemOperand;

function describe(o: Operand): string {
  if (o.kind === 'reg') return `${o.size}-bit register ${o.reg}`;
  if (o.kind === 'imm') return `immediate ${o.text}`;
  if (o.kind === 'mem') return `memory operand ${o.text}`;
  return `label ${o.name}`;
}

const UNSIZED = 'operand size is unknown — write BYTE PTR or WORD PTR, e.g. MOV BYTE PTR [BX], 5';

function count(ops: Operand[], n: number, mnemonic: string): string | null {
  if (ops.length === n) return null;
  const want = n === 0 ? 'no operands' : n === 1 ? 'one operand' : `${n} operands`;
  return `${mnemonic} takes ${want}, but ${ops.length} ${ops.length === 1 ? 'was' : 'were'} given`;
}

function immFits(value: number, size: 8 | 16): boolean {
  return size === 8 ? value >= -128 && value <= 0xff : value >= -32768 && value <= 0xffff;
}

/** Operand size of a two-operand instruction (validated beforehand). */
function opSize(instr: Instruction): 8 | 16 {
  for (const o of instr.operands) {
    if (o.kind === 'reg') return o.size;
    if (o.kind === 'mem' && o.size) return o.size;
  }
  return 16;
}

function rmName(o: RmOperand): string {
  return o.kind === 'reg' ? o.reg : o.text;
}

/**
 * Validates the `reg/mem, reg/mem/imm` forms shared by MOV, ADD, CMP, AND…:
 * reg,reg · reg,imm · reg,mem · mem,reg · mem,imm (mem,mem is illegal on the 8086).
 */
function validateRegSrc(mnemonic: string, ops: Operand[]): string | null {
  const c = count(ops, 2, mnemonic);
  if (c) return c;
  const [dst, src] = ops;
  if (!isReg(dst) && !isMem(dst)) {
    return `${mnemonic}: destination must be a register or memory operand, got ${describe(dst)}`;
  }
  if (isMem(dst) && isMem(src)) {
    return `${mnemonic}: the 8086 does not allow two memory operands — load one into a register first`;
  }
  if (!isReg(src) && !isImm(src) && !isMem(src)) {
    return `${mnemonic}: source must be a register, memory operand or immediate value, got ${describe(src)}`;
  }
  const dstSize = isReg(dst) ? dst.size : dst.size;
  const srcSize = isReg(src) ? src.size : isMem(src) ? src.size : null;
  if (dstSize && srcSize && dstSize !== srcSize) {
    return `${mnemonic}: operand size mismatch — ${rmName(dst)} is ${dstSize}-bit but ${isReg(src) ? src.reg : (src as MemOperand).text} is ${srcSize}-bit`;
  }
  const size = dstSize ?? srcSize;
  if (!size) return `${mnemonic}: ${UNSIZED}`;
  if (isImm(src) && !immFits(src.value, size)) {
    return `${mnemonic}: value ${src.text} does not fit in ${size}-bit ${isReg(dst) ? `register ${dst.reg}` : `memory operand ${dst.text}`}`;
  }
  return null;
}

/** One register (or, when `allowMem`, a sized memory operand). */
function validateSingleReg(mnemonic: string, ops: Operand[], only16 = false, allowMem = false): string | null {
  const c = count(ops, 1, mnemonic);
  if (c) return c;
  const [op] = ops;
  if (allowMem && isMem(op)) return op.size ? null : `${mnemonic}: ${UNSIZED}`;
  if (!isReg(op)) return `${mnemonic}: operand must be a ${allowMem ? 'register or memory operand' : 'register'}, got ${describe(op)}`;
  if (only16 && op.size !== 16) return `${mnemonic}: operand must be a 16-bit register (8086 stack operations are word-sized)`;
  return null;
}

// ───────────────────────── memory helpers

export function effectiveAddress(cpu: CpuState, m: MemOperand): number {
  return ((m.base ? cpu.regs[m.base] : 0) + (m.index ? cpu.regs[m.index] : 0) + m.disp) & 0xffff;
}

export function readMem(cpu: CpuState, addr: number, size: 8 | 16): number {
  const lo = cpu.memory[addr & 0xffff] ?? 0;
  return size === 8 ? lo : lo | ((cpu.memory[(addr + 1) & 0xffff] ?? 0) << 8);
}

export function writeMem(cpu: CpuState, addr: number, value: number, size: 8 | 16): void {
  cpu.memory[addr & 0xffff] = value & 0xff;
  if (size === 16) cpu.memory[(addr + 1) & 0xffff] = (value >> 8) & 0xff;
}

function validateLabel(mnemonic: string, ops: Operand[]): string | null {
  const c = count(ops, 1, mnemonic);
  if (c) return c;
  if (!isLabel(ops[0])) return `${mnemonic}: operand must be a code label, got ${describe(ops[0])}`;
  return null;
}

function read(cpu: CpuState, o: Operand, size: 8 | 16): number {
  if (o.kind === 'reg') return getReg(cpu, o.reg);
  if (o.kind === 'imm') return o.value & maskFor(size);
  if (o.kind === 'mem') return readMem(cpu, effectiveAddress(cpu, o), size);
  throw new AsmRuntimeError(`Cannot read value of label ${o.name}`);
}

function dstReg(instr: Instruction) {
  return instr.operands[0] as Extract<Operand, { kind: 'reg' }>;
}

function fmt(value: number, size: 8 | 16): string {
  return hex(value, size === 8 ? 2 : 4);
}

/** Writes to operand `i` (register or memory) and records the effect. */
function writeOp(ctx: ExecContext, o: Operand, value: number, size: 8 | 16) {
  if (o.kind === 'mem') {
    const addr = effectiveAddress(ctx.cpu, o);
    writeMem(ctx.cpu, addr, value, size);
    ctx.effects.push(`[${fmt(addr, 16)}] ← ${fmt(value & maskFor(size), size)}`);
    return;
  }
  const r = o as Extract<Operand, { kind: 'reg' }>;
  setReg(ctx.cpu, r.reg, value);
  ctx.effects.push(`${r.reg} ← ${fmt(getReg(ctx.cpu, r.reg), r.size)}`);
}

function writeDst(ctx: ExecContext, instr: Instruction, value: number) {
  writeOp(ctx, instr.operands[0], value, opSize(instr));
}

function flagSummary(f: Flags): string {
  return `ZF=${+f.ZF} CF=${+f.CF} SF=${+f.SF} OF=${+f.OF}`;
}

// ───────────────────────── stack helpers ─────────────────────────

function push(cpu: CpuState, value: number) {
  const sp = (cpu.regs.SP - 2) & 0xffff;
  cpu.regs.SP = sp;
  writeMem(cpu, sp, value, 16);
}

function pop(cpu: CpuState): number {
  const sp = cpu.regs.SP;
  if (sp >= 0xfffe) {
    throw new AsmRuntimeError('Stack underflow: POP/RET executed with an empty stack');
  }
  const value = readMem(cpu, sp, 16);
  cpu.regs.SP = (sp + 2) & 0xffff;
  return value;
}

// ───────────────────────── definitions ─────────────────────────

type BinaryOp = (f: Flags, a: number, b: number, size: 8 | 16) => number;

function arith(mnemonic: string, group: InstructionGroup, summary: string, flags: string, op: BinaryOp, writeBack = true): InstructionDef {
  return {
    mnemonic,
    group,
    syntax: [`${mnemonic} reg, reg/imm/mem`, `${mnemonic} mem, reg/imm`],
    summary,
    flags,
    validate: (ops) => validateRegSrc(mnemonic, ops),
    execute(ctx, instr) {
      const size = opSize(instr);
      const a = read(ctx.cpu, instr.operands[0], size);
      const b = read(ctx.cpu, instr.operands[1], size);
      const r = op(ctx.cpu.flags, a, b, size);
      if (writeBack) writeDst(ctx, instr, r);
      ctx.effects.push(flagSummary(ctx.cpu.flags));
    },
  };
}

const logic = (fn: (a: number, b: number) => number): BinaryOp => (f, a, b, size) => {
  const r = fn(a, b) & maskFor(size);
  logicFlags(f, r, size);
  return r;
};

interface Condition {
  names: string[];
  summary: string;
  test: (f: Flags) => boolean;
}

/** Conditional jumps; the first name is canonical, the rest are aliases. */
export const CONDITIONS: Condition[] = [
  { names: ['JE', 'JZ'], summary: 'Jump if equal / zero (ZF=1)', test: (f) => f.ZF },
  { names: ['JNE', 'JNZ'], summary: 'Jump if not equal / not zero (ZF=0)', test: (f) => !f.ZF },
  { names: ['JC', 'JB', 'JNAE'], summary: 'Jump if carry / unsigned below (CF=1)', test: (f) => f.CF },
  { names: ['JNC', 'JAE', 'JNB'], summary: 'Jump if no carry / unsigned above or equal (CF=0)', test: (f) => !f.CF },
  { names: ['JA', 'JNBE'], summary: 'Jump if unsigned above (CF=0 and ZF=0)', test: (f) => !f.CF && !f.ZF },
  { names: ['JBE', 'JNA'], summary: 'Jump if unsigned below or equal (CF=1 or ZF=1)', test: (f) => f.CF || f.ZF },
  { names: ['JG', 'JNLE'], summary: 'Jump if signed greater (ZF=0 and SF=OF)', test: (f) => !f.ZF && f.SF === f.OF },
  { names: ['JGE', 'JNL'], summary: 'Jump if signed greater or equal (SF=OF)', test: (f) => f.SF === f.OF },
  { names: ['JL', 'JNGE'], summary: 'Jump if signed less (SF≠OF)', test: (f) => f.SF !== f.OF },
  { names: ['JLE', 'JNG'], summary: 'Jump if signed less or equal (ZF=1 or SF≠OF)', test: (f) => f.ZF || f.SF !== f.OF },
  { names: ['JS'], summary: 'Jump if sign (SF=1)', test: (f) => f.SF },
  { names: ['JNS'], summary: 'Jump if not sign (SF=0)', test: (f) => !f.SF },
  { names: ['JO'], summary: 'Jump if overflow (OF=1)', test: (f) => f.OF },
  { names: ['JNO'], summary: 'Jump if not overflow (OF=0)', test: (f) => !f.OF },
  { names: ['JP', 'JPE'], summary: 'Jump if parity even (PF=1)', test: (f) => f.PF },
  { names: ['JNP', 'JPO'], summary: 'Jump if parity odd (PF=0)', test: (f) => !f.PF },
];

function jump(ctx: ExecContext, instr: Instruction, taken: boolean, why: string) {
  const target = (instr.operands[0] as Extract<Operand, { kind: 'label' }>);
  if (taken) {
    ctx.nextIp = target.target;
    ctx.effects.push(`→ ${target.name} (${why})`);
  } else {
    ctx.effects.push(`not taken (${why})`);
  }
}

function conditionalJump(name: string, cond: Condition): InstructionDef {
  return {
    mnemonic: name,
    group: 'Control transfer',
    syntax: [`${name} label`],
    summary: cond.summary + (cond.names.length > 1 ? `. Same as ${cond.names.filter((n) => n !== name).join(', ')}.` : '.'),
    flags: 'none',
    takesLabel: true,
    validate: (ops) => validateLabel(name, ops),
    execute(ctx, instr) {
      jump(ctx, instr, cond.test(ctx.cpu.flags), flagSummary(ctx.cpu.flags));
    },
  };
}

function loopDef(mnemonic: string, summary: string, extra: (f: Flags) => boolean): InstructionDef {
  return {
    mnemonic,
    group: 'Control transfer',
    syntax: [`${mnemonic} label`],
    summary,
    flags: 'none',
    takesLabel: true,
    validate: (ops) => validateLabel(mnemonic, ops),
    execute(ctx, instr) {
      const cx = (ctx.cpu.regs.CX - 1) & 0xffff;
      ctx.cpu.regs.CX = cx;
      ctx.effects.push(`CX ← ${fmt(cx, 16)}`);
      jump(ctx, instr, cx !== 0 && extra(ctx.cpu.flags), `CX=${cx}`);
    },
  };
}

function validateIn(ops: Operand[]): string | null {
  const c = count(ops, 2, 'IN');
  if (c) return c;
  const [dst, port] = ops;
  if (!isReg(dst) || (dst.reg !== 'AL' && dst.reg !== 'AX')) {
    return 'IN: destination must be AL (byte) or AX (word) — e.g. IN AL, 03h';
  }
  return validatePort('IN', port);
}

function validateOut(ops: Operand[]): string | null {
  const c = count(ops, 2, 'OUT');
  if (c) return c;
  const [port, src] = ops;
  const p = validatePort('OUT', port);
  if (p) return p;
  if (!isReg(src) || (src.reg !== 'AL' && src.reg !== 'AX')) {
    return 'OUT: source must be AL (byte) or AX (word) — e.g. OUT 02h, AL';
  }
  return null;
}

function validatePort(mnemonic: string, port: Operand): string | null {
  if (isReg(port)) {
    return port.reg === 'DX' ? null : `${mnemonic}: a register port address must be DX, not ${port.reg}`;
  }
  if (isImm(port)) {
    return port.value >= 0 && port.value <= 0xff
      ? null
      : `${mnemonic}: immediate port ${port.text} is out of range 0–255 (use DX for 16-bit port addresses)`;
  }
  return `${mnemonic}: port must be an 8-bit immediate or DX`;
}

function portOf(cpu: CpuState, o: Operand): number {
  return o.kind === 'reg' ? cpu.regs.DX : (o as { value: number }).value;
}

function shiftDef(mnemonic: 'SHL' | 'SHR'): InstructionDef {
  return {
    mnemonic,
    group: 'Logic',
    syntax: [`${mnemonic} reg, 1`, `${mnemonic} reg, CL`, `${mnemonic} reg, imm`],
    summary:
      mnemonic === 'SHL'
        ? 'Shift left; the last bit shifted out goes to CF. (Immediate counts above 1 are an 80186 extension accepted here for convenience.)'
        : 'Logical shift right; the last bit shifted out goes to CF. (Immediate counts above 1 are an 80186 extension accepted here for convenience.)',
    flags: 'CF, ZF, SF, PF, OF (OF defined for count 1)',
    validate(ops) {
      const c = count(ops, 2, mnemonic);
      if (c) return c;
      const [dst, cnt] = ops;
      if (!isReg(dst)) return `${mnemonic}: destination must be a register`;
      if (isReg(cnt) && cnt.reg === 'CL') return null;
      if (isImm(cnt) && cnt.value >= 0 && cnt.value <= 31) return null;
      return `${mnemonic}: shift count must be CL or an immediate 0–31`;
    },
    execute(ctx, instr) {
      const d = dstReg(instr);
      const size = d.size;
      const m = maskFor(size);
      const n = (instr.operands[1].kind === 'reg' ? ctx.cpu.regs.CX & 0xff : (instr.operands[1] as { value: number }).value) & 0x1f;
      if (n === 0) {
        ctx.effects.push('count 0 — no change');
        return;
      }
      let v = getReg(ctx.cpu, d.reg);
      const f = ctx.cpu.flags;
      if (mnemonic === 'SHL') {
        for (let i = 0; i < n; i++) {
          f.CF = (v & signBitFor(size)) !== 0;
          v = (v << 1) & m;
        }
        f.OF = ((v & signBitFor(size)) !== 0) !== f.CF;
      } else {
        const original = v;
        for (let i = 0; i < n; i++) {
          f.CF = (v & 1) !== 0;
          v = v >>> 1;
        }
        f.OF = (original & signBitFor(size)) !== 0;
      }
      setResultFlags(f, v, size);
      writeDst(ctx, instr, v);
      ctx.effects.push(flagSummary(f));
    },
  };
}

const defs: InstructionDef[] = [
  // ── Data transfer
  {
    mnemonic: 'MOV',
    group: 'Data transfer',
    syntax: ['MOV reg, reg/imm/mem', 'MOV mem, reg/imm'],
    summary: 'Copy the source operand into the destination register or memory location.',
    flags: 'none',
    validate: (ops) => validateRegSrc('MOV', ops),
    execute(ctx, instr) {
      writeDst(ctx, instr, read(ctx.cpu, instr.operands[1], opSize(instr)));
    },
  },
  {
    mnemonic: 'XCHG',
    group: 'Data transfer',
    syntax: ['XCHG reg, reg', 'XCHG reg, mem', 'XCHG mem, reg'],
    summary: 'Exchange the contents of two operands of the same size.',
    flags: 'none',
    validate(ops) {
      const e = validateRegSrc('XCHG', ops);
      if (e) return e;
      return isImm(ops[1]) ? 'XCHG: cannot exchange with an immediate value' : null;
    },
    execute(ctx, instr) {
      const [a, b] = instr.operands;
      const size = opSize(instr);
      const va = read(ctx.cpu, a, size);
      const vb = read(ctx.cpu, b, size);
      writeOp(ctx, a, vb, size);
      writeOp(ctx, b, va, size);
    },
  },
  {
    mnemonic: 'LEA',
    group: 'Data transfer',
    syntax: ['LEA reg16, mem'],
    summary: 'Load the effective address (offset) of a memory operand into a 16-bit register, e.g. LEA SI, ARRAY.',
    flags: 'none',
    validate(ops) {
      const c = count(ops, 2, 'LEA');
      if (c) return c;
      const [dst, src] = ops;
      if (!isReg(dst) || dst.size !== 16) return 'LEA: destination must be a 16-bit register';
      if (!isMem(src)) return `LEA: source must be a memory operand, got ${describe(src)}`;
      return null;
    },
    execute(ctx, instr) {
      writeDst(ctx, instr, effectiveAddress(ctx.cpu, instr.operands[1] as MemOperand));
    },
  },
  {
    mnemonic: 'PUSH',
    group: 'Data transfer',
    syntax: ['PUSH reg16'],
    summary: 'Decrement SP by 2 and store a 16-bit register on the stack.',
    flags: 'none',
    validate: (ops) => validateSingleReg('PUSH', ops, true),
    execute(ctx, instr) {
      const r = dstReg(instr);
      push(ctx.cpu, getReg(ctx.cpu, r.reg));
      ctx.effects.push(`[SP=${fmt(ctx.cpu.regs.SP, 16)}] ← ${r.reg}`);
    },
  },
  {
    mnemonic: 'POP',
    group: 'Data transfer',
    syntax: ['POP reg16'],
    summary: 'Load a 16-bit register from the top of the stack and increment SP by 2.',
    flags: 'none',
    validate: (ops) => validateSingleReg('POP', ops, true),
    execute(ctx, instr) {
      writeDst(ctx, instr, pop(ctx.cpu));
    },
  },
  // ── I/O
  {
    mnemonic: 'IN',
    group: 'I/O',
    syntax: ['IN AL, imm8', 'IN AX, imm8', 'IN AL, DX', 'IN AX, DX'],
    summary: 'Read a byte (AL) or word (AX) from an I/O port. Port 03h returns the railway sensor inputs.',
    flags: 'none',
    validate: validateIn,
    execute(ctx, instr) {
      const d = dstReg(instr);
      const port = portOf(ctx.cpu, instr.operands[1]);
      const value = ctx.bus.read(port, d.size) & maskFor(d.size);
      setReg(ctx.cpu, d.reg, value);
      ctx.io = { dir: 'in', port, value };
      ctx.effects.push(`${d.reg} ← port ${fmt(port, 8)} = ${fmt(value, d.size)}`);
    },
  },
  {
    mnemonic: 'OUT',
    group: 'I/O',
    syntax: ['OUT imm8, AL', 'OUT imm8, AX', 'OUT DX, AL', 'OUT DX, AX'],
    summary: 'Write AL or AX to an I/O port. Port 02h drives the warning lights, buzzer, gate motor and fault lamp.',
    flags: 'none',
    validate: validateOut,
    execute(ctx, instr) {
      const src = instr.operands[1] as Extract<Operand, { kind: 'reg' }>;
      const port = portOf(ctx.cpu, instr.operands[0]);
      const value = getReg(ctx.cpu, src.reg);
      ctx.bus.write(port, value, src.size);
      ctx.io = { dir: 'out', port, value };
      ctx.effects.push(`port ${fmt(port, 8)} ← ${fmt(value, src.size)}`);
    },
  },
  // ── Arithmetic
  arith('ADD', 'Arithmetic', 'Add the source to the destination.', 'CF, ZF, SF, OF, PF, AF', addWithFlags),
  arith('SUB', 'Arithmetic', 'Subtract the source from the destination.', 'CF, ZF, SF, OF, PF, AF', subWithFlags),
  arith('CMP', 'Arithmetic', 'Compare: compute destination − source, set flags, discard the result.', 'CF, ZF, SF, OF, PF, AF', subWithFlags, false),
  {
    mnemonic: 'INC',
    group: 'Arithmetic',
    syntax: ['INC reg', 'INC BYTE/WORD PTR mem'],
    summary: 'Increment a register by one. CF is not affected.',
    flags: 'ZF, SF, OF, PF, AF (CF unchanged)',
    validate: (ops) => validateSingleReg('INC', ops, false, true),
    execute(ctx, instr) {
      const size = opSize(instr);
      const cf = ctx.cpu.flags.CF;
      const r = addWithFlags(ctx.cpu.flags, read(ctx.cpu, instr.operands[0], size), 1, size);
      ctx.cpu.flags.CF = cf;
      writeDst(ctx, instr, r);
    },
  },
  {
    mnemonic: 'DEC',
    group: 'Arithmetic',
    syntax: ['DEC reg', 'DEC BYTE/WORD PTR mem'],
    summary: 'Decrement a register by one. CF is not affected.',
    flags: 'ZF, SF, OF, PF, AF (CF unchanged)',
    validate: (ops) => validateSingleReg('DEC', ops, false, true),
    execute(ctx, instr) {
      const size = opSize(instr);
      const cf = ctx.cpu.flags.CF;
      const r = subWithFlags(ctx.cpu.flags, read(ctx.cpu, instr.operands[0], size), 1, size);
      ctx.cpu.flags.CF = cf;
      writeDst(ctx, instr, r);
    },
  },
  // ── Logic
  arith('AND', 'Logic', 'Bitwise AND. Useful for isolating sensor bits.', 'CF=0, OF=0, ZF, SF, PF', logic((a, b) => a & b)),
  arith('OR', 'Logic', 'Bitwise OR. Useful for switching output bits on.', 'CF=0, OF=0, ZF, SF, PF', logic((a, b) => a | b)),
  arith('XOR', 'Logic', 'Bitwise exclusive OR. XOR reg, reg clears a register.', 'CF=0, OF=0, ZF, SF, PF', logic((a, b) => a ^ b)),
  arith('TEST', 'Logic', 'Bitwise AND that only sets flags (result discarded). Ideal for testing sensor bits.', 'CF=0, OF=0, ZF, SF, PF', logic((a, b) => a & b), false),
  {
    mnemonic: 'NOT',
    group: 'Logic',
    syntax: ['NOT reg', 'NOT BYTE/WORD PTR mem'],
    summary: "One's complement (invert every bit).",
    flags: 'none',
    validate: (ops) => validateSingleReg('NOT', ops, false, true),
    execute(ctx, instr) {
      const size = opSize(instr);
      writeDst(ctx, instr, ~read(ctx.cpu, instr.operands[0], size) & maskFor(size));
    },
  },
  shiftDef('SHL'),
  shiftDef('SHR'),
  // ── Control transfer
  {
    mnemonic: 'JMP',
    group: 'Control transfer',
    syntax: ['JMP label'],
    summary: 'Unconditional jump.',
    flags: 'none',
    takesLabel: true,
    validate: (ops) => validateLabel('JMP', ops),
    execute(ctx, instr) {
      jump(ctx, instr, true, 'unconditional');
    },
  },
  ...CONDITIONS.flatMap((c) => c.names.map((n) => conditionalJump(n, c))),
  {
    mnemonic: 'JCXZ',
    group: 'Control transfer',
    syntax: ['JCXZ label'],
    summary: 'Jump if CX is zero.',
    flags: 'none',
    takesLabel: true,
    validate: (ops) => validateLabel('JCXZ', ops),
    execute(ctx, instr) {
      jump(ctx, instr, ctx.cpu.regs.CX === 0, `CX=${ctx.cpu.regs.CX}`);
    },
  },
  loopDef('LOOP', 'Decrement CX; jump if CX ≠ 0. The classic 8086 delay/count loop.', () => true),
  loopDef('LOOPE', 'Decrement CX; jump if CX ≠ 0 and ZF=1. Same as LOOPZ.', (f) => f.ZF),
  loopDef('LOOPZ', 'Decrement CX; jump if CX ≠ 0 and ZF=1. Same as LOOPE.', (f) => f.ZF),
  loopDef('LOOPNE', 'Decrement CX; jump if CX ≠ 0 and ZF=0. Same as LOOPNZ.', (f) => !f.ZF),
  loopDef('LOOPNZ', 'Decrement CX; jump if CX ≠ 0 and ZF=0. Same as LOOPNE.', (f) => !f.ZF),
  {
    mnemonic: 'CALL',
    group: 'Control transfer',
    syntax: ['CALL label'],
    summary: 'Push the return address (next IP) and jump to a subroutine.',
    flags: 'none',
    takesLabel: true,
    validate: (ops) => validateLabel('CALL', ops),
    execute(ctx, instr) {
      push(ctx.cpu, instr.index + 1);
      jump(ctx, instr, true, `return ${fmt(instr.index + 1, 16)} pushed`);
    },
  },
  {
    mnemonic: 'RET',
    group: 'Control transfer',
    syntax: ['RET'],
    summary: 'Pop the return address from the stack into IP.',
    flags: 'none',
    validate: (ops) => count(ops, 0, 'RET'),
    execute(ctx) {
      const ip = pop(ctx.cpu);
      ctx.nextIp = ip;
      ctx.effects.push(`IP ← ${fmt(ip, 16)}`);
    },
  },
  // ── Processor control
  {
    mnemonic: 'NOP',
    group: 'Processor control',
    syntax: ['NOP'],
    summary: 'No operation (consumes one machine tick).',
    flags: 'none',
    validate: (ops) => count(ops, 0, 'NOP'),
    execute() {},
  },
  {
    mnemonic: 'HLT',
    group: 'Processor control',
    syntax: ['HLT'],
    summary: 'Halt the processor. The railway world keeps running, but no further instructions execute.',
    flags: 'none',
    validate: (ops) => count(ops, 0, 'HLT'),
    execute(ctx) {
      ctx.cpu.halted = true;
      ctx.effects.push('CPU halted');
    },
  },
  {
    mnemonic: 'STC',
    group: 'Processor control',
    syntax: ['STC'],
    summary: 'Set the carry flag.',
    flags: 'CF=1',
    validate: (ops) => count(ops, 0, 'STC'),
    execute(ctx) {
      ctx.cpu.flags.CF = true;
    },
  },
  {
    mnemonic: 'CLC',
    group: 'Processor control',
    syntax: ['CLC'],
    summary: 'Clear the carry flag.',
    flags: 'CF=0',
    validate: (ops) => count(ops, 0, 'CLC'),
    execute(ctx) {
      ctx.cpu.flags.CF = false;
    },
  },
];

export const INSTRUCTIONS: ReadonlyMap<string, InstructionDef> = new Map(defs.map((d) => [d.mnemonic, d]));

/**
 * Real 8086 mnemonics that this simulator recognises but does not implement.
 * Used only to give a precise error instead of "unknown instruction".
 */
export const KNOWN_UNSUPPORTED = new Set([
  'AAA', 'AAD', 'AAM', 'AAS', 'ADC', 'CBW', 'CLD', 'CLI', 'CMC', 'CMPSB', 'CMPSW', 'CWD', 'DAA', 'DAS', 'DIV',
  'ESC', 'IDIV', 'IMUL', 'INT', 'INTO', 'IRET', 'LAHF', 'LDS', 'LES', 'LOCK', 'LODSB', 'LODSW', 'MOVSB',
  'MOVSW', 'MUL', 'NEG', 'POPF', 'PUSHF', 'RCL', 'RCR', 'REP', 'REPE', 'REPNE', 'REPNZ', 'REPZ', 'RETF', 'ROL',
  'ROR', 'SAHF', 'SAL', 'SAR', 'SBB', 'SCASB', 'SCASW', 'STD', 'STI', 'STOSB', 'STOSW', 'WAIT', 'XLAT',
]);
