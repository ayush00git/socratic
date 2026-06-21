# Socratic — AI Thinking Partner

> Every AI tool answers questions. This one helps you ask better ones.

Socratic is an AI-native app built on [Anna](https://anna.partners) that replaces the reflex of "ask AI for an answer" with something more valuable: a structured thinking workflow that helps you reason through decisions, plans, and problems properly.

---

## The Problem

When you're stuck on a decision or a complex problem, getting an instant answer from an AI isn't always what you need. What you actually need is to think it through — to surface your hidden assumptions, challenge your framing, and understand what you truly know versus what you've taken for granted.

Socratic is built for that exact moment.

---

## What It Does

1. **Describe your problem** — paste in a decision, a plan, or a situation you're stuck on.
2. **AI asks, not answers** — instead of giving you a solution, it asks you a sequence of probing questions using the Socratic method.
3. **Answer in a structured UI** — your answers accumulate in a clean card stack, keeping the full thread visible.
4. **Assumptions get surfaced** — at key points, the AI identifies hidden assumptions embedded in your own answers.
5. **You review each assumption** — mark every surfaced assumption as **Valid**, **False**, or **Unknown**. The AI cannot know which assumptions hold for your situation — that human judgment is the entire point.
6. **Clarity map generated** — once you've worked through the assumptions, the AI produces a structured summary: what you know, what you've assumed, and what remains genuinely uncertain.

---

## Why It's Different

Most AI tools optimize for giving you an answer fast. Socratic optimizes for giving you clarity. The human review step — validating your own assumptions — is not a UX feature. It is the core of the workflow. No AI can substitute for that judgment, and Socratic doesn't try to.

This is not a chatbot. It is a structured reasoning workflow built as an Anna App, where AI participates through tool calls, state, and human review gates — not just a text box.

---

## Built On Anna

Socratic is an [Anna App](https://anna.partners/developers) — an AI-native app prototype built on the Anna runtime and developer platform.

Anna handles the platform layer: app runtime, tool calling, permissions, and human review flows. Socratic uses these primitives to wire together a multi-step AI workflow that no static page or plain chatbot could replicate.

- **Tool calls** drive each questioning and assumption-surfacing step
- **Structured UI** keeps the question/answer thread and assumption cards visible at all times
- **Human review** gates the assumption validation — AI surfaces, human decides
- **State** holds the evolving problem thread and clarity map across the session

---

## Tech Stack

| Layer | Technology |
|---|---|
| App runtime | Anna (`@anna-ai/cli ^0.1.27`) |
| Frontend | HTML, CSS, JavaScript |
| AI workflow | Anna tools + skills |
| Dev server | `anna-app dev` |

---

## Getting Started

### Prerequisites

- Node.js installed on your machine
- An Anna account — register at [anna.partners](https://anna.partners)

### Installation

Install dependencies for both the root (Anna CLI) and the UI bundle (React + Vite):

```bash
npm i              # installs Anna CLI at root
cd bundle && npm i # installs React, Vite, and UI deps
cd ..
```

### Login to Anna (first time only)

```bash
npm run login
```

This authenticates your local CLI against the Anna platform at `https://anna.partners`. You must be logged in before running the dev server.

### Run locally

```bash
npm run dev
```

This starts the Anna dev server. Open the URL shown in your terminal to interact with Socratic locally.

### Verify your setup

```bash
npm run whoami   # confirms you're logged in
npm run doctor   # checks your environment is healthy
npm run validate # validates your Anna App config strictly
```

---

## Project Structure

```
socratic/
├── package.json          # Project config and Anna CLI scripts
├── manifest.json         # Anna App manifest (permissions, UI, executas)
├── README.md             # You are here
├── bundle/               # Frontend UI (static SPA)
│   ├── index.html        # Main UI entry point
│   ├── app.js            # App logic
│   └── style.css         # Styles
├── executas/             # Anna tool (executa) definitions
│   └── socratic-engine/  # Core questioning & assumption-surfacing tool
├── skills/               # Anna skill definitions
│   └── SKILL.md          # Socratic coach skill
└── fixtures/             # Dev fixtures for local testing
    └── happy-path.jsonl  # Example session fixture
```

---

## The Core Loop

```
User describes problem
        ↓
AI asks first Socratic question
        ↓
User answers → answer added to card stack
        ↓
AI asks follow-up question (repeat 3–5 rounds)
        ↓
AI surfaces hidden assumptions from answers
        ↓
User reviews each assumption: Valid / False / Unknown
        ↓
AI generates Clarity Map
(What you know · What you've assumed · What's uncertain)
```

---

## Judging Notes (Anna Hackathon)

This project was built for the **Anna AI-Native App Hackathon** (deadline: Jun 22, 2025).

| Criterion | How Socratic addresses it |
|---|---|
| **Usefulness** | Solves a real thinking bottleneck — decisions and plans where you need clarity, not just an answer |
| **Working demo** | One focused loop: problem → questions → assumptions → clarity map |
| **Meaningful use of AI** | AI drives questioning and assumption surfacing via tool calls; does not just generate text |
| **Fit with Anna** | Human review is the product, not a UX layer — a perfect match for Anna's review primitives |
| **Creativity** | No other AI tool takes the Socratic method seriously as a structured workflow app |

---

## Author

Built by [Ayush](https://github.com/ayush00git) for the Anna AI-Native App Hackathon.

---

*Socratic — because thinking clearly is the skill that compounds.*