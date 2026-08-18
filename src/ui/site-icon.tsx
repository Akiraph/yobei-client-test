export default function SiteIcon(props: { title?: string; url?: string; class?: string }) {
  const firstCharacter = () => {
    const title = props.title?.trim();
    if (title) return title[0].toUpperCase();
    return props.url?.replace(/^https?:\/\//, '')[0]?.toUpperCase() ?? '?';
  };

  return (
    <div class={`item-icon site-icon ${props.class ?? ''}`} aria-hidden="true">
      <span class="site-icon-fallback">{firstCharacter()}</span>
    </div>
  );
}
