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
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing thread_id or run_id" })
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;

    // 🔎 Poll run status
    const runRes = await fetch(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2"
      }
    });

    if (!runRes.ok) {
      const errText = await runRes.text();
      console.error("Run check error:", errText);
      return { statusCode: runRes.status, headers: corsHeaders, body: errText };
    }

    const runData = await runRes.json();

    if (runData.status === "in_progress" || runData.status === "queued") {
      return { statusCode: 202, headers: corsHeaders, body: "" };
    }

    if (runData.status === "completed") {
      // ✅ Fetch messages to get the reply
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${thread_id}/messages`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "assistants=v2"
        }
      });

      if (!msgRes.ok) {
        const errText = await msgRes.text();
        console.error("Messages fetch error:", errText);
        return { statusCode: msgRes.status, headers: corsHeaders, body: errText };
      }

      const msgData = await msgRes.json();
      const lastMsg = msgData.data.find(m => m.role === "assistant");

      return {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ reply: lastMsg?.content?.[0]?.text?.value || "" })
      };
    }

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: `Run ended with status: ${runData.status}` })
    };

  } catch (err) {
    console.error("check-run error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
