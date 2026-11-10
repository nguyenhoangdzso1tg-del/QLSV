/* =========================================================
   DANH SÁCH ĐIỂM DANH
   - Mặc định chỉ đọc dữ liệu của MỘT NGÀY (tiết kiệm lượt đọc).
   - Cache 5 phút theo ngày + cache trong RAM.
   - "Tải tất cả ngày" là thao tác chủ động (có cảnh báo).
   - Lọc theo ngày / lớp / buổi / trạng thái, xuất Excel, xóa bản ghi.
   ========================================================= */
import { db } from "./firebase.js";
import { requireApproved, canManage, applyProfileUI } from "./app-auth.js";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  deleteDoc,
  limit
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ---------- 0. Bảo vệ trang ---------- */
const profile = await requireApproved();
if (!profile) {
  // requireApproved đã chuyển trang hoặc hiện thông báo — dừng module tại đây
  await new Promise(() => {});
}

const COSO = profile.coso || localStorage.getItem("coso") || "";
const canDelete = canManage(profile);
applyProfileUI(profile);

const cosoTitle = document.getElementById("cosoTitle");
if (cosoTitle) cosoTitle.textContent = "Cơ sở " + COSO;

/* ---------- 1. Hằng số ---------- */
const LABEL = {
  khong_vang: "Không vắng",
  vang_co_phep: "Vắng có phép",
  vang_khong_phep: "Vắng không phép"
};
const BADGE = {
  khong_vang: "kv",
  vang_co_phep: "cp",
  vang_khong_phep: "kp"
};

const PER_PAGE = 50;

const DAY_CACHE_PREFIX = "dd_list_v1_";
const DAY_CACHE_TTL = 5 * 60 * 1000; // 5 phút
const ALL_CACHE_KEY = "dd_list_all_v1";

const dateMemory = new Map();   // "coso|ngay" -> rows
const allMemory = new Map();    // coso -> rows (chỉ khi bấm "Tải tất cả")

/* ---------- 2. State ---------- */
let allRows = [];        // dữ liệu của chế độ đang xem (1 ngày hoặc tất cả)
let filteredRows = [];   // sau khi lọc
let currentPage = 1;
let currentFilter = { ngay: "", lop: "", buoi: "", trangThai: "" };
let loadedMode = "";     // "date" | "all" | ""
let loadedDate = "";
let allLoaded = false;

/* ---------- 3. Tiện ích ---------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayCacheKey(ngay) {
  return DAY_CACHE_PREFIX + encodeURIComponent(COSO) + "_" + ngay;
}

function readCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeCache(key, rows) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    /* localStorage đầy hoặc bị chặn — vẫn dùng cache RAM */
  }
}

function normalizeRow(d) {
  const v = d.data() || {};
  return {
    id: d.id,
    ngay: v.ngay || "",
    buoi: v.buoi === "chieu" ? "chieu" : "sang",
    maSV: v.maSV || "",
    tenSV: v.tenSV || "",
    lop: v.lop || "",
    khoaHoc: v.khoaHoc || "",
    khoa: v.khoa || "",
    trangThai: v.trangThai || "khong_vang",
    nguoiNhap: v.nguoiNhap || ""
  };
}

function sortRows(rows) {
  rows.sort((a, b) => {
    const d1 = String(b.ngay).localeCompare(String(a.ngay));
    if (d1 !== 0) return d1;
    const d2 = (a.buoi === "sang" ? 0 : 1) - (b.buoi === "sang" ? 0 : 1);
    if (d2 !== 0) return d2;
    const d3 = String(a.lop).localeCompare(String(b.lop), "vi");
    if (d3 !== 0) return d3;
    return String(a.tenSV).localeCompare(String(b.tenSV), "vi");
  });
  return rows;
}

function isIndexError(e) {
  return (
    e &&
    (e.code === "failed-precondition" ||
      /requires an index|composite index|index/i.test(String(e.message || "")))
  );
}

