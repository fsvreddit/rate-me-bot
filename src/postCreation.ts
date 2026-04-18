import { JSONObject, TriggerContext } from "@devvit/public-api";
import { PostCreate } from "@devvit/protos";
import { checkPostForSignDuringPostCreate } from "./openAIChecks.js";
import { handleSelfApprovalFlowPostCreate } from "./selfApprovalFlow.js";
import { checkPostForAI } from "./sightengineChecks.js";

export enum PostCreateCheckAction {
    Stop = "stop",
    Continue = "continue",
}

export interface PostCreateCheckResult {
    action: PostCreateCheckAction;
    data?: JSONObject;
}

export async function handlePostCreate (event: PostCreate, context: TriggerContext) {
    const settings = await context.settings.getAll();

    const openAICheckResult = await checkPostForSignDuringPostCreate(event, settings, context);
    if (openAICheckResult.action === PostCreateCheckAction.Stop) {
        return;
    }

    if (openAICheckResult.data?.imageUrl) {
        const sightEngineCheckResult = await checkPostForAI(event, openAICheckResult.data.imageUrl as string, settings, context);
        if (sightEngineCheckResult.action === PostCreateCheckAction.Stop) {
            return;
        }
    } else {
        console.log("Post Creation: No image URL available from OpenAI checks, skipping Sightengine checks.");
    }

    const selfApprovalFlowResult = await handleSelfApprovalFlowPostCreate(event, settings, context);
    if (selfApprovalFlowResult.action === PostCreateCheckAction.Stop) {
        return;
    }
}
