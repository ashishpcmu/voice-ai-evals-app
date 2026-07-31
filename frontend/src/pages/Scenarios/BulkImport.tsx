import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, CheckCircle, XCircle, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { importScenarios } from '../../api/client';

interface Props {
  agentId?: string;
  onClose: () => void;
}

function parseCSV(text: string) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = (values[j] || '').replace(/^"|"$/g, '').trim();
    });
    if (row.name || row.seed_utterance) rows.push(row);
  }

  return rows;
}

export default function BulkImport({ agentId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Array<Record<string, string>>>([]);
  const [dragOver, setDragOver] = useState(false);

  const importMutation = useMutation({
    mutationFn: () => importScenarios({ scenarios: preview, agent_id: agentId }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast.success(`Imported ${data.success} scenarios (${data.errors} errors)`);
      onClose();
    }
  });

  const handleFile = useCallback((f: File) => {
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);
      setPreview(rows);
    };
    reader.readAsText(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.csv') || f.name.endsWith('.json'))) {
      handleFile(f);
    }
  }, [handleFile]);

  const validRows = preview.filter(r => r.name && r.seed_utterance);
  const invalidRows = preview.filter(r => !r.name || !r.seed_utterance);

  return (
    <Modal isOpen={true} onClose={onClose} title="Bulk Import Scenarios" size="lg">
      <div className="p-6 space-y-5">
        {/* Upload area */}
        {!file ? (
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${dragOver ? 'border-primary-blue bg-blue-50' : 'border-brand-border hover:border-primary-blue hover:bg-gray-50'}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('csv-upload')?.click()}
          >
            <Upload size={32} className="mx-auto text-gray-text mb-3" />
            <p className="text-sm font-medium text-dark-text mb-1">Drop a CSV or JSON file here</p>
            <p className="text-xs text-gray-text mb-4">or click to browse</p>
            <Button variant="secondary" size="sm" type="button">Choose File</Button>
            <input
              id="csv-upload"
              type="file"
              accept=".csv,.json"
              className="hidden"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-brand-border">
            <FileText size={20} className="text-primary-blue" />
            <div className="flex-1">
              <div className="text-sm font-medium text-dark-text">{file.name}</div>
              <div className="text-xs text-gray-text">{preview.length} rows parsed</div>
            </div>
            <button onClick={() => { setFile(null); setPreview([]); }} className="p-1 hover:bg-gray-200 rounded transition-colors">
              <X size={14} className="text-gray-text" />
            </button>
          </div>
        )}

        {/* CSV format info */}
        <div className="bg-light-blue rounded-lg p-3 text-xs text-gray-text">
          <strong className="text-dark-text">Expected CSV columns:</strong>{' '}
          name, seed_utterance, expected_outcome_type, expected_outcome_value, persona_hint, tags
        </div>

        {/* Preview table */}
        {preview.length > 0 && (
          <div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1.5 text-success-green text-sm">
                <CheckCircle size={14} />
                <span>{validRows.length} valid rows</span>
              </div>
              {invalidRows.length > 0 && (
                <div className="flex items-center gap-1.5 text-error-red text-sm">
                  <XCircle size={14} />
                  <span>{invalidRows.length} rows with errors</span>
                </div>
              )}
            </div>

            <div className="border border-brand-border rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-text font-medium">Status</th>
                    <th className="px-3 py-2 text-left text-gray-text font-medium">Name</th>
                    <th className="px-3 py-2 text-left text-gray-text font-medium">Seed Utterance</th>
                    <th className="px-3 py-2 text-left text-gray-text font-medium">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.map((row, i) => {
                    const isValid = !!(row.name && row.seed_utterance);
                    return (
                      <tr key={i} className={isValid ? 'bg-white' : 'bg-red-50'}>
                        <td className="px-3 py-2">
                          {isValid
                            ? <CheckCircle size={12} className="text-success-green" />
                            : <XCircle size={12} className="text-error-red" />
                          }
                        </td>
                        <td className="px-3 py-2 font-medium text-dark-text truncate max-w-[150px]">{row.name || <span className="text-error-red">Missing</span>}</td>
                        <td className="px-3 py-2 text-gray-text truncate max-w-[200px]">{row.seed_utterance || <span className="text-error-red">Missing</span>}</td>
                        <td className="px-3 py-2 text-gray-text">{row.expected_outcome_type || 'natural_language'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => importMutation.mutate()}
            loading={importMutation.isPending}
            disabled={validRows.length === 0}
          >
            Import {validRows.length} Valid Rows
          </Button>
        </div>
      </div>
    </Modal>
  );
}
