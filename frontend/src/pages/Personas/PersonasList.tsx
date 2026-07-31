import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPersonas, createPersona, updatePersona, deletePersona } from '../../api/client';
import type { Persona } from '../../types';

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Mandarin', 'Japanese', 'Hindi', 'Arabic'];

const LEVEL_LABELS: Record<number, string> = {
  1: 'Very Low',
  2: 'Low',
  3: 'Medium',
  4: 'High',
  5: 'Very High',
};

function LevelSelect({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex-1 py-1.5 text-xs rounded border font-medium transition-colors ${
              value === n
                ? 'bg-primary-blue text-white border-primary-blue'
                : 'border-brand-border text-gray-text hover:border-primary-blue hover:text-primary-blue'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-text mt-1">{LEVEL_LABELS[value] || 'Medium'}</p>
    </div>
  );
}

interface PersonaFormData {
  name: string;
  description: string;
  language: string;
  tone: string;
  goal: string;
  frustration_level: number;
  interruption_level: number;
  speed: number;
}

const defaultForm: PersonaFormData = {
  name: '',
  description: '',
  language: 'English',
  tone: '',
  goal: '',
  frustration_level: 3,
  interruption_level: 3,
  speed: 3,
};

function PersonaForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: PersonaFormData;
  onSave: (data: PersonaFormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<PersonaFormData>(initial);

  const set = (field: keyof PersonaFormData, value: string | number) =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="input"
            placeholder="e.g. Frustrated Customer"
          />
        </div>
        <div>
          <label className="label">Language</label>
          <select value={form.language} onChange={e => set('language', e.target.value)} className="input">
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Description</label>
        <textarea
          value={form.description}
          onChange={e => set('description', e.target.value)}
          rows={3}
          className="input resize-none"
          placeholder="Describe this persona's behavior, tone, and typical conversation style…"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Tone / Mood</label>
          <input
            type="text"
            value={form.tone}
            onChange={e => set('tone', e.target.value)}
            className="input"
            placeholder="e.g. frustrated, neutral, confused"
          />
        </div>
        <div>
          <label className="label">Goal</label>
          <input
            type="text"
            value={form.goal}
            onChange={e => set('goal', e.target.value)}
            className="input"
            placeholder="e.g. cancel immediately, get a discount"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <LevelSelect
          label="Frustration Level"
          value={form.frustration_level}
          onChange={v => set('frustration_level', v)}
        />
        <LevelSelect
          label="Interruption Level"
          value={form.interruption_level}
          onChange={v => set('interruption_level', v)}
        />
        <LevelSelect
          label="Speaking Speed"
          value={form.speed}
          onChange={v => set('speed', v)}
        />
      </div>

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
          disabled={!form.name.trim() || saving}
          onClick={() => onSave(form)}
          className="px-4 py-2 text-sm font-medium bg-primary-blue text-white rounded-lg hover:bg-primary-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {saving ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Check size={14} />
          )}
          Save Persona
        </button>
      </div>
    </div>
  );
}

