#!/usr/bin/env node
/**
 * Injects the Gemini API key into src/config/runtimeConfig.json.
 * The key is read from process.env.GEMINI_API_KEY, .env.local, or .env (in that order).
 */

const fs = require("fs");
const path = require("path");

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(WORKSPACE_ROOT, "src", "config", "runtimeConfig.json");
const ENV_LOCATIONS = [
  path.join(WORKSPACE_ROOT, ".env.local"),
  path.join(WORKSPACE_ROOT, ".env")
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return content.split(/\n+/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return acc;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      return acc;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    acc[key] = value;
    return acc;
  }, {});
}

function resolveApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  for (const envFile of ENV_LOCATIONS) {
    const env = parseEnvFile(envFile);
    if (env.GEMINI_API_KEY) {
      return env.GEMINI_API_KEY;
    }
  }
  return "";
}

function writeRuntimeConfig(apiKey) {
  const payload = {
    defaultApiKey: apiKey
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

function main() {
  const apiKey = resolveApiKey();
  writeRuntimeConfig(apiKey);
  if (apiKey) {
    console.log("Runtime config updated with provided Gemini API key.");
  } else {
    console.log("Runtime config cleared. No Gemini API key found.");
  }
}

main();
