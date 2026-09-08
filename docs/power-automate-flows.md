# Power Automate thay cho Bot Framework + email intake

Tài liệu này là bản blueprint để tự dựng 2 flow trong **Power Automate Studio**
(https://make.powerautomate.com), thay cho `src/bot/*` (Azure Bot/Bot Framework)
và `src/email/*` (IMAP polling / Graph webhook). Không có tool nào ở đây tạo được
flow hộ bạn — phần này bạn thao tác thủ công trên Power Automate Studio theo
đúng cấu hình dưới đây; phần code (`src/config.ts`, `src/bpm/routes.ts`,
`src/server.ts`) đã sửa sẵn để khớp 2 flow này.

Backend giữ nguyên vai trò "system of record": mọi quyết định — dù đến từ đâu —
đều đi qua 2 endpoint sẵn có `POST /bpm/tasks` và `POST /bpm/tasks/:id/actions`
(`src/bpm/routes.ts`), không đổi contract.

## Chuẩn bị

- Server phải có 1 **tunnel HTTPS công khai** trỏ vào (ngrok/devtunnel), giống
  hệt yêu cầu tunnel cũ cho `/api/messages` — chỉ khác là giờ tunnel này trỏ vào
  `/bpm/*` thay vì `/api/messages`. Gọi domain này là `{tunnelUrl}` bên dưới.
  ⚠️ ngrok free đổi domain mỗi lần restart — đổi tunnel thì phải sửa lại URL
  trong cả 2 flow.
- `.env` đã có sẵn `BPM_API_KEY` — mọi HTTP action gọi vào
  `POST {tunnelUrl}/bpm/tasks` hoặc `POST {tunnelUrl}/bpm/tasks/:id/actions`
  đều phải kèm header `x-api-key: <giá trị BPM_API_KEY>`, nếu không sẽ nhận
  `401`. Riêng `GET {tunnelUrl}/bpm/tasks/:id` (dùng ở Flow B bước 5) không cần
  header này — route đọc không có `requireApiKey`.
- Dựng **Flow B trước** — vì `POWER_AUTOMATE_TASK_CREATED_URL` trong `.env` cần
  URL do Flow B sinh ra sau khi lưu flow lần đầu.

---

## Thay thế "HTTP" bằng On-premises Data Gateway (nếu tenant chặn action HTTP)

Một số tenant M365 áp **DLP policy** chặn hẳn action **"HTTP"** built-in (rủi ro
gọi ra bất kỳ endpoint nào) — nếu thêm action HTTP mà báo lỗi dạng *"This
action isn't supported... blocked by data loss prevention policy"*, thay các
chỗ dùng HTTP bên dưới (Flow B bước 4/5, Flow A bước 2) bằng 1 **Custom Connector**
cấu hình chạy qua gateway. Traffic khi đó giới hạn trong phạm vi gateway kiểm
soát, không gọi tuỳ ý ra Internet như action "HTTP" thường nên thường không bị
policy đó chặn.

⚠️ Không có action có sẵn tên "HTTP with on-premises data gateway" để chọn
thẳng trong danh sách action — đây **bắt buộc phải qua Custom Connector**,
không có đường tắt nào khác.

Lợi ích phụ: dùng gateway thì **không cần ngrok/tunnel công khai nữa** cho các
chỗ Power Automate gọi vào server — gateway đóng vai trò cầu nối thay tunnel,
và không đổi domain mỗi lần restart như ngrok free (chỉ `POWER_AUTOMATE_TASK_CREATED_URL`
là vẫn cần Power Automate sinh ra bình thường, không liên quan tunnel).

### 1. Cài đặt gateway
1. Tải **On-premises Data Gateway** (bản **Standard**, KHÔNG chọn Personal
   mode) từ https://www.microsoft.com/en-us/download/details.aspx?id=53127,
   cài trên máy đang chạy `npm run dev` (hoặc máy khác cùng mạng LAN có thể
   reach tới server đó).
2. Đăng nhập bằng đúng tài khoản work/school sẽ dùng để tạo Flow A/B trên
   Power Automate.
3. Đặt tên gateway, tạo **Recovery Key** — lưu lại cẩn thận, cần khi cài
   lại/di chuyển gateway sau này.
4. Xác nhận gateway hiện **Online** tại https://make.powerautomate.com →
   **Data** → **Gateways**, dòng "Power Apps, Power Automate" ghi **Ready**.

### 2. Tạo Custom Connector chạy qua gateway
1. https://make.powerautomate.com → đúng Environment đang dùng cho flow →
   **Data** (thanh bên trái) → **Custom connectors** → **+ New custom
   connector** → **Create from blank** → đặt tên vd `BPM Local API`.
2. Tab **General**:
   - **Scheme**: HTTP
   - **Host**: `localhost:3978` nếu gateway cài trên chính máy chạy server;
     nếu gateway ở máy khác trong LAN, dùng IP nội bộ của máy chạy server,
     vd `192.168.1.20:3978`.
   - **Base URL**: `/`
   - Tick **"Connect via on-premises data gateway"**.
3. Tab **Security**: nếu `.env` chưa set `BPM_API_KEY` (mặc định rỗng), chọn
   **No authentication**. Nếu có set, chọn **API Key**, đặt Parameter label
   `x-api-key`, Parameter location **Header** — giá trị thật của key sẽ nhập
   1 lần khi tạo Connection ở bước dưới, không cần gõ lại mỗi flow.
4. Tab **Definition** → **+ New action**, tạo action tương ứng từng endpoint
   đang dùng:
   - Đặt tên vd `PostTaskAction` → **"+ Import from sample"** → Verb `POST`,
     URL `/bpm/tasks/{id}/actions`, Header `Content-Type: application/json`,
     Body mẫu `{"action": "approve", "actor": "test", "source": "MS_TEAMS"}`
     → Import (Power Automate tự nhận `{id}` thành path parameter).
   - Nếu cũng dùng Custom Connector này cho Flow A: thêm action
     `PostTaskCreated` → Verb `POST`, URL `/bpm/tasks`, Body mẫu
     `{"title": "x", "requester": "x", "detail": "x"}` → Import.
   - Nếu cũng dùng Custom Connector này cho Flow B bước 5 (đọc task khi 409):
     thêm action `GetTask` → Verb `GET`, URL `/bpm/tasks/{id}` → Import.
5. **Save** connector.

### 3. Dùng trong flow
Ở các chỗ dùng action "HTTP" mô tả bên dưới (Flow B bước 4/5, Flow A bước 2),
xoá action "HTTP" cũ → **+ New step** → tìm đúng tên connector vừa tạo (vd
`BPM Local API`) → chọn action tương ứng (`PostTaskAction`/`PostTaskCreated`/`GetTask`).
1. Lần đầu dùng, Power Automate yêu cầu tạo **Connection**: chọn **Gateway**
   vừa cài (vd `lab-approve-msteam`) → nếu Security ở trên là API Key, nhập
   giá trị `BPM_API_KEY` thật vào đây.
2. Điền tham số action: `id` = dynamic content lấy từ bước trước (Compose /
   `triggerBody()?['id']`), `action` = `approve` hoặc `reject` tuỳ nhánh
   True/False, `actor`/`source` điền như mô tả ở Flow A/B bên dưới.

> Nếu tenant vẫn chặn Custom Connector chạy qua gateway (một số policy chặn
> theo nhóm rộng hơn), cần nhờ admin tenant thêm connector này vào nhóm được
> phép trong **Power Platform admin center → Data policies**.

---

## Flow B — Task mới → Approval trên Teams → callback quyết định

Thay toàn bộ `src/bot/*`. Nhận tín hiệu "có task mới" cho **mọi nguồn tạo task**
(form BPM, `npm run trigger`, hay Flow A bên dưới) — vì `server.ts` gọi vào flow
này ngay khi `taskStore.create()` chạy, không phân biệt nguồn.

### 1. Trigger — "When an HTTP request is received"

Request Body JSON Schema (khớp `ApprovalTask` trong `src/bpm/store.ts`):

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "title": { "type": "string" },
    "detail": { "type": "string" },
    "requester": { "type": "string" },
    "assigneeEmail": { "type": "string" },
    "status": { "type": "string" },
    "createdAt": { "type": "string" }
  }
}
```

Lưu flow → copy **HTTP POST URL** flow sinh ra → dán vào `.env`:
```
POWER_AUTOMATE_TASK_CREATED_URL=<url PA vừa sinh>
```
→ restart server (`node node_modules\tsx\dist\cli.mjs watch src/server.ts`).

### 2. Action — "Create an approval" (connector Approvals)

- **Approval type**: "Approve/Reject - First to respond" (chỉ 1 người duyệt
  nên loại nào cũng tương đương).
- **Title**: `@{triggerBody()?['title']}`
- **Assigned to**: `@{triggerBody()?['assigneeEmail']}`
- **Details**: `@{triggerBody()?['detail']}`

### 3. Action — "Wait for an approval"

- **Approval Id**: dynamic content Approval ID từ output bước 2.

Action này mới thực sự **chờ**. Khi có người bấm Approve/Reject trên Teams,
action hoàn tất với `Outcome` (`Approve`/`Reject`) và thông tin người phản hồi
trong `responses[]`.

### 4. Action — HTTP: gọi lại action endpoint

- **Method**: POST
- **URI**: `{tunnelUrl}/bpm/tasks/@{triggerBody()?['id']}/actions`
- **Headers**: `Content-Type: application/json`, `x-api-key: <BPM_API_KEY>`
- **Body**:
  ```json
  {
    "action": "@{if(equals(outputs('Wait_for_an_approval')?['body/Outcome'], 'Approve'), 'approve', 'reject')}",
    "actor": "@{outputs('Wait_for_an_approval')?['body/responses']?[0]?['responderInfo']?['displayName']}",
    "source": "MS_TEAMS"
  }
  ```
  (Đường dẫn chính xác tới tên người phản hồi trong `responses[]` tuỳ phiên
  bản connector — kiểm tra dynamic content picker, không cố định tuyệt đối
  như trên.)

### 5. Xử lý 409 — báo cho người bấm biết task đã xử lý rồi

**Không có cách nào huỷ 1 approval đang chờ từ bên ngoài** (xem mục "Giới hạn"
cuối tài liệu) — nếu task được quyết định ở màn hình BPM hoặc tab My Tasks
*trước khi* ai đó bấm Approve/Reject trên card Teams, thì card Teams vẫn đứng
đó chờ bình thường. Khi cuối cùng có người bấm vào, bước 4 ở trên sẽ nhận về
**409** (task đã ở trạng thái khác `PENDING`). Thay vì để flow dừng lỗi âm
thầm, thêm nhánh báo lại cho đúng người vừa bấm biết thao tác của họ không có
tác dụng:

- Thêm **Configure run after** trên 1 action mới, chạy khi bước 4 **"has
  failed"**.
- Trong nhánh đó, thêm 2 action:
  1. **HTTP GET** `{tunnelUrl}/bpm/tasks/@{triggerBody()?['id']}` (không cần
     header `x-api-key` — route đọc không yêu cầu) → lấy `decidedBy`/
     `decidedVia`/`decidedAt` mới nhất của task.
  2. **"Post message in a chat or channel"** (connector Microsoft Teams) —
     Post as: **Flow bot**; Post in: **Chat with a user**; User:
     `@{outputs('Wait_for_an_approval')?['body/responses']?[0]?['responderInfo']?['email']}`
     (hoặc field tương đương trong dynamic content — kiểm tra tên chính xác);
     Message, ví dụ:
     ```
     Yêu cầu "@{triggerBody()?['title']}" đã được xử lý trước đó (bởi
     @{body('HTTP_GET')?['decidedBy']} lúc
     @{formatDateTime(body('HTTP_GET')?['decidedAt'], 'dd/MM/yyyy HH:mm')},
     qua @{body('HTTP_GET')?['decidedVia']}). Thao tác vừa rồi của bạn trên
     Teams không được áp dụng.
     ```

Dữ liệu ở backend luôn đúng dù bước này có làm hay không (nhờ check 409 sẵn
có trong `taskStore.applyAction()`) — bước 5 chỉ để trải nghiệm người dùng tốt
hơn, không bắt buộc phải có.

---

## Flow A — Email khớp điều kiện → tạo task

Thay `src/email/imapListener.ts` và `src/email/graphWebhook.ts`.

### 1. Trigger — Outlook/Office 365 "When a new email arrives (V3)"

- **Folder**: Inbox
- **From**: danh sách trong `EMAIL_ALLOWED_SENDERS` (.env), phân tách bằng dấu
  phẩy — filter sẵn có của trigger, tương đương `senderAllowed` trong
  `imapListener.ts:60`.
- **Subject Filter**: giá trị `EMAIL_TASK_SUBJECT` (`.env`) — ⚠️ đây chỉ là
  "chứa", không phải khớp tuyệt đối, nên vẫn cần Condition ở bước 2.

### 2. Condition — Subject khớp chính xác

`Subject` (dynamic content) **is equal to** giá trị `EMAIL_TASK_SUBJECT` — y
hệt logic `subjectMatches` trong `imapListener.ts:59`.

**Nhánh Yes** (subject đúng):

> Nếu tenant chặn action "HTTP" qua DLP policy, dùng "HTTP with on-premises
> data gateway" thay thế — xem mục **"Thay thế 'HTTP' bằng On-premises Data
> Gateway"** ở trên.

- Action "Html to text" (connector Content Conversion, có sẵn) trên `Body` của
  trigger → tương đương `stripHtml()` trong `imapListener.ts:14-19`.
- HTTP POST `{tunnelUrl}/bpm/tasks`, header `x-api-key`, body:
  ```json
  {
    "title": "@{triggerBody()?['Subject']}",
    "requester": "@{triggerBody()?['From']}",
    "detail": "@{body('Html_to_text')}"
  }
  ```

**Nhánh No** (sender đúng nhưng subject sai — trigger's `From` filter đã đảm
bảo chỉ sender được tin tưởng mới tới được đây, giống lý do
`imapListener.ts:71` chỉ auto-reply cho sender đã allowlist):
- Action "Reply to email (V2)", Body = nội dung cố định
  `"Subject không đúng, hãy kiểm tra lại"` (= `config.emailWrongSubjectReply`).

---

## Giới hạn cố ý (so với bản Bot Framework cũ)

- **Không huỷ được approval đang chờ từ bên ngoài**: đã thử 2 hướng và đều
  loại — (1) connector Approvals **không có action "Cancel an approval"**
  built-in; (2) API nội bộ không công bố của Teams
  (`approvals.teams.microsoft.com`) cần connector premium **"HTTP With
  Microsoft Entra ID"** + **admin consent cấp tenant**, và có thể bị Microsoft
  khoá/đổi bất cứ lúc nào vì không phải hợp đồng API chính thức — không đáng
  đánh đổi cho 1 bản demo. Quay lại Bot Framework (`syncCardWithLatestStatus`
  trong `src/bot/proactive.ts`, dùng `context.updateActivity()` chính thức) có
  làm được, nhưng đã chốt **không dùng hướng này**. Kết quả: nếu task được
  quyết định ở BPM screen/My Tasks tab trước, card Teams **vẫn đứng chờ bình
  thường cho tới khi có người bấm vào** — lúc đó mới nhận biết được (qua 409 ở
  Flow B bước 4) và báo lại cho người bấm (Flow B bước 5). Dữ liệu luôn đúng,
  chỉ là card có thể tạm trông như còn chờ trong lúc đó.
- **Chỉ Approve/Reject qua card Teams, không còn nút "Huỷ"**: connector
  Approvals mặc định chỉ hỗ trợ 2 lựa chọn Approve/Reject trên card, khác bản
  Adaptive Card thô cũ có 3 nút (Đồng ý/Từ chối/Huỷ). Muốn "Huỷ" task thì vẫn
  làm được, chỉ không bấm trực tiếp trên card Teams — dùng màn hình BPM hoặc
  tab My Tasks. (Một số tenant có tính năng "Custom Responses for approvals"
  cho phép thêm lựa chọn tuỳ ý ngoài Approve/Reject — kiểm tra tenant có hỗ
  trợ không nếu cần khôi phục đủ 3 nút.)
- **Không còn giữ nguyên `.eml` gốc kèm file đính kèm** cho task tạo từ email —
  Flow A chỉ lấy `Subject`/`From`/`Body` text, không tải MIME thô như
  `imapListener.ts`/`graphWebhook.ts` từng làm. Task tạo từ Flow A sẽ không có
  link "📎 Xem email gốc (.eml)" trên UI (trường `emailFile` bỏ trống — UI đã tự
  ẩn link này khi thiếu, xem `public/index.html:70`). Nếu cần giữ file đính
  kèm, có thể thêm action "Get attachments" + lưu từng file riêng, nhưng không
  tái tạo được đúng định dạng `.eml` gộp như bản cũ.
