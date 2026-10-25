import type { Env } from "./env";

export interface RouteContext {
  request: Request;
  url: URL;
  env: Env;
  /** The pattern's match: groups are the path's parameters. */
  match: RegExpMatchArray;
}

/**
 * One /api endpoint. Each file in worker/routes exports a list of these as
 * its default export; scripts/registries.mjs collects the files, so a new
 * endpoint never edits worker/index.ts.
 */
export interface Route {
  /** Methods it answers; any method when left out. */
  method?: string | string[];
  /** Matched against the path (decoded first when `decode` is set). Anchor it with ^ and $. */
  pattern: RegExp;
  decode?: boolean;
  /** Answered without the editor token (health checks, browser reports). */
  public?: boolean;
  handle(context: RouteContext): Response | Promise<Response>;
}

export function defineRoutes(...routes: Route[]): Route[] {
  return routes;
}

/** The route for a request, with its match; undefined when nothing matches. */
export function findRoute(routes: readonly Route[], request: Request, url: URL): { route: Route; match: RegExpMatchArray } | undefined {
  let decoded: string | undefined;
  for (const route of routes) {
    const methods = route.method === undefined ? undefined : ([] as string[]).concat(route.method);
    if (methods && !methods.includes(request.method)) continue;
    let path = url.pathname;
    if (route.decode) {
      try {
        path = decoded ??= decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    }
    const match = path.match(route.pattern);
    if (match) return { route, match };
  }
  return undefined;
}
