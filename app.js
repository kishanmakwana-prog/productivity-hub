const storageKeys = {
  tasks: "dailyTools.tasks",
  note: "dailyTools.note",
  theme: "dailyTools.theme"
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

let tasks = loadJson(storageKeys.tasks, []);
let taskFilter = "all";
let timerInterval = null;
let timerRemaining = 5 * 60;
let timerRunning = false;
let stopwatchInterval = null;
let stopwatchStartTime = 0;
let stopwatchElapsed = 0;
let stopwatchRunning = false;

function loadJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function updateClock() {
  const now = new Date();
  $("#timeNow").textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  $("#dateNow").textContent = now.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  $("#themeToggle").textContent = theme === "dark" ? "Light" : "Dark";
  localStorage.setItem(storageKeys.theme, theme);
}

function renderTasks() {
  const list = $("#taskList");
  list.innerHTML = "";

  const visibleTasks = tasks.filter((task) => {
    if (taskFilter === "open") return !task.done;
    if (taskFilter === "done") return task.done;
    return true;
  });

  visibleTasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = `task-item${task.done ? " done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Mark ${task.text} done`);
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      saveJson(storageKeys.tasks, tasks);
      renderTasks();
    });

    const text = document.createElement("span");
    text.textContent = task.text;

    const remove = document.createElement("button");
    remove.className = "button ghost";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      tasks = tasks.filter((itemTask) => itemTask.id !== task.id);
      saveJson(storageKeys.tasks, tasks);
      renderTasks();
    });

    item.append(checkbox, text, remove);
    list.append(item);
  });

  $("#taskEmpty").classList.toggle("hidden", visibleTasks.length > 0);
}

function initTasks() {
  $("#taskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#taskInput");
    const text = input.value.trim();
    if (!text) return;

    tasks.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      text,
      done: false,
      createdAt: new Date().toISOString()
    });
    input.value = "";
    saveJson(storageKeys.tasks, tasks);
    renderTasks();
  });

  $$(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      taskFilter = button.dataset.filter;
      $$(".segment").forEach((segment) => segment.classList.remove("active"));
      button.classList.add("active");
      renderTasks();
    });
  });

  $("#clearDone").addEventListener("click", () => {
    tasks = tasks.filter((task) => !task.done);
    saveJson(storageKeys.tasks, tasks);
    renderTasks();
  });

  renderTasks();
}

function updateNoteStats() {
  const note = $("#notePad").value;
  const words = countWords(note);
  $("#noteCount").textContent = `${words} word${words === 1 ? "" : "s"}`;
}

function initNotes() {
  const notePad = $("#notePad");
  notePad.value = localStorage.getItem(storageKeys.note) || "";
  updateNoteStats();

  notePad.addEventListener("input", () => {
    localStorage.setItem(storageKeys.note, notePad.value);
    $("#noteStatus").textContent = "Saved locally";
    updateNoteStats();
  });

  $("#copyNote").addEventListener("click", () => copyText(notePad.value, "Note copied"));
  $("#clearNote").addEventListener("click", () => {
    notePad.value = "";
    localStorage.setItem(storageKeys.note, "");
    updateNoteStats();
  });
}

function initCalculator() {
  const display = $("#calcDisplay");

  $("[data-calc='=']").addEventListener("click", () => evaluateCalculator());
  $$(".calc-grid button").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.calc;
      if (value === "=") return;
      display.value += value;
      display.focus();
    });
  });

  $("#calcClear").addEventListener("click", () => {
    display.value = "";
    display.focus();
  });

  display.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      evaluateCalculator();
    }
  });
}

function evaluateCalculator() {
  const display = $("#calcDisplay");
  const expression = display.value.replace(/x/gi, "*").trim();
  if (!expression) return;
  if (!/^[\d+\-*/().%\s]+$/.test(expression)) {
    display.value = "Invalid";
    return;
  }

  try {
    const result = Function(`"use strict"; return (${expression})`)();
    display.value = Number.isFinite(result) ? roundNumber(result) : "Error";
  } catch {
    display.value = "Error";
  }
}

const units = {
  length: {
    Meter: 1,
    Kilometer: 1000,
    Centimeter: 0.01,
    Inch: 0.0254,
    Foot: 0.3048,
    Mile: 1609.344
  },
  weight: {
    Kilogram: 1,
    Gram: 0.001,
    Pound: 0.45359237,
    Ounce: 0.0283495231
  },
  temperature: {
    Celsius: "c",
    Fahrenheit: "f",
    Kelvin: "k"
  }
};

