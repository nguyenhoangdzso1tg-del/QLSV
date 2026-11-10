import { initializeApp } from
"https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";

import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import { getAuth, GoogleAuthProvider } from
"https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

/* Project: webqlvp (tách riêng khỏi project cũ fir-7ab56) */
const firebaseConfig = {
  apiKey: "AIzaSyDrUCoKBY5zWhmn8lncpxVr3e6foaZV_II",
  authDomain: "webqlvp.firebaseapp.com",
  projectId: "webqlvp",
  storageBucket: "webqlvp.firebasestorage.app",
  messagingSenderId: "452459716749",
  appId: "1:452459716749:web:a6e06b8013b1ca9fb682c4"
};

const app = initializeApp(firebaseConfig);

/*
 * BẬT CACHE IndexedDB (persistent local cache)
 * → F5 / chuyển trang: Firestore đọc lại từ ổ cứng trình duyệt, không tốn lượt đọc.
 * → persistentMultipleTabManager giúp nhiều tab dùng chung cache an toàn.
 * → Nếu trình duyệt chặn IndexedDB (chế độ riêng tư), tự quay về cache mặc định.
 */
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (e) {
  console.warn("Không bật được cache IndexedDB, dùng Firestore mặc định.", e);
  db = getFirestore(app);
}

export { db };
export const auth = getAuth(app);

/* Đăng nhập bằng Google */
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
