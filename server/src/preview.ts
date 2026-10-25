// Превью ссылки для хотелки: название, цена, картинка из og-разметки и JSON-LD.
// Сервер ходит по ссылке, которую прислал пользователь, поэтому адреса
// внутренней сети запрещены: иначе через хотелку можно было бы стучаться
// в контейнеры на сервере.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface Preview {
  title: string | null;
  price: number | null;
  image: string | null;
}

function privateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80") || low.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}

async function safeUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  const host = url.hostname;
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return null;
  return url;
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  if (!tag) return null;
  return /content=["']([^"']*)["']/i.exec(tag)?.[1]?.trim() || null;
}

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function parsePrice(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function fromJsonLd(html: string): Partial<Preview> {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : data["@graph"] ?? [data];
      for (const it of items) {
        if (!String(it["@type"]).includes("Product")) continue;
        const offer = Array.isArray(it.offers) ? it.offers[0] : it.offers;
        const img = Array.isArray(it.image) ? it.image[0] : it.image;
        return {
          title: it.name ?? null,
          price: parsePrice(offer?.price ?? offer?.lowPrice),
          image: typeof img === "string" ? img : img?.url ?? null,
        };
      }
    } catch {
      /* битый JSON-LD — не страшно, есть og */
    }
  }
  return {};
}

export async function preview(raw: string): Promise<Preview> {
  const empty: Preview = { title: null, price: null, image: null };
  let url = await safeUrl(raw);
  if (!url) return empty;
  // Редиректы ведём руками, проверяя каждый адрес заново
  let res: Response | null = null;
  for (let hop = 0; hop < 4 && url; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
    }).catch(() => null);
    if (!res) return empty;
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await safeUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok || !url) return empty;
  if (!(res.headers.get("content-type") ?? "").includes("html")) return empty;

  // Больше мегабайта не читаем: разметка превью всегда в начале страницы
  const reader = res.body!.getReader();
  let html = "";
  const dec = new TextDecoder();
  while (html.length < 1_000_000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
  }
  void reader.cancel().catch(() => {});

  const ld = fromJsonLd(html);
  const title = ld.title ?? meta(html, "og:title") ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? null;
  const image = ld.image ?? meta(html, "og:image") ?? null;
  const price =
    ld.price ??
    parsePrice(meta(html, "product:price:amount") ?? meta(html, "og:price:amount") ?? meta(html, "price"));
  return {
    title: title ? decode(title).trim().slice(0, 140) : null,
    price,
    image: image ? new URL(decode(image), url).toString() : null,
  };
}
