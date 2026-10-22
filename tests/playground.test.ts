import { describe, expect, it } from 'vitest';
import { assemble, type Program } from '../src/engine';
import { PLAYGROUND_SAMPLES } from '../src/programs/playgroundSamples';
import { PLAY_PORTS, PlaygroundMachine } from '../src/sim/playground';

function prog(src: string): Program {
  const r = assemble(src);
  if (!r.program) throw new Error(r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n'));
  return r.program;
}

const sample = (id: string) => prog(PLAYGROUND_SAMPLES.find((s) => s.id === id)!.source);

function runToHalt(p: Program) {
  const m = new PlaygroundMachine(p);
  const r = m.runFor(100_000);
  expect(r.reason).toBe('done');
  expect(m.cpu.fault).toBeNull();
  return m;
}

describe('8086 Playground machine', () => {
  it('prints characters, decimal and hex through the console ports', () => {
    const m = runToHalt(prog("MOV AL, 'H'\nOUT 10h, AL\nMOV AL, 0Ah\nOUT 10h, AL\nMOV AX, 1234\nOUT 11h, AX\nMOV AL, 0FFh\nOUT 12h, AL\nHLT"));
    expect(m.output).toBe('H\n1234\nFFh\n');
  });

  it('is finished when the CPU halts (no railway world involved)', () => {
    const m = runToHalt(prog('MOV AX, 5\nHLT'));
    expect(m.finished).toBe(true);
    expect('world' in m).toBe(false);
  });

  it('reads switches and latches LEDs and other ports', () => {
    const m = new PlaygroundMachine(prog('IN AL, 30h\nOUT 20h, AL\nMOV AL, 9\nOUT 40h, AL\nIN AL, 40h\nHLT'), 0b1010_0101);
    m.runFor(100);
    expect(m.leds).toBe(0b1010_0101);
    expect(m.cpu.regs.AX & 0xff).toBe(9);
    expect(m.ports[PLAY_PORTS.SWITCHES]).toMatchObject({ dir: 'in', value: 0b1010_0101 });
  });

  it('replays switch changes deterministically on step back and seek', () => {
    const m = new PlaygroundMachine(prog('L: IN AL, 30h\nOUT 20h, AL\nJMP L'));
    m.runFor(30);
    m.setSwitches(0x0f);
    m.runFor(30);
    expect(m.leds).toBe(0x0f);
    m.seek(10);
    expect(m.leds).toBe(0);
    m.seek(60);
    expect(m.leds).toBe(0x0f);
  });

  it.each([
    ['array', 'sum = 305\nmin = 3\nmax = 91\n'],
    ['hello', 'Hello, 8086!\nOne instruction per tick.'],
    ['sum', '55\n0037h\n'],
    ['sort', '3\n11\n12\n22\n25\n47\n64\n90\n'],
    ['fib', '0\n1\n1\n2\n3\n5\n8\n13\n21\n34\n55\n89\n'],
  ])('sample "%s" produces the expected output', (id, expected) => {
    expect(runToHalt(sample(id)).output).toBe(expected);
  });

  it('the array sample stores its sum in memory', () => {
    const m = runToHalt(sample('array'));
    const sum = m.program.variables.find((v) => v.name === 'SUM')!;
    expect(m.cpu.memory[sum.address] | (m.cpu.memory[sum.address + 1] << 8)).toBe(305);
  });

  it('the LED sample never halts and is stopped by the budget', () => {
    const m = new PlaygroundMachine(sample('leds'));
    expect(m.runFor(50_000).reason).toBe('budget');
    expect(m.leds).not.toBe(0);
  });
});
