import axios from 'axios';
import { createClient } from 'graphql-http';
import { API_BASE, GQL_URL, ENDPOINT } from '../constants';
import { ComponentResults, FileRecord, Survey, SurveyAnswer } from '../interfaces/types';

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
};
export default ApiService;
