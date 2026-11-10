/*
 * Tối ưu dữ liệu sinh viên cho Firestore (gói miễn phí):
 * - Chỉ đọc 1 document nhỏ "meta/studentTree" để dựng cây Khoa → Khóa → Lớp.
 * - Danh sách sinh viên của 1 lớp chỉ được tải khi người dùng mở đúng lớp đó.
 * - Tìm kiếm dùng query prefix (mã SV / tên) + giới hạn 20 kết quả.
 * - "Tải toàn bộ" chỉ chạy khi người dùng chủ động bấm (có cảnh báo lượt đọc).
 * - Lần đầu chưa có meta/studentTree: tự dựng 1 lần rồi lưu lại (nếu có quyền).
 */

import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  limit,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const META_COLLECTION = "meta";
const META_ID = "studentTree";

const META_CACHE_KEY = "vp_student_tree_v2";
const CLASS_CACHE_PREFIX = "vp_student_class_v2_";
const ALL_CACHE_KEY = "vp_student_all_v2";

const META_TTL = 24 * 60 * 60 * 1000;   // 24 giờ
const CLASS_TTL = 24 * 60 * 60 * 1000;  // 24 giờ
const ALL_TTL = 24 * 60 * 60 * 1000;    // 24 giờ

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage đầy hoặc bị chặn: bỏ qua, vẫn dùng cache trong RAM */
  }
}

function isFresh(entry, ttl) {
  return !!(entry && entry.at && Date.now() - entry.at < ttl);
}

let treeMemory = null;
let treePromise = null;
const classMemory = new Map();
const classPromise = new Map();
const searchMemory = new Map();

function cleanTree(raw) {
  const tree = {};
  if (!raw || typeof raw !== "object") return tree;

  Object.keys(raw).forEach((khoaKey) => {
    const khoa = String(khoaKey || "").trim();
    const khoaNode = raw[khoaKey];
    if (!khoa || !khoaNode || typeof khoaNode !== "object") return;

    tree[khoa] = {};
    Object.keys(khoaNode).forEach((khoaHocKey) => {
      const khoaHoc = String(khoaHocKey || "").trim();
      const khoaHocNode = khoaNode[khoaHocKey];
      if (!khoaHoc || !khoaHocNode || typeof khoaHocNode !== "object") return;

      tree[khoa][khoaHoc] = {};
      Object.keys(khoaHocNode).forEach((lopKey) => {
        const lop = String(lopKey || "").trim();
        if (!lop) return;
        tree[khoa][khoaHoc][lop] = Number(khoaHocNode[lopKey]) || 0;
      });
    });
  });

  return tree;
}

async function buildTreeFromServer() {
  // Chỉ chạy 1 lần khi meta/studentTree chưa tồn tại (hoặc khi admin bấm cập nhật).
  const snap = await getDocs(collection(db, "students"));
  const tree = {};

  snap.forEach((d) => {
    const s = d.data() || {};
    const khoa = String(s.khoa || "").trim();
    const khoaHoc = String(s.khoaHoc || "").trim();
    const lop = String(s.lop || "").trim();
    if (!khoa || !khoaHoc || !lop) return;

    if (!tree[khoa]) tree[khoa] = {};
    if (!tree[khoa][khoaHoc]) tree[khoa][khoaHoc] = {};
    tree[khoa][khoaHoc][lop] = (tree[khoa][khoaHoc][lop] || 0) + 1;
  });

  return tree;
}

async function saveTree(tree) {
  const clean = cleanTree(tree);

  // Lưu lên Firebase trước
  await setDoc(
    doc(db, META_COLLECTION, META_ID),
    {
      tree: clean,
      updatedAt: serverTimestamp(),
      version: 1
    },
    { merge: true }
  );

  // Chỉ cập nhật cache khi Firebase ghi thành công
  treeMemory = clean;

  writeLocal(META_CACHE_KEY, {
    at: Date.now(),
    tree: clean
  });

  return clean;
}

function cacheTree(tree) {
  treeMemory = tree;
  writeLocal(META_CACHE_KEY, { at: Date.now(), tree });
}

