/* =========================================================
   QUẢN TRỊ NGƯỜI DÙNG — duyệt, gán cơ sở, phân quyền
   ========================================================= */
import { auth, db } from "./firebase.js";
import {
  collection,
  doc,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  requireApproved,
  ROLE_LABEL,
  DEFAULT_AVATAR
} from "./app-auth.js";

const profile = await requireApproved({
  requireRole: ["admin"],
  requireCoso: false
});

let allUsers = [];
let loading = false;

const listEl = document.getElementById("userList");
const searchInput = document.getElementById("searchInput");
const filterStatus = document.getElementById("filterStatus");
const refreshBtn = document.getElementById("refreshBtn");
const toastEl = document.getElementById("toast");

if (profile) {
  init();
}

function init() {
  refreshBtn.addEventListener("click", loadUsers);
  searchInput.addEventListener("input", render);
  filterStatus.addEventListener("change", render);

  listEl.addEventListener("change", async (e) => {
    const el = e.target;
    const card = el.closest(".user-card");
    if (!card) return;
    const uid = card.dataset.uid;
    const user = allUsers.find((u) => u.id === uid);
    if (!user) return;

    if (el.dataset.action === "role") {
      const newRole = el.value;
      if (uid === profile.id && newRole !== "admin") {
        const ok = confirm(
          "Bạn đang tự hạ quyền chính mình khỏi Admin.\nSau khi lưu, bạn sẽ không còn vào được trang này.\n\nTiếp tục?"
        );
        if (!ok) {
          render();
          return;
        }
      }
      await saveUser(uid, { role: newRole }, "Đã đổi vai trò");
    }

    if (el.dataset.action === "coso") {
      await saveUser(uid, { coso: el.value }, "Đã cập nhật cơ sở");
    }
  });

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest(".user-card");
    if (!card) return;
    const uid = card.dataset.uid;
    const user = allUsers.find((u) => u.id === uid);
    if (!user) return;

    if (btn.dataset.action === "approve") {
      await saveUser(
        uid,
        { approved: true, rejected: false },
        "Đã duyệt tài khoản"
      );
    }

    if (btn.dataset.action === "reject") {
      if (uid === profile.id) {
        showToast("Không thể tự từ chối tài khoản của mình.", true);
        return;
      }
      if (!confirm("Từ chối / thu hồi quyền truy cập của " + (user.displayName || user.email || uid) + "?")) {
        return;
      }
      await saveUser(
        uid,
        { approved: false, rejected: true },
        "Đã từ chối tài khoản"
      );
    }

    if (btn.dataset.action === "delete") {
      if (uid === profile.id) {
        showToast("Không thể xoá hồ sơ của chính mình.", true);
        return;
      }
      if (
        !confirm(
          "Xoá hồ sơ của " + (user.displayName || user.email || uid) + " khỏi Firestore?\n\n" +
            "Tài khoản Google vẫn tồn tại; nếu người này đăng nhập lại sẽ được tạo hồ sơ mới ở trạng thái chờ duyệt."
        )
      ) {
        return;
      }
      await removeUser(uid);
    }
  });

  loadUsers();
}

/* ---------- Tải dữ liệu ---------- */
async function loadUsers() {
  if (loading) return;
  loading = true;
  refreshBtn.disabled = true;
  refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...';

  try {
    const snap = await getDocs(collection(db, "users"));
    allUsers = [];
    snap.forEach((d) => {
      allUsers.push({ id: d.id, ...d.data() });
    });

    allUsers.sort((a, b) => {
      const pa = statusPriority(a);
      const pb = statusPriority(b);
      if (pa !== pb) return pa - pb;
      return timeOf(b.createdAt) - timeOf(a.createdAt);
    });

    render();
  } catch (e) {
    console.error(e);
    listEl.innerHTML =
      '<div class="empty">Lỗi tải danh sách: ' +
      escapeHtml(e.message || String(e)) +
      "</div>";
    showToast("Tải thất bại: " + (e.message || e), true);
  } finally {
    loading = false;
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Tải lại';
  }
}

function statusPriority(u) {
  if (u.rejected === true) return 2;
  if (u.approved === true) return 3;
  return 1; // chờ duyệt
}

function timeOf(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function formatTime(ts) {
  const ms = timeOf(ts);
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("vi-VN");
  } catch (e) {
    return "—";
  }
}

function statusOf(u) {
  if (u.rejected === true) return "rejected";
  if (u.approved === true) return "approved";
  return "pending";
}

/* ---------- Render ---------- */
function render() {
  const kw = normalize(searchInput.value);
  const statusFilter = filterStatus.value;

  const filtered = allUsers.filter((u) => {
    if (statusFilter && statusOf(u) !== statusFilter) return false;
    if (!kw) return true;
    const hay = normalize(
      [u.displayName, u.email, u.coso, u.role].join(" ")
    );
    return hay.includes(kw);
  });

  renderStats();

  if (!filtered.length) {
    listEl.innerHTML =
      '<div class="empty"><i class="fa-solid fa-user-slash" style="font-size:26px;display:block;margin-bottom:10px;opacity:.5"></i>' +
      (allUsers.length
        ? "Không có người dùng nào khớp bộ lọc."
        : "Chưa có người dùng nào. Hãy đăng nhập bằng Google trên trang đăng nhập để tạo hồ sơ đầu tiên.") +
      "</div>";
    return;
  }

  listEl.innerHTML = filtered.map(cardHtml).join("");
}

