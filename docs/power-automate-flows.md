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
  `401`.
- Dựng **Flow B trước** — vì `POWER_AUTOMATE_TASK_CREATED_URL` trong `.env` cần
  URL do Flow B sinh ra sau khi lưu flow lần đầu.

---

## Thay thế "HTTP" bằng On-premises Data Gateway (nếu tenant chặn action HTTP)

Một số tenant M365 áp **DLP policy** chặn hẳn action **"HTTP"** built-in (rủi ro
gọi ra bất kỳ endpoint nào) — nếu thêm action HTTP mà báo lỗi dạng *"This
action isn't supported... blocked by data loss prevention policy"*, thay 2 chỗ
dùng HTTP bên dưới (Flow B bước 3, Flow A bước 2) bằng 1 **Custom Connector**
cấu hình chạy qua gateway. Traffic khi đó giới hạn trong phạm vi gateway kiểm
soát, không gọi tuỳ ý ra Internet như action "HTTP" thường nên thường không bị
policy đó chặn.

⚠️ Không có action có sẵn tên "HTTP with on-premises data gateway" để chọn
thẳng trong danh sách action — đây **bắt buộc phải qua Custom Connector**,
không có đường tắt nào khác.

Lợi ích phụ: dùng gateway thì **không cần ngrok/tunnel công khai nữa** cho 2
chỗ Power Automate gọi vào server — gateway đóng vai trò cầu nối thay tunnel,
và không đổi domain mỗi lần restart như ngrok free (chỉ `POWER_AUTOMATE_TASK_CREATED_URL`
là vẫn cần Power Automate sinh ra bình thường, không liên quan tunnel).

### 1. Cài đặt gateway
1. Tải **On-premises Data Gateway** (bản **Standard**, KHÔNG chọn Personal
   mode) từ https://aka.ms/on-premises-data-gateway-download, cài trên máy
   đang chạy `npm run dev` (hoặc máy khác cùng mạng LAN có thể reach tới
   server đó).
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
4. Tab **Definition** → **+ New action**, tạo 2 action tương ứng 2 endpoint
   đang dùng:
   - Đặt tên vd `PostTaskAction` → **"+ Import from sample"** → Verb `POST`,
     URL `/bpm/tasks/{id}/actions`, Header `Content-Type: application/json`,
     Body mẫu `{"action": "approve", "actor": "test", "source": "MS_TEAMS"}`
     → Import (Power Automate tự nhận `{id}` thành path parameter).
   - Nếu cũng dùng Custom Connector này cho Flow A: thêm action
     `PostTaskCreated` → Verb `POST`, URL `/bpm/tasks`, Body mẫu
     `{"title": "x", "requester": "x", "detail": "x"}` → Import.
5. **Save** connector.

### 3. Dùng trong flow
Ở Flow B bước 3 và Flow A bước 2 (2 chỗ dùng action "HTTP" mô tả bên dưới),
xoá action "HTTP" cũ → **+ New step** → tìm đúng tên connector vừa tạo (vd
`BPM Local API`) → chọn action tương ứng (`PostTaskAction`).
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

## Flow B — Task mới → Adaptive Card trên Teams → callback quyết định

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

### 2. Action — "Post adaptive card and wait for a response" (connector Microsoft Teams)

- **Recipient**: `assigneeEmail` (dynamic content từ trigger)
- **Message** (dán nguyên JSON sau vào chế độ "raw" của card editor — dịch từ
  `buildApprovalCard()` trong `src/bot/cards.ts:8-56`, thay chỗ nào cần bằng
  giá trị dynamic content tương ứng trong UI, hoặc paste thẳng biểu thức
  `@{triggerBody()?['...']}` nếu editor cho sửa raw JSON):

