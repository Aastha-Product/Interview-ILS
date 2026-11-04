/** Queue names and settings from the brief (§8). Shared by the web app (enqueue) and the worker. */
export const QUEUE = {
  extract: "ai.extract",
  tailor: "ai.tailor",
  pdf: "pdf.render",
  ingest: "jobs.ingest",
  cleanup: "cleanup.retention",
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface QueueSettings {
  /** Jobs this worker runs at once. */
  concurrency: number;
  /** Jobs one student may have running at once (pg-boss group concurrency). */
  perUser?: number;
  retryLimit: number;
  expireInSeconds: number;
  /** Higher runs first. */
  priority: number;
}

export const QUEUE_SETTINGS: Record<QueueName, QueueSettings> = {
  "ai.extract": { concurrency: 4, perUser: 2, retryLimit: 3, expireInSeconds: 60, priority: 10 },
  "ai.tailor": { concurrency: 4, perUser: 2, retryLimit: 3, expireInSeconds: 120, priority: 10 },
  "pdf.render": { concurrency: 2, retryLimit: 2, expireInSeconds: 30, priority: 10 },
  "jobs.ingest": { concurrency: 1, retryLimit: 3, expireInSeconds: 120, priority: 0 },
  "cleanup.retention": { concurrency: 1, retryLimit: 1, expireInSeconds: 600, priority: 0 },
};

export const deadLetterQueue = (name: QueueName) => `${name}.dead`;

export interface TailorJobData {
  userId: string;
  applicationId: string;
  taskId: string;
}

export interface PdfJobData {
  userId: string;
  applicationId: string;
  documentId: string;
  taskId: string;
}
