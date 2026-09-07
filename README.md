# ApproveOnMSTeam — technical feasibility spike

Chứng minh khả thi kỹ thuật cho ý tưởng: khi có task phê duyệt đến, user nhận
được tin nhắn trên **Microsoft Teams** kèm nút **Đồng ý / Từ chối / Huỷ**;
bấm nút trên Teams sẽ gọi ngược lại logic của BPM giống hệt như user đang
thao tác trên màn hình BPM thật — không cần login vào BPM.

Không có BPM thật ở đây. Repo này tự dựng:
- **Mock BPM** (Express + 1 màn hình HTML) — giả lập 1 workflow 1 bước, 1
  assignee cố định (`approver@cmctssg.space`).
- **Teams Bot** (Bot Framework SDK for Node.js) — gửi Adaptive Card chủ động
  (proactive message) khi có task mới, nhận lại lựa chọn của user và gọi
  cùng một action endpoint mà màn hình BPM dùng.

Cả hai chiều đều đi qua **một** action endpoint duy nhất
(`POST /bpm/tasks/:id/actions`), nên trạng thái trên màn hình BPM và trên
Teams card không bao giờ lệch nhau — dù bấm ở đâu trước.

```
[Mock BPM] --task mới--> [taskStore event] --> [Teams Bot] --proactive--> [Teams card]
     ^                                                                          |
     |                                    user bấm Đồng ý/Từ chối/Huỷ          |
     +---------------- POST /bpm/tasks/:id/actions <-------------------------- +
     |
     +--(nếu quyết định từ màn hình BPM)--> update lại Teams card tương ứng
```

## Cấu trúc

```
src/
  server.ts              express app: mount BPM routes + bot /api/messages
  config.ts               đọc .env
  bpm/
    store.ts               in-memory task store, single action endpoint dùng chung
    routes.ts               REST API cho task
  bot/
    adapter.ts               CloudAdapter (Bot Framework auth)
    activityHandler.ts        xử lý tin nhắn/nút bấm từ Teams
    cards.ts                  Adaptive Card builders
    conversationStore.ts      lưu conversation reference để gửi proactive
    cardActivityStore.ts      nhớ activityId của card đã gửi để update lại được
    proactive.ts               gửi/):update card chủ động
  email/
    imapListener.ts            (tuỳ chọn) poll hộp thư IMAP, tạo task từ email khớp điều kiện
    state.ts                    nhớ UID email đã xử lý, không đọc lại từ đầu mỗi lần restart
public/index.html          màn hình BPM giả lập
public/my-tasks.html       Teams personal tab — list + detail từng task
teams-app/manifest.json    Teams app manifest (sideload)
scripts/trigger-task.ts    giả lập "task đến"
scripts/generate-icons.js  sinh icon PNG cho manifest
```

## Vì sao cần đăng ký Bot trên Azure (không có cách nào đơn giản hơn)

Nút bấm trong Adaptive Card gửi trong chat 1:1 của Teams chỉ hoạt động qua
cơ chế **Bot Framework**: Teams gửi activity đến messaging endpoint của bot,
bot xử lý và có thể chủ động (proactive) gửi/sửa tin nhắn sau đó. Không có
cách nào push tin nhắn tương tác vào Teams của 1 user cụ thể mà không có bot
đăng ký + App ID/secret trên Entra ID. Đây là lý do bắt buộc phải làm bước
Azure Bot registration bên dưới dù chỉ để test khả thi.

## Setup (dùng tenant sandbox cá nhân — KHÔNG đụng vào tenant CMC thật)

### 0. Chuẩn bị
- Node.js >= 18 (máy đang có v25, OK).
- Một công cụ tunnel HTTPS: `ngrok` (`brew install ngrok`) hoặc Azure Dev
  Tunnels CLI (`devtunnel`). Máy hiện chưa có ngrok — cài 1 trong 2.

### 1. Tạo tenant sandbox miễn phí

**Cách A — Microsoft 365 Developer Program (thử trước, có thể bị từ chối):**
1. Vào https://developer.microsoft.com/microsoft-365/dev-program, đăng ký
   bằng tài khoản cá nhân (không dùng email CMC).
2. Chọn "Instant sandbox" → nhận 1 tenant `xxxx.onmicrosoft.com` có sẵn
   Teams, Exchange, user test, và 1 tài khoản Global Admin.

