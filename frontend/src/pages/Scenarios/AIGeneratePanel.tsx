import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Sparkles, Check, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { generateScenarios, createScenario } from '../../api/client';

interface GeneratedScenario {
  name: string;
  description?: string;
  seed_utterance: string;
  expected_outcome_type: string;
  expected_outcome_value?: string;
  tags?: string[];
  selected?: boolean;
  editing?: boolean;
}

interface Props {
  agentId?: string;
  onClose: () => void;
}

export default function AIGeneratePanel({ agentId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(5);
  const [personaHint, setPersonaHint] = useState('');
  const [generated, setGenerated] = useState<GeneratedScenario[]>([]);

  const generateMutation = useMutation({
    mutationFn: () => generateScenarios({ prompt, count, persona_hint: personaHint, agent_id: agentId }),
    onSuccess: (data: GeneratedScenario[]) => {
      if (!data || data.length === 0) {
        toast.error('Generation returned no scenarios. Check your OpenAI API key or try a different prompt.');
        return;
      }
      setGenerated(data.map(s => ({ ...s, selected: true })));
    },
    onError: () => {
      toast.error('Failed to generate scenarios. Please try again.');
    }
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const selected = generated.filter(s => s.selected);
      for (const scenario of selected) {
        await createScenario({
          ...scenario,
          agent_id: agentId,
          tags: [...(scenario.tags || []), 'ai-generated'],
          status: 'draft'
        });
      }
      return selected.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast.success(`${count} scenario${count > 1 ? 's' : ''} saved`);
      onClose();
    }
  });

  const toggleScenario = (i: number) => {
    setGenerated(prev => prev.map((s, idx) => idx === i ? { ...s, selected: !s.selected } : s));
  };

  const updateScenario = (i: number, field: string, value: string) => {
    setGenerated(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  };

  const selectedCount = generated.filter(s => s.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[600px] bg-white h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary-blue" />
            <h2 className="text-lg font-semibold text-dark-text">AI Scenario Generator</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-text" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Generation form */}
          <div className="space-y-4">
            <div>
              <label className="label">Prompt *</label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                className="textarea h-28"
                placeholder="e.g. Generate 10 edge cases where a customer is frustrated and wants to cancel but could be retained with a discount offer..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Count (1–50)</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={e => setCount(parseInt(e.target.value) || 5)}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Persona Hint (optional)</label>
                <input
                  type="text"
                  value={personaHint}
                  onChange={e => setPersonaHint(e.target.value)}
                  className="input"
                  placeholder="e.g. frustrated customer"
                />
              </div>
            </div>

            <Button
              onClick={() => generateMutation.mutate()}
              loading={generateMutation.isPending}
              disabled={!prompt.trim()}
              className="w-full"
            >
              <Sparkles size={16} />
              Generate Scenarios
            </Button>
          </div>

          {/* Generated results */}
          {generated.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-dark-text">Generated Scenarios</span>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs text-primary-blue hover:underline"
                    onClick={() => setGenerated(prev => prev.map(s => ({ ...s, selected: true })))}
                  >
                    Select all
                  </button>
                  <span className="text-xs text-gray-text">|</span>
                  <button
                    className="text-xs text-primary-blue hover:underline"
                    onClick={() => setGenerated(prev => prev.map(s => ({ ...s, selected: false })))}
                  >
                    Deselect all
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {generated.map((scenario, i) => (
                  <div
                    key={i}
                    className={`border rounded-lg p-3 transition-colors ${scenario.selected ? 'border-primary-blue bg-blue-50' : 'border-brand-border bg-white'}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => toggleScenario(i)}
                        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${scenario.selected ? 'bg-primary-blue border-primary-blue' : 'border-gray-300'}`}
                      >
                        {scenario.selected && <Check size={10} className="text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <input
                          type="text"
                          value={scenario.name}
                          onChange={e => updateScenario(i, 'name', e.target.value)}
                          className="text-sm font-medium text-dark-text bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary-blue focus:outline-none w-full"
                        />
                        <div className="mt-1">
                          <textarea
                            value={scenario.seed_utterance}
                            onChange={e => updateScenario(i, 'seed_utterance', e.target.value)}
                            className="text-xs text-gray-text bg-transparent border border-transparent hover:border-gray-200 focus:border-primary-blue focus:outline-none w-full resize-none rounded p-1"
                            rows={2}
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="blue">{scenario.expected_outcome_type?.replace('_', ' ')}</Badge>
                          {scenario.tags?.map(tag => <Badge key={tag} variant="gray">{tag}</Badge>)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {generated.length > 0 && (
          <div className="px-6 py-4 border-t border-brand-border bg-gray-50 flex items-center justify-between">
            <span className="text-sm text-gray-text">{selectedCount} of {generated.length} selected</span>
            <Button
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              disabled={selectedCount === 0}
            >
              <Save size={16} />
              Save Selected ({selectedCount})
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
