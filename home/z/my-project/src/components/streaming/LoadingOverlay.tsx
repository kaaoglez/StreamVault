'use client';

import { motion } from 'framer-motion';

interface LoadingOverlayProps {
  title: string;
  subtitle?: string;
  statusText?: string;
  onCancel: () => void;
  visible: boolean;
}

export function LoadingOverlay({
  title,
  subtitle,
  statusText = 'Cargando',
  onCancel,
  visible,
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="absolute inset-0 z-30 bg-black flex flex-col items-center justify-center select-none"
    >
      {/* Title */}
      <h1 className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-wide uppercase text-center px-6 leading-tight">
        {title}
      </h1>

      {/* Subtitle (episode info) */}
      {subtitle && (
        <p className="text-gray-500 text-sm md:text-base mt-2 text-center">
          {subtitle}
        </p>
      )}

      {/* Status text */}
      <p className="text-gray-400 text-xs md:text-sm mt-6 tracking-wider uppercase">
        {statusText}...
      </p>

      {/* Animated loading bars (equalizer style) */}
      <div className="flex items-end gap-1 mt-4 h-8">
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            className="w-1 bg-white/60 rounded-full"
            animate={{
              height: ['8px', '24px', '8px'],
            }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>

      {/* Cancel button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        className="mt-8 px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-medium tracking-wider uppercase transition-colors"
      >
        Cancelar
      </button>
    </motion.div>
  );
}