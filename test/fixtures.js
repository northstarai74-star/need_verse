// Sample catalogue used only by the automated tests (not loaded into your store).

const P = (id, sku, slug, name, category, icon, price, short_desc, makes, extra = {}) =>
  ({ id, sku, slug, name, category, icon, price, short_desc, universal: makes === "all", makes: makes === "all" ? [] : makes, ...extra });

const MAJOR = ["Toyota", "Honda", "Ford", "Nissan", "Hyundai", "BMW"];

const products = [
  P(1, "NV-INT-001", "all-weather-floor-mats-4-pc", "All-Weather Floor Mats (4-pc)", "Interior", "🧽", 4399, "Laser-fit, deep channels, easy rinse.", ["Toyota", "Honda", "Ford", "Nissan", "Hyundai"], { included: "2 front mats, 2 rear mats", install_difficulty: "Easy", fit_notes: "Check your model and year below before ordering." }),
  P(2, "NV-ELE-002", "front-rear-dash-cam-2k", "Front & Rear Dash Cam 2K", "Electronics", "📹", 7199, "Loop recording, night vision, parking mode.", "all", { install_difficulty: "Moderate" }),
  P(3, "NV-ELE-003", "wireless-phone-mount-charger", "Wireless Phone Mount + Charger", "Electronics", "📱", 2799, "15W fast charge, one-hand release.", "all"),
  P(4, "NV-INT-004", "breathable-mesh-seat-covers", "Breathable Mesh Seat Covers", "Interior", "💺", 6399, "Airbag safe, fits in 10 minutes.", ["Toyota", "Honda", "Nissan", "Hyundai"]),
  P(5, "NV-INT-005", "windshield-sun-shade", "Windshield Sun Shade", "Interior", "🌞", 1439, "Reflective, folds into a door pocket.", "all"),
  P(6, "NV-INT-006", "collapsible-trunk-organizer", "Collapsible Trunk Organizer", "Interior", "🧳", 2399, "3 compartments, non-slip base.", "all"),
  P(7, "NV-EME-007", "jump-starter-2000a", "Jump Starter 2000A", "Emergency", "🔋", 5599, "Starts up to 8L engines, doubles as a power bank.", "all"),
  P(8, "NV-EME-008", "cordless-tire-inflator", "Cordless Tire Inflator", "Emergency", "🛞", 3599, "Auto shut-off at your target PSI.", "all"),
  P(9, "NV-EME-009", "emergency-roadside-kit", "Emergency Roadside Kit", "Emergency", "🚨", 3199, "Triangles, first aid, gloves, tow strap.", "all"),
  P(10, "NV-EXT-010", "led-headlight-bulbs-pair", "LED Headlight Bulbs (pair)", "Exterior", "💡", 3999, "6000K, plug-and-play, 3x brighter.", MAJOR, { install_difficulty: "Moderate", fit_notes: "Bulb type varies by trim. Check your owner's manual." }),
  P(11, "NV-EXT-011", "silicone-wiper-blades-pair", "Silicone Wiper Blades (pair)", "Exterior", "🌧️", 1999, "Streak-free and quiet.", MAJOR),
  P(12, "NV-EXT-012", "custom-fit-mud-flaps", "Custom-Fit Mud Flaps", "Exterior", "🛡️", 3119, "No drilling on most models.", ["Toyota", "Ford", "Nissan"]),
  P(13, "NV-CLE-013", "ceramic-coating-spray", "Ceramic Coating Spray", "Cleaning", "✨", 1599, "Months of shine in a 15-minute wipe-on.", "all"),
  P(14, "NV-CLE-014", "microfiber-towels-6-pack", "Microfiber Towels (6-pack)", "Cleaning", "🧺", 1199, "Scratch-free drying and buffing.", "all"),
  P(15, "NV-CLE-015", "portable-car-vacuum", "Portable Car Vacuum", "Cleaning", "🌀", 2639, "Cordless with 3 nozzles.", "all"),
  P(16, "NV-UTI-016", "tow-hitch-receiver-kit", "Tow Hitch Receiver Kit", "Utility", "🔗", 9599, "Class III, bolt-on install.", ["Toyota", "Ford", "Nissan"], { install_difficulty: "Professional install recommended" }),
  P(17, "NV-UTI-017", "roof-cargo-box-16-cu-ft", "Roof Cargo Box 16 cu ft", "Utility", "📦", 19919, "Dual-side opening, lockable.", MAJOR, { fit_notes: "Needs roof rails or crossbars." }),
  P(18, "NV-ELE-018", "obd2-bluetooth-scanner", "OBD2 Bluetooth Scanner", "Electronics", "🔧", 2239, "Read and clear codes from your phone.", "all")
];

// make -> model -> [first year, last year]
const vehicles = {
  "Maruti Suzuki": { Swift: [2005, 2026], Baleno: [2015, 2026], Dzire: [2008, 2026], Brezza: [2016, 2026], Ertiga: [2012, 2026], "Wagon R": [2010, 2026], Fronx: [2023, 2026], "Grand Vitara": [2022, 2026] },
  Hyundai: { Creta: [2015, 2026], Venue: [2019, 2026], i20: [2008, 2026], Verna: [2006, 2026], Exter: [2023, 2026], Alcazar: [2021, 2026], "Grand i10 Nios": [2019, 2026], Elantra: [2016, 2024], Tucson: [2016, 2026] },
  Tata: { Nexon: [2017, 2026], Punch: [2021, 2026], Harrier: [2019, 2026], Safari: [2021, 2026], Altroz: [2020, 2026], Tiago: [2016, 2026] },
  Mahindra: { Thar: [2010, 2026], "Scorpio-N": [2022, 2026], "Scorpio Classic": [2022, 2026], XUV700: [2021, 2026], "XUV 3XO": [2024, 2026], Bolero: [2000, 2026] },
  Kia: { Seltos: [2019, 2026], Sonet: [2020, 2026], Carens: [2022, 2026] },
  Toyota: { "Innova Crysta": [2016, 2026], Fortuner: [2009, 2026], Glanza: [2019, 2026], "Urban Cruiser Hyryder": [2022, 2026], Camry: [2018, 2026], Corolla: [2016, 2024], RAV4: [2016, 2024], Hilux: [2016, 2026] },
  Honda: { City: [2008, 2026], Amaze: [2013, 2026], Elevate: [2023, 2026], Civic: [2016, 2024], Accord: [2016, 2024], "CR-V": [2016, 2024] },
  MG: { Hector: [2019, 2026], Astor: [2021, 2026] },
  Ford: { Focus: [2012, 2018], "F-150": [2015, 2024], Escape: [2017, 2024] },
  Nissan: { Altima: [2016, 2024], Rogue: [2016, 2024], Sentra: [2016, 2024], Magnite: [2020, 2026] },
  BMW: { "3 Series": [2015, 2026], X5: [2015, 2026] }
};

const coupons = [
  { code: "SAVE10", percent: 10, min_order: 0 },
  { code: "WELCOME5", percent: 5, min_order: 0 }
];

module.exports = { products, vehicles, coupons };
