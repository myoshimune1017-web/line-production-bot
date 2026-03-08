require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const line = require("@line/bot-sdk");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const MASTER = {
  "16283": { output: "ジムニー", intami: "エブリ10", doridora: "9ミリ" },
  "16360": { output: "ジムニー", intami: "ジムニー110", doridora: "9ミリ" },
  "16294": { output: "4WD", intami: "エブリ10", doridora: "9ミリ" },
  "16304": { output: "ジムニー", intami: "エブリ10", doridora: "9ミリ" },
  "16380": { output: "ジムニー", intami: "ジムニー110", doridora: "11ミリ" },
  "16370": { output: "ジムニー", intami: "ジムニー110", doridora: "11ミリ" },
  "16353": { output: "ジムニー", intami: "ジムニー110", doridora: "11ミリ" },
  "16273": { output: "4WD", intami: "エブリ10", doridora: "9ミリ" },
};

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
    limit: "10mb",
  })
);

function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");
  return signature === hash;
}

async function getImageBuffer(messageId) {
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  });
  return Buffer.from(response.data);
}

function formatTime(qty) {
  const minutes = Math.round((qty / 40) * 60);
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours}時間（${minutes}分）`;
}

async function analyzeImage(imageBuffer) {
  const base64Image = imageBuffer.toString("base64");

  const prompt = `
あなたは製造現場の生産計画アシスタントです。

画像から「左列=組付け品番」「右列=生産台数」を読み取り、
以下のマスターに従って表を作成してください。

品番マスター:
${JSON.stringify(MASTER, null, 2)}

ルール:
- アウトプット、インタミ、ドリドラは1台につき各1個使用
- 生産能力は1時間40台
- 出力は日本語
- 同じ品番が複数回あってもそのまま残す
- 最後に集計を付ける

出力形式:
1. 「生産計画表」
2. 表: 組付け品番 | 台数 | アウトプット | インタミ | ドリドラ | 予想時間
3. 「集計」
4. アウトプット合計
5. インタミ合計
6. ドリドラ合計
7. 総台数
8. 総生産時間

画像が読み取りにくい場合は
「写真をもう少し明るく、真上から送ってください」
と返してください。
`;

  const response = await openai.responses.create({
    model: "gpt-5.4",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          {
            type: "input_image",
            image_url: `data:image/jpeg;base64,${base64Image}`,
          },
        ],
      },
    ],
  });

  return response.output_text || "読み取りに失敗しました。";
}

app.get("/", (req, res) => {
  res.send("LINE production bot is running");
});

app.post("/webhook", async (req, res) => {
  try {
    if (!verifySignature(req)) {
      return res.status(401).send("Invalid signature");
    }

    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;

      if (event.message.type !== "image") {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: "写真を送ってください。組付け品番と台数を読み取って表にします。",
            },
          ],
        });
        continue;
      }

      const imageBuffer = await getImageBuffer(event.message.id);
      const resultText = await analyzeImage(imageBuffer);

      const chunks = [];
      const maxLength = 4500;
      for (let i = 0; i < resultText.length; i += maxLength) {
        chunks.push(resultText.slice(i, i + maxLength));
      }

      await client.replyMessage({
        replyToken: event.replyToken,
        messages: chunks.map((text) => ({
          type: "text",
          text,
        })),
      });
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
