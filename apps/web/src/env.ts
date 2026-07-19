import { z } from "zod";

const webEnvironmentSchema = z.object({
  VITE_API_URL: z.union([z.literal(""), z.string().url()]).default(""),
  VITE_APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  VITE_LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
});

const result = webEnvironmentSchema.safeParse(import.meta.env);
if (!result.success) {
  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid web environment: ${issues}`);
}

export const webEnvironment = {
  apiUrl: result.data.VITE_API_URL.replace(/\/$/, ""),
  environment: result.data.VITE_APP_ENV,
  logLevel: result.data.VITE_LOG_LEVEL,
};
