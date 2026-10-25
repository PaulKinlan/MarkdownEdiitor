// Entry point of an extension's worker. See runtime.ts.
import { startRuntime } from "./runtime";
import type { Port } from "./messages";

startRuntime(self as unknown as Port, { lockNetwork: true });
