'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TruncatedTextProps {
  text: string;
  className?: string;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'div';
}

/**
 * Renders text with CSS truncation.
 * Shows a tooltip with the full text on hover.
 */
export function TruncatedText({
  text,
  className,
  as: Tag = 'span',
}: TruncatedTextProps) {
  if (!text) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Tag className={cn('truncate', className)}>{text}</Tag>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <p className="text-xs max-w-[300px] break-words">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}