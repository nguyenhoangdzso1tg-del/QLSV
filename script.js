import { db } from "./firebase.js";
import { requireApproved, applyProfileUI } from "./app-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  limit,
  orderBy,
  startAfter
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ===== XÁC THỰC & QUYỀN ===== */
const profile = await requireApproved();
if (!profile) {
  // requireApproved đã chuyển trang hoặc hiện thông báo — dừng module tại đây
  await new Promise(() => {});
}
applyProfileUI(profile);

/* ===== CƠ SỞ (Chu Văn An / Mạc Cửu) ===== */
const COSO_CVA = "Chu Văn An";
const COSO_MC = "Mạc Cửu";
const COSO = profile.coso || localStorage.getItem("coso") || "";
if (!COSO) window.location.href = "login.html";

const cosoLineEl = document.getElementById("cosoLine");
if (cosoLineEl) cosoLineEl.textContent = "Cơ sở: " + COSO;

/* ===== CACHE DỮ LIỆU THEO NGÀY (tránh đọc lại Firestore khi bấm qua lại) ===== */
const DAY_CACHE_PREFIX = "vp_day_v1_";
const DAY_CACHE_TTL = 10 * 60 * 1000; // 10 phút
const dateMemory = new Map();

function dayKey(d) {
  return (
    d.year + "-" +
    String(d.month).padStart(2, "0") + "-" +
    String(d.day).padStart(2, "0")
  );
}

function dayCacheKey(dateStr) {
  return DAY_CACHE_PREFIX + encodeURIComponent(COSO) + "_" + dateStr;
}

function readDayCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeDayCache(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), list }));
  } catch {
    /* localStorage đầy: vẫn dùng cache trong RAM */
  }
}

function isFreshDay(entry) {
  return !!(entry && entry.at && Date.now() - entry.at < DAY_CACHE_TTL);
}

async function fetchViolationsForDate(d, { force = false } = {}) {
  const dateStr = dayKey(d);
  const memKey = COSO + "|" + dateStr;

  if (!force && dateMemory.has(memKey)) {
    return dateMemory.get(memKey);
  }

  const key = dayCacheKey(dateStr);

  if (!force) {
    const cached = readDayCache(key);
    if (isFreshDay(cached) && Array.isArray(cached.list)) {
      dateMemory.set(memKey, cached.list);
      return cached.list;
    }
  }

  const result = [];
  let lastDoc = null;

  while (true) {
    const constraints = [
      where("coso", "==", COSO),
      where("ngay", "==", dateStr),
      orderBy("ngay"),
      limit(1000)
    ];

    if (lastDoc) {
      constraints.push(startAfter(lastDoc));
    }

    const snap = await getDocs(
      query(collection(db, "violations"), ...constraints)
    );

    snap.forEach((doc) => {
      result.push({
        id: doc.id,
        ...doc.data()
      });
    });

    if (snap.size < 1000) break;

    lastDoc = snap.docs[snap.docs.length - 1];
  }

  dateMemory.set(memKey, result);
  writeDayCache(key, result);

  return result;
}

async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = index++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

async function getSelectedViolations({ force = false } = {}) {
  if (selectedDates.length === 0) return [];

  // Chỉ tải ngày CHƯA có trong cache; ngày đã tải thì dùng lại.
  const lists = await mapLimit(
    selectedDates,
    5,
    (d) => fetchViolationsForDate(d, { force })
  );

  return lists.flat();
}


// 2. Khởi tạo các biến cho lịch

let selectedDates = []; 
// mỗi phần tử: { day, month, year }

let today = new Date();
let currentMonth = today.getMonth();    // 0 = Tháng 1
let currentYear = today.getFullYear();

const monthYearLabel = document.getElementById('monthYear');
const calendarBody = document.getElementById('calendar-body');

const months = [
    "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4",
    "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8",
    "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"
];

