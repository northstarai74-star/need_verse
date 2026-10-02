// Starter data loaded by `npm run seed`: the car models for the fit finder and two
// welcome coupons. Add your own products in the admin (Products -> New product or Import CSV).

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

module.exports = { products: [], vehicles, coupons };
