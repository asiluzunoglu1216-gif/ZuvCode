import chalk from "chalk";

// Pixel lettering with a one-cell extruded edge; no font or terminal image support required.
const letters: Record<string, string[]> = {
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"]
};

const compact: Record<string, string[]> = {
  Z: ["111", "001", "010", "100", "111"],
  U: ["101", "101", "101", "101", "111"],
  C: ["111", "100", "100", "100", "111"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  O: ["111", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"]
};

export function renderWordmark(width: number): string {
  const word = "ZUVCODE";
  const requiredWidth = (size: number, scale = 1) => (word.length * (size + 1) - 1) * scale + 3;
  if (width < requiredWidth(3) - 2) return chalk.hex("#77E8AC").bold("ZuvCode".slice(0, Math.max(0, width)));
  const indent = width < requiredWidth(3) ? "" : "  ";
  const glyphs = width < requiredWidth(5) ? compact : letters;
  const scale = width >= requiredWidth(5, 2) ? 2 : 1;
  const glyphHeight = glyphs["O"]!.length;
  const pixels = Array.from({ length: glyphHeight }, (_, y) =>
    [...word].map((letter) => [...glyphs[letter]![y]!].map((pixel) => pixel.repeat(scale)).join("")).join("0".repeat(scale)));
  const columns = pixels[0]!.length + 1;
  const front = (x: number, y: number) => pixels[y]?.[x] === "1";
  return Array.from({ length: glyphHeight + 1 }, (_, y) => {
    const face = chalk.hex(y < 2 ? "#99F2BE" : "#65D99A");
    let line = indent;
    for (let x = 0; x < columns; x++) {
      if (front(x, y)) line += face("\u2588");
      else if (front(x - 1, y - 1)) line += chalk.hex("#287A54")("\u2593");
      else line += " ";
    }
    return line.trimEnd();
  }).join("\n");
}
