// Работа с фото на телефоне до загрузки на сервер.

/**
 * Сжатие на телефоне до 1600 px по длинной стороне: снимок с камеры весит
 * 5–10 МБ, а после — около 300 КБ. Грузится быстрее и не забивает сервер.
 */
export async function shrink(file: File, max = 1600, limit = 1_500_000): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  let q = 0.86;
  let blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", q));
  while (blob.size > limit && q > 0.4) {
    q -= 0.12;
    blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", q));
  }
  return { blob, width: w, height: h };
}

