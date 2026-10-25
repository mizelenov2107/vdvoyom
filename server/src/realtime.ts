// Живые обновления через SSE. Процесс один, поэтому хватает словаря в памяти:
// пара → открытые соединения. Клиент на событие перезапрашивает нужный раздел.

export type Push = (event: string, data: unknown) => void;

interface Conn {
  userId: number;
  push: Push;
  room: string | null;
}

const byPair = new Map<number, Set<Conn>>();

export function connect(pairId: number, userId: number, push: Push): () => void {
  const conn: Conn = { userId, push, room: null };
  let set = byPair.get(pairId);
  if (!set) byPair.set(pairId, (set = new Set()));
  set.add(conn);
  broadcastPresence(pairId);
  return () => {
    set!.delete(conn);
    if (set!.size === 0) byPair.delete(pairId);
    broadcastPresence(pairId);
  };
}

/** Сообщить паре, что изменился раздел scope. except — кто изменил (ему не надо). */
export function changed(pairId: number, scope: string, extra: Record<string, unknown> = {}): void {
  for (const c of byPair.get(pairId) ?? []) c.push("change", { scope, ...extra });
}

export function send(pairId: number, event: string, data: unknown, onlyUser?: number): void {
  for (const c of byPair.get(pairId) ?? []) if (onlyUser === undefined || c.userId === onlyUser) c.push(event, data);
}

export function isOnline(pairId: number, userId: number): boolean {
  for (const c of byPair.get(pairId) ?? []) if (c.userId === userId) return true;
  return false;
}

/** Кто в какой комнате: так колода фильмов показывает «Алина тоже выбирает». */
export function setRoom(pairId: number, userId: number, room: string | null): void {
  for (const c of byPair.get(pairId) ?? []) if (c.userId === userId) c.room = room;
  broadcastPresence(pairId);
}

function broadcastPresence(pairId: number): void {
  const set = byPair.get(pairId);
  if (!set) return;
  const presence: Record<number, string | null> = {};
  for (const c of set) presence[c.userId] = c.room ?? presence[c.userId] ?? "";
  for (const c of set) c.push("presence", presence);
}
