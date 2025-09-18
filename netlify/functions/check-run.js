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
    const { thread_id, run_id } = JSON.parse(event.body || "{}");
    if (!thread_id || !run_id) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing thread_id or run_id" }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;

    // Check run status
    const runStatus = await fetch(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "assistants=v2" }
    }).then((r) => r.json());

    if (runStatus.status === "in_progress" || runStatus.status === "queued") {
      return { statusCode: 202, headers: corsHeaders, body: JSON.stringify({ status: runStatus.status }) };
    }

    // Fetch messages
    const messages = await fetch(`https://api.openai.com/v1/threads/${thread_id}/messages`, {
      headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "assistants=v2" }
    }).then((r) => r.json());

    const last = messages.data
      .filter((m) => m.role === "assistant")
      .sort((a, b) => b.created_at - a.created_at)[0];

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ reply: last?.content?.[0]?.text?.value || "" })
    };
  } catch (err) {
    console.error("check-run error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
