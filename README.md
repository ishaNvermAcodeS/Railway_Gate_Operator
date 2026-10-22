# Hex86 — 8086 Assembly & Hardware Simulation Platform

Hex86 is a browser-based teaching tool built on a custom 8086 execution engine. It has two modes that share the same assembler, CPU and debugger:

- **8086 Playground**: general-purpose 8086 programs (arithmetic, loops, arrays, subroutines) with a program-output console, LEDs, switches and a memory view. No railway hardware is attached.
- **Railway Lab**: your program drives a simulated railway level crossing through virtual I/O ports.

In Railway Lab, you write 8086 assembly in the editor, assemble it, and the program drives a simulated railway level crossing through virtual I/O ports. The trains, barriers, warning lamps, buzzer and road traffic all respond to what your program writes to the ports, and the sensors your program reads come from the simulated world. Nothing in the scene follows a pre-recorded animation.

Built with React, TypeScript and Vite. The CPU engine has no UI dependencies and is unit-tested on its own.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (Vitest)
npm run build      # type-check and production build into dist/
```

Requires Node 20+. Monaco is bundled locally, so the app works without internet once installed. That makes it suitable for a lecture hall.

The app opens on a landing page where you pick **8086 Playground** or **Railway Lab**. The mode switch in the top bar moves between them, and the Hex86 logo returns to the landing page. Each mode opens with a sample already assembled: press **F5** to run it, or **F10** to single-step.

**Theme:** the sun/moon button in the top bar switches the whole app (editor, simulator, panels and indicators) between dark and light. The choice is saved in `localStorage` and restored on reload. Until you choose, the app follows your system setting.

## 8086 Playground

The same engine and debugger as Railway Lab, attached to general-purpose devices instead of the crossing:

| Port | Dir | Device |
|---|---|---|
| 10h | OUT | Console: prints AL as an ASCII character (0Ah = new line) |
| 11h | OUT | Prints AL or AX as an unsigned decimal number, then a new line |
| 12h | OUT | Prints AL or AX in hex, then a new line |
| 20h | OUT | Eight LEDs |
| 30h | IN | Eight toggle switches you click in the Devices panel |

Any other port is a plain latch: `OUT` stores a value and `IN` returns the last value written (00h if never written). The **Memory** panel shows every `DB`/`DW` variable and the stack live. A program finishes when it executes `HLT`. A Run that executes 1,000,000 instructions without `HLT` stops with an "execution budget reached" message, so infinite loops are caught. Switch changes are recorded by tick, so step back and replay stay deterministic.

Samples: array statistics (sum/min/max with labelled output), Hello world, sum 1..N with `LOOP`, bubble sort, Fibonacci into a `DW` array, and an LED/switch demo.

## Railway Lab workspace

| Control | Shortcut | What it does |
|---|---|---|
| Assemble | Ctrl/⌘ + Enter | Assembles the editor contents and starts a fresh session at t = 0 |
| Run / Continue / Pause | F5 | Executes continuously at the selected clock rate |
| Step | F10 | Executes exactly one instruction (one 1 ms machine tick) |
| Step back | Shift + F10 | Returns to the previous instruction using deterministic replay |
| Reset | F8 | Rewinds the CPU and the world to t = 0. The recorded timeline stays available |
| Stop | Shift + F5 | Ends the session |
| Breakpoint | click the gutter / F9 | Run pauses *before* executing a line that has a breakpoint |
| Timeline | drag the scrubber | Jumps to any moment of the scenario by replaying deterministically |

- **Clock** sets how many instructions run per real second: 10 Hz and 100 Hz for watching line by line, 1× = real time (1000 instructions/s), up to 20×.
- **Scenario** chooses the deterministic railway situation (see below).
- Errors and warnings appear live while you type: underlined in the editor and listed in **Problems**. Click a problem to jump to it.
- Hover an instruction to see its syntax, behaviour and the flags it affects.
- The debugger shows the registers (with high/low bytes, and changed values highlighted), the flags, IP, the next instruction, both I/O ports bit by bit, an **Events** log (train, gate and I/O changes, plus safety violations), an instruction **Trace** (the last 400 instructions with their side effects) and reference tabs.
- The **safety monitor** under the scene counts violations, the shortest warning time a train received, how many trains have cleared, and the longest time a road vehicle waited.

## Virtual hardware

Time model: **every instruction takes one 1 ms machine tick**, and the world advances 1 ms after each instruction. For example, `MOV CX, 3000` followed by `L: LOOP L` waits about 3 s. A halted CPU (`HLT`) stops executing, but the world keeps running.

### Port 02h — OUT — control latch

| Bit | Mask | Name | Meaning |
|---|---|---|---|
| 0 | 01h | LIGHTS | Road warning lamps. The hardware flasher alternates left/right at 1 Hz while set |
| 1 | 02h | BUZZER | Audible warning |
| 2 | 04h | GATE | Barrier motor: 1 = lower, 0 = raise. Full travel takes 3 s |
| 3 | 08h | FAULT | Maintenance fault lamp |
| 4–7 | — | — | Reserved, ignored |

Reading port 02h returns the current latch value.

### Port 03h — IN — sensor inputs (active-high)

| Bit | Mask | Name | Meaning |
|---|---|---|---|
| 0 | 01h | APPR_W | An eastbound train is on the west approach section (between the strike-in point 800 m out and the crossing) |
| 1 | 02h | APPR_E | A westbound train is on the east approach section |
| 2 | 04h | ISLAND | Part of a train is on the road crossing |
| 3 | 08h | CLR_W | Train-clear detector, west: 1 while a departing westbound train is still within 250 m of the crossing; 0 once it is clear |
| 4 | 10h | CLR_E | Train-clear detector, east: same, for eastbound trains |
| 5 | 20h | GATE_DN | Limit switch: barriers fully lowered |
| 6 | 40h | GATE_UP | Limit switch: barriers fully raised |
| 7 | 80h | — | Always 0 |

Writing port 03h is ignored and logged. Any other port is unmapped: reads return FFh and writes are ignored. Both are reported in the Events log; neither is silently dropped. Word I/O (`IN AX` / `OUT …, AX`) accesses port *n* and *n + 1*.

Road vehicles stop at the stop line whenever the lamps are on or the barriers are not fully raised. The safety monitor flags a violation if a train reaches the crossing while the barriers are not fully down or the lamps are off, or if a vehicle is on the crossing while a train is present.

## Scenarios

All scenarios are pure data (`src/sim/scenarios.ts`) with no randomness, so the same program and scenario always produce the same run.

| Scenario | What happens |
|---|---|
| Normal · eastbound train | One train from the west on the southern track |
| Normal · westbound train | One train from the east on the northern track |
| Second train following | A slower freight train approaches while the first is still clearing. The barriers must stay down |
| Trains from both directions | Overlapping trains on both tracks |
| Fault · gate motor jammed | The barriers never move and GATE_DN never closes |
| Fault · east approach detector dead | APPR_E is stuck at 0, so a westbound train is first seen at the island |
| Fault · west approach stuck ON | APPR_W sticks at 1 from t = 3 s with no train. A real train arrives at 30 s |

## Sample programs

- **Basic controller**: approach → lamps and buzzer → 3 s pre-warning → lower → wait for every detector to clear → raise.
- **Supervised controller**: adds a barrier-timeout check, a stuck-detector watchdog, detection of a train that arrives unannounced, and a latched FAULT lamp. It uses `CALL`/`RET` and `OR`.
- **Naive controller (unsafe)**: reacts only to the island detector. Run it to see the safety monitor fire, then fix it as an exercise.
- **Commissioning self-test**: blinks the lamps, buzzer and barrier with `LOOP` delays, checks both limit switches (`AND`, `CMP`, `SHR`), then halts.

## Supported 8086 subset

Only the instructions below are implemented. Anything else is rejected at assembly time with an explicit error. A real 8086 instruction that is not implemented yet (for example `MUL`) gets "valid 8086 instruction but not supported yet". Unknown words get a "did you mean …?" suggestion. No instruction is ever skipped silently.

| Group | Instructions | Operand forms |
|---|---|---|
| Data transfer | `MOV`, `XCHG`, `LEA`, `PUSH`, `POP` | `reg, reg/imm/mem` · `mem, reg/imm` · `LEA reg16, mem` · `PUSH/POP reg16` |
| I/O | `IN`, `OUT` | `IN AL/AX, imm8` · `IN AL/AX, DX` · `OUT imm8/DX, AL/AX` |
| Arithmetic | `ADD`, `SUB`, `CMP`, `INC`, `DEC` | `reg, reg/imm/mem` · `mem, reg/imm` · `INC/DEC reg/mem` |
| Logic | `AND`, `OR`, `XOR`, `TEST`, `NOT`, `SHL`, `SHR` | `reg, reg/imm/mem` · `mem, reg/imm` · `NOT reg/mem` · `SHL/SHR reg, 1/CL/imm` |
| Control transfer | `JMP`, `JE/JZ`, `JNE/JNZ`, `JC/JB/JNAE`, `JNC/JAE/JNB`, `JA/JNBE`, `JBE/JNA`, `JG/JNLE`, `JGE/JNL`, `JL/JNGE`, `JLE/JNG`, `JS`, `JNS`, `JO`, `JNO`, `JP/JPE`, `JNP/JPO`, `JCXZ`, `LOOP`, `LOOPE/LOOPZ`, `LOOPNE/LOOPNZ`, `CALL`, `RET` | `label` |
| Processor control | `NOP`, `HLT`, `STC`, `CLC` | none |

**Registers:** AX, BX, CX, DX (with AL/AH … DL/DH aliasing), SI, DI, BP, SP, IP.
**Flags:** CF, ZF, SF, OF, PF, AF, computed as on the 8086 (for example, `INC`/`DEC` preserve CF, and logic instructions clear CF and OF).
**Memory:** a flat 64 KB byte-addressed memory (segments are not modelled). `DB`/`DW` data is placed from address 0100h. Addressing: `[BX]`, `[SI+2]`, `[BX+DI+4]`, `[1234h]`, `ARR`, `ARR[SI]`, `[ARR+BX]`, with `BYTE PTR` / `WORD PTR` when the size isn't implied, and `OFFSET ARR` for an address. Two memory operands in one instruction are rejected, as on the 8086.
**Stack:** `PUSH`, `POP`, `CALL` and `RET` use SP starting at FFFEh in the same memory. `RET`/`POP` on an empty stack is a CPU fault.

**Syntax**

```asm
NAME    EQU 03h            ; constant (number or earlier constant)
LABEL:  MOV  AL, 0FFh      ; labels end with ':'; comments start with ';'
        TEST AL, 00100000b ; binary
        MOV  BL, 0x1F      ; C-style hex
        MOV  CL, 'A'       ; character
