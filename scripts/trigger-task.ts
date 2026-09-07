/**
 * Simulates a real BPM engine routing a new task to the assignee.
 * Usage: npm run trigger -- "Tiêu đề yêu cầu" "Người đề nghị"
 */
import "dotenv/config";

const port = process.env.PORT || "3978";
const title = process.argv[2] || "Đề nghị chi tạm ứng 5,000,000 VND";
const requester = process.argv[3] || "Nguyễn Văn A";
const detail =
  process.argv[4] ||
  [
    "Lý do đề nghị: bổ sung chi phí công tác quý 3 cho đoàn khảo sát chi nhánh Cần Thơ.",
    "",
    "Hạng mục:",
    "- Vé máy bay khứ hồi (4 người): 12,400,000đ",
    "- Khách sạn 3 đêm: 6,000,000đ",
    "- Phụ cấp công tác: 4,000,000đ",
    "",
    "Đã có xác nhận sơ bộ từ Trưởng phòng Kế hoạch ngày 03/08.",
    "Hạn xử lý mong muốn: trước 10/08 để kịp lịch công tác.",
    "",
    "Người theo dõi: Nguyễn Văn A (ext. 2231)",
  ].join("\n");

async function main() {
  const res = await fetch(`http://localhost:${port}/bpm/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.BPM_API_KEY || "" },
    body: JSON.stringify({ title, requester, detail }),
  });
  if (!res.ok) {
    console.error("Failed:", res.status, await res.text());
    process.exit(1);
  }
  console.log("Task created:", await res.json());
}

main();
