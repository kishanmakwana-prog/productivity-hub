const STORE_KEY = "productivityHub.state.v1";
const LEGACY_TASKS_KEY = "dailyTools.tasks";
const LEGACY_NOTE_KEY = "dailyTools.note";
const LEGACY_THEME_KEY = "dailyTools.theme";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const priorityWeight = { High: 1, Medium: 2, Low: 3 };
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const unitMap = {
  length: { Meter: 1, Kilometer: 1000, Centimeter: 0.01, Inch: 0.0254, Foot: 0.3048, Mile: 1609.344 },
  weight: { Kilogram: 1, Gram: 0.001, Pound: 0.45359237, Ounce: 0.0283495231 },
  temperature: { Celsius: "c", Fahrenheit: "f", Kelvin: "k" }
};

let state = loadState();
let activeSection = "dashboard";
let selectedPlannerDate = todayKey();
let calendarCursor = parseDateKey(todayKey());
let selectedNoteId = state.notes[0]?.id || null;
let isHydratingNote = false;
let timerInterval = null;
let timerRemaining = 5 * 60;
let timerRunning = false;
let stopwatchInterval = null;
let stopwatchStartTime = 0;
let stopwatchElapsed = 0;
let stopwatchRunning = false;

function defaultState() {
  return {
    version: 1,
    legacyMigrated: false,
    settings: { mode: "light", theme: "ocean" },
    tasks: [],
    notes: [],
    expenses: [],
    events: [],
    reminders: [],
    planner: { daily: {}, weekly: {} },
    water: { date: todayKey(), count: 0, target: 8 },
    backups: []
  };
}

function loadState() {
  const base = defaultState();
  let stored = loadJson(STORE_KEY, null);
  let next = stored && typeof stored === "object" ? stored : base;
  next = {
    ...base,
    ...next,
    settings: { ...base.settings, ...(next.settings || {}) },
    planner: {
      daily: { ...(next.planner?.daily || {}) },
      weekly: { ...(next.planner?.weekly || {}) }
    },
    water: { ...base.water, ...(next.water || {}) },
    backups: Array.isArray(next.backups) ? next.backups : []
  };

  next.tasks = Array.isArray(next.tasks) ? next.tasks : [];
  next.notes = Array.isArray(next.notes) ? next.notes : [];
  next.expenses = Array.isArray(next.expenses) ? next.expenses : [];
  next.events = Array.isArray(next.events) ? next.events : [];
  next.reminders = Array.isArray(next.reminders) ? next.reminders : [];

  if (!next.legacyMigrated) {
    migrateLegacyData(next);
  }

  next.tasks = next.tasks.map(normalizeTask);
  next.notes = next.notes.map(normalizeNote);
  next.expenses = next.expenses.map(normalizeExpense);
  next.events = next.events.map(normalizeEvent);
  next.reminders = next.reminders.map(normalizeReminder);
  normalizeWater(next);
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
  return next;
}

function migrateLegacyData(next) {
  const legacyTasks = loadJson(LEGACY_TASKS_KEY, []);
  if (Array.isArray(legacyTasks)) {
    legacyTasks.forEach((task) => {
      if (task?.text) {
        next.tasks.push({
          id: uid(),
          title: task.text,
          priority: "Medium",
          category: "General",
          dueDate: todayKey(),
          done: Boolean(task.done),
          createdAt: task.createdAt || new Date().toISOString(),
          completedAt: task.done ? new Date().toISOString() : null
        });
      }
    });
  }

  const legacyNote = localStorage.getItem(LEGACY_NOTE_KEY);
  if (legacyNote && legacyNote.trim()) {
    next.notes.push({
      id: uid(),
      title: "Quick note",
      category: "General",
      favorite: false,
      html: escapeHtml(legacyNote).replace(/\n/g, "<br>"),
      plain: legacyNote,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
  if (legacyTheme === "dark") {
    next.settings.mode = "dark";
  }

  next.legacyMigrated = true;
}

function normalizeTask(task) {
  const createdAt = task.createdAt || new Date().toISOString();
  return {
    id: task.id || uid(),
    title: task.title || task.text || "Untitled task",
    priority: ["High", "Medium", "Low"].includes(task.priority) ? task.priority : "Medium",
    category: task.category || "General",
    dueDate: task.dueDate || "",
    done: Boolean(task.done),
    createdAt,
    completedAt: task.done ? task.completedAt || createdAt : null
  };
}

function normalizeNote(note) {
  const html = note.html || escapeHtml(note.plain || "").replace(/\n/g, "<br>");
  return {
    id: note.id || uid(),
    title: note.title || "Untitled note",
    category: note.category || "General",
    favorite: Boolean(note.favorite),
    html,
    plain: note.plain || stripHtml(html),
    createdAt: note.createdAt || new Date().toISOString(),
    updatedAt: note.updatedAt || note.createdAt || new Date().toISOString()
  };
}

function normalizeExpense(expense) {
  return {
    id: expense.id || uid(),
    date: expense.date || todayKey(),
    amount: Number(expense.amount) || 0,
    category: expense.category || "General",
    note: expense.note || "",
    createdAt: expense.createdAt || new Date().toISOString()
  };
}

function normalizeEvent(event) {
  return {
    id: event.id || uid(),
    title: event.title || "Untitled event",
    date: event.date || todayKey(),
    time: event.time || "",
    type: event.type || "Event",
    createdAt: event.createdAt || new Date().toISOString()
  };
}

function normalizeReminder(reminder) {
  return {
    id: reminder.id || uid(),
    type: reminder.type || "Custom",
    title: reminder.title || "Reminder",
    time: reminder.time || "",
    interval: Math.max(5, Number(reminder.interval) || 60),
    active: reminder.active !== false,
    nextAt: reminder.nextAt || nextReminderTime(reminder.time || "", Number(reminder.interval) || 60).toISOString(),
    createdAt: reminder.createdAt || new Date().toISOString()
  };
}

function normalizeWater(target = state) {
  if (!target.water || target.water.date !== todayKey()) {
    target.water = { date: todayKey(), count: 0, target: 8 };
  }
}

function saveState({ render = true } = {}) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (render) renderAll();
}

function boot() {
  applySettings();
  seedDateInputs();
  initNavigation();
  initTasks();
  initPlanner();
  initExpenses();
  initReminders();
  initNotes();
  initTools();
  initAiTools();
  initDataManagement();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(checkReminders, 30000);
  renderAll();
}

function applySettings() {
  document.body.classList.toggle("dark", state.settings.mode === "dark");
  document.body.dataset.theme = state.settings.theme || "ocean";
  $("#themeModeToggle").textContent = state.settings.mode === "dark" ? "Light" : "Dark";
  $("#themeSelect").value = state.settings.theme || "ocean";
}

function seedDateInputs() {
  const today = todayKey();
  $("#taskDueDate").value = today;
  $("#plannerDate").value = today;
  $("#weekPicker").value = today;
  $("#eventDate").value = today;
  $("#expenseDate").value = today;
  $("#expenseMonth").value = today.slice(0, 7);
}

function initNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });

  $("#quickAddTask").addEventListener("click", () => {
    showSection("tasks");
    $("#taskTitle").focus();
  });

  $("#themeModeToggle").addEventListener("click", () => {
    state.settings.mode = state.settings.mode === "dark" ? "light" : "dark";
    applySettings();
    saveState({ render: false });
    renderCharts();
  });

  $("#themeSelect").addEventListener("change", (event) => {
    state.settings.theme = event.target.value;
    applySettings();
    saveState({ render: false });
    renderCharts();
  });

  $("#globalSearch").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    if (query.length < 2) return;
    const match = $$(".section").find((section) => {
      const haystack = `${section.dataset.title || ""} ${section.dataset.keywords || ""}`.toLowerCase();
      return haystack.includes(query);
    });
    if (match && match.id !== activeSection) showSection(match.id);
  });
}

