# ByteTrack, vendored from supervision 0.26.1 (supervision/tracker/byte_tracker/:
# core.py, single_object_track.py, kalman_filter.py, matching.py, utils.py),
# condensed into one module and typed for this worker (C09, Q-044). Changes:
# no Detections class (boxes and scores come in as arrays, and update() returns
# which detection each output track took), one id counter instead of two (a
# track is confirmed on its first update, as upstream's default of
# minimum_consecutive_frames=1), the IoU helper inlined, and the Kalman gain
# from a plain 4 x 4 solve instead of a Cholesky factor (same result, faster). The algorithm and
# its thresholds are otherwise unchanged.
#
# MIT License
#
# Copyright (c) 2022 Roboflow
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
"""ByteTrack multi-object tracker (MIT, from Roboflow supervision)."""

from __future__ import annotations

from enum import Enum

import numpy as np
import numpy.typing as npt
from scipy.optimize import linear_sum_assignment

Arr = npt.NDArray[np.float64]


def box_iou_batch(a: Arr, b: Arr) -> Arr:
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    tl = np.maximum(a[:, None, :2], b[None, :, :2])
    br = np.minimum(a[:, None, 2:], b[None, :, 2:])
    inter = np.prod(np.clip(br - tl, 0, None), axis=2)
    union = area_a[:, None] + area_b[None, :] - inter
    out: Arr = np.where(union > 0, inter / np.maximum(union, 1e-12), 0.0)
    return out


class KalmanFilter:
    """Constant-velocity Kalman filter over (x, y, aspect, height) and velocities."""

    def __init__(self) -> None:
        ndim, dt = 4, 1.0
        self._motion_mat = np.eye(2 * ndim, 2 * ndim)
        for i in range(ndim):
            self._motion_mat[i, ndim + i] = dt
        self._update_mat = np.eye(ndim, 2 * ndim)
        self._std_weight_position = 1.0 / 20
        self._std_weight_velocity = 1.0 / 160

    def initiate(self, measurement: Arr) -> tuple[Arr, Arr]:
        mean = np.r_[measurement, np.zeros_like(measurement)]
        h = measurement[3]
        std = [
            2 * self._std_weight_position * h,
            2 * self._std_weight_position * h,
            1e-2,
            2 * self._std_weight_position * h,
            10 * self._std_weight_velocity * h,
            10 * self._std_weight_velocity * h,
            1e-5,
            10 * self._std_weight_velocity * h,
        ]
        return mean, np.diag(np.square(std))

    def multi_predict(self, mean: Arr, covariance: Arr) -> tuple[Arr, Arr]:
        h = mean[:, 3]
        std_pos = [
            self._std_weight_position * h,
            self._std_weight_position * h,
            1e-2 * np.ones_like(h),
            self._std_weight_position * h,
        ]
        std_vel = [
            self._std_weight_velocity * h,
            self._std_weight_velocity * h,
            1e-5 * np.ones_like(h),
            self._std_weight_velocity * h,
        ]
        sqr = np.square(np.r_[std_pos, std_vel]).T
        motion_cov = np.asarray([np.diag(sqr[i]) for i in range(len(mean))])
        mean = np.dot(mean, self._motion_mat.T)
        left = np.dot(self._motion_mat, covariance).transpose((1, 0, 2))
        covariance = np.dot(left, self._motion_mat.T) + motion_cov
        return mean, covariance

    def project(self, mean: Arr, covariance: Arr) -> tuple[Arr, Arr]:
        h = mean[3]
        std = [self._std_weight_position * h, self._std_weight_position * h, 1e-1]
        std.append(self._std_weight_position * h)
        innovation_cov = np.diag(np.square(std))
        # The update matrix selects the first four state entries.
        return mean[:4].copy(), covariance[:4, :4] + innovation_cov

    def update(self, mean: Arr, covariance: Arr, measurement: Arr) -> tuple[Arr, Arr]:
        projected_mean, projected_cov = self.project(mean, covariance)
        # Upstream solves with a Cholesky factor (scipy.linalg.cho_solve); a
        # plain 4 x 4 solve gives the same gain and is much faster here.
        kalman_gain: Arr = np.linalg.solve(projected_cov, covariance[:, :4].T).T
        innovation = measurement - projected_mean
        new_mean = mean + innovation @ kalman_gain.T
        new_cov = covariance - kalman_gain @ projected_cov @ kalman_gain.T
        return new_mean, new_cov


