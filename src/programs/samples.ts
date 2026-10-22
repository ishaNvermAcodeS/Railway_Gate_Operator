export interface SampleProgram {
  id: string;
  name: string;
  description: string;
  source: string;
}

const BASIC = `; ==============================================================
;  RailLogic · Basic level-crossing controller
; --------------------------------------------------------------
;  Port 02h OUT  bit0 LIGHTS   bit1 BUZZER  bit2 GATE (1=lower)
;                bit3 FAULT
;  Port 03h IN   bit0 APPR_W   bit1 APPR_E  bit2 ISLAND
;                bit3 CLR_W    bit4 CLR_E   bit5 GATE_DN  bit6 GATE_UP
;  Timing: every instruction takes one 1 ms machine tick.
; ==============================================================

CTRL      EQU 02h
SENSORS   EQU 03h
APPROACH  EQU 00000011b     ; APPR_W | APPR_E
TRAIN_ANY EQU 00011111b     ; any train detector
GATE_DN   EQU 00100000b
GATE_UP   EQU 01000000b

START:  MOV  AL, 0              ; lamps off, buzzer off, barriers up
        OUT  CTRL, AL

IDLE:   IN   AL, SENSORS        ; poll the track detectors
        TEST AL, APPROACH
        JZ   IDLE               ; nothing approaching yet

; ---- a train is approaching: warn road users first
        MOV  AL, 00000011b      ; LIGHTS + BUZZER
        OUT  CTRL, AL
        MOV  CX, 3000           ; 3000 x 1 ms = 3 s pre-warning
PREWARN: LOOP PREWARN

; ---- lower the barriers and wait for the limit switch
        MOV  AL, 00000111b      ; LIGHTS + BUZZER + GATE
        OUT  CTRL, AL
WAIT_DN: IN   AL, SENSORS
        TEST AL, GATE_DN
        JZ   WAIT_DN
        MOV  AL, 00000101b      ; barriers down: buzzer off, lamps on
        OUT  CTRL, AL

; ---- hold until every train detector is quiet
WAIT_CLR: IN  AL, SENSORS
        TEST AL, TRAIN_ANY
        JNZ  WAIT_CLR

; ---- all trains clear: raise the barriers
        MOV  AL, 00000001b      ; lamps stay on while the booms rise
        OUT  CTRL, AL
WAIT_UP: IN   AL, SENSORS
        TEST AL, GATE_UP
        JZ   WAIT_UP
        JMP  START
`;

const SUPERVISED = `; ==============================================================
;  RailLogic · Supervised controller with fault detection
; --------------------------------------------------------------
;  Adds to the basic controller:
;   * barrier timeout supervision (GATE_DN must close in ~5 s)
;   * stuck approach-detector watchdog (~20 s)
;   * unannounced train detection (island before approach)
;   * a latched FAULT lamp kept in BL, merged by subroutine SETOUT
; ==============================================================

CTRL      EQU 02h
SENSORS   EQU 03h
FAULT     EQU 08h
APPROACH  EQU 03h          ; APPR_W | APPR_E
ISLAND    EQU 04h
AT_XING   EQU 1Ch          ; ISLAND | CLR_W | CLR_E
TRAIN_ANY EQU 1Fh
GATE_DN   EQU 20h
GATE_UP   EQU 40h

        XOR  BX, BX             ; BL = latched fault lamp bit

IDLE:   MOV  AL, 0
        CALL SETOUT
POLL:   IN   AL, SENSORS
        TEST AL, APPROACH
        JNZ  WARN
        TEST AL, ISLAND         ; train on the island but never announced?
        JNZ  LATE
        JMP  POLL

LATE:   OR   BL, FAULT          ; approach detector failure
        JMP  LOWER              ; no time for pre-warning

WARN:   MOV  AL, 03h            ; LIGHTS + BUZZER
        CALL SETOUT
        MOV  CX, 3000           ; 3 s pre-warning
PRE:    LOOP PRE

LOWER:  MOV  AL, 07h            ; LIGHTS + BUZZER + GATE
        CALL SETOUT
        MOV  CX, 1000           ; 1000 polls x 5 instructions = 5 s
WAIT_DN: IN  AL, SENSORS
        TEST AL, GATE_DN
        JNZ  DOWN
        NOP
        LOOP WAIT_DN
        OR   BL, FAULT          ; timeout: barrier failure
        MOV  AL, 07h            ; keep lamps, buzzer and motor command on
        CALL SETOUT
        JMP  HOLD
DOWN:   MOV  AL, 05h            ; barriers down: buzzer off
        CALL SETOUT

HOLD:   MOV  DX, 0              ; DX = watchdog counter
HOLD_LP: IN  AL, SENSORS
        TEST AL, TRAIN_ANY
        JZ   CLEAR
        TEST AL, AT_XING        ; a train is physically at the crossing
        JNZ  HOLD               ; ... so the detectors are plausible
        INC  DX
        CMP  DX, 2500           ; 2500 x 8 instructions = 20 s
        JB   HOLD_LP
        OR   BL, FAULT          ; detector stuck: stay closed (fail-safe)
        MOV  AL, 05h
        CALL SETOUT
        JMP  HOLD

CLEAR:  MOV  AL, 01h            ; raise barriers, lamps on until up
        CALL SETOUT
WAIT_UP: IN  AL, SENSORS
        TEST AL, APPROACH       ; another train while raising?
        JNZ  WARN
        TEST AL, GATE_UP
        JZ   WAIT_UP
        JMP  IDLE

; ---- SETOUT: write AL | BL (fault latch) to the control port
SETOUT: OR   AL, BL
        OUT  CTRL, AL
        RET
`;

