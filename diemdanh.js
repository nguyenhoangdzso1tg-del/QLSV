/* =========================================================
   ĐIỂM DANH — chọn Khoa → Khóa → Lớp, đánh dấu trạng thái
   3 chấm: đỏ = vắng không phép, vàng = vắng có phép, xanh = không vắng
   ========================================================= */
import { db } from "./firebase.js";
import { requireApproved, applyProfileUI } from "./app-auth.js";
import { initAttendanceChat } from "./diemdanh-chat.js";
import { getStudentTree, getStudentsByClass } from "./student-data.js";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ---------- 0. Bảo vệ trang ---------- */
const profile = await requireApproved();
if (!profile) {
  // requireApproved đã chuyển trang hoặc hiện thông báo — dừng module tại đây
  await new Promise(() => {});
}
applyProfileUI(profile);

const nguoiNhap = localStorage.getItem("nguoiNhap");

/* ---------- 1. Cơ sở ---------- */
const COSO_CVA = "Chu Văn An";
const COSO_MC = "Mạc Cửu";

function getCoso() {
  return localStorage.getItem("coso") || COSO_CVA;
}
const COSO = getCoso();

function favKhoa(coso) {
  return coso === COSO_MC
    ? ["CƠ KHÍ - XÂY DỰNG", "ĐIỆN - ĐIỆN TỬ", "DU LỊCH - NGOẠI NGỮ"]
    : ["KINH TẾ - NÔNG NGHIỆP", "CÔNG NGHỆ THÔNG TIN"];
}

/* ---------- 2. State ---------- */
let data = {};
let classCounts = {};        // "khoa|khoaHoc|lop" -> sĩ số (từ meta, chưa cần tải cả lớp)
let selected = { khoa: null, khoaHoc: null, lop: null };
let statusMap = {};          // maSV -> trangThai (của lớp + buổi đang xem)
let statusCache = {};        // "khoa|khoaHoc|lop|buoi" -> statusMap (giữ khi quay lại)
let isSending = false;
let view = { level: "khoa", khoa: null, khoaHoc: null, lop: null };
let diemDanhList = [];       // danh sách điểm danh chờ gửi (giống violationList)
let buoi = localStorage.getItem("dd_buoi") === "chieu" ? "chieu" : "sang";

const TRANG_THAI = {
  khong_vang: { label: "Không vắng", dot: "green", card: "status-kv" },
  vang_co_phep: { label: "Vắng có phép", dot: "yellow", card: "status-cp" },
  vang_khong_phep: { label: "Vắng không phép", dot: "red", card: "status-kp" }
};

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

