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

    const stickyComment = comments.find(comment => comment.stickied && (comment.authorName === "AutoModerator" || comment.authorName === context.appSlug));
    if (!stickyComment) {
        return;
    }

    const handledKey = `stickyCommentHandled:${postId}`;
    if (await context.redis.exists(handledKey)) {
        return;
    }

    if (stickyComment.authorName === context.appSlug) {
        await stickyComment.delete();
        console.log(`${event.action}: Deleted sticky comment from post ${postId}`);
    } else {
        await stickyComment.remove();
    }

    await context.redis.set(handledKey, "true", { expiration: addDays(new Date(), 28) });
}