function fillUnitSelects() {
  const type = $("#convertType").value;
  const from = $("#fromUnit");
  const to = $("#toUnit");
  const names = Object.keys(units[type]);

  from.innerHTML = "";
  to.innerHTML = "";
  names.forEach((name) => {
    from.add(new Option(name, name));
    to.add(new Option(name, name));
  });

  to.selectedIndex = Math.min(1, names.length - 1);
  convertUnits();
}

function convertUnits() {
  const type = $("#convertType").value;
  const value = parseFloat($("#convertInput").value);
  const output = $("#convertOutput");
  if (!Number.isFinite(value)) {
    output.value = "";
    return;
  }

  const from = $("#fromUnit").value;
  const to = $("#toUnit").value;

  if (type === "temperature") {
    output.value = roundNumber(convertTemperature(value, from, to));
    return;
  }

  const baseValue = value * units[type][from];
  output.value = roundNumber(baseValue / units[type][to]);
}

function convertTemperature(value, from, to) {
  let celsius = value;
  if (from === "Fahrenheit") celsius = (value - 32) * (5 / 9);
  if (from === "Kelvin") celsius = value - 273.15;

  if (to === "Fahrenheit") return celsius * (9 / 5) + 32;
  if (to === "Kelvin") return celsius + 273.15;
  return celsius;
}

function initConverter() {
  $("#convertType").addEventListener("change", fillUnitSelects);
  ["convertInput", "fromUnit", "toUnit"].forEach((id) => {
    $(`#${id}`).addEventListener("input", convertUnits);
    $(`#${id}`).addEventListener("change", convertUnits);
  });
  fillUnitSelects();
}

function initMoney() {
  ["billAmount", "tipPercent", "splitPeople"].forEach((id) => {
    $(`#${id}`).addEventListener("input", calculateMoney);
  });
  calculateMoney();
}

function calculateMoney() {
  const bill = parseFloat($("#billAmount").value) || 0;
  const tipPercent = parseFloat($("#tipPercent").value) || 0;
  const people = Math.max(1, parseInt($("#splitPeople").value, 10) || 1);
  const tip = bill * (tipPercent / 100);
  const total = bill + tip;

  $("#tipResult").textContent = formatMoney(tip);
  $("#totalResult").textContent = formatMoney(total);
  $("#eachResult").textContent = formatMoney(total / people);
}

function initTimer() {
  $("#timerMinutes").addEventListener("input", resetTimerFromInput);
  $("#timerStart").addEventListener("click", toggleTimer);
  $("#timerReset").addEventListener("click", resetTimerFromInput);
  resetTimerFromInput();
}

function resetTimerFromInput() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerRunning = false;
  timerRemaining = Math.max(1, parseInt($("#timerMinutes").value, 10) || 5) * 60;
  $("#timerStart").textContent = "Start";
  renderTimer();
}

function toggleTimer() {
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    $("#timerStart").textContent = "Start";
    return;
  }

  timerRunning = true;
  $("#timerStart").textContent = "Pause";
  timerInterval = setInterval(() => {
    timerRemaining -= 1;
    renderTimer();
    if (timerRemaining <= 0) {
      clearInterval(timerInterval);
      timerRunning = false;
      $("#timerStart").textContent = "Start";
      $("#timerDisplay").textContent = "Done";
    }
  }, 1000);
}

function renderTimer() {
  $("#timerDisplay").textContent = formatMinutesSeconds(timerRemaining);
}

function initStopwatch() {
  $("#stopwatchStart").addEventListener("click", toggleStopwatch);
  $("#stopwatchLap").addEventListener("click", addLap);
  $("#stopwatchReset").addEventListener("click", resetStopwatch);
  renderStopwatch();
}

function toggleStopwatch() {
  if (stopwatchRunning) {
    clearInterval(stopwatchInterval);
    stopwatchElapsed = Date.now() - stopwatchStartTime;
    stopwatchRunning = false;
    $("#stopwatchStart").textContent = "Start";
    return;
  }

  stopwatchStartTime = Date.now() - stopwatchElapsed;
  stopwatchRunning = true;
  $("#stopwatchStart").textContent = "Pause";
  stopwatchInterval = setInterval(renderStopwatch, 100);
}

function resetStopwatch() {
  clearInterval(stopwatchInterval);
  stopwatchElapsed = 0;
  stopwatchRunning = false;
  $("#stopwatchStart").textContent = "Start";
  $("#lapList").innerHTML = "";
  renderStopwatch();
}

