"use strict";

const packageJson = require("../package.json");

function releaseInfo(env = process.env) {
  return {
    version: String(env.SURVEYKIT_RELEASE || packageJson.version || "unknown"),
    revision: String(env.SURVEYKIT_COMMIT || env.CF_PAGES_COMMIT_SHA || ""),
    deployed_at: String(env.SURVEYKIT_DEPLOYED_AT || ""),
  };
}

module.exports = { releaseInfo };
