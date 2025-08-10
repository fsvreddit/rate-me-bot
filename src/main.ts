import { Devvit } from "@devvit/public-api";
import { removeStickyCommentOnApprove } from "./automodStickyRemover.js";

Devvit.addTrigger({
    event: "ModAction",
    onEvent: removeStickyCommentOnApprove,
});

Devvit.configure({
    redditAPI: true,
});

export default Devvit;