function addLap() {
  const elapsed = stopwatchRunning ? Date.now() - stopwatchStartTime : stopwatchElapsed;
  if (elapsed <= 0) return;

  const lap = document.createElement("li");
  lap.textContent = formatStopwatch(elapsed);
  $("#lapList").prepend(lap);
}

function renderStopwatch() {
  const elapsed = stopwatchRunning ? Date.now() - stopwatchStartTime : stopwatchElapsed;
  $("#stopwatchDisplay").textContent = formatStopwatch(elapsed);
}

function initPassword() {
  const length = $("#passwordLength");
  length.addEventListener("input", () => {
    $("#passwordLengthValue").textContent = length.value;
  });

  $("#generatePassword").addEventListener("click", generatePassword);
  $("#copyPassword").addEventListener("click", () => copyText($("#passwordOutput").value, "Password copied"));
  $$(".check-grid input").forEach((input) => input.addEventListener("change", generatePassword));
  generatePassword();
}

function generatePassword() {
  const pools = [
    $("#useUpper").checked ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "",
    $("#useLower").checked ? "abcdefghijkmnopqrstuvwxyz" : "",
    $("#useNumbers").checked ? "23456789" : "",
    $("#useSymbols").checked ? "!@#$%^&*()-_=+[]{};:,.?" : ""
  ].filter(Boolean);

  if (!pools.length) {
    $("#passwordOutput").value = "Select at least one option";
    return;
  }

  const length = parseInt($("#passwordLength").value, 10);
  const allChars = pools.join("");
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let password = "";

  for (let i = 0; i < length; i += 1) {
    password += allChars[bytes[i] % allChars.length];
  }

  $("#passwordOutput").value = password;
}

function initTextTools() {
  const textInput = $("#textInput");
  textInput.addEventListener("input", updateTextStats);
  $("#copyText").addEventListener("click", () => copyText(textInput.value, "Text copied"));

  $$("[data-text-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.textAction;
      if (action === "upper") textInput.value = textInput.value.toUpperCase();
      if (action === "lower") textInput.value = textInput.value.toLowerCase();
      if (action === "title") textInput.value = toTitleCase(textInput.value);
      if (action === "trim") textInput.value = textInput.value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      updateTextStats();
    });
  });

  updateTextStats();
}

function updateTextStats() {
  const text = $("#textInput").value;
  const chars = text.length;
  const words = countWords(text);
  $("#textStats").textContent = `${chars} char${chars === 1 ? "" : "s"}, ${words} word${words === 1 ? "" : "s"}`;
  $("#readingTime").textContent = `${Math.max(0, Math.ceil(words / 200))} min read`;
}

function initDecisionPicker() {
  $("#pickDecision").addEventListener("click", () => {
    const options = $("#decisionInput").value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (!options.length) {
      $("#decisionResult").textContent = "Add options, then pick.";
      return;
    }

    const index = Math.floor(Math.random() * options.length);
    $("#decisionResult").textContent = options[index];
  });
}

function initSearch() {
  $("#toolSearch").addEventListener("input", (event) => {
    const query = event.target.value.toLowerCase().trim();
    let visibleCount = 0;

    $$(".tool-card").forEach((card) => {
      const text = `${card.dataset.tool} ${card.textContent}`.toLowerCase();
      const visible = !query || text.includes(query);
      card.classList.toggle("hidden", !visible);
      if (visible) visibleCount += 1;
    });

    $("#noTools").classList.toggle("hidden", visibleCount > 0);
  });
}

async function copyText(text, successMessage) {
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("Copy failed");
  }
}

function showToast(message) {
  let toast = $("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.append(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function toTitleCase(text) {
  return text.toLowerCase().replace(/\b[\w']+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function roundNumber(value) {
  return String(Math.round((value + Number.EPSILON) * 1000000) / 1000000);
}

function formatMoney(value) {
  return value.toLocaleString([], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatMinutesSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatStopwatch(ms) {
  const tenths = Math.floor((ms % 1000) / 100);
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function boot() {
  updateClock();
  setInterval(updateClock, 1000);

  applyTheme(localStorage.getItem(storageKeys.theme) || "light");
  $("#themeToggle").addEventListener("click", () => {
    applyTheme(document.body.classList.contains("dark") ? "light" : "dark");
  });

  initTasks();
  initNotes();
  initCalculator();
  initConverter();
  initMoney();
  initTimer();
  initStopwatch();
  initPassword();
  initTextTools();
  initDecisionPicker();
  initSearch();
}

document.addEventListener("DOMContentLoaded", boot);
