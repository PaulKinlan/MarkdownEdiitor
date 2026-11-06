import { describe, expect, it } from "vitest";
import worker from "../worker/index";
import { defineRoutes, findRoute } from "../worker/route";
import type { Env } from "../worker/env";

const stub = (calls: string[]) => ({
  idFromName: (name: string) => name,
  get: (id: string) =>
    new Proxy({}, { get: (_, method) => async (...args: unknown[]) => (calls.push(`${id}.${String(method)}(${JSON.stringify(args)})`), method === "get" ? null : { ok: true }) }),
});

function env(extra: Partial<Env> = {}, calls: string[] = []): Env {
  return { ASSETS: { fetch: async () => new Response("asset") }, FEATURE_STORE: stub(calls), EXTENSION_STORE: stub(calls), ...extra } as unknown as Env;
}

const call = (path: string, init: RequestInit = {}, e = env()) => worker.fetch(new Request(`https://editor.test${path}`, init), e);

describe("API routing", () => {
  it("matches method, pattern and decoded paths", () => {
    const routes = defineRoutes(
      { method: "GET", pattern: /^\/a$/, handle: () => new Response("get") },
      { pattern: /^\/b\/([\w:]+)$/, decode: true, handle: () => new Response("b") },
    );
    const req = (method: string, path: string) => [new Request(`https://x${path}`, { method }), new URL(`https://x${path}`)] as const;
    expect(findRoute(routes, ...req("GET", "/a"))?.route).toBe(routes[0]);
    expect(findRoute(routes, ...req("POST", "/a"))).toBeUndefined();
    expect(findRoute(routes, ...req("PUT", "/b/s%3Ap"))?.match[1]).toBe("s:p");
    expect(findRoute(routes, ...req("GET", "/b/%E0"))).toBeUndefined();
  });

  it("answers public routes without the token, and nothing else", async () => {
    const e = env({ EDITOR_TOKEN: "t", COMMIT: "abc" });
    expect(await (await call("/api/health", {}, e)).json()).toMatchObject({ ok: true, commit: "abc" });
    expect((await call("/api/extensions", {}, e)).status).toBe(401);
    expect((await call("/api/nope", {}, e)).status).toBe(401);
    expect((await call("/api/nope", { headers: { Authorization: "Bearer t" } }, e)).status).toBe(404);
    expect((await call("/api/health", { method: "POST" }, e)).status).toBe(200);
    expect((await call("/api/extensions", { method: "PATCH", headers: { Authorization: "Bearer t" } }, e)).status).toBe(404);
    expect(await (await call("/elsewhere", {}, e)).text()).toBe("asset");
  });

  it("adds the API headers", async () => {
    const res = await call("/api/health");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("stores feature values by feature, scope and key", async () => {
    const calls: string[] = [];
    const e = env({}, calls);
    expect((await call("/api/features/git/site-1/last%20commit", { method: "PUT", body: JSON.stringify({ sha: "1" }) }, e)).status).toBe(200);
    expect((await call("/api/features/git/site-1/last%20commit", {}, e)).status).toBe(404);
    await call("/api/features/git/site-1?prefix=last", {}, e);
    expect(calls).toEqual(['git:site-1.put(["last commit",{"sha":"1"}])', 'git:site-1.get(["last commit"])', 'git:site-1.list(["last"])']);
    expect((await call("/api/features/Bad/site-1", {}, e)).status).toBe(404);
    await call("/api/features/snippets/global/a?ifNewer=1", { method: "PUT", body: JSON.stringify({ updatedAt: 2 }) }, e);
    expect(calls.at(-1)).toBe('snippets:global.putIfNewer(["a",{"updatedAt":2}])');
  });
});