TABLE   DB 1, 2, 'AB', 4 DUP(0) ; bytes, string, repeated values
WORDS   DW 1234h, ?            ; words (? = 0)
        MOV  AL, TABLE[SI]     ; indexed memory read
```

Numbers can be decimal (`25`, `25d`), hex (`0FFh` — it must start with a digit — or `0x1F`), binary (`1010b`, `0b1010`) or a character (`'A'`). Mnemonics, registers and labels are case-insensitive.

**Not supported (rejected with an error):** segment registers, `DWORD PTR`, `OFFSET` of code labels, and assembler directives other than `EQU`/`DB`/`DW` (`.MODEL`, `.CODE`, `ORG`, `PROC`, `END` …).

**Differences from real hardware, stated plainly:**

- No machine code is generated. IP is the *index* of the next instruction, not a byte offset.
- Every instruction costs one 1 ms tick, rather than real 8086 cycle counts.
- `SHL/SHR reg, imm` with a count above 1 is an 80186 extension, accepted for convenience.

**Runtime faults** halt the CPU with a message and highlight the line. They include running past the last instruction and stack underflow. Infinite loops cannot hang the browser: the run loop executes a bounded number of instructions per animation frame, so Pause always responds. The headless API `run(cpu, program, bus, maxInstructions)` returns `'budget'` once its execution budget is used up.

## Architecture

```
src/
  engine/      8086 subset: assembler, instruction registry, CPU, flags (no UI deps)
    instructions.ts   one InstructionDef per mnemonic: docs + validate() + execute()
    assembler.ts      two-pass assembler with diagnostics and suggestions
    cpu.ts            step() / run() with execution budget and runtime faults
  hardware/ports.ts   port numbers and bit mappings (single source of truth)
  sim/
    world.ts          deterministic physical model: trains, detectors, barriers, traffic
    scenarios.ts      scenario data and fault injection
    machine.ts        generic CPU + device core: checkpoints, seek, step-back, breakpoints, logs
    simulation.ts     Railway machine: CPU + I/O bus + world in lock-step
    playground.ts     Playground machine: console, LEDs, switches and latch ports
  programs/samples.ts bundled example programs
  programs/playgroundSamples.ts  Playground example programs
  ui/                 React: landing page, Railway Lab, Playground, shared workbench, theme, Monaco editor, SVG renderer, debugger panels
