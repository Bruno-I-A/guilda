import { createMcpHandler } from "@modelcontextprotocol/server";

import { authenticateMcpToken } from "@/lib/mcp/access";
import { createGuildaMcpServer } from "@/mcp/server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const WINDOW_MS = 60_000;
const validAttempts = new Map<string, { count: number; resetAt: number }>();
const invalidAttempts = new Map<string, { count: number; resetAt: number }>();

function jsonRpcError(status: number, message: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null },
    { status, headers: status === 401 ? { "WWW-Authenticate": 'Bearer realm="guilda"' } : undefined },
  );
}

function consume(map: Map<string, { count: number; resetAt: number }>, key: string, limit: number): boolean {
  const now = Date.now();
  if (map.size > 10_000) {
    for (const [storedKey, value] of map) {
      if (value.resetAt <= now) map.delete(storedKey);
    }
  }
  const current = map.get(key);
  if (!current || current.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function isBlocked(map: Map<string, { count: number; resetAt: number }>, key: string, limit: number): boolean {
  const current = map.get(key);
  if (!current || current.resetAt <= Date.now()) return false;
  return current.count >= limit;
}

async function boundedRequest(request: Request): Promise<Request | Response> {
  if (request.method !== "POST") return request;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return jsonRpcError(413, "Corpo da requisição excede o limite.");
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return jsonRpcError(413, "Corpo da requisição excede o limite.");
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}

async function handle(request: Request): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isBlocked(invalidAttempts, ip, 10)) {
    return jsonRpcError(429, "Muitas tentativas. Aguarde um minuto.");
  }
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) {
    if (!consume(invalidAttempts, ip, 10)) return jsonRpcError(429, "Muitas tentativas. Aguarde um minuto.");
    return jsonRpcError(401, "Chave MCP ausente ou inválida.");
  }

  const actor = await authenticateMcpToken(token);
  if (!actor) {
    if (!consume(invalidAttempts, ip, 10)) return jsonRpcError(429, "Muitas tentativas. Aguarde um minuto.");
    return jsonRpcError(401, "Chave MCP ausente ou inválida.");
  }
  if (!consume(validAttempts, actor.agentKeyId, 60)) {
    return jsonRpcError(429, "Limite de chamadas desta chave atingido. Aguarde um minuto.");
  }

  const bounded = await boundedRequest(request);
  if (bounded instanceof Response) return bounded;
  const handler = createMcpHandler(
    () => createGuildaMcpServer(actor),
    { legacy: "stateless", onerror: (error) => console.error("[guilda-mcp]", error.message) },
  );
  return handler.fetch(bounded, {
    authInfo: { token, clientId: actor.agentKeyId, scopes: actor.scopes },
  });
}

export { handle as GET, handle as POST, handle as DELETE };
