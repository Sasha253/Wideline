# Licences in the CV path

The PRD forbids AGPL model code (Ultralytics YOLO and similar) anywhere in the
product. Every model and library the CV worker uses is listed here with its
licence, and CI runs `cv_worker/scripts/check_licences.py`, which fails the
build unless every installed package is Apache-2.0, MIT, BSD-2-Clause,
BSD-3-Clause or ISC, or is named in its `LICENCE_EXCEPTIONS` with a reason
(C09). AGPL and the deny list fail whatever the exceptions say.

The worker has two profiles (C09). The **base** profile (the core packages
plus development tools) is what CI, the default `wideline-cv-worker` image and
synthetic mode install. The **model** profile adds the `model` extra (torch,
torchvision, rfdetr) for the hand-built GPU image only; its transitive
licences wait on blocker B-001 (`docs/build/BLOCKERS.md`), so its exception
list (`MODEL_LICENCE_EXCEPTIONS`) is empty and `check_licences.py --extra
model` fails today. Nothing from the model profile is in the default install.

Add a row before adding a dependency to the CV path.

| Component | Used for | Licence | Status |
|---|---|---|---|
| jsonschema | Validating the worker contract | MIT | In use |
| typing-extensions (via jsonschema's `referencing`) | Runtime dependency of jsonschema | PSF-2.0 (permissive) | In use; listed in `LICENCE_EXCEPTIONS` |
| structlog | Structured logs | MIT or Apache-2.0 | In use |
| numpy | Frames, maths and the synthetic scene (C09) | BSD-3-Clause, with small bundled 0BSD, MIT, Zlib and CC0-1.0 parts | In use; listed in `LICENCE_EXCEPTIONS` for the bundled parts |
| scipy | `linear_sum_assignment` in the vendored ByteTrack (C09) | BSD-3-Clause | In use |
| ByteTrack, vendored from supervision 0.26.1 (`cv_worker/wideline_cv/track/byte_tracker.py`) | People tracking (C09; CV03). Vendored, not installed, so supervision's own dependencies (tqdm, certifi, matplotlib) stay out (Q-044) | MIT, notice kept in the file and in `cv_worker/THIRD_PARTY_NOTICES.md` | In use |
| pathspec (via mypy) | Development only, not shipped | MPL-2.0, used unmodified | In use; listed in `LICENCE_EXCEPTIONS` |
| ajv (web app) | Validating CV results against the contract schema (C08) | MIT | In use |
| types-jsonschema | Type stubs for mypy (development only, not shipped) | Apache-2.0 | In use |
| ffmpeg (system binary, invoked as a process) | Frame sampling, probing, transcoding | GPL-2.0+: the Debian build includes libx264 (GPL-2+), used for the C07 HLS ladder. Run as a separate process on our servers and never distributed, so no copyleft obligation applies; it is not AGPL | In use |
| rfdetr 1.11.2 (Roboflow), `model` extra | Detection of people and the ball (C09; CV02, model mode) | Apache-2.0 | In use in model mode (GPU image only, B-001) |
| torch 2.15.0, `model` extra | RF-DETR runtime (C09) | BSD-3-Clause (with Apache-2.0, BSL-1.0, ISC, MIT and Zlib parts); its CUDA wheels (`nvidia-*`) are under NVIDIA's proprietary licence | In use in model mode (GPU image only); waits on B-001 |
| torchvision 0.29.2, `model` extra | RF-DETR runtime (C09) | BSD-3-Clause | In use in model mode (GPU image only); waits on B-001 |
| RF-DETR Medium COCO checkpoint, `rf-detr-medium.pth` from https://storage.googleapis.com/rfdetr/medium_coco/checkpoint_best_regular.pth, sha256 `749ff6071828aaffac63e204c4f4135ed3d6cdae4d702e086c360edc3b5768c8` | Starting weights, baked into the GPU image at build and checked by sha256 (C09) | Apache-2.0 (the XL and 2XL sizes are under Roboflow's platform licence and are refused by `ALLOWED_CHECKPOINTS`); trained on COCO, whose images carry mixed Flickr licences | In use in model mode; confirmation asked in B-001 |
| supervision (Roboflow) package | Not installed: its ByteTrack is vendored (above) | MIT (its dependencies are not all permissive) | Not used (Q-044) |
| SoccerNet data and weights | Benchmarking only: `cv_worker/scripts/soccernet_to_tags.py` converts locally downloaded labels to Lab tags | Mostly research-only | Benchmarking only, never shipped or committed; check each component's terms |
| Synthetic scene (`cv_worker/wideline_cv/synthetic/`) | CI, development and the golden fixtures (C09) | Our own code | In use |

Denied: `ultralytics` and any YOLOv5/v8/v11 package from Ultralytics (AGPL-3.0).
