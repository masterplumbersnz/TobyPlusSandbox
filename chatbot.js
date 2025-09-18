document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("user-input");
  const messages = document.getElementById("messages");
  const micBtn = document.getElementById("mic-btn");

  let thread_id = null;
  let currentConversationId = Date.now();

  // === Track current audio ===
  let currentAudio = null;

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

  // === Auto-Speak Toggle ===
  let autoSpeakEnabled = true; // default ON
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
    // Cancel browser speech
    window.speechSynthesis.cancel();
    // Stop HQ audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    updateDebug("Speech/audio stopped by user");
  };
  document.querySelector(".button-group").appendChild(stopTalkBtn);

  // === Conversation Storage ===
  function saveConversation() {
    const allBubbles = [...messages.querySelectorAll(".bubble")];
    const transcript = allBubbles.map(b => ({
      sender: b.classList.contains("user") ? "user" : "bot",
      content: b.innerHTML
    }));

    const conversations = JSON.parse(localStorage.getItem("conversations") || "[]");
    let existing = conversations.find(c => c.id === currentConversationId);

    const firstUserMessage = transcript.find(m => m.sender === "user");
    const newTitle = firstUserMessage ? firstUserMessage.content.slice(0, 30) : "Untitled";

    if (existing) {
      existing.messages = transcript;
      existing.title = newTitle;
    } else {
      conversations.push({ id: currentConversationId, title: newTitle, messages: transcript });
    }

    localStorage.setItem("conversations", JSON.stringify(conversations));
    loadConversationList();
  }

  function loadConversationList() {
    const conversations = JSON.parse(localStorage.getItem("conversations") || "[]");
    const list = document.getElementById("conversations-list");
    if (!list) return;
    list.innerHTML = "";

    conversations.forEach(conv => {
      const li = document.createElement("li");

      const titleSpan = document.createElement("span");
      titleSpan.textContent = conv.title;

      const renameBtn = document.createElement("button");
      renameBtn.textContent = "✏️";
      renameBtn.style.marginLeft = "8px";
      renameBtn.style.fontSize = "12px";
      renameBtn.onclick = (e) => {
        e.stopPropagation();
        const newName = prompt("Rename conversation:", conv.title);
        if (newName && newName.trim()) {
          conv.title = newName.trim();
          localStorage.setItem("conversations", JSON.stringify(conversations));
          loadConversationList();
        }
      };

      li.appendChild(titleSpan);
      li.appendChild(renameBtn);
      li.onclick = () => {
        loadConversation(conv.id);
        closeSidebar();
      };
      list.appendChild(li);
    });
  }

  function loadConversation(id) {
    const conversations = JSON.parse(localStorage.getItem("conversations") || "[]");
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;

    messages.innerHTML = "";
    conv.messages.forEach(m => createBubble(m.content, m.sender, false));
    currentConversationId = conv.id;
  }

  // === Clear Conversations ===
  document.getElementById("clear-conversations")?.addEventListener("click", () => {
    localStorage.removeItem("conversations");
    loadConversationList();
  });

  // === New Chat ===
  document.getElementById("new-conversation")?.addEventListener("click", () => {
    currentConversationId = Date.now();
    messages.innerHTML = "";
    saveConversation();
    closeSidebar();
  });

  // === Sidebar Toggle (Mobile) ===
  const toggleBtn = document.getElementById("toggle-conversations");
  const sidebar = document.getElementById("conversations-panel");
  const closeBtn = document.getElementById("close-conversations");
  const overlay = document.getElementById("sidebar-overlay");

  function openSidebar() {
    sidebar.classList.add("open");
    if (overlay) overlay.classList.add("active");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    if (overlay) overlay.classList.remove("active");
  }

  toggleBtn?.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
  closeBtn?.addEventListener("click", closeSidebar);
  overlay?.addEventListener("click", closeSidebar);

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
      const base64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
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
        form.requestSubmit();
      }
    } catch (err) {
      updateDebug("Transcription error: " + err.message);
      createBubble("⚠️ Transcription failed. Try again.", "bot");
    }
  }

  micBtn.addEventListener("click", async () => {
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
      form.requestSubmit();
    }
  });

  // === Form submit ===
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = input.value.trim();
    if (!message) return;

    createBubble(message, "user");
    input.value = "";
    input.style.height = "auto";
    const thinkingBubble = createBubble('<span class="spinner"></span> Toby is thinking...', "bot", false);
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
        // If already playing, stop and reset
        if (currentAudio && !currentAudio.paused) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio = null;
          replayBtn.textContent = "🔊";
          return;
        }

        // Cancel any existing speech first
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

      // 🔊 Auto-speak (cancel anything already playing first)
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

      // Pre-generate HQ audio
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

  // === Init ===
  loadConversationList();
});
