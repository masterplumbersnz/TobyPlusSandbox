const fetch = require("node-fetch");

const ALLOWED_ORIGINS = [
  "https://masterplumbers.org.nz",
  "https://masterplumbersnz.github.io",
  "https://tobyplussandbox.netlify.app"
];

function getCorsHeaders(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
    };
  }
  return {};
}

exports.handler = async (event) => {
  const corsHeaders = getCorsHeaders(event.headers.origin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const { audioBase64, mimeType = "audio/webm", fileName = "recording.webm" } = JSON.parse(event.body || "{}");
    if (!audioBase64) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing audio" }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const audioBuffer = Buffer.from(audioBase64, "base64");

    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer]), fileName);
    formData.append("model", "gpt-4o-mini-transcribe");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData
    });

    if (!response.ok) {
      return { statusCode: response.status, headers: corsHeaders, body: await response.text() };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ text: data.text })
    };
  } catch (err) {
    console.error("transcribe error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
