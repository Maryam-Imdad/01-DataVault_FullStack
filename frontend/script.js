 const API_URL = "http://localhost:5000";
const fileInput = document.querySelector("#file-input");
const browseButton = document.querySelector("#browse-button");
const uploadCard = document.querySelector("#upload-card");
const selectedFile = document.querySelector("#selected-file");
const statusMessage = document.querySelector("#status-message");
const historyList = document.querySelector("#history-list");
let missingChart;

const formatNumber = (value) => new Intl.NumberFormat().format(value);
const setStatus = (message, isError = false) => {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
};

function renderChart(missing) {
  const canvas = document.querySelector("#missing-chart");
  const labels = Object.keys(missing);
  const values = Object.values(missing);
  document.querySelector("#chart-empty").style.display = labels.length ? "none" : "grid";
  if (missingChart) missingChart.destroy();
  missingChart = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ label: "Missing values", data: values, backgroundColor: "#8875e8", borderRadius: 5, barThickness: 16 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: (context) => ` ${context.raw} missing` } } },
      scales: { x: { grid: { display: false }, ticks: { color: "#9998b0", font: { size: 9 }, maxRotation: 35 } }, y: { beginAtZero: true, ticks: { precision: 0, color: "#aaa9bb", font: { size: 9 } }, grid: { color: "#efeff5" } } },
    },
  });
}

function renderTable(columns, rows) {
  const table = document.querySelector("#data-table");
  table.querySelector("thead").innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
  table.querySelector("tbody").innerHTML = rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td title="${escapeHtml(formatValue(row[column]))}">${escapeHtml(formatValue(row[column]))}</td>`).join("")}</tr>`).join("")
    : '<tr><td class="table-empty">This file has no data rows.</td></tr>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function formatValue(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function renderAnalysis(result) {
  const totalMissing = Object.values(result.missing).reduce((sum, count) => sum + count, 0);
  document.querySelector("#dataset-name").textContent = result.filename;
  document.querySelector("#row-count").textContent = formatNumber(result.shape.rows);
  document.querySelector("#column-count").textContent = formatNumber(result.shape.columns);
  document.querySelector("#missing-count").textContent = formatNumber(totalMissing);
  document.querySelector("#preview-count").textContent = `${result.head.length} rows`;
  renderTable(result.columns, result.head);
  renderChart(result.missing);
}

function renderHistory(items) {
  if (!items.length) {
    historyList.innerHTML = '<div class="history-empty">Your analyzed files will appear here.</div>';
    return;
  }
  historyList.innerHTML = items.map((item) => {
    const date = new Date(item.analyzed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return `<div class="history-item"><span class="file-badge">CSV</span><div class="history-details"><span class="history-name" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span><span class="history-meta">${formatNumber(item.rows)} rows · ${date}</span></div></div>`;
  }).join("");
}

async function loadHistory() {
  try {
    const response = await fetch(`${API_URL}/api/history`);
    if (response.ok) renderHistory(await response.json());
  } catch {
    const localHistory = JSON.parse(localStorage.getItem("datavault-history") || "[]");
    renderHistory(localHistory);
  }
}

async function analyzeFile(file) {
  if (!file || !file.name.toLowerCase().endsWith(".csv")) {
    setStatus("Please select a CSV file.", true);
    return;
  }
  selectedFile.textContent = `Selected: ${file.name}`;
  setStatus("Analyzing your data…");
  uploadCard.classList.add("is-loading");
  const formData = new FormData();
  formData.append("file", file);
  try {
    const response = await fetch(`${API_URL}/api/analyze`, { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Analysis failed.");
    renderAnalysis(result);
    const localHistory = JSON.parse(localStorage.getItem("datavault-history") || "[]");
    localStorage.setItem("datavault-history", JSON.stringify([{ filename: result.filename, rows: result.shape.rows, analyzed_at: result.analyzed_at }, ...localHistory.filter((item) => item.filename !== result.filename)].slice(0, 20)));
    setStatus(`Analysis complete — ${result.filename} is ready.`);
    await loadHistory();
  } catch (error) {
    setStatus(`${error.message} Make sure the Flask API is running on port 5000.`, true);
  } finally {
    uploadCard.classList.remove("is-loading");
  }
}

browseButton.addEventListener("click", () => fileInput.click());
uploadCard.addEventListener("click", (event) => { if (event.target !== browseButton) fileInput.click(); });
fileInput.addEventListener("change", () => analyzeFile(fileInput.files[0]));
["dragenter", "dragover"].forEach((eventName) => uploadCard.addEventListener(eventName, (event) => { event.preventDefault(); uploadCard.classList.add("dragging"); }));
["dragleave", "drop"].forEach((eventName) => uploadCard.addEventListener(eventName, (event) => { event.preventDefault(); uploadCard.classList.remove("dragging"); }));
uploadCard.addEventListener("drop", (event) => analyzeFile(event.dataTransfer.files[0]));
document.querySelector("#clear-history").addEventListener("click", () => { localStorage.removeItem("datavault-history"); renderHistory([]); });
renderChart({});
loadHistory();