import { createServer, type Server } from "node:http";
import { confirmFact, forgetFact, type Deps } from "./watch.ts";
import { hero, renderPage, slip, tape } from "./page.ts";
import { buildDemo } from "./demo.ts";

// Local review page. Reads the ledger only; writes go through the same verified confirm/forget paths the watch loop uses.
// feedMs: how often the live feed re-reads the ledger. The ledger is a SQLite file the watch loop may write from another process,
// so the feed polls it instead of relying on in-process events.
// /demo/* serves a sample account (src/demo.ts) through the same page and the same verified write paths, in its own in-memory ledger.
export function startServer(d0: Deps, port: number, opts: { feedMs?: number; demoOnly?: boolean } = {}): Promise<Server> {
  let demo: Promise<Deps> | null = null;
  const server = createServer(async (req, res) => {
    let d = d0;
    let base = "";
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = (req.headers.host ?? "").split(":")[0];
    if (host !== "127.0.0.1" && host !== "localhost") {
      res.writeHead(403).end("local only");
      return;
    }
    try {
      let path = url.pathname;
      if (opts.demoOnly && path === "/") {
        res.writeHead(302, { location: "/demo" }).end();
        return;
      }
      if (path === "/demo" || path.startsWith("/demo/")) {
        if (req.method === "POST" && path === "/demo/api/reset") {
          if (req.headers["x-receipts"] !== "1") { res.writeHead(403).end("missing x-receipts header"); return; }
          demo = buildDemo();
          await demo;
          res.writeHead(200).end("ok");
          return;
        }
        d = await (demo ??= buildDemo());
        base = "/demo";
        path = path.slice(5) || "/";
      }
      if (req.method === "GET" && path === "/") {
        const rows = base ? [...d.ledger.all()].sort((a, b) => a.factId - b.factId) : d.ledger.all();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(renderPage(rows, { rev: d.ledger.maxRev(), base }));
        return;
      }
      if (req.method === "GET" && path === "/api/receipts") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(d.ledger.all()));
        return;
      }
      if (req.method === "GET" && path === "/api/feed") {
        // EventSource resends the last event id on reconnect, so a dropped connection replays what it missed.
        const resumed = Number(req.headers["last-event-id"]);
        let last = Number.isFinite(resumed) && resumed > 0 ? resumed : Number(url.searchParams.get("after") ?? d.ledger.maxRev());
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write("retry: 2000\n\n");
        let beats = 0;
        const timer = setInterval(() => {
          try {
            const changed = d.ledger.since(last);
            if (changed.length > 0) {
              const all = d.ledger.all();
              for (const r of changed) {
                res.write(`id: ${r.rev}\nevent: receipt\ndata: ${JSON.stringify({ rev: r.rev, factId: r.factId, factText: r.factText, verdict: r.verdict, quote: r.quote, searched: r.searched, decision: r.decision, slip: slip(r), tape: tape(all), hero: hero(all) })}\n\n`);
                last = r.rev;
              }
            } else if (++beats % 15 === 0) res.write(": keepalive\n\n");
          } catch (e) {
            res.write(`event: feed-error\ndata: ${JSON.stringify(e instanceof Error ? e.message : String(e))}\n\n`);
          }
        }, opts.feedMs ?? 1000);
        req.on("close", () => clearInterval(timer));
        return;
      }
      const m = /^\/api\/facts\/(\d+)\/(confirm|forget)$/.exec(path);
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
