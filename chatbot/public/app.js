const messagesEl = document.querySelector("#messages");
const quickActionsEl = document.querySelector("#quickActions");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const resetButton = document.querySelector("#resetButton");
const handoffPanel = document.querySelector("#handoffPanel");
const handoffSummary = document.querySelector("#handoffSummary");
const openStatus = document.querySelector("#openStatus");

let sessionId = localStorage.getItem("construrio-session-id") || crypto.randomUUID();
localStorage.setItem("construrio-session-id", sessionId);

const initialQuickReplies = [
  "Endereco da loja",
  "Horario de funcionamento",
  "Entrega",
  "Formas de pagamento",
  "Quero falar com atendente"
];

renderOpenStatus();
appendMessage(
  "bot",
  "Ola! Sou o atendimento virtual da ConstruRio. Posso ajudar com endereco, horario, entrega, formas de pagamento ou encaminhar orcamentos para um atendente."
);
renderQuickActions(initialQuickReplies);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  input.value = "";
  await sendMessage(message);
});

resetButton.addEventListener("click", () => {
  sessionId = crypto.randomUUID();
  localStorage.setItem("construrio-session-id", sessionId);
  messagesEl.replaceChildren();
  handoffPanel.hidden = true;
  handoffSummary.textContent = "";
  appendMessage(
    "bot",
    "Conversa reiniciada. Como posso ajudar no atendimento da ConstruRio?"
  );
  renderQuickActions(initialQuickReplies);
  input.focus();
});

async function sendMessage(message) {
  appendMessage("user", message);
  setComposerState(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sessionId, message })
    });

    const result = await response.json();
    sessionId = result.sessionId || sessionId;
    localStorage.setItem("construrio-session-id", sessionId);

    appendMessage("bot", result.reply);
    renderQuickActions(result.quickReplies || initialQuickReplies);

    if (result.needsHuman && result.summary) {
      handoffSummary.textContent = result.summary;
      handoffPanel.hidden = false;
    }
  } catch {
    appendMessage(
      "bot",
      "Nao consegui responder agora. Chame um atendente para continuar o atendimento."
    );
  } finally {
    setComposerState(false);
    input.focus();
  }
}

function appendMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderQuickActions(actions) {
  quickActionsEl.replaceChildren();

  actions.slice(0, 6).forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action;
    button.addEventListener("click", () => sendMessage(action));
    quickActionsEl.appendChild(button);
  });
}

function setComposerState(isLoading) {
  input.disabled = isLoading;
  form.querySelector("button").disabled = isLoading;
}

function renderOpenStatus() {
  const nowParts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const weekday = nowParts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(nowParts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(nowParts.find((part) => part.type === "minute")?.value || 0);
  const time = hour * 60 + minute;
  const day = normalizeWeekday(weekday);

  const isWeekday = ["seg", "ter", "qua", "qui", "sex"].includes(day);
  const isSaturday = day === "sab";
  const open =
    (isWeekday && time >= 8 * 60 && time < 18 * 60) ||
    (isSaturday && time >= 8 * 60 && time < 14 * 60);

  openStatus.textContent = open ? "Aberta" : "Fechada";
}

function normalizeWeekday(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(".", "")
    .toLowerCase()
    .slice(0, 3);
}
