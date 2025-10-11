import { DEFAULT_PROMPTS, STORAGE_KEYS } from "../common/prompts.js";

const state = {
  prompts: [],
  defaultPromptMap: new Map(),
  runtimeConfig: {
    defaultApiKey: ""
  }
};

const elements = {
  apiKeyInput: document.getElementById("api-key-input"),
  toggleKeyVisibility: document.getElementById("toggle-key-visibility"),
  saveKey: document.getElementById("save-key"),
  clearKey: document.getElementById("clear-key"),
  keyStatus: document.getElementById("key-status"),
  promptsList: document.getElementById("prompts-list"),
  addPrompt: document.getElementById("add-prompt")
};

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

initOptionsPage();

async function initOptionsPage() {
  await loadRuntimeConfig();
  await loadPrompts();
  await loadApiKey();
  bindEvents();
  renderPrompts();
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch(chrome.runtime.getURL("../config/runtimeConfig.json"));
    if (response.ok) {
      state.runtimeConfig = await response.json();
    }
  } catch (error) {
    // Fail silently; runtime config is optional.
    console.warn("Gemini Slides Reviewer: runtime config unavailable.", error);
  }
}

async function loadPrompts() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.PROMPTS);
  const storedPrompts = stored?.[STORAGE_KEYS.PROMPTS];
  state.prompts = Array.isArray(storedPrompts) && storedPrompts.length > 0
    ? clone(storedPrompts)
    : clone(DEFAULT_PROMPTS);
  state.defaultPromptMap = new Map(DEFAULT_PROMPTS.map((prompt) => [prompt.id, prompt]));
}

async function loadApiKey() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.API_KEY);
  const key = stored?.[STORAGE_KEYS.API_KEY];
  const fallback = state.runtimeConfig?.defaultApiKey;
  if (elements.apiKeyInput) {
    elements.apiKeyInput.value = key || fallback || "";
  }
}

function bindEvents() {
  if (elements.toggleKeyVisibility) {
    elements.toggleKeyVisibility.addEventListener("click", () => {
      if (!elements.apiKeyInput) return;
      const newType = elements.apiKeyInput.type === "password" ? "text" : "password";
      elements.apiKeyInput.type = newType;
      elements.toggleKeyVisibility.textContent = newType === "password" ? "Show" : "Hide";
    });
  }

  if (elements.saveKey) {
    elements.saveKey.addEventListener("click", async () => {
      if (!elements.apiKeyInput) return;
      const value = elements.apiKeyInput.value.trim();
      if (!value) {
        showKeyStatus("Enter your Gemini API key before saving.", "error");
        return;
      }
      await chrome.storage.sync.set({
        [STORAGE_KEYS.API_KEY]: value
      });
      showKeyStatus("API key saved.", "success");
    });
  }

  if (elements.clearKey) {
    elements.clearKey.addEventListener("click", async () => {
      await chrome.storage.sync.remove(STORAGE_KEYS.API_KEY);
      if (elements.apiKeyInput) {
        elements.apiKeyInput.value = "";
      }
      showKeyStatus("API key removed.", "success");
    });
  }

  if (elements.addPrompt) {
    elements.addPrompt.addEventListener("click", () => {
      const newId = generateUniquePromptId("custom");
      state.prompts.push({
        id: newId,
        label: "Custom prompt",
        prompt: "Describe the review you want Gemini to run for your slide deck."
      });
      persistPrompts();
      renderPrompts();
    });
  }
}

function renderPrompts() {
  if (!elements.promptsList) return;
  elements.promptsList.innerHTML = "";
  state.prompts.forEach((prompt) => {
    elements.promptsList.appendChild(createPromptCard(prompt));
  });
}

function createPromptCard(prompt) {
  const card = document.createElement("article");
  card.className = "prompt-card";
  card.dataset.promptId = prompt.id;

  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = prompt.label;
  header.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `ID: ${prompt.id}`;
  header.appendChild(meta);

  card.appendChild(header);

  const labelField = document.createElement("div");
  labelField.className = "field";
  const labelLabel = document.createElement("label");
  labelLabel.textContent = "Display name";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.value = prompt.label;
  labelInput.placeholder = "Clarity check";
  labelField.appendChild(labelLabel);
  labelField.appendChild(labelInput);
  card.appendChild(labelField);

  const promptField = document.createElement("div");
  promptField.className = "field";
  const promptLabel = document.createElement("label");
  promptLabel.textContent = "Prompt text";
  const promptTextarea = document.createElement("textarea");
  promptTextarea.value = prompt.prompt;
  promptField.appendChild(promptLabel);
  promptField.appendChild(promptTextarea);
  card.appendChild(promptField);

  const actions = document.createElement("div");
  actions.className = "prompt-actions";
  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.className = "primary";

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset to default";
  resetBtn.className = "ghost";

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.className = "destructive";

  actions.appendChild(saveBtn);
  actions.appendChild(resetBtn);
  actions.appendChild(deleteBtn);
  card.appendChild(actions);

  saveBtn.addEventListener("click", () => {
    const updatedPrompt = {
      id: prompt.id,
      label: labelInput.value.trim() || prompt.label,
      prompt: promptTextarea.value.trim()
    };
    updatePrompt(updatedPrompt);
    title.textContent = updatedPrompt.label;
  });

  resetBtn.addEventListener("click", () => {
    const defaultPrompt = state.defaultPromptMap.get(prompt.id);
    if (!defaultPrompt) {
      promptTextarea.value = prompt.prompt;
      labelInput.value = prompt.label;
      return;
    }
    labelInput.value = defaultPrompt.label;
    promptTextarea.value = defaultPrompt.prompt;
    updatePrompt(defaultPrompt);
    title.textContent = defaultPrompt.label;
  });

  deleteBtn.addEventListener("click", () => {
    removePrompt(prompt.id);
    card.remove();
  });

  return card;
}

function updatePrompt(updatedPrompt) {
  const index = state.prompts.findIndex((prompt) => prompt.id === updatedPrompt.id);
  if (index === -1) return;
  state.prompts[index] = {
    ...state.prompts[index],
    ...updatedPrompt
  };
  persistPrompts();
}

function removePrompt(id) {
  if (state.prompts.length <= 1) {
    alert("Keep at least one prompt preset.");
    return;
  }
  state.prompts = state.prompts.filter((prompt) => prompt.id !== id);
  persistPrompts();
}

function persistPrompts() {
  chrome.storage.sync.set({
    [STORAGE_KEYS.PROMPTS]: state.prompts
  });
}

function showKeyStatus(message, variant) {
  if (!elements.keyStatus) return;
  elements.keyStatus.textContent = message;
  elements.keyStatus.className = `status ${variant || ""}`;
}

function generateUniquePromptId(base) {
  const sanitized = base.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "prompt";
  let candidate = sanitized;
  let counter = 1;
  const ids = new Set(state.prompts.map((prompt) => prompt.id));
  while (ids.has(candidate)) {
    candidate = `${sanitized}-${counter++}`;
  }
  return candidate;
}