function cardHtml(u) {
  const st = statusOf(u);
  const isSelf = u.id === profile.id;
  const role = u.role || "user";

  const statusTag = isSelf
    ? '<span class="tag self"><i class="fa-solid fa-user-check"></i> Bạn</span>'
    : st === "approved"
    ? '<span class="tag approved"><i class="fa-solid fa-circle-check"></i> Đã duyệt</span>'
    : st === "rejected"
    ? '<span class="tag rejected"><i class="fa-solid fa-circle-xmark"></i> Bị từ chối</span>'
    : '<span class="tag pending"><i class="fa-solid fa-hourglass-half"></i> Chờ duyệt</span>';

  const roleOptions = ["user", "manager", "admin"]
    .map(
      (r) =>
        '<option value="' +
        r +
        '"' +
        (role === r ? " selected" : "") +
        ">" +
        (ROLE_LABEL[r] || r) +
        "</option>"
    )
    .join("");

  const cosoOptions = [
    { value: "", label: "— Chưa gán —" },
    { value: "Chu Văn An", label: "Chu Văn An" },
    { value: "Mạc Cửu", label: "Mạc Cửu" }
  ]
    .map(
      (c) =>
        '<option value="' +
        escapeAttr(c.value) +
        '"' +
        ((u.coso || "") === c.value ? " selected" : "") +
        ">" +
        escapeHtml(c.label) +
        "</option>"
    )
    .join("");

  const approveBtn =
    st === "approved"
      ? ""
      : '<button type="button" class="approve-btn" data-action="approve"><i class="fa-solid fa-check"></i> Duyệt</button>';

  const rejectBtn =
    st === "approved" && !isSelf
      ? '<button type="button" class="reject-btn" data-action="reject"><i class="fa-solid fa-lock"></i> Thu hồi</button>'
      : "";

  return (
    '<div class="user-card ' + st + '" data-uid="' + escapeAttr(u.id) + '">' +
      '<div class="user-main">' +
        '<img class="u-avatar" src="' + escapeAttr(u.photoURL || DEFAULT_AVATAR) + '" alt="Avatar">' +
        '<div class="u-info">' +
          '<div class="u-name">' +
            escapeHtml(u.displayName || "Người dùng") +
            statusTag +
          "</div>" +
          '<div class="u-email">' + escapeHtml(u.email || "(không có email)") + "</div>" +
          '<div class="u-meta">Tạo lúc: ' + escapeHtml(formatTime(u.createdAt)) +
            " · UID: " + escapeHtml(u.id.slice(0, 10)) + "…" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="u-controls">' +
        '<div class="ctrl">' +
          "<label>Vai trò</label>" +
          '<select data-action="role">' + roleOptions + "</select>" +
        "</div>" +
        '<div class="ctrl">' +
          "<label>Cơ sở</label>" +
          '<select data-action="coso">' + cosoOptions + "</select>" +
        "</div>" +
        approveBtn +
        rejectBtn +
        '<button type="button" class="delete-btn" data-action="delete"' +
          (isSelf ? " disabled title=\"Không thể tự xoá\"" : "") +
          '><i class="fa-solid fa-trash-can"></i> Xoá</button>' +
      "</div>" +
    "</div>"
  );
}

function renderStats() {
  const pending = allUsers.filter((u) => statusOf(u) === "pending").length;
  const approved = allUsers.filter((u) => statusOf(u) === "approved").length;
  const admins = allUsers.filter((u) => u.role === "admin").length;

  document.getElementById("statTotal").textContent = allUsers.length;
  document.getElementById("statPending").textContent = pending;
  document.getElementById("statApproved").textContent = approved;
  document.getElementById("statAdmin").textContent = admins;
}

/* ---------- Lưu / xoá ---------- */
async function saveUser(uid, patch, successText) {
  const user = allUsers.find((u) => u.id === uid);
  if (!user) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      ...patch,
      updatedAt: serverTimestamp()
    });

    Object.assign(user, patch);
    allUsers.sort((a, b) => {
      const pa = statusPriority(a);
      const pb = statusPriority(b);
      if (pa !== pb) return pa - pb;
      return timeOf(b.createdAt) - timeOf(a.createdAt);
    });

    render();
    showToast(successText + ": " + (user.displayName || user.email || uid));
  } catch (e) {
    console.error(e);
    showToast("Lưu thất bại: " + (e.message || e), true);
    render();
  }
}

async function removeUser(uid) {
  const user = allUsers.find((u) => u.id === uid);
  try {
    await deleteDoc(doc(db, "users", uid));
    allUsers = allUsers.filter((u) => u.id !== uid);
    render();
    showToast("Đã xoá hồ sơ: " + (user?.displayName || user?.email || uid));
  } catch (e) {
    console.error(e);
    showToast("Xoá thất bại: " + (e.message || e), true);
  }
}

/* ---------- Tiện ích ---------- */
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

let toastTimer = null;
function showToast(text, isError) {
  toastEl.textContent = text;
  toastEl.className = "toast show" + (isError ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3200);
}
