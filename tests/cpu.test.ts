import { describe, expect, it } from 'vitest';
import { assemble, createCpu, getReg, run, step, type CpuState, type IoBus, type Program } from '../src/engine';

function prog(src: string): Program {
  const r = assemble(src);
  if (!r.program) throw new Error(r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n'));
  return r.program;
}

class FakeBus implements IoBus {
  inputs = new Map<number, number>();
  writes: Array<[number, number]> = [];
  read(port: number) {
    return this.inputs.get(port) ?? 0;
  }
  write(port: number, value: number) {
    this.writes.push([port, value]);
  }
}

function exec(src: string, bus: IoBus = new FakeBus(), budget = 10_000): CpuState {
  const p = prog(src + '\nHLT');
  const cpu = createCpu(p);
  run(cpu, p, bus, budget);
  return cpu;
}

describe('data movement and register aliasing', () => {
  it('MOV writes 8-bit halves into the 16-bit register', () => {
    const cpu = exec('MOV AX, 1234h\nMOV AL, 0FFh\nMOV BH, 12h\nMOV CX, AX');
    expect(cpu.regs.AX).toBe(0x12ff);
    expect(cpu.regs.BX).toBe(0x1200);
    expect(cpu.regs.CX).toBe(0x12ff);
    expect(getReg(cpu, 'AH')).toBe(0x12);
  });

  it('MOV does not change flags', () => {
    const cpu = exec('CMP AL, 0\nMOV AL, 5');
    expect(cpu.flags.ZF).toBe(true);
  });

  it('XCHG swaps registers', () => {
    const cpu = exec('MOV AL, 1\nMOV BL, 2\nXCHG AL, BL');
    expect([getReg(cpu, 'AL'), getReg(cpu, 'BL')]).toEqual([2, 1]);
  });
});

describe('arithmetic flags', () => {
  it('ADD sets CF on unsigned overflow and ZF on zero', () => {
    const cpu = exec('MOV AL, 0FFh\nADD AL, 1');
    expect(getReg(cpu, 'AL')).toBe(0);
    expect(cpu.flags).toMatchObject({ CF: true, ZF: true, SF: false, OF: false });
  });

  it('ADD sets OF on signed overflow', () => {
    const cpu = exec('MOV AL, 7Fh\nADD AL, 1');
    expect(cpu.flags).toMatchObject({ OF: true, SF: true, CF: false });
  });

  it('SUB/CMP borrow sets CF and SF', () => {
    const cpu = exec('MOV AL, 1\nCMP AL, 2');
    expect(getReg(cpu, 'AL')).toBe(1); // CMP discards the result
    expect(cpu.flags).toMatchObject({ CF: true, ZF: false, SF: true });
  });

  it('CMP of equal values sets ZF', () => {
    expect(exec('MOV BX, 500\nCMP BX, 500').flags.ZF).toBe(true);
  });

  it('INC and DEC preserve CF', () => {
    const cpu = exec('STC\nMOV AL, 0FFh\nINC AL');
    expect(getReg(cpu, 'AL')).toBe(0);
    expect(cpu.flags).toMatchObject({ CF: true, ZF: true });
    const cpu2 = exec('CLC\nMOV AL, 0\nDEC AL');
    expect(getReg(cpu2, 'AL')).toBe(0xff);
    expect(cpu2.flags).toMatchObject({ CF: false, SF: true });
  });

  it('PF reflects even parity of the low byte', () => {
    expect(exec('MOV AL, 3\nOR AL, 0').flags.PF).toBe(true);
    expect(exec('MOV AL, 7\nOR AL, 0').flags.PF).toBe(false);
  });
});

describe('logic', () => {
  it('AND/OR/XOR/NOT compute results and clear CF/OF', () => {
    const cpu = exec('STC\nMOV AL, 0F0h\nAND AL, 3Ch\nMOV BL, 1\nOR BL, 80h\nMOV CL, 0AAh\nXOR CL, 0FFh\nMOV DL, 0Fh\nNOT DL');
    expect(getReg(cpu, 'AL')).toBe(0x30);
    expect(getReg(cpu, 'BL')).toBe(0x81);
    expect(getReg(cpu, 'CL')).toBe(0x55);
    expect(getReg(cpu, 'DL')).toBe(0xf0);
    expect(cpu.flags.CF).toBe(false);
  });

  it('TEST sets ZF without modifying the register', () => {
    const cpu = exec('MOV AL, 05h\nTEST AL, 02h');
    expect(getReg(cpu, 'AL')).toBe(5);
    expect(cpu.flags.ZF).toBe(true);
  });

  it('XOR reg,reg clears the register', () => {
    expect(exec('MOV BX, 1234h\nXOR BX, BX').regs.BX).toBe(0);
  });

  it('SHL/SHR shift and set CF from the last bit out', () => {
    const cpu = exec('MOV AL, 81h\nSHL AL, 1');
    expect(getReg(cpu, 'AL')).toBe(0x02);
    expect(cpu.flags.CF).toBe(true);
    const cpu2 = exec('MOV AL, 40h\nMOV CL, 6\nSHR AL, CL');
    expect(getReg(cpu2, 'AL')).toBe(1);
    expect(cpu2.flags.CF).toBe(false);
  });
});

describe('branching', () => {
  it('JMP skips instructions', () => {
    expect(getReg(exec('MOV AL, 1\nJMP L\nMOV AL, 2\nL: NOP'), 'AL')).toBe(1);
  });

  it.each([
    ['JE', 5, 5, true],
    ['JE', 5, 6, false],
    ['JNE', 5, 6, true],
    ['JB', 1, 2, true],
    ['JB', 0xff, 1, false], // unsigned 255 > 1
    ['JA', 0xff, 1, true],
    ['JL', 0xff, 1, true], // signed −1 < 1
    ['JG', 0xff, 1, false],
    ['JGE', 3, 3, true],
    ['JLE', 2, 3, true],
    ['JBE', 3, 3, true],
    ['JAE', 3, 4, false],
  ])('%s with %i vs %i → taken=%s', (jcc, a, b, taken) => {
    const cpu = exec(`MOV BL, 0\nMOV AL, ${a}\nCMP AL, ${b}\n${jcc} T\nJMP E\nT: MOV BL, 1\nE: NOP`);
    expect(getReg(cpu, 'BL')).toBe(taken ? 1 : 0);
  });

  it('LOOP decrements CX and runs the body CX times', () => {
    const cpu = exec('MOV CX, 5\nMOV AL, 0\nL: INC AL\nLOOP L');
    expect(getReg(cpu, 'AL')).toBe(5);
    expect(cpu.regs.CX).toBe(0);
  });

  it('LOOP with CX=0 wraps to FFFFh and iterates 65536 times', () => {
    const cpu = exec('MOV CX, 0\nMOV BX, 0\nL: INC BX\nLOOP L', undefined, 200_000);
    expect(cpu.regs.BX).toBe(0); // 65536 increments wrap to 0
    expect(cpu.halted).toBe(true);
  });

  it('JCXZ and LOOPNZ', () => {
    expect(getReg(exec('MOV CX, 0\nMOV AL, 0\nJCXZ Z\nMOV AL, 1\nZ: NOP'), 'AL')).toBe(0);
    // LOOPNZ exits early when ZF becomes 1
    const cpu = exec('MOV CX, 10\nMOV AL, 3\nL: DEC AL\nLOOPNZ L');
    expect(getReg(cpu, 'AL')).toBe(0);
    expect(cpu.regs.CX).toBe(7);
  });

  it('CALL/RET use the stack', () => {
    const cpu = exec('MOV AL, 1\nCALL SUB1\nMOV BL, AL\nJMP END\nSUB1: ADD AL, 10\nRET\nEND: NOP');
    expect(getReg(cpu, 'BL')).toBe(11);
    expect(cpu.regs.SP).toBe(0xfffe);
  });

  it('PUSH/POP round-trip', () => {
    const cpu = exec('MOV AX, 0BEEFh\nPUSH AX\nMOV AX, 0\nPOP BX');
    expect(cpu.regs.BX).toBe(0xbeef);
  });
});

describe('memory operands', () => {
  it('reads and writes bytes and words in DB/DW data', () => {
    const cpu = exec('ARR DB 5, 7, 9\nW DW 0102h\nMOV SI, 2\nMOV AL, ARR[SI]\nMOV BX, OFFSET ARR\nMOV BYTE PTR [BX+1], 42\nMOV CX, W\nADD W, 1');
    expect(getReg(cpu, 'AL')).toBe(9);
    expect(cpu.memory[0x101]).toBe(42);
    expect(cpu.regs.CX).toBe(0x0102);
    expect(cpu.memory[0x103] | (cpu.memory[0x104] << 8)).toBe(0x0103);
  });

  it('sums an array with a LOOP', () => {
    const cpu = exec('NUMS DB 10, 20, 30, 40\nMOV CX, 4\nLEA SI, NUMS\nXOR AX, AX\nL: ADD AL, [SI]\nINC SI\nLOOP L');
    expect(getReg(cpu, 'AL')).toBe(100);
  });

  it('INC/DEC/NOT/CMP/XCHG work on memory', () => {
    const cpu = exec('V DB 0FFh\nINC V\nMOV AL, V\nNOT BYTE PTR V\nCMP V, 0FFh\nMOV BL, 3\nXCHG BL, V');
    expect(getReg(cpu, 'AL')).toBe(0);
    expect(cpu.flags.ZF).toBe(true);
    expect(getReg(cpu, 'BL')).toBe(0xff);
    expect(cpu.memory[0x100]).toBe(3);
  });
});

describe('I/O instructions', () => {
  it('IN reads the bus and OUT writes to it', () => {
    const bus = new FakeBus();
    bus.inputs.set(3, 0x21);
    exec('IN AL, 03h\nOR AL, 80h\nOUT 02h, AL', bus);
    expect(bus.writes).toEqual([[2, 0xa1]]);
  });

  it('supports DX as the port address', () => {
    const bus = new FakeBus();
    bus.inputs.set(0x3f, 7);
    const cpu = exec('MOV DX, 3Fh\nIN AL, DX\nMOV DX, 2\nOUT DX, AL', bus);
    expect(getReg(cpu, 'AL')).toBe(7);
    expect(bus.writes).toEqual([[2, 7]]);
  });

  it('records the I/O transfer in the step trace', () => {
    const bus = new FakeBus();
    bus.inputs.set(3, 5);
    const trace = step(createCpu(), prog('IN AL, 3'), bus);
    expect(trace?.io).toEqual({ dir: 'in', port: 3, value: 5 });
  });
});

describe('runtime safety', () => {
  it('interrupts an infinite loop with the execution budget', () => {
    const cpu = createCpu();
    const result = run(cpu, prog('L: JMP L'), new FakeBus(), 1000);
    expect(result).toEqual({ outcome: 'budget', executed: 1000 });
  });

  it('faults when execution runs past the end of the program', () => {
    const cpu = createCpu();
    const result = run(cpu, prog('NOP'), new FakeBus(), 100);
    expect(result.outcome).toBe('fault');
    expect(cpu.fault).toMatch(/ran past the last instruction/);
  });

  it('faults on RET with an empty stack', () => {
    const cpu = createCpu();
    run(cpu, prog('RET'), new FakeBus(), 10);
    expect(cpu.fault).toMatch(/Stack underflow/);
  });

  it('HLT stops execution', () => {
    const cpu = createCpu();
    expect(run(cpu, prog('NOP\nHLT\nNOP'), new FakeBus(), 100)).toEqual({ outcome: 'halted', executed: 2 });
    expect(cpu.ip).toBe(2);
  });
});