function showSection(id) {
  activeSection = id;
  $$(".section").forEach((section) => section.classList.toggle("active", section.id === id));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.section === id));
  const section = $(`#${id}`);
  $("#sectionEyebrow").textContent = section?.dataset.title?.split(" ")[0] || "Hub";
  $("#sectionTitle").textContent = section?.dataset.title || "Productivity Hub";
  renderCharts();
}

function initTasks() {
  $("#taskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#taskTitle").value.trim();
    if (!title) return;
    state.tasks.unshift({
      id: uid(),
      title,
      priority: $("#taskPriority").value,
      category: $("#taskCategory").value.trim() || "General",
      dueDate: $("#taskDueDate").value,
      done: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    });
    $("#taskTitle").value = "";
    saveState();
    showToast("Task added");
  });

  $("#taskList").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-task-toggle]");
    if (!checkbox) return;
    const task = state.tasks.find((item) => item.id === checkbox.dataset.taskToggle);
    if (!task) return;
    task.done = checkbox.checked;
    task.completedAt = task.done ? new Date().toISOString() : null;
    saveState();
  });

  $("#taskList").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-task-delete]");
    if (!remove) return;
    state.tasks = state.tasks.filter((task) => task.id !== remove.dataset.taskDelete);
    saveState();
  });

  $("#clearCompletedTasks").addEventListener("click", () => {
    if (!state.tasks.some((task) => task.done)) return;
    if (!confirm("Clear all completed tasks?")) return;
    state.tasks = state.tasks.filter((task) => !task.done);
    saveState();
  });

  ["taskStatusFilter", "taskPriorityFilter", "taskCategoryFilter", "taskSort"].forEach((id) => {
    $(`#${id}`).addEventListener("change", renderTasks);
  });
}