```json
{
  "type": "AdaptiveCard",
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "version": "1.4",
  "body": [
    { "type": "TextBlock", "text": "Yêu cầu phê duyệt mới", "weight": "Bolder", "size": "Medium", "wrap": true },
    { "type": "TextBlock", "text": "@{triggerBody()?['title']}", "wrap": true, "spacing": "Small" },
    {
      "type": "FactSet",
      "facts": [
        { "title": "Người đề nghị", "value": "@{triggerBody()?['requester']}" },
        { "title": "Mã task", "value": "@{substring(triggerBody()?['id'], 0, 8)}" },
        { "title": "Thời gian", "value": "@{formatDateTime(triggerBody()?['createdAt'], 'dd/MM/yyyy HH:mm')}" }
      ]
    }
  ],
  "actions": [
    { "type": "Action.Submit", "title": "✅ Đồng ý", "style": "positive", "data": { "action": "approve" } },
    { "type": "Action.Submit", "title": "❌ Từ chối", "style": "destructive", "data": { "action": "reject" } },
    { "type": "Action.Submit", "title": "🚫 Huỷ", "data": { "action": "cancel" } }
  ]
}
```

(Không cần nhét `taskId` vào `data` — flow đã có sẵn `triggerBody()?['id']` để
dùng ở bước sau, không cần đi vòng qua card.)

### 3. Action — HTTP: gọi lại action endpoint

> Nếu tenant chặn action "HTTP" qua DLP policy, dùng "HTTP with on-premises
> data gateway" thay thế — xem mục **"Thay thế 'HTTP' bằng On-premises Data
> Gateway"** ở trên.

Sau khi action trên nhận được phản hồi (output của nó chứa `data` — object
`{ action: "approve" | "reject" | "cancel" }` mà user vừa bấm — và thông tin
người phản hồi, xem trong dynamic content picker sau khi thêm action, thường có
tên/email dạng `Responder ...`):

- **Method**: POST
- **URI**: `{tunnelUrl}/bpm/tasks/@{triggerBody()?['id']}/actions`
- **Headers**: `Content-Type: application/json`, `x-api-key: <BPM_API_KEY>`
- **Body**:
  ```json
  {
    "action": "@{body('Post_adaptive_card_and_wait_for_a_response')?['data']?['action']}",
    "actor": "@{body('Post_adaptive_card_and_wait_for_a_response')?['responder']?['name']}",
    "source": "MS_TEAMS"
  }
  ```
  (Tên chính xác của output "responder" phụ thuộc phiên bản connector — kiểm
  tra trong dynamic content picker, không cố định tuyệt đối như trên.)

### 4. Xử lý 409 (task đã được quyết định ở nơi khác)

Nếu action trên trả về **409** (BPM screen hoặc My Tasks tab đã quyết định
task này trong lúc card Teams còn đang chờ) — thêm 1 bước **Configure run
after** trên 1 action tiếp theo (chạy "has failed") để flow dừng êm, không báo
lỗi đỏ. Đây là giới hạn cố ý — xem mục "Giới hạn" bên dưới.

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

- **Không đồng bộ ngược card đã gửi**: nếu quyết định đến từ màn hình BPM hoặc
  tab My Tasks trong lúc Flow B đang ở bước "wait for a response", card Teams
  đã gửi **không tự cập nhật** (khác bản cũ có `syncCardWithLatestStatus` —
  xem `src/bot/proactive.ts`, giờ không còn được gọi). Dữ liệu vẫn luôn đúng
  (nhờ check 409 ở Flow B bước 4) — chỉ là card có thể tạm trông như còn chờ dù
  đã xử lý xong. Chấp nhận đánh đổi này cho bản demo.
- **Không còn giữ nguyên `.eml` gốc kèm file đính kèm** cho task tạo từ email —
  Flow A chỉ lấy `Subject`/`From`/`Body` text, không tải MIME thô như
  `imapListener.ts`/`graphWebhook.ts` từng làm. Task tạo từ Flow A sẽ không có
  link "📎 Xem email gốc (.eml)" trên UI (trường `emailFile` bỏ trống — UI đã tự
  ẩn link này khi thiếu, xem `public/index.html:70`). Nếu cần giữ file đính
  kèm, có thể thêm action "Get attachments" + lưu từng file riêng, nhưng không
  tái tạo được đúng định dạng `.eml` gộp như bản cũ.
