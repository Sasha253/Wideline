"""C09: kit-colour teams, with goalkeepers by position and the referee unknown."""

from __future__ import annotations

import numpy as np

from wideline_cv.teams import assign_teams, rgb_to_lab


def lab(rgb: tuple[int, int, int], jitter: float = 0.0, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    c = np.array([rgb], dtype=np.float64) + rng.normal(0, jitter, size=3)
    return rgb_to_lab(np.clip(c, 0, 255))[0]


def test_two_kits_a_goalkeeper_and_a_referee() -> None:
    colours = []
    mean_x: list[float | None] = []
    zones = []
    for i in range(10):  # red, defending the left goal
        colours.append(lab((200, 40, 45), 4, i))
        mean_x.append(35.0 + i)
        zones.append((0.1, 0.0))
    for i in range(10):  # blue, defending the right goal
        colours.append(lab((40, 80, 205), 4, 100 + i))
        mean_x.append(65.0 + i)
        zones.append((0.0, 0.1))
    colours.append(lab((240, 140, 20)))  # keeper near the right goal
    mean_x.append(100.0)
    zones.append((0.0, 0.95))
    colours.append(lab((235, 215, 40)))  # keeper near the left goal
    mean_x.append(5.0)
    zones.append((0.95, 0.0))
    colours.append(lab((20, 20, 22)))  # referee in midfield
    mean_x.append(50.0)
    zones.append((0.05, 0.05))

    result = assign_teams(colours, mean_x, zones)
    assert set(result.sides[:10]) == {"home"}  # red has the higher a*, so it is cluster 0
    assert set(result.sides[10:20]) == {"away"}
    assert result.roles[20:22] == ["goalkeeper", "goalkeeper"]
    assert result.sides[20] == "away"
    assert result.sides[21] == "home"
    assert result.roles[22] == "official"
    assert result.sides[22] == "unknown"
    assert result.warnings == []


def test_close_kits_warn() -> None:
    colours = [lab((200, 40, 45), 3, i) for i in range(6)] + [
        lab((205, 55, 50), 3, 50 + i) for i in range(6)
    ]
    result = assign_teams(colours, [50.0] * 12, [(0.0, 0.0)] * 12)
    assert any("kits look alike" in w for w in result.warnings)


def test_missing_colours_stay_unknown() -> None:
    result = assign_teams([None, None], [None, None], [(0.0, 0.0), (0.0, 0.0)])
    assert result.sides == ["unknown", "unknown"]