function fmtDate(s) {
  if (!s) return "";
  const parts = String(s).split("-");
  if (parts.length !== 3) return s;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function buoiLabel(v = buoi) {
  return v === "chieu" ? "Chiều" : "Sáng";
}

function updateStatus() {
  document.getElementById("status").innerText =
    `Khoa: ${selected.khoa || "—"} | ` +
    `Khóa: ${selected.khoaHoc || "—"} | ` +
    `Lớp: ${selected.lop || "—"} | ` +
    `Buổi: ${buoiLabel()}`;
}

// Quay lại theo trạng thái màn hình — không dùng ngăn xếp lịch sử,
// nhờ vậy dù mở lớp bằng tìm kiếm / trợ lý AI vẫn quay về đúng cấp.
function syncBackButton() {
  const btn = document.getElementById("btnBack");
  if (!btn) return;

  const hasParent = view.level !== "khoa";
  btn.disabled = !hasParent;
  btn.title = !hasParent
    ? "Đang ở màn hình gốc — dùng nút Trang chủ để ra ngoài"
    : view.level === "sv"
      ? "Quay lại danh sách lớp"
      : view.level === "lop"
        ? "Quay lại danh sách khóa"
        : "Quay lại danh sách khoa";
}

function goBack() {
  // KHÔNG thoát trang — chỉ lùi về cấp cha trong ứng dụng
  if (view.level === "sv") {
    showLop(view.khoa, view.khoaHoc);
  } else if (view.level === "lop") {
    showKhoaHoc(view.khoa);
  } else if (view.level === "khoaHoc") {
    showKhoa();
  } else {
    syncBackButton();
  }
}
window.goBack = goBack;

/* ---------- 4. Chọn khoa / khóa / lớp ---------- */
function renderButtons(list, callback) {
  const content = document.getElementById("contentDD");
  content.innerHTML = "";
  content.className = "";

  list.forEach(item => {
    const label = typeof item === "string" ? item : item.label;
    const sub = typeof item === "string" ? "" : (item.sub || "");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pick-btn";
    btn.innerHTML =
      `<div class="pick-main">${esc(label)}</div>` +
      (sub ? `<div class="sub">${esc(sub)}</div>` : "");
    btn.onclick = () => callback(item);
    content.appendChild(btn);
  });
}

function showKhoa() {
  view = { level: "khoa", khoa: null, khoaHoc: null, lop: null };
  selected = { khoa: null, khoaHoc: null, lop: null };
  updateStatus();
  hideToolbar();

  document.getElementById("title").innerText = "Chọn khoa";
  renderButtons(Object.keys(data), khoa => {
    selected.khoa = khoa;
    updateStatus();
    showKhoaHoc(khoa);
  });
  syncBackButton();
}

function sortKhoaHocKeys(keys) {
  function rank(name) {
    const s = String(name)
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "");

    let m = s.match(/CD9\+?K(\d+)/) || s.match(/CĐ9\+?K(\d+)/);
    if (m) return 100 + Number(m[1]);

    m = s.match(/CDK(\d+)/) || s.match(/[^A-Z]K(\d+)$/) || s.match(/^K(\d+)/);
    if (m) return 200 + Number(m[1]);

    m = s.match(/K(\d+)/);
    if (m) return 300 + Number(m[1]);
    return 900;
  }

  return [...keys].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return String(a).localeCompare(String(b), "vi");
  });
}

function showKhoaHoc(khoa) {
  view = { level: "khoaHoc", khoa, khoaHoc: null, lop: null };
  selected.khoa = khoa;
  selected.khoaHoc = null;
  selected.lop = null;
  updateStatus();
  hideToolbar();

  document.getElementById("title").innerText = "Chọn khóa";
  const keys = sortKhoaHocKeys(Object.keys(data[khoa] || {}));

  renderButtons(keys, khoaHoc => {
    selected.khoaHoc = khoaHoc;
    updateStatus();
    showLop(khoa, khoaHoc);
  });
  syncBackButton();
}

function showLop(khoa, khoaHoc) {
  view = { level: "lop", khoa, khoaHoc, lop: null };
  selected.khoa = khoa;
  selected.khoaHoc = khoaHoc;
  selected.lop = null;
  updateStatus();
  hideToolbar();

  document.getElementById("title").innerText = "Chọn lớp";
  renderButtons(Object.keys(data[khoa][khoaHoc]), lop => {
    selected.lop = lop;
    updateStatus();
    showSinhVien(khoa, khoaHoc, lop);
  });
  syncBackButton();
}

