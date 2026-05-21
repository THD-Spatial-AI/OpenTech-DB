/**
 * components/TechCard.tsx
 * ────────────────────────
 * A single technology card in the grid.
 *
 * Receives a TechnologySummary (the lightweight object returned by the
 * category list endpoint).  Full instance data is only loaded in the
 * DetailsModal, which calls the individual technology endpoint.
 *
 * Design: "Kinetic Monolith" — grayscale hero image that desaturates
 * on hover, tonal depth (no border lines), Space Grotesk numbers.
 */

import { memo } from "react";
import type { TechnologyCategory, TechnologySummary } from "../types/api";

// ── Category → human-readable carrier chip colour ────────────────────────────

const CATEGORY_CHIP: Record<TechnologyCategory, { label: string; className: string }> = {
  generation:   { label: "Generation",   className: "text-primary" },
  storage:      { label: "Storage",      className: "text-secondary" },
  conversion:   { label: "Conversion",   className: "text-on-surface-variant" },
  transmission: { label: "Transmission", className: "text-tertiary" },
};

// ── Hero image map (public/img/) ──────────────────────────────────────────────

const TECH_IMAGES: Record<string, string> = {
  // ── Generation ──────────────────────────────────────────────────────────
  solar_pv_utility:           "/img/solar_utility.jpg",
  solar_pv_distributed:       "/img/solar_utility.jpg",
  solar_pv_balcony:           "/img/solar_balcony.jpg",
  csp:                        "/img/csp.jpg",
  onshore_wind:               "/img/onshore_wind.jpg",
  offshore_wind_fixed:        "/img/offshore_wind.jpg",
  offshore_wind_floating:     "/img/offshore_wind.jpg",
  hydro_run_of_river:         "/img/hydro_runofriver.jpg",
  hydro_reservoir:            "/img/hydro_reservoir.jpg",
  ccgt:                       "/img/ccgt.jpg",
  ocgt:                       "/img/ccgt.jpg",
  internal_combustion_engine: "/img/internal_comb_engine.jpg",
  coal_power_plant:           "/img/coal.jpg",
  nuclear_conventional:       "/img/nuclear.jpg",
  smr:                        "/img/modular_reactors.jpg",
  geothermal_power:           "/img/geothermal.jpg",
  biomass_power_plant:        "/img/biomass.jpg",
  biogas_power_plant:         "/img/biogas.jpg",
  waste_to_energy:            "/img/waste_to_energy.jpg",
  marine_energy:              "/img/marine_energy.jpg",

  // ── Storage ─────────────────────────────────────────────────────────────
  lithium_ion_bess:            "/img/lithium_ion.jpg",
  redox_flow_batteries:        "/img/redox_flow.png",
  sodium_sulfur_batteries:     "/img/sodium_sulfur.jpg",
  lead_acid_batteries:         "/img/lead_acid.jpg",
  pumped_hydro_storage:        "/img/pumped_hydro.jpg",
  caes:                        "/img/compressed_air.jpg",
  laes:                        "/img/liquid_air.jpg",
  flywheels:                   "/img/flywheel.jpg",
  sensible_thermal_storage:    "/img/sensible_thermal.png",
  latent_thermal_storage:      "/img/sensible_thermal.png",
  hydrogen_storage_tanks:      "/img/hydrogen_storage.jpg",
  hydrogen_underground_storage:"/img/hydrogen_underground.jpg",

  // ── Conversion ──────────────────────────────────────────────────────────
  alkaline_electrolyzer_awe:   "/img/alkaline_electrolyzer.jpg",
  pem_electrolyzer:            "/img/pem_electrolyzer.jpg",
  soec_electrolyzer:           "/img/soec_electrolyzer.jpg",
  pem_fuel_cell:               "/img/pem_electrolyzer.jpg",
  sofc_fuel_cell:              "/img/soec_electrolyzer.jpg",
  air_source_heat_pump:        "/img/air_source_heat_pump.jpg",
  ground_source_heat_pump:     "/img/ground_heat_pump.jpg",
  electric_boilers:            "/img/electric_boiler.jpg",
  chp_gas:                     "/img/chp_gas.jpg",
  biomass_chp:                 "/img/biomass.jpg",
  methanation_reactors:        "/img/methanation_reactor.jpg",
  fischer_tropsch_synthesis:   "/img/fischer_tropsch.jpg",
  haber_bosch_process:         "/img/haber_bosch.jpg",
  direct_air_capture:          "/img/direct_air_capture.jpg",
  carbon_capture_systems:      "/img/carbon_capture.jpg",
  gas_boiler:                  "/img/gas_boiler.jpg",
  biomass_gasification:        "/img/biomass_gasification.jpg",

  // ── Transmission ────────────────────────────────────────────────────────
  hvac_overhead_lines:                 "/img/hvac_overhead.jpg",
  hvdc_overhead_lines:                 "/img/hvdc_overhead.jpg",
  hvac_underground_cables:             "/img/hvac_underground.jpg",
  hvdc_subsea_cables:                  "/img/hvdc_subsea.jpg",
  transmission_transformers:           "/img/transmission_transformer.jpg",
  distribution_transformers:           "/img/distribution_transformer.jpg",
  natural_gas_pipelines:               "/img/natural_gas_pipeline.jpg",
  hydrogen_pipelines:                  "/img/hydrogen_pipeline.jpg",
  co2_pipelines:                       "/img/co2_pipeline.jpg",
  district_heating_networks:           "/img/district_heating.jpg",
  district_cooling_pipeline:           "/img/district_cooling.jpg",
  hydrogen_tube_trailer:               "/img/hydrogen_tube_trailer.jpg",
  biogas_pipeline:                     "/img/biogas_pipeline.jpg",
  biomass_truck_transport:             "/img/biomass_truck_rail.jpg",
  biomass_rail_transport:              "/img/biomass_truck_rail.jpg",
  oil_pipeline:                        "/img/oil_pipeline.jpg",
  fuel_tanker_truck:                   "/img/oil_pipeline.jpg",
  water_pipeline:                      "/img/water_pipeline.jpg",
  steam_network:                       "/img/steam_network.jpg",
  industrial_process_heat_networks:    "/img/industrial_process_heat.jpg",
  geothermal_heat_networks:            "/img/geothermal_heat_distribution.jpg",
  heat_network_substations:            "/img/heat_network_substation.jpg",
  mv_distribution_cables:              "/img/mv_lv_distribution_cables.jpg",
  lv_distribution_cables:              "/img/mv_lv_distribution_cables.jpg",
  hv_mv_substations:                   "/img/hv_mv_substation.jpg",
  mv_lv_secondary_substations:         "/img/mv_lv_secondary_substation.jpg",
  statcom:                             "/img/statcom.jpg",
  svc:                                 "/img/svc.jpg",
  hvdc_converter_station:              "/img/hvdc_converter_station.jpg",
  hv_switchgear:                       "/img/high_voltage_switchgear.jpg",
};

