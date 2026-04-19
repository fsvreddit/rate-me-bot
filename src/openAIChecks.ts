import { PostCreate } from "@devvit/protos";
import { JSONObject, Post, SettingsFormField, SettingsValues, TriggerContext } from "@devvit/public-api";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod.js";
import { ResponseInputMessageContentList } from "openai/resources/responses/responses.js";
import { z } from "zod";
import { PostCreateCheckAction, PostCreateCheckResult } from "./postCreation.js";
import { addHours } from "date-fns";
import { validatePercentageSetting } from "./settingsHelpers.js";

enum OpenAISetting {
    OpenAIChecksEnabled = "openAIChecksEnabled",
    OpenAIModel = "openAIModel",
    ProbabilityThresholdForRemoval = "openAIProbabilityThreshold",
    RemovalReason = "openAIRemovalReason",

    // Secrets
    APIKey = "openAIAPIKey",
}

enum OpenAIModelOption {
    GPT54Mini = "gpt-5.4-mini",
    GPT54Nano = "gpt-5.4-nano",
}

export const settingsForOpenAI: SettingsFormField[] = [
    {
        type: "group",
        label: "OpenAI Checks",
        fields: [
            {
                type: "boolean",
                name: OpenAISetting.OpenAIChecksEnabled,
                label: "Enable OpenAI checks",
                defaultValue: false,
            },
            {
                type: "select",
                name: OpenAISetting.OpenAIModel,
                label: "OpenAI model to use",
                options: [
                    { label: "GPT-5.4 Mini", value: OpenAIModelOption.GPT54Mini },
                    { label: "GPT-5.4 Nano", value: OpenAIModelOption.GPT54Nano },
                ],
                multiSelect: false,
                defaultValue: [OpenAIModelOption.GPT54Mini],
                onValidate: ({ value }) => {
                    if (!value || value.length === 0) {
                        return "Please select a model.";
                    }
                },
            },
            {
                type: "number",
                name: OpenAISetting.ProbabilityThresholdForRemoval,
                label: "Probability threshold for removal",
                defaultValue: 70,
                onValidate: validatePercentageSetting,
            },
            {
                type: "paragraph",
                name: OpenAISetting.RemovalReason,
                label: "Reason for removal",
                defaultValue: "Removed due to low probability of containing a sign, as determined by OpenAI's image analysis.",
            },
        ],
    },
    {
        type: "string",
        name: OpenAISetting.APIKey,
        label: "OpenAI API Key",
        scope: "app",
        isSecret: true,
    },
];

interface ProbabilityResponse {
    probability: number;
    imageUrl?: string;
}

interface IndexedImages {
    url: string;
    imageIndex: string;
}

function getImagesFromPost (post: Post): IndexedImages[] {
    const images: IndexedImages[] = [];
    let index = 0;
    for (const item of post.gallery) {
        images.push({
            url: item.url,
            imageIndex: index.toString(),
        });
        index++;
    }
    if (images.length === 0) {
        images.push({
            url: post.url,
            imageIndex: "0",
        });
    }
    return images;
}

export async function checkPostForSign (post: Post, context: TriggerContext): Promise<ProbabilityResponse> {
    const apiKey = await context.settings.get<string>(OpenAISetting.APIKey);
    if (!apiKey) {
        throw new Error("OpenAI API key not set");
    }

    const openAIClient = new OpenAI({
        apiKey,
    });

    const imagesFromPost = getImagesFromPost(post);

    const content: ResponseInputMessageContentList = [
        {
            type: "input_text",
            text: `You are given a list of images.

Task:
- Determine if any image contains a human holding a handwritten sign.
- Return the probability (0-1)
- Return the URL of the most likely image

Rules:
- Only use URLs from this list: [${imagesFromPost.map(image => `"${image.url}"`).join(", ")}]
- Do NOT return any other value for imageUrl
- If none match, omit imageUrl`,
        },
    ];

    for (const entry of imagesFromPost) {
        content.push({
            type: "input_image",
            // eslint-disable-next-line camelcase
            image_url: entry.url,
            detail: "auto",
        });
    }

    const responseFormat = z.object({
        probability: z.number().min(0).max(1),
        imageUrl: z.string().optional().nullable(),
    });

    const [model] = await context.settings.get<string[]>(OpenAISetting.OpenAIModel) as OpenAIModelOption[] | undefined ?? [OpenAIModelOption.GPT54Mini];

    const response = await openAIClient.responses.create({
        model,
        input: [
            {
                role: "user",
                content,
            },
        ],
        text: {
            format: zodTextFormat(responseFormat, "probability_of_sign"),
        },
    });

    console.log(`OpenAI Checks: Post ${post.id} processed with model ${response.model}, ${response.usage?.input_tokens ?? "unknown"} input tokens used.`);

    const output = JSON.parse(response.output_text) as ProbabilityResponse;
    return output;
}