export async function getStudentTree({ force = false, buildIfMissing = true } = {}) {
  if (!force && treeMemory) return treeMemory;

  if (!force) {
    const cached = readLocal(META_CACHE_KEY);
    if (isFresh(cached, META_TTL) && cached.tree) {
      treeMemory = cleanTree(cached.tree);
      return treeMemory;
    }
  }

  if (treePromise) return treePromise;

  treePromise = (async () => {
    let snap = null;

    try {
      snap = await getDoc(doc(db, META_COLLECTION, META_ID));
    } catch (e) {
      // Không đọc được meta (mất mạng / chưa cấu hình quyền) → thử dựng từ students
      if (!buildIfMissing) throw e;
    }

    const data = snap && snap.exists() ? (snap.data() || {}) : null;
    const tree = data ? cleanTree(data.tree || {}) : {};

    if (Object.keys(tree).length > 0) {
      cacheTree(tree);
      return tree;
    }

    if (!buildIfMissing) {
      throw new Error(
        "Chưa có meta/studentTree. Admin hãy vào Quản lý sinh viên và bấm Cập nhật lại cây lớp / khóa."
      );
    }

    // Lần đầu: quét students 1 lần để app chạy được ngay.
    const built = await buildTreeFromServer();
    if (Object.keys(built).length === 0) {
      throw new Error("Chưa có sinh viên trong Firebase. Hãy upload danh sách sinh viên trước.");
    }

    try {
      await saveTree(built);
    } catch {
      // Người dùng thường không có quyền ghi meta → vẫn dùng cache trên máy.
      cacheTree(built);
    }

    return built;
  })().finally(() => {
    treePromise = null;
  });

  return treePromise;
}

export async function rebuildStudentTree() {
  const tree = await buildTreeFromServer();
  await saveTree(tree);
  invalidateClassCaches();
  return tree;
}

function classKey(khoa, khoaHoc, lop) {
  return (
    CLASS_CACHE_PREFIX +
    [khoa, khoaHoc, lop]
      .map((x) => encodeURIComponent(String(x || "")))
      .join("|")
  );
}

export async function getStudentsByClass(khoa, khoaHoc, lop, { force = false } = {}) {
  const key = classKey(khoa, khoaHoc, lop);

  if (!force && classMemory.has(key)) return classMemory.get(key);

  if (!force) {
    const cached = readLocal(key);
    if (isFresh(cached, CLASS_TTL) && Array.isArray(cached.list)) {
      classMemory.set(key, cached.list);
      return cached.list;
    }
  }

  if (!force && classPromise.has(key)) return classPromise.get(key);

  const job = (async () => {
    // Chỉ lọc theo "lop" (index đơn) để không cần composite index.
    const snap = await getDocs(
      query(
        collection(db, "students"),
        where("lop", "==", lop),
        limit(1000)
      )
    );

    const list = [];
    snap.forEach((d) => {
      const s = d.data() || {};
      if (String(s.khoa || "") !== String(khoa || "")) return;
      if (String(s.khoaHoc || "") !== String(khoaHoc || "")) return;

      list.push({
        maSV: s.maSV || d.id,
        tenSV: s.tenSV || "",
        khoa: s.khoa || khoa,
        khoaHoc: s.khoaHoc || khoaHoc,
        lop: s.lop || lop
      });
    });

    list.sort((a, b) =>
      String(a.tenSV || "").localeCompare(String(b.tenSV || ""), "vi")
    );

    classMemory.set(key, list);
    writeLocal(key, { at: Date.now(), list });
    return list;
  })().finally(() => {
    classPromise.delete(key);
  });

  classPromise.set(key, job);
  return job;
}

function normalizeStudent(d) {
  const s = d.data() || {};
  return {
    maSV: s.maSV || d.id,
    tenSV: s.tenSV || "",
    khoa: s.khoa || "",
    khoaHoc: s.khoaHoc || "",
    lop: s.lop || ""
  };
}

