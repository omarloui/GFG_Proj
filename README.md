# BehaviorLens

BehaviorLens is a client-only single-page app that helps educators and clinicians analyze behavioral and clinical documents, extract key information, and generate interactive visualizations (charts and graphs) using a local Generative AI model integration.

Features
- Create interactive HTML graphs and charts from AI responses (Chart.js & Plotly supported).
- Store and view PDFs and generated files in the browser using the Origin Private File System (OPFS).
- Send lightweight document summaries to the AI and attach full documents on demand to save tokens.
- In-app PDF viewer, drag-and-drop uploads, resizable panels, and RTL-aware chat rendering.
- Local-only configuration: API key and model selection are stored in `localStorage` (no server required).

Prerequisites
- A modern Chromium-based browser (Chrome, Edge) with support for OPFS and `navigator.storage`.
- A Google Generative Language API key (optional for local testing without AI features).

Quick Start (development / local preview)
1. Clone this repository.
2. Serve the folder over a local HTTP server (OPFS features may fail on `file://`). Examples:

	 - Python 3 built-in server:

		 ```bash
		 python -m http.server 8000
		 ```

	 - Node `http-server` (install if needed):

		 ```bash
		 npx http-server -p 8080
		 ```

3. Open `http://localhost:8000` (or the chosen port) in a Chromium-based browser.
4. On first load, open the API configuration (key icon) and paste your Google Generative Language API key if you want AI features. Select a model (e.g. `gemini-3.5-flash`).

How to use
- Import PDFs or other documents via the File Manager (drag-and-drop or Import Files button).
- Use "Include in context" to add a file's short preview to the AI context for subsequent queries.
- Use "Attach for next query" to attach the full document text to the next request (this incurs more tokens).
- Ask questions in the AI chat. When requesting charts, instruct the assistant to generate a `<create_file filename="name.html" type="graph">...</create_file>` block — the app will save and show the generated HTML file.

## Technical Summary

- **Architecture:** Client-only single-page app; no backend. All state, files, and API keys live in the browser.
- **Storage:** Uses Origin Private File System (OPFS) via `navigator.storage.getDirectory()` to persist imported PDFs and generated files.
- **AI Integration:** Google Generative Language API (`generateContent`) with selectable `state.apiModel`. Uses `v1beta` endpoint for Gemini 2.x/3.x models.
- **Auth & Config:** API key and selected model stored locally in `localStorage`; configured in the in-app API modal.
- **Token & Context Strategy:** Sends lightweight per-file previews (`documentsIndex` / `documentsSummary`) by default and attaches full document text only when the user explicitly queues files (`requestedDocs`). Full extraction is limited (first 5 pages) to reduce token usage.
- **PDF Handling:** `pdf.js` for rendering and text extraction (`extractPreviewFromPdf`, `extractTextFromPdf`). In-app PDF canvas viewer and an HTML iframe viewer reuse the PDF panel.
- **Graph/File Creation:** Detects model-produced `<create_file ...>` blocks (`parseAndCreateFiles`), wraps graph snippets into full HTML with `wrapGraphHtml` (Chart.js & Plotly included), saves to OPFS, and creates blob preview URLs.
- **Frontend stack & UX:** `lit-html` for templating, `marked` for markdown rendering, drag-and-drop uploads, resizable gutters, toast notifications, and RTL-aware chat rendering.
- **Privacy & Limitations:** Client-side only — files and API keys remain in the browser unless exported. OPFS and some features require modern Chromium browsers and serving over HTTP/HTTPS (not `file://`).

Publishing to GitHub Pages (static site)
1. Build a copy of this project into a branch or the repository root you will publish.
2. Push to GitHub and enable GitHub Pages from repository settings (serve from `main` or `gh-pages` branch).
3. Note: For OPFS and some browser features, serving over HTTPS (GitHub Pages provides HTTPS) is recommended.

Privacy & Security
- The app is a client-side application: no server-side components are included. API keys are stored in `localStorage` on your browser and files are stored in the browser's OPFS — they do not leave your machine unless you explicitly export them.
- Be cautious when pasting API keys into any browser app. Consider using a separate billing project or key for testing.

Troubleshooting
- If files do not import automatically, ensure you're serving the site over HTTP/HTTPS (not `file://`).
- If generated graphs do not render, allow pop-ups or open the graph file from the File Manager.

Credits
- Uses Chart.js and Plotly (in generated graph HTML files), `pdf.js` for PDF handling, `lit-html` for templating, and `marked` for markdown rendering.

License
- See [LICENSE.md](LICENSE.md) for licensing details.

Contributing
- Feel free to open issues or pull requests. For publishing assets (screenshots, demo GIFs), add them to the repository and reference them from this README.

Contact
- For questions or help publishing, open an issue or contact the project maintainer.