class TrackState(Enum):
    New = 0
    Tracked = 1
    Lost = 2
    Removed = 3


class STrack:
    def __init__(self, tlwh: Arr, score: float, det_index: int) -> None:
        self.state = TrackState.New
        self.is_activated = False
        self.start_frame = 0
        self.frame_id = 0
        self._tlwh = np.asarray(tlwh, dtype=np.float64)
        self.kalman_filter: KalmanFilter | None = None
        self.mean: Arr | None = None
        self.covariance: Arr | None = None
        self.score = score
        self.tracklet_len = 0
        self.track_id = -1
        self.det_index = det_index

    @staticmethod
    def multi_predict(stracks: list[STrack], shared_kalman: KalmanFilter) -> None:
        if not stracks:
            return
        means = []
        for st in stracks:
            assert st.mean is not None
            m = st.mean.copy()
            if st.state != TrackState.Tracked:
                m[7] = 0
            means.append(m)
        covs = [st.covariance for st in stracks]
        multi_mean, multi_cov = shared_kalman.multi_predict(np.asarray(means), np.asarray(covs))
        for i, st in enumerate(stracks):
            st.mean, st.covariance = multi_mean[i], multi_cov[i]

    def activate(self, kalman_filter: KalmanFilter, frame_id: int, new_id: int) -> None:
        self.kalman_filter = kalman_filter
        self.track_id = new_id
        self.mean, self.covariance = kalman_filter.initiate(self.tlwh_to_xyah(self._tlwh))
        self.tracklet_len = 0
        self.state = TrackState.Tracked
        if frame_id == 1:
            self.is_activated = True
        self.frame_id = frame_id
        self.start_frame = frame_id

    def re_activate(self, new_track: STrack, frame_id: int) -> None:
        assert self.kalman_filter and self.mean is not None and self.covariance is not None
        self.mean, self.covariance = self.kalman_filter.update(
            self.mean, self.covariance, self.tlwh_to_xyah(new_track.tlwh)
        )
        self.tracklet_len = 0
        self.state = TrackState.Tracked
        self.is_activated = True
        self.frame_id = frame_id
        self.score = new_track.score
        self.det_index = new_track.det_index

    def update(self, new_track: STrack, frame_id: int) -> None:
        assert self.kalman_filter and self.mean is not None and self.covariance is not None
        self.frame_id = frame_id
        self.tracklet_len += 1
        self.mean, self.covariance = self.kalman_filter.update(
            self.mean, self.covariance, self.tlwh_to_xyah(new_track.tlwh)
        )
        self.state = TrackState.Tracked
        self.is_activated = True
        self.score = new_track.score
        self.det_index = new_track.det_index

    @property
    def tlwh(self) -> Arr:
        if self.mean is None:
            return self._tlwh.copy()
        ret = self.mean[:4].copy()
        ret[2] *= ret[3]
        ret[:2] -= ret[2:] / 2
        return ret

    @property
    def tlbr(self) -> Arr:
        ret = self.tlwh.copy()
        ret[2:] += ret[:2]
        return ret

    @staticmethod
    def tlwh_to_xyah(tlwh: Arr) -> Arr:
        ret = np.asarray(tlwh, dtype=np.float64).copy()
        ret[:2] += ret[2:] / 2
        ret[2] /= ret[3]
        return ret

    @staticmethod
    def tlbr_to_tlwh(tlbr: Arr) -> Arr:
        ret = np.asarray(tlbr, dtype=np.float64).copy()
        ret[2:] -= ret[:2]
        return ret


