/**
 * Socratic — Anna App bundle
 *
 * Screen flow:
 *   loading → problem → questioning → assumption → questioning (repeat N times)
 *                                                → complete → map
 *
 * Anna SDK is loaded from /static/anna-apps/_sdk/latest/index.js (platform-provided).
 * Tool ID is resolved from window.__ANNA_TOOL_IDS__ (set by anna-app publish),
 * falling back to the dev placeholder.
 */

import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

// ── Tool ID resolution ────────────────────────────────────────────────────────
const TOOL_ID =
  (typeof window !== "undefined" && window.__ANNA_TOOL_IDS__?.["socratic-engine"])
  || "tool-ayush00git-socratic-enginev2-mnjzfxs7";

// ── State ─────────────────────────────────────────────────────────────────────
let anna = null;
let sessionId = null;
let currentRound = 0;
let sessionTotalRounds = 5;   // set from server after start_session
let selectedRounds = 5;       // chosen by round selector before starting
let lastFailedAction = null;
let currentSessionData = null; // full session for summary export

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const screens = {
  loading:     $("screen-loading"),
  problem:     $("screen-problem"),
  questioning: $("screen-questioning"),
  assumption:  $("screen-assumption"),
  complete:    $("screen-complete"),
  map:         $("screen-map"),
  sessions:    $("screen-sessions"),
};

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.body.dataset.screen = name;
  Object.entries(screens).forEach(([k, el]) => {
    el.hidden = k !== name;
  });
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function setProgress(roundIndex) {
  const pct = (roundIndex / sessionTotalRounds) * 100;
  $("progress-fill").style.width   = `${pct}%`;
  $("progress-fill-2").style.width = `${pct}%`;
}

// ── Loading overlay ───────────────────────────────────────────────────────────
function setThinking(on) {
  $("thinking-overlay").hidden = !on;
}

// ── Error toast ───────────────────────────────────────────────────────────────
function showError(message, retryFn = null) {
  const retryBtn = $("error-retry-btn");
  $("error-msg").textContent = message;
  lastFailedAction = retryFn;
  retryBtn.hidden = !retryFn;
  $("error-toast").hidden = false;
}

function hideError() {
  $("error-toast").hidden = true;
  lastFailedAction = null;
}

// ── Tool call wrapper ─────────────────────────────────────────────────────────
async function invoke(method, args) {
  return anna.tools.invoke({ tool_id: TOOL_ID, method, args });
}

// ── Render helpers ────────────────────────────────────────────────────────────
function showQuestion(question, roundIndex) {
  $("question-text").textContent = question;
  $("round-badge").textContent   = `Round ${roundIndex + 1} of ${sessionTotalRounds}`;
  setProgress(roundIndex);
}

function showAssumptionAnimated(assumption, roundIndex) {
  setProgress(roundIndex + 0.5);
  const el = $("assumption-text");
  el.textContent = "";
  let i = 0;
  const speed = Math.max(18, Math.min(38, Math.floor(2200 / assumption.length)));
  const timer = setInterval(() => {
    el.textContent = assumption.slice(0, ++i);
    if (i >= assumption.length) clearInterval(timer);
  }, speed);
}

function renderClarityMap({ knowns = [], assumptions = [] }) {
  const knownsList      = $("knowns-list");
  const assumptionsList = $("assumptions-list");

  knownsList.innerHTML = "";
  if (!knowns.length) {
    const li = document.createElement("li");
    li.className = "map-list__empty";
    li.textContent = "No explicit facts stated.";
    knownsList.appendChild(li);
  } else {
    knowns.forEach((text) => {
      const li = document.createElement("li");
      li.className = "map-list__item";
      li.textContent = text;
      knownsList.appendChild(li);
    });
  }

  assumptionsList.innerHTML = "";
  if (!assumptions.length) {
    const li = document.createElement("li");
    li.className = "map-list__empty";
    li.textContent = "No hidden assumptions identified.";
    assumptionsList.appendChild(li);
  } else {
    assumptions.forEach(({ text, validation }) => {
      const li = document.createElement("li");
      li.className = `map-list__item map-list__item--${validation || "unknown"}`;
      const dot = document.createElement("span");
      dot.className = "assumption-dot";
      dot.setAttribute("aria-label", validation);
      const span = document.createElement("span");
      span.textContent = text;
      li.appendChild(dot);
      li.appendChild(span);
      assumptionsList.appendChild(li);
    });
  }
}

