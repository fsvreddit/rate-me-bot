import { Devvit } from "@devvit/public-api";
import { removeStickyCommentOnApprove } from "./stickyCommentRemover.js";
import { handleSelfApprovalFlowModAction, handleSelfApprovalFlowPostDelete, handleSelfApprovalFormSubmit, handleSelfApprovalMenuItem, selfApprovalFlowFormDefinition, selfApprovalFlowSettings } from "./selfApprovalFlow.js";
import { settingsForOpenAI } from "./openAIChecks.js";
import { handlePostCreate, processPostCreationQueue, settingsForPostCreation } from "./postCreation.js";
import { handleInstallTasks } from "./installTasks.js";
import { settingsForSightengineChecks } from "./sightengineChecks.js";
import { SchedulerJob } from "./constants.js";

Devvit.addSettings([
    settingsForPostCreation,
    selfApprovalFlowSettings,
    ...settingsForOpenAI,
    ...settingsForSightengineChecks,
]);

export const selfApprovalFlowForm = Devvit.createForm(selfApprovalFlowFormDefinition, handleSelfApprovalFormSubmit);

Devvit.addMenuItem({
    label: "User Self Approval",
    description: "Request self-approval for your own post. Only the OP can use this",
    location: "post",
    onPress: handleSelfApprovalMenuItem,
});

Devvit.addTrigger({
    events: ["AppInstall", "AppUpgrade"],
    onEvent: handleInstallTasks,
});

Devvit.addTrigger({
    event: "PostCreate",
    onEvent: handlePostCreate,
});

Devvit.addTrigger({
    event: "PostDelete",
    onEvent: handleSelfApprovalFlowPostDelete,
});

Devvit.addTrigger({
    event: "ModAction",
    onEvent: removeStickyCommentOnApprove,
});

Devvit.addTrigger({
    event: "ModAction",
    onEvent: handleSelfApprovalFlowModAction,
});

Devvit.addSchedulerJob({
    name: SchedulerJob.ProcessPostCreationQueue,
    onRun: processPostCreationQueue,
});

Devvit.configure({
    redditAPI: true,
    http: {
        domains: [
            "api.openai.com",
            "api.sightengine.com",
        ],
    },
});

export default Devvit;
