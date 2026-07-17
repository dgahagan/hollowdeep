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
