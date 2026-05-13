# AWS DocuBot — Agentic RAG Chatbot

> An intelligent chatbot that answers questions about AWS documentation using a **LangGraph agentic loop**, **AWS Bedrock embeddings**, and dual LLM support (**Gemini 2.5 Flash** + **Claude Sonnet**).

Built by **Anushka Sharma** — Senior AI Engineer | Submission for AllCloud · May 2026

---

## Demo

> Ask: *"How does AWS Lambda handle cold starts?"*
> Ask: *"Compare SQS standard vs FIFO queues"*
> Ask: *"What are the limits of AWS Step Functions?"*

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Angular 16 Frontend                      │
│   Sidebar (sessions) │ Chat UI │ Model Selector │ Markdown  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP POST /api/chat
┌──────────────────────────────▼──────────────────────────────┐
│                  Node.js + Express Backend                    │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              LangGraph StateGraph                    │   │
│   │                                                      │   │
│   │   START → [agent node] ──────────────────→ END      │   │
│   │               ↑    │ needs docs?                     │   │
│   │               │    ↓                                 │   │
│   │           [tools node]                               │   │
│   │         (RAG search tool)                            │   │
│   └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│              ┌───────────▼──────────┐                       │
│              │   RAG Pipeline       │                       │
│              │  Bedrock Titan V2    │                       │
│              │  Cosine Similarity   │                       │
│              │  vector-store.json   │                       │
│              │  (157 chunks)        │                       │
│              └──────────────────────┘                       │
│                                                              │
│   SQLite (session persistence)   Config (keys, models)      │
└─────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                  │
    ┌─────────▼──────────┐          ┌────────────▼──────────┐
    │  Google Gemini      │          │   Anthropic Claude    │
    │  gemini-2.5-flash   │          │   claude-sonnet-4-5   │
    │  (free tier)        │          │   (paid)              │
    └────────────────────┘          └───────────────────────┘
```

### AWS Services Indexed
| Service | Docs Indexed |
|---|---|
| AWS Lambda | Cold starts, invocation, limits, layers |
| Amazon S3 | Storage classes, lifecycle, events |
| AWS Bedrock | Models, embeddings, pricing |
| Amazon SQS | Standard vs FIFO, visibility timeout |
| AWS Step Functions | State machines, workflow types |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Agent Framework** | LangGraph.js (StateGraph) |
| **LLMs** | Google Gemini 2.5 Flash / Anthropic Claude Sonnet |
| **Embeddings** | AWS Bedrock Titan Embed Text V2 |
| **Backend** | Node.js + Express + TypeScript |
| **Frontend** | Angular 16 |
| **Database** | SQLite (better-sqlite3) |
| **RAG Store** | Local JSON vector store (cosine similarity) |

---

## Prerequisites

- **Node.js** v18 or higher
- **npm** v9 or higher
- **Angular CLI** v16: `npm install -g @angular/cli@16`
- API keys (see below)

---

## Setup & Installation

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/aws-docubot.git
cd aws-docubot
```

### 2. Configure Backend Environment
```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in your API keys:

```env
GOOGLE_API_KEY=your_google_api_key       # https://aistudio.google.com/app/apikey
ANTHROPIC_API_KEY=your_anthropic_key     # https://console.anthropic.com/settings/keys
AWS_ACCESS_KEY_ID=your_aws_key_id        # IAM user with AmazonBedrockFullAccess
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=us-east-1
PORT=3000
```

### 3. Install Backend Dependencies
```bash
cd backend
npm install
# patch-package runs automatically via postinstall — applies the LangChain core UUID fix
```

### 4. Install Frontend Dependencies
```bash
cd ../frontend
npm install
```

### 5. (Optional) Re-ingest AWS Documentation
The `data/vector-store.json` is pre-built and included. Skip this unless you want to re-embed:
```bash
cd backend
npm run ingest
# This scrapes AWS docs → chunks → embeds with Bedrock Titan V2 → saves vector-store.json
```

---

## Running the App

### Terminal 1 — Start Backend
```bash
cd backend
npm run dev
# Server running on http://localhost:3000
```

### Terminal 2 — Start Frontend
```bash
cd frontend
npm start
# App running on http://localhost:4200
```

Open **http://localhost:4200** in your browser.

---

## How It Works

### RAG Pipeline
1. AWS documentation pages are split into **157 chunks** (1000 chars, 200 overlap)
2. Each chunk is embedded using **AWS Bedrock Titan Embed Text V2** (1536-dim vectors)
3. Stored in `backend/data/vector-store.json`
4. At query time: user question → embed → **cosine similarity** against all chunks → top 5 returned

### LangGraph Agent Loop
```
User Question
     ↓
