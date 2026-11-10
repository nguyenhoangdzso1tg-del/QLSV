/* =========================================================
   TRỢ LÝ ĐIỂM DANH — chat nổi (ChatGPT-like)
   - Hiểu câu điểm danh tự nhiên (p, k, cp, kp, kv, vắng…)
   - Hiểu lệnh điều hướng / đổi buổi / đổi ngày / hỏi nhanh
   - Có bước duyệt trước khi áp dụng vào lớp
   - Tùy chọn Gemini API key (lưu trên máy) để hiểu câu phức tạp
   ========================================================= */
import {
  AI_STATUS_LABEL,
  detectClasses,
  buildRows,
  stripClass
} from "./diemdanh-ai.js";

const $ = id => document.getElementById(id);

const CFG_KEY = "dd_ai_key";
const CFG_MODEL = "dd_ai_model";

const STATUS_SHORT = {
  khong_vang: "Không vắng",
  vang_co_phep: "Vắng có phép",
  vang_khong_phep: "Vắng không phép"
};

let ctx = null;
let el = {};
let cfg = { key: "", model: "gemini-2.0-flash" };
let busy = false;
let awaitingText = "";       // câu điểm danh đang chờ chọn lớp
let chatHistory = [];        // lịch sử ngắn cho Gemini

/* ---------- Tiện ích ---------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function norm(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buoiText(v) {
  return v === "chieu" ? "chiều" : "sáng";
}

function shiftDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- Khởi tạo ---------- */
export function initAttendanceChat(controller) {
  ctx = controller;

  el = {
    fab: $("chatFab"),
    panel: $("chatPanel"),
    msgs: $("chatMsgs"),
    chips: $("chatChips"),
    form: $("chatForm"),
    input: $("chatInput"),
    send: $("chatSend"),
    status: $("chatStatus"),
    foot: $("chatFoot"),
    settings: $("chatSettings"),
    settingsBtn: $("chatSettingsBtn"),
    closeBtn: $("chatCloseBtn"),
    clearBtn: $("chatClearBtn"),
    keyInput: $("chatApiKey"),
    model: $("chatModel"),
    saveKey: $("chatSaveKey"),
    removeKey: $("chatRemoveKey"),
    cancelSettings: $("chatCancelSettings")
  };

  if (!el.panel) return;

  loadCfg();
  bind();
  updateStatusBadge();
  refreshChips();
  greet();

  if (el.fab) el.fab.classList.remove("hidden");
}

function loadCfg() {
  cfg.key = localStorage.getItem(CFG_KEY) || "";
  cfg.model = localStorage.getItem(CFG_MODEL) || "gemini-2.0-flash";
}

function saveCfg() {
  if (cfg.key) localStorage.setItem(CFG_KEY, cfg.key);
  else localStorage.removeItem(CFG_KEY);
  localStorage.setItem(CFG_MODEL, cfg.model);
}

function updateStatusBadge() {
  if (!el.status) return;
  if (cfg.key) {
    el.status.textContent = `Gemini · ${cfg.model}`;
    el.status.style.color = "#bbf7d0";
  } else {
    el.status.textContent = "Ngoại tuyến · hiểu lệnh cơ bản";
    el.status.style.color = "";
  }
  if (el.foot) {
    el.foot.textContent = cfg.key
      ? "Gemini đang bật · câu trả lời do AI tạo, luôn kiểm tra bảng duyệt"
      : "Trợ lý chạy trên máy · bật Gemini trong ⚙ để hiểu câu phức tạp hơn";
  }
}

/* ---------- Giao diện chat ---------- */
function bind() {
  el.fab?.addEventListener("click", openPanel);
  el.closeBtn?.addEventListener("click", closePanel);

  el.form?.addEventListener("submit", e => {
    e.preventDefault();
    send(el.input.value);
  });

  el.input?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.form.requestSubmit();
    }
  });

  el.input?.addEventListener("input", autoGrow);

  el.clearBtn?.addEventListener("click", () => {
    el.msgs.innerHTML = "";
    chatHistory = [];
    awaitingText = "";
    refreshChips();
    greet();
  });

  el.settingsBtn?.addEventListener("click", () => {
    el.keyInput.value = cfg.key;
    el.model.value = cfg.model;
    el.settings.classList.remove("hidden");
    setTimeout(() => el.keyInput.focus(), 50);
  });

  const closeSettings = () => el.settings.classList.add("hidden");

  el.cancelSettings?.addEventListener("click", closeSettings);

  el.saveKey?.addEventListener("click", () => {
    cfg.key = el.keyInput.value.trim();
    cfg.model = el.model.value || "gemini-2.0-flash";
    saveCfg();
    updateStatusBadge();
    closeSettings();
    bot(
      cfg.key
        ? "Đã bật Gemini. Từ giờ mình hiểu câu hỏi tự nhiên tốt hơn. Bảng duyệt điểm danh vẫn luôn hiện để bạn kiểm tra."
        : "Chưa nhập khóa — trợ lý sẽ chạy ở chế độ ngoại tuyến."
    );
  });

  el.removeKey?.addEventListener("click", () => {
    cfg.key = "";
    saveCfg();
    el.keyInput.value = "";
    updateStatusBadge();
    closeSettings();
    bot("Đã xoá khóa Gemini khỏi trình duyệt này. Trợ lý chuyển về chế độ ngoại tuyến.");
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !el.panel.classList.contains("hidden")) {
      el.settings.classList.add("hidden");
    }
  });
}

