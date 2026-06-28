import { html, render } from "https://unpkg.com/lit-html?module";
import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

// Setup PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// --- STATE ---
const state = {
  activeTab: "chat", // 'file', 'chat', 'pdf'
  theme: "dark",
  apiKey: localStorage.getItem("gemini_api_key") || "",
  apiModel: localStorage.getItem("gemini_api_model") || "gemini-3.5-flash", // Updated model ID
  showApiModal: !localStorage.getItem("gemini_api_key"), // Show modal if no API key
  files: [], // Array of file names
  searchQuery: "",
  chatHistory: [],
  isGenerating: false,
  error: null,
  retryAvailableAt: null, // Timestamp when user can retry after quota exceeded

  // PDF Viewer state
  currentPdfName: null,
  pdfDoc: null,
  pageNum: 1,
  pageRendering: false,
  pageNumPending: null,

  // Context for Gemini (lightweight summary + index; full docs fetched on demand)
  documentsSummary: "",
  documentsIndex: [], // [{ name, preview }]
  requestedDocs: [],
  // UI feedback
  importingSupportingDocs: false,
  toastMessage: "",
  toastVisible: false,
  includedDocs: [], // files the user has selected to include as context
  currentHtmlName: null,
  currentHtmlUrl: null,
  draggingOver: false,
  // Layout sizes (pixels). Center column is flexible.
  leftPanelWidth: parseInt(localStorage.getItem("leftPanelWidth")) || 360,
  rightPanelWidth: parseInt(localStorage.getItem("rightPanelWidth")) || 420,
  // resizing state
  isResizing: false,
  _resize: null,
};

// --- INITIALIZATION ---
async function init() {
  await loadOpfsFiles();

  const supportingDocs = [
    "cdc-milestone-checklists-ltsae-english-508.pdf",
    "cdc-milestone-checklists-ltsae-arabic.pdf",
    "Clinical_Practice_Guideline_ASD.pdf",
  ];
  const hasAllSupportingDocs = supportingDocs.every((doc) =>
    state.files.includes(doc),
  );

  if (!hasAllSupportingDocs) {
    await autoImportSupportingDocs();
  }

  // Extract text from all PDFs for Gemini context
  await extractAllContext();

  update();
}

// Safely view a file: PDFs open in the PDF viewer; HTML tries in-app viewer and falls back to new tab
function viewFile(name) {
  if (name.toLowerCase().endsWith(".pdf")) return openPdf(name);
  if (name.toLowerCase().endsWith(".html")) {
    try {
      openHtmlInViewer(name);
    } catch (e) {
      console.warn("In-app HTML viewer failed, opening in new tab", e);
      openHtmlFile(name);
    }
  }
}

async function autoImportSupportingDocs() {
  const docs = [
    "supporting docs/cdc-milestone-checklists-ltsae-english-508.pdf",
    "supporting docs/cdc-milestone-checklists-ltsae-arabic.pdf",
    "supporting docs/Clinical_Practice_Guideline_ASD.pdf",
  ];

  const beforeCount = state.files.length;
  state.importingSupportingDocs = true;
  update();
  for (const docPath of docs) {
    try {
      const response = await fetch(docPath);
      if (response.ok) {
        const blob = await response.blob();
        const fileName = docPath.split("/").pop();
        await saveFileToOpfs(fileName, blob);
      }
    } catch (e) {
      console.warn(
        "Could not auto-fetch",
        docPath,
        "- likely running on file:// protocol without a server.",
      );
    }
  }
  await loadOpfsFiles();
  state.importingSupportingDocs = false;
  const afterCount = state.files.length;
  const imported = Math.max(0, afterCount - beforeCount);
  showToast(
    imported > 0
      ? `Imported ${imported} supporting document${imported > 1 ? "s" : ""}`
      : "No supporting documents were imported",
  );
  update();
}

// --- OPFS FILE SYSTEM ---
async function loadOpfsFiles() {
  try {
    const root = await navigator.storage.getDirectory();
    const files = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === "file") {
        files.push(name);
      }
    }
    state.files = files;
  } catch (err) {
    console.error("Error accessing OPFS:", err);
    state.error = "File system access error.";
  }
}

async function saveFileToOpfs(name, blob) {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    await loadOpfsFiles();
    update();
  } catch (err) {
    console.error("Error saving file:", err);
  }
}

async function deleteFileFromOpfs(name) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
    if (state.currentPdfName === name) {
      state.currentPdfName = null;
      state.pdfDoc = null;
    }
    if (state.currentHtmlName === name) {
      if (state.currentHtmlUrl) {
        try {
          URL.revokeObjectURL(state.currentHtmlUrl);
        } catch (e) {}
      }
      state.currentHtmlName = null;
      state.currentHtmlUrl = null;
    }
    await loadOpfsFiles();
    await extractAllContext();
    update();
  } catch (err) {
    console.error("Error deleting file:", err);
  }
}

