# SecPlusLearner — Mobile

A mobile-friendly, installable version of the SecPlusLearner desktop study app.
Same question bank, same spaced-repetition logic, same fuzzy-match grading —
rebuilt as an installable web app (PWA) so it works offline on a phone with
no server to run or maintain.

## Local testing

From this folder:

```
python -m http.server 8765
```

Then open `http://localhost:8765/index.html` in a browser (use DevTools
device toolbar to preview at phone width).

## Deploying to GitHub Pages (free, no server)

1. Create a new GitHub repo (public — GitHub Pages needs a paid plan for
   private-repo Pages).
2. From this folder:
   ```
   git remote add origin https://github.com/<you>/<repo>.git
   git branch -M main
   git push -u origin main
   ```
3. In the repo's Settings → Pages, set the source to the `main` branch,
   root folder.
4. GitHub gives you a URL like `https://<you>.github.io/<repo>/`.

## Installing on an iPhone

1. Open the GitHub Pages URL in **Safari** (must be Safari, not Chrome, for
   the install option to appear on iOS).
2. Tap the Share icon → **Add to Home Screen**.
3. Launch it from the home screen icon — it opens full-screen with no
   browser chrome, and after the first load it works fully offline.

## Updating the question bank later

If you fix or add questions on the desktop app, re-export from its database
and copy the result over `questions.json` here:

```
python -c "
import sqlite3, json
conn = sqlite3.connect('quiz.db')
conn.row_factory = sqlite3.Row
rows = conn.execute('SELECT id, source, domain, subtopic, type, question, options, correct_answer, explanation, tags FROM questions ORDER BY id').fetchall()
qs = []
for r in rows:
    d = dict(r)
    d['options'] = json.loads(d['options']) if d['options'] else None
    d['tags'] = json.loads(d['tags']) if d['tags'] else None
    qs.append(d)
json.dump(qs, open('questions.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
"
```

Note: the app only seeds `questions.json` into the phone's local storage
once (on first install). Editing `questions.json` and redeploying won't
change what's already on someone's phone — that's intentional, so it
doesn't clobber their in-progress study data. Bump `CACHE_VERSION` in
`sw.js` on every deploy so the service worker picks up the new files.
