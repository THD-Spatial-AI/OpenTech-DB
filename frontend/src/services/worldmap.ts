/**
 * services/worldmap.ts
 * ─────────────────────
 * World map data sourced strictly from technology instance country data.
 * No country imputation is applied: countries without records remain blank.
 */

import type {
  CountryMapData,
  CountryTechSeries,
  TechMapParam,
  TechMapType,
  WorldMapTechMeta,
  MapYear,
} from "../types/worldmap";
import { MAP_YEARS } from "../types/worldmap";
import type { EquipmentInstance, Technology, TechnologyCatalogueResponse, TechnologySummary } from "../types/api";

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:8000/api/v1";

type CountrySeed = { iso3: string; name: string; lat?: number; lon?: number };

type CarrierKey = "solar_irradiance" | "wind" | "water" | "electricity";
type YearPoint = { year: number; value: number };
type SeedMatcher = { iso3: string; tokens: string[] };

interface WorldMapApiPoint {
  year: number;
  value: number;
}

interface WorldMapApiEntry {
  tech: string;
  param: string;
  unit: string;
  series: WorldMapApiPoint[];
}

interface WorldMapApiCountry {
  iso2: string;
  iso3: string;
  name: string;
  entries: WorldMapApiEntry[];
}

interface WorldMapApiTechnology {
  id: string;
  label: string;
  category: string;
  carrier_key: string;
  available_params: string[];
}

interface WorldMapApiResponse {
  generated_at: string;
  technologies: WorldMapApiTechnology[];
  countries: WorldMapApiCountry[];
}

const ISO2_TO_ISO3: Record<string, string> = {
  // Europe
  DE: "DEU", FR: "FRA", ES: "ESP", IT: "ITA", GR: "GRC", DK: "DNK",
  GB: "GBR", UK: "GBR", NO: "NOR", NL: "NLD", PT: "PRT", PL: "POL",
  BE: "BEL", IE: "IRL", SE: "SWE", FI: "FIN", CH: "CHE", AT: "AUT",
  CZ: "CZE", HU: "HUN", RO: "ROU", BG: "BGR", HR: "HRV", SK: "SVK",
  SI: "SVN", EE: "EST", LV: "LVA", LT: "LTU", LU: "LUX", CY: "CYP",
  MT: "MLT", UA: "UKR", RS: "SRB", TR: "TUR", IS: "ISL",
  // Americas
  US: "USA", CA: "CAN", MX: "MEX", BR: "BRA", CL: "CHL", AR: "ARG",
  CO: "COL", PE: "PER", UY: "URY",
  // Asia-Pacific
  AU: "AUS", NZ: "NZL", CN: "CHN", IN: "IND", JP: "JPN", KR: "KOR",
  TW: "TWN", ID: "IDN", VN: "VNM", TH: "THA", MY: "MYS", SG: "SGP",
  PK: "PAK", BD: "BGD", PH: "PHL", MN: "MNG",
  // Middle East
  SA: "SAU", AE: "ARE", QA: "QAT", IR: "IRN", IQ: "IRQ",
  IL: "ISR", JO: "JOR", OM: "OMN", KW: "KWT", BH: "BHR", YE: "YEM",
  // Africa
  ZA: "ZAF", EG: "EGY", MA: "MAR", NG: "NGA", KE: "KEN",
  ET: "ETH", TZ: "TZA", GH: "GHA", SN: "SEN", MZ: "MOZ",
  NA: "NAM", BW: "BWA", ZM: "ZMB", ZW: "ZWE",
  // Russia / Central Asia
  RU: "RUS", KZ: "KAZ", UZ: "UZB",
};