function heroSrc(slug: string | null): string {
  return (slug && TECH_IMAGES[slug]) ?? "/img/solar_utility.jpg";
}

// ── OEO class short display ───────────────────────────────────────────────────

function shortOeo(oeoClass: string | null): string {
  if (!oeoClass) return "—";
  // Strip "OEO_" prefix for a cleaner display
  return oeoClass.replace(/^OEO_/, "");
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TechCardProps {
  tech: TechnologySummary;
  onOpen: (tech: TechnologySummary) => void;
}

const TechCard = memo(function TechCard({ tech, onOpen }: TechCardProps) {
  const chip = CATEGORY_CHIP[tech.category] ?? CATEGORY_CHIP.generation;

  return (
    <article
      className="group bg-surface-container-lowest flex flex-col h-full rounded-xl
                 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5"
    >
      {/* Hero image */}
      <div className="h-48 overflow-hidden rounded-t-xl relative">
        <img
          src={heroSrc(tech.slug)}
          alt={tech.name}
          loading="lazy"
          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
        />

        {/* Category chip */}
        <div className="absolute top-4 left-4">
          <span className={`bg-surface-container-lowest/90 backdrop-blur px-3 py-1
                            text-[10px] font-bold uppercase tracking-widest rounded-full shadow-sm
                            ${chip.className}`}>
            {chip.label}
          </span>
        </div>

        {/* Instance count badge */}
        <div className="absolute top-4 right-4">
          <span className="bg-surface-container-lowest/90 backdrop-blur pl-2 pr-2.5 py-1
                           text-[10px] font-bold uppercase tracking-widest text-on-surface-variant
                           rounded-full shadow-sm flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[13px]">dataset</span>
            {tech.n_instances} instances
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 flex flex-col flex-grow">
        <div className="flex justify-between items-start mb-3">
          <h3 className="font-headline text-xl font-bold text-on-surface leading-tight">
            {tech.name}
          </h3>
          {tech.oeo_uri && (
            <a
              href={tech.oeo_uri}
              target="_blank"
              rel="noopener noreferrer"
              title="View OEO class"
              aria-label={`OEO ontology link for ${tech.name}`}
              className="text-on-surface-variant hover:text-primary transition-colors flex-shrink-0"
            >
              <span className="material-symbols-outlined text-lg">account_tree</span>
            </a>
          )}
        </div>

        {/* OEO class display */}
        {tech.oeo_class && (
          <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-4">
            OEO: {shortOeo(tech.oeo_class)}
          </p>
        )}

        {/* Metrics grid + CTA */}
        <div className="mt-auto pt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 pb-4">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">
                Instances
              </span>
              <span className="font-headline font-bold text-lg">{tech.n_instances}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">
                Domain
              </span>
              <span className="font-headline font-bold text-lg capitalize">{tech.category}</span>
            </div>
          </div>

          <button
            onClick={() => onOpen(tech)}
            aria-label={`View parameters for ${tech.name}`}
            className="technical-gradient text-on-primary w-full py-3 text-sm font-bold rounded-lg
                       flex items-center justify-center gap-2
                       group-hover:shadow-lg group-hover:shadow-primary/20 transition-all
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined text-sm">analytics</span>
            View Parameters
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </article>
  );
});
export default TechCard;