tests/                Vitest suites
```

- **Renderer and engine are separate.** `CrossingView` is a pure function of the world state, the control latch and the sensor byte. The lamp flasher phase comes from simulated time, not wall-clock time.
- **Determinism and replay.** The `Simulation` saves a checkpoint every 1000 ticks. Step-back and timeline seeking restore the nearest earlier checkpoint and replay forward, which gives a state identical to a fresh run (this is tested).
- **Adding an instruction** means adding one `InstructionDef` to `src/engine/instructions.ts`. The assembler, hover help, completion, in-app reference and execution all pick it up from there.

## Tests

`npm test` runs 105 tests:

- `tests/assembler.test.ts`: number formats, labels, comments, EQU, and error messages (unknown or unsupported instructions, undefined labels with suggestions, size mismatches, overflowing immediates, invalid memory operands, DB/DW data layout, directives, bad IN/OUT forms).
- `tests/cpu.test.ts`: register aliasing, arithmetic and logic flags, signed and unsigned conditional jumps, LOOP variants, CALL/RET/PUSH/POP, memory operands and arrays, IN/OUT through a fake bus, the execution budget on `L: JMP L`, and runtime faults.
- `tests/railway.test.ts`: port bit mapping, barrier travel and limit switches, the detector sequence for a passing train, fault injection, vehicles stopping, OUT/IN integration, every sample against the relevant scenarios (zero violations for the correct controllers, violations for the naive one), changes to the assembly code changing the outcome, run-to-run determinism, step-back/seek equivalence, and breakpoints.
- `tests/playground.test.ts`: console output (character, decimal, hex), switches and LEDs, deterministic replay of switch changes, the exact output of every Playground sample, and the execution budget on a program that never halts.