def linear_assignment(
    cost_matrix: Arr, thresh: float
) -> tuple[npt.NDArray[np.int_], list[int], list[int]]:
    if cost_matrix.size == 0:
        return (
            np.empty((0, 2), dtype=int),
            list(range(cost_matrix.shape[0])),
            list(range(cost_matrix.shape[1])),
        )
    cost_matrix = cost_matrix.copy()
    cost_matrix[cost_matrix > thresh] = thresh + 1e-4
    row_ind, col_ind = linear_sum_assignment(cost_matrix)
    indices = np.column_stack((row_ind, col_ind))
    matched_cost = cost_matrix[row_ind, col_ind]
    matches = indices[matched_cost <= thresh]
    unmatched_a = sorted(set(range(cost_matrix.shape[0])) - set(matches[:, 0].tolist()))
    unmatched_b = sorted(set(range(cost_matrix.shape[1])) - set(matches[:, 1].tolist()))
    return matches, unmatched_a, unmatched_b


def iou_distance(atracks: list[STrack], btracks: list[STrack]) -> Arr:
    if not atracks or not btracks:
        return np.zeros((len(atracks), len(btracks)), dtype=np.float64)
    a = np.asarray([t.tlbr for t in atracks])
    b = np.asarray([t.tlbr for t in btracks])
    out: Arr = 1 - box_iou_batch(a, b)
    return out


def fuse_score(cost_matrix: Arr, stracks: list[STrack]) -> Arr:
    if cost_matrix.size == 0:
        return cost_matrix
    scores = np.array([s.score for s in stracks])[None, :]
    out: Arr = 1 - (1 - cost_matrix) * scores
    return out


