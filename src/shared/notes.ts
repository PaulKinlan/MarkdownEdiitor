// Research notes and post ideas live as markdown files in this folder at the
// site root. It is outside Hugo's content directory, so Hugo never publishes
// them, but they sit next to the posts and are versioned with git.

export const NOTES_DIR = "notes";

export const NOTE_STATUSES = ["idea", "researching", "ready", "drafted"] as const;

export function isNotePath(path: string): boolean {
  return path.startsWith(`${NOTES_DIR}/`);
}
