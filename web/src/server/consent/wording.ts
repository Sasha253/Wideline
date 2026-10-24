// The consent wording (CONS04, NFR09, NFR12; docs/build/design/C05.md,
// "Wording"). Every surface that shows it (the guardian screens, the club
// form, the paper form, the player page and the history) renders it through
// ConsentWording (src/components/consent/ConsentWording.tsx), so the text
// lives here only. Pure data, safe in any component.
//
// Draft copy: legal review (Q-004 pattern)
// Draft for legal review. The text has no placeholders, so a stored
// wordingVersion always means the same words. Never edit a published version:
// add a new one and point CONSENT_WORDING_VERSION at it. Old rows keep their
// version, and the history shows the exact text they were shown.

export const CONSENT_WORDING_VERSION = "2026-10-draft-1";

export type ConsentWordingPart =
  "clubStats" | "scoutVisibility" | "independentReview" | "offshore" | "withdrawal";

export type ConsentWordingParts = Record<ConsentWordingPart, { heading: string; body: string }>;

/** Who the text speaks to: a parent or guardian ("your child"), or a player of 18 or over ("you"). */
export type ConsentAudience = "guardian" | "player";

/** Display order of the parts. */
export const CONSENT_WORDING_ORDER: readonly ConsentWordingPart[] = [
  "clubStats",
  "scoutVisibility",
  "independentReview",
  "offshore",
  "withdrawal",
];

export const CONSENT_WORDINGS: Record<string, Record<ConsentAudience, ConsentWordingParts>> = {
  "2026-10-draft-1": {
    guardian: {
      clubStats: {
        heading: "What we record",
        body: "Your child's club films its matches. Wideline uses the video to record goals, shots and where your child ran in each match. We only keep these stats if you say yes. If you say no, we keep no stats about your child, but they may still be seen in the match video. Match video is deleted after 7 days, and short clips after 14 days unless someone saves them.",
      },
      scoutVisibility: {
        heading: "Who can see the stats",
        body: "Your child's coaches and club staff can see the stats. Scouts are people who look for players for other clubs and academies. Scouts can only see your child's stats if you say yes.",
      },
      independentReview: {
        heading: "Scouts check the video",
        body: "To make sure the stats are right, independent scouts who are registered with Wideline watch the match video and check what happened. This happens even if you say no to scouts. These scouts have signed an agreement to keep what they see private. They cannot download the video, and they may not contact you, your child or the club about what they saw.",
      },
      offshore: {
        heading: "Where the data is kept",
        body: "Wideline keeps your child's data on computers in the European Union. Some of the video work may happen in other countries. This means your child's data is stored and used outside South Africa. Every company that helps us must protect it under a written agreement.",
      },
      withdrawal: {
        heading: "You can change your mind",
        body: "You can change your answer at any time, and it costs nothing. Use the link the club sent you, or tell the club. When you say stop, the club and scouts stop seeing your child's stats straight away. We remove them from clips, searches and saved lists within 24 hours. To delete all of your child's data, ask the club.",
      },
    },
    player: {
      clubStats: {
        heading: "What we record",
        body: "Your club films its matches. Wideline uses the video to record goals, shots and where you ran in each match. We only keep these stats if you say yes. If you say no, we keep no stats about you, but you may still be seen in the match video. Match video is deleted after 7 days, and short clips after 14 days unless someone saves them.",
      },
      scoutVisibility: {
        heading: "Who can see the stats",
        body: "Your coaches and club staff can see the stats. Scouts are people who look for players for other clubs and academies. Scouts can only see your stats if you say yes.",
      },
      independentReview: {
        heading: "Scouts check the video",
        body: "To make sure the stats are right, independent scouts who are registered with Wideline watch the match video and check what happened. This happens even if you say no to scouts. These scouts have signed an agreement to keep what they see private. They cannot download the video, and they may not contact you or the club about what they saw.",
      },
      offshore: {
        heading: "Where the data is kept",
        body: "Wideline keeps your data on computers in the European Union. Some of the video work may happen in other countries. This means your data is stored and used outside South Africa. Every company that helps us must protect it under a written agreement.",
      },
      withdrawal: {
        heading: "You can change your mind",
        body: "You can change your answer at any time, and it costs nothing. Tell the club. When you say stop, the club and scouts stop seeing your stats straight away. We remove them from clips, searches and saved lists within 24 hours. To delete all of your data, ask the club.",
      },
    },
  },
};

/** The parts of a version for one audience, in display order, or null for an unknown version. */
export function consentWording(
  version: string,
  audience: ConsentAudience,
): { part: ConsentWordingPart; heading: string; body: string }[] | null {
  const parts = CONSENT_WORDINGS[version]?.[audience];
  if (!parts) return null;
  return CONSENT_WORDING_ORDER.map((part) => ({ part, ...parts[part] }));
}
