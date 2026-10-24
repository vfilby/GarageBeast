# Video plan: the garage eyes

Three cuts from one night of phone footage, released in order, each pointing at the next thing.

| # | Cut | Where | Shape | Length | Job |
|---|---|---|---|---|---|
| 1 | **The reveal** | TikTok, Reels, YouTube Shorts | 9:16 | 30–45 s | Make people stop scrolling. Almost no explanation. Ends with "how it works ↓ / link in bio". |
| 2 | **How it works** | TikTok, Reels, Shorts | 9:16 | 60–90 s | The quick how-to: what's in the garage, how the camera drives the eyes, one funny bug. Points at the blog post and the repo. |
| 3 | **The long version** | YouTube | 16:9 | 4–6 min | Reveal + walkthrough + the sync saga told properly + the styles. The blog post in video form. |

Release order: blog post and GitHub repo go live first (they're the link), then cut 1, then cut 2 two or three days later, then cut 3 the following week. The reveal wants real Halloween-season darkness, so the shoot is an October evening once both doors are running.

## Who does what

**What I can do, on request, from this Mac:**

- **Render eye footage at any size and aspect.** `node video/render.mjs` drives the real relay and captures headless Chrome in real time (see the `SHOTS` table in the script). Already rendered into `video/out/`: `wake.mp4` (12 s, slits → flare → look around → blink), `styles.mp4` (27 s, all twelve styles, 2.4 s each), `tallclip.mp4` (10 s, one eye, 1080×1920 for vertical cuts), and stills of every style. New shots are one line each.
- **Christmas loop footage** the same way (for the "it's not just Halloween" beat).
- **Assemble rough cuts with ffmpeg**: trim and concatenate your phone clips, crop 16:9 to 9:16 with a chosen pan, speed ramps, cross-fades, picture-in-picture of the control page over the door shot, burned-in captions, title cards, end card. Give me the clips and a shot order and I'll return an MP4 to review; iterate by describing changes.
- **Captions**: SRT files for YouTube and TikTok, or burned in.
- **Voiceover scratch track** with macOS `say`, so the cut can be timed before you record the real one. (Real voice is yours; phone voice memo in a quiet room is fine.)
- **Thumbnails** for YouTube (16:9 still from the eye render with a title) and cover frames for the shorts.
- **Post copy**: titles, descriptions, hashtags, pinned comment with the links (drafts below).
- **A tracker-view clip**: the tracker records every event as JPEG frames (`events/<time>/`); I can turn one into a short annotated "what the camera sees" clip. Your call whether that goes public (it's your driveway).
- **An architecture diagram** for the blog post and the long cut.

**What only you can do:**

- Shoot the phone footage (shot list below). This is the only part that can't be faked and it's the whole video.
- Record the voiceover, or decide the shorts are captions-only (very common, totally fine).
- Pick music inside TikTok/Instagram/YouTube's own libraries when posting. Anything I add from outside is a licensing problem.
- Move the repo to GitHub, flip the blog post out of draft, put the links in the bios.
- Post. I can't upload to any of the three platforms.

## Shooting guide (one evening, ~45 minutes)

Settings: 4K, 30 fps, lock exposure and focus on the door (tap and hold), turn off HDR. Wipe the lens. Use a tripod or lean the phone on the car; handheld night footage looks worse than you think. Shoot every setup **twice, once landscape and once portrait**. The two doors side by side are wide, so the vertical cuts need their own framing (one door, or both from further back), and the landscape cut needs the pair.

Kill the porch light and any landscape lighting for the shoot. Streetlights in frame will blow out.

| # | Shot | Notes |
|---|---|---|
| A | **Money shot.** Static, from the sidewalk, both doors dark. Someone (you, a kid, a willing neighbour) walks up the driveway. Eyes wake and follow them to the door. Let it run until the eyes doze off again. | 3 takes. Whole thing ~40 s. This is cut 1. |
| B | **POV walk-up.** Phone at chest height, walking from the street to the door. The eyes track *you*. | 2 takes, slow walk. Don't look down at the phone. |
| C | **Sleeping slits.** Close on one door, nobody around, 20 s of the breathing slits. | The opening frame of cut 1. |
| D | **Style switch from the street.** Phone on tripod, someone on the control page cycles monster → Sauron → HAL → jack → human. | Hold 5 s per style. |
| E | **The garage.** Inside, lights on, then off: projector, cable to the Pi, the Pi. Slow pan. 15 s each. | "It's just a projector and a Raspberry Pi." |
| F | **The phone.** Screen recording of the control page on your phone: preview, drag pad moving the eyes, the tracker frame, projector pills. | iOS screen record; 30 s. Also film the phone in hand with the doors behind if you can. |
| G | **The fail.** Both doors, someone walks up, and you watch from the *house* side so the eyes look the wrong way. Or skip: I can fake it with a mirrored render for the "it looked the wrong way" beat. | Optional. |
| H | **You.** Ten seconds of you in front of the doors, eyes on, saying one line: "It's a Halloween decoration. It got a little out of hand." | For the end of cut 1 and the open of cut 3. Optional but it's what makes it yours. |

Drop everything into `video/footage/` named `A1.mov`, `A2.mov`, `B1.mov`... (letter = shot, number = take). Note which take you liked.

## Cut 1: the reveal (30–45 s, 9:16)

No voiceover. Captions only, big, two or three words at a time. Music: something low and slow from the in-app library; the eyes are the sound design.

| Time | Picture | Caption |
|---|---|---|
| 0–3 s | Shot C: dark doors, faint slits breathing. | *our garage doors* |
| 3–8 s | Shot A: person enters frame at the street. Slits open, pupils flare. | *have eyes now* |
| 8–20 s | Shot A continues: eyes track the walk-up. Cut in 2 s of shot B (POV) around 14 s. | (nothing; let it play) |
| 20–26 s | Shot D: three quick style switches, 2 s each (Sauron, HAL, jack). | *twelve looks* |
| 26–32 s | Shot A end: person leaves, eyes look around, doze back to slits. | *it goes back to sleep when you leave* |
| 32–38 s | Shot H if you have it, else shot E lights-on garage reveal (projector + Pi). | *two projectors, a Raspberry Pi, a camera, a web page* |
| 38–42 s | End card on black: eye still (monster) small, text. | *how it works → part 2 · code + write-up in bio* |

Hook rule for TikTok: the person should be visible and the eyes should move within the first 3 seconds, so if shot C makes the open too slow, start on shot A at the moment the slits open and put "our garage doors have eyes now" on that.

## Cut 2: how it works (60–90 s, 9:16)

Voiceover (or captions) over footage. Written to be said, so it's plain.

> Our garage doors have eyes. Here's what's in the garage. *(E)*
>
> Two projectors, one per door, pointed at the door from the inside. Each one shows a web page. The page is black with an eye on it, and a projector can't project black, so all you see is the eye. *(E, then render: styles.mp4 crop)*
>
> The camera on the driveway is watching for people. A small script pulls the video, finds a person, and tells the eyes where to look, ten times a second. *(F: tracker frame on the phone, then A)*
>
> The eye doesn't slide to you. It waits a beat, jumps, lands a little short, and corrects, because that's what real eyes do. I read papers about this. For a Halloween decoration. *(B, slow-mo)*
>
> The hardest bug: with two doors, the two eyes didn't agree. One would blink, then the other. Or they'd cross. Or one would fall asleep while the other stared at you. *(render: two eyes out of sync, I can fake this by running two standalone pages)*
>
> The fix was making the server the brain. It decides when to blink and where to look; the browsers just draw. *(render: wake.mp4, both eyes in step)*
>
> Twelve looks, controlled from a phone. *(D or F)*
>
> Write-up and code in the bio. Merry Halloween. *(H or end card)*

## Cut 3: the long version (4–6 min, 16:9, YouTube)

1. **Cold open** (0:00–0:30): shot A, landscape, uncut. Title card.
2. **What it is** (0:30–1:15): shot H line, then E, the hardware list as on-screen text while the camera pans the garage.
3. **The page** (1:15–2:00): screen recording of the eye page on a laptop with the debug HUD on (`?debug=1`), style keys being pressed. I render this.
4. **The camera** (2:00–2:45): control page screen recording, tracker frame with the boxes, then shot B intercut.
5. **Making it feel alive** (2:45–3:30): the saccade explanation, with a side-by-side render of "glide" vs "saccade" (I can render the v1 eye next to the current one).
6. **The sync saga** (3:30–4:45): the five named bugs, each shown with a faked two-window render, then the fix.
7. **The wrong way** (4:45–5:15): shot G or a mirrored render; the viewpoint explanation.
8. **What's next + links** (5:15–5:45): Christmas loops render, roadmap, GitHub, blog. End card.

## Post copy (drafts)

**TikTok / Reels, cut 1**
> Our garage doors have eyes now. They wake up when you walk up the driveway and follow you to the door. It's a Halloween decoration. It got out of hand. Part 2 is how it works.
> #halloween #halloweendecor #projectionmapping #diy #raspberrypi #homelab #maker #spooky

**TikTok / Reels, cut 2**
> How the garage eyes work: two projectors, a Raspberry Pi, a driveway camera, and a web page. The hardest bug was getting two eyes to blink at the same time. Code and the long write-up in bio.
> #halloween #howitsmade #raspberrypi #computervision #projectionmapping #diy #homelab #maker

**YouTube, cut 3**
> Title: I gave my garage doors eyes that follow you (projector + Raspberry Pi + a driveway camera)
> Description: Two rear-projected eyes on a pair of garage doors that sleep as slits, wake up when the driveway camera sees a person, and track them to the door. A web page draws the eye, a tiny Node server is the brain, a Python tracker watches the camera, and the projectors are controlled over PJLink. This is the long version: the hardware, how the eye movement works, the multi-window sync saga (lizard blink, cross-eyed monster, the haunted cursor), and the night the eye looked the wrong way.
> Chapters from the cut list above. Links: blog post, GitHub repo.

**Pinned comment (all three):** blog post URL, GitHub URL, "questions welcome, it's all in the README".

## Before anything goes live

- [ ] **Repo to GitHub.** Suggested name `vfilby/HalloweenEyes`. Check first: `git log -p | grep -i -E 'rtsp://|password|PJ_PASSWORD='` for anything that ever landed in history (`.env` is ignored, but `docs-projector-control.md` and the build notes name the default projector password and internal hostnames). Decide whether the wiki links and `eyes.example.com` URLs in the README are fine to publish.
- [ ] Add the `GitHubRepo` component and the YouTube embed to the blog post (both are TODO comments in the MDX), set `draft: false`, publish.
- [ ] Link in bio on TikTok and Instagram → the blog post. YouTube description → blog post + repo.
- [ ] Swap the blog hero for a real night photo of the doors if shot A looks good.

## Assembling a cut

Put the clips in `video/footage/`, tell me the take numbers, and I'll build the cut with ffmpeg from a shot list like the ones above and hand back `video/out/cut1.mp4` for review. If you'd rather drive it yourself, iMovie on this Mac is enough for all three cuts: import the clips, set the project to vertical for the shorts, use Titles for captions, and export at 1080p. I'll still render whatever eye footage and title cards you need.
