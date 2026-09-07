# Những gì cần chuẩn bị nếu triển khai thật trong tenant CMC

Tài liệu này liệt kê những gì spike này **cố tình bỏ qua** vì đang chạy trên
tenant sandbox cá nhân, nhưng **bắt buộc phải có** nếu triển khai cho user
thật trong tenant CMC. Dùng để báo trước cho đội infrastructure/security
chuẩn bị, không phải để tự làm ngay.

## 1. Tài nguyên Azure cần tạo (đội hạ tầng / Azure admin)
- 1 **Resource Group** riêng cho service này (theo naming convention của CMC).
- 1 **Azure Bot resource** (Bot Framework registration), Type = Single
  Tenant, gắn với tenant Entra ID của CMC — *không* dùng chung app
  registration giữa các môi trường dev/UAT/prod.
- Hosting cho backend bot (App Service / AKS / VM tuỳ chuẩn CMC đang dùng),
  có HTTPS endpoint public hoặc qua Private Endpoint (xem mục 4).
- **Azure Key Vault** để lưu client secret/certificate của App registration
  — không hardcode trong file `.env` như bản spike này.

## 2. Entra ID (Azure AD) App Registration
- Cần người có role **Application Administrator** (hoặc tương đương) trên
  tenant CMC để tạo App registration — thường không phải là quyền mặc định
  của developer, cần xin cấp riêng hoặc nhờ IT tạo hộ.
- **Khuyến nghị**: dùng certificate hoặc federated credential (workload
  identity) thay vì client secret — secret hết hạn phải tự tay renew và dễ
  bị rò rỉ nếu commit nhầm; đây là điểm khác với bản spike (đang dùng secret
  cho đơn giản).

## 3. Teams Admin Center — bắt buộc có Teams Administrator
Đây là phần hay bị đánh giá thấp nhưng **chặn cứng** việc rollout cho nhiều
user (không chỉ 1 user như spike này):
- Bật/duyệt cho phép **upload custom app** hoặc (khuyến nghị cho production)
  **publish app vào catalog nội bộ** của CMC qua Teams Admin Center →
  Manage apps → Upload.
- Tạo **App setup policy** gán app này cho nhóm user là BPM approver, để
  app **tự cài sẵn** cho họ — nếu không, mỗi user phải tự sideload thủ công
  như trong hướng dẫn README (chỉ chấp nhận được với 1 user test, không
  chấp nhận được với production).
- Xác nhận **App permission policy** không chặn custom/LOB app cho nhóm user
  liên quan.

## 4. Cài app tự động cho nhiều user (thay vì tự sideload)
Với 1 user, cách "tự mở chat với bot 1 lần" trong README chấp nhận được.
Với production (hàng chục/hàng trăm BPM approver), cần:
- Microsoft Graph **application permission**
  `TeamsAppInstallation.ReadWriteForUser.All` (cần **admin consent** từ
  Global/Privileged Role Admin của CMC) để hệ thống tự động
  `POST /users/{id}/teamworkAppInstallation` cài app cho user khi họ có task
  đầu tiên, không cần user tự thao tác.
- Cần xác định cách map **BPM user (vd `approver@cmctssg.space`)** sang **Entra ID
  object id** — thường qua Graph `/users/{upn}`, cần thêm quyền
  `User.Read.All`.

## 5. Networking / Firewall
- Bot Framework Connector Service gọi vào messaging endpoint của bot qua
  internet công khai theo mặc định. Nếu CMC yêu cầu không public expose:
  Azure Bot hỗ trợ **Network Isolation qua Private Endpoint**, nhưng phức
  tạp hơn và cần review riêng với network team.
  Nếu vẫn public: khoanh vùng bằng bearer token validation (Bot Framework SDK
  tự làm) + WAF phía trước, không tắt xác thực token dù có IP allowlist.

## 6. Phân loại dữ liệu & Compliance (Info Sec / Compliance sign-off)
- Nội dung hiển thị trong Adaptive Card (số tiền, tên khách hàng, chi tiết
  đề nghị) sẽ nằm ngoài phạm vi audit boundary hiện tại của BPM. **Cần Info
  Sec/Compliance duyệt** trước: được phép hiển thị field nào trên Teams,
  field nào phải ẩn/che (vd chỉ hiện mã task, phải mở BPM mới thấy chi
  tiết).
- **Non-repudiation**: hiện tại BPM coi phê duyệt hợp lệ khi user đăng nhập
  qua SSO/BPM session. Phê duyệt qua Teams đổi mô hình định danh sang "AAD
  identity theo Bot Framework activity" — cần Compliance xác nhận đây là
  bằng chứng đủ mạnh để thay thế, và log rõ `decidedVia=MS_TEAMS` +
  Teams AAD object id vào audit trail của BPM (bản spike đã làm mẫu field
  này, cần map đúng chuẩn audit log thật).

## 7. Độ tin cậy (không có trong bản spike)
- Gửi proactive message có thể fail (Teams service lỗi, user rời tenant,
  app bị gỡ...) — cần retry + hàng đợi (Service Bus/Storage Queue), không
  fire-and-forget như spike này.
- Cần job đối soát định kỳ giữa trạng thái BPM và trạng thái card đã gửi
  trên Teams, phòng trường hợp update card thất bại âm thầm (spike chỉ log
  lỗi ra console).
- Rate limit của Bot Framework/Teams khi gửi nhiều tin nhắn cùng lúc (batch
  BPM task lớn) — cần backoff/throttle.

## 8. Môi trường
- Cần **App registration + Azure Bot resource riêng cho từng môi trường**
  (dev/UAT/prod) — không dùng chung App ID giữa các môi trường.
- Teams app manifest (`id`, `botId`) khác nhau theo môi trường, cần quy
  trình publish/version rõ ràng qua catalog nội bộ CMC.

---
**Tóm tắt cần báo trước cho đội infra**: 1 Azure Bot resource + App
registration trên tenant CMC, quyền Teams Administrator để rollout
policy/app catalog, quyền Graph admin consent nếu muốn tự động cài app cho
user, và 1 vòng review Info Sec/Compliance về dữ liệu hiển thị trên Teams +
mô hình non-repudiation.
