import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import ScenarioForm, { ScenarioFormData } from './ScenarioForm';
import { getScenario, updateScenario } from '../../api/client';

export default function ScenarioEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: scenario, isLoading } = useQuery({
    queryKey: ['scenario', id],
    queryFn: () => getScenario(id!),
    enabled: !!id
  });

  const mutation = useMutation({
    mutationFn: (data: ScenarioFormData) => updateScenario(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      queryClient.invalidateQueries({ queryKey: ['scenario', id] });
      toast.success('Scenario updated');
      navigate('/scenarios');
    }
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6"><Skeleton className="h-8 w-48" /></div>
        <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i}><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-10 w-full" /></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="page-title">Edit Scenario</h1>
        <p className="page-subtitle">{scenario?.name}</p>
      </div>
      <Card>
        <ScenarioForm
          defaultValues={scenario}
          onSubmit={async (data) => mutation.mutate(data)}
          isLoading={mutation.isPending}
          onCancel={() => navigate('/scenarios')}
        />
      </Card>
    </div>
  );
}
