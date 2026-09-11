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

The schedule is stored in a free, no-login JSON storage service
([jsonblob.com](https://jsonblob.com)) so everyone's phone/computer reads and
writes the same list.

1. Open the deployed site **yourself, first**, before sending the link to
   anyone else.
2. You'll see a pink **"ONE-TIME SETUP"** banner at the top with a Blob ID.
3. Copy that ID.
4. Edit `config.js` in this repo, and paste it in:
   ```js
   window.BLOB_ID = "paste-the-id-here";
   ```
5. Commit the change (you can do this right in the GitHub web editor).
6. Reload the site — the banner should be gone. Now share the link with
   your friends; everyone will see and edit the same schedule.

> Heads up: because there's no login, anyone with the link can add or
> cancel quests. That's fine for a small trusted friend group, but don't
> post the link publicly.

**If the setup banner never appears** (or the schedule shows a "couldn't
load" error), set up the blob manually instead:
1. Go to [jsonblob.com](https://jsonblob.com), paste `{"watchBlocks": []}`
   into the editor, and save.
2. The resulting page URL looks like `https://jsonblob.com/<some-id>` —
   copy that ID.
3. Paste it into `config.js` as shown above.

## 3. Customize it

Everything editable lives in `config.js`:

- `TRIP_DAYS` — the dates Wolfie needs a sitter. Update these for future trips.
- `ACTIVITY_TYPES` — the quest types in the dropdown (walk, feed, park, etc).
- `MEAL_MENU` — Wolfie's actual meal times/amounts. The defaults are
  placeholders — edit them to match his real routine!

Wolfie's face image is baked into `wolfie-assets.js` as the app icon/avatar
— no need to touch that file.

## Local preview

It's a plain static site — just open `index.html` in a browser, or serve
the folder with any static server:

```sh
python3 -m http.server 8000
```
