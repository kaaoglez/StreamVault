/**
 * Opens the trailer modal for the given movie/series title.
 * The modal will search for the trailer and play it embedded.
 */

import { openTrailerModal } from '@/components/streaming/TrailerModal';

export function openYouTubeTrailer(title: string) {
  openTrailerModal(title);
}