"""A deterministic synthetic match (C09; synthetic mode, A-4).

Seeded from (seed, duration). Two teams of 10 outfield players and a
goalkeeper each, plus a referee, move in pitch metres; a scripted ball is
passed, dribbled, intercepted and shot. Shots alternate between the teams on
a schedule, with outcomes cycling through goal, off target and saved; a goal is
followed by a restart from the centre spot 35 to 50 s later. The script
records its own ground truth (touches, shots and goals), which `truth.py`
exports in the Lab's CSV format.

Home attacks the goal at x = 105 (the camera's right) for the whole scene;
x = 0 is the goal on the camera's left, y = 0 the near touchline (Q-043). A
fixed camera homography maps the pitch into a 960 x 540 frame (`render.py`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import cached_property
from typing import Literal

import numpy as np
import numpy.typing as npt

from ..calibration import fit_homography, project
from ..pipeline.types import PITCH_LENGTH, PITCH_WIDTH, EventType, Matrix

SAMPLE_MS = 200
FRAME_W, FRAME_H = 960, 540
CENTRE = (PITCH_LENGTH / 2, PITCH_WIDTH / 2)
POST_HALF = 3.66
MAX_RUN_M_PER_SAMPLE = 1.2  # 6 m/s
# Where the four pitch corners sit in the frame: a raised camera on the near
# touchline, so the far touchline is shorter.
CAMERA_CORNERS = (
    ((0.0, 0.0), (20.0, 520.0)),
    ((PITCH_LENGTH, 0.0), (940.0, 520.0)),
    ((PITCH_LENGTH, PITCH_WIDTH), (780.0, 120.0)),
    ((0.0, PITCH_WIDTH), (180.0, 120.0)),
)

Kind = Literal["outfield", "goalkeeper", "referee"]
Side = Literal["home", "away"]
Outcome = Literal["goal", "off", "saved"]
OUTCOMES: tuple[Outcome, ...] = ("goal", "off", "saved", "goal", "saved", "off")

KITS: dict[str, tuple[int, int, int]] = {
    "home": (200, 40, 45),
    "away": (40, 80, 205),
    "home_gk": (235, 215, 40),
    "away_gk": (245, 140, 20),
    "referee": (20, 20, 22),
}

# 4-4-2 for the home side, defending x = 0: (number, x, y).
FORMATION: tuple[tuple[int, float, float], ...] = (
    (2, 20.0, 10.0),
    (3, 20.0, 25.0),
    (4, 20.0, 43.0),
    (5, 20.0, 58.0),
    (6, 38.0, 10.0),
    (7, 38.0, 25.0),
    (8, 38.0, 43.0),
    (10, 38.0, 58.0),
    (9, 52.0, 27.0),
    (11, 52.0, 41.0),
)


def unit(*key: int) -> float:
    """A fast, deterministic uniform number in [0, 1) for integer keys (splitmix64)."""
    x = 0x9E3779B97F4A7C15
    for k in key:
        x = (x ^ (k & 0xFFFFFFFFFFFFFFFF)) * 0xBF58476D1CE4E5B9 & 0xFFFFFFFFFFFFFFFF
        x = (x ^ (x >> 31)) * 0x94D049BB133111EB & 0xFFFFFFFFFFFFFFFF
        x ^= x >> 29
    return (x >> 11) / float(1 << 53)


@dataclass(frozen=True)
class Actor:
    id: int
    kind: Kind
    side: Side | None
    number: int | None
    kit: tuple[int, int, int]
    home_xy: tuple[float, float]


@dataclass(frozen=True)
class TruthEvent:
    type: EventType
    t_ms: int
    side: Side | None
    on_target: bool | None
    actor: int | None


def _actors() -> list[Actor]:
    out: list[Actor] = []
    for side in ("home", "away"):
        flip = side == "away"
        gx = PITCH_LENGTH - 4.0 if flip else 4.0
        out.append(Actor(len(out), "goalkeeper", side, 1, KITS[f"{side}_gk"], (gx, 34.0)))
        for number, x, y in FORMATION:
            hx = PITCH_LENGTH - x if flip else x
            hy = PITCH_WIDTH - y if flip else y
            out.append(Actor(len(out), "outfield", side, number, KITS[side], (hx, hy)))
    out.append(Actor(len(out), "referee", None, None, KITS["referee"], (45.0, 40.0)))
    return out


class Scene:
    """Positions per sample of every actor and the ball, plus the ground truth."""

    def __init__(self, seed: int, duration_sec: float) -> None:
        self.seed = int(seed)
        self.duration_ms = max(round(duration_sec * 1000), SAMPLE_MS)
        self.n = self.duration_ms // SAMPLE_MS + 1
        self.actors = _actors()
        self.positions = np.zeros((self.n, len(self.actors), 2))
        self.ball = np.full((self.n, 2), np.nan)
        self.truth: list[TruthEvent] = []
        _Script(self).run()

    @cached_property
    def camera(self) -> Matrix:
        """Pitch metres to frame pixels."""
        h, _ = fit_homography([(p, px) for p, px in CAMERA_CORNERS])
        return h

    def t_ms(self, k: int) -> int:
        return k * SAMPLE_MS

    def to_frame(self, pts: npt.ArrayLike) -> npt.NDArray[np.float64]:
        return project(self.camera, pts)

    def scales(self, pts: npt.ArrayLike) -> npt.NDArray[np.float64]:
        """Frame pixels per metre along the touchline at each pitch point."""
        p = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        a = self.to_frame(p - np.array([0.5, 0.0]))
        b = self.to_frame(p + np.array([0.5, 0.0]))
        out: npt.NDArray[np.float64] = np.hypot(*(b - a).T)
        return out

    def scale_at(self, x: float, y: float) -> float:
        return float(self.scales([[x, y]])[0])

    @cached_property
    def actor_frame(self) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
        """Every actor's foot point in frame pixels and its scale, per sample."""
        flat = self.positions.reshape(-1, 2)
        px = self.to_frame(flat).reshape(self.n, len(self.actors), 2)
        sc = self.scales(flat).reshape(self.n, len(self.actors))
        return px, sc

    @cached_property
    def ball_frame(self) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
        """The ball in frame pixels and its scale, per sample (NaN when out of play)."""
        safe = np.nan_to_num(self.ball, nan=0.0)
        px = self.to_frame(safe)
        sc = self.scales(safe)
        px[np.isnan(self.ball[:, 0])] = np.nan
        return px, sc

    def actor_by_number(self, side: Side, number: int) -> Actor:
        return next(a for a in self.actors if a.side == side and a.number == number)


