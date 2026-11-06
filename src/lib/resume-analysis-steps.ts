// Pathfinder: the stages of a resume analysis, as the progress shows them. The first happens in
// the upload request (the file is sent and its text read); the job reports the others as it
// reaches them, so the progress is the real work, never a timer.
export const ANALYSIS_STEPS = [
  "Uploading and reading your resume",
  "Finding your skills and experience",
  "Reviewing your resume",
  "Preparing your results",
] as const;
