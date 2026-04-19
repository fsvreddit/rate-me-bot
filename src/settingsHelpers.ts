import { SettingsFormFieldValidatorEvent, TriggerContext } from "@devvit/public-api";

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-invalid-void-type
export function validatePercentageSetting (event: SettingsFormFieldValidatorEvent<number>, _: TriggerContext): string | void {
    if (!event.value) {
        return "This field is required.";
    }

    if (event.value < 0 || event.value > 100) {
        return "Please enter a value between 0 and 100.";
    }
}
