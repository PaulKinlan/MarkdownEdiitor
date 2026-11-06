// Saving, removing and syncing custom quick edits. Kept out of ./actions so
// it loads with the Assistant panel rather than at boot.
import type { AgentSettings } from "./agent-client";
import { CUSTOM_ACTIONS_EVENT, KEY, loadCustomActions, readJson, type EditAction } from "./actions";
import { pushEntry, syncEntries, type SyncedEntries } from "./synced";

const FEATURE = "custom-edits";
/** Removed custom edits by id, with when, so the removal reaches other browsers. */
const DELETED_KEY = "md-editor:custom-actions:deleted";

function writeLocal(actions: EditAction[], deleted: Record<string, number>) {
  localStorage.setItem(KEY, JSON.stringify(actions.filter((a) => !a.builtin)));
  localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
  window.dispatchEvent(new Event(CUSTOM_ACTIONS_EVENT));
}

/** Adds or replaces a custom edit, and uploads it when a server is given. */
export function putCustomAction(action: EditAction, settings?: AgentSettings): EditAction[] {
  const saved = { ...action, updatedAt: Date.now() };
  const actions = [...loadCustomActions().filter((a) => a.id !== action.id), saved];
  const deleted = readJson<Record<string, number>>(DELETED_KEY, {});
  delete deleted[action.id];
  writeLocal(actions, deleted);
  if (settings) void pushEntry(settings, FEATURE, action.id, { value: saved, updatedAt: saved.updatedAt }).catch(() => undefined);
  return actions;
}

/** Removes a custom edit here and, when a server is given, everywhere. */
export function removeCustomAction(id: string, settings?: AgentSettings): EditAction[] {
  const actions = loadCustomActions().filter((a) => a.id !== id);
  const at = Date.now();
  writeLocal(actions, { ...readJson<Record<string, number>>(DELETED_KEY, {}), [id]: at });
  if (settings) void pushEntry(settings, FEATURE, id, { deleted: true, updatedAt: at }).catch(() => undefined);
  return actions;
}

/** Merges this browser's custom edits with the server's. Returns true if anything here changed. */
export async function syncCustomActions(settings: AgentSettings): Promise<boolean> {
  const local = localEntries();
  const newer = await syncEntries(settings, FEATURE, local);
  // Merge into what's here now, not the snapshot: an edit saved during the sync wins if it's newer.
  const now = localEntries();
  let changed = false;
  for (const [id, theirs] of Object.entries(newer)) {
    if ((now[id]?.updatedAt ?? -1) >= theirs.updatedAt) continue;
    now[id] = theirs;
    changed = true;
  }
  if (!changed) return false;
  const actions: EditAction[] = [];
  const deleted: Record<string, number> = {};
  for (const [id, e] of Object.entries(now)) {
    if (e.deleted || !e.value) deleted[id] = e.updatedAt;
    else actions.push({ ...e.value, id, updatedAt: e.updatedAt });
  }
  writeLocal(actions, deleted);
  return true;
}

function localEntries(): SyncedEntries<EditAction> {
  const local: SyncedEntries<EditAction> = {};
  for (const [id, at] of Object.entries(readJson<Record<string, number>>(DELETED_KEY, {}))) local[id] = { deleted: true, updatedAt: at };
  // Edits saved before syncing existed have no time; 0 uploads them without overriding anything newer.
  for (const a of loadCustomActions()) local[a.id] = { value: a, updatedAt: a.updatedAt ?? 0 };
  return local;
}