const NAIVE = `; ==============================================================
;  RailLogic · Naive controller  (deliberately UNSAFE)
; --------------------------------------------------------------
;  Reacts only to the island detector, i.e. when the train is
;  already on the road. Run it and watch the safety monitor.
;  Exercise: fix it using the approach detectors (bits 0 and 1).
; ==============================================================

POLL:   IN   AL, 03h
        TEST AL, 04h            ; ISLAND occupied?
        JZ   OPEN
        MOV  AL, 07h            ; lamps + buzzer + barriers down
        OUT  02h, AL
        JMP  POLL
OPEN:   MOV  AL, 0
        OUT  02h, AL
        JMP  POLL
`;

const SELFTEST = `; ==============================================================
;  RailLogic · Commissioning self-test
; --------------------------------------------------------------
;  Exercises every output with LOOP delays, then cycles the
;  barriers and checks both limit switches. Ends with HLT.
;  Good for single-stepping: watch AL, CX, ZF and the ports.
; ==============================================================

        MOV  BL, 3              ; three lamp/buzzer cycles
LAMPS:  MOV  AL, 01h            ; lamps
        OUT  02h, AL
        MOV  CX, 700
D1:     LOOP D1
        MOV  AL, 02h            ; buzzer
        OUT  02h, AL
        MOV  CX, 300
D2:     LOOP D2
        DEC  BL
        JNZ  LAMPS

        MOV  AL, 05h            ; lamps + lower barriers
        OUT  02h, AL
DN:     IN   AL, 03h
        AND  AL, 20h            ; isolate GATE_DN
        CMP  AL, 20h
        JNE  DN

        MOV  AL, 01h            ; raise again
        OUT  02h, AL
UP:     IN   AL, 03h
        SHR  AL, 6              ; move GATE_UP (bit 6) to bit 0
        AND  AL, 1
        JZ   UP

        MOV  AL, 0
        OUT  02h, AL
        HLT                     ; test passed
`;

export const SAMPLES: SampleProgram[] = [
  { id: 'basic', name: 'Basic controller', description: 'Approach → warn → lower → wait clear → raise.', source: BASIC },
  { id: 'supervised', name: 'Supervised controller', description: 'Adds barrier timeout, stuck-detector watchdog and a fault lamp.', source: SUPERVISED },
  { id: 'naive', name: 'Naive controller (unsafe)', description: 'Only reacts to the island detector — produces safety violations.', source: NAIVE },
  { id: 'selftest', name: 'Commissioning self-test', description: 'Lamp, buzzer and barrier test using LOOP delays and HLT.', source: SELFTEST },
];

export const DEFAULT_SAMPLE = SAMPLES[0];
