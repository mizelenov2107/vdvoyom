// Закрытые картинки пары (вещи гардероба, фото своих идей). Файлы лежат на
// диске сервера, ссылка на каждый подписана HMAC: <img> не умеет слать
// заголовок входа, а открыть чужое фото по угаданному имени без подписи нельзя.
// Альбом «Моменты» убран 08.10.2026: фото пар больше не храним.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { env } from "../env.ts";

const SECRET = env.webhookSecret || env.botToken || randomBytes(32).toString("hex");

export function sign(file: string): string {
  return createHmac("sha256", SECRET).update(file).digest("base64url").slice(0, 24);
}

export function mediaUrl(file: string): string {
  return `/media/${file}?s=${sign(file)}`;
}

/** Отдача файла по подписанной ссылке — без входа, но только с верной подписью. */
export const media = new Hono();
media.get("/:pair/:file", (c) => {
  const name = `${c.req.param("pair")}/${c.req.param("file")}`;
  if (!/^\d+\/w?[a-z0-9]+\.(jpg|png|webp)$/.test(name)) return c.notFound();
  const given = Buffer.from(c.req.query("s") ?? "");
  const want = Buffer.from(sign(name));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return c.text("forbidden", 403);
  const full = path.join(env.photosDir, name);
  if (!fs.existsSync(full)) return c.notFound();
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return c.body(fs.readFileSync(full), 200, { "content-type": type, "cache-control": "private, max-age=31536000, immutable" });
});