function openPanel() {
  el.panel.classList.remove("hidden");
  setTimeout(() => {
    el.input.focus();
    scrollBottom();
  }, 80);
}

function closePanel() {
  el.panel.classList.add("hidden");
}

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 110) + "px";
}

function scrollBottom() {
  if (el.msgs) el.msgs.scrollTop = el.msgs.scrollHeight;
}

function addMsg(role, html) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.innerHTML = html;
  el.msgs.appendChild(div);
  scrollBottom();
  return div;
}

function bot(html) {
  return addMsg("bot", html);
}

function sys(text) {
  return addMsg("sys", esc(text));
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "chat-msg bot";
  div.innerHTML =
    '<span class="chat-typing"><span></span><span></span><span></span></span>';
  el.msgs.appendChild(div);
  scrollBottom();
  return div;
}

function refreshChips() {
  if (!el.chips) return;
  const b = ctx.getBuoi();
  const chips = [
    { label: "Ai vắng?", send: "Ai vắng?" },
    { label: "Tổng kết", send: "Tổng kết lớp này" },
    {
      label: b === "sang" ? "Chuyển chiều" : "Chuyển sáng",
      send: b === "sang" ? "Buổi chiều" : "Buổi sáng"
    },
    { label: "Thêm vào danh sách", action: "add" },
    { label: "Giúp tôi", send: "Bạn làm được gì?" }
  ];

  el.chips.innerHTML = chips.map(c =>
    `<button type="button" class="chat-chip" data-send="${esc(c.send || "")}" data-action="${esc(c.action || "")}">${esc(c.label)}</button>`
  ).join("");

  el.chips.querySelectorAll(".chat-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const action = chip.dataset.action;
      if (action === "add") {
        doAddToList();
      } else {
        send(chip.dataset.send || chip.textContent);
      }
    });
  });
}

function greet() {
  const p = ctx.getProfile();
  const name = p?.displayName ? p.displayName.split(" ").slice(-2).join(" ") : "bạn";
  const v = ctx.getView();
  const cls = ctx.getCurrentClass();

  let intro =
    `Chào <b>${esc(name)}</b>! Mình là trợ lý điểm danh.\n` +
    `Bạn có thể nhắn như: “Gia Huy p, Quang Huy k”, “buổi chiều”, “ai vắng?”, “mở lớp THUD2”, “về khoa”.`;

  if (cls && v.level === "sv") {
    intro += `\n\nĐang mở lớp <b>${esc(cls.lop)}</b> · buổi <b>${ctx.getBuoiLabel()}</b>.`;
  }
  bot(intro);
}

function setBusy(v) {
  busy = v;
  if (el.send) el.send.disabled = v;
}

/* ---------- Gửi tin nhắn ---------- */
async function send(raw) {
  const text = String(raw || "").trim();
  if (!text || busy) return;

  addMsg("user", esc(text));
  el.input.value = "";
  autoGrow();
  setBusy(true);

  chatHistory.push({ role: "user", text });
  chatHistory = chatHistory.slice(-10);

  const typing = showTyping();

  try {
    const handled = await handleLocal(text);

    if (!handled) {
      if (cfg.key) {
        try {
          const parsed = await askGemini(text);
          if (parsed) {
            if (!parsed.action && parsed.reply) {
              bot(esc(parsed.reply));
            } else if (parsed.action) {
              await runAction(parsed.action);
            } else {
              bot("Mình chưa rõ ý. Bạn nói lại ngắn gọn hơn giúp mình nhé.");
            }
          } else {
            bot(unknownReply());
          }
        } catch (err) {
          console.warn("Gemini error:", err);
          bot(
            "Không kết nối được Gemini (" +
            esc(err.message || err) +
            "). Mình chuyển sang chế độ ngoại tuyến — bạn thử câu đơn giản hơn nhé."
          );
          bot(unknownReply());
        }
      } else {
        bot(unknownReply());
      }
    }
  } catch (err) {
    console.error(err);
    bot("Mình gặp lỗi khi xử lý câu này. Bạn thử lại giúp mình nhé.");
  } finally {
    typing.remove();
    setBusy(false);
    scrollBottom();
    el.input.focus();
  }
}

