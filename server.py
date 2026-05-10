#!/usr/bin/env python3
"""
Vantage Scout — Backend Server
Serves static files + runs the full scout pipeline with real-time SSE.
Run: python3 server.py
"""
import os, sys, json, time, threading, queue, re, ssl
import urllib.request, urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT       = 5500
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

env_path = os.path.join(STATIC_DIR, '.env')
env_vars = {}
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                key, _, val = line.partition('=')
                env_vars[key.strip()] = val.strip()

GROQ_KEY   = env_vars.get("GROQ_API_KEY", "")
GROQ_MODEL = env_vars.get("GROQ_MODEL", "llama-3.3-70b-versatile")
ANAKIN_KEY = env_vars.get("ANAKIN_API_KEY", "")
ANAKIN_URL = env_vars.get("ANAKIN_API_URL", "https://api.anakin.ai/v1/chat/completions")
SB_URL     = env_vars.get("SUPABASE_URL", "")
SB_KEY     = env_vars.get("SUPABASE_ANON_KEY", "")

ssl_ctx = ssl.create_default_context()
sse_clients = []
pipeline_running = False

# ── BROADCAST TO ALL SSE CLIENTS ─────────────────────────────
def broadcast(event_type, data):
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n".encode()
    for q in sse_clients[:]:
        try: q.put_nowait(msg)
        except: pass

# ── HTTP / API HELPERS ────────────────────────────────────────
def http_post(url, payload, extra_headers=None):
    data = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as r:
        return json.loads(r.read().decode())

def call_groq(prompt, max_tokens=300):
    res = http_post(
        "https://api.groq.com/openai/v1/chat/completions",
        {"model": GROQ_MODEL, "max_tokens": max_tokens, "temperature": 0.8,
         "messages": [{"role": "user", "content": prompt}]},
        {"Authorization": f"Bearer {GROQ_KEY}"}
    )
    return res["choices"][0]["message"]["content"].strip()

def call_anakin(prompt, max_tokens=400):
    res = http_post(
        ANAKIN_URL,
        {"model": "gpt-4o", "max_tokens": max_tokens, "temperature": 0.7,
         "messages": [{"role": "user", "content": prompt}]},
        {"Authorization": f"Bearer {ANAKIN_KEY}"}
    )
    return res["choices"][0]["message"]["content"].strip()

def sb_insert(leads):
    """Insert leads into Supabase. Retries without 'rating' if column missing."""
    def _do_insert(payload):
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{SB_URL}/rest/v1/leads",
            data=data,
            headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                     "Content-Type": "application/json", "Prefer": "return=representation"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15, context=ssl_ctx) as r:
            return json.loads(r.read().decode())

    try:
        return _do_insert(leads)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        err  = json.loads(body) if body else {}
        code = err.get("code", "")
        if code == "PGRST204":          # Missing column (rating)
            stripped = [{k: v for k, v in l.items() if k != "rating"} for l in leads]
            try:
                return _do_insert(stripped)
            except urllib.error.HTTPError as e2:
                body2 = e2.read().decode()
                print(f"[Supabase] Retry failed: {body2}")
                return []
        elif code == "42501":           # RLS policy blocking
            print(f"[Supabase] RLS blocked insert. Run the SQL fix in your Supabase dashboard.")
            broadcast("step", {"phase": "save", "message": "⚠️ Supabase RLS blocked — saved to leads.json only. See README for SQL fix."})
            return []
        else:
            print(f"[Supabase] Insert error: {body}")
            return []
    except Exception as e:
        print(f"[Supabase] {e}")
        return []

def sb_get():
    req = urllib.request.Request(
        f"{SB_URL}/rest/v1/leads?select=*",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15, context=ssl_ctx) as r:
            return json.loads(r.read().decode())
    except:
        return []

def check_website(name):
    """Quick HTTP HEAD check for a business website."""
    slug = re.sub(r"[^a-z0-9]", "", name.lower())
    for tld in [".com", ".in", ".co.in"]:
        try:
            req = urllib.request.Request(
                f"http://www.{slug}{tld}",
                headers={"User-Agent": "Mozilla/5.0"}, method="HEAD"
            )
            urllib.request.urlopen(req, timeout=3)
            return True
        except:
            pass
    return False

def is_mobile(phone):
    """Return True only for Indian mobile numbers (WhatsApp-compatible).
    Mobile numbers start with 6-9 and are 10 digits after stripping country code/0."""
    p = re.sub(r"\D", "", str(phone or ""))
    if p.startswith("91") and len(p) >= 12:
        p = p[2:]          # strip +91
    if p.startswith("0"):
        p = p[1:]           # strip leading 0 (STD code style landlines)
    return len(p) == 10 and p[0] in "6789"

