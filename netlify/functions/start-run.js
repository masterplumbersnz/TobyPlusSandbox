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
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing message" })
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    // 1. Create new thread if not provided
    let newThreadId = thread_id;
    if (!newThreadId) {
      const threadRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "assistants=v2",
          "Content-Type": "application/json"
        }
      });

      if (!threadRes.ok) {
        const errText = await threadRes.text();
        console.error("Thread creation error:", errText);
        return { statusCode: threadRes.status, headers: corsHeaders, body: errText };
      }

      const threadData = await threadRes.json();
      newThreadId = threadData.id;
    }

    // 2. Post user message
    const msgRes = await fetch(`https://api.openai.com/v1/threads/${newThreadId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role: "user", content: message })
    });

    if (!msgRes.ok) {
      const errText = await msgRes.text();
      console.error("Message post error:", errText);
      return { statusCode: msgRes.status, headers: corsHeaders, body: errText };
    }

    // 3. Run assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${newThreadId}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ assistant_id: assistantId })
    });

    if (!runRes.ok) {
      const errText = await runRes.text();
      console.error("Run creation error:", errText);
      return { statusCode: runRes.status, headers: corsHeaders, body: errText };
    }

    const runData = await runRes.json();

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: newThreadId, run_id: runData.id })
    };
  } catch (err) {
    console.error("start-run error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
