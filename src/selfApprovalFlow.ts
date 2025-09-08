import { Context, FormField, FormFunction, FormOnSubmitEvent, JSONObject, MenuItemOnPressEvent, SettingsFormField, TriggerContext, User } from "@devvit/public-api";
import { PostCreate } from "@devvit/protos";
import { addDays } from "date-fns";
import { selfApprovalFlowForm } from "./main.js";

enum SelfApprovalFlowSetting {
    Enabled = "selfApprovalFlowEnabled",
    PostIdRegex = "selfApprovalFlowPostIdRegex",
    StickyPostText = "selfApprovalFlowStickyPostText",
    StickyPostTextManualApproval = "selfApprovalFlowStickyPostTextManualApproval",
    RuleList = "selfApprovalFlowRuleList",
    AllowMultipleSelfApprovalAttempts = "selfApprovalFlowAllowMultipleSelfApprovalAttempts",
};

export const selfApprovalFlowSettings: SettingsFormField = {
    type: "group",
    label: "Self-Approval Flow Settings",
    fields: [
        {
            name: SelfApprovalFlowSetting.Enabled,
            type: "boolean",
            label: "Enable Self-Approval Flow",
            defaultValue: false,
        },
        {
            name: SelfApprovalFlowSetting.PostIdRegex,
            type: "string",
            label: "Post ID Regex",
        },
        {
            name: SelfApprovalFlowSetting.StickyPostText,
            type: "paragraph",
            label: "Sticky Post Text",
            helpText: "This text will be added to the top of the sticky post created for self-approval requests.",
            lineHeight: 6,
        },
        {
            name: SelfApprovalFlowSetting.StickyPostTextManualApproval,
            type: "paragraph",
            label: "Sticky Post Text (Manual Approval)",
            helpText: "This text will be added to the top of the sticky post created for manual approval needs (social links, NSFW accounts).",
            lineHeight: 6,
        },
        {
            name: SelfApprovalFlowSetting.RuleList,
            type: "paragraph",
            label: "Approval Rules",
            helpText: "One rule per line. This is the text shown to users when they request approval. Optionally, use a | to provide extra text to display smaller below the main text.",
            lineHeight: 6,
        },
        {
            name: SelfApprovalFlowSetting.AllowMultipleSelfApprovalAttempts,
            type: "boolean",
            label: "Allow Multiple Self-Approval Attempts",
            helpText: "If enabled, users can request self-approval multiple times. If disabled, they can only request once.",
            defaultValue: false,
        },
    ],
};

function getStickyCommentRedisKey (postId: string): string {
    return `selfApprovalFlow:stickyComment:${postId}`;
}

async function userEligibleForSelfApproval (userId: string, context: TriggerContext): Promise<boolean> {
    let user: User | undefined;
    try {
        user = await context.reddit.getUserById(userId);
    } catch (error) {
        console.error("Error fetching user:", error);
        return false;
    }

    if (!user) {
        return false;
    }

    const socialLinks = await user.getSocialLinks();
    if (socialLinks.length > 0) {
        return false;
    }

    const postHistory = await context.reddit.getPostsByUser({
        username: user.username,
        limit: 100,
        sort: "new",
    }).all();

    if (postHistory.some(post => post.nsfw)) {
        return false;
    }

    return true;
}

