/**
 * UnitInspector.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Right-side editor for the selected Unit (ADR-0004, Phase 2):
 *   • rename
 *   • compose a Catalogue Technology (picker scoped to the equipment's category)
 *   • edit operating conditions (setpoints)
 *   • delete
 */

import React, { useEffect, useState } from 'react';
import { FiTrash2, FiPlus, FiLayers, FiBarChart2, FiInfo, FiX } from 'react-icons/fi';
import { equipmentDef } from './equipmentLibrary';
import { fetchCategoryPickerModels } from '../simulator/services/techDatabaseApi';
import UnitAnalysisModal, { hasAnalysis } from './UnitAnalysisModal';

// One-line, equipment-specific guidance shown the first time you select each
// kind of unit (once per session). Generic across H₂, CCUS, and future units.
const EQUIPMENT_TIPS = {
  power_source:       'Set plant capacity and capacity factor. Open the analysis for its 24 h generation profile.',
  water_source:       'A supply node — no parameters; it feeds water to the electrolyzer.',
  flue_gas_source:    'Set capacity and CO₂ intensity — this sets how much CO₂ enters the capture chain.',
  electrolyzer_pem:   'Pick a Catalogue electrolyzer, then tune operating temperature and nominal efficiency. Analysis shows the partial-load efficiency curve.',
  fuel_cell_pem:      'Set nominal efficiency and operating pressure. Analysis shows part-load efficiency and power.',
  compressor:         'Set target pressure and isentropic efficiency — these drive the parasitic power draw.',
  co2_absorber_amine: 'Set capture rate and reboiler energy — the core CCS energy/capture trade-off.',
  solvent_stripper:   'Set reboiler temperature and thermal efficiency — the solvent regeneration duty.',
  co2_compressor:     'Set the pipeline target pressure and stages for CO₂ transport/injection.',
  h2_tank:            'Set max pressure and round-trip efficiency — buffers H₂ between production and use.',
  co2_geological_storage: 'Set injection rate and reservoir conditions for permanent CO₂ storage.',
  grid_sink:          'A terminal load — it consumes the delivered electricity.',
};
const _seenTips = new Set();   // per-session: show each equipment tip once

