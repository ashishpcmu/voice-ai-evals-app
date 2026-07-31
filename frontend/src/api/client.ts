import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.response.use(
  res => res,
  err => {
    const msg = err.response?.data?.error || err.message || 'An error occurred';
    if (err.response?.status !== 404) {
      toast.error(msg);
    }
    return Promise.reject(err);
  }
);

export default api;

// Agents
export const getAgents = () => api.get('/agents').then(r => r.data);
export const getAgent = (id: string) => api.get(`/agents/${id}`).then(r => r.data);
export const createAgent = (data: unknown) => api.post('/agents', data).then(r => r.data);
export const updateAgent = (id: string, data: unknown) => api.put(`/agents/${id}`, data).then(r => r.data);
export const deleteAgent = (id: string) => api.delete(`/agents/${id}`).then(r => r.data);

// Personas
export const getPersonas = (agentId?: string) => api.get('/personas', { params: { agent_id: agentId } }).then(r => r.data);
export const getPersona = (id: string) => api.get(`/personas/${id}`).then(r => r.data);
export const createPersona = (data: unknown) => api.post('/personas', data).then(r => r.data);
export const updatePersona = (id: string, data: unknown) => api.put(`/personas/${id}`, data).then(r => r.data);
export const deletePersona = (id: string) => api.delete(`/personas/${id}`).then(r => r.data);

// Scenarios
export const getScenarios = (params?: Record<string, string>) => api.get('/scenarios', { params }).then(r => r.data);
export const getScenario = (id: string) => api.get(`/scenarios/${id}`).then(r => r.data);
export const createScenario = (data: unknown) => api.post('/scenarios', data).then(r => r.data);
export const updateScenario = (id: string, data: unknown) => api.put(`/scenarios/${id}`, data).then(r => r.data);
export const deleteScenario = (id: string) => api.delete(`/scenarios/${id}`).then(r => r.data);
export const generateScenarios = (data: unknown) => api.post('/scenarios/generate', data).then(r => r.data);
export const importScenarios = (data: unknown) => api.post('/scenarios/import', data).then(r => r.data);
export const downloadTemplate = () => '/api/scenarios/export/template';

// Eval Runs
export const getEvalRuns = (agentId?: string) => api.get('/eval-runs', { params: { agent_id: agentId } }).then(r => r.data);
export const getEvalRun = (id: string) => api.get(`/eval-runs/${id}`).then(r => r.data);
export const createEvalRun = (data: unknown) => api.post('/eval-runs', data).then(r => r.data);
export const deleteEvalRun = (id: string) => api.delete(`/eval-runs/${id}`).then(r => r.data);
export const createUploadEvalRun = (data: unknown) => api.post('/eval-runs/upload', data).then(r => r.data);
export const getEvalRunResults = (id: string) => api.get(`/eval-runs/${id}/results`).then(r => r.data);
export const getEvalRunSummary = (id: string) => api.get(`/eval-runs/${id}/summary`).then(r => r.data);
export const cancelEvalRun = (id: string) => api.post(`/eval-runs/${id}/cancel`).then(r => r.data);
export const getVoiceProgress = (id: string) => api.get(`/eval-runs/${id}/voice-progress`).then(r => r.data);
export const cancelLiveKitEvalRun = (id: string) => api.post(`/eval-runs/${id}/livekit-cancel`).then(r => r.data);

// Human Review
export const startHumanReview = (runId: string, data: unknown) => api.post(`/eval-runs/${runId}/human-review/start`, data).then(r => r.data);
export const getReviewQueue = (runId: string) => api.get(`/eval-runs/${runId}/human-review/queue`).then(r => r.data);
export const submitRating = (runId: string, data: unknown) => api.post(`/eval-runs/${runId}/human-review/rate`, data).then(r => r.data);
export const getDisagreementReport = (runId: string) => api.get(`/eval-runs/${runId}/disagreement-report`).then(r => r.data);
export const generateDisagreementReport = (runId: string) => api.post(`/eval-runs/${runId}/disagreement-report/generate`).then(r => r.data);

// Trial Results
export const getTrialResult = (id: string) => api.get(`/trial-results/${id}`).then(r => r.data);
export const createAnnotation = (id: string, data: unknown) => api.post(`/trial-results/${id}/annotations`, data).then(r => r.data);
export const getAnnotations = (id: string) => api.get(`/trial-results/${id}/annotations`).then(r => r.data);
export const assignTrial = (id: string, data: unknown) => api.post(`/trial-results/${id}/assign`, data).then(r => r.data);
export const updateTrialStatus = (id: string, data: unknown) => api.put(`/trial-results/${id}/status`, data).then(r => r.data);
export const updateTrialTags = (id: string, tags: string[]) => api.put(`/trial-results/${id}/tags`, { tags }).then(r => r.data);

// Metrics
export const getMetrics = () => api.get('/metrics').then(r => r.data);
export const getMetric = (id: string) => api.get(`/metrics/${id}`).then(r => r.data);
export const createMetric = (data: unknown) => api.post('/metrics', data).then(r => r.data);
export const updateMetric = (id: string, data: unknown) => api.put(`/metrics/${id}`, data).then(r => r.data);
export const testMetric = (id: string, data: unknown) => api.post(`/metrics/${id}/test`, data).then(r => r.data);

// Compare
export const compareRuns = (data: unknown) => api.post('/compare', data).then(r => r.data);

// Upload
export const uploadFile = (formData: FormData) => api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
export const getUploadedFiles = () => api.get('/upload').then(r => r.data);
export const getFilePreview = (id: string) => api.get(`/upload/${id}/preview`).then(r => r.data);

// Settings
export const getSettings = () => api.get('/settings').then(r => r.data);
export const updateSettings = (data: unknown) => api.put('/settings', data).then(r => r.data);
export const testOpenAI = (data: unknown) => api.post('/settings/test-openai', data).then(r => r.data);
export const addTeamMember = (data: unknown) => api.post('/settings/team-members', data).then(r => r.data);
export const removeTeamMember = (id: string) => api.delete(`/settings/team-members/${id}`).then(r => r.data);
