import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  // Chỉ cho phép POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Bảo vệ API bằng token nội bộ
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "");

  if (!token || token !== process.env.INTERNAL_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Lấy domain từ body
  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const { domain } = body;

  if (!domain) {
    return res.status(400).json({ error: "Missing domain" });
  }

  try {
    const systemPrompt = `
Bạn là chuyên gia phân tích tài chính. 
Hãy trả lời theo ĐÚNG format JSON dưới đây, không thêm text ngoài JSON.

Nếu không tìm được thông tin chính xác, để giá trị = null.

Cấu trúc JSON:
{
  "has_raised": true hoặc false,
  "latest_round": "Seed" | "Series A" | "Series B" | "Series C" | "IPO" | "Recap" | "unknown",
  "total_funding_usd": số hoặc null,
  "latest_revenue_usd": số hoặc null,
  "valuation_usd": số hoặc null,
  "sources": ["url1", "url2"]
}
`;

    const userPrompt = `
Domain: ${domain}

Hãy cho tôi thông tin về:
- Công ty/dự án đứng sau domain này đã từng gọi vốn chưa (has_raised)?
- Nếu có, vòng gọi vốn mới nhất là gì (latest_round)?
- Tổng số vốn đã gọi (total_funding_usd, USD)?
- Doanh thu gần nhất (latest_revenue_usd, USD)?
- Định giá gần nhất (valuation_usd, USD)?
- Liệt kê 1-3 nguồn tham khảo (sources: mảng URL).
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const text = completion.choices?.[0]?.message?.content;
    if (!text) {
      return res.status(500).json({ error: "No text from OpenAI (chat)" });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      // Trường hợp model vẫn trả dư text, cố gắng cắt từ { ... }
      let t = text.trim();
      if (t.startsWith("```")) {
        t = t.replace(/```json/i, "").replace(/```/g, "").trim();
      }
      const first = t.indexOf("{");
      const last = t.lastIndexOf("}");
      if (first === -1 || last === -1 || last <= first) {
        return res.status(500).json({
          error: "Cannot parse JSON from completion",
          raw: t
        });
      }
      const slice = t.substring(first, last + 1);
      json = JSON.parse(slice);
    }

    return res.status(200).json(json);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "OpenAI chat error",
      details: err.message
    });
  }
}