/* ---------- 4. Tải dữ liệu ---------- */
async function fetchRowsForDate(ngay, { force = false } = {}) {
  const memKey = COSO + "|" + ngay;

  if (!force && dateMemory.has(memKey)) return dateMemory.get(memKey);

  const cacheKey = dayCacheKey(ngay);

  if (!force) {
    const cached = readCache(cacheKey);
    if (cached && cached.at && Date.now() - cached.at < DAY_CACHE_TTL) {
      const rows = Array.isArray(cached.rows) ? cached.rows : [];
      dateMemory.set(memKey, rows);
      return rows;
    }
  }

  // Chỉ đọc đúng ngày đang xem (index: coso + ngay).
  let snap;
  try {
    snap = await getDocs(
      query(
        collection(db, "diemdanh"),
        where("coso", "==", COSO),
        where("ngay", "==", ngay),
        limit(1000)
      )
    );
  } catch (e) {
    if (isIndexError(e)) {
      throw new Error(
        "Firestore chưa có composite index cho diemdanh (coso + ngay). " +
        "Hãy deploy firestore.indexes.json (firebase deploy --only firestore:indexes) rồi thử lại."
      );
    }
    throw e;
  }

  const rows = [];
  snap.forEach(d => {
    const row = normalizeRow(d);
    // Danh sách chỉ quản lý VẮNG — bỏ qua bản ghi "không vắng" (dữ liệu cũ)
    if (row.trangThai === "khong_vang") return;
    rows.push(row);
  });

  sortRows(rows);
  dateMemory.set(memKey, rows);
  writeCache(cacheKey, rows);

  if (snap.size >= 1000) {
    console.warn("Một ngày có từ 1000 bản ghi trở lên — có thể chưa tải hết.");
  }

  return rows;
}

async function fetchAllRows({ force = false } = {}) {
  if (!force && allMemory.has(COSO)) return allMemory.get(COSO);

  if (!force) {
    const cached = readCache(ALL_CACHE_KEY + "_" + encodeURIComponent(COSO));
    if (cached && cached.at && Date.now() - cached.at < DAY_CACHE_TTL) {
      const rows = Array.isArray(cached.rows) ? cached.rows : [];
      allMemory.set(COSO, rows);
      return rows;
    }
  }

  const snap = await getDocs(
    query(collection(db, "diemdanh"), where("coso", "==", COSO))
  );

  const rows = [];
  snap.forEach(d => {
    const row = normalizeRow(d);
    if (row.trangThai === "khong_vang") return;
    rows.push(row);
  });

  sortRows(rows);
  allMemory.set(COSO, rows);
  writeCache(ALL_CACHE_KEY + "_" + encodeURIComponent(COSO), rows);
  return rows;
}

/* ---------- 5. Danh sách lớp (chỉ từ dữ liệu đang xem — không quét students) ---------- */
function fillLopOptions() {
  const sel = document.getElementById("filterLop");
  if (!sel) return;

  const keep = sel.value || "";
  const set = new Set();

  allRows.forEach(r => { if (r.lop) set.add(r.lop); });

  const lops = [...set].sort((a, b) => a.localeCompare(b, "vi"));

  sel.innerHTML = '<option value="">Tất cả lớp</option>';
  lops.forEach(lop => {
    const opt = document.createElement("option");
    opt.value = lop;
    opt.textContent = lop;
    sel.appendChild(opt);
  });

  if (keep && lops.includes(keep)) sel.value = keep;
}

