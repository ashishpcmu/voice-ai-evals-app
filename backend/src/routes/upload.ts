import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseTranscriptText, parsePDF, parseDOCX } from '../services/transcriptParser';

const router = Router();

function now() { return new Date().toISOString(); }

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF and DOCX files are allowed'));
  }
});

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
    }

    const fileId = uuidv4();
    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileType = ext === '.pdf' ? 'pdf' : 'docx';

    sqlite.prepare(`
      INSERT INTO uploaded_files (id, original_name, file_path, file_type, parsing_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fileId, req.file.originalname, req.file.path, fileType, 'pending', now());

    // Parse in background
    parseFile(fileId, req.file.path, fileType).catch(err => {
      console.error('Parse failed:', err);
      sqlite.prepare('UPDATE uploaded_files SET parsing_status = ? WHERE id = ?').run('error', fileId);
    });

    const file = sqlite.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(fileId);
    res.status(201).json(file);
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload file', code: 'UPLOAD_ERROR' });
  }
});

async function parseFile(fileId: string, filePath: string, fileType: string) {
  try {
    const buffer = fs.readFileSync(filePath);
    let text = '';

    if (fileType === 'pdf') {
      text = await parsePDF(buffer);
    } else {
      text = await parseDOCX(buffer);
    }

    const parsed = parseTranscriptText(text);
    sqlite.prepare('UPDATE uploaded_files SET parsed_content = ?, parsing_status = ? WHERE id = ?')
      .run(JSON.stringify(parsed), 'complete', fileId);
  } catch (err) {
    throw err;
  }
}

router.get('/:id/preview', (req: Request, res: Response) => {
  try {
    const file = sqlite.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!file) return res.status(404).json({ error: 'File not found', code: 'NOT_FOUND' });

    res.json({
      ...file,
      parsed_content: file.parsed_content ? JSON.parse(file.parsed_content as string) : null
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch preview', code: 'FETCH_ERROR' });
  }
});

router.get('/', (_req: Request, res: Response) => {
  try {
    const files = sqlite.prepare('SELECT id, original_name, file_type, parsing_status, created_at FROM uploaded_files ORDER BY created_at DESC').all();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch files', code: 'FETCH_ERROR' });
  }
});

export default router;
