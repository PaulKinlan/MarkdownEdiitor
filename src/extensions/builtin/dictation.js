// Dictation: speak into the post with the browser's speech recognition.

export const manifest = {
  id: "dictation",
  name: "Dictation",
  description: "Type by speaking: a Dictate button and command that insert what you say at the cursor (uses the browser's speech recognition).",
  version: "1.0.0",
  permissions: ["post:write", "ui", "microphone"],
};

/** Spoken punctuation, as most dictation software understands it. */
const SPOKEN = [
  [/\s*\b(full stop|period)\b/gi, "."],
  [/\s*\bcomma\b/gi, ","],
  [/\s*\bquestion mark\b/gi, "?"],
  [/\s*\bexclamation (mark|point)\b/gi, "!"],
  [/\s*\bnew paragraph\b\s*/gi, "\n\n"],
  [/\s*\bnew line\b\s*/gi, "\n"],
];

function tidy(text, first) {
  let out = text.trim();
  for (const [re, mark] of SPOKEN) out = out.replace(re, mark);
  if (first) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out.replace(/([.?!]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

export default function (editor) {
  const status = editor.ui.status("listening", "");
  let listening = false;
  let sentenceStart = true;

  const toggle = async () => {
    if (listening) return editor.speech.stop();
    try {
      await editor.speech.start();
      listening = true;
      sentenceStart = true;
      status.set("● Listening…", "Dictation is on. Press Dictate again to stop.");
    } catch (e) {
      editor.ui.notify(`Dictation isn't available here: ${e.message}`, "warning");
    }
  };

  editor.on("speech:result", async ({ text, final }) => {
    if (!final) return status.set(`● ${text.length > 50 ? `…${text.slice(-50)}` : text}`, "Dictation is on");
    const words = tidy(text, sentenceStart);
    if (!words) return;
    await editor.document.insert(`${words}${words.endsWith("\n") ? "" : " "}`);
    sentenceStart = /[.?!\n]\s*$/.test(words);
    status.set("● Listening…", "Dictation is on. Press Dictate again to stop.");
  });
  editor.on("speech:end", ({ error }) => {
    listening = false;
    status.set("");
    if (error && error !== "aborted" && error !== "no-speech") editor.ui.notify(`Dictation stopped: ${error}`, "warning");
  });

  editor.ui.toolbarButton({ id: "dictate", label: "🎤 Dictate", title: "Dictate (Mod-Shift-u)", run: toggle });
  editor.registerCommand({ id: "dictate", title: "Start or stop dictation", key: "Mod-Shift-u", run: toggle });
}