> ⚠️ Từ 2025, Microsoft đã siết điều kiện chương trình này — chỉ ưu tiên
> người có **Visual Studio Professional/Enterprise subscription đang
> active** hoặc thành viên **Microsoft AI Cloud Partner Program**. Tài
> khoản cá nhân mới thường bị từ chối với thông báo *"You don't currently
> qualify for a Microsoft 365 Developer Program sandbox subscription"* —
> nếu gặp lỗi này, dùng Cách B bên dưới, không cần debug tiếp Cách A.

**Cách B — Dùng thử Microsoft 365 Business (khuyến nghị, luôn dùng được):**
1. Vào https://www.microsoft.com/vi-vn/microsoft-365/business/compare-all-microsoft-365-business-products
   → chọn **Business Standard** (hoặc Premium) → "Dùng thử miễn phí".
2. Đăng ký bằng tài khoản cá nhân (không dùng email CMC) → tạo tổ chức mới
   `<tên>.onmicrosoft.com`, bạn thành Global Admin. Đây là gói dùng thử
   thương mại thông thường (không qua cổng xét duyệt Developer Program) nên
   không bị chặn bởi điều kiện ở Cách A — có thể được yêu cầu thẻ tín dụng
   để xác minh tuỳ khu vực, có thể huỷ trước khi hết hạn dùng thử.

Dù chọn cách nào, kết quả cần có là: 1 tenant `xxxx.onmicrosoft.com` +
Teams + 1 tài khoản Global Admin. Đăng nhập https://portal.azure.com bằng
tài khoản Global Admin đó — tenant này cũng dùng được để tạo Azure resource
(cần gắn 1 subscription free/trial nếu portal yêu cầu).

### 2. Tạo Azure Bot resource + App registration
1. Trong Azure Portal → "Create a resource" → tìm **Azure Bot**.
2. Điền: Bot handle (vd `approve-on-msteam-spike`), Subscription, Resource
   group mới, **Type of App = Single Tenant**, **Creation type = Create new
   Microsoft App ID** → Create.
3. Sau khi tạo xong, vào resource vừa tạo → **Configuration**:
   - Copy **Microsoft App ID** → `MicrosoftAppId` trong `.env`.
   - Bấm **Manage password** (link tới App registration) → **Certificates &
     secrets** → New client secret → copy **Value** ngay (chỉ hiện 1 lần) →
     `MicrosoftAppPassword` trong `.env`.
4. Vào Entra ID (Azure AD) → Overview → copy **Tenant ID** →
   `MicrosoftAppTenantId` trong `.env`.
5. Đặt `MicrosoftAppType=SingleTenant` trong `.env`.
6. Trong Azure Bot resource → **Channels** → Add **Microsoft Teams** channel.

### 3. Cấu hình project
```bash
npm install
cp .env.example .env   # rồi điền 4 giá trị Microsoft* ở bước 2
node scripts/generate-icons.js   # đã chạy sẵn, chỉ cần nếu muốn đổi icon
```

### 4. Mở tunnel và trỏ messaging endpoint
```bash
npm run dev            # chạy server ở :3978
ngrok http 3978         # ở terminal khác, copy https URL, vd https://abcd.ngrok-free.app
```
Quay lại Azure Bot resource → **Configuration** → **Messaging endpoint** =
`https://<tunnel-domain>/api/messages` → Save.

### 5. Đóng gói và sideload Teams app
1. Mở `teams-app/manifest.json`, thay cả 2 chỗ
   `REPLACE_WITH_AZURE_AD_APP_ID` bằng Microsoft App ID ở bước 2.
2. Zip đúng 3 file (không có thư mục cha bên trong zip):
   ```bash
   cd teams-app && zip -r ../approve-on-msteam.zip manifest.json color.png outline.png && cd ..
   ```
3. Trong Teams (web/desktop) đăng nhập bằng user test của tenant sandbox →
   **Apps** → **Manage your apps** → **Upload an app** → **Upload a custom
   app** → chọn `approve-on-msteam.zip`.
   (Sideloading mặc định được bật trên tenant M365 Dev Program.)
