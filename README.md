# omnirun

### Your computer finally listens.

**Describe it. Build it. Done.**

omnirun is a desktop app that lets you build software, automate tasks, and control your entire computer — by simply describing what you want. Type or talk. It just works.

That app you've been dreaming about? Build it. Those boring repetitive tasks? Automate them. Want to control your computer from across the room? Just say the word.

No coding required. No developers needed. No limits.

![Status](https://img.shields.io/badge/status-in%20development-orange)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

---

## What Can You Build?

**Anything.**

- Websites & web apps
- Desktop tools & utilities
- APIs & backend services
- Automations & scripts
- Dashboards & admin panels
- E-commerce stores
- Internal business tools
- Browser extensions
- CLI tools
- Data pipelines
- Whatever you can describe

Works with any language, any framework, any stack. React, Python, Node.js, Go, Rust — omnirun handles it all.

---

## What Can It Do Beyond Building?

omnirun isn't just a code builder — it's a **full AI assistant for your computer**.

### 🗣️ Voice Control
- Always-on voice with wake word — *"Hey omnirun, play my chill playlist"*
- Control your computer hands-free from across the room
- Custom routines — say *"Good morning"* and it opens your email, reads your calendar, plays music, and gives you the weather

### 🌐 Browser Control
- Navigate websites, fill forms, click buttons — all by voice or text
- Book restaurants, shop online, manage accounts
- Automate any repetitive browser task

### 📁 Full Computer Control
- Organize thousands of files and photos in seconds
- Find and clean up disk space
- Batch rename, convert, compress files
- Back up folders, delete duplicates, manage your system

### 🔗 100+ Integrations
- **Deploy** to Vercel, Netlify, Cloudflare, Railway — with one message
- **Databases** — Supabase, Firebase, PlanetScale, MongoDB
- **Payments** — Stripe checkout in minutes
- **Domains** — DNS management without touching dashboards
- **Email** — SendGrid transactional emails
- **Git** — GitHub repos, branches, commits, PRs

---

## Key Features

### 💬 Conversational Building
Describe what you want in plain English. Watch it get built in real-time. Review every change before it happens. Approve, reject, or edit.

### 🎨 Dual Mode Interface
- **Simple Mode** — clean and friendly for non-technical users
- **Technical Mode** — terminal, git status, code diffs, full developer experience

### ⏱️ Time Machine
Every change is automatically saved. Go back to any point in your project's history with one click. Every restore is undoable. You literally cannot lose work.

### 📊 Transparent Cost Tracking
See exactly what every AI interaction costs. Input/output token breakdown. Session, monthly, and all-time views. Set budget alerts. No surprise bills.

### 🧠 Project Memory
Leave a project for 6 months. Come back. omnirun remembers exactly where you left off, what was built, and what was in progress.

### 💻 Built-in Terminal
Full terminal access for power users. Themed to match your app. Command history, ANSI color support, everything you'd expect.

### 🎭 6 Beautiful Themes
Dark, Light, Sepia, Retro, Midnight, High Contrast — every part of the app adapts, including the terminal.

### 🔑 Bring Your Own Key (BYOK)
Use your own AI API keys. You control the costs. Our invisible optimization saves you up to 80% on tokens compared to unoptimized tools.

---

## Who Is It For?

| You are... | You use omnirun to... |
|---|---|
| **Entrepreneur** | Build custom tools for your business without hiring developers |
| **Regular person** | Automate boring tasks, organize files, control your computer by voice |
| **Hobbyist** | Finally build that project you've been thinking about for years |
| **Power user** | Voice-control everything, custom routines, complex automations |
| **Student** | Learn by building real projects, create portfolio pieces |
| **Developer** | Claude Code with a better UI, faster prototyping, project management |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2.0](https://tauri.app/) (Rust backend) |
| Frontend | React + TypeScript |
| Bundler | [Vite](https://vitejs.dev/) |
| Styling | [Tailwind CSS v3](https://tailwindcss.com/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Icons | [Lucide React](https://lucide.dev/) |
| Terminal | [xterm.js](https://xtermjs.org/) |
| AI | Anthropic Claude (BYOK) + [Ollama](https://ollama.ai/) for local |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Ollama](https://ollama.ai/) (for local AI)
- Tauri CLI: `cargo install tauri-cli`

### Install & Run

```bash
git clone https://github.com/YOUR_USERNAME/omnirun.git
cd omnirun

npm install

# Development
npm run tauri dev

# Production build
npm run tauri build
```

---

## Project Structure

```
app/
├── src/                          # React frontend
│   ├── components/               # UI components
│   │   ├── layout/               # Main layout + resizable panels
│   │   ├── topbar/               # Top bar, git status, usage
│   │   ├── sidebar/              # Project list, file tree
│   │   ├── chat/                 # Chat interface + usage tracking
│   │   ├── preview/              # Live preview + file viewer
│   │   ├── terminal/             # Built-in terminal
│   │   ├── timemachine/          # Version history & restore
│   │   └── settings/             # All settings panels
│   ├── stores/                   # Zustand state management
│   ├── services/                 # AI, files, tools, connections
│   │   └── connections/          # GitHub, Vercel, Supabase, etc.
│   └── config/                   # Themes
├── src-tauri/                    # Rust backend
│   └── src/                      # Tauri commands, preview server
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

---

## Current Status

### ✅ Working
- Full chat interface with AI streaming and vision support
- File system operations (create, read, edit, delete)
- 8 connected services (GitHub, Vercel, Supabase, Cloudflare, Stripe, Netlify, SendGrid, Namecheap)
- Time Machine with automatic snapshots and one-click restore
- Built-in terminal with themed styling
- 6 themes across entire app
- Token/cost tracking with input/output split
- Dual mode (Simple/Technical) toggle
- Live preview for static projects
- Project memory and manifest system
- Git branch and status display

### 🚧 Coming Soon
- Universal preview (framework dev servers)
- Always-on voice control
- Browser automation
- Custom routines
- Diff viewer and approval flow
- Advanced token optimizations
- OAuth connection flows
- Team collaboration features

---

## License

Proprietary — All rights reserved.

---

*"If you can describe it, you can do it."*

**[omnirun.com](https://omnirun.com)**

FUCK YEAH!!!