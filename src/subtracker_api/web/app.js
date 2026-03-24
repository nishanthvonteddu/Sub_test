const cadenceOrder = ["weekly", "monthly", "yearly"];
const cadenceColors = {
  weekly: "#d69a68",
  monthly: "#f1d4af",
  yearly: "#8796bf",
};

const statusOrder = ["active", "paused", "canceled"];
const state = {
  items: [],
  filter: "all",
};

const forecastMonthCount = 6;
const formatterCache = new Map();
const fallbackMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const form = document.getElementById("subscription-form");
const cadenceField = document.getElementById("subscription-cadence");
const dayOfMonthField = document.getElementById("subscription-day-of-month");
const startDateField = document.getElementById("subscription-start-date");
const endDateField = document.getElementById("subscription-end-date");
const saveButton = document.getElementById("save-subscription");
const formFeedback = document.getElementById("form-feedback");
let isApplyingFormDefaults = false;

function currencyFormatter(code) {
  if (!code || typeof code !== "string") {
    return fallbackMoney;
  }

  const normalized = code.toUpperCase();
  if (formatterCache.has(normalized)) {
    return formatterCache.get(normalized);
  }

  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
      maximumFractionDigits: 2,
    });
    formatterCache.set(normalized, formatter);
    return formatter;
  } catch {
    return fallbackMoney;
  }
}

function normalizeCurrency(code) {
  if (!code || typeof code !== "string") {
    return "USD";
  }
  return code.toUpperCase();
}

function formatAmount(amount, currency) {
  return currencyFormatter(currency).format(amount);
}

