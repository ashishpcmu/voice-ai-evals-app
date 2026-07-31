import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus, Trash2, Upload as UploadIcon, FileText, CheckCircle,
  ChevronRight, ChevronLeft, Play, AlertCircle, Clock, X
} from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { getMetrics, getAgents, getUploadedFiles, uploadFile, createUploadEvalRun } from '../../api/client';
import { Metric, Agent } from '../../types';

// ── Types ──────────────────────────────────────────────────────────────────

interface UploadedFile {
  id: string;
  original_name: string;
  file_type: string;
  parsing_status: string;
  created_at: string;
}

interface ScenarioItem {
  id: string; // local draft id
  name: string;
  description: string;
  seed_utterance: string;
  expected_outcome_type: 'natural_language' | 'tool_call' | 'kpi_threshold';
  expected_outcome_value: string;
  transcript_file_id: string;
  transcript_file_name: string;
}

// ── Scenario form schema ───────────────────────────────────────────────────

const scenarioSchema = z.object({
  name: z.string().min(1, 'Scenario name is required'),
  description: z.string().optional(),
  seed_utterance: z.string().optional(),
  expected_outcome_type: z.enum(['natural_language', 'tool_call', 'kpi_threshold']),
  expected_outcome_value: z.string().optional(),
  transcript_file_id: z.string().min(1, 'Select a transcript file'),
});
type ScenarioFormData = z.infer<typeof scenarioSchema>;

// ── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({ step, total }: { step: number; total: number }) {
  const steps = ['Connect to an Agent', 'Add Transcripts', 'Review & Start'];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = idx < step;
        const active = idx === step;
        return (
          <div key={idx} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done ? 'bg-success-green text-white' : active ? 'bg-primary-blue text-white' : 'bg-brand-border text-gray-text'
              }`}>
                {done ? <CheckCircle size={14} /> : idx}
              </div>
              <span className={`text-sm font-medium ${active ? 'text-dark-text' : done ? 'text-success-green' : 'text-gray-text'}`}>
                {label}
              </span>
            </div>
            {i < total - 1 && (
              <div className={`w-12 h-px mx-3 ${done ? 'bg-success-green' : 'bg-brand-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Add Scenario Panel ─────────────────────────────────────────────────────

function AddScenarioPanel({
  files,
  onSave,
  onCancel,
  onUploadFile,
  uploading,
}: {
  files: UploadedFile[];
  onSave: (s: Omit<ScenarioItem, 'id'>) => void;
  onCancel: () => void;
  onUploadFile: (file: File) => void;
  uploading: boolean;
}) {
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<ScenarioFormData>({
    resolver: zodResolver(scenarioSchema),
    defaultValues: { expected_outcome_type: 'natural_language' },
  });

  const outcomeType = watch('expected_outcome_type');
  const selectedFileId = watch('transcript_file_id');
  const parsedFiles = files.filter(f => f.parsing_status === 'complete');

  // Auto-fill seed from selected file's first user turn
  const handleFileSelect = (fileId: string) => {
    setValue('transcript_file_id', fileId);
    const file = files.find(f => f.id === fileId);
    if (file) {
      // Try to auto-fill the scenario name from the file name
      const baseName = file.original_name.replace(/\.(pdf|docx)$/i, '').replace(/[-_]/g, ' ');
      setValue('name', baseName);
    }
  };

  const onSubmit = (data: ScenarioFormData) => {
    const file = files.find(f => f.id === data.transcript_file_id);
    onSave({
      name: data.name,
      description: data.description || '',
      seed_utterance: data.seed_utterance || '',
      expected_outcome_type: data.expected_outcome_type,
      expected_outcome_value: data.expected_outcome_value || '',
      transcript_file_id: data.transcript_file_id,
      transcript_file_name: file?.original_name || '',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onCancel} />
      <div className="w-[520px] bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-dark-text">Add Transcript Details</h2>
          <button onClick={onCancel} className="p-1 hover:bg-gray-100 rounded">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 flex flex-col">
          <div className="px-6 py-5 flex-1 space-y-5">

            {/* Transcript file selection */}
            <div>
              <label className="block text-sm font-medium text-dark-text mb-2">
                Call Transcript <span className="text-error-red">*</span>
              </label>
              {parsedFiles.length === 0 ? (
                <div className="border border-dashed border-brand-border rounded-lg p-4 text-center text-sm text-gray-text">
                  No parsed transcripts available. Upload one below.
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto border border-brand-border rounded-lg divide-y divide-gray-100">
                  {parsedFiles.map(f => (
                    <label key={f.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-light-blue transition-colors ${selectedFileId === f.id ? 'bg-light-blue' : ''}`}>
                      <input
                        type="radio"
                        name="transcript_file_id"
                        value={f.id}
                        checked={selectedFileId === f.id}
                        onChange={() => handleFileSelect(f.id)}
                        className="accent-primary-blue"
                      />
                      <FileText size={14} className="text-gray-text flex-shrink-0" />
                      <span className="text-sm text-dark-text flex-1 truncate">{f.original_name}</span>
                      <Badge variant="green"><CheckCircle size={10} /> Parsed</Badge>
                    </label>
                  ))}
                </div>
              )}
              {errors.transcript_file_id && (
                <p className="text-xs text-error-red mt-1">{errors.transcript_file_id.message}</p>
              )}

              {/* Inline upload */}
              <div className="mt-3">
                <label
                  className="flex items-center gap-2 text-xs text-primary-blue cursor-pointer hover:underline"
                  htmlFor="inline-upload"
                >
                  <UploadIcon size={12} />
                  {uploading ? 'Uploading…' : 'Upload a new transcript'}
                </label>
                <input
                  id="inline-upload"
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  disabled={uploading}
                  onChange={e => e.target.files?.[0] && onUploadFile(e.target.files[0])}
                />
              </div>
            </div>

            {/* Scenario name */}
            <div>
              <label className="block text-sm font-medium text-dark-text mb-1">
                Scenario Name <span className="text-error-red">*</span>
              </label>
              <input
                {...register('name')}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue"
                placeholder="e.g. Standard Cancellation Call"
              />
              {errors.name && <p className="text-xs text-error-red mt-1">{errors.name.message}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-dark-text mb-1">Description</label>
              <textarea
                {...register('description')}
                rows={2}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue resize-none"
                placeholder="What is this call transcript testing?"
              />
            </div>

            {/* Expected outcome type */}
            <div>
              <label className="block text-sm font-medium text-dark-text mb-2">Expected Outcome</label>
              <div className="flex gap-3">
                {[
                  { value: 'natural_language', label: 'Natural Language' },
                  { value: 'tool_call', label: 'Tool Call' },
                  { value: 'kpi_threshold', label: 'KPI Threshold' },
                ].map(opt => (
                  <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      value={opt.value}
                      {...register('expected_outcome_type')}
                      className="accent-primary-blue"
                    />
                    <span className="text-sm text-dark-text">{opt.label}</span>
                  </label>
                ))}
              </div>

              <div className="mt-3">
                {outcomeType === 'natural_language' && (
                  <textarea
                    {...register('expected_outcome_value')}
                    rows={2}
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue resize-none"
                    placeholder="Describe what a passing outcome looks like in plain English…"
                  />
                )}
                {outcomeType === 'tool_call' && (
                  <input
                    {...register('expected_outcome_value')}
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue"
                    placeholder="Tool name that must be called, e.g. process_cancellation"
                  />
                )}
                {outcomeType === 'kpi_threshold' && (
                  <input
                    {...register('expected_outcome_value')}
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue"
                    placeholder="e.g. score >= 0.8"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-brand-border flex justify-end gap-3 flex-shrink-0">
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="primary">Add Transcript Details</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Step 1: Run Setup ──────────────────────────────────────────────────────

function StepRunSetup({
  runName, setRunName,
  selectedMetrics, setSelectedMetrics,
  agents, selectedAgentId, setSelectedAgentId,
  onNext,
}: {
  runName: string; setRunName: (v: string) => void;
  selectedMetrics: string[]; setSelectedMetrics: (v: string[]) => void;
  agents: Agent[]; selectedAgentId: string; setSelectedAgentId: (v: string) => void;
  onNext: () => void;
}) {
  const { data: metrics = [] } = useQuery({ queryKey: ['metrics'], queryFn: getMetrics });

  const toggleMetric = (id: string) => {
    setSelectedMetrics(selectedMetrics.includes(id)
      ? selectedMetrics.filter(m => m !== id)
      : [...selectedMetrics, id]);
  };

  const canProceed = runName.trim().length > 0 && selectedAgentId.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-dark-text mb-1">
          Agent <span className="text-error-red">*</span>
        </label>
        <select
          value={selectedAgentId}
          onChange={e => setSelectedAgentId(e.target.value)}
          className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue bg-white"
        >
          <option value="">Select an agent…</option>
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({a.version})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-dark-text mb-1">
          Run Name <span className="text-error-red">*</span>
        </label>
        <input
          value={runName}
          onChange={e => setRunName(e.target.value)}
          className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue"
          placeholder="e.g. Upload Eval — March 2026"
        />
        <p className="text-xs text-gray-text mt-1">Give this run a descriptive name to identify it later.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-dark-text mb-2">
          Metrics to Evaluate
          <span className="text-xs text-gray-text font-normal ml-2">({selectedMetrics.length} selected)</span>
        </label>
        {metrics.length === 0 ? (
          <p className="text-sm text-gray-text">No metrics configured. You can add them in the Metrics section.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(metrics as Metric[]).map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMetric(m.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  selectedMetrics.includes(m.id)
                    ? 'bg-primary-blue text-white border-primary-blue'
                    : 'bg-white text-gray-text border-brand-border hover:border-primary-blue hover:text-primary-blue'
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-text mt-2">Select the metrics to calculate for each scenario's transcript.</p>
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="primary" onClick={onNext} disabled={!canProceed}>
          Next: Add Transcripts <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: Add Scenarios ──────────────────────────────────────────────────

function StepAddScenarios({
  scenarios, setScenarios,
  onBack, onNext,
}: {
  scenarios: ScenarioItem[];
  setScenarios: React.Dispatch<React.SetStateAction<ScenarioItem[]>>;
  onBack: () => void;
  onNext: () => void;
}) {
  const queryClient = useQueryClient();
  const [showPanel, setShowPanel] = useState(false);

  const { data: files = [] } = useQuery({
    queryKey: ['uploaded-files'],
    queryFn: getUploadedFiles,
    refetchInterval: 3000,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return uploadFile(fd);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-files'] });
      toast.success('File uploaded — waiting for parsing to complete…');
    },
    onError: () => toast.error('Upload failed'),
  });

  const handleSaveScenario = (s: Omit<ScenarioItem, 'id'>) => {
    setScenarios(prev => [...prev, { ...s, id: crypto.randomUUID() }]);
    setShowPanel(false);
    toast.success(`Scenario "${s.name}" added`);
  };

  const removeScenario = (id: string) => {
    setScenarios(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div className="space-y-5">
      {showPanel && (
        <AddScenarioPanel
          files={files as UploadedFile[]}
          onSave={handleSaveScenario}
          onCancel={() => setShowPanel(false)}
          onUploadFile={f => uploadMutation.mutate(f)}
          uploading={uploadMutation.isPending}
        />
      )}

      {/* Scenario list */}
      {scenarios.length === 0 ? (
        <div className="border-2 border-dashed border-brand-border rounded-xl p-12 text-center">
          <FileText size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-dark-text mb-1">No transcripts added yet</p>
          <p className="text-xs text-gray-text mb-4">Each scenario maps one call transcript to evaluation criteria.</p>
          <Button variant="primary" onClick={() => setShowPanel(true)}>
            <Plus size={14} /> Add First Transcript
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {scenarios.map((s, i) => (
            <div key={s.id} className="flex items-start gap-4 p-4 bg-white border border-brand-border rounded-xl hover:border-primary-blue/30 transition-colors">
              <div className="w-7 h-7 rounded-full bg-light-blue text-primary-blue text-xs font-bold flex items-center justify-center flex-shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-dark-text truncate">{s.name}</span>
                  <Badge variant="blue">upload-eval</Badge>
                </div>
                {s.description && <p className="text-xs text-gray-text mb-1 truncate">{s.description}</p>}
                <div className="flex items-center gap-4 text-xs text-gray-text">
                  <span className="flex items-center gap-1">
                    <FileText size={11} />
                    {s.transcript_file_name}
                  </span>
                  <span className="capitalize">{s.expected_outcome_type.replace('_', ' ')}</span>
                  {s.expected_outcome_value && (
                    <span className="truncate max-w-[180px]">"{s.expected_outcome_value}"</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removeScenario(s.id)}
                className="p-1.5 text-gray-text hover:text-error-red hover:bg-red-50 rounded transition-colors flex-shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <button
            onClick={() => setShowPanel(true)}
            className="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-brand-border rounded-xl text-sm text-primary-blue hover:bg-light-blue transition-colors"
          >
            <Plus size={14} /> Add Another Transcript
          </button>
        </div>
      )}

      {/* Uploaded files status */}
      <Card padding={false}>
        <div className="px-4 py-3 border-b border-brand-border">
          <h3 className="text-xs font-semibold text-gray-text uppercase tracking-wide">Available Transcripts</h3>
        </div>
        {(files as UploadedFile[]).length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-text">No transcripts uploaded yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 max-h-36 overflow-y-auto">
            {(files as UploadedFile[]).map(f => (
              <div key={f.id} className="px-4 py-2.5 flex items-center gap-3">
                <FileText size={13} className="text-gray-text flex-shrink-0" />
                <span className="flex-1 text-sm text-dark-text truncate">{f.original_name}</span>
                {f.parsing_status === 'complete' && <Badge variant="green"><CheckCircle size={10} /> Ready</Badge>}
                {f.parsing_status === 'pending' && <Badge variant="gray"><Clock size={10} /> Parsing…</Badge>}
                {f.parsing_status === 'error' && <Badge variant="red"><AlertCircle size={10} /> Error</Badge>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}><ChevronLeft size={14} /> Back</Button>
        <Button variant="primary" onClick={onNext} disabled={scenarios.length === 0}>
          Next: Review <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Review & Start ─────────────────────────────────────────────────

function StepReview({
  runName, selectedAgentId, selectedMetrics, scenarios,
  agents, onBack, onStart, isStarting,
}: {
  runName: string; selectedAgentId: string;
  selectedMetrics: string[]; scenarios: ScenarioItem[];
  agents: Agent[]; onBack: () => void;
  onStart: () => void; isStarting: boolean;
}) {
  const { data: metrics = [] } = useQuery({ queryKey: ['metrics'], queryFn: getMetrics });
  const agent = agents.find(a => a.id === selectedAgentId);
  const selectedMetricNames = (metrics as Metric[]).filter(m => selectedMetrics.includes(m.id)).map(m => m.name);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-light-blue rounded-xl p-4">
          <div className="text-xs text-gray-text uppercase tracking-wide mb-1">Run Name</div>
          <div className="text-sm font-semibold text-dark-text">{runName}</div>
        </div>
        <div className="bg-light-blue rounded-xl p-4">
          <div className="text-xs text-gray-text uppercase tracking-wide mb-1">Agent</div>
          <div className="text-sm font-semibold text-dark-text">{agent?.name || '—'}</div>
        </div>
        <div className="bg-light-blue rounded-xl p-4">
          <div className="text-xs text-gray-text uppercase tracking-wide mb-1">Scenarios</div>
          <div className="text-sm font-semibold text-dark-text">{scenarios.length}</div>
        </div>
      </div>

      {/* Metrics */}
      <div>
        <h3 className="text-sm font-semibold text-dark-text mb-2">Metrics to Evaluate</h3>
        {selectedMetricNames.length === 0 ? (
          <p className="text-sm text-gray-text italic">No metrics selected — KPI scoring will still run.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedMetricNames.map(name => (
              <Badge key={name} variant="blue">{name}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Scenarios summary */}
      <div>
        <h3 className="text-sm font-semibold text-dark-text mb-2">Scenarios</h3>
        <div className="space-y-2">
          {scenarios.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-white border border-brand-border rounded-lg">
              <div className="w-6 h-6 rounded-full bg-primary-blue text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-dark-text">{s.name}</div>
                <div className="text-xs text-gray-text flex items-center gap-1 mt-0.5">
                  <FileText size={11} />
                  {s.transcript_file_name}
                </div>
              </div>
              <Badge variant="teal">{s.expected_outcome_type.replace('_', ' ')}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-light-blue border border-primary-blue/20 rounded-xl p-4 text-sm text-dark-text">
        <strong>What happens next:</strong> Each transcript will be scored against its scenario's expected outcome.
        No AI simulation will run — the uploaded call is used directly as the conversation record.
        Results appear on the Eval Runs page when complete.
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}><ChevronLeft size={14} /> Back</Button>
        <Button variant="primary" onClick={onStart} loading={isStarting}>
          <Play size={14} /> Start Eval Run
        </Button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function UploadEvalRun() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [runName, setRunName] = useState(`Upload Run ${new Date().toLocaleDateString()}`);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);

  // Step 2 state
  const [scenarios, setScenarios] = useState<ScenarioItem[]>([]);

  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: getAgents });

  // Auto-select first agent
  const agentList = agents as Agent[];
  if (agentList.length > 0 && !selectedAgentId) {
    setSelectedAgentId(agentList[0].id);
  }

  const startMutation = useMutation({
    mutationFn: () => createUploadEvalRun({
      agent_id: selectedAgentId,
      name: runName,
      metric_ids: selectedMetrics,
      scenarios: scenarios.map(s => ({
        scenario: {
          name: s.name,
          description: s.description,
          seed_utterance: s.seed_utterance,
          expected_outcome_type: s.expected_outcome_type,
          expected_outcome_value: s.expected_outcome_value,
        },
        transcript_file_id: s.transcript_file_id,
      })),
    }),
    onSuccess: (run) => {
      toast.success('Eval run started — scoring in progress…');
      navigate(`/eval-runs/${run.id}`);
    },
    onError: () => {
      toast.error('Failed to start eval run');
    },
  });

  return (
    <div className="max-w-3xl mx-auto">
      <StepIndicator step={step} total={3} />

      <Card>
        {step === 1 && (
          <StepRunSetup
            runName={runName} setRunName={setRunName}
            selectedMetrics={selectedMetrics} setSelectedMetrics={setSelectedMetrics}
            agents={agentList} selectedAgentId={selectedAgentId} setSelectedAgentId={setSelectedAgentId}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <StepAddScenarios
            scenarios={scenarios} setScenarios={setScenarios}
            onBack={() => setStep(1)} onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepReview
            runName={runName} selectedAgentId={selectedAgentId}
            selectedMetrics={selectedMetrics} scenarios={scenarios}
            agents={agentList}
            onBack={() => setStep(2)}
            onStart={() => startMutation.mutate()}
            isStarting={startMutation.isPending}
          />
        )}
      </Card>
    </div>
  );
}
