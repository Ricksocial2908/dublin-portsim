/* Dublin Port layout, official depths, and tidal levels.
   Sources are listed in /notes.md and the README. */
export const TIDE = {
  hat: 4.50, mhws: 4.10, mhwn: 3.40, msl: 2.41, mlwn: 1.50, mlws: 0.70, lat: -0.10,
  periodH: 12.42, springNeapDays: 14.77,
  // Assumed phases so a high water falls near 04:00 on Monday of a spring week.
  m2Phase: 0,
  snPhase: 0,
};

export const UKC = { manoeuvre: 1.0, alongside: 0.5 };
export const CHANNEL = { vtsToOb1: 9.0, outerFairway: 9.2, westOfOb1: 7.6, eastLinkApproach: 6.4, westOfBridge: 3.1 };
export const MOVE_PENALTY = 5;
export const SECTION_M = 40;
export const CRANE_RATE = 25; // assumed DFT moves per crane-hour
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Schematic local metres: x east from the Tom Clarke Bridge, y north from mid-channel.
export const BERTHS = [
  { id: "b18", name: "Berth 18", area: "North Wall Extension", side: "north", kind: ["small", "cruise"],
    length: 200, design: 6.5, survey: 6.5, approach: 6.4, channel: 6.4,
    x: 280, y: 220, w: 200, h: 22, labelSide: "n" },
  { id: "b21", name: "Berths 21/22", area: "Alexandra Quay West", side: "north", kind: ["roro"],
    length: 200, design: 6.5, survey: 6.6, approach: 6.6, channel: 7.6,
    x: 620, y: 260, w: 200, h: 22, labelSide: "n" },
  { id: "b26", name: "Berth 26", area: "Alexandra Basin RoRo jetty", side: "north", kind: ["roro"],
    length: 220, design: 6.9, survey: 6.9, approach: 6.7, channel: 7.5,
    x: 900, y: 430, w: 220, h: 20, labelSide: "n", note: "Dublin–Liverpool RoRo" },
  { id: "b27", name: "Berth 27", area: "Alexandra Basin RoRo jetty", side: "north", kind: ["roro"],
    length: 220, design: 6.9, survey: 6.9, approach: 6.9, channel: 7.5,
    x: 900, y: 500, w: 220, h: 20, labelSide: "s", note: "Dublin–Liverpool RoRo" },
  { id: "b32", name: "Berth 32", area: "Ocean Pier", side: "north", kind: ["bulk", "cruise", "general"],
    length: 370, design: 9.5, survey: 9.2, approach: 7.5, channel: 7.6, sectional: true,
    x: 1480, y: 200, w: 370, h: 26, labelSide: "n" },
  { id: "b36", name: "Berth 36", area: "Ocean Pier", side: "north", kind: ["bulk", "cruise", "general"],
    length: 200, design: 10.3, survey: 10.2, approach: 7.7, channel: 7.6, sectional: true,
    x: 1480, y: 40, w: 26, h: 200, vertical: true, labelSide: "w" },
  { id: "b38", name: "Berth 38", area: "Ocean Pier East", side: "north", kind: ["bulk", "cruise", "general"],
    length: 300, design: 10.3, survey: 10.1, approach: 7.7, channel: 7.6, sectional: true,
    x: 1880, y: 200, w: 300, h: 26, labelSide: "n" },
  { id: "ob1", name: "OB1", area: "Western Oil Jetty", side: "north", kind: ["tanker"],
    length: 185, design: 10.4, survey: 10.3, approach: 7.7, channel: 9.0,
    x: 2280, y: 80, w: 18, h: 185, vertical: true, labelSide: "w" },
  { id: "ob2", name: "OB2", area: "Western Oil Jetty", side: "north", kind: ["tanker"],
    length: 185, design: 10.7, survey: 10.4, approach: 7.8, channel: 9.0,
    x: 2340, y: 80, w: 18, h: 185, vertical: true, labelSide: "e" },
  { id: "ob3", name: "OB3", area: "Eastern Oil Jetty", side: "north", kind: ["tanker"],
    length: 185, design: 10.1, survey: 9.8, approach: 7.8, channel: 9.0,
    x: 2480, y: 80, w: 18, h: 185, vertical: true, labelSide: "w" },
  { id: "ob4", name: "OB4", area: "Eastern Oil Jetty", side: "north", kind: ["tanker"],
    length: 160, design: 6.5, survey: 6.2, approach: 6.2, channel: 9.0,
    x: 2540, y: 80, w: 18, h: 160, vertical: true, labelSide: "e" },
  { id: "b50a", name: "Berth 50A", area: "DFT", side: "north", kind: ["container"],
    length: 170, design: 11.0, survey: 10.6, approach: 7.7, channel: 9.0, sectional: true, cranes: 3,
    x: 2700, y: 200, w: 170, h: 26, labelSide: "n" },
  { id: "b50n", name: "Berth 50N", area: "DFT", side: "north", kind: ["container"],
    length: 370, design: 9.5, survey: 9.2, approach: 7.6, channel: 9.0, sectional: true, cranes: 3,
    x: 2700, y: 420, w: 370, h: 26, labelSide: "n" },
  { id: "b50s", name: "Berth 50S", area: "DFT", side: "north", kind: ["container"],
    length: 370, design: 9.5, survey: 9.1, approach: 7.6, channel: 9.0, sectional: true, cranes: 3,
    x: 2700, y: 300, w: 370, h: 26, labelSide: "s" },
  { id: "b49", name: "Berth 49", area: "Irish Ferries Terminal 1", side: "north", kind: ["roro", "ferry"],
    length: 210, design: 11.0, survey: 9.8, approach: 9.0, channel: 9.0,
    x: 3180, y: 200, w: 210, h: 24, labelSide: "n", operator: "Irish Ferries" },
  { id: "b51", name: "Berth 51", area: "Stena Line Terminal 2", side: "north", kind: ["roro", "ferry"],
    length: 200, design: 8.0, survey: 7.8, approach: 7.8, channel: 9.0,
    x: 3420, y: 200, w: 200, h: 24, labelSide: "n", operator: "Stena Line" },
  { id: "b51a", name: "Berth 51A", area: "Irish Ferries Terminal 1", side: "north", kind: ["roro", "ferry"],
    length: 180, design: 8.0, survey: 7.8, approach: 7.8, channel: 9.0,
    x: 3180, y: 420, w: 180, h: 24, labelSide: "n", operator: "Irish Ferries" },
  { id: "b52", name: "Berth 52", area: "Eastern RoRo (MP2 works)", side: "north", kind: ["roro"],
    length: 200, design: 8.0, survey: 7.5, approach: 7.3, channel: 9.0,
    x: 3420, y: 420, w: 200, h: 24, labelSide: "n" },
  { id: "b41", name: "Berth 41", area: "MTL Poolbeg", side: "south", kind: ["container"],
    length: 150, design: 7.4, survey: 7.2, approach: 7.2, channel: 9.0, sectional: true,
    x: 2000, y: -260, w: 150, h: 24, labelSide: "s" },
  { id: "b42", name: "Berth 42", area: "MTL Poolbeg", side: "south", kind: ["container"],
    length: 110, design: 11.0, survey: 10.8, approach: 7.8, channel: 9.0, sectional: true,
    x: 2160, y: -260, w: 110, h: 24, labelSide: "s" },
  { id: "b43", name: "Berth 43", area: "MTL Poolbeg", side: "south", kind: ["container"],
    length: 130, design: 11.0, survey: 10.8, approach: 7.8, channel: 9.0, sectional: true,
    x: 2280, y: -260, w: 130, h: 24, labelSide: "s" },
  { id: "b44", name: "Berth 44", area: "MTL Poolbeg", side: "south", kind: ["container"],
    length: 80, design: 11.0, survey: 10.8, approach: 7.8, channel: 9.0, sectional: true,
    x: 2420, y: -260, w: 80, h: 24, labelSide: "s" },
  { id: "b45", name: "Berth 45", area: "MTL Poolbeg", side: "south", kind: ["container"],
    length: 160, design: 8.7, survey: 8.5, approach: 8.5, channel: 9.0, sectional: true,
    x: 2510, y: -260, w: 160, h: 24, labelSide: "s" },
  { id: "mtl", name: "MTL 41–45", area: "MTL Poolbeg", side: "south", kind: ["container"],
    length: 630, design: 11.0, survey: 8.5, approach: 7.8, channel: 9.0, sectional: true,
    x: 2000, y: -260, w: 630, h: 24, labelSide: "s",
    note: "Official berths 41–45 treated as one continuous LoLo face for planning (assumption). Approach 7.8 m is the official figure for berths 42–44; berth 41 is shallower (7.2 m)." },
];

export const BERTH_BY_ID = Object.fromEntries(BERTHS.map((b) => [b.id, b]));

export function assignSections() {
  let n = 1;
  for (const b of BERTHS) {
    if (b.sectional) {
      const count = Math.max(1, Math.floor(b.length / SECTION_M));
      b.first_section = n;
      b.last_section = n + count - 1;
      b.n_sections = count;
      n += count;
    } else {
      b.first_section = n;
      b.last_section = n;
      b.n_sections = 1;
      n += 1;
    }
  }
  return n - 1;
}
assignSections();

export function berthForSection(section) {
  return BERTHS.find((b) => section >= b.first_section && section <= b.last_section) || null;
}

export function sectionsNeeded(length, berth) {
  if (!berth.sectional) return 1;
  return Math.max(1, Math.ceil(length / SECTION_M));
}
