// Stands in for the Workers runtime module in unit tests (aliased in vite.config.ts).
export class DurableObject<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}