function renderTasks() {
  renderTaskCategoryControls();
  const list = $("#taskList");
  const status = $("#taskStatusFilter").value;
  const priority = $("#taskPriorityFilter").value;
  const category = $("#taskCategoryFilter").value;
  const sort = $("#taskSort").value;
  const today = todayKey();

  let tasks = state.tasks.filter((task) => {
    if (status === "open" && task.done) return false;
    if (status === "done" && !task.done) return false;
    if (status === "today" && task.dueDate !== today) return false;
    if (status === "overdue" && (task.done || !task.dueDate || task.dueDate >= today)) return false;
    if (priority !== "all" && task.priority !== priority) return false;
    if (category !== "all" && task.category !== category) return false;
    return true;
  });

  tasks = tasks.sort((a, b) => {
    if (sort === "priority") return priorityWeight[a.priority] - priorityWeight[b.priority];
    if (sort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31");
  });

  list.innerHTML = tasks.map((task) => {
    const overdue = task.dueDate && task.dueDate < today && !task.done;
    const dueText = task.dueDate ? formatDate(task.dueDate) : "No due date";
    return `
      <li class="task-item ${task.done ? "done" : ""}">
        <div class="task-main">
          <input type="checkbox" data-task-toggle="${task.id}" ${task.done ? "checked" : ""} aria-label="Complete ${escapeHtml(task.title)}">
          <div>
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-meta">
              <span class="priority-badge priority-${task.priority.toLowerCase()}">${task.priority}</span>
              <span>${escapeHtml(task.category)}</span>
              <span>${overdue ? "Overdue: " : "Due: "}${dueText}</span>
            </div>
          </div>
          <button class="button ghost" type="button" data-task-delete="${task.id}">Delete</button>
        </div>
      </li>
    `;
  }).join("");

  $("#taskEmpty").classList.toggle("hidden", tasks.length > 0);
  renderTaskProgress();
}

function renderTaskCategoryControls() {
  const categories = unique(state.tasks.map((task) => task.category || "General")).sort();
  $("#taskCategoryList").innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
  const filter = $("#taskCategoryFilter");
  const current = filter.value;
  filter.innerHTML = `<option value="all">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  filter.value = categories.includes(current) ? current : "all";
}

function renderTaskProgress() {
  const total = state.tasks.length;
  const complete = state.tasks.filter((task) => task.done).length;
  const allPercent = percent(complete, total);
  const todaysTasks = getTodaysTasks();
  const todayComplete = todaysTasks.filter((task) => task.done).length;
  const todayPercent = percent(todayComplete, todaysTasks.length);
  const streak = calculateStreaks();

  setText("taskCompletionLabel", `${allPercent}%`);
  setText("todayCompletionLabel", `${todayPercent}%`);
  setWidth("taskCompletionBar", allPercent);
  setWidth("todayCompletionBar", todayPercent);
  setText("streak7", streak.last7);
  setText("streak30", streak.last30);
  setText("streakAll", `${streak.best}d`);
}

function initPlanner() {
  $("#prevMonth").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  $("#nextMonth").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    renderCalendar();
  });
  $("#todayMonth").addEventListener("click", () => {
    selectedPlannerDate = todayKey();
    calendarCursor = parseDateKey(todayKey());
    $("#plannerDate").value = selectedPlannerDate;
    renderPlanner();
  });
  $("#calendarGrid").addEventListener("click", (event) => {
    const day = event.target.closest("[data-calendar-date]");
    if (!day) return;
    selectedPlannerDate = day.dataset.calendarDate;
    $("#plannerDate").value = selectedPlannerDate;
    renderPlanner();
  });
  $("#plannerDate").addEventListener("change", (event) => {
    selectedPlannerDate = event.target.value || todayKey();
    calendarCursor = parseDateKey(selectedPlannerDate);
    renderPlanner();
  });
  $("#dailyFocus").addEventListener("input", saveDailyPlan);
  $("#dailySchedule").addEventListener("input", saveDailyPlan);
  $("#weekPicker").addEventListener("change", renderWeeklyPlanner);
  $("#weeklyPlanner").addEventListener("input", (event) => {
    const textarea = event.target.closest("[data-week-plan]");
    if (!textarea) return;
    state.planner.weekly[textarea.dataset.weekPlan] = textarea.value;
    saveState({ render: false });
  });
  $("#eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#eventTitle").value.trim();
    if (!title) return;
    const newEvent = {
      id: uid(),
      title,
      date: $("#eventDate").value || todayKey(),
      time: $("#eventTime").value,
      type: $("#eventType").value,
      createdAt: new Date().toISOString()
    };
    state.events.push(newEvent);
    if ($("#eventReminder").checked) {
      state.reminders.push({
        id: uid(),
        type: newEvent.type === "Meeting" ? "Meeting" : "Custom",
        title: newEvent.title,
        time: newEvent.time,
        interval: 1440,
        active: true,
        nextAt: eventReminderTime(newEvent).toISOString(),
        createdAt: new Date().toISOString()
      });
    }
    $("#eventTitle").value = "";
    $("#eventTime").value = "";
    $("#eventReminder").checked = false;
    saveState();
  });
  $("#eventList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-delete]");
    if (!button) return;
    state.events = state.events.filter((item) => item.id !== button.dataset.eventDelete);
    saveState();
  });
}

function renderPlanner() {
  $("#plannerDate").value = selectedPlannerDate;
  $("#plannerDateLabel").textContent = formatDate(selectedPlannerDate, { weekday: "long", month: "short", day: "numeric" });
  const plan = state.planner.daily[selectedPlannerDate] || { focus: "", schedule: "" };
  $("#dailyFocus").value = plan.focus || "";
  $("#dailySchedule").value = plan.schedule || "";
  renderCalendar();
  renderWeeklyPlanner();
  renderEvents();
}

function saveDailyPlan() {
  state.planner.daily[selectedPlannerDate] = {
    focus: $("#dailyFocus").value,
    schedule: $("#dailySchedule").value
  };
  saveState({ render: false });
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $("#calendarTitle").textContent = calendarCursor.toLocaleDateString([], { month: "long", year: "numeric" });
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());
  const days = [];

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    const key = toDateKey(date);
    const count = state.tasks.filter((task) => task.dueDate === key).length + state.events.filter((event) => event.date === key).length;
    days.push(`
      <button class="calendar-day ${date.getMonth() !== month ? "outside" : ""} ${key === todayKey() ? "today" : ""} ${key === selectedPlannerDate ? "selected" : ""}" type="button" data-calendar-date="${key}">
        <strong>${date.getDate()}</strong>
        ${count ? `<span class="calendar-dot">${count}</span>` : ""}
      </button>
    `);
  }

  $("#calendarGrid").innerHTML = days.join("");
}

function renderWeeklyPlanner() {
  const picked = $("#weekPicker").value || selectedPlannerDate;
  const start = startOfWeek(parseDateKey(picked));
  $("#weekLabel").textContent = `${formatDate(toDateKey(start), { month: "short", day: "numeric" })} week`;
  const html = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const key = toDateKey(date);
    return `
      <label class="week-day">
        <strong>${weekdayNames[date.getDay()]} ${date.getDate()}</strong>
        <textarea class="textarea small" data-week-plan="${key}" placeholder="Plan">${escapeHtml(state.planner.weekly[key] || "")}</textarea>
      </label>
    `;
  }).join("");
  $("#weeklyPlanner").innerHTML = html;
}

function renderEvents() {
  const list = $("#eventList");
  const events = [...state.events].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, 12);
  list.innerHTML = events.length ? events.map((event) => `
    <div class="mini-item">
      <div class="card-head">
        <div>
          <strong>${escapeHtml(event.title)}</strong>
          <div class="mini-meta"><span>${formatDate(event.date)}</span><span>${event.time || "All day"}</span><span class="type-badge">${escapeHtml(event.type)}</span></div>
        </div>
        <button class="button ghost" type="button" data-event-delete="${event.id}">Delete</button>
      </div>
    </div>
  `).join("") : `<p class="empty-state">No important dates yet.</p>`;
}

function initExpenses() {
  $("#expenseForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.expenses.unshift({
      id: uid(),
      date: $("#expenseDate").value || todayKey(),
      amount: Number($("#expenseAmount").value) || 0,
      category: $("#expenseCategory").value.trim() || "General",
      note: $("#expenseNote").value.trim(),
      createdAt: new Date().toISOString()
    });
    $("#expenseAmount").value = "";
    $("#expenseNote").value = "";
    saveState();
  });

  $("#expenseTable").addEventListener("click", (event) => {
    const button = event.target.closest("[data-expense-delete]");
    if (!button) return;
    state.expenses = state.expenses.filter((expense) => expense.id !== button.dataset.expenseDelete);
    saveState();
  });

  $("#expenseMonth").addEventListener("change", renderExpenses);
  $("#exportExpensesCsv").addEventListener("click", exportExpensesCsv);
}

function renderExpenses() {
  const month = $("#expenseMonth").value || todayKey().slice(0, 7);
  const expenses = state.expenses.filter((expense) => expense.date.startsWith(month));
  $("#expenseCategoryList").innerHTML = unique(state.expenses.map((expense) => expense.category)).map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
  $("#expenseTable").innerHTML = expenses.map((expense) => `
    <tr>
      <td>${formatDate(expense.date)}</td>
      <td>${escapeHtml(expense.category)}</td>
      <td>${escapeHtml(expense.note)}</td>
      <td>${formatMoney(expense.amount)}</td>
      <td><button class="button ghost" type="button" data-expense-delete="${expense.id}">Delete</button></td>
    </tr>
  `).join("");

  const total = sum(expenses.map((expense) => expense.amount));
  const byCategory = groupSum(expenses, "category", "amount");
  const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  setText("monthExpenseTotal", formatMoney(total));
  setText("monthExpenseCount", expenses.length);
  setText("topExpenseCategory", top ? top[0] : "None");
  renderCharts();
}

function initReminders() {
  $("#enableNotifications").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      showToast("Browser notifications are not supported here");
      return;
    }
    const permission = await Notification.requestPermission();
    showToast(permission === "granted" ? "Notifications enabled" : "Notifications not enabled");
  });

  $("#reminderForm").addEventListener("submit", (event) => {
    event.preventDefault();
    addReminder({
      type: $("#reminderType").value,
      title: $("#reminderTitle").value.trim(),
      time: $("#reminderTime").value,
      interval: Number($("#reminderInterval").value) || 60
    });
    $("#reminderTitle").value = "";
  });

  $("#reminderList").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-reminder-toggle]");
    const remove = event.target.closest("[data-reminder-delete]");
    if (toggle) {
      const reminder = state.reminders.find((item) => item.id === toggle.dataset.reminderToggle);
      if (reminder) reminder.active = !reminder.active;
      saveState();
    }
    if (remove) {
      state.reminders = state.reminders.filter((item) => item.id !== remove.dataset.reminderDelete);
      saveState();
    }
  });

  $("#addWater").addEventListener("click", () => {
    normalizeWater();
    state.water.count += 1;
    saveState();
  });
  $("#resetWater").addEventListener("click", () => {
    state.water.count = 0;
    saveState();
  });
  $("#presetWaterReminder").addEventListener("click", () => addReminder({ type: "Water", title: "Drink water", interval: 60 }));
  $("#presetBreakReminder").addEventListener("click", () => addReminder({ type: "Break", title: "Take a short break", interval: 45 }));
  $("#presetMedicineReminder").addEventListener("click", () => addReminder({ type: "Medicine", title: "Take medicine", time: "21:00", interval: 1440 }));
}

function addReminder({ type, title, time = "", interval = 60 }) {
  if (!title) return;
  state.reminders.push({
    id: uid(),
    type,
    title,
    time,
    interval: Math.max(5, Number(interval) || 60),
    active: true,
    nextAt: nextReminderTime(time, interval).toISOString(),
    createdAt: new Date().toISOString()
  });
  saveState();
  showToast("Reminder created");
}

function renderReminders() {
  normalizeWater();
  setText("waterCount", `${state.water.count} / ${state.water.target}`);
  $("#reminderList").innerHTML = state.reminders.length ? state.reminders.map((reminder) => `
    <div class="mini-item">
      <div class="card-head">
        <div>
          <strong>${escapeHtml(reminder.title)}</strong>
          <div class="mini-meta"><span class="type-badge">${escapeHtml(reminder.type)}</span><span>Next: ${formatDateTime(reminder.nextAt)}</span><span>${reminder.active ? "Active" : "Paused"}</span></div>
        </div>
        <div class="button-row">
          <button class="button subtle" type="button" data-reminder-toggle="${reminder.id}">${reminder.active ? "Pause" : "Resume"}</button>
          <button class="button ghost" type="button" data-reminder-delete="${reminder.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join("") : `<p class="empty-state">No reminders yet.</p>`;
}

function checkReminders() {
  const now = new Date();
  let changed = false;
  state.reminders.forEach((reminder) => {
    if (!reminder.active) return;
    if (new Date(reminder.nextAt) <= now) {
      notifyUser(reminder.title, `${reminder.type} reminder`);
      reminder.nextAt = nextReminderTime(reminder.time, reminder.interval, now).toISOString();
      changed = true;
    }
  });
  if (changed) saveState();
}

function initNotes() {
  $("#newNote").addEventListener("click", () => createNote());
  $("#notesList").addEventListener("click", (event) => {
    const item = event.target.closest("[data-note-id]");
    if (!item) return;
    selectedNoteId = item.dataset.noteId;
    renderNotes();
  });
  $("#noteSearch").addEventListener("input", renderNotesList);
  $("#noteCategoryFilter").addEventListener("change", renderNotesList);
  $("#noteTitle").addEventListener("input", saveCurrentNote);
  $("#noteCategory").addEventListener("input", saveCurrentNote);
  $("#noteEditor").addEventListener("input", saveCurrentNote);
  $("#favoriteNote").addEventListener("click", () => {
    const note = getSelectedNote();
    if (!note) return;
    note.favorite = !note.favorite;
    note.updatedAt = new Date().toISOString();
    saveState();
  });
  $("#copyNote").addEventListener("click", () => {
    const note = getSelectedNote();
    if (note) copyText(note.plain, "Note copied");
  });
  $("#deleteNote").addEventListener("click", () => {
    const note = getSelectedNote();
    if (!note) return;
    if (!confirm(`Delete note "${note.title}"?`)) return;
    state.notes = state.notes.filter((item) => item.id !== note.id);
    selectedNoteId = state.notes[0]?.id || null;
    saveState();
  });
  $$(".editor-toolbar button").forEach((button) => {
    button.addEventListener("click", () => {
      $("#noteEditor").focus();
      document.execCommand(button.dataset.command, false, null);
      saveCurrentNote();
    });
  });
}

function createNote() {
  const now = new Date().toISOString();
  const note = {
    id: uid(),
    title: "Untitled note",
    category: "General",
    favorite: false,
    html: "",
    plain: "",
    createdAt: now,
    updatedAt: now
  };
  state.notes.unshift(note);
  selectedNoteId = note.id;
  saveState();
  $("#noteTitle").focus();
}

function getSelectedNote() {
  return state.notes.find((note) => note.id === selectedNoteId) || null;
}

function ensureNoteForEditing() {
  let note = getSelectedNote();
  if (note) return note;
  const now = new Date().toISOString();
  note = {
    id: uid(),
    title: "Untitled note",
    category: "General",
    favorite: false,
    html: "",
    plain: "",
    createdAt: now,
    updatedAt: now
  };
  state.notes.unshift(note);
  selectedNoteId = note.id;
  return note;
}

function saveCurrentNote() {
  if (isHydratingNote) return;
  const note = ensureNoteForEditing();
  note.title = $("#noteTitle").value.trim() || "Untitled note";
  note.category = $("#noteCategory").value.trim() || "General";
  note.html = $("#noteEditor").innerHTML;
  note.plain = $("#noteEditor").textContent || "";
  note.updatedAt = new Date().toISOString();
  saveState({ render: false });
  renderNotesList();
  renderDashboard();
  setText("noteStatus", "Auto-saved");
  setText("noteMeta", `${countWords(note.plain)} words`);
}

function renderNotes() {
  renderNoteCategoryFilter();
  renderNotesList();
  renderNoteEditor();
}

function renderNoteCategoryFilter() {
  const categories = unique(state.notes.map((note) => note.category || "General")).sort();
  const filter = $("#noteCategoryFilter");
  const current = filter.value;
  filter.innerHTML = `<option value="all">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  filter.value = categories.includes(current) ? current : "all";
}

function renderNotesList() {
  const query = $("#noteSearch").value.trim().toLowerCase();
  const category = $("#noteCategoryFilter").value;
  const notes = state.notes
    .filter((note) => category === "all" || note.category === category)
    .filter((note) => !query || `${note.title} ${note.category} ${note.plain}`.toLowerCase().includes(query))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt));

  $("#notesList").innerHTML = notes.length ? notes.map((note) => `
    <button class="note-item ${note.id === selectedNoteId ? "active" : ""}" type="button" data-note-id="${note.id}">
      <h4>${note.favorite ? "[Fav] " : ""}${escapeHtml(note.title)}</h4>
      <p>${escapeHtml(note.category)} - ${countWords(note.plain)} words</p>
      <p>${escapeHtml((note.plain || "Empty note").slice(0, 90))}</p>
    </button>
  `).join("") : `<p class="empty-state">No notes found.</p>`;
}

function renderNoteEditor() {
  const note = getSelectedNote();
  isHydratingNote = true;
  if (!note) {
    $("#noteTitle").value = "";
    $("#noteCategory").value = "";
    $("#noteEditor").innerHTML = "";
    setText("noteMeta", "0 words");
    setText("favoriteNote", "Favorite");
  } else {
    $("#noteTitle").value = note.title;
    $("#noteCategory").value = note.category;
    $("#noteEditor").innerHTML = note.html;
    setText("noteMeta", `${countWords(note.plain)} words`);
    setText("favoriteNote", note.favorite ? "Unfavorite" : "Favorite");
  }
  isHydratingNote = false;
}

function renderDashboard() {
  const total = state.tasks.length;
  const completed = state.tasks.filter((task) => task.done).length;
  const pending = total - completed;
  const todaysTasks = getTodaysTasks();
  const todayPercent = percent(todaysTasks.filter((task) => task.done).length, todaysTasks.length);
  const allPercent = percent(completed, total);
  const monthExpense = sum(state.expenses.filter((expense) => expense.date.startsWith(todayKey().slice(0, 7))).map((expense) => expense.amount));
  const streak = calculateStreaks();
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";

  setText("dailyGreeting", `${greeting}. Keep the day simple and focused.`);
  setText("statTotalTasks", total);
  setText("statCompletedTasks", completed);
  setText("statPendingTasks", pending);
  setText("statNotes", state.notes.length);
  setText("statMonthExpense", formatMoney(monthExpense));
  setText("statCurrentStreak", `${streak.current}d`);
  setText("dashboardScore", `${todayPercent}% focus`);
  setText("overallProgressText", `${allPercent}%`);
  setText("todayProgressText", `${todayPercent}%`);
  setWidth("overallProgressBar", allPercent);
  setWidth("todayProgressBar", todayPercent);
  const ring = $("#todayRing");
  ring.dataset.label = `${todayPercent}%`;
  ring.textContent = "";
  ring.style.setProperty("--ring", `${todayPercent}%`);

  renderDashboardUpcoming();
  renderSmartSuggestions();
}

function renderDashboardUpcoming() {
  const upcomingTasks = state.tasks
    .filter((task) => !task.done)
    .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"))
    .slice(0, 5)
    .map((task) => ({ title: task.title, meta: `${task.priority} - ${task.dueDate ? formatDate(task.dueDate) : "No due date"}` }));
  const upcomingEvents = state.events
    .filter((event) => event.date >= todayKey())
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .slice(0, 5)
    .map((event) => ({ title: event.title, meta: `${event.type} - ${formatDate(event.date)} ${event.time || ""}` }));
  const items = [...upcomingTasks, ...upcomingEvents].slice(0, 7);
  $("#dashboardUpcoming").innerHTML = items.length ? items.map((item) => `
    <div class="mini-item"><strong>${escapeHtml(item.title)}</strong><div class="mini-meta"><span>${escapeHtml(item.meta)}</span></div></div>
  `).join("") : `<p class="empty-state">Nothing urgent. Nice clean slate.</p>`;
}

function initTools() {
  initCalculator();
  initConverter();
  initMoney();
  initTimer();
  initStopwatch();
  initPassword();
  initTextTools();
  initDecisionPicker();
  initExtraCalculators();
  generatePassword();
  drawQr("Productivity Hub");
  renderBarcode("PRODUCTIVITY");
}

function initCalculator() {
  const display = $("#calcDisplay");
  $$(".calc-grid button").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.calc;
      if (value === "=") {
        evaluateCalculator();
        return;
      }
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

function initConverter() {
  $("#convertType").addEventListener("change", fillUnitSelects);
  ["convertInput", "fromUnit", "toUnit"].forEach((id) => {
    $(`#${id}`).addEventListener("input", convertUnits);
    $(`#${id}`).addEventListener("change", convertUnits);
  });
  fillUnitSelects();
}

