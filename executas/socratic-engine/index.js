#!/usr/bin/env node
/**
 * socratic-engine — Anna Executa plugin (Node.js)
 *
 * Implements a Socratic thinking partner:
 *   1. start_session(problem)        → { session_id, question }
 *   2. process_answer(sid, answer)   → { assumption, question_index, total_questions }
 *   3. validate_assumption(sid, v)   → { next_question } | { done: true }
 *   4. generate_clarity_map(sid)     → { knowns[], assumptions[] }
 *   5. get_session(sid)              → full session object
 *   6. list_sessions()               → [{ id, problem, created_at, completed }]
 *
 * Protocol: JSON-RPC 2.0 over stdio (newline-delimited), v2 with sampling.
 */
"use strict";

const fs       = require("node:fs");
const os       = require("node:os");
const path     = require("node:path");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
const { SamplingClient, PROTOCOL_VERSION_V2 } = require("./sdk/sampling.js");

// ── Config ─────────────────────────────────────────────────────────────────
const DEFAULT_QUESTIONS = 5;
const STATE_DIR  = path.join(os.homedir(), ".anna", "socratic");
const STATE_FILE = path.join(STATE_DIR, "state.json");

// ── Sampling client (shared across all tool calls) ─────────────────────────
const sampling = new SamplingClient();

// ── Plugin manifest ─────────────────────────────────────────────────────────
const MANIFEST = {
  display_name: "Socratic Engine",
  version: "1.0.0",
  description: "AI thinking partner that surfaces hidden assumptions through Socratic questioning.",
  author: "Socratic",
  license: "MIT",
  tags: ["thinking", "decisions", "socratic", "anna-app"],
  host_capabilities: ["llm.sample"],
  tools: [
    {
      name: "start_session",
      description: "Begin a new Socratic session. Returns the first probing question.",
      parameters: [
        { name: "problem", type: "string", description: "The problem, decision, or plan to think through.", required: true }
      ],
    },
    {
      name: "process_answer",
      description: "Submit an answer. Returns the hidden assumption embedded in it.",
      parameters: [
        { name: "session_id", type: "string", required: true },
        { name: "answer",     type: "string", description: "User's answer to the current question.", required: true },
      ],
    },
    {
      name: "validate_assumption",
      description: "Mark an assumption as valid/false/unknown. Returns the next question or done.",
      parameters: [
        { name: "session_id", type: "string", required: true },
        { name: "validation", type: "string", description: "One of: valid, false, unknown", required: true },
      ],
    },
    {
      name: "generate_clarity_map",
      description: "Generate the final clarity map: what the user knows vs what they've assumed.",
      parameters: [
        { name: "session_id", type: "string", required: true }
      ],
    },
    {
      name: "get_session",
      description: "Get the current state of a session.",
      parameters: [
        { name: "session_id", type: "string", required: true }
      ],
    },
    {
      name: "list_sessions",
      description: "List recent sessions (most recent first).",
      parameters: [],
    },
  ],
  runtime: { type: "node", min_version: "18.0.0" },
};