function titleCase(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const [, year, month, day] = match;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function safeDate(year, monthIndex, day) {
  return new Date(year, monthIndex, Math.min(day, lastDayOfMonth(year, monthIndex)));
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDays(date, amount) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthlyEquivalent(item) {
  if (item.cadence === "weekly") {
    return (item.amount * 52) / 12;
  }
  if (item.cadence === "yearly") {
    return item.amount / 12;
  }
  return item.amount;
}

function formatDateOrFallback(value, fallback = "Ongoing") {
  if (!value) {
    return fallback;
  }

  const date = value instanceof Date ? value : parseDate(value);
  return date ? dateFormatter.format(date) : fallback;
}

function buildCurrencyTotals(items, resolver) {
  const totals = new Map();
  items.forEach((item) => {
    addToCurrencyTotals(totals, item.currency, resolver(item));
  });
  return totals;
}

function addToCurrencyTotals(totals, currency, amount) {
  const normalized = normalizeCurrency(currency);
  totals.set(normalized, (totals.get(normalized) || 0) + amount);
}

function formatCurrencyTotals(totals) {
  if (!totals.size) {
    return fallbackMoney.format(0);
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([currency, amount]) => formatAmount(amount, currency))
    .join(" + ");
}

function nominalTotal(totals) {
  return [...totals.values()].reduce((sum, value) => sum + value, 0);
}

function nextWeeklyOccurrence(startDate, referenceDate) {
  if (referenceDate <= startDate) {
    return startDate;
  }

  const deltaDays = Math.round((referenceDate - startDate) / 86400000);
  const remainder = deltaDays % 7;
  return remainder === 0 ? referenceDate : addDays(referenceDate, 7 - remainder);
}

function generateChargeOccurrences(item, rangeStart, rangeEnd) {
  if (item.status !== "active") {
    return [];
  }

  const startDate = parseDate(item.start_date);
  const endDate = parseDate(item.end_date);
  if (!startDate) {
    return [];
  }

  const effectiveStart = rangeStart > startDate ? rangeStart : startDate;
  const effectiveEnd = endDate && endDate < rangeEnd ? endDate : rangeEnd;
  if (effectiveEnd < effectiveStart) {
    return [];
  }

  const occurrences = [];

  if (item.cadence === "weekly") {
    let cursor = nextWeeklyOccurrence(startDate, effectiveStart);
    while (cursor <= effectiveEnd) {
      occurrences.push(cursor);
      cursor = addDays(cursor, 7);
    }
    return occurrences;
  }

  if (item.cadence === "yearly") {
    for (
      let year = Math.max(startDate.getFullYear(), effectiveStart.getFullYear());
      year <= effectiveEnd.getFullYear();
      year += 1
    ) {
      const candidate = safeDate(year, startDate.getMonth(), startDate.getDate());
      if (candidate >= effectiveStart && candidate >= startDate && candidate <= effectiveEnd) {
        occurrences.push(candidate);
      }
    }
    return occurrences;
  }

  const anchorDay = Number(item.day_of_month) || startDate.getDate();
  let cursor = startOfMonth(effectiveStart);
  const lastMonth = startOfMonth(effectiveEnd);

  while (cursor <= lastMonth) {
    const candidate = safeDate(cursor.getFullYear(), cursor.getMonth(), anchorDay);
    if (candidate >= effectiveStart && candidate >= startDate && candidate <= effectiveEnd) {
      occurrences.push(candidate);
    }
    cursor = addMonths(cursor, 1);
  }

  return occurrences;
}

function buildForecastBuckets(items) {
  const today = new Date();
  const rangeStart = startOfMonth(today);
  const monthStarts = Array.from({ length: forecastMonthCount }, (_, index) =>
    addMonths(rangeStart, index),
  );
  const rangeEnd = endOfMonth(monthStarts[monthStarts.length - 1]);

  const buckets = monthStarts.map((monthStart) => ({
    key: monthKey(monthStart),
    label: monthFormatter.format(monthStart),
    start: monthStart,
    totals: new Map(),
    totalNominal: 0,
    entries: [],
  }));

  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  items.forEach((item) => {
    const startDate = parseDate(item.start_date);
    const endDate = parseDate(item.end_date);

    generateChargeOccurrences(item, rangeStart, rangeEnd).forEach((chargeDate) => {
      const bucket = bucketMap.get(monthKey(chargeDate));
      if (!bucket) {
        return;
      }

      addToCurrencyTotals(bucket.totals, item.currency, item.amount);
      bucket.entries.push({
        name: item.name,
        vendor: item.vendor,
        amount: item.amount,
        currency: item.currency,
        cadence: item.cadence,
        chargeDate,
        startDate,
        endDate,
      });
    });
  });

  buckets.forEach((bucket) => {
    bucket.entries.sort(
      (left, right) =>
        left.chargeDate - right.chargeDate || left.name.localeCompare(right.name),
    );
    bucket.totalNominal = nominalTotal(bucket.totals);
  });

  return buckets;
}

function getNearestRenewal(items) {
  return items
    .filter((item) => item.status === "active")
    .map((item) => ({ item, date: parseDate(item.next_charge_date) }))
    .filter((entry) => entry.date)
    .sort((left, right) => left.date - right.date)[0];
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function emptyState(container, message) {
  container.innerHTML = `<p class="empty">${message}</p>`;
}

function renderMetrics(items, buckets) {
  const activeItems = items.filter((item) => item.status === "active");
  const monthlyTotals = buildCurrencyTotals(activeItems, monthlyEquivalent);
  const thisMonthTotals = buckets[0]?.totals || new Map();
  const nextRenewal = getNearestRenewal(items);

  setText("metric-baseline", formatCurrencyTotals(monthlyTotals));
  setText("metric-due-month", formatCurrencyTotals(thisMonthTotals));
  setText(
    "metric-next-renewal",
    nextRenewal
      ? `${nextRenewal.item.name} / ${shortDateFormatter.format(nextRenewal.date)}`
      : "No upcoming",
  );
  setText("metric-tracked", String(items.length));
  setText("last-sync", `Last sync ${dateTimeFormatter.format(new Date())}.`);
}

function renderForecast(buckets) {
  const target = document.getElementById("forecast-grid");
  const maxTotal = Math.max(...buckets.map((bucket) => bucket.totalNominal), 0);

  target.innerHTML = "";

  buckets.forEach((bucket) => {
    const article = document.createElement("article");
    article.className = "forecast-month";
    const ratio = maxTotal > 0 ? Math.max((bucket.totalNominal / maxTotal) * 100, 8) : 6;
    const chargeLabel =
      bucket.entries.length === 1 ? "1 scheduled renewal" : `${bucket.entries.length} scheduled renewals`;

    article.innerHTML = `
      <p class="forecast-month-label">${bucket.label}</p>
      <strong class="forecast-total">${formatCurrencyTotals(bucket.totals)}</strong>
      <div class="forecast-bar">
        <span class="forecast-fill" style="height:${ratio}%"></span>
      </div>
      <p class="forecast-meta">${chargeLabel}</p>
    `;

    target.appendChild(article);
  });
}

function renderRenewalBoard(buckets) {
  const target = document.getElementById("month-groups");
  const template = document.getElementById("renewal-item-template");
  const hasEntries = buckets.some((bucket) => bucket.entries.length > 0);

  if (!hasEntries) {
    emptyState(
      target,
      "No active renewals are scheduled in the next 6 months. Add an active subscription to populate the month board.",
    );
    return;
  }

  target.innerHTML = "";

  buckets.forEach((bucket) => {
    const section = document.createElement("section");
    section.className = "month-group";

    const heading = document.createElement("div");
    heading.className = "month-group-head";
    heading.innerHTML = `
      <div>
        <p class="eyebrow">${bucket.label}</p>
        <h3>${
          bucket.entries.length
            ? `${bucket.entries.length} scheduled renewal${bucket.entries.length === 1 ? "" : "s"}`
            : "No scheduled renewals"
        }</h3>
      </div>
      <p class="month-total">${formatCurrencyTotals(bucket.totals)}</p>
    `;
    section.appendChild(heading);

    if (!bucket.entries.length) {
      const message = document.createElement("p");
      message.className = "empty";
      message.textContent = `No active renewals scheduled for ${bucket.label}.`;
      section.appendChild(message);
      target.appendChild(section);
      return;
    }

    const list = document.createElement("ul");
    list.className = "renewal-list";

    bucket.entries.forEach((entry) => {
      const fragment = template.content.cloneNode(true);
      fragment.querySelector(".renewal-date").textContent = shortDateFormatter.format(entry.chargeDate);
      fragment.querySelector(".renewal-name").textContent = entry.name;
      fragment.querySelector(".renewal-meta").textContent = `${entry.vendor} / ${titleCase(entry.cadence)}`;
      fragment.querySelector(".renewal-amount").textContent = formatAmount(entry.amount, entry.currency);
      fragment.querySelector(".renewal-start").textContent = `Started ${formatDateOrFallback(entry.startDate)}`;
      fragment.querySelector(".renewal-end").textContent = `Ends ${formatDateOrFallback(entry.endDate)}`;
      list.appendChild(fragment);
    });

    section.appendChild(list);
    target.appendChild(section);
  });
}

function sortSubscriptions(left, right) {
  const statusDelta = statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const leftNext = parseDate(left.next_charge_date);
  const rightNext = parseDate(right.next_charge_date);

  if (leftNext && rightNext && leftNext - rightNext !== 0) {
    return leftNext - rightNext;
  }
  if (leftNext && !rightNext) {
    return -1;
  }
  if (!leftNext && rightNext) {
    return 1;
  }

  return left.name.localeCompare(right.name);
}

function renderLedger(items) {
  const rows = document.getElementById("subscription-rows");
  const template = document.getElementById("subscription-row-template");

  const filtered = items
    .filter((item) => state.filter === "all" || item.status === state.filter)
    .sort(sortSubscriptions);

  if (!filtered.length) {
    emptyState(
      rows,
      state.filter === "all"
        ? "No subscriptions tracked yet. Use the add panel to create your first plan."
        : `No ${state.filter} subscriptions are in the ledger right now.`,
    );
    return;
  }

  rows.innerHTML = "";

  filtered.forEach((item) => {
    const fragment = template.content.cloneNode(true);
    const nextCharge = parseDate(item.next_charge_date);
    const startDate = parseDate(item.start_date);
    const endDate = parseDate(item.end_date);

    fragment.querySelector(".row-name").textContent = item.name;
    fragment.querySelector(".row-meta").textContent = item.notes
      ? `${item.vendor} / ${item.notes}`
      : item.vendor;
    fragment.querySelector(
      ".ledger-status",
    ).innerHTML = `<span class="status-text" data-status="${item.status}">${titleCase(item.status)}</span>`;
    fragment.querySelector(".ledger-cadence").textContent = titleCase(item.cadence);
    fragment.querySelector(".ledger-monthly").textContent = formatAmount(
      monthlyEquivalent(item),
      item.currency,
    );
    fragment.querySelector(".ledger-start").textContent = formatDateOrFallback(startDate, "-");
    fragment.querySelector(".ledger-end").textContent = formatDateOrFallback(endDate);
    fragment.querySelector(".ledger-next").textContent = formatDateOrFallback(nextCharge, "No upcoming");

    rows.appendChild(fragment);
  });
}

function renderCadence(items) {
  const ring = document.getElementById("cadence-ring");
  const totalNode = document.getElementById("cadence-ring-total");
  const legend = document.getElementById("cadence-legend");

  const counts = {
    weekly: 0,
    monthly: 0,
    yearly: 0,
  };

  items.forEach((item) => {
    if (counts[item.cadence] !== undefined) {
      counts[item.cadence] += 1;
    }
  });

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  totalNode.textContent = String(total);

  if (!total) {
    ring.style.background = "conic-gradient(rgba(255, 255, 255, 0.12) 0 360deg)";
  } else {
    let cursor = 0;
    const segments = cadenceOrder.map((key) => {
      const next = cursor + (counts[key] / total) * 360;
      const segment = `${cadenceColors[key]} ${cursor}deg ${next}deg`;
      cursor = next;
      return segment;
    });
    ring.style.background = `conic-gradient(${segments.join(",")})`;
  }

  legend.innerHTML = "";
  cadenceOrder.forEach((key) => {
    const count = counts[key];
    const percent = total ? Math.round((count / total) * 100) : 0;
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="legend-left">
        <span class="swatch" style="background:${cadenceColors[key]}"></span>
        <span>${titleCase(key)}</span>
      </span>
      <span>${count} (${percent}%)</span>
    `;
    legend.appendChild(li);
  });
}

function renderStatusStats(items) {
  const counts = {
    active: 0,
    paused: 0,
    canceled: 0,
  };

  const today = parseDate(new Date());
  const endingSoonLimit = addDays(today, 30);

  items.forEach((item) => {
    if (counts[item.status] !== undefined) {
      counts[item.status] += 1;
    }
  });

  const endingSoon = items.filter((item) => {
    const endDate = parseDate(item.end_date);
    return endDate && endDate >= today && endDate <= endingSoonLimit;
  }).length;

  setText("status-active", String(counts.active));
  setText("status-paused", String(counts.paused));
  setText("status-canceled", String(counts.canceled));
  setText("status-ending-soon", String(endingSoon));
}

function renderFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderDashboard(items) {
  const buckets = buildForecastBuckets(items);
  renderMetrics(items, buckets);
  renderForecast(buckets);
  renderRenewalBoard(buckets);
  renderLedger(items);
  renderCadence(items);
  renderStatusStats(items);
  renderFilterButtons();
}

async function hydrate() {
  try {
    const response = await fetch("/subscriptions");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    state.items = await response.json();
    renderDashboard(state.items);
  } catch {
    state.items = [];
    renderDashboard(state.items);
    setText("last-sync", "Unable to reach the subscription API. Showing an empty workspace.");
  }
}

function setFormFeedback(message, isError = false) {
  formFeedback.textContent = message;
  formFeedback.classList.toggle("is-error", isError);
}

function syncDayOfMonthField() {
  const isMonthly = cadenceField.value === "monthly";
  dayOfMonthField.disabled = !isMonthly;
  if (!isMonthly) {
    dayOfMonthField.value = "";
  }
}

function syncDateConstraints() {
  endDateField.min = startDateField.value || "";
  if (endDateField.value && startDateField.value && endDateField.value < startDateField.value) {
    endDateField.value = startDateField.value;
  }
}

function setFormDefaults() {
  isApplyingFormDefaults = true;
  form.reset();
  isApplyingFormDefaults = false;
  startDateField.value = toInputDate(new Date());
  document.getElementById("subscription-currency").value = "USD";
  cadenceField.value = "monthly";
  document.getElementById("subscription-status").value = "active";
  syncDayOfMonthField();
  syncDateConstraints();
  setFormFeedback("");
}

function buildPayloadFromForm() {
  const formData = new FormData(form);
  const cadence = String(formData.get("cadence"));
  const payload = {
    name: String(formData.get("name") || "").trim(),
    vendor: String(formData.get("vendor") || "").trim(),
    amount: Number(formData.get("amount")),
    currency: normalizeCurrency(String(formData.get("currency") || "USD").trim()),
    cadence,
    status: String(formData.get("status") || "active"),
    start_date: String(formData.get("start_date") || ""),
    end_date: String(formData.get("end_date") || "") || null,
    day_of_month:
      cadence === "monthly" && String(formData.get("day_of_month") || "").trim()
        ? Number(formData.get("day_of_month"))
        : null,
    notes: String(formData.get("notes") || "").trim() || null,
  };

  return payload;
}

async function readErrorMessage(response) {
  try {
    const body = await response.json();
    if (Array.isArray(body?.detail)) {
      return body.detail.map((entry) => entry.msg).join(", ");
    }
    if (typeof body?.detail === "string") {
      return body.detail;
    }
  } catch {
    return `Request failed (${response.status})`;
  }

  return `Request failed (${response.status})`;
}

function initializeTodayBadge() {
  setText("today-date", fullDateFormatter.format(new Date()));
}

function bindFilters() {
  document.querySelector(".filters").addEventListener("click", (event) => {
    const button = event.target.closest(".filter-btn");
    if (!button) {
      return;
    }

    state.filter = button.dataset.filter;
    renderLedger(state.items);
    renderFilterButtons();
  });
}

function bindForm() {
  cadenceField.addEventListener("change", syncDayOfMonthField);
  startDateField.addEventListener("change", syncDateConstraints);
  form.addEventListener("reset", () => {
    if (isApplyingFormDefaults) {
      return;
    }
    window.setTimeout(() => {
      setFormDefaults();
    }, 0);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    setFormFeedback("Saving subscription...");

    try {
      const payload = buildPayloadFromForm();
      const response = await fetch("/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setFormFeedback(`${payload.name} saved.`);
      setFormDefaults();
      await hydrate();
      setFormFeedback(`${payload.name} saved.`);
    } catch (error) {
      setFormFeedback(error instanceof Error ? error.message : "Unable to save subscription.", true);
    } finally {
      saveButton.disabled = false;
    }
  });
}

function applySpotlightMotion() {
  if (prefersReducedMotion) {
    return;
  }

  const root = document.documentElement;
  document.addEventListener("pointermove", (event) => {
    root.style.setProperty("--mx", `${event.clientX}px`);
    root.style.setProperty("--my", `${event.clientY}px`);
  });
}

function applyRevealMotion() {
  const nodes = document.querySelectorAll(".js-reveal");

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.16,
      rootMargin: "0px 0px -8% 0px",
    },
  );

  nodes.forEach((node, index) => {
    node.style.setProperty("--reveal-delay", `${index * 70}ms`);
    observer.observe(node);
  });
}

initializeTodayBadge();
setFormDefaults();
bindFilters();
bindForm();
applySpotlightMotion();
applyRevealMotion();
hydrate();
