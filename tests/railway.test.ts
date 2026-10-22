import { describe, expect, it } from 'vitest';
import { assemble, type Program } from '../src/engine';
import { CTRL, decodeControl, encodeSensors, SENSE } from '../src/hardware/ports';
import { SAMPLES } from '../src/programs/samples';
import { getScenario, type Scenario } from '../src/sim/scenarios';
import { Simulation } from '../src/sim/simulation';
import { createWorld, GATE_TRAVEL_MS, readSensorPort, stepWorld } from '../src/sim/world';

function prog(src: string): Program {
  const r = assemble(src);
  if (!r.program) throw new Error(r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n'));
  return r.program;
}

const sample = (id: string) => prog(SAMPLES.find((s) => s.id === id)!.source);

function runToEnd(program: Program, scenarioId: string) {
  const sim = new Simulation(program, getScenario(scenarioId));
  const r = sim.runFor(1_000_000);
  expect(r.reason).toBe('done');
  return sim;
}

describe('port bit mapping', () => {
  it('decodes the control port', () => {
    expect(decodeControl(0x05)).toEqual({ lights: true, buzzer: false, gateDown: true, fault: false });
    expect(decodeControl(CTRL.BUZZER | CTRL.FAULT)).toEqual({ lights: false, buzzer: true, gateDown: false, fault: true });
  });

  it('encodes the sensor port', () => {
    expect(
      encodeSensors({ apprW: true, apprE: false, occupied: true, clearW: false, clearE: true, gateDown: true, gateUp: false }),
    ).toBe(SENSE.APPR_W | SENSE.OCCUPIED | SENSE.CLEAR_E | SENSE.GATE_DOWN);
  });
});

describe('world model', () => {
  const scenario = getScenario('eastbound');

  it('starts with barriers up and no train detected', () => {
    expect(readSensorPort(createWorld(scenario), scenario)).toBe(SENSE.GATE_UP);
  });

  it('moves the barrier only while commanded and reports limit switches', () => {
    const w = createWorld(scenario);
    for (let t = 0; t < GATE_TRAVEL_MS / 2; t++) stepWorld(w, scenario, CTRL.GATE, 1);
    expect(readSensorPort(w, scenario) & (SENSE.GATE_DOWN | SENSE.GATE_UP)).toBe(0);
    for (let t = 0; t < GATE_TRAVEL_MS; t++) stepWorld(w, scenario, CTRL.GATE, 1);
    expect(readSensorPort(w, scenario) & SENSE.GATE_DOWN).toBeTruthy();
    for (let t = 0; t < GATE_TRAVEL_MS; t++) stepWorld(w, scenario, 0, 1);
    expect(readSensorPort(w, scenario) & SENSE.GATE_UP).toBeTruthy();
  });

  it('drives the detectors in order for an eastbound train', () => {
    const w = createWorld(scenario);
    const seen: number[] = [];
    let last = -1;
    while (!w.done) {
      stepWorld(w, scenario, CTRL.GATE | CTRL.LIGHTS, 1);
      const v = readSensorPort(w, scenario) & 0x1f;
      if (v !== last) seen.push(v);
      last = v;
    }
    const W = SENSE.APPR_W, I = SENSE.OCCUPIED, E = SENSE.CLEAR_E;
    expect(seen).toEqual([0, W, W | I, W | I | E, I | E, E, 0]);
  });

  it('applies stuck-at sensor faults', () => {
    const s = getScenario('fault-dead-approach');
    const w = createWorld(s);
    let sawIsland = false;
    while (!w.done) {
      stepWorld(w, s, 0, 1);
      const v = readSensorPort(w, s);
      expect(v & SENSE.APPR_E).toBe(0);
      if (v & SENSE.OCCUPIED) sawIsland = true;
    }
    expect(sawIsland).toBe(true);
  });

  it('jams the barrier in the gate-jam scenario', () => {
    const s = getScenario('fault-gate-jam');
    const w = createWorld(s);
    for (let t = 0; t < 5000; t++) stepWorld(w, s, CTRL.GATE, 1);
    expect(w.gatePos).toBe(0);
  });

  it('stops road vehicles at the stop line while the warning is active', () => {
    const w = createWorld(scenario);
    for (let t = 0; t < 10000; t++) stepWorld(w, scenario, CTRL.LIGHTS, 1);
    expect(w.vehicles.length).toBeGreaterThan(0);
    for (const v of w.vehicles) {
      if (v.lane === 'S') expect(v.front).toBeLessThanOrEqual(-78);
      else expect(v.front).toBeGreaterThanOrEqual(78);
    }
    expect(w.stats.maxVehicleWaitMs).toBeGreaterThan(1000);
  });
});

describe('CPU ↔ virtual hardware integration', () => {
  it('OUT updates the virtual hardware and IN reads live sensors', () => {
    const sim = new Simulation(prog('MOV AL, 01h\nOUT 02h, AL\nIN AL, 03h\nHLT'), getScenario('eastbound'));
    sim.runFor(2);
    expect(sim.control).toBe(0x01);
    expect(sim.world.lightsOnSince).not.toBeNull();
    sim.runFor(1);
    expect(sim.cpu.regs.AX & 0xff).toBe(SENSE.GATE_UP); // no train yet, barriers up
  });

  it('logs writes to unmapped ports instead of ignoring them silently', () => {
    const sim = new Simulation(prog('MOV AL, 1\nOUT 7, AL\nHLT'), getScenario('eastbound'));
    sim.runFor(3);
    expect(sim.eventLog.some((e) => e.kind === 'bus' && /unmapped port 07h/.test(e.message))).toBe(true);
  });

  it.each(['eastbound', 'westbound', 'following', 'opposing'])('basic controller is safe in "%s"', (id) => {
    const sim = runToEnd(sample('basic'), id);
    expect(sim.world.stats.violations).toBe(0);
    expect(sim.world.stats.trainsCleared).toBe(getScenario(id).trains.length);
    expect(sim.world.stats.minWarningMs).toBeGreaterThan(5000);
    expect(sim.world.gatePos).toBe(0); // raised again at the end
  });

  it('supervised controller is safe in normal scenarios', () => {
    for (const id of ['eastbound', 'westbound', 'following', 'opposing']) {
      const sim = runToEnd(sample('supervised'), id);
      expect(sim.world.stats.violations, id).toBe(0);
      expect(sim.control & CTRL.FAULT, id).toBe(0);
    }
  });

  it('supervised controller latches the FAULT lamp in fault scenarios', () => {
    for (const id of ['fault-gate-jam', 'fault-dead-approach', 'fault-stuck-approach']) {
      const sim = runToEnd(sample('supervised'), id);
      expect(sim.control & CTRL.FAULT, id).toBe(CTRL.FAULT);
    }
  });

  it('naive controller lets a train reach the crossing with the barriers up', () => {
    const sim = runToEnd(sample('naive'), 'eastbound');
    expect(sim.world.stats.violations).toBeGreaterThan(0);
  });

  it('changing the assembly code changes the simulation', () => {
    const a = runToEnd(sample('basic'), 'eastbound');
    const b = runToEnd(prog(SAMPLES[0].source.replace('MOV  CX, 3000', 'MOV  CX, 9000')), 'eastbound');
    expect(a.world.stats.violations).toBe(0);
    expect(b.world.stats.violations).toBeGreaterThan(0); // 9 s pre-warning is too long
    expect(b.eventLog.some((e) => /UNSAFE/.test(e.message))).toBe(true);
    expect(a.eventLog.some((e) => /UNSAFE/.test(e.message))).toBe(false);
  });

  it('self-test program halts after cycling the barrier', () => {
    const sim = new Simulation(sample('selftest'), getScenario('eastbound'));
    sim.runFor(20_000);
    expect(sim.cpu.halted).toBe(true);
    expect(sim.cpu.fault).toBeNull();
    expect(sim.control).toBe(0);
  });
});

describe('deterministic replay', () => {
  const scenario: Scenario = getScenario('following');

  it('two runs of the same program produce identical state', () => {
    const a = new Simulation(sample('supervised'), scenario);
    const b = new Simulation(sample('supervised'), scenario);
    a.runFor(25_000);
    b.runFor(25_000);
    expect(b.cpu).toEqual(a.cpu);
    expect(b.world).toEqual(a.world);
  });

  it('step back and seek reproduce the exact state of a fresh run', () => {
    const fresh = new Simulation(sample('basic'), scenario);
    fresh.runFor(12_345);

    const sim = new Simulation(sample('basic'), scenario);
    sim.runFor(12_346);
    sim.stepBack();
    expect(sim.tick).toBe(12_345);
    expect(sim.cpu).toEqual(fresh.cpu);
    expect(sim.world).toEqual(fresh.world);
    expect(sim.control).toBe(fresh.control);

    sim.seek(3_000);
    sim.seek(12_345);
    expect(sim.world).toEqual(fresh.world);
  });

  it('reset returns to tick 0', () => {
    const sim = new Simulation(sample('basic'), scenario);
    sim.runFor(5000);
    sim.reset();
    expect(sim.tick).toBe(0);
    expect(sim.cpu.ip).toBe(0);
    expect(sim.world.timeMs).toBe(0);
    expect(sim.execLog).toHaveLength(0);
  });

  it('stops at breakpoints', () => {
    const p = sample('basic');
    const sim = new Simulation(p, scenario);
    const line = p.instructions.find((i) => i.text.startsWith('MOV  AL, 00000111b') || i.text.startsWith('MOV AL, 00000111b'))!.line;
    const r = sim.runFor(100_000, new Set([line]));
    expect(r.reason).toBe('breakpoint');
    expect(sim.currentLine).toBe(line);
  });
});
