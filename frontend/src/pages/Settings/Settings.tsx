import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, Eye, EyeOff, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { getSettings, updateSettings, testOpenAI, addTeamMember, removeTeamMember } from '../../api/client';
import type { TeamMember } from '../../types';

const tabs = ['API Keys', 'Team Members', 'Agents', 'Metrics Defaults', 'Talk Ratio', 'Voice Simulation', 'Vapi'];

export default function Settings() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('API Keys');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');

  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const teamMembers: TeamMember[] = settings?.team_members || [];
  const settingsData = settings?.settings || {};

  const [talkRatioWarning, setTalkRatioWarning] = useState(settingsData.talk_ratio_warning || '2.0');
  const [talkRatioDanger, setTalkRatioDanger] = useState(settingsData.talk_ratio_danger || '3.5');

  // Vapi settings
  const [vapiApiKey, setVapiApiKey] = useState(settingsData.vapi_api_key || '');
  const [vapiAssistantId, setVapiAssistantId] = useState(settingsData.vapi_assistant_id || '');
  const [showVapiApiKey, setShowVapiApiKey] = useState(false);

  // Voice Simulation (Twilio) settings
  const [twilioAccountSid, setTwilioAccountSid] = useState(settingsData.twilio_account_sid || '');
  const [twilioAuthToken, setTwilioAuthToken] = useState(settingsData.twilio_auth_token || '');
  const [showTwilioToken, setShowTwilioToken] = useState(false);
  const [twilioFromNumber, setTwilioFromNumber] = useState(settingsData.twilio_from_number || '');
  const [twilioWebhookUrl, setTwilioWebhookUrl] = useState(settingsData.twilio_webhook_url || '');
  const [confirmTwilioSave, setConfirmTwilioSave] = useState(false);

  // Voice Agent (LiveKit) settings — isolated tab
  const [livekitUrl, setLivekitUrl] = useState(settingsData.livekit_url || '');
  const [livekitApiKey, setLivekitApiKey] = useState(settingsData.livekit_api_key || '');
  const [livekitApiSecret, setLivekitApiSecret] = useState(settingsData.livekit_api_secret || '');
  const [showLivekitSecret, setShowLivekitSecret] = useState(false);
  const [livekitSipTrunkId, setLivekitSipTrunkId] = useState(settingsData.livekit_sip_trunk_id || '');
  const [confirmLivekitSave, setConfirmLivekitSave] = useState(false);

  // Sync form state from persisted settings *once* on initial load. We can't
  // use useState's lazy initializer because the React Query response arrives
  // after mount, leaving the form blank. We also gate this with a ref so a
  // window-focus refetch doesn't clobber whatever the user is currently typing.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    if (!settings?.settings) return;
    const s = settings.settings;
    setTalkRatioWarning(s.talk_ratio_warning || '2.0');
    setTalkRatioDanger(s.talk_ratio_danger || '3.5');
    setVapiApiKey(s.vapi_api_key || '');
    setVapiAssistantId(s.vapi_assistant_id || '');
    setTwilioAccountSid(s.twilio_account_sid || '');
    setTwilioAuthToken(s.twilio_auth_token || '');
    setTwilioFromNumber(s.twilio_from_number || '');
    setTwilioWebhookUrl(s.twilio_webhook_url || '');
    setLivekitUrl(s.livekit_url || '');
    setLivekitApiKey(s.livekit_api_key || '');
    setLivekitApiSecret(s.livekit_api_secret || '');
    setLivekitSipTrunkId(s.livekit_sip_trunk_id || '');
    syncedRef.current = true;
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, string>) => updateSettings({ settings: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings saved');
    }
  });

  const testMutation = useMutation({
    mutationFn: () => testOpenAI({ api_key: apiKey }),
    onSuccess: (result) => setTestResult(result)
  });

  const addMemberMutation = useMutation({
    mutationFn: () => addTeamMember({ name: newMemberName, email: newMemberEmail, role: newMemberRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setNewMemberName('');
      setNewMemberEmail('');
      setNewMemberRole('');
      toast.success('Team member added');
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: (id: string) => removeTeamMember(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Team member removed');
    }
  });

  if (isLoading) return <div className="text-gray-text text-sm">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure your evaluation suite</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === tab ? 'bg-white text-dark-text shadow-sm' : 'text-gray-text hover:text-dark-text'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* API Keys */}
      {activeTab === 'API Keys' && (
        <Card>
          <h3 className="text-sm font-semibold text-dark-text mb-4">OpenAI API Key</h3>
          <p className="text-xs text-gray-text mb-4">
            Optional. The app works without an API key using realistic mock data.
            Provide a key to enable real AI scenario generation, KPI scoring, and metric testing.
          </p>
          <div className="space-y-3">
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="input pr-10"
                placeholder="sk-..."
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-text hover:text-dark-text"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => testMutation.mutate()}
                loading={testMutation.isPending}
              >
                Test Connection
              </Button>
              <Button
                size="sm"
                onClick={() => updateMutation.mutate({ openai_api_key: apiKey })}
                loading={updateMutation.isPending}
              >
                Save Key
              </Button>
              {testResult && (
                <div className={`flex items-center gap-1.5 text-xs font-medium ${testResult.success ? 'text-success-green' : 'text-error-red'}`}>
                  {testResult.success ? <Check size={12} /> : null}
                  {testResult.message}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Team Members */}
      {activeTab === 'Team Members' && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-sm font-semibold text-dark-text mb-4">Add Team Member</h3>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <input
                type="text"
                placeholder="Name"
                value={newMemberName}
                onChange={e => setNewMemberName(e.target.value)}
                className="input"
              />
              <input
                type="email"
                placeholder="Email"
                value={newMemberEmail}
                onChange={e => setNewMemberEmail(e.target.value)}
                className="input"
              />
              <input
                type="text"
                placeholder="Role (optional)"
                value={newMemberRole}
                onChange={e => setNewMemberRole(e.target.value)}
                className="input"
              />
            </div>
            <Button
              size="sm"
              onClick={() => addMemberMutation.mutate()}
              loading={addMemberMutation.isPending}
              disabled={!newMemberName || !newMemberEmail}
            >
              <Plus size={14} />
              Add Member
            </Button>
          </Card>

          <Card padding={false}>
            <div className="px-6 py-4 border-b border-brand-border">
              <h3 className="text-sm font-semibold text-dark-text">Team ({teamMembers.length})</h3>
            </div>
            {teamMembers.length === 0 ? (
              <div className="p-6 text-center text-gray-text text-sm">No team members yet</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {teamMembers.map((member: TeamMember) => (
                  <div key={member.id} className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary-blue rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-semibold">{member.name.charAt(0)}</span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-dark-text">{member.name}</div>
                        <div className="text-xs text-gray-text">{member.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.role && <Badge variant="gray">{member.role}</Badge>}
                      <button
                        onClick={() => removeMemberMutation.mutate(member.id)}
                        className="p-1.5 text-gray-text hover:text-error-red hover:bg-red-50 rounded transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Agents */}
      {activeTab === 'Agents' && (
        <Card>
          <h3 className="text-sm font-semibold text-dark-text mb-4">Configured Agents</h3>
          <p className="text-xs text-gray-text mb-4">
            Agents are configured via the API. The seeded agent is shown below.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 border border-brand-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-dark-text">Policy Cancellation Agent</span>
              <Badge variant="green">v1</Badge>
            </div>
            <p className="text-xs text-gray-text">Handles insurance policy cancellation requests for Safeguard Insurance</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {['verify_customer_identity', 'get_policy_details', 'process_cancellation', 'offer_discount'].map(tool => (
                <Badge key={tool} variant="teal">{tool}</Badge>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Metrics Defaults */}
      {activeTab === 'Metrics Defaults' && (
        <Card>
          <h3 className="text-sm font-semibold text-dark-text mb-4">Default Metric Settings</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Default n Trials</label>
                <input
                  type="number"
                  defaultValue={settingsData.default_n_trials || '1'}
                  className="input"
                  onBlur={e => updateMutation.mutate({ default_n_trials: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Default k Threshold</label>
                <input
                  type="number"
                  defaultValue={settingsData.default_k_threshold || '1'}
                  className="input"
                  onBlur={e => updateMutation.mutate({ default_k_threshold: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Cost per 1K Tokens (USD)</label>
              <input
                type="number"
                step="0.001"
                defaultValue={settingsData.cost_per_1k_tokens || '0.002'}
                className="input max-w-xs"
                onBlur={e => updateMutation.mutate({ cost_per_1k_tokens: e.target.value })}
              />
            </div>
          </div>
        </Card>
      )}

      {/* Talk Ratio */}
      {activeTab === 'Talk Ratio' && (
        <Card>
          <h3 className="text-sm font-semibold text-dark-text mb-4">Talk Ratio Thresholds</h3>
          <p className="text-xs text-gray-text mb-4">
            Talk ratio = agent word count / user word count. A healthy range is 0.8–2.0.
          </p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="label">Warning Threshold</label>
              <input
                type="number"
                step="0.1"
                value={talkRatioWarning}
                onChange={e => setTalkRatioWarning(e.target.value)}
                className="input"
              />
              <p className="text-xs text-gray-text mt-1">Shown in amber if ratio exceeds this value</p>
            </div>
            <div>
              <label className="label">Danger Threshold</label>
              <input
                type="number"
                step="0.1"
                value={talkRatioDanger}
                onChange={e => setTalkRatioDanger(e.target.value)}
                className="input"
              />
              <p className="text-xs text-gray-text mt-1">Shown in red if ratio exceeds this value</p>
            </div>
          </div>
          <Button
            onClick={() => updateMutation.mutate({ talk_ratio_warning: talkRatioWarning, talk_ratio_danger: talkRatioDanger })}
            loading={updateMutation.isPending}
          >
            Save Thresholds
          </Button>
        </Card>
      )}

      {/* Voice Simulation */}
      {activeTab === 'Voice Simulation' && (
        <>
        <Card>
          <h3 className="text-sm font-semibold text-dark-text mb-1">Twilio Credentials</h3>
          <p className="text-xs text-gray-text mb-4">
            Used by the Voice Agent (Twilio) simulator to place real outbound calls. Requires a Twilio account with a purchased phone number and a public webhook URL (e.g. via ngrok).
          </p>
          <div className="space-y-4">
            <div>
              <label className="label">Account SID</label>
              <input
                type="text"
                value={twilioAccountSid}
                onChange={e => setTwilioAccountSid(e.target.value)}
                className="input"
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className="label">Auth Token</label>
              <div className="relative">
                <input
                  type={showTwilioToken ? 'text' : 'password'}
                  value={twilioAuthToken}
                  onChange={e => setTwilioAuthToken(e.target.value)}
                  className="input pr-10"
                  placeholder="Your Twilio auth token"
                />
                <button
                  type="button"
                  onClick={() => setShowTwilioToken(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-text hover:text-dark-text"
                >
                  {showTwilioToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className="label">From Number</label>
              <input
                type="text"
                value={twilioFromNumber}
                onChange={e => setTwilioFromNumber(e.target.value)}
                className="input"
                placeholder="+11234567890"
              />
              <p className="text-xs text-gray-text mt-1">Your Twilio phone number that places the call (E.164 format)</p>
            </div>
            <div>
              <label className="label">Public Webhook URL</label>
              <input
                type="text"
                value={twilioWebhookUrl}
                onChange={e => setTwilioWebhookUrl(e.target.value)}
                className="input"
                placeholder="https://xxxx.ngrok.io"
              />
              <p className="text-xs text-gray-text mt-1">
                Base URL Twilio uses to call back — use{' '}
                <a href="https://ngrok.com" target="_blank" rel="noreferrer" className="text-primary-blue hover:underline">ngrok</a>
                {' '}for local dev: <code className="bg-gray-100 px-1 rounded text-xs">ngrok http 3001</code>
              </p>
              {twilioWebhookUrl.trim() && (
                <p className="text-xs mt-1.5 flex items-center gap-1">
                  Verify reachability:&nbsp;
                  <a
                    href={`${twilioWebhookUrl.replace(/\/$/, '')}/api/voice/twilio-ping`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-blue hover:underline font-mono flex items-center gap-0.5"
                  >
                    {twilioWebhookUrl.replace(/\/$/, '')}/api/voice/twilio-ping
                    <ExternalLink size={10} />
                  </a>
                </p>
              )}
            </div>
            <Button
              onClick={() => setConfirmTwilioSave(true)}
              loading={updateMutation.isPending}
              disabled={!twilioAccountSid || !twilioAuthToken || !twilioFromNumber || !twilioWebhookUrl}
            >
              Save Twilio Settings
            </Button>
            <ConfirmDialog
              isOpen={confirmTwilioSave}
              onClose={() => setConfirmTwilioSave(false)}
              onConfirm={() => {
                updateMutation.mutate({
                  twilio_account_sid: twilioAccountSid,
                  twilio_auth_token: twilioAuthToken,
                  twilio_from_number: twilioFromNumber,
                  twilio_webhook_url: twilioWebhookUrl,
                });
                setConfirmTwilioSave(false);
              }}
              title="Save Twilio settings?"
              message={`These credentials will be used to place real outbound calls and may incur charges on your Twilio account.

Account SID: ${twilioAccountSid.slice(0, 6)}…${twilioAccountSid.slice(-4)}
Auth Token: ••••••${twilioAuthToken.slice(-4)}
From Number: ${twilioFromNumber}
Webhook URL: ${twilioWebhookUrl}

Make sure these values are correct before saving.`}
              confirmLabel="Save"
              variant="primary"
              loading={updateMutation.isPending}
            />
          </div>
        </Card>

        <Card className="mt-6">
          <h3 className="text-sm font-semibold text-dark-text mb-1">Voice Agent (LiveKit)</h3>
          <p className="text-xs text-gray-text mb-4">
            Used only by the <span className="font-medium">Voice Agent (LiveKit)</span> tab, which dials out through LiveKit Cloud + your Twilio SIP trunk with streaming STT/TTS. All other tabs continue to use the Twilio settings above. The outbound SIP trunk should route through your existing Twilio number.
          </p>
          <div className="space-y-4">
            <div>
              <label className="label">LiveKit URL</label>
              <input
                type="text"
                value={livekitUrl}
                onChange={e => setLivekitUrl(e.target.value)}
                className="input"
                placeholder="wss://your-project.livekit.cloud"
              />
              <p className="text-xs text-gray-text mt-1">From your LiveKit Cloud project settings.</p>
            </div>
            <div>
              <label className="label">API Key</label>
              <input
                type="text"
                value={livekitApiKey}
                onChange={e => setLivekitApiKey(e.target.value)}
                className="input"
                placeholder="APIxxxxxxxx"
              />
            </div>
            <div>
              <label className="label">API Secret</label>
              <div className="relative">
                <input
                  type={showLivekitSecret ? 'text' : 'password'}
                  value={livekitApiSecret}
                  onChange={e => setLivekitApiSecret(e.target.value)}
                  className="input pr-10"
                  placeholder="Your LiveKit API secret"
                />
                <button
                  type="button"
                  onClick={() => setShowLivekitSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-text hover:text-dark-text"
                >
                  {showLivekitSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className="label">SIP Trunk ID (outbound)</label>
              <input
                type="text"
                value={livekitSipTrunkId}
                onChange={e => setLivekitSipTrunkId(e.target.value)}
                className="input"
                placeholder="ST_xxxxxxxx"
              />
              <p className="text-xs text-gray-text mt-1">The LiveKit outbound SIP trunk that routes calls through your Twilio number.</p>
            </div>
            <Button
              onClick={() => setConfirmLivekitSave(true)}
              loading={updateMutation.isPending}
              disabled={!livekitUrl || !livekitApiKey || !livekitApiSecret || !livekitSipTrunkId}
            >
              Save LiveKit Settings
            </Button>
            <ConfirmDialog
              isOpen={confirmLivekitSave}
              onClose={() => setConfirmLivekitSave(false)}
              onConfirm={() => {
                updateMutation.mutate({
                  livekit_url: livekitUrl,
                  livekit_api_key: livekitApiKey,
                  livekit_api_secret: livekitApiSecret,
                  livekit_sip_trunk_id: livekitSipTrunkId,
                });
                setConfirmLivekitSave(false);
              }}
              title="Save LiveKit settings?"
              message={`These credentials will be used to place real outbound calls via LiveKit + your Twilio SIP trunk and may incur charges.

LiveKit URL: ${livekitUrl}
API Key: ${livekitApiKey.slice(0, 6)}…
SIP Trunk: ${livekitSipTrunkId}

Make sure these values are correct before saving.`}
              confirmLabel="Save"
              variant="primary"
              loading={updateMutation.isPending}
            />
          </div>
        </Card>
        </>
      )}
      {activeTab === 'Vapi' && (
        <Card>
          <h3 className="text-sm font-semibold text-dark-text mb-1">Vapi Configuration</h3>
          <p className="text-xs text-gray-text mb-4">
            Credentials for the Vapi Agent simulation tab. The API key and assistant ID are saved here and pre-filled automatically when you run a Vapi evaluation.
          </p>
          <div className="space-y-4">
            <div>
              <label className="label">Vapi API Key</label>
              <div className="relative">
                <input
                  type={showVapiApiKey ? 'text' : 'password'}
                  value={vapiApiKey}
                  onChange={e => setVapiApiKey(e.target.value)}
                  className="input pr-10"
                  placeholder="Enter your Vapi private API key"
                />
                <button
                  type="button"
                  onClick={() => setShowVapiApiKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-text hover:text-dark-text"
                >
                  {showVapiApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs text-gray-text mt-1">Vapi dashboard → Account → API Keys</p>
            </div>
            <div>
              <label className="label">Vapi Assistant ID</label>
              <input
                type="text"
                value={vapiAssistantId}
                onChange={e => setVapiAssistantId(e.target.value)}
                className="input"
                placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
              />
              <p className="text-xs text-gray-text mt-1">Vapi dashboard → Assistants → your assistant</p>
            </div>
            <Button
              onClick={() => updateMutation.mutate({
                vapi_api_key: vapiApiKey,
                vapi_assistant_id: vapiAssistantId,
              })}
              loading={updateMutation.isPending}
              disabled={!vapiApiKey || !vapiAssistantId}
            >
              Save Vapi Settings
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
