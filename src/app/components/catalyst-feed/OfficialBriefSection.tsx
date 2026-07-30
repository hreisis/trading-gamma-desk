import type {
  Catalyst,
  OfficialBrief,
  PublicOfficialAiBrief,
} from "@/contracts";
import { providerLabel } from "@/catalyst/feed-view";

function OfficialAiBriefInline({
  ai,
  brief,
  demo,
}: {
  ai: PublicOfficialAiBrief;
  brief: OfficialBrief;
  demo?: boolean;
}) {
  const factsById = new Map(brief.facts.map((f) => [f.id, f]));
  return (
    <div className="cf-brief-ai" data-testid="catalyst-official-ai-brief">
      <p className="cf-brief-kicker">
        {demo ? "Demo AI brief" : "AI brief"} · {ai.status}
      </p>
      <p className="cf-brief-headline">{ai.headline}</p>
      <ul className="cf-citations">
        {ai.bullets.map((b) => (
          <li key={b.id}>
            <span className="cf-citation-text">{b.text}</span>
            <ul className="cf-citation-refs">
              {b.factIds.map((fid) => {
                const f = factsById.get(fid);
                if (!f) return null;
                return (
                  <li
                    key={fid}
                    data-testid="catalyst-ai-brief-evidence"
                    className="cf-citation-ref"
                  >
                    <span className="cf-citation-label">{f.label}</span>
                    <q>{f.evidence.excerpt}</q>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OfficialBriefSection({
  catalyst,
  briefsByDocId,
  aiByBriefId,
  demo,
}: {
  catalyst: Catalyst;
  briefsByDocId: ReadonlyMap<string, OfficialBrief>;
  aiByBriefId: ReadonlyMap<string, PublicOfficialAiBrief>;
  demo?: boolean;
}) {
  const docs = catalyst.officialDocuments ?? [];
  const briefEntries = docs
    .map((d) => {
      const brief = briefsByDocId.get(d.id);
      const ai = brief ? aiByBriefId.get(brief.id) : undefined;
      return { doc: d, brief, ai };
    })
    .filter((e) => e.brief);

  if (briefEntries.length === 0) {
    return (
      <div className="cf-panel cf-panel-muted" data-testid="catalyst-brief-empty">
        <h4 className="cf-panel-title">Official brief</h4>
        <p className="cf-panel-note">No linked official brief for this event.</p>
      </div>
    );
  }

  return (
    <div className="cf-panel" data-testid="catalyst-official-brief">
      <h4 className="cf-panel-title">Official brief</h4>
      {briefEntries.map(({ doc, brief, ai }) => {
        if (!brief) return null;
        const showAi =
          ai &&
          (ai.status === "complete" || ai.status === "partial") &&
          ai.validation.errors.length === 0;
        const facts = brief.facts.slice(0, 4);
        return (
          <div key={doc.id} className="cf-brief-block">
            <p className="cf-brief-kicker">
              {providerLabel(doc.provider)} · {brief.status}
              {brief.referencePeriod ? ` · ref ${brief.referencePeriod}` : ""}
            </p>
            {showAi ? (
              <OfficialAiBriefInline ai={ai} brief={brief} demo={demo} />
            ) : (
              <>
                <p className="cf-brief-headline">{brief.headline}</p>
                <ul className="cf-citations">
                  {facts.map((f) => (
                    <li key={f.id}>
                      <span className="cf-citation-text">{f.text}</span>
                      <p
                        className="cf-citation-ref"
                        data-testid="catalyst-brief-evidence"
                      >
                        <span className="cf-citation-label">Source excerpt</span>
                        <q>{f.evidence.excerpt}</q>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="cf-panel-note">
              <a
                href={doc.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="catalyst-official-doc-link"
              >
                Official document
              </a>
              {showAi
                ? " · AI rewrites cited facts only"
                : " · Rule-based fact extract — not official prose"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