4. Mở app vừa cài (chat 1:1 với bot) → gõ bất kỳ tin nhắn nào (vd "hi") để
   bot ghi nhận conversation reference — bắt buộc, vì server chỉ gửi được
   tin nhắn chủ động sau khi đã có địa chỉ hội thoại này.
5. Trong `.env`, đặt `ASSIGNEE_EMAIL` trùng với UPN của user test bạn vừa
   dùng để chat với bot (không nhất thiết phải là `approver@cmctssg.space` khi
   test trên sandbox — restart `npm run dev` sau khi đổi).

### 6. Chạy thử end-to-end
```bash
# terminal khác, server đang chạy npm run dev
npm run trigger -- "Đề nghị thanh toán 10,000,000đ" "Nguyễn Văn A"
```
- Card xuất hiện trong Teams trong vài giây.
- Bấm **Đồng ý** trên Teams → card cập nhật ngay tại chỗ, hết nút bấm.
- Mở http://localhost:3978/ → task hiện `APPROVED`, "via MS_TEAMS" —
  chứng minh nút Teams đã gọi đúng logic BPM.
- Tạo task khác, lần này bấm **Đồng ý** trên màn hình BPM (localhost) trước
  → quay lại Teams → card cũng tự cập nhật thành "Đã đồng ý" — chứng minh
  2 chiều luôn đồng bộ vì dùng chung 1 action endpoint.

## 7. (Tuỳ chọn) Tạo task từ email

Ngoài tạo task qua form trên màn hình BPM, server có thể tự tạo task khi có
email khớp điều kiện gửi tới 1 hộp thư bạn chỉ định — dùng để mô phỏng
"yêu cầu phê duyệt gửi qua email" mà không cần tích hợp gì thêm phía người
gửi. Tính năng này **mặc định tắt** — chỉ bật khi điền `MAILBOX_USER` trong
`.env`.

### Cách hoạt động
- Server dùng **IMAP** kết nối vào 1 hộp thư (không phải SMTP nhận trực
  tiếp), quét hộp thư mỗi `MAILBOX_POLL_INTERVAL_MS` (mặc định 10 giây) tìm
  email mới.
- Chỉ tạo task khi **cả 2 điều kiện** đều đúng: người gửi (From) nằm trong
  `EMAIL_ALLOWED_SENDERS`, **và** Subject khớp **chính xác** với
  `EMAIL_TASK_SUBJECT`. Email không khớp bị bỏ qua, không đánh dấu đã đọc,
  không xoá — hộp thư giữ nguyên trạng thái.
- Với email khớp: server lưu nguyên văn email gốc (**định dạng `.eml`** —
  file MIME chuẩn chứa cả header, nội dung, và toàn bộ file đính kèm mã hoá
  base64 ngay bên trong) vào `data/emails/`, KHÔNG tách file đính kèm ra
  riêng. Nội dung text của email trở thành `detail` của task (hiện ở màn
  hình chi tiết); Subject trở thành `title`.
- Trên màn hình BPM và tab "My Tasks", task tạo từ email có thêm link
  **"📎 Xem email gốc (.eml)"** — bấm vào sẽ tải file `.eml` đó về, mở bằng
  ứng dụng mail mặc định của máy (Outlook, Apple Mail...) sẽ thấy đầy đủ nội
  dung **và** file đính kèm gốc, vì chúng vẫn nằm nguyên trong file — không
  cần server tự dựng UI xem file đính kèm.
- Nếu người gửi **có trong** `EMAIL_ALLOWED_SENDERS` nhưng Subject **sai**,
  server tự động **reply lại** email đó với nội dung cố định
  `"Subject không đúng, hãy kiểm tra lại"` (không tạo task). Chỉ áp dụng cho
  người gửi đã được tin tưởng — email từ người lạ bị bỏ qua hoàn toàn, không
  reply, để tránh xác nhận ngược "hộp thư này đang được xử lý tự động" cho
  bất kỳ ai gửi email tới.

> Vì sao `.eml` chứ không phải `.pst`: `.pst` là định dạng **cả 1 hộp thư**
> (nhiều email đóng gói chung, dạng nhị phân độc quyền của Outlook, không có
> thư viện Node.js nào ghi `.pst` đáng tin cậy). `.eml` là chuẩn mở, **1 file
> = 1 email**, mọi ứng dụng mail đều mở được, và tự nhiên đã bao gồm file
> đính kèm — đúng nhu cầu ở đây.