[Agent Node] — LLM decides: do I have enough info to answer?
     │
     ├── YES → Generate final answer → END
     │
     └── NO  → Call search_aws_docs tool
                    ↓
               [Tools Node] — runs RAG search, returns relevant chunks
                    ↓
               Back to [Agent Node] — now answer with retrieved context
```

The agent **autonomously decides** when to search, how many times, and when it has enough information.

### Session Persistence
- Every conversation is saved to **SQLite** (`chatbot.db`)
- Session title = first user message (truncated to 60 chars)
- Full message history loaded when resuming a session
- Timestamps stored in UTC, displayed as relative time ("2h ago")

### Token Usage & Cost Tracking
Every AI response shows:
- Input tokens sent to the model
- Output tokens generated
- Total tokens
- Estimated cost in USD

Pricing used:
- Gemini: $0.15 / $0.60 per 1M tokens (input/output)
- Claude: $3.00 / $15.00 per 1M tokens (input/output)

---

## Features

- **Dual LLM** — Switch between Gemini 2.5 Flash (free) and Claude Sonnet (paid) per conversation
- **Agentic RAG** — LangGraph agent autonomously decides when to search documentation
- **Markdown Rendering** — AI responses render with headers, tables, code blocks, lists
- **Session History** — All conversations persisted locally, resumable from sidebar
- **Tool Usage Visibility** — See exactly which tool calls the agent made and with what query
- **Token & Cost Tracking** — Real-time token usage and cost per response
- **About Modal** — App info, creator profile, full tech stack

---

## Project Structure

```
aws-docubot/
├── backend/
│   ├── src/
│   │   ├── server.ts              # Express app entry point
│   │   ├── config.ts              # Centralized configuration
│   │   ├── agent/
│   │   │   └── graph.ts           # LangGraph StateGraph + RAG tool
│   │   ├── routes/
│   │   │   └── chat.routes.ts     # API endpoints
│   │   └── utils/
│   │       ├── database.ts        # SQLite operations
│   │       └── embeddings.ts      # Bedrock Titan V2 wrapper
│   ├── data/
│   │   └── vector-store.json      # Pre-built embeddings (157 chunks)
│   ├── patches/
│   │   └── @langchain+core+*.patch  # UUID bug fix (auto-applied)
│   ├── .env.example               # Environment template
│   └── package.json
│
├── frontend/
│   ├── src/app/
│   │   ├── components/
│   │   │   ├── chat/              # Chat interface + model selector
│   │   │   ├── message/           # Message bubbles + markdown
│   │   │   └── sidebar/           # Session history + About modal
│   │   ├── services/
│   │   │   └── chat.service.ts    # HTTP client + session management
│   │   ├── pipes/
│   │   │   └── markdown.pipe.ts   # Custom markdown → HTML renderer
│   │   └── models/
│   │       └── message.model.ts   # TypeScript interfaces
│   └── package.json
│
└── README.md
```

---

## Key Technical Decisions

**Why LangGraph over a simple RAG chain?**
LangGraph gives the agent autonomy — it decides *whether* to search docs and can perform multiple searches if needed. A simple chain always searches regardless of the question type. The agent handles greetings, follow-up questions, and complex multi-step queries intelligently.

**Why AWS Bedrock for embeddings?**
AllCloud is an AWS consulting firm. Using Bedrock Titan V2 for embeddings demonstrates native AWS service integration. The same AWS credentials used for Bedrock could extend to other AWS services (Kendra, OpenSearch, etc.).

**Why SQLite over cloud database?**
Zero-config local persistence — perfect for a demo. The architecture is easily swapped to RDS/DynamoDB for production by changing only `database.ts`.

**Why custom Markdown pipe over ngx-markdown?**
`ngx-markdown` required `marked` as a peer dependency which caused build conflicts. A custom 80-line pipe gives full control with no external dependencies.

---

## Known Limitations

- **Gemini free tier**: 20 requests/day limit on `gemini-2.5-flash`
- **Vector store**: Stored locally as JSON — for production, use pgvector or Amazon OpenSearch
- **AWS docs**: 5 services indexed (157 chunks) — expandable by running `npm run ingest` on more docs
- **No streaming**: Responses appear all at once — SSE streaming would improve UX

---

## What I Would Add With More Time

1. **Streaming responses** (Server-Sent Events) for real-time token output
2. **More AWS services** in the knowledge base (EC2, ECS, CloudFormation, IAM...)
3. **Re-ranking** — add a cross-encoder to re-rank retrieved chunks for better relevance
4. **AWS deployment** — ECS Fargate + RDS PostgreSQL + pgvector + CloudFront
5. **Conversation branching** — create new threads from any point in history
6. **Source citations** — show which doc chunk each answer came from

---

*Built for AllCloud Technical Assessment · May 2026*
