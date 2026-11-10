# Tối ưu Firebase cho Thietkeweb

Tài liệu này tóm tắt các thay đổi tối ưu theo hướng của dự án QLVP, nhưng **giữ nguyên điểm danh (Sáng/Chiều) và bảng xếp hạng** của Thietkeweb.

## 1. Cần deploy 2 file cấu hình

Từ thư mục `D:\Thietkeweb`, chạy:

```bash
firebase deploy --only firestore:indexes,firestore:rules
```

Nếu chưa cài Firebase CLI:

```bash
npm i -g firebase-tools
firebase login
firebase use webqlvp
```

`firestore.indexes.json` đã thêm các index:

- `diemdanh`: `coso + ngay`
- `diemdanh`: `coso + ngay + lop`
- `violations`: `coso + createdAt`
- `violations`: `coso + ngay`

> Nếu trình duyệt báo lỗi “requires an index”, hãy deploy lại index rồi chờ Firebase tạo xong (1–5 phút).

`firestore.rules` đã thêm quyền cho `meta/studentTree`:

- Người đã duyệt: được đọc.
- Admin / quản lí: được ghi.

## 2. Cây Khoa → Khóa → Lớp chỉ đọc 1 document

Trước đây mỗi lần mở trang, app quét toàn bộ collection `students`. Bây giờ:

- Đọc 1 document `meta/studentTree`.
- Danh sách sinh viên của một lớp chỉ tải khi mở đúng lớp đó (`getStudentsByClass`).
- Tìm kiếm dùng query prefix, giới hạn 20–50 kết quả.
- “Tìm trong toàn bộ danh sách” và “Tải toàn bộ danh sách” là thao tác **chủ động**, có cảnh báo lượt đọc.

### Lần đầu sử dụng

Nếu `meta/studentTree` chưa tồn tại, app sẽ tự quét `students` **một lần** để dựng cây và lưu lại (nếu tài khoản có quyền). Sau đó:

- Admin / quản lí vào **Quản lý sinh viên**.
- Bấm **“Cập nhật lại cây lớp / khóa”** một lần sau khi upload danh sách mới.

Nếu tài khoản thường dựng cây mà không có quyền ghi, cây vẫn được cache trên máy trình duyệt đó. Admin nên chạy nút cập nhật để lưu lên Firebase cho tất cả mọi người.

## 3. Cache Firestore trên trình duyệt

`firebase.js` dùng:

```js
initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
```

Lợi ích:

- F5 / chuyển trang không đọc lại dữ liệu đã có.
- Nhiều tab dùng chung cache an toàn.
- Nếu trình duyệt chặn IndexedDB (chế độ riêng tư), tự quay về Firestore mặc định.

## 4. Điểm danh

- Nút **Gửi điểm danh** chỉ đọc đúng các bản ghi cùng `coso + ngay + lop`, sau đó xóa/thay thế đúng buổi Sáng/Chiều.
- Không còn quét toàn bộ collection `diemdanh` của cơ sở.
- Danh sách điểm danh mặc định chỉ tải **một ngày**.
- Nút **“Tải tất cả ngày”** mới tải toàn bộ (có xác nhận).
- Cache theo ngày 5 phút.

## 5. Bảng xếp hạng

- Chỉ đọc `violations` trong khoảng ngày của tuần/tháng hiện tại.
- Lọc theo `coso + ngay`.
- Phân trang 1.000 bản ghi/lần.
- Cache kết quả 60 giây.

## 6. Lịch vi phạm

`script.js` đã chuyển sang:

- Cache theo ngày 10 phút.
- Query `coso + ngay`, phân trang 1.000 bản ghi.
- Nút **“Làm mới”** xóa cache các ngày đang chọn và tải lại.

## 7. Danh sách vi phạm

- Giữ nguyên realtime 200 bản ghi gần nhất.
- Lọc theo ngày dùng index `coso + ngay`.
- Xuất Excel lấy đúng dữ liệu của ngày đang lọc.

## 8. Quản lý sinh viên

- Mặc định chỉ tải 50 sinh viên đầu.
- Tìm kiếm prefix, không quét toàn bộ.
- Xóa lớp / khóa dùng query theo `lop` hoặc `khoaHoc`, ghi theo batch 400.
- Sau khi thêm/xóa, cây `meta/studentTree` được cập nhật ngay.

## 9. Kiểm tra nhanh sau khi deploy

1. Mở **Quản lý sinh viên** → bấm **Cập nhật lại cây lớp / khóa**.
2. Mở **Điểm danh** → chọn Khoa → Khóa → Lớp.
3. Chuyển **Sáng / Chiều**, đánh dấu vắng, bấm **Gửi điểm danh**.
4. Mở **Danh sách điểm danh** → kiểm tra đúng ngày + buổi.
5. Mở **Lịch** → chọn ngày → bấm **Làm mới**.
6. Mở trang chủ → kiểm tra **Bảng xếp hạng** tuần/tháng.

## 10. Lưu ý

- Lần đầu tải sau khi xóa cache sẽ chậm hơn một chút.
- Nếu dữ liệu lớp bị lệch (thêm/xóa hàng loạt ngoài app), bấm **Cập nhật lại cây lớp / khóa**.
- Không cần chạy “Tải tất cả” trong lúc sử dụng bình thường.
