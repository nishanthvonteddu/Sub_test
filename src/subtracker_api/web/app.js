const cadenceOrder = ["weekly", "monthly", "yearly"];
const cadenceColors = {
  weekly: "#d69a68",
  monthly: "#f1d4af",
  yearly: "#8796bf",
};

const statusOrder = ["active", "paused", "canceled"];
const forecastMonthCount = 6;
const profileStorageKey = "subtracker.profileName";
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  items: [],
  filter: "all",
  report: null,
  selectedFile: null,
  importingCandidateIds: new Set(),
  editingSubscriptionId: null,
  busySubscriptionIds: new Set(),
  loadError: null,
  selectedDate: parseDate(new Date()) || new Date(),
  viewerName: readStoredViewerName(),
};

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

const longMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const monthOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
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

const form = document.getElementById("subscription-form");
const nameField = document.getElementById("subscription-name");
const vendorField = document.getElementById("subscription-vendor");
const amountField = document.getElementById("subscription-amount");
const currencyField = document.getElementById("subscription-currency");
const cadenceField = document.getElementById("subscription-cadence");
const statusField = document.getElementById("subscription-status");
const dayOfMonthField = document.getElementById("subscription-day-of-month");
const startDateField = document.getElementById("subscription-start-date");
const endDateField = document.getElementById("subscription-end-date");
const notesField = document.getElementById("subscription-notes");
const saveButton = document.getElementById("save-subscription");
const resetFormButton = document.getElementById("reset-subscription-form");
const formFeedback = document.getElementById("form-feedback");
const manualEntryHeading = document.getElementById("manual-entry-heading");
const manualEntryNote = document.getElementById("manual-entry-note");
const manualEntryState = document.getElementById("manual-entry-state");

const statementForm = document.getElementById("statement-upload-form");
const statementFileField = document.getElementById("statement-file");
const statementDropzone = document.getElementById("statement-dropzone");
const analyzeStatementButton = document.getElementById("analyze-statement");
const importAllButton = document.getElementById("import-all-candidates");
const statementFeedback = document.getElementById("statement-feedback");
const candidateList = document.getElementById("candidate-list");
const focusDateField = document.getElementById("focus-date");
const focusMonthField = document.getElementById("focus-month");
const focusYearField = document.getElementById("focus-year");
const focusResetButton = document.getElementById("focus-reset");

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

function sanitizeViewerName(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 32) : null;
}

