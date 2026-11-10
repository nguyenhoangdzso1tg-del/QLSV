import { db } from "./firebase.js";
import { requireApproved, canManage, applyProfileUI } from "./app-auth.js";
import {
  collection,
  onSnapshot,
  deleteDoc,
  doc,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  writeBatch
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ===== XÁC THỰC & QUYỀN ===== */
const profile = await requireApproved();
if (!profile) {
  // requireApproved đã chuyển trang hoặc hiện thông báo — dừng module tại đây
  await new Promise(() => {});
}

/* ===== CƠ SỞ (Chu Văn An / Mạc Cửu) — mọi truy vấn đều lọc theo cơ sở ===== */
const COSO_CVA = "Chu Văn An";
const COSO_MC = "Mạc Cửu";
const COSO = profile.coso || localStorage.getItem("coso") || "";
const canDelete = canManage(profile);

applyProfileUI(profile);

const cosoTitle = document.getElementById("cosoTitle");
if (cosoTitle) cosoTitle.textContent = "Cơ sở " + COSO;

function getCosoLabel() {
  return COSO ? "Cơ sở " + COSO : "";
}

let allData = [];
let lastDeleted = null;
let deleteTimeout = null;
// Các id đang chờ xóa thật (trong lúc hiện toast Hoàn tác / chờ Firebase xác nhận)
const pendingDeletedIds = new Set();
const tbody = document.getElementById("list");

/* ===== MULTI-SELECT STATE ===== */
let isSelectMode = false;
let selectedIds = new Set();
let filteredCache = null; // dữ liệu đúng 1 ngày đã lọc (từ Firebase)

/* ===== CHỈ ADMIN / QUẢN LÍ MỚI ĐƯỢC XÓA ===== */
const btnTrash = document.getElementById("btnTrash");
if (btnTrash) btnTrash.style.display = canDelete ? "inline-flex" : "none";

const monthDeleteWrap = document.getElementById("monthDeleteWrap");
if (monthDeleteWrap) monthDeleteWrap.style.display = canDelete ? "inline-flex" : "none";
const q = query(
  collection(db, "violations"),
  where("coso", "==", COSO),
  orderBy("createdAt", "desc"),
  limit(200)
);

function sortByCreatedDesc(list) {
  return list.sort((a, b) => {
    const ta = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
    const tb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
    return tb - ta;
  });
}

onSnapshot(q, (snapshot) => {
  const snapItems = [];
  snapshot.forEach(d => {
    snapItems.push({ id: d.id, ...d.data() });
  });

  // Bỏ các bản ghi đang chờ xóa (đang hiện toast Hoàn tác / chờ Firebase xác nhận)
  allData = sortByCreatedDesc(
    snapItems.filter(v => !pendingDeletedIds.has(v.id))
  );

  // Đang lọc ngày: làm mới filteredCache từ snapshot
  // → bản ghi MỚI của ngày này hiện ngay, bản ghi cũ nằm ngoài 200 bản gần nhất vẫn giữ nguyên
  if (isFiltering && filteredCache) {
    const byId = new Map(filteredCache.map(v => [v.id, v]));
    snapItems
      .filter(v => v.ngay === currentFilterDate && !pendingDeletedIds.has(v.id))
      .forEach(v => byId.set(v.id, v));
    filteredCache = sortByCreatedDesc([...byId.values()]);
  }

  // Giữ lại selectedIds còn tồn tại (kể cả bản ghi trong ngày đang lọc)
  const existingIds = new Set(allData.map(v => v.id));
  if (filteredCache) filteredCache.forEach(v => existingIds.add(v.id));
  selectedIds = new Set([...selectedIds].filter(id => existingIds.has(id)));
  updateSelectedCount();

  renderTable(getCurrentDisplayData());
}, (err) => {
  console.error("Lỗi tải danh sách:", err);
  alert(
    "Lỗi tải danh sách.\nNếu Firebase yêu cầu tạo index, mở link trong Console (F12) và chạy lại.\n" +
    (err.message || err)
  );
});

/* ===== SINGLE DELETE (giữ nguyên) ===== */
function attachDeleteEvents() {
  document.querySelectorAll(".btn-delete").forEach(btn => {
    btn.onclick = () => {
      if (!canDelete) return;
      const id = btn.dataset.id;

      if (!confirm("Bạn có chắc muốn xóa vi phạm này?")) return;

      // Tìm item trong allData HOẶC filteredCache (khi đang lọc)
      let item = allData.find(v => v.id === id);
      if (!item && filteredCache) {
        item = filteredCache.find(v => v.id === id);
      }
      lastDeleted = item;

      // Đánh dấu "đang chờ xóa" để snapshot không làm bản ghi nhảy lại
      // trong lúc đang hiện toast Hoàn tác
      pendingDeletedIds.add(id);

      // Xóa khỏi allData
      allData = allData.filter(v => v.id !== id);
      // Xóa khỏi filteredCache nếu đang lọc
      if (filteredCache) {
        filteredCache = filteredCache.filter(v => v.id !== id);
      }
      selectedIds.delete(id);
      updateSelectedCount();
      renderTable(getCurrentDisplayData());

      showUndoToast();

      deleteTimeout = setTimeout(async () => {
        try {
          await deleteDoc(doc(db, "violations", id));
        } finally {
          pendingDeletedIds.delete(id);
          if (lastDeleted && lastDeleted.id === id) lastDeleted = null;
        }
      }, 8000);
    };
  });
}

/* ===== MULTI-SELECT EVENTS ===== */
function attachSelectEvents() {
  document.querySelectorAll(".row-checkbox").forEach(cb => {
    cb.onchange = () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        selectedIds.add(id);
        cb.closest("tr").classList.add("selected-row");
      } else {
        selectedIds.delete(id);
        cb.closest("tr").classList.remove("selected-row");
      }
      updateSelectedCount();
      syncSelectAllCheckbox();
    };
  });
}

