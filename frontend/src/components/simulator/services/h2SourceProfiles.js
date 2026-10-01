const safeN = (value) => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function detectSourceTechType(model) {
  if (!model) return "generic";
  const key = `${model.id ?? ""} ${model.name ?? ""}`.toLowerCase();
  if (/solar|pv|photovoltaic/.test(key)) return "solar";
  if (/wind/.test(key)) return "wind";
  if (/nuclear|pwr|bwr|smr/.test(key)) return "nuclear";
  if (/hydro|water|river|dam/.test(key)) return "hydro";
  if (/geotherm/.test(key)) return "geothermal";
  if (/biomass|biogas|bio/.test(key)) return "biomass";
  if (/coal|lignite/.test(key)) return "coal";
  if (/gas|ccgt|ocgt|lng|methane/.test(key)) return "gas";
  return "generic";
}

export function buildTheoreticalSourceProfile(techType, capacityKw, tEndS = 86400, dtS = 1800) {
  const cap = safeN(capacityKw);
  const dt = Math.max(60, safeN(dtS) ?? 1800);
  const horizon = Math.max(0, safeN(tEndS) ?? 86400);
  if (!cap || cap <= 0) return [];

  const points = [];
  for (let time_s = 0; time_s <= horizon; time_s += dt) {
    const h = (time_s / 3600) % 24;
    let frac;
    switch (techType) {
      case "solar": {
        const raw = Math.exp(-0.5 * ((h - 12.5) / 2.4) ** 2);
        frac = h < 5.5 || h > 19.5 ? 0 : raw;
        break;
      }
      case "wind":
        frac = Math.min(1, Math.max(0,
          0.38 + 0.18 * Math.sin(h * 0.65 + 1.2)
               + 0.12 * Math.sin(h * 1.7 + 0.5)
               + 0.07 * Math.sin(h * 3.1 + 2.0)));
        break;
      case "nuclear":
      case "geothermal":
        frac = 0.90 + 0.015 * Math.sin((h / 24) * 2 * Math.PI);
        break;
      case "coal":
      case "biomass":
        frac = (h >= 7 && h < 22 ? 0.82 : 0.55) + 0.03 * Math.sin(h * 0.9);
        break;
      case "gas":
        frac = Math.min(1, Math.max(0.15,
          0.45 + 0.25 * Math.sin(((h - 6) / 24) * 2 * Math.PI) + 0.08 * Math.sin(h * 2.1)));
        break;
      case "hydro": {
        const morn = 0.55 * Math.exp(-0.5 * ((h - 8) / 2.2) ** 2);
        const eve = 0.65 * Math.exp(-0.5 * ((h - 19) / 2.5) ** 2);
        frac = Math.min(1, Math.max(0.15, morn + eve + 0.18));
        break;
      }
      default:
        frac = 0.75;
    }
    points.push({ time_s, power_kw: Math.round(frac * cap) });
  }
  return points;
}

function unwrapProfileCandidate(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return unwrapProfileCandidate(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.points)) return raw.points;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.values)) return raw.values;
  if (Array.isArray(raw.profile)) return raw.profile;
  return null;
}

function candidateProfiles(entity) {
  if (!entity || typeof entity !== "object") return [];
  const buckets = [entity, entity.profile_source, entity.timeseries, entity.timeSeries, entity.defaults, entity.parameters, entity.specs, entity.technical_specifications, entity._raw];
  const keys = [
    "profile",
    "generation_profile",
    "power_profile",
    "hourly_profile",
    "resource_profile",
    "capacity_factor_profile",
    "timeseries_profile",
    "generation_timeseries",
  ];
  const candidates = [];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const key of keys) {
      const value = unwrapProfileCandidate(bucket[key]);
      if (Array.isArray(value) && value.length) candidates.push(value);
    }
  }
  return candidates;
}