function fillUnitSelects() {
  const type = $("#convertType").value;
  const names = Object.keys(unitMap[type]);
  $("#fromUnit").innerHTML = names.map((name) => `<option value="${name}">${name}</option>`).join("");
  $("#toUnit").innerHTML = names.map((name) => `<option value="${name}">${name}</option>`).join("");
  $("#toUnit").selectedIndex = Math.min(1, names.length - 1);
  convertUnits();
}

function convertUnits() {
  const type = $("#convertType").value;
  const value = parseFloat($("#convertInput").value);
  if (!Number.isFinite(value)) {
    $("#convertOutput").value = "";
    return;
  }
  const from = $("#fromUnit").value;
  const to = $("#toUnit").value;
  if (type === "temperature") {
    $("#convertOutput").value = roundNumber(convertTemperature(value, from, to));
    return;
  }
  $("#convertOutput").value = roundNumber((value * unitMap[type][from]) / unitMap[type][to]);
}

function convertTemperature(value, from, to) {
  let celsius = value;
  if (from === "Fahrenheit") celsius = (value - 32) * (5 / 9);
  if (from === "Kelvin") celsius = value - 273.15;
  if (to === "Fahrenheit") return celsius * (9 / 5) + 32;
  if (to === "Kelvin") return celsius + 273.15;
  return celsius;
}

