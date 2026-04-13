import { Devvit } from "@devvit/public-api";
import { removeStickyCommentOnApprove } from "./stickyCommentRemover.js";
import { handleSelfApprovalFlowModAction, handleSelfApprovalFlowPostDelete, handleSelfApprovalFormSubmit, handleSelfApprovalMenuItem, selfApprovalFlowFormDefinition, selfApprovalFlowSettings } from "./selfApprovalFlow.js";
import { checkPostManually, settingsForOpenAI } from "./openAIChecks.js";
import { handlePostCreate } from "./postCreation.js";
import { handleInstallTasks } from "./installTasks.js";

Devvit.addSettings([
    selfApprovalFlowSettings,
    ...settingsForOpenAI,
]);

export const selfApprovalFlowForm = Devvit.createForm(selfApprovalFlowFormDefinition, handleSelfApprovalFormSubmit);

Devvit.addMenuItem({
    label: "User Self Approval",
    description: "Request self-approval for your own post. Only the OP can use this",
    location: "post",
    onPress: handleSelfApprovalMenuItem,
});

Devvit.addMenuItem({
    label: "Check for signs with OpenAI",
    location: "post",
    forUserType: "moderator",
    onPress: checkPostManually,
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

Devvit.configure({
    redditAPI: true,
});

export default Devvit;