/* ---------- Bộ não ngoại tuyến ---------- */
async function handleLocal(text) {
  const n = norm(text);

  if (/^(chao|hello|hi|xin chao|alo)\b/.test(n)) {
    greet();
    return true;
  }

  if (/(cam on|thank|thanks)/.test(n)) {
    bot("Không có gì đâu! Cần điểm danh cứ gọi mình.");
    return true;
  }

  // Đang chờ chọn lớp → người dùng gõ tên lớp
  if (awaitingText && !looksLikeCommand(n) && !hasStatus(n)) {
    const matches = ctx.findClasses(text);
    if (matches.length === 1) {
      const cls = matches[0];
      const retry = awaitingText;
      await ctx.openClass(cls);
      awaitingText = "";
      bot(`Đã mở lớp <b>${esc(cls.lop)}</b> (${cls.count || 0} SV) · buổi ${ctx.getBuoiLabel()}.`);
      if (retry) await parseAttendance(retry, cls);
      refreshChips();
      return true;
    }
    if (matches.length > 1) {
      askClass(`Có ${matches.length} lớp khớp. Chọn lớp bên dưới:`, matches, awaitingText);
      return true;
    }
  }

  // Đổi buổi / ngày trong câu
  const c = extractContext(text);
  const n2 = norm(c.text);

  // Trợ giúp
  if (/(giup|huong dan|lam duoc gi|chuc nang|cach dung|help|ban lam gi)/.test(n2)) {
    sendHelp();
    return true;
  }

  // Hỏi nhanh trước khi tới phần điểm danh
  if (/(ai|con ai|nhung ai|ban nao).*\b(vang|nghi)\b/.test(n2) || n2 === "vang" || /danh sach vang/.test(n2)) {
    await listAbsent();
    return true;
  }

  if (/(bao nhieu).*(sinh vien|sv|hoc sinh)|si so/.test(n2)) {
    classSize();
    return true;
  }

  if (/(tong ket|thong ke|tom tat|bao nhieu vang)/.test(n2)) {
    summaryNow();
    return true;
  }

  if (/(danh sach cho|cho gui|da them|danh sach tam)/.test(n2)) {
    pendingInfo();
    return true;
  }

  // Điều hướng
  if (/^(trang chu|ve trang chu|mo trang chu)$/.test(n2)) {
    bot("Đang mở Trang chủ…");
    setTimeout(() => { window.location.href = "index.html"; }, 350);
    return true;
  }

  if (/(mo|den|vao|xem)\s+(danh sach\s+)?diem danh/.test(n2) ||
      /^(danh sach diem danh)$/.test(n2)) {
    bot("Đang mở Danh sách điểm danh…");
    setTimeout(() => { window.location.href = "danhsach-diemdanh.html"; }, 350);
    return true;
  }

  if (/(mo|den|vao|xem)\s+(danh sach\s+)?vi pham/.test(n2) ||
      /^(danh sach vi pham)$/.test(n2)) {
    bot("Đang mở Danh sách vi phạm…");
    setTimeout(() => { window.location.href = "danhsach.html"; }, 350);
    return true;
  }

  if (/^(ho so|profile|tai khoan)$/.test(n2) || /(mo|vao)\s+ho so/.test(n2)) {
    bot("Đang mở Hồ sơ…");
    setTimeout(() => { window.location.href = "profile.html"; }, 350);
    return true;
  }

  if (/(ve|quay lai|chon|mo)\s+khoa\b/.test(n2) && !/khoa hoc/.test(n2)) {
    ctx.goKhoa();
    refreshChips();
    bot("Đã về màn hình <b>Chọn khoa</b>. Bấm Quay lại hoặc nói “về khoa” bất cứ lúc nào.");
    return true;
  }

  if (/^(ve|quay lai|chon|mo)\s+(lop|danh sach lop)$/.test(n2)) {
    ctx.goLop();
    refreshChips();
    bot("Đã về màn hình <b>Chọn lớp</b>.");
    return true;
  }

  if (/(gui diem danh|gui len|gui du lieu|gui di)/.test(n2)) {
    bot("Mình mở hộp thoại xác nhận gửi. Kiểm tra kỹ lớp / ngày / buổi trước khi đồng ý nhé.");
    setTimeout(() => ctx.submit(), 300);
    return true;
  }

  if (/(them vao danh sach|luu danh sach|luu lai|chot danh sach)/.test(n2)) {
    doAddToList();
    return true;
  }

  if (/(tat ca co mat|dat tat ca|reset|bo danh dau|xoa danh dau)/.test(n2)) {
    const count = ctx.allPresent();
    if (!count) {
      bot("Bạn chưa mở lớp nào. Mở lớp trước rồi mình đặt tất cả về “Không vắng” nhé.");
    } else {
      bot(`Đã đặt <b>${count}</b> sinh viên về <b>Không vắng</b>. Bạn chỉ cần đánh dấu bạn vắng.`);
    }
    return true;
  }

  // Chỉ đổi buổi / ngày
  if (c.changed.length) {
    const rest = norm(c.text);
    if (!rest || rest === "nay" || rest === "hom") {
      bot(
        `Đã chọn ${c.changed.join(" · ")}.\n` +
        `Lớp đang xem: <b>${esc(ctx.getSelected().lop || "—")}</b> · ngày ${ctx.fmtDate(ctx.getNgay())} · buổi ${ctx.getBuoiLabel()}.`
      );
      refreshChips();
      return true;
    }
    bot(`Đã chọn ${c.changed.join(" · ")}.`);
  }

  // Điểm danh bằng câu tự nhiên
  if (hasStatus(n2)) {
    return await parseAttendance(c.text || text);
  }

  // Mở lớp theo tên
  if (/(mo|chon|chuyen|vao|sang|den)\s+(lop|class)\b/.test(n2) ||
      n2.startsWith("lop ") || n2.startsWith("class ")) {
    const ok = await tryOpenClass(c.text || text);
    if (ok) return true;
  }

  // Câu hỏi về tính năng app
  const answer = answerFeature(n2);
  if (answer) {
    bot(answer);
    return true;
  }

  return false;
}

function looksLikeCommand(n) {
  return hasStatus(n) ||
    /(ai vang|bao nhieu|tong ket|thong ke|giup|huong dan|trang chu|ho so|danh sach|gui|them vao|tat ca|ve khoa|ve lop|mo lop|chon lop)/.test(n);
}