const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  // Europe
  germany: "DE", france: "FR", spain: "ES", italy: "IT", greece: "GR", denmark: "DK",
  "united kingdom": "GB", uk: "GB", england: "GB", norway: "NO", netherlands: "NL",
  portugal: "PT", poland: "PL", belgium: "BE", ireland: "IE", sweden: "SE", finland: "FI",
  switzerland: "CH", austria: "AT", "czech republic": "CZ", czechia: "CZ",
  hungary: "HU", romania: "RO", bulgaria: "BG", croatia: "HR", slovakia: "SK",
  ukraine: "UA", serbia: "RS", turkey: "TR", turkiye: "TR", iceland: "IS",
  // Americas
  "united states": "US", usa: "US", canada: "CA", mexico: "MX", brazil: "BR",
  chile: "CL", argentina: "AR", colombia: "CO", peru: "PE", uruguay: "UY",
  // Asia-Pacific
  australia: "AU", "new zealand": "NZ", china: "CN", india: "IN", japan: "JP",
  "south korea": "KR", korea: "KR", taiwan: "TW", indonesia: "ID", vietnam: "VN",
  thailand: "TH", malaysia: "MY", singapore: "SG", pakistan: "PK",
  bangladesh: "BD", philippines: "PH",
  // Middle East
  "saudi arabia": "SA", "united arab emirates": "AE", uae: "AE", qatar: "QA",
  iran: "IR", iraq: "IQ", israel: "IL", jordan: "JO", oman: "OM", kuwait: "KW",
  // Africa
  "south africa": "ZA", egypt: "EG", morocco: "MA", nigeria: "NG", kenya: "KE",
  ethiopia: "ET", tanzania: "TZ", ghana: "GH", senegal: "SN", mozambique: "MZ",
  namibia: "NA",
  // Russia / Central Asia
  russia: "RU", kazakhstan: "KZ", uzbekistan: "UZ",
  // skip-regions (no ISO2 assigned)
  europe: "", mena: "", global: "",
};

const EXCLUDED_COUNTRIES = new Set<string>([
  "ATA", // Antarctica
  "ATF", // French Southern and Antarctic Lands
]);

let catalogue: CountryMapData[] = [];
let byIso3 = new Map<string, CountryMapData>();
let loadPromise: Promise<void> | null = null;

let techOptions: WorldMapTechMeta[] = [];
const techMetaById = new Map<TechMapType, WorldMapTechMeta>();

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.statusText} at ${path}`);
  }

  return response.json() as Promise<T>;
}

async function fetchAllTechnologySummaries(): Promise<TechnologySummary[]> {
  const pageSize = 200;
  let skip = 0;
  let total = Infinity;
  const all: TechnologySummary[] = [];

  while (skip < total) {
    const page = await apiFetch<TechnologyCatalogueResponse>(
      `/technologies?skip=${skip}&limit=${pageSize}`,
    );

    total = page.total;
    all.push(...page.technologies);
    if (page.technologies.length < pageSize) break;
    skip += pageSize;
  }

  return all;
}

async function fetchTechnologyById(id: string): Promise<Technology> {
  return apiFetch<Technology>(`/technologies/${id}`);
}

async function fetchAllTechnologies(): Promise<Technology[]> {
  const summaries = await fetchAllTechnologySummaries();
  return Promise.all(summaries.map((s) => fetchTechnologyById(s.id)));
}

function categoryIcon(category: string): string {
  if (category === "generation") return "bolt";
  if (category === "storage") return "battery_charging_full";
  if (category === "transmission") return "cable";
  if (category === "conversion") return "settings";
  return "blur_on";
}

function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 68% 48%)`;
}

function isParam(param: string): param is TechMapParam {
  return ["capex", "opex_fixed", "capacity_factor", "co2_emissions"].includes(param);
}

function normalizeCarrierKey(raw: string): CarrierKey {
  if (raw === "solar_irradiance") return "solar_irradiance";
  if (raw === "wind") return "wind";
  if (raw === "water") return "water";
  return "electricity";
}

function inferYear(instance: EquipmentInstance): number {
  if (instance.reference_year != null) return instance.reference_year;

  const label = instance.label ?? "";
  const match = label.match(/(20\d{2})/);
  if (match) {
    const y = Number(match[1]);
    if (Number.isFinite(y)) return y;
  }

  const idHint = String((instance.extra as Record<string, unknown> | undefined)?.instance_id ?? "");
  const idMatch = idHint.match(/(20\d{2})/);
  if (idMatch) {
    const y = Number(idMatch[1]);
    if (Number.isFinite(y)) return y;
  }

  return 2024;
}

function valueForParam(instance: EquipmentInstance, param: TechMapParam): number | null {
  if (param === "capex") {
    return instance.capex_per_kw?.value ?? instance.capex_per_kwh?.value ?? null;
  }
  if (param === "opex_fixed") {
    return instance.opex_fixed_per_kw_yr?.value ?? null;
  }
  if (param === "capacity_factor") {
    const v = instance.capacity_factor?.value;
    if (v == null) return null;
    return v <= 1 ? v * 100 : v;
  }
  if (param === "co2_emissions") {
    const v = instance.co2_emission_factor?.value;
    if (v == null) return null;
    return v * 1000;
  }
  return null;
}

