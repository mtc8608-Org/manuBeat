export interface AuthUser {
  id: string;
  email: string;
  role: string;
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
    type?: { enabled: boolean; options?: readonly string[] };
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

export interface ModelRun {
  id:           string;
  config_id:    string | null;
  status:       'pending' | 'running' | 'done' | 'error';
  minio_key:    string | null;
  metadata:     Record<string, any> | null;
  created_at:   string;
  completed_at: string | null;
}

export interface CardioJobStatus {
  job_id:      string;
  status:      'pending' | 'running' | 'done' | 'error';
  duration_s:  number | null;
  state_count: number | null;
  minio_key:   string | null;
  error:       string | null;
}

export interface CardioResult {
  stateNames:   string[];
  t:            number[];
  ys:           Record<string, number[]>;
  finalStates:  Record<string, number>;
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