// ── Copy helpers ──────────────────────────────────────────────────────────────
function flashCopied(btnId) {
  const btn = $(btnId);
  btn.textContent = "Copied!";
  btn.classList.add("btn--copied");
  setTimeout(() => {
    btn.textContent = btnId === "copy-map-btn" ? "Copy map" : "Copy summary";
    btn.classList.remove("btn--copied");
  }, 2000);
}

function buildMapMarkdown(map) {
  const lines = ["# Clarity Map", ""];
  lines.push("## What you know", "");
  (map.knowns || []).forEach((k) => lines.push(`- ${k}`));
  if (!map.knowns?.length) lines.push("_(No explicit facts stated.)_");
  lines.push("", "## What you've assumed", "");
  (map.assumptions || []).forEach(({ text, validation }) => {
    const icon = validation === "valid" ? "✓" : validation === "false" ? "✗" : "?";
    lines.push(`- ${icon} ${text}`);
  });
  if (!map.assumptions?.length) lines.push("_(No hidden assumptions identified.)_");
  return lines.join("\n");
}

function buildSummaryMarkdown(session, map) {
  const lines = [`# Socratic Session: ${session.problem}`, ""];
  lines.push("## Questions & Answers", "");
  (session.questions || []).forEach((q, i) => {
    lines.push(`**Q${i + 1}:** ${q}`, "");
    if (session.answers?.[i]) lines.push(`> ${session.answers[i]}`, "");
    if (session.assumptions?.[i]) {
      const v = session.validations?.[i] || "unknown";
      const icon = v === "valid" ? "✓" : v === "false" ? "✗" : "?";
      lines.push(`*Assumption (${icon} ${v}):* ${session.assumptions[i]}`, "");
    }
  });
  if (map) {
    lines.push("---", "", ...buildMapMarkdown(map).split("\n"));
  }
  return lines.join("\n");
}

async function onCopyMap() {
  const map = currentSessionData?.clarity_map;
  if (!map) return;
  try {
    await navigator.clipboard.writeText(buildMapMarkdown(map));
    flashCopied("copy-map-btn");
  } catch { showError("Clipboard access denied."); }
}

async function onCopySummary() {
  if (!currentSessionData) return;
  try {
    const md = buildSummaryMarkdown(currentSessionData, currentSessionData.clarity_map);
    await navigator.clipboard.writeText(md);
    flashCopied("copy-summary-btn");
  } catch { showError("Clipboard access denied."); }
}

// ── Handlers ──────────────────────────────────────────────────────────────────
async function onStartSession() {
  const problem = $("problem-input").value.trim();
  if (!problem) return;
  hideError();
  setThinking(true);
  try {
    const result = await invoke("start_session", { problem, total_questions: selectedRounds });
    const { session_id, question, question_index, total_questions } = result;
    sessionId          = session_id;
    currentRound       = question_index;
    sessionTotalRounds = total_questions || selectedRounds;
    currentSessionData = { problem, questions: [question], answers: [], assumptions: [], validations: [], total_questions: sessionTotalRounds };
    showQuestion(question, currentRound);
    showScreen("questioning");
  } catch (e) {
    console.error("[socratic] start_session failed:", e);
    showError(friendlyError(e), onStartSession);
  } finally {
    setThinking(false);
  }
}

