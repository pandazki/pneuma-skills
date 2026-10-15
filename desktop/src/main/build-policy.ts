/** Preview is selected at build time so the packaged app needs no launch flags. */
export function desktopPolicy(previewFlag?: string) {
  const preview = previewFlag === "1";
  const appName = preview ? "Pneuma Skills Preview" : "Pneuma Skills";
  return {
    appName,
    isolatedUserDataName: preview ? appName : null,
    registerProtocol: !preview,
    updatesEnabled: !preview,
  };
}

export const desktopBuildPolicy = desktopPolicy(process.env.PNEUMA_DESKTOP_PREVIEW);
