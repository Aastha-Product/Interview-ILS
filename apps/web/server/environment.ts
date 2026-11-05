import type { ServerConfig } from "@pathfinder/core";

/**
 * What every page should say about the deployment it is on. Staging and local development are
 * for test data only: they show a banner and ask search engines not to index them.
 */
export function environmentNotice(appEnv: ServerConfig["APP_ENV"]): { banner: string | null; indexable: boolean } {
  switch (appEnv) {
    case "production":
      return { banner: null, indexable: true };
    case "staging":
      return { banner: "Staging site: test data only. Don't enter real personal information.", indexable: false };
    default:
      return { banner: null, indexable: false };
  }
}
