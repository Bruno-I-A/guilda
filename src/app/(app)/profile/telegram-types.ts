export type TelegramActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  link?: string;
  expiresAt?: string;
};

export type TelegramConnectionView = {
  id: string;
  username: string | null;
  displayName: string | null;
  connectedAt: string;
};

export type TelegramPreferencesView = {
  taskNotifications: boolean;
  approvalNotifications: boolean;
  deadlineReminders: boolean;
  xpNotifications: boolean;
  closingNotifications: boolean;
  campaignNotifications: boolean;
  dailySummary: boolean;
  dailySummaryTime: string;
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};
