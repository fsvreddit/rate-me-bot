import { Devvit } from "@devvit/public-api";
import { removeStickyCommentOnApprove } from "./stickyCommentRemover.js";
import { handleSelfApprovalFlowPostCreate, handleSelfApprovalFormSubmit, handleSelfApprovalMenuItem, selfApprovalFlowFormDefinition, selfApprovalFlowSettings } from "./selfApprovalFlow.js";

Devvit.addSettings([
    selfApprovalFlowSettings,
]);

export const selfApprovalFlowForm = Devvit.createForm(selfApprovalFlowFormDefinition, handleSelfApprovalFormSubmit);

Devvit.addMenuItem({
    label: "User Self Approval",
    description: "Request self-approval for your own post. Only the OP can use this",
    location: "post",
    onPress: handleSelfApprovalMenuItem,
});

Devvit.addTrigger({
    event: "PostCreate",
    onEvent: handleSelfApprovalFlowPostCreate,
});

Devvit.addTrigger({
    event: "ModAction",
    onEvent: removeStickyCommentOnApprove,
});

Devvit.configure({
    redditAPI: true,
});

export default Devvit;
