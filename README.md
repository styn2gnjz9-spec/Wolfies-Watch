# 🐾 Wolfie's Watch

A tiny video-game-themed quest board for scheduling who's watching Wolfie
while John is out of town.

Friends can:
- **Claim a quest** — pick a day, a time block, and what they're doing
  (letting him out, walking him, a park trip, feeding, etc).
- **See the whole squad's schedule** at a glance, grouped by day.
- **Check Wolfie's meal menu**, restaurant-style.

No login required — just share the site link.

## 1. Turn on GitHub Pages

1. Go to this repo's **Settings → Pages**.
2. Under "Build and deployment", set **Source** to `Deploy from a branch`.
3. Branch: `main`, folder: `/ (root)`. Save.
4. GitHub will give you a URL like `https://jlavine27.github.io/wolfies-watch/`
   in a minute or two — that's the link to share with friends.

## 2. Finish the one-time shared-schedule setup

The schedule is stored in a free Firebase Realtime Database so everyone's
phone/computer reads and writes the same list. This is a one-time setup for
the site owner only — friends just open the link.

1. Go to [console.firebase.google.com](https://console.firebase.google.com),
   sign in with any Google account, and click **Add project** (any name is
   fine — skip Google Analytics if asked).
2. In the left sidebar: **Build → Realtime Database → Create Database**.
   Pick any location, then choose **"Start in test mode"**.
3. Open the **Rules** tab (top of the Realtime Database page) and replace
   the contents with:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   Click **Publish**.
4. Back on the **Data** tab, copy the database URL shown at the top
   (looks like `https://wolfies-watch-default-rtdb.firebaseio.com`).
5. Edit `config.js` in this repo, and paste it in:
   ```js
   window.FIREBASE_DB_URL = "https://your-project-default-rtdb.firebaseio.com";
   ```
6. Commit the change (you can do this right in the GitHub web editor).
7. Reload the deployed site to confirm the schedule loads with no error.
   Now share the link with your friends; everyone will see and edit the
   same schedule.

> Heads up: because there's no login, anyone with the link can add or
> cancel quests, and the database rules above are fully public (anyone who
> discovers the database URL could read/write it directly, not just through
> the site). That's fine for a small trusted friend group and a short trip,
> but don't post the link publicly and consider tightening or deleting the
> database afterward.

## 3. Customize it

Everything editable lives in `config.js`:

- `TRIP_DAYS` — the dates Wolfie needs a sitter. Update these for future trips.
- `ACTIVITY_TYPES` — the quest types in the dropdown (walk, feed, park, etc).
- `MEAL_MENU` — Wolfie's actual meal times/amounts. The defaults are
  placeholders — edit them to match his real routine!

The Sheriff Wolfie badge logo lives in `hero-logo.png` (hero image) and
`icon-192-v2.png` / `icon-512-v2.png` / `favicon-32-v2.png` (app icons) —
swap in new files at those same names to change it.

## Local preview

It's a plain static site — just open `index.html` in a browser, or serve
the folder with any static server:

```sh
python3 -m http.server 8000
```
