import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Trash2, LayoutTemplate, Phone, Bot, Radio } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAgent, updateAgent, deleteAgent, getSettings } from '../../api/client';
import { Skeleton } from '../../components/ui/Skeleton';

const LLM_OPTIONS = [
  { value: 'openai', label: 'OpenAI GPT-3.5 Turbo' },
  { value: 'claude', label: 'Claude Sonnet' },
];

const AGENT_TEMPLATES = [
  {
    label: 'Policy Cancellation',
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

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => getAgent(id!),
    enabled: !!id,
  });

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const webhookBaseUrl: string = settings?.settings?.twilio_webhook_url || '';

  const [form, setForm] = useState({
    name: '',
    description: '',
    prompt: '',
    llm_type: 'openai' as 'openai' | 'claude',
    agent_type: 'chat' as 'chat' | 'voice' | 'vapi',
    phone_number: '',
    silence_timeout: 2.5,
    stt_mode: 'record' as 'record' | 'gather',
    version: 'v1',
    vapi_api_key: '',
    vapi_assistant_id: '',
    vapi_speaks_first: true,
    main_agent_speaks_first: true,
  });
  const [initialized, setInitialized] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    if (agent && !initialized) {
      setForm({
        name: agent.name || '',
        description: agent.description || '',
        prompt: agent.prompt || '',
        llm_type: (agent.llm_type as 'openai' | 'claude') || 'openai',
        agent_type: (agent.agent_type as 'chat' | 'voice' | 'vapi') || 'chat',
        phone_number: agent.phone_number || '',
        silence_timeout: agent.silence_timeout ?? 2.5,
        stt_mode: 'record',
        version: agent.version || 'v1',
        vapi_api_key: agent.vapi_api_key || '',
        vapi_assistant_id: agent.vapi_assistant_id || '',
        vapi_speaks_first: agent.vapi_speaks_first !== false,
        main_agent_speaks_first: agent.main_agent_speaks_first !== false && agent.main_agent_speaks_first !== 0,
      });
      setInitialized(true);
    }
  }, [agent, initialized]);

  const updateMutation = useMutation({
    mutationFn: () => updateAgent(id!, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent', id] });
      toast.success('Agent saved');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAgent(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agent deleted');
      navigate('/agents');
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!agent) return <div className="p-6 text-gray-text">Agent not found</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/agents')} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={16} className="text-gray-text" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-dark-text">{agent.name}</h1>
            <p className="text-sm text-gray-text">{agent.version}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDelete(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 size={14} />
            Delete
          </button>
          <button
            onClick={() => updateMutation.mutate()}
            disabled={!form.name.trim() || (form.agent_type === 'chat' && !form.prompt.trim()) || (form.agent_type === 'voice' && !form.phone_number.trim()) || (form.agent_type === 'vapi' && (!form.vapi_assistant_id.trim() || !form.phone_number.trim())) || updateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary-blue text-white rounded-lg hover:bg-primary-blue/90 disabled:opacity-50 transition-colors"
          >
            {updateMutation.isPending ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save Changes
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDelete && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-dark-text">
            Delete <strong>{agent.name}</strong>? This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDelete(false)}
              className="px-3 py-1.5 text-xs border border-brand-border rounded-lg hover:bg-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="bg-white border border-brand-border rounded-xl p-6 space-y-5">
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
                onClick={() => setForm(f => ({ ...f, agent_type: opt.value as 'chat' | 'voice' | 'vapi' }))}
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
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="input"
            />
          </div>
          {form.agent_type === 'voice' || form.agent_type === 'vapi' ? (
            <div>
              <label className="label">Agent Phone Number (To) *</label>
              <input
                type="tel"
                value={form.phone_number}
                onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                className="input"
                placeholder="+1 555 000 0000"
              />
            </div>
          ) : (
            <div>
              <label className="label">Agent LLM</label>
              <select
                value={form.llm_type}
                onChange={e => setForm(f => ({ ...f, llm_type: e.target.value as 'openai' | 'claude' }))}
                className="input"
              >
                {LLM_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="label">Description</label>
          <input
            type="text"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="input"
            placeholder="What does this agent do?"
          />
        </div>

        {form.agent_type === 'chat' && (
          <>
            <div>
              <label className="label">Agent System Prompt *</label>
              <textarea
                value={form.prompt}
                onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                rows={12}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:border-primary-blue resize-y bg-white"
                placeholder="Enter the system prompt that defines how this agent behaves..."
              />
            </div>

            {/* Templates */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <LayoutTemplate size={13} className="text-gray-text" />
                <span className="text-xs font-semibold text-gray-text uppercase tracking-wide">Templates</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {AGENT_TEMPLATES.map(tpl => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, description: tpl.description, prompt: tpl.prompt }))}
                    className="px-2.5 py-1 text-xs rounded-full border border-brand-border text-gray-text hover:border-primary-blue hover:text-primary-blue hover:bg-light-blue transition-colors"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {form.agent_type === 'voice' && (
          <>
            <div>
              <label className="label">Recording Timeout (seconds)</label>
              <input
                type="number"
                min={1}
                max={15}
                step={0.5}
                value={form.silence_timeout}
                onChange={e => setForm(f => ({ ...f, silence_timeout: Math.min(Math.max(parseFloat(e.target.value) || 3, 1), 15) }))}
                className="input"
              />
              <p className="text-xs text-gray-text mt-1">How long Twilio waits after the agent stops speaking before ending each recording. Sweet spot: 2.5–4s.</p>
            </div>
            <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <div>
                <p className="text-sm font-medium text-purple-800">Main Agent Speaks First</p>
                <p className="text-xs text-purple-600 mt-0.5">For inbound use cases — the agent greets first and the customer simulator replies after the agent's opening turn. Turn off for outbound (simulator speaks first).</p>
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

        {form.agent_type === 'vapi' && (
          <>
            <div>
              <label className="label">Vapi Assistant ID *</label>
              <input
                type="text"
                value={form.vapi_assistant_id}
                onChange={e => setForm(f => ({ ...f, vapi_assistant_id: e.target.value }))}
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
                onChange={e => setForm(f => ({ ...f, vapi_api_key: e.target.value }))}
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
              <input
                type="text"
                readOnly
                value={webhookBaseUrl ? `${webhookBaseUrl.replace(/\/$/, '')}/api/voice/vapi-webhook` : '(configure Webhook Base URL in Settings → Voice Simulation first)'}
                className="input bg-gray-50 text-gray-500 font-mono text-xs cursor-text select-all"
              />
              <p className="text-xs text-gray-text mt-1">Paste this URL into <strong>Vapi Dashboard → Phone Numbers → Server URL</strong> so Vapi sends call events to this evaluator</p>
            </div>
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-700 space-y-1">
              <p>Vapi agent evaluations use Twilio to call the phone number above and simulate a customer talking to your Vapi assistant.</p>
              <p>Ensure both Twilio credentials (<strong>Settings → Voice Simulation</strong>) and Vapi API key (<strong>Settings → Vapi</strong>) are configured.</p>
            </div>
          </>
        )}

        <div>
          <label className="label">Version</label>
          <input
            type="text"
            value={form.version}
            onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
            className="input w-32"
            placeholder="v1"
          />
        </div>
      </div>
    </div>
  );
}
