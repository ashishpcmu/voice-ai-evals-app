import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { getMetric, updateMetric } from '../../api/client';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  type: z.enum(['conversation', 'turn']),
  status: z.enum(['active', 'archived']),
});

type FormData = z.infer<typeof schema>;

export default function MetricEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: metric, isLoading } = useQuery({
    queryKey: ['metric', id],
    queryFn: () => getMetric(id!),
    enabled: !!id
  });

  const mutation = useMutation({
    mutationFn: (data: FormData) => updateMetric(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      toast.success('Metric updated');
      navigate('/metrics');
    }
  });

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    values: metric ? {
      name: metric.name,
      description: metric.description || '',
      type: metric.type,
      status: metric.status
    } : undefined
  });

  if (isLoading) return <div className="max-w-2xl"><Skeleton className="h-64 rounded-xl" /></div>;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="page-title">Edit Metric</h1>
        <p className="page-subtitle">{metric?.name}</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-5">
          <div>
            <label className="label">Name *</label>
            <input {...register('name')} className="input" />
            {errors.name && <p className="error-text">{errors.name.message}</p>}
          </div>
          <div>
            <label className="label">Description</label>
            <textarea {...register('description')} className="textarea h-24" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select {...register('type')} className="select">
                <option value="conversation">Conversation-level</option>
                <option value="turn">Turn-level</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select {...register('status')} className="select">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-brand-border">
            <Button type="button" variant="secondary" onClick={() => navigate('/metrics')}>Cancel</Button>
            <Button type="submit" loading={mutation.isPending}>Save Changes</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