function initMoney() {
  ["billAmount", "tipPercent", "splitPeople"].forEach((id) => $(`#${id}`).addEventListener("input", calculateMoney));
  calculateMoney();
}

function calculateMoney() {
  const bill = parseFloat($("#billAmount").value) || 0;
  const tipPercent = parseFloat($("#tipPercent").value) || 0;
  const people = Math.max(1, parseInt($("#splitPeople").value, 10) || 1);
  const tip = bill * (tipPercent / 100);
  const total = bill + tip;
  setText("tipResult", formatMoney(tip));
  setText("totalResult", formatMoney(total));
  setText("eachResult", formatMoney(total / people));
}

function initTimer() {
  $("#timerMinutes").addEventListener("input", resetTimerFromInput);
  $("#timerStart").addEventListener("click", toggleTimer);
  $("#timerReset").addEventListener("click", resetTimerFromInput);
  resetTimerFromInput();
}

function resetTimerFromInput() {
  clearInterval(timerInterval);
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
      notifyUser("Timer complete", "Your countdown finished");
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
  $("#passwordLength").addEventListener("input", () => setText("passwordLengthValue", $("#passwordLength").value));
  $("#generatePassword").addEventListener("click", generatePassword);
  $("#copyPassword").addEventListener("click", () => copyText($("#passwordOutput").value, "Password copied"));
  $$(".check-grid input").forEach((input) => input.addEventListener("change", generatePassword));
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
  const chars = pools.join("");
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  $("#passwordOutput").value = Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

function initTextTools() {
  $("#textInput").addEventListener("input", updateTextStats);
  $("#copyText").addEventListener("click", () => copyText($("#textInput").value, "Text copied"));
  $$("[data-text-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $("#textInput");
      if (button.dataset.textAction === "upper") input.value = input.value.toUpperCase();
      if (button.dataset.textAction === "lower") input.value = input.value.toLowerCase();
      if (button.dataset.textAction === "title") input.value = toTitleCase(input.value);
      if (button.dataset.textAction === "trim") input.value = input.value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      updateTextStats();
    });
  });
  updateTextStats();
}

function updateTextStats() {
  const text = $("#textInput").value;
  const words = countWords(text);
  setText("textStats", `${text.length} chars, ${words} words`);
  setText("readingTime", `${Math.max(0, Math.ceil(words / 200))} min read`);
}

function initDecisionPicker() {
  $("#pickDecision").addEventListener("click", () => {
    const options = $("#decisionInput").value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    $("#decisionResult").textContent = options.length ? options[Math.floor(Math.random() * options.length)] : "Add options, then pick.";
  });
}

function initExtraCalculators() {
  $("#calculateAge").addEventListener("click", calculateAge);
  $("#calculateEmi").addEventListener("click", calculateEmi);
  $("#calculateGst").addEventListener("click", calculateGst);
  $("#calculatePercent").addEventListener("click", calculatePercent);
  $("#calculateBmi").addEventListener("click", calculateBmi);
  $("#generateQr").addEventListener("click", () => drawQr($("#qrInput").value.trim() || "Productivity Hub"));
  $("#generateBarcode").addEventListener("click", () => renderBarcode($("#barcodeInput").value.trim() || "PRODUCTIVITY"));
}

function calculateAge() {
  const birth = $("#birthDate").value;
  if (!birth) {
    $("#ageResult").textContent = "Select birth date.";
    return;
  }
  const start = parseDateKey(birth);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  $("#ageResult").textContent = `${years} years, ${months} months, ${days} days`;
}

function calculateEmi() {
  const principal = Number($("#emiPrincipal").value) || 0;
  const rate = (Number($("#emiRate").value) || 0) / 12 / 100;
  const months = Number($("#emiMonths").value) || 0;
  if (!principal || !months) {
    $("#emiResult").innerHTML = "Enter loan amount and months.";
    return;
  }
  const emi = rate ? principal * rate * ((1 + rate) ** months) / (((1 + rate) ** months) - 1) : principal / months;
  const total = emi * months;
  $("#emiResult").innerHTML = `<span>Monthly EMI <strong>${formatMoney(emi)}</strong></span><span>Total interest <strong>${formatMoney(total - principal)}</strong></span><span>Total payment <strong>${formatMoney(total)}</strong></span>`;
}

