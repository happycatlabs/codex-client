import { describe, expect, test } from "bun:test";
import { CodexClient } from "../client";
import type { JsonRpcRequest } from "../types";
import { WebSocketTransport } from "../websocket-transport";

type ServerSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type TestServer = {
  url: string;
  messages: string[];
  close(): void;
};

function startWebSocketServer(
  onMessage: (socket: ServerSocket, message: string) => void,
  onOpen?: (socket: ServerSocket) => void,
): TestServer {
  const messages: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) {
        return undefined;
      }

      return new Response("upgrade required", { status: 426 });
    },
    websocket: {
      open(socket) {
        onOpen?.(socket);
      },
      message(socket, message) {
        const raw = messageToString(message);
        messages.push(raw);
        onMessage(socket, raw);
      },
    },
  });

  return {
    url: `ws://${server.hostname}:${server.port}`,
    messages,
    close() {
      server.stop(true);
    },
  };
}

describe("WebSocketTransport", () => {
  test("request resolves successful responses", async () => {
    const server = startWebSocketServer((socket, message) => {
      const request = JSON.parse(message) as JsonRpcRequest;
      socket.send(JSON.stringify({ id: request.id, result: { ok: true } }));
    });
    const transport = new WebSocketTransport(server.url);

    try {
      await expect(transport.request("ping")).resolves.toEqual({ ok: true });
    } finally {
      await transport.close();
      server.close();
    }
  });

  test("request rejects error responses", async () => {
    const server = startWebSocketServer((socket, message) => {
      const request = JSON.parse(message) as JsonRpcRequest;
      socket.send(JSON.stringify({ id: request.id, error: { code: -32603, message: "boom" } }));
    });
    const transport = new WebSocketTransport(server.url);

    try {
      await expect(transport.request("explode")).rejects.toThrow("-32603: boom");
    } finally {
      await transport.close();
      server.close();
    }
  });

  test("malformed messages emit transport errors", async () => {
    const server = startWebSocketServer((socket) => {
      socket.send("not-json");
    });
    const transport = new WebSocketTransport(server.url);
    const error = new Promise<Error>((resolve) => {
      transport.onError(resolve);
    });
    const pending = transport.request("bad-message", undefined, 1_000);

    try {
      await expect(error).resolves.toThrow("Failed to parse JSON-RPC message");
      await transport.close();
      await expect(pending).rejects.toThrow("transport closed");
    } finally {
      server.close();
    }
  });

  test("request rejects on timeout", async () => {
    const server = startWebSocketServer(() => {});
    const transport = new WebSocketTransport(server.url);

    try {
      await expect(transport.request("slow", undefined, 10)).rejects.toThrow("Request timed out for method slow");
    } finally {
      await transport.close();
      server.close();
    }
  });

  test("request rejects when the socket closes", async () => {
    const server = startWebSocketServer((socket) => {
      socket.close(1000, "done");
    });
    const transport = new WebSocketTransport(server.url);

    try {
      await expect(transport.request("close", undefined, 1_000)).rejects.toThrow("websocket closed");
    } finally {
      await transport.close();
      server.close();
    }
  });

  test("CodexClient completes initialize over WebSocketTransport", async () => {
    const methods: string[] = [];
    const server = startWebSocketServer((socket, message) => {
      const request = JSON.parse(message) as Partial<JsonRpcRequest>;

      if (typeof request.method === "string") {
        methods.push(request.method);
      }

      if (request.method === "initialize") {
        socket.send(JSON.stringify({ id: request.id, result: { userAgent: "test-server" } }));
      }
    });
    const client = new CodexClient({
      transportFactory: () => new WebSocketTransport(server.url),
    });

    try {
      await client.connect();
      await waitFor(() => methods.includes("initialized"));
      expect(methods).toEqual(["initialize", "initialized"]);
    } finally {
      await client.disconnect();
      server.close();
    }
  });
});

function messageToString(message: string | Uint8Array): string {
  if (typeof message === "string") {
    return message;
  }

  return new TextDecoder().decode(message);
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1_000) {
    if (assertion()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("timed out waiting for assertion");
}
