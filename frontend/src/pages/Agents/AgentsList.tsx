import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bot, Plus, Pencil, Trash2, ChevronRight, LayoutTemplate, Phone, Radio } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../../components/ui/Modal';
import { getAgents, createAgent, deleteAgent, getSettings } from '../../api/client';
import type { Agent } from '../../types';

const LLM_LABELS: Record<string, { label: string; color: string }> = {
  openai: { label: 'OpenAI GPT-3.5', color: 'bg-green-100 text-green-700 border-green-200' },
  claude: { label: 'Claude Sonnet', color: 'bg-orange-100 text-orange-700 border-orange-200' },
};

const VOICE_BADGE = 'bg-purple-100 text-purple-700 border-purple-200';
const VAPI_BADGE = 'bg-teal-100 text-teal-700 border-teal-200';

interface AgentTemplate {
  label: string;
  name: string;
  description: string;
  prompt: string;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    label: 'Policy Cancellation',
    name: 'Policy Cancellation Agent',
    description: 'Handles insurance policy cancellation requests while exploring retention options for Safeguard Insurance.',
    prompt: `You are a professional insurance policy cancellation agent for Safeguard Insurance.

Your primary goal is to assist customers who wish to cancel their insurance policies, while empathetically exploring retention options where appropriate.

Guidelines:
- Always verify the customer's identity before making any account changes.
- Ask for the reason behind the cancellation request before proceeding.
- If the customer cites cost as the reason, present available discounts or plan alternatives.
- If the customer is firm about cancelling, process the request efficiently and provide a confirmation number.
- Calculate and communicate any pro-rated refund the customer is eligible for.
- Be empathetic, professional, and concise. Do not over-explain.
- End the conversation by confirming the action taken and asking if there is anything else you can help with.`,
  },
  {
    label: 'Outbound Collections',
    name: 'Outbound Collections Agent',
    description: 'Makes outbound calls to customers with overdue balances to secure payment commitments for FinClear Financial Services.',
    prompt: `You are a professional collections agent for FinClear Financial Services making an outbound call to a customer regarding an overdue account balance.

Your primary goal is to secure a payment commitment or establish a payment arrangement for the outstanding balance.

Guidelines:
- Introduce yourself and the reason for the call clearly and professionally.
- State the outstanding amount and the number of days past due.
- Listen to the customer's situation before proposing solutions.
- Offer flexible payment options: full payment, partial payment, or a structured payment plan.
- If the customer disputes the balance, acknowledge their concern and offer to escalate to the disputes team.
- Do not use aggressive or threatening language. Remain calm and solution-focused.
- Confirm any payment arrangement made and provide a reference number.
- Thank the customer for their time regardless of the outcome.`,
  },
  {
    label: 'Inbound Lead Qualification',
    name: 'Inbound Lead Qualification Agent',
    description: 'Qualifies inbound leads for NovaTech Solutions enterprise software and schedules discovery calls with account executives.',
    prompt: `You are a friendly and knowledgeable sales development representative for NovaTech Solutions, qualifying inbound leads for the enterprise software product.

Your primary goal is to determine whether the prospect is a good fit for our product and, if so, schedule a discovery call with an account executive.

Guidelines:
- Greet the prospect warmly and confirm their interest in NovaTech Solutions.
- Ask qualifying questions covering: company size, current tools/pain points, decision-making role, budget range, and timeline.
- Listen actively and tailor follow-up questions based on their responses.
- Highlight relevant product benefits that address the prospect's specific pain points.
- If the prospect qualifies (company > 50 employees, decision-maker or influencer, active budget), propose scheduling a 30-minute discovery call.
- If the prospect does not qualify, thank them and suggest relevant self-serve resources.
- Be conversational, not scripted. Avoid reading from a list of questions mechanically.`,
  },
  {
    label: 'Order Returns',
    name: 'Order Returns Agent',
    description: 'Assists customers with product returns, exchanges, and refunds for e-commerce orders.',
    prompt: `You are a customer service agent handling order returns and exchanges for an e-commerce platform.

Your primary goal is to resolve return and refund requests efficiently while maintaining customer satisfaction.

Guidelines:
- Verify the order details and return eligibility before proceeding.
- Clearly explain the return policy, including timeframes and eligible items.
- Guide the customer through the return process step by step.
- For eligible returns, initiate the process and provide a return authorization number.
- If an item is outside the return window, empathize and explore alternative resolutions such as exchanges or store credit.
- Confirm the refund timeline and method once a return is approved.
- Be concise, clear, and courteous throughout the interaction.`,
  },
  {
    label: 'Technical Support',
    name: 'Technical Support Agent',
    description: 'Provides first-line technical support for software products, troubleshooting issues and escalating when needed.',
    prompt: `You are a technical support agent for a SaaS software company providing first-line support to customers experiencing issues.

Your primary goal is to diagnose and resolve technical issues quickly, or escalate to the appropriate team when necessary.

Guidelines:
- Greet the customer and ask them to describe the issue in detail.
- Ask clarifying questions to narrow down the root cause (e.g., browser, OS, account type, steps to reproduce).
- Walk the customer through troubleshooting steps one at a time, confirming each step is completed.
- If the issue is resolved, summarize what was done and ask if there is anything else needed.
- If the issue cannot be resolved at your level, escalate with a clear summary of the problem and steps already attempted.
- Avoid technical jargon unless the customer is clearly technical.
- Always confirm the customer is satisfied before ending the conversation.`,
  },
];