function hasStatus(n) {
  return /(^|\s)(p|k|kp|kv|cp)(?=\s|$)/.test(n) ||
    /\b(vang khong phep|khong phep|kp|vang co phep|co phep|cp|khong vang|co mat|kv|vang|nghi co phep|nghi khong phep)\b/.test(n);
}

/* ---------- Đổi buổi / ngày ---------- */
function extractContext(text) {
  const n = norm(text);
  const changed = [];
  let body = text;

  let b = "";
  if (/\bbuoi sang\b/.test(n) || /\bsang nay\b/.test(n) || n === "sang" || n === "buoi sang") b = "sang";
  if (/\bbuoi chieu\b/.test(n) || /\bchieu nay\b/.test(n) || n === "chieu" || n === "buoi chieu") b = "chieu";

  if (b) {
    ctx.setBuoi(b);
    changed.push("buổi " + buoiText(b));
    body = body
      .replace(/buổi\s+sáng/gi, " ")
      .replace(/buổi\s+chiều/gi, " ")
      .replace(/sáng\s+nay/gi, " ")
      .replace(/chiều\s+nay/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  let iso = "";
  if (/\bhom qua\b/.test(n)) iso = shiftDate(-1);
  else if (/\bhom kia\b/.test(n)) iso = shiftDate(-2);
  else if (/\bhom nay\b/.test(n)) iso = ctx.todayStr();
  else {
    // Đọc ngày trên câu gốc (còn dấu / - .) để không bị bước bỏ dấu làm mất
    let m = text.match(/\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?\b/);
    if (!m) m = text.match(/\bngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{2,4}))?/i);
    if (!m) m = n.match(/\bngay\s+(\d{1,2})\s+thang\s+(\d{1,2})(?:\s+nam\s+(\d{2,4}))?/);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      let y = m[3] ? Number(m[3]) : new Date().getFullYear();
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
        iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
  }

  if (iso && ctx.setNgay(iso)) {
    changed.push("ngày " + ctx.fmtDate(iso));
    body = body
      .replace(/\b(?:ngày\s+)?\d{1,2}\s*(?:[\/\-.]|tháng)\s*\d{1,2}(?:\s*(?:[\/\-.]|năm)\s*\d{2,4})?\b/gi, " ")
      .replace(/\b(hôm qua|hôm kia|hôm nay)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return { text: body, changed, buoi: b, date: iso };
}

/* ---------- Điểm danh ---------- */
async function parseAttendance(raw, forcedCls) {
  const classes = ctx.allClasses();
  if (!classes.length) {
    bot("Chưa tải được danh sách sinh viên. Bạn kiểm tra kết nối rồi thử lại nhé.");
    return true;
  }

  let cls = forcedCls || null;
  const detected = cls ? [] : detectClasses(raw, classes);

  if (!cls) {
    if (detected.length === 1) {
      cls = detected[0];
    } else if (detected.length > 1) {
      awaitingText = raw;
      return askClass(
        `Câu có ${detected.length} tên lớp. Chọn đúng lớp bên dưới, mình sẽ ghép tên ngay:`,
        detected,
        raw
      );
    } else {
      const v = ctx.getView();
      if (v.level === "sv") {
        cls = ctx.getCurrentClass();
      }
    }
  }

  if (!cls) {
    awaitingText = raw;
    return askClass(
      "Mình chưa biết câu này thuộc lớp nào. Chọn lớp bên dưới (hoặc nói “mở lớp …” trước):",
      null,
      raw
    );
  }

  // Chỉ tải danh sách sinh viên khi thật sự cần ghép tên.
  try {
    await ctx.ensureClassStudents(cls);
  } catch (e) {
    console.error(e);
    bot(`Không tải được danh sách lớp <b>${esc(cls.lop)}</b>. Kiểm tra mạng rồi thử lại nhé.`);
    return true;
  }

  if (!cls.students || !cls.students.length) {
    bot(`Lớp <b>${esc(cls.lop)}</b> chưa có sinh viên trong Firebase.`);
    return true;
  }

  // Bỏ mọi tên lớp khỏi câu để tránh lẫn vào tên người
  let body = raw;
  classes.forEach(x => { body = stripClass(body, x.lop); });

  const rows = buildRows(body, cls);
  if (!rows.length) {
    bot(
      `Mình đã chọn lớp <b>${esc(cls.lop)}</b> nhưng chưa nhận ra tên/trạng thái nào.\n` +
      "Ví dụ: “Gia Huy p, Quang Huy k” (p = vắng có phép, k = vắng không phép, kv = không vắng)."
    );
    return true;
  }

  return renderReview(cls, rows);
}

function renderReview(cls, rows) {
  const students = [...cls.students].sort((a, b) =>
    String(a.tenSV).localeCompare(String(b.tenSV), "vi")
  );

  const trs = rows.map((r, i) => {
    const m = r.match;
    const ok = m.kind === "ok";
    const selectedMa = ok ? m.student.maSV : "";

    let ordered = students;
    if (m.kind === "ambiguous") {
      const ids = new Set(m.candidates.map(x => x.student.maSV));
      ordered = [
        ...m.candidates.map(x => x.student),
        ...students.filter(sv => !ids.has(sv.maSV))
      ];
    }

    const options = ordered.map(sv =>
      `<option value="${esc(sv.maSV)}" ${sv.maSV === selectedMa ? "selected" : ""}>${esc(sv.tenSV)} (${esc(sv.maSV)})</option>`
    ).join("");

    const statusOptions = Object.keys(AI_STATUS_LABEL).map(v =>
      `<option value="${v}" ${v === r.status ? "selected" : ""}>${AI_STATUS_LABEL[v]}</option>`
    ).join("");

    const note = ok
      ? ""
      : m.kind === "ambiguous"
        ? `Có ${m.candidates.length} người khớp — chọn đúng người`
        : `Không tìm thấy “${esc(r.name)}” — chọn tay hoặc bỏ tích`;

    return `<tr class="${ok ? "" : "rev-warn"}">
      <td style="text-align:center"><input type="checkbox" class="rev-check" ${ok ? "checked" : ""}></td>
      <td>
        <select class="rev-student">
          <option value="">— chọn sinh viên —</option>
          ${options}
        </select>
        ${note ? `<div class="rev-note">${note}</div>` : ""}
      </td>
      <td><select class="rev-status">${statusOptions}</select></td>
    </tr>`;
  }).join("");

  const wrap = document.createElement("div");
  wrap.className = "chat-review";
  wrap.innerHTML = `
    <div class="rev-head">
      Lớp <b>${esc(cls.lop)}</b> · ${esc(ctx.fmtDate(ctx.getNgay()))} · buổi <b>${ctx.getBuoiLabel()}</b>
      — kiểm tra rồi áp dụng
    </div>
    <div class="rev-scroll">
      <table>
        <thead>
          <tr>
            <th style="width:34px;text-align:center">✓</th>
            <th>Sinh viên</th>
            <th style="width:128px">Trạng thái</th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
    <div class="rev-actions">
      <button type="button" class="rev-btn primary"><i class="fa-solid fa-check"></i> Áp dụng vào lớp</button>
      <button type="button" class="rev-btn">Huỷ</button>
    </div>`;
  el.msgs.appendChild(wrap);
  scrollBottom();

  wrap.querySelectorAll(".rev-student").forEach(sel => {
    sel.addEventListener("change", () => {
      const tr = sel.closest("tr");
      const cb = tr?.querySelector(".rev-check");
      if (cb) cb.checked = !!sel.value;
      if (tr) tr.classList.toggle("rev-warn", !sel.value);
    });
  });

  const applyBtn = wrap.querySelector(".rev-actions .rev-btn.primary");
  const cancelBtn = wrap.querySelector(".rev-actions .rev-btn:not(.primary)");

  applyBtn.addEventListener("click", async () => {
    const picks = [];
    wrap.querySelectorAll("tbody tr").forEach(tr => {
      const cb = tr.querySelector(".rev-check");
      const sel = tr.querySelector(".rev-student");
      const st = tr.querySelector(".rev-status");
      if (!cb || !cb.checked || !sel || !sel.value || !st) return;
      picks.push({ maSV: sel.value, trangThai: st.value });
    });

    if (!picks.length) {
      bot("Chưa chọn sinh viên nào. Tích ô ✓ và chọn đúng người trước khi áp dụng nhé.");
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = "Đang áp dụng…";

    let applied = 0;
    try {
      applied = await ctx.applyAttendance(cls, picks);
    } catch (e) {
      console.error(e);
      applyBtn.disabled = false;
      applyBtn.textContent = "Áp dụng vào lớp";
      bot("Không áp dụng được. Kiểm tra mạng rồi thử lại nhé.");
      return;
    }

    cancelBtn.disabled = true;
    applyBtn.textContent = "Đã áp dụng";
    applyBtn.style.opacity = ".7";

    bot(
      `Đã áp dụng cho <b>${applied}</b> sinh viên lớp <b>${esc(cls.lop)}</b> · buổi ${ctx.getBuoiLabel()}.\n` +
      "Kiểm tra lại các thẻ sinh viên, rồi bấm <b>Thêm vào danh sách</b> (hoặc nói “thêm vào danh sách”)."
    );
    refreshChips();
  });

  cancelBtn.addEventListener("click", () => {
    wrap.remove();
    bot("Đã huỷ. Bạn có thể sửa câu rồi gửi lại.");
  });

  return true;
}

/* ---------- Chọn lớp ---------- */
function askClass(promptText, classes, retryText) {
  const list = (classes && classes.length ? classes : ctx.allClasses())
    .slice()
    .sort((a, b) => String(a.lop).localeCompare(String(b.lop), "vi"));

  if (!list.length) {
    bot("Chưa có dữ liệu sinh viên để chọn lớp.");
    return true;
  }

  bot(promptText);

  const card = document.createElement("div");
  card.className = "chat-review";
  card.innerHTML = `
    <div class="rev-head">Chọn lớp</div>
    <div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap">
      <select class="rev-pick" style="flex:1;min-width:150px;border:1px solid #cbd5e1;border-radius:8px;padding:7px;font-size:13px">
        ${list.map(c =>
          `<option value="${esc(ctx.classKeyOf(c))}">${esc(c.lop)} · ${esc(c.khoaHoc)} · ${c.count || 0} SV</option>`
        ).join("")}
      </select>
      <button type="button" class="rev-btn primary" style="flex:0 0 auto;padding:8px 12px">Mở lớp</button>
    </div>`;
  el.msgs.appendChild(card);
  scrollBottom();

  card.querySelector(".rev-btn").addEventListener("click", async () => {
    const sel = card.querySelector(".rev-pick");
    const cls = ctx.classByKey(sel.value);
    if (!cls) return;

    await ctx.openClass(cls);
    awaitingText = "";
    card.remove();

    bot(`Đã mở lớp <b>${esc(cls.lop)}</b> (${cls.count || 0} SV) · buổi ${ctx.getBuoiLabel()}.`);
    refreshChips();

    if (retryText) {
      await parseAttendance(retryText, cls);
    }
  });

  return true;
}

async function tryOpenClass(text) {
  const matches = ctx.findClasses(text);

  if (!matches.length) {
    bot(
      `Mình không tìm thấy lớp “${esc(text)}”.\n` +
      "Bạn thử gõ đúng tên lớp (ví dụ “mở lớp THUD2”) hoặc dùng ô tìm lớp ở trang chính nhé."
    );
    return true;
  }

  if (matches.length === 1) {
    const cls = matches[0];
    await ctx.openClass(cls);
    awaitingText = "";
    bot(`Đã mở lớp <b>${esc(cls.lop)}</b> (${cls.count || 0} SV) · ${esc(cls.khoaHoc)} · buổi ${ctx.getBuoiLabel()}.`);
    refreshChips();
    return true;
  }

  return askClass(
    `Có <b>${matches.length}</b> lớp khớp “${esc(text)}”. Chọn lớp bên dưới:`,
    matches,
    ""
  );
}

/* ---------- Hỏi nhanh ---------- */
async function listAbsent() {
  const cls = ctx.getCurrentClass();
  if (!cls) {
    bot("Bạn chưa mở lớp nào. Nói “mở lớp …” hoặc chọn lớp trong app trước nhé.");
    return;
  }

  try {
    await ctx.ensureClassStudents(cls);
  } catch (e) {
    console.error(e);
    bot("Không tải được danh sách lớp. Kiểm tra mạng rồi thử lại nhé.");
    return;
  }

  const map = ctx.getStatusMap();
  const rows = cls.students.filter(sv => {
    const st = map[sv.maSV] || "khong_vang";
    return st !== "khong_vang";
  });

  if (!rows.length) {
    bot(`Lớp <b>${esc(cls.lop)}</b> · buổi ${ctx.getBuoiLabel()} hiện không có bạn nào vắng.`);
    return;
  }

  const lines = rows.map(sv =>
    `• ${esc(sv.tenSV)} — ${STATUS_SHORT[map[sv.maSV]] || "Vắng"}`
  ).join("\n");

  bot(`Lớp <b>${esc(cls.lop)}</b> · buổi ${ctx.getBuoiLabel()}:\n${lines}`);
}

function classSize() {
  const cls = ctx.getCurrentClass();
  if (cls) {
    bot(`Lớp <b>${esc(cls.lop)}</b> có <b>${cls.count || 0}</b> sinh viên.`);
    return;
  }

  const all = ctx.allClasses();
  const total = all.reduce((s, c) => s + (c.count || 0), 0);
  bot(
    `Cơ sở <b>${esc(ctx.getCoso())}</b> có <b>${all.length}</b> lớp và <b>${total}</b> sinh viên.\n` +
    "Mở một lớp để xem chi tiết."
  );
}

function summaryNow() {
  const cls = ctx.getCurrentClass();
  if (!cls) {
    bot("Mở một lớp trước để mình tổng kết nhé.");
    return;
  }

  const s = ctx.getSummary();
  bot(
    `Tổng kết lớp <b>${esc(cls.lop)}</b> · buổi <b>${ctx.getBuoiLabel()}</b> · ngày ${ctx.fmtDate(ctx.getNgay())}:\n` +
    `• Có mặt: ${s.kv}\n` +
    `• Vắng có phép: ${s.cp}\n` +
    `• Vắng không phép: ${s.kp}\n` +
    `• Tổng: ${s.total}`
  );
}

function pendingInfo() {
  const rows = ctx.getPending();
  if (!rows.length) {
    bot("Danh sách chờ gửi đang trống. Điểm danh rồi bấm “Thêm vào danh sách” nhé.");
    return;
  }

  const by = {};
  rows.forEach(r => {
    const b = r.buoi || "sang";
    const k = `${r.lop}|${r.ngay}|${b}`;
    by[k] = (by[k] || 0) + 1;
  });

  const lines = Object.keys(by).map(k => {
    const [lop, ngay, b] = k.split("|");
    return `• ${esc(lop)} · ${ctx.fmtDate(ngay)} · buổi ${buoiText(b)}: ${by[k]} bạn`;
  });

  bot(
    `Đang có <b>${rows.length}</b> bản ghi chờ gửi:\n${lines.join("\n")}\n` +
    "Bấm “Gửi” hoặc nói “gửi điểm danh” khi đã kiểm tra."
  );
}

function doAddToList() {
  const res = ctx.addToList();

  if (!res) {
    bot("Mở lớp và đánh dấu vắng trước đã nhé.");
    return;
  }

  if (!res.added) {
    bot(
      `Lớp <b>${esc(res.lop)}</b> · buổi ${buoiText(res.buoi)} (${ctx.fmtDate(res.ngay)}) ` +
      "không có bạn nào vắng — không có gì để thêm."
    );
    return;
  }

  bot(
    `Đã thêm <b>${res.added}</b> bạn vắng của lớp <b>${esc(res.lop)}</b> · buổi ${buoiText(res.buoi)} ` +
    `(${ctx.fmtDate(res.ngay)}) vào danh sách chờ.\n` +
    `Vắng có phép: ${res.cp} · Vắng không phép: ${res.kp}.`
  );
  refreshChips();
}

/* ---------- Trợ giúp + tính năng app ---------- */
function sendHelp() {
  bot(
    "<b>Mình có thể giúp gì?</b>\n" +
    "• <b>Điểm danh:</b> “Gia Huy p, Quang Huy k”\n" +
    "   p = vắng có phép · k = vắng không phép · kv = không vắng\n" +
    "• <b>Buổi:</b> “buổi sáng” / “buổi chiều”\n" +
    "• <b>Ngày:</b> “ngày 12/11”, “hôm qua”\n" +
    "• <b>Mở lớp:</b> “mở lớp THUD2”\n" +
    "• <b>Xem nhanh:</b> “ai vắng?”, “tổng kết”, “bao nhiêu sinh viên?”\n" +
    "• <b>Thao tác:</b> “tất cả có mặt”, “thêm vào danh sách”, “gửi điểm danh”\n" +
    "• <b>Điều hướng:</b> “về khoa”, “danh sách điểm danh”, “trang chủ”, “hồ sơ”\n" +
    "• <b>Hỏi app:</b> “cách thêm sinh viên”, “quyền của tôi”, “sửa điểm danh”"
  );
}

function answerFeature(n) {
  const p = ctx.getProfile() || {};
  const role = p.role || "user";

  if (/(them|nhap|import|upload).*(sinh vien|sv|hoc sinh)|quan li sinh vien/.test(n)) {
    return (
      "Thêm sinh viên: về <b>Trang chủ</b> → <b>Quản lí sinh viên</b> (manager/admin).\n" +
      "Có thể nhập tay từng bạn, hoặc vào trang <b>Upload sinh viên</b> để nạp Excel/JSON."
    );
  }

  if (/(xoa).*(sinh vien|sv|hoc sinh)/.test(n)) {
    return "Xoá sinh viên: Trang chủ → Quản lí sinh viên → chọn khoa/khóa/lớp → xoá. Chỉ <b>manager</b> và <b>admin</b> mới có nút xoá.";
  }

  if (/(quyen|vai tro|role|toi duoc|minh duoc)/.test(n)) {
    return (
      `Bạn đang là <b>${role === "admin" ? "Admin" : role === "manager" ? "Quản lí" : "Người dùng"}</b>.\n` +
      "• Người dùng: nhập/xem, không có nút xoá.\n" +
      "• Quản lí: xoá vi phạm + điểm danh, quản lí sinh viên.\n" +
      "• Admin: toàn quyền, kể cả duyệt tài khoản và phân quyền."
    );
  }

  if (/(vi pham)/.test(n) && /(them|ghi|tao|bao|nhap)/.test(n)) {
    return "Thêm vi phạm: Trang chủ → chọn sinh viên → nhập nội dung, ngày, buổi → Lưu. Chỉ admin/manager được xoá vi phạm.";
  }

  if (/(dang xuat|logout|thoat tai khoan)/.test(n)) {
    return "Đăng xuất: mở <b>Hồ sơ</b> (góc phải hoặc menu) → bấm <b>Đăng xuất</b>.";
  }

  if (/(anh|avatar|hinh dai dien)/.test(n) && /(doi|sua|thay|upload)/.test(n)) {
    return "Đổi ảnh đại diện: <b>Hồ sơ</b> → bấm vào ảnh → chọn ảnh mới (ảnh được nén 256px và lưu vào hồ sơ).";
  }

  if (/(giao dien|toi|dark|sang toi|che do)/.test(n)) {
    return "Đổi giao diện Sáng/Tối: <b>Hồ sơ</b> → mục <b>Giao diện</b> → chọn Sáng hoặc Tối.";
  }

  if (/(sua|chinh|xoa).*(diem danh)|diem danh.*(sua|chinh|xoa)/.test(n)) {
    return (
      "Sửa điểm danh đã gửi: mở <b>Danh sách điểm danh</b> → lọc ngày/lớp → xoá bản ghi sai (manager/admin) rồi điểm danh lại.\n" +
      "Mẹo: điểm danh lại cùng lớp + ngày + buổi rồi gửi sẽ <b>thay thế</b> dữ liệu cũ."
    );
  }

  if (/(duyet|phe duyet|tai khoan moi|cho duyet)/.test(n)) {
    return "Tài khoản Google mới cần <b>admin duyệt</b> và gán cơ sở + vai trò trong trang <b>Quản trị</b>. Sau khi được duyệt, tải lại trang để vào app.";
  }

  if (/(xuat excel|excel|tai file)/.test(n)) {
    return "Xuất Excel: mở <b>Danh sách vi phạm</b> hoặc <b>Danh sách điểm danh</b> → bấm <b>Xuất Excel</b>. File gồm cả sheet thống kê.";
  }

  if (/^(help|giup|huong dan)$/.test(n)) {
    sendHelp();
    return "";
  }

  return "";
}

function unknownReply() {
  return (
    "Mình chưa hiểu ý này. Bạn thử:\n" +
    "• “Gia Huy p, Quang Huy k”\n" +
    "• “mở lớp THUD2”\n" +
    "• “ai vắng?”\n" +
    "• “chuyển buổi chiều”\n" +
    "Hoặc bấm ⚙ để bật Gemini cho câu phức tạp."
  );
}

/* ---------- Gemini (tùy chọn) ---------- */
const SYSTEM_PROMPT = `Bạn là trợ lý tiếng Việt trong ứng dụng điểm danh của trường cao đẳng.
Nhiệm vụ: hiểu câu người dùng và chọn đúng hành động cho app.
CHỈ trả về JSON hợp lệ, không markdown, theo một trong hai dạng:
{"reply":"câu trả lời ngắn gọn, thân thiện","action":null}
hoặc
{"reply":"...","action":{"type":"..."}}
Các action hợp lệ:
- {"type":"attendance","text":"câu điểm danh đã chuẩn hoá, giữ nguyên tên và trạng thái"}
- {"type":"openClass","query":"tên lớp hoặc một phần tên lớp"}
- {"type":"setBuoi","value":"sang" hoặc "chieu"}
- {"type":"setDate","value":"YYYY-MM-DD"}
- {"type":"navigate","page":"index" | "danhsach" | "danhsach-diem-danh" | "profile"}
- {"type":"addToList"}
- {"type":"submit"}
- {"type":"help"}
Quy tắc:
- Khi người dùng nói ai vắng / nghỉ / có phép / không phép / tên + p,k,cp,kp,kv → dùng action attendance.
- Khi hỏi thông tin (bao nhiêu, tổng kết, ai vắng) → action null và trả lời dựa trên ngữ cảnh.
- Không bịa tên sinh viên hay số liệu ngoài ngữ cảnh.
- Trả lời tối đa 4 câu, thân thiện, xưng "mình".`;

function buildGeminiContext() {
  const p = ctx.getProfile() || {};
  const v = ctx.getView();
  const cls = ctx.getCurrentClass();
  const all = ctx.allClasses();
  const names = all.slice(0, 40).map(c => c.lop).join(", ");

  return [
    `Người dùng: ${p.displayName || ""} — vai trò ${p.role || "user"} — cơ sở ${ctx.getCoso()}.`,
    `Màn hình hiện tại: ${v.level === "sv" ? `đang điểm danh lớp ${cls?.lop}` : v.level}.`,
    `Ngày đang chọn: ${ctx.getNgay()} — buổi ${ctx.getBuoiLabel()}.`,
    cls
      ? `Lớp hiện tại: ${cls.lop} (${cls.count || 0} SV). Tổng kết: ${JSON.stringify(ctx.getSummary())}.`
      : "",
    `Danh sách lớp (một phần): ${names || "chưa tải"}.`,
    `Số bản ghi chờ gửi: ${ctx.getPending().length}.`
  ].filter(Boolean).join("\n");
}

async function askGemini(userText) {
  if (!cfg.key) return null;

  const contents = chatHistory.slice(-8).map(m => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.text }]
  }));

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT + "\n\nNGỮ CẢNH HIỆN TẠI:\n" + buildGeminiContext() }]
      },
      contents,
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 500,
        responseMimeType: "application/json"
      }
    })
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  let raw = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || "")
    .join("")
    .trim();

  raw = raw.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { reply: raw, action: null };
  }

  if (parsed && parsed.reply) {
    chatHistory.push({ role: "model", text: String(parsed.reply).slice(0, 500) });
  }

  return parsed;
}