async function onSubmitAnswer() {
  const answer = $("answer-input").value.trim();
  if (!answer) return;
  hideError();
  setThinking(true);
  try {
    const result = await invoke("process_answer", { session_id: sessionId, answer });
    const { assumption, question_index } = result;
    if (currentSessionData) {
      currentSessionData.answers[question_index] = answer;
      currentSessionData.assumptions[question_index] = assumption;
    }
    showAssumptionAnimated(assumption, question_index);
    showScreen("assumption");
  } catch (e) {
    console.error("[socratic] process_answer failed:", e);
    showError(friendlyError(e), onSubmitAnswer);
  } finally {
    setThinking(false);
  }
}

async function onValidateAssumption(validation) {
  hideError();
  setThinking(true);
  try {
    const result = await invoke("validate_assumption", { session_id: sessionId, validation });
    const { done, next_question, question_index, total_questions } = result;
    if (currentSessionData && result.rounds_completed != null) {
      currentSessionData.validations[result.rounds_completed - 1] = validation;
    }
    if (total_questions) sessionTotalRounds = total_questions;

    if (done) {
      $("complete-sub").textContent = `${sessionTotalRounds} rounds done. Ready to see what you know vs what you've assumed?`;
      showScreen("complete");
    } else {
      currentRound = question_index;
      if (currentSessionData) currentSessionData.questions[question_index] = next_question;
      showQuestion(next_question, question_index);
      $("answer-input").value = "";
      $("answer-btn").disabled = true;
      showScreen("questioning");
    }
  } catch (e) {
    console.error("[socratic] validate_assumption failed:", e);
    showError(friendlyError(e), () => onValidateAssumption(validation));
  } finally {
    setThinking(false);
  }
}

async function onGenerateMap() {
  hideError();
  setThinking(true);
  try {
    const map = await invoke("generate_clarity_map", { session_id: sessionId });
    if (currentSessionData) currentSessionData.clarity_map = map;
    renderClarityMap(map);
    showScreen("map");
    if (anna) anna.window.set_title({ title: "Socratic — Clarity Map" }).catch(() => {});
  } catch (e) {
    console.error("[socratic] generate_clarity_map failed:", e);
    showError(friendlyError(e), onGenerateMap);
  } finally {
    setThinking(false);
  }
}

function friendlyError(e) {
  const msg = e?.message || String(e);
  if (msg.includes("502") || msg.includes("503") || msg.includes("Bad gateway"))
    return "The AI backend is temporarily unavailable. Please retry.";
  if (msg.includes("timed out") || msg.includes("timeout"))
    return "The request timed out. Please retry.";
  if (msg.includes("not granted") || msg.includes("llm.complete"))
    return "LLM permission not granted. Check manifest settings.";
  return "Something went wrong. Please retry.";
}

function onNewSession() {
  sessionId = null;
  currentRound = 0;
  sessionTotalRounds = selectedRounds;
  currentSessionData = null;
  $("problem-input").value = "";
  $("start-btn").disabled = true;
  $("answer-input").value = "";
  $("answer-btn").disabled = true;
  setProgress(0);
  if (anna) anna.window.set_title({ title: "Socratic" }).catch(() => {});
  showScreen("problem");
}

