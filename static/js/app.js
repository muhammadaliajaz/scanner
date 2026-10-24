/* ── Smart QR & Barcode Tool – Frontend Logic ──────────────────────────────── */

// ── State ──────────────────────────────────────────────────────────────────────
let qrScanner = null;
let bcScanner = null;
let currentScanMode = "upload";
let currentBCScanMode = "upload";

// ── Tab Switching ──────────────────────────────────────────────────────────────

function switchTab(tabId) {
    document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    document.getElementById("tab-" + tabId).classList.add("active");
    document.querySelector(`[data-tab="${tabId}"]`).classList.add("active");

    // Stop cameras when switching away
    if (tabId !== "qr-scan") stopCamera();
    if (tabId !== "bc-scan") stopBCCamera();
}

// ── QR Code Generator ─────────────────────────────────────────────────────────

function updateQRPlaceholder() {
    const type = document.getElementById("qrContentType").value;
    document.getElementById("qrTextGroup").classList.toggle("hidden", type !== "text");
    document.getElementById("qrWifiGroup").classList.toggle("hidden", type !== "wifi");
    document.getElementById("qrVcardGroup").classList.toggle("hidden", type !== "vcard");
}

function getQRText() {
    const type = document.getElementById("qrContentType").value;
    if (type === "text") {
        return document.getElementById("qrText").value.trim();
    }
    if (type === "wifi") {
        const ssid = document.getElementById("qrWifiSSID").value.trim();
        const pass = document.getElementById("qrWifiPass").value.trim();
        const enc = document.getElementById("qrWifiEnc").value;
        return `WIFI:T:${enc};S:${ssid};P:${pass};;`;
    }
    if (type === "vcard") {
        const name = document.getElementById("qrVcardName").value.trim();
        const phone = document.getElementById("qrVcardPhone").value.trim();
        const email = document.getElementById("qrVcardEmail").value.trim();
        const org = document.getElementById("qrVcardOrg").value.trim();
        return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL:${phone}\nEMAIL:${email}\nORG:${org}\nEND:VCARD`;
    }
    return "";
}

async function generateQR() {
    const text = getQRText();
    if (!text) { showToast("Please enter content for the QR code"); return; }

    const btn = document.getElementById("qrGenBtn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating...';

    const fgColor = document.getElementById("qrFgColor").value;
    const bgColor = document.getElementById("qrBgColor").value;
    const size = document.getElementById("qrSize").value;
    const ec = document.getElementById("qrEC").value;

    const body = { text, fill_color: fgColor, back_color: bgColor, size: parseInt(size), error_correction: ec };

    // Logo upload
    const logoInput = document.getElementById("qrLogo");
    if (logoInput.files.length > 0) {
        const formData = new FormData();
        formData.append("file", logoInput.files[0]);
        try {
            const upRes = await fetch("/api/scan", { method: "POST", body: formData });
            // We just need a temp path — use a separate upload endpoint approach
            // For simplicity, read as data URL and pass as logo
            const reader = new FileReader();
            const dataUrl = await new Promise(resolve => {
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(logoInput.files[0]);
            });
            body.logo = dataUrl;
        } catch (e) { /* ignore logo errors */ }
    }

    try {
        const res = await fetch("/api/generate/qr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) { showToast(data.error); return; }

        const preview = document.getElementById("qrPreview");
        preview.innerHTML = `<img src="/api/download/${data.id}.png?t=${Date.now()}" alt="Generated QR Code">`;

        document.getElementById("qrDlPng").href = data.files.png;
        document.getElementById("qrDlJpg").href = data.files.jpg;
        document.getElementById("qrDlSvg").href = data.files.svg;
        document.getElementById("qrDownloadBtns").classList.remove("hidden");

        showToast("QR code generated!");
    } catch (e) {
        showToast("Error generating QR code: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Generate QR Code";
    }
}

// ── Barcode Generator ─────────────────────────────────────────────────────────

function updateBCPlaceholder() {
    const fmt = document.getElementById("bcFormat").value;
    const input = document.getElementById("bcText");
    const placeholders = {
        code128: "Enter any text or number...",
        code39: "Enter uppercase letters and numbers...",
        ean13: "Enter 12 or 13 digits...",
        ean8: "Enter 7 or 8 digits...",
        upca: "Enter 11 or 12 digits...",
        upce: "Enter 6 or 8 digits...",
        itf: "Enter even number of digits...",
        codabar: "Enter digits with A-D start/stop...",
    };
    input.placeholder = placeholders[fmt] || "Enter barcode value...";
}

async function generateBarcode() {
    const text = document.getElementById("bcText").value.trim();
    const fmt = document.getElementById("bcFormat").value;
    if (!text) { showToast("Please enter a barcode value"); return; }

    const btn = document.getElementById("bcGenBtn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating...';

    try {
        const res = await fetch("/api/generate/barcode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, format: fmt }),
        });
        const data = await res.json();
        if (data.error) { showToast(data.error); return; }

        const preview = document.getElementById("bcPreview");
        preview.innerHTML = `<img src="/api/download/${data.id}.png?t=${Date.now()}" alt="Generated Barcode">`;

        document.getElementById("bcDlPng").href = data.files.png;
        document.getElementById("bcDlJpg").href = data.files.jpg;
        document.getElementById("bcDlSvg").href = data.files.svg;
        document.getElementById("bcDownloadBtns").classList.remove("hidden");

        showToast("Barcode generated!");
    } catch (e) {
        showToast("Error generating barcode: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Generate Barcode";
    }
}

// ── QR Scanner ────────────────────────────────────────────────────────────────

function setScanMode(mode) {
    currentScanMode = mode;
    document.getElementById("scanModeUpload").classList.toggle("active", mode === "upload");
    document.getElementById("scanModeCamera").classList.toggle("active", mode === "camera");
    document.getElementById("scanUploadZone").classList.toggle("hidden", mode !== "upload");
    document.getElementById("scanCameraZone").classList.toggle("hidden", mode !== "camera");

    if (mode === "camera") startQRCamera();
    else stopCamera();
}

function startQRCamera() {
    const container = document.getElementById("qrScanner");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        container.innerHTML = `
            <div class="empty-state py-8">
                <svg class="w-12 h-12 text-amber-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
                <p class="text-amber-600 font-semibold">Camera not available</p>
                <p class="text-gray-500 text-sm mt-1">Camera requires HTTPS or localhost. Please use the <strong>Upload Image</strong> option instead.</p>
            </div>`;
        return;
    }
    if (qrScanner) { try { qrScanner.clear(); } catch(e) {} qrScanner = null; }
    qrScanner = new Html5Qrcode("qrScanner");
    qrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        onQRScanSuccess,
        () => {}
    ).catch(err => {
        container.innerHTML = `
            <div class="empty-state py-8">
                <svg class="w-12 h-12 text-amber-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                <p class="text-amber-600 font-semibold">Camera access denied</p>
                <p class="text-gray-500 text-sm mt-1">Please allow camera access in your browser, or use <strong>Upload Image</strong> instead.</p>
            </div>`;
    });
}

function onQRScanSuccess(decodedText, decodedResult) {
    // Stop after first successful scan
    if (qrScanner) {
        qrScanner.stop().then(() => {
            displayScanResults([{
                data: decodedText,
                type: decodedResult?.result?.format?.formatName || "QR_CODE",
            }]);
            showToast("QR code scanned!");
        }).catch(() => {});
    }
}

function stopCamera() {
    if (qrScanner) {
        try { qrScanner.stop().then(() => qrScanner.clear()).catch(() => {}); } catch(e) {}
        qrScanner = null;
    }
}

async function scanFromFile(file) {
    // Try server-side scan first
    const formData = new FormData();
    formData.append("file", file);
    try {
        const res = await fetch("/api/scan", { method: "POST", body: formData });
        const data = await res.json();
        if (data.use_client) {
            // Server pyzbar unavailable, use client-side scan
            return clientSideScanFile(file, displayScanResults);
        }
        if (data.error) { showToast(data.error); return; }
        displayScanResults(data.results);
        if (data.results.length > 0) showToast(`Found ${data.results.length} code(s)!`);
        else showToast("No codes found in image");
        return;
    } catch (e) {
        // Network error, try client-side
    }
    return clientSideScanFile(file, displayScanResults);
}

async function clientSideScanFile(file, displayFn) {
    const containerId = "clientScanContainer";
    let html5QrCode = null;
    try {
        // Clear any previous scanner instance on the container
        try { await Html5Qrcode.getCameras(); } catch(e) {} // dummy call to ensure library is loaded
        
        html5QrCode = new Html5Qrcode(containerId);
        const results = await html5QrCode.scanFile(file, /* verbose= */ false);
        const decoded = [{ data: results, type: "QR_CODE" }];
        displayFn(decoded);
        showToast("Code scanned (client-side)!");
    } catch (e) {
        // Clean up scanner instance if it was created
        if (html5QrCode) {
            try { html5QrCode.clear(); } catch(c) {}
        }
        showToast("No codes found in image (client-side scan)");
    }
}

function displayScanResults(results) {
    const container = document.getElementById("scanResults");
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="empty-state"><p class="text-gray-400">No codes detected</p></div>';
        return;
    }
    container.innerHTML = results.map(r => `
        <div class="result-card">
            <div class="result-meta">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800">${escHtml(r.type)}</span>
            </div>
            <div class="result-data">${escHtml(r.data)}</div>
            <div class="flex gap-2 mt-2">
                <button onclick="copyToClipboard('${escAttr(r.data)}')" class="btn-secondary text-xs">Copy</button>
                ${r.data.startsWith('http') ? `<a href="${escAttr(r.data)}" target="_blank" class="btn-secondary text-xs">Open Link</a>` : ''}
            </div>
        </div>
    `).join("");
}

function handleScanUpload(input) {
    if (input.files.length > 0) scanFromFile(input.files[0]);
}

// ── Barcode Scanner ───────────────────────────────────────────────────────────

function setBCScanMode(mode) {
    currentBCScanMode = mode;
    document.getElementById("bcScanModeUpload").classList.toggle("active", mode === "upload");
    document.getElementById("bcScanModeCamera").classList.toggle("active", mode === "camera");
    document.getElementById("bcScanUploadZone").classList.toggle("hidden", mode !== "upload");
    document.getElementById("bcScanCameraZone").classList.toggle("hidden", mode !== "camera");

    if (mode === "camera") startBCCamera();
    else stopBCCamera();
}

function startBCCamera() {
    const container = document.getElementById("bcScanner");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        container.innerHTML = `
            <div class="empty-state py-8">
                <svg class="w-12 h-12 text-amber-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
                <p class="text-amber-600 font-semibold">Camera not available</p>
                <p class="text-gray-500 text-sm mt-1">Camera requires HTTPS or localhost. Please use the <strong>Upload Image</strong> option instead.</p>
            </div>`;
        return;
    }
    if (bcScanner) { try { bcScanner.clear(); } catch(e) {} bcScanner = null; }
    bcScanner = new Html5Qrcode("bcScanner");
    bcScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0, formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.CODABAR,
        ]},
        onBCScanSuccess,
        () => {}
    ).catch(err => {
        container.innerHTML = `
            <div class="empty-state py-8">
                <svg class="w-12 h-12 text-amber-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                <p class="text-amber-600 font-semibold">Camera access denied</p>
                <p class="text-gray-500 text-sm mt-1">Please allow camera access in your browser, or use <strong>Upload Image</strong> instead.</p>
            </div>`;
    });
}

function onBCScanSuccess(decodedText, decodedResult) {
    if (bcScanner) {
        bcScanner.stop().then(() => {
            displayBCScanResults([{
                data: decodedText,
                type: decodedResult?.result?.format?.formatName || "BARCODE",
            }]);
            showToast("Barcode scanned!");
        }).catch(() => {});
    }
}

function stopBCCamera() {
    if (bcScanner) {
        try { bcScanner.stop().then(() => bcScanner.clear()).catch(() => {}); } catch(e) {}
        bcScanner = null;
    }
}

async function bcScanFromFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    try {
        const res = await fetch("/api/scan", { method: "POST", body: formData });
        const data = await res.json();
        if (data.use_client) {
            return clientSideScanFile(file, displayBCScanResults);
        }
        if (data.error) { showToast(data.error); return; }
        displayBCScanResults(data.results);
        if (data.results.length > 0) showToast(`Found ${data.results.length} code(s)!`);
        else showToast("No barcodes found in image");
        return;
    } catch (e) {
        // Network error, try client-side
    }
    return clientSideScanFile(file, displayBCScanResults);
}

function displayBCScanResults(results) {
    const container = document.getElementById("bcScanResults");
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="empty-state"><p class="text-gray-400">No barcodes detected</p></div>';
        return;
    }
    container.innerHTML = results.map(r => `
        <div class="result-card">
            <div class="result-meta">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-accent-100 text-accent-800">${escHtml(r.type)}</span>
            </div>
            <div class="result-data">${escHtml(r.data)}</div>
            <div class="flex gap-2 mt-2">
                <button onclick="copyToClipboard('${escAttr(r.data)}')" class="btn-secondary text-xs">Copy</button>
            </div>
        </div>
    `).join("");
}

function handleBCScanUpload(input) {
    if (input.files.length > 0) bcScanFromFile(input.files[0]);
}

// ── Batch Operations ──────────────────────────────────────────────────────────

async function batchGenerate() {
    const itemsText = document.getElementById("batchItems").value.trim();
    if (!itemsText) { showToast("Enter at least one value"); return; }

    const items = itemsText.split("\n").filter(l => l.trim()).map(l => ({ text: l.trim() }));
    const codeType = document.getElementById("batchCodeType").value;
    const fmt = document.getElementById("batchBarcodeFormat").value;

    try {
        const res = await fetch("/api/generate/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items, code_type: codeType, format: fmt }),
        });
        const data = await res.json();
        if (data.error) { showToast(data.error); return; }

        const container = document.getElementById("batchResults");
        container.innerHTML = data.results.map(r => {
            if (r.error) return `<div class="batch-item"><div class="batch-data text-red-600">${escHtml(r.text)}: ${escHtml(r.error)}</div></div>`;
            return `<div class="batch-item">
                <img src="/api/download/${r.id}.png?t=${Date.now()}" alt="${escAttr(r.text)}">
                <div class="batch-data">${escHtml(r.text)}</div>
                <a href="${r.download}" class="batch-dl" download>Download</a>
            </div>`;
        }).join("");

        showToast(`Generated ${data.results.length} code(s)!`);
    } catch (e) {
        showToast("Batch error: " + e.message);
    }
}

async function batchScanFiles(files) {
    const formData = new FormData();
    for (const f of files) formData.append("files", f);

    try {
        const res = await fetch("/api/scan/batch", { method: "POST", body: formData });
        const data = await res.json();
        if (data.error) { showToast(data.error); return; }

        const container = document.getElementById("batchResults");
        container.innerHTML = data.results.map(r => {
            if (r.error) return `<div class="batch-item"><div class="batch-data text-red-600">${escHtml(r.filename)}: ${escHtml(r.error)}</div></div>`;
            const codes = r.results.map(c => `${c.type}: ${c.data}`).join(", ") || "No codes found";
            return `<div class="batch-item">
                <div class="batch-data"><strong>${escHtml(r.filename)}</strong><br>${escHtml(codes)}</div>
                <button onclick="copyToClipboard('${escAttr(codes)}')" class="batch-dl">Copy</button>
            </div>`;
        }).join("");

        showToast(`Scanned ${data.results.length} file(s)!`);
    } catch (e) {
        showToast("Batch scan error: " + e.message);
    }
}

function handleBatchUpload(input) {
    if (input.files.length > 0) batchScanFiles(input.files);
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add("drag-over");
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove("drag-over");
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    const files = e.dataTransfer.files;
    if (files.length > 0) scanFromFile(files[0]);
}

function handleBCDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    const files = e.dataTransfer.files;
    if (files.length > 0) bcScanFromFile(files[0]);
}

function handleBatchDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    const files = e.dataTransfer.files;
    if (files.length > 0) batchScanFiles(files);
}

// Click-to-browse on drop zones
document.addEventListener("DOMContentLoaded", () => {
    // QR scan drop zone
    const scanZone = document.getElementById("scanUploadZone");
    if (scanZone) scanZone.addEventListener("click", () => document.getElementById("scanFileInput").click());

    // Barcode scan drop zone
    const bcZone = document.getElementById("bcScanUploadZone");
    if (bcZone) bcZone.addEventListener("click", () => document.getElementById("bcScanFileInput").click());

    // Batch drop zone
    const batchZone = document.getElementById("batchDropZone");
    if (batchZone) batchZone.addEventListener("click", () => document.getElementById("batchFileInput").click());

    // Batch code type toggle
    const batchCodeType = document.getElementById("batchCodeType");
    if (batchCodeType) {
        batchCodeType.addEventListener("change", () => {
            document.getElementById("batchBarcodeFormatGroup").classList.toggle("hidden", batchCodeType.value !== "barcode");
        });
    }

    // Color sync
    document.getElementById("qrFgColor").addEventListener("input", function() {
        document.getElementById("qrFgColorText").value = this.value;
    });
    document.getElementById("qrBgColor").addEventListener("input", function() {
        document.getElementById("qrBgColorText").value = this.value;
    });

    // Load history on start
    loadHistory();
});

// ── History Panel ─────────────────────────────────────────────────────────────

function toggleHistory() {
    const sidebar = document.getElementById("historySidebar");
    const overlay = document.getElementById("historyOverlay");
    const isOpen = !sidebar.classList.contains("translate-x-full");

    if (isOpen) {
        sidebar.classList.add("translate-x-full");
        overlay.classList.add("hidden");
    } else {
        sidebar.classList.remove("translate-x-full");
        overlay.classList.remove("hidden");
        loadHistory();
    }
}

async function loadHistory() {
    try {
        const res = await fetch("/api/history");
        const data = await res.json();
        const container = document.getElementById("historyList");

        if (!data.history || data.history.length === 0) {
            container.innerHTML = '<div class="empty-state py-8"><p class="text-gray-400">No history yet</p></div>';
            return;
        }

        container.innerHTML = data.history.map(h => {
            const isGen = h.action === "generate";
            const icon = isGen ? "gen" : "scan";
            const label = isGen ? "GEN" : "SCAN";
            const time = new Date(h.timestamp).toLocaleString();
            return `<div class="history-item">
                <div class="hi-icon ${icon}">${label}</div>
                <div class="hi-body">
                    <div class="hi-type">${escHtml(h.code_type)}${h.format ? " · " + escHtml(h.format) : ""}</div>
                    <div class="hi-data" title="${escAttr(h.data)}">${escHtml(h.data)}</div>
                    <div class="hi-time">${time}</div>
                </div>
                <button onclick="copyToClipboard('${escAttr(h.data)}')" class="text-xs text-primary-600 hover:text-primary-800 shrink-0" title="Copy">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                </button>
            </div>`;
        }).join("");
    } catch (e) {
        console.error("History load error:", e);
    }
}

async function clearHistory() {
    try {
        await fetch("/api/history/clear", { method: "POST" });
        loadHistory();
        showToast("History cleared");
    } catch (e) { /* ignore */ }
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast("Copied to clipboard!");
    } catch {
        // Fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast("Copied to clipboard!");
    }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

function escAttr(str) {
    return (str || "").replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "\\n");
}
