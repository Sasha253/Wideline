// Sample data for the template showcase (/dev/templates). Nothing here is tenant data.

export const SHOWCASE_BACK = { href: "/dev/templates", label: "Page templates" };

export type SquadRow = {
  id: string;
  name: string;
  position: string;
  ageGroup: string;
  matches: number;
  /** Goals per 90, or null when there is no value. */
  goalsPer90: string | null;
};

export const SQUAD: SquadRow[] = [
  {
    id: "thabo",
    name: "Thabo Nkosi",
    position: "Winger",
    ageGroup: "U17",
    matches: 14,
    goalsPer90: "0.62",
  },
  {
    id: "sipho",
    name: "Sipho Dlamini",
    position: "Centre-back",
    ageGroup: "U17",
    matches: 9,
    goalsPer90: "0.00",
  },
  {
    id: "lebo",
    name: "Lebo Mokoena",
    position: "Striker",
    ageGroup: "U15",
    matches: 2,
    goalsPer90: "0.50",
  },
  {
    id: "siyabonga",
    name: "Siyabonga Mthembu-Van der Merwe",
    position: "Midfielder",
    ageGroup: "U17",
    matches: 11,
    goalsPer90: null,
  },
];

/** Under 3 matches, a stat carries the small-sample flag (StatTile rule). */
export const SMALL_SAMPLE = 3;

export const MATCH_LOG = [
  {
    id: "m1",
    fixture: "Wideline Demo FC v Hellenic U17",
    date: "12 Oct 2026",
    minutes: 90,
    goals: 1,
  },
  {
    id: "m2",
    fixture: "Cape Town Spurs U17 v Wideline Demo FC",
    date: "5 Oct 2026",
    minutes: 74,
    goals: 0,
  },
  {
    id: "m3",
    fixture: "Wideline Demo FC v Ubuntu Cape Town U17",
    date: "28 Sep 2026",
    minutes: 90,
    goals: 2,
  },
];
