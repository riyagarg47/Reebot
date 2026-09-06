# Reebot

Reebot is a source-grounded chat application. Users create rooms, attach PDFs
or URLs, and ask questions that are answered from those sources.

## Architecture

- `frontend/`: React and Vite user interface.
- `backend/`: Express API, MongoDB models, local Chroma vector retrieval, and
  OpenAI chat.
- `backend/src/pdf_parser.py`: extracts PDF content as Markdown with
  PyMuPDF4LLM.
- `backend/src/pdfParser.js`: the Node-to-Python process boundary.
- `backend/src/markdownChunker.js`: splits parsed Markdown by headings,
  sections, structural blocks, and sentence boundaries.

Room ingestion preserves Markdown structure and heading context while keeping
chunks within the configured size whenever a structural block permits it.

## Run with Docker

1. Copy `.env.example` to `backend/.env` and set `OPENAI_API_KEY` and
   `JWT_SECRET`.
2. Start the stack:

   ```sh
   docker compose up --build
   ```

3. Open `http://localhost:5173` for rooms and chat.

## Local development

The backend requires Node.js 22+, Python 3, the packages in
`backend/requirements.txt`, MongoDB, and ChromaDB. MongoDB and ChromaDB must be
available when running the backend outside Docker.

```sh
cd backend
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PYTHON_BIN="$PWD/.venv/bin/python" npm run dev
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Because `backend/.env` is in the backend working directory, `dotenv` loads it
automatically. `PYTHON_BIN` selects the virtual environment used by the PDF
parser. Set `PDF_PARSE_TIMEOUT_MS` in `backend/.env` to override the default
two-minute parser timeout.

## Verification

```sh
cd backend && npm test
cd frontend && npm run build
```

PyMuPDF4LLM and PyMuPDF are AGPL-3.0 licensed unless used under a commercial
license. Confirm that this is compatible with your distribution model.
