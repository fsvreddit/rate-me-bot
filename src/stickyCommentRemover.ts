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

    const stickyComment = comments.find(comment => comment.stickied && (comment.authorName === "AutoModerator" || comment.authorName === context.appName));
    if (!stickyComment) {
        return;
    }

    const handledKey = `stickyCommentHandled:${postId}`;
    if (await context.redis.exists(handledKey)) {
        return;
    }

    await stickyComment.remove();
    await context.redis.set(handledKey, "true", { expiration: addDays(new Date(), 28) });

    console.log(`${event.action}: Removed sticky comment from post ${postId}`);
}
