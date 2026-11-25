// 一段真正的 6502 汇编程序：显示一行字，用方向键移动一个笑脸，按住 A 换颜色
// 它会被下面的汇编器翻译成机器码，再由 CPU 仿真器一条条执行
import { assemble } from './cpu6502.js';
import { T } from './tiles.js';

export const DEMO_SRC = `; ===== 硬件寄存器的地址 =====
PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007
OAMDMA    = $4014
JOY1      = $4016
; ===== 变量：放在内存 RAM 里 =====
BUTTONS = $00       ; 8 个按键的状态
PX      = $01       ; 笑脸的 X 坐标
PY      = $02       ; 笑脸的 Y 坐标

.org $8000          ; 程序从卡带的 $8000 开始
RESET:              ; ---- 开机后从这里执行 ----
  SEI               ; 先关掉中断
  CLD
  LDX #$FF
  TXS               ; 设好栈指针
WAITVB:
  BIT PPUSTATUS     ; 等 PPU 准备好
  BPL WAITVB
  LDA #$FF          ; 把 64 个精灵都藏到屏幕外
  LDX #$00
HIDE:
  STA $0200,X
  INX
  BNE HIDE
  LDA #%00011110    ; 打开背景和精灵显示
  STA PPUMASK
  LDA #$3F          ; 告诉 PPU：接下来要写调色板 $3F00
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
PAL:
  LDA PALETTE,X     ; 从卡带里取一个颜色
  STA PPUDATA       ; 送给 PPU
  INX
  CPX #$20          ; 一共 32 个
  BNE PAL
  LDA #$21          ; 接下来写名称表 $21CA（第 14 行第 10 列）
  STA PPUADDR
  LDA #$CA
  STA PPUADDR
  LDX #$00
TXT:
  LDA TEXT,X        ; 取一个字符的图块编号
  BEQ TXTEND        ; 遇到 0 就结束
  STA PPUDATA       ; 屏幕上多出一个字
  INX
  BNE TXT
TXTEND:
  LDA #$78
  STA PX            ; 笑脸初始位置
  LDA #$58
  STA PY
  LDA #$00
  STA PPUADDR
  STA PPUADDR
  STA PPUSCROLL
  STA PPUSCROLL
  LDA #%10000000    ; 允许 PPU 每帧画完后"叫醒"CPU（NMI 中断）
  STA PPUCTRL
LOOP:
  JMP LOOP          ; 主程序原地空转，等中断

NMI:                ; ---- 每一帧（1/60 秒）执行一次 ----
  LDA #$01
  STA JOY1          ; 让手柄"拍照"锁存 8 个按键
  LDA #$00
  STA JOY1
  LDX #$08
READ:
  LDA JOY1          ; 每读一次得到 1 个按键
  LSR A             ; 把它移进进位标志
  ROL BUTTONS       ; 再移进变量，8 次后凑成 1 字节
  DEX
  BNE READ
  LDA BUTTONS
  AND #%00000001    ; 右
  BEQ NORIGHT
  INC PX
NORIGHT:
  LDA BUTTONS
  AND #%00000010    ; 左
  BEQ NOLEFT
  DEC PX
NOLEFT:
  LDA BUTTONS
  AND #%00000100    ; 下
  BEQ NODOWN
  INC PY
NODOWN:
  LDA BUTTONS
  AND #%00001000    ; 上
  BEQ NOUP
  DEC PY
NOUP:
  LDA PY            ; 把笑脸写进"精灵表"：Y、图块、属性、X
  STA $0200
  LDA #SMILE
  STA $0201
  LDA BUTTONS
  ASL A             ; A 键在最高位，移进进位
  LDA #$00
  ROL A             ; 按住 A → 用第 1 组调色板
  STA $0202
  LDA PX
  STA $0203
  LDA #$00
  STA OAMADDR
  LDA #$02
  STA OAMDMA        ; 把 $0200 整页精灵数据交给 PPU
  RTI               ; 中断结束，回到 LOOP

PALETTE:
  .byte $02,$00,$10,$30, $02,$00,$10,$30, $02,$00,$10,$30, $02,$00,$10,$30
  .byte $02,$28,$0F,$30, $02,$2A,$0F,$30, $02,$16,$0F,$30, $02,$21,$0F,$30
TEXT:
  .byte "HELLO 6502!", 0

.org $FFFA          ; 卡带最末尾 6 个字节：三个"向量"
  .word NMI, RESET, 0
`;

export function buildDemoRom(ppu) {
  const asm = assemble(DEMO_SRC, { SMILE: T.SMILE });
  // 拼出 .nes 文件的样子：16 字节文件头 + 32KB 程序 + 8KB 图形
  const header = new Uint8Array(16);
  header.set([0x4e, 0x45, 0x53, 0x1a, 2, 1, 0, 0]);
  const prg = asm.mem.slice(0x8000, 0x10000);
  const chr = ppu.chrBytes();
  const lineOf = new Map();
  asm.listing.forEach((l) => { if (l.kind === 'op') lineOf.set(l.addr, l.line); });
  return { ...asm, header, prg, chr, lineOf };
}