function readStoredViewerName() {
  try {
    return sanitizeViewerName(window.localStorage.getItem(profileStorageKey));
  } catch {
    return null;
  }
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
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

function formatFocusMonth(date) {
  return longMonthFormatter.format(startOfMonth(date));
}

function isWithinRange(date, rangeStart, rangeEnd) {
  return Boolean(date && date >= rangeStart && date <= rangeEnd);
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

function monthlyEquivalentCandidate(item) {
  if (item.cadence === "weekly") {
    return (item.latest_amount * 52) / 12;
  }
  if (item.cadence === "yearly") {
    return item.latest_amount / 12;
  }
  return item.latest_amount;
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

function formatCurrencyTotalList(totals) {
  if (!Array.isArray(totals) || !totals.length) {
    return fallbackMoney.format(0);
  }

  return totals
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .map((item) => formatAmount(item.amount, item.currency))
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

function buildForecastBuckets(items, anchorDate = new Date()) {
  const rangeStart = startOfMonth(anchorDate);
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

function getFirstScheduledEntry(buckets) {
  return buckets
    .flatMap((bucket) => bucket.entries)
    .sort((left, right) => left.chargeDate - right.chargeDate || left.name.localeCompare(right.name))[0];
}

function getPendingCandidates(report) {
  if (!report?.candidates) {
    return [];
  }
  return report.candidates.filter((item) => item.review_state !== "imported");
}

function getHighConfidenceCandidateIds(report) {
  return getPendingCandidates(report)
    .filter((item) => item.confidence_label !== "low")
    .map((item) => item.candidate_id);
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

function getSubscriptionById(subscriptionId) {
  return state.items.find((item) => item.id === subscriptionId) || null;
}

function syncFormMode() {
  const editingSubscription = state.editingSubscriptionId
    ? getSubscriptionById(state.editingSubscriptionId)
    : null;
  const isEditing = Boolean(editingSubscription);

  manualEntryHeading.textContent = isEditing ? "Edit tracked subscription" : "Track a plan by hand";
  manualEntryNote.textContent = isEditing
    ? "Update the subscription details below and save to refresh the ledger and forecast."
    : "Use this when a plan is missing from the statement or you want to add it directly.";
  manualEntryState.textContent = isEditing
    ? `Editing ${editingSubscription.name}. Save changes or clear the form to stop editing.`
    : "Create a new subscription from scratch.";
  saveButton.textContent = isEditing ? "Update subscription" : "Save subscription";
  resetFormButton.textContent = isEditing ? "Cancel edit" : "Clear";
}

function populateForm(subscription) {
  nameField.value = subscription.name || "";
  vendorField.value = subscription.vendor || "";
  amountField.value = subscription.amount ?? "";
  currencyField.value = normalizeCurrency(subscription.currency);
  cadenceField.value = subscription.cadence || "monthly";
  statusField.value = subscription.status || "active";
  startDateField.value = subscription.start_date || "";
  endDateField.value = subscription.end_date || "";
  dayOfMonthField.value = subscription.day_of_month ?? "";
  notesField.value = subscription.notes || "";
  syncDayOfMonthField();
  syncDateConstraints();
}

function beginEditingSubscription(subscriptionId) {
  const subscription = getSubscriptionById(subscriptionId);
  if (!subscription) {
    return;
  }

  state.editingSubscriptionId = subscription.id;
  populateForm(subscription);
  syncFormMode();
  setFormFeedback(`Editing ${subscription.name}.`);
  document.getElementById("manage").scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

function buildYearRange(items, report, selectedDate) {
  const yearValues = [
    selectedDate.getFullYear(),
    new Date().getFullYear() - 2,
    new Date().getFullYear() + 2,
  ];

  items.forEach((item) => {
    [item.start_date, item.end_date, item.next_charge_date].forEach((value) => {
      const date = parseDate(value);
      if (date) {
        yearValues.push(date.getFullYear());
      }
    });
  });

  if (report?.summary) {
    [report.summary.coverage_start, report.summary.coverage_end, report.summary.next_expected_charge].forEach(
      (value) => {
        const date = parseDate(value);
        if (date) {
          yearValues.push(date.getFullYear());
        }
      },
    );
  }

  (report?.candidates || []).forEach((candidate) => {
    [candidate.first_seen_on, candidate.last_seen_on, candidate.next_expected_on].forEach((value) => {
      const date = parseDate(value);
      if (date) {
        yearValues.push(date.getFullYear());
      }
    });
  });

  return {
    minYear: Math.min(...yearValues),
    maxYear: Math.max(...yearValues),
  };
}

function renderViewerContext() {
  state.viewerName = readStoredViewerName();
  const isSignedIn = Boolean(state.viewerName);

  setText("workspace-user", isSignedIn ? state.viewerName : "Guest mode");
  setText(
    "overview-owner",
    isSignedIn
      ? `Signed in locally as ${state.viewerName}. Access is still open while backend auth is being wired.`
      : "Guest mode is active. The dashboard is currently open to everyone.",
  );
}

function renderPeriodControls(items, report) {
  const range = buildYearRange(items, report, state.selectedDate);

  focusMonthField.innerHTML = Array.from({ length: 12 }, (_, monthIndex) => {
    const label = monthOnlyFormatter.format(new Date(2026, monthIndex, 1));
    return `<option value="${monthIndex}">${label}</option>`;
  }).join("");

  focusYearField.innerHTML = Array.from(
    { length: range.maxYear - range.minYear + 1 },
    (_, index) => {
      const year = range.minYear + index;
      return `<option value="${year}">${year}</option>`;
    },
  ).join("");

  focusDateField.value = toInputDate(state.selectedDate);
  focusMonthField.value = String(state.selectedDate.getMonth());
  focusYearField.value = String(state.selectedDate.getFullYear());
  setText("focused-month", formatFocusMonth(state.selectedDate));
  setText("focus-window-heading", `Billing month in focus: ${formatFocusMonth(state.selectedDate)}.`);
  setText(
    "focus-window-note",
    `${state.viewerName ? `Signed in as ${state.viewerName}.` : "Guest mode is active."} Shift the focus date to inspect which subscriptions renew, start, or end in that billing month.`,
  );
}

function renderPeriodFacts(items, buckets) {
  const rangeStart = startOfMonth(state.selectedDate);
  const rangeEnd = endOfMonth(state.selectedDate);
  const focusBucket = buckets[0] || { entries: [], totals: new Map() };
  const starts = items.filter((item) => isWithinRange(parseDate(item.start_date), rangeStart, rangeEnd)).length;
  const ends = items.filter((item) => isWithinRange(parseDate(item.end_date), rangeStart, rangeEnd)).length;

  setText("focus-renewals", String(focusBucket.entries.length));
  setText("focus-starts", String(starts));
  setText("focus-ends", String(ends));
  setText("focus-spend", formatCurrencyTotals(focusBucket.totals));
}

function renderMetrics(items, buckets, report) {
  const activeItems = items.filter((item) => item.status === "active");
  const monthlyTotals = buildCurrencyTotals(activeItems, monthlyEquivalent);
  const thisMonthTotals = buckets[0]?.totals || new Map();
  const nextRenewal = getFirstScheduledEntry(buckets);
  const pendingCandidates = getPendingCandidates(report);
  const focusLabel = formatFocusMonth(state.selectedDate);
  const focusBucket = buckets[0] || { entries: [] };

  setText("metric-baseline-label", "Monthly baseline");
  setText("metric-due-month-label", `Scheduled ${focusLabel}`);
  setText("metric-next-renewal-label", `First from ${focusLabel}`);
  setText("metric-baseline", formatCurrencyTotals(monthlyTotals));
  setText(
    "metric-detected",
    report ? formatCurrencyTotalList(report.summary.estimated_monthly_totals) : fallbackMoney.format(0),
  );
  setText("metric-due-month", formatCurrencyTotals(thisMonthTotals));
  setText(
    "metric-next-renewal",
    nextRenewal
      ? `${nextRenewal.name} / ${shortDateFormatter.format(nextRenewal.chargeDate)}`
      : "No upcoming",
  );
  setText("metric-review", String(pendingCandidates.length));
  setText(
    "last-sync",
    state.loadError || `Last sync ${dateTimeFormatter.format(new Date())}.`,
  );
  setText(
    "overview-context",
    report
      ? `${focusLabel} currently carries ${focusBucket.entries.length} scheduled renewal${focusBucket.entries.length === 1 ? "" : "s"}. Latest statement ${report.filename} surfaced ${report.summary.recurring_candidate_count} recurring candidates across ${formatDateOrFallback(report.summary.coverage_start, "—")} to ${formatDateOrFallback(report.summary.coverage_end, "—")}.`
      : `${focusLabel} is in focus. Upload a statement PDF to personalize the workspace.`,
  );
}

function renderForecast(buckets) {
  const target = document.getElementById("forecast-grid");
  const maxTotal = Math.max(...buckets.map((bucket) => bucket.totalNominal), 0);
  const lastBucket = buckets[buckets.length - 1];

  target.innerHTML = "";
  setText(
    "forecast-note",
    `Projected charges from ${formatFocusMonth(state.selectedDate)} through ${lastBucket ? formatFocusMonth(lastBucket.start) : formatFocusMonth(state.selectedDate)}.`,
  );

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
  const lastBucket = buckets[buckets.length - 1];

  setText(
    "schedule-note",
    `Grouped renewals from ${formatFocusMonth(state.selectedDate)} through ${lastBucket ? formatFocusMonth(lastBucket.start) : formatFocusMonth(state.selectedDate)}. Each row shows renewal, start date, and end date.`,
  );

  if (!hasEntries) {
    emptyState(
      target,
      `No active renewals are scheduled from ${formatFocusMonth(state.selectedDate)} onward. Import or add an active subscription to populate the board.`,
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

function ledgerActionsForItem(item) {
  const actions = [{ kind: "edit", label: "Edit" }];

  if (item.status === "active") {
    actions.push(
      { kind: "status", label: "Pause", nextStatus: "paused" },
      { kind: "status", label: "Cancel", nextStatus: "canceled" },
    );
  } else if (item.status === "paused") {
    actions.push(
      { kind: "status", label: "Resume", nextStatus: "active" },
      { kind: "status", label: "Cancel", nextStatus: "canceled" },
    );
  } else if (item.status === "canceled") {
    actions.push({ kind: "status", label: "Resume", nextStatus: "active" });
  }

  return actions;
}

function renderLedgerActionMarkup(item) {
  const isBusy = state.busySubscriptionIds.has(item.id);

  return ledgerActionsForItem(item)
    .map((action) => {
      const attributes = [
        `class="secondary-btn ledger-action"`,
        `data-action="${action.kind}"`,
        `data-subscription-id="${item.id}"`,
        `type="button"`,
      ];
      if (action.nextStatus) {
        attributes.push(`data-status="${action.nextStatus}"`);
      }
      if (isBusy) {
        attributes.push("disabled");
      }

      return `<button ${attributes.join(" ")}>${action.label}</button>`;
    })
    .join("");
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
        ? "No subscriptions tracked yet. Import a statement or use the manual panel to create your first plan."
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

    const actions = fragment.querySelector(".ledger-actions");
    actions.innerHTML = renderLedgerActionMarkup(item);

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

function renderImportSummary(report) {
  if (!report) {
    setText("import-filename", "No statement analyzed yet");
    setText("import-period", "Not available");
    setText("import-transactions", "0");
    setText("import-candidates", "0");
    setText("import-next-charge", "Not available");
    setText(
      "import-summary-note",
      "The dashboard becomes personal once we can infer recurring charges from your own statement history.",
    );
    renderImportInsights(null);
    importAllButton.disabled = true;
    return;
  }

  const warnings = Array.isArray(report.summary?.warnings) ? report.summary.warnings : [];
  const nextExpected = parseDate(report.summary.next_expected_charge);
  const pendingCandidates = getPendingCandidates(report);

  setText("import-filename", report.filename);
  setText(
    "import-period",
    `${formatDateOrFallback(report.summary.coverage_start, "—")} to ${formatDateOrFallback(report.summary.coverage_end, "—")}`,
  );
  setText("import-transactions", String(report.summary.transaction_count));
  setText("import-candidates", String(report.summary.recurring_candidate_count));
  setText(
    "import-next-charge",
    nextExpected ? fullDateFormatter.format(nextExpected) : "Not available",
  );
  setText(
    "import-summary-note",
    warnings.length
      ? warnings[0]
      : `${pendingCandidates.length} candidate${pendingCandidates.length === 1 ? "" : "s"} are ready for review or import.`,
  );
  renderImportInsights(report);
  importAllButton.disabled = getHighConfidenceCandidateIds(report).length === 0;
}

function renderImportInsights(report) {
  const target = document.getElementById("import-insight-grid");

  if (!report) {
    target.innerHTML = `
      <article class="insight-tile">
        <p class="eyebrow">Recurring signal</p>
        <strong>Waiting for statement data</strong>
        <span>Upload a PDF to surface vendor concentration, cadence mix, and the next likely charge.</span>
      </article>
    `;
    return;
  }

  const candidates = report.candidates || [];
  const topCandidate = candidates
    .slice()
    .sort((left, right) => monthlyEquivalentCandidate(right) - monthlyEquivalentCandidate(left))[0];
  const weeklyCount = candidates.filter((item) => item.cadence === "weekly").length;
  const monthlyCount = candidates.filter((item) => item.cadence === "monthly").length;
  const matchedCount = candidates.filter((item) => item.review_state === "matched").length;
  const pendingCount = getPendingCandidates(report).length;

  const insights = [
    {
      label: "Top recurring vendor",
      value: topCandidate ? topCandidate.vendor : "No signal yet",
      note: topCandidate
        ? `${formatAmount(monthlyEquivalentCandidate(topCandidate), topCandidate.currency)} monthly equivalent`
        : "Upload multiple statement periods for stronger vendor ranking.",
    },
    {
      label: "Cadence mix",
      value: `${monthlyCount} monthly / ${weeklyCount} weekly`,
      note: `${candidates.length} recurring candidate${candidates.length === 1 ? "" : "s"} detected from the latest statement.`,
    },
    {
      label: "Review queue",
      value: `${pendingCount} ready`,
      note:
        matchedCount > 0
          ? `${matchedCount} already map to an existing subscription and can update the dashboard in place.`
          : "Imported candidates move straight into the forecast and renewal board.",
    },
  ];

  target.innerHTML = "";
  insights.forEach((insight) => {
    const article = document.createElement("article");
    article.className = "insight-tile";
    article.innerHTML = `
      <p class="eyebrow">${insight.label}</p>
      <strong>${insight.value}</strong>
      <span>${insight.note}</span>
    `;
    target.appendChild(article);
  });
}

function renderCandidateList(report) {
  const template = document.getElementById("candidate-row-template");

  if (!report) {
    emptyState(
      candidateList,
      "No statement has been analyzed yet. Upload a PDF to review recurring candidates before importing them.",
    );
    return;
  }

  if (!report.candidates.length) {
    emptyState(
      candidateList,
      "No recurring candidates were detected from the latest statement. Upload a longer statement range for stronger detection.",
    );
    return;
  }

  candidateList.innerHTML = "";

  report.candidates.forEach((candidate) => {
    const fragment = template.content.cloneNode(true);
    const root = fragment.querySelector(".candidate-row");
    const action = fragment.querySelector(".candidate-action");
    const nextExpected = parseDate(candidate.next_expected_on);
    const matchLabel = candidate.matched_subscription_name
      ? `Matched to ${candidate.matched_subscription_name}`
      : "New to the dashboard";

    root.classList.toggle("is-imported", candidate.review_state === "imported");
    fragment.querySelector(".candidate-name").textContent = candidate.vendor;
    fragment.querySelector(".candidate-meta").textContent =
      `${candidate.occurrence_count} charges / ${titleCase(candidate.cadence)} / ${matchLabel}`;
    fragment.querySelector(".candidate-note").textContent = candidate.notes || "Recurring pattern detected.";
    fragment.querySelector(".candidate-amount").textContent = formatAmount(
      candidate.latest_amount,
      candidate.currency,
    );
    fragment.querySelector(".candidate-impact").textContent = `Monthly impact ${formatAmount(
      monthlyEquivalentCandidate(candidate),
      candidate.currency,
    )}`;
    fragment.querySelector(".candidate-last").textContent = `Last seen ${formatDateOrFallback(candidate.last_seen_on, "—")}`;
    fragment.querySelector(".candidate-next").textContent = nextExpected
      ? `Next expected ${formatDateOrFallback(nextExpected, "—")}`
      : "Next expected date unavailable";

    const cadenceBadge = fragment.querySelector(".candidate-cadence");
    cadenceBadge.textContent = titleCase(candidate.cadence);
    cadenceBadge.dataset.kind = candidate.cadence;

    const confidenceBadge = fragment.querySelector(".candidate-confidence");
    confidenceBadge.textContent = `${titleCase(candidate.confidence_label)} confidence`;
    confidenceBadge.dataset.kind = candidate.confidence_label;

    const reviewBadge = fragment.querySelector(".candidate-review");
    reviewBadge.textContent =
      candidate.review_state === "matched"
        ? "Updates existing"
        : candidate.review_state === "imported"
          ? "Imported"
          : "Ready to import";
    reviewBadge.dataset.kind = candidate.review_state;

    action.dataset.candidateId = candidate.candidate_id;
    if (candidate.review_state === "imported") {
      action.textContent = "Imported";
      action.disabled = true;
    } else if (state.importingCandidateIds.has(candidate.candidate_id)) {
      action.textContent = "Applying...";
      action.disabled = true;
    } else if (candidate.review_state === "matched") {
      action.textContent = "Update subscription";
      action.classList.add("is-primary");
    } else {
      action.textContent = candidate.confidence_label === "low" ? "Import anyway" : "Import subscription";
      action.classList.add("is-primary");
    }

    candidateList.appendChild(fragment);
  });
}

function renderDashboard(items, report) {
  const buckets = buildForecastBuckets(items, state.selectedDate);
  syncFormMode();
  renderViewerContext();
  renderPeriodControls(items, report);
  renderPeriodFacts(items, buckets);
  renderMetrics(items, buckets, report);
  renderImportSummary(report);
  renderCandidateList(report);
  renderForecast(buckets);
  renderRenewalBoard(buckets);
  renderLedger(items);
  renderCadence(items);
  renderStatusStats(items);
  renderFilterButtons();
  syncDropzoneState();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

async function hydrate() {
  const [subscriptionsResult, reportResult] = await Promise.allSettled([
    fetchJson("/subscriptions"),
    fetchJson("/statement-imports/latest"),
  ]);

  if (subscriptionsResult.status === "fulfilled") {
    state.items = subscriptionsResult.value;
    state.loadError = null;
  } else {
    state.items = [];
    state.loadError = "Unable to reach the subscription API. Showing an empty workspace.";
  }

  if (reportResult.status === "fulfilled") {
    state.report = reportResult.value || null;
  } else {
    state.report = null;
  }

  if (state.editingSubscriptionId && !getSubscriptionById(state.editingSubscriptionId)) {
    setFormDefaults();
  }

  renderDashboard(state.items, state.report);
}

function setFormFeedback(message, isError = false) {
  formFeedback.textContent = message;
  formFeedback.classList.toggle("is-error", isError);
}

function setStatementFeedback(message, isError = false) {
  statementFeedback.textContent = message;
  statementFeedback.classList.toggle("is-error", isError);
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
  state.editingSubscriptionId = null;
  isApplyingFormDefaults = true;
  form.reset();
  isApplyingFormDefaults = false;
  startDateField.value = toInputDate(new Date());
  currencyField.value = "USD";
  cadenceField.value = "monthly";
  statusField.value = "active";
  syncDayOfMonthField();
  syncDateConstraints();
  syncFormMode();
  setFormFeedback("");
}

function buildPayloadFromForm() {
  const formData = new FormData(form);
  const cadence = String(formData.get("cadence"));
  return {
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

function setSelectedDate(date) {
  const nextDate = parseDate(date);
  if (!nextDate) {
    return;
  }

  state.selectedDate = nextDate;
  renderDashboard(state.items, state.report);
}

function bindPeriodControls() {
  focusDateField.addEventListener("change", () => {
    setSelectedDate(focusDateField.value);
  });

  focusMonthField.addEventListener("change", () => {
    const month = Number(focusMonthField.value);
    if (Number.isNaN(month)) {
      return;
    }

    setSelectedDate(
      safeDate(state.selectedDate.getFullYear(), month, state.selectedDate.getDate()),
    );
  });

  focusYearField.addEventListener("change", () => {
    const year = Number(focusYearField.value);
    if (Number.isNaN(year)) {
      return;
    }

    setSelectedDate(
      safeDate(year, state.selectedDate.getMonth(), state.selectedDate.getDate()),
    );
  });

  focusResetButton.addEventListener("click", () => {
    setSelectedDate(new Date());
  });
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

async function updateSubscriptionStatus(subscriptionId, nextStatus, actionLabel) {
  const subscription = getSubscriptionById(subscriptionId);
  if (!subscription) {
    setFormFeedback("This subscription is no longer available.", true);
    return;
  }

  state.busySubscriptionIds.add(subscriptionId);
  renderLedger(state.items);
  setFormFeedback(`${actionLabel} ${subscription.name}...`);

  try {
    const response = await fetch(`/subscriptions/${subscriptionId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    await hydrate();
    if (state.editingSubscriptionId === subscriptionId) {
      const updatedSubscription = getSubscriptionById(subscriptionId);
      if (updatedSubscription) {
        populateForm(updatedSubscription);
        syncFormMode();
      }
    }
    setFormFeedback(`${subscription.name} is now ${titleCase(nextStatus)}.`);
  } catch (error) {
    setFormFeedback(
      error instanceof Error ? error.message : "Unable to update the subscription status.",
      true,
    );
  } finally {
    state.busySubscriptionIds.delete(subscriptionId);
    renderLedger(state.items);
  }
}

function bindLedgerActions() {
  document.getElementById("subscription-rows").addEventListener("click", async (event) => {
    const button = event.target.closest(".ledger-action");
    if (!button || !button.dataset.subscriptionId || button.disabled) {
      return;
    }

    if (button.dataset.action === "edit") {
      beginEditingSubscription(button.dataset.subscriptionId);
      return;
    }

    if (button.dataset.action === "status" && button.dataset.status) {
      await updateSubscriptionStatus(
        button.dataset.subscriptionId,
        button.dataset.status,
        button.textContent.trim(),
      );
    }
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
    const editingSubscription = state.editingSubscriptionId
      ? getSubscriptionById(state.editingSubscriptionId)
      : null;
    if (state.editingSubscriptionId && !editingSubscription) {
      setFormFeedback("This subscription is no longer available. Clear the form and try again.", true);
      return;
    }
    const isEditing = Boolean(editingSubscription);
    saveButton.disabled = true;
    setFormFeedback(isEditing ? "Updating subscription..." : "Saving subscription...");

    try {
      const payload = buildPayloadFromForm();
      const response = await fetch(
        isEditing ? `/subscriptions/${editingSubscription.id}` : "/subscriptions",
        {
          method: isEditing ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setFormDefaults();
      await hydrate();
      setFormFeedback(`${payload.name} ${isEditing ? "updated" : "saved"}.`);
    } catch (error) {
      setFormFeedback(
        error instanceof Error
          ? error.message
          : `Unable to ${isEditing ? "update" : "save"} subscription.`,
        true,
      );
    } finally {
      saveButton.disabled = false;
    }
  });
}

function getSelectedFile() {
  return state.selectedFile || statementFileField.files?.[0] || null;
}

function setSelectedFile(file) {
  state.selectedFile = file || null;
  syncDropzoneState();
}

function syncDropzoneState() {
  const file = getSelectedFile();
  statementDropzone.classList.toggle("is-armed", Boolean(file));
  setText(
    "statement-file-label",
    file ? file.name : "Drop a PDF here or click to browse",
  );
  setText(
    "statement-file-meta",
    file
      ? `${(file.size / 1024 / 1024).toFixed(2)} MB selected. Analyze to detect recurring charges.`
      : "Text-based statements work best. Files are processed in memory and only recurring candidates are surfaced.",
  );
}

async function uploadStatement(file) {
  const formData = new FormData();
  formData.set("file", file, file.name);

  const response = await fetch("/statement-imports/pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

async function applyCandidateIds(candidateIds) {
  if (!state.report || !candidateIds.length) {
    return;
  }

  candidateIds.forEach((id) => state.importingCandidateIds.add(id));
  renderCandidateList(state.report);
  importAllButton.disabled = true;

  try {
    const response = await fetch(`/statement-imports/${state.report.id}/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ candidate_ids: candidateIds }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const body = await response.json();
    state.report = body.report;
    await hydrate();
    setStatementFeedback(
      `${body.created_subscriptions.length + body.updated_subscriptions.length} candidate${body.created_subscriptions.length + body.updated_subscriptions.length === 1 ? "" : "s"} applied to the dashboard.`,
    );
  } catch (error) {
    setStatementFeedback(
      error instanceof Error ? error.message : "Unable to apply the selected candidates.",
      true,
    );
  } finally {
    state.importingCandidateIds.clear();
    renderCandidateList(state.report);
    importAllButton.disabled = getHighConfidenceCandidateIds(state.report).length === 0;
  }
}

function bindStatementUpload() {
  statementFileField.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    setSelectedFile(file || null);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    statementDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      statementDropzone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    statementDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      statementDropzone.classList.remove("is-dragover");
    });
  });

  statementDropzone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer?.files || [];
    if (file) {
      setSelectedFile(file);
    }
  });

  statementForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = getSelectedFile();
    if (!file) {
      setStatementFeedback("Choose a PDF statement before analyzing it.", true);
      return;
    }

    analyzeStatementButton.disabled = true;
    setStatementFeedback(`Analyzing ${file.name}...`);

    try {
      state.report = await uploadStatement(file);
      renderDashboard(state.items, state.report);
      setStatementFeedback(`${file.name} analyzed. Review the recurring candidates below.`);
    } catch (error) {
      setStatementFeedback(
        error instanceof Error ? error.message : "Unable to analyze the uploaded PDF.",
        true,
      );
    } finally {
      analyzeStatementButton.disabled = false;
    }
  });

  importAllButton.addEventListener("click", async () => {
    const candidateIds = getHighConfidenceCandidateIds(state.report);
    if (!candidateIds.length) {
      setStatementFeedback("No high-confidence recurring candidates are ready to import.", true);
      return;
    }
    setStatementFeedback("Applying high-confidence candidates...");
    await applyCandidateIds(candidateIds);
  });

  candidateList.addEventListener("click", async (event) => {
    const button = event.target.closest(".candidate-action");
    if (!button || !button.dataset.candidateId || button.disabled) {
      return;
    }

    setStatementFeedback("Applying selected candidate...");
    await applyCandidateIds([button.dataset.candidateId]);
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
bindPeriodControls();
bindFilters();
bindLedgerActions();
bindForm();
bindStatementUpload();
applySpotlightMotion();
applyRevealMotion();
hydrate();
