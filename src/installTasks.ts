import { TriggerContext } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";

export function handleInstallTasks (_: AppInstall | AppUpgrade, context: TriggerContext) {
    console.log(`Installed or updated to version ${context.appVersion}`);
}
