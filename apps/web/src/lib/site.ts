export type SiteInfo = {
  url: string;
  name?: string;
  description?: string;
  icon?: string;
  image?: string;
  color?: string;
  /** Whether the site lets other pages show it in a frame. Many dApps don't. */
  framable: boolean;
};

const MAX_HEAD = 256_000;
/** A hex colour, leaving out the plain white and black many sites declare. */
const BRAND_COLOR = /^#(?!(f{3}|f{6}|0{3}|0{6})$)[0-9a-f]{3,8}$/i;
const ATTR = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'" };

const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, entity: string) => ENTITIES[entity]!).trim();

function tags(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((tag) => Object.fromEntries([...tag[0].matchAll(ATTR)].map((a) => [a[1]!.toLowerCase(), decode(a[2] ?? a[3] ?? "")])));
}

/** Only the start of the page matters, and some pages are huge. */
async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  while (html.length < MAX_HEAD && !/<\/head>/i.test(html)) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return html;
}

function allowsFraming(headers: Headers): boolean {
  if (headers.get("x-frame-options")) return false;
  const ancestors = headers.get("content-security-policy")?.match(/frame-ancestors([^;,]*)/i)?.[1]?.trim();
  return !ancestors || ancestors === "*";
}

function webUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, base);
    return /^https?:$/.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** What a site says about itself, or undefined if nothing answers. A site that turns us away still counts as found. */
export async function readSite(url: string): Promise<SiteInfo | undefined> {
  try {
    const res = await fetch(url, {
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; DappDrill)" },
      signal: AbortSignal.timeout(5000),
    });
    const fallback = { url: res.url, icon: webUrl("/favicon.ico", res.url) };
    if (!res.ok) {
      await res.body?.cancel();
      return { ...fallback, framable: false };
    }

    const html = (res.headers.get("content-type") ?? "").includes("html") ? await readHead(res) : "";
    const meta = tags(html, "meta");
    const content = (...keys: string[]) => meta.find((m) => keys.includes(m.property ?? m.name ?? ""))?.content || undefined;
    const links = tags(html, "link");
    const icon = (rel: RegExp) => links.find((l) => rel.test(l.rel ?? ""))?.href;
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
    const color = content("theme-color");

    return {
      url: res.url,
      name: content("og:site_name", "application-name") ?? (title ? decode(title) || undefined : undefined),
      description: content("description", "og:description"),
      icon: webUrl(icon(/apple-touch-icon/i) ?? icon(/\bicon\b/i), res.url) ?? fallback.icon,
      image: webUrl(content("og:image", "twitter:image"), res.url),
      color: color && BRAND_COLOR.test(color) ? color : undefined,
      framable: allowsFraming(res.headers),
    };
  } catch {
    return undefined;
  }
}