interface AgentFormData {
  name: string;
  description: string;
  prompt: string;
  llm_type: 'openai' | 'claude';
  agent_type: 'chat' | 'voice' | 'vapi';
  phone_number: string;
  silence_timeout: number;
  stt_mode: 'record' | 'gather';
  vapi_api_key: string;
  vapi_assistant_id: string;
  vapi_speaks_first: boolean;
  main_agent_speaks_first: boolean;
}

const defaultForm: AgentFormData = {
  name: '',
  description: '',
  prompt: '',
  llm_type: 'openai',
  agent_type: 'chat',
  phone_number: '',
  silence_timeout: 2.5,
  stt_mode: 'record',
  vapi_api_key: '',
  vapi_assistant_id: '',
  vapi_speaks_first: true,
  main_agent_speaks_first: true,
};

function AgentForm({
  initial,
  onSave,
  onCancel,
  saving,
  webhookBaseUrl,
}: {
  initial: AgentFormData;
  onSave: (data: AgentFormData) => void;
  onCancel: () => void;
  saving: boolean;
  webhookBaseUrl?: string;
}) {
  const [form, setForm] = useState<AgentFormData>(initial);
  const set = (field: keyof AgentFormData, value: string | number) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const applyTemplate = (tpl: AgentTemplate) => {
    setForm(prev => ({
      ...prev,
      name: tpl.name,
      description: tpl.description,
      prompt: tpl.prompt,
    }));
  };

  const isVoice = form.agent_type === 'voice';
  const isVapi = form.agent_type === 'vapi';
  const isChat = form.agent_type === 'chat';

  return (
    <div className="space-y-4">
      {/* Agent Type toggle */}
      <div>
        <label className="label">Agent Type</label>
        <div className="flex gap-2">
          {[
            { value: 'chat', label: 'Chat Agent', icon: <Bot size={14} />, activeClass: 'bg-primary-blue/10 border-primary-blue text-primary-blue' },
            { value: 'voice', label: 'Voice Agent', icon: <Phone size={14} />, activeClass: 'bg-purple-100 border-purple-400 text-purple-700' },
            { value: 'vapi', label: 'Vapi Agent', icon: <Radio size={14} />, activeClass: 'bg-teal-100 border-teal-400 text-teal-700' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set('agent_type', opt.value)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                form.agent_type === opt.value ? opt.activeClass : 'border-brand-border text-gray-text hover:bg-gray-50'
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Agent Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="input"
            placeholder="e.g. Policy Cancellation Agent"
          />
        </div>
        {(isVoice || isVapi) ? (
          <div>
            <label className="label">Agent Phone Number (To) *</label>
            <input
              type="tel"
              value={form.phone_number}
              onChange={e => set('phone_number', e.target.value)}
              className="input"
              placeholder="+1 555 000 0000"
            />
          </div>
        ) : (
          <div>
            <label className="label">Agent LLM</label>
            <select
              value={form.llm_type}
              onChange={e => set('llm_type', e.target.value)}
              className="input"
            >
              <option value="openai">OpenAI GPT-3.5 Turbo</option>
              <option value="claude">Claude Sonnet</option>
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="label">Description</label>
        <input
          type="text"
          value={form.description}
          onChange={e => set('description', e.target.value)}
          className="input"
          placeholder="What does this agent do?"
        />
      </div>

      {isChat && (
        <>
          <div>
            <label className="label">Agent System Prompt *</label>
            <textarea
              value={form.prompt}
              onChange={e => set('prompt', e.target.value)}
              rows={8}
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue resize-y bg-white"
              placeholder="Enter the system prompt that defines how this agent behaves..."
            />
          </div>

          {/* Templates */}
          <div className="pt-1">
            <div className="flex items-center gap-1.5 mb-2">
              <LayoutTemplate size={13} className="text-gray-text" />
              <span className="text-xs font-semibold text-gray-text uppercase tracking-wide">Templates</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {AGENT_TEMPLATES.map(tpl => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="px-2.5 py-1 text-xs rounded-full border border-brand-border text-gray-text hover:border-primary-blue hover:text-primary-blue hover:bg-light-blue transition-colors"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {isVoice && (
        <>
          <div>
            <label className="label">Recording Timeout (seconds)</label>
            <input
              type="number"
              min={1}
              max={15}
              step={0.5}
              value={form.silence_timeout}
              onChange={e => set('silence_timeout', Math.min(Math.max(parseFloat(e.target.value) || 3, 1), 15))}
              className="input"
            />
            <p className="text-xs text-gray-text mt-1">How long Twilio waits after the agent stops speaking before ending each recording. Sweet spot: 2.5–4s.</p>
          </div>
          <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <div>
              <p className="text-sm font-medium text-purple-800">Main Agent Speaks First</p>
              <p className="text-xs text-purple-600 mt-0.5">For inbound use cases — the agent greets first and the customer simulator replies after. Turn off for outbound (simulator speaks first).</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, main_agent_speaks_first: !f.main_agent_speaks_first }))}
              className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ml-3 ${form.main_agent_speaks_first ? 'bg-purple-500' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.main_agent_speaks_first ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
            Voice agent evaluations make real Twilio outbound calls to the phone number above. Ensure Twilio credentials are configured in <strong>Settings → Voice Simulation</strong>.
          </div>
        </>
      )}

      {isVapi && (
        <>
          <div>
            <label className="label">Vapi Assistant ID *</label>
            <input
              type="text"
              value={form.vapi_assistant_id}
              onChange={e => set('vapi_assistant_id', e.target.value)}
              className="input"
              placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
            />
            <p className="text-xs text-gray-text mt-1">Vapi Dashboard → Assistants → your assistant ID</p>
          </div>
          <div>
            <label className="label">Vapi API Key</label>
            <input
              type="password"
              value={form.vapi_api_key}
              onChange={e => set('vapi_api_key', e.target.value)}
              className="input"
              placeholder="Leave blank to use the key from Settings → Vapi"
            />
            <p className="text-xs text-gray-text mt-1">Override the global Vapi API key for this agent only (optional)</p>
          </div>
          <div className="flex items-center justify-between p-3 bg-teal-50 border border-teal-200 rounded-lg">
            <div>
              <p className="text-sm font-medium text-teal-800">Vapi Agent Speaks First</p>
              <p className="text-xs text-teal-600 mt-0.5">Agent greets the caller at the start of the call</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, vapi_speaks_first: !f.vapi_speaks_first }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${form.vapi_speaks_first ? 'bg-teal-500' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.vapi_speaks_first ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>
          <div>
            <label className="label">Vapi Webhook URL</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookBaseUrl ? `${webhookBaseUrl.replace(/\/$/, '')}/api/voice/vapi-webhook` : '(configure Webhook Base URL in Settings → Voice Simulation first)'}
                className="input bg-gray-50 text-gray-500 font-mono text-xs cursor-text select-all"
              />
            </div>
            <p className="text-xs text-gray-text mt-1">Paste this URL into <strong>Vapi Dashboard → Phone Numbers → Server URL</strong> so Vapi sends call events to this evaluator</p>
          </div>
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-700 space-y-1">
            <p>Vapi agent evaluations use Twilio to call the phone number above and simulate a customer talking to your Vapi assistant.</p>
            <p>Ensure both Twilio credentials (<strong>Settings → Voice Simulation</strong>) and Vapi API key (<strong>Settings → Vapi</strong>) are configured.</p>
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-brand-border">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-text border border-brand-border rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={
            !form.name.trim() ||
            (isChat && !form.prompt.trim()) ||
            (isVoice && !form.phone_number.trim()) ||
            (isVapi && (!form.vapi_assistant_id.trim() || !form.phone_number.trim())) ||
            saving
          }
          onClick={() => onSave(form)}
          className="px-4 py-2 text-sm font-medium bg-primary-blue text-white rounded-lg hover:bg-primary-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {saving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          Save Agent
        </button>
      </div>
    </div>
  );
}

export default function AgentsList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: agents = [], isLoading } = useQuery({ queryKey: ['agents'], queryFn: getAgents });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const webhookBaseUrl: string = settings?.settings?.twilio_webhook_url || '';

  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: AgentFormData) => createAgent({ ...data, version: 'v1', agent_type: data.agent_type, phone_number: data.phone_number || undefined, silence_timeout: data.silence_timeout, stt_mode: data.stt_mode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agent created');
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAgent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agent deleted');
      setDeletingId(null);
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-dark-text">Agents</h2>
          <p className="text-sm text-gray-text mt-0.5">{agents.length} agent{agents.length !== 1 ? 's' : ''} configured</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-blue text-white text-sm font-medium rounded-lg hover:bg-primary-blue/90 transition-colors"
        >
          <Plus size={16} />
          New Agent
        </button>
      </div>

      {/* Create modal */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="New Agent" size="lg">
        <div className="p-6">
          <AgentForm
            initial={defaultForm}
            onSave={data => createMutation.mutate(data)}
            onCancel={() => setShowForm(false)}
            saving={createMutation.isPending}
            webhookBaseUrl={webhookBaseUrl}
          />
        </div>
      </Modal>

      {/* Agents list */}
      {agents.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-brand-border rounded-xl">
          <Bot size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-dark-text font-medium mb-1">No agents yet</p>
          <p className="text-sm text-gray-text mb-4">Create an agent with a system prompt to use in eval runs</p>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-primary-blue text-white text-sm font-medium rounded-lg hover:bg-primary-blue/90 transition-colors"
          >
            Create First Agent
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent: Agent) => (
            <div key={agent.id}>
              {deletingId === agent.id ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
                  <p className="text-sm text-dark-text">
                    Delete <strong>{agent.name}</strong>? This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="px-3 py-1.5 text-xs border border-brand-border rounded-lg hover:bg-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(agent.id)}
                      disabled={deleteMutation.isPending}
                      className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="bg-white border border-brand-border rounded-xl p-4 flex items-center gap-4 hover:shadow-sm transition-shadow cursor-pointer group"
                  onClick={() => navigate(`/agents/${agent.id}`)}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${agent.agent_type === 'vapi' ? 'bg-teal-100' : agent.agent_type === 'voice' ? 'bg-purple-100' : 'bg-primary-blue/10'}`}>
                    {agent.agent_type === 'vapi' ? <Radio size={18} className="text-teal-600" /> : agent.agent_type === 'voice' ? <Phone size={18} className="text-purple-600" /> : <Bot size={18} className="text-primary-blue" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-dark-text text-sm">{agent.name}</span>
                      <span className="text-xs text-gray-text">{agent.version}</span>
                      {agent.agent_type === 'voice' ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs border font-medium flex items-center gap-1 ${VOICE_BADGE}`}>
                          <Phone size={10} />Voice
                        </span>
                      ) : agent.agent_type === 'vapi' ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs border font-medium flex items-center gap-1 ${VAPI_BADGE}`}>
                          <Radio size={10} />Vapi
                        </span>
                      ) : agent.llm_type && (
                        <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${LLM_LABELS[agent.llm_type]?.color || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {LLM_LABELS[agent.llm_type]?.label || agent.llm_type}
                        </span>
                      )}
                    </div>
                    {agent.description && (
                      <p className="text-xs text-gray-text mt-0.5 truncate">{agent.description}</p>
                    )}
                    {(agent.agent_type === 'voice' || agent.agent_type === 'vapi') && agent.phone_number ? (
                      <p className="text-xs text-gray-400 mt-0.5 font-mono">{agent.phone_number}</p>
                    ) : agent.prompt && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate font-mono">{agent.prompt.slice(0, 80)}…</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/agents/${agent.id}`); }}
                      className="p-1.5 text-gray-text hover:text-primary-blue hover:bg-light-blue rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeletingId(agent.id); }}
                      className="p-1.5 text-gray-text hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
