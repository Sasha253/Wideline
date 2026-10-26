import { describe, expect, it } from "vitest";
import {
  PlaylistError,
  rewriteMasterPlaylist,
  rewriteMediaPlaylist,
} from "@/server/matches/playback";

// C07 (NFR17): playlists are served by the app, with every entry pointing at a
// session-checked route, never at the bucket. An entry outside the ladder (a
// path out of the rendition, a URL, raw footage) is refused.

const MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=5605600,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1425600,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2"
480p/index.m3u8
`;

const MEDIA = `#EXTM3U\r
#EXT-X-VERSION:7\r
#EXT-X-TARGETDURATION:4\r
#EXT-X-PLAYLIST-TYPE:VOD\r
#EXT-X-MAP:URI="init.mp4"\r
#EXTINF:4.000000,\r
seg_00000.m4s\r
#EXTINF:2.000000,\r
seg_00001.m4s\r
#EXT-X-ENDLIST\r
`;

describe("rewriteMasterPlaylist", () => {
  it("points every variant at the rendition route and keeps tags byte for byte", () => {
    const out = rewriteMasterPlaylist(MASTER, "m1");
    expect(out).toBe(
      MASTER.replace("1080p/index.m3u8", "/api/matches/m1/hls/1080p/index.m3u8").replace(
        "480p/index.m3u8",
        "/api/matches/m1/hls/480p/index.m3u8",
      ),
    );
  });

  it.each([
    "../raw/x.mp4",
    "2160p/index.m3u8",
    "720p/seg_00000.m4s",
    "https://s3.example/wideline/orgs/o/matches/m/raw/v.mp4",
    "/etc/passwd",
  ])("refuses %s", (entry) => {
    expect(() =>
      rewriteMasterPlaylist(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n${entry}\n`, "m1"),
    ).toThrow(PlaylistError);
  });

  it("rewrites and checks URI attributes of media tags", () => {
    const out = rewriteMasterPlaylist(
      '#EXTM3U\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="720p/index.m3u8"\n',
      "m1",
    );
    expect(out).toContain('URI="/api/matches/m1/hls/720p/index.m3u8"');
    expect(() =>
      rewriteMasterPlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="../raw/v.mp4"\n', "m1"),
    ).toThrow(PlaylistError);
  });
});

describe("rewriteMediaPlaylist", () => {
  it("rewrites the init segment and media segments, keeping CRLF and tags", () => {
    const out = rewriteMediaPlaylist(MEDIA, "m1", "720p");
    expect(out).toBe(
      MEDIA.replace('URI="init.mp4"', 'URI="/api/matches/m1/hls/720p/init.mp4"')
        .replace("seg_00000.m4s", "/api/matches/m1/hls/720p/seg_00000.m4s")
        .replace("seg_00001.m4s", "/api/matches/m1/hls/720p/seg_00001.m4s"),
    );
  });

  it.each([
    "../raw/x.mp4",
    "../../raw/v.mp4",
    "https://evil.example/seg.m4s",
    "index.m3u8",
    "seg_1.m4s",
  ])("refuses the entry %s", (entry) => {
    expect(() => rewriteMediaPlaylist(`#EXTM3U\n#EXTINF:4,\n${entry}\n`, "m1", "720p")).toThrow(
      PlaylistError,
    );
  });

  it("refuses another init segment and an unknown rendition", () => {
    expect(() =>
      rewriteMediaPlaylist('#EXTM3U\n#EXT-X-MAP:URI="../raw/v.mp4"\n', "m1", "720p"),
    ).toThrow(PlaylistError);
    expect(() => rewriteMediaPlaylist(MEDIA, "m1", "../raw" as unknown as "720p")).toThrow(
      PlaylistError,
    );
  });

  it("encodes the match id into the route", () => {
    expect(rewriteMediaPlaylist("seg_00000.m4s", "a/b", "480p")).toBe(
      "/api/matches/a%2Fb/hls/480p/seg_00000.m4s",
    );
  });
});
