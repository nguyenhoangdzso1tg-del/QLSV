/* =========================================================
   HỒ SƠ CÁ NHÂN — avatar, tên, giao diện, đăng xuất
   ========================================================= */
import { auth, db } from "./firebase.js";
import {
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  requireApproved,
  applyTheme,
  getTheme,
  cacheProfile,
  applyProfileToStorage,
  applyProfileUI,
  isAdmin,
  logout,
  ROLE_LABEL,
  DEFAULT_AVATAR
} from "./app-auth.js";

const profile = await requireApproved({ requireCoso: false });
if (!profile) {
  // requireApproved đã chuyển trang / hiện thông báo
} else {
  init(profile);
}

function init(profile) {
  const user = window.currentUser || auth.currentUser;

  const avatarImg = document.getElementById("avatarImg");
  const avatarInput = document.getElementById("avatarInput");
  const changeAvatarBtn = document.getElementById("changeAvatarBtn");
  const removeAvatarBtn = document.getElementById("removeAvatarBtn");
  const profileName = document.getElementById("profileName");
  const profileEmail = document.getElementById("profileEmail");
  const roleBadge = document.getElementById("roleBadge");
  const displayNameInput = document.getElementById("displayName");
  const cosoInput = document.getElementById("coso");
  const saveBtn = document.getElementById("saveBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const msg = document.getElementById("msg");
  const adminBox = document.getElementById("adminBox");
  const adminLink = document.getElementById("adminLink");

  let current = { ...profile };
  let pendingAvatar = current.photoURL || "";
  let selectedTheme = current.theme || getTheme();

  /* ---------- Hiển thị ---------- */
  function render() {
    avatarImg.src = pendingAvatar || DEFAULT_AVATAR;
    profileName.textContent = displayNameInput.value.trim() || current.displayName || "Người dùng";
    profileEmail.textContent = current.email || (user && user.email) || "";
    displayNameInput.value = current.displayName || (user && user.displayName) || "";
    cosoInput.value = current.coso || "Chưa được gán cơ sở";

    const role = current.role || "user";
    roleBadge.className = "badge role " + role;
    roleBadge.innerHTML =
      '<i class="fa-solid ' +
      (role === "admin"
        ? "fa-user-shield"
        : role === "manager"
        ? "fa-user-tie"
        : "fa-user") +
      '"></i> ' +
      (ROLE_LABEL[role] || role);

    if (isAdmin(current)) {
      adminBox.style.display = "";
      adminLink.style.display = "";
    } else {
      adminBox.style.display = "none";
      adminLink.style.display = "none";
    }

    renderThemeButtons();
    applyProfileUI(current);
  }

  function renderThemeButtons() {
    document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.themeChoice === selectedTheme
      );
    });
  }

  function setMsg(text, ok) {
    msg.className = "msg " + (ok ? "ok" : "err");
    msg.innerHTML = text || "";
  }

  /* ---------- Chọn giao diện ---------- */
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedTheme = btn.dataset.themeChoice === "dark" ? "dark" : "light";
      applyTheme(selectedTheme);
      renderThemeButtons();
      setMsg(
        "Đã đổi sang giao diện " +
          (selectedTheme === "dark" ? "tối" : "sáng") +
          ". Nhấn <b>Lưu thay đổi</b> để lưu vào tài khoản.",
        true
      );
    });
  });

  /* ---------- Đổi avatar ---------- */
  changeAvatarBtn.addEventListener("click", () => avatarInput.click());

  avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files && avatarInput.files[0];
    avatarInput.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMsg("Vui lòng chọn file ảnh (jpg, png, webp...).", false);
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setMsg("Ảnh quá lớn (tối đa 12MB). Vui lòng chọn ảnh nhỏ hơn.", false);
      return;
    }

    try {
      setMsg("Đang xử lý ảnh...", true);
      pendingAvatar = await fileToAvatarDataURL(file);
      render();
      setMsg("Đã chọn ảnh mới. Nhấn <b>Lưu thay đổi</b> để cập nhật.", true);
    } catch (e) {
      console.error(e);
      setMsg("Không đọc được ảnh: " + (e.message || e), false);
    }
  });

  removeAvatarBtn.addEventListener("click", () => {
    pendingAvatar = "";
    render();
    setMsg("Đã xoá ảnh đại diện. Nhấn <b>Lưu thay đổi</b> để cập nhật.", true);
  });

  /* ---------- Tên hiển thị ---------- */
  displayNameInput.addEventListener("input", () => {
    profileName.textContent = displayNameInput.value.trim() || "Người dùng";
  });

  /* ---------- Lưu ---------- */
  saveBtn.addEventListener("click", async () => {
    if (!user) {
      setMsg("Phiên đăng nhập đã hết. Hãy đăng nhập lại.", false);
      return;
    }

    const name = displayNameInput.value.trim();
    if (!name) {
      setMsg("Tên hiển thị không được để trống.", false);
      displayNameInput.focus();
      return;
    }

    saveBtn.disabled = true;
    const old = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

    try {
      await updateDoc(doc(db, "users", user.uid), {
        displayName: name,
        photoURL: pendingAvatar || "",
        theme: selectedTheme,
        updatedAt: serverTimestamp()
      });

      // Đồng bộ tên lên Firebase Auth (nếu được)
      try {
        if (user.displayName !== name) {
          await updateProfile(user, { displayName: name });
        }
      } catch (e) {
        console.warn("Không cập nhật được tên Firebase Auth:", e);
      }

      current = {
        ...current,
        displayName: name,
        photoURL: pendingAvatar || "",
        theme: selectedTheme
      };

      cacheProfile(current);
      applyProfileToStorage(current, user);
      applyTheme(selectedTheme);
      applyProfileUI(current);

      setMsg("Đã lưu hồ sơ thành công.", true);
    } catch (e) {
      console.error(e);
      setMsg("Lưu thất bại: " + (e.message || e), false);
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = old;
    }
  });

  /* ---------- Đăng xuất ---------- */
  logoutBtn.addEventListener("click", async () => {
    if (!confirm("Đăng xuất khỏi tài khoản này?")) return;
    await logout();
  });

  render();
}

/* ---------- Nén ảnh thành avatar vuông 256px ---------- */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Không đọc được file ảnh"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("File ảnh không hợp lệ"));
    img.src = src;
  });
}

async function fileToAvatarDataURL(file) {
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  const SIZE = 256;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, 0, SIZE, SIZE);

  const scale = Math.max(SIZE / img.width, SIZE / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);

  return canvas.toDataURL("image/jpeg", 0.86);
}