/* ---------- 4b. Tìm lớp nhanh ---------- */
function norm(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function restoreView() {
  if (view.level === "sv") showSinhVien(view.khoa, view.khoaHoc, view.lop);
  else if (view.level === "lop") showLop(view.khoa, view.khoaHoc);
  else if (view.level === "khoaHoc") showKhoaHoc(view.khoa);
  else showKhoa();
}

function renderSearch(q) {
  const nq = norm(q).trim();
  if (!nq) return restoreView();

  const results = [];
  Object.keys(data).forEach(khoa => {
    Object.keys(data[khoa]).forEach(khoaHoc => {
      Object.keys(data[khoa][khoaHoc]).forEach(lop => {
        if (norm(`${lop} ${khoaHoc} ${khoa}`).includes(nq)) {
          results.push({ label: lop, sub: `${khoaHoc} · ${khoa}`, khoa, khoaHoc, lop });
        }
      });
    });
  });

  results.sort((a, b) => a.lop.localeCompare(b.lop, "vi"));

  hideToolbar();
  document.getElementById("title").innerText =
    results.length ? `Kết quả tìm lớp (${results.length})` : "Không tìm thấy lớp";

  if (!results.length) {
    const content = document.getElementById("contentDD");
    content.className = "";
    content.innerHTML =
      `<div class="pick-btn" style="cursor:default;color:#64748b;font-weight:500">
         Không có lớp nào khớp với "<b>${esc(q.trim())}</b>".
       </div>`;
    return;
  }

  const shown = results.slice(0, 60);
  renderButtons(shown, item => {
    if (typeof item === "string") return;
    const inp = document.getElementById("searchLop");
    inp.value = "";
    document.getElementById("searchClear").classList.remove("show");

    selected = { khoa: item.khoa, khoaHoc: item.khoaHoc, lop: item.lop };
    updateStatus();
    showSinhVien(item.khoa, item.khoaHoc, item.lop);
  });

  if (results.length > shown.length) {
    const note = document.createElement("div");
    note.style.cssText = "grid-column:1/-1;font-size:13px;color:#64748b;padding:6px 2px";
    note.textContent =
      `Còn ${results.length - shown.length} lớp khác — gõ thêm để thu hẹp kết quả.`;
    document.getElementById("contentDD").appendChild(note);
  }
}

/* ---------- 5. Danh sách sinh viên + 3 chấm ---------- */
function cacheKey() {
  return `${selected.khoa}|${selected.khoaHoc}|${selected.lop}|${buoi}`;
}

function syncBuoiUI() {
  document.querySelectorAll("#buoiSeg .buoi-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.buoi === buoi);
  });
}

function setBuoi(value, opts = {}) {
  const next = value === "chieu" ? "chieu" : "sang";
  const changed = next !== buoi;
  buoi = next;
  localStorage.setItem("dd_buoi", buoi);
  syncBuoiUI();
  updateStatus();

  // Đang xem lớp → nạp lại trạng thái riêng của buổi này
  if (view.level === "sv") {
    showSinhVien(view.khoa, view.khoaHoc, view.lop);
  }

  if (changed && opts.notify) {
    opts.notify(buoiLabel());
  }
  return buoi;
}

function allPresent() {
  if (view.level !== "sv") return 0;
  Object.keys(statusMap).forEach(maSV => {
    statusMap[maSV] = "khong_vang";
  });
  statusCache[cacheKey()] = { ...statusMap };
  Object.keys(statusMap).forEach(paintCard);
  updateSummary();
  return Object.keys(statusMap).length;
}

let classLoadSeq = 0;

async function showSinhVien(khoa, khoaHoc, lop) {
  const seq = ++classLoadSeq;
  view = { level: "sv", khoa, khoaHoc, lop };
  selected = { khoa, khoaHoc, lop };
  updateStatus();

  const content = document.getElementById("contentDD");
  let list = (data[khoa] && data[khoa][khoaHoc] && data[khoa][khoaHoc][lop]) || [];

  // Chỉ tải danh sách của đúng lớp đang mở (tiết kiệm lượt đọc Firestore).
  if (!list.length) {
    document.getElementById("title").innerText = `Đang tải lớp ${lop}…`;
    content.className = "";
    content.innerHTML = '<div style="grid-column:1/-1;color:#64748b;padding:10px">Đang tải danh sách sinh viên…</div>';
    try {
      const loaded = await getStudentsByClass(khoa, khoaHoc, lop);
      data[khoa][khoaHoc][lop] = loaded;
      classCounts[`${khoa}|${khoaHoc}|${lop}`] = loaded.length;
      list = loaded;
    } catch (e) {
      console.error(e);
      if (seq !== classLoadSeq) return;
      content.className = "";
      content.innerHTML =
        `<div style="grid-column:1/-1;color:#dc2626;padding:10px;background:#fff;border-radius:10px">` +
        `Không tải được danh sách lớp ${esc(lop)}. ${esc(e.message || "")}</div>`;
      return;
    }
  }

  // Người dùng đã chuyển màn hình / đổi buổi trong lúc chờ tải → bỏ qua kết quả cũ.
  if (seq !== classLoadSeq || view.level !== "sv") return;

  document.getElementById("title").innerText =
    `Điểm danh lớp ${lop} (${list.length} SV)`;

  // Lấy lại trạng thái đã đánh dấu trước đó (nếu có)
  const cached = statusCache[cacheKey()] || {};
  statusMap = {};
  list.forEach(sv => {
    statusMap[sv.maSV] = cached[sv.maSV] || "khong_vang";
  });

  content.className = "sv-grid";
  content.innerHTML = "";

  list.forEach(sv => {
    const card = document.createElement("div");
    card.className = "sv-card";
    card.dataset.ma = sv.maSV;

    card.innerHTML = `
      <div class="dots">
        <button type="button" class="dot red"    data-ma="${esc(sv.maSV)}" data-status="vang_khong_phep" title="Vắng không phép"></button>
        <button type="button" class="dot yellow" data-ma="${esc(sv.maSV)}" data-status="vang_co_phep"   title="Vắng có phép"></button>
        <button type="button" class="dot green"  data-ma="${esc(sv.maSV)}" data-status="khong_vang"      title="Không vắng"></button>
      </div>
      <div class="sv-ten">${esc(sv.tenSV)}</div>
      <div class="sv-ma">${esc(sv.maSV)}</div>
    `;

    card.querySelectorAll(".dot").forEach(dot => {
      dot.addEventListener("click", () => {
        setStatus(sv.maSV, dot.dataset.status);
      });
    });

    content.appendChild(card);
    paintCard(sv.maSV);
  });

  showToolbar();
  updateSummary();
  syncBackButton();
}