# ── PIPELINE ─────────────────────────────────────────────────
def run_pipeline(niche, city, zone, count=5):
    global pipeline_running
    pipeline_running = True
    loc = f"{zone}, {city}" if zone else city

    broadcast("start", {"message": f"🚀 Pipeline started — {count} {niche} in {loc}"})
    time.sleep(0.2)

    # STEP 1 — Scout via Anakin AI (explicitly request mobile/WhatsApp numbers)
    broadcast("step", {"phase": "scout", "message": f"🔍 Scouting {count} {niche} in {loc} via Anakin AI..."})
    def fetch_leads_from_anakin(n):
        raw = call_anakin(
            f"List {n} real, well-known {niche} in {loc}, India that appear on Google Maps. "
            f"IMPORTANT: Only include businesses with MOBILE phone numbers (Indian 10-digit numbers starting with 6, 7, 8, or 9). "
            f"Do NOT include landline numbers (those starting with 080, 044, 022, etc). "
            f"Include star ratings. "
            f"Return ONLY a JSON array, keys: \"name\", \"phone\" (mobile only), \"rating\" (e.g. \"4.4 (210 reviews)\"). "
            f"No markdown, no extra text, just the JSON array."
        )
        cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
        return json.loads(cleaned)

    leads_raw = []
    try:
        leads_raw = fetch_leads_from_anakin(count + 2)  # Fetch extra in case some are filtered
        broadcast("step", {"phase": "scout", "message": f"✅ Found {len(leads_raw)} businesses via Anakin"})
    except Exception as e:
        broadcast("step", {"phase": "scout", "message": f"⚠️ Anakin failed ({e}), trying Groq..."})
        try:
            raw = call_groq(
                f"List {count + 2} real {niche} in {loc}, India. Only include businesses with Indian MOBILE numbers "
                f"(10 digits starting with 6/7/8/9, NOT landlines starting with 080/044). Include ratings. "
                f"Return ONLY JSON array: [{{\"name\":\"...\",\"phone\":\"...\",\"rating\":\"4.3 (120 reviews)\"}}]"
            )
            cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
            leads_raw = json.loads(cleaned)
        except Exception as e2:
            broadcast("step", {"phase": "scout", "message": "⚠️ Using fallback data"})
            leads_raw = [
                {"name": "Dyu Art Cafe", "phone": "+91 98451 23456", "rating": "4.6 (1200 reviews)"},
                {"name": "Trippy Goat Cafe", "phone": "+91 97316 55707", "rating": "4.2 (927 reviews)"},
                {"name": "Kapi Kottai", "phone": "+91 81052 11234", "rating": "4.4 (340 reviews)"},
            ]

    # STEP 1b — Filter to WhatsApp-compatible mobile numbers only
    mobile_leads = [l for l in leads_raw if is_mobile(l.get("phone", ""))]
    skipped = [l["name"] for l in leads_raw if not is_mobile(l.get("phone", ""))]
    if skipped:
        broadcast("step", {"phase": "scout", "message": f"📵 Skipped {len(skipped)} landline(s): {', '.join(skipped)}"})
    if not mobile_leads:
        broadcast("step", {"phase": "scout", "message": "⚠️ No mobile numbers found in first batch, requesting more..."})
        try:
            mobile_leads = [l for l in fetch_leads_from_anakin(count + 4) if is_mobile(l.get("phone", ""))]
        except:
            pass
    broadcast("step", {"phase": "scout", "message": f"✅ {len(mobile_leads)} leads with WhatsApp-compatible numbers"})
    leads_raw = mobile_leads[:count]  # Trim to requested count

    # STEP 2 — Check websites
    broadcast("step", {"phase": "check", "message": "🌐 Checking for existing websites..."})
    no_website = []
    for lead in leads_raw:
        broadcast("step", {"phase": "check", "message": f"  Checking {lead['name']}..."})
        has_site = check_website(lead.get("name", ""))
        if has_site:
            broadcast("step", {"phase": "check", "message": f"  ✅ {lead['name']} has a website — skipping"})
        else:
            broadcast("step", {"phase": "check", "message": f"  ❌ {lead['name']} has NO website — adding lead!"})
            no_website.append(lead)
        time.sleep(0.4)

    if not no_website:
        no_website = leads_raw
        broadcast("step", {"phase": "check", "message": "ℹ️ All passed — using full list as leads"})

    # STEP 3 — Generate pitches via Groq, save each immediately
    broadcast("step", {"phase": "pitch", "message": f"✍️ Generating pitches for {len(no_website)} leads..."})
    saved = []
    for lead in no_website:
        broadcast("step", {"phase": "pitch", "message": f"  Crafting pitch for {lead['name']}..."})
        try:
            pitch = call_groq(
                f"Write a warm, professional WhatsApp outreach message (60-80 words) for a web design agency.\n"
                f"Business: {lead['name']}, Location: {loc}\n"
                f"Rating: {lead.get('rating','highly rated')}\n"
                f"Situation: They have NO website.\n"
                f"Open with a genuine compliment. Mention the missed opportunity. "
                f"One soft call-to-action. Sign as 'Team Vantage Scout'. Premium, not pushy.",
                max_tokens=250
            )
        except:
            pitch = (f"Hi! We came across {lead['name']} and were truly impressed by your reputation in {loc}. "
                     f"A professional website could significantly boost your customer inquiries. "
                     f"We'd love to help you grow online — can we connect for a quick chat? "
                     f"— Team Vantage Scout")

        entry = {"name": lead["name"], "phone": lead.get("phone","N/A"),
                 "rating": lead.get("rating",""), "status": "Pitched", "pitch": pitch}

        # Save to Supabase immediately to get the real DB id
        broadcast("step", {"phase": "save", "message": f"  💾 Saving {lead['name']} to Supabase..."})
        sb_result = sb_insert([entry])
        if sb_result and len(sb_result) > 0:
            entry["id"] = sb_result[0].get("id")

        saved.append(entry)
        broadcast("lead_ready", {"lead": entry})
        time.sleep(0.3)

    # Update leads.json
    leads_path = os.path.join(STATIC_DIR, "leads.json")
    existing = []
    try:
        with open(leads_path) as f: existing = json.load(f)
    except: pass
    with open(leads_path, "w") as f:
        json.dump(existing + saved, f, indent=2)

    broadcast("done", {
        "message": f"🎉 Done! {len(saved)} leads scouted, pitched & saved.",
        "count": len(saved), "leads": saved
    })
    pipeline_running = False