function updateSelectedCount() {
  const el = document.getElementById("selectedCount");
  if (el) el.innerText = selectedIds.size;
}

function syncSelectAllCheckbox() {
  const headerCb = document.getElementById("selectAllHeader");
  const topCb = document.getElementById("selectAll");
  const rowCbs = document.querySelectorAll(".row-checkbox");
  if (!rowCbs.length) {
    if (headerCb) headerCb.checked = false;
    if (topCb) topCb.checked = false;
    return;
  }
  const allChecked = [...rowCbs].every(cb => cb.checked);
  if (headerCb) headerCb.checked = allChecked;
  if (topCb) topCb.checked = allChecked;
}

function getCurrentDisplayData() {
  if (isFiltering && filteredCache) {
    return filteredCache;
  }
  return allData;
}

function renderTable(data) {
  tbody.innerHTML = "";

  const colCount = 12; // bảng luôn có 12 cột (cột checkbox vẫn giữ chỗ dù ẩn)

  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${colCount}" class="empty">
          Không có vi phạm
        </td>
      </tr>
    `;
    return;
  }

  let displayData = data;

  // Chỉ phân trang khi "Tất cả"
  if (!isFiltering) {
    const start = (currentPage - 1) * perPage;
    const end = start + perPage;
    displayData = data.slice(start, end);
  }

  displayData.forEach(v => {
    let time = "—";
    if (v.createdAt) {
      time = v.createdAt.toDate().toLocaleString("vi-VN");
    }

    const isChecked = selectedIds.has(v.id);
    const selectCell = isSelectMode
      ? `<td class="col-select show">
           <input type="checkbox" class="select-checkbox row-checkbox" data-id="${v.id}" ${isChecked ? "checked" : ""}>
         </td>`
      : `<td class="col-select"></td>`;

    const tr = document.createElement("tr");
    if (isChecked) tr.classList.add("selected-row");

        const deleteCell = canDelete
      ? `<td><button class="btn-delete" data-id="${v.id}">X</button></td>`
      : `<td style="color:#94a3b8;">—</td>`;

    tr.innerHTML = `
      ${selectCell}
      <td>${v.maSV}</td>
      <td>${v.hoTen}</td>
      <td>${v.lop}</td>
      <td>${v.khoaHoc}</td>
      <td>${v.khoa}</td>
      <td>${v.ngay}</td>
      <td>${v.buoi}</td>
      <td>${v.vipham}</td>
      <td>${time}</td>
      <td>${v.nguoiNhap || "—"}</td>
      ${deleteCell}
    `;
    tbody.appendChild(tr);
  });

    if (canDelete) attachDeleteEvents();
  if (isSelectMode) {
    attachSelectEvents();
    syncSelectAllCheckbox();
  }

  // Chỉ render pagination khi "Tất cả"
  if (!isFiltering) {
    renderPagination(data.length);
  } else {
    document.getElementById("pagination").innerHTML = "";
    document.getElementById("paginationTop").innerHTML = "";
  }
}

/* ===== FILTER (lấy đúng ngày từ Firebase, không chỉ 200 bản gần nhất) ===== */
document.getElementById("btnFilter").onclick = async () => {
  const date = document.getElementById("filterDate").value;
  if (!date) {
    alert("Chọn ngày cần lọc!");
    return;
  }

  isFiltering = true;
  currentFilterDate = date;
  currentPage = 1;
  // Không giữ chọn của ngày trước → tránh "Xóa đã chọn" đụng phải bản ghi đang ẩn
  selectedIds.clear();
  updateSelectedCount();

  try {
    const qf = query(
      collection(db, "violations"),
      where("coso", "==", COSO),
      where("ngay", "==", date)
    );
    const snap = await getDocs(qf);
    const filtered = [];
    snap.forEach(d => {
      filtered.push({ id: d.id, ...d.data() });
    });

    filtered.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return (b.createdAt.seconds || 0) - (a.createdAt.seconds || 0);
    });

    filteredCache = filtered;
    renderTable(filtered);
    updateExportButton();
  } catch (e) {
    console.error(e);
    alert(
      "Lỗi lọc ngày. Nếu Firebase yêu cầu tạo index, mở link trong Console (F12).\n" +
      (e.message || e)
    );
  }
};

document.getElementById("btnClear").onclick = () => {
  isFiltering = false;
  currentFilterDate = null;
  filteredCache = null;
  currentPage = 1;
  selectedIds.clear();
  updateSelectedCount();
  document.getElementById("filterDate").value = "";
  renderTable(allData);
  updateExportButton();
};

let currentFilterDate = null;
let currentPage = 1;
const perPage = 50;
let isFiltering = false;

function renderPagination(totalItems) {
  const totalPages = Math.ceil(totalItems / perPage);

  const containerBottom = document.getElementById("pagination");
  const containerTop = document.getElementById("paginationTop");

  containerBottom.innerHTML = "";
  containerTop.innerHTML = "";

  if (totalPages <= 1) return;

  function createBtn(page, text = page) {
    const btn = document.createElement("button");
    btn.innerText = text;

    btn.onclick = () => {
      currentPage = page;
      renderTable(getCurrentDisplayData());
    };

    if (page === currentPage) {
      btn.style.background = "#2563eb";
      btn.style.color = "white";
    }

    return btn;
  }

  function render(container) {
    if (currentPage > 1) {
      container.appendChild(createBtn(currentPage - 1, "←"));
    }

    container.appendChild(createBtn(1));

    if (currentPage > 3) {
      const dot = document.createElement("span");
      dot.innerText = "...";
      container.appendChild(dot);
    }

    for (let i = currentPage - 1; i <= currentPage + 1; i++) {
      if (i > 1 && i < totalPages) {
        container.appendChild(createBtn(i));
      }
    }

    if (currentPage < totalPages - 2) {
      const dot = document.createElement("span");
      dot.innerText = "...";
      container.appendChild(dot);
    }

    if (totalPages > 1) {
      container.appendChild(createBtn(totalPages));
    }

    if (currentPage < totalPages) {
      container.appendChild(createBtn(currentPage + 1, "→"));
    }
  }

  render(containerTop);
  render(containerBottom);
}

/* ===== UNDO (giữ nguyên single delete) ===== */
function showUndoToast() {
  const toast = document.getElementById("undoToast");
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.display = "none";
  }, 5000);
}

window.undoDelete = function () {
  if (!lastDeleted) return;

  clearTimeout(deleteTimeout);
  pendingDeletedIds.delete(lastDeleted.id);

  allData.unshift(lastDeleted);
  // Khôi phục vào filteredCache nếu đang lọc và ngày khớp
  if (filteredCache && lastDeleted.ngay === currentFilterDate) {
    filteredCache.unshift(lastDeleted);
  }
  renderTable(getCurrentDisplayData());

  lastDeleted = null;

  document.getElementById("undoToast").style.display = "none";
};

/* ===== MULTI DELETE UI ===== */
function enterSelectMode() {
  if (!canDelete) return;
  isSelectMode = true;
  selectedIds.clear();
  updateSelectedCount();

  document.getElementById("btnTrash").classList.add("active");
  document.getElementById("btnConfirmDelete").classList.add("show");
  document.getElementById("btnCancelSelect").classList.add("show");
  document.getElementById("selectAllWrap").classList.add("show");
  document.getElementById("thSelect").classList.add("show");
  document.querySelectorAll(".col-select").forEach(el => el.classList.add("show"));

  renderTable(getCurrentDisplayData());
}

function exitSelectMode() {
  isSelectMode = false;
  selectedIds.clear();
  updateSelectedCount();

  document.getElementById("btnTrash").classList.remove("active");
  document.getElementById("btnConfirmDelete").classList.remove("show");
  document.getElementById("btnCancelSelect").classList.remove("show");
  document.getElementById("selectAllWrap").classList.remove("show");
  document.getElementById("thSelect").classList.remove("show");

  const headerCb = document.getElementById("selectAllHeader");
  const topCb = document.getElementById("selectAll");
  if (headerCb) headerCb.checked = false;
  if (topCb) topCb.checked = false;

  renderTable(getCurrentDisplayData());
}

document.getElementById("btnTrash").onclick = () => {
  if (isSelectMode) {
    exitSelectMode();
  } else {
    enterSelectMode();
  }
};

document.getElementById("btnCancelSelect").onclick = () => {
  exitSelectMode();
};

/* Chọn tất cả (header + top) */
function toggleSelectAll(checked) {
  const rowCbs = document.querySelectorAll(".row-checkbox");
  rowCbs.forEach(cb => {
    cb.checked = checked;
    const id = cb.dataset.id;
    if (checked) {
      selectedIds.add(id);
      cb.closest("tr").classList.add("selected-row");
    } else {
      selectedIds.delete(id);
      cb.closest("tr").classList.remove("selected-row");
    }
  });
  updateSelectedCount();
  const headerCb = document.getElementById("selectAllHeader");
  const topCb = document.getElementById("selectAll");
  if (headerCb) headerCb.checked = checked;
  if (topCb) topCb.checked = checked;
}

document.getElementById("selectAllHeader").onchange = (e) => {
  toggleSelectAll(e.target.checked);
};
document.getElementById("selectAll").onchange = (e) => {
  toggleSelectAll(e.target.checked);
};

/* Xóa nhiều đã chọn */
document.getElementById("btnConfirmDelete").onclick = async () => {
  if (!canDelete) return;
  if (selectedIds.size === 0) {
    alert("Chưa chọn vi phạm nào!");
    return;
  }

  const count = selectedIds.size;
  if (!confirm(`Bạn có chắc muốn xóa ${count} vi phạm đã chọn?`)) return;

  const idsToDelete = [...selectedIds];
  const delSet = new Set(idsToDelete);

  // Xóa tạm trên UI
  allData = allData.filter(v => !delSet.has(v.id));
  // Cập nhật filteredCache nếu đang lọc
  if (filteredCache) {
    filteredCache = filteredCache.filter(v => !delSet.has(v.id));
  }
  // Tránh snapshot làm các bản ghi hiện lại trước khi Firebase xác nhận xóa
  idsToDelete.forEach(id => pendingDeletedIds.add(id));
  selectedIds.clear();
  updateSelectedCount();
  renderTable(getCurrentDisplayData());

  // Xóa thật trên Firebase
  try {
    await Promise.all(
      idsToDelete.map(id => deleteDoc(doc(db, "violations", id)))
    );
  } catch (err) {
    console.error("Lỗi xóa nhiều:", err);
    alert("Có lỗi khi xóa một số bản ghi. Vui lòng tải lại trang.");
  } finally {
    // Bản ghi xóa lỗi (nếu có) sẽ tự hiện lại ở lần cập nhật snapshot kế tiếp
    idsToDelete.forEach(id => pendingDeletedIds.delete(id));
  }

  exitSelectMode();
};
/* ===== XÓA TOÀN BỘ 1 THÁNG (chỉ Admin) ===== */
document.getElementById("btnDeleteMonth").onclick = async () => {
  if (!canDelete) {
    alert("Bạn không có quyền xóa dữ liệu.");
    return;
  }
  const m = document.getElementById("filterMonth").value;
  if (!m) {
    alert("Chọn tháng cần xóa (ô bên cạnh), VD 2026-10!");
    return;
  }

  // Tính ngày đầu và ngày cuối của tháng
  const [y, mo] = m.split("-").map(Number);
  const lastDay = new Date(y, mo, 0).getDate();
  const start = m + "-01";
  const end = m + "-" + String(lastDay).padStart(2, "0");

  try {
    // Trước khi xóa: đếm để xác nhận rõ ràng
    const qCount = query(
      collection(db, "violations"),
      where("coso", "==", COSO),
      where("ngay", ">=", start),
      where("ngay", "<=", end)
    );
    const snap = await getDocs(qCount);
    const ids = snap.docs.map(d => d.id);

    if (ids.length === 0) {
      alert("Tháng " + m + " chưa có vi phạm nào để xóa.");
      return;
    }

    if (!confirm(
      "Xóa TOÀN BỘ " + ids.length + " vi phạm tháng " + m + "?\n\nKhông hoàn tác được!"
    )) return;

    const btn = document.getElementById("btnDeleteMonth");
    btn.disabled = true;
    try {
      const BATCH = 400;
      let done = 0;
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const batch = writeBatch(db);
        chunk.forEach(id => batch.delete(doc(db, "violations", id)));
        await batch.commit();
        done += chunk.length;
      }
      alert("Đã xóa " + done + " vi phạm tháng " + m + ".");
      document.getElementById("filterMonth").value = "";

      // Làm mới lại phần đang hiển thị
      pendingDeletedIds.clear();
      if (isFiltering) {
        document.getElementById("btnClear").click();
      } else {
        // onSnapshot tự làm mới allData; chỉ cần render lại
        renderTable(getCurrentDisplayData());
      }
    } finally {
      btn.disabled = false;
    }
  } catch (e) {
    console.error(e);
    alert(
      "Lỗi xóa tháng.\nNếu Firebase yêu cầu tạo index, mở link trong Console (F12).\n" +
      (e.message || e)
    );
  }
};

/* ===== XUẤT EXCEL — nút hiện khi đang lọc 1 ngày ===== */

function updateExportButton() {
  const btn = document.getElementById("btnExport");
  const btnSang = document.getElementById("btnExportSang");
  const btnChieu = document.getElementById("btnExportChieu");
  // Chỉ hiện khi đang lọc 1 ngày và có dữ liệu
  const shown = isFiltering && filteredCache && filteredCache.length > 0;
  if (btn) btn.style.display = shown ? "inline-flex" : "none";
  if (btnSang) btnSang.style.display = shown ? "inline-flex" : "none";
  if (btnChieu) btnChieu.style.display = shown ? "inline-flex" : "none";
}

/* ===== XUẤT EXCEL (chỉ ngày đã lọc, không cần Admin) ===== */

// Chuẩn hóa "buổi" nhập vào: Sáng/Chiều (có dấu hay không) → SANG / CHIEU
function normBuoi(b) {
  return String(b || "")
    .toUpperCase()
    .replace(/[ÁÀẢÃẠ]/g, "A")
    .replace(/[ỀẾỂỄỆ]/g, "E")
    .trim();
}

// Đóng gói 1 danh sách bản ghi thành các dòng Excel (cùng cột như bảng)
function makeExcelRows(list) {
  return list.map((v, i) => ({
    STT: i + 1,
    "Mã SV": v.maSV || "",
    "Họ tên": v.hoTen || "",
    "Lớp": v.lop || "",
    "Khóa": v.khoaHoc || "",
    "Khoa": v.khoa || "",
    "Ngày": v.ngay || "",
    "Buổi": v.buoi || "",
    "Vi phạm": v.vipham || "",
    "Thời gian nhập": (v.createdAt && v.createdAt.toDate
      ? v.createdAt.toDate().toLocaleString("vi-VN")
      : ""),
    "Người nhập": v.nguoiNhap || ""
  }));
}

// Excel: đổi ô "chữ số" thành số thật để dùng được SUM / công thức
function coerceNumericCells(ws) {
  Object.keys(ws).forEach(addr => {
    if (addr.charAt(0) === "!") return;
    const cell = ws[addr];
    if (!cell || cell.t !== "s" || typeof cell.v !== "string") return;
    const s = cell.v.trim();
    if (/^-?\d{1,9}(\.\d+)?$/.test(s)) {
      cell.t = "n";
      cell.v = Number(s);
      delete cell.w;
    }
  });
  return ws;
}

function exportExcel(list, emptyMsg, fileNameSuffix) {
  if (!list.length) {
    alert(emptyMsg || "Không có dữ liệu để xuất!");
    return;
  }

  const rows = makeExcelRows(list);
  const columns = Object.keys(rows[0]);
  const aoa = [[ "Cơ sở: " + COSO ], []];
  aoa.push(columns);
  rows.forEach(r => aoa.push(columns.map(c => r[c])));

  const ws = coerceNumericCells(XLSX.utils.aoa_to_sheet(aoa));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vi phạm");
  const fileName = "vi_pham_" + COSO.replace(" ", "_") + "_" + currentFilterDate + (fileNameSuffix || "") + ".xlsx";
  XLSX.writeFile(wb, fileName);
}

/* Xuất tất cả các bản ghi đã lọc */
document.getElementById("btnExport").onclick = () => {
  if (!isFiltering || !filteredCache) {
    alert("Hãy lọc theo 1 ngày trước khi xuất Excel!");
    return;
  }
  exportExcel(filteredCache, "Ngày này không có dữ liệu để xuất!", "");
};

/* Xuất chỉ các bản ghi BUỔI SÁNG đã lọc */
document.getElementById("btnExportSang").onclick = () => {
  if (!isFiltering || !filteredCache) {
    alert("Hãy lọc theo 1 ngày trước khi xuất Excel!");
    return;
  }
  const sangOnly = filteredCache.filter(v => normBuoi(v.buoi) === "SANG");
  exportExcel(sangOnly, "Ngày này không có vi phạm buổi sáng!", "_sang");
};

/* Xuất chỉ các bản ghi BUỔI CHIỀU đã lọc */
document.getElementById("btnExportChieu").onclick = () => {
  if (!isFiltering || !filteredCache) {
    alert("Hãy lọc theo 1 ngày trước khi xuất Excel!");
    return;
  }
  const chieuOnly = filteredCache.filter(v => normBuoi(v.buoi) === "CHIEU");
  exportExcel(chieuOnly, "Ngày này không có vi phạm buổi chiều!", "_chieu");
};