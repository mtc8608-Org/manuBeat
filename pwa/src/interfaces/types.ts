export interface AuthUser {
  id: string;
  email: string;
  role: string;
  tier?: string;   // the role's permissions tier from the JWT; equals role on pre-tier tokens
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                          SURVEY SYSTEM                                      ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

export interface Survey {
  id: string;
  component_id: string;
  title: string;
  is_active: boolean;
  created_at: string;
}

export interface SurveyAnswer {
  id: string;
  survey_id: string;
  owner_id: string;
  owner_email?: string;
  answers: Record<string, any>;
  submitted_at: string;
}

// ── end survey system ─────────────────────────────────────────────────────────

// ── Files ─────────────────────────────────────────────────────────────────────

export interface FileRecord {
  id: string;
  bucket: string;
  key: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
  description: string | null;
  is_public: boolean;   // content asset — streams to anonymous visitors
  uploaded_by: string | null;
  created_at: string;
}

export interface ComponentResults {
  id?: string;
  name: string;
  type: string;
  data: any;
  options: any;
  children?: any;
  owner_id?: string;   // set on owner-scoped domains; absent elsewhere
}

export interface Component {
  id?: string;
  name: string;
  type: string;
  data: any;
  options: any;
  children: Component[];
}

export interface ComponentModal {
  component: Component;
  context?: string;
  values?: any;
  onDismiss?: (data: Component) => void;
  onFormSubmit?: (data: Component) => void;
}

export interface PanelConfig {
  title?:        string;
  emptyMessage?: string;
  add?: {
    enabled: boolean;
    label?:  string;
  };
  filter?: {
    text?: { enabled: boolean; placeholder?: string };
    type?: { enabled: boolean; options?: readonly string[]; allLabel?: string };
  };
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                          MEDICAL / PHYSIOLOGY                                ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

export interface ModelConfig {
  id:          string;
  name:        string;
  description: string | null;
  config:      Record<string, any>;
  created_at:  string;
}

// python/config/metadata.json, served by GET /api/cardio/metadata. Every compartment's
// `gasRegion` is a key into `gasRegions`: `state` picks how the generator builds it
// (a `gas` region gets one partial volume V_<species>_<comp>, a `dissolved` one gets a
// concentration Y_<species>_<comp>), and `gases` lists the species with their initial
// values — a -1.0 entry means the species is ABSENT there and produces no state.
export interface GasRegion {
  state: 'gas' | 'dissolved';
  total: number;
  gases: Record<string, number>;
}

export interface ModelMetadata {
  gasRegions: Record<string, GasRegion>;
  data:       Record<string, any>;
  constants?: Record<string, any>;
}

// A scenario carries the VALUES of a run — twin targets, integration numerics and
// the baseline/calibration/control stage stacks — against a model's STRUCTURE.
// Same row shape as ModelConfig; the tables are separate because the model stack
// keeps them separate (python/config/models vs python/config/scenarios).
export interface ScenarioConfig {
  id:          string;
  name:        string;
  description: string | null;
  config:      Record<string, any>;
  created_at:  string;
}

export type RunMode = 'baseline' | 'calibration' | 'control';

export interface ModelRun {
  id:           string;
  config_id:    string | null;
  scenario_id:  string | null;
  mode:         RunMode;
  status:       'pending' | 'running' | 'done' | 'error';
  minio_key:    string | null;
  metadata:     Record<string, any> | null;
  created_at:   string;
  completed_at: string | null;
}

// One line of the model stack's convergence trace, as emitted by
// python/library/run/progress.py. Only a calibration over a scenario that declares
// convergence.observations produces these; every other run reports an empty list.
export interface CardioProgress {
  kind:        'step' | 'sim';
  label:       string;
  done:        number;
  total:       number;
  elapsedWall: number;
  eta:         number;
  meanRel:     number;
  maxRel:      number;
  bestRel:     number;
}

// One captured console line from the Python service — the model stack's own print()
// narration, teed out of the run thread by api/domains/medical/cardio_routes.py.
export interface CardioLogLine {
  t:    number;   // epoch seconds, stamped python-side
  text: string;
}

export interface CardioJobStatus {
  job_id:      string;
  status:      'pending' | 'running' | 'done' | 'error';
  mode:        RunMode;
  progress:    CardioProgress[];
  logs:        CardioLogLine[];
  duration_s:  number | null;
  state_count: number | null;
  minio_key:   string | null;
  error:       string | null;
}

// POST /cardio/process — the outputs appended to the artifact, plus the console the
// replay produced. A failure comes back instead as { error, traceback, logs }.
export interface CardioProcessResult {
  ok:             boolean;
  proc_name:      string;
  proc_config_id: string;
  outputs:        string[];
  errors:         { name: string; op: string; reason: string }[];
  logs:           CardioLogLine[];
}

// Mirrors library/hdf5/schema_sim.read_run_result, which in turn mirrors
// ResultsEngine.toPayload — one payload shape across library and web.
export interface CardioResult {
  stateNames:   string[];
  t:            number[];
  signals:      Record<string, number[]>;
  finalStates:  Record<string, number>;
  processed:    Record<string, Record<string, number[]>>;
  units:        Record<string, string>;
  labels:       Record<string, string>;
  metadata:     Record<string, any>;
}

export interface CardioPlotConfig {
  id:          string;
  name:        string;
  description: string | null;
  config:      Record<string, any>;
  created_at:  string;
}

export interface CardioProcConfig {
  id:          string;
  name:        string;
  description: string | null;
  config:      Record<string, any>;
  created_at:  string;
}

export interface HdfNode {
  name:      string;
  path:      string;
  type:      'group' | 'dataset';
  attrs:     Record<string, any>;
  children?: HdfNode[];
  shape?:    number[];
  dtype?:    string;
  fields?:   string[];
}

export interface HdfDataset {
  type:    'numeric' | 'string' | 'compound';
  shape?:  number[];
  data:    any;
  fields?: string[];
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                       DATA COLLECTION (BEDSIDE)                              ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

export interface BedsideNode {
  id:            string;
  node_key:      string | null;  // the id the agent reports (agent.toml node_id)
  name:          string;
  hostname:      string | null;
  ip_address:    string | null;
  location:      string | null;
  status:        string;            // online | offline | unknown
  online:        boolean;           // derived from last_seen freshness
  last_seen:     string | null;
  agent_version: string | null;
  hardware:      Record<string, any>;
  created_at:    string;
  bed_label:     string | null;     // the bed this Pi serves
  token?:        string | null;     // only present right after create / rotate
}

export interface Bed {
  id:            string;
  label:         string;
  node_id:       string | null;
  node_name:     string | null;
  node_status:   string | null;
  node_location: string | null;
  created_at:    string;
}

// Patient — a first-class record (detached from the survey system).
export interface Patient {
  id:            string;
  first_name:    string | null;
  last_name:     string | null;
  date_of_birth: string | null;
  sex:           string | null;
  identifier:    string | null;
  email:         string | null;
  phone:         string | null;
  address:       string | null;
  notes:         string | null;
  extra:         Record<string, any>;
  created_at:    string;
  file_id:       string | null;
  file_key:      string | null;
  bed_id:        string | null;          // current (active) bed
  bed_label:     string | null;
  node_key:      string | null;          // serving node (for the live Monitor link)
  node_name:     string | null;
  node_status:   string | null;
}

export interface BedAssignment {
  id:         string;
  patient_id: string;
  bed_id:     string;
  bed_label:  string | null;
  started_at: string;
  ended_at:   string | null;
  active:     boolean;
}

// ── Telemetry (live) ──────────────────────────────────────────────────────────
export interface BedsideStream {
  id:           string;
  stream_id:    string;
  modality:     string | null;
  group:        string | null;
  channel:      string | null;
  units:        string | null;
  metric:       string | null;
  sampling_hz:  number | null;
  source:       string | null;
  last_seq:     number | null;
  last_time_us: number | null;
}

export interface BedsideSegment {
  id:            string;
  stream_id:     string;
  seq:           number;
  start_time_us: number;
  sampling_hz:   number;
  duration:      number;
  samples:       number[];
  quality:       Array<[number, number]>;
}

export interface NodeHeartbeat {
  id:              string;
  ts_ms:           number | null;
  cpu_temp_c:      number | null;
  disk_free_bytes: number | null;
  buffer_pending:  number | null;
  last_sample_us:  Record<string, number>;
  agent_version:   string | null;
  received_at:     string;
}
