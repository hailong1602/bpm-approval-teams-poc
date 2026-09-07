**Subject:** Đề xuất trao đổi kỹ thuật & bàn giao triển khai — Giải pháp phê duyệt BPM ngay trên Microsoft Teams

---

Kính gửi Anh/Chị [Tên người nhận bên CMC],

Bên em (OCB) vừa hoàn tất một bản thử nghiệm kỹ thuật (technical spike) chứng minh khả thi cho ý tưởng: cho phép người phê duyệt xử lý task BPM (Đồng ý / Từ chối / Huỷ) trực tiếp trên Microsoft Teams, không cần đăng nhập vào hệ thống BPM. Do hạn chế về nguồn lực triển khai, bên em muốn trao đổi để CMC tiếp nhận và triển khai thực tế phần này. Em xin tóm tắt lại yêu cầu, giải pháp đã thử nghiệm, và những phần cần CMC tư vấn/thực hiện tiếp theo bên dưới.

## 1. Yêu cầu ban đầu

Hiện tại, mỗi khi có task phê duyệt đến, người xử lý phải: nhận email → đăng nhập vào BPM (web-based) → thao tác trên màn hình mới xử lý được, kể cả với các yêu cầu rất đơn giản. Mục tiêu là để người phê duyệt nhận được thông báo ngay trên Microsoft Teams, có nút bấm Đồng ý / Từ chối / Huỷ, và khi bấm sẽ tự động gọi ngược lại BPM để thực hiện đúng logic như đang thao tác trên màn hình BPM thật.

## 2. Giải pháp đã thử nghiệm và kết quả

Bên em đã dựng một bản spike đầy đủ (dùng tenant Microsoft 365 sandbox riêng, không đụng vào hệ thống production của OCB) để kiểm chứng cơ chế kỹ thuật, gồm:

- **Bot đăng ký qua Azure Bot Service (Bot Framework)**, gửi **Adaptive Card** (thẻ có nút bấm) chủ động vào Teams của người phê duyệt ngay khi có task mới.
- Khi người dùng bấm nút trên thẻ, Teams gọi ngược về server qua **Bot Connector Service** của Microsoft, server xử lý và gọi vào **đúng 1 action endpoint duy nhất** của BPM (giống hệt endpoint mà màn hình BPM thật gọi khi user bấm nút tại đó) — đảm bảo trạng thái trên Teams và trên BPM luôn khớp nhau, không có 2 luồng logic tách biệt.
- Bổ sung thêm 1 **tab "My Tasks"** ngay trong app Teams đó — hiển thị danh sách các task đang chờ (dạng list, bấm vào từng dòng xem chi tiết đầy đủ nội dung tham khảo), có thể Đồng ý/Từ chối/Huỷ ngay từ cả 2 màn (list và chi tiết) — dùng cho trường hợp một người có nhiều task cùng lúc, không chỉ nhận thông báo rời rạc qua chat.
- Đã demo thành công đầy đủ 2 chiều: bấm trên Teams → BPM cập nhật đúng; bấm trên BPM → thẻ/tab trên Teams tự đồng bộ lại, không lệch trạng thái.
- Có tìm hiểu thêm phương án dùng **Approvals app** có sẵn của Microsoft 365 (qua Microsoft Graph API) làm nơi tổng hợp task thay vì tự xây tab riêng — tuy nhiên API này hiện chỉ hỗ trợ **delegated permission** (bắt buộc có người đăng nhập, không gọi được từ hệ thống backend như BPM) và vẫn đang ở dạng **beta**, nên tạm thời chưa phù hợp để dùng ngay; phương án tab tự xây (dùng lại API sẵn có của BPM) đang là hướng khả thi hơn ở giai đoạn này.

**Lưu ý quan trọng**: đây là bản spike chạy trên tenant cá nhân/sandbox, dùng 1 hệ thống BPM giả lập (mock) để kiểm chứng cơ chế — **chưa kết nối với BPM thật hay tenant Microsoft 365 chính thức của OCB**.