class _Script:
    """Steps the match one sample at a time."""

    def __init__(self, scene: Scene) -> None:
        self.s = scene
        self.rng = np.random.default_rng([scene.seed, 9091])
        self.pos = np.array([a.home_xy for a in scene.actors], dtype=np.float64)
        self.phase = self.rng.uniform(0, 2 * math.pi, size=(len(scene.actors), 4))
        self.period = self.rng.uniform(18, 40, size=(len(scene.actors), 2))
        self.mode: Literal["hold", "flight", "still", "net", "dead"] = "still"
        self.holder: int | None = self._forward("home")
        self.until = 10  # kickoff: the ball sits on the centre spot for 2 s
        self.ball = np.array(CENTRE)
        self.flight: tuple[int, int, npt.NDArray[np.float64], npt.NDArray[np.float64]] | None = None
        self.receiver: int | None = None
        self.after: Literal["receive", "goal", "saved", "off"] = "receive"
        self.shot_index = 0
        self.next_shot_k = 18 * 5
        self.restart: tuple[int, Side] | None = None
        self.goal_kick: tuple[int, Side] | None = None

    # -- helpers ---------------------------------------------------------------
    def _team(self, side: Side, outfield_only: bool = True) -> list[int]:
        return [
            a.id
            for a in self.s.actors
            if a.side == side and (a.kind == "outfield" or not outfield_only)
        ]

    def _forward(self, side: Side) -> int:
        return self.s.actor_by_number(side, 9).id

    def _keeper(self, side: Side) -> int:
        return self.s.actor_by_number(side, 1).id

    def _side(self, actor: int) -> Side:
        side = self.s.actors[actor].side
        assert side is not None
        return side

    def _goal_x(self, side: Side) -> float:
        """The goal this side attacks."""
        return PITCH_LENGTH if side == "home" else 0.0

    def _shot_team(self) -> Side:
        return "home" if self.shot_index % 2 == 0 else "away"

    def _touch(self, k: int, actor: int) -> None:
        self.s.truth.append(TruthEvent("touch", self.s.t_ms(k), self._side(actor), None, actor))

    # -- movement --------------------------------------------------------------
    def _targets(self, k: int) -> npt.NDArray[np.float64]:
        t = k * SAMPLE_MS / 1000.0
        bx, by = self.ball if self.mode != "dead" else CENTRE
        sx, sy = 0.55 * (bx - CENTRE[0]), 0.3 * (by - CENTRE[1])
        out = np.zeros_like(self.pos)
        for a in self.s.actors:
            ph, per = self.phase[a.id], self.period[a.id]
            wob = np.array(
                [
                    3.0 * math.sin(2 * math.pi * t / per[0] + ph[0]),
                    2.5 * math.sin(2 * math.pi * t / per[1] + ph[1]),
                ]
            )
            if a.kind == "referee":
                tgt = np.array([bx - 8.0, by + 7.0]) + wob
            elif a.kind == "goalkeeper":
                hx = a.home_xy[0] + 0.08 * (bx - CENTRE[0])
                tgt = np.array([hx, 34.0 + 0.15 * (by - 34.0)]) + wob * 0.2
            else:
                tgt = np.array([a.home_xy[0] + sx, a.home_xy[1] + sy]) + wob
            out[a.id] = tgt
        return out

    def _move(self, k: int) -> None:
        tgt = self._targets(k)
        if self.mode == "flight" and self.receiver is not None and self.flight is not None:
            tgt[self.receiver] = self.flight[3]
        if self.holder is not None and self.mode == "hold":
            side = self._side(self.holder)
            due = k >= self.next_shot_k and side == self._shot_team()
            goal = np.array([self._goal_x(side), 34.0])
            d = goal - self.pos[self.holder]
            step = 0.44 if due else 0.2
            tgt[self.holder] = self.pos[self.holder] + d / max(np.hypot(*d), 1e-6) * step
        if self.mode == "still" and self.holder is not None:
            behind = -0.5 if self._side(self.holder) == "home" else 0.5
            tgt[self.holder] = self.ball + np.array([behind, 0.0])
        delta = tgt - self.pos
        dist = np.hypot(delta[:, 0], delta[:, 1])
        scale = np.minimum(1.0, MAX_RUN_M_PER_SAMPLE / np.maximum(dist, 1e-9))
        self.pos = self.pos + delta * scale[:, None]
        self.pos[:, 0] = np.clip(self.pos[:, 0], 0.5, PITCH_LENGTH - 0.5)
        self.pos[:, 1] = np.clip(self.pos[:, 1], 0.5, PITCH_WIDTH - 0.5)

    # -- the ball --------------------------------------------------------------
    def _foot(self, actor: int) -> npt.NDArray[np.float64]:
        side = self._side(actor)
        ahead = 0.4 if side == "home" else -0.4
        foot: npt.NDArray[np.float64] = self.pos[actor] + np.array([ahead, 0.0])
        return foot

    def _pass(self, k: int, receiver: int, speed: float) -> None:
        assert self.holder is not None
        p0 = self.ball.copy()
        p1 = self.pos[receiver] + self.rng.uniform(-0.8, 0.8, size=2)
        dist = float(np.hypot(*(p1 - p0)))
        steps = max(2, math.ceil(dist / speed / (SAMPLE_MS / 1000)))
        self._touch(k, self.holder)
        self.flight = (k, k + steps, p0, p1)
        self.receiver, self.after, self.holder, self.mode = receiver, "receive", None, "flight"

    def _choose_receiver(self, k: int) -> tuple[int, float] | None:
        assert self.holder is not None
        side = self._side(self.holder)
        other: Side = "away" if side == "home" else "home"
        here = self.pos[self.holder]
        if k >= self.next_shot_k and side != self._shot_team():
            # The attacking side wins the ball: the pass is intercepted.
            opp = self._team(other)
            d = [float(np.hypot(*(self.pos[o] - here))) for o in opp]
            ranked = sorted((dd, o) for dd, o in zip(d, opp, strict=True) if dd >= 5.0)
            if ranked:
                return ranked[0][1], float(self.rng.uniform(8.0, 10.5))
        mates = [m for m in self._team(side) if m != self.holder]
        options = []
        for m in mates:
            dd = float(np.hypot(*(self.pos[m] - here)))
            if 7.0 <= dd <= 28.0:
                gain = (self.pos[m][0] - here[0]) * (1 if side == "home" else -1)
                options.append((gain, m))
        if not options:
            return None
        if k >= self.next_shot_k and side == self._shot_team():
            options.sort(reverse=True)
            if options[0][0] <= 2.0:
                return None  # nobody ahead: carry the ball on
            return options[0][1], float(self.rng.uniform(9.0, 11.0))
        pick = options[int(self.rng.integers(len(options)))]
        return pick[1], float(self.rng.uniform(8.0, 11.0))

    def _shoot(self, k: int) -> None:
        assert self.holder is not None
        side = self._side(self.holder)
        outcome = OUTCOMES[self.shot_index % len(OUTCOMES)]
        gx = self._goal_x(side)
        if outcome == "off":
            off = float(self.rng.uniform(5.2, 8.0)) * (1 if self.rng.random() < 0.5 else -1)
            aim = np.array([gx, 34.0 + off])
        else:
            aim = np.array([gx, 34.0 + float(self.rng.uniform(-2.4, 2.4))])
        p0 = self.ball.copy()
        direction = (aim - p0) / np.hypot(*(aim - p0))
        if outcome == "goal":
            end = aim + direction * (1.5 / abs(direction[0]))
        elif outcome == "saved":
            end = p0 + direction * ((abs(gx - p0[0]) - 1.6) / abs(direction[0]))
        else:
            end = aim + direction * (2.6 / abs(direction[0]))
        speed = float(self.rng.uniform(19.0, 25.0))
        steps = max(2, math.ceil(float(np.hypot(*(end - p0))) / speed / (SAMPLE_MS / 1000)))
        self._touch(k, self.holder)
        t = self.s.t_ms(k)
        self.s.truth.append(TruthEvent("shot", t, side, outcome != "off", self.holder))
        if outcome == "goal":
            frac = abs(gx - p0[0]) / abs(end[0] - p0[0])
            t_goal = self.s.t_ms(k) + round(frac * steps * SAMPLE_MS)
            self.s.truth.append(TruthEvent("goal", t_goal, side, None, self.holder))
        other: Side = "away" if side == "home" else "home"
        self.receiver = self._keeper(other) if outcome == "saved" else None
        self.flight = (k, k + steps, p0, end)
        self.after, self.holder, self.mode = outcome, None, "flight"
        self.shot_index += 1
        gap = int(self.rng.uniform(35, 45) * 5)
        self.next_shot_k = k + gap

    def _release(self, k: int) -> None:
        assert self.holder is not None
        side = self._side(self.holder)
        dist_goal = abs(self._goal_x(side) - self.pos[self.holder][0])
        if (
            k >= self.next_shot_k
            and side == self._shot_team()
            and dist_goal <= 26.0
            and self.s.actors[self.holder].kind == "outfield"
        ):
            self._shoot(k)
            return
        choice = self._choose_receiver(k)
        if choice is None:
            self.until = k + 4  # carry the ball a little further
            return
        self._pass(k, *choice)

    def _step_ball(self, k: int) -> None:
        if self.mode == "hold":
            assert self.holder is not None
            self.ball = self._foot(self.holder)
            if k >= self.until:
                self._release(k)
        elif self.mode == "still":
            if k >= self.until and self.holder is not None:
                self._release(k)
        elif self.mode == "flight":
            assert self.flight is not None
            k0, k1, p0, p1 = self.flight
            f = min(1.0, (k - k0) / (k1 - k0))
            self.ball = p0 + (p1 - p0) * f
            if k >= k1:
                self._arrive(k)
        elif self.mode == "net":
            if k >= self.until:
                self.mode = "dead"
        elif self.mode == "dead":
            if self.restart and k >= self.restart[0]:
                side = self.restart[1]
                self.ball = np.array(CENTRE)
                self.holder, self.mode, self.until = self._forward(side), "still", k + 15
                self.restart = None
            elif self.goal_kick and k >= self.goal_kick[0]:
                side = self.goal_kick[1]
                gx = 5.5 if side == "home" else PITCH_LENGTH - 5.5
                self.ball = np.array([gx, 34.0 + float(self.rng.choice([-8.0, 8.0]))])
                keeper = self._keeper(side)
                self.pos[keeper] = self.ball + np.array([-0.5 if side == "home" else 0.5, 0.0])
                self.holder, self.mode, self.until = keeper, "still", k + 15
                self.goal_kick = None

    def _arrive(self, k: int) -> None:
        assert self.flight is not None
        if self.after in ("receive", "saved"):
            receiver = self.receiver
            assert receiver is not None
            self.pos[receiver] = self.ball - (self._foot(receiver) - self.pos[receiver])
            self.holder, self.mode = receiver, "hold"
            self.until = k + (15 if self.after == "saved" else int(self.rng.integers(6, 12)))
            self._touch(k, receiver)
        elif self.after == "goal":
            scorer_side: Side = "home" if self.flight[3][0] > CENTRE[0] else "away"
            conceding: Side = "away" if scorer_side == "home" else "home"
            self.mode, self.until = "net", k + 10
            self.restart = (k + int(self.rng.uniform(35, 50) * 5), conceding)
            self.next_shot_k = max(self.next_shot_k, self.restart[0] + 60)
        else:  # off target: a goal kick 6 s later
            defending: Side = "away" if self.flight[3][0] > CENTRE[0] else "home"
            self.mode = "dead"
            self.goal_kick = (k + 30, defending)
        self.flight, self.receiver = None, None

    def run(self) -> None:
        for k in range(self.s.n):
            self._step_ball(k)
            self._move(k)
            if self.mode == "hold" and self.holder is not None:
                self.ball = self._foot(self.holder)
            self.s.positions[k] = self.pos
            if self.mode != "dead":
                self.s.ball[k] = self.ball
        end = self.s.duration_ms
        self.s.truth = sorted(
            (e for e in self.s.truth if e.t_ms <= end), key=lambda e: (e.t_ms, e.type)
        )
