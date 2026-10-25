// Emoji: a picker that inserts an emoji at the cursor, recent ones first.

export const manifest = {
  id: "emoji",
  name: "Emoji",
  order: 150,
  description: "Insert an emoji from a picker (Mod-Shift-e), with your recent ones first.",
  version: "1.0.0",
  permissions: ["post:write", "ui"],
};

const EMOJI = `😀 grinning|😂 tears of joy|🙂 smile|😉 wink|😍 heart eyes|🤔 thinking|😅 sweat smile|😬 grimace|😢 cry|😮 surprised|🙄 eye roll|😎 cool|🥳 party|🤯 mind blown|🙏 thanks|👍 thumbs up|👎 thumbs down|👏 clap|🙌 hooray|👀 eyes|💪 strong|🤝 handshake|👋 wave|✌️ peace|❤️ heart|💔 broken heart|🔥 fire|✨ sparkles|⭐ star|🎉 tada|🎯 target|💡 idea|📌 pin|📎 paperclip|📝 memo|📚 books|📖 book|📈 chart up|📉 chart down|📊 bar chart|🗓️ calendar|⏰ alarm|⏳ hourglass|✅ check|❌ cross|⚠️ warning|❓ question|❗ exclamation|➡️ right arrow|⬅️ left arrow|⬆️ up arrow|⬇️ down arrow|🔗 link|🔒 lock|🔑 key|🛠️ tools|⚙️ gear|🐛 bug|🚀 rocket|💻 laptop|📱 phone|🖥️ desktop|⌨️ keyboard|🖱️ mouse|🌐 web|🤖 robot|🧠 brain|🧪 test tube|🔬 microscope|📦 package|🗑️ bin|☕ coffee|🍕 pizza|🎵 music|📷 camera|🎥 film|🌟 glowing star|🌈 rainbow|☀️ sun|🌧️ rain|❄️ snow|🌍 globe|🏆 trophy|🥇 gold medal|💯 hundred|➕ plus|➖ minus`.split("|");

export default function (editor) {
  const pick = async () => {
    const recent = (await editor.storage.get("recent")) ?? [];
    const items = [...recent.filter((r) => EMOJI.includes(r)), ...EMOJI.filter((e) => !recent.includes(e))].slice(0, 100);
    const choice = await editor.ui.pick("Insert emoji", items);
    if (!choice) return;
    await editor.document.insert(choice.split(" ")[0]);
    await editor.storage.set("recent", [choice, ...recent.filter((r) => r !== choice)].slice(0, 8));
  };
  editor.registerCommand({ id: "insert", title: "Insert emoji…", key: "Mod-Shift-e", run: pick });
}
