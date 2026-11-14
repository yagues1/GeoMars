import { STATUS_LABEL, type DataStatus } from '../../data/datasets';

const TIPS: Record<DataStatus, string> = {
  observed: 'Measured by an instrument (source and date in Data & sources)',
  derived: 'Computed from observed data by a documented method',
  estimated: 'Model output based on stated assumptions — not measured',
  unavailable: 'No sufficient data for this area or property',
};

export function StatusTag({ s }: { s: DataStatus }) {
  return (
    <span className={`gm-status ${s}`} title={TIPS[s]}>
      {STATUS_LABEL[s]}
    </span>
  );
}
