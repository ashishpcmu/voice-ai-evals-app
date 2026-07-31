import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Upload as UploadIcon, FileText, CheckCircle, Clock, AlertCircle, Eye, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { uploadFile, getUploadedFiles, getFilePreview } from '../../api/client';
import UploadEvalRun from './UploadEvalRun';

type Tab = 'upload' | 'eval-run';

export default function Upload() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { data: files, isLoading } = useQuery({
    queryKey: ['uploaded-files'],
    queryFn: getUploadedFiles,
    refetchInterval: 5000
  });

  const { data: preview } = useQuery({
    queryKey: ['file-preview', previewId],
    queryFn: () => getFilePreview(previewId!),
    enabled: !!previewId
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return uploadFile(formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-files'] });
      toast.success('File uploaded and parsing started');
    }
  });

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.pdf') && !file.name.endsWith('.docx')) {
      toast.error('Only PDF and DOCX files are supported');
      return;
    }
    uploadMutation.mutate(file);
  }, [uploadMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  function statusBadge(status: string) {
    switch (status) {
      case 'complete': return <Badge variant="green"><CheckCircle size={10} /> Parsed</Badge>;
      case 'pending': return <Badge variant="gray"><Clock size={10} /> Pending</Badge>;
      case 'error': return <Badge variant="red"><AlertCircle size={10} /> Error</Badge>;
      default: return <Badge variant="gray">{status}</Badge>;
    }
  }

  const parsedContent = preview?.parsed_content;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Upload</h1>
        <p className="page-subtitle">Upload call transcripts or create an eval run from real conversation data</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-brand-border">
        <button
          onClick={() => setActiveTab('upload')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'upload'
              ? 'border-primary-blue text-primary-blue'
              : 'border-transparent text-gray-text hover:text-dark-text'
          }`}
        >
          <UploadIcon size={14} />
          Upload Transcript
        </button>
        <button
          onClick={() => setActiveTab('eval-run')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'eval-run'
              ? 'border-primary-blue text-primary-blue'
              : 'border-transparent text-gray-text hover:text-dark-text'
          }`}
        >
          <Play size={14} />
          Eval Run from Transcript
        </button>
      </div>

      {/* Tab: Upload Transcript */}
      {activeTab === 'upload' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            {/* Upload zone */}
            <div className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${dragOver ? 'border-primary-blue bg-blue-50' : 'border-brand-border hover:border-primary-blue hover:bg-gray-50'}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                <UploadIcon size={40} className={`mx-auto mb-4 ${dragOver ? 'text-primary-blue' : 'text-gray-text'}`} />
                <h3 className="text-sm font-semibold text-dark-text mb-2">Drop files here</h3>
                <p className="text-xs text-gray-text mb-4">Supports PDF and DOCX files up to 10MB</p>
                <Button variant="secondary" size="sm" type="button" loading={uploadMutation.isPending}>
                  Choose File
                </Button>
                <input
                  id="file-upload"
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </div>

              {/* Format guide */}
              <Card className="py-4 px-5">
                <h3 className="text-sm font-semibold text-dark-text mb-3">Supported Format</h3>
                <div className="text-xs text-gray-600 space-y-1 font-mono bg-gray-50 rounded-lg p-3">
                  <div>[HH:MM:SS] Agent: Hello, how can I help?</div>
                  <div>[HH:MM:SS] Customer: I need to cancel.</div>
                  <div>[T+2.1s] TOOL CALL: verify_customer_identity</div>
                  <div>[T+3.4s] KB LOOKUP: policy_faq</div>
                </div>
                <p className="text-xs text-gray-text mt-2">Lines starting with Agent:, BOT:, Customer:, User:, TOOL CALL:, or KB LOOKUP: are automatically classified.</p>
              </Card>
            </div>

            {/* Uploaded files */}
            <div>
              <Card padding={false}>
                <div className="px-4 py-3 border-b border-brand-border">
                  <h3 className="text-sm font-semibold text-dark-text">Uploaded Files</h3>
                </div>
                {isLoading ? (
                  <div className="p-8 text-center text-gray-text text-sm">Loading...</div>
                ) : !files?.length ? (
                  <div className="p-8 text-center text-gray-text text-sm">No files uploaded yet</div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {files.map((file: { id: string; original_name: string; file_type: string; parsing_status: string; created_at: string }) => (
                      <div key={file.id} className={`px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors ${previewId === file.id ? 'bg-light-blue' : ''}`}>
                        <FileText size={16} className="text-gray-text flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-dark-text truncate">{file.original_name}</div>
                          <div className="text-xs text-gray-text">
                            {file.file_type.toUpperCase()} · {new Date(file.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        {statusBadge(file.parsing_status)}
                        {file.parsing_status === 'complete' && (
                          <button
                            onClick={() => setPreviewId(previewId === file.id ? null : file.id)}
                            className="p-1.5 text-gray-text hover:text-primary-blue hover:bg-blue-50 rounded transition-colors"
                          >
                            <Eye size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Quick-jump to Eval Run tab */}
              {files?.some((f: { parsing_status: string }) => f.parsing_status === 'complete') && (
                <button
                  onClick={() => setActiveTab('eval-run')}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-blue/5 border border-primary-blue/20 rounded-lg text-sm text-primary-blue hover:bg-primary-blue/10 transition-colors"
                >
                  <Play size={13} />
                  Create an Eval Run from these transcripts
                </button>
              )}
            </div>
          </div>

          {/* Preview */}
          {previewId && parsedContent && (
            <Card padding={false}>
              <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-dark-text">Parsed Transcript Preview</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-text">{parsedContent.turn_count} turns parsed</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (parsedContent.turns?.[0]) {
                        navigate('/scenarios/new');
                        toast.success('First turn copied as scenario seed');
                      }
                    }}
                  >
                    Create Scenario from First Turn
                  </Button>
                </div>
              </div>
              <div className="p-4 max-h-[400px] overflow-y-auto space-y-2">
                {parsedContent.turns?.map((turn: { id: string; role: string; content: string; timestamp?: string }, i: number) => (
                  <div
                    key={i}
                    className={`flex gap-3 px-3 py-2 rounded-lg ${turn.role === 'user' ? 'bg-gray-50' : turn.role === 'tool' ? 'bg-teal-50 border-l-2 border-accent-teal' : turn.role === 'kb' ? 'bg-blue-50 border-l-2 border-primary-blue' : 'bg-white border border-brand-border'}`}
                  >
                    <div className="flex-shrink-0 w-14 text-xs text-gray-text pt-0.5">
                      {turn.role === 'tool' ? 'TOOL' : turn.role === 'kb' ? 'KB' : turn.role === 'user' ? 'Customer' : 'Agent'}
                    </div>
                    <div className="flex-1">
                      {turn.timestamp && <span className="text-xs text-gray-text mr-2">{turn.timestamp}</span>}
                      <span className="text-sm text-dark-text">{turn.content}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Tab: Eval Run from Transcript */}
      {activeTab === 'eval-run' && <UploadEvalRun />}
    </div>
  );
}
