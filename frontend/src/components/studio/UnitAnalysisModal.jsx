/**
 * UnitAnalysisModal.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Rich per-Unit analysis for the Process Studio — reuses the detailed chart
 * panels from the original simulator (electrolyzer efficiency curve, generation
 * profile, CCS absorber/compressor/stripper charts) plus a compact fuel-cell
 * analysis. Panels are fed the Unit's composed Catalogue technology merged with
 * its operating conditions.
 */

import React from 'react';
import H2NodeModal from '../simulator/components/H2NodeModal';
import H2ElectrolyzerPanel from '../simulator/components/H2ElectrolyzerPanel';
import H2GeneratorPanel from '../simulator/components/H2GeneratorPanel';
import CCSAbsorberPanel from '../simulator/components/CCSAbsorberPanel';
import CCSCompressorPanel from '../simulator/components/CCSCompressorPanel';
import CCSStripperPanel from '../simulator/components/CCSStripperPanel';
import FuelCellAnalysis from './FuelCellAnalysis';
import CompressorAnalysis from './CompressorAnalysis';
import StorageAnalysis from './StorageAnalysis';
import { equipmentDef } from './equipmentLibrary';

// equipment_type → analysis kind. Sources/electrolyzer need a composed tech;
// the rest can analyse from operating conditions alone.
const ANALYSIS_KIND = {
  power_source:           'generator',
  flue_gas_source:        'generator',
  electrolyzer_pem:       'electrolyzer',
  fuel_cell_pem:          'fuelcell',
  compressor:             'compressor',
  co2_compressor:         'ccs_compressor',
  co2_absorber_amine:     'absorber',
  solvent_stripper:       'stripper',
  h2_tank:                'storage',
  co2_geological_storage: 'storage',
};
const NEEDS_TECH = new Set(['generator', 'electrolyzer']);

export function hasAnalysis(equipmentType) {
  return equipmentType in ANALYSIS_KIND;
}

function _ocValues(unit) {
  const out = {};
  for (const [k, pv] of Object.entries(unit?.operating_conditions ?? {})) {
    out[k] = pv && typeof pv === 'object' ? pv.value : pv;
  }
  return out;
}

export default function UnitAnalysisModal({ open, unit, techModel, genCapacityKw, genTechType, onClose }) {
  if (!unit) return null;
  const kind = ANALYSIS_KIND[unit.equipment_type];
  const def = equipmentDef(unit.equipment_type);
  const Icon = def.icon;

  const oc = _ocValues(unit);
  // Enriched model: catalogue params overlaid with this Process's operating
  // conditions, so CCS/fuel-cell panels find their fields even without a tech.
  const model = { name: techModel?.name ?? unit.name, ...(techModel ?? {}), ...oc };

  const body = () => {
    if (NEEDS_TECH.has(kind) && !techModel) {
      return <p className="text-sm text-on-surface-variant">Compose a Catalogue technology for this unit to see its analysis.</p>;
    }
    switch (kind) {
      case 'electrolyzer':
        return <H2ElectrolyzerPanel selectedModel={model} genTechType={genTechType || 'wind'}
                 genCapacityKw={genCapacityKw ?? model.capacity_kw ?? undefined} simState="idle" />;
      case 'generator':
        return <H2GeneratorPanel selectedModel={model} simState="idle" />;
      case 'fuelcell':
        return <FuelCellAnalysis model={model} />;
      case 'compressor':
        return <CompressorAnalysis model={model} />;
      case 'storage':
        return <StorageAnalysis model={model} />;
      case 'absorber':
        return <CCSAbsorberPanel selectedModel={model} savedParams={oc} onParamsChange={() => {}} />;
      case 'ccs_compressor':
        return <CCSCompressorPanel selectedModel={model} savedParams={oc} onParamsChange={() => {}} />;
      case 'stripper':
        return <CCSStripperPanel selectedModel={model} savedParams={oc} onParamsChange={() => {}} />;
      default:
        return <p className="text-sm text-on-surface-variant">No analysis available for this equipment type yet.</p>;
    }
  };

  return (
    <H2NodeModal
      open={open}
      onClose={onClose}
      title={unit.name}
      subtitle={`${def.label} · ${techModel?.name ?? 'operating conditions'}`}
      icon={<Icon size={18} />}
      accentColor="bg-primary"
    >
      {body()}
    </H2NodeModal>
  );
}
