/// <reference types="vite/client" />
// Finds the modules in src/modules by folder (no list to edit) and starts them.

import type { Contributions, ModuleDefinition, Shell } from "./modules";

const MODULES = import.meta.glob<ModuleDefinition>("../modules/*/module.ts", { eager: true, import: "default" });

/** Every module in src/modules, in `order`. */
export function modules(): ModuleDefinition[] {
  return Object.values(MODULES).sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id));
}

/** Activates every module; returns a function that deactivates them. */
export function activateModules(contributions: Contributions, shell: Shell): () => void {
  const stops = modules().map((m) => {
    try {
      return m.activate(contributions.context(shell));
    } catch (e) {
      console.error(`Module ${m.id} failed to start`, e);
      return undefined;
    }
  });
  return () => stops.forEach((stop) => stop?.());
}