function calculateGst() {
  const amount = Number($("#gstAmount").value) || 0;
  const rate = (Number($("#gstRate").value) || 0) / 100;
  if (!amount) {
    $("#gstResult").innerHTML = "Enter an amount.";
    return;
  }
  if ($("#gstMode").value === "add") {
    const tax = amount * rate;
    $("#gstResult").innerHTML = `<span>GST <strong>${formatMoney(tax)}</strong></span><span>Total <strong>${formatMoney(amount + tax)}</strong></span>`;
  } else {
    const base = amount / (1 + rate);
    $("#gstResult").innerHTML = `<span>Base <strong>${formatMoney(base)}</strong></span><span>GST <strong>${formatMoney(amount - base)}</strong></span>`;
  }
}

function calculatePercent() {
  const percentValue = Number($("#percentValue").value);
  const base = Number($("#percentBase").value);
  const from = Number($("#percentFrom").value);
  const to = Number($("#percentTo").value);
  const lines = [];
  if (Number.isFinite(percentValue) && Number.isFinite(base)) {
    lines.push(`<span>${percentValue}% of ${base} = <strong>${roundNumber((percentValue / 100) * base)}</strong></span>`);
  }
  if (Number.isFinite(from) && Number.isFinite(to) && from !== 0) {
    lines.push(`<span>Change = <strong>${roundNumber(((to - from) / Math.abs(from)) * 100)}%</strong></span>`);
  }
  $("#percentResult").innerHTML = lines.length ? lines.join("") : "Enter percentage values.";
}

function calculateBmi() {
  const weight = Number($("#bmiWeight").value) || 0;
  const heightM = (Number($("#bmiHeight").value) || 0) / 100;
  if (!weight || !heightM) {
    $("#bmiResult").textContent = "Enter weight and height.";
    return;
  }
  const bmi = weight / (heightM * heightM);
  const category = bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy" : bmi < 30 ? "Overweight" : "Obesity range";
  $("#bmiResult").textContent = `${roundNumber(bmi)} BMI - ${category}`;
}

function initAiTools() {
  $("#loadCurrentNoteForAi").addEventListener("click", () => {
    const note = getSelectedNote();
    $("#aiSummaryInput").value = note ? note.plain : "";
  });
  $("#summarizeNote").addEventListener("click", () => {
    $("#summaryResult").innerHTML = escapeHtml(summarizeText($("#aiSummaryInput").value));
  });
  $("#generateTasksAi").addEventListener("click", generateAiTasks);
  $("#generatedTasks").addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-ai-task]");
    if (!button) return;
    state.tasks.unshift({
      id: uid(),
      title: button.dataset.addAiTask,
      priority: "Medium",
      category: "AI Plan",
      dueDate: todayKey(),
      done: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    });
    saveState();
    showToast("Generated task added");
  });
  $$("[data-writing]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#writingOutput").textContent = rewriteText($("#writingInput").value, button.dataset.writing);
    });
  });
}

function summarizeText(text) {
  const clean = text.trim();
  if (!clean) return "Paste or load note text first.";
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const words = clean.toLowerCase().match(/[a-z0-9]+/g) || [];
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "you", "your", "have", "will"]);
  const freq = {};
  words.forEach((word) => {
    if (word.length > 2 && !stop.has(word)) freq[word] = (freq[word] || 0) + 1;
  });
  const ranked = sentences.map((sentence, index) => {
    const score = (sentence.toLowerCase().match(/[a-z0-9]+/g) || []).reduce((total, word) => total + (freq[word] || 0), 0);
    return { sentence: sentence.trim(), index, score };
  }).sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.index - b.index);
  return ranked.map((item) => `- ${item.sentence}`).join("\n");
}

function generateAiTasks() {
  const goal = $("#taskGoalInput").value.trim() || "complete the goal";
  const tasks = [
    `Define the outcome for: ${goal}`,
    `Collect all inputs needed for: ${goal}`,
    `Break ${goal} into 3 small work blocks`,
    `Complete the first focused draft for: ${goal}`,
    `Review, polish, and mark ${goal} complete`
  ];
  $("#generatedTasks").innerHTML = tasks.map((task) => `
    <div class="mini-item">
      <strong>${escapeHtml(task)}</strong>
      <button class="button subtle" type="button" data-add-ai-task="${escapeHtml(task)}">Add to tasks</button>
    </div>
  `).join("");
}

function rewriteText(text, mode) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "Write or paste text first.";
  if (mode === "shorten") return clean.split(/[.!?]/).filter(Boolean).slice(0, 2).join(". ").trim() + ".";
  if (mode === "professional") return `Please note: ${clean.charAt(0).toUpperCase()}${clean.slice(1)} Thank you.`;
  return clean
    .replace(/\bi\b/g, "I")
    .replace(/\bpls\b/gi, "please")
    .replace(/\bu\b/gi, "you")
    .replace(/\s([,.!?])/g, "$1");
}

function renderSmartSuggestions() {
  const suggestions = [];
  const overdue = state.tasks.filter((task) => !task.done && task.dueDate && task.dueDate < todayKey()).length;
  const high = state.tasks.filter((task) => !task.done && task.priority === "High").length;
  const todayPercent = percent(getTodaysTasks().filter((task) => task.done).length, getTodaysTasks().length);
  if (overdue) suggestions.push(`Clear ${overdue} overdue task${overdue === 1 ? "" : "s"} first.`);
  if (high) suggestions.push(`Block time for ${high} high-priority task${high === 1 ? "" : "s"}.`);
  if (todayPercent < 50) suggestions.push("Pick one small task and finish it before adding more.");
  if (state.water.count < 4) suggestions.push("Water intake is low today. Add a water reminder.");
  if (!suggestions.length) suggestions.push("Good rhythm. Keep your next work block focused and short.");
  $("#smartSuggestions").innerHTML = suggestions.map((suggestion) => `<div class="mini-item">${escapeHtml(suggestion)}</div>`).join("");
}

function initDataManagement() {
  $("#exportJson").addEventListener("click", exportJson);
  $("#importJson").addEventListener("change", importJson);
  $("#createBackup").addEventListener("click", createBackup);
  $("#backupList").addEventListener("click", (event) => {
    const restore = event.target.closest("[data-backup-restore]");
    const remove = event.target.closest("[data-backup-delete]");
    if (restore) restoreBackup(restore.dataset.backupRestore);
    if (remove) {
      state.backups = state.backups.filter((backup) => backup.id !== remove.dataset.backupDelete);
      saveState();
    }
  });
  $("#resetAllData").addEventListener("click", () => {
    if (!confirm("Reset all Productivity Hub data? This cannot be undone unless you exported or made a backup.")) return;
    state = defaultState();
    selectedNoteId = null;
    selectedPlannerDate = todayKey();
    calendarCursor = parseDateKey(todayKey());
    saveState();
    applySettings();
    seedDateInputs();
    renderAll();
  });
  $("#refreshReports").addEventListener("click", renderReports);
}

