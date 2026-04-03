import { TriggerContext } from "@devvit/public-api";
import { PostCreate } from "@devvit/protos";
import { checkPostForSignDuringPostCreate } from "./openAIChecks.js";
import { handleSelfApprovalFlowPostCreate } from "./selfApprovalFlow.js";

export enum PostCreateCheckResult {
    Stop = "stop",
    Continue = "continue",
}

export async function handlePostCreate (event: PostCreate, context: TriggerContext) {
    const openAICheckResult = await checkPostForSignDuringPostCreate(event, context);
    if (openAICheckResult === PostCreateCheckResult.Stop) {
        return;
    }

    const selfApprovalFlowResult = await handleSelfApprovalFlowPostCreate(event, context);
    if (selfApprovalFlowResult === PostCreateCheckResult.Stop) {
        return;
    }
}