### Cách A — Gmail (Basic Auth, đơn giản)
1. Bật xác minh 2 bước (2-Step Verification) cho tài khoản Gmail sẽ dùng làm
   hộp thư nhận — bắt buộc phải bật trước thì mới thấy được mục App password.
2. Vào https://myaccount.google.com/apppasswords → tạo 1 App Password mới
   (đặt tên bất kỳ, vd "ApproveOnMSTeam") → copy chuỗi 16 ký tự hiện ra.
   **Lưu ý**: mật khẩu Gmail thường của bạn **không dùng được** cho IMAP,
   bắt buộc phải là App Password.
3. Điền vào `.env`:
   ```
   MAILBOX_HOST=imap.gmail.com
   MAILBOX_AUTH_MODE=basic
   MAILBOX_USER=<email nhận>@gmail.com
   MAILBOX_PASSWORD=<app password 16 ký tự, không có dấu cách>
   EMAIL_TASK_SUBJECT=Tạo task mới cho mockBPM
   EMAIL_ALLOWED_SENDERS=dinhquangduonghuy@gmail.com
   ```
4. Restart `npm run dev` → log sẽ hiện `[email] Đã kết nối IMAP (basic) tới
   imap.gmail.com (...)`.

### Cách B — Microsoft 365 / Outlook (Exchange Online, bắt buộc dùng OAuth2)

⚠️ Exchange Online đã **tắt Basic Authentication cho IMAP** — không có cách
nào dùng "username + password" như Gmail. Cách duy nhất còn hoạt động là
**OAuth2 Client Credentials** (app tự xin token bằng App Id/secret, không
cần ai đăng nhập) — phức tạp hơn Gmail đáng kể, cần cả thao tác trên Azure
Portal lẫn PowerShell. Có thể tái dùng chính App Registration của Bot
(`MicrosoftAppId`/`Password`/`TenantId` đã có sẵn trong `.env`) thay vì tạo
app mới.

1. **Thêm quyền IMAP cho App Registration của Bot**: vào Entra ID → App
   registrations → mở đúng app đã dùng cho Azure Bot → **API permissions**
   → **Add a permission** → tab **APIs my organization uses** → tìm
   **"Office 365 Exchange Online"** → **Application permissions** → chọn
   **`IMAP.AccessAsApp`** → Add permissions.
2. Vẫn ở trang **API permissions** → bấm **"Grant admin consent for
   \<tenant\>"** (cần tài khoản Global Admin — đúng tài khoản bạn đang dùng).
3. **Đăng ký service principal trong Exchange** — mở PowerShell, cài
   module quản trị Exchange Online (chỉ cần làm 1 lần):
   ```powershell
   Install-Module -Name ExchangeOnlineManagement
   Import-Module ExchangeOnlineManagement
   Connect-ExchangeOnline -Organization <tên-tenant>.onmicrosoft.com
   ```
4. Lấy đúng **Object ID của Enterprise Application** (⚠️ không phải Object
   ID ở trang App registration — vào Entra ID → **Enterprise applications**
   → tìm đúng app → copy Object ID ở trang Overview), rồi đăng ký:
   ```powershell
   New-ServicePrincipal -AppId <MicrosoftAppId> -ObjectId <ENTERPRISE_APP_OBJECT_ID>
   ```
5. **Cấp quyền truy cập đúng hộp thư** sẽ dùng làm `MAILBOX_USER` (vd hộp
   thư của chính bạn trong tenant sandbox), để **nhận** (đọc) mail:
   ```powershell
   $sp = Get-ServicePrincipal | Where-Object { $_.AppId -eq "<MicrosoftAppId>" }
   Add-MailboxPermission -Identity "<mailbox>@<tenant>.onmicrosoft.com" -User $sp.Identity -AccessRights FullAccess
   ```
   ⚠️ Quyền vừa cấp cần **15-60 phút để đồng bộ** trước khi dùng được — đây
   không phải lỗi cấu hình, chỉ là cần đợi.
