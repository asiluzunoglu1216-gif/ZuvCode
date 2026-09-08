import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch } from "undici";
import { load } from "cheerio";

export interface SearchResult { title: string; url: string; snippet: string }
export interface WebOptions { enabled?: boolean; serperKey?: string }
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["192.0.2.0", 24], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001:db8::", 32], ["2001::", 32], ["2002::", 16]] as const) blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export function validateWebUrl(input: string): URL {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
    throw new Error("Web tools accept public HTTP(S) URLs on ports 80/443 without credentials.");
  }
  if (hostname === "localhost" || /\.(localhost|local|internal)$/i.test(hostname) || (isIP(hostname) && !isPublicAddress(hostname))) {
    throw new Error("Private/local network URLs are blocked by web tools.");
  }
  url.hash = "";
  return url;
}

async function publicText(input: string, signal?: AbortSignal, api?: { key: string; query: string }): Promise<{ text: string; url: string; type: string }> {
  let url = validateWebUrl(input);
  const abort = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  // Validate the addresses used for the actual connection, not an earlier DNS lookup.
  const dispatcher = new Agent({ connect: { lookup(hostname, options, callback) {
    lookup(hostname, options, (error, address, family) => {
      const addresses = Array.isArray(address) ? address : [{ address, family }];
      if (error) { callback(error, address, family); return; }
      if (addresses.some((item) => !isPublicAddress(item.address))) {
        callback(new Error("DNS resolved to a private or reserved address."), address, family); return;
      }
      callback(null, address, family);
    });
  } } });
  try {
    for (let hop = 0; hop < 5; hop++) {
      const response = await fetch(url, {
        dispatcher, redirect: "manual", signal: abort,
        headers: api ? { "X-API-KEY": api.key, "Content-Type": "application/json" }
          : { "User-Agent": "ZuvCode/0.1 (web research)", Accept: "text/html,application/json,text/plain" },
        ...(api ? { method: "POST", body: JSON.stringify({ q: api.query, num: 5 }) } : {})
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        if (api) throw new Error("Search API redirected unexpectedly; credentials were not forwarded.");
        const location = response.headers.get("location");
        if (!location) throw new Error("Web redirect has no location.");
        url = validateWebUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok || response.status === 202) {
        await response.body?.cancel();
        throw new Error(`Web request failed or was challenged (HTTP ${response.status}). No results were retrieved. Try /web google for a search API connection.`);
      }
      const type = response.headers.get("content-type") ?? "";
      if (!/text\/|json|xml|xhtml/.test(type)) { await response.body?.cancel(); throw new Error("This URL is not a readable text page."); }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) throw new Error("Empty web response.");
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 2 * 1024 * 1024) throw new Error("Web page exceeds the 2 MiB limit.");
        chunks.push(chunk);
      }
      return { text: Buffer.concat(chunks).toString("utf8"), url: url.href, type };
    }
    throw new Error("Too many web redirects.");
  } finally { await dispatcher.destroy(); }
}

export function parseSearchHtml(html: string): SearchResult[] {
  const $ = load(html);
  const results: SearchResult[] = [];
  $(".result").each((_, element) => {
    const link = $(element).find(".result__a").first();
    const href = link.attr("href");
    if (!href) return;
    try {
      const redirect = new URL(href, "https://html.duckduckgo.com");
      const url = validateWebUrl(redirect.searchParams.get("uddg") ?? redirect.href).href;
      if (results.some((item) => item.url === url)) return;
      results.push({ title: link.text().trim().slice(0, 250), url, snippet: $(element).find(".result__snippet").text().trim().slice(0, 800) });
    } catch { /* Ignore non-public result links. */ }
  });
  return results.slice(0, 5);
}

export function extractWebPage(html: string): { title: string; content: string; truncated: boolean } {
  const $ = load(html);
  const title = $("title").first().text().trim();
  $("script,style,noscript,svg,iframe,nav,footer,header,form").remove();
  $("br,p,div,section,article,li,h1,h2,h3,tr,pre").append("\n");
  const main = $("main,article").first();
  const content = (main.length ? main.text() : $("body").text()).replace(/[\t ]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
  return { title, content: content.slice(0, 20_000), truncated: content.length > 20_000 };
}

export class WebTools {
  public constructor(private readonly options: WebOptions = {}) {}
  public get engine(): string { return this.options.enabled === false ? "off" : this.options.serperKey ? "Google (Serper)" : "DuckDuckGo"; }

  public async search(query: string, signal?: AbortSignal): Promise<{ engine: string; results: SearchResult[] }> {
    this.assertEnabled();
    let results: SearchResult[];
    if (this.options.serperKey) {
      const response = await publicText("https://google.serper.dev/search", signal, { key: this.options.serperKey, query });
      const body = JSON.parse(response.text) as { organic?: Array<{ title: string; link: string; snippet?: string }> };
      results = (body.organic ?? []).slice(0, 5).flatMap((item) => {
        try { return [{ title: String(item.title).slice(0, 250), url: validateWebUrl(item.link).href, snippet: String(item.snippet ?? "").slice(0, 800) }]; }
        catch { return []; }
      });
    } else {
      const response = await publicText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, signal);
      results = parseSearchHtml(response.text);
      if (!results.length && /anomaly|captcha|challenge-form/i.test(response.text)) throw new Error("Search was blocked by a verification challenge. Use /web google or try later.");
    }
    return { engine: this.engine, results };
  }

  public async read(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    this.assertEnabled();
    const page = await publicText(url, signal);
    return { url: page.url, ...(page.type.includes("html") ? extractWebPage(page.text)
      : { title: page.url, content: page.text.slice(0, 20_000), truncated: page.text.length > 20_000 }), untrusted: true };
  }

  private assertEnabled(): void { if (this.options.enabled === false) throw new Error("Web access is disabled. The user can enable it with /web on."); }
}