# ── HTTP HANDLER ─────────────────────────────────────────────
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC_DIR, **kw)

    def log_message(self, *a): pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path == "/api/events":   self._sse()
        elif self.path == "/api/leads":  self._get_leads()
        elif self.path == "/api/status": self._status()
        else:
            if self.path in ("/", ""): self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/start":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            self._start(body)
        else:
            self.send_response(404); self.end_headers()

    def _sse(self):
        q = queue.Queue()
        sse_clients.append(q)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self._cors(); self.end_headers()
        try:
            while True:
                try:
                    data = q.get(timeout=15)
                    self.wfile.write(data); self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": ping\n\n"); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): pass
        finally:
            if q in sse_clients: sse_clients.remove(q)

    def _get_leads(self):
        leads = sb_get()
        if not leads:
            try:
                with open(os.path.join(STATIC_DIR, 'leads.json')) as f:
                    raw = json.load(f)
                leads = []
                for i, l in enumerate(raw):
                    if not l.get('id'):
                        safe = re.sub(r'[^a-z0-9]', '_', (l.get('name') or '').lower())[:20]
                        l = {**l, 'id': f'j{i+1}_{safe}'}
                    leads.append(l)
            except:
                leads = []
        self._json(leads)

    def _status(self):
        self._json({"running": pipeline_running, "clients": len(sse_clients)})

    def _start(self, body):
        global pipeline_running
        if pipeline_running:
            self.send_response(409)
            self._json({"error": "Pipeline already running"}, send=False)
            return
        niche = body.get("niche", "Cafes")
        city  = body.get("city",  "Bengaluru")
        zone  = body.get("zone",  "")
        count = int(body.get("count", 5))
        threading.Thread(target=run_pipeline, args=(niche, city, zone, count), daemon=True).start()
        self._json({"status": "started"})

    def _json(self, data, send=True):
        body = json.dumps(data).encode()
        if send: self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors(); self.end_headers()
        self.wfile.write(body)

# ── MAIN ─────────────────────────────────────────────────────
if __name__ == "__main__":
    server = HTTPServer(("", PORT), Handler)
    print(f"✅ Vantage Scout running at http://localhost:{PORT}")
    print(f"   Pipeline API: POST http://localhost:{PORT}/api/start")
    print(f"   Events SSE:   GET  http://localhost:{PORT}/api/events")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
