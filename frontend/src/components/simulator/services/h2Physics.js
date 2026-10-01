/**
 * h2Physics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Local physics simulation engine for the H₂ Plant Digital Twin.
 *
 * Simulates the full hydrogen value chain step-by-step:
 *
 *   Source (PV / Wind / …)
 *      ↓  P_source [kW]
 *   Electrolyzer
 *      ↓  H₂ production [Nm³/h]
 *   Compressor
 *      ↓  compressed H₂ → Tank
 *   Storage Tank
 *      ↓  H₂ withdrawn on demand
 *   Fuel Cell
 *      ↓  P_fc [kW] electrical output
 *
 * Used when the simulation back-end is not reachable (offline / no connection).
 * When simulation service IS reachable its result takes precedence.
 *
 * Physical constants
 * ──────────────────
 *   E_H2_HHV    = 3.542 kWh/Nm³  (H₂ Higher Heating Value at STP)
 *   ρ_H2        = 0.0899 kg/Nm³  (H₂ density at STP)
 *   LHV_H2_kwh_kg = 33.33 kWh/kg
 *   R_H2        = 4.124 kJ/(kg·K) (specific gas constant for H₂)
 *   γ_H2        = 1.4              (adiabatic index)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const E_H2_HHV_KWH_NM3   = 3.542;   // kWh per Nm³ H₂ (HHV, STP)
const RHO_H2_KG_NM3      = 0.0899;  // kg per Nm³ at STP
const LHV_H2_KWH_KG      = 33.33;   // kWh/kg (LHV)
const R_H2_KJ_KG_K       = 4.124;   // kJ/(kg·K)
const GAMMA_H2            = 1.4;     // adiabatic index for H₂
const T_COMP_INLET_K      = 303;     // 30 °C inlet temperature for compressor

/**
 * Isentropic compressor specific work [kJ/kg]
 * Uses polytropic model:  W = (R × T_in / η) × (γ/(γ-1)) × [(p2/p1)^((γ-1)/γ) – 1]
 */
