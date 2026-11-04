# apps/worker (arrives in Phase 3)

The background worker: a separate Node process from this repo that runs the pg-boss queues (`ai.extract`, `ai.tailor`, `pdf.render`, `jobs.ingest`, `cleanup.retention`), keeping slow work like AI calls and Playwright PDF rendering off web requests. It is empty for now. In Phase 1, resume parsing runs inside the web request and will move here in Phase 3.
