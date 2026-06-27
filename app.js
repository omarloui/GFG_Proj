import { html, render } from 'https://unpkg.com/lit-html?module';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';

// Setup PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- STATE ---
const state = {
    activeTab: 'chat', // 'file', 'chat', 'pdf'
    theme: 'dark',
    apiKey: localStorage.getItem('gemini_api_key') || '',
    showApiModal: !localStorage.getItem('gemini_api_key'),
    files: [], // Array of file names
    searchQuery: '',
    chatHistory: [],
    isGenerating: false,
    error: null,

    // PDF Viewer state
    currentPdfName: null,
    pdfDoc: null,
    pageNum: 1,
    pageRendering: false,
    pageNumPending: null,

    // Context for Gemini
    documentsContext: ''
};

// --- INITIALIZATION ---
async function init() {
    await loadOpfsFiles();

    // Attempt to auto-import supporting docs if OPFS is empty (works if served via HTTP)
    if (state.files.length === 0) {
        await autoImportSupportingDocs();
    }

    // Extract text from all PDFs for Gemini context
    await extractAllContext();

    update();
}

async function autoImportSupportingDocs() {
    const docs = [
        'supporting docs/cdc-milestone-checklists-ltsae-english-508.pdf',
        'supporting docs/cdc-milestone-checklists-ltsae-arabic.pdf',
        'supporting docs/Clinical_Practice_Guideline_ASD.pdf'
    ];

    for (const docPath of docs) {
        try {
            const response = await fetch(docPath);
            if (response.ok) {
                const blob = await response.blob();
                const fileName = docPath.split('/').pop();
                await saveFileToOpfs(fileName, blob);
            }
        } catch (e) {
            console.warn('Could not auto-fetch', docPath, '- likely running on file:// protocol without a server.');
        }
    }
    await loadOpfsFiles();
}

// --- OPFS FILE SYSTEM ---
async function loadOpfsFiles() {
    try {
        const root = await navigator.storage.getDirectory();
        const files = [];
        for await (const [name, handle] of root.entries()) {
            if (handle.kind === 'file') {
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
    state.activeTab = 'pdf';
    state.currentPdfName = name;
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

function renderPage(num) {
    state.pageRendering = true;

    state.pdfDoc.getPage(num).then(function (page) {
        const canvas = document.getElementById('pdf-canvas');
        if (!canvas) {
            state.pageRendering = false;
            return;
        }
        const ctx = canvas.getContext('2d');

        // Scale appropriately for viewing
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
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
        let fullText = '';
        // Limit to first 10 pages for MVP to avoid huge memory spikes, or do all if small
        const maxPages = Math.min(pdf.numPages, 20);
        for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }
        return fullText;
    } catch (e) {
        console.error("Text extraction failed", e);
        return "";
    }
}

async function extractAllContext() {
    let combinedContext = "DOCUMENT CONTEXT:\n\n";
    for (const fileName of state.files) {
        if (fileName.toLowerCase().endsWith('.pdf')) {
            const file = await getFileBlob(fileName);
            const arrayBuffer = await file.arrayBuffer();
            const text = await extractTextFromPdf(arrayBuffer);
            combinedContext += `--- Document: ${fileName} ---\n${text}\n\n`;
        }
    }
    state.documentsContext = combinedContext;
}

// --- GEMINI API ---
async function sendChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input-field');
    const messageText = input.value.trim();
    if (!messageText) return;

    if (!state.apiKey) {
        state.showApiModal = true;
        update();
        return;
    }

    // Add user message
    state.chatHistory.push({ role: 'user', text: messageText });
    input.value = '';
    state.isGenerating = true;
    state.error = null;
    update();

    scrollToBottom();

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${state.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user', parts: [{
                            text: `You are an AI assistant for special education teachers. 
Use the following document context to answer the user's questions. 
If researching external info, rely ONLY on highly credible sources (.gov, .edu, .org, CDC, NIH).
Avoid commercial blogs. Present data clearly (using markdown tables or lists if helpful).

${state.documentsContext}

User Query:
${messageText}`
                        }]
                    }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

        state.chatHistory.push({
            role: 'model',
            text: replyText,
            html: marked.parse(replyText)
        });

    } catch (err) {
        let errorDetails = err.message;
        if (err.message.includes('429')) {
            errorDetails = "API Rate Limit Exceeded (429). Please wait a moment and try again.";
        }
        state.error = `Failed to get response: ${errorDetails}`;
        state.chatHistory.push({ role: 'model', text: "Error: Could not fetch response.", html: `<p class="error-text">Error connecting to Gemini API: ${errorDetails}</p>` });
    } finally {
        state.isGenerating = false;
        update();
        setTimeout(scrollToBottom, 50);
    }
}

