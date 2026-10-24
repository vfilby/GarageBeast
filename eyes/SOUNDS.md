# Growls and purrs (`eyes/sounds/`)

All of it is committed. `eyes/make-sounds.sh` documents (and can redo) the five cuts made from public sources; the two synth
voices (the purr and the sniff) live in `growl.js` and need no files. With an empty `sounds/` the synth growl stands in on wake.

The relay brain picks one of these at random each time the eyes wake (never the same file twice running) and names it in
`{cmd:'growl', file}`; drop a file in or take one out and the pool changes on the next growl, no restart. All are mono
44.1 kHz MP3, cut, faded and levelled with
`ffmpeg -ss <start> -t <len> -i <source> -ac 1 -ar 44100 -af "afade=in:d=0.06,afade=out:st=<len-0.45>:d=0.45,loudnorm=I=-14:TP=-2" -b:a 160k out.mp3`
(dense, already-limited sources overshoot on MP3 encode: add `alimiter=limit=0.6:level=disabled` and use `-b:a 192k`).
"Small speaker" = level lost when everything under 200 Hz is removed, roughly what a projector's built-in speaker does.

| File | Source, cut | Licence / credit | Small speaker |
|---|---|---|---|
| `gator-1.mp3` | American alligator bellow, Everglades NP, NPS sound gallery `nri-AlligatorEVER1.mp3`, 0.00–3.45 s (the clean first bellow), low-passed 2.6 kHz | Public domain (US National Park Service). Credit: "Alligator recording: National Park Service" | −7.0 dB |
| `gator-2.mp3` | same recording, 14.75–18.00 s, low-passed 2.6 kHz | same | −7.1 dB |
| `gator-3.mp3` | same recording, 21.75–25.00 s | same | −6.6 dB |
| `big-dog.mp3` | "Audio S3. Sound sample of the used growls. Large dog.", whole (2.1 s) | CC BY 2.5. Faragó T, Pongrácz P, Miklósi Á, Huber L, Virányi Z, Range F (2010), "Dogs' Expectation about Signalers' Body Size by Virtue of Their Growls", PLOS ONE, doi:10.1371/journal.pone.0015175. Trimmed and levelled. | −3.3 dB |
| `deep-beast.mp3` | `Growl.wav` from "Animal or beast sounds" by pauliuw, OpenGameArt, whole (2.75 s) | CC0 1.0 (uploader's declaration) | −11.8 dB |

Sources: https://www.nps.gov/subjects/sound/sounds-alligator.htm ·
https://commons.wikimedia.org/wiki/File:Dogs%27-Expectation-about-Signalers%27-Body-Size-by-Virtue-of-Their-Growls-pone.0015175.s007.ogg ·
https://opengameart.org/content/animal-or-beast-sounds

The alligator recording has handling noise on the second bellow (7.6 s, 8.9–9.4 s) and between the later ones (19.0 s, 20.7 s);
the cuts avoid it.

## From a free sound-effects site (downloaded by the owner)
Cut from files the owner downloaded from a free sound-effects site on 2026-09-19 and chose to commit; the files carry no source
or licence metadata (ID3 titles only, dated 2024), so the site name and its licence page still belong here. Same fades as
above; the dense ones use `loudnorm=I=-15:TP=-2,alimiter=limit=0.6:level=disabled` at 192 kb/s, the breaths
`afade` 0.3 / 0.6 s, `loudnorm=I=-16:TP=-2,alimiter=limit=0.7:level=disabled` at 128 kb/s.

| File | Source, cut |
|---|---|
| `fx-monster-a.mp3` | "Monster growls (2)" (`monster-growls-2.mp3`), 0.00–4.15 s. On demand only: too much for a wake |
| `fx-monster-b.mp3` | same, 5.78–8.73 s |
| `fx-monster-long.mp3` | "The monster growls" (`the-monster-growls.mp3`), 0.00–4.80 s |
| `rumble-breath-1…5.mp3` | "Sound from the dungeon: the monster or dragon is sleeping (you can hear him sniffing)", 41 s of slow breathing; single breaths at 0.05, 5.15, 15.45, 20.95 and 34.05 s (4.95–5.5 s each), fades 0.3 / 0.6 s, `loudnorm=I=-16` |

Files named `rumble-*` are the soft pool, `fx-*` are on-demand effects (control page buttons only); everything else is the wake-growl pool.
Tried and dropped: "Roar of the tiger (short sound)" (not liked).
