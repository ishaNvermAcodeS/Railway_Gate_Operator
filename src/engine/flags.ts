import type { Flags } from './types';

export function emptyFlags(): Flags {
  return { CF: false, PF: false, AF: false, ZF: false, SF: false, OF: false };
}

function mask(size: 8 | 16): number {
  return size === 8 ? 0xff : 0xffff;
}

function signBit(size: 8 | 16): number {
  return size === 8 ? 0x80 : 0x8000;
}

/** PF reflects even parity of the low byte only (as on a real 8086). */
function parity(value: number): boolean {
  let v = value & 0xff;
  let bits = 0;
  while (v) {
    bits += v & 1;
    v >>= 1;
  }
  return bits % 2 === 0;
}

/** Sets ZF, SF and PF from a result. */
export function setResultFlags(flags: Flags, result: number, size: 8 | 16): void {
  const r = result & mask(size);
  flags.ZF = r === 0;
  flags.SF = (r & signBit(size)) !== 0;
  flags.PF = parity(r);
}

/** ADD: returns the truncated result and updates all six arithmetic flags. */
export function addWithFlags(flags: Flags, a: number, b: number, size: 8 | 16): number {
  const m = mask(size);
  const raw = (a & m) + (b & m);
  const r = raw & m;
  flags.CF = raw > m;
  flags.AF = ((a ^ b ^ r) & 0x10) !== 0;
  flags.OF = ((~(a ^ b) & (a ^ r)) & signBit(size)) !== 0;
  setResultFlags(flags, r, size);
  return r;
}

/** SUB / CMP: returns a − b truncated and updates all six arithmetic flags. */
export function subWithFlags(flags: Flags, a: number, b: number, size: 8 | 16): number {
  const m = mask(size);
  const av = a & m;
  const bv = b & m;
  const r = (av - bv) & m;
  flags.CF = av < bv;
  flags.AF = ((av ^ bv ^ r) & 0x10) !== 0;
  flags.OF = (((av ^ bv) & (av ^ r)) & signBit(size)) !== 0;
  setResultFlags(flags, r, size);
  return r;
}

/** AND / OR / XOR / TEST: CF and OF are cleared, ZF/SF/PF from the result. */
export function logicFlags(flags: Flags, result: number, size: 8 | 16): void {
  flags.CF = false;
  flags.OF = false;
  flags.AF = false;
  setResultFlags(flags, result, size);
}

export function maskFor(size: 8 | 16): number {
  return mask(size);
}

export function signBitFor(size: 8 | 16): number {
  return signBit(size);
}
