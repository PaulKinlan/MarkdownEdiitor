import { describe, expect, it } from "vitest";
import { fingerprint, parseReports, percentile, readLimited, redact, safeParse, severityOf, vitalSeverity } from "../worker/observability/ingest";

describe("parseReports", () => {
  it("reads a legacy CSP report", () => {
    const body = JSON.stringify({
      "csp-report": { "document-uri": "https://editor.example/?token=abc123", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js", disposition: "report" },
    });
    const [e] = parseReports(body, "application/csp-report");
    expect(e).toMatchObject({ type: "csp-violation", severity: "warn", route: "/", key: "script-src-elem https://evil.example" });
    expect(e.detail.disposition).toBe("report");
  });

  it("reads a Reporting API batch and the page's own events", () => {
    const body = JSON.stringify([
      { type: "deprecation", url: "https://editor.example/share?text=hi", body: { id: "UnloadHandler", message: "unload is deprecated" } },
      { type: "error", url: "https://editor.example/", body: { message: "x is undefined", sourceFile: "/assets/index.js", lineNumber: 3 } },
      { type: "web-vital", url: "https://editor.example/", body: { name: "LCP", value: 3100, target: "md-app" } },
      { type: "bad type!", url: "", body: {} },
    ]);
    const events = parseReports(body, "application/reports+json");
    expect(events.map((e) => [e.type, e.severity, e.route])).toEqual([
      ["deprecation", "info", "/share"],
      ["error", "error", "/"],
      ["web-vital", "warn", "/"],
    ]);
    expect(events[2].vital).toEqual({ name: "LCP", value: 3100 });
  });

  it("ignores bodies that aren't JSON", () => {
    expect(parseReports("not json", "application/json")).toEqual([]);
  });

  it("caps the number of events in one request", () => {
    const body = JSON.stringify(Array.from({ length: 80 }, () => ({ type: "error", url: "https://e.example/", body: {} })));
    expect(parseReports(body, "application/json")).toHaveLength(50);
  });
});

describe("safeParse", () => {
  it("drops prototype-polluting keys", () => {
    const parsed = safeParse('{"a":1,"__proto__":{"polluted":true},"b":{"constructor":{"x":1}}}') as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["a", "b"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed.b as object)).toEqual([]);
  });
});

describe("redact", () => {
  it("masks tokens and keys", () => {
    expect(redact("GET /api/x?token=s3cret&ok=1")).toBe("GET /api/x?token=[redacted]&ok=1");
    expect(redact("Authorization: Bearer abc.def-ghi")).toBe("Authorization: Bearer [redacted]");
    expect(redact("key sk-ant-0123456789abcdef in message")).toBe("key [redacted] in message");
  });

  it("is applied to report bodies", () => {
    const [e] = parseReports(JSON.stringify([{ type: "error", url: "https://e.example/", body: { message: "failed: ?key=hunter2" } }]), "application/json");
    expect(e.detail.message).toBe("failed: ?key=[redacted]");
  });
});

describe("severity", () => {
  it("bands report types", () => {
    expect(severityOf("crash")).toBe("error");
    expect(severityOf("permissions-policy-violation")).toBe("warn");
    expect(severityOf("intervention")).toBe("info");
    expect(severityOf("long-animation-frame", { duration: 300 })).toBe("warn");
  });

  it("uses Web Vitals thresholds", () => {
    expect(vitalSeverity("INP", 150)).toBe("info");
    expect(vitalSeverity("INP", 300)).toBe("warn");
    expect(vitalSeverity("CLS", 0.3)).toBe("error");
  });
});

describe("fingerprint", () => {
  it("is the same for the same problem and differs otherwise", async () => {
    const a = { type: "error", severity: "error" as const, route: "/", key: "x" };
    expect(await fingerprint(a)).toBe(await fingerprint({ ...a }));
    expect(await fingerprint(a)).not.toBe(await fingerprint({ ...a, route: "/share" }));
  });
});

describe("readLimited", () => {
  it("stops reading past the limit", async () => {
    const big = new Request("https://e.example/", { method: "POST", body: "x".repeat(100) });
    expect(await readLimited(big, 50)).toBeNull();
    const small = new Request("https://e.example/", { method: "POST", body: "hello" });
    expect(await readLimited(small, 50)).toBe("hello");
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 75)).toBe(8);
    expect(percentile(values, 99)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("review fixes", () => {
  it("drops objects nested past the redaction depth", () => {
    const body = { a: { b: { c: { d: { e: { message: "?token=hunter2" } } } } } };
    const [e] = parseReports(JSON.stringify([{ type: "error", url: "https://e.example/", body }]), "application/json");
    expect(JSON.stringify(e.detail)).not.toContain("hunter2");
    expect(JSON.stringify(e.detail)).toContain("[truncated]");
  });

  it("keeps the sending build's commit when it looks like one", () => {
    const body = JSON.stringify([
      { type: "error", url: "https://e.example/", body: {}, commit: "abc1234" },
      { type: "error", url: "https://e.example/", body: {}, commit: "not a commit" },
    ]);
    expect(parseReports(body, "application/json").map((e) => e.commit)).toEqual(["abc1234", undefined]);
  });
});
