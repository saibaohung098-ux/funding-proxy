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
    const prompt = `
Bạn là chuyên gia phân tích tài chính.

Hãy dùng web search để tìm thông tin về hoạt động gọi vốn của công ty/dự án thuộc domain: ${domain}

Hãy trả về đúng dạng JSON (USD):

{
  "has_raised": true/false,
  "latest_round": "Seed/Series A/Series B/Recap/IPO/unknown",
  "total_funding_usd": number or null,
  "latest_revenue_usd": number or null,
  "valuation_usd": number or null,
  "sources": ["url1", "url2"]
}

Chỉ trả về DUY NHẤT JSON object, không thêm chữ nào khác.
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      tools: [{ type: "web_search" }]
    });

    // Lấy text từ Responses API
    const content = response.output?.[0]?.content || [];
    let text = null;

    for (const c of content) {
      if (typeof c.text === "string") {
        text = c.text;
        break;
      }
      if (c.text && typeof c.text.value === "string") {
        text = c.text.value;
        break;
      }
    }

    if (!text) {
      return res.status(500).json({ error: "No text from OpenAI" });
    }

    // Làm sạch JSON
    let t = text.trim();
    if (t.startsWith("```")) {
      t = t.replace(/```json/i, "").replace(/```/g, "").trim();
    }

    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      return res
        .status(500)
        .json({ error: "Cannot find JSON braces", raw: t });
    }

    const jsonSlice = t.substring(first, last + 1);

    let json;
    try {
      json = JSON.parse(jsonSlice);
    } catch (e) {
      return res.status(500).json({
        error: "JSON parse error",
        raw: jsonSlice
      });
    }

    return res.status(200).json(json);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "OpenAI error",
      details: err.message
    });
  }
}