6. Điền vào `.env` (để trống `MAILBOX_OAUTH_*` để tái dùng
   `MicrosoftAppId`/`Password`/`TenantId` đã có sẵn):
   ```
   MAILBOX_HOST=outlook.office365.com
   MAILBOX_AUTH_MODE=oauth2
   MAILBOX_USER=<mailbox>@<tenant>.onmicrosoft.com
   EMAIL_TASK_SUBJECT=Tạo task mới cho mockBPM
   EMAIL_ALLOWED_SENDERS=dinhquangduonghuy@gmail.com
   ```
7. Restart `npm run dev` → log sẽ hiện `[email] Đã kết nối IMAP (oauth2) tới
   outlook.office365.com (...)`. Nếu lỗi xác thực, khả năng cao nhất là bước
   3-4 (Object ID nhầm giữa App Registration và Enterprise Application) —
   đây là lỗi phổ biến nhất theo tài liệu Microsoft.

**Nếu muốn dùng tính năng auto-reply "Subject không đúng"** — cần thêm quyền
**gửi** mail, tách biệt hoàn toàn với quyền đọc ở trên:

8. Vào lại **API permissions** của App Registration → **Add a permission**
   → **APIs my organization uses** → **"Office 365 Exchange Online"** →
   **Application permissions** → chọn thêm **`SMTP.SendAsApp`** → Add
   permissions → bấm lại **"Grant admin consent"**.
9. Cấp quyền **SendAs** (khác với `FullAccess` ở bước 5 — bắt buộc phải có
   thêm quyền riêng này để gửi mail *dưới danh nghĩa* hộp thư đó):
   ```powershell
   Add-RecipientPermission -Identity "<mailbox>@<tenant>.onmicrosoft.com" -AccessRights SendAs -Trustee $sp.Identity -Confirm:$false
   ```
   (dùng lại biến `$sp` từ bước 5 — nếu phiên PowerShell đã đóng, chạy lại
   dòng `$sp = Get-ServicePrincipal | Where-Object {...}` trước.)
10. Thêm vào `.env`:
    ```
    MAILBOX_SMTP_HOST=smtp.office365.com
    MAILBOX_SMTP_PORT=587
    ```
11. Restart server, gửi thử 1 email từ địa chỉ trong `EMAIL_ALLOWED_SENDERS`
    nhưng Subject **sai** — trong vòng `MAILBOX_POLL_INTERVAL_MS` sẽ nhận
    được reply tự động. Quyền `SendAs` cũng cần thời gian đồng bộ như bước 5.

### Test chung cho cả 2 cách
Từ địa chỉ nằm trong `EMAIL_ALLOWED_SENDERS`, gửi 1 email tới hộp thư ở
`MAILBOX_USER`, Subject đúng **chính xác** `Tạo task mới cho mockBPM`, đính
kèm 1 file bất kỳ để test. Trong vòng `MAILBOX_POLL_INTERVAL_MS`, task mới
sẽ tự xuất hiện trên màn hình BPM và trên Teams.

> Dùng 1 hộp thư **riêng, chuyên dụng** cho việc này — đừng dùng hộp thư cá
> nhân bạn vẫn nhận email hàng ngày. Listener chỉ đọc, không sửa/xoá gì cả,
> nhưng đây vẫn là bản spike, chưa được kiểm thử kỹ như một hệ thống xử lý
> hộp thư thật.

## 8. (Tuỳ chọn) Đọc email qua Microsoft Graph webhook thay vì IMAP

Đây là 1 cách khác để làm đúng việc "tạo task từ email" ở mục 7, **chỉ áp
dụng được cho hộp thư Microsoft 365** — đổi lại đơn giản hơn IMAP đáng kể vì
bỏ qua được toàn bộ phần PowerShell/Exchange (`New-ServicePrincipal`,
`Add-MailboxPermission`...). Không thay thế mục 7, mà là 1 lựa chọn song
song — bật cái nào thì tắt cái kia qua `EMAIL_INTAKE_MODE`.

### Khác biệt cốt lõi
- **IMAP (mục 7)** = trợ lý tự đi kiểm tra hộp thư mỗi 10 giây (polling).
- **Graph webhook (mục này)** = Microsoft **tự gọi vào server** ngay khi có
  thư mới (push) — nhanh hơn, không cần đoán chu kỳ poll bao lâu là đủ.