// 3. Hàm hiển thị lịch cho tháng, năm cho trước
function renderCalendar(month, year) {
    calendarBody.innerHTML = '';
    // Xác định ngày đầu tiên của tháng (0=CN)
    let firstDay = new Date(year, month, 1).getDay();
    // Số ngày trong tháng đó
    let daysInMonth = new Date(year, month + 1, 0).getDate();

    let date = 1;
    // Tạo 6 hàng (đủ cho 5-6 tuần)
    for (let i = 0; i < 6; i++) {
        let row = document.createElement('tr');
        for (let j = 0; j < 7; j++) {
            let cell = document.createElement('td');
            if (i === 0 && j < firstDay) {
                // Các ô trước ngày 1
                cell.classList.add('inactive');
            } else if (date > daysInMonth) {
                // Các ô sau khi hết ngày tháng
                cell.classList.add('inactive');
            } else {
    // 1. Hiển thị số ngày
    cell.innerText = date;

    // 2. Gắn dữ liệu ngày / tháng / năm vào ô
    cell.dataset.day = date;
    cell.dataset.month = month + 1;
    cell.dataset.year = year;

    // 3. GẮN CLICK CHO Ô NGÀY (BẠN ĐANG THIẾU DÒNG NÀY)
    cell.addEventListener("click", () => {
        handleDateClick(cell);
    });

    // 4. Tăng ngày
    date++;
}

            row.appendChild(cell);
        }
        calendarBody.appendChild(row);
    }
    monthYearLabel.innerText = months[month] + ' ' + year;
}
const VIOLATION_TYPES = [
  "Đi trễ",
  "Hút thuốc",
  "Mang dép",
  "Sai đồng phục",
  "Không thẻ sinh viên",
  "Vắng có phép",
  "Vắng không phép",
  "Vắng chào cờ"
];



// 4. Xử lý nút chuyển tháng
document.getElementById('prevMonth').addEventListener('click', function() {
    currentMonth--;
    if (currentMonth < 0) {
        currentYear--;
        currentMonth = 11;
    }
    renderCalendar(currentMonth, currentYear);
});
document.getElementById('nextMonth').addEventListener('click', function() {
    currentMonth++;
    if (currentMonth > 11) {
        currentYear++;
        currentMonth = 0;
    }
    renderCalendar(currentMonth, currentYear);
});




