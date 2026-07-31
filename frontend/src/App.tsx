import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import ScenarioList from './pages/Scenarios/ScenarioList';
import ScenarioNew from './pages/Scenarios/ScenarioNew';
import ScenarioEdit from './pages/Scenarios/ScenarioEdit';
import AgentsList from './pages/Agents/AgentsList';
import AgentDetail from './pages/Agents/AgentDetail';
import PersonasList from './pages/Personas/PersonasList';
import EvalRunList from './pages/EvalRuns/EvalRunList';
import EvalRunDetail from './pages/EvalRuns/EvalRunDetail';
import HumanReview from './pages/EvaluatorQuality/HumanReview';
import TraceDetail from './pages/TraceInspector/TraceDetail';
import MetricsList from './pages/Metrics/MetricsList';
import MetricNew from './pages/Metrics/MetricNew';
import MetricEdit from './pages/Metrics/MetricEdit';
import Compare from './pages/VersionComparison/Compare';
import Upload from './pages/Upload/Upload';
import Settings from './pages/Settings/Settings';
import VoiceAgent from './pages/Voice/VoiceAgent';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="agents" element={<AgentsList />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="scenarios" element={<ScenarioList />} />
          <Route path="scenarios/new" element={<ScenarioNew />} />
          <Route path="scenarios/:id/edit" element={<ScenarioEdit />} />
          <Route path="personas" element={<PersonasList />} />
          <Route path="eval-runs" element={<EvalRunList />} />
          <Route path="eval-runs/:id" element={<EvalRunDetail />} />
          <Route path="eval-runs/:id/human-review" element={<HumanReview />} />
          <Route path="trial/:id" element={<TraceDetail />} />
          <Route path="metrics" element={<MetricsList />} />
          <Route path="metrics/new" element={<MetricNew />} />
          <Route path="metrics/:id/edit" element={<MetricEdit />} />
          <Route path="compare" element={<Compare />} />
          <Route path="upload" element={<Upload />} />
          <Route path="settings" element={<Settings />} />
          <Route path="voice" element={<VoiceAgent />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