export default function UnitInspector({ unit, onChange, onDelete }) {
  const def = unit ? equipmentDef(unit.equipment_type) : null;
  const [techs, setTechs] = useState([]);
  const [loadingTechs, setLoadingTechs] = useState(false);
  const [newCond, setNewCond] = useState({ key: '', value: '', unit: '' });
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [showTip, setShowTip] = useState(false);

  // Show the equipment-specific coachmark once per type per session on selection.
  useEffect(() => {
    setShowTip(!!unit && !_seenTips.has(unit.equipment_type) && !!EQUIPMENT_TIPS[unit.equipment_type]);
  }, [unit?.id, unit?.equipment_type]);
  const dismissTip = () => { if (unit) _seenTips.add(unit.equipment_type); setShowTip(false); };

  // Load catalogue Technologies for this equipment's category
  useEffect(() => {
    let alive = true;
    if (!def?.category) { setTechs([]); return; }
    setLoadingTechs(true);
    fetchCategoryPickerModels(def.category)
      .then((list) => { if (alive) setTechs(list); })
      .catch(() => { if (alive) setTechs([]); })
      .finally(() => { if (alive) setLoadingTechs(false); });
    return () => { alive = false; };
  }, [def?.category]);

  if (!unit) {
    return (
      <aside data-tour="inspector" className="w-72 shrink-0 border-l border-outline-variant/20 bg-surface-container-lowest p-5">
        <p className="text-sm text-on-surface-variant">Select a unit to edit its technology and operating conditions.</p>
      </aside>
    );
  }

  const conditions = Object.entries(unit.operating_conditions ?? {});
  const chosen = techs.find((t) => t.slug === unit.technology_ref);

  const setCondition = (key, field, raw) => {
    const prev = unit.operating_conditions?.[key] ?? { value: 0, unit: '' };
    const next = field === 'value'
      ? { ...prev, value: raw === '' ? null : Number(raw) }
      : { ...prev, unit: raw };
    onChange({ operating_conditions: { ...unit.operating_conditions, [key]: next } });
  };
  const removeCondition = (key) => {
    const rest = { ...unit.operating_conditions };
    delete rest[key];
    onChange({ operating_conditions: rest });
  };
  const addCondition = () => {
    const key = newCond.key.trim();
    if (!key) return;
    onChange({
      operating_conditions: {
        ...unit.operating_conditions,
        [key]: { value: newCond.value === '' ? null : Number(newCond.value), unit: newCond.unit || 'unit', source: 'user' },
      },
    });
    setNewCond({ key: '', value: '', unit: '' });
  };

  return (
    <aside data-tour="inspector" className="w-72 shrink-0 border-l border-outline-variant/20 bg-surface-container-lowest flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20">
        <span className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Unit</span>
        <button onClick={onDelete} title="Delete unit"
          className="p-1.5 rounded-lg text-on-surface-variant hover:text-tertiary hover:bg-surface-container transition-colors">
          <FiTrash2 size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Equipment-specific coachmark (shown once per type per session) */}
        {showTip && (
          <div className="flex gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
            <FiInfo className="text-primary shrink-0 mt-0.5" size={14} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-primary mb-0.5">{def.label}</p>
              <p className="text-[11px] text-on-surface-variant leading-relaxed">{EQUIPMENT_TIPS[unit.equipment_type]}</p>
            </div>
            <button onClick={dismissTip} title="Dismiss" className="text-on-surface-variant/60 hover:text-on-surface shrink-0">
              <FiX size={13} />
            </button>
          </div>
        )}

        {/* Name */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Name</label>
          <input
            value={unit.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
          <p className="text-[10px] text-on-surface-variant/70 mt-1">{def.label} · {unit.equipment_type}</p>
        </div>

        {/* Composed Technology */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1 flex items-center gap-1">
            <FiLayers size={11} /> Technology
          </label>
          {def.category ? (
            <>
              <select
                value={unit.technology_ref ?? ''}
                onChange={(e) => onChange({ technology_ref: e.target.value || null })}
                className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">{loadingTechs ? 'Loading…' : '— none —'}</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.slug}>{t.name}</option>
                ))}
              </select>
              {chosen && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {chosen.efficiency_pct != null && (
                    <MiniStat label="Efficiency" value={`${Number(chosen.efficiency_pct).toFixed(0)} %`} />
                  )}
                  {chosen.capacity_kw != null && (
                    <MiniStat label="Capacity" value={chosen.capacity_kw >= 1000 ? `${(chosen.capacity_kw / 1000).toFixed(1)} MW` : `${chosen.capacity_kw} kW`} />
                  )}
                  {chosen.capex_usd_per_kw != null && (
                    <MiniStat label="CAPEX" value={`${chosen.capex_usd_per_kw} $/kW`} />
                  )}
                  {chosen.lifetime_yr != null && (
                    <MiniStat label="Lifetime" value={`${chosen.lifetime_yr} yr`} />
                  )}
                </div>
              )}
              <p className="text-[10px] text-on-surface-variant/70 mt-1.5">Parameters come from the composed Catalogue Technology.</p>
            </>
          ) : (
            <p className="text-[11px] text-on-surface-variant/70 italic">This equipment type has no Catalogue technology (source / sink).</p>
          )}
        </div>

        {/* Analysis charts — reuses the detailed simulator panels */}
        {hasAnalysis(unit.equipment_type) && (
          <button
            data-tour="analyze"
            onClick={() => setAnalysisOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold
                       technical-gradient text-on-primary shadow-sm hover:shadow transition-all">
            <FiBarChart2 size={13} /> View analysis charts
          </button>
        )}

        {/* Operating conditions */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Operating Conditions</label>
          <div className="space-y-2">
            {conditions.length === 0 && (
              <p className="text-[11px] text-on-surface-variant/60 italic">No setpoints yet.</p>
            )}
            {conditions.map(([key, pv]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="flex-1 text-[11px] text-on-surface truncate" title={key}>{key}</span>
                <input
                  type="number" value={pv?.value ?? ''}
                  onChange={(e) => setCondition(key, 'value', e.target.value)}
                  className="w-16 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-1.5 py-1 text-[11px] text-right focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <input
                  value={pv?.unit ?? ''}
                  onChange={(e) => setCondition(key, 'unit', e.target.value)}
                  className="w-12 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-1.5 py-1 text-[10px] text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button onClick={() => removeCondition(key)} className="text-on-surface-variant/60 hover:text-tertiary text-xs px-1">✕</button>
              </div>
            ))}
          </div>
          {/* Add condition */}
          <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-outline-variant/20">
            <input
              placeholder="name" value={newCond.key}
              onChange={(e) => setNewCond((c) => ({ ...c, key: e.target.value }))}
              className="flex-1 min-w-0 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <input
              placeholder="val" type="number" value={newCond.value}
              onChange={(e) => setNewCond((c) => ({ ...c, value: e.target.value }))}
              className="w-14 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-1.5 py-1 text-[11px] text-right focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <input
              placeholder="unit" value={newCond.unit}
              onChange={(e) => setNewCond((c) => ({ ...c, unit: e.target.value }))}
              className="w-12 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-1.5 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <button onClick={addCondition} title="Add condition"
              className="p-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
              <FiPlus size={13} />
            </button>
          </div>
        </div>
      </div>
      <UnitAnalysisModal
        open={analysisOpen}
        unit={unit}
        techModel={chosen}
        genCapacityKw={chosen?.capacity_kw}
        onClose={() => setAnalysisOpen(false)}
      />
    </aside>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="font-headline text-xs font-bold text-on-surface">{value}</p>
    </div>
  );
}
