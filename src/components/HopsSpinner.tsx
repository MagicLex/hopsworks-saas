import React from 'react';

interface HopsSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
};

export function HopsSpinner({ size = 'md', className = '' }: HopsSpinnerProps) {
  return (
    <div className={`relative ${sizeClasses[size]} ${className}`}>
      <style>{`
        @keyframes hops-eyes {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(1.5px); }
          75% { transform: translateX(-1.5px); }
        }
        .hops-pupils {
          animation: hops-eyes 1.5s ease-in-out infinite;
        }
      `}</style>
      <svg
        viewBox="0 0 32 40"
        className="w-full h-full"
      >
        {/* Pixel robot - hybrid style */}

        {/* Antennae */}
        <rect x="8" y="0" width="2" height="2" fill="#1eb182"/>
        <rect x="9" y="2" width="2" height="3" fill="#1eb182"/>
        <rect x="22" y="0" width="2" height="2" fill="#1eb182"/>
        <rect x="21" y="2" width="2" height="3" fill="#1eb182"/>

        {/* Head */}
        <rect x="6" y="6" width="20" height="10" fill="#1eb182"/>
        {/* Eyes */}
        <rect x="9" y="9" width="4" height="4" fill="white"/>
        <rect x="19" y="9" width="4" height="4" fill="white"/>
        {/* Pupils - animated */}
        <g className="hops-pupils">
          <rect x="11" y="10" width="2" height="2" fill="#17a376"/>
          <rect x="21" y="10" width="2" height="2" fill="#17a376"/>
        </g>

        {/* Neck - gap + connector */}
        <rect x="13" y="17" width="6" height="2" fill="#17a376"/>

        {/* Body */}
        <rect x="8" y="20" width="16" height="10" fill="#1eb182"/>
        {/* Chest panel */}
        <rect x="11" y="22" width="10" height="3" fill="#17a376"/>
        {/* Buttons */}
        <rect x="12" y="27" width="2" height="2" fill="white"/>
        <rect x="18" y="27" width="2" height="2" fill="white"/>

        {/* Arms */}
        <rect x="4" y="21" width="3" height="6" fill="#1eb182"/>
        <rect x="3" y="27" width="4" height="3" fill="#17a376"/>
        <rect x="25" y="21" width="3" height="6" fill="#1eb182"/>
        <rect x="25" y="27" width="4" height="3" fill="#17a376"/>

        {/* Legs - with gap */}
        <rect x="10" y="31" width="5" height="6" fill="#1eb182"/>
        <rect x="17" y="31" width="5" height="6" fill="#1eb182"/>

        {/* Feet */}
        <rect x="8" y="37" width="7" height="3" fill="#17a376"/>
        <rect x="17" y="37" width="7" height="3" fill="#17a376"/>
      </svg>
    </div>
  );
}

export default HopsSpinner;
