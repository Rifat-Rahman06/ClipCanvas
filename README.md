# ClipCanvas — Research Notebook

A local-first research notebook that lives in Chrome's side panel. Capture passages from the web, arrange notes and images on visual canvases, and keep everything on your own device — without accounts, cloud sync, telemetry, or network requests.

Manifest V3 · React 19 + TypeScript · IndexedDB storage.

---

## Quick start

```powershell
npm.cmd install

npm.cmd run build     # writes the unpacked extension to dist/
npm.cmd test          # 53 unit tests (Vitest + fake-indexeddb)
npm.cmd run typecheck # tsc --noEmit
```

> On Windows PowerShell, `npm.ps1` is often blocked by execution policy. Use `npm.cmd` / `npx.cmd` as shown. On macOS or Linux, plain `npm` works.

Watch mode for development:

```powershell
npm.cmd run dev
```

This rebuilds the background and content bundles with esbuild and the side-panel UI with Vite. Reload the extension in `chrome://extensions` after a rebuild.

## Load it in the browser

1. Run `npm.cmd run build`.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the `dist` folder in this repository.
5. Pin ClipCanvas to the toolbar. Clicking the toolbar icon opens the side panel; the notebook also appears under the browser's side-panel menu.

Requires Chrome/Edge 116 or newer (`sidePanel` API).

## Using ClipCanvas

### Capture from the web

- Select text on a regular webpage, then right-click the selection and choose **Save Selection to ClipCanvas**.
- A dedicated **Save Selection** popup opens with the passage pre-filled. It never pulls the side panel open.
- Edit the passage, choose or create a canvas, then add it to an existing element or create a new one.
- Page formatting is converted to Markdown so headings, lists, emphasis, quotes, code, and tables keep their structure. Links are kept as plain text.
- The toolbar icon opens the notebook side panel only. It never starts a capture.

### Canvas workspace

- Each project can contain multiple named canvases, opened as tabs.
- Create a text element by double-clicking empty canvas space, using the **+** action, or pasting text.
- Double-clicking the canvas creates the element at the cursor and zooms in using the same focus behavior as opening an existing element.
- Paste or drop images directly onto the canvas. Images are stored locally with the notebook.
- Click an element to zoom in and start editing. Drag elements to reposition them and resize elements from their handles.
- Use the canvas controls to pan, zoom, fit the canvas to the view, and adjust touchpad zoom sensitivity.
- Search inside the current canvas with the canvas search control.

### Writing

- The rich-text editor supports headings, emphasis, lists, quotes, code, and other standard formatting.
- Use the selected-element toolbar for bold text, bullet lists, copying, downloading the element as a TXT file, inserting page text, and deleting the element.
- Elements show a rendered preview when they are not being edited.
- Changes autosave after a configurable pause and flush when editing ends.
- The **insert selected text** action appends the current browser selection to the active element while preserving its formatting, including lists and headings.
- Copying an element writes both rich HTML and plain text to the clipboard when the browser supports it.
- **Download as TXT** saves the element's text with a Save As dialog so you can choose the destination.

### Search

- Global Search covers element titles and text, including matches in their project names.
- Search results can be filtered by canvas.
- Each open canvas also has its own find-in-canvas search with match highlighting.

### Organize

- The sidebar lists canvases and the elements inside each canvas.
- New canvases can be created from the sidebar, Home view, or canvas tabs, and deleted from the sidebar menu.
- Elements can be renamed, moved to another canvas, or deleted from their menus and toolbar.
- The Save Selection popup uses the same canvas names as the side panel, so captures always land in the canvas you expect.

### Settings

- **Editor text size** — writing and preview size.
- **Autosave delay** — how long ClipCanvas waits after typing stops before saving.
- **Single-click zoom strength** — scales the automatic zoom used when opening an element.
- **Touchpad zoom sensitivity** — scales pinch gestures inside ClipCanvas.
- **Default element width** — width used by newly created, not-yet-resized elements.

### Backup and portability

- Settings & data shows notebook counts, local storage usage, and last export/import timestamps.
- **Export data** downloads a JSON backup containing projects, canvases, elements, image attachments, settings, and timestamps.
- **Import data** validates the entire file before writing anything and supports merge or replace modes.
- Replace mode downloads a safety backup of the current notebook first and stops if that backup fails.
- Backups exported before the rename remain importable.
- No data leaves the browser unless you explicitly export it.

## Storage model

