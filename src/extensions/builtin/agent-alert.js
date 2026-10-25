// Assistant alerts: a system notification when the assistant finishes while
// the editor is in the background.

export const manifest = {
  id: "agent-alert",
  name: "Assistant alerts",
  description: "Notifies you when the assistant finishes a reply while the editor is in the background.",
  version: "1.0.0",
  permissions: ["notifications"],
};

export default function (editor) {
  editor.on("agent:run-end", (run) => {
    const text = (run?.error ?? run?.text ?? "").replace(/\s+/g, " ").trim();
    const title = run?.error ? "The assistant stopped with an error" : "The assistant replied";
    void editor.ui.alert(title, text.length > 140 ? `${text.slice(0, 139)}…` : text || undefined);
  });
}
