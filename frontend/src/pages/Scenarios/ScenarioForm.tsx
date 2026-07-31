import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import TagInput from '../../components/ui/TagInput';
import Button from '../../components/ui/Button';
import { getPersonas, getMetrics } from '../../api/client';
import type { Scenario, Metric } from '../../types';

const schema = z.object({
  name: z.string().min(1, 'Scenario name is required'),
  description: z.string().optional(),
  seed_utterance: z.string().min(1, 'Conversation seed is required'),
  expected_outcome_type: z.enum(['natural_language', 'tool_call', 'kpi_threshold']),
  expected_outcome_value: z.string().optional(),
  persona_id: z.string().optional(),
  tags: z.array(z.string()).default([]),
  metric_ids: z.array(z.string()).default([]),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
});

export type ScenarioFormData = z.infer<typeof schema>;

interface ScenarioFormProps {
  defaultValues?: Partial<Scenario>;
  onSubmit: (data: ScenarioFormData) => Promise<void>;
  isLoading?: boolean;
  onCancel: () => void;
}

export default function ScenarioForm({ defaultValues, onSubmit, isLoading, onCancel }: ScenarioFormProps) {
  const { data: personas } = useQuery({
    queryKey: ['personas'],
    queryFn: () => getPersonas(),
  });

  const { data: metrics } = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
  });

  const { register, handleSubmit, watch, setValue, control, formState: { errors } } = useForm<ScenarioFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name || '',
      description: defaultValues?.description || '',
      seed_utterance: defaultValues?.seed_utterance || '',
      expected_outcome_type: defaultValues?.expected_outcome_type || 'natural_language',
      expected_outcome_value: defaultValues?.expected_outcome_value || '',
      persona_id: defaultValues?.persona_id || '',
      tags: defaultValues?.tags || [],
      metric_ids: defaultValues?.metric_ids || [],
      status: defaultValues?.status || 'draft',
    }
  });

  const selectedMetricIds = watch('metric_ids');
  const toggleMetric = (id: string) => {
    const current = selectedMetricIds || [];
    setValue('metric_ids', current.includes(id) ? current.filter(m => m !== id) : [...current, id]);
  };

  const outcomeType = watch('expected_outcome_type');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Name */}
      <div>
        <label className="label">Scenario Name *</label>
        <input {...register('name')} className="input" placeholder="e.g. Price Objection — Retention Opportunity" />
        {errors.name && <p className="error-text">{errors.name.message}</p>}
      </div>

      {/* Description */}
      <div>
        <label className="label">Description / Intent</label>
        <textarea {...register('description')} className="textarea h-20" placeholder="Describe the scenario intent and context..." />
      </div>

      {/* Seed */}
      <div>
        <label className="label">Conversation Seed *</label>
        <textarea {...register('seed_utterance')} className="textarea h-20" placeholder="This is the first user utterance that starts the conversation..." />
        {errors.seed_utterance && <p className="error-text">{errors.seed_utterance.message}</p>}
        <p className="text-xs text-gray-text mt-1">This message will be sent by the AI user simulator to start the conversation.</p>
      </div>

      {/* Expected Outcome */}
      <div>
        <label className="label">Expected Outcome Type *</label>
        <div className="space-y-2 mb-3">
          {(['natural_language', 'tool_call', 'kpi_threshold'] as const).map(type => (
            <label key={type} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value={type}
                {...register('expected_outcome_type')}
                className="text-primary-blue"
              />
              <span className="text-sm text-dark-text capitalize">
                {type === 'natural_language' ? 'Natural Language' : type === 'tool_call' ? 'Required Tool Call' : 'KPI Score Threshold'}
              </span>
            </label>
          ))}
        </div>

        {outcomeType === 'natural_language' && (
          <div>
            <label className="label">Expected Outcome Description</label>
            <textarea
              {...register('expected_outcome_value')}
              className="textarea h-20"
              placeholder="Describe in plain English what a passing outcome looks like..."
            />
          </div>
        )}
        {outcomeType === 'tool_call' && (
          <div>
            <label className="label">Required Tool Name</label>
            <input
              {...register('expected_outcome_value')}
              className="input"
              placeholder="e.g. process_cancellation"
            />
          </div>
        )}
        {outcomeType === 'kpi_threshold' && (
          <div>
            <label className="label">KPI Threshold</label>
            <input
              {...register('expected_outcome_value')}
              className="input"
              placeholder="e.g. score >= 0.8"
            />
          </div>
        )}
      </div>

      {/* Persona */}
      <div>
        <label className="label">Persona Assignment</label>
        <select {...register('persona_id')} className="select">
          <option value="">No persona assigned</option>
          {personas?.map((p: { id: string; name: string }) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Tags */}
      <div>
        <label className="label">Tags</label>
        <Controller
          name="tags"
          control={control}
          render={({ field }) => (
            <TagInput
              value={field.value}
              onChange={field.onChange}
              placeholder="Type a tag and press Enter..."
            />
          )}
        />
      </div>

      {/* Metrics */}
      <div>
        <label className="label">Metrics</label>
        <p className="text-xs text-gray-text mb-2">Select metrics to evaluate in runs that use this scenario.</p>
        {metrics && metrics.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {metrics.filter((m: Metric) => m.status === 'active').map((m: Metric) => {
              const selected = selectedMetricIds?.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMetric(m.id)}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                    selected
                      ? 'bg-primary-blue text-white border-primary-blue'
                      : 'bg-white text-dark-text border-brand-border hover:border-primary-blue'
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-text italic">No metrics defined yet. Add metrics in the Metrics section.</p>
        )}
      </div>

      {/* Status */}
      <div>
        <label className="label">Status</label>
        <div className="flex items-center gap-4">
          {(['draft', 'active'] as const).map(s => (
            <label key={s} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={s} {...register('status')} className="text-primary-blue" />
              <span className="text-sm text-dark-text capitalize">{s}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-brand-border">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={isLoading}>Save Scenario</Button>
      </div>
    </form>
  );
}
