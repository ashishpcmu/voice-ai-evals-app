import { useState } from 'react';
import { CARTESIA_VOICES } from '../../constants/voices';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Check, Bot, Phone, Radio, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { getAgents, getScenarios, createEvalRun, getSettings } from '../../api/client';
import type { Scenario, Agent } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const LLM_LABELS: Record<string, string> = {
  openai: 'OpenAI GPT-3.5',
  claude: 'Claude Sonnet',
};

const VOICE_BADGE = 'bg-purple-100 text-purple-700 border-purple-200';
const VAPI_BADGE = 'bg-teal-100 text-teal-700 border-teal-200';

export default function NewRunModal({ isOpen, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: getAgents, enabled: isOpen });
  const agent = agents?.[0];
  const agentId = agent?.id;

  const { data: scenarios } = useQuery({
    queryKey: ['scenarios-all'],
    queryFn: () => getScenarios(),
    enabled: isOpen
  });

  const [step, setStep] = useState(1);
  const [name, setName] = useState(`Run ${new Date().toLocaleDateString()}`);
  const [testAgentId, setTestAgentId] = useState('');
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [nTrials, setNTrials] = useState(1);
  const [kThreshold, setKThreshold] = useState(1);
  const [maxTurns, setMaxTurns] = useState(10);
  const [customerSimulatorModel, setCustomerSimulatorModel] = useState('gpt-4o-mini');
  const [ttsProvider, setTtsProvider] = useState('deepgram');
  const [ttsSpeed, setTtsSpeed] = useState('1');
  const [ttsVoice, setTtsVoice] = useState('5ee9feff-1265-424a-9d7f-8e4d431a12c7');
  const [scenarioSearch, setScenarioSearch] = useState('');
  // Voice provider for this run (voice agents only). 'twilio' (TwiML) or
  // 'livekit' (LiveKit Cloud + SIP, streaming STT/TTS). Defaults to LiveKit.
  const [voiceProvider, setVoiceProvider] = useState<'twilio' | 'livekit'>('livekit');
  // Record the calls for this run? Off by default — recording consumes LiveKit
  // egress minutes (and Twilio recording storage). Voice agents only.
  const [recordCall, setRecordCall] = useState(false);

  // LiveKit config presence — used to warn before starting a LiveKit run.
  const { data: appSettings } = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: isOpen });
  const livekitConfigured = !!(
    appSettings?.settings?.livekit_url &&
    appSettings?.settings?.livekit_api_key &&
    appSettings?.settings?.livekit_api_secret &&
    appSettings?.settings?.livekit_sip_trunk_id
  );

  const handleClose = () => {
    setStep(1);
    onClose();
  };

  const mutation = useMutation({
    mutationFn: () => createEvalRun({
      agent_id: agentId,
      name,
      scenario_ids: selectedScenarios,
      n_trials: nTrials,
      k_threshold: kThreshold,
      max_turns: maxTurns,
      customer_simulator_model: customerSimulatorModel,
      tts_provider: ttsProvider,
      tts_speed: Number(ttsSpeed),
      tts_voice: ttsVoice,
      mode: 'agent',
      test_agent_id: testAgentId || undefined,
      voice_provider: voiceProvider,
      record_call: recordCall,
    }),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['eval-runs'] });
      toast.success('Eval run started!');
      handleClose();
      navigate(`/eval-runs/${run.id}`);
    }
  });

  const toggleScenario = (id: string) => {
    setSelectedScenarios(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const filteredScenarios = (scenarios || []).filter((s: Scenario) =>
    s.name.toLowerCase().includes(scenarioSearch.toLowerCase())
  );

  // Block starting a LiveKit voice run when LiveKit isn't configured.
  const selectedAgentForRun = (agents || []).find((a: Agent) => a.id === testAgentId);
  const livekitBlocked = selectedAgentForRun?.agent_type === 'voice'
    && voiceProvider === 'livekit'
    && !livekitConfigured;

  const stepTitle = step === 1 ? 'Configure Eval Run' : 'Select Scenarios';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={stepTitle} size="lg">
      {/* Step indicator */}
      <div className="px-6 pt-4 pb-0 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${step >= 1 ? 'bg-primary-blue text-white' : 'bg-gray-100 text-gray-text'}`}>1</div>
          <span className={`text-xs font-medium ${step === 1 ? 'text-dark-text' : 'text-gray-text'}`}>Connect to an Agent</span>
          <div className="flex-1 h-px bg-brand-border mx-1" />
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${step >= 2 ? 'bg-primary-blue text-white' : 'bg-gray-100 text-gray-text'}`}>2</div>
          <span className={`text-xs font-medium ${step === 2 ? 'text-dark-text' : 'text-gray-text'}`}>Scenarios</span>
        </div>
      </div>

      {step === 1 ? (
        <div className="p-6 space-y-5">
          {/* Run name */}
          <div>
            <label className="label">Run Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" />
          </div>

          {/* Connect to an Agent */}
          <div>
            <label className="label">Connect to an Agent *</label>
            <div className="border border-brand-border rounded-xl p-4 bg-light-blue/40">
              {(agents || []).length === 0 ? (
                <div className="bg-white border border-brand-border rounded-lg p-4 text-center">
                  <Bot size={24} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-xs text-gray-text mb-2">No agents created yet.</p>
                  <Link
                    to="/agents"
                    onClick={handleClose}
                    className="text-xs text-primary-blue hover:underline font-medium"
                  >
                    Go to Agents tab to create one →
                  </Link>
                </div>
              ) : (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-0.5">
                  {(agents || []).map((a: Agent) => {
                    const isSelected = testAgentId === a.id;
                    return (
                      <div
                        key={a.id}
                        onClick={() => setTestAgentId(a.id)}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-primary-blue bg-white shadow-sm'
                            : 'border-brand-border bg-white hover:border-primary-blue/40 hover:bg-light-blue/30'
                        }`}
                      >
                        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'border-primary-blue' : 'border-gray-300'
                        }`}>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-primary-blue" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-dark-text">{a.name}</span>
                            {a.agent_type === 'voice' ? (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium border flex items-center gap-1 ${VOICE_BADGE}`}>
                                <Phone size={10} />Voice
                              </span>
                            ) : a.agent_type === 'vapi' ? (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium border flex items-center gap-1 ${VAPI_BADGE}`}>
                                <Radio size={10} />Vapi
                              </span>
                            ) : a.llm_type && (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                a.llm_type === 'openai'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-orange-100 text-orange-700'
                              }`}>
                                {LLM_LABELS[a.llm_type] || a.llm_type}
                              </span>
                            )}
                          </div>
                          {a.description && (
                            <p className="text-xs text-gray-text mt-0.5 truncate">{a.description}</p>
                          )}
                          {(a.agent_type === 'voice' || a.agent_type === 'vapi') && a.phone_number ? (
                            <p className="text-xs text-gray-400 mt-0.5 font-mono">{a.phone_number}</p>
                          ) : a.prompt && (
                            <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">{a.prompt.slice(0, 60)}…</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-brand-border">
            <Button variant="secondary" onClick={handleClose}>Cancel</Button>
            <Button
              onClick={() => setStep(2)}
              disabled={!name.trim() || !testAgentId}
            >
              Next →
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-6 space-y-5">
          {/* Voice agent info banner + simulator config */}
          {(() => {
            const selectedAgent = (agents || []).find((a: Agent) => a.id === testAgentId);
            if (selectedAgent?.agent_type === 'voice') {
              return (
                <div className="space-y-3">
                  {/* Provider toggle — Twilio (default) vs LiveKit */}
                  <div>
                    <label className="label">Voice Provider</label>
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
                      {([
                        { value: 'twilio', icon: Phone, label: 'Twilio' },
                        { value: 'livekit', icon: Radio, label: 'LiveKit' },
                      ] as const).map(({ value, icon: Icon, label }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setVoiceProvider(value)}
                          className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            voiceProvider === value ? 'bg-white text-dark-text shadow-sm' : 'text-gray-text hover:text-dark-text'
                          }`}
                        >
                          <Icon size={13} />{label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-text mt-1">
                      {voiceProvider === 'twilio'
                        ? 'Places calls via Twilio Programmable Voice (TwiML). Unchanged default flow.'
                        : 'Dials out via LiveKit Cloud + your Twilio SIP trunk with streaming STT/TTS, like the Voice Simulation page. Shows live transcription and an end-call button.'}
                    </p>
                  </div>

                  {voiceProvider === 'twilio' ? (
                    <div className="flex items-start gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <Phone size={14} className="text-purple-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-purple-700">
                        This run will make real Twilio outbound calls to <strong>{selectedAgent.phone_number}</strong> for each scenario trial. Twilio usage charges apply.
                      </p>
                    </div>
                  ) : livekitConfigured ? (
                    <div className="flex items-start gap-2 p-3 bg-light-blue border border-blue-200 rounded-lg">
                      <Radio size={14} className="text-primary-blue mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-primary-blue">
                        This run will dial <strong>{selectedAgent.phone_number}</strong> via LiveKit + your Twilio SIP trunk for each scenario trial. Live transcription appears while the call runs, and a recording link is available after each trial.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-700">
                        LiveKit is not configured.{' '}
                        <Link to="/settings" onClick={handleClose} className="font-medium underline hover:text-amber-900">
                          Go to Settings → Voice Simulation
                        </Link>{' '}
                        to add the LiveKit URL, API key/secret, and SIP trunk ID before starting a LiveKit run.
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between p-3 bg-gray-50 border border-brand-border rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-dark-text">Record calls</p>
                      <p className="text-xs text-gray-text mt-0.5">
                        {voiceProvider === 'twilio'
                          ? 'When on, each trial call is recorded and a download link appears per trial. Off saves recording storage.'
                          : 'When on, each trial call is recorded (LiveKit egress → S3) with a per-trial download link. Off saves LiveKit egress minutes.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRecordCall(v => !v)}
                      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ml-3 ${recordCall ? 'bg-primary-blue' : 'bg-gray-300'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${recordCall ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  <div>
                    <label className="label">Customer Simulator LLM</label>
                    <select value={customerSimulatorModel} onChange={e => setCustomerSimulatorModel(e.target.value)} className="input">
                      <optgroup label="OpenAI">
                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo (faster, lower cost)</option>
                        <option value="gpt-4o-mini">GPT-4o Mini (smarter, slightly slower)</option>
                        <option value="gpt-4o">GPT-4o (most capable)</option>
                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      </optgroup>
                      <optgroup label="Groq (fastest, lowest cost)">
                        <option value="groq:openai/gpt-oss-120b">GPT-OSS 120B (Groq, fast + smart)</option>
                        <option value="groq:openai/gpt-oss-20b">GPT-OSS 20B (Groq, fastest)</option>
                      </optgroup>
                    </select>
                    <p className="text-xs text-gray-text mt-1">
                      {voiceProvider === 'twilio'
                        ? 'Model used to simulate customer responses during the voice call. Groq models require GROQ_API_KEY in .env.'
                        : 'Model powering the customer simulator on the LiveKit call. Groq models require GROQ_API_KEY in .env.'}
                    </p>
                  </div>
                  {voiceProvider === 'livekit' && (
                    <>
                      <div>
                        <label className="label">TTS Voice Provider</label>
                        <select value={ttsProvider} onChange={e => setTtsProvider(e.target.value)} className="input">
                          <option value="deepgram">Deepgram Aura (fastest, lowest latency)</option>
                          <option value="cartesia">Cartesia Sonic (most natural — requires CARTESIA_API_KEY)</option>
                          <option value="openai">OpenAI (natural, higher latency)</option>
                        </select>
                        <p className="text-xs text-gray-text mt-1">Voice engine for the simulated caller. Cartesia = most natural; Deepgram = snappiest. Voice set via env (CARTESIA_TTS_VOICE, DEEPGRAM_TTS_MODEL).</p>
                      </div>
                      {ttsProvider === 'cartesia' && (
                        <div>
                          <label className="label">Cartesia Voice</label>
                          <select value={ttsVoice} onChange={e => setTtsVoice(e.target.value)} className="input">
                            {CARTESIA_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                          <p className="text-xs text-gray-text mt-1">Voice for the Cartesia (Sonic) simulated caller.</p>
                        </div>
                      )}
                      <div>
                        <label className="label">Speaking Speed</label>
                        <select value={ttsSpeed} onChange={e => setTtsSpeed(e.target.value)} className="input">
                          <option value="0.8">Slower (0.8×)</option>
                          <option value="0.9">Slightly slower (0.9×)</option>
                          <option value="1">Normal (1.0×)</option>
                          <option value="1.1">Slightly faster (1.1×)</option>
                        </select>
                        <p className="text-xs text-gray-text mt-1">Applies to the selected provider. Deepgram Aura-1 voices ignore speed (Aura-2 only); Cartesia &amp; OpenAI honor it naturally.</p>
                      </div>
                    </>
                  )}
                </div>
              );
            }
            if (selectedAgent?.agent_type === 'vapi') {
              return (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-200 rounded-lg">
                    <Radio size={14} className="text-teal-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-teal-700">
                      <p>This run will call your <strong>Vapi assistant</strong> at <strong>{selectedAgent.phone_number}</strong> for each scenario trial.</p>
                      <p className="mt-1">The customer side is simulated by Twilio + an LLM. Vapi transcript and tool calls will be captured and stored for each trial.</p>
                    </div>
                  </div>
                  <div>
                    <label className="label">Customer Simulator LLM</label>
                    <select value={customerSimulatorModel} onChange={e => setCustomerSimulatorModel(e.target.value)} className="input">
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo (faster, lower cost)</option>
                      <option value="gpt-4o-mini">GPT-4o Mini (smarter, slightly slower)</option>
                      <option value="gpt-4o">GPT-4o (most capable)</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    </select>
                    <p className="text-xs text-gray-text mt-1">Model used to simulate customer responses during the call</p>
                  </div>
                </div>
              );
            }
            return null;
          })()}
          {/* Scenarios */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Scenarios *</label>
              <div className="flex items-center gap-2">
                <button className="text-xs text-primary-blue hover:underline" onClick={() => setSelectedScenarios((scenarios || []).map((s: Scenario) => s.id))}>Select all</button>
                <span className="text-xs text-gray-text">|</span>
                <button className="text-xs text-primary-blue hover:underline" onClick={() => setSelectedScenarios([])}>Clear</button>
              </div>
            </div>
            <input
              type="text" placeholder="Search scenarios..."
              value={scenarioSearch} onChange={e => setScenarioSearch(e.target.value)}
              className="input mb-2"
            />
            <div className="border border-brand-border rounded-lg overflow-hidden max-h-[220px] overflow-y-auto">
              {filteredScenarios.length === 0 ? (
                <div className="p-3 text-sm text-gray-text text-center">No scenarios available</div>
              ) : (
                filteredScenarios.map((s: Scenario) => (
                  <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${selectedScenarios.includes(s.id) ? 'bg-primary-blue border-primary-blue' : 'border-gray-300'}`}>
                      {selectedScenarios.includes(s.id) && <Check size={10} className="text-white" />}
                    </div>
                    <input type="checkbox" checked={selectedScenarios.includes(s.id)} onChange={() => toggleScenario(s.id)} className="hidden" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-dark-text truncate">{s.name}</div>
                      <div className="text-xs text-gray-text truncate">{s.seed_utterance}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-gray-text mt-1">{selectedScenarios.length} selected</p>
          </div>

          {/* Trial config */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Trials per Scenario (n)</label>
              <input
                type="number" min={1} max={20} value={nTrials}
                onChange={e => { const v = parseInt(e.target.value) || 1; setNTrials(v); if (kThreshold > v) setKThreshold(v); }}
                className="input"
              />
            </div>
            <div>
              <label className="label">k Threshold (≤ n)</label>
              <input
                type="number" min={1} max={nTrials} value={kThreshold}
                onChange={e => setKThreshold(Math.min(parseInt(e.target.value) || 1, nTrials))}
                className="input"
              />
              <p className="text-xs text-gray-text mt-1">Used for pass@k calculation</p>
            </div>
            <div>
              <label className="label">Max Turns</label>
              <input
                type="number" min={1} max={50} value={maxTurns}
                onChange={e => setMaxTurns(Math.min(Math.max(parseInt(e.target.value) || 5, 1), 50))}
                className="input"
              />
              <p className="text-xs text-gray-text mt-1">Agent + customer = 1 turn</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-brand-border">
            <Button variant="secondary" onClick={() => setStep(1)}>← Back</Button>
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => mutation.mutate()}
                loading={mutation.isPending}
                disabled={selectedScenarios.length === 0 || !agentId || livekitBlocked}
              >
                Start Eval Run
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