function unitForParam(instance: EquipmentInstance, param: TechMapParam): string {
  if (param === "capex") {
    if (instance.capex_per_kwh?.value != null && instance.capex_per_kw?.value == null) return "USD/kWh";
    return "USD/kW";
  }
  if (param === "opex_fixed") return "USD/kW/yr";
  if (param === "capacity_factor") return "%";
  return "g CO₂/kWh";
}

function averageByYear(points: YearPoint[]): YearPoint[] {
  const grouped = new Map<number, number[]>();
  for (const p of points) {
    if (!grouped.has(p.year)) grouped.set(p.year, []);
    grouped.get(p.year)?.push(p.value);
  }

  return [...grouped.entries()]
    .map(([year, vals]) => ({
      year,
      value: vals.reduce((a, b) => a + b, 0) / vals.length,
    }))
    .sort((a, b) => a.year - b.year);
}

function interpolate(points: YearPoint[], targetYear: MapYear): number | null {
  if (points.length === 0) return null;
  const exact = points.find((p) => p.year === targetYear);
  if (exact) return exact.value;

  if (targetYear <= points[0].year) return points[0].value;
  if (targetYear >= points[points.length - 1].year) return points[points.length - 1].value;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (targetYear > a.year && targetYear < b.year) {
      const t = (targetYear - a.year) / (b.year - a.year);
      return a.value + t * (b.value - a.value);
    }
  }

  return null;
}

function toCarrierKey(technology: Technology): CarrierKey {
  const carriers = [...(technology.input_carriers ?? []), ...(technology.output_carriers ?? [])];
  if (carriers.includes("solar_irradiance")) return "solar_irradiance";
  if (carriers.includes("wind")) return "wind";
  if (carriers.includes("water")) return "water";
  return "electricity";
}

function extractIso2FromInstance(instance: EquipmentInstance): string | null {
  const extra = (instance.extra ?? {}) as Record<string, unknown>;
  const structuredCandidates = [extra.country_iso2, extra.country_code, extra.location, extra.country];

  for (const raw of structuredCandidates) {
    if (typeof raw !== "string") continue;
    const s = raw.trim();
    const upper = s.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper) && ISO2_TO_ISO3[upper]) return upper === "UK" ? "GB" : upper;
    const byName = COUNTRY_NAME_TO_ISO2[s.toLowerCase()];
    if (typeof byName === "string" && byName) return byName;
  }

  const source =
    instance.capex_per_kw?.source
    ?? instance.opex_fixed_per_kw_yr?.source
    ?? instance.co2_emission_factor?.source
    ?? "";
  const texts = [instance.label ?? "", source];

  for (const txt of texts) {
    if (!txt) continue;

    const upperHits = txt.match(/\b[A-Z]{2}\b/g) ?? [];
    for (const token of upperHits) {
      if (ISO2_TO_ISO3[token]) return token === "UK" ? "GB" : token;
    }

    const lower = txt.toLowerCase();
    for (const [name, iso2] of Object.entries(COUNTRY_NAME_TO_ISO2)) {
      if (!iso2) continue;
      if (lower.includes(name)) return iso2;
    }
  }

  return null;
}

