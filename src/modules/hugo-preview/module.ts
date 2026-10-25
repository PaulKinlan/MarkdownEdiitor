import { html } from "lit";
import { defineModule } from "../../core/modules";
import "./preview-pane";

// The post as the site's own `hugo server` renders it, in the side panel.
export default defineModule({
  id: "hugo-preview",
  name: "Hugo preview",
  order: 10,
  activate({ shell, addSideTab, addSettingsSection }) {
    addSideTab({
      id: "preview",
      title: "Preview",
      order: 10,
      icon: "eye",
      // Notes have no URL, so there's nothing to preview.
      available: () => !!shell.open?.summary.url,
      render: () => html`<preview-pane
        .origin=${shell.site!.previewOrigin}
        .path=${shell.open!.summary.url}
        .draft=${shell.open!.summary.draft}
        @origin-change=${(e: CustomEvent<{ origin: string }>) => void shell.updateSite({ previewOrigin: e.detail.origin })}
      ></preview-pane>`,
    });
    addSettingsSection({
      id: "preview-server",
      order: 10,
      render: () => html`<label>Preview server
        <input .value=${shell.site?.previewOrigin ?? ""} @change=${(e: Event) => void shell.updateSite({ previewOrigin: (e.target as HTMLInputElement).value.replace(/\/$/, "") })} />
      </label>`,
    });
  },
});