function paintCard(maSV) {
  const card = document.querySelector(`.sv-card[data-ma="${CSS.escape(maSV)}"]`);
  if (!card) return;
  const st = statusMap[maSV] || "khong_vang";

  card.classList.remove("status-kv", "status-cp", "status-kp");
  card.classList.add(TRANG_THAI[st].card);

  card.querySelectorAll(".dot").forEach(dot => {
    dot.classList.toggle("active", dot.dataset.status === st);
  });
}

function setStatus(maSV, trangThai) {
  statusMap[maSV] = trangThai;
  statusCache[cacheKey()] = { ...statusMap };
  paintCard(maSV);
  updateSummary();
}

function updateSummary() {
  const values = Object.values(statusMap);
  const total = values.length;
  const kp = values.filter(v => v === "vang_khong_phep").length;
  const cp = values.filter(v => v === "vang_co_phep").length;
  const kv = total - kp - cp;

  document.getElementById("sumTotal").textContent = total;
  document.getElementById("sumKhong").textContent = kv;
  document.getElementById("sumCP").textContent = cp;
  document.getElementById("sumKP").textContent = kp;
}

function showToolbar() {
  const tb = document.getElementById("toolbar");
  tb.classList.remove("hidden");
  const inp = document.getElementById("ngayDiemDanh");
  if (!inp.value) inp.value = todayStr();
  syncBuoiUI();
}
function hideToolbar() {
  document.getElementById("toolbar").classList.add("hidden");
}

/* ---------- 6. Thêm vào danh sách → Gửi ---------- */
const DD_KEY = "diemDanhList";
const rowKey = r => [r.coso, r.ngay, r.lop, r.buoi || "sang", r.maSV].join("|");

function saveData() {
  localStorage.setItem(DD_KEY, JSON.stringify(diemDanhList));
}

