import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FlaskConical } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { createMetric, testMetric } from '../../api/client';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  type: z.enum(['conversation', 'turn']),
});

type FormData = z.infer<typeof schema>;

const SAMPLE_TRANSCRIPT = `Agent: Hello, how can I help you today?
Customer: I want to cancel my insurance policy.
Agent: I understand. Let me verify your identity first. Could you provide your policy number?
Customer: It's POL-9988.
Agent: Thank you. Before I process the cancellation, I'd like to offer you a 15% loyalty discount. Would that help?
Customer: That's interesting. Tell me more.
Agent: You'd keep all your current benefits but pay 15% less per month. That's a savings of $180 annually.
Customer: Let's do that instead of cancelling.
Agent: Excellent! I've applied the discount. Your new premium starts next billing cycle.`;

export default function MetricNew() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [testTranscript, setTestTranscript] = useState(SAMPLE_TRANSCRIPT);
  const [testResult, setTestResult] = useState<{ score: number; rationale: string } | null>(null);
  const [metricId, setMetricId] = useState<string | null>(null);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'conversation' }
  });

  const createMutation = useMutation({
    mutationFn: (data: FormData) => createMetric(data),
    onSuccess: (metric) => {
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      toast.success('Metric created');
      setMetricId(metric.id);
    }
  });

  const testMutation = useMutation({
    mutationFn: () => {
      if (!metricId) throw new Error('Save metric first');
      return testMetric(metricId, { transcript: testTranscript });
    },
    onSuccess: (result) => setTestResult(result)
  });

  const description = watch('description');

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">New Metric</h1>
        <p className="page-subtitle">Define a custom evaluation metric</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit(d => createMutation.mutate(d))} className="space-y-5">
          <div>
            <label className="label">Metric Name *</label>
            <input {...register('name')} className="input" placeholder="e.g. Resolution Rate" />
            {errors.name && <p className="error-text">{errors.name.message}</p>}
          </div>

          <div>
            <label className="label">Description (Natural Language)</label>
            <textarea
              {...register('description')}
              className="textarea h-24"
              placeholder="Describe what this metric measures in plain English. This description will be sent to the LLM evaluator..."
            />
          </div>

          <div>
            <label className="label">Type</label>
            <select {...register('type')} className="select">
              <option value="conversation">Conversation-level</option>
              <option value="turn">Turn-level</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-brand-border">
            <Button type="button" variant="secondary" onClick={() => navigate('/metrics')}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>
              {metricId ? 'Saved' : 'Save Metric'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Test feature */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <FlaskConical size={16} className="text-primary-blue" />
          <h3 className="text-sm font-semibold text-dark-text">Test Metric</h3>
          {!metricId && <span className="text-xs text-gray-text">(Save metric first)</span>}
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Sample Transcript</label>
            <textarea
              value={testTranscript}
              onChange={e => setTestTranscript(e.target.value)}
              className="textarea h-40 font-mono text-xs"
            />
          </div>

          <Button
            variant="secondary"
            onClick={() => testMutation.mutate()}
            loading={testMutation.isPending}
            disabled={!metricId || !testTranscript.trim()}
          >
            <FlaskConical size={14} />
            Test Metric
          </Button>

          {testResult && (
            <div className="bg-light-blue rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-dark-text">Score:</span>
                <Badge variant={testResult.score >= 0.7 ? 'green' : testResult.score >= 0.3 ? 'amber' : 'red'}>
                  {Math.round(testResult.score * 100)}%
                </Badge>
              </div>
              <div>
                <span className="text-xs font-semibold text-gray-text">Rationale:</span>
                <p className="text-sm text-gray-600 mt-1">{testResult.rationale}</p>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