// ── Past sessions ─────────────────────────────────────────────────────────────
async function onShowSessions() {
  showScreen("sessions");
  $("sessions-empty").hidden = true;
  $("sessions-list").innerHTML = "";
  $("sessions-loading").hidden = false;
  try {
    const sessions = await invoke("list_sessions", {});
    $("sessions-loading").hidden = true;
    const list = Array.isArray(sessions) ? sessions : [];
    if (!list.length) {
      $("sessions-empty").hidden = false;
      return;
    }
    list.forEach((s) => {
      const li = document.createElement("li");
      li.className = "session-card";
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");

      const date = s.created_at
        ? new Date(s.created_at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "";
      const badge = s.completed
        ? `<span class="session-badge session-badge--done">Completed</span>`
        : `<span class="session-badge session-badge--progress">In progress</span>`;

      li.innerHTML = `
        <div class="session-card__body">
          <div class="session-card__problem">${escapeHtml(s.problem)}</div>
          <div class="session-card__meta">${badge}${date ? `<span>${date}</span>` : ""}</div>
        </div>
        <span class="session-card__arrow">›</span>`;

      li.addEventListener("click", () => onResumeSession(s.id));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") onResumeSession(s.id); });
      $("sessions-list").appendChild(li);
    });
  } catch (e) {
    $("sessions-loading").hidden = true;
    console.error("[socratic] list_sessions failed:", e);
    showError(friendlyError(e));
  }
}

async function onResumeSession(sid) {
  hideError();
  setThinking(true);
  try {
    const session = await invoke("get_session", { session_id: sid });
    sessionId = sid;
    sessionTotalRounds = session.total_questions || 5;
    currentSessionData = session;

    if (session.completed) {
      if (session.clarity_map) {
        renderClarityMap(session.clarity_map);
        showScreen("map");
        if (anna) anna.window.set_title({ title: "Socratic — Clarity Map" }).catch(() => {});
      } else {
        $("complete-sub").textContent = `${sessionTotalRounds} rounds done. Ready to see what you know vs what you've assumed?`;
        showScreen("complete");
      }
    } else {
      const qIdx = (session.questions || []).length - 1;
      currentRound = Math.max(0, qIdx);
      showQuestion(session.questions[currentRound], currentRound);
      $("answer-input").value = "";
      $("answer-btn").disabled = true;
      showScreen("questioning");
    }
  } catch (e) {
    console.error("[socratic] resume session failed:", e);
    showError(friendlyError(e));
  } finally {
    setThinking(false);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  Object.values(screens).forEach((el) => { el.hidden = true; });
  showScreen("loading");

  // Example chips
  document.querySelectorAll(".chip[data-example]").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("problem-input").value = chip.dataset.example;
      $("start-btn").disabled = false;
      $("problem-input").focus();
    });
  });

  // Round selector
  document.querySelectorAll(".round-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".round-opt").forEach((b) => b.classList.remove("round-opt--active"));
      btn.classList.add("round-opt--active");
      selectedRounds = parseInt(btn.dataset.rounds, 10);
      sessionTotalRounds = selectedRounds;
    });
  });

  // Problem input
  $("problem-input").addEventListener("input", () => {
    $("start-btn").disabled = !$("problem-input").value.trim();
  });
  $("problem-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !$("start-btn").disabled) {
      e.preventDefault();
      onStartSession();
    }
  });
  $("start-btn").addEventListener("click", onStartSession);

  // Answer input
  $("answer-input").addEventListener("input", () => {
    $("answer-btn").disabled = !$("answer-input").value.trim();
  });
  $("answer-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !$("answer-btn").disabled) {
      e.preventDefault();
      onSubmitAnswer();
    }
  });
  $("answer-btn").addEventListener("click", onSubmitAnswer);

  // Validation buttons
  document.querySelectorAll(".validation-buttons [data-v]").forEach((btn) => {
    btn.addEventListener("click", () => onValidateAssumption(btn.dataset.v));
  });

  // Map / session actions
  $("map-btn").addEventListener("click", onGenerateMap);
  $("new-session-btn").addEventListener("click", onNewSession);
  $("copy-map-btn").addEventListener("click", onCopyMap);
  $("copy-summary-btn").addEventListener("click", onCopySummary);
  $("history-btn").addEventListener("click", onShowSessions);
  $("sessions-back-btn").addEventListener("click", () => showScreen("problem"));

  // Error toast
  $("error-retry-btn").addEventListener("click", () => { hideError(); lastFailedAction?.(); });
  $("error-close-btn").addEventListener("click", hideError);

  // Connect to Anna
  try {
    anna = await AnnaAppRuntime.connect();
  } catch (e) {
    console.warn("[socratic] running standalone (Anna not connected):", e?.message || e);
  }

  showScreen("problem");
}

document.addEventListener("DOMContentLoaded", init);
