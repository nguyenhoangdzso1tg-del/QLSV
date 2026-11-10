/* =========================================================
   APP AUTH — kiểm tra đăng nhập / quyền / hồ sơ người dùng
   Dùng chung cho mọi trang sau khi đăng nhập Google.
   ========================================================= */
import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

export const ROLE_LABEL = {
  admin: "Admin",
  manager: "Quản lí",
  user: "Người dùng"
};

export const DEFAULT_AVATAR =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
      '<circle cx="64" cy="64" r="64" fill="#cbd5e1"/>' +
      '<circle cx="64" cy="50" r="23" fill="#f8fafc"/>' +
      '<path d="M20 113c5-24 23-37 44-37s39 13 44 37" fill="#f8fafc"/>' +
    "</svg>"
  );

const CACHE_KEY = "vp_profile";

/* ---------- Theme ---------- */
export function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("theme", t);
  } catch (e) {}
}

export function getTheme() {
  try {
    return localStorage.getItem("theme") === "dark" ? "dark" : "light";
  } catch (e) {
    return "light";
  }
}

/* ---------- Cache hồ sơ (để hiện avatar/nút nhanh) ---------- */
export function getCachedProfile() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  } catch (e) {
    return null;
  }
}

export function cacheProfile(profile) {
  try {
    if (profile) localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(CACHE_KEY);
  } catch (e) {}
}

/* ---------- Quyền ---------- */
export function canManage(profile) {
  return !!profile && (profile.role === "admin" || profile.role === "manager");
}

export function isAdmin(profile) {
  return !!profile && profile.role === "admin";
}

