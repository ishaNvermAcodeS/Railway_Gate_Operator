/**
 * Deterministic physical model of the level crossing.
 *
 * The world knows nothing about the CPU: it is advanced in fixed time steps
 * with the current control-port outputs, and it exposes the sensor byte that
 * the CPU reads on port 03h. All state is plain data so it can be cloned for
 * checkpoints and replay.
 *
 * Coordinates
 *   Track axis x (world units, ≈ metres): crossing centre at 0, west < 0 < east.
 *   Road axis y (world units): track centre at 0, north < 0 < south.
 */
import { decodeControl, encodeSensors, SENSE, type SensorInputs } from '../hardware/ports';
import type { Scenario } from './scenarios';

export const GEOMETRY = {
  /** Half-width of the crossing island (train detection over the road). */
  island: 50,
  /** Distance from the crossing centre to the approach strike-in point. */
  strike: 800,
  /** Distance from the crossing centre to the end of the clear-out zone. */
  clearOut: 250,
  /** Trains appear / disappear here. */
  spawn: 1150,
  despawn: 1300,
  /** Road: vehicles appear/disappear at ±roadEnd, stop lines at ±stopLine. */
  roadEnd: 330,
  stopLine: 78,
  /** Half-extent of the area vehicles must not occupy while a train is on the island. */
  crossingZone: 48,
  /** Track centre-lines (y) — westbound runs on the north track. */
  trackY: { eastbound: 26, westbound: -26 },
} as const;

/** Gate travel time between fully up and fully down. */
export const GATE_TRAVEL_MS = 3000;
/** Hardware flasher half-period for the warning lamps. */
export const FLASH_HALF_PERIOD_MS = 500;

const VEHICLE_LENGTH = 30;
const VEHICLE_GAP = 12;
const VEHICLE_SPEED = 0.085;
const VEHICLE_COLORS = ['#7a8fa6', '#c4a46b', '#8f6f9e', '#5f9c8a', '#b9785e', '#6f7f99', '#a3a3a3'];

export interface Train {
  id: number;
  name: string;
  dir: 1 | -1;
  /** x of the front of the train. */
  head: number;
  length: number;
  speed: number;
  /** Time at which the head first reached the island (ms) or null. */
  reachedIslandAt: number | null;
  /** Warning time this train got (ms) — lights-on to island entry. */
  warningMs: number | null;
  violation: boolean;
  cleared: boolean;
}

export interface Vehicle {
  id: number;
  /** 'S' = southbound (y increasing), 'N' = northbound (y decreasing). */
  lane: 'S' | 'N';
  /** y of the front bumper. */
  front: number;
  speed: number;
  color: string;
  waitingSince: number | null;
  flagged: boolean;
}

export type WorldEventKind = 'info' | 'train' | 'gate' | 'warning' | 'violation';

export interface WorldEvent {
  timeMs: number;
  kind: WorldEventKind;
  message: string;
}

export interface WorldState {
  timeMs: number;
  trains: Train[];
  nextTrain: number;
  vehicles: Vehicle[];
  nextVehicleId: number;
  nextSouthSpawn: number;
  nextNorthSpawn: number;
  /** Barrier travel in ms: 0 = fully raised, GATE_TRAVEL_MS = fully lowered (integer, so limit switches are exact). */
  gateMs: number;
  /** 0 = fully raised, 1 = fully lowered (derived from gateMs). */
  gatePos: number;
  lightsOnSince: number | null;
  lastControl: number;
  stats: {
    violations: number;
    trainsCleared: number;
    vehiclesPassed: number;
    maxVehicleWaitMs: number;
    minWarningMs: number | null;
  };
  done: boolean;
}

export function createWorld(scenario: Scenario): WorldState {
  return {
    timeMs: 0,
    trains: [],
    nextTrain: 0,
    vehicles: [],
    nextVehicleId: 1,
    nextSouthSpawn: scenario.traffic.southOffsetMs,
    nextNorthSpawn: scenario.traffic.northOffsetMs,
    gateMs: 0,
    gatePos: 0,
    lightsOnSince: null,
    lastControl: 0,
    stats: { violations: 0, trainsCleared: 0, vehiclesPassed: 0, maxVehicleWaitMs: 0, minWarningMs: null },
    done: false,
  };
}

/** Rear x of a train. */
export function trainTail(t: Train): number {
  return t.head - t.dir * t.length;
}

/** Does any part of the train lie within [a, b]? */
function trainOverlaps(t: Train, a: number, b: number): boolean {
  const lo = Math.min(t.head, trainTail(t));
  const hi = Math.max(t.head, trainTail(t));
  return hi >= a && lo <= b;
}

