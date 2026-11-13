# Mishpuha kitchen dashboard

A wall tablet in the kitchen (Galaxy Tab S3). Tap a chore, tap who did it (one or more
people), tap ✓. The dishwasher tile is split into Meat | Dairy; the trash tile first asks
which bins (Recycling, Garbage, Compost).
Coming next: shopping list ("we ran out of peanut butter", by voice or typing, plus items
the family Telegram bot spots in the group chat), calendar, candle-lighting times.

## How it fits together

```
web/                the whole screen: index.html, style.css, app.js (plain JS, no build step)
android/            a tiny Android app that shows web/ full-screen and locks the tablet to it
supabase/schema.sql the database: family, chores, chore_log, shopping
.github/workflows/  every push to main builds the app; the tablet installs it within 30 min
```

- **Data lives in Supabase** (free tier). To change who's in the family or the chores,
  edit the `family`, `tiles` and `chores` tables in the Supabase table editor; no code
  change needed. The tablet picks it up within 30 seconds. A tile's `mode` is `single`,
  `split` (halves, one per chore) or `choose` (asks which chores first).
- **The app is offline-proof**: taps are saved on the tablet first and sent when Wi-Fi is back.
- **Undo**: after a tap, an Undo button shows for 6 seconds.

## Changing the screen

1. Edit files in `web/`. To try them on a computer:
   `python -m http.server 5178 -d web` and open http://localhost:5178
   (without `web/env.js` it runs on made-up data from `web/config.js`, saved in your browser only).
   To use the real data, create `web/env.js`:
   `window.KD_ENV = { supabaseUrl: "https://<ref>.supabase.co", supabaseKey: "<publishable key>" };`
2. Commit and push to `main`. GitHub Actions builds the app and publishes it; the tablet
   updates itself (it checks every 30 min).

Design rules: big targets, few words, works for anyone walking past (kids, grandparents),
nothing that needs a keyboard. Same look as Yosya's life tracker.

## Kiosk mode (one-time tablet setup)

The app locks the tablet only when it's the **device owner**, which Android allows only on a
tablet with no accounts signed in (remove Google/Samsung accounts first, or factory reset):

```bash
adb install kitchen.apk
adb shell dpm set-device-owner com.mishpuha.kitchen/.AdminReceiver
```

Then: no home button, no recent apps, no notifications, no lock screen, and the screen
stays on while charging. **The only way out is restarting the tablet** (hold power →
Restart). After a restart the app doesn't reopen by itself; tap the Kitchen icon.

The screen is AMOLED, so between 23:00 and 06:00 it goes black (tap to wake for 2 min),
and the picture shifts a few pixels every 5 minutes to avoid burn-in.

## Secrets (GitHub → Settings → Secrets → Actions)

| Secret | What |
|---|---|
| `KEYSTORE_B64`, `KEYSTORE_PASSWORD` | the app's signing key. Never change it, or the tablet refuses updates |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | baked into the app so it can read/write data |
| `SUPABASE_SERVICE_KEY` | lets the build upload new versions to the `app` storage bucket |
