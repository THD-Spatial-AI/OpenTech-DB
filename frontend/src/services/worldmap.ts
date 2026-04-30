/**
 * services/worldmap.ts
 * ─────────────────────
 * Static country-level energy technology parameter data.
 *
 * Data sources (representative values):
 *   - IRENA Renewable Power Generation Costs 2023
 *   - NREL Annual Technology Baseline (ATB) 2023
 *   - BloombergNEF New Energy Outlook 2023
 *   - IEA World Energy Outlook 2023
 *
 * Values represent weighted-average national estimates.
 * Intermediate years (2022, 2024, 2026) use linear interpolation;
 * 2030/2035 use published projections.
 *
 * Units:
 *   CAPEX solar/wind/nuclear : USD/kW  (overnight capital cost)
 *   CAPEX battery            : USD/kWh (energy capacity cost)
 *   Fixed O&M                : USD/kW/yr
 *   Capacity factor          : %
 *   CO₂ lifecycle            : g CO₂eq/kWh (incl. manufacturing)
 */

import type {
  CountryMapData,
  CountryTechSeries,
  TechMapParam,
  TechMapType,
  YearValue,
} from "../types/worldmap";

// ── Internal compact format ───────────────────────────────────────────────────

const YEARS = [2020, 2022, 2024, 2026, 2030, 2035] as const;
type V6 = [number, number, number, number, number, number];

function toSeries(vals: V6): YearValue[] {
  return YEARS.map((y, i) => ({ year: y, value: vals[i] }));
}

interface RawCountry {
  iso2: string;
  iso3: string;
  name: string;
  region: string;
  // Each array: [2020, 2022, 2024, 2026, 2030, 2035]
  solar_capex_kw:   V6;  // USD/kW
  solar_opex:       V6;  // USD/kW/yr
  solar_cf:         V6;  // %
  solar_co2:        V6;  // g CO2eq/kWh (lifecycle)
  wind_capex_kw:    V6;  // USD/kW
  wind_opex:        V6;  // USD/kW/yr
  wind_cf:          V6;  // %
  wind_co2:         V6;  // g CO2eq/kWh
  offshore_capex_kw: V6 | null; // null = landlocked / no offshore
  offshore_opex:    V6 | null;
  offshore_cf:      V6 | null;
  offshore_co2:     V6 | null;
  batt_capex_kwh:   V6;  // USD/kWh
  batt_opex:        V6;  // USD/kWh/yr
  nuclear_capex_kw: V6 | null;
  nuclear_opex:     V6 | null;
  nuclear_cf:       V6 | null;
  nuclear_co2:      V6 | null;
}

// ── Raw data ──────────────────────────────────────────────────────────────────

