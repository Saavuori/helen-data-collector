import React, { useId } from 'react';

/** The app mark: the favicon's lightning bolt on a Helen-blue tile. */
export const Logo: React.FC<{ size?: number; radius?: number }> = ({ size = 32, radius = 9 }) => {
  // The sign-in screen shows the mark in the app bar and the form at once,
  // so the gradient id has to be unique per instance.
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2DD9F0" />
          <stop offset="100%" stopColor="#0A6C85" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx={radius} fill={`url(#${gradientId})`} />
      <path d="M17.6 4 8 18h6.2l-1.8 10 11.6-15.4h-6.6z" fill="#fff" />
    </svg>
  );
};

export default Logo;
