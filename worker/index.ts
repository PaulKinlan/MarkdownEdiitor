// The editor itself runs in the browser against local folders. The Worker
// serves the built app and is where the agent backend (Durable Objects) will
// live; for now it only answers a health check.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
