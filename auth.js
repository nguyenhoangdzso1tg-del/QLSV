/* =========================================================
   ĐĂNG NHẬP GOOGLE + CHỜ ADMIN DUYỆT
   ========================================================= */
import { auth, googleProvider } from "./firebase.js";
import {
  signInWithPopup,
  signInWithRedirect,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  loadProfile,
  applyTheme,
  getTheme,
  DEFAULT_AVATAR
} from "./app-auth.js";

const googleBtn = document.getElementById("googleBtn");
const loginView = document.getElementById("loginView");
const pendingView = document.getElementById("pendingView");
const pendingAvatar = document.getElementById("pendingAvatar");
const pendingName = document.getElementById("pendingName");
const pendingEmail = document.getElementById("pendingEmail");
const pendingStatus = document.getElementById("pendingStatus");
const pendingMsg = document.getElementById("pendingMsg");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");
const msg = document.getElementById("msg");
const themeToggle = document.getElementById("themeToggle");

/* ---------- Trang sẽ quay lại sau khi đăng nhập ---------- */
function safeNext() {
  const raw = new URLSearchParams(location.search).get("next") || "";
  const file = raw.split("?")[0];
  // Chỉ cho phép file .html trong cùng thư mục, tránh chuyển hướng ra ngoài
  if (/^[a-zA-Z0-9._-]+\.html$/.test(file) && !file.startsWith(".")) {
    return raw;
  }
  return "index.html";
}

/* ---------- Thông báo ---------- */
function setMsg(text, type) {
  msg.className = "msg" + (type ? " " + type : "");
  msg.innerHTML = text || "";
}

/* ---------- Hiện giao diện ---------- */
function showLogin() {
  loginView.classList.remove("hidden");
  pendingView.classList.add("hidden");
  setMsg("");
}

function showPending(profile) {
  loginView.classList.add("hidden");
  pendingView.classList.remove("hidden");
  setMsg("");

  pendingAvatar.src = profile.photoURL || DEFAULT_AVATAR;
  pendingName.textContent = profile.displayName || "Người dùng";
  pendingEmail.textContent = profile.email || "";

  const rejected = profile.rejected === true;
  pendingStatus.className = "status-pill " + (rejected ? "rejected" : "pending");
  pendingStatus.innerHTML = rejected
    ? '<i class="fa-solid fa-circle-xmark"></i> Tài khoản bị từ chối'
    : '<i class="fa-solid fa-hourglass-half"></i> Chờ admin duyệt';

  pendingMsg.innerHTML = rejected
    ? "Tài khoản của bạn đã bị từ chối. Vui lòng liên hệ admin để được mở lại."
    : "Bạn đã đăng nhập thành công. Vui lòng chờ admin duyệt tài khoản và gán cơ sở.<br>Nhấn <b>Kiểm tra lại</b> sau khi admin đã duyệt.";
}

/* ---------- Điều hướng theo trạng thái ---------- */
let routing = false;
let lastUser = null;

async function routeUser(user, forceRefresh) {
  if (routing) return;
  routing = true;

  try {
    if (!user) {
      lastUser = null;
      showLogin();
      return;
    }

    lastUser = user;
    const profile = await loadProfile(user, { create: true });

    if (profile && profile.approved === true && profile.rejected !== true) {
      localStorage.setItem("vp_profile", JSON.stringify(profile));
      if (profile.theme) applyTheme(profile.theme);
      window.location.replace(safeNext());
      return;
    }

    showPending(profile || {});
  } catch (e) {
    console.error(e);
    setMsg(
      "Không đọc được hồ sơ người dùng. Kiểm tra kết nối mạng và quyền Firestore.<br><code>" +
        (e.message || e) +
        "</code>",
      "error"
    );
  } finally {
    routing = false;
  }
}

/* ---------- Đăng nhập Google ---------- */
googleBtn.addEventListener("click", async () => {
  setMsg("");
  googleBtn.disabled = true;
  const old = googleBtn.innerHTML;
  googleBtn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Đang mở Google...';

  try {
    const result = await signInWithPopup(auth, googleProvider);
    await routeUser(result.user, true);
  } catch (e) {
    console.error(e);
    const code = e && e.code ? e.code : "";

    if (
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      try {
        await signInWithRedirect(auth, googleProvider);
        return;
      } catch (e2) {
        console.error(e2);
      }
    }

    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      setMsg("Bạn đã đóng cửa sổ đăng nhập Google.", "error");
    } else if (code === "auth/unauthorized-domain") {
      setMsg(
        "Tên miền chưa được Firebase cho phép. Vào Firebase Console → Authentication → Settings → Authorized domains để thêm tên miền này.",
        "error"
      );
    } else if (code === "auth/operation-not-allowed") {
      setMsg(
        "Chưa bật đăng nhập Google. Vào Firebase Console → Authentication → Sign-in method → bật Google.",
        "error"
      );
    } else {
      setMsg("Đăng nhập thất bại: " + (e.message || code || e), "error");
    }
  } finally {
    googleBtn.disabled = false;
    googleBtn.innerHTML = old;
  }
});

/* ---------- Kiểm tra lại trạng thái duyệt ---------- */
refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  const old = refreshBtn.innerHTML;
  refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra...';
  try {
    const user = auth.currentUser;
    if (!user) {
      showLogin();
      return;
    }
    routing = false; // cho phép chạy lại
    await routeUser(user, true);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = old;
  }
});

/* ---------- Đăng xuất ---------- */
logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (e) {
    console.error(e);
  }
  localStorage.removeItem("vp_profile");
  showLogin();
});

/* ---------- Theo dõi trạng thái đăng nhập ---------- */
onAuthStateChanged(auth, (user) => {
  routeUser(user);
});

/* ---------- Sáng / tối ---------- */
function renderThemeIcon() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  themeToggle.innerHTML = dark
    ? '<i class="fa-solid fa-sun"></i>'
    : '<i class="fa-solid fa-moon"></i>';
}

themeToggle.addEventListener("click", () => {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  applyTheme(dark ? "light" : "dark");
  renderThemeIcon();
});

applyTheme(getTheme());
renderThemeIcon();
