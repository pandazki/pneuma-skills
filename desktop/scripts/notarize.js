const { notarize } = require("@electron/notarize");
require("dotenv").config({ path: __dirname + "/../.env" });

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.log("Skipping notarization — APPLE_ID or APPLE_ID_PASSWORD not set");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    tool: "notarytool",
    appBundleId: "com.pneuma.skills",
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID || "SQ6WL9HV57",
  });

  console.log("Notarization complete.");
};
