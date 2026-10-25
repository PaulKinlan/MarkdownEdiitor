// Autosave: saves the post after you stop typing, or on a timer.

export const manifest = {
  id: "autosave",
  name: "Autosave",
  description: "Saves the post a few seconds after you stop typing, or every few minutes. Pick when with the Autosave command.",
  version: "1.0.0",
  permissions: ["post:read", "post:write", "ui"],
  enabledByDefault: false,
};

const MODES = [
  { label: "2 seconds after I stop typing", idle: 2 },
  { label: "5 seconds after I stop typing", idle: 5 },
  { label: "30 seconds after I stop typing", idle: 30 },
  { label: "Every minute", every: 60 },
  { label: "Every 5 minutes", every: 300 },
  { label: "Off", off: true },
];

export default async function (editor) {
  const status = editor.ui.status("autosave", "");
  const saved = await editor.storage.get("mode");
  let mode = MODES.find((m) => m.label === saved) ?? MODES[1];
  let idleTimer;
  let everyTimer;

  const save = async () => {
    const post = await editor.document.read();
    if (post?.unsaved) await editor.document.save();
  };

  const apply = () => {
    clearTimeout(idleTimer);
    clearInterval(everyTimer);
    if (mode.every) everyTimer = setInterval(save, mode.every * 1000);
    status.set(mode.off ? "" : "Autosave", `Autosave: ${mode.label.toLowerCase()}`);
  };

  editor.on("post:change", (post) => {
    if (!mode.idle || !post.unsaved) return;
    clearTimeout(idleTimer);
    // post:change already waits about 300 ms after the last keystroke.
    idleTimer = setTimeout(save, Math.max(0, mode.idle * 1000 - 300));
  });
  editor.on("post:close", () => clearTimeout(idleTimer));

  editor.registerCommand({
    id: "settings",
    title: "Autosave…",
    run: async () => {
      const choice = await editor.ui.pick("Save automatically", MODES.map((m) => (m === mode ? `${m.label} (current)` : m.label)));
      const next = MODES.find((m) => choice === m.label || choice === `${m.label} (current)`);
      if (!next) return;
      mode = next;
      await editor.storage.set("mode", mode.label);
      apply();
    },
  });
  apply();
}
