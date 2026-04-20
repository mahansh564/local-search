import os from "os";
import path from "path";

/** Home-relative directory for config, database, and collections. */
export const DONUT_CONFIG_DIRNAME = ".donut";

/** CLI binary / command name shown in user-facing messages. */
export const CLI_NAME = "donut";

export function donutConfigDir(): string {
  return path.join(os.homedir(), DONUT_CONFIG_DIRNAME);
}

export function donutDatabasePath(): string {
  return path.join(donutConfigDir(), "index.sqlite");
}
