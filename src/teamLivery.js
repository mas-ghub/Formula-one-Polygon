/* ============ Team livery accent colors ============
   OpenF1's `team_colour` gives one brand hex per team — great for timing
   towers, but it means every car came out a single flat color (colA===colB)
   instead of a two-tone livery. This maps each 2026 team name to a second
   accent color so car bodies actually show two colors, the way the real
   liveries do. The OpenF1-sourced primary hue is left untouched; only the
   accent is added. */
export const TEAM_LIVERY_ACCENT = {
  'McLaren': '#47C7FC',
  'Red Bull Racing': '#FFC800',
  'Red Bull': '#FFC800',
  'Ferrari': '#FFE600',
  'Mercedes': '#0A0E12',
  'Aston Martin': '#CEDC00',
  'Alpine': '#FF87BC',
  'Williams': '#E8EEF5',
  'Audi': '#101418',
  'Sauber': '#101418',
  'Cadillac': '#101418',
  'Haas F1 Team': '#E10600',
  'Haas': '#E10600',
  'Racing Bulls': '#F2F2F2',
  'RB': '#F2F2F2',
};

export function accentFor(team, primary) {
  return TEAM_LIVERY_ACCENT[team] || primary;
}