const RAW: RawCountry[] = [
  // ── North America ─────────────────────────────────────────────────────────
  {
    iso2: "US", iso3: "USA", name: "United States", region: "North America",
    solar_capex_kw:   [1120, 1040, 950,  860,  700,  545],
    solar_opex:       [15,   14,   13,   12,   10,   8  ],
    solar_cf:         [22,   23,   24,   25,   27,   29 ],
    solar_co2:        [42,   40,   37,   34,   28,   23 ],
    wind_capex_kw:    [1520, 1510, 1490, 1460, 1390, 1295],
    wind_opex:        [38,   37,   36,   35,   33,   30 ],
    wind_cf:          [34,   35,   36,   37,   39,   41 ],
    wind_co2:         [9,    9,    8,    8,    7,    6  ],
    offshore_capex_kw:[3500, 3380, 3200, 2960, 2500, 2080],
    offshore_opex:    [90,   87,   83,   78,   67,   56 ],
    offshore_cf:      [42,   43,   44,   45,   47,   49 ],
    offshore_co2:     [14,   13,   13,   12,   11,   9  ],
    batt_capex_kwh:   [350,  295,  245,  195,  130,  92 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: [6200, 6350, 6500, 6600, 6600, 6400],
    nuclear_opex:     [95,   96,   97,   98,   97,   95 ],
    nuclear_cf:       [92,   92,   92,   93,   93,   93 ],
    nuclear_co2:      [12,   12,   12,   12,   11,   11 ],
  },
  {
    iso2: "CA", iso3: "CAN", name: "Canada", region: "North America",
    solar_capex_kw:   [1150, 1065, 970,  875,  715,  560],
    solar_opex:       [15,   14,   13,   12,   10,   8  ],
    solar_cf:         [16,   17,   17,   18,   19,   20 ],
    solar_co2:        [28,   27,   25,   23,   19,   15 ],
    wind_capex_kw:    [1620, 1615, 1600, 1578, 1525, 1447],
    wind_opex:        [40,   39,   38,   37,   35,   32 ],
    wind_cf:          [30,   31,   32,   33,   35,   37 ],
    wind_co2:         [7,    7,    7,    6,    6,    5  ],
    offshore_capex_kw:[3600, 3490, 3310, 3070, 2610, 2185],
    offshore_opex:    [92,   89,   85,   79,   68,   57 ],
    offshore_cf:      [38,   39,   40,   41,   43,   45 ],
    offshore_co2:     [14,   13,   13,   12,   11,   9  ],
    batt_capex_kwh:   [352,  297,  246,  196,  132,  94 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: [6500, 6550, 6600, 6700, 6700, 6500],
    nuclear_opex:     [90,   91,   92,   93,   93,   91 ],
    nuclear_cf:       [90,   90,   91,   91,   92,   92 ],
    nuclear_co2:      [12,   12,   12,   11,   11,   10 ],
  },
  {
    iso2: "MX", iso3: "MEX", name: "Mexico", region: "North America",
    solar_capex_kw:   [820,  770,  695,  625,  510,  410],
    solar_opex:       [13,   12,   11,   10,   8,    7  ],
    solar_cf:         [24,   25,   25,   26,   27,   28 ],
    solar_co2:        [38,   36,   34,   31,   26,   21 ],
    wind_capex_kw:    [1100, 1090, 1070, 1045, 995,  938],
    wind_opex:        [32,   31,   30,   29,   27,   25 ],
    wind_cf:          [38,   39,   40,   41,   43,   45 ],
    wind_co2:         [8,    8,    7,    7,    6,    5  ],
    offshore_capex_kw: null,
    offshore_opex:     null,
    offshore_cf:       null,
    offshore_co2:      null,
    batt_capex_kwh:   [375,  320,  265,  212,  143,  102],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  // ── South America ─────────────────────────────────────────────────────────
  {
    iso2: "BR", iso3: "BRA", name: "Brazil", region: "South America",
    solar_capex_kw:   [850,  790,  715,  640,  525,  420],
    solar_opex:       [13,   12,   11,   10,   8.5,  7  ],
    solar_cf:         [20,   21,   21,   22,   23,   24 ],
    solar_co2:        [32,   30,   28,   26,   22,   18 ],
    wind_capex_kw:    [1180, 1165, 1147, 1120, 1066, 1002],
    wind_opex:        [34,   33,   32,   31,   29,   27 ],
    wind_cf:          [40,   41,   42,   43,   45,   47 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[3700, 3590, 3400, 3155, 2685, 2245],
    offshore_opex:    [94,   91,   86,   80,   69,   58 ],
    offshore_cf:      [40,   41,   42,   43,   45,   47 ],
    offshore_co2:     [15,   14,   13,   13,   11,   9  ],
    batt_capex_kwh:   [378,  322,  267,  214,  144,  103],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "CL", iso3: "CHL", name: "Chile", region: "South America",
    solar_capex_kw:   [790,  735,  665,  597,  490,  395],
    solar_opex:       [12,   11,   10,   9.5,  8,    6.5],
    solar_cf:         [28,   29,   29,   30,   31,   32 ],
    solar_co2:        [35,   33,   31,   29,   24,   19 ],
    wind_capex_kw:    [1200, 1188, 1168, 1142, 1090, 1028],
    wind_opex:        [35,   34,   33,   32,   30,   28 ],
    wind_cf:          [35,   36,   37,   38,   40,   42 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [380,  323,  268,  215,  145,  104],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "AR", iso3: "ARG", name: "Argentina", region: "South America",
    solar_capex_kw:   [900,  840,  760,  685,  560,  453],
    solar_opex:       [14,   13,   12,   11,   9,    7.5],
    solar_cf:         [22,   23,   23,   24,   25,   26 ],
    solar_co2:        [40,   38,   36,   33,   28,   23 ],
    wind_capex_kw:    [1150, 1138, 1118, 1093, 1041, 981],
    wind_opex:        [34,   33,   32,   31,   29,   27 ],
    wind_cf:          [38,   39,   40,   41,   43,   45 ],
    wind_co2:         [8,    8,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [385,  328,  272,  218,  149,  107],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  // ── Europe ────────────────────────────────────────────────────────────────
  {
    iso2: "DE", iso3: "DEU", name: "Germany", region: "Europe",
    solar_capex_kw:   [1050, 945,  830,  740,  600,  478],
    solar_opex:       [14,   13,   12,   11,   9,    7.5],
    solar_cf:         [11,   11.5, 12,   12.5, 13.5, 14.5],
    solar_co2:        [32,   30,   28,   26,   22,   17 ],
    wind_capex_kw:    [1680, 1686, 1663, 1632, 1562, 1472],
    wind_opex:        [42,   41,   40,   39,   37,   34 ],
    wind_cf:          [24,   25,   26,   27,   29,   31 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[3200, 3100, 2940, 2730, 2355, 1985],
    offshore_opex:    [88,   85,   81,   75,   65,   54 ],
    offshore_cf:      [42,   43,   44,   45,   47,   49 ],
    offshore_co2:     [13,   12,   12,   11,   10,   8  ],
    batt_capex_kwh:   [365,  308,  256,  205,  139,  99 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: [5800,  null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number],
    nuclear_opex:     [null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number],
    nuclear_cf:       [null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number],
    nuclear_co2:      [null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number, null as unknown as number],
  },
  {
    iso2: "FR", iso3: "FRA", name: "France", region: "Europe",
    solar_capex_kw:   [1080, 975,  860,  770,  628,  503],
    solar_opex:       [14,   13,   12,   11,   9.5,  8  ],
    solar_cf:         [15,   15.5, 16,   16.5, 17.5, 18.5],
    solar_co2:        [28,   26,   24,   22,   18,   14 ],
    wind_capex_kw:    [1600, 1610, 1590, 1563, 1498, 1412],
    wind_opex:        [41,   40,   39,   38,   36,   33 ],
    wind_cf:          [25,   26,   27,   28,   30,   32 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[3500, 3390, 3215, 2978, 2535, 2123],
    offshore_opex:    [90,   87,   83,   77,   66,   55 ],
    offshore_cf:      [40,   41,   42,   43,   45,   47 ],
    offshore_co2:     [13,   12,   12,   11,   10,   8  ],
    batt_capex_kwh:   [360,  304,  252,  202,  137,  98 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: [5500, 5600, 5700, 5800, 5800, 5600],
    nuclear_opex:     [70,   71,   72,   73,   73,   71 ],
    nuclear_cf:       [75,   75,   76,   76,   77,   77 ],
    nuclear_co2:      [12,   12,   12,   12,   11,   11 ],
  },
  {
    iso2: "GB", iso3: "GBR", name: "United Kingdom", region: "Europe",
    solar_capex_kw:   [1100, 995,  880,  790,  645,  517],
    solar_opex:       [14,   13,   12,   11,   9.5,  8  ],
    solar_cf:         [11,   11.5, 12,   12.5, 13.5, 14.5],
    solar_co2:        [35,   33,   31,   29,   24,   19 ],
    wind_capex_kw:    [1580, 1587, 1567, 1540, 1476, 1393],
    wind_opex:        [40,   39,   38,   37,   35,   32 ],
    wind_cf:          [28,   29,   30,   31,   33,   35 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[3100, 2990, 2835, 2630, 2265, 1905],
    offshore_opex:    [85,   82,   78,   73,   63,   52 ],
    offshore_cf:      [44,   45,   46,   47,   49,   51 ],
    offshore_co2:     [13,   12,   11,   11,   9,    8  ],
    batt_capex_kwh:   [355,  300,  248,  198,  134,  96 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: [6800, 7000, 7200, 7300, 7200, 7000],
    nuclear_opex:     [100,  101,  102,  103,  103,  101],
    nuclear_cf:       [80,   80,   81,   81,   82,   82 ],
    nuclear_co2:      [12,   12,   11,   11,   10,   10 ],
  },
  {
    iso2: "ES", iso3: "ESP", name: "Spain", region: "Europe",
    solar_capex_kw:   [900,  835,  755,  675,  555,  445],
    solar_opex:       [13,   12,   11,   10,   8.5,  7  ],
    solar_cf:         [22,   22.5, 23,   23.5, 24.5, 25.5],
    solar_co2:        [30,   28,   26,   24,   20,   15 ],
    wind_capex_kw:    [1200, 1207, 1192, 1170, 1122, 1060],
    wind_opex:        [35,   34,   33,   32,   30,   28 ],
    wind_cf:          [28,   29,   30,   31,   33,   35 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[3600, 3490, 3310, 3070, 2615, 2193],
    offshore_opex:    [92,   89,   84,   78,   68,   57 ],
    offshore_cf:      [38,   39,   40,   41,   43,   45 ],
    offshore_co2:     [14,   13,   12,   12,   10,   8  ],
    batt_capex_kwh:   [355,  300,  248,  198,  134,  96 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "IT", iso3: "ITA", name: "Italy", region: "Europe",
    solar_capex_kw:   [960,  890,  805,  723,  594,  478],
    solar_opex:       [13,   12,   11,   10,   8.5,  7  ],
    solar_cf:         [19,   19.5, 20,   20.5, 21.5, 22.5],
    solar_co2:        [30,   28,   26,   24,   20,   16 ],
    wind_capex_kw:    [1550, 1557, 1538, 1512, 1453, 1374],
    wind_opex:        [40,   39,   38,   37,   35,   32 ],
    wind_cf:          [22,   23,   24,   25,   27,   29 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[3700, 3592, 3405, 3158, 2690, 2250],
    offshore_opex:    [93,   90,   86,   79,   68,   57 ],
    offshore_cf:      [38,   39,   40,   41,   43,   45 ],
    offshore_co2:     [14,   13,   13,   12,   10,   9  ],
    batt_capex_kwh:   [360,  304,  252,  202,  137,  98 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "PL", iso3: "POL", name: "Poland", region: "Europe",
    solar_capex_kw:   [1050, 945,  845,  760,  622,  500],
    solar_opex:       [14,   13,   12,   11,   9.5,  8  ],
    solar_cf:         [12,   12.5, 13,   13.5, 14.5, 15.5],
    solar_co2:        [45,   43,   40,   37,   31,   25 ],
    wind_capex_kw:    [1420, 1424, 1406, 1381, 1325, 1252],
    wind_opex:        [38,   37,   36,   35,   33,   30 ],
    wind_cf:          [25,   26,   27,   28,   30,   32 ],
    wind_co2:         [8,    8,    7,    7,    6,    5  ],
    offshore_capex_kw:[3400, 3295, 3125, 2900, 2475, 2080],
    offshore_opex:    [87,   84,   80,   74,   64,   54 ],
    offshore_cf:      [40,   41,   42,   43,   45,   47 ],
    offshore_co2:     [13,   12,   12,   11,   10,   8  ],
    batt_capex_kwh:   [360,  304,  252,  202,  137,  98 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "DK", iso3: "DNK", name: "Denmark", region: "Europe",
    solar_capex_kw:   [1000, 905,  810,  725,  592,  473],
    solar_opex:       [13,   12,   11,   10,   8.5,  7  ],
    solar_cf:         [12,   12.5, 13,   13.5, 14.5, 15.5],
    solar_co2:        [28,   26,   24,   22,   18,   14 ],
    wind_capex_kw:    [1550, 1556, 1538, 1512, 1452, 1373],
    wind_opex:        [39,   38,   37,   36,   34,   32 ],
    wind_cf:          [35,   36,   37,   38,   40,   42 ],
    wind_co2:         [7,    7,    6,    6,    5,    4  ],
    offshore_capex_kw:[3000, 2910, 2762, 2565, 2213, 1868],
    offshore_opex:    [82,   79,   75,   70,   61,   51 ],
    offshore_cf:      [46,   47,   48,   49,   51,   53 ],
    offshore_co2:     [12,   11,   11,   10,   9,    7  ],
    batt_capex_kwh:   [355,  300,  248,  198,  134,  96 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "NL", iso3: "NLD", name: "Netherlands", region: "Europe",
    solar_capex_kw:   [1020, 922,  825,  738,  603,  483],
    solar_opex:       [13,   12,   11,   10,   8.5,  7  ],
    solar_cf:         [12,   12.5, 13,   13.5, 14.5, 15.5],
    solar_co2:        [32,   30,   28,   26,   22,   17 ],
    wind_capex_kw:    [1580, 1587, 1568, 1543, 1480, 1400],
    wind_opex:        [40,   39,   38,   37,   35,   32 ],
    wind_cf:          [28,   29,   30,   31,   33,   35 ],
    wind_co2:         [7,    7,    6,    6,    5,    5  ],
    offshore_capex_kw:[3200, 3100, 2940, 2730, 2355, 1987],
    offshore_opex:    [85,   82,   78,   73,   63,   52 ],
    offshore_cf:      [44,   45,   46,   47,   49,   51 ],
    offshore_co2:     [13,   12,   11,   11,   9,    8  ],
    batt_capex_kwh:   [355,  300,  248,  198,  134,  96 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "SE", iso3: "SWE", name: "Sweden", region: "Europe",
    solar_capex_kw:   [1050, 947,  848,  762,  624,  501],
    solar_opex:       [14,   13,   12,   11,   9.5,  8  ],
    solar_cf:         [11,   11.5, 12,   12.5, 13.5, 14.5],
    solar_co2:        [22,   20,   18,   17,   14,   11 ],
    wind_capex_kw:    [1500, 1505, 1488, 1462, 1402, 1325],
    wind_opex:        [38,   37,   36,   35,   33,   30 ],
    wind_cf:          [30,   31,   32,   33,   35,   37 ],
    wind_co2:         [6,    6,    6,    5,    5,    4  ],
    offshore_capex_kw:[3300, 3198, 3040, 2824, 2435, 2055],
    offshore_opex:    [87,   84,   80,   74,   64,   54 ],
    offshore_cf:      [40,   41,   42,   43,   45,   47 ],
    offshore_co2:     [11,   11,   10,   10,   8,    7  ],
    batt_capex_kwh:   [355,  300,  248,  198,  134,  96 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: [5500, 5600, 5700, 5800, 5800, 5600],
    nuclear_opex:     [65,   66,   67,   68,   68,   66 ],
    nuclear_cf:       [86,   86,   87,   87,   88,   88 ],
    nuclear_co2:      [11,   11,   10,   10,   9,    9  ],
  },
  {
    iso2: "NO", iso3: "NOR", name: "Norway", region: "Europe",
    solar_capex_kw:   [1100, 995,  893,  803,  658,  529],
    solar_opex:       [14,   13,   12,   11,   9.5,  8  ],
    solar_cf:         [10,   10.5, 11,   11.5, 12.5, 13.5],
    solar_co2:        [18,   17,   16,   14,   12,   9  ],
    wind_capex_kw:    [1480, 1485, 1468, 1442, 1383, 1308],
    wind_opex:        [38,   37,   36,   35,   33,   30 ],
    wind_cf:          [35,   36,   37,   38,   40,   42 ],
    wind_co2:         [6,    6,    5,    5,    4,    4  ],
    offshore_capex_kw:[3250, 3148, 2992, 2778, 2400, 2030],
    offshore_opex:    [86,   83,   79,   74,   64,   53 ],
    offshore_cf:      [44,   45,   46,   47,   49,   51 ],
    offshore_co2:     [11,   10,   10,   9,    8,    7  ],
    batt_capex_kwh:   [358,  303,  251,  201,  136,  97 ],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "TR", iso3: "TUR", name: "Turkey", region: "Europe",
    solar_capex_kw:   [870,  808,  730,  657,  540,  435],
    solar_opex:       [13,   12,   11,   10,   8.5,  7  ],
    solar_cf:         [20,   20.5, 21,   21.5, 22.5, 23.5],
    solar_co2:        [42,   40,   37,   34,   29,   23 ],
    wind_capex_kw:    [1180, 1183, 1167, 1147, 1100, 1040],
    wind_opex:        [33,   32,   31,   30,   28,   26 ],
    wind_cf:          [30,   31,   32,   33,   35,   37 ],
    wind_co2:         [8,    8,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [375,  319,  265,  212,  144,  103],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  // ── Asia / Pacific ────────────────────────────────────────────────────────
  {
    iso2: "CN", iso3: "CHN", name: "China", region: "Asia",
    solar_capex_kw:   [630,  560,  475,  403,  316,  253],
    solar_opex:       [9,    8,    7,    6.5,  5.5,  4.5],
    solar_cf:         [17,   17.5, 18,   18.5, 19.5, 20.5],
    solar_co2:        [65,   58,   52,   46,   37,   29 ],
    wind_capex_kw:    [1050, 997,  942,  882,  798,  712],
    wind_opex:        [28,   27,   26,   25,   23,   21 ],
    wind_cf:          [25,   26,   27,   28,   30,   32 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[2800, 2655, 2440, 2228, 1862, 1545],
    offshore_opex:    [72,   70,   66,   62,   53,   44 ],
    offshore_cf:      [38,   39,   40,   41,   43,   45 ],
    offshore_co2:     [16,   15,   14,   13,   11,   9  ],
    batt_capex_kwh:   [250,  196,  155,  118,  79,   57 ],
    batt_opex:        [8,    6.5,  5.5,  4.4,  3,    2.2],
    nuclear_capex_kw: [3200, 3250, 3300, 3350, 3400, 3350],
    nuclear_opex:     [45,   46,   47,   48,   48,   47 ],
    nuclear_cf:       [90,   90,   91,   91,   92,   92 ],
    nuclear_co2:      [12,   11,   11,   11,   10,   10 ],
  },
  {
    iso2: "IN", iso3: "IND", name: "India", region: "Asia",
    solar_capex_kw:   [560,  495,  435,  375,  300,  242],
    solar_opex:       [9,    8,    7,    6.5,  5.5,  4.5],
    solar_cf:         [21,   21.5, 22,   22.5, 23.5, 24.5],
    solar_co2:        [58,   52,   47,   42,   34,   27 ],
    wind_capex_kw:    [800,  778,  752,  722,  676,  626],
    wind_opex:        [25,   24,   23,   22,   21,   19 ],
    wind_cf:          [28,   29,   30,   31,   33,   35 ],
    wind_co2:         [8,    8,    7,    7,    6,    5  ],
    offshore_capex_kw:[3200, 3103, 2942, 2730, 2344, 1960],
    offshore_opex:    [82,   79,   75,   70,   60,   50 ],
    offshore_cf:      [35,   36,   37,   38,   40,   42 ],
    offshore_co2:     [15,   14,   13,   12,   10,   9  ],
    batt_capex_kwh:   [310,  255,  207,  163,  108,  78 ],
    batt_opex:        [9,    7.5,  6.5,  5,    3.5,  2.5],
    nuclear_capex_kw: [3800, 3850, 3900, 3950, 4000, 3950],
    nuclear_opex:     [50,   51,   52,   53,   54,   53 ],
    nuclear_cf:       [85,   85,   86,   86,   87,   87 ],
    nuclear_co2:      [13,   13,   12,   12,   11,   10 ],
  },
  {
    iso2: "JP", iso3: "JPN", name: "Japan", region: "Asia",
    solar_capex_kw:   [1800, 1658, 1498, 1355, 1110, 905],
    solar_opex:       [22,   20,   18,   16,   13,   11 ],
    solar_cf:         [14,   14.5, 15,   15.5, 16.5, 17.5],
    solar_co2:        [45,   43,   40,   37,   31,   25 ],
    wind_capex_kw:    [2200, 2198, 2182, 2160, 2103, 2030],
    wind_opex:        [55,   54,   53,   52,   50,   47 ],
    wind_cf:          [20,   21,   22,   23,   25,   27 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[3800, 3700, 3515, 3268, 2822, 2385],
    offshore_opex:    [95,   92,   88,   82,   71,   59 ],
    offshore_cf:      [36,   37,   38,   39,   41,   43 ],
    offshore_co2:     [15,   14,   13,   13,   11,   9  ],
    batt_capex_kwh:   [380,  325,  270,  218,  149,  108],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: [5000, 5100, 5200, 5300, 5300, 5100],
    nuclear_opex:     [80,   81,   82,   83,   83,   81 ],
    nuclear_cf:       [70,   72,   74,   76,   80,   83 ],
    nuclear_co2:      [12,   12,   11,   11,   10,   10 ],
  },
  {
    iso2: "KR", iso3: "KOR", name: "South Korea", region: "Asia",
    solar_capex_kw:   [1450, 1338, 1205, 1083, 887,  722],
    solar_opex:       [18,   16,   14,   13,   11,   9  ],
    solar_cf:         [13,   13.5, 14,   14.5, 15.5, 16.5],
    solar_co2:        [50,   47,   44,   40,   34,   27 ],
    wind_capex_kw:    [1900, 1900, 1888, 1868, 1822, 1762],
    wind_opex:        [48,   47,   46,   45,   43,   40 ],
    wind_cf:          [20,   21,   22,   23,   25,   27 ],
    wind_co2:         [8,    8,    7,    7,    6,    5  ],
    offshore_capex_kw:[3600, 3505, 3322, 3087, 2660, 2245],
    offshore_opex:    [91,   88,   84,   78,   67,   56 ],
    offshore_cf:      [36,   37,   38,   39,   41,   43 ],
    offshore_co2:     [14,   14,   13,   13,   11,   9  ],
    batt_capex_kwh:   [320,  265,  218,  172,  115,  83 ],
    batt_opex:        [9,    7.5,  6.5,  5,    3.5,  2.5],
    nuclear_capex_kw: [3900, 3950, 4000, 4050, 4050, 3950],
    nuclear_opex:     [60,   61,   62,   63,   63,   61 ],
    nuclear_cf:       [85,   85,   86,   86,   87,   87 ],
    nuclear_co2:      [12,   12,   11,   11,   10,   10 ],
  },
  {
    iso2: "AU", iso3: "AUS", name: "Australia", region: "Asia-Pacific",
    solar_capex_kw:   [1100, 1000, 900,  810,  663,  535],
    solar_opex:       [14,   13,   12,   11,   9.5,  8  ],
    solar_cf:         [22,   22.5, 23,   23.5, 24.5, 25.5],
    solar_co2:        [40,   38,   36,   33,   28,   22 ],
    wind_capex_kw:    [1650, 1652, 1636, 1612, 1553, 1475],
    wind_opex:        [42,   41,   40,   39,   37,   34 ],
    wind_cf:          [33,   34,   35,   36,   38,   40 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw:[3800, 3690, 3503, 3255, 2810, 2383],
    offshore_opex:    [95,   92,   87,   81,   70,   58 ],
    offshore_cf:      [42,   43,   44,   45,   47,   49 ],
    offshore_co2:     [14,   14,   13,   12,   11,   9  ],
    batt_capex_kwh:   [365,  309,  257,  206,  140,  101],
    batt_opex:        [10,   8.5,  7,    5.5,  3.8,  2.7],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "ID", iso3: "IDN", name: "Indonesia", region: "Asia",
    solar_capex_kw:   [920,  855,  772,  695,  571,  461],
    solar_opex:       [14,   13,   12,   11,   9.5,  8  ],
    solar_cf:         [19,   19.5, 20,   20.5, 21.5, 22.5],
    solar_co2:        [55,   52,   49,   45,   38,   30 ],
    wind_capex_kw:    [1300, 1298, 1283, 1262, 1214, 1152],
    wind_opex:        [36,   35,   34,   33,   31,   29 ],
    wind_cf:          [25,   26,   27,   28,   30,   32 ],
    wind_co2:         [8,    8,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [390,  333,  277,  222,  152,  110],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  // ── Middle East / North Africa ────────────────────────────────────────────
  {
    iso2: "SA", iso3: "SAU", name: "Saudi Arabia", region: "Middle East",
    solar_capex_kw:   [700,  638,  570,  510,  418,  337],
    solar_opex:       [10,   9,    8,    7.5,  6,    5  ],
    solar_cf:         [28,   28.5, 29,   29.5, 30.5, 31.5],
    solar_co2:        [35,   33,   31,   29,   24,   19 ],
    wind_capex_kw:    [1250, 1248, 1235, 1215, 1170, 1115],
    wind_opex:        [34,   33,   32,   31,   29,   27 ],
    wind_cf:          [32,   33,   34,   35,   37,   39 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [370,  314,  261,  209,  142,  102],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "AE", iso3: "ARE", name: "United Arab Emirates", region: "Middle East",
    solar_capex_kw:   [680,  620,  554,  496,  407,  327],
    solar_opex:       [10,   9,    8,    7.5,  6,    5  ],
    solar_cf:         [27,   27.5, 28,   28.5, 29.5, 30.5],
    solar_co2:        [33,   31,   29,   27,   23,   18 ],
    wind_capex_kw:    [1280, 1278, 1265, 1245, 1200, 1145],
    wind_opex:        [34,   33,   32,   31,   29,   27 ],
    wind_cf:          [30,   31,   32,   33,   35,   37 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [370,  314,  261,  209,  142,  102],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: [4500, 4550, 4600, 4650, 4650, 4550],
    nuclear_opex:     [60,   61,   62,   63,   63,   61 ],
    nuclear_cf:       [90,   90,   91,   91,   92,   92 ],
    nuclear_co2:      [12,   11,   11,   11,   10,   10 ],
  },
  {
    iso2: "EG", iso3: "EGY", name: "Egypt", region: "Africa",
    solar_capex_kw:   [710,  647,  578,  518,  425,  342],
    solar_opex:       [11,   10,   9,    8.5,  7,    6  ],
    solar_cf:         [27,   27.5, 28,   28.5, 29.5, 30.5],
    solar_co2:        [38,   36,   34,   31,   26,   21 ],
    wind_capex_kw:    [1220, 1218, 1205, 1185, 1142, 1088],
    wind_opex:        [33,   32,   31,   30,   28,   26 ],
    wind_cf:          [35,   36,   37,   38,   40,   42 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [385,  329,  273,  219,  150,  109],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  {
    iso2: "MA", iso3: "MAR", name: "Morocco", region: "Africa",
    solar_capex_kw:   [780,  718,  645,  581,  478,  386],
    solar_opex:       [12,   11,   10,   9.5,  8,    6.5],
    solar_cf:         [26,   26.5, 27,   27.5, 28.5, 29.5],
    solar_co2:        [35,   33,   31,   29,   24,   19 ],
    wind_capex_kw:    [1150, 1147, 1133, 1113, 1070, 1017],
    wind_opex:        [32,   31,   30,   29,   27,   25 ],
    wind_cf:          [33,   34,   35,   36,   38,   40 ],
    wind_co2:         [8,    7,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [385,  329,  273,  219,  150,  109],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: null, nuclear_opex: null, nuclear_cf: null, nuclear_co2: null,
  },
  // ── Sub-Saharan Africa ────────────────────────────────────────────────────
  {
    iso2: "ZA", iso3: "ZAF", name: "South Africa", region: "Africa",
    solar_capex_kw:   [950,  878,  793,  714,  587,  474],
    solar_opex:       [14,   13,   12,   11,   9.5,  8  ],
    solar_cf:         [24,   24.5, 25,   25.5, 26.5, 27.5],
    solar_co2:        [55,   52,   49,   45,   38,   30 ],
    wind_capex_kw:    [1350, 1348, 1333, 1312, 1265, 1203],
    wind_opex:        [36,   35,   34,   33,   31,   29 ],
    wind_cf:          [30,   31,   32,   33,   35,   37 ],
    wind_co2:         [8,    8,    7,    7,    6,    5  ],
    offshore_capex_kw: null, offshore_opex: null, offshore_cf: null, offshore_co2: null,
    batt_capex_kwh:   [390,  333,  277,  222,  152,  110],
    batt_opex:        [11,   9.5,  8,    6.5,  4.4,  3.2],
    nuclear_capex_kw: [6000, 6100, 6200, 6300, 6300, 6100],
    nuclear_opex:     [90,   91,   92,   93,   93,   91 ],
    nuclear_cf:       [75,   76,   77,   78,   80,   82 ],
    nuclear_co2:      [13,   12,   12,   12,   11,   10 ],
  },
];

// ── Transform raw → CountryMapData ───────────────────────────────────────────

function buildEntry(
  tech: TechMapType,
  param: TechMapParam,
  unit: string,
  vals: V6 | null,
): CountryTechSeries | null {
  if (!vals) return null;
  // Filter out null placeholders (Germany's phased-out nuclear)
  const series = toSeries(vals).filter((yv) => yv.value != null);
  if (series.length === 0) return null;
  return { tech, param, unit, series };
}

function transformCountry(r: RawCountry): CountryMapData {
  const entries: CountryTechSeries[] = [];

  const push = (e: CountryTechSeries | null) => { if (e) entries.push(e); };

  // Solar PV Utility
  push(buildEntry("solar_pv_utility", "capex",           "USD/kW",    r.solar_capex_kw));
  push(buildEntry("solar_pv_utility", "opex_fixed",      "USD/kW/yr", r.solar_opex));
  push(buildEntry("solar_pv_utility", "capacity_factor", "%",          r.solar_cf));
  push(buildEntry("solar_pv_utility", "co2_emissions",   "g CO₂/kWh", r.solar_co2));

  // Onshore Wind
  push(buildEntry("onshore_wind",     "capex",           "USD/kW",    r.wind_capex_kw));
  push(buildEntry("onshore_wind",     "opex_fixed",      "USD/kW/yr", r.wind_opex));
  push(buildEntry("onshore_wind",     "capacity_factor", "%",          r.wind_cf));
  push(buildEntry("onshore_wind",     "co2_emissions",   "g CO₂/kWh", r.wind_co2));

  // Offshore Wind (coastal nations only)
  push(buildEntry("offshore_wind",     "capex",           "USD/kW",    r.offshore_capex_kw));
  push(buildEntry("offshore_wind",     "opex_fixed",      "USD/kW/yr", r.offshore_opex));
  push(buildEntry("offshore_wind",     "capacity_factor", "%",          r.offshore_cf));
  push(buildEntry("offshore_wind",     "co2_emissions",   "g CO₂/kWh", r.offshore_co2));

  // Battery Li-ion — CAPEX unit changes to USD/kWh
  push(buildEntry("battery_li_ion",    "capex",           "USD/kWh",   r.batt_capex_kwh));
  push(buildEntry("battery_li_ion",    "opex_fixed",      "USD/kWh/yr",r.batt_opex));

  // Nuclear
  push(buildEntry("nuclear",           "capex",           "USD/kW",    r.nuclear_capex_kw));
  push(buildEntry("nuclear",           "opex_fixed",      "USD/kW/yr", r.nuclear_opex));
  push(buildEntry("nuclear",           "capacity_factor", "%",          r.nuclear_cf));
  push(buildEntry("nuclear",           "co2_emissions",   "g CO₂/kWh", r.nuclear_co2));

  return { iso2: r.iso2, iso3: r.iso3, name: r.name, region: r.region, entries };
}

// ── Exported catalogue ────────────────────────────────────────────────────────

export const COUNTRY_CATALOGUE: CountryMapData[] = RAW.map(transformCountry);

const BY_ISO3 = new Map<string, CountryMapData>(
  COUNTRY_CATALOGUE.map((c) => [c.iso3, c]),
);

export function getCountryByIso3(iso3: string): CountryMapData | undefined {
  return BY_ISO3.get(iso3);
}

/**
 * Returns a Map<iso3, value> for the given tech/param/year combination,
 * used to paint the choropleth.
 * Only includes countries that have a data point for that year.
 */
export function getParamValues(
  tech: TechMapType,
  param: TechMapParam,
  year: number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const country of COUNTRY_CATALOGUE) {
    const entry = country.entries.find(
      (e) => e.tech === tech && e.param === param,
    );
    if (!entry) continue;
    const yv = entry.series.find((s) => s.year === year);
    if (yv == null) continue;
    result.set(country.iso3, yv.value);
  }
  return result;
}

/**
 * Returns [min, max] for the given tech/param across all countries and all
 * years, used to pin a consistent colour scale.
 */
export function getGlobalRange(
  tech: TechMapType,
  param: TechMapParam,
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const country of COUNTRY_CATALOGUE) {
    const entry = country.entries.find(
      (e) => e.tech === tech && e.param === param,
    );
    if (!entry) continue;
    for (const yv of entry.series) {
      if (yv.value < min) min = yv.value;
      if (yv.value > max) max = yv.value;
    }
  }
  return [min === Infinity ? 0 : min, max === -Infinity ? 1 : max];
}