function exportJson() {
  downloadText(`productivity-hub-backup-${todayKey()}.json`, JSON.stringify(state, null, 2), "application/json");
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!confirm("Import this backup and replace current app data?")) return;
      localStorage.setItem(STORE_KEY, JSON.stringify(imported));
      state = loadState();
      selectedNoteId = state.notes[0]?.id || null;
      applySettings();
      renderAll();
      showToast("Backup imported");
    } catch {
      showToast("Invalid JSON backup");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function createBackup() {
  const snapshot = JSON.stringify({ ...state, backups: [] });
  state.backups.unshift({ id: uid(), createdAt: new Date().toISOString(), snapshot });
  state.backups = state.backups.slice(0, 8);
  saveState();
  showToast("Local backup created");
}

function restoreBackup(id) {
  const backup = state.backups.find((item) => item.id === id);
  if (!backup) return;
  if (!confirm("Restore this local backup? Current data will be replaced.")) return;
  const existingBackups = state.backups;
  state = { ...JSON.parse(backup.snapshot), backups: existingBackups };
  selectedNoteId = state.notes[0]?.id || null;
  saveState();
  applySettings();
  renderAll();
}

function renderBackups() {
  $("#backupList").innerHTML = state.backups.length ? state.backups.map((backup) => `
    <div class="mini-item">
      <strong>${formatDateTime(backup.createdAt)}</strong>
      <div class="button-row">
        <button class="button subtle" type="button" data-backup-restore="${backup.id}">Restore</button>
        <button class="button ghost" type="button" data-backup-delete="${backup.id}">Delete</button>
      </div>
    </div>
  `).join("") : `<p class="empty-state">No local backups yet.</p>`;
}

function renderAll() {
  normalizeWater();
  renderDashboard();
  renderTasks();
  renderPlanner();
  renderExpenses();
  renderReminders();
  renderNotes();
  renderReports();
  renderBackups();
  renderCharts();
}

function renderReports() {
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 6);
  const weekTasks = state.tasks.filter((task) => {
    const date = task.completedAt ? new Date(task.completedAt) : null;
    return date && date >= weekStart && date <= addDays(weekEnd, 1);
  }).length;
  const month = todayKey().slice(0, 7);
  const monthTasks = state.tasks.filter((task) => task.completedAt?.slice(0, 7) === month).length;
  const monthExpenses = sum(state.expenses.filter((expense) => expense.date.startsWith(month)).map((expense) => expense.amount));
  const favoriteNotes = state.notes.filter((note) => note.favorite).length;
  const reports = [
    ["Weekly completions", `${weekTasks} tasks`],
    ["Monthly completions", `${monthTasks} tasks`],
    ["Monthly expense", formatMoney(monthExpenses)],
    ["Favorite notes", `${favoriteNotes}`],
    ["Active reminders", `${state.reminders.filter((reminder) => reminder.active).length}`],
    ["Saved events", `${state.events.length}`]
  ];
  $("#reportsGrid").innerHTML = reports.map(([label, value]) => `<div class="report-card"><span class="muted">${label}</span><h3>${value}</h3></div>`).join("");
}

function renderCharts() {
  requestAnimationFrame(() => {
    drawLineChart("dashboardTrendChart", completionSeries(7), "Completions");
    drawLineChart("taskTrendChart", completionSeries(14), "Tasks");
    drawBarChart("expenseCategoryChart", expenseCategorySeries(), "Expenses");
    drawLineChart("expenseTrendChart", expenseTrendSeries(14), "Expense");
  });
}

function completionSeries(days) {
  return Array.from({ length: days }, (_, index) => {
    const key = toDateKey(addDays(new Date(), index - days + 1));
    return {
      label: key.slice(5),
      value: state.tasks.filter((task) => task.completedAt?.slice(0, 10) === key).length
    };
  });
}

function expenseTrendSeries(days) {
  return Array.from({ length: days }, (_, index) => {
    const key = toDateKey(addDays(new Date(), index - days + 1));
    return {
      label: key.slice(5),
      value: sum(state.expenses.filter((expense) => expense.date === key).map((expense) => expense.amount))
    };
  });
}

function expenseCategorySeries() {
  const month = $("#expenseMonth")?.value || todayKey().slice(0, 7);
  const grouped = groupSum(state.expenses.filter((expense) => expense.date.startsWith(month)), "category", "amount");
  return Object.entries(grouped).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
}

function drawLineChart(id, series, label) {
  const canvas = $(`#${id}`);
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const { width, height } = canvas;
  const pad = 34;
  const values = series.map((item) => item.value);
  const max = Math.max(1, ...values);
  ctx.clearRect(0, 0, width, height);
  drawChartBase(ctx, width, height, label);
  ctx.strokeStyle = cssVar("--accent");
  ctx.lineWidth = 3;
  ctx.beginPath();
  series.forEach((item, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, series.length - 1);
    const y = height - pad - (item.value / max) * (height - pad * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = cssVar("--accent");
  series.forEach((item, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, series.length - 1);
    const y = height - pad - (item.value / max) * (height - pad * 2);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawBarChart(id, series, label) {
  const canvas = $(`#${id}`);
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const { width, height } = canvas;
  const pad = 34;
  const values = series.map((item) => item.value);
  const max = Math.max(1, ...values);
  ctx.clearRect(0, 0, width, height);
  drawChartBase(ctx, width, height, label);
  if (!series.length) {
    ctx.fillStyle = cssVar("--muted");
    ctx.fillText("No data yet", pad, height / 2);
    return;
  }
  const barWidth = (width - pad * 2) / series.length - 8;
  series.forEach((item, index) => {
    const x = pad + index * ((width - pad * 2) / series.length) + 4;
    const barHeight = (item.value / max) * (height - pad * 2);
    const y = height - pad - barHeight;
    ctx.fillStyle = index % 2 ? cssVar("--accent-2") : cssVar("--accent");
    ctx.fillRect(x, y, Math.max(8, barWidth), barHeight);
  });
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || canvas.parentElement?.clientWidth || 420));
  const height = Number(canvas.getAttribute("height")) || 220;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return ctx;
}

function drawChartBase(ctx, width, height, label) {
  ctx.fillStyle = cssVar("--surface-2");
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = cssVar("--line");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(34, height - 34);
  ctx.lineTo(width - 16, height - 34);
  ctx.moveTo(34, 16);
  ctx.lineTo(34, height - 34);
  ctx.stroke();
  ctx.fillStyle = cssVar("--muted");
  ctx.font = "12px system-ui";
  ctx.fillText(label, 40, 24);
}

function drawQr(text) {
  const canvas = $("#qrCanvas");
  const ctx = canvas.getContext("2d");
  const qr = createQrMatrix(text.slice(0, 32));
  const quiet = 4;
  const moduleSize = Math.floor(canvas.width / (qr.length + quiet * 2));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  qr.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + quiet) * moduleSize, (y + quiet) * moduleSize, moduleSize, moduleSize);
    });
  });
}

function createQrMatrix(text) {
  const size = 25;
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (row, col, value, reserve = true) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    matrix[row][col] = Boolean(value);
    if (reserve) reserved[row][col] = true;
  };
  const finder = (row, col) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const r = row + y;
        const c = col + x;
        const inPattern = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inPattern && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(r, c, dark);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const dark = Math.max(Math.abs(x), Math.abs(y)) === 2 || (x === 0 && y === 0);
      set(18 + y, 18 + x, dark);
    }
  }
  set(17, 8, true);
  reserveFormatAreas(reserved);

  const data = encodeQrData(text);
  const bits = data.flatMap((byte) => Array.from({ length: 8 }, (_, index) => ((byte >> (7 - index)) & 1) === 1));
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (let offset = 0; offset < 2; offset += 1) {
        const c = col - offset;
        if (reserved[row][c]) continue;
        const raw = bits[bitIndex] || false;
        const masked = raw !== ((row + c) % 2 === 0);
        matrix[row][c] = masked;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  placeFormatBits(matrix, reserved);
  return matrix;
}

