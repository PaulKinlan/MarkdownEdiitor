// Element-scoped view transitions (Chrome 147): animate a change inside one
// part of the page (the side panel, the editor) without freezing the rest, as
// a document-wide transition would.

/**
 * Runs `update` inside a view transition scoped to `scope`, if the browser has
 * them and the author hasn't asked for less motion; otherwise just runs it.
 * Resolves once `update` has run, so callers can rely on its effects.
 */
export async function scopedTransition(scope: Element | null | undefined, update: () => unknown): Promise<void> {
  if (!scope?.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await update();
    return;
  }
  try {
    await scope.startViewTransition(async () => void (await update())).updateCallbackDone;
  } catch {
    // A transition that is skipped or interrupted still ran (or will run) the update; nothing to recover.
  }
}