// 7. Khởi tạo lịch khi vừa load trang
renderCalendar(currentMonth, currentYear);
function aggregateOne(v) {
  const result = {
    maSV: v.maSV,
    hoTen: v.hoTen,
    lop: v.lop,
    khoa: v.khoa,
    khoaHoc: v.khoaHoc,
    ngay: v.ngay
  };

  // mặc định = 0
  VIOLATION_TYPES.forEach(type => {
    result[type] = 0;
  });

  // các lỗi KHÁC (gõ tay, không thuộc 7 loại chuẩn)
  result.khac = [];

  // tách lỗi
  const list = String(v.vipham || "").split(",").map(x => x.trim()).filter(Boolean);

  list.forEach(l => {
    if (VIOLATION_TYPES.includes(l)) {
      result[l]++;
    } else {
      result.khac.push(l);
    }
  });

  result.tong = list.length;
  return result;
}
function groupViolations(data) {
  const map = {};

  data.forEach(v => {
    const key = v.maSV + "_" + v.ngay;

    if (!map[key]) {
      map[key] = aggregateOne(v);
    } else {
      const temp = aggregateOne(v);
      VIOLATION_TYPES.forEach(t => {
        map[key][t] += temp[t];
      });
      map[key].khac.push(...temp.khac);
      map[key].tong += temp.tong;
    }
  });

  return Object.values(map);
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Cột "Chi tiết khác": tên các lỗi gõ tay (cột "Khác" chỉ chứa số để Excel cộng được)
function khacNamesHtml(khac) {
  const arr = khac || [];
  return arr.length ? '<span class="khac-names">' + escapeHtml(arr.join(", ")) + "</span>" : "";
}

function renderTable(list) {
  const tbody = document.getElementById("calendarViolationList");

  tbody.innerHTML = "";

  list.forEach((v, i) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(v.maSV)}</td>
      <td>${escapeHtml(v.hoTen)}</td>
      <td>${escapeHtml(v.lop)}</td>
      <td>${escapeHtml(v.khoaHoc)}</td>
      <td>${escapeHtml(v.khoa)}</td>
      <td>${escapeHtml(v.ngay)}</td>
      <td>${v["Mang dép"]}</td>
      <td>${v["Đi trễ"]}</td>
      <td>${v["Hút thuốc"]}</td>
      <td>${v["Sai đồng phục"]}</td>
      <td>${v["Không thẻ sinh viên"]}</td>
      <td>${v["Vắng có phép"]}</td>
      <td>${v["Vắng không phép"]}</td>
      <td>${v["Vắng chào cờ"]}</td>
      <td>${(v.khac || []).length}</td>
      <td class="khac-cell">${khacNamesHtml(v.khac)}</td>
      <td><b>${v.tong}</b></td>
    `;

    tbody.appendChild(tr);
  });

  document.getElementById("totalCount").innerText =
    "Tổng số lỗi: " + list.reduce((s, v) => s + v.tong, 0);
}

async function loadMultiDays({ force = false } = {}) {
  if (selectedDates.length === 0) {
    document.getElementById("calendarViolationList").innerHTML = "";
    document.getElementById("totalCount").innerText = "";
    return;
  }

  try {
    // Chỉ tải ngày chưa có cache; ngày đã tải dùng lại (không tốn lượt đọc)
    const allData = await getSelectedViolations({ force });
    const grouped = groupViolations(allData);
    renderTable(grouped);
  } catch (e) {
    console.error(e);
    alert(
      "Lỗi tải dữ liệu.\nNếu Firebase yêu cầu tạo index, mở link trong Console (F12) (nhớ chọn đúng cơ sở tương ứng).\n" +
      (e.message || e)
    );
  }
}

function handleDateClick(cell) {
  const day = Number(cell.dataset.day);
  const month = Number(cell.dataset.month);
  const year = Number(cell.dataset.year);

  // Tạo key để so sánh
  const key = `${year}-${month}-${day}`;

  // Kiểm tra ngày này đã được chọn chưa
  const index = selectedDates.findIndex(
    d => `${d.year}-${d.month}-${d.day}` === key
  );

  if (index >= 0) {
    // 👉 ĐÃ CHỌN → BỎ CHỌN
    selectedDates.splice(index, 1);
    cell.classList.remove("active");
  } else {
    // 👉 CHƯA CHỌN → THÊM
    selectedDates.push({ day, month, year });
    cell.classList.add("active");
  }

  // Load dữ liệu theo nhiều ngày
  updateSelectedDaysLabel();

  loadMultiDays();
}

function updateSelectedDaysLabel() {
  const label = document.getElementById("selectedDaysLabel");

  if (selectedDates.length === 0) {
    label.innerText = "Các ngày đã chọn: —";
    return;
  }

  // Sắp xếp ngày tăng dần
  const sorted = [...selectedDates].sort((a, b) => {
    const d1 = new Date(a.year, a.month - 1, a.day);
    const d2 = new Date(b.year, b.month - 1, b.day);
    return d1 - d2;
  });

  // Định dạng dd/mm/yyyy
  const text = sorted
    .map(d =>
      `${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}/${d.year}`
    )
    .join(", ");

  label.innerText = "Các ngày đã chọn: " + text;
}

/* ===== CHỌN NHANH CẢ THÁNG / BỎ CHỌN ===== */
function selectAllMonth() {
  // Chọn hết các ngày đang hiển thị trên lịch (tháng đang xem)
  const cells = document.querySelectorAll("#calendar-body td[data-day]");
  let added = 0;

  cells.forEach(cell => {
    const day = Number(cell.dataset.day);
    const month = Number(cell.dataset.month);
    const year = Number(cell.dataset.year);

    const key = `${year}-${month}-${day}`;
    const exists = selectedDates.findIndex(
      d => `${d.year}-${d.month}-${d.day}` === key
    );

    if (exists < 0) {
      selectedDates.push({ day, month, year });
      cell.classList.add("active");
      added++;
    }
  });

  if (added === 0 && selectedDates.length > 0) {
    alert("Cả tháng này đã được chọn rồi!");
  }

  updateSelectedDaysLabel();
  loadMultiDays();
}

function clearSelection() {
  selectedDates = [];
  document.querySelectorAll("#calendar-body td.active").forEach(c => c.classList.remove("active"));
  updateSelectedDaysLabel();
  loadMultiDays();
}

document.getElementById("selectAllMonth").addEventListener("click", selectAllMonth);
document.getElementById("clearSelection").addEventListener("click", clearSelection);

const refreshCalendarBtn = document.getElementById("refreshCalendar");
if (refreshCalendarBtn) {
  refreshCalendarBtn.addEventListener("click", () => {
    // Xóa cache của các ngày đang chọn rồi tải lại từ Firebase
    selectedDates.forEach((d) => {
      const dateStr = dayKey(d);
      dateMemory.delete(COSO + "|" + dateStr);
      try {
        localStorage.removeItem(dayCacheKey(dateStr));
      } catch {
        /* ignore */
      }
    });
    loadMultiDays({ force: true });
  });
}
// Excel: đổi ô "chữ số" thành số thật để dùng được SUM / công thức
function coerceNumericCells(ws) {
  Object.keys(ws).forEach(addr => {
    if (addr.charAt(0) === "!") return;
    const cell = ws[addr];
    if (!cell || cell.t !== "s" || typeof cell.v !== "string") return;
    const s = cell.v.trim();
    // chỉ nhận số thuần (tránh đổi nhầm mã SV / ngày / lớp)
    if (/^-?\d{1,9}(\.\d+)?$/.test(s)) {
      cell.t = "n";
      cell.v = Number(s);
      delete cell.w;
    }
  });
  return ws;
}

document.getElementById("exportExcelBtn").addEventListener("click", () => {
    const table = document.getElementById("violationTable");

    if (!table || table.rows.length <= 1) {
        alert("Không có dữ liệu để xuất!");
        return;
    }

    const aoa = [[ "Cơ sở: " + COSO ]]; // dòng cơ sở ở trên đầu
    table.querySelectorAll("tr").forEach(tr => {
        aoa.push(Array.from(tr.children).map(td => td.innerText.trim()));
    });

    const ws = coerceNumericCells(XLSX.utils.aoa_to_sheet(aoa));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vi phạm");

    const fileName = "vi_pham_" + COSO.replace(" ", "_") + "_" + new Date().toISOString().slice(0,10) + ".xlsx";
    XLSX.writeFile(wb, fileName);
});
function groupMultiDays(data) {
  const map = {};

  data.forEach(v => {
    const key = v.maSV + "_" + v.lop + "_" + v.khoa + "_" + v.khoaHoc;

    const temp = aggregateOne(v);

    if (!map[key]) {
      map[key] = {
        maSV: v.maSV,
        hoTen: v.hoTen,
        lop: v.lop,
        khoa: v.khoa,
        khoaHoc: v.khoaHoc,
        tong: 0,
        khac: []
      };

      // init = 0
      VIOLATION_TYPES.forEach(t => {
        map[key][t] = 0;
      });
    }

    VIOLATION_TYPES.forEach(t => {
      map[key][t] += temp[t];
    });

    map[key].khac.push(...temp.khac);
    map[key].tong += temp.tong;
  });

  return Object.values(map);
}
function renderMergeTable(list) {
  const tbody = document.getElementById("mergeList");
  tbody.innerHTML = "";

  list.forEach((v, i) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(v.maSV)}</td>
      <td>${escapeHtml(v.hoTen)}</td>
      <td>${escapeHtml(v.lop)}</td>
      <td>${escapeHtml(v.khoaHoc)}</td>
      <td>${escapeHtml(v.khoa)}</td>
      <td>${v["Mang dép"]}</td>
      <td>${v["Đi trễ"]}</td>
      <td>${v["Hút thuốc"]}</td>
      <td>${v["Sai đồng phục"]}</td>
      <td>${v["Không thẻ sinh viên"]}</td>
      <td>${v["Vắng có phép"]}</td>
      <td>${v["Vắng không phép"]}</td>
      <td>${v["Vắng chào cờ"]}</td>
      <td>${(v.khac || []).length}</td>
      <td class="khac-cell">${khacNamesHtml(v.khac)}</td>
      <td><b>${v.tong}</b></td>
    `;

    tbody.appendChild(tr);
  });
}
document.getElementById("mergeBtn").addEventListener("click", async () => {

  if (selectedDates.length === 0) {
    alert("Hãy chọn ngày trước!");
    return;
  }

  try {
    // Dùng lại cache của bảng chi tiết — không query lại Firebase
    const allData = await getSelectedViolations();
    const merged = groupMultiDays(allData);
    renderMergeTable(merged);
  } catch (e) {
    console.error(e);
    alert(
      "Lỗi gộp dữ liệu.\nNếu Firebase yêu cầu tạo index, mở link trong Console (F12).\n" +
      (e.message || e)
    );
  }
});
document.getElementById("exportExcelBtn2").addEventListener("click", () => {
    const table = document.getElementById("mergeTable");

    if (!table || table.rows.length <= 1) {
        alert("Không có dữ liệu để xuất!");
        return;
    }

    const aoa = [[ "Cơ sở: " + COSO ]]; // dòng cơ sở ở trên đầu
    table.querySelectorAll("tr").forEach(tr => {
        aoa.push(Array.from(tr.children).map(td => td.innerText.trim()));
    });

    const ws = coerceNumericCells(XLSX.utils.aoa_to_sheet(aoa));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bảng gộp");

    const fileName = "bang_gop_" + COSO.replace(" ", "_") + "_" + new Date().toISOString().slice(0,10) + ".xlsx";
    XLSX.writeFile(wb, fileName);
});