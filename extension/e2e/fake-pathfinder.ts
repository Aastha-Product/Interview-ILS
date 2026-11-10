// A fake Pathfinder for the extension's Chrome tests: the /api/ext routes as the real ones answer
// (src/app/api/ext), the real answer rules (src/lib/apply/answers.ts) for a demo student, and the
// Connect the extension page's side of the bridge. It keeps everything the extension sent.

import { createServer, type IncomingMessage, type Server } from "node:http";

import { answerForm, EMPTY_ANSWERS, type AnswerContext, type FormField } from "../../src/lib/apply/answers";
import { BRIDGE, type LeasedTask } from "../src/protocol";

export const PORT = 4319;
export const ORIGIN = `http://localhost:${PORT}`;
export const TOKEN = "pfx_e2e-token";

type State = "queued" | "leased" | "submitting" | "done";
export type Task = Omit<LeasedTask, "leaseId" | "leaseUntil"> & { state?: State; leaseId?: string };
export type Report = { taskId: string; outcome: string; reason?: string; evidence?: { url: string; text: string } };

export const student = (company: string): AnswerContext => ({
  basics: { name: "Asha Rao", email: "asha.rao@example.test", phone: "+91 98765 43210", city: "Pune", country: "India", linkedin: "https://www.linkedin.com/in/asha-rao", website: "" },
  pastEmployers: ["Infosys"],
  currentCompany: "Infosys",
  currentTitle: "Data Analyst Intern",
  university: "Savitribai Phule Pune University",
  experienceMonths: 6,
  experienceMonthsWithoutInternships: 0,
  graduationYear: "2026",
  company,
  saved: { ...EMPTY_ANSWERS, workAuthorized: true, needsSponsorship: false, noticePeriod: "immediate", relativesAtCompany: false, acceptPrivacyNotices: true, backgroundCheckConsent: true, willingToRelocate: true, outsideActivities: false, adult: true, employmentRestrictions: false, governmentOfficial: false, relativeOfGovernmentOfficial: false, referredByEmployee: false },
});

const read = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
};

const connectPage = `<!doctype html><html><head><meta charset="utf-8"><title>Connect the extension</title></head><body>
<p id="state">waiting</p>
<script>
  const BRIDGE = ${JSON.stringify(BRIDGE)};
  addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === BRIDGE.hello && document.getElementById("state").textContent === "waiting") document.getElementById("state").textContent = "installed";
    if (event.data?.type === BRIDGE.connected) document.getElementById("state").textContent = "connected";
  });
  postMessage({ type: BRIDGE.ping }, location.origin);
  window.connectExtension = (token) => postMessage({ type: BRIDGE.connect, token }, location.origin);
</script></body></html>`;

export class FakePathfinder {
  readonly tasks: Task[] = [];
  readonly reports: Report[] = [];
  readonly asked: { taskId: string; fields: FormField[] }[] = [];
  readonly documents: string[] = [];
  private server: Server | null = null;
  private leases = 0;

  add(task: Task) {
    this.tasks.push({ ...task, state: "queued" });
  }

  outcomes(taskId: string) {
    return this.reports.filter((report) => report.taskId === taskId).map((report) => report.outcome);
  }

  async start() {
    this.server = createServer((request, response) => {
      void this.handle(request).then(
        ({ status, body, headers }) => {
          response.writeHead(status, { "cache-control": "no-store", ...headers });
          response.end(body);
        },
        (error: unknown) => {
          response.writeHead(500);
          response.end(String(error));
        },
      );
    });
    await new Promise<void>((resolve) => this.server!.listen(PORT, "127.0.0.1", resolve));
  }

  stop() {
    return new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async handle(request: IncomingMessage): Promise<{ status: number; body?: string | Buffer; headers?: Record<string, string> }> {
    const url = new URL(request.url ?? "/", ORIGIN);
    const json = (status: number, value: unknown) => ({ status, body: JSON.stringify(value), headers: { "content-type": "application/json" } });
    if (url.pathname === "/auto-apply/extension") return { status: 200, body: connectPage, headers: { "content-type": "text/html; charset=utf-8" } };
    if (!url.pathname.startsWith("/api/ext/")) return { status: 404 };
    if (request.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: "Connect the extension again." });

    if (url.pathname === "/api/ext/status") return json(200, { name: "Asha Rao", enabled: true, dryRun: false, ready: this.tasks.filter((task) => task.state === "queued").length });
    if (url.pathname === "/api/ext/lease" && request.method === "POST") {
      const task = this.tasks.find((candidate) => candidate.state === "queued");
      if (!task) return { status: 204 };
      task.state = "leased";
      task.leaseId = `lease-${++this.leases}`;
      const leased: LeasedTask = { taskId: task.taskId, leaseId: task.leaseId, leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString(), applyUrl: task.applyUrl, system: task.system, title: task.title, company: task.company, dryRun: task.dryRun, answers: task.answers, documents: task.documents };
      return json(200, leased);
    }

    const match = url.pathname.match(/^\/api\/ext\/tasks\/([^/]+)\/(answers|document|report)$/);
    const task = match ? this.tasks.find((candidate) => candidate.taskId === decodeURIComponent(match[1])) : undefined;
    if (!match || !task) return json(404, { error: "Not found" });
    const body = request.method === "POST" ? await read(request) : undefined;
    const leaseId = body?.leaseId ?? url.searchParams.get("lease");
    if (leaseId !== task.leaseId) return json(409, { error: "This application isn't held by this browser any more." });

    switch (match[2]) {
      case "answers":
        if (task.state !== "leased") return json(409, { error: "This application isn't held by this browser any more." });
        this.asked.push({ taskId: task.taskId, fields: body.fields });
        return json(200, answerForm(body.fields, student(task.company)));
      case "document": {
        if (task.state !== "leased") return json(409, { error: "This application isn't held by this browser any more." });
        const kind = url.searchParams.get("kind");
        this.documents.push(`${task.taskId}:${kind}`);
        if (kind !== "resume") return json(404, { error: "This application has no cover letter." });
        return { status: 200, body: Buffer.from("%PDF-1.4\n% Asha Rao's tailored resume\n%%EOF\n"), headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename*=UTF-8''Asha%20Rao%20-%20Resume.pdf" } };
      }
      case "report": {
        const { outcome, reason, evidence } = body as { outcome: string; reason?: string; evidence?: Report["evidence"] };
        // As the server does (src/lib/apply/lease.ts): Submit once; "applied" only after it.
        const allowed = outcome === "submitting" ? task.state === "leased" : outcome === "applied" || outcome === "uncertain" ? task.state === "submitting" : task.state === "leased" || (outcome === "needs-student" && task.state === "submitting");
        if (!allowed) return json(409, { error: "This report doesn't fit the application." });
        task.state = outcome === "submitting" ? "submitting" : outcome === "release" ? "queued" : "done";
        this.reports.push({ taskId: task.taskId, outcome, ...(reason ? { reason } : {}), ...(evidence ? { evidence } : {}) });
        return json(200, { ok: true });
      }
    }
    return json(404, { error: "Not found" });
  }
}