function normaliseTemplatePoints(rawPoints) {
  if (!Array.isArray(rawPoints) || !rawPoints.length) return [];

  if (rawPoints.every((point) => typeof point === "number" || typeof point === "string")) {
    return rawPoints.map((point, index) => {
      const value = safeN(point) ?? 0;
      return {
        idx: index,
        time_s: null,
        power_kw: value > 1 ? value : null,
        cf: value >= 0 && value <= 1 ? value : null,
      };
    });
  }

  return rawPoints
    .map((point, index) => {
      if (point == null) return null;
      if (typeof point !== "object") {
        const value = safeN(point) ?? 0;
        return {
          idx: index,
          time_s: null,
          power_kw: value > 1 ? value : null,
          cf: value >= 0 && value <= 1 ? value : null,
        };
      }

      const time_s =
        safeN(point.time_s)
        ?? (safeN(point.time_h) != null ? safeN(point.time_h) * 3600 : null)
        ?? (safeN(point.hour) != null ? safeN(point.hour) * 3600 : null)
        ?? (safeN(point.timestep) != null ? safeN(point.timestep) * 3600 : null)
        ?? null;

      const power_kw =
        safeN(point.power_kw)
        ?? safeN(point.value_kw)
        ?? safeN(point.power)
        ?? safeN(point.output_kw)
        ?? safeN(point.generation_kw)
        ?? null;

      const cf =
        safeN(point.capacity_factor)
        ?? safeN(point.cf)
        ?? safeN(point.value)
        ?? safeN(point.per_unit)
        ?? null;

      return {
        idx: index,
        time_s,
        power_kw,
        cf: power_kw == null && cf != null ? cf : null,
      };
    })
    .filter(Boolean);
}

