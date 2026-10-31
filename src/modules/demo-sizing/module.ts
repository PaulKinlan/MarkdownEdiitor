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
      const shortcode = makeShortcodeSelfSizing(template);
      const pages: { path: string; text: string }[] = [];
      for (const { path, handle } of await walk(site.handle, "static", (name) => /\.html?$/i.test(name))) {
        const text = addOptIn(await (await handle.getFile()).text());
        if (text !== undefined) pages.push({ path, text });
      }
      if (!shortcode && !pages.length) return shell.flash("Inline demos already size themselves.");
      const list = [...(shortcode ? [SHORTCODE] : []), ...pages.map((p) => p.path)];
      const shown = list.slice(0, 12).join("\n") + (list.length > 12 ? `\n…and ${list.length - 12} more` : "");
      if (!confirm(`Make inline demos take their content's height in Chrome 154 and later? This changes:\n\n${shown}\n\nOther browsers keep the height given in the shortcode.`)) return;
      if (shortcode) await shell.writeSiteFile(SHORTCODE, shortcode);
      for (const page of pages) await shell.writeSiteFile(page.path, page.text);
      shell.flash(`Updated ${list.length} file${list.length === 1 ? "" : "s"}: local demos now size themselves in Chrome 154+.`);
    };
    addCommands(() =>
      shell.ready && shell.shortcodes.includes("iframe") ? [{ id: "demo-sizing", title: "Make inline demos size themselves", detail: "Responsive iframes", run: () => void run() }] : [],
    );
  },
});
