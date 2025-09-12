import { TriggerContext } from "@devvit/public-api";

export async function userIsMod (username: string, context: TriggerContext): Promise<boolean> {
    const modList = await context.reddit.getModerators({
        subredditName: context.subredditName ?? await context.reddit.getCurrentSubredditName(),
        username,
    }).all();
    return modList.length > 0;
}
