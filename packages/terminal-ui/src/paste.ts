import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";

const start = "\x1b[200~";
const end = "\x1b[201~";
const idleMs = 80;

export function cleanPaste(text: string): string {
  return stripVTControlCharacters(text).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** Decode framed pastes, with an idle-burst fallback for legacy Windows consoles. */
export class PasteDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private framed: string | undefined;
  private prefix = "";
  private pending = "";
  private multiline = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly key: (text: string) => void, private readonly paste: (text: string) => void) {}

  public write(data: Buffer): void {
    let text = this.prefix + this.decoder.write(data);
    this.prefix = "";
    if (this.timer) clearTimeout(this.timer);
    while (text) {
      if (this.framed !== undefined) {
        this.framed += text;
        const stop = this.framed.indexOf(end);
        if (stop === -1) return;
        text = this.framed.slice(stop + end.length);
        this.paste(cleanPaste(this.framed.slice(0, stop)));
        this.framed = undefined;
        continue;
      }
      const begin = text.indexOf(start);
      if (begin !== -1) {
        this.ordinary(text.slice(0, begin));
        this.flush(true);
        this.framed = "";
        text = text.slice(begin + start.length);
        continue;
      }
      for (let size = Math.min(start.length - 1, text.length); size > 0; size--) {
        if (start.startsWith(text.slice(-size))) {
          this.prefix = text.slice(-size);
          text = text.slice(0, -size);
          break;
        }
      }
      this.ordinary(text);
      break;
    }
    if (this.pending || this.prefix) this.timer = setTimeout(() => {
      this.flush();
      if (this.prefix) { this.key(this.prefix); this.prefix = ""; }
    }, idleMs);
  }

  private ordinary(text: string): void {
    if (!text) return;
    if (this.pending) {
      this.pending += text;
      this.multiline = true;
    } else if (/[\r\n]/.test(text.replace(/\r$/, ""))) {
      this.pending = text;
      this.multiline = true;
    } else if (text.endsWith("\r")) {
      this.key(text.slice(0, -1));
      this.pending = "\r";
    } else this.key(text);
  }

  private flush(asPaste = false): void {
    const pending = this.pending;
    const paste = this.multiline || asPaste;
    this.pending = "";
    this.multiline = false;
    if (pending) { if (paste) this.paste(cleanPaste(pending)); else this.key(pending); }
  }

  public close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.pending = "";
    this.prefix = "";
    this.framed = undefined;
  }
}
