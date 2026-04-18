Handles post approval flows and other moderation tasks for /r/Rateme

## Self Approval

When a user posts on /r/Rateme, their post is automatically removed and the user is prompted to attest to the fact that their post adheres to the rules of the subreddit.

This is only available to users who have no social links, no NSFW history and no participation history in certain subreddits, in which case the post goes to the modqueue for manual review (AutoModerator needs to be configured to always queue posts, and then the app will remove them).

The app has an A/B testing feature where only certain posts (based on the post ID) will be filtered to the queue during the testing phase.

## AI checks for presence of signs

r/Rateme requires that all image posts include at least one image of the person holding a handwritten sign. If configured to do so, this app checks OpenAI to ask whether any of the images is likely to contain a sign.

## Checks for AI generated images

Some users try and pass off AI generated images of themselves holding a handwritten sign as genuine. If configured to do so, this app uses the Sightengine API to check for the likelihood that an image is AI generated/edited.

# Fetch Domains

* api.openai.com - used for the AI checks above. Image URLs are passed to the Responses API along with a simple prompt asking for the probability that any image contains a human holding a handwritten sign.
* api.sightengine.com - used to check if an image URL passed in is likely to be AI generated.
