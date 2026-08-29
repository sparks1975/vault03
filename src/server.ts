import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
function isClientDisconnect(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause;
  return (
    error.message === "aborted" ||
    (cause instanceof Error &&
      (cause.message === "aborted" || ("code" in cause && cause.code === "ECONNRESET")))
  );
}

function clientClosedResponse(): Response {
  return new Response(null, { status: 499, statusText: "Client Closed Request" });
}

async function normalizeCatastrophicSsrResponse(
  response: Response,
  requestSignal: AbortSignal,
): Promise<Response> {
  // TanStack Start currently turns a disconnected client into h3's generic
  // unhandled 500. Treat it as the expected closed request instead of
  // generating an error page for a document the client is no longer reading.
  if (requestSignal.aborted) return clientClosedResponse();
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, request.signal);
    } catch (error) {
      if (request.signal.aborted || isClientDisconnect(error)) {
        return clientClosedResponse();
      }
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