## 3. Các vấn đề/vướng mắc còn lại khi triển khai thật

- **Hạ tầng Azure**: cần Resource Group, Azure Bot resource riêng cho từng môi trường (dev/UAT/prod), nơi host backend (App Service/AKS/VM theo chuẩn OCB), Key Vault lưu secret — chưa xác định ai/nhóm nào sẽ đứng ra tạo và vận hành.
- **App Registration trên Entra ID**: cần người có quyền Application Administrator trên tenant OCB thật đứng ra tạo; nên cân nhắc dùng certificate/federated credential thay vì client secret cho production.
- **Rollout cho nhiều người dùng**: với 1 người test thì tự cài app thủ công là đủ, nhưng với quy mô nhiều approver cần Teams Administrator duyệt app vào catalog nội bộ + chính sách cài đặt tự động (App setup policy), và cân nhắc dùng Microsoft Graph API để tự động cài app cho user thay vì bắt từng người tự thao tác.
- **Networking/Firewall**: đường kết nối giữa backend (nếu đặt on-premise hoặc Azure) với Bot Connector Service của Microsoft cần được đội hạ tầng/an ninh mạng OCB duyệt trước — có thể cân nhắc dùng ExpressRoute nếu OCB đã có sẵn cho các workload Azure khác.
- **Phân loại dữ liệu & Compliance**: cần Info Sec/Compliance duyệt trước những trường dữ liệu nào được phép hiển thị ra ngoài (trên Teams) và xác nhận mô hình định danh qua Teams có được công nhận tương đương với đăng nhập BPM hiện tại hay không (non-repudiation).
- **Độ tin cậy**: bản spike chưa có cơ chế thử lại khi gửi thông báo thất bại, chưa có job đối soát định kỳ giữa trạng thái BPM và Teams — cần thiết kế thêm cho production.
- **Tích hợp với BPM thật**: BPM cần bổ sung (nếu chưa có) — (1) 1 API/webhook để gọi thông báo cho bot khi có task mới, (2) 1 API cho phép approve/reject/cancel bằng lệnh gọi (không chỉ qua UI), (3) tuỳ chọn 1 webhook để đồng bộ ngược khi task được xử lý ngay trên UI BPM thật.

## 4. Đề xuất phần CMC tư vấn/thực hiện

- Tư vấn kiến trúc hạ tầng phù hợp chuẩn triển khai của OCB (hosting, networking, bảo mật) cho phần backend bot.
- Làm việc cùng đội BPM để thiết kế và xây dựng các API/webhook tích hợp 2 chiều nêu ở mục 3.
- Hỗ trợ làm việc với đội Teams Admin/Entra ID của OCB để xin cấp quyền, cấu hình rollout cho nhiều người dùng.
- Phối hợp cùng Info Sec/Compliance OCB để hoàn thiện các câu hỏi về phân loại dữ liệu và non-repudiation.
- Lên kế hoạch, timeline và triển khai thực tế (kể cả việc củng cố lại phần "độ tin cậy" mà bản spike chưa có).

## 5. Đề xuất lịch trao đổi

Em đề xuất một buổi trao đổi online vào **chiều thứ Ba, ngày 11/08/2026**, để đi sâu hơn vào phần kỹ thuật và thống nhất phạm vi/kế hoạch triển khai. Nếu thời gian này chưa thuận tiện, Anh/Chị vui lòng đề xuất ngày giờ khác phù hợp bên CMC, em sẽ sắp xếp theo.

Em có thể gửi kèm tài liệu kỹ thuật chi tiết hơn (kiến trúc, sơ đồ luồng, checklist các hạng mục cần chuẩn bị) trước buổi họp nếu Anh/Chị cần tham khảo trước.

Rất mong sớm nhận được phản hồi từ Anh/Chị.

Trân trọng,

[Họ tên]
[Chức danh]
[Đơn vị — OCB]
[Email/SĐT liên hệ]
