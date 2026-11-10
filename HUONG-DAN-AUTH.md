# Hướng dẫn đăng nhập Google + phân quyền

Tài liệu này hướng dẫn cấu hình Firebase cho hệ thống quản lý vi phạm sau khi chuyển sang đăng nhập bằng Google.

---

## 1. Bật đăng nhập Google

1. Mở [Firebase Console](https://console.firebase.google.com/) → chọn project **webqlvp**.
2. Vào **Authentication** → tab **Sign-in method**.
3. Bấm **Add new provider** (hoặc **Get started** nếu chưa bật Authentication).
4. Chọn **Google** → bật **Enable**.
5. Chọn email hỗ trợ (Project support email) → **Save**.

## 2. Thêm tên miền được phép

Vào **Authentication** → **Settings** → **Authorized domains**, thêm các tên miền sẽ chạy ứng dụng:

- `localhost` (khi chạy Live Server)
- `webqlvp.firebaseapp.com`
- `webqlvp.web.app`
- Tên miền riêng (nếu có)

Nếu thiếu, đăng nhập sẽ báo lỗi `auth/unauthorized-domain`.

## 3. Tạo Admin đầu tiên (bắt buộc làm 1 lần)

Vì mọi tài khoản mới đều ở trạng thái **chờ duyệt**, cần tạo Admin đầu tiên trực tiếp trong Firestore:

1. Mở ứng dụng → bấm **Đăng nhập bằng Google** bằng tài khoản sẽ làm Admin.
2. Màn hình sẽ hiện “Chờ admin duyệt”. Lúc này hồ sơ `users/{uid}` đã được tạo.
3. Vào **Firestore Database** → collection **users** → mở document có email của bạn.
4. Sửa các trường:

   | Trường | Giá trị |
   |---|---|
   | `role` | `admin` |
   | `approved` | `true` |
   | `rejected` | `false` |
   | `coso` | `Chu Văn An` hoặc `Mạc Cửu` |

5. Quay lại ứng dụng, bấm **Kiểm tra lại** (hoặc tải lại trang).
6. Từ đây bạn vào được **Quản trị người dùng** (`admin.html`) để duyệt những người khác.

> Mẹo: nếu không thấy document, kiểm tra đã đăng nhập đúng project và đúng collection `users`.

## 4. Publish Firestore Rules

1. Mở file `firestore.rules` trong thư mục dự án.
2. Vào **Firestore Database** → tab **Rules**.
3. Dán toàn bộ nội dung file, bấm **Publish**.

Quy tắc này đảm bảo:

- Chỉ người đã đăng nhập **và được duyệt** mới đọc/ghi dữ liệu.
- Người dùng chỉ thấy dữ liệu đúng **cơ sở** được gán.
- Chỉ `admin` / `quản lí` mới xoá **vi phạm** và quản lý sinh viên.
- Chỉ `admin` mới duyệt tài khoản, đổi vai trò, đổi cơ sở.
- Người dùng chỉ được tự sửa tên, avatar và giao diện sáng/tối.
- Riêng **điểm danh**: mọi người dùng đã duyệt trong cùng cơ sở được ghi/xoá bản ghi điểm danh, vì khi bấm **Gửi điểm danh** ứng dụng thay thế dữ liệu cũ của cùng lớp + ngày. Nút xoá trên trang *Danh sách điểm danh* vẫn chỉ hiện với admin / quản lí.

## 5. Duyệt người dùng mới

1. Người mới đăng nhập bằng Google → hồ sơ tự tạo với `role: "user"`, `approved: false`.
2. Admin mở trang **Quản trị người dùng** (`admin.html`):
   - Bấm **Duyệt**.
   - Chọn **Cơ sở** (Chu Văn An / Mạc Cửu).
   - Chọn **Vai trò**: `Người dùng`, `Quản lí`, hoặc `Admin`.
3. Người dùng bấm **Kiểm tra lại** để vào hệ thống.

Có thể sửa trực tiếp các trường trên trong Firestore Console nếu muốn.

## 6. Quyền hạn từng vai trò

| Vai trò | Quyền |
|---|---|
| `admin` | Toàn quyền; duyệt người dùng; đổi vai trò/cơ sở; xoá dữ liệu; quản lý sinh viên |
| `manager` | Nhập và xem dữ liệu; xoá vi phạm / điểm danh trong danh sách; quản lý sinh viên |
| `user` | Nhập và xem dữ liệu; không thấy nút xoá trong danh sách (vẫn gửi lại được điểm danh cho cùng lớp + ngày) |

## 7. Hồ sơ, avatar và giao diện

- Bấm **avatar** ở góc màn hình (hoặc nút **Hồ sơ**) để mở `profile.html`.
- Có thể:
  - Đổi ảnh đại diện (ảnh được nén nhỏ và lưu vào Firestore, **không cần Firebase Storage**).
  - Đổi tên hiển thị.
  - Chọn giao diện **Sáng / Tối**.
  - Đăng xuất.
- Giao diện được lưu ở `localStorage.theme` và đồng bộ vào `users/{uid}.theme`.

## 8. Điểm danh: nút quay lại và trợ lý AI

### Nút “Quay lại” và “Trang chủ”

- **Quay lại** chỉ lùi trong các bước chọn khoa → khóa → lớp → sinh viên.
- Ở màn hình gốc, nút **Quay lại** bị mờ và **không làm thoát trang**.
- Muốn ra trang chính, bấm nút **Trang chủ** (biểu tượng ngôi nhà) ngay dưới nút Quay lại.

### Trợ lý điểm danh

Panel **Trợ lý điểm danh** nằm ngay trên danh sách chờ gửi trong `diemdanh.html`.

Cách dùng:

1. Gõ câu tự nhiên, ví dụ:
   - `lớp THUD2 Gia Huy có phép, Quang Huy không phép`
   - `Gia Huy p, Quang Huy k`
   - `điểm danh lớp THUD2 ngày 12/11 Gia Huy p`
2. Bấm **Phân tích** (hoặc Enter).
3. Xem bảng kết quả:
   - Dòng **chưa chắc chắn** (trùng tên, không tìm thấy) sẽ có cảnh báo vàng và ô chọn người.
   - Chọn đúng sinh viên trong ô chọn → ô “Áp dụng” tự tích.
   - Có thể đổi trạng thái ngay trong bảng.
4. Bấm **Áp dụng vào lớp** → các thẻ sinh viên bên dưới được đánh dấu sẵn.
5. Kiểm tra lại thẻ, sửa nếu cần, rồi bấm **Thêm vào danh sách** và **Gửi điểm danh** như bình thường.

Từ khoá trạng thái được hiểu:

| Người dùng gõ | Trạng thái |
|---|---|
| `p`, `có phép`, `cp`, `nghỉ có phép`, `xin phép` | Vắng có phép |
| `k`, `kp`, `không phép`, `vắng`, `trốn học` | Vắng không phép |
| `kv`, `không vắng`, `có mặt`, `đi học` | Không vắng |

Lưu ý:

- Trợ lý chạy **hoàn toàn trên máy** (không gửi dữ liệu ra ngoài, không cần API key).
- Nếu câu không có tên lớp, hệ thống dùng lớp đang mở; nếu vẫn chưa rõ, chọn lớp ở ô “Lớp:”.
- Tên được so khớp không dấu, không phân biệt hoa/thường; khớp theo họ tên đầy đủ, tên cuối hoặc các từ trong tên.
- Trùng tên (ví dụ 2 người cùng tên “Gia Huy”) sẽ **không tự chọn** — người dùng phải chọn để tránh điểm danh sai.

## 9. Xử lý sự cố thường gặp

| Lỗi / hiện tượng | Cách xử lý |
|---|---|
| `auth/operation-not-allowed` | Chưa bật Google trong Authentication → Sign-in method |
| `auth/unauthorized-domain` | Thêm tên miền vào Authorized domains |
| `Missing or insufficient permissions` | Chưa Publish `firestore.rules`, hoặc tài khoản chưa được duyệt / chưa gán cơ sở |
| Đã duyệt nhưng vẫn bị chặn | Kiểm tra `approved: true` và `coso` đã có giá trị; bấm Kiểm tra lại / tải lại trang |
| Trang cũ vẫn hiện giao diện cũ | Service Worker đang cache. Mở DevTools → Application → Service Workers → **Unregister**, rồi tải lại (Ctrl + F5) |
| Không vào được `admin.html` | Tài khoản phải có `role: "admin"` và `approved: true` |

## 10. Kiểm tra nhanh sau khi cấu hình

- [ ] Đăng nhập Google thành công.
- [ ] Tài khoản mới hiện màn hình “Chờ admin duyệt”.
- [ ] Admin duyệt + gán cơ sở → người dùng vào được trang chính.
- [ ] `user` không thấy nút xoá trong Danh sách vi phạm / Danh sách điểm danh.
- [ ] `manager` xoá được vi phạm và điểm danh.
- [ ] `admin` vào được Quản trị người dùng.
- [ ] Đổi avatar, đổi sáng/tối, đăng xuất hoạt động.
- [ ] Ở Điểm danh, nút **Quay lại** không làm thoát trang; nút **Trang chủ** mở `index.html`.
- [ ] Trợ lý điểm danh hiểu câu “Gia Huy p, Quang Huy k”, có bảng duyệt trước khi áp dụng.
- [ ] Không còn ô nhập mật khẩu admin cũ ở bất kỳ trang nào.
