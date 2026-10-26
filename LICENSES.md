# Licences in the CV path

The PRD forbids AGPL model code (Ultralytics YOLO and similar) anywhere in the
product. Every model and library the CV worker uses is listed here with its
licence, and CI runs `cv_worker/scripts/check_licences.py`, which fails the
build if any installed package is AGPL or GPL or on the deny list.

Add a row before adding a dependency to the CV path.

| Component | Used for | Licence | Status |
|---|---|---|---|
| jsonschema | Validating the worker contract | MIT | In use |
| structlog | Structured logs | MIT or Apache-2.0 | In use |
| ffmpeg (system binary, invoked as a process) | Frame sampling, probing, transcoding | GPL-2.0+: the Debian build includes libx264 (GPL-2+), used for the C07 HLS ladder. Run as a separate process on our servers and never distributed, so no copyleft obligation applies; it is not AGPL | In use |
| RF-DETR (Roboflow) | Detection (Phase 5) | Apache-2.0 | Planned |
| supervision (Roboflow) | ByteTrack tracking (Phase 5) | MIT | Planned |
| COCO-pretrained RF-DETR weights | Starting weights (Phase 5) | Apache-2.0 | Planned; check the weights' own terms before shipping |
| SoccerNet data and weights | Benchmarking only | Mostly research-only | Not shipped; check each component's terms |

Denied: `ultralytics` and any YOLOv5/v8/v11 package from Ultralytics (AGPL-3.0).