/** Raw (fault-free) sensor state derived from train positions and the gate. */
export function rawSensors(world: WorldState): SensorInputs {
  const { island, strike, clearOut } = GEOMETRY;
  const eps = 1e-9;
  const s: SensorInputs = { apprW: false, apprE: false, occupied: false, clearW: false, clearE: false, gateDown: false, gateUp: false };
  for (const t of world.trains) {
    if (trainOverlaps(t, -island, island)) s.occupied = true;
    if (t.dir === 1) {
      if (trainOverlaps(t, -strike, -island - eps)) s.apprW = true;
      if (trainOverlaps(t, island + eps, clearOut)) s.clearE = true;
    } else {
      if (trainOverlaps(t, island + eps, strike)) s.apprE = true;
      if (trainOverlaps(t, -clearOut, -island - eps)) s.clearW = true;
    }
  }
  s.gateDown = world.gatePos >= 1;
  s.gateUp = world.gatePos <= 0;
  return s;
}

/** The byte the CPU sees on port 03h, with scenario faults applied. */
export function readSensorPort(world: WorldState, scenario: Scenario): number {
  let value = encodeSensors(rawSensors(world));
  for (const f of scenario.faults) {
    if (f.kind === 'sensor-stuck' && world.timeMs >= f.fromMs) {
      const m = 1 << f.bit;
      value = f.value ? value | m : value & ~m;
    }
  }
  return value & 0xff;
}

export function lampPhase(world: WorldState): 0 | 1 {
  return (Math.floor(world.timeMs / FLASH_HALF_PERIOD_MS) % 2) as 0 | 1;
}

function gateJammed(world: WorldState, scenario: Scenario): boolean {
  return scenario.faults.some((f) => f.kind === 'gate-jam' && world.timeMs >= f.fromMs);
}

function vehicleBody(v: Vehicle): [number, number] {
  return v.lane === 'S' ? [v.front - VEHICLE_LENGTH, v.front] : [v.front, v.front + VEHICLE_LENGTH];
}

function vehicleOnCrossing(v: Vehicle): boolean {
  const [a, b] = vehicleBody(v);
  return b >= -GEOMETRY.crossingZone && a <= GEOMETRY.crossingZone;
}

/**
 * Advances the world by `dtMs` with the given control-port value.
 * Returns the events that occurred during this step.
 */
