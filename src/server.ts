import { createServer, type Server } from "node:http";
import { confirmFact, forgetFact, type Deps } from "./watch.ts";
import { renderPage } from "./page.ts";

// Local review page. Reads the ledger only; writes go through the same verified confirm/forget paths the watch loop uses.
export function startServer(d: Deps, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = (req.headers.host ?? "").split(":")[0];
    if (host !== "127.0.0.1" && host !== "localhost") {
      res.writeHead(403).end("local only");
      return;
    }
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(renderPage(d.ledger.all()));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/receipts") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(d.ledger.all()));
        return;
      }
      const m = /^\/api\/facts\/(\d+)\/(confirm|forget)$/.exec(url.pathname);
      if (req.method === "POST" && m) {
        if (req.headers["x-receipts"] !== "1") {
          res.writeHead(403).end("missing x-receipts header");
          return;
        }
        const id = Number(m[1]);
        if (!d.ledger.get(id)) {
          res.writeHead(404).end(`no receipt for fact ${id}`);
          return;
        }
        const ok = m[2] === "confirm" ? await confirmFact(d, id) : await forgetFact(d, id);
        res.writeHead(ok ? 200 : 502).end(ok ? "ok" : "Bee accepted the write but the read-back disagrees");
        return;
      }
      res.writeHead(404).end("not found");
    } catch (e) {
      res.writeHead(500).end(e instanceof Error ? e.message : String(e));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
