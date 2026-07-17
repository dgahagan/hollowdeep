# Hollowdeep Art Review Log

Append-only verdict log for Phase B curation (design plan §6; implementation
plan standing rule 5). Every verdict — including rejections, with reasons —
gets an entry. Contact sheets live under `dev/art-candidates/` (gitignored,
reproducible from `dev/art/hollowdeep.json` + `tools/art/`).

---

## 2026-07-17 — T3 style lock

**Verdict (human): Candidate C — chiaroscuro — locked for all four classes.**

Probe batch: 4 suffix candidates × 6 probe subjects (`main-street`,
`long-drift`, `cathedral`, `toolroom`, `brass-lantern`, `stalker`) × 6 seeds
= 144 renders, zero failures. Sheets reviewed at delivered scale via
`dev/art-candidates/style-probes-index.html` (per-candidate sheets under
`dev/art-candidates/sheets-{A,B,C,D}/`).

The winning suffix, verbatim (now frozen in `dev/art/hollowdeep.json`
`styles.*`; identical string for scene/item/creature/marquee):

>  Painted in oils on canvas, the lit passages worked in thick visible
> strokes and the darks laid in flat and deep, a matte unvarnished surface.
> Muted, earthy colour, warmed as if by flame where the light falls.
> Recorded plainly and observationally, as the thing is, without drama. Not
> digital art, not concept art, not a videogame asset, no rim lighting, no
> gloss, nothing polished. No text, no lettering, no numbers, no signature.

Losing candidates (descriptions; orchestrator's sheet observations — the
pick itself was the human's):

- **A — control** (test-cave's suffix verbatim): held the proven matte look
  but sat brighter and more even-lit than the design plan's "lamplit oil,
  dark" direction; the darkness came only from the subject prompts.
- **B — board + dark edges**: thin paint and near-black edge language; the
  edge darkening read as a vignette effect in several probes rather than
  painted darkness.
- **D — impasto**: heaviest brush texture; the ridged-paint language pulled
  attention to the surface over the subject in the darker probes.

Orchestrator sanity notes from the probe sheets (not verdicts; for T4
review attention): `probeC-cathedral` seeds leaned toward dressed masonry
rather than natural cavern — watch prompt adherence on karst scenes when
curating; `main-street` seeds read broadly as a generic weathered town —
acceptable variance to judge seed-by-seed in T4.

**Suffixes are frozen from this commit** (standing rule 4): a change now
reopens every finaled subject.

---

## 2026-07-17 — T4 scenes: all 53 chosen

Full generation (648 renders) then a systemic **lamp-as-source** correction: most
dark scenes had rendered the lamp as an object in-frame instead of the off-frame
light source the design plan intends (decision 1). All 44 dark-scene prompts were
reworded (lit from outside the frame; no lamp/hand/figure depicted) and regenerated;
the 9 lit/daylight scenes were unaffected. Per-scene content retries logged inline in
the manifest `notes`: assay-office (active fire→cold rings), timekeepers-nook (hooks
all-filled→mostly-empty), magazine (gibberish label→illegible smear), cathedral
(masonry→natural rock), shaft-foot (painted stripe→stain band), black-river (fish
above water→submerged), midden (lit candle→removed).

Reviewed with the new interactive UI (`tools/art/review-ui.ts`, added this task at
the human's request). Chosen seeds:

- adit-drift: 13
- adit-mouth: 2
- antechamber: 13
- assay-office: 3
- behind-the-seal: 2
- beyond-the-breach: 13
- black-river: 1
- breach-wall: 13
- breakthrough: 1
- broken-drift: 8
- cathedral: 3
- chapel: 3
- cistern: 2
- closed-row: 13
- coach-road: 1
- deep-cut: 2
- dressed-gallery: 3
- foremans-office: 8
- gallery-of-veils: 1
- general-store: 8
- gour-pools: 13
- junction: 2
- keepers-stair: 5
- keepers-walk: 13
- lamp-room: 2
- long-drift: 2
- long-stair: 8
- low-crawl: 5
- magazine: 13
- main-street: 1
- midden: 13
- ore-chute: 5
- pump-room: 8
- quiet-gallery: 2
- river-strand: 2
- seal-gate: 3
- shaft-foot: 5
- shaft-head: 5
- stables: 3
- store-rooms: 1
- stull-gallery: 1
- tailings-path: 8
- tally-chamber: 2
- the-gunnis: 5
- the-vault: 1
- timekeepers-nook: 8
- toolroom: 1
- twisty: 5
- undercroft: 13
- warm-gallery: 13
- watch-room: 5
- winze-ladderway: 8
- worked-face: 5
