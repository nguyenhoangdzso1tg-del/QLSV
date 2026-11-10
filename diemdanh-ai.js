/* =========================================================
   diemdanh-ai.js — Phân tích câu điểm danh tự nhiên
   Chạy hoàn toàn trên máy (không gọi mạng, không cần API key).

   Ví dụ hiểu được:
     "lớp THUD2 Gia Huy có phép, Quang Huy không phép"
     "Gia Huy p, Quang Huy k"
     "THUD2: Nguyễn Gia Huy vắng có phép; Trần Quang Huy vắng không phép"
   ========================================================= */

export const AI_STATUS_LABEL = {
  vang_khong_phep: "Vắng không phép",
  vang_co_phep: "Vắng có phép",
  khong_vang: "Không vắng"
};

/* Bỏ dấu tiếng Việt + lower-case + bỏ ký tự đặc biệt */
export function normalize(text) {
  return String(text == null ? "" : text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Từ khóa trạng thái — đặt cụm dài trước cụm ngắn để không ăn nhầm */
const STATUS_TOKEN =
  /(vang\s+khong\s+phep|khong\s+(?:co\s+)?phep|nghi\s+khong\s+phep|khong\s+xin\s+phep|tron\s+hoc|bo\s+hoc|kp|k|vang\s+co\s+phep|co\s+phep|xin\s+phep|nghi\s+co\s+phep|cp|p|khong\s+vang|co\s+mat|di\s+hoc|kv|vang)(?=\s|$)/g;

function classifyStatus(token) {
  const t = normalize(token);
  if (/^khong\s+vang$/.test(t) || /^co\s+mat$/.test(t) || /^di\s+hoc$/.test(t) || t === "kv") {
    return "khong_vang";
  }
  if (
    t === "k" || t === "kp" || /khong/.test(t) ||
    t === "tron hoc" || t === "bo hoc" || t === "vang"
  ) {
    return "vang_khong_phep";
  }
  return "vang_co_phep";
}

/* Bỏ các từ đệm, giữ nguyên tên */
function cleanName(part) {
  return normalize(part)
    .replace(/\b(diem\s+danh|danh\s+sach|sinh\s+vien)\b/g, " ")
    .replace(/\b(ban|sv|em|nhe|nha|oi|lop|class|hom|nay|ngay|cua|cho)\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tách câu thành các cặp "tên + trạng thái".
 * Không cần dấu phẩy: "Gia Huy p Quang Huy k" vẫn hiểu.
 */
export function parseStatusSegments(text) {
  const t = " " + normalize(text) + " ";
  const rows = [];
  let lastEnd = 0;
  STATUS_TOKEN.lastIndex = 0;

  let m;
  while ((m = STATUS_TOKEN.exec(t))) {
    const namePart = t.slice(lastEnd, m.index);
    lastEnd = STATUS_TOKEN.lastIndex;
    const name = cleanName(namePart);
    if (name) {
      rows.push({
        name,
        status: classifyStatus(m[0]),
        token: normalize(m[0])
      });
    }
  }
  return rows;
}

/* Tìm lớp được nhắc trong câu (theo đúng tên lớp) */
export function detectClasses(text, classes) {
  const t = " " + normalize(text) + " ";
  const exact = classes.filter(c => {
    const n = normalize(c.lop);
    if (!n) return false;
    return new RegExp("(?:^|\\s)" + escapeRe(n) + "(?=\\s|$)").test(t);
  });
  if (exact.length) return exact;

  // Thử so khớp không khoảng trắng (vd "THUD 2" ↔ "THUD2")
  const compact = t.replace(/\s+/g, "");
  return classes.filter(c => {
    const n = normalize(c.lop).replace(/\s+/g, "");
    return n.length >= 3 && compact.includes(n);
  });
}

/* Bỏ tên lớp khỏi câu để phần còn lại chỉ là tên người */
export function stripClass(text, lop) {
  const n = normalize(lop);
  if (!n) return normalize(text);
  const re = new RegExp(
    "(?:^|\\s)(?:lop\\s+|class\\s+)?" + escapeRe(n) + "(?=\\s|$)",
    "g"
  );
  return normalize(text).replace(re, " ").replace(/\s+/g, " ").trim();
}

/**
 * Chấm điểm một cụm từ với danh sách sinh viên.
 * Trả về mảng đã sắp xếp giảm dần.
 */
function scoreCandidates(tokens, students) {
  const qJoin = tokens.join(" ");
  const scored = [];

  for (const sv of students || []) {
    const full = normalize(sv.tenSV);
    if (!full) continue;
    const tok = full.split(" ");

    let score = 0;
    let kind = "";
    if (full === qJoin) {
      score = 100;
      kind = "exact";
    } else if (qJoin.length >= 3 && full.endsWith(" " + qJoin)) {
      score = 80;
      kind = "suffix";
    } else if (qJoin.length >= 3 && tokens.every(x => tok.includes(x))) {
      score = 50 + tokens.length;
      kind = "tokens";
    }

    if (score) scored.push({ student: sv, score, kind });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.student.tenSV).localeCompare(String(b.student.tenSV), "vi")
  );

  return scored;
}

/**
 * So khớp tên người nhập với danh sách sinh viên của lớp.
 * Tự bỏ bớt từ thừa ở đầu/cuối câu (vd "điểm danh ngày Gia Huy p").
 * Trả về:
 *   { kind: "ok", student, kindLabel, candidates }
 *   { kind: "ambiguous", candidates }
 *   { kind: "none", candidates: [] }
 */
export function matchStudents(name, students) {
  const tokens = normalize(name).split(" ").filter(Boolean);
  if (!tokens.length) return { kind: "none", candidates: [] };

  for (let s = 0; s < tokens.length; s++) {
    for (let e = tokens.length; e > s; e--) {
      const sub = tokens.slice(s, e);
      const scored = scoreCandidates(sub, students);
      if (!scored.length) continue;

      const top = scored[0].score;
      const best = scored.filter(x => x.score === top);

      if (best.length === 1) {
        return {
          kind: "ok",
          student: best[0].student,
          kindLabel: best[0].kind,
          candidates: scored
        };
      }
      return { kind: "ambiguous", candidates: best };
    }
  }

  return { kind: "none", candidates: [] };
}

/* Ghép toàn bộ: câu + lớp → danh sách dòng để người dùng duyệt */
export function buildRows(text, cls) {
  if (!cls || !cls.students) return [];
  const body = stripClass(text, cls.lop)
    .replace(/\b(lop|class)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return parseStatusSegments(body).map(seg => ({
    ...seg,
    match: matchStudents(seg.name, cls.students)
  }));
}
