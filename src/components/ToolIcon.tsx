import {
  Sparkles,
  CaseUpper,
  CaseLower,
  Search,
  FolderGit2,
  Globe,
  MessageCircle,
  Quote,
  Code2,
  Heading1,
  Lock,
  Unlock,
  Braces,
  Link as LinkIcon,
  Unlink,
  Hash,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

// Manifest icon string → Lucide component.
// Manifests now write `"icon": "Sparkles"` etc. Emoji values are honored too
// (rendered as a span) for backwards compat or community manifests that haven't migrated.
const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  CaseUpper,
  CaseLower,
  Search,
  FolderGit2,
  Globe,
  MessageCircle,
  Quote,
  Code2,
  Heading1,
  Lock,
  Unlock,
  Braces,
  Link: LinkIcon,
  Unlink,
  Hash,
  Wrench,
};

interface ToolIconProps {
  name?: string | null;
  size?: number;
  className?: string;
}

function isLucideName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICON_MAP, name);
}

export function ToolIcon({ name, size = 22, className }: ToolIconProps): JSX.Element {
  if (!name) {
    return <Wrench size={size} strokeWidth={1.6} className={className} aria-hidden />;
  }
  if (isLucideName(name)) {
    const Cmp = ICON_MAP[name]!;
    return <Cmp size={size} strokeWidth={1.6} className={className} aria-hidden />;
  }
  // Fallback: render as emoji / text
  return (
    <span
      className={`tool-icon-emoji ${className ?? ''}`}
      style={{ fontSize: `${Math.round(size * 1.05)}px` }}
      aria-hidden
    >
      {name}
    </span>
  );
}