async function runAction(action) {
  if (!action || typeof action !== "object") return;

  switch (action.type) {
    case "attendance":
      if (action.text) await parseAttendance(String(action.text));
      break;

    case "openClass":
      if (action.query) await tryOpenClass(String(action.query));
      break;

    case "setBuoi": {
      const b = action.value === "chieu" ? "chieu" : "sang";
      ctx.setBuoi(b);
      refreshChips();
      bot(`Đã chuyển sang buổi <b>${buoiText(b)}</b>.`);
      break;
    }

    case "setDate": {
      const iso = String(action.value || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && ctx.setNgay(iso)) {
        bot(`Đã chọn ngày <b>${ctx.fmtDate(iso)}</b>.`);
      } else {
        bot("Ngày không hợp lệ. Bạn dùng dạng YYYY-MM-DD hoặc “ngày 12/11” nhé.");
      }
      break;
    }

    case "navigate": {
      const pages = {
        index: "index.html",
        danhsach: "danhsach.html",
        "danhsach-diem-danh": "danhsach-diemdanh.html",
        profile: "profile.html"
      };
      const page = pages[action.page];
      if (page) {
        bot("Đang mở trang…");
        setTimeout(() => { window.location.href = page; }, 300);
      }
      break;
    }

    case "addToList":
      doAddToList();
      break;

    case "submit":
      bot("Mình mở hộp thoại xác nhận gửi. Kiểm tra kỹ trước khi đồng ý nhé.");
      setTimeout(() => ctx.submit(), 300);
      break;

    case "help":
      sendHelp();
      break;

    default:
      bot("Mình chưa hỗ trợ thao tác này.");
  }
}
