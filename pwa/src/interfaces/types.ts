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
