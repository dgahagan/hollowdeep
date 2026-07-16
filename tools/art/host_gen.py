#!/usr/bin/env python
"""Generate adventure art with FLUX.2-klein-4B on the host GPU.

Runs on the HOST, not in the distrobox: the container has no GPU, so callers
cross the bridge with

    distrobox-host-exec ~/pixelart-venv/bin/python tools/art/host_gen.py REQUEST.json

This is a rewrite. The original lived in the sibling bards-tale-clone project
and is gone from its working tree -- only a `pixelcore` .pyc survives, and that
turned out to be the palette module, not this. What was recoverable was the
request-file *contract*, still documented in that project's docs/art-pipeline.md
and demonstrated by its committed gen_request*.json examples, so this reproduces
the contract rather than inventing one.

What is deliberately NOT reproduced: that project generated 112x93 indexed-colour
pixel art through a pixel-art LoRA and a palette crush. Hollowdeep's art is
painterly scene illustration shipped as real image files (PROJECT-BRIEF, locked
decision) -- explicitly not that. So no LoRA, no palette step. Generate, pick a
seed, optimize, commit.

Request file (one object, `entries` is a list):

    {"entries": [
      {"name": "road", "prompt": "...", "seed": 3,
       "gen_w": 1024, "gen_h": 576, "out": "/abs/path/road_s3.png"}
    ]}

Two properties worth keeping, both inherited from the original:

  * **Idempotent.** An entry whose `out` already exists is skipped, so a re-run
    after adding one subject costs one image, not the whole set.
  * **Deterministic.** `seed` drives a seeded generator, so the same entry
    always renders the same image. That is what makes contact-sheet review work:
    you pick a seed and it stays picked.

The model loads once for the whole request, which is the entire reason this
takes a batch rather than a single subject -- load is minutes, generation is
seconds.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"

# FLUX.2-klein is a DISTILLED model (its own model_index.json says
# `is_distilled: true`). Diffusers' generic defaults -- 50 steps, guidance 4.0
# -- are tuned for the undistilled family and mostly waste time here; the point
# of a distilled model is that it converges in few steps. These are the
# defaults, overridable per entry.
DEFAULT_STEPS = 8
DEFAULT_GUIDANCE = 2.5


def log(msg: str) -> None:
    print(msg, flush=True)


def load_pipeline():
    import torch
    from diffusers import Flux2KleinPipeline

    if not torch.cuda.is_available():
        sys.exit("no CUDA device -- this must run on the host, not in the distrobox")

    log(f"loading {MODEL_ID} on {torch.cuda.get_device_name(0)} ...")
    started = time.time()
    pipe = Flux2KleinPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    # The 4B transformer plus a Qwen3 text encoder does not comfortably sit in
    # 16GB alongside anything else. Offloading trades a little speed for not
    # falling over, which is the right trade for a batch job on a desktop card.
    pipe.enable_model_cpu_offload()
    log(f"loaded in {time.time() - started:.1f}s")
    return pipe


def generate(pipe, entry: dict) -> bool:
    """Render one entry. Returns True if it rendered, False if skipped."""
    import torch

    out = Path(entry["out"])
    if out.exists():
        log(f"  skip   {entry['name']} (exists)")
        return False

    out.parent.mkdir(parents=True, exist_ok=True)
    seed = int(entry["seed"])
    started = time.time()

    image = pipe(
        prompt=entry["prompt"],
        width=int(entry["gen_w"]),
        height=int(entry["gen_h"]),
        num_inference_steps=int(entry.get("steps", DEFAULT_STEPS)),
        guidance_scale=float(entry.get("guidance", DEFAULT_GUIDANCE)),
        generator=torch.Generator("cpu").manual_seed(seed),
    ).images[0]

    image.save(out)
    log(f"  render {entry['name']} seed={seed} {image.width}x{image.height} "
        f"{time.time() - started:.1f}s -> {out}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate adventure art with FLUX.2-klein-4B.")
    parser.add_argument("request", type=Path, help="JSON request file")
    parser.add_argument("--force", action="store_true", help="re-render even if the output exists")
    args = parser.parse_args()

    request = json.loads(args.request.read_text())
    entries = request["entries"]
    if not entries:
        log("nothing to do -- request has no entries")
        return 0

    if args.force:
        for entry in entries:
            Path(entry["out"]).unlink(missing_ok=True)

    pending = [e for e in entries if not Path(e["out"]).exists()]
    log(f"{len(entries)} entries, {len(pending)} to render")
    if not pending:
        log("all outputs already exist -- nothing to do")
        return 0

    pipe = load_pipeline()
    rendered = 0
    for entry in entries:
        try:
            if generate(pipe, entry):
                rendered += 1
        except Exception as error:  # one bad entry must not lose the batch
            log(f"  FAILED {entry['name']}: {error}")

    log(f"done -- {rendered} rendered, {len(entries) - rendered} skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