/* ---------- Đọc / tạo hồ sơ users/{uid} ---------- */
export async function loadProfile(user, options = {}) {
  const create = options.create !== false;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    return { id: user.uid, ...snap.data() };
  }

  if (!create) return null;

  const data = {
    email: user.email || "",
    displayName:
      user.displayName ||
      (user.email ? user.email.split("@")[0] : "Người dùng"),
    photoURL: user.photoURL || "",
    role: "user",
    approved: false,
    rejected: false,
    coso: "",
    theme: getTheme(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(ref, data);

  // Đọc lại để lấy serverTimestamp đã ghi
  const again = await getDoc(ref);
  return { id: user.uid, ...(again.exists() ? again.data() : data) };
}

/* ---------- Chờ Firebase Auth khởi tạo (1 lần / trang) ---------- */
let authPromise = null;

export function getAuthData() {
  if (!authPromise) {
    authPromise = new Promise((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(
        auth,
        async (user) => {
          unsubscribe();
          try {
            if (!user) {
              resolve({ user: null, profile: null });
              return;
            }
            const profile = await loadProfile(user);
            cacheProfile(profile);
            if (profile && profile.theme) applyTheme(profile.theme);
            resolve({ user, profile });
          } catch (e) {
            reject(e);
          }
        },
        (err) => reject(err)
      );
    });
  }
  return authPromise;
}

/* ---------- Ghi thông tin cơ bản vào localStorage cho code cũ ---------- */
export function applyProfileToStorage(profile, user) {
  const name =
    (profile && profile.displayName) ||
    (user && user.displayName) ||
    (profile && profile.email) ||
    "Người dùng";
  try {
    localStorage.setItem("nguoiNhap", name);
    localStorage.setItem("coso", (profile && profile.coso) || "");
    localStorage.setItem("role", (profile && profile.role) || "user");
  } catch (e) {}
}

/* ---------- Màn hình chặn (không đủ quyền / chưa gán cơ sở) ---------- */
function showBlocking(message, options = {}) {
  document.documentElement.setAttribute("data-theme", getTheme());

  let box = document.getElementById("authBlockingOverlay");
  if (!box) {
    box = document.createElement("div");
    box.id = "authBlockingOverlay";
    box.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;" +
      "background:rgba(15,23,42,.65);backdrop-filter:blur(4px);font-family:system-ui,Segoe UI,Roboto,sans-serif;";
    document.body.appendChild(box);
  }

  const dark = getTheme() === "dark";
  const cardBg = dark ? "#1e293b" : "#fff";
  const cardFg = dark ? "#e2e8f0" : "#1e293b";
  const textFg = dark ? "#94a3b8" : "#475569";
  const btnBg = dark ? "#334155" : "#f8fafc";
  const btnFg = dark ? "#e2e8f0" : "#334155";
  const btnBorder = dark ? "#475569" : "#cbd5e1";

  box.innerHTML =
    '<div style="max-width:420px;width:100%;background:' + cardBg + ";color:" + cardFg + ';border-radius:16px;padding:26px 22px;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center;">' +
    '<div style="font-size:42px;margin-bottom:10px;">🔒</div>' +
    '<h2 style="margin:0 0 10px;font-size:19px;">Không thể truy cập</h2>' +
    '<p style="margin:0 0 18px;color:' + textFg + ';font-size:14px;line-height:1.55;">' +
    message +
    "</p>" +
    '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
    (options.showProfile !== false
      ? '<a href="profile.html" style="padding:10px 16px;border-radius:9px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Hồ sơ</a>'
      : "") +
    '<button id="authBlockingLogout" style="padding:10px 16px;border-radius:9px;border:1px solid ' + btnBorder + ";background:" + btnBg + ";color:" + btnFg + ';font-weight:600;font-size:14px;cursor:pointer;">Đăng xuất</button>' +
    "</div></div>";

  const btn = document.getElementById("authBlockingLogout");
  if (btn) btn.onclick = () => logout();
}

/* ---------- Guard chính ---------- */
/**
 * requireApproved({
 *   requireCoso: true,
 *   requireRole: ["admin","manager"],
 *   redirect: "login.html"
 * })
 * Trả về profile nếu hợp lệ, null nếu đã chuyển trang / bị chặn.
 */
export async function requireApproved(options = {}) {
  const {
    requireCoso = true,
    requireRole = null,
    redirect = "login.html"
  } = options;

  let data;
  try {
    data = await getAuthData();
  } catch (e) {
    console.error("Lỗi kiểm tra đăng nhập:", e);
    showBlocking("Không kiểm tra được trạng thái đăng nhập. Kiểm tra mạng rồi tải lại trang.");
    return null;
  }

  if (!data.user) {
    const next = encodeURIComponent(
      location.pathname.split("/").pop() + location.search
    );
    location.replace(redirect + "?next=" + next);
    return null;
  }

  const profile = data.profile;

  if (!profile) {
    showBlocking("Không tìm thấy hồ sơ người dùng. Hãy đăng nhập lại.");
    return null;
  }

  if (profile.rejected === true) {
    showBlocking("Tài khoản của bạn đã bị từ chối. Liên hệ admin để được mở lại.");
    return null;
  }

  if (profile.approved !== true) {
    showBlocking(
      "Tài khoản đang chờ admin duyệt. Vui lòng quay lại sau khi được duyệt.",
      { showProfile: false }
    );
    return null;
  }

  if (requireRole && !requireRole.includes(profile.role)) {
    showBlocking(
      "Bạn không có quyền truy cập trang này. Trang này chỉ dành cho " +
        requireRole.map((r) => ROLE_LABEL[r] || r).join(" / ") +
        "."
    );
    return null;
  }

  if (requireCoso && !profile.coso) {
    showBlocking(
      "Tài khoản đã được duyệt nhưng <b>chưa được gán cơ sở</b>. Vui lòng liên hệ admin để chọn cơ sở (Chu Văn An / Mạc Cửu)."
    );
    return null;
  }

  applyProfileToStorage(profile, data.user);
  applyTheme(profile.theme || getTheme());

  window.currentUser = data.user;
  window.currentProfile = profile;

  return profile;
}

/* ---------- Cập nhật giao diện theo hồ sơ ---------- */
export function applyProfileUI(profile) {
  if (!profile) profile = getCachedProfile();
  if (!profile) return;

  document.querySelectorAll("[data-profile-name]").forEach((el) => {
    el.textContent = profile.displayName || profile.email || "Người dùng";
  });

  document.querySelectorAll("[data-profile-avatar]").forEach((el) => {
    if (el.tagName === "IMG") {
      el.src = profile.photoURL || DEFAULT_AVATAR;
      el.alt = profile.displayName || "Avatar";
    }
  });

  document.querySelectorAll("[data-profile-role]").forEach((el) => {
    el.textContent = ROLE_LABEL[profile.role] || profile.role || "Người dùng";
  });

  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.style.display = isAdmin(profile) ? "" : "none";
  });

  document.querySelectorAll("[data-manager-only]").forEach((el) => {
    el.style.display = canManage(profile) ? "" : "none";
  });

  document
    .querySelectorAll("[data-manager-disabled]")
    .forEach((el) => {
      el.disabled = !canManage(profile);
      el.style.opacity = canManage(profile) ? "" : ".45";
    });
}

/* ---------- Đăng xuất ---------- */
export async function logout() {
  try {
    await signOut(auth);
  } catch (e) {
    console.error(e);
  }
  try {
    localStorage.removeItem("nguoiNhap");
    localStorage.removeItem("coso");
    localStorage.removeItem("role");
    localStorage.removeItem("vp_admin");
    localStorage.removeItem("vp_profile");
    localStorage.removeItem("violationList");
    localStorage.removeItem("diemDanhList");
  } catch (e) {}
  window.location.replace("login.html");
}
