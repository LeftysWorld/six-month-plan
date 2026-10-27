import { useState } from 'react';
import { useStore } from '../data/store.tsx';
import { digestMailto, type Digest } from '../data/digest.ts';
import { href } from '../router.ts';

/**
 * The week in a few lines, at the top of the weekly review: read it, copy it, or send it to your
 * accountability partner. Saving the review stores it, so the partner email goes out on its own
 * when that's set up (Settings → Accountability partner).
 */
export function DigestCard({ digest }: { digest: Digest }) {
  const { data } = useStore();
  const [copied, setCopied] = useState(false);
  const partner = data.profile.partner_email?.trim() || null;
  return (
    <section className="card stack-sm" aria-label="Your week">
      <div className="row-between">
        <span className="label">Your week</span>
        <span className="xsmall muted">{digest.title}</span>
      </div>
      <ul className="digest-lines">
        {digest.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <div className="row-start no-print" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(digest.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // clipboard blocked: the mailto still works
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a className="btn small" href={digestMailto(digest, partner, data.profile.display_name)}>
          {partner ? `Send to ${partner}` : 'Send by email'}
        </a>
        {!partner && (
          <a className="link-btn small" href={href('/settings')}>
            Add a partner
          </a>
        )}
      </div>
    </section>
  );
}
