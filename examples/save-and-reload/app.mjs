import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export async function readNote(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export async function writeNote(file, note) {
  await writeFile(file, note, 'utf8');
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function createApp({ directory, simulateBadWiring = false }) {
  const readable = join(directory, 'note.txt');
  const writable = simulateBadWiring ? join(directory, 'draft.txt') : readable;
  return createServer(async (request, response) => {
    try {
      if (request.url !== '/' || !['GET', 'POST'].includes(request.method)) {
        response.writeHead(404).end();
        return;
      }
      let status = '';
      if (request.method === 'POST') {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 8192) {
            response.writeHead(413).end();
            return;
          }
        }
        await writeNote(writable, new URLSearchParams(body).get('note') ?? '');
        status = '<p role="status">Saved</p>';
      }
      const note = escapeHtml(await readNote(readable));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        '<!doctype html><meta charset="utf-8"><title>Save a note</title>' +
        '<h1>Save a note</h1>' + status +
        '<form method="post"><label for="note">Note</label><textarea id="note" name="note">' +
        note + '</textarea><button>Save</button></form>',
      );
    } catch {
      response.writeHead(500).end('Note storage unavailable.');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    data: { type: 'string' },
    port: { type: 'string', default: '3000' },
    'miswired': { type: 'boolean' },
  } });
  if (!values.data) throw new Error('Choose an existing data directory with --data DIR.');
  const app = createApp({ directory: values.data, simulateBadWiring: values.miswired });
  app.listen(Number(values.port), '127.0.0.1', () => console.log('http://127.0.0.1:' + app.address().port));
}
