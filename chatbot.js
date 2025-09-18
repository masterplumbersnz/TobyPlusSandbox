document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("user-input");
  const messages = document.getElementById("messages");
  const micBtn = document.getElementById("mic-btn");

  let thread_id = null;
  let currentConversationId = Date.now();

  // === Recording globals ===
  let mediaStream = null;
  let mediaRecorder = null;
  let chunks = [];

  // === Track current audio ===
  let currentAudio = null;

  // === Mobile Audio Unlock ===
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      ctx.resume();

      const utterance = new SpeechSynthesisUtterance(".");
      utterance.volume = 0;
      window.speechSynthesis.speak(utterance);

      console.log("🔓 Audio + speech unlocked for mobile");
    } catch (e) {
      console.warn("Audio unlock failed:", e);
    }
  }

  // === Endpoints ===
  const transcribeEndpoint = "https://tobyplussandbox.netlify.app/.netlify/functions/transcribe";
  const ttsEndpoint = "https://tobyplussandbox.netlify.app/.netlify/functions/tts";
  const startRunEndpoint = "https://tobyplussandbox.netlify.app/.netlify/functions/start-run";
  const checkRunEndpoint = "https://tobyplussandbox.netlify.app/.netlify/functions/check-run";

  // === Debug overlay ===
  const debugOverlay = document.createElement("div");
  debugOverlay.className = "debug-overlay";
  debugOverlay.innerText = "🔍 Debug ready";
  document.body.appendChild(debugOverlay);
  const updateDebug = (msg) => (debugOverlay.innerText = msg);

  // === Base64 encoder (safe for large files) ===
  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  // === Auto-Speak Toggle ===
  let autoSpeakEnabled = true;
  const toggleSpeakBtn = document.getElementById("toggle-speak");
  if (toggleSpeakBtn) {
    toggleSpeakBtn.addEventListener("click", () => {
      autoSpeakEnabled = !autoSpeakEnabled;
      toggleSpeakBtn.textContent = autoSpeakEnabled ? "🔈 Auto-Speak: On" : "🔇 Auto-Speak: Off";
      toggleSpeakBtn.classList.toggle("off", !autoSpeakEnabled);
    });
  }

  // === Stop Playback button ===
  const stopTalkBtn = document.createElement("button");
  stopTalkBtn.textContent = "🛑 Stop Playback";
  stopTalkBtn.className = "stop-talk-btn";
  stopTalkBtn.title = "Stop playback";
  stopTalkBtn.onclick = () => {
    window.speechSynthesis.cancel();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    updateDebug("Speech/audio stopped by user");
  };
  document.querySelector(".button-group").appendChild(stopTalkBtn);

  // === Voice & Transcription ===
  const pickAudioMime = () => {
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
      return "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/webm"))
      return "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/mp4"))
      return "audio/mp4";
    return "";
  };

  async function startRecording() {
    try {
      chunks = [];
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMime();
      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        if (!chunks.length) return;
        updateDebug("Recording stopped, sending for transcription…");
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        await sendAudioForTranscription(blob);
        mediaStream?.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      micBtn.textContent = "🛑";
      updateDebug("Recording started…");
    } catch (err) {
      updateDebug("Mic error: " + err.message);
      createBubble("⚠️ I can't access your microphone.", "bot");
    }
  }

  function stopRecording() {
    if (!mediaRecorder) return;
    mediaRecorder.stop();
    micBtn.textContent = "🎙️";
    updateDebug("Stopping recording...");
  }

  async function sendAudioForTranscription(blob) {
    try {
      const ab = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(ab);

      const res = await fetch(transcribeEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: blob.type || "audio/webm",
          fileName: blob.type.includes("mp4") ? "recording.mp4" : "recording.webm",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { text } = await res.json();
      if (text) {
        input.value = text;
        // ✅ Safe submit fallback
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      }
    } catch (err) {
      updateDebug("Transcription error: " + err.message);
      createBubble("⚠️ Transcription failed. Try again.", "bot");
    }
  }

  micBtn.addEventListener("click", async () => {
    unlockAudio();
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      await startRecording();
    } else {
      stopRecording();
    }
  });

  // === Enter-to-send ===
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      unlockAudio();
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    }
  });

  // === Thinking bubble with typing dots ===
  const createThinkingBubble = () => {
    const div = document.createElement("div");
    div.className = "bubble bot thinking";
    div.innerHTML = `
      <span class="typing-dots">
        <span></span><span></span><span></span>
      </span> Toby is thinking...
    `;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  };

  // === Form submit ===
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    unlockAudio();

    const message = input.value.trim();
    if (!message) return;

    createBubble(message, "user");
    input.value = "";
    input.style.height = "auto";

    const thinkingBubble = createThinkingBubble();
    updateDebug("Message sent, waiting for reply…");

    try {
      const startRes = await fetch(startRunEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, thread_id }),
      });
      if (!startRes.ok) throw new Error("start-run failed");

      const { thread_id: newThreadId, run_id } = await startRes.json();
      thread_id = newThreadId;

      let reply = "";
      let completed = false;
      while (!completed) {
        const checkRes = await fetch(checkRunEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thread_id, run_id }),
        });

        if (checkRes.status === 202) {
          updateDebug("Bot thinking…");
          await new Promise((r) => setTimeout(r, 1000));
        } else if (checkRes.ok) {
          const data = await checkRes.json();
          reply = data.reply || "(No response)";
          completed = true;
        } else {
          const errText = await checkRes.text();
          console.error("Check-run error:", checkRes.status, errText);
          throw new Error("check-run failed");
        }
      }

      thinkingBubble.remove();
      updateDebug("Reply received");
      createBubble(reply, "bot");
    } catch (err) {
      updateDebug("Chat error: " + err.message);
      thinkingBubble.remove();
      createBubble("🤖 My circuits got tangled. Try again?", "bot");
    }
  });

  // === Helpers ===
  const stripCitations = (text) => text.replace(/【\d+:\d+†[^†【】]+(?:†[^【】]*)?】/g, "");
  const formatMarkdown = (text) =>
    text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/^(\d+)\.\s+(.*)$/gm, "<p><strong>$1.</strong> $2</p>")
      .replace(/\n{2,}/g, "<br><br>")
      .replace(/\n/g, "<br>");

  const createBubble = (content, sender, narrate = true) => {
    const div = document.createElement("div");
    const cleaned = stripCitations(content);
    const formatted = formatMarkdown(cleaned);

    if (sender === "bot") {
      const wrapper = document.createElement("div");
      wrapper.className = "bot-message";
      const avatar = document.createElement("img");
      avatar.src = "https://resilient-palmier-22bdf1.netlify.app/Toby-Avatar.svg";
      avatar.alt = "Toby";
      avatar.className = "avatar";

      div.className = "bubble bot";
      div.innerHTML = formatted;

      const replayBtn = document.createElement("button");
      replayBtn.textContent = "🔊";
      replayBtn.className = "replay-btn";
      replayBtn.onclick = async () => {
        if (currentAudio && !currentAudio.paused) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio = null;
          replayBtn.textContent = "🔊";
          return;
        }

        window.speechSynthesis.cancel();
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio = null;
        }

        try {
          if (div.dataset.hqAudio) {
            currentAudio = new Audio(div.dataset.hqAudio);
            replayBtn.textContent = "⏸️";

            currentAudio.onended = () => {
              replayBtn.textContent = "🔊";
              currentAudio = null;
            };

            await currentAudio.play();
          } else {
            const plainText = div.innerText;
            const utterance = new SpeechSynthesisUtterance(plainText);

            replayBtn.textContent = "⏸️";
            utterance.onend = () => {
              replayBtn.textContent = "🔊";
            };

            window.speechSynthesis.speak(utterance);
          }
        } catch (err) {
          console.warn("Replay failed, falling back:", err);
          const plainText = div.innerText;
          const utterance = new SpeechSynthesisUtterance(plainText);

          replayBtn.textContent = "⏸️";
          utterance.onend = () => {
            replayBtn.textContent = "🔊";
          };

          window.speechSynthesis.speak(utterance);
        }
      };

      wrapper.appendChild(avatar);
      wrapper.appendChild(div);
      wrapper.appendChild(replayBtn);
      messages.appendChild(wrapper);

      if (narrate && autoSpeakEnabled) {
        window.speechSynthesis.cancel();
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio = null;
        }
        const plainText = div.innerText;
        const utterance = new SpeechSynthesisUtterance(plainText);
        window.speechSynthesis.speak(utterance);
      }

      fetch(ttsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleaned, voice: "alloy", format: "mp3" })
      })
        .then(res => res.json())
        .then(data => {
          if (data.audioBase64) {
            div.dataset.hqAudio = `data:${data.mimeType};base64,${data.audioBase64}`;
          }
        })
        .catch(err => console.error("TTS generation failed:", err));
    } else {
      div.className = "bubble user";
      div.innerHTML = content;
      messages.appendChild(div);
    }

    messages.scrollTop = messages.scrollHeight;
    saveConversation();
    return div;
  };

  // === Scroll-to-bottom button ===
  const scrollBtn = document.getElementById("scroll-bottom-btn");
  messages.addEventListener("scroll", () => {
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
    if (nearBottom) {
      scrollBtn.classList.remove("show");
    } else {
      scrollBtn.classList.add("show");
    }
  });
  scrollBtn.addEventListener("click", () => {
    messages.scrollTop = messages.scrollHeight;
  });

  // === Init ===
  loadConversationList();
});