function describeTemplate(templatePoints) {
  const points = normaliseTemplatePoints(templatePoints);
  if (!points.length) {
    return {
      points: [],
      sorted: [],
      explicitTime: false,
      inferredStep: Number.POSITIVE_INFINITY,
      coverageSeconds: 0,
      kind: "empty",
    };
  }

  const explicitTime = points.some((point) => point.time_s != null);
  const sorted = points
    .map((point, index) => ({
      ...point,
      time_s: point.time_s ?? index * ((24 * 3600) / Math.max(points.length, 1)),
    }))
    .sort((a, b) => a.time_s - b.time_s);

  const inferredStep = sorted.length > 1
    ? sorted.slice(1).reduce((min, point, index) => {
        const diff = point.time_s - sorted[index].time_s;
        return diff > 0 ? Math.min(min, diff) : min;
      }, Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;

  const fallbackStep = Number.isFinite(inferredStep) ? inferredStep : 3600;
  const coverageSeconds = (sorted.at(-1)?.time_s ?? 0) + fallbackStep;

  let kind = "generic_series";
  if (!explicitTime && sorted.length >= 8760) {
    kind = "annual_series";
  } else if (coverageSeconds <= 36 * 3600 || (!explicitTime && sorted.length <= 96)) {
    kind = "daily_template";
  } else if (coverageSeconds >= 300 * 24 * 3600 || sorted.length >= 8760) {
    kind = "annual_series";
  }

  return {
    points,
    sorted,
    explicitTime,
    inferredStep,
    coverageSeconds,
    kind,
  };
}

function pickTemplatePoint(sorted, localTime) {
  if (!sorted.length) return null;
  let index = 0;
  while (index + 1 < sorted.length && sorted[index + 1].time_s <= localTime) index += 1;
  return sorted[index];
}

function seasonalScale(techType, dayIndex, totalDays) {
  const phase = totalDays > 1 ? dayIndex / totalDays : 0;
  switch (techType) {
    case "solar":
      return Math.max(0.18, 0.62 + 0.38 * Math.sin((phase - 0.22) * 2 * Math.PI));
    case "wind":
      return 0.95 + 0.12 * Math.cos((phase - 0.05) * 2 * Math.PI);
    case "hydro":
      return 0.9 + 0.18 * Math.sin((phase - 0.30) * 2 * Math.PI);
    case "geothermal":
    case "nuclear":
      return 1;
    case "coal":
    case "gas":
    case "biomass":
      return 0.98 + 0.03 * Math.sin((phase + 0.10) * 2 * Math.PI);
    default:
      return 1;
  }
}

function materialiseDailyTemplate(sorted, capacityKw, tEndS, dtS, techType, coverageSeconds, inferredStep) {
  const cap = safeN(capacityKw);
  const dt = Math.max(60, safeN(dtS) ?? 1800);
  const horizon = Math.max(0, safeN(tEndS) ?? 86400);
  const cycle = coverageSeconds > 0 ? coverageSeconds : 24 * 3600;
  const totalDays = Math.max(1, Math.ceil((horizon + dt) / (24 * 3600)));
  const out = [];

  for (let time_s = 0; time_s <= horizon; time_s += dt) {
    const localTime = cycle > 0 ? time_s % cycle : time_s;
    const templatePoint = pickTemplatePoint(sorted, localTime) ?? sorted[0];
    const dayIndex = Math.floor(time_s / (24 * 3600));
    const scale = seasonalScale(techType, dayIndex, totalDays);
    const basePower = templatePoint.power_kw != null
      ? templatePoint.power_kw
      : Math.round((safeN(templatePoint.cf) ?? 0) * (cap ?? 0));
    out.push({
      time_s,
      power_kw: Math.max(0, Math.round((safeN(basePower) ?? 0) * scale)),
    });
  }

  return out;
}

function materialiseSeries(sorted, capacityKw, tEndS, dtS) {
  const cap = safeN(capacityKw);
  const dt = Math.max(60, safeN(dtS) ?? 1800);
  const horizon = Math.max(0, safeN(tEndS) ?? 86400);
  const output = [];
  for (let time_s = 0; time_s <= horizon; time_s += dt) {
    const point = pickTemplatePoint(sorted, time_s) ?? sorted.at(-1) ?? sorted[0];
    const power_kw = point.power_kw != null
      ? point.power_kw
      : Math.round((safeN(point.cf) ?? 0) * (cap ?? 0));
    output.push({ time_s, power_kw: Math.max(0, safeN(power_kw) ?? 0) });
  }
  return output;
}

function materialiseTemplate(templatePoints, capacityKw, tEndS, dtS, techType) {
  const template = describeTemplate(templatePoints);
  if (!template.sorted.length) return [];

  if (template.kind === "daily_template") {
    return materialiseDailyTemplate(
      template.sorted,
      capacityKw,
      tEndS,
      dtS,
      techType,
      template.coverageSeconds,
      template.inferredStep,
    );
  }

  return materialiseSeries(template.sorted, capacityKw, tEndS, dtS);
}

export function extractDefinedSourceProfile(entity) {
  for (const candidate of candidateProfiles(entity)) {
    const template = describeTemplate(candidate);
    if (template.points.length) {
      return {
        points: candidate,
        kind: template.kind,
        coverageSeconds: template.coverageSeconds,
      };
    }
  }
  return null;
}

export function resolveSourceProfile({
  customProfile = null,
  sourceVariant = null,
  sourceModel = null,
  capacityKw = null,
  tEndS = 86400,
  dtS = 1800,
}) {
  const customPoints = customProfile?.data;
  if (Array.isArray(customPoints) && customPoints.length) {
    return customPoints.map((pt) => ({
      time_s: safeN(pt?.time_s) ?? Math.round((safeN(pt?.time_h) ?? 0) * 3600),
      power_kw: Math.max(0, safeN(pt?.power_kw) ?? safeN(pt?.value_kw) ?? 0),
    }));
  }

  const template = extractDefinedSourceProfile(sourceVariant) ?? extractDefinedSourceProfile(sourceModel);
  if (template) {
    const resolved = materialiseTemplate(
      template.points,
      capacityKw,
      tEndS,
      dtS,
      detectSourceTechType(sourceVariant ?? sourceModel),
    );
    if (resolved.length) return resolved;
  }

  return buildTheoreticalSourceProfile(
    detectSourceTechType(sourceVariant ?? sourceModel),
    capacityKw,
    tEndS,
    dtS,
  );
}

export function buildDisplaySourceProfile({
  customProfile = null,
  sourceVariant = null,
  sourceModel = null,
  capacityKw = null,
  dtS = 1800,
}) {
  const points = resolveSourceProfile({
    customProfile,
    sourceVariant,
    sourceModel,
    capacityKw,
    tEndS: 24 * 3600 - dtS,
    dtS,
  });

  const labels = points.map((point) => {
    const h = Math.floor(point.time_s / 3600);
    const m = Math.floor((point.time_s % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });

  const fullKw = points.map((point) => point.power_kw ?? 0);
  const peakKw = fullKw.length ? Math.max(...fullKw) : 0;
  const avgKw = fullKw.length ? fullKw.reduce((sum, value) => sum + value, 0) / fullKw.length : 0;
  const avgCF = capacityKw && capacityKw > 0 ? avgKw / capacityKw : 0;

  return {
    labels,
    fracs: capacityKw && capacityKw > 0 ? fullKw.map((value) => value / capacityKw) : fullKw.map(() => 0),
    fullKw,
    avgCF,
    peakKw,
  };
}