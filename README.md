# Patrick's memorial slideshow

Two pages:

- **`builder.html`** — where she uploads photos/videos, reorders them by dragging,
  and adds captions. Passcode-protected, not meant to be shared publicly.
- **`index.html`** — the actual slideshow that plays at the memorial. This is
  what you point the TV/laptop browser at.

Both pages read and write live to a small free Supabase project (a hosted
database + file storage). GitHub just hosts the two web pages — the actual
photos and videos live in Supabase, not in the git repo. This matters
because GitHub blocks any single file over 100MB and gets unhappy with
repos full of video, while Supabase is built for exactly this.

Setup takes about 15 minutes, one time, and then she can use the builder
page from her phone or any computer without touching code again.


## Test it first (no setup required)

Both pages auto-detect that `assets/supabase-config.js` still has placeholder
keys and switch into **test mode** automatically — a small orange banner
says so. In test mode, everything runs off a fake backend stored in your
browser's IndexedDB (a real, if temporary, on-device database) instead of
Supabase, so you can try the actual builder → present flow right now with
zero setup. Uploads made in `builder.html` really do carry over when you
open `index.html`, the same way they will once Supabase is connected.

1. Unzip this project anywhere on your computer.
2. **Important:** open it through a local server rather than double-clicking
   the files. Browsers isolate storage per `file://` page in ways that can
   stop `builder.html` and `index.html` from sharing the same test data. In
   a terminal, `cd` into the unzipped folder and run:
   ```
   python3 -m http.server 8000
   ```
   then open `http://localhost:8000/builder.html` in your browser (Chrome,
   Firefox, whatever you normally use). Leave that terminal window open
   while you're testing; close it (Ctrl+C) when you're done.
3. Enter the passcode — whatever's currently set in
   `assets/supabase-config.js` (`patrick2026` by default, until you change it).
4. Drag a batch of real photos/videos in, reorder them, add a caption,
   edit the title card fields.
5. Open `http://localhost:8000/index.html` in a new tab and click "Begin"
   to watch it play back exactly what you just built.

Test mode data lives in that browser's IndexedDB and persists across
reloads (unlike the very first version of this, which reset every time) —
it clears only if you use the "Clear test data" button in the builder's
orange banner, or clear that browser's site data manually. It's still not
where real event data should live long-term; once you're happy with how it
looks, follow the steps below to connect real Supabase, which replaces the
test backend with a persistent one she can use from her own device.

If you skip the local server and just double-click `index.html` or
`builder.html` instead, the pages will still open, but two things can go
wrong: the module script may be blocked entirely by some browsers on
`file://` pages (shows a blank page), or, more subtly, IndexedDB may not be
shared between the two files even though they're in the same folder,
making it look like uploads "disappeared." The local server sidesteps both.


## 1. Create the Supabase project (free)

