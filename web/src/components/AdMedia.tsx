import { HeartHandshake } from 'lucide-react';
import { adMediaUrl } from '../lib/supabase';
import type { SponsoredPost } from '../lib/types';

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Moving media is what makes a sponsored post read as an advertisement. Videos loop silently and
// inline; people who ask their device for reduced motion get a paused video with controls instead.
export function AdMedia({ post, className = '' }: { post: SponsoredPost; className?: string }) {
  const url = adMediaUrl(post.media_path);
  if (!url) {
    return <span className={`flex items-center justify-center bg-gold/10 text-gold ${className}`}><HeartHandshake size={26} /></span>;
  }
  if (post.media_type === 'video') {
    return (
      <video
        src={url} muted loop playsInline preload="metadata"
        autoPlay={!reduceMotion} controls={reduceMotion}
        aria-label={`Advertisement video from ${post.ngo?.name ?? 'sponsor'}`}
        className={`object-cover ${className}`}
      />
    );
  }
  return <img src={url} alt={`Advertisement from ${post.ngo?.name ?? 'sponsor'}`} loading="lazy" className={`object-cover ${className}`} />;
}