| Data | Where |
| --- | --- |
| Projects, canvases, elements, settings, image attachments | IndexedDB database `clipcanvas-notebook` |
| Existing notebooks from the previous name | Automatically opened from the legacy `folio-notebook` database |
| Open canvas tabs, active canvas, active project, active element | `chrome.storage.local` key `clipcanvas.workspace.v2` |
| Transient selection handed to the Save Selection popup | `chrome.storage.session` |
| Open popup window ID | `chrome.storage.session` |

IndexedDB object stores: `projects`, `canvases`, `notes`, `settings`, and `attachments`.

ClipCanvas requests persistent browser storage when it starts. Notebook content is not sent to a server.

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | Hosts the notebook UI. |
| `contextMenus` | Adds the “Save Selection to ClipCanvas” item. |
| `storage` | Saves workspace layout and transient capture data. |
| `downloads` | JSON export, TXT element downloads, and pre-replace safety backups. |
| `unlimitedStorage` | Keeps large notebooks safe from quota eviction. |
| `activeTab`, `scripting`, `tabs` | Read the current selection and check the active page URL. |
| Host access (`http`, `https`, `file`) | Reads selections on ordinary pages and, when needed, inside frames. |

## Project structure

```text
chrome/manifest.json            Manifest V3 configuration and permissions
public/icons/                   Extension icons (regenerated by the build)
scripts/build.mjs               Orchestrates Vite + esbuild, manifest copy, icons
scripts/make-icons.mjs          Renders PNG icons from an inline SVG using sharp
src/
  App.tsx                       Shell: views, dialogs, canvas actions, import/export
  main.tsx                      Side-panel React entry point
  background/service-worker.ts  Toolbar panel, context menu, capture protocol
  content/selection.ts          Selection bridge injected into pages
  content/selectionMarkdown.ts  Page-selection HTML to Markdown conversion
  popup/                        Dedicated Save Selection React entry
  components/                   Sidebar, canvas, editor, tabs, dialogs, toolbars
  components/editor/            Rich-text editor and attachment-image integration
  views/                        Home, Search, Settings, Import dialog
  hooks/                        Insert-selection, workspace state, media queries
  lib/                          Text, image, insertion, and rich-text helpers
  state/                        Notebook and toast contexts
  services/capture/             Selection capture and popup handoff
  services/db/                  IndexedDB schema, repository, settings, attachments
  services/extension/           Open ClipCanvas in a browser tab
  services/import-export/       Backup validation, transactional import, downloads
  services/search/              Search index, ranking, and snippets
  services/workspace/           Canvas-tab and active-element persistence
  styles/                       Token-based CSS
  types/                        Shared domain types and constants
tests/                          Vitest suites for data, search, import/export, utils
```

`dist/` is generated output and is intentionally ignored by Git. `node_modules/` is also ignored.

## Testing

```powershell
npm.cmd test          # single run
npm.cmd run test:watch
```

The suites run against `fake-indexeddb`, so no browser is required. Coverage includes repository CRUD and cascade deletes, legacy database migration, search ranking and snippets, backup validation, merge/replace import behavior, rich-text conversion, and insertion planning.

## Limitations

- **Selection capture requires the real extension.** Running the UI through Vite alone gives you the notebook, but the toolbar button, context menu, and Save Selection popup only exist in the loaded extension.
- **Restricted pages cannot be read.** Chrome internal pages, the Chrome Web Store, other extensions' pages, and Chrome's built-in PDF viewer block script injection.
- **PDF selections require copy/paste.** Select the text in the PDF, copy it, then paste it into a ClipCanvas element.
- **Local files need permission.** To capture from `file://` pages, enable **Allow access to file URLs** in the extension's details page.
- **Imports are capped at 64 MB.** Larger files are rejected before parsing.
- **No cloud or sync.** Data lives in one browser profile. Export regularly; clearing extension data deletes the notebook.
- **Single-window assumption.** Canvas-tab layout is stored per profile, not per window.
- **Capture keeps text formatting only.** Page snapshots, annotations, and source images are out of scope.
- Some Chromium builds ignore command-line extension loading. Load `dist/` through the extensions page instead.

## Development notes

- The build wipes and recreates `dist/` on every run.
- The extension version lives in both `package.json` and `chrome/manifest.json`; the build fails when they disagree.
- The displayed app version in `src/types/index.ts` should be updated alongside those files.
- Icons are regenerated during the build, so committed `public/icons/` files are conveniences rather than required build inputs.
- There are no API keys, environment files, or remote services in this repository.

## License

No license has been chosen yet. Add a `LICENSE` file before distributing the project or accepting outside contributions.
