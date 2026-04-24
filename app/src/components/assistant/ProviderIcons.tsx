// ============================================================
// ProviderIcons.tsx
// ============================================================
// Brand icons for all assistant integration providers.
// SVG files live in src/assets/icons/assistant/
// Imported as URLs by Vite, rendered as <img> tags.
//
// No external packages needed. To update an icon, just
// replace the .svg file in the assistant folder.

import gmailIcon from '../../assets/icons/assistant/gmail.svg';
import outlookIcon from '../../assets/icons/assistant/outlook.svg';
import googleCalendarIcon from '../../assets/icons/assistant/google_calendar.svg';
import outlookCalendarIcon from '../../assets/icons/assistant/outlook_calendar.svg';
import slackIcon from '../../assets/icons/assistant/slack.svg';
import discordIcon from '../../assets/icons/assistant/discord.svg';
import githubIcon from '../../assets/icons/assistant/github.svg';
import notionIcon from '../../assets/icons/assistant/notion.svg';
import todoistIcon from '../../assets/icons/assistant/todoist.svg';
import websiteWatcherIcon from '../../assets/icons/assistant/website_watcher.svg';

// ─── Icon map ─────────────────────────────────────────────────

const PROVIDER_ICON_MAP: Record<string, string> = {
  gmail: gmailIcon,
  outlook: outlookIcon,
  google_calendar: googleCalendarIcon,
  outlook_calendar: outlookCalendarIcon,
  slack: slackIcon,
  discord: discordIcon,
  github: githubIcon,
  notion: notionIcon,
  todoist: todoistIcon,
  website_watcher: websiteWatcherIcon,
};

// ─── Main component ──────────────────────────────────────────

export default function ProviderIcon({
  providerId,
  size = 22,
}: {
  providerId: string;
  size?: number;
}) {
  const iconSrc = PROVIDER_ICON_MAP[providerId];

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt={providerId}
        width={size}
        height={size}
        style={{ flexShrink: 0 }}
      />
    );
  }

  // Fallback: gray question mark
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        background: 'rgba(100,100,100,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.5,
        fontWeight: 600,
        color: '#888',
      }}
    >
      ?
    </div>
  );
}