export async function searchStudents(keyword, max = 20) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];

  const memKey = kw.toLowerCase() + "|" + max;
  const mem = searchMemory.get(memKey);
  if (mem && Date.now() - mem.at < 5 * 60 * 1000) return mem.list;

  const jobs = [];
  const looksLikeId = /[0-9]/.test(kw);

  if (looksLikeId) {
    // Mã SV thường viết hoa
    const variants = [...new Set([kw, kw.toUpperCase()])];
    variants.forEach((v) => {
      jobs.push(
        getDocs(
          query(
            collection(db, "students"),
            orderBy("maSV"),
            startAt(v),
            endAt(v + "\uf8ff"),
            limit(max)
          )
        ).catch(() => null)
      );
    });
  } else {
    // Tên: thử cả chữ thường và chữ hoa đầu câu
    const variants = [
      ...new Set([kw, kw.charAt(0).toUpperCase() + kw.slice(1)])
    ];
    variants.forEach((v) => {
      jobs.push(
        getDocs(
          query(
            collection(db, "students"),
            orderBy("tenSV"),
            startAt(v),
            endAt(v + "\uf8ff"),
            limit(max)
          )
        ).catch(() => null)
      );
    });
  }

  const snaps = await Promise.all(jobs);
  const map = new Map();

  snaps.forEach((snap) => {
    if (!snap) return;
    snap.forEach((d) => {
      const item = normalizeStudent(d);
      if (!map.has(item.maSV)) map.set(item.maSV, item);
    });
  });

  const list = [...map.values()].slice(0, max);
  searchMemory.set(memKey, { at: Date.now(), list });
  return list;
}

export async function loadAllStudents({ force = false } = {}) {
  if (!force) {
    const cached = readLocal(ALL_CACHE_KEY);
    if (isFresh(cached, ALL_TTL) && Array.isArray(cached.list)) {
      return cached.list;
    }
  }

  // Hàm này CHỈ được gọi khi người dùng chủ động yêu cầu tìm sâu.
  const snap = await getDocs(collection(db, "students"));
  const list = [];
  snap.forEach((d) => list.push(normalizeStudent(d)));

  list.sort((a, b) =>
    String(a.maSV || "").localeCompare(String(b.maSV || ""), "vi")
  );

  writeLocal(ALL_CACHE_KEY, { at: Date.now(), list });
  return list;
}

export function invalidateClassCaches() {
  classMemory.clear();
  classPromise.clear();
  searchMemory.clear();

  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(CLASS_CACHE_PREFIX) || k === ALL_CACHE_KEY)) {
        keys.push(k);
      }
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function invalidateStudentCaches() {
  invalidateClassCaches();
  treeMemory = null;
  try {
    localStorage.removeItem(META_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function treeAdd(tree, khoa, khoaHoc, lop, delta) {
  if (!tree[khoa]) tree[khoa] = {};
  if (!tree[khoa][khoaHoc]) tree[khoa][khoaHoc] = {};

  const current = Number(tree[khoa][khoaHoc][lop]) || 0;
  const next = current + delta;

  if (next > 0) tree[khoa][khoaHoc][lop] = next;
  else delete tree[khoa][khoaHoc][lop];

  if (Object.keys(tree[khoa][khoaHoc]).length === 0) {
    delete tree[khoa][khoaHoc];
  }
  if (Object.keys(tree[khoa]).length === 0) {
    delete tree[khoa];
  }
}

export async function addStudentToTree(khoa, khoaHoc, lop) {
  const tree = await getStudentTree();
  treeAdd(tree, khoa, khoaHoc, lop, 1);
  await saveTree(tree);
  invalidateClassCaches();
  return tree;
}

export async function removeStudentFromTree(khoa, khoaHoc, lop, count = 1) {
  const tree = await getStudentTree();
  treeAdd(tree, khoa, khoaHoc, lop, -Math.max(1, count));
  await saveTree(tree);
  invalidateClassCaches();
  return tree;
}

export async function removeClassFromTree(khoa, khoaHoc, lop) {
  const tree = await getStudentTree();

  if (tree[khoa] && tree[khoa][khoaHoc]) {
    if (lop) {
      delete tree[khoa][khoaHoc][lop];
      if (Object.keys(tree[khoa][khoaHoc]).length === 0) {
        delete tree[khoa][khoaHoc];
      }
    } else {
      delete tree[khoa][khoaHoc];
    }

    if (Object.keys(tree[khoa]).length === 0) {
      delete tree[khoa];
    }
  }

  await saveTree(tree);
  invalidateClassCaches();
  return tree;
}
