import { TriggerContext } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";
import { SchedulerJob } from "./constants.js";

export async function handleInstallTasks (_: AppInstall | AppUpgrade, context: TriggerContext) {
    const allJobs = await context.scheduler.listJobs();
    await Promise.all(allJobs.map(job => context.scheduler.cancelJob(job.id)));

    await context.scheduler.runJob({
        name: SchedulerJob.ProcessPostCreationQueue,
        cron: "* * * * *",
        data: {
            fromCron: true,
        },
    });

    console.log(`Installed or updated to version ${context.appVersion}`);
}
