/* ============ Authentic World-Class F1 Circuit Layouts & Official Benchmarks ============ */

// Generic placeholder loop used only if OpenF1 has no usable lap telemetry for
// a circuit (see src/circuitData.js) — every track below is really rendered
// from the real racing line fetched live from OpenF1's `location` endpoint.
function ovalPts(rx, rz, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.round(Math.cos(a) * rx), Math.round(Math.sin(a) * rz + Math.sin(a * 2) * rz * 0.18)]);
  }
  return pts;
}

export const TRACKS = [
  {
    name: 'Monza',
    loc: 'Autodromo Nazionale Monza · Italy',
    theme: 'park',
    grass: 0x477d3b,
    runoff: 7.0,
    width: 12.0,
    bank: 4.5,
    openf1CircuitKey: 39,
    meetingName: 'Italian Grand Prix',
    lapRecord: '1:21.046',
    lapRecordSec: 81.046,
    recordHolder: 'Rubens Barrichello (Ferrari)',
    fastest2024: '1:21.432',
    fastest2024Holder: 'Lando Norris (McLaren)',
    desc: 'Temple of Speed — Rettifilo Chicane, Curva Grande, Lesmo, Ascari & Parabolica',
    pts: [
      [-160, -320], // Main Straight (Start/Finish)
      [40, -320],   // High-speed approach to Rettifilo
      [75, -310],   // Prima Variante Turn 1 (tight right chicane entry)
      [68, -280],   // Prima Variante Turn 2 (left exit)
      [125, -205],  // Curva Grande (Curva Biassono) fast right sweep
      [195, -95],
      [225, 30],
      [238, 125],   // Variante della Roggia approach
      [228, 155],   // Roggia chicane (Turn 4 left)
      [242, 178],   // Roggia chicane (Turn 5 right exit)
      [248, 235],   // Curva di Lesmo 1 (Turn 6 right)
      [222, 285],
      [165, 315],   // Curva di Lesmo 2 (Turn 7 right onto Serraglio)
      [95, 305],
      [5, 265],     // Curva del Serraglio downhill straight
      [-90, 200],
      [-155, 140],  // Variante Ascari braking zone
      [-190, 118],  // Ascari Turn 8 (left entry)
      [-200, 80],   // Ascari Turn 9 (right flick)
      [-170, 50],   // Ascari Turn 10 (fast left exit)
      [-190, -55],  // Rettifilo del Serraglio back straight
      [-215, -165],
      [-228, -240], // Curva Parabolica (Curva Alboreto) entry
      [-210, -300], // Parabolica long sweeping 180° apex
      [-175, -320]  // Full throttle accelerating onto Main Straight
    ]
  },
  {
    name: 'Silverstone',
    loc: 'Silverstone Circuit · Great Britain',
    theme: 'park',
    grass: 0x4f883e,
    runoff: 7.5,
    width: 15.0, // huge, airfield-wide tarmac
    bank: 5.0,
    openf1CircuitKey: 2,
    meetingName: 'British Grand Prix',
    lapRecord: '1:27.097',
    lapRecordSec: 87.097,
    recordHolder: 'Max Verstappen (Red Bull)',
    fastest2024: '1:28.293',
    fastest2024Holder: 'Carlos Sainz (Ferrari)',
    desc: 'Home of British Motorsport — Copse, Maggotts-Becketts-Chapel, Stowe & Club',
    pts: [
      [-220, -150], // Hamilton Straight (Start/Finish)
      [-135, -220], // Abbey (Turn 1 ultra-fast right)
      [-55, -250],  // Farm Curve (Turn 2 left)
      [15, -240],   // Village (Turn 3 tight right hairpin)
      [42, -195],   // The Loop (Turn 4 slow left hairpin)
      [10, -155],   // Aintree (Turn 5 left)
      [-45, -85],   // Wellington Straight
      [-105, -10],  // Brooklands (Turn 6 long left)
      [-140, 55],   // Luffield (Turn 7 sweeping right)
      [-110, 115],  // Woodcote (Turn 8 right exit)
      [-25, 175],   // National Pits Straight
      [75, 240],    // Copse Corner (Turn 9 high-speed right)
      [160, 270],   // Maggotts (Turn 10 ultra-fast left)
      [225, 248],   // Becketts (Turn 11-12 iconic S-curves)
      [270, 195],   // Chapel (Turn 13 right onto Hangar Straight)
      [280, 80],    // Hangar Straight
      [255, -45],   // Stowe Corner (Turn 15 4th-gear right)
      [205, -135],  // Vale (Turn 16 downhill chicane)
      [135, -160],  // Club (Turn 17-18 double apex right)
      [40, -140],
      [-70, -125],
      [-165, -130]  // Leading back to Hamilton Straight
    ]
  },
  {
    name: 'Spa-Francorchamps',
    loc: 'Circuit de Spa-Francorchamps · Belgium',
    theme: 'forest',
    grass: 0x3b7032,
    runoff: 7.0,
    width: 13.5,
    bank: 6.5,
    openf1CircuitKey: 7,
    meetingName: 'Belgian Grand Prix',
    lapRecord: '1:41.252',
    lapRecordSec: 101.252,
    recordHolder: 'Lewis Hamilton (Mercedes)',
    fastest2024: '1:44.701',
    fastest2024Holder: 'Sergio Pérez (Red Bull)',
    desc: 'Ardennes Legend — La Source, Eau Rouge & Raidillon, Pouhon & Blanchimont',
    pts: [
      [-240, -130], // Start/Finish Straight
      [-275, -85],  // La Source (Turn 1 tight 1st-gear hairpin)
      [-245, -25],  // Downhill plunge towards Eau Rouge
      [-195, 45],   // Eau Rouge (Turn 2 compression left)
      [-165, 105],  // Raidillon (Turn 3-4 uphill right-left crest)
      [-105, 195],  // Kemmel Straight (massive uphill drag)
      [-20, 275],
      [65, 320],    // Les Combes (Turn 5-6 chicane right-left)
      [125, 305],   // Malmedy (Turn 7 right)
      [190, 260],   // Rivage (Turn 8 downhill hairpin right)
      [225, 195],   // Bruxelles / Speakers Corner (Turn 9 left)
      [230, 120],
      [265, 40],    // Double Gauche / Pouhon (Turn 10-11 high-G double-apex left)
      [250, -50],
      [195, -120],  // Fagnes (Turn 12-13 right-left chicane)
      [135, -175],  // Campus / Stavelot (Turn 14-15 right sweepers)
      [65, -225],   // Paul Frère (Turn 16)
      [-20, -250],  // Blanchimont (Turn 17-18 flat-out left sweepers)
      [-110, -260],
      [-185, -230], // Bus Stop Chicane (Turn 19-20 tight right-left)
      [-215, -195],
      [-230, -165]  // Burst onto Main Straight
    ]
  },
  {
    name: 'Monaco',
    loc: 'Circuit de Monaco · Monte Carlo',
    theme: 'street',
    grass: 0x3d6632,
    runoff: 3.2,
    width: 9.5, // barely two cars wide — the tightest road of the season
    bank: 1.8, // city streets are nearly flat
    water: [{ from: 0.63, to: 0.84, w: 30, side: 'in', boats: true }], // Port Hercule — the harbour sits INSIDE the lap between the chicane and La Rascasse
    openf1CircuitKey: 22,
    tunnel: { from: 0.505, to: 0.615 }, // the iconic Portier → Tunnel → Nouvelle Chicane covered section
    meetingName: 'Monaco Grand Prix',
    lapRecord: '1:12.909',
    lapRecordSec: 72.909,
    recordHolder: 'Lewis Hamilton (Mercedes)',
    fastest2024: '1:14.165',
    fastest2024Holder: 'Lewis Hamilton (Mercedes)',
    desc: 'Crown Jewel — Sainte-Dévote, Casino Square, Fairmont Hairpin & Piscine',
    pts: [
      [-170, -190], // Boulevard Albert 1er (Start Straight)
      [-105, -230], // Sainte-Dévote (Turn 1 90-degree right)
      [-25, -220],  // Beau Rivage uphill climb
      [48, -180],   // Massenet (Turn 2 long left around gardens)
      [110, -125],  // Casino Square (Turn 3 right past Hotel de Paris)
      [150, -60],   // Mirabeau Haute (Turn 4 downhill right)
      [178, 0],     // Grand Hotel Fairmont Hairpin (Turn 5 tightest corner in F1)
      [152, 55],    // Mirabeau Bas (Turn 6 right)
      [168, 105],   // Portier (Turn 7 right towards sea)
      [130, 175],   // The Tunnel (high-speed blind curved straight)
      [70, 235],
      [10, 255],    // Nouvelle Chicane (Turn 10-11 heavy braking left-right)
      [-65, 230],   // Tabac (Turn 12 fast 4th-gear left by harbor yachts)
      [-125, 180],  // Louis Chiron & Piscine Chicane (Turn 13-14)
      [-180, 115],  // Swimming Pool Exit (Turn 15-16 tight chicane)
      [-218, 35],   // La Rascasse (Turn 17 tight right hairpin)
      [-210, -55],  // Anthony Noghès (Turn 18-19 final corner)
      [-185, -125]  // Accelerating to Start/Finish Straight
    ]
  },
  {
    name: 'Red Bull Ring',
    loc: 'Spielberg · Austria',
    theme: 'park',
    grass: 0x428238,
    runoff: 7.2,
    width: 13.0,
    bank: 5.0,
    openf1CircuitKey: 19,
    meetingName: 'Austrian Grand Prix',
    lapRecord: '1:05.619',
    lapRecordSec: 65.619,
    recordHolder: 'Carlos Sainz (McLaren)',
    fastest2024: '1:07.694',
    fastest2024Holder: 'Fernando Alonso (Aston Martin)',
    desc: 'Alpine Drama — Niki Lauda Turn 1, Remus Hairpin & Jochen Rindt Sweeper',
    pts: [
      [-150, -170], // Start/Finish Straight
      [-50, -220],  // Niki Lauda (Turn 1 90-degree uphill right)
      [40, -210],   // Steep uphill straightaway towards Turn 3
      [140, -160],
      [225, -90],   // Remus Hairpin (Turn 3 tight uphill right)
      [240, -30],   // Downhill straight towards Turn 4
      [180, 50],    // Rauch (Turn 4 downhill right-hander)
      [110, 120],   // Turn 5-6 fast sweeping left
      [40, 180],    // Gerhard Berger Kurve (Turn 6 long left)
      [-30, 210],   // Turn 7 (left)
      [-100, 185],  // Turn 8 (fast right)
      [-160, 120],  // Jochen Rindt (Turn 9 fast downhill right)
      [-195, 30],   // Red Bull Mobile (Turn 10 final right onto straight)
      [-185, -75]   // Pit Straight approach
    ]
  },
  {
    name: 'Suzuka',
    loc: 'Suzuka International Racing Course · Japan',
    theme: 'park',
    grass: 0x448236,
    runoff: 6.2,
    width: 13.0,
    bank: 6.0,
    openf1CircuitKey: 46,
    lake: { frac: 0.9 }, // parkland infield water
    meetingName: 'Japanese Grand Prix',
    lapRecord: '1:30.983',
    lapRecordSec: 90.983,
    recordHolder: 'Lewis Hamilton (Mercedes)',
    fastest2024: '1:33.706',
    fastest2024Holder: 'Max Verstappen (Red Bull)',
    desc: 'Figure-8 Masterpiece — First Corner, S-Curves, Degner, Spoon & 130R',
    pts: [
      [-150, -220], // Main Pit Straight
      [-45, -260],  // Turn 1 & 2 (double-apex high-speed right)
      [25, -240],   // S-Curves Turn 3 (left)
      [70, -190],   // S-Curves Turn 4 (right)
      [45, -130],   // S-Curves Turn 5 (left)
      [80, -70],    // Dunlop Curve (Turn 7 long uphill sweeping left)
      [140, -20],   // Degner 1 & 2 (Turn 8-9 fast rights)
      [185, 45],
      [150, 110],   // Hairpin (Turn 11 slow 1st-gear left)
      [85, 140],    // 200R (Turn 12 fast right)
      [30, 195],    // Spoon Curve (Turn 13 entry left)
      [-40, 240],   // Spoon Curve (Turn 14 apex left)
      [-110, 215],  // West Straight (high speed under/over crossover)
      [-190, 135],  // 130R (Turn 15 iconic flat-out left corner)
      [-230, 35],   // Casio Triangle Chicane (Turn 16-17 tight right-left)
      [-205, -55],  // Final Corner (Turn 18 right)
      [-175, -145]  // Returning to Main Straight
    ]
  },
  {
    name: 'Albert Park',
    loc: 'Albert Park Circuit · Melbourne, Australia',
    theme: 'park',
    grass: 0x4a8a3f,
    runoff: 6.5,
    width: 13.0,
    bank: 4.0,
    openf1CircuitKey: 10,
    lake: { frac: 0.9 }, // the circuit encircles Albert Park Lake — a water disc in the infield
    meetingName: 'Australian Grand Prix',
    desc: 'Lakeside park circuit — fast, flowing corners around Albert Park Lake',
    pts: ovalPts(230, 190, 20)
  },
  {
    name: 'Shanghai',
    loc: 'Shanghai International Circuit · China',
    theme: 'park',
    grass: 0x3f7d3a,
    runoff: 7.0,
    width: 14.5,
    bank: 5.0,
    openf1CircuitKey: 49,
    meetingName: 'Chinese Grand Prix',
    desc: 'Sweeping "shang" (上) shaped circuit with a long back straight',
    pts: ovalPts(220, 210, 22)
  },
  {
    name: 'Bahrain International Circuit',
    loc: 'Sakhir · Bahrain',
    theme: 'park',
    grass: 0x4d7a3e,
    runoff: 7.0,
    width: 15.0,
    bank: 4.5,
    openf1CircuitKey: 63,
    meetingName: 'Bahrain Grand Prix',
    desc: 'Desert floodlit circuit — heavy braking zones under the lights',
    pts: ovalPts(225, 175, 18)
  },
  {
    name: 'Jeddah Corniche',
    loc: 'Jeddah Corniche Circuit · Saudi Arabia',
    theme: 'street',
    grass: 0x3f7a44,
    runoff: 4.0,
    width: 12.0,
    bank: 7.0, // T13 carries real 12% banking
    water: [{ from: 0.3, to: 0.55, w: 26 }], // the Corniche lagoon along the Red Sea shoreline
    openf1CircuitKey: 149,
    meetingName: 'Saudi Arabian Grand Prix',
    desc: 'The fastest street circuit on the calendar — walls, no room for error',
    pts: ovalPts(260, 150, 22)
  },
  {
    name: 'Miami International Autodrome',
    loc: 'Hard Rock Stadium · Miami, USA',
    theme: 'street',
    grass: 0x3f8241,
    runoff: 5.0,
    width: 12.5,
    bank: 5.0,
    water: [{ from: 0.25, to: 0.38, w: 20, boats: true }], // the famous fake marina — boats and all
    openf1CircuitKey: 151,
    meetingName: 'Miami Grand Prix',
    desc: 'Stadium-circling street track around Hard Rock Stadium',
    pts: ovalPts(230, 180, 20)
  },
  {
    name: 'Circuit Gilles Villeneuve',
    loc: "Île Notre-Dame · Montreal, Canada",
    theme: 'street',
    grass: 0x3f7d46,
    runoff: 5.5,
    width: 11.5,
    bank: 3.5,
    water: [{ from: 0.15, to: 0.35, w: 24 }], // the Olympic rowing basin beside Île Notre-Dame
    openf1CircuitKey: 23,
    meetingName: 'Canadian Grand Prix',
    desc: 'Island circuit — long straights into the Wall of Champions',
    pts: ovalPts(215, 195, 18)
  },
  {
    name: 'Circuit de Barcelona-Catalunya',
    loc: 'Catalunya · Spain',
    theme: 'park',
    grass: 0x4a8340,
    runoff: 7.0,
    width: 14.0,
    bank: 5.0,
    openf1CircuitKey: 15,
    meetingName: 'Spanish Grand Prix',
    desc: 'Technical benchmark circuit with fast, high-grip corners',
    pts: ovalPts(220, 200, 20)
  },
  {
    name: 'Hungaroring',
    loc: 'Mogyoród · Hungary',
    theme: 'park',
    grass: 0x437d3c,
    runoff: 6.5,
    width: 13.0,
    bank: 5.5,
    openf1CircuitKey: 4,
    meetingName: 'Hungarian Grand Prix',
    desc: 'Tight, twisty "Monaco without the walls" in a natural amphitheatre',
    pts: ovalPts(200, 210, 22)
  },
  {
    name: 'Circuit Zandvoort',
    loc: 'Zandvoort · Netherlands',
    theme: 'park',
    grass: 0x4c8748,
    runoff: 6.0,
    width: 12.0,
    bank: 16.0, // Hugenholtz & the Arie Luyendyk bowl — proper 18-degree speed banks
    openf1CircuitKey: 55,
    meetingName: 'Dutch Grand Prix',
    desc: 'Dune-side circuit with banked corners at Tarzan and Arie Luyendyk',
    pts: ovalPts(205, 200, 20)
  },
  {
    name: 'Madring',
    loc: 'Madrid · Spain',
    theme: 'street',
    grass: 0x3f7a3f,
    runoff: 5.0,
    width: 12.0,
    bank: 9.0, // La Monumental — the new banked signature corner
    openf1CircuitKey: 153,
    meetingName: 'Spanish Grand Prix',
    desc: 'Newest circuit on the calendar — a hybrid street & permanent layout',
    pts: ovalPts(225, 185, 20)
  },
  {
    name: 'Baku City Circuit',
    loc: 'Baku · Azerbaijan',
    theme: 'street',
    grass: 0x3d783f,
    runoff: 4.0,
    width: 11.0, // narrow street canyon
    bank: 2.0,
    water: [{ from: 0.02, to: 0.2, w: 28, boats: true }], // the Caspian Sea promenade along the boulevard
    openf1CircuitKey: 144,
    meetingName: 'Azerbaijan Grand Prix',
    desc: 'Old-town castle walls meet a two-kilometre seafront straight',
    pts: ovalPts(280, 160, 22)
  },
  {
    name: 'Sepang',
    loc: 'Kuala Lumpur · Malaysia',
    theme: 'forest',
    grass: 0x386b38,
    runoff: 7.0,
    width: 15.0,
    bank: 5.5,
    openf1CircuitKey: 12,
    meetingName: 'Malaysian Grand Prix',
    desc: 'Jungle-fringed circuit with long straights and heavy humidity',
    pts: ovalPts(230, 210, 20)
  },
  {
    name: 'Marina Bay',
    loc: 'Marina Bay Street Circuit · Singapore',
    theme: 'street',
    grass: 0x3a7a45,
    runoff: 3.8,
    width: 11.5,
    bank: 2.2,
    water: [{ from: 0.45, to: 0.62, w: 30, boats: true }], // Marina Bay itself, superyachts moored for race week
    openf1CircuitKey: 61,
    meetingName: 'Singapore Grand Prix',
    desc: 'Floodlit night race through the city — one of the toughest on the calendar',
    pts: ovalPts(215, 195, 22)
  },
  {
    name: 'Circuit of the Americas',
    loc: 'Austin, Texas · USA',
    theme: 'park',
    grass: 0x4a8340,
    runoff: 7.0,
    width: 15.0,
    bank: 6.0,
    openf1CircuitKey: 9,
    meetingName: 'United States Grand Prix',
    desc: "Steep uphill Turn 1 inspired by Silverstone's Maggotts-Becketts",
    pts: ovalPts(225, 205, 20)
  },
  {
    name: 'Autódromo Hermanos Rodríguez',
    loc: 'Mexico City · Mexico',
    theme: 'park',
    grass: 0x4c8747,
    runoff: 6.5,
    width: 14.0,
    bank: 6.0,
    openf1CircuitKey: 65,
    meetingName: 'Mexico City Grand Prix',
    desc: 'Thin high-altitude air and a stadium section through the Foro Sol',
    pts: ovalPts(210, 210, 20)
  },
  {
    name: 'Interlagos',
    loc: 'Autódromo José Carlos Pace · São Paulo, Brazil',
    theme: 'park',
    grass: 0x437f3d,
    runoff: 6.5,
    width: 13.0,
    bank: 7.0,
    openf1CircuitKey: 14,
    meetingName: 'São Paulo Grand Prix',
    desc: 'Anti-clockwise, undulating circuit famous for late-season drama',
    pts: ovalPts(215, 195, 20)
  },
  {
    name: 'Las Vegas Strip Circuit',
    loc: 'Las Vegas, Nevada · USA',
    theme: 'street',
    grass: 0x3a7040,
    runoff: 4.5,
    width: 13.5,
    bank: 2.0,
    openf1CircuitKey: 152,
    meetingName: 'Las Vegas Grand Prix',
    desc: 'Midnight street race down the neon-lit Las Vegas Strip',
    pts: ovalPts(260, 165, 20)
  },
  {
    name: 'Lusail International Circuit',
    loc: 'Lusail · Qatar',
    theme: 'park',
    grass: 0x477a3c,
    runoff: 7.0,
    width: 13.0,
    bank: 5.5,
    openf1CircuitKey: 150,
    meetingName: 'Qatar Grand Prix',
    desc: 'High-speed floodlit desert circuit with sweeping, flowing corners',
    pts: ovalPts(225, 195, 20)
  },
  {
    name: 'Yas Marina',
    loc: 'Yas Island · Abu Dhabi, UAE',
    theme: 'park',
    grass: 0x437d40,
    runoff: 6.5,
    width: 14.0,
    bank: 4.5,
    water: [{ from: 0.55, to: 0.72, w: 26, boats: true }], // the marina the circuit is named for
    openf1CircuitKey: 70,
    meetingName: 'Abu Dhabi Grand Prix',
    desc: 'Season finale under the lights beside the Yas Marina yacht harbour',
    pts: ovalPts(215, 200, 20)
  }
];