// ── State persistence ───────────────────────────────────────────────────────
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { sessions: {} };
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    if (!data.sessions) data.sessions = {};
    return data;
  } catch (err) {
    const backup = STATE_FILE.replace(/\.json$/, `.broken.${Date.now()}.json`);
    try { fs.renameSync(STATE_FILE, backup); } catch {}
    return { sessions: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function getSession(sessionId) {
  const state = loadState();
  const session = state.sessions[sessionId];
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

function saveSession(session) {
  const state = loadState();
  state.sessions[session.id] = session;
  // Keep only last 50 sessions
  const ids = Object.keys(state.sessions).sort((a, b) =>
    (state.sessions[b].created_at || 0) - (state.sessions[a].created_at || 0)
  );
  if (ids.length > 50) {
    for (const id of ids.slice(50)) delete state.sessions[id];
  }
  saveState(state);
}

// ── LLM helpers ─────────────────────────────────────────────────────────────

// Retry sampling up to 3 times on transient errors (502, timeout, provider error)
// -32603 = internal/gateway error (HTTP 502/503 from the LLM proxy)
const TRANSIENT_CODES = new Set([-32003, -32005, -32603]);
async function samplingWithRetry(params, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sampling.createMessage(params);
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err.data || "");
      const isTransient = TRANSIENT_CODES.has(err.code) ||
        msg.includes("502") || msg.includes("503") || msg.includes("timed out");
      if (!isTransient || attempt === maxRetries - 1) throw err;
      const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
      process.stderr.write(`[socratic-engine] sampling attempt ${attempt + 1} failed (${msg.slice(0, 80)}), retrying in ${delay}ms\n`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function buildHistory(session) {
  const lines = [];
  for (let i = 0; i < session.questions.length; i++) {
    lines.push(`Q: ${session.questions[i]}`);
    if (session.answers[i]) lines.push(`A: ${session.answers[i]}`);
    if (session.assumptions[i]) {
      const v = session.validations[i] ? ` [${session.validations[i]}]` : "";
      lines.push(`Assumption: ${session.assumptions[i]}${v}`);
    }
  }
  return lines.join("\n");
}

async function llmGenerateQuestion(session, invokeId) {
  const history = buildHistory(session);
  const userContent = history
    ? `Problem: ${session.problem}\n\nConversation so far:\n${history}\n\nAsk the next question.`
    : `Problem: ${session.problem}\n\nAsk the first question.`;

  const result = await samplingWithRetry({
    systemPrompt: `You are a Socratic questioner. Your only job is to ask ONE sharp, probing question that forces the person to examine something they haven't thought through yet.

Rules:
- Ask about assumptions, hidden constraints, fears, alternatives, or second-order effects
- Be direct and specific to their exact situation — no generic questions
- Never give advice or opinions
- Never ask two questions at once
- Return ONLY the question text, nothing else — no preamble, no numbering, no explanation`,
    messages: [{ role: "user", content: { type: "text", text: userContent } }],
    maxTokens: 150,
    ...(invokeId ? { metadata: { executa_invoke_id: invokeId } } : {}),
  });
  return (result.content?.text || "").trim();
}

async function llmExtractAssumption(answer, invokeId) {
  const result = await samplingWithRetry({
    systemPrompt: `You are an analyst identifying hidden assumptions. Your job is to surface the single most important hidden assumption embedded in what someone just said.

Rules:
- The assumption must be specific and potentially wrong — not a truism
- Start the sentence with "You're assuming that"
- Be concise — one sentence only
- Return ONLY the assumption sentence, nothing else`,
    messages: [{ role: "user", content: { type: "text", text: `Answer: ${answer}` } }],
    maxTokens: 100,
    ...(invokeId ? { metadata: { executa_invoke_id: invokeId } } : {}),
  });
  return (result.content?.text || "").trim();
}

async function llmGenerateClarityMap(session, invokeId) {
  const history = buildHistory(session);
  const prompt = `Problem: ${session.problem}

Full conversation:
${history}

Extract:
1. "knowns": things explicitly stated as facts (not assumptions)
2. "assumptions": each assumption found, with its validation status

Return ONLY valid JSON in this exact shape, nothing else:
{
  "knowns": ["fact 1", "fact 2"],
  "assumptions": [
    { "text": "You're assuming that ...", "validation": "valid" },
    { "text": "You're assuming that ...", "validation": "false" },
    { "text": "You're assuming that ...", "validation": "unknown" }
  ]
}`;

  const result = await samplingWithRetry({
    systemPrompt: "You are a precise analyst. Return only valid JSON, no markdown fences, no explanation.",
    messages: [{ role: "user", content: { type: "text", text: prompt } }],
    maxTokens: 600,
    ...(invokeId ? { metadata: { executa_invoke_id: invokeId } } : {}),
  });

  const raw = (result.content?.text || "").trim();
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: build map from session data
    return {
      knowns: [`The problem: ${session.problem}`],
      assumptions: session.assumptions.map((a, i) => ({
        text: a,
        validation: session.validations[i] || "unknown",
      })),
    };
  }
}

// ── Tool implementations ─────────────────────────────────────────────────────
async function toolStartSession({ problem, total_questions }, invokeId) {
  if (!problem || typeof problem !== "string" || !problem.trim())
    throw new Error("problem is required");

  const totalQ = Math.min(10, Math.max(3, parseInt(total_questions, 10) || DEFAULT_QUESTIONS));

  const session = {
    id: randomUUID().replace(/-/g, ""),
    problem: problem.trim().slice(0, 500),
    created_at: Date.now() / 1000,
    total_questions: totalQ,
    questions:   [],
    answers:     [],
    assumptions: [],
    validations: [],
    completed:   false,
    clarity_map: null,
  };

  const question = await llmGenerateQuestion(session, invokeId);
  session.questions.push(question);
  saveSession(session);

  return {
    session_id: session.id,
    question,
    question_index: 0,
    total_questions: totalQ,
  };
}

async function toolProcessAnswer({ session_id, answer }, invokeId) {
  if (!answer || typeof answer !== "string" || !answer.trim())
    throw new Error("answer is required");

  const session = getSession(session_id);
  if (session.completed) throw new Error("Session is already completed");

  const currentIndex = session.answers.length;
  if (currentIndex >= session.questions.length)
    throw new Error("No pending question to answer");

  session.answers[currentIndex] = answer.trim().slice(0, 1000);

  const assumption = await llmExtractAssumption(answer, invokeId);
  session.assumptions[currentIndex] = assumption;
  saveSession(session);

  return {
    assumption,
    question_index: currentIndex,
    total_questions: TOTAL_QUESTIONS,
  };
}

async function toolValidateAssumption({ session_id, validation }, invokeId) {
  const valid = ["valid", "false", "unknown"];
  if (!valid.includes(validation))
    throw new Error(`validation must be one of: ${valid.join(", ")}`);

  const session = getSession(session_id);
  const totalQ = session.total_questions || DEFAULT_QUESTIONS;
  const currentIndex = session.validations.length;
  session.validations[currentIndex] = validation;

  const answeredRounds = session.answers.length;

  if (answeredRounds >= totalQ) {
    session.completed = true;
    saveSession(session);
    return { done: true, total_rounds: answeredRounds };
  }

  const nextQuestion = await llmGenerateQuestion(session, invokeId);
  session.questions[answeredRounds] = nextQuestion;
  saveSession(session);

  return {
    done: false,
    next_question: nextQuestion,
    question_index: answeredRounds,
    total_questions: totalQ,
    rounds_completed: answeredRounds,
  };
}

async function toolGenerateClarityMap({ session_id }, invokeId) {
  const session = getSession(session_id);
  const map = await llmGenerateClarityMap(session, invokeId);
  session.clarity_map = map;
  saveSession(session);
  return map;
}

function toolGetSession({ session_id }) {
  return getSession(session_id);
}

function toolListSessions() {
  const state = loadState();
  return Object.values(state.sessions)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 20)
    .map(({ id, problem, created_at, completed }) => ({ id, problem, created_at, completed }));
}

const TOOL_DISPATCH = {
  start_session:       toolStartSession,
  process_answer:      toolProcessAnswer,
  validate_assumption: toolValidateAssumption,
  generate_clarity_map: toolGenerateClarityMap,
  get_session:         toolGetSession,
  list_sessions:       toolListSessions,
};

// ── JSON-RPC wire helpers ────────────────────────────────────────────────────
function writeFrame(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function makeResponse(id, { result, error } = {}) {
  const base = { jsonrpc: "2.0", id };
  return error ? { ...base, error } : { ...base, result };
}

// ── JSON-RPC handlers ────────────────────────────────────────────────────────
function handleInitialize(reqId, params) {
  const proto = (params && params.protocolVersion) || "1.1";
  const isV2  = proto === PROTOCOL_VERSION_V2 || Number(proto) >= 2;

  if (!isV2) {
    sampling.disable(`host did not negotiate v2 (protocolVersion=${proto})`);
  }

  return makeResponse(reqId, {
    result: {
      protocolVersion: isV2 ? PROTOCOL_VERSION_V2 : "1.1",
      serverInfo: { name: MANIFEST.display_name, version: MANIFEST.version },
      client_capabilities: isV2 ? { sampling: {} } : {},
      capabilities: {},
    },
  });
}

async function handleInvoke(reqId, params) {
  const tool     = params && params.tool;
  const args     = (params && params.arguments) || {};
  const invokeId = (params && params.invoke_id) || "";

  const fn = TOOL_DISPATCH[tool];
  if (!fn) {
    return makeResponse(reqId, { error: { code: -32601, message: `Unknown tool: ${tool}` } });
  }
  try {
    const data = await fn(args, invokeId);
    return makeResponse(reqId, { result: { success: true, tool, data } });
  } catch (err) {
    if (err && err.name === "SamplingError") {
      return makeResponse(reqId, { error: { code: err.code, message: err.message, data: err.data } });
    }
    return makeResponse(reqId, { result: { success: false, error: `${err.name}: ${err.message}` } });
  }
}

// ── Stdio loop ────────────────────────────────────────────────────────────────
async function handleMessage(line) {
  let msg;
  try { msg = JSON.parse(line); }
  catch (e) {
    writeFrame(makeResponse(null, { error: { code: -32700, message: `Parse error: ${e.message}` } }));
    return;
  }

  // Sampling/storage reverse-RPC responses have no "method" key
  if (!("method" in msg)) {
    if (!sampling.dispatchResponse(msg)) {
      process.stderr.write(`[socratic-engine] unmatched response id=${JSON.stringify(msg.id)}\n`);
    }
    return;
  }

  const { method, id: reqId, params = {} } = msg;
  let resp;
  switch (method) {
    case "initialize": resp = handleInitialize(reqId, params); break;
    case "describe":   resp = makeResponse(reqId, { result: MANIFEST }); break;
    case "invoke":     resp = await handleInvoke(reqId, params); break;
    case "health":     resp = makeResponse(reqId, { result: { status: "ok", state_file: STATE_FILE } }); break;
    case "shutdown":   resp = makeResponse(reqId, { result: { ok: true } }); break;
    default:           resp = makeResponse(reqId, { error: { code: -32601, message: `Method not found: ${method}` } });
  }
  if (reqId != null) writeFrame(resp);
}

function main() {
  process.stderr.write(`[socratic-engine] v${MANIFEST.version} ready\n`);
  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", async (raw) => {
    const line = raw.trim();
    if (!line) return;
    handleMessage(line).catch((err) => {
      process.stderr.write(`[socratic-engine] unhandled error: ${err.stack || err}\n`);
    });
  });

  rl.on("close", () => process.exit(0));
}

main();
