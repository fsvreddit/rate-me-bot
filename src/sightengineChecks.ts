import { Context, MenuItemOnPressEvent, SettingsFormField, SettingsValues, TriggerContext } from "@devvit/public-api";
import { PostCreateCheckAction, PostCreateCheckResult } from "./postCreation.js";
import { PostCreate } from "@devvit/protos";

enum SightengineChecksSetting {
    Enabled = "sightengineChecksEnabled",
    Threshold = "sightengineChecksThreshold",
    RemovalReason = "sightengineRemovalReason",

    // Secrets
    APIUser = "sightengineAPIUser",
    APIKey = "sightengineAPIKey",
};

export const settingsForSightengineChecks: SettingsFormField[] = [
    {
        type: "group",
        label: "Sightengine Checks",
        fields: [
            {
                type: "boolean",
                name: SightengineChecksSetting.Enabled,
                label: "Enable Sightengine checks",
                defaultValue: false,
            },
            {
                type: "number",
                name: SightengineChecksSetting.Threshold,
                label: "Threshold for flagging content (0-100)",
                defaultValue: 70,
                onValidate: ({ value }) => {
                    if (value === undefined) {
                        return "This field is required.";
                    }
                    if (value < 0 || value > 100) {
                        return "Value must be between 0 and 100.";
                    }
                    return;
                },
            },
            {
                type: "paragraph",
                name: SightengineChecksSetting.RemovalReason,
                label: "Reason to use when removing content flagged by Sightengine checks",
                defaultValue: "Content removed due to AI-generated content detected by Sightengine.",
            },
        ],
    },
    {
        type: "string",
        name: SightengineChecksSetting.APIUser,
        label: "Sightengine API User",
        scope: "app",
        isSecret: true,
    },
    {
        type: "string",
        name: SightengineChecksSetting.APIKey,
        label: "Sightengine API Key",
        scope: "app",
        isSecret: true,
    },
];

interface SightengineResponse {
    status: string;
    message?: string;
    request?: {
        id: string;
        timestamp: number;
        operations: number;
    };
    type?: {
        ai_generated?: number;
        ai_generators?: {
            other?: number;
            firefly?: number;
            gan?: number;
            recraft?: number;
            dalle?: number;
            gpt40?: number;
            reve?: number;
            midjourney?: number;
            stable_diffusion?: number;
            flux?: number;
            imagen?: number;
            ideogram?: number;
        };
        deepfake?: number;
        illustration?: number;
        photo?: number;
    };
}

async function getAIImageLikelihood (imageUrl: string, settings: SettingsValues): Promise<number> {
    const apiUser = settings[SightengineChecksSetting.APIUser] as string | undefined;
    if (!apiUser) {
        console.error("Sightengine Checks: API user not set, skipping checks.");
        throw new Error("Sightengine API user not set");
    }

    const apiKey = settings[SightengineChecksSetting.APIKey] as string | undefined;
    if (!apiKey) {
        console.error("Sightengine Checks: API key not set, skipping checks.");
        throw new Error("Sightengine API key not set");
    }

    const params = new URLSearchParams();
    params.append("url", imageUrl);
    params.append("models", "genai");
    params.append("api_user", apiUser);
    params.append("api_secret", apiKey);

    const response = await fetch(`https://api.sightengine.com/1.0/check.json?${params}`, {
        method: "GET",
    });

    if (!response.ok) {
        console.error(`Sightengine Checks: API request failed with status ${response.status} ${response.statusText}`);
        throw new Error(`Sightengine API request failed with status ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as SightengineResponse;
    if (result.status !== "success") {
        console.error(`Sightengine Checks: API response status not successful: ${result.status}, message: ${result.message}`);
        throw new Error(`Sightengine API response status not successful: ${result.status}, message: ${result.message}`);
    }

    if (result.type?.ai_generated === undefined) {
        console.error("Sightengine Checks: AI-generated score not found in response, skipping checks.");
        throw new Error("Sightengine API response does not contain AI-generated score");
    }

    return result.type.ai_generated * 100;
}

export async function checkPostForAI (event: PostCreate, imageUrl: string, settings: SettingsValues, context: TriggerContext): Promise<PostCreateCheckResult> {
    if (!event.post?.id) {
        console.warn("Sightengine Checks: No post ID found in event, skipping checks.");
        return { action: PostCreateCheckAction.Continue };
    }

    if (!settings[SightengineChecksSetting.Enabled]) {
        return { action: PostCreateCheckAction.Continue };
    }

    let aiGeneratedScore: number;
    try {
        aiGeneratedScore = await getAIImageLikelihood(imageUrl, settings);
    } catch {
        return { action: PostCreateCheckAction.Continue };
    }

    console.log(`Sightengine Checks: AI-generated score for post ${event.post.id}: ${aiGeneratedScore}%`);

    const threshold = settings[SightengineChecksSetting.Threshold] as number;

    if (aiGeneratedScore < threshold) {
        return { action: PostCreateCheckAction.Continue };
    }

    console.log(`Sightengine Checks: AI-generated score exceeds threshold for post ${event.post.id}, taking action.`);

    let removalReason = settings[SightengineChecksSetting.RemovalReason] as string | undefined ?? "Removed due to AI-generated content detected by Sightengine.";
    const subredditName = context.subredditName ?? await context.reddit.getCurrentSubredditName();
    removalReason += `\n\n*I am a bot, and this action was performed automatically. Please [contact the moderators of this subreddit](/message/compose/?to=/r/${subredditName}) if you have any questions or concerns.*`;

    const post = await context.reddit.getPostById(event.post.id);
    const newComment = await context.reddit.submitComment({
        id: post.id,
        text: removalReason,
    });

    await newComment.distinguish(true);

    await post.remove();
    console.log(`Sightengine Checks: Removed post ${post.id} due to AI-generated content detected by Sightengine with a score of ${aiGeneratedScore}%.`);

    return { action: PostCreateCheckAction.Stop };
}

export async function checkPostManually (_: MenuItemOnPressEvent, context: Context) {
    if (!context.postId) {
        console.warn("Sightengine Checks: No post ID found in context for manual check.");
        context.ui.showToast("Error: No post ID found for manual check.");
        return;
    }

    const post = await context.reddit.getPostById(context.postId);

    const settings = await context.settings.getAll();
    const aiGeneratedValue = await getAIImageLikelihood(post.url, settings);

    context.ui.showToast(`Sightengine AI-generated score: ${aiGeneratedValue}%`);
}