function scrollToBottom() {
    const chatContainer = document.querySelector('.chat-messages');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// --- FILE MANAGER HANDLERS ---
async function handleFileUpload(e) {
    const files = e.target.files;
    if (!files.length) return;

    for (const file of files) {
        await saveFileToOpfs(file.name, file);
    }
    await extractAllContext();
}

async function downloadFile(name) {
    const file = await getFileBlob(name);
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
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
      <div class="status-dot ${state.apiKey ? 'ok' : 'err'} ${state.isGenerating ? 'loading' : ''}" title="${state.apiKey ? 'API Key Set' : 'No API Key'}"></div>
      <button class="btn-icon" @click=${() => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', state.theme);
        update();
    }}>
        <span class="material-symbols-rounded">${state.theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
      </button>
      <button class="btn-icon" @click=${() => { state.showApiModal = true; update(); }}>
        <span class="material-symbols-rounded">key</span>
      </button>
    </div>
  </header>
`;

const Sidebar = () => html`
  <aside class="sidebar">
    <button class="sidebar-btn ${state.activeTab === 'file' ? 'active' : ''}" @click=${() => { state.activeTab = 'file'; update(); }} title="File Manager">
      <span class="material-symbols-rounded">folder</span>
    </button>
    <button class="sidebar-btn ${state.activeTab === 'chat' ? 'active' : ''}" @click=${() => { state.activeTab = 'chat'; update(); }} title="AI Chat">
      <span class="material-symbols-rounded">forum</span>
    </button>
    <button class="sidebar-btn ${state.activeTab === 'pdf' ? 'active' : ''}" @click=${() => { state.activeTab = 'pdf'; update(); }} title="PDF Viewer">
      <span class="material-symbols-rounded">picture_as_pdf</span>
    </button>
    <div class="sidebar-spacer"></div>
  </aside>
`;

const FileManagerPanel = () => {
    const filteredFiles = state.files.filter(f => f.toLowerCase().includes(state.searchQuery.toLowerCase()));

    return html`
    <div class="panel ${state.activeTab === 'file' ? 'active' : ''}">
      <div class="panel-header">
        <h2><span class="material-symbols-rounded" style="margin-right: 8px;">folder</span> File Manager</h2>
        <div>
          <input type="file" id="file-upload" multiple style="display: none" @change=${handleFileUpload}>
          <button class="btn btn-primary" @click=${() => document.getElementById('file-upload').click()}>
            <span class="material-symbols-rounded">upload</span> Import Files
          </button>
        </div>
      </div>
      <div class="search-container">
        <span class="material-symbols-rounded search-icon">search</span>
        <input type="text" class="search-input" placeholder="Search files..." .value=${state.searchQuery} @input=${(e) => { state.searchQuery = e.target.value; update(); }}>
      </div>
      <div class="file-list">
        ${state.files.length === 0 ? html`
          <div class="empty-state">
            <span class="material-symbols-rounded">inventory_2</span>
            <p>No files found. Import PDFs or other documents to provide context to the AI.</p>
          </div>
        ` : filteredFiles.map(name => html`
          <div class="file-item" @click=${() => name.endsWith('.pdf') ? openPdf(name) : null}>
            <span class="material-symbols-rounded file-icon">${name.endsWith('.pdf') ? 'picture_as_pdf' : 'description'}</span>
            <div class="file-info">
              <span class="file-name">${name}</span>
              <span class="file-size">Stored in OPFS</span>
            </div>
            <div class="file-actions">
              <button class="btn-icon-sm" @click=${(e) => { e.stopPropagation(); downloadFile(name); }} title="Export">
                <span class="material-symbols-rounded">download</span>
              </button>
              <button class="btn-icon-sm" style="color: var(--red)" @click=${(e) => { e.stopPropagation(); deleteFileFromOpfs(name); }} title="Delete">
                <span class="material-symbols-rounded">delete</span>
              </button>
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
};

// Helper to safely render markdown HTML strings without needing the unsafeHTML directive
function renderHtml(htmlString) {
    const container = document.createElement('div');
    container.innerHTML = htmlString || '';
    return container;
}

const ChatPanel = () => html`
  <div class="panel ${state.activeTab === 'chat' ? 'active' : ''}">
    <div class="panel-header">
      <h2><span class="material-symbols-rounded" style="margin-right: 8px;">forum</span> AI Assistant</h2>
      <div class="context-badge" title="Context loaded from files">
        <span class="material-symbols-rounded" style="font-size: 14px; vertical-align: middle;">library_books</span>
        ${state.files.length} Docs Indexed
      </div>
    </div>
    
    ${state.error ? html`<div class="error-banner">${state.error}</div>` : ''}
    
    <div class="chat-messages">
      ${state.chatHistory.length === 0 ? html`
        <div class="empty-state">
          <span class="material-symbols-rounded">smart_toy</span>
          <p>Hello! I am your behavioral support assistant. Ask me to synthesize the CDC guidelines, or research interventions for ADHD and Autism.</p>
        </div>
      ` : ''}
      
      ${state.chatHistory.map(msg => html`
        <div class="message ${msg.role}">
          <div class="message-avatar">
            <span class="material-symbols-rounded">${msg.role === 'user' ? 'person' : 'smart_toy'}</span>
          </div>
          <div class="message-body">
            ${msg.role === 'user' ? msg.text : renderHtml(msg.html)}
          </div>
        </div>
      `)}
      
      ${state.isGenerating ? html`
        <div class="message model">
          <div class="message-avatar"><span class="material-symbols-rounded">smart_toy</span></div>
          <div class="message-body typing">
            <div class="dot"></div><div class="dot"></div><div class="dot"></div>
          </div>
        </div>
      ` : ''}
    </div>
    
    <form class="chat-input-area" @submit=${sendChatMessage}>
      <input type="text" id="chat-input-field" class="chat-input" placeholder="Type a message..." ?disabled=${state.isGenerating} autocomplete="off">
      <button type="submit" class="btn-send" ?disabled=${state.isGenerating}>
        <span class="material-symbols-rounded">send</span>
      </button>
    </form>
  </div>
`;

const PdfPanel = () => html`
  <div class="panel ${state.activeTab === 'pdf' ? 'active' : ''}">
    <div class="panel-header">
      <h2><span class="material-symbols-rounded" style="margin-right: 8px;">picture_as_pdf</span> ${state.currentPdfName || 'PDF Viewer'}</h2>
      <div class="pdf-nav">
        <button class="btn-icon-sm" @click=${onPrevPage} ?disabled=${!state.pdfDoc || state.pageNum <= 1}>
          <span class="material-symbols-rounded">chevron_left</span>
        </button>
        <span class="page-info">${state.pdfDoc ? `${state.pageNum} / ${state.pdfDoc.numPages}` : '0 / 0'}</span>
        <button class="btn-icon-sm" @click=${onNextPage} ?disabled=${!state.pdfDoc || state.pageNum >= state.pdfDoc.numPages}>
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
    </div>
    <div class="pdf-container">
      ${state.pdfDoc
        ? html`<canvas id="pdf-canvas"></canvas>`
        : html`
          <div class="empty-state">
            <span class="material-symbols-rounded">picture_as_pdf</span>
            <p>Select a PDF from the File Manager to view it here.</p>
            <button class="btn btn-primary" style="margin-top: 1rem" @click=${() => { state.activeTab = 'file'; update(); }}>
              Go to File Manager
            </button>
          </div>
        `}
    </div>
  </div>
`;

const ApiModal = () => {
    if (!state.showApiModal) return '';

    return html`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>API Configuration</h2>
          <button class="btn-icon-sm" @click=${() => { state.showApiModal = false; update(); }}>
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <div class="modal-body">
          <label class="field-label">Gemini API Key</label>
          <input type="password" id="api-key-input" class="input" .value=${state.apiKey} placeholder="AIzaSy...">
          <p class="field-hint">Your key is stored locally in your browser's localStorage. No server is used.</p>
          <button class="btn btn-primary" style="margin-top: 0.5rem;" @click=${() => {
            const key = document.getElementById('api-key-input').value.trim();
            state.apiKey = key;
            localStorage.setItem('gemini_api_key', key);
            state.showApiModal = false;
            update();
        }}>Save Key</button>
        </div>
      </div>
    </div>
  `;
};

const App = () => html`
  ${Header()}
  ${Sidebar()}
  <main class="main-content">
    ${FileManagerPanel()}
    ${ChatPanel()}
    ${PdfPanel()}
  </main>
  ${ApiModal()}
`;

// --- RENDER LOOP ---
function update() {
    render(App(), document.getElementById('app'));
}

// Bootstrap
document.addEventListener('DOMContentLoaded', init);
