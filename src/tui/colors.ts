import { crayon } from "crayon";

export const C = {
  bg: crayon.bgBlack,
  panel: crayon.bgHex("#0d0d00"),
  header: crayon.bgHex("#111100").hex("#c8a228").bold,
  tab: crayon.bgHex("#0d0d00").hex("#c8a228"),
  content: crayon.bgHex("#0d0d00").hex("#7a6a10"),
  hint: crayon.bgHex("#111100").hex("#5a5000"),
  amber: crayon.bgBlack.hex("#c8a228"),
  amberMuted: crayon.bgBlack.hex("#7a6a10"),
  amberFaint: crayon.bgBlack.hex("#5a5000"),
  amberGhost: crayon.bgBlack.hex("#3a3200"),
  green: crayon.bgBlack.hex("#4ecb6e"),
  greenFaint: crayon.bgBlack.hex("#1a3020"),
  red: crayon.bgBlack.hex("#cb4e4e"),
  redFaint: crayon.bgBlack.hex("#2e1000"),
} as const;
