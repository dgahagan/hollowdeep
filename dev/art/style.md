# Prompting notes — what the first pass got wrong

Kept because the fixes are not obvious from the output, and the next person
(or the next adventure) will hit the same three.

## 1. Tag soup is the wrong shape for this model

FLUX.2-klein encodes prompts with **Qwen3, a language model**. The first pass
used comma-separated tags (`painterly digital illustration, oil-painted, moody
atmospheric lighting, muted earthy palette, dramatic chiaroscuro, ...`), which
is Stable-Diffusion-era habit. A language encoder reads sentences. Describing
the medium in prose holds it far better than listing adjectives about it.

## 2. "digital illustration" bought glossy render

The tell was style drift *between subjects*: `road` came out matte and
oil-painted, `cave-rat` came out glossy, rim-lit, and rendered. Same suffix,
different medium — because the suffix said both "oil-painted" and "digital
illustration" and the model picked whichever the subject pulled toward.
Creatures pull toward game art. Say the medium once, physically, and say what
it is *not*.

## 3. Fantasy vocabulary summons fantasy art

The rat prompt asked for "menacing", and got a handsome hero-lit monster
portrait. But test-cave's rat is not a monster — the adventure says:

> A rat the size of a well-fed terrier, with the flat unbothered stare of
> something that has never once been the smaller animal in the room.

The horror there is that it is *ordinary* and simply too large, and does not
care about you. "Menacing" is the narrator's conclusion, not the picture's
content. **Prompt the observation, never the adjective the reader should
arrive at.** Same rule as the engine's prose: show the thing, let the dryness
do the work.

## 4. There is no negative prompt

`Flux2KleinPipeline` takes `negative_prompt_embeds` but no `negative_prompt`.
Exclusions have to live in the positive prompt as plain statements ("nothing
glows", "no lettering"), and they are weak — the first pass still put faint
text artifacts in the sky. Check skies and walls on review; a seed with
lettering is a reject, not a fix.

## 5. Hollowdeep's suffix lock (T3, 2026-07-17)

Four candidates probed (control = test-cave's suffix; board + near-black
edges; chiaroscuro; heavy impasto) against six subjects spanning the space,
6 seeds each. **C — chiaroscuro — won** (human verdict; see
`art-review/art-review.md`). Two things worth keeping:

- Putting *tonal structure* in the suffix ("lit passages worked thick, darks
  laid in flat and deep") did NOT override per-subject light the way putting
  *lighting* there did (the test-cave lesson in `test-cave.json`'s _readme).
  The suffix says how paint handles light; each prompt still says where the
  light is. `main-street`'s overcast daylight survived intact next to
  `cathedral`'s lamplit dark.
- "Warmed as if by flame where the light falls" is a colour instruction
  pinned to a physical cause, so daylight scenes stay gray — the flame
  warmth only shows up where a prompt puts fire or lantern light. Naming
  the cause beats naming the palette.

## 6. Trigger nouns beat instructions (T6 marquees, 2026-07-17)

Three curation rounds on the death vignettes reduced to one rule: **when an
object keeps rendering wrong, stop describing the object and describe only
what the viewer sees of it.** Corollary of §4 — since exclusions are weak,
the noun's training prior always outvotes the sentence around it.

- "A lantern sinking, attached to nothing" drew a hanging cord every time —
  *lantern* summons its prior (lanterns hang). "A small warm glow sinking
  away" fixed it; underwater, a glow is all you'd see anyway.
- "A dying lamp wick" and even "a minute red point of light" both rendered
  macro wick photography. The object noun (this time the game's own brass
  lantern, guttering) was the right call there — the failure was *wick*,
  a noun whose prior is extreme close-up.
- **Any animal noun paints the whole animal**, however wrapped in "vague",
  "outline", "mostly in darkness" (a fully-lit white wolf, §9.3 violation).
  Eyeshine only — "two small pale points of reflected light... nothing
  around them is visible" — gave the lurking thing without the creature.
- A static image can't show *falling*; a **blurred streak of warm light**
  dropping into a black slot, viewed from the broken edge, reads as the
  fall without any airborne object to grow a cord.