export function stepWorld(world: WorldState, scenario: Scenario, control: number, dtMs: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  const t0 = world.timeMs;
  const t1 = t0 + dtMs;
  const out = decodeControl(control);
  const emit = (kind: WorldEventKind, message: string) => events.push({ timeMs: t1, kind, message });

  // ── warning lamps (the rising edge starts the warning-time clock)
  if (out.lights && world.lightsOnSince === null) world.lightsOnSince = t1;
  if (!out.lights) world.lightsOnSince = null;
  world.lastControl = control;

  // ── gate motor
  const before = world.gatePos;
  if (!gateJammed(world, scenario)) {
    world.gateMs = out.gateDown ? Math.min(GATE_TRAVEL_MS, world.gateMs + dtMs) : Math.max(0, world.gateMs - dtMs);
    world.gatePos = world.gateMs / GATE_TRAVEL_MS;
  }
  if (before < 1 && world.gatePos >= 1) emit('gate', 'Barriers fully lowered');
  if (before > 0 && world.gatePos <= 0) emit('gate', 'Barriers fully raised');

  // ── trains
  while (world.nextTrain < scenario.trains.length && scenario.trains[world.nextTrain].spawnMs <= t1) {
    const spec = scenario.trains[world.nextTrain];
    world.trains.push({
      id: world.nextTrain + 1,
      name: spec.name,
      dir: spec.dir,
      head: -spec.dir * GEOMETRY.spawn,
      length: spec.length,
      speed: spec.speed,
      reachedIslandAt: null,
      warningMs: null,
      violation: false,
      cleared: false,
    });
    emit('train', `${spec.name} ${spec.dir === 1 ? 'eastbound from the west' : 'westbound from the east'} entered the line`);
    world.nextTrain++;
  }

  for (const t of world.trains) {
    const prevHead = t.head;
    t.head += t.dir * t.speed * dtMs;
    const { strike, island, clearOut } = GEOMETRY;
    const crossed = (edge: number) => (t.dir === 1 ? prevHead < edge && t.head >= edge : prevHead > edge && t.head <= edge);

    if (crossed(-t.dir * strike)) emit('train', `${t.name} passed the ${t.dir === 1 ? 'west' : 'east'} strike-in point`);

    if (t.reachedIslandAt === null && crossed(-t.dir * island)) {
      t.reachedIslandAt = t1;
      t.warningMs = world.lightsOnSince === null ? 0 : t1 - world.lightsOnSince;
      const m = world.stats.minWarningMs;
      world.stats.minWarningMs = m === null ? t.warningMs : Math.min(m, t.warningMs);
      if (world.gatePos < 1 || !out.lights) {
        t.violation = true;
        world.stats.violations++;
        const why = world.gatePos <= 0 ? 'barriers RAISED' : world.gatePos < 1 ? 'barriers not fully lowered' : 'warning lamps off';
        emit('violation', `UNSAFE: ${t.name} entered the crossing with ${why}`);
      } else {
        emit('train', `${t.name} reached the crossing — warning time ${(t.warningMs / 1000).toFixed(1)} s`);
      }
    }

    const tail = trainTail(t);
    const prevTail = prevHead - t.dir * t.length;
    const tailCrossed = t.dir === 1 ? prevTail < clearOut && tail >= clearOut : prevTail > -clearOut && tail <= -clearOut;
    if (!t.cleared && tailCrossed) {
      t.cleared = true;
      world.stats.trainsCleared++;
      emit('train', `${t.name} is clear of the crossing`);
    }
  }
  world.trains = world.trains.filter((t) => Math.abs(trainTail(t)) < GEOMETRY.despawn || Math.sign(trainTail(t)) !== t.dir);

  // ── road traffic
  const { southEveryMs, northEveryMs } = scenario.traffic;
  const spawnVehicle = (lane: 'S' | 'N') => {
    const front = lane === 'S' ? -GEOMETRY.roadEnd : GEOMETRY.roadEnd;
    const blocked = world.vehicles.some((v) => v.lane === lane && Math.abs(v.front - front) < VEHICLE_LENGTH + VEHICLE_GAP + 4);
    if (blocked) return false;
    const id = world.nextVehicleId++;
    world.vehicles.push({ id, lane, front, speed: VEHICLE_SPEED, color: VEHICLE_COLORS[id % VEHICLE_COLORS.length], waitingSince: null, flagged: false });
    return true;
  };
  if (t1 >= world.nextSouthSpawn && spawnVehicle('S')) world.nextSouthSpawn += southEveryMs;
  if (t1 >= world.nextNorthSpawn && spawnVehicle('N')) world.nextNorthSpawn += northEveryMs;

  const roadClosed = out.lights || world.gatePos > 0;
  const trainOnIsland = world.trains.some((t) => trainOverlaps(t, -GEOMETRY.island, GEOMETRY.island));

  for (const lane of ['S', 'N'] as const) {
    const sign = lane === 'S' ? 1 : -1;
    // Process front-most vehicles first so followers can react to leaders.
    const queue = world.vehicles.filter((v) => v.lane === lane).sort((a, b) => sign * (b.front - a.front));
    let limit = Infinity; // furthest the next vehicle's front may go (in lane-forward coordinates)
    for (const v of queue) {
      const pos = sign * v.front; // forward coordinate
      const stopAt = -GEOMETRY.stopLine;
      let maxPos = limit;
      // Stop at the stop line if the road is closed and the vehicle has not committed yet.
      if (roadClosed && pos <= stopAt + 0.5) maxPos = Math.min(maxPos, stopAt);
      const nextPos = Math.min(pos + v.speed * dtMs, maxPos);
      const moved = nextPos > pos + 1e-9;
      v.front = sign * Math.max(pos, nextPos);
      if (!moved) {
        if (v.waitingSince === null) v.waitingSince = t0;
        world.stats.maxVehicleWaitMs = Math.max(world.stats.maxVehicleWaitMs, t1 - v.waitingSince);
      } else {
        v.waitingSince = null;
      }
      limit = sign * v.front - VEHICLE_LENGTH - VEHICLE_GAP;
    }
  }

  for (const v of world.vehicles) {
    if (trainOnIsland && vehicleOnCrossing(v) && !v.flagged) {
      v.flagged = true;
      world.stats.violations++;
      emit('violation', `UNSAFE: road vehicle #${v.id} on the crossing while a train is present`);
    }
  }
  const before2 = world.vehicles.length;
  world.vehicles = world.vehicles.filter((v) => Math.abs(v.front) <= GEOMETRY.roadEnd + VEHICLE_LENGTH + 2 || Math.sign(v.front) !== (v.lane === 'S' ? 1 : -1));
  world.stats.vehiclesPassed += before2 - world.vehicles.length;

  world.timeMs = t1;
  if (!world.done && t1 >= scenario.durationMs) {
    world.done = true;
    emit('info', 'Scenario complete');
  }
  return events;
}

export const VEHICLE_DIMENSIONS = { length: VEHICLE_LENGTH, width: 16 };

/** Convenience for UI/tests. */
export function sensorBitActive(value: number, key: keyof typeof SENSE): boolean {
  return (value & SENSE[key]) !== 0;
}
