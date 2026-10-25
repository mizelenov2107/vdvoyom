// Чтение штрихкода со снимка. wasm лежит у нас, а не на CDN по умолчанию:
// jsDelivr из России открывается не всегда.
import { prepareZXingModule, readBarcodes as read } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
  },
});

const FORMAT: Record<string, string> = { EAN13: "EAN13", "EAN-13": "EAN13", EAN8: "EAN8", "EAN-8": "EAN8", QRCode: "QR", Code128: "CODE128" };

export async function readBarcodes(file: File): Promise<{ text: string; format: string } | null> {
  const results = await read(file, { tryHarder: true, maxNumberOfSymbols: 1 });
  const hit = results.find((r) => r.isValid && r.text);
  if (!hit) return null;
  return { text: hit.text, format: FORMAT[hit.format] ?? "CODE128" };
}
