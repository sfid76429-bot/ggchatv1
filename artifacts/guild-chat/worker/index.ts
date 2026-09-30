interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}

interface ChatIdentity {
  userId: string;
  handle: string;
  displayName: string;
  groupId: string;
}

interface GroupChatStub {
  fetch(request: Request): Promise<Response>;
}

interface GroupChatNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): GroupChatStub;
}

interface WorkerEnv {
  DB: D1Database;
  CHAT_ROOMS: GroupChatNamespace;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
}

const SESSION_COOKIE = "guild_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 310_000;
const HANDLE_PATTERN = /^[a-z0-9_]{3,24}$/;
const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;
function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return HANDLE_PATTERN.test(handle) ? handle : null;
}

function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 && result.length <= maxLength ? result : null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function digestHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function cookieToken(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const entry = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(SESSION_COOKIE.length + 1));
  } catch {
    return null;
  }
}

function sessionCookie(token: string, maxAge = SESSION_SECONDS): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function issueSession(
  db: D1Database,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await digestHex(token), userId, expiresAt)
    .run();
  return { token, expiresAt };
}

async function getIdentity(
  request: Request,
  db: D1Database,
): Promise<(ChatIdentity & { createdAt: string }) | null> {
  const token = cookieToken(request);
  if (!token || token.length !== 64) return null;
  const row = await db
    .prepare(
      `SELECT users.id AS userId, users.handle, users.display_name AS displayName,
              users.created_at AS createdAt
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .bind(await digestHex(token), new Date().toISOString())
    .first<ChatIdentity & { createdAt: string }>();
  return row ?? null;
}

async function getGroup(
  db: D1Database,
  groupId: string,
  userId: string | null,
): Promise<Record<string, unknown> | null> {
  return db
    .prepare(
      `SELECT groups.id, groups.name, groups.description, groups.category,
              groups.active_count AS activeCount,
              (SELECT COUNT(*) FROM group_members WHERE group_id = groups.id) AS memberCount,
              CASE WHEN ? IS NOT NULL AND EXISTS (
                SELECT 1 FROM group_members
                WHERE group_id = groups.id AND user_id = ?
              ) THEN 1 ELSE 0 END AS isMember,
              (SELECT content FROM messages WHERE group_id = groups.id
               ORDER BY created_at DESC LIMIT 1) AS lastMessage,
              groups.created_at AS createdAt
       FROM groups WHERE groups.id = ?`,
    )
    .bind(userId, userId, groupId)
    .first();
}

function toGroup(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    memberCount: Number(row.memberCount ?? 0),
    activeCount: Number(row.activeCount ?? 0),
    isMember: Number(row.isMember ?? 0) === 1,
    lastMessage: row.lastMessage ?? null,
  };
}

async function requireMember(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS member FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(groupId, userId)
    .first();
  return Boolean(row);
}

function normalizedApiPath(pathname: string): string {
  let path = pathname;
  for (const prefix of ["/guild-api", "/api"]) {
    if (path === prefix) {
      path = "/";
    } else if (path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length);
    }
  }
  return path;
}

async function handleApi(
  request: Request,
  env: WorkerEnv,
  context: WorkerExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizedApiPath(url.pathname);
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/healthz") {
    return json({ status: "ok" });
  }

  if (method === "POST" && path === "/auth/signup") {
    const body = await readJson(request);
    if (!body) return error("A valid JSON body is required.", 400);
    const handle = normalizeHandle(body.handle);
    const displayName = asString(body.displayName, 40);
    const password = body.password;
    if (!handle) {
      return error("Use 3–24 letters, numbers, or underscores for your handle.", 400);
    }
    if (!displayName) return error("Display name is required (up to 40 characters).", 400);
    if (typeof password !== "string" || !PASSWORD_PATTERN.test(password)) {
      return error(
        "Use at least 12 characters with an uppercase letter, lowercase letter, number, and symbol.",
        400,
      );
    }

    const userId = crypto.randomUUID();
    const salt = randomHex(16);
    const passwordHash = await hashPassword(password, salt);
    const createdAt = new Date().toISOString();
    try {
      await env.DB.prepare(
        `INSERT INTO users (id, handle, display_name, password_salt, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(userId, handle, displayName, salt, passwordHash, createdAt)
        .run();
    } catch (cause) {
      if (cause instanceof Error && /unique|constraint/i.test(cause.message)) {
        return error("That handle is already in use. Try another one.", 409);
      }
      throw cause;
    }

    const session = await issueSession(env.DB, userId);
    return json(
      {
        user: { id: userId, handle, displayName, createdAt },
      },
      201,
      { "Set-Cookie": sessionCookie(session.token) },
    );
  }

  if (method === "POST" && path === "/auth/login") {
    const body = await readJson(request);
    if (!body) return error("A valid JSON body is required.", 400);
    const handle = normalizeHandle(body.handle);
    if (!handle || typeof body.password !== "string" || body.password.length > 128) {
      return error("Handle or password is incorrect.", 401);
    }
    const row = await env.DB.prepare(
      `SELECT id, handle, display_name AS displayName, password_salt AS passwordSalt,
              password_hash AS passwordHash, created_at AS createdAt
       FROM users WHERE handle = ?`,
    )
      .bind(handle)
      .first<{
        id: string;
        handle: string;
        displayName: string;
        passwordSalt: string;
        passwordHash: string;
        createdAt: string;
      }>();
    const salt = row?.passwordSalt ?? "00000000000000000000000000000000";
    const actualHash = await hashPassword(body.password, salt);
    if (!row || !constantTimeEqual(actualHash, row.passwordHash)) {
      return error("Handle or password is incorrect.", 401);
    }
    const session = await issueSession(env.DB, row.id);
    return json(
      {
        user: {
          id: row.id,
          handle: row.handle,
          displayName: row.displayName,
          createdAt: row.createdAt,
        },
      },
      200,
      { "Set-Cookie": sessionCookie(session.token) },
    );
  }

  if (method === "POST" && path === "/auth/logout") {
    const token = cookieToken(request);
    if (token) {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await digestHex(token))
        .run();
    }
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }

  if (method === "GET" && path === "/auth/me") {
    const user = await getIdentity(request, env.DB);
    if (!user) return error("Sign in to continue.", 401);
    return json({
      id: user.userId,
      handle: user.handle,
      displayName: user.displayName,
      createdAt: user.createdAt,
    });
  }

  if (method === "GET" && path === "/community/summary") {
    const summary = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM groups) AS groupCount,
         (SELECT COUNT(*) FROM group_members) AS memberCount,
         (SELECT COUNT(*) FROM groups WHERE active_count > 0) AS activeGroupCount`,
    ).first<Record<string, unknown>>();
    return json({
      groupCount: Number(summary?.groupCount ?? 0),
      memberCount: Number(summary?.memberCount ?? 0),
      activeGroupCount: Number(summary?.activeGroupCount ?? 0),
    });
  }

  if (method === "GET" && path === "/groups/discover") {
    const user = await getIdentity(request, env.DB);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80);
    const pattern = `%${search}%`;
    const result = await env.DB.prepare(
      `SELECT groups.id, groups.name, groups.description, groups.category,
              groups.active_count AS activeCount,
              (SELECT COUNT(*) FROM group_members WHERE group_id = groups.id) AS memberCount,
              CASE WHEN ? IS NOT NULL AND EXISTS (
                SELECT 1 FROM group_members
                WHERE group_id = groups.id AND user_id = ?
              ) THEN 1 ELSE 0 END AS isMember,
              (SELECT content FROM messages WHERE group_id = groups.id
               ORDER BY created_at DESC LIMIT 1) AS lastMessage,
              groups.created_at AS createdAt
       FROM groups
       WHERE ? = '' OR groups.name LIKE ? COLLATE NOCASE
          OR groups.description LIKE ? COLLATE NOCASE
          OR groups.category LIKE ? COLLATE NOCASE
       ORDER BY memberCount DESC, activeCount DESC, groups.created_at DESC
       LIMIT 60`,
    )
      .bind(user?.userId ?? null, user?.userId ?? null, search, pattern, pattern, pattern)
      .all<Record<string, unknown>>();
    return json((result.results ?? []).map(toGroup));
  }

  if (method === "GET" && path === "/groups/mine") {
    const user = await getIdentity(request, env.DB);
    if (!user) return error("Sign in to continue.", 401);
    const result = await env.DB.prepare(
      `SELECT groups.id, groups.name, groups.description, groups.category,
              groups.active_count AS activeCount,
              (SELECT COUNT(*) FROM group_members WHERE group_id = groups.id) AS memberCount,
              1 AS isMember,
              (SELECT content FROM messages WHERE group_id = groups.id
               ORDER BY created_at DESC LIMIT 1) AS lastMessage,
              groups.created_at AS createdAt
       FROM groups
       JOIN group_members ON group_members.group_id = groups.id
       WHERE group_members.user_id = ?
       ORDER BY groups.created_at DESC`,
    )
      .bind(user.userId)
      .all<Record<string, unknown>>();
    return json((result.results ?? []).map(toGroup));
  }

  if (method === "POST" && path === "/groups") {
    const user = await getIdentity(request, env.DB);
    if (!user) return error("Sign in to create a group.", 401);
    const body = await readJson(request);
    if (!body) return error("A valid JSON body is required.", 400);
    const name = asString(body.name, 48);
    const description = asString(body.description, 180);
    const category = asString(body.category, 32);
    if (!name || name.length < 2) return error("Group name must be 2–48 characters.", 400);
    if (!description) return error("Add a short group description.", 400);
    if (!category) return error("Choose a group category.", 400);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO groups (id, name, description, category, owner_id, created_at, active_count)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      ).bind(id, name, description, category, user.userId, createdAt),
      env.DB.prepare(
        "INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)",
      ).bind(id, user.userId, createdAt),
    ]);
    const group = await getGroup(env.DB, id, user.userId);
    return json(group ? toGroup(group) : {}, 201);
  }

  if (method === "POST" && path === "/groups/join") {
    const user = await getIdentity(request, env.DB);
    if (!user) return error("Sign in to join a group.", 401);
    const body = await readJson(request);
    const groupId = asString(body?.groupId, 64);
    if (!groupId) return error("A valid group is required.", 400);
    const groupExists = await env.DB.prepare("SELECT id FROM groups WHERE id = ?")
      .bind(groupId)
      .first();
    if (!groupExists) return error("Group not found.", 404);
    await env.DB.prepare(
      "INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    )
      .bind(groupId, user.userId, new Date().toISOString())
      .run();
    const group = await getGroup(env.DB, groupId, user.userId);
    return json(group ? toGroup(group) : {}, 200);
  }

  if (method === "GET" && path === "/groups/messages") {
    const user = await getIdentity(request, env.DB);
    if (!user) return error("Sign in to read group chat.", 401);
    const groupId = url.searchParams.get("groupId");
    if (!groupId || groupId.length > 64) return error("A valid group is required.", 400);
    const groupExists = await env.DB.prepare("SELECT id FROM groups WHERE id = ?")
      .bind(groupId)
      .first();
    if (!groupExists) return error("Group not found.", 404);
    if (!(await requireMember(env.DB, groupId, user.userId))) {
      return error("Join this group to read its chat.", 401);
    }
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
      : 50;
    const result = await env.DB.prepare(
      `SELECT messages.id, messages.group_id AS groupId, messages.user_id AS userId,
              users.handle, users.display_name AS displayName,
              messages.content, messages.created_at AS createdAt
       FROM messages
       JOIN users ON users.id = messages.user_id
       WHERE messages.group_id = ?
       ORDER BY messages.created_at DESC
       LIMIT ?`,
    )
      .bind(groupId, limit)
      .all<Record<string, unknown>>();
    return json((result.results ?? []).reverse());
  }

  if (method === "POST" && path === "/groups/messages") {
    const user = await getIdentity(request, env.DB);
    if (!user) return error("Sign in to send a message.", 401);
    const body = await readJson(request);
    const groupId = asString(body?.groupId, 64);
    const content = asString(body?.content, 2000);
    if (!groupId || !content) return error("Write a message before sending.", 400);
    if (!(await requireMember(env.DB, groupId, user.userId))) {
      return error("Join this group to send messages.", 401);
    }
    const message = {
      id: crypto.randomUUID(),
      groupId,
      userId: user.userId,
      handle: user.handle,
      displayName: user.displayName,
      content,
      createdAt: new Date().toISOString(),
    };
    await env.DB.prepare(
      "INSERT INTO messages (id, group_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(message.id, groupId, user.userId, content, message.createdAt)
      .run();

    const namespaceId = env.CHAT_ROOMS.idFromName(groupId);
    const stub = env.CHAT_ROOMS.get(namespaceId);
    context.waitUntil(
      stub.fetch(
        new Request("https://chat-room/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message),
        }),
      ),
    );
    return json(message, 201);
  }

  if (method === "GET" && path === "/groups/ws") {
    const user = await getIdentity(request, env.DB);
    if (!user) return error("Sign in to join group chat.", 401);
    const groupId = url.searchParams.get("groupId");
    if (!groupId || groupId.length > 64) return error("A valid group is required.", 400);
    if (!(await requireMember(env.DB, groupId, user.userId))) {
      return error("Join this group to open its chat.", 401);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return error("A WebSocket upgrade is required.", 426);
    }
    const stub = env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(groupId));
    const connectUrl = new URL("https://chat-room/connect");
    connectUrl.searchParams.set("userId", user.userId);
    connectUrl.searchParams.set("handle", user.handle);
    connectUrl.searchParams.set("displayName", user.displayName);
    connectUrl.searchParams.set("groupId", groupId);
    return stub.fetch(new Request(connectUrl, request));
  }

  return error("Not found.", 404);
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    context: WorkerExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/guild-api" ||
      pathname.startsWith("/guild-api/")
    ) {
      return handleApi(request, env, context);
    }
    return env.ASSETS.fetch(request);
  },
};

export class GroupChatRoom {
  private readonly state: DurableObjectState;
  private readonly env: WorkerEnv;

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const payload = await request.text();
      this.broadcast(payload);
      return new Response(null, { status: 204 });
    }
    if (url.pathname !== "/connect") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const userId = url.searchParams.get("userId");
    const handle = url.searchParams.get("handle");
    const displayName = url.searchParams.get("displayName");
    const groupId = url.searchParams.get("groupId");
    if (!userId || !handle || !displayName || !groupId) {
      return new Response("Invalid chat identity", { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    await this.state.storage.put("groupId", groupId);
    server.serializeAttachment({ userId, handle, displayName, groupId } satisfies ChatIdentity);
    this.state.acceptWebSocket(server);
    await this.syncPresence(groupId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 4096) return;
    let body: unknown;
    try {
      body = JSON.parse(message);
    } catch {
      return;
    }
    if (body === null || typeof body !== "object") return;
    const content = (body as { content?: unknown }).content;
    if (typeof content !== "string" || content.trim().length === 0 || content.length > 2000) {
      socket.send(JSON.stringify({ type: "error", message: "Messages must be 1–2000 characters." }));
      return;
    }
    const identity = socket.deserializeAttachment<ChatIdentity>();
    if (!identity) return;
    const member = await this.env.DB.prepare(
      "SELECT 1 AS member FROM group_members WHERE group_id = ? AND user_id = ?",
    )
      .bind(identity.groupId, identity.userId)
      .first();
    if (!member) {
      socket.close(1008, "You are no longer a member of this group.");
      return;
    }
    const chatMessage = {
      id: crypto.randomUUID(),
      groupId: identity.groupId,
      userId: identity.userId,
      handle: identity.handle,
      displayName: identity.displayName,
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };
    await this.env.DB.prepare(
      "INSERT INTO messages (id, group_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        chatMessage.id,
        chatMessage.groupId,
        chatMessage.userId,
        chatMessage.content,
        chatMessage.createdAt,
      )
      .run();
    this.broadcast(JSON.stringify({ type: "message", message: chatMessage }));
  }

  async webSocketClose(socket: WebSocket, _code: number, _reason: string): Promise<void> {
    const identity = socket.deserializeAttachment<ChatIdentity>();
    if (identity) await this.syncPresence(identity.groupId, socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const identity = socket.deserializeAttachment<ChatIdentity>();
    if (identity) await this.syncPresence(identity.groupId, socket);
  }

  private broadcast(payload: string): void {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Unable to deliver message");
      }
    }
  }

  private async syncPresence(groupId: string, closedSocket?: WebSocket): Promise<void> {
    const sockets = this.state.getWebSockets().filter((socket) => socket !== closedSocket);
    const activeUserIds = new Set<string>();
    for (const socket of sockets) {
      const identity = socket.deserializeAttachment<ChatIdentity>();
      if (identity) activeUserIds.add(identity.userId);
    }
    await this.env.DB.prepare("UPDATE groups SET active_count = ? WHERE id = ?")
      .bind(activeUserIds.size, groupId)
      .run();
  }
}