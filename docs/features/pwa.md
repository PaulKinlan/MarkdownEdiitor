# Installing it as an app

The editor is a PWA: install it from Chrome or Edge's address bar and it runs in its own window.

- **Works offline.** The service worker caches the whole build, so the editor opens with no network. Posts live on disk, so editing and saving work offline too; only the assistant and web search need the network.
- **Updates when you say so.** A new deploy installs in the background, and an **Update** button appears in the top bar. Pressing it saves your post, then reloads into the new version. Until then the open window keeps running the version it started with.
- **Opens `.md` files.** Once installed, "Open with → Hugo Editor" on a markdown file opens it in the site it belongs to. If the file isn't in a site you've added, the editor offers to add its site folder.
- **Share to it.** Sharing text or a link to the app (Android and ChromeOS) starts a new post with it.
- **One window.** Opening a file or a shortcut while the editor is running focuses the existing window, so unsaved edits are never split across two copies.
- **Title bar.** On desktop, the top bar can take over the window's title bar (the chevron in the title bar toggles it).
- "New post" is in the app icon's shortcut menu.

The service worker never handles `/api/*` (agent calls and WebSockets) or any other origin, such as the local `hugo server` preview. In Chrome, static routes (Service Worker Static Routing API) send those straight to the network without starting the worker. It is only registered in production builds, so `npm run dev` is unaffected; use `npm run preview` to try it locally.