function loadData() {
  try {
    const raw = localStorage.getItem(DD_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    diemDanhList = Array.isArray(arr) ? arr : [];
  } catch (e) {
    diemDanhList = [];
  }
  renderDanhSachDD();
}

// Thêm toàn bộ bạn vắng của lớp + ngày + buổi đang chọn vào danh sách chờ gửi
function themVaoDanhSach(opts = {}) {
  const silent = opts && opts.silent === true;

  if (!selected.lop || view.level !== "sv") {
    if (!silent) alert("Hãy chọn Khoa → Khóa → Lớp trước!");
    return null;
  }

  const ngay = document.getElementById("ngayDiemDanh").value || todayStr();
  const list = data[selected.khoa][selected.khoaHoc][selected.lop] || [];
  const [y, m, d] = ngay.split("-").map(Number);

  // Chỉ thêm những bạn VẮNG
  const rows = list
    .filter(sv => {
      const st = statusMap[sv.maSV] || "khong_vang";
      return st === "vang_co_phep" || st === "vang_khong_phep";
    })
    .map(sv => ({
      coso: COSO,
      ngay,
      year: y,
      month: m,
      day: d,
      buoi,
      khoa: selected.khoa,
      khoaHoc: selected.khoaHoc,
      lop: selected.lop,
      maSV: sv.maSV,
      tenSV: sv.tenSV,
      trangThai: statusMap[sv.maSV],
      nguoiNhap: localStorage.getItem("nguoiNhap") || ""
    }));

  // Thêm lại cùng lớp + ngày + buổi → thay thế, không nhân đôi
  const same = r =>
    r.coso === COSO &&
    r.ngay === ngay &&
    r.lop === selected.lop &&
    (r.buoi || "sang") === buoi;
  diemDanhList = diemDanhList.filter(r => !same(r)).concat(rows);

  saveData();
  renderDanhSachDD();

  if (rows.length) {
    const sec = document.querySelector(".dd-section");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const kp = rows.filter(r => r.trangThai === "vang_khong_phep").length;
  const cp = rows.filter(r => r.trangThai === "vang_co_phep").length;
  const result = {
    added: rows.length,
    cp,
    kp,
    lop: selected.lop,
    ngay,
    buoi,
    total: diemDanhList.length
  };

  if (silent) return result;

  if (rows.length) {
    alert(
      `Đã thêm ${rows.length} bạn vắng của lớp ${selected.lop} — buổi ${buoiLabel()} (${fmtDate(ngay)}).\n` +
      `Vắng có phép: ${cp} — Vắng không phép: ${kp}\n\n` +
      `Bấm "Gửi" để đưa lên danh sách chính.`
    );
  } else {
    alert(
      `Lớp ${selected.lop} — buổi ${buoiLabel()} (${fmtDate(ngay)}) không có bạn nào vắng.\n` +
      `Không có gì để thêm vào danh sách.`
    );
  }
  return result;
}

function renderDanhSachDD() {
  const tbody = document.getElementById("ddTableBody");
  const countEl = document.getElementById("ddCount");
  if (countEl) countEl.textContent = diemDanhList.length;
  if (!tbody) return;

  if (!diemDanhList.length) {
    tbody.innerHTML =
      `<tr><td colspan="10" class="empty">Chưa có dữ liệu. Chọn lớp, đánh dấu vắng rồi bấm "Thêm vào danh sách".</td></tr>`;
    return;
  }

  tbody.innerHTML = diemDanhList.map((r, i) => `
    <tr>
      <td>${esc(r.maSV)}</td>
      <td class="ten">
        ${esc(r.tenSV)}
        <div class="tiny">${esc(r.lop)}${r.khoaHoc ? " · " + esc(r.khoaHoc) : ""} · Buổi ${r.buoi === "chieu" ? "chiều" : "sáng"}</div>
      </td>
      <td class="col-lop">${esc(r.lop)}</td>
      <td class="col-khoa">${esc(r.khoaHoc)}</td>
      <td class="col-nganh">${esc(r.khoa)}</td>
      <td>${esc(fmtDate(r.ngay))}</td>
      <td class="col-buoi">${r.buoi === "chieu" ? "Chiều" : "Sáng"}</td>
      <td>
        <span class="dd-badge ${r.trangThai === "vang_co_phep" ? "cp" : "kp"}">
          ${r.trangThai === "vang_co_phep" ? "Vắng có phép" : "Vắng không phép"}
        </span>
      </td>
      <td class="col-nguoi">${esc(r.nguoiNhap)}</td>
      <td class="col-xoa">
        <button class="dd-xoa" data-i="${i}" title="Xoá dòng này">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".dd-xoa").forEach(btn => {
    btn.addEventListener("click", () => xoaDongDD(Number(btn.dataset.i)));
  });
}

function xoaDongDD(i) {
  const r = diemDanhList[i];
  if (!r) return;

  if (!confirm(`Xoá ${r.tenSV} (${r.maSV}) — ${fmtDate(r.ngay)} · buổi ${r.buoi === "chieu" ? "chiều" : "sáng"}?`)) return;

  diemDanhList.splice(i, 1);
  saveData();
  renderDanhSachDD();
}

// Đẩy danh sách chờ gửi lên Firestore (thay thế dữ liệu cũ cùng lớp + ngày)
async function dayLenFirestore(rows) {
  if (!rows.length) return { written: 0, deleted: 0 };

  // Gom theo đúng "cơ sở + ngày + lớp" để chỉ đọc những bản ghi cần thay thế.
  // (Trước đây đọc toàn bộ collection diemdanh của cơ sở → rất tốn lượt đọc.)
  const slots = new Map();
  rows.forEach(r => {
    const key = `${r.coso}|${r.ngay}|${r.lop}`;
    if (!slots.has(key)) {
      slots.set(key, {
        coso: r.coso,
        ngay: r.ngay,
        lop: r.lop,
        buois: new Set()
      });
    }
    slots.get(key).buois.add(r.buoi || "sang");
  });

  const oldIds = [];

  await Promise.all([...slots.values()].map(async slot => {
    const snap = await getDocs(
      query(
        collection(db, "diemdanh"),
        where("coso", "==", slot.coso),
        where("ngay", "==", slot.ngay),
        where("lop", "==", slot.lop)
      )
    );

    snap.forEach(d => {
      const v = d.data();
      const b = v.buoi || "sang"; // bản ghi cũ chưa có buổi → coi là sáng
      if (slot.buois.has(b)) oldIds.push(d.id);
    });
  }));

  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  for (const id of oldIds) {
    batch.delete(doc(db, "diemdanh", id));
    ops++;
    await flush();
  }

  for (const r of rows) {
    batch.set(doc(collection(db, "diemdanh")), {
      coso: r.coso,
      ngay: r.ngay,
      year: r.year,
      month: r.month,
      day: r.day,
      buoi: r.buoi || "sang",
      maSV: r.maSV,
      tenSV: r.tenSV,
      khoa: r.khoa,
      khoaHoc: r.khoaHoc,
      lop: r.lop,
      trangThai: r.trangThai,
      nguoiNhap: r.nguoiNhap || "",
      createdAt: serverTimestamp()
    });
    ops++;
    await flush();
  }

  if (ops > 0) await batch.commit();

  return { written: rows.length, deleted: oldIds.length };
}

// Gửi toàn bộ danh sách chờ gửi lên hệ thống chung
async function guiDiemDanh() {
  if (isSending) return;

  if (!diemDanhList.length) {
    alert('Chưa có dữ liệu! Hãy bấm "Thêm vào danh sách" trước.');
    return;
  }

  const dates = [...new Set(diemDanhList.map(r => r.ngay))].sort();
  const lops = [...new Set(diemDanhList.map(r => r.lop))]
    .sort((a, b) => a.localeCompare(b, "vi"));
  const buois = [...new Set(diemDanhList.map(r => r.buoi || "sang"))]
    .map(b => b === "chieu" ? "Chiều" : "Sáng");
  const kp = diemDanhList.filter(r => r.trangThai === "vang_khong_phep").length;
  const cp = diemDanhList.filter(r => r.trangThai === "vang_co_phep").length;

  const ok = confirm(
    `Gửi ${diemDanhList.length} bản ghi lên hệ thống chung?\n\n` +
    `Lớp: ${lops.join(", ")}\n` +
    `Ngày: ${dates.map(fmtDate).join(", ")} · Buổi: ${buois.join(", ")}\n` +
    `Vắng có phép: ${cp} — Vắng không phép: ${kp}\n\n` +
    `(Dữ liệu cũ cùng lớp + ngày + buổi sẽ được thay thế)`
  );
  if (!ok) return;

  isSending = true;
  const btn = document.getElementById("btnGuiDiemDanh");
  const oldHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi...';
  }

  try {
    const sent = diemDanhList.slice();
    const res = await dayLenFirestore(sent);

    const sentKeys = new Set(sent.map(rowKey));
    diemDanhList = diemDanhList.filter(r => !sentKeys.has(rowKey(r)));
    saveData();
    renderDanhSachDD();

    localStorage.setItem(
      "dd_view_ngay",
      dates[dates.length - 1] || todayStr()
    );
    localStorage.setItem(
      "dd_view_buoi",
      buois.length === 1 ? (buois[0] === "Chiều" ? "chieu" : "sang") : ""
    );

    alert(
      `Đã gửi ${res.written} bản ghi lên danh sách!\n` +
      `(Thay thế ${res.deleted} bản ghi cũ)`
    );
    window.location.href = "danhsach-diemdanh.html";
  } catch (e) {
    console.error(e);
    saveData();
    renderDanhSachDD();
    alert(
      "Lỗi gửi điểm danh:\n" + (e.message || e) +
      "\n\nPhần chưa gửi vẫn còn trong danh sách, không bị mất."
    );
  } finally {
    isSending = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  }
}
window.guiDiemDanh = guiDiemDanh;
window.themVaoDanhSach = themVaoDanhSach;

/* ---------- 6b. Thanh tìm lớp ---------- */
const searchInput = document.getElementById("searchLop");
const searchClear = document.getElementById("searchClear");

searchInput.addEventListener("input", () => {
  const q = searchInput.value;
  searchClear.classList.toggle("show", !!q.trim());

  if (q.trim()) renderSearch(q);
  else restoreView();
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.classList.remove("show");
  restoreView();
  searchInput.focus();
});

searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && searchInput.value.trim()) {
    const first = document.querySelector("#contentDD .pick-btn");
    if (first) first.click();
  }
});

/* ---------- 7. Tải dữ liệu ---------- */
async function loadStudents() {
  try {
    // Chỉ đọc 1 document meta/studentTree thay vì quét toàn bộ collection students.
    const metaTree = await getStudentTree();
    const tree = {};
    classCounts = {};
    const allow = new Set(favKhoa(COSO));
    const allowedKeys = Object.keys(metaTree).filter(k => allow.has(k));
    const useKeys = allowedKeys.length ? allowedKeys : Object.keys(metaTree);

    useKeys.forEach(khoa => {
      tree[khoa] = {};
      Object.keys(metaTree[khoa] || {}).forEach(khoaHoc => {
        tree[khoa][khoaHoc] = {};
        Object.keys(metaTree[khoa][khoaHoc] || {}).forEach(lop => {
          tree[khoa][khoaHoc][lop] = [];
          classCounts[`${khoa}|${khoaHoc}|${lop}`] =
            Number(metaTree[khoa][khoaHoc][lop]) || 0;
        });
      });
    });

    data = tree;

    const cosoLine = document.getElementById("cosoline");
    if (cosoLine) cosoLine.innerText = "Cơ sở: " + COSO;

    if (!Object.keys(tree).length) {
      document.getElementById("title").innerText = "Chưa có dữ liệu sinh viên";
      document.getElementById("contentDD").innerHTML =
        `<div class="text-gray-600 p-4 bg-white rounded shadow">
           Không tìm thấy sinh viên của cơ sở <b>${esc(COSO)}</b> trong Firebase.
         </div>`;
      return;
    }

    showKhoa();
  } catch (e) {
    console.error(e);
    alert("Lỗi tải danh sách sinh viên từ Firebase.\n" + (e.message || e));
  }
}

/* ---------- 8. Tiện ích cho trợ lý chat ---------- */
const classKeyOf = c => `${c.khoa}|${c.khoaHoc}|${c.lop}`;

function allClasses() {
  const out = [];
  Object.keys(data || {}).forEach(khoa => {
    Object.keys(data[khoa] || {}).forEach(khoaHoc => {
      Object.keys(data[khoa][khoaHoc] || {}).forEach(lop => {
        const students = data[khoa][khoaHoc][lop] || [];
        const key = `${khoa}|${khoaHoc}|${lop}`;
        out.push({
          khoa,
          khoaHoc,
          lop,
          students,
          count: students.length || classCounts[key] || 0
        });
      });
    });
  });
  return out.sort((a, b) => String(a.lop).localeCompare(String(b.lop), "vi"));
}

function classByKey(key) {
  return allClasses().find(c => classKeyOf(c) === key) || null;
}

// Tải danh sách sinh viên của 1 lớp khi trợ lý chat thật sự cần đến tên SV.
async function ensureClassStudents(cls) {
  if (!cls) return [];

  const key = classKeyOf(cls);
  let list = (data[cls.khoa] && data[cls.khoa][cls.khoaHoc] &&
    data[cls.khoa][cls.khoaHoc][cls.lop]) || [];

  if (!list.length) {
    list = await getStudentsByClass(cls.khoa, cls.khoaHoc, cls.lop);
    data[cls.khoa][cls.khoaHoc][cls.lop] = list;
    classCounts[key] = list.length;
  }

  cls.students = list;
  cls.count = list.length;
  return list;
}

function findClasses(q) {
  const nq = norm(q);
  if (!nq) return [];

  const cleaned = nq
    .replace(/\b(mo|chon|chuyen|vao|den|di|xem|sang|lop|class|giup|toi|minh|voi|nhe|nha)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const needle = cleaned;
  if (!needle) return [];

  const all = allClasses();

  const exact = all.filter(c => norm(c.lop) === needle);
  if (exact.length) return exact;

  return all.filter(c =>
    norm(`${c.lop} ${c.khoaHoc} ${c.khoa}`).includes(needle)
  );
}

function currentClass() {
  if (view.level !== "sv") return null;
  return classByKey(`${view.khoa}|${view.khoaHoc}|${view.lop}`);
}

// Áp dụng kết quả từ chat vào lớp (mở lớp nếu chưa mở)
async function applyChatAttendance(cls, picks) {
  if (!cls || !picks || !picks.length) return 0;

  await ensureClassStudents(cls);

  if (
    view.level !== "sv" ||
    view.khoa !== cls.khoa ||
    view.khoaHoc !== cls.khoaHoc ||
    view.lop !== cls.lop
  ) {
    await showSinhVien(cls.khoa, cls.khoaHoc, cls.lop);
  }

  picks.forEach(p => setStatus(p.maSV, p.trangThai));
  return picks.length;
}

function summaryNow() {
  const values = Object.values(statusMap);
  const kp = values.filter(v => v === "vang_khong_phep").length;
  const cp = values.filter(v => v === "vang_co_phep").length;
  return {
    total: values.length,
    kv: values.length - kp - cp,
    cp,
    kp
  };
}

function setNgay(iso) {
  const inp = document.getElementById("ngayDiemDanh");
  if (inp && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    inp.value = iso;
    return true;
  }
  return false;
}

/* Nút chuyển buổi + tất cả có mặt */
document.querySelectorAll("#buoiSeg .buoi-btn").forEach(btn => {
  btn.addEventListener("click", () => setBuoi(btn.dataset.buoi));
});
syncBuoiUI();

const btnAllPresentEl = document.getElementById("btnAllPresent");
if (btnAllPresentEl) {
  btnAllPresentEl.addEventListener("click", () => {
    const n = allPresent();
    if (!n) return;
    const old = btnAllPresentEl.innerHTML;
    btnAllPresentEl.innerHTML = '<i class="fa-solid fa-check"></i> Đã đặt lại';
    setTimeout(() => { btnAllPresentEl.innerHTML = old; }, 900);
  });
}

/* Khởi tạo trợ lý chat */
initAttendanceChat({
  getProfile: () => profile,
  getCoso: () => COSO,
  getView: () => ({ ...view }),
  getSelected: () => ({ ...selected }),
  getBuoi: () => buoi,
  getBuoiLabel: () => buoiLabel(),
  getNgay: () => document.getElementById("ngayDiemDanh")?.value || todayStr(),
  getStatusMap: () => ({ ...statusMap }),
  getSummary: summaryNow,
  getCurrentClass: currentClass,
  allClasses,
  classByKey,
  classKeyOf,
  findClasses,
  ensureClassStudents,
  openClass: cls => showSinhVien(cls.khoa, cls.khoaHoc, cls.lop),
  goKhoa: showKhoa,
  goLop: () => {
    if (view.khoa && view.khoaHoc) showLop(view.khoa, view.khoaHoc);
    else if (view.khoa) showKhoaHoc(view.khoa);
    else showKhoa();
  },
  setBuoi,
  setNgay,
  applyAttendance: applyChatAttendance,
  addToList: () => themVaoDanhSach({ silent: true }),
  submit: guiDiemDanh,
  allPresent,
  getPending: () => diemDanhList.map(r => ({ ...r })),
  fmtDate,
  todayStr
});
/* ---------- 9. Khởi động ---------- */
document.getElementById("app").classList.remove("hidden");
document.getElementById("ngayDiemDanh").value = todayStr();
syncBuoiUI();
updateStatus();
loadData();
syncBackButton();
loadStudents();
