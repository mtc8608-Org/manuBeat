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
  id:         string;
  name:       string;
  hostname:   string | null;
  ip_address: string | null;
  location:   string | null;
  status:     string;            // online | offline | unknown
  last_seen:  string | null;
  hardware:   Record<string, any>;
  created_at: string;
  bed_label:  string | null;     // the bed this Pi serves
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

// A patient IS a Patient Registration survey answer, augmented with bedside data.
export interface Patient {
  id:           string;                 // survey_answers.id
  answers:      Record<string, any>;    // demographics
  submitted_at: string;
  file_id:      string | null;
  file_key:     string | null;
  bed_id:       string | null;          // current (active) bed
  bed_label:    string | null;
  node_name:    string | null;
  node_status:  string | null;
}

export interface BedAssignment {
  id:                string;
  patient_answer_id: string;
  bed_id:            string;
  bed_label:         string | null;
  started_at:        string;
  ended_at:          string | null;
  active:            boolean;
}
