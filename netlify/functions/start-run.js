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
    const { message, thread_id } = JSON.parse(event.body || "{}");
    if (!message) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing message" }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    // Create new thread if needed
    const threadRes = thread_id
      ? { id: thread_id }
      : await fetch("https://api.openai.com/v1/threads", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "OpenAI-Beta": "assistants=v2",
            "Content-Type": "application/json"
          }
        }).then((r) => r.json());

    const newThreadId = threadRes.id;

    // Post user message
    await fetch(`https://api.openai.com/v1/threads/${newThreadId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role: "user", content: message })
    });

    // Run assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${newThreadId}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ assistant_id: assistantId })
    }).then((r) => r.json());

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: newThreadId, run_id: runRes.id })
    };
  } catch (err) {
    console.error("start-run error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
