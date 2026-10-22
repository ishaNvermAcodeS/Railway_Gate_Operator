import type { SampleProgram } from './samples';

const ARRAY_STATS = `; ==============================================================
;  8086 Playground · Array statistics
; --------------------------------------------------------------
;  Walks a DB array with SI to find its sum, minimum and maximum,
;  then prints labelled results using a subroutine.
;  Output ports: 10h = character, 11h = decimal number.
; ==============================================================

DATA    DB 23, 7, 91, 45, 12, 68, 3, 56
COUNT   EQU 8
SUM     DW 0
T_SUM   DB 'sum = ', 0
T_MIN   DB 'min = ', 0
T_MAX   DB 'max = ', 0

        LEA  SI, DATA
        MOV  CX, COUNT
        MOV  BL, [SI]           ; BL = minimum so far
        MOV  BH, [SI]           ; BH = maximum so far
        XOR  AX, AX             ; AX = running sum

NEXT:   MOV  DL, [SI]           ; DX = current element
        XOR  DH, DH
        ADD  AX, DX
        CMP  DL, BL
        JAE  NOT_MIN
        MOV  BL, DL
NOT_MIN: CMP DL, BH
        JBE  NOT_MAX
        MOV  BH, DL
NOT_MAX: INC SI
        LOOP NEXT

        MOV  SUM, AX            ; store the result in memory
        PUSH AX
        LEA  SI, T_SUM
        CALL PRINTS
        POP  AX
        OUT  11h, AX            ; 305

        LEA  SI, T_MIN
        CALL PRINTS
        MOV  AL, BL
        OUT  11h, AL            ; 3

        LEA  SI, T_MAX
        CALL PRINTS
        MOV  AL, BH
        OUT  11h, AL            ; 91
        HLT

; ---- PRINTS: print the 0-terminated string at SI
PRINTS: MOV  AL, [SI]
        CMP  AL, 0
        JE   PR_END
        OUT  10h, AL
        INC  SI
        JMP  PRINTS
PR_END: RET
`;

const HELLO = `; ==============================================================
;  8086 Playground · Hello, world
; --------------------------------------------------------------
;  Prints a 0-terminated string one character at a time
;  through the console port 10h.
; ==============================================================

MSG     DB 'Hello, 8086!', 0Ah, 'One instruction per tick.', 0

        LEA  SI, MSG            ; SI points at the first character
NEXT:   MOV  AL, [SI]
        CMP  AL, 0              ; end of string?
        JE   DONE
        OUT  10h, AL            ; print it
        INC  SI
        JMP  NEXT
DONE:   HLT
`;

const SUM = `; ==============================================================
;  8086 Playground · Sum of 1..N
; --------------------------------------------------------------
;  The classic LOOP: CX counts down from N while AX adds it up.
;  Single-step (F10) and watch CX, AX and ZF.
; ==============================================================

N       EQU 10

        XOR  AX, AX             ; AX = 0
        MOV  CX, N
ADD_LP: ADD  AX, CX             ; AX += CX
        LOOP ADD_LP             ; CX--, repeat while CX != 0
        OUT  11h, AX            ; prints 55
        OUT  12h, AX            ; prints 0037h
        HLT
`;

const SORT = `; ==============================================================
;  8086 Playground · Bubble sort
; --------------------------------------------------------------
;  Sorts a byte array in place, then prints it. Watch the
;  array change in the Memory panel while it runs.
; ==============================================================

ARR     DB 64, 25, 12, 22, 11, 90, 3, 47
LEN     EQU 8
PASSES  EQU 7                   ; LEN - 1

        MOV  DX, PASSES
OUTER:  LEA  SI, ARR
        MOV  CX, DX             ; compare the unsorted part only
INNER:  MOV  AL, [SI]
        CMP  AL, [SI+1]
        JBE  NO_SWAP
        XCHG AL, [SI+1]         ; swap neighbours
        MOV  [SI], AL
NO_SWAP: INC SI
        LOOP INNER
        DEC  DX
        JNZ  OUTER

        LEA  SI, ARR            ; print the sorted array
        MOV  CX, LEN
PRINT:  MOV  AL, [SI]
        OUT  11h, AL
        INC  SI
        LOOP PRINT
        HLT
`;

const FIB = `; ==============================================================
;  8086 Playground · Fibonacci
; --------------------------------------------------------------
;  Generates the first 12 Fibonacci numbers into a DW array
;  and prints each one. Uses word-sized memory writes.
; ==============================================================

FIB     DW 12 DUP(0)

        LEA  DI, FIB
        MOV  AX, 0              ; F(n)
        MOV  BX, 1              ; F(n+1)
        MOV  CX, 12
NEXT:   MOV  [DI], AX           ; store F(n)
        OUT  11h, AX
        MOV  DX, AX
        ADD  DX, BX             ; DX = F(n) + F(n+1)
        MOV  AX, BX
        MOV  BX, DX
        ADD  DI, 2              ; next word
        LOOP NEXT
        HLT
`;

const LEDS = `; ==============================================================
;  8086 Playground · LEDs and switches
; --------------------------------------------------------------
;  A running light on the LEDs (port 20h). Turn on switch 7
;  (port 30h) in the Devices panel and the LEDs mirror the
;  switches instead. This program never halts: Pause stops it,
;  and the execution budget stops it after 1,000,000 instructions.
; ==============================================================

        MOV  AH, 1              ; AH = chaser pattern
MAIN:   IN   AL, 30h            ; read the switches
        TEST AL, 80h            ; switch 7 on?
        JNZ  MIRROR
        MOV  AL, AH
        OUT  20h, AL            ; show the chaser
        SHL  AH, 1
        JNZ  DELAY
        MOV  AH, 1              ; wrapped around: restart at LED 0
DELAY:  MOV  CX, 40
WAIT:   LOOP WAIT
        JMP  MAIN
MIRROR: OUT  20h, AL            ; LEDs follow the switches
        JMP  MAIN
`;

export const PLAYGROUND_SAMPLES: SampleProgram[] = [
  { id: 'array', name: 'Array statistics', description: 'Sum, min and max of a DB array; labelled output via CALL/RET.', source: ARRAY_STATS },
  { id: 'hello', name: 'Hello, world', description: 'Print a string through the console port.', source: HELLO },
  { id: 'sum', name: 'Sum 1..N (LOOP)', description: 'Counting loop with LOOP and CX.', source: SUM },
  { id: 'sort', name: 'Bubble sort', description: 'In-place sort of a byte array using [SI] addressing.', source: SORT },
  { id: 'fib', name: 'Fibonacci (DW array)', description: 'Word-sized array writes with MOV [DI].', source: FIB },
  { id: 'leds', name: 'LEDs & switches', description: 'IN/OUT with the LED bank and switches; runs until paused.', source: LEDS },
];

export const DEFAULT_PLAYGROUND_SAMPLE = PLAYGROUND_SAMPLES[0];
