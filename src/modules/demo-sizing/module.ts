import { defineModule } from "../../core/modules";
import { readText, walk } from "../../lib/fs";
import { addOptIn, makeShortcodeSelfSizing } from "./sizing";

const SHORTCODE = "layouts/shortcodes/iframe.html";

// Inline demos that size themselves (responsively-sized iframes, Chrome 154).
// One command opts the site's demo pages in and teaches its iframe shortcode
// to use their height, instead of a fixed height and a scrollbar.
export default defineModule({
  id: "demo-sizing",
  name: "Self-sizing demos",
  order: 45,
  activate({ shell, addCommands }) {
    const run = async () => {
      const { site } = shell;
      if (!site || !shell.ready) return;
      const template = await readText(site.handle, SHORTCODE);
      if (template === undefined) return shell.fail(`This site has no ${SHORTCODE}, so there's no iframe shortcode to update.`);
      const change = makeShortcodeSelfSizing(template);
      // Opted-in pages do nothing until the shortcode uses frame-sizing, so stop before writing anything.
      if (change.kind === "unsupported") return shell.fail(`Can't update ${SHORTCODE}: ${change.reason}. Add frame-sizing to it by hand, or ask the assistant.`);
      const shortcode = change.kind === "updated" ? change.text : undefined;
      const pages: { path: string; text: string }[] = [];
      for (const { path, handle } of await walk(site.handle, "static", (name) => /\.html?$/i.test(name))) {
        const text = addOptIn(await (await handle.getFile()).text());
        if (text !== undefined) pages.push({ path, text });
      }
      if (!shortcode && !pages.length) return shell.flash("Inline demos already size themselves.");
      const list = [...(shortcode ? [SHORTCODE] : []), ...pages.map((p) => p.path)];
      const shown = list.slice(0, 12).join("\n") + (list.length > 12 ? `\n…and ${list.length - 12} more` : "");
      if (!confirm(`Make inline demos take their content's height in Chrome 154 and later? This changes:\n\n${shown}\n\nOther browsers keep the height given in the shortcode.`)) return;
      // writeSiteFile writes to whichever site is open, so stop if the author switched sites meanwhile.
      const write = async (path: string, text: string) => {
        if (shell.site !== site) throw new Error("The site changed before every demo was updated. Run the command again.");
        await shell.writeSiteFile(path, text);
      };
      if (shortcode) await write(SHORTCODE, shortcode);
      for (const page of pages) await write(page.path, page.text);
      shell.flash(`Updated ${list.length} file${list.length === 1 ? "" : "s"}: local demos now size themselves in Chrome 154+.`);
    };
    addCommands(() =>
      shell.ready && shell.shortcodes.includes("iframe") ? [{ id: "demo-sizing", title: "Make inline demos size themselves", detail: "Responsive iframes", run: () => void run().catch((e) => shell.fail(`Couldn't update the inline demos: ${e instanceof Error ? e.message : String(e)}`)) }] : [],
    );
  },
});
