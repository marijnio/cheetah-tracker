import packageJson from "../../package.json";

export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || "0.1.0";
export const APP_NAME = "Cheetah Trade Tracker";

