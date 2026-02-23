import React from 'react';
import { isObsidian, getObsidianApp } from '../utils/environment';

interface DocumentLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Resolve a wiki-link style path to a vault file.
 * Tries exact path first, then uses Obsidian's metadataCache.getFirstLinkpathDest
 * to resolve short names like "My Note" to "folder/My Note.md".
 */
function resolveFile(app: ReturnType<typeof getObsidianApp>, linkpath: string) {
  if (!app) return null;
  // Try exact path first
  const direct = app.vault.getAbstractFileByPath(linkpath);
  if (direct) return direct;
  // Try with .md extension
  if (!linkpath.includes('.')) {
    const withMd = app.vault.getAbstractFileByPath(linkpath + '.md');
    if (withMd) return withMd;
  }
  // Use Obsidian's link resolver (handles short names, case-insensitive, etc.)
  const resolved = app.metadataCache?.getFirstLinkpathDest(linkpath, '');
  if (resolved) return resolved;
  return null;
}

const DocumentLink: React.FC<DocumentLinkProps> = ({ href, children, className = '' }) => {
  const resolvedPath = React.useMemo(() => {
    if (!isObsidian()) return null;
    const app = getObsidianApp();
    if (!app) return null;
    const file = resolveFile(app, href);
    const target = file ? (file as import('obsidian').TFile).path : null;
    console.debug(`[DocumentLink] "${href}" -> ${target ?? '(not found)'}`);
    return target;
  }, [href]);

  const handleClick = (e: React.MouseEvent) => {
    if (isObsidian() && href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
      e.preventDefault();

      try {
        const app = getObsidianApp();
        if (app && app.vault && app.workspace && resolvedPath) {
          const file = app.vault.getAbstractFileByPath(resolvedPath);
          if (file) {
            const leaf = app.workspace.getLeaf('tab');
            void leaf.openFile(file as import('obsidian').TFile);
          }
        } else {
          console.warn(`File not found: ${href}. You may need to create it first.`);
        }
      } catch (error) {
        console.error('Error opening file in Obsidian:', error);
      }
    }
  };

  const isFileLink = href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:');

  const baseClasses = "hermes-link-internal hover:opacity-80 transition-colors cursor-pointer";
  const fileLinkClasses = isFileLink && isObsidian() ? " underline decoration-dotted decoration-2" : "";

  const combinedClasses = `${baseClasses} ${fileLinkClasses} ${className}`.trim();

  return (
    <a
      href={href}
      onClick={handleClick}
      className={combinedClasses}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
      title={isFileLink && isObsidian() ? `Open ${resolvedPath || href} in Obsidian` : undefined}
    >
      {children}
    </a>
  );
};

export default DocumentLink;