1. Go to https://supabase.com, sign up or log in, click **New project**.
2. Give it any name (e.g. "patrick-memorial"), set a database password
   (save it somewhere, you likely won't need it again), pick the region
   closest to you, click **Create new project**. Takes about 2 minutes to
   spin up.

## 2. Run the database setup script

1. In the Supabase dashboard, left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this project, copy the whole file, paste
   it into the SQL editor, click **Run**.
3. You should see "Success. No rows returned." If you see an error, stop
   and check you copied the whole file.

## 3. Create the storage bucket

1. Left sidebar → **Storage** → **New bucket**.
2. Name it exactly `media` (lowercase, that exact word — the code expects
   this name).
3. Toggle **Public bucket** ON. This just means anyone with a direct file
   link can view it, same as any normal photo-sharing link — nobody can
   browse or list the files without already knowing the link.
4. Click **Create bucket**.

(The read/write permissions for this bucket were already set up by the SQL
script in step 2 — you don't need to configure anything else here.)

## 4. Get your API keys

1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. Copy the **Project URL** (looks like `https://abcdefgh.supabase.co`).
3. Copy the **anon / public** key (a long string starting with `eyJ...`).
   This one is meant to be public and safe to put in a public GitHub repo —
   access is controlled by the database policies, not by hiding this key.

## 5. Fill in the config file

Open `assets/supabase-config.js` in this project and replace the two
placeholder values with what you copied:

```js
window.SUPABASE_URL = "https://abcdefgh.supabase.co";
window.SUPABASE_ANON_KEY = "eyJ...your long key...";
window.BUILDER_PASSCODE = "whatever-you-want";
```

Change `BUILDER_PASSCODE` to something only you and her know. Worth
knowing plainly: this passcode only hides the upload page from casual
visitors — it is not real authentication. Anyone who has both the
passcode and the public key above (visible in the page source) could
technically write to the album. For a private family photo album with an
unlisted link that's a normal, low-risk tradeoff — just don't post the
builder link publicly, and treat it like a shared Google Photos link
rather than a bank login.

## 6. Put it on GitHub Pages

1. Create a new **public** GitHub repository (private repos can use Pages
   too on a paid plan, but public is simplest and free).
2. Push all these files to the repo — `index.html`, `builder.html`, the
   `assets/` folder, the `supabase/` folder, this README.
3. In the repo, go to **Settings → Pages**.
4. Under "Build and deployment", set **Source** to "Deploy from a branch",
   branch `main`, folder `/ (root)`. Save.
5. Wait a minute or two, then your site is live at:
   `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`
   - The slideshow is at that URL directly (`index.html` is the default page).
   - The builder is at `.../builder.html`.

If you'd rather not touch git directly, GitHub's web UI lets you create a
repo and drag-and-drop these files right in the browser (the "uploading an
existing file" flow on the repo's main page) — no command line needed.


## Using it

**Her side (builder.html):** open the link, enter the passcode, drag or
tap to upload photos and videos, type captions if she wants them, drag
rows up/down to reorder. Every video also gets an "Audio" checkbox — leave
it checked to keep that clip's original sound, or uncheck it to play that
video silently (handy for shaky handheld clips with wind noise, or ones
that would step on background music). Everything saves automatically —
there's no "save" button. She can do this in short sessions over several days as
photos come in from family; nothing needs to be finished at once.

**Day of (index.html):** open the link on the display, click "Begin"
once (browsers require one click before they'll play audio), then it
runs hands-free and loops. Photos and videos crossfade into each other,
and anything that doesn't perfectly fill the screen (a square photo, a
panorama, a vertical phone video) gets a softly blurred, darkened copy of
itself filling the space behind it instead of plain black bars.

**Loop and random order.** In the builder's "Playback" card: "Loop back
to the title card" is on by default — turn it off and the show plays
through once and stops on the closing card instead of restarting.
"Random order" reshuffles the photo/video order each time it loops back
to the start (the title and closing cards always stay fixed at the very
start and end either way).

**Save and load a project.** The "Save & load project" card exports
everything except the actual photo/video files themselves — title card
text, order, captions, per-video audio settings, loop/random settings —
to a downloadable `.json` file. This is meant as a backup/checkpoint, or
a way to move a project to a different Supabase backend later. Loading a
project file **replaces** whatever's currently in the builder, so it'll
ask you to confirm first.

Because the actual media files aren't in that export, if you load it
somewhere those files aren't already uploaded (a fresh Supabase project,
for instance), it'll show you which ones are missing and let you relink
them — drop the original photos/videos back in and it matches them to
the right slot by filename automatically, or pick a file manually for
anything that doesn't match. Nothing in the show breaks while a slide is
unrelinked; it just shows as a placeholder until you get to it.

**Limits worth knowing:**
- Free Supabase storage caps at 1GB total and 50MB per individual file.
  75 photos plus a handful of compressed videos should fit comfortably;
  raw unedited phone video (which can run 150–300MB per clip) will not.
  Compress anything large first — HandBrake is free and simple, 1080p at
  a modest bitrate is plenty for a TV screen.
- Free Supabase projects pause after 7 days with no activity. Using the
  builder page or loading the slideshow counts as activity, so this
  shouldn't come up between now and the memorial — but if the slideshow
  link ever shows a connection error the week of, it likely just needs a
  "Resume project" click in the Supabase dashboard (takes about 30
  seconds).

## Testing before the day

Open the live `index.html` link on the actual laptop/TV you'll use,
fullscreen (press F), a day or two ahead. Confirm audio plays, video
clips play through, and nothing looks cropped oddly on that specific
screen's aspect ratio.