/* ---------- 6. Lọc + render ---------- */
function applyFilter() {
  filteredRows = allRows.filter(r => {
    if (currentFilter.ngay && r.ngay !== currentFilter.ngay) return false;
    if (currentFilter.lop && r.lop !== currentFilter.lop) return false;
    if (currentFilter.buoi && (r.buoi || "sang") !== currentFilter.buoi) return false;
    if (currentFilter.trangThai && r.trangThai !== currentFilter.trangThai) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;

  renderSummary();
  renderTable();
}

function renderSummary() {
  const total = filteredRows.length;
  const kp = filteredRows.filter(r => r.trangThai === "vang_khong_phep").length;
  const cp = filteredRows.filter(r => r.trangThai === "vang_co_phep").length;

  document.getElementById("sumTotal").textContent = total;
  document.getElementById("sumCP").textContent = cp;
  document.getElementById("sumKP").textContent = kp;
}

function emptyMessage() {
  if (loadedMode === "date" && loadedDate) {
    return `Không có dữ liệu điểm danh ngày ${loadedDate}. Chọn ngày khác hoặc bấm “Tải tất cả ngày”.`;
  }
  if (loadedMode === "all") {
    return "Không có dữ liệu điểm danh.";
  }
  return "Chọn một ngày rồi bấm Lọc — hoặc bấm “Tải tất cả ngày” để xem toàn bộ.";
}

function renderTable() {
  const tbody = document.getElementById("list");
  tbody.innerHTML = "";

  if (!filteredRows.length) {
    tbody.innerHTML =
      `<tr><td colspan="11" class="empty">${esc(emptyMessage())}</td></tr>`;
    renderPagination(0);
    return;
  }

  const start = (currentPage - 1) * PER_PAGE;
  const pageRows = filteredRows.slice(start, start + PER_PAGE);

  pageRows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${start + i + 1}</td>
      <td class="cell-ma">${esc(r.maSV)}</td>
      <td class="cell-ten">${esc(r.tenSV)}<div class="lop-sub">${esc(r.lop)} · ${esc(r.khoaHoc)}</div></td>
      <td class="cell-lop">${esc(r.lop)}</td>
      <td>${esc(r.khoaHoc)}</td>
      <td style="text-align:left;">${esc(r.khoa)}</td>
      <td>${esc(r.ngay)}</td>
      <td>${r.buoi === "chieu" ? "Chiều" : "Sáng"}</td>
      <td><span class="badge ${BADGE[r.trangThai] || "kv"}">${esc(LABEL[r.trangThai] || r.trangThai)}</span></td>
      <td>${esc(r.nguoiNhap)}</td>
      <td>
        ${canDelete
          ? `<button class="btn-delete" title="Xóa bản ghi này">
               <i class="fa-solid fa-trash-can"></i>
             </button>`
          : `<span style="color:#94a3b8;">—</span>`}
      </td>
    `;

    const delBtn = tr.querySelector(".btn-delete");
    if (delBtn) delBtn.addEventListener("click", () => xoaBanGhi(r));
    tbody.appendChild(tr);
  });

  renderPagination(filteredRows.length);
}

function renderPagination(totalItems) {
  const totalPages = Math.ceil(totalItems / PER_PAGE);
  const cBottom = document.getElementById("pagination");
  const cTop = document.getElementById("paginationTop");
  cBottom.innerHTML = "";
  cTop.innerHTML = "";

  if (totalPages <= 1) return;

  function makeBtn(page, text = page) {
    const b = document.createElement("button");
    b.innerText = text;
    b.onclick = () => {
      currentPage = page;
      renderTable();
      renderPagination(filteredRows.length);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    if (page === currentPage) {
      b.style.background = "#2563eb";
      b.style.color = "white";
    }
    return b;
  }

  function render(container) {
    if (currentPage > 1) container.appendChild(makeBtn(currentPage - 1, "←"));
    container.appendChild(makeBtn(1));

    if (currentPage > 3) {
      const dot = document.createElement("span");
      dot.innerText = "...";
      container.appendChild(dot);
    }

    for (let i = currentPage - 1; i <= currentPage + 1; i++) {
      if (i > 1 && i < totalPages) container.appendChild(makeBtn(i));
    }

    if (currentPage < totalPages - 2) {
      const dot = document.createElement("span");
      dot.innerText = "...";
      container.appendChild(dot);
    }

    if (totalPages > 1) container.appendChild(makeBtn(totalPages));
    if (currentPage < totalPages) container.appendChild(makeBtn(currentPage + 1, "→"));
  }

  render(cTop);
  render(cBottom);
}

function showLoading() {
  const tbody = document.getElementById("list");
  if (!tbody) return;
  tbody.innerHTML =
    '<tr><td colspan="11" class="empty">Đang tải dữ liệu…</td></tr>';
  document.getElementById("sumTotal").textContent = "…";
  document.getElementById("sumCP").textContent = "…";
  document.getElementById("sumKP").textContent = "…";
}

/* ---------- 7. Điều khiển tải theo ngày ---------- */
async function loadDate(ngay) {
  if (!ngay) {
    allRows = [];
    filteredRows = [];
    loadedMode = "";
    loadedDate = "";
    renderSummary();
    renderTable();
    return;
  }

  showLoading();

  try {
    const rows = await fetchRowsForDate(ngay);
    allRows = rows;
    filteredRows = [];
    loadedMode = "date";
    loadedDate = ngay;
    currentFilter.ngay = ngay;
    fillLopOptions();
    applyFilter();
  } catch (e) {
    console.error(e);
    const tbody = document.getElementById("list");
    tbody.innerHTML =
      `<tr><td colspan="11" class="empty">Lỗi tải dữ liệu: ${esc(e.message || e)}</td></tr>`;
    document.getElementById("sumTotal").textContent = "0";
    document.getElementById("sumCP").textContent = "0";
    document.getElementById("sumKP").textContent = "0";
    renderPagination(0);
  }
}

async function loadEverything() {
  if (!confirm(
    "Tải toàn bộ điểm danh của cơ sở về máy?\n" +
    "Việc này có thể tốn nhiều lượt đọc Firestore. Chỉ nên dùng khi cần xem mọi ngày.\n\nTiếp tục?"
  )) return;

  const btn = document.getElementById("btnLoadAll");
  const old = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải…';
  }

  showLoading();

  try {
    const rows = await fetchAllRows({ force: true });
    allRows = rows;
    allLoaded = true;
    loadedMode = "all";
    loadedDate = "";
    currentFilter = { ngay: "", lop: "", buoi: "", trangThai: "" };
    document.getElementById("filterDate").value = "";
    document.getElementById("filterLop").value = "";
    document.getElementById("filterBuoi").value = "";
    document.getElementById("filterStatus").value = "";
    currentPage = 1;
    fillLopOptions();
    applyFilter();
  } catch (e) {
    console.error(e);
    const tbody = document.getElementById("list");
    tbody.innerHTML =
      `<tr><td colspan="11" class="empty">Lỗi tải dữ liệu: ${esc(e.message || e)}</td></tr>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }
}

/* ---------- 8. Xóa ---------- */
async function xoaBanGhi(row) {
  if (!canDelete) {
    alert("Bạn không có quyền xóa dữ liệu điểm danh.");
    return;
  }
  const ok = confirm(
    `Xóa bản ghi điểm danh?\n\n` +
    `${row.tenSV} (${row.maSV})\n` +
    `Lớp: ${row.lop} — Ngày: ${row.ngay} — Buổi: ${row.buoi === "chieu" ? "Chiều" : "Sáng"}\n` +
    `Trạng thái: ${LABEL[row.trangThai] || row.trangThai}`
  );
  if (!ok) return;

  try {
    await deleteDoc(doc(db, "diemdanh", row.id));

    allRows = allRows.filter(r => r.id !== row.id);

    // Xóa khỏi cache ngày + cache tất cả để lần sau đọc lại đúng
    dateMemory.delete(COSO + "|" + row.ngay);
    try { localStorage.removeItem(dayCacheKey(row.ngay)); } catch { /* ignore */ }
    allMemory.delete(COSO);
    try {
      localStorage.removeItem(ALL_CACHE_KEY + "_" + encodeURIComponent(COSO));
    } catch { /* ignore */ }

    fillLopOptions();
    applyFilter();
  } catch (e) {
    console.error(e);
    alert("Lỗi xóa: " + (e.message || e));
  }
}
window.xoaBanGhi = xoaBanGhi;

/* ---------- 9. Xuất Excel ---------- */
function exportExcel() {
  if (!filteredRows.length) {
    alert("Không có dữ liệu để xuất!");
    return;
  }

  const aoa = [
    ["STT", "Mã SV", "Họ tên", "Lớp", "Khóa", "Khoa", "Ngày", "Buổi", "Trạng thái", "Người nhập"]
  ];

  filteredRows.forEach((r, i) => {
    aoa.push([
      i + 1,
      String(r.maSV),
      String(r.tenSV),
      String(r.lop),
      String(r.khoaHoc),
      String(r.khoa),
      String(r.ngay),
      r.buoi === "chieu" ? "Chiều" : "Sáng",
      LABEL[r.trangThai] || String(r.trangThai),
      String(r.nguoiNhap)
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 6 }, { wch: 14 }, { wch: 26 }, { wch: 16 },
    { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 8 },
    { wch: 16 }, { wch: 18 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Diem danh");

  const kp = filteredRows.filter(r => r.trangThai === "vang_khong_phep").length;
  const cp = filteredRows.filter(r => r.trangThai === "vang_co_phep").length;

  const stats = [
    ["Thống kê điểm danh", "Số lượng"],
    ["Cơ sở", COSO],
    ["Ngày lọc", currentFilter.ngay || (allLoaded ? "Tất cả" : loadedDate || "Tất cả")],
    ["Buổi lọc", currentFilter.buoi === "chieu" ? "Chiều" : currentFilter.buoi === "sang" ? "Sáng" : "Tất cả"],
    ["Lớp lọc", currentFilter.lop || "Tất cả"],
    [],
    ["Tổng vắng", filteredRows.length],
    ["Vắng có phép", cp],
    ["Vắng không phép", kp]
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(stats);
  ws2["!cols"] = [{ wch: 24 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Thong ke");

  const parts = ["diem_danh", COSO.replace(/\s+/g, "_")];
  if (currentFilter.ngay) parts.push(currentFilter.ngay);
  else if (loadedDate) parts.push(loadedDate);
  if (currentFilter.buoi) parts.push(currentFilter.buoi === "chieu" ? "chieu" : "sang");
  if (currentFilter.lop) parts.push(currentFilter.lop.replace(/\s+/g, "_"));
  parts.push(todayStr());

  XLSX.writeFile(wb, parts.join("_") + ".xlsx");
}

/* ---------- 10. Gắn sự kiện ---------- */
document.getElementById("btnFilter").addEventListener("click", async () => {
  currentPage = 1;
  currentFilter = {
    ngay: document.getElementById("filterDate").value || "",
    lop: document.getElementById("filterLop").value || "",
    buoi: document.getElementById("filterBuoi").value || "",
    trangThai: document.getElementById("filterStatus").value || ""
  };

  // Đổi ngày → chỉ tải dữ liệu ngày đó (nếu chưa có trong cache).
  if (currentFilter.ngay && (loadedMode !== "date" || loadedDate !== currentFilter.ngay)) {
    await loadDate(currentFilter.ngay);
    return;
  }

  // Bỏ trống ngày: nếu đã bấm "Tải tất cả" thì lọc trên toàn bộ,
  // ngược lại chỉ hiện hướng dẫn để tránh quét toàn bộ collection.
  if (!currentFilter.ngay && !allLoaded) {
    allRows = [];
    filteredRows = [];
    loadedMode = "";
    loadedDate = "";
    renderSummary();
    renderTable();
    return;
  }

  applyFilter();
});

document.getElementById("btnClear").addEventListener("click", () => {
  document.getElementById("filterDate").value = "";
  document.getElementById("filterLop").value = "";
  document.getElementById("filterBuoi").value = "";
  document.getElementById("filterStatus").value = "";
  currentFilter = { ngay: "", lop: "", buoi: "", trangThai: "" };
  currentPage = 1;

  if (allLoaded) {
    allRows = allMemory.get(COSO) || allRows;
    loadedMode = "all";
    loadedDate = "";
    applyFilter();
  } else {
    allRows = [];
    filteredRows = [];
    loadedMode = "";
    loadedDate = "";
    renderSummary();
    renderTable();
  }
});

document.getElementById("btnLoadAll").addEventListener("click", loadEverything);
document.getElementById("btnExport").addEventListener("click", exportExcel);

/* Lọc ngay khi đổi select / chọn ngày */
document.getElementById("filterLop").addEventListener("change", () => {
  document.getElementById("btnFilter").click();
});
document.getElementById("filterBuoi").addEventListener("change", () => {
  document.getElementById("btnFilter").click();
});
document.getElementById("filterStatus").addEventListener("change", () => {
  document.getElementById("btnFilter").click();
});
document.getElementById("filterDate").addEventListener("change", () => {
  document.getElementById("btnFilter").click();
});

/* ---------- 11. Khởi động ---------- */
async function init() {
  fillLopOptions();

  const vuaGui = localStorage.getItem("dd_view_ngay");
  if (vuaGui) localStorage.removeItem("dd_view_ngay");

  const vuaBuoi = localStorage.getItem("dd_view_buoi");
  if (vuaBuoi !== null) {
    localStorage.removeItem("dd_view_buoi");
    const selBuoi = document.getElementById("filterBuoi");
    if (selBuoi && (vuaBuoi === "sang" || vuaBuoi === "chieu")) selBuoi.value = vuaBuoi;
  }

  const initialDate = vuaGui || todayStr();
  document.getElementById("filterDate").value = initialDate;

  currentFilter = {
    ngay: initialDate,
    lop: "",
    buoi: document.getElementById("filterBuoi").value || "",
    trangThai: ""
  };

  await loadDate(initialDate);
}

init();
