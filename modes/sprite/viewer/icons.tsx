/**
 * Single-stroke icons for the sprite stage.
 *
 * Local and tiny on purpose: the viewer must not pull an icon package into
 * the hosted player bundle, and the project bans emoji in UI chrome, so every
 * affordance that is not a word is one of these paths. They inherit
 * `currentColor` so a button's own token colour drives them.
 */

export interface IconProps {
  size?: number;
  className?: string;
}

function Svg({
  size = 14,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}><path d="M7 4.5v15l12-7.5z" /></Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9 4.5v15M15 4.5v15" /></Svg>
);

export const StepBackIcon = (p: IconProps) => (
  <Svg {...p}><path d="M18 5v14L8 12zM6 5v14" /></Svg>
);

export const StepForwardIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 5v14l10-7zM18 5v14" /></Svg>
);

export const LoopIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9a4 4 0 0 1 4-4h9M17 2.5 20 5l-3 2.5" />
    <path d="M20 15a4 4 0 0 1-4 4H7M7 21.5 4 19l3-2.5" />
  </Svg>
);

export const OnceIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 12h13M14 7.5 19 12l-5 4.5" /></Svg>
);

export const OnionIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);

export const GroundIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11" />
    <path d="M3 19h18" strokeDasharray="3 3" />
    <path d="M8.5 11.5 12 15l3.5-3.5" />
  </Svg>
);

export const CheckerIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
    <path d="M12 3.5v17M3.5 12h17" />
    <path d="M3.5 3.5h8.5v8.5zM12 12h8.5v8.5z" fill="currentColor" stroke="none" opacity="0.35" />
  </Svg>
);

export const ZoomIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.4-4.4M8 10.5h5M10.5 8v5" />
  </Svg>
);

export const RailIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M9.5 4.5v15" />
  </Svg>
);

export const WarnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5 21 19.5H3z" />
    <path d="M12 10v4M12 16.8v.2" />
  </Svg>
);

export const FilmIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 5v14M17 5v14M3 12h18" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </Svg>
);

export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m4 17 5-5 4 4 3-2.5 4 3.5" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
  </Svg>
);

export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9L4.5 10.8 10.2 9z" />
  </Svg>
);

export const CrosshairIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>
);
