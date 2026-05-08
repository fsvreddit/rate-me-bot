import { JobContext, JSONObject, Post, ScheduledJobEvent, SettingsFormField, TriggerContext } from "@devvit/public-api";
import { PostCreate } from "@devvit/protos";
import { checkPostForSignDuringPostCreate } from "./openAIChecks.js";
import { handleSelfApprovalFlowPostCreate } from "./selfApprovalFlow.js";
import { checkPostForAI } from "./sightengineChecks.js";
import { addSeconds } from "date-fns";
import { SchedulerJob } from "./constants.js";

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

const POST_CREATION_QUEUE = "postCreationQueue";

export enum PostCreateCheckAction {
    Stop = "stop",
    Continue = "continue",
}

export interface PostCreateCheckResult {
    action: PostCreateCheckAction;
    data?: JSONObject;
}

export async function removePostFromPostCreationQueue (postId: string, context: TriggerContext) {
    await context.redis.zRem(POST_CREATION_QUEUE, [postId]);
}

export async function handlePostCreate (event: PostCreate, context: TriggerContext) {
    if (!event.post?.id) {
        console.log("Post Creation: No post ID available, skipping checks.");
        return;
    }

    const alreadyHandledKey = `postCreationAlreadyHandled:${event.post.id}`;
    if (await context.redis.exists(alreadyHandledKey)) {
        console.log(`Post Creation: Post ${event.post.id} already handled, skipping.`);
        return;
    }

    await context.redis.zAdd(POST_CREATION_QUEUE, { member: event.post.id, score: Date.now() });
    await context.redis.set(alreadyHandledKey, "true", { expiration: addSeconds(new Date(), 60) });

    console.log(`Post Creation: Added post ${event.post.id} to creation queue for processing.`);
}

export async function processPostCreationQueue (event: ScheduledJobEvent<JSONObject | undefined>, context: JobContext) {
    const recentlyRunKey = "postCreationQueueRecentlyRun";
    if (event.data?.fromCron) {
        if (await context.redis.exists(recentlyRunKey)) {
            return;
        }
    }

    await context.redis.set(recentlyRunKey, Date.now().toString(), { expiration: addSeconds(new Date(), 30) });

    const queue = await context.redis.zRange(POST_CREATION_QUEUE, 0, Date.now(), { by: "score" });

    if (queue.length === 0) {
        await context.redis.del(recentlyRunKey);
        return;
    }

    const firstPost = queue.shift()?.member;
    if (!firstPost) {
        await context.redis.del(recentlyRunKey);
        return;
    }

    const post = await context.reddit.getPostById(firstPost);
    await context.redis.zRem(POST_CREATION_QUEUE, [firstPost]);

    await handlePost(post, context);

    if (queue.length > 0) {
        await context.scheduler.runJob({
            name: SchedulerJob.ProcessPostCreationQueue,
            runAt: addSeconds(new Date(), 5),
            data: {
                fromCron: false,
            },
        });
    } else {
        await context.redis.del(recentlyRunKey);
    }
}

async function handlePost (post: Post, context: JobContext) {
    const settings = await context.settings.getAll();

    if (post.nsfw) {
        let removalReason = settings[PostCreationSetting.NSFWPostsRemovalReason] as string;
        if (settings[PostCreationSetting.RemoveNSFWPosts] && removalReason) {
            await post.remove();

            removalReason += `\n\n*I am a bot, and this action was performed automatically. Please [contact the moderators of this subreddit](/message/compose/?to=/r/${context.subredditName}) if you have any questions or concerns.*`;
            const newComment = await context.reddit.submitComment({
                id: post.id,
                text: removalReason,
            });

            await newComment.distinguish(true);

            console.log(`Post Creation: Removed NSFW post ${post.id} with reason: ${removalReason}`);

            return;
        }
    }

    const openAICheckResult = await checkPostForSignDuringPostCreate(post, settings, context);
    if (openAICheckResult.action === PostCreateCheckAction.Stop) {
        return;
    }

    if (openAICheckResult.data?.imageUrl) {
        const sightEngineCheckResult = await checkPostForAI(post, openAICheckResult.data.imageUrl as string, settings, context);
        if (sightEngineCheckResult.action === PostCreateCheckAction.Stop) {
            return;
        }
    } else {
        console.log("Post Creation: No image URL available from OpenAI checks, skipping Sightengine checks.");
    }

    const selfApprovalFlowResult = await handleSelfApprovalFlowPostCreate(post, settings, context);
    if (selfApprovalFlowResult.action === PostCreateCheckAction.Stop) {
        return;
    }
}
