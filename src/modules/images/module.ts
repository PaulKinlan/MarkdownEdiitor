import { defineModule } from "../../core/modules";
import { exists, writeFile } from "../../lib/fs";
import { slugify } from "../../lib/slug";

// Dropped or pasted images: saved under static/images/<post slug>/ and
// inserted as a figure shortcode (or plain markdown without one).
export default defineModule({
  id: "images",
  name: "Images",
  order: 40,
  activate({ shell, onImageFiles }) {
    onImageFiles(async (files) => {
      const { open, site } = shell;
      if (!open || !site) return false;
      const slug = String(open.post.get("slug") || "") || open.summary.contentPath.split("/").pop()!.replace(/\.[^.]+$/, "");
      const dir = `images/${slugify(slug)}`;
      const snippets: string[] = [];
      for (const file of files) {
        const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? `.${file.type.split("/")[1] ?? "png"}`).toLowerCase();
        const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "image";
        // Pasted screenshots all arrive as image.png: never overwrite an existing file.
        let url = `/${dir}/${base}${ext}`;
        for (let n = 2; await exists(site.handle, `static${url}`); n++) url = `/${dir}/${base}-${n}${ext}`;
        await writeFile(site.handle, `static${url}`, file);
        snippets.push(shell.shortcodes.includes("figure") ? `{{< figure src="${url}" alt="" caption="" >}}` : `![](${url})`);
      }
      if (shell.open?.summary.path !== open.summary.path || shell.site !== site) {
        shell.flash(`Saved ${snippets.length} image(s) to static/${dir}/ (not inserted: another post is open now)`);
        return true;
      }
      shell.insert(snippets.join("\n\n"));
      shell.flash(`Saved ${snippets.length} image${snippets.length === 1 ? "" : "s"} to static/${dir}/`);
      return true;
    });
  },
});