- Quyền cần xin cũng khác hẳn: IMAP dùng quyền cũ riêng của Exchange
  (`IMAP.AccessAsApp`, phải đăng ký thêm qua Exchange PowerShell). Graph
  dùng quyền **Microsoft Graph** hiện đại (`Mail.Read`) — chỉ cần xin quyền
  + admin consent trên Entra ID, **không cần bước PowerShell nào cả**.

### Setup
1. Entra ID → App registrations → mở đúng app đã dùng cho Bot → **API
   permissions** → **Add a permission** → lần này chọn tab **"Microsoft
   Graph"** (không phải "APIs my organization uses" như IMAP) →
   **Application permissions** → tìm **`Mail.Read`** → Add permissions.
2. Bấm **"Grant admin consent"**.
3. Điền vào `.env`:
   ```
   EMAIL_INTAKE_MODE=graph
   GRAPH_NOTIFICATION_URL=https://<domain-ngrok-hiện-tại>/graph/notifications
   GRAPH_CLIENT_STATE=<tự đặt 1 chuỗi bí mật bất kỳ>
   ```
   `GRAPH_NOTIFICATION_URL` phải trùng đúng domain ngrok đang chạy — đổi
   ngrok thì phải sửa lại giá trị này (giống messaging endpoint của Bot).
4. Restart `npm run dev` → log sẽ hiện `[graph] Đã tạo subscription ...`.
5. Test giống mục 7 — gửi email đúng điều kiện, lần này task sẽ xuất hiện
   **gần như ngay lập tức** thay vì chờ tới vòng poll tiếp theo.

### Cách hoạt động (`src/email/graphWebhook.ts`)
- Khi tạo "đăng ký lắng nghe" (subscription), Microsoft gọi ngay vào
  `notificationUrl` kèm `?validationToken=...` để xác minh server có thật —
  `handleValidation()` chỉ việc trả nguyên token đó lại dạng text thuần
  trong vòng 10 giây.
- Mỗi khi có thư mới, Microsoft `POST` vào cùng URL đó kèm `clientState` (so
  khớp với giá trị đã đặt, để chắc chắn đúng là Microsoft gọi tới, không
  phải ai đó giả mạo) và **chỉ 1 cái ID** của email — không kèm nội dung.
  `processMessage()` dùng ID đó gọi lại Graph API lấy nội dung + file gốc
  (`.eml`, cùng cách giữ nguyên file đính kèm như mục 7), rồi áp đúng bộ lọc
  người gửi + Subject y hệt IMAP.
- Đăng ký lắng nghe chỉ sống tối đa 7 ngày (giới hạn của Microsoft) — code
  tự gia hạn mỗi 12 tiếng, đặt hạn 2 ngày/lần để không rủi ro hết hạn.

### Giới hạn của bản demo này
- Chưa dùng tính năng auto-reply "Subject không đúng" ở nhánh này (chỉ demo
  phần đọc, đúng như yêu cầu ban đầu) — muốn thêm thì gọi Graph
  `POST /users/{id}/messages/{id}/reply` (cần thêm quyền `Mail.Send`, cũng
  đơn giản hơn hẳn so với `SMTP.SendAsApp` + `Add-RecipientPermission` ở
  mục 7).
- Quyền `Mail.Read` ở dạng Application hiện đang cho phép đọc **mọi hộp
  thư trong tenant**, không riêng `MAILBOX_USER` — production nên thu hẹp
  lại bằng **Application Access Policy** (PowerShell, khái niệm tương tự
  nhưng dành riêng cho Graph, khác với Exchange service principal ở mục 7).

## Giới hạn cố ý của bản spike (không phải thiếu sót)
- Chỉ 1 assignee cố định, không có xác thực/authorization thật.
- Conversation reference lưu file JSON local, không mã hoá — chỉ để demo.
- Không xử lý trường hợp nhiều thiết bị/nhiều cuộc hội thoại cho cùng 1 user.
- Không có retry/queue khi gửi proactive message thất bại.
- Email-to-task dùng polling (10 giây/lần), không phải push realtime (IMAP
  IDLE hoặc Microsoft Graph webhook) — đủ cho demo, không phù hợp production.

Xem `PRODUCTION-CHECKLIST.md` để biết cần chuẩn bị gì nếu triển khai thật
trong tenant CMC.
