import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import ScenarioForm, { ScenarioFormData } from './ScenarioForm';
import { createScenario, getAgents } from '../../api/client';

export default function ScenarioNew() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: getAgents });
  const agentId = agents?.[0]?.id;

  const mutation = useMutation({
    mutationFn: (data: ScenarioFormData) => createScenario({ ...data, agent_id: agentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast.success('Scenario saved');
      navigate('/scenarios');
    }
  });

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="page-title">New Scenario</h1>
        <p className="page-subtitle">Define a test scenario for your AI agent</p>
      </div>
      <Card>
        <ScenarioForm
          onSubmit={async (data) => mutation.mutate(data)}
          isLoading={mutation.isPending}
          onCancel={() => navigate('/scenarios')}
        />
      </Card>
    </div>
  );
}
