/**
 * visual-builder/CostCalculatorWizard.tsx
 * ──────────────────────────────────────────
 * Interactive CAPEX / OPEX / LCOE breakdown wizard.
 *
 * Instead of asking researchers to enter a single opaque "CAPEX" number,
 * this wizard breaks it down into meaningful sub-components.  The totals
 * auto-calculate and are written back to the node via `onUpdate`.
 *
 * Economics model
 * ───────────────
 *   CAPEX ($/kW) = (equipment + installation + grid + engineering)
 *                  × (1 + contingency / 100)
 *
 *   Fixed OPEX ($/kW/yr) = insurance + labor + maintenance
 *
 *   Variable OPEX ($/MWh) = variable_om + fuel_cost
 *
 *   CRF = r(1+r)ⁿ / ((1+r)ⁿ − 1)        r = discount rate, n = lifetime
 *
 *   LCOE ($/MWh) = (CAPEX × CRF + fixed_opex) / (CF × 8760) + variable_opex
 */

import { useState, useMemo, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CapexBreakdown {
  equipment: number;
  installation: number;
  gridConnection: number;
  engineering: number;
  contingencyPct: number;
}

interface OpexBreakdown {
  fixedInsurance: number;
  fixedLabor: number;
  fixedMaintenance: number;
  variableOM: number;
  fuelCost: number;
}

export interface CostWizardResult {
  capexUsdPerKw: number;
  opexFixedUsdPerKwYr: number;
  opexVarUsdPerMwh: number;
}

interface CostCalculatorWizardProps {
  lifetimeYears: number;
  initialCapex?: number;
  initialOpexFixed?: number;
  initialOpexVar?: number;
  onApply: (result: CostWizardResult) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcCapex(b: CapexBreakdown): number {
  const base = b.equipment + b.installation + b.gridConnection + b.engineering;
  return base * (1 + b.contingencyPct / 100);
}

function calcFixedOpex(b: OpexBreakdown): number {
  return b.fixedInsurance + b.fixedLabor + b.fixedMaintenance;
}

function calcVarOpex(b: OpexBreakdown): number {
  return b.variableOM + b.fuelCost;
}

function calcCRF(discountRatePct: number, lifetimeYears: number): number {
  if (lifetimeYears <= 0) return 0;
  const r = discountRatePct / 100;
  if (r === 0) return 1 / lifetimeYears;
  const n = lifetimeYears;
  return (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function calcLCOE(
  capex: number,
  opexFixed: number,
  opexVar: number,
  discountRatePct: number,
  lifetimeYears: number,
  capacityFactorPct: number
): number {
  const crf = calcCRF(discountRatePct, lifetimeYears);
  const cf = capacityFactorPct / 100;
  if (cf <= 0) return 0;
  return (capex * crf + opexFixed) / (cf * 8760) + opexVar;
}

// ── Number input ──────────────────────────────────────────────────────────────

interface NumInputProps {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}

function NumInput({ label, unit, value, onChange, hint }: NumInputProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-on-surface-variant flex-1 min-w-0 truncate" title={hint}>
        {label}
      </label>
      <div className="flex items-center gap-1 flex-shrink-0">
        <input
          type="number"
          min={0}
          step="any"
          value={value === 0 ? "" : value}
          placeholder="0"
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="
            w-24 text-right text-[11px] font-mono font-semibold
            bg-surface-container border border-outline-variant/30
            rounded-lg px-2 py-1.5 text-on-surface
            focus:outline-none focus:ring-1 focus:ring-primary/40
          "
        />
        <span className="text-[9px] text-on-surface-variant/60 w-16">{unit}</span>
      </div>
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: number;
  unit: string;
  color: string;
  icon: string;
}

function MetricCard({ label, value, unit, color, icon }: MetricCardProps) {
  return (
    <div className={`rounded-xl p-3 border ${color}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest opacity-70">{label}</span>
      </div>
      <p className="text-lg font-bold tabular-nums">
        {value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        <span className="text-[10px] font-normal opacity-60 ml-1">{unit}</span>
      </p>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  icon: string;
  total: number;
  unit: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ title, icon, total, unit, expanded, onToggle, children }: SectionProps) {
  return (
    <div className="border border-outline-variant/20 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-surface-container hover:bg-surface-container-high transition-colors text-left"
      >
        <span className="material-symbols-outlined text-[15px] text-primary">{icon}</span>
        <span className="text-[11px] font-bold text-on-surface flex-1">{title}</span>
        <span className="text-[10px] font-semibold tabular-nums text-primary">
          {total.toLocaleString(undefined, { maximumFractionDigits: 0 })} {unit}
        </span>
        <span className={`material-symbols-outlined text-[14px] text-on-surface-variant/60 transition-transform ${expanded ? "" : "-rotate-90"}`}>
          expand_more
        </span>
      </button>

      {expanded && (
        <div className="px-3 py-3 space-y-2.5 bg-surface-container-lowest">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function CostCalculatorWizard({
  lifetimeYears,
  initialCapex = 0,
  initialOpexFixed = 0,
  initialOpexVar = 0,
  onApply,
}: CostCalculatorWizardProps) {
  const [capex, setCapex] = useState<CapexBreakdown>({
    equipment:      initialCapex * 0.65,
    installation:   initialCapex * 0.15,
    gridConnection: initialCapex * 0.08,
    engineering:    initialCapex * 0.07,
    contingencyPct: 10,
  });

  const [opex, setOpex] = useState<OpexBreakdown>({
    fixedInsurance:   initialOpexFixed * 0.3,
    fixedLabor:       initialOpexFixed * 0.5,
    fixedMaintenance: initialOpexFixed * 0.2,
    variableOM:       initialOpexVar * 0.5,
    fuelCost:         initialOpexVar * 0.5,
  });

  const [discountRate, setDiscountRate] = useState(7);
  const [capacityFactor, setCapacityFactor] = useState(35);

  const [capexOpen, setCapexOpen]   = useState(true);
  const [opexOpen, setOpexOpen]     = useState(false);
  const [lcoeOpen, setLcoeOpen]     = useState(false);

  // Derived totals
  const totalCapex    = useMemo(() => calcCapex(capex), [capex]);
  const totalFixedOpex = useMemo(() => calcFixedOpex(opex), [opex]);
  const totalVarOpex  = useMemo(() => calcVarOpex(opex), [opex]);
  const lcoe          = useMemo(
    () => calcLCOE(totalCapex, totalFixedOpex, totalVarOpex, discountRate, lifetimeYears, capacityFactor),
    [totalCapex, totalFixedOpex, totalVarOpex, discountRate, lifetimeYears, capacityFactor]
  );

  const patchCapex = useCallback(
    (patch: Partial<CapexBreakdown>) => setCapex((c) => ({ ...c, ...patch })),
    []
  );
  const patchOpex = useCallback(
    (patch: Partial<OpexBreakdown>) => setOpex((c) => ({ ...c, ...patch })),
    []
  );

  const handleApply = useCallback(() => {
    onApply({
      capexUsdPerKw:        Math.round(totalCapex),
      opexFixedUsdPerKwYr:  Math.round(totalFixedOpex * 10) / 10,
      opexVarUsdPerMwh:     Math.round(totalVarOpex * 10) / 10,
    });
  }, [onApply, totalCapex, totalFixedOpex, totalVarOpex]);

  return (
    <div className="space-y-3">
      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="CAPEX"
          value={totalCapex}
          unit="$/kW"
          icon="construction"
          color="border-amber-200 bg-amber-50 text-amber-800"
        />
        <MetricCard
          label="LCOE"
          value={lcoe}
          unit="$/MWh"
          icon="electric_meter"
          color="border-emerald-200 bg-emerald-50 text-emerald-800"
        />
        <MetricCard
          label="Fixed OPEX"
          value={totalFixedOpex}
          unit="$/kW/yr"
          icon="tune"
          color="border-blue-200 bg-blue-50 text-blue-800"
        />
        <MetricCard
          label="Var OPEX"
          value={totalVarOpex}
          unit="$/MWh"
          icon="speed"
          color="border-violet-200 bg-violet-50 text-violet-800"
        />
      </div>

      {/* ── CAPEX Breakdown ───────────────────────────── */}
      <Section
        title="CAPEX Breakdown"
        icon="construction"
        total={totalCapex}
        unit="$/kW"
        expanded={capexOpen}
        onToggle={() => setCapexOpen((o) => !o)}
      >
        <NumInput label="Equipment & Procurement" unit="$/kW" value={capex.equipment}
          onChange={(v) => patchCapex({ equipment: v })} hint="Turbine, panels, battery cells etc." />
        <NumInput label="Installation & Civil" unit="$/kW" value={capex.installation}
          onChange={(v) => patchCapex({ installation: v })} hint="Foundation, civil, land preparation" />
        <NumInput label="Grid Connection" unit="$/kW" value={capex.gridConnection}
          onChange={(v) => patchCapex({ gridConnection: v })} hint="Substation, cabling, metering" />
        <NumInput label="Engineering & Permits" unit="$/kW" value={capex.engineering}
          onChange={(v) => patchCapex({ engineering: v })} hint="Feasibility, permits, commissioning" />
        <div className="border-t border-outline-variant/15 pt-2.5">
          <NumInput label="Contingency" unit="%" value={capex.contingencyPct}
            onChange={(v) => patchCapex({ contingencyPct: Math.max(0, Math.min(50, v)) })}
            hint="Applied as a percentage markup on the sub-total" />
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-primary/10">
          <span className="text-[10px] font-bold text-on-surface-variant">Total CAPEX</span>
          <span className="text-sm font-bold text-primary tabular-nums">
            ${totalCapex.toLocaleString(undefined, { maximumFractionDigits: 0 })} /kW
          </span>
        </div>
      </Section>

      {/* ── OPEX Breakdown ────────────────────────────── */}
      <Section
        title="OPEX Breakdown"
        icon="manage_history"
        total={totalFixedOpex + totalVarOpex}
        unit="mixed"
        expanded={opexOpen}
        onToggle={() => setOpexOpen((o) => !o)}
      >
        <p className="text-[9px] font-semibold text-on-surface-variant/50 uppercase tracking-widest">
          Fixed ($/kW/yr)
        </p>
        <NumInput label="Insurance" unit="$/kW/yr" value={opex.fixedInsurance}
          onChange={(v) => patchOpex({ fixedInsurance: v })} />
        <NumInput label="Labor & Administration" unit="$/kW/yr" value={opex.fixedLabor}
          onChange={(v) => patchOpex({ fixedLabor: v })} />
        <NumInput label="Scheduled Maintenance" unit="$/kW/yr" value={opex.fixedMaintenance}
          onChange={(v) => patchOpex({ fixedMaintenance: v })} />
        <div className="flex items-center justify-between pt-1 border-t border-outline-variant/10">
          <span className="text-[10px] font-bold text-on-surface-variant">Total Fixed OPEX</span>
          <span className="text-xs font-bold text-blue-600 tabular-nums">
            ${totalFixedOpex.toLocaleString(undefined, { maximumFractionDigits: 1 })} /kW/yr
          </span>
        </div>

        <p className="text-[9px] font-semibold text-on-surface-variant/50 uppercase tracking-widest pt-2">
          Variable ($/MWh)
        </p>
        <NumInput label="Variable O&M" unit="$/MWh" value={opex.variableOM}
          onChange={(v) => patchOpex({ variableOM: v })} />
        <NumInput label="Fuel / Feedstock" unit="$/MWh" value={opex.fuelCost}
          onChange={(v) => patchOpex({ fuelCost: v })} />
        <div className="flex items-center justify-between pt-1 border-t border-outline-variant/10">
          <span className="text-[10px] font-bold text-on-surface-variant">Total Variable OPEX</span>
          <span className="text-xs font-bold text-violet-600 tabular-nums">
            ${totalVarOpex.toLocaleString(undefined, { maximumFractionDigits: 1 })} /MWh
          </span>
        </div>
      </Section>

      {/* ── LCOE Preview ──────────────────────────────── */}
      <Section
        title="LCOE Preview"
        icon="electric_meter"
        total={lcoe}
        unit="$/MWh"
        expanded={lcoeOpen}
        onToggle={() => setLcoeOpen((o) => !o)}
      >
        <p className="text-[9px] text-on-surface-variant/60 leading-relaxed">
          LCOE = (CAPEX × CRF + Fixed OPEX) / (CF × 8,760 h) + Variable OPEX
        </p>

        <div className="space-y-2 pt-1">
          {/* Discount rate slider */}
          <div>
            <div className="flex justify-between text-[10px] text-on-surface-variant mb-1">
              <span>Discount rate</span>
              <span className="font-bold tabular-nums">{discountRate}%</span>
            </div>
            <input
              type="range" min={1} max={20} step={0.5}
              value={discountRate}
              onChange={(e) => setDiscountRate(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          {/* Capacity factor slider */}
          <div>
            <div className="flex justify-between text-[10px] text-on-surface-variant mb-1">
              <span>Capacity factor</span>
              <span className="font-bold tabular-nums">{capacityFactor}%</span>
            </div>
            <input
              type="range" min={5} max={100} step={1}
              value={capacityFactor}
              onChange={(e) => setCapacityFactor(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          {/* CRF display */}
          <div className="flex items-center justify-between text-[10px] border-t border-outline-variant/10 pt-2">
            <span className="text-on-surface-variant">
              CRF ({lifetimeYears} yr @ {discountRate}%)
            </span>
            <span className="font-mono font-bold text-on-surface">
              {calcCRF(discountRate, lifetimeYears).toFixed(4)}
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5 mt-1">
          <p className="text-[10px] text-emerald-700 font-semibold">Estimated LCOE</p>
          <p className="text-2xl font-bold text-emerald-800 tabular-nums">
            ${lcoe.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            <span className="text-sm font-normal">/MWh</span>
          </p>
          <p className="text-[9px] text-emerald-600/70 mt-0.5">
            Indicative only — subject to site-specific assumptions
          </p>
        </div>
      </Section>

      {/* Apply button */}
      <button
        type="button"
        onClick={handleApply}
        className="
          w-full flex items-center justify-center gap-2 py-2.5
          bg-primary text-on-primary rounded-xl text-sm font-bold
          hover:bg-primary/90 active:scale-[0.98] transition-all
          shadow-sm shadow-primary/20
        "
      >
        <span className="material-symbols-outlined text-[16px]">check_circle</span>
        Apply to Node
      </button>
    </div>
  );
}