function reserveFormatAreas(reserved) {
  const size = reserved.length;
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i += 1) reserved[size - 1 - i][8] = true;
  for (let i = 0; i < 8; i += 1) reserved[8][size - 1 - i] = true;
}

function encodeQrData(text) {
  const bytes = Array.from(new TextEncoder().encode(text)).slice(0, 32);
  const bitBuffer = [];
  const pushBits = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bitBuffer.push((value >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  bytes.forEach((byte) => pushBits(byte, 8));
  const maxBits = 34 * 8;
  const terminator = Math.min(4, maxBits - bitBuffer.length);
  for (let i = 0; i < terminator; i += 1) bitBuffer.push(0);
  while (bitBuffer.length % 8) bitBuffer.push(0);
  const data = [];
  for (let i = 0; i < bitBuffer.length; i += 8) {
    data.push(parseInt(bitBuffer.slice(i, i + 8).join(""), 2));
  }
  while (data.length < 34) data.push(data.length % 2 ? 0x11 : 0xec);
  return data.concat(reedSolomon(data, 10));
}

function reedSolomon(data, degree) {
  const { exp, log } = gfTables();
  const multiply = (a, b) => (a && b ? exp[(log[a] + log[b]) % 255] : 0);
  let generator = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, index) => {
      next[index] ^= multiply(coefficient, 1);
      next[index + 1] ^= multiply(coefficient, exp[i]);
    });
    generator = next;
  }
  const ec = Array(degree).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ ec.shift();
    ec.push(0);
    for (let i = 0; i < degree; i += 1) ec[i] ^= multiply(generator[i + 1], factor);
  });
  return ec;
}

function gfTables() {
  if (gfTables.cache) return gfTables.cache;
  const exp = Array(512).fill(0);
  const log = Array(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
  gfTables.cache = { exp, log };
  return gfTables.cache;
}

function placeFormatBits(matrix) {
  const size = matrix.length;
  const format = formatBits(1, 0);
  const bit = (index) => ((format >> index) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) matrix[8][i] = bit(i);
  matrix[8][7] = bit(6);
  matrix[8][8] = bit(7);
  matrix[7][8] = bit(8);
  for (let i = 9; i < 15; i += 1) matrix[14 - i][8] = bit(i);
  for (let i = 0; i < 8; i += 1) matrix[size - 1 - i][8] = bit(i);
  for (let i = 8; i < 15; i += 1) matrix[8][size - 15 + i] = bit(i);
}

function formatBits(errorLevel, mask) {
  const data = (errorLevel << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ (((rem >> 9) & 1) ? 0x537 : 0);
  return ((data << 10) | rem) ^ 0x5412;
}

function renderBarcode(text) {
  const clean = text.toUpperCase().replace(/[^0-9A-Z .$/+%-]/g, "").slice(0, 36) || "PRODUCTIVITY";
  const patterns = {
    "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
    "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
    A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
    F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
    K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
    P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
    U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
    Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "$": "nwnwnwnnn",
    "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn"
  };
  let x = 10;
  const height = 80;
  const narrow = 2;
  const wide = 6;
  const bars = [];
  `*${clean}*`.split("").forEach((char) => {
    const pattern = patterns[char] || patterns["-"];
    pattern.split("").forEach((part, index) => {
      const width = part === "w" ? wide : narrow;
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="10" width="${width}" height="${height}" fill="#000"/>`);
      x += width;
    });
    x += narrow;
  });
  $("#barcodeOutput").innerHTML = `<svg viewBox="0 0 ${x + 10} 120" width="${x + 10}" height="120" role="img" aria-label="Code 39 barcode"><rect width="100%" height="100%" fill="#fff"/>${bars.join("")}<text x="${(x + 10) / 2}" y="108" text-anchor="middle" font-family="monospace" font-size="14" fill="#000">${escapeHtml(clean)}</text></svg>`;
}

function exportExpensesCsv() {
  const rows = [["Date", "Category", "Note", "Amount"], ...state.expenses.map((expense) => [expense.date, expense.category, expense.note, expense.amount])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadText(`expenses-${todayKey()}.csv`, csv, "text/csv");
}

function notifyUser(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  } else {
    showToast(`${title}: ${body}`);
  }
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
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 1900);
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function updateClock() {
  const now = new Date();
  setText("timeNow", now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  setText("dateNow", now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
}

function getTodaysTasks() {
  const today = todayKey();
  const dueToday = state.tasks.filter((task) => task.dueDate === today);
  return dueToday.length ? dueToday : state.tasks.filter((task) => task.createdAt?.slice(0, 10) === today);
}

function calculateStreaks() {
  const dates = new Set(state.tasks.filter((task) => task.completedAt).map((task) => task.completedAt.slice(0, 10)));
  const lastCount = (days) => Array.from({ length: days }, (_, index) => toDateKey(addDays(new Date(), -index))).filter((date) => dates.has(date)).length;
  let current = 0;
  for (let day = parseDateKey(todayKey()); dates.has(toDateKey(day)); day = addDays(day, -1)) current += 1;
  const sorted = [...dates].sort();
  let best = 0;
  let run = 0;
  let previous = "";
  sorted.forEach((date) => {
    run = previous && toDateKey(addDays(parseDateKey(previous), 1)) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  });
  return { current, last7: lastCount(7), last30: lastCount(30), best };
}

function nextReminderTime(time, interval, from = new Date()) {
  if (time) {
    const [hour, minute] = time.split(":").map(Number);
    const next = new Date(from);
    next.setHours(hour || 0, minute || 0, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }
  return new Date(from.getTime() + Math.max(5, Number(interval) || 60) * 60000);
}

function eventReminderTime(event) {
  const date = parseDateKey(event.date);
  if (event.time) {
    const [hour, minute] = event.time.split(":").map(Number);
    date.setHours(hour || 0, minute || 0, 0, 0);
    date.setMinutes(date.getMinutes() - 15);
  }
  return date;
}

function setText(id, value) {
  const element = $(`#${id}`);
  if (element) element.textContent = value;
}

function setWidth(id, value) {
  const element = $(`#${id}`);
  if (element) element.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function percent(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function todayKey() {
  return toDateKey(new Date());
}

function toDateKey(date) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 10);
}

function parseDateKey(key) {
  const [year, month, day] = String(key || todayKey()).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

function formatDate(key, options = { month: "short", day: "numeric", year: "numeric" }) {
  return parseDateKey(key).toLocaleDateString([], options);
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatMinutesSeconds(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function formatStopwatch(ms) {
  const tenths = Math.floor((ms % 1000) / 100);
  const totalSeconds = Math.floor(ms / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}.${tenths}`;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roundNumber(value) {
  return String(Math.round((value + Number.EPSILON) * 1000000) / 1000000);
}

function countWords(text) {
  return text && text.trim() ? text.trim().split(/\s+/).length : 0;
}

function toTitleCase(text) {
  return text.toLowerCase().replace(/\b[\w']+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function groupSum(items, groupKey, valueKey) {
  return items.reduce((acc, item) => {
    const key = item[groupKey] || "General";
    acc[key] = (acc[key] || 0) + (Number(item[valueKey]) || 0);
    return acc;
  }, {});
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

document.addEventListener("DOMContentLoaded", boot);
