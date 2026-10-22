/**
 * Virtual I/O map of the RailLogic level-crossing controller board.
 *
 *   Port 02h  OUT  control latch   (lights, buzzer, gate motor, fault lamp)
 *   Port 03h  IN   sensor inputs   (train detectors, gate limit switches)
 *
 * All bits are active-high. Reading port 02h returns the current latch value;
 * writing port 03h, or accessing any other port, is a bus error that is
 * reported in the log (reads return FFh like an undriven ISA bus).
 */

export const CONTROL_PORT = 0x02;
export const SENSOR_PORT = 0x03;

export interface BitDef {
  bit: number;
  key: string;
  label: string;
  description: string;
}

export const CONTROL_BITS: BitDef[] = [
  { bit: 0, key: 'LIGHTS', label: 'LIGHTS', description: 'Road warning lamps. The flasher unit alternates the left/right lamps at 1 Hz while this bit is set.' },
  { bit: 1, key: 'BUZZER', label: 'BUZZER', description: 'Audible warning buzzer.' },
  { bit: 2, key: 'GATE', label: 'GATE ↓', description: 'Boom motor command: 1 = lower the barriers, 0 = raise them. Travel takes about 3 s.' },
  { bit: 3, key: 'FAULT', label: 'FAULT', description: 'Maintenance fault lamp in the control cabinet.' },
  { bit: 4, key: 'R4', label: '—', description: 'Reserved (ignored).' },
  { bit: 5, key: 'R5', label: '—', description: 'Reserved (ignored).' },
  { bit: 6, key: 'R6', label: '—', description: 'Reserved (ignored).' },
  { bit: 7, key: 'R7', label: '—', description: 'Reserved (ignored).' },
];

export const SENSOR_BITS: BitDef[] = [
  { bit: 0, key: 'APPR_W', label: 'APPR W', description: 'West approach: an eastbound train is on the west approach section, heading towards the crossing.' },
  { bit: 1, key: 'APPR_E', label: 'APPR E', description: 'East approach: a westbound train is on the east approach section, heading towards the crossing.' },
  { bit: 2, key: 'OCCUPIED', label: 'ISLAND', description: 'Crossing island occupied: part of a train is on the road crossing.' },
  { bit: 3, key: 'CLEAR_W', label: 'CLR W', description: 'West train-clear detector: 1 while a departing westbound train is still inside the clear-out zone west of the crossing; falls to 0 the moment it is clear.' },
  { bit: 4, key: 'CLEAR_E', label: 'CLR E', description: 'East train-clear detector: 1 while a departing eastbound train is still inside the clear-out zone east of the crossing; falls to 0 the moment it is clear.' },
  { bit: 5, key: 'GATE_DOWN', label: 'GATE DN', description: 'Limit switch: both barriers are fully lowered.' },
  { bit: 6, key: 'GATE_UP', label: 'GATE UP', description: 'Limit switch: both barriers are fully raised.' },
  { bit: 7, key: 'R7', label: '—', description: 'Reserved (always 0).' },
];

export const CTRL = { LIGHTS: 0x01, BUZZER: 0x02, GATE: 0x04, FAULT: 0x08 } as const;
export const SENSE = {
  APPR_W: 0x01,
  APPR_E: 0x02,
  OCCUPIED: 0x04,
  CLEAR_W: 0x08,
  CLEAR_E: 0x10,
  GATE_DOWN: 0x20,
  GATE_UP: 0x40,
} as const;

/** Any train detector (approach, island, clear). */
export const TRAIN_DETECT_MASK = SENSE.APPR_W | SENSE.APPR_E | SENSE.OCCUPIED | SENSE.CLEAR_W | SENSE.CLEAR_E;

export interface ControlOutputs {
  lights: boolean;
  buzzer: boolean;
  gateDown: boolean;
  fault: boolean;
}

export function decodeControl(value: number): ControlOutputs {
  return {
    lights: (value & CTRL.LIGHTS) !== 0,
    buzzer: (value & CTRL.BUZZER) !== 0,
    gateDown: (value & CTRL.GATE) !== 0,
    fault: (value & CTRL.FAULT) !== 0,
  };
}

export interface SensorInputs {
  apprW: boolean;
  apprE: boolean;
  occupied: boolean;
  clearW: boolean;
  clearE: boolean;
  gateDown: boolean;
  gateUp: boolean;
}

export function encodeSensors(s: SensorInputs): number {
  return (
    (s.apprW ? SENSE.APPR_W : 0) |
    (s.apprE ? SENSE.APPR_E : 0) |
    (s.occupied ? SENSE.OCCUPIED : 0) |
    (s.clearW ? SENSE.CLEAR_W : 0) |
    (s.clearE ? SENSE.CLEAR_E : 0) |
    (s.gateDown ? SENSE.GATE_DOWN : 0) |
    (s.gateUp ? SENSE.GATE_UP : 0)
  );
}