function normalizeText(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildSeedMatchers(seedCountries: CountrySeed[]): SeedMatcher[] {
  const list: SeedMatcher[] = [];
  for (const c of seedCountries) {
    const normalized = normalizeText(c.name);
    if (!normalized) continue;
    const tokens = [normalized];

    // Common aliases that appear in sources/instance labels.
    if (normalized === "united states") tokens.push("usa", "united states of america");
    if (normalized === "united kingdom") tokens.push("uk", "great britain", "britain");
    if (normalized === "russian federation") tokens.push("russia");
    if (normalized === "korea south") tokens.push("south korea", "republic of korea");
    if (normalized === "iran islamic republic of") tokens.push("iran");
    if (normalized === "viet nam") tokens.push("vietnam");

    const uniq = [...new Set(tokens)].filter((t) => t.length >= 3);
    if (uniq.length === 0) continue;
    list.push({ iso3: c.iso3.toUpperCase(), tokens: uniq });
  }

  list.sort((a, b) => {
    const al = Math.max(...a.tokens.map((t) => t.length));
    const bl = Math.max(...b.tokens.map((t) => t.length));
    return bl - al;
  });

  return list;
}

function extractIso3FromSeedNames(instance: EquipmentInstance, seedMatchers: SeedMatcher[]): string | null {
  const source =
    instance.capex_per_kw?.source
    ?? instance.opex_fixed_per_kw_yr?.source
    ?? instance.co2_emission_factor?.source
    ?? "";

  const texts = [normalizeText(instance.label ?? ""), normalizeText(source)];

  for (const txt of texts) {
    if (!txt) continue;
    for (const m of seedMatchers) {
      for (const token of m.tokens) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`);
        if (re.test(txt)) return m.iso3;
      }
    }
  }

  return null;
}

async function buildFallbackFromTechnologies(seedCountries: CountrySeed[]): Promise<{
  techs: WorldMapTechMeta[];
  rows: CountryMapData[];
}> {
  const allTechs = await fetchAllTechnologies();
  const seedMatchers = buildSeedMatchers(seedCountries);

  const countryNameByIso3 = new Map(seedCountries.map((c) => [c.iso3.toUpperCase(), c.name]));
  const countryValues = new Map<string, Map<string, Map<TechMapParam, YearPoint[]>>>();
  const countryUnits = new Map<string, Map<string, Map<TechMapParam, string>>>();

  const techUsed = new Set<string>();
  const techParamSet = new Map<string, Set<TechMapParam>>();
  const techCarrier = new Map<string, CarrierKey>();
  const techLabel = new Map<string, { label: string; category: string }>();

  const params: TechMapParam[] = ["capex", "opex_fixed", "capacity_factor", "co2_emissions"];

  for (const tech of allTechs) {
    techCarrier.set(tech.id, toCarrierKey(tech));
    techLabel.set(tech.id, { label: tech.name, category: tech.category });

    for (const instance of tech.instances ?? []) {
      const iso2 = extractIso2FromInstance(instance);
      let iso3 = iso2 ? ISO2_TO_ISO3[iso2] : undefined;
      if (!iso3) iso3 = extractIso3FromSeedNames(instance, seedMatchers) ?? undefined;
      if (!iso3 || EXCLUDED_COUNTRIES.has(iso3)) continue;

      const y = inferYear(instance);

      if (!countryValues.has(iso3)) countryValues.set(iso3, new Map());
      if (!countryUnits.has(iso3)) countryUnits.set(iso3, new Map());
      if (!countryValues.get(iso3)?.has(tech.id)) countryValues.get(iso3)?.set(tech.id, new Map());
      if (!countryUnits.get(iso3)?.has(tech.id)) countryUnits.get(iso3)?.set(tech.id, new Map());

      for (const p of params) {
        const v = valueForParam(instance, p);
        if (v == null || !Number.isFinite(v)) continue;

        techUsed.add(tech.id);
        if (!techParamSet.has(tech.id)) techParamSet.set(tech.id, new Set());
        techParamSet.get(tech.id)?.add(p);

        const mapByParam = countryValues.get(iso3)?.get(tech.id);
        if (!mapByParam?.has(p)) mapByParam?.set(p, []);
        mapByParam?.get(p)?.push({ year: y, value: v });

        countryUnits.get(iso3)?.get(tech.id)?.set(p, unitForParam(instance, p));
      }
    }
  }

  const techs: WorldMapTechMeta[] = [];
  for (const techId of techUsed) {
    const labelMeta = techLabel.get(techId);
    if (!labelMeta) continue;
    const available = [...(techParamSet.get(techId) ?? new Set())];
    if (available.length === 0) continue;
    techs.push({
      id: techId,
      label: labelMeta.label,
      category: labelMeta.category,
      icon: categoryIcon(labelMeta.category),
      color: colorFromId(techId),
      carrierKey: techCarrier.get(techId) ?? "electricity",
      availableParams: available,
    });
  }
  techs.sort((a, b) => a.label.localeCompare(b.label));

  const rows: CountryMapData[] = [];
  for (const [iso3, techMap] of countryValues.entries()) {
    const entries: CountryTechSeries[] = [];

    for (const [techId, paramMap] of techMap.entries()) {
      for (const [param, points] of paramMap.entries()) {
        const anchors = averageByYear(points);
        if (anchors.length === 0) continue;

        const series: YearPoint[] = [];
        for (const y of MAP_YEARS) {
          const v = interpolate(anchors, y);
          if (v == null || !Number.isFinite(v)) continue;
          series.push({ year: y, value: v });
        }
        if (series.length === 0) continue;

        const unit = countryUnits.get(iso3)?.get(techId)?.get(param) ?? "";
        entries.push({ tech: techId, param, unit, series });
      }
    }

    if (entries.length === 0) continue;

    rows.push({
      iso2: Object.keys(ISO2_TO_ISO3).find((k) => ISO2_TO_ISO3[k] === iso3 && k !== "UK") ?? "",
      iso3,
      name: countryNameByIso3.get(iso3) ?? iso3,
      region: "Direct country records",
      coverage: "direct",
      entries,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { techs, rows };
}

function mapApiCountry(country: WorldMapApiCountry): CountryMapData {
  const entries: CountryTechSeries[] = [];
  for (const e of country.entries) {
    if (!isParam(e.param)) continue;
    const series = (e.series ?? [])
      .filter((p) => Number.isFinite(p.year) && Number.isFinite(p.value))
      .map((p) => ({ year: p.year, value: p.value }))
      .sort((a, b) => a.year - b.year);

    if (series.length === 0) continue;
    entries.push({
      tech: e.tech,
      param: e.param,
      unit: e.unit,
      series,
    });
  }

  return {
    iso2: (country.iso2 ?? "").toUpperCase(),
    iso3: (country.iso3 ?? "").toUpperCase(),
    name: country.name,
    region: entries.length > 0 ? "Direct country records" : "No country data coverage",
    coverage: entries.length > 0 ? "direct" : "none",
    entries,
  };
}

export async function ensureWorldMapCatalogue(countries: CountrySeed[]): Promise<void> {
  const hasUsableCache = catalogue.length > 0 && techOptions.length > 0;
  if (hasUsableCache) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let worldMapPayload: WorldMapApiResponse | null = null;

    try {
      worldMapPayload = await apiFetch<WorldMapApiResponse>("/technologies/worldmap/country-values");
    } catch {
      worldMapPayload = null;
    }

    let builtTechOptions: WorldMapTechMeta[] = [];
    let rows: CountryMapData[] = [];

    if (worldMapPayload && Array.isArray(worldMapPayload.technologies) && (worldMapPayload.countries?.length ?? 0) > 0) {
      for (const t of worldMapPayload.technologies) {
        const availableParams = (t.available_params ?? []).filter(isParam);
        if (availableParams.length === 0) continue;

        const meta: WorldMapTechMeta = {
          id: t.id,
          label: t.label,
          category: t.category,
          icon: categoryIcon(t.category),
          color: colorFromId(t.id),
          carrierKey: normalizeCarrierKey(t.carrier_key),
          availableParams,
        };
        builtTechOptions.push(meta);
        techMetaById.set(meta.id, meta);
      }
      rows = (worldMapPayload.countries ?? [])
        .map((c) => mapApiCountry(c))
        .filter((c) => c.entries.length > 0 && !EXCLUDED_COUNTRIES.has(c.iso3));
    } else {
      const fallback = await buildFallbackFromTechnologies(countries);
      builtTechOptions = fallback.techs;
      rows = fallback.rows;
      for (const meta of builtTechOptions) techMetaById.set(meta.id, meta);
    }

    builtTechOptions.sort((a, b) => a.label.localeCompare(b.label));
    techOptions = builtTechOptions;

    catalogue = rows;
    byIso3 = new Map(rows.map((c) => [c.iso3, c]));
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function getWorldMapTechnologies(): WorldMapTechMeta[] {
  return techOptions;
}

export function getTechnologyMeta(tech: TechMapType): WorldMapTechMeta | undefined {
  return techMetaById.get(tech);
}

export function getCountryByIso3(iso3: string): CountryMapData | undefined {
  return byIso3.get(iso3);
}

export function getWorldMapCountries(): CountryMapData[] {
  return catalogue;
}

export function getParamValues(
  tech: TechMapType,
  param: TechMapParam,
  year: number,
): Map<string, number> {
  const result = new Map<string, number>();

  for (const country of catalogue) {
    const entry = country.entries.find((e) => e.tech === tech && e.param === param);
    if (!entry) continue;

    const point = entry.series.find((p) => p.year === year);
    if (!point || !Number.isFinite(point.value)) continue;

    result.set(country.iso3, point.value);
  }

  return result;
}

export function getGlobalRange(
  tech: TechMapType,
  param: TechMapParam,
): [number, number] {
  let min = Infinity;
  let max = -Infinity;

  for (const country of catalogue) {
    const entry = country.entries.find((e) => e.tech === tech && e.param === param);
    if (!entry) continue;

    for (const point of entry.series) {
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  return [min, max];
}
