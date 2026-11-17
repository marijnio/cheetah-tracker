import packageJson from "../../package.json";

const rawVersion =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || packageJson.version || "0.1.0";

export const APP_VERSION = rawVersion.replace(/^v/i, "");
export const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT?.trim() || "dev";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME?.trim() || null;

export const APP_BUILD_LABEL =
  GIT_COMMIT !== "dev"
    ? `v${APP_VERSION} (${GIT_COMMIT})`
    : `v${APP_VERSION}-dev`;

export const APP_NAME = "Cheetah Trade Tracker";
export const GITHUB_REPO_URL = "https://github.com/marijnio/cheetah-tracker";