function compressorSpecificWork_kJ_kg(p_in_bar, p_out_bar, eta_isentropic) {
  if (p_out_bar <= p_in_bar) return 0;
  const n   = GAMMA_H2;
  const exp = (n - 1) / n;
  return (R_H2_KJ_KG_K * T_COMP_INLET_K / eta_isentropic)
       * (n / (n - 1))
       * (Math.pow(p_out_bar / p_in_bar, exp) - 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main simulation function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the local H₂ chain physics simulation.
 *
 * @param {object} payload  – built by buildSimPayload() from h2SimPayload.js
 * @returns {object}        – result object with flat key layout expected by charts
 *                            + `kpi` block + `_local: true` flag
 */
export function simulateH2Chain(payload) {
  const { simulation, source, electrolyzer, compressor, storage, fuel_cell } = payload;

  const dt_s  = simulation.dt_s  ?? 60;
  const dt_h  = dt_s / 3600;                    // hours per step
  const profile = source.profile ?? [];
  const N     = profile.length;

  if (N === 0) return _emptyResult(dt_s);

  // ── Device parameters ──────────────────────────────────────────────────────

  // Source
  const src_cap_kw = source.capacity_kw ?? Math.max(...profile.map((p) => p.power_kw));

  // Electrolyzer
  const elz_cap_kw  = electrolyzer.capacity_kw ?? src_cap_kw;
  const elz_eta     = (electrolyzer.nominal_efficiency_pct_hhv ?? 70) / 100;
  const elz_min_kw  = (electrolyzer.min_load_pct ?? 10) / 100 * elz_cap_kw;
  // H₂ production rate at rated power [Nm³/h]
  const elz_h2_rated_nm3h = (elz_cap_kw * elz_eta) / E_H2_HHV_KWH_NM3;

  // Compressor
  const comp_eta    = compressor.isentropic_efficiency_frac ?? 0.78;
  const p_inlet_bar = compressor.inlet_pressure_bar  ?? 30;
  const p_tank_bar  = compressor.target_pressure_bar ?? storage.max_pressure_bar ?? 350;
  const w_comp_kj_kg = compressorSpecificWork_kJ_kg(p_inlet_bar, p_tank_bar, comp_eta);
  // kW = kg/s × kJ/kg   →   kW per (Nm³/h) = (Nm³/h × ρ_H2 / 3600) × w_comp
  const comp_kw_per_nm3h = (RHO_H2_KG_NM3 / 3600) * w_comp_kj_kg;

  // Storage
  const tank_p_min    = storage.min_pressure_bar ?? 20;
  const tank_p_max    = p_tank_bar;
  const tank_init_soc = (storage.initial_soc_pct ?? 20) / 100;

  // Estimate tank H₂ capacity [Nm³]:
  // Tank is sized so ELZ at rated output fills it in ~4 h (reasonable industrial sizing).
  const tank_cap_nm3 = Math.max(elz_h2_rated_nm3h * 4, 50);

  // Fuel Cell
  const fc_cap_kw   = fuel_cell.rated_power_kw  ?? (elz_cap_kw * 0.4);
  const fc_eta      = (fuel_cell.nominal_efficiency_pct ?? 58) / 100;
  const fc_min_kw   = (fuel_cell.min_load_pct ?? 10) / 100 * fc_cap_kw;
  // H₂ consumption to produce 1 kW of FC power [Nm³/h]
  const fc_h2_per_kw = 1 / (fc_eta * E_H2_HHV_KWH_NM3);

  // ── State ───────────────────────────────────────────────────────────────────
  let h2_stored_nm3 = tank_init_soc * tank_cap_nm3;  // current H₂ in tank [Nm³]

  // ── Output arrays ────────────────────────────────────────────────────────────
  const time_s              = [];
  const source_power_kw_arr = [];
  const elz_power_kw_arr    = [];
  const h2_prod_nm3h_arr    = [];
  const h2_prod_kg_h_arr    = [];
  const elz_eff_pct_arr     = [];
  const comp_power_kw_arr   = [];
  const tank_pressure_arr   = [];
  const tank_soc_pct_arr    = [];
  const h2_mass_kg_arr      = [];
  const fc_power_kw_arr     = [];
  const h2_cons_nm3h_arr    = [];
  const fc_eff_pct_arr      = [];

  // ── Simulation loop ──────────────────────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const pt = profile[i];
    const t  = pt.time_s ?? i * dt_s;
    const p_src = Math.max(0, pt.power_kw ?? 0);

    // ── 1. Electrolyzer ───────────────────────────────────────────────────────
    // Consume available source power, capped by rated capacity.
    // Apply minimum load: if power < min_load → ELZ off (cold standby).
    let p_elz = Math.min(p_src, elz_cap_kw);
    if (p_elz < elz_min_kw) p_elz = 0;

    // H₂ production is proportional to AC input (simplified linear model).
    // Real stacks have a slightly non-linear specific consumption curve; the
    // efficiency is treated as roughly constant here (acceptable for planning).
    const h2_prod_nm3h = p_elz > 0 ? (p_elz * elz_eta) / E_H2_HHV_KWH_NM3 : 0;
    const h2_prod_kg_h = h2_prod_nm3h * RHO_H2_KG_NM3;

    // Instantaneous efficiency (same as rated for linear model — shows >0 when running)
    const elz_eff_pct = p_elz > 0 ? elz_eta * 100 : 0;

    // ── 2. Compressor ─────────────────────────────────────────────────────────
    // Power is proportional to H₂ mass flow rate.
    const p_comp = h2_prod_nm3h * comp_kw_per_nm3h;

    // ── 3. Storage — FILL ────────────────────────────────────────────────────
    // H₂ produced this step [Nm³]
    const h2_in_nm3 = h2_prod_nm3h * dt_h;

    // ── 4. Fuel Cell dispatch strategy ───────────────────────────────────────
    // Simple rule: run FC when tank SOC > 20 %.
    // Target: run at rated power; curtail if tank can't supply enough H₂.
    let p_fc     = 0;
    let h2_cons_nm3h = 0;
    const current_soc = h2_stored_nm3 / tank_cap_nm3;

    if (fc_cap_kw > 0 && current_soc > 0.20) {
      // Desired FC power scales with how full the tank is (prevents rapid cycling)
      const desired_p = Math.min(fc_cap_kw, fc_cap_kw * Math.min(current_soc * 2, 1));
      if (desired_p >= fc_min_kw) {
        // H₂ needed to sustain desired power
        const h2_needed_nm3h = desired_p * fc_h2_per_kw;
        // Clamp to what the tank can actually supply this step (avoid emptying in one step)
        const max_withdrawable_nm3h = (h2_stored_nm3 / dt_h) * 0.8; // leave 20 % buffer
        h2_cons_nm3h = Math.min(h2_needed_nm3h, max_withdrawable_nm3h);
        p_fc = h2_cons_nm3h * (fc_eta * E_H2_HHV_KWH_NM3);
        if (p_fc < fc_min_kw) { p_fc = 0; h2_cons_nm3h = 0; }
      }
    }

    // ── 5. Storage — UPDATE ───────────────────────────────────────────────────
    const h2_out_nm3 = h2_cons_nm3h * dt_h;
    h2_stored_nm3    = Math.max(0, Math.min(tank_cap_nm3, h2_stored_nm3 + h2_in_nm3 - h2_out_nm3));

    const soc       = h2_stored_nm3 / tank_cap_nm3;
    const tank_p    = tank_p_min + soc * (tank_p_max - tank_p_min);
    const h2_mass   = h2_stored_nm3 * RHO_H2_KG_NM3;

    // FC efficiency (actual, for charting)
    const fc_eff_pct = (p_fc > 0 && h2_cons_nm3h > 0)
      ? Math.min(100, (p_fc / (h2_cons_nm3h * E_H2_HHV_KWH_NM3)) * 100)
      : 0;

    // ── Record ────────────────────────────────────────────────────────────────
    time_s.push(t);
    source_power_kw_arr.push( round2(p_src));
    elz_power_kw_arr.push(    round2(p_elz));
    h2_prod_nm3h_arr.push(    round3(h2_prod_nm3h));
    h2_prod_kg_h_arr.push(    round3(h2_prod_kg_h));
    elz_eff_pct_arr.push(     round1(elz_eff_pct));
    comp_power_kw_arr.push(   round2(p_comp));
    tank_pressure_arr.push(   round1(tank_p));
    tank_soc_pct_arr.push(    round1(soc * 100));
    h2_mass_kg_arr.push(      round2(h2_mass));
    fc_power_kw_arr.push(     round2(p_fc));
    h2_cons_nm3h_arr.push(    round3(h2_cons_nm3h));
    fc_eff_pct_arr.push(      round1(fc_eff_pct));
  }

  // ── KPI aggregation ──────────────────────────────────────────────────────────
  const total_h2_prod_nm3  = h2_prod_nm3h_arr.reduce((s, v) => s + v * dt_h, 0);
  const total_h2_cons_nm3  = h2_cons_nm3h_arr.reduce((s, v) => s + v * dt_h, 0);
  const total_h2_prod_kg   = total_h2_prod_nm3 * RHO_H2_KG_NM3;
  const total_h2_cons_kg   = total_h2_cons_nm3 * RHO_H2_KG_NM3;
  const total_source_kwh   = source_power_kw_arr.reduce((s, v) => s + v * dt_h, 0);
  const total_elz_kwh      = elz_power_kw_arr.reduce((s, v) => s + v * dt_h, 0);
  const total_fc_kwh       = fc_power_kw_arr.reduce((s,  v) => s + v * dt_h, 0);
  const total_curtailed_kwh = Math.max(0, total_source_kwh - total_elz_kwh);
  const spec_energy        = total_h2_prod_kg > 0
    ? total_elz_kwh / total_h2_prod_kg
    : 0;
  const sys_eff_pct        = total_elz_kwh > 0
    ? (total_h2_prod_kg * LHV_H2_KWH_KG + total_fc_kwh) / total_elz_kwh * 100
    : 0;
  const avg_elz_load_pct   = elz_cap_kw > 0
    ? (elz_power_kw_arr.reduce((s, v) => s + v, 0) / N / elz_cap_kw) * 100
    : 0;
  const cap_factor_pct     = src_cap_kw > 0
    ? (source_power_kw_arr.reduce((s, v) => s + v, 0) / N / src_cap_kw) * 100
    : 0;
  const avg_fc_kw = fc_power_kw_arr.reduce((s, v) => s + v, 0) / Math.max(1, N);
  const fc_capacity_factor_pct = fc_cap_kw > 0 ? (avg_fc_kw / fc_cap_kw) * 100 : 0;

  return {
    // ── time axis ──
    time_s,
    dt_s,

    // ── flat aliases expected by existing chart components ──
    source_power_kw:        source_power_kw_arr,
    electrolyzer_power_kw:  elz_power_kw_arr,
    h2_production_nm3h:     h2_prod_nm3h_arr,
    h2_production_kg_h:     h2_prod_kg_h_arr,
    elz_efficiency_pct:     elz_eff_pct_arr,

    compressor_power_kw:    comp_power_kw_arr,

    tank_pressure_bar:      tank_pressure_arr,
    tank_soc_pct:           tank_soc_pct_arr,
    h2_mass_kg:             h2_mass_kg_arr,

    fc_power_output_kw:     fc_power_kw_arr,
    h2_consumption_nm3h:    h2_cons_nm3h_arr,
    fc_efficiency_pct:      fc_eff_pct_arr,

    // ── nested v2 shape (for normalizeSimResult compatibility) ──
    electrolyzer: {
      power_in_kw:         elz_power_kw_arr,
      h2_production_nm3h:  h2_prod_nm3h_arr,
      h2_production_kg_h:  h2_prod_kg_h_arr,
      efficiency_pct:      elz_eff_pct_arr,
    },
    compressor: {
      power_consumed_kw:   comp_power_kw_arr,
    },
    storage: {
      pressure_bar:        tank_pressure_arr,
      soc_pct:             tank_soc_pct_arr,
      h2_mass_kg:          h2_mass_kg_arr,
    },
    fuel_cell: {
      power_output_kw:     fc_power_kw_arr,
      h2_consumed_nm3h:    h2_cons_nm3h_arr,
      efficiency_pct:      fc_eff_pct_arr,
    },

    // ── KPIs ──
    kpi: {
      total_h2_produced_kg:          round2(total_h2_prod_kg),
      total_h2_consumed_kg:          round2(total_h2_cons_kg),
      total_h2_produced_nm3:         round2(total_h2_prod_nm3),
      total_h2_consumed_nm3:         round2(total_h2_cons_nm3),
      total_source_energy_kwh:       round1(total_source_kwh),
      total_curtailed_energy_kwh:    round1(total_curtailed_kwh),
      total_elz_energy_kwh:          round1(total_elz_kwh),
      total_fc_energy_kwh:           round1(total_fc_kwh),
      total_energy_consumed_kwh:     round1(total_elz_kwh),
      overall_system_efficiency_pct: round1(sys_eff_pct),
      specific_energy_kwh_kg:        round2(spec_energy),
      peak_h2_production_kg_h:       round3(Math.max(...h2_prod_kg_h_arr)),
      avg_source_power_kw:           round2(source_power_kw_arr.reduce((s, v) => s + v, 0) / Math.max(1, N)),
      avg_elz_power_kw:              round2(elz_power_kw_arr.reduce((s, v) => s + v, 0) / Math.max(1, N)),
      avg_fc_power_kw:               round2(avg_fc_kw),
      peak_source_power_kw:          round2(Math.max(...source_power_kw_arr)),
      peak_elz_power_kw:             round2(Math.max(...elz_power_kw_arr)),
      peak_fc_power_kw:              round2(Math.max(...fc_power_kw_arr)),
      avg_electrolyzer_load_pct:     round1(avg_elz_load_pct),
      capacity_factor_pct:           round1(cap_factor_pct),
      fuel_cell_capacity_factor_pct: round1(fc_capacity_factor_pct),
    },

    // ── metadata ──
    _local:       true,    // signals "this is a local JS simulation"
    _tank_cap_nm3: round1(tank_cap_nm3),
    _elz_h2_rated: round2(elz_h2_rated_nm3h),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const round1 = (v) => Math.round(v * 10)   / 10;
const round2 = (v) => Math.round(v * 100)  / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

function _emptyResult(dt_s) {
  return {
    time_s: [], dt_s,
    source_power_kw: [], electrolyzer_power_kw: [],
    h2_production_nm3h: [], h2_production_kg_h: [],
    elz_efficiency_pct: [], compressor_power_kw: [],
    tank_pressure_bar: [], tank_soc_pct: [], h2_mass_kg: [],
    fc_power_output_kw: [], h2_consumption_nm3h: [], fc_efficiency_pct: [],
    electrolyzer: {}, compressor: {}, storage: {}, fuel_cell: {},
    kpi: {
      total_h2_produced_kg: 0, total_h2_consumed_kg: 0,
      total_energy_consumed_kwh: 0, overall_system_efficiency_pct: 0,
      specific_energy_kwh_kg: 0, peak_h2_production_kg_h: 0,
      avg_electrolyzer_load_pct: 0, capacity_factor_pct: 0,
    },
    _local: true,
  };
}