export async function checkPostForSignDuringPostCreate (event: PostCreate, settings: SettingsValues, context: TriggerContext): Promise<PostCreateCheckResult> {
    if (!settings[OpenAISetting.OpenAIChecksEnabled]) {
        console.log("OpenAI Checks: Checks are disabled in settings, skipping.");
        return { action: PostCreateCheckAction.Continue };
    }

    const postId = event.post?.id;
    if (!postId) {
        console.warn("OpenAI Checks: Post ID not found in event, skipping.");
        return { action: PostCreateCheckAction.Continue };
    }

    const post = await context.reddit.getPostById(postId);

    const cachedResultKey = `openAICheckResult:${postId}`;
    const cachedProbabilityValue = await context.redis.get(cachedResultKey);

    let probabilityOfSign: number;
    let imageUrl: string | undefined;
    if (cachedProbabilityValue) {
        console.log(`OpenAI Checks: Using cached probability value for post ${postId}.`);
        probabilityOfSign = parseFloat(cachedProbabilityValue);
    } else {
        const result = await checkPostForSign(post, context);
        probabilityOfSign = result.probability;
        if (result.imageUrl) {
            imageUrl = result.imageUrl;
        }

        await context.redis.set(cachedResultKey, probabilityOfSign.toString(), { expiration: addHours(new Date(), 1) });
    }

    const threshold = settings[OpenAISetting.ProbabilityThresholdForRemoval] as number | undefined ?? 70;
    if (probabilityOfSign < threshold / 100) {
        let removalReason = settings[OpenAISetting.RemovalReason] as string | undefined ?? "Removed due to low probability of containing a sign, as determined by OpenAI's image analysis.";
        const subredditName = context.subredditName ?? await context.reddit.getCurrentSubredditName();
        removalReason += `\n\n*I am a bot, and this action was performed automatically. Please [contact the moderators of this subreddit](/message/compose/?to=/r/${subredditName}) if you have any questions or concerns.*`;

        const newComment = await context.reddit.submitComment({
            id: postId,
            text: removalReason,
        });

        await newComment.distinguish(true);

        await post.remove();
        console.log(`OpenAI Checks: Removed post ${postId} due to low probability of containing a sign (${probabilityOfSign * 100}%).`);
        return { action: PostCreateCheckAction.Stop };
    }

    console.log(`OpenAI Checks: Post ${postId} has a probability of ${probabilityOfSign * 100}% of containing a sign, which is above the threshold of ${threshold}%.`);
    console.log(`OpenAI Checks: Image URL most likely to contain a sign for post ${postId}: ${imageUrl}`);

    const data: JSONObject = {};
    if (imageUrl) {
        if (imageUrl.startsWith("http")) {
            console.log(`OpenAI Checks: Image URL for post ${postId} that is most likely to contain a sign: ${imageUrl}`);
            data.imageUrl = imageUrl;
        } else {
            console.warn(`OpenAI Checks: Received image URL that does not appear to be valid for post ${postId}: ${imageUrl}`);
        }
    }

    return { action: PostCreateCheckAction.Continue, data };
}