async function getFileBlob(name) {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(name);
  return await fileHandle.getFile();
}

// --- PDF HANDLING ---
async function openPdf(name) {
  state.activeTab = "pdf";
  state.currentPdfName = name;
  // clear any HTML viewer state
  if (state.currentHtmlUrl) {
    try {
      URL.revokeObjectURL(state.currentHtmlUrl);
    } catch (e) {}
    state.currentHtmlUrl = null;
    state.currentHtmlName = null;
  }
  update();

  try {
    const file = await getFileBlob(name);
    const arrayBuffer = await file.arrayBuffer();

    state.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    state.pageNum = 1;
    update();
    renderPage(state.pageNum);
  } catch (err) {
    console.error("Error opening PDF:", err);
    state.error = "Could not render PDF.";
    update();
  }
}

async function openHtmlInViewer(name) {
  state.activeTab = "pdf"; // reuse PDF panel as the universal viewer
  state.currentPdfName = null;
  // revoke previous url if present
  if (state.currentHtmlUrl) {
    try {
      URL.revokeObjectURL(state.currentHtmlUrl);
    } catch (e) {}
    state.currentHtmlUrl = null;
    state.currentHtmlName = null;
  }
  try {
    const file = await getFileBlob(name);
    const url = URL.createObjectURL(file);
    state.currentHtmlName = name;
    state.currentHtmlUrl = url;
  } catch (e) {
    console.error("Could not open HTML in viewer", e);
    state.error = "Could not open HTML file.";
  }
  update();
}

function closeHtmlViewer() {
  if (state.currentHtmlUrl) {
    try {
      URL.revokeObjectURL(state.currentHtmlUrl);
    } catch (e) {}
  }
  state.currentHtmlUrl = null;
  state.currentHtmlName = null;
  update();
}

function renderPage(num) {
  state.pageRendering = true;

  state.pdfDoc.getPage(num).then(function (page) {
    const canvas = document.getElementById("pdf-canvas");
    if (!canvas) {
      state.pageRendering = false;
      return;
    }
    const ctx = canvas.getContext("2d");

    // Scale appropriately for viewing
    const viewport = page.getViewport({ scale: 1.5 });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };

    const renderTask = page.render(renderContext);
    renderTask.promise.then(function () {
      state.pageRendering = false;
      if (state.pageNumPending !== null) {
        renderPage(state.pageNumPending);
        state.pageNumPending = null;
      }
    });
  });

  update();
}

function queueRenderPage(num) {
  if (state.pageRendering) {
    state.pageNumPending = num;
  } else {
    renderPage(num);
  }
}

function onPrevPage() {
  if (state.pageNum <= 1) return;
  state.pageNum--;
  queueRenderPage(state.pageNum);
}

function onNextPage() {
  if (state.pageNum >= state.pdfDoc.numPages) return;
  state.pageNum++;
  queueRenderPage(state.pageNum);
}

async function extractTextFromPdf(arrayBuffer) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    // Limit to first 5 pages for MVP to avoid huge memory spikes and API rate limits (429)
    const maxPages = Math.min(pdf.numPages, 5);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      fullText += pageText + "\n";
    }
    return fullText;
  } catch (e) {
    console.error("Text extraction failed", e);
    return "";
  }
}
async function extractPreviewFromPdf(arrayBuffer, maxChars = 300) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    return pageText.replace(/\s+/g, " ").slice(0, maxChars).trim();
  } catch (e) {
    console.error("Preview extraction failed", e);
    return "";
  }
}

function containsArabicText(text) {
  return /[\u0600-\u06FF]/.test(text || "");
}