class ByteTrack:
    """ByteTrack. `update()` takes N x 4 boxes (x0, y0, x1, y1) and N scores and
    returns (detection index, track id) for every activated track this frame."""

    def __init__(
        self,
        track_activation_threshold: float = 0.25,
        lost_track_buffer: int = 30,
        minimum_matching_threshold: float = 0.8,
        frame_rate: int = 30,
    ) -> None:
        self.track_activation_threshold = track_activation_threshold
        self.minimum_matching_threshold = minimum_matching_threshold
        self.frame_id = 0
        self.det_thresh = track_activation_threshold + 0.1
        self.max_time_lost = int(frame_rate / 30.0 * lost_track_buffer)
        self.kalman_filter = KalmanFilter()
        self.shared_kalman = KalmanFilter()
        self.tracked_tracks: list[STrack] = []
        self.lost_tracks: list[STrack] = []
        self.removed_tracks: list[STrack] = []
        self._next_id = 0

    def _new_id(self) -> int:
        self._next_id += 1
        return self._next_id - 1

    def update(self, boxes: Arr, scores: npt.NDArray[np.float64]) -> list[tuple[int, int]]:
        self.frame_id += 1
        activated: list[STrack] = []
        refind: list[STrack] = []
        lost: list[STrack] = []
        removed: list[STrack] = []

        idx = np.arange(len(scores))
        remain = scores > self.track_activation_threshold
        second = (scores > 0.1) & (scores < self.track_activation_threshold)
        detections = [
            STrack(STrack.tlbr_to_tlwh(boxes[i]), float(scores[i]), int(i)) for i in idx[remain]
        ]

        unconfirmed = [t for t in self.tracked_tracks if not t.is_activated]
        tracked = [t for t in self.tracked_tracks if t.is_activated]

        # First association, with high score detection boxes.
        pool = joint_tracks(tracked, self.lost_tracks)
        STrack.multi_predict(pool, self.shared_kalman)
        dists = fuse_score(iou_distance(pool, detections), detections)
        matches, u_track, u_detection = linear_assignment(
            dists, thresh=self.minimum_matching_threshold
        )
        for it, idet in matches:
            track, det = pool[it], detections[idet]
            if track.state == TrackState.Tracked:
                track.update(det, self.frame_id)
                activated.append(track)
            else:
                track.re_activate(det, self.frame_id)
                refind.append(track)

        # Second association, with low score detection boxes.
        detections_second = [
            STrack(STrack.tlbr_to_tlwh(boxes[i]), float(scores[i]), int(i)) for i in idx[second]
        ]
        r_tracked = [pool[i] for i in u_track if pool[i].state == TrackState.Tracked]
        dists = iou_distance(r_tracked, detections_second)
        matches, u_track, _ = linear_assignment(dists, thresh=0.5)
        for it, idet in matches:
            track, det = r_tracked[it], detections_second[idet]
            if track.state == TrackState.Tracked:
                track.update(det, self.frame_id)
                activated.append(track)
            else:
                track.re_activate(det, self.frame_id)
                refind.append(track)
        for it in u_track:
            track = r_tracked[it]
            if track.state != TrackState.Lost:
                track.state = TrackState.Lost
                lost.append(track)

        # Unconfirmed tracks, usually tracks with only one beginning frame.
        detections = [detections[i] for i in u_detection]
        dists = fuse_score(iou_distance(unconfirmed, detections), detections)
        matches, u_unconfirmed, u_detection = linear_assignment(dists, thresh=0.7)
        for it, idet in matches:
            unconfirmed[it].update(detections[idet], self.frame_id)
            activated.append(unconfirmed[it])
        for it in u_unconfirmed:
            track = unconfirmed[it]
            track.state = TrackState.Removed
            removed.append(track)

        # New tracks.
        for inew in u_detection:
            track = detections[inew]
            if track.score < self.det_thresh:
                continue
            track.activate(self.kalman_filter, self.frame_id, self._new_id())
            activated.append(track)

        for track in self.lost_tracks:
            if self.frame_id - track.frame_id > self.max_time_lost:
                track.state = TrackState.Removed
                removed.append(track)

        self.tracked_tracks = [t for t in self.tracked_tracks if t.state == TrackState.Tracked]
        self.tracked_tracks = joint_tracks(self.tracked_tracks, activated)
        self.tracked_tracks = joint_tracks(self.tracked_tracks, refind)
        self.lost_tracks = sub_tracks(self.lost_tracks, self.tracked_tracks)
        self.lost_tracks.extend(lost)
        self.lost_tracks = sub_tracks(self.lost_tracks, self.removed_tracks)
        self.removed_tracks = removed
        self.tracked_tracks, self.lost_tracks = remove_duplicate_tracks(
            self.tracked_tracks, self.lost_tracks
        )
        return [
            (t.det_index, t.track_id)
            for t in self.tracked_tracks
            if t.is_activated and t.frame_id == self.frame_id
        ]


def joint_tracks(a: list[STrack], b: list[STrack]) -> list[STrack]:
    seen: set[int] = set()
    result = []
    for track in a + b:
        if track.track_id not in seen:
            seen.add(track.track_id)
            result.append(track)
    return result


def sub_tracks(a: list[STrack], b: list[STrack]) -> list[STrack]:
    tracks = {t.track_id: t for t in a}
    for tid in {t.track_id for t in b}:
        tracks.pop(tid, None)
    return list(tracks.values())


def remove_duplicate_tracks(a: list[STrack], b: list[STrack]) -> tuple[list[STrack], list[STrack]]:
    pairwise = iou_distance(a, b)
    pa, pb = np.where(pairwise < 0.15)
    dup_a, dup_b = set(), set()
    for ia, ib in zip(pa.tolist(), pb.tolist(), strict=True):
        time_a = a[ia].frame_id - a[ia].start_frame
        time_b = b[ib].frame_id - b[ib].start_frame
        if time_a > time_b:
            dup_b.add(ib)
        else:
            dup_a.add(ia)
    return (
        [t for i, t in enumerate(a) if i not in dup_a],
        [t for i, t in enumerate(b) if i not in dup_b],
    )
