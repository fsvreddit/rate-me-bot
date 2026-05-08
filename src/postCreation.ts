import { JSONObject, SettingsFormField, TriggerContext } from "@devvit/public-api";
import { PostCreate } from "@devvit/protos";
import { checkPostForSignDuringPostCreate } from "./openAIChecks.js";
import { handleSelfApprovalFlowPostCreate } from "./selfApprovalFlow.js";
import { checkPostForAI } from "./sightengineChecks.js";
import { addDays } from "date-fns";

enum PostCreationSetting {
    RemoveNSFWPosts = "postCreationRemoveNSFWPosts",
    NSFWPostsRemovalReason = "postCreationNSFWPostsRemovalReason",
}

export const settingsForPostCreation: SettingsFormField = {
    type: "group",
    label: "Post Creation",
    fields: [
        {
            type: "boolean",
            name: PostCreationSetting.RemoveNSFWPosts,
            label: "Automatically remove NSFW posts",
            defaultValue: false,
        },
        {
            type: "paragraph",
            name: PostCreationSetting.NSFWPostsRemovalReason,
            label: "Reason to use when removing NSFW posts",
            defaultValue: "Content removed because it was marked as NSFW.",
        },
    ],
};

export enum PostCreateCheckAction {
    Stop = "stop",
    Continue = "continue",
}

export interface PostCreateCheckResult {
    action: PostCreateCheckAction;
    data?: JSONObject;
}

export async function handlePostCreate (event: PostCreate, context: TriggerContext) {
    if (!event.post?.id) {
        console.log("Post Creation: No post ID available, skipping checks.");
        return;
    }

    const postHandledKey = `postCreationHandled:${event.post.id}`;
    if (await context.redis.exists(postHandledKey)) {
        console.log(`Post Creation: Post ${event.post.id} has already been handled, skipping.`);
        return;
    }
    await context.redis.set(postHandledKey, Date.now().toString(), { expiration: addDays(new Date(), 1) });

    const settings = await context.settings.getAll();

    if (event.post.nsfw) {
        let removalReason = settings[PostCreationSetting.NSFWPostsRemovalReason] as string;
        if (settings[PostCreationSetting.RemoveNSFWPosts] && removalReason) {
            const post = await context.reddit.getPostById(event.post.id);

            await post.remove();

            removalReason += `\n\n*I am a bot, and this action was performed automatically. Please [contact the moderators of this subreddit](/message/compose/?to=/r/${context.subredditName}) if you have any questions or concerns.*`;
            const newComment = await context.reddit.submitComment({
                id: event.post.id,
                text: removalReason,
            });

            await newComment.distinguish(true);

            console.log(`Post Creation: Removed NSFW post ${event.post.id} with reason: ${removalReason}`);

            return;
        }
    }

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
