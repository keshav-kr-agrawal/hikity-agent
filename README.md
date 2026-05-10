# 🔭 Vantage Scout — AI Lead Intelligence Platform

> Automated lead scouting, AI pitch generation, and WhatsApp outreach for local businesses — built for Bengaluru agencies.

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/keshav-kr-agrawal/hikity-agent.git
cd hikity-agent

# 2. Start the backend server (REQUIRED)
python3 server.py

# 3. Open dashboard
open http://localhost:5500
```

---

## ⚙️ How It Works

### Full Pipeline (One Click)
1. Go to **Scout tab** → set Niche, City, Zone, and how many leads
2. Click **🤖 Auto-Scout + Pitch** or the green **⏵ START** button
3. The system:
   - Asks **Anakin AI (GPT-4o)** to find real businesses with **WhatsApp mobile numbers** (landlines auto-filtered)
   - Checks each business for an existing website (skips ones with sites)
   - Generates a personalized outreach message via **Groq (Llama-3.3-70b)**
   - Streams every step live in the pipeline log
   - Shows **💬 WhatsApp** button on each lead card — click to open WhatsApp Web with message pre-filled
4. Just hit **Send** in WhatsApp — done

---

## 📊 Dashboard Features

| Tab | What it does |
|-----|-------------|
| **Dashboard** | KPIs (leads, pitched, meetings, revenue), live charts |
| **Leads** | All leads with pitch, status, WhatsApp button |
| **Outreach** | Contact list + compose box + AI draft + templates |
| **Scout** | Pipeline config, live log, map, manual add |
| **Profile** | Agency details used in AI pitch generation |

---

## 🔑 API Keys (in `config.js` + `server.py`)

| Key | Used for |
|-----|---------|
| **Supabase** | Lead persistence + real-time sync |
| **Groq** | Pitch/message generation (Llama-3.3-70b) |
| **Anakin AI** | Business scouting (GPT-4o) |

---

## 🗄️ Supabase Setup

Run this **once** in your Supabase SQL Editor:

```sql
alter table leads add column if not exists rating text;
alter table leads add column if not exists pitch  text;

create policy "anon_select" on leads for select using (true);
create policy "anon_insert" on leads for insert with check (true);
create policy "anon_update" on leads for update using (true) with check (true);
create policy "anon_delete" on leads for delete using (true);
```

> Full SQL in `supabase_setup.sql`

---

## 📱 WhatsApp Integration

- **Manual**: Click **💬 WhatsApp** on any pitched lead card → WhatsApp Web opens with message pre-filled → just hit Send
- **Outreach tab**: Select contact → AI Draft → Send Message (opens WhatsApp Web)
- **Auto-Send toggle**: Simulates background dispatch (enable in Outreach compose area)

> Only **mobile numbers** (starting with 6/7/8/9) get WhatsApp buttons. Landlines are filtered out automatically.

---

## 🗂️ File Structure

```
anakin/
├── index.html        # Dashboard UI
├── style.css         # Ivory & Lavender design system
├── app.js            # Frontend: SSE, charts, lead/contact rendering
├── config.js         # Browser-side API keys
├── server.py         # Backend: pipeline, SSE, Anakin/Groq/Supabase
├── leads.json        # Local lead cache (fallback if Supabase unavailable)
├── supabase_setup.sql # DB schema + RLS fix
└── README.md
```

---

## 🔄 Real-Time Flow

```
Browser (SSE) ←────────────── server.py
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
               Anakin AI            Groq Llama
           (Scout businesses)   (Generate pitch)
                    │                     │
                    └──────────┬──────────┘
                               ▼
                         Supabase DB
                     (persist + realtime)
```

---

*Built with ❤️ by Keshav · Vantage Scout v2.0*