async function extractAllContext() {
  // Build a small index/summary for each PDF (first-page preview)
  const index = [];
  for (const fileName of state.files) {
    if (fileName.toLowerCase().endsWith(".pdf")) {
      try {
        const file = await getFileBlob(fileName);
        const arrayBuffer = await file.arrayBuffer();
        const preview = await extractPreviewFromPdf(arrayBuffer, 300);
        index.push({ name: fileName, preview });
      } catch (e) {
        console.warn("Could not preview", fileName, e);
      }
    }
  }
  state.documentsIndex = index;
  // Build documentsSummary only for files the user has explicitly included
  if (state.includedDocs && state.includedDocs.length) {
    const lines = [`Included documents (${state.includedDocs.length}):`];
    for (const name of state.includedDocs) {
      const found = index.find((d) => d.name === name);
      if (found) {
        lines.push(`- ${found.name}: ${found.preview || "[no preview]"}`);
      } else {
        // try to read non-pdf text files for a short preview
        try {
          const file = await getFileBlob(name);
          const text = await file.text();
          lines.push(`- ${name}: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
        } catch (e) {
          lines.push(`- ${name}: [preview unavailable]`);
        }
      }
    }
    state.documentsSummary = lines.join("\n");
  } else {
    state.documentsSummary =
      'No local documents attached. Use "Include in context" on files to add them to the next query.';
  }
}

// Simple toast helper
function showToast(message, duration = 3500) {
  state.toastMessage = message;
  state.toastVisible = true;
  update();
  setTimeout(() => {
    state.toastVisible = false;
    update();
  }, duration);
}

// --- GEMINI API ---
async function parseAndCreateFiles(responseText) {
  // Parse file creation requests in format:
  // <create_file filename="name.html" type="graph">
  // <html content here>
  // </create_file>
  const filePattern =
    /<create_file\s+filename="([^"]+)"\s+type="([^"]+)">\s*([\s\S]*?)\s*<\/create_file>/g;
  let match;

  while ((match = filePattern.exec(responseText)) !== null) {
    const filename = match[1];
    const type = match[2];
    const content = match[3].trim();

    try {
      if (type === "graph" || type === "html" || filename.endsWith(".html")) {
        // Create HTML file with proper structure
        const htmlContent = wrapGraphHtml(content, filename);
        const blob = new Blob([htmlContent], { type: "text/html" });
        await saveFileToOpfs(filename, blob);
        console.log(`Created file: ${filename}`);
      } else if (type === "json" || filename.endsWith(".json")) {
        const blob = new Blob([content], { type: "application/json" });
        await saveFileToOpfs(filename, blob);
        console.log(`Created JSON file: ${filename}`);
      }
    } catch (err) {
      console.error(`Error creating file ${filename}:`, err);
    }
  }
}

function wrapGraphHtml(content, filename) {
  // Wrap graph content in proper HTML with Chart.js and common libraries
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${filename.replace(".html", "")}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
    <script src="https://cdn.jsdelivr.net/npm/plotly.js-dist@2.26.0"><\/script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            background: #f5f5f5;
            padding: 20px;
            color: #333;
            width: 100%;
            overflow-x: hidden; /* Prevents horizontal scroll on mobile */
        }
        .container {
            width: 100%;
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1, h2, h3 {
            color: #1f2937;
            margin-bottom: 20px;
        }
        .chart-container {
            position: relative;
            height: 400px;
            width: 100%; /* Ensures the chart takes full width of container */
            margin-bottom: 30px;
        }
        
        /* Mobile Responsiveness */
        @media (max-width: 768px) {
            body { padding: 10px; }
            .container { padding: 15px; }
            .chart-container { height: 300px; } /* Slightly shorter on mobile */
            h1 { font-size: 1.5rem; }
        }

        .info-box {
            background: #f0f7ff;
            border-left: 4px solid #3b82f6;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            display: block;
            overflow-x: auto; /* Allows tables to scroll horizontally on phones */
        }
        th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }
        th {
            background: #f3f4f6;
            font-weight: 600;
        }
        tr:hover {
            background: #f9fafb;
        }
        .container, body {
          unicode-bidi: plaintext;
        }
    </style>
</head>
<body>
    <div class="container">
        ${content}
    </div>
    <script>
        // Auto-resize charts on window resize
        window.addEventListener('resize', function() {
            if (typeof Chart !== 'undefined') {
                Chart.helpers.each(Chart.instances, function(instance) {
                    instance.resize();
                });
            }
        });
    <\/script>
</body>
</html>`;
}

async function sendChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById("chat-input-field");
  const messageText = input.value.trim();
  if (!messageText) return;

  if (!state.apiKey) {
    state.showApiModal = true;
    update();
    return;
  }

  // Add user message
  state.chatHistory.push({ role: "user", text: messageText });
  input.value = "";
  state.isGenerating = true;
  state.error = null;
  update();

  scrollToBottom();

  try {
    // Map the full conversation history to Gemini's expected format
    const apiContents = [
      {
        role: "user",
        parts: [
          {
            // Inside async function sendChatMessage(e) ...

            text: `You are an AI assistant for special education teachers. 
Use the following document context to answer the user's questions. 
If researching external info, rely ONLY on highly credible sources (.gov, .edu, .org, CDC, NIH).
Avoid commercial blogs. Present data clearly (using markdown tables or lists if helpful).

IMPORTANT: You can create HTML files with interactive graphs and charts to visualize behavioral data!
When the user asks for graphs, charts, progress tracking visualizations, or data analysis:
1. Create a complete HTML file with embedded visualization code
2. Use Chart.js for bar, line, pie charts, or Plotly.js for interactive plots
3. Wrap your file creation request in this format:
   <create_file filename="filename.html" type="graph">
   <h1>Graph Title</h1>
   <div class="chart-container"><canvas id="myChart"></canvas></div>
   <script>
   const ctx = document.getElementById('myChart').getContext('2d');
   const chart = new Chart(ctx, {
       // ... your data ...
       options: {
           responsive: true,
           maintainAspectRatio: false // <--- THIS IS REQUIRED FOR PROPER RENDERING
       }
   });
   </script>
   </create_file>

4. The system will automatically save the file to the file manager, where users can download it

Examples of graphs you should create:
- Progress/regression tracking charts for student behavior
- Intervention effectiveness comparisons
- Milestone achievement timelines
- Symptom severity scales over time
- Behavioral frequency heatmaps

DOCUMENT SUMMARY:
${state.documentsSummary}`,
          },
        ],
      },
      ...state.chatHistory.map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.text }],
      })),
    ];

    // Attach full documents only when explicitly requested (to save tokens)
    if (state.requestedDocs && state.requestedDocs.length) {
      for (const docName of state.requestedDocs.slice()) {
        try {
          const file = await getFileBlob(docName);
          const ab = await file.arrayBuffer();
          const fullText = await extractTextFromPdf(ab); // limited to first 5 pages
          apiContents.push({
            role: "user",
            parts: [{ text: `FULL_DOCUMENT:${docName}\n\n${fullText}` }],
          });
        } catch (e) {
          console.warn("Failed to attach full document", docName, e);
        }
      }
      state.requestedDocs = [];
    }

    // Use v1beta for Gemini 2.x and 3.x models which require the newer endpoint
    const apiVersion = state.apiModel.match(/gemini-[23]/) ? "v1beta" : "v1";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/${apiVersion}/models/${state.apiModel}:generateContent?key=${state.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: apiContents,
          generationConfig: {
            temperature: 0.7,
          },
        }),
      },
    );

    if (!response.ok) {
      let errorMsg = `HTTP Error ${response.status} ${response.statusText}`;
      let retryAfterSeconds = null;

      // Check for Retry-After header (usually set on 429 responses)
      const retryAfterHeader = response.headers.get("retry-after");
      if (retryAfterHeader) {
        retryAfterSeconds = parseInt(retryAfterHeader);
      }

      try {
        // Attempt to parse Google's detailed API error message
        const errorData = await response.json();
        if (errorData.error && errorData.error.message) {
          errorMsg = `API Error: ${errorData.error.message}`;

          // Extract retry-after delay from error message if present
          // Matches patterns like: "Please retry in 30.489763733s"
          const retryMatch = errorMsg.match(/retry\s+in\s+([\d.]+)s/i);
          if (retryMatch) {
            retryAfterSeconds = Math.ceil(parseFloat(retryMatch[1]));
          }
        }
      } catch (e) {
        // Fallback to HTTP error if JSON parsing fails
      }

      const error = new Error(errorMsg);
      error.statusCode = response.status;
      error.retryAfterSeconds = retryAfterSeconds;
      throw error;
    }

    const data = await response.json();
    const replyText =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response generated.";

    // Check for file creation requests in the response
    await parseAndCreateFiles(replyText);

    state.chatHistory.push({
      role: "model",
      text: replyText,
      html: marked.parse(replyText),
    });
  } catch (err) {
    let errorDetails = err.message;
    let errorTitle = "Failed to get response";

    // Handle quota exceeded errors (429)
    if (
      err.statusCode === 429 ||
      err.message.includes("quota") ||
      err.message.includes("Quota")
    ) {
      errorTitle = "API Quota Exceeded";

      if (err.retryAfterSeconds) {
        state.retryAvailableAt = Date.now() + err.retryAfterSeconds * 1000;
        const minutes = Math.ceil(err.retryAfterSeconds / 60);
        const seconds = err.retryAfterSeconds % 60;
        const timeStr =
          minutes > 0
            ? `${minutes} minute${minutes > 1 ? "s" : ""}`
            : `${seconds} second${seconds !== 1 ? "s" : ""}`;
        errorDetails = `You've exceeded the free tier API quota. Please wait ${timeStr} before trying again. (Error: 429)`;
      } else {
        errorDetails =
          "You've exceeded the free tier API quota. Check your billing at https://ai.google.dev/pricing. (Error: 429)";
      }
    }
    // Handle other rate limits
    else if (err.statusCode === 429) {
      errorTitle = "Rate Limited";
      if (err.retryAfterSeconds) {
        state.retryAvailableAt = Date.now() + err.retryAfterSeconds * 1000;
        errorDetails = `Rate limited by API. Please wait ${err.retryAfterSeconds} seconds before trying again.`;
      } else {
        errorDetails =
          "API rate limit exceeded. Please wait a moment and try again.";
      }
    }

    state.error = `${errorTitle}: ${errorDetails}`;
    state.chatHistory.push({
      role: "model",
      text: "Error: Could not fetch response.",
      html: `<p class="error-text">${errorTitle}: ${errorDetails}</p>`,
    });
  } finally {
    state.isGenerating = false;
    update();
    setTimeout(scrollToBottom, 50);
  }
}

function scrollToBottom() {
  const chatContainer = document.querySelector(".chat-messages");
  if (chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function getSecondsUntilRetry() {
  if (!state.retryAvailableAt) return 0;
  const secondsLeft = Math.ceil((state.retryAvailableAt - Date.now()) / 1000);
  return secondsLeft > 0 ? secondsLeft : 0;
}

function canRetryNow() {
  return !state.retryAvailableAt || Date.now() >= state.retryAvailableAt;
}

// Update retry timer every second
setInterval(() => {
  if (state.retryAvailableAt && Date.now() < state.retryAvailableAt) {
    update();
  } else if (state.retryAvailableAt && Date.now() >= state.retryAvailableAt) {
    state.retryAvailableAt = null;
    state.error = null;
    update();
  }
}, 1000);

// --- FILE MANAGER HANDLERS ---
async function handleFileUpload(e) {
  const files = e.target.files;
  if (!files.length) return;

  for (const file of files) {
    await saveFileToOpfs(file.name, file);
  }
  await extractAllContext();
}

async function handleFileDrop(e) {
  e.preventDefault();
  state.draggingOver = false;
  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;
  for (const file of files) {
    await saveFileToOpfs(file.name, file);
  }
  await extractAllContext();
  showToast(`Imported ${files.length} file${files.length > 1 ? "s" : ""}`);
}

function handleDragOver(e) {
  e.preventDefault();
  state.draggingOver = true;
  update();
}

function handleDragLeave(e) {
  e.preventDefault();
  state.draggingOver = false;
  update();
}

async function openHtmlFile(name) {
  const file = await getFileBlob(name);
  const url = URL.createObjectURL(file);
  const newWindow = window.open(url, "_blank");
  if (!newWindow) {
    alert("Please allow pop-ups to view the graph file");
  }
}

async function downloadFile(name) {
  const file = await getFileBlob(name);
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- VIEW TEMPLATES (lit-html) ---

const Header = () => html`
  <header class="header">
    <div class="app-title">BehaviorLens</div>
    <div class="header-actions">
      <div
        class="status-dot ${state.apiKey ? "ok" : "err"} ${state.isGenerating
          ? "loading"
          : ""}"
        title="${state.apiKey ? "API Key Set" : "No API Key"}"
      ></div>
      <button
        class="btn-icon"
        @click=${() => {
          state.theme = state.theme === "dark" ? "light" : "dark";
          document.documentElement.setAttribute("data-theme", state.theme);
          update();
        }}
      >
        <span class="material-symbols-rounded"
          >${state.theme === "dark" ? "light_mode" : "dark_mode"}</span
        >
      </button>
      <button
        class="btn-icon"
        @click=${() => {
          state.showApiModal = true;
          update();
        }}
      >
        <span class="material-symbols-rounded">key</span>
      </button>
    </div>
  </header>
`;

const Sidebar = () => html`
  <aside class="sidebar">
    <button
      class="sidebar-btn ${state.activeTab === "file" ? "active" : ""}"
      @click=${() => {
        state.activeTab = "file";
        update();
      }}
      title="File Manager"
    >
      <span class="material-symbols-rounded">folder</span>
    </button>
    <button
      class="sidebar-btn ${state.activeTab === "chat" ? "active" : ""}"
      @click=${() => {
        state.activeTab = "chat";
        update();
      }}
      title="AI Chat"
    >
      <span class="material-symbols-rounded">forum</span>
    </button>
    <button
      class="sidebar-btn ${state.activeTab === "pdf" ? "active" : ""}"
      @click=${() => {
        state.activeTab = "pdf";
        update();
      }}
      title="PDF Viewer"
    >
      <span class="material-symbols-rounded">picture_as_pdf</span>
    </button>
    <div class="sidebar-spacer"></div>
  </aside>
`;

const FileManagerPanel = () => {
  const filteredFiles = state.files.filter((f) =>
    f.toLowerCase().includes(state.searchQuery.toLowerCase()),
  );

  return html`
    <div class="panel ${state.activeTab === "file" ? "active" : ""}">
      <div class="panel-header">
        <h2>
          <span class="material-symbols-rounded" style="margin-right: 8px;"
            >folder</span
          >
          File Manager
        </h2>
        <div>
          <input
            type="file"
            id="file-upload"
            multiple
            style="display: none"
            @change=${handleFileUpload}
          />
          <button
            class="btn btn-primary"
            @click=${() => document.getElementById("file-upload").click()}
          >
            <span class="material-symbols-rounded">upload</span> Import Files
          </button>
        </div>
      </div>
      <div
        class="search-container"
        @dragover=${handleDragOver}
        @dragleave=${handleDragLeave}
        @drop=${handleFileDrop}
      >
        <span class="material-symbols-rounded search-icon">search</span>
        <input
          type="text"
          class="search-input"
          placeholder="Search files..."
          .value=${state.searchQuery}
          @input=${(e) => {
            state.searchQuery = e.target.value;
            update();
          }}
        />
      </div>
      <div class="file-list">
        ${state.files.length === 0
          ? html`
              <div class="empty-state">
                <span class="material-symbols-rounded">inventory_2</span>
                <p>
                  No files found. Import PDFs or other documents to provide
                  context to the AI.
                </p>
              </div>
            `
          : filteredFiles.map(
              (name) => html`
                <div
                  class="file-item"
                  @click=${() => viewFile(name)}
                  style="${name.endsWith(".html") ? "cursor: pointer;" : ""}"
                >
                  <span class="material-symbols-rounded file-icon"
                    >${name.endsWith(".pdf")
                      ? "picture_as_pdf"
                      : name.endsWith(".html")
                        ? "bar_chart"
                        : "description"}</span
                  >
                  <div class="file-info">
                    <span class="file-name">${name}</span>
                    <span class="file-size">Stored in OPFS</span>
                  </div>
                  <div class="file-actions">
                    ${name.endsWith(".html")
                      ? html`<button
                          class="btn-icon-sm"
                          @click=${(e) => {
                            e.stopPropagation();
                            openHtmlFile(name);
                          }}
                          title="View Graph"
                        >
                          <span class="material-symbols-rounded"
                            >open_in_new</span
                          >
                        </button>`
                      : ""}
                    ${name.toLowerCase().endsWith(".pdf")
                      ? html`<div
                          style="display:flex; align-items:center; gap:6px;"
                        >
                          <button
                            class="btn-icon-sm"
                            @click=${(e) => {
                              e.stopPropagation();
                              if (!state.requestedDocs.includes(name))
                                state.requestedDocs.push(name);
                              update();
                            }}
                            title="Attach for next query"
                          >
                            <span class="material-symbols-rounded"
                              >attach_file</span
                            >
                          </button>
                          ${state.requestedDocs.includes(name)
                            ? html`<span
                                style="font-size:11px; padding:2px 6px; background:var(--accent, #ffd54f); color:#111; border-radius:12px;"
                                >Queued</span
                              >`
                            : ""}
                          <button
                            class="btn-icon-sm"
                            @click=${(e) => {
                              e.stopPropagation();
                              const idx = state.includedDocs.indexOf(name);
                              if (idx === -1) state.includedDocs.push(name);
                              else state.includedDocs.splice(idx, 1);
                              extractAllContext();
                              update();
                            }}
                            title="Include in context"
                          >
                            <span class="material-symbols-rounded"
                              >playlist_add</span
                            >
                          </button>
                          ${state.includedDocs.includes(name)
                            ? html`<span
                                style="font-size:11px; padding:2px 6px; background:var(--green,#86efac); color:#033; border-radius:12px;"
                                >Included</span
                              >`
                            : ""}
                        </div>`
                      : ""}
                    <button
                      class="btn-icon-sm"
                      @click=${(e) => {
                        e.stopPropagation();
                        downloadFile(name);
                      }}
                      title="Export"
                    >
                      <span class="material-symbols-rounded">download</span>
                    </button>
                    <button
                      class="btn-icon-sm"
                      style="color: var(--red)"
                      @click=${(e) => {
                        e.stopPropagation();
                        deleteFileFromOpfs(name);
                      }}
                      title="Delete"
                    >
                      <span class="material-symbols-rounded">delete</span>
                    </button>
                  </div>
                </div>
              `,
            )}
      </div>
    </div>
  `;
};

// Helper to safely render markdown HTML strings without needing the unsafeHTML directive
function renderHtml(htmlString) {
  const container = document.createElement("div");
  container.innerHTML = htmlString || "";
  container.setAttribute(
    "dir",
    containsArabicText(htmlString) ? "rtl" : "auto",
  );
  return container;
}

const ChatPanel = () => html`
  <div class="panel ${state.activeTab === "chat" ? "active" : ""}">
    <div class="panel-header">
      <h2>
        <span class="material-symbols-rounded" style="margin-right: 8px;"
          >forum</span
        >
        AI Assistant
      </h2>
      <div class="context-badge" title="Context loaded from files">
        <span
          class="material-symbols-rounded"
          style="font-size: 14px; vertical-align: middle;"
          >library_books</span
        >
        ${state.files.length} Docs Indexed
      </div>
    </div>

    ${state.error ? html`<div class="error-banner">${state.error}</div>` : ""}

    <div class="chat-messages">
      ${state.chatHistory.length === 0
        ? html`
            <div class="empty-state">
              <span class="material-symbols-rounded">smart_toy</span>
              <p>
                Hello! I am your behavioral support assistant. Ask me to
                synthesize the CDC guidelines, or research interventions for
                ADHD and Autism.
              </p>
              <div class="tutorial-cards">
                <div class="tutorial-card">
                  <span class="material-symbols-rounded">upload_file</span>
                  <div>
                    <strong>1. Add files</strong>
                    <p>
                      Drop PDFs or documents into File Manager to bring them
                      into the app.
                    </p>
                  </div>
                </div>
                <div class="tutorial-card">
                  <span class="material-symbols-rounded">playlist_add</span>
                  <div>
                    <strong>2. Include context</strong>
                    <p>
                      Mark the files you want the assistant to use for the next
                      answer.
                    </p>
                  </div>
                </div>
                <div class="tutorial-card">
                  <span class="material-symbols-rounded">chat</span>
                  <div>
                    <strong>3. Ask a question</strong>
                    <p>
                      Use chat to summarize, compare, or create a chart from
                      your documents.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          `
        : ""}
      ${state.chatHistory.map(
        (msg) => html`
          <div class="message ${msg.role}">
            <div class="message-avatar">
              <span class="material-symbols-rounded"
                >${msg.role === "user" ? "person" : "smart_toy"}</span
              >
            </div>
            <div class="message-body">
              ${msg.role === "user" ? msg.text : renderHtml(msg.html)}
            </div>
          </div>
        `,
      )}
      ${state.isGenerating
        ? html`
            <div class="message model">
              <div class="message-avatar">
                <span class="material-symbols-rounded">smart_toy</span>
              </div>
              <div class="message-body typing">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
              </div>
            </div>
          `
        : ""}
    </div>

    <form class="chat-input-area" @submit=${sendChatMessage}>
      <input
        type="text"
        id="chat-input-field"
        class="chat-input"
        placeholder="Type a message..."
        ?disabled=${state.isGenerating || !canRetryNow()}
        autocomplete="off"
      />
      <button
        type="submit"
        class="btn-send"
        ?disabled=${state.isGenerating || !canRetryNow()}
      >
        <span class="material-symbols-rounded"
          >${!canRetryNow() ? "schedule" : "send"}</span
        >
      </button>
      ${!canRetryNow()
        ? html`<div
            style="font-size: 12px; color: var(--text-muted); margin-top: 4px;"
          >
            Retry available in ${getSecondsUntilRetry()} seconds
          </div>`
        : ""}
    </form>
  </div>
`;

const PdfPanel = () => html`
  <div class="panel ${state.activeTab === "pdf" ? "active" : ""}">
    <div class="panel-header">
      <h2>
        <span class="material-symbols-rounded" style="margin-right: 8px;"
          >picture_as_pdf</span
        >
        ${state.currentPdfName || "PDF Viewer"}
        ${state.currentHtmlName ? html` — ${state.currentHtmlName}` : ""}
      </h2>
      <div class="pdf-nav">
        <button
          class="btn-icon-sm"
          @click=${onPrevPage}
          ?disabled=${!state.pdfDoc || state.pageNum <= 1}
        >
          <span class="material-symbols-rounded">chevron_left</span>
        </button>
        <span class="page-info"
          >${state.pdfDoc
            ? `${state.pageNum} / ${state.pdfDoc.numPages}`
            : "0 / 0"}</span
        >
        <button
          class="btn-icon-sm"
          @click=${onNextPage}
          ?disabled=${!state.pdfDoc || state.pageNum >= state.pdfDoc.numPages}
        >
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
        ${state.currentHtmlName
          ? html`<div style="display:flex; gap:6px; align-items:center;">
              <button
                class="btn-icon-sm"
                @click=${() => closeHtmlViewer()}
                title="Close viewer"
              >
                <span class="material-symbols-rounded">close</span>
              </button>
              <button
                class="btn-icon-sm"
                @click=${() => {
                  // open HTML in new window
                  openHtmlFile(state.currentHtmlName);
                }}
                title="Open in new tab"
              >
                <span class="material-symbols-rounded">open_in_new</span>
              </button>
            </div>`
          : ""}
      </div>
    </div>
    <div class="pdf-container">
      ${state.currentHtmlName
        ? html`<iframe
            src="${state.currentHtmlUrl}"
            style="width:100%; height:100%; border:0;"
            sandbox="allow-scripts allow-same-origin"
          ></iframe>`
        : state.pdfDoc
          ? html`<canvas id="pdf-canvas"></canvas>`
          : html`
              <div class="empty-state">
                <span class="material-symbols-rounded">picture_as_pdf</span>
                <p>
                  Select a PDF or HTML graph from the File Manager to view it
                  here.
                </p>
                <button
                  class="btn btn-primary"
                  style="margin-top: 1rem"
                  @click=${() => {
                    state.activeTab = "file";
                    update();
                  }}
                >
                  Go to File Manager
                </button>
              </div>
            `}
    </div>
  </div>
`;

const ApiModal = () => {
  if (!state.showApiModal) return "";

  return html`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>API Configuration</h2>
          <button
            class="btn-icon-sm"
            @click=${() => {
              state.showApiModal = false;
              update();
            }}
          >
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <form
          class="modal-body"
          @submit=${(e) => {
            e.preventDefault();
            const key = document.getElementById("api-key-input").value.trim();
            const model = document.getElementById("api-model-select").value;
            state.apiKey = key;
            state.apiModel = model;
            localStorage.setItem("gemini_api_key", key);
            localStorage.setItem("gemini_api_model", model);
            state.showApiModal = false;
            update();
          }}
        >
          <label class="field-label">Gemini API Key</label>
          <input
            type="password"
            id="api-key-input"
            class="input"
            .value=${state.apiKey}
            placeholder="AIzaSy..."
            autocomplete="current-password"
          />

          <label class="field-label" style="margin-top: 0.75rem;"
            >Model Selection</label
          >
          <select id="api-model-select" class="input" .value=${state.apiModel}>
            <option value="gemini-3.5-flash">
              Gemini 3.5 Flash (Fast, Recommended)
            </option>
            <option value="gemini-3-flash-preview">
              Gemini 3 Flash Preview
            </option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
            <option value="gemini-1.5-pro">
              Gemini 1.5 Pro (High Reasoning)
            </option>
          </select>

          <p class="field-hint" style="margin-top: 0.5rem;">
            Your key is stored locally in your browser's localStorage. No server
            is used.
          </p>
          <button
            type="submit"
            class="btn btn-primary"
            style="margin-top: 0.5rem;"
          >
            Save Configuration
          </button>
        </form>
      </div>
    </div>
  `;
};

const App = () => html`
  ${Header()} ${Sidebar()}
  <main
    class="main-content"
    style="grid-template-columns: ${state.leftPanelWidth}px 8px 1fr 8px ${state.rightPanelWidth}px;"
  >
    ${FileManagerPanel()}
    <div
      class="gutter gutter-left"
      @mousedown=${(e) => startResize(1, e)}
    ></div>
    ${ChatPanel()}
    <div
      class="gutter gutter-right"
      @mousedown=${(e) => startResize(2, e)}
    ></div>
    ${PdfPanel()}
  </main>
  ${ApiModal()}
`;

// --- RENDER LOOP ---
function update() {
  render(App(), document.getElementById("app"));
}

// Bootstrap
document.addEventListener("DOMContentLoaded", init);

function startResize(which, e) {
  e.preventDefault();
  state.isResizing = which; // 1 = left gutter, 2 = right gutter
  const startX = e.clientX;
  const startLeft = state.leftPanelWidth;
  const startRight = state.rightPanelWidth;
  document.body.style.userSelect = "none";

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const min = 160;
    const max = window.innerWidth - 400; // leave space
    if (which === 1) {
      let newLeft = Math.max(min, Math.min(max, startLeft + dx));
      state.leftPanelWidth = newLeft;
    } else {
      // dragging the right gutter: moving mouse right should decrease right width
      let newRight = Math.max(min, Math.min(max, startRight - dx));
      state.rightPanelWidth = newRight;
    }
    update();
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.userSelect = "";
    state.isResizing = false;
    localStorage.setItem("leftPanelWidth", state.leftPanelWidth);
    localStorage.setItem("rightPanelWidth", state.rightPanelWidth);
    update();
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
