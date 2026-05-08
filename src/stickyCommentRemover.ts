import { TriggerContext } from "@devvit/public-api";
import { ModAction } from "@devvit/protos";
import { addDays } from "date-fns";

export async function removeStickyCommentOnApprove (event: ModAction, context: TriggerContext) {
    if (event.action !== "approvelink") {
        return;
    }

    const postId = event.targetPost?.id;
    if (!postId) {
        return;
    }

    const post = await context.reddit.getPostById(postId);
    const comments = await post.comments.all();

    const appComments = comments.filter(comment => comment.authorName === "AutoModerator" || comment.authorName === context.appSlug);
    if (appComments.length === 0) {
        return;
    }

    const handledKey = `stickyCommentHandled:${postId}`;
    if (await context.redis.exists(handledKey)) {
        return;
    }

    for (const appComment of appComments) {
        if (appComment.authorName === context.appSlug) {
            await appComment.delete();
            console.log(`${event.action}: Deleted sticky comment from post ${postId}`);
        } else {
            await appComment.remove();
        }
    }

    await context.redis.set(handledKey, "true", { expiration: addDays(new Date(), 28) });
}
