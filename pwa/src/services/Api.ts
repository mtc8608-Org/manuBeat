import axios from 'axios';
import { createClient } from 'graphql-http';
import { API_BASE, GQL_URL, ENDPOINT, WS_BASE } from '../constants';
import {
  ComponentResults, FileRecord, Survey, SurveyAnswer,
  ModelConfig, ModelLayout, ModelMetadata, ScenarioConfig, RunMode, ModelRun, CardioJobStatus, CardioResult,
  CardioProcessResult, CardioPlotConfig, CardioProcConfig, HdfNode, HdfDataset,
  Patient, Bed, BedsideNode, BedAssignment,
  BedsideStream, BedsideSegment, NodeHeartbeat,
} from '../interfaces/types';

// ── Setup ────────────────────────────────────────────────────────────────────

const http = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-type': 'application/json' },
});

const getAuthHeader = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

http.interceptors.request.use(config => {
  const token = localStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const client = createClient({
  url: GQL_URL,
  headers: () => getAuthHeader(),
});

const gql = (query: string, variables?: Record<string, any>): Promise<any> =>
  new Promise((resolve, reject) => {
    let result: any;
    client.subscribe(
      { query, variables },
      { next: (data) => (result = data), error: reject, complete: () => resolve(result) }
    );
  });

// ── Component tree generics ───────────────────────────────────────────────────

type Domain = 'app' | 'survey';

const TREE_FIELDS = `
  id name type data options
  children { id name type data options
    children { id name type data options
      children { id name type data options
        children { id name type data options
          children { id name type data options
            children { id name type data options }
          }
        }
      }
    }
  }
`.trim();

const OPS: Record<Domain, {
  getOne: string; getList: string;
  create: string; createInput: string;
  update: string; del: string;
  link: string; unlink: string;
  swap: string;
}> = {
  app: {
    getOne:      'component',        getList:     'componentList',
    create:      'createComponent',  createInput: 'ComponentInput',
    update:      'updateComponent',  del:         'deleteComponent',
    link:        'createComponentRelation',
    unlink:      'deleteComponentRelation',
    swap:        'swapComponentPositions',
  },
  survey: {
    getOne:      'surveyComponent',        getList:     'surveyComponentList',
    create:      'createSurveyComponent',  createInput: 'SurveyComponentInput',
    update:      'updateSurveyComponent',  del:         'deleteSurveyComponent',
    link:        'createSurveyComponentRelation',
    unlink:      'deleteSurveyComponentRelation',
    swap:        'swapSurveyComponentPositions',
  },
};

const getComponentByName = async (name: string): Promise<ComponentResults | undefined> => {
  try {
    const result = await gql(`
      query ComponentByName($name: String) { componentByName(name: $name) { ${TREE_FIELDS} } }
    `, { name });
    return result?.data?.componentByName;
  } catch (e) { console.error('Error fetching component by name:', e); }
};

const getNodeTree = async (domain: Domain, id: string): Promise<ComponentResults | undefined> => {
  const { getOne } = OPS[domain];
  try {
    const result = await gql(`
      query NodeTree($id: String) { ${getOne}(id: $id) { ${TREE_FIELDS} } }
    `, { id });
    return result?.data?.[getOne]?.[0];
  } catch (e) { console.error(`Error fetching ${domain} node tree:`, e); }
};

const getNodeList = async (domain: Domain, type?: string): Promise<ComponentResults[]> => {
  const { getList } = OPS[domain];
  try {
    const result = await gql(`
      query NodeList($type: String) { ${getList}(type: $type) { id name type data options } }
    `, { type });
    return result?.data?.[getList] ?? [];
  } catch (e) { console.error(`Error fetching ${domain} node list:`, e); return []; }
};

const createNode = async (domain: Domain, name: string, type: string, data: any, options: any, children: any) => {
  const { create, createInput } = OPS[domain];
  try {
    return await gql(`
      mutation CreateNode($name: String!, $type: String, $data: JSON, $options: JSON, $children: [${createInput}]) {
        ${create}(name: $name, type: $type, data: $data, options: $options, children: $children) {
          id name type data options children { name type }
        }
      }
    `, { name, type, data, options, children });
  } catch (e) { console.error(`Error creating ${domain} node:`, e); }
};

const updateNode = async (domain: Domain, id: string, name: string, type: string, data: any, options: any) => {
  const { update } = OPS[domain];
  try {
    return await gql(`
      mutation UpdateNode($id: ID!, $name: String, $type: String, $data: JSON, $options: JSON) {
        ${update}(id: $id, name: $name, type: $type, data: $data, options: $options) {
          id name type data options
        }
      }
    `, { id, name, type, data, options });
  } catch (e) { console.error(`Error updating ${domain} node:`, e); }
};

const deleteNode = async (domain: Domain, id: string) => {
  const { del } = OPS[domain];
  try {
    return await gql(`mutation DeleteNode($id: ID!) { ${del}(id: $id) }`, { id });
  } catch (e) { console.error(`Error deleting ${domain} node:`, e); }
};

const linkNodes = async (domain: Domain, parent_id: string, child_id: string, position?: number) => {
  const { link } = OPS[domain];
  const withPos = position !== undefined;
  try {
    return await gql(
      withPos
        ? `mutation Link($parent_id: ID!, $child_id: ID!, $position: Float) { ${link}(parent_id: $parent_id, child_id: $child_id, position: $position) }`
        : `mutation Link($parent_id: ID!, $child_id: ID!) { ${link}(parent_id: $parent_id, child_id: $child_id) }`,
      withPos ? { parent_id, child_id, position } : { parent_id, child_id }
    );
  } catch (e) { console.error(`Error linking ${domain} nodes:`, e); }
};

const unlinkNodes = async (domain: Domain, parent_id: string, child_id: string) => {
  const { unlink } = OPS[domain];
  try {
    return await gql(`
      mutation Unlink($parent_id: ID!, $child_id: ID!) { ${unlink}(parent_id: $parent_id, child_id: $child_id) }
    `, { parent_id, child_id });
  } catch (e) { console.error(`Error unlinking ${domain} nodes:`, e); }
};

const swapNodes = async (domain: Domain, parent_id: string, child_id_a: string, child_id_b: string) => {
  const { swap: mut } = OPS[domain];
  try {
    return await gql(`
      mutation Swap($parent_id: ID!, $child_id_a: ID!, $child_id_b: ID!) {
        ${mut}(parent_id: $parent_id, child_id_a: $child_id_a, child_id_b: $child_id_b)
      }
    `, { parent_id, child_id_a, child_id_b });
  } catch (e) { console.error(`Error swapping ${domain} positions:`, e); }
};

// ── components ───────────────────────────────────────────────────────────────

const getList       = (type: string)                                                       => getNodeList('app', type);
const getComponent  = (id: string)                                                         => getNodeTree('app', id);
const createComponent = (name: string, type: string, data: any, options: any, children: any) => createNode('app', name, type, data, options, children);
const updateComponent = (id: string, name: string, type: string, data: any, options: any)    => updateNode('app', id, name, type, data, options);
const deleteComponent = (id: string)                                                         => deleteNode('app', id);

const getComponentParents = async (child_id: string): Promise<ComponentResults[]> => {
  try {
    const result = await gql(`
      query ComponentParents($child_id: ID!) {
        componentParents(child_id: $child_id) { id name type data options }
      }
    `, { child_id });
    return result?.data?.componentParents ?? [];
  } catch (e) { console.error('Error fetching component parents:', e); return []; }
};

// ── component_relationships ───────────────────────────────────────────────────

const getRelationsList = async (): Promise<any[]> => {
  try {
    const result = await gql(`
      query { componentRelationList { parent_name parent_id child_name child_id } }
    `);
    return result?.data?.componentRelationList ?? [];
  } catch (e) { console.error('Error fetching relations:', e); return []; }
};

const createRelation        = (parent_id: string, child_id: string)                           => linkNodes('app', parent_id, child_id);
const deleteRelation        = (parent_id: string, child_id: string)                           => unlinkNodes('app', parent_id, child_id);
const swapComponentPositions = (parent_id: string, child_id_a: string, child_id_b: string)   => swapNodes('app', parent_id, child_id_a, child_id_b);

// ── survey_components ─────────────────────────────────────────────────────────

const getSurveyComponent     = (id: string)                                                          => getNodeTree('survey', id);
const getSurveyComponentList = (type?: string)                                                       => getNodeList('survey', type);
const createSurveyComponent  = (name: string, type: string, data: any, options: any, children: any) => createNode('survey', name, type, data, options, children);
const updateSurveyComponent  = (id: string, name: string, type: string, data: any, options: any)    => updateNode('survey', id, name, type, data, options);
const deleteSurveyComponent  = (id: string)                                                          => deleteNode('survey', id);
const createSurveyComponentRelation   = (parent_id: string, child_id: string, position: number)   => linkNodes('survey', parent_id, child_id, position);
const deleteSurveyComponentRelation   = (parent_id: string, child_id: string)                       => unlinkNodes('survey', parent_id, child_id);
const swapSurveyComponentPositions    = (parent_id: string, child_id_a: string, child_id_b: string) => swapNodes('survey', parent_id, child_id_a, child_id_b);

const getSurveyComponentParents = async (child_id: string): Promise<ComponentResults[]> => {
  try {
    const result = await gql(`
      query SurveyComponentParents($child_id: ID!) {
        surveyComponentParents(child_id: $child_id) { id name type data options }
      }
    `, { child_id });
    return result?.data?.surveyComponentParents ?? [];
  } catch (e) { console.error('Error fetching survey component parents:', e); return []; }
};

// ── surveys ───────────────────────────────────────────────────────────────────

const getSurveys = async (): Promise<Survey[]> => {
  try {
    const result = await gql(`
      query { surveyList { id component_id title is_active created_at } }
    `);
    return result?.data?.surveyList ?? [];
  } catch (e) { console.error('Error fetching surveys:', e); return []; }
};

const getSurveyAnswers = async (survey_id: string, filter?: Record<string, any>): Promise<SurveyAnswer[]> => {
  try {
    const result = await gql(`
      query SurveyAnswers($survey_id: ID!, $filter: JSON) {
        surveyAnswers(survey_id: $survey_id, filter: $filter) {
          id survey_id owner_id owner_email answers submitted_at
        }
      }
    `, { survey_id, filter: filter ?? {} });
    return result?.data?.surveyAnswers ?? [];
  } catch (e) { console.error('Error fetching survey answers:', e); return []; }
};

const submitAnswer = async (survey_id: string, answers: Record<string, any>) => {
  try {
    return await gql(`
      mutation SubmitAnswer($survey_id: ID!, $answers: JSON) {
        submitAnswer(survey_id: $survey_id, answers: $answers) {
          id survey_id owner_id answers submitted_at
        }
      }
    `, { survey_id, answers });
  } catch (e) { console.error('Error submitting answer:', e); }
};

const updateAnswer = async (id: string, answers: Record<string, any>) => {
  try {
    return await gql(`
      mutation UpdateAnswer($id: ID!, $answers: JSON) {
        updateAnswer(id: $id, answers: $answers) {
          id survey_id owner_id answers submitted_at
        }
      }
    `, { id, answers });
  } catch (e) { console.error('Error updating answer:', e); }
};

const deleteAnswer = async (id: string) => {
  try {
    return await gql(`
      mutation DeleteAnswer($id: ID!) { deleteAnswer(id: $id) }
    `, { id });
  } catch (e) { console.error('Error deleting answer:', e); }
};

const createSurvey = async (component_id: string, title: string) => {
  try {
    return await gql(`
      mutation CreateSurvey($component_id: ID!, $title: String) {
        createSurvey(component_id: $component_id, title: $title) {
          id component_id title is_active created_at
        }
      }
    `, { component_id, title });
  } catch (e) { console.error('Error creating survey:', e); }
};

// ── [SURVEYS] stats + CSV export ──────────────────────────────────────────────
// manuBeat-owned: upstream removed its stats layer, this app kept the Stats tab.
// Backend lives in the fork's surveys domain (nodejs/schema/resolvers/surveys/,
// nodejs/routes/surveys/, python/api/domains/surveys/). Admin-only.

const getSurveyStats = async (survey_id: string): Promise<any | null> => {
  try {
    const result = await gql(
      `query SurveyStats($survey_id: ID!) { surveyStats(survey_id: $survey_id) }`,
      { survey_id },
    );
    return result?.data?.surveyStats ?? null;
  } catch (e) { console.error('Error fetching survey stats:', e); return null; }
};

// Returns the CSV bytes. The export route is auth-guarded, so it cannot be a
// plain <a href> — the browser would send no Authorization header.
const fetchSurveyExportBlob = async (survey_id: string): Promise<Blob> => {
  const res = await fetch(
    `${API_BASE}${ENDPOINT.SURVEY_EXPORT}/${survey_id}/stats/export`,
    { headers: getAuthHeader() },
  );
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
};

// ── end survey system ─────────────────────────────────────────────────────────

// ── auth & user management ────────────────────────────────────────────────────

const changePassword = async (currentPassword: string, newPassword: string) => {
  const res = await fetch(`${API_BASE}${ENDPOINT.CHANGE_PASSWORD}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body:    JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Change password failed');
  }
  return res.json();
};

const getUsers = async () => {
  const res = await fetch(`${API_BASE}${ENDPOINT.USERS}`, {
    headers: getAuthHeader(),
  });
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
};

const createUser = async (email: string, password: string, role: string) => {
  const res = await fetch(`${API_BASE}${ENDPOINT.USERS}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body:    JSON.stringify({ email, password, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Failed to create user');
  }
  return res.json();
};

const patchUser = async (id: string, updates: { is_active?: boolean; role?: string }) => {
  const res = await fetch(`${API_BASE}${ENDPOINT.USERS}/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body:    JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update user');
  return res.json();
};

// ── roles (backoffice Roles page — admin only) ────────────────────────────────

export interface Role {
  id: string; name: string; tier: string;
  description: string | null; is_system: boolean;
  created_at: string; users: string;   // users = count of holders, stringified
}

const ROLE_FIELDS = 'id name tier description is_system created_at users';

// Server-side guards (system roles, roles in use) produce user-facing
// messages — surface GraphQL errors instead of swallowing them.
const throwOnGqlErrors = (result: any) => {
  if (result?.errors?.length) throw new Error(result.errors[0].message);
  return result;
};

const getRoles = async (): Promise<Role[]> => {
  try {
    const result = await gql(`query { roleList { ${ROLE_FIELDS} } }`);
    return result?.data?.roleList ?? [];
  } catch (e) { console.error('Error fetching roles:', e); return []; }
};

const createRole = async (name: string, tier: string, description?: string): Promise<Role> => {
  const result = throwOnGqlErrors(await gql(`
    mutation CreateRole($name: String!, $tier: String!, $description: String) {
      createRole(name: $name, tier: $tier, description: $description) { ${ROLE_FIELDS} }
    }`, { name, tier, description }));
  return result.data.createRole;
};

const updateRole = async (id: string, updates: { tier?: string; description?: string }): Promise<Role> => {
  const result = throwOnGqlErrors(await gql(`
    mutation UpdateRole($id: ID!, $tier: String, $description: String) {
      updateRole(id: $id, tier: $tier, description: $description) { ${ROLE_FIELDS} }
    }`, { id, ...updates }));
  return result.data.updateRole;
};

const deleteRole = async (id: string): Promise<boolean> => {
  const result = throwOnGqlErrors(await gql(`
    mutation DeleteRole($id: ID!) { deleteRole(id: $id) }`, { id }));
  return result.data.deleteRole;
};

// ── account self-service (profile + secrets keychain) ────────────────────────

export interface UserProfile { owner_id: string | null; data: Record<string, any>; }

// The caller's own profile (form-driven display data; shape = form_user_profile).
const getUserProfile = async (): Promise<UserProfile | null> => {
  try {
    const result = await gql(`query { userProfile { owner_id data } }`);
    return result?.data?.userProfile ?? null;
  } catch (e) { console.error('Error fetching user profile:', e); return null; }
};

const upsertUserProfile = async (data: Record<string, any>): Promise<UserProfile | null> => {
  try {
    const result = await gql(`
      mutation UpsertUserProfile($data: JSON) {
        upsertUserProfile(data: $data) { owner_id data }
      }`, { data });
    return result?.data?.upsertUserProfile ?? null;
  } catch (e) { console.error('Error saving user profile:', e); throw e; }
};

// User secrets keychain — metadata only, the raw value is write-only.
export interface UserSecret {
  name: string; label: string; isSet: boolean;
  last4: string | null; updated_at: string | null;
}

const getUserSecrets = async (): Promise<UserSecret[]> => {
  try {
    const result = await gql(`query { userSecrets { name label isSet last4 updated_at } }`);
    return result?.data?.userSecrets ?? [];
  } catch (e) { console.error('Error fetching user secrets:', e); return []; }
};

const setUserSecret = async (name: string, value: string): Promise<UserSecret | null> => {
  try {
    const result = await gql(`
      mutation SetUserSecret($name: String!, $value: String!) {
        setUserSecret(name: $name, value: $value) { name label isSet last4 updated_at }
      }`, { name, value });
    return result?.data?.setUserSecret ?? null;
  } catch (e) { console.error('Error saving user secret:', e); throw e; }
};

const clearUserSecret = async (name: string): Promise<boolean> => {
  try {
    const result = await gql(`
      mutation ClearUserSecret($name: String!) { clearUserSecret(name: $name) }`, { name });
    return result?.data?.clearUserSecret ?? false;
  } catch (e) { console.error('Error clearing user secret:', e); throw e; }
};

// ── files ─────────────────────────────────────────────────────────────────────

const getFiles = async (): Promise<FileRecord[]> => {
  const res = await fetch(`${API_BASE}${ENDPOINT.FILES}`, { headers: getAuthHeader() });
  if (!res.ok) throw new Error('Failed to fetch files');
  return res.json();
};

const uploadFile = async (file: File, description?: string) => {
  const form = new FormData();
  form.append('file', file);
  if (description) form.append('description', description);
  const res = await fetch(`${API_BASE}${ENDPOINT.FILES_UPLOAD}`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error((err as any).error ?? 'Upload failed') as Error & { status: number };
    e.status = res.status;
    throw e;
  }
  return res.json();
};

// Partial update. Only the fields passed are written, so publishing a file as a
// content asset does not clobber its description (and vice versa).
const patchFile = async (id: string, patch: { description?: string; is_public?: boolean }) => {
  const res = await fetch(`${API_BASE}${ENDPOINT.FILES}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update file');
  return res.json();
};

const deleteFile = async (id: string) => {
  const res = await fetch(`${API_BASE}${ENDPOINT.FILES}/${id}`, {
    method: 'DELETE',
    headers: getAuthHeader(),
  });
  if (!res.ok) throw new Error('Failed to delete file');
  return res.json();
};

// Fetch a stored file's bytes (auth header) for download or preview.
const fetchFileBlob = async (id: string): Promise<Blob> => {
  const res = await fetch(`${API_BASE}${ENDPOINT.FILES}/${id}/download`, { headers: getAuthHeader() });
  if (!res.ok) throw new Error('Download failed');
  return res.blob();
};

// ── [MEDICAL] Cardio model configs ───────────────────────────────────────────

const getModelConfigs = async (): Promise<ModelConfig[]> => {
  try {
    const result = await gql(`{ modelConfigs { id name description config layout created_at } }`);
    return result?.data?.modelConfigs ?? [];
  } catch (e) { console.error('getModelConfigs error:', e); return []; }
};

const createModelConfig = async (name: string, description: string, config: Record<string, any>): Promise<ModelConfig> => {
  const result = await gql(
    `mutation CreateModelConfig($name: String!, $description: String, $config: JSON!) {
       createModelConfig(name: $name, description: $description, config: $config) {
         id name description config layout created_at
       }
     }`,
    { name, description, config },
  );
  return result?.data?.createModelConfig;
};

const updateModelConfig = async (id: string, fields: { name?: string; description?: string; config?: Record<string, any>; layout?: ModelLayout }): Promise<ModelConfig> => {
  const result = await gql(
    `mutation UpdateModelConfig($id: ID!, $name: String, $description: String, $config: JSON, $layout: JSON) {
       updateModelConfig(id: $id, name: $name, description: $description, config: $config, layout: $layout) {
         id name description config layout created_at
       }
     }`,
    { id, ...fields },
  );
  return result?.data?.updateModelConfig;
};

const deleteModelConfig = async (id: string): Promise<void> => {
  await gql(`mutation { deleteModelConfig(id: "${id}") }`);
};

const deleteModelRun = async (id: string): Promise<void> => {
  await gql(`mutation { deleteModelRun(id: "${id}") }`);
};

const getModelRuns = async (config_id?: string): Promise<ModelRun[]> => {
  try {
    const result = await gql(
      `query ModelRuns($config_id: ID) {
         modelRuns(config_id: $config_id) {
           id config_id scenario_id mode status minio_key metadata created_at completed_at
         }
       }`,
      { config_id: config_id ?? null },
    );
    return result?.data?.modelRuns ?? [];
  } catch (e) { console.error('getModelRuns error:', e); return []; }
};

// ── [MEDICAL] Cardio scenario configs ─────────────────────────────────────────

const getScenarioConfigs = async (): Promise<ScenarioConfig[]> => {
  try {
    const result = await gql(`{ scenarioConfigs { id name description config created_at } }`);
    return result?.data?.scenarioConfigs ?? [];
  } catch (e) { console.error('getScenarioConfigs error:', e); return []; }
};

const createScenarioConfig = async (name: string, description: string, config: Record<string, any>): Promise<ScenarioConfig> => {
  const result = await gql(
    `mutation CreateScenarioConfig($name: String!, $description: String, $config: JSON!) {
       createScenarioConfig(name: $name, description: $description, config: $config) {
         id name description config created_at
       }
     }`,
    { name, description, config },
  );
  return result?.data?.createScenarioConfig;
};

const updateScenarioConfig = async (id: string, fields: { name?: string; description?: string; config?: Record<string, any> }): Promise<ScenarioConfig> => {
  const result = await gql(
    `mutation UpdateScenarioConfig($id: ID!, $name: String, $description: String, $config: JSON) {
       updateScenarioConfig(id: $id, name: $name, description: $description, config: $config) {
         id name description config created_at
       }
     }`,
    { id, ...fields },
  );
  return result?.data?.updateScenarioConfig;
};

const deleteScenarioConfig = async (id: string): Promise<void> => {
  await gql(`mutation { deleteScenarioConfig(id: "${id}") }`);
};

// ── [MEDICAL] Cardio plot configs ─────────────────────────────────────────────

const getPlotConfigs = async (): Promise<CardioPlotConfig[]> => {
  try {
    const result = await gql(`{ plotConfigs { id name description config created_at } }`);
    return result?.data?.plotConfigs ?? [];
  } catch (e) { console.error('getPlotConfigs error:', e); return []; }
};

const createPlotConfig = async (name: string, description: string, config: Record<string, any>): Promise<CardioPlotConfig> => {
  const result = await gql(
    `mutation CreatePlotConfig($name: String!, $description: String, $config: JSON!) {
       createPlotConfig(name: $name, description: $description, config: $config) {
         id name description config created_at
       }
     }`,
    { name, description, config },
  );
  return result?.data?.createPlotConfig;
};

const updatePlotConfig = async (id: string, fields: { name?: string; description?: string; config?: Record<string, any> }): Promise<CardioPlotConfig> => {
  const result = await gql(
    `mutation UpdatePlotConfig($id: ID!, $name: String, $description: String, $config: JSON) {
       updatePlotConfig(id: $id, name: $name, description: $description, config: $config) {
         id name description config created_at
       }
     }`,
    { id, ...fields },
  );
  return result?.data?.updatePlotConfig;
};

const deletePlotConfig = async (id: string): Promise<void> => {
  await gql(`mutation { deletePlotConfig(id: "${id}") }`);
};

// ── [MEDICAL] Cardio proc configs ─────────────────────────────────────────────

const getProcConfigs = async (): Promise<CardioProcConfig[]> => {
  try {
    const result = await gql(`{ procConfigs { id name description config created_at } }`);
    return result?.data?.procConfigs ?? [];
  } catch (e) { console.error('getProcConfigs error:', e); return []; }
};

const createProcConfig = async (name: string, description: string, config: Record<string, any>): Promise<CardioProcConfig> => {
  const result = await gql(
    `mutation CreateProcConfig($name: String!, $description: String, $config: JSON!) {
       createProcConfig(name: $name, description: $description, config: $config) {
         id name description config created_at
       }
     }`,
    { name, description, config },
  );
  return result?.data?.createProcConfig;
};

const updateProcConfig = async (id: string, fields: { name?: string; description?: string; config?: Record<string, any> }): Promise<CardioProcConfig> => {
  const result = await gql(
    `mutation UpdateProcConfig($id: ID!, $name: String, $description: String, $config: JSON) {
       updateProcConfig(id: $id, name: $name, description: $description, config: $config) {
         id name description config created_at
       }
     }`,
    { id, ...fields },
  );
  return result?.data?.updateProcConfig;
};

const deleteProcConfig = async (id: string): Promise<void> => {
  await gql(`mutation { deleteProcConfig(id: "${id}") }`);
};

// ── [MEDICAL] Cardio REST (run, status, result, HDF5, processing) ─────────────

// A run is model (structure) + scenario (values) + mode. Pass scenario_id for a
// stored scenario; scenario_json carries unsaved Simulator edits and wins when both
// are sent. simulation_params holds numeric overrides only (runTime, dt, dtDense,
// solver, stack) — anything omitted keeps the scenario's own value.
const runCardioModel = async (
  config_id: string | null,
  model_json: Record<string, any>,
  scenario_id: string | null,
  mode: RunMode,
  simulation_params: Record<string, any>,
  name?: string,
  scenario_json?: Record<string, any>,
): Promise<{ run_id: string; job_id: string; status: string }> => {
  const res = await http.post('/cardio/run', {
    config_id, model_json, scenario_id, scenario_json, mode, simulation_params, name,
  });
  return res.data;
};

const getCardioStatus = async (job_id: string): Promise<CardioJobStatus> => {
  const res = await http.get(`/cardio/status/${job_id}`);
  return res.data;
};

const getCardioResult = async (job_id: string): Promise<CardioResult> => {
  const res = await http.get(`/cardio/result/${job_id}`);
  return res.data;
};

const getCardioResultByRunId = async (run_id: string): Promise<CardioResult> => {
  const res = await http.get(`/cardio/result-by-run/${run_id}`);
  return res.data;
};

const getCardioConfigs = async (): Promise<{ filename: string; name: string }[]> => {
  const res = await http.get('/cardio/configs');
  return res.data;
};

const getCardioModel = async (filename: string): Promise<Record<string, any>> => {
  const res = await http.get(`/cardio/model/${filename}`);
  return res.data;
};

// config/metadata.json — the gas-region table (state gas|dissolved + species map, -1.0
// meaning absent) the model generator resolves every compartment's gasRegion against.
// The Model Sandbox reads it so its region/species pickers come from the same file the
// library does, never a second hard-coded copy.
const getCardioMetadata = async (): Promise<ModelMetadata> => {
  const res = await http.get('/cardio/metadata');
  return res.data;
};

const getHdf5Tree = async (run_id: string): Promise<HdfNode> => {
  const res = await http.get(`/cardio/hdf5/tree/${run_id}`);
  return res.data;
};

const getHdf5Dataset = async (
  run_id: string,
  path:   string,
  start?: number,
  end?:   number,
): Promise<HdfDataset> => {
  const params = new URLSearchParams({ path });
  if (start !== undefined) params.set('start', String(start));
  if (end   !== undefined) params.set('end',   String(end));
  const res = await http.get(`/cardio/hdf5/dataset/${run_id}?${params}`);
  return res.data;
};

const repackHdf5 = async (run_id: string): Promise<void> => {
  await http.post(`/cardio/hdf5/repack/${run_id}`);
};

const deleteHdf5Dataset = async (run_id: string, path: string): Promise<void> => {
  await http.delete(`/cardio/hdf5/dataset/${run_id}`, { data: { path } });
};

// Resolves with the appended outputs and the replay's console; a failure rejects
// with { error, traceback, logs } in the response body (see routes/medical/models.js).
const processRun = async (
  run_id: string, proc_config_id: string, proc_run_name: string,
): Promise<CardioProcessResult> => {
  const res = await http.post(`/cardio/process/${run_id}`, { proc_config_id, proc_run_name });
  return res.data;
};

const getProcessedGroups = async (run_id: string): Promise<string[]> => {
  const res = await http.get(`/cardio/processed-groups/${run_id}`);
  return res.data.group_names ?? [];
};

const getProcessedOutputs = async (run_id: string, proc_config_id: string): Promise<Record<string, number[]>> => {
  const res = await http.get(`/cardio/processed/${run_id}/${proc_config_id}`);
  return res.data.outputs ?? {};
};

// ── [BEDSIDE] Data Collection ─────────────────────────────────────────────────

const PATIENT_FIELDS = `
  id first_name last_name date_of_birth sex identifier email phone address notes extra
  created_at file_id file_key bed_id bed_label node_key node_name node_status
`.trim();

const getPatients = async (): Promise<Patient[]> => {
  try {
    const result = await gql(`{ patients { ${PATIENT_FIELDS} } }`);
    return result?.data?.patients ?? [];
  } catch (e) { console.error('getPatients error:', e); return []; }
};

const getBeds = async (): Promise<Bed[]> => {
  try {
    const result = await gql(`{
      beds { id label node_id node_name node_status node_location created_at }
    }`);
    return result?.data?.beds ?? [];
  } catch (e) { console.error('getBeds error:', e); return []; }
};

const NODE_FIELDS = `
  id node_key name hostname ip_address location status online last_seen
  agent_version hardware created_at bed_label
`.trim();

const getBedsideNodes = async (): Promise<BedsideNode[]> => {
  try {
    const result = await gql(`{ bedsideNodes { ${NODE_FIELDS} } }`);
    return result?.data?.bedsideNodes ?? [];
  } catch (e) { console.error('getBedsideNodes error:', e); return []; }
};

const getBedAssignments = async (patient_id?: string): Promise<BedAssignment[]> => {
  try {
    const result = await gql(`
      query BedAssignments($patient_id: ID) {
        bedAssignments(patient_id: $patient_id) {
          id patient_id bed_id bed_label started_at ended_at active
        }
      }`,
      { patient_id: patient_id ?? null },
    );
    return result?.data?.bedAssignments ?? [];
  } catch (e) { console.error('getBedAssignments error:', e); return []; }
};

// Create a patient (patients row + empty data file). REST — touches MinIO.
const createPatient = async (demographics: Record<string, any>): Promise<{ patient_id: string; file_id: string; file_key: string }> => {
  const res = await fetch(`${API_BASE}${ENDPOINT.BEDSIDE_PATIENTS}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body:    JSON.stringify({ demographics }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Failed to create patient');
  }
  return res.json();
};

const deletePatient = async (patientId: string): Promise<void> => {
  const res = await fetch(`${API_BASE}${ENDPOINT.BEDSIDE_PATIENTS}/${patientId}`, {
    method: 'DELETE', headers: getAuthHeader(),
  });
  if (!res.ok) throw new Error('Failed to delete patient');
};

const assignPatientToBed = async (patient_id: string, bed_id: string): Promise<void> => {
  await gql(`
    mutation Assign($patient_id: ID!, $bed_id: ID!) {
      assignPatientToBed(patient_id: $patient_id, bed_id: $bed_id) { id }
    }`,
    { patient_id, bed_id },
  );
};

// ── nodes + device tokens ─────────────────────────────────────────────────────
const createBedsideNode = async (name: string, node_key: string, location?: string): Promise<BedsideNode | undefined> => {
  const result = await gql(`
    mutation CreateNode($name: String!, $node_key: String!, $location: String) {
      createBedsideNode(name: $name, node_key: $node_key, location: $location) { ${NODE_FIELDS} token }
    }`,
    { name, node_key, location: location ?? null },
  );
  return result?.data?.createBedsideNode;
};

const rotateNodeToken = async (id: string): Promise<BedsideNode | undefined> => {
  const result = await gql(`
    mutation Rotate($id: ID!) { rotateNodeToken(id: $id) { id token } }`, { id });
  return result?.data?.rotateNodeToken;
};

const deleteBedsideNode = async (id: string): Promise<void> => {
  await gql(`mutation Del($id: ID!) { deleteBedsideNode(id: $id) }`, { id });
};

// ── live telemetry reads ──────────────────────────────────────────────────────
const getBedsideStreams = async (node_id: string): Promise<BedsideStream[]> => {
  try {
    const result = await gql(`
      query Streams($node_id: ID!) {
        bedsideStreams(node_id: $node_id) {
          id stream_id modality group channel units metric sampling_hz source last_seq last_time_us
        }
      }`, { node_id });
    return result?.data?.bedsideStreams ?? [];
  } catch (e) { console.error('getBedsideStreams error:', e); return []; }
};

const getLatestSegments = async (node_id: string, stream_id?: string, limit = 50): Promise<BedsideSegment[]> => {
  try {
    const result = await gql(`
      query Segments($node_id: ID!, $stream_id: String, $limit: Int) {
        latestSegments(node_id: $node_id, stream_id: $stream_id, limit: $limit) {
          id stream_id seq start_time_us sampling_hz duration samples quality
        }
      }`, { node_id, stream_id: stream_id ?? null, limit });
    return result?.data?.latestSegments ?? [];
  } catch (e) { console.error('getLatestSegments error:', e); return []; }
};

const getNodeHeartbeats = async (node_id: string, limit = 20): Promise<NodeHeartbeat[]> => {
  try {
    const result = await gql(`
      query Heartbeats($node_id: ID!, $limit: Int) {
        nodeHeartbeats(node_id: $node_id, limit: $limit) {
          id ts_ms cpu_temp_c disk_free_bytes buffer_pending last_sample_us agent_version received_at
        }
      }`, { node_id, limit });
    return result?.data?.nodeHeartbeats ?? [];
  } catch (e) { console.error('getNodeHeartbeats error:', e); return []; }
};

// Live segment stream over WebSocket. Returns the socket; caller handles messages + close.
// The token goes in the query string because a browser cannot set headers on a
// WebSocket handshake; the hub (nodejs/realtime.js) verifies it and requires
// tier 'admin' before the socket receives anything.
const subscribeBedside = (nodeKey: string, onMessage: (msg: any) => void, streamId?: string): WebSocket => {
  const params = new URLSearchParams({ node: nodeKey });
  if (streamId) params.set('stream', streamId);
  const token = localStorage.getItem('auth_token');
  if (token) params.set('token', token);
  const ws = new WebSocket(`${WS_BASE}/ws/bedside?${params}`);
  ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch { /* ignore */ } };
  return ws;
};

const endBedAssignment = async (id: string): Promise<void> => {
  await gql(`mutation EndAssignment($id: ID!) { endBedAssignment(id: $id) }`, { id });
};

const createBed = async (label: string, node_id?: string): Promise<Bed | undefined> => {
  const result = await gql(`
    mutation CreateBed($label: String!, $node_id: ID) {
      createBed(label: $label, node_id: $node_id) {
        id label node_id node_name node_status node_location created_at
      }
    }`,
    { label, node_id: node_id ?? null },
  );
  return result?.data?.createBed;
};

const updateBedsideNode = async (
  id: string,
  fields: { name?: string; hostname?: string; ip_address?: string; location?: string; status?: string; hardware?: Record<string, any> },
): Promise<BedsideNode | undefined> => {
  const result = await gql(`
    mutation UpdateNode($id: ID!, $name: String, $hostname: String, $ip_address: String, $location: String, $status: String, $hardware: JSON) {
      updateBedsideNode(id: $id, name: $name, hostname: $hostname, ip_address: $ip_address, location: $location, status: $status, hardware: $hardware) {
        id name hostname ip_address location status last_seen hardware created_at bed_label
      }
    }`,
    { id, ...fields },
  );
  return result?.data?.updateBedsideNode;
};

// ── AI content generation ─────────────────────────────────────────────────────

export interface GenMessage { role: 'user' | 'assistant'; content: string; }
export interface GenNode    { name: string; type: string; data: Record<string, any>; options: Record<string, any>; }
export interface GenResult  { userMessage: string; userSummary: string; assistantRaw: string; message: string; nodes: GenNode[]; }

const generateContent = async (
  files: File[],
  history: GenMessage[],
  userText: string,
  onDelta: (text: string) => void,
  onNode:  (node: GenNode) => void,
): Promise<GenResult> => {
  const form = new FormData();
  form.append('history', JSON.stringify(history));
  form.append('userText', userText);
  for (const f of files) form.append('files', f);
  const res = await fetch(`${API_BASE}${ENDPOINT.GENERATE_CONTENT}`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Generation failed');
  }
  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: GenResult | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === 'delta')      onDelta(event.text);
      else if (event.type === 'node')  onNode(event.node as GenNode);
      else if (event.type === 'done')  result = event as GenResult;
      else if (event.type === 'error') throw new Error(event.error);
    }
  }
  if (!result) throw new Error('No result received');
  return result;
};

// ── export ───────────────────────────────────────────────────────────────────

const ApiService = {
  // components
  getList, getComponent, getComponentByName, createComponent, updateComponent, deleteComponent, getComponentParents,
  // component_relationships
  getRelationsList, createRelation, deleteRelation, swapComponentPositions,
  // survey_components
  getSurveyComponent, getSurveyComponentList, getSurveyComponentParents,
  createSurveyComponent, updateSurveyComponent, deleteSurveyComponent,
  createSurveyComponentRelation, deleteSurveyComponentRelation, swapSurveyComponentPositions,
  // surveys
  getSurveys, getSurveyAnswers, submitAnswer, updateAnswer, deleteAnswer, createSurvey,
  // [SURVEYS] stats + export
  getSurveyStats, fetchSurveyExportBlob,
  // auth & user management
  changePassword, getUsers, createUser, patchUser,
  // roles
  getRoles, createRole, updateRole, deleteRole,
  // account self-service (profile + secrets keychain)
  getUserProfile, upsertUserProfile, getUserSecrets, setUserSecret, clearUserSecret,
  // files
  getFiles, uploadFile, patchFile, deleteFile, fetchFileBlob,
  // AI content generation
  generateContent,
  // [MEDICAL] model configs
  getModelConfigs, createModelConfig, updateModelConfig, deleteModelConfig, deleteModelRun, getModelRuns,
  // [MEDICAL] scenario configs
  getScenarioConfigs, createScenarioConfig, updateScenarioConfig, deleteScenarioConfig,
  // [MEDICAL] plot configs
  getPlotConfigs, createPlotConfig, updatePlotConfig, deletePlotConfig,
  // [MEDICAL] proc configs
  getProcConfigs, createProcConfig, updateProcConfig, deleteProcConfig,
  // [MEDICAL] cardio REST
  runCardioModel, getCardioStatus, getCardioResult, getCardioResultByRunId, getCardioConfigs, getCardioModel,
  getCardioMetadata,
  // [MEDICAL] HDF5
  getHdf5Tree, getHdf5Dataset, repackHdf5, deleteHdf5Dataset,
  // [MEDICAL] processing
  processRun, getProcessedGroups, getProcessedOutputs,
  // [BEDSIDE] Data Collection
  getPatients, getBeds, getBedsideNodes, getBedAssignments,
  createPatient, deletePatient, assignPatientToBed, endBedAssignment,
  createBed, updateBedsideNode,
  createBedsideNode, rotateNodeToken, deleteBedsideNode,
  getBedsideStreams, getLatestSegments, getNodeHeartbeats, subscribeBedside,
};
export default ApiService;
