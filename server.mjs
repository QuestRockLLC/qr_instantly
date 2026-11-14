#!/usr/bin/env node
/**
 * Lightweight local server (no Next compile). Use: node server.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReport } from "./lib/instantly.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3100);

function loadEnvFile(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

function loadEnvLocal() {
  loadEnvFile(join(__dir, ".env.local"));
  // Same OpenAI keys as Call Tracker (inboundnewprocess)
  loadEnvFile(join(__dir, "..", "inboundnewprocess", ".env.local"));
}

loadEnvLocal();

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript" };

function readPublic(file) {
  const p = join(__dir, "public", file);
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

let cache = { at: 0, data: null };
const TTL = 45_000;

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/api/report") {
    const token = process.env.REPORT_TOKEN;
    const got = url.searchParams.get("token") || req.headers["x-report-token"];
    if (token && got !== token && process.env.NODE_ENV === "production") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    try {
      if (!cache.data || Date.now() - cache.at > TTL) {
        cache = { at: Date.now(), data: await loadReport() };
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(cache.data));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }
  let file = url.pathname === "/" ? "dashboard.html" : url.pathname.replace(/^\//, "");
  if (file.includes("..")) {
    res.writeHead(400);
    res.end();
    return;
  }
  const body = readPublic(file);
  if (!body) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, { "Content-Type": (MIME[ext] || "text/plain") + "; charset=utf-8" });
  res.end(body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Instantly daily report: http://127.0.0.1:${PORT}`);
});