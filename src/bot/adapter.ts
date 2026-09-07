import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationBotFrameworkAuthenticationOptions,
} from "botbuilder";
import { config } from "../config";

const authConfig: ConfigurationBotFrameworkAuthenticationOptions = {
  MicrosoftAppId: config.microsoftAppId,
  MicrosoftAppPassword: config.microsoftAppPassword,
  MicrosoftAppType: config.microsoftAppType,
  MicrosoftAppTenantId: config.microsoftAppTenantId,
};

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(authConfig as any);

export const adapter = new CloudAdapter(botFrameworkAuthentication);

adapter.onTurnError = async (context, error) => {
  console.error("[bot] unhandled error", error);
  await context.sendActivity("Bot gặp lỗi nội bộ khi xử lý yêu cầu. Xem log server để biết chi tiết.");
};
