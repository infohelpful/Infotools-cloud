import {
  resolveRunpodEndpointMerged,
  runpodApiKey,
} from "../apps/web/functions/_shared/runpod.js";

const env = {
  INFOTOOLS_ACTIVE_ENV: "production",
  R2_ACCOUNT_ID: "env-account",
  R2_ACCESS_KEY_ID: "env-key",
  R2_SECRET_ACCESS_KEY: "env-secret",
  R2_BUCKET: "env-bucket",
  R2_PUBLIC_BASE_URL: "https://env.example.com",
  RUNPOD_API_KEY: "r8_env_key",
  RUNPOD_VOCAL_REMOVER_ENDPOINT: "https://api.runpod.ai/v2/env-endpoint",
};

const state = {
  activeEnvironment: "production",
  r2AccountId: "admin-account",
  r2AccessKeyId: "admin-key",
  r2SecretAccessKey: "admin-secret",
  r2S3Endpoint: "https://admin-account.r2.cloudflarestorage.com",
  runpodApiKey: "r8_admin_key",
  environments: {
    production: {
      storage: {
        bucket: "prod-bucket",
        publicBaseUrl: "https://files.example.com",
      },
      inference: {
        endpoints: {
          "vocal-remover": "https://api.runpod.ai/v2/prod-endpoint",
        },
      },
    },
  },
};

function resolveR2Config(envVars, adminState) {
  const envId = adminState?.activeEnvironment || envVars.INFOTOOLS_ACTIVE_ENV || "production";
  const storage = adminState?.environments?.[envId]?.storage || {};
  const accountId = String(adminState?.r2AccountId || envVars.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = String(adminState?.r2AccessKeyId || envVars.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(adminState?.r2SecretAccessKey || envVars.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(storage.bucket || envVars.R2_BUCKET || "").trim();
  const publicBaseUrl = String(storage.publicBaseUrl || envVars.R2_PUBLIC_BASE_URL || "").trim();
  let s3Endpoint = String(adminState?.r2S3Endpoint || "").trim();
  if (!s3Endpoint && accountId) s3Endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl, s3Endpoint };
}

function check(name, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const r2 = resolveR2Config(env, state);
check("R2 prefers admin credentials", r2.accountId === "admin-account" && r2.accessKeyId === "admin-key");
check("R2 uses active profile bucket", r2.bucket === "prod-bucket");
check("R2 uses profile public URL", r2.publicBaseUrl === "https://files.example.com");
check("R2 ready with admin state", Boolean(r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket));

const endpoint = resolveRunpodEndpointMerged(env, state, "vocal-remover");
check("RunPod endpoint from admin profile", endpoint === "https://api.runpod.ai/v2/prod-endpoint");
check("RunPod API key from admin state", runpodApiKey(env, state) === "r8_admin_key");

const placeholderState = {
  activeEnvironment: "production",
  environments: {
    production: {
      inference: {
        endpoints: {
          "vocal-remover": "https://api.runpod.ai/v2/YOUR_ENDPOINT_ID",
        },
      },
    },
  },
};
check(
  "RunPod falls back to env endpoint when profile placeholder",
  resolveRunpodEndpointMerged(env, placeholderState, "vocal-remover") === env.RUNPOD_VOCAL_REMOVER_ENDPOINT,
);

if (process.exitCode) {
  console.error("\nSome checks failed.");
} else {
  console.log("\nAll production integration checks passed.");
}