function PersonaCard({
  persona,
  onEdit,
  onDelete,
}: {
  persona: Persona;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white border border-brand-border rounded-xl overflow-hidden hover:shadow-sm transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-primary-blue/10 flex items-center justify-center flex-shrink-0">
              <span className="text-primary-blue font-semibold text-sm">
                {persona.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-dark-text text-sm">{persona.name}</div>
              {persona.tone && (
                <div className="text-xs text-gray-text capitalize">{persona.tone}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 text-gray-text hover:text-dark-text hover:bg-gray-100 rounded-lg transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              onClick={onEdit}
              className="p-1.5 text-gray-text hover:text-primary-blue hover:bg-light-blue rounded-lg transition-colors"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 text-gray-text hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Stat pills */}
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="px-2 py-0.5 rounded-full text-xs bg-light-blue text-primary-blue border border-primary-blue/20">
            {persona.language || 'English'}
          </span>
          {persona.frustration_level != null && (
            <span className={`px-2 py-0.5 rounded-full text-xs border ${
              persona.frustration_level >= 4 ? 'bg-red-50 text-red-600 border-red-200' :
              persona.frustration_level >= 3 ? 'bg-amber-50 text-amber-600 border-amber-200' :
              'bg-green-50 text-green-600 border-green-200'
            }`}>
              Frustration {persona.frustration_level}/5
            </span>
          )}
          {persona.interruption_level != null && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 border border-gray-200">
              Interruption {persona.interruption_level}/5
            </span>
          )}
          {persona.speed != null && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 border border-gray-200">
              Speed {persona.speed}/5
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-2">
          {persona.description && (
            <p className="text-xs text-gray-text leading-relaxed">{persona.description}</p>
          )}
          {persona.goal && (
            <div className="text-xs">
              <span className="text-gray-text font-medium">Goal: </span>
              <span className="text-dark-text">{persona.goal}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PersonasList() {
  const queryClient = useQueryClient();

  const { data: personas = [], isLoading } = useQuery({
    queryKey: ['personas'],
    queryFn: () => getPersonas(),
  });

  const [showForm, setShowForm] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: PersonaFormData) => createPersona(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
      toast.success('Persona created');
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PersonaFormData }) =>
      updatePersona(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
      toast.success('Persona updated');
      setEditingPersona(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePersona(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
      toast.success('Persona deleted');
      setDeletingId(null);
    },
  });

  function toFormData(p: Persona): PersonaFormData {
    return {
      name: p.name,
      description: p.description || '',
      language: p.language || 'English',
      tone: p.tone || '',
      goal: p.goal || '',
      frustration_level: p.frustration_level ?? 3,
      interruption_level: p.interruption_level ?? 3,
      speed: p.speed ?? 3,
    };
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-dark-text">Personas</h2>
          <p className="text-sm text-gray-text mt-0.5">{personas.length} persona{personas.length !== 1 ? 's' : ''} configured</p>
        </div>
        {!showForm && !editingPersona && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-blue text-white text-sm font-medium rounded-lg hover:bg-primary-blue/90 transition-colors"
          >
            <Plus size={16} />
            New Persona
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && !editingPersona && (
        <div className="mb-6 bg-white border border-primary-blue/30 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-dark-text text-sm">New Persona</h3>
            <button onClick={() => setShowForm(false)} className="p-1 text-gray-text hover:text-dark-text">
              <X size={16} />
            </button>
          </div>
          <PersonaForm
            initial={defaultForm}
            onSave={data => createMutation.mutate(data)}
            onCancel={() => setShowForm(false)}
            saving={createMutation.isPending}
          />
        </div>
      )}

      {/* Personas grid */}
      {personas.length === 0 && !showForm ? (
        <div className="text-center py-16 border border-dashed border-brand-border rounded-xl">
          <Users size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-dark-text font-medium mb-1">No personas yet</p>
          <p className="text-sm text-gray-text mb-4">Create personas to assign to your test scenarios</p>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-primary-blue text-white text-sm font-medium rounded-lg hover:bg-primary-blue/90 transition-colors"
          >
            Create First Persona
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {personas.map((persona: Persona) => (
            <div key={persona.id}>
              {editingPersona?.id === persona.id ? (
                <div className="bg-white border border-primary-blue/30 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-dark-text text-sm">Edit Persona</h3>
                    <button onClick={() => setEditingPersona(null)} className="p-1 text-gray-text hover:text-dark-text">
                      <X size={16} />
                    </button>
                  </div>
                  <PersonaForm
                    initial={toFormData(persona)}
                    onSave={data => updateMutation.mutate({ id: persona.id, data })}
                    onCancel={() => setEditingPersona(null)}
                    saving={updateMutation.isPending}
                  />
                </div>
              ) : deletingId === persona.id ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
                  <p className="text-sm text-dark-text">
                    Delete <strong>{persona.name}</strong>? This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="px-3 py-1.5 text-xs border border-brand-border rounded-lg hover:bg-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(persona.id)}
                      disabled={deleteMutation.isPending}
                      className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <PersonaCard
                  persona={persona}
                  onEdit={() => { setShowForm(false); setEditingPersona(persona); }}
                  onDelete={() => setDeletingId(persona.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