export async function handleSelfApprovalFlowPostCreate (event: PostCreate, context: TriggerContext) {
    if (!event.post?.id || !event.post.authorId) {
        return;
    }

    const settings = await context.settings.getAll();
    if (!settings[SelfApprovalFlowSetting.Enabled]) {
        return;
    }

    const postIdRegex = settings[SelfApprovalFlowSetting.PostIdRegex] as string | undefined;
    if (postIdRegex) {
        const regex = new RegExp(postIdRegex);
        if (!regex.test(event.post.id)) {
            console.log(`Post ID ${event.post.id} does not match regex ${postIdRegex}.`);
            return;
        }
    }

    if (!await userEligibleForSelfApproval(event.post.authorId, context)) {
        console.log(`User ${event.post.authorId} not eligible for self-approval.`);
        const stickyPostTextManualApproval = settings[SelfApprovalFlowSetting.StickyPostTextManualApproval] as string | undefined;
        if (stickyPostTextManualApproval) {
            const newComment = await context.reddit.submitComment({
                id: event.post.id,
                text: stickyPostTextManualApproval,
            });
            await newComment.distinguish(true);
            console.log(`Created manual approval sticky comment ${newComment.id} on post ${event.post.id}`);
        }
        return;
    }

    await context.redis.set(getStickyCommentRedisKey(event.post.id), "true", { expiration: addDays(new Date(), 28) });
    await context.reddit.remove(event.post.id, false);

    const stickyPostText = settings[SelfApprovalFlowSetting.StickyPostText] as string | undefined;
    if (!stickyPostText) {
        console.warn("Sticky post text not set in settings.");
        return;
    }

    const newComment = await context.reddit.submitComment({
        id: event.post.id,
        text: stickyPostText,
    });

    await newComment.distinguish(true);
    console.log(`Created sticky comment ${newComment.id} on post ${event.post.id}`);
}

export const selfApprovalFlowFormDefinition: FormFunction = (data) => {
    const rules = data.rules as string[];
    const fields: FormField[] = [];
    let ruleId = 0;
    for (const rule of rules) {
        const [mainText, subText] = rule.split("|").map(part => part.trim());
        fields.push({
            type: "boolean",
            name: `rule${ruleId++}`,
            label: mainText,
            helpText: subText.length > 0 ? subText : undefined,
            defaultValue: false,
        });
    }

    return {
        title: "Post Self Approval",
        description: "You must agree to all of the post requirements in order to have your post approved automatically. If you do not agree to all of the requirements, please delete your post and resubmit a compliant post.",
        fields,
    };
};

export async function handleSelfApprovalMenuItem (_: MenuItemOnPressEvent, context: Context) {
    const currentUser = await context.reddit.getCurrentUser();
    if (!currentUser) {
        context.ui.showToast("Error: Unable to fetch your details.");
        return;
    }

    if (!context.postId) {
        context.ui.showToast("Error: No post selected.");
        return;
    }

    const post = await context.reddit.getPostById(context.postId);

    if (post.approved) {
        context.ui.showToast("This post is already approved.");
        return;
    }

    if (post.authorName !== currentUser.username) {
        context.ui.showToast("Error: You can only request approval for your own posts.");
        return;
    }

    if (!await context.redis.exists(getStickyCommentRedisKey(context.postId))) {
        context.ui.showToast("Error: This post is not eligible for self-approval.");
        return;
    }

    const rules: string[] = [];
    const rulesText = await context.settings.get<string>(SelfApprovalFlowSetting.RuleList);
    if (!rulesText) {
        rules.push("I agree to the rules set by the moderators.");
    } else {
        rules.push(...rulesText.split("\n").map(line => line.trim()).filter(line => line.length > 0));
    }

    context.ui.showForm(selfApprovalFlowForm, { rules });
}

export async function handleSelfApprovalFormSubmit (event: FormOnSubmitEvent<JSONObject>, context: Context) {
    if (!context.postId) {
        context.ui.showToast("Error: No post selected.");
        return;
    }

    const acceptances = Object.values(event.values) as boolean[];
    if (acceptances.some(accepted => !accepted)) {
        context.ui.showToast("You must agree to all conditions. Please delete your post and resubmit a compliant post.");
        const multipleAttemptsAllowed = await context.settings.get<boolean>(SelfApprovalFlowSetting.AllowMultipleSelfApprovalAttempts) ?? false;
        if (!multipleAttemptsAllowed) {
            await context.redis.del(getStickyCommentRedisKey(context.postId));
        }
        return;
    }

    await context.reddit.approve(context.postId);
    await context.redis.del(getStickyCommentRedisKey(context.postId));

    context.ui.showToast("Your post has been approved. Thank you for following the rules!");

    const post = await context.reddit.getPostById(context.postId);
    const comments = await post.comments.all();
    const botComments = comments.filter(comment => comment.authorName === context.appName);
    await Promise.all(botComments.map(comment => comment.remove()));
}
