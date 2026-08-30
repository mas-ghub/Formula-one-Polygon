/* ============ Authentic World-Class F1 Circuit Layouts & Official Benchmarks ============ */

export const TRACKS = [
  {
    name: 'Monza',
    loc: 'Autodromo Nazionale Monza · Italy',
    theme: 'park',
    grass: 0x477d3b,
    runoff: 7.0,
    openf1CircuitKey: 7,
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
    openf1CircuitKey: 14,
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
    openf1CircuitKey: 22,
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
    openf1CircuitKey: 12,
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
  }
];
