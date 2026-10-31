# Bản đồ Kiến thức Nhân loại

Một trang web tĩnh (HTML/CSS/JS thuần, không cần build) hiển thị các lĩnh vực, khái niệm,
phát minh và sự kiện tri thức của nhân loại dưới dạng **đồ thị có hướng (DAG)** theo
**dòng thời gian** — mỗi node có thể có một hoặc nhiều "nguồn gốc" (node mà nó bắt nguồn
từ / chịu ảnh hưởng). Khi bấm vào một node, toàn bộ chuỗi nguồn gốc của nó được truy
ngược và highlight, giúp trả lời câu hỏi: *"sự kiện/khái niệm này bắt nguồn từ đâu trên
bản đồ?"*

> **Lưu ý quan trọng:** Đây là một **khung khởi điểm**, không phải một bách khoa toàn thư
> đầy đủ hay một chuẩn học thuật chính thức. Các mốc năm mang tính đại diện (nhiều sự
> kiện lịch sử trải dài nhiều thế kỷ hoặc có tranh cãi về thời điểm/người khởi xướng
> chính xác), và các quan hệ "nguồn gốc" phản ánh cách diễn giải phổ biến/chủ đạo, không
> phải sự thật tuyệt đối. Hãy coi đây là điểm bắt đầu để mở rộng và hiệu đính dần.

## Cấu trúc thư mục

```
index.html              Trang chính
css/styles.css          Giao diện
js/graph.js             Toàn bộ logic: layout, render D3, tương tác, modal thêm/xuất dữ liệu
data/knowledge-map.json Dữ liệu: categories (lĩnh vực) + nodes (sự kiện/khái niệm)
```

## Cấu trúc dữ liệu (`data/knowledge-map.json`)

```json
{
  "meta": { "title": "...", "note": "...", "lastUpdated": "..." },
  "categories": [
    { "id": "philosophy", "name": "Triết học", "color": "#7e57c2" }
  ],
  "nodes": [
    {
      "id": "p-rationalism",
      "name": "Chủ nghĩa Duy lý",
      "category": "philosophy",
      "year": 1637,
      "period": "1637 CN (Descartes)",
      "description": "...",
      "origins": ["p-scholasticism"]
    }
  ]
}
```

- `id`: duy nhất, dùng để tham chiếu trong `origins` của các node khác.
- `year`: số âm = trước Công nguyên (TCN). Dùng để tính vị trí trên trục thời gian.
- `origins`: danh sách `id` của các node mà node này bắt nguồn từ / chịu ảnh hưởng
  trực tiếp. Để trống `[]` nếu được xem là một điểm khởi đầu độc lập.

## Cách thêm/sửa nội dung vĩnh viễn

Trang này là **tĩnh** (chạy trên GitHub Pages, không có backend/database), nên:

1. **Qua giao diện (tạm thời):** bấm "+ Thêm sự kiện" để thêm node mới — lưu trong
   `localStorage` của trình duyệt, chỉ bạn thấy, chỉ trên máy/trình duyệt đó.
2. **Lưu vĩnh viễn & chia sẻ cho mọi người:** bấm "Xuất dữ liệu" để lấy bản JSON đầy
   đủ (gồm cả node bạn vừa thêm), sau đó thay thế nội dung file
   `data/knowledge-map.json` trong repo và commit/push lên GitHub. Lần sau mọi người
   mở trang đều thấy node mới.
3. **Sửa trực tiếp:** vì đây chỉ là 1 file JSON, bạn (hoặc Claude trong các phiên sau)
   có thể sửa/mở rộng trực tiếp bằng tay — không cần qua giao diện.

## Chạy thử cục bộ

Vì trang dùng `fetch()` để tải file JSON, cần chạy qua một HTTP server (mở trực tiếp
file `index.html` bằng `file://` sẽ bị chặn bởi CORS ở một số trình duyệt):

```bash
cd knowledge-map
python3 -m http.server 8080
# mở http://localhost:8080
```

## Deploy lên GitHub Pages

1. Push toàn bộ thư mục này lên một repo GitHub.
2. Vào **Settings → Pages** của repo → chọn branch `main`, thư mục `/ (root)`.
3. Sau vài phút, trang sẽ có địa chỉ dạng `https://<username>.github.io/<repo>/`.

## Hướng phát triển tiếp theo (gợi ý)

- Thêm nhiều mốc chi tiết hơn trong từng lĩnh vực (hiện tại mới là khung tổng quan).
- Thêm nguồn tham khảo (link) cho từng node để kiểm chứng.
- Thêm chế độ "so sánh 2 node" để xem điểm giao của chuỗi nguồn gốc.
- Cải thiện thuật toán chống chồng lấp node khi số lượng node tăng lên nhiều.